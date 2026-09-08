# Synthetic-only regression harness. Every workload/module operation is replaced before the collector runs.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$CollectorPath,
    [Parameter(Mandatory = $true)][string]$WorkspacePath,
    [string]$Scenario = "success",
    [string]$Workload = "exchangeOnline",
    [string]$AdminUrl = "https://synthetic-admin.sharepoint.com",
    [string]$ExpectedTenant = "11111111-1111-4111-8111-111111111111",
    [string]$CollectionChallenge = "synthetic_challenge_0123456789_abcdefghijklmnop",
    [string]$OutputPath
)
$ErrorActionPreference = "Stop"
$global:adminTestCalls = [System.Collections.Generic.List[object]]::new()
$global:adminTestScenario = $Scenario
$global:adminTestConnected = $null
$global:adminTestInstalled = $false
$global:adminTestWorkload = $Workload
$global:adminTestTenant = "11111111-1111-4111-8111-111111111111"
$originalSecurityProtocol = [Net.ServicePointManager]::SecurityProtocol
$global:adminTestCommandNames = @(
    "Get-EXOMailbox", "Get-HybridConfiguration", "Get-OrganizationRelationship", "Get-RemoteDomain",
    "Get-EXOMailboxPermission", "Get-EXORecipientPermission", "Get-TransportRule", "Get-MessageTraceV2",
    "Get-SafeLinksPolicy", "Get-SafeAttachmentPolicy", "Get-AntiPhishPolicy",
    "Get-SPODataAccessGovernanceInsight", "Get-SPOTenantRestrictedSearchMode",
    "Get-SPOTenantRestrictedSearchAllowedList", "Get-SPOSite", "Get-LabelPolicy",
    "Get-AutoSensitivityLabelPolicy", "Get-DlpCompliancePolicy", "Get-DlpComplianceRule",
    "Get-AdminAuditLogConfig", "Search-UnifiedAuditLog", "Get-RetentionCompliancePolicy",
    "Get-ComplianceTag", "Get-ComplianceCase", "Get-CaseHoldPolicy", "Get-InsiderRiskPolicy",
    "Get-SupervisoryReviewPolicyV2"
)

function global:Get-Module {
    [CmdletBinding()]param([string]$Name, [switch]$ListAvailable)
    $global:adminTestCalls.Add(@{ command = "Get-Module"; name = $Name })
    if ($global:adminTestScenario -in @("moduleMissing", "install", "installFailure", "galleryHijacked") -and
        -not $global:adminTestInstalled) { return }
    [pscustomobject]@{
        Name = $Name
        Version = if ($Name -eq "ExchangeOnlineManagement") { [version]"3.7.2" } else { [version]"16.0.26000.0" }
        Path = "$Name.psd1"
    }
}
function global:Import-Module {
    [CmdletBinding()]param([string]$Name, [switch]$UseWindowsPowerShell)
    $global:adminTestCalls.Add(@{ command = "Import-Module"; name = $Name; compatibility = [bool]$UseWindowsPowerShell })
}
function global:Get-PSRepository {
    [CmdletBinding()]param([string]$Name)
    [pscustomobject]@{ SourceLocation = if ($global:adminTestScenario -eq "galleryHijacked") {
        "https://not-a-gallery.invalid/api/v2"
    } else { "https://www.powershellgallery.com/api/v2" } }
}
function global:Get-PackageProvider {
    [CmdletBinding()]param([string]$Name, [switch]$ListAvailable)
}
function global:Install-PackageProvider {
    [CmdletBinding(SupportsShouldProcess)]param([string]$Name, [version]$MinimumVersion, [string]$Scope, [switch]$Force)
    $global:adminTestCalls.Add(@{ command = "Install-PackageProvider"; name = $Name; scope = $Scope; force = [bool]$Force })
}
function global:Install-Module {
    [CmdletBinding(SupportsShouldProcess)]param(
        [string]$Name, [version]$MinimumVersion, [string]$Scope, [string]$Repository,
        [switch]$Force, [switch]$AcceptLicense
    )
    $global:adminTestCalls.Add(@{
        command = "Install-Module"; name = $Name; scope = $Scope; repository = $Repository
        force = [bool]$Force; acceptLicense = [bool]$AcceptLicense; confirm = [bool]$PSBoundParameters["Confirm"]
        tls12 = ([Net.ServicePointManager]::SecurityProtocol -band [Net.SecurityProtocolType]::Tls12) -ne 0
    })
    if ($global:adminTestScenario -eq "installFailure") { throw "SENSITIVE_TEST_VALUE" }
    $global:adminTestInstalled = $true
}
function global:Get-Command {
    [CmdletBinding()]param([string]$Name, [string[]]$CommandType)
    if ($global:adminTestScenario -eq "missingCommand" -and $Name -eq "Get-HybridConfiguration") { return }
    if ($global:adminTestScenario -eq "oldSpoApi" -and $Name -eq "Connect-SPOService") {
        return [pscustomobject]@{ Parameters = @{} }
    }
    Microsoft.PowerShell.Core\Get-Command -Name $Name -CommandType Function -ErrorAction Stop
}
function global:Get-ConnectionInformation {
    [CmdletBinding()]param()
    if (-not $global:adminTestConnected -and $global:adminTestScenario -ne "existingConnection") { return }
    $connection = [pscustomobject]@{
        State = if ($global:adminTestScenario -eq "inactive") { "Disconnected" } else { "Connected" }
        TokenStatus = "Active"
        IsEopSession = if ($global:adminTestScenario -eq "wrongSession") { $true } else { $global:adminTestConnected -eq "purview" }
        UserPrincipalName = if ($global:adminTestScenario -eq "missingActor") { $null } else { "synthetic-admin@example.invalid" }
        ConnectionId = "22222222-2222-4222-8222-222222222222"
        TenantID = if ($global:adminTestScenario -eq "tenantMismatch") {
            "33333333-3333-4333-8333-333333333333"
        } elseif ($global:adminTestScenario -eq "missingTenant") { $null } else { $global:adminTestTenant }
    }
    $connection
    if ($global:adminTestScenario -eq "ambiguous") { $connection }
}
function global:Connect-ExchangeOnline {
    [CmdletBinding()]param([switch]$ShowBanner, [switch]$DisableWAM)
    $global:adminTestCalls.Add(@{ command = "Connect-ExchangeOnline"; disableWAM = [bool]$DisableWAM })
    if ($global:adminTestScenario -in @("signInFailure", "signInAndDisconnectFailure")) { throw "SENSITIVE_TEST_VALUE" }
    $global:adminTestConnected = "exchangeOnline"
}
function global:Connect-IPPSSession {
    [CmdletBinding()]param([switch]$ShowBanner, [switch]$DisableWAM)
    $global:adminTestCalls.Add(@{ command = "Connect-IPPSSession"; disableWAM = [bool]$DisableWAM })
    if ($global:adminTestScenario -in @("signInFailure", "signInAndDisconnectFailure")) { throw "SENSITIVE_TEST_VALUE" }
    $global:adminTestConnected = "purview"
}
function global:Connect-SPOService {
    [CmdletBinding()]param([string]$Url, [bool]$UseSystemBrowser)
    $global:adminTestCalls.Add(@{ command = "Connect-SPOService"; url = $Url; useSystemBrowser = $UseSystemBrowser })
    if ($global:adminTestScenario -eq "signInFailure") { throw "SENSITIVE_TEST_VALUE" }
    $global:adminTestConnected = "sharePointOnline"
}
function global:Disconnect-ExchangeOnline {
    [CmdletBinding(SupportsShouldProcess)]param()
    $global:adminTestCalls.Add(@{ command = "Disconnect-ExchangeOnline" })
    $global:adminTestConnected = $null
    if ($global:adminTestScenario -in @("disconnectFailure", "signInAndDisconnectFailure")) { throw "SENSITIVE_TEST_VALUE" }
}
function global:Disconnect-SPOService {
    [CmdletBinding()]param()
    $global:adminTestCalls.Add(@{ command = "Disconnect-SPOService" })
    $global:adminTestConnected = $null
    if ($global:adminTestScenario -eq "disconnectFailure") { throw "SENSITIVE_TEST_VALUE" }
}

foreach ($commandName in $global:adminTestCommandNames) {
    Set-Item -LiteralPath "Function:\global:$commandName" -Value {
        [CmdletBinding()]
        param(
            [object]$ResultSize, [string[]]$Properties,
            [datetime]$StartDate = [datetime]::MinValue, [datetime]$EndDate = [datetime]::MinValue,
            [string]$RecordType, [string]$ReportType, [string]$Limit, [switch]$Detailed, [bool]$IncludePersonalSite
        )
        $command = $MyInvocation.MyCommand.Name
        $global:adminTestCalls.Add(@{
            command = $command; resultSize = $ResultSize; limit = $Limit; detailed = [bool]$Detailed
            reportType = $ReportType; includePersonalSite = $IncludePersonalSite; recordType = $RecordType
            startDate = $StartDate.ToString("o"); endDate = $EndDate.ToString("o")
        })
        if ($global:adminTestScenario -eq "allFailure") { throw "SENSITIVE_TEST_VALUE" }
        if ($global:adminTestScenario -eq "information") {
            Write-Host "SENSITIVE_TEST_VALUE"
            Write-Information "SENSITIVE_TEST_VALUE" -InformationAction Continue
        }
        if ($command -eq "Get-HybridConfiguration") {
            if ($global:adminTestScenario -eq "partialFailure") {
                [pscustomobject]@{ id = "partial-must-not-survive" }
                Write-Error "SENSITIVE_TEST_VALUE"
            }
            if ($global:adminTestScenario -eq "accessDenied") { throw [System.UnauthorizedAccessException]::new("SENSITIVE_TEST_VALUE") }
            if ($global:adminTestScenario -eq "warning") { Write-Warning "SENSITIVE_TEST_VALUE" }
        }
        if (($command -eq "Get-MessageTraceV2" -or $command -eq "Search-UnifiedAuditLog") -and
            $global:adminTestScenario -eq "limit") {
            for ($i = 0; $i -lt 5000; $i++) { [pscustomobject]@{ id = $i } }
            return
        }
        if ($global:adminTestScenario -eq "empty") { return }
        [pscustomobject]@{ id = "synthetic-$command"; displayName = "Test Unicode $([char]0x2713)" }
    }
}

$output = if ($OutputPath) { $OutputPath } else { Join-Path $WorkspacePath "result.json" }
if ($Scenario -eq "existingOutput") { [System.IO.File]::WriteAllText($output, '{"sentinel":true}') }
$parameters = @{
    TenantId = $ExpectedTenant; WorkspacePath = $WorkspacePath
    CollectionChallenge = $CollectionChallenge
    SharePointAdminUrl = $AdminUrl
    Workloads = if ($Workload -eq "all") { @("exchangeOnline", "sharePointOnline", "purview") } else { @($Workload) }
}
if ($Scenario -ne "manual") { $parameters.OutputPath = $output }
if ($Scenario -in @("install", "installFailure", "galleryHijacked")) { $parameters.InstallMissingModules = $true }
$failure = $null
try { & $CollectorPath @parameters }
catch { $failure = $_.Exception.Message }
$result = @{
    failure = $failure
    calls = @($global:adminTestCalls.ToArray())
    files = @(Get-ChildItem -LiteralPath $WorkspacePath -Filter "*.json" | ForEach-Object { $_.Name })
    outputExists = [System.IO.File]::Exists($output)
    psEdition = $PSVersionTable.PSEdition
    securityProtocolRestored = [Net.ServicePointManager]::SecurityProtocol -eq $originalSecurityProtocol
}
Write-Output ("ADMIN_TEST_RESULT:" + ($result | ConvertTo-Json -Depth 8 -Compress))
