[CmdletBinding()]
param(
    [string]$TenantId,

    [string]$WorkspacePath,

    [string]$CollectionChallenge,

    [string]$SharePointAdminUrl,

    [string]$OutputPath,

    [switch]$InstallMissingModules,

    [ValidateRange(0, 1000)]
    [int]$MaxSiteDetails = 200,

    [ValidateSet("exchangeOnline", "sharePointOnline", "purview")]
    [string[]]$Workloads = @("exchangeOnline", "sharePointOnline", "purview")
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$VerbosePreference = "SilentlyContinue"
$DebugPreference = "SilentlyContinue"
$evidence = [ordered]@{}
$observations = [ordered]@{}
$errors = [ordered]@{}
$commandResults = [ordered]@{}
$connections = [ordered]@{}
$workloadResults = [ordered]@{}
$moduleVersions = [ordered]@{}
$cleanupErrors = [System.Collections.Generic.List[object]]::new()
$now = (Get-Date).ToUniversalTime()
$siteInventoryLimit = 1000
$siteInventoryCache = @{}
$siteDetailCache = @{}
$siteDetailReads = 0
$siteDetailDeadline = $now.AddMinutes(14)
# Microsoft documents these fields as unpopulated/default-valued with Get-SPOSite -Limit or -Filter.
$siteDetailFields = @(
    "AllowDownloadingNonWebViewableFiles", "AllowEditing", "AllowSelfServiceUpgrade",
    "AnonymousLinkExpirationInDays", "ConditionalAccessPolicy", "DefaultLinkPermission",
    "DefaultLinkToExistingAccess", "DefaultSharingLinkType", "DenyAddAndCustomizePages",
    "DisableCompanyWideSharingLinks", "ExternalUserExpirationInDays", "InformationSegment",
    "LimitedAccessFileType", "OverrideTenantAnonymousLinkExpirationPolicy",
    "OverrideTenantExternalUserExpirationPolicy", "PWAEnabled", "SandboxedCodeActivationCapability",
    "SensitivityLabel", "SharingAllowedDomainList", "SharingBlockedDomainList", "SharingCapability",
    "SharingDomainRestrictionMode"
)
$failureCode = "INPUT_INVALID"
$failureMessage = "Provide TenantId, WorkspacePath, and CollectionChallenge."
$appMode = -not [string]::IsNullOrWhiteSpace($OutputPath)

function Get-SafeCollectorDiagnostic {
    param(
        [System.Management.Automation.ErrorRecord]$Record,
        [string]$DefaultCode,
        [string]$DefaultMessage
    )
    $diagnostic = [ordered]@{ code = $DefaultCode; message = $DefaultMessage }
    $parameterNames = @("Identity", "ResultSize", "Properties", "StartDate", "EndDate", "RecordType",
        "ReportType", "ReportEntity", "ReportID", "Workload", "Limit", "Detailed", "IncludePersonalSite",
        "ShowBanner", "DisableWAM", "Url", "UseSystemBrowser", "ErrorAction")
    $errorId = ([string]$Record.FullyQualifiedErrorId -split ',', 2)[0]
    $category = [string]$Record.CategoryInfo.Category
    $binding = $errorId -in @("NamedParameterNotFound", "ParameterBindingException",
        "ParameterArgumentValidationError", "ParameterArgumentTransformationError",
        "MissingMandatoryParameter", "AmbiguousParameterSet", "PositionalParameterNotFound")
    $unavailable = $errorId -eq "CommandNotFoundException"
    $accessDenied = $category -in @("PermissionDenied", "SecurityError") -or
        $errorId -in @("AccessDenied", "Unauthorized", "Forbidden", "UnauthorizedAccessException")
    $connectionUnavailable = $category -eq "ConnectionError" -or
        $errorId -in @("NoConnection", "NotConnected", "PSSessionStateBroken", "PSSessionNotAvailable")
    $unsupported = $category -eq "NotImplemented"
    $unlicensed = $errorId -in @("LicenseRequired", "FeatureNotLicensed", "SubscriptionNotLicensed")
    $cancelled = $false
    $parameter = $null
    $aadsts = $null
    $httpStatus = $null
    $exception = $Record.Exception
    # Inspect only bounded exception chains. Raw service text is never returned, redacted, or serialized.
    for ($depth = 0; $null -ne $exception -and $depth -lt 8; $depth++) {
        if ($exception -is [System.Management.Automation.ParameterBindingException]) {
            $binding = $true
            $parameter = @($parameterNames | Where-Object { $_ -eq $exception.ParameterName } | Select-Object -First 1)
        }
        if ($exception -is [System.Management.Automation.CommandNotFoundException]) { $unavailable = $true }
        if ($exception -is [System.UnauthorizedAccessException]) { $accessDenied = $true }
        if ($exception -is [System.Management.Automation.Remoting.PSRemotingTransportException]) { $connectionUnavailable = $true }
        if ($exception -is [System.NotSupportedException]) { $unsupported = $true }
        if ($exception -is [System.OperationCanceledException]) { $cancelled = $true }
        if (-not $aadsts) {
            $text = [string]$exception.Message
            $match = [regex]::Match($text.Substring(0, [Math]::Min(16384, $text.Length)),
                '(?i)(?<![a-z0-9])AADSTS(?<code>[0-9]{5,9})(?![0-9])')
            if ($match.Success) { $aadsts = $match.Groups["code"].Value }
        }
        $statusValue = $null
        if ($exception.PSObject.Properties["StatusCode"]) { $statusValue = $exception.StatusCode }
        elseif ($exception.PSObject.Properties["Response"] -and $null -ne $exception.Response -and
            $exception.Response.PSObject.Properties["StatusCode"]) { $statusValue = $exception.Response.StatusCode }
        $numericStatus = 0
        if ($statusValue -is [System.Net.HttpStatusCode]) { $numericStatus = [int]$statusValue }
        elseif ($null -ne $statusValue) { [int]::TryParse([string]$statusValue, [ref]$numericStatus) | Out-Null }
        if ($numericStatus -in @(400, 401, 403, 404, 408, 409, 429, 500, 502, 503, 504)) { $httpStatus = $numericStatus }
        $exception = $exception.InnerException
    }

    if ($binding) {
        $diagnostic.code = "COMMAND_PARAMETER_BINDING"
        $diagnostic.message = "The collector invocation does not match the installed command's parameter contract; this is not evidence of a tenant configuration problem."
        if ($null -ne $parameter -and @($parameter).Count -eq 1 -and $parameter[0]) {
            $diagnostic.parameter = $parameter[0]
            $diagnostic.message += " Parameter: $($parameter[0])."
        }
    } elseif ($unavailable) {
        $diagnostic.code = "COMMAND_UNAVAILABLE"
        $diagnostic.message = "The installed module or assigned role does not expose this command."
    } elseif ($aadsts) {
        switch ($aadsts) {
            { $_ -in @("53000", "53001", "53002", "53003") } {
                $diagnostic.code = "AUTH_CONDITIONAL_ACCESS"
                $diagnostic.message = "Microsoft Entra blocked authentication under a device or Conditional Access requirement."
            }
            { $_ -in @("65001", "65004") } {
                $diagnostic.code = "AUTH_CONSENT_REQUIRED"
                $diagnostic.message = "Microsoft Entra reported missing or declined application consent; the required consent must be reviewed by an authorized administrator."
            }
            { $_ -in @("50076", "50079", "50158", "50058") } {
                $diagnostic.code = "AUTH_INTERACTION_REQUIRED"
                $diagnostic.message = "Microsoft Entra requires an additional authentication interaction or challenge that this connection did not complete."
            }
            { $_ -in @("70043", "700082", "700084") } {
                $diagnostic.code = "AUTHENTICATION_REQUIRED"
                $diagnostic.message = "Microsoft Entra reported an expired authentication session; a new workload connection is required."
            }
            "50105" {
                $diagnostic.code = "COMMAND_ACCESS_DENIED"
                $diagnostic.message = "Microsoft Entra denied access because the required application assignment is missing."
            }
            default {
                $diagnostic.message = "Microsoft Entra returned an authentication error; its specific cause is not classified."
            }
        }
        $diagnostic.aadstsCode = $aadsts
        $diagnostic.message += " AADSTS$aadsts."
    } elseif ($httpStatus -eq 429 -or $category -eq "LimitsExceeded") {
        $diagnostic.code = "COMMAND_THROTTLED"
        $diagnostic.message = "The service rejected the request because of throttling or a request limit; retry after the service permits it."
    } elseif ($httpStatus -eq 401 -or $category -eq "AuthenticationError") {
        $diagnostic.code = "AUTHENTICATION_REQUIRED"
        $diagnostic.message = "The service did not accept the workload authentication; a valid workload connection is required."
    } elseif ($unlicensed) {
        $diagnostic.code = "FEATURE_NOT_LICENSED"
        $diagnostic.message = "The service explicitly reported a missing license for this feature."
    } elseif ($httpStatus -eq 403 -or $accessDenied) {
        $diagnostic.code = "COMMAND_ACCESS_DENIED"
        $diagnostic.message = "Access to the requested operation was denied. The available error does not identify which permission or policy caused the denial."
    } elseif ($connectionUnavailable) {
        $diagnostic.code = "CONNECTION_UNAVAILABLE"
        $diagnostic.message = "The workload connection or session transport is unavailable; this command did not return usable evidence."
    } elseif ($unsupported) {
        $diagnostic.code = "FEATURE_UNSUPPORTED"
        $diagnostic.message = "The requested operation is not supported by the current service or module."
    } elseif ($httpStatus -in @(408, 500, 502, 503, 504)) {
        $diagnostic.code = "SERVICE_REQUEST_FAILED"
        $diagnostic.message = "The service returned a timeout or server-side request failure; no result was accepted."
    } elseif ($cancelled) {
        $diagnostic.code = "OPERATION_CANCELLED"
        $diagnostic.message = "The workload operation reported cancellation; the initiating cause is not known."
    }
    if ($null -ne $httpStatus) {
        $diagnostic.httpStatus = $httpStatus
        $diagnostic.message += " HTTP $httpStatus."
    }
    return $diagnostic
}

function Get-CommandBoundary {
    param([string]$Command, [string]$EvidenceKey)
    $boundary = [ordered]@{
        coverageComplete = $false
        pagination = "cmdlet-default"
        resultLimit = $null
        startDate = $null
        endDate = $null
        exclusions = @("Results are limited by the connected account's RBAC scope, licensing, and service availability.")
        note = "A successful command is not proof of complete tenant coverage; service defaults and server-side limits apply."
    }
    switch ($Command) {
        { $_ -in @("Get-EXOMailbox", "Get-EXOMailboxPermission", "Get-EXORecipientPermission") } {
            $boundary.pagination = "module-managed"
            $boundary.note = "ResultSize Unlimited requested; module-managed paging within the connected account's visible scope."
        }
        "Get-SPOSite" {
            $boundary.pagination = "bounded-inventory-with-cached-identity-details"
            $boundary.inventoryLimit = $siteInventoryLimit
            $boundary.maxSiteDetails = $MaxSiteDetails
            $boundary.detailSelection = "First distinct approved site URLs in service-returned inventory order; the budget is shared across all three query keys."
            $boundary.detailDeadlineAt = $siteDetailDeadline.ToString("o")
            $boundary.note = "At most 1000 inventory rows per scope; at most MaxSiteDetails distinct identity reads across this process. List defaults are not configuration evidence. Other geographies and deleted sites are excluded."
        }
        "Get-MessageTraceV2" {
            $boundary.pagination = "single-query-no-continuation"
            $boundary.resultLimit = 5000
            $boundary.startDate = $now.AddDays(-7).ToString("o")
            $boundary.endDate = $now.ToString("o")
            $boundary.note = "Seven-day bounded sample, at most 5000 rows. No StartingRecipientAddress/EndDate continuation; not a complete mail-flow history."
        }
        "Search-UnifiedAuditLog" {
            $boundary.pagination = "single-query-no-continuation"
            $boundary.resultLimit = 5000
            $boundary.startDate = $now.AddDays(-1).ToString("o")
            $boundary.endDate = $now.ToString("o")
            $boundary.note = "One-day CopilotInteraction sample, at most 5000 rows; no session paging. Audit ingestion delay and record-type filtering exclude other activity."
        }
        "Get-SPODataAccessGovernanceInsight" {
            $boundary.workload = "SharePoint"
            $boundary.pagination = "existing-report-metadata-only"
            if ($EvidenceKey -eq "siteAccessReport") {
                $boundary.reportEntity = "PermissionsReport"
                $boundary.reportType = "Snapshot"
                $boundary.note = "Reads existing SharePoint PermissionsReport snapshot metadata, not detailed site permissions. Does not create, refresh, or export reports; report age, licensing, and report availability limit results."
                $boundary.exclusions += @("Detailed site/item permission rows and report contents are not retrieved.", "Other report entities and workloads are not queried.")
            } else {
                $boundary.reportEntity = "EveryoneExceptExternalUsersForItems"
                $boundary.reportType = "RecentActivity"
                $boundary.note = "Reads existing SharePoint recent-activity report metadata for the EveryoneExceptExternalUsersForItems entity only. This is not complete oversharing coverage; no report is created, refreshed, or exported."
                $boundary.exclusions += @("Other sharing audiences, report entities, workloads, and historical activity are not queried.", "Detailed report contents are not retrieved.")
            }
        }
    }
    return $boundary
}

function Get-SafeWarningSummary {
    param([string]$Command, [int]$Count, [string]$Source = "command")
    if ($Count -eq 0) { return }
    $code = switch ($Command) {
        "Get-SPOSite" { "SPO_SITE_QUERY_WARNING" }
        "Get-SPODataAccessGovernanceInsight" { "SPO_REPORT_QUERY_WARNING" }
        "Get-LabelPolicy" { "PURVIEW_LABEL_POLICY_WARNING" }
        default { "COMMAND_WARNING" }
    }
    # No warning text is forwarded. No informational signature has yet been verified safe to promote.
    [ordered]@{
        code = $code
        message = "The source emitted an unclassified warning. Returned rows are observations only; they do not establish configuration or complete coverage."
        count = $Count
        sourceCount = 1
        source = $Source
        disposition = "observations-only"
    }
}

function Get-BoundSiteUrl {
    param([object]$Value, [bool]$IncludePersonalSite)
    $text = [string]$Value
    $uri = $null
    if ($text.Length -gt 2048 -or $text.Contains('\') -or
        -not [uri]::TryCreate($text, [UriKind]::Absolute, [ref]$uri)) { return $null }
    $tenantHost = ([uri]$SharePointAdminUrl).Host -replace '-admin\.sharepoint\.com$', ''
    $allowedHosts = @("$tenantHost.sharepoint.com")
    if ($IncludePersonalSite) { $allowedHosts += "$tenantHost-my.sharepoint.com" }
    if ($uri.Scheme -ne "https" -or $uri.Port -ne 443 -or $uri.UserInfo -or $uri.Query -or
        $uri.Fragment -or $uri.Host -notin $allowedHosts) { return $null }
    return $uri.AbsoluteUri.TrimEnd('/')
}

function ConvertTo-SiteInventoryObservation {
    param([object]$Row, [string]$Url)
    # Only identity/inventory fields survive an unhydrated or warning-bearing site read.
    $projected = [ordered]@{ Url = $Url }
    foreach ($name in @("Title", "Template")) {
        if ($Row.PSObject.Properties[$name]) { $projected[$name] = $Row.$name }
    }
    [pscustomobject]$projected
}

function Invoke-BoundedSpoRead {
    param([hashtable]$Parameters, [string]$Source)
    try {
        $returned = @(Get-SPOSite @Parameters -ErrorAction Stop 3>&1 4>$null 5>$null 6>$null)
        $warningRecords = @($returned | Where-Object { $_ -is [System.Management.Automation.WarningRecord] })
        [pscustomobject]@{
            rows = @($returned | Where-Object { $_ -isnot [System.Management.Automation.WarningRecord] })
            warnings = @(Get-SafeWarningSummary -Command "Get-SPOSite" -Count $warningRecords.Count -Source $Source)
            error = $null
        }
    } catch {
        [pscustomobject]@{
            rows = @()
            warnings = @()
            error = Get-SafeCollectorDiagnostic -Record $_ -DefaultCode "COMMAND_FAILED" `
                -DefaultMessage "The site read failed; its underlying cause is unavailable."
        }
    }
}

function Get-BoundedSpoSiteEvidence {
    param([bool]$IncludePersonalSite = $false)
    $cacheKey = if ($IncludePersonalSite) { "including-personal" } else { "standard" }
    $newInventoryRead = -not $siteInventoryCache.ContainsKey($cacheKey)
    $inventoryReadCount = 0
    if ($newInventoryRead) {
        if ((Get-Date).ToUniversalTime() -ge $siteDetailDeadline) {
            $siteInventoryCache[$cacheKey] = [pscustomobject]@{
                rows = @(); warnings = @()
                error = @{ code = "SITE_COLLECTION_DEADLINE"; message = "The site acquisition deadline was reached before this inventory scope could be read." }
            }
        } else {
            $inventoryReadCount = 1
            $siteInventoryCache[$cacheKey] = Invoke-BoundedSpoRead `
                -Parameters @{ Limit = [string]$siteInventoryLimit; IncludePersonalSite = $IncludePersonalSite } -Source "inventory"
        }
    }
    $inventory = $siteInventoryCache[$cacheKey]
    $rows = [System.Collections.Generic.List[object]]::new()
    $safeWarnings = [System.Collections.Generic.List[object]]::new()
    foreach ($warning in $inventory.warnings) { $safeWarnings.Add($warning) }
    $gaps = [System.Collections.Generic.List[object]]::new()
    if ($inventory.error) { $gaps.Add($inventory.error) }
    if ($inventory.rows.Count -ge $siteInventoryLimit) {
        $gaps.Add(@{ code = "SITE_INVENTORY_LIMIT"; message = "The bounded site inventory reached its row limit; tenant-wide coverage has not been established." })
    }
    $hydrated = 0
    $unhydrated = 0
    $invalidIdentities = 0
    $detailReadsBefore = $script:siteDetailReads
    $cacheHits = 0
    $budgetSkipped = 0
    $deadlineSkipped = 0
    $seen = @{}
    foreach ($site in @($inventory.rows | Select-Object -First $siteInventoryLimit)) {
        $url = Get-BoundSiteUrl -Value $site.Url -IncludePersonalSite $IncludePersonalSite
        if (-not $url) {
            $invalidIdentities++
            continue
        }
        if ($seen.ContainsKey($url)) { continue }
        $seen[$url] = $true
        if ($siteDetailCache.ContainsKey($url)) {
            $cacheHits++
        } elseif ($script:siteDetailReads -lt $MaxSiteDetails -and
            (Get-Date).ToUniversalTime() -lt $siteDetailDeadline) {
            $script:siteDetailReads++
            # Identity reads must never include Limit, Filter, or the deprecated Detailed switch.
            $siteDetailCache[$url] = Invoke-BoundedSpoRead -Parameters @{ Identity = $url } -Source "identity"
        } else {
            if ($script:siteDetailReads -ge $MaxSiteDetails) { $budgetSkipped++ }
            else { $deadlineSkipped++ }
        }
        $detail = if ($siteDetailCache.ContainsKey($url)) { $siteDetailCache[$url] } else { $null }
        $validDetail = $false
        if ($null -ne $detail) {
            foreach ($warning in $detail.warnings) { $safeWarnings.Add($warning) }
            if ($detail.error) {
                $gaps.Add($detail.error)
            } elseif ($detail.rows.Count -ne 1 -or
                (Get-BoundSiteUrl -Value $detail.rows[0].Url -IncludePersonalSite $IncludePersonalSite) -ne $url) {
                $gaps.Add(@{ code = "SITE_IDENTITY_MISMATCH"; message = "A detail result did not match the requested site identity within the approved SharePoint target. That detail result was rejected." })
            } elseif ($detail.warnings.Count -eq 0) {
                $missing = @($siteDetailFields | Where-Object { -not $detail.rows[0].PSObject.Properties[$_] })
                if ($missing.Count -eq 0) { $validDetail = $true }
                else { $gaps.Add(@{ code = "SITE_DETAIL_FIELDS_UNAVAILABLE"; message = "The identity read did not expose all required site configuration fields. Missing fields are not interpreted as default settings." }) }
            }
        }
        if ($validDetail) {
            $hydrated++
            $rows.Add($detail.rows[0])
        } else {
            $unhydrated++
            $rows.Add((ConvertTo-SiteInventoryObservation -Row $site -Url $url))
        }
    }
    if ($invalidIdentities -gt 0) {
        $gaps.Add(@{ code = "SITE_IDENTITY_UNBOUND"; message = "Inventory included site identities outside the approved SharePoint target or with an invalid URL. No detail reads were issued for those identities." })
    }
    if ($budgetSkipped -gt 0 -or $deadlineSkipped -gt 0) {
        $gaps.Add(@{ code = "SITE_DETAIL_LIMIT"; message = "The process-wide site detail budget or deadline was reached. Remaining inventory rows are observations, not site configuration evidence." })
    }
    $uniqueGaps = [ordered]@{}
    foreach ($gap in $gaps) {
        if (-not $uniqueGaps.Contains($gap.code)) { $uniqueGaps[$gap.code] = $gap }
    }
    $warningCount = 0
    foreach ($warning in $safeWarnings) { $warningCount += $warning.count }
    $completeWithinQuery = $gaps.Count -eq 0 -and $warningCount -eq 0 -and $unhydrated -eq 0
    [pscustomobject]@{
        rows = @($rows.ToArray())
        warnings = @($safeWarnings.ToArray())
        gaps = @($uniqueGaps.Values)
        accepted = $completeWithinQuery
        metadata = [ordered]@{
            inventoryRowCount = [Math]::Min($inventory.rows.Count, $siteInventoryLimit)
            inventoryReadCount = $inventoryReadCount
            detailReadCount = $script:siteDetailReads - $detailReadsBefore
            detailCacheHitCount = $cacheHits
            detailBudgetSkippedCount = $budgetSkipped
            detailDeadlineSkippedCount = $deadlineSkipped
            hydratedRowCount = $hydrated
            unhydratedRowCount = $unhydrated
            rejectedIdentityCount = $invalidIdentities
            includePersonalSite = $IncludePersonalSite
            fieldAvailability = [ordered]@{
                mode = if ($completeWithinQuery) { "identity-details" } else { "observations-only" }
                inventoryFields = @("Url", "Title", "Template")
                identityDetailRequiredFields = $siteDetailFields
                notCollected = @(if ($unhydrated -gt 0 -or $invalidIdentities -gt 0) { $siteDetailFields })
                note = "Listed configuration fields require identity reads. Inventory defaults are removed; observations must not be used as configuration evidence even if some identity reads succeeded."
            }
        }
    }
}

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
    $started = (Get-Date).ToUniversalTime()
    $boundary = Get-CommandBoundary -Command $Command -EvidenceKey $EvidenceKey
    $result = [ordered]@{
        command = $Command
        service = $Service
        status = "failed"
        acquisitionStatus = "failed"
        code = $null
        rowCount = 0
        acceptedRowCount = 0
        observationRowCount = 0
        warningCount = 0
        warningSourceCount = 0
        warnings = @()
        gaps = @()
        startedAt = $started.ToString("o")
        completedAt = $null
        boundary = $boundary
    }
    $commandFailureCode = "COMMAND_FAILED"
    $commandFailureMessage = "The command failed; the underlying cause is unavailable. No result was accepted."
    $closeAuditConnection = $false
    try {
        if ($Service -eq "purview" -and $Command -eq "Search-UnifiedAuditLog") {
            $result.connectionService = "exchangeOnline"
            Write-Host "Purview audit data uses Exchange Online authentication"
            $commandFailureCode = "AUDIT_SESSION_NOT_ISOLATED"
            $commandFailureMessage = "The supplemental audit session could not be isolated from an existing workload connection. Audit evidence was not read."
            if (@(Get-ConnectionInformation -ErrorAction Stop).Count -ne 0) { throw "AUDIT_SESSION_NOT_ISOLATED" }
            $commandFailureCode = "SIGN_IN_FAILED"
            $commandFailureMessage = "The supplemental Exchange Online connection for Purview audit data could not be established; the underlying cause is unavailable."
            $closeAuditConnection = $true
            Connect-ExchangeOnline -ShowBanner:$false -DisableWAM -ErrorAction Stop *> $null
            try {
                $auditConnection = Assert-Connection -Service "exchangeOnline" -PassThru
            } catch {
                $commandFailureCode = $script:failureCode
                $commandFailureMessage = $script:failureMessage
                throw
            }
            $commandFailureCode = "ACTOR_MISMATCH"
            $commandFailureMessage = "The supplemental audit connection uses a different account from the verified Purview connection. Audit evidence was not read."
            if ($auditConnection.actorId -ne $connections["purview"].actorId) { throw "ACTOR_MISMATCH" }
            $auditConnection.connectionService = "exchangeOnline"
            $connections["purview"].auditConnection = $auditConnection
            $commandFailureCode = "COMMAND_FAILED"
            $commandFailureMessage = "The audit command failed in the verified Exchange Online session; the underlying cause is unavailable. No result was accepted."
        }
        if (-not (Get-Command -Name $Command -CommandType Cmdlet,Function -ErrorAction SilentlyContinue)) {
            if ($Service -eq "exchangeOnline" -and $Command -eq "Get-HybridConfiguration") {
                $errors[$key] = @{
                    code = "ON_PREMISES_SOURCE_UNAVAILABLE"
                    message = "Get-HybridConfiguration is an on-premises Exchange command, not available from this Exchange Online connection. Hybrid configuration remains unresolved; changing cloud roles does not supply this source."
                }
            } else {
                $errors[$key] = @{ code = "COMMAND_UNAVAILABLE"; message = "The installed module or assigned role does not expose this command." }
            }
            return
        }
        # Unknown warnings are preserved as safe classifications, never silently promoted to accepted evidence.
        $returned = @(& $Operation 3>&1 4>$null 5>$null 6>$null)
        $warnings = @($returned | Where-Object { $_ -is [System.Management.Automation.WarningRecord] })
        $value = @($returned | Where-Object { $_ -isnot [System.Management.Automation.WarningRecord] })
        $siteResult = $null
        if ($Command -eq "Get-SPOSite") {
            $siteResult = $value[0]
            $value = @($siteResult.rows)
            $result.warnings = @($siteResult.warnings)
            $result.gaps = @($siteResult.gaps)
            $result.siteDetails = $siteResult.metadata
        } else {
            $result.warnings = @(Get-SafeWarningSummary -Command $Command -Count $warnings.Count)
        }
        $result.rowCount = $value.Count
        foreach ($warning in $result.warnings) {
            $result.warningCount += $warning.count
            $result.warningSourceCount += $warning.sourceCount
        }
        if ($result.warningCount -gt 0 -or ($null -ne $siteResult -and -not $siteResult.accepted)) {
            if ($result.warningCount -gt 0) { $result.acquisitionStatus = "partial" }
            if ($value.Count -gt 0) { $observations[$key] = $value }
            $errors[$key] = if ($result.gaps.Count -gt 0) { $result.gaps[0] } else {
                @{ code = "COMMAND_WARNING"; message = "The source returned warnings. Available rows are retained as observations only; configuration and complete coverage remain unresolved." }
            }
            return
        }
        if ($null -ne $boundary.resultLimit -and $value.Count -ge $boundary.resultLimit) {
            $observations[$key] = $value
            $errors[$key] = @{ code = "RESULT_LIMIT_REACHED"; message = "The bounded query reached its result limit. Truncated results are not accepted as complete evidence." }
            return
        }
        $evidence[$key] = $value
        $result.status = "succeeded"
        $result.acceptedRowCount = $value.Count
        $result.acquisitionStatus = "collected"
    }
    catch {
        $errors[$key] = Get-SafeCollectorDiagnostic -Record $_ -DefaultCode $commandFailureCode `
            -DefaultMessage $commandFailureMessage
    }
    finally {
        if ($closeAuditConnection) { Close-CollectorConnection -Service "purview" }
        if ($errors.Contains($key)) {
            $result.code = $errors[$key].code
            if ($observations.Contains($key)) {
                $result.observationRowCount = @($observations[$key]).Count
                $result.acquisitionStatus = "partial"
            } elseif ($result.code -in @("COMMAND_UNAVAILABLE", "ON_PREMISES_SOURCE_UNAVAILABLE", "FEATURE_UNSUPPORTED", "FEATURE_NOT_LICENSED")) {
                $result.acquisitionStatus = "unavailable"
            }
        }
        $result.completedAt = (Get-Date).ToUniversalTime().ToString("o")
        $commandResults[$key] = $result
    }
}

function Get-AcquisitionRowCounts {
    $accepted = 0
    $observed = 0
    foreach ($entry in $commandResults.Values) {
        $accepted += $entry.acceptedRowCount
        $observed += $entry.observationRowCount
    }
    return @{ accepted = $accepted; observed = $observed }
}

function Import-CollectorModule {
    param([string]$Name, [version]$MinimumVersion)
    if ($Name -notin @("ExchangeOnlineManagement", "Microsoft.Online.SharePoint.PowerShell")) {
        throw "MODULE_NOT_ALLOWED"
    }
    $script:failureCode = "MODULE_DISCOVERY_FAILED"
    $script:failureMessage = "Could not inspect required module $Name."
    $available = @(Get-Module -ListAvailable -Name $Name | Where-Object { $_.Version -ge $MinimumVersion } |
        Sort-Object Version -Descending)
    if ($available.Count -eq 0) {
        $script:failureCode = "MODULE_MISSING"
        $script:failureMessage = "Required module $Name (minimum $MinimumVersion) is unavailable. Enable InstallMissingModules for automatic CurrentUser installation."
        if (-not $InstallMissingModules) { throw "MODULE_MISSING" }
        Write-Host "Installing required module $Name for CurrentUser..."
        $script:failureCode = "MODULE_INSTALL_FAILED"
        $script:failureMessage = "Automatic CurrentUser installation of $Name failed. Check PowerShell Gallery access and local package-management availability."
        # Force accepts this install only; never change repository trust or machine execution policy.
        $repository = Get-PSRepository -Name PSGallery -ErrorAction Stop
        if ($repository.SourceLocation.TrimEnd('/') -ne "https://www.powershellgallery.com/api/v2") {
            throw "UNEXPECTED_GALLERY_SOURCE"
        }
        $originalSecurityProtocol = [Net.ServicePointManager]::SecurityProtocol
        try {
            # Older Windows PowerShell hosts can otherwise negotiate TLS 1.0 with the Gallery.
            # This setting is process-local and restored; no machine policy or repository trust changes.
            [Net.ServicePointManager]::SecurityProtocol = $originalSecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
            if (-not (Get-PackageProvider -Name NuGet -ListAvailable -ErrorAction SilentlyContinue |
                Where-Object { $_.Version -ge [version]"2.8.5.201" })) {
                Install-PackageProvider -Name NuGet -MinimumVersion "2.8.5.201" -Scope CurrentUser `
                    -Force -Confirm:$false -ErrorAction Stop *> $null
            }
            $installParameters = @{
                Name = $Name
                MinimumVersion = $MinimumVersion
                Repository = "PSGallery"
                Scope = "CurrentUser"
                Force = $true
                AllowClobber = $true
                Confirm = $false
                ErrorAction = "Stop"
            }
            if ((Get-Command Install-Module -ErrorAction Stop).Parameters.ContainsKey("AcceptLicense")) {
                $installParameters.AcceptLicense = $true
            }
            try {
                Install-Module @installParameters *> $null
            } catch {
                if ($_.FullyQualifiedErrorId -match "CommandAlreadyAvailable") {
                    $script:failureCode = "MODULE_COMMAND_CONFLICT"
                    $script:failureMessage = "A Microsoft module dependency conflicts with existing package-management commands. Automatic installation must allow the approved dependency updates."
                }
                throw
            }
        } finally {
            [Net.ServicePointManager]::SecurityProtocol = $originalSecurityProtocol
        }
        $available = @(Get-Module -ListAvailable -Name $Name | Where-Object { $_.Version -ge $MinimumVersion } |
            Sort-Object Version -Descending)
        if ($available.Count -eq 0) { throw "MODULE_INSTALL_NOT_FOUND" }
    }
    $script:failureCode = "MODULE_IMPORT_FAILED"
    $script:failureMessage = "Required module $Name could not be loaded in this PowerShell host."
    if ($Name -eq "Microsoft.Online.SharePoint.PowerShell" -and $PSVersionTable.PSEdition -eq "Core") {
        # Microsoft documents Windows PowerShell compatibility import for the SPO management shell.
        if (-not $IsWindows) { throw "SHAREPOINT_REQUIRES_WINDOWS" }
        Import-Module -Name $available[0].Path -UseWindowsPowerShell -ErrorAction Stop *> $null
    } else {
        Import-Module -Name $available[0].Path -ErrorAction Stop *> $null
    }
    $moduleVersions[$Name] = $available[0].Version.ToString()
}

function Assert-Connection {
    param([string]$Service, [switch]$PassThru)
    $script:failureCode = "CONNECTION_IDENTITY_UNVERIFIED"
    $script:failureMessage = "The connected workload tenant and actor could not be verified."
    $active = @(Get-ConnectionInformation -ErrorAction Stop)
    if ($active.Count -ne 1) { throw "AMBIGUOUS_CONNECTION" }
    $connection = $active[0]
    $isPurview = $Service -eq "purview"
    if ($connection.State -ne "Connected" -or $connection.TokenStatus -ne "Active" -or
        $connection.IsEopSession -isnot [bool] -or $connection.IsEopSession -ne $isPurview -or
        [string]::IsNullOrWhiteSpace([string]$connection.UserPrincipalName) -or
        [string]::IsNullOrWhiteSpace([string]$connection.ConnectionId)) {
        throw "CONNECTION_IDENTITY_UNVERIFIED"
    }
    $observedTenant = [guid]::Empty
    if (-not [guid]::TryParse([string]$connection.TenantID, [ref]$observedTenant)) {
        throw "CONNECTION_TENANT_UNAVAILABLE"
    }
    if ($observedTenant -ne [guid]$TenantId) {
        $script:failureCode = "TENANT_MISMATCH"
        $script:failureMessage = "The signed-in workload tenant does not match the application tenant. No evidence was collected."
        throw "TENANT_MISMATCH"
    }
    # Only selected supported connection properties are persisted, never tokens or the entire connection object.
    $verifiedConnection = [ordered]@{
        basis = "Get-ConnectionInformation"
        expectedTenantId = $TenantId
        observedTenantId = $observedTenant.ToString()
        actorId = [string]$connection.UserPrincipalName
        actorBasis = "Get-ConnectionInformation.UserPrincipalName"
        connectionId = [string]$connection.ConnectionId
        tenantVerified = $true
    }
    if ($PassThru) { return $verifiedConnection }
    $connections[$Service] = $verifiedConnection
}

function Close-CollectorConnection {
    param([string]$Service)
    try {
        if ($Service -eq "sharePointOnline") {
            Disconnect-SPOService -ErrorAction Stop *> $null
        } else {
            Disconnect-ExchangeOnline -Confirm:$false -ErrorAction Stop *> $null
        }
    } catch {
        $cleanupErrors.Add(@{ service = $Service; code = "DISCONNECT_FAILED"; message = "Workload disconnect failed; the application must terminate this dedicated collector process." })
        Write-Warning "Workload disconnect failed; the dedicated collector process must exit."
    }
}

try {
    $parsedTenant = [guid]::Empty
    if ($TenantId -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' -or
        -not [guid]::TryParse($TenantId, [ref]$parsedTenant) -or $parsedTenant -eq [guid]::Empty -or
        [string]::IsNullOrWhiteSpace($WorkspacePath) -or
        $CollectionChallenge -cnotmatch '^[A-Za-z0-9_-]{32,128}$' -or @($Workloads).Count -eq 0) {
        throw "INPUT_INVALID"
    }
    $TenantId = $parsedTenant.ToString()
    $Workloads = @($Workloads | Select-Object -Unique)
    $WorkspacePath = [System.IO.Path]::GetFullPath($WorkspacePath)
    if ($WorkspacePath.StartsWith("\\") -or $WorkspacePath.StartsWith("//")) { throw "LOCAL_PATH_REQUIRED" }
    if (-not $appMode) {
        $OutputPath = Join-Path $WorkspacePath ("admin-evidence.{0}.json" -f [guid]::NewGuid().ToString("N"))
    }
    $OutputPath = [System.IO.Path]::GetFullPath($OutputPath)
    if ($OutputPath.StartsWith("\\") -or $OutputPath.StartsWith("//") -or
        [System.IO.Path]::GetExtension($OutputPath) -ne ".json") { throw "LOCAL_JSON_PATH_REQUIRED" }
    $failureCode = "OUTPUT_PATH_INVALID"
    $failureMessage = "OutputPath must be a new local JSON file in a writable directory."
    # A run never overwrites another run's output or imports an old package after sign-in failure.
    if (Test-Path -LiteralPath $OutputPath) { throw "OUTPUT_ALREADY_EXISTS" }
    [System.IO.Directory]::CreateDirectory($WorkspacePath) | Out-Null
    [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($OutputPath)) | Out-Null
    if ($Workloads -contains "sharePointOnline") {
        $failureCode = "SHAREPOINT_ADMIN_URL_INVALID"
        $failureMessage = "SharePoint collection requires the application's Graph-bound HTTPS tenant-admin.sharepoint.com root URL."
        if ($SharePointAdminUrl -notmatch '^https://[a-z0-9](?:[a-z0-9-]{0,55}[a-z0-9])?-admin\.sharepoint\.com/?$') {
            throw "SHAREPOINT_ADMIN_URL_INVALID"
        }
        $SharePointAdminUrl = ([uri]$SharePointAdminUrl).GetLeftPart([System.UriPartial]::Authority)
    }

if ($Workloads -contains "exchangeOnline" -or $Workloads -contains "purview") {
    Import-CollectorModule -Name "ExchangeOnlineManagement" -MinimumVersion "3.7.2"
    $failureCode = "EXISTING_CONNECTION"
    $failureMessage = "Run the collector in a dedicated PowerShell process without pre-existing Exchange or Purview connections."
    if (@(Get-ConnectionInformation -ErrorAction Stop).Count -ne 0) { throw "EXISTING_CONNECTION" }
}

if ($Workloads -contains "exchangeOnline") {
    try {
        $failureCode = "SIGN_IN_FAILED"
        $failureMessage = "The Exchange Online connection could not be established; the underlying cause is unavailable."
        Write-Host "Signing in to Exchange Online..."
        Connect-ExchangeOnline -ShowBanner:$false -DisableWAM -ErrorAction Stop *> $null
        Assert-Connection "exchangeOnline"
        Add-Evidence exchangeOnline Get-EXOMailbox {
            Get-EXOMailbox -ResultSize Unlimited `
                -Properties ExternalDirectoryObjectId,PrimarySmtpAddress,RecipientTypeDetails -ErrorAction Stop
        }
        Add-Evidence exchangeOnline Get-HybridConfiguration { Get-HybridConfiguration -ErrorAction Stop }
        Add-Evidence exchangeOnline Get-OrganizationRelationship { Get-OrganizationRelationship -ErrorAction Stop }
        Add-Evidence exchangeOnline Get-RemoteDomain { Get-RemoteDomain -ErrorAction Stop }
        Add-Evidence exchangeOnline Get-EXOMailboxPermission {
            Get-EXOMailboxPermission -ResultSize Unlimited -ErrorAction Stop
        }
        Add-Evidence exchangeOnline Get-EXORecipientPermission {
            Get-EXORecipientPermission -ResultSize Unlimited -ErrorAction Stop
        }
        Add-Evidence exchangeOnline Get-TransportRule { Get-TransportRule -ErrorAction Stop }
        Add-Evidence exchangeOnline Get-MessageTraceV2 {
            Get-MessageTraceV2 -StartDate $now.AddDays(-7) -EndDate $now -ResultSize 5000 -ErrorAction Stop
        }
        Add-Evidence exchangeOnline Get-SafeLinksPolicy { Get-SafeLinksPolicy -ErrorAction Stop }
        Add-Evidence exchangeOnline Get-SafeAttachmentPolicy { Get-SafeAttachmentPolicy -ErrorAction Stop }
        Add-Evidence exchangeOnline Get-AntiPhishPolicy { Get-AntiPhishPolicy -ErrorAction Stop }
    }
    finally {
        Close-CollectorConnection "exchangeOnline"
    }
}

if ($Workloads -contains "sharePointOnline") {
    Import-CollectorModule -Name "Microsoft.Online.SharePoint.PowerShell" -MinimumVersion "16.0.0.0"
    $failureCode = "MODULE_API_UNAVAILABLE"
    $failureMessage = "The SharePoint module must expose Connect-SPOService -UseSystemBrowser for browser/MFA sign-in."
    if (-not (Get-Command Connect-SPOService -ErrorAction Stop).Parameters.ContainsKey("UseSystemBrowser")) {
        throw "MODULE_API_UNAVAILABLE"
    }
    try {
    $failureCode = "SIGN_IN_FAILED"
    $failureMessage = "The SharePoint Online connection could not be established; the underlying cause is unavailable."
    Write-Host "Signing in to SharePoint Online..."
    Connect-SPOService -Url $SharePointAdminUrl -UseSystemBrowser $true -ErrorAction Stop *> $null
    $connections["sharePointOnline"] = [ordered]@{
        basis = "Connect-SPOService admin URL; caller must bind URL to Graph tenant root"
        expectedTenantId = $TenantId
        observedTenantId = $null
        actorId = $null
        actorBasis = "Not exposed by supported SPO connection APIs"
        adminUrl = $SharePointAdminUrl
        tenantVerified = $false
        targetConnected = $true
    }
    Add-Evidence sharePointOnline Get-SPODataAccessGovernanceInsight {
        Get-SPODataAccessGovernanceInsight -ReportEntity PermissionsReport -ReportType Snapshot -Workload SharePoint -ErrorAction Stop
    } siteAccessReport
    Add-Evidence sharePointOnline Get-SPODataAccessGovernanceInsight {
        Get-SPODataAccessGovernanceInsight -ReportEntity EveryoneExceptExternalUsersForItems -ReportType RecentActivity -Workload SharePoint -ErrorAction Stop
    } dataAccessGovernance
    Add-Evidence sharePointOnline Get-SPOTenantRestrictedSearchMode {
        Get-SPOTenantRestrictedSearchMode -ErrorAction Stop
    }
    Add-Evidence sharePointOnline Get-SPOTenantRestrictedSearchAllowedList {
        Get-SPOTenantRestrictedSearchAllowedList -ErrorAction Stop
    }
    Add-Evidence sharePointOnline Get-SPOSite {
        Get-BoundedSpoSiteEvidence
    } restrictedContent
    Add-Evidence sharePointOnline Get-SPOSite {
        Get-BoundedSpoSiteEvidence
    } siteLifecycle
    Add-Evidence sharePointOnline Get-SPOSite {
        Get-BoundedSpoSiteEvidence -IncludePersonalSite $true
    } oneDriveOverrides
    }
    finally {
        Close-CollectorConnection "sharePointOnline"
    }
}

if ($Workloads -contains "purview") {
    try {
        $failureCode = "SIGN_IN_FAILED"
        $failureMessage = "The Purview connection could not be established; the underlying cause is unavailable."
        Write-Host "Signing in to Purview..."
        Connect-IPPSSession -ShowBanner:$false -DisableWAM -ErrorAction Stop *> $null
        Assert-Connection "purview"
        Add-Evidence purview Get-LabelPolicy { Get-LabelPolicy -ErrorAction Stop }
        Add-Evidence purview Get-AutoSensitivityLabelPolicy {
            Get-AutoSensitivityLabelPolicy -ErrorAction Stop
        } autoLabelPolicies
        Add-Evidence purview Get-AutoSensitivityLabelPolicy {
            Get-AutoSensitivityLabelPolicy -ErrorAction Stop
        } autoLabelReport
        Add-Evidence purview Get-DlpCompliancePolicy { Get-DlpCompliancePolicy -ErrorAction Stop }
        Add-Evidence purview Get-DlpComplianceRule { Get-DlpComplianceRule -ErrorAction Stop }
        Add-Evidence purview Get-AdminAuditLogConfig { Get-AdminAuditLogConfig -ErrorAction Stop }
        Add-Evidence purview Get-RetentionCompliancePolicy {
            Get-RetentionCompliancePolicy -ErrorAction Stop
        }
        Add-Evidence purview Get-ComplianceTag { Get-ComplianceTag -ErrorAction Stop }
        Add-Evidence purview Get-ComplianceCase { Get-ComplianceCase -ErrorAction Stop }
        Add-Evidence purview Get-CaseHoldPolicy { Get-CaseHoldPolicy -ErrorAction Stop }
        Add-Evidence purview Get-InsiderRiskPolicy { Get-InsiderRiskPolicy -ErrorAction Stop }
        Add-Evidence purview Get-SupervisoryReviewPolicyV2 {
            Get-SupervisoryReviewPolicyV2 -ErrorAction Stop
        }
    }
    finally {
        Close-CollectorConnection "purview"
    }
    Add-Evidence purview Search-UnifiedAuditLog {
        Search-UnifiedAuditLog -StartDate $now.AddDays(-1) -EndDate $now `
            -RecordType CopilotInteraction -ResultSize 5000 -ErrorAction Stop
    }
}

$failedWorkloads = @()
foreach ($workload in $Workloads) {
    $results = @($commandResults.Values | Where-Object { $_.service -eq $workload })
    $succeeded = @($results | Where-Object { $_.status -eq "succeeded" }).Count
    $partial = @($results | Where-Object { $_.acquisitionStatus -eq "partial" }).Count
    $acceptedRows = 0
    $observedRows = 0
    foreach ($result in $results) {
        $acceptedRows += $result.acceptedRowCount
        $observedRows += $result.observationRowCount
    }
    $workloadResults[$workload] = [ordered]@{
        status = if ($succeeded -eq $results.Count) { "succeeded" } elseif ($succeeded -gt 0 -or $observedRows -gt 0) { "partial" } else { "failed" }
        attemptedCommandCount = $results.Count
        succeededCommandCount = $succeeded
        failedCommandCount = $results.Count - $succeeded
        partialCommandCount = $partial
        acceptedRowCount = $acceptedRows
        observationRowCount = $observedRows
        coverageComplete = $false
    }
    if ($succeeded -eq 0 -and $observedRows -eq 0) {
        $failedWorkloads += $workload
    }
}
if ($failedWorkloads.Count -gt 0) {
    $failureCode = "WORKLOAD_COLLECTION_FAILED"
    $failureMessage = "One or more workloads returned neither accepted evidence nor observational rows. No package was written."
    throw "WORKLOAD_COLLECTION_FAILED"
}
$actors = @($connections.Values | ForEach-Object { $_.actorId } | Where-Object { $_ } | Select-Object -Unique)
$rowCounts = Get-AcquisitionRowCounts
$document = [ordered]@{
    schema = "ai-flight-deck/admin-evidence"
    version = "1.0.0"
    producerId = "ai-flight-deck/admin-evidence-collector"
    producerVersion = "1.1.0"
    collectionChallenge = $CollectionChallenge
    tenantId = $TenantId.ToLowerInvariant()
    actorId = if ($actors.Count -eq 1) { $actors[0] } else { $null }
    producedAt = (Get-Date).ToUniversalTime().ToString("o")
    workloads = @($Workloads)
    evidence = $evidence
    observations = $observations
    errors = $errors
    connections = $connections
    commandResults = $commandResults
    workloadResults = $workloadResults
    collection = [ordered]@{
        startedAt = $now.ToString("o")
        attemptedCommandCount = $commandResults.Count
        succeededCommandCount = $evidence.Count
        failedCommandCount = $errors.Count
        partialCommandCount = @($commandResults.Values | Where-Object { $_.acquisitionStatus -eq "partial" }).Count
        acceptedRowCount = $rowCounts.accepted
        observationRowCount = $rowCounts.observed
        coverageComplete = $false
        excludedWorkloads = @(@("exchangeOnline", "sharePointOnline", "purview") | Where-Object { $_ -notin $Workloads })
        modules = $moduleVersions
        cleanupErrors = @($cleanupErrors.ToArray())
        limitations = @(
            "Read-only collection does not prove review, approval, remediation, or full tenant coverage.",
            "Commercial Microsoft 365 endpoints only. Other clouds and SharePoint geographies are not automatically discovered.",
            "Per-command boundaries apply even when all attempted commands succeed."
        )
    }
}

$failureCode = "OUTPUT_WRITE_FAILED"
$failureMessage = "The administrator evidence JSON could not be written."
$json = $document | ConvertTo-Json -Depth 50 -WarningAction Stop
$bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($json)
$outputCreated = $false
try {
    $stream = [System.IO.File]::Open($OutputPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    $outputCreated = $true
    try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush() }
    finally { $stream.Dispose() }
} catch {
    if ($outputCreated) { [System.IO.File]::Delete($OutputPath) }
    throw
}
Write-Host "Administrator evidence collection finished."
if (-not $appMode) { Write-Host "Administrator evidence package created: $OutputPath" }
} catch {
    $rowCounts = Get-AcquisitionRowCounts
    $diagnostic = Get-SafeCollectorDiagnostic -Record $_ -DefaultCode $failureCode -DefaultMessage $failureMessage
    $issues = @($errors.Keys | Select-Object -First 31 | ForEach-Object {
        [ordered]@{ resource = $_; code = $errors[$_].code; message = $errors[$_].message }
    })
    $outcomes = [ordered]@{}
    foreach ($key in @($commandResults.Keys | Select-Object -First 31)) {
        $outcome = $commandResults[$key]
        $outcomes[$key] = [ordered]@{
            status = $outcome.status
            acquisitionStatus = $outcome.acquisitionStatus
            code = $outcome.code
            rowCount = $outcome.rowCount
            acceptedRowCount = $outcome.acceptedRowCount
            observationRowCount = $outcome.observationRowCount
            warningCount = $outcome.warningCount
            warnings = $outcome.warnings
        }
        if ($outcome.Contains("connectionService")) { $outcomes[$key].connectionService = $outcome.connectionService }
    }
    # Fatal diagnostics contain fixed explanations and command outcomes, never evidence rows or identity/token data.
    $diagnostic.stageCode = $failureCode
    $diagnostic.issues = $issues
    $diagnostic.commandResults = $outcomes
    $diagnostic.workloadResults = $workloadResults
    $diagnostic.collection = [ordered]@{
        attemptedCommandCount = $commandResults.Count
        succeededCommandCount = $evidence.Count
        failedCommandCount = $errors.Count
        observationRowCount = $rowCounts.observed
        coverageComplete = $false
    }
    [Console]::Error.WriteLine("AFD_COLLECTOR_ERROR:" + ($diagnostic | ConvertTo-Json -Depth 8 -Compress))
    throw "$($diagnostic.code): $($diagnostic.message)"
}
