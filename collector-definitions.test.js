"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const catalog = require("./schema/readiness-catalog.v1.json");
const { buildCollectorDefinitions } = require("./collector-definitions");
const { buildServicePlans } = require("./consent-broker");

test("collector definitions cover every domain and control exactly once", () => {
  const definitions = buildCollectorDefinitions();
  assert.equal(definitions.length, catalog.domains.length);
  const expectedControls = catalog.domains.flatMap(domain => domain.controls.map(control => control.id)).sort();
  const actualControls = definitions.flatMap(definition =>
    definition.services.flatMap(service => service.controls)
  ).sort();
  assert.deepEqual(actualControls, expectedControls);
  assert.equal(new Set(actualControls).size, expectedControls.length);
});

test("consent plans expose unavailable controls without inventing readiness", () => {
  const plans = buildServicePlans(buildCollectorDefinitions(), {
    authMode: "local-delegated",
    grantedPermissions: ["Directory.Read.All", "Organization.Read.All", "Sites.Read.All"],
    availableLicenses: [],
    assignedAdminRoles: [],
    availableEndpoints: []
  });
  assert.equal(plans.length, catalog.domains.length);
  assert.equal(plans.some(plan => plan.available), false);
  assert.equal(plans.flatMap(plan => plan.unavailableControls).length, 77);
});
