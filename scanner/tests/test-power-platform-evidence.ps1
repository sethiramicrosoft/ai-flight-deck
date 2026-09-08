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
        Environments = { param($Limit) New-PPTestEnvironment }
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
    Assert-PPTest ($source -match 'Install-PackageProvider[^\r\n]+-Scope CurrentUser -Force -Confirm:\$false') 'NuGet bootstrap can prompt or install machine-wide'
    Assert-PPTest ($source -match '(?s)Install-Module[^\r\n]+`[\r\n]+\s+-Scope CurrentUser -Force -AllowClobber -Confirm:\$false') 'Module installation can prompt or install machine-wide'
    Assert-PPTest ($source -notmatch 'Set-PSRepository|Set-ExecutionPolicy|Start-Process') 'Global trust/policy mutation or detached child added'
}
Test-PPCase 'Real interface fixture produces all seven arrays with actual identity and unknown boundaries' {
    $doc = Invoke-PPTestCollection (New-PPTestOperations)
    Assert-PPTest ($doc.tenantId -eq $script:tenant -and $doc.actorId -eq $script:actor) 'Wrong identity'
    Assert-PPTest ($doc.schema -eq 'ai-flight-deck/power-platform-evidence' -and $doc.version -eq '1.0.0') 'Wrong schema'
    Assert-PPTest ($doc.producerVersion -eq '1.0.0' -and $doc.collectionChallenge -eq ('a'*40)) 'Wrong producer'
    foreach ($key in @('environments','dlpPolicies','connectors','agents','agentOwners','agentSharing','agentLifecycle')) {
        Assert-PPTest ($doc.evidence[$key] -is [array]) "$key is not an array"
        Assert-PPTest ($doc.evidence[$key].Count -eq 1) "$key did not collect its row"
        Assert-PPTest ($doc.errors.Contains($key)) "$key lacks visibility/semantic boundary"
        Assert-PPTest (-not $doc.collection.resources[$key].complete) "$key is falsely complete"
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
Write-Host "$script:passed passed; $script:failed failed."
if ($script:failed) { exit 1 }
