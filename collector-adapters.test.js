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

test("administrator observations never replace accepted evidence or override acquisition failure", async () => {
  await withWorkspace(async workspace => {
    const key = "sharePointOnline:Get-SPOSite:restrictedContent";
    const request = { tenantId: "tenant-1", service: "sharePointOnline",
      command: "Get-SPOSite", evidenceKey: "restrictedContent" };
    const write = data => fs.writeFileSync(path.join(workspace, "admin-evidence.json"), JSON.stringify({
      schema: "ai-flight-deck/admin-evidence", version: "1.0.0", tenantId: "tenant-1",
      producedAt: new Date().toISOString(), evidence: {}, errors: {},
      observations: { [key]: [{ id: "observed-site", RestrictedContentDiscovery: false }] }, ...data
    }));
    const read = () => createAdminCommandAdapter(workspace, { verifyDocument: () => true })(request);
    write({});
    await assert.rejects(read, error => error.code === "COMMAND_UNAVAILABLE");
    for (const status of ["partial", "failed", "unavailable", "unexpected", null]) {
      write({ evidence: { [key]: [{ id: "not-admissible" }] },
        commandResults: { [key]: { acquisitionStatus: status } } });
      await assert.rejects(read, error => error.code === "OBSERVATION_NOT_VALIDATED");
    }
    write({ evidence: { [key]: [] }, commandResults: { [key]: { acquisitionStatus: "collected" } } });
    assert.deepEqual(await read(), []);
    write({ errors: { [key]: { code: "COMMAND_WARNING", message: "Incomplete observations." } },
      commandResults: { [key]: { acquisitionStatus: "partial" } } });
    await assert.rejects(read, error => error.code === "COMMAND_WARNING");
    for (const observations of [[], null, { [key]: {} }]) {
      write({ observations });
      await assert.rejects(read, error => error.code === "EVIDENCE_SHAPE_INVALID");
    }
  });
});

test("Graph directory advanced queries forward only the explicit eventual-consistency option", async () => {
  const originalFetch = global.fetch;
  const headers = [];
  global.fetch = async (_url, options) => {
    headers.push(options.headers);
    return { ok: true, json: async () => ({ value: [] }) };
  };
  try {
    const request = graphRequest("synthetic-test-token");
    await request({ url: "https://graph.microsoft.com/v1.0/groups", consistencyLevel: "eventual",
      headers: { Authorization: "must-not-replace-service-binding", Extra: "must-not-forward" } });
    await request({ url: "https://graph.microsoft.com/v1.0/users" });
    assert.equal(headers[0].ConsistencyLevel, "eventual");
    assert.equal(headers[0].Authorization, "Bearer synthetic-test-token");
    assert.equal(headers[0].Extra, undefined);
    assert.equal(headers[1].ConsistencyLevel, undefined);
  } finally { global.fetch = originalFetch; }
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

    test("unambiguous legacy command entries preserve exact-result and error precedence", async () => {
      await withWorkspace(async workspace => {
        const writePackage = (evidence, errors = {}) => fs.writeFileSync(
          path.join(workspace, "admin-evidence.json"),
          JSON.stringify({
            schema: "ai-flight-deck/admin-evidence", version: "1.0.0",
            tenantId: "tenant-1", producedAt: new Date().toISOString(), evidence, errors
          })
        );
        const request = {
          tenantId: "tenant-1", service: "exchangeOnline", command: "Get-EXOMailbox",
          evidenceKey: "mailboxes", allowUnkeyed: true
        };
        const read = () => createAdminCommandAdapter(workspace, { verifyDocument: () => true })(request);
        writePackage({ "exchangeOnline:Get-EXOMailbox": [{ id: "legacy" }] });
        assert.deepEqual(await read(), [{ id: "legacy" }]);
        writePackage({
          "exchangeOnline:Get-EXOMailbox": [{ id: "legacy" }],
          "exchangeOnline:Get-EXOMailbox:mailboxes": []
        });
        assert.deepEqual(await read(), []);
        writePackage({ "exchangeOnline:Get-EXOMailbox": [{ id: "legacy" }] }, {
          "exchangeOnline:Get-EXOMailbox:mailboxes": { code: "EXACT_FAILURE", message: "Exact query failed." }
        });
        await assert.rejects(read, error => error.code === "EXACT_FAILURE");
        writePackage({}, {
          "exchangeOnline:Get-EXOMailbox": { code: "LEGACY_FAILURE", message: "Command failed." }
        });
        await assert.rejects(read, error => error.code === "LEGACY_FAILURE");
      });
    });

    test("shipped administrator producer keys are consumed by every governance query without ambiguous fallback", async () => {
      const { CollectorRegistry } = require("./collector-runtime");
      const { createGovernanceDomainCollectors } = require("./collectors/governance-domains");
      const script = fs.readFileSync(path.join(__dirname, "scanner", "collect-admin-evidence.ps1"), "utf8");
      // The producer's current operation blocks have no nested braces. Fail if that contract changes.
      const entries = [...script.matchAll(/Add-Evidence (\w+) ([\w-]+) \{[^{}]*\}[ \t]*(\w+)?/g)];
      assert.equal(entries.length, (script.match(/^\s+Add-Evidence /gm) || []).length);
      assert.equal(entries.length, 31);
      const evidence = Object.fromEntries(entries.map(([, service, command, key]) => {
        const packageKey = `${service}:${command}${key ? `:${key}` : ""}`;
        return [packageKey, [{ id: packageKey }]];
      }));
      await withWorkspace(async workspace => {
        fs.writeFileSync(path.join(workspace, "admin-evidence.json"), JSON.stringify({
          schema: "ai-flight-deck/admin-evidence", version: "1.0.0", tenantId: "tenant-1",
          producedAt: new Date().toISOString(), evidence, errors: {}
        }));
        const adapter = createAdminCommandAdapter(workspace, { verifyDocument: () => true });
        const requests = [];
        const received = [];
        const registry = new CollectorRegistry();
        createGovernanceDomainCollectors({
          graphRequest: async () => ({ value: [] }),
          adminCommand: async request => {
            requests.push(request);
            const rows = await adapter(request);
            received.push(rows[0].id);
            return rows;
          }
        }).forEach(collector => registry.register(collector));
        await registry.run({
          context: {
            tenantId: "tenant-1", actorId: "fixture-admin", observedAt: new Date().toISOString(),
            cohort: { id: "pilot", approved: true, principalIds: ["user-1"] }
          }
        });
        assert.equal(requests.length, entries.length);
        assert.deepEqual(received.sort(), Object.keys(evidence).sort());
        assert.ok(requests.every(request => request.tenantId === "tenant-1"));
        for (const request of requests) {
          const ambiguous = ["Get-SPOSite", "Get-SPODataAccessGovernanceInsight", "Get-AutoSensitivityLabelPolicy"]
            .includes(request.command);
          assert.equal(request.allowUnkeyed, !ambiguous, request.command);
        }
      });
    });
    assert.equal(observed.headers["Accept-Language"], "en-US");
  } finally {
    global.fetch = originalFetch;
  }
});
