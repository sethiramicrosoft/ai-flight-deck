"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { collectWorkloadEvidence, selectedWorkloads, sharePointAdminUrl, WORKLOADS, PRODUCER_VERSIONS, collectorErrorFromOutput } = require("./workload-collection");
const { createAdminCommandAdapter } = require("./collector-adapters");
const { createApp, powerShellEnvironment } = require("./server");

const tenantId = "11111111-1111-1111-1111-111111111111";
const actorId = "22222222-2222-2222-2222-222222222222";
const valueOf = (args, name) => args[args.indexOf(name) + 1];
const graph = async request => request.url.includes("/organization?")
  ? { value: [{ id: tenantId }] } : { webUrl: "https://synthetic.sharepoint.com/" };

test("failed processes expose safe connector diagnostics instead of only an exit code", () => {
  const output = 'Preparing module...\r\nAFD_COLLECTOR_ERROR:{"code":"MODULE_COMMAND_CONFLICT","message":"Approved dependency update required."}\r\nPowerShell stack text\r\n';
  const error = collectorErrorFromOutput(output, 1);
  assert.equal(error.code, "MODULE_COMMAND_CONFLICT");
  assert.equal(error.message, "MODULE_COMMAND_CONFLICT: Approved dependency update required.");
  assert.match(collectorErrorFromOutput("other failure", 1).message, /code 1.*collection log/);
  assert.match(collectorErrorFromOutput("AFD_COLLECTOR_ERROR:{bad JSON}", 1).message, /invalid diagnostic output/);
  assert.match(collectorErrorFromOutput('AFD_COLLECTOR_ERROR:{"code":"bad code","message":"not trusted"}', 1).message, /invalid diagnostic fields/);
});

test("fatal diagnostics retain bounded per-command details and reject malformed fields", () => {
  const issue = { resource: "sharePointOnline:Get-SPOSite:restrictedContent",
    code: "COMMAND_ACCESS_DENIED", message: "The service denied this read." };
  const diagnostic = { code: "WORKLOAD_COLLECTION_FAILED", message: "No commands succeeded.", issues: [issue] };
  const parse = value => collectorErrorFromOutput(`AFD_COLLECTOR_ERROR:${JSON.stringify(value)}`, 1);
  assert.deepEqual(parse(diagnostic).issues, [issue]);
  for (const issues of [{}, [null], Array(32).fill(issue),
    [{ ...issue, resource: "other:Get-Site" }],
    [{ ...issue, code: "invalid code" }], [{ ...issue, message: "x".repeat(2049) }]]) {
    assert.match(parse({ ...diagnostic, issues }).message, /invalid diagnostic fields/);
  }
  assert.deepEqual(parse({ ...diagnostic, issues: [{ ...issue, extra: "not forwarded" }] }).issues, [issue]);
});
function documentFor(args) {
  const service = args.includes("-Workloads") ? valueOf(args, "-Workloads") : "powerPlatform";
  const admin = service !== "powerPlatform";
  return {
    schema: `ai-flight-deck/${admin ? "admin" : "power-platform"}-evidence`, version: "1.0.0",
    producerId: `ai-flight-deck/${admin ? "admin" : "power-platform"}-evidence-collector`,
    producerVersion: admin ? PRODUCER_VERSIONS.admin : PRODUCER_VERSIONS.powerPlatform,
    tenantId, actorId: service === "sharePointOnline" ? null : actorId, producedAt: new Date().toISOString(),
    ...(admin ? {
      workloads: [service],
      connections: { [service]: service === "sharePointOnline"
        ? { expectedTenantId: tenantId, observedTenantId: null, actorId: null, tenantVerified: false,
          adminUrl: valueOf(args, "-SharePointAdminUrl"), targetConnected: true }
        : { expectedTenantId: tenantId, observedTenantId: tenantId, actorId, tenantVerified: true } },
      collection: { coverageComplete: false, limitations: ["Synthetic caller scope only"] },
      commandResults: { [`${service}:Get-Synthetic`]: { boundary: { coverageComplete: false } } }
    } : {}),
    collectionChallenge: valueOf(args, "-CollectionChallenge"),
    evidence: admin ? { [`${service}:Get-Synthetic`]: [{ observed: true }] } : { environments: [] },
    errors: admin ? {} : { agents: { code: "ACCESS_DENIED", message: "Synthetic permission denial" } }
  };
}
function writeOutput(args, document = documentFor(args)) {
  fs.writeFileSync(valueOf(args, "-OutputPath"), JSON.stringify(document));
}
async function inWorkspace(operation) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "afd-auto-workloads-"));
  try { return await operation(workspace); }
  finally { fs.rmSync(workspace, { recursive: true, force: true }); }
}

test("workload selection is closed and SharePoint discovery is tenant and host bound", async () => {
  assert.deepEqual(selectedWorkloads(), WORKLOADS);
  for (const selection of [["other"], ["purview", "purview"], "purview", null]) {
    assert.throws(() => selectedWorkloads(selection));
  }
  assert.equal(await sharePointAdminUrl(graph, tenantId), "https://synthetic-admin.sharepoint.com");
  await assert.rejects(sharePointAdminUrl(async () => ({ value: [{ id: actorId }] }), tenantId), /baseline tenant/);
  for (const webUrl of ["http://synthetic.sharepoint.com", "https://evil.test",
    "https://synthetic.sharepoint.com.evil.test", "https://user:secret@synthetic.sharepoint.com",
    "https://synthetic.sharepoint.com:444"]) {
    await assert.rejects(sharePointAdminUrl(async request => request.url.includes("/organization?")
      ? { value: [{ id: tenantId }] } : { webUrl }, tenantId), /verified commercial/);
  }
});

test("runs all four authenticated producers, discovers SPO and ingests without user files", async () => {
  await inWorkspace(async workspace => {
    const calls = [];
    const job = {};
    const documents = await collectWorkloadEvidence({
      workspace, tenantId, actorId, job, signal: new AbortController().signal, graphRequest: graph,
      execute: async args => { calls.push(args); writeOutput(args); }
    });
    assert.equal(calls.length, 4);
    for (const args of calls) {
      assert.ok(args.includes("-InstallMissingModules"));
      assert.equal(valueOf(args, "-TenantId"), tenantId);
      assert.equal(fs.existsSync(valueOf(args, "-OutputPath")), false);
    }
    assert.equal(valueOf(calls[1], "-SharePointAdminUrl"), "https://synthetic-admin.sharepoint.com");
    assert.equal(Object.keys(documents.admin.evidence).length, 3);
    assert.equal(documents.admin.collectionMetadata.workloads.purview.actorId, actorId);
    assert.equal(documents.admin.connections.sharePointOnline.actorId, null);
    assert.equal(documents.admin.connections.sharePointOnline.tenantVerified, false);
    assert.equal(documents.admin.commandResults["sharePointOnline:Get-Synthetic"].boundary.coverageComplete, false);
    assert.deepEqual(job.collectionSummary, { requested: 4, collected: 3, withGaps: 1, failed: 0 });
    assert.equal(documents.powerPlatform.errors.agents.code, "ACCESS_DENIED");
    assert.deepEqual(job.workloads[3].issues, [
      { resource: "agents", code: "ACCESS_DENIED", message: "Synthetic permission denial" }
    ]);
    assert.deepEqual(fs.readdirSync(workspace), []);
  });
});

test("a failed workload cannot substitute stale evidence and does not block other services", async () => {
  await inWorkspace(async workspace => {
    const job = {};
    const docs = await collectWorkloadEvidence({
      workspace, tenantId, actorId, job, graphRequest: graph,
      execute: async args => {
        if (valueOf(args, "-Workloads") === "exchangeOnline") throw new Error("Synthetic Exchange role denied");
        writeOutput(args);
      }
    });

    assert.equal(job.workloads[0].status, "failed");
    assert.equal(job.workloads[3].status, "collected-with-gaps");
    fs.writeFileSync(path.join(workspace, "admin-evidence.json"), JSON.stringify(docs.admin));
    const adapter = createAdminCommandAdapter(workspace, { verifyDocument: () => true });
    await assert.rejects(adapter({ tenantId, service: "exchangeOnline", command: "Get-Synthetic" }),
      { code: "AUTOMATIC_COLLECTION_FAILED", message: "Synthetic Exchange role denied" });
    assert.deepEqual(await adapter({ tenantId, service: "purview", command: "Get-Synthetic" }), [{ observed: true }]);
  });
});

test("administrator observations are retained separately and cross-service observation keys are rejected", async () => {
  for (const crossService of [false, true]) await inWorkspace(async workspace => {
    const job = {};
    const key = `${crossService ? "exchangeOnline" : "sharePointOnline"}:Get-Synthetic`;
    const documents = await collectWorkloadEvidence({
      workspace, tenantId, actorId, job, graphRequest: graph, workloads: ["sharePointOnline"],
      execute: async args => {
        const document = documentFor(args);
        document.evidence = {};
        document.observations = { [key]: [{ id: "observed-site" }] };
        document.errors = { "sharePointOnline:Get-Synthetic": { code: "COMMAND_WARNING", message: "Incomplete source rows." } };
        writeOutput(args, document);
      }
    });
    if (crossService) {
      assert.equal(job.workloads[0].status, "failed");
      assert.match(job.workloads[0].message, /outside its requested service/);
      assert.deepEqual(documents.admin.observations, {});
    } else {
      assert.deepEqual(documents.admin.observations[key], [{ id: "observed-site" }]);
      assert.equal(job.workloads[0].resourceCounts[0].rows, 1);
      assert.equal(job.workloads[0].resourceCounts[0].acceptedRows, 0);
    }
    assert.deepEqual(documents.admin.evidence, {});
  });
});

test("all-command failure details reach the workload panel and persist without admitting evidence", async () => {
  const issue = { resource: "sharePointOnline:Get-SPOSite:restrictedContent",
    code: "COMMAND_ACCESS_DENIED", message: "The service denied this read." };
  for (const wrongScope of [false, true]) await inWorkspace(async workspace => {
    const job = {};
    const diagnostic = { code: "WORKLOAD_COLLECTION_FAILED", message: "No commands succeeded.",
      issues: [{ ...issue, ...(wrongScope ? { resource: "purview:Get-LabelPolicy" } : {}) }] };
    const docs = await collectWorkloadEvidence({
      workspace, tenantId, actorId, job, graphRequest: graph, workloads: ["sharePointOnline"],
      execute: async () => { throw collectorErrorFromOutput(`AFD_COLLECTOR_ERROR:${JSON.stringify(diagnostic)}`, 1); }
    });
    assert.equal(job.workloads[0].status, "failed");
    assert.equal(job.workloads[0].errors, 1);
    assert.equal(job.workloads[0].issues[0].code,
      wrongScope ? "DIAGNOSTIC_SCOPE_MISMATCH" : "COMMAND_ACCESS_DENIED");
    assert.deepEqual(docs.admin.collectionMetadata.workloads.sharePointOnline.issues, job.workloads[0].issues);
    assert.deepEqual(docs.admin.evidence, {});
    assert.deepEqual(docs.admin.connections, {});
    assert.deepEqual(fs.readdirSync(workspace), []);
  });
});

test("actual fatal administrator producer diagnostics survive Node ingestion without raw exceptions",
  { skip: process.platform !== "win32", timeout: 90000 }, async () => {
    const scopedTenant = "11111111-1111-4111-8111-111111111111";
    const executable = path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    for (const [scenario, service] of [["allDenied", "sharePointOnline"], ["authConditionalAccess", "purview"]]) {
      await inWorkspace(async workspace => {
        const job = {};
        const documents = await collectWorkloadEvidence({
          workspace, tenantId: scopedTenant, actorId, job, workloads: [service],
          graphRequest: async request => request.url.includes("/organization?")
            ? { value: [{ id: scopedTenant }] } : { webUrl: "https://synthetic.sharepoint.com/" },
          execute: async args => {
            const result = spawnSync(executable, [
              "-NoProfile", "-NonInteractive", "-File",
              path.join(__dirname, "scanner", "admin-collector-test-harness.ps1"),
              "-CollectorPath", valueOf(args, "-File"), "-WorkspacePath", valueOf(args, "-WorkspacePath"),
              "-ExpectedTenant", scopedTenant, "-Workload", service, "-Scenario", scenario,
              "-CollectionChallenge", valueOf(args, "-CollectionChallenge"), "-OutputPath", valueOf(args, "-OutputPath")
            ], { env: powerShellEnvironment(executable), encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024 });
            assert.equal(result.status, 0, result.error?.message || result.stderr);
            assert.doesNotMatch(result.stdout + result.stderr, /SENSITIVE_TEST_VALUE/);
            const marker = result.stdout.match(/ADMIN_TEST_RESULT:(.+)/);
            assert.ok(marker);
            const fixture = JSON.parse(marker[1]);
            assert.ok(fixture.failure);
            assert.deepEqual(fixture.files, []);
            throw collectorErrorFromOutput(result.stderr, 1);
          }
        });
        assert.equal(job.workloads[0].status, "failed");
        assert.deepEqual(documents.admin.evidence, {});
        const persisted = documents.admin.collectionMetadata.workloads[service];
        if (service === "sharePointOnline") {
          assert.equal(job.workloads[0].issues.length, 7);
          assert.ok(job.workloads[0].issues.every(issue => issue.code === "COMMAND_ACCESS_DENIED"));
          assert.deepEqual(persisted.issues, job.workloads[0].issues);
        } else {
          assert.match(job.workloads[0].message, /AUTH_CONDITIONAL_ACCESS.*AADSTS53003/);
          assert.match(persisted.message, /AADSTS53003/);
        }
        assert.deepEqual(fs.readdirSync(workspace), []);
      });
    }
  });

test("rejects forged tenant, challenge, producer, stale timestamp and cross-service output", async () => {
  const mutations = [
    doc => { doc.tenantId = actorId; },
    doc => { doc.collectionChallenge = "a-different-run"; },
    doc => { doc.producerId = "unsupported"; },
    doc => { delete doc.actorId; },
    doc => { doc.producedAt = new Date(Date.now() - 3600000).toISOString(); },
    doc => { doc.evidence["purview:Get-Synthetic"] = []; }
  ];
  for (const mutate of mutations) await inWorkspace(async workspace => {
    const job = {};
    const docs = await collectWorkloadEvidence({
      workspace, tenantId, actorId, job, workloads: ["exchangeOnline"],
      execute: async args => { const doc = documentFor(args); mutate(doc); writeOutput(args, doc); }
    });
    assert.equal(job.collectionSummary.failed, 1);
    assert.deepEqual(docs.admin.evidence, {});
  });
});

test("oversized or absent producer output is an explicit collection gap", async () => {
  for (const execute of [async args => writeOutput(args), async () => {}]) {
    await inWorkspace(async workspace => {
      const job = {};
      const docs = await collectWorkloadEvidence({
        workspace, tenantId, actorId, job, workloads: ["powerPlatform"], execute, maximumPackageBytes: 8
      });

      assert.equal(job.collectionSummary.failed, 1);
      assert.deepEqual(docs.powerPlatform.evidence, {});
      assert.equal(Object.keys(docs.powerPlatform.errors).length, 7);
    });
  }
});

test("SharePoint target binding rejects a different host or fabricated authenticated identity", async () => {
  for (const mutate of [
    doc => { doc.connections.sharePointOnline.adminUrl = "https://other-admin.sharepoint.com"; },
    doc => { doc.actorId = actorId; },
    doc => { doc.connections.sharePointOnline.tenantVerified = true; },
    doc => { doc.producerVersion = "1.0.0"; }
  ]) {
    await inWorkspace(async workspace => {
      const job = {};
      const docs = await collectWorkloadEvidence({
        workspace, tenantId, actorId, job, workloads: ["sharePointOnline"], graphRequest: graph,
        execute: async args => { const doc = documentFor(args); mutate(doc); writeOutput(args, doc); }
      });
      assert.equal(job.collectionSummary.failed, 1);
      assert.deepEqual(docs.admin.evidence, {});
    });
  }
});

test("timeouts become explicit gaps, cancellation stops the run and both remove transient files", async () => {
  await inWorkspace(async workspace => {
    const controller = new AbortController();
    const wait = async (args, signal) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    const job = {};
    const docs = await collectWorkloadEvidence({
      workspace, tenantId, actorId, job, workloads: ["powerPlatform"], execute: wait, timeoutMs: 10
    });
    assert.equal(job.workloads[0].status, "failed");
    assert.equal(Object.keys(docs.powerPlatform.errors).length, 7);
    assert.match(docs.powerPlatform.errors.environments.message, /timed out/);
    const pending = collectWorkloadEvidence({
      workspace, tenantId, actorId, job: {}, workloads: ["powerPlatform", "purview"],
      execute: wait, signal: controller.signal
    });
    controller.abort(new Error("Operator cancellation"));
    await assert.rejects(pending, /Operator cancellation/);
    assert.deepEqual(fs.readdirSync(workspace), []);
  });
});

test("real job pipeline automatically seals packages, refreshes a saved assessment and never sends Graph credentials to workload scripts", async () => {
  await inWorkspace(async workspace => {
    let baselineExecutions = 0;
    let workloadExecutions = 0;
    const token = `header.${Buffer.from(JSON.stringify({ tid: tenantId, oid: actorId })).toString("base64url")}.signature`;
    const baseScan = () => ({
      documentType: "tenant-scan", producer: "ai-flight-deck/scan-tenant.ps1",
      generatedAt: new Date().toISOString(), tenant: { tenantId },
      estateAssessment: { cohorts: [], controlResults: [], evaluatedControls: 0 }
    });

    await test("actual administration producer output is accepted by automatic ingestion without reshaping identity or version",
      { skip: process.platform !== "win32" }, async () => {
        await inWorkspace(async workspace => {
          const scopedTenant = "11111111-1111-4111-8111-111111111111";
          const job = {};
          const docs = await collectWorkloadEvidence({
            workspace, tenantId: scopedTenant, actorId, job,
            workloads: ["exchangeOnline", "sharePointOnline", "purview"],
            graphRequest: async request => request.url.includes("/organization?")
              ? { value: [{ id: scopedTenant }] } : { webUrl: "https://synthetic.sharepoint.com" },
            execute: async args => {
              const processResult = spawnSync(path.join(process.env.SystemRoot, "System32",
                "WindowsPowerShell", "v1.0", "powershell.exe"), [
                "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
                path.join(__dirname, "scanner", "admin-collector-test-harness.ps1"),
                "-CollectorPath", valueOf(args, "-File"), "-WorkspacePath", valueOf(args, "-WorkspacePath"),
                "-ExpectedTenant", scopedTenant, "-Workload", valueOf(args, "-Workloads"),
                "-CollectionChallenge", valueOf(args, "-CollectionChallenge"), "-OutputPath", valueOf(args, "-OutputPath")
              ], { encoding: "utf8", timeout: 30000 });
              assert.ifError(processResult.error);
              assert.equal(processResult.status, 0, processResult.stderr);
              const match = processResult.stdout.match(/ADMIN_TEST_RESULT:(.+)/);
              assert.ok(match, processResult.stdout);
              assert.equal(JSON.parse(match[1]).failure, null);
            }
          });
          assert.equal(job.collectionSummary.failed, 0, JSON.stringify(job.workloads));
          assert.equal(Object.keys(docs.admin.evidence).length, 31);
          assert.equal(Object.keys(docs.admin.commandResults).length, 31);
          assert.equal(docs.admin.connections.sharePointOnline.actorId, null);
          assert.equal(docs.admin.collectionMetadata.workloads.exchangeOnline.metadata.coverageComplete, false);
        });
      });
    const app = createApp({
      port: 0, workspace, workflowDependencies: {
        executable: "synthetic-powershell",
        acquireToken: async () => ({ value: token, tenantId, expiresAt: Date.now() + 3600000 }),
        executePowerShell: async (job, executable, args, environment) => {
          if (args.includes("-OutputPath")) {
            workloadExecutions++;
            assert.ok(executable.includes("WindowsPowerShell"));
            assert.equal(path.basename(executable), "powershell.exe");
            assert.deepEqual(environment, {});
            assert.equal(args.includes(token), false);
            writeOutput(args);
          } else if (args.includes("-Phase")) {
            baselineExecutions++;
            assert.equal(environment.FLIGHT_DECK_GRAPH_ACCESS_TOKEN, token);
            fs.writeFileSync(path.join(workspace, "baseline-scan.json"), JSON.stringify(baseScan()));
          }
        },
        collectWorkloads: options => collectWorkloadEvidence({ ...options, graphRequest: graph }),
        collectEstateEvidence: async ({ scan, verifyEvidencePackage }) => {
          for (const [kind, file] of [["admin", "admin-evidence.json"], ["powerPlatform", "power-platform-evidence.json"]]) {
            assert.equal(verifyEvidencePackage(kind, JSON.parse(fs.readFileSync(path.join(workspace, file), "utf8"))), true);
          }
          return scan;
        }
      }
    });
    await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${app.server.address().port}`;
    const post = action => fetch(`${origin}/api/jobs`, {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json", "X-Flight-Deck": "local-ui" },
      body: JSON.stringify({ action })
    });
    try {
      assert.equal((await post("workloads")).status, 400);
      for (const action of ["baseline", "workloads"]) {
        const start = await post(action);
        assert.equal(start.status, 202);
        const { id } = await start.json();
        let job;
        for (let attempt = 0; attempt < 100; attempt++) {
          job = await (await fetch(`${origin}/api/jobs/${id}`)).json();
          if (job.status !== "running") break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.equal(job.status, "completed", job.error);
        assert.equal(job.collectionSummary.withGaps, 1);
        const artifact = await (await fetch(`${origin}/api/artifacts/baseline`)).json();
        assert.equal(artifact.integrity.verifiedByLocalService, true);
        assert.equal(artifact.workloadCollection.workloads.length, 4);
      }
      assert.equal(baselineExecutions, 1);
      assert.equal(workloadExecutions, 8);
    } finally {
      await new Promise(resolve => app.server.close(resolve));
    }
  });
});
