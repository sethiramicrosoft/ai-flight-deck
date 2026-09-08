"use strict";

const crypto = require("crypto");
const catalog = require("./schema/readiness-catalog.v1.json");
const { CollectorRegistry } = require("./collector-runtime");

const controlIndex = new Map();
for (const domain of catalog.domains) {
  for (const control of domain.controls) {
    controlIndex.set(control.id, { control, domainId: domain.id });
  }
}

function unknownResult(controlId, context, execution) {
  const entry = controlIndex.get(controlId);
  const observedAt = context.observedAt || new Date().toISOString();
  const reason = execution.status === "Unavailable"
    ? execution.unavailableReason ||
      `Missing permissions: ${(execution.missingPermissions || []).join(", ") || "none"}; ` +
      `missing licences: ${(execution.missingLicenses || []).join(", ") || "none"}.`
    : execution.error?.message || `Collector ended with status ${execution.status}.`;
  return {
    controlId,
    controlVersion: catalog.catalogVersion,
    instanceId: `${context.tenantId}:${context.cohort?.id || "tenant-wide"}:${controlId}`,
    domainId: entry.domainId,
    cohortId: context.cohort?.id || "tenant-wide",
    status: "Unknown",
    requirement: entry.control.requirement,
    applicability: { applies: true, reason: entry.control.applicability },
    observedValue: null,
    expectedValue: entry.control.passCondition,
    observedAt,
    freshUntil: new Date(Date.parse(observedAt) + entry.control.freshnessHours * 3600000).toISOString(),
    coverage: {
      population: 0,
      evaluated: 0,
      complete: false,
      excluded: 0,
      reason
    },
    provenance: {
      collectorId: execution.collectorId,
      collectorVersion: execution.collectorVersion,
      collectorRunId: context.collectorRunId,
      tenantId: context.tenantId,
      actorId: context.actorId,
      source: "Collector execution",
      sourceVersion: execution.collectorVersion,
      requestIds: []
    },
    evidenceRefs: [],
    affectedPrincipals: [],
    affectedResources: [],
    owner: null,
    remediation: {
      state: "NotPlanned",
      action: entry.control.remediation,
      packageId: null
    },
    attestation: null,
    limitations: [{
      code: execution.status === "Unavailable" ? "COLLECTOR_UNAVAILABLE" : "COLLECTOR_EXECUTION_FAILED",
      description: reason
    }]
  };
}

function validateCoverage(collectors) {
  const owners = new Map();
  for (const collector of collectors) {
    for (const controlId of collector.controlIds) {
      if (!controlIndex.has(controlId)) {
        throw new Error(`Collector '${collector.id}' declares unknown control '${controlId}'.`);
      }
      if (owners.has(controlId)) {
        throw new Error(
          `Control '${controlId}' is declared by both '${owners.get(controlId)}' and '${collector.id}'.`
        );
      }
      owners.set(controlId, collector.id);
    }
  }
  const missing = [...controlIndex.keys()].filter(controlId => !owners.has(controlId));
  if (missing.length) {
    throw new Error(`No operational collector is registered for: ${missing.join(", ")}.`);
  }
  return owners;
}

async function runEstateCollectors(options = {}) {
  const collectors = options.collectors || [];
  validateCoverage(collectors);
  const context = {
    ...options.context,
    collectorRunId: options.context?.collectorRunId || crypto.randomUUID(),
    observedAt: options.context?.observedAt || new Date().toISOString()
  };
  const registry = new CollectorRegistry();
  collectors.forEach(collector => registry.register(collector));
  const executions = await registry.run({
    context,
    grantedPermissions: options.grantedPermissions || [],
    availableLicenses: options.availableLicenses || [],
    signal: options.signal,
    maxConcurrency: options.maxConcurrency || 3,
    timeoutMs: options.timeoutMs || 120000
  });

  const results = [];
  const emitted = new Map();
  for (const execution of executions) {
    const byControl = new Map(execution.controlResults.map(result => [result.controlId, result]));
    if (byControl.size !== execution.controlResults.length) {
      throw new Error(`Collector '${execution.collectorId}' emitted duplicate control results.`);
    }
    for (const controlId of execution.controlIds) {
      const result = byControl.get(controlId) || unknownResult(controlId, context, execution);
      if (emitted.has(controlId)) {
        throw new Error(`Multiple results were emitted for control '${controlId}'.`);
      }
      emitted.set(controlId, execution.collectorId);
      results.push(result);
    }
  }

  const missing = [...controlIndex.keys()].filter(controlId => !emitted.has(controlId));
  if (missing.length) {
    throw new Error(`Collector execution omitted registered controls: ${missing.join(", ")}.`);
  }
  return {
    collectorRunId: context.collectorRunId,
    observedAt: context.observedAt,
    executions,
    controlResults: results.sort((left, right) => left.controlId.localeCompare(right.controlId))
  };
}

module.exports = {
  runEstateCollectors,
  validateCoverage
};
