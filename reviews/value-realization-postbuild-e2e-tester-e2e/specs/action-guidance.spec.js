const { test, expect } = require("@playwright/test");
const fs = require("node:fs");

test("control guidance navigation, policy boundaries and exports work on desktop and mobile", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.locator('[data-page="guide"]:visible').first().click();
  page.once("popup", popup => popup.close());
  await page.locator("#connect-scan").click();
  await expect(page.locator("#service-status")).toHaveText(/^The first scan is saved\./, { timeout: 25000 });
  await expect(page.locator("#connect-scan")).toBeEnabled();

  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => {
      document.getElementById("enablement-filter").value = "complete";
      renderTenantEnablementPlan("complete");
      navigate("guide");
    });
    const button = page.locator('#completion-blockers [data-lane="appLimitations"] button[data-control-id]').first();
    await expect(button).toBeVisible();
    const id = (await button.getAttribute("aria-label")).match(/AFD-[A-Z]+-\d+/)[0];
    await button.focus();
    await page.keyboard.press("Enter");
    const detail = page.locator(`#enablement-${id}`);
    await expect(detail).toBeVisible();
    await expect(detail).toHaveAttribute("open", "");
    await expect(detail.locator("summary")).toBeFocused();
    await expect(page.locator("#enablement-filter")).toHaveValue("all");
    await expect(detail).toContainText("not automatically Microsoft deployment prerequisites");
    await expect(detail).toContainText("What this collection method cannot establish:");
    await expect(detail).toContainText("not proof that your organization lacks these licences");
    await expect(detail.locator(".doc-link")).toHaveAttribute("href", /^https:\/\/(learn|adoption)\.microsoft\.com\//);
    expect(await detail.locator("ol").first().locator("li").count()).toBe(6);
    expect(await page.locator("#enablement-plan-list details").count()).toBe(77);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  }

  await page.evaluate(() => openControlPlaybook("AFD-TEAMS-001"));
  await expect(page.locator("#enablement-AFD-TEAMS-001 .control-badge")).toHaveText("A software connection or checking rule is missing");
  await expect(page.locator("#enablement-AFD-TEAMS-001")).toContainText("permissions or a rescan alone");
  await page.evaluate(() => openControlPlaybook("AFD-PPA-001"));
  await expect(page.locator("#enablement-AFD-PPA-001")).toContainText("Collect workload evidence");
  await page.evaluate(() => openControlPlaybook("AFD-EXO-001"));
  await expect(page.locator("#enablement-AFD-EXO-001")).toContainText("read Exchange Online for the organization");

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#download-enablement-plan").click();
  const download = await downloadPromise;
  const markdown = fs.readFileSync(await download.path(), "utf8");
  expect((markdown.match(/^### AFD-/gm) || []).length).toBe(77);
  expect(markdown).toContain("Microsoft guidance reference");
  expect(markdown).not.toContain("Authoritative Microsoft source");
  const csv = await page.evaluate(() => controlsCsv());
  expect(csv).toContain('"Requirement Origin","Evidence Collection Steps","Collection Boundary"');
  expect(csv).toContain("Collect workload evidence");
  expect(errors).toEqual([]);
});
