# Shared by setup, Graph and workload hosts. Dot-sourcing does not install or import anything.
if (-not (Get-Variable -Name fdCompatibilityModules -Scope Script -ErrorAction SilentlyContinue)) {
    $script:fdCompatibilityModules = [System.Collections.Generic.List[object]]::new()
}
function Get-FdPrivateModuleRoot {
    $local = $env:LOCALAPPDATA
    if ([string]::IsNullOrWhiteSpace($local) -or $local -notmatch '^[A-Za-z]:[\\/]' -or
        $local -match '[;*?\[\]]') {
        throw 'MODULE_LOCAL_PATH_UNSAFE: LOCALAPPDATA must be an absolute local Windows directory; no Documents fallback is permitted.'
    }
    $local = [IO.Path]::GetFullPath($local)
    if ([IO.DriveInfo]::new([IO.Path]::GetPathRoot($local)).DriveType -ne [IO.DriveType]::Fixed) {
        throw 'MODULE_LOCAL_PATH_UNSAFE: LOCALAPPDATA must be on a fixed local drive, not a network or removable drive.'
    }
    if ($local.TrimEnd('\') -eq [IO.Path]::GetPathRoot($local).TrimEnd('\')) {
        throw 'MODULE_LOCAL_PATH_UNSAFE: LOCALAPPDATA cannot be a drive root.'
    }
    $root = Join-Path $local 'AI Flight Deck\PowerShell\Modules'
    foreach ($blocked in @($env:OneDrive, $env:OneDriveCommercial, $env:OneDriveConsumer,
        [Environment]::GetFolderPath('MyDocuments'))) {
        if (-not [string]::IsNullOrWhiteSpace($blocked)) {
            $prefix = [IO.Path]::GetFullPath($blocked).TrimEnd('\') + '\'
            if (($root + '\').StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
                throw 'MODULE_LOCAL_PATH_UNSAFE: The private module store cannot be inside Documents or OneDrive.'
            }
        }
    }
    # Reject redirection before creating/downloading anything. Never follow junctions into synced storage.
    $ancestor = $root
    while ($ancestor) {
        if (Test-Path -LiteralPath $ancestor) {
            $item = Get-Item -LiteralPath $ancestor -Force -ErrorAction Stop
            if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
                throw 'MODULE_LOCAL_PATH_UNSAFE: The private module store must use ordinary local directories, not redirected paths.'
            }
        }
        $ancestor = [IO.Path]::GetDirectoryName($ancestor)
    }
    return $root
}

function Initialize-FdModuleEnvironment {
    $root = Get-FdPrivateModuleRoot
    # Rebuild AFTER host startup: powershell.exe and compatibility sessions reset inherited PSModulePath.
    # Keep only native machine locations for inbox/package-management dependencies, never user Documents.
    $paths = @($root, (Join-Path $PSHOME 'Modules'))
    if ($env:ProgramFiles) {
        if ($PSVersionTable.PSEdition -eq 'Core') {
            $paths += Join-Path $env:ProgramFiles 'PowerShell\Modules'
        }
        $paths += Join-Path $env:ProgramFiles 'WindowsPowerShell\Modules'
    }
    if ($PSVersionTable.PSEdition -eq 'Core' -and $env:SystemRoot) {
        $paths += Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\Modules'
    }
    $env:PSModulePath = ($paths | Select-Object -Unique) -join [IO.Path]::PathSeparator
    foreach ($module in @(Get-Module)) {
        if (-not $module.Path) { continue }
        # PowerShell generates a local remoting proxy outside the store. Only accept proxies
        # returned by our own successful private import, not arbitrary preloaded modules.
        if ($script:fdCompatibilityModules.Contains($module)) { continue }
        $allowed = @($paths | Where-Object {
            $module.Path.StartsWith($_.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)
        })
        if (-not $allowed.Count) {
            throw 'MODULE_ALREADY_LOADED_OUTSIDE_STORE: Restart in a fresh no-profile PowerShell host; an existing module was loaded outside the private/native machine paths.'
        }
    }
    return $root
}

function Get-FdPrivateModule {
    param([string]$Root, [string]$Name, [version]$MinimumVersion, [version]$RequiredVersion)
    # Absolute discovery prevents a newer user/machine copy from winning over the private package.
    $directory = Join-Path $Root $Name
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) { return }
    return Get-Module -ListAvailable -Name $directory -ErrorAction Stop |
        Where-Object {
            $_.Name -eq $Name -and $_.Version -ge $MinimumVersion -and
            (-not $RequiredVersion -or $_.Version -eq $RequiredVersion) -and
            $_.Path.StartsWith($directory + '\', [StringComparison]::OrdinalIgnoreCase)
        } | Sort-Object Version -Descending | Select-Object -First 1
}

function Resolve-FdModule {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][ValidateSet('Microsoft.Graph.Authentication', 'ExchangeOnlineManagement',
            'Microsoft.Online.SharePoint.PowerShell', 'Microsoft.PowerApps.Administration.PowerShell')][string]$Name,
        [version]$MinimumVersion = '0.0',
        [version]$RequiredVersion,
        [switch]$InstallMissingModules
    )
    if ($Name -eq 'Microsoft.PowerApps.Administration.PowerShell') {
        if ($RequiredVersion -and $RequiredVersion -ne [version]'2.0.216') { throw 'MODULE_VERSION_NOT_ALLOWED' }
        $RequiredVersion = [version]'2.0.216'
    }
    $root = Initialize-FdModuleEnvironment
    $module = Get-FdPrivateModule $root $Name $MinimumVersion $RequiredVersion
    if ($module) { return $module }
    if (-not $InstallMissingModules) {
        throw "MODULE_MISSING: $Name is absent from the private store. Run guided setup for Graph or enable InstallMissingModules for workload collection."
    }
    $originalSecurityProtocol = [Net.ServicePointManager]::SecurityProtocol
    try {
        [Net.ServicePointManager]::SecurityProtocol = $originalSecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        $repository = Get-PSRepository -Name PSGallery -ErrorAction Stop
        if ($repository.SourceLocation.TrimEnd('/') -ne 'https://www.powershellgallery.com/api/v2') {
            throw 'UNEXPECTED_GALLERY_SOURCE'
        }
        if (-not (Get-PackageProvider -Name NuGet -ListAvailable -ErrorAction SilentlyContinue |
            Where-Object { $_.Version -ge [version]'2.8.5.201' })) {
            Install-PackageProvider -Name NuGet -MinimumVersion '2.8.5.201' -Scope CurrentUser -Force -Confirm:$false -ErrorAction Stop *> $null
        }
        [IO.Directory]::CreateDirectory($root) | Out-Null
        $saveParameters = @{
            Name = $Name
            Path = $root
            Repository = 'PSGallery'
            Force = $true
            Confirm = $false
            ErrorAction = 'Stop'
        }
        if ($RequiredVersion) { $saveParameters.RequiredVersion = $RequiredVersion }
        elseif ($MinimumVersion -gt [version]'0.0') { $saveParameters.MinimumVersion = $MinimumVersion }
        if ((Get-Command Save-Module -ErrorAction Stop).Parameters.ContainsKey('AcceptLicense')) {
            $saveParameters.AcceptLicense = $true
        }
        # Save-Module downloads dependencies alongside the package without Install-Module command collisions.
        Save-Module @saveParameters *> $null
        $module = Get-FdPrivateModule $root $Name $MinimumVersion $RequiredVersion
        if (-not $module) { throw 'MODULE_DOWNLOAD_NOT_FOUND' }
        return $module
    } catch {
        if ($_.Exception.Message -eq 'UNEXPECTED_GALLERY_SOURCE') {
            throw 'MODULE_GALLERY_SOURCE_REJECTED: PSGallery is not the official HTTPS PowerShell Gallery source. Ask your administrator to verify repository configuration; trust was not changed.'
        }
        throw "MODULE_DOWNLOAD_FAILED: Could not save $Name and dependencies to the private LOCALAPPDATA store. Check approved Gallery access, local write permissions and package-management availability; do not move or unblock policy-blocked OneDrive files."
    } finally {
        [Net.ServicePointManager]::SecurityProtocol = $originalSecurityProtocol
    }
}

function Import-FdModule {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Module, [switch]$UseWindowsPowerShell)
    $null = Initialize-FdModuleEnvironment
    try {
        if ($UseWindowsPowerShell) {
            # The compatibility process has its own native paths. Initialize it before the first import.
            $session = Get-PSSession -Name WinPSCompatSession -ErrorAction SilentlyContinue
            if (-not $session) { $session = New-PSSession -UseWindowsPowerShell -Name WinPSCompatSession -ErrorAction Stop }
            Invoke-Command -Session $session -ScriptBlock {
                param($HelperPath)
                . $HelperPath
                $null = Initialize-FdModuleEnvironment
            } -ArgumentList (Join-Path $PSScriptRoot 'FlightDeck.Modules.ps1') -ErrorAction Stop *> $null
            $proxies = @(Import-Module -Name $Module.Path -UseWindowsPowerShell -Global -PassThru -WarningAction SilentlyContinue -ErrorAction Stop)
            foreach ($proxy in $proxies) { $script:fdCompatibilityModules.Add($proxy) }
        } else {
            Import-Module -Name $Module.Path -Global -ErrorAction Stop *> $null
        }
    } catch {
        throw 'MODULE_IMPORT_FAILED: The private module or a dependency could not be loaded in this host. Retry in a fresh no-profile host and verify the approved private download; do not reuse blocked Documents modules.'
    }
}
