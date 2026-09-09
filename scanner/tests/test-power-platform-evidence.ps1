# Synthetic-only regression tests. No module installation, sign-in or tenant calls.
# 2026-09-08: real PP interfaces must not become fabricated approval/completeness.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\PowerPlatform.Evidence.ps1')
$script:passed = 0
$script:failed = 0
function Assert-PPTest($Condition, $Message) { if (-not $Condition) { throw $Message } }
function Test-PPCase([string]$Name, [scriptblock]$Operation) {
    try { & $Operation; $script:passed++; Write-Host "PASS: $Name" }
    catch { $script:failed++; Write-Host "FAIL: $Name -- $($_.Exception.Message)"; Write-Host $_.ScriptStackTrace }
}
function Assert-PPThrows([scriptblock]$Operation, [string]$Code) {
    try { & $Operation | Out-Null } catch { Assert-PPTest ($_.Exception.Message -eq $Code) "Expected $Code; received $($_.Exception.Message)"; return }
    throw "Expected $Code"
}
$script:tenant = '11111111-1111-1111-1111-111111111111'
$script:actor = '22222222-2222-2222-2222-222222222222'
$script:org = '33333333-3333-3333-3333-333333333333'
$script:botId = '44444444-4444-4444-4444-444444444444'
$script:ownerId = '55555555-5555-5555-5555-555555555555'
function New-PPTestToken($Audience, $Tenant = $script:tenant, $Actor = $script:actor, $Expires = ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + 3600)) {
    $json = @{ aud = $Audience; tid = $Tenant; oid = $Actor; exp = $Expires } | ConvertTo-Json -Compress
    $body = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json)).TrimEnd('=').Replace('+','-').Replace('/','_')
    return "eyJzeW50aGV0aWMiOnRydWV9.$body.synthetic-signature"
}
function New-PPTestEnvironment($Id = 'environment-1', $Url = 'https://synthetic.crm.dynamics.com') {
    return [pscustomobject]@{
        EnvironmentName = $Id; DisplayName = 'Synthetic environment'; OrganizationId = $script:org
        SecurityGroupId = $script:ownerId
        Internal = @{ properties = @{ linkedEnvironmentMetadata = @{ instanceUrl = $Url } } }
    }
}
function New-PPTestOperations {
    $script:requests = New-Object 'System.Collections.Generic.List[string]'
    return @{
        SignIn = { param($Tenant, $Audience) New-PPTestToken $Audience }
        ContextToken = { param($Audience) New-PPTestToken $Audience }
        EnvironmentDetail = { param($Environment) New-PPTestEnvironment $Environment }
        Environments = { param($Limit) New-PPTestEnvironment }
        Apps = { param($Environment,$Limit) [pscustomobject]@{AppName='app-1';EnvironmentName=$Environment;DisplayName='Synthetic app';UnpublishedAppDefinition='SYNTHETIC-SECRET'} }
        Flows = { param($Environment,$Limit) [pscustomobject]@{FlowName='flow-1';EnvironmentName=$Environment;Internal=@{properties=@{state='Started';definition='SYNTHETIC-SECRET'}}} }
        Connections = { param($Environment,$Limit) [pscustomobject]@{ConnectionName='connection-1';ConnectorName='shared-example';EnvironmentName=$Environment;Internal=@{connectionString='SYNTHETIC-SECRET'}} }
        Policies = {
            param($Limit)
            [pscustomobject]@{
                PolicyName = 'policy-1'; FilterType = 'Exclude'
                BusinessDataGroup = @([pscustomobject]@{id='connector-1'; name='business'})
                NonBusinessDataGroup = @(); BlockedGroup = @()
                Environments = @('excluded-environment')
            }
        }
        Connectors = { param($Environment, $Limit) [pscustomobject]@{ConnectorName='connector-1'; EnvironmentName=$Environment; connectionParameters=@{password='SYNTHETIC-SECRET'}} }
        Request = {
            param($Url, $Token, $Timeout, $PageSize)
            $script:requests.Add($Url)
            if ($Url -match '/WhoAmI$') { return [pscustomobject]@{ UserId=$script:actor; OrganizationId=$script:org } }
            if ($Url -match '/Attributes\?') {
                return [pscustomobject]@{ value = @('botid','name','ownerid','statecode','statuscode','authenticationmode','accesscontrolpolicy','publishedon','publishedby' | ForEach-Object { [pscustomobject]@{LogicalName=$_;IsValidForRead=$true} }) }
            }
            if ($Url -match '/bots\?') {
                return [pscustomobject]@{ value = @([pscustomobject]@{
                    botid=$script:botId; name='Synthetic bot'; _ownerid_value=$script:ownerId
                    '_ownerid_value@Microsoft.Dynamics.CRM.lookuplogicalname'='team'
                    statecode=0; statuscode=1; authenticationmode=1; accesscontrolpolicy=0
                    publishedon='2026-09-01T00:00:00Z'; _publishedby_value=$script:actor
                    configuration='SYNTHETIC-SECRET'; authenticationconfiguration='SYNTHETIC-SECRET'
                }) }
            }
            if ($Url -match '/RetrieveSharedPrincipalsAndAccess') {
                return [pscustomobject]@{ PrincipalAccesses = @([pscustomobject]@{ AccessMask='ReadAccess,WriteAccess'; Principal=[pscustomobject]@{teamid=$script:ownerId; secret='SYNTHETIC-SECRET'} }) }
            }
            throw 'Unexpected synthetic URL'
        }
    }
}
function Invoke-PPTestCollection($Operations, [int]$MaxEnvironments=50, [int]$MaxItems=2000, [int]$MaxRequests=500) {
    Invoke-PPEvidenceCollection -TenantId $script:tenant -CollectionChallenge ('a' * 40) -Operations $Operations -MaxEnvironments $MaxEnvironments -MaxItems $MaxItems -MaxRequests $MaxRequests
}
Test-PPCase 'Both producer scripts parse on the current PowerShell engine' {
    foreach ($name in @('PowerPlatform.Evidence.ps1','collect-power-platform-evidence.ps1')) {
        $tokens=$null; $errors=$null
        [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot "..\$name"),[ref]$tokens,[ref]$errors) | Out-Null
        Assert-PPTest ($errors.Count -eq 0) "AST error in $name"
    }
}
Test-PPCase 'Application invocation accepts InstallMissingModules without executing collection' {
    $command = Get-Command (Join-Path $PSScriptRoot '..\collect-power-platform-evidence.ps1')
    foreach ($parameter in @('TenantId', 'WorkspacePath', 'OutputPath', 'CollectionChallenge', 'InstallMissingModules')) {
        Assert-PPTest ($command.Parameters.ContainsKey($parameter)) "Missing application parameter $parameter"
    }
    Assert-PPTest ($command.Parameters['InstallMissingModules'].ParameterType -eq [System.Management.Automation.SwitchParameter]) 'Installation flag is not a switch'
}
Test-PPCase 'Unsupported host reports explicit parent host selection and installation stays noninteractive' {
    try { throw 'PP_WINDOWS_POWERSHELL_51_REQUIRED' } catch { $problem = Get-PPSafeError $_ }
    Assert-PPTest ($problem.message -match 'powershell.exe' -and $problem.message -match 'not pwsh.exe') 'Host action is ambiguous'
    $source = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\collect-power-platform-evidence.ps1') -Raw
    $helper = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\FlightDeck.Modules.ps1') -Raw
    Assert-PPTest ($helper -match 'Install-PackageProvider[^\r\n]+-Scope CurrentUser -Force -Confirm:\$false') 'NuGet bootstrap can prompt or install machine-wide'
    Assert-PPTest ($source -match 'Resolve-FdModule -Name \$moduleName -RequiredVersion \$moduleVersion -InstallMissingModules:\$InstallMissingModules') 'Pinned private bootstrap is not used'
    Assert-PPTest ($helper -match 'Save-Module @saveParameters' -and $helper -match 'Path = \$root') 'Dependencies are not saved privately'
    Assert-PPTest ($source -notmatch 'Set-PSRepository|Set-ExecutionPolicy|Start-Process') 'Global trust/policy mutation or detached child added'
}
Test-PPCase 'Private module failures provide local recovery without changing policy' {
    foreach ($code in @('PP_MODULE_LOCAL_PATH_UNSAFE', 'PP_MODULE_ALREADY_LOADED_OUTSIDE_STORE',
        'PP_MODULE_GALLERY_SOURCE_REJECTED', 'PP_MODULE_DOWNLOAD_FAILED', 'PP_MODULE_IMPORT_FAILED',
        'PP_MODULE_INSTALL_DISABLED')) {
        try { throw $code } catch { $problem = Get-PPSafeError $_ }
        Assert-PPTest ($problem.code -eq $code) 'Private bootstrap error code was lost'
        Assert-PPTest ($problem.message -notmatch 'CurrentUser|Automatic read-only collection could not verify this resource') 'Private bootstrap recovery is stale or generic'
    }
}
Test-PPCase 'Real interface fixture produces all seven arrays with actual identity and unknown boundaries' {
    $doc = Invoke-PPTestCollection (New-PPTestOperations)
    Assert-PPTest ($doc.tenantId -eq $script:tenant -and $doc.actorId -eq $script:actor) 'Wrong identity'
    Assert-PPTest ($doc.schema -eq 'ai-flight-deck/power-platform-evidence' -and $doc.version -eq '1.0.0') 'Wrong schema'
    Assert-PPTest ($doc.producerVersion -eq '1.0.0' -and $doc.collectionChallenge -eq ('a'*40)) 'Wrong producer'
    foreach ($key in @('environments','dlpPolicies','connectors','agents','agentOwners','agentSharing','agentLifecycle','apps','flows','connections')) {
        Assert-PPTest ($doc.evidence[$key] -is [array]) "$key is not an array"
        Assert-PPTest ($doc.evidence[$key].Count -eq 1) "$key did not collect its row"
        Assert-PPTest ($doc.errors.Contains($key)) "$key lacks visibility/semantic boundary"
        Assert-PPTest (-not $doc.collection.resources[$key].complete) "$key is falsely complete"
        Assert-PPTest ($doc.collection.resources[$key].acquisitionStatus -eq 'collected') "$key successful read was misclassified"
        Assert-PPTest ($doc.collection.resources[$key].acquisitionErrors.Count -eq 0) "$key coverage caveat was classified as an acquisition error"
    }
    Assert-PPTest ($doc.evidence.agentOwners[0].ownerType -eq 'team') 'Owner type lost'
    Assert-PPTest ($doc.collection.environments[0].inventoryCompleteWithinCallerScope) 'Completed in-scope pages lost'
    Assert-PPTest ($doc.evidence.agentSharing[0].explicitRecordShares[0].principal.teamid -eq $script:ownerId) 'Shared team lost'
    Assert-PPTest ($doc.evidence.agentLifecycle[0].raw.publishedon -eq '2026-09-01T00:00:00Z') 'Publication fact lost'
    Assert-PPTest (-not $doc.evidence.agentLifecycle[0].Contains('approvedBy')) 'Publication fabricated approval'
    Assert-PPTest (-not $doc.evidence.dlpPolicies[0].Contains('appliesToAll')) 'Exclusion policy became all environments'
    $json = $doc | ConvertTo-Json -Depth 30
    Assert-PPTest ($json -notmatch 'SYNTHETIC-SECRET|synthetic-signature') 'Sensitive fields leaked'
    $roundTrip = $json | ConvertFrom-Json
    Assert-PPTest ($roundTrip.evidence.agents -is [array]) 'Singleton array lost during JSON serialization'
}
Test-PPCase 'Wrong authenticated tenant fails without emitting a package' {
    $ops = New-PPTestOperations
    $ops.SignIn = { param($Tenant,$Audience) New-PPTestToken $Audience 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }
    Assert-PPThrows { Invoke-PPTestCollection $ops } 'PP_TENANT_MISMATCH'
}
Test-PPCase 'Wrong Dataverse actor excludes that environment rather than misattributing evidence' {
    $ops = New-PPTestOperations
    $ops.SignIn = { param($Tenant,$Audience) if ($Audience -match 'service.powerapps') { New-PPTestToken $Audience } else { New-PPTestToken $Audience $script:tenant 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' } }
    $doc = Invoke-PPTestCollection $ops
    Assert-PPTest ($doc.errors.agents.code -eq 'PP_ACTOR_MISMATCH' -and $doc.evidence.agents.Count -eq 0) 'Actor mismatch accepted'
}
Test-PPCase 'Expired and wrong-audience tokens are rejected' {
    Assert-PPThrows { Get-PPTokenIdentity (New-PPTestToken 'https://service.powerapps.com/' $script:tenant $script:actor 1) $script:tenant 'https://service.powerapps.com/' } 'PP_AUTH_CONTEXT_INVALID'
    Assert-PPThrows { Get-PPTokenIdentity (New-PPTestToken 'https://graph.microsoft.com/') $script:tenant 'https://service.powerapps.com/' } 'PP_TOKEN_AUDIENCE_MISMATCH'
}
Test-PPCase 'Empty workload arrays remain arrays and are explicitly unknown' {
    $ops = New-PPTestOperations; $ops.Environments = { param($Limit) }; $ops.Policies = { param($Limit) }
    $doc = Invoke-PPTestCollection $ops
    foreach ($key in $doc.evidence.Keys) {
        Assert-PPTest ($doc.evidence[$key] -is [array] -and $doc.evidence[$key].Count -eq 0) 'Empty array lost'
        Assert-PPTest ($doc.errors[$key].code -eq 'PP_NO_VERIFIABLE_RECORDS') 'Empty treated as success'
    }
}
Test-PPCase 'Environment cap reports exclusions and propagates incomplete scope' {
    $ops = New-PPTestOperations; $ops.Environments = { param($Limit) New-PPTestEnvironment 'one'; New-PPTestEnvironment 'two' }
    $doc = Invoke-PPTestCollection $ops 1
    Assert-PPTest ($doc.evidence.environments.Count -eq 1 -and $doc.collection.excludedEnvironments.Count -gt 0) 'Environment cap missing'
    foreach ($key in $doc.evidence.Keys) { Assert-PPTest ($doc.errors[$key].code -eq 'PP_ENVIRONMENT_LIMIT') 'Scope loss not propagated' }
}
Test-PPCase 'Per-environment metadata support is not inferred from a previous environment' {
    $ops=New-PPTestOperations; $base=$ops.Request
    $ops.Environments={ param($Limit) New-PPTestEnvironment 'one'; New-PPTestEnvironment 'two' 'https://other.crm.dynamics.com' }
    $ops.Request={
        param($Url,$Token,$Timeout,$PageSize)
        if ($Url -match 'other.crm' -and $Url -match '/Attributes\?') { throw 'PP_HTTP_404' }
        & $base $Url $Token $Timeout $PageSize
    }.GetNewClosure()
    $doc=Invoke-PPTestCollection $ops
    Assert-PPTest ($doc.evidence.agents.Count -eq 1 -and $doc.errors.agents.code -eq 'PP_HTTP_404') 'Unsupported second environment silently succeeded'
    Assert-PPTest ($doc.collection.environments.Count -eq 2) 'Environment coverage omitted'
}
Test-PPCase 'Service denial is actionable and raw errors never enter evidence' {
    $ops=New-PPTestOperations; $ops.Policies={ throw '403 Authorization Bearer SYNTHETIC-SECRET' }
    $doc=Invoke-PPTestCollection $ops
    Assert-PPTest ($doc.errors.dlpPolicies.code -eq 'PP_HTTP_403') 'Denied role not identified'
    Assert-PPTest (($doc | ConvertTo-Json -Depth 30) -notmatch 'SYNTHETIC-SECRET') 'Error leaked secret'
}
Test-PPCase 'Budget is bounded with actionable remaining-resource failures' {
    $doc=Invoke-PPTestCollection (New-PPTestOperations) 50 2000 2
    Assert-PPTest ($doc.collection.operationsAndExplicitRequests -eq 2) 'Budget exceeded'
    Assert-PPTest ($doc.errors.agents.code -eq 'PP_REQUEST_LIMIT') 'Budget failure not propagated'
}
Test-PPCase 'Continuation paging keeps singleton rows and detects loops and unsafe next links' {
    $state=@{operations=0;maxRequests=20;maxPages=5;pageSize=1;timeoutSeconds=5}
    $origin='https://synthetic.crm.dynamics.com'
    $first="$origin/api/data/v9.2/bots?x=1"
    $second="$origin/api/data/v9.2/bots?x=2"
    $request={ param($Url) if($Url -match 'x=1$'){[pscustomobject]@{value=@([pscustomobject]@{id=1});'@odata.nextLink'=$second}}else{[pscustomobject]@{value=@([pscustomobject]@{id=2})}} }.GetNewClosure()
    $page=Get-PPPages $first $origin 'synthetic' $state $request 10
    Assert-PPTest ($page.complete -and $page.rows.Count -eq 2 -and $page.pages -eq 2) 'Paging failed'
    $request={ param($Url) [pscustomobject]@{value=@([pscustomobject]@{id=1});'@odata.nextLink'=$first} }.GetNewClosure()
    $page=Get-PPPages $first $origin 'synthetic' $state $request 10
    Assert-PPTest ($page.error.code -eq 'PP_PAGING_LOOP' -and $page.rows.Count -eq 1) 'Loop not bounded'
    $request={ param($Url) [pscustomobject]@{value=@();'@odata.nextLink'='https://evil.example/api/data/v9.2/bots'} }
    $page=Get-PPPages $first $origin 'synthetic' $state $request 10
    Assert-PPTest (-not $page.complete -and $page.pages -eq 1) 'Unsafe next link followed'
}
Test-PPCase 'Page and item caps retain partial data without marking complete' {
    $state=@{operations=0;maxRequests=20;maxPages=1;pageSize=1;timeoutSeconds=5}
    $origin='https://synthetic.crm.dynamics.com'
    $request={ param($Url) [pscustomobject]@{value=@([pscustomobject]@{id=1});'@odata.nextLink'='https://synthetic.crm.dynamics.com/api/data/v9.2/bots?next=1'} }
    $page=Get-PPPages "$origin/api/data/v9.2/bots" $origin 'synthetic' $state $request 1
    Assert-PPTest ($page.error.code -eq 'PP_PAGE_LIMIT' -and $page.rows.Count -eq 1 -and $page.pages -eq 1) 'Truncated list accepted'
}
Test-PPCase 'Empty terminal OData page is complete only within explicit query scope' {
    $state=@{operations=0;maxRequests=20;maxPages=2;pageSize=1;timeoutSeconds=5}
    $page=Get-PPPages 'https://synthetic.crm.dynamics.com/api/data/v9.2/bots' 'https://synthetic.crm.dynamics.com' 'synthetic' $state { [pscustomobject]@{value=@()} } 10
    Assert-PPTest ($page.complete -and $page.rows -is [array] -and $page.rows.Count -eq 0) 'Empty terminal page shape broken'
}
Test-PPCase 'Dataverse endpoint safety rejects credential URLs and cross-origin continuations' {
    foreach($url in @('http://synthetic.crm.dynamics.com','https://127.0.0.1','https://synthetic.crm.dynamics.com.evil.example','https://user:pass@synthetic.crm.dynamics.com')) {
        Assert-PPThrows { Assert-PPDataverseUrl $url } 'PP_UNSUPPORTED_DATAVERSE_URL'
    }
    Assert-PPThrows { Assert-PPDataverseUrl 'https://other.crm.dynamics.com/api/data/v9.2/bots' 'https://synthetic.crm.dynamics.com' } 'PP_UNSAFE_CONTINUATION'
}
Test-PPCase 'Live HTTP helper uses GET only, bounded responses and no redirects' {
    $source=Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\PowerPlatform.Evidence.ps1') -Raw
    Assert-PPTest ($source -match '\.GetAsync\(' -and $source -match 'AllowAutoRedirect = \$false' -and $source -match 'PP_RESPONSE_TOO_LARGE') 'HTTP safety boundary missing'
    Assert-PPTest ($source -notmatch '\.(Post|Put|Patch|Delete)Async\(') 'Tenant mutation added'
}
Test-PPCase 'Apps flows and connections collect across environments without Dataverse' {
    $ops = New-PPTestOperations
    $ops.Environments = { param($Limit) New-PPTestEnvironment 'one' ''; New-PPTestEnvironment 'two' '' }
    $ops.EnvironmentDetail = { param($Environment) New-PPTestEnvironment $Environment '' }
    $doc = Invoke-PPTestCollection $ops
    foreach ($resource in @('apps','flows','connections')) {
        Assert-PPTest ($doc.evidence[$resource].Count -eq 2) "$resource only used the first environment"
        Assert-PPTest ($doc.collection.resources[$resource].acquisitionStatus -eq 'collected') "$resource was blocked by Dataverse"
        Assert-PPTest ($doc.collection.resources[$resource].acquisitionErrors.Count -eq 0) "$resource inherited a Dataverse error"
        foreach ($scope in $doc.collection.environments) { Assert-PPTest ($scope.resources[$resource].returnedCount -eq 1) "$resource lacks per-environment counts" }
    }
    Assert-PPTest ($doc.collection.resources.agents.acquisitionStatus -eq 'unavailable') 'Missing endpoint was not distinguished from denied access'
    Assert-PPTest ($doc.errors.agents.code -eq 'PP_DATAVERSE_ENDPOINT_NOT_RETURNED') 'Endpoint absence was misreported as invalid URL'
    Assert-PPTest ($script:requests.Count -eq 0) 'Guessed a Dataverse endpoint'
    Assert-PPTest (($doc | ConvertTo-Json -Depth 30) -notmatch 'SYNTHETIC-SECRET') 'Inventory leaked definitions or connection strings'
}
Test-PPCase 'Detailed endpoint discovery revalidates identity and retains safe discovery facts' {
    $ops = New-PPTestOperations
    $ops.Environments = {
        param($Limit)
        $row = New-PPTestEnvironment 'environment-1' ''
        $row.OrganizationId = $null
        $row | Add-Member -NotePropertyName CommonDataServiceDatabaseProvisioningState -NotePropertyValue 'Succeeded'
        $row
    }
    $script:detailCalls = 0
    $ops.EnvironmentDetail = {
        param($Environment)
        $script:detailCalls++
        Assert-PPTest ($Environment -eq 'environment-1') 'Detail was not scoped to requested environment'
        $row=New-PPTestEnvironment $Environment
        $row.OrganizationId=$null
        $row.Internal.properties.linkedEnvironmentMetadata.resourceId=$script:org
        $row
    }
    $doc = Invoke-PPTestCollection $ops
    $discovery=$doc.collection.environments[0].discovery
    Assert-PPTest ($script:detailCalls -eq 1 -and $doc.evidence.agents.Count -eq 1) 'Detail endpoint was not used'
    Assert-PPTest ($discovery.contextValidatedBeforeAndAfter -and $discovery.source -eq 'environmentDetail') 'Detail binding provenance missing'
    Assert-PPTest ($discovery.databaseExistence -eq 'unknown') 'Generic provisioning state became database proof'
    Assert-PPTest ($doc.collection.resources.agents.acquisitionStatus -eq 'collected') 'Successful detailed acquisition incorrectly failed'
}
Test-PPCase 'Detailed endpoint access denial remains failed while other inventories succeed' {
    $ops=New-PPTestOperations
    $ops.Environments={ param($Limit) New-PPTestEnvironment 'environment-1' '' }
    $ops.EnvironmentDetail={ param($Environment) throw 'PP_HTTP_403' }
    $doc=Invoke-PPTestCollection $ops
    Assert-PPTest ($doc.collection.resources.agents.acquisitionStatus -eq 'failed') 'Denied lookup misclassified as database absence'
    Assert-PPTest ($doc.collection.resources.agents.acquisitionErrors[0].code -eq 'PP_HTTP_403') 'Lookup error missing'
    Assert-PPTest ($doc.collection.resources.apps.acquisitionStatus -eq 'collected') 'Dataverse failure blocked apps'
    Assert-PPTest ($script:requests.Count -eq 0) 'Denied lookup was followed by a guessed endpoint'
}
Test-PPCase 'Cross-environment detail and changed tenant context are rejected' {
    $ops=New-PPTestOperations
    $ops.Environments={ param($Limit) New-PPTestEnvironment 'environment-1' '' }
    $ops.EnvironmentDetail={ param($Environment) New-PPTestEnvironment 'another-environment' }
    $doc=Invoke-PPTestCollection $ops
    Assert-PPTest ($doc.errors.agents.code -eq 'PP_ENVIRONMENT_DETAIL_MISMATCH' -and $script:requests.Count -eq 0) 'Wrong environment detail accepted'
    $script:contextReads=0
    $ops.EnvironmentDetail={ param($Environment) New-PPTestEnvironment $Environment }
    $ops.ContextToken={
        param($Audience)
        $script:contextReads++
        if($script:contextReads -eq 1){New-PPTestToken $Audience}else{New-PPTestToken $Audience 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'}
    }
    $doc=Invoke-PPTestCollection $ops
    Assert-PPTest ($doc.errors.agents.code -eq 'PP_TENANT_MISMATCH' -and $script:requests.Count -eq 0) 'Changed post-read tenant context accepted'
}
Test-PPCase 'Malformed detailed URLs do not leak query secrets or become absent database claims' {
    $ops=New-PPTestOperations
    $ops.Environments={ param($Limit) New-PPTestEnvironment 'environment-1' '' }
    $ops.EnvironmentDetail={ param($Environment) New-PPTestEnvironment $Environment 'https://synthetic.crm.dynamics.com/?token=SYNTHETIC-SECRET' }
    $doc=Invoke-PPTestCollection $ops
    Assert-PPTest ($doc.errors.agents.code -eq 'PP_UNSUPPORTED_DATAVERSE_URL') 'Malformed URL was treated as absent database'
    Assert-PPTest (($doc | ConvertTo-Json -Depth 30) -notmatch 'SYNTHETIC-SECRET') 'Detailed URL query leaked'
}
Test-PPCase 'Successful empty acquisition differs from failed query and missing interface' {
    $ops=New-PPTestOperations
    $ops.Apps={param($Environment,$Limit)}
    $ops.Flows={param($Environment,$Limit) throw 'PP_HTTP_403'}
    $ops.Remove('Connections')
    $doc=Invoke-PPTestCollection $ops
    Assert-PPTest ($doc.collection.resources.apps.acquisitionStatus -eq 'collected' -and $doc.evidence.apps.Count -eq 0) 'Successful empty query not collected'
    Assert-PPTest ($doc.collection.resources.apps.acquisitionErrors.Count -eq 0) 'Successful empty query gained a retrieval error'
    Assert-PPTest ($doc.collection.resources.flows.acquisitionStatus -eq 'failed' -and $doc.evidence.flows.Count -eq 0) 'Failed query looks empty-successful'
    Assert-PPTest ($doc.collection.resources.connections.acquisitionStatus -eq 'unavailable') 'Missing interface looks empty-successful'
    Assert-PPTest ($doc.collection.resources.connections.acquisitionErrors[0].code -eq 'PP_COMMAND_UNAVAILABLE') 'Missing command lacks precise safe error'
    foreach($resource in $doc.collection.resources.Keys) {
        Assert-PPTest ($doc.collection.resources[$resource].acquisitionStatus -in @('collected','partial','failed','unavailable')) 'Unexpected status enum'
        foreach($error in $doc.collection.resources[$resource].acquisitionErrors) { Assert-PPTest ($error.Count -eq 2 -and $error.Contains('code') -and $error.Contains('message')) 'Acquisition error has unsafe or ambiguous fields' }
    }
}
Test-PPCase 'An environment failure and successful empty peer yield partial acquisition' {
    $ops=New-PPTestOperations
    $ops.Environments={param($Limit) New-PPTestEnvironment 'one';New-PPTestEnvironment 'two'}
    $ops.Apps={param($Environment,$Limit) if($Environment -eq 'one'){throw 'PP_HTTP_403'}}
    $doc=Invoke-PPTestCollection $ops
    Assert-PPTest ($doc.evidence.apps.Count -eq 0 -and $doc.collection.resources.apps.acquisitionStatus -eq 'partial') 'Status was inferred only from row count'
    Assert-PPTest ($doc.collection.environments[0].resources.apps.acquisitionStatus -eq 'failed') 'Failed environment scope lost'
    Assert-PPTest ($doc.collection.environments[1].resources.apps.acquisitionStatus -eq 'collected') 'Empty successful environment scope lost'
}
Test-PPCase 'Administration item and request limits bound new data and detailed discovery' {
    $ops=New-PPTestOperations
    $ops.Apps={param($Environment,$Limit) [pscustomobject]@{AppName='one'};[pscustomobject]@{AppName='two'}}
    $doc=Invoke-PPTestCollection $ops 50 1
    Assert-PPTest ($doc.evidence.apps.Count -eq 1 -and $doc.collection.resources.apps.acquisitionStatus -eq 'partial') 'App truncation was not recorded'
    $ops=New-PPTestOperations
    $script:detailCalls=0
    $ops.Environments={param($Limit) New-PPTestEnvironment 'environment-1' ''}
    $ops.EnvironmentDetail={param($Environment) $script:detailCalls++;New-PPTestEnvironment $Environment}
    $doc=Invoke-PPTestCollection $ops 50 2000 6
    Assert-PPTest ($doc.collection.operationsAndExplicitRequests -eq 6 -and $script:detailCalls -eq 0) 'Budget allowed an unbounded discovery read'
    Assert-PPTest ($doc.collection.resources.agents.acquisitionStatus -eq 'partial') 'Budget truncation not reflected in acquisition'
}
Test-PPCase 'Successful empty bot query is collected but still not readiness evidence' {
    $ops=New-PPTestOperations; $base=$ops.Request
    $ops.Request={
        param($Url,$Token,$Timeout,$PageSize)
        if($Url -match '/bots\?'){return [pscustomobject]@{value=@()}}
        & $base $Url $Token $Timeout $PageSize
    }.GetNewClosure()
    $doc=Invoke-PPTestCollection $ops
    Assert-PPTest ($doc.collection.resources.agents.acquisitionStatus -eq 'collected' -and $doc.evidence.agents.Count -eq 0) 'Empty bot query falsely failed'
    Assert-PPTest ($doc.collection.resources.agents.acquisitionErrors.Count -eq 0 -and $doc.errors.Contains('agents')) 'Acquisition and readiness boundaries collapsed'
}
Test-PPCase 'Failed discovery prevents dependent reads but does not poison independent DLP acquisition' {
    $ops=New-PPTestOperations
    $ops.Environments={param($Limit) throw 'PP_HTTP_403'}
    $ops.Apps={throw 'Must not execute without environments'}
    $doc=Invoke-PPTestCollection $ops
    Assert-PPTest ($doc.collection.resources.environments.acquisitionStatus -eq 'failed') 'Environment read failure lost'
    Assert-PPTest ($doc.collection.resources.apps.acquisitionStatus -eq 'unavailable') 'Unattempted dependent read claimed to fail directly'
    Assert-PPTest ($doc.collection.resources.dlpPolicies.acquisitionStatus -eq 'collected' -and $doc.collection.resources.dlpPolicies.acquisitionErrors.Count -eq 0) 'Independent DLP read inherited acquisition failure'
}
Test-PPCase 'Microsoft swallowed REST failures are forced to throw and module defaults restored' {
    # In-memory module only: models the shipped helper's default swallow behavior without auth or HTTP.
    $module = New-Module -Name Microsoft.PowerApps.RestClientModule -ScriptBlock {
        $script:PSDefaultParameterValues=@{'preserved:key'='unchanged';Disabled=$true}
        function InvokeApi {
            [CmdletBinding()]param([switch]$ThrowOnFailure)
            if($ThrowOnFailure){throw 'PP_HTTP_403'}
            return [pscustomobject]@{error='would-be-swallowed';value=@()}
        }
        Export-ModuleMember -Function InvokeApi
    }
    $facade = New-Module -Name Microsoft.PowerApps.Administration.PowerShell -ArgumentList $module -ScriptBlock {
        param($RestModule)
        Import-Module $RestModule
        function Get-AdminPowerApp {
            [CmdletBinding()]param([string]$EnvironmentName)
            $reply=InvokeApi
            $reply.value
        }
        Export-ModuleMember -Function InvokeApi,Get-AdminPowerApp
    }
    Import-Module $facade -Force
    try {
        Assert-PPTest ((Get-Command InvokeApi).ModuleName -eq 'Microsoft.PowerApps.Administration.PowerShell') 'Fixture does not reproduce Microsoft facade re-export'
        Assert-PPThrows { Invoke-PPAdminInventoryRead 'Get-AdminPowerApp' 'synthetic' 2 } 'PP_HTTP_403'
        $defaults=& $module { $script:PSDefaultParameterValues }
        Assert-PPTest ($defaults.Count -eq 2 -and $defaults['Disabled'] -eq $true -and $defaults['preserved:key'] -eq 'unchanged') 'Module defaults were not restored after failure'
    }
    finally { Remove-Module $facade -Force; Remove-Module $module -Force -ErrorAction SilentlyContinue }
}
Write-Host "$script:passed passed; $script:failed failed."
if ($script:failed) { exit 1 }
