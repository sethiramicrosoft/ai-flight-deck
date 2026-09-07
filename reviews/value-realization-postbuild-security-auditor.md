# security-auditor review of value-realization-postbuild

## Summary
I reviewed all uncommitted value-realization changes against HEAD, with emphasis on `server.js`, `attestation-evidence.js`, `evidence-integrity.js`, `collector-adapters.js`, `estate-collector-suite.js`, `scanner/collect-admin-evidence.ps1`, `evidence-completion.js`, `index.html`, schemas, tests, and README. The new evidence-import and attestation features materially improve structure, but three decision-integrity flaws and one local-API trust-boundary flaw allow forged or stale evidence to influence `Pass`/`READY` outcomes. Findings below are high-confidence and exploitable in the current local-service model.

## Findings
### Critical — Local write APIs trust a static header and allow requests with no `Origin`
- **Location:** `server.js:493-498`, `server.js:586-589`, `server.js:635-637`, `server.js:728-730`, `server.js:787-789`, `server.js:808-810`, `server.js:825-827`, `server.js:836-838`
- **Confidence:** High
- **Issue:** State-changing endpoints (`/api/evidence-packages`, `/api/attestations`, `/api/cohorts`, `/api/jobs`, etc.) are authorized by a fixed header (`x-flight-deck: local-ui`) and `sameOrigin()` explicitly allows requests with **no** Origin header. Any local process can forge this header and mutate evidence/attestations without user interaction. I reproduced this: a no-Origin request returned 200, while an evil Origin returned 403.
- **Patch:**
```js
// server.js (concept)
const apiNonce = crypto.randomBytes(32).toString("base64url");

function assertTrustedUiRequest(req) {
  const origin = req.headers.origin;
  if (origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) {
    throw new Error("Trusted local origin required.");
  }
  if (req.headers["x-flight-deck-nonce"] !== apiNonce) {
    throw new Error("Invalid local session proof.");
  }
}

// Call assertTrustedUiRequest(req) for every POST/DELETE route.
// Do not accept missing Origin for mutating routes.
```

### Critical — Evidence package sealing does not verify producer provenance, enabling forged `Pass` evidence
- **Location:** `server.js:591-607`, `server.js:608-616`, `collector-adapters.js:46-83`, `collectors/governance-domains.js:348-366`, `collectors/operational-domains.js:514-516`
- **Confidence:** High
- **Issue:** `/api/evidence-packages` accepts arbitrary JSON, validates only schema/version/tenant/timestamp shape, then immediately seals it as `integrityVerified: true` with local HMAC. That HMAC proves only “this service stored this JSON,” not “this JSON came from an authenticated workload collector.” The normalizers then treat imported arrays as authoritative and can emit `Pass` (e.g., `AFD-PPA-001` at lines 514-516). I reproduced this by importing synthetic package content and obtaining accepted/sealed results.
- **Patch:**
```js
// Require producer-signed evidence BEFORE local sealing.
validateEvidencePackage(document, {
  schema,
  tenantId: expectedTenantId,
  maximumAgeHours: 24,
  fileName,
  verifyDocument: doc => verifyProducerSignature(doc, trustedProducerPublicKeys)
});

// Also bind import to current verified baseline tenant/cohort.
if (expectedTenantId !== baselineTenantId) throw new Error("Tenant mismatch");
```

### High — Freshness control can be bypassed with future-dated `producedAt`
- **Location:** `collector-adapters.js:69-78`
- **Confidence:** High
- **Issue:** Staleness logic only checks `Date.now() - producedAt > maximumAgeHours`. Future timestamps are accepted indefinitely. An attacker can set `producedAt` in 2099 and bypass stale-evidence rejection for months/years. I reproduced this: package with `producedAt: 2099-01-01T00:00:00.000Z` imported successfully with HTTP 200.
- **Patch:**
```js
const producedAt = Date.parse(doc.producedAt);
const now = Date.now();
const maxSkewMs = 5 * 60 * 1000;
if (!Number.isFinite(producedAt)) throw codedError("EVIDENCE_TIMESTAMP_INVALID", "...");
if (producedAt > now + maxSkewMs) {
  throw codedError("EVIDENCE_TIMESTAMP_IN_FUTURE", "producedAt cannot be in the future.");
}
if (now - producedAt > maximumAgeHours * 3600000) {
  throw codedError("EVIDENCE_STALE", "...");
}
```

### High — Signed attestation identity is self-asserted text, not bound to authenticated actor
- **Location:** `server.js:639-659`, `attestation-evidence.js:64-66`, `attestation-evidence.js:130-136`
- **Confidence:** High
- **Issue:** `attestedBy` is caller-supplied free text and is signed as-is. The signature therefore attests only that the local service signed the record, not that the named accountable owner actually performed the attestation. Because applied attestations can set control status to `Pass`, this enables identity spoofing in decision-critical evidence. I reproduced creation of a signed attestation with `attestedBy: "Global CISO"` via API.
- **Patch:**
```js
// Derive attester identity server-side from authenticated principal.
const attester = {
  oid: verifiedSession.oid,
  upn: verifiedSession.upn,
  displayName: verifiedSession.displayName
};
input.attestedBy = attester.upn; // ignore client-provided attestedBy
record.attester = attester;      // signed structured identity claims
```

## Lessons (appended to persona file)
- 2026-09-07 value-realization-postbuild — locally sealing imported JSON does not prove evidence provenance; require producer-side signatures plus bounded timestamp validation (including rejecting future producedAt) before any imported package can influence Pass/READY.
