"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const catalog = require("./schema/readiness-catalog.v1.json");
const {
  applyGenericAttestations,
  createSignedAttestation,
  verifySignedAttestation
} = require("./attestation-evidence");

const key = crypto.randomBytes(32);
const keyId = "test-key";
const now = new Date("2026-09-10T00:00:00.000Z");
const attested = catalog.domains.flatMap(domain =>
  domain.controls.map(control => ({ domain, control })))
  .find(item =>
    item.control.automation === "Attested" &&
    item.domain.id !== "adoptionMeasurementGovernance");

function create(overrides = {}) {
  return createSignedAttestation({
    catalog,
    key,
    keyId,
    now,
    input: {
      tenantId: "11111111-1111-1111-1111-111111111111",
      cohortId: "pilot",
      controlId: attested.control.id,
      decision: "Pass",
      statement: "The accountable owner reviewed and approved the required control evidence.",
      attestedBy: "owner@example.test",
      expiresAt: new Date(now.getTime() +
        Math.min(attested.control.freshnessHours, 24) * 3600000).toISOString(),
      evidenceReferences: ["https://example.test/evidence"],
      data: { reviewed: true },
      ...overrides
    }
  });
}

test("creates and verifies a bounded local attestation", () => {
  const record = create();
  assert.equal(record.controlId, attested.control.id);
  assert.equal(verifySignedAttestation(record, { key, keyId, now }), true);
  assert.equal(verifySignedAttestation({ ...record, statement: "tampered" }, {
    key,
    keyId,
    now
  }), false);
});

test("rejects attestations beyond the control freshness window", () => {
  assert.throws(() => create({
    expiresAt: new Date(now.getTime() +
      (attested.control.freshnessHours + 1) * 3600000).toISOString()
  }), /freshness window/);
});

test("applies a verified attestation only to an unknown attested control", () => {
  const record = create();
  const result = {
    controlId: attested.control.id,
    status: "Unknown",
    provenance: {
      collectorId: "source",
      collectorVersion: "1.0.0",
      collectorRunId: "run",
      tenantId: record.tenantId,
      actorId: "actor",
      source: "source"
    },
    limitations: [{ code: "ATTESTATION_MISSING", description: "Missing." }]
  };
  const [applied] = applyGenericAttestations({
    catalog,
    controlResults: [result],
    attestations: [record],
    tenantId: record.tenantId,
    cohortId: record.cohortId,
    key,
    keyId,
    now
  });
  assert.equal(applied.status, "Pass");
  assert.equal(applied.coverage.complete, true);
  assert.equal(applied.attestation.attestedBy, "owner@example.test");
  assert.equal(applied.limitations.length, 0);
});
