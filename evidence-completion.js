(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FlightDeckEvidenceCompletion = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ADMIN_DOMAINS = new Set([
    "exchangeOnline",
    "sharePointOneDrive",
    "purviewCompliance",
    "securityPosture"
  ]);
  const STATE_PRIORITY = Object.freeze({
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
      domainName: domain.name
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

    const missingPermissions = (control.requiredPermissions || [])
      .filter(permission => !options.grantedPermissions.has(permission));
    if (missingPermissions.length) return "MissingPermission";
    const missingLicenses = (control.requiredLicenses || [])
      .filter(license => !options.availableLicenses.has(license));
    if (missingLicenses.length) return "MissingLicense";

    const limitations = limitationText(result);
    if (/PERMISSION|CONSENT|FORBIDDEN|ACCESS DENIED/.test(limitations)) {
      return "MissingPermission";
    }
    if (/LICEN[CS]E|ENTITLEMENT|SKU/.test(limitations)) return "MissingLicense";
    if (/ATTESTATION/.test(limitations) || control.automation === "Attested") {
      return "SignedAttestationRequired";
    }
    if (/POWER_PLATFORM|ENVIRONMENT_INVENTORY|AGENT_|CONNECTOR/.test(limitations) ||
        control.domainId === "powerPlatformAgents") {
      return "PowerPlatformEvidenceRequired";
    }
    if (/COMMAND_|ADMIN|EXCHANGE|PURVIEW|SHAREPOINT/.test(limitations) ||
        ADMIN_DOMAINS.has(control.domainId)) {
      return "AdminEvidenceRequired";
    }
    return "LiveCollectionRequired";
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
    availableLicenses = [],
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
      availableLicenses: new Set(availableLicenses)
    };
    const controls = flattenCatalog(catalog).map(control => {
      const result = resultsById.get(control.id) || null;
      const state = classify(control, result, options);
      const missingPermissions = (control.requiredPermissions || [])
        .filter(permission => !options.grantedPermissions.has(permission));
      const missingLicenses = (control.requiredLicenses || [])
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
        missingPermissions,
        missingLicenses,
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
