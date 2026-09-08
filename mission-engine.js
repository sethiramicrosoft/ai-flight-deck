(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports
    ? require("./evidence-admissibility") : root.FlightDeckEvidenceAdmissibility);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FlightDeckMissionEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (evidence) {
  "use strict";

  const { evaluateControl, approvedNotApplicable } = evidence;

  function evaluateMissions({ catalog, controlResults, cohorts, tenantId, collectorRunId, now = new Date() }) {
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
    const definitions = new Map(catalog.domains.flatMap(d => d.controls.map(c => [c.id, c])));
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
      if (!evidence.hasConsistentBindings([...cohortResults.values()])) {
        for (const [id, result] of cohortResults) cohortResults.set(id, { ...result });
      }
      let predecessorSatisfied = true;
      const missions = [...catalog.missions]
        .sort((left, right) => left.order - right.order)
        .map(mission => {
          const controls = mission.requiredControlIds.map(controlId => ({
            controlId,
            ...evaluateControl(cohortResults.get(controlId), now, definitions.get(controlId),
              tenantId && collectorRunId ? { tenantId, collectorRunId, cohortId: cohort.id } : null)
          }));
          const blockers = controls.filter(control => !control.satisfied);
          const ownControlsSatisfied = blockers.length === 0;
          const satisfied = predecessorSatisfied && ownControlsSatisfied;
          const results = mission.requiredControlIds
            .map(controlId => cohortResults.get(controlId))
            .filter(Boolean);
          const confidences = results
            .map(result => result.confidence)
            .filter(value => typeof value === "number" && Number.isFinite(value));
          const freshUntil = results
            .map(result => result.freshUntil)
            .filter(value => value && !Number.isNaN(Date.parse(value)))
            .sort((left, right) => Date.parse(left) - Date.parse(right))[0] || null;
          const assumptions = [...new Set(results.flatMap(result =>
            Array.isArray(result.authority?.assumptions) ? result.authority.assumptions : []))];
          const whatWouldChangeDecision = blockers.map(blocker => {
            const result = cohortResults.get(blocker.controlId);
            const authorityAction = result?.authority?.whatWouldChangeDecision?.[0];
            if (authorityAction) return `${blocker.controlId}: ${authorityAction}`;
            if (blocker.reason === "Expired") return `${blocker.controlId}: collect fresh evidence.`;
            if (blocker.reason === "IncompleteCoverage") {
              return `${blocker.controlId}: complete the recorded evidence boundary.`;
            }
            if (blocker.reason === "UnverifiedPass") {
              return `${blocker.controlId}: collect supported source-bound evidence.`;
            }
            return `${blocker.controlId}: ${blocker.explanation}`;
          });
          if (!predecessorSatisfied) whatWouldChangeDecision.unshift(
            "Complete the earlier mission's blockers first; this mission cannot be eligible while a predecessor is blocked.");
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
            blockers,
            evidenceQuality: {
              resultsAvailable: results.length,
              missingControls: controls.length - results.length,
              completeCoverage: results.filter(result => evidence.hasConclusiveCoverage(result)).length,
              acceptedPasses: controls.filter(control => control.satisfied && control.status === "Pass").length,
              reportedConfidenceControls: confidences.length,
              minimumConfidence: confidences.length === controls.length && controls.length
                ? Math.min(...confidences) : null,
              earliestFreshUntil: freshUntil,
              unresolvedAssumptions: assumptions
            },
            whatWouldChangeDecision
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
