"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { CollectorRegistry } = require("../collector-runtime");
const { createLicensingCollector, normalizeLicensing } = require("./licensing");

const context = {
  tenantId: "11111111-1111-1111-1111-111111111111",
  actorId: "admin@example.test",
  collectorRunId: "run-1",
  observedAt: "2026-09-04T10:00:00.000Z",
  cohort: { id: "pilot", approved: true, principalIds: ["user-1"] }
};

function observations() {
  return {
    skus: [{
      id: "sku-1",
      skuId: "copilot-sku",
      skuPartNumber: "MICROSOFT_365_COPILOT",
      capabilityStatus: "Enabled",
      consumedUnits: 1,
      prepaidUnits: { enabled: 10 },
      servicePlans: [{
        servicePlanId: "plan-copilot",
        servicePlanName: "M365_COPILOT",
        provisioningStatus: "Success"
      }]
    }, {
      id: "sku-2",
      skuId: "m365-sku",
      skuPartNumber: "SPE_E5",
      consumedUnits: 1,
      prepaidUnits: { enabled: 10 },
      servicePlans: [
        "EXCHANGE_S_ENTERPRISE",
        "SHAREPOINTENTERPRISE",
        "TEAMS1",
        "ONEDRIVE_BASIC",
        "OFFICE_PROPLUS"
      ].map((servicePlanName, index) => ({
        servicePlanId: `plan-${index}`,
        servicePlanName,
        provisioningStatus: "Success"
      }))
    }],
    users: [{
      id: "user-1",
      assignedLicenses: [{ skuId: "copilot-sku" }, { skuId: "m365-sku" }],
      assignedPlans: [
        "plan-copilot",
        "plan-0",
        "plan-1",
        "plan-2",
        "plan-3",
        "plan-4"
      ].map(servicePlanId => ({ servicePlanId, capabilityStatus: "Enabled" }))
    }]
  };
}

test("normalizes all five licensing controls from real observations", () => {
  const results = normalizeLicensing({
    observations: observations(),
    context: {
      ...context,
      subscriptionRenewals: [{
        subscriptionId: "sku-1",
        expiresAt: "2027-01-01T00:00:00.000Z",
        owner: "billing-owner",
        targetDate: "2026-12-01"
      }]
    }
  });
  assert.deepEqual(results.map(result => result.controlId), [
    "AFD-LIC-001", "AFD-LIC-002", "AFD-LIC-003", "AFD-LIC-004", "AFD-LIC-005"
  ]);
  assert.equal(results.every(result => result.status === "Pass"), true);
});

test("missing approved cohort and renewal evidence remain explicit Unknown", () => {
  const results = normalizeLicensing({
    observations: observations(),
    context: { ...context, cohort: { id: "tenant-wide", approved: false, principalIds: [] } }
  });
  assert.equal(results.find(result => result.controlId === "AFD-LIC-001").status, "Unknown");
  assert.equal(results.find(result => result.controlId === "AFD-LIC-002").status, "Unknown");
  assert.equal(results.find(result => result.controlId === "AFD-LIC-005").status, "Unknown");
  assert.equal(results.find(result => result.controlId === "AFD-LIC-004").status, "Pass");
});

test("collector uses read-only Graph endpoints and follows pagination", async () => {
  const calls = [];
  const collector = createLicensingCollector({
    request: async request => {
      calls.push(request);
      if (request.url.includes("subscribedSkus")) return { value: observations().skus };
      return { value: observations().users };
    }
  });
  const registry = new CollectorRegistry();
  registry.register(collector);
  const [result] = await registry.run({
    context,
    grantedPermissions: ["Directory.Read.All", "Organization.Read.All"]
  });
  assert.equal(result.status, "Completed");
  assert.equal(result.controlResults.length, 5);
  assert.equal(calls.every(call => call.method === "GET"), true);
  assert.equal(calls.some(call => call.url.includes("subscribedSkus") && !call.url.includes("$top")), true);
});
