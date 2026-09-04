"use strict";

const catalog = require("./schema/readiness-catalog.v1.json");

const SERVICE_BY_DOMAIN = Object.freeze({
  licensingAndTenantEntitlement: {
    id: "microsoft-graph-licensing",
    role: "License Administrator",
    endpoints: ["https://graph.microsoft.com/v1.0/subscribedSkus", "https://graph.microsoft.com/v1.0/users"]
  },
  identityAndAccess: {
    id: "microsoft-entra",
    role: "Global Reader",
    endpoints: ["https://graph.microsoft.com/v1.0/policies", "https://graph.microsoft.com/v1.0/identityGovernance"]
  },
  devicesAndApps: {
    id: "microsoft-intune",
    role: "Intune Administrator",
    endpoints: ["https://graph.microsoft.com/v1.0/deviceManagement"]
  },
  networkConnectivity: {
    id: "network-assessment",
    role: "Network Administrator",
    endpoints: ["https://connectivity.office.com"]
  },
  serviceHealthOperations: {
    id: "microsoft-365-service-health",
    role: "Service Support Administrator",
    endpoints: ["https://graph.microsoft.com/v1.0/admin/serviceAnnouncement"]
  },
  exchangeOnline: {
    id: "exchange-online",
    role: "Exchange Administrator",
    endpoints: ["https://outlook.office365.com/adminapi"]
  },
  teamsReadiness: {
    id: "microsoft-teams",
    role: "Teams Administrator",
    endpoints: ["https://graph.microsoft.com/v1.0/teamwork"]
  },
  sharePointOneDrive: {
    id: "sharepoint-online",
    role: "SharePoint Administrator",
    endpoints: ["https://graph.microsoft.com/v1.0/sites", "https://graph.microsoft.com/v1.0/drives"]
  },
  purviewCompliance: {
    id: "microsoft-purview",
    role: "Compliance Administrator",
    endpoints: ["https://graph.microsoft.com/v1.0/security"]
  },
  securityPosture: {
    id: "microsoft-defender",
    role: "Security Reader",
    endpoints: ["https://graph.microsoft.com/v1.0/security"]
  },
  copilotConfiguration: {
    id: "microsoft-365-copilot",
    role: "Global Reader",
    endpoints: ["https://graph.microsoft.com/v1.0/admin"]
  },
  powerPlatformAgents: {
    id: "power-platform",
    role: "Power Platform Administrator",
    endpoints: ["https://api.bap.microsoft.com", "https://api.powerplatform.com"]
  },
  adoptionMeasurementGovernance: {
    id: "adoption-attestation",
    role: null,
    endpoints: []
  }
});

function buildCollectorDefinitions(readinessCatalog = catalog) {
  return readinessCatalog.domains.map(domain => {
    const service = SERVICE_BY_DOMAIN[domain.id];
    if (!service) throw new Error(`No collector service mapping exists for domain '${domain.id}'.`);
    const permissions = [...new Set(domain.controls.flatMap(control => control.requiredPermissions || []))].sort();
    const licenses = [...new Set(domain.controls.flatMap(control => control.requiredLicenses || []))].sort();
    return {
      id: `${domain.id.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}-collector`,
      domainId: domain.id,
      services: [{
        id: service.id,
        controls: domain.controls.map(control => control.id),
        permissions: {
          localDelegated: permissions,
          productionApplication: permissions
        },
        licenses,
        adminRoles: service.role ? [service.role] : [],
        endpoints: service.endpoints,
        authModes: ["local-delegated", "production-application"]
      }]
    };
  });
}

module.exports = {
  SERVICE_BY_DOMAIN,
  buildCollectorDefinitions
};
