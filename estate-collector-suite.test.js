"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const catalog = require("./schema/readiness-catalog.v1.json");
const { runEstateCollectors, validateCoverage } = require("./collector-orchestrator");
const {
  buildEstateCollectors,
  collectEstate,
  loadConfiguredCohort,
  resolveConfiguredCohort
} = require("./estate-collector-suite");

test("tenant-bound directory configuration cannot be loaded in another tenant or without context", () => {
  const workspace = fs.mkdtempSync(path.join(__dirname, ".directory-cohort-test-"));
  try {
    const cohort = {
      id: "directory-pilot", source: "MicrosoftGraphDirectory", tenantId: "tenant-a",
      principalIds: ["00000000-0000-0000-0000-000000000001"],
      userPrincipalNames: ["pilot@example.test"], owner: "Owner", approved: true
    };
    fs.writeFileSync(path.join(workspace, "cohort-config.json"), JSON.stringify(cohort));
    assert.deepEqual(loadConfiguredCohort(workspace, "tenant-a"), cohort);
    assert.throws(() => loadConfiguredCohort(workspace, "tenant-b"), /another tenant/);
    assert.throws(() => loadConfiguredCohort(workspace), /verified tenant binding/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("directory cohort enrichment uses targeted identity lookup and retains missing-evidence controls", async () => {
  const workspace = fs.mkdtempSync(path.join(__dirname, ".directory-enrichment-test-"));
  try {
    const id = "00000000-0000-0000-0000-000000000001";
    const configuredCohort = { id: "directory-pilot", source: "MicrosoftGraphDirectory",
      tenantId: "tenant-a", approved: true, owner: "Owner",
      principalIds: [id], userPrincipalNames: ["pilot@example.test"] };
    const requests = [];
    const result = await collectEstate({
      rawToken: "synthetic", workspace, configuredCohort, signal: new AbortController().signal,
      scan: { tenant: { tenantId: "tenant-a" }, auth: { actor: { id: "actor-a" } },
        generatedAt: new Date().toISOString(), scope: { grantedScopes: [] },
        estateAssessment: { cohorts: [], domains: catalog.domains.map(d => ({ id: d.id })) } },
      adapters: {
        graphRequest: async ({ url }) => {
          requests.push(url);
          if (new URL(url).pathname === `/v1.0/users/${id}`) {
            return { id, userPrincipalName: "pilot@example.test", accountEnabled: true };
          }
          return { value: [] };
        },
        adminCommand: async () => { throw new Error("Synthetic workload unavailable"); },
        networkProbe: { probe: async () => ({ unavailable: true, reason: "Synthetic probe unavailable" }) },
        powerPlatformClient: { query: async () => ({ value: [] }) },
        graphReportsClient: { query: async () => ({ value: [] }) },
        attestationStore: { list: async () => [], verify: async () => false }
      }
    });
    assert.equal(result.estateAssessment.cohorts[0].approved, true);
    assert.deepEqual(result.estateAssessment.cohorts[0].principalIds, [id]);
    assert.equal(new URL(requests[0]).pathname, `/v1.0/users/${id}`);
    assert.equal(requests.some(url => url.includes("$select=id,userPrincipalName,assignedLicenses")), false);
    assert.equal(result.estateAssessment.controlResults.length, 77);
    assert.ok(result.estateAssessment.controlResults.some(control => control.status === "Unknown"));
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("registers executable collectors for all thirteen domains and seventy-seven controls", () => {
  const collectors = buildEstateCollectors({
    rawToken: "test-token",
    workspace: process.cwd()
  });
  assert.equal(collectors.length, 13);
  assert.equal(new Set(collectors.flatMap(collector => collector.domainIds)).size, 13);
  assert.equal(validateCoverage(collectors).size, 77);
  assert.deepEqual(
    [...new Set(collectors.flatMap(collector => collector.controlIds))].sort(),
    catalog.domains.flatMap(domain => domain.controls.map(control => control.id)).sort()
  );
});

test("all thirteen collectors execute and emit exactly seventy-seven explicit results", async () => {
    const graphRequest = async request => request.url.includes("/reports/")
      ? { value: [] }
      : { value: [] };
    const collectors = buildEstateCollectors({
      rawToken: "test-token",
      workspace: process.cwd(),
      adapters: {
        graphRequest,
        adminCommand: async () => {
          const error = new Error("Administrative workload session is not connected.");
          error.code = "COMMAND_UNAVAILABLE";
          throw error;
        },
        networkProbe: {
          async probe(request) {
            return { unavailable: true, reason: `${request.kind} is unavailable in this test.` };
          }
        },
        powerPlatformClient: {
          async query() {
            return { value: [] };
          }
        },
        graphReportsClient: {
          async query() {
            return { value: [] };
          }
        },
        attestationStore: {
          async list() {
            return [];
          },
          async verify() {
            return false;
          }
        }
      }
    });
    const run = await runEstateCollectors({
      collectors,
      context: {
        tenantId: "tenant-1",
        actorId: "actor-1",
        observedAt: "2026-09-04T10:00:00.000Z",
        cohort: { id: "tenant-wide", approved: false, principalIds: [] },
        networkLocations: ["test-location"]
      },
      grantedPermissions: ["Directory.Read.All", "Organization.Read.All"],
      maxConcurrency: 4
    });
    assert.equal(run.executions.length, 13);
    assert.equal(run.executions.every(execution => execution.status === "Completed"), true);
    assert.equal(run.controlResults.length, 77);
    assert.equal(new Set(run.controlResults.map(result => result.controlId)).size, 77);
});

test("loads and resolves an approved readiness-report cohort against Graph users", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "flight-deck-cohort-"));
  try {
    fs.writeFileSync(path.join(workspace, "cohort-config.json"), JSON.stringify({
      id: "copilot-pilot",
      name: "Copilot pilot",
      owner: "Program Owner",
      approved: true,
      userPrincipalNames: ["pilot1@example.test", "pilot2@example.test"]
    }));
    const configured = loadConfiguredCohort(workspace);
    let page = 0;
    const resolved = await resolveConfiguredCohort(async request => {
      page++;
      if (page === 1) {
        assert.match(request.url, /\$select=id,userPrincipalName,assignedLicenses/);
      } else {
        assert.match(request.url, /\$skiptoken=next/);
      }
      return page === 1
        ? {
          value: [{ id: "user-2", userPrincipalName: "pilot2@example.test", assignedLicenses: [] }],
          "@odata.nextLink": "https://graph.microsoft.com/v1.0/users?$skiptoken=next"
        }
        : {
          value: [{ id: "user-1", userPrincipalName: "pilot1@example.test", assignedLicenses: [] }]
        };
    }, configured, new AbortController().signal);
    assert.equal(resolved.approved, true);
    assert.equal(resolved.resolutionComplete, true);
    assert.equal(page, 2);
    assert.deepEqual(resolved.principalIds, ["user-1", "user-2"]);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("does not approve a saved cohort when Graph cannot resolve every member", async () => {
  const resolved = await resolveConfiguredCohort(async () => ({
    value: [{ id: "user-1", userPrincipalName: "pilot1@example.test" }]
  }), {
    id: "copilot-pilot",
    approved: true,
    userPrincipalNames: ["pilot1@example.test", "missing@example.test"]
  }, new AbortController().signal);
  assert.equal(resolved.approved, false);
  assert.equal(resolved.requestedApproved, true);
  assert.deepEqual(resolved.unresolvedUserPrincipalNames, ["missing@example.test"]);
});
