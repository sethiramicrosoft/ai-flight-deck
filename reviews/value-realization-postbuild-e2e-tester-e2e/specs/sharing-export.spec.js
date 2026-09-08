const { test, expect } = require("@playwright/test");
const fs = require("node:fs");

test("Export report downloads an Excel-compatible sharing review CSV rather than JSON", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", route => route.fulfill({
    status: 503, contentType: "application/json", body: JSON.stringify({ error: "Offline CSV fixture" })
  }));
  await page.goto("/");
  await page.waitForFunction(() => typeof readinessCatalog !== "undefined" && readinessCatalog);
  await page.evaluate(() => {
    findings = [{
      title: 'Synthetic "sharing", finding', severity: "High", detail: "Organization-wide sharing",
      ruleKey: "AFD-SP-ORGANIZATION-001", evidenceIds: ["synthetic-evidence"],
      evidenceDetails: [{ displayName: "Synthetic site", reason: "Broad access", recommendedAction: "Review link scope" }]
    }];
  });
  const pending = page.waitForEvent("download");
  await page.locator("#export-button").click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("ai-flight-deck-sharing-review.csv");
  expect(await download.failure()).toBeNull();
  const csv = fs.readFileSync(await download.path(), "utf8");
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  expect(csv).toContain('"Finding","Rule","Resource"');
  expect(csv).toContain('"Synthetic ""sharing"", finding"');
  expect(csv).toContain('"Synthetic site"');
  expect(csv).toContain('"Review link scope"');
  expect(csv.trimStart().startsWith("{")).toBe(false);
  expect(errors).toEqual([]);
});
