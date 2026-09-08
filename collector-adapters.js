"use strict";

const dns = require("node:dns").promises;
const fs = require("node:fs");
const path = require("node:path");
const tls = require("node:tls");

function graphRequest(rawToken) {
  return async request => {
    const url = new URL(request.url);
    if (url.hostname !== "graph.microsoft.com") {
      const error = new Error(`A separate service token is required for ${url.hostname}.`);
      error.code = "SERVICE_TOKEN_REQUIRED";
      throw error;
    }
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Accept-Language": "en-US",
        ...(request.consistencyLevel === "eventual" ? { ConsistencyLevel: "eventual" } : {}),
        Authorization: `Bearer ${rawToken}`
      },
      signal: request.signal
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(body?.error?.message || `Microsoft Graph returned ${response.status}.`);
      error.code = body?.error?.code || String(response.status);
      throw error;
    }
    return body;
  };
}

function readEvidenceFile(workspace, fileName) {
  const filePath = path.join(workspace, fileName);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function validateEvidencePackage(doc, {
  schema,
  tenantId,
  maximumAgeHours,
  verifyDocument,
  fileName
}) {
  if (!doc) throw codedError("EVIDENCE_PACKAGE_MISSING", `${fileName} is not available. Run automatic workload collection from Set up.`);
  if (doc.schema !== schema || doc.version !== "1.0.0") {
    throw codedError(
      "EVIDENCE_SCHEMA_UNSUPPORTED",
      `${fileName} must use ${schema} version 1.0.0.`
    );
  }
  if (typeof doc.tenantId !== "string" || !doc.tenantId) {
    throw codedError("EVIDENCE_TENANT_MISSING", `${fileName} does not identify its tenant.`);
  }
  if (tenantId && doc.tenantId !== tenantId) {
    throw codedError(
      "EVIDENCE_TENANT_MISMATCH",
      `${fileName} belongs to tenant ${doc.tenantId}, not ${tenantId}.`
    );
  }
  if (!isPlainObject(doc.evidence) || !isPlainObject(doc.errors)) {
    throw codedError(
      "EVIDENCE_SHAPE_INVALID",
      `${fileName} must contain object-shaped evidence and errors maps.`
    );
  }
  if (doc.observations !== undefined && (!isPlainObject(doc.observations) ||
      Object.values(doc.observations).some(rows => !Array.isArray(rows)))) {
    throw codedError("EVIDENCE_SHAPE_INVALID", `${fileName} observations must be an object of row arrays.`);
  }
  const producedAt = Date.parse(doc.producedAt);
  if (!Number.isFinite(producedAt)) {
    throw codedError("EVIDENCE_TIMESTAMP_INVALID", `${fileName} has an invalid producedAt value.`);
  }
  if (producedAt > Date.now() + 5 * 60 * 1000) {
    throw codedError(
      "EVIDENCE_TIMESTAMP_IN_FUTURE",
      `${fileName} cannot be dated more than five minutes in the future.`
    );
  }
  if (Date.now() - producedAt > maximumAgeHours * 3600000) {
    throw codedError(
      "EVIDENCE_STALE",
      `${fileName} is older than the supported ${maximumAgeHours}-hour collection window.`
    );
  }
  if (typeof verifyDocument === "function" && verifyDocument(doc) !== true) {
    throw codedError("EVIDENCE_INTEGRITY_INVALID", `${fileName} did not pass local integrity verification.`);
  }
  return doc;
}

function createAdminCommandAdapter(workspace, options = {}) {
  let cache = null;
  function readPackage() {
    const filePath = path.join(workspace, "admin-evidence.json");
    if (!fs.existsSync(filePath)) return null;
    const modifiedAt = fs.statSync(filePath).mtimeMs;
    if (!cache || cache.modifiedAt !== modifiedAt) {
      cache = {
        modifiedAt,
        document: JSON.parse(fs.readFileSync(filePath, "utf8"))
      };
    }
    return cache.document;
  }
  return async request => {
    const evidence = validateEvidencePackage(
      readPackage(),
      {
        schema: "ai-flight-deck/admin-evidence",
        tenantId: request.tenantId,
        maximumAgeHours: options.maximumAgeHours || 24,
        verifyDocument: options.verifyDocument,
        fileName: "admin-evidence.json"
      }
    );
    const baseKey = `${request.service}:${request.command}`;
    const workload = evidence.collectionMetadata?.workloads?.[request.service];
    if (workload?.status === "failed") {
      throw codedError("AUTOMATIC_COLLECTION_FAILED", workload.message ||
        `${request.service} automatic collection failed. Retry the workload from Set up.`);
    }
    let key = request.evidenceKey
      ? `${request.service}:${request.command}:${request.evidenceKey}`
      : baseKey;
    // Only the query plan can establish that an older command-only entry is unambiguous.
    if (request.allowUnkeyed === true &&
        !Object.prototype.hasOwnProperty.call(evidence.evidence, key) &&
        !Object.prototype.hasOwnProperty.call(evidence.errors, key)) {
      key = baseKey;
    }
    if (evidence.errors?.[key]) {
      throw codedError(
        evidence.errors[key].code || "COMMAND_FAILED",
        evidence.errors[key].message || `${request.command} failed during administrator collection.`
      );
    }
    const acquisitionStatus = evidence.commandResults?.[key]?.acquisitionStatus;
    if (acquisitionStatus !== undefined && acquisitionStatus !== "collected") {
      throw codedError("OBSERVATION_NOT_VALIDATED",
        `${request.command} returned limited or unavailable observations, not validated configuration evidence.`);
    }
    if (!Object.prototype.hasOwnProperty.call(evidence.evidence || {}, key)) {
      throw codedError(
        "COMMAND_UNAVAILABLE",
        `No authenticated ${request.service} administration session supplied evidence for ${request.command}.`
      );
    }
    return evidence.evidence[key];
  };
}

function createPowerPlatformClient(workspace, options = {}) {
  let cache = null;
  function readPackage() {
    const filePath = path.join(workspace, "power-platform-evidence.json");
    if (!fs.existsSync(filePath)) return null;
    const modifiedAt = fs.statSync(filePath).mtimeMs;
    if (!cache || cache.modifiedAt !== modifiedAt) {
      cache = {
        modifiedAt,
        document: JSON.parse(fs.readFileSync(filePath, "utf8"))
      };
    }
    return cache.document;
  }
  return {
    async query(request) {
      const evidence = validateEvidencePackage(
        readPackage(),
        {
          schema: "ai-flight-deck/power-platform-evidence",
          tenantId: request.tenantId,
          maximumAgeHours: options.maximumAgeHours || 24,
          verifyDocument: options.verifyDocument,
          fileName: "power-platform-evidence.json"
        }
      );
      if (evidence.errors?.[request.resource]) {
        throw codedError(
          evidence.errors[request.resource].code || "POWER_PLATFORM_QUERY_FAILED",
          evidence.errors[request.resource].message ||
            `Power Platform collection failed for ${request.resource}.`
        );
      }
      if (!Object.prototype.hasOwnProperty.call(evidence.evidence || {}, request.resource)) {
        throw codedError(
          "POWER_PLATFORM_AUTH_REQUIRED",
          `No authenticated Power Platform evidence was supplied for ${request.resource}.`
        );
      }
      return evidence.evidence[request.resource];
    }
  };
}

function createGraphReportsClient(rawToken) {
  const request = graphRequest(rawToken);
  return {
    async query(operation, { signal } = {}) {
      const separator = operation.path.includes("?") ? "&" : "?";
      return request({
        url: `https://graph.microsoft.com/v1.0${operation.path}${separator}$format=application/json`,
        method: "GET",
        signal
      });
    }
  };
}

function createAttestationStore(workspace, verifyAttestation = async () => false) {
  return {
    async list(query) {
      const evidence = readEvidenceFile(workspace, "attestations.json");
      const records = Array.isArray(evidence) ? evidence : evidence?.attestations || [];
      return records.filter(record =>
        record.tenantId === query.tenantId &&
        record.cohortId === query.cohortId &&
        record.domainId === query.domainId);
    },
    async verify(record, options) {
      return verifyAttestation(record, options);
    }
  };
}

function tlsProbe(host, signal) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host,
      port: 443,
      servername: host,
      rejectUnauthorized: true
    });
    const abort = () => socket.destroy(signal.reason || new Error("Network probe cancelled."));
    signal?.addEventListener("abort", abort, { once: true });
    socket.setTimeout(10000);
    socket.once("secureConnect", () => {
      const result = {
        success: true,
        reachable: true,
        authorized: socket.authorized,
        version: socket.getProtocol()
      };
      socket.end();
      signal?.removeEventListener("abort", abort);
      resolve(result);
    });
    socket.once("timeout", () => socket.destroy(new Error("TLS probe timed out.")));
    socket.once("error", error => {
      signal?.removeEventListener("abort", abort);
      reject(error);
    });
  });
}

function createNetworkProbe() {
  return {
    async probe(request, { signal } = {}) {
      const host = request.target.split(":")[0];
      if (request.kind === "dns") {
        const addresses = await dns.lookup(host, { all: true });
        return { success: true, resolved: addresses.length > 0, addresses: addresses.map(item => item.address) };
      }
      if (request.kind === "tls") return tlsProbe(host, signal);
      if (request.kind === "endpoint") {
        const response = await fetch(`https://${host}`, { method: "HEAD", redirect: "manual", signal });
        return { success: response.status < 500, reachable: true, status: response.status };
      }
      if (request.kind === "latency") {
        const samples = [];
        for (let index = 0; index < 3; index++) {
          const started = performance.now();
          const response = await fetch(`https://${host}`, { method: "HEAD", redirect: "manual", signal });
          if (response.status >= 500) throw new Error(`${host} returned ${response.status}.`);
          samples.push(Math.round(performance.now() - started));
        }
        const ordered = [...samples].sort((left, right) => left - right);
        return { success: true, p95Ms: ordered[ordered.length - 1], maxMs: Math.max(...samples), samples };
      }
      return {
        unavailable: true,
        reason: `${request.kind} requires a representative enterprise network probe.`
      };
    }
  };
}

module.exports = {
  codedError,
  createAdminCommandAdapter,
  createAttestationStore,
  createGraphReportsClient,
  createNetworkProbe,
  createPowerPlatformClient,
  graphRequest,
  validateEvidencePackage
};
