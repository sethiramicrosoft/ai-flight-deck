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

function createAdminCommandAdapter(workspace) {
  return async request => {
    const evidence = readEvidenceFile(workspace, "admin-evidence.json");
    const key = `${request.service}:${request.command}`;
    if (!evidence || !Object.prototype.hasOwnProperty.call(evidence, key)) {
      const error = new Error(
        `No authenticated ${request.service} administration session supplied evidence for ${request.command}.`
      );
      error.code = "COMMAND_UNAVAILABLE";
      throw error;
    }
    return evidence[key];
  };
}

function createPowerPlatformClient(workspace) {
  return {
    async query(request) {
      const evidence = readEvidenceFile(workspace, "power-platform-evidence.json");
      if (!evidence || !Object.prototype.hasOwnProperty.call(evidence, request.resource)) {
        const error = new Error(
          `No authenticated Power Platform evidence was supplied for ${request.resource}.`
        );
        error.code = "POWER_PLATFORM_AUTH_REQUIRED";
        throw error;
      }
      return evidence[request.resource];
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
  createAdminCommandAdapter,
  createAttestationStore,
  createGraphReportsClient,
  createNetworkProbe,
  createPowerPlatformClient,
  graphRequest
};
