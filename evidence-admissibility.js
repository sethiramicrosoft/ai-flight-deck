(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FlightDeckEvidenceAdmissibility = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Admission is process-local, not a field an imported JSON document can assert.
  const admissions = new WeakMap();
  const text = value => typeof value === "string" && value.trim().length > 0;
  function fingerprint(value) {
    if (Array.isArray(value)) return `[${value.map(fingerprint).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.keys(value).sort()
      .map(key => `${JSON.stringify(key)}:${fingerprint(value[key])}`).join(",")}}`;
    return JSON.stringify(value);
  }

  function hasConclusiveCoverage(result) {
    const c = result?.coverage;
    // Exclusions have no approval contract yet. A descriptive reason is not approval.
    return c?.complete === true &&
      [c.population, c.evaluated, c.excluded].every(n => Number.isSafeInteger(n) && n >= 0) &&
      c.excluded === 0 && c.evaluated === c.population;
  }

  function hasCurrentFreshness(result, control, now = new Date()) {
    const observed = Date.parse(result?.observedAt);
    const expiry = Date.parse(result?.freshUntil);
    const cap = Number(control?.freshnessHours) * 3600000;
    return Number.isFinite(observed) && Number.isFinite(expiry) &&
      Number.isFinite(cap) && cap > 0 &&
      observed <= now.getTime() + 300000 && expiry > now.getTime() &&
      expiry > observed && expiry <= observed + cap;
  }

  function approvedNotApplicable(result, now = new Date()) {
    return result?.status === "NotApplicable" && result.applicability?.applies === false &&
      text(result.applicability.reason) && text(result.applicability.approvedBy) &&
      Date.parse(result.applicability.expiresAt) > now.getTime() &&
      Date.parse(result.applicability.expiresAt) <= Date.parse(result.freshUntil);
  }

  function admitValidatedResult(result, control, binding) {
    if (!result || !control || !binding) throw new TypeError("Validated result, control and binding are required.");
    admissions.set(result, { fingerprint: fingerprint(result), control: { ...control }, binding: { ...binding } });
    return result;
  }

  function hasConsistentBindings(results) {
    const identities = new Set(results.filter(r => admissions.has(r)).map(r => {
      const b = admissions.get(r).binding;
      return `${b.tenantId}:${b.cohortId}:${b.collectorRunId}`;
    }));
    return identities.size <= 1;
  }

  function evaluateControl(result, now = new Date(), control = null, expected = null) {
    const blocked = (reason, explanation) => ({
      satisfied: false, admissible: false, status: "Unknown",
      reportedStatus: result?.authority?.claimedStatus || result?.status || "Unknown", reason, explanation
    });
    if (!result) return blocked("Missing", "Collect this missing control for the selected tenant and cohort.");
    const admission = admissions.get(result);
    if (!admission || admission.fingerprint !== fingerprint(result)) {
      if (!admission && result.status === "Unknown" && result.authority?.schemaVersion === "2.0.0" &&
          result.authority.validationStatus === "Rejected") {
        return blocked("EvidenceRequired", result.authority.whatWouldChangeDecision?.[0] ||
          "Collect supported source-bound evidence for this control.");
      }
      return blocked("Recollect", "Recollect evidence: this legacy, imported, or changed result has no verified source-bound receipt.");
    }
    const definition = control || admission.control;
    const binding = expected || admission.binding;
    if (definition.id !== result.controlId || binding.tenantId !== result.provenance?.tenantId ||
        binding.cohortId !== result.cohortId || binding.collectorRunId !== result.provenance?.collectorRunId ||
        admission.binding.domainId !== result.domainId ||
        result.instanceId !== `${binding.tenantId}:${binding.cohortId}:${result.controlId}`) {
      return blocked("IdentityMismatch", "Recollect for the exact tenant, cohort, domain, control and collector run.");
    }
    if (!hasCurrentFreshness(result, definition, now)) {
      return blocked("Expired", "Collect fresh evidence within the catalogue lifetime; future timestamps and excessive lifetimes are not accepted.");
    }
    if (!hasConclusiveCoverage(result)) {
      return blocked("IncompleteCoverage", "Evaluate the entire population. Exclusions require an approval contract not currently supported.");
    }
    if (result.status === "Unknown") {
      return blocked("Unknown", result.authority?.whatWouldChangeDecision?.[0] || "Collect supported evidence for this control.");
    }
    if (result.status === "Pass" && result.applicability?.applies === true) {
      return { satisfied: true, admissible: true, status: result.status, reason: "Pass", explanation: "Supported observation contract met." };
    }
    if (approvedNotApplicable(result, now)) {
      return { satisfied: true, admissible: true, status: result.status, reason: "ApprovedNotApplicable", explanation: "Current signed applicability approval accepted." };
    }
    return { satisfied: false, admissible: true, status: result.status, reason: result.status,
      explanation: result.status === "NotApplicable" ? "A current signed applicability approval is required." : `The supported evidence reports ${result.status.toLowerCase()}.` };
  }

  // Call only on a response fetched from this application's same-origin artifact API,
  // after the service has verified the receipt signature. Never call on file imports.
  function acceptServiceAssessment(scan, catalog) {
    const run = scan.estateAssessment?.collectorRun?.id;
    for (const result of scan.estateAssessment?.controlResults || []) {
      const domain = catalog.domains.find(d => d.id === result.domainId);
      const control = domain?.controls.find(c => c.id === result.controlId);
      const binding = result.authority?.evidenceRecord?.payload?.binding;
      if (control && binding && result.authority.validationStatus === "Accepted" &&
          binding.tenantId === scan.tenant?.tenantId && binding.collectorRunId === run &&
          scan.estateAssessment.cohorts.some(c => c.id === binding.cohortId)) {
        admitValidatedResult(result, control, binding);
      }
    }
    return scan;
  }

  function describeEvidence(result, now = new Date()) {
    const evaluation = evaluateControl(result, now);
    const mode = result?.authority?.acquisitionMode;
    const source = { LiveGraph: "Live Graph observation", SignedAttestation: "Accountable signed statement",
      Imported: "Imported evidence (integrity is not source truth)", LocalProbe: "Scanner-host observation",
      Unavailable: "Source not available", Unspecified: "Source not established" }[mode] || "Source not established";
    const confidence = typeof result?.confidence === "number" && Number.isFinite(result.confidence)
      ? `${Math.round(result.confidence * 100)}% reported confidence` : "Confidence not reported";
    return `${source}. ${evaluation.explanation} ${confidence}.`;
  }

  function projectAssessment(assessment, catalog, now = new Date()) {
    if (!assessment || !catalog) return assessment;
    const cohort = assessment.cohorts?.find(c => c.approved) || assessment.cohorts?.[0];
    const results = (assessment.controlResults || []).filter(r => !cohort || r.cohortId === cohort.id);
    const consistent = hasConsistentBindings(results);
    const domains = catalog.domains.map(definition => {
      const original = assessment.domains?.find(d => d.id === definition.id) || definition;
      const rows = results.filter(r => r.domainId === definition.id);
      const accepted = consistent ? definition.controls.filter(control => {
        const matches = rows.filter(r => r.controlId === control.id);
        return matches.length === 1 && evaluateControl(matches[0], now, control).admissible;
      }).length : 0;
      return {
        ...original,
        status: accepted === definition.controls.length ? "Collected" : rows.length ? "Partial" : "NotCollected",
        summary: `${accepted} of ${definition.controls.length} controls have admissible evidence.`,
        evaluatedControls: accepted
      };
    });
    const evaluatedControls = domains.reduce((sum, domain) => sum + domain.evaluatedControls, 0);
    return {
      ...assessment, domains, requiredDomains: domains.length,
      collectedDomains: domains.filter(d => d.status === "Collected").length,
      partialDomains: domains.filter(d => d.status === "Partial").length,
      evaluatedControls,
      unknownControls: catalog.domains.reduce((sum, d) => sum + d.controls.length, 0) - evaluatedControls
    };
  }

  return { admitValidatedResult, acceptServiceAssessment, hasConsistentBindings, evaluateControl, approvedNotApplicable,
    hasConclusiveCoverage, hasCurrentFreshness, describeEvidence, projectAssessment };
});
