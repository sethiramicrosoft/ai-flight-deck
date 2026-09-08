(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FlightDeckSharingReview = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Raw row references and complete canonical identities never enter the public model.
  const indices = new WeakMap();
  const knownTypes = new Set([
    "anonymous-link", "organization-link", "specific-people-link",
    "broad-identity-grant", "guest-direct-grant", "group-direct-grant",
    "user-direct-grant", "application-grant", "inherited-permission"
  ]);
  const string = value => typeof value === "string" ? value : "";
  const text = (value, fallback = "", max = 600) =>
    (string(value) || fallback).slice(0, max);
  const canonical = value => JSON.stringify(value);
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const list = (value, name) => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
    return value;
  };
  const strings = value => Array.isArray(value)
    ? [...new Set(value.filter(item => typeof item === "string"))].sort() : [];
  const joined = value => text(strings(value).join("; "), "", 1200);

  function timestamp(value) {
    const match = string(value).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/);
    if (!match) return NaN;
    const [, year, month, day, hour, minute, second] = match.map(Number);
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (month < 1 || month > 12 || day < 1 || day > days ||
        hour > 23 || minute > 59 || second > 59) return NaN;
    return Date.parse(value);
  }

  function options(value, defaultLimit, withBucket) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("Paging options must be an object.");
    }
    const { offset = 0, limit = defaultLimit, query = "", bucket = "review", severity = "all" } = value;
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new RangeError("offset must be a nonnegative safe integer.");
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      throw new RangeError("limit must be an integer between 1 and 50.");
    }
    if (withBucket && !["review", "inventory"].includes(bucket)) {
      throw new TypeError("bucket must be review or inventory.");
    }
    if (withBucket && (typeof query !== "string" || query.length > 1000)) {
      throw new TypeError("query must be a string of at most 1000 characters.");
    }
    if (withBucket && !["all", "critical", "high", "medium", "low", "info", "unknown"].includes(severity)) {
      throw new TypeError("severity must be all, critical, high, medium, low, info or unknown.");
    }
    return { offset, limit, query, bucket, severity };
  }

  function privateIndex(model) {
    const index = indices.get(model);
    if (!index) throw new TypeError("Use a model returned by buildSharingReview.");
    return index;
  }

  function itemKey(row, context, index) {
    if (string(row.itemId) && context[1] && context[2]) {
      return canonical([...context, "item", row.itemId]);
    }
    if (string(row.itemEvidenceId)) return canonical([...context, "evidence", row.itemEvidenceId]);
    // Names and ACL similarity cannot establish item identity.
    return canonical([...context, "unidentified-record", string(row.evidenceId) || index]);
  }

  function origin(row, context, item) {
    const ref = row.inheritedFrom;
    const hasReference = ref !== undefined && ref !== null;
    const inherited = row.inherited === true || hasReference ||
      row.accessType === "inherited-permission";
    if (inherited) {
      if (ref && typeof ref === "object" && !Array.isArray(ref) &&
          context[1] && context[2] && string(ref.driveId) === context[2] &&
          (ref.siteId === undefined || ref.siteId === null || ref.siteId === "" || ref.siteId === context[1])) {
        if (string(ref.id)) {
          return { status: "resolved", key: ["parent-item", ref.id],
            label: `Inherited from item ${ref.id}`, inherited: true };
        }
        const path = string(ref.path);
        const driveRoot = `/drives/${context[2]}/root:`;
        const root = [driveRoot, "/drive/root:"].find(prefix =>
          path === prefix || path.startsWith(`${prefix}/`));
        let segments;
        try { segments = decodeURIComponent(path).split("/"); } catch { segments = [".."]; }
        if (root && !segments.some(part => part === ".." || part === ".")) {
          return { status: "resolved", key: ["parent-path", path],
            label: `Inherited from ${path}`, inherited: true };
        }
      }
      return { status: "unresolved", key: ["unresolved-inheritance"],
        label: "Inheritance source unresolved", inherited: true };
    }
    if (row.inherited === false && (string(row.itemId) || string(row.itemEvidenceId))) {
      return { status: "direct", key: ["direct-item", item],
        label: "Permission on this sampled item (not inherited)", inherited: false };
    }
    return { status: "unresolved", key: ["unknown-origin"],
      label: "Permission origin unknown", inherited: false };
  }

  function expiry(row, observedAt) {
    if (row.expirationDateTime === undefined || row.expirationDateTime === null ||
        row.expirationDateTime === "") return "not-specified";
    const end = timestamp(row.expirationDateTime);
    if (!Number.isFinite(end) || !Number.isFinite(observedAt)) return "uncertain";
    return end <= observedAt ? "expired" : "active";
  }

  function access(row) {
    const type = string(row.accessType);
    const scope = string(row.linkScope);
    const known = knownTypes.has(type);
    if (type === "anonymous-link" || scope === "anonymous") {
      return { kind: "anonymous", label: "Anonymous sharing link", risk: 1, known };
    }
    if (type === "organization-link" || scope === "organization") {
      return { kind: "organization", label: "Organization-wide sharing link", risk: 2, known };
    }
    if (type === "broad-identity-grant") {
      return { kind: "broad-identity", label: "Broad-identity permission", risk: 2, known };
    }
    if (type === "guest-direct-grant" || count(row.guestPrincipalCount) > 0 ||
        strings(row.principalTypes).some(value => /^(guest|external)$/i.test(value))) {
      return { kind: "external", label: "External-principal permission", risk: 2, known };
    }
    const label = {
      "group-direct-grant": "Group permission", "user-direct-grant": "User permission",
      "application-grant": "Application permission",
      "specific-people-link": "Specific-people sharing link",
      "inherited-permission": "Inherited permission"
    }[type] || "Unknown access type";
    return { kind: type || "unknown", label, risk: 0, known };
  }

  function itemKind(row) {
    const kind = string(row.itemType).toLowerCase();
    return kind === "file" || kind === "folder" ? kind : "unknown";
  }

  function addItem(items, key, kind) {
    const existing = items.get(key);
    if (!existing) items.set(key, kind);
    else if (existing !== kind) items.set(key, "unknown");
  }

  function itemCounts(items) {
    let files = 0;
    let folders = 0;
    for (const kind of items.values()) {
      if (kind === "file") files++;
      if (kind === "folder") folders++;
    }
    return { distinctItems: items.size, files, folders, unknownItemTypes: items.size - files - folders };
  }

  function owner(row) {
    return text(row.ownerDisplayName || row.ownerName ||
      (typeof row.owner === "string" ? row.owner : row.owner?.displayName), "Owner not assigned");
  }

  function buildSharingReview(scan) {
    if (!scan || typeof scan !== "object" || Array.isArray(scan)) {
      throw new TypeError("scan must be an object.");
    }
    const rows = list(scan.evidenceDetails?.permissionPaths, "permissionPaths");
    const observations = list(scan.evidenceDetails?.broadAccessSites, "broadAccessSites");
    const tenant = string(scan.tenant?.tenantId) || string(scan.tenant?.id);
    const observedAt = timestamp(scan.generatedAt);
    const groups = new Map();
    const allRefs = [];
    const allItems = new Map();
    const sites = new Set();
    let inheritedRecords = 0;
    let unresolvedInheritedRecords = 0;
    let unknownAccessRecords = 0;
    let expiredRecords = 0;
    let uncertainExpirationRecords = 0;
    let unknownOriginRecords = 0;

    function accumulate(key, card, row, source, rawIndex, item, kind) {
      let group = groups.get(key);
      if (!group) {
        group = { card, refs: [], items: new Map(), evidence: new Set(), owners: new Set() };
        groups.set(key, group);
      }
      const ref = { row, source, rawIndex, group, evidenceIndex: allRefs.length };
      group.refs.push(ref);
      allRefs.push(ref);
      if (item !== null) addItem(group.items, item, kind);
      group.evidence.add(string(row.evidenceId) || canonical([source, rawIndex]));
      const namedOwner = owner(row);
      if (namedOwner !== "Owner not assigned") group.owners.add(namedOwner);
      group.card.permissionRecords += source === "permissionPaths" ? 1 : 0;
      group.card.observationRecords += source === "broadAccessSites" ? 1 : 0;
      return group;
    }

    rows.forEach((row, rawIndex) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        throw new TypeError(`permissionPaths[${rawIndex}] must be an object.`);
      }
      const context = [string(row.tenantId) || tenant, string(row.siteId), string(row.driveId)];
      const item = itemKey(row, context, rawIndex);
      const source = origin(row, context, item);
      const pattern = access(row);
      const expirationStatus = expiry(row, observedAt);
      if (context[1]) sites.add(canonical(context.slice(0, 2)));
      addItem(allItems, item, itemKind(row));
      if (source.inherited) inheritedRecords++;
      if (source.inherited && source.status === "unresolved") unresolvedInheritedRecords++;
      if (!source.inherited && source.status === "unresolved") unknownOriginRecords++;
      if (!pattern.known) unknownAccessRecords++;
      if (expirationStatus === "expired") expiredRecords++;
      if (expirationStatus === "uncertain") uncertainExpirationRecords++;
      const review = (pattern.risk > 0 || !pattern.known) && expirationStatus !== "expired";
      const bucket = review ? "review" : "inventory";
      const priority = review ? (!pattern.known ? 4 : expirationStatus === "uncertain" ? 3 : pattern.risk) : 0;
      const reason = expirationStatus === "expired"
        ? "Permission expired at or before the scan timestamp; not a current access-risk observation."
        : source.status === "unresolved"
          ? "Permission origin is unresolved. These library-level records do not establish one effective parent or remediation root."
          : pattern.risk
            ? `${pattern.label} observed on sampled items; validate effective access and business need.`
            : pattern.known
              ? "Observed permission inventory; an ordinary user or group permission is not automatically a remediation action."
              : "Unrecognized access type; this evidence is unknown, not normal or clean.";
      const expirationNote = expirationStatus === "uncertain"
        ? " Expiration is uncertain; current access cannot be established from the timestamp."
        : expirationStatus === "not-specified" ? " No expiration was supplied." : "";
      const key = canonical([context, source.key, pattern.kind, string(row.accessType),
        string(row.linkScope), string(row.linkType), strings(row.roles),
        strings(row.principalRefs), strings(row.principalTypes),
        // Names distinguish observations when durable principal IDs were not collected.
        strings(row.principalRefs).length ? [] : strings(row.principalNames),
        count(row.principalCount), count(row.guestPrincipalCount), expirationStatus]);
      accumulate(key, {
        bucket, title: text(`${pattern.label} — ${source.label}`),
        siteName: text(row.siteDisplayName, context[1] || "Site not identified"),
        libraryName: text(row.driveDisplayName, context[2] || "Library not identified"),
        originStatus: source.status, originLabel: text(source.label),
        reason: reason + expirationNote + (!pattern.known && (pattern.risk || source.status === "unresolved")
          ? " Access type is unrecognized; this evidence is unknown, not normal or clean." : ""),
        nextAction: expirationStatus === "expired"
          ? "Retain as historical evidence; re-collect to confirm current access."
          : source.status === "unresolved"
            ? "Investigate the inheritance or permission origin and effective access before choosing a remediation root; no remediation root is established."
            : !pattern.known
              ? "Investigate the unsupported access type and effective access; no remediation root is established by this unknown observation."
              : review
                ? "Ask the accountable owner to validate effective access, intended audience and business need before making changes."
                : "Retain in inventory; review against business need when an accountable owner identifies a concern.",
        permissionRecords: 0, observationRecords: 0,
        severity: review ? (!pattern.known ? "Unknown" : priority === 1 ? "High" : "Medium") : "Informational",
        reviewPriority: priority, expirationStatus,
        accessLabel: pattern.label
      }, row, "permissionPaths", rawIndex, item, itemKind(row));
    });

    observations.forEach((row, rawIndex) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        throw new TypeError(`broadAccessSites[${rawIndex}] must be an object.`);
      }
      const key = canonical(["public-group", string(row.tenantId) || tenant,
        string(row.siteId), string(row.groupId) || string(row.evidenceId) || rawIndex]);
      accumulate(key, {
        bucket: "review", title: text(row.displayName, "Public Microsoft 365 group"),
        siteName: text(row.siteDisplayName, row.siteResolved === true && string(row.siteId)
          ? row.siteId : "Associated site not resolved"),
        libraryName: "Not established by group visibility",
        originStatus: "unresolved", originLabel: "Public group; effective site access not validated",
        reason: "Public Microsoft 365 group observed. Group visibility does not prove that all site files are exposed; effective access needs validation.",
        nextAction: "Validate the group-to-site association, effective membership and permissions with the accountable owner before changing access.",
        permissionRecords: 0, observationRecords: 0, severity: "Medium", reviewPriority: 3,
        expirationStatus: "not-applicable", accessLabel: "Public Microsoft 365 group observation"
      }, row, "broadAccessSites", rawIndex, null, "unknown");
    });

    const totals = itemCounts(allItems);
    const sampledItems = count(scan.summary?.sampledItems) ?? totals.distinctItems;
    const scannedSites = count(scan.summary?.sitesScanned) ?? sites.size;
    const boundedRootSampling = "Bounded root-item sampling only; not a recursive inventory or tenant-wide access assessment. Absence of review groups does not establish readiness.";
    const coverageLabel = `Sampled ${sampledItems} root items across ${scannedSites} scanned sites; not tenant-wide.`;
    const byId = new Map();
    const buckets = { review: [], inventory: [] };
    [...groups.keys()].sort().forEach((key, ordinal) => {
      const group = groups.get(key);
      const counts = itemCounts(group.items);
      const id = `sharing-group-${ordinal + 1}`;
      group.card = Object.freeze({
        id, groupId: id, ...group.card, affectedItems: counts.distinctItems,
        files: counts.files, folders: counts.folders, unknownItemTypes: counts.unknownItemTypes,
        evidenceCount: group.evidence.size, coverageLabel,
        owner: group.owners.size === 1 ? group.owners.values().next().value
          : group.owners.size > 1 ? "Multiple sourced owners; see details" : "Owner not assigned"
      });
      group.search = Object.values(group.card).filter(value => typeof value === "string").join(" ").toLowerCase();
      delete group.items;
      delete group.evidence;
      delete group.owners;
      byId.set(id, group);
      buckets[group.card.bucket].push(group);
    });
    buckets.review.sort((a, b) => a.card.reviewPriority - b.card.reviewPriority ||
      b.card.affectedItems - a.card.affectedItems || a.card.id.localeCompare(b.card.id));
    const model = Object.freeze({
      summary: Object.freeze({
        scannedSites, sitesScanned: scannedSites, sampledItems, ...totals,
        fileCount: totals.files, folderCount: totals.folders,
        permissionRecords: rows.length, inheritedRecords, unresolvedInheritedRecords,
        unknownOriginRecords, unknownAccessRecords, expiredRecords, uncertainExpirationRecords,
        publicGroupObservations: observations.length,
        reviewGroupCount: buckets.review.length, inventoryGroupCount: buckets.inventory.length,
        boundedRootSampling, samplingCountSource: count(scan.summary?.sampledItems) === null
          ? "Distinct permission-path items (sampling total not supplied)" : "Scan summary",
        scanTimestampStatus: Number.isFinite(observedAt) ? "known" : "unknown"
      }),
      coverageLabel
    });
    indices.set(model, { byId, buckets, observedAt, allRefs, tenant });
    return model;
  }

  function pageReviewGroups(model, value = {}) {
    const index = privateIndex(model);
    const { offset, limit, query, bucket, severity } = options(value, 25, true);
    const needle = query.trim().toLowerCase();
    const groups = [];
    let total = 0;
    for (const group of index.buckets[bucket]) {
      const level = string(group.card.severity).toLowerCase();
      const normalizedLevel = level === "informational" ? "info"
        : ["critical", "high", "medium", "low", "info"].includes(level) ? level : "unknown";
      if (severity !== "all" && severity !== normalizedLevel) continue;
      if (needle && !group.search.includes(needle)) continue;
      if (total >= offset && groups.length < limit) groups.push(group.card);
      total++;
    }
    return { items: groups, groups, total, offset, limit, hasMore: offset < total - groups.length };
  }

  function projectRecord({ row, source, rawIndex, group, evidenceIndex }, index, full = false) {
    const field = full ? (value, fallback = "") => string(value) || fallback : text;
    const values = full ? value => Array.isArray(value)
      ? value.map(item => typeof item === "string" ? item : JSON.stringify(item)).join("; ")
      : "" : joined;
    const originLabel = full && source === "permissionPaths"
      ? origin(row, [string(row.tenantId) || index.tenant, string(row.siteId), string(row.driveId)],
        itemKey(row, [string(row.tenantId) || index.tenant, string(row.siteId), string(row.driveId)], rawIndex)).label
      : group.card.originLabel;
    return {
      source, sourceIndex: rawIndex, evidenceIndex, groupId: group.card.id,
      evidenceId: field(row.evidenceId), itemEvidenceId: field(row.itemEvidenceId),
      siteId: field(row.siteId), driveId: field(row.driveId), itemId: field(row.itemId),
      displayName: field(row.displayName, "Unnamed resource"),
      siteName: field(row.siteDisplayName, group.card.siteName),
      libraryName: field(row.driveDisplayName, group.card.libraryName),
      itemType: field(row.itemType, source === "broadAccessSites" ? "Group observation" : "Unknown"),
      webUrl: field(row.webUrl, "", 2048), owner: full
        ? field(row.ownerDisplayName || row.ownerName ||
          (typeof row.owner === "string" ? row.owner : row.owner?.displayName), "Owner not assigned")
        : owner(row),
      accessLabel: group.card.accessLabel, accessType: field(row.accessType, "Unknown"),
      originStatus: group.card.originStatus, originLabel,
      reason: group.card.reason, nextAction: group.card.nextAction,
      inherited: source === "broadAccessSites" ? null
        : row.inherited === true || row.inheritedFrom != null || row.accessType === "inherited-permission"
          ? true : row.inherited === false ? false : null,
      inheritedFromId: field(row.inheritedFrom?.id),
      inheritedFromDriveId: field(row.inheritedFrom?.driveId),
      inheritedFromSiteId: field(row.inheritedFrom?.siteId),
      inheritedFromPath: field(row.inheritedFrom?.path),
      roles: values(row.roles), principalRefs: values(row.principalRefs),
      principalNames: values(row.principalNames), principalTypes: values(row.principalTypes),
      principalCount: count(row.principalCount), guestPrincipalCount: count(row.guestPrincipalCount),
      expirationDateTime: field(row.expirationDateTime),
      expirationStatus: source === "broadAccessSites" ? "not-applicable" : expiry(row, index.observedAt),
      linkScope: field(row.linkScope), linkType: field(row.linkType)
    };
  }

  function getReviewDetails(model, groupId, value = {}) {
    const index = privateIndex(model);
    const { offset, limit } = options(value, 50, false);
    if (typeof groupId !== "string" || !index.byId.has(groupId)) {
      throw new RangeError("Unknown sharing review group ID.");
    }
    const group = index.byId.get(groupId);
    const records = group.refs.slice(offset, offset + limit).map(ref => projectRecord(ref, index));
    return { group: group.card, items: records, records, total: group.refs.length, offset, limit,
      hasMore: offset < group.refs.length - records.length };
  }

  // Opt-in CSV traversal: each source row appears once, including expired evidence.
  function pageAllEvidence(model, value = {}) {
    const index = privateIndex(model);
    const { offset, limit } = options(value, 50, false);
    const items = index.allRefs.slice(offset, offset + limit).map(ref => projectRecord(ref, index, true));
    return { items, total: index.allRefs.length, offset, limit,
      hasMore: offset < index.allRefs.length - items.length };
  }

  return Object.freeze({ buildSharingReview, pageReviewGroups, getReviewDetails, pageAllEvidence });
});
