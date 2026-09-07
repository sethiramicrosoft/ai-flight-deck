"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const catalog = require("./schema/readiness-catalog.v1.json");
const { evaluateMissions } = require("./mission-engine");

const now = new Date("2026-07-17T12:00:00Z");
const cohort = { id: "pilot", name: "Pilot" };

function result(controlId, status = "Pass", overrides = {}) {
  return {
    controlId,
    cohortId: "pilot",
    status,
    freshUntil: "2026-07-18T12:00:00Z",
    coverage: { population: 1, evaluated: 1, complete: true },
    applicability: { applies: true, reason: "Applies" },
    ...overrides
  };
}

function resultsForMission(missionId) {
  const missionIndex = catalog.missions.findIndex(mission => mission.id === missionId);
  const required = new Set(
    catalog.missions.slice(0, missionIndex + 1).flatMap(mission => mission.requiredControlIds)
  );
  return [...required].map(controlId => result(controlId));
}

test("unknown mandatory evidence blocks the first mission", () => {
  const [{ missions }] = evaluateMissions({
    catalog,
    cohorts: [cohort],
    controlResults: [],
    now
  });
  assert.equal(missions[0].status, "Blocked");
  assert.equal(missions[0].satisfied, false);
  assert.equal(missions[0].blockers.every(blocker => blocker.reason === "Missing"), true);
  assert.equal(missions[1].status, "PredecessorBlocked");
});

test("missions progress only when their controls and predecessors pass", () => {
  const [{ missions }] = evaluateMissions({
    catalog,
    cohorts: [cohort],
    controlResults: resultsForMission("safePilot"),
    now
  });
  assert.equal(missions[0].status, "Eligible");
  assert.equal(missions[1].status, "Eligible");
  assert.equal(missions[2].status, "Blocked");
  assert.equal(missions[3].status, "PredecessorBlocked");
});

test("approved not-applicable gates satisfy a mission until approval expiry", () => {
  const controlResults = resultsForMission("activation");
  controlResults[0] = result(controlResults[0].controlId, "NotApplicable", {
    applicability: {
      applies: false,
      reason: "Approved compensating control",
      approvedBy: "security-owner",
      expiresAt: "2026-07-18T12:00:00Z"
    }
  });
  const [{ missions }] = evaluateMissions({ catalog, cohorts: [cohort], controlResults, now });
  assert.equal(missions[0].status, "Eligible");

  controlResults[0].applicability.expiresAt = "2026-07-16T12:00:00Z";
  const [{ missions: expired }] = evaluateMissions({ catalog, cohorts: [cohort], controlResults, now });
  assert.equal(expired[0].status, "Blocked");
  assert.equal(expired[0].blockers[0].reason, "UnapprovedNotApplicable");
});

test("expired evidence reopens a previously eligible mission", () => {
  const controlResults = resultsForMission("activation");
  controlResults[0].freshUntil = "2026-07-17T11:59:59Z";
  const [{ missions }] = evaluateMissions({ catalog, cohorts: [cohort], controlResults, now });
  assert.equal(missions[0].status, "EvidenceExpired");
  assert.equal(missions[0].satisfied, false);
});

test("pass with incomplete coverage does not satisfy a mission", () => {
  const controlResults = resultsForMission("activation");
  controlResults[0].coverage.complete = false;
  const [{ missions }] = evaluateMissions({ catalog, cohorts: [cohort], controlResults, now });
  assert.equal(missions[0].status, "Blocked");
  assert.equal(missions[0].blockers[0].reason, "IncompleteCoverage");
});

test("not-applicable without a future expiry never satisfies a mission", () => {
  const controlResults = resultsForMission("activation");
  controlResults[0] = result(controlResults[0].controlId, "NotApplicable", {
    applicability: {
      applies: false,
      reason: "Owner decision",
      approvedBy: "security-owner",
      expiresAt: null
    }
  });
  const [{ missions }] = evaluateMissions({ catalog, cohorts: [cohort], controlResults, now });
  assert.equal(missions[0].status, "Blocked");
  assert.equal(missions[0].blockers[0].reason, "UnapprovedNotApplicable");
});

test("duplicate cohort-control results are rejected", () => {
  const duplicate = result(catalog.missions[0].requiredControlIds[0]);
  assert.throws(() => evaluateMissions({
    catalog,
    cohorts: [cohort],
    controlResults: [duplicate, { ...duplicate }],
    now
  }), /Duplicate result/);
});
