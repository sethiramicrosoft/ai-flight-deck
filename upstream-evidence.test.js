"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assessmentControlResults,
  createPilotCohort,
  mergeImportedControlResults,
  parseCsv,
  parseMicrosoftAutomatedAssessmentCsv,
  parseM365CopilotReadinessCsv,
  readinessControlResults
} = require("./upstream-evidence");

const header = [
  "User name",
  "Has Copilot license been assigned",
  "Uses eligible update channel",
  "Uses Teams Meetings",
  "Uses Teams chat",
  "Uses Outlook Email",
  "Uses Office docs",
  "Suggested candidate for Copilot"
].join(",");

function readinessCsv(rows) {
  return `\uFEFF${header}\r\n${rows.join("\r\n")}\r\n`;
}

function scan() {
  return {
    tenant: { tenantId: "11111111-1111-1111-1111-111111111111" },
    auth: { actor: { id: "reader@example.test" } },
    estateAssessment: {
      cohorts: [{ id: "tenant-wide" }],
      controlResults: [{
        controlId: "AFD-DEV-001",
        cohortId: "tenant-wide",
        domainId: "devicesAndApps",
        status: "Unknown"
      }],
      domains: [{
        id: "devicesAndApps",
        status: "Partial",
        summary: "",
        nextStep: ""
      }]
    }
  };
}

test("CSV parser handles quoted commas and escaped quotes", () => {
  const rows = parseCsv("Name,Note\r\n\"A, B\",\"Said \"\"hello\"\"\"\r\n");
  assert.deepEqual(rows, [{ name: "A, B", note: "Said \"hello\"" }]);
});

test("CSV parser rejects ragged rows", () => {
  assert.throws(
    () => parseCsv("Name,Note\r\nOnly one field\r\n"),
    /row 2 has 1 fields; expected 2/
  );
});

test("parses the Microsoft Copilot Readiness export and preserves privacy state", () => {
  const imported = parseM365CopilotReadinessCsv(readinessCsv([
    "pilot1@example.test,No,Yes,Yes,Yes,Yes,Yes,Yes",
    "pilot2@example.test,Yes,No,Yes,No,Yes,Yes,No"
  ]), {
    fileName: "copilot-readiness.csv",
    importedAt: "2026-09-04T12:00:00.000Z",
    reportedAt: "2026-09-03T12:00:00.000Z"
  });
  assert.equal(imported.privacy.identitiesVisible, true);
  assert.equal(imported.summary.rows, 2);
  assert.equal(imported.summary.copilotLicensedUsers, 1);
  assert.equal(imported.summary.suggestedCandidates, 1);
  assert.equal(imported.rows[1].eligibleUpdateChannel, false);
  assert.equal(imported.reportedAt, "2026-09-03T12:00:00.000Z");
  assert.equal(imported.sourceArtifact.sha256.length, 64);
  assert.ok(imported.sourceArtifact.byteSize > 0);
});

test("readiness import detects mixed privacy and duplicate identified users", () => {
  const mixed = parseM365CopilotReadinessCsv(readinessCsv([
    "pilot1@example.test,No,Yes,Yes,Yes,Yes,Yes,Yes",
    "User 2,No,Yes,Yes,Yes,Yes,Yes,Yes"
  ]));
  assert.equal(mixed.privacy.mode, "Mixed");
  assert.equal(mixed.privacy.identifiedRows, 1);
  assert.equal(mixed.privacy.concealedRows, 1);

  assert.throws(() => parseM365CopilotReadinessCsv(readinessCsv([
    "pilot1@example.test,No,Yes,Yes,Yes,Yes,Yes,Yes",
    "PILOT1@example.test,No,Yes,Yes,Yes,Yes,Yes,Yes"
  ])), /duplicate identified users/);
});

test("concealed readiness identities cannot be used to create a cohort", () => {
  const imported = parseM365CopilotReadinessCsv(readinessCsv([
    "User 1,No,Yes,Yes,Yes,Yes,Yes,Yes"
  ]));
  assert.equal(imported.privacy.mode, "Concealed");
  assert.throws(() => createPilotCohort(imported, {
    owner: "Program Owner",
    approved: true,
    userNames: ["User 1"]
  }), /conceals user identities/);
});

test("creates an approved cohort from selected readiness candidates", () => {
  const imported = parseM365CopilotReadinessCsv(readinessCsv([
    "pilot1@example.test,No,Yes,Yes,Yes,Yes,Yes,Yes",
    "pilot2@example.test,Yes,Yes,Yes,No,Yes,Yes,No"
  ]), { importedAt: "2026-09-04T12:00:00.000Z" });
  const cohort = createPilotCohort(imported, {
    name: "Finance pilot",
    owner: "Finance Copilot Lead",
    approved: true,
    userNames: ["PILOT2@EXAMPLE.TEST", "pilot1@example.test"]
  });
  assert.equal(cohort.approved, true);
  assert.equal(cohort.population, 2);
  assert.deepEqual(cohort.userPrincipalNames, [
    "pilot1@example.test",
    "pilot2@example.test"
  ]);
  assert.deepEqual(cohort.members[0].activeWorkloads, [
    "Teams Meetings",
    "Teams chat",
    "Outlook Email",
    "Office docs"
  ]);
});

test("readiness report can prove an update-channel failure but not a complete pass", () => {
  const failedImport = parseM365CopilotReadinessCsv(readinessCsv([
    "pilot1@example.test,Yes,No,Yes,Yes,Yes,Yes,No",
    "pilot2@example.test,Yes,Yes,Yes,Yes,Yes,Yes,No"
  ]), {
    importedAt: "2026-09-04T12:00:00.000Z",
    reportedAt: "2026-09-03T12:00:00.000Z"
  });
  const [failure] = readinessControlResults(scan(), failedImport);
  assert.equal(failure.controlId, "AFD-DEV-001");
  assert.equal(failure.status, "Fail");
  assert.equal(failure.observedValue.observedEligiblePercentage, 50);

  const passingSample = parseM365CopilotReadinessCsv(readinessCsv([
    "pilot1@example.test,Yes,Yes,Yes,Yes,Yes,Yes,No"
  ]), {
    importedAt: "2026-09-04T12:00:00.000Z",
    reportedAt: "2026-09-03T12:00:00.000Z"
  });
  const [unknown] = readinessControlResults(scan(), passingSample);
  assert.equal(unknown.status, "Unknown");
  assert.equal(unknown.limitations[0].code, "READINESS_REPORT_ACTIVITY_POPULATION");
});

test("readiness report without an as-of date remains non-gating", () => {
  const imported = parseM365CopilotReadinessCsv(readinessCsv([
    "pilot1@example.test,Yes,No,Yes,Yes,Yes,Yes,No"
  ]), { importedAt: "2026-09-04T12:00:00.000Z" });
  const [unknown] = readinessControlResults(scan(), imported);
  assert.equal(unknown.status, "Unknown");
  assert.equal(unknown.limitations[0].code, "MISSING_SOURCE_TIMESTAMP");
});

test("parses and conservatively maps the pinned Microsoft automated assessment", () => {
  const csv = [
    "Service,Feature,Status,Priority,Observation,Recommendation,LinkText,LinkUrl",
    "Power Platform,DLP Governance - BLOCKER: HTTP Connector,Success,High,HTTP is blocked,Allow it safely,DLP guide,https://example.test/dlp",
    "Defender,Defender for Endpoint - Device Onboarding,Success,Low,12 devices onboarded,Review coverage,Device guide,https://example.test/device",
    "M365,Unverified feature,Success,Low,Observed,Consider action,,"
  ].join("\r\n");
  const imported = parseMicrosoftAutomatedAssessmentCsv(csv, {
    importedAt: "2026-09-04T12:00:00.000Z",
    reportedAt: "2026-09-03T12:00:00.000Z",
    upstreamVersion: "f542406ffba2066d943643de8d7a87b755b98cab"
  });
  assert.equal(imported.summary.rows, 3);
  assert.equal(imported.summary.mappedRows, 2);
  assert.equal(imported.summary.stagedRows, 1);
  assert.equal(imported.mappedRows[0].proposedStatus, "Fail");
  assert.equal(imported.mappedRows[1].proposedStatus, "Warning");
  assert.equal(imported.stagedRows[0].stagingReason, "NO_VERIFIED_CONTROL_CROSSWALK");

  const results = assessmentControlResults(scan(), imported);
  assert.deepEqual(results.map(result => result.controlId).sort(), [
    "AFD-PPA-001",
    "AFD-SEC-005"
  ]);
  assert.equal(results.find(result => result.controlId === "AFD-PPA-001").status, "Fail");
});

test("Microsoft assessment requires a pinned upstream version and source date for gating", () => {
  const csv = [
    "Service,Feature,Status,Priority,Observation,Recommendation",
    "Power Platform,DLP Governance - BLOCKER: HTTP Connector,Success,High,HTTP is blocked,Allow it safely"
  ].join("\r\n");
  assert.throws(
    () => parseMicrosoftAutomatedAssessmentCsv(csv),
    /commit or release is required/
  );
  const imported = parseMicrosoftAutomatedAssessmentCsv(csv, {
    upstreamVersion: "f542406ffba2066d943643de8d7a87b755b98cab"
  });
  assert.equal(imported.mappedRows[0].proposedStatus, "Unknown");
  assert.equal(imported.mappedRows[0].reasonCode, "MISSING_SOURCE_TIMESTAMP");

  const unsupported = parseMicrosoftAutomatedAssessmentCsv(csv, {
    reportedAt: "2026-09-03T12:00:00.000Z",
    upstreamVersion: "different-revision"
  });
  assert.equal(unsupported.summary.mappedRows, 0);
  assert.equal(unsupported.summary.stagedRows, 1);
  assert.equal(unsupported.stagedRows[0].stagingReason, "UNSUPPORTED_UPSTREAM_VERSION");
});

test("merges imported results and records source provenance in the baseline", () => {
  const baseline = scan();
  const imported = parseM365CopilotReadinessCsv(readinessCsv([
    "pilot1@example.test,Yes,No,Yes,Yes,Yes,Yes,No"
  ]), {
    importedAt: "2026-09-04T12:00:00.000Z",
    reportedAt: "2026-09-03T12:00:00.000Z"
  });
  mergeImportedControlResults(baseline, readinessControlResults(baseline, imported), {
    sourceType: imported.sourceType,
    importedAt: imported.importedAt,
    fileName: imported.fileName,
    rows: imported.summary.rows
  });
  assert.equal(baseline.estateAssessment.controlResults[0].status, "Fail");
  assert.equal(baseline.estateAssessment.evaluatedControls, 1);
  assert.equal(baseline.estateAssessment.unknownControls, 0);
  assert.equal(baseline.estateAssessment.domains[0].status, "Collected");
  assert.equal(baseline.estateAssessment.upstreamSources[0].sourceType,
    "m365-copilot-readiness");
});
