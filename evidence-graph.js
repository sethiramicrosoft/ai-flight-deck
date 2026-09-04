(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FlightDeckEvidenceGraph = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const NODE_TYPES = Object.freeze([
    "Principal",
    "Membership",
    "Resource",
    "ContentSignal",
    "AISurface",
    "Policy"
  ]);
  const TYPE_INDEX = new Map(NODE_TYPES.map((type, index) => [type, index]));
  const SUPPORTED_TRANSITIONS = new Set([
    "Principal>Membership",
    "Membership>Resource",
    "Resource>ContentSignal",
    "ContentSignal>AISurface",
    "AISurface>Policy"
  ]);
  const SENSITIVITY = new Set(["public", "internal", "confidential", "highly-confidential"]);
  const POLICY_EFFECTS = new Set(["allow", "audit", "block"]);
  const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function requiredString(value, field) {
    if (typeof value !== "string" || !value.trim()) {
      throw new TypeError(`${field} must be a non-empty string.`);
    }
    return value.trim();
  }

  function stringArray(value, field, required = false) {
    if (value === undefined && !required) return [];
    if (!Array.isArray(value)) throw new TypeError(`${field} must be an array.`);
    const result = value.map((entry, index) => requiredString(entry, `${field}[${index}]`));
    if (new Set(result).size !== result.length) {
      throw new Error(`${field} must not contain duplicates.`);
    }
    return result.sort();
  }

  function validateSignature(signature) {
    if (!isObject(signature)) throw new TypeError("snapshot.signature is required.");
    requiredString(signature.algorithm, "snapshot.signature.algorithm");
    requiredString(signature.keyId, "snapshot.signature.keyId");
    requiredString(signature.value, "snapshot.signature.value");
  }

  function unwrapSnapshot(snapshot) {
    if (!isObject(snapshot)) throw new TypeError("An evidence snapshot is required.");
    if (snapshot.schema !== "ai-flight-deck/evidence-envelope") return snapshot;
    if (!isObject(snapshot.payload)) {
      throw new TypeError("Evidence envelope payload must be an object.");
    }
    requiredString(snapshot.signatureAlgorithm, "snapshot.signatureAlgorithm");
    requiredString(snapshot.keyId, "snapshot.keyId");
    requiredString(snapshot.signature, "snapshot.signature");
    return {
      ...snapshot.payload,
      version: snapshot.payload.version === undefined ? 1 : snapshot.payload.version,
      tenantId: snapshot.payload.tenantId || snapshot.tenant,
      signature: {
        algorithm: snapshot.signatureAlgorithm,
        keyId: snapshot.keyId,
        value: snapshot.signature
      }
    };
  }

  function validateAttributes(node) {
    const attributes = node.attributes === undefined ? {} : node.attributes;
    if (!isObject(attributes)) {
      throw new TypeError(`Node '${node.id}' attributes must be an object.`);
    }
    if (attributes.confidence !== undefined &&
        (typeof attributes.confidence !== "number" ||
         !Number.isFinite(attributes.confidence) ||
         attributes.confidence < 0 ||
         attributes.confidence > 1)) {
      throw new TypeError(`Node '${node.id}' confidence must be between 0 and 1.`);
    }
    if (node.type === "Principal" && attributes.active !== undefined &&
        typeof attributes.active !== "boolean") {
      throw new TypeError(`Principal '${node.id}' active must be boolean.`);
    }
    if (node.type === "ContentSignal") {
      if (!SENSITIVITY.has(attributes.sensitivity)) {
        throw new TypeError(`ContentSignal '${node.id}' has invalid sensitivity.`);
      }
      if (attributes.matched !== undefined && typeof attributes.matched !== "boolean") {
        throw new TypeError(`ContentSignal '${node.id}' matched must be boolean.`);
      }
    }
    if (node.type === "AISurface" && attributes.enabled !== undefined &&
        typeof attributes.enabled !== "boolean") {
      throw new TypeError(`AISurface '${node.id}' enabled must be boolean.`);
    }
    if (node.type === "Policy") {
      if (!POLICY_EFFECTS.has(attributes.effect)) {
        throw new TypeError(`Policy '${node.id}' has invalid effect.`);
      }
      requiredString(attributes.controlId, `Policy '${node.id}' controlId`);
      if (attributes.enabled !== undefined && typeof attributes.enabled !== "boolean") {
        throw new TypeError(`Policy '${node.id}' enabled must be boolean.`);
      }
    }
    return attributes;
  }

  function validateEvidenceSnapshot(snapshot) {
    const evidence = unwrapSnapshot(snapshot);
    if (evidence.version !== 1) throw new TypeError("snapshot.version must be 1.");
    if (evidence.minimized !== true) throw new TypeError("snapshot.minimized must be true.");
    validateSignature(evidence.signature);
    requiredString(evidence.tenantId, "snapshot.tenantId");
    if (!Array.isArray(evidence.nodes) || !Array.isArray(evidence.edges)) {
      throw new TypeError("snapshot.nodes and snapshot.edges must be arrays.");
    }

    const nodes = new Map();
    for (const rawNode of evidence.nodes) {
      if (!isObject(rawNode)) throw new TypeError("Every node must be an object.");
      const id = requiredString(rawNode.id, "node.id");
      if (!ID_PATTERN.test(id)) throw new TypeError(`Node id '${id}' is invalid.`);
      if (nodes.has(id)) throw new Error(`Duplicate node id '${id}'.`);
      if (!TYPE_INDEX.has(rawNode.type)) throw new TypeError(`Node '${id}' has invalid type.`);
      const tenantId = requiredString(rawNode.tenantId, `Node '${id}' tenantId`);
      if (tenantId !== evidence.tenantId) {
        throw new Error(`Node '${id}' does not belong to snapshot tenant '${evidence.tenantId}'.`);
      }
      nodes.set(id, Object.freeze({
        id,
        type: rawNode.type,
        tenantId,
        cohortIds: stringArray(rawNode.cohortIds, `Node '${id}' cohortIds`),
        attributes: Object.freeze({ ...validateAttributes({ ...rawNode, id }) })
      }));
    }

    const edges = [];
    const edgeKeys = new Set();
    for (const rawEdge of evidence.edges) {
      if (!isObject(rawEdge)) throw new TypeError("Every edge must be an object.");
      const from = requiredString(rawEdge.from, "edge.from");
      const to = requiredString(rawEdge.to, "edge.to");
      const source = nodes.get(from);
      const target = nodes.get(to);
      if (!source || !target) throw new Error(`Dangling edge '${from}>${to}'.`);
      const transition = `${source.type}>${target.type}`;
      if (!SUPPORTED_TRANSITIONS.has(transition)) {
        throw new Error(`Unsupported edge transition '${transition}'.`);
      }
      const key = `${from}>${to}`;
      if (edgeKeys.has(key)) throw new Error(`Duplicate edge '${key}'.`);
      edgeKeys.add(key);
      edges.push(Object.freeze({ from, to }));
    }

    return Object.freeze({
      tenantId: evidence.tenantId,
      nodes,
      edges: Object.freeze(edges.sort((left, right) =>
        left.from.localeCompare(right.from) || left.to.localeCompare(right.to)))
    });
  }

  function includesCohort(node, cohortId) {
    return !cohortId || node.cohortIds.length === 0 || node.cohortIds.includes(cohortId);
  }

  function simulateEvidenceGraph(snapshot, options = {}) {
    if (!isObject(options)) throw new TypeError("options must be an object.");
    const graph = validateEvidenceSnapshot(snapshot);
    const tenantId = options.tenantId === undefined
      ? graph.tenantId
      : requiredString(options.tenantId, "options.tenantId");
    if (tenantId !== graph.tenantId) {
      throw new Error(`Snapshot tenant '${graph.tenantId}' does not match requested tenant '${tenantId}'.`);
    }
    const cohortId = options.cohortId === undefined
      ? null
      : requiredString(options.cohortId, "options.cohortId");
    const sensitiveLevels = new Set(stringArray(
      options.sensitiveLevels || ["confidential", "highly-confidential"],
      "options.sensitiveLevels",
      true
    ));
    for (const level of sensitiveLevels) {
      if (!SENSITIVITY.has(level)) throw new TypeError(`Unsupported sensitivity '${level}'.`);
    }

    const outgoing = new Map();
    for (const edge of graph.edges) {
      if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
      outgoing.get(edge.from).push(edge.to);
    }
    for (const targets of outgoing.values()) targets.sort();

    const principals = [...graph.nodes.values()]
      .filter(node => node.type === "Principal" &&
        node.attributes.active !== false &&
        includesCohort(node, cohortId))
      .sort((left, right) => left.id.localeCompare(right.id));
    const resourcePrincipals = new Map();
    const resourceMemberships = new Map();
    const signalResources = new Map();
    const signalPrincipals = new Map();
    const signalSurfaces = new Map();
    const surfacePolicies = new Map();
    const missing = new Map();
    const relevantNodeIds = new Set(principals.map(node => node.id));

    function addMissing(code, node, expectedType) {
      const key = `${code}:${node.id}:${expectedType}`;
      missing.set(key, { code, nodeId: node.id, nodeType: node.type, expectedType });
    }

    function targetsOf(node, expectedType) {
      const targets = (outgoing.get(node.id) || [])
        .map(id => graph.nodes.get(id))
        .filter(target => includesCohort(target, cohortId));
      if (!targets.length) addMissing("MISSING_EDGE", node, expectedType);
      return targets;
    }

    for (const principal of principals) {
      for (const membership of targetsOf(principal, "Membership")) {
        relevantNodeIds.add(membership.id);
        for (const resource of targetsOf(membership, "Resource")) {
          relevantNodeIds.add(resource.id);
          if (!resourcePrincipals.has(resource.id)) resourcePrincipals.set(resource.id, new Set());
          if (!resourceMemberships.has(resource.id)) resourceMemberships.set(resource.id, new Set());
          resourcePrincipals.get(resource.id).add(principal.id);
          resourceMemberships.get(resource.id).add(membership.id);
        }
      }
    }

    for (const resourceId of [...resourcePrincipals.keys()].sort()) {
      const resource = graph.nodes.get(resourceId);
      for (const signal of targetsOf(resource, "ContentSignal")) {
        relevantNodeIds.add(signal.id);
        signalResources.set(signal.id, resource.id);
        signalPrincipals.set(signal.id, new Set(resourcePrincipals.get(resource.id)));
        for (const surface of targetsOf(signal, "AISurface")) {
          if (surface.attributes.enabled === false) continue;
          relevantNodeIds.add(surface.id);
          if (!signalSurfaces.has(signal.id)) signalSurfaces.set(signal.id, new Set());
          signalSurfaces.get(signal.id).add(surface.id);
        }
      }
    }

    for (const surfaceId of [...new Set(
      [...signalSurfaces.values()].flatMap(ids => [...ids])
    )].sort()) {
      const surface = graph.nodes.get(surfaceId);
      const policies = targetsOf(surface, "Policy");
      surfacePolicies.set(surfaceId, new Set());
      for (const policy of policies) {
        relevantNodeIds.add(policy.id);
        surfacePolicies.get(surfaceId).add(policy.id);
      }
    }

    const sensitiveMatches = [];
    const affectedPrincipalIds = new Set();
    const blockingPolicyIds = new Set();
    for (const signalId of [...signalResources.keys()].sort()) {
      const signal = graph.nodes.get(signalId);
      if (signal.attributes.matched === false || !sensitiveLevels.has(signal.attributes.sensitivity)) continue;
      const surfaceIds = [...(signalSurfaces.get(signalId) || [])].sort();
      const blockedBy = new Set();
      let hasUnblockedSurface = false;
      for (const surfaceId of surfaceIds) {
        const policies = [...(surfacePolicies.get(surfaceId) || [])]
          .map(id => graph.nodes.get(id));
        const blockers = policies.filter(policy =>
          policy.attributes.enabled !== false && policy.attributes.effect === "block");
        if (blockers.length) {
          for (const blocker of blockers) {
            blockedBy.add(blocker.id);
            blockingPolicyIds.add(blocker.id);
          }
        } else {
          hasUnblockedSurface = true;
        }
      }
      const principalIds = [...signalPrincipals.get(signalId)].sort();
      if (hasUnblockedSurface) {
        for (const principalId of principalIds) affectedPrincipalIds.add(principalId);
      }
      sensitiveMatches.push({
        signalId,
        resourceId: signalResources.get(signalId),
        sensitivity: signal.attributes.sensitivity,
        principalIds,
        aiSurfaceIds: surfaceIds,
        blockedByPolicyIds: [...blockedBy].sort()
      });
    }

    const missingEvidence = [...missing.values()].sort((left, right) =>
      left.nodeId.localeCompare(right.nodeId) ||
      left.expectedType.localeCompare(right.expectedType));
    const confidenceValues = [...relevantNodeIds]
      .map(id => graph.nodes.get(id).attributes.confidence)
      .map(value => value === undefined ? 1 : value);
    const baseConfidence = confidenceValues.length
      ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
      : 0;
    const completeness = relevantNodeIds.size + missingEvidence.length === 0
      ? 0
      : relevantNodeIds.size / (relevantNodeIds.size + missingEvidence.length);
    const confidence = Number((baseConfidence * completeness).toFixed(4));

    return {
      tenantId,
      cohortId,
      reachableResources: [...resourcePrincipals.keys()].sort().map(resourceId => ({
        resourceId,
        principalIds: [...resourcePrincipals.get(resourceId)].sort(),
        membershipIds: [...resourceMemberships.get(resourceId)].sort()
      })),
      sensitiveMatches,
      affectedAudience: [...affectedPrincipalIds].sort(),
      blockingControls: [...blockingPolicyIds].sort().map(policyId => {
        const policy = graph.nodes.get(policyId);
        return {
          policyId,
          controlId: policy.attributes.controlId,
          effect: policy.attributes.effect
        };
      }).sort((left, right) =>
        left.controlId.localeCompare(right.controlId) || left.policyId.localeCompare(right.policyId)),
      confidence,
      confidenceLevel: confidence >= 0.85 ? "High" : confidence >= 0.6 ? "Medium" : "Low",
      missingEvidence
    };
  }

  return {
    NODE_TYPES,
    SUPPORTED_TRANSITIONS: Object.freeze([...SUPPORTED_TRANSITIONS].sort()),
    validateEvidenceSnapshot,
    simulateEvidenceGraph
  };
});
