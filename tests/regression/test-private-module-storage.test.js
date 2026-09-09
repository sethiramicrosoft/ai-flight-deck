"use strict";

// 2026-09-09: private module storage regression; never installs real modules or signs in.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..", "..");
const { powerShellEnvironment } = require(path.join(root, "server"));

for (const executable of ["powershell.exe", "pwsh.exe"]) {
  test(`${executable}: private downloads, dependencies, compatibility and fail-closed paths`, {
    skip: process.platform !== "win32" && "Private module storage requires Windows."
  }, t => {
    const probe = spawnSync(executable, ["-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion.ToString()"]);
    if (probe.error?.code === "ENOENT") return t.skip(`${executable} unavailable`);
    assert.equal(probe.status, 0, probe.stderr?.toString());
    const fixture = fs.mkdtempSync(path.join(root, ".private-modules-test-"));
    try {
      const result = spawnSync(executable, ["-NoProfile", "-NonInteractive", "-File",
        path.join(root, "scanner", "tests", "test-private-modules.ps1"), "-FixtureRoot", fixture], {
        cwd: root, env: powerShellEnvironment(executable, { TEMP: fixture, TMP: fixture }),
        encoding: "utf8", timeout: 60000
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /PRIVATE_MODULE_TEST_OK:/);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });
}

test("all module entry points share the private bootstrap and setup requires the packaged helper", () => {
  for (const filename of ["setup-ai-flight-deck.ps1", "server.js", "scanner/scan-tenant.ps1",
    "scanner/collect-admin-evidence.ps1", "scanner/collect-power-platform-evidence.ps1"]) {
    const source = fs.readFileSync(path.join(root, filename), "utf8");
    assert.match(source, /FlightDeck\.Modules\.ps1/, filename);
    assert.match(source, /Resolve-FdModule/, filename);
    assert.match(source, /Import-FdModule/, filename);
    assert.doesNotMatch(source, /\bInstall-Module\b/, filename);
  }
  const setup = fs.readFileSync(path.join(root, "setup-ai-flight-deck.ps1"), "utf8");
  assert.match(setup, /"scanner\\FlightDeck\.Modules\.ps1"/);
  const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert.match(server, /const installCommand = \[\s*"-NoProfile",\s*"-NonInteractive"/);
});
