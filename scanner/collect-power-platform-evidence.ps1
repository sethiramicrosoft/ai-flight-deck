#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][guid]$TenantId,
    [Parameter(Mandatory = $true)][string]$WorkspacePath,
    [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9_-]{32,128}$')][string]$CollectionChallenge,
    [string]$OutputPath,
    [switch]$InstallMissingModules = $true,
    [ValidateRange(1, 500)][int]$MaxEnvironments = 50,
    [ValidateRange(1, 10000)][int]$MaxItems = 2000,
    [ValidateRange(1, 5000)][int]$MaxRequests = 500,
    [ValidateRange(1, 100)][int]$MaxPages = 20,
    [ValidateRange(1, 5000)][int]$PageSize = 250,
    [ValidateRange(5, 120)][int]$RequestTimeoutSeconds = 45,
    [ValidateRange(30, 1800)][int]$MaximumDurationSeconds = 900
)

$ErrorActionPreference = 'Stop'
$VerbosePreference = 'SilentlyContinue'
$DebugPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
. (Join-Path $PSScriptRoot 'PowerPlatform.Evidence.ps1')

# The official PowerApps module requires Windows PowerShell 5.x / .NET Framework.
# The app launches this process; only Microsoft browser sign-in/MFA/consent is interactive.
# No credentials, registrations, roles or tenant resources are created or modified.
# Hard deadline covers module install, browser interaction and opaque cmdlet pagination.
# Parent must also kill the child process tree on cancellation and ignore any unsealed output.
$watchdog = [PowerShell]::Create()
$null = $watchdog.AddScript('param($ProcessId,$Seconds); Start-Sleep -Seconds $Seconds; [Diagnostics.Process]::GetProcessById($ProcessId).Kill()').AddArgument($PID).AddArgument($MaximumDurationSeconds)
$watchdogRun = $watchdog.BeginInvoke()
$stage = 'prerequisites'
try {
    if ($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5) {
        throw 'PP_WINDOWS_POWERSHELL_51_REQUIRED'
    }
    $workspace = [IO.Path]::GetFullPath($WorkspacePath)
    if ($workspace.StartsWith('\\')) { throw 'PP_LOCAL_WORKSPACE_REQUIRED' }
    if (-not $OutputPath) { $OutputPath = Join-Path $workspace 'power-platform-evidence.collected.json' }
    $destination = [IO.Path]::GetFullPath($OutputPath)
    if (-not $destination.StartsWith($workspace.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'PP_OUTPUT_OUTSIDE_WORKSPACE'
    }
    if (Test-Path -LiteralPath $destination) { throw 'PP_OUTPUT_ALREADY_EXISTS' }
    # Pin both module identity and version; install automatically only when absent.
    $moduleName = 'Microsoft.PowerApps.Administration.PowerShell'
    $moduleVersion = '2.0.216'
    if (-not (Get-Module -ListAvailable -Name $moduleName | Where-Object { $_.Version -eq [version]$moduleVersion })) {
        if (-not $InstallMissingModules) { throw 'PP_MODULE_INSTALL_DISABLED' }
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        if (-not (Get-PackageProvider -Name NuGet -ListAvailable -ErrorAction SilentlyContinue)) {
            Install-PackageProvider -Name NuGet -MinimumVersion '2.8.5.201' -Scope CurrentUser -Force -Confirm:$false | Out-Null
        }
        Install-Module -Name $moduleName -RequiredVersion $moduleVersion -Repository PSGallery `
            -Scope CurrentUser -Force -AllowClobber -Confirm:$false -ErrorAction Stop | Out-Null
    }
    Import-Module $moduleName -RequiredVersion $moduleVersion -ErrorAction Stop -Verbose:$false | Out-Null
    foreach ($name in @('Add-PowerAppsAccount', 'Get-JwtToken', 'Get-AdminPowerAppEnvironment', 'Get-AdminDlpPolicy', 'Get-AdminPowerAppConnector')) {
        if (-not (Get-Command $name -ErrorAction SilentlyContinue)) { throw 'PP_REQUIRED_CMDLET_UNAVAILABLE' }
    }
    if (-not (Get-Command Add-PowerAppsAccount).Parameters.ContainsKey('UseSystemBrowser')) { throw 'PP_BROWSER_SIGNIN_UNAVAILABLE' }
    # Do not allow environment endpoint overrides to redirect the module or its authentication.
    foreach ($name in @('AUDIENCE_OVERRIDE', 'AUTH_BASE_URI_OVERRIDE', 'FLOW_ENDPOINT_OVERRIDE', 'POWERAPPS_ENDPOINT_OVERRIDE', 'BAP_ENDPOINT_OVERRIDE', 'GRAPH_ENDPOINT_OVERRIDE', 'PVA_ENDPOINT_OVERRIDE')) {
        if ([Environment]::GetEnvironmentVariable($name)) { throw 'PP_ENDPOINT_OVERRIDE_REJECTED' }
    }
    $stage = 'authenticated collection'
    Write-Host 'Power Platform collection: complete Microsoft browser sign-in/MFA if prompted. Collection and file handling are automatic.'
    $document = Invoke-PPEvidenceCollection -TenantId $TenantId.ToString('D') -CollectionChallenge $CollectionChallenge `
        -Operations (New-PPLiveOperations) -MaxEnvironments $MaxEnvironments -MaxItems $MaxItems `
        -MaxRequests $MaxRequests -MaxPages $MaxPages -PageSize $PageSize -RequestTimeoutSeconds $RequestTimeoutSeconds
    $document.collection.limits.maximumDurationSeconds = $MaximumDurationSeconds
    $document.collection.module = @{ name = $moduleName; version = $moduleVersion }
    $stage = 'local output'
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination)) | Out-Null
    # CreateNew prevents an accidental overwrite. Parent imports only after exit 0 and challenge validation.
    $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes(($document | ConvertTo-Json -Depth 30))
    $file = [IO.File]::Open($destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $file.Write($bytes, 0, $bytes.Length); $file.Flush() } finally { $file.Dispose() }
    Write-Host 'Power Platform evidence collected. Resource limitations are recorded; the application will import the package automatically.'
}
catch {
    $problem = Get-PPSafeError $_
    # Avoid raw exception serialization, module diagnostics and token-bearing error bodies.
    [Console]::Error.WriteLine("Power Platform $stage failed [$($problem.code)]. $($problem.message)")
    [Console]::Error.WriteLine("AFD_COLLECTOR_ERROR:" + (@{
        code = $problem.code; message = $problem.message
    } | ConvertTo-Json -Compress))
    exit 1
}
finally {
    $global:currentSession = $null
    $watchdog.Stop()
    $watchdog.Dispose()
}
