[CmdletBinding()]
param(
    [string]$TenantId,

    [string]$WorkspacePath,

    [string]$CollectionChallenge,

    [string]$SharePointAdminUrl,

    [string]$OutputPath,

    [switch]$InstallMissingModules,

    [ValidateSet("exchangeOnline", "sharePointOnline", "purview")]
    [string[]]$Workloads = @("exchangeOnline", "sharePointOnline", "purview")
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$VerbosePreference = "SilentlyContinue"
$DebugPreference = "SilentlyContinue"
$evidence = [ordered]@{}
$errors = [ordered]@{}
$commandResults = [ordered]@{}
$connections = [ordered]@{}
$workloadResults = [ordered]@{}
$moduleVersions = [ordered]@{}
$cleanupErrors = [System.Collections.Generic.List[object]]::new()
$now = (Get-Date).ToUniversalTime()
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
            $boundary.pagination = "module-managed"
            $boundary.note = "Limit All requested for the connected admin endpoint only; other geographies and deleted sites are not enumerated."
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
        code = $null
        rowCount = 0
        warningCount = 0
        startedAt = $started.ToString("o")
        completedAt = $null
        boundary = $boundary
    }
    try {
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
        # Capture warnings without logging potentially sensitive service text. Any warning is conservative failure.
        $returned = @(& $Operation 3>&1 4>$null 5>$null 6>$null)
        $warnings = @($returned | Where-Object { $_ -is [System.Management.Automation.WarningRecord] })
        $value = @($returned | Where-Object { $_ -isnot [System.Management.Automation.WarningRecord] })
        $result.rowCount = $value.Count
        $result.warningCount = $warnings.Count
        if ($warnings.Count -gt 0) {
            $errors[$key] = @{ code = "COMMAND_WARNING"; message = "The service returned warnings; these results are withheld because completeness is uncertain." }
            return
        }
        if ($null -ne $boundary.resultLimit -and $value.Count -ge $boundary.resultLimit) {
            $errors[$key] = @{ code = "RESULT_LIMIT_REACHED"; message = "The bounded query reached its result limit. Truncated results are not accepted as complete evidence." }
            return
        }
        $evidence[$key] = $value
        $result.status = "succeeded"
    }
    catch {
        $errors[$key] = Get-SafeCollectorDiagnostic -Record $_ -DefaultCode "COMMAND_FAILED" `
            -DefaultMessage "The command failed; the underlying cause is unavailable. No result was accepted."
    }
    finally {
        if ($errors.Contains($key)) { $result.code = $errors[$key].code }
        $result.completedAt = (Get-Date).ToUniversalTime().ToString("o")
        $commandResults[$key] = $result
    }
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
    param([string]$Service)
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
    $connections[$Service] = [ordered]@{
        basis = "Get-ConnectionInformation"
        expectedTenantId = $TenantId
        observedTenantId = $observedTenant.ToString()
        actorId = [string]$connection.UserPrincipalName
        actorBasis = "Get-ConnectionInformation.UserPrincipalName"
        connectionId = [string]$connection.ConnectionId
        tenantVerified = $true
    }
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
        Get-SPOSite -Limit All -Detailed -ErrorAction Stop
    } restrictedContent
    Add-Evidence sharePointOnline Get-SPOSite {
        Get-SPOSite -Limit All -Detailed -ErrorAction Stop
    } siteLifecycle
    Add-Evidence sharePointOnline Get-SPOSite {
        Get-SPOSite -IncludePersonalSite $true -Limit All -Detailed -ErrorAction Stop
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
        Add-Evidence purview Search-UnifiedAuditLog {
            Search-UnifiedAuditLog -StartDate $now.AddDays(-1) -EndDate $now `
                -RecordType CopilotInteraction -ResultSize 5000 -ErrorAction Stop
        }
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
}

$failedWorkloads = @()
foreach ($workload in $Workloads) {
    $results = @($commandResults.Values | Where-Object { $_.service -eq $workload })
    $succeeded = @($results | Where-Object { $_.status -eq "succeeded" }).Count
    $workloadResults[$workload] = [ordered]@{
        status = if ($succeeded -eq $results.Count) { "succeeded" } elseif ($succeeded -gt 0) { "partial" } else { "failed" }
        attemptedCommandCount = $results.Count
        succeededCommandCount = $succeeded
        failedCommandCount = $results.Count - $succeeded
        coverageComplete = $false
    }
    if ($succeeded -eq 0) {
        $failedWorkloads += $workload
    }
}
if ($failedWorkloads.Count -gt 0) {
    $failureCode = "WORKLOAD_COLLECTION_FAILED"
    $failureMessage = "One or more workloads returned no successful evidence commands. No package was written."
    throw "WORKLOAD_COLLECTION_FAILED"
}
$actors = @($connections.Values | ForEach-Object { $_.actorId } | Where-Object { $_ } | Select-Object -Unique)
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
    errors = $errors
    connections = $connections
    commandResults = $commandResults
    workloadResults = $workloadResults
    collection = [ordered]@{
        startedAt = $now.ToString("o")
        attemptedCommandCount = $commandResults.Count
        succeededCommandCount = $evidence.Count
        failedCommandCount = $errors.Count
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
    $diagnostic = Get-SafeCollectorDiagnostic -Record $_ -DefaultCode $failureCode -DefaultMessage $failureMessage
    $issues = @($errors.Keys | Select-Object -First 31 | ForEach-Object {
        [ordered]@{ resource = $_; code = $errors[$_].code; message = $errors[$_].message }
    })
    $outcomes = [ordered]@{}
    foreach ($key in @($commandResults.Keys | Select-Object -First 31)) {
        $outcome = $commandResults[$key]
        $outcomes[$key] = [ordered]@{
            status = $outcome.status
            code = $outcome.code
            rowCount = $outcome.rowCount
            warningCount = $outcome.warningCount
        }
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
        coverageComplete = $false
    }
    [Console]::Error.WriteLine("AFD_COLLECTOR_ERROR:" + ($diagnostic | ConvertTo-Json -Depth 8 -Compress))
    throw "$($diagnostic.code): $($diagnostic.message)"
}
