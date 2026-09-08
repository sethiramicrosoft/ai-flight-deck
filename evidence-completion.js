(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports
    ? require("./enablement-playbook") : root.FlightDeckEnablement);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FlightDeckEvidenceCompletion = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (enablement) {
  "use strict";

  const STATE_PRIORITY = Object.freeze({
    ObservationValidationRequired: 0,
    IntegrationRequired: 0,
    MissingPermission: 0,
    MissingLicense: 1,
    SignedAttestationRequired: 2,
    AdminEvidenceRequired: 3,
    PowerPlatformEvidenceRequired: 4,
    RecollectionRequired: 5,
    LiveCollectionRequired: 6,
    ConfigurationAction: 7,
    OwnerReview: 8,
    Complete: 9
  });
  const STATE_DETAILS = Object.freeze({
    ObservationValidationRequired: {
      label: "App capability missing",
      action: "The app maintainer must implement and validate this control's source-observation contract. No tenant permission change is prescribed."
    },
    IntegrationRequired: {
      label: "App capability missing",
      action: "The app maintainer must connect the missing evidence source and its validation contract. No tenant permission change is prescribed."
    },
    MissingPermission: {
      label: "Permission required",
      action: "Ask the workload administrator to review the confirmed access denial and the source's least-privilege access requirements."
    },
    MissingLicense: {
      label: "Licence evidence required",
      action: "Confirm the listed product entitlement for the approved cohort, then rescan."
    },
    SignedAttestationRequired: {
      label: "Signed attestation required",
      action: "Create an accountable statement with an owner, evidence data, and expiry."
    },
    AdminEvidenceRequired: {
      label: "Administrator evidence required",
      action: "In Set up, select Collect workload evidence and complete the Microsoft workload sign-in prompts. The app collects and processes the results."
    },
    PowerPlatformEvidenceRequired: {
      label: "Power Platform evidence required",
      action: "In Set up, select Collect workload evidence and complete Power Platform sign-in. The app collects supported resources and records any gaps."
    },
    RecollectionRequired: {
      label: "Recollect evidence",
      action: "Re-run the relevant collector to replace expired, legacy or unverified evidence."
    },
    LiveCollectionRequired: {
      label: "Not yet collected",
      action: "Connect the tenant with the required read-only access and run the live scan."
    },
    ConfigurationAction: {
      label: "Configuration action required",
      action: "Implement the control playbook, then collect new evidence."
    },
    OwnerReview: {
      label: "Owner review required",
      action: "Have the accountable owner review the evidence and record the decision."
    },
    Complete: {
      label: "Complete",
      action: "No current action is required while the evidence remains fresh."
    }
  });
  // Presentation-only capability inventory, matching the implemented source contracts.
  // This never admits evidence or substitutes for the authority validators.
  const VALIDATED_GRAPH_SCOPES = Object.freeze({
    "AFD-LIC-001": ["Directory.Read.All", "Organization.Read.All"],
    "AFD-LIC-002": ["Directory.Read.All", "Organization.Read.All"],
    "AFD-LIC-004": ["Directory.Read.All", "Organization.Read.All"]
  });
  const PERMISSION_CODES = new Set([
    "403", "HTTP_403", "PERMISSION_DENIED", "COMMAND_ACCESS_DENIED",
    "CONSENT_REQUIRED", "ADMIN_CONSENT_REQUIRED", "AUTH_CONSENT_REQUIRED", "FORBIDDEN",
    "AUTHORIZATION_REQUESTDENIED", "ERRORACCESSDENIED", "ACCESS_DENIED"
  ]);
  const CAPABILITY_CODES = new Set([
    "COMMAND_UNAVAILABLE", "COMMAND_NOT_FOUND", "COMMAND_WARNING", "COMMAND_FAILED",
    "COMMAND_PARAMETER_BINDING", "ON_PREMISES_SOURCE_UNAVAILABLE", "API_UNAVAILABLE",
    "EVIDENCE_SHAPE_UNSUPPORTED", "OBSERVATION_VALIDATION_REQUIRED",
    "SOURCE_VALIDATION_UNSUPPORTED", "INTEGRATION_REQUIRED"
  ]);

  function flattenCatalog(catalog) {
    return catalog.domains.flatMap(domain => domain.controls.map(control => ({
      ...control,
      domainId: domain.id,
      domainName: domain.name,
      ownerRoles: [...domain.ownerRoles],
      collection: enablement.collectionGuidance(domain, control)
    })));
  }

  function validFuture(value, now) {
    return typeof value === "string" &&
      Number.isFinite(Date.parse(value)) &&
      Date.parse(value) > now.getTime();
  }

  function completeResult(result, now, control = null) {
    return enablement.isSatisfied(result, now, control);
  }

  function limitationCodes(result) {
    return new Set((result?.limitations || []).map(item => String(item.code || "").toUpperCase()));
  }

  function appBlockedReason(control, result) {
    const codes = limitationCodes(result);
    const sourceGaps = [...codes].filter(code => CAPABILITY_CODES.has(code));
    const reasons = [];
    if (sourceGaps.length) reasons.push(`Source capability unavailable or unusable: ${sourceGaps.join(", ")}.`);
    if (control.collection.kind === "IntegrationRequired") reasons.push(control.collection.limitation);
    if (control.automation !== "Attested" && !VALIDATED_GRAPH_SCOPES[control.id]) {
      reasons.push(`No source-observation validation contract is implemented for ${control.id}.`);
    }
    return reasons.join(" ") || null;
  }

  function missingGraphScopes(control, options) {
    return (VALIDATED_GRAPH_SCOPES[control.id] || [])
      .filter(permission => !options.grantedPermissions.has(permission));
  }

  function classify(control, result, options) {
    const now = options.now;
    if (completeResult(result, now, control)) return "Complete";
    const category = enablement.classify(result, now, control);
    if (category === "Action required") return "ConfigurationAction";
    if (category === "Owner review") return "OwnerReview";
    const codes = limitationCodes(result);
    if ([...codes].some(code => PERMISSION_CODES.has(code))) return "MissingPermission";
    if (appBlockedReason(control, result)) {
      return control.collection.kind === "IntegrationRequired" ||
        [...codes].some(code => CAPABILITY_CODES.has(code))
        ? "IntegrationRequired" : "ObservationValidationRequired";
    }
    if (result && ["Pass", "NotApplicable"].includes(result.status)) return "RecollectionRequired";
    if (result?.freshUntil && !validFuture(result.freshUntil, now)) {
      return "RecollectionRequired";
    }
    if (["LICENSE_REQUIRED", "LICENCE_REQUIRED", "LICENSE_MISSING", "ENTITLEMENT_REQUIRED"]
      .some(code => codes.has(code))) {
      return "MissingLicense";
    }
    if (missingGraphScopes(control, options).length) return "MissingPermission";
    const missingLicenses = options.availableLicenses === null ? [] : (control.requiredLicenses || [])
      .filter(license => !options.availableLicenses.has(license));
    if (missingLicenses.length) return "MissingLicense";

    return control.collection.kind;
  }

  function actionLane(state) {
    if (state === "Complete") return "complete";
    if (["ObservationValidationRequired", "IntegrationRequired"].includes(state)) return "appLimitations";
    if (state === "ConfigurationAction") return "configurationActions";
    if (["SignedAttestationRequired", "OwnerReview"].includes(state)) return "userDecisions";
    return "administratorActions";
  }

  function pendingDecisions(cohort, decisions) {
    const tasks = [];
    if (!cohort?.id || cohort.approved !== true) tasks.push({
      id: "pilotCohort", title: "Approve the pilot group",
      description: "The app needs explicitly approved directory users or groups to bound the pilot population.",
      nextAction: "Select the pilot directory users or groups and approve their scope. Approval does not validate any control."
    });
    if (!["yes", "no"].includes(decisions?.hybridExchange?.value)) tasks.push({
      id: "hybridExchange", title: "Record whether hybrid Exchange is in scope",
      description: "This local scope decision is not proof of hybrid configuration or signed applicability evidence.",
      nextAction: "Record yes or no with the accountable owner and rationale. This does not change Microsoft settings or clear Unknown."
    });
    if (!["allow", "restrict"].includes(decisions?.webGrounding?.value)) tasks.push({
      id: "webGrounding", title: "Record the web-grounding policy choice",
      description: "The intended policy and the effective Microsoft setting are separate. The app cannot yet validate the effective setting.",
      nextAction: "Record allow or restrict with the accountable owner and rationale. This does not change Microsoft settings or clear Unknown."
    });
    return tasks;
  }

  function firstCurrentMission(catalog, resultsById, now) {
    return [...catalog.missions]
      .sort((left, right) => left.order - right.order)
      .find(mission => mission.requiredControlIds.some(controlId =>
        !completeResult(resultsById.get(controlId), now))) || null;
  }

  function buildEvidenceCompletionPlan({
    catalog,
    controlResults = [],
    grantedPermissions = [],
    availableLicenses = null,
    cohort = null,
    decisions = null,
    now = new Date()
  }) {
    if (!catalog || !Array.isArray(catalog.domains) || !Array.isArray(catalog.missions)) {
      throw new TypeError("A readiness catalogue with domains and missions is required.");
    }
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
      throw new TypeError("A valid evaluation time is required.");
    }
    const cohortId = cohort?.id || null;
    const selected = controlResults.filter(result => !cohortId || result.cohortId === cohortId);
    const consistent = enablement.hasConsistentBindings(selected);
    const resultsById = new Map();
    for (const result of selected) {
      if (resultsById.has(result.controlId)) throw new Error(`Duplicate control result '${result.controlId}'.`);
      resultsById.set(result.controlId, consistent ? result : { ...result });
    }
    const currentMission = firstCurrentMission(catalog, resultsById, now);
    const currentControlIds = new Set(currentMission?.requiredControlIds || []);
    const options = {
      now,
      grantedPermissions: new Set(grantedPermissions),
      availableLicenses: availableLicenses === null ? null : new Set(availableLicenses)
    };
    const controls = flattenCatalog(catalog).map(control => {
      const result = resultsById.get(control.id) || null;
      const state = classify(control, result, options);
      const blockedReason = ["Complete", "ConfigurationAction", "OwnerReview"].includes(state)
        ? null : appBlockedReason(control, result);
      const missingPermissions = blockedReason ? [] : missingGraphScopes(control, options);
      const missingLicenses = options.availableLicenses === null ? [] : (control.requiredLicenses || [])
        .filter(license => !options.availableLicenses.has(license));
      const codes = limitationCodes(result);
      const confirmedDenial = [...codes].some(code => PERMISSION_CODES.has(code));
      const unclassified = codes.has("MISSING_PERMISSION_OR_ROLE") || codes.has("SOURCE_QUERY_FAILED") ||
        [...codes].some(code => !PERMISSION_CODES.has(code) && !CAPABILITY_CODES.has(code) &&
          !["LICENSE_REQUIRED", "LICENCE_REQUIRED", "LICENSE_MISSING", "ENTITLEMENT_REQUIRED",
            "AUTHORITY_VALIDATION_REQUIRED", "EVIDENCE_NOT_ADMISSIBLE", "APPROVED_COHORT_REQUIRED",
            "INCOMPLETE_EVIDENCE", "COLLECTION_BOUND_REACHED"].includes(code));
      const warning = unclassified
        ? "The source failure cause is unclassified; missing administrator roles or permissions have not been established."
        : null;
      let nextAction = STATE_DETAILS[state].action;
      if (state === "MissingPermission" && !confirmedDenial) {
        nextAction = `Ask the administrator to review the required read-only Graph scopes for the implemented licensing collector: ${missingPermissions.join(", ")}. Collect fresh evidence after access is available.`;
      }
      if (state === "MissingPermission" && blockedReason) {
        nextAction += " Access recovery alone cannot complete this control: the app capability is also missing.";
      }
      return {
        controlId: control.id,
        title: control.title,
        domainId: control.domainId,
        domainName: control.domainName,
        requirement: control.requirement,
        automation: control.automation,
        missions: [...(control.missions || [])],
        currentMission: currentControlIds.has(control.id),
        status: ["Complete", "ConfigurationAction", "OwnerReview"].includes(state) ? result.status : "Unknown",
        reportedStatus: result?.authority?.claimedStatus || result?.status || "Unknown",
        state,
        stateLabel: STATE_DETAILS[state].label,
        actionLane: actionLane(state),
        nextAction,
        why: blockedReason || warning || (state === "MissingPermission"
          ? confirmedDenial ? "The source reported an explicit access or consent denial."
            : "Required Graph scopes for an implemented collector are missing."
          : STATE_DETAILS[state].label),
        appBlockedReason: blockedReason,
        warning,
        collection: control.collection,
        missingPermissions,
        missingLicenses,
        licenseInventoryStatus: options.availableLicenses === null ? "NotAssessed" : "Recorded",
        limitations: (result?.limitations || []).map(item => ({
          code: item.code,
          description: item.description
        })),
        owner: control.ownerRoles?.[0] || "Accountable owner",
        effort: state === "Complete" ? "Complete" :
          blockedReason ? "App implementation required" :
          state.includes("Permission") || state.includes("License") ? "Administrator review" :
            state.includes("Attestation") || state === "OwnerReview" ? "<1 hour" :
              state.includes("Evidence") ? "1-4 hours" : "Varies"
      };
    }).sort((left, right) =>
      Number(right.currentMission) - Number(left.currentMission) ||
      Number(right.requirement === "Gate") - Number(left.requirement === "Gate") ||
      STATE_PRIORITY[left.state] - STATE_PRIORITY[right.state] ||
      left.owner.localeCompare(right.owner) ||
      left.controlId.localeCompare(right.controlId));

    const counts = Object.fromEntries(Object.keys(STATE_DETAILS).map(state => [
      state,
      controls.filter(control => control.state === state).length
    ]));
    const lanes = {
      userDecisions: pendingDecisions(cohort, decisions),
      administratorActions: [],
      appLimitations: [],
      configurationActions: [],
      complete: []
    };
    for (const control of controls) lanes[control.actionLane].push(control);
    const laneCounts = Object.fromEntries(Object.entries(lanes).map(([lane, items]) => [lane, items.length]));
    return {
      cohort: cohort ? {
        id: cohort.id,
        name: cohort.name || cohort.id,
        approved: cohort.approved === true
      } : null,
      currentMission: currentMission ? {
        id: currentMission.id,
        name: currentMission.name,
        order: currentMission.order
      } : null,
      controls,
      lanes,
      laneCounts,
      topBlockers: controls.filter(control => control.state !== "Complete").slice(0, 5),
      counts,
      summary: {
        total: controls.length,
        complete: counts.Complete,
        evidenceRequired: controls.filter(control =>
          !["Complete", "ConfigurationAction", "OwnerReview"].includes(control.state)).length,
        actionRequired: counts.ConfigurationAction,
        ownerReview: counts.OwnerReview,
        unknown: controls.filter(control => control.status === "Unknown").length,
        explanation: "Unknown means evidence is not yet authoritative, not a confirmed tenant misconfiguration."
      }
    };
  }

  return {
    STATE_DETAILS,
    buildEvidenceCompletionPlan,
    completeResult
  };
});
