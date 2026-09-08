"use strict";

const catalog = require("../schema/readiness-catalog.v1.json");

const VERSION = "1.0.0";
const DOMAINS = Object.freeze(Object.fromEntries(
  ["networkConnectivity", "powerPlatformAgents", "adoptionMeasurementGovernance"]
    .map(id => {
      const domain = catalog.domains.find(item => item.id === id);
      if (!domain) throw new Error(`Readiness catalogue is missing domain '${id}'.`);
      return [id, domain];
    })
));

const NETWORK_QUERY_PLAN = Object.freeze([
  { id: "exchange", role: "optimize", target: "outlook.office.com" },
  { id: "sharepoint", role: "optimize", target: "sharepoint.com" },
  { id: "teams", role: "optimize", target: "teams.microsoft.com" },
  { id: "copilot", role: "copilot", target: "copilot.microsoft.com" },
  { id: "graph", role: "copilot", target: "graph.microsoft.com" }
].flatMap(endpoint => [
  { ...endpoint, kind: "dns" },
  { ...endpoint, kind: "endpoint" },
  { ...endpoint, kind: "tls" },
  { ...endpoint, kind: "latency" },
  { ...endpoint, kind: "proxy" }
]).concat([
  { id: "teams-websocket", role: "media", target: "teams.microsoft.com:443", kind: "websocket" },
  { id: "teams-media", role: "media", target: "teams-media", kind: "media" }
]));

const POWER_PLATFORM_QUERY_PLAN = Object.freeze([
  { resource: "environments", path: "/environments" },
  { resource: "dlpPolicies", path: "/policies/dlp" },
  { resource: "connectors", path: "/connectors" },
  { resource: "agents", path: "/agents" },
  { resource: "agentOwners", path: "/agents/owners" },
  { resource: "agentSharing", path: "/agents/sharing" },
  { resource: "agentLifecycle", path: "/agents/lifecycle" }
]);

const ADOPTION_REPORT_QUERY_PLAN = Object.freeze([
  {
    resource: "copilotUsage",
    path: "/reports/getMicrosoft365CopilotUsageUserDetail(period='D7')"
  }
]);

function abortError(message = "Collector cancelled.") {
  const error = new Error(message);
  error.name = "AbortError";
  error.code = "COLLECTOR_CANCELLED";
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason || abortError();
}

function assertObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object.`);
  }
  return value;
}

function assertArray(value, name) {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
  return value;
}

function asArrayResponse(value, name) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.value)) return value.value;
  if (value && Array.isArray(value.items)) return value.items;
  throw new TypeError(`${name} response must contain an array.`);
}

function iso(value, name) {
  const parsed = Date.parse(value);
  if (typeof value !== "string" || Number.isNaN(parsed)) {
    throw new TypeError(`${name} must be an ISO date-time.`);
  }
  return new Date(parsed).toISOString();
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}

function sorted(items, selector = item => item.id || item.name || "") {
  return [...items].sort((left, right) =>
    String(selector(left) ?? "").localeCompare(String(selector(right) ?? "")));
}

function invokeBounded(operation, { signal, timeoutMs, label }) {
  throwIfAborted(signal);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new RangeError("operationTimeoutMs must be a positive integer.");
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = callback => value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      callback(value);
    };
    const onAbort = () => finish(reject)(signal.reason || abortError());
    const timer = setTimeout(() => {
      const error = new Error(`${label} exceeded its ${timeoutMs} ms operation timeout.`);
      error.code = "COLLECTOR_OPERATION_TIMEOUT";
      finish(reject)(error);
    }, timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    Promise.resolve().then(operation).then(finish(resolve), finish(reject));
  });
}

async function mapBounded(items, concurrency, worker, signal) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
    throw new RangeError("operationConcurrency must be between 1 and 16.");
  }
  const output = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (true) {
      throwIfAborted(signal);
      const index = cursor++;
      if (index >= items.length) return;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return output;
}

function limitation(code, description) {
  return { code, description };
}

function approvedNotApplicable(controlId, records, now) {
  const record = records.find(item =>
    item.controlId === controlId && item.decision === "NotApplicable");
  if (!record) return null;
  const approvedBy = String(record.approvedBy || "").trim();
  const expiresAt = Date.parse(record.expiresAt);
  if (!approvedBy || Number.isNaN(expiresAt) || expiresAt <= now) return null;
  return {
    record,
    applicability: {
      applies: false,
      reason: String(record.reason || record.statement),
      approvedBy,
      expiresAt: new Date(expiresAt).toISOString()
    }
  };
}

function evidenceResult(domainId, collectorId, controlId, status, context, options = {}) {
  const domain = DOMAINS[domainId];
  const control = domain.controls.find(item => item.id === controlId);
  if (!control) throw new Error(`Unknown ${domainId} control '${controlId}'.`);
  const observedAt = iso(context.observedAt || new Date().toISOString(), "context.observedAt");
  const result = {
    controlId,
    controlVersion: catalog.catalogVersion,
    instanceId: `${context.tenantId}:${context.cohort?.id || "tenant-wide"}:${controlId}`,
    domainId,
    cohortId: context.cohort?.id || "tenant-wide",
    status,
    requirement: control.requirement,
    applicability: options.applicability || { applies: true, reason: control.applicability },
    observedValue: options.observedValue ?? null,
    expectedValue: control.passCondition,
    observedAt,
    freshUntil: new Date(Date.parse(observedAt) + control.freshnessHours * 3600000).toISOString(),
    coverage: {
      population: options.population ?? 0,
      evaluated: options.evaluated ?? 0,
      complete: options.complete === true,
      excluded: options.excluded ?? 0,
      reason: options.coverageReason || ""
    },
    ...(options.confidence === undefined ? {} : { confidence: options.confidence }),
    provenance: {
      collectorId,
      collectorVersion: VERSION,
      collectorRunId: context.collectorRunId,
      tenantId: context.tenantId,
      actorId: context.actorId,
      source: options.source || collectorId,
      sourceVersion: options.sourceVersion || VERSION,
      requestIds: sorted(options.requestIds || [], item => item)
    },
    evidenceRefs: sorted(options.evidenceRefs || [], item => item.id),
    affectedPrincipals: sorted(options.affectedPrincipals || [], item => item),
    affectedResources: sorted(options.affectedResources || [], item => item),
    owner: options.owner || null,
    remediation: { state: "NotPlanned", action: control.remediation, packageId: null },
    attestation: options.attestation || null,
    limitations: sorted(options.limitations || [], item => `${item.code}:${item.description}`)
  };
  validateControlResult(result);
  return result;
}

function validateControlResult(result) {
  assertObject(result, "control result");
  const domain = DOMAINS[result.domainId];
  if (!domain || !domain.controls.some(control => control.id === result.controlId)) {
    throw new TypeError(`control result has an invalid controlId '${result.controlId}'.`);
  }
  if (!["Pass", "Fail", "Warning", "Unknown", "NotApplicable"].includes(result.status)) {
    throw new TypeError(`control result '${result.controlId}' has an invalid status.`);
  }
  iso(result.observedAt, "control result observedAt");
  iso(result.freshUntil, "control result freshUntil");
  assertObject(result.applicability, "control result applicability");
  assertObject(result.coverage, "control result coverage");
  assertObject(result.provenance, "control result provenance");
  for (const field of ["evidenceRefs", "affectedPrincipals", "affectedResources", "limitations"]) {
    assertArray(result[field], `control result ${field}`);
  }
  if (result.status === "NotApplicable") {
    if (result.applicability.applies !== false ||
        !String(result.applicability.approvedBy || "").trim() ||
        !result.applicability.expiresAt) {
      throw new TypeError("NotApplicable requires applies=false, approvedBy, and expiresAt.");
    }
    iso(result.applicability.expiresAt, "NotApplicable expiresAt");
  }
  return result;
}

function evidenceAttestation(record) {
  return {
    statement: record.statement,
    attestedBy: record.attestedBy,
    attestedAt: record.attestedAt,
    expiresAt: record.expiresAt
  };
}

function unknown(domainId, collectorId, controlId, context, code, description, options = {}) {
  return evidenceResult(domainId, collectorId, controlId, "Unknown", context, {
    ...options,
    complete: false,
    limitations: [...(options.limitations || []), limitation(code, description)]
  });
}

function allPresent(items, fields) {
  return items.every(item => fields.every(field => {
    const value = item[field];
    return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== "";
  }));
}

async function callAdapter(adapter, request, options) {
  const method = request.kind && typeof adapter[request.kind] === "function"
    ? adapter[request.kind].bind(adapter)
    : typeof adapter.query === "function"
      ? adapter.query.bind(adapter)
      : typeof adapter.probe === "function"
        ? adapter.probe.bind(adapter)
        : null;
  if (!method) throw new TypeError(`Adapter cannot execute '${request.kind || request.resource}'.`);
  return invokeBounded(() => method(request, { signal: options.signal }), {
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    label: request.id || request.resource
  });
}

function networkResultMap(observations) {
  assertArray(observations, "network observations");
  const map = new Map();
  for (const observation of observations) {
    assertObject(observation, "network observation");
    if (!observation.kind || !observation.id) {
      throw new TypeError("network observation requires id and kind.");
    }
    const location = observation.location || "default";
    map.set(`${observation.id}:${observation.kind}:${location}`, {
      ...observation,
      location
    });
  }
  return map;
}

function normalizeNetwork({ observations, context }) {
  const collectorId = "network-assessment";
  const map = networkResultMap(observations);
  const locations = sorted(context.networkLocations?.length
    ? context.networkLocations
    : [...new Set(observations.map(item => item.location || "default"))], item => item);
  const get = (id, kind) => locations.map(location =>
    map.get(`${id}:${kind}:${location}`));
  const controls = [];
  const optimize = NETWORK_QUERY_PLAN.filter(item => item.role === "optimize" && item.kind === "dns");
  const optimizeEvidence = optimize.flatMap(item =>
    ["dns", "endpoint", "tls", "proxy"].flatMap(kind => get(item.id, kind)));
  const missingOptimize = optimizeEvidence.filter(item => !item || item.unavailable === true);
  if (missingOptimize.length) {
    controls.push(unknown("networkConnectivity", collectorId, "AFD-NET-001", context,
      "NETWORK_OPTIMIZE_EVIDENCE_MISSING",
      `Missing ${missingOptimize.length} required DNS, endpoint, TLS, or proxy observations.`));
  } else {
    const failures = optimizeEvidence.filter(item =>
      item.success === false || item.resolved === false || item.reachable === false ||
      item.intercepted === true || item.proxyUsed === true || item.direct === false);
    controls.push(evidenceResult("networkConnectivity", collectorId, "AFD-NET-001",
      failures.length ? "Fail" : "Pass", context, {
        population: optimizeEvidence.length,
        evaluated: optimizeEvidence.length,
        complete: true,
        observedValue: stable(optimizeEvidence),
        affectedResources: failures.map(item => item.target)
      }));
  }

  const websockets = get("teams-websocket", "websocket");
  const media = get("teams-media", "media");
  const missingWebsockets = websockets.filter(item => !item || item.unavailable === true).length;
  const missingMedia = media.filter(item => !item || item.unavailable === true).length;
  if (missingWebsockets || missingMedia) {
    controls.push(unknown("networkConnectivity", collectorId, "AFD-NET-002", context,
      "TEAMS_MEDIA_EVIDENCE_MISSING",
      `Missing ${missingWebsockets} WebSocket and ${missingMedia} media observations.`));
  } else {
    const failed = [...websockets, ...media].filter(item =>
      item.reachable !== true ||
      (item.kind === "media" &&
        (Number(item.packetLossPct) > 1 || Number(item.jitterMs) > 30)));
    controls.push(evidenceResult("networkConnectivity", collectorId, "AFD-NET-002",
      failed.length ? "Fail" : "Pass", context, {
        population: websockets.length + media.length,
        evaluated: websockets.length + media.length,
        complete: true,
        observedValue: stable({ websockets, media }),
        affectedResources: failed.map(item => `${item.location}:${item.target}`)
      }));
  }

  const tls = NETWORK_QUERY_PLAN.filter(item => item.kind === "tls")
    .flatMap(item => get(item.id, "tls"));
  const missingTls = tls.filter(item => !item || item.unavailable === true);
  if (missingTls.length) {
    controls.push(unknown("networkConnectivity", collectorId, "AFD-NET-003", context,
      "TLS_EVIDENCE_MISSING", `Missing TLS negotiation evidence for ${missingTls.length} endpoints.`));
  } else {
    const failed = tls.filter(item => {
      const version = Number(String(item.version || "").replace(/^TLSv?/i, ""));
      return item.success === false || Number.isNaN(version) || version < 1.2 ||
        Number(item.legacyNegotiations || 0) > 0;
    });
    controls.push(evidenceResult("networkConnectivity", collectorId, "AFD-NET-003",
      failed.length ? "Fail" : "Pass", context, {
        population: tls.length, evaluated: tls.length, complete: true,
        observedValue: stable(tls), affectedResources: failed.map(item => item.target)
      }));
  }

  const latency = NETWORK_QUERY_PLAN.filter(item => item.kind === "latency")
    .flatMap(item => get(item.id, "latency"));
  const missingLatency = latency.filter(item =>
    !item || item.unavailable === true ||
    !Number.isFinite(Number(item.p95Ms)) || !Number.isFinite(Number(item.maxMs)));
  if (missingLatency.length) {
    controls.push(unknown("networkConnectivity", collectorId, "AFD-NET-004", context,
      "LATENCY_EVIDENCE_MISSING",
      `Missing valid P95 or maximum latency evidence for ${missingLatency.length} endpoints.`));
  } else {
    const failed = latency.filter(item => Number(item.p95Ms) > 50 || Number(item.maxMs) > 100);
    controls.push(evidenceResult("networkConnectivity", collectorId, "AFD-NET-004",
      failed.length ? "Warning" : "Pass", context, {
        population: latency.length, evaluated: latency.length, complete: true,
        observedValue: stable(latency), affectedResources: failed.map(item => item.target)
      }));
  }

  const copilot = NETWORK_QUERY_PLAN.filter(item =>
    item.role === "copilot" && item.kind === "dns");
  const copilotEvidence = copilot.flatMap(item =>
    ["dns", "endpoint"].flatMap(kind => get(item.id, kind)));
  const missingCopilot = copilotEvidence.filter(item => !item || item.unavailable === true);
  if (missingCopilot.length) {
    controls.push(unknown("networkConnectivity", collectorId, "AFD-NET-005", context,
      "COPILOT_ENDPOINT_EVIDENCE_MISSING",
      `Missing ${missingCopilot.length} required Copilot DNS or endpoint observations.`));
  } else {
    const failures = copilotEvidence.filter(item =>
      item.success === false || item.resolved === false || item.reachable === false);
    controls.push(evidenceResult("networkConnectivity", collectorId, "AFD-NET-005",
      failures.length ? "Fail" : "Pass", context, {
        population: copilotEvidence.length, evaluated: copilotEvidence.length, complete: true,
        observedValue: stable(copilotEvidence), affectedResources: failures.map(item => item.target)
      }));
  }
  return controls.sort((a, b) => a.controlId.localeCompare(b.controlId));
}

function createNetworkConnectivityCollector({
  networkProbe,
  operationConcurrency = 4,
  operationTimeoutMs = 20000,
  maximumLocations = 16
}) {
  if (!networkProbe || typeof networkProbe !== "object") {
    throw new TypeError("An injected networkProbe is required.");
  }
  if (!Number.isInteger(maximumLocations) || maximumLocations < 1 || maximumLocations > 100) {
    throw new RangeError("maximumLocations must be between 1 and 100.");
  }
  return {
    id: "network-assessment",
    version: VERSION,
    domainIds: ["networkConnectivity"],
    controlIds: DOMAINS.networkConnectivity.controls.map(control => control.id),
    requiredPermissions: [],
    requiredLicenses: [],
    maximumRequests: NETWORK_QUERY_PLAN.length * maximumLocations,
    async discoverCapabilities() {
      return { available: true };
    },
    async health({ signal }) {
      throwIfAborted(signal);
      return { healthy: true };
    },
    async collect({ context, signal, budget }) {
      const locations = sorted(context.networkLocations || ["default"], item => item);
      if (!locations.length || locations.length > maximumLocations) {
        throw new RangeError(
          `networkLocations must contain between 1 and ${maximumLocations} locations.`
        );
      }
      const plan = NETWORK_QUERY_PLAN.flatMap(query =>
        locations.map(location => ({ ...query, location })));
      return mapBounded(plan, operationConcurrency, async request => {
        budget.consume();
        try {
          const response = await callAdapter(networkProbe, request, {
            signal, timeoutMs: operationTimeoutMs
          });
          return { ...assertObject(response, `network ${request.kind} response`), ...request };
        } catch (error) {
          if (signal?.aborted) throw error;
          return {
            ...request,
            unavailable: true,
            reason: String(error?.message || error),
            errorCode: String(error?.code || "NETWORK_PROBE_FAILED")
          };
        }
      }, signal);
    },
    async normalize({ observations, context, signal }) {
      throwIfAborted(signal);
      return normalizeNetwork({ observations, context });
    }
  };
}

function indexBy(items, field) {
  return new Map(items.map(item => [String(item[field]), item]));
}

function mergeAgentInventory(observations) {
  const agents = sorted(asArrayResponse(observations.agents, "agents"));
  const ownerByAgent = new Map();
  for (const row of asArrayResponse(observations.agentOwners, "agentOwners")) {
    const key = String(row.agentId);
    const owners = ownerByAgent.get(key) || [];
    owners.push(row.ownerId || row.owner || row);
    ownerByAgent.set(key, owners);
  }
  const sharing = indexBy(asArrayResponse(observations.agentSharing, "agentSharing"), "agentId");
  const lifecycle = indexBy(asArrayResponse(observations.agentLifecycle, "agentLifecycle"), "agentId");
  return agents.map(agent => ({
    ...agent,
    owners: sorted(ownerByAgent.get(String(agent.id)) || agent.owners || [], item =>
      typeof item === "string" ? item : item.id),
    sharing: sharing.get(String(agent.id)) || agent.sharing || null,
    lifecycle: lifecycle.get(String(agent.id)) || agent.lifecycle || null
  }));
}

function normalizePowerPlatform({ observations, context }) {
  assertObject(observations, "Power Platform observations");
  const collectorId = "power-platform";
  const environments = sorted(asArrayResponse(observations.environments, "environments"));
  const policies = sorted(asArrayResponse(observations.dlpPolicies, "dlpPolicies"));
  const connectors = sorted(asArrayResponse(observations.connectors, "connectors"));
  const agents = mergeAgentInventory(observations);
  const results = [];

  if (!policies.length || !environments.length) {
    results.push(unknown("powerPlatformAgents", collectorId, "AFD-PPA-001", context,
      "DLP_BASELINE_EVIDENCE_MISSING",
      "Both environment inventory and DLP policy evidence are required."));
  } else {
    const covered = new Set(policies.flatMap(policy => policy.environmentIds || []));
    const tenantPolicies = policies.filter(policy => policy.scope === "tenant" || policy.tenantScope === true);
    const validClassification = tenantPolicies.some(policy =>
      ["business", "nonBusiness", "blocked"].every(group =>
        Array.isArray(policy.connectorGroups?.[group])));
    const uncovered = environments.filter(environment =>
      !covered.has(environment.id) && !tenantPolicies.some(policy => policy.appliesToAll === true));
    results.push(evidenceResult("powerPlatformAgents", collectorId, "AFD-PPA-001",
      validClassification && !uncovered.length ? "Pass" : "Fail", context, {
        population: environments.length, evaluated: environments.length, complete: true,
        observedValue: {
          tenantPolicyCount: tenantPolicies.length,
          connectorCount: connectors.length,
          uncoveredEnvironmentIds: uncovered.map(item => item.id)
        },
        affectedResources: uncovered.map(item => item.id)
      }));
  }

  if (!environments.length) {
    results.push(unknown("powerPlatformAgents", collectorId, "AFD-PPA-002", context,
      "ENVIRONMENT_INVENTORY_MISSING", "No Power Platform environment inventory was returned."));
  } else {
    const incomplete = environments.filter(item =>
      !allPresent([item], ["purpose", "owner", "securityGroupId", "dlpPolicyId"]));
    results.push(evidenceResult("powerPlatformAgents", collectorId, "AFD-PPA-002",
      incomplete.length ? "Warning" : "Pass", context, {
        population: environments.length, evaluated: environments.length, complete: true,
        observedValue: stable(environments), affectedResources: incomplete.map(item => item.id)
      }));
  }

  if (!agents.length) {
    results.push(unknown("powerPlatformAgents", collectorId, "AFD-PPA-003", context,
      "AGENT_INVENTORY_MISSING",
      "No authoritative Copilot Studio agent inventory was returned."));
  } else {
    const incomplete = agents.filter(agent =>
      !agent.owners.length || !agent.businessPurpose || !agent.approvalStatus);
    results.push(evidenceResult("powerPlatformAgents", collectorId, "AFD-PPA-003",
      incomplete.length ? "Fail" : "Pass", context, {
        population: agents.length, evaluated: agents.length, complete: true,
        observedValue: stable(agents.map(({ id, owners, businessPurpose, approvalStatus }) =>
          ({ id, owners, businessPurpose, approvalStatus }))),
        affectedResources: incomplete.map(item => item.id)
      }));
  }

  if (!agents.length || !connectors.length) {
    results.push(unknown("powerPlatformAgents", collectorId, "AFD-PPA-004", context,
      "AGENT_CONNECTOR_EVIDENCE_MISSING",
      "Agent and connector inventories are both required to evaluate authentication and DLP."));
  } else {
    const connectorById = indexBy(connectors, "id");
    const failed = agents.filter(agent => {
      const used = (agent.connectorIds || []).map(id => connectorById.get(String(id)));
      return !agent.identity || agent.usesSharedCredentials === true ||
        agent.usesUnmanagedSecrets === true || used.some(connector =>
          !connector || connector.dlpAllowed !== true || connector.managed !== true);
    });
    results.push(evidenceResult("powerPlatformAgents", collectorId, "AFD-PPA-004",
      failed.length ? "Fail" : "Pass", context, {
        population: agents.length, evaluated: agents.length, complete: true,
        observedValue: { nonCompliantAgentIds: failed.map(item => item.id) },
        affectedResources: failed.map(item => item.id)
      }));
  }

  if (!agents.length) {
    results.push(unknown("powerPlatformAgents", collectorId, "AFD-PPA-005", context,
      "AGENT_REVIEW_EVIDENCE_MISSING",
      "No agent records were available for knowledge source and tool review."));
  } else {
    const failed = agents.filter(agent =>
      !(agent.knowledgeSources || []).every(source =>
        allPresent([source], ["sensitivityLabel"]) &&
        source.dlpAligned === true && source.promptInjectionReviewed === true) ||
      !(agent.tools || []).every(tool => allPresent([tool], ["inputBoundary", "outputBoundary"])));
    results.push(evidenceResult("powerPlatformAgents", collectorId, "AFD-PPA-005",
      failed.length ? "Warning" : "Pass", context, {
        population: agents.length, evaluated: agents.length, complete: true,
        observedValue: { agentsMissingReviews: failed.map(item => item.id) },
        affectedResources: failed.map(item => item.id)
      }));
  }

  if (!agents.length) {
    results.push(unknown("powerPlatformAgents", collectorId, "AFD-PPA-006", context,
      "AGENT_PUBLISHING_EVIDENCE_MISSING",
      "No agent publishing or sharing records were available."));
  } else {
    const failed = agents.filter(agent => {
      const published = agent.lifecycle?.published === true || agent.published === true;
      const isPublic = agent.sharing?.public === true || agent.public === true;
      const approval = agent.lifecycle?.approvedBy || agent.publishingApprovedBy;
      return published && (!approval || (isPublic && !approval));
    });
    results.push(evidenceResult("powerPlatformAgents", collectorId, "AFD-PPA-006",
      failed.length ? "Fail" : "Pass", context, {
        population: agents.length, evaluated: agents.length, complete: true,
        observedValue: { unapprovedPublishedAgentIds: failed.map(item => item.id) },
        affectedResources: failed.map(item => item.id)
      }));
  }
  return results.sort((a, b) => a.controlId.localeCompare(b.controlId));
}

function createPowerPlatformAgentsCollector({
  powerPlatformClient,
  operationConcurrency = 3,
  operationTimeoutMs = 10000
}) {
  if (!powerPlatformClient || typeof powerPlatformClient !== "object") {
    throw new TypeError("An injected powerPlatformClient is required.");
  }
  return {
    id: "power-platform",
    version: VERSION,
    domainIds: ["powerPlatformAgents"],
    controlIds: DOMAINS.powerPlatformAgents.controls.map(control => control.id),
    requiredPermissions: [],
    requiredLicenses: [],
    maximumRequests: POWER_PLATFORM_QUERY_PLAN.length,
    async discoverCapabilities() {
      return { available: true };
    },
    async health({ signal }) {
      throwIfAborted(signal);
      return { healthy: true };
    },
    async collect({ context, signal, budget }) {
      const responses = await mapBounded(POWER_PLATFORM_QUERY_PLAN, operationConcurrency,
        async request => {
          budget.consume();
          let response;
          try {
            response = await callAdapter(powerPlatformClient, {
              ...request, kind: request.resource, method: "GET", tenantId: context.tenantId
            }, { signal, timeoutMs: operationTimeoutMs });
          } catch (error) {
            if (signal?.aborted || error?.code === "COLLECTOR_OPERATION_TIMEOUT") throw error;
            response = { value: [], unavailable: true, reason: String(error?.message || error) };
          }
          return [request.resource, response];
        }, signal);
      return Object.fromEntries(responses);
    },
    async normalize({ observations, context, signal }) {
      throwIfAborted(signal);
      return normalizePowerPlatform({ observations, context });
    }
  };
}

function validateSignedAttestation(record) {
  assertObject(record, "attestation");
  for (const field of ["id", "controlId", "statement", "attestedBy", "attestedAt",
    "expiresAt", "signature", "keyId"]) {
    if (typeof record[field] !== "string" || !record[field].trim()) {
      throw new TypeError(`attestation '${record.id || "unknown"}' requires ${field}.`);
    }
  }
  iso(record.attestedAt, "attestation attestedAt");
  iso(record.expiresAt, "attestation expiresAt");
  if (!DOMAINS.adoptionMeasurementGovernance.controls.some(
    control => control.id === record.controlId)) {
    throw new TypeError(`attestation '${record.id}' has an invalid adoption controlId.`);
  }
  assertObject(record.data || {}, "attestation data");
  return record;
}

function currentAttestation(records, controlId, now) {
  return records
    .filter(record => record.controlId === controlId && Date.parse(record.expiresAt) > now)
    .sort((left, right) => Date.parse(right.attestedAt) - Date.parse(left.attestedAt))[0] || null;
}

function attestedResult(controlId, record, context, status, observedValue, options = {}) {
  return evidenceResult("adoptionMeasurementGovernance", "adoption-attestation",
    controlId, status, context, {
      population: options.population ?? 1,
      evaluated: options.evaluated ?? 1,
      complete: true,
      source: "Validated signed attestation store",
      observedValue: stable(observedValue),
      evidenceRefs: [{
        id: `attestation:${record.id}`,
        kind: "signedAttestation",
        etag: null,
        digest: null
      }],
      attestation: evidenceAttestation(record),
      affectedPrincipals: options.affectedPrincipals || [],
      affectedResources: options.affectedResources || []
    });
}

function normalizeAdoption({ observations, context }) {
  assertObject(observations, "adoption observations");
  const records = sorted(assertArray(observations.attestations, "attestations"),
    record => `${record.controlId}:${record.id}`);
  const now = Date.parse(context.observedAt || new Date().toISOString());
  const results = [];
  const recordFor = controlId => currentAttestation(records, controlId, now);
  const notApplicableAllowed = new Set(["AFD-ADOPT-002", "AFD-ADOPT-003", "AFD-ADOPT-005"]);

  for (const controlId of DOMAINS.adoptionMeasurementGovernance.controls.map(item => item.id)) {
    const exemption = approvedNotApplicable(controlId, records, now);
    if (exemption && notApplicableAllowed.has(controlId)) {
      results.push(evidenceResult("adoptionMeasurementGovernance", "adoption-attestation",
        controlId, "NotApplicable", context, {
          applicability: exemption.applicability,
          complete: true,
          source: "Validated signed attestation store",
          observedValue: stable(exemption.record.data),
          evidenceRefs: [{
            id: `attestation:${exemption.record.id}`,
            kind: "signedAttestation",
            etag: null,
            digest: null
          }],
          attestation: evidenceAttestation(exemption.record)
        }));
      continue;
    }
    const record = recordFor(controlId);
    if (!record || record.decision === "NotApplicable") {
      results.push(unknown("adoptionMeasurementGovernance", "adoption-attestation",
        controlId, context,
        exemption ? "NOT_APPLICABLE_NOT_PERMITTED" : "SIGNED_ATTESTATION_MISSING",
        exemption
          ? `NotApplicable is not permitted for ${controlId}.`
          : `No current, signature-validated attestation exists for ${controlId}.`));
      continue;
    }
    const data = record.data;
    if (controlId === "AFD-ADOPT-001") {
      const useCases = Array.isArray(data.useCases) ? data.useCases : [];
      const complete = useCases.filter(item =>
        allPresent([item], ["owner", "targetCohort", "expectedOutcome", "successMetric"]));
      results.push(attestedResult(controlId, record, context,
        complete.length >= 3 ? "Pass" : "Fail",
        { qualifyingUseCases: complete.length, useCases }, {
          population: useCases.length, evaluated: useCases.length,
          affectedResources: useCases.filter(item => !complete.includes(item)).map(item => item.id)
        }));
    } else if (controlId === "AFD-ADOPT-002") {
      const cohorts = Array.isArray(data.cohorts) ? data.cohorts : [];
      const incomplete = cohorts.filter(item =>
        !allPresent([item], ["owner", "groupId", "entryCriteria", "exitCriteria"]));
      results.push(attestedResult(controlId, record, context,
        cohorts.length && !incomplete.length ? "Pass" : "Fail", { cohorts }, {
          population: cohorts.length, evaluated: cohorts.length,
          affectedResources: incomplete.map(item => item.id)
        }));
    } else if (controlId === "AFD-ADOPT-003") {
      const deliveredAt = Date.parse(data.training?.deliveredAt);
      const recent = Number.isFinite(deliveredAt) && now - deliveredAt <= 30 * 86400000;
      const support = data.support || {};
      const active = recent && allPresent([support], ["intake", "owner", "responseTarget"]);
      results.push(attestedResult(controlId, record, context,
        active ? "Pass" : "Warning", { training: data.training, support }));
    } else if (controlId === "AFD-ADOPT-004") {
      const useCaseIds = sorted(data.publishedUseCaseIds || [], item => item);
      const acceptances = Array.isArray(data.acceptances) ? data.acceptances : [];
      const accepted = new Set(acceptances.filter(item =>
        allPresent([item], ["useCaseId", "champion", "impactAssessmentUrl", "expiresAt"]) &&
        Date.parse(item.expiresAt) > now).map(item => item.useCaseId));
      const missing = useCaseIds.filter(id => !accepted.has(id));
      results.push(attestedResult(controlId, record, context,
        useCaseIds.length && !missing.length ? "Pass" : "Fail",
        { publishedUseCaseIds: useCaseIds, acceptances }, {
          population: useCaseIds.length, evaluated: useCaseIds.length,
          affectedResources: missing
        }));
    } else if (controlId === "AFD-ADOPT-005") {
      const usage = asArrayResponse(observations.usageReports, "usageReports");
      const measures = Array.isArray(data.measures) ? data.measures : [];
      if (!usage.length) {
        results.push(unknown("adoptionMeasurementGovernance", "adoption-attestation",
          controlId, context, "COPILOT_USAGE_REPORT_MISSING",
          "No current Microsoft 365 Copilot usage report rows were returned.", {
            attestation: evidenceAttestation(record),
            evidenceRefs: [{
              id: `attestation:${record.id}`,
              kind: "signedAttestation",
              etag: null,
              digest: null
            }]
          }));
        continue;
      }
      const currentMeasures = measures.filter(item =>
        allPresent([item], ["owner", "currentValue", "target", "measuredAt"]) &&
        now - Date.parse(item.measuredAt) <= 7 * 86400000);
      const usageCurrent = usage.length > 0 && usage.every(item =>
        !item.reportRefreshDate || now - Date.parse(item.reportRefreshDate) <= 7 * 86400000);
      results.push(attestedResult(controlId, record, context,
        usageCurrent && currentMeasures.length === measures.length && measures.length
          ? "Pass" : "Warning",
        { usageReports: sorted(usage), measures }, {
          population: measures.length, evaluated: currentMeasures.length
        }));
    } else if (controlId === "AFD-ADOPT-006") {
      const reviews = Array.isArray(data.reviews) ? data.reviews : [];
      const current = reviews.find(item =>
        now - Date.parse(item.heldAt) <= 7 * 86400000 &&
        item.driftReviewed === true && Array.isArray(item.decisions) && item.decisions.length);
      results.push(attestedResult(controlId, record, context,
        current ? "Pass" : "Warning", { reviews }));
    }
  }
  return results.sort((a, b) => a.controlId.localeCompare(b.controlId));
}

function createAdoptionMeasurementGovernanceCollector({
  graphReportsClient,
  attestationStore,
  operationTimeoutMs = 10000,
  maximumAttestations = 100
}) {
  if (!graphReportsClient || typeof graphReportsClient !== "object") {
    throw new TypeError("An injected graphReportsClient is required.");
  }
  if (!attestationStore || typeof attestationStore !== "object" ||
      typeof attestationStore.verify !== "function") {
    throw new TypeError("An attestationStore with verify() is required.");
  }
  if (!Number.isInteger(maximumAttestations) || maximumAttestations < 1 ||
      maximumAttestations > 10000) {
    throw new RangeError("maximumAttestations must be between 1 and 10000.");
  }
  return {
    id: "adoption-attestation",
    version: VERSION,
    domainIds: ["adoptionMeasurementGovernance"],
    controlIds: DOMAINS.adoptionMeasurementGovernance.controls.map(control => control.id),
    requiredPermissions: [],
    requiredLicenses: [],
    maximumRequests: ADOPTION_REPORT_QUERY_PLAN.length + 1 + maximumAttestations,
    async discoverCapabilities() {
      return { available: true };
    },
    async health({ signal }) {
      throwIfAborted(signal);
      return { healthy: true };
    },
    async collect({ context, signal, budget }) {
      const reportRequest = ADOPTION_REPORT_QUERY_PLAN[0];
      budget.consume();
      let usageReports;
      try {
        usageReports = await callAdapter(graphReportsClient, {
          ...reportRequest, kind: reportRequest.resource, method: "GET", tenantId: context.tenantId
        }, { signal, timeoutMs: operationTimeoutMs });
      } catch (error) {
        if (signal?.aborted || error?.code === "COLLECTOR_OPERATION_TIMEOUT") throw error;
        usageReports = [];
      }
      budget.consume();
      const listMethod = typeof attestationStore.list === "function"
        ? attestationStore.list.bind(attestationStore)
        : typeof attestationStore.query === "function"
          ? attestationStore.query.bind(attestationStore)
          : null;
      if (!listMethod) throw new TypeError("attestationStore must implement list() or query().");
      const listed = await invokeBounded(() => listMethod({
        tenantId: context.tenantId,
        cohortId: context.cohort?.id || "tenant-wide",
        domainId: "adoptionMeasurementGovernance",
        signal
      }), { signal, timeoutMs: operationTimeoutMs, label: "attestation-list" });
      const attestations = asArrayResponse(listed, "attestation list");
      if (attestations.length > maximumAttestations) {
        const error = new Error(
          `Attestation count ${attestations.length} exceeds the limit of ${maximumAttestations}.`
        );
        error.code = "ATTESTATION_LIMIT_EXCEEDED";
        throw error;
      }
      const validated = [];
      for (const record of attestations) {
        throwIfAborted(signal);
        validateSignedAttestation(record);
        budget.consume();
        const verified = await invokeBounded(
          () => attestationStore.verify(record, { signal }),
          { signal, timeoutMs: operationTimeoutMs, label: `attestation-verify:${record.id}` }
        );
        if (verified === true || verified?.valid === true) validated.push(record);
      }
      return {
        usageReports: asArrayResponse(usageReports, "Copilot usage report"),
        attestations: validated
      };
    },
    async normalize({ observations, context, signal }) {
      throwIfAborted(signal);
      return normalizeAdoption({ observations, context });
    }
  };
}

function createOperationalDomainCollectors(dependencies) {
  assertObject(dependencies, "collector dependencies");
  return [
    createNetworkConnectivityCollector(dependencies),
    createPowerPlatformAgentsCollector(dependencies),
    createAdoptionMeasurementGovernanceCollector(dependencies)
  ];
}

module.exports = {
  ADOPTION_REPORT_QUERY_PLAN,
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
};
