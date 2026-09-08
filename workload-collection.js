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
    if (typeof diagnostic?.code === "string" && /^[A-Z0-9_]{1,80}$/.test(diagnostic.code) &&
        typeof diagnostic.message === "string" && diagnostic.message.length <= 2048) {
      const error = new Error(`${diagnostic.code}: ${diagnostic.message}`);
      error.code = diagnostic.code;
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
        const errors = Object.keys(document.errors).length;
        update(entry, { status: errors ? "collected-with-gaps" : "collected", errors,
          resourceCounts: Object.entries(document.evidence).map(([resource, records]) => ({
            resource, rows: Array.isArray(records) ? records.length : 0
          })),
          issues: Object.entries(document.errors).slice(0, 25).map(([resource, issue]) => ({
            resource, code: issue?.code || "COLLECTION_ERROR",
            message: String(issue?.message || "The source did not return usable evidence.")
          })),
          completedAt: now().toISOString(),
          message: errors ? `${errors} collection errors recorded; unavailable data will not be treated as complete.` :
            "Evidence collected. Observation validation is a separate step." });
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        const message = controller.signal.aborted ? `${entry.name} collection timed out.` : String(error.message);
        update(entry, { status: "failed", errors: 1, message, completedAt: now().toISOString() });
        if (entry.id !== "powerPlatform") {
          admin.collectionMetadata.workloads[entry.id] = { status: "failed", message };
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

module.exports = { WORKLOADS, PRODUCER_VERSIONS, selectedWorkloads, collectWorkloadEvidence, sharePointAdminUrl, collectorErrorFromOutput };
