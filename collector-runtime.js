"use strict";

const { captureCollectorEvidence } = require("./evidence-authority");

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const ID_PATTERN = /^[a-z][a-z0-9-]{2,127}$/;
const CONTROL_ID_PATTERN = /^AFD-[A-Z0-9]+-\d{3}$/;

function uniqueStrings(values, field) {
  if (!Array.isArray(values)) {
    throw new TypeError(`${field} must be an array.`);
  }
  const normalized = values.map(value => {
    if (typeof value !== "string" || !value.trim()) {
      throw new TypeError(`${field} must contain non-empty strings.`);
    }
    return value.trim();
  });
  return [...new Set(normalized)].sort();
}

function validateCollector(definition) {
  if (!definition || typeof definition !== "object") {
    throw new TypeError("Collector definition is required.");
  }
  if (typeof definition.id !== "string" || !ID_PATTERN.test(definition.id)) {
    throw new TypeError("Collector id is invalid.");
  }
  if (typeof definition.version !== "string" || !VERSION_PATTERN.test(definition.version)) {
    throw new TypeError(`Collector '${definition.id}' has an invalid version.`);
  }
  const domainIds = uniqueStrings(definition.domainIds, "domainIds");
  const controlIds = uniqueStrings(definition.controlIds, "controlIds");
  if (!domainIds.length || !controlIds.length || controlIds.some(id => !CONTROL_ID_PATTERN.test(id))) {
    throw new TypeError(`Collector '${definition.id}' must declare valid domains and controls.`);
  }
  for (const method of ["collect", "normalize"]) {
    if (typeof definition[method] !== "function") {
      throw new TypeError(`Collector '${definition.id}' must implement ${method}().`);
    }
  }
  for (const method of ["discoverCapabilities", "health"]) {
    if (definition[method] !== undefined && typeof definition[method] !== "function") {
      throw new TypeError(`Collector '${definition.id}' ${method} must be a function.`);
    }
  }

  return Object.freeze({
    ...definition,
    domainIds,
    controlIds,
    requiredPermissions: uniqueStrings(definition.requiredPermissions || [], "requiredPermissions"),
    requiredLicenses: uniqueStrings(definition.requiredLicenses || [], "requiredLicenses"),
    maximumRequests: Number.isInteger(definition.maximumRequests) && definition.maximumRequests > 0
      ? definition.maximumRequests
      : 1000
  });
}

function missingValues(required, available) {
  const granted = new Set(available);
  return required.filter(value => !granted.has(value));
}

function makeAbortError(message) {
  const error = new Error(message);
  error.name = "AbortError";
  error.code = "COLLECTOR_CANCELLED";
  return error;
}

class RequestBudget {
  constructor(maximum) {
    this.maximum = maximum;
    this.used = 0;
  }

  consume(count = 1) {
    if (!Number.isInteger(count) || count < 1) {
      throw new TypeError("Request budget consumption must be a positive integer.");
    }
    if (this.used + count > this.maximum) {
      const error = new Error(`Collector request budget of ${this.maximum} was exceeded.`);
      error.code = "COLLECTOR_REQUEST_BUDGET_EXCEEDED";
      throw error;
    }
    this.used += count;
    return this.remaining;
  }

  get remaining() {
    return this.maximum - this.used;
  }
}

class CollectorRegistry {
  constructor() {
    this.collectors = new Map();
  }

  register(definition) {
    const collector = validateCollector(definition);
    if (this.collectors.has(collector.id)) {
      throw new Error(`Collector '${collector.id}' is already registered.`);
    }
    this.collectors.set(collector.id, collector);
    return collector;
  }

  list() {
    return [...this.collectors.values()];
  }

  get(id) {
    return this.collectors.get(id) || null;
  }

  async plan({ grantedPermissions = [], availableLicenses = [], context = {} } = {}) {
    const permissions = uniqueStrings(grantedPermissions, "grantedPermissions");
    const licenses = uniqueStrings(availableLicenses, "availableLicenses");
    return Promise.all(this.list().map(async collector => {
      const declared = {
        permissions: missingValues(collector.requiredPermissions, permissions),
        licenses: missingValues(collector.requiredLicenses, licenses)
      };
      let discovered = {};
      if (collector.discoverCapabilities) {
        discovered = await collector.discoverCapabilities({ context }) || {};
      }
      const missingPermissions = uniqueStrings(
        [...declared.permissions, ...(discovered.missingPermissions || [])],
        "missingPermissions"
      );
      const missingLicenses = uniqueStrings(
        [...declared.licenses, ...(discovered.missingLicenses || [])],
        "missingLicenses"
      );
      return {
        collectorId: collector.id,
        collectorVersion: collector.version,
        domainIds: collector.domainIds,
        controlIds: collector.controlIds,
        ready: missingPermissions.length === 0 && missingLicenses.length === 0 &&
          discovered.available !== false,
        missingPermissions,
        missingLicenses,
        unavailableReason: discovered.available === false
          ? String(discovered.reason || "Collector capability is unavailable.")
          : null
      };
    }));
  }

  async run(options = {}) {
    const {
      context = {},
      grantedPermissions = [],
      availableLicenses = [],
      signal,
      maxConcurrency = 2,
      timeoutMs = 120000
    } = options;
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 16) {
      throw new RangeError("maxConcurrency must be between 1 and 16.");
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
      throw new RangeError("timeoutMs must be a positive integer.");
    }
    if (signal?.aborted) {
      throw makeAbortError("Collector execution was cancelled before it started.");
    }

    const plan = await this.plan({ grantedPermissions, availableLicenses, context });
    const queue = plan.map(entry => ({ entry, collector: this.get(entry.collectorId) }));
    const results = new Array(queue.length);
    let cursor = 0;

    const worker = async () => {
      while (true) {
        const index = cursor++;
        if (index >= queue.length) return;
        const { entry, collector } = queue[index];
        results[index] = await this.#runOne({
          collector,
          capability: entry,
          context,
          signal,
          timeoutMs
        });
      }
    };

    await Promise.all(Array.from({ length: Math.min(maxConcurrency, queue.length) }, worker));
    return results;
  }

  async #runOne({ collector, capability, context, signal, timeoutMs }) {
    const startedAt = new Date();
    if (!capability.ready) {
      return {
        ...capability,
        status: "Unavailable",
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        requests: 0,
        controlResults: []
      };
    }

    const controller = new AbortController();
    const abortFromParent = () => controller.abort(signal?.reason || makeAbortError("Collector execution was cancelled."));
    signal?.addEventListener("abort", abortFromParent, { once: true });
    const timer = setTimeout(() => {
      const error = new Error(`Collector '${collector.id}' exceeded its ${timeoutMs} ms timeout.`);
      error.code = "COLLECTOR_TIMEOUT";
      controller.abort(error);
    }, timeoutMs);
    const budget = new RequestBudget(collector.maximumRequests);

    try {
      if (collector.health) {
        const health = await collector.health({ context, signal: controller.signal });
        if (!health || health.healthy !== true) {
          const error = new Error(String(health?.reason || "Collector health check failed."));
          error.code = "COLLECTOR_UNHEALTHY";
          throw error;
        }
      }
      if (controller.signal.aborted) throw controller.signal.reason;
      const observations = await collector.collect({ context, signal: controller.signal, budget });
      if (controller.signal.aborted) throw controller.signal.reason;
      const controlResults = await collector.normalize({
        observations,
        context,
        signal: controller.signal
      });
      if (!Array.isArray(controlResults)) {
        throw new TypeError(`Collector '${collector.id}' normalize() must return an array.`);
      }
      const allowedControls = new Set(collector.controlIds);
      if (controlResults.some(result => !result || !allowedControls.has(result.controlId))) {
        throw new Error(`Collector '${collector.id}' emitted an undeclared control result.`);
      }
      captureCollectorEvidence(collector, observations, context, controlResults);
      return {
        ...capability,
        status: "Completed",
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        requests: budget.used,
        controlResults
      };
    } catch (error) {
      const cancelled = controller.signal.aborted &&
        (signal?.aborted || controller.signal.reason?.code === "COLLECTOR_CANCELLED");
      return {
        ...capability,
        status: cancelled ? "Cancelled" : "Failed",
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        requests: budget.used,
        error: {
          code: String(error?.code || (cancelled ? "COLLECTOR_CANCELLED" : "COLLECTOR_FAILED")),
          message: String(error?.message || error)
        },
        controlResults: []
      };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abortFromParent);
    }
  }
}

module.exports = {
  CollectorRegistry,
  RequestBudget
};
