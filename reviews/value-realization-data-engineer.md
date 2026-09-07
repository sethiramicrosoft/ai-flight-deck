# data-engineer review of value-realization

## Summary

AI Flight Deck's data model, provenance chain, and mission engine are already
correct: 77 controls always emit a normalized `ControlResult`, every result
carries `collectorRunId / tenantId / actorId / source`, envelopes are
HMAC‑sealed with a workspace key, missions read only `Pass` (or expiry‑bounded
`ApprovedNotApplicable`), and every unresolved gap becomes a first‑class
`Unknown` with a machine‑readable `limitations[].code`. The reason value
realization is stuck at *partial* is not the schema — it is that the shipped
scan flow only actually **runs one of the three evidence adapters** the code
was designed around. The Graph adapter runs; the `admin-command` adapter and
the `attestation-store.verify` path are wired to fail‑closed defaults that no
production code path ever populates. That single design choice — plus a fixed
`f542406…` upstream crosswalk and a 1:1 collector-to-domain ownership contract
that refuses to run a collector when one of its evidence keys is missing —
puts a hard ceiling at **22/77 controls fully automatable, ~44 partially
possible via imports/admin sessions, and 11 that will always be attested**.
Below I quantify the ceiling from the code, classify the 55 non‑Automated
controls into three realistic buckets, and give a concrete connector and
evidence‑completion architecture (schemas, APIs, artifacts, tests) that ships
without pretending any control is automatable that isn't.

Key metric (proved by counting `schema/readiness-catalog.v1.json`):

| Automation class | Controls | Requirement mix | What is required to make them evaluate |
|---|---|---|---|
| Automated (Graph‑only) | **22 / 77** (28.6 %) | 15 Gate, 7 Advisory | Delegated Graph scopes already requested by `server.js`; runs today. |
| Partial (needs one of: admin PS, tenant‑admin JSON export, Cloud Policy, Purview/Defender API, Power Platform API) | **44 / 77** (57.1 %) | 24 Gate, 20 Advisory | The `admin-command` / `powerPlatformClient` / `graphReportsClient` adapters — none of which the shipped `server.js` populates. |
| Attested (signed accountable evidence, no API exists) | **11 / 77** (14.3 %) | 2 Gate, 9 Advisory | A verified signed‑attestation store; `verifyAttestation` is never wired, so today attestations always resolve to `Unknown`. |

Activation gate needs 18 controls to Pass; 9 of them (50 %) currently live
outside the Graph‑only path. Safe‑pilot gate needs 39; **23 of them (59 %)**
depend on an adapter or file the product never writes. This is the exact set
Section 3 quantifies and Section 5 makes evaluable.

## Findings

### Critical — Attestation store is wired fail-closed in production; every attested control is permanently Unknown

- **Location:** `collector-adapters.js:85`, `estate-collector-suite.js:20`,
  `server.js:259`.
- **Issue:** `createAttestationStore(workspace, verifyAttestation = async () => false)`
  defaults `verify` to always return `false`. `buildEstateCollectors`
  forwards a `verifyAttestation` argument, and `collectEstate` accepts one —
  but `server.js`'s single call site (`await collectEstate({ rawToken,
  workspace, scan, signal })`) never passes it. Result: even if the operator
  drops a well-formed, signed `attestations.json` into the workspace, every
  record is filtered out at collection time
  (`operational-domains.js:889 — if (verified === true || verified?.valid ===
  true) validated.push(record);`) and every one of the 11 Attested controls,
  plus the 3 Attested Gate controls (`AFD-IAM-007`, `AFD-ADOPT-004`, and any
  approved-NotApplicable) collapses to `Unknown`. That single wiring omission
  makes the entire adoption/governance domain and the Assure mission
  permanently unreachable in the shipped product, no matter how much
  evidence the customer supplies. This is not a UX issue — the store's
  `verify` decision is the schema boundary between "signed accountable
  evidence" and "someone dropped a JSON file". Wiring it as a permanent
  `false` is worse than not wiring it, because it *looks* like an integration
  point but silently discards every input.
- **Patch:**

```js
// server.js — enrichEstateEvidence
const enriched = await collectEstate({
  rawToken,
  workspace,
  scan,
  signal,
  // Ed25519 detached signature over canonical JSON({controlId, statement,
  //   attestedBy, attestedAt, expiresAt, tenantId, cohortId, dataDigest}).
  // Trust roots live in <workspace>/attestation-keys/<keyId>.pub (Ed25519
  //   raw 32-byte, or COSE_Key JSON). Rotate by adding a new keyId; never
  //   overwrite an existing keyId file. `keyId` on the record MUST be a
  //   sibling to `signature` on every write — see Lesson R143 / Lesson
  //   R216-token-expires.
  verifyAttestation: buildAttestationVerifier({
    trustRoot: path.join(workspace, "attestation-keys"),
    algorithms: ["ed25519"],
    now: () => new Date()
  })
});
```

```js
// new module — attestation-verifier.js
const { createPublicKey, verify } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function canonical(value) { /* reuse canonicalStringify from evidence-integrity */ }

function buildAttestationVerifier({ trustRoot, algorithms, now }) {
  const keys = new Map();
  function loadKey(kid) {
    if (keys.has(kid)) return keys.get(kid);
    // reject path traversal — kid must match ^[A-Za-z0-9._-]{1,64}$
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(kid)) return null;
    const file = path.join(trustRoot, `${kid}.pub`);
    if (!fs.existsSync(file)) { keys.set(kid, null); return null; }
    const raw = fs.readFileSync(file);
    // Ed25519 raw 32-byte public key
    const key = createPublicKey({ key: Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"), raw
    ]), format: "der", type: "spki" });
    keys.set(kid, key);
    return key;
  }
  return async function verifyAttestation(record) {
    if (!algorithms.includes(record.signatureAlgorithm || "ed25519")) return false;
    if (Date.parse(record.expiresAt) <= now().getTime()) return false;
    const key = loadKey(record.keyId);
    if (!key) return false;
    const payload = Buffer.from(canonical({
      controlId: record.controlId,
      statement: record.statement,
      attestedBy: record.attestedBy,
      attestedAt: record.attestedAt,
      expiresAt: record.expiresAt,
      tenantId: record.tenantId,
      cohortId: record.cohortId,
      dataDigest: record.dataDigest    // sha256 of canonical(record.data)
    }), "utf8");
    const sig = Buffer.from(record.signature, "hex");
    return verify(null, payload, key, sig);   // Ed25519 detached
  };
}

module.exports = { buildAttestationVerifier };
```

Also: add `keyId`, `signatureAlgorithm`, and `dataDigest` as REQUIRED sibling
fields on the attestation record schema in the same PR, and reject unknown
`signatureAlgorithm` values at parse time — same class of trap as R216
(`token && expires`), and R240 (`ct` without `kid`). Never accept an
attestation whose `keyId` sibling is absent.

---

### Critical — 44 controls depend on `admin-command` / `powerPlatformClient` adapters that no shipped code path populates

- **Location:** `collector-adapters.js:38-64` (`createAdminCommandAdapter`,
  `createPowerPlatformClient`), `scanner/scan-tenant.ps1` (no
  `Connect-ExchangeOnline`, no `Connect-IPPSSession`, no `Connect-SPOService`,
  no `Connect-MicrosoftTeams`, no Power Platform BAP call), and the
  `.gitignore` entries at line 17–19 for `admin-evidence.json`,
  `power-platform-evidence.json`, `attestations.json`.
- **Issue:** The design contract is that `admin-evidence.json` supplies a
  keyed map (`"exchangeOnline:Get-EXOMailbox" → [rows]`), and
  `power-platform-evidence.json` supplies a keyed map (`environments → […]`).
  This is a fine contract, but nothing in the shipped product writes those
  files. The PowerShell scanner runs only `Invoke-MgGraphRequest`. The
  installer installs only `Microsoft.Graph.Authentication`. There is no
  documented `.\Collect-AdminEvidence.ps1` companion, no schema doc, and no
  test fixture for the file layout. The empirical result is deterministic
  and severe: every Exchange / SharePoint Advanced Management / Purview /
  Defender-portal control (23 of them) throws `COMMAND_UNAVAILABLE` and
  falls to `Unknown`; every Power Platform control (6 of them) throws
  `POWER_PLATFORM_AUTH_REQUIRED`. Safe-pilot mission gates on
  `AFD-EXO-002`, `AFD-SPO-002/003`, `AFD-PURV-003`, `AFD-SEC-002`, and all
  `AFD-PPA-*` and `AFD-COPILOT-*` — none of which can Pass in the shipped
  scan.

  This is the R143 provider-namespace lesson in a new costume: two write
  surfaces (Graph adapter, admin-file adapter) with two different
  freshness/produce contracts and no *documented cutover* between "we
  supplied a file" and "we didn't". Consumers (the collectors) already
  handle absence correctly (Unknown with limitation code), but the *producer
  side* is absent from the product, so the state machine is stuck.
- **Patch:** Ship the *producer* side as a first-class scanner phase, and
  make the JSON schema explicit so third parties (or a future controller
  service) can produce it. Concretely:

```powershell
# scanner/collect-admin-evidence.ps1  — new file, invoked as Phase = "AdminEvidence"
param(
  [Parameter(Mandatory)][string]$WorkspacePath,
  [ValidateSet("DeviceCode","Interactive")][string]$AuthMode = "DeviceCode",
  [string[]]$Workloads = @("exchangeOnline","sharePointOnline","purview","teams","powerPlatform")
)
$ErrorActionPreference = "Stop"
Import-Module ExchangeOnlineManagement -ErrorAction Stop
Import-Module Microsoft.Online.SharePoint.PowerShell -ErrorAction Stop
Import-Module MicrosoftTeams -ErrorAction Stop

$evidence = @{}
$errors   = @{}

function Add-Evidence($service,$command,$scriptBlock){
  $key = "${service}:${command}"
  try   { $evidence[$key] = & $scriptBlock | ConvertTo-Json -Depth 8 -AsArray -Compress | ConvertFrom-Json }
  catch { $errors[$key]   = @{ code = $_.FullyQualifiedErrorId; message = $_.Exception.Message } }
}

if ($Workloads -contains "exchangeOnline") {
  Connect-ExchangeOnline -Device:$($AuthMode -eq "DeviceCode") -ShowBanner:$false
  Add-Evidence exchangeOnline Get-EXOMailbox              { Get-EXOMailbox -ResultSize Unlimited `
      -Properties ExternalDirectoryObjectId,PrimarySmtpAddress,RecipientTypeDetails }
  Add-Evidence exchangeOnline Get-HybridConfiguration     { Get-HybridConfiguration }
  Add-Evidence exchangeOnline Get-OrganizationRelationship{ Get-OrganizationRelationship }
  Add-Evidence exchangeOnline Get-RemoteDomain            { Get-RemoteDomain }
  Add-Evidence exchangeOnline Get-EXOMailboxPermission    { Get-EXOMailboxPermission -ResultSize Unlimited }
  Add-Evidence exchangeOnline Get-EXORecipientPermission  { Get-EXORecipientPermission -ResultSize Unlimited }
  Add-Evidence exchangeOnline Get-TransportRule           { Get-TransportRule }
  Add-Evidence exchangeOnline Get-MessageTraceV2 {
      Get-MessageTraceV2 -StartDate (Get-Date).AddDays(-7) -EndDate (Get-Date) }
  Add-Evidence exchangeOnline Get-SafeLinksPolicy         { Get-SafeLinksPolicy }
  Add-Evidence exchangeOnline Get-SafeAttachmentPolicy    { Get-SafeAttachmentPolicy }
  Add-Evidence exchangeOnline Get-AntiPhishPolicy         { Get-AntiPhishPolicy }
  Disconnect-ExchangeOnline -Confirm:$false | Out-Null
}
# ... same for SPO, Purview (Connect-IPPSSession), Teams (Get-CsTeams*), Power Platform (BAP REST)

# Envelope: never overwrite silently — always write to admin-evidence.<timestamp>.json,
# then rename to admin-evidence.json with a File.Copy fallback so the collectors
# never observe a half-written file. Persist errors as a sibling doc so
# COMMAND_UNAVAILABLE reasons round-trip into the ControlResult.limitations[].
$doc = @{
  schema           = "ai-flight-deck/admin-evidence.v1"
  producerVersion  = "1.0.0"
  producedAt       = (Get-Date).ToUniversalTime().ToString("o")
  tenantId         = $global:TenantId
  actorId          = $global:ActorId
  authMode         = $AuthMode
  evidence         = $evidence
  errors           = $errors
}
$tmp = Join-Path $WorkspacePath "admin-evidence.$(New-Guid).json"
$doc | ConvertTo-Json -Depth 12 | Out-File -LiteralPath $tmp -Encoding utf8
Move-Item -LiteralPath $tmp -Destination (Join-Path $WorkspacePath "admin-evidence.json") -Force
```

And in `collector-adapters.js`, tighten the reader to treat the file as
schema‑versioned envelope with per-command error propagation (today it
blindly `JSON.parse`s a flat map; that has no forward-compat story):

```js
function createAdminCommandAdapter(workspace) {
  return async request => {
    const doc = readEvidenceFile(workspace, "admin-evidence.json");
    if (!doc)                       throw asCode("COMMAND_UNAVAILABLE",
      `No admin-evidence.json was produced. Run 'Collect admin evidence' for ${request.service}.`);
    if (doc.schema !== "ai-flight-deck/admin-evidence.v1")
      throw asCode("EVIDENCE_SCHEMA_UNSUPPORTED", `admin-evidence schema '${doc.schema}' is not supported.`);
    if (doc.tenantId && doc.tenantId !== request.tenantId)
      throw asCode("EVIDENCE_TENANT_MISMATCH", `admin-evidence.json belongs to ${doc.tenantId}.`);
    const key = `${request.service}:${request.command}`;
    if (doc.errors?.[key])
      throw asCode(doc.errors[key].code || "COMMAND_FAILED", doc.errors[key].message);
    if (!(key in (doc.evidence || {})))
      throw asCode("COMMAND_UNAVAILABLE",
        `No ${request.service} evidence for ${request.command} in admin-evidence.json.`);
    // Freshness contract — admin evidence older than the domain's freshnessHours
    // must surface as INCOMPLETE_EVIDENCE with a specific reason code, not as a
    // silent Pass on stale data.
    if (Date.now() - Date.parse(doc.producedAt) > request.freshnessHours * 3600e3)
      throw asCode("EVIDENCE_STALE",
        `admin-evidence.json is older than ${request.freshnessHours}h (producedAt=${doc.producedAt}).`);
    return doc.evidence[key];
  };
}
```

Rationale: the *reader* today knows nothing about the age of the file it is
consuming. That is exactly the R220 `customStats`/`_trackedStats` shape — two
persisted signals (Graph + admin file) with no rebuild rule and no
freshness envelope. Any control that Pass'd off yesterday's file after today's
Graph scan is silent evidence conflict, and the ControlResult would show a
current `observedAt` from Graph with a stale admin snapshot underneath.
Enforce freshness at read time so it becomes an `EVIDENCE_STALE` limitation
instead of a false Pass.

---

### Critical — Upstream assessment crosswalk pinned to a single commit; 6 of 8 known feature strings collapse everything into `AFD-PPA-001`

- **Location:** `upstream-evidence.js:190-232` (`ASSESSMENT_CROSSWALK`,
  `MICROSOFT_ASSESSMENT_PINNED_VERSION = "f542406ffba2066d943643de8d7a87b755b98cab"`).
- **Issue:** The crosswalk has **8 mapped feature strings**, of which 6 map
  to a single control (`AFD-PPA-001`). Any upstream commit other than
  `f542406…` sends every mapped row to `stagedRows` with
  `UNSUPPORTED_UPSTREAM_VERSION`, which never affects control results. Two
  compounding effects:
  1. Import evidence contributes to at most **3 distinct controls**
     (`AFD-PPA-001`, `AFD-SEC-005`, `AFD-COPILOT-003`) even in the happy
     case. The README claim that the assessment path "adds cohort-planning
     evidence" is not falsified by the code, but it is much smaller than
     "helps 77 controls" — the code allows a maximum of 3, and only when the
     customer happens to run the pinned commit.
  2. The pin lives in a JS constant, not in a versioned crosswalk table.
     When Microsoft ships a new upstream release, either the pin bumps and
     the *old* commit's fixtures now fail (silent regression for anyone
     lagging), or the pin stays and *new* fixtures fail. This is the
     R143 lesson again — silently changing a producer namespace without a
     `provider` sibling. Import evidence needs a per-*feature-shape*
     versioning story, not a single global commit pin.

  The row-format assumption is also brittle. `parseCsvDocument`
  hard-requires all six columns (`Service`, `Feature`, `Status`, `Priority`,
  `Observation`, `Recommendation`) and errors the whole file if any header
  is missing. That is defensible for schema safety but blocks partial
  adoption when Microsoft's next release adds/removes a column — the entire
  import fails rather than importing what it can.
- **Patch:**

```js
// upstream-evidence.js — replace the single pin with a versioned crosswalk
// keyed on the *upstream feature identity*, not on a commit hash.

const CROSSWALK_TABLE = [
  {
    upstreamRange: ["f542406ffba2066d943643de8d7a87b755b98cab", "e3aa1c…"],
    // one entry per canonical upstream featureId; upstream string is aliased.
    entries: {
      "power-platform.dlp.copilot-extensibility": {
        aliases: [
          "DLP Governance - Copilot Extensibility",
          "DLP Governance - BLOCKER: HTTP Connector"
        ],
        controlId: "AFD-PPA-001", status: "Fail", ...
      },
      // one entry per distinct control
    }
  }
];

// Fallback: any upstream commit whose hash is not in a range gets *softly*
// remapped: unknown Feature strings go to stagedRows with reasonCode
// UPSTREAM_VERSION_UNVERIFIED, but KNOWN featureIds (matched by canonical
// aliases seen in-range) still contribute Warning results — never Pass, never
// Fail. Fresh-until is capped to 24h to force a re-import against a verified
// crosswalk.
```

And record the *upstream row identity* (canonical featureId, not the alias
string) in the ControlResult provenance:

```js
provenance: {
  ...,
  source: "Microsoft automated readiness assessment CSV",
  sourceVersion: `${upstreamCommit}/${canonicalFeatureId}`,
  requestIds: [`csvRow:${row.rowNumber}`, `sha256:${sourceArtifact.sha256}`]
}
```

Rationale (R143 / R237): the `provider` sibling on every ID field is the
minimum viable defence against a silent producer change. Today `provenance.
sourceVersion` is a single string that mashes the collector version with the
upstream commit implicitly; a downstream drift analysis cannot compare rows
across upstream releases without reparsing the raw CSV.

---

### Critical — Every collector-runtime execution is **all-or-nothing per collector**; a single missing evidence key marks all controls in that domain Unknown

- **Location:** `collector-runtime.js:105-160`
  (`plan()` → `ready = missingPermissions.length===0 && missingLicenses.
  length===0 && discovered.available !== false`, and `#runOne` returning
  `status: "Unavailable"` with `controlResults: []` if the collector is
  not ready).
- **Issue:** The current per-collector "all controls or none" contract is
  fine for a Graph-only collector, but the `governance-domains` and
  `graph-domains` collectors have already worked around it by declaring
  `requiredPermissions: []` and `requiredLicenses: []` on the collector
  itself and evaluating each control's evidence independently (`normalize`
  emits `Unknown` per-control). That workaround silently defeats the
  `plan()` capability display: the UI cannot preview *which specific
  controls will be Unknown for permission reasons* without executing the
  run. Missing permissions and missing licences are known at plan-time,
  per control, from the catalog, but the orchestrator throws that
  information away.

  Concretely: the pre-scan capability preview cannot answer "will
  `AFD-PURV-004` return an evaluated result if I sign in as Global Reader
  + Compliance Administrator?", which is the exact question the value
  realization is asking. The information exists — `catalog.domains[].
  controls[].requiredPermissions` and `requiredLicenses` — but nothing
  computes the per-control readiness plan.
- **Patch:** Add a *control-level* plan pass alongside the collector-level
  plan pass, so the UI can render "Ready / Missing permission / Missing
  licence / Missing adapter" per control before the scan runs. This does
  not change what the collector returns; it exposes the same limitations
  earlier.

```js
// collector-runtime.js — add controlPlan() beside plan()
async controlPlan({ grantedPermissions = [], availableLicenses = [], adapters = {} } = {}) {
  const permissions = new Set(uniqueStrings(grantedPermissions, "grantedPermissions"));
  const licenses    = new Set(uniqueStrings(availableLicenses, "availableLicenses"));
  const out = [];
  for (const collector of this.list()) {
    for (const controlId of collector.controlIds) {
      const control = catalog.domains.flatMap(d => d.controls).find(c => c.id === controlId);
      const missingP = (control.requiredPermissions || []).filter(p => !permissions.has(p));
      const missingL = (control.requiredLicenses    || []).filter(l => !licenses.has(l));
      const requiredAdapter =
        control.evidenceSources.some(s => /^Get-|Search-/.test(s))   ? "adminCommand" :
        control.evidenceSources.some(s => /Power Platform/.test(s))  ? "powerPlatform" :
        control.evidenceSources.some(s => /attestation/i.test(s))    ? "attestationStore" :
        "graph";
      const adapterReady = adapters[requiredAdapter] === true;
      out.push({
        controlId, collectorId: collector.id, domainId: control.domainId ?? null,
        requirement: control.requirement, automation: control.automation,
        missingPermissions: missingP,
        missingLicenses: missingL,
        requiredAdapter, adapterReady,
        readiness: (!missingP.length && !missingL.length && adapterReady)
          ? "Ready"
          : missingP.length ? "MissingPermission"
          : missingL.length ? "MissingLicense"
          : "MissingAdapter"
      });
    }
  }
  return out;
}
```

Then wire the Set-Up page to call `/api/plan/controls` and render a
per-control forecast: this is exactly the "why is this Unknown" question
value realization is asking, and it costs zero additional Graph reads.

---

### Critical — `NotApplicable` schema allows `expiresAt: null` and `approvedBy: null`; mission engine treats a permanent‑null NotApplicable as "satisfied"

- **Location:** `mission-engine.js:12-16` (`approvedNotApplicable`) and
  `schema/control-result.schema.v1.json` `applicability.expiresAt` /
  `applicability.approvedBy` both allow `null`.
- **Issue:** `approvedNotApplicable` reads: `if (!result.applicability.
  expiresAt) return true;` — i.e. **a missing `expiresAt` is treated as a
  never-expiring approval**. Combined with `applicability.approvedBy`
  being nullable in the schema, a `NotApplicable` result with `{ applies:
  false, approvedBy: null, expiresAt: null }` is currently a permanent
  free‑pass on any Gate control, indistinguishable from an approved
  exemption. Two collectors do enforce sanity locally
  (`operational-domains.js:validateControlResult` and `governance-domains.
  js:approvedNotApplicable`) but the mission engine trusts the schema, and
  the schema is loose. This is R216 (`token && (!expires || expires >
  now)`) applied to `NotApplicable`: any pipeline producing a partial
  write becomes an eternal exemption.
- **Patch:** Tighten the schema *and* the mission engine on the same PR,
  and add a JSON Schema constraint that ties the three fields together at
  the boundary:

```jsonc
// schema/control-result.schema.v1.json — applicability
"applicability": {
  "oneOf": [
    { "properties": { "applies": { "const": true } },
      "required": ["applies","reason"], "additionalProperties": false,
      "properties": { "applies": {"type":"boolean"}, "reason": {"type":"string"} } },
    { "properties": { "applies": { "const": false } },
      "required": ["applies","reason","approvedBy","expiresAt"],
      "properties": {
        "applies":     {"type":"boolean"},
        "reason":      {"type":"string","minLength":1},
        "approvedBy":  {"type":"string","minLength":1},
        "expiresAt":   {"type":"string","format":"date-time"}
      } }
  ]
}
```

```js
// mission-engine.js
function approvedNotApplicable(result, now) {
  if (result.status !== "NotApplicable" || result.applicability?.applies !== false) return false;
  const approvedBy = String(result.applicability.approvedBy || "").trim();
  const expiresAt  = Date.parse(result.applicability.expiresAt);
  return Boolean(approvedBy)
      && Number.isFinite(expiresAt)
      && expiresAt > now.getTime();
}
```

Add a mission-engine regression test that seeds a
`{applies:false, approvedBy:null, expiresAt:null}` result and asserts the
mission is `Blocked`, not `Eligible`. Today no such test exists.

---

### High — `provenance.tenantId` is `format: uuid` but the licensing collector uses `context.tenantId` as-is; a non-UUID tenant ID silently corrupts every ControlResult against the schema

- **Location:** `schema/control-result.schema.v1.json` provenance.tenantId
  (`format: uuid`), used in `collectors/licensing.js:34`, `collectors/
  graph-domains.js:141`, `collectors/governance-domains.js:161` etc.
- **Issue:** The schema declares `format: uuid`, but the runtime accepts
  any string via `context.tenantId`. If a caller passes a display name or
  a `tenant.onmicrosoft.com` value (or the test-tenant flow injects a
  string identifier), every emitted ControlResult *silently* violates the
  JSON Schema. Because the product does not schema‑validate on emit (only
  `operational-domains.validateControlResult` does structural checks, not
  regex), the violation surfaces later at a downstream verifier (e.g.
  `verifyEvidenceEnvelope` if it round-trips through JSON schema) or a
  cross-org Purview/Defender export pipeline that assumes UUID.
- **Patch:** Validate at ingress in `runEstateCollectors` and reject any
  non-UUID tenantId with a specific error code — do not let the collectors
  emit unvalidated data. If display names must be supported, add a
  `tenantDisplayName` sibling and keep `tenantId` UUID-only. Same rule
  as R240 — `keyId` sibling to the ciphertext; every ID field gets a
  namespace sibling so downstream tools can branch:

```js
// collector-orchestrator.js — validate context up front
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (typeof options.context?.tenantId !== "string" || !UUID_RE.test(options.context.tenantId)) {
  throw new TypeError("context.tenantId must be a Microsoft Entra tenant UUID.");
}
```

---

### High — Provenance loses request IDs; the schema declares `requestIds[]` but every emitter passes `[]`, so replay-vs-live disputes are unresolvable

- **Location:** `collectors/licensing.js:56` (`requestIds: []`),
  `collectors/graph-domains.js:151` (`requestIds: []`), same in
  governance‑domains and operational‑domains. Graph responses in
  `readGraph` do not thread `request-id` or `client-request-id` headers
  through; they are dropped on the floor.
- **Issue:** The `provenance.requestIds` field exists precisely so a "the
  two views disagree" dispute (or a Microsoft support ticket about a
  specific Graph read) can be resolved by pointing at the exact Graph
  request. The producer never populates it, so the field is decorative.
  This is the R230 audit-fingerprint lesson: an audit event without the
  fingerprint of the state it captured cannot answer the question it
  exists to answer. Under a lawful/compliance review of a
  `SharingControlsVerified` decision, the ControlResult can point at an
  evidence envelope, but cannot point at any specific Microsoft request
  that produced the underlying value.
- **Patch:** Thread `x-ms-client-request-id` (generated per request,
  logged) *and* `request-id` (from response header) through
  `graphRequest` and `readGraph`, into every `evidenceItems` shape, and
  through `normalize()` into `provenance.requestIds`. Cap at 1000 (the
  schema already does). Add a regression test that runs a fixture with a
  fake `fetch` returning a specific `request-id` header and asserts it
  appears in the emitted ControlResult.

```js
// collector-adapters.js — thread request IDs
function graphRequest(rawToken) {
  return async request => {
    const clientRequestId = crypto.randomUUID();
    const response = await fetch(request.url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${rawToken}`,
        "client-request-id": clientRequestId
      },
      signal: request.signal
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(body?.error?.message || `Microsoft Graph returned ${response.status}.`);
      error.code = body?.error?.code || String(response.status);
      throw error;
    }
    // stamp the id pair onto the response so readGraph can hand it to normalize()
    Object.defineProperty(body, "__requestIds", {
      value: { clientRequestId, serverRequestId: response.headers.get("request-id") || null },
      enumerable: false
    });
    return body;
  };
}
```

---

### High — Freshness is a per-domain constant; no cohort-scoped freshness, no per-source freshness for imports

- **Location:** `readiness-catalog.v1.json` — 50 controls at 168h, 20 at
  24h, 6 at 720h, 1 at 4h. `collectors/*.js` compute
  `freshUntil = Date.parse(observedAt) + freshnessHours*3600000`.
- **Issue:** The catalog treats freshness as a *global property of the
  control*, not a property of the *evidence source*. Two concrete
  consequences:
  1. `AFD-DEV-001` (client channel/build) has a 168h catalog freshness,
     but the **Microsoft 365 admin center readiness CSV has a documented
     72h reporting latency** (see `upstream-evidence.js:170 —
     `maximumLatencyHours: 72``) and a 28-day activity window. An imported
     result is currently timestamped at the *report as-of date* and given
     168h of freshness — an imported result can be "fresh" for a week
     after the *report* was already three days behind. That's ~10 days of
     effective staleness against a fresh Graph scan, and nothing surfaces
     it in the mission engine.
  2. Adoption controls (`AFD-ADOPT-005`) have a 168h freshness on a
     graph-reports source (`getMicrosoft365CopilotUsageUserDetail`), but
     Microsoft ships that report with a documented reporting-latency of
     ~48h and its cohort-scoped rows only refresh on the `D7`/`D30`
     boundary. The current model conflates report freshness with
     evidence freshness.
- **Patch:** Move freshness to a *source* attribute, not a *control*
  attribute. Introduce an `evidenceSourceCatalog` keyed by source id, and
  compute `freshUntil = observedAt + max(sourceLatency) + freshnessBudget`:

```jsonc
// schema/evidence-source-catalog.v1.json — new file
{
  "sources": {
    "microsoft-graph:policies/conditionalAccessPolicies": {
      "kind": "graph", "latencyHours": 0.1, "budgetHours": 24
    },
    "microsoft-graph:reports/getMicrosoft365CopilotUsageUserDetail": {
      "kind": "graph-report", "latencyHours": 48, "budgetHours": 120
    },
    "microsoft-365-admin-center:copilot-readiness-csv": {
      "kind": "import", "latencyHours": 72, "activityWindowDays": 28, "budgetHours": 96
    },
    "sharepoint-advanced-management:site-access-report": {
      "kind": "admin-command", "latencyHours": 24, "budgetHours": 144
    }
    // ... 60+ entries
  }
}
```

```js
// collectors/*.js — controlResult()
freshUntil: new Date(
  Date.parse(observedAt) +
  (source.latencyHours + source.budgetHours) * 3600000
).toISOString(),
observedValue: {
  ...,
  freshness: {
    sourceObservedAt: sourceObservedAt || observedAt,
    latencyHours: source.latencyHours,
    budgetHours: source.budgetHours
  }
}
```

Also: distinguish *cohort-scoped* freshness from *tenant-scoped*
freshness — a control that was fresh for cohort A yesterday is not
necessarily fresh for cohort B today (e.g. cohort membership change).
Today `instanceId = tenant:cohort:control` guarantees a fresh emission
per cohort, but freshness *duration* does not encode "how long is the
cohort binding valid" — add a `cohortBoundAt` sibling on the coverage
object.

---

### High — Every evidence envelope is HMAC-signed with a workspace-local 32-byte key; no `kid`, no rotation, no verification if the workspace changes

- **Location:** `evidence-integrity.js` (`createEvidenceEnvelope`,
  `verifyEvidenceEnvelope`), and `server.js` writes the workspace key at
  install time and does not rotate.
- **Issue:** The envelope is `HMAC-SHA256` under a symmetric workspace
  key. If the workspace directory is copied to another machine (Support
  escalation, IR analyst review, cross-tenant migration), the key comes
  with it and cross-tenant repudiation becomes impossible — the same key
  signs artifacts belonging to any tenant the workspace ever scanned.
  There is no `keyId` sibling in the envelope. This is R240 (ct without
  `_kid` = migration never happens) at the workspace-artifact layer.
- **Patch:** Add `keyId` to the envelope schema, key the HMAC by
  `{tenantId, keyId}` so a workspace serving multiple tenants uses
  distinct keys, and store keys in `<workspace>/keys/<keyId>.bin` with a
  documented rotation command `Rotate-FlightDeckKey` that (a) generates
  a new keyId, (b) re-signs *only* envelopes newer than N days
  (accepting that older ones must be resigned lazily on next read), and
  (c) records the rotation in an append-only KEYLOG. Enforce in
  `verifyEvidenceEnvelope` that a missing `keyId` fails validation — do
  not fall through to a default key. Same fix pattern as R216.

---

### High — Collector-orchestrator throws on `NO_OPERATIONAL_COLLECTOR` for any registered control without an owner, but the *user* has no way to see missing coverage before scan

- **Location:** `collector-orchestrator.js:69-88` (`validateCoverage`
  throws on the first missing control) and `mission-engine.js` never
  learns which controls are structurally uncollectable.
- **Issue:** A partial estate deployment — e.g. a tenant using AI Flight
  Deck only for identity + Copilot posture — must still register a
  collector for every one of the 77 controls, or the entire run fails at
  `runEstateCollectors`. The system is either 77-of-77 or 0-of-77, with
  no graceful "we skipped these on purpose" mode. That is fine for a
  hackathon prototype but wrong for value realization; the customer
  cannot exercise the safe-pilot mission for identity+Copilot alone
  without paying the "attest to Purview premium" tax.
- **Patch:** Accept a `scope.explicitOutOfScopeControls: string[]`
  parameter to `runEstateCollectors`. For each entry, emit a synthesized
  `NotApplicable` result with `{ applies: false, approvedBy:
  scope.scopeOwner, expiresAt: scope.scopeExpiresAt, reason: "Excluded
  from this readiness scope by <owner>" }` and record it as
  `provenance.source: "scope-exclusion"`. Downstream schemas already
  enforce all four fields (see the earlier `applicability` `oneOf`).
  Mission engine already gates on `approvedNotApplicable` correctly once
  the schema tightening lands. Never let a scope exclusion become a
  permanent free pass — enforce a maximum `expiresAt` of 90 days at
  ingest.

---

### High — Cohort binding is a plain-text `principalIds[]` on every ControlResult; renaming a cohort re-emits every result but the mission engine has no re-key path

- **Location:** `estate-collector-suite.js:210-232`
  (`resolveConfiguredCohort`, `scan.estateAssessment.cohorts = [cohort]`)
  and `controlResult.instanceId = tenant:cohort:control`.
- **Issue:** `instanceId` uses `cohort.id` as the natural join key.
  Cohort rename (`cohort.id` changed) invalidates every persisted
  ControlResult *silently*. There is no cohort-supersession chain, no
  `previousCohortId`, no way for the mission engine to say "these
  results were for cohort‑v1; you have not evaluated cohort‑v2". Today,
  renaming a cohort just makes every existing ControlResult drop out of
  the mission-gate join, and mission renders as `Blocked` on all 39
  controls because none of them match by cohort id. That is technically
  correct behaviour, but it is silent-corruption-flavoured — the user
  thinks they lost their scan.
- **Patch:** Ship a bounded cohort supersession history on the cohort
  document (`$slice: -20`) and let `evaluateMissions` fall through
  `previousCohortId` chains when a fresh result is missing:

```json
{
  "id": "copilot-pilot-v2",
  "previousCohortId": "copilot-pilot-v1",
  "supersededAt": "2026-09-01T00:00:00.000Z",
  "supersessionReason": "renamed by Sudhakar",
  "history": [
    { "id": "copilot-pilot-v1", "principalIdsDigest": "sha256:…",
      "principalIds": ["upn1","upn2"], "supersededAt": "…" }
  ]
}
```

Same shape as the R230 supersession pattern for recovery links. Bound
the array. Never trust more than one hop for mission evaluation — after
one supersession, force a fresh scan.

---

### Medium — 3 sensitivity levels + 5 statuses is under-modelled for confidence-weighted mission decisions

- **Location:** `evidence-graph.js` `SENSITIVITY` set (`public|internal|
  confidential|highly-confidential`, 4 values) and `readiness-catalog.v1.
  json` statuses (`Pass|Fail|Warning|Unknown|NotApplicable`).
- **Issue:** The evidence-graph simulator computes `confidence = base *
  completeness` where `base = avg(node.attributes.confidence ?? 1)` and
  `completeness = relevant / (relevant + missing)`. It emits one of
  three levels (`High >= 0.85`, `Medium >= 0.6`, `Low`). But
  `ControlResult.confidence` is a per-control float and mission engine
  *ignores it* — a `Pass` at 0.15 confidence is treated identically to a
  `Pass` at 1.0. That is fine as a strict-gate stance, but it removes
  the entire point of computing confidence on ControlResults. Either
  (a) delete `confidence` from the ControlResult schema so we stop
  pretending it matters, or (b) surface a per-mission
  "aggregate-confidence" alongside the strict gate. Do not silently
  compute a value nobody consumes.
- **Patch:** Two-line change in `mission-engine.evaluateMissions`:

```js
const satisfiedControls = controls.length - blockers.length;
const aggregateConfidence = controls
  .filter(c => c.satisfied)
  .reduce((sum, c) => sum + (cohortResults.get(c.controlId)?.confidence ?? 0), 0)
  / Math.max(1, controls.length);
return {
  missionId: mission.id, missionOrder: mission.order, cohortId: cohort.id,
  status, satisfied, evaluatedAt: now.toISOString(),
  requiredControls: controls.length, satisfiedControls,
  aggregateConfidence: Number(aggregateConfidence.toFixed(3)),
  blockers
};
```

And decide, at product-owner level, whether a `Pass` control below a
minimum confidence should demote the mission to `Warning`. Either
outcome is defensible; silently ignoring confidence is not.

---

### Medium — Domain executions are wired to run concurrently at `maxConcurrency: 4`, but every collector shares the same `graphRequest` and hits a per-tenant Graph 429 budget

- **Location:** `estate-collector-suite.js:243`, `collector-runtime.js:132`.
- **Issue:** Six collectors call `graphRequest` concurrently against the
  same tenant; each collector has its own request budget (200–500), so
  the *fleet* budget is 3000+ per scan. Microsoft Graph delegated calls
  are throttled per-tenant; the retry code path in
  `collector-adapters.graphRequest` does not honour `Retry-After`
  headers (there is no retry in that function at all), and the higher-
  level orchestrator has no cross-collector budget. Under a real tenant
  scan the identity collector will burn budget the copilot collector
  needs, and one of them will emit `Unknown` on transient 429 instead of
  succeeding a moment later.
- **Patch:** Introduce a **tenant-scoped** RequestBudget shared across
  all collectors (already partially implemented per-collector; move it
  up), honour `Retry-After` with `AbortController`-aware waits, and cap
  concurrent Graph calls to `Math.min(collectorConcurrency, 2)` per
  tenant for `beta` endpoints (which are documented to be more
  aggressively throttled). Same as R143's "idempotency key on the
  outbound POST" — a `client-request-id` on retries lets Graph coalesce
  duplicate reads. Retain the per-collector budget as an *upper cap* to
  stop a broken collector from starving the fleet.

---

### Medium — Import CSV parser is strict-columns-required, so any Microsoft header addition breaks the entire import path

- **Location:** `upstream-evidence.js:70-73` (`if (values.length !==
  headers.length)`) and `requireColumns` (all six mandatory).
- **Issue:** Microsoft's admin-center CSV has changed column set at
  least twice in the last year (renamed `Copilot license assigned`).
  The parser already handles aliases, but any *new* column shifts field
  count and throws `row X has N fields; expected M`. A defensive
  producer would allow *extra* columns and merely warn.
- **Patch:** Allow extra columns; require only that all *named* columns
  resolve. Record `sourceArtifact.unknownColumns` so the next collector
  release can add crosswalk entries without waiting on Microsoft to
  stabilise the CSV.

---

### Medium — `readGraph.truncated=true` folds into `result.complete = !observations.X.truncated`, but the mission engine sees the same status; a scan that hit `MAX_ITEMS=1000` still resolves to `Pass` at coverage.complete=false

- **Location:** `collectors/graph-domains.js` many sites, e.g. `L262
  complete: !observations.signIns.truncated`, and `mission-engine.js`
  which reads `result.status` only.
- **Issue:** `coverage.complete=false` is *not* an escalation to
  `Unknown`. A large tenant with >1000 signIns in the last 7 days emits
  a `Pass` on `AFD-IAM-002` with the top-1000 rows; the missing rows
  might contain the exact successful legacy sign-in the control is
  designed to catch. The producer flags the truncation faithfully; the
  consumer (mission engine) ignores it.
- **Patch:** Add to the mission engine's `evaluateControl`:

```js
if (SATISFIED.has(result.status) && result.coverage?.complete === false) {
  return { satisfied: false, reason: "IncompleteCoverage", status: result.status };
}
```

And require every collector-level `truncated=true` to emit a
`COLLECTION_BOUND_REACHED` limitation entry (governance-domains already
does; graph-domains does not). Do not let a bounded sample masquerade
as a Pass.

---

### Medium — `admin-command` adapter passes `request.parameters` and `request.freshnessHours` to the reader, but the reader ignores parameters, so two callers with different `StartDate` collide on the same evidence key

- **Location:** `collector-adapters.js:38-52` and every `command("key",
  "purview", "Search-UnifiedAuditLog", { StartDate: … })` invocation.
- **Issue:** The evidence key is `service:command`, not `service:command:
  argsDigest`. Any two collectors requesting the same command with
  different parameters get the same evidence — first writer wins, second
  reader consumes stale/wrong-window data. Today only one caller per
  command, but the moment two Purview features need
  `Search-UnifiedAuditLog` over different windows (e.g. Copilot chat vs
  labels applied), the second silently reads the first's window.
- **Patch:** Key evidence by `service:command:sha256(canonical(params))`.
  Change `Collect-AdminEvidence.ps1` to write that key. Update
  `createAdminCommandAdapter` to compute the same digest at read time.
  Backwards-compatible: fall back to `service:command` when only one
  entry matches.

---

### Low — Documentation says "77 controls" and "13 collectors", but there are 7 collector modules and 4 collectors per governance-domain module; wording is imprecise

- **Location:** README.md line 13 ("13 independently governed systems"),
  `collector-definitions.js` (declares 13 collector *definitions*, one
  per domain), `estate-collector-suite.js:22-36` (registers 7 collector
  *runtimes*: licensing + 5 graph + 4 governance + 3 operational).
- **Issue:** "13 collectors" is the *catalog abstraction* (one per
  domain), not the runtime count (13 runtime entries built from 7
  modules). This is not a bug — but if the "13" number is used in
  marketing to imply 13 independent processes, it will drift from
  reality the moment we merge or split a collector module. Attach a
  test that asserts `runEstateCollectors` runs exactly 13 collector
  entries and each domain has exactly one owner.
- **Patch:**

```js
// collector-orchestrator.test.js
test("estate collectors register exactly one owner per domain", () => {
  const collectors = buildEstateCollectors(fixtures);
  const owners = new Map();
  for (const c of collectors) for (const id of c.controlIds)
    owners.set(id, (owners.get(id) || 0) + 1);
  assert.equal(owners.size, 77);
  for (const [id, count] of owners) assert.equal(count, 1, `${id} owned by ${count} collectors`);
});
```

---

## Realistic evidence-completion architecture (recommendation, not a design commitment)

Bucket the 55 non-Automated controls:

- **Automatically collectible with a shipped admin-evidence producer (Bucket A: 33 controls).** Requires shipping `scanner/collect-admin-evidence.ps1` (Finding 2), which uses `ExchangeOnlineManagement`, `Microsoft.Online.SharePoint.PowerShell`, `MicrosoftTeams`, the `IPPSSession` for Purview cmdlets, and BAP REST for Power Platform. Every one of these controls has a documented cmdlet; the reader is already built. Value realization step 1: this bucket moves 33 controls from **Unknown** to **evaluable** (Pass / Fail / Warning based on data). Expected pass-yield in a Microsoft-first tenant: 55–70 %.
- **Importable, verified crosswalk (Bucket B: 6 controls).** These are controls already covered by Microsoft's automated readiness assessment CSV or the M365 admin center readiness CSV, once the crosswalk versioning fix (Finding 3) allows adding entries without a code release. Ship the crosswalk as `schema/upstream-crosswalk.v1.json` and let customers roll forward without pinning a commit.
- **Attested (Bucket C: 11 controls, permanent).** Named business owner, signed statement, verifiable public key. Ship a `signed-attestation` CLI (`node scripts/sign-attestation.js --control AFD-ADOPT-001 --data ./use-cases.json --key-id ops-2026-q3.priv`) that produces the exact record `operational-domains.validateSignedAttestation` expects. Wire `verifyAttestation` in `server.js` (Finding 1). These controls become evaluable once the customer supplies a signature; they cannot be automated by any Graph or admin API. Do not pretend otherwise.
- **Scope-excluded (Bucket D: 0–15 controls at customer choice).** Explicit out-of-scope with a documented owner and expiry (Finding 8). Never a permanent free-pass.

Net effect on Safe-pilot mission (39 required controls):

| Bucket | Controls in mission | Status today | Status after this architecture |
|---|---|---|---|
| Graph-only (already works) | 16 | Evaluable | Evaluable |
| Bucket A (admin-evidence) | 15 | Unknown (`COMMAND_UNAVAILABLE`) | Evaluable |
| Bucket B (import) | 2 | Unknown (`MISSING_SOURCE_TIMESTAMP` / commit unpinned) | Evaluable |
| Bucket C (attestation) | 3 | Unknown (`SIGNED_ATTESTATION_MISSING`, permanently) | Evaluable when signed |
| Bucket D (scope) | 3 optional | N/A | `NotApplicable` (approved) |

That takes safe-pilot from 16/39 evaluable (41 %) to 39/39 evaluable
(100 %) — with **honest evaluability**, not automation. The mission
outcome (Pass/Fail) depends on the tenant's actual posture; the change
is that we stop returning `Unknown` for evidence we *could* produce.

## Prioritization (do these in order; each one unblocks the next)

1. **Fix Findings 1, 4, and 5 in one PR.** These are the schema-level fail-open cases. All three are lower than a hundred lines of code together and each has a regression-test-first path. Ship them behind a `schemaVersion: 1.1` bump so consumers can gate.
2. **Ship `scanner/collect-admin-evidence.ps1` and the `admin-evidence.v1` envelope reader** (Finding 2). This is the single biggest lever — 44 controls become evaluable.
3. **Version the upstream crosswalk** (Finding 3). Ship `schema/upstream-crosswalk.v1.json` and a per-featureId fallback path.
4. **Add control-level `plan()`** (Finding 4 second half). This is UX-critical because it lets customers *see* which controls will Pass without running the scan.
5. **Move freshness to a per-source catalog** (Finding 6). Blocks silent staleness on imports.
6. **Envelope key rotation and per-tenant HMAC keys** (Finding 7). Blocks cross-tenant repudiation.

Tests to require in the same PR set:

- **Regression: schema-tightening.** Seed a `NotApplicable` result with `{approvedBy:null, expiresAt:null}` → mission Blocked. Seed one with `{approvedBy:'x', expiresAt:'past'}` → mission Blocked. Seed one with `{approvedBy:'x', expiresAt:'+1y'}` → mission Eligible.
- **Regression: attestation verifier.** Seed a valid Ed25519-signed attestation → `verified=true`. Flip one byte of the signature → false. Change `keyId` to a missing kid → false. Set `expiresAt` in the past → false.
- **Regression: admin-evidence envelope.** Missing file → `COMMAND_UNAVAILABLE`. Wrong schema string → `EVIDENCE_SCHEMA_UNSUPPORTED`. Wrong tenant → `EVIDENCE_TENANT_MISMATCH`. `producedAt > freshnessHours` old → `EVIDENCE_STALE`. Every one of these must return a specific limitation code, not a generic failure.
- **Regression: upstream crosswalk fallback.** A CSV from an unpinned commit whose featureId matches a known canonical entry → contributes `Warning`, never `Pass`, capped at 24h freshness.
- **Regression: control-level plan.** With `Directory.Read.All` and `Organization.Read.All` granted, `AFD-LIC-001..005` are `Ready`; without `AuditLog.Read.All`, `AFD-PURV-004` is `MissingPermission`.
- **Regression: mission-engine confidence.** Two seeded `Pass` results with `coverage.complete=false` and one with `complete=true` — the two truncated ones flip mission to `Blocked` with reason `IncompleteCoverage`.
- **Regression: cohort supersession.** Rename a cohort and assert the mission engine evaluates the historical results against `previousCohortId` for one hop but not two.

## Lessons (appended to persona file)

- 2026-09-07 ai-flight-deck-value-realization — Adapter-per-source designs die at the seam where the reader is shipped but the *producer* isn't. Flight Deck's `admin-command` and `attestation-store` adapters have specific error codes (`COMMAND_UNAVAILABLE`, `POWER_PLATFORM_AUTH_REQUIRED`), well-defined JSON contracts, and behaved-correctly readers, but the shipping product had zero producer paths — no `Collect-AdminEvidence.ps1`, no `verifyAttestation` wired at the call site (defaults `async () => false`), no `sign-attestation` CLI. From now on, on any "read this adapter for evidence" contract: (1) the same PR ships the producer or a stub producer that emits an empty envelope with a specific `PRODUCER_NOT_INSTALLED` reason code — a hardcoded `() => false` default is worse than a missing implementation because it silently discards well-formed input; (2) reject any PR that adds a reader keyed on a workspace file without adding a documented producer command in the same release, plus a test that end-to-ends producer → reader with a real fixture; (3) any place a `verify` predicate defaults to `false`, wrap the default in a factory that throws `NOT_WIRED` on first call unless explicitly opted in with `{ allowFailClosed: true }` — the caller must acknowledge the trap.
