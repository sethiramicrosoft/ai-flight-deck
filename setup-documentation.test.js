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
  assert.match(setup, /Install-PackageProvider NuGet/);
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
  assert.match(readme, /What AI Flight Deck adds/);
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
