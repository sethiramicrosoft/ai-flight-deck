(function (root, factory) {
  const nodeCrypto = typeof module === "object" && module.exports && typeof require === "function"
    ? require("node:crypto")
    : null;
  const api = factory(nodeCrypto);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FlightDeckEvidenceIntegrity = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (nodeCrypto) {
  "use strict";

  const EVIDENCE_SCHEMA = "ai-flight-deck/evidence-envelope";
  const ACTION_BINDING_SCHEMA = "ai-flight-deck/action-package-binding";
  const HISTORY_SCHEMA = "ai-flight-deck/control-history-entry";
  const VERSION = "1.0.0";
  const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
  const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/;

  function fail(message, ErrorType = Error) {
    throw new ErrorType(message);
  }

  function isPlainObject(value) {
    if (!value || typeof value !== "object") return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === null ||
      (Object.prototype.hasOwnProperty.call(prototype, "constructor") &&
        typeof prototype.constructor === "function" &&
        prototype.constructor.name === "Object");
  }

  function canonicalStringify(value) {
    const ancestors = new Set();

    function serialize(current) {
      if (current === null) return "null";
      if (typeof current === "string" || typeof current === "boolean") {
        return JSON.stringify(current);
      }
      if (typeof current === "number") {
        if (!Number.isFinite(current)) fail("Canonical JSON does not support non-finite numbers.", TypeError);
        return JSON.stringify(current);
      }
      if (typeof current !== "object") {
        fail(`Canonical JSON does not support values of type '${typeof current}'.`, TypeError);
      }
      if (ancestors.has(current)) fail("Canonical JSON does not support circular references.", TypeError);

      ancestors.add(current);
      let serialized;
      if (Array.isArray(current)) {
        for (let index = 0; index < current.length; index++) {
          if (!Object.prototype.hasOwnProperty.call(current, index)) {
            fail("Canonical JSON does not support sparse arrays.", TypeError);
          }
        }
        serialized = `[${current.map(serialize).join(",")}]`;
      } else {
        if (!isPlainObject(current)) {
          fail("Canonical JSON supports only plain objects and arrays.", TypeError);
        }
        const keys = Object.keys(current).sort();
        serialized = `{${keys.map(key => `${JSON.stringify(key)}:${serialize(current[key])}`).join(",")}}`;
      }
      ancestors.delete(current);
      return serialized;
    }

    return serialize(value);
  }

  function requireCrypto() {
    if (!nodeCrypto) {
      fail("SHA-256 and HMAC-SHA256 require a compatible cryptographic provider.");
    }
    return nodeCrypto;
  }

  function sha256Digest(value) {
    return `sha256:${requireCrypto()
      .createHash("sha256")
      .update(canonicalStringify(value), "utf8")
      .digest("hex")}`;
  }

  function cloneCanonical(value) {
    return JSON.parse(canonicalStringify(value));
  }

  function nonEmptyString(value, field) {
    if (typeof value !== "string" || !value.trim()) {
      fail(`${field} must be a non-empty string.`, TypeError);
    }
    return value.trim();
  }

  function normalizeTimestamp(value, field) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) fail(`${field} must be a valid timestamp.`, TypeError);
    return date.toISOString();
  }

  function majorVersion(version) {
    if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
      fail("Version must use semantic version format.", TypeError);
    }
    return Number(version.split(".")[0]);
  }

  function assertCompatibleVersion(actual, supported = VERSION) {
    if (majorVersion(actual) !== majorVersion(supported)) {
      fail(`Incompatible major version '${actual}'; supported version is '${supported}'.`);
    }
    return true;
  }

  function validateDigest(value, field) {
    if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
      fail(`${field} must be a SHA-256 digest.`, TypeError);
    }
    return value;
  }

  function validateKey(key) {
    if (typeof key === "string") {
      if (!key.length) fail("Signing key must not be empty.", TypeError);
      return key;
    }
    if (key && typeof key === "object" && Number.isInteger(key.byteLength) && key.byteLength > 0) {
      return key;
    }
    fail("A non-empty caller-provided signing key is required.", TypeError);
  }

  function hmacSha256(value, key) {
    return requireCrypto()
      .createHmac("sha256", validateKey(key))
      .update(canonicalStringify(value), "utf8")
      .digest("hex");
  }

  function withoutProperty(object, property) {
    const copy = {};
    for (const key of Object.keys(object)) {
      if (key !== property) copy[key] = object[key];
    }
    return copy;
  }

  function constantTimeHexEqual(left, right) {
    if (!SIGNATURE_PATTERN.test(left) || !SIGNATURE_PATTERN.test(right)) return false;
    const toBytes = hex => Uint8Array.from(hex.match(/../g), byte => Number.parseInt(byte, 16));
    return requireCrypto().timingSafeEqual(toBytes(left), toBytes(right));
  }

  function createEvidenceEnvelope(options) {
    if (!isPlainObject(options)) fail("Evidence envelope options are required.", TypeError);
    const payload = cloneCanonical(options.payload);
    const envelope = {
      schema: EVIDENCE_SCHEMA,
      version: VERSION,
      tenant: nonEmptyString(options.tenant, "tenant"),
      producer: nonEmptyString(options.producer, "producer"),
      generatedAt: normalizeTimestamp(options.generatedAt || new Date(), "generatedAt"),
      payload,
      payloadDigest: sha256Digest(payload),
      signatureAlgorithm: "HMAC-SHA256",
      keyId: nonEmptyString(options.keyId, "keyId")
    };
    envelope.signature = hmacSha256(envelope, options.key);
    return envelope;
  }

  function verifyEvidenceEnvelope(envelope, key, options = {}) {
    if (!isPlainObject(envelope)) fail("Evidence envelope is required.", TypeError);
    if (envelope.schema !== EVIDENCE_SCHEMA) fail("Unsupported evidence envelope schema.");
    assertCompatibleVersion(envelope.version, options.supportedVersion || VERSION);
    nonEmptyString(envelope.tenant, "tenant");
    nonEmptyString(envelope.producer, "producer");
    normalizeTimestamp(envelope.generatedAt, "generatedAt");
    if (envelope.signatureAlgorithm !== "HMAC-SHA256") fail("Unsupported signature algorithm.");
    nonEmptyString(envelope.keyId, "keyId");
    validateDigest(envelope.payloadDigest, "payloadDigest");
    if (sha256Digest(envelope.payload) !== envelope.payloadDigest) {
      fail("Evidence payload digest verification failed.");
    }
    if (typeof envelope.signature !== "string") fail("Evidence signature is required.", TypeError);
    const expected = hmacSha256(withoutProperty(envelope, "signature"), key);
    if (!constantTimeHexEqual(envelope.signature, expected)) {
      fail("Evidence signature verification failed.");
    }
    return true;
  }

  function evidenceEnvelopeDigest(envelope) {
    return sha256Digest(envelope);
  }

  function normalizeSelectionIds(values, fieldName, itemName) {
    if (values == null) return [];
    if (!Array.isArray(values)) {
      fail(`${fieldName} must be an array.`, TypeError);
    }
    const normalized = values.map(value => nonEmptyString(value, itemName));
    if (new Set(normalized).size !== normalized.length) {
      fail(`${fieldName} must not contain duplicates.`, TypeError);
    }
    return normalized.sort();
  }

  function createActionPackageBinding(options) {
    if (!isPlainObject(options)) fail("Action package binding options are required.", TypeError);
    const actionPackage = cloneCanonical(options.actionPackage);
    const selectedEvidenceIds = normalizeSelectionIds(
      options.selectedEvidenceIds,
      "selectedEvidenceIds",
      "evidence id"
    );
    const selectedControlIds = normalizeSelectionIds(
      options.selectedControlIds,
      "selectedControlIds",
      "control id"
    );
    if (!selectedEvidenceIds.length && !selectedControlIds.length) {
      fail("At least one selected evidence or control ID is required.", TypeError);
    }
    const binding = {
      schema: ACTION_BINDING_SCHEMA,
      version: VERSION,
      baselineDigest: validateDigest(options.baselineDigest, "baselineDigest"),
      selectedEvidenceIds,
      selectedControlIds,
      actionPackage,
      actionPackageDigest: sha256Digest(actionPackage)
    };
    binding.bindingDigest = sha256Digest(binding);
    return binding;
  }

  function verifyActionPackageBinding(binding, expected = {}) {
    if (!isPlainObject(binding)) fail("Action package binding is required.", TypeError);
    if (binding.schema !== ACTION_BINDING_SCHEMA) fail("Unsupported action package binding schema.");
    assertCompatibleVersion(binding.version, expected.supportedVersion || VERSION);
    validateDigest(binding.baselineDigest, "baselineDigest");
    const evidenceIds = normalizeSelectionIds(
      binding.selectedEvidenceIds,
      "selectedEvidenceIds",
      "evidence id"
    );
    const controlIds = normalizeSelectionIds(
      binding.selectedControlIds,
      "selectedControlIds",
      "control id"
    );
    if (!evidenceIds.length && !controlIds.length) {
      fail("At least one selected evidence or control ID is required.");
    }
    if (canonicalStringify(evidenceIds) !== canonicalStringify(binding.selectedEvidenceIds)) {
      fail("selectedEvidenceIds are not in canonical order.");
    }
    if (Object.hasOwn(binding, "selectedControlIds") &&
        canonicalStringify(controlIds) !== canonicalStringify(binding.selectedControlIds)) {
      fail("selectedControlIds are not in canonical order.");
    }
    if (sha256Digest(binding.actionPackage) !== binding.actionPackageDigest) {
      fail("Action package digest verification failed.");
    }
    const unsigned = withoutProperty(binding, "bindingDigest");
    if (sha256Digest(unsigned) !== binding.bindingDigest) {
      fail("Action package binding digest verification failed.");
    }
    if (expected.baselineDigest && expected.baselineDigest !== binding.baselineDigest) {
      fail("Action package baseline digest does not match.");
    }
    if (expected.selectedEvidenceIds) {
      const expectedIds = normalizeSelectionIds(
        expected.selectedEvidenceIds,
        "selectedEvidenceIds",
        "evidence id"
      );
      if (canonicalStringify(expectedIds) !== canonicalStringify(evidenceIds)) {
        fail("Action package evidence selection does not match.");
      }
    }
    if (expected.selectedControlIds) {
      const expectedIds = normalizeSelectionIds(
        expected.selectedControlIds,
        "selectedControlIds",
        "control id"
      );
      if (canonicalStringify(expectedIds) !== canonicalStringify(controlIds)) {
        fail("Action package control selection does not match.");
      }
    }
    return true;
  }

  function historyEntryContent(entry) {
    return withoutProperty(entry, "entryDigest");
  }

  function verifyControlHistory(history, options = {}) {
    if (!Array.isArray(history)) fail("Control history must be an array.", TypeError);
    let previousDigest = null;
    let controlId = options.controlId ? nonEmptyString(options.controlId, "controlId") : null;

    for (let index = 0; index < history.length; index++) {
      const entry = history[index];
      if (!isPlainObject(entry)) fail(`History entry ${index + 1} is invalid.`, TypeError);
      if (entry.schema !== HISTORY_SCHEMA) fail(`History entry ${index + 1} has an unsupported schema.`);
      assertCompatibleVersion(entry.version, options.supportedVersion || VERSION);
      const entryControlId = nonEmptyString(entry.controlId, "controlId");
      if (controlId === null) controlId = entryControlId;
      if (entryControlId !== controlId) fail("Control history cannot mix control ids.");
      if (entry.sequence !== index + 1) fail(`History sequence ${entry.sequence} is invalid.`);
      if (entry.previousDigest !== previousDigest) fail(`History chain is broken at sequence ${entry.sequence}.`);
      normalizeTimestamp(entry.observedAt, "observedAt");
      normalizeTimestamp(entry.freshUntil, "freshUntil");
      nonEmptyString(entry.status, "status");
      validateDigest(entry.resultDigest, "resultDigest");
      validateDigest(entry.entryDigest, "entryDigest");
      if (sha256Digest(historyEntryContent(entry)) !== entry.entryDigest) {
        fail(`History entry digest verification failed at sequence ${entry.sequence}.`);
      }
      previousDigest = entry.entryDigest;
    }

    return {
      valid: true,
      controlId,
      length: history.length,
      headDigest: previousDigest
    };
  }

  function appendControlHistory(history, result, options = {}) {
    if (!isPlainObject(result)) fail("A control result is required.", TypeError);
    const controlId = nonEmptyString(result.controlId, "controlId");
    const status = nonEmptyString(result.status, "status");
    const observedAt = normalizeTimestamp(
      options.observedAt || result.observedAt || new Date(),
      "observedAt"
    );
    const freshUntil = normalizeTimestamp(options.freshUntil || result.freshUntil, "freshUntil");
    if (Date.parse(freshUntil) < Date.parse(observedAt)) {
      fail("freshUntil must not be earlier than observedAt.", RangeError);
    }

    const current = history === undefined ? [] : history;
    const verified = verifyControlHistory(current, { controlId });
    const entry = {
      schema: HISTORY_SCHEMA,
      version: VERSION,
      controlId,
      sequence: current.length + 1,
      previousDigest: verified.headDigest,
      observedAt,
      freshUntil,
      status,
      resultDigest: sha256Digest(result)
    };
    entry.entryDigest = sha256Digest(entry);
    return [...current, entry];
  }

  function deriveControlDrift(history, asOf = new Date()) {
    const verified = verifyControlHistory(history);
    if (!history.length) fail("Control history must contain at least one entry.", RangeError);
    const timestamp = normalizeTimestamp(asOf, "asOf");
    const current = history[history.length - 1];
    const previous = history.length > 1 ? history[history.length - 2] : null;
    const statusChanged = Boolean(previous && previous.status !== current.status);
    const evidenceChanged = Boolean(previous && previous.resultDigest !== current.resultDigest);
    const expired = Date.parse(current.freshUntil) <= Date.parse(timestamp);
    return {
      controlId: verified.controlId,
      previousSequence: previous ? previous.sequence : null,
      currentSequence: current.sequence,
      statusChanged,
      changedStatus: statusChanged,
      expired,
      evidenceChanged,
      drifted: statusChanged || expired || evidenceChanged
    };
  }

  function deriveDriftByControl(histories, asOf = new Date()) {
    if (!isPlainObject(histories)) fail("Histories must be an object keyed by control id.", TypeError);
    const drift = {};
    for (const controlId of Object.keys(histories).sort()) {
      drift[controlId] = deriveControlDrift(histories[controlId], asOf);
      if (drift[controlId].controlId !== controlId) {
        fail(`History key '${controlId}' does not match its control id.`);
      }
    }
    return drift;
  }

  return {
    ACTION_BINDING_SCHEMA,
    EVIDENCE_SCHEMA,
    HISTORY_SCHEMA,
    VERSION,
    appendControlHistory,
    assertCompatibleVersion,
    bindActionPackage: createActionPackageBinding,
    canonicalStringify,
    createActionPackageBinding,
    createEvidenceEnvelope,
    deriveControlDrift,
    deriveDriftByControl,
    digestEvidenceEnvelope: evidenceEnvelopeDigest,
    evidenceEnvelopeDigest,
    sha256Digest,
    signEvidenceEnvelope: createEvidenceEnvelope,
    verifyActionPackageBinding,
    verifyControlHistory,
    verifyEvidenceEnvelope
  };
});
