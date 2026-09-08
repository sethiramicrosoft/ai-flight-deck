const { test, expect } = require("@playwright/test");

test("setup makes automatic collection the default and keeps optional imports collapsed", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", route => route.fulfill({
    status: 503, contentType: "application/json", body: JSON.stringify({ error: "Offline UI fixture" })
  }));
  await page.goto("/");
  await page.waitForFunction(() => typeof readinessCatalog !== "undefined" && readinessCatalog);
  for (const viewport of [{ width: 1440, height: 1080 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => navigate("guide"));
    const notice = page.locator("#automatic-workload-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("no scripts to run, exports to assemble, or JSON templates to fill");
    await expect(notice).toContainText("Accountable owner decisions still require human approval");
    expect(await notice.evaluate(element =>
      Boolean(element.compareDocumentPosition(document.getElementById("connect-scan")) & Node.DOCUMENT_POSITION_FOLLOWING)
    )).toBe(true);
    await expect(page.locator("#admin-evidence-file")).not.toBeVisible();
    await expect(page.locator("#power-platform-evidence-file")).not.toBeVisible();
    await expect(page.locator("#collect-workloads")).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  expect(errors).toEqual([]);
});

test("existing-baseline collection needs one button, shows workload failures and sends no uploaded packages", async ({ page }) => {
  const errors = [];
  const writes = [];
  let downloads = 0;
  page.on("pageerror", error => errors.push(error.message));
  page.on("download", () => downloads++);
  page.on("popup", popup => popup.close());
  page.on("request", request => {
    if (request.method() === "POST") writes.push({ url: new URL(request.url()).pathname, body: request.postDataJSON() });
  });
  // Synthetic response decoration exercises the UI states, never a live tenant.
  // The real automatic producer/persistence pipeline is covered by workload-collection.test.js.
  await page.route("**/api/jobs/*", async route => {
    const response = await route.fetch();
    const job = await response.json();
    if (job.action === "workloads") {
      job.workloads = [
        { id: "exchangeOnline", name: "Exchange Online", status: "collected", message: "Synthetic command evidence collected." },
        { id: "sharePointOnline", name: "SharePoint Online", status: "failed", message: "Synthetic SharePoint role denied." },
        { id: "purview", name: "Microsoft Purview", status: "collected", message: "Synthetic command evidence collected." },
        { id: "powerPlatform", name: "Power Platform and Copilot Studio", status: "collected-with-gaps",
          message: "Synthetic agent sharing coverage is incomplete.", errors: 1,
          resourceCounts: [{ resource: "environments", rows: 2 }, { resource: "agents", rows: 1 }],
          issues: [{ resource: "agentSharing", code: "COVERAGE_INCOMPLETE", message: "Synthetic effective sharing cannot be established." }] }
      ];
      job.collectionSummary = { requested: 4, collected: 2, withGaps: 1, failed: 1 };
    }
    await route.fulfill({ response, json: job });
  });
  await page.goto("/");
  await page.waitForFunction(() => typeof localServiceAvailable !== "undefined" && localServiceAvailable);
  await expect(page.locator("#service-panel")).toHaveClass(/ready/);
  await page.evaluate(() => navigate("guide"));
  await page.locator("#connect-scan").click();
  await expect(page.locator("#service-status")).toHaveText(/^Baseline complete\./, { timeout: 25000 });
  await page.evaluate(() => navigate("guide"));
  await expect(page.locator("#collect-workloads")).toBeEnabled();
  await page.locator("#collect-workloads").click();
  await expect(page.locator("#service-status")).toContainText("2 workloads have collection gaps", { timeout: 25000 });
  for (const viewport of [{ width: 1440, height: 1080 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => navigate("guide"));
    await expect(page.locator("#workload-progress > li")).toHaveCount(4);
    await expect(page.locator("#workload-progress")).toContainText("Synthetic SharePoint role denied.");
    await expect(page.locator("#workload-progress")).toContainText("incomplete");
    const errorDetails = page.locator("#workload-progress details").filter({ hasText: "Collection errors" });
    await errorDetails.locator("summary").click();
    await expect(errorDetails).toContainText("agentSharing: Synthetic effective sharing cannot be established. (COVERAGE_INCOMPLETE)");
    await errorDetails.locator("summary").click();
    const counts = page.locator("#workload-progress details").filter({ hasText: "Observed rows by query" });
    await counts.locator("summary").click();
    await expect(counts).toContainText("environments: 2");
    await counts.locator("summary").click();
    expect(await page.locator('#workload-progress [data-status="failed"]').evaluate(
      element => getComputedStyle(element, "::before").content)).toBe('"!"');
    await expect(page.locator("#collect-workloads")).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  expect(writes.map(write => write.url)).toEqual(["/api/jobs", "/api/jobs"]);
  expect(writes.map(write => write.body.action)).toEqual(["baseline", "workloads"]);
  expect(downloads).toBe(0);
  expect(errors).toEqual([]);
});
