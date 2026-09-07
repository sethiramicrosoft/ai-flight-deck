"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  createAdminCommandAdapter,
  createPowerPlatformClient,
  graphRequest
} = require("./collector-adapters");

async function withWorkspace(action) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "flight-deck-adapter-"));
  try {
    return await action(workspace);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

test("administrator adapter validates tenant, freshness, integrity, and specific command keys", async () => {
  await withWorkspace(async workspace => {
    fs.writeFileSync(path.join(workspace, "admin-evidence.json"), JSON.stringify({
      schema: "ai-flight-deck/admin-evidence",
      version: "1.0.0",
      tenantId: "11111111-1111-1111-1111-111111111111",
      producedAt: new Date().toISOString(),
      evidence: {
        "sharePointOnline:Get-SPOSite:restrictedContent": [{ id: "restricted" }],
        "sharePointOnline:Get-SPOSite": [{ id: "fallback" }]
      },
      errors: {}
    }));
    const adapter = createAdminCommandAdapter(workspace, {
      verifyDocument: () => true
    });
    const result = await adapter({
      tenantId: "11111111-1111-1111-1111-111111111111",
      service: "sharePointOnline",
      command: "Get-SPOSite",
      evidenceKey: "restrictedContent"
    });
    assert.deepEqual(result, [{ id: "restricted" }]);
    await assert.rejects(() => adapter({
      tenantId: "11111111-1111-1111-1111-111111111111",
      service: "sharePointOnline",
      command: "Get-SPOSite",
      evidenceKey: "siteLifecycle"
    }), error => error.code === "COMMAND_UNAVAILABLE");
    await assert.rejects(() => adapter({
      tenantId: "22222222-2222-2222-2222-222222222222",
      service: "sharePointOnline",
      command: "Get-SPOSite"
    }), error => error.code === "EVIDENCE_TENANT_MISMATCH");
  });

  test("evidence packages reject future timestamps and non-object maps", async () => {
    await withWorkspace(async workspace => {
      fs.writeFileSync(path.join(workspace, "admin-evidence.json"), JSON.stringify({
        schema: "ai-flight-deck/admin-evidence",
        version: "1.0.0",
        tenantId: "11111111-1111-1111-1111-111111111111",
        producedAt: "2099-01-01T00:00:00.000Z",
        evidence: [],
        errors: []
      }));
      const adapter = createAdminCommandAdapter(workspace, {
        verifyDocument: () => true
      });
      await assert.rejects(() => adapter({
        tenantId: "11111111-1111-1111-1111-111111111111",
        service: "exchangeOnline",
        command: "Get-EXOMailbox"
      }), error => [
        "EVIDENCE_SHAPE_INVALID",
        "EVIDENCE_TIMESTAMP_IN_FUTURE"
      ].includes(error.code));
    });
  });
});

test("Power Platform adapter reads all resources from a versioned package", async () => {
  await withWorkspace(async workspace => {
    fs.writeFileSync(path.join(workspace, "power-platform-evidence.json"), JSON.stringify({
      schema: "ai-flight-deck/power-platform-evidence",
      version: "1.0.0",
      tenantId: "11111111-1111-1111-1111-111111111111",
      producedAt: new Date().toISOString(),
      evidence: { environments: [{ id: "environment-1" }] },
      errors: {}
    }));
    const client = createPowerPlatformClient(workspace, {
      verifyDocument: () => true
    });
    assert.deepEqual(await client.query({
      tenantId: "11111111-1111-1111-1111-111111111111",
      resource: "environments"
    }), [{ id: "environment-1" }]);
  });
});

test("Graph requests pin a supported locale for locale-sensitive beta endpoints", async () => {
  const originalFetch = global.fetch;
  let observed;
  global.fetch = async (_url, options) => {
    observed = options;
    return {
      ok: true,
      async json() {
        return { value: [] };
      }
    };
  };
  try {
    await graphRequest("test-token")({
      url: "https://graph.microsoft.com/beta/policies/roleManagementPolicyAssignments",
      signal: new AbortController().signal
    });
    assert.equal(observed.headers["Accept-Language"], "en-US");
  } finally {
    global.fetch = originalFetch;
  }
});
