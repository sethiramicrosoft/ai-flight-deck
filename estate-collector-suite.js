"use strict";

const fs = require("fs");
const path = require("path");
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
const { applyGenericAttestations } = require("./attestation-evidence");
const { buildEvidenceGraph } = require("./evidence-graph-builder");
const { captureAttestationEvidence, validateControlResultsAuthority } = require("./evidence-authority");

function buildEstateCollectors({
  rawToken,
  workspace,
  verifyAttestation,
  verifyEvidencePackage,
  adapters = {}
}) {
  const request = adapters.graphRequest || graphRequest(rawToken);
  return [
    { ...createLicensingCollector({ request }), acquisitionMode: "LiveGraph" },
    ...createGraphDomainCollectors({ request }).map(c => ({ ...c, acquisitionMode: "LiveGraph" })),
    ...createGovernanceDomainCollectors({
      graphRequest: request,
      adminCommand: adapters.adminCommand || createAdminCommandAdapter(workspace, {
        verifyDocument: doc => verifyEvidencePackage?.("admin", doc) ?? false
      })
    }).map(c => ({ ...c, acquisitionMode: "Unspecified" })),
    ...createOperationalDomainCollectors({
      networkProbe: adapters.networkProbe || createNetworkProbe(),
      powerPlatformClient: adapters.powerPlatformClient || createPowerPlatformClient(workspace, {
        verifyDocument: doc => verifyEvidencePackage?.("powerPlatform", doc) ?? false
      }),
      graphReportsClient: adapters.graphReportsClient || createGraphReportsClient(rawToken),
      attestationStore: adapters.attestationStore ||
        createAttestationStore(workspace, verifyAttestation)
    }).map(c => ({ ...c, acquisitionMode: c.domainIds.includes("networkConnectivity")
      ? "LocalProbe" : c.domainIds.includes("powerPlatformAgents") ? "Imported" : "SignedAttestation" }))
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
    const [skuResponse, users] = await Promise.all([
      request({
        url: "https://graph.microsoft.com/v1.0/subscribedSkus?" +
          "$select=id,skuId,skuPartNumber,servicePlans",
        method: "GET",
        signal
      }),
      listGraphCollection(
        request,
        "https://graph.microsoft.com/v1.0/users?$select=id,assignedLicenses&$top=999",
        signal
      )
    ]);
    const copilotSkuIds = new Set((skuResponse.value || [])
      .filter(sku =>
        String(sku.skuPartNumber || "").toUpperCase().includes("COPILOT") ||
        (sku.servicePlans || []).some(plan =>
          String(plan.servicePlanName || "").toUpperCase().includes("COPILOT")))
      .flatMap(sku => [sku.skuId, sku.id])
      .filter(Boolean)
      .map(value => String(value).toLowerCase()));
    const principalIds = users
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

async function listGraphCollection(request, initialUrl, signal, maxPages = 100) {
  const values = [];
  let url = initialUrl;
  let pages = 0;
  while (url) {
    if (pages >= maxPages) {
      throw new Error(`Microsoft Graph pagination exceeded the ${maxPages}-page safety limit.`);
    }
    const response = await request({ url, method: "GET", signal });
    values.push(...(response.value || []));
    url = response["@odata.nextLink"] || null;
    pages++;
  }
  return values;
}

function loadConfiguredCohort(workspace) {
  const filePath = path.join(workspace, "cohort-config.json");
  if (!fs.existsSync(filePath)) return null;
  const cohort = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Array.isArray(cohort.userPrincipalNames) || !cohort.userPrincipalNames.length) {
    throw new Error("The saved cohort does not contain any user principal names.");
  }
  return cohort;
}

async function resolveConfiguredCohort(request, configuredCohort, signal) {
  const directoryUsers = await listGraphCollection(
    request,
    "https://graph.microsoft.com/v1.0/users?$select=id,userPrincipalName,assignedLicenses&$top=999",
    signal
  );
  const users = new Map(directoryUsers.map(user => [
    String(user.userPrincipalName || "").toLowerCase(),
    user
  ]));
  const requested = configuredCohort.userPrincipalNames
    .map(value => String(value).toLowerCase());
  const resolved = requested.map(userName => users.get(userName)).filter(Boolean);
  const unresolvedUserPrincipalNames = requested.filter(userName => !users.has(userName));
  return {
    ...configuredCohort,
    requestedApproved: configuredCohort.approved === true,
    approved: configuredCohort.approved === true && unresolvedUserPrincipalNames.length === 0,
    principalIds: resolved.map(user => user.id).sort(),
    population: requested.length,
    resolutionComplete: unresolvedUserPrincipalNames.length === 0,
    unresolvedUserPrincipalNames
  };
}

async function collectEstate({
  rawToken,
  workspace,
  scan,
  signal,
  verifyAttestation,
  verifyEvidencePackage,
  attestationIntegrity,
  adapters
}) {
  const collectorAdapters = adapters || {};
  const request = collectorAdapters.graphRequest || graphRequest(rawToken);
  const collectors = buildEstateCollectors({
    rawToken,
    workspace,
    verifyAttestation,
    verifyEvidencePackage,
    adapters: { ...collectorAdapters, graphRequest: request }
  });
  const savedCohort = loadConfiguredCohort(workspace);
  const defaultCohort = scan.estateAssessment?.cohorts?.[0] || {
    id: "tenant-wide",
    approved: false,
    principalIds: []
  };
  const cohort = savedCohort
    ? await resolveConfiguredCohort(request, savedCohort, signal)
    : await inferLicensedCohort(request, defaultCohort, signal);
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
  context.collectorRunId = collection.collectorRunId;
  if (attestationIntegrity?.key && attestationIntegrity?.keyId) {
    const attestationPath = path.join(workspace, "attestations.json");
    const document = fs.existsSync(attestationPath)
      ? JSON.parse(fs.readFileSync(attestationPath, "utf8"))
      : { attestations: [] };
    collection.controlResults = applyGenericAttestations({
      catalog,
      controlResults: collection.controlResults,
      attestations: Array.isArray(document) ? document : document.attestations,
      tenantId: context.tenantId,
      cohortId: context.cohort.id,
      key: attestationIntegrity.key,
      keyId: attestationIntegrity.keyId,
      now: new Date(context.observedAt)
    });
    const records = Array.isArray(document) ? document : document.attestations || [];
    for (const result of collection.controlResults) {
      if (!result.attestation) continue;
      const record = records.find(item =>
        result.evidenceRefs.some(ref => ref.id === `attestation:${item.id}`));
      const control = catalog.domains.flatMap(d => d.controls).find(c => c.id === result.controlId);
      if (record) captureAttestationEvidence(result, record, context, control,
        attestationIntegrity, new Date());
    }
  }
  collection.controlResults = validateControlResultsAuthority({
    catalog,
    controlResults: collection.controlResults,
    validatedAt: new Date().toISOString(),
    context,
    integrity: attestationIntegrity
  });
  const updated = updateEstateAssessment(scan, collection);
  updated.evidenceGraph = buildEvidenceGraph(updated);
  return updated;
}

module.exports = {
  buildEstateCollectors,
  collectEstate,
  inferLicensedCohort,
  loadConfiguredCohort,
  resolveConfiguredCohort,
  updateEstateAssessment
};
