"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { assessConditionalAccess } = require("./conditional-access-evidence");
const { CollectorRegistry } = require("./collector-runtime");
const { createIdentityAndAccessCollector } = require("./collectors/graph-domains");
const { validate, context, integrity, catalog, now } = require("./authority-test-fixtures");
const { validateAssessmentAuthority } = require("./evidence-authority");
const { policy } = require("./tests/conditional-access-fixture");
const observation = (value = [policy()]) => ({ ok: true, truncated: false, value });

async function collect(request) {
  const registry = new CollectorRegistry();
  registry.register(createIdentityAndAccessCollector({ request }));
  const [execution] = await registry.run({ context });
  assert.equal(execution.status, "Completed");
  return validate(execution.controlResults).find(r => r.controlId === "AFD-IAM-003");
}

test("bounded baseline accepts explicit pilot or all users; only disabled/report-only policies fail", () => {
  assert.equal(assessConditionalAccess(observation(), context.cohort).status, "Pass");
  const all = policy(); all.conditions.users.includeUsers = ["All"];
  assert.equal(assessConditionalAccess(observation([all]), context.cohort).status, "Pass");
  for (const records of [[], [policy("disabled")], [policy("enabledForReportingButNotEnforced")]]) {
    assert.equal(assessConditionalAccess(observation(records), context.cohort).status, "Fail");
  }
});

test("exclusions, groups, conditional restrictions and alternative grants stay Unknown", () => {
  const changes = [
    p => { p.conditions.users.excludeUsers = ["user-1"]; },
    p => { p.conditions.users.excludeGroups = ["unresolved-group"]; },
    p => { p.conditions.users.includeUsers = []; p.conditions.users.includeGroups = ["pilot"]; },
    p => { p.conditions.users.excludeGuestsOrExternalUsers = { guestOrExternalUserTypes: "b2bCollaborationGuest" }; },
    p => { p.conditions.applications.excludeApplications = ["app"]; },
    p => { p.conditions.applications.includeApplications = ["unknown-copilot-app"]; },
    p => { p.conditions.platforms = { includePlatforms: ["windows"] }; },
    p => { p.conditions.locations = { includeLocations: ["All"], excludeLocations: ["trusted"] }; },
    p => { p.conditions.devices = { deviceFilter: { mode: "include", rule: "device.isCompliant -eq True" } }; },
    p => { p.conditions.signInRiskLevels = ["high"]; },
    p => { p.conditions.clientAppTypes = ["browser"]; },
    p => { p.grantControls.operator = "OR"; },
    p => { p.grantControls.builtInControls = ["mfa"]; },
    p => { p.grantControls.authenticationStrength = { id: "strength" }; },
    p => { p.conditions.newTargetingProperty = { mode: "restricted" }; },
    p => { delete p.conditions; }
  ];
  for (const change of changes) {
    const p = policy(); change(p);
    assert.equal(assessConditionalAccess(observation([p]), context.cohort).status, "Unknown", change.toString());
  }
});

test("partial, denied, malformed and ambiguous source or pilot never passes", () => {
  for (const source of [null, { ...observation(), ok: false }, { ...observation(), truncated: true },
    { ...observation(), truncated: undefined }, observation([policy(), policy()]),
    observation([{ ...policy(), state: "newState" }]), observation([null])]) {
    assert.equal(assessConditionalAccess(source, context.cohort).status, "Unknown");
  }
  for (const cohort of [null, { ...context.cohort, approved: false },
    { ...context.cohort, principalIds: [] }, { ...context.cohort, principalIds: ["user-1", "user-1"] }]) {
    assert.equal(assessConditionalAccess(observation(), cohort).status, "Unknown");
  }
});

test("actual Graph route, pagination and authority receipt survive revalidation, not tampering or changed scope", async () => {
  const calls = [];
  const r = await collect(async ({ url, method }) => {
    calls.push({ url, method });
    if (url.includes("/identity/conditionalAccess/policies")) return url.includes("page=2")
      ? { value: [policy()] } : { value: [], "@odata.nextLink": "https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies?page=2" };
    return { value: [] };
  });
  assert.equal(r.status, "Pass");
  assert.equal(r.authority.validationStatus, "Accepted");
  assert.equal(r.authority.evidenceRecord.payload.contract, "conditional-access-baseline-v1");
  assert.ok(calls.some(c => c.url.includes("page=2")));
  assert.ok(calls.every(c => c.method === "GET" && !c.url.includes("conditionalAccessPolicies")));
  assert.equal(validate([structuredClone(r)])[0].status, "Pass");
  const changed = structuredClone(r); changed.observedValue.matchingPolicies = ["invented"];
  assert.equal(validate([changed])[0].status, "Unknown");
  assert.equal(validate([r], { context: { ...context, cohort: { ...context.cohort, principalIds: ["other"] } } })[0].status, "Unknown");
  const scan = { tenant: { tenantId: context.tenantId }, estateAssessment: { cohorts: [context.cohort],
    controlResults: [structuredClone(r)] } };
  validateAssessmentAuthority(scan, integrity, new Date(now.getTime() + 25 * 3600000));
  assert.equal(scan.estateAssessment.controlResults[0].status, "Unknown");
  assert.equal(catalog.domains.flatMap(d => d.controls).length, 77);
});

test("collector rejects denied reads, cross-endpoint pagination, overflow and stale claims", async () => {
  for (const response of [
    { value: [policy()], "@odata.nextLink": "https://example.test/policies" },
    { value: [policy()], "@odata.nextLink": "https://graph.microsoft.com/v1.0/users" },
    { value: Array.from({ length: 1001 }, (_, i) => ({ ...policy(), id: `p-${i}` })) }
  ]) {
    const r = await collect(async ({ url }) => url.includes("/identity/conditionalAccess/policies") ? response : { value: [] });
    assert.equal(r.status, "Unknown");
  }
  const denied = await collect(async () => { throw Object.assign(new Error("Read denied"), { code: "403" }); });
  assert.equal(denied.status, "Unknown");
  assert.ok(denied.limitations.some(l => l.code === "403"));
});
