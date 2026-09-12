"use strict";
// 2026-09-12: parent 8dadfad repeated a nonexistent Graph route in collector and fixture.
// Verify the documented endpoint independently for both identity and device acquisition.
const test = require("node:test");
const assert = require("node:assert/strict");
const { RequestBudget } = require("../../collector-runtime");
const { createIdentityAndAccessCollector, createDevicesAndAppsCollector } = require("../../collectors/graph-domains");

test("identity and device collectors use the documented Conditional Access read route", async () => {
  for (const create of [createIdentityAndAccessCollector, createDevicesAndAppsCollector]) {
    const calls = [];
    const collector = create({ request: async request => { calls.push(request); return { value: [] }; } });
    await collector.collect({ context: {}, budget: new RequestBudget(collector.maximumRequests) });
    assert.ok(calls.some(c => new URL(c.url).pathname === "/v1.0/identity/conditionalAccess/policies"));
    assert.ok(calls.every(c => c.method === "GET" && !c.url.includes("conditionalAccessPolicies")));
  }
});
