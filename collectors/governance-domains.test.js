"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { CollectorRegistry } = require("../collector-runtime");
const catalog = require("../schema/readiness-catalog.v1.json");
const {
  CAPABILITIES,
  createExchangeOnlineCollector,
  createGovernanceDomainCollectors,
  createPurviewComplianceCollector,
  createSecurityPostureCollector,
  createSharePointOneDriveCollector,
  normalizeExchange,
  normalizePurview,
  normalizeSecurity,
  normalizeSharePoint
} = require("./governance-domains");

const context = {
  tenantId: "11111111-1111-1111-1111-111111111111",
  actorId: "reader@example.test",
  collectorRunId: "governance-run",
  observedAt: "2026-09-04T10:00:00.000Z",
  cohort: { id: "pilot", approved: true, principalIds: ["user-1"] }
};

function available(items = [], data) {
  return { available: true, complete: true, source: "offline fixture", items, data };
}

test("exports one runtime-compatible collector and exact capability per catalogue control", () => {
  const collectors = createGovernanceDomainCollectors({});
  assert.equal(collectors.length, 4);
  for (const collector of collectors) {
    const domain = catalog.domains.find(item => item.id === collector.domainIds[0]);
    assert.deepEqual(collector.controlIds, domain.controls.map(control => control.id));
    assert.deepEqual(CAPABILITIES[domain.id].map(item => item.controlId), collector.controlIds);
    assert.equal(CAPABILITIES[domain.id].every(item =>
      item.permissions.length && item.licenses.length && item.operations.length), true);
    assert.equal(typeof collector.collect, "function");
    assert.equal(typeof collector.normalize, "function");
    assert.equal(typeof collector.health, "function");
  }
});

test("all query plans are read-only and run through injected adapters", async () => {
  const graphCalls = [];
  const commandCalls = [];
  const graphRequest = async request => {
    graphCalls.push(request);
    return request.url.includes("/admin/sharepoint/settings")
      ? { sharingCapability: "Disabled", oneDriveSharingCapability: "Disabled" }
      : { value: [] };
  };
  const adminCommand = async request => {
    commandCalls.push(request);
    return [];
  };
  const registry = new CollectorRegistry();
  createGovernanceDomainCollectors({ graphRequest, adminCommand }).forEach(item => registry.register(item));
  const results = await registry.run({ context, maxConcurrency: 4 });
  assert.equal(results.every(item => item.status === "Completed"), true);
  assert.equal(results.reduce((sum, item) => sum + item.controlResults.length, 0), 25);
  assert.equal(graphCalls.every(call => call.method === "GET"), true);
  assert.equal(commandCalls.every(call => !/set-|new-|remove-|add-|enable-|disable-/i.test(call.command)), true);
  assert.equal(commandCalls.every(call => call.signal), true);
  const reports = commandCalls.filter(call => call.command === "Get-SPODataAccessGovernanceInsight");
  assert.deepEqual(reports.map(call => ({ key: call.evidenceKey, parameters: call.parameters })), [
    { key: "siteAccessReport",
      parameters: { ReportEntity: "PermissionsReport", ReportType: "Snapshot", Workload: "SharePoint" } },
    { key: "dataAccessGovernance",
      parameters: { ReportEntity: "EveryoneExceptExternalUsersForItems", ReportType: "RecentActivity", Workload: "SharePoint" } }
  ]);
});

test("Exchange maps all controls and passes only complete qualifying evidence", () => {
  const observations = {
    mailboxes: available([{
      ExternalDirectoryObjectId: "user-1",
      PrimarySmtpAddress: "user-1@example.test",
      RecipientTypeDetails: "UserMailbox"
    }]),
    hybridConfiguration: available([{}]),
    organizationRelationships: available([{}]),
    remoteDomains: available([{}]),
    mailboxPermissions: available([]),
    recipientPermissions: available([]),
    directoryUsers: available([{ id: "user-1", accountEnabled: true }]),
    outlookInventory: available([{ id: "user-1", supported: true }]),
    transportRules: available([{ Identity: "rule-1", State: "Enabled", description: "normal routing" }]),
    messageTrace: available([{ id: "trace-1", Status: "Delivered" }])
  };
  const results = normalizeExchange({
    observations,
    context: {
      ...context,
      hybridValidation: {
        validatedAt: "2026-09-03T10:00:00.000Z",
        mailFlow: true,
        freeBusy: true
      },
      outlookClientReadiness: {
        approvedBy: "messaging-lead",
        validatedAt: "2026-09-03T10:00:00.000Z",
        supported: 1,
        total: 1,
        unsupportedPrincipalIds: []
      }
    }
  });
  assert.deepEqual(results.map(item => item.controlId),
    ["AFD-EXO-001", "AFD-EXO-002", "AFD-EXO-003", "AFD-EXO-004", "AFD-EXO-005"]);
  assert.equal(results.every(item => item.status === "Pass"), true);
});

test("Exchange missing role, command, and validation evidence remain precise Unknown", () => {
  const missing = {
    available: false,
    complete: false,
    source: "Exchange Online",
    error: { code: "MISSING_PERMISSION_OR_ROLE", message: "Exchange Administrator role is required." }
  };
  const observations = Object.fromEntries([
    "mailboxes", "hybridConfiguration", "organizationRelationships", "remoteDomains",
    "mailboxPermissions", "recipientPermissions", "directoryUsers", "outlookInventory",
    "transportRules", "messageTrace"
  ].map(key => [key, missing]));
  const results = normalizeExchange({ observations, context });
  assert.equal(results.every(item => item.status === "Unknown"), true);
  assert.equal(results.every(item =>
    item.limitations.some(limit => limit.code === "MISSING_PERMISSION_OR_ROLE")), true);
});

test("partial Outlook inventory cannot pass without owner-attested per-user coverage", () => {
  const observations = {
    outlookInventory: available([{ id: "Microsoft Outlook", version: "16.0" }])
  };
  const result = normalizeExchange({ observations, context })
    .find(item => item.controlId === "AFD-EXO-004");
  assert.equal(result.status, "Unknown");
  assert.equal(result.limitations[0].code, "EVIDENCE_SHAPE_UNSUPPORTED");
});

test("SharePoint maps tenant, site, SAM, restricted search, lifecycle, and OneDrive evidence", () => {
  const observations = {
    tenantSettings: available([], {
      sharingCapability: "ExternalUserSharingOnly",
      oneDriveSharingCapability: "ExternalUserSharingOnly",
      defaultSharingLinkType: "Direct",
      defaultLinkPermission: "View"
    }),
    sites: available([{ id: "site-1", owner: "owner", inactivityPolicy: "policy" }]),
    siteAccessReport: available([{
      id: "site-1",
      accessRequestApprover: "approver",
      sharingWithinTenantPosture: true
    }]),
    dataAccessGovernance: available([{
      id: "report-1",
      generatedAt: "2026-09-03T10:00:00.000Z",
      hotspots: [{ id: "site-1", owner: "owner", remediationPlan: "plan" }]
    }]),
    restrictedContent: available([{ id: "site-1", enabled: true, excludedFromCopilot: true }]),
    restrictedSearchMode: available([], { enabled: true }),
    restrictedSearchAllowedList: available([{ id: "site-1" }]),
    siteLifecycle: available([{ id: "site-1", owner: "owner", inactivityPolicy: "policy" }]),
    oneDriveOverrides: available([])
  };
  const results = normalizeSharePoint({
    observations,
    context: {
      ...context,
      sharePointPosture: { maximumSharingCapability: "ExternalUserSharingOnly" },
      inScopeSiteIds: ["site-1"],
      restrictedResourceIds: ["site-1"],
      restrictedSearchExpectedSiteIds: ["site-1"],
      oneDrivePosture: { defaultLinkType: "Direct", defaultLinkPermission: "View" }
    }
  });
  assert.equal(results.length, 7);
  assert.equal(results.every(item => item.status === "Pass"), true);
});

test("SharePoint pagination bounds produce Unknown rather than Pass", async () => {
  let page = 0;
  const collector = createSharePointOneDriveCollector({
    limits: { maxPages: 1, maxItems: 10 },
    graphRequest: async request => {
      if (request.url.includes("/admin/sharepoint/settings")) return {};
      page++;
      return { value: [{ id: `site-${page}` }], "@odata.nextLink": "next" };
    },
    adminCommand: async () => []
  });
  const registry = new CollectorRegistry();
  registry.register(collector);
  const [run] = await registry.run({ context });
  assert.equal(run.status, "Completed");
  assert.equal(run.controlResults.find(item => item.controlId === "AFD-SPO-002").status, "Unknown");
  assert.equal(run.controlResults.find(item => item.controlId === "AFD-SPO-002").limitations
    .some(item => item.code === "COLLECTION_BOUND_REACHED"), true);
});

test("Purview maps all labels, DLP, audit, retention, eDiscovery, and monitoring controls", () => {
  const observations = {
    sensitivityLabels: available([
      { id: "public", displayName: "Public", description: "Use for public data" },
      { id: "general", displayName: "General", description: "Use for general data" },
      { id: "confidential", displayName: "Confidential", description: "Use for confidential data" },
      { id: "high", displayName: "Highly Confidential", description: "Use for restricted data" }
    ]),
    labelPolicies: available([{ Labels: ["public", "general", "confidential", "high"] }]),
    autoLabelPolicies: available([{ id: "auto", Mode: "Enabled", owner: "owner" }]),
    autoLabelReport: available([], { coverage: 0.9 }),
    dlpPolicies: available([{
      id: "dlp",
      Mode: "Enabled",
      owner: "owner",
      locations: ["Exchange", "SharePoint", "OneDrive", "Teams", "Copilot"]
    }]),
    dlpRules: available([{}]),
    auditConfiguration: available([], { UnifiedAuditLogIngestionEnabled: true }),
    copilotAuditRecords: available([{ id: "audit", CreationDate: "2026-09-04T09:00:00.000Z" }]),
    retentionPolicies: available([{
      id: "retention",
      Enabled: true,
      owner: "owner",
      locations: ["Exchange", "SharePoint", "OneDrive", "Teams"]
    }]),
    retentionLabels: available([{ id: "retain-7y" }]),
    ediscoveryCases: available([{
      id: "case",
      owner: "legal",
      holdValidatedAt: "2026-08-20T10:00:00.000Z"
    }]),
    caseHolds: available([{ id: "hold", Enabled: true, query: "CopilotInteraction" }]),
    insiderRiskPolicies: available([{ id: "irp", Enabled: true, owner: "owner", targetsCopilotCohort: true }]),
    communicationPolicies: available([{ id: "cc", Enabled: true, owner: "owner", targetsCopilotCohort: true }]),
    purviewAlerts: available([])
  };
  const results = normalizePurview({
    observations,
    context: {
      ...context,
      auditRetentionPosture: { validated: true },
      purviewPremiumMonitoring: {
        approvedBy: "compliance-admin",
        validatedAt: "2026-09-04T09:00:00.000Z",
        alerts: []
      }
    }
  });
  assert.equal(results.length, 7);
  assert.equal(results.every(item => item.status === "Pass"), true);
});

test("Purview audit cannot be NotApplicable and absent audit records do not pass", () => {
  const missing = {
    available: false,
    complete: false,
    source: "Purview",
    error: { code: "LICENSE_REQUIRED", message: "Required licence is unavailable." }
  };
  const observations = Object.fromEntries([
    "sensitivityLabels", "labelPolicies", "autoLabelPolicies", "autoLabelReport", "dlpPolicies",
    "dlpRules", "auditConfiguration", "copilotAuditRecords", "retentionPolicies", "retentionLabels",
    "ediscoveryCases", "caseHolds", "insiderRiskPolicies", "communicationPolicies", "purviewAlerts"
  ].map(key => [key, missing]));
  const results = normalizePurview({
    observations,
    context: {
      ...context,
      applicability: {
        "AFD-PURV-004": {
          applies: false,
          approved: true,
          approvedBy: "compliance-admin",
          reason: "Requested exemption"
        }
      }
    }
  });
  assert.equal(results.find(item => item.controlId === "AFD-PURV-004").status, "Unknown");
  assert.equal(results.every(item => item.status !== "Pass"), true);
});

test("Purview premium policy inventory cannot imply healthy alert queues", () => {
  const result = normalizePurview({
    observations: {
      insiderRiskPolicies: available([{
        id: "irp", Enabled: true, owner: "owner", targetsCopilotCohort: true
      }]),
      communicationPolicies: available([{
        id: "cc", Enabled: true, owner: "owner", targetsCopilotCohort: true
      }])
    },
    context
  }).find(item => item.controlId === "AFD-PURV-007");
  assert.equal(result.status, "Unknown");
  assert.match(result.limitations[0].description, /no supported read API/i);
});

test("Security maps Secure Score, Defender policies, incidents, devices, alerts, and cloud apps", () => {
  const observations = {
    secureScores: available([{ id: "score", currentScore: 80, maxScore: 100 }]),
    secureScoreProfiles: available([{ id: "action", implementationStatus: "completed", title: "Copilot action" }]),
    safeLinksPolicies: available([{ id: "links", Enabled: true, coversCopilotCohort: true }]),
    safeAttachmentPolicies: available([{ id: "attachments", Enabled: true, coversCopilotCohort: true }]),
    antiPhishPolicies: available([{ id: "phish", Enabled: true, coversCopilotCohort: true }]),
    cloudAppsOAuthApps: available([{ id: "oauth", riskLevel: "low", reviewed: true }]),
    cloudAppsAlerts: available([]),
    incidents: available([{ id: "incident", severity: "low", status: "active", assignedTo: "soc" }]),
    defenderMachines: available([{ id: "machine", onboardingStatus: "Onboarded", userIds: ["user-1"] }]),
    vulnerabilities: available([]),
    securityAlerts: available([]),
    cloudAppPolicies: available([
      { id: "p1", Enabled: true, name: "Unmanaged access" },
      { id: "p2", Enabled: true, name: "Unusual IP" },
      { id: "p3", Enabled: true, name: "OAuth grant anomaly" }
    ])
  };
  const results = normalizeSecurity({
    observations,
    context: { ...context, secureScoreBaseline: 0.75, defenderCloudAppsConnected: true }
  });
  assert.equal(results.length, 6);
  assert.equal(results.every(item => item.status === "Pass"), true);
});

test("missing APIs and licences return Unknown with exact limitation codes", async () => {
  const collector = createSecurityPostureCollector({
    graphRequest: async () => {
      const error = new Error("Microsoft Defender for Cloud Apps licence is required.");
      error.statusCode = 402;
      throw error;
    },
    adminCommand: async () => {
      const error = new Error("The term Get-SafeLinksPolicy is not recognized as a command.");
      error.code = "COMMAND_NOT_FOUND";
      throw error;
    }
  });
  const registry = new CollectorRegistry();
  registry.register(collector);
  const [run] = await registry.run({ context });
  assert.equal(run.status, "Completed");
  assert.equal(run.controlResults.every(item => item.status === "Unknown"), true);
  const codes = new Set(run.controlResults.flatMap(item => item.limitations.map(limit => limit.code)));
  assert.equal(codes.has("LICENSE_REQUIRED"), true);
  assert.equal(codes.has("COMMAND_UNAVAILABLE"), true);
});

test("approved, current applicability evidence can produce NotApplicable", () => {
  const results = normalizeExchange({
    observations: {},
    context: {
      ...context,
      applicability: {
        "AFD-EXO-002": {
          applies: false,
          approved: true,
          approvedBy: "messaging-lead",
          expiresAt: "2026-10-01T00:00:00.000Z",
          reason: "Tenant has no hybrid Exchange deployment."
        }
      }
    }
  });
  assert.equal(results.find(item => item.controlId === "AFD-EXO-002").status, "NotApplicable");
  assert.equal(results.find(item => item.controlId === "AFD-EXO-001").status, "Unknown");
});

test("NotApplicable requires an approver and a future expiry", () => {
  const result = normalizeExchange({
    observations: {},
    context: {
      ...context,
      applicability: {
        "AFD-EXO-002": {
          applies: false,
          approved: true,
          approvedBy: "messaging-lead",
          reason: "Tenant has no hybrid Exchange deployment."
        }
      }
    }
  }).find(item => item.controlId === "AFD-EXO-002");
  assert.equal(result.status, "Unknown");
});

test("collection honors cancellation before issuing more requests", async () => {
  const controller = new AbortController();
  let calls = 0;
  const collector = createPurviewComplianceCollector({
    graphRequest: async () => {
      calls++;
      controller.abort(Object.assign(new Error("stop"), { code: "COLLECTOR_CANCELLED" }));
      return { value: [], "@odata.nextLink": "next" };
    },
    adminCommand: async () => {
      calls++;
      return [];
    }
  });
  const registry = new CollectorRegistry();
  registry.register(collector);
  const [run] = await registry.run({ context, signal: controller.signal });
  assert.equal(run.status, "Cancelled");
  assert.equal(calls, 1);
});

test("factories validate limits and expose healthy offline adapter probes", async () => {
  assert.throws(() => createExchangeOnlineCollector({ limits: { maxPages: 0, maxItems: 1 } }),
    /positive integers/);
  const collector = createSecurityPostureCollector({});
  const capability = await collector.discoverCapabilities();
  const health = await collector.health({});
  assert.deepEqual(capability.missingAdapters, ["graphRequest", "adminCommand"]);
  assert.equal(health.healthy, true);
});
