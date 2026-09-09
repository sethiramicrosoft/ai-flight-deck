[CmdletBinding()]
param(
    [Parameter()]
    [string]$OutputPath = ".\tenant-scan.json",

    [Parameter()]
    [ValidateRange(1, 10000)]
    [int]$MaxSites = 25,

    [Parameter()]
    [ValidateRange(1, 1000)]
    [int]$MaxDrivesPerSite = 20,

    [Parameter()]
    [ValidateRange(1, 100000)]
    [int]$MaxItemsPerDrive = 100,

    [Parameter()]
    [ValidateRange(1, 5000000)]
    [int]$MaxUsers = 10000,

    [Parameter()]
    [ValidateRange(1, 2000000)]
    [int]$MaxGroups = 10000,

    [Parameter()]
    [ValidateRange(1, 100000)]
    [int]$MaxPermissionsPerSite = 500,

    [Parameter()]
    [ValidateRange(1, 2000000)]
    [int]$MaxGraphRequests = 10000,

    [Parameter()]
    [ValidateRange(1, 10)]
    [int]$MaxRetryAttempts = 6,

    [Parameter()]
    [ValidateRange(1, 60)]
    [int]$BaseRetrySeconds = 1,

    [Parameter()]
    [ValidateRange(1, 300)]
    [int]$MaxRetrySeconds = 60,

    [Parameter()]
    [ValidateRange(0, 5000)]
    [int]$RetryJitterMilliseconds = 250,

    [Parameter()]
    [ValidateSet("Interactive", "DeviceCode", "AccessToken", "ExistingContext", "ManagedIdentity", "Certificate")]
    [string]$AuthMode = "Interactive",

    [Parameter()]
    [string]$TenantId,

    [Parameter()]
    [string]$ClientId,

    [Parameter()]
    [string]$CertificateThumbprint
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot "FlightDeck.Common.ps1")
. (Join-Path $PSScriptRoot "FlightDeck.Modules.ps1")

function Get-FdGraphStatusCode {
    param(
        [Parameter(Mandatory)]
        $ErrorRecord
    )

    $exception = Get-FdPropertyValue -Object $ErrorRecord -Name "Exception"
    if ($null -eq $exception) {
        return $null
    }

    if ($exception.Data -and $exception.Data.Contains("StatusCode")) {
        $fromData = 0
        if ([int]::TryParse([string]$exception.Data["StatusCode"], [ref]$fromData)) {
            return $fromData
        }
    }

    $response = Get-FdPropertyValue -Object $exception -Name "Response"
    $status = Get-FdPropertyValue -Object $response -Name "StatusCode"
    if ($null -ne $status) {
        try {
            return [int]$status
        }
        catch {
            $numeric = Get-FdPropertyValue -Object $status -Name "value__"
            if ($null -ne $numeric) {
                return [int]$numeric
            }
        }
    }

    return $null
}

function Get-FdRetryAfterSeconds {
    param(
        [Parameter(Mandatory)]
        $ErrorRecord
    )

    $exception = Get-FdPropertyValue -Object $ErrorRecord -Name "Exception"
    if ($null -eq $exception) {
        return $null
    }

    $rawValue = $null
    if ($exception.Data -and $exception.Data.Contains("RetryAfter")) {
        $rawValue = $exception.Data["RetryAfter"]
    }

    $response = Get-FdPropertyValue -Object $exception -Name "Response"
    $headers = Get-FdPropertyValue -Object $response -Name "Headers"
    if ($null -eq $rawValue -and $null -ne $headers) {
        if ($headers -is [System.Collections.IDictionary] -and $headers.Contains("Retry-After")) {
            $rawValue = $headers["Retry-After"]
        }
        elseif ($null -ne $headers.PSObject.Methods["TryGetValues"]) {
            $values = $null
            if ($headers.TryGetValues("Retry-After", [ref]$values)) {
                $rawValue = @($values)[0]
            }
        }
    }

    if ($null -eq $rawValue) {
        return $null
    }

    $candidate = @($rawValue)[0]
    $seconds = 0
    if ([int]::TryParse([string]$candidate, [ref]$seconds)) {
        return [math]::Max(0, $seconds)
    }

    $retryAt = [DateTimeOffset]::MinValue
    if ([DateTimeOffset]::TryParse(
            [string]$candidate,
            [System.Globalization.CultureInfo]::InvariantCulture,
            [System.Globalization.DateTimeStyles]::AssumeUniversal,
            [ref]$retryAt)) {
        return [math]::Max(0, [math]::Ceiling(($retryAt - [DateTimeOffset]::UtcNow).TotalSeconds))
    }

    return $null
}

function Get-FdGraphErrorInfo {
    param(
        [Parameter(Mandatory)]
        $ErrorRecord
    )

    $message = "Microsoft Graph request failed."
    $errorDetails = Get-FdPropertyValue -Object $ErrorRecord -Name "ErrorDetails"
    $detailsMessage = Get-FdPropertyValue -Object $errorDetails -Name "Message"
    if ($detailsMessage -is [string] -and $detailsMessage.Trim().Length -gt 0) {
        $message = $detailsMessage.Trim()
        try {
            $details = $message | ConvertFrom-Json
            $graphError = Get-FdPropertyValue -Object $details -Name "error"
            $graphMessage = Get-FdPropertyValue -Object $graphError -Name "message"
            if ($graphMessage -is [string] -and $graphMessage.Trim().Length -gt 0) {
                $message = $graphMessage.Trim()
            }
        }
        catch {
            # Preserve non-JSON Graph error details as the diagnostic message.
        }
    }

    $exception = Get-FdPropertyValue -Object $ErrorRecord -Name "Exception"
    if ($message -eq "Microsoft Graph request failed." -and $null -ne $exception) {
        $candidate = Get-FdPropertyValue -Object $exception -Name "Message"
        if ($candidate -is [string] -and $candidate.Trim().Length -gt 0) {
            $message = $candidate.Trim()
        }
    }

    if ($message.Length -gt 500) {
        $message = $message.Substring(0, 500)
    }

    return [pscustomobject][ordered]@{
        statusCode       = Get-FdGraphStatusCode -ErrorRecord $ErrorRecord
        retryAfterSeconds = Get-FdRetryAfterSeconds -ErrorRecord $ErrorRecord
        message          = $message
    }
}

function Invoke-GraphGetWithRetry {
    param(
        [Parameter(Mandatory)]
        [string]$Uri,

        [Parameter(Mandatory)]
        [hashtable]$RequestState,

        [Parameter(Mandatory)]
        [int]$MaximumRequests,

        [Parameter()]
        [int]$MaximumAttempts = 6,

        [Parameter()]
        [int]$InitialDelaySeconds = 1,

        [Parameter()]
        [int]$MaximumDelaySeconds = 60,

        [Parameter()]
        [int]$JitterMilliseconds = 250,

        [Parameter()]
        [scriptblock]$RequestInvoker,

        [Parameter()]
        [scriptblock]$SleepAction
    )

    if ($null -eq $RequestInvoker) {
        $RequestInvoker = {
            param($RequestUri)
            Invoke-MgGraphRequest -Method GET -Uri $RequestUri -OutputType PSObject
        }
    }
    if ($null -eq $SleepAction) {
        $SleepAction = {
            param($Seconds)
            Start-Sleep -Milliseconds ([int][math]::Ceiling($Seconds * 1000))
        }
    }

    for ($attempt = 1; $attempt -le $MaximumAttempts; $attempt++) {
        if ([int]$RequestState.Count -ge $MaximumRequests) {
            throw "Microsoft Graph request budget of $MaximumRequests was exhausted."
        }

        $RequestState.Count = [int]$RequestState.Count + 1
        try {
            return (& $RequestInvoker $Uri)
        }
        catch {
            $statusCode = Get-FdGraphStatusCode -ErrorRecord $_
            $retriable = $statusCode -in @(429, 502, 503, 504)
            if (-not $retriable -or $attempt -ge $MaximumAttempts) {
                throw
            }

            $retryAfter = Get-FdRetryAfterSeconds -ErrorRecord $_
            if ($null -eq $retryAfter) {
                $retryAfter = [math]::Min(
                    $MaximumDelaySeconds,
                    $InitialDelaySeconds * [math]::Pow(2, $attempt - 1)
                )
            }
            else {
                $retryAfter = [math]::Min($MaximumDelaySeconds, $retryAfter)
            }

            $jitter = 0
            if ($JitterMilliseconds -gt 0) {
                $jitter = (Get-Random -Minimum 0 -Maximum ($JitterMilliseconds + 1)) / 1000.0
            }

            & $SleepAction ($retryAfter + $jitter)
        }
    }
}

function Invoke-GraphCollection {
    param(
        [Parameter(Mandatory)]
        [string]$Uri,

        [Parameter(Mandatory)]
        [int]$Maximum,

        [Parameter(Mandatory)]
        [hashtable]$RequestState,

        [Parameter(Mandatory)]
        [int]$MaximumRequests,

        [Parameter()]
        [int]$MaximumAttempts = 6,

        [Parameter()]
        [int]$InitialDelaySeconds = 1,

        [Parameter()]
        [int]$MaximumDelaySeconds = 60,

        [Parameter()]
        [int]$JitterMilliseconds = 250,

        [Parameter()]
        [scriptblock]$RequestInvoker,

        [Parameter()]
        [scriptblock]$SleepAction
    )

    $results = [System.Collections.Generic.List[object]]::new()
    $next = $Uri
    $pages = 0
    $requestCountBefore = [int]$RequestState.Count
    $truncated = $false
    $failure = $null

    while ($next -and $results.Count -lt $Maximum) {
        try {
            $response = Invoke-GraphGetWithRetry `
                -Uri $next `
                -RequestState $RequestState `
                -MaximumRequests $MaximumRequests `
                -MaximumAttempts $MaximumAttempts `
                -InitialDelaySeconds $InitialDelaySeconds `
                -MaximumDelaySeconds $MaximumDelaySeconds `
                -JitterMilliseconds $JitterMilliseconds `
                -RequestInvoker $RequestInvoker `
                -SleepAction $SleepAction
        }
        catch {
            $failure = Get-FdGraphErrorInfo -ErrorRecord $_
            break
        }

        $pages++
        $pageItems = @(Get-FdPropertyValue -Object $response -Name "value")
        foreach ($item in $pageItems) {
            if ($null -eq $item) {
                continue
            }
            if ($results.Count -ge $Maximum) {
                $truncated = $true
                break
            }
            $results.Add($item)
        }

        $next = Get-FdPropertyValue -Object $response -Name "@odata.nextLink"
        if ($results.Count -ge $Maximum -and $next) {
            $truncated = $true
            break
        }
    }

    return [pscustomobject][ordered]@{
        items      = @($results | ForEach-Object { $_ })
        limit      = $Maximum
        collected  = $results.Count
        pages      = $pages
        requests   = [int]$RequestState.Count - $requestCountBefore
        truncated  = [bool]$truncated
        failed     = ($null -ne $failure)
        failure    = $failure
    }
}

function New-FdFinding {
    param(
        [Parameter(Mandatory)]
        [string]$RuleKey,

        [Parameter(Mandatory)]
        [ValidateSet("critical", "high", "medium", "low")]
        [string]$Severity,

        [Parameter(Mandatory)]
        [string]$Title,

        [Parameter(Mandatory)]
        [string]$Detail,

        [Parameter(Mandatory)]
        [string]$Impact,

        [Parameter(Mandatory)]
        [string]$SourceNode,

        [Parameter()]
        [string[]]$EvidenceIds = @()
    )

    return [ordered]@{
        findingId   = "finding:$($RuleKey.ToLowerInvariant())"
        ruleKey     = $RuleKey
        severity    = $Severity
        title       = $Title
        detail      = $Detail
        source      = "Microsoft Graph"
        sourceDetails = [ordered]@{
            collector = "graph-tenant-scan"
            node      = $SourceNode
        }
        impact      = $Impact
        evidenceIds = @($EvidenceIds | Sort-Object -Unique)
    }
}

function Get-FdPermissionIdentityData {
    param(
        [Parameter(Mandatory)]
        $Permission
    )

    $claims = [System.Collections.Generic.List[string]]::new()
    $displayNames = [System.Collections.Generic.List[string]]::new()
    $principalIds = [System.Collections.Generic.List[string]]::new()
    $principalTypes = [System.Collections.Generic.List[string]]::new()
    $identities = [System.Collections.Generic.List[object]]::new()

    $single = Get-FdPropertyValue -Object $Permission -Name "grantedToV2"
    if ($null -ne $single) {
        $identities.Add($single)
    }
    foreach ($identity in @(Get-FdPropertyValue -Object $Permission -Name "grantedToIdentitiesV2")) {
        if ($null -ne $identity) {
            $identities.Add($identity)
        }
    }

    foreach ($identity in $identities) {
        foreach ($kind in @("user", "siteGroup", "group", "application")) {
            $principal = Get-FdPropertyValue -Object $identity -Name $kind
            if ($null -eq $principal) {
                continue
            }
            $principalTypes.Add($kind)

            foreach ($claimName in @("loginName", "id", "email")) {
                $claim = Get-FdPropertyValue -Object $principal -Name $claimName
                if ($claim -is [string] -and $claim.Trim().Length -gt 0) {
                    $claims.Add($claim.Trim())
                    if ($claimName -eq "id") {
                        $principalIds.Add($claim.Trim())
                    }
                }
            }

            $displayName = Get-FdPropertyValue -Object $principal -Name "displayName"
            if ($displayName -is [string] -and $displayName.Trim().Length -gt 0) {
                $displayNames.Add($displayName.Trim())
            }
        }
    }

    return [pscustomobject][ordered]@{
        claims        = @($claims | Sort-Object -Unique)
        displayNames  = @($displayNames | Sort-Object -Unique)
        principalIds  = @($principalIds | Sort-Object -Unique)
        principalTypes = @($principalTypes | Sort-Object -Unique)
    }
}

function Get-FdPermissionStableProjection {
    param(
        [Parameter(Mandatory)]
        $Permission
    )

    $roles = @(
        Get-FdPropertyValue -Object $Permission -Name "roles" |
            ForEach-Object {
                if ($_ -is [string] -and $_.Trim().Length -gt 0) {
                    $_.Trim().ToLowerInvariant()
                }
            }
    )
    [string[]]$sortedRoles = @($roles)
    [System.Array]::Sort($sortedRoles, [System.StringComparer]::Ordinal)

    $principals = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    $identitySets = [System.Collections.Generic.List[object]]::new()
    $single = Get-FdPropertyValue -Object $Permission -Name "grantedToV2"
    if ($null -ne $single) {
        $identitySets.Add($single)
    }
    foreach ($identity in @(Get-FdPropertyValue -Object $Permission -Name "grantedToIdentitiesV2")) {
        if ($null -ne $identity) {
            $identitySets.Add($identity)
        }
    }

    foreach ($identity in $identitySets) {
        foreach ($kind in @("application", "group", "siteGroup", "user")) {
            $principal = Get-FdPropertyValue -Object $identity -Name $kind
            if ($null -eq $principal) {
                continue
            }

            $parts = [System.Collections.Generic.List[string]]::new()
            foreach ($field in @("id", "loginName", "email")) {
                $value = Get-FdPropertyValue -Object $principal -Name $field
                if ($value -is [string] -and $value.Trim().Length -gt 0) {
                    $parts.Add("$field=$($value.Trim())")
                }
            }
            if ($parts.Count -gt 0) {
                $null = $principals.Add("$kind|$($parts -join '|')")
            }
        }
    }
    [string[]]$sortedPrincipals = @($principals)
    [System.Array]::Sort($sortedPrincipals, [System.StringComparer]::Ordinal)

    $link = Get-FdPropertyValue -Object $Permission -Name "link"
    return [ordered]@{
        roles      = $sortedRoles
        link       = [ordered]@{
            scope  = Get-FdPropertyValue -Object $link -Name "scope"
            type   = Get-FdPropertyValue -Object $link -Name "type"
            webUrl = Get-FdPropertyValue -Object $link -Name "webUrl"
        }
        principals = $sortedPrincipals
    }
}

function Get-FdPermissionAccessType {
    param(
        [Parameter(Mandatory)]
        $Permission,

        [Parameter(Mandatory)]
        $IdentityData,

        [Parameter(Mandatory)]
        $GuestDirectoryIds
    )

    $link = Get-FdPropertyValue -Object $Permission -Name "link"
    $linkScope = Get-FdPropertyValue -Object $link -Name "scope"
    $normalizedLinkScope = if ($linkScope -is [string]) {
        $linkScope.Trim().ToLowerInvariant()
    }
    else {
        ""
    }
    $principalTypes = @($IdentityData.principalTypes)
    $guestPrincipalCount = @(
        $IdentityData.principalIds |
            Where-Object { $GuestDirectoryIds.Contains([string]$_) }
    ).Count
    $inherited = $null -ne (Get-FdPropertyValue -Object $Permission -Name "inheritedFrom")
    $accessType = if ($normalizedLinkScope -eq "anonymous") {
        "anonymous-link"
    }
    elseif ($normalizedLinkScope -eq "organization") {
        "organization-link"
    }
    elseif ($normalizedLinkScope -eq "users") {
        "specific-people-link"
    }
    elseif (Test-FdBroadIdentity -IdentityData $IdentityData) {
        "broad-identity-grant"
    }
    elseif ($principalTypes -contains "application") {
        "application-grant"
    }
    elseif ($principalTypes -contains "group" -or $principalTypes -contains "siteGroup") {
        "group-direct-grant"
    }
    elseif ($guestPrincipalCount -gt 0) {
        "guest-direct-grant"
    }
    elseif ($principalTypes -contains "user") {
        "user-direct-grant"
    }
    elseif ($inherited) {
        "inherited-permission"
    }
    else {
        "unclassified-permission"
    }

    return [pscustomobject][ordered]@{
        accessType          = $accessType
        linkScope           = $normalizedLinkScope
        guestPrincipalCount = $guestPrincipalCount
        inherited           = $inherited
    }
}

function Get-FdPermissionEvidenceId {
    param(
        [Parameter(Mandatory)]
        [string]$SiteId,

        [Parameter(Mandatory)]
        [string]$ResourceId,

        [Parameter(Mandatory)]
        $Permission
    )

    $permissionId = Get-FdPropertyValue -Object $Permission -Name "id"
    $resourceHash = (Get-FdSha256Hex -Text $ResourceId).Substring(0, 20)
    if ($permissionId -is [string] -and $permissionId.Trim().Length -gt 0) {
        return "permission:v2:$SiteId`:$resourceHash`:$($permissionId.Trim())"
    }

    $projection = Get-FdPermissionStableProjection -Permission $Permission
    $hash = Get-FdSha256Hex -Text (ConvertTo-FdCanonicalJson -Value ([ordered]@{
        resource = $ResourceId
        permission = $projection
    }))
    return "permission-derived:v2:$SiteId`:$resourceHash`:$hash"
}

function Test-FdBroadIdentity {
    param(
        [Parameter(Mandatory)]
        $IdentityData
    )

    $claimPatterns = @(
        'spo-grid-all-users',
        'c:0\(\.s\|true',
        'c:0-\.f\|rolemanager\|spo-grid-all-users'
    )
    foreach ($claim in @($IdentityData.claims)) {
        foreach ($pattern in $claimPatterns) {
            if ($claim -match $pattern) {
                return $true
            }
        }
    }

    $displayPattern = '^(Everyone|All Employees|All Company|Everyone except external users)$'
    foreach ($displayName in @($IdentityData.displayNames)) {
        if ($displayName -match $displayPattern) {
            return $true
        }
    }

    return $false
}

function Select-FdBoundedSites {
    param(
        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [object[]]$Candidates,

        [Parameter(Mandatory)]
        [int]$MaximumSites,

        [Parameter(Mandatory)]
        [bool]$DiscoveryComplete
    )

    $sitesById = [System.Collections.Generic.SortedDictionary[string,object]]::new(
        [System.StringComparer]::Ordinal
    )
    $invalidCount = 0
    foreach ($candidate in @($Candidates)) {
        $siteId = Get-FdPropertyValue -Object $candidate -Name "id"
        if ($siteId -isnot [string] -or $siteId.Trim().Length -eq 0) {
            $invalidCount++
            continue
        }

        $siteId = $siteId.Trim()
        $projection = [pscustomobject][ordered]@{
            id          = $siteId
            displayName = Get-FdPropertyValue -Object $candidate -Name "displayName"
            webUrl      = Get-FdPropertyValue -Object $candidate -Name "webUrl"
        }
        if (-not $sitesById.ContainsKey($siteId)) {
            $sitesById.Add($siteId, $projection)
            continue
        }

        $currentJson = ConvertTo-FdCanonicalJson -Value $sitesById[$siteId]
        $candidateJson = ConvertTo-FdCanonicalJson -Value $projection
        if ([System.StringComparer]::Ordinal.Compare($candidateJson, $currentJson) -lt 0) {
            $sitesById[$siteId] = $projection
        }
    }

    $allSites = @($sitesById.Values | ForEach-Object { $_ })
    $selectedCount = [math]::Min($MaximumSites, $allSites.Count)
    $selectedSites = @(
        if ($selectedCount -gt 0) {
            $allSites[0..($selectedCount - 1)]
        }
    )
    $selectionLimitReached = $allSites.Count -gt $MaximumSites
    $coverageComplete = (
        $DiscoveryComplete -and
        $invalidCount -eq 0 -and
        -not $selectionLimitReached
    )

    return [pscustomobject][ordered]@{
        sites                 = $selectedSites
        sitesDiscovered       = $allSites.Count
        sitesSelected         = $selectedSites.Count
        invalidCandidateCount = $invalidCount
        selectionLimitReached = $selectionLimitReached
        coverageComplete      = $coverageComplete
    }
}

function Test-FdRiskQualifiedExposedItem {
    param(
        [Parameter(Mandatory)]
        $Item,

        [Parameter(Mandatory)]
        [bool]$SiteHasBroadAccess
    )

    $shared = Get-FdPropertyValue -Object $Item -Name "shared"
    if ($null -eq $shared) {
        return $false
    }

    $scope = Get-FdPropertyValue -Object $shared -Name "scope"
    $normalizedScope = if ($scope -is [string]) { $scope.Trim().ToLowerInvariant() } else { "" }
    return $normalizedScope -in @("anonymous", "organization") -or $SiteHasBroadAccess
}

function New-FdFailureDetail {
    param(
        [Parameter(Mandatory)]
        [string]$Stage,

        [Parameter(Mandatory)]
        [string]$SiteId,

        [Parameter()]
        [string]$SiteDisplayName,

        [Parameter()]
        [string]$DriveId,

        [Parameter()]
        $Failure,

        [Parameter()]
        [switch]$Truncated
    )

    return [pscustomobject][ordered]@{
        stage           = $Stage
        siteId          = $SiteId
        siteDisplayName = $SiteDisplayName
        driveId         = $DriveId
        statusCode      = if ($null -ne $Failure) { Get-FdPropertyValue -Object $Failure -Name "statusCode" } else { $null }
        message         = if ($Truncated) {
            "Collection reached its configured limit."
        }
        elseif ($null -ne $Failure) {
            Get-FdPropertyValue -Object $Failure -Name "message"
        }
        else {
            "Collection failed."
        }
    }
}

function Get-FdSortedSet {
    param(
        [Parameter(Mandatory)]
        $Values
    )

    $set = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    foreach ($value in @($Values)) {
        if ($value -is [string] -and $value.Length -gt 0) {
            $null = $set.Add($value)
        }
    }

    [string[]]$sorted = @($set)
    [System.Array]::Sort($sorted, [System.StringComparer]::Ordinal)
    return ,$sorted
}

function Invoke-FdConnect {
    param(
        [Parameter(Mandatory)]
        [string]$Mode,

        [Parameter(Mandatory)]
        [string[]]$Scopes,

        [Parameter()]
        [string]$RequestedTenantId,

        [Parameter()]
        [string]$RequestedClientId,

        [Parameter()]
        [string]$Thumbprint
    )

    switch ($Mode) {
        "Interactive" {
            Connect-MgGraph -Scopes $Scopes -NoWelcome
        }
        "DeviceCode" {
            Connect-MgGraph -Scopes $Scopes -UseDeviceCode -NoWelcome
        }
        "AccessToken" {
            $accessToken = [Environment]::GetEnvironmentVariable("FLIGHT_DECK_GRAPH_ACCESS_TOKEN", "Process")
            if ([string]::IsNullOrWhiteSpace($accessToken)) {
                throw "Access-token authentication requires an in-memory token from the AI Flight Deck local service."
            }
            $secureToken = [System.Security.SecureString]::new()
            foreach ($character in $accessToken.ToCharArray()) {
                $secureToken.AppendChar($character)
            }
            $secureToken.MakeReadOnly()
            Connect-MgGraph -AccessToken $secureToken -NoWelcome
        }
        "ExistingContext" {
            return
        }
        "ManagedIdentity" {
            if ($RequestedClientId) {
                Connect-MgGraph -Identity -ClientId $RequestedClientId -NoWelcome
            }
            else {
                Connect-MgGraph -Identity -NoWelcome
            }
        }
        "Certificate" {
            if (-not $RequestedTenantId -or -not $RequestedClientId -or -not $Thumbprint) {
                throw "Certificate authentication requires TenantId, ClientId, and CertificateThumbprint."
            }
            Connect-MgGraph `
                -TenantId $RequestedTenantId `
                -ClientId $RequestedClientId `
                -CertificateThumbprint $Thumbprint `
                -NoWelcome
        }
    }
}

function New-FdControlResults {
    param(
        [Parameter(Mandatory)]
        $ReadinessCatalog,

        [Parameter(Mandatory)]
        [string]$TenantId,

        [Parameter(Mandatory)]
        [string]$ActorId,

        [Parameter(Mandatory)]
        [string]$CollectorRunId,

        [Parameter(Mandatory)]
        [datetime]$ObservedAt,

        [Parameter()]
        [string]$CohortId = "tenant-wide"
    )

    $catalogVersion = Get-FdRequiredString `
        -Value (Get-FdPropertyValue -Object $ReadinessCatalog -Name "catalogVersion") `
        -Name "readinessCatalog.catalogVersion"
    $results = [System.Collections.Generic.List[object]]::new()

    foreach ($domain in @(Get-FdPropertyValue -Object $ReadinessCatalog -Name "domains" | Sort-Object -Property order)) {
        $domainId = Get-FdRequiredString `
            -Value (Get-FdPropertyValue -Object $domain -Name "id") `
            -Name "readinessCatalog.domain.id"

        foreach ($control in @(Get-FdPropertyValue -Object $domain -Name "controls")) {
            $controlId = Get-FdRequiredString `
                -Value (Get-FdPropertyValue -Object $control -Name "id") `
                -Name "readinessCatalog.control.id"
            $freshnessHours = [int](Get-FdPropertyValue -Object $control -Name "freshnessHours")
            $evidenceSources = @(
                Get-FdPropertyValue -Object $control -Name "evidenceSources" |
                    ForEach-Object { [string]$_ }
            )

            $results.Add([pscustomobject][ordered]@{
                controlId = $controlId
                controlVersion = $catalogVersion
                instanceId = "$TenantId`:$CohortId`:$controlId"
                domainId = $domainId
                cohortId = $CohortId
                status = "Unknown"
                requirement = Get-FdPropertyValue -Object $control -Name "requirement"
                applicability = [pscustomobject][ordered]@{
                    applies = $true
                    reason = Get-FdPropertyValue -Object $control -Name "applicability"
                }
                observedValue = $null
                expectedValue = Get-FdPropertyValue -Object $control -Name "passCondition"
                observedAt = $ObservedAt.ToUniversalTime().ToString("o")
                freshUntil = $ObservedAt.ToUniversalTime().AddHours($freshnessHours).ToString("o")
                coverage = [pscustomobject][ordered]@{
                    population = 0
                    evaluated = 0
                    complete = $false
                    excluded = 0
                    reason = "The required control-specific collector has not produced sufficient evidence."
                }
                confidence = 0
                provenance = [pscustomobject][ordered]@{
                    collectorId = "graph-bounded-tenant-inventory"
                    collectorVersion = "1.0.0"
                    collectorRunId = $CollectorRunId
                    tenantId = $TenantId
                    actorId = $ActorId
                    source = if ($evidenceSources.Count -gt 0) {
                        $evidenceSources -join "; "
                    }
                    else {
                        "Unspecified readiness evidence source"
                    }
                    sourceVersion = "Microsoft Graph v1.0"
                    requestIds = @()
                }
                evidenceRefs = @()
                affectedPrincipals = @()
                affectedResources = @()
                owner = $null
                remediation = [pscustomobject][ordered]@{
                    state = "NotPlanned"
                    action = Get-FdPropertyValue -Object $control -Name "remediation"
                    packageId = $null
                }
                attestation = $null
                limitations = @(
                    [pscustomobject][ordered]@{
                        code = "MISSING_COLLECTOR_CAPABILITY"
                        description = Get-FdPropertyValue -Object $control -Name "unavailableBehavior"
                    }
                )
            })
        }
    }

    return @($results)
}

function Invoke-FdTenantScan {
    $contract = Read-FdContract
    $readinessCatalog = Read-FdReadinessCatalog
    $scopeContract = Get-FdPropertyValue -Object $contract -Name "scopeContract"
    $requiredPermissions = @(
        Get-FdPropertyValue -Object $scopeContract -Name "requiredPermissions"
    )

    $graphModule = Resolve-FdModule -Name Microsoft.Graph.Authentication
    Import-FdModule -Module $graphModule

    $ownsConnection = $AuthMode -ne "ExistingContext"
    $graphAccessToken = $null
    $restHeaders = $null
    Write-Host "Connecting to Microsoft Graph with read-only permissions..."
    Invoke-FdConnect `
        -Mode $AuthMode `
        -Scopes $requiredPermissions `
        -RequestedTenantId $TenantId `
        -RequestedClientId $ClientId `
        -Thumbprint $CertificateThumbprint

    try {
        $context = Get-MgContext
        $contextTenantId = Get-FdPropertyValue -Object $context -Name "TenantId"
        $parsedTenantId = [guid]::Empty
        if ($contextTenantId -isnot [string] -or -not [guid]::TryParse($contextTenantId, [ref]$parsedTenantId)) {
            throw "Microsoft Graph authentication did not return a valid tenant ID."
        }
        $normalizedTenantId = $parsedTenantId.ToString().ToLowerInvariant()

        $actorId = Get-FdPropertyValue -Object $context -Name "Account"
        if ($AuthMode -eq "AccessToken") {
            $graphAccessToken = [Environment]::GetEnvironmentVariable("FLIGHT_DECK_GRAPH_ACCESS_TOKEN", "Process")
        }
        if (($actorId -isnot [string] -or $actorId.Trim().Length -eq 0) -and $AuthMode -eq "AccessToken") {
            try {
                $payload = $graphAccessToken.Split(".")[1].Replace("-", "+").Replace("_", "/")
                while ($payload.Length % 4 -ne 0) {
                    $payload += "="
                }
                $claims = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload)) | ConvertFrom-Json
                $actorId = Get-FdPropertyValue -Object $claims -Name "oid"
                if ($actorId -isnot [string] -or $actorId.Trim().Length -eq 0) {
                    $actorId = Get-FdPropertyValue -Object $claims -Name "preferred_username"
                }
            }
            catch {
                $actorId = $null
            }
        }
        [Environment]::SetEnvironmentVariable("FLIGHT_DECK_GRAPH_ACCESS_TOKEN", $null, "Process")
        if ($actorId -isnot [string] -or $actorId.Trim().Length -eq 0) {
            $actorId = Get-FdPropertyValue -Object $context -Name "ClientId"
        }
        if ($actorId -isnot [string] -or $actorId.Trim().Length -eq 0) {
            $actorId = "unresolved"
        }
        else {
            $actorId = $actorId.Trim()
        }

        $actorType = if ($AuthMode -in @("Interactive", "DeviceCode", "AccessToken")) {
            "delegatedUser"
        }
        elseif ($AuthMode -eq "ManagedIdentity") {
            "managedIdentity"
        }
        elseif ($AuthMode -eq "ExistingContext" -and
            (Get-FdPropertyValue -Object $context -Name "Account") -is [string] -and
            (Get-FdPropertyValue -Object $context -Name "Account").Trim().Length -gt 0) {
            "delegatedUser"
        }
        else {
            "servicePrincipal"
        }

        $scopeDefinition = New-FdScopeDefinition `
            -Mode (Get-FdPropertyValue $scopeContract "mode") `
            -MaximumSites $MaxSites `
            -MaximumDrivesPerSite $MaxDrivesPerSite `
            -MaximumItemsPerDrive $MaxItemsPerDrive `
            -MaximumUsers $MaxUsers `
            -MaximumGroups $MaxGroups `
            -MaximumPermissionsPerSite $MaxPermissionsPerSite `
            -MaximumGraphRequests $MaxGraphRequests `
            -RequiredPermissions $requiredPermissions `
            -ContentRetrieved (Get-FdPropertyValue $scopeContract "contentRetrieved") `
            -AuthMode $AuthMode `
            -ActorType $actorType `
            -SiteSelection (Get-FdPropertyValue $scopeContract "siteSelection") `
            -ItemSelection (Get-FdPropertyValue $scopeContract "itemSelection")

        $scopeFingerprint = Get-FdScopeFingerprint -ScopeDefinition $scopeDefinition
        $policyHash = Get-FdPolicyHash -Contract $contract
        $producer = Get-FdRequiredString -Value (Get-FdPropertyValue $contract "producer") -Name "contract.producer"
        $producerVersion = Get-FdRequiredString -Value (Get-FdPropertyValue $contract "producerVersion") -Name "contract.producerVersion"
        $scoringVersion = Get-FdRequiredString -Value (Get-FdPropertyValue $contract "scoringVersion") -Name "contract.scoringVersion"
        $configurationHash = Get-FdConfigurationHash `
            -Contract $contract `
            -PolicyHash $policyHash `
            -ScopeFingerprint $scopeFingerprint `
            -Producer $producer `
            -ProducerVersion $producerVersion `
            -ScoringVersion $scoringVersion

        $requestState = @{ Count = 0 }
        $collectionArguments = @{
            RequestState        = $requestState
            MaximumRequests     = $MaxGraphRequests
            MaximumAttempts     = $MaxRetryAttempts
            InitialDelaySeconds = $BaseRetrySeconds
            MaximumDelaySeconds = $MaxRetrySeconds
            JitterMilliseconds  = $RetryJitterMilliseconds
        }
        if (-not [string]::IsNullOrWhiteSpace($graphAccessToken)) {
            $restHeaders = @{
                Authorization = "Bearer $graphAccessToken"
            }
            $collectionArguments.RequestInvoker = {
                param($RequestUri)
                Invoke-RestMethod -Uri $RequestUri -Method Get -Headers $restHeaders
            }.GetNewClosure()
        }

        Write-Host "Collecting bounded tenant evidence..."
        $organizationResult = Invoke-GraphCollection `
            -Uri "https://graph.microsoft.com/v1.0/organization?`$select=id,displayName,verifiedDomains&`$top=1" `
            -Maximum 1 @collectionArguments
        $subscribedSkusResult = Invoke-GraphCollection `
            -Uri "https://graph.microsoft.com/v1.0/subscribedSkus?`$select=id,skuId,skuPartNumber,consumedUnits,prepaidUnits,servicePlans" `
            -Maximum 1000 @collectionArguments
        $usersPageSize = [math]::Min(999, $MaxUsers)
        $usersResult = Invoke-GraphCollection `
            -Uri "https://graph.microsoft.com/v1.0/users?`$select=id,userType,accountEnabled&`$top=$usersPageSize" `
            -Maximum $MaxUsers @collectionArguments
        $groupsPageSize = [math]::Min(999, $MaxGroups)
        $groupsResult = Invoke-GraphCollection `
            -Uri "https://graph.microsoft.com/v1.0/groups?`$select=id,displayName,visibility,securityEnabled,groupTypes&`$top=$groupsPageSize" `
            -Maximum $MaxGroups @collectionArguments
        $validation = Get-FdPropertyValue -Object $contract -Name "validation"
        $siteCandidateLimit = [int](Get-FdPropertyValue $validation "maximumSites")
        $encodedSearch = [uri]::EscapeDataString("*")
        $sitesResult = Invoke-GraphCollection `
            -Uri "https://graph.microsoft.com/v1.0/sites?search=$encodedSearch" `
            -Maximum $siteCandidateLimit @collectionArguments

        $tenant = @($organizationResult.items)[0]
        $tenantDisplayName = Get-FdPropertyValue -Object $tenant -Name "displayName"
        if ($tenantDisplayName -isnot [string] -or $tenantDisplayName.Trim().Length -eq 0) {
            $tenantDisplayName = "Unknown tenant"
        }

        $users = @($usersResult.items)
        $groups = @($groupsResult.items)
        $siteSelection = Select-FdBoundedSites `
            -Candidates @($sitesResult.items) `
            -MaximumSites $MaxSites `
            -DiscoveryComplete (-not $sitesResult.failed -and -not $sitesResult.truncated)
        $sites = @($siteSelection.sites)
        $guestUserIds = [System.Collections.Generic.List[string]]::new()
        $guestDirectoryIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
        $memberUserCount = 0
        $enabledMemberUserCount = 0
        foreach ($user in $users) {
            $userType = Get-FdPropertyValue -Object $user -Name "userType"
            if ($userType -eq "Guest") {
                $userId = Get-FdPropertyValue -Object $user -Name "id"
                if ($userId -is [string] -and $userId.Length -gt 0) {
                    $guestUserIds.Add("user:$userId")
                    $null = $guestDirectoryIds.Add($userId.Trim())
                }
            }
            else {
                $memberUserCount++
                if ((Get-FdPropertyValue -Object $user -Name "accountEnabled") -eq $true) {
                    $enabledMemberUserCount++
                }
            }
        }

        $anonymousPermissionIds = [System.Collections.Generic.List[string]]::new()
        $organizationPermissionIds = [System.Collections.Generic.List[string]]::new()
        $broadAccessSiteIds = [System.Collections.Generic.List[string]]::new()
        $broadAccessDetails = [System.Collections.Generic.List[object]]::new()
        $sharedItemIds = [System.Collections.Generic.List[string]]::new()
        $sharedItemDetails = [System.Collections.Generic.List[object]]::new()
        $permissionPathDetails = [System.Collections.Generic.List[object]]::new()
        $publicGroupSitesAttempted = 0
        $publicGroupSitesResolved = 0
        $publicGroupSitesFailed = 0
        foreach ($group in $groups) {
            $visibility = Get-FdPropertyValue -Object $group -Name "visibility"
            $groupTypes = @(Get-FdPropertyValue -Object $group -Name "groupTypes")
            if ($visibility -eq "Public" -and $groupTypes -contains "Unified") {
                $groupId = Get-FdPropertyValue -Object $group -Name "id"
                if ($groupId -is [string] -and $groupId.Trim().Length -gt 0) {
                    $evidenceId = "site-via-public-group:$($groupId.Trim())"
                    $groupName = Get-FdPropertyValue -Object $group -Name "displayName"
                    if ($groupName -isnot [string] -or $groupName.Trim().Length -eq 0) {
                        $groupName = "Unnamed Microsoft 365 group"
                    }
                    $publicGroupSitesAttempted++
                    $connectedSite = $null
                    try {
                        $encodedGroupId = [uri]::EscapeDataString($groupId.Trim())
                        $connectedSite = Invoke-GraphGetWithRetry `
                            -Uri "https://graph.microsoft.com/v1.0/groups/$encodedGroupId/sites/root?`$select=id,displayName,webUrl" `
                            @collectionArguments
                        $connectedSiteId = Get-FdPropertyValue -Object $connectedSite -Name "id"
                        if ($connectedSiteId -is [string] -and $connectedSiteId.Trim()) {
                            $publicGroupSitesResolved++
                        }
                        else {
                            $connectedSite = $null
                            $publicGroupSitesFailed++
                        }
                    }
                    catch {
                        $connectedSite = $null
                        $publicGroupSitesFailed++
                    }
                    $connectedSiteName = Get-FdPropertyValue -Object $connectedSite -Name "displayName"
                    if ($connectedSiteName -isnot [string] -or -not $connectedSiteName.Trim()) {
                        $connectedSiteName = $groupName.Trim()
                    }
                    $broadAccessSiteIds.Add($evidenceId)
                    $broadAccessDetails.Add([ordered]@{
                        evidenceId = $evidenceId
                        displayName = $connectedSiteName.Trim()
                        resourceType = if ($null -ne $connectedSite) { "SharePoint site" } else { "Microsoft 365 group" }
                        siteResolved = $null -ne $connectedSite
                        siteId = Get-FdPropertyValue -Object $connectedSite -Name "id"
                        siteWebUrl = Get-FdPropertyValue -Object $connectedSite -Name "webUrl"
                        groupId = $groupId.Trim()
                        groupDisplayName = $groupName.Trim()
                        reason = if ($null -ne $connectedSite) {
                            "This SharePoint site is connected to a public Microsoft 365 group, so organization users may be able to discover, access, or join the collaboration space."
                        }
                        else {
                            "The Microsoft 365 group is Public, but the connected SharePoint site could not be resolved in this scan."
                        }
                        recommendedAction = "Ask the group and site owners to confirm that Public visibility is intentional. If not, change the group to Private and run verification again."
                    })
                }
            }
        }
        $failedSites = [System.Collections.Generic.List[object]]::new()
        $siteMetadataFailureCount = [int]$siteSelection.invalidCandidateCount
        for ($invalidIndex = 0; $invalidIndex -lt $siteMetadataFailureCount; $invalidIndex++) {
            $failedSites.Add((New-FdFailureDetail `
                -Stage "siteMetadata" `
                -SiteId "unresolved" `
                -SiteDisplayName "Invalid site candidate"))
        }

        $drivePages = 0
        $driveRequests = 0
        $driveSitesAttempted = 0
        $driveSitesFailed = 0
        $driveSitesTruncated = 0

        $itemPages = 0
        $itemRequests = 0
        $drivesAttempted = 0
        $drivesFailed = 0
        $drivesTruncated = 0
        $sampledItems = 0
        $permissionPages = 0
        $permissionRequests = 0
        $permissionsInspected = 0
        $permissionItemsAttempted = 0
        $permissionItemsFailed = 0
        $permissionItemsTruncated = 0

        foreach ($site in $sites) {
            $siteId = Get-FdPropertyValue -Object $site -Name "id"
            $siteDisplayName = Get-FdPropertyValue -Object $site -Name "displayName"
            $siteId = $siteId.Trim()
            $encodedSiteId = [uri]::EscapeDataString($siteId)
            $sitePermissionCount = 0

            $driveSitesAttempted++
            $drivePageSize = [math]::Min(100, $MaxDrivesPerSite)
            $drivesResult = Invoke-GraphCollection `
                -Uri "https://graph.microsoft.com/v1.0/sites/$encodedSiteId/drives?`$select=id,name,driveType&`$top=$drivePageSize" `
                -Maximum $MaxDrivesPerSite @collectionArguments
            $drivePages += $drivesResult.pages
            $driveRequests += $drivesResult.requests
            if ($drivesResult.failed) {
                $driveSitesFailed++
                $failedSites.Add((New-FdFailureDetail `
                    -Stage "drives" `
                    -SiteId $siteId `
                    -SiteDisplayName $siteDisplayName `
                    -Failure $drivesResult.failure))
            }
            if ($drivesResult.truncated) {
                $driveSitesTruncated++
                $failedSites.Add((New-FdFailureDetail `
                    -Stage "drives" `
                    -SiteId $siteId `
                    -SiteDisplayName $siteDisplayName `
                    -Truncated))
            }

            foreach ($drive in @($drivesResult.items)) {
                $drivesAttempted++
                $driveId = Get-FdPropertyValue -Object $drive -Name "id"
                $driveDisplayName = Get-FdPropertyValue -Object $drive -Name "name"
                if ($driveDisplayName -isnot [string] -or $driveDisplayName.Trim().Length -eq 0) {
                    $driveDisplayName = "Document library"
                }
                if ($driveId -isnot [string] -or $driveId.Trim().Length -eq 0) {
                    $drivesFailed++
                    $failedSites.Add((New-FdFailureDetail `
                        -Stage "driveItems" `
                        -SiteId $siteId `
                        -SiteDisplayName $siteDisplayName `
                        -DriveId "unresolved"))
                    continue
                }

                $driveId = $driveId.Trim()
                $encodedDriveId = [uri]::EscapeDataString($driveId)
                $itemPageSize = [math]::Min(200, $MaxItemsPerDrive)
                $itemsResult = Invoke-GraphCollection `
                    -Uri "https://graph.microsoft.com/v1.0/drives/$encodedDriveId/root/children?`$select=id,name,size,file,folder,shared,webUrl&`$top=$itemPageSize" `
                    -Maximum $MaxItemsPerDrive @collectionArguments
                $itemPages += $itemsResult.pages
                $itemRequests += $itemsResult.requests
                $sampledItems += $itemsResult.collected
                if ($itemsResult.failed) {
                    $drivesFailed++
                    $failedSites.Add((New-FdFailureDetail `
                        -Stage "driveItems" `
                        -SiteId $siteId `
                        -SiteDisplayName $siteDisplayName `
                        -DriveId $driveId `
                        -Failure $itemsResult.failure))
                }
                if ($itemsResult.truncated) {
                    $drivesTruncated++
                    $failedSites.Add((New-FdFailureDetail `
                        -Stage "driveItems" `
                        -SiteId $siteId `
                        -SiteDisplayName $siteDisplayName `
                        -DriveId $driveId `
                        -Truncated))
                }

                foreach ($item in @($itemsResult.items)) {
                    $itemId = Get-FdPropertyValue -Object $item -Name "id"
                    if ($itemId -isnot [string] -or $itemId.Trim().Length -eq 0) {
                        continue
                    }

                    $itemId = $itemId.Trim()
                    $encodedItemId = [uri]::EscapeDataString($itemId)
                    $itemName = Get-FdPropertyValue -Object $item -Name "name"
                    if ($itemName -isnot [string] -or $itemName.Trim().Length -eq 0) {
                        $itemName = "Unnamed SharePoint item"
                    }
                    $itemType = if ($null -ne (Get-FdPropertyValue -Object $item -Name "folder")) {
                        "Folder"
                    }
                    elseif ($null -ne (Get-FdPropertyValue -Object $item -Name "file")) {
                        "File"
                    }
                    else {
                        "Drive item"
                    }
                    $normalizedSiteDisplayName = if ($siteDisplayName -is [string] -and $siteDisplayName.Trim()) {
                        $siteDisplayName.Trim()
                    }
                    else {
                        "Unnamed SharePoint site"
                    }
                    $shared = Get-FdPropertyValue -Object $item -Name "shared"
                    $sharedScope = Get-FdPropertyValue -Object $shared -Name "scope"
                    $normalizedSharedScope = if ($sharedScope -is [string]) {
                        $sharedScope.Trim().ToLowerInvariant()
                    }
                    else {
                        ""
                    }
                    $itemEvidenceId = "item:$driveId`:$itemId"
                    $permissionEvidenceId = $null
                    if ($normalizedSharedScope -eq "anonymous") {
                        $permissionEvidenceId = "item-sharing:$driveId`:$itemId`:anonymous"
                        $anonymousPermissionIds.Add($permissionEvidenceId)
                        $sharedItemIds.Add($itemEvidenceId)
                    }
                    elseif ($normalizedSharedScope -eq "organization") {
                        $permissionEvidenceId = "item-sharing:$driveId`:$itemId`:organization"
                        $organizationPermissionIds.Add($permissionEvidenceId)
                        $sharedItemIds.Add($itemEvidenceId)
                    }
                    if ($null -ne $permissionEvidenceId) {
                        $scopeLabel = if ($normalizedSharedScope -eq "anonymous") {
                            "Anyone link"
                        }
                        else {
                            "Organization-wide link"
                        }
                        $sharedItemDetails.Add([ordered]@{
                            evidenceId        = $permissionEvidenceId
                            itemEvidenceId    = $itemEvidenceId
                            siteId             = $siteId
                            driveId            = $driveId
                            itemId             = $itemId
                            sharingScope      = $normalizedSharedScope
                            itemType          = $itemType
                            displayName       = $itemName.Trim()
                            siteDisplayName   = $normalizedSiteDisplayName
                            driveDisplayName  = $driveDisplayName.Trim()
                            webUrl             = Get-FdPropertyValue -Object $item -Name "webUrl"
                            reason            = "$scopeLabel access was observed on this sampled SharePoint $($itemType.ToLowerInvariant())."
                            recommendedAction = if ($normalizedSharedScope -eq "anonymous") {
                                "Remove the Anyone link unless unauthenticated access is explicitly required, then review access logs and rescan."
                            }
                            else {
                                "Confirm that organization-wide link access is intentional. Replace it with specific people or group access when broad sharing is unnecessary, then rescan."
                            }
                        })
                    }

                    if ($null -ne $shared) {
                        $permissionItemsAttempted++
                        $remainingPermissions = [math]::Max(0, $MaxPermissionsPerSite - $sitePermissionCount)
                        if ($remainingPermissions -eq 0) {
                            $permissionItemsTruncated++
                            continue
                        }
                        $permissionPageSize = [math]::Min(100, $remainingPermissions)
                        $permissionsResult = Invoke-GraphCollection `
                            -Uri "https://graph.microsoft.com/v1.0/drives/$encodedDriveId/items/$encodedItemId/permissions?`$top=$permissionPageSize" `
                            -Maximum $remainingPermissions @collectionArguments
                        $permissionPages += $permissionsResult.pages
                        $permissionRequests += $permissionsResult.requests
                        $permissionsInspected += $permissionsResult.collected
                        $sitePermissionCount += $permissionsResult.collected
                        if ($permissionsResult.failed) {
                            $permissionItemsFailed++
                        }
                        if ($permissionsResult.truncated) {
                            $permissionItemsTruncated++
                        }

                        foreach ($permission in @($permissionsResult.items)) {
                            $identityData = Get-FdPermissionIdentityData -Permission $permission
                            $link = Get-FdPropertyValue -Object $permission -Name "link"
                            $principalTypes = @($identityData.principalTypes)
                            $classification = Get-FdPermissionAccessType `
                                -Permission $permission `
                                -IdentityData $identityData `
                                -GuestDirectoryIds $guestDirectoryIds
                            $permissionId = Get-FdPermissionEvidenceId `
                                -SiteId $siteId `
                                -ResourceId $itemEvidenceId `
                                -Permission $permission
                            $roles = @(
                                Get-FdPropertyValue -Object $permission -Name "roles" |
                                    Where-Object { $_ -is [string] -and $_.Trim() } |
                                    ForEach-Object { $_.Trim().ToLowerInvariant() } |
                                    Sort-Object -Unique
                            )
                            $expiration = Get-FdPropertyValue -Object $permission -Name "expirationDateTime"
                            $inheritedFrom = Get-FdPropertyValue -Object $permission -Name "inheritedFrom"
                            $principalSourceValues = if (@($identityData.principalIds).Count -gt 0) {
                                @($identityData.principalIds)
                            }
                            else {
                                @($identityData.claims)
                            }
                            $principalRefs = @(
                                $principalSourceValues |
                                    Where-Object { $_ -is [string] -and $_.Trim() } |
                                    ForEach-Object { "principal-sha256:$(Get-FdSha256Hex -Text $_.Trim().ToLowerInvariant())" } |
                                    Sort-Object -Unique
                            )
                            $permissionPathDetails.Add([ordered]@{
                                evidenceId         = $permissionId
                                itemEvidenceId     = $itemEvidenceId
                                siteId              = $siteId
                                driveId             = $driveId
                                itemId              = $itemId
                                accessType         = $classification.accessType
                                linkScope          = $classification.linkScope
                                linkType           = Get-FdPropertyValue -Object $link -Name "type"
                                roles              = $roles
                                inherited          = $classification.inherited
                                inheritedFrom      = if ($null -ne $inheritedFrom) {
                                    [ordered]@{
                                        driveId = Get-FdPropertyValue -Object $inheritedFrom -Name "driveId"
                                        id      = Get-FdPropertyValue -Object $inheritedFrom -Name "id"
                                        path    = Get-FdPropertyValue -Object $inheritedFrom -Name "path"
                                    }
                                }
                                else {
                                    $null
                                }
                                expirationDateTime = $expiration
                                principalCount     = [math]::Max(@($identityData.principalIds).Count, @($identityData.displayNames).Count)
                                principalRefs      = $principalRefs
                                principalTypes     = $principalTypes
                                principalNames     = @($identityData.displayNames | Select-Object -First 20)
                                guestPrincipalCount = $classification.guestPrincipalCount
                                itemType           = $itemType
                                displayName        = $itemName.Trim()
                                siteDisplayName    = $normalizedSiteDisplayName
                                driveDisplayName   = $driveDisplayName.Trim()
                                webUrl              = Get-FdPropertyValue -Object $item -Name "webUrl"
                            })
                        }
                    }
                }
            }
        }

        $anonymousSet = Get-FdSortedSet -Values $anonymousPermissionIds
        $organizationSet = Get-FdSortedSet -Values $organizationPermissionIds
        $broadSiteSet = Get-FdSortedSet -Values $broadAccessSiteIds
        $sharedItemSet = Get-FdSortedSet -Values $sharedItemIds
        $permissionPathSet = Get-FdSortedSet -Values @($permissionPathDetails | ForEach-Object { $_.evidenceId })
        $guestSet = Get-FdSortedSet -Values $guestUserIds
        $criticalSet = Get-FdSortedSet -Values $anonymousSet

        $collectionMetadata = [ordered]@{
            organization = [ordered]@{
                required  = $true
                limit     = 1
                collected = $organizationResult.collected
                pages     = $organizationResult.pages
                requests  = $organizationResult.requests
                truncated = $organizationResult.truncated
                failed    = $organizationResult.failed
                failure   = $organizationResult.failure
            }
            subscribedSkus = [ordered]@{
                required  = $true
                limit     = 1000
                collected = $subscribedSkusResult.collected
                pages     = $subscribedSkusResult.pages
                requests  = $subscribedSkusResult.requests
                truncated = $subscribedSkusResult.truncated
                failed    = $subscribedSkusResult.failed
                failure   = $subscribedSkusResult.failure
            }
            users = [ordered]@{
                required  = $true
                limit     = $MaxUsers
                collected = $usersResult.collected
                pages     = $usersResult.pages
                requests  = $usersResult.requests
                truncated = $usersResult.truncated
                failed    = $usersResult.failed
                failure   = $usersResult.failure
            }
            groups = [ordered]@{
                required  = $true
                limit     = $MaxGroups
                collected = $groupsResult.collected
                pages     = $groupsResult.pages
                requests  = $groupsResult.requests
                truncated = $groupsResult.truncated
                failed    = $groupsResult.failed
                failure   = $groupsResult.failure
            }
            publicGroupSites = [ordered]@{
                required  = $false
                attempted = $publicGroupSitesAttempted
                resolved  = $publicGroupSitesResolved
                failed    = $publicGroupSitesFailed
            }
            sites = [ordered]@{
                required  = $true
                limit     = $MaxSites
                candidateLimit = $siteCandidateLimit
                candidatesCollected = $sitesResult.collected
                discovered = $siteSelection.sitesDiscovered
                collected = $siteSelection.sitesSelected
                pages     = $sitesResult.pages
                requests  = $sitesResult.requests
                discoveryTruncated = $sitesResult.truncated
                selectionTruncated = $siteSelection.selectionLimitReached
                truncated = $sitesResult.truncated -or $siteSelection.selectionLimitReached
                failed    = $sitesResult.failed -or $siteMetadataFailureCount -gt 0
                failure   = $sitesResult.failure
                invalidSiteCount = $siteMetadataFailureCount
            }
            drives = [ordered]@{
                required       = $true
                limitPerSite   = $MaxDrivesPerSite
                attempted      = $driveSitesAttempted
                succeeded      = [math]::Max(0, $driveSitesAttempted - [math]::Max($driveSitesFailed, $driveSitesTruncated))
                failedCount    = $driveSitesFailed
                truncatedCount = $driveSitesTruncated
                pages          = $drivePages
                requests       = $driveRequests
                truncated      = $driveSitesTruncated -gt 0
                failed         = $driveSitesFailed -gt 0
            }
            driveItems = [ordered]@{
                required       = $true
                limitPerDrive  = $MaxItemsPerDrive
                attempted      = $drivesAttempted
                succeeded      = [math]::Max(0, $drivesAttempted - [math]::Max($drivesFailed, $drivesTruncated))
                failedCount    = $drivesFailed
                truncatedCount = $drivesTruncated
                collected      = $sampledItems
                pages          = $itemPages
                requests       = $itemRequests
                truncated      = $drivesTruncated -gt 0
                failed         = $drivesFailed -gt 0
            }
            itemSharingEvidence = [ordered]@{
                required       = $true
                inspected      = $sampledItems
                anonymous      = $anonymousPermissionIds.Count
                organization   = $organizationPermissionIds.Count
                truncated      = $drivesTruncated -gt 0
                failed         = $drivesFailed -gt 0
            }
            permissionDetails = [ordered]@{
                required       = $false
                limitPerSite   = $MaxPermissionsPerSite
                itemsAttempted = $permissionItemsAttempted
                collected      = $permissionsInspected
                failedCount    = $permissionItemsFailed
                truncatedCount = $permissionItemsTruncated
                pages          = $permissionPages
                requests       = $permissionRequests
                truncated      = $permissionItemsTruncated -gt 0
                failed         = $permissionItemsFailed -gt 0
            }
        }

        $completenessReasons = [System.Collections.Generic.List[string]]::new()
        foreach ($collectionName in @($contract.requiredCollections)) {
            $metadata = Get-FdPropertyValue -Object $collectionMetadata -Name $collectionName
            if ($null -eq $metadata) {
                $completenessReasons.Add("Required collection '$collectionName' has no metadata.")
                continue
            }
            if ((Get-FdPropertyValue -Object $metadata -Name "failed") -eq $true) {
                $completenessReasons.Add("Required collection '$collectionName' failed.")
            }
            if ((Get-FdPropertyValue -Object $metadata -Name "truncated") -eq $true) {
                $completenessReasons.Add("Required collection '$collectionName' was truncated.")
            }
        }
        if ($organizationResult.collected -ne 1) {
            $completenessReasons.Add("Organization identity was not collected.")
        }
        if ($actorId -eq "unresolved") {
            $completenessReasons.Add("The collecting actor could not be resolved.")
        }

        $coverage = [ordered]@{
            sitesDiscovered       = [int]$siteSelection.sitesDiscovered
            sitesSelected         = [int]$siteSelection.sitesSelected
            sitesScanned          = [int]$driveSitesAttempted
            discoveryComplete     = -not $sitesResult.failed -and -not $sitesResult.truncated -and $siteMetadataFailureCount -eq 0
            selectionComplete     = -not $siteSelection.selectionLimitReached
            limitReached          = $sitesResult.truncated -or $siteSelection.selectionLimitReached
            complete              = $siteSelection.coverageComplete -and $driveSitesAttempted -eq $siteSelection.sitesSelected
        }
        if (-not $coverage.complete) {
            $completenessReasons.Add(
                "Site coverage is incomplete: discovered $($coverage.sitesDiscovered), scanned $($coverage.sitesScanned), limitReached=$($coverage.limitReached)."
            )
        }

        $requiredEvidenceComplete = $completenessReasons.Count -eq 0
        $readiness = Get-FdReadinessCalculation `
            -Contract $contract `
            -AnonymousPermissionCount $anonymousSet.Count `
            -OrganizationPermissionCount $organizationSet.Count `
            -BroadAccessSiteCount $broadSiteSet.Count `
            -ExposedItemCount $sharedItemSet.Count
        $readinessRaw = $readiness.raw
        $readinessScore = if ($requiredEvidenceComplete) {
            $readiness.score
        }
        else {
            $null
        }

        $findings = [System.Collections.Generic.List[object]]::new()
        $rules = Get-FdPropertyValue -Object $contract -Name "rules"
        if ($anonymousSet.Count -gt 0) {
            $rule = Get-FdPropertyValue $rules "anonymousPermissions"
            $findings.Add((New-FdFinding `
                -RuleKey (Get-FdPropertyValue $rule "ruleKey") `
                -Severity (Get-FdPropertyValue $rule "severity") `
                -Title "Anonymous SharePoint access detected" `
                -Detail "$($anonymousSet.Count) anonymous sharing permission entries were detected in the bounded scan." `
                -Impact "$($anonymousSet.Count) permissions" `
                -SourceNode "graph.drive-items.shared" `
                -EvidenceIds $anonymousSet))
        }
        if ($organizationSet.Count -gt 0) {
            $rule = Get-FdPropertyValue $rules "organizationPermissions"
            $findings.Add((New-FdFinding `
                -RuleKey (Get-FdPropertyValue $rule "ruleKey") `
                -Severity (Get-FdPropertyValue $rule "severity") `
                -Title "Organization-wide sharing detected" `
                -Detail "$($organizationSet.Count) organization-scoped sharing permission entries were detected in the bounded scan." `
                -Impact "$($organizationSet.Count) permissions" `
                -SourceNode "graph.drive-items.shared" `
                -EvidenceIds $organizationSet))
        }
        if ($broadSiteSet.Count -gt 0) {
            $rule = Get-FdPropertyValue $rules "broadAccessSites"
            $findings.Add((New-FdFinding `
                -RuleKey (Get-FdPropertyValue $rule "ruleKey") `
                -Severity (Get-FdPropertyValue $rule "severity") `
                -Title "Public Microsoft 365 groups require SharePoint access validation" `
                -Detail "$($broadSiteSet.Count) Microsoft 365 groups are Public; $publicGroupSitesResolved connected SharePoint sites were resolved and $publicGroupSitesFailed require site resolution. Public visibility is not automatically unsafe, but owners should confirm that organization-wide discoverability and joinability are intentional." `
                -Impact "$($broadSiteSet.Count) public groups" `
                -SourceNode "graph.groups.visibility" `
                -EvidenceIds $broadSiteSet))
        }
        if ($guestSet.Count -gt 0) {
            $rule = Get-FdPropertyValue $rules "guestUsers"
            $findings.Add((New-FdFinding `
                -RuleKey (Get-FdPropertyValue $rule "ruleKey") `
                -Severity (Get-FdPropertyValue $rule "severity") `
                -Title "Guest identities require launch review" `
                -Detail "$($guestSet.Count) guest accounts are present in the bounded directory collection." `
                -Impact "$($guestSet.Count) guests" `
                -SourceNode "graph.users.guests" `
                -EvidenceIds $guestSet))
        }
        $permissionFindingDefinitions = @(
            [ordered]@{ accessType = "specific-people-link"; rule = "specificPeopleLinks"; title = "Specific-people SharePoint links require recipient validation" },
            [ordered]@{ accessType = "broad-identity-grant"; rule = "broadIdentityPermissions"; title = "Everyone-style SharePoint permissions require validation" },
            [ordered]@{ accessType = "guest-direct-grant"; rule = "guestDirectPermissions"; title = "Direct guest SharePoint permissions require validation" },
            [ordered]@{ accessType = "group-direct-grant"; rule = "groupDirectPermissions"; title = "Direct SharePoint group permissions require membership review" },
            [ordered]@{ accessType = "user-direct-grant"; rule = "userDirectPermissions"; title = "Direct SharePoint user permissions require business-owner review" },
            [ordered]@{ accessType = "application-grant"; rule = "applicationPermissions"; title = "SharePoint application or agent permissions require governance review" },
            [ordered]@{ accessType = "inherited-permission"; rule = "inheritedPermissions"; title = "Inherited SharePoint permissions require parent-access review" },
            [ordered]@{ accessType = "unclassified-permission"; rule = "unclassifiedPermissions"; title = "Unclassified SharePoint permissions require investigation" }
        )
        foreach ($definition in $permissionFindingDefinitions) {
            $matchingDetails = @(
                $permissionPathDetails |
                    Where-Object { $_.accessType -eq $definition.accessType }
            )
            if ($matchingDetails.Count -eq 0) {
                continue
            }
            $rule = Get-FdPropertyValue $rules $definition.rule
            $findings.Add((New-FdFinding `
                -RuleKey (Get-FdPropertyValue $rule "ruleKey") `
                -Severity (Get-FdPropertyValue $rule "severity") `
                -Title $definition.title `
                -Detail "$($matchingDetails.Count) bounded permission entries of type '$($definition.accessType)' were observed on sampled shared items. This is access metadata, not proof of sensitive-content exposure." `
                -Impact "$($matchingDetails.Count) sampled permissions" `
                -SourceNode "graph.drive-items.permissions" `
                -EvidenceIds @($matchingDetails | ForEach-Object { $_.evidenceId })))
        }
        if (-not $requiredEvidenceComplete) {
            $rule = Get-FdPropertyValue $rules "incompleteEvidence"
            $failureEvidence = @(
                $failedSites |
                    ForEach-Object {
                        $drivePart = if ($_.driveId) { ":$($_.driveId)" } else { "" }
                        "collection:$($_.stage):$($_.siteId)$drivePart"
                    } |
                    Sort-Object -Unique
            )
            $findings.Add((New-FdFinding `
                -RuleKey (Get-FdPropertyValue $rule "ruleKey") `
                -Severity (Get-FdPropertyValue $rule "severity") `
                -Title "Required scan evidence is incomplete" `
                -Detail "One or more required collections failed or reached a configured limit. No verified readiness score was produced." `
                -Impact "$($completenessReasons.Count) completeness conditions" `
                -SourceNode "scanner.collection-metadata" `
                -EvidenceIds $failureEvidence))
        }
        elseif ($anonymousSet.Count -eq 0 -and $organizationSet.Count -eq 0 -and $broadSiteSet.Count -eq 0) {
            $rule = Get-FdPropertyValue $rules "noBroadExposure"
            $findings.Add((New-FdFinding `
                -RuleKey (Get-FdPropertyValue $rule "ruleKey") `
                -Severity (Get-FdPropertyValue $rule "severity") `
                -Title "No broad exposure found in the completed bounded scan" `
                -Detail "The completed bounded scan did not detect anonymous, organization-wide, or broad tenant identity permission paths." `
                -Impact "$($sites.Count) sites" `
                -SourceNode "graph.sites.permissions"))
        }

        $sortedFailedSites = @(
            $failedSites |
                Sort-Object -Property stage, siteId, driveId
        )
        $catalogDomainIds = @(
            Get-FdPropertyValue -Object $readinessCatalog -Name "domains" |
                Sort-Object -Property order |
                ForEach-Object { Get-FdPropertyValue -Object $_ -Name "id" }
        )
        $contractDomainIds = @(
            Get-FdPropertyValue -Object $contract -Name "estateDomains"
        )
        if ($catalogDomainIds.Count -ne $contractDomainIds.Count -or
            @(Compare-Object -ReferenceObject $contractDomainIds -DifferenceObject $catalogDomainIds -SyncWindow 0).Count -gt 0) {
            throw "The readiness catalog and scan contract domain registries do not match."
        }

        $domainOverrides = @{
            licensingAndTenantEntitlement = @{
                status = "Partial"
                summary = "$($subscribedSkusResult.collected) tenant subscriptions and their service plans were inventoried. Cohort licence assignment, prerequisite plans, and renewal dates still require additional evidence."
                nextStep = "Define the Copilot cohort and connect user licence-assignment and subscription-renewal evidence."
            }
            identityAndAccess = @{
                status = "Partial"
                summary = "$($users.Count) users, $($guestSet.Count) guests, and $($groups.Count) groups were inventoried. MFA, Conditional Access, identity risk, privileged roles, and stale-account controls were not assessed."
                nextStep = "Connect authentication, Conditional Access, risk, and privileged-role evidence."
            }
            sharePointOneDrive = @{
                status = "Partial"
                summary = "$($coverage.sitesScanned) SharePoint sites and $sampledItems root-level items were scanned. Effective permissions, SharePoint Advanced Management, restricted discovery, Data Access Governance, and lifecycle controls were not assessed."
                nextStep = "Review the sharing findings, then expand SharePoint and OneDrive governance evidence."
            }
        }
        $estateDomains = @(
            Get-FdPropertyValue -Object $readinessCatalog -Name "domains" |
                Sort-Object -Property order |
                ForEach-Object {
                    $domainId = Get-FdRequiredString -Value (Get-FdPropertyValue -Object $_ -Name "id") -Name "catalog.domain.id"
                    $domainName = Get-FdRequiredString -Value (Get-FdPropertyValue -Object $_ -Name "name") -Name "catalog.domain.name"
                    $controls = @(Get-FdPropertyValue -Object $_ -Name "controls")
                    $override = $domainOverrides[$domainId]
                    [ordered]@{
                        id = $domainId
                        name = $domainName
                        status = if ($null -ne $override) { $override.status } else { "NotCollected" }
                        summary = if ($null -ne $override) {
                            $override.summary
                        }
                        else {
                            "No evidence was collected for the $domainName domain."
                        }
                        nextStep = if ($null -ne $override) {
                            $override.nextStep
                        }
                        else {
                            "Connect the required evidence sources and evaluate the $($controls.Count) catalog controls in this domain."
                        }
                        catalogControls = $controls.Count
                    }
                }
        )
        $partialDomainCount = @($estateDomains | Where-Object { $_.status -eq "Partial" }).Count
        $collectedDomainCount = @($estateDomains | Where-Object { $_.status -eq "Collected" }).Count
        $catalogControlCounts = @(
            Get-FdPropertyValue -Object $readinessCatalog -Name "domains" |
                ForEach-Object { @(Get-FdPropertyValue -Object $_ -Name "controls").Count } |
                ForEach-Object { [int]$_ }
        )
        $totalCatalogControls = [int](($catalogControlCounts | Measure-Object -Sum).Sum)
        $generatedAt = (Get-Date).ToUniversalTime()
        $collectorRunId = [guid]::NewGuid().ToString()
        $controlResults = @(
            New-FdControlResults `
                -ReadinessCatalog $readinessCatalog `
                -TenantId $normalizedTenantId `
                -ActorId $actorId `
                -CollectorRunId $collectorRunId `
                -ObservedAt $generatedAt
        )
        $licenceInventoryResult = @(
            $controlResults | Where-Object { $_.controlId -eq "AFD-LIC-004" }
        )[0]
        if (-not $subscribedSkusResult.failed -and -not $subscribedSkusResult.truncated) {
            $skuInventory = @(
                $subscribedSkusResult.items |
                    Sort-Object -Property skuPartNumber |
                    ForEach-Object {
                        $prepaidUnits = Get-FdPropertyValue -Object $_ -Name "prepaidUnits"
                        [ordered]@{
                            id = Get-FdPropertyValue -Object $_ -Name "id"
                            skuId = Get-FdPropertyValue -Object $_ -Name "skuId"
                            skuPartNumber = Get-FdPropertyValue -Object $_ -Name "skuPartNumber"
                            consumedUnits = Get-FdPropertyValue -Object $_ -Name "consumedUnits"
                            enabledUnits = Get-FdPropertyValue -Object $prepaidUnits -Name "enabled"
                            suspendedUnits = Get-FdPropertyValue -Object $prepaidUnits -Name "suspended"
                            warningUnits = Get-FdPropertyValue -Object $prepaidUnits -Name "warning"
                            servicePlans = @(
                                Get-FdPropertyValue -Object $_ -Name "servicePlans" |
                                    Sort-Object -Property servicePlanName |
                                    ForEach-Object {
                                        [ordered]@{
                                            servicePlanId = Get-FdPropertyValue -Object $_ -Name "servicePlanId"
                                            servicePlanName = Get-FdPropertyValue -Object $_ -Name "servicePlanName"
                                            provisioningStatus = Get-FdPropertyValue -Object $_ -Name "provisioningStatus"
                                        }
                                    }
                            )
                        }
                    }
            )
            $licenceInventoryResult.status = "Pass"
            $licenceInventoryResult.observedValue = [ordered]@{
                skuCount = $skuInventory.Count
                skus = $skuInventory
            }
            $licenceInventoryResult.coverage = [pscustomobject][ordered]@{
                population = $skuInventory.Count
                evaluated = $skuInventory.Count
                complete = $true
                excluded = 0
                reason = "All subscribed SKUs returned by Microsoft Graph were inventoried."
            }
            $licenceInventoryResult.confidence = 1
            $licenceInventoryResult.provenance.source = "Microsoft Graph /subscribedSkus"
            $licenceInventoryResult.evidenceRefs = @(
                $skuInventory |
                    Where-Object { $_.id -is [string] -and $_.id.Length -gt 0 } |
                    ForEach-Object {
                        [pscustomobject][ordered]@{
                            id = "sku:$($_.id)"
                            kind = "microsoftGraphSubscribedSku"
                            etag = $null
                            digest = $null
                        }
                    }
            )
            $licenceInventoryResult.limitations = @()
        }
        else {
            $licenceInventoryResult.limitations = @(
                [pscustomobject][ordered]@{
                    code = "SUBSCRIBED_SKUS_COLLECTION_INCOMPLETE"
                    description = "Microsoft Graph subscribed SKU evidence failed or was truncated, so add-on entitlement inventory remains Unknown."
                }
            )
        }
        $evaluatedControlCount = @($controlResults | Where-Object { $_.status -ne "Unknown" }).Count
        $unknownControlCount = @($controlResults | Where-Object { $_.status -eq "Unknown" }).Count
        $result = [ordered]@{
            schemaVersion   = Get-FdPropertyValue $contract "schemaVersion"
            documentType    = Get-FdPropertyValue $contract "documentType"
            producer        = $producer
            producerVersion = $producerVersion
            scoringVersion  = $scoringVersion
            policyHash      = $policyHash
            configHash      = $configurationHash
            generatedAt     = $generatedAt.ToString("o")
            tenant          = [ordered]@{
                id          = Get-FdPropertyValue -Object $tenant -Name "id"
                displayName = $tenantDisplayName
                tenantId    = $normalizedTenantId
            }
            auth            = [ordered]@{
                mode  = $AuthMode
                actor = [ordered]@{
                    type = $actorType
                    id   = $actorId
                }
            }
            scope           = [ordered]@{
                mode                      = $scopeDefinition.mode
                maximumSites              = $scopeDefinition.maximumSites
                maximumDrivesPerSite      = $scopeDefinition.maximumDrivesPerSite
                maximumItemsPerDrive      = $scopeDefinition.maximumItemsPerDrive
                maximumUsers              = $scopeDefinition.maximumUsers
                maximumGroups             = $scopeDefinition.maximumGroups
                maximumPermissionsPerSite = $scopeDefinition.maximumPermissionsPerSite
                maximumGraphRequests      = $scopeDefinition.maximumGraphRequests
                requiredPermissions       = $scopeDefinition.requiredPermissions
                grantedScopes             = @(Get-FdPropertyValue -Object $context -Name "Scopes" | Sort-Object -Unique)
                contentRetrieved          = $scopeDefinition.contentRetrieved
                authMode                  = $scopeDefinition.authMode
                actorType                 = $scopeDefinition.actorType
                siteSelection             = $scopeDefinition.siteSelection
                itemSelection             = $scopeDefinition.itemSelection
                fingerprint               = $scopeFingerprint
            }
            completeness    = [ordered]@{
                status                   = if ($requiredEvidenceComplete) { "Complete" } else { "Incomplete" }
                requiredEvidenceComplete = $requiredEvidenceComplete
                reasons                  = @($completenessReasons | Sort-Object -Unique)
                failedSites              = $sortedFailedSites
            }
            estateAssessment = [ordered]@{
                assessmentType = "microsoft-365-copilot-estate-readiness"
                overallStatus = "InsufficientEvidence"
                decision = "EvidenceCollectionRequired"
                catalogVersion = Get-FdPropertyValue -Object $readinessCatalog -Name "catalogVersion"
                collectedDomains = $collectedDomainCount
                partialDomains = $partialDomainCount
                requiredDomains = $estateDomains.Count
                totalControls = $totalCatalogControls
                evaluatedControls = $evaluatedControlCount
                unknownControls = $unknownControlCount
                cohorts = @(
                    [ordered]@{
                        id = "tenant-wide"
                        name = "Tenant-wide baseline"
                        description = "Default estate-wide cohort used until explicit Copilot pilot and production cohorts are configured."
                        population = $users.Count
                        source = "Microsoft Graph users inventory"
                    }
                )
                controlResults = $controlResults
                domains = $estateDomains
            }
            coverage        = $coverage
            collectionMetadata = $collectionMetadata
            summary         = [ordered]@{
                readinessScore          = $readinessScore
                readinessScoreVerified  = $requiredEvidenceComplete
                readinessScoreStatus    = if ($requiredEvidenceComplete) { "Verified" } else { "NotCalculatedIncompleteEvidence" }
                readinessRaw            = if ($requiredEvidenceComplete) { $readinessRaw } else { $null }
                readinessSaturated      = if ($requiredEvidenceComplete) { $readiness.saturated } else { $false }
                criticalExposures       = $criticalSet.Count
                users                   = $users.Count
                memberUsers            = $memberUserCount
                enabledMemberUsers     = $enabledMemberUserCount
                guests                 = $guestSet.Count
                groups                  = $groups.Count
                sitesDiscovered         = $coverage.sitesDiscovered
                sitesScanned            = $coverage.sitesScanned
                broadAccessSites        = $broadSiteSet.Count
                anonymousLinks          = $anonymousSet.Count
                organizationLinks       = $organizationSet.Count
                sampledItems            = $sampledItems
                exposedItems            = $sharedItemSet.Count
                permissionPaths         = $permissionPathSet.Count
                graphRequests           = [int]$requestState.Count
            }
            scoringInputs   = [ordered]@{
                anonymousPermissionCount  = $anonymousSet.Count
                organizationPermissionCount = $organizationSet.Count
                broadAccessSiteCount       = $broadSiteSet.Count
                sharedItemCount            = $sharedItemSet.Count
                penalties                  = $readiness.penalties
            }
            findings        = @($findings)
            evidenceSets    = [ordered]@{
                anonymousPermissionIds  = $anonymousSet
                organizationPermissionIds = $organizationSet
                broadAccessSiteIds      = $broadSiteSet
                sharedItemIds           = $sharedItemSet
                permissionPathIds       = $permissionPathSet
                guestUserIds            = $guestSet
                criticalEvidenceIds     = $criticalSet
            }
            evidenceDetails = [ordered]@{
                broadAccessSites = @($broadAccessDetails | Sort-Object -Property displayName, evidenceId)
                sharedItems = @($sharedItemDetails | Sort-Object -Property sharingScope, siteDisplayName, driveDisplayName, displayName, evidenceId)
                permissionPaths = @($permissionPathDetails | Sort-Object -Property accessType, siteDisplayName, driveDisplayName, displayName, evidenceId)
            }
            limitations     = @(
                "The scanner reads metadata and permissions only. It does not retrieve document content.",
                "Drive item collection is limited to root children and does not recursively inspect every file.",
                "Exposed item evidence includes sampled root items whose Graph shared scope is anonymous or organization-wide.",
                "Detailed permissions are collected only for sampled root items that Graph marks as shared, remain bounded per site, and do not expand nested group membership.",
                "Public Microsoft 365 groups are review signals, not automatic security defects.",
                "This collector contributes only partial identity and data-sharing evidence to an estate-wide Copilot readiness assessment.",
                "A configured collection limit makes required evidence incomplete and prevents a verified readiness score.",
                "Purview labels, DLP, Defender posture, Copilot usage, and agent inventory require separate collectors.",
                "The readiness score is decision support and is not a compliance certification."
            )
        }

        $resolvedOutput = Write-FdJsonFile -Value $result -Path $OutputPath -Depth 32
        Write-Host ""
        Write-Host "Read-only scan complete."
        Write-Host "Tenant: $tenantDisplayName"
        Write-Host "Sites discovered/scanned: $($coverage.sitesDiscovered)/$($coverage.sitesScanned)"
        Write-Host "Site coverage complete: $($coverage.complete)"
        Write-Host "Completeness: $($result.completeness.status)"
        Write-Host "Readiness score status: $($result.summary.readinessScoreStatus)"
        Write-Host "Output: $resolvedOutput"
    }
    finally {
        $restHeaders = $null
        $graphAccessToken = $null
        if ($ownsConnection) {
            Disconnect-MgGraph -ErrorAction SilentlyContinue | Out-Null
        }
    }
}

if ($MyInvocation.InvocationName -ne ".") {
    try {
        Invoke-FdTenantScan
    }
    catch {
        $stack = $_.ScriptStackTrace
        if ([string]::IsNullOrWhiteSpace($stack)) {
            throw
        }
        Write-Error "$($_.Exception.Message)`n$stack"
        exit 1
    }
}
