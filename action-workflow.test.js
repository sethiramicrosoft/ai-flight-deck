"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { fixture, cohort, STATEMENTS } = require("./tests/action-fixture");
const { TECHNICAL, createActionStore } = require("./action-workflow");
const { createEvidenceEnvelope } = require("./evidence-integrity");
const { GRAPH_SCOPE_LIST } = require("./server");
const { handoff } = require("./action-workflow-ui");
const { observations, catalog } = require("./authority-test-fixtures");
const { policy } = require("./tests/conditional-access-fixture");

const fields = { scopeDescription: "Exact synthetic pilot; no production resources", owner: "Synthetic owner",
  team: "Synthetic team", responsibility: "local", prerequisitesConfirmed: true,
  prerequisites: "Reviewed the impact and rollback", approvalRecord: "User records approval by Synthetic approver, ref review:1" };
async function withFixture(run, options) {
  const f = await fixture(options);
  try { await run(f); } finally { await f.close(); }
}
async function list(f) {
  const response = await f.request("/api/actions"); assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body;
}
async function create(f, controlId = "AFD-LIC-002", extra = {}) {
  const contextId = (await list(f)).contexts[0].id;
  const res = await f.request("/api/actions", { contextId, controlId, ...extra });
  assert.equal(res.status, 200, JSON.stringify(res.body)); return res.body;
}
async function update(f, a, operation, extra = {}) {
  const res = await f.request(`/api/actions/${a.id}`, { revision: a.revision, operation, ...extra });
  assert.equal(res.status, 200, JSON.stringify(res.body)); return res.body;
}
async function complete(f, control = "AFD-LIC-002", overrides = {}) {
  let a = await create(f, control);
  a = await update(f, a, "start", { fields: { ...fields, ...overrides } });
  return update(f, a, "complete", { completionReport: "Synthetic administrator reports the reviewed work complete." });
}

test("actions persist across restart, dedupe retry/concurrent create, preserve proposal and reject stale edits", async () => withFixture(async f => {
  const a = await create(f);
  const ctx = a.context.id;
  const duplicate = await Promise.all([1, 2, 3].map(() => f.request("/api/actions", { controlId: a.controlId, contextId: ctx })));
  assert.ok(duplicate.every(r => r.body.id === a.id));
  const saved = await update(f, a, "save", { fields: { owner: "First owner", proposedWork: "Reviewed proposed change" } });
  assert.deepEqual(saved.proposal, a.proposal);
  const stale = await f.request(`/api/actions/${a.id}`, { revision: a.revision, operation: "save", fields: { owner: "Lost update" } });
  assert.equal(stale.status, 409);
  await f.restart();
  const persisted = (await list(f)).actions[0];
  assert.equal(persisted.fields.owner, "First owner");
  assert.ok(persisted.history.some(h => h.event === "save" && h.details.fields.owner === "First owner"));
  assert.equal(persisted.id, a.id);
}));

test("strict API rejects fake source facts, manually verified states, bad contexts, origins, fields and transitions", async () => withFixture(async f => {
  const contextId = (await list(f)).contexts[0].id;
  for (const body of [
    { contextId, controlId: "AFD-FAKE-001" }, { contextId: "other", controlId: "AFD-LIC-002" },
    { contextId, controlId: "AFD-LIC-002", sourceEvidence: { status: "Pass" } },
    { contextId, controlId: "AFD-LIC-002", status: "TechnicalVerification" }
  ]) assert.equal((await f.request("/api/actions", body)).status, 400);
  assert.equal((await f.request("/api/actions", { contextId, controlId: "AFD-LIC-002" }, { Origin: "https://evil.invalid" })).status, 403);
  assert.equal((await f.request("/api/actions", { contextId, controlId: "AFD-LIC-002" }, { "X-Flight-Deck": "" })).status, 403);
  const a = await create(f);
  for (const body of [
    { operation: "TechnicalVerification" }, { operation: "save", verification: "TechnicalVerification" },
    { operation: "save", fields: { status: "Pass" } },
    { operation: "complete", completionReport: "Not started" },
    { operation: "save", fields: { owner: "x".repeat(4001) } },
    { operation: "save", fields: { dueDate: "2026-02-30" } }
  ]) assert.equal((await f.request(`/api/actions/${a.id}`, { revision: a.revision, ...body })).status, 400);
  const before = fs.readFileSync(path.join(f.workspace, "baseline-scan.json"), "utf8");
  await update(f, a, "save", { fields: { owner: "<img src=x onerror=alert(1)>" } });
  assert.equal(fs.readFileSync(path.join(f.workspace, "baseline-scan.json"), "utf8"), before);
}));

test("approval-required and central/local hand-off flow block incomplete work; draft copy is not notification", async () => withFixture(async f => {
  let a = await create(f, "AFD-SPO-003");
  const blocked = await f.request(`/api/actions/${a.id}`, { revision: a.revision, operation: "start",
    fields: { ...fields, approvalRecord: "" } });
  assert.equal(blocked.status, 400); assert.match(blocked.body.error, /approval/);
  a = await update(f, a, "start", { fields: { ...fields, responsibility: "shared", centralRequest: "Please review pilot access" } });
  const response = await f.request(`/api/actions/${a.id}`, { revision: a.revision, operation: "complete", completionReport: "Done" });
  assert.equal(response.status, 400); assert.match(response.body.error, /central IT/);
  a = await update(f, a, "complete", { fields: { centralResponse: "Central owner reports done", centralEvidence: "review:central-1" }, completionReport: "Local owner recorded the response." });
  assert.equal(a.state, "ReportedComplete");
  assert.match(handoff(a), /Not sent, assigned or identity-verified/);
  assert.match(handoff(a), /review:central-1/);
  assert.equal(a.handoffDraft, handoff(a));
  assert.notEqual(a.proposal.handoffDraft, a.handoffDraft);
  assert.equal((await list(f)).actions[0].verification.disposition, "Unverified");
  assert.ok(GRAPH_SCOPE_LIST.filter(s => s.startsWith("https:")).every(s => !/Write|ReadWrite/i.test(s)));
}));

test("dependencies enforce existence, same context, no cycles/self and reported completion before start", async () => withFixture(async f => {
  let a = await create(f, "AFD-LIC-001"), b = await create(f, "AFD-LIC-002");
  const invalid = ids => f.request(`/api/actions/${a.id}`, { revision: a.revision, operation: "save", fields: { dependencies: ids } });
  assert.equal((await invalid([a.id])).status, 400);
  assert.equal((await invalid(["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"])).status, 400);
  a = await update(f, a, "save", { fields: { dependencies: [b.id] } });
  assert.equal((await f.request(`/api/actions/${b.id}`, { revision: b.revision, operation: "save", fields: { dependencies: [a.id] } })).status, 400);
  assert.equal((await f.request(`/api/actions/${a.id}`, { revision: a.revision, operation: "start", fields })).status, 400);
  b = await update(f, b, "start", { fields });
  await update(f, b, "complete", { completionReport: "Prerequisite work reported complete, not verified." });
  a = await update(f, a, "start", { fields });
  const different = { ...cohort, principalIds: ["user-2"] };
  f.seal(await f.assessment({ cohort: different }));
  const c = await create(f, "AFD-LIC-004");
  assert.equal((await f.request(`/api/actions/${c.id}`, { revision: c.revision, operation: "save", fields: { dependencies: [a.id] } })).status, 400);
}));

test("four technical contracts require genuinely new observations; old pass/reseal cannot close work", async () => withFixture(async f => {
  f.seal(await f.assessment({ observations: { ...observations, conditionalAccess: [policy()] } }));
  for (const id of TECHNICAL) await complete(f, id);
  let actions = (await list(f)).actions;
  assert.ok(actions.every(a => a.verification.disposition === "Unverified"));
  assert.ok(actions.every(a => /before completion/.test(a.verification.reason)));
  const oldScan = JSON.parse(fs.readFileSync(path.join(f.workspace, "baseline-scan.json"), "utf8"));
  oldScan.generatedAt = new Date().toISOString(); f.seal(oldScan);
  assert.ok((await list(f)).actions.every(a => a.verification.disposition === "Unverified"));
  await new Promise(r => setTimeout(r, 10));
  f.seal(await f.assessment());
  actions = (await list(f)).actions;
  assert.ok(actions.every(a => a.verification.disposition === "TechnicalVerification"), JSON.stringify(actions.map(a => a.verification)));
  assert.match(actions.find(a => a.controlId === "AFD-LIC-002").verification.reason, /cohort-wide/);
  const a = actions[0];
  assert.equal((await f.request(`/api/actions/${a.id}`, { revision: a.revision, operation: "save", fields: { owner: "Other" } })).status, 409);
  const reopened = await update(f, a, "reopen");
  assert.equal(reopened.verification.disposition, "Reopened");
  assert.equal((await list(f)).actions.find(x => x.id === a.id).verification.disposition, "Reopened");
}));

test("all eleven accountable statements are distinct from technical proof; all other 62 controls remain unverified", async () => withFixture(async f => {
  const unsupported = catalog.domains.flatMap(d => d.controls).filter(c => ![...TECHNICAL, ...STATEMENTS].includes(c.id));
  assert.equal(unsupported.length, 62);
  for (const id of STATEMENTS) await complete(f, id);
  for (const c of unsupported) await complete(f, c.id);
  await new Promise(r => setTimeout(r, 5));
  f.seal(await f.assessment({ statementIds: STATEMENTS }));
  const actions = (await list(f)).actions;
  for (const a of actions) {
    assert.equal(a.verification.disposition, STATEMENTS.includes(a.controlId) ? "SupportedOwnerStatement" : "Unverified",
      `${a.controlId}: ${a.verification.reason}`);
  }
}));

test("action-linked statements reject stale revisions and changed pilot scope before saving", async () => withFixture(async f => {
  await complete(f, "AFD-OPS-005");
  const a = (await list(f)).actions[0];
  const input = { actionId: a.id, actionRevision: a.revision, tenantId: a.context.tenantId,
    cohortId: a.context.cohort.id, controlId: a.controlId, decision: "Pass",
    expiresAt: new Date(Date.now() + 3600000).toISOString(), statement: "Synthetic review.",
    evidenceReferences: ["review:synthetic"], data: { technicalContact: "Technical owner",
      executiveContact: "Executive owner", tenantId: a.context.tenantId, reviewedAt: new Date().toISOString() } };
  assert.equal((await f.request("/api/attestations", { ...input, actionRevision: a.revision - 1 })).status, 409);
  assert.equal((await f.request("/api/attestations", input)).status, 201);
  f.seal(await f.assessment({ cohort: { ...cohort, principalIds: ["user-2"] } }));
  assert.equal((await f.request("/api/attestations", input)).status, 409);
  assert.equal((await f.request("/api/attestations")).body.attestations.length, 1);
}));

test("newer failing/unknown assessment reopens old satisfaction and changed cohorts are historical, never rebound", async () => withFixture(async f => {
  const a = await complete(f);
  f.seal(await f.assessment());
  assert.equal((await list(f)).actions[0].verification.disposition, "TechnicalVerification");
  const failing = structuredClone(observations); failing.users[0].assignedPlans = []; failing.users[0].assignedLicenses = [];
  f.seal(await f.assessment({ observations: failing }));
  let saved = (await list(f)).actions[0];
  assert.equal(saved.verification.disposition, "Reopened"); assert.equal(saved.verification.evidence.status, "Fail");
  assert.ok(saved.history.some(h => h.details.disposition === "TechnicalVerification"));
  f.seal(await f.assessment({ observations, cohort: { ...cohort, principalIds: ["user-1", "user-2"] } }));
  saved = (await list(f)).actions[0]; assert.equal(saved.historical, true);
  assert.equal(saved.context.id, a.context.id);
  assert.equal((await f.request(`/api/actions/${a.id}`, { revision: saved.revision, operation: "reopen" })).status, 409);
  const separate = await create(f);
  assert.notEqual(separate.id, a.id);
}));

test("expiry reopens satisfaction using a live evaluation clock, preserving old evidence history", async () => withFixture(async f => {
  await complete(f);
  f.seal(await f.assessment());
  const current = (await list(f)).actions[0];
  assert.equal(current.verification.disposition, "TechnicalVerification");
  const scan = JSON.parse(fs.readFileSync(path.join(f.workspace, "baseline-scan.json"), "utf8"));
  const later = new Date(Date.parse(current.verification.evidence.freshUntil) + 1);
  const store = createActionStore({ workspace: f.workspace, integrity: f.integrity,
    readBaseline: () => structuredClone(scan), readAssessment: () => structuredClone(scan), clock: () => later,
    writeJsonAtomic: (file, value) => fs.writeFileSync(file, JSON.stringify(value)) });
  const expired = store.list().actions[0];
  assert.equal(expired.verification.disposition, "Reopened");
  assert.match(expired.verification.reason, /expired/);
  assert.ok(expired.history.some(h => h.details.disposition === "TechnicalVerification"));
}));

test("a changed saved pilot selection suspends old satisfaction before re-collection", async () => withFixture(async f => {
  await complete(f);
  f.seal(await f.assessment());
  assert.equal((await list(f)).actions[0].verification.disposition, "TechnicalVerification");
  fs.writeFileSync(path.join(f.workspace, "cohort-config.json"), JSON.stringify({ ...cohort,
    principalIds: ["user-1", "user-2"] }));
  const data = await list(f);
  assert.equal(data.contexts.length, 0);
  assert.equal(data.actions[0].historical, true);
  assert.equal(data.actions[0].verification.disposition, "Reopened");
}));

test("latest assessment for a different/broader cohort cannot verify an action in the baseline context", async () => withFixture(async f => {
  await complete(f);
  f.seal(await f.assessment());
  assert.equal((await list(f)).actions[0].verification.disposition, "TechnicalVerification");
  const broad = await f.assessment({ cohort: { ...cohort, principalIds: ["user-1", "user-2"] } });
  f.seal(broad, "action-assessment");
  const a = (await list(f)).actions[0];
  assert.equal(a.historical, false);
  assert.equal(a.verification.disposition, "Reopened");
  assert.match(a.verification.reason, /different context/);
}));

test("forged raw Pass and receipt mutation cannot verify; old observedAt with new receipt is rejected", async () => withFixture(async f => {
  await complete(f);
  const raw = await f.assessment();
  const result = raw.estateAssessment.controlResults.find(r => r.controlId === "AFD-LIC-002");
  delete result.authority; result.status = "Pass";
  f.seal(raw);
  assert.equal((await list(f)).actions[0].verification.disposition, "Unverified");
  const forged = await f.assessment();
  const r = forged.estateAssessment.controlResults.find(r => r.controlId === "AFD-LIC-002");
  r.authority.evidenceRecord.payload.facts.outcome = "Fail";
  f.seal(forged);
  assert.equal((await list(f)).actions[0].verification.disposition, "Unverified");
  // Freshly sealing old receipt metadata is not recollection.
  const old = await f.assessment();
  const entry = old.estateAssessment.controlResults.find(r => r.controlId === "AFD-LIC-002");
  entry.observedAt = "2020-01-01T00:00:00.000Z";
  entry.authority.evidenceRecord = createEvidenceEnvelope({
    tenant: old.tenant.tenantId, producer: "ai-flight-deck/observation-receipt",
    payload: entry.authority.evidenceRecord.payload, generatedAt: new Date().toISOString(), ...f.integrity
  });
  f.seal(old);
  assert.equal((await list(f)).actions[0].verification.disposition, "Unverified");
}));

test("tampered, truncated and incompatible action stores fail explicitly without reset or external payload leaks", async () => withFixture(async f => {
  await create(f);
  const file = path.join(f.workspace, "guided-actions.json");
  const original = fs.readFileSync(file, "utf8");
  for (const content of [
    "{private-source-value",
    original.replace("Synthetic action pilot", "tampered pilot"),
    JSON.stringify(createEvidenceEnvelope({ tenant: "local-action-workspace", producer: "ai-flight-deck/guided-actions",
      payload: { schemaVersion: 999, actions: [] }, ...f.integrity }))
  ]) {
    fs.writeFileSync(file, content);
    const error = await f.request("/api/actions");
    assert.equal(error.status, 409); assert.match(error.body.error, /corrupt/);
    assert.doesNotMatch(error.body.error, /private-source-value/);
    assert.equal(fs.readFileSync(file, "utf8"), content);
  }
}));

test("latest workload job assessment is used and corrupt assessment is not bypassed for a previous pass", async () => withFixture(async f => {
  await complete(f);
  const started = await f.request("/api/jobs", { action: "workloads" });
  assert.equal(started.status, 202);
  for (let i = 0; i < 100; i++) {
    const job = await f.request(`/api/jobs/${started.body.id}`);
    if (job.body.status === "completed") break;
    await new Promise(r => setTimeout(r, 10));
  }
  assert.equal((await list(f)).actions[0].verification.disposition, "TechnicalVerification");
  fs.writeFileSync(path.join(f.workspace, "action-assessment.json"), '{"private-source":true}');
  const error = await f.request("/api/actions");
  assert.equal(error.status, 400); assert.match(error.body.error, /intact/);
  assert.doesNotMatch(error.body.error, /private-source/);
}));

test("importing recommendations cannot resurrect an older baseline pass after a later comparison failed", async () => withFixture(async f => {
  await complete(f);
  f.seal(await f.assessment());
  assert.equal((await list(f)).actions[0].verification.disposition, "TechnicalVerification");
  const failing = structuredClone(observations);
  failing.users[0].assignedPlans = [];
  failing.users[0].assignedLicenses = [];
  f.seal(await f.assessment({ observations: failing }), "action-assessment");
  assert.equal((await list(f)).actions[0].verification.disposition, "Reopened");
  const imported = await f.request("/api/upstream-evidence", {
    sourceType: "microsoft-automated-readiness-assessment",
    fileName: "synthetic-recommendations.csv",
    reportedAt: new Date().toISOString(),
    upstreamVersion: "f542406ffba2066d943643de8d7a87b755b98cab",
    content: "Service,Feature,Status,Priority,Observation,Recommendation,LinkText,LinkUrl\r\nM365,Unverified feature,Success,Low,Observed,Review,,"
  });
  assert.equal(imported.status, 200, JSON.stringify(imported.body));
  const saved = (await list(f)).actions[0];
  assert.equal(saved.verification.disposition, "Reopened");
  assert.equal(saved.verification.evidence.status, "Fail");
}));
