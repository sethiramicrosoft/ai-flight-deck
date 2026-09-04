"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  AUTH_MODES,
  ConsentBroker,
  buildServicePlans
} = require("./consent-broker");

function collectors() {
  return [
    {
      id: "identity",
      services: [{
        id: "graph",
        controls: ["AFD-IAM-001"],
        permissions: {
          localDelegated: ["Directory.Read.All", "Policy.Read.All"],
          productionApplication: ["Policy.Read.All"]
        },
        licenses: ["Entra ID P1"],
        adminRoles: ["Global Reader"],
        endpoints: ["https://graph.microsoft.com/v1.0/policies"]
      }]
    },
    {
      id: "licensing",
      services: [{
        id: "graph",
        controls: ["AFD-LIC-001"],
        permissions: {
          localDelegated: ["Directory.Read.All"],
          productionApplication: ["Organization.Read.All"]
        },
        licenses: ["Microsoft 365 E3"],
        adminRoles: ["Global Reader"],
        endpoints: ["https://graph.microsoft.com/v1.0/subscribedSkus"]
      }]
    }
  ];
}

test("aggregates each service with least privilege and no duplicates", () => {
  const [plan] = buildServicePlans(collectors(), {
    authMode: AUTH_MODES.LOCAL_DELEGATED,
    grantedPermissions: ["Directory.Read.All", "Policy.Read.All"],
    availableLicenses: ["Entra ID P1", "Microsoft 365 E3"],
    assignedAdminRoles: ["Global Reader"]
  });

  assert.equal(plan.serviceId, "graph");
  assert.deepEqual(plan.collectorIds, ["identity", "licensing"]);
  assert.deepEqual(plan.permissions, ["Directory.Read.All", "Policy.Read.All"]);
  assert.deepEqual(plan.adminRoles, ["Global Reader"]);
  assert.equal(plan.available, true);
  assert.deepEqual(plan.unavailableControls, []);
});

test("keeps delegated and application identity permissions separate", () => {
  const delegated = buildServicePlans(collectors(), {
    authMode: AUTH_MODES.LOCAL_DELEGATED
  })[0];
  const application = buildServicePlans(collectors(), {
    authMode: AUTH_MODES.PRODUCTION_APPLICATION
  })[0];

  assert.deepEqual(delegated.permissions, ["Directory.Read.All", "Policy.Read.All"]);
  assert.deepEqual(application.permissions, ["Organization.Read.All", "Policy.Read.All"]);
  assert.equal(delegated.authMode, "local-delegated");
  assert.equal(application.authMode, "production-application");
});

test("reports missing roles and SKUs as explicitly unavailable controls", () => {
  const [plan] = buildServicePlans(collectors(), {
    authMode: AUTH_MODES.LOCAL_DELEGATED,
    grantedPermissions: ["Directory.Read.All", "Policy.Read.All"],
    availableLicenses: ["Entra ID P1"],
    assignedAdminRoles: []
  });

  assert.equal(plan.available, false);
  assert.deepEqual(plan.missingAdminRoles, ["Global Reader"]);
  assert.deepEqual(plan.missingSkus, ["Microsoft 365 E3"]);
  assert.deepEqual(
    plan.unavailableControls.map(control => control.controlId),
    ["AFD-IAM-001", "AFD-LIC-001"]
  );
  assert.match(plan.unavailableControls[0].reasons.join(" "), /Missing admin roles/);
  assert.match(plan.unavailableControls[1].reasons.join(" "), /Missing SKUs/);
});

test("rejects permissions that no selected collector declared", () => {
  assert.throws(
    () => buildServicePlans(collectors(), {
      authMode: AUTH_MODES.LOCAL_DELEGATED,
      requestedPermissions: ["Sites.FullControl.All"]
    }),
    error => error.code === "UNDECLARED_PERMISSION" &&
      /Sites\.FullControl\.All/.test(error.message)
  );
});

test("opaque token handles are job bound, one-time, revocable, and never expose tokens", () => {
  let now = 1_000;
  const broker = new ConsentBroker({
    now: () => now,
    randomBytes: size => Buffer.alloc(size, 7)
  });
  const binding = {
    tenantId: "tenant-a",
    jobId: "job-a",
    collectorId: "identity",
    authMode: AUTH_MODES.LOCAL_DELEGATED
  };
  const handle = broker.createTokenHandle({
    ...binding,
    rawToken: "secret-token-value",
    expiresAt: 2_000
  });

  assert.match(handle, /^afd_[A-Za-z0-9_-]+$/);
  assert.equal(handle.includes("secret-token-value"), false);
  assert.throws(
    () => broker.consumeTokenHandle(handle, { ...binding, jobId: "job-b" }),
    error => error.code === "TOKEN_BINDING_MISMATCH"
  );
  const consumed = broker.consumeTokenHandle(handle, binding);
  assert.equal(Object.hasOwn(consumed, "rawToken"), false);
  assert.equal(JSON.stringify(consumed).includes("secret-token-value"), false);
  assert.throws(
    () => broker.consumeTokenHandle(handle, binding),
    error => error.code === "TOKEN_HANDLE_INVALID"
  );

  const revoked = broker.createTokenHandle({
    ...binding,
    rawToken: "another-secret",
    expiresAt: 2_000
  });
  assert.equal(broker.revokeTokenHandle(revoked), true);
  assert.throws(
    () => broker.consumeTokenHandle(revoked, binding),
    error => error.code === "TOKEN_HANDLE_INVALID"
  );

  const expired = broker.createTokenHandle({
    ...binding,
    rawToken: "expired-secret",
    expiresAt: 1_500
  });
  now = 1_500;
  assert.throws(
    () => broker.consumeTokenHandle(expired, binding),
    error => error.code === "TOKEN_HANDLE_EXPIRED"
  );
});

test("consent planning honors AbortSignal cancellation", async () => {
  const controller = new AbortController();
  controller.abort();
  const broker = new ConsentBroker({ collectors: collectors() });

  await assert.rejects(
    broker.prepareConsent({
      authMode: AUTH_MODES.LOCAL_DELEGATED,
      signal: controller.signal
    }),
    error => error.name === "AbortError" && error.code === "CONSENT_CANCELLED"
  );
});
