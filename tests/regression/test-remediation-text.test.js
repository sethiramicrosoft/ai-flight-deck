"use strict";

// 2026-09-12: Rejected evidence explanations reached remediation innerHTML.
// Regression for the rendering defect present in fd9ee6c.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..", "..");
const catalog = require(path.join(root, "schema", "readiness-catalog.v1.json"));
const missionEngine = require(path.join(root, "mission-engine"));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.join(root,
  "reviews", "value-realization-postbuild-e2e-tester-e2e", "node_modules", "@playwright", "test"));
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
function source(name, next) {
  const start = html.indexOf(`    function ${name}(`);
  const end = html.indexOf(`    function ${next}(`, start);
  assert.ok(start >= 0 && end > start, "Renderer boundaries must exist");
  return html.slice(start, end);
}

test("rejected evidence and correction fields render as text, never executable HTML", async () => {
  const payload = `<img src="data:image/png;base64,AA==" onerror="document.documentElement.setAttribute('data-afd-probe','executed')">`;
  const domain = catalog.domains[0];
  const control = domain.controls[0];
  const build = vm.runInNewContext(`${source("buildLiveRemediations", "activeCohort")}\nbuildLiveRemediations`, {
    window: { FlightDeckMissionEngine: missionEngine }, readinessCatalog: catalog, remediationCatalog: {}
  });
  const rows = build({ findings: [], estateAssessment: { controlResults: [{
    domainId: domain.id, controlId: control.id, status: "Unknown",
    authority: { schemaVersion: "2.0.0", validationStatus: "Rejected", whatWouldChangeDecision: [payload] }
  }] } });
  assert.equal(rows.length, 1);
  assert.ok(rows[0].copy.includes(payload));
  const id = `sample-" data-injected="yes`;
  rows.push({ id, title: `Review ${payload} & access`, copy: "Keep <scope> literal & readable",
    effort: payload, currentStatus: "Unknown", gain: null });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => route.abort());
    await page.setContent('<div id="remediation-list"></div><button id="generate-package"></button>');
    await page.evaluate(({ code, rows }) => {
      const remediations = rows, applied = new Set(), domainDocumentation = {};
      const readableCheckStatus = value => value, updateForecast = () => {};
      eval(`${code}\nrenderRemediations();`);
    }, { code: source("renderRemediations", "updateForecast"), rows });
    assert.equal(await page.locator("#remediation-list img, #remediation-list svg").count(), 0);
    assert.equal(await page.locator("[data-injected]").count(), 0);
    assert.equal(await page.locator("html").getAttribute("data-afd-probe"), null);
    const articles = page.locator("#remediation-list article");
    assert.equal(await articles.count(), 2);
    assert.equal(await articles.nth(1).getAttribute("data-remediation"), id);
    assert.equal(await articles.first().locator("p").textContent(), rows[0].copy);
    assert.equal(await articles.nth(1).locator("h3").textContent(), rows[1].title);
    assert.equal(await articles.nth(1).locator("p").textContent(), rows[1].copy);
    assert.equal(await articles.nth(1).locator("button").getAttribute("aria-label"),
      `Include in administrator review plan: ${rows[1].title}`);
    assert.equal(await page.locator("#generate-package").isEnabled(), true);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
