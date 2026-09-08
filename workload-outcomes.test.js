"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { summarizeWorkloadEvidence, collectWorkloadEvidence } = require("./workload-collection");
const { powerShellEnvironment } = require("./server");

function resource(status, issues = [], acquisitionErrors = []) {
  return { acquisitionStatus: status, issues, acquisitionErrors };
}

test("successful empty reads and coverage caveats are not reported as collection failures", () => {
  const gap = { code: "PP_INCOMPLETE_EVIDENCE", message: "Caller visibility is not tenant completeness." };
  const outcome = summarizeWorkloadEvidence({
    evidence: { environments: [{ id: "synthetic" }], apps: [], flows: [{ id: "synthetic-flow" }] },
    errors: { environments: gap, apps: gap },
    collection: { resources: {
      environments: resource("collected", [gap]),
      apps: resource("collected", [gap]),
      flows: resource("collected")
    } }
  });
  assert.equal(outcome.errors, 0);
  assert.equal(outcome.evidenceGapCount, 2);
  assert.equal(outcome.acquisitionSummary.collected, 3);
  assert.equal(outcome.resourceCounts.find(row => row.resource === "apps").rows, 0);
  assert.equal(outcome.resourceCounts.find(row => row.resource === "apps").acquisitionStatus, "collected");
  assert.equal(outcome.status, "collected-with-gaps");
  assert.match(outcome.message, /3 dataset reads succeeded.*0 failed/);
});

test("Dataverse unavailability does not hide successful non-Dataverse acquisition", () => {
  const absent = { code: "PP_DATAVERSE_ENDPOINT_MISSING", message: "No endpoint was returned." };
  const denied = { code: "PP_HTTP_403", message: "Service denied the requested read." };
  const outcome = summarizeWorkloadEvidence({
    evidence: { apps: [{ id: "app" }], flows: [{ id: "flow" }], agents: [], connections: [] },
    errors: { agents: absent, connections: denied },
    collection: { resources: {
      apps: resource("collected"), flows: resource("collected"),
      agents: resource("unavailable", [absent]),
      connections: resource("failed", [denied], [denied])
    } }
  });
  assert.deepEqual(outcome.acquisitionSummary, { collected: 2, partial: 0, failed: 1, unavailable: 1 });
  assert.equal(outcome.errors, 1);
  assert.equal(outcome.evidenceGapCount, 1);
  assert.equal(outcome.issues[0].resource, "connections");
  assert.equal(outcome.evidenceGaps[0].resource, "agents");
  assert.equal(outcome.status, "collected-with-gaps");
});

test("unrepresented errors and malformed acquisition metadata cannot disappear", () => {
  const surprise = { code: "NEW_SOURCE_ERROR", message: "Unclassified source failure." };
  const outcome = summarizeWorkloadEvidence({
    evidence: { apps: [], flows: [] }, errors: { apps: surprise },
    collection: { resources: { apps: resource("collected"), flows: { acquisitionStatus: "collected" } } }
  });
  assert.equal(outcome.errors, 2);
  assert.ok(outcome.issues.some(issue => issue.code === "NEW_SOURCE_ERROR"));
  assert.ok(outcome.issues.some(issue => issue.code === "ACQUISITION_STATUS_MISSING"));
  assert.equal(outcome.resourceCounts.find(row => row.resource === "flows").acquisitionStatus, "not-recorded");
  assert.equal(outcome.acquisitionSummary.collected, 1);
});

test("invalid statuses and metadata-only failures are not silently treated as success", () => {
  const invalid = summarizeWorkloadEvidence({
    evidence: { apps: [] }, errors: {},
    collection: { resources: { apps: resource("invented") } }
  });
  assert.equal(invalid.errors, 1);
  assert.equal(invalid.acquisitionSummary.collected, 0);
  const denial = { code: "PP_HTTP_403", message: "Access denied." };
  const missingRows = summarizeWorkloadEvidence({
    evidence: {}, errors: {},
    collection: { resources: { apps: resource("failed", [denial], [denial]) } }
  });
  assert.equal(missingRows.status, "failed");
  assert.equal(missingRows.errors, 1);
});
test("all attempted reads failing produces a failed workload, not a collected badge", () => {
  const denial = { code: "PP_HTTP_403", message: "Access denied." };
  const outcome = summarizeWorkloadEvidence({
    evidence: { environments: [] }, errors: { environments: denial },
    collection: { resources: { environments: resource("failed", [denial], [denial]) } }
  });
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.errors, 1);
  assert.equal(outcome.evidenceGapCount, 0);
});

test("legacy packages retain issues without claiming a recorded acquisition outcome", () => {
  const outcome = summarizeWorkloadEvidence({
    evidence: { environments: [] }, errors: { environments: { code: "OLD_GAP", message: "Old output." } },
    collection: { resources: { environments: { complete: false, issues: [] } } }
  });

  assert.equal(outcome.errors, 1);
  assert.equal(outcome.issues[0].code, "OLD_GAP");
  assert.equal(outcome.resourceCounts[0].acquisitionStatus, "not-recorded");
  assert.match(outcome.message, /not recorded/);
});

test("administrator warning observations retain row counts without becoming accepted source rows", () => {
  const key = "sharePointOnline:Get-SPOSite:restrictedContent";
  const warning = { code: "COMMAND_WARNING", message: "Observed rows have unresolved field availability." };
  const outcome = summarizeWorkloadEvidence({
    evidence: {}, observations: { [key]: Array.from({ length: 32 }, (_, index) => ({ id: `site-${index}` })) },
    errors: { [key]: warning }, commandResults: { [key]: resource("partial", [warning]) }
  });
  assert.equal(outcome.status, "collected-with-gaps");
  assert.equal(outcome.errors, 0);
  assert.equal(outcome.evidenceGapCount, 1);
  assert.equal(outcome.acquisitionSummary.partial, 1);
  assert.deepEqual(outcome.resourceCounts[0], {
    resource: key, rows: 32, acceptedRows: 0, observationRows: 32, acquisitionStatus: "partial"
  });
});

test("administrator producer warning and gap metadata separates query errors from source limits", () => {
  const warning = { code: "COMMAND_WARNING", message: "Warning-only response." };
  const denial = { code: "COMMAND_ACCESS_DENIED", message: "Read denied." };
  const outcome = summarizeWorkloadEvidence({
    evidence: {}, observations: { site: [{ id: "observed" }] }, errors: { site: warning, failed: denial },
    commandResults: {
      site: { acquisitionStatus: "partial", warnings: [{ code: "SPO_SITE_QUERY_WARNING", message: "Site warning." }],
        gaps: [], boundary: { coverageComplete: false, note: "Bounded sample." } },
      failed: { acquisitionStatus: "failed", warnings: [], gaps: [denial] },
      emptyWarning: { acquisitionStatus: "partial", warnings: [warning], gaps: [] }
    }
  });
  assert.deepEqual(outcome.acquisitionSummary, { collected: 0, partial: 2, failed: 1, unavailable: 0 });
  assert.equal(outcome.errors, 1);
  assert.deepEqual(outcome.issues, [{ resource: "failed", ...denial }]);
  assert.equal(outcome.resourceCounts.find(item => item.resource === "site").observationRows, 1);
  assert.ok(outcome.evidenceGaps.some(item => item.code === "SOURCE_SCOPE_LIMITED"));
});

test("actual synthetic PowerShell output retains new datasets through Node admission and summarization",
  { skip: process.platform !== "win32", timeout: 90000 }, async () => {
    const executable = path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const script = `
      . .\\scanner\\tests\\test-power-platform-evidence.ps1
      $full = Invoke-PPTestCollection (New-PPTestOperations)
      $ops = New-PPTestOperations
      $ops.Environments = { param($Limit) New-PPTestEnvironment 'environment-1' '' }
      $ops.EnvironmentDetail = { param($Environment) New-PPTestEnvironment $Environment '' }
      $ops.Apps = { param($Environment,$Limit) }
      $missing = Invoke-PPTestCollection $ops
      [Console]::Out.WriteLine('AFD_TEST_FIXTURE:' + (@{full=$full;missing=$missing} | ConvertTo-Json -Depth 30 -Compress))
    `;
    const processResult = spawnSync(executable, ["-NoProfile", "-Command", script], {
      cwd: __dirname, env: powerShellEnvironment(executable), encoding: "utf8",
      timeout: 60000, maxBuffer: 2 * 1024 * 1024
    });
    assert.equal(processResult.status, 0, processResult.error?.message || processResult.stdout + processResult.stderr);
    const marker = processResult.stdout.split(/\r?\n/).find(line => line.startsWith("AFD_TEST_FIXTURE:"));
    assert.ok(marker, "The synthetic producer must emit its actual serialized contract.");
    const documents = JSON.parse(marker.slice("AFD_TEST_FIXTURE:".length));
    const full = summarizeWorkloadEvidence(documents.full);
    assert.equal(full.acquisitionSummary.collected, 10);
    assert.equal(full.errors, 0);
    assert.equal(full.evidenceGapCount, 10);
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "afd-pp-outcomes-"));
    try {
      const job = {};
      const admitted = await collectWorkloadEvidence({
        workspace, job, tenantId: documents.missing.tenantId, actorId: documents.missing.actorId,
        workloads: ["powerPlatform"],
        execute: async args => {
          const value = flag => args[args.indexOf(flag) + 1];
          documents.missing.collectionChallenge = value("-CollectionChallenge");
          fs.writeFileSync(value("-OutputPath"), JSON.stringify(documents.missing));
        }
      });
      assert.equal(admitted.powerPlatform.evidence.flows.length, 1);
      assert.equal(admitted.powerPlatform.evidence.connections.length, 1);
      assert.equal(job.workloads[0].acquisitionSummary.collected, 6);
      assert.equal(job.workloads[0].acquisitionSummary.unavailable, 4);
      const apps = job.workloads[0].resourceCounts.find(row => row.resource === "apps");
      assert.equal(apps.rows, 0);
      assert.equal(apps.acquisitionStatus, "collected");
      assert.ok(job.workloads[0].issues.every(issue => issue.code === "PP_DATAVERSE_ENDPOINT_NOT_RETURNED"));
      assert.ok(job.workloads[0].evidenceGaps.every(issue =>
        issue.code === "PP_INCOMPLETE_EVIDENCE" || issue.code === "PP_NO_VERIFIABLE_RECORDS"));
      assert.equal(job.workloads[0].status, "collected-with-gaps");
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
