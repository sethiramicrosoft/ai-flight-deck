"use strict";

function policy(state = "enabled") {
  return {
    id: "synthetic-policy", displayName: "Synthetic pilot baseline", state,
    conditions: {
      users: { includeUsers: ["user-1"], excludeUsers: [], includeGroups: [], excludeGroups: [],
        includeRoles: [], excludeRoles: [], includeGuestsOrExternalUsers: null, excludeGuestsOrExternalUsers: null },
      applications: { includeApplications: ["All"], excludeApplications: [], applicationFilter: null },
      clientAppTypes: ["all"], locations: null, platforms: null, devices: null,
      signInRiskLevels: [], userRiskLevels: []
    },
    grantControls: { operator: "AND", builtInControls: ["mfa", "compliantDevice"],
      customAuthenticationFactors: [], termsOfUse: [], authenticationStrength: null }
  };
}
module.exports = { policy };
