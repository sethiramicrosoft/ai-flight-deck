"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createApp } = require("./server");
const { createEvidenceEnvelope } = require("./evidence-integrity");
const tenantId = "11111111-1111-1111-1111-111111111111";
const userId = "22222222-2222-2222-2222-222222222222";
const actorId = "33333333-3333-3333-3333-333333333333";
const syntheticAccessToken = `e30.${Buffer.from(JSON.stringify({ tid: tenantId, oid: actorId })).toString("base64url")}.synthetic`;
const directoryUser = { id: userId, displayName: "Synthetic", userPrincipalName: "pilot@example.test", accountEnabled: true };

async function fixture(run, dependencies = {}) {
  const workspace = fs.mkdtempSync(path.join(__dirname, ".setup-decisions-test-"));
  const key = crypto.randomBytes(32);
  fs.writeFileSync(path.join(workspace, "integrity-key.bin"), key);
  const baseline = { documentType: "tenant-scan", producer: "synthetic",
    generatedAt: new Date().toISOString(), tenant: { tenantId }, auth: { actor: { id: actorId } },
    estateAssessment: { cohorts: [{ id: "pilot", approved: false }], controlResults: [], evaluatedControls: 0 } };
  fs.writeFileSync(path.join(workspace, "baseline-scan.json"), JSON.stringify(baseline));
  fs.writeFileSync(path.join(workspace, "baseline-scan.envelope.json"), JSON.stringify(createEvidenceEnvelope({
    tenant: tenantId, producer: "synthetic", payload: baseline, key, keyId: "test"
  })));
  let signins = 0;
  const app = createApp({ port: 0, workspace, workflowDependencies: {
    executePowerShell: () => assert.fail("Directory actions must not execute PowerShell"),
    collectWorkloads: () => assert.fail("Directory actions must not collect workloads"),
    acquireToken: async job => {
      signins++;
      job.auth = { userCode: "synthetic-code" };
      return { value: syntheticAccessToken, tenantId, expiresAt: Date.now() + 3600000 };
    },
    graphQuery: token => {
      assert.equal(token, syntheticAccessToken);
      return async ({ url }) => new URL(url).pathname.endsWith("/users") ? { value: [directoryUser] } : directoryUser;
    },
    collectEstateEvidence: async ({ scan, configuredCohort, rawToken, adapters }) => {
      assert.equal(rawToken, syntheticAccessToken);
      assert.equal(typeof adapters.graphRequest, "function");
      return { ...scan, estateAssessment: { ...scan.estateAssessment, cohorts: [configuredCohort] } };
    }, ...dependencies
  } });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const request = async (route, body, method = body ? "POST" : "GET", headers = {}) => {
    const response = await fetch(`${origin}${route}`, { method, headers: {
      Origin: origin, "X-Flight-Deck": "local-ui", "Content-Type": "application/json", ...headers
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const wait = async id => {
    for (let i = 0; i < 200; i++) {
      const job = (await request(`/api/jobs/${id}`)).body;
      if (!["running", "cancelling"].includes(job.status)) return job;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.fail("Synthetic job did not finish");
  };
  try { await run({ ...app, workspace, request, wait, signins: () => signins }); }
  finally {
    await new Promise(resolve => app.server.close(resolve));
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

test("pilot re-evaluation cannot attribute a different or unknown signed-in actor to the saved baseline", async () => {
  for (const value of ["synthetic-unknown-actor", `e30.${Buffer.from(JSON.stringify({ tid: tenantId, oid: userId })).toString("base64url")}.synthetic`]) {
    await fixture(async ({ request, wait, workspace }) => {
      const before = fs.readFileSync(path.join(workspace, "baseline-scan.json"), "utf8");
      const search = await request("/api/directory-search", { query: "Synthetic", kind: "users" });
      assert.equal((await wait(search.body.id)).status, "completed");
      const approval = await request("/api/directory-cohort", {
        directoryJobId: search.body.id, selectedIds: [userId], name: "Pilot", owner: "Owner", approved: true
      });
      const outcome = await wait(approval.body.id);
      assert.equal(outcome.status, "failed");
      assert.match(outcome.error, /account that created the baseline/);
      assert.equal(fs.readFileSync(path.join(workspace, "baseline-scan.json"), "utf8"), before);
      assert.equal(fs.existsSync(path.join(workspace, "cohort-config.json")), false);
    }, {
      acquireToken: async () => ({ value, tenantId, expiresAt: Date.now() + 3600000 }),
      graphQuery: () => async () => ({ value: [directoryUser] }),
      collectEstateEvidence: () => assert.fail("Actor mismatch must stop before collection")
    });
  }
});

test("setup GET performs no auth; choices are signed local context, preserve baseline and reject origin/tampering", async () => {
  await fixture(async ({ request, workspace, signins }) => {
    assert.equal((await request("/api/status")).body.setupDecisionWorkflows, true);
    const before = fs.readFileSync(path.join(workspace, "baseline-scan.json"), "utf8");
    const initial = await request("/api/setup-decisions");
    assert.deepEqual(initial.body, { tenantId, cohortId: "pilot", decisions: {} });
    assert.equal(signins(), 0);
    const decision = { kind: "hybridExchange", value: "no", owner: "Owner", rationale: "Local planning only", cohortId: "pilot" };
    assert.equal((await request("/api/setup-decisions", decision, "POST", { Origin: "https://evil.invalid" })).status, 403);
    assert.equal((await request("/api/setup-decisions", { ...decision, owner: "" })).status, 400);
    assert.equal((await request("/api/setup-decisions", decision)).status, 200);
    const second = await request("/api/setup-decisions", { ...decision, kind: "webGrounding", value: "undecided" });
    assert.equal(second.body.decisions.hybridExchange.value, "no");
    assert.equal(second.body.decisions.webGrounding.value, "undecided");
    assert.equal(fs.readFileSync(path.join(workspace, "baseline-scan.json"), "utf8"), before);
    const file = path.join(workspace, "setup-decisions.json");
    const stored = JSON.parse(fs.readFileSync(file, "utf8"));
    stored.document.decisions.hybridExchange.value = "yes";
    fs.writeFileSync(file, JSON.stringify(stored));
    assert.equal((await request("/api/setup-decisions")).status, 400);
  });
});

test("setup decisions reject a validly signed document from another tenant instead of hiding it", async () => {
  await fixture(async ({ request, workspace }) => {
    const document = { tenantId: "other-tenant", cohortId: "pilot", decisions: {} };
    const envelope = createEvidenceEnvelope({
      tenant: document.tenantId, producer: "ai-flight-deck/local-setup-decisions",
      payload: document, key: fs.readFileSync(path.join(workspace, "integrity-key.bin")), keyId: "test"
    });
    fs.writeFileSync(path.join(workspace, "setup-decisions.json"), JSON.stringify({ document, envelope }));
    const response = await request("/api/setup-decisions");
    assert.equal(response.status, 400);
    assert.match(response.body.error, /another tenant/);
    assert.equal(Object.hasOwn(response.body, "decisions"), false);
  });
});

test("serves the fixed setup, sharing and completion browser assets without exposing other files", async () => {
  await fixture(async ({ server }) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const asset of ["sharing-review.js", "sharing-review-ui.js", "setup-workflows.js", "completion-center-ui.js"]) {
      const response = await fetch(`${origin}/${asset}`);
      assert.equal(response.status, 200, asset);
      assert.match(response.headers.get("content-type"), /javascript/);
      assert.ok((await response.text()).length > 0);
    }
    assert.equal((await fetch(`${origin}/setup-decisions.js`)).status, 404);
  });
});

test("directory search and approval reuse protected auth, enrich baseline and expire previous choices", async () => {
  await fixture(async ({ request, wait, workspace, signins, jobs }) => {
    await request("/api/setup-decisions", { kind: "hybridExchange", value: "yes", owner: "Owner", rationale: "Planning", cohortId: "pilot" });
    const search = await request("/api/directory-search", { query: "Pilot", kind: "users" });
    assert.equal(search.status, 202);
    const result = await wait(search.body.id);
    assert.equal(result.status, "completed");
    assert.equal(result.result, "directory");
    assert.equal(result.directoryResult.items.length, 1);
    assert.equal(result.auth, null);
    assert.equal(JSON.stringify(result).includes("synthetic-token"), false);
    assert.equal((await request("/api/jobs", { action: "directorySearch" })).status, 400);
    const selection = { directoryJobId: search.body.id, selectedIds: [userId], approved: true, name: "Pilot", owner: "Owner" };
    assert.equal((await request("/api/directory-cohort", { ...selection, selectedIds: [tenantId] })).status, 400);
    const saved = await request("/api/directory-cohort", selection);
    const applied = await wait(saved.body.id);
    assert.equal(applied.status, "completed", applied.error);
    assert.equal(applied.result, "baseline");
    assert.equal(signins(), 1);
    const cohort = JSON.parse(fs.readFileSync(path.join(workspace, "cohort-config.json")));
    assert.equal(cohort.tenantId, tenantId);
    assert.deepEqual(cohort.principalIds, [userId]);
    assert.deepEqual((await request("/api/setup-decisions")).body.decisions, {});
    assert.deepEqual((await request("/api/artifacts/baseline")).body.estateAssessment.controlResults, []);
    jobs.get(search.body.id).completedAt = "2000-01-01T00:00:00Z";
    assert.equal((await request("/api/directory-cohort", selection)).status, 400);
  });
});

test("failed approval restores prior cohort, baseline, seal and history without unsupported Pass", async () => {
  await fixture(async ({ request, wait, workspace }) => {
    const cohortPath = path.join(workspace, "cohort-config.json");
    fs.writeFileSync(cohortPath, '{"id":"previous","approved":false}');
    const files = ["cohort-config.json", "baseline-scan.json", "baseline-scan.envelope.json"];
    const before = files.map(file => fs.readFileSync(path.join(workspace, file), "utf8"));
    const search = await request("/api/directory-search", { query: "Pilot", kind: "users" });
    await wait(search.body.id);
    const next = await request("/api/directory-cohort", {
      directoryJobId: search.body.id, selectedIds: [userId], approved: true, name: "Pilot", owner: "Owner"
    });
    const job = await wait(next.body.id);
    assert.equal(job.status, "failed");
    assert.match(job.error, /authority|evidence|control|unsupported/i);
    assert.deepEqual(files.map(file => fs.readFileSync(path.join(workspace, file), "utf8")), before);
    assert.equal((await request("/api/artifacts/baseline")).status, 200);
  }, { collectEstateEvidence: async ({ scan, configuredCohort }) => ({
    ...scan, estateAssessment: { ...scan.estateAssessment, cohorts: [configuredCohort],
      controlResults: [{ controlId: "invented", status: "Pass" }] }
  }) });
});

test("directory authentication remains cancellable, keeps active guard until unwind and rejects wrong tenant", async () => {
  let ready;
  let release;
  const entered = new Promise(resolve => { ready = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  await fixture(async ({ request, wait }) => {
    const search = await request("/api/directory-search", { query: "Pilot", kind: "users" });
    await entered;
    const running = (await request(`/api/jobs/${search.body.id}`)).body;
    assert.equal(running.auth.userCode, "synthetic-code");
    const decision = { kind: "webGrounding", value: "restrict", owner: "Owner", rationale: "Planning", cohortId: "pilot" };
    assert.equal((await request("/api/setup-decisions", decision)).status, 409);
    assert.equal((await request(`/api/jobs/${search.body.id}`, null, "DELETE")).status, 202);
    assert.equal((await request("/api/directory-search", { query: "Pilot", kind: "users" })).status, 409);
    release();
    assert.equal((await wait(search.body.id)).status, "cancelled");
  }, { acquireToken: async job => {
    job.auth = { userCode: "synthetic-code" };
    ready();
    await blocked;
    return { value: "synthetic-token", tenantId, expiresAt: Date.now() + 3600000 };
  } });
  await fixture(async ({ request, wait }) => {
    const search = await request("/api/directory-search", { query: "Pilot", kind: "users" });
    const job = await wait(search.body.id);
    assert.equal(job.status, "failed");
    assert.match(job.error, /tenant identified by the baseline/);
  }, { acquireToken: async () => ({ value: "synthetic-token", tenantId: "other-tenant", expiresAt: Date.now() + 3600000 }),
    graphQuery: () => assert.fail("Wrong-tenant tokens must not reach Graph") });
});

test("directory jobs distinguish access denied from unknown Graph errors without returning raw exceptions", async () => {
  for (const [code, httpStatus, pattern] of [
    ["Authorization_RequestDenied", 403, /access was denied/],
    ["InvalidAuthenticationToken", 401, /authentication was rejected/],
    ["TooManyRequests", 429, /throttled/],
    ["sensitive-unknown-code", undefined, /unknown reason/]
  ]) {
    await fixture(async ({ request, wait }) => {
      const search = await request("/api/directory-search", { query: "Pilot", kind: "users" });
      const job = await wait(search.body.id);
      assert.equal(job.status, "failed");
      assert.match(job.error, pattern);
      assert.equal(job.httpStatus, httpStatus);
      assert.equal(job.errorCode, httpStatus ? code : "DIRECTORY_REQUEST_FAILED");
      assert.equal(JSON.stringify(job).includes("sensitive-"), false);
    }, { graphQuery: () => async () => {
      throw Object.assign(new Error("sensitive-raw-exception"), { code });
    } });
  }
});
