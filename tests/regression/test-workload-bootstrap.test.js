"use strict";

// 2026-09-08: 714e5df failed before sign-in because approved module dependencies
// overlapped Windows inbox commands and the bootstrap omitted AllowClobber.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..", "..");
const { powerShellEnvironment } = require(path.join(root, "server"));

test("Windows PowerShell gets native module discovery instead of inheriting PowerShell 7 paths", () => {
  const inherited = { PSModulePath: "synthetic-core-modules", PATH: "unchanged", FLIGHT_DECK_GRAPH_ACCESS_TOKEN: "synthetic-token" };
  const desktop = powerShellEnvironment("powershell.exe", {}, inherited);
  assert.equal(desktop.PSModulePath, undefined);
  assert.equal(desktop.PATH, "unchanged");
  assert.equal(desktop.FLIGHT_DECK_GRAPH_ACCESS_TOKEN, undefined);
  assert.equal(powerShellEnvironment("pwsh.exe", {}, inherited).PSModulePath, "synthetic-core-modules");
  assert.equal(inherited.PSModulePath, "synthetic-core-modules");
  assert.equal(powerShellEnvironment("powershell.exe", { FLIGHT_DECK_GRAPH_ACCESS_TOKEN: "explicit-synthetic-token" }, inherited)
    .FLIGHT_DECK_GRAPH_ACCESS_TOKEN, "explicit-synthetic-token");
});

test("private downloads avoid dependency command collisions without changing repository trust", () => {
  const source = fs.readFileSync(path.join(root, "scanner", "FlightDeck.Modules.ps1"), "utf8");
  const parameters = source.match(/\$saveParameters\s*=\s*@\{([^}]+)\}/);
  assert.ok(parameters);
  assert.match(parameters[1], /Path\s*=\s*\$root/);
  assert.match(parameters[1], /Repository\s*=\s*'PSGallery'/);
  assert.match(source, /Save-Module @saveParameters/);
  assert.doesNotMatch(parameters[1], /Scope|AllowClobber/);
  assert.doesNotMatch(source, /Set-PSRepository|Set-ExecutionPolicy/);
  const harness = fs.readFileSync(path.join(root, "scanner", "admin-collector-test-harness.ps1"), "utf8");
  assert.match(harness, /function global:Install-Module \{ throw/);
});
