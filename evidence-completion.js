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
      label: "The app cannot confirm this check",
      action: "The app maintainer needs to add and test the rules that check the collected information for this requirement. Review the requirement outside Flight Deck for now. Changing tenant permissions will not add those rules."
    },
    IntegrationRequired: {
      label: "A software connection or checking rule is missing",
      action: "The app maintainer needs to add a working connection to the relevant Microsoft service and rules for checking its results. Review this requirement with the service administrator outside Flight Deck; a permission change alone is not a solution."
    },
    MissingPermission: {
      label: "Read access needs review",
      action: "The service refused a read request. Ask its administrator to inspect the access error and approve only the read permissions required for that request. Run collection again after access is available."
    },
    MissingLicense: {
      label: "Licence information needs confirmation",
      action: "Ask the licensing administrator whether the listed subscription or feature is available to the selected pilot users. Do not buy an add-on just to remove this message. Confirm that the feature is required, then scan again when the information is available."
    },
    SignedAttestationRequired: {
      label: "A written answer from the responsible person is needed",
      action: "Open the owner-statement form, write what the responsible person has confirmed, add the requested supporting details and references, and choose when the answer must be reviewed again. This is a human statement, not an automatic inspection of Microsoft 365."
    },
    AdminEvidenceRequired: {
      label: "A service administrator needs to collect information",
      action: "In Set up, select Collect workload evidence and complete the Microsoft workload sign-in prompts. The app collects and processes the results."
    },
    PowerPlatformEvidenceRequired: {
      label: "Power Platform information needs to be collected",
      action: "In Set up, select Collect workload evidence and complete Power Platform sign-in. The app collects supported resources and records any gaps."
    },
    RecollectionRequired: {
      label: "A fresh collection is needed",
      action: "The saved information is too old or cannot be used by the current checks. Run the relevant collection again to read current information from Microsoft 365."
    },
    LiveCollectionRequired: {
      label: "This information has not been collected",
      action: "Use Connect and scan tenant in Set up. Sign in to the intended Microsoft 365 organization and complete the requested read-access approvals."
    },
    ConfigurationAction: {
      label: "A setting needs review",
      action: "Read the check's instructions with the relevant administrator. If your organization approves a change, make it through the normal administration tools, then scan again to check what changed. Flight Deck does not change the setting."
    },
    OwnerReview: {
      label: "The responsible person needs to review the result",
      action: "Ask the person responsible for this requirement to review the collected information, explain whether it is acceptable for the pilot, and record their answer."
    },
    Complete: {
      label: "Enough current information",
      action: "This check currently meets Flight Deck's rules. Review it again when its information expires or the relevant users or settings change."
    }
  });
  // Presentation-only capability inventory, matching the implemented source contracts.
  // This never admits evidence or substitutes for the authority validators.
  const VALIDATED_GRAPH_SCOPES = Object.freeze({
    "AFD-LIC-001": ["Directory.Read.All", "Organization.Read.All"],
    "AFD-LIC-002": ["Directory.Read.All", "Organization.Read.All"],
    "AFD-LIC-004": ["Directory.Read.All", "Organization.Read.All"],
    "AFD-IAM-003": ["Policy.Read.All"]
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
    if (sourceGaps.length) reasons.push("The connection or command did not provide information that this check can use. The technical details below list the reported errors.");
    if (control.collection.kind === "IntegrationRequired") reasons.push(control.collection.limitation);
    if (control.automation !== "Attested" && !VALIDATED_GRAPH_SCOPES[control.id]) {
      reasons.push(`Flight Deck does not yet have the rules needed to confirm ${control.id} from the information collected.`);
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
      id: "pilotCohort", title: "Choose who will take part in the Copilot pilot",
      description: "Flight Deck needs a list of pilot participants before it can check their licence assignments. It does not assume that every licensed person is in the pilot.",
      nextAction: "Search for users or groups in the pilot form, name the person responsible and approve the selected people. This saves the participant list; it does not assign licences or grant access."
    });
    if (!["yes", "no"].includes(decisions?.hybridExchange?.value)) tasks.push({
      id: "hybridExchange", title: "Confirm whether pilot users use an on-premises Exchange server",
      description: "An organization may use its own Exchange email server alongside Exchange Online. A cloud scan cannot inspect that server, so Flight Deck asks whether it is relevant to the pilot.",
      nextAction: "Ask the email administrator, then record Yes or No and explain who confirmed it. Saving the answer does not change Exchange settings or complete the technical checks."
    });
    if (!["allow", "restrict"].includes(decisions?.webGrounding?.value)) tasks.push({
      id: "webGrounding", title: "Decide whether Copilot may use public-web information",
      description: "Record whether your organization intends to allow Copilot to use information from the public web for these users. Flight Deck cannot yet confirm the actual Microsoft setting.",
      nextAction: "Confirm the choice with the person responsible for the policy, then save Allow or Restrict with their name and the reason. An administrator must check or change the Microsoft setting separately."
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
        ? "The service request failed, but Flight Deck could not identify the cause. This is not enough information to say an administrator role or permission is missing."
        : null;
      let nextAction = STATE_DETAILS[state].action;
      if (state === "MissingPermission" && !confirmedDenial) {
        nextAction = `Ask the administrator to review the Microsoft Graph read permissions needed for the licensing checks: ${missingPermissions.join(", ")}. Run collection again after read access is available.`;
      }
      if (state === "MissingPermission" && blockedReason) {
        nextAction += " Restoring read access will not finish this check: the app also needs additional software support.";
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
          ? confirmedDenial ? "Microsoft reported that the requested read access or consent was denied."
            : "The signed-in connection does not have all the Microsoft Graph read permissions needed for this check."
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
        explanation: "Not confirmed means Flight Deck does not have enough usable information to decide this check. It does not mean the Microsoft 365 setting is wrong."
      }
    };
  }

  return {
    STATE_DETAILS,
    buildEvidenceCompletionPlan,
    completeResult
  };
});
