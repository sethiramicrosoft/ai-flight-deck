"use strict";

const object = value => value && typeof value === "object" && !Array.isArray(value);
const strings = value => Array.isArray(value) && value.every(v => typeof v === "string" && v.trim());
const empty = value => value == null || (Array.isArray(value) && value.length === 0);
const only = (value, keys) => Object.keys(value).every(key => keys.includes(key) || empty(value[key]));

// A deliberately bounded configuration contract, not a sign-in simulation.
// Group/role resolution, exclusions and conditional targeting require other evidence.
function assessConditionalAccess(observation, cohort) {
  const unknown = reason => ({ status: "Unknown", reason, matchingPolicies: [] });
  const ids = cohort?.principalIds;
  if (!cohort?.approved || !strings(ids) || !ids.length || new Set(ids).size !== ids.length) {
    return unknown("Select an approved pilot with complete, distinct user membership.");
  }
  if (observation?.ok !== true || observation.truncated !== false || !Array.isArray(observation.value)) {
    return unknown("A complete, successful Conditional Access policy collection is required.");
  }
  const policies = observation.value;
  if (policies.some(p => !object(p) || typeof p.id !== "string" || !p.id.trim() ||
      !["enabled", "disabled", "enabledForReportingButNotEnforced"].includes(p.state)) ||
      new Set(policies.map(p => p.id)).size !== policies.length) {
    return unknown("The policy collection contains missing, duplicate or unsupported policy records.");
  }
  const active = policies.filter(p => p.state === "enabled");
  if (!active.length) return { status: "Fail", reason: "No enabled Conditional Access policy was returned.",
    matchingPolicies: [], population: ids.length };
  const matchingPolicies = active.filter(policy => {
    const c = policy.conditions, grant = policy.grantControls;
    if (!object(c) || !object(c.users) || !object(c.applications) || !object(grant)) return false;
    if (!only(c, ["users", "applications", "clientAppTypes"]) ||
        !strings(c.clientAppTypes) || c.clientAppTypes.length !== 1 || c.clientAppTypes[0] !== "all") return false;
    const users = c.users, apps = c.applications;
    if (!only(users, ["includeUsers"]) || !strings(users.includeUsers) ||
        !(users.includeUsers.includes("All") || ids.every(id => users.includeUsers.includes(id)))) return false;
    if (!only(apps, ["includeApplications"]) || !strings(apps.includeApplications) ||
        apps.includeApplications.length !== 1 || apps.includeApplications[0] !== "All") return false;
    if (!only(grant, ["operator", "builtInControls"]) || grant.operator !== "AND" ||
        !strings(grant.builtInControls) || grant.builtInControls.length !== 2 ||
        !grant.builtInControls.includes("mfa") || !grant.builtInControls.includes("compliantDevice")) return false;
    return true;
  }).map(p => p.id).sort();
  if (!matchingPolicies.length) {
    return unknown("No policy matches the supported baseline: all pilot users explicitly or All users, All cloud apps, all client types, MFA AND compliant device, and no exclusions or extra targeting conditions. Review other policy shapes with the identity administrator; do not weaken them to fit this check.");
  }
  return { status: "Pass", reason: "An enabled policy explicitly covers the pilot with the supported MFA AND compliant-device baseline.",
    matchingPolicies, population: ids.length };
}

module.exports = { assessConditionalAccess };
