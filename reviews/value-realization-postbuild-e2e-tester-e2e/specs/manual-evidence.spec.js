const { test, expect } = require("@playwright/test");

test("manual evidence instructions are visible before connection and the blank template downloads", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  // Exercise static setup without reading or changing the operator's tenant workspace.
  await page.route("**/api/**", route => route.fulfill({
    status: 503, contentType: "application/json", body: JSON.stringify({ error: "Offline UI fixture" })
  }));
  await page.goto("/");
  await page.waitForFunction(() => typeof readinessCatalog !== "undefined" && readinessCatalog);
  const panel = page.locator("#power-platform-manual-evidence");
  for (const viewport of [{ width: 1440, height: 1080 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => navigate("guide"));
    const notice = page.locator("#manual-evidence-notice");
    await expect(notice).toBeVisible();
    expect(await notice.evaluate(element =>
      Boolean(element.compareDocumentPosition(document.getElementById("connect-scan")) & Node.DOCUMENT_POSITION_FOLLOWING)
    )).toBe(true);
    expect(await notice.evaluate(element => element.getBoundingClientRect().top < innerHeight)).toBe(true);
    await notice.getByRole("button", { name: "How to fill and import it" }).click();
    await expect(panel).toBeFocused();
    await panel.scrollIntoViewIfNeeded();
    await expect(panel.locator(".eyebrow")).toHaveText(/Manual step required.*Power Platform administrator/);
    await expect(panel).toContainText("Not collected automatically.");
    await expect(panel.locator("ol > li")).toHaveCount(5);
    await expect(panel).toContainText("30 minutes");
    await expect(panel).toContainText("actual evidence collection time");
    await expect(panel).toContainText("remain Unknown");
    await expect(panel.locator("input")).toHaveAttribute("aria-describedby", /power-platform-manual-steps/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  const link = panel.getByRole("link", { name: "Download blank JSON template" });
  const download = page.waitForEvent("download");
  await link.click();
  expect((await download).suggestedFilename()).toBe("power-platform-evidence.template.v1.json");
  expect(errors).toEqual([]);
});
