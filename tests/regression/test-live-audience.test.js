"use strict";

// 2026-09-08: Live sharing scenarios referenced another function's local variable.
// Regression for the scope bug present in 90ed917; exercise real non-empty graphs.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..", "..");
const { buildEvidenceGraph } = require(path.join(root, "evidence-graph-builder"));
const graph = require(path.join(root, "evidence-graph"));
const { createEvidenceEnvelope } = require(path.join(root, "evidence-integrity"));

function loadRenderer() {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const start = html.indexOf("    function buildLiveScenarios(scan) {");
  const end = html.indexOf("    function renderFindings(", start);
  assert.ok(start >= 0 && end > start);
  return vm.runInNewContext(`${html.slice(start, end)}\nbuildLiveScenarios`, {
    window: { FlightDeckEvidenceGraph: graph },
    scanTenantId: scan => scan.tenant.tenantId,
    buildReadinessScenarios: () => []
  });
}

function fixture(enabledMemberUsers) {
  const scan = {
    tenant: { tenantId: "synthetic-tenant" },
    summary: { enabledMemberUsers, guests: 0, sitesScanned: 1 },
    estateAssessment: { cohorts: [{ id: "pilot" }] },
    integrity: { verifiedByLocalService: true },
    evidenceSets: {
      broadAccessSiteIds: ["site-via-public-group:group-a"],
      anonymousPermissionIds: [],
      organizationPermissionIds: ["item-sharing:drive-a:item-a:organization"]
    },
    evidenceDetails: {
      broadAccessSites: [{
        evidenceId: "site-via-public-group:group-a", siteResolved: true,
        siteId: "site-a", groupId: "group-a", displayName: "Synthetic public site"
      }],
      sharedItems: [{
        evidenceId: "item-sharing:drive-a:item-a:organization",
        itemEvidenceId: "item:drive-a:item-a", sharingScope: "organization",
        itemType: "File", displayName: "Synthetic shared file"
      }],
      permissionPaths: [{
        evidenceId: "permission:site-a:1", itemEvidenceId: "item:drive-a:item-b",
        accessType: "broad-identity-grant", itemType: "File",
        displayName: "Synthetic broad grant", principalCount: 1, roles: ["read"]
      }]
    }
  };
  scan.evidenceGraphEnvelope = createEvidenceEnvelope({
    tenant: scan.tenant.tenantId, producer: "synthetic-regression",
    generatedAt: new Date().toISOString(), payload: buildEvidenceGraph(scan),
    keyId: "synthetic-key", key: Buffer.alloc(32, 7)
  });
  return scan;
}

test("public sites, organization links and Everyone-style grants render the current scan audience", () => {
  const render = loadRenderer();
  for (const audience of [17, 61, 0]) {
    const scenarios = render(fixture(audience));
    assert.equal(scenarios.length, 3);
    for (const scenario of scenarios) {
      assert.match(scenario.exposure, new RegExp(`up to ${audience} enabled tenant members`));
      assert.doesNotMatch(scenario.exposure, /undefined|NaN/);
    }
    assert.ok(scenarios.some(s => s.exposure.includes("Everyone-style")));
  }
});

test("untrusted artifacts continue to use the readiness fallback", () => {
  const scan = fixture(17);
  scan.integrity.verifiedByLocalService = false;
  assert.equal(loadRenderer()(scan).length, 0);
});
