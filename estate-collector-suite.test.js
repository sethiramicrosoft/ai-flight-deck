"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const catalog = require("./schema/readiness-catalog.v1.json");
const { runEstateCollectors, validateCoverage } = require("./collector-orchestrator");
const { buildEstateCollectors } = require("./estate-collector-suite");

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
