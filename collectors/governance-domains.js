"use strict";

const catalog = require("../schema/readiness-catalog.v1.json");

const VERSION = "1.0.0";
const MAXIMUM_REQUESTS = 500;
const DEFAULT_LIMITS = Object.freeze({ maxPages: 20, maxItems: 5000 });
const DOMAIN_IDS = Object.freeze([
  "exchangeOnline",
  "sharePointOneDrive",
  "purviewCompliance",
  "securityPosture"
]);
const domains = new Map(catalog.domains
  .filter(domain => DOMAIN_IDS.includes(domain.id))
  .map(domain => [domain.id, domain]));

const CAPABILITIES = Object.freeze({
  exchangeOnline: Object.freeze([
    capability("AFD-EXO-001", ["MailboxSettings.Read"], ["Exchange Online Plan 1"],
      ["Get-EXOMailbox"]),
    capability("AFD-EXO-002", ["Exchange.ManageAsApp"], ["Exchange Online Plan 1"],
      ["Get-HybridConfiguration", "Get-OrganizationRelationship", "Get-RemoteDomain"]),
    capability("AFD-EXO-003", ["Exchange.ManageAsApp"], ["Exchange Online Plan 1"],
      ["Get-EXOMailboxPermission", "Get-EXORecipientPermission"]),
    capability("AFD-EXO-004", ["DeviceManagementApps.Read.All"], ["Microsoft 365 Copilot"],
      ["GET /deviceManagement/detectedApps"]),
    capability("AFD-EXO-005", ["Exchange.ManageAsApp"], ["Exchange Online Plan 1"],
      ["Get-TransportRule", "Get-MessageTraceV2"])
  ]),
  sharePointOneDrive: Object.freeze([
    capability("AFD-SPO-001", ["SharePointTenantSettings.Read.All"], ["SharePoint Online Plan 1"],
      ["GET /admin/sharepoint/settings", "Get-SPOTenant"]),
    capability("AFD-SPO-002", ["Sites.FullControl.All"],
      ["Microsoft SharePoint Premium - SharePoint Advanced Management"],
      ["Get-SPOSite", "SharePoint Advanced Management site access report"]),
    capability("AFD-SPO-003", ["Sites.FullControl.All"],
      ["Microsoft SharePoint Premium - SharePoint Advanced Management"],
      ["SharePoint Advanced Management data access governance report"]),
    capability("AFD-SPO-004", ["Sites.FullControl.All"],
      ["Microsoft SharePoint Premium - SharePoint Advanced Management"],
      ["SharePoint Advanced Management restricted content report"]),
    capability("AFD-SPO-005", ["Sites.FullControl.All"], ["Microsoft 365 Copilot"],
      ["Get-SPOTenantRestrictedSearchMode", "Get-SPOTenantRestrictedSearchAllowedList"]),
    capability("AFD-SPO-006", ["Sites.FullControl.All"],
      ["Microsoft SharePoint Premium - SharePoint Advanced Management"],
      ["Get-SPOSite", "SharePoint Advanced Management site lifecycle report"]),
    capability("AFD-SPO-007", ["SharePointTenantSettings.Read.All"], ["OneDrive for Business Plan 1"],
      ["Get-SPOTenant", "OneDrive sharing override report"])
  ]),
  purviewCompliance: Object.freeze([
    capability("AFD-PURV-001", ["InformationProtectionPolicy.Read"], ["Microsoft 365 E3"],
      ["GET /security/informationProtection/sensitivityLabels", "Get-Label", "Get-LabelPolicy"]),
    capability("AFD-PURV-002", ["InformationProtectionPolicy.Read"], ["Microsoft 365 E5 Compliance"],
      ["Get-AutoSensitivityLabelPolicy", "Get-AutoSensitivityLabelRule"]),
    capability("AFD-PURV-003", ["InformationProtectionPolicy.Read"], ["Microsoft 365 E5 Compliance"],
      ["Get-DlpCompliancePolicy", "Get-DlpComplianceRule"]),
    capability("AFD-PURV-004", ["AuditLog.Read.All"], ["Microsoft 365 E3"],
      ["Get-AdminAuditLogConfig", "Search-UnifiedAuditLog"]),
    capability("AFD-PURV-005", ["RecordsManagement.Read.All"], ["Microsoft 365 E5 Compliance"],
      ["Get-RetentionCompliancePolicy", "Get-ComplianceTag"]),
    capability("AFD-PURV-006", ["eDiscovery.Read.All"], ["Microsoft 365 E5 Compliance"],
      ["Get-ComplianceCase", "Get-CaseHoldPolicy"]),
    capability("AFD-PURV-007",
      ["CommunicationCompliance.Read.All", "InsiderRiskManagement.Read.All"],
      ["Microsoft 365 E5 Compliance"],
      ["Get-InsiderRiskPolicy", "Get-SupervisoryReviewPolicyV2"])
  ]),
  securityPosture: Object.freeze([
    capability("AFD-SEC-001", ["SecurityEvents.Read.All"], ["Microsoft Defender for Office 365 Plan 1"],
      ["GET /security/secureScores", "GET /security/secureScoreControlProfiles"]),
    capability("AFD-SEC-002", ["ThreatIndicators.Read.All"], ["Microsoft Defender for Office 365 Plan 1"],
      ["Get-SafeLinksPolicy", "Get-SafeAttachmentPolicy", "Get-AntiPhishPolicy"]),
    capability("AFD-SEC-003", ["SecurityEvents.Read.All"], ["Microsoft Defender for Cloud Apps"],
      ["Defender for Cloud Apps OAuth apps API", "Defender for Cloud Apps alerts API"]),
    capability("AFD-SEC-004", ["SecurityIncident.Read.All"], ["Microsoft Defender XDR"],
      ["GET /security/incidents"]),
    capability("AFD-SEC-005", ["SecurityEvents.Read.All"], ["Microsoft Defender for Endpoint Plan 2"],
      ["Defender for Endpoint machines API", "Defender for Endpoint vulnerabilities API"]),
    capability("AFD-SEC-006", ["SecurityAlert.Read.All"], ["Microsoft Defender for Cloud Apps"],
      ["GET /security/alerts_v2", "Defender for Cloud Apps policies API"])
  ])
});

function capability(controlId, permissions, licenses, operations) {
  return Object.freeze({
    controlId,
    permissions: Object.freeze([...permissions].sort()),
    licenses: Object.freeze([...licenses].sort()),
    operations: Object.freeze([...operations])
  });
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    const error = signal.reason instanceof Error ? signal.reason : new Error("Collector cancelled.");
    if (!error.code) error.code = "COLLECTOR_CANCELLED";
    throw error;
  }
}

function field(value, ...names) {
  if (!value || typeof value !== "object") return undefined;
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(value, name)) return value[name];
    const actual = Object.keys(value).find(key => key.toLowerCase() === name.toLowerCase());
    if (actual !== undefined) return value[actual];
  }
  return undefined;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.value)) return value.value;
  if (Array.isArray(value?.items)) return value.items;
  if (value === undefined || value === null) return [];
  return [value];
}

function stable(items, keys = ["id", "Id", "identity", "Name", "name", "DisplayName", "displayName"]) {
  return [...items].sort((left, right) => {
    const a = keys.map(key => field(left, key)).find(value => value !== undefined) ?? JSON.stringify(left);
    const b = keys.map(key => field(right, key)).find(value => value !== undefined) ?? JSON.stringify(right);
    return String(a).localeCompare(String(b));
  });
}

function bool(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return ["true", "enabled", "on", "yes", "success"].includes(String(value || "").toLowerCase());
}

function isoTime(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function errorCode(error) {
  const code = String(error?.code || error?.statusCode || error?.status || "").toUpperCase();
  const message = String(error?.message || error || "").toLowerCase();
  if (code === "401" || code === "403" || /permission|forbidden|unauthori|role/.test(message)) {
    return "MISSING_PERMISSION_OR_ROLE";
  }
  if (code === "402" || /licen[cs]e|subscription|entitle/.test(message)) return "LICENSE_REQUIRED";
  if (code === "404" || /not found|unsupported api|not available/.test(message)) return "API_UNAVAILABLE";
  if (/command.*not.*(found|recogn)/.test(message) || code === "COMMAND_NOT_FOUND") {
    return "COMMAND_UNAVAILABLE";
  }
  return "SOURCE_QUERY_FAILED";
}

function failure(error, source) {
  return {
    available: false,
    complete: false,
    source,
    error: {
      code: errorCode(error),
      message: String(error?.message || error || "The evidence source was unavailable.")
    }
  };
}

async function graphCollection(adapter, query, budget, signal, limits) {
  const items = [];
  let next = query.url;
  let pages = 0;
  while (next) {
    throwIfAborted(signal);
    if (pages >= limits.maxPages || items.length >= limits.maxItems) {
      return {
        available: true,
        complete: false,
        source: query.source,
        items: stable(items.slice(0, limits.maxItems)),
        limitation: {
          code: "COLLECTION_BOUND_REACHED",
          description: `${query.source} exceeded maxPages=${limits.maxPages} or maxItems=${limits.maxItems}.`
        }
      };
    }
    budget.consume();
    const response = await adapter({ method: "GET", url: next, signal });
    const pageItems = asArray(response);
    items.push(...pageItems.slice(0, Math.max(0, limits.maxItems - items.length)));
    pages++;
    next = response?.["@odata.nextLink"] || response?.nextLink || null;
  }
  return { available: true, complete: true, source: query.source, items: stable(items) };
}

async function graphSingle(adapter, query, budget, signal) {
  throwIfAborted(signal);
  budget.consume();
  const response = await adapter({ method: "GET", url: query.url, signal });
  return { available: true, complete: true, source: query.source, data: response };
}

async function commandResult(adapter, query, budget, signal, limits) {
  throwIfAborted(signal);
  budget.consume();
  const response = await adapter({
    service: query.service,
    command: query.command,
    parameters: { ...(query.parameters || {}) },
    signal
  });
  const items = asArray(response);
  const truncated = items.length > limits.maxItems;
  return {
    available: true,
    complete: !truncated,
    source: query.source,
    items: stable(items.slice(0, limits.maxItems)),
    data: Array.isArray(response) || Array.isArray(response?.value) || Array.isArray(response?.items)
      ? undefined
      : response,
    limitation: truncated ? {
      code: "COLLECTION_BOUND_REACHED",
      description: `${query.source} exceeded maxItems=${limits.maxItems}.`
    } : undefined
  };
}

async function executePlan(plan, adapters, budget, signal, limits) {
  const observations = {};
  for (const query of plan) {
    throwIfAborted(signal);
    const adapter = query.adapter === "graph" ? adapters.graphRequest : adapters.adminCommand;
    if (typeof adapter !== "function") {
      observations[query.key] = failure(
        Object.assign(new Error(`${query.adapter} adapter was not supplied.`), {
          code: query.adapter === "graph" ? "API_UNAVAILABLE" : "COMMAND_NOT_FOUND"
        }),
        query.source
      );
      continue;
    }
    try {
      observations[query.key] = query.adapter === "graph"
        ? (query.collection === false
          ? await graphSingle(adapter, query, budget, signal)
          : await graphCollection(adapter, query, budget, signal, limits))
        : await commandResult(adapter, query, budget, signal, limits);
    } catch (error) {
      if (signal?.aborted) throwIfAborted(signal);
      observations[query.key] = failure(error, query.source);
    }
  }
  return observations;
}

function limitationFor(observation, key) {
  if (!observation) {
    return { code: "INCOMPLETE_EVIDENCE", description: `Evidence '${key}' was not collected.` };
  }
  if (observation.limitation) return observation.limitation;
  if (observation.error) {
    return {
      code: observation.error.code,
      description: `${observation.source || key}: ${observation.error.message}`
    };
  }
  return {
    code: "INCOMPLETE_EVIDENCE",
    description: `${observation.source || key} did not provide complete evidence.`
  };
}

function evidenceItems(observation) {
  if (!observation?.available) return [];
  return observation.items || asArray(observation.data);
}

function controlResult(domainId, controlId, status, context, options = {}) {
  const domain = domains.get(domainId);
  const control = domain.controls.find(item => item.id === controlId);
  const observedAt = context.observedAt || new Date().toISOString();
  const cohortId = context.cohort?.id || "tenant-wide";
  return {
    controlId,
    controlVersion: catalog.catalogVersion,
    instanceId: `${context.tenantId}:${cohortId}:${controlId}`,
    domainId,
    cohortId,
    status,
    requirement: control.requirement,
    applicability: options.applicability || { applies: true, reason: control.applicability },
    observedValue: options.observedValue ?? null,
    expectedValue: control.passCondition,
    observedAt,
    freshUntil: new Date(Date.parse(observedAt) + control.freshnessHours * 3600000).toISOString(),
    coverage: {
      population: options.population || 0,
      evaluated: options.evaluated || 0,
      complete: options.complete === true,
      excluded: options.excluded || 0,
      reason: options.coverageReason || ""
    },
    confidence: options.confidence ?? (options.complete ? 1 : 0),
    provenance: {
      collectorId: `microsoft-365-${domainId.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`,
      collectorVersion: VERSION,
      collectorRunId: context.collectorRunId,
      tenantId: context.tenantId,
      actorId: context.actorId,
      source: options.source || "Microsoft 365 read-only administration APIs",
      sourceVersion: options.sourceVersion || null,
      requestIds: []
    },
    evidenceRefs: options.evidenceRefs || [],
    affectedPrincipals: stable(options.affectedPrincipals || []),
    affectedResources: stable(options.affectedResources || []),
    owner: null,
    remediation: {
      state: "NotPlanned",
      action: control.remediation,
      packageId: null
    },
    attestation: options.attestation || null,
    limitations: options.limitations || []
  };
}

function approvedNotApplicable(domainId, controlId, context) {
  if (controlId === "AFD-PURV-004") return null;
  const item = context.applicability?.[controlId];
  if (!item || item.applies !== false || item.approved !== true || !item.approvedBy ||
      isoTime(item.expiresAt) === null) return null;
  if (isoTime(item.expiresAt) <= Date.parse(context.observedAt || new Date().toISOString())) {
    return null;
  }
  return controlResult(domainId, controlId, "NotApplicable", context, {
    complete: true,
    confidence: 1,
    applicability: {
      applies: false,
      reason: String(item.reason || "Approved as not applicable."),
      approvedBy: String(item.approvedBy),
      expiresAt: new Date(isoTime(item.expiresAt)).toISOString()
    },
    attestation: item
  });
}

function evaluate(domainId, controlId, observations, context, requiredKeys, evaluator) {
  const notApplicable = approvedNotApplicable(domainId, controlId, context);
  if (notApplicable) return notApplicable;
  const missing = requiredKeys
    .filter(key => !observations[key]?.available || observations[key]?.complete !== true);
  if (missing.length) {
    return controlResult(domainId, controlId, "Unknown", context, {
      limitations: missing.map(key => limitationFor(observations[key], key)),
      source: requiredKeys.map(key => observations[key]?.source || key).join("; ")
    });
  }
  try {
    const outcome = evaluator();
    return controlResult(domainId, controlId, outcome.status, context, {
      complete: true,
      confidence: outcome.confidence ?? 1,
      source: requiredKeys.map(key => observations[key].source).join("; "),
      ...outcome
    });
  } catch (error) {
    return controlResult(domainId, controlId, "Unknown", context, {
      limitations: [{
        code: "EVIDENCE_SHAPE_UNSUPPORTED",
        description: String(error?.message || error)
      }]
    });
  }
}

function cohortIds(context) {
  return new Set(context.cohort?.principalIds || []);
}

function identity(item) {
  return String(field(item, "id", "Id", "ExternalDirectoryObjectId", "UserPrincipalName",
    "PrimarySmtpAddress", "Identity", "Name") || "");
}

function normalizeExchange({ observations, context }) {
  const domainId = "exchangeOnline";
  const cohort = cohortIds(context);
  const results = [];
  results.push(evaluate(domainId, "AFD-EXO-001", observations, context, ["mailboxes"], () => {
    if (!context.cohort?.approved || !cohort.size) throw new Error("An approved cohort is required.");
    const mailboxes = evidenceItems(observations.mailboxes);
    const byId = new Map(mailboxes.flatMap(item => [
      field(item, "ExternalDirectoryObjectId", "id"),
      field(item, "UserPrincipalName"),
      field(item, "PrimarySmtpAddress")
    ].filter(Boolean).map(value => [String(value).toLowerCase(), item])));
    const missing = [...cohort].filter(id => {
      const mailbox = byId.get(String(id).toLowerCase());
      return !mailbox ||
        String(field(mailbox, "RecipientTypeDetails") || "").toLowerCase() !== "usermailbox" ||
        !field(mailbox, "PrimarySmtpAddress");
    });
    return {
      status: missing.length ? "Fail" : "Pass",
      population: cohort.size,
      evaluated: cohort.size,
      observedValue: { validCloudMailboxes: cohort.size - missing.length, invalidOrMissing: missing },
      affectedPrincipals: missing
    };
  }));
  results.push(evaluate(domainId, "AFD-EXO-002", observations, context,
    ["hybridConfiguration", "organizationRelationships", "remoteDomains"], () => {
      const validation = context.hybridValidation;
      if (!validation) throw new Error("A dated hybrid mail-flow and free/busy validation is required.");
      const age = Date.parse(context.observedAt || new Date().toISOString()) - isoTime(validation.validatedAt);
      const current = age >= 0 && age <= 7 * 86400000;
      const pass = current && validation.mailFlow === true && validation.freeBusy === true;
      return {
        status: pass ? "Pass" : "Fail",
        population: 1,
        evaluated: 1,
        observedValue: {
          hybridObjects: evidenceItems(observations.hybridConfiguration).length,
          validation
        },
        attestation: validation,
        confidence: 0.9
      };
    }));
  results.push(evaluate(domainId, "AFD-EXO-003", observations, context,
    ["mailboxPermissions", "recipientPermissions", "directoryUsers"], () => {
      if (!context.cohort?.approved || !cohort.size) throw new Error("An approved cohort is required.");
      const permissions = [
        ...evidenceItems(observations.mailboxPermissions).map(item => ({ ...item, accessKind: "FullAccess" })),
        ...evidenceItems(observations.recipientPermissions).map(item => ({ ...item, accessKind: "SendAs" }))
      ].filter(item => {
        const mailbox = String(field(item, "Identity", "Mailbox", "Trustee") || "").toLowerCase();
        return [...cohort].some(id => mailbox === String(id).toLowerCase()) &&
          !/nt authority\\self/i.test(String(field(item, "User", "Trustee") || ""));
      });
      const users = new Map(evidenceItems(observations.directoryUsers)
        .map(item => [String(field(item, "id", "userPrincipalName") || "").toLowerCase(), item]));
      const attestations = context.delegationAttestations || {};
      const unsafe = permissions.filter(item => {
        const principal = String(field(item, "User", "Trustee") || "").toLowerCase();
        const user = users.get(principal);
        const disabled = user && field(user, "accountEnabled") === false;
        const key = `${String(field(item, "Identity", "Mailbox") || "").toLowerCase()}:${principal}:${item.accessKind}`;
        const attestation = attestations[key];
        return disabled || !attestation?.owner || !attestation?.reviewedAt;
      });
      return {
        status: unsafe.length ? "Fail" : "Pass",
        population: permissions.length,
        evaluated: permissions.length,
        observedValue: { delegatedPermissions: permissions.length, unsafe: unsafe.length },
        affectedPrincipals: unsafe.map(item => String(field(item, "User", "Trustee") || "")),
        affectedResources: unsafe.map(item => String(field(item, "Identity", "Mailbox") || ""))
      };
    }));
  results.push(evaluate(domainId, "AFD-EXO-004", observations, context, ["outlookInventory"], () => {
    const attestation = context.outlookClientReadiness;
    if (!attestation?.approvedBy || isoTime(attestation.validatedAt) === null ||
        !Number.isInteger(attestation.total) || !Number.isInteger(attestation.supported) ||
        attestation.total < 1 || attestation.supported < 0 ||
        attestation.supported > attestation.total) {
      throw new Error(
        "Detected-app inventory does not prove per-user Outlook readiness; a dated owner attestation is required."
      );
    }
    const inventory = evidenceItems(observations.outlookInventory);
    const ratio = attestation.supported / attestation.total;
    return {
      status: ratio >= 0.95 ? "Pass" : "Fail",
      population: attestation.total,
      evaluated: attestation.total,
      observedValue: {
        detectedOutlookApplications: inventory.length,
        supported: attestation.supported,
        total: attestation.total,
        ratio
      },
      affectedPrincipals: stable(attestation.unsupportedPrincipalIds || []),
      attestation,
      confidence: 0.85
    };
  }));
  results.push(evaluate(domainId, "AFD-EXO-005", observations, context,
    ["transportRules", "messageTrace"], () => {
      const rules = evidenceItems(observations.transportRules);
      const blocking = rules.filter(item => {
        const enabled = !["disabled", "false"].includes(String(field(item, "State", "Enabled") || "enabled").toLowerCase());
        const text = JSON.stringify(item).toLowerCase();
        return enabled && /copilot/.test(text) && /block|reject|delete|strip|quarantine/.test(text);
      });
      const traces = evidenceItems(observations.messageTrace);
      if (!traces.length) throw new Error("A bounded message-trace delivery sample is required.");
      const failed = traces.filter(item =>
        !["delivered", "expanded", "resolved"].includes(String(field(item, "Status") || "").toLowerCase()));
      return {
        status: blocking.length || failed.length ? "Fail" : "Pass",
        population: rules.length + traces.length,
        evaluated: rules.length + traces.length,
        observedValue: { blockingRules: blocking.length, failedTraceSamples: failed.length },
        affectedResources: blocking.map(identity)
      };
    }));
  return results.sort((a, b) => a.controlId.localeCompare(b.controlId));
}

function sharingRank(value) {
  const ranks = { disabled: 0, existingexternaluserSharingOnly: 1, externalusersharingonly: 2, externaluserandguestsharing: 3 };
  return ranks[String(value || "").replace(/\s/g, "").toLowerCase()];
}

function normalizeSharePoint({ observations, context }) {
  const domainId = "sharePointOneDrive";
  const results = [];
  results.push(evaluate(domainId, "AFD-SPO-001", observations, context, ["tenantSettings"], () => {
    const settings = observations.tenantSettings.data || evidenceItems(observations.tenantSettings)[0] || {};
    const sharePoint = field(settings, "sharingCapability", "SharingCapability");
    const oneDrive = field(settings, "oneDriveSharingCapability", "OneDriveSharingCapability");
    const maximum = context.sharePointPosture?.maximumSharingCapability;
    if (sharingRank(sharePoint) === undefined || sharingRank(oneDrive) === undefined || maximum === undefined) {
      throw new Error("Tenant SharePoint, OneDrive, and documented maximum sharing settings are required.");
    }
    const pass = sharingRank(sharePoint) <= sharingRank(maximum) &&
      sharingRank(oneDrive) <= sharingRank(maximum) &&
      sharingRank(sharePoint) === sharingRank(oneDrive);
    return {
      status: pass ? "Pass" : "Fail",
      population: 2,
      evaluated: 2,
      observedValue: { sharePoint, oneDrive, maximum }
    };
  }));
  results.push(evaluate(domainId, "AFD-SPO-002", observations, context,
    ["sites", "siteAccessReport"], () => {
      const scope = new Set(context.inScopeSiteIds || []);
      if (!scope.size) throw new Error("The high-risk or cohort-exposed site scope is required.");
      const rows = [...evidenceItems(observations.sites), ...evidenceItems(observations.siteAccessReport)];
      const byId = new Map(rows.map(item => [identity(item).toLowerCase(), item]));
      const bad = [...scope].filter(id => {
        const site = byId.get(String(id).toLowerCase());
        return !site || !field(site, "accessRequestApprover", "AccessRequestApprover") ||
          field(site, "sharingWithinTenantPosture") === false;
      });
      return {
        status: bad.length ? "Fail" : "Pass",
        population: scope.size,
        evaluated: scope.size,
        observedValue: { reviewedSites: scope.size - bad.length, exceptions: bad.length },
        affectedResources: bad
      };
    }));
  results.push(evaluate(domainId, "AFD-SPO-003", observations, context, ["dataAccessGovernance"], () => {
    const reports = evidenceItems(observations.dataAccessGovernance);
    const now = Date.parse(context.observedAt || new Date().toISOString());
    const recent = reports.filter(item => {
      const age = now - isoTime(field(item, "generatedAt", "GeneratedAt", "reportDate"));
      return age >= 0 && age <= 7 * 86400000;
    });
    if (!recent.length) throw new Error("No full effective-access baseline from the last 7 days was returned.");
    const hotspots = recent.flatMap(item => asArray(field(item, "hotspots", "Hotspots")));
    const unowned = hotspots.filter(item => !field(item, "owner", "Owner") ||
      !field(item, "remediationPlan", "RemediationPlan"));
    return {
      status: unowned.length ? "Fail" : "Pass",
      population: hotspots.length,
      evaluated: hotspots.length,
      observedValue: { recentBaselines: recent.length, hotspots: hotspots.length, unowned: unowned.length },
      affectedResources: unowned.map(identity)
    };
  }));
  results.push(evaluate(domainId, "AFD-SPO-004", observations, context,
    ["restrictedContent"], () => {
      const restricted = new Set(context.restrictedResourceIds || []);
      if (!restricted.size) throw new Error("The data-governance restricted resource list is required.");
      const covered = new Set(evidenceItems(observations.restrictedContent)
        .filter(item => bool(field(item, "enabled", "Enabled")) && field(item, "excludedFromCopilot") === true)
        .map(item => identity(item).toLowerCase()));
      const missing = [...restricted].filter(id => !covered.has(String(id).toLowerCase()));
      return {
        status: missing.length ? "Fail" : "Pass",
        population: restricted.size,
        evaluated: restricted.size,
        observedValue: { covered: restricted.size - missing.length, missing },
        affectedResources: missing
      };
    }));
  results.push(evaluate(domainId, "AFD-SPO-005", observations, context,
    ["restrictedSearchMode", "restrictedSearchAllowedList"], () => {
      const mode = observations.restrictedSearchMode.data ||
        evidenceItems(observations.restrictedSearchMode)[0] || {};
      const allowed = new Set(evidenceItems(observations.restrictedSearchAllowedList).map(identity));
      const expected = new Set(context.restrictedSearchExpectedSiteIds || []);
      if (!expected.size) throw new Error("The documented Restricted SharePoint Search allow-list is required.");
      const matches = allowed.size === expected.size && [...expected].every(id => allowed.has(id));
      return {
        status: bool(field(mode, "enabled", "Enabled", "RestrictedSearchMode")) && matches ? "Pass" : "Fail",
        population: expected.size,
        evaluated: expected.size,
        observedValue: { enabled: bool(field(mode, "enabled", "Enabled", "RestrictedSearchMode")), allowed: [...allowed] },
        affectedResources: [...expected].filter(id => !allowed.has(id))
      };
    }));
  results.push(evaluate(domainId, "AFD-SPO-006", observations, context,
    ["sites", "siteLifecycle"], () => {
      const scope = new Set(context.inScopeSiteIds || []);
      if (!scope.size) throw new Error("The Copilot grounding site scope is required.");
      const rows = [...evidenceItems(observations.sites), ...evidenceItems(observations.siteLifecycle)];
      const byId = new Map(rows.map(item => [identity(item).toLowerCase(), item]));
      const bad = [...scope].filter(id => {
        const site = byId.get(String(id).toLowerCase());
        return !site || !field(site, "owner", "Owner") ||
          !field(site, "inactivityPolicy", "InactivityPolicy");
      });
      return {
        status: bad.length ? "Fail" : "Pass",
        population: scope.size,
        evaluated: scope.size,
        observedValue: { governed: scope.size - bad.length, ungoverned: bad.length },
        affectedResources: bad
      };
    }));
  results.push(evaluate(domainId, "AFD-SPO-007", observations, context,
    ["tenantSettings", "oneDriveOverrides"], () => {
      const settings = observations.tenantSettings.data || evidenceItems(observations.tenantSettings)[0] || {};
      const expectedType = context.oneDrivePosture?.defaultLinkType;
      const expectedPermission = context.oneDrivePosture?.defaultLinkPermission;
      if (!expectedType || !expectedPermission) throw new Error("Documented OneDrive sharing defaults are required.");
      const mismatchedDefault =
        String(field(settings, "defaultSharingLinkType", "DefaultSharingLinkType") || "").toLowerCase() !==
          String(expectedType).toLowerCase() ||
        String(field(settings, "defaultLinkPermission", "DefaultLinkPermission") || "").toLowerCase() !==
          String(expectedPermission).toLowerCase();
      const overrides = evidenceItems(observations.oneDriveOverrides)
        .filter(item => field(item, "morePermissive") === true);
      return {
        status: mismatchedDefault || overrides.length ? "Fail" : "Pass",
        population: Math.max(1, overrides.length),
        evaluated: Math.max(1, overrides.length),
        observedValue: { mismatchedDefault, permissiveOverrides: overrides.length },
        affectedPrincipals: overrides.map(identity)
      };
    }));
  return results.sort((a, b) => a.controlId.localeCompare(b.controlId));
}

function enabled(item) {
  return !["disabled", "off", "false"].includes(String(field(item, "enabled", "Enabled", "State", "Mode") || "enabled").toLowerCase());
}

function normalizePurview({ observations, context }) {
  const domainId = "purviewCompliance";
  const results = [];
  results.push(evaluate(domainId, "AFD-PURV-001", observations, context,
    ["sensitivityLabels", "labelPolicies"], () => {
      const labels = evidenceItems(observations.sensitivityLabels);
      const policies = evidenceItems(observations.labelPolicies);
      const published = new Set(policies.flatMap(item =>
        asArray(field(item, "Labels", "labels", "labelIds")).map(String)));
      const levels = new Set(labels.filter(item => published.has(identity(item)) || field(item, "published") === true)
        .map(item => String(field(item, "classification", "displayName", "DisplayName") || "").toLowerCase()));
      const required = ["public", "general", "confidential", "highly confidential"];
      const covered = required.filter(level => [...levels].some(name => name.includes(level)));
      const undocumented = labels.filter(item => !field(item, "description", "Tooltip", "usageGuideline"));
      return {
        status: labels.length >= 3 && covered.length === required.length && !undocumented.length ? "Pass" : "Fail",
        population: labels.length,
        evaluated: labels.length,
        observedValue: { labelCount: labels.length, coveredLevels: covered, undocumented: undocumented.length },
        affectedResources: undocumented.map(identity)
      };
    }));
  results.push(evaluate(domainId, "AFD-PURV-002", observations, context,
    ["autoLabelPolicies", "autoLabelReport"], () => {
      const policies = evidenceItems(observations.autoLabelPolicies);
      const active = policies.filter(item => ["simulation", "enabled"].includes(
        String(field(item, "Mode", "mode", "State") || "").toLowerCase()) &&
        field(item, "owner", "Owner"));
      const report = observations.autoLabelReport.data || evidenceItems(observations.autoLabelReport)[0] || {};
      const coverage = Number(field(report, "coverage", "Coverage", "coveragePercent"));
      const ratio = coverage > 1 ? coverage / 100 : coverage;
      return {
        status: active.length && ratio >= 0.8 ? "Pass" : "Fail",
        population: policies.length,
        evaluated: policies.length,
        observedValue: { activePolicies: active.length, labelCoverage: ratio }
      };
    }));
  results.push(evaluate(domainId, "AFD-PURV-003", observations, context,
    ["dlpPolicies", "dlpRules"], () => {
      const policies = evidenceItems(observations.dlpPolicies);
      const required = new Set(["exchange", "sharepoint", "onedrive", "teams", "copilot"]);
      const covered = new Set();
      const invalid = [];
      for (const item of policies) {
        if (!enabled(item)) continue;
        asArray(field(item, "locations", "Workload", "workloads")).forEach(location =>
          covered.add(String(location).toLowerCase()));
        const mode = String(field(item, "Mode", "mode") || "").toLowerCase();
        if (/test/.test(mode) && !field(item, "testExpiry", "expiry", "ExpiresAt")) invalid.push(item);
        if (!field(item, "owner", "Owner")) invalid.push(item);
      }
      const missing = [...required].filter(location =>
        ![...covered].some(value => value.includes(location)));
      return {
        status: missing.length || invalid.length ? "Fail" : "Pass",
        population: policies.length,
        evaluated: policies.length,
        observedValue: { coveredLocations: [...covered].sort(), missing, invalidPolicies: invalid.length },
        affectedResources: invalid.map(identity)
      };
    }));
  results.push(evaluate(domainId, "AFD-PURV-004", observations, context,
    ["auditConfiguration", "copilotAuditRecords"], () => {
      const configuration = observations.auditConfiguration.data ||
        evidenceItems(observations.auditConfiguration)[0] || {};
      const records = evidenceItems(observations.copilotAuditRecords);
      const now = Date.parse(context.observedAt || new Date().toISOString());
      const recent = records.filter(item => {
        const at = isoTime(field(item, "CreationDate", "createdDateTime", "timestamp"));
        return at !== null && now - at >= 0 && now - at <= 24 * 3600000;
      });
      const enabledAudit = bool(field(configuration, "UnifiedAuditLogIngestionEnabled",
        "unifiedAuditLogIngestionEnabled", "enabled"));
      const retentionMatches = field(configuration, "retentionMatchesPosture") === true ||
        context.auditRetentionPosture?.validated === true;
      return {
        status: enabledAudit && recent.length && retentionMatches ? "Pass" : "Fail",
        population: records.length,
        evaluated: records.length,
        observedValue: { unifiedAuditEnabled: enabledAudit, recentCopilotRecords: recent.length, retentionMatches }
      };
    }));
  results.push(evaluate(domainId, "AFD-PURV-005", observations, context,
    ["retentionPolicies", "retentionLabels"], () => {
      const policies = evidenceItems(observations.retentionPolicies);
      const required = ["exchange", "sharepoint", "onedrive", "teams"];
      const covered = new Set(policies.filter(enabled).flatMap(item =>
        asArray(field(item, "locations", "Workload", "workloads")).map(value => String(value).toLowerCase())));
      const missing = required.filter(location => ![...covered].some(value => value.includes(location)));
      const unowned = policies.filter(item => enabled(item) && !field(item, "owner", "Owner"));
      return {
        status: missing.length || unowned.length ? "Fail" : "Pass",
        population: policies.length,
        evaluated: policies.length,
        observedValue: {
          labels: evidenceItems(observations.retentionLabels).length,
          missingLocations: missing,
          unownedPolicies: unowned.length
        },
        affectedResources: unowned.map(identity)
      };
    }));
  results.push(evaluate(domainId, "AFD-PURV-006", observations, context,
    ["ediscoveryCases", "caseHolds"], () => {
      const cases = evidenceItems(observations.ediscoveryCases);
      const holds = evidenceItems(observations.caseHolds);
      const now = Date.parse(context.observedAt || new Date().toISOString());
      const valid = cases.filter(item => {
        const validatedAt = isoTime(field(item, "holdValidatedAt", "HoldValidatedAt", "validatedAt"));
        return field(item, "owner", "CaseOwner", "Owner") && validatedAt !== null &&
          now - validatedAt >= 0 && now - validatedAt <= 30 * 86400000;
      });
      const copilotHolds = holds.filter(item => /copilot/i.test(JSON.stringify(item)) && enabled(item));
      return {
        status: valid.length && copilotHolds.length ? "Pass" : "Fail",
        population: cases.length,
        evaluated: cases.length,
        observedValue: { readyCases: valid.length, copilotHolds: copilotHolds.length }
      };
    }));
  results.push(evaluate(domainId, "AFD-PURV-007", observations, context,
    ["insiderRiskPolicies", "communicationPolicies"], () => {
      const policies = [
        ...evidenceItems(observations.insiderRiskPolicies),
        ...evidenceItems(observations.communicationPolicies)
      ];
      const cohortTargeted = policies.filter(item => enabled(item) &&
        field(item, "owner", "Owner") && field(item, "targetsCopilotCohort") === true);
      const monitoring = context.purviewPremiumMonitoring;
      if (!monitoring?.approvedBy || isoTime(monitoring.validatedAt) === null ||
          !Array.isArray(monitoring.alerts)) {
        throw new Error(
          "Purview premium alert queues have no supported read API in this collector; a dated owner attestation is required."
        );
      }
      const now = Date.parse(context.observedAt || new Date().toISOString());
      const stale = monitoring.alerts.filter(item => {
        const age = now - isoTime(field(item, "createdDateTime", "CreatedDateTime", "createdAt"));
        return ["high", "critical"].includes(String(field(item, "severity", "Severity") || "").toLowerCase()) &&
          !["resolved", "closed"].includes(String(field(item, "status", "Status") || "").toLowerCase()) &&
          age > 7 * 86400000;
      });
      return {
        status: cohortTargeted.length >= 2 && !stale.length ? "Pass" : "Fail",
        population: policies.length + stale.length,
        evaluated: policies.length + stale.length,
        observedValue: { cohortTargetedPolicies: cohortTargeted.length, staleHighAlerts: stale.length },
        affectedResources: stale.map(identity),
        attestation: monitoring,
        confidence: 0.85
      };
    }));
  return results.sort((a, b) => a.controlId.localeCompare(b.controlId));
}

function normalizeSecurity({ observations, context }) {
  const domainId = "securityPosture";
  const results = [];
  results.push(evaluate(domainId, "AFD-SEC-001", observations, context,
    ["secureScores", "secureScoreProfiles"], () => {
      const scores = evidenceItems(observations.secureScores);
      if (!scores.length || !Number.isFinite(Number(context.secureScoreBaseline))) {
        throw new Error("A current Secure Score and documented numeric baseline are required.");
      }
      const current = Number(field(scores[0], "currentScore"));
      const maximum = Number(field(scores[0], "maxScore"));
      const percent = maximum > 0 ? current / maximum : NaN;
      const profiles = evidenceItems(observations.secureScoreProfiles);
      const unowned = profiles.filter(item => /copilot/i.test(JSON.stringify(item)) &&
        !["completed", "resolved"].includes(String(field(item, "implementationStatus", "status") || "").toLowerCase()) &&
        !field(item, "owner", "assignedTo"));
      return {
        status: Number.isFinite(percent) && percent >= Number(context.secureScoreBaseline) && !unowned.length
          ? "Pass" : "Fail",
        population: profiles.length,
        evaluated: profiles.length,
        observedValue: { percent, baseline: Number(context.secureScoreBaseline), unownedActions: unowned.length },
        affectedResources: unowned.map(identity)
      };
    }));
  results.push(evaluate(domainId, "AFD-SEC-002", observations, context,
    ["safeLinksPolicies", "safeAttachmentPolicies", "antiPhishPolicies"], () => {
      const groups = ["safeLinksPolicies", "safeAttachmentPolicies", "antiPhishPolicies"];
      const covered = groups.map(key => evidenceItems(observations[key])
        .some(item => enabled(item) && field(item, "coversCopilotCohort") !== false));
      return {
        status: covered.every(Boolean) ? "Pass" : "Fail",
        population: 3,
        evaluated: 3,
        observedValue: { safeLinks: covered[0], safeAttachments: covered[1], antiPhish: covered[2] }
      };
    }));
  results.push(evaluate(domainId, "AFD-SEC-003", observations, context,
    ["cloudAppsOAuthApps", "cloudAppsAlerts"], () => {
      const apps = evidenceItems(observations.cloudAppsOAuthApps);
      const unreviewed = apps.filter(item =>
        ["high", "critical"].includes(String(field(item, "riskLevel", "risk") || "").toLowerCase()) &&
        field(item, "reviewed") !== true);
      const stale = staleAlerts(evidenceItems(observations.cloudAppsAlerts), context, 7);
      return {
        status: context.defenderCloudAppsConnected === true && !unreviewed.length && !stale.length ? "Pass" : "Fail",
        population: apps.length + stale.length,
        evaluated: apps.length + stale.length,
        observedValue: {
          connected: context.defenderCloudAppsConnected === true,
          unreviewedHighPrivilegeApps: unreviewed.length,
          staleHighAlerts: stale.length
        },
        affectedResources: [...unreviewed, ...stale].map(identity)
      };
    }));
  results.push(evaluate(domainId, "AFD-SEC-004", observations, context, ["incidents"], () => {
    const incidents = evidenceItems(observations.incidents);
    const now = Date.parse(context.observedAt || new Date().toISOString());
    const unsafe = incidents.filter(item => {
      const age = now - isoTime(field(item, "createdDateTime", "createdAt"));
      const high = ["high", "critical"].includes(String(field(item, "severity") || "").toLowerCase());
      const open = !["resolved", "closed"].includes(String(field(item, "status") || "").toLowerCase());
      return high && open && age > 24 * 3600000 && !field(item, "assignedTo", "owner");
    });
    const copilotUnowned = incidents.filter(item => /copilot/i.test(JSON.stringify(item)) &&
      !field(item, "assignedTo", "owner"));
    return {
      status: unsafe.length || copilotUnowned.length ? "Fail" : "Pass",
      population: incidents.length,
      evaluated: incidents.length,
      observedValue: { unassignedOldHighIncidents: unsafe.length, copilotWithoutResponder: copilotUnowned.length },
      affectedResources: [...unsafe, ...copilotUnowned].map(identity)
    };
  }));
  results.push(evaluate(domainId, "AFD-SEC-005", observations, context,
    ["defenderMachines", "vulnerabilities"], () => {
      const cohort = cohortIds(context);
      if (!cohort.size) throw new Error("A Copilot endpoint cohort is required.");
      const machines = evidenceItems(observations.defenderMachines);
      const onboarded = new Set(machines.filter(item =>
        ["onboarded", "active"].includes(String(field(item, "onboardingStatus", "healthStatus") || "").toLowerCase()))
        .flatMap(item => asArray(field(item, "userIds", "users", "loggedOnUsers")).map(value =>
          typeof value === "object" ? identity(value) : String(value))));
      const coverage = [...cohort].filter(id => onboarded.has(id)).length / cohort.size;
      const now = Date.parse(context.observedAt || new Date().toISOString());
      const critical = evidenceItems(observations.vulnerabilities).filter(item =>
        String(field(item, "severity") || "").toLowerCase() === "critical" &&
        field(item, "mitigated") !== true &&
        now - isoTime(field(item, "firstSeen", "publishedOn", "createdDateTime")) > 30 * 86400000);
      return {
        status: coverage >= 0.95 && !critical.length ? "Pass" : "Fail",
        population: cohort.size,
        evaluated: cohort.size,
        observedValue: { endpointCoverage: coverage, oldCriticalVulnerabilities: critical.length },
        affectedPrincipals: [...cohort].filter(id => !onboarded.has(id)),
        affectedResources: critical.map(identity)
      };
    }));
  results.push(evaluate(domainId, "AFD-SEC-006", observations, context,
    ["securityAlerts", "cloudAppPolicies"], () => {
      const policies = evidenceItems(observations.cloudAppPolicies);
      const required = ["unmanaged", "unusual ip", "oauth"];
      const configured = required.filter(term => policies.some(item =>
        enabled(item) && JSON.stringify(item).toLowerCase().includes(term)));
      const stale = staleAlerts(evidenceItems(observations.securityAlerts), context, 3);
      return {
        status: configured.length === required.length && !stale.length ? "Pass" : "Fail",
        population: policies.length + stale.length,
        evaluated: policies.length + stale.length,
        observedValue: { configuredDetections: configured, staleHighAlerts: stale.length },
        affectedResources: stale.map(identity)
      };
    }));
  return results.sort((a, b) => a.controlId.localeCompare(b.controlId));
}

function staleAlerts(alerts, context, days) {
  const now = Date.parse(context.observedAt || new Date().toISOString());
  return alerts.filter(item => {
    const age = now - isoTime(field(item, "createdDateTime", "createdAt", "timestamp"));
    return ["high", "critical"].includes(String(field(item, "severity") || "").toLowerCase()) &&
      !["resolved", "closed"].includes(String(field(item, "status") || "").toLowerCase()) &&
      age > days * 86400000;
  });
}

function exchangePlan(context) {
  const start = new Date(Date.parse(context.observedAt || new Date().toISOString()) - 7 * 86400000).toISOString();
  return [
    command("mailboxes", "exchangeOnline", "Get-EXOMailbox",
      { ResultSize: "Unlimited", Properties: ["ExternalDirectoryObjectId", "PrimarySmtpAddress", "RecipientTypeDetails"] }),
    command("hybridConfiguration", "exchangeOnline", "Get-HybridConfiguration"),
    command("organizationRelationships", "exchangeOnline", "Get-OrganizationRelationship"),
    command("remoteDomains", "exchangeOnline", "Get-RemoteDomain"),
    command("mailboxPermissions", "exchangeOnline", "Get-EXOMailboxPermission", { ResultSize: "Unlimited" }),
    command("recipientPermissions", "exchangeOnline", "Get-EXORecipientPermission", { ResultSize: "Unlimited" }),
    graph("directoryUsers", "https://graph.microsoft.com/v1.0/users?$select=id,userPrincipalName,accountEnabled&$top=999"),
    graph("outlookInventory",
      "https://graph.microsoft.com/beta/deviceManagement/detectedApps?$filter=contains(displayName,'Outlook')&$top=999"),
    command("transportRules", "exchangeOnline", "Get-TransportRule"),
    command("messageTrace", "exchangeOnline", "Get-MessageTraceV2", { StartDate: start, EndDate: context.observedAt })
  ];
}

function sharePointPlan() {
  return [
    graph("tenantSettings", "https://graph.microsoft.com/v1.0/admin/sharepoint/settings", false),
    graph("sites", "https://graph.microsoft.com/v1.0/sites?search=*&$select=id,name,webUrl&$top=999"),
    command("siteAccessReport", "sharePointOnline", "Get-SPODataAccessGovernanceInsight",
      { ReportType: "SitePermissions" }),
    command("dataAccessGovernance", "sharePointOnline", "Get-SPODataAccessGovernanceInsight",
      { ReportType: "OversharingBaseline" }),
    command("restrictedContent", "sharePointOnline", "Get-SPOSite",
      { Limit: "All", Detailed: true }),
    command("restrictedSearchMode", "sharePointOnline", "Get-SPOTenantRestrictedSearchMode"),
    command("restrictedSearchAllowedList", "sharePointOnline", "Get-SPOTenantRestrictedSearchAllowedList"),
    command("siteLifecycle", "sharePointOnline", "Get-SPOSite",
      { Limit: "All", Detailed: true }),
    command("oneDriveOverrides", "sharePointOnline", "Get-SPOSite",
      { IncludePersonalSite: true, Limit: "All", Detailed: true })
  ];
}

function purviewPlan(context) {
  const start = new Date(Date.parse(context.observedAt || new Date().toISOString()) - 24 * 3600000).toISOString();
  return [
    graph("sensitivityLabels",
      "https://graph.microsoft.com/beta/security/informationProtection/sensitivityLabels?$top=999"),
    command("labelPolicies", "purview", "Get-LabelPolicy"),
    command("autoLabelPolicies", "purview", "Get-AutoSensitivityLabelPolicy"),
    command("autoLabelReport", "purview", "Get-AutoSensitivityLabelPolicy",
      { IncludeSimulationResults: true }),
    command("dlpPolicies", "purview", "Get-DlpCompliancePolicy"),
    command("dlpRules", "purview", "Get-DlpComplianceRule"),
    command("auditConfiguration", "purview", "Get-AdminAuditLogConfig"),
    command("copilotAuditRecords", "purview", "Search-UnifiedAuditLog", {
      StartDate: start,
      EndDate: context.observedAt,
      RecordType: "CopilotInteraction",
      ResultSize: 5000
    }),
    command("retentionPolicies", "purview", "Get-RetentionCompliancePolicy"),
    command("retentionLabels", "purview", "Get-ComplianceTag"),
    command("ediscoveryCases", "purview", "Get-ComplianceCase"),
    command("caseHolds", "purview", "Get-CaseHoldPolicy"),
    command("insiderRiskPolicies", "purview", "Get-InsiderRiskPolicy"),
    command("communicationPolicies", "purview", "Get-SupervisoryReviewPolicyV2")
  ];
}

function securityPlan() {
  return [
    graph("secureScores", "https://graph.microsoft.com/v1.0/security/secureScores?$top=1"),
    graph("secureScoreProfiles", "https://graph.microsoft.com/v1.0/security/secureScoreControlProfiles?$top=999"),
    command("safeLinksPolicies", "exchangeOnline", "Get-SafeLinksPolicy"),
    command("safeAttachmentPolicies", "exchangeOnline", "Get-SafeAttachmentPolicy"),
    command("antiPhishPolicies", "exchangeOnline", "Get-AntiPhishPolicy"),
    graph("cloudAppsOAuthApps", "https://portal.cloudappsecurity.com/api/v1/oauthApps/"),
    graph("cloudAppsAlerts", "https://portal.cloudappsecurity.com/api/v1/alerts/"),
    graph("incidents", "https://graph.microsoft.com/v1.0/security/incidents?$top=100"),
    graph("defenderMachines", "https://api.securitycenter.microsoft.com/api/machines"),
    graph("vulnerabilities", "https://api.securitycenter.microsoft.com/api/vulnerabilities"),
    graph("securityAlerts", "https://graph.microsoft.com/v1.0/security/alerts_v2?$top=999"),
    graph("cloudAppPolicies", "https://portal.cloudappsecurity.com/api/v1/policies/")
  ];
}

function graph(key, url, collection = true) {
  return { key, adapter: "graph", url, collection, source: `GET ${url}` };
}

function command(key, service, name, parameters = {}) {
  return {
    key,
    adapter: "admin",
    service,
    command: name,
    parameters,
    source: `${service} PowerShell/admin: ${name}`
  };
}

function createCollector(domainId, dependencies, planFactory, normalizer) {
  const domain = domains.get(domainId);
  if (!domain) throw new Error(`Unknown governance domain '${domainId}'.`);
  const adapters = {
    graphRequest: dependencies.graphRequest || dependencies.request,
    adminCommand: dependencies.adminCommand || dependencies.command
  };
  const limits = {
    maxPages: dependencies.limits?.maxPages ?? DEFAULT_LIMITS.maxPages,
    maxItems: dependencies.limits?.maxItems ?? DEFAULT_LIMITS.maxItems
  };
  if (!Number.isInteger(limits.maxPages) || limits.maxPages < 1 ||
      !Number.isInteger(limits.maxItems) || limits.maxItems < 1) {
    throw new RangeError("Collector limits must be positive integers.");
  }
  return {
    id: `microsoft-365-${domainId.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`,
    version: VERSION,
    domainIds: [domainId],
    controlIds: domain.controls.map(control => control.id),
    requiredPermissions: [],
    requiredLicenses: [],
    capabilities: CAPABILITIES[domainId],
    maximumRequests: MAXIMUM_REQUESTS,
    async discoverCapabilities() {
      return {
        available: true,
        missingAdapters: [
          ...(typeof adapters.graphRequest === "function" ? [] : ["graphRequest"]),
          ...(typeof adapters.adminCommand === "function" ? [] : ["adminCommand"])
        ]
      };
    },
    async health({ signal }) {
      throwIfAborted(signal);
      return {
        healthy: true,
        reason: "Adapters are probed per read-only query so partial outages become Unknown evidence."
      };
    },
    async collect({ context, signal, budget }) {
      return executePlan(planFactory(context), adapters, budget, signal, limits);
    },
    async normalize({ observations, context, signal }) {
      throwIfAborted(signal);
      return normalizer({ observations, context });
    }
  };
}

function createExchangeOnlineCollector(dependencies = {}) {
  return createCollector("exchangeOnline", dependencies, exchangePlan, normalizeExchange);
}

function createSharePointOneDriveCollector(dependencies = {}) {
  return createCollector("sharePointOneDrive", dependencies, sharePointPlan, normalizeSharePoint);
}

function createPurviewComplianceCollector(dependencies = {}) {
  return createCollector("purviewCompliance", dependencies, purviewPlan, normalizePurview);
}

function createSecurityPostureCollector(dependencies = {}) {
  return createCollector("securityPosture", dependencies, securityPlan, normalizeSecurity);
}

function createGovernanceDomainCollectors(dependencies = {}) {
  return [
    createExchangeOnlineCollector(dependencies),
    createSharePointOneDriveCollector(dependencies),
    createPurviewComplianceCollector(dependencies),
    createSecurityPostureCollector(dependencies)
  ];
}

module.exports = {
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
};
