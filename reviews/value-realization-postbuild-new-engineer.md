# Value Realization Implementation Review — New Engineer

**Reviewer**: New-engineer persona (Day 3, unfamiliar with broader system)  
**Scope**: Uncommitted AI Flight Deck value-realization implementation  
**Review areas**: README, UI, administrator producer, Power Platform template, attestation form, errors, discoverability  
**Date**: 2026-09-07

---

## Executive Summary

The evidence completion and attestation feature is a substantial addition to AI Flight Deck's value realization. The implementation is functionally complete but contains several comprehension blockers for onboarding:

1. **Terminology overload** — Five distinct "evidence" concepts (evidence-graph, evidence-packages, evidence-completion, evidence-sources, evidence-envelope) are introduced without glossary.
2. **Error message misalignment** — UI translates `Unknown` backend status to human-readable "Permission required", "Attestation required", etc., but schema definitions don't explain the mapping.
3. **Attestation form has unlabeled conditional fields** — "NotApplicable" decision exposes three additional fields without explaining when/why.
4. **Administrator producer command is example-only** — `collect-admin-evidence.ps1` shows pattern but lacks error recovery guidance for failed commands.
5. **Power Platform template has empty arrays as examples** — Template shows the required structure but provides no concrete examples of populated arrays.
6. **Mission gates block on incomplete attestations** — The "NotApplicable" attestation contract (requires approver + reason + future expiry) isn't documented in README or schema.

**Severity breakdown**: 1 Critical (attestation contract), 3 High (terminology, UI field labels, error mapping), 2 Medium (template examples, producer guidance).

---

## Critical Findings

### 1. **CRITICAL: Attestation form hides the NotApplicable contract**
**File**: `index.html`, lines ~1500–1550  
**Issue**: When user selects `decision = "NotApplicable"`, three additional fields appear:
- `approvedBy` (input field)
- `reason` (text field)  
- `expiresAt` (implied from the control's freshness window)

But the UI provides **zero guidance** on what "NotApplicable" means or why these fields are required.

**Evidence**:
```html
<label><input type="radio" name="attestation-decision" value="NotApplicable"> Not applicable</label>
<div id="not-applicable-fields" hidden>
  <div class="field-grid">
    <label class="field">Approved by
      <input type="text" id="attestation-approved-by">
    </label>
    <label class="field">Reason
      <input type="text" id="attestation-reason">
    </label>
  </div>
</div>
```

**Backend code** (attestation-evidence.js, line ~64):
```javascript
if (decision === "NotApplicable") {
  record.approvedBy = requiredText(input.approvedBy, "approvedBy", 256);
  record.reason = requiredText(input.reason, "reason", 2048);
}
```

**Impact**: New engineer (or customer) cannot understand why "NotApplicable" requires approver + reason when other decisions don't. Customers filling forms may pick "NotApplicable" incorrectly thinking it means "control didn't run" rather than "control is legitimately not applicable to this tenant". Mission gates require "NotApplicable" attestations to have expiry; missing expiry breaks advancement.

**Fix**: Add a help tooltip or inline text explaining NotApplicable:
```html
<label>
  <input type="radio" name="attestation-decision" value="NotApplicable"> 
  <strong>Not applicable</strong> 
  <span class="help-text">(Control does not apply to this tenant. Requires named approver, reason, and expiry.)</span>
</label>
```

Also update README § "Accountable governance attestations" to list all four decision types and their semantics.

---

### 2. **CRITICAL: Mission gate "incomplete attestation" error is not preventable from the UI**
**File**: `evidence-completion.js`, line ~180  
**Issue**: The `completeResult()` function requires NotApplicable attestations to have:
- `applicability.expiresAt` (a future date)
- `applicability.approvedBy` (non-empty string)

But if a user creates a NotApplicable attestation without filling `expiresAt` during the form, they receive a backend error ("expiresAt cannot be null") with no guidance on how to fix it. The error occurs during "complete evidence" classification but is not surfaced as a validation error in the attestation form.

**Evidence**:
```javascript
function completeResult(result, now) {
  if (result?.status === "NotApplicable") {
    if (!result.applicability || !result.applicability.expiresAt) {
      return false; // Control is incomplete
    }
  }
}
```

**Backend validation** (attestation-evidence.js):
```javascript
if (decision === "NotApplicable") {
  record.approvedBy = requiredText(input.approvedBy, "approvedBy", 256);
  record.reason = requiredText(input.reason, "reason", 2048);
}
```

Note: `expiresAt` is already required for all attestations (line ~48), but NotApplicable has no special handling at form time.

**Impact**: Customer creates attestation, scan runs, mission gate shows "NotApplicable" as "Complete" but then says gate is still blocked. No UI error message explains why.

**Fix**: In the attestation form, add a validation rule for NotApplicable:
```javascript
if (decision === "NotApplicable" && !input.expiresAt) {
  throw new Error("NotApplicable attestations require an expiry date.");
}
```
Display this error before sending to backend.

---

## High-Severity Findings

### 3. **HIGH: Five distinct "evidence" concepts introduced without glossary or mental model**
**File**: README.md (§ "Evidence completion center"), server.js, evidence-completion.js  
**Issue**: The feature uses:
- **Evidence-graph** — The per-control pass/fail/unknown result
- **Evidence-package** — Imported JSON from admin or Power Platform (admin-evidence.json, power-platform-evidence.json)
- **Evidence-envelope** — Signed wrapper around a package (admin-evidence.envelope.json)
- **Evidence-completion** — The feature/API for classifying unresolved controls
- **Evidence-sources** — The API endpoint showing what evidence has been imported

A new engineer reading the code must infer the data flow from code alone. No README section defines these or draws relationships.

**Example confusion**: When reading server.js line 384–392, the mapping between `evidencePackagePaths` and `evidencePackageEnvelopePaths` is not immediately obvious:
```javascript
const evidencePackagePaths = {
  admin: path.join(workspace, "admin-evidence.json"),
  powerPlatform: path.join(workspace, "power-platform-evidence.json")
};
const evidencePackageEnvelopePaths = {
  admin: path.join(workspace, "admin-evidence.envelope.json"),
  powerPlatform: path.join(workspace, "power-platform-evidence.envelope.json")
};
```

Why does each package need a separate envelope file? Is the envelope always paired with the package?

**Impact**: Onboarding blocked when engineer must modify evidence import logic or debug a signature mismatch. Without a glossary, they waste 30+ minutes tracing code instead of understanding the concept.

**Fix**: Add a glossary to README § "Complete evidence" or in a new § "Concepts":
```markdown
## Evidence Concepts

- **Control result (evidence-graph)**: The pass/fail/unknown determination for a single control.
- **Evidence package**: A JSON file exported from Exchange/SharePoint (admin-evidence.json) or Power Platform (power-platform-evidence.json). Raw data, not yet validated.
- **Evidence envelope**: Cryptographic wrapper around a package, signed with the local workspace integrity key. Proves the package was not modified after import.
- **Evidence completion**: Feature that classifies unresolved controls (status = Unknown) as: MissingPermission, MissingLicense, AdminEvidenceRequired, PowerPlatformEvidenceRequired, SignedAttestationRequired, etc.
- **Evidence sources**: API endpoint (/api/evidence-sources) showing which evidence types have been imported.
```

Also add a JSDoc comment to `server.js` at line 384:
```javascript
// Package files and their signed envelopes. Each package is stored as raw JSON;
// its envelope contains the SHA256 digest and signature. If the file is tampered,
// verification fails and the control result is treated as unknown (not corrupted-pass).
const evidencePackagePaths = {
```

---

### 4. **HIGH: Evidence classification to UI labels has no documented mapping**
**File**: evidence-completion.js, index.html  
**Issue**: The backend classifies each control into a state (`STATE_PRIORITY`, lines ~10–20):
```javascript
const STATE_PRIORITY = Object.freeze({
  MissingPermission: 0,
  MissingLicense: 1,
  SignedAttestationRequired: 2,
  AdminEvidenceRequired: 3,
  PowerPlatformEvidenceRequired: 4,
  RecollectionRequired: 5,
  LiveCollectionRequired: 6,
  ConfigurationAction: 7,
  OwnerReview: 8,
  Complete: 9
});
```

Each state maps to a `STATE_DETAILS` label and action, e.g.:
```javascript
SignedAttestationRequired: {
  label: "Signed attestation required",
  action: "Create an accountable statement with an owner, evidence data, and expiry."
}
```

But in the UI, these labels appear in `.completion-blocker` cards (index.html line ~241), and a new engineer reading the HTML sees:
```html
<span class="completion-state">{{ control.stateLabel }}</span>
```

The engineer cannot trace back to the schema/code that defines what "Permission required" means or where it comes from.

**Impact**: When customizing messages or adding new states, engineer must grep for `STATE_DETAILS` in JS and manually update HTML labels. If they diverge, the customer sees stale or conflicting messages.

**Fix**: 
1. Add a JSDoc comment above `STATE_DETAILS` explaining each state:
```javascript
// STATE_DETAILS maps backend classification to UI label and actionable guidance.
// Never construct labels in HTML templates; import from this single source of truth.
// When adding a new state: (1) add to STATE_PRIORITY, (2) add entry to STATE_DETAILS,
// (3) update classify() logic, (4) add test case in evidence-completion.test.js.
const STATE_DETAILS = Object.freeze({
```

2. Export `STATE_DETAILS` from evidence-completion.js and import it into server.js so the API response includes both `state` and `stateLabel`:
```javascript
json(res, 200, {
  state: "MissingPermission",
  stateLabel: STATE_DETAILS.MissingPermission.label,
  action: STATE_DETAILS.MissingPermission.action
});
```
Then the UI just displays `{{ control.stateLabel }}` without guessing.

---

### 5. **HIGH: README PowerShell command is example-only; real error scenarios not documented**
**File**: README.md (§ "Exchange Online, SharePoint Online, and Purview"), scanner/collect-admin-evidence.ps1  
**Issue**: README shows:
```powershell
.\scanner\collect-admin-evidence.ps1 `
  -TenantId "<tenant-guid>" `
  -WorkspacePath "$env:LOCALAPPDATA\AI Flight Deck\live-test" `
  -SharePointAdminUrl "https://<tenant>-admin.sharepoint.com"
```

But the script has error handling for individual command failures:
```powershell
function Add-Evidence {
    try {
        $value = @(& $Operation)
        $evidence[$key] = $value
    }
    catch {
        $errors[$key] = [ordered]@{
            code = if ($_.FullyQualifiedErrorId) { $_.FullyQualifiedErrorId } else { "COMMAND_FAILED" }
            message = $_.Exception.Message
        }
    }
}
```

**README never explains**:
- What happens if `Get-EXOMailbox` fails (e.g., permission denied)?
- Does the script stop or continue collecting other evidence?
- Where does the output go? How does the user see errors?
- What's a "partial success" — can the customer import evidence with some errors?

**Impact**: Administrator runs the script, sees errors in PowerShell, but doesn't know if the output file is usable or corrupted. They may discard good data because they think one command failure means the whole import is invalid.

**Fix**: Update README with an error handling section:
```markdown
#### Handling collection failures

The administrator evidence collector records command-level failures in the output 
JSON. You may see errors for:

- `PERMISSION_DENIED` — Run the collector with account that has Directory or Workload Admin role.
- `QUOTA_EXCEEDED` — Try again in 1–5 minutes (rate limiting).
- `SERVICE_UNAVAILABLE` — Service is undergoing maintenance. Wait and retry.

A partial-success import (some commands succeeded, others failed) is valid. 
Flight Deck will mark affected controls as "Administrator evidence required" 
and show which exact commands failed.
```

Also add a JSDoc at the top of collect-admin-evidence.ps1:
```powershell
# Collects read-only evidence from Exchange, SharePoint, and Purview.
# Fails gracefully: each command failure is recorded but does not stop collection.
# Output: admin-evidence.json with { evidence: {...}, errors: {...} }
# Partial success is expected; use the output JSON to debug which permissions are missing.
```

---

### 6. **HIGH: UI form field labels don't match backend parameter names in attestation**
**File**: index.html, attestation-evidence.js  
**Issue**: The HTML form has input fields:
```html
<label class="field">Control
  <select id="attestation-control">...</select>
</label>
<label class="field">Decision
  <input type="radio" name="attestation-decision" ...>
</label>
<label class="field">Statement
  <textarea id="attestation-statement"></textarea>
</label>
```

But in JavaScript (when sending to server), these are mapped to backend parameter names:
```javascript
const input = {
  controlId: document.getElementById("attestation-control").value,
  decision: document.querySelector('[name="attestation-decision"]:checked').value,
  statement: document.getElementById("attestation-statement").value,
  attestedBy: document.getElementById("attestation-attested-by").value,
  expiresAt: ...
};
```

The field ID is `attestation-control` but the backend parameter is `controlId`. No comment explains the mapping. If an engineer refactors the HTML later, they might rename the field ID but forget to update the JS mapping.

**Impact**: Silent failure when renaming form fields. The form still submits, but the server rejects it with a cryptic error ("controlId is required").

**Fix**: Add JSDoc above the form-to-API mapping:
```javascript
// Map form field IDs to backend attestation-evidence API contract.
// MUST stay in sync with createSignedAttestation() in attestation-evidence.js.
// If you rename a form field, update the corresponding mapping below AND the JSDoc.
const input = {
  controlId: document.getElementById("attestation-control").value,
  decision: document.querySelector('[name="attestation-decision"]:checked').value,
  // ... etc
};
```

---

## Medium-Severity Findings

### 7. **MEDIUM: Power Platform template shows empty arrays; no examples of populated structure**
**File**: schema/power-platform-evidence.template.v1.json  
**Issue**: The template is:
```json
{
  "schema": "ai-flight-deck/power-platform-evidence",
  "version": "1.0.0",
  "tenantId": "00000000-0000-0000-0000-000000000000",
  "actorId": "power-platform-administrator@example.com",
  "producedAt": "2026-01-01T00:00:00.000Z",
  "evidence": {
    "environments": [],
    "dlpPolicies": [],
    "connectors": [],
    "agents": [],
    "agentOwners": [],
    "agentSharing": [],
    "agentLifecycle": []
  },
  "errors": {}
}
```

A Power Platform administrator looking at this template has no idea what an `environment` object looks like, what fields are required, or what an `agent` object contains.

**Impact**: Administrator manually constructs JSON and likely creates invalid structures. Import fails with a schema validation error that doesn't tell them which field was wrong.

**Fix**: Create a second file `schema/power-platform-evidence.example.json` with populated data:
```json
{
  "schema": "ai-flight-deck/power-platform-evidence",
  "version": "1.0.0",
  "tenantId": "00000000-0000-0000-0000-000000000000",
  "actorId": "power-platform-administrator@example.com",
  "producedAt": "2026-01-01T00:00:00.000Z",
  "evidence": {
    "environments": [
      {
        "id": "3ea7cc11-111a-1111-1111-111111111111",
        "name": "Default",
        "type": "Production",
        "accessLevel": "Public",
        "dlpClassification": "Standard"
      }
    ],
    "dlpPolicies": [
      {
        "id": "pol-001",
        "name": "Restrict external sharing",
        "connectorGroups": [
          {
            "name": "Confidential",
            "connectors": ["Outlook", "Teams"]
          }
        ]
      }
    ],
    "connectors": [...],
    "agents": [...],
    "agentOwners": [...],
    "agentSharing": [...],
    "agentLifecycle": [...]
  },
  "errors": {}
}
```

Also update README to link to both template and example:
```markdown
- **Template**: [power-platform-evidence.template.v1.json](schema/power-platform-evidence.template.v1.json)
- **Example**: [power-platform-evidence.example.json](schema/power-platform-evidence.example.json)
```

---

### 8. **MEDIUM: Evidence package import error messages lack guidance on schema validation failure**
**File**: server.js, line ~601–620  
**Issue**: When an administrator uploads a Power Platform or admin evidence package, the server calls:
```javascript
validateEvidencePackage(document, {
  schema,
  tenantId: null,
  ...
});
```

If validation fails, the error is caught in the try-catch at server.js line ~820 and returned as:
```javascript
catch (error) {
  json(res, error.message === "Another tenant workflow is already running." ? 409 : 400, {
    error: error.message || "Request failed."
  });
}
```

If `validateEvidencePackage` throws an error like "Missing required property 'environments'", the user sees:
```json
{ "error": "Missing required property 'environments'" }
```

No guidance on which part of the JSON was wrong or how to fix it.

**Impact**: Administrator sees a schema error but has no way to debug which field or which array element is malformed. They have to manually re-structure the entire JSON.

**Fix**: Enhance error handling to include a repair hint:
```javascript
validateEvidencePackage(document, {
  schema,
  tenantId: null
}).catch(error => {
  throw new Error(
    `Power Platform evidence schema validation failed: ${error.message}. ` +
    `Check schema/power-platform-evidence.example.json for correct structure. ` +
    `Ensure all seven required arrays are present: environments, dlpPolicies, ` +
    `connectors, agents, agentOwners, agentSharing, agentLifecycle.`
  );
});
```

---

### 9. **MEDIUM: Discoverability of "Evidence completion center" feature in UI is unclear**
**File**: index.html (§ "Set up" page)  
**Issue**: The README mentions "Evidence completion center" but the UI doesn't use that exact term. The HTML has:
- `.service-panel` for service status
- `.evidence-source-grid` for showing available imports
- `.completion-blockers` for showing top blockers

But no page heading says "Evidence Completion Center". A user opening the application for the first time doesn't immediately see where to import evidence.

**Impact**: First-time user completes baseline scan, sees "Assessment" page, but doesn't know how to get to evidence import. They may look for a menu item or button labeled "Evidence Completion Center" and not find it.

**Fix**: Add a clear heading on the Set up page:
```html
<div class="section-head">
  <div>
    <h2>Evidence Completion Center</h2>
    <p>Import administrator evidence packages, Power Platform exports, and signed attestations to resolve missing controls.</p>
  </div>
</div>
```

Also add a breadcrumb or progress indicator showing the workflow:
```html
<div class="workflow-steps">
  <div class="step complete">1. Baseline scan</div>
  <div class="step current">2. Evidence completion</div>
  <div class="step">3. Assessment review</div>
</div>
```

---

## Low-Severity Findings

### 10. **LOW: Magic constant `24` hours for evidence freshness not documented**
**File**: server.js, line ~572; README (§ "Complete evidence")  
**Issue**: The API response includes:
```javascript
json(res, 200, {
  adminEvidence: fs.existsSync(evidencePackagePaths.admin),
  powerPlatformEvidence: fs.existsSync(evidencePackagePaths.powerPlatform),
  attestations: ...,
  maximumPackageAgeHours: 24
});
```

README says "24-hour freshness" but doesn't explain why. Is it a security decision? UX decision? Operator decision?

**Impact**: Low — doesn't block workflow. But future engineer tuning evidence retention or security requirements won't understand the rationale.

**Fix**: Add a comment:
```javascript
// maximumPackageAgeHours: 24 = evidence cannot be older than 1 day.
// Rationale: admin and Power Platform environments change frequently.
// Stale evidence (>24h) may not reflect current state. Control freshness
// windows are per-control (see catalog); this is a floor for imported packages.
maximumPackageAgeHours: 24
```

---

### 11. **LOW: Attestation form doesn't explain cohort selection**
**File**: index.html (§ "Attestations")  
**Issue**: The form has:
```html
<label class="field">Tenant
  <input type="text" id="attestation-tenant" readonly>
</label>
<label class="field">Cohort
  <select id="attestation-cohort">...</select>
</label>
```

The readonly tenant field is clear, but "Cohort" is unexplained. A new administrator doesn't know what a cohort is or why they must select one.

**Impact**: Low — likely obvious to domain experts. But a new administrator might select the wrong cohort or be confused.

**Fix**: Add a help tooltip:
```html
<label class="field">Cohort
  <div class="help-text">The approved pilot group for which this evidence applies.</div>
  <select id="attestation-cohort">...</select>
</label>
```

---

### 12. **LOW: Evidence-package upload silently accepts duplicate imports**
**File**: server.js, line ~586–620  
**Issue**: When an administrator uploads an admin-evidence package twice (same data, same timestamp), the second import overwrites the first without warning.

**Impact**: Low — the second import is identical, so no data loss. But an administrator might accidentally re-import an old package and not notice.

**Fix**: Add a check:
```javascript
if (fs.existsSync(evidencePackagePaths[input.kind])) {
  const existing = JSON.parse(fs.readFileSync(evidencePackagePaths[input.kind], "utf8"));
  if (existing.producedAt === document.producedAt) {
    // Warn but allow (idempotent)
    appendLog("Evidence package already imported with same timestamp. Skipping.");
    return;
  }
  // Different timestamp: allow overwrite (operator is re-running collection)
}
```

---

## Findings Summary Table

| # | Severity | Category | Issue | File(s) | Fix Time |
|---|----------|----------|-------|---------|----------|
| 1 | Critical | UI/UX | NotApplicable form fields unlabeled | index.html | 15 min |
| 2 | Critical | Logic | Mission gate incomplete attestation not preventable | evidence-completion.js | 20 min |
| 3 | High | Docs | Five evidence concepts without glossary | README.md | 30 min |
| 4 | High | Code | Evidence classification mapping undocumented | evidence-completion.js, index.html | 20 min |
| 5 | High | Docs | Administrator producer command lacks error guidance | README.md, collect-admin-evidence.ps1 | 25 min |
| 6 | High | Code | Form field labels don't match backend mapping | index.html | 15 min |
| 7 | Medium | Docs | Power Platform template has no examples | schema/ | 20 min |
| 8 | Medium | UX | Import error messages lack debugging guidance | server.js | 20 min |
| 9 | Medium | UX | Evidence completion center not discoverable | index.html | 15 min |
| 10 | Low | Code | Magic constant 24 hours not documented | server.js | 5 min |
| 11 | Low | UX | Cohort selection not explained | index.html | 5 min |
| 12 | Low | UX | Duplicate import silently overwrites | server.js | 10 min |

---

## Recommendations (Priority Order)

1. **Add NotApplicable help text and form validation** (fixes #1, #2 — blocks customer workflow)
2. **Create evidence concepts glossary** (fixes #3 — blocks engineer onboarding)
3. **Document evidence state mapping** (fixes #4 — blocks customization)
4. **Update README with administrator error handling** (fixes #5 — blocks operator success)
5. **Add JSDoc to form-to-API mapping** (fixes #6 — prevents refactoring regressions)
6. **Create power-platform-evidence.example.json** (fixes #7 — enables customer self-service)
7. **Enhance import error messages** (fixes #8 — reduces support burden)
8. **Add Evidence Completion Center heading** (fixes #9 — improves UX discoverability)
9. **Document freshness constants** (fixes #10, #11, #12 — improves maintainability)

**Estimated effort**: 3–4 hours for all fixes. None require code restructuring.

---

## Conclusion

The value-realization feature is **functionally sound** but has **documentation and UX gaps** that will surface during operator onboarding or when customers first use the attestation workflow. The critical and high-severity findings block workflows or create confusion; the medium and low findings reduce discoverability and maintainability. All findings are actionable and do not require architectural changes.

---

