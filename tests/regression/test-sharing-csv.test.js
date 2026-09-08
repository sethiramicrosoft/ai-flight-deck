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
