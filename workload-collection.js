"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { validateEvidencePackage } = require("./collector-adapters");

const WORKLOADS = Object.freeze(["exchangeOnline", "sharePointOnline", "purview", "powerPlatform"]);
const PRODUCER_VERSIONS = Object.freeze({ admin: "1.1.0", powerPlatform: "1.0.0" });
const LABELS = Object.freeze({
  exchangeOnline: "Exchange Online", sharePointOnline: "SharePoint Online",
  purview: "Microsoft Purview", powerPlatform: "Power Platform and Copilot Studio"
});

function collectorErrorFromOutput(output, exitCode) {
  const marker = output.split(/\r?\n/).reverse().find(line => line.startsWith("AFD_COLLECTOR_ERROR:"));
  if (marker) {
    let diagnostic;
    try {
      diagnostic = JSON.parse(marker.slice("AFD_COLLECTOR_ERROR:".length));
    } catch {
      return new Error("The connector failed and returned invalid diagnostic output. See the collection log.");
    }
    const validIssue = issue => typeof issue?.resource === "string" &&
      /^(exchangeOnline|sharePointOnline|purview):[A-Za-z][A-Za-z0-9-]{0,79}(?::[A-Za-z][A-Za-z0-9]{0,79})?$/.test(issue.resource) &&
      typeof issue.code === "string" && /^[A-Z0-9_]{1,80}$/.test(issue.code) &&
      typeof issue.message === "string" && issue.message.length <= 2048;
    if (typeof diagnostic?.code === "string" && /^[A-Z0-9_]{1,80}$/.test(diagnostic.code) &&
        typeof diagnostic.message === "string" && diagnostic.message.length <= 2048 &&
        (diagnostic.issues === undefined ||
          (Array.isArray(diagnostic.issues) && diagnostic.issues.length <= 31 && diagnostic.issues.every(validIssue)))) {
      const error = new Error(`${diagnostic.code}: ${diagnostic.message}`);
      error.code = diagnostic.code;
      if (diagnostic.issues) {
        error.issues = diagnostic.issues.map(({ resource, code, message }) => ({ resource, code, message }));
      }
      return error;
    }
    return new Error("The connector failed and returned invalid diagnostic fields. See the collection log.");
  }
  return new Error(`The local workflow exited with code ${exitCode}. See the collection log.`);
}

function selectedWorkloads(value = WORKLOADS) {
  if (!Array.isArray(value) || value.some(id => !WORKLOADS.includes(id)) ||
      new Set(value).size !== value.length) {
    throw new TypeError("Select each supported workload at most once.");
  }
  return [...value];
}

async function sharePointAdminUrl(graphRequest, tenantId, signal) {
  const organizations = await graphRequest({
    method: "GET", url: "https://graph.microsoft.com/v1.0/organization?$select=id", signal
  });
  if (!organizations.value?.some(organization => organization.id.toLowerCase() === tenantId.toLowerCase())) {
    throw new Error("The Graph connection does not identify the baseline tenant.");
  }
  const root = await graphRequest({
    method: "GET", url: "https://graph.microsoft.com/v1.0/sites/root?$select=webUrl", signal
  });
  const url = new URL(root.webUrl);
  if (url.protocol !== "https:" || url.port || url.username || url.password ||
      !/^[a-z0-9-]+\.sharepoint\.com$/i.test(url.hostname)) {
    throw new Error("Automatic SharePoint collection requires a verified commercial SharePoint root URL.");
  }
  return `https://${url.hostname.replace(/\.sharepoint\.com$/i, "-admin.sharepoint.com")}`;
}

async function collectWorkloadEvidence({
  workspace, tenantId, actorId, job, signal, graphRequest, execute,
  workloads = WORKLOADS, timeoutMs = 15 * 60 * 1000,
  maximumPackageBytes = 12 * 1024 * 1024, now = () => new Date()
}) {
  const selected = selectedWorkloads(workloads);
  if (!/^[0-9a-f-]{36}$/i.test(tenantId) || typeof execute !== "function") {
    throw new TypeError("A baseline tenant and workload executor are required.");
  }
  const folder = fs.mkdtempSync(path.join(workspace, ".workload-collection-"));
  const challenge = crypto.randomBytes(32).toString("base64url");
  const startedAt = now().toISOString();
  const documents = {};
  const admin = {
    schema: "ai-flight-deck/admin-evidence", version: "1.0.0",
    producerId: "ai-flight-deck/admin-evidence-collector", producerVersion: PRODUCER_VERSIONS.admin,
    collectionChallenge: challenge, tenantId, actorId: null, producedAt: startedAt,
    workloads: selected.filter(id => id !== "powerPlatform"), evidence: {}, errors: {},
    connections: {}, commandResults: {}, workloadResults: {},
    collectionMetadata: { mode: "app-managed", initiatedBy: actorId, workloads: {} }
  };
  job.workloads = selected.map(id => ({ id, name: LABELS[id], status: "queued", errors: 0 }));
  const update = (entry, values) => {
    Object.assign(entry, values);
    job.updatedAt = now().toISOString();
  };
  try {
    for (const entry of job.workloads) {
      signal?.throwIfAborted();
      update(entry, { status: "collecting", startedAt: now().toISOString(),
        message: "Preparing the connector and collecting evidence. Complete workload sign-in if prompted." });
      const controller = new AbortController();
      const cancel = () => controller.abort(signal.reason);
      signal?.addEventListener("abort", cancel, { once: true });
      const timer = setTimeout(() => controller.abort(new Error(`${entry.name} collection timed out.`)), timeoutMs);
      try {
        let expectedAdminUrl;
        const outputPath = path.join(folder, `${entry.id}.json`);
        const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "scanner",
          entry.id === "powerPlatform" ? "collect-power-platform-evidence.ps1" : "collect-admin-evidence.ps1"),
        "-TenantId", tenantId, "-WorkspacePath", folder, "-OutputPath", outputPath,
        "-CollectionChallenge", challenge, "-InstallMissingModules"];
        if (entry.id !== "powerPlatform") args.push("-Workloads", entry.id);
        if (entry.id === "sharePointOnline") {
          expectedAdminUrl = await sharePointAdminUrl(graphRequest, tenantId, controller.signal);
          args.push("-SharePointAdminUrl", expectedAdminUrl);
        }
        await execute(args, controller.signal, entry);
        controller.signal.throwIfAborted();
        if (fs.statSync(outputPath).size > maximumPackageBytes) {
          throw new Error(`The workload output exceeds the ${maximumPackageBytes}-byte local evidence limit. Coverage is unresolved.`);
        }
        const document = JSON.parse(fs.readFileSync(outputPath, "utf8").replace(/^\uFEFF/, ""));
        const kind = entry.id === "powerPlatform" ? "powerPlatform" : "admin";
        validateEvidencePackage(document, {
          schema: `ai-flight-deck/${kind === "admin" ? "admin" : "power-platform"}-evidence`,
          tenantId, maximumAgeHours: 24, fileName: `${entry.name} automatic evidence`
        });
        if (document.collectionChallenge !== challenge ||
            document.producerId !== `ai-flight-deck/${kind === "admin" ? "admin" : "power-platform"}-evidence-collector` ||
            document.producerVersion !== PRODUCER_VERSIONS[kind] ||
            Date.parse(document.producedAt) < Date.parse(startedAt) - 300000) {
          throw new Error("The workload output does not match this collection run or supported producer.");
        }
        if (kind === "admin") {
          const connection = document.connections?.[entry.id];
          if (document.workloads?.length !== 1 || document.workloads[0] !== entry.id ||
              connection?.expectedTenantId?.toLowerCase() !== tenantId.toLowerCase()) {
            throw new Error("The administration output does not identify its requested workload connection.");
          }
          if (entry.id === "sharePointOnline") {
            if (connection.adminUrl !== expectedAdminUrl || connection.targetConnected !== true ||
                connection.tenantVerified !== false || connection.observedTenantId !== null ||
                connection.actorId !== null || document.actorId !== null) {
              throw new Error("SharePoint output must preserve its Graph-derived target and unknown service identity.");
            }
          } else if (connection.tenantVerified !== true ||
              connection.observedTenantId?.toLowerCase() !== tenantId.toLowerCase() ||
              typeof document.actorId !== "string" || !document.actorId.trim() ||
              connection.actorId !== document.actorId) {
            throw new Error("The administration output does not contain a matching authenticated tenant and actor.");
          }
          if (Object.keys(document.evidence).concat(Object.keys(document.errors))
            .some(key => !key.startsWith(`${entry.id}:`))) {
            throw new Error("The workload returned evidence outside its requested service.");
          }
          Object.assign(admin.evidence, document.evidence);
          Object.assign(admin.errors, document.errors);
          Object.assign(admin.connections, document.connections);
          Object.assign(admin.commandResults, document.commandResults);
          Object.assign(admin.workloadResults, document.workloadResults);
          admin.collectionMetadata.workloads[entry.id] = {
            status: "collected", producedAt: document.producedAt, actorId: document.actorId,
            producerVersion: document.producerVersion, metadata: document.collection
          };
        } else {
          if (typeof document.actorId !== "string" || !document.actorId.trim()) {
            throw new Error("Power Platform output does not identify its authenticated actor.");
          }
          documents.powerPlatform = document;
        }
        update(entry, { ...summarizeWorkloadEvidence(document), completedAt: now().toISOString() });
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        const message = controller.signal.aborted ? `${entry.name} collection timed out.` : String(error.message);
        let issues = controller.signal.aborted ? [] : error.issues || [];
        if (issues.some(issue => !issue.resource.startsWith(`${entry.id}:`))) {
          issues = [{ resource: entry.id, code: "DIAGNOSTIC_SCOPE_MISMATCH",
            message: "The failed connector returned diagnostics for another workload; those details were rejected." }];
        }
        const details = issues.length ? { issues } : {};
        update(entry, { status: "failed", errors: issues.length || 1, message, ...details, completedAt: now().toISOString() });
        if (entry.id !== "powerPlatform") {
          admin.collectionMetadata.workloads[entry.id] = { status: "failed", message, ...details };
        } else {
          documents.powerPlatform = {
            schema: "ai-flight-deck/power-platform-evidence", version: "1.0.0",
            producerId: "ai-flight-deck/power-platform-evidence-collector", producerVersion: "1.0.0",
            collectionChallenge: challenge, tenantId, actorId, producedAt: now().toISOString(),
            evidence: {}, errors: Object.fromEntries(
              ["environments", "dlpPolicies", "connectors", "agents", "agentOwners", "agentSharing", "agentLifecycle"]
                .map(key => [key, { code: "AUTOMATIC_COLLECTION_FAILED", message }])),
            collectionMetadata: { mode: "app-managed", status: "failed" }
          };
        }
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
      }
    }
    if (admin.workloads.length) documents.admin = admin;
    job.collectionSummary = {
      requested: selected.length,
      collected: job.workloads.filter(w => w.status === "collected").length,
      withGaps: job.workloads.filter(w => w.status === "collected-with-gaps").length,
      failed: job.workloads.filter(w => w.status === "failed").length
    };
    return documents;
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

function summarizeWorkloadEvidence(document) {
  const metadata = document.collection?.resources;
  const statuses = new Set(["collected", "partial", "failed", "unavailable"]);
  const detailed = metadata && typeof metadata === "object" && Object.values(metadata).some(record =>
    record && typeof record === "object" &&
    (Object.hasOwn(record, "acquisitionStatus") || Object.hasOwn(record, "acquisitionErrors")));
  const validRecord = record => record && statuses.has(record.acquisitionStatus) &&
    Array.isArray(record.acquisitionErrors) && Array.isArray(record.issues);
  const resourceNames = new Set([...Object.keys(document.evidence), ...Object.keys(document.errors),
    ...Object.keys(metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {})]);
  const resourceCounts = [...resourceNames].map(resource => ({
    resource, rows: Array.isArray(document.evidence[resource]) ? document.evidence[resource].length : 0,
    acquisitionStatus: validRecord(metadata?.[resource])
      ? metadata[resource].acquisitionStatus : "not-recorded"
  }));
  const normalize = (resource, issue) => ({
    resource, code: String(issue?.code || "COLLECTION_ERROR"),
    message: String(issue?.message || "The source did not return usable evidence.")
  });
  if (!detailed) {
    const issues = Object.entries(document.errors).map(([resource, issue]) => normalize(resource, issue));
    return {
      status: issues.length ? "collected-with-gaps" : "collected",
      errors: issues.length, resourceCounts, issues: issues.slice(0, 25),
      message: issues.length
        ? `${issues.length} reported source issues. Per-query acquisition status was not recorded; review the details.`
        : "Evidence collected. Observation validation is a separate step."
    };
  }
  const issues = [];
  const evidenceGaps = [];
  const seen = new Set();
  const append = (target, resource, issue) => {
    const normalized = normalize(resource, issue);
    const key = `${resource}\0${normalized.code}\0${normalized.message}`;
    if (!seen.has(key)) { seen.add(key); target.push(normalized); }
  };
  for (const resource of resourceNames) {
    const record = metadata?.[resource];
    if (!validRecord(record)) {
      append(issues, resource, { code: "ACQUISITION_STATUS_MISSING",
        message: "The producer did not provide a valid acquisition outcome for this resource." });
      continue;
    }
    for (const issue of record.acquisitionErrors) append(issues, resource, issue);
    for (const issue of record.issues) append(evidenceGaps, resource, issue);
  }
  // A newly introduced producer error must not disappear merely because metadata omitted it.
  for (const [resource, issue] of Object.entries(document.errors)) append(issues, resource, issue);
  const counts = Object.fromEntries([...statuses].map(status =>
    [status, resourceCounts.filter(resource => resource.acquisitionStatus === status).length]));
  const allFailed = counts.failed > 0 && counts.collected === 0 && counts.partial === 0;
  const hasGaps = issues.length || evidenceGaps.length || counts.partial || counts.unavailable;
  return {
    status: allFailed ? "failed" : hasGaps ? "collected-with-gaps" : "collected",
    acquisitionSummary: counts, errors: issues.length,
    evidenceGapCount: evidenceGaps.length, resourceCounts,
    issues: issues.slice(0, 25), evidenceGaps: evidenceGaps.slice(0, 25),
    message: `${counts.collected} dataset reads succeeded; ${counts.partial} partial; ${counts.failed} failed; ` +
      `${counts.unavailable} unavailable. ${evidenceGaps.length} coverage or review gaps remain. Collection is not a readiness decision.`
  };
}

module.exports = { WORKLOADS, PRODUCER_VERSIONS, selectedWorkloads, collectWorkloadEvidence, sharePointAdminUrl, collectorErrorFromOutput, summarizeWorkloadEvidence };
