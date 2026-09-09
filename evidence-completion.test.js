"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const catalog = require("./schema/readiness-catalog.v1.json");
const {
  buildEvidenceCompletionPlan,
  completeResult
} = require("./evidence-completion");

const now = new Date("2026-09-10T00:00:00.000Z");

test("evidence completion plan classifies every catalog control and prioritizes the current mission", () => {
  const controls = catalog.domains.flatMap(domain => domain.controls);
  const plan = buildEvidenceCompletionPlan({
    catalog,
    now,
    grantedPermissions: [...new Set(controls.flatMap(control =>
      control.requiredPermissions || []))],
    availableLicenses: [...new Set(controls.flatMap(control =>
      control.requiredLicenses || []))]
  });
  assert.equal(plan.controls.length, 77);
  assert.equal(plan.currentMission.order, 1);
  assert.equal(plan.topBlockers.length, 5);
  assert.ok(plan.topBlockers.every(control => control.currentMission));
  assert.ok(plan.controls.some(control => control.state === "SignedAttestationRequired"));
  assert.ok(plan.controls.some(control => control.state === "ObservationValidationRequired"));
  assert.ok(plan.controls.some(control => control.state === "IntegrationRequired"));
  assert.equal(plan.controls.length, Object.values(plan.lanes).flat().filter(item => item.controlId).length);
  assert.deepEqual(plan.lanes.userDecisions.filter(item => item.id).map(item => item.id),
    ["pilotCohort", "hybridExchange", "webGrounding"]);
  for (const [lane, entries] of Object.entries(plan.lanes)) assert.equal(plan.laneCounts[lane], entries.length);
});

test("evidence completion plan uses specific missing permissions before generic adapter states", () => {
  const control = catalog.domains.flatMap(domain => domain.controls)
    .find(item => (item.requiredPermissions || []).length);
  const plan = buildEvidenceCompletionPlan({ catalog, now });
  const planned = plan.controls.find(item => item.controlId === control.id);
  assert.equal(planned.state, "MissingPermission");
  assert.deepEqual(planned.missingPermissions, ["Directory.Read.All", "Organization.Read.All"]);
});

test("only source-admitted pass or signed bounded applicability evidence is complete", async () => {
  const f = require("./authority-test-fixtures");
  const base = {
    freshUntil: "2026-09-11T00:00:00.000Z",
    coverage: { complete: true }
  };
  assert.equal(completeResult({ ...base, status: "Pass" }, now), false);
  const [derived] = await f.licensing();
  assert.equal(completeResult(derived, f.now), true);
  assert.equal(completeResult({
    ...base,
    status: "Pass",
    coverage: { complete: false }
  }, now), false);
  assert.equal(completeResult({
    ...base,
    status: "NotApplicable",
    applicability: {
      applies: false,
      approvedBy: "Program owner",
      expiresAt: "2026-09-11T00:00:00.000Z"
    }
  }, now), false);
  const signed = f.attested("AFD-DEV-005", { applicablePopulation: 0, scopeEvidenceRef: "review:no-byod" },
    { decision: "NotApplicable", reason: "No BYOD", approvedBy: "owner" }).result;
  assert.equal(completeResult(signed, f.now), true);
  assert.equal(completeResult({
    ...base,
    status: "NotApplicable",
    applicability: { applies: false, approvedBy: "Program owner", expiresAt: null }
  }, now), false);
});

test("absent licence inventory is unknown, not evidence of a missing entitlement", () => {
  const control = catalog.domains[0].controls[0];
  const input = { catalog, now, grantedPermissions: ["Directory.Read.All", "Organization.Read.All"] };
  const unknown = buildEvidenceCompletionPlan(input).controls.find(item => item.controlId === control.id);
  assert.equal(unknown.state, "LiveCollectionRequired");
  assert.equal(unknown.licenseInventoryStatus, "NotAssessed");
  assert.deepEqual(unknown.missingLicenses, []);
  const knownEmpty = buildEvidenceCompletionPlan({ ...input, availableLicenses: [] })
    .controls.find(item => item.controlId === control.id);
  assert.equal(knownEmpty.state, "MissingLicense");
  assert.deepEqual(knownEmpty.missingLicenses, control.requiredLicenses);
});

test("completion retains each domain's accountable owner and explains unconnected evidence", () => {
  const plan = buildEvidenceCompletionPlan({ catalog, now });
  for (const domain of catalog.domains) {
    for (const control of domain.controls) {
      assert.equal(plan.controls.find(item => item.controlId === control.id).owner, domain.ownerRoles[0]);
    }
  }
  assert.equal(plan.controls.find(item => item.controlId === "AFD-TEAMS-001").state, "IntegrationRequired");
});

test("observed errors are not mistaken for entitlement gaps merely because they mention licensed users", () => {
  const controls = catalog.domains.flatMap(domain => domain.controls);
  const permissions = [...new Set(controls.flatMap(control => control.requiredPermissions))];
  const result = (controlId, code, description) => ({
    controlId, status: "Unknown", limitations: [{ code, description }]
  });
  const plan = buildEvidenceCompletionPlan({
    catalog, now, grantedPermissions: permissions,
    controlResults: [
      result("AFD-EXO-001", "COMMAND_UNAVAILABLE", "No mailbox inventory for licensed users."),
      result("AFD-LIC-001", "LICENSE_REQUIRED", "Entitlement absent."),
      result("AFD-TEAMS-001", "MISSING_PERMISSION_OR_ROLE", "Teams Administrator role required."),
      result("AFD-COPILOT-003", "CONNECTOR_CONTEXT_MISSING", "Connector governance input missing.")
    ]
  });
  const state = id => plan.controls.find(item => item.controlId === id).state;
  assert.equal(state("AFD-EXO-001"), "IntegrationRequired");
  assert.equal(state("AFD-LIC-001"), "MissingLicense");
  assert.equal(state("AFD-TEAMS-001"), "IntegrationRequired");
  assert.equal(state("AFD-COPILOT-003"), "IntegrationRequired");
});

test("legacy generic permission codes with unavailable command descriptions remain app gaps", () => {
  const cases = [
    ["AFD-PURV-004", "Get-AdminAuditLogConfig: COMMAND_UNAVAILABLE; sign in with the correct role."],
    ["AFD-EXO-002", "Get-HybridConfiguration: ON_PREMISES_SOURCE_UNAVAILABLE; permission required."]
  ];
  const plan = buildEvidenceCompletionPlan({
    catalog, now,
    controlResults: cases.map(([controlId, description]) => ({
      controlId, status: "Unknown",
      limitations: [{ code: "MISSING_PERMISSION_OR_ROLE", description }],
      authority: { whatWouldChangeDecision: ["PERMISSION_DENIED", description] }
    }))
  });
  for (const [id] of cases) {
    const item = plan.controls.find(control => control.controlId === id);
    assert.equal(item.actionLane, "appLimitations");
    assert.match(item.stateLabel, /app cannot confirm|software connection or checking rule/);
    assert.deepEqual(item.missingPermissions, []);
    assert.match(item.warning, /could not identify the cause/);
    assert.doesNotMatch(item.nextAction, /grant|rescan|import/i);
    assert.notEqual(item.effort, "<15 minutes");
  }
  assert.ok(plan.lanes.userDecisions.some(item => item.id === "hybridExchange"));
});

test("structured source codes alone determine denial and capability categories", () => {
  const makePlan = code => buildEvidenceCompletionPlan({
    catalog, now,
    controlResults: [{
      controlId: "AFD-EXO-001", status: "Unknown",
      limitations: [{ code, description: "COMMAND_UNAVAILABLE PERMISSION_DENIED LICENSE_REQUIRED" }],
      authority: { whatWouldChangeDecision: ["CONSENT_REQUIRED"] }
    }]
  }).controls.find(item => item.controlId === "AFD-EXO-001");
  for (const code of ["COMMAND_UNAVAILABLE", "ON_PREMISES_SOURCE_UNAVAILABLE",
    "COMMAND_WARNING", "COMMAND_FAILED", "COMMAND_PARAMETER_BINDING"]) {
    assert.equal(makePlan(code).actionLane, "appLimitations");
  }
  for (const code of ["HTTP_403", "403", "COMMAND_ACCESS_DENIED", "CONSENT_REQUIRED", "AUTH_CONSENT_REQUIRED",
    "AUTHORIZATION_REQUESTDENIED"]) {
    const item = makePlan(code);
    assert.equal(item.actionLane, "administratorActions");
    assert.equal(item.state, "MissingPermission");
    assert.equal(item.status, "Unknown");
    assert.match(item.appBlockedReason, /does not yet have the rules needed/);
    assert.match(item.nextAction, /Restoring read access will not finish/);
    assert.deepEqual(item.missingPermissions, []);
  }
});

test("missing validators and Copilot source paths are app work even with approved local decisions", () => {
  const ids = ["AFD-EXO-001", "AFD-EXO-002", "AFD-COPILOT-001", "AFD-COPILOT-002"];
  const controlResults = ids.map(controlId => ({ controlId, cohortId: "pilot", status: "Unknown" }));
  const cohort = { id: "pilot", approved: true };
  const before = buildEvidenceCompletionPlan({ catalog, now, cohort, controlResults });
  const record = value => ({ value, owner: "owner", rationale: "Reviewed scope", recordedAt: now.toISOString() });
  const after = buildEvidenceCompletionPlan({
    catalog, now, cohort, controlResults,
    decisions: { hybridExchange: record("no"), webGrounding: record("restrict") }
  });
  assert.deepEqual(after.controls, before.controls);
  assert.equal(after.lanes.userDecisions.some(item => item.id), false);
  for (const id of ids) {
    const item = after.controls.find(control => control.controlId === id);
    assert.equal(item.status, "Unknown");
    assert.equal(item.actionLane, "appLimitations");
    assert.match(item.appBlockedReason, /does not yet have the rules needed/);
  }
  assert.equal(after.summary.complete, 0);
  assert.match(after.summary.explanation, /does not mean the Microsoft 365 setting is wrong/);
});

test("only explicit approved cohort and decisive choices remove independent decision tasks", () => {
  for (const cohort of [null, { id: "pilot" }, { id: "pilot", approved: "true" }]) {
    const plan = buildEvidenceCompletionPlan({
      catalog, now, cohort,
      decisions: { hybridExchange: { value: "unknown" }, webGrounding: { value: "undecided" } }
    });
    assert.deepEqual(plan.lanes.userDecisions.filter(item => item.id).map(item => item.id),
      ["pilotCohort", "hybridExchange", "webGrounding"]);
    assert.ok(plan.lanes.userDecisions.filter(item => item.id).every(item =>
      item.title && item.description && item.nextAction && !item.controlId && !item.status));
  }
});

test("expired supported source requires recollection without pretending proof remains current", async () => {
  const f = require("./authority-test-fixtures");
  const [derived] = await f.licensing();
  const plan = buildEvidenceCompletionPlan({ catalog, now: new Date("2027-01-01"), controlResults: [derived] });
  const item = plan.controls.find(control => control.controlId === derived.controlId);
  assert.equal(item.state, "RecollectionRequired");
  assert.equal(item.actionLane, "administratorActions");
  assert.equal(item.status, "Unknown");
  assert.equal(plan.summary.complete, 0);
});

test("catalogue permission hints never prescribe app-only or unrelated Graph privileges", () => {
  const altered = structuredClone(catalog);
  for (const domain of altered.domains) for (const control of domain.controls) {
    control.requiredPermissions = ["Invalid.Permission", "Exchange.ManageAsApp", "AuditLog.Read.All"];
  }
  const plan = buildEvidenceCompletionPlan({ catalog: altered, now });
  assert.ok(plan.controls.every(item => !item.missingPermissions.some(permission =>
    ["Invalid.Permission", "Exchange.ManageAsApp", "AuditLog.Read.All"].includes(permission))));
  for (const id of ["AFD-PURV-004", "AFD-EXO-002"]) {
    assert.equal(plan.controls.find(item => item.controlId === id).actionLane, "appLimitations");
  }
});

test("unclassified causes warn rather than infer a role from prose", () => {
  const plan = buildEvidenceCompletionPlan({
    catalog, now, grantedPermissions: ["Directory.Read.All", "Organization.Read.All"],
    controlResults: [{
      controlId: "AFD-LIC-001", status: "Unknown",
      limitations: [{ code: "SOURCE_QUERY_FAILED", description: "Permission or role might be missing." }]
    }]
  });
  const item = plan.controls.find(control => control.controlId === "AFD-LIC-001");
  assert.notEqual(item.state, "MissingPermission");
  assert.match(item.warning, /not enough information to say an administrator role or permission is missing/);
});

test("only admitted outcomes enter Complete and confirmed configuration lanes", async () => {
  const f = require("./authority-test-fixtures");
  const current = buildEvidenceCompletionPlan({
    catalog, now: f.now, controlResults: await f.licensing(), cohort: f.context.cohort
  });
  assert.ok(current.lanes.complete.length > 0);
  assert.equal(current.lanes.configurationActions.length, 0);
  const source = structuredClone(f.observations);
  source.skus[0].prepaidUnits.enabled = 1;
  const failed = buildEvidenceCompletionPlan({
    catalog, now: f.now, controlResults: await f.licensing({ source }), cohort: f.context.cohort
  });
  const action = failed.lanes.configurationActions.find(item => item.controlId === "AFD-LIC-001");
  assert.equal(action.status, "Fail");
  assert.equal(action.appBlockedReason, null);
  const unverified = buildEvidenceCompletionPlan({
    catalog, now: f.now, controlResults: [{ ...f.base("AFD-EXO-001"), status: "Fail" }]
  });
  assert.equal(unverified.lanes.configurationActions.length, 0);
});
