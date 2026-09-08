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
  assert.ok(plan.controls.some(control => control.state === "AdminEvidenceRequired"));
  assert.ok(plan.controls.some(control => control.state === "PowerPlatformEvidenceRequired"));
});

test("evidence completion plan uses specific missing permissions before generic adapter states", () => {
  const control = catalog.domains.flatMap(domain => domain.controls)
    .find(item => (item.requiredPermissions || []).length);
  const plan = buildEvidenceCompletionPlan({ catalog, now });
  const planned = plan.controls.find(item => item.controlId === control.id);
  assert.equal(planned.state, "MissingPermission");
  assert.deepEqual(planned.missingPermissions, control.requiredPermissions);
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
  const input = { catalog, now, grantedPermissions: control.requiredPermissions };
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
  assert.equal(state("AFD-EXO-001"), "AdminEvidenceRequired");
  assert.equal(state("AFD-LIC-001"), "MissingLicense");
  assert.equal(state("AFD-TEAMS-001"), "MissingPermission");
  assert.equal(state("AFD-COPILOT-003"), "IntegrationRequired");
});
