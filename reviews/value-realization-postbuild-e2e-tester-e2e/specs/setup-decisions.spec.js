const { test, expect } = require("@playwright/test");

test("completion categories lead to scoped directory and policy forms without manual imports", async ({ page }) => {
  const errors = [];
  const mutations = [];
  const approvals = [];
  page.on("pageerror", error => errors.push(error.message));
  let saved = {};
  await page.route("**/api/setup-decisions", async route => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      mutations.push(body);
      saved[body.kind] = { ...body, recordedAt: "2026-09-09T00:00:00Z" };
    }
    await route.fulfill({ json: { decisions: saved } });
  });
  await page.route("**/api/directory-search", route => route.fulfill({ json: { id: "synthetic-directory" } }));
  await page.route("**/api/directory-cohort", route => {
    approvals.push(route.request().postDataJSON());
    return route.fulfill({ json: { id: "synthetic-cohort" } });
  });
  await page.route("**/api/jobs/synthetic-cohort", route => route.fulfill({ json: {
    id: "synthetic-cohort", action: "directoryCohort", status: "completed", result: "baseline"
  } }));
  await page.route("**/api/jobs/synthetic-directory", route => route.fulfill({ json: {
    id: "synthetic-directory", action: "directorySearch", status: "completed",
    directoryResult: {
      tenantId: "e2eeeeee-1111-4444-8888-000000000001", kind: "users", hasMore: false,
      items: [{ id: "e2eeeeee-1111-4444-8888-000000000002", displayName: "Synthetic pilot user",
        userPrincipalName: "synthetic@example.test" }]
    }
  } }));
  await page.goto("/");
  await page.waitForFunction(() => typeof baselineScan !== "undefined" && baselineScan && setupDecisionUI);
  await page.evaluate(() => navigate("guide"));
  await expect(page.locator('[data-lane="userDecisions"]')).toBeVisible();
  await expect(page.locator('[data-lane="administratorActions"]')).toBeVisible();
  await expect(page.locator('[data-lane="appLimitations"]')).toBeVisible();
  await expect(page.locator('[data-lane="appLimitations"]')).toContainText("Repeated scans");
  const before = await page.evaluate(() => JSON.stringify(baselineScan.estateAssessment.controlResults));
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => setupDecisionUI.open("hybridExchange"));
    const hybrid = page.locator('[data-policy-decision="hybridExchange"]');
    await hybrid.locator('[name="value"]').selectOption("no");
    await hybrid.locator('[name="owner"]').fill("Synthetic Exchange owner");
    await hybrid.locator('[name="rationale"]').fill("Synthetic owner decision; not tenant configuration proof.");
    await hybrid.getByRole("button", { name: "Save hybrid decision" }).click();
    await expect(hybrid.locator("[data-decision-saved]")).toContainText("Synthetic Exchange owner");
    expect(await page.evaluate(() => JSON.stringify(baselineScan.estateAssessment.controlResults))).toBe(before);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await page.evaluate(() => setupDecisionUI.open("pilotCohort"));
  const search = page.locator("[data-directory-search]");
  await search.locator('[name="query"]').fill("Synthetic");
  await search.getByRole("button", { name: "Search directory" }).click();
  await expect(page.locator("[data-directory-cohort]")).toBeVisible();
  await expect(page.locator("[data-directory-items]")).toContainText("Synthetic pilot user");
  await expect(page.locator('[data-directory-cohort] [name="approved"]')).not.toBeChecked();
  const cohort = page.locator("[data-directory-cohort]");
  await cohort.locator("[data-directory-id]").check();
  await cohort.locator('[name="owner"]').fill("Synthetic pilot owner");
  await cohort.locator('[name="approved"]').check();
  await cohort.getByRole("button", { name: "Save approved pilot" }).click();
  await expect(page.locator("[data-setup-status]")).toContainText("Approved pilot saved");
  expect(approvals).toHaveLength(1);
  expect(approvals[0]).toMatchObject({
    directoryJobId: "synthetic-directory", selectedIds: ["e2eeeeee-1111-4444-8888-000000000002"],
    owner: "Synthetic pilot owner", approved: true
  });
  expect(mutations).toHaveLength(2);
  expect(mutations.every(item => item.kind === "hybridExchange" && item.cohortId)).toBe(true);
  expect(errors).toEqual([]);
});

test("cancelled directory search cannot expose candidates or report a saved approval", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/directory-search", route => route.fulfill({ json: { id: "synthetic-cancel" } }));
  await page.route("**/api/jobs/synthetic-cancel", route => route.fulfill({ json: {
    id: "synthetic-cancel", action: "directorySearch", status: "cancelled"
  } }));
  await page.goto("/");
  await page.waitForFunction(() => baselineScan && setupDecisionUI);
  await page.evaluate(() => { navigate("guide"); setupDecisionUI.open("pilotCohort"); });
  await page.locator('[data-directory-search] [name="query"]').fill("Synthetic");
  await page.getByRole("button", { name: "Search directory", exact: true }).click();
  await expect(page.locator("[data-setup-status]")).toContainText("cancelled; no selection was saved");
  await expect(page.locator("[data-directory-cohort]")).toBeHidden();
  expect(errors).toEqual([]);
});
