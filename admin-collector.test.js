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
    const bytes = result.files.length === 1 ? fs.readFileSync(path.join(workspace, result.files[0])) : null;
    return {
      ...result, stdout: processResult.stdout.slice(0, marker.index),
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
    assert.equal(result.calls.filter(call => call.command === disconnect).length, 1);
    assert.equal(result.calls.filter(call => call.command === "Install-Module").length, 0);
    assert.doesNotMatch(result.stdout, /Import this package|result\.json/);
    if (workload === "sharePointOnline") {
      assert.equal(doc.actorId, null);
      assert.equal(doc.connections[workload].observedTenantId, null);
      assert.equal(doc.connections[workload].tenantVerified, false);
      assert.equal(doc.connections[workload].adminUrl, "https://synthetic-admin.sharepoint.com");
      assert.equal(result.calls.find(call => call.command === connect).useSystemBrowser, true);
      assert.equal(result.calls.find(call => call.command === "Import-Module").compatibility, result.psEdition === "Core");
      assert.equal(result.calls.filter(call => call.command === "Get-SPOSite").length, 3);
      assert.equal(result.calls.find(call => call.command === "Get-SPOSite" && call.includePersonalSite).limit, "All");
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
  assert.equal(result.calls.filter(call => call.command === "Disconnect-ExchangeOnline").length, 2);
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
  ["missingCommand", "COMMAND_UNAVAILABLE"],
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
});

test("admin collector installs only missing allowed modules for CurrentUser without changing trust", { skip }, () => {
  const missing = runScenario("moduleMissing");
  assert.match(missing.failure, /^MODULE_MISSING:/);
  assert.equal(missing.outputExists, false);
  assert.equal(missing.calls.filter(call => call.command === "Install-Module").length, 0);
  for (const workload of ["exchangeOnline", "sharePointOnline"]) {
    const result = runScenario("install", workload);
    assert.equal(result.failure, null);
    const installs = result.calls.filter(call => call.command === "Install-Module");
    assert.equal(installs.length, 1);
    assert.equal(installs[0].name, workload === "exchangeOnline" ? "ExchangeOnlineManagement" : "Microsoft.Online.SharePoint.PowerShell");
    assert.equal(installs[0].scope, "CurrentUser");
    assert.equal(installs[0].repository, "PSGallery");
    assert.equal(installs[0].force, true);
    assert.equal(installs[0].allowClobber, true);
    assert.equal(installs[0].confirm, false);
    assert.equal(installs[0].acceptLicense, true);
    assert.equal(installs[0].tls12, true);
    assert.equal(result.securityProtocolRestored, true);
    assert.equal(result.calls.find(call => call.command === "Install-PackageProvider").scope, "CurrentUser");
  }
  for (const scenario of ["installFailure", "galleryHijacked"]) {
    const failed = runScenario(scenario);
    assert.match(failed.failure, /^MODULE_INSTALL_FAILED:/);
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
