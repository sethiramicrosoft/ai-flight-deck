"use strict";

const catalog = require("../schema/readiness-catalog.v1.json");

const GRAPH = "https://graph.microsoft.com";
const VERSION = "1.0.0";
const MAX_ITEMS = 1000;
const MAX_PAGES = 20;
const TARGET_DOMAINS = [
  "identityAndAccess",
  "devicesAndApps",
  "serviceHealthOperations",
  "teamsReadiness",
  "copilotConfiguration"
];
const domains = new Map(catalog.domains
  .filter(domain => TARGET_DOMAINS.includes(domain.id))
  .map(domain => [domain.id, domain]));

const ENDPOINTS = Object.freeze({
  identityAndAccess: [
    `${GRAPH}/v1.0/policies/conditionalAccessPolicies`,
    `${GRAPH}/v1.0/policies/identitySecurityDefaultsEnforcementPolicy`,
    `${GRAPH}/beta/reports/authenticationMethods/userRegistrationDetails`,
    `${GRAPH}/beta/auditLogs/signIns`,
    `${GRAPH}/beta/identityProtection/riskyUsers`,
    `${GRAPH}/v1.0/roleManagement/directory/roleAssignments`,
    `${GRAPH}/v1.0/roleManagement/directory/roleDefinitions`,
    `${GRAPH}/beta/policies/roleManagementPolicyAssignments`,
    `${GRAPH}/beta/policies/roleManagementPolicies`,
    `${GRAPH}/v1.0/users`,
    `${GRAPH}/v1.0/groups`,
    `${GRAPH}/beta/identityGovernance/accessReviews/definitions`
  ],
  devicesAndApps: [
    `${GRAPH}/beta/deviceManagement/managedDevices`,
    `${GRAPH}/beta/deviceManagement/deviceConfigurations`,
    `${GRAPH}/beta/deviceManagement/deviceCompliancePolicies`,
    `${GRAPH}/beta/deviceAppManagement/managedAppPolicies`,
    `${GRAPH}/beta/deviceManagement/deviceEnrollmentConfigurations`,
    `${GRAPH}/beta/deviceManagement/detectedApps`,
    `${GRAPH}/v1.0/policies/conditionalAccessPolicies`,
    `${GRAPH}/v1.0/applications`
  ],
  serviceHealthOperations: [
    `${GRAPH}/v1.0/admin/serviceAnnouncement/issues`,
    `${GRAPH}/v1.0/admin/serviceAnnouncement/messages`
  ],
  teamsReadiness: [
    `${GRAPH}/v1.0/groups`,
    `${GRAPH}/v1.0/teams/{team-id}/channels`,
    `${GRAPH}/v1.0/groups/{team-id}/owners`,
    `${GRAPH}/v1.0/appCatalogs/teamsApps`,
    `${GRAPH}/beta/teamwork/teamsAppSettings`
  ],
  copilotConfiguration: [
    `${GRAPH}/v1.0/subscribedSkus`,
    `${GRAPH}/v1.0/external/connections`,
    `${GRAPH}/v1.0/appCatalogs/teamsApps`,
    `${GRAPH}/v1.0/applications`,
    `${GRAPH}/v1.0/servicePrincipals`,
    `${GRAPH}/beta/admin/microsoft365Apps/installationOptions`
  ]
});

function throwIfAborted(signal) {
  if (signal?.aborted) {
    const error = signal.reason || new Error("Collector cancelled.");
    if (!error.name) error.name = "AbortError";
    throw error;
  }
}

function isFatal(error, signal) {
  return signal?.aborted ||
    error?.name === "AbortError" ||
    error?.code === "COLLECTOR_REQUEST_BUDGET_EXCEEDED";
}

function errorInfo(error) {
  return {
    code: String(error?.code || error?.statusCode || error?.status || "GRAPH_REQUEST_FAILED"),
    message: String(error?.message || error)
  };
}

async function readGraph({ request, url, budget, signal, collection = true, limit = MAX_ITEMS }) {
  const values = [];
  let next = url;
  let pages = 0;
  try {
    while (next) {
      throwIfAborted(signal);
      if (pages >= MAX_PAGES || values.length >= limit) {
        return { ok: true, value: values.slice(0, limit), truncated: true };
      }
      budget.consume();
      const response = await request({
        url: next,
        method: "GET",
        headers: { Accept: "application/json" },
        signal
      });
      throwIfAborted(signal);
      if (!response || typeof response !== "object") {
        throw new Error(`Invalid Microsoft Graph response for '${url}'.`);
      }
      if (!collection) return { ok: true, value: response, truncated: false };
      if (!Array.isArray(response.value)) {
        throw new Error(`Invalid Microsoft Graph collection response for '${url}'.`);
      }
      values.push(...response.value.slice(0, Math.max(0, limit - values.length)));
      pages++;
      next = response["@odata.nextLink"] || null;
    }
    return { ok: true, value: values, truncated: false };
  } catch (error) {
    if (isFatal(error, signal)) throw error;
    return { ok: false, value: collection ? [] : null, error: errorInfo(error), truncated: false };
  }
}

function list(observation) {
  return observation?.ok && Array.isArray(observation.value) ? observation.value : [];
}

function limitation(code, description, endpoint) {
  return { code, description, ...(endpoint ? { endpoint } : {}) };
}

function endpointFailure(observation, description) {
  if (observation?.ok) return [];
  return [limitation(
    observation?.error?.code || "GRAPH_EVIDENCE_UNAVAILABLE",
    `${description}: ${observation?.error?.message || "Microsoft Graph returned no usable evidence."}`
  )];
}

function result(domainId, controlId, status, context, options = {}) {
  const domain = domains.get(domainId);
  const control = domain.controls.find(item => item.id === controlId);
  const observedAt = context.observedAt || new Date().toISOString();
  const complete = options.complete === true;
  return {
    controlId,
    controlVersion: catalog.catalogVersion,
    instanceId: `${context.tenantId}:${context.cohort?.id || "tenant-wide"}:${controlId}`,
    domainId,
    cohortId: context.cohort?.id || "tenant-wide",
    status,
    requirement: control.requirement,
    applicability: options.applicability || { applies: true, reason: control.applicability },
    observedValue: options.observedValue ?? null,
    expectedValue: control.passCondition,
    observedAt,
    freshUntil: new Date(Date.parse(observedAt) + control.freshnessHours * 3600000).toISOString(),
    coverage: {
      population: options.population ?? 0,
      evaluated: options.evaluated ?? 0,
      complete,
      excluded: options.excluded || 0,
      reason: options.coverageReason || ""
    },
    confidence: options.confidence ?? (complete ? 1 : 0),
    provenance: {
      collectorId: `microsoft-graph-${domainId.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`,
      collectorVersion: VERSION,
      collectorRunId: context.collectorRunId,
      tenantId: context.tenantId,
      actorId: context.actorId,
      source: options.source || "Microsoft Graph",
      sourceVersion: options.sourceVersion || "v1.0/beta",
      requestIds: []
    },
    evidenceRefs: options.evidenceRefs || [],
    affectedPrincipals: [...new Set(options.affectedPrincipals || [])].sort(),
    affectedResources: [...new Set(options.affectedResources || [])].sort(),
    owner: options.owner || null,
    remediation: {
      state: "NotPlanned",
      action: control.remediation,
      packageId: null
    },
    attestation: options.attestation || null,
    limitations: options.limitations || []
  };
}

function unknown(domainId, controlId, context, limitations, options = {}) {
  return result(domainId, controlId, "Unknown", context, {
    ...options,
    complete: false,
    confidence: 0,
    limitations: Array.isArray(limitations) ? limitations : [limitations]
  });
}

function enabled(policy) {
  return String(policy?.state || "").toLowerCase() === "enabled";
}

function includesAll(values) {
  return (values || []).some(value => String(value).toLowerCase() === "all");
}

function excludesId(values, id) {
  return (values || []).some(value => String(value).toLowerCase() === String(id).toLowerCase());
}

function targetsCohort(policy, context) {
  const users = policy?.conditions?.users || {};
  const cohortIds = context.cohort?.principalIds || [];
  const groupId = context.cohort?.groupId;
  if (includesAll(users.includeUsers)) return true;
  if (groupId && (users.includeGroups || []).includes(groupId)) return true;
  return cohortIds.length > 0 && cohortIds.every(id => (users.includeUsers || []).includes(id));
}

function targetsAllApps(policy) {
  const apps = policy?.conditions?.applications || {};
  return includesAll(apps.includeApplications);
}

function targetsCopilotApps(policy, context) {
  const included = policy?.conditions?.applications?.includeApplications || [];
  return targetsAllApps(policy) ||
    (context.copilotCloudAppIds || []).some(id => included.includes(id));
}

function normalizeIdentity(observations, context) {
  const domainId = "identityAndAccess";
  const policies = list(observations.conditionalAccess);
  const cohortIds = new Set(context.cohort?.principalIds || []);
  const registration = list(observations.authRegistration);
  const securityDefaults = observations.securityDefaults?.ok
    ? observations.securityDefaults.value?.isEnabled === true
    : false;
  const caLimit = endpointFailure(observations.conditionalAccess, "Conditional Access policies could not be read");
  const authLimit = endpointFailure(observations.authRegistration, "Authentication method registration could not be read");
  const securityDefaultsLimit = endpointFailure(observations.securityDefaults, "Security Defaults state could not be read");
  const results = [];

  const mfaPolicies = policies.filter(policy => enabled(policy) &&
    targetsCohort(policy, context) &&
    targetsAllApps(policy) &&
    (policy.grantControls?.builtInControls || []).some(value =>
      ["mfa", "authenticationstrength"].includes(String(value).toLowerCase())));
  if (caLimit.length || authLimit.length ||
      (securityDefaultsLimit.length && !mfaPolicies.length) ||
      (!securityDefaults && !context.cohort?.principalIds?.length)) {
    results.push(unknown(domainId, "AFD-IAM-001", context, [
      ...caLimit,
      ...authLimit,
      ...(mfaPolicies.length ? [] : securityDefaultsLimit),
      ...(!context.cohort?.principalIds?.length
        ? [limitation("COPILOT_COHORT_REQUIRED", "An approved Copilot cohort is required to establish user coverage.")]
        : [])
    ]));
  } else {
    const cohortRegistrations = registration.filter(item => cohortIds.has(item.id || item.userId));
    const unregistered = cohortRegistrations.filter(item =>
      item.isMfaRegistered !== true && item.isMfaCapable !== true);
    const registrationComplete = cohortRegistrations.length === cohortIds.size;
    results.push(result(domainId, "AFD-IAM-001",
      (securityDefaults || mfaPolicies.length > 0) && registrationComplete && !unregistered.length
        ? "Pass" : "Fail", context, {
        population: cohortIds.size,
        evaluated: cohortRegistrations.length,
        complete: registrationComplete,
        confidence: registrationComplete ? 1 : 0.6,
        observedValue: {
          securityDefaultsEnabled: securityDefaults,
          matchingConditionalAccessPolicies: mfaPolicies.map(item => item.id).sort(),
          mfaRegistered: cohortRegistrations.length - unregistered.length
        },
        affectedPrincipals: unregistered.map(item => item.id || item.userId)
      }));
  }

  const signInLimit = endpointFailure(observations.signIns, "Seven-day sign-in evidence could not be read");
  if (caLimit.length || signInLimit.length) {
    results.push(unknown(domainId, "AFD-IAM-002", context, [...caLimit, ...signInLimit]));
  } else {
    const blocking = policies.filter(policy => enabled(policy) &&
      includesAll(policy.conditions?.users?.includeUsers) &&
      (policy.conditions?.clientAppTypes || []).some(type =>
        ["exchangeactivesync", "other"].includes(String(type).toLowerCase())) &&
      String(policy.grantControls?.operator || "").toUpperCase() === "OR" &&
      (policy.grantControls?.builtInControls || []).some(value =>
        String(value).toLowerCase() === "block"));
    const legacySuccesses = list(observations.signIns).filter(signIn =>
      String(signIn.status?.errorCode ?? "") === "0" &&
      ["exchange activesync", "other clients", "imap", "pop", "smtp"].some(value =>
        String(signIn.clientAppUsed || "").toLowerCase().includes(value)));
    results.push(result(domainId, "AFD-IAM-002",
      blocking.length && !legacySuccesses.length ? "Pass" : "Fail", context, {
        population: list(observations.signIns).length,
        evaluated: list(observations.signIns).length,
        complete: !observations.signIns.truncated,
        observedValue: {
          blockingPolicies: blocking.map(item => item.id).sort(),
          successfulLegacySignIns: legacySuccesses.length
        },
        affectedPrincipals: legacySuccesses.map(item => item.userId).filter(Boolean)
      }));
  }

  if (caLimit.length || !context.cohort?.approved) {
    results.push(unknown(domainId, "AFD-IAM-003", context, [
      ...caLimit,
      ...(!context.cohort?.approved
        ? [limitation("APPROVED_COHORT_REQUIRED", "Conditional Access scope cannot be verified without an approved cohort.")]
        : [])
    ]));
  } else {
    const matching = policies.filter(policy => enabled(policy) &&
      targetsCohort(policy, context) &&
      targetsCopilotApps(policy, context) &&
      (policy.grantControls?.builtInControls || []).some(value =>
        ["mfa", "compliantdevice", "domainjoineddevice", "authenticationstrength"]
          .includes(String(value).toLowerCase())));
    results.push(result(domainId, "AFD-IAM-003", matching.length ? "Pass" : "Fail", context, {
      population: policies.length,
      evaluated: policies.length,
      complete: true,
      observedValue: { matchingPolicies: matching.map(item => item.id).sort() }
    }));
  }

  const riskLimit = endpointFailure(observations.riskyUsers, "Risky-user evidence could not be read");
  if (caLimit.length || riskLimit.length) {
    results.push(unknown(domainId, "AFD-IAM-004", context, [...caLimit, ...riskLimit]));
  } else {
    const riskPolicies = policies.filter(policy => enabled(policy) &&
      (policy.conditions?.signInRiskLevels?.length || policy.conditions?.userRiskLevels?.length));
    const outstanding = list(observations.riskyUsers).filter(user =>
      cohortIds.has(user.id) &&
      !["remediated", "dismissed"].includes(String(user.riskState || "").toLowerCase()));
    results.push(result(domainId, "AFD-IAM-004",
      riskPolicies.length && !outstanding.length ? "Pass" : "Fail", context, {
        population: cohortIds.size,
        evaluated: cohortIds.size,
        complete: true,
        observedValue: {
          riskPolicies: riskPolicies.map(item => item.id).sort(),
          outstandingRiskyUsers: outstanding.length
        },
        affectedPrincipals: outstanding.map(item => item.id)
      }));
  }

  const guestLimit = [
    ...endpointFailure(observations.guests, "Guest users could not be read"),
    ...endpointFailure(observations.groups, "Groups could not be read"),
    ...endpointFailure(observations.accessReviews, "Access review definitions could not be read"),
    ...(observations.groundingGroupMembers || [])
      .filter(item => !item.ok)
      .map(item => limitation(item.error.code,
        `Members of Copilot-integrated group '${item.groupId}' could not be read: ${item.error.message}`))
  ];
  const integratedGroupIds = context.copilotIntegratedGroupIds;
  if (guestLimit.length || !Array.isArray(integratedGroupIds)) {
    results.push(unknown(domainId, "AFD-IAM-005", context, [
      ...guestLimit,
      ...(!Array.isArray(integratedGroupIds)
        ? [limitation("GROUNDING_SCOPE_REQUIRED", "Provide copilotIntegratedGroupIds to identify guest-bearing Copilot workspaces.")]
        : [])
    ], {
      observedValue: {
        guestCount: list(observations.guests).length,
        accessReviewCount: list(observations.accessReviews).length
      }
    }));
  } else {
    const groups = list(observations.groups).filter(group => integratedGroupIds.includes(group.id));
    const reviews = list(observations.accessReviews).filter(review =>
      integratedGroupIds.some(id => JSON.stringify(review.scope || {}).includes(id)) &&
      String(review.status || "").toLowerCase() !== "completed");
    const guestIds = new Set(list(observations.guests).map(guest => guest.id));
    const guestBearingGroups = (observations.groundingGroupMembers || [])
      .filter(item => item.members.some(member => guestIds.has(member.id)))
      .map(item => item.groupId);
    const nonGoverned = groups.filter(group =>
      guestBearingGroups.includes(group.id) &&
      (!(group.assignedLabels || []).length ||
        !reviews.some(review => JSON.stringify(review.scope || {}).includes(group.id))));
    results.push(result(domainId, "AFD-IAM-005", nonGoverned.length ? "Fail" : "Pass", context, {
      population: groups.length,
      evaluated: groups.length,
      complete: groups.length === integratedGroupIds.length,
      observedValue: {
        integratedGroups: groups.length,
        guestBearingGroups: guestBearingGroups.length,
        activeAccessReviews: reviews.length
      },
      affectedResources: nonGoverned.map(group => group.id)
    }));
  }

  const roleLimit = [
    ...endpointFailure(observations.roleAssignments, "Directory role assignments could not be read"),
    ...endpointFailure(observations.roleDefinitions, "Directory role definitions could not be read"),
    ...endpointFailure(observations.rolePolicyAssignments, "Privileged role policy assignments could not be read"),
    ...endpointFailure(observations.rolePolicies, "Privileged role policies could not be read")
  ];
  if (roleLimit.length) {
    results.push(unknown(domainId, "AFD-IAM-006", context, roleLimit));
  } else {
    const definitions = new Map(list(observations.roleDefinitions).map(item => [item.id, item]));
    const breakGlassIds = new Set(context.breakGlassAccountIds || []);
    const permanentGlobalAdmins = list(observations.roleAssignments).filter(assignment => {
      const definition = definitions.get(assignment.roleDefinitionId);
      return String(definition?.displayName || "").toLowerCase() === "global administrator" &&
        !breakGlassIds.has(assignment.principalId);
    });
    const assignedPolicyIds = new Set(list(observations.rolePolicyAssignments)
      .map(item => item.policyId)
      .filter(Boolean));
    const assignedPolicies = list(observations.rolePolicies)
      .filter(policy => assignedPolicyIds.has(policy.id));
    const policyText = JSON.stringify(assignedPolicies).toLowerCase();
    const pimControlsObserved = policyText.includes("multifactorauthentication") &&
      policyText.includes("approval");
    results.push(result(domainId, "AFD-IAM-006",
      !permanentGlobalAdmins.length && pimControlsObserved ? "Pass" : "Fail", context, {
        population: list(observations.roleAssignments).length,
        evaluated: list(observations.roleAssignments).length,
        complete: true,
        observedValue: {
          permanentGlobalAdministratorsOutsideBreakGlass: permanentGlobalAdmins.length,
          pimMfaAndApprovalObserved: pimControlsObserved
        },
        affectedPrincipals: permanentGlobalAdmins.map(item => item.principalId)
      }));
  }

  const breakGlass = context.breakGlassAccounts;
  if (!Array.isArray(breakGlass) || !breakGlass.length || caLimit.length) {
    results.push(unknown(domainId, "AFD-IAM-007", context, [
      ...caLimit,
      ...(!Array.isArray(breakGlass) || !breakGlass.length
        ? [limitation("BREAK_GLASS_ATTESTATION_REQUIRED", "Graph does not identify which accounts are approved break-glass accounts or prove monitoring ownership.")]
        : [])
    ]));
  } else {
    const excluded = breakGlass.filter(account => policies.every(policy =>
      !enabled(policy) || excludesId(policy.conditions?.users?.excludeUsers, account.id)));
    const monitored = breakGlass.filter(account => account.owner && account.monitoringAlert === true);
    results.push(result(domainId, "AFD-IAM-007",
      excluded.length === breakGlass.length && monitored.length === breakGlass.length ? "Pass" : "Fail",
      context, {
        population: breakGlass.length,
        evaluated: breakGlass.length,
        complete: true,
        source: "Microsoft Graph and approved break-glass account evidence",
        observedValue: { documented: breakGlass.length, caExcluded: excluded.length, monitored: monitored.length },
        affectedPrincipals: breakGlass
          .filter(account => !excluded.includes(account) || !monitored.includes(account))
          .map(account => account.id)
      }));
  }
  return results.sort((a, b) => a.controlId.localeCompare(b.controlId));
}

function cohortDevices(observations, context) {
  const ids = new Set(context.cohort?.principalIds || []);
  return list(observations.managedDevices).filter(device => ids.has(device.userId));
}

function normalizeDevices(observations, context) {
  const domainId = "devicesAndApps";
  const devices = cohortDevices(observations, context);
  const deviceLimit = endpointFailure(observations.managedDevices, "Managed devices could not be read");
  const results = [];

  if (deviceLimit.length || !context.cohort?.principalIds?.length) {
    results.push(unknown(domainId, "AFD-DEV-001", context, [
      ...deviceLimit,
      ...(!context.cohort?.principalIds?.length
        ? [limitation("COPILOT_COHORT_REQUIRED", "A Copilot cohort is required to scope client readiness.")]
        : [])
    ]));
  } else {
    const appEvidence = context.microsoft365AppInstallations;
    if (!Array.isArray(appEvidence)) {
      results.push(unknown(domainId, "AFD-DEV-001", context,
        limitation("CLIENT_BUILD_EVIDENCE_REQUIRED", "Intune detectedApps does not reliably map Microsoft 365 Apps channel and build to the primary Copilot user; provide mapped installation evidence."), {
          observedValue: { detectedAppCount: list(observations.detectedApps).length }
        }));
    } else {
      const supported = appEvidence.filter(item =>
        ["Current", "MonthlyEnterprise"].includes(item.channel) && item.supportedBuild === true);
      const ratio = appEvidence.length ? supported.length / appEvidence.length : 0;
      results.push(result(domainId, "AFD-DEV-001", ratio >= 0.95 ? "Pass" : "Fail", context, {
        population: appEvidence.length,
        evaluated: appEvidence.length,
        complete: true,
        source: "Microsoft Graph and mapped Microsoft 365 Apps installation evidence",
        observedValue: { supported: supported.length, ratio }
      }));
    }
  }

  if (deviceLimit.length || !context.cohort?.principalIds?.length || !devices.length) {
    results.push(unknown(domainId, "AFD-DEV-002", context, [
      ...deviceLimit,
      ...(!context.cohort?.principalIds?.length
        ? [limitation("COPILOT_COHORT_REQUIRED", "A Copilot cohort is required to scope primary user devices.")]
        : []),
      ...(context.cohort?.principalIds?.length && !devices.length
        ? [limitation("NO_PRIMARY_DEVICE_EVIDENCE", "No Intune primary-user devices were returned for the Copilot cohort.")]
        : [])
    ]));
  } else {
    const compliant = devices.filter(device =>
      String(device.managementAgent || "").toLowerCase() !== "unknown" &&
      String(device.complianceState || "").toLowerCase() === "compliant");
    const ratio = devices.length ? compliant.length / devices.length : 0;
    results.push(result(domainId, "AFD-DEV-002", ratio >= 0.95 ? "Pass" : "Fail", context, {
      population: devices.length,
      evaluated: devices.length,
      complete: !observations.managedDevices.truncated,
      observedValue: { managedAndCompliant: compliant.length, ratio },
      affectedResources: devices.filter(item => !compliant.includes(item)).map(item => item.id)
    }));
  }

  const configLimit = endpointFailure(observations.deviceConfigurations, "Device configurations could not be read");
  if (deviceLimit.length || configLimit.length || !devices.length) {
    results.push(unknown(domainId, "AFD-DEV-003", context, [
      ...deviceLimit,
      ...configLimit,
      ...(!devices.length ? [limitation("NO_COHORT_WINDOWS_DEVICES", "No cohort devices were available for Windows update posture evaluation.")] : [])
    ]));
  } else {
    const windows = devices.filter(device => String(device.operatingSystem || "").toLowerCase() === "windows");
    const supported = windows.filter(device =>
      String(device.osVersion || "").startsWith("10.0.") && device.isEncrypted !== false);
    const updatePolicies = list(observations.deviceConfigurations).filter(policy =>
      /update|feature/i.test(`${policy["@odata.type"] || ""} ${policy.displayName || ""}`));
    if (!context.deviceConfigurationAssignments) {
      results.push(unknown(domainId, "AFD-DEV-003", context,
        limitation("POLICY_ASSIGNMENT_EVIDENCE_REQUIRED", "Update policies were inventoried, but Graph configuration inventory alone does not prove assignment to every cohort device."), {
          observedValue: { windowsDevices: windows.length, supportedBuilds: supported.length, updatePolicies: updatePolicies.length }
        }));
    } else {
      const targeted = new Set(context.deviceConfigurationAssignments);
      const covered = windows.filter(device => targeted.has(device.id));
      const passing = windows.filter(device => supported.includes(device) && covered.includes(device));
      const ratio = windows.length ? passing.length / windows.length : 1;
      results.push(result(domainId, "AFD-DEV-003", ratio >= 0.95 ? "Pass" : "Fail", context, {
        population: windows.length,
        evaluated: windows.length,
        complete: true,
        source: "Microsoft Graph and approved device configuration assignment evidence",
        observedValue: { supportedAndTargeted: passing.length, ratio }
      }));
    }
  }

  const appPolicyLimit = endpointFailure(observations.managedAppPolicies, "Managed app protection policies could not be read");
  const caLimit = endpointFailure(observations.conditionalAccess, "Conditional Access policies could not be read");
  if (appPolicyLimit.length || caLimit.length) {
    results.push(unknown(domainId, "AFD-DEV-004", context, [...appPolicyLimit, ...caLimit]));
  } else {
    const protectivePolicies = list(observations.managedAppPolicies).filter(policy => {
      const text = JSON.stringify(policy).toLowerCase();
      return text.includes("encrypt") && (text.includes("cut") || text.includes("paste"));
    });
    const unmanagedBlock = list(observations.conditionalAccess).some(policy =>
      enabled(policy) &&
      (policy.conditions?.platforms?.includePlatforms || []).some(value =>
        ["android", "ios"].includes(String(value).toLowerCase())) &&
      (policy.grantControls?.builtInControls || []).some(value =>
        ["block", "approvedapplication", "compliantapplication"].includes(String(value).toLowerCase())));
    if (!protectivePolicies.length && !unmanagedBlock) {
      results.push(result(domainId, "AFD-DEV-004", "Fail", context, {
        population: devices.length,
        evaluated: devices.length,
        complete: true,
        observedValue: { protectiveAppPolicies: 0, unmanagedMobileAccessBlocked: false }
      }));
    } else {
      results.push(result(domainId, "AFD-DEV-004", "Pass", context, {
        population: devices.length,
        evaluated: devices.length,
        complete: true,
        observedValue: { protectiveAppPolicies: protectivePolicies.length, unmanagedMobileAccessBlocked: unmanagedBlock }
      }));
    }
  }

  if (!context.byodPolicy || caLimit.length || !observations.enrollmentConfigurations?.ok) {
    results.push(unknown(domainId, "AFD-DEV-005", context, [
      ...caLimit,
      ...endpointFailure(observations.enrollmentConfigurations, "Enrollment restrictions could not be read"),
      ...(!context.byodPolicy
        ? [limitation("BYOD_POLICY_ATTESTATION_REQUIRED", "Graph cannot prove the documented BYOD statement and accountable owner; provide approved byodPolicy evidence.")]
        : [])
    ]));
  } else {
    const policy = context.byodPolicy;
    const aligned = policy.owner && policy.reviewedAt && policy.controlsMatchObservedConfiguration === true;
    results.push(result(domainId, "AFD-DEV-005", aligned ? "Pass" : "Fail", context, {
      population: 1,
      evaluated: 1,
      complete: true,
      source: "Microsoft Graph and approved BYOD policy evidence",
      owner: policy.owner || null,
      observedValue: {
        ownerPresent: Boolean(policy.owner),
        reviewedAt: policy.reviewedAt || null,
        controlsMatchObservedConfiguration: policy.controlsMatchObservedConfiguration === true
      }
    }));
  }

  results.push(unknown(domainId, "AFD-DEV-006", context,
    limitation("PLUGIN_ALLOW_LIST_NOT_EXPOSED", "Microsoft Graph application inventory does not expose the complete Cloud Policy or integrated-app allow-list and unmanaged-install block state."), {
      observedValue: { applicationCount: list(observations.applications).length }
    }));
  return results.sort((a, b) => a.controlId.localeCompare(b.controlId));
}

function normalizeOperations(observations, context) {
  const domainId = "serviceHealthOperations";
  const issuesLimit = endpointFailure(observations.issues, "Service health issues could not be read");
  const messageLimit = endpointFailure(observations.messages, "Message center posts could not be read");
  const issues = list(observations.issues);
  const messages = list(observations.messages);
  const activeBlocking = issues.filter(issue => {
    const text = `${issue.service || ""} ${issue.title || ""}`.toLowerCase();
    const status = String(issue.status || "").toLowerCase();
    const classification = String(issue.classification || "").toLowerCase();
    const active = ![
      "serviceoperational",
      "servicerestored",
      "resolved",
      "falsepositive",
      "postincidentreviewpublished"
    ].includes(status);
    const blocking = classification === "incident" ||
      ["servicedegradation", "serviceinterruption"].includes(status);
    const prerequisite = [
      "copilot",
      "teams",
      "sharepoint",
      "onedrive",
      "exchange online",
      "microsoft 365 suite"
    ].some(term => text.includes(term));
    return active && blocking && prerequisite;
  });
  const results = [];
  results.push(issuesLimit.length
    ? unknown(domainId, "AFD-OPS-001", context, issuesLimit)
    : result(domainId, "AFD-OPS-001", activeBlocking.length ? "Fail" : "Pass", context, {
      population: issues.length,
      evaluated: issues.length,
      complete: !observations.issues.truncated,
      observedValue: { activeBlockingIssues: activeBlocking.length },
      affectedResources: activeBlocking.map(item => item.id)
    }));

  const actionRequired = messages.filter(message => {
    const text = `${message.actionRequiredByDateTime || ""} ${(message.tags || []).join(" ")} ${message.title || ""}`;
    return Boolean(message.actionRequiredByDateTime) || /action required/i.test(text);
  });
  if (messageLimit.length || !Array.isArray(context.messageCenterActions)) {
    results.push(unknown(domainId, "AFD-OPS-002", context, [
      ...messageLimit,
      ...(!Array.isArray(context.messageCenterActions)
        ? [limitation("MESSAGE_OWNERSHIP_EVIDENCE_REQUIRED", "Message Center exposes advisories but not the tenant's owner and triage status; provide messageCenterActions evidence.")]
        : [])
    ], { observedValue: { actionRequiredPosts: actionRequired.length } }));
  } else {
    const actions = new Map(context.messageCenterActions.map(item => [item.messageId, item]));
    const overdue = actionRequired.filter(message => {
      const action = actions.get(message.id);
      return !action?.owner || !action?.status ||
        (message.actionRequiredByDateTime &&
          Date.parse(message.actionRequiredByDateTime) < Date.parse(context.observedAt || new Date()) &&
          !["complete", "closed"].includes(String(action.status).toLowerCase()));
    });
    results.push(result(domainId, "AFD-OPS-002", overdue.length ? "Fail" : "Pass", context, {
      population: actionRequired.length,
      evaluated: actionRequired.length,
      complete: true,
      source: "Microsoft Graph and approved Message Center action register",
      observedValue: { actionRequiredPosts: actionRequired.length, overdueOrUnowned: overdue.length },
      affectedResources: overdue.map(item => item.id)
    }));
  }

  if (issuesLimit.length || (activeBlocking.length && !Array.isArray(context.serviceHealthOwners))) {
    results.push(unknown(domainId, "AFD-OPS-003", context, [
      ...issuesLimit,
      ...(activeBlocking.length && !Array.isArray(context.serviceHealthOwners)
        ? [limitation("SERVICE_HEALTH_OWNER_EVIDENCE_REQUIRED", "Active service issues were observed, but Microsoft Graph does not expose the tenant's assigned incident owner.")]
        : [])
    ]));
  } else {
    const unowned = activeBlocking.filter(issue =>
      !(context.serviceHealthOwners || []).some(owner => owner.issueId === issue.id && owner.owner));
    results.push(result(domainId, "AFD-OPS-003",
      activeBlocking.length ? (unowned.length ? "Fail" : "Warning") : "Pass", context, {
        population: issues.length,
        evaluated: issues.length,
        complete: true,
        observedValue: { reviewedAt: context.observedAt || null, activeWarnings: activeBlocking.length, unowned: unowned.length },
        affectedResources: unowned.map(item => item.id)
      }));
  }

  const advisoryReview = context.copilotAdvisoryReview;
  if (!advisoryReview?.reviewedAt || !advisoryReview?.owner) {
    results.push(unknown(domainId, "AFD-OPS-004", context,
      limitation("ADVISORY_REVIEW_ATTESTATION_REQUIRED", "Graph cannot prove that an operations lead reviewed Copilot advisories or updated affected catalogue controls.")));
  } else {
    const age = Date.parse(context.observedAt || new Date()) - Date.parse(advisoryReview.reviewedAt);
    results.push(result(domainId, "AFD-OPS-004",
      age <= 7 * 86400000 && advisoryReview.catalogueUpdated !== false ? "Pass" : "Fail", context, {
        population: 1, evaluated: 1, complete: true,
        source: "Approved Copilot advisory review evidence",
        owner: advisoryReview.owner,
        observedValue: advisoryReview
      }));
  }

  const contacts = context.operationalEscalationContacts;
  if (!Array.isArray(contacts) || !contacts.length) {
    results.push(unknown(domainId, "AFD-OPS-005", context,
      limitation("ESCALATION_CONTACT_ATTESTATION_REQUIRED", "Operational escalation contacts and their review dates are not available from Microsoft Graph service announcements.")));
  } else {
    const cutoff = Date.parse(context.observedAt || new Date()) - 30 * 86400000;
    const current = contacts.filter(item => item.tenantId === context.tenantId &&
      item.technicalContact && item.executiveContact && Date.parse(item.reviewedAt) >= cutoff);
    results.push(result(domainId, "AFD-OPS-005",
      current.length === contacts.length ? "Pass" : "Fail", context, {
        population: contacts.length, evaluated: contacts.length, complete: true,
        source: "Approved operational escalation contact register",
        observedValue: { current: current.length, total: contacts.length }
      }));
  }
  return results.sort((a, b) => a.controlId.localeCompare(b.controlId));
}

function normalizeTeams(observations, context) {
  const domainId = "teamsReadiness";
  const results = [];
  const policyLimitation = limitation(
    "TEAMS_POLICY_API_UNAVAILABLE",
    "Microsoft Graph does not expose effective Teams meeting, recording, external-access, Copilot, app permission, or app setup policy assignments."
  );
  for (const controlId of ["AFD-TEAMS-001", "AFD-TEAMS-002", "AFD-TEAMS-004", "AFD-TEAMS-005", "AFD-TEAMS-006"]) {
    const evidence = context.teamsPolicyEvidence?.[controlId];
    if (!evidence || evidence.complete !== true) {
      results.push(unknown(domainId, controlId, context, policyLimitation, {
        observedValue: controlId === "AFD-TEAMS-006"
          ? { teamsAppCatalogCount: list(observations.teamsApps).length }
          : null
      }));
    } else {
      results.push(result(domainId, controlId, evidence.compliant === true ? "Pass" : "Fail", context, {
        population: evidence.population || 1,
        evaluated: evidence.evaluated || evidence.population || 1,
        complete: true,
        source: "Approved Teams policy export",
        owner: evidence.owner || null,
        observedValue: evidence.observedValue || evidence
      }));
    }
  }

  const teamsLimit = endpointFailure(observations.teams, "Teams-backed Microsoft 365 groups could not be read");
  const detailFailures = (observations.teamDetails || []).filter(item => !item.ok);
  if (teamsLimit.length || detailFailures.length) {
    results.push(unknown(domainId, "AFD-TEAMS-003", context, [
      ...teamsLimit,
      ...detailFailures.slice(0, 10).map(item =>
        limitation(item.error.code, `Team '${item.teamId}' inventory failed: ${item.error.message}`))
    ], { observedValue: { teamsDiscovered: list(observations.teams).length } }));
  } else {
    const teams = list(observations.teams);
    const details = new Map((observations.teamDetails || []).map(item => [item.teamId, item]));
    const deficient = teams.filter(team => {
      const detail = details.get(team.id);
      return !detail || !detail.owners.length || !(team.assignedLabels || []).length;
    });
    results.push(result(domainId, "AFD-TEAMS-003", deficient.length ? "Fail" : "Pass", context, {
      population: teams.length,
      evaluated: teams.length,
      complete: !observations.teams.truncated,
      observedValue: {
        teams: teams.length,
        privateChannels: [...details.values()].reduce((sum, item) =>
          sum + item.channels.filter(channel => String(channel.membershipType).toLowerCase() === "private").length, 0),
        deficientTeams: deficient.length
      },
      affectedResources: deficient.map(team => team.id)
    }));
  }
  return results.sort((a, b) => a.controlId.localeCompare(b.controlId));
}

function isCopilotSku(sku) {
  return /copilot/i.test(String(sku.skuPartNumber || "")) ||
    (sku.servicePlans || []).some(plan => /copilot/i.test(String(plan.servicePlanName || "")));
}

function normalizeCopilot(observations, context) {
  const domainId = "copilotConfiguration";
  const results = [];
  const settingsLimit = limitation(
    "COPILOT_TENANT_SETTINGS_NOT_EXPOSED",
    "Microsoft Graph does not expose authoritative Microsoft 365 Copilot grounding, web query, feedback, prompt telemetry, or Cloud Policy settings."
  );
  const skus = list(observations.skus).filter(isCopilotSku);
  const settingsEvidence = context.copilotSettingsEvidence || {};
  for (const controlId of ["AFD-COPILOT-001", "AFD-COPILOT-002", "AFD-COPILOT-005", "AFD-COPILOT-006"]) {
    const evidence = settingsEvidence[controlId];
    if (!evidence || evidence.complete !== true) {
      results.push(unknown(domainId, controlId, context, [
        ...endpointFailure(observations.skus, "Subscribed SKU inventory could not be read"),
        settingsLimit
      ], { observedValue: { copilotSkuCount: skus.length } }));
    } else {
      results.push(result(domainId, controlId, evidence.compliant === true ? "Pass" : "Fail", context, {
        population: evidence.population || 1,
        evaluated: evidence.evaluated || evidence.population || 1,
        complete: true,
        source: "Microsoft Graph and approved Copilot configuration evidence",
        owner: evidence.owner || null,
        observedValue: evidence.observedValue || evidence
      }));
    }
  }

  const connectionLimit = endpointFailure(observations.externalConnections, "External connections could not be read");
  if (connectionLimit.length) {
    results.push(unknown(domainId, "AFD-COPILOT-003", context, connectionLimit));
  } else {
    const connections = list(observations.externalConnections);
    if (!connections.length) {
      results.push(result(domainId, "AFD-COPILOT-003", "Pass", context, {
        population: 0, evaluated: 0, complete: true,
        observedValue: { externalConnections: [] }
      }));
    } else {
      const governance = context.externalConnectionGovernance;
      if (!Array.isArray(governance)) {
        results.push(unknown(domainId, "AFD-COPILOT-003", context,
          limitation("CONNECTOR_GOVERNANCE_EVIDENCE_REQUIRED", "Graph inventories external connections but does not prove owner, approved grounding scope, or 24-hour ingestion health."), {
            observedValue: {
              externalConnections: connections.map(item => ({ id: item.id, name: item.name })).sort((a, b) => a.id.localeCompare(b.id))
            }
          }));
      } else {
        const records = new Map(governance.map(item => [item.connectionId, item]));
        const failing = connections.filter(connection => {
          const record = records.get(connection.id);
          return !record?.owner || record.permissionsAligned !== true || record.ingestionHealthy !== true;
        });
        results.push(result(domainId, "AFD-COPILOT-003", failing.length ? "Fail" : "Pass", context, {
          population: connections.length, evaluated: connections.length, complete: true,
          source: "Microsoft Graph and approved external connection governance evidence",
          observedValue: { externalConnections: connections.length, failing: failing.length },
          affectedResources: failing.map(item => item.id)
        }));
      }
    }
  }

  const appLimits = [
    ...endpointFailure(observations.teamsApps, "Teams app catalogue could not be read"),
    ...endpointFailure(observations.applications, "Application registrations could not be read"),
    ...endpointFailure(observations.servicePrincipals, "Enterprise applications could not be read")
  ];
  const inventory = context.copilotPluginInventory;
  if (appLimits.length || !Array.isArray(inventory)) {
    results.push(unknown(domainId, "AFD-COPILOT-004", context, [
      ...appLimits,
      ...(!Array.isArray(inventory)
        ? [limitation("PLUGIN_CLASSIFICATION_REQUIRED", "Graph app inventories do not identify the complete set of Copilot plugins and message extensions available to the cohort or their owners.")]
        : [])
    ], {
      observedValue: {
        teamsApps: list(observations.teamsApps).length,
        applications: list(observations.applications).length,
        servicePrincipals: list(observations.servicePrincipals).length
      }
    }));
  } else {
    const cutoff = Date.parse(context.observedAt || new Date()) - 30 * 86400000;
    const stale = inventory.filter(item => !item.approved || !item.owner || Date.parse(item.lastReviewedAt) < cutoff);
    results.push(result(domainId, "AFD-COPILOT-004", stale.length ? "Fail" : "Pass", context, {
      population: inventory.length, evaluated: inventory.length, complete: true,
      source: "Microsoft Graph and approved Copilot plugin inventory",
      observedValue: { plugins: inventory.length, staleOrUnapproved: stale.length },
      affectedResources: stale.map(item => item.id)
    }));
  }
  return results.sort((a, b) => a.controlId.localeCompare(b.controlId));
}

async function collectIdentity(request, args) {
  const { budget, signal, context } = args;
  const since = new Date(Date.parse(context.observedAt || new Date()) - 7 * 86400000).toISOString();
  const observations = {
    conditionalAccess: await readGraph({ request, budget, signal, url: `${GRAPH}/v1.0/policies/conditionalAccessPolicies?$top=100` }),
    securityDefaults: await readGraph({ request, budget, signal, collection: false, url: `${GRAPH}/v1.0/policies/identitySecurityDefaultsEnforcementPolicy` }),
    authRegistration: await readGraph({ request, budget, signal, url: `${GRAPH}/beta/reports/authenticationMethods/userRegistrationDetails?$top=999` }),
    signIns: await readGraph({ request, budget, signal, url: `${GRAPH}/beta/auditLogs/signIns?$filter=createdDateTime%20ge%20${encodeURIComponent(since)}&$select=id,userId,createdDateTime,clientAppUsed,status&$top=999` }),
    riskyUsers: await readGraph({ request, budget, signal, url: `${GRAPH}/beta/identityProtection/riskyUsers?$top=500` }),
    roleAssignments: await readGraph({ request, budget, signal, url: `${GRAPH}/v1.0/roleManagement/directory/roleAssignments?$top=999` }),
    roleDefinitions: await readGraph({ request, budget, signal, url: `${GRAPH}/v1.0/roleManagement/directory/roleDefinitions` }),
    rolePolicyAssignments: await readGraph({ request, budget, signal, url: `${GRAPH}/beta/policies/roleManagementPolicyAssignments?$filter=scopeType%20eq%20'DirectoryRole'&$top=999` }),
    rolePolicies: await readGraph({ request, budget, signal, url: `${GRAPH}/beta/policies/roleManagementPolicies?$top=999&$expand=rules` }),
    guests: await readGraph({ request, budget, signal, url: `${GRAPH}/v1.0/users?$filter=userType%20eq%20'Guest'&$select=id,displayName,userPrincipalName,accountEnabled&$top=999` }),
    groups: await readGraph({ request, budget, signal, url: `${GRAPH}/v1.0/groups?$select=id,displayName,assignedLabels,visibility&$top=999` }),
    accessReviews: await readGraph({ request, budget, signal, url: `${GRAPH}/beta/identityGovernance/accessReviews/definitions?$top=100` })
  };
  observations.groundingGroupMembers = [];
  for (const groupId of (context.copilotIntegratedGroupIds || []).slice(0, 100)) {
    const members = await readGraph({
      request, budget, signal,
      url: `${GRAPH}/v1.0/groups/${encodeURIComponent(groupId)}/transitiveMembers?$select=id&$top=999`
    });
    observations.groundingGroupMembers.push({
      ok: members.ok,
      groupId,
      members: members.value,
      error: members.error
    });
  }
  return observations;
}

async function collectDevices(request, { budget, signal }) {
  return {
    managedDevices: await readGraph({ request, budget, signal, url: `${GRAPH}/beta/deviceManagement/managedDevices?$select=id,userId,deviceName,operatingSystem,osVersion,complianceState,managementAgent,isEncrypted,lastSyncDateTime&$top=999` }),
    deviceConfigurations: await readGraph({ request, budget, signal, url: `${GRAPH}/beta/deviceManagement/deviceConfigurations?$top=999` }),
    compliancePolicies: await readGraph({ request, budget, signal, url: `${GRAPH}/beta/deviceManagement/deviceCompliancePolicies?$top=999` }),
    managedAppPolicies: await readGraph({ request, budget, signal, url: `${GRAPH}/beta/deviceAppManagement/managedAppPolicies?$top=999` }),
    enrollmentConfigurations: await readGraph({ request, budget, signal, url: `${GRAPH}/beta/deviceManagement/deviceEnrollmentConfigurations?$top=999` }),
    detectedApps: await readGraph({ request, budget, signal, url: `${GRAPH}/beta/deviceManagement/detectedApps?$select=id,displayName,version,platform,deviceCount&$top=999` }),
    conditionalAccess: await readGraph({ request, budget, signal, url: `${GRAPH}/v1.0/policies/conditionalAccessPolicies?$top=100` }),
    applications: await readGraph({ request, budget, signal, url: `${GRAPH}/v1.0/applications?$select=id,appId,displayName,tags&$top=999` })
  };
}

async function collectOperations(request, { budget, signal }) {
  return {
    issues: await readGraph({ request, budget, signal, url: `${GRAPH}/v1.0/admin/serviceAnnouncement/issues?$top=100` }),
    messages: await readGraph({ request, budget, signal, url: `${GRAPH}/v1.0/admin/serviceAnnouncement/messages?$top=999` })
  };
}

async function collectTeams(request, { budget, signal }) {
  const teams = await readGraph({
    request, budget, signal,
    url: `${GRAPH}/v1.0/groups?$filter=resourceProvisioningOptions/Any(x:x%20eq%20'Team')&$select=id,displayName,assignedLabels,visibility,renewedDateTime&$top=999`
  });
  const teamDetails = [];
  for (const team of list(teams).slice(0, 200)) {
    throwIfAborted(signal);
    const channels = await readGraph({
      request, budget, signal,
      url: `${GRAPH}/v1.0/teams/${encodeURIComponent(team.id)}/channels?$select=id,displayName,membershipType`,
      limit: 200
    });
    const owners = await readGraph({
      request, budget, signal,
      url: `${GRAPH}/v1.0/groups/${encodeURIComponent(team.id)}/owners?$select=id`,
      limit: 100
    });
    if (channels.ok && owners.ok) {
      teamDetails.push({ ok: true, teamId: team.id, channels: channels.value, owners: owners.value });
    } else {
      teamDetails.push({
        ok: false,
        teamId: team.id,
        channels: channels.value,
        owners: owners.value,
        error: channels.error || owners.error
      });
    }
  }
  return {
    teams,
    teamDetails,
    teamsApps: await readGraph({ request, budget, signal, url: `${GRAPH}/v1.0/appCatalogs/teamsApps?$expand=appDefinitions` }),
    teamsAppSettings: await readGraph({ request, budget, signal, collection: false, url: `${GRAPH}/beta/teamwork/teamsAppSettings` })
  };
}

async function collectCopilot(request, { budget, signal }) {
  return {
    skus: await readGraph({ request, budget, signal, url: `${GRAPH}/v1.0/subscribedSkus?$select=id,skuId,skuPartNumber,prepaidUnits,consumedUnits,servicePlans` }),
    externalConnections: await readGraph({ request, budget, signal, url: `${GRAPH}/v1.0/external/connections?$top=999` }),
    teamsApps: await readGraph({ request, budget, signal, url: `${GRAPH}/v1.0/appCatalogs/teamsApps?$expand=appDefinitions` }),
    applications: await readGraph({ request, budget, signal, url: `${GRAPH}/v1.0/applications?$select=id,appId,displayName,tags,verifiedPublisher&$top=999` }),
    servicePrincipals: await readGraph({ request, budget, signal, url: `${GRAPH}/v1.0/servicePrincipals?$select=id,appId,displayName,tags,accountEnabled,verifiedPublisher&$top=999` }),
    installationOptions: await readGraph({ request, budget, signal, collection: false, url: `${GRAPH}/beta/admin/microsoft365Apps/installationOptions` })
  };
}

const IMPLEMENTATIONS = {
  identityAndAccess: { collect: collectIdentity, normalize: normalizeIdentity },
  devicesAndApps: { collect: collectDevices, normalize: normalizeDevices },
  serviceHealthOperations: { collect: collectOperations, normalize: normalizeOperations },
  teamsReadiness: { collect: collectTeams, normalize: normalizeTeams },
  copilotConfiguration: { collect: collectCopilot, normalize: normalizeCopilot }
};

function createCollector(domainId, { request }) {
  if (typeof request !== "function") throw new TypeError("A Microsoft Graph request adapter is required.");
  const domain = domains.get(domainId);
  if (!domain) throw new RangeError(`Unsupported Graph collector domain '${domainId}'.`);
  const requiredPermissions = [...new Set(domain.controls.flatMap(control => control.requiredPermissions || []))].sort();
  const requiredLicenses = [...new Set(domain.controls.flatMap(control => control.requiredLicenses || []))].sort();
  const implementation = IMPLEMENTATIONS[domainId];
  return {
    id: `microsoft-graph-${domainId.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`,
    version: VERSION,
    domainIds: [domainId],
    controlIds: domain.controls.map(control => control.id),
    // Query each source independently so one unavailable permission does not
    // suppress every other control in the domain.
    requiredPermissions: [],
    // Premium feature availability is evaluated per control from endpoint evidence.
    // Requiring every domain licence here would prevent the whole collector from
    // running and hide which individual controls are actually unavailable.
    requiredLicenses: [],
    endpoints: ENDPOINTS[domainId],
    maximumRequests: domainId === "teamsReadiness" ? 500 :
      domainId === "identityAndAccess" ? 200 : 100,
    async discoverCapabilities() {
      return {
        available: true,
        permissions: requiredPermissions,
        licenses: requiredLicenses,
        endpoints: ENDPOINTS[domainId]
      };
    },
    async health({ signal }) {
      throwIfAborted(signal);
      return { healthy: true, readOnly: true };
    },
    async collect(args) {
      throwIfAborted(args.signal);
      return implementation.collect(request, args);
    },
    async normalize({ observations, context, signal }) {
      throwIfAborted(signal);
      return implementation.normalize(observations, context);
    }
  };
}

function createIdentityAndAccessCollector(options) {
  return createCollector("identityAndAccess", options);
}

function createDevicesAndAppsCollector(options) {
  return createCollector("devicesAndApps", options);
}

function createServiceHealthOperationsCollector(options) {
  return createCollector("serviceHealthOperations", options);
}

function createTeamsReadinessCollector(options) {
  return createCollector("teamsReadiness", options);
}

function createCopilotConfigurationCollector(options) {
  return createCollector("copilotConfiguration", options);
}

function createGraphDomainCollectors(options) {
  return TARGET_DOMAINS.map(domainId => createCollector(domainId, options));
}

module.exports = {
  ENDPOINTS,
  createGraphDomainCollectors,
  createIdentityAndAccessCollector,
  createDevicesAndAppsCollector,
  createServiceHealthOperationsCollector,
  createTeamsReadinessCollector,
  createCopilotConfigurationCollector
};
