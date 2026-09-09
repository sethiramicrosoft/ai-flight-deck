"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const script = path.join(__dirname, "scanner", "collect-admin-evidence.ps1");
const harness = path.join(__dirname, "scanner", "admin-collector-test-harness.ps1");
const executable = process.env.ADMIN_COLLECTOR_POWERSHELL ||
  (process.platform === "win32" ? "pwsh.exe" : "pwsh");
const probe = spawnSync(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion.ToString()"], { encoding: "utf8" });
const skip = probe.error?.code === "ENOENT" ? `${executable} is unavailable` : false;

function runScenario(scenario, workload = "exchangeOnline", extra = []) {
  const workspace = fs.mkdtempSync(path.join(__dirname, ".admin-collector-test-"));
  try {
    const processResult = spawnSync(executable, [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-File", harness,
      "-CollectorPath", script, "-WorkspacePath", workspace,
      "-Scenario", scenario, "-Workload", workload, ...extra
    ], { encoding: "utf8", timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    assert.ifError(processResult.error);
    assert.equal(processResult.status, 0, processResult.stderr);
    assert.doesNotMatch(processResult.stdout + processResult.stderr, /SENSITIVE_TEST_VALUE|partial-must-not-survive/);
    const marker = processResult.stdout.match(/ADMIN_TEST_RESULT:(.+)/);
    assert.ok(marker, processResult.stdout + processResult.stderr);
    const result = JSON.parse(marker[1]);
    const diagnosticMarkers = [...processResult.stderr.matchAll(/^AFD_COLLECTOR_ERROR:(.+)$/gm)];
    assert.ok(diagnosticMarkers.length <= 1, "A failed producer emits one structured diagnostic.");
    const diagnostic = diagnosticMarkers.length ? JSON.parse(diagnosticMarkers[0][1]) : null;
    const bytes = result.files.length === 1 ? fs.readFileSync(path.join(workspace, result.files[0])) : null;
    if (bytes) assert.doesNotMatch(bytes.toString("utf8"), /SENSITIVE_TEST_VALUE|partial-must-not-survive|LIST_DEFAULT_MUST_NOT_BE_ACCEPTED/);
    return {
      ...result, stdout: processResult.stdout.slice(0, marker.index),
      diagnostic,
      document: bytes ? JSON.parse(bytes.toString("utf8")) : null,
      bom: bytes?.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))
    };
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

test("admin collector parses without errors and preserves the 31 producer keys", { skip }, () => {
  const source = fs.readFileSync(script, "utf8");
  const entries = [...source.matchAll(/Add-Evidence (\w+) ([\w-]+) \{[^{}]*\}[ \t]*(\w+)?/g)];
  assert.equal(entries.length, 31);
  assert.equal(entries.length, (source.match(/^\s+Add-Evidence /gm) || []).length);
  assert.equal(new Set(entries.map(([, service, command, key]) => `${service}:${command}:${key || ""}`)).size, 31);
  assert.doesNotMatch(source, /WindowsIdentity|Read-Host|Get-Credential|Set-ExecutionPolicy|Set-PSRepository|Register-PSRepository/);
  const escaped = script.replaceAll("'", "''");
  const parsed = spawnSync(executable, ["-NoProfile", "-NonInteractive", "-Command",
    `$tokens=$null; $errors=$null; [System.Management.Automation.Language.Parser]::ParseFile('${escaped}',[ref]$tokens,[ref]$errors) | Out-Null; if($errors.Count){$errors | ForEach-Object {$_.Message}; exit 1}`
  ], { encoding: "utf8" });
  assert.equal(parsed.status, 0, parsed.stdout + parsed.stderr);
});

for (const [workload, count, connect, disconnect] of [
  ["exchangeOnline", 11, "Connect-ExchangeOnline", "Disconnect-ExchangeOnline"],
  ["sharePointOnline", 7, "Connect-SPOService", "Disconnect-SPOService"],
  ["purview", 13, "Connect-IPPSSession", "Disconnect-ExchangeOnline"]
]) {
  test(`admin collector ${workload} produces fresh bounded evidence and disconnects`, { skip }, () => {
    const result = runScenario("success", workload);
    assert.equal(result.failure, null);
    assert.equal(result.bom, false);
    assert.deepEqual(result.files, ["result.json"]);
    const doc = result.document;
    assert.equal(doc.schema, "ai-flight-deck/admin-evidence");
    assert.equal(doc.version, "1.0.0");
    assert.equal(doc.collectionChallenge, "synthetic_challenge_0123456789_abcdefghijklmnop");
    assert.deepEqual(doc.workloads, [workload]);
    assert.equal(Object.keys(doc.evidence).length, count);
    assert.equal(Object.keys(doc.errors).length, 0);
    assert.equal(doc.collection.attemptedCommandCount, count);
    assert.equal(doc.collection.succeededCommandCount, count);
    assert.equal(doc.collection.failedCommandCount, 0);
    assert.equal(doc.collection.coverageComplete, false);
    assert.equal(doc.workloadResults[workload].status, "succeeded");
    assert.equal(doc.collection.excludedWorkloads.length, 2);
    assert.ok(Object.values(doc.commandResults).every(result => result.boundary.coverageComplete === false));
    assert.equal(result.calls.filter(call => call.command === connect).length, 1);
    assert.equal(result.calls.filter(call => call.command === disconnect).length, workload === "purview" ? 2 : 1);
    assert.equal(result.calls.filter(call => call.command === "Save-Module").length, 0);
    assert.doesNotMatch(result.stdout, /Import this package|result\.json/);
    if (workload === "sharePointOnline") {
      assert.equal(doc.actorId, null);
      assert.equal(doc.connections[workload].observedTenantId, null);
      assert.equal(doc.connections[workload].tenantVerified, false);
      assert.equal(doc.connections[workload].adminUrl, "https://synthetic-admin.sharepoint.com");
      assert.equal(result.calls.find(call => call.command === connect).useSystemBrowser, true);
      assert.equal(result.calls.find(call => call.command === "Import-Module").compatibility, result.psEdition === "Core");
      const siteCalls = result.calls.filter(call => call.command === "Get-SPOSite");
      assert.equal(siteCalls.filter(call => !call.identity).length, 2);
      assert.equal(siteCalls.filter(call => call.identity).length, 3);
      assert.equal(siteCalls.find(call => call.includePersonalSite).limit, "1000");
      assert.ok(siteCalls.filter(call => call.identity).every(call => !call.limit));
    } else {
      assert.equal(doc.actorId, "synthetic-admin@example.invalid");
      assert.equal(doc.connections[workload].observedTenantId, doc.tenantId);
      assert.equal(doc.connections[workload].tenantVerified, true);
      assert.equal(result.calls.find(call => call.command === connect).disableWAM, true);
    }
  });

  test(`admin collector ${workload} cancellation fails without output and still disconnects`, { skip }, () => {
    const result = runScenario("signInFailure", workload);
    assert.match(result.failure, /^SIGN_IN_FAILED:/);
    assert.equal(result.outputExists, false);
    assert.equal(result.calls.filter(call => call.command === disconnect).length, 1);
    assert.equal(result.calls.filter(call => call.command.startsWith("Get-") && !["Get-Module"].includes(call.command)).length, 0);
  });
}

test("admin collector combined CLI preserves all keys and actual identities", { skip }, () => {
  const result = runScenario("success", "all");
  assert.equal(result.failure, null);
  assert.equal(Object.keys(result.document.evidence).length, 31);
  assert.equal(result.document.collection.attemptedCommandCount, 31);
  assert.deepEqual(result.document.collection.excludedWorkloads, []);
  assert.equal(result.calls.filter(call => call.command === "Disconnect-ExchangeOnline").length, 3);
});

for (const scenario of ["tenantMismatch", "missingTenant", "missingActor", "wrongSession", "inactive", "ambiguous", "existingConnection"]) {
  test(`admin collector rejects ${scenario} before acquisition`, { skip }, () => {
    const result = runScenario(scenario);
    assert.match(result.failure, /^(TENANT_MISMATCH|CONNECTION_IDENTITY_UNVERIFIED|EXISTING_CONNECTION):/);
    assert.equal(result.outputExists, false);
    assert.equal(result.calls.filter(call => call.command === "Get-EXOMailbox").length, 0);
  });
}

for (const [scenario, code] of [
  ["partialFailure", "COMMAND_FAILED"],
  ["accessDenied", "COMMAND_ACCESS_DENIED"],
  ["missingCommand", "ON_PREMISES_SOURCE_UNAVAILABLE"],
  ["warning", "COMMAND_WARNING"]
]) {
  test(`admin collector ${scenario} does not accept failed or partial output`, { skip }, () => {
    const result = runScenario(scenario);
    assert.equal(result.failure, null);
    assert.equal(result.document.errors["exchangeOnline:Get-HybridConfiguration"].code, code);
    assert.equal(result.document.evidence["exchangeOnline:Get-HybridConfiguration"], undefined);
    assert.equal(result.document.collection.attemptedCommandCount, 11);
    assert.equal(result.document.collection.succeededCommandCount, 10);
    assert.equal(result.document.collection.failedCommandCount, 1);
    assert.equal(result.document.workloadResults.exchangeOnline.status, "partial");
  });
}

test("absent cloud hybrid command reports an unresolved on-premises source, not a role remediation", { skip }, () => {
  const result = runScenario("missingCommand", "exchangeOnline");
  const key = "exchangeOnline:Get-HybridConfiguration";
  assert.equal(result.failure, null);
  assert.equal(result.document.errors[key].code, "ON_PREMISES_SOURCE_UNAVAILABLE");
  assert.match(result.document.errors[key].message, /on-premises Exchange command/);
  assert.match(result.document.errors[key].message, /Hybrid configuration remains unresolved/);
  assert.match(result.document.errors[key].message, /changing cloud roles does not supply this source/);
  assert.doesNotMatch(result.document.errors[key].message, /not.?applicable|no hybrid/i);
  assert.equal(result.document.evidence[key], undefined);
  assert.equal(result.document.commandResults[key].status, "failed");
  assert.equal(result.document.commandResults[key].code, "ON_PREMISES_SOURCE_UNAVAILABLE");
  assert.equal(result.document.workloadResults.exchangeOnline.status, "partial");
  assert.equal(result.document.collection.succeededCommandCount, 10);
});

for (const [workload, command, days] of [
  ["exchangeOnline", "Get-MessageTraceV2", 7], ["purview", "Search-UnifiedAuditLog", 1]
]) {
  test(`admin collector ${command} reports bounds and withholds capped results`, { skip }, () => {
    const result = runScenario("limit", workload);
    const key = `${workload}:${command}`;
    assert.equal(result.failure, null);
    assert.equal(result.document.errors[key].code, "RESULT_LIMIT_REACHED");
    assert.equal(result.document.evidence[key], undefined);
    const boundary = result.document.commandResults[key].boundary;
    assert.equal(boundary.resultLimit, 5000);
    assert.equal(boundary.pagination, "single-query-no-continuation");
    assert.equal(Date.parse(boundary.endDate) - Date.parse(boundary.startDate), days * 86400000);
    assert.equal(result.calls.find(call => call.command === command).resultSize, 5000);
  });
}

test("admin collector distinguishes valid empty results from a wholly failed workload", { skip }, () => {
  const empty = runScenario("empty");
  assert.equal(empty.failure, null);
  assert.deepEqual(empty.document.evidence["exchangeOnline:Get-EXOMailbox"], []);
  const failed = runScenario("allFailure");
  assert.match(failed.failure, /^WORKLOAD_COLLECTION_FAILED:/);
  assert.equal(failed.outputExists, false);
  assert.equal(failed.diagnostic.issues.length, 11);
  assert.equal(failed.diagnostic.collection.attemptedCommandCount, 11);
  assert.equal(failed.diagnostic.collection.failedCommandCount, 11);
  assert.ok(failed.diagnostic.issues.every(issue => issue.code === "COMMAND_FAILED" && /underlying cause is unavailable/.test(issue.message)));
});

test("all denied SPO reads remain fatal but preserve all seven exact diagnostic issues and outcomes", { skip }, () => {
  const result = runScenario("allDenied", "sharePointOnline");
  assert.match(result.failure, /^WORKLOAD_COLLECTION_FAILED:/);
  assert.equal(result.outputExists, false);
  assert.deepEqual(result.files, []);
  const diagnostic = result.diagnostic;
  assert.equal(diagnostic.code, "WORKLOAD_COLLECTION_FAILED");
  assert.equal(diagnostic.stageCode, "WORKLOAD_COLLECTION_FAILED");
  const expected = [
    "sharePointOnline:Get-SPODataAccessGovernanceInsight:siteAccessReport",
    "sharePointOnline:Get-SPODataAccessGovernanceInsight:dataAccessGovernance",
    "sharePointOnline:Get-SPOTenantRestrictedSearchMode",
    "sharePointOnline:Get-SPOTenantRestrictedSearchAllowedList",
    "sharePointOnline:Get-SPOSite:restrictedContent",
    "sharePointOnline:Get-SPOSite:siteLifecycle",
    "sharePointOnline:Get-SPOSite:oneDriveOverrides"
  ];
  assert.deepEqual(diagnostic.issues.map(issue => issue.resource), expected);
  assert.deepEqual(Object.keys(diagnostic.commandResults), expected);
  for (const issue of diagnostic.issues) {
    assert.deepEqual(Object.keys(issue).sort(), ["code", "message", "resource"]);
    assert.equal(issue.code, "COMMAND_ACCESS_DENIED");
    assert.equal(diagnostic.commandResults[issue.resource].status, "failed");
    assert.equal(diagnostic.commandResults[issue.resource].code, issue.code);
  }
  assert.deepEqual(diagnostic.collection, {
    attemptedCommandCount: 7, succeededCommandCount: 0, failedCommandCount: 7, observationRowCount: 0, coverageComplete: false
  });
  assert.equal(diagnostic.workloadResults.sharePointOnline.status, "failed");
  assert.equal(diagnostic.evidence, undefined);
  assert.equal(diagnostic.connections, undefined);
});

test("all-workload fatal diagnostics are bounded to the 31 planned keys", { skip }, () => {
  const result = runScenario("allFailure", "all");
  assert.equal(result.outputExists, false);
  assert.equal(result.diagnostic.issues.length, 31);
  assert.equal(new Set(result.diagnostic.issues.map(issue => issue.resource)).size, 31);
  assert.equal(Object.keys(result.diagnostic.commandResults).length, 31);
  assert.equal(result.diagnostic.collection.attemptedCommandCount, 31);
  assert.deepEqual(Object.keys(result.diagnostic.workloadResults), ["exchangeOnline", "sharePointOnline", "purview"]);
  assert.ok(Object.values(result.diagnostic.workloadResults).every(outcome => outcome.status === "failed"));
});

test("real synthetic parameter-binding exceptions identify a collector contract defect without losing other reads", { skip }, () => {
  const result = runScenario("parameterBinding", "sharePointOnline");
  assert.equal(result.failure, null);
  assert.equal(result.diagnostic, null);
  assert.equal(result.document.collection.succeededCommandCount, 5);
  assert.equal(result.document.collection.failedCommandCount, 2);
  for (const key of ["siteAccessReport", "dataAccessGovernance"]) {
    const resource = `sharePointOnline:Get-SPODataAccessGovernanceInsight:${key}`;
    assert.equal(result.document.errors[resource].code, "COMMAND_PARAMETER_BINDING");
    assert.equal(result.document.errors[resource].parameter, "ReportType");
    assert.match(result.document.errors[resource].message, /collector invocation/);
    assert.equal(result.document.commandResults[resource].code, "COMMAND_PARAMETER_BINDING");
    assert.equal(result.document.evidence[resource], undefined);
  }
  assert.equal(result.document.evidence["sharePointOnline:Get-SPOSite:siteLifecycle"].length, 2);
  const unsafe = runScenario("unsafeParameterName", "sharePointOnline");
  assert.equal(unsafe.failure, null);
  assert.doesNotMatch(JSON.stringify(unsafe.document), /SENSITIVE_TEST_VALUE/);
  assert.ok(Object.values(unsafe.document.errors).every(error => error.code === "COMMAND_PARAMETER_BINDING" && error.parameter === undefined));
});

test("DAG queries use documented entities and report types without claiming detailed or complete coverage", { skip }, () => {
  const result = runScenario("dagContract", "sharePointOnline");
  assert.equal(result.failure, null);
  assert.deepEqual(result.dagContractChecks, [
    { legacyReportType: "SitePermissions", rejectedByBinding: true },
    { legacyReportType: "OversharingBaseline", rejectedByBinding: true },
    { invalidReportEntity: "UnsupportedEntity", rejectedByBinding: true },
    { reportEntityMandatory: true }
  ]);
  const calls = result.calls.filter(call => call.command === "Get-SPODataAccessGovernanceInsight");
  assert.equal(calls.length, 2);
  const expected = [
    ["siteAccessReport", "PermissionsReport", "Snapshot"],
    ["dataAccessGovernance", "EveryoneExceptExternalUsersForItems", "RecentActivity"]
  ];
  for (const [index, [key, reportEntity, reportType]] of expected.entries()) {
    assert.equal(calls[index].reportEntity, reportEntity);
    assert.equal(calls[index].reportType, reportType);
    assert.equal(calls[index].workload, "SharePoint");
    const boundary = result.document.commandResults[`sharePointOnline:Get-SPODataAccessGovernanceInsight:${key}`].boundary;
    assert.equal(boundary.reportEntity, reportEntity);
    assert.equal(boundary.reportType, reportType);
    assert.equal(boundary.workload, "SharePoint");
    assert.equal(boundary.pagination, "existing-report-metadata-only");
    assert.equal(boundary.coverageComplete, false);
    assert.ok(boundary.exclusions.some(exclusion => /Detailed/.test(exclusion)));
  }
  const results = result.document.commandResults;
  assert.match(results["sharePointOnline:Get-SPODataAccessGovernanceInsight:siteAccessReport"].boundary.note, /metadata, not detailed site permissions/);
  assert.match(results["sharePointOnline:Get-SPODataAccessGovernanceInsight:dataAccessGovernance"].boundary.note, /not complete oversharing coverage/);
  assert.ok(result.calls.every(call => !/^(Start|Export|New)-SPO/.test(call.command)));
  assert.equal(result.document.version, "1.0.0");
  assert.equal(result.document.producerVersion, "1.1.0");
});

for (const [scenario, code] of [
  ["missingConnection", "CONNECTION_UNAVAILABLE"], ["throttled", "COMMAND_THROTTLED"],
  ["http403", "COMMAND_ACCESS_DENIED"], ["unsupported", "FEATURE_UNSUPPORTED"],
  ["unlicensed", "FEATURE_NOT_LICENSED"]
]) {
  test(`safe ${scenario} classification retains fatal command issues`, { skip }, () => {
    const result = runScenario(scenario, "sharePointOnline");
    assert.match(result.failure, /^WORKLOAD_COLLECTION_FAILED:/);
    assert.equal(result.outputExists, false);
    assert.equal(result.diagnostic.issues.length, 7);
    assert.ok(result.diagnostic.issues.every(issue => issue.code === code));
  });
}

for (const [scenario, code, aadstsCode] of [
  ["authConditionalAccess", "AUTH_CONDITIONAL_ACCESS", "53003"],
  ["authConsent", "AUTH_CONSENT_REQUIRED", "65001"],
  ["authUnknownAadsts", "SIGN_IN_FAILED", "99999"],
  ["authHttp401", "AUTHENTICATION_REQUIRED", undefined],
  ["authCancelled", "OPERATION_CANCELLED", undefined]
]) {
  test(`Purview ${scenario} emits safe authentication diagnostics without credential details`, { skip }, () => {
    const result = runScenario(scenario, "purview");
    assert.equal(result.outputExists, false);
    assert.equal(result.diagnostic.code, code);
    assert.equal(result.diagnostic.stageCode, "SIGN_IN_FAILED");
    assert.equal(result.diagnostic.aadstsCode, aadstsCode);
    assert.deepEqual(result.diagnostic.issues, []);
    assert.deepEqual(result.diagnostic.commandResults, {});
    assert.equal(result.diagnostic.collection.attemptedCommandCount, 0);
    if (scenario !== "authCancelled") assert.doesNotMatch(result.diagnostic.message, /cancelled/i);
    if (scenario === "authHttp401") assert.equal(result.diagnostic.httpStatus, 401);
    assert.equal(result.calls.filter(call => call.command === "Disconnect-ExchangeOnline").length, 1);
  });
}

test("unknown Purview authentication failure does not assert cancellation, permissions, or user fault", { skip }, () => {
  const result = runScenario("signInFailure", "purview");
  assert.equal(result.diagnostic.code, "SIGN_IN_FAILED");
  assert.match(result.diagnostic.message, /connection could not be established; the underlying cause is unavailable/);
  assert.doesNotMatch(result.diagnostic.message, /cancel|permission|consent|license/i);
});

test("admin collector saves only missing allowed modules privately without changing trust", { skip }, () => {
  const missing = runScenario("moduleMissing");
  assert.match(missing.failure, /^MODULE_MISSING:/);
  assert.equal(missing.outputExists, false);
  assert.equal(missing.calls.filter(call => call.command === "Save-Module").length, 0);
  for (const workload of ["exchangeOnline", "sharePointOnline"]) {
    const result = runScenario("install", workload);
    assert.equal(result.failure, null);
    const installs = result.calls.filter(call => call.command === "Save-Module");
    assert.equal(installs.length, 1);
    assert.equal(installs[0].name, workload === "exchangeOnline" ? "ExchangeOnlineManagement" : "Microsoft.Online.SharePoint.PowerShell");
    assert.match(installs[0].path, /local-app-data\\AI Flight Deck\\PowerShell\\Modules$/);
    assert.equal(installs[0].repository, "PSGallery");
    assert.equal(installs[0].force, true);
    assert.equal(installs[0].confirm, false);
    assert.equal(installs[0].acceptLicense, true);
    assert.equal(installs[0].tls12, true);
    assert.equal(result.securityProtocolRestored, true);
    assert.equal(result.calls.find(call => call.command === "Install-PackageProvider").scope, "CurrentUser");
  }
  for (const scenario of ["installFailure", "galleryHijacked"]) {
    const failed = runScenario(scenario);
    assert.match(failed.failure, scenario === "galleryHijacked" ? /^MODULE_GALLERY_SOURCE_REJECTED:/ : /^MODULE_DOWNLOAD_FAILED:/);
    assert.equal(failed.outputExists, false);
    assert.equal(failed.securityProtocolRestored, true);
    assert.equal(failed.calls.filter(call => call.command.startsWith("Connect-")).length, 0);
  }
});

test("admin collector rejects unsupported SPO API and non-admin or unsafe URLs before sign-in", { skip }, () => {
  assert.match(runScenario("oldSpoApi", "sharePointOnline").failure, /^MODULE_API_UNAVAILABLE:/);
  for (const url of [
    "http://synthetic-admin.sharepoint.com", "https://synthetic.sharepoint.com",
    "https://synthetic-admin.sharepoint.com.attacker.invalid",
    "https://synthetic-admin.sharepoint.com/sites/team",
    "https://synthetic-admin.sharepoint.com?query=1",
    "https://admin@synthetic-admin.sharepoint.com",
    "https://synthetic-admin.sharepoint.com:444"
  ]) {
    const result = runScenario("success", "sharePointOnline", ["-AdminUrl", url]);
    assert.match(result.failure, /^SHAREPOINT_ADMIN_URL_INVALID:/);
    assert.equal(result.outputExists, false);
    assert.equal(result.calls.length, 0);
  }
});

test("admin collector keeps disconnect failures explicit and does not fabricate identity", { skip }, () => {
  const result = runScenario("disconnectFailure", "sharePointOnline");
  assert.equal(result.failure, null);
  assert.equal(result.document.collection.cleanupErrors[0].code, "DISCONNECT_FAILED");
  assert.equal(result.document.actorId, null);
  assert.match(result.stdout, /disconnect failed/);
  const both = runScenario("signInAndDisconnectFailure");
  assert.match(both.failure, /^SIGN_IN_FAILED:/);
  assert.equal(both.outputExists, false);
  assert.match(both.stdout, /disconnect failed/);
});

test("admin collector suppresses command information streams and exits nonzero on invalid input", { skip }, () => {
  const result = runScenario("information");
  assert.equal(result.failure, null);
  assert.equal(result.document.collection.succeededCommandCount, 11);
  const invalid = spawnSync(executable, ["-NoProfile", "-NonInteractive", "-File", script], {
    encoding: "utf8", timeout: 10000
  });
  assert.ifError(invalid.error);
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /INPUT_INVALID/);
  assert.doesNotMatch(invalid.stdout + invalid.stderr, /Supply values|Signing in/);
});

test("admin collector protects existing destinations and retains optional CLI output", { skip }, () => {
  const existing = runScenario("existingOutput");
  assert.match(existing.failure, /^OUTPUT_PATH_INVALID:/);
  assert.deepEqual(existing.document, { sentinel: true });
  assert.equal(existing.calls.length, 0);
  const manual = runScenario("manual");
  assert.equal(manual.failure, null);
  assert.match(manual.files[0], /^admin-evidence\.[a-f0-9]{32}\.json$/);
  assert.match(manual.stdout, /Administrator evidence package created:/);
  const invalid = runScenario("success", "exchangeOnline", ["-ExpectedTenant", "------------------------------------"]);
  assert.match(invalid.failure, /^INPUT_INVALID:/);
  assert.equal(invalid.calls.length, 0);
});

const siteKeys = ["restrictedContent", "siteLifecycle", "oneDriveOverrides"]
  .map(key => `sharePointOnline:Get-SPOSite:${key}`);

test("bounded site hydration caches inventory and identities without deprecated or default-bearing detail parameters", { skip }, () => {
  const result = runScenario("success", "sharePointOnline");
  assert.equal(result.failure, null);
  const calls = result.calls.filter(call => call.command === "Get-SPOSite");
  const inventory = calls.filter(call => !call.identity);
  const details = calls.filter(call => call.identity);
  assert.equal(inventory.length, 2);
  assert.ok(inventory.every(call => call.limit === "1000"));
  assert.equal(details.length, 3);
  assert.equal(new Set(details.map(call => call.identity)).size, 3);
  assert.ok(details.every(call => !call.limit && !call.includePersonalSite));
  assert.doesNotMatch(fs.readFileSync(script, "utf8"), /-Detailed\b/);
  for (const key of siteKeys) {
    const outcome = result.document.commandResults[key];
    assert.equal(outcome.acquisitionStatus, "collected");
    assert.equal(outcome.observationRowCount, 0);
    assert.equal(outcome.acceptedRowCount, result.document.evidence[key].length);
    assert.equal(outcome.boundary.maxSiteDetails, 200);
    assert.equal(outcome.boundary.inventoryLimit, 1000);
    assert.equal(outcome.boundary.coverageComplete, false);
    assert.deepEqual(outcome.siteDetails.fieldAvailability.notCollected, []);
    assert.ok(result.document.evidence[key].every(row => row.SharingCapability === "HYDRATED_VALUE"));
  }
  assert.equal(result.document.commandResults[siteKeys[1]].siteDetails.inventoryReadCount, 0);
  assert.equal(result.document.commandResults[siteKeys[1]].siteDetails.detailReadCount, 0);
  assert.equal(result.document.commandResults[siteKeys[2]].siteDetails.detailReadCount, 1);
});

test("32/32/52 warning-bearing site rows survive only as observations, with 52 unique detail reads", { skip }, () => {
  const result = runScenario("siteObserved32", "sharePointOnline");
  assert.equal(result.failure, null);
  for (const [index, key] of siteKeys.entries()) {
    const expected = index === 2 ? 52 : 32;
    assert.equal(result.document.evidence[key], undefined);
    assert.equal(result.document.observations[key].length, expected);
    const outcome = result.document.commandResults[key];
    assert.equal(outcome.acquisitionStatus, "partial");
    assert.equal(outcome.acceptedRowCount, 0);
    assert.equal(outcome.observationRowCount, expected);
    assert.equal(outcome.warningCount, 1);
    assert.equal(outcome.warningSourceCount, 1);
    assert.equal(outcome.warnings[0].code, "SPO_SITE_QUERY_WARNING");
    assert.equal(outcome.warnings[0].disposition, "observations-only");
    assert.equal(outcome.warnings[0].source, "inventory");
  }
  assert.equal(result.calls.filter(call => call.command === "Get-SPOSite" && call.identity).length, 52);
  assert.equal(result.document.collection.observationRowCount, 116);
  const outcome = require("./workload-collection").summarizeWorkloadEvidence(result.document);
  assert.equal(outcome.status, "collected-with-gaps");
  assert.equal(outcome.errors, 0);
  assert.equal(outcome.acquisitionSummary.partial, 3);
  for (const key of siteKeys) {
    const count = outcome.resourceCounts.find(item => item.resource === key);
    assert.equal(count.acceptedRows, 0);
    assert.equal(count.observationRows, result.document.observations[key].length);
  }
  assert.equal(result.document.workloadResults.sharePointOnline.status, "partial");
});

test("all-warning acquisitions create an observations-only partial package, but zero-row warnings remain fatal", { skip }, () => {
  const result = runScenario("allWarnings", "sharePointOnline");
  assert.equal(result.failure, null);
  assert.equal(result.diagnostic, null);
  assert.deepEqual(result.document.evidence, {});
  assert.equal(Object.keys(result.document.observations).length, 7);
  assert.equal(Object.keys(result.document.errors).length, 7);
  assert.equal(result.document.collection.acceptedRowCount, 0);
  assert.ok(result.document.collection.observationRowCount > 0);
  assert.equal(result.document.collection.partialCommandCount, 7);
  assert.equal(result.document.workloadResults.sharePointOnline.status, "partial");
  assert.ok(Object.values(result.document.commandResults).every(outcome => outcome.acquisitionStatus === "partial"));
  assert.equal(result.document.connections.sharePointOnline.targetConnected, true);
  assert.equal(result.document.connections.sharePointOnline.observedTenantId, null);
  assert.ok(result.document.observations[siteKeys[0]].every(row => row.SharingCapability === undefined));
  const empty = runScenario("allWarningsEmpty", "sharePointOnline");
  assert.match(empty.failure, /^WORKLOAD_COLLECTION_FAILED:/);
  assert.equal(empty.outputExists, false);
  assert.equal(empty.diagnostic.collection.observationRowCount, 0);
  assert.equal(empty.diagnostic.issues.length, 7);
});

test("site detail caps preserve inventory observations without accepting default-valued fields", { skip }, () => {
  const result = runScenario("success", "sharePointOnline", ["-MaxSiteDetails", "1"]);
  assert.equal(result.failure, null);
  assert.equal(result.calls.filter(call => call.command === "Get-SPOSite" && call.identity).length, 1);
  for (const key of siteKeys) {
    const outcome = result.document.commandResults[key];
    assert.equal(result.document.evidence[key], undefined);
    assert.equal(outcome.acquisitionStatus, "partial");
    assert.equal(outcome.code, "SITE_DETAIL_LIMIT");
    assert.ok(outcome.siteDetails.detailBudgetSkippedCount > 0);
    assert.ok(outcome.siteDetails.fieldAvailability.notCollected.includes("SharingCapability"));
    assert.ok(outcome.siteDetails.fieldAvailability.notCollected.includes("ConditionalAccessPolicy"));
    assert.equal(result.document.observations[key][1].SharingCapability, undefined);
  }
  const inventoryOnly = runScenario("success", "sharePointOnline", ["-MaxSiteDetails", "0"]);
  assert.equal(inventoryOnly.failure, null);
  assert.equal(inventoryOnly.calls.filter(call => call.command === "Get-SPOSite" && call.identity).length, 0);
  assert.ok(inventoryOnly.document.observations[siteKeys[0]].every(row => row.SharingCapability === undefined));
});

test("site deadline preserves acquired inventory but does not start late details or a new inventory scope", { skip }, () => {
  const result = runScenario("siteDeadline", "sharePointOnline");
  assert.equal(result.failure, null);
  const calls = result.calls.filter(call => call.command === "Get-SPOSite");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].identity, "");
  assert.equal(result.document.observations[siteKeys[0]].length, 2);
  assert.equal(result.document.commandResults[siteKeys[0]].siteDetails.detailDeadlineSkippedCount, 2);
  assert.equal(result.document.errors[siteKeys[2]].code, "SITE_COLLECTION_DEADLINE");
  assert.equal(result.document.commandResults[siteKeys[2]].siteDetails.inventoryReadCount, 0);
});

for (const [scenario, code] of [
  ["siteDetailFailure", "COMMAND_ACCESS_DENIED"],
  ["siteDetailWarning", "COMMAND_WARNING"],
  ["siteMissingField", "SITE_DETAIL_FIELDS_UNAVAILABLE"],
  ["siteDetailMismatch", "SITE_IDENTITY_MISMATCH"]
]) {
  test(`${scenario} is a configuration evidence gap, with safe observations and no repeated detail reads`, { skip }, () => {
    const result = runScenario(scenario, "sharePointOnline");
    assert.equal(result.failure, null);
    const reads = result.calls.filter(call => call.command === "Get-SPOSite" && call.identity);
    assert.equal(reads.length, 3);
    assert.equal(new Set(reads.map(call => call.identity)).size, 3);
    for (const key of siteKeys) {
      assert.equal(result.document.evidence[key], undefined);
      assert.equal(result.document.errors[key].code, code);
      assert.equal(result.document.commandResults[key].acquisitionStatus, "partial");
      assert.ok(result.document.observations[key].length > 0);
    }
    assert.doesNotMatch(JSON.stringify(result.document), /other\.sharepoint\.com/);
  });
}

test("foreign inventory identities are never followed or accepted", { skip }, () => {
  const result = runScenario("siteForeignInventory", "sharePointOnline");
  assert.equal(result.failure, null);
  const details = result.calls.filter(call => call.command === "Get-SPOSite" && call.identity);
  assert.equal(details.length, 1);
  assert.ok(details.every(call => call.identity.startsWith("https://synthetic-my.sharepoint.com/")));
  assert.equal(result.document.errors[siteKeys[0]].code, "SITE_IDENTITY_UNBOUND");
  assert.equal(result.document.evidence[siteKeys[0]], undefined);
  assert.doesNotMatch(JSON.stringify(result.document), /other\.sharepoint\.com/);
});

test("inventory at the 1000-row cap cannot become accepted configuration evidence", { skip }, () => {
  const result = runScenario("siteInventoryCap", "sharePointOnline", ["-MaxSiteDetails", "1"]);
  assert.equal(result.failure, null);
  assert.equal(result.calls.filter(call => call.command === "Get-SPOSite" && call.identity).length, 1);
  for (const key of siteKeys) {
    assert.equal(result.document.errors[key].code, "SITE_INVENTORY_LIMIT");
    assert.equal(result.document.evidence[key], undefined);
    assert.equal(result.document.observations[key].length, 1000);
    assert.equal(result.document.commandResults[key].acceptedRowCount, 0);
  }
});

test("source-specific report and label warnings do not imply missing roles or successful empty configuration", { skip }, () => {
  const report = runScenario("reportWarningEmpty", "sharePointOnline");
  assert.equal(report.failure, null);
  for (const key of ["siteAccessReport", "dataAccessGovernance"]) {
    const resource = `sharePointOnline:Get-SPODataAccessGovernanceInsight:${key}`;
    assert.equal(report.document.evidence[resource], undefined);
    assert.equal(report.document.commandResults[resource].observationRowCount, 0);
    assert.equal(report.document.commandResults[resource].warnings[0].code, "SPO_REPORT_QUERY_WARNING");
  }
  const label = runScenario("labelPolicyWarning", "purview");
  assert.equal(label.failure, null);
  const key = "purview:Get-LabelPolicy";
  assert.equal(label.document.evidence[key], undefined);
  assert.equal(label.document.observations[key].length, 1);
  assert.equal(label.document.commandResults[key].warnings[0].code, "PURVIEW_LABEL_POLICY_WARNING");
  assert.equal(label.document.commandResults[key].acquisitionStatus, "partial");
});

test("SPO inventory and identity parameter sets match installed SDK metadata without tenant invocation", {
  skip: process.platform !== "win32", timeout: 60000
}, t => {
  const windowsPowerShell = path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const verification = `
    $ErrorActionPreference = 'Stop'
    if (-not (Get-Module -ListAvailable Microsoft.Online.SharePoint.PowerShell)) {
      Write-Output 'SPO_METADATA_ABSENT'; exit 0
    }
    Import-Module Microsoft.Online.SharePoint.PowerShell -WarningAction SilentlyContinue
    $command = Get-Command Get-SPOSite
    foreach ($arguments in @(
      @{Limit='1000'; IncludePersonalSite=$false},
      @{Limit='1000'; IncludePersonalSite=$true},
      @{Identity='https://synthetic.sharepoint.com/sites/s1'}
    )) {
      foreach ($name in $arguments.Keys) {
        if (-not $command.Parameters.ContainsKey($name)) { throw 'Unsupported site parameter.' }
        $null = [Management.Automation.LanguagePrimitives]::ConvertTo($arguments[$name], $command.Parameters[$name].ParameterType)
      }
      $matching = @($command.ParameterSets | Where-Object {
        $set=$_
        @($arguments.Keys | Where-Object { $_ -notin $set.Parameters.Name }).Count -eq 0 -and
          @($set.Parameters | Where-Object {$_.IsMandatory -and -not $arguments.ContainsKey($_.Name)}).Count -eq 0
      })
      if (-not $matching.Count) { throw 'Incompatible site parameter set.' }
    }
    Write-Output 'SPO_SITE_CONTRACT_VERIFIED:3'
  `;
  const result = spawnSync(windowsPowerShell, ["-NoProfile", "-NonInteractive", "-Command", verification], {
    env: require("./server").powerShellEnvironment(windowsPowerShell),
    encoding: "utf8", timeout: 45000
  });
  assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
  if (result.stdout.includes("SPO_METADATA_ABSENT")) { t.skip("Installed SPO module unavailable."); return; }
  assert.match(result.stdout, /SPO_SITE_CONTRACT_VERIFIED:3/);
});

test("Purview audit data is acquired only after IPPS disconnect in a tenant- and actor-verified supplemental EXO session", { skip }, () => {
  const result = runScenario("success", "purview");
  assert.equal(result.failure, null);
  assert.match(result.stdout, /Purview audit data uses Exchange Online authentication/);
  const calls = result.calls;
  const ippsDisconnect = calls.findIndex(call => call.command === "Disconnect-ExchangeOnline");
  const supplementalConnect = calls.findIndex(call => call.command === "Connect-ExchangeOnline");
  const auditRead = calls.findIndex(call => call.command === "Search-UnifiedAuditLog");
  assert.ok(ippsDisconnect >= 0 && supplementalConnect > ippsDisconnect && auditRead > supplementalConnect);
  assert.equal(calls[auditRead].connectionService, "exchangeOnline");
  assert.equal(calls.find(call => call.command === "Get-LabelPolicy").connectionService, "purview");
  assert.equal(calls.filter(call => call.command === "Disconnect-ExchangeOnline").length, 2);
  assert.equal(calls.at(-1).command, "Disconnect-ExchangeOnline");
  const primary = result.document.connections.purview;
  const supplemental = primary.auditConnection;
  assert.deepEqual(Object.keys(result.document.connections), ["purview"]);
  assert.equal(primary.connectionId, "22222222-2222-4222-8222-222222222222");
  assert.equal(supplemental.connectionId, "44444444-4444-4444-8444-444444444444");
  assert.equal(supplemental.actorId, primary.actorId);
  assert.equal(supplemental.observedTenantId, primary.observedTenantId);
  assert.equal(supplemental.tenantVerified, true);
  assert.equal(supplemental.connectionService, "exchangeOnline");
  const auditKey = "purview:Search-UnifiedAuditLog";
  assert.equal(result.document.commandResults[auditKey].connectionService, "exchangeOnline");
  assert.equal(result.document.commandResults[auditKey].acquisitionStatus, "collected");
  assert.equal(result.document.evidence[auditKey].length, 1);
  const combined = runScenario("success", "all");
  assert.equal(combined.failure, null);
  assert.equal(combined.document.connections.exchangeOnline.connectionId, primary.connectionId);
  assert.equal(combined.document.connections.purview.auditConnection.connectionId, supplemental.connectionId);
});

for (const [scenario, code, readExpected, verifiedConnectionExpected] of [
  ["auditSignInFailure", "SIGN_IN_FAILED", false, false],
  ["auditConditionalAccess", "AUTH_CONDITIONAL_ACCESS", false, false],
  ["auditTenantMismatch", "TENANT_MISMATCH", false, false],
  ["auditActorMismatch", "ACTOR_MISMATCH", false, false],
  ["auditWrongSession", "CONNECTION_IDENTITY_UNVERIFIED", false, false],
  ["auditCommandMissing", "COMMAND_UNAVAILABLE", false, true],
  ["auditReadFailure", "COMMAND_ACCESS_DENIED", true, true]
]) {
  test(`${scenario} affects only the logical Purview audit key and retains policy evidence`, { skip }, () => {
    const result = runScenario(scenario, "purview");
    assert.equal(result.failure, null);
    assert.equal(result.diagnostic, null);
    const key = "purview:Search-UnifiedAuditLog";
    assert.equal(result.document.evidence[key], undefined);
    assert.deepEqual(Object.keys(result.document.errors), [key]);
    assert.equal(result.document.errors[key].code, code);
    assert.equal(Object.keys(result.document.evidence).length, 12);
    assert.equal(result.document.workloadResults.purview.status, "partial");
    assert.equal(result.document.commandResults[key].connectionService, "exchangeOnline");
    assert.equal(result.calls.some(call => call.command === "Search-UnifiedAuditLog"), readExpected);
    assert.equal(result.calls.filter(call => call.command === "Disconnect-ExchangeOnline").length, 2);
    assert.equal(!!result.document.connections.purview.auditConnection, verifiedConnectionExpected);
    assert.equal(result.document.connections.exchangeOnline, undefined);
    assert.equal(result.document.actorId, "synthetic-admin@example.invalid");
    assert.doesNotMatch(JSON.stringify(result.document), /other-admin@example\.invalid/);
  });
}

test("supplemental audit failure preserves policy observations; audit warnings cannot become accepted evidence", { skip }, () => {
  const policyWarning = runScenario("auditFailureWithPolicyWarning", "purview");
  assert.equal(policyWarning.failure, null);
  assert.equal(policyWarning.document.observations["purview:Get-LabelPolicy"].length, 1);
  assert.equal(policyWarning.document.evidence["purview:Get-LabelPolicy"], undefined);
  assert.equal(Object.keys(policyWarning.document.evidence).length, 11);
  assert.equal(policyWarning.document.errors["purview:Search-UnifiedAuditLog"].code, "SIGN_IN_FAILED");
  const auditWarning = runScenario("auditWarning", "purview");
  assert.equal(auditWarning.failure, null);
  assert.equal(auditWarning.document.observations["purview:Search-UnifiedAuditLog"].length, 1);
  assert.equal(auditWarning.document.evidence["purview:Search-UnifiedAuditLog"], undefined);
  assert.equal(auditWarning.document.commandResults["purview:Search-UnifiedAuditLog"].acquisitionStatus, "partial");
  assert.equal(Object.keys(auditWarning.document.evidence).length, 12);
});
