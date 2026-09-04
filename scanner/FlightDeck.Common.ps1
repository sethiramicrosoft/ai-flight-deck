$script:FlightDeckCommonRoot = $PSScriptRoot

function Get-FdPropertyValue {
    param(
        [Parameter()]
        $Object,

        [Parameter(Mandatory)]
        [string]$Name
    )

    if ($null -eq $Object) {
        return $null
    }

    if ($Object -is [System.Collections.IDictionary] -and $Object.Contains($Name)) {
        return $Object[$Name]
    }

    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $null
    }

    return $property.Value
}

function Get-FdNestedValue {
    param(
        [Parameter()]
        $Object,

        [Parameter(Mandatory)]
        [string[]]$Path
    )

    $current = $Object
    foreach ($segment in $Path) {
        $current = Get-FdPropertyValue -Object $current -Name $segment
        if ($null -eq $current) {
            return $null
        }
    }

    return $current
}

function Get-FdRequiredString {
    param(
        [Parameter()]
        $Value,

        [Parameter(Mandatory)]
        [string]$Name,

        [Parameter()]
        [int]$MaximumLength = 4096
    )

    if ($Value -isnot [string]) {
        throw "Scan field '$Name' must be a string."
    }

    $text = $Value.Trim()
    if ($text.Length -eq 0) {
        throw "Scan field '$Name' must not be blank."
    }
    if ($text.Length -gt $MaximumLength) {
        throw "Scan field '$Name' exceeds the maximum length of $MaximumLength characters."
    }

    return $text
}

function Get-FdStrictInteger {
    param(
        [Parameter()]
        $Value,

        [Parameter(Mandatory)]
        [string]$Name,

        [Parameter()]
        [long]$Minimum = 0,

        [Parameter()]
        [long]$Maximum = 2000000000
    )

    if ($null -eq $Value) {
        throw "Scan field '$Name' is missing."
    }

    $typeCode = [System.Type]::GetTypeCode($Value.GetType())
    $integerTypes = @(
        [System.TypeCode]::Byte,
        [System.TypeCode]::SByte,
        [System.TypeCode]::Int16,
        [System.TypeCode]::UInt16,
        [System.TypeCode]::Int32,
        [System.TypeCode]::UInt32,
        [System.TypeCode]::Int64,
        [System.TypeCode]::UInt64
    )

    if ($integerTypes -notcontains $typeCode) {
        throw "Scan field '$Name' must be a JSON integer."
    }

    try {
        $parsed = [long]$Value
    }
    catch {
        throw "Scan field '$Name' is outside the supported integer range."
    }

    if ($parsed -lt $Minimum -or $parsed -gt $Maximum) {
        throw "Scan field '$Name' must be between $Minimum and $Maximum."
    }

    return $parsed
}

function Get-FdStrictBoolean {
    param(
        [Parameter()]
        $Value,

        [Parameter(Mandatory)]
        [string]$Name
    )

    if ($Value -isnot [bool]) {
        throw "Scan field '$Name' must be a JSON boolean."
    }

    return [bool]$Value
}

function Get-FdTimestamp {
    param(
        [Parameter()]
        $Value,

        [Parameter(Mandatory)]
        [string]$Name
    )

    $text = Get-FdRequiredString -Value $Value -Name $Name -MaximumLength 64
    if ($text -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$') {
        throw "Scan field '$Name' must be an ISO 8601 timestamp with a UTC or offset suffix."
    }

    $parsed = [DateTimeOffset]::MinValue
    $style = [System.Globalization.DateTimeStyles]::RoundtripKind
    $culture = [System.Globalization.CultureInfo]::InvariantCulture
    if (-not [DateTimeOffset]::TryParse($text, $culture, $style, [ref]$parsed)) {
        throw "Scan field '$Name' is not a valid timestamp."
    }

    return $parsed
}

function Get-FdStringSet {
    param(
        [Parameter()]
        $Value,

        [Parameter(Mandatory)]
        [string]$Name,

        [Parameter()]
        [int]$MaximumCount = 2000000,

        [Parameter()]
        [int]$MaximumItemLength = 2048
    )

    if ($null -eq $Value) {
        throw "Scan field '$Name' is missing."
    }

    $items = @($Value)
    if ($items.Count -gt $MaximumCount) {
        throw "Scan field '$Name' exceeds the maximum item count of $MaximumCount."
    }

    $validated = [System.Collections.Generic.List[string]]::new()
    $unique = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    foreach ($item in $items) {
        $text = Get-FdRequiredString -Value $item -Name $Name -MaximumLength $MaximumItemLength
        if (-not $unique.Add($text)) {
            throw "Scan field '$Name' contains duplicate identifiers."
        }
        $validated.Add($text)
    }

    [string[]]$sorted = @($validated)
    [System.Array]::Sort($sorted, [System.StringComparer]::Ordinal)
    return $sorted
}

function ConvertTo-FdCanonicalJsonString {
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string]$Value
    )

    $builder = [System.Text.StringBuilder]::new()
    $null = $builder.Append('"')
    foreach ($character in $Value.ToCharArray()) {
        $code = [int]$character
        switch ($code) {
            8 { $null = $builder.Append('\b'); continue }
            9 { $null = $builder.Append('\t'); continue }
            10 { $null = $builder.Append('\n'); continue }
            12 { $null = $builder.Append('\f'); continue }
            13 { $null = $builder.Append('\r'); continue }
            34 { $null = $builder.Append('\"'); continue }
            92 { $null = $builder.Append('\\'); continue }
        }

        if ($code -lt 32) {
            $null = $builder.Append(('\u{0:x4}' -f $code))
        }
        else {
            $null = $builder.Append($character)
        }
    }
    $null = $builder.Append('"')
    return $builder.ToString()
}

function ConvertTo-FdCanonicalJson {
    param(
        [Parameter()]
        [AllowNull()]
        $Value
    )

    if ($null -eq $Value) {
        return "null"
    }
    if ($Value -is [bool]) {
        return $(if ($Value) { "true" } else { "false" })
    }
    if ($Value -is [string] -or $Value -is [char]) {
        return ConvertTo-FdCanonicalJsonString -Value ([string]$Value)
    }
    if ($Value -is [guid]) {
        return ConvertTo-FdCanonicalJsonString -Value $Value.ToString().ToLowerInvariant()
    }
    if ($Value -is [DateTimeOffset]) {
        return ConvertTo-FdCanonicalJsonString -Value $Value.ToUniversalTime().ToString("o")
    }
    if ($Value -is [DateTime]) {
        return ConvertTo-FdCanonicalJsonString -Value $Value.ToUniversalTime().ToString("o")
    }

    $typeCode = [System.Type]::GetTypeCode($Value.GetType())
    $integerTypes = @(
        [System.TypeCode]::Byte,
        [System.TypeCode]::SByte,
        [System.TypeCode]::Int16,
        [System.TypeCode]::UInt16,
        [System.TypeCode]::Int32,
        [System.TypeCode]::UInt32,
        [System.TypeCode]::Int64,
        [System.TypeCode]::UInt64
    )
    if ($integerTypes -contains $typeCode) {
        return ([System.Convert]::ToString($Value, [System.Globalization.CultureInfo]::InvariantCulture))
    }
    if ($typeCode -eq [System.TypeCode]::Decimal) {
        return ([decimal]$Value).ToString("G29", [System.Globalization.CultureInfo]::InvariantCulture)
    }
    if ($typeCode -in @([System.TypeCode]::Double, [System.TypeCode]::Single)) {
        $number = [double]$Value
        if ([double]::IsNaN($number) -or [double]::IsInfinity($number)) {
            throw "Canonical JSON does not support non-finite numbers."
        }
        return $number.ToString("R", [System.Globalization.CultureInfo]::InvariantCulture)
    }

    if ($Value -is [System.Collections.IDictionary]) {
        [string[]]$keys = @($Value.Keys | ForEach-Object { [string]$_ })
        [System.Array]::Sort($keys, [System.StringComparer]::Ordinal)
        $members = [System.Collections.Generic.List[string]]::new()
        foreach ($key in $keys) {
            $members.Add(
                "$(ConvertTo-FdCanonicalJsonString -Value $key):$(ConvertTo-FdCanonicalJson -Value $Value[$key])"
            )
        }
        return "{$($members -join ',')}"
    }

    if ($Value -is [System.Collections.IEnumerable]) {
        $items = [System.Collections.Generic.List[string]]::new()
        foreach ($item in $Value) {
            $items.Add((ConvertTo-FdCanonicalJson -Value $item))
        }
        return "[$($items -join ',')]"
    }

    $properties = @(
        $Value.PSObject.Properties |
            Where-Object { $_.MemberType -in @("NoteProperty", "Property") }
    )
    if ($properties.Count -gt 0) {
        [string[]]$names = @($properties | ForEach-Object { $_.Name })
        [System.Array]::Sort($names, [System.StringComparer]::Ordinal)
        $members = [System.Collections.Generic.List[string]]::new()
        foreach ($name in $names) {
            $members.Add(
                "$(ConvertTo-FdCanonicalJsonString -Value $name):$(ConvertTo-FdCanonicalJson -Value (Get-FdPropertyValue -Object $Value -Name $name))"
            )
        }
        return "{$($members -join ',')}"
    }

    throw "Canonical JSON does not support values of type '$($Value.GetType().FullName)'."
}

function Get-FdSha256Hex {
    param(
        [Parameter(Mandatory)]
        [string]$Text
    )

    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
        return ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace("-", "").ToLowerInvariant()
    }
    finally {
        $sha.Dispose()
    }
}

function Get-FdContractPath {
    return [System.IO.Path]::GetFullPath((Join-Path $script:FlightDeckCommonRoot "..\schema\scan-contract.v1.json"))
}

function Read-FdContract {
    $path = Get-FdContractPath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "AI Flight Deck scan contract not found: $path"
    }

    try {
        return (Get-Content -LiteralPath $path -Raw | ConvertFrom-Json)
    }
    catch {
        throw "AI Flight Deck scan contract is invalid JSON: $($_.Exception.Message)"
    }
}

function Get-FdReadinessCatalogPath {
    return [System.IO.Path]::GetFullPath((Join-Path $script:FlightDeckCommonRoot "..\schema\readiness-catalog.v1.json"))
}

function Read-FdReadinessCatalog {
    $path = Get-FdReadinessCatalogPath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "AI Flight Deck readiness catalog not found: $path"
    }

    try {
        return (Get-Content -LiteralPath $path -Raw | ConvertFrom-Json)
    }
    catch {
        throw "AI Flight Deck readiness catalog is invalid JSON: $($_.Exception.Message)"
    }
}

function New-FdScopeDefinition {
    param(
        [Parameter(Mandatory)]
        [string]$Mode,

        [Parameter(Mandatory)]
        [long]$MaximumSites,

        [Parameter(Mandatory)]
        [long]$MaximumDrivesPerSite,

        [Parameter(Mandatory)]
        [long]$MaximumItemsPerDrive,

        [Parameter(Mandatory)]
        [long]$MaximumUsers,

        [Parameter(Mandatory)]
        [long]$MaximumGroups,

        [Parameter(Mandatory)]
        [long]$MaximumPermissionsPerSite,

        [Parameter(Mandatory)]
        [long]$MaximumGraphRequests,

        [Parameter(Mandatory)]
        [string[]]$RequiredPermissions,

        [Parameter(Mandatory)]
        [bool]$ContentRetrieved,

        [Parameter(Mandatory)]
        [string]$AuthMode,

        [Parameter(Mandatory)]
        [string]$ActorType,

        [Parameter(Mandatory)]
        [string]$SiteSelection,

        [Parameter(Mandatory)]
        [string]$ItemSelection
    )

    return [ordered]@{
        mode                      = $Mode
        maximumSites              = $MaximumSites
        maximumDrivesPerSite      = $MaximumDrivesPerSite
        maximumItemsPerDrive      = $MaximumItemsPerDrive
        maximumUsers              = $MaximumUsers
        maximumGroups             = $MaximumGroups
        maximumPermissionsPerSite = $MaximumPermissionsPerSite
        maximumGraphRequests      = $MaximumGraphRequests
        requiredPermissions       = @($RequiredPermissions | Sort-Object -Unique)
        contentRetrieved          = $ContentRetrieved
        authMode                  = $AuthMode
        actorType                 = $ActorType
        siteSelection             = $SiteSelection
        itemSelection             = $ItemSelection
    }
}

function Get-FdScopeFingerprint {
    param(
        [Parameter(Mandatory)]
        $ScopeDefinition
    )

    return Get-FdSha256Hex -Text (ConvertTo-FdCanonicalJson -Value $ScopeDefinition)
}

function Get-FdPolicyHash {
    param(
        [Parameter(Mandatory)]
        $Contract
    )

    $policy = [ordered]@{
        policyVersion  = Get-FdPropertyValue -Object $Contract -Name "policyVersion"
        scoringVersion = Get-FdPropertyValue -Object $Contract -Name "scoringVersion"
        scoring        = Get-FdPropertyValue -Object $Contract -Name "scoring"
        clearance      = Get-FdPropertyValue -Object $Contract -Name "clearance"
        rules          = Get-FdPropertyValue -Object $Contract -Name "rules"
        evidenceDefinitions = Get-FdPropertyValue -Object $Contract -Name "evidenceDefinitions"
        coverageContract = Get-FdPropertyValue -Object $Contract -Name "coverageContract"
    }

    return Get-FdSha256Hex -Text (ConvertTo-FdCanonicalJson -Value $policy)
}

function Get-FdConfigurationHash {
    param(
        [Parameter(Mandatory)]
        $Contract,

        [Parameter(Mandatory)]
        [string]$PolicyHash,

        [Parameter(Mandatory)]
        [string]$ScopeFingerprint,

        [Parameter(Mandatory)]
        [string]$Producer,

        [Parameter(Mandatory)]
        [string]$ProducerVersion,

        [Parameter(Mandatory)]
        [string]$ScoringVersion
    )

    $configuration = [ordered]@{
        policyHash       = $PolicyHash
        scopeFingerprint = $ScopeFingerprint
        producer         = $Producer
        producerVersion  = $ProducerVersion
        scoringVersion   = $ScoringVersion
        schemaVersion    = Get-FdPropertyValue -Object $Contract -Name "schemaVersion"
        documentType     = Get-FdPropertyValue -Object $Contract -Name "documentType"
        requiredCollections = @(
            Get-FdPropertyValue -Object $Contract -Name "requiredCollections"
        )
        evidenceSets     = @(
            Get-FdPropertyValue -Object $Contract -Name "evidenceSets"
        )
        validation       = Get-FdPropertyValue -Object $Contract -Name "validation"
    }

    return Get-FdSha256Hex -Text (ConvertTo-FdCanonicalJson -Value $configuration)
}

function Get-FdReadinessCalculation {
    param(
        [Parameter(Mandatory)]
        $Contract,

        [Parameter(Mandatory)]
        [long]$AnonymousPermissionCount,

        [Parameter(Mandatory)]
        [long]$OrganizationPermissionCount,

        [Parameter(Mandatory)]
        [long]$BroadAccessSiteCount,

        [Parameter(Mandatory)]
        [long]$ExposedItemCount
    )

    $scoring = Get-FdPropertyValue -Object $Contract -Name "scoring"
    $anonymousPenalty = [math]::Min(
        [long](Get-FdPropertyValue $scoring "anonymousPermissionPenaltyCap"),
        $AnonymousPermissionCount * [long](Get-FdPropertyValue $scoring "anonymousPermissionPenalty")
    )
    $organizationPenalty = [math]::Min(
        [long](Get-FdPropertyValue $scoring "organizationPermissionPenaltyCap"),
        $OrganizationPermissionCount * [long](Get-FdPropertyValue $scoring "organizationPermissionPenalty")
    )
    $broadAccessSitePenalty = [math]::Min(
        [long](Get-FdPropertyValue $scoring "broadAccessSitePenaltyCap"),
        $BroadAccessSiteCount * [long](Get-FdPropertyValue $scoring "broadAccessSitePenalty")
    )
    $exposedItemPenalty = [math]::Min(
        [long](Get-FdPropertyValue $scoring "sharedItemPenaltyCap"),
        $ExposedItemCount * [long](Get-FdPropertyValue $scoring "sharedItemPenalty")
    )
    $raw = 100L - $anonymousPenalty - $organizationPenalty - $broadAccessSitePenalty - $exposedItemPenalty
    $minimum = [long](Get-FdPropertyValue $scoring "minimumScore")
    $maximum = [long](Get-FdPropertyValue $scoring "maximumScore")

    return [pscustomobject][ordered]@{
        raw       = $raw
        score     = [math]::Max($minimum, [math]::Min($maximum, $raw))
        saturated = $raw -lt $minimum -or $raw -gt $maximum
        penalties = [ordered]@{
            anonymousPermissions = $anonymousPenalty
            organizationPermissions = $organizationPenalty
            broadAccessSites     = $broadAccessSitePenalty
            sharedItems          = $exposedItemPenalty
        }
    }
}

function Get-FdDefaultLiveTestWorkspace {
    $localData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
    if ([string]::IsNullOrWhiteSpace($localData)) {
        $localData = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
    }
    if ([string]::IsNullOrWhiteSpace($localData)) {
        throw "Unable to resolve a user-local data directory for the live-test workspace."
    }

    return [System.IO.Path]::GetFullPath((Join-Path $localData "AI Flight Deck\live-test"))
}

function New-FdLockedLiveTestConfiguration {
    param(
        [Parameter(Mandatory)]
        [string]$AuthMode,

        [Parameter()]
        [AllowNull()]
        [string]$TenantId,

        [Parameter()]
        [AllowNull()]
        [string]$ClientId,

        [Parameter(Mandatory)]
        [int]$MaxSites,

        [Parameter(Mandatory)]
        [int]$MaxDrivesPerSite,

        [Parameter(Mandatory)]
        [int]$MaxItemsPerDrive,

        [Parameter(Mandatory)]
        [int]$MaxUsers,

        [Parameter(Mandatory)]
        [int]$MaxGroups,

        [Parameter(Mandatory)]
        [int]$MaxPermissionsPerSite,

        [Parameter(Mandatory)]
        [int]$MaxGraphRequests
    )

    return [ordered]@{
        authMode              = $AuthMode
        tenantId              = $TenantId
        clientId              = $ClientId
        maxSites              = $MaxSites
        maxDrivesPerSite      = $MaxDrivesPerSite
        maxItemsPerDrive      = $MaxItemsPerDrive
        maxUsers              = $MaxUsers
        maxGroups             = $MaxGroups
        maxPermissionsPerSite = $MaxPermissionsPerSite
        maxGraphRequests      = $MaxGraphRequests
    }
}

function New-FdLiveTestScanArguments {
    param(
        [Parameter(Mandatory)]
        [string]$OutputPath,

        [Parameter(Mandatory)]
        $Configuration,

        [Parameter()]
        [AllowNull()]
        [string]$CertificateThumbprint
    )

    $arguments = @{
        OutputPath            = $OutputPath
        AuthMode              = [string](Get-FdPropertyValue $Configuration "authMode")
        MaxSites              = [int](Get-FdPropertyValue $Configuration "maxSites")
        MaxDrivesPerSite      = [int](Get-FdPropertyValue $Configuration "maxDrivesPerSite")
        MaxItemsPerDrive      = [int](Get-FdPropertyValue $Configuration "maxItemsPerDrive")
        MaxUsers              = [int](Get-FdPropertyValue $Configuration "maxUsers")
        MaxGroups             = [int](Get-FdPropertyValue $Configuration "maxGroups")
        MaxPermissionsPerSite = [int](Get-FdPropertyValue $Configuration "maxPermissionsPerSite")
        MaxGraphRequests      = [int](Get-FdPropertyValue $Configuration "maxGraphRequests")
    }

    foreach ($name in @("tenantId", "clientId")) {
        $value = Get-FdPropertyValue -Object $Configuration -Name $name
        if (-not [string]::IsNullOrWhiteSpace([string]$value)) {
            $parameterName = if ($name -eq "tenantId") { "TenantId" } else { "ClientId" }
            $arguments[$parameterName] = [string]$value
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($CertificateThumbprint)) {
        $arguments["CertificateThumbprint"] = $CertificateThumbprint
    }
    elseif ($arguments.AuthMode -eq "Certificate") {
        throw "Certificate authentication requires CertificateThumbprint on each Baseline or Verification invocation. It is never persisted."
    }

    return $arguments
}

function Resolve-FdLiteralPath {
    param(
        [Parameter(Mandatory)]
        [string]$Path
    )

    $providerPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
    return [System.IO.Path]::GetFullPath($providerPath)
}

function Write-FdJsonFile {
    param(
        [Parameter(Mandatory)]
        $Value,

        [Parameter(Mandatory)]
        [string]$Path,

        [Parameter()]
        [int]$Depth = 32
    )

    $resolvedPath = Resolve-FdLiteralPath -Path $Path
    $directory = [System.IO.Path]::GetDirectoryName($resolvedPath)
    if ($directory -and -not [System.IO.Directory]::Exists($directory)) {
        [System.IO.Directory]::CreateDirectory($directory) | Out-Null
    }

    if ([System.IO.Directory]::Exists($resolvedPath)) {
        throw "Output path points to a directory: $resolvedPath"
    }

    $json = $Value | ConvertTo-Json -Depth $Depth
    [System.IO.File]::WriteAllText($resolvedPath, $json, [System.Text.UTF8Encoding]::new($false))
    return $resolvedPath
}

function Test-FdCompatibleSchema {
    param(
        [Parameter()]
        $Version
    )

    if ($Version -isnot [string] -or $Version -notmatch '^(\d+)\.(\d+)(?:\.\d+)?$') {
        return $false
    }

    return ([int]$Matches[1] -eq 1)
}
