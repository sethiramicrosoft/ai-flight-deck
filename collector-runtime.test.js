"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { CollectorRegistry } = require("./collector-runtime");

function collector(overrides = {}) {
  return {
    id: "graph-identity",
    version: "1.0.0",
    domainIds: ["identityAndAccess"],
    controlIds: ["AFD-IAM-001"],
    requiredPermissions: ["Policy.Read.All"],
    requiredLicenses: ["Microsoft Entra ID P1"],
    maximumRequests: 2,
    async health() {
      return { healthy: true };
    },
    async collect({ budget }) {
      budget.consume();
      return [{ enabled: true }];
    },
    async normalize() {
      return [{ controlId: "AFD-IAM-001", status: "Pass" }];
    },
    ...overrides
  };
}

test("registry rejects duplicate and malformed collectors", () => {
  const registry = new CollectorRegistry();
  registry.register(collector());
  assert.throws(() => registry.register(collector()), /already registered/);
  assert.throws(() => registry.register(collector({ id: "Bad Id" })), /id is invalid/);
});

test("capability plan prevents collection without permissions and licences", async () => {
  let collected = false;
  const registry = new CollectorRegistry();
  registry.register(collector({
    async collect() {
      collected = true;
      return [];
    }
  }));
  const [result] = await registry.run();
  assert.equal(result.status, "Unavailable");
  assert.deepEqual(result.missingPermissions, ["Policy.Read.All"]);
  assert.deepEqual(result.missingLicenses, ["Microsoft Entra ID P1"]);
  assert.equal(collected, false);
});

test("collector runs with bounded requests and normalized results", async () => {
  const registry = new CollectorRegistry();
  registry.register(collector());
  const [result] = await registry.run({
    grantedPermissions: ["Policy.Read.All"],
    availableLicenses: ["Microsoft Entra ID P1"]
  });
  assert.equal(result.status, "Completed");
  assert.equal(result.requests, 1);
  assert.deepEqual(result.controlResults, [{ controlId: "AFD-IAM-001", status: "Pass" }]);
});

test("collector failures are isolated", async () => {
  const registry = new CollectorRegistry();
  registry.register(collector({
    id: "failing-collector",
    requiredPermissions: [],
    requiredLicenses: [],
    async collect() {
      const error = new Error("service unavailable");
      error.code = "UPSTREAM_UNAVAILABLE";
      throw error;
    }
  }));
  registry.register(collector({
    id: "healthy-collector",
    requiredPermissions: [],
    requiredLicenses: []
  }));
  const results = await registry.run({ maxConcurrency: 2 });
  assert.equal(results.find(result => result.collectorId === "failing-collector").status, "Failed");
  assert.equal(results.find(result => result.collectorId === "healthy-collector").status, "Completed");
});

test("request budget and timeout failures are explicit", async () => {
  const budgetRegistry = new CollectorRegistry();
  budgetRegistry.register(collector({
    requiredPermissions: [],
    requiredLicenses: [],
    async collect({ budget }) {
      budget.consume(3);
      return [];
    }
  }));
  const [budgetResult] = await budgetRegistry.run();
  assert.equal(budgetResult.status, "Failed");
  assert.equal(budgetResult.error.code, "COLLECTOR_REQUEST_BUDGET_EXCEEDED");

  const timeoutRegistry = new CollectorRegistry();
  timeoutRegistry.register(collector({
    requiredPermissions: [],
    requiredLicenses: [],
    async collect({ signal }) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 100);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(signal.reason);
        }, { once: true });
      });
      return [];
    }
  }));
  const [timeoutResult] = await timeoutRegistry.run({ timeoutMs: 10 });
  assert.equal(timeoutResult.status, "Failed");
  assert.equal(timeoutResult.error.code, "COLLECTOR_TIMEOUT");
});

test("bounded concurrency never exceeds the configured worker count", async () => {
  let active = 0;
  let peak = 0;
  const registry = new CollectorRegistry();
  for (let index = 0; index < 5; index++) {
    registry.register(collector({
      id: `collector-${index}`,
      requiredPermissions: [],
      requiredLicenses: [],
      async collect() {
        active++;
        peak = Math.max(peak, active);
        await new Promise(resolve => setTimeout(resolve, 15));
        active--;
        return [];
      }
    }));
  }
  const results = await registry.run({ maxConcurrency: 2 });
  assert.equal(results.every(result => result.status === "Completed"), true);
  assert.equal(peak, 2);
});
