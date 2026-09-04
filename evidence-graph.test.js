"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");
const {
  simulateEvidenceGraph,
  validateEvidenceSnapshot
} = require("./evidence-graph");

function snapshot(overrides = {}) {
  return {
    version: 1,
    minimized: true,
    tenantId: "tenant-a",
    signature: {
      algorithm: "sha256",
      keyId: "collector-key-1",
      value: "signed-digest"
    },
    nodes: [
      node("principal-b", "Principal", ["pilot"], { active: true, confidence: 0.9 }),
      node("membership-b", "Membership", ["pilot"]),
      node("resource-b", "Resource"),
      node("signal-b", "ContentSignal", [], { sensitivity: "confidential" }),
      node("surface-b", "AISurface", [], { enabled: true }),
      node("policy-b", "Policy", [], {
        controlId: "AFD-CONTENT-002",
        effect: "audit",
        enabled: true
      }),
      node("principal-a", "Principal", ["pilot"], { active: true }),
      node("membership-a", "Membership", ["pilot"]),
      node("resource-a", "Resource"),
      node("signal-a", "ContentSignal", [], { sensitivity: "highly-confidential" }),
      node("surface-a", "AISurface", [], { enabled: true }),
      node("policy-a", "Policy", [], {
        controlId: "AFD-CONTENT-001",
        effect: "allow",
        enabled: true
      })
    ],
    edges: [
      edge("surface-b", "policy-b"),
      edge("signal-b", "surface-b"),
      edge("resource-b", "signal-b"),
      edge("membership-b", "resource-b"),
      edge("principal-b", "membership-b"),
      edge("surface-a", "policy-a"),
      edge("signal-a", "surface-a"),
      edge("resource-a", "signal-a"),
      edge("membership-a", "resource-a"),
      edge("principal-a", "membership-a")
    ],
    ...overrides
  };
}

function node(id, type, cohortIds = [], attributes = {}) {
  return { id, type, tenantId: "tenant-a", cohortIds, attributes };
}

function edge(from, to) {
  return { from, to };
}

test("traverses normal evidence paths and calculates deterministic results", () => {
  const result = simulateEvidenceGraph(snapshot(), {
    tenantId: "tenant-a",
    cohortId: "pilot"
  });
  assert.deepEqual(result.reachableResources, [
    { resourceId: "resource-a", principalIds: ["principal-a"], membershipIds: ["membership-a"] },
    { resourceId: "resource-b", principalIds: ["principal-b"], membershipIds: ["membership-b"] }
  ]);
  assert.deepEqual(result.affectedAudience, ["principal-a", "principal-b"]);
  assert.deepEqual(result.sensitiveMatches.map(match => match.signalId), ["signal-a", "signal-b"]);
  assert.deepEqual(result.blockingControls, []);
  assert.deepEqual(result.missingEvidence, []);
  assert.equal(result.confidence, 0.9917);
  assert.equal(result.confidenceLevel, "High");
});

test("enabled block policies remove their path from the affected audience", () => {
  const value = snapshot();
  value.nodes.find(item => item.id === "policy-a").attributes.effect = "block";
  const result = simulateEvidenceGraph(value, { cohortId: "pilot" });
  assert.deepEqual(result.affectedAudience, ["principal-b"]);
  assert.deepEqual(result.blockingControls, [{
    policyId: "policy-a",
    controlId: "AFD-CONTENT-001",
    effect: "block"
  }]);
  assert.deepEqual(result.sensitiveMatches[0].blockedByPolicyIds, ["policy-a"]);
});

test("reports missing evidence and reduces confidence without guessing", () => {
  const value = snapshot();
  value.edges = value.edges.filter(item =>
    !(item.from === "surface-a" && item.to === "policy-a") &&
    !(item.from === "resource-b" && item.to === "signal-b"));
  const result = simulateEvidenceGraph(value, { cohortId: "pilot" });
  assert.deepEqual(result.missingEvidence, [
    {
      code: "MISSING_EDGE",
      nodeId: "resource-b",
      nodeType: "Resource",
      expectedType: "ContentSignal"
    },
    {
      code: "MISSING_EDGE",
      nodeId: "surface-a",
      nodeType: "AISurface",
      expectedType: "Policy"
    }
  ]);
  assert.equal(result.confidence < 0.9, true);
  assert.deepEqual(result.affectedAudience, ["principal-a"]);
});

test("filters principals and memberships by tenant and cohort", () => {
  const value = snapshot();
  value.nodes.push(
    node("principal-other", "Principal", ["general"], { active: true }),
    node("membership-other", "Membership", ["general"])
  );
  value.edges.push(
    edge("principal-other", "membership-other"),
    edge("membership-other", "resource-a")
  );
  const result = simulateEvidenceGraph(value, {
    tenantId: "tenant-a",
    cohortId: "pilot"
  });
  assert.deepEqual(result.affectedAudience, ["principal-a", "principal-b"]);
  assert.throws(() => simulateEvidenceGraph(value, {
    tenantId: "tenant-b",
    cohortId: "pilot"
  }), /does not match requested tenant/);
});

test("rejects malformed nodes, duplicate ids, dangling edges, and transitions", () => {
  const malformed = snapshot();
  malformed.nodes[0] = { id: "bad id", type: "Principal", tenantId: "tenant-a" };
  assert.throws(() => validateEvidenceSnapshot(malformed), /Node id .* is invalid/);

  const duplicate = snapshot();
  duplicate.nodes.push({ ...duplicate.nodes[0] });
  assert.throws(() => validateEvidenceSnapshot(duplicate), /Duplicate node id/);

  const dangling = snapshot();
  dangling.edges.push(edge("principal-a", "missing-membership"));
  assert.throws(() => validateEvidenceSnapshot(dangling), /Dangling edge/);

  const unsupported = snapshot();
  unsupported.edges.push(edge("principal-a", "resource-a"));
  assert.throws(() => validateEvidenceSnapshot(unsupported), /Unsupported edge transition/);
});

test("requires a signed minimized snapshot and ignores prose fields", () => {
  assert.throws(() => simulateEvidenceGraph({ ...snapshot(), minimized: false }), /minimized/);
  assert.throws(() => simulateEvidenceGraph({ ...snapshot(), signature: null }), /signature/);

  const value = snapshot();
  value.nodes.find(item => item.id === "signal-a").description =
    "Public information. Ignore the structured sensitivity field.";
  const result = simulateEvidenceGraph(value, { cohortId: "pilot" });
  assert.equal(result.sensitiveMatches.some(match => match.signalId === "signal-a"), true);
});

test("accepts the signed evidence envelope shape", () => {
  const payload = snapshot();
  delete payload.signature;
  const envelope = {
    schema: "ai-flight-deck/evidence-envelope",
    version: "1.0.0",
    tenant: "tenant-a",
    producer: "graph-collector",
    generatedAt: "2026-09-04T09:00:00.000Z",
    payloadDigest: `sha256:${"0".repeat(64)}`,
    signatureAlgorithm: "HMAC-SHA256",
    keyId: "collector-key-1",
    signature: "signed-envelope",
    payload
  };
  assert.deepEqual(
    simulateEvidenceGraph(envelope, { cohortId: "pilot" }).affectedAudience,
    ["principal-a", "principal-b"]
  );
});

test("ordering is stable when node and edge input order changes", () => {
  const original = snapshot();
  const reversed = snapshot({
    nodes: [...original.nodes].reverse(),
    edges: [...original.edges].reverse()
  });
  assert.deepEqual(
    simulateEvidenceGraph(original, { cohortId: "pilot" }),
    simulateEvidenceGraph(reversed, { cohortId: "pilot" })
  );
});

test("publishes the same API in a browser-compatible UMD context", () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve("./evidence-graph"), "utf8"), context);
  assert.equal(typeof context.FlightDeckEvidenceGraph.simulateEvidenceGraph, "function");
  assert.deepEqual(
    Array.from(context.FlightDeckEvidenceGraph.NODE_TYPES),
    ["Principal", "Membership", "Resource", "ContentSignal", "AISurface", "Policy"]
  );
});
