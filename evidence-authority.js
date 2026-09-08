"use strict";

const catalogDefault = require("./schema/readiness-catalog.v1.json");
const attestationExamples = require("./schema/attestation-data-examples.v1.json");
const { createEvidenceEnvelope, verifyEvidenceEnvelope, sha256Digest } = require("./evidence-integrity");
const { verifySignedAttestation } = require("./attestation-evidence");
const { hasConclusiveCoverage, hasCurrentFreshness, admitValidatedResult } = require("./evidence-admissibility");

const AUTHORITY_VERSION = "2.0.0";
// Microsoft Entra's licensing reference: M365_COPILOT_APPS, not Copilot Studio or a name substring.
const COPILOT_APPS_PLAN_ID = "a62f8878-de10-42f3-b68f-6149a25ceb97";
const collected = new WeakMap();
const acquisitions = new WeakMap();
const text = v => typeof v === "string" && v.trim().length > 0;
const count = v => Number.isSafeInteger(v) && v >= 0;
const same = (a, b) => sha256Digest(a) === sha256Digest(b);
const bindingFor = (result, context) => ({
  tenantId: context.tenantId, cohortId: context.cohort.id,
  cohortDigest: sha256Digest({ id: context.cohort.id, approved: context.cohort.approved === true,
    principalIds: [...(context.cohort.principalIds || [])].sort() }),
  collectorRunId: context.collectorRunId, domainId: result.domainId,
  controlId: result.controlId, instanceId: result.instanceId
});
function snapshot(result) {
  const { authority, ...value } = result;
  if (authority?.claimedStatus) value.status = authority.claimedStatus;
  value.limitations = (value.limitations || []).filter(l => l.code !== "EVIDENCE_NOT_ADMISSIBLE");
  return value;
}

function recordObservation(result, context, acquisitionMode, contract, facts, source) {
  const id = `evidence:${context.collectorRunId}:${result.controlId}`;
  const sourceDigest = sha256Digest(source);
  result.provenance.acquisitionMode = acquisitionMode;
  result.evidenceRefs = [{ id, kind: "boundObservation", digest: sourceDigest.slice(7), etag: null }];
  collected.set(result, {
    id, contract, acquisitionMode, binding: bindingFor(result, context),
    sourceDigest, facts, resultDigest: sha256Digest(snapshot(result))
  });
}

// The runtime calls this before discarding source observations. Only explicit,
// bounded contracts are supported; collector names or outcome strings are not proof.
function captureCollectorEvidence(collector, observations, context, results) {
  for (const result of results) {
    acquisitions.set(result, collector.acquisitionMode || "Unspecified");
    if (result.provenance) result.provenance.acquisitionMode = collector.acquisitionMode || "Unspecified";
    if (result.provenance?.collectorId !== collector.id ||
        result.provenance?.collectorVersion !== collector.version ||
        !collector.domainIds.includes(result.domainId)) continue;
    if (collector.id === "microsoft-graph-licensing") {
      const { skus, users } = observations;
      if (!Array.isArray(skus) || !Array.isArray(users) ||
          skus.some(s => !text(s.id) || !text(s.skuPartNumber) ||
            !count(s.consumedUnits) || !count(s.prepaidUnits?.enabled) ||
            !Array.isArray(s.servicePlans)) ||
          new Set(skus.map(s => s.id)).size !== skus.length) continue;
      if (result.controlId === "AFD-LIC-004") {
        const inventory = skus.map(s => ({
          id: s.id, skuPartNumber: s.skuPartNumber, consumedUnits: s.consumedUnits,
          prepaidUnits: s.prepaidUnits,
          servicePlans: s.servicePlans.map(p => ({
            servicePlanId: p.servicePlanId, servicePlanName: p.servicePlanName,
            provisioningStatus: p.provisioningStatus
          }))
        })).sort((a, b) => a.skuPartNumber.localeCompare(b.skuPartNumber));
        if (inventory.some(s => s.servicePlans.some(p =>
          !text(p.servicePlanId) || !text(p.servicePlanName) || !text(p.provisioningStatus)))) continue;
        if (!same(result.observedValue, { skuCount: skus.length, skus: inventory })) continue;
        recordObservation(result, context, "LiveGraph", "licence-inventory-v1",
          { outcome: "Pass", population: skus.length }, { skus });
      }
      // These controls require fully resolved, approved cohort membership and
      // actual enabled Copilot plan observations, not an assigned SKU alone.
      if (!["AFD-LIC-001", "AFD-LIC-002"].includes(result.controlId)) continue;
      const ids = context.cohort?.principalIds;
      if (!context.cohort.approved || !Array.isArray(ids) || !ids.length ||
          new Set(ids).size !== ids.length || users.some(u => !text(u.id) ||
            !Array.isArray(u.assignedPlans) || !Array.isArray(u.assignedLicenses)) ||
          new Set(users.map(u => u.id)).size !== users.length ||
          ids.some(id => !users.some(u => u.id === id))) continue;
      const copilotSkus = skus.filter(s => s.servicePlans.some(p =>
        String(p.servicePlanId).toLowerCase() === COPILOT_APPS_PLAN_ID));
      const planIds = new Set(copilotSkus.flatMap(s => s.servicePlans
        .filter(p => String(p.servicePlanId).toLowerCase() === COPILOT_APPS_PLAN_ID)
        .map(p => String(p.servicePlanId).toLowerCase())));
      const licensed = users.filter(u => u.assignedPlans.some(p =>
        planIds.has(String(p.servicePlanId).toLowerCase()) && p.capabilityStatus === "Enabled"));
      const missing = ids.filter(id => !licensed.some(u => u.id === id)).length;
      const outside = licensed.filter(u => !ids.includes(u.id)).length;
      if (result.controlId === "AFD-LIC-002") {
        if (!same(result.observedValue, { cohortLicensed: ids.length - missing,
          cohortMissing: missing, licensedOutsideCohort: outside })) continue;
        recordObservation(result, context, "LiveGraph", "cohort-licence-assignment-v1",
          { outcome: missing || outside ? "Fail" : "Pass", population: ids.length + outside,
            cohortSize: ids.length, missing, outside }, observations);
      } else {
        const availableUnits = copilotSkus.reduce((n, s) => n + s.prepaidUnits.enabled - s.consumedUnits, 0);
        const active = copilotSkus.length > 0 && copilotSkus.every(s => s.capabilityStatus === "Enabled");
        const outcome = active && availableUnits >= ids.length ? "Pass" : "Fail";
        const enabledUnits = copilotSkus.reduce((n, s) => n + s.prepaidUnits.enabled, 0);
        if (!same(result.observedValue, { copilotSkuCount: copilotSkus.length, enabledUnits,
          availableUnits, approvedCohortSize: ids.length })) continue;
        recordObservation(result, context, "LiveGraph", "copilot-capacity-v1",
          { outcome, population: ids.length, cohortSize: ids.length, availableUnits, active }, observations);
      }
    }
  }
}

function attestationDataValid(controlId, data, context, now) {
  const fields = (o, keys) => Boolean(o && keys.every(k => text(o[k])));
  const recent = (v, days) => Number.isFinite(Date.parse(v)) &&
    Date.parse(v) <= now.getTime() + 300000 && now.getTime() - Date.parse(v) <= days * 86400000;
  const all = (a, fn) => Array.isArray(a) && a.length > 0 && a.every(fn);
  switch (controlId) {
    case "AFD-IAM-007": return fields(data, ["accountRef", "owner", "exclusionEvidenceRef", "monitoringAlertRef"]);
    case "AFD-DEV-005": return fields(data, ["owner", "policyRef", "conditionalAccessEvidenceRef", "enrollmentRestrictionsEvidenceRef"]) && data.settingsMatchPolicy === true;
    case "AFD-OPS-004": return fields(data, ["owner", "advisoryReviewRef"]) && recent(data.reviewedAt, 7) && data.catalogueUpdated === true;
    case "AFD-OPS-005": return fields(data, ["technicalContact", "executiveContact"]) && data.tenantId === context.tenantId && recent(data.reviewedAt, 30);
    case "AFD-COPILOT-006": return fields(data, ["owner", "decision", "privacyAssessmentRef", "tenantSettingEvidenceRef"]) && data.tenantSettingMatch === true;
    case "AFD-PPA-005": return all(data.sources, s => fields(s, ["id", "sensitivityLabel", "dlpAlignment", "promptInjectionReview"])) &&
      Array.isArray(data.tools) && data.tools.every(t => fields(t, ["id", "inputBoundary", "outputBoundary"]));
    case "AFD-ADOPT-001": return Array.isArray(data.useCases) && data.useCases.length >= 3 &&
      new Set(data.useCases.map(u => u.id)).size === data.useCases.length &&
      data.useCases.every(u => fields(u, ["id", "owner", "targetCohort", "expectedOutcome", "successMetric"]) && u.targetCohort === context.cohort.id);
    case "AFD-ADOPT-002": return all(data.cohorts, c => fields(c, ["owner", "groupId", "entryCriteria", "exitCriteria"])) &&
      data.cohorts.some(c => c.id === context.cohort.id);
    case "AFD-ADOPT-003": return fields(data.support, ["intake", "owner", "responseTarget"]) && recent(data.training?.deliveredAt, 30);
    case "AFD-ADOPT-004": return all(data.publishedUseCaseIds, id => text(id) &&
      Array.isArray(data.acceptances) && data.acceptances.some(a => a.useCaseId === id &&
        fields(a, ["champion", "impactAssessmentUrl"]) && Date.parse(a.expiresAt) > now.getTime()));
    case "AFD-ADOPT-006": return all(data.reviews, r => recent(r.heldAt, 7) &&
      r.driftReviewed === true && all(r.decisions, text));
    default: return false;
  }
}

function captureAttestationEvidence(result, record, context, control, integrity, now) {
  if (record.domainId !== result.domainId || record.controlId !== result.controlId ||
      record.tenantId !== context.tenantId || record.cohortId !== context.cohort.id ||
      !verifySignedAttestation(record, { ...integrity, now }) ||
      !Array.isArray(record.evidenceReferences) || !record.evidenceReferences.length ||
      !record.evidenceReferences.every(text)) return;
  if (result.status === "NotApplicable") {
    // These are the catalogue's conditional applicability contracts.
    if (!["AFD-DEV-005", "AFD-PPA-005", "AFD-ADOPT-002", "AFD-ADOPT-003"].includes(control.id) ||
        record.decision !== "NotApplicable" || !fieldsForExemption(record) ||
        record.data?.applicablePopulation !== 0) return;
  } else if (result.status !== "Pass" || result.status !== record.decision ||
      !attestationDataValid(control.id, record.data, context, now)) return;
  result.observedAt = record.attestedAt;
  result.freshUntil = record.expiresAt;
  recordObservation(result, context, "SignedAttestation", "accountable-statement-v1",
    { outcome: result.status, population: result.coverage.population, record }, record);
}
function fieldsForExemption(record) {
  return text(record.approvedBy) && text(record.reason) && text(record.data?.scopeEvidenceRef);
}

function validateControlResultAuthority(result, control, validatedAt = new Date().toISOString(), options = {}) {
  const now = new Date(validatedAt);
  if (Number.isNaN(now.getTime())) throw new TypeError("validatedAt must be a valid timestamp.");
  const context = options.context;
  const claimedStatus = result.authority?.claimedStatus || result.status;
  const original = snapshot(result);
  const failures = [];
  const reject = (condition, reason) => { if (!condition) failures.push(reason); };
  const domain = (options.catalog || catalogDefault).domains.find(d => d.controls.some(c => c.id === control.id));
  reject(!result.authority || result.status === claimedStatus ||
    (result.status === "Unknown" && result.authority.validationStatus === "Rejected"),
    "Recollect: the result status was changed independently of its bound observation claim.");
  reject(context?.tenantId && context?.cohort?.id && context?.collectorRunId &&
    result.controlId === control.id && result.domainId === domain?.id &&
    result.cohortId === context.cohort.id && result.provenance?.tenantId === context.tenantId &&
    result.provenance?.collectorRunId === context.collectorRunId &&
    result.instanceId === `${context.tenantId}:${context.cohort.id}:${control.id}`,
  "Recollect with the exact tenant, cohort, domain, control, instance and run binding.");
  reject(result.controlVersion === (options.catalog || catalogDefault).catalogVersion &&
    result.requirement === control.requirement, "Recollect using the current catalogue control version and requirement.");
  reject(text(result.provenance?.collectorId) && text(result.provenance?.actorId) &&
    (!context?.actorId || result.provenance.actorId === context.actorId),
    "Recollect with the expected collector and actor provenance.");
  reject(result.confidence === undefined || (typeof result.confidence === "number" &&
    Number.isFinite(result.confidence) && result.confidence >= 0 && result.confidence <= 1),
    "Report confidence in the supported 0–1 range, or omit it when not reported.");
  reject(hasConclusiveCoverage(result), "Complete coverage must have integer population = evaluated, with zero unapproved exclusions.");
  reject(hasCurrentFreshness(result, control, now), "Recollect current evidence; future dates, expired evidence and lifetimes above the catalogue cap are rejected.");
  reject(!(original.limitations || []).length, "Resolve the reported evidence limitations before asserting a conclusive outcome.");
  reject(claimedStatus === "NotApplicable" ? result.applicability?.applies === false : result.applicability?.applies === true,
    "Provide a consistent applicability decision and a supported signed exemption where appropriate.");
  let record = collected.get(result);
  let envelope = result.authority?.evidenceRecord || null;
  if (!record && envelope && options.integrity?.key) {
    try {
      verifyEvidenceEnvelope(envelope, options.integrity.key);
      if (envelope.keyId === options.integrity.keyId &&
          envelope.producer === "ai-flight-deck/observation-receipt") record = envelope.payload;
    } catch (error) {
      failures.push(`Recollect: observation receipt integrity failed (${error.message}).`);
    }
    const recordShapeValid = record && typeof record === "object" && record.binding &&
      typeof record.binding === "object" && record.facts && typeof record.facts === "object" &&
      text(record.id) && /^sha256:[0-9a-f]{64}$/.test(record.sourceDigest) &&
      /^sha256:[0-9a-f]{64}$/.test(record.resultDigest);
    if (record && !recordShapeValid) {
      failures.push("Recollect: the observation receipt has an unsupported or incomplete record structure.");
      record = null;
    }
    if (!record) envelope = null;
  }
  reject(record && text(context?.tenantId) && text(context?.cohort?.id) &&
    text(context?.collectorRunId) && same(record.binding, bindingFor(result, context)) &&
    record.resultDigest === sha256Digest(original) &&
    result.evidenceRefs?.length === 1 && result.evidenceRefs[0].id === record.id &&
    result.evidenceRefs[0].digest === record.sourceDigest.slice(7),
  "Collect supported source observations with a resolving, unmodified evidence record; metadata or a sealed import alone is not proof.");
  if (!record && control.automation === "Attested") {
    failures.push(`Provide a current signed ${control.id} statement with evidence references and data fields: ${
      Object.keys(attestationExamples[control.id] || {}).join(", ")}. Fill the control-specific example in Set up; empty objects cannot close this control.`);
  }
  if (!record && control.automation !== "Attested" &&
      !["AFD-LIC-001", "AFD-LIC-002", "AFD-LIC-004"].includes(control.id)) {
    failures.push(`No source-observation validation contract is implemented for ${control.id}. Retain its reported finding for owner review; connect and validate the required observation path before using it in readiness decisions. Rescanning or sealing an import alone will not close this gap.`);
  }
  if (record) {
    reject(record.facts.outcome === claimedStatus && record.facts.population === result.coverage?.population,
      "The reported decision or coverage contradicts the source-derived facts.");
    const supported = {
      "licence-inventory-v1": ["AFD-LIC-004"],
      "cohort-licence-assignment-v1": ["AFD-LIC-002"],
      "copilot-capacity-v1": ["AFD-LIC-001"]
    };
    if (record.contract === "accountable-statement-v1" && context?.cohort?.id) {
      const att = record.facts.record;
      reject(control.automation === "Attested" && context.cohort.approved === true && options.integrity &&
        verifySignedAttestation(att, { ...options.integrity, now }) &&
        att.domainId === result.domainId && att.tenantId === context.tenantId &&
        att.cohortId === context.cohort.id && att.controlId === control.id &&
        att.attestedAt === result.observedAt && att.expiresAt === result.freshUntil &&
        (claimedStatus === "NotApplicable" ? fieldsForExemption(att) && att.data?.applicablePopulation === 0 :
          attestationDataValid(control.id, att.data, context, now)),
      "Replace the expired, unverified or incomplete accountable statement using this control's evidence-data contract.");
    } else {
      reject(supported[record.contract]?.includes(control.id) && record.acquisitionMode === "LiveGraph",
        "This source/control observation proof path is not implemented; connect a supported evidence contract.");
    }
  }
  reject(Boolean(options.integrity?.key && options.integrity?.keyId),
    "Collect through the local service so the source-derived receipt can be sealed and verified.");
  const accepted = failures.length === 0 && claimedStatus !== "Unknown";
  if (accepted && !envelope) envelope = createEvidenceEnvelope({
    tenant: context.tenantId, producer: "ai-flight-deck/observation-receipt", generatedAt: validatedAt,
    payload: record, ...options.integrity
  });
  const updated = {
    ...original, status: accepted ? claimedStatus : "Unknown",
    authority: {
      schemaVersion: AUTHORITY_VERSION,
      acquisitionMode: record?.acquisitionMode || acquisitions.get(result) ||
        result.provenance?.acquisitionMode || options.acquisitionMode || "Unspecified",
      claimedStatus, validationStatus: accepted ? "Accepted" : "Rejected",
      validatedAt, validator: "ai-flight-deck/bounded-observation-validator",
      evidenceRecord: envelope,
      assumptions: accepted ? [record.acquisitionMode === "SignedAttestation"
        ? "The signature protects an accountable statement; it does not independently prove service settings or the truth of referenced documents."
        : "The receipt binds observations acquired by the configured Graph adapter. It is not Microsoft-signed evidence or proof of effective enforcement."] : [],
      whatWouldChangeDecision: [...new Set(failures)]
    },
    limitations: accepted ? original.limitations : [...original.limitations, {
      code: "EVIDENCE_NOT_ADMISSIBLE",
      description: (failures.join(" ") || "No conclusive observation was reported.").slice(0, 2048)
    }]
  };
  if (accepted) admitValidatedResult(updated, control, record.binding);
  return updated;
}

function validateControlResultsAuthority({ catalog = catalogDefault, controlResults, validatedAt, ...options }) {
  if (!Array.isArray(controlResults)) throw new TypeError("Control results must be an array.");
  const controls = new Map(catalog.domains.flatMap(d => d.controls.map(c => [c.id, c])));
  return controlResults.map(result => {
    const control = controls.get(result?.controlId);
    if (!control) throw new Error(`Cannot validate unknown control '${result?.controlId}'.`);
    return validateControlResultAuthority(result, control, validatedAt, { ...options, catalog });
  });
}

function validateAssessmentAuthority(scan, integrity, now = new Date()) {
  const estate = scan.estateAssessment;
  if (!estate?.controlResults) return scan;
  estate.controlResults = estate.controlResults.map(result => {
    const cohort = estate.cohorts?.find(c => c.id === result.cohortId);
    const control = catalogDefault.domains.flatMap(d => d.controls).find(c => c.id === result.controlId);
    if (!control) throw new Error(`Unknown control '${result.controlId}' in stored assessment.`);
    return validateControlResultAuthority(result, control, now.toISOString(), {
      integrity, context: { tenantId: scan.tenant?.tenantId, actorId: scan.auth?.actor?.id, cohort,
        collectorRunId: estate.collectorRun?.id }
    });
  });
  estate.evaluatedControls = estate.controlResults.filter(r => r.status !== "Unknown").length;
  estate.unknownControls = estate.controlResults.length - estate.evaluatedControls;
  for (const domain of estate.domains || []) {
    const results = estate.controlResults.filter(r => r.domainId === domain.id);
    const accepted = results.filter(r => r.status !== "Unknown").length;
    domain.status = accepted === results.length && results.length ? "Collected" : "Partial";
    domain.summary = `${accepted} of ${results.length} controls have admissible evidence.`;
  }
  estate.collectedDomains = (estate.domains || []).filter(d => d.status === "Collected").length;
  estate.partialDomains = (estate.domains || []).filter(d => d.status === "Partial").length;
  return scan;
}

module.exports = { AUTHORITY_VERSION, captureCollectorEvidence, captureAttestationEvidence,
  attestationDataValid, validateAssessmentAuthority, validateControlResultAuthority, validateControlResultsAuthority };
