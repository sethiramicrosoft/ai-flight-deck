[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet("Baseline", "Verification", "Compare", "Status")]
    [string]$Phase,

    [Parameter()]
    [string]$WorkspacePath,

    [Parameter()]
    [ValidateSet("Interactive", "DeviceCode", "AccessToken", "ExistingContext", "ManagedIdentity", "Certificate")]
    [string]$AuthMode = "Interactive",

    [Parameter()]
    [string]$TenantId,

    [Parameter()]
    [string]$ClientId,

    [Parameter()]
    [string]$CertificateThumbprint,

    [Parameter()]
    [ValidateRange(1, 10000)]
    [int]$MaxSites = 500,

    [Parameter()]
    [ValidateRange(1, 1000)]
    [int]$MaxDrivesPerSite = 50,

    [Parameter()]
    [ValidateRange(1, 100000)]
    [int]$MaxItemsPerDrive = 5000,

    [Parameter()]
    [ValidateRange(1, 5000000)]
    [int]$MaxUsers = 50000,

    [Parameter()]
    [ValidateRange(1, 2000000)]
    [int]$MaxGroups = 50000,

    [Parameter()]
    [ValidateRange(1, 100000)]
    [int]$MaxPermissionsPerSite = 5000,

    [Parameter()]
    [ValidateRange(1, 2000000)]
    [int]$MaxGraphRequests = 200000
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot "FlightDeck.Common.ps1")

if ([string]::IsNullOrWhiteSpace($WorkspacePath)) {
    $WorkspacePath = Get-FdDefaultLiveTestWorkspace
}

$workspace = [System.IO.Path]::GetFullPath($WorkspacePath)
$baselinePath = Join-Path $workspace "baseline-scan.json"
$verificationPath = Join-Path $workspace "verification-scan.json"
$reportPath = Join-Path $workspace "verification-report.json"
$configPath = Join-Path $workspace "test-config.json"
$scannerPath = Join-Path $PSScriptRoot "scan-tenant.ps1"
$comparatorPath = Join-Path $PSScriptRoot "compare-scans.ps1"

function Get-LiveTestConfiguration {
    return New-FdLockedLiveTestConfiguration `
        -AuthMode $AuthMode `
        -TenantId $TenantId `
        -ClientId $ClientId `
        -MaxSites $MaxSites `
        -MaxDrivesPerSite $MaxDrivesPerSite `
        -MaxItemsPerDrive $MaxItemsPerDrive `
        -MaxUsers $MaxUsers `
        -MaxGroups $MaxGroups `
        -MaxPermissionsPerSite $MaxPermissionsPerSite `
        -MaxGraphRequests $MaxGraphRequests
}

function Read-LiveTestConfiguration {
    if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
        throw "No baseline configuration exists at '$configPath'. Run -Phase Baseline first."
    }

    return Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
}

function Invoke-LiveTenantScan {
    param(
        [Parameter(Mandatory)]
        [string]$OutputPath,

        [Parameter(Mandatory)]
        $Configuration
    )

    $arguments = New-FdLiveTestScanArguments `
        -OutputPath $OutputPath `
        -Configuration $Configuration `
        -CertificateThumbprint $CertificateThumbprint

    & $scannerPath @arguments
}

if ($Phase -eq "Baseline") {
    [System.IO.Directory]::CreateDirectory($workspace) | Out-Null
    $configuration = Get-LiveTestConfiguration
    Invoke-LiveTenantScan -OutputPath $baselinePath -Configuration $configuration
    $configuration | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $configPath -Encoding utf8

    Write-Host ""
    Write-Host "Baseline captured: $baselinePath"
    Write-Host "Configuration locked: $configPath"
    Write-Host "Create or remediate a controlled exposure in a test-only SharePoint site, then run:"
    Write-Host ".\ai-flight-deck\scanner\test-live-tenant.ps1 -Phase Verification"
    exit 0
}

if ($Phase -eq "Verification") {
    if (-not (Test-Path -LiteralPath $baselinePath -PathType Leaf)) {
        throw "No baseline scan exists at '$baselinePath'. Run -Phase Baseline first."
    }

    $configuration = Read-LiveTestConfiguration
    Invoke-LiveTenantScan -OutputPath $verificationPath -Configuration $configuration

    Write-Host ""
    Write-Host "Verification captured with the locked baseline configuration: $verificationPath"
    Write-Host "Run the authoritative comparison:"
    Write-Host ".\ai-flight-deck\scanner\test-live-tenant.ps1 -Phase Compare"
    exit 0
}

if ($Phase -eq "Compare") {
    foreach ($requiredPath in @($baselinePath, $verificationPath)) {
        if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
            throw "Required scan does not exist: '$requiredPath'."
        }
    }

    & $comparatorPath `
        -BaselinePath $baselinePath `
        -VerificationPath $verificationPath `
        -OutputPath $reportPath

    Write-Host ""
    Write-Host "Authoritative verification report: $reportPath"
    Write-Host "Import '$reportPath' on the AI Flight Deck Decision page."
    exit 0
}

Write-Host "AI Flight Deck live tenant test workspace"
Write-Host "Workspace:    $workspace"
Write-Host "Baseline:     $(Test-Path -LiteralPath $baselinePath -PathType Leaf)"
Write-Host "Verification: $(Test-Path -LiteralPath $verificationPath -PathType Leaf)"
Write-Host "Report:       $(Test-Path -LiteralPath $reportPath -PathType Leaf)"
Write-Host "Configuration:$(Test-Path -LiteralPath $configPath -PathType Leaf)"
