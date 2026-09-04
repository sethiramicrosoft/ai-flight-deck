const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createApp, GRAPH_SCOPE_LIST } = require("./server");

async function withServer(workflowRunner, action) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "flight-deck-test-"));
  const { server } = createApp({
    port: 0,
    workspace,
    workflowRunner: (job, workflowAction, signal) =>
      workflowRunner(job, workflowAction, signal, workspace)
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    await action({ port, workspace });
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

test("requests the delegated information protection scope supported by device authentication", () => {
  assert.equal(
    GRAPH_SCOPE_LIST.includes("https://graph.microsoft.com/InformationProtectionPolicy.Read"),
    true
  );
  assert.equal(
    GRAPH_SCOPE_LIST.includes("https://graph.microsoft.com/InformationProtectionPolicy.Read.All"),
    false
  );
});

test("serves status and rejects cross-origin workflow requests", async () => {
  await withServer(async () => "baseline", async ({ port }) => {
    const status = await fetch(`http://127.0.0.1:${port}/api/status`);
    assert.equal(status.status, 200);
    assert.equal((await status.json()).ready, true);

    const capabilities = await fetch(`http://127.0.0.1:${port}/api/capabilities`);
    const capabilityBody = await capabilities.json();
    assert.equal(capabilities.status, 200);
    assert.equal(capabilityBody.plans.length, 13);
    assert.equal(capabilityBody.plans.flatMap(plan => plan.unavailableControls).length, 77);

    const rejected = await fetch(`http://127.0.0.1:${port}/api/jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Flight-Deck": "local-ui",
        Origin: "https://untrusted.invalid"
      },
      body: JSON.stringify({ action: "baseline" })
    });
    assert.equal(rejected.status, 403);
  });
});

test("runs a fixed baseline job and serves its sealed artifact", async () => {
  await withServer(async (job, action, signal, workspace) => {
    assert.equal(action, "baseline");
    fs.writeFileSync(path.join(workspace, "baseline-scan.json"), JSON.stringify({
      documentType: "tenant-scan",
      producer: "ai-flight-deck/scan-tenant.ps1",
      generatedAt: "2026-09-04T09:00:00.000Z",
      tenant: { tenantId: "11111111-1111-1111-1111-111111111111" },
      estateAssessment: { cohorts: [{ id: "tenant-wide" }], controlResults: [] },
      evidenceSets: { broadAccessSiteIds: [], sharedItemIds: [] },
      evidenceGraph: {
        version: 1,
        minimized: true,
        tenantId: "11111111-1111-1111-1111-111111111111",
        nodes: [],
        edges: []
      }
    }));
    return "baseline";
  }, async ({ port, workspace }) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Flight-Deck": "local-ui"
      },
      body: JSON.stringify({ action: "baseline" })
    });
    assert.equal(response.status, 202);
    const { id } = await response.json();
    await new Promise(resolve => setTimeout(resolve, 20));
    const job = await fetch(`http://127.0.0.1:${port}/api/jobs/${id}`);
    assert.equal((await job.json()).status, "completed");

    const artifact = await fetch(`http://127.0.0.1:${port}/api/artifacts/baseline`);
    assert.equal(artifact.status, 200);
    const body = await artifact.json();
    assert.equal(body.documentType, "tenant-scan");
    assert.equal(body.integrity.verifiedByLocalService, true);
    assert.equal(typeof body.evidenceGraphEnvelope.signature, "string");

    const history = await fetch(`http://127.0.0.1:${port}/api/control-history`);
    assert.equal(history.status, 200);
    assert.deepEqual((await history.json()).histories, {});

    const binding = await fetch(`http://127.0.0.1:${port}/api/action-bindings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Flight-Deck": "local-ui"
      },
      body: JSON.stringify({
        selectedEvidenceIds: ["evidence-1"],
        actionPackage: { action: "review" }
      })
    });
    assert.equal(binding.status, 200);
    assert.match((await binding.json()).baselineDigest, /^sha256:/);

    const controlBinding = await fetch(`http://127.0.0.1:${port}/api/action-bindings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Flight-Deck": "local-ui"
      },
      body: JSON.stringify({
        selectedEvidenceIds: [],
        selectedControlIds: ["AFD-IAM-002"],
        actionPackage: { action: "block-legacy-authentication" }
      })
    });
    assert.equal(controlBinding.status, 200);
    assert.deepEqual((await controlBinding.json()).selectedControlIds, ["AFD-IAM-002"]);

    fs.writeFileSync(path.join(workspace, "baseline-scan.json"), JSON.stringify({
      documentType: "tampered"
    }));
    const tampered = await fetch(`http://127.0.0.1:${port}/api/artifacts/baseline`);
    assert.equal(tampered.status, 400);
    assert.match((await tampered.json()).error, /no longer matches/);
  });
});

test("reuses the workspace integrity key and verifies artifacts after restart", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "flight-deck-restart-test-"));
  const workflowRunner = async () => {
    fs.writeFileSync(path.join(workspace, "baseline-scan.json"), JSON.stringify({
      documentType: "tenant-scan",
      producer: "ai-flight-deck/scan-tenant.ps1",
      generatedAt: "2026-09-04T09:00:00.000Z",
      tenant: { tenantId: "11111111-1111-1111-1111-111111111111" },
      estateAssessment: { cohorts: [], controlResults: [] },
      evidenceGraph: {
        version: 1,
        minimized: true,
        tenantId: "11111111-1111-1111-1111-111111111111",
        nodes: [],
        edges: []
      }
    }));
    return "baseline";
  };

  async function start() {
    const { server } = createApp({ port: 0, workspace, workflowRunner });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    return { server, port: server.address().port };
  }

  let first;
  let second;
  try {
    first = await start();
    const started = await fetch(`http://127.0.0.1:${first.port}/api/jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Flight-Deck": "local-ui"
      },
      body: JSON.stringify({ action: "baseline" })
    });
    const { id } = await started.json();
    await new Promise(resolve => setTimeout(resolve, 20));
    const completed = await fetch(`http://127.0.0.1:${first.port}/api/jobs/${id}`);
    assert.equal((await completed.json()).status, "completed");
    const beforeRestart = await fetch(`http://127.0.0.1:${first.port}/api/artifacts/baseline`);
    const beforeBody = await beforeRestart.json();
    assert.equal(beforeRestart.status, 200);
    await new Promise(resolve => first.server.close(resolve));
    first = null;

    second = await start();
    const afterRestart = await fetch(`http://127.0.0.1:${second.port}/api/artifacts/baseline`);
    const afterBody = await afterRestart.json();
    assert.equal(afterRestart.status, 200);
    assert.equal(afterBody.integrity.verifiedByLocalService, true);
    assert.equal(afterBody.integrity.keyId, beforeBody.integrity.keyId);
    assert.equal(afterBody.integrity.envelopeDigest, beforeBody.integrity.envelopeDigest);
  } finally {
    if (first) await new Promise(resolve => first.server.close(resolve));
    if (second) await new Promise(resolve => second.server.close(resolve));
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("rejects arbitrary workflow actions", async () => {
  await withServer(async () => "baseline", async ({ port }) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Flight-Deck": "local-ui"
      },
      body: JSON.stringify({ action: "run-any-command" })
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /Unsupported workflow action/);
  });
});

test("cancels an active workflow and clears authentication state", async () => {
  await withServer(async (job, action, signal) => {
    assert.equal(action, "baseline");
    job.auth = { userCode: "TEST-CODE" };
    await new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  }, async ({ port }) => {
    const started = await fetch(`http://127.0.0.1:${port}/api/jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Flight-Deck": "local-ui"
      },
      body: JSON.stringify({ action: "baseline" })
    });
    const { id } = await started.json();
    const cancelled = await fetch(`http://127.0.0.1:${port}/api/jobs/${id}`, {
      method: "DELETE",
      headers: { "X-Flight-Deck": "local-ui" }
    });
    assert.equal(cancelled.status, 202);
    await new Promise(resolve => setTimeout(resolve, 20));
    const response = await fetch(`http://127.0.0.1:${port}/api/jobs/${id}`);
    const job = await response.json();
    assert.equal(job.status, "cancelled");
    assert.equal(job.auth, null);
  });
});
