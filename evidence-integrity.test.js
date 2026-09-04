"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  appendControlHistory,
  canonicalStringify,
  createActionPackageBinding,
  createEvidenceEnvelope,
  deriveControlDrift,
  sha256Digest,
  verifyActionPackageBinding,
  verifyControlHistory,
  verifyEvidenceEnvelope
} = require("./evidence-integrity");

const key = "caller-owned-test-key";
const generatedAt = "2026-09-04T09:00:00.000Z";

function evidence(overrides = {}) {
  return createEvidenceEnvelope({
    tenant: "tenant-a",
    producer: "graph-collector",
    generatedAt,
    keyId: "key-2026-09",
    key,
    payload: {
      evidence: [
        { id: "evidence-2", status: "Pass" },
        { id: "evidence-1", status: "Pass" }
      ],
      scanId: "scan-123"
    },
    ...overrides
  });
}

function controlResult(status, value, observedAt, freshUntil) {
  return {
    controlId: "AFD-IAM-001",
    status,
    value,
    observedAt,
    freshUntil
  };
}

test("canonical JSON and SHA-256 are deterministic", () => {
  const left = { b: 2, a: { y: [3, true, null], x: "value" } };
  const right = { a: { x: "value", y: [3, true, null] }, b: 2 };
  assert.equal(canonicalStringify(left), canonicalStringify(right));
  assert.equal(
    sha256Digest({ b: 2, a: 1 }),
    "sha256:43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777"
  );
  assert.throws(() => canonicalStringify({ invalid: undefined }), /does not support/);
});

test("evidence envelopes sign and verify without retaining the key", () => {
  const envelope = evidence();
  assert.equal(envelope.signatureAlgorithm, "HMAC-SHA256");
  assert.equal(envelope.keyId, "key-2026-09");
  assert.equal(Object.values(envelope).includes(key), false);
  assert.equal(verifyEvidenceEnvelope(envelope, key), true);
  assert.throws(() => verifyEvidenceEnvelope(envelope, "wrong-key"), /signature verification failed/);
});

test("evidence verification rejects payload and metadata tampering", () => {
  const payloadTampered = structuredClone(evidence());
  payloadTampered.payload.evidence[0].status = "Fail";
  assert.throws(() => verifyEvidenceEnvelope(payloadTampered, key), /payload digest/);

  const metadataTampered = structuredClone(evidence());
  metadataTampered.tenant = "tenant-b";
  assert.throws(() => verifyEvidenceEnvelope(metadataTampered, key), /signature verification failed/);
});

test("evidence verification rejects incompatible major versions", () => {
  const envelope = evidence();
  envelope.version = "2.0.0";
  assert.throws(() => verifyEvidenceEnvelope(envelope, key), /Incompatible major version/);

  const compatibleMinor = evidence();
  compatibleMinor.version = "1.8.0";
  compatibleMinor.signature = require("node:crypto")
    .createHmac("sha256", key)
    .update(canonicalStringify(Object.fromEntries(
      Object.entries(compatibleMinor).filter(([name]) => name !== "signature")
    )), "utf8")
    .digest("hex");
  assert.equal(verifyEvidenceEnvelope(compatibleMinor, key), true);
});

test("action packages are bound to baseline and selected evidence", () => {
  const baselineDigest = sha256Digest(evidence());
  const binding = createActionPackageBinding({
    baselineDigest,
    selectedEvidenceIds: ["evidence-2", "evidence-1"],
    actionPackage: {
      actionId: "enable-policy",
      parameters: { mode: "report-only" }
    }
  });

  assert.deepEqual(binding.selectedEvidenceIds, ["evidence-1", "evidence-2"]);
  assert.equal(verifyActionPackageBinding(binding, {
    baselineDigest,
    selectedEvidenceIds: ["evidence-1", "evidence-2"]
  }), true);

  const tampered = structuredClone(binding);
  tampered.actionPackage.parameters.mode = "enabled";
  assert.throws(() => verifyActionPackageBinding(tampered), /Action package digest/);
  assert.throws(
    () => verifyActionPackageBinding(binding, { baselineDigest: sha256Digest({ other: true }) }),
    /baseline digest does not match/
  );
});

test("action packages can bind control corrections without evidence references", () => {
  const baselineDigest = sha256Digest(evidence());
  const binding = createActionPackageBinding({
    baselineDigest,
    selectedEvidenceIds: [],
    selectedControlIds: ["AFD-IAM-004", "AFD-IAM-002"],
    actionPackage: {
      requestedActions: [
        { controlId: "AFD-IAM-002" },
        { controlId: "AFD-IAM-004" }
      ]
    }
  });

  assert.deepEqual(binding.selectedEvidenceIds, []);
  assert.deepEqual(binding.selectedControlIds, ["AFD-IAM-002", "AFD-IAM-004"]);
  assert.equal(verifyActionPackageBinding(binding, {
    baselineDigest,
    selectedControlIds: ["AFD-IAM-002", "AFD-IAM-004"]
  }), true);
  assert.throws(
    () => createActionPackageBinding({
      baselineDigest,
      selectedEvidenceIds: [],
      selectedControlIds: [],
      actionPackage: {}
    }),
    /At least one selected evidence or control ID/
  );
});

test("control history is append-only and detects chain tampering", () => {
  const first = controlResult(
    "Pass",
    { enabled: true },
    "2026-09-04T08:00:00.000Z",
    "2026-09-05T08:00:00.000Z"
  );
  const second = controlResult(
    "Fail",
    { enabled: false },
    "2026-09-04T09:00:00.000Z",
    "2026-09-05T09:00:00.000Z"
  );
  const original = [];
  const oneEntry = appendControlHistory(original, first);
  const history = appendControlHistory(oneEntry, second);

  assert.equal(original.length, 0);
  assert.equal(oneEntry.length, 1);
  assert.equal(history[1].sequence, 2);
  assert.equal(history[1].previousDigest, history[0].entryDigest);
  assert.equal(verifyControlHistory(history).valid, true);

  const tampered = structuredClone(history);
  tampered[0].status = "Unknown";
  assert.throws(() => verifyControlHistory(tampered), /entry digest verification failed/);
});

test("per-control drift reports status, freshness, and evidence changes", () => {
  let history = appendControlHistory([], controlResult(
    "Pass",
    { enabled: true },
    "2026-09-04T08:00:00.000Z",
    "2026-09-04T10:00:00.000Z"
  ));
  history = appendControlHistory(history, controlResult(
    "Fail",
    { enabled: false },
    "2026-09-04T09:00:00.000Z",
    "2026-09-04T10:00:00.000Z"
  ));

  assert.deepEqual(deriveControlDrift(history, "2026-09-04T10:00:00.000Z"), {
    controlId: "AFD-IAM-001",
    previousSequence: 1,
    currentSequence: 2,
    statusChanged: true,
    changedStatus: true,
    expired: true,
    evidenceChanged: true,
    drifted: true
  });
});
