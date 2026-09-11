"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { GRAPH_SCOPE_LIST } = require("./server");

const root = __dirname;
const read = fileName => fs.readFileSync(path.join(root, fileName), "utf8");

test("guided setup includes every first-run prerequisite and launch step", () => {
  const launcher = read("SETUP-AI-Flight-Deck.cmd");
  const setup = read("setup-ai-flight-deck.ps1");
  const start = read("Start-AI-Flight-Deck.cmd");

  assert.match(launcher, /setup-ai-flight-deck\.ps1/i);
  assert.match(setup, /OpenJS\.NodeJS\.LTS/);
  assert.match(setup, /Microsoft\.Graph\.Authentication/);
  assert.match(setup, /enablement-playbook\.js/);
  assert.match(setup, /evidence-completion\.js/);
  assert.match(setup, /attestation-evidence\.js/);
  assert.match(setup, /collect-admin-evidence\.ps1/);
  assert.match(setup, /power-platform-evidence\.template\.v1\.json/);
  assert.match(setup, /scanner\\FlightDeck\.Modules\.ps1/);
  assert.match(setup, /Resolve-FdModule -Name Microsoft\.Graph\.Authentication -InstallMissingModules/);
  assert.match(read("scanner/FlightDeck.Modules.ps1"), /Install-PackageProvider -Name NuGet/);
  assert.match(setup, /Get-NetTCPConnection/);
  assert.match(setup, /AI Flight Deck\.lnk/);
  assert.match(setup, /Start-AI-Flight-Deck\.cmd/);
  assert.match(start, /SETUP-AI-Flight-Deck\.cmd/);
  assert.match(start, /Node\.js 18 or later/);
});

test("README credits Microsoft sources and lists every live delegated scope", () => {
  const readme = read("README.md");
  const acknowledgements = read("ACKNOWLEDGEMENTS.md");

  assert.match(readme, /Microsoft 365 Copilot Readiness report/);
  assert.match(readme, /m365-copilot-automated-readiness-assessment/);
  assert.match(readme, /What the prototype can already do/);
  assert.match(readme, /SETUP-AI-Flight-Deck\.cmd/);
  assert.match(acknowledgements, /independent hackathon prototype/i);

  for (const scope of GRAPH_SCOPE_LIST) {
    const displayName = scope.replace("https://graph.microsoft.com/", "");
    assert.ok(
      readme.includes(`\`${displayName}\``),
      `README must document delegated scope ${displayName}`
    );
  }
});

test("setup and recovery guidance never sends modules back to redirected Documents", () => {
  for (const filename of ["README.md", "docs/COLLECTOR-GUIDE.md", "index.html"]) {
    const source = read(filename);
    assert.match(source, /%LOCALAPPDATA%\\AI Flight Deck\\PowerShell\\Modules/, filename);
    assert.doesNotMatch(source, /Install-Module|Scope CurrentUser/, filename);
  }
  assert.match(read("index.html"), /class="command-block">\.\\SETUP-AI-Flight-Deck\.cmd</);
});

test("the user, connection and action guides are discoverable and their local file links resolve", () => {
  const readme = read("README.md");
  assert.match(readme, /docs\/COLLECTOR-GUIDE\.md/);
  assert.match(readme, /docs\/VISUAL-TOUR\.md/);
  assert.match(readme, /docs\/ACTION-WORKFLOW\.md/);
  for (const name of ["docs/COLLECTOR-GUIDE.md", "docs/VISUAL-TOUR.md", "docs/ACTION-WORKFLOW.md"]) {
    const content = read(name);
    for (const match of content.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = match[1];
      if (/^(?:https?:|mailto:|#)/.test(target)) continue;
      const relative = decodeURIComponent(target.split("#")[0]);
      assert.ok(fs.existsSync(path.resolve(root, path.dirname(name), relative)),
        `${name} has a broken relative link: ${target}`);
    }
  }
});
