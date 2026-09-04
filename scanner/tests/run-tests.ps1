[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$scannerRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$scannerPath = Join-Path $scannerRoot "scan-tenant.ps1"
$comparePath = Join-Path $scannerRoot "compare-scans.ps1"
$liveTestPath = Join-Path $scannerRoot "test-live-tenant.ps1"
$contractPath = [System.IO.Path]::GetFullPath((Join-Path $scannerRoot "..\schema\scan-contract.v1.json"))
$catalogPath = [System.IO.Path]::GetFullPath((Join-Path $scannerRoot "..\schema\readiness-catalog.v1.json"))
$controlResultSchemaPath = [System.IO.Path]::GetFullPath((Join-Path $scannerRoot "..\schema\control-result.schema.v1.json"))
$artifactRoot = Join-Path $PSScriptRoot ".test-artifacts"

. $scannerPath

$script:passed = 0
$script:failed = 0

function Assert-True {
    param(
        [Parameter(Mandatory)]
        [bool]$Condition,

        [Parameter(Mandatory)]
        [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

function Assert-Equal {
    param(
        [Parameter()]
        $Actual,

        [Parameter()]
        $Expected,

        [Parameter(Mandatory)]
        [string]$Message
    )

    if ($Actual -ne $Expected) {
        throw "$Message Expected '$Expected', received '$Actual'."
    }
}

function Assert-Throws {
    param(
        [Parameter(Mandatory)]
        [scriptblock]$Action,

        [Parameter(Mandatory)]
        [string]$MessagePattern
    )

    try {
        & $Action
    }
    catch {
        if ($_.Exception.Message -notmatch $MessagePattern) {
            throw "Expected error matching '$MessagePattern', received '$($_.Exception.Message)'."
        }
        return
    }

    throw "Expected an error matching '$MessagePattern', but no error was raised."
}

function Invoke-Test {
    param(
        [Parameter(Mandatory)]
        [string]$Name,

        [Parameter(Mandatory)]
        [scriptblock]$Action
    )

    try {
        & $Action
        $script:passed++
        Write-Host "PASS: $Name"
    }
    catch {
        $script:failed++
        Write-Host "FAIL: $Name"
        Write-Host "  $($_.Exception.Message)"
    }
}

function New-TestCollectionMetadata {
    param(
        [Parameter()]
        [string]$FailedCollection,

        [Parameter()]
        [string]$TruncatedCollection
    )

    $metadata = [ordered]@{}
    foreach ($name in @(
            "organization",
            "subscribedSkus",
            "users",
            "groups",
            "sites",
            "drives",
            "driveItems",
            "itemSharingEvidence"
        )) {
        $metadata[$name] = [ordered]@{
            required  = $true
            failed    = $name -eq $FailedCollection
            truncated = $name -eq $TruncatedCollection
        }
    }
    return $metadata
}

function New-TestScan {
    param(
        [Parameter(Mandatory)]
        [string]$GeneratedAt,

        [Parameter()]
        [string]$TenantId = "11111111-1111-1111-1111-111111111111",

        [Parameter()]
        [string]$ActorId = "scanner@example.test",

        [Parameter()]
        [string[]]$AnonymousPermissionIds = @(),

        [Parameter()]
        [string[]]$OrganizationPermissionIds = @(),

        [Parameter()]
        [string[]]$BroadAccessSiteIds = @(),

        [Parameter()]
        [string[]]$SharedItemIds = @(),

        [Parameter()]
        [string[]]$GuestUserIds = @(),

        [Parameter()]
        [int]$MaximumSites = 25,

        [Parameter()]
        [int]$SitesDiscovered = 1,

        [Parameter()]
        [int]$SitesScanned = 1,

        [Parameter()]
        [bool]$CoverageComplete = $true,

        [Parameter()]
        [switch]$Incomplete
    )

    $contract = Read-FdContract
    $scopeContract = Get-FdPropertyValue $contract "scopeContract"
    $scopeDefinition = New-FdScopeDefinition `
        -Mode (Get-FdPropertyValue $scopeContract "mode") `
        -MaximumSites $MaximumSites `
        -MaximumDrivesPerSite 20 `
        -MaximumItemsPerDrive 100 `
        -MaximumUsers 10000 `
        -MaximumGroups 10000 `
        -MaximumPermissionsPerSite 500 `
        -MaximumGraphRequests 10000 `
        -RequiredPermissions @(Get-FdPropertyValue $scopeContract "requiredPermissions") `
        -ContentRetrieved (Get-FdPropertyValue $scopeContract "contentRetrieved") `
        -AuthMode "Interactive" `
        -ActorType "delegatedUser" `
        -SiteSelection (Get-FdPropertyValue $scopeContract "siteSelection") `
        -ItemSelection (Get-FdPropertyValue $scopeContract "itemSelection")

    $scopeFingerprint = Get-FdScopeFingerprint $scopeDefinition
    $policyHash = Get-FdPolicyHash $contract
    $configHash = Get-FdConfigurationHash `
        -Contract $contract `
        -PolicyHash $policyHash `
        -ScopeFingerprint $scopeFingerprint `
        -Producer (Get-FdPropertyValue $contract "producer") `
        -ProducerVersion (Get-FdPropertyValue $contract "producerVersion") `
        -ScoringVersion (Get-FdPropertyValue $contract "scoringVersion")

    $anonymous = @($AnonymousPermissionIds | Sort-Object -Unique)
    $organization = @($OrganizationPermissionIds | Sort-Object -Unique)
    $broad = @($BroadAccessSiteIds | Sort-Object -Unique)
    $shared = @($SharedItemIds | Sort-Object -Unique)
    $guests = @($GuestUserIds | Sort-Object -Unique)
    $critical = @($anonymous | Sort-Object -Unique)

    $readiness = Get-FdReadinessCalculation `
        -Contract $contract `
        -AnonymousPermissionCount $anonymous.Count `
        -OrganizationPermissionCount $organization.Count `
        -BroadAccessSiteCount $broad.Count `
        -ExposedItemCount $shared.Count
    $rawScore = $readiness.raw
    $score = $readiness.score

    $findings = @()
    if ($anonymous.Count -gt 0) {
        $findings = @(
            New-FdFinding `
                -RuleKey "AFD-SP-ANONYMOUS-001" `
                -Severity "critical" `
                -Title "Anonymous SharePoint access detected" `
                -Detail "Synthetic local test evidence." `
                -Impact "$($anonymous.Count) permissions" `
                -SourceNode "graph.sites.permissions" `
                -EvidenceIds $anonymous
        )
    }

    $failedSites = @()
    $reasons = @()
    $failedCollection = $null
    $truncatedCollection = $null
    if ($Incomplete) {
        $failedCollection = "itemSharingEvidence"
        $reasons = @("Required collection 'itemSharingEvidence' failed.")
        $failedSites = @(
            [ordered]@{
                stage           = "itemSharingEvidence"
                siteId          = "site-one"
                siteDisplayName = "Synthetic site"
                driveId         = $null
                statusCode      = 503
                message         = "Synthetic failure."
            }
        )
    }
    if (-not $CoverageComplete) {
        $truncatedCollection = "sites"
        $reasons += "Site coverage is incomplete."
    }
    $effectiveIncomplete = $Incomplete -or -not $CoverageComplete

    return [ordered]@{
        schemaVersion   = Get-FdPropertyValue $contract "schemaVersion"
        documentType    = Get-FdPropertyValue $contract "documentType"
        producer        = Get-FdPropertyValue $contract "producer"
        producerVersion = Get-FdPropertyValue $contract "producerVersion"
        scoringVersion  = Get-FdPropertyValue $contract "scoringVersion"
        policyHash      = $policyHash
        configHash      = $configHash
        generatedAt     = $GeneratedAt
        tenant          = [ordered]@{
            id          = $TenantId
            displayName = "Synthetic tenant"
            tenantId    = $TenantId
        }
        auth            = [ordered]@{
            mode  = "Interactive"
            actor = [ordered]@{
                type = "delegatedUser"
                id   = $ActorId
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
            grantedScopes             = $scopeDefinition.requiredPermissions
            contentRetrieved          = $scopeDefinition.contentRetrieved
            authMode                  = $scopeDefinition.authMode
            actorType                 = $scopeDefinition.actorType
            siteSelection             = $scopeDefinition.siteSelection
            itemSelection             = $scopeDefinition.itemSelection
            fingerprint               = $scopeFingerprint
        }
        completeness    = [ordered]@{
            status                   = if ($effectiveIncomplete) { "Incomplete" } else { "Complete" }
            requiredEvidenceComplete = -not $effectiveIncomplete
            reasons                  = $reasons
            failedSites              = $failedSites
        }
        coverage        = [ordered]@{
            sitesDiscovered   = $SitesDiscovered
            sitesSelected     = $SitesScanned
            sitesScanned      = $SitesScanned
            discoveryComplete = $CoverageComplete
            selectionComplete = $CoverageComplete
            limitReached      = -not $CoverageComplete
            complete          = $CoverageComplete
        }
        collectionMetadata = New-TestCollectionMetadata `
            -FailedCollection $failedCollection `
            -TruncatedCollection $truncatedCollection
        summary         = [ordered]@{
            readinessScore         = if ($effectiveIncomplete) { $null } else { $score }
            readinessScoreVerified = -not $effectiveIncomplete
            readinessScoreStatus   = if ($effectiveIncomplete) { "NotCalculatedIncompleteEvidence" } else { "Verified" }
            readinessRaw           = if ($effectiveIncomplete) { $null } else { $rawScore }
            readinessSaturated     = if ($effectiveIncomplete) { $false } else { $readiness.saturated }
            criticalExposures      = $critical.Count
            users                  = 10
            guests                 = $guests.Count
            groups                 = 2
            sitesDiscovered        = $SitesDiscovered
            sitesScanned           = $SitesScanned
            broadAccessSites       = $broad.Count
            anonymousLinks         = $anonymous.Count
            organizationLinks      = $organization.Count
            sampledItems           = 5
            exposedItems           = $shared.Count
            graphRequests          = 7
        }
        scoringInputs   = [ordered]@{}
        findings        = $findings
        evidenceSets    = [ordered]@{
            anonymousPermissionIds    = $anonymous
            organizationPermissionIds = $organization
            broadAccessSiteIds         = $broad
            sharedItemIds              = $shared
            guestUserIds               = $guests
            criticalEvidenceIds        = $critical
        }
        limitations     = @("Synthetic local test scan.")
    }
}

function Write-TestScan {
    param(
        [Parameter(Mandatory)]
        $Scan,

        [Parameter(Mandatory)]
        [string]$Name
    )

    $path = Join-Path $artifactRoot $Name
    $null = Write-FdJsonFile -Value $Scan -Path $path -Depth 32
    return $path
}

if ([System.IO.Directory]::Exists($artifactRoot)) {
    [System.IO.Directory]::Delete($artifactRoot, $true)
}
[System.IO.Directory]::CreateDirectory($artifactRoot) | Out-Null

try {
    Invoke-Test "PowerShell files parse without syntax errors" {
        foreach ($path in @($scannerPath, $comparePath, (Join-Path $scannerRoot "FlightDeck.Common.ps1"), $liveTestPath)) {
            $tokens = $null
            $errors = $null
            [System.Management.Automation.Language.Parser]::ParseFile(
                $path,
                [ref]$tokens,
                [ref]$errors
            ) | Out-Null
            Assert-Equal -Actual $errors.Count -Expected 0 -Message "Syntax errors found in $path."
        }
    }

    Invoke-Test "Contract JSON loads and identifies the producer" {
        $contract = Get-Content -LiteralPath $contractPath -Raw | ConvertFrom-Json
        Assert-Equal $contract.producer "ai-flight-deck/scan-tenant.ps1" "Unexpected contract producer."
        Assert-Equal $contract.scoringVersion "1.3.0" "Unexpected scoring version."
        Assert-Equal $contract.scopeContract.siteSelection "graph-search-star-candidate-sort-id" "Unexpected site-selection contract."
        Assert-True $contract.coverageContract.positiveDecisionRequiresComplete "Coverage must gate positive decisions."
    }

    Invoke-Test "Readiness catalog defines complete domains controls and missions" {
        $contract = Get-Content -LiteralPath $contractPath -Raw | ConvertFrom-Json
        $catalog = Get-Content -LiteralPath $catalogPath -Raw | ConvertFrom-Json
        $controlResultSchema = Get-Content -LiteralPath $controlResultSchemaPath -Raw | ConvertFrom-Json
        Assert-Equal $catalog.schemaVersion $contract.readinessCatalog.schemaVersion "Catalog schema version does not match the scan contract."
        Assert-Equal $catalog.catalogVersion $contract.readinessCatalog.catalogVersion "Catalog version does not match the scan contract."
        Assert-Equal @($catalog.domains).Count 13 "The readiness catalog must define thirteen domains."
        Assert-Equal @($catalog.missions).Count 4 "The readiness catalog must define four missions."
        Assert-True ($null -ne $controlResultSchema.properties.status) "The control-result schema must define status."

        $expectedStatuses = @("Pass", "Fail", "Warning", "Unknown", "NotApplicable")
        Assert-Equal @($catalog.statuses).Count $expectedStatuses.Count "Unexpected catalog status count."
        Assert-Equal @(Compare-Object -ReferenceObject $expectedStatuses -DifferenceObject @($catalog.statuses) -SyncWindow 0).Count 0 "Catalog statuses are inconsistent."

        $domainIds = @($catalog.domains | Sort-Object order | ForEach-Object { $_.id })
        Assert-Equal @(Compare-Object -ReferenceObject @($contract.estateDomains) -DifferenceObject $domainIds -SyncWindow 0).Count 0 "Catalog and contract domain order differ."

        $controlIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
        $controlsById = @{}
        foreach ($domain in @($catalog.domains)) {
            Assert-True (@($domain.controls).Count -ge 5) "Domain '$($domain.id)' must contain at least five controls."
            foreach ($control in @($domain.controls)) {
                Assert-True ($controlIds.Add([string]$control.id)) "Duplicate control ID '$($control.id)'."
                Assert-True ($control.requirement -in @("Gate", "Advisory")) "Control '$($control.id)' has an invalid requirement."
                Assert-True ($control.automation -in @("Automated", "Partial", "Attested")) "Control '$($control.id)' has an invalid automation mode."
                Assert-True (@($control.evidenceSources).Count -gt 0) "Control '$($control.id)' has no evidence source."
                Assert-True ([int]$control.freshnessHours -gt 0) "Control '$($control.id)' has an invalid freshness window."
                Assert-True ($control.unavailableBehavior -match "Unknown|NotApplicable") "Control '$($control.id)' must define honest unavailable behavior."
                $controlsById[[string]$control.id] = $control
            }
        }
        Assert-True ($controlIds.Count -ge 65 -and $controlIds.Count -le 90) "The catalog must define between 65 and 90 controls."

        $missionIds = @($catalog.missions | ForEach-Object { $_.id })
        Assert-Equal @(Compare-Object -ReferenceObject @("activation", "safePilot", "scale", "assure") -DifferenceObject $missionIds -SyncWindow 0).Count 0 "Unexpected mission IDs."
        foreach ($mission in @($catalog.missions)) {
            Assert-True (@($mission.requiredControlIds).Count -gt 0) "Mission '$($mission.id)' has no required controls."
            foreach ($controlId in @($mission.requiredControlIds)) {
                Assert-True $controlsById.ContainsKey([string]$controlId) "Mission '$($mission.id)' references unknown control '$controlId'."
                $control = $controlsById[[string]$controlId]
                Assert-Equal $control.requirement "Gate" "Mission '$($mission.id)' references advisory control '$controlId'."
                Assert-True (@($control.missions) -contains $mission.id) "Control '$controlId' does not declare mission '$($mission.id)'."
            }
        }
    }

    Invoke-Test "Control results cover every catalog control with honest unknown evidence" {
        $catalog = Get-Content -LiteralPath $catalogPath -Raw | ConvertFrom-Json
        $tenantId = "11111111-1111-1111-1111-111111111111"
        $observedAt = [datetime]"2026-07-17T00:00:00Z"
        $results = @(
            New-FdControlResults `
                -ReadinessCatalog $catalog `
                -TenantId $tenantId `
                -ActorId "test-actor" `
                -CollectorRunId "test-run" `
                -ObservedAt $observedAt
        )
        $catalogControls = @($catalog.domains | ForEach-Object { @($_.controls) })
        Assert-Equal $results.Count $catalogControls.Count "Every catalog control must have a normalized result."
        Assert-Equal @($results | Where-Object status -ne "Unknown").Count 0 "Unavailable control evidence must remain Unknown."
        Assert-Equal @($results | Select-Object -ExpandProperty controlId -Unique).Count $catalogControls.Count "Control results must have unique control IDs."
        Assert-True (@($results | Where-Object { $_.cohortId -ne "tenant-wide" }).Count -eq 0) "The default result cohort is inconsistent."
        Assert-True (@($results | Where-Object { $_.coverage.complete -or $_.coverage.evaluated -ne 0 }).Count -eq 0) "Unknown results must not claim evaluated coverage."
        Assert-True (@($results | Where-Object { @($_.limitations).Count -ne 1 -or $_.limitations[0].code -ne "MISSING_COLLECTOR_CAPABILITY" }).Count -eq 0) "Unknown results must explain the missing collector capability."
        Assert-True (@($results | Where-Object { $_.provenance.tenantId -ne $tenantId -or $_.provenance.collectorRunId -ne "test-run" }).Count -eq 0) "Control provenance is incomplete."
    }

    Invoke-Test "Nullable Graph properties are safe under StrictMode" {
        $permission = [pscustomobject]@{
            id          = "permission-one"
            roles       = @("read")
            grantedToV2 = [pscustomobject]@{
                siteGroup = [pscustomobject]@{
                    id          = "group-one"
                    displayName = "Site Members"
                }
            }
        }
        Assert-Equal (Get-FdNestedValue $permission @("link", "scope")) $null "Missing link scope was not null."
        $identityData = Get-FdPermissionIdentityData $permission
        Assert-Equal @($identityData.displayNames).Count 1 "Identity data was not collected."
    }

    Invoke-Test "Permission fallback evidence IDs use a stable projection" {
        $permissionOne = [pscustomobject][ordered]@{
            roles = @("write", "read")
            link = [pscustomobject][ordered]@{
                webUrl = "https://example.test/share/token"
                scope  = "anonymous"
                type   = "view"
            }
            grantedToIdentitiesV2 = @(
                [pscustomobject][ordered]@{
                    user = [pscustomobject][ordered]@{
                        id          = "user-one"
                        displayName = "Name one"
                    }
                }
            )
            volatileProperty = "first"
        }
        $permissionTwo = [pscustomobject][ordered]@{
            volatileProperty = "second"
            grantedToIdentitiesV2 = @(
                [pscustomobject][ordered]@{
                    user = [pscustomobject][ordered]@{
                        displayName = "Changed name"
                        id          = "user-one"
                    }
                }
            )
            link = [pscustomobject][ordered]@{
                type   = "view"
                scope  = "anonymous"
                webUrl = "https://example.test/share/token"
            }
            roles = @("read", "write")
        }

        $firstId = Get-FdPermissionEvidenceId -SiteId "site-one" -Permission $permissionOne
        $secondId = Get-FdPermissionEvidenceId -SiteId "site-one" -Permission $permissionTwo
        Assert-Equal $firstId $secondId "Permission fallback identity changed with property order or volatile fields."
        Assert-True ($firstId -match '^permission-derived:v1:site-one:[a-f0-9]{64}$') "Derived permission evidence namespace is invalid."
    }

    Invoke-Test "Bounded site selection is ordinal and coverage-aware" {
        $first = Select-FdBoundedSites `
            -Candidates @(
                [pscustomobject]@{ id = "site-c"; displayName = "C" },
                [pscustomobject]@{ id = "site-a"; displayName = "A" },
                [pscustomobject]@{ id = "site-b"; displayName = "B" }
            ) `
            -MaximumSites 2 `
            -DiscoveryComplete $true
        $second = Select-FdBoundedSites `
            -Candidates @(
                [pscustomobject]@{ id = "site-b"; displayName = "B" },
                [pscustomobject]@{ id = "site-c"; displayName = "C" },
                [pscustomobject]@{ id = "site-a"; displayName = "A" }
            ) `
            -MaximumSites 2 `
            -DiscoveryComplete $true

        Assert-Equal (@($first.sites.id) -join "|") "site-a|site-b" "Sites were not selected by stable ordinal ID."
        Assert-Equal (@($second.sites.id) -join "|") "site-a|site-b" "Site selection changed with Graph response order."
        Assert-Equal $first.sitesDiscovered 3 "Discovered site count is wrong."
        Assert-True $first.selectionLimitReached "Site selection did not record its bound."
        Assert-True (-not $first.coverageComplete) "Bounded site selection incorrectly claimed complete coverage."
    }

    Invoke-Test "Single-site selection preserves array cardinality" {
        $selection = Select-FdBoundedSites `
            -Candidates @([pscustomobject]@{ id = "site-only"; displayName = "Only site" }) `
            -MaximumSites 500 `
            -DiscoveryComplete $true

        Assert-Equal $selection.sitesDiscovered 1 "Single-site discovery count is wrong."
        Assert-Equal $selection.sitesSelected 1 "Single-site selection count is wrong."
        Assert-Equal @($selection.sites).Count 1 "Single-site result was not preserved as a collection."
        Assert-True $selection.coverageComplete "Complete single-site coverage was not recognized."
    }

    Invoke-Test "Sorted evidence sets preserve zero and one item cardinality" {
        $empty = Get-FdSortedSet -Values @()
        $single = Get-FdSortedSet -Values @("only-evidence")
        $deduplicated = Get-FdSortedSet -Values @("second", "first", "second")

        Assert-Equal $empty.Count 0 "Empty evidence set did not remain a countable array."
        Assert-Equal $single.Count 1 "Single evidence item did not remain a countable array."
        Assert-Equal $single[0] "only-evidence" "Single evidence item changed."
        Assert-Equal ($deduplicated -join "|") "first|second" "Evidence set was not sorted and deduplicated."
    }

    Invoke-Test "Only risk-qualified shared items count as exposed" {
        $internalItem = [pscustomobject]@{
            id     = "internal"
            shared = [pscustomobject]@{ scope = "users" }
        }
        $anonymousItem = [pscustomobject]@{
            id     = "anonymous"
            shared = [pscustomobject]@{ scope = "anonymous" }
        }
        $organizationItem = [pscustomobject]@{
            id     = "organization"
            shared = [pscustomobject]@{ scope = "organization" }
        }

        Assert-True (-not (Test-FdRiskQualifiedExposedItem -Item $internalItem -SiteHasBroadAccess $false)) "Named-user collaboration was treated as exposed."
        Assert-True (Test-FdRiskQualifiedExposedItem -Item $anonymousItem -SiteHasBroadAccess $false) "Anonymous sharing was not treated as exposed."
        Assert-True (Test-FdRiskQualifiedExposedItem -Item $organizationItem -SiteHasBroadAccess $false) "Organization sharing was not treated as exposed."
        Assert-True (Test-FdRiskQualifiedExposedItem -Item $internalItem -SiteHasBroadAccess $true) "Broad-site exposure did not qualify a shared item."
    }

    Invoke-Test "Live-test configuration is locked and secret-free" {
        $configuration = New-FdLockedLiveTestConfiguration `
            -AuthMode "Certificate" `
            -TenantId "11111111-1111-1111-1111-111111111111" `
            -ClientId "22222222-2222-2222-2222-222222222222" `
            -MaxSites 7 `
            -MaxDrivesPerSite 8 `
            -MaxItemsPerDrive 9 `
            -MaxUsers 10 `
            -MaxGroups 11 `
            -MaxPermissionsPerSite 12 `
            -MaxGraphRequests 13
        $configJson = $configuration | ConvertTo-Json -Depth 5
        Assert-True ($null -eq $configuration.PSObject.Properties["certificateThumbprint"]) "Certificate thumbprint was persisted in locked configuration."
        Assert-True ($configJson -notmatch '(?i)thumbprint') "Serialized configuration contains a certificate thumbprint field."

        $arguments = New-FdLiveTestScanArguments `
            -OutputPath "scan.json" `
            -Configuration $configuration `
            -CertificateThumbprint "runtime-only-thumbprint"
        Assert-Equal $arguments.MaxSites 7 "Verification arguments did not reuse the locked site bound."
        Assert-Equal $arguments.CertificateThumbprint "runtime-only-thumbprint" "Runtime certificate input was not forwarded."

        $defaultWorkspace = Get-FdDefaultLiveTestWorkspace
        $productRoot = [System.IO.Path]::GetFullPath((Join-Path $scannerRoot ".."))
        Assert-True (-not $defaultWorkspace.StartsWith($productRoot, [System.StringComparison]::OrdinalIgnoreCase)) "Default live-test workspace is inside the repository."
    }

    Invoke-Test "Graph retry honors Retry-After and remains bounded" {
        $state = @{ Count = 0 }
        $script:retryCalls = 0
        $script:retrySleeps = @()
        $invoker = {
            param($Uri)
            $script:retryCalls++
            if ($script:retryCalls -eq 1) {
                $exception = [System.Exception]::new("Synthetic throttle.")
                $exception.Data["StatusCode"] = 429
                $exception.Data["RetryAfter"] = "2"
                throw $exception
            }

            Invoke-Test "Graph diagnostics retain structured error details" {
                $errorRecord = [pscustomobject]@{
                    ErrorDetails = [pscustomobject]@{
                        Message = '{"error":{"code":"badRequest","message":"SharePoint tenant is not provisioned."}}'
                    }
                    Exception = [pscustomobject]@{
                        Message = "Generic HTTP failure."
                        Data = $null
                        Response = $null
                    }
                }
                $diagnostic = Get-FdGraphErrorInfo -ErrorRecord $errorRecord
                Assert-Equal $diagnostic.message "SharePoint tenant is not provisioned." "Structured Graph error detail was not retained."
            }
            return [pscustomobject]@{
                value             = @([pscustomobject]@{ id = "one" })
                "@odata.nextLink" = $null
            }
        }
        $sleep = {
            param($Seconds)
            $script:retrySleeps += $Seconds
        }
        $result = Invoke-GraphCollection `
            -Uri "local://collection" `
            -Maximum 10 `
            -RequestState $state `
            -MaximumRequests 3 `
            -MaximumAttempts 3 `
            -JitterMilliseconds 0 `
            -RequestInvoker $invoker `
            -SleepAction $sleep
        Assert-Equal $result.collected 1 "Retry result count is wrong."
        Assert-Equal $script:retryCalls 2 "Retry call count is wrong."
        Assert-Equal $script:retrySleeps[0] 2 "Retry-After delay was not honored."
        Assert-Equal $state.Count 2 "Request budget count is wrong."
    }

    Invoke-Test "Graph collection records truncation" {
        $state = @{ Count = 0 }
        $invoker = {
            param($Uri)
            return [pscustomobject]@{
                value = @(
                    [pscustomobject]@{ id = "one" },
                    [pscustomobject]@{ id = "two" }
                )
                "@odata.nextLink" = "local://next"
            }
        }
        $result = Invoke-GraphCollection `
            -Uri "local://collection" `
            -Maximum 2 `
            -RequestState $state `
            -MaximumRequests 2 `
            -RequestInvoker $invoker `
            -SleepAction { param($Seconds) }
        Assert-True $result.truncated "Collection did not record truncation."
        Assert-Equal $result.collected 2 "Truncated collection count is wrong."
    }

    Invoke-Test "Completed comparable scans produce deterministic clearance" {
        $baseline = New-TestScan `
            -GeneratedAt "2026-09-03T00:00:00.0000000Z" `
            -AnonymousPermissionIds @("permission:site-one:permission-one")
        $verification = New-TestScan -GeneratedAt "2026-09-03T01:00:00.0000000Z"
        $baselinePath = Write-TestScan $baseline "baseline.json"
        $verificationPath = Write-TestScan $verification "verification.json"
        $outputPath = Join-Path $artifactRoot "[safe]\verification-report.json"
        & $comparePath `
            -BaselinePath $baselinePath `
            -VerificationPath $verificationPath `
            -OutputPath $outputPath | Out-Null
        $report = Get-Content -LiteralPath $outputPath -Raw | ConvertFrom-Json
        Assert-Equal $report.status "ImprovementVerified" "Unexpected verification status."
        Assert-Equal $report.decision "SharingControlsVerified" "Unexpected positive decision code."
        Assert-Equal $report.clearance "SharingControlsVerified" "Clearance did not use the standard decision code."
        Assert-Equal @($report.change.evidenceSets.criticalEvidenceIds.closed).Count 1 "Closed evidence was not recorded."
        Assert-True $report.controls.completeEvidenceVerified "Completeness control was not recorded."
        Assert-True $report.controls.completeCoverageVerified "Coverage control was not recorded."
    }

    Invoke-Test "Identical evidence produces no material change and conditional clearance" {
        $baselinePath = Write-TestScan (New-TestScan -GeneratedAt "2026-09-03T00:00:00.0000000Z") "same-baseline.json"
        $verificationPath = Write-TestScan (New-TestScan -GeneratedAt "2026-09-03T01:00:00.0000000Z") "same-verification.json"
        $outputPath = Join-Path $artifactRoot "same-report.json"
        & $comparePath -BaselinePath $baselinePath -VerificationPath $verificationPath -OutputPath $outputPath | Out-Null
        $report = Get-Content -LiteralPath $outputPath -Raw | ConvertFrom-Json
        Assert-Equal $report.status "NoMaterialChange" "Unexpected status for identical evidence."
        Assert-Equal $report.decision "VerifyAgain" "Unchanged evidence must require another verification."
    }

    Invoke-Test "Opened evidence produces drift and conditional clearance" {
        $baselinePath = Write-TestScan (New-TestScan -GeneratedAt "2026-09-03T00:00:00.0000000Z") "drift-baseline.json"
        $verificationPath = Write-TestScan (
            New-TestScan `
                -GeneratedAt "2026-09-03T01:00:00.0000000Z" `
                -SharedItemIds @("item:drive-one:item-one")
        ) "drift-verification.json"
        $outputPath = Join-Path $artifactRoot "drift-report.json"
        & $comparePath -BaselinePath $baselinePath -VerificationPath $verificationPath -OutputPath $outputPath | Out-Null
        $report = Get-Content -LiteralPath $outputPath -Raw | ConvertFrom-Json
        Assert-Equal $report.status "DriftDetected" "Unexpected status for opened evidence."
        Assert-Equal $report.decision "Hold" "Drift must produce a Hold decision."
    }

    Invoke-Test "Incomplete site coverage cannot produce a positive decision" {
        $baseline = New-TestScan `
            -GeneratedAt "2026-09-03T00:00:00.0000000Z" `
            -CoverageComplete $false `
            -SitesDiscovered 2 `
            -SitesScanned 1
        $verification = New-TestScan `
            -GeneratedAt "2026-09-03T01:00:00.0000000Z" `
            -CoverageComplete $false `
            -SitesDiscovered 2 `
            -SitesScanned 1
        foreach ($scan in @($baseline, $verification)) {
            $scan.summary.readinessScore = 100
            $scan.summary.readinessScoreVerified = $true
            $scan.summary.readinessScoreStatus = "Verified"
            $scan.summary.readinessRaw = 100
            $scan.summary.readinessSaturated = $false
            $scan.completeness.status = "Complete"
            $scan.completeness.requiredEvidenceComplete = $true
            $scan.completeness.reasons = @()
            $scan.collectionMetadata.sites.truncated = $false
        }
        $verification.coverage.sitesDiscovered = 2
        $verification.coverage.sitesSelected = 1
        $verification.coverage.sitesScanned = 1
        $verification.coverage.discoveryComplete = $true
        $verification.coverage.selectionComplete = $false
        $verification.coverage.limitReached = $true
        $verification.coverage.complete = $false
        $verification.summary.sitesDiscovered = 2
        $baselinePath = Write-TestScan $baseline "coverage-baseline.json"
        $verificationPath = Write-TestScan $verification "coverage-verification.json"
        Assert-Throws {
            & $comparePath -BaselinePath $baselinePath -VerificationPath $verificationPath -OutputPath (Join-Path $artifactRoot "coverage-output.json")
        } "site coverage is incomplete"
    }

    Invoke-Test "Improvement below threshold remains a remediation decision" {
        $baseline = New-TestScan `
            -GeneratedAt "2026-09-03T00:00:00.0000000Z" `
            -AnonymousPermissionIds @(
                "permission:site-one:permission-one",
                "permission:site-one:permission-two"
            )
        $verification = New-TestScan `
            -GeneratedAt "2026-09-03T01:00:00.0000000Z" `
            -AnonymousPermissionIds @("permission:site-one:permission-one")
        $baselinePath = Write-TestScan $baseline "remediate-baseline.json"
        $verificationPath = Write-TestScan $verification "remediate-verification.json"
        $outputPath = Join-Path $artifactRoot "remediate-report.json"
        & $comparePath -BaselinePath $baselinePath -VerificationPath $verificationPath -OutputPath $outputPath | Out-Null
        $report = Get-Content -LiteralPath $outputPath -Raw | ConvertFrom-Json
        Assert-Equal $report.status "ImprovementVerified" "Expected improvement status."
        Assert-Equal $report.decision "Remediate" "Sub-threshold improvement must remain a remediation decision."
    }

    Invoke-Test "Stale verification is rejected" {
        $baselinePath = Write-TestScan (New-TestScan -GeneratedAt "2026-09-03T02:00:00.0000000Z") "stale-baseline.json"
        $verificationPath = Write-TestScan (New-TestScan -GeneratedAt "2026-09-03T01:00:00.0000000Z") "stale-verification.json"
        Assert-Throws {
            & $comparePath -BaselinePath $baselinePath -VerificationPath $verificationPath -OutputPath (Join-Path $artifactRoot "stale-output.json")
        } "must be newer"
    }

    Invoke-Test "Different tenants are rejected" {
        $baselinePath = Write-TestScan (New-TestScan -GeneratedAt "2026-09-03T00:00:00.0000000Z") "tenant-baseline.json"
        $verificationPath = Write-TestScan (
            New-TestScan `
                -GeneratedAt "2026-09-03T01:00:00.0000000Z" `
                -TenantId "22222222-2222-2222-2222-222222222222"
        ) "tenant-verification.json"
        Assert-Throws {
            & $comparePath -BaselinePath $baselinePath -VerificationPath $verificationPath -OutputPath (Join-Path $artifactRoot "tenant-output.json")
        } "different tenants"
    }

    Invoke-Test "Different scopes are rejected" {
        $baselinePath = Write-TestScan (New-TestScan -GeneratedAt "2026-09-03T00:00:00.0000000Z") "scope-baseline.json"
        $verificationPath = Write-TestScan (
            New-TestScan `
                -GeneratedAt "2026-09-03T01:00:00.0000000Z" `
                -MaximumSites 50
        ) "scope-verification.json"
        Assert-Throws {
            & $comparePath -BaselinePath $baselinePath -VerificationPath $verificationPath -OutputPath (Join-Path $artifactRoot "scope-output.json")
        } "different scope fingerprints"
    }

    Invoke-Test "Different authentication actors are rejected" {
        $baselinePath = Write-TestScan (New-TestScan -GeneratedAt "2026-09-03T00:00:00.0000000Z") "actor-baseline.json"
        $verificationPath = Write-TestScan (
            New-TestScan `
                -GeneratedAt "2026-09-03T01:00:00.0000000Z" `
                -ActorId "other@example.test"
        ) "actor-verification.json"
        Assert-Throws {
            & $comparePath -BaselinePath $baselinePath -VerificationPath $verificationPath -OutputPath (Join-Path $artifactRoot "actor-output.json")
        } "different authentication actors"
    }

    Invoke-Test "Incomplete required evidence is rejected" {
        $baselinePath = Write-TestScan (New-TestScan -GeneratedAt "2026-09-03T00:00:00.0000000Z") "incomplete-baseline.json"
        $verificationPath = Write-TestScan (
            New-TestScan `
                -GeneratedAt "2026-09-03T01:00:00.0000000Z" `
                -Incomplete
        ) "incomplete-verification.json"
        Assert-Throws {
            & $comparePath -BaselinePath $baselinePath -VerificationPath $verificationPath -OutputPath (Join-Path $artifactRoot "incomplete-output.json")
        } "required evidence is incomplete"
    }

    Invoke-Test "Blank numeric fields are rejected as non-integers" {
        $baseline = New-TestScan -GeneratedAt "2026-09-03T00:00:00.0000000Z"
        $verification = New-TestScan -GeneratedAt "2026-09-03T01:00:00.0000000Z"
        $verification.summary.readinessScore = "   "
        $baselinePath = Write-TestScan $baseline "integer-baseline.json"
        $verificationPath = Write-TestScan $verification "integer-verification.json"
        Assert-Throws {
            & $comparePath -BaselinePath $baselinePath -VerificationPath $verificationPath -OutputPath (Join-Path $artifactRoot "integer-output.json")
        } "must be a JSON integer"
    }

    Invoke-Test "Tampered readiness scores are rejected" {
        $baseline = New-TestScan -GeneratedAt "2026-09-03T00:00:00.0000000Z"
        $verification = New-TestScan -GeneratedAt "2026-09-03T01:00:00.0000000Z"
        $verification.summary.readinessScore = 99
        $baselinePath = Write-TestScan $baseline "score-baseline.json"
        $verificationPath = Write-TestScan $verification "score-verification.json"
        Assert-Throws {
            & $comparePath -BaselinePath $baselinePath -VerificationPath $verificationPath -OutputPath (Join-Path $artifactRoot "score-output.json")
        } "not reproducible"
    }

    Invoke-Test "Oversized scan files are rejected before JSON parsing" {
        $largePath = Join-Path $artifactRoot "large-scan.json"
        [System.IO.File]::WriteAllText(
            $largePath,
            ("x" * (1MB + 1)),
            [System.Text.UTF8Encoding]::new($false)
        )
        $verificationPath = Write-TestScan (New-TestScan -GeneratedAt "2026-09-03T01:00:00.0000000Z") "large-verification.json"
        Assert-Throws {
            & $comparePath `
                -BaselinePath $largePath `
                -VerificationPath $verificationPath `
                -OutputPath (Join-Path $artifactRoot "large-output.json") `
                -MaxScanSizeMB 1
        } "exceeds the size limit"
    }

    Invoke-Test "Scanner source remains Graph read-only" {
        $source = Get-Content -LiteralPath $scannerPath -Raw
        Assert-True ($source -match 'Invoke-MgGraphRequest\s+-Method\s+GET') "Scanner does not explicitly use Graph GET."
        Assert-True ($source -notmatch 'Invoke-MgGraphRequest\s+-Method\s+(POST|PATCH|PUT|DELETE)') "Scanner contains a Graph write method."
        Assert-True ($source -match 'Invoke-RestMethod\s+-Uri\s+\$RequestUri\s+-Method\s+Get') "Access-token transport does not explicitly use REST GET."
        Assert-True ($source -notmatch 'Invoke-RestMethod[^\r\n]*-Method\s+(Post|Patch|Put|Delete)') "Scanner contains a REST write method."
        Assert-True ($source -match 'sites\?search=\$encodedSearch"') "Scanner does not use the supported delegated site-search request."
        Assert-True ($source -notmatch 'sites\?search=\$encodedSearch&') "Scanner adds unsupported OData parameters to delegated site search."
        Assert-True ($source -notmatch 'subscribedSkus\?[^`r`n]*\$top') "Scanner adds an unsupported page-size parameter to subscribedSkus."
        Assert-True ($source -notmatch 'sites/\$encodedSiteId/permissions') "Scanner calls the site ACL endpoint that requires Sites.FullControl.All."
        $contract = Get-Content -LiteralPath $contractPath -Raw | ConvertFrom-Json
        foreach ($permission in @($contract.scopeContract.requiredPermissions)) {
            Assert-True ($permission -match '\.Read\.All$') "Non-read-only permission found: $permission"
        }
    }

    Invoke-Test "Changed scanner and schema files contain ASCII only" {
        $paths = @(
            $scannerPath,
            $comparePath,
            (Join-Path $scannerRoot "FlightDeck.Common.ps1"),
            $liveTestPath,
            $contractPath,
            $PSCommandPath
        )
        foreach ($path in $paths) {
            $text = Get-Content -LiteralPath $path -Raw
            $nonAscii = @($text.ToCharArray() | Where-Object { [int]$_ -gt 127 })
            Assert-Equal $nonAscii.Count 0 "Non-ASCII characters found in $path."
        }
    }
}
finally {
    if ([System.IO.Directory]::Exists($artifactRoot)) {
        [System.IO.Directory]::Delete($artifactRoot, $true)
    }
}

Write-Host ""
Write-Host "Tests passed: $script:passed"
Write-Host "Tests failed: $script:failed"
if ($script:failed -gt 0) {
    exit 1
}
