"use strict";

const crypto = require("node:crypto");

const AUTH_MODES = Object.freeze({
  LOCAL_DELEGATED: "local-delegated",
  PRODUCTION_APPLICATION: "production-application"
});

const AUTH_MODE_ALIASES = new Map([
  ["local-delegated", AUTH_MODES.LOCAL_DELEGATED],
  ["localDelegated", AUTH_MODES.LOCAL_DELEGATED],
  ["delegated", AUTH_MODES.LOCAL_DELEGATED],
  ["production-application", AUTH_MODES.PRODUCTION_APPLICATION],
  ["productionApplication", AUTH_MODES.PRODUCTION_APPLICATION],
  ["application", AUTH_MODES.PRODUCTION_APPLICATION]
]);

function brokerError(code, message, ErrorType = Error) {
  const error = new ErrorType(message);
  error.code = code;
  return error;
}

function abortError(message = "Consent operation was cancelled.") {
  const error = brokerError("CONSENT_CANCELLED", message);
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw abortError();
  }
}

function normalizeAuthMode(value) {
  const mode = AUTH_MODE_ALIASES.get(value);
  if (!mode) {
    throw brokerError(
      "INVALID_AUTH_MODE",
      `Authentication mode must be '${AUTH_MODES.LOCAL_DELEGATED}' or '${AUTH_MODES.PRODUCTION_APPLICATION}'.`,
      TypeError
    );
  }
  return mode;
}

function strings(values, field) {
  if (values === undefined) return [];
  if (!Array.isArray(values)) {
    throw brokerError("INVALID_COLLECTOR_METADATA", `${field} must be an array.`, TypeError);
  }
  const result = values.map(value => {
    if (typeof value !== "string" || !value.trim()) {
      throw brokerError(
        "INVALID_COLLECTOR_METADATA",
        `${field} must contain non-empty strings.`,
        TypeError
      );
    }
    return value.trim();
  });
  return [...new Set(result)].sort();
}

function valuesForMode(value, authMode, field) {
  if (value === undefined) return [];
  if (Array.isArray(value)) return strings(value, field);
  if (!value || typeof value !== "object") {
    throw brokerError("INVALID_COLLECTOR_METADATA", `${field} is invalid.`, TypeError);
  }
  const aliases = authMode === AUTH_MODES.LOCAL_DELEGATED
    ? ["local-delegated", "localDelegated", "delegated"]
    : ["production-application", "productionApplication", "application"];
  for (const key of aliases) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      return strings(value[key], `${field}.${key}`);
    }
  }
  return [];
}

function normalizeInventory(value, authMode, field) {
  if (value === undefined) return [];
  if (Array.isArray(value)) return strings(value, field);
  if (!value || typeof value !== "object") {
    throw brokerError("INVALID_INVENTORY", `${field} is invalid.`, TypeError);
  }
  return valuesForMode(value, authMode, field);
}

function missing(required, available) {
  const inventory = new Set(available);
  return required.filter(value => !inventory.has(value));
}

function collectorServices(collector) {
  if (!collector || typeof collector !== "object") {
    throw brokerError("INVALID_COLLECTOR_METADATA", "Collector metadata is required.", TypeError);
  }
  if (typeof collector.id !== "string" || !collector.id.trim()) {
    throw brokerError("INVALID_COLLECTOR_METADATA", "Collector id is required.", TypeError);
  }
  if (collector.services !== undefined) {
    if (!Array.isArray(collector.services) || collector.services.length === 0) {
      throw brokerError(
        "INVALID_COLLECTOR_METADATA",
        `Collector '${collector.id}' services must be a non-empty array.`,
        TypeError
      );
    }
    return collector.services;
  }
  return [{
    id: collector.service || collector.serviceId || "default",
    controls: collector.controls || collector.controlIds,
    permissions: collector.permissions || collector.requiredPermissions,
    licenses: collector.licenses || collector.requiredLicenses,
    adminRoles: collector.adminRoles || collector.requiredAdminRoles,
    endpoints: collector.endpoints || collector.requiredEndpoints,
    authModes: collector.authModes
  }];
}

function normalizeService(collector, service, authMode) {
  if (!service || typeof service !== "object") {
    throw brokerError(
      "INVALID_COLLECTOR_METADATA",
      `Collector '${collector.id}' contains invalid service metadata.`,
      TypeError
    );
  }
  const serviceId = service.id || service.service || service.serviceId;
  if (typeof serviceId !== "string" || !serviceId.trim()) {
    throw brokerError(
      "INVALID_COLLECTOR_METADATA",
      `Collector '${collector.id}' has a service without an id.`,
      TypeError
    );
  }
  const declaredModes = strings(service.authModes || [], "authModes")
    .map(normalizeAuthMode);
  const controls = strings(
    service.controls || service.controlIds || collector.controls || collector.controlIds || [],
    "controls"
  );
  return {
    collectorId: collector.id.trim(),
    serviceId: serviceId.trim(),
    controls,
    authModeSupported: declaredModes.length === 0 || declaredModes.includes(authMode),
    permissions: valuesForMode(
      service.permissions || service.requiredPermissions,
      authMode,
      "permissions"
    ),
    licenses: strings(service.licenses || service.skus || service.requiredLicenses || [], "licenses"),
    adminRoles: strings(service.adminRoles || service.roles || service.requiredAdminRoles || [], "adminRoles"),
    endpoints: strings(service.endpoints || service.requiredEndpoints || [], "endpoints")
  };
}

function normalizeRequestedPermissions(value, authMode) {
  return normalizeInventory(value, authMode, "requestedPermissions");
}

function buildServicePlans(collectors, options = {}) {
  if (!Array.isArray(collectors)) {
    throw new TypeError("collectors must be an array.");
  }
  const {
    signal,
    requestedPermissions,
    grantedPermissions,
    availableLicenses,
    availableSkus,
    assignedAdminRoles,
    availableAdminRoles,
    availableEndpoints
  } = options;
  const authMode = normalizeAuthMode(options.authMode || AUTH_MODES.LOCAL_DELEGATED);
  throwIfAborted(signal);

  const normalized = [];
  for (const collector of collectors) {
    throwIfAborted(signal);
    for (const service of collectorServices(collector)) {
      normalized.push(normalizeService(collector, service, authMode));
    }
  }

  const declaredPermissions = new Set(normalized.flatMap(service => service.permissions));
  const requested = normalizeRequestedPermissions(requestedPermissions, authMode);
  const undeclared = requested.filter(permission => !declaredPermissions.has(permission));
  if (undeclared.length) {
    throw brokerError(
      "UNDECLARED_PERMISSION",
      `Permissions were not declared by the selected collectors: ${undeclared.join(", ")}.`
    );
  }

  const permissionsInventory = normalizeInventory(grantedPermissions, authMode, "grantedPermissions");
  const licenseInventory = strings(
    availableLicenses === undefined ? (availableSkus || []) : availableLicenses,
    "availableLicenses"
  );
  const roleInventory = strings(
    assignedAdminRoles === undefined ? (availableAdminRoles || []) : assignedAdminRoles,
    "assignedAdminRoles"
  );
  const endpointInventory = availableEndpoints === undefined
    ? null
    : strings(availableEndpoints, "availableEndpoints");
  const plans = new Map();

  for (const requirement of normalized) {
    throwIfAborted(signal);
    let plan = plans.get(requirement.serviceId);
    if (!plan) {
      plan = {
        serviceId: requirement.serviceId,
        authMode,
        collectorIds: new Set(),
        controlIds: new Set(),
        permissions: new Set(),
        licenses: new Set(),
        adminRoles: new Set(),
        endpoints: new Set(),
        requirements: []
      };
      plans.set(requirement.serviceId, plan);
    }
    plan.collectorIds.add(requirement.collectorId);
    requirement.controls.forEach(value => plan.controlIds.add(value));
    requirement.permissions.forEach(value => plan.permissions.add(value));
    requirement.licenses.forEach(value => plan.licenses.add(value));
    requirement.adminRoles.forEach(value => plan.adminRoles.add(value));
    requirement.endpoints.forEach(value => plan.endpoints.add(value));
    plan.requirements.push(requirement);
  }

  return [...plans.values()]
    .sort((left, right) => left.serviceId.localeCompare(right.serviceId))
    .map(plan => {
      throwIfAborted(signal);
      const permissions = [...plan.permissions].sort();
      const licenses = [...plan.licenses].sort();
      const adminRoles = [...plan.adminRoles].sort();
      const endpoints = [...plan.endpoints].sort();
      const missingPermissions = missing(permissions, permissionsInventory);
      const missingLicenses = missing(licenses, licenseInventory);
      const missingAdminRoles = missing(adminRoles, roleInventory);
      const missingEndpoints = endpointInventory === null ? [] : missing(endpoints, endpointInventory);
      const unavailableControls = [];

      for (const requirement of plan.requirements) {
        const controlMissingPermissions = missing(requirement.permissions, permissionsInventory);
        const controlMissingLicenses = missing(requirement.licenses, licenseInventory);
        const controlMissingAdminRoles = missing(requirement.adminRoles, roleInventory);
        const controlMissingEndpoints = endpointInventory === null
          ? []
          : missing(requirement.endpoints, endpointInventory);
        const reasons = [];
        if (!requirement.authModeSupported) reasons.push(`Auth mode '${authMode}' is not supported.`);
        if (controlMissingPermissions.length) {
          reasons.push(`Missing permissions: ${controlMissingPermissions.join(", ")}.`);
        }
        if (controlMissingAdminRoles.length) {
          reasons.push(`Missing admin roles: ${controlMissingAdminRoles.join(", ")}.`);
        }
        if (controlMissingLicenses.length) {
          reasons.push(`Missing SKUs: ${controlMissingLicenses.join(", ")}.`);
        }
        if (controlMissingEndpoints.length) {
          reasons.push(`Unavailable endpoints: ${controlMissingEndpoints.join(", ")}.`);
        }
        for (const controlId of requirement.controls) {
          if (reasons.length) {
            unavailableControls.push({
              controlId,
              collectorId: requirement.collectorId,
              reasons: [...reasons],
              missingPermissions: controlMissingPermissions,
              missingAdminRoles: controlMissingAdminRoles,
              missingLicenses: controlMissingLicenses,
              missingEndpoints: controlMissingEndpoints
            });
          }
        }
      }

      const unsupportedAuthMode = plan.requirements.some(item => !item.authModeSupported);
      return {
        serviceId: plan.serviceId,
        authMode,
        collectorIds: [...plan.collectorIds].sort(),
        controlIds: [...plan.controlIds].sort(),
        permissions,
        licenses,
        skus: licenses,
        adminRoles,
        endpoints,
        missingPermissions,
        missingScopes: missingPermissions,
        missingLicenses,
        missingSkus: missingLicenses,
        missingAdminRoles,
        missingRoles: missingAdminRoles,
        missingEndpoints,
        available: !unsupportedAuthMode &&
          missingPermissions.length === 0 &&
          missingLicenses.length === 0 &&
          missingAdminRoles.length === 0 &&
          missingEndpoints.length === 0,
        unavailableControls
      };
    });
}

class ConsentBroker {
  #collectors;
  #handles;
  #now;
  #randomBytes;

  constructor({ collectors = [], now = Date.now, randomBytes = crypto.randomBytes } = {}) {
    if (!Array.isArray(collectors)) throw new TypeError("collectors must be an array.");
    if (typeof now !== "function") throw new TypeError("now must be a function.");
    if (typeof randomBytes !== "function") throw new TypeError("randomBytes must be a function.");
    this.#collectors = [...collectors];
    this.#handles = new Map();
    this.#now = now;
    this.#randomBytes = randomBytes;
  }

  buildPlans(options = {}) {
    return buildServicePlans(this.#collectors, options);
  }

  plan(options = {}) {
    return this.buildPlans(options);
  }

  async prepareConsent(options = {}) {
    throwIfAborted(options.signal);
    await Promise.resolve();
    throwIfAborted(options.signal);
    return this.buildPlans(options);
  }

  createTokenHandle(options = {}) {
    const {
      rawToken,
      tenantId,
      jobId,
      collectorId,
      expiresAt,
      signal
    } = options;
    throwIfAborted(signal);
    const authMode = normalizeAuthMode(options.authMode);
    for (const [field, value] of Object.entries({ rawToken, tenantId, jobId, collectorId })) {
      if (typeof value !== "string" || !value) {
        throw brokerError("INVALID_TOKEN_BINDING", `${field} is required.`, TypeError);
      }
    }
    const expiry = expiresAt instanceof Date ? expiresAt.getTime() : Number(expiresAt);
    if (!Number.isFinite(expiry)) {
      throw brokerError("INVALID_TOKEN_BINDING", "expiresAt must be a Date or epoch milliseconds.", TypeError);
    }

    let handle;
    do {
      handle = `afd_${this.#randomBytes(24).toString("base64url")}`;
    } while (this.#handles.has(handle));
    this.#handles.set(handle, {
      rawToken,
      tenantId,
      jobId,
      collectorId,
      authMode,
      expiresAt: expiry
    });
    return handle;
  }

  bindToken(options = {}) {
    return this.createTokenHandle(options);
  }

  consumeTokenHandle(handle, binding = {}) {
    const entry = this.#takeHandle(handle, binding);
    return Object.freeze({
      tenantId: entry.tenantId,
      jobId: entry.jobId,
      collectorId: entry.collectorId,
      authMode: entry.authMode,
      expiresAt: new Date(entry.expiresAt).toISOString()
    });
  }

  consumeToken(handle, binding = {}) {
    return this.consumeTokenHandle(handle, binding);
  }

  async withTokenHandle(handle, binding, operation) {
    if (typeof operation !== "function") {
      throw new TypeError("operation must be a function.");
    }
    const entry = this.#takeHandle(handle, binding || {});
    throwIfAborted(binding?.signal);
    return operation(entry.rawToken, {
      tenantId: entry.tenantId,
      jobId: entry.jobId,
      collectorId: entry.collectorId,
      authMode: entry.authMode,
      signal: binding?.signal
    });
  }

  revokeTokenHandle(handle) {
    if (typeof handle !== "string" || !handle) return false;
    return this.#handles.delete(handle);
  }

  revokeToken(handle) {
    return this.revokeTokenHandle(handle);
  }

  #takeHandle(handle, binding) {
    throwIfAborted(binding.signal);
    if (typeof handle !== "string" || !handle) {
      throw brokerError("INVALID_TOKEN_HANDLE", "Token handle is required.", TypeError);
    }
    const entry = this.#handles.get(handle);
    if (!entry) {
      throw brokerError("TOKEN_HANDLE_INVALID", "Token handle is invalid or has been consumed.");
    }
    if (entry.expiresAt <= this.#now()) {
      this.#handles.delete(handle);
      throw brokerError("TOKEN_HANDLE_EXPIRED", "Token handle has expired.");
    }
    const authMode = normalizeAuthMode(binding.authMode);
    const matches = entry.tenantId === binding.tenantId &&
      entry.jobId === binding.jobId &&
      entry.collectorId === binding.collectorId &&
      entry.authMode === authMode;
    if (!matches) {
      throw brokerError("TOKEN_BINDING_MISMATCH", "Token handle is not valid for this job binding.");
    }
    this.#handles.delete(handle);
    return entry;
  }
}

module.exports = {
  AUTH_MODES,
  ConsentBroker,
  buildServicePlans
};
