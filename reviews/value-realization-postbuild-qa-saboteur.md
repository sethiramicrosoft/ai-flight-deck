# qa-saboteur review of value-realization

## Summary
I found 2 high-confidence regressions in the postbuild AI Flight Deck changes. The evidence-import boundary accepts future-dated, cross-tenant, and shape-invalid packages as sealed/ready, and the SharePoint admin evidence reader can satisfy a variant-specific request from a generic command blob. I also exercised tampered attestations, expiry boundaries, unsupported controls, incomplete coverage, missing API endpoints, browser form errors, and scan recomputation; those paths held up in the existing suite.

## Findings
### High — Evidence packages are accepted even when future-dated, cross-tenant, and shape-invalid
- **Location:** `server.js:586-620`, `collector-adapters.js:46-81`, `server.js:402-417`
- **Issue:** `POST /api/evidence-packages` seals any document that matches the schema/version strings and is not older than 24 hours. It does not reject `producedAt` in the future, does not require `evidence` and `errors` to be plain objects, and does not bind the import to an already-known baseline tenant before marking the package ready. In the probe run, a package with `tenantId = 2222…`, `producedAt` one day in the future, `evidence: []`, and `errors: []` returned HTTP 200 and `/api/status` reported `adminEvidence: true`.
- **Repro:** POST this payload to `/api/evidence-packages`:
  ```json
  {
    "kind": "admin",
    "document": {
      "schema": "ai-flight-deck/admin-evidence",
      "version": "1.0.0",
      "tenantId": "22222222-2222-2222-2222-222222222222",
      "producedAt": "future ISO timestamp",
      "evidence": ["malformed-array"],
      "errors": []
    }
  }
  ```
  Observe `200 OK` and a ready status, even though the package is malformed and cross-tenant.
- **Patch:**
  ```js
  function isPlainObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
  }

  function validateEvidencePackage(doc, options) {
    ...
    if (!Number.isFinite(producedAt) || producedAt - Date.now() > 5 * 60 * 1000) {
      throw codedError("EVIDENCE_TIMESTAMP_INVALID", `${fileName} has an invalid producedAt value.`);
    }
    if (!isPlainObject(doc.evidence) || !isPlainObject(doc.errors)) {
      throw codedError("EVIDENCE_SHAPE_INVALID", `${fileName} must contain object-shaped evidence and errors maps.`);
    }
    ...
  }

  // server.js
  const baselineTenantId =
    fs.existsSync(artifactPaths.baseline) && fs.existsSync(envelopePaths.baseline)
      ? (readVerifiedArtifact("baseline").tenant?.tenantId || readVerifiedArtifact("baseline").tenant?.id || null)
      : null;
  validateEvidencePackage(document, {
    schema,
    tenantId: baselineTenantId,
    maximumAgeHours: 24,
    fileName: `${input.kind} evidence package`
  });
  ```

### High — Variant-specific admin command evidence silently falls back to the generic command key
- **Location:** `collector-adapters.js:85-115`
- **Issue:** `createAdminCommandAdapter` first looks for `${service}:${command}:${evidenceKey}`, but when that exact variant is missing it falls back to `${service}:${command}`. That means a generic `sharePointOnline:Get-SPOSite` blob can satisfy a request for `restrictedContent`, `siteLifecycle`, or `oneDriveOverrides` even if the variant-specific evidence was never produced. That hides missing evidence on commands that are intentionally duplicated with different semantics.
- **Repro:** Put only this entry in `admin-evidence.json`:
  ```json
  {
    "sharePointOnline:Get-SPOSite": [{ "id": "generic-result" }]
  }
  ```
  Then request `service: "sharePointOnline"`, `command: "Get-SPOSite"`, `evidenceKey: "restrictedContent"`. The adapter returns the generic payload instead of failing with `COMMAND_UNAVAILABLE`.
- **Patch:**
  ```js
  function commandLookupKeys(request) {
    const base = `${request.service}:${request.command}`;
    if (request.evidenceKey) return [`${base}:${request.evidenceKey}`];
    return [base];
  }

  function createAdminCommandAdapter(workspace, options = {}) {
    return async request => {
      const evidence = validateEvidencePackage(...);
      for (const key of commandLookupKeys(request)) {
        if (Object.prototype.hasOwnProperty.call(evidence.errors || {}, key)) {
          throw codedError(
            evidence.errors[key].code || "COMMAND_FAILED",
            evidence.errors[key].message || `${request.command} failed during administrator collection.`
          );
        }
        if (Object.prototype.hasOwnProperty.call(evidence.evidence || {}, key)) {
          return evidence.evidence[key];
        }
      }
      throw codedError(
        "COMMAND_UNAVAILABLE",
        `No authenticated ${request.service} administration session supplied evidence for ${request.command}.`
      );
    };
  }
  ```

## Lessons (appended to persona file)
- 2026-09-07 ai-flight-deck value-realization — import endpoints that only check schema/version/freshness can still accept future-dated or shape-invalid evidence and mark it ready; validate plain-object payload shape and reject future timestamps before sealing, then bind the import to the current baseline tenant when one exists.
- 2026-09-07 ai-flight-deck value-realization — when a reader supports variant-specific command keys, a generic fallback can hide missing evidence for duplicated command variants; if the caller supplies an evidence key, require an exact variant match instead of silently reusing the base command blob.
