"use strict";

const catalog = require("../schema/readiness-catalog.v1.json");

const domain = catalog.domains.find(item => item.id === "licensingAndTenantEntitlement");
const controls = new Map(domain.controls.map(control => [control.id, control]));

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason || new Error("Collector cancelled.");
}

async function getAll(request, url, budget, signal) {
  const items = [];
  let next = url;
  while (next) {
    throwIfAborted(signal);
    budget.consume();
    const response = await request({ url: next, method: "GET", signal });
    if (!response || !Array.isArray(response.value)) {
      throw new Error(`Invalid Microsoft Graph collection response for '${url}'.`);
    }
    items.push(...response.value);
    next = response["@odata.nextLink"] || null;
  }
  return items;
}

function evidenceResult(controlId, status, context, options = {}) {
  const control = controls.get(controlId);
  const observedAt = context.observedAt || new Date().toISOString();
  const population = options.population ?? 0;
  const evaluated = options.evaluated ?? 0;
  return {
    controlId,
    controlVersion: catalog.catalogVersion,
    instanceId: `${context.tenantId}:${context.cohort?.id || "tenant-wide"}:${controlId}`,
    domainId: domain.id,
    cohortId: context.cohort?.id || "tenant-wide",
    status,
    requirement: control.requirement,
    applicability: options.applicability || { applies: true, reason: control.applicability },
    observedValue: options.observedValue ?? null,
    expectedValue: control.passCondition,
    observedAt,
    freshUntil: new Date(Date.parse(observedAt) + control.freshnessHours * 3600000).toISOString(),
    coverage: {
      population,
      evaluated,
      complete: options.complete === true,
      excluded: options.excluded || 0,
      reason: options.coverageReason || ""
    },
    confidence: options.confidence ?? (options.complete ? 1 : 0),
    provenance: {
      collectorId: "microsoft-graph-licensing",
      collectorVersion: "1.0.0",
      collectorRunId: context.collectorRunId,
      tenantId: context.tenantId,
      actorId: context.actorId,
      source: options.source || "Microsoft Graph",
      sourceVersion: "v1.0",
      requestIds: []
    },
    evidenceRefs: options.evidenceRefs || [],
    affectedPrincipals: options.affectedPrincipals || [],
    affectedResources: options.affectedResources || [],
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

function planNames(user, servicePlanNames) {
  return new Set((user.assignedPlans || [])
    .filter(plan => String(plan.capabilityStatus || "").toLowerCase() === "enabled")
    .map(plan => String(
      plan.servicePlanName ||
      servicePlanNames.get(String(plan.servicePlanId || "").toLowerCase()) ||
      plan.service ||
      ""
    ).toUpperCase()));
}

function hasCopilotPlan(user, copilotSkuIds, servicePlanNames) {
  const assignedSku = (user.assignedLicenses || [])
    .some(license => copilotSkuIds.has(String(license.skuId || "").toLowerCase()));
  return assignedSku || [...planNames(user, servicePlanNames)].some(name => name.includes("COPILOT"));
}

function findCopilotSkus(skus) {
  return skus.filter(sku => {
    const skuName = String(sku.skuPartNumber || "").toUpperCase();
    return skuName.includes("COPILOT") ||
      (sku.servicePlans || []).some(plan =>
        String(plan.servicePlanName || "").toUpperCase().includes("COPILOT"));
  });
}

function normalizeLicensing({ observations, context }) {
  const skus = [...observations.skus].sort((a, b) =>
    String(a.skuPartNumber || "").localeCompare(String(b.skuPartNumber || "")));
  const users = [...observations.users].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const cohortIds = new Set(context.cohort?.principalIds || []);
  const cohortConfigured = Boolean(context.cohort?.approved === true && cohortIds.size);
  const cohortUsers = users.filter(user => cohortIds.has(user.id));
  const copilotSkus = findCopilotSkus(skus);
  const copilotSkuIds = new Set(copilotSkus
    .flatMap(sku => [sku.skuId, sku.id])
    .filter(Boolean)
    .map(value => String(value).toLowerCase()));
  const servicePlanNames = new Map(skus.flatMap(sku =>
    (sku.servicePlans || [])
      .filter(plan => plan.servicePlanId)
      .map(plan => [String(plan.servicePlanId).toLowerCase(), plan.servicePlanName])));
  const copilotUsers = users.filter(user =>
    hasCopilotPlan(user, copilotSkuIds, servicePlanNames));
  const results = [];

  if (!cohortConfigured) {
    results.push(evidenceResult("AFD-LIC-001", "Unknown", context, {
      observedValue: { copilotSkuCount: copilotSkus.length },
      source: "Microsoft Graph /subscribedSkus",
      limitations: [{
        code: "APPROVED_COHORT_REQUIRED",
        description: "Define and approve a Copilot cohort before licence capacity can be evaluated."
      }]
    }));
    results.push(evidenceResult("AFD-LIC-002", "Unknown", context, {
      observedValue: { copilotLicensedUsers: copilotUsers.length },
      source: "Microsoft Graph /users assignedPlans",
      limitations: [{
        code: "APPROVED_COHORT_REQUIRED",
        description: "Licence assignment cannot be compared without an approved cohort membership list."
      }]
    }));
  } else {
    const enabledUnits = copilotSkus.reduce((sum, sku) => sum + Number(sku.prepaidUnits?.enabled || 0), 0);
    const cohortLicensed = cohortUsers.filter(user =>
      hasCopilotPlan(user, copilotSkuIds, servicePlanNames));
    const missingUsers = cohortUsers.filter(user =>
      !hasCopilotPlan(user, copilotSkuIds, servicePlanNames));
    const outOfCohort = copilotUsers.filter(user => !cohortIds.has(user.id));
    results.push(evidenceResult("AFD-LIC-001",
      copilotSkus.length > 0 && enabledUnits >= cohortUsers.length ? "Pass" : "Fail",
      context, {
        population: cohortUsers.length,
        evaluated: cohortUsers.length,
        complete: true,
        confidence: 1,
        source: "Microsoft Graph /subscribedSkus",
        observedValue: {
          copilotSkuCount: copilotSkus.length,
          enabledUnits,
          approvedCohortSize: cohortUsers.length
        },
        affectedPrincipals: missingUsers.map(user => user.id)
      }));
    results.push(evidenceResult("AFD-LIC-002",
      missingUsers.length === 0 && outOfCohort.length === 0 ? "Pass" : "Fail",
      context, {
        population: cohortUsers.length + outOfCohort.length,
        evaluated: cohortUsers.length + outOfCohort.length,
        complete: true,
        confidence: 1,
        source: "Microsoft Graph /users assignedPlans",
        observedValue: {
          cohortLicensed: cohortLicensed.length,
          cohortMissing: missingUsers.length,
          licensedOutsideCohort: outOfCohort.length
        },
        affectedPrincipals: [...missingUsers, ...outOfCohort].map(user => user.id).sort()
      }));
  }

  const prerequisites = ["EXCHANGE", "SHAREPOINT", "TEAMS", "ONEDRIVE", "OFFICE"];
  if (!copilotUsers.length) {
    results.push(evidenceResult("AFD-LIC-003", "Unknown", context, {
      source: "Microsoft Graph /users assignedPlans",
      limitations: [{
        code: "NO_COPILOT_LICENSED_USERS",
        description: "No users with an enabled Copilot service plan were observed."
      }]
    }));
  } else {
    const missingPrerequisites = copilotUsers
      .map(user => {
        const names = planNames(user, servicePlanNames);
        const missing = prerequisites.filter(required =>
          ![...names].some(name => name.includes(required)));
        return { userId: user.id, missing };
      })
      .filter(item => item.missing.length);
    results.push(evidenceResult("AFD-LIC-003",
      missingPrerequisites.length ? "Fail" : "Pass",
      context, {
        population: copilotUsers.length,
        evaluated: copilotUsers.length,
        complete: true,
        confidence: 0.9,
        source: "Microsoft Graph /users assignedPlans",
        observedValue: { missingPrerequisites },
        affectedPrincipals: missingPrerequisites.map(item => item.userId)
      }));
  }

  results.push(evidenceResult("AFD-LIC-004", "Pass", context, {
    population: skus.length,
    evaluated: skus.length,
    complete: true,
    confidence: 1,
    source: "Microsoft Graph /subscribedSkus",
    observedValue: {
      skuCount: skus.length,
      skus: skus.map(sku => ({
        id: sku.id,
        skuPartNumber: sku.skuPartNumber,
        consumedUnits: sku.consumedUnits,
        prepaidUnits: sku.prepaidUnits,
        servicePlans: (sku.servicePlans || []).map(plan => ({
          servicePlanId: plan.servicePlanId,
          servicePlanName: plan.servicePlanName,
          provisioningStatus: plan.provisioningStatus
        }))
      }))
    },
    evidenceRefs: skus.filter(sku => sku.id).map(sku => ({
      id: `sku:${sku.id}`,
      kind: "microsoftGraphSubscribedSku",
      etag: null,
      digest: null
    }))
  }));

  const renewals = context.subscriptionRenewals;
  if (!Array.isArray(renewals) || !renewals.length) {
    results.push(evidenceResult("AFD-LIC-005", "Unknown", context, {
      limitations: [{
        code: "RENEWAL_EVIDENCE_REQUIRED",
        description: "Microsoft Graph subscribedSkus does not expose subscription expiry dates; provide billing renewal evidence."
      }]
    }));
  } else {
    const threshold = Date.parse(context.observedAt || new Date().toISOString()) + 30 * 86400000;
    const atRisk = renewals.filter(item =>
      Date.parse(item.expiresAt) <= threshold && !(item.owner && item.targetDate));
    results.push(evidenceResult("AFD-LIC-005", atRisk.length ? "Warning" : "Pass", context, {
      population: renewals.length,
      evaluated: renewals.length,
      complete: true,
      confidence: 0.8,
      source: "Approved billing renewal evidence",
      observedValue: { atRisk },
      affectedResources: atRisk.map(item => item.subscriptionId)
    }));
  }

  return results.sort((a, b) => a.controlId.localeCompare(b.controlId));
}

function createLicensingCollector({ request }) {
  if (typeof request !== "function") throw new TypeError("A Microsoft Graph request adapter is required.");
  return {
    id: "microsoft-graph-licensing",
    version: "1.0.0",
    domainIds: [domain.id],
    controlIds: domain.controls.map(control => control.id),
    requiredPermissions: ["Directory.Read.All", "Organization.Read.All"],
    requiredLicenses: [],
    maximumRequests: 10000,
    async discoverCapabilities() {
      return { available: true };
    },
    async health({ signal }) {
      throwIfAborted(signal);
      return { healthy: true };
    },
    async collect({ signal, budget }) {
      const skus = await getAll(
        request,
        "https://graph.microsoft.com/v1.0/subscribedSkus?$select=id,skuId,skuPartNumber,consumedUnits,prepaidUnits,servicePlans",
        budget,
        signal
      );
      const users = await getAll(
        request,
        "https://graph.microsoft.com/v1.0/users?$select=id,accountEnabled,userType,assignedLicenses,assignedPlans&$top=999",
        budget,
        signal
      );
      return { skus, users };
    },
    async normalize({ observations, context, signal }) {
      throwIfAborted(signal);
      return normalizeLicensing({ observations, context });
    }
  };
}

module.exports = {
  createLicensingCollector,
  findCopilotSkus,
  normalizeLicensing
};
