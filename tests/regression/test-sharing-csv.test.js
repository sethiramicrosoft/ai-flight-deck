"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const html = fs.readFileSync(path.resolve(__dirname, "..", "..", "index.html"), "utf8");
function section(start, end) {
  const from = html.indexOf(`    function ${start}(`);
  const to = html.indexOf(`    function ${end}(`, from);
  assert.ok(from >= 0 && to > from);
  return html.slice(from, to);
}
function render(findings, overrides = {}) {
  const context = {
    findings, activeTenant: { name: "Synthetic tenant", source: "synthetic" },
    baselineScan: { generatedAt: "2026-09-08T08:00:00.000Z" },
    remediations: [{ id: "action-1", title: "Review sharing" }], applied: new Set(["action-1"]),
    verificationReport: null, ...overrides
  };
  return vm.runInNewContext(
    `${section("csvCell", "controlsCsv")}\n${section("sharingReviewCsv", "clearancePayload")}\nsharingReviewCsv()`,
    context);
}
function parse(csv) {
  return JSON.parse(execFileSync("python", ["-c",
    "import csv,io,json,sys; print(json.dumps(list(csv.DictReader(io.StringIO(sys.stdin.buffer.read().decode('utf-8-sig'),newline='')))))"
  ], { input: csv, encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } }));
}
test("sharing CSV round-trips quoted multiline Unicode findings with one row per affected resource", () => {
  const csv = render([{
    title: 'Needs "owner", review\nSecond line', severity: "High", ruleKey: "AFD-SP-BROAD-001",
    detail: "Read access", impact: "Potential broad audience", evidenceIds: ["proof-a", "proof-b"],
    evidenceDetails: [
      { displayName: "Synthetic Caf\u00e9", reason: "Public group", recommendedAction: "Confirm business need" },
      { displayName: "Synthetic second site", reason: "Organization-wide link", recommendedAction: "Review link scope" }
    ]
  }]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.ok(csv.includes("\r\n"));
  const rows = parse(csv);
  assert.equal(rows.length, 2);
  assert.equal(Object.keys(rows[0]).length, 16);
  assert.equal(rows[0].Finding, 'Needs "owner", review\nSecond line');
  assert.equal(rows[0].Resource, "Synthetic Caf\u00e9");
  assert.equal(rows[1]["Recommended Action"], "Review link scope");
  assert.equal(rows[0]["Evidence References"], "proof-a; proof-b");
  assert.equal(rows[0]["Selected Corrections"], "Review sharing");
  assert.equal(rows[0]["Verification State"], "Not verified");
  assert.match(rows[0].Limitations, /Synthetic demonstration.*not proof of remediation/);
});
test("spreadsheet formulas, including whitespace-prefixed formulas, are exported as inert text", () => {
  for (const title of ["=1+1", "+SUM(A1)", "-1+2", "@SUM(A1)", "\t=1+1", "\r\n =1+1"]) {
    assert.equal(parse(render([{ title }]))[0].Finding, `'${title}`);
  }
});
test("empty findings produce a valid header-only CSV, not a fabricated clean result", () => {
  assert.deepEqual(parse(render([])), []);
  assert.match(render([]), /^\uFEFF"Tenant","Data Source"/);
});
test("export retains full source references beyond the UI display limit", () => {
  const references = Array.from({ length: 105 }, (_, index) => `synthetic-evidence-${index}`);
  const csv = render([{ title: "Synthetic finding", evidenceIds: references.slice(0, 100) }], {
    baselineScan: { findings: [{ evidenceIds: references }] }
  });
  assert.equal(parse(csv)[0]["Evidence References"].split("; ").length, 105);
});

test("grouped summary and opt-in full evidence CSV avoid quadratic reference repetition", () => {
  const root = path.resolve(__dirname, "..", "..");
  const api = require(path.join(root, "sharing-review"));
  const model = api.buildSharingReview({
    tenant: { tenantId: "synthetic" }, generatedAt: "2026-09-09T00:00:00Z",
    summary: { sitesScanned: 1, sampledItems: 8 },
    evidenceDetails: { permissionPaths: Array.from({ length: 64 }, (_, index) => ({
      evidenceId: `permission-${index}`, itemEvidenceId: `item-${index % 8}`,
      itemId: `item-${index % 8}`, siteId: "site-1", driveId: "drive-1",
      itemType: "File", displayName: index === 0 ? "=1+1" : index === 1 ? "x".repeat(900) : `File ${index % 8}`,
      siteDisplayName: "Synthetic site", driveDisplayName: "Documents",
      accessType: "user-direct-grant", principalRefs: ["user:synthetic"], roles: ["read"],
      inherited: true, inheritedFrom: { driveId: "drive-1", id: "parent-folder" }
    })) }
  });
  const context = { FlightDeckSharingReview: api, model };
  vm.createContext(context);
  vm.runInContext(`${section("csvCell", "controlsCsv")}\n${fs.readFileSync(path.join(root, "sharing-review-ui.js"), "utf8")}`, context);
  const summary = vm.runInContext(`FlightDeckSharingReviewUI.summaryCsv(model, {
    tenant: "Synthetic", observedAt: "2026-09-09T00:00:00Z", csvCell })`, context);
  const full = vm.runInContext(`FlightDeckSharingReviewUI.fullEvidenceCsv(model, {
    tenant: "Synthetic", observedAt: "2026-09-09T00:00:00Z", csvCell })`, context);
  const summaries = parse(summary);
  const rows = parse(full);
  assert.ok(summaries.length > 0 && summaries.length < 10);
  assert.equal(rows.length, 64);
  assert.equal(new Set(rows.map(row => row["Evidence reference"])).size, 64);
  assert.equal(rows.find(row => row["Evidence reference"] === "permission-0").Resource, "'=1+1");
  assert.equal(rows.find(row => row["Evidence reference"] === "permission-1").Resource.length, 900);
  assert.ok(rows.every(row => row.Roles === "read"));
  assert.ok(rows.every(row => /inherit/i.test(row["Permission origin"])));
  assert.ok(full.length < 100000, "Each permission must not repeat the entire finding's evidence ID list.");
});
