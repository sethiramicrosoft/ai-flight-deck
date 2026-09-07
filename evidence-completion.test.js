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

test("only complete fresh pass or bounded approved not-applicable evidence is complete", () => {
  const base = {
    freshUntil: "2026-09-11T00:00:00.000Z",
    coverage: { complete: true }
  };
  assert.equal(completeResult({ ...base, status: "Pass" }, now), true);
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
  }, now), true);
  assert.equal(completeResult({
    ...base,
    status: "NotApplicable",
    applicability: { applies: false, approvedBy: "Program owner", expiresAt: null }
  }, now), false);
});
