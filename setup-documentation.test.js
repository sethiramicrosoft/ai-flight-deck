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

test("README credits Microsoft sources and links the exact live delegated scope reference", () => {
  const readme = read("README.md");
  const permissions = read("docs/PERMISSIONS-AND-SECURITY.md");
  const acknowledgements = read("ACKNOWLEDGEMENTS.md");

  assert.match(readme, /Microsoft 365 Copilot Readiness report/);
  assert.match(readme, /m365-copilot-automated-readiness-assessment/);
  assert.match(readme, /What the prototype can already do/);
  assert.match(readme, /SETUP-AI-Flight-Deck\.cmd/);
  assert.match(readme, /docs\/PERMISSIONS-AND-SECURITY\.md/);
  assert.match(acknowledgements, /independent hackathon prototype/i);

  for (const scope of GRAPH_SCOPE_LIST) {
    const displayName = scope.replace("https://graph.microsoft.com/", "");
    assert.ok(
      permissions.includes(`\`${displayName}\``),
      `Permissions guide must document delegated scope ${displayName}`
    );
  }
});

test("setup and recovery guidance never sends modules back to redirected Documents", () => {
  for (const filename of [
    "docs/INSTALLATION.md", "docs/COLLECTOR-GUIDE.md",
    "docs/COLLECTION-REFERENCE.md", "docs/PERMISSIONS-AND-SECURITY.md", "index.html"
  ]) {
    const source = read(filename);
    assert.match(source, /%LOCALAPPDATA%\\AI Flight Deck\\PowerShell\\Modules/, filename);
    assert.doesNotMatch(source, /Install-Module|Scope CurrentUser/, filename);
  }
  assert.match(read("index.html"), /class="command-block">\.\\SETUP-AI-Flight-Deck\.cmd</);
});

const guides = [
  "VISUAL-TOUR.md", "COLLECTOR-GUIDE.md", "ACTION-WORKFLOW.md",
  "INSTALLATION.md", "PERMISSIONS-AND-SECURITY.md", "EVIDENCE-AND-VERIFICATION.md",
  "COLLECTION-REFERENCE.md", "ARCHITECTURE-AND-ROADMAP.md", "ASSESSMENT-COMPARISON.md"
];

function markdownFiles(directory) {
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const name = path.join(directory, entry.name);
    return entry.isDirectory() ? markdownFiles(name) : entry.name.endsWith(".md") ? [name] : [];
  });
}

function withoutFences(content) {
  return content.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, "");
}

function markdownAnchors(content) {
  const source = withoutFences(content);
  const anchors = new Set(Array.from(source.matchAll(/<a\b[^>]*\bid=["']([^"']+)["']/g), m => m[1]));
  const counts = new Map();
  for (const match of source.matchAll(/^#{1,6}\s+(.+?)(?:\s+#+)?\s*$/gm)) {
    const slug = match[1]
      .replace(/<[^>]*>/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
      .replace(/\s/g, "-");
    const count = counts.get(slug) || 0;
    counts.set(slug, count + 1);
    anchors.add(count ? `${slug}-${count}` : slug);
  }
  return anchors;
}

function localLinkErrors(name, content) {
  const errors = [];
  const source = withoutFences(content);
  const targets = [
    ...Array.from(source.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g), m => m[1]),
    ...Array.from(source.matchAll(/^\s{0,3}\[[^\]]+\]:\s*<?([^\s>]+)>?/gm), m => m[1]),
    ...Array.from(source.matchAll(/\b(?:href|src)=["']([^"']+)["']/g), m => m[1])
  ];
  for (const target of targets) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) continue;
    const [relative, fragment] = target.split("#");
    const destination = relative
      ? path.resolve(root, path.dirname(name), decodeURIComponent(relative))
      : path.resolve(root, name);
    if (!fs.existsSync(destination)) {
      errors.push(`${name}: missing file ${target}`);
    } else if (fragment && destination.endsWith(".md")) {
      const anchors = markdownAnchors(fs.readFileSync(destination, "utf8"));
      if (!anchors.has(decodeURIComponent(fragment))) errors.push(`${name}: missing anchor ${target}`);
    }
  }
  return errors;
}

test("all reader guides are discoverable and all local documentation links and anchors resolve", () => {
  const readme = read("README.md");
  for (const name of guides) {
    assert.ok(readme.includes(`docs/${name}`), `README must link ${name}`);
  }
  const files = ["README.md", "ACKNOWLEDGEMENTS.md", ...markdownFiles("docs")];
  assert.deepEqual(files.flatMap(name => localLinkErrors(name, read(name))), []);
});

test("documentation link validation detects broken files, fragments and ignores code examples", () => {
  assert.equal(localLinkErrors("README.md", "[bad](missing-documentation-file.md)").length, 1);
  assert.equal(localLinkErrors("README.md", "[bad](README.md#missing-documentation-anchor)").length, 1);
  assert.deepEqual(localLinkErrors("README.md", "[ok](#demo)"), []);
  assert.deepEqual(localLinkErrors("README.md", "```md\n[example](missing-file.md)\n```"), []);
  assert.deepEqual([...markdownAnchors("# Repeat\n## Repeat\n<a id=\"legacy\"></a>")],
    ["legacy", "repeat", "repeat-1"]);
});

test("README is a concise front door with the inline V11 demo after the rationale", () => {
  const readme = read("README.md");
  assert.ok(readme.trimEnd().split(/\r?\n/).length <= 200, "Keep detailed reference material in guides");
  const headings = [
    "# AI Flight Deck", "## Why AI Flight Deck?", "## Demo", "## How it works",
    "## What the prototype can already do", "## Know the boundaries", "## Try it", "## Guides"
  ];
  let previous = -1;
  for (const heading of headings) {
    const index = readme.indexOf(heading);
    assert.ok(index > previous, `${heading} must appear in reader order`);
    previous = index;
  }
  assert.match(readme, /Built for Microsoft 365 Copilot/);
  assert.match(readme, /<video controls src="https:\/\/github\.com\/user-attachments\/assets\/09df481b-4e0b-4d4b-8bb6-af571d2aecba"[^>]*><\/video>/);
  assert.match(readme, /docs\/demo\/AIFlightDeckDemoV11\.mp4/);
  assert.match(readme, /docs\/demo\/AIFlightDeckCaptionsV11\.srt/);
  assert.match(readme, /~114 seconds/);
  assert.match(readme, /synthetic data/);
  assert.match(readme, /Repository access is required while this repository is private/);
  assert.match(readme, /No live Microsoft sign-in or tenant changes are demonstrated/);
  assert.match(readme, /\.\\Start-AI-Flight-Deck\.cmd/);
  assert.match(readme, /Do not use a generic static server/);
});

test("README keeps evidence limits and non-operational boundaries visible", () => {
  const readme = read("README.md").replace(/\s+/g, " ");
  assert.match(readme, /77 application-defined controls across 13 domains/);
  assert.match(readme, /4 technical checks/);
  assert.match(readme, /11 owner-statement checks/);
  assert.match(readme, /62 unsupported verification checks/);
  assert.match(readme, /No automatic remediation, external task assignment, authenticated approval or continuous monitoring/);
  assert.match(readme, /Do not use this version to approve an estate-wide production rollout/);
  assert.match(readme, /not superior collection or greater authority/);
});

test("moved references retain contracts, setup, imports, source provenance and roadmap qualifications", () => {
  const evidence = read("docs/EVIDENCE-AND-VERIFICATION.md");
  for (const control of [
    "AFD-LIC-001", "AFD-LIC-002", "AFD-LIC-004", "AFD-IAM-003",
    "AFD-IAM-007", "AFD-DEV-005", "AFD-OPS-004", "AFD-OPS-005", "AFD-COPILOT-006",
    "AFD-PPA-005", "AFD-ADOPT-001", "AFD-ADOPT-002", "AFD-ADOPT-003", "AFD-ADOPT-004", "AFD-ADOPT-006"
  ]) assert.ok(evidence.includes(`| ${control} |`), `Preserve the ${control} contract`);
  for (const fact of [
    "prepaid minus consumed", "a62f8878-de10-42f3-b68f-6149a25ceb97",
    "population = evaluated", "excluded = 0", "five minutes", "source-bound observation receipt",
    "schema/evidence-authority.schema.v2.json", "schema/attestation-data-examples.v1.json",
    "MISSING_SOURCE_TIMESTAMP", "28-day", "Concealed", "Mixed",
    ".\\scanner\\test-live-tenant.ps1 -Phase Verification",
    ".\\scanner\\test-live-tenant.ps1 -Phase Compare",
    ".\\scanner\\test-live-tenant.ps1 -Phase Status"
  ]) assert.ok(evidence.includes(fact), `Preserve evidence detail: ${fact}`);

  const installation = read("docs/INSTALLATION.md");
  for (const fact of [
    "Windows 10 or Windows 11", "Node.js 18 or later", "SETUP-AI-Flight-Deck.cmd",
    "git clone", "git pull origin main", "Installation troubleshooting",
    "Interactive", "DeviceCode", "ExistingContext", "ManagedIdentity", "Certificate",
    "CertificateThumbprint", "test-config.json", "-WorkspacePath"
  ]) assert.ok(installation.includes(fact), `Preserve installation detail: ${fact}`);

  const runtime = read("docs/COLLECTION-REFERENCE.md");
  for (const fact of [
    "15-minute", "12 MB", "1.0.0", "1.1.0", "2.0.216", "50 environments",
    "2,000 rows", "500 explicit operations", "20 pages", "tenantVerified",
    "Get-HybridConfiguration", "32-byte", "InsufficientEvidence"
  ]) assert.ok(runtime.includes(fact), `Preserve collection detail: ${fact}`);

  const comparison = read("docs/ASSESSMENT-COMPARISON.md");
  assert.match(comparison, /f542406ffba2066d943643de8d7a87b755b98cab/);
  assert.match(comparison, /nine exact check names map to only three controls/);
  assert.match(comparison, /inferred trade-off, not a measured product result/);
  assert.match(comparison, /No new live source review was/);
  assert.match(comparison, /MIT/);
  const architecture = read("docs/ARCHITECTURE-AND-ROADMAP.md");
  assert.match(architecture, /not completed milestones/);
  assert.match(architecture, /not a description of a complete capability/);
  assert.match(architecture, /Not yet proven/);
});
