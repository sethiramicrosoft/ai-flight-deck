"use strict";

const catalog = require("./schema/readiness-catalog.v1.json");
const { CollectorRegistry } = require("./collector-runtime");
const { createLicensingCollector } = require("./collectors/licensing");
const { createSignedAttestation, applyGenericAttestations } = require("./attestation-evidence");
const { normalizeAdoption } = require("./collectors/operational-domains");
const { captureAttestationEvidence, validateControlResultsAuthority } = require("./evidence-authority");
const fs = require("node:fs");
const path = require("node:path");

const now = new Date("2026-09-08T07:00:00.000Z");
const integrity = { key: Buffer.alloc(32, 42), keyId: "synthetic-test-key" };
const context = { tenantId: "11111111-1111-4111-8111-111111111111",
  actorId: "test-actor", collectorRunId: "test-collector-run", observedAt: now.toISOString(),
  cohort: { id: "pilot", approved: true, principalIds: ["user-1"] } };
const observations = {
  skus: [{ id: "sku-1", skuId: "sku-1", skuPartNumber: "Microsoft_365_Copilot",
    capabilityStatus: "Enabled", consumedUnits: 1, prepaidUnits: { enabled: 10 },
    servicePlans: [{ servicePlanId: "a62f8878-de10-42f3-b68f-6149a25ceb97", servicePlanName: "M365_COPILOT_APPS",
      provisioningStatus: "Success" }] }],
  users: [{ id: "user-1", assignedLicenses: [{ skuId: "sku-1" }],
    assignedPlans: [{ servicePlanId: "a62f8878-de10-42f3-b68f-6149a25ceb97", capabilityStatus: "Enabled" }] }]
};
const definitions = new Map(catalog.domains.flatMap(d => d.controls.map(c => [c.id, c])));
function base(controlId) {
  const domain = catalog.domains.find(d => d.controls.some(c => c.id === controlId));
  const control = definitions.get(controlId);
  return {
    controlId, controlVersion: catalog.catalogVersion, domainId: domain.id, cohortId: context.cohort.id,
    instanceId: `${context.tenantId}:${context.cohort.id}:${controlId}`, requirement: control.requirement,
    status: "Unknown", applicability: { applies: true, reason: control.applicability },
    observedValue: null, expectedValue: control.passCondition, observedAt: context.observedAt,
    freshUntil: new Date(now.getTime() + control.freshnessHours * 3600000).toISOString(),
    coverage: { population: 1, evaluated: 1, excluded: 0, complete: true },
    provenance: { collectorId: "local-signed-attestation", collectorVersion: "1.0.0",
      collectorRunId: context.collectorRunId, tenantId: context.tenantId, actorId: context.actorId,
      source: "Locally sealed accountable attestation" },
    evidenceRefs: [], affectedPrincipals: [], affectedResources: [], limitations: []
  };
}
function validate(results, options = {}) {
  return validateControlResultsAuthority({ catalog, controlResults: results,
    context, integrity, validatedAt: now.toISOString(), ...options });
}
async function licensing({ source = observations, runContext = context, beforeValidate } = {}) {
  const registry = new CollectorRegistry();
  registry.register(createLicensingCollector({ request: async ({ url }) => ({
    value: structuredClone(url.includes("subscribedSkus") ? source.skus : source.users)
  }) }));
  const [execution] = await registry.run({ context: runContext,
    grantedPermissions: ["Directory.Read.All", "Organization.Read.All"] });
  if (execution.status !== "Completed") throw new Error(JSON.stringify(execution.error));
  if (beforeValidate) beforeValidate(execution.controlResults);
  return validate(execution.controlResults, { context: runContext });
}
function attested(controlId = "AFD-IAM-007", data = {
  accountRef: "break-glass-account", owner: "security-owner",
  exclusionEvidenceRef: "review:ca-exclusions", monitoringAlertRef: "review:alert"
}, overrides = {}) {
  const record = createSignedAttestation({
    catalog, ...integrity, now, input: {
      tenantId: context.tenantId, cohortId: context.cohort.id, controlId,
      decision: "Pass", statement: "The accountable owner reviewed the referenced evidence.",
      attestedBy: "test-owner", expiresAt: new Date(now.getTime() + 3600000).toISOString(),
      evidenceReferences: ["review:control-evidence"], data, ...overrides
    }
  });
  let result;
  if (controlId.startsWith("AFD-ADOPT")) {
    result = normalizeAdoption({ observations: { attestations: [record], usageReports: [] }, context })
      .find(r => r.controlId === controlId);
  } else {
    [result] = applyGenericAttestations({ catalog, controlResults: [base(controlId)],
      attestations: [record], tenantId: context.tenantId, cohortId: context.cohort.id,
      ...integrity, now });
  }
  captureAttestationEvidence(result, record, context, definitions.get(controlId), integrity, now);
  return { result: validate([result])[0], record };
}
async function suite() {
  const { collectEstate } = require("./estate-collector-suite");
  const workspace = fs.mkdtempSync(path.join(__dirname, ".authority-suite-"));
  const current = new Date();
  const record = createSignedAttestation({ catalog, ...integrity, now: current, input: {
    tenantId: context.tenantId, cohortId: context.cohort.id, controlId: "AFD-IAM-007",
    decision: "Pass", statement: "Offline fixture reviewed the security evidence.",
    attestedBy: "test-owner", expiresAt: new Date(current.getTime() + 3600000).toISOString(),
    evidenceReferences: ["review:offline"], data: { accountRef: "account", owner: "owner",
      exclusionEvidenceRef: "review:exclusions", monitoringAlertRef: "review:alerts" }
  } });
  fs.writeFileSync(path.join(workspace, "attestations.json"), JSON.stringify({ attestations: [record] }));
  try {
    return await collectEstate({
      rawToken: "synthetic-unused", workspace, attestationIntegrity: integrity,
      scan: { generatedAt: current.toISOString(), tenant: { tenantId: context.tenantId },
        auth: { actor: { id: context.actorId } },
        scope: { grantedScopes: ["Directory.Read.All", "Organization.Read.All"] },
        estateAssessment: { cohorts: [context.cohort],
          domains: catalog.domains.map(d => ({ id: d.id, name: d.name })) } },
      adapters: {
        graphRequest: async ({ url }) => ({ value: structuredClone(url.includes("subscribedSkus")
          ? observations.skus : url.includes("/users") ? observations.users : []) }),
        adminCommand: async () => { throw Object.assign(new Error("Offline command not connected"), { code: "COMMAND_UNAVAILABLE" }); },
        networkProbe: { probe: async () => ({ unavailable: true, reason: "Offline fixture" }) },
        powerPlatformClient: { query: async () => ({ value: [] }) },
        graphReportsClient: { query: async () => ({ value: [] }) },
        attestationStore: { list: async () => [], verify: async () => false }
      }
    });
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}
module.exports = { catalog, now, integrity, context, observations, definitions, base, validate, licensing, attested, suite };
