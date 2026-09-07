"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildEvidenceGraph } = require("./evidence-graph-builder");
const { simulateEvidenceGraph } = require("./evidence-graph");

function scan(overrides = {}) {
  return {
    tenant: { tenantId: "tenant-a" },
    estateAssessment: { cohorts: [{ id: "pilot" }] },
    evidenceSets: {
      broadAccessSiteIds: [
        "site-via-public-group:group-b",
        "site-via-public-group:group-a"
      ],
      anonymousPermissionIds: [],
      organizationPermissionIds: []
    },
    evidenceDetails: {
      broadAccessSites: [
        {
          evidenceId: "site-via-public-group:group-a",
          displayName: "All Company",
          resourceType: "SharePoint site",
          siteResolved: true,
          siteId: "site-a",
          groupId: "group-a"
        },
        {
          evidenceId: "site-via-public-group:group-b",
          displayName: "Marketing",
          resourceType: "SharePoint site",
          siteResolved: true,
          siteId: "site-b",
          groupId: "group-b"
        }
      ]
    },
    ...overrides
  };
}

test("builds deterministic minimized paths from observed public SharePoint sites", () => {
  const graph = buildEvidenceGraph(scan());
  assert.equal(graph.minimized, true);
  assert.equal(graph.tenantId, "tenant-a");
  assert.equal(graph.nodes.filter(node => node.type === "Resource").length, 2);
  assert.equal(graph.nodes.some(node => node.attributes.displayName === "All Company"), true);
  const resource = graph.nodes.find(node => node.type === "Resource");
  assert.equal(resource.attributes.resourceType, "SharePoint site");
  assert.equal(resource.attributes.accessBasis, "Public Microsoft 365 group");
  assert.equal(
    graph.nodes.find(node => node.type === "Membership").attributes.accessScope,
    "tenant-wide-potential"
  );

  const result = simulateEvidenceGraph({
    ...graph,
    signature: {
      algorithm: "HMAC-SHA256",
      keyId: "test-key",
      value: "test-signature"
    }
  }, {
    tenantId: "tenant-a",
    cohortId: "pilot",
    sensitiveLevels: ["internal"]
  });
  assert.equal(result.sensitiveMatches.length, 2);
  assert.deepEqual(result.affectedAudience, ["principal:tenant-users"]);
  assert.equal(result.confidenceLevel, "Medium");
});

test("returns a valid empty graph when no supported sharing path was observed", () => {
  const graph = buildEvidenceGraph(scan({
    evidenceSets: {
      broadAccessSiteIds: [],
      anonymousPermissionIds: [],
      organizationPermissionIds: []
    },
    evidenceDetails: { broadAccessSites: [], sharedItems: [] }
  }));
  assert.deepEqual(graph.nodes, []);
  assert.deepEqual(graph.edges, []);
});

test("does not promote unresolved public groups to SharePoint sites", () => {
  const graph = buildEvidenceGraph(scan({
    evidenceSets: {
      broadAccessSiteIds: ["site-via-public-group:group-unresolved"],
      anonymousPermissionIds: [],
      organizationPermissionIds: []
    },
    evidenceDetails: {
      broadAccessSites: [{
        evidenceId: "site-via-public-group:group-unresolved",
        displayName: "Unresolved public group",
        resourceType: "Microsoft 365 group",
        siteResolved: false,
        groupId: "group-unresolved"
      }],
      sharedItems: []
    }
  }));
  const resource = graph.nodes.find(node => node.type === "Resource");
  assert.equal(resource.attributes.resourceType, "Microsoft 365 group");
  assert.equal(resource.attributes.scenarioType, "public-group-unresolved");
  assert.equal(resource.attributes.siteResolved, false);
});

test("builds distinct anonymous and organization-wide SharePoint item paths", () => {
  const graph = buildEvidenceGraph(scan({
    evidenceSets: {
      broadAccessSiteIds: [],
      anonymousPermissionIds: ["item-sharing:drive-a:item-a:anonymous"],
      organizationPermissionIds: ["item-sharing:drive-b:item-b:organization"]
    },
    evidenceDetails: {
      broadAccessSites: [],
      sharedItems: [
        {
          evidenceId: "item-sharing:drive-a:item-a:anonymous",
          itemEvidenceId: "item:drive-a:item-a",
          sharingScope: "anonymous",
          itemType: "File",
          displayName: "Board plan.docx",
          siteDisplayName: "Leadership",
          driveDisplayName: "Documents"
        },
        {
          evidenceId: "item-sharing:drive-b:item-b:organization",
          itemEvidenceId: "item:drive-b:item-b",
          sharingScope: "organization",
          itemType: "Folder",
          displayName: "Launch assets",
          siteDisplayName: "Marketing",
          driveDisplayName: "Shared Documents"
        }
      ]
    }
  }));

  const resources = graph.nodes.filter(node => node.type === "Resource");
  assert.equal(resources.length, 2);
  assert.deepEqual(
    resources.map(node => node.attributes.scenarioType).sort(),
    ["anonymous-link", "organization-link"]
  );
  assert.equal(
    graph.nodes.some(node =>
      node.type === "Principal" &&
      node.attributes.displayName === "Anyone with the link"),
    true
  );

  const result = simulateEvidenceGraph({
    ...graph,
    signature: {
      algorithm: "HMAC-SHA256",
      keyId: "test-key",
      value: "test-signature"
    }
  }, {
    tenantId: "tenant-a",
    cohortId: "pilot",
    sensitiveLevels: ["internal"]
  });
  assert.equal(result.sensitiveMatches.length, 2);
  assert.deepEqual(
    result.affectedAudience,
    ["principal:anyone-with-link", "principal:tenant-users"]
  );
});

test("builds direct, guest, group, application, and inherited permission paths", () => {
  const accessTypes = [
    "specific-people-link",
    "broad-identity-grant",
    "guest-direct-grant",
    "group-direct-grant",
    "user-direct-grant",
    "application-grant",
    "inherited-permission"
  ];
  const graph = buildEvidenceGraph(scan({
    evidenceSets: {
      broadAccessSiteIds: [],
      anonymousPermissionIds: [],
      organizationPermissionIds: []
    },
    evidenceDetails: {
      broadAccessSites: [],
      sharedItems: [],
      permissionPaths: accessTypes.map((accessType, index) => ({
        evidenceId: `permission:site-a:${index + 1}`,
        itemEvidenceId: `item:drive-a:${index + 1}`,
        accessType,
        itemType: index % 2 ? "Folder" : "File",
        displayName: `Resource ${index + 1}`,
        siteDisplayName: "Operations",
        driveDisplayName: "Documents",
        principalCount: index + 1,
        guestPrincipalCount: accessType === "guest-direct-grant" ? 1 : 0,
        roles: ["read"],
        inherited: accessType === "inherited-permission"
      }))
    }
  }));

  assert.deepEqual(
    graph.nodes
      .filter(node => node.type === "Resource")
      .map(node => node.attributes.scenarioType)
      .sort(),
    [...accessTypes].sort()
  );
  assert.equal(
    graph.nodes.filter(node => node.type === "Policy").length,
    accessTypes.length
  );
});

test("excludes expired permission paths from active reachability", () => {
  const graph = buildEvidenceGraph(scan({
    generatedAt: "2026-09-07T00:00:00Z",
    evidenceSets: {
      broadAccessSiteIds: [],
      anonymousPermissionIds: [],
      organizationPermissionIds: []
    },
    evidenceDetails: {
      broadAccessSites: [],
      sharedItems: [],
      permissionPaths: [{
        evidenceId: "permission:expired",
        accessType: "specific-people-link",
        displayName: "Expired link",
        expirationDateTime: "2026-09-06T00:00:00Z"
      }]
    }
  }));
  assert.deepEqual(graph.nodes, []);
  assert.deepEqual(graph.edges, []);
});

test("requires a tenant-bound scan", () => {
  assert.throws(() => buildEvidenceGraph({}), /tenant-bound scan/);
});
