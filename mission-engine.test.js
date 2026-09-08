"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const f = require("./authority-test-fixtures");
const { evaluateMissions, evaluateControl } = require("./mission-engine");
const catalog = { ...f.catalog, missions: [
  { id: "first", order: 1, requiredControlIds: ["AFD-LIC-001", "AFD-LIC-004"] },
  { id: "second", order: 2, requiredControlIds: ["AFD-IAM-007"] },
  { id: "third", order: 3, requiredControlIds: ["AFD-LIC-002"] }
] };
const evaluate = (controlResults, options = {}) => evaluateMissions({
  catalog, cohorts: [f.context.cohort], controlResults, now: f.now,
  tenantId: f.context.tenantId, collectorRunId: f.context.collectorRunId, ...options
})[0].missions;

test("all thirteen domains remain in the real catalogue and missing controls block progression", () => {
  assert.equal(f.catalog.domains.length, 13);
  assert.equal(f.catalog.domains.flatMap(d => d.controls).length, 77);
  const missions = evaluate([], { catalog: f.catalog });
  assert.equal(missions[0].status, "Blocked");
  assert.ok(missions[0].blockers.every(b => b.reason === "Missing"));
  assert.equal(missions[1].status, "PredecessorBlocked");
});

test("missions progress using real derived receipts and verified accountable evidence", async () => {
  const results = await f.licensing();
  let missions = evaluate(results);
  assert.equal(missions[0].status, "Eligible");
  assert.equal(missions[1].status, "Blocked");
  assert.equal(missions[2].status, "PredecessorBlocked");
  missions = evaluate([...results, f.attested().result]);
  assert.ok(missions.every(m => m.status === "Eligible"));
});

test("predecessor-blocked missions explain the predecessor even when own controls are satisfied", async () => {
  const missions = evaluate((await f.licensing()).filter(r => r.controlId !== "AFD-LIC-001"));
  assert.equal(missions[2].blockers.length, 0);
  assert.equal(missions[2].satisfiedControls, 1);
  assert.equal(missions[2].status, "PredecessorBlocked");
  assert.match(missions[2].whatWouldChangeDecision.join(" "), /earlier mission/);
});

test("partial rows and missing confidence never manufacture minimum 100 or zero", async () => {
  const missions = evaluate((await f.licensing()).filter(r => r.controlId === "AFD-LIC-001"));
  assert.equal(missions[0].evidenceQuality.resultsAvailable, 1);
  assert.equal(missions[0].evidenceQuality.missingControls, 1);
  assert.equal(missions[0].evidenceQuality.minimumConfidence, null);
  const all = evaluate([...await f.licensing(), f.attested().result]);
  assert.equal(all[1].evidenceQuality.minimumConfidence, null);
  assert.equal(all[1].evidenceQuality.reportedConfidenceControls, 0);
});

test("expiry reopens eligibility without requiring recollection to change the stored status", async () => {
  const missions = evaluate(await f.licensing(), { now: new Date(f.now.getTime() + 1000 * 3600000) });
  assert.equal(missions[0].status, "EvidenceExpired");
  assert.equal(missions[0].satisfied, false);
});

test("legacy Pass, forged Verified markers and unverified NA never satisfy any mission", () => {
  for (const r of [
    { ...f.base("AFD-LIC-001"), status: "Pass" },
    { ...f.base("AFD-LIC-001"), status: "Pass", authority: { validationStatus: "Verified" } },
    { ...f.base("AFD-LIC-001"), status: "NotApplicable",
      applicability: { applies: false, reason: "skip", approvedBy: "owner", expiresAt: "2099-01-01T00:00:00Z" } }
  ]) {
    assert.equal(evaluateControl(r, f.now).satisfied, false);
    assert.match(evaluate([r])[0].whatWouldChangeDecision.join(" "), /Recollect/);
  }
});

test("modifying admitted evidence or mixing a foreign run invalidates readiness", async () => {
  const results = await f.licensing();
  results[0].coverage.evaluated = 2;
  assert.equal(evaluate(results)[0].satisfied, false);
  const foreign = await f.licensing({ runContext: { ...f.context, collectorRunId: "foreign" } });
  assert.equal(evaluate(foreign)[0].satisfied, false);
});

test("duplicate rows and invalid evaluation inputs fail explicitly", async () => {
  const [r] = await f.licensing();
  assert.throws(() => evaluate([r, r]), /Duplicate/);
  assert.throws(() => evaluate([], { now: new Date("invalid") }), /valid evaluation time/);
  assert.throws(() => evaluate([], { cohorts: [] }), /at least one cohort/);
  assert.throws(() => evaluate([], { catalog: {} }), /valid readiness catalogue/);
});
