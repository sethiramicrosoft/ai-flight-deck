"use strict";
const { test, expect } = require("@playwright/test");
const baseURL = process.env.AFD_E2E_BASE_URL || "http://127.0.0.1:9453";
const headers = { Origin: baseURL, "X-Flight-Deck": "local-ui" };
async function scan(request) {
  const start = await request.post(`${baseURL}/api/jobs`, { headers, data: { action: "baseline" } });
  expect(start.ok(), await start.text()).toBeTruthy();
  const { id } = await start.json();
  for (let n = 0; n < 200; n++) {
    const job = await (await request.get(`${baseURL}/api/jobs/${id}`)).json();
    if (job.status === "completed") return;
    if (job.status === "failed") throw new Error(job.error);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("Offline baseline job did not complete.");
}

test("real service admits signed evidence; legacy/forged passes remain blockers in every browser reader", async ({ page, request }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await scan(request);
  const baseline = await (await request.get(`${baseURL}/api/artifacts/baseline`)).json();
  expect(baseline.estateAssessment.controlResults).toHaveLength(77);
  const signed = await request.post(`${baseURL}/api/attestations`, { headers, data: {
    tenantId: baseline.tenant.tenantId,
    cohortId: baseline.estateAssessment.cohorts[0].id,
    controlId: "AFD-IAM-007", decision: "Pass",
    statement: "Synthetic offline owner reviewed break-glass account exclusions and monitoring.",
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    evidenceReferences: ["review:offline-security-evidence"],
    data: { accountRef: "offline-account", owner: "offline-owner",
      exclusionEvidenceRef: "review:offline-exclusions", monitoringAlertRef: "review:offline-alert" }
  } });
  expect(signed.ok(), await signed.text()).toBeTruthy();
  await scan(request);
  await page.goto(baseURL);
  await page.waitForFunction(() => typeof baselineScan !== "undefined" && baselineScan !== null);
  const states = await page.evaluate(() => {
    const r = baselineScan.estateAssessment.controlResults.find(r => r.controlId === "AFD-IAM-007");
    const legacy = JSON.parse(JSON.stringify(r));
    delete legacy.authority;
    const forged = { ...legacy, status: "Pass", authority: { validationStatus: "Verified" } };
    const readers = result => [
      FlightDeckMissionEngine.evaluateControl(result, new Date()).satisfied,
      FlightDeckEnablement.isSatisfied(result),
      FlightDeckEvidenceCompletion.completeResult(result, new Date())
    ];
    return {
      status: r.status, admitted: readers(r), legacy: readers(legacy), forged: readers(forged),
      explanation: FlightDeckEvidenceAdmissibility.describeEvidence(legacy),
      confidence: FlightDeckEvidenceAdmissibility.describeEvidence(r),
      blocked: document.querySelector("#decision-blockers").textContent,
      csv: controlsCsv()
    };
  });
  expect(states.status).toBe("Pass");
  expect(states.admitted).toEqual([true, true, true]);
  expect(states.legacy).toEqual([false, false, false]);
  expect(states.forged).toEqual([false, false, false]);
  expect(states.explanation).toMatch(/Recollect.*legacy/);
  expect(states.confidence).toContain("Accountable signed statement");
  expect(states.confidence).not.toMatch(/NotRequired|independent validation/);
  expect(states.csv).toContain("Evidence Decision");
  expect(states.blocked).not.toContain("AFD-IAM-007");
  const imported = await page.evaluate(() => {
    const legacyScan = JSON.parse(JSON.stringify(baselineScan));
    for (const row of legacyScan.estateAssessment.controlResults) delete row.authority;
    applyTenantScan(legacyScan);
    return { text: document.body.textContent, csv: controlsCsv(),
      badges: [...document.querySelectorAll("#decision-blockers .control-badge")].map(b => b.textContent),
      complete: FlightDeckEvidenceCompletion.buildEvidenceCompletionPlan({
        catalog: readinessCatalog, controlResults: baselineScan.estateAssessment.controlResults,
        cohort: baselineScan.estateAssessment.cohorts[0]
      }).summary.complete };
  });
  expect(imported.complete).toBe(0);
  expect(imported.badges.every(b => b === "Unknown")).toBe(true);
  expect(imported.text).toMatch(/Recollect evidence.*legacy/);
  expect(imported.csv).toContain("Confidence not reported");
  expect(errors).toEqual([]);
});
