"use strict";

// 2026-09-08: bcb8246 used nonexistent DAG ReportType values and omitted ReportEntity.
// Verify the actual producer AST against installed Microsoft command metadata without connecting.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..", "..");
const { powerShellEnvironment } = require(path.join(root, "server"));

test("SharePoint report invocations bind to installed Microsoft parameter sets and enums",
  { skip: process.platform !== "win32", timeout: 60000 }, t => {
    const executable = path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const script = `
      $ErrorActionPreference = 'Stop'
      if (-not (Get-Module -ListAvailable Microsoft.Online.SharePoint.PowerShell)) {
        [Console]::Out.WriteLine('SPO_CONTRACT_MODULE_ABSENT')
        exit 0
      }
      Import-Module Microsoft.Online.SharePoint.PowerShell -WarningAction SilentlyContinue
      $command = Get-Command Get-SPODataAccessGovernanceInsight
      $tokens = $null; $errors = $null
      $ast = [Management.Automation.Language.Parser]::ParseFile(
        (Join-Path (Get-Location) 'scanner\\collect-admin-evidence.ps1'), [ref]$tokens, [ref]$errors)
      if ($errors.Count) { throw 'Producer parse failed.' }
      $calls = @($ast.FindAll({
        param($node)
        $node -is [Management.Automation.Language.CommandAst] -and
          $node.GetCommandName() -eq 'Get-SPODataAccessGovernanceInsight'
      }, $true))
      if ($calls.Count -ne 2) { throw 'Expected exactly two existing report reads.' }
      foreach ($call in $calls) {
        $arguments = @{}
        for ($i = 1; $i -lt $call.CommandElements.Count; $i += 2) {
          $parameter = $call.CommandElements[$i]
          $value = $call.CommandElements[$i + 1]
          if ($parameter -isnot [Management.Automation.Language.CommandParameterAst] -or
              $value -isnot [Management.Automation.Language.StringConstantExpressionAst]) {
            throw 'Report arguments must remain explicit literals for contract validation.'
          }
          $name = $parameter.ParameterName
          if (-not $command.Parameters.ContainsKey($name)) { throw 'Unsupported report parameter.' }
          $null = [Management.Automation.LanguagePrimitives]::ConvertTo(
            $value.Value, $command.Parameters[$name].ParameterType)
          $arguments[$name] = $value.Value
        }
        $matching = @($command.ParameterSets | Where-Object {
          $set = $_
          $missing = @($set.Parameters | Where-Object { $_.IsMandatory -and -not $arguments.ContainsKey($_.Name) })
          $foreign = @($arguments.Keys | Where-Object { $_ -notin $set.Parameters.Name })
          $missing.Count -eq 0 -and $foreign.Count -eq 0
        })
        if (-not $matching.Count) { throw 'Missing mandatory argument or incompatible parameter set.' }
      }
      [Console]::Out.WriteLine('SPO_CONTRACT_VERIFIED:2')
    `;
    const result = spawnSync(executable, ["-NoProfile", "-NonInteractive", "-Command", script], {
      cwd: root, env: powerShellEnvironment(executable), encoding: "utf8", timeout: 45000
    });
    assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
    if (result.stdout.includes("SPO_CONTRACT_MODULE_ABSENT")) {
      t.skip("Microsoft SharePoint administration module is not installed.");
      return;
    }
    assert.match(result.stdout, /SPO_CONTRACT_VERIFIED:2/);
  });
