[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$BaselinePath,

    [Parameter(Mandatory)]
    [string]$VerificationPath,

    [Parameter()]
    [string]$OutputPath = ".\flight-clearance-verification.json",

    [Parameter()]
    [ValidateRange(1, 50)]
    [int]$MaxScanSizeMB = 10
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot "FlightDeck.Common.ps1")

function Get-FdScanScopeDefinition {
    param(
        [Parameter(Mandatory)]
        $Scan,

        [Parameter(Mandatory)]
        $Contract
    )

    $scope = Get-FdPropertyValue -Object $Scan -Name "scope"
    if ($null -eq $scope) {
        throw "Scan field 'scope' is missing."
    }

    $validation = Get-FdPropertyValue -Object $Contract -Name "validation"
    $permissions = Get-FdStringSet `
        -Value (Get-FdPropertyValue $scope "requiredPermissions") `
        -Name "scope.requiredPermissions" `
        -MaximumCount 100

    $definition = New-FdScopeDefinition `
        -Mode (Get-FdRequiredString (Get-FdPropertyValue $scope "mode") "scope.mode" 100) `
        -MaximumSites (Get-FdStrictInteger (Get-FdPropertyValue $scope "maximumSites") "scope.maximumSites" 1 (Get-FdPropertyValue $validation "maximumSites")) `
        -MaximumDrivesPerSite (Get-FdStrictInteger (Get-FdPropertyValue $scope "maximumDrivesPerSite") "scope.maximumDrivesPerSite" 1 (Get-FdPropertyValue $validation "maximumDrivesPerSite")) `
        -MaximumItemsPerDrive (Get-FdStrictInteger (Get-FdPropertyValue $scope "maximumItemsPerDrive") "scope.maximumItemsPerDrive" 1 (Get-FdPropertyValue $validation "maximumItemsPerDrive")) `
        -MaximumUsers (Get-FdStrictInteger (Get-FdPropertyValue $scope "maximumUsers") "scope.maximumUsers" 1 (Get-FdPropertyValue $validation "maximumUsers")) `
        -MaximumGroups (Get-FdStrictInteger (Get-FdPropertyValue $scope "maximumGroups") "scope.maximumGroups" 1 (Get-FdPropertyValue $validation "maximumGroups")) `
        -MaximumPermissionsPerSite (Get-FdStrictInteger (Get-FdPropertyValue $scope "maximumPermissionsPerSite") "scope.maximumPermissionsPerSite" 1 (Get-FdPropertyValue $validation "maximumPermissionsPerSite")) `
        -MaximumGraphRequests (Get-FdStrictInteger (Get-FdPropertyValue $scope "maximumGraphRequests") "scope.maximumGraphRequests" 1 (Get-FdPropertyValue $validation "maximumGraphRequests")) `
        -RequiredPermissions $permissions `
        -ContentRetrieved (Get-FdStrictBoolean (Get-FdPropertyValue $scope "contentRetrieved") "scope.contentRetrieved") `
        -AuthMode (Get-FdRequiredString (Get-FdPropertyValue $scope "authMode") "scope.authMode" 100) `
        -ActorType (Get-FdRequiredString (Get-FdPropertyValue $scope "actorType") "scope.actorType" 100) `
        -SiteSelection (Get-FdRequiredString (Get-FdPropertyValue $scope "siteSelection") "scope.siteSelection" 100) `
        -ItemSelection (Get-FdRequiredString (Get-FdPropertyValue $scope "itemSelection") "scope.itemSelection" 100)

    $scopeContract = Get-FdPropertyValue -Object $Contract -Name "scopeContract"
    $expectedPermissions = @(
        Get-FdPropertyValue -Object $scopeContract -Name "requiredPermissions" |
            Sort-Object -Unique
    )
    if ($definition.mode -ne (Get-FdPropertyValue $scopeContract "mode") -or
        $definition.contentRetrieved -ne (Get-FdPropertyValue $scopeContract "contentRetrieved") -or
        $definition.siteSelection -ne (Get-FdPropertyValue $scopeContract "siteSelection") -or
        $definition.itemSelection -ne (Get-FdPropertyValue $scopeContract "itemSelection") -or
        (@($definition.requiredPermissions) -join "|") -ne ($expectedPermissions -join "|")) {
        throw "Scan scope does not match the supported read-only scope contract."
    }

    return $definition
}

function Assert-FdCollectionCompleteness {
    param(
        [Parameter(Mandatory)]
        $Scan,

        [Parameter(Mandatory)]
        $Contract
    )

    $completeness = Get-FdPropertyValue -Object $Scan -Name "completeness"
    if ($null -eq $completeness) {
        throw "Scan field 'completeness' is missing."
    }

    $isComplete = Get-FdStrictBoolean `
        -Value (Get-FdPropertyValue $completeness "requiredEvidenceComplete") `
        -Name "completeness.requiredEvidenceComplete"
    $status = Get-FdRequiredString `
        -Value (Get-FdPropertyValue $completeness "status") `
        -Name "completeness.status" `
        -MaximumLength 20
    if (-not $isComplete -or $status -ne "Complete") {
        throw "Scan required evidence is incomplete. Re-run the scan without failed or truncated required collections."
    }

    $reasonsProperty = $completeness.PSObject.Properties["reasons"]
    if ($null -eq $reasonsProperty) {
        throw "Scan field 'completeness.reasons' is missing."
    }
    if (@($reasonsProperty.Value).Count -ne 0) {
        throw "A complete scan must not contain completeness reasons."
    }
    $failedSitesProperty = $completeness.PSObject.Properties["failedSites"]
    if ($null -eq $failedSitesProperty) {
        throw "Scan field 'completeness.failedSites' is missing."
    }
    if (@($failedSitesProperty.Value).Count -ne 0) {
        throw "A complete scan must not contain failed-site details."
    }

    $metadata = Get-FdPropertyValue -Object $Scan -Name "collectionMetadata"
    if ($null -eq $metadata) {
        throw "Scan field 'collectionMetadata' is missing."
    }

    foreach ($collectionName in @($Contract.requiredCollections)) {
        $collection = Get-FdPropertyValue -Object $metadata -Name $collectionName
        if ($null -eq $collection) {
            throw "Required collection metadata '$collectionName' is missing."
        }

        $required = Get-FdStrictBoolean `
            -Value (Get-FdPropertyValue $collection "required") `
            -Name "collectionMetadata.$collectionName.required"
        $failed = Get-FdStrictBoolean `
            -Value (Get-FdPropertyValue $collection "failed") `
            -Name "collectionMetadata.$collectionName.failed"
        $truncated = Get-FdStrictBoolean `
            -Value (Get-FdPropertyValue $collection "truncated") `
            -Name "collectionMetadata.$collectionName.truncated"
        if (-not $required -or $failed -or $truncated) {
            throw "Required collection '$collectionName' is not complete."
        }
    }
}

function Get-FdCoverageMetadata {
    param(
        [Parameter(Mandatory)]
        $Scan,

        [Parameter(Mandatory)]
        $Contract,

        [Parameter(Mandatory)]
        $ScopeDefinition
    )

    $coverage = Get-FdPropertyValue -Object $Scan -Name "coverage"
    if ($null -eq $coverage) {
        throw "Scan field 'coverage' is missing."
    }

    $maximumSites = Get-FdPropertyValue (Get-FdPropertyValue $Contract "validation") "maximumSites"
    $sitesDiscovered = Get-FdStrictInteger `
        (Get-FdPropertyValue $coverage "sitesDiscovered") `
        "coverage.sitesDiscovered" `
        0 `
        $maximumSites
    $sitesSelected = Get-FdStrictInteger `
        (Get-FdPropertyValue $coverage "sitesSelected") `
        "coverage.sitesSelected" `
        0 `
        $ScopeDefinition.maximumSites
    $sitesScanned = Get-FdStrictInteger `
        (Get-FdPropertyValue $coverage "sitesScanned") `
        "coverage.sitesScanned" `
        0 `
        $ScopeDefinition.maximumSites
    $discoveryComplete = Get-FdStrictBoolean `
        (Get-FdPropertyValue $coverage "discoveryComplete") `
        "coverage.discoveryComplete"
    $selectionComplete = Get-FdStrictBoolean `
        (Get-FdPropertyValue $coverage "selectionComplete") `
        "coverage.selectionComplete"
    $limitReached = Get-FdStrictBoolean `
        (Get-FdPropertyValue $coverage "limitReached") `
        "coverage.limitReached"
    $complete = Get-FdStrictBoolean `
        (Get-FdPropertyValue $coverage "complete") `
        "coverage.complete"

    if ($sitesSelected -gt $sitesDiscovered -or $sitesScanned -gt $sitesSelected) {
        throw "Scan coverage contains inconsistent site counts."
    }

    $expectedComplete = (
        $discoveryComplete -and
        $selectionComplete -and
        -not $limitReached -and
        $sitesDiscovered -eq $sitesSelected -and
        $sitesSelected -eq $sitesScanned
    )
    if ($complete -ne $expectedComplete) {
        throw "Scan coverage completeness is inconsistent with its site counts and flags."
    }

    $coverageContract = Get-FdPropertyValue -Object $Contract -Name "coverageContract"
    $requiresCompleteCoverage = Get-FdStrictBoolean `
        (Get-FdPropertyValue $coverageContract "positiveDecisionRequiresComplete") `
        "coverageContract.positiveDecisionRequiresComplete"
    if ($requiresCompleteCoverage -and -not $complete) {
        throw "Scan site coverage is incomplete. Positive decisions require complete site coverage."
    }

    return [pscustomobject][ordered]@{
        sitesDiscovered   = [int]$sitesDiscovered
        sitesSelected     = [int]$sitesSelected
        sitesScanned      = [int]$sitesScanned
        discoveryComplete = $discoveryComplete
        selectionComplete = $selectionComplete
        limitReached      = $limitReached
        complete          = $complete
    }
}

function Assert-FdFindings {
    param(
        [Parameter(Mandatory)]
        $Scan,

        [Parameter(Mandatory)]
        $Contract
    )

    $findingsProperty = $Scan.PSObject.Properties["findings"]
    if ($null -eq $findingsProperty) {
        throw "Scan field 'findings' is missing."
    }

    $findings = @($findingsProperty.Value)
    $maximumFindings = [int](Get-FdPropertyValue (Get-FdPropertyValue $Contract "validation") "maximumFindings")
    if ($findings.Count -gt $maximumFindings) {
        throw "Scan field 'findings' exceeds the maximum item count of $maximumFindings."
    }

    $knownIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    $knownRuleKeys = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    $rules = Get-FdPropertyValue -Object $Contract -Name "rules"
    foreach ($ruleProperty in $rules.PSObject.Properties) {
        $null = $knownRuleKeys.Add([string](Get-FdPropertyValue $ruleProperty.Value "ruleKey"))
    }
    foreach ($finding in $findings) {
        $ruleKey = Get-FdRequiredString (Get-FdPropertyValue $finding "ruleKey") "findings.ruleKey" 100
        if ($ruleKey -notmatch '^AFD-[A-Z0-9-]+-\d{3}$') {
            throw "Finding ruleKey '$ruleKey' is invalid."
        }
        if (-not $knownRuleKeys.Contains($ruleKey)) {
            throw "Finding ruleKey '$ruleKey' is not defined by the supported policy."
        }
        $findingId = Get-FdRequiredString (Get-FdPropertyValue $finding "findingId") "findings.findingId" 200
        $expectedFindingId = "finding:$($ruleKey.ToLowerInvariant())"
        if ($findingId -ne $expectedFindingId) {
            throw "Finding '$ruleKey' has an unstable findingId."
        }
        if (-not $knownIds.Add($findingId)) {
            throw "Scan contains duplicate findingId '$findingId'."
        }

        $severity = Get-FdRequiredString (Get-FdPropertyValue $finding "severity") "findings.severity" 20
        if ($severity -notin @("critical", "high", "medium", "low")) {
            throw "Finding '$ruleKey' has invalid severity '$severity'."
        }

        $null = Get-FdRequiredString (Get-FdPropertyValue $finding "title") "findings.title"
        $null = Get-FdRequiredString (Get-FdPropertyValue $finding "detail") "findings.detail"
        $null = Get-FdRequiredString (Get-FdPropertyValue $finding "impact") "findings.impact"
        $evidenceIdsProperty = $finding.PSObject.Properties["evidenceIds"]
        if ($null -eq $evidenceIdsProperty) {
            throw "Scan field 'findings.evidenceIds' is missing."
        }
        if (@($evidenceIdsProperty.Value).Count -gt 0) {
            $null = Get-FdStringSet $evidenceIdsProperty.Value "findings.evidenceIds"
        }
    }
}

function Read-FlightDeckScan {
    param(
        [Parameter(Mandatory)]
        [string]$Path,

        [Parameter(Mandatory)]
        $Contract
    )

    $resolvedPath = Resolve-FdLiteralPath -Path $Path
    if (-not (Test-Path -LiteralPath $resolvedPath -PathType Leaf)) {
        throw "Scan file not found: $resolvedPath"
    }

    $file = Get-Item -LiteralPath $resolvedPath
    $maximumBytes = [long]$MaxScanSizeMB * 1MB
    if ($file.Length -gt $maximumBytes) {
        throw "Scan file exceeds the size limit of $MaxScanSizeMB MB: $resolvedPath"
    }

    try {
        $json = Get-Content -LiteralPath $resolvedPath -Raw
        $convertCommand = Get-Command ConvertFrom-Json
        if ($convertCommand.Parameters.ContainsKey("DateKind")) {
            $scan = $json | ConvertFrom-Json -DateKind String
        }
        else {
            $scan = $json | ConvertFrom-Json
        }
    }
    catch {
        throw "Scan file is not valid JSON: $resolvedPath. $($_.Exception.Message)"
    }

    $schemaVersion = Get-FdPropertyValue -Object $scan -Name "schemaVersion"
    if (-not (Test-FdCompatibleSchema -Version $schemaVersion)) {
        throw "Scan schemaVersion is missing or incompatible: $resolvedPath"
    }

    $documentType = Get-FdRequiredString (Get-FdPropertyValue $scan "documentType") "documentType" 100
    if ($documentType -ne (Get-FdPropertyValue $Contract "documentType")) {
        throw "File is not an AI Flight Deck tenant scan: $resolvedPath"
    }

    $producer = Get-FdRequiredString (Get-FdPropertyValue $scan "producer") "producer" 200
    $producerVersion = Get-FdRequiredString (Get-FdPropertyValue $scan "producerVersion") "producerVersion" 100
    $scoringVersion = Get-FdRequiredString (Get-FdPropertyValue $scan "scoringVersion") "scoringVersion" 100
    if ($producer -ne (Get-FdPropertyValue $Contract "producer") -or
        $producerVersion -ne (Get-FdPropertyValue $Contract "producerVersion") -or
        $scoringVersion -ne (Get-FdPropertyValue $Contract "scoringVersion")) {
        throw "Scan producer or scoring version is not supported by this comparator."
    }

    $generatedAt = Get-FdTimestamp (Get-FdPropertyValue $scan "generatedAt") "generatedAt"
    $tenant = Get-FdPropertyValue -Object $scan -Name "tenant"
    if ($null -eq $tenant) {
        throw "Scan field 'tenant' is missing."
    }
    $tenantIdText = Get-FdRequiredString (Get-FdPropertyValue $tenant "tenantId") "tenant.tenantId" 64
    $tenantId = [guid]::Empty
    if (-not [guid]::TryParse($tenantIdText, [ref]$tenantId)) {
        throw "Scan field 'tenant.tenantId' must be a GUID."
    }
    $tenantIdText = $tenantId.ToString().ToLowerInvariant()

    $auth = Get-FdPropertyValue -Object $scan -Name "auth"
    $authMode = Get-FdRequiredString (Get-FdPropertyValue $auth "mode") "auth.mode" 100
    if ($authMode -notin @("Interactive", "DeviceCode", "ExistingContext", "ManagedIdentity", "Certificate")) {
        throw "Scan field 'auth.mode' is invalid."
    }
    $actor = Get-FdPropertyValue -Object $auth -Name "actor"
    $actorType = Get-FdRequiredString (Get-FdPropertyValue $actor "type") "auth.actor.type" 100
    $actorId = Get-FdRequiredString (Get-FdPropertyValue $actor "id") "auth.actor.id" 500
    if ($actorId -eq "unresolved") {
        throw "Scan collecting actor is unresolved."
    }

    $scopeDefinition = Get-FdScanScopeDefinition -Scan $scan -Contract $Contract
    if ($scopeDefinition.authMode -ne $authMode -or $scopeDefinition.actorType -ne $actorType) {
        throw "Scan auth metadata does not match the recorded scope."
    }
    $scopeFingerprint = Get-FdScopeFingerprint -ScopeDefinition $scopeDefinition
    $recordedScopeFingerprint = Get-FdRequiredString `
        (Get-FdPropertyValue (Get-FdPropertyValue $scan "scope") "fingerprint") `
        "scope.fingerprint" `
        64
    if ($recordedScopeFingerprint -notmatch '^[a-f0-9]{64}$' -or $recordedScopeFingerprint -ne $scopeFingerprint) {
        throw "Scan scope fingerprint is invalid."
    }

    $policyHash = Get-FdRequiredString (Get-FdPropertyValue $scan "policyHash") "policyHash" 64
    $expectedPolicyHash = Get-FdPolicyHash -Contract $Contract
    if ($policyHash -notmatch '^[a-f0-9]{64}$' -or $policyHash -ne $expectedPolicyHash) {
        throw "Scan policy hash does not match the supported policy."
    }
    $configHash = Get-FdRequiredString (Get-FdPropertyValue $scan "configHash") "configHash" 64
    $expectedConfigHash = Get-FdConfigurationHash `
        -Contract $Contract `
        -PolicyHash $policyHash `
        -ScopeFingerprint $scopeFingerprint `
        -Producer $producer `
        -ProducerVersion $producerVersion `
        -ScoringVersion $scoringVersion
    if ($configHash -notmatch '^[a-f0-9]{64}$' -or $configHash -ne $expectedConfigHash) {
        throw "Scan config hash is invalid."
    }

    $coverage = Get-FdCoverageMetadata `
        -Scan $scan `
        -Contract $Contract `
        -ScopeDefinition $scopeDefinition
    Assert-FdCollectionCompleteness -Scan $scan -Contract $Contract
    Assert-FdFindings -Scan $scan -Contract $Contract

    $validation = Get-FdPropertyValue -Object $Contract -Name "validation"
    $maximumCount = Get-FdPropertyValue $validation "maximumCount"
    $summary = Get-FdPropertyValue -Object $scan -Name "summary"
    if ($null -eq $summary) {
        throw "Scan field 'summary' is missing."
    }
    $readinessScore = Get-FdStrictInteger (Get-FdPropertyValue $summary "readinessScore") "summary.readinessScore" 0 100
    $readinessVerified = Get-FdStrictBoolean (Get-FdPropertyValue $summary "readinessScoreVerified") "summary.readinessScoreVerified"
    if (-not $readinessVerified) {
        throw "Scan does not contain a verified readiness score."
    }
    $readinessStatus = Get-FdRequiredString (Get-FdPropertyValue $summary "readinessScoreStatus") "summary.readinessScoreStatus" 100
    if ($readinessStatus -ne "Verified") {
        throw "Scan readiness score status must be 'Verified' for comparison."
    }
    $criticalExposures = Get-FdStrictInteger (Get-FdPropertyValue $summary "criticalExposures") "summary.criticalExposures" 0 $maximumCount
    $exposedItems = Get-FdStrictInteger (Get-FdPropertyValue $summary "exposedItems") "summary.exposedItems" 0 $maximumCount
    $sitesDiscovered = Get-FdStrictInteger (Get-FdPropertyValue $summary "sitesDiscovered") "summary.sitesDiscovered" 0 (Get-FdPropertyValue $validation "maximumSites")
    $sitesScanned = Get-FdStrictInteger (Get-FdPropertyValue $summary "sitesScanned") "summary.sitesScanned" 0 (Get-FdPropertyValue $validation "maximumSites")
    $users = Get-FdStrictInteger (Get-FdPropertyValue $summary "users") "summary.users" 0 $maximumCount
    $guests = Get-FdStrictInteger (Get-FdPropertyValue $summary "guests") "summary.guests" 0 $maximumCount
    $groups = Get-FdStrictInteger (Get-FdPropertyValue $summary "groups") "summary.groups" 0 $maximumCount
    $broadAccessSites = Get-FdStrictInteger (Get-FdPropertyValue $summary "broadAccessSites") "summary.broadAccessSites" 0 $maximumCount
    $anonymousLinks = Get-FdStrictInteger (Get-FdPropertyValue $summary "anonymousLinks") "summary.anonymousLinks" 0 $maximumCount
    $organizationLinks = Get-FdStrictInteger (Get-FdPropertyValue $summary "organizationLinks") "summary.organizationLinks" 0 $maximumCount
    $sampledItems = Get-FdStrictInteger (Get-FdPropertyValue $summary "sampledItems") "summary.sampledItems" 0 $maximumCount
    $graphRequests = Get-FdStrictInteger (Get-FdPropertyValue $summary "graphRequests") "summary.graphRequests" 0 (Get-FdPropertyValue $validation "maximumGraphRequests")

    if ($sitesDiscovered -gt (Get-FdPropertyValue $validation "maximumSites") -or
        $sitesScanned -gt $scopeDefinition.maximumSites -or
        $users -gt $scopeDefinition.maximumUsers -or
        $groups -gt $scopeDefinition.maximumGroups -or
        $graphRequests -gt $scopeDefinition.maximumGraphRequests) {
        throw "Scan summary counts exceed the recorded scope bounds."
    }
    if ($guests -gt $users -or $broadAccessSites -gt $sitesScanned) {
        throw "Scan summary contains internally inconsistent population counts."
    }
    if ($sitesDiscovered -ne $coverage.sitesDiscovered -or $sitesScanned -ne $coverage.sitesScanned) {
        throw "Scan summary site counts do not match coverage metadata."
    }

    $evidence = Get-FdPropertyValue -Object $scan -Name "evidenceSets"
    if ($null -eq $evidence) {
        throw "Scan field 'evidenceSets' is missing."
    }
    $normalizedEvidence = [ordered]@{}
    foreach ($setName in @($Contract.evidenceSets)) {
        $setProperty = $evidence.PSObject.Properties[$setName]
        if ($null -eq $setProperty) {
            throw "Scan field 'evidenceSets.$setName' is missing."
        }
        if (@($setProperty.Value).Count -eq 0) {
            $normalizedEvidence[$setName] = @()
        }
        else {
            $normalizedEvidence[$setName] = Get-FdStringSet `
                -Value $setProperty.Value `
                -Name "evidenceSets.$setName" `
                -MaximumCount (Get-FdPropertyValue $validation "maximumEvidenceIdsPerSet")
        }
    }
    if ($criticalExposures -ne @($normalizedEvidence.criticalEvidenceIds).Count) {
        throw "summary.criticalExposures does not match evidenceSets.criticalEvidenceIds."
    }
    if ($exposedItems -ne @($normalizedEvidence.sharedItemIds).Count) {
        throw "summary.exposedItems does not match evidenceSets.sharedItemIds."
    }
    if ($anonymousLinks -ne @($normalizedEvidence.anonymousPermissionIds).Count -or
        $organizationLinks -ne @($normalizedEvidence.organizationPermissionIds).Count -or
        $broadAccessSites -ne @($normalizedEvidence.broadAccessSiteIds).Count -or
        $guests -ne @($normalizedEvidence.guestUserIds).Count) {
        throw "Scan summary counts do not match the raw evidence sets."
    }
    $expectedCriticalEvidence = @(
            @($normalizedEvidence.anonymousPermissionIds) |
                Sort-Object -Unique
    )
    if (($expectedCriticalEvidence -join "|") -ne (@($normalizedEvidence.criticalEvidenceIds) -join "|")) {
        throw "evidenceSets.criticalEvidenceIds is not the union of critical raw evidence."
    }

    $readiness = Get-FdReadinessCalculation `
        -Contract $Contract `
        -AnonymousPermissionCount $anonymousLinks `
        -OrganizationPermissionCount $organizationLinks `
        -BroadAccessSiteCount $broadAccessSites `
        -ExposedItemCount $exposedItems
    $expectedRaw = $readiness.raw
    $expectedScore = $readiness.score
    $readinessRaw = Get-FdStrictInteger (Get-FdPropertyValue $summary "readinessRaw") "summary.readinessRaw" -2000000000 100
    $readinessSaturated = Get-FdStrictBoolean (Get-FdPropertyValue $summary "readinessSaturated") "summary.readinessSaturated"
    if ($readinessRaw -ne $expectedRaw -or
        $readinessScore -ne $expectedScore -or
        $readinessSaturated -ne $readiness.saturated) {
        throw "Scan readiness score is not reproducible from the raw evidence sets."
    }

    return [pscustomobject][ordered]@{
        path              = $resolvedPath
        raw               = $scan
        generatedAt       = $generatedAt
        tenantId          = $tenantIdText
        tenantDisplayName = Get-FdPropertyValue $tenant "displayName"
        producer          = $producer
        producerVersion   = $producerVersion
        scoringVersion    = $scoringVersion
        policyHash        = $policyHash
        configHash        = $configHash
        scopeFingerprint  = $scopeFingerprint
        authMode          = $authMode
        actorType         = $actorType
        actorId           = $actorId
        readinessScore    = [int]$readinessScore
        criticalExposures = [int]$criticalExposures
        exposedItems      = [int]$exposedItems
        sitesDiscovered   = [int]$sitesDiscovered
        sitesScanned      = [int]$sitesScanned
        coverage          = $coverage
        evidenceSets      = $normalizedEvidence
    }
}

function Compare-FdStringSets {
    param(
        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [string[]]$Baseline,

        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [string[]]$Verification
    )

    $baselineSet = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    $verificationSet = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    foreach ($item in $Baseline) {
        $null = $baselineSet.Add($item)
    }
    foreach ($item in $Verification) {
        $null = $verificationSet.Add($item)
    }

    $opened = @($Verification | Where-Object { -not $baselineSet.Contains($_) } | Sort-Object)
    $closed = @($Baseline | Where-Object { -not $verificationSet.Contains($_) } | Sort-Object)
    return [pscustomobject][ordered]@{
        opened = $opened
        closed = $closed
    }
}

$contract = Read-FdContract
$baselineResolved = Resolve-FdLiteralPath -Path $BaselinePath
$verificationResolved = Resolve-FdLiteralPath -Path $VerificationPath
$outputResolved = Resolve-FdLiteralPath -Path $OutputPath
if ($baselineResolved -eq $verificationResolved) {
    throw "BaselinePath and VerificationPath must refer to different files."
}
if ($outputResolved -eq $baselineResolved -or $outputResolved -eq $verificationResolved) {
    throw "OutputPath must not overwrite an input scan."
}

$baseline = Read-FlightDeckScan -Path $baselineResolved -Contract $contract
$verification = Read-FlightDeckScan -Path $verificationResolved -Contract $contract

if ($baseline.tenantId -ne $verification.tenantId) {
    throw "The baseline and verification scans belong to different tenants."
}
if ($verification.generatedAt -le $baseline.generatedAt) {
    throw "Verification scan must be newer than the baseline scan."
}
if ($baseline.scopeFingerprint -ne $verification.scopeFingerprint) {
    throw "The scans have different scope fingerprints and cannot be compared."
}
if ($baseline.configHash -ne $verification.configHash -or
    $baseline.policyHash -ne $verification.policyHash -or
    $baseline.scoringVersion -ne $verification.scoringVersion -or
    $baseline.producer -ne $verification.producer -or
    $baseline.producerVersion -ne $verification.producerVersion) {
    throw "The scans use different producer, scoring, policy, or configuration contracts."
}
if ($baseline.authMode -ne $verification.authMode -or
    $baseline.actorType -ne $verification.actorType -or
    $baseline.actorId -ne $verification.actorId) {
    throw "The scans were collected under different authentication actors or modes."
}

$scoreDelta = $verification.readinessScore - $baseline.readinessScore
$criticalDelta = $verification.criticalExposures - $baseline.criticalExposures
$exposureDelta = $verification.exposedItems - $baseline.exposedItems

$evidenceChanges = [ordered]@{}
foreach ($setName in @($contract.evidenceSets)) {
    $evidenceChanges[$setName] = Compare-FdStringSets `
        -Baseline @($baseline.evidenceSets[$setName]) `
        -Verification @($verification.evidenceSets[$setName])
}

$openedCritical = @($evidenceChanges.criticalEvidenceIds.opened)
$closedCritical = @($evidenceChanges.criticalEvidenceIds.closed)
$openedShared = @($evidenceChanges.sharedItemIds.opened)
$closedShared = @($evidenceChanges.sharedItemIds.closed)

$regressed = (
    $scoreDelta -lt 0 -or
    $criticalDelta -gt 0 -or
    $exposureDelta -gt 0 -or
    $openedCritical.Count -gt 0 -or
    $openedShared.Count -gt 0
)
$improved = (
    -not $regressed -and (
        $scoreDelta -gt 0 -or
        $criticalDelta -lt 0 -or
        $exposureDelta -lt 0 -or
        $closedCritical.Count -gt 0 -or
        $closedShared.Count -gt 0
    )
)
$status = if ($regressed) {
    "DriftDetected"
}
elseif ($improved) {
    "ImprovementVerified"
}
else {
    "NoMaterialChange"
}

$clearancePolicy = Get-FdPropertyValue -Object $contract -Name "clearance"
$minimumReadiness = [int](Get-FdPropertyValue $clearancePolicy "minimumReadinessScore")
$maximumCritical = [int](Get-FdPropertyValue $clearancePolicy "maximumCriticalExposures")
$positiveDecisionCode = Get-FdRequiredString `
    (Get-FdPropertyValue $clearancePolicy "positiveDecisionCode") `
    "clearance.positiveDecisionCode" `
    100
$positiveDecision = (
    $status -eq "ImprovementVerified" -and
    $verification.criticalExposures -le $maximumCritical -and
    $verification.readinessScore -ge $minimumReadiness -and
    $openedCritical.Count -eq 0 -and
    $baseline.coverage.complete -and
    $verification.coverage.complete
)
$decision = if ($positiveDecision) {
    $positiveDecisionCode
}
elseif ($regressed) {
    "Hold"
}
elseif ($improved) {
    "Remediate"
}
else {
    "VerifyAgain"
}

$allowedDecisionCodes = @(
    Get-FdPropertyValue -Object $clearancePolicy -Name "decisionCodes"
)
if ($decision -notin $allowedDecisionCodes) {
    throw "Comparator produced decision code '$decision' outside the contract vocabulary."
}

$result = [ordered]@{
    schemaVersion   = "1.0"
    documentType    = "verification-report"
    reportType      = "ai-flight-clearance-verification"
    producer        = "ai-flight-deck/compare-scans.ps1"
    producerVersion = Get-FdPropertyValue $contract "producerVersion"
    scoringVersion  = $baseline.scoringVersion
    policyHash      = $baseline.policyHash
    configHash      = $baseline.configHash
    generatedAt     = (Get-Date).ToUniversalTime().ToString("o")
    tenant          = [ordered]@{
        tenantId    = $baseline.tenantId
        displayName = $baseline.tenantDisplayName
    }
    baseline        = [ordered]@{
        fileName          = [System.IO.Path]::GetFileName($baseline.path)
        generatedAt       = $baseline.generatedAt.ToUniversalTime().ToString("o")
        readinessScore    = $baseline.readinessScore
        criticalExposures = $baseline.criticalExposures
        exposedItems      = $baseline.exposedItems
        sitesDiscovered   = $baseline.sitesDiscovered
        sitesScanned      = $baseline.sitesScanned
        coverageComplete  = $baseline.coverage.complete
    }
    verification    = [ordered]@{
        fileName          = [System.IO.Path]::GetFileName($verification.path)
        generatedAt       = $verification.generatedAt.ToUniversalTime().ToString("o")
        readinessScore    = $verification.readinessScore
        criticalExposures = $verification.criticalExposures
        exposedItems      = $verification.exposedItems
        sitesDiscovered   = $verification.sitesDiscovered
        sitesScanned      = $verification.sitesScanned
        coverageComplete  = $verification.coverage.complete
    }
    change          = [ordered]@{
        readinessScore    = $scoreDelta
        criticalExposures = $criticalDelta
        exposedItems      = $exposureDelta
        evidenceSets      = $evidenceChanges
    }
    status          = $status
    decision        = $decision
    clearance       = $decision
    controls        = [ordered]@{
        sameTenantVerified       = $true
        newerVerificationVerified = $true
        sameScopeVerified        = $true
        samePolicyVerified       = $true
        sameConfigVerified       = $true
        sameAuthActorVerified    = $true
        completeEvidenceVerified = $true
        completeCoverageVerified = $baseline.coverage.complete -and $verification.coverage.complete
        scopeFingerprint         = $baseline.scopeFingerprint
        writeActionsTaken        = $false
        evidenceOnly             = $true
    }
}

$resolvedOutput = Write-FdJsonFile -Value $result -Path $outputResolved -Depth 32

Write-Host "Verification complete."
Write-Host "Status: $status"
Write-Host "Decision: $decision"
Write-Host "Readiness change: $scoreDelta"
Write-Host "Critical exposure change: $criticalDelta"
Write-Host "Exposed item change: $exposureDelta"
Write-Host "Output: $resolvedOutput"
