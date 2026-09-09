# 2026-09-09 regression: CurrentUser module downloads landed in redirected OneDrive Documents.
# Synthetic packages only; no Gallery access, installed-module changes or tenant authentication.
[CmdletBinding()]
param([Parameter(Mandatory)][string]$FixtureRoot)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot '..\FlightDeck.Modules.ps1')

function Assert-PrivateTest($Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}
function Write-SyntheticModule([string]$Root, [string]$Name, [string]$Version, [string]$Value, [switch]$Dependency) {
    $directory = Join-Path (Join-Path $Root $Name) $Version
    [IO.Directory]::CreateDirectory($directory) | Out-Null
    $requires = if ($Dependency) { "@(@{ModuleName='FlightDeckSyntheticDependency';ModuleVersion='1.0.0'})" } else { '@()' }
    $command = if ($Dependency) { 'function Get-SyntheticPrivateValue { Get-SyntheticDependencyValue }' }
        else { "function Get-SyntheticDependencyValue { '$Value' }" }
    [IO.File]::WriteAllText((Join-Path $directory "$Name.psm1"), $command)
    [IO.File]::WriteAllText((Join-Path $directory "$Name.psd1"),
        "@{ RootModule='$Name.psm1';ModuleVersion='$Version';RequiredModules=$requires;FunctionsToExport='*' }")
}
$env:LOCALAPPDATA = Join-Path $FixtureRoot 'Local App Data'
$originalLocal = $env:LOCALAPPDATA
$env:OneDrive = Join-Path $FixtureRoot 'OneDrive'
$documents = Join-Path $env:OneDrive 'Documents\WindowsPowerShell\Modules'
# A newer synthetic Documents package must not satisfy the approved module or its dependency.
Write-SyntheticModule $documents 'Microsoft.Graph.Authentication' '99.0.0' 'wrong' -Dependency
Write-SyntheticModule $documents 'FlightDeckSyntheticDependency' '99.0.0' 'wrong'
$env:PSModulePath = $documents + [IO.Path]::PathSeparator + $env:PSModulePath
$script:saves = [System.Collections.Generic.List[object]]::new()
$script:gallery = 'https://www.powershellgallery.com/api/v2'
$script:failSave = $false
function Get-PSRepository { [CmdletBinding()]param([string]$Name) @{ SourceLocation = $script:gallery } }
function Get-PackageProvider {
    [CmdletBinding()]param([string]$Name, [switch]$ListAvailable)
    @{ Version = [version]'2.8.5.201' }
}
function Install-PackageProvider { throw 'Unexpected provider installation in offline regression.' }
function Install-Module { throw 'Install-Module must never be invoked.' }
function Save-Module {
    [CmdletBinding(SupportsShouldProcess)]
    param([string]$Name, [string]$Path, [string]$Repository, [version]$RequiredVersion,
        [version]$MinimumVersion, [switch]$Force, [switch]$AcceptLicense)
    Assert-PrivateTest ($Path -eq (Join-Path $originalLocal 'AI Flight Deck\PowerShell\Modules')) 'Download path escaped the private root.'
    Assert-PrivateTest ($Repository -eq 'PSGallery' -and $Force -and $AcceptLicense -and
        $PSBoundParameters.ContainsKey('Confirm') -and -not $PSBoundParameters.Confirm) 'Download flags are not noninteractive.'
    $script:saves.Add(@{ name = $Name; required = $RequiredVersion; minimum = $MinimumVersion })
    if ($script:failSave) { throw 'SYNTHETIC_PROVIDER_PRIVATE_RESPONSE' }
    $version = if ($RequiredVersion) { $RequiredVersion.ToString() }
        elseif ($MinimumVersion) { $MinimumVersion.ToString() } else { '1.0.0' }
    Write-SyntheticModule $Path 'FlightDeckSyntheticDependency' '1.0.0' 'private'
    Write-SyntheticModule $Path $Name $version 'unused' -Dependency
}

$beforeTls = [Net.ServicePointManager]::SecurityProtocol
try {
    try { $null = Resolve-FdModule -Name Microsoft.Graph.Authentication; throw 'Expected missing private package.' }
    catch { Assert-PrivateTest ($_.Exception.Message -match '^MODULE_MISSING:') "Expected missing private package: $($_.Exception.Message)" }
    Assert-PrivateTest ($script:saves.Count -eq 0) 'Disabled downloads still ran.'
    try { $null = Resolve-FdModule -Name Unapproved.Synthetic.Module -InstallMissingModules; throw 'Expected allowlist rejection.' }
    catch { Assert-PrivateTest ($_.FullyQualifiedErrorId -like 'ParameterArgumentValidationError*') 'Unapproved module was accepted.' }
    Assert-PrivateTest ($script:saves.Count -eq 0) 'Unapproved module reached download.'
    $module = Resolve-FdModule -Name Microsoft.Graph.Authentication -InstallMissingModules
    $root = Get-FdPrivateModuleRoot
    Assert-PrivateTest ($module.Version -eq [version]'1.0.0') 'Selected nonprivate higher version.'
    Assert-PrivateTest (($env:PSModulePath -split ';')[0] -eq $root) 'Private dependencies are not first.'
    Assert-PrivateTest ($env:PSModulePath -notlike "*$documents*") 'Documents survived discovery initialization.'
    Assert-PrivateTest ($env:PSModulePath -like "*$PSHOME\Modules*") 'Native host modules were lost.'
    Import-FdModule $module
    Assert-PrivateTest ((Get-SyntheticPrivateValue) -eq 'private') 'RequiredModules did not resolve privately.'
    $null = Resolve-FdModule -Name Microsoft.Graph.Authentication -InstallMissingModules
    Assert-PrivateTest ($script:saves.Count -eq 1) 'Existing private package was downloaded twice.'
    $pp = Resolve-FdModule -Name Microsoft.PowerApps.Administration.PowerShell -RequiredVersion '2.0.216' -InstallMissingModules
    Assert-PrivateTest ($pp.Version -eq [version]'2.0.216' -and $script:saves[1].required -eq [version]'2.0.216') 'Power Platform pin changed.'
    try { $null = Resolve-FdModule -Name Microsoft.PowerApps.Administration.PowerShell -RequiredVersion '2.0.217'; throw 'Expected pin rejection.' }
    catch { Assert-PrivateTest ($_.Exception.Message -eq 'MODULE_VERSION_NOT_ALLOWED') 'Unsupported Power Platform version was allowed.' }
    $exo = Resolve-FdModule -Name ExchangeOnlineManagement -MinimumVersion '3.7.2' -InstallMissingModules
    Assert-PrivateTest ($exo.Version -ge [version]'3.7.2' -and $script:saves[2].minimum -eq [version]'3.7.2') 'Exchange minimum version changed.'
    $script:gallery = 'https://unapproved.invalid/api/v2'
    try { $null = Resolve-FdModule -Name Microsoft.Online.SharePoint.PowerShell -InstallMissingModules; throw 'Expected Gallery rejection.' }
    catch { Assert-PrivateTest ($_.Exception.Message -match '^MODULE_GALLERY_SOURCE_REJECTED:') 'Unapproved Gallery was used.' }
    Assert-PrivateTest ($script:saves.Count -eq 3) 'Save was called against an unapproved Gallery.'
    $script:gallery = 'https://www.powershellgallery.com/api/v2'
    $script:failSave = $true
    try { $null = Resolve-FdModule -Name Microsoft.Online.SharePoint.PowerShell -InstallMissingModules; throw 'Expected save failure.' }
    catch {
        Assert-PrivateTest ($_.Exception.Message -match '^MODULE_DOWNLOAD_FAILED:' -and
            $_.Exception.Message -notmatch 'SYNTHETIC_PROVIDER_PRIVATE_RESPONSE') 'Raw provider error escaped.'
    }
    Assert-PrivateTest ([Net.ServicePointManager]::SecurityProtocol -eq $beforeTls) 'TLS settings were not restored.'
    $script:failSave = $false
    if ($PSVersionTable.PSEdition -eq 'Core') {
        $spo = Resolve-FdModule -Name Microsoft.Online.SharePoint.PowerShell -InstallMissingModules
        Import-FdModule $spo -UseWindowsPowerShell
        $compat = Get-PSSession -Name WinPSCompatSession
        $result = Invoke-Command -Session $compat -ScriptBlock {
            @{ value = Get-SyntheticPrivateValue; paths = $env:PSModulePath; home = $PSHOME }
        }
        Assert-PrivateTest ($result.value -eq 'private') 'Compatibility host did not import the private dependency.'
        Assert-PrivateTest (($result.paths -split ';')[0] -eq $root -and
            $result.paths -like "*$($result.home)\Modules*" -and $result.paths -notlike "*$documents*") 'Compatibility host discovery is not native/private.'
        $null = Resolve-FdModule -Name ExchangeOnlineManagement -MinimumVersion '3.7.2'
        Remove-PSSession -Session $compat
    }
    foreach ($unsafe in @('', 'relative', 'C:', 'C:\', '\\server\share', (Join-Path $env:OneDrive 'redirected'),
        (Join-Path $FixtureRoot 'ambiguous;path'))) {
        $env:LOCALAPPDATA = $unsafe
        try { $null = Get-FdPrivateModuleRoot; throw 'Expected unsafe path rejection.' }
        catch { Assert-PrivateTest ($_.Exception.Message -match '^MODULE_LOCAL_PATH_UNSAFE:') 'Unsafe local path was accepted.' }
    }
    $junction = Join-Path $FixtureRoot 'redirected-local'
    New-Item -ItemType Junction -Path $junction -Target $env:OneDrive | Out-Null
    $env:LOCALAPPDATA = $junction
    try { $null = Get-FdPrivateModuleRoot; throw 'Expected junction rejection.' }
    catch { Assert-PrivateTest ($_.Exception.Message -match '^MODULE_LOCAL_PATH_UNSAFE:') 'Redirected local path was accepted.' }
    $env:LOCALAPPDATA = $originalLocal
    # A preloaded user module cannot be silently retained after PSModulePath is repaired.
    Import-Module (Join-Path $documents 'FlightDeckSyntheticDependency\99.0.0\FlightDeckSyntheticDependency.psd1') -Force
    try { $null = Initialize-FdModuleEnvironment; throw 'Expected preloaded module rejection.' }
    catch { Assert-PrivateTest ($_.Exception.Message -match '^MODULE_ALREADY_LOADED_OUTSIDE_STORE:') 'Preloaded Documents dependency was retained.' }
    Write-Host "PRIVATE_MODULE_TEST_OK:$($PSVersionTable.PSEdition)"
} finally {
    $env:LOCALAPPDATA = $originalLocal
}
