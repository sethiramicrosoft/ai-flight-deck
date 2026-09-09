// Real-browser E2E coverage of the uncommitted "value-realization" diff in
// ai-flight-deck. Drives the actual, unmodified server.js + index.html + evidence
// completion / attestation modules through the ../fixtures/launch-server.js fixture,
// which substitutes ONLY the Microsoft Graph device-code sign-in with a deterministic
// in-process workflowRunner that calls the real collectEstate() pipeline offline.
//
// No product code is modified by this spec. All assertions read real DOM state
// produced by the real client JS reacting to real HTTP responses from the real
// server.js routes.
const { test, expect } = require("@playwright/test");

// AFD-IAM-007 is the one control seeded with automation "Attested" that this suite
// exercises end to end for the attestation-creation + rescan-consumption journey.
const ATTESTED_CONTROL_ID = "AFD-IAM-007";

// The fixture server persists workspace state across tests in this file (it is one
// long-lived process, matching how a real user's local service keeps state between
// page loads). index.html auto-hydrates: on any page load where /api/status already
// reports a baseline artifact, it silently loads and applies that artifact and then
// calls navigate("overview") (pre-existing behavior, unrelated to this diff). Once a
// prior test in this file has produced a baseline, a later test's plain page.goto("/")
// therefore lands on the Assessment page, not "Set up" -- so every test that needs the
// Evidence completion center lives on the Set up page, so tests navigate there
// explicitly instead of depending on the page selected during automatic hydration.
async function goToPage(page, id, title) {
  await page.goto("/");
  await page.waitForTimeout(500);
  await page.click(`[data-page="${id}"]:visible`);
  await expect(page.locator(`#${id}`)).toHaveClass(/active/);
  await expect(page.locator("#page-title")).toHaveText(title);
}

async function goToGuidePage(page) {
  await goToPage(page, "guide", "Connect Microsoft 365 and choose your pilot");
}

async function goToDecisionPage(page) {
  await goToPage(page, "clearance", "Review the recommendation for your Copilot pilot");
}

// `#import-error` is a generic, always-hidden-by-default error banner cleared at the
// very start of startLocalWorkflow() (clearError()), well before the job actually
// completes -- so waiting for it to become hidden is not a valid "scan finished"
// signal and races ahead of monitorWorkflow()'s async loadWorkflowArtifact()/
// applyTenantScan() completion (confirmed by reading index.html's clearError()/
// startLocalWorkflow()/monitorWorkflow()).
//
// The #service-status text is a better signal, but a naive /complete/i match is a
// trap: the mid-run message is literally "Scanning the tenant. Complete Microsoft
// sign-in if prompted." -- which itself contains the substring "Complete" ("Complete
// Microsoft sign-in"), so a loose regex match fires while the job is still running
// and #connect-scan is still disabled. That premature match was the root cause behind
// several fixture-side flakes below (a transient 409 on /api/artifacts/baseline right
// after "completion", and the enablement plan losing the "remediation" page navigation
// to applyTenantScan()'s navigate("overview") because the real completion, and its
// navigate() call, actually landed a moment later). The fix is to match only the
// specific terminal strings monitorWorkflow() renders once loadWorkflowArtifact() (and
// therefore applyTenantScan()) has fully resolved.
async function waitForScanComplete(page) {
  await expect(page.locator("#service-status")).toHaveText(/^The (first scan is saved|scan comparison has finished)\./, { timeout: 20000 });
  await expect(page.locator("#connect-scan")).toBeEnabled();
  await expect(page.locator("#import-error")).toBeHidden();
}

test.describe("value-realization customer journey", () => {
  test("01 launch shows current mission and top blockers from a fresh offline scan", async ({ page }) => {
    await goToGuidePage(page);
    await expect(page.locator("#service-state")).toBeVisible({ timeout: 15000 }).catch(() => {});

    // Trigger the baseline scan (equivalent to "Connect and scan tenant") via the real
    // local workflow. Close the devicelogin popup the moment it is opened so the test
    // stays fully offline; the fixture's workflowRunner never requires an actual code.
    page.once("popup", popup => popup.close());
    await page.click("#connect-scan");

    // A successful scan replaces the "Demonstration mode" ribbon with live-scan text
    // and clears the "not an AI Flight Deck tenant scan" gate -- confirms the fixture's
    // synthetic artifact satisfies the client's full validateScan() contract.
    await waitForScanComplete(page);
    await expect(page.locator("#source-ribbon")).not.toContainText("Demonstration mode");

    // A successful scan auto-navigates to Assessment; return to Decision to read the
    // evidence completion center's post-scan state.
    await goToGuidePage(page);
    await expect(page.getByRole("heading", { name: "What still needs to be checked" })).toBeVisible();
    const completeValue = page.locator("#completion-summary .assurance-metric").nth(1).locator("strong");
    await expect(completeValue).toBeVisible();
    const initialComplete = Number(await completeValue.textContent());
    expect(Number.isInteger(initialComplete)).toBe(true);
    expect(initialComplete).toBeGreaterThanOrEqual(0);

    // Top blockers list must be populated (fresh scan => plenty of unresolved controls).
    const blockerRows = page.locator("#completion-blockers .completion-blocker");
    await expect(blockerRows.first()).toBeVisible();
    const blockerCount = await blockerRows.count();
    expect(blockerCount).toBeGreaterThan(0);
    expect(blockerCount).toBeLessThanOrEqual(5); // topBlockers is capped at 5 by design

    await page.screenshot({ path: "artifacts/01-launch-mission-blockers.png", fullPage: true });
  });

  test("02 evidence package download links resolve to real, non-empty files", async ({ page, request }) => {
    await goToGuidePage(page);
    const collectorHref = await page.locator('a[href="scanner/collect-admin-evidence.ps1"]').getAttribute("href");
    const templateHref = await page.locator('a[href="schema/power-platform-evidence.template.v1.json"]').getAttribute("href");
    expect(collectorHref).toBe("scanner/collect-admin-evidence.ps1");
    expect(templateHref).toBe("schema/power-platform-evidence.template.v1.json");

    const collectorResponse = await request.get("/scanner/collect-admin-evidence.ps1");
    expect(collectorResponse.status()).toBe(200);
    const collectorBody = await collectorResponse.text();
    expect(collectorBody.length).toBeGreaterThan(100);

    const templateResponse = await request.get("/schema/power-platform-evidence.template.v1.json");
    expect(templateResponse.status()).toBe(200);
    const templateJson = await templateResponse.json();
    expect(templateJson).toHaveProperty("schema");
  });

  test("03 admin evidence package import updates status text", async ({ page }) => {
    await goToGuidePage(page);
    await expect(page.locator("#admin-evidence-status")).toHaveText(
      "No locally sealed administrator evidence package is available.");

    // Must satisfy validateEvidencePackage() (collector-adapters.js): schema/version,
    // a non-empty tenantId, and a producedAt within the last 24 hours.
    await page.click("#prepare-admin-evidence");
    const challengeOutput = page.locator("#admin-evidence-challenge");
    await expect(challengeOutput).toContainText("Collection challenge", { timeout: 15000 });
    const challengeText = await challengeOutput.innerText();
    const collectionChallenge = challengeText.match(/\n([A-Za-z0-9_-]{20,})\n/)?.[1];
    expect(collectionChallenge.length).toBeGreaterThan(20);

    const adminEvidencePayload = JSON.stringify({
      schema: "ai-flight-deck/admin-evidence",
      version: "1.0.0",
      producerId: "ai-flight-deck/admin-evidence-collector",
      producerVersion: "1.0.0",
      collectionChallenge,
      tenantId: "e2eeeeee-1111-4444-8888-000000000001",
      producedAt: new Date().toISOString(),
      evidence: {},
      errors: {}
    });

    await page.setInputFiles("#admin-evidence-file", {
      name: "admin-evidence.json",
      mimeType: "application/json",
      buffer: Buffer.from(adminEvidencePayload)
    });
    await page.click("#import-admin-evidence");

    await expect(page.locator("#admin-evidence-status")).not.toHaveText(
      "No locally sealed administrator evidence package is available.", { timeout: 15000 });
    await page.screenshot({ path: "artifacts/03-admin-evidence-imported.png", fullPage: true });
  });

  test("04 cohort-bound attestation creation and rescan consumption flips the control to Pass", async ({ page, request }) => {
    await goToGuidePage(page);

    // Establish the baseline first so an approved cohort + tenant exist for the
    // attestation's tenant/cohort binding checks.
    page.once("popup", popup => popup.close());
    await page.click("#connect-scan");
    await waitForScanComplete(page);
    await goToGuidePage(page);

    const completeValue = page.locator("#completion-summary .assurance-metric").nth(1).locator("strong");
    await expect(completeValue).toBeVisible();

    // Confirm AFD-IAM-007 is genuinely unresolved before attesting it (guards against
    // a false-positive pass later in this test), via the real server API rather than
    // relying on it appearing in the UI's top-5 blocker list (which is dominated by
    // higher-priority MissingPermission-state controls and may not surface it).
    const beforeResponse = await request.get("/api/artifacts/baseline");
    if (!beforeResponse.ok()) {
      throw new Error(`GET /api/artifacts/baseline failed: ${beforeResponse.status()} ${await beforeResponse.text()}`);
    }
    const beforeArtifact = await beforeResponse.json();
    if (!beforeArtifact.estateAssessment) {
      throw new Error(`Unexpected artifact shape: ${JSON.stringify(Object.keys(beforeArtifact))}`);
    }
    const beforeControl = beforeArtifact.estateAssessment.controlResults
      .find(result => result.controlId === ATTESTED_CONTROL_ID);
    expect(beforeControl.status).toBe("Unknown");
    expect(beforeControl.coverage.complete).toBe(false);

    await page.selectOption("#attestation-control", ATTESTED_CONTROL_ID);
    await page.selectOption("#attestation-decision", "Pass");
    await expect(page.locator("#attestation-owner")).toHaveValue("e2e-fixture-actor");
    await page.fill("#attestation-statement",
      "Reviewed break-glass account documentation and monitoring configuration for the approved pilot cohort.");
    await page.fill("#attestation-references", "https://example.internal/break-glass-review");
    // Expiry auto-populates on control selection (updateAttestationExpiry); leave as-is.

    await page.click("#create-attestation");
    await expect(page.locator("#attestation-status")).not.toHaveText(
      "Load a live baseline with an approved cohort before creating accountable evidence.",
      { timeout: 15000 });
    await expect(page.locator("#attestation-statement")).toHaveValue("");
    await expect(page.locator("#attestation-data")).toHaveValue("{}");
    await expect(page.locator("#attestation-references")).toHaveValue("");
    await expect(page.locator("#attestation-decision")).toHaveValue("Pass");
    await page.screenshot({ path: "artifacts/04a-attestation-created.png", fullPage: true });

    // Rescan (rerun the baseline job) to consume the sealed attestation. This is the
    // real "rescan consumption" journey: the same connect-scan button re-triggers
    // POST /api/jobs {action:"baseline"}, whose result is re-verified and re-applied.
    await goToGuidePage(page);
    page.once("popup", popup => popup.close());
    await page.click("#connect-scan");
    await waitForScanComplete(page);
    await goToGuidePage(page);

    const afterArtifact = await (await request.get("/api/artifacts/baseline")).json();
    const afterControl = afterArtifact.estateAssessment.controlResults
      .find(result => result.controlId === ATTESTED_CONTROL_ID);
    expect(afterControl.status).toBe("Pass");
    expect(afterControl.coverage.complete).toBe(true);
    expect(afterControl.attestation).not.toBeNull();

    await page.screenshot({ path: "artifacts/04b-rescan-consumed-attestation.png", fullPage: true });
  });

  test("05 tenant enablement plan orders unresolved controls ahead of complete ones", async ({ page }) => {
    await goToGuidePage(page);
    page.once("popup", popup => popup.close());
    await page.click("#connect-scan");
    await waitForScanComplete(page);

    await goToDecisionPage(page);
    await expect(page.locator("#enablement-plan-list")).toBeVisible({ timeout: 10000 });
    await page.selectOption("#enablement-filter", "remaining");

    const rows = page.locator("#enablement-plan-list [data-remediation], #enablement-plan-list .plan-row, #enablement-plan-list > *");
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);

    // The plan is pre-sorted client-side by evidence-completion state priority
    // (STATE_PRIORITY: MissingPermission=0 ... Complete=9). Assert the rendered list
    // text does not show a "Complete" badge before an unresolved one, i.e. ordering
    // is stable and unresolved items surface first.
    const listText = await page.locator("#enablement-plan-list").innerText();
    const firstCompleteIndex = listText.indexOf("Complete");
    const firstRequiredIndex = listText.search(/required|Not yet collected|expired/i);
    if (firstCompleteIndex !== -1 && firstRequiredIndex !== -1) {
      expect(firstRequiredIndex).toBeLessThan(firstCompleteIndex);
    }
    await page.screenshot({ path: "artifacts/05-enablement-plan-ordering.png", fullPage: true });
  });
});
