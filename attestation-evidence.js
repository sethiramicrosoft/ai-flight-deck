"use strict";

const crypto = require("node:crypto");
const {
  signAttestationRecord,
  verifyAttestationRecord
} = require("./evidence-integrity");

const DECISIONS = new Set(["Pass", "Fail", "Warning", "NotApplicable"]);

function requiredText(value, field, maximum = 4096) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${field} is required.`);
  }
  const normalized = value.trim();
  if (normalized.length > maximum) {
    throw new RangeError(`${field} exceeds ${maximum} characters.`);
  }
  return normalized;
}

function findControl(catalog, controlId) {
  for (const domain of catalog.domains || []) {
    const control = (domain.controls || []).find(item => item.id === controlId);
    if (control) return { domain, control };
  }
  throw new Error(`Unknown readiness control '${controlId}'.`);
}

function createSignedAttestation({ catalog, input, key, keyId, now = new Date() }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Attestation input is required.");
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError("A valid attestation time is required.");
  }
  const { domain, control } = findControl(catalog, requiredText(input.controlId, "controlId", 64));
  if (control.automation !== "Attested") {
    throw new Error(`${control.id} is not an attested control.`);
  }
  const decision = requiredText(input.decision, "decision", 32);
  if (!DECISIONS.has(decision)) throw new Error(`Unsupported attestation decision '${decision}'.`);
  const expiresAt = new Date(input.expiresAt);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now) {
    throw new Error("expiresAt must be a valid future timestamp.");
  }
  const maximumExpiry = now.getTime() + Number(control.freshnessHours) * 3600000;
  if (expiresAt.getTime() > maximumExpiry) {
    throw new Error(
      `expiresAt cannot exceed the ${control.freshnessHours}-hour freshness window for ${control.id}.`
    );
  }
  const data = input.data == null ? {} : input.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new TypeError("data must be a JSON object.");
  }
  const record = {
    id: `att-${crypto.randomUUID()}`,
    tenantId: requiredText(input.tenantId, "tenantId", 128),
    cohortId: requiredText(input.cohortId, "cohortId", 256),
    domainId: domain.id,
    controlId: control.id,
    decision,
    statement: requiredText(input.statement, "statement"),
    attestedBy: requiredText(input.attestedBy, "attestedBy", 256),
    attestedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    keyId: requiredText(keyId, "keyId", 256),
    evidenceReferences: [...new Set((input.evidenceReferences || [])
      .map(value => requiredText(value, "evidence reference", 1024)))].sort(),
    data: JSON.parse(JSON.stringify(data))
  };
  if (decision === "NotApplicable") {
    record.approvedBy = requiredText(input.approvedBy, "approvedBy", 256);
    record.reason = requiredText(input.reason, "reason", 2048);
  }
  return signAttestationRecord(record, key);
}

function verifySignedAttestation(record, { key, keyId, now = new Date() }) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return false;
  if (record.keyId !== keyId || !DECISIONS.has(record.decision)) return false;
  if (!Number.isFinite(Date.parse(record.attestedAt)) ||
      !Number.isFinite(Date.parse(record.expiresAt)) ||
      Date.parse(record.attestedAt) > now.getTime() + 300000 ||
      Date.parse(record.expiresAt) <= Date.parse(record.attestedAt) ||
      Date.parse(record.expiresAt) <= now.getTime()) return false;
  try {
    return verifyAttestationRecord(record, key);
  } catch {
    return false;
  }
}

function applyGenericAttestations({
  catalog,
  controlResults,
  attestations,
  tenantId,
  cohortId,
  key,
  keyId,
  now = new Date()
}) {
  const valid = (attestations || []).filter(record =>
    record.tenantId === tenantId &&
    record.cohortId === cohortId &&
    verifySignedAttestation(record, { key, keyId, now }));
  const latestByControl = new Map();
  for (const record of valid.sort((left, right) =>
    Date.parse(right.attestedAt) - Date.parse(left.attestedAt))) {
    if (!latestByControl.has(record.controlId)) latestByControl.set(record.controlId, record);
  }
  return controlResults.map(result => {
    if (result.status !== "Unknown") return result;
    const { domain, control } = findControl(catalog, result.controlId);
    if (control.automation !== "Attested" || domain.id === "adoptionMeasurementGovernance") {
      return result;
    }
    const record = latestByControl.get(result.controlId);
    if (!record || record.domainId !== domain.id) return result;
    const applicability = record.decision === "NotApplicable"
      ? {
        applies: false,
        reason: record.reason,
        approvedBy: record.approvedBy,
        expiresAt: record.expiresAt
      }
      : { applies: true, reason: control.applicability };
    const { confidence: priorSourceConfidence, ...previous } = result;
    return {
      ...previous,
      status: record.decision,
      applicability,
      observedAt: record.attestedAt,
      freshUntil: record.expiresAt,
      coverage: { population: 1, evaluated: 1, excluded: 0, complete: true },
      provenance: {
        ...result.provenance,
        collectorId: "local-signed-attestation",
        collectorVersion: "1.0.0",
        source: "Locally sealed accountable attestation"
      },
      evidenceRefs: [
        {
          id: `attestation:${record.id}`,
          kind: "signedAttestation",
          etag: null,
          digest: null
        },
        ...record.evidenceReferences.map(reference => ({
          id: reference,
          kind: "attestationReference",
          etag: null,
          digest: null
        }))
      ],
      attestation: {
        statement: record.statement,
        attestedBy: record.attestedBy,
        attestedAt: record.attestedAt,
        expiresAt: record.expiresAt
      },
      observedValue: record.data,
      limitations: []
    };
  });
}

module.exports = {
  applyGenericAttestations,
  createSignedAttestation,
  verifySignedAttestation
};
