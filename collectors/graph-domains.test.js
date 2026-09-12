"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const catalog = require("../schema/readiness-catalog.v1.json");
const { RequestBudget } = require("../collector-runtime");
const {
  createGraphDomainCollectors,
  createIdentityAndAccessCollector,
  createServiceHealthOperationsCollector,
  createTeamsReadinessCollector
} = require("./graph-domains");

const targetDomains = [
  "identityAndAccess",
  "devicesAndApps",
  "serviceHealthOperations",
  "teamsReadiness",
  "copilotConfiguration"
];

const context = {
  tenantId: "11111111-1111-1111-1111-111111111111",
  actorId: "reader@example.test",
  collectorRunId: "run-graph-domains",
  observedAt: "2026-09-04T10:00:00.000Z",
  cohort: {
    id: "pilot",
    approved: true,
    groupId: "pilot-group",
    principalIds: ["user-1"]
  }
};

function emptyResponse(url) {
  if (url.includes("identitySecurityDefaultsEnforcementPolicy")) return { isEnabled: false };
  if (url.includes("teamsAppSettings") || url.includes("installationOptions")) return {};
  return { value: [] };
}

async function runCollector(collector, request = async ({ url }) => emptyResponse(url)) {
  const observations = await collector.collect({
    context,
    signal: new AbortController().signal,
    budget: new RequestBudget(collector.maximumRequests)
  });
  return collector.normalize({
    observations,
    context,
    signal: new AbortController().signal
  });
}

test("every requested catalogue control is declared and emitted exactly once", async () => {
  const collectors = createGraphDomainCollectors({ request: async ({ url }) => emptyResponse(url) });
  assert.equal(collectors.length, targetDomains.length);
  for (const collector of collectors) {
    const domain = catalog.domains.find(item => item.id === collector.domainIds[0]);
    const expected = domain.controls.map(control => control.id).sort();
    const results = await runCollector(collector);
    assert.deepEqual(collector.controlIds.slice().sort(), expected);
    assert.deepEqual(results.map(result => result.controlId).sort(), expected);
    assert.equal(new Set(results.map(result => result.controlId)).size, expected.length);
    assert.equal(results.every(result => result.domainId === domain.id), true);
    assert.equal(Array.isArray(collector.endpoints) && collector.endpoints.length > 0, true);
    assert.equal(Array.isArray(collector.requiredPermissions), true);
    assert.equal(Array.isArray(collector.requiredLicenses), true);
  }
});

test("Graph failures become precise Unknown results rather than false Pass", async () => {
  const request = async () => {
    const error = new Error("tenant denied this read");
    error.code = "Authorization_RequestDenied";
    throw error;
  };
  for (const collector of createGraphDomainCollectors({ request })) {
    const results = await runCollector(collector, request);
    assert.equal(results.length, collector.controlIds.length);
    assert.equal(results.every(result => result.status === "Unknown"), true,
      `${collector.id} emitted a non-Unknown result after all reads failed`);
    assert.equal(results.every(result => result.limitations.length > 0), true);
    assert.equal(results.some(result =>
      result.limitations.some(item => item.code === "Authorization_RequestDenied")), true);
  }
});

test("all requests are GET, pagination is followed, and the budget is consumed", async () => {
  const calls = [];
  const collector = createIdentityAndAccessCollector({
    request: async request => {
      calls.push(request);
      if (request.url.includes("/identity/conditionalAccess/policies") && !request.url.includes("page=2")) {
        return {
          value: [],
          "@odata.nextLink": "https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies?page=2"
        };
      }
      return emptyResponse(request.url);
    }
  });
  const budget = new RequestBudget(collector.maximumRequests);
  const observations = await collector.collect({
    context,
    signal: new AbortController().signal,
    budget
  });
  const results = await collector.normalize({
    observations,
    context,
    signal: new AbortController().signal
  });
  assert.equal(results.length, collector.controlIds.length);
  assert.equal(calls.every(call => call.method === "GET"), true);
  assert.equal(calls.every(call => call.headers.Accept === "application/json"), true);
  assert.equal(calls.some(call => call.url.includes("page=2")), true);
  assert.equal(budget.used, calls.length);
});

test("Teams inventory is bounded and deterministically reports controls", async () => {
  const calls = [];
  const teams = Array.from({ length: 205 }, (_, index) => ({
    id: `team-${String(index).padStart(3, "0")}`,
    displayName: `Team ${index}`,
    assignedLabels: [{ labelId: "label-1" }]
  }));
  const collector = createTeamsReadinessCollector({
    request: async request => {
      calls.push(request);
      if (request.url.includes("/groups?")) return { value: teams };
      if (request.url.includes("/channels")) return { value: [] };
      if (request.url.includes("/owners")) return { value: [{ id: "owner-1" }] };
      return emptyResponse(request.url);
    }
  });
  const results = await runCollector(collector);
  assert.deepEqual(results.map(result => result.controlId), [
    "AFD-TEAMS-001",
    "AFD-TEAMS-002",
    "AFD-TEAMS-003",
    "AFD-TEAMS-004",
    "AFD-TEAMS-005",
    "AFD-TEAMS-006"
  ]);
  assert.equal(calls.filter(call => call.url.includes("/channels")).length, 200);
  assert.equal(calls.filter(call => call.url.includes("/owners")).length, 200);
  assert.equal(calls.every(call => call.method === "GET"), true);
});

test("service health blocks only active incidents for Copilot prerequisite services", async () => {
  const collector = createServiceHealthOperationsCollector({
    request: async ({ url }) => {
      if (url.includes("/issues")) {
        return {
          value: [
            {
              id: "blocking-incident",
              service: "Microsoft 365 Copilot",
              title: "Users may be unable to access Copilot",
              classification: "incident",
              status: "investigating"
            },
            {
              id: "resolved-incident",
              service: "Microsoft Teams",
              title: "Resolved Teams incident",
              classification: "incident",
              status: "serviceRestored"
            },
            {
              id: "active-advisory",
              service: "Microsoft 365 suite",
              title: "Informational tenant advisory",
              classification: "advisory",
              status: "investigating"
            },
            {
              id: "unrelated-incident",
              service: "Microsoft Forms",
              title: "Forms incident",
              classification: "incident",
              status: "serviceInterruption"
            }
          ]
        };
      }
      return { value: [] };
    }
  });
  const results = await runCollector(collector);
  const health = results.find(result => result.controlId === "AFD-OPS-001");
  assert.equal(health.status, "Fail");
  assert.equal(health.observedValue.activeBlockingIssues, 1);
  assert.deepEqual(health.affectedResources, ["blocking-incident"]);
});

test("service health passes when only advisories, resolved incidents, or unrelated incidents exist", async () => {
  const collector = createServiceHealthOperationsCollector({
    request: async ({ url }) => {
      if (url.includes("/issues")) {
        return {
          value: [
            {
              id: "active-advisory",
              service: "SharePoint Online",
              classification: "advisory",
              status: "investigating"
            },
            {
              id: "resolved-incident",
              service: "Exchange Online",
              classification: "incident",
              status: "resolved"
            },
            {
              id: "unrelated-incident",
              service: "Microsoft Forms",
              classification: "incident",
              status: "serviceDegradation"
            }
          ]
        };
      }
      return { value: [] };
    }
  });
  const results = await runCollector(collector);
  const health = results.find(result => result.controlId === "AFD-OPS-001");
  assert.equal(health.status, "Pass");
  assert.equal(health.observedValue.activeBlockingIssues, 0);
  assert.deepEqual(health.affectedResources, []);
});

test("an already-aborted signal prevents any request", async () => {
  let called = false;
  const collector = createIdentityAndAccessCollector({
    request: async () => {
      called = true;
      return { value: [] };
    }
  });
  const controller = new AbortController();
  controller.abort(new Error("stop"));
  await assert.rejects(() => collector.collect({
    context,
    signal: controller.signal,
    budget: new RequestBudget(collector.maximumRequests)
  }), /stop/);
  assert.equal(called, false);
});
