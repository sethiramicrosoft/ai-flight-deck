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
    [string]$OutputPath,
    [int]$MaxSiteDetails = 200
)
$ErrorActionPreference = "Stop"
class AdminSyntheticHttpException : System.Exception {
    [int]$StatusCode
    AdminSyntheticHttpException([int]$status) : base("SENSITIVE_TEST_VALUE response/header/token") {
        $this.StatusCode = $status
    }
}
$global:adminTestCalls = [System.Collections.Generic.List[object]]::new()
$global:adminTestScenario = $Scenario
$global:adminTestConnected = $null
$global:adminTestInstalled = $false
$global:adminTestClockAdvanced = $false
$global:adminTestPurviewDisconnected = $false
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

function global:Get-Date {
    [CmdletBinding()]param()
    if ($global:adminTestClockAdvanced) { return [datetime]::Now.AddMinutes(15) }
    [datetime]::Now
}

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
        [switch]$Force, [switch]$AcceptLicense, [switch]$AllowClobber
    )
    $global:adminTestCalls.Add(@{
        command = "Install-Module"; name = $Name; scope = $Scope; repository = $Repository
        force = [bool]$Force; acceptLicense = [bool]$AcceptLicense; allowClobber = [bool]$AllowClobber
        confirm = [bool]$PSBoundParameters["Confirm"]
        tls12 = ([Net.ServicePointManager]::SecurityProtocol -band [Net.SecurityProtocolType]::Tls12) -ne 0
    })
    if ($global:adminTestScenario -eq "installFailure") { throw "SENSITIVE_TEST_VALUE" }
    if (-not $AllowClobber) {
        $record = [System.Management.Automation.ErrorRecord]::new(
            [Exception]::new("Synthetic existing package-management command collision."),
            "CommandAlreadyAvailable", [System.Management.Automation.ErrorCategory]::ResourceExists, $Name)
        $PSCmdlet.ThrowTerminatingError($record)
    }
    $global:adminTestInstalled = $true
}
function global:Get-Command {
    [CmdletBinding()]param([string]$Name, [string[]]$CommandType)
    if ($global:adminTestScenario -eq "missingCommand" -and $Name -eq "Get-HybridConfiguration") { return }
    if ($Name -eq "Search-UnifiedAuditLog" -and
        ($global:adminTestConnected -ne "exchangeOnline" -or $global:adminTestScenario -eq "auditCommandMissing")) { return }
    if ($global:adminTestScenario -eq "oldSpoApi" -and $Name -eq "Connect-SPOService") {
        return [pscustomobject]@{ Parameters = @{} }
    }
    Microsoft.PowerShell.Core\Get-Command -Name $Name -CommandType Function -ErrorAction Stop
}
function global:Get-ConnectionInformation {
    [CmdletBinding()]param()
    if (-not $global:adminTestConnected -and $global:adminTestScenario -ne "existingConnection") { return }
    $auditSession = $global:adminTestPurviewDisconnected -and $global:adminTestConnected -eq "exchangeOnline"
    $connection = [pscustomobject]@{
        State = if ($global:adminTestScenario -eq "inactive") { "Disconnected" } else { "Connected" }
        TokenStatus = "Active"
        IsEopSession = if ($global:adminTestScenario -eq "wrongSession" -or
            ($auditSession -and $global:adminTestScenario -eq "auditWrongSession")) { $true }
            else { $global:adminTestConnected -eq "purview" }
        UserPrincipalName = if ($global:adminTestScenario -eq "missingActor") { $null }
            elseif ($auditSession -and $global:adminTestScenario -eq "auditActorMismatch") { "other-admin@example.invalid" }
            else { "synthetic-admin@example.invalid" }
        ConnectionId = if ($auditSession) { "44444444-4444-4444-8444-444444444444" } else { "22222222-2222-4222-8222-222222222222" }
        TenantID = if ($global:adminTestScenario -eq "tenantMismatch" -or
            ($auditSession -and $global:adminTestScenario -eq "auditTenantMismatch")) {
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
    if ($global:adminTestPurviewDisconnected -and $global:adminTestScenario -in @("auditSignInFailure", "auditFailureWithPolicyWarning")) { throw "SENSITIVE_TEST_VALUE" }
    if ($global:adminTestPurviewDisconnected -and $global:adminTestScenario -eq "auditConditionalAccess") {
        throw "SENSITIVE_TEST_VALUE AADSTS53003: SENSITIVE_TEST_VALUE"
    }
    $global:adminTestConnected = "exchangeOnline"
}
function global:Connect-IPPSSession {
    [CmdletBinding()]param([switch]$ShowBanner, [switch]$DisableWAM)
    $global:adminTestCalls.Add(@{ command = "Connect-IPPSSession"; disableWAM = [bool]$DisableWAM })
    if ($global:adminTestScenario -in @("signInFailure", "signInAndDisconnectFailure")) { throw "SENSITIVE_TEST_VALUE" }
    if ($global:adminTestScenario -eq "authConditionalAccess") { throw "SENSITIVE_TEST_VALUE AADSTS53003: private response/header/token SENSITIVE_TEST_VALUE" }
    if ($global:adminTestScenario -eq "authConsent") { throw "SENSITIVE_TEST_VALUE AADSTS65001: private response/header/token SENSITIVE_TEST_VALUE" }
    if ($global:adminTestScenario -eq "authUnknownAadsts") { throw "SENSITIVE_TEST_VALUE AADSTS99999: private response/header/token SENSITIVE_TEST_VALUE" }
    if ($global:adminTestScenario -eq "authHttp401") { throw [AdminSyntheticHttpException]::new(401) }
    if ($global:adminTestScenario -eq "authCancelled") { throw [System.OperationCanceledException]::new("SENSITIVE_TEST_VALUE") }
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
    if ($global:adminTestConnected -eq "purview") { $global:adminTestPurviewDisconnected = $true }
    $global:adminTestConnected = $null
    if ($global:adminTestScenario -in @("disconnectFailure", "signInAndDisconnectFailure")) { throw "SENSITIVE_TEST_VALUE" }
}
function global:Disconnect-SPOService {
    [CmdletBinding()]param()
    $global:adminTestCalls.Add(@{ command = "Disconnect-SPOService" })
    $global:adminTestConnected = $null
    if ($global:adminTestScenario -eq "disconnectFailure") { throw "SENSITIVE_TEST_VALUE" }
}

# This deliberately narrow fixture produces a real PowerShell binding exception. It does not model
# or certify any tenant cmdlet's supported parameters, enum values, permissions, or licensing.
function global:Invoke-AdminSyntheticBinding {
    [CmdletBinding()]param([ValidateSet("SyntheticSupportedValue")][string]$ReportType)
}

foreach ($commandName in $global:adminTestCommandNames) {
    Set-Item -LiteralPath "Function:\global:$commandName" -Value {
        [CmdletBinding()]
        param(
            [object]$ResultSize, [string[]]$Properties,
            [datetime]$StartDate = [datetime]::MinValue, [datetime]$EndDate = [datetime]::MinValue,
            [string]$RecordType, [string]$ReportType, [string]$ReportEntity, [string]$Workload,
            [string]$Limit, [string]$Identity, [bool]$IncludePersonalSite, [string]$SyntheticCommandName
        )
        $command = if ($SyntheticCommandName) { $SyntheticCommandName } else { $MyInvocation.MyCommand.Name }
        $global:adminTestCalls.Add(@{
            command = $command; resultSize = $ResultSize; limit = $Limit; identity = $Identity
            reportType = $ReportType; reportEntity = $ReportEntity; workload = $Workload
            includePersonalSite = $IncludePersonalSite; recordType = $RecordType
            startDate = $StartDate.ToString("o"); endDate = $EndDate.ToString("o")
            connectionService = $global:adminTestConnected
        })
        if ($command -eq "Search-UnifiedAuditLog") {
            if ($global:adminTestConnected -ne "exchangeOnline") {
                throw [System.InvalidOperationException]::new("Synthetic audit calls require an Exchange Online session.")
            }
            if ($global:adminTestScenario -eq "auditReadFailure") {
                throw [System.UnauthorizedAccessException]::new("SENSITIVE_TEST_VALUE")
            }
            if ($global:adminTestScenario -eq "auditWarning") { Write-Warning "SENSITIVE_TEST_VALUE" }
        }
        if ($global:adminTestScenario -eq "allFailure") { throw "SENSITIVE_TEST_VALUE" }
        if ($global:adminTestScenario -eq "allDenied") {
            throw [System.UnauthorizedAccessException]::new("SENSITIVE_TEST_VALUE response/header/token")
        }
        if ($global:adminTestScenario -eq "parameterBinding" -and $command -eq "Get-SPODataAccessGovernanceInsight") {
            Invoke-AdminSyntheticBinding -ReportType "SENSITIVE_TEST_VALUE"
        }
        if ($global:adminTestScenario -eq "unsafeParameterName" -and $command -eq "Get-SPODataAccessGovernanceInsight") {
            Invoke-AdminSyntheticBinding -SENSITIVE_TEST_VALUE "SENSITIVE_TEST_VALUE"
        }
        if ($global:adminTestScenario -eq "missingConnection") {
            $record = [System.Management.Automation.ErrorRecord]::new(
                [Exception]::new("SENSITIVE_TEST_VALUE"), "SyntheticConnectionFailure",
                [System.Management.Automation.ErrorCategory]::ConnectionError, $null)
            $PSCmdlet.ThrowTerminatingError($record)
        }
        if ($global:adminTestScenario -eq "unlicensed") {
            $record = [System.Management.Automation.ErrorRecord]::new(
                [Exception]::new("SENSITIVE_TEST_VALUE"), "FeatureNotLicensed",
                [System.Management.Automation.ErrorCategory]::PermissionDenied, $null)
            $PSCmdlet.ThrowTerminatingError($record)
        }
        if ($global:adminTestScenario -eq "unsupported") { throw [System.NotSupportedException]::new("SENSITIVE_TEST_VALUE") }
        if ($global:adminTestScenario -eq "throttled") { throw [AdminSyntheticHttpException]::new(429) }
        if ($global:adminTestScenario -eq "http403") { throw [AdminSyntheticHttpException]::new(403) }
        if ($global:adminTestScenario -in @("allWarnings", "allWarningsEmpty")) {
            Write-Warning "SENSITIVE_TEST_VALUE token/private-url"
            if ($global:adminTestScenario -eq "allWarningsEmpty") { return }
        }
        if ($global:adminTestScenario -eq "reportWarningEmpty" -and $command -eq "Get-SPODataAccessGovernanceInsight") {
            Write-Warning "SENSITIVE_TEST_VALUE"
            return
        }
        if ($global:adminTestScenario -in @("labelPolicyWarning", "auditFailureWithPolicyWarning") -and $command -eq "Get-LabelPolicy") {
            Write-Warning "SENSITIVE_TEST_VALUE"
        }
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
        if ($command -eq "Get-SPOSite") {
            $detailFields = @(
                "AllowDownloadingNonWebViewableFiles", "AllowEditing", "AllowSelfServiceUpgrade",
                "AnonymousLinkExpirationInDays", "ConditionalAccessPolicy", "DefaultLinkPermission",
                "DefaultLinkToExistingAccess", "DefaultSharingLinkType", "DenyAddAndCustomizePages",
                "DisableCompanyWideSharingLinks", "ExternalUserExpirationInDays", "InformationSegment",
                "LimitedAccessFileType", "OverrideTenantAnonymousLinkExpirationPolicy",
                "OverrideTenantExternalUserExpirationPolicy", "PWAEnabled", "SandboxedCodeActivationCapability",
                "SensitivityLabel", "SharingAllowedDomainList", "SharingBlockedDomainList",
                "SharingCapability", "SharingDomainRestrictionMode"
            )
            if ($Identity) {
                if ($global:adminTestScenario -eq "siteDetailFailure" -and $Identity.EndsWith("/s2")) {
                    throw [System.UnauthorizedAccessException]::new("SENSITIVE_TEST_VALUE")
                }
                if ($global:adminTestScenario -eq "siteDetailWarning" -and $Identity.EndsWith("/s2")) {
                    Write-Warning "SENSITIVE_TEST_VALUE"
                }
                $row = [ordered]@{ Url = $Identity; Title = "Synthetic"; Template = "STS#3" }
                if ($global:adminTestScenario -eq "siteDetailMismatch") { $row.Url = "https://other.sharepoint.com/sites/wrong" }
                foreach ($field in $detailFields) { $row[$field] = "HYDRATED_VALUE" }
                if ($global:adminTestScenario -eq "siteMissingField") { $row.Remove("ConditionalAccessPolicy") }
                [pscustomobject]$row
                return
            }
            if ($global:adminTestScenario -in @("siteInventoryWarning", "siteObserved32")) {
                Write-Warning "SENSITIVE_TEST_VALUE"
            }
            if ($global:adminTestScenario -eq "siteDeadline") { $global:adminTestClockAdvanced = $true }
            $normalCount = if ($global:adminTestScenario -eq "siteObserved32") { 32 } else { 2 }
            $personalCount = if ($global:adminTestScenario -eq "siteObserved32") { 20 } else { 1 }
            if ($global:adminTestScenario -eq "siteInventoryCap") { $normalCount = 1000; $personalCount = 0 }
            for ($i = 1; $i -le $normalCount; $i++) {
                $row = [ordered]@{ Url = "https://synthetic.sharepoint.com/sites/s$i"; Title = "Synthetic"; Template = "STS#3" }
                foreach ($field in $detailFields) { $row[$field] = "LIST_DEFAULT_MUST_NOT_BE_ACCEPTED" }
                if ($global:adminTestScenario -eq "siteForeignInventory") { $row.Url = "https://other.sharepoint.com/sites/s$i" }
                [pscustomobject]$row
            }
            if ($IncludePersonalSite) {
                for ($i = 1; $i -le $personalCount; $i++) {
                    [pscustomobject]@{ Url = "https://synthetic-my.sharepoint.com/personal/p$i"; Title = "Synthetic personal"; Template = "SPSPERS#10" }
                }
            }
            return
        }
        [pscustomobject]@{ id = "synthetic-$command"; displayName = "Test Unicode $([char]0x2713)" }
    }
}

$global:adminTestSiteOperation = (Microsoft.PowerShell.Core\Get-Command Get-SPOSite -CommandType Function).ScriptBlock
function global:Get-SPOSite {
    [CmdletBinding(DefaultParameterSetName = "Inventory")]
    param(
        [Parameter(ParameterSetName = "Inventory")][string]$Limit,
        [Parameter(ParameterSetName = "Inventory")][bool]$IncludePersonalSite,
        [Parameter(Mandatory = $true, ParameterSetName = "Identity")][string]$Identity
    )
    & $global:adminTestSiteOperation -SyntheticCommandName "Get-SPOSite" -Limit $Limit `
        -IncludePersonalSite $IncludePersonalSite -Identity $Identity -ErrorAction Stop
}

$global:adminTestDagOperation = (Microsoft.PowerShell.Core\Get-Command Get-SPODataAccessGovernanceInsight -CommandType Function).ScriptBlock
# Documented DAG contract, checked against SPO 16.0.27612.12000. This validates invocation shape only,
# not availability, report contents, tenant authorization, or licensing.
function global:Get-SPODataAccessGovernanceInsight {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet("Everyone", "EveryoneExceptExternalUsers", "EveryoneExceptExternalUsersAtSite",
            "EveryoneExceptExternalUsersForItems", "PermissionedUsers", "PermissionsReport",
            "SensitivityLabelForFiles", "SharingLinks_Anyone", "SharingLinks_Guests", "SharingLinks_PeopleInYourOrg")]
        [string]$ReportEntity,
        [ValidateSet("Snapshot", "RecentActivity")]
        [string]$ReportType,
        [string]$Workload
    )
    & $global:adminTestDagOperation -SyntheticCommandName "Get-SPODataAccessGovernanceInsight" `
        -ReportEntity $ReportEntity -ReportType $ReportType -Workload $Workload -ErrorAction Stop
}

$dagContractChecks = @()
if ($Scenario -eq "dagContract") {
    foreach ($invalidType in @("SitePermissions", "OversharingBaseline")) {
        $rejected = $false
        try {
            Get-SPODataAccessGovernanceInsight -ReportEntity PermissionsReport -ReportType $invalidType -Workload SharePoint -ErrorAction Stop
        } catch {
            $rejected = $_.Exception -is [System.Management.Automation.ParameterBindingException]
        }
        $dagContractChecks += @{ legacyReportType = $invalidType; rejectedByBinding = $rejected }
    }
    $rejected = $false
    try {
        Get-SPODataAccessGovernanceInsight -ReportEntity UnsupportedEntity -ReportType Snapshot -Workload SharePoint -ErrorAction Stop
    } catch {
        $rejected = $_.Exception -is [System.Management.Automation.ParameterBindingException]
    }
    $dagContractChecks += @{ invalidReportEntity = "UnsupportedEntity"; rejectedByBinding = $rejected }
    $dagCommand = Microsoft.PowerShell.Core\Get-Command Get-SPODataAccessGovernanceInsight -CommandType Function
    $dagContractChecks += @{
        reportEntityMandatory = @($dagCommand.Parameters["ReportEntity"].Attributes |
            Where-Object { $_ -is [System.Management.Automation.ParameterAttribute] -and $_.Mandatory }).Count -eq 1
    }
}

$output = if ($OutputPath) { $OutputPath } else { Join-Path $WorkspacePath "result.json" }
if ($Scenario -eq "existingOutput") { [System.IO.File]::WriteAllText($output, '{"sentinel":true}') }
$parameters = @{
    TenantId = $ExpectedTenant; WorkspacePath = $WorkspacePath
    CollectionChallenge = $CollectionChallenge
    SharePointAdminUrl = $AdminUrl
    MaxSiteDetails = $MaxSiteDetails
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
    dagContractChecks = $dagContractChecks
}
Write-Output ("ADMIN_TEST_RESULT:" + ($result | ConvertTo-Json -Depth 8 -Compress))
