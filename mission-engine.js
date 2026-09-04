(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FlightDeckMissionEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SATISFIED = new Set(["Pass"]);

  function approvedNotApplicable(result, now) {
    if (result.status !== "NotApplicable" || result.applicability?.applies !== false) return false;
    if (typeof result.applicability.approvedBy !== "string" || !result.applicability.approvedBy.trim()) return false;
    if (!result.applicability.expiresAt) return true;
    return Date.parse(result.applicability.expiresAt) > now.getTime();
  }

  function evaluateControl(result, now) {
    if (!result) return { satisfied: false, reason: "Missing", status: "Unknown" };
    if (!result.freshUntil || Number.isNaN(Date.parse(result.freshUntil))) {
      return { satisfied: false, reason: "InvalidFreshness", status: result.status };
    }
    if (Date.parse(result.freshUntil) <= now.getTime()) {
      return { satisfied: false, reason: "Expired", status: result.status };
    }
    if (SATISFIED.has(result.status)) {
      return { satisfied: true, reason: "Pass", status: result.status };
    }
    if (approvedNotApplicable(result, now)) {
      return { satisfied: true, reason: "ApprovedNotApplicable", status: result.status };
    }
    if (result.status === "NotApplicable") {
      return { satisfied: false, reason: "UnapprovedNotApplicable", status: result.status };
    }
    return { satisfied: false, reason: result.status, status: result.status };
  }

  function evaluateMissions({ catalog, controlResults, cohorts, now = new Date() }) {
    if (!catalog || !Array.isArray(catalog.missions) || !Array.isArray(catalog.domains)) {
      throw new TypeError("A valid readiness catalogue is required.");
    }
    if (!Array.isArray(controlResults) || !Array.isArray(cohorts) || !cohorts.length) {
      throw new TypeError("Control results and at least one cohort are required.");
    }
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
      throw new TypeError("A valid evaluation time is required.");
    }

    const validControlIds = new Set(
      catalog.domains.flatMap(domain => domain.controls.map(control => control.id))
    );
    const resultsByCohort = new Map();
    for (const result of controlResults) {
      if (!result || !validControlIds.has(result.controlId) || typeof result.cohortId !== "string") continue;
      if (!resultsByCohort.has(result.cohortId)) resultsByCohort.set(result.cohortId, new Map());
      const cohortResults = resultsByCohort.get(result.cohortId);
      if (cohortResults.has(result.controlId)) {
        throw new Error(`Duplicate result for cohort '${result.cohortId}' and control '${result.controlId}'.`);
      }
      cohortResults.set(result.controlId, result);
    }

    return cohorts.map(cohort => {
      if (!cohort || typeof cohort.id !== "string" || !cohort.id.trim()) {
        throw new TypeError("Every cohort must have an id.");
      }
      const cohortResults = resultsByCohort.get(cohort.id) || new Map();
      let predecessorSatisfied = true;
      const missions = [...catalog.missions]
        .sort((left, right) => left.order - right.order)
        .map(mission => {
          const controls = mission.requiredControlIds.map(controlId => ({
            controlId,
            ...evaluateControl(cohortResults.get(controlId), now)
          }));
          const blockers = controls.filter(control => !control.satisfied);
          const ownControlsSatisfied = blockers.length === 0;
          const satisfied = predecessorSatisfied && ownControlsSatisfied;
          let status = "Eligible";
          if (!predecessorSatisfied) status = "PredecessorBlocked";
          else if (blockers.some(blocker => blocker.reason === "Expired")) status = "EvidenceExpired";
          else if (!ownControlsSatisfied) status = "Blocked";
          predecessorSatisfied = satisfied;
          return {
            missionId: mission.id,
            missionOrder: mission.order,
            cohortId: cohort.id,
            status,
            satisfied,
            evaluatedAt: now.toISOString(),
            requiredControls: controls.length,
            satisfiedControls: controls.length - blockers.length,
            blockers
          };
        });
      return { cohortId: cohort.id, missions };
    });
  }

  return {
    approvedNotApplicable,
    evaluateControl,
    evaluateMissions
  };
});
