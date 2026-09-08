"use strict";

const crypto = require("crypto");
const DIRECTORY_LIMIT = 50;
const DIRECTORY_TTL_MS = 15 * 60 * 1000;
const GRAPH = "https://graph.microsoft.com/v1.0";
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(value, label, maximum) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum ||
      /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} is required and must be at most ${maximum} characters.`);
  }
  return value.trim();
}

function sameTenant(left, right) {
  return typeof left === "string" && typeof right === "string" &&
    !!left && left.toLowerCase() === right.toLowerCase();
}

function safeDirectoryError(error) {
  const codes = {
    InvalidAuthenticationToken: 401, AuthenticationError: 401, Unauthorized: 401,
    Authorization_RequestDenied: 403, AccessDenied: 403, ErrorAccessDenied: 403, Forbidden: 403,
    TooManyRequests: 429, activityLimitReached: 429, throttledRequest: 429
  };
  const code = typeof error?.code === "string" ? error.code :
    [401, 403, 429].includes(error?.code) ? String(error.code) : "";
  const status = [401, 403, 429].find(value =>
    Number(error?.status) === value || Number(error?.statusCode) === value ||
    Number(error?.httpStatus) === value || code === String(value)) ||
    (Object.hasOwn(codes, code) ? codes[code] : undefined);
  const messages = {
    401: "Directory authentication was rejected. Sign in again to the baseline tenant.",
    403: "Directory access was denied. Review the signed-in account's directory read permissions.",
    429: "Microsoft Graph throttled the directory request. Wait before trying again."
  };
  const safe = new Error(messages[status] ||
    "The directory request failed for an unknown reason. Try again or review Microsoft service health; additional permissions may not resolve it.");
  safe.code = Object.hasOwn(codes, code) ? code : status ? String(status) : "DIRECTORY_REQUEST_FAILED";
  if (status) safe.httpStatus = status;
  safe.directoryRequestError = true;
  return safe;
}

function validateDirectorySearch(input) {
  if (!["users", "groups"].includes(input.kind)) throw new Error("Choose users or groups.");
  return { kind: input.kind, query: text(input.query, "Search text", 80) };
}

async function directorySearch(request, input, tenantId, signal) {
  const { query, kind } = validateDirectorySearch(input);
  const literal = query.replace(/'/g, "''");
  const filter = `startswith(displayName,'${literal}')` +
    (kind === "users" ? ` or startswith(userPrincipalName,'${literal}')` : "");
  const url = new URL(`${GRAPH}/${kind}`);
  url.searchParams.set("$filter", filter);
  url.searchParams.set("$select", kind === "users" ? "id,displayName,userPrincipalName" : "id,displayName");
  url.searchParams.set("$top", String(DIRECTORY_LIMIT));
  signal?.throwIfAborted();
  const response = await request({ url: url.href, method: "GET", signal });
  signal?.throwIfAborted();
  if (!Array.isArray(response.value)) throw new Error("The directory search returned an incomplete response.");
  const items = response.value.slice(0, DIRECTORY_LIMIT).map(item => {
    if (!ID.test(item.id)) throw new Error("The directory returned an invalid identity.");
    const result = { id: item.id, displayName: String(item.displayName || "").slice(0, 256) };
    if (kind === "users" && typeof item.userPrincipalName === "string") {
      result.userPrincipalName = item.userPrincipalName;
    }
    return result;
  });
  return { tenantId, kind, items, hasMore: !!response["@odata.nextLink"] || response.value.length > DIRECTORY_LIMIT };
}

function validateDirectorySelection(input, sourceJob, tenantId, now = Date.now()) {
  const source = sourceJob?.directoryResult;
  const completed = Date.parse(sourceJob?.completedAt);
  if (sourceJob?.action !== "directorySearch" || sourceJob.status !== "completed" ||
      !source || !Number.isFinite(completed) || now < completed || now - completed > DIRECTORY_TTL_MS) {
    throw new Error("Run a new directory search; the completed search is missing or older than 15 minutes.");
  }
  if (!sameTenant(source.tenantId, tenantId)) throw new Error("The directory search belongs to another tenant.");
  const maximum = source.kind === "groups" ? 10 : 50;
  if (input.approved !== true || !Array.isArray(input.selectedIds) ||
      !input.selectedIds.length || input.selectedIds.length > maximum) {
    throw new Error(`Explicitly approve 1–${maximum} directory selections.`);
  }
  const available = new Set(source.items.map(item => item.id.toLowerCase()));
  const ids = [...new Set(input.selectedIds.map(id => {
    if (typeof id !== "string" || !ID.test(id) || !available.has(id.toLowerCase())) {
      throw new Error("A selected identity was not in the completed directory search.");
    }
    return id.toLowerCase();
  }))];
  return {
    kind: source.kind, selectedIds: ids, tenantId,
    name: text(input.name, "Cohort name", 120),
    owner: text(input.owner, "Owner", 200), approved: true
  };
}

function safeNextLink(next, initial) {
  const url = new URL(next);
  const allowed = new URL(initial);
  if (url.origin !== allowed.origin || url.pathname !== allowed.pathname ||
      url.username || url.password || url.hash) {
    throw new Error("Directory pagination left the approved Graph v1.0 collection.");
  }
  return url.href;
}

function validateUser(user, expectedId) {
  if (!user || !ID.test(user.id) || (expectedId && user.id.toLowerCase() !== expectedId.toLowerCase()) ||
      user.accountEnabled !== true || typeof user.userPrincipalName !== "string" ||
      !/^[^\s@]+@[^\s@]+$/.test(user.userPrincipalName)) {
    throw new Error("A selected user is disabled or has an unresolved identity; no cohort was approved.");
  }
  return { id: user.id.toLowerCase(), userPrincipalName: user.userPrincipalName };
}

async function resolveDirectoryUsers(request, ids, signal) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || ids.some(id => !ID.test(id))) {
    throw new Error("The directory cohort has invalid or excessive identities.");
  }
  const users = [];
  for (const id of ids) {
    signal?.throwIfAborted();
    users.push(validateUser(await request({
      url: `${GRAPH}/users/${id}?$select=id,userPrincipalName,accountEnabled`,
      method: "GET", signal
    }), id));
  }
  signal?.throwIfAborted();
  return users;
}

async function resolveDirectoryCohort(request, selection, signal, now = new Date()) {
  const users = new Map();
  if (selection.kind === "users") {
    for (const user of await resolveDirectoryUsers(request, selection.selectedIds, signal)) users.set(user.id, user);
  } else {
    let members = 0;
    let pages = 0;
    for (const id of selection.selectedIds) {
      if (!ID.test(id)) throw new Error("Invalid group identity.");
      const initial = `${GRAPH}/groups/${id}/transitiveMembers/microsoft.graph.user?` +
        "$select=id,userPrincipalName,accountEnabled&$top=100&$count=true";
      let url = initial;
      const visited = new Set();
      const groupUsers = new Set();
      let advertisedCount;
      while (url) {
        signal?.throwIfAborted();
        if (++pages > 10 || visited.has(url)) throw new Error("Group membership is incomplete: the 10-page limit was reached.");
        visited.add(url);
        const response = await request({ url, method: "GET", signal, consistencyLevel: "eventual" });
        if (!Array.isArray(response.value)) throw new Error("Group membership is incomplete.");
        if (Object.hasOwn(response, "@odata.count")) {
          const count = response["@odata.count"];
          if (!Number.isInteger(count) || count < 0) throw new Error("Group membership returned an invalid count.");
          if (count > 1000) throw new Error("Group membership is incomplete: the 1000-member limit was reached.");
          if (advertisedCount !== undefined && advertisedCount !== count) {
            throw new Error("Group membership changed during pagination; run a new directory selection.");
          }
          advertisedCount = count;
        }
        members += response.value.length;
        if (members > 1000) throw new Error("Group membership is incomplete: the 1000-member limit was reached.");
        for (const entry of response.value) {
          const user = validateUser(entry);
          users.set(user.id, user);
          groupUsers.add(user.id);
        }
        url = response["@odata.nextLink"] ? safeNextLink(response["@odata.nextLink"], initial) : null;
      }
      if (advertisedCount !== undefined && advertisedCount !== groupUsers.size) {
        throw new Error("Group membership is incomplete: the returned membership does not match its directory count.");
      }
    }
  }
  signal?.throwIfAborted();
  if (!users.size) throw new Error("No enabled users were resolved; no cohort was approved.");
  const sorted = [...users.values()].sort((a, b) => a.id.localeCompare(b.id));
  return {
    id: `directory-${crypto.randomUUID()}`, name: selection.name, owner: selection.owner,
    tenantId: selection.tenantId, approved: true, source: "MicrosoftGraphDirectory",
    scopeSnapshotTime: now.toISOString(), principalIds: sorted.map(user => user.id),
    userPrincipalNames: sorted.map(user => user.userPrincipalName), population: sorted.length,
    resolutionComplete: true,
    ...(selection.kind === "groups" ? {
      membershipConsistency: "eventual",
      scopeSnapshotLimitation: "Group membership uses the Microsoft Graph eventually consistent directory index. " +
        "Recent membership changes may not yet be reflected; this snapshot is not proof of instant current-group membership."
    } : {})
  };
}

function decisionsForContext(document, tenantId, cohortId) {
  return { tenantId, cohortId, decisions:
    sameTenant(document?.tenantId, tenantId) && document?.cohortId === cohortId
      ? document.decisions || {} : {} };
}

function recordDecision(document, input, tenantId, cohortId, now = new Date()) {
  const options = { hybridExchange: ["yes", "no", "unknown"], webGrounding: ["allow", "restrict", "undecided"] };
  if (!Object.hasOwn(options, input.kind) || !options[input.kind].includes(input.value)) {
    throw new Error("Unsupported setup decision.");
  }
  if (!cohortId || input.cohortId !== cohortId) throw new Error("The decision must target the current baseline cohort.");
  const next = decisionsForContext(document, tenantId, cohortId);
  return { ...next, decisions: { ...next.decisions, [input.kind]: {
    value: input.value, owner: text(input.owner, "Owner", 200),
    rationale: text(input.rationale, "Rationale", 2000), recordedAt: now.toISOString()
  } } };
}

module.exports = { DIRECTORY_LIMIT, DIRECTORY_TTL_MS, sameTenant, safeDirectoryError, validateDirectorySearch,
  directorySearch, validateDirectorySelection, safeNextLink, resolveDirectoryUsers,
  resolveDirectoryCohort, decisionsForContext, recordDecision };
