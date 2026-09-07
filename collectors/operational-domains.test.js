"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { CollectorRegistry } = require("../collector-runtime");
const catalog = require("../schema/readiness-catalog.v1.json");
const {
  NETWORK_QUERY_PLAN,
  POWER_PLATFORM_QUERY_PLAN,
  createAdoptionMeasurementGovernanceCollector,
  createNetworkConnectivityCollector,
  createOperationalDomainCollectors,
  createPowerPlatformAgentsCollector,
  normalizeAdoption,
  normalizeNetwork,
  normalizePowerPlatform,
  validateControlResult,
  validateSignedAttestation
} = require("./operational-domains");

const context = {
  tenantId: "11111111-1111-1111-1111-111111111111",
  actorId: "admin@example.test",
  collectorRunId: "run-operational",
  observedAt: "2026-09-04T10:00:00.000Z",
  cohort: { id: "pilot", approved: true, principalIds: ["user-1"] }
};

function networkObservations() {
  return NETWORK_QUERY_PLAN.map(request => {
    const common = { ...request, success: true };
    if (request.kind === "dns") return { ...common, resolved: true, addresses: ["192.0.2.1"] };
    if (request.kind === "endpoint") return { ...common, reachable: true, statusCode: 204 };
    if (request.kind === "tls") {
      return { ...common, version: "1.3", intercepted: false, legacyNegotiations: 0 };
    }
    if (request.kind === "latency") return { ...common, p95Ms: 30, maxMs: 45 };
    if (request.kind === "proxy") return { ...common, proxyUsed: false, direct: true };
    if (request.kind === "websocket") return { ...common, reachable: true };
    return { ...common, reachable: true, packetLossPct: 0.2, jitterMs: 5 };
  });
}

function powerObservations() {
  return {
    environments: [{
      id: "env-1", purpose: "Pilot", owner: "owner-1",
      securityGroupId: "group-1", dlpPolicyId: "dlp-1"
    }],
    dlpPolicies: [{
      id: "dlp-1", scope: "tenant", appliesToAll: true,
      connectorGroups: { business: [], nonBusiness: [], blocked: [] }
    }],
    connectors: [{ id: "connector-1", dlpAllowed: true, managed: true }],
    agents: [{
      id: "agent-1",
      businessPurpose: "Support",
      approvalStatus: "Approved",
      identity: "managed-identity",
      connectorIds: ["connector-1"],
      usesSharedCredentials: false,
      usesUnmanagedSecrets: false,
      knowledgeSources: [{
        sensitivityLabel: "Internal", dlpAligned: true, promptInjectionReviewed: true
      }],
      tools: [{ inputBoundary: "ticket", outputBoundary: "draft" }]
    }],
    agentOwners: [{ agentId: "agent-1", ownerId: "owner-1" }],
    agentSharing: [{ agentId: "agent-1", public: false }],
    agentLifecycle: [{ agentId: "agent-1", published: true, approvedBy: "approver-1" }]
  };
}

function attestation(controlId, data, overrides = {}) {
  return {
    id: `att-${controlId}`,
    controlId,
    statement: `Approved evidence for ${controlId}`,
    attestedBy: "governance-owner@example.test",
    attestedAt: "2026-09-04T09:00:00.000Z",
    expiresAt: "2026-10-04T09:00:00.000Z",
    signature: "offline-test-signature",
    keyId: "key-1",
    data,
    ...overrides
  };
}

function adoptionObservations() {
  return {
    usageReports: [{ userPrincipalName: "user-1", reportRefreshDate: "2026-09-03T00:00:00.000Z" }],
    attestations: [
      attestation("AFD-ADOPT-001", {
        useCases: [1, 2, 3].map(id => ({
          id: `use-${id}`, owner: "owner", targetCohort: "pilot",
          expectedOutcome: "time saved", successMetric: "minutes"
        }))
      }),
      attestation("AFD-ADOPT-002", {
        cohorts: [{
          id: "pilot", owner: "owner", groupId: "group-1",
          entryCriteria: "approved", exitCriteria: "reviewed"
        }]
      }),
      attestation("AFD-ADOPT-003", {
        training: { deliveredAt: "2026-08-20T00:00:00.000Z" },
        support: { intake: "queue", owner: "owner", responseTarget: "1 day" }
      }),
      attestation("AFD-ADOPT-004", {
        publishedUseCaseIds: ["use-1"],
        acceptances: [{
          useCaseId: "use-1", champion: "champion",
          expiresAt: "2026-10-01T00:00:00.000Z",
          impactAssessmentUrl: "https://example.test/assessment"
        }]
      }),
      attestation("AFD-ADOPT-005", {
        measures: [{
          id: "usage", owner: "owner", currentValue: 80, target: 70,
          measuredAt: "2026-09-03T00:00:00.000Z"
        }]
      }),
      attestation("AFD-ADOPT-006", {
        reviews: [{
          heldAt: "2026-09-02T00:00:00.000Z",
          driftReviewed: true, decisions: ["continue"]
        }]
      })
    ]
  };
}

test("collector definitions map every catalogue control exactly once", () => {
  const collectors = createOperationalDomainCollectors({
    networkProbe: { probe: async () => ({}) },
    powerPlatformClient: { query: async () => [] },
    graphReportsClient: { query: async () => [] },
    attestationStore: { list: async () => [], verify: async () => true }
  });
  const expected = catalog.domains
    .filter(domain => [
      "networkConnectivity", "powerPlatformAgents", "adoptionMeasurementGovernance"
    ].includes(domain.id))
    .flatMap(domain => domain.controls.map(control => control.id))
    .sort();
  assert.deepEqual(collectors.flatMap(item => item.controlIds).sort(), expected);
  assert.equal(new Set(expected).size, expected.length);
});

test("network normalization emits deterministic passing evidence for all controls", () => {
  const first = normalizeNetwork({ observations: networkObservations(), context });
  const second = normalizeNetwork({
    observations: networkObservations().reverse(),
    context
  });
  assert.deepEqual(first.map(item => item.controlId), [
    "AFD-NET-001", "AFD-NET-002", "AFD-NET-003", "AFD-NET-004", "AFD-NET-005"
  ]);
  assert.equal(first.every(item => item.status === "Pass"), true);
  assert.deepEqual(first, second);
  first.forEach(validateControlResult);
});

test("network evidence distinguishes explicit failure from precise Unknown", () => {
  const failed = networkObservations();
  failed.find(item => item.id === "exchange" && item.kind === "proxy").proxyUsed = true;
  assert.equal(normalizeNetwork({ observations: failed, context })[0].status, "Fail");

  const incomplete = networkObservations().filter(item =>
    !(item.id === "copilot" && item.kind === "dns"));
  const result = normalizeNetwork({ observations: incomplete, context })
    .find(item => item.controlId === "AFD-NET-005");
  assert.equal(result.status, "Unknown");
  assert.equal(result.limitations[0].code, "COPILOT_ENDPOINT_EVIDENCE_MISSING");
});

test("network collector executes only the deterministic injected probe plan", async () => {
  const calls = [];
  const fixture = new Map(networkObservations().map(item => [`${item.id}:${item.kind}`, item]));
  const collector = createNetworkConnectivityCollector({
    networkProbe: {
      async probe(request) {
        calls.push(request);
        return fixture.get(`${request.id}:${request.kind}`);
      }
    },
    operationConcurrency: 2
  });
  const registry = new CollectorRegistry();
  registry.register(collector);
  const [execution] = await registry.run({ context });
  assert.equal(execution.status, "Completed");
  assert.equal(execution.requests, NETWORK_QUERY_PLAN.length);
  assert.deepEqual(calls.map(item => `${item.id}:${item.kind}`).sort(),
    NETWORK_QUERY_PLAN.map(item => `${item.id}:${item.kind}`).sort());
});

test("network request budget is bounded across configured cohort locations", async () => {
  const fixture = new Map(networkObservations().map(item => [`${item.id}:${item.kind}`, item]));
  const collector = createNetworkConnectivityCollector({
    networkProbe: {
      probe: async request => fixture.get(`${request.id}:${request.kind}`)
    },
    maximumLocations: 2
  });
  const registry = new CollectorRegistry();
  registry.register(collector);
  const [execution] = await registry.run({
    context: { ...context, networkLocations: ["Sydney", "Melbourne"] }
  });
  assert.equal(execution.status, "Completed");
  assert.equal(execution.requests, NETWORK_QUERY_PLAN.length * 2);
});

test("Power Platform normalization maps inventory, DLP, owners, sharing and lifecycle", () => {
  const results = normalizePowerPlatform({ observations: powerObservations(), context });
  assert.deepEqual(results.map(item => item.controlId), [
    "AFD-PPA-001", "AFD-PPA-002", "AFD-PPA-003",
    "AFD-PPA-004", "AFD-PPA-005", "AFD-PPA-006"
  ]);
  assert.equal(results.every(item => item.status === "Pass"), true);
  results.forEach(validateControlResult);
});

test("Power Platform collector uses bounded read-only query plans", async () => {
  const calls = [];
  const observations = powerObservations();
  const collector = createPowerPlatformAgentsCollector({
    powerPlatformClient: {
      async query(request) {
        calls.push(request);
        return observations[request.resource];
      }
    }
  });
  const registry = new CollectorRegistry();
  registry.register(collector);
  const [execution] = await registry.run({
    context,
    grantedPermissions: ["PowerPlatformAdmin.Read"]
  });
  assert.equal(execution.status, "Completed");
  assert.equal(execution.controlResults.length, 6);
  assert.equal(calls.every(call => call.method === "GET"), true);
  assert.deepEqual(calls.map(call => call.resource).sort(),
    POWER_PLATFORM_QUERY_PLAN.map(call => call.resource).sort());
});

test("Power Platform missing inventory produces control-specific Unknown", () => {
  const observations = powerObservations();
  observations.agents = [];
  const results = normalizePowerPlatform({ observations, context });
  assert.equal(results.find(item => item.controlId === "AFD-PPA-003").status, "Unknown");
  assert.equal(results.find(item => item.controlId === "AFD-PPA-004").status, "Unknown");
  assert.equal(results.find(item => item.controlId === "AFD-PPA-006")
    .limitations[0].code, "AGENT_PUBLISHING_EVIDENCE_MISSING");
});

test("Power Platform review flags false DLP and injection review assertions", () => {
  const observations = powerObservations();
  observations.agents[0].knowledgeSources[0].promptInjectionReviewed = false;
  const result = normalizePowerPlatform({ observations, context })
    .find(item => item.controlId === "AFD-PPA-005");
  assert.equal(result.status, "Warning");
  assert.deepEqual(result.affectedResources, ["agent-1"]);
});

test("adoption normalization combines reports with valid signed attestations", () => {
  const results = normalizeAdoption({ observations: adoptionObservations(), context });
  assert.deepEqual(results.map(item => item.controlId), [
    "AFD-ADOPT-001", "AFD-ADOPT-002", "AFD-ADOPT-003",
    "AFD-ADOPT-004", "AFD-ADOPT-005", "AFD-ADOPT-006"
  ]);
  assert.equal(results.every(item => item.status === "Pass"), true);
  assert.equal(results.every(item => item.attestation?.attestedBy), true);
  results.forEach(validateControlResult);
});

test("adoption collector rejects invalid records and ignores failed signatures", async () => {
  const observations = adoptionObservations();
  const invalid = { ...observations.attestations[0], signature: "" };
  assert.throws(() => validateSignedAttestation(invalid), /requires signature/);

  const collector = createAdoptionMeasurementGovernanceCollector({
    graphReportsClient: { query: async request => {
      assert.equal(request.method, "GET");
      return observations.usageReports;
    } },
    attestationStore: {
      list: async () => observations.attestations,
      verify: async record => record.controlId !== "AFD-ADOPT-003"
    }
  });
  const registry = new CollectorRegistry();
  registry.register(collector);
  const [execution] = await registry.run({ context });
  assert.equal(execution.status, "Completed");
  const training = execution.controlResults.find(item => item.controlId === "AFD-ADOPT-003");
  assert.equal(training.status, "Unknown");
  assert.equal(training.limitations[0].code, "SIGNED_ATTESTATION_MISSING");
});

test("NotApplicable requires a current signed approver and expiry and respects prohibitions", () => {
  const base = adoptionObservations();
  base.attestations = [
    attestation("AFD-ADOPT-003", {}, {
      decision: "NotApplicable",
      approvedBy: "enablement-owner",
      reason: "Equivalent enablement programme is active."
    }),
    attestation("AFD-ADOPT-004", {}, {
      decision: "NotApplicable",
      approvedBy: "rai-owner",
      reason: "Requested exception."
    }),
    attestation("AFD-ADOPT-005", {}, {
      decision: "NotApplicable",
      approvedBy: "",
      reason: "No reports."
    })
  ];
  const results = normalizeAdoption({ observations: base, context });
  assert.equal(results.find(item => item.controlId === "AFD-ADOPT-003").status, "NotApplicable");
  assert.equal(results.find(item => item.controlId === "AFD-ADOPT-004").status, "Unknown");
  assert.equal(results.find(item => item.controlId === "AFD-ADOPT-005").status, "Unknown");
});

test("missing usage report is a precise Unknown rather than a measurement warning", () => {
  const observations = adoptionObservations();
  observations.usageReports = [];
  const result = normalizeAdoption({ observations, context })
    .find(item => item.controlId === "AFD-ADOPT-005");
  assert.equal(result.status, "Unknown");
  assert.equal(result.limitations[0].code, "COPILOT_USAGE_REPORT_MISSING");
});

test("operation timeout is isolated while cancellation stops the collector", async () => {
  const timeoutCollector = createNetworkConnectivityCollector({
    networkProbe: { probe: async () => new Promise(() => {}) },
    operationTimeoutMs: 5
  });
  const timeoutRegistry = new CollectorRegistry();
  timeoutRegistry.register(timeoutCollector);
  const [timedOut] = await timeoutRegistry.run({ context, timeoutMs: 100 });
  assert.equal(timedOut.status, "Completed");
  assert.equal(timedOut.controlResults.length, 5);
  assert.equal(timedOut.controlResults.every(result => result.status === "Unknown"), true);
  assert.equal(timedOut.controlResults.some(result =>
    result.limitations.some(item => item.code.endsWith("_EVIDENCE_MISSING"))), true);

  const controller = new AbortController();
  const cancelCollector = createNetworkConnectivityCollector({
    networkProbe: {
      probe: async (_request, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      })
    }
  });
  const cancelRegistry = new CollectorRegistry();
  cancelRegistry.register(cancelCollector);
  const pending = cancelRegistry.run({ context, signal: controller.signal });
  await new Promise(resolve => setTimeout(resolve, 5));
  controller.abort(Object.assign(new Error("cancelled"), { code: "COLLECTOR_CANCELLED" }));
  const [cancelled] = await pending;
  assert.equal(cancelled.status, "Cancelled");
});

test("schema validation rejects unapproved NotApplicable results", () => {
  const result = normalizeAdoption({ observations: adoptionObservations(), context })[0];
  assert.throws(() => validateControlResult({
    ...result,
    status: "NotApplicable",
    applicability: { applies: false, reason: "exception" }
  }), /approvedBy/);
});
