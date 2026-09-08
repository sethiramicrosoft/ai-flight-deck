# Read-only Power Platform producer helpers. Dot-sourcing has no external side effects.
# Interfaces checked against Microsoft Learn and Microsoft-signed module 2.0.216:
# https://learn.microsoft.com/power-platform/admin/powerapps-powershell
# https://learn.microsoft.com/powershell/module/microsoft.powerapps.administration.powershell/get-jwttoken
# https://learn.microsoft.com/powershell/module/microsoft.powerapps.administration.powershell/get-adminpowerappenvironment
# https://learn.microsoft.com/powershell/module/microsoft.powerapps.administration.powershell/get-admindlppolicy
# https://learn.microsoft.com/powershell/module/microsoft.powerapps.administration.powershell/get-adminpowerappconnector
# https://learn.microsoft.com/power-apps/developer/data-platform/reference/entities/bot
# https://learn.microsoft.com/power-apps/developer/data-platform/webapi/query/page-results
# https://learn.microsoft.com/power-apps/developer/data-platform/webapi/reference/whoami
# https://learn.microsoft.com/power-apps/developer/data-platform/webapi/reference/retrievesharedprincipalsandaccess
# ## Lessons
# Admin cmdlets expose neither page cursors nor an authoritative total.
# Bot publication, record sharing and ownership are not governance approval.

function Get-PPField {
    param($Object, [string]$Path)
    $value = $Object
    foreach ($part in $Path.Split('.')) {
        if ($null -eq $value) { return $null }
        if ($value -is [System.Collections.IDictionary]) { $value = $value[$part] }
        else {
            $property = $value.PSObject.Properties[$part]
            if ($null -eq $property) { return $null }
            $value = $property.Value
        }
    }
    # Preserve empty and singleton arrays (PowerShell otherwise unwraps pipeline output).
    return ,$value
}

function ConvertTo-PPSafeScalar {
    param($Value)
    if ($null -eq $Value) { return $null }
    if ($Value -is [bool] -or $Value -is [ValueType]) { return $Value }
    if ($Value -isnot [string]) { return $null }
    # Do not serialize arbitrary configuration, token objects, descriptions or endpoint query strings.
    $text = $Value -replace '(?i)(Bearer\s+\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)', '[redacted]'
    if ($text.Length -gt 1024) { return $text.Substring(0, 1024) + '[truncated]' }
    return $text
}

function Select-PPSafeFields {
    param($Object, [string[]]$Fields)
    $result = [ordered]@{}
    foreach ($field in $Fields) {
        $value = Get-PPField $Object $field
        if ($null -ne $value) { $result[$field] = ConvertTo-PPSafeScalar $value }
    }
    return $result
}

function Assert-PPGuid {
    param([string]$Value)
    $parsed = [guid]::Empty
    if (-not [guid]::TryParseExact($Value, 'D', [ref]$parsed) -or $parsed -eq [guid]::Empty) {
        throw 'PP_INVALID_ID'
    }
    return $parsed.ToString('D')
}

function Get-PPTokenIdentity {
    param([string]$Token, [string]$ExpectedTenantId, [string]$Audience, [string]$ExpectedActorId)
    # Tokens come only from the authenticated Microsoft module, never from files or input.
    # JWT decoding is context binding, not a substitute for service-side signature validation.
    try {
        $parts = $Token.Split('.')
        if ($parts.Count -ne 3) { throw 'invalid' }
        $payload = $parts[1].Replace('-', '+').Replace('_', '/')
        $payload += '=' * ((4 - $payload.Length % 4) % 4)
        $claims = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload)) | ConvertFrom-Json
        $tenant = Assert-PPGuid ([string](Get-PPField $claims 'tid'))
        $actor = Assert-PPGuid ([string](Get-PPField $claims 'oid'))
        $expires = [double](Get-PPField $claims 'exp')
        $actualAudience = [string](Get-PPField $claims 'aud')
        if ($expires -le [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()) { throw 'invalid' }
    }
    catch { throw 'PP_AUTH_CONTEXT_INVALID' }
    if ($tenant -ne $ExpectedTenantId) { throw 'PP_TENANT_MISMATCH' }
    if ($ExpectedActorId -and $actor -ne $ExpectedActorId) { throw 'PP_ACTOR_MISMATCH' }
    if ($actualAudience.TrimEnd('/') -ne $Audience.TrimEnd('/')) { throw 'PP_TOKEN_AUDIENCE_MISMATCH' }
    return [ordered]@{ tenantId = $tenant; actorId = $actor; source = 'Microsoft.PowerApps.Administration.PowerShell/Get-JwtToken' }
}

function Assert-PPDataverseUrl {
    param([string]$Url, [string]$Origin)
    $uri = $null
    if (-not [uri]::TryCreate($Url, [UriKind]::Absolute, [ref]$uri) -or
        $uri.Scheme -ne 'https' -or $uri.Port -ne 443 -or $uri.UserInfo -or $uri.Fragment -or
        $uri.DnsSafeHost -notmatch '^[a-z0-9-]+(?:\.api)?\.crm(?:[0-9]+)?\.dynamics\.com$') {
        throw 'PP_UNSUPPORTED_DATAVERSE_URL'
    }
    if ($Origin) {
        $base = [uri]$Origin
        if ($uri.Authority -ne $base.Authority -or -not $uri.AbsolutePath.StartsWith('/api/data/v9.2/')) {
            throw 'PP_UNSAFE_CONTINUATION'
        }
    }
    elseif ($uri.AbsolutePath -ne '/' -or $uri.Query) { throw 'PP_UNSUPPORTED_DATAVERSE_URL' }
    return $uri
}

function Get-PPSafeError {
    param($ErrorRecord)
    # Never persist arbitrary service error bodies: they can contain request headers or secrets.
    $message = [string]$ErrorRecord.Exception.Message
    $code = if ($message -match '^PP_[A-Z0-9_]+$') { $message } else { 'PP_OPERATION_FAILED' }
    if ($message -match '(?i)AADSTS65001|consent_required') { $code = 'PP_CONSENT_REQUIRED' }
    elseif ($message -match '(?i)AADSTS50076|interaction_required') { $code = 'PP_INTERACTIVE_AUTH_REQUIRED' }
    elseif ($message -match '(?i)forbidden|unauthorized|\b403\b') { $code = 'PP_HTTP_403' }
    $description = switch ($code) {
        'PP_WINDOWS_POWERSHELL_51_REQUIRED' { 'Launch this workload with Windows PowerShell 5.1 (powershell.exe), not pwsh.exe. The Microsoft PowerApps administration module requires .NET Framework. Keep the same arguments and parent process-tree cancellation.' }
        'PP_MODULE_INSTALL_DISABLED' { 'The pinned Power Platform administration module is absent and automatic installation was disabled. Enable application-managed CurrentUser module installation and retry.' }
        'PP_HTTP_401' { 'The workload rejected authentication. Sign in again through the application.' }
        'PP_HTTP_403' { 'The workload denied access. An authorized Power Platform administrator and Dataverse reader privileges are required; no roles were changed.' }
        'PP_HTTP_404' { 'The environment does not expose this Dataverse table or operation, or it is not visible to this principal.' }
        'PP_HTTP_429' { 'The workload throttled collection. The application can retry later; no unbounded retry was attempted.' }
        'PP_CONSENT_REQUIRED' { 'Microsoft sign-in requires administrator consent for this workload. Complete the application-launched consent flow.' }
        'PP_INTERACTIVE_AUTH_REQUIRED' { 'Complete the application-launched Microsoft browser sign-in and MFA.' }
        'PP_TENANT_MISMATCH' { 'The authenticated workload tenant differs from the requested tenant. No evidence from that context was accepted.' }
        'PP_ACTOR_MISMATCH' { 'The Dataverse sign-in principal differs from the Power Platform collector principal. No evidence from that context was accepted.' }
        'PP_REQUEST_LIMIT' { 'The configured operation/request budget was reached. Remaining resources are excluded, not empty.' }
        'PP_PAGE_LIMIT' { 'The page or item limit was reached before enumeration completed.' }
        'PP_UNSUPPORTED_DATAVERSE_URL' { 'No supported commercial-cloud Dataverse organization URL was available. Sovereign clouds and non-Dataverse environments are not assumed supported.' }
        default { 'Automatic read-only collection could not verify this resource. Check workload availability, administrator role, delegated consent and the recorded safe error code; no export or JSON entry is required.' }
    }
    return [ordered]@{ code = $code; message = $description }
}

function Add-PPProblem {
    param($Document, [string[]]$Resources, [string]$Code, [string]$Message, [string]$EnvironmentId)
    foreach ($resource in $Resources) {
        $problem = [ordered]@{ code = $Code; message = $Message }
        if ($EnvironmentId) { $problem.environmentId = $EnvironmentId }
        $Document.collection.resources[$resource].issues.Add($problem)
        if ($Code -match 'LIMIT$|TOO_LARGE$') {
            $Document.collection.resources[$resource].truncated = $true
        }
        # Preserve first actual failure as the consumer-facing error; boundaries are added last.
        if (-not $Document.errors.Contains($resource)) {
            $Document.errors[$resource] = [ordered]@{ code = $Code; message = $Message }
        }
    }
}

function Use-PPBudget {
    param($State)
    if ($State.operations -ge $State.maxRequests) { throw 'PP_REQUEST_LIMIT' }
    $State.operations++
}

function Invoke-PPHttpGet {
    param([string]$Url, [string]$Token, [int]$TimeoutSeconds, [int]$PageSize, [int]$MaxResponseBytes = 8388608)
    Add-Type -AssemblyName System.Net.Http
    $handler = New-Object System.Net.Http.HttpClientHandler
    $handler.AllowAutoRedirect = $false
    $client = New-Object System.Net.Http.HttpClient($handler)
    $client.Timeout = [TimeSpan]::FromSeconds($TimeoutSeconds)
    $response = $null
    $stream = $null
    $buffer = New-Object System.IO.MemoryStream
    $cancel = New-Object System.Threading.CancellationTokenSource
    $cancel.CancelAfter([TimeSpan]::FromSeconds($TimeoutSeconds))
    try {
        $client.DefaultRequestHeaders.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue('Bearer', $Token)
        $client.DefaultRequestHeaders.Add('Accept', 'application/json')
        $client.DefaultRequestHeaders.Add('OData-Version', '4.0')
        $client.DefaultRequestHeaders.Add('OData-MaxVersion', '4.0')
        $client.DefaultRequestHeaders.Add('Prefer', "odata.maxpagesize=$PageSize,odata.include-annotations=`"Microsoft.Dynamics.CRM.lookuplogicalname`"")
        $response = $client.GetAsync($Url, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead, $cancel.Token).GetAwaiter().GetResult()
        if (-not $response.IsSuccessStatusCode) { throw "PP_HTTP_$([int]$response.StatusCode)" }
        if ($response.Content.Headers.ContentLength -gt $MaxResponseBytes) { throw 'PP_RESPONSE_TOO_LARGE' }
        $stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $chunk = New-Object byte[] 65536
        while (($read = $stream.ReadAsync($chunk, 0, $chunk.Length, $cancel.Token).GetAwaiter().GetResult()) -gt 0) {
            if ($buffer.Length + $read -gt $MaxResponseBytes) { throw 'PP_RESPONSE_TOO_LARGE' }
            $buffer.Write($chunk, 0, $read)
        }
        return ([Text.Encoding]::UTF8.GetString($buffer.ToArray()) | ConvertFrom-Json)
    }
    finally {
        if ($stream) { $stream.Dispose() }
        if ($response) { $response.Dispose() }
        $buffer.Dispose()
        $cancel.Dispose()
        $client.Dispose()
        $handler.Dispose()
        $Token = $null
    }
}

function Get-PPPages {
    param([string]$Url, [string]$Origin, [string]$Token, $State, [scriptblock]$Request, [int]$MaxItems)
    $rows = New-Object 'System.Collections.Generic.List[object]'
    $seen = New-Object 'System.Collections.Generic.HashSet[string]'
    $pages = 0
    $next = $Url
    $failure = $null
    try {
        while ($next) {
            Assert-PPDataverseUrl $next $Origin | Out-Null
            if (-not $seen.Add($next)) { throw 'PP_PAGING_LOOP' }
            if ($pages -ge $State.maxPages -or $rows.Count -ge $MaxItems) { throw 'PP_PAGE_LIMIT' }
            Use-PPBudget $State
            $page = & $Request $next $Token $State.timeoutSeconds $State.pageSize
            $pages++
            $values = Get-PPField $page 'value'
            if ($null -eq $values -or $values -isnot [array]) { throw 'PP_INVALID_RESPONSE' }
            foreach ($row in $values) {
                if ($rows.Count -ge $MaxItems) { throw 'PP_PAGE_LIMIT' }
                $rows.Add($row)
            }
            $nextProperty = $page.PSObject.Properties['@odata.nextLink']
            $next = if ($nextProperty) { [string]$nextProperty.Value } else { $null }
        }
    }
    catch { $failure = Get-PPSafeError $_ }
    return [ordered]@{ rows = $rows.ToArray(); pages = $pages; complete = ($null -eq $failure); error = $failure }
}

function New-PPLiveOperations {
    return @{
        SignIn = {
            param($Tenant, $Audience)
            Add-PowerAppsAccount -TenantID $Tenant -Audience $Audience -Endpoint prod -UseSystemBrowser $true `
                -ErrorAction Stop -Verbose:$false -Debug:$false 3>$null 4>$null 5>$null 6>$null | Out-Null
            Get-JwtToken -Audience $Audience -ErrorAction Stop -Verbose:$false -Debug:$false 3>$null 4>$null 5>$null 6>$null
        }
        Environments = { param($Limit) Get-AdminPowerAppEnvironment -ErrorAction Stop -Verbose:$false -Debug:$false 3>$null 4>$null 5>$null 6>$null | Select-Object -First $Limit }
        Policies = { param($Limit) Get-AdminDlpPolicy -ErrorAction Stop -Verbose:$false -Debug:$false 3>$null 4>$null 5>$null 6>$null | Select-Object -First $Limit }
        Connectors = { param($Environment, $Limit) Get-AdminPowerAppConnector -EnvironmentName $Environment -ErrorAction Stop -Verbose:$false -Debug:$false 3>$null 4>$null 5>$null 6>$null | Select-Object -First $Limit }
        Request = { param($Url, $Token, $Timeout, $PageSize) Invoke-PPHttpGet $Url $Token $Timeout $PageSize }
    }
}

function Invoke-PPEvidenceCollection {
    param(
        [string]$TenantId, [string]$CollectionChallenge, [hashtable]$Operations,
        [int]$MaxEnvironments = 50, [int]$MaxItems = 2000, [int]$MaxRequests = 500,
        [int]$MaxPages = 20, [int]$PageSize = 250, [int]$RequestTimeoutSeconds = 45
    )
    $tenant = Assert-PPGuid $TenantId
    $audience = 'https://service.powerapps.com/'
    # Identity failure is fatal: never emit a success-shaped package stamped with requested input.
    $token = & $Operations.SignIn $tenant $audience
    $identity = Get-PPTokenIdentity $token $tenant $audience
    $token = $null
    $state = @{ operations = 0; maxRequests = $MaxRequests; maxPages = $MaxPages; pageSize = $PageSize; timeoutSeconds = $RequestTimeoutSeconds; sharedPrincipals = 0 }
    $resources = @('environments', 'dlpPolicies', 'connectors', 'agents', 'agentOwners', 'agentSharing', 'agentLifecycle')
    $botResources = @('agents', 'agentOwners', 'agentSharing', 'agentLifecycle')
    $doc = [ordered]@{
        schema = 'ai-flight-deck/power-platform-evidence'; version = '1.0.0'
        producerId = 'ai-flight-deck/power-platform-evidence-collector'; producerVersion = '1.0.0'
        collectionChallenge = $CollectionChallenge
        tenantId = $identity.tenantId; actorId = $identity.actorId
        producedAt = $null; evidence = [ordered]@{}; errors = [ordered]@{}
        collection = [ordered]@{
            authentication = $identity; cloud = 'commercial'; readOnly = $true
            limits = @{ maxEnvironments = $MaxEnvironments; maxItemsPerResource = $MaxItems; maxOperationsAndExplicitRequests = $MaxRequests; maxPagesPerQuery = $MaxPages; pageSize = $PageSize; requestTimeoutSeconds = $RequestTimeoutSeconds; maxHttpResponseBytes = 8388608 }
            resources = [ordered]@{}; environments = (New-Object 'System.Collections.Generic.List[object]')
            excludedEnvironments = (New-Object 'System.Collections.Generic.List[object]')
            physicalAdminHttpRequestCount = $null
            adminPagination = 'Module-managed/opaque: cmdlets expose neither page cursors nor totals. Item caps bound accepted output, not internal HTTP requests. The process deadline bounds opaque operations.'
            effectivePermissions = 'Caller-visible environments, DLP policies and custom connectors only. Dataverse row-level security applies independently per environment. Tenant-wide and organization-wide visibility are not proven.'
            omittedSensitiveFields = @('configuration', 'authenticationconfiguration', 'applicationmanifestinformation', 'connector connectionParameters', 'credentials', 'tokens', 'bot content and transcripts')
            governanceBoundary = 'No business-purpose approval, publishing authorization, secret hygiene, DLP alignment, prompt-injection review or legal attestation is inferred from inventory.'
        }
    }
    foreach ($resource in $resources) {
        $doc.evidence[$resource] = New-Object 'System.Collections.Generic.List[object]'
        $doc.collection.resources[$resource] = [ordered]@{
            returnedCount = 0; populationCount = $null; complete = $false
            truncated = $false; excludedCount = $null
            issues = (New-Object 'System.Collections.Generic.List[object]')
        }
    }
    $envRows = @()
    try {
        Use-PPBudget $state
        $envRows = @(& $Operations.Environments ($MaxEnvironments + 1))
        if ($envRows.Count -gt $MaxEnvironments) {
            Add-PPProblem $doc $resources 'PP_ENVIRONMENT_LIMIT' 'Environment inventory exceeded the configured limit. Excluded environments and their resources were not evaluated.'
            $doc.collection.excludedEnvironments.Add(@{ reason = 'environment limit'; countAtLeast = ($envRows.Count - $MaxEnvironments) })
            $envRows = @($envRows | Select-Object -First $MaxEnvironments)
        }
        foreach ($environment in $envRows) {
            $id = [string](Get-PPField $environment 'EnvironmentName')
            if (-not $id -or $id -notmatch '^[a-zA-Z0-9_-]{1,160}$') { throw 'PP_INVALID_RESPONSE' }
            $doc.evidence.environments.Add([ordered]@{
                id = $id; displayName = ConvertTo-PPSafeScalar (Get-PPField $environment 'DisplayName')
                securityGroupId = ConvertTo-PPSafeScalar (Get-PPField $environment 'SecurityGroupId')
                raw = Select-PPSafeFields $environment @('EnvironmentName', 'DisplayName', 'EnvironmentType', 'Location', 'OrganizationId', 'SecurityGroupId', 'CommonDataServiceDatabaseProvisioningState')
            })
        }
    }
    catch {
        $problem = Get-PPSafeError $_
        Add-PPProblem $doc $resources $problem.code $problem.message
        $envRows = @()
    }
    try {
        Use-PPBudget $state
        $policies = @(& $Operations.Policies ($MaxItems + 1))
        if ($policies.Count -gt $MaxItems) { Add-PPProblem $doc @('dlpPolicies') 'PP_ITEM_LIMIT' 'DLP policy output was capped; policy coverage is incomplete.' }
        foreach ($policy in @($policies | Select-Object -First $MaxItems)) {
            $id = [string](Get-PPField $policy 'PolicyName')
            if (-not $id) { throw 'PP_INVALID_RESPONSE' }
            $policyEnvironments = Get-PPField $policy 'Environments'
            $groups = [ordered]@{}
            foreach ($pair in @(@('business', 'BusinessDataGroup'), @('nonBusiness', 'NonBusinessDataGroup'), @('blocked', 'BlockedGroup'))) {
                $rawGroup = Get-PPField $policy $pair[1]
                if ($null -ne $rawGroup) {
                    $groups[$pair[0]] = @($rawGroup | Select-Object -First $MaxItems | ForEach-Object { Select-PPSafeFields $_ @('id', 'name', 'type') })
                    if (@($rawGroup).Count -gt $MaxItems) { Add-PPProblem $doc @('dlpPolicies') 'PP_ITEM_LIMIT' 'DLP connector group entries were capped.' }
                }
            }
            $doc.evidence.dlpPolicies.Add([ordered]@{
                id = ConvertTo-PPSafeScalar $id; connectorGroups = $groups
                raw = Select-PPSafeFields $policy @('PolicyName', 'DisplayName', 'Type', 'FilterType', 'CreatedTime', 'LastModifiedTime')
                environmentFilter = @($policyEnvironments | Select-Object -First $MaxItems | ForEach-Object {
                    if ($_ -is [string]) { ConvertTo-PPSafeScalar $_ } else { Select-PPSafeFields $_ @('id', 'name') }
                })
            })
            if (@($policyEnvironments).Count -gt $MaxItems) {
                Add-PPProblem $doc @('dlpPolicies') 'PP_ITEM_LIMIT' 'DLP policy environment-filter entries were capped.'
            }
        }
    }
    catch { $problem = Get-PPSafeError $_; Add-PPProblem $doc @('dlpPolicies') $problem.code $problem.message }
    foreach ($environment in $envRows) {
        $envId = [string](Get-PPField $environment 'EnvironmentName')
        try {
            Use-PPBudget $state
            $remaining = $MaxItems - $doc.evidence.connectors.Count
            if ($remaining -le 0) { throw 'PP_PAGE_LIMIT' }
            $connectors = @(& $Operations.Connectors $envId ($remaining + 1))
            if ($connectors.Count -gt $remaining) { Add-PPProblem $doc @('connectors') 'PP_ITEM_LIMIT' 'Custom connector output was capped.' $envId }
            foreach ($connector in @($connectors | Select-Object -First $remaining)) {
                $id = [string](Get-PPField $connector 'ConnectorName')
                if (-not $id) { throw 'PP_INVALID_RESPONSE' }
                $doc.evidence.connectors.Add([ordered]@{
                    id = ConvertTo-PPSafeScalar $id; environmentId = $envId; sourceKind = 'customConnector'
                    raw = Select-PPSafeFields $connector @('ConnectorName', 'DisplayName', 'EnvironmentName', 'CreatedTime', 'LastModifiedTime')
                })
            }
        }
        catch { $problem = Get-PPSafeError $_; Add-PPProblem $doc @('connectors') $problem.code $problem.message $envId }
    }
    foreach ($environment in $envRows) {
        $envId = [string](Get-PPField $environment 'EnvironmentName')
        $environmentStatus = [ordered]@{ environmentId = $envId; botPages = 0; botsReturned = 0; inventoryCompleteWithinCallerScope = $false; unsupportedColumns = @() }
        $doc.collection.environments.Add($environmentStatus)
        $token = $null
        try {
            $remaining = $MaxItems - $doc.evidence.agents.Count
            if ($remaining -le 0) { throw 'PP_PAGE_LIMIT' }
            $url = [string](Get-PPField $environment 'Internal.properties.linkedEnvironmentMetadata.instanceUrl')
            $origin = (Assert-PPDataverseUrl $url).GetLeftPart([UriPartial]::Authority)
            Use-PPBudget $state
            $token = & $Operations.SignIn $tenant "$origin/"
            Get-PPTokenIdentity $token $tenant "$origin/" $identity.actorId | Out-Null
            Use-PPBudget $state
            $who = & $Operations.Request "$origin/api/data/v9.2/WhoAmI" $token $state.timeoutSeconds $PageSize
            $userId = Assert-PPGuid ([string](Get-PPField $who 'UserId'))
            $organizationId = Assert-PPGuid ([string](Get-PPField $who 'OrganizationId'))
            $expectedOrg = [string](Get-PPField $environment 'OrganizationId')
            if ($expectedOrg -and (Assert-PPGuid $expectedOrg) -ne $organizationId) { throw 'PP_ORGANIZATION_MISMATCH' }
            $environmentStatus.dataverseUserId = $userId
            $environmentStatus.dataverseOrganizationId = $organizationId
            # Discover supported columns independently in every environment.
            $metadata = Get-PPPages "$origin/api/data/v9.2/EntityDefinitions(LogicalName='bot')/Attributes?`$select=LogicalName,IsValidForRead" $origin $token $state $Operations.Request $MaxItems
            if (-not $metadata.complete) { throw $metadata.error.code }
            $available = @($metadata.rows | Where-Object { (Get-PPField $_ 'IsValidForRead') -eq $true } | ForEach-Object { [string](Get-PPField $_ 'LogicalName') })
            if ($available -notcontains 'botid') { throw 'PP_BOT_TABLE_UNAVAILABLE' }
            $desired = @('botid', 'name', 'schemaname', 'ownerid', 'statecode', 'statuscode', 'authenticationmode', 'accesscontrolpolicy', 'authorizedsecuritygroupids', 'providerconnectionreferenceid', 'publishedon', 'publishedby', 'createdon', 'modifiedon')
            $environmentStatus.unsupportedColumns = @($desired | Where-Object { $available -notcontains $_ })
            $columns = @($desired | Where-Object { $available -contains $_ } | ForEach-Object {
                if ($_ -in @('ownerid', 'publishedby', 'providerconnectionreferenceid')) { "_${_}_value" } else { $_ }
            })
            $page = Get-PPPages "$origin/api/data/v9.2/bots?`$select=$($columns -join ',')&`$orderby=botid" $origin $token $state $Operations.Request $remaining
            $environmentStatus.botPages = $page.pages
            $environmentStatus.botsReturned = $page.rows.Count
            $environmentStatus.inventoryCompleteWithinCallerScope = $page.complete
            if ($page.error) { Add-PPProblem $doc $botResources $page.error.code $page.error.message $envId }
            foreach ($bot in $page.rows) {
                $botId = Assert-PPGuid ([string](Get-PPField $bot 'botid'))
                # Composite IDs avoid collisions when solutions carry the same bot ID between environments.
                $id = "${envId}:$botId"
                $doc.evidence.agents.Add([ordered]@{
                    id = $id; botId = $botId; environmentId = $envId
                    name = ConvertTo-PPSafeScalar (Get-PPField $bot 'name')
                    raw = Select-PPSafeFields $bot $columns
                })
                $owner = [string](Get-PPField $bot '_ownerid_value')
                if ($owner) {
                    $ownerAnnotation = $bot.PSObject.Properties['_ownerid_value@Microsoft.Dynamics.CRM.lookuplogicalname']
                    $doc.evidence.agentOwners.Add([ordered]@{
                        agentId = $id; environmentId = $envId; ownerId = Assert-PPGuid $owner
                        ownerIdNamespace = 'Dataverse'; ownerType = if ($ownerAnnotation) { ConvertTo-PPSafeScalar $ownerAnnotation.Value } else { $null }
                        source = 'bot._ownerid_value'
                    })
                }
                else { Add-PPProblem $doc @('agentOwners') 'PP_OWNER_UNAVAILABLE' 'Dataverse did not return a readable record owner for every bot.' $envId }
                $doc.evidence.agentLifecycle.Add([ordered]@{
                    agentId = $id; environmentId = $envId
                    raw = Select-PPSafeFields $bot @('statecode', 'statuscode', 'publishedon', '_publishedby_value', 'createdon', 'modifiedon')
                    publishingApproval = 'unknown'; source = 'Dataverse bot metadata; publication is not approval'
                })
                try {
                    Use-PPBudget $state
                    $target = [uri]::EscapeDataString(('{ "@odata.id": "bots(' + $botId + ')" }'))
                    $share = & $Operations.Request "$origin/api/data/v9.2/RetrieveSharedPrincipalsAndAccess(Target=@p1)?@p1=$target" $token $state.timeoutSeconds $PageSize
                    $accesses = Get-PPField $share 'PrincipalAccesses'
                    if ($null -eq $accesses -or $accesses -isnot [array]) { throw 'PP_INVALID_RESPONSE' }
                    $remainingShares = $MaxItems - $state.sharedPrincipals
                    if ($accesses.Count -gt $remainingShares) { Add-PPProblem $doc @('agentSharing') 'PP_ITEM_LIMIT' 'Explicit shared principal entries were capped across the collection.' $envId }
                    $safeShares = @($accesses | Select-Object -First $remainingShares | ForEach-Object {
                        [ordered]@{
                            accessMask = ConvertTo-PPSafeScalar (Get-PPField $_ 'AccessMask')
                            principal = Select-PPSafeFields (Get-PPField $_ 'Principal') @('systemuserid', 'teamid', 'organizationid')
                        }
                    })
                    $state.sharedPrincipals += $safeShares.Count
                    $doc.evidence.agentSharing.Add([ordered]@{
                        agentId = $id; environmentId = $envId; explicitRecordShares = $safeShares
                        raw = Select-PPSafeFields $bot @('accesscontrolpolicy', 'authenticationmode', 'authorizedsecuritygroupids')
                        publicExposure = 'unknown'; effectiveAccess = 'unknown'
                    })
                }
                catch { $problem = Get-PPSafeError $_; Add-PPProblem $doc @('agentSharing') $problem.code $problem.message $envId }
            }
        }
        catch {
            $problem = Get-PPSafeError $_
            Add-PPProblem $doc $botResources $problem.code $problem.message $envId
            $doc.collection.excludedEnvironments.Add(@{ environmentId = $envId; reason = $problem.code; scope = 'Dataverse evidence or remaining records' })
        }
        finally { $token = $null }
    }
    $boundaries = @{
        environments = 'Caller-visible environment inventory does not prove tenant completeness; purpose, accountable owner and evaluated DLP association are not authoritative inventory fields.'
        dlpPolicies = 'Legacy admin DLP cmdlet output has opaque pagination. Policy filters are retained without fabricating tenant scope or appliesToAll; modern action/endpoint rules and effective policy intersection are not fully evaluated.'
        connectors = 'Get-AdminPowerAppConnector returns custom connectors only, not the complete standard connector catalogue or agent usage, credential hygiene and effective DLP approval.'
        agents = 'Dataverse bots are collected per accessible environment. Record visibility is not tenant-wide proof; business-purpose approvals, knowledge/tool security reviews and secret hygiene remain unknown.'
        agentOwners = 'Dataverse record ownership is not an accountable business-owner approval. Team membership and complete organization-level bot visibility are not proven.'
        agentSharing = 'Explicit Dataverse shares and bot access/authentication modes do not establish effective role/team/inherited access, runtime channel exposure or publishing approval.'
        agentLifecycle = 'Bot state, status, publisher and publication dates are facts, not an authorized publishing decision or legal approval. Approval remains unknown.'
    }
    foreach ($resource in $resources) {
        $count = $doc.evidence[$resource].Count
        if ($count -eq 0) { Add-PPProblem $doc @($resource) 'PP_NO_VERIFIABLE_RECORDS' 'No verifiable records were collected for this resource; this does not establish absence or compliance.' }
        Add-PPProblem $doc @($resource) 'PP_INCOMPLETE_EVIDENCE' $boundaries[$resource]
        $doc.collection.resources[$resource].returnedCount = $count
        $doc.evidence[$resource] = $doc.evidence[$resource].ToArray()
    }
    $doc.collection.operationsAndExplicitRequests = $state.operations
    $doc.collection.explicitSharedPrincipalsReturned = $state.sharedPrincipals
    $doc.producedAt = [DateTime]::UtcNow.ToString('o')
    return $doc
}
