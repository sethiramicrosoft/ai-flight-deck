[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F-]{36}$')]
    [string]$TenantId,

    [Parameter(Mandatory = $true)]
    [string]$WorkspacePath,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9_-]{32,128}$')]
    [string]$CollectionChallenge,

    [string]$SharePointAdminUrl,

    [ValidateSet("exchangeOnline", "sharePointOnline", "purview")]
    [string[]]$Workloads = @("exchangeOnline", "sharePointOnline", "purview")
)

$ErrorActionPreference = "Stop"
$evidence = [ordered]@{}
$errors = [ordered]@{}

function Add-Evidence {
    param(
        [Parameter(Mandatory = $true)][string]$Service,
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(Mandatory = $true)][scriptblock]$Operation,
        [string]$EvidenceKey
    )

    $key = if ($EvidenceKey) {
        "${Service}:${Command}:${EvidenceKey}"
    }
    else {
        "${Service}:${Command}"
    }
    try {
        $value = @(& $Operation)
        $evidence[$key] = $value
    }
    catch {
        $errors[$key] = [ordered]@{
            code = if ($_.FullyQualifiedErrorId) { $_.FullyQualifiedErrorId } else { "COMMAND_FAILED" }
            message = $_.Exception.Message
        }
    }
}

function Assert-Module {
    param([Parameter(Mandatory = $true)][string]$Name)
    if (-not (Get-Module -ListAvailable -Name $Name)) {
        throw "Required module '$Name' is not installed. Install it for CurrentUser, then run this collector again."
    }
}

New-Item -ItemType Directory -Path $WorkspacePath -Force | Out-Null
$actorId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$now = Get-Date

if ($Workloads -contains "exchangeOnline" -or $Workloads -contains "purview") {
    Assert-Module -Name "ExchangeOnlineManagement"
    Import-Module ExchangeOnlineManagement -ErrorAction Stop
}

if ($Workloads -contains "exchangeOnline") {
    Connect-ExchangeOnline -ShowBanner:$false
    try {
        Add-Evidence exchangeOnline Get-EXOMailbox {
            Get-EXOMailbox -ResultSize Unlimited `
                -Properties ExternalDirectoryObjectId,PrimarySmtpAddress,RecipientTypeDetails
        }
        Add-Evidence exchangeOnline Get-HybridConfiguration { Get-HybridConfiguration }
        Add-Evidence exchangeOnline Get-OrganizationRelationship { Get-OrganizationRelationship }
        Add-Evidence exchangeOnline Get-RemoteDomain { Get-RemoteDomain }
        Add-Evidence exchangeOnline Get-EXOMailboxPermission {
            Get-EXOMailboxPermission -ResultSize Unlimited
        }
        Add-Evidence exchangeOnline Get-EXORecipientPermission {
            Get-EXORecipientPermission -ResultSize Unlimited
        }
        Add-Evidence exchangeOnline Get-TransportRule { Get-TransportRule }
        Add-Evidence exchangeOnline Get-MessageTraceV2 {
            Get-MessageTraceV2 -StartDate $now.AddDays(-7) -EndDate $now
        }
        Add-Evidence exchangeOnline Get-SafeLinksPolicy { Get-SafeLinksPolicy }
        Add-Evidence exchangeOnline Get-SafeAttachmentPolicy { Get-SafeAttachmentPolicy }
        Add-Evidence exchangeOnline Get-AntiPhishPolicy { Get-AntiPhishPolicy }
    }
    finally {
        Disconnect-ExchangeOnline -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
    }
}

if ($Workloads -contains "sharePointOnline") {
    if (-not $SharePointAdminUrl) {
        throw "-SharePointAdminUrl is required when collecting SharePoint Online evidence."
    }
    Assert-Module -Name "Microsoft.Online.SharePoint.PowerShell"
    Import-Module Microsoft.Online.SharePoint.PowerShell -ErrorAction Stop
    Connect-SPOService -Url $SharePointAdminUrl
    Add-Evidence sharePointOnline Get-SPODataAccessGovernanceInsight {
        Get-SPODataAccessGovernanceInsight -ReportType SitePermissions
    } siteAccessReport
    Add-Evidence sharePointOnline Get-SPODataAccessGovernanceInsight {
        Get-SPODataAccessGovernanceInsight -ReportType OversharingBaseline
    } dataAccessGovernance
    Add-Evidence sharePointOnline Get-SPOTenantRestrictedSearchMode {
        Get-SPOTenantRestrictedSearchMode
    }
    Add-Evidence sharePointOnline Get-SPOTenantRestrictedSearchAllowedList {
        Get-SPOTenantRestrictedSearchAllowedList
    }
    Add-Evidence sharePointOnline Get-SPOSite {
        Get-SPOSite -Limit All -Detailed
    } restrictedContent
    Add-Evidence sharePointOnline Get-SPOSite {
        Get-SPOSite -Limit All -Detailed
    } siteLifecycle
    Add-Evidence sharePointOnline Get-SPOSite {
        Get-SPOSite -IncludePersonalSite $true -Limit All -Detailed
    } oneDriveOverrides
}

if ($Workloads -contains "purview") {
    Connect-IPPSSession
    try {
        Add-Evidence purview Get-LabelPolicy { Get-LabelPolicy }
        Add-Evidence purview Get-AutoSensitivityLabelPolicy {
            Get-AutoSensitivityLabelPolicy
        } autoLabelPolicies
        Add-Evidence purview Get-AutoSensitivityLabelPolicy {
            Get-AutoSensitivityLabelPolicy
        } autoLabelReport
        Add-Evidence purview Get-DlpCompliancePolicy { Get-DlpCompliancePolicy }
        Add-Evidence purview Get-DlpComplianceRule { Get-DlpComplianceRule }
        Add-Evidence purview Get-AdminAuditLogConfig { Get-AdminAuditLogConfig }
        Add-Evidence purview Search-UnifiedAuditLog {
            Search-UnifiedAuditLog -StartDate $now.AddDays(-1) -EndDate $now `
                -RecordType CopilotInteraction -ResultSize 5000
        }
        Add-Evidence purview Get-RetentionCompliancePolicy {
            Get-RetentionCompliancePolicy
        }
        Add-Evidence purview Get-ComplianceTag { Get-ComplianceTag }
        Add-Evidence purview Get-ComplianceCase { Get-ComplianceCase }
        Add-Evidence purview Get-CaseHoldPolicy { Get-CaseHoldPolicy }
        Add-Evidence purview Get-InsiderRiskPolicy { Get-InsiderRiskPolicy }
        Add-Evidence purview Get-SupervisoryReviewPolicyV2 {
            Get-SupervisoryReviewPolicyV2
        }
    }
    finally {
        Disconnect-ExchangeOnline -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
    }
}

$document = [ordered]@{
    schema = "ai-flight-deck/admin-evidence"
    version = "1.0.0"
    producerId = "ai-flight-deck/admin-evidence-collector"
    producerVersion = "1.0.0"
    collectionChallenge = $CollectionChallenge
    tenantId = $TenantId.ToLowerInvariant()
    actorId = $actorId
    producedAt = (Get-Date).ToUniversalTime().ToString("o")
    workloads = @($Workloads)
    evidence = $evidence
    errors = $errors
}

$timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$outputPath = Join-Path $WorkspacePath "admin-evidence.$timestamp.json"
$document | ConvertTo-Json -Depth 20 |
    Set-Content -LiteralPath $outputPath -Encoding UTF8
Write-Host "Administrator evidence package created: $outputPath"
Write-Host "Import this package in AI Flight Deck before running the tenant scan."
