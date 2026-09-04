"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const catalog = require("./schema/readiness-catalog.v1.json");
const { runEstateCollectors, validateCoverage } = require("./collector-orchestrator");

function collectorFor(domain, overrides = {}) {
  return {
    id: `test-${domain.id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    version: "1.0.0",
    domainIds: [domain.id],
    controlIds: domain.controls.map(control => control.id),
    requiredPermissions: [],
    requiredLicenses: [],
    async collect() {
      return {};
    },
    async normalize() {
      return [];
    },
    ...overrides
  };
}

test("requires exactly one registered owner for every catalogue control", () => {
  const collectors = catalog.domains.map(domain => collectorFor(domain));
  const owners = validateCoverage(collectors);
  assert.equal(owners.size, 77);
  assert.throws(
    () => validateCoverage(collectors.slice(1)),
    /No operational collector is registered/
  );
  assert.throws(
    () => validateCoverage([...collectors, collectorFor(catalog.domains[0], { id: "duplicate-owner" })]),
    /declared by both/
  );
});

test("emits an explicit Unknown result when a registered collector cannot run", async () => {
  const collectors = catalog.domains.map(domain => collectorFor(domain));
  collectors[0] = collectorFor(catalog.domains[0], {
    requiredPermissions: ["Organization.Read.All"]
  });
  const run = await runEstateCollectors({
    collectors,
    context: {
      tenantId: "tenant-1",
      actorId: "actor-1",
      cohort: { id: "pilot" }
    },
    maxConcurrency: 4
  });
  assert.equal(run.controlResults.length, 77);
  assert.equal(new Set(run.controlResults.map(result => result.controlId)).size, 77);
  assert.equal(run.controlResults.find(result => result.controlId === "AFD-LIC-001").status, "Unknown");
  assert.match(
    run.controlResults.find(result => result.controlId === "AFD-LIC-001").limitations[0].description,
    /Organization.Read.All/
  );
});
