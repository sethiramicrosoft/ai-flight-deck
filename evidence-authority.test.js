"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const f = require("./authority-test-fixtures");
const { evaluateControl, hasConclusiveCoverage } = require("./evidence-admissibility");
const { completeResult } = require("./evidence-completion");
const { isSatisfied } = require("./enablement-playbook");
const { attestationDataValid } = require("./evidence-authority");

test("real collector output has resolving receipts, supported passes and conservative unsupported outcomes", async () => {
  const results = await f.licensing();
  for (const id of ["AFD-LIC-001", "AFD-LIC-002", "AFD-LIC-004"]) {
    const r = results.find(r => r.controlId === id);
    assert.equal(r.status, "Pass", JSON.stringify(r.authority));
    assert.equal(r.authority.validationStatus, "Accepted");
    assert.equal(r.authority.acquisitionMode, "LiveGraph");
    assert.equal(r.evidenceRefs[0].id, r.authority.evidenceRecord.payload.id);
    assert.equal(evaluateControl(r, f.now).satisfied, true);
    assert.equal(isSatisfied(r, f.now), true);
    assert.equal(completeResult(r, f.now), true);
    assert.ok(!JSON.stringify(r.authority.evidenceRecord.payload).includes("assignedLicenses"));
  }
  assert.equal(results.find(r => r.controlId === "AFD-LIC-003").status, "Unknown");
});

test("actual capacity checks active subscriptions and unassigned units, not total prepaid units", async () => {
  const source = structuredClone(f.observations);
  source.skus[0].consumedUnits = 10;
  const result = (await f.licensing({ source }))[0];
  assert.equal(result.status, "Fail");
  assert.equal(result.authority.evidenceRecord.payload.facts.availableUnits, 0);
  assert.equal(evaluateControl(result, f.now).admissible, true);
});

test("Copilot branding or a Studio plan cannot establish Microsoft 365 Copilot entitlement", async () => {
  const source = structuredClone(f.observations);
  source.skus[0].skuPartNumber = "COPILOT_STUDIO";
  source.skus[0].servicePlans[0].servicePlanName = "COPILOT_STUDIO_IN_COPILOT_FOR_M365";
  source.skus[0].servicePlans[0].servicePlanId = "fe6c28b3-d468-44ea-bbd0-a10a5167435c";
  source.users[0].assignedPlans[0].servicePlanId = "fe6c28b3-d468-44ea-bbd0-a10a5167435c";
  const results = await f.licensing({ source });
  for (const id of ["AFD-LIC-001", "AFD-LIC-002"]) {
    assert.notEqual(results.find(r => r.controlId === id).status, "Pass");
  }
});

test("metadata, high confidence and fabricated observations do not establish authority", () => {
  const r = { ...f.base("AFD-LIC-001"), status: "Pass", confidence: 1,
    observedValue: { verified: true }, authority: { validationStatus: "Verified" } };
  const [rejected] = f.validate([r]);
  assert.equal(rejected.status, "Unknown");
  assert.equal(rejected.confidence, 1);
  assert.equal(evaluateControl(r, f.now).satisfied, false);
  assert.match(rejected.authority.whatWouldChangeDecision.join(" "), /source observations/);
});

test("signed result serialization alone does not establish in-process admission; service revalidates receipts", async () => {
  const [r] = await f.licensing();
  const clone = structuredClone(r);
  assert.equal(evaluateControl(clone, f.now).reason, "Recollect");
  assert.equal(f.validate([clone])[0].status, "Pass");
  clone.authority.evidenceRecord.signature = "a".repeat(64);
  assert.equal(f.validate([clone])[0].status, "Unknown");
});

test("missing references, backing, observation tampering and forged markers all fail closed", async () => {
  const [original] = await f.licensing();
  for (const change of [
    r => { r.evidenceRefs = []; },
    r => { r.evidenceRefs[0].id = "decorative"; },
    r => { r.authority.evidenceRecord = null; },
    r => { r.observedValue = { enabledUnits: 1000000 }; },
    r => { delete r.authority; },
    r => { r.authority.validationStatus = "Verified"; delete r.authority.evidenceRecord; }
  ]) {
    const r = structuredClone(original); change(r);
    assert.equal(f.validate([r])[0].status, "Unknown");
    assert.equal(evaluateControl(r, f.now).satisfied, false);
  }
});

test("cross tenant/cohort/domain/control/instance/run replay is rejected against trusted context", async () => {
  const [original] = await f.licensing();
  for (const change of [
    r => { r.provenance.tenantId = "22222222-2222-4222-8222-222222222222"; },
    r => { r.cohortId = "other"; },
    r => { r.domainId = "identityAndAccess"; },
    r => { r.controlId = "AFD-LIC-002"; },
    r => { r.instanceId = "foreign-instance"; },
    r => { r.provenance.collectorRunId = "other-run"; }
  ]) {
    const r = structuredClone(original); change(r);
    assert.equal(f.validate([r])[0].status, "Unknown");
  }
  assert.equal(f.validate([original], { context: { ...f.context, collectorRunId: "another-run" } })[0].status, "Unknown");
  assert.equal(f.validate([original], { context: { ...f.context,
    cohort: { ...f.context.cohort, principalIds: ["different-member"] } } })[0].status, "Unknown");
});

test("coverage rejects impossible math, partial enumeration and unapproved exclusions", async () => {
  const [original] = await f.licensing();
  for (const coverage of [
    { population: 1, evaluated: 2, excluded: 0, complete: true },
    { population: 2, evaluated: 1, excluded: 0, complete: true },
    { population: 2, evaluated: 1, excluded: 1, complete: true, reason: "approved" },
    { population: 1, evaluated: 1, excluded: -1, complete: true },
    { population: 1.5, evaluated: 1.5, excluded: 0, complete: true },
    { population: 1, evaluated: 1, excluded: 0, complete: false }
  ]) {
    assert.equal(hasConclusiveCoverage({ coverage }), false);
    assert.equal(f.validate([{ ...original, coverage }])[0].status, "Unknown");
  }
});

test("now-relative freshness rejects expiry, future skew, excessive TTL and contradictory limitations", async () => {
  const [original] = await f.licensing();
  for (const changes of [
    { freshUntil: new Date(f.now.getTime() - 1).toISOString() },
    { observedAt: new Date(f.now.getTime() + 300001).toISOString() },
    { freshUntil: new Date(f.now.getTime() + 1000 * 3600000).toISOString() },
    { limitations: [{ code: "PAGINATION_INCOMPLETE", description: "Only one page was observed." }] }
  ]) assert.equal(f.validate([{ ...original, ...changes }])[0].status, "Unknown");
  assert.equal(evaluateControl(original, new Date(f.now.getTime() + 1000 * 3600000)).satisfied, false);
});

test("accountable statement is admitted only after signature, binding and per-control content checks", () => {
  const { result } = f.attested();
  assert.equal(result.status, "Pass", JSON.stringify(result.authority));
  assert.equal(result.confidence, undefined);
  assert.equal(evaluateControl(result, f.now).satisfied, true);
  assert.equal(f.attested("AFD-IAM-007", {}).result.status, "Unknown");
  assert.equal(f.attested("AFD-IAM-007", { verified: true }).result.status, "Unknown");
  assert.equal(f.attested(undefined, undefined, { evidenceReferences: [] }).result.status, "Unknown");
  assert.equal(f.validate([result], { validatedAt: new Date(f.now.getTime() + 3600001).toISOString() })[0].status, "Unknown");
  const changed = structuredClone(result);
  changed.authority.evidenceRecord.payload.facts.record.signature = "b".repeat(64);
  assert.equal(f.validate([changed])[0].status, "Unknown");
});

test("supported applicability statements cannot bypass the gate using an unsigned NA marker", () => {
  const { result } = f.attested("AFD-DEV-005", { applicablePopulation: 0, scopeEvidenceRef: "review:no-byod" }, {
    decision: "NotApplicable", reason: "No BYOD population", approvedBy: "device-owner"
  });
  assert.equal(result.status, "NotApplicable");
  assert.equal(evaluateControl(result, f.now).satisfied, true);
  const forged = { ...f.base("AFD-DEV-005"), status: "NotApplicable",
    applicability: result.applicability };
  assert.equal(f.validate([forged])[0].status, "Unknown");
  assert.equal(f.attested("AFD-IAM-007", { applicablePopulation: 0, scopeEvidenceRef: "review:none" }, {
    decision: "NotApplicable", reason: "Skip", approvedBy: "owner"
  }).result.status, "Unknown");
});

test("all accountable contracts reject empty data and adoption dates cannot be in the future", () => {
  const controls = f.catalog.domains.flatMap(d => d.controls).filter(c => c.automation === "Attested");
  for (const c of controls) assert.equal(attestationDataValid(c.id, {}, f.context, f.now), false, c.id);
  assert.equal(attestationDataValid("AFD-ADOPT-003", {
    training: { deliveredAt: "2099-01-01T00:00:00Z" },
    support: { intake: "desk", owner: "owner", responseTarget: "1 day" }
  }, f.context, f.now), false);
});

test("every defined attested contract has a working positive signed-evidence path", () => {
  const date = f.now.toISOString();
  const examples = {
    "AFD-IAM-007": { accountRef: "account", owner: "owner", exclusionEvidenceRef: "review:exclusion", monitoringAlertRef: "alert" },
    "AFD-DEV-005": { owner: "owner", policyRef: "policy", conditionalAccessEvidenceRef: "ca", enrollmentRestrictionsEvidenceRef: "intune", settingsMatchPolicy: true },
    "AFD-OPS-004": { owner: "owner", advisoryReviewRef: "review", reviewedAt: date, catalogueUpdated: true },
    "AFD-OPS-005": { technicalContact: "technical", executiveContact: "executive", tenantId: f.context.tenantId, reviewedAt: date },
    "AFD-COPILOT-006": { owner: "owner", decision: "disable feedback", privacyAssessmentRef: "privacy", tenantSettingEvidenceRef: "settings", tenantSettingMatch: true },
    "AFD-PPA-005": { sources: [{ id: "source", sensitivityLabel: "label", dlpAlignment: "review", promptInjectionReview: "review" }], tools: [] },
    "AFD-ADOPT-001": { useCases: [1, 2, 3].map(n => ({ id: `case-${n}`, owner: "owner", targetCohort: "pilot", expectedOutcome: "outcome", successMetric: "metric" })) },
    "AFD-ADOPT-002": { cohorts: [{ id: "pilot", owner: "owner", groupId: "group", entryCriteria: "entry", exitCriteria: "exit" }] },
    "AFD-ADOPT-003": { training: { deliveredAt: date }, support: { intake: "desk", owner: "owner", responseTarget: "1 day" } },
    "AFD-ADOPT-004": { publishedUseCaseIds: ["case-1"], acceptances: [{ useCaseId: "case-1", champion: "owner", impactAssessmentUrl: "https://example.test/assessment", expiresAt: new Date(f.now.getTime() + 3600000).toISOString() }] },
    "AFD-ADOPT-006": { reviews: [{ heldAt: date, driftReviewed: true, decisions: ["retain pilot"] }] }
  };
  assert.equal(Object.keys(examples).length, f.catalog.domains.flatMap(d => d.controls).filter(c => c.automation === "Attested").length);
  for (const [id, data] of Object.entries(examples)) {
    const { result } = f.attested(id, data);
    assert.equal(result.status, "Pass", `${id}: ${JSON.stringify(result.authority)}`);
    assert.equal(evaluateControl(result, f.now).satisfied, true, id);
  }
});

test("missing cohort members, disabled assignments and malformed SKU evidence cannot pass", async () => {
  for (const change of [
    o => { o.users = []; },
    o => { o.users[0].assignedPlans[0].capabilityStatus = "Disabled"; },
    o => { o.skus[0].prepaidUnits.enabled = -1; },
    o => { o.skus[0].consumedUnits = 0.5; }
  ]) {
    const source = structuredClone(f.observations); change(source);
    const results = await f.licensing({ source });
    assert.notEqual(results.find(r => r.controlId === "AFD-LIC-002").status, "Pass");
  }
});

test("all satisfaction readers reject mixed admitted runs rather than combining their passing rows", async () => {
  const first = await f.licensing();
  const second = await f.licensing({ runContext: { ...f.context, collectorRunId: "other-run" } });
  const mixed = [first.find(r => r.controlId === "AFD-LIC-001"), second.find(r => r.controlId === "AFD-LIC-004")];
  const ids = new Set(mixed.map(r => r.controlId));
  const catalog = { ...f.catalog,
    domains: f.catalog.domains.filter(d => d.id === "licensingAndTenantEntitlement")
      .map(d => ({ ...d, controls: d.controls.filter(c => ids.has(c.id)) })),
    missions: [{ id: "check", name: "Check", order: 1, requiredControlIds: [...ids] }] };
  const mission = require("./mission-engine").evaluateMissions({
    catalog, controlResults: mixed, cohorts: [f.context.cohort], now: f.now
  })[0].missions[0];
  assert.equal(mission.satisfiedControls, 0);
  const plan = require("./enablement-playbook").buildTenantPlan({
    catalog, controlResults: mixed, cohortId: "pilot", cohortApproved: true,
    evidenceTrusted: true, now: f.now
  });
  assert.equal(plan.recommendation, "NO-GO");
  assert.equal(plan.summary.complete, 0);
  const completion = require("./evidence-completion").buildEvidenceCompletionPlan({
    catalog, controlResults: mixed, cohort: f.context.cohort, now: f.now
  });
  assert.equal(completion.summary.complete, 0);
});

test("strict draft-2020 schema accepts emitted receipts and rejects invented authority fields", async () => {
  const scan = await f.suite();
  assert.equal(scan.estateAssessment.domains.length, 13);
  assert.equal(scan.estateAssessment.controlResults.length, 77);
  assert.equal(scan.estateAssessment.controlResults.filter(r => r.status === "Pass").length, 4);
  assert.equal(scan.estateAssessment.controlResults.find(r => r.controlId === "AFD-IAM-007").status, "Pass");
  const rows = [...await f.licensing(), f.attested().result, ...scan.estateAssessment.controlResults];
  const code = [
    "import json,sys,pathlib,jsonschema",
    "from referencing import Registry,Resource",
    "root=pathlib.Path(sys.argv[1]); schema=json.loads((root/'control-result.schema.v1.json').read_text())",
    "authority=json.loads((root/'evidence-authority.schema.v2.json').read_text())",
    "registry=Registry().with_resource(authority['$id'],Resource.from_contents(authority))",
    "v=jsonschema.Draft202012Validator(schema,registry=registry,format_checker=jsonschema.FormatChecker())",
    "rows=json.load(sys.stdin)",
    "for row in rows: v.validate(row)",
    "rows[0]['authority']['invented']=True",
    "assert list(v.iter_errors(rows[0])), 'Strict schema accepted unknown authority field'"
  ].join("\n");
  const check = spawnSync("python", ["-c", code, path.join(__dirname, "schema")],
    { input: JSON.stringify(rows), encoding: "utf8" });
  assert.equal(check.status, 0, check.stderr);
});

test("domain telemetry cannot inherit collected counters from legacy or mixed evidence", async () => {
  const { projectAssessment } = require("./evidence-admissibility");
  const rows = await f.licensing();
  const estate = {
    cohorts: [f.context.cohort], controlResults: rows,
    domains: f.catalog.domains.map(d => ({ id: d.id, status: "Collected" })),
    collectedDomains: 13, partialDomains: 0, evaluatedControls: 77
  };
  const projected = projectAssessment(estate, f.catalog, f.now);
  assert.equal(projected.evaluatedControls, 3);
  assert.equal(projected.collectedDomains, 0);
  const legacy = projectAssessment(structuredClone(estate), f.catalog, f.now);
  assert.equal(legacy.evaluatedControls, 0);
  assert.equal(legacy.collectedDomains, 0);
  assert.equal(estate.collectedDomains, 13, "Projection must not rewrite the stored artifact.");
});
