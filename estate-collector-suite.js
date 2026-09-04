"use strict";

const catalog = require("./schema/readiness-catalog.v1.json");
const { runEstateCollectors } = require("./collector-orchestrator");
const {
  createAdminCommandAdapter,
  createAttestationStore,
  createGraphReportsClient,
  createNetworkProbe,
  createPowerPlatformClient,
  graphRequest
} = require("./collector-adapters");
const { createLicensingCollector } = require("./collectors/licensing");
const { createGraphDomainCollectors } = require("./collectors/graph-domains");
const { createGovernanceDomainCollectors } = require("./collectors/governance-domains");
const { createOperationalDomainCollectors } = require("./collectors/operational-domains");

function buildEstateCollectors({ rawToken, workspace, verifyAttestation, adapters = {} }) {
  const request = adapters.graphRequest || graphRequest(rawToken);
  return [
    createLicensingCollector({ request }),
    ...createGraphDomainCollectors({ request }),
    ...createGovernanceDomainCollectors({
      graphRequest: request,
      adminCommand: adapters.adminCommand || createAdminCommandAdapter(workspace)
    }),
    ...createOperationalDomainCollectors({
      networkProbe: adapters.networkProbe || createNetworkProbe(),
      powerPlatformClient: adapters.powerPlatformClient || createPowerPlatformClient(workspace),
      graphReportsClient: adapters.graphReportsClient || createGraphReportsClient(rawToken),
      attestationStore: adapters.attestationStore ||
        createAttestationStore(workspace, verifyAttestation)
    })
  ];
}

function updateEstateAssessment(scan, collection) {
  const results = collection.controlResults;
  const resultsByDomain = new Map(catalog.domains.map(domain => [
    domain.id,
    results.filter(result => result.domainId === domain.id)
  ]));
  const executionsByDomain = new Map(collection.executions.flatMap(execution =>
    execution.domainIds.map(domainId => [domainId, execution])));

  scan.estateAssessment.controlResults = results;
  scan.estateAssessment.totalControls = results.length;
  scan.estateAssessment.evaluatedControls = results
    .filter(result => result.status !== "Unknown").length;
  scan.estateAssessment.unknownControls = results
    .filter(result => result.status === "Unknown").length;
  scan.estateAssessment.domains = scan.estateAssessment.domains.map(domain => {
    const domainResults = resultsByDomain.get(domain.id) || [];
    const unknown = domainResults.filter(result => result.status === "Unknown").length;
    const execution = executionsByDomain.get(domain.id);
    const status = unknown === 0 ? "Collected" : "Partial";
    return {
      ...domain,
      status,
      summary: `${domainResults.length - unknown} of ${domainResults.length} controls evaluated; ` +
        `${unknown} require additional permission, workload connection, or accountable evidence.`,
      nextStep: unknown
        ? "Open the domain controls to resolve each specific evidence limitation."
        : "Review failed and warning controls, then assign remediation owners.",
      collector: execution ? {
        id: execution.collectorId,
        version: execution.collectorVersion,
        status: execution.status,
        requests: execution.requests,
        missingPermissions: execution.missingPermissions,
        missingLicenses: execution.missingLicenses,
        error: execution.error || null
      } : null
    };
  });
  scan.estateAssessment.collectedDomains = scan.estateAssessment.domains
    .filter(domain => domain.status === "Collected").length;
  scan.estateAssessment.partialDomains = scan.estateAssessment.domains
    .filter(domain => domain.status === "Partial").length;
  scan.estateAssessment.collectorRun = {
    id: collection.collectorRunId,
    observedAt: collection.observedAt,
    attemptedDomains: collection.executions.flatMap(execution => execution.domainIds),
    executions: collection.executions.map(execution => ({
      collectorId: execution.collectorId,
      collectorVersion: execution.collectorVersion,
      domainIds: execution.domainIds,
      status: execution.status,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
      requests: execution.requests,
      missingPermissions: execution.missingPermissions,
      missingLicenses: execution.missingLicenses,
      error: execution.error || null
    }))
  };
  return scan;
}

async function inferLicensedCohort(request, existingCohort, signal) {
  if (existingCohort?.principalIds?.length) return existingCohort;
  try {
    const [skuResponse, userResponse] = await Promise.all([
      request({
        url: "https://graph.microsoft.com/v1.0/subscribedSkus?" +
          "$select=id,skuId,skuPartNumber,servicePlans",
        method: "GET",
        signal
      }),
      request({
        url: "https://graph.microsoft.com/v1.0/users?" +
          "$select=id,assignedLicenses&$top=999",
        method: "GET",
        signal
      })
    ]);
    const copilotSkuIds = new Set((skuResponse.value || [])
      .filter(sku =>
        String(sku.skuPartNumber || "").toUpperCase().includes("COPILOT") ||
        (sku.servicePlans || []).some(plan =>
          String(plan.servicePlanName || "").toUpperCase().includes("COPILOT")))
      .flatMap(sku => [sku.skuId, sku.id])
      .filter(Boolean)
      .map(value => String(value).toLowerCase()));
    const principalIds = (userResponse.value || [])
      .filter(user => (user.assignedLicenses || []).some(license =>
        copilotSkuIds.has(String(license.skuId || "").toLowerCase())))
      .map(user => user.id)
      .filter(Boolean)
      .sort();
    if (!principalIds.length) return existingCohort;
    return {
      ...existingCohort,
      id: existingCohort?.id || "copilot-licensed-users",
      name: existingCohort?.name || "Copilot licensed users",
      description: "Automatically discovered licensed population; program-owner approval is still required.",
      approved: existingCohort?.approved === true,
      principalIds,
      population: principalIds.length,
      source: "Microsoft Graph assignedLicenses"
    };
  } catch (error) {
    return {
      ...existingCohort,
      discoveryError: String(error?.message || error)
    };
  }
}

async function collectEstate({
  rawToken,
  workspace,
  scan,
  signal,
  verifyAttestation,
  adapters
}) {
  const collectorAdapters = adapters || {};
  const request = collectorAdapters.graphRequest || graphRequest(rawToken);
  const collectors = buildEstateCollectors({
    rawToken,
    workspace,
    verifyAttestation,
    adapters: { ...collectorAdapters, graphRequest: request }
  });
  const configuredCohort = scan.estateAssessment?.cohorts?.[0] || {
    id: "tenant-wide",
    approved: false,
    principalIds: []
  };
  const cohort = await inferLicensedCohort(request, configuredCohort, signal);
  scan.estateAssessment.cohorts = [cohort];
  const context = {
    tenantId: scan.tenant.tenantId,
    actorId: scan.auth.actor.id,
    observedAt: scan.generatedAt,
    cohort,
    networkLocations: ["scanner-host"]
  };
  const collection = await runEstateCollectors({
    collectors,
    context,
    grantedPermissions: (scan.scope?.grantedScopes || []).map(scope =>
      String(scope).split("/").pop()),
    signal,
    maxConcurrency: 4,
    timeoutMs: 120000
  });
  return updateEstateAssessment(scan, collection);
}

module.exports = {
  buildEstateCollectors,
  collectEstate,
  inferLicensedCohort,
  updateEstateAssessment
};
