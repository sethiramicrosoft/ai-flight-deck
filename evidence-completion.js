(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports
    ? require("./enablement-playbook") : root.FlightDeckEnablement);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FlightDeckEvidenceCompletion = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (enablement) {
  "use strict";

  const STATE_PRIORITY = Object.freeze({
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
    IntegrationRequired: {
      label: "Evidence integration required",
      action: "Retain the owner-reviewed evidence and connect the missing input. A permission grant or rescan alone will not close this gap."
    },
    MissingPermission: {
      label: "Permission required",
      action: "Grant the listed read permission, then run this evidence collector again."
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
      action: "Run the administrator evidence collector, import its package, then rescan."
    },
    PowerPlatformEvidenceRequired: {
      label: "Power Platform evidence required",
      action: "Import the seven-resource Power Platform evidence package, then rescan."
    },
    RecollectionRequired: {
      label: "Evidence expired",
      action: "Re-run the relevant collector to replace the expired evidence."
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

  function completeResult(result, now) {
    if (!result || result.coverage?.complete !== true || !validFuture(result.freshUntil, now)) {
      return false;
    }
    if (result.status === "Pass") return true;
    return result.status === "NotApplicable" &&
      result.applicability?.applies === false &&
      typeof result.applicability?.approvedBy === "string" &&
      Boolean(result.applicability.approvedBy.trim()) &&
      validFuture(result.applicability.expiresAt, now);
  }

  function limitationText(result) {
    return (result?.limitations || [])
      .map(item => `${item.code || ""} ${item.description || ""}`.trim())
      .join(" ")
      .toUpperCase();
  }

  function classify(control, result, options) {
    const now = options.now;
    if (completeResult(result, now)) return "Complete";
    if (result?.status === "Fail") return "ConfigurationAction";
    if (result?.status === "Warning") return "OwnerReview";
    if (result?.freshUntil && !validFuture(result.freshUntil, now)) {
      return "RecollectionRequired";
    }

    const limitations = limitationText(result);
    if (/PERMISSION_DENIED|MISSING_PERMISSION_OR_ROLE|CONSENT_REQUIRED|FORBIDDEN|ACCESS DENIED|AUTHORIZATION_REQUESTDENIED/.test(limitations)) {
      return "MissingPermission";
    }
    if (/LICENSE_REQUIRED|LICENCE_REQUIRED|LICENSE_MISSING|ENTITLEMENT_REQUIRED/.test(limitations)) {
      return "MissingLicense";
    }
    if (control.collection.kind === "IntegrationRequired") return "IntegrationRequired";
    const missingPermissions = (control.requiredPermissions || [])
      .filter(permission => !options.grantedPermissions.has(permission));
    if (missingPermissions.length) return "MissingPermission";
    const missingLicenses = options.availableLicenses === null ? [] : (control.requiredLicenses || [])
      .filter(license => !options.availableLicenses.has(license));
    if (missingLicenses.length) return "MissingLicense";

    return control.collection.kind;
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
    now = new Date()
  }) {
    if (!catalog || !Array.isArray(catalog.domains) || !Array.isArray(catalog.missions)) {
      throw new TypeError("A readiness catalogue with domains and missions is required.");
    }
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
      throw new TypeError("A valid evaluation time is required.");
    }
    const cohortId = cohort?.id || null;
    const resultsById = new Map(controlResults
      .filter(result => !cohortId || result.cohortId === cohortId)
      .map(result => [result.controlId, result]));
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
      const missingPermissions = (control.requiredPermissions || [])
        .filter(permission => !options.grantedPermissions.has(permission));
      const missingLicenses = options.availableLicenses === null ? [] : (control.requiredLicenses || [])
        .filter(license => !options.availableLicenses.has(license));
      return {
        controlId: control.id,
        title: control.title,
        domainId: control.domainId,
        domainName: control.domainName,
        requirement: control.requirement,
        automation: control.automation,
        missions: [...(control.missions || [])],
        currentMission: currentControlIds.has(control.id),
        status: result?.status || "Unknown",
        state,
        stateLabel: STATE_DETAILS[state].label,
        nextAction: STATE_DETAILS[state].action,
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
          state.includes("Permission") || state.includes("License") ? "<15 minutes" :
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
      topBlockers: controls.filter(control => control.state !== "Complete").slice(0, 5),
      counts,
      summary: {
        total: controls.length,
        complete: counts.Complete,
        evidenceRequired: controls.filter(control =>
          !["Complete", "ConfigurationAction", "OwnerReview"].includes(control.state)).length,
        actionRequired: counts.ConfigurationAction,
        ownerReview: counts.OwnerReview
      }
    };
  }

  return {
    STATE_DETAILS,
    buildEvidenceCompletionPlan,
    completeResult
  };
});
