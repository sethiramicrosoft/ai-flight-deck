"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { directorySearch, validateDirectorySelection, resolveDirectoryCohort,
  recordDecision, decisionsForContext, safeDirectoryError, DIRECTORY_TTL_MS } = require("./setup-decisions");
const { resolveConfiguredCohort } = require("./estate-collector-suite");
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const user = n => ({ id: id(n), displayName: "Synthetic", userPrincipalName: `u${n}@example.test`, accountEnabled: true });
const selection = { tenantId: "tenant-a", kind: "users", selectedIds: [id(1)], name: "Pilot", owner: "Owner" };
const source = () => ({ action: "directorySearch", status: "completed", completedAt: new Date().toISOString(),
  directoryResult: { tenantId: "tenant-a", kind: "users", items: [user(1)] } });
const input = () => ({ selectedIds: [id(1)], name: "Pilot", owner: "Owner", approved: true });

test("search escapes OData literals, fixes Graph v1.0 path and caps returned identities at 50", async () => {
  const query = "x') or startswith(displayName,'evil";
  const result = await directorySearch(async ({ url, method }) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin + parsed.pathname, "https://graph.microsoft.com/v1.0/users");
    assert.equal(parsed.searchParams.get("$top"), "50");
    assert.equal(method, "GET");
    assert.equal(parsed.searchParams.get("$filter"),
      `startswith(displayName,'${query.replace(/'/g, "''")}') or startswith(userPrincipalName,'${query.replace(/'/g, "''")}')`);
    return { value: Array.from({ length: 51 }, (_, i) => user(i)) };
  }, { query, kind: "users", url: "https://evil.invalid" }, "tenant-a");
  assert.equal(result.items.length, 50);
  assert.equal(result.hasMore, true);
  await assert.rejects(directorySearch(() => assert.fail(), { query: "x".repeat(81), kind: "users" }, "tenant-a"));
});

test("selection requires actual completed same-tenant recent search, owner, approval and bounded IDs", () => {
  assert.equal(validateDirectorySelection(input(), source(), "tenant-a").selectedIds.length, 1);
  assert.throws(() => validateDirectorySelection({ ...input(), selectedIds: [id(2)] }, source(), "tenant-a"), /not in/);
  assert.throws(() => validateDirectorySelection(input(), source(), "tenant-b"), /another tenant/);
  assert.throws(() => validateDirectorySelection(input(), { ...source(), status: "running" }, "tenant-a"), /completed/);
  assert.throws(() => validateDirectorySelection(input(), source(), "tenant-a", Date.now() + DIRECTORY_TTL_MS + 100), /15 minutes/);
  assert.throws(() => validateDirectorySelection({ ...input(), owner: "" }, source(), "tenant-a"), /Owner/);
  assert.throws(() => validateDirectorySelection({ ...input(), approved: false }, source(), "tenant-a"), /approve/);
  assert.throws(() => validateDirectorySelection({ ...input(), selectedIds: Array(51).fill(id(1)) }, source(), "tenant-a"), /50/);
  const groupSource = source();
  groupSource.directoryResult.kind = "groups";
  assert.throws(() => validateDirectorySelection({ ...input(), selectedIds: Array(11).fill(id(1)) }, groupSource, "tenant-a"), /10/);
});

test("group resolution deduplicates transitive users without inventing identities", async () => {
  const cohort = await resolveDirectoryCohort(async request => {
    assert.equal(request.consistencyLevel, "eventual");
    assert.equal(new URL(request.url).searchParams.get("$count"), "true");
    return { value: [user(1), user(1), user(2)] };
  },
    { ...selection, kind: "groups", selectedIds: [id(8), id(9)] });
  assert.deepEqual(cohort.principalIds, [id(1), id(2)]);
  assert.equal(cohort.approved, true);
  assert.equal(cohort.tenantId, "tenant-a");
  assert.equal(cohort.source, "MicrosoftGraphDirectory");
  assert.equal(cohort.membershipConsistency, "eventual");
  assert.match(cohort.scopeSnapshotLimitation, /not proof of instant current-group membership/);
  await assert.rejects(resolveDirectoryCohort(async () => ({ ...user(1), accountEnabled: false }), selection), /disabled/);
  await assert.rejects(resolveDirectoryCohort(async () => ({ ...user(1), userPrincipalName: null }), selection), /unresolved/);
});

test("group pagination refuses cross-host, cross-path, loops and incomplete caps", async () => {
  for (const next of ["https://evil.invalid/v1.0/users", "https://graph.microsoft.com/beta/users"]) {
    let calls = 0;
    await assert.rejects(resolveDirectoryCohort(async () => {
      calls++;
      return { value: [user(1)], "@odata.nextLink": next };
    }, { ...selection, kind: "groups" }), /pagination/);
    assert.equal(calls, 1);
  }
  let pages = 0;
  await assert.rejects(resolveDirectoryCohort(async ({ url, consistencyLevel }) => {
    assert.equal(consistencyLevel, "eventual");
    assert.equal(new URL(url).searchParams.get("$count"), "true");
    pages++;
    const next = new URL(url);
    next.searchParams.set("$skiptoken", String(pages));
    return { value: [user(1)], "@odata.nextLink": next.href };
  }, { ...selection, kind: "groups" }), /10-page/);
  assert.equal(pages, 10);
  await assert.rejects(resolveDirectoryCohort(async () => ({ value: Array(1001).fill(user(1)) }),
    { ...selection, kind: "groups" }), /1000-member/);
  for (const count of [1001, "1", 2]) {
    await assert.rejects(resolveDirectoryCohort(async () => ({ value: [user(1)], "@odata.count": count }),
      { ...selection, kind: "groups" }), /1000-member|invalid count|does not match/);
  }
});

test("successful cast pagination forwards eventual consistency on each page and checks the snapshot count", async () => {
  let pages = 0;
  const cohort = await resolveDirectoryCohort(async ({ url, consistencyLevel }) => {
    pages++;
    const parsed = new URL(url);
    assert.equal(consistencyLevel, "eventual");
    assert.equal(parsed.searchParams.get("$count"), "true");
    parsed.searchParams.set("$skiptoken", "synthetic-page-2");
    return { value: [user(pages)], "@odata.count": 2,
      ...(pages === 1 ? { "@odata.nextLink": parsed.href } : {}) };
  }, { ...selection, kind: "groups" });
  assert.equal(pages, 2);
  assert.deepEqual(cohort.principalIds, [id(1), id(2)]);
  assert.equal(cohort.membershipConsistency, "eventual");
});

test("directory failures classify denied, expired auth and throttling without leaking unknown causes", () => {
  for (const [input, status, pattern] of [
    [{ code: "Authorization_RequestDenied" }, 403, /access was denied/],
    [{ status: 403 }, 403, /access was denied/],
    [{ code: "InvalidAuthenticationToken" }, 401, /authentication was rejected/],
    [{ statusCode: 401 }, 401, /authentication was rejected/],
    [{ code: "TooManyRequests" }, 429, /throttled/],
    [{ httpStatus: 429 }, 429, /throttled/]
  ]) {
    const safe = safeDirectoryError({ ...input, message: "sensitive-error-marker" });
    assert.match(safe.message, pattern);
    assert.equal(safe.httpStatus, status);
    assert.equal(safe.message.includes("sensitive-error-marker"), false);
  }
  for (const code of ["unknown-sensitive-code", "__proto__", "constructor"]) {
    const safe = safeDirectoryError({ code, message: "sensitive-error-marker" });
    assert.equal(safe.code, "DIRECTORY_REQUEST_FAILED");
    assert.match(safe.message, /unknown reason/);
    assert.equal(safe.httpStatus, undefined);
    assert.equal(safe.message.includes("sensitive-error-marker"), false);
  }
});

test("directory cohort loading resolves only bounded IDs and rejects cross-tenant reuse", async () => {
  const configured = { ...selection, source: "MicrosoftGraphDirectory", principalIds: [id(1)], approved: true };
  let calls = 0;
  const request = async ({ url }) => {
    calls++;
    assert.match(url, new RegExp(`/users/${id(1)}\\?`));
    return user(1);
  };
  const resolved = await resolveConfiguredCohort(request, configured, undefined, "tenant-a");
  assert.equal(resolved.approved, true);
  assert.equal(calls, 1);
  await assert.rejects(resolveConfiguredCohort(request, configured, undefined, "tenant-b"), /another tenant/);
  assert.equal(calls, 1);
});

test("local choices preserve other entries, clear pending values and never carry into changed scope", () => {
  const base = { kind: "hybridExchange", value: "yes", owner: "Owner", rationale: "Review needed", cohortId: "pilot" };
  const first = recordDecision(null, base, "tenant-a", "pilot");
  const second = recordDecision(first, { ...base, kind: "webGrounding", value: "restrict" }, "tenant-a", "pilot");
  assert.equal(second.decisions.hybridExchange.value, "yes");
  assert.equal(second.decisions.webGrounding.value, "restrict");
  const pending = recordDecision(second, { ...base, value: "unknown" }, "tenant-a", "pilot");
  assert.equal(pending.decisions.hybridExchange.value, "unknown");
  assert.deepEqual(decisionsForContext(second, "tenant-b", "pilot").decisions, {});
  assert.deepEqual(decisionsForContext(second, "tenant-a", "other").decisions, {});
  assert.throws(() => recordDecision(first, { ...base, owner: " " }, "tenant-a", "pilot"), /Owner/);
  assert.throws(() => recordDecision(first, { ...base, rationale: "" }, "tenant-a", "pilot"), /Rationale/);
  assert.throws(() => recordDecision(first, { ...base, cohortId: "other" }, "tenant-a", "pilot"), /current/);
});

test("cancelled directory requests do not return results or approve cohorts", async () => {
  const controller = new AbortController();
  await assert.rejects(directorySearch(async () => {
    controller.abort();
    return { value: [user(1)] };
  }, { query: "Synthetic", kind: "users" }, "tenant-a", controller.signal), /abort/i);
  await assert.rejects(resolveDirectoryCohort(() => assert.fail(), selection, controller.signal), /abort/i);
});
