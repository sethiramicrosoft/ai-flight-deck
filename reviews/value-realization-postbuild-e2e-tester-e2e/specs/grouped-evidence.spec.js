const { test, expect } = require("@playwright/test");
const fs = require("node:fs");

test("4094 permission observations render bounded groups and 50-record drilldowns on desktop and mobile", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", route => route.fulfill({
    status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic offline fixture" })
  }));
  await page.goto("/");
  await page.waitForFunction(() => typeof readinessCatalog !== "undefined" && readinessCatalog);
  await page.evaluate(() => {
    const paths = Array.from({ length: 4094 }, (_, index) => {
      const item = index % 251;
      const site = Math.floor(item / 9);
      return {
        evidenceId: `permission-${index}`, itemEvidenceId: `item-${item}`, itemId: `item-${item}`,
        siteId: `site-${site}`, driveId: `drive-${site}`,
        displayName: item === 0 ? "=1+1" : `Synthetic item ${item}`,
        siteDisplayName: `Synthetic site ${site}`, driveDisplayName: "Documents",
        itemType: item % 7 === 0 ? "Folder" : "File",
        accessType: "user-direct-grant", inherited: true,
        inheritedFrom: { driveId: `drive-${site}`, id: `folder-${site}` },
        principalRefs: ["user:synthetic"], principalTypes: ["user"], principalCount: 1, roles: ["read"]
      };
    });
    baselineScan = {
      generatedAt: "2026-09-09T00:00:00Z", tenant: { tenantId: "synthetic" },
      summary: { sitesScanned: 28, sampledItems: 251 },
      evidenceDetails: { permissionPaths: paths }
    };
    activeTenant.name = "Synthetic tenant";
    sharingReviewModel = FlightDeckSharingReview.buildSharingReview(baselineScan);
    document.getElementById("export-sharing-evidence").disabled = false;
    document.getElementById("export-grouped-evidence").disabled = false;
    renderFindings();
    navigate("findings");
  });
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const inventory = page.locator('[data-sharing-bucket="inventory"]');
    await inventory.click();
    await expect(page.locator(".sharing-overview")).toContainText("4,094 permission records");
    await expect(page.locator(".sharing-overview")).toContainText("not automatic remediation tasks");
    await expect(page.locator(".sharing-review-card")).toHaveCount(25);
    await page.getByRole("button", { name: "Next groups", exact: true }).click();
    await expect(page.locator(".sharing-review-card")).toHaveCount(3);
    await page.getByRole("button", { name: "Previous groups", exact: true }).click();
    const first = page.getByRole("button", { name: "See the files and permission records", exact: true }).first();
    await first.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator(".evidence-detail")).toHaveCount(50);
    await expect(dialog).toContainText(/inherited/i);
    const firstText = await dialog.locator(".evidence-detail").first().textContent();
    await dialog.getByRole("button", { name: "Next records", exact: true }).click();
    await expect(dialog.locator(".evidence-detail")).toHaveCount(50);
    expect(await dialog.locator(".evidence-detail").first().textContent()).not.toBe(firstText);
    await expect(dialog.locator('[role="status"]')).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(first).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  for (const [selector, expectedName, expectedLines] of [
    ["#export-grouped-summary", "ai-flight-deck-sharing-review.csv", 29],
    ["#export-grouped-evidence", "ai-flight-deck-collected-sharing-evidence.csv", 4095]
  ]) {
    const pending = page.waitForEvent("download");
    await page.locator(selector).click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe(expectedName);
    const csv = fs.readFileSync(await download.path(), "utf8");
    expect(csv.trimEnd().split("\r\n")).toHaveLength(expectedLines);
    if (selector === "#export-grouped-evidence") {
      expect(csv).toContain("\"'=1+1\"");
      expect(csv.length).toBeLessThan(5000000);
      expect(csv).not.toContain("permission-0; permission-1");
    }
  }
  expect(errors).toEqual([]);
});
