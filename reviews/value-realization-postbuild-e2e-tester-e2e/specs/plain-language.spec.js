const { test, expect } = require("@playwright/test");

test("every main page explains its purpose and use without changing the assessment", async ({ page }) => {
  const errors = [];
  const writes = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    if (new URL(request.url()).pathname.startsWith("/api/") && request.method() !== "GET") {
      writes.push(request.url());
    }
  });
  await page.goto("/");
  await page.waitForFunction(() => typeof baselineScan !== "undefined" && baselineScan && setupDecisionUI);
  const before = await page.evaluate(() => JSON.stringify(baselineScan.estateAssessment.controlResults));
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const id of ["guide", "overview", "findings", "remediation", "clearance", "simulator"]) {
      await page.evaluate(id => navigate(id), id);
      const help = page.locator(`#${id} [data-page-help]`).first();
      await expect(help).toBeVisible();
      await expect(help).toContainText(/Use |Choose |Select |Start |Open |Read /);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
  }
  expect(await page.evaluate(() => JSON.stringify(baselineScan.estateAssessment.controlResults))).toBe(before);
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test("setup explains pilot choices before listing unfinished checks", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => typeof baselineScan !== "undefined" && baselineScan && setupDecisionUI);
  await page.locator('[data-page="guide"]:visible').first().click();
  await expect(page.getByRole("heading", { name: "Choose the people and settings for your pilot" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What still needs to be checked" })).toBeVisible();
  expect(await page.evaluate(() => Boolean(document.getElementById("setup-decision-forms")
    .compareDocumentPosition(document.getElementById("completion-summary")) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await expect(page.locator('[data-lane="userDecisions"]')).toContainText("Decisions for you");
  await expect(page.locator('[data-lane="administratorActions"]')).toContainText("Help needed from an administrator");
  await expect(page.locator('[data-lane="appLimitations"]')).toContainText("Checks this version cannot perform");
  await expect(page.locator('[data-lane="appLimitations"]')).toContainText("Review the requirement outside Flight Deck");
  await expect(page.locator("#setup-decision-forms")).toContainText("They do not assign licences");
  await page.locator("#setup-pilotCohort summary").click();
  await expect(page.locator("#setup-pilotCohort")).toContainText("does not assume that everyone with a Copilot licence");
  await expect(page.locator("#setup-pilotCohort")).toContainText("50 users or 10 groups");
  await page.locator("#setup-webGrounding summary").click();
  await expect(page.locator("#setup-webGrounding")).toContainText("Microsoft calls this web grounding");
  await expect(page.locator("#setup-webGrounding")).toContainText("not a switch that changes Copilot");
  await expect(page.locator("#setup-webGrounding")).toContainText("An administrator must check");
});
