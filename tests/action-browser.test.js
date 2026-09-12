"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { fixture } = require("./action-fixture");
const { observations } = require("../authority-test-fixtures");
const { policy } = require("./conditional-access-fixture");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ||
  path.join(__dirname, "..", "reviews", "value-realization-postbuild-e2e-tester-e2e",
    "node_modules", "@playwright", "test"));

async function browserFixture(run, viewport = { width: 1440, height: 1000 }) {
  const f = await fixture();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport, permissions: ["clipboard-read", "clipboard-write"] });
    const external = [], errors = [];
    await context.route("**/*", route => {
      if (new URL(route.request().url()).origin !== f.origin) {
        external.push(route.request().url()); return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(`${f.origin}/?page=remediation`);
    await page.waitForFunction(() => document.querySelector("#action-control")?.options.length === 77);
    await run({ f, page, context });
    assert.deepEqual(errors, [], "Browser JS must not throw");
    assert.deepEqual(external, [], "No outside network or sign-in must be attempted");
  } finally { if (browser) await browser.close(); await f.close(); }
}
async function choose(page, control) {
  await page.selectOption("#action-control", control);
  await page.click("#action-create");
  await page.waitForSelector("#action-owner");
}
async function fill(page, shared = false) {
  await expand(page, "action-plan");
  await page.fill("#action-scopeDescription", "Only the synthetic approved pilot, not production.");
  await page.fill("#action-owner", "Synthetic local owner");
  await page.fill("#action-team", "Synthetic local team");
  await page.selectOption("#action-responsibility", shared ? "shared" : "local");
  await page.fill("#action-prerequisites", "Reviewed synthetic-only impact and rollback.");
  await page.check("#action-prerequisitesConfirmed");
}
async function expand(page, id) {
  if (!await page.locator(`#${id}`).evaluate(node => node.open)) await page.locator(`#${id} > summary`).click();
}
async function saved(page) {
  await page.waitForFunction(() => document.querySelector("#actions-status").textContent.startsWith("Saved locally."));
}
async function noOverflow(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    "The page must not overflow horizontally");
}

test("desktop browser: finding → saved action → approval → progress → completion → consented collection → technical check → history/reload", async () => {
  await browserFixture(async ({ page, f }) => {
    await page.locator('[data-page="overview"]').first().click();
    await page.waitForSelector('[data-start-action="AFD-LIC-002"]', { state: "attached" });
    await page.locator('[data-start-action="AFD-LIC-002"]').evaluate(node => node.closest("details").open = true);
    await page.click('[data-start-action="AFD-LIC-002"]');
    await page.waitForFunction(() => document.querySelector("#action-control").value === "AFD-LIC-002");
    await page.click("#action-create");
    await page.waitForSelector("#action-owner");
    await fill(page);
    await page.click("#action-start");
    await page.waitForFunction(() => /required approval/.test(document.querySelector("#actions-status").textContent));
    assert.equal(await page.inputValue("#action-owner"), "Synthetic local owner");
    await page.fill("#action-approvalRecord", "Synthetic approver, decision recorded by operator, ref review:approval");
    await page.click("#action-save"); await saved(page);
    await page.click("#action-start"); await saved(page);
    await expand(page, "action-guidance");
    await page.check('[data-action-step="0"]');
    await page.click("#action-save"); await saved(page);
    await page.fill("#action-completion", "Synthetic administrator reports the approved work complete.");
    await page.click("#action-complete"); await saved(page);
    await page.click("#action-check"); await saved(page);
    assert.match(await page.textContent("#action-verification"), /Not verified.*before completion/);
    await page.locator("#action-scan-consent summary").click();
    await page.click("#action-scan");
    await page.waitForFunction(() => /agree/.test(document.querySelector("#actions-status").textContent));
    await page.check("#action-scan-agree");
    await page.click("#action-scan");
    await page.waitForFunction(() => /Settings verified by a supported check/.test(document.querySelector("#action-verification")?.textContent || ""));
    await page.locator("#action-history > summary").click();
    assert.match(await page.textContent("#action-history"), /TechnicalVerification/);
    await noOverflow(page);
    const document = (await f.request("/api/actions")).body;
    assert.equal(document.actions.length, 1);
    assert.equal(document.actions[0].fields.completedSteps[0], 0);
    await page.reload();
    await page.waitForSelector(`[id="open-action-${document.actions[0].id}"]`);
    await page.click(`[id="open-action-${document.actions[0].id}"]`);
    assert.match(await page.textContent("#action-verification"), /Settings verified by a supported check/);
    await page.click("#action-reopen"); await saved(page);
    assert.match(await page.textContent("#action-verification"), /Needs attention again/);
    await expand(page, "action-plan");
    await page.fill("#action-owner", "Resumed owner");
    await page.click("#action-save"); await saved(page);
  });
});

test("mobile browser: shared responsibility, full manual draft copy, missing response recovery and unsupported evidence", async () => {
  await browserFixture(async ({ page, f }) => {
    await choose(page, "AFD-SPO-003");
    await fill(page, true);
    await page.fill("#action-owner", '<img src=x onerror="alert(1)">');
    await page.fill("#action-approvalRecord", "User-recorded central approval: review:central");
    await page.fill("#action-centralRequest", "Central IT: please review sampled pilot access under the approved scope.");
    await page.click("#action-start"); await saved(page);
    await page.fill("#action-completion", "Local owner recorded work reported complete.");
    await page.click("#action-complete");
    await page.waitForFunction(() => /central IT request, response/.test(document.querySelector("#actions-status").textContent));
    await page.fill("#action-centralResponse", "Synthetic central team reports its review complete.");
    await page.fill("#action-centralEvidence", "review:central-response-001");
    assert.match(await page.inputValue("#action-handoff-preview"), /central-response-001/);
    assert.equal(await page.locator("#guided-actions img").count(), 0);
    await expand(page, "action-handoff");
    await page.click("#action-copy");
    await page.waitForFunction(() => /Nothing was sent/.test(document.querySelector("#actions-status").textContent));
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(clipboard, /MANUAL HAND-OFF ONLY/);
    assert.match(clipboard, /<img src=x/);
    await page.click("#action-complete"); await saved(page);
    await page.click("#action-check"); await saved(page);
    assert.match(await page.textContent("#action-verification"), /Not verified.*No supported observation contract/);
    await page.locator("#action-evidence summary").click();
    await page.locator("#action-history > summary").click();
    await noOverflow(page);
    const data = (await f.request("/api/actions")).body;
    assert.equal(data.actions[0].fields.responsibility, "shared");
    assert.equal(data.actions[0].completionReport, "Local owner recorded work reported complete.");
    assert.ok(data.actions[0].history.some(h => h.event === "complete"));
  }, { width: 390, height: 844 });
});

test("identity journey verifies a new supported baseline, exports all requirements and reopens on an exclusion", async () => {
  await browserFixture(async ({ page, f }) => {
    await choose(page, "AFD-IAM-003"); await fill(page);
    assert.match(await page.textContent("#action-next-step"), /Record who/);
    await page.fill("#action-approvalRecord", "Synthetic review: approved in isolated fixture only.");
    await page.click("#action-start"); await saved(page);
    assert.equal(await page.locator("#action-plan").evaluate(n => n.open), false);
    assert.equal(await page.locator("#action-guidance").evaluate(n => n.open), true);
    await page.fill("#action-completion", "Synthetic administrator reports the reviewed policy change.");
    await page.click("#action-complete"); await saved(page);
    await page.click("#action-check"); await saved(page);
    assert.match(await page.textContent("#action-verification"), /Not verified/);
    await f.assessment({ observations: { ...observations, conditionalAccess: [policy()] } });
    await expand(page, "action-scan-consent");
    await page.check("#action-scan-agree"); await page.click("#action-scan");
    await page.waitForFunction(() => /Settings verified/.test(document.querySelector("#action-verification")?.textContent || ""));
    await page.locator("#action-decision > summary").focus();
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("#action-decision").evaluate(n => n.open), true);
    assert.match(await page.textContent("#action-decision-preview"), /Not cleared for rollout/);
    assert.match(await page.textContent("#action-decision-preview"), /AFD-SPO-003/);
    const download = page.waitForEvent("download");
    await page.click("#action-decision-download");
    const file = await download;
    assert.equal(file.suggestedFilename(), "flight-deck-pilot-decision.txt");
    const text = require("node:fs").readFileSync(await file.path(), "utf8");
    assert.equal((text.match(/^AFD-[A-Z]+-\d{3} - /gm) || []).length, 77);
    assert.match(text, /conditional|Conditional/);
    assert.match(text, /not rollout authorisation/);
    const excluded = policy(); excluded.conditions.users.excludeUsers = ["user-1"];
    f.seal(await f.assessment({ observations: { ...observations, conditionalAccess: [excluded] } }), "action-assessment");
    await page.click("#actions-reload");
    await page.waitForFunction(() => /Needs attention again/.test(document.querySelector("#action-verification")?.textContent || ""));
    await noOverflow(page);
  });
});

test("mobile governance journeys record real form fields without JSON and retain owner-statement boundaries", async () => {
  await browserFixture(async ({ page, f }) => {
    for (const controlId of ["AFD-OPS-005", "AFD-ADOPT-003"]) {
      await choose(page, controlId); await fill(page, true);
      await page.fill("#action-approvalRecord", "Synthetic governance review reference.");
      await page.fill("#action-centralRequest", "Confirm the pilot support and escalation arrangements.");
      await page.fill("#action-centralResponse", "Synthetic central owner supplied a reviewed response.");
      await page.fill("#action-centralEvidence", "review:synthetic-central-response");
      await page.click("#action-start"); await saved(page);
      await page.fill("#action-completion", "Recorded the responsible team's review, not a technical inspection.");
      await page.click("#action-complete"); await saved(page);
      await page.click("#action-statement-save");
      await page.waitForFunction(() => /Fill every review field/.test(document.querySelector("#actions-status").textContent));
      if (controlId === "AFD-OPS-005") {
        await page.fill("#action-statement-technicalContact", "Synthetic technical escalation owner");
        await page.fill("#action-statement-executiveContact", "Synthetic executive escalation owner");
      } else {
        await page.fill("#action-statement-intake", "review:synthetic-support-queue");
        await page.fill("#action-statement-owner", "Synthetic support owner");
        await page.fill("#action-statement-responseTarget", "One business day");
        const delivered = new Date(Date.now() - 3600000);
        delivered.setMinutes(delivered.getMinutes() - delivered.getTimezoneOffset());
        await page.fill("#action-statement-deliveredAt", delivered.toISOString().slice(0, 16));
      }
      await page.fill("#action-statement-statement", "The responsible owners reviewed the synthetic pilot's support arrangements.");
      await page.fill("#action-statement-references", "review:synthetic-support-record");
      const expiry = new Date(Date.now() + 3600000);
      expiry.setMinutes(expiry.getMinutes() - expiry.getTimezoneOffset());
      await page.fill("#action-statement-expiresAt", expiry.toISOString().slice(0, 16));
      await page.click("#action-statement-save");
      await page.waitForFunction(() => /Owner statement saved locally/.test(document.querySelector("#actions-status").textContent));
      assert.match(await page.textContent("#action-verification"), /Not verified/);
      await expand(page, "action-scan-consent");
      await page.check("#action-scan-agree"); await page.click("#action-scan");
      await page.waitForFunction(() => /Owner statement accepted/.test(document.querySelector("#action-verification")?.textContent || ""));
      assert.match(await page.textContent("#action-verification"), /not a technical check/);
      const record = (await f.request("/api/attestations")).body.attestations.find(a => a.controlId === controlId);
      assert.ok(record.data && record.evidenceReferences.includes("review:synthetic-support-record"));
      await noOverflow(page);
    }
  }, { width: 390, height: 844 });
});

test("browser conflicts preserve saved revision and recover through explicit reload", async () => {
  await browserFixture(async ({ page, f }) => {
    await choose(page, "AFD-IAM-007");
    const a = (await f.request("/api/actions")).body.actions[0];
    const other = await f.request(`/api/actions/${a.id}`, { revision: a.revision, operation: "save",
      fields: { owner: "Other tab's owner" } });
    assert.equal(other.status, 200);
    await page.fill("#action-owner", "Stale owner");
    await page.click("#action-save");
    await page.waitForFunction(() => /changed.*Reload/.test(document.querySelector("#actions-status").textContent));
    assert.equal(await page.inputValue("#action-owner"), "Stale owner");
    await page.click("#actions-reload");
    await page.waitForFunction(() => document.querySelector("#action-owner")?.value === "Other tab's owner");
    await page.fill("#action-owner", "Reapplied after review");
    await page.click("#action-save"); await saved(page);
    assert.equal((await f.request("/api/actions")).body.actions[0].fields.owner, "Reapplied after review");
  });
});
