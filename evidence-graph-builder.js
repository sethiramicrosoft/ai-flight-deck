"use strict";

const crypto = require("node:crypto");

function requiredTenantId(scan) {
  const tenantId = scan?.tenant?.tenantId || scan?.tenant?.id;
  if (typeof tenantId !== "string" || !tenantId.trim()) {
    throw new TypeError("A tenant-bound scan is required to build an evidence graph.");
  }
  return tenantId.trim();
}

function stableId(prefix, value) {
  const digest = crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 20);
  return `${prefix}:${digest}`;
}

function buildEvidenceGraph(scan) {
  const tenantId = requiredTenantId(scan);
  const cohortId = scan.estateAssessment?.cohorts?.[0]?.id || "tenant-wide";
  const publicSiteDetails = Array.isArray(scan.evidenceDetails?.broadAccessSites)
    ? scan.evidenceDetails.broadAccessSites
    : [];
  const sharedItemDetails = Array.isArray(scan.evidenceDetails?.sharedItems)
    ? scan.evidenceDetails.sharedItems
    : [];
  const permissionPathDetails = Array.isArray(scan.evidenceDetails?.permissionPaths)
    ? scan.evidenceDetails.permissionPaths
    : [];
  const observedAt = Date.parse(scan.generatedAt || "") || Date.now();
  const activePermissionPathDetails = permissionPathDetails.filter(item =>
    !item?.expirationDateTime || Date.parse(item.expirationDateTime) > observedAt);
  const publicSiteIds = Array.isArray(scan.evidenceSets?.broadAccessSiteIds)
    ? scan.evidenceSets.broadAccessSiteIds
    : [];
  const anonymousPermissionIds = Array.isArray(scan.evidenceSets?.anonymousPermissionIds)
    ? scan.evidenceSets.anonymousPermissionIds
    : [];
  const organizationPermissionIds = Array.isArray(scan.evidenceSets?.organizationPermissionIds)
    ? scan.evidenceSets.organizationPermissionIds
    : [];
  const publicSiteDetailsById = new Map(
    publicSiteDetails.filter(item => item?.evidenceId).map(item => [item.evidenceId, item])
  );
  const sharedItemDetailsById = new Map(
    [...sharedItemDetails, ...activePermissionPathDetails]
      .filter(item => item?.evidenceId)
      .map(item => [item.evidenceId, item])
  );
  const publicEvidenceIds = [...new Set([
    ...publicSiteIds,
    ...publicSiteDetails.map(item => item?.evidenceId)
  ].filter(Boolean))].sort();
  const anonymousEvidenceIds = [...new Set([
    ...anonymousPermissionIds,
    ...sharedItemDetails
      .filter(item => item?.sharingScope === "anonymous")
      .map(item => item.evidenceId),
    ...activePermissionPathDetails
      .filter(item => item?.accessType === "anonymous-link")
      .map(item => item.evidenceId)
  ].filter(Boolean))].sort();
  const organizationEvidenceIds = [...new Set([
    ...organizationPermissionIds,
    ...sharedItemDetails
      .filter(item => item?.sharingScope === "organization")
      .map(item => item.evidenceId),
    ...activePermissionPathDetails
      .filter(item => item?.accessType === "organization-link")
      .map(item => item.evidenceId)
  ].filter(Boolean))].sort();
  const nodes = new Map();
  const edges = new Map();

  function addNode(id, type, attributes = {}) {
    if (!nodes.has(id)) {
      nodes.set(id, {
        id,
        type,
        tenantId,
        cohortIds: [cohortId],
        attributes
      });
    }
  }

  function addEdge(from, to) {
    edges.set(`${from}>${to}`, { from, to });
  }

  function addReviewPath({
    evidenceId,
    detail,
    principalId,
    principalName,
    principalConfidence,
    membershipId,
    membershipName,
    membershipConfidence,
    membershipAttributes = {},
    surfaceId,
    surfaceName,
    surfaceConfidence,
    policyId,
    policyControlId,
    policyName,
    resourceAttributes,
    signalAttributes
  }) {
    addNode(principalId, "Principal", {
      active: true,
      confidence: principalConfidence,
      displayName: principalName
    });
    addNode(membershipId, "Membership", {
      confidence: membershipConfidence,
      displayName: membershipName,
      ...membershipAttributes
    });
    addNode(surfaceId, "AISurface", {
      enabled: true,
      confidence: surfaceConfidence,
      displayName: surfaceName,
      evidenceStatus: "Potential",
      reviewOnly: true
    });
    addNode(policyId, "Policy", {
      controlId: policyControlId,
      effect: "audit",
      enabled: true,
      confidence: 0.9,
      displayName: policyName
    });

    const resourceId = stableId("resource", evidenceId);
    const signalId = stableId("signal", evidenceId);
    addNode(resourceId, "Resource", {
      confidence: 0.9,
      evidenceId,
      ...resourceAttributes
    });
    addNode(signalId, "ContentSignal", {
      sensitivity: "internal",
      matched: true,
      confidence: 0.55,
      evidenceId,
      classificationObserved: false,
      reviewOnly: true,
      ...signalAttributes
    });
    addEdge(principalId, membershipId);
    addEdge(membershipId, resourceId);
    addEdge(resourceId, signalId);
    addEdge(signalId, surfaceId);
    addEdge(surfaceId, policyId);
  }

  for (const evidenceId of publicEvidenceIds) {
    const detail = publicSiteDetailsById.get(evidenceId) || {};
    addReviewPath({
      evidenceId,
      detail,
      principalId: "principal:tenant-users",
      principalName: "Inventoried tenant users",
      principalConfidence: 0.9,
      membershipId: "membership:public-m365-group",
      membershipName: "Public Microsoft 365 group access",
      membershipConfidence: 0.9,
      membershipAttributes: { accessScope: "tenant-wide-potential" },
      surfaceId: "surface:m365-copilot-public-site",
      surfaceName: "Potential Microsoft 365 Copilot grounding",
      surfaceConfidence: 0.65,
      policyId: "policy:public-sharepoint-site-review",
      policyControlId: "AFD-SP-BROAD-001",
      policyName: "Public SharePoint site owner validation required",
      resourceAttributes: {
        displayName: detail.displayName || "Public SharePoint site",
        resourceType: detail.resourceType || (detail.siteResolved === true ? "SharePoint site" : "Microsoft 365 group"),
        scenarioType: detail.siteResolved === true ? "public-site" : "public-group-unresolved",
        sharingScope: "tenant",
        accessBasis: "Public Microsoft 365 group",
        siteResolved: detail.siteResolved === true,
        siteId: detail.siteId || null,
        groupId: detail.groupId || null,
        groupDisplayName: detail.groupDisplayName || detail.displayName || null,
        reason: detail.reason || "The connected Microsoft 365 group is public.",
        recommendedAction: detail.recommendedAction ||
          "Confirm that public visibility is intentional; otherwise make the group private and rescan."
      },
      signalAttributes: {
        displayName: "Unclassified content within a public SharePoint site",
        evidenceBasis: "Public-site sharing metadata only; document content was not retrieved."
      }
    });
  }

  for (const [sharingScope, evidenceIds] of [
    ["anonymous", anonymousEvidenceIds],
    ["organization", organizationEvidenceIds]
  ]) {
    for (const evidenceId of evidenceIds) {
      const detail = sharedItemDetailsById.get(evidenceId) || {};
      const anonymous = sharingScope === "anonymous";
      const itemType = detail.itemType || "SharePoint item";
      const displayName = detail.displayName ||
        `${anonymous ? "Anonymous" : "Organization-wide"} shared SharePoint item`;
      addReviewPath({
        evidenceId,
        detail,
        principalId: anonymous ? "principal:anyone-with-link" : "principal:tenant-users",
        principalName: anonymous ? "Anyone with the link" : "Inventoried tenant users",
        principalConfidence: anonymous ? 1 : 0.9,
        membershipId: anonymous
          ? "membership:anonymous-sharing-link"
          : "membership:organization-sharing-link",
        membershipName: anonymous
          ? "Anonymous Anyone sharing link"
          : "Organization-wide sharing link",
        membershipConfidence: 0.95,
        membershipAttributes: {
          accessScope: anonymous ? "unbounded-link-audience" : "tenant-wide-link-audience"
        },
        surfaceId: anonymous
          ? "surface:sharepoint-anonymous-link"
          : "surface:m365-copilot-organization-link",
        surfaceName: anonymous
          ? "SharePoint anonymous-link exposure"
          : "Potential Microsoft 365 Copilot access after organization-link use",
        surfaceConfidence: anonymous ? 0.95 : 0.55,
        policyId: anonymous
          ? "policy:anonymous-sharepoint-link-review"
          : "policy:organization-sharepoint-link-review",
        policyControlId: anonymous ? "AFD-SP-ANONYMOUS-001" : "AFD-SP-ORGANIZATION-001",
        policyName: anonymous
          ? "Anonymous SharePoint link removal or approval required"
          : "Organization-wide SharePoint link validation required",
        resourceAttributes: {
          displayName,
          resourceType: itemType,
          scenarioType: anonymous ? "anonymous-link" : "organization-link",
          sharingScope,
          accessBasis: anonymous ? "Anyone sharing link" : "Organization-wide sharing link",
          itemEvidenceId: detail.itemEvidenceId || null,
          siteId: detail.siteId || null,
          driveId: detail.driveId || null,
          itemId: detail.itemId || null,
          siteDisplayName: detail.siteDisplayName || "SharePoint site not recorded by the earlier scan",
          driveDisplayName: detail.driveDisplayName || "Document library not recorded by the earlier scan",
          reason: detail.reason || `${anonymous ? "Anonymous" : "Organization-wide"} link access was observed.`,
          recommendedAction: detail.recommendedAction || (anonymous
            ? "Remove the Anyone link unless unauthenticated access is explicitly required, then rescan."
            : "Replace broad link access with specific people or group access when it is unnecessary, then rescan.")
        },
        signalAttributes: {
          displayName: `Content in this SharePoint ${itemType.toLowerCase()} was not inspected`,
          evidenceBasis: "Sharing-scope metadata only; document content was not retrieved."
        }
      });
    }
  }

  const permissionPathLabels = {
    "specific-people-link": {
      principal: "Named link recipients",
      membership: "Specific-people sharing link",
      surface: "Potential Microsoft 365 Copilot access after named-link use",
      policy: "Specific-people link validation required"
    },
    "broad-identity-grant": {
      principal: "Broad tenant identity principal",
      membership: "Everyone-style SharePoint permission",
      surface: "Potential Microsoft 365 Copilot grounding through broad identity access",
      policy: "Broad SharePoint identity permission validation required"
    },
    "guest-direct-grant": {
      principal: "Observed guest principals",
      membership: "Direct guest permission",
      surface: "Potential guest access to SharePoint content",
      policy: "Guest SharePoint access validation required"
    },
    "group-direct-grant": {
      principal: "Observed SharePoint group principals",
      membership: "Direct group permission",
      surface: "Potential Microsoft 365 Copilot grounding through group access",
      policy: "Group membership and access validation required"
    },
    "user-direct-grant": {
      principal: "Observed directly granted users",
      membership: "Direct user permission",
      surface: "Potential Microsoft 365 Copilot grounding through direct access",
      policy: "Direct user access validation required"
    },
    "application-grant": {
      principal: "Observed application or agent principals",
      membership: "Direct application permission",
      surface: "Potential application or agent access to SharePoint content",
      policy: "Application and agent access validation required"
    },
    "inherited-permission": {
      principal: "Inherited permission principals",
      membership: "Inherited SharePoint permission",
      surface: "Potential Microsoft 365 Copilot grounding through inherited access",
      policy: "Inherited access validation required"
    },
    "unclassified-permission": {
      principal: "Unclassified permission principals",
      membership: "SharePoint permission requiring classification",
      surface: "Potential SharePoint access path",
      policy: "Permission classification and validation required"
    }
  };

  for (const detail of activePermissionPathDetails
    .filter(item =>
      item?.evidenceId &&
      !["anonymous-link", "organization-link"].includes(item.accessType))
    .sort((left, right) => String(left.evidenceId).localeCompare(String(right.evidenceId)))) {
    const accessType = permissionPathLabels[detail.accessType]
      ? detail.accessType
      : "unclassified-permission";
    const labels = permissionPathLabels[accessType];
    const evidenceId = detail.evidenceId;
    const principalRefs = Array.isArray(detail.principalRefs) && detail.principalRefs.length
      ? [...new Set(detail.principalRefs)].sort()
      : [evidenceId];
    for (const principalRef of principalRefs) {
      addReviewPath({
        evidenceId,
        detail,
        principalId: stableId("principal", principalRef),
        principalName: labels.principal,
        principalConfidence: 0.75,
        membershipId: stableId("membership", evidenceId),
        membershipName: labels.membership,
        membershipConfidence: 0.8,
        membershipAttributes: {
          accessScope: accessType,
          inherited: detail.inherited === true
        },
        surfaceId: stableId("surface", accessType),
        surfaceName: labels.surface,
        surfaceConfidence: 0.6,
        policyId: stableId("policy", accessType),
        policyControlId: "AFD-SPO-002",
        policyName: labels.policy,
        resourceAttributes: {
          displayName: detail.displayName || "Shared SharePoint item",
          resourceType: detail.itemType || "SharePoint item",
          scenarioType: accessType,
          sharingScope: detail.linkScope || "direct",
          accessBasis: labels.membership,
          itemEvidenceId: detail.itemEvidenceId || null,
          siteId: detail.siteId || null,
          driveId: detail.driveId || null,
          itemId: detail.itemId || null,
          siteDisplayName: detail.siteDisplayName || "SharePoint site not recorded",
          driveDisplayName: detail.driveDisplayName || "Document library not recorded",
          principalCount: Number.isInteger(detail.principalCount) ? detail.principalCount : principalRefs.length,
          principalNames: Array.isArray(detail.principalNames) ? detail.principalNames.slice(0, 20) : [],
          guestPrincipalCount: Number.isInteger(detail.guestPrincipalCount) ? detail.guestPrincipalCount : 0,
          roles: Array.isArray(detail.roles) ? detail.roles : [],
          inherited: detail.inherited === true,
          inheritedFrom: detail.inheritedFrom || null,
          expirationDateTime: detail.expirationDateTime || null,
          reason: `${labels.membership} was observed on this sampled SharePoint item.`,
          recommendedAction: "Confirm the principal, business need, role, inheritance, and expiry. Remove or narrow access that is no longer required, then rescan."
        },
        signalAttributes: {
          displayName: `Content in this SharePoint ${String(detail.itemType || "item").toLowerCase()} was not inspected`,
          evidenceBasis: "Permission metadata only; document content and nested group membership were not retrieved."
        }
      });
    }
  }

  return {
    version: 1,
    minimized: true,
    tenantId,
    nodes: [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id)),
    edges: [...edges.values()].sort((left, right) =>
      left.from.localeCompare(right.from) || left.to.localeCompare(right.to))
  };
}

module.exports = { buildEvidenceGraph };
