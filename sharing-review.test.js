"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { performance } = require("node:perf_hooks");
const { buildSharingReview, pageReviewGroups, getReviewDetails, pageAllEvidence } = require("./sharing-review");

function row(index, overrides = {}) {
  return {
    evidenceId: `permission-${index}`, itemEvidenceId: `item-${index}`,
    siteId: "site-a", driveId: "drive-a", itemId: `item-${index}`,
    accessType: "user-direct-grant", inherited: true,
    inheritedFrom: { driveId: "drive-a", id: "parent-a" },
    roles: ["read"], principalRefs: ["user-a"], principalTypes: ["user"],
    principalNames: ["Synthetic user"], principalCount: 1,
    itemType: "File", siteDisplayName: "Synthetic site",
    driveDisplayName: "Documents", displayName: `Synthetic file ${index}`,
    ...overrides
  };
}
function scan(rows = [], observations = [], overrides = {}) {
  return {
    tenant: { tenantId: "synthetic-tenant" }, generatedAt: "2026-09-09T00:00:00Z",
    evidenceDetails: { permissionPaths: rows, broadAccessSites: observations }, ...overrides
  };
}
function all(model, bucket = "inventory") {
  const first = pageReviewGroups(model, { bucket, limit: 50 });
  const result = [...first.groups];
  for (let offset = 50; offset < first.total; offset += 50) {
    result.push(...pageReviewGroups(model, { bucket, offset, limit: 50 }).groups);
  }
  return result;
}

test("UMD exports the same API in a browser without require", () => {
  const context = {};
  vm.runInNewContext(fs.readFileSync(require.resolve("./sharing-review"), "utf8"), context);
  assert.equal(typeof context.FlightDeckSharingReview.buildSharingReview, "function");
  assert.equal(typeof context.FlightDeckSharingReview.pageAllEvidence, "function");
});

test("parent UI contract exposes items, count aliases and action context", () => {
  const model = buildSharingReview(scan([row(0), row(1, { itemType: "Folder" })]));
  for (const key of ["sitesScanned", "sampledItems", "distinctItems", "fileCount",
    "folderCount", "permissionRecords", "inheritedRecords", "unresolvedInheritedRecords",
    "reviewGroupCount", "inventoryGroupCount"]) {
    assert.equal(typeof model.summary[key], "number", key);
  }
  assert.equal(model.summary.fileCount, 1);
  assert.equal(model.summary.folderCount, 1);
  const page = pageReviewGroups(model, { bucket: "inventory" });
  assert.strictEqual(page.items, page.groups);
  const group = page.items[0];
  for (const key of ["id", "title", "siteName", "libraryName", "originStatus", "originLabel",
    "affectedItems", "permissionRecords", "severity", "reason", "nextAction", "owner",
    "coverageLabel", "evidenceCount"]) assert.ok(Object.hasOwn(group, key), key);
  const details = getReviewDetails(model, group.id);
  assert.strictEqual(details.items, details.records);
  for (const key of ["evidenceId", "itemEvidenceId", "displayName", "siteName", "libraryName",
    "itemType", "originStatus", "originLabel", "accessType", "roles", "reason", "nextAction"]) {
    assert.ok(Object.hasOwn(details.items[0], key), key);
  }
});

test("4094 legacy permission records become honest grouped inventory, not 4094 actions", () => {
  const rows = Array.from({ length: 4094 }, (_, i) => row(i, {
    itemId: `item-${i % 251}`, itemEvidenceId: `item-${i % 251}`,
    itemType: i % 251 < 215 ? "File" : "Folder",
    accessType: i < 994 ? "group-direct-grant" : "user-direct-grant",
    inherited: i < 3981,
    inheritedFrom: i < 3981 ? { driveId: "drive-a", id: "parent-a" } : null
  }));
  const model = buildSharingReview(scan(rows, [], { summary: { sampledItems: 251, sitesScanned: 28 } }));
  assert.equal(model.summary.permissionRecords, 4094);
  assert.equal(model.summary.inheritedRecords, 3981);
  assert.equal(model.summary.distinctItems, 251);
  assert.equal(model.summary.files, 215);
  assert.equal(model.summary.folders, 36);
  assert.equal(model.summary.scannedSites, 28);
  assert.equal(model.summary.reviewGroupCount, 0);
  assert.equal(model.summary.inventoryGroupCount, 115);
  assert.match(model.summary.boundedRootSampling, /does not establish readiness/);
  assert.match(model.coverageLabel, /Sampled 251.*not tenant-wide/);
  const inherited = all(model).filter(group => group.originStatus === "resolved");
  assert.equal(inherited.length, 2);
  assert.ok(inherited.every(group => !/\bdirect\b/i.test(group.title)));
  assert.ok(all(model).filter(group => group.originStatus === "direct").every(group => /not inherited/.test(group.title)));
});

test("same known parent groups; different parent, context, identity and roles never merge", () => {
  const model = buildSharingReview(scan([
    row(0), row(1),
    row(2, { inheritedFrom: { driveId: "drive-a", id: "parent-b" } }),
    row(3, { principalRefs: ["user-b"] }),
    row(4, { roles: ["write"] }),
    row(5, { siteId: "site-b" }),
    row(6, { driveId: "drive-b", inheritedFrom: { driveId: "drive-b", id: "parent-a" } }),
    row(7, { tenantId: "another-tenant" })
  ]));
  assert.equal(model.summary.inventoryGroupCount, 7);
  assert.equal(all(model).find(group => group.affectedItems === 2).permissionRecords, 2);
});

test("anonymous observations with unresolved origins remain reviewable without inventing a parent", () => {
  const unresolved = [
    null, {}, { id: "parent-a" }, { driveId: "another-drive", id: "parent-a" },
    { driveId: "drive-a", siteId: "another-site", id: "parent-a" },
    { driveId: "drive-a", path: "/drives/another-drive/root:/folder" },
    { driveId: "drive-a", path: "/drive/root:/../folder" }
  ];
  const model = buildSharingReview(scan(unresolved.map((inheritedFrom, i) =>
    row(i, { inheritedFrom, accessType: "anonymous-link" }))));
  assert.equal(model.summary.reviewGroupCount, 1);
  assert.equal(model.summary.inventoryGroupCount, 0);
  assert.equal(model.summary.unresolvedInheritedRecords, 7);
  const group = all(model, "review")[0];
  assert.equal(group.affectedItems, 7);
  assert.equal(group.severity, "High");
  assert.equal(group.originStatus, "unresolved");
  assert.match(group.originLabel, /Inheritance source unresolved/);
  assert.match(group.reason, /do not establish one effective parent/);
  assert.match(group.nextAction, /before choosing a remediation root/);
  assert.match(group.nextAction, /no remediation root is established/);
});

test("unresolved known risks and unknown access are review, ordinary grants and expired evidence are inventory", () => {
  const rows = ["anonymous-link", "organization-link", "broad-identity-grant", "guest-direct-grant",
    "future-access-kind", "user-direct-grant", "group-direct-grant"].map((accessType, i) =>
    row(i, { accessType, inheritedFrom: null }));
  rows.push(row(7, { accessType: "anonymous-link", inheritedFrom: null,
    expirationDateTime: "2000-01-01T00:00:00Z" }));
  rows.push(row(8, { accessType: "future-access-kind", inheritedFrom: null,
    expirationDateTime: "2000-01-01T00:00:00Z" }));
  const model = buildSharingReview(scan(rows));
  assert.equal(model.summary.reviewGroupCount, 5);
  assert.equal(model.summary.inventoryGroupCount, 4);
  const reviews = all(model, "review");
  assert.equal(reviews.filter(group => group.severity === "High").length, 1);
  assert.equal(reviews.filter(group => group.severity === "Medium").length, 3);
  assert.equal(reviews.filter(group => group.severity === "Unknown").length, 1);
  assert.ok(reviews.every(group => group.originStatus === "unresolved"));
  assert.ok(reviews.every(group => /do not establish one effective parent/.test(group.reason)));
  assert.ok(reviews.every(group => /Investigate.*no remediation root is established/.test(group.nextAction)));
  const unknown = pageReviewGroups(model, { severity: "unknown" });
  assert.equal(unknown.total, 1);
  assert.match(unknown.items[0].reason, /not normal or clean/);
  const inventory = all(model);
  assert.ok(inventory.every(group => group.severity === "Informational"));
  assert.equal(inventory.filter(group => group.expirationStatus === "expired").length, 2);
  assert.ok(inventory.filter(group => group.expirationStatus === "expired")
    .every(group => /Retain as historical evidence/.test(group.nextAction)));
});

test("path-only parents require matching context and retain distinct paths", () => {
  const model = buildSharingReview(scan([
    row(0, { inheritedFrom: { driveId: "drive-a", siteId: "site-a", path: "/drives/drive-a/root:/A" } }),
    row(1, { inheritedFrom: { driveId: "drive-a", siteId: "site-a", path: "/drives/drive-a/root:/A" } }),
    row(2, { inheritedFrom: { driveId: "drive-a", path: "/drives/drive-a/root:/B" } })
  ]));
  assert.equal(model.summary.inventoryGroupCount, 2);
  assert.ok(all(model).every(group => group.originStatus === "resolved"));
});

test("malformed Graph references do not create a resolved remediation origin", () => {
  const references = [
    { driveId: "drive-a", siteId: 42, id: "parent-a" },
    { driveId: "drive-a", path: "/drives/drive-a/root:not-a-rooted-path" },
    { driveId: "drive-a", path: "/drives/drive-a/root:/%2e%2e/folder" },
    { driveId: "drive-a", path: "/drives/drive-a/root:/%invalid" }
  ];
  const model = buildSharingReview(scan(references.map((inheritedFrom, i) => row(i, { inheritedFrom }))));
  assert.equal(model.summary.unresolvedInheritedRecords, 4);
});

test("legacy direct wire types cannot override inherited evidence or unknown inheritance", () => {
  const model = buildSharingReview(scan([
    row(0, { inherited: false }),
    row(1, { inherited: undefined, inheritedFrom: undefined }),
    row(2, { inherited: false, inheritedFrom: null }),
    row(3, { accessType: "inherited-permission", inherited: false, inheritedFrom: null })
  ]));
  assert.equal(model.summary.inheritedRecords, 2);
  assert.equal(model.summary.unknownOriginRecords, 1);
  const groups = all(model);
  assert.equal(groups.filter(group => group.originStatus === "direct").length, 1);
  assert.ok(groups.every(group => !/user-direct-grant/.test(group.title)));
});

test("public group observations request access validation, not exposure of all site files", () => {
  const observations = Array.from({ length: 7 }, (_, i) => ({
    evidenceId: `site-via-public-group:group-${i}`, groupId: `group-${i}`,
    displayName: `Public group ${i}`, resourceType: "SharePoint site",
    siteResolved: i > 0, siteId: i ? `site-${i}` : undefined
  }));
  const model = buildSharingReview(scan([row(0)], observations));
  assert.equal(model.summary.reviewGroupCount, 7);
  for (const group of all(model, "review")) {
    assert.equal(group.affectedItems, 0);
    assert.equal(group.permissionRecords, 0);
    assert.equal(group.observationRecords, 1);
    assert.match(group.reason, /does not prove that all site files are exposed/);
    assert.match(group.nextAction, /Validate/);
    assert.equal(group.originStatus, "unresolved");
  }
  assert.equal(model.summary.distinctItems, 1);
});

test("expired, active and uncertain expiration stay separate and use scan time", () => {
  const model = buildSharingReview(scan([
    row(0, { accessType: "anonymous-link", expirationDateTime: "2026-09-08T00:00:00Z" }),
    row(1, { accessType: "anonymous-link", expirationDateTime: "2026-09-09T00:00:00Z" }),
    row(2, { accessType: "anonymous-link", expirationDateTime: "2026-09-10T00:00:00Z" }),
    row(3, { accessType: "anonymous-link", expirationDateTime: "not-a-date" }),
    row(4, { accessType: "anonymous-link" }),
    row(5, { accessType: "organization-link" }),
    row(6, { accessType: "broad-identity-grant" }),
    row(7, { guestPrincipalCount: 1 })
  ]));
  assert.equal(model.summary.expiredRecords, 2);
  assert.equal(model.summary.uncertainExpirationRecords, 1);
  assert.equal(model.summary.reviewGroupCount, 6);
  assert.equal(all(model)[0].affectedItems, 2);
  assert.match(all(model)[0].reason, /not a current access-risk/);
  const uncertain = all(model, "review").find(group => group.expirationStatus === "uncertain");
  assert.match(uncertain.reason, /current access cannot be established/);
  const noTime = buildSharingReview(scan([
    row(0, { accessType: "anonymous-link", expirationDateTime: "2000-01-01T00:00:00Z" })
  ], [], { generatedAt: "invalid" }));
  assert.equal(noTime.summary.expiredRecords, 0);
  assert.equal(noTime.summary.uncertainExpirationRecords, 1);
});

test("ambiguous or impossible expiration dates are uncertain, not silently expired", () => {
  for (const expirationDateTime of ["1", "09/08/2026", "2026-02-30T00:00:00Z",
    "2026-09-08T00:00:00", "2026-09-08T24:00:00Z", 0, false]) {
    const model = buildSharingReview(scan([row(0, { expirationDateTime, accessType: "anonymous-link" })]));
    assert.equal(model.summary.expiredRecords, 0);
    assert.equal(model.summary.uncertainExpirationRecords, 1);
  }
});

test("unknown types and missing data are explicitly unknown, never clean", () => {
  const model = buildSharingReview(scan([row(0, { accessType: "future-type" }), {}]));
  assert.equal(model.summary.unknownAccessRecords, 2);
  assert.equal(model.summary.reviewGroupCount, 2);
  assert.equal(model.summary.inventoryGroupCount, 0);
  assert.ok(all(model, "review").every(group => group.accessLabel === "Unknown access type" && group.severity === "Unknown"));
  assert.match(all(model, "review").find(group => group.originStatus === "resolved").reason, /not normal or clean/);
  const empty = buildSharingReview({});
  assert.equal(empty.summary.permissionRecords, 0);
  assert.match(empty.summary.boundedRootSampling, /not.*tenant-wide.*does not establish readiness/);
});

test("distinct item counts deduplicate permission records without hiding raw evidence", () => {
  const original = row(0);
  const model = buildSharingReview(scan([original, original,
    row(1, { itemId: original.itemId, itemEvidenceId: original.itemEvidenceId }),
    row(2, { itemType: "Folder" })
  ]));
  const group = all(model)[0];
  assert.equal(group.affectedItems, 2);
  assert.equal(group.files, 1);
  assert.equal(group.folders, 1);
  assert.equal(group.permissionRecords, 4);
  assert.equal(group.evidenceCount, 3);
  assert.equal(getReviewDetails(model, group.id).total, 4);
});

test("immutable input, private full evidence, scalar cards and bounded detail projection", () => {
  const principals = Array.from({ length: 100 }, (_, i) => `principal-${i}`);
  const input = scan(Array.from({ length: 101 }, (_, i) => row(i, {
    principalRefs: principals, displayName: "<b>plain text, not HTML rendering</b>"
  })));
  const before = JSON.stringify(input);
  function freeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.values(value).forEach(freeze);
    return Object.freeze(value);
  }
  freeze(input);
  const model = buildSharingReview(input);
  const group = all(model)[0];
  assert.equal(JSON.stringify(input), before);
  assert.equal(group.evidenceCount, 101);
  assert.ok(Object.values(group).every(value => typeof value !== "object"));
  assert.ok(JSON.stringify(model).length < 2000);
  assert.ok(!JSON.stringify(model).includes("permission-100"));
  const page = getReviewDetails(model, group.id);
  assert.equal(page.records.length, 50);
  assert.equal(page.hasMore, true);
  assert.equal(page.records[0].displayName, "<b>plain text, not HTML rendering</b>");
  assert.ok(page.records.every(record => !Object.values(record).some(Array.isArray)));
  assert.equal(getReviewDetails(model, group.id, { offset: 100 }).records[0].evidenceId, "permission-100");
  assert.equal(getReviewDetails(model, group.id, { offset: 101 }).records.length, 0);
});

test("group and detail paging reject unsafe bounds rather than silently clamping", () => {
  const model = buildSharingReview(scan([row(0)]));
  const id = all(model)[0].id;
  for (const limit of [0, -1, 51, Infinity, NaN, 1.5, "25", null]) {
    assert.throws(() => pageReviewGroups(model, { limit }), RangeError);
    assert.throws(() => getReviewDetails(model, id, { limit }), RangeError);
    assert.throws(() => pageAllEvidence(model, { limit }), RangeError);
  }
  for (const offset of [-1, Infinity, NaN, 1.5, "0", null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => pageReviewGroups(model, { offset }), RangeError);
    assert.throws(() => getReviewDetails(model, id, { offset }), RangeError);
    assert.throws(() => pageAllEvidence(model, { offset }), RangeError);
  }
  for (const value of [null, [], "options"]) {
    assert.throws(() => pageReviewGroups(model, value), TypeError);
    assert.throws(() => getReviewDetails(model, id, value), TypeError);
    assert.throws(() => pageAllEvidence(model, value), TypeError);
  }
  assert.throws(() => pageReviewGroups(model, { bucket: "all" }), TypeError);
  assert.throws(() => pageReviewGroups(model, { query: {} }), TypeError);
  assert.throws(() => pageReviewGroups(model, { query: "x".repeat(1001) }), TypeError);
  assert.throws(() => getReviewDetails(model, "__proto__"), RangeError);
  assert.throws(() => pageReviewGroups(JSON.parse(JSON.stringify(model))), TypeError);
  assert.throws(() => pageAllEvidence(JSON.parse(JSON.stringify(model))), TypeError);
  assert.throws(() => buildSharingReview(scan(null)), TypeError);
  assert.throws(() => buildSharingReview(scan([null])), TypeError);
});

test("full evidence pages preserve every source row once, including expired and long fields", () => {
  const principalRefs = Array.from({ length: 400 }, (_, i) => `principal-${i}`);
  const webUrl = `https://synthetic.invalid/${"a".repeat(2500)}`;
  const displayName = "Long synthetic name ".repeat(100);
  const evidenceId = `permission-long-${"a".repeat(650)}`;
  const model = buildSharingReview(scan(Array.from({ length: 137 }, (_, i) => row(i, {
    inheritedFrom: { driveId: "drive-a", id: `parent-${i % 4}` },
    principalRefs, webUrl, displayName,
    evidenceId: i === 0 ? evidenceId : `permission-${i}`,
    accessType: i % 2 ? "user-direct-grant" : "anonymous-link",
    expirationDateTime: i % 2 ? undefined : "2000-01-01T00:00:00Z"
  })), [{
    evidenceId: "public-group-observation", groupId: "public-group", displayName: "Public group"
  }]));
  const exported = [];
  for (let offset = 0; offset < 138; offset += 50) {
    const page = pageAllEvidence(model, { offset, limit: 50 });
    assert.ok(page.items.length <= 50);
    assert.equal(page.total, 138);
    exported.push(...page.items);
  }
  assert.equal(exported.length, 138);
  assert.equal(new Set(exported.map(item => item.evidenceIndex)).size, 138);
  assert.equal(new Set(exported.map(item => `${item.source}:${item.sourceIndex}`)).size, 138);
  assert.equal(exported[0].evidenceId, evidenceId);
  assert.equal(exported[0].webUrl, webUrl);
  assert.equal(exported[0].displayName, displayName);
  assert.equal(exported[0].principalRefs, principalRefs.join("; "));
  assert.equal(exported[0].inheritedFromId, "parent-0");
  assert.equal(exported[0].expirationStatus, "expired");
  assert.match(exported[0].reason, /not a current access-risk/);
  assert.equal(exported[137].source, "broadAccessSites");
  assert.ok(exported.every(item => !Object.values(item).some(Array.isArray)));
  assert.equal(pageAllEvidence(model, { offset: 138 }).items.length, 0);
  assert.equal(pageAllEvidence(model, { offset: 138 }).hasMore, false);
  const detailIndices = all(model).concat(all(model, "review")).flatMap(group => {
    const first = getReviewDetails(model, group.id, { limit: 50 });
    const items = [...first.items];
    for (let offset = 50; offset < first.total; offset += 50) {
      items.push(...getReviewDetails(model, group.id, { offset, limit: 50 }).items);
    }
    return items.map(item => item.evidenceIndex);
  });
  assert.equal(new Set(detailIndices).size, 138);
  assert.equal(detailIndices.length, 138);
});

test("stable collision-free group IDs, canonical principal ordering and query paging", () => {
  const rows = Array.from({ length: 125 }, (_, i) => row(i, {
    inheritedFrom: { driveId: "drive-a", id: `parent-${i}` },
    principalRefs: i % 2 ? ["a", "b"] : ["b", "a"],
    siteDisplayName: i % 2 ? "Finance" : "Operations"
  }));
  const model = buildSharingReview(scan(rows));
  const reversed = buildSharingReview(scan([...rows].reverse()));
  const ids = all(model).map(group => [group.originLabel, group.id]).sort();
  assert.deepEqual(ids, all(reversed).map(group => [group.originLabel, group.id]).sort());
  assert.equal(new Set(ids.map(entry => entry[1])).size, 125);
  assert.equal(pageReviewGroups(model, { bucket: "inventory" }).groups.length, 25);
  const page = pageReviewGroups(model, { bucket: "inventory", query: "FINANCE", limit: 50 });
  assert.equal(page.total, 62);
  assert.equal(page.groups.length, 50);
  assert.equal(page.hasMore, true);
  assert.equal(pageReviewGroups(model, {
    bucket: "inventory", query: "Finance", offset: 50, limit: 50
  }).groups.length, 12);
  const joinedModel = buildSharingReview(scan([
    row(0, { principalRefs: ["a", "b"], roles: ["write", "read"] }),
    row(1, { principalRefs: ["b", "a", "a"], roles: ["read", "write"] })
  ]));
  assert.equal(joinedModel.summary.inventoryGroupCount, 1);
});

test("severity filters run before pagination and combine with text and bucket filters", () => {
  const model = buildSharingReview(scan(Array.from({ length: 140 }, (_, i) => row(i, {
    inheritedFrom: { driveId: "drive-a", id: `parent-${i}` },
    accessType: i < 70 ? "anonymous-link" : "organization-link",
    siteDisplayName: i % 2 ? "Finance" : "Operations"
  })).concat([row(141)])));
  const medium = pageReviewGroups(model, { severity: "medium", offset: 50, limit: 25 });
  assert.equal(medium.total, 70);
  assert.equal(medium.items.length, 20);
  assert.ok(medium.items.every(item => item.severity === "Medium"));
  assert.equal(medium.hasMore, false);
  const finance = pageReviewGroups(model, { severity: "medium", query: "Finance", offset: 25 });
  assert.equal(finance.total, 35);
  assert.equal(finance.items.length, 10);
  assert.ok(finance.items.every(item => item.siteName === "Finance" && item.severity === "Medium"));
  assert.equal(pageReviewGroups(model, { severity: "high" }).total, 70);
  assert.equal(pageReviewGroups(model, { severity: "all" }).total, 140);
  assert.equal(pageReviewGroups(model).total, 140);
  assert.equal(pageReviewGroups(model, { bucket: "inventory", severity: "info" }).total, 1);
  assert.equal(pageReviewGroups(model, { bucket: "inventory", severity: "all" }).total, 1);
  for (const severity of ["critical", "low", "unknown"]) {
    assert.equal(pageReviewGroups(model, { severity }).total, 0);
  }
  for (const severity of [null, "High", "informational", "", 1, {}, []]) {
    assert.throws(() => pageReviewGroups(model, { severity }), TypeError);
  }
});

test("100k records build and page without exposing a large nested public payload", () => {
  const rows = Array.from({ length: 100000 }, (_, i) => row(i, {
    itemId: `item-${i % 1000}`, itemEvidenceId: `item-${i % 1000}`,
    inheritedFrom: { driveId: "drive-a", id: `parent-${i % 20}` }
  }));
  const start = performance.now();
  const model = buildSharingReview(scan(rows));
  const page = pageReviewGroups(model, { bucket: "inventory", limit: 50 });
  const detail = getReviewDetails(model, page.groups[0].id, { offset: 4950, limit: 50 });
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 5000, `100k build + paging took ${elapsed.toFixed(0)}ms (budget 5000ms)`);
  assert.equal(model.summary.permissionRecords, 100000);
  assert.equal(model.summary.distinctItems, 1000);
  assert.equal(page.groups.length, 20);
  assert.equal(detail.total, 5000);
  assert.equal(detail.records.length, 50);
  assert.equal(detail.hasMore, false);
  assert.ok(JSON.stringify(model).length < 2000);
});
