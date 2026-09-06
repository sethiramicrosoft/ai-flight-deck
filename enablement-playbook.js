(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FlightDeckEnablement = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DOMAIN_PROFILES = Object.freeze({
    licensingAndTenantEntitlement: {
      portal: "Microsoft 365 admin center",
      path: "Billing > Your products and Billing > Licenses",
      url: "https://admin.microsoft.com/",
      guidance: {
        title: "Microsoft 365 Copilot licensing",
        url: "https://learn.microsoft.com/en-us/copilot/microsoft-365/microsoft-365-copilot-licensing"
      }
    },
    identityAndAccess: {
      portal: "Microsoft Entra admin center",
      path: "Protection > Conditional Access and Identity governance",
      url: "https://entra.microsoft.com/",
      guidance: {
        title: "Microsoft Entra Conditional Access overview",
        url: "https://learn.microsoft.com/en-us/entra/identity/conditional-access/overview"
      }
    },
    devicesAndApps: {
      portal: "Microsoft Intune admin center",
      path: "Devices, Apps, and Endpoint security",
      url: "https://intune.microsoft.com/",
      guidance: {
        title: "Microsoft 365 Copilot requirements",
        url: "https://learn.microsoft.com/en-us/microsoft-365/copilot/microsoft-365-copilot-requirements"
      }
    },
    networkConnectivity: {
      portal: "Microsoft 365 network connectivity test",
      path: "Run connectivity tests from each representative user location",
      url: "https://connectivity.office.com/",
      guidance: {
        title: "Microsoft 365 network connectivity principles",
        url: "https://learn.microsoft.com/en-us/microsoft-365/enterprise/microsoft-365-network-connectivity-principles"
      }
    },
    serviceHealthOperations: {
      portal: "Microsoft 365 admin center",
      path: "Health > Service health and Health > Message center",
      url: "https://admin.microsoft.com/",
      guidance: {
        title: "Check Microsoft 365 service health",
        url: "https://learn.microsoft.com/en-us/microsoft-365/enterprise/view-service-health"
      }
    },
    exchangeOnline: {
      portal: "Exchange admin center",
      path: "Recipients and Mail flow",
      url: "https://admin.exchange.microsoft.com/",
      guidance: {
        title: "Microsoft 365 Copilot minimum requirements",
        url: "https://learn.microsoft.com/en-us/microsoft-365/copilot/microsoft-365-copilot-minimum-requirements"
      }
    },
    teamsReadiness: {
      portal: "Microsoft Teams admin center",
      path: "Meetings, Users, Teams, and Teams apps",
      url: "https://admin.teams.microsoft.com/",
      guidance: {
        title: "Manage Microsoft 365 Copilot in Teams",
        url: "https://learn.microsoft.com/en-us/microsoftteams/copilot-teams-transcription"
      }
    },
    sharePointOneDrive: {
      portal: "SharePoint admin center",
      path: "Policies > Sharing, Active sites, and Reports",
      url: "https://admin.microsoft.com/sharepoint",
      guidance: {
        title: "SharePoint and OneDrive data security before Copilot",
        url: "https://learn.microsoft.com/en-us/sharepoint/data-access-governance-reports"
      }
    },
    purviewCompliance: {
      portal: "Microsoft Purview portal",
      path: "Solutions",
      url: "https://purview.microsoft.com/",
      guidance: {
        title: "Microsoft Purview data security and compliance protections for Copilot",
        url: "https://learn.microsoft.com/en-us/purview/ai-microsoft-purview"
      }
    },
    securityPosture: {
      portal: "Microsoft Defender portal",
      path: "Secure Score, Incidents & alerts, and System",
      url: "https://security.microsoft.com/",
      guidance: {
        title: "Security and governance for Microsoft 365 Copilot",
        url: "https://learn.microsoft.com/en-us/microsoft-365/copilot/copilot-control-system/security-governance"
      }
    },
    copilotConfiguration: {
      portal: "Microsoft 365 admin center",
      path: "Copilot > Settings",
      url: "https://admin.microsoft.com/",
      guidance: {
        title: "Microsoft 365 Copilot page in the admin center",
        url: "https://learn.microsoft.com/en-us/copilot/microsoft-365/microsoft-365-copilot-page"
      }
    },
    powerPlatformAgents: {
      portal: "Power Platform admin center and Microsoft Copilot Studio",
      path: "Policies > Data policies, Environments, and Agents",
      url: "https://admin.powerplatform.microsoft.com/",
      guidance: {
        title: "Security and governance in Microsoft Copilot Studio",
        url: "https://learn.microsoft.com/en-us/microsoft-copilot-studio/security-and-governance"
      }
    },
    adoptionMeasurementGovernance: {
      portal: "Microsoft 365 admin center and Copilot Dashboard",
      path: "Reports > Usage and the organization's governance records",
      url: "https://admin.microsoft.com/",
      guidance: {
        title: "Microsoft 365 Copilot enablement resources",
        url: "https://learn.microsoft.com/en-us/microsoft-365/copilot/microsoft-365-copilot-enablement-resources"
      }
    }
  });

  const CONTROL_OVERRIDES = Object.freeze({
    "AFD-LIC-001": {
      path: "Billing > Your products",
      title: "Microsoft 365 Copilot licensing",
      url: "https://learn.microsoft.com/en-us/copilot/microsoft-365/microsoft-365-copilot-licensing"
    },
    "AFD-LIC-002": {
      path: "Billing > Licenses or Microsoft Entra admin center > Billing > Licenses",
      title: "Assign Microsoft 365 licenses to users",
      url: "https://learn.microsoft.com/en-us/microsoft-365/admin/manage/assign-licenses-to-users"
    },
    "AFD-LIC-003": {
      path: "Billing > Licenses > select product > Apps and services",
      title: "Understand Microsoft 365 Copilot licensing and service plans",
      url: "https://learn.microsoft.com/en-us/copilot/microsoft-365/microsoft-365-copilot-licensing"
    },
    "AFD-LIC-004": {
      path: "Billing > Your products > review Copilot-related subscriptions and add-ons",
      title: "Microsoft 365 Copilot licensing",
      url: "https://learn.microsoft.com/en-us/copilot/microsoft-365/microsoft-365-copilot-licensing"
    },
    "AFD-LIC-005": {
      path: "Billing > Your products > select subscription > renewal settings",
      title: "Renew your Microsoft business subscription",
      url: "https://learn.microsoft.com/en-us/microsoft-365/commerce/subscriptions/renew-your-subscription"
    },
    "AFD-IAM-001": {
      path: "Protection > Conditional Access > Policies",
      title: "Require multifactor authentication with Conditional Access",
      url: "https://learn.microsoft.com/en-us/entra/identity/conditional-access/policy-all-users-mfa-strength"
    },
    "AFD-IAM-002": {
      path: "Protection > Conditional Access > Policies",
      title: "Block legacy authentication with Conditional Access",
      url: "https://learn.microsoft.com/en-us/entra/identity/conditional-access/policy-block-legacy-authentication"
    },
    "AFD-IAM-003": {
      path: "Protection > Conditional Access > Policies > review assignments and target resources",
      title: "Microsoft Entra Conditional Access overview",
      url: "https://learn.microsoft.com/en-us/entra/identity/conditional-access/overview"
    },
    "AFD-IAM-004": {
      path: "Protection > Identity Protection > Risk policies",
      title: "Configure and enable risk policies",
      url: "https://learn.microsoft.com/en-us/entra/id-protection/howto-identity-protection-configure-risk-policies"
    },
    "AFD-IAM-005": {
      path: "Identity governance > Access reviews",
      title: "Create an access review of groups and applications",
      url: "https://learn.microsoft.com/en-us/entra/id-governance/create-access-review"
    },
    "AFD-IAM-006": {
      path: "Identity governance > Privileged Identity Management",
      title: "Microsoft Entra Privileged Identity Management",
      url: "https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/"
    },
    "AFD-IAM-007": {
      path: "Identity > Users and Protection > Conditional Access",
      title: "Manage emergency access accounts in Microsoft Entra ID",
      url: "https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/security-emergency-access"
    },
    "AFD-DEV-001": {
      portal: "Microsoft 365 Apps admin center",
      portalUrl: "https://config.office.com/",
      path: "Microsoft 365 Apps admin center > Inventory > Devices and Servicing > Monthly Enterprise",
      title: "Microsoft 365 Copilot requirements",
      url: "https://learn.microsoft.com/en-us/microsoft-365/copilot/microsoft-365-copilot-requirements"
    },
    "AFD-DEV-002": {
      path: "Devices > Compliance policies > Policies",
      title: "Get started with device compliance policies in Intune",
      url: "https://learn.microsoft.com/en-us/intune/intune-service/protect/device-compliance-get-started"
    },
    "AFD-DEV-003": {
      path: "Devices > Windows > Windows updates > Update rings",
      title: "Windows Update rings policy in Intune",
      url: "https://learn.microsoft.com/en-us/intune/intune-service/protect/windows-update-for-business-configure"
    },
    "AFD-DEV-004": {
      path: "Apps > App protection policies and Protection > Conditional Access",
      title: "App protection policies overview",
      url: "https://learn.microsoft.com/en-us/intune/intune-service/apps/app-protection-policy"
    },
    "AFD-DEV-005": {
      path: "Devices > Enrollment and Apps > App protection policies; align with Conditional Access",
      title: "App protection policies overview",
      url: "https://learn.microsoft.com/en-us/intune/intune-service/apps/app-protection-policy"
    },
    "AFD-DEV-006": {
      portal: "Microsoft 365 Apps admin center",
      portalUrl: "https://config.office.com/",
      path: "Microsoft 365 Apps admin center > Customization > Policy Management",
      title: "Overview of Cloud Policy service for Microsoft 365",
      url: "https://learn.microsoft.com/en-us/microsoft-365-apps/admin-center/overview-cloud-policy"
    },
    "AFD-NET-001": {
      path: "Validate Microsoft 365 Optimize endpoints and firewall or proxy bypass",
      title: "Microsoft 365 URLs and IP address ranges",
      url: "https://learn.microsoft.com/en-us/microsoft-365/enterprise/urls-and-ip-address-ranges"
    },
    "AFD-NET-002": {
      path: "Run Teams network tests and validate WebSocket, UDP, and media paths",
      title: "Prepare your organization's network for Microsoft Teams",
      url: "https://learn.microsoft.com/en-us/microsoftteams/prepare-network"
    },
    "AFD-NET-003": {
      path: "Validate client, proxy, inspection appliance, and egress TLS configuration",
      title: "Preparing for TLS 1.2 in Office 365 and Office 365 GCC",
      url: "https://learn.microsoft.com/en-us/purview/prepare-tls-1.2-in-office-365"
    },
    "AFD-NET-004": {
      path: "Run the network connectivity test from each cohort location and review front-door distance and latency",
      title: "Microsoft 365 network connectivity principles",
      url: "https://learn.microsoft.com/en-us/microsoft-365/enterprise/microsoft-365-network-connectivity-principles"
    },
    "AFD-NET-005": {
      path: "Validate Copilot and Microsoft 365 endpoint reachability through DNS, firewall, proxy, and TLS inspection",
      title: "Microsoft 365 URLs and IP address ranges",
      url: "https://learn.microsoft.com/en-us/microsoft-365/enterprise/urls-and-ip-address-ranges"
    },
    "AFD-OPS-001": {
      path: "Health > Service health > Issues for your organization",
      title: "Check Microsoft 365 service health",
      url: "https://learn.microsoft.com/en-us/microsoft-365/enterprise/view-service-health"
    },
    "AFD-OPS-002": {
      path: "Health > Message center > Preferences and Planner sync",
      title: "Track new and changed features in the Microsoft 365 Message center",
      url: "https://learn.microsoft.com/en-us/microsoft-365/admin/manage/message-center"
    },
    "AFD-OPS-003": {
      path: "Health > Service health and Health > Dashboard",
      title: "Check Microsoft 365 service health",
      url: "https://learn.microsoft.com/en-us/microsoft-365/enterprise/view-service-health"
    },
    "AFD-OPS-004": {
      path: "Health > Message center > filter for Copilot and affected workloads",
      title: "Track new and changed features in the Microsoft 365 Message center",
      url: "https://learn.microsoft.com/en-us/microsoft-365/admin/manage/message-center"
    },
    "AFD-OPS-005": {
      path: "Support > Help & support and the organization's Copilot operations register",
      title: "Get support for Microsoft 365 for business",
      url: "https://learn.microsoft.com/en-us/microsoft-365/admin/get-help-support"
    },
    "AFD-EXO-001": {
      path: "Recipients > Mailboxes > verify Recipient type details for every cohort user",
      title: "Microsoft 365 Copilot minimum requirements",
      url: "https://learn.microsoft.com/en-us/microsoft-365/copilot/microsoft-365-copilot-minimum-requirements"
    },
    "AFD-EXO-002": {
      path: "Exchange admin center > Hybrid and Mail flow",
      title: "Microsoft Hybrid Agent and Hybrid Configuration Wizard",
      url: "https://learn.microsoft.com/en-us/exchange/hybrid-deployment/hybrid-agent"
    },
    "AFD-EXO-003": {
      path: "Recipients > Mailboxes > Delegation",
      title: "Manage permissions for recipients in Exchange Online",
      url: "https://learn.microsoft.com/en-us/exchange/recipients-in-exchange-online/manage-permissions-for-recipients"
    },
    "AFD-EXO-004": {
      portal: "Microsoft 365 Apps admin center and Exchange admin center",
      portalUrl: "https://config.office.com/",
      path: "Microsoft 365 Apps admin center > Inventory and Exchange admin center > Shared mailboxes",
      title: "Microsoft 365 Copilot requirements",
      url: "https://learn.microsoft.com/en-us/microsoft-365/copilot/microsoft-365-copilot-requirements"
    },
    "AFD-EXO-005": {
      path: "Mail flow > Rules and Connectors",
      title: "Mail flow rules in Exchange Online",
      url: "https://learn.microsoft.com/en-us/exchange/security-and-compliance/mail-flow-rules/mail-flow-rules"
    },
    "AFD-TEAMS-001": {
      path: "Meetings > Meeting policies > Recording & transcription",
      title: "Configure transcription and captions for Teams meetings",
      url: "https://learn.microsoft.com/en-us/microsoftteams/meeting-transcription-captions"
    },
    "AFD-TEAMS-002": {
      path: "Meetings > Meeting policies and Microsoft Purview retention",
      title: "Teams meeting recording",
      url: "https://learn.microsoft.com/en-us/microsoftteams/meeting-recording"
    },
    "AFD-TEAMS-003": {
      path: "Teams > Manage teams > export and review standard, shared, and private channel ownership",
      title: "Overview of teams and channels in Microsoft Teams",
      url: "https://learn.microsoft.com/en-us/microsoftteams/teams-channels-overview"
    },
    "AFD-TEAMS-004": {
      path: "Users > External access and Users > Guest access",
      title: "Manage external access in Microsoft Teams",
      url: "https://learn.microsoft.com/en-us/microsoftteams/manage-external-access"
    },
    "AFD-TEAMS-005": {
      path: "Users > Manage users > select cohort user > Policies > Meeting policy",
      title: "Manage Microsoft 365 Copilot in Teams meetings and events",
      url: "https://learn.microsoft.com/en-us/microsoftteams/copilot-teams-transcription"
    },
    "AFD-TEAMS-006": {
      path: "Teams apps > Permission policies and Setup policies",
      title: "Manage app permission policies in Microsoft Teams",
      url: "https://learn.microsoft.com/en-us/microsoftteams/teams-app-permission-policies"
    },
    "AFD-SPO-001": {
      path: "Policies > Sharing",
      title: "Turn external sharing on or off for SharePoint and OneDrive",
      url: "https://learn.microsoft.com/en-us/sharepoint/turn-external-sharing-on-or-off"
    },
    "AFD-SPO-002": {
      path: "Active sites > select site > Settings and Membership",
      title: "Change the external sharing setting for a site",
      url: "https://learn.microsoft.com/en-us/sharepoint/change-external-sharing-site"
    },
    "AFD-SPO-003": {
      path: "Reports > Data access governance",
      title: "Data access governance reports for SharePoint",
      url: "https://learn.microsoft.com/en-us/sharepoint/data-access-governance-reports"
    },
    "AFD-SPO-004": {
      path: "Active sites > select site > Settings > Restricted content discovery",
      title: "Restricted content discovery for SharePoint sites",
      url: "https://learn.microsoft.com/en-us/sharepoint/restricted-content-discovery"
    },
    "AFD-SPO-005": {
      path: "Settings > Restricted SharePoint Search",
      title: "Restricted SharePoint Search",
      url: "https://learn.microsoft.com/en-us/sharepoint/restricted-sharepoint-search"
    },
    "AFD-SPO-006": {
      path: "Reports > Data access governance and Active sites > site lifecycle review",
      title: "Data access governance reports for SharePoint",
      url: "https://learn.microsoft.com/en-us/sharepoint/data-access-governance-reports"
    },
    "AFD-SPO-007": {
      path: "Settings > OneDrive sharing and Policies > Sharing",
      title: "Turn external sharing on or off for SharePoint and OneDrive",
      url: "https://learn.microsoft.com/en-us/sharepoint/turn-external-sharing-on-or-off"
    },
    "AFD-PURV-001": {
      path: "Solutions > Information Protection > Sensitivity labels",
      title: "Create and publish sensitivity labels",
      url: "https://learn.microsoft.com/en-us/purview/create-sensitivity-labels"
    },
    "AFD-PURV-002": {
      path: "Solutions > Information Protection > Auto-labeling",
      title: "Apply a sensitivity label to content automatically",
      url: "https://learn.microsoft.com/en-us/purview/apply-sensitivity-label-automatically"
    },
    "AFD-PURV-003": {
      path: "Solutions > Data Loss Prevention > Policies",
      title: "Data Loss Prevention for Microsoft 365 Copilot",
      url: "https://learn.microsoft.com/en-us/purview/dlp-microsoft365-copilot-location-learn-about"
    },
    "AFD-PURV-004": {
      path: "Solutions > Audit",
      title: "Learn about auditing solutions in Microsoft Purview",
      url: "https://learn.microsoft.com/en-us/purview/audit-solutions-overview"
    },
    "AFD-PURV-005": {
      path: "Solutions > Data Lifecycle Management and Records Management",
      title: "Learn about retention policies and retention labels",
      url: "https://learn.microsoft.com/en-us/purview/retention"
    },
    "AFD-PURV-006": {
      path: "Solutions > eDiscovery",
      title: "Get started with Microsoft Purview eDiscovery",
      url: "https://learn.microsoft.com/en-us/purview/edisc-get-started"
    },
    "AFD-PURV-007": {
      path: "Solutions > Insider Risk Management and Communication Compliance",
      title: "Learn about insider risk management",
      url: "https://learn.microsoft.com/en-us/purview/insider-risk-management"
    },
    "AFD-SEC-001": {
      path: "Secure Score",
      title: "Microsoft Secure Score",
      url: "https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score"
    },
    "AFD-SEC-002": {
      path: "Email & collaboration > Policies & rules > Threat policies",
      title: "Preset security policies in Exchange Online Protection and Defender for Office 365",
      url: "https://learn.microsoft.com/en-us/defender-office-365/preset-security-policies"
    },
    "AFD-SEC-003": {
      path: "System > Settings > Cloud Apps",
      title: "Microsoft Defender for Cloud Apps overview",
      url: "https://learn.microsoft.com/en-us/defender-cloud-apps/what-is-defender-for-cloud-apps"
    },
    "AFD-SEC-004": {
      path: "Incidents & alerts > Incidents",
      title: "Incident response with Microsoft Defender XDR",
      url: "https://learn.microsoft.com/en-us/defender-xdr/incident-response-overview"
    },
    "AFD-SEC-005": {
      path: "Endpoints > Vulnerability management",
      title: "Microsoft Defender Vulnerability Management overview",
      url: "https://learn.microsoft.com/en-us/defender-vulnerability-management/defender-vulnerability-management"
    },
    "AFD-SEC-006": {
      path: "System > Settings > Cloud Apps > Conditional Access App Control and Incidents & alerts",
      title: "Security and governance for Microsoft 365 Copilot",
      url: "https://learn.microsoft.com/en-us/microsoft-365/copilot/copilot-control-system/security-governance"
    },
    "AFD-COPILOT-001": {
      path: "Copilot > Settings > review every available tenant experience setting",
      title: "Microsoft 365 Copilot page in the admin center",
      url: "https://learn.microsoft.com/en-us/copilot/microsoft-365/microsoft-365-copilot-page"
    },
    "AFD-COPILOT-002": {
      path: "Copilot > Settings > Data access > Web content",
      title: "Manage web search in Microsoft 365 Copilot",
      url: "https://learn.microsoft.com/en-us/copilot/microsoft-365/manage-public-web-access"
    },
    "AFD-COPILOT-003": {
      path: "Settings > Search & intelligence > Data sources",
      title: "Microsoft 365 Copilot connectors overview",
      url: "https://learn.microsoft.com/en-us/microsoftsearch/connectors-overview"
    },
    "AFD-COPILOT-004": {
      path: "Copilot > Agents and Settings > Integrated apps > review plugins, agents, and message extensions",
      title: "Microsoft 365 Copilot page in the admin center",
      url: "https://learn.microsoft.com/en-us/copilot/microsoft-365/microsoft-365-copilot-page"
    },
    "AFD-COPILOT-005": {
      portal: "Microsoft 365 Apps admin center",
      portalUrl: "https://config.office.com/",
      path: "Microsoft 365 Apps admin center > Customization > Policy Management",
      title: "Overview of Cloud Policy service for Microsoft 365",
      url: "https://learn.microsoft.com/en-us/microsoft-365-apps/admin-center/overview-cloud-policy"
    },
    "AFD-COPILOT-006": {
      path: "Copilot > Settings > Feedback and diagnostics; record the approved privacy decision",
      title: "Microsoft 365 Copilot page in the admin center",
      url: "https://learn.microsoft.com/en-us/copilot/microsoft-365/microsoft-365-copilot-page"
    },
    "AFD-PPA-001": {
      path: "Policies > Data policies",
      title: "Data policies in Power Platform",
      url: "https://learn.microsoft.com/en-us/power-platform/admin/wp-data-loss-prevention"
    },
    "AFD-PPA-002": {
      path: "Environments",
      title: "Power Platform environment strategy",
      url: "https://learn.microsoft.com/en-us/power-platform/guidance/adoption/environment-strategy"
    },
    "AFD-PPA-003": {
      path: "Copilot Studio > Agents > export inventory and review owner, environment, publication, and channel",
      title: "Security and governance in Microsoft Copilot Studio",
      url: "https://learn.microsoft.com/en-us/microsoft-copilot-studio/security-and-governance"
    },
    "AFD-PPA-004": {
      path: "Copilot Studio > agent > Settings > Security and Connections",
      title: "Configure user authentication in Copilot Studio",
      url: "https://learn.microsoft.com/en-us/microsoft-copilot-studio/configuration-end-user-authentication"
    },
    "AFD-PPA-005": {
      path: "Copilot Studio > select agent > Knowledge and Tools > review every source, connector, and action",
      title: "Security and governance in Microsoft Copilot Studio",
      url: "https://learn.microsoft.com/en-us/microsoft-copilot-studio/security-and-governance"
    },
    "AFD-PPA-006": {
      path: "Copilot Studio > agent > Publish and Channels",
      title: "Publish and deploy a Copilot Studio agent",
      url: "https://learn.microsoft.com/en-us/microsoft-copilot-studio/publication-fundamentals-publish-channels"
    },
    "AFD-ADOPT-001": {
      portal: "Organization's Copilot governance workspace",
      portalUrl: "https://learn.microsoft.com/en-us/microsoft-365/copilot/microsoft-365-copilot-enablement-resources",
      path: "Copilot program use-case register > document scenario, owner, users, data, risk, and success measure",
      title: "Microsoft 365 Copilot enablement resources",
      url: "https://learn.microsoft.com/en-us/microsoft-365/copilot/microsoft-365-copilot-enablement-resources"
    },
    "AFD-ADOPT-002": {
      portal: "Organization's Copilot governance workspace",
      portalUrl: "https://learn.microsoft.com/en-us/microsoft-365/copilot/microsoft-365-copilot-enablement-resources",
      path: "Microsoft Entra groups and the Copilot cohort register > reconcile named membership and owner approval",
      title: "Microsoft 365 Copilot enablement resources",
      url: "https://learn.microsoft.com/en-us/microsoft-365/copilot/microsoft-365-copilot-enablement-resources"
    },
    "AFD-ADOPT-003": {
      portal: "Organization's Copilot adoption and support workspace",
      portalUrl: "https://adoption.microsoft.com/en-us/copilot/",
      path: "Adoption plan and internal support channels",
      title: "Microsoft 365 Copilot adoption resources",
      url: "https://adoption.microsoft.com/en-us/copilot/"
    },
    "AFD-ADOPT-004": {
      portal: "Organization's Responsible AI governance workspace",
      portalUrl: "https://learn.microsoft.com/en-us/microsoft-365/copilot/microsoft-365-copilot-enablement-resources",
      path: "Responsible AI review record > document intended use, prohibited use, human oversight, risk owner, and approval",
      title: "Microsoft 365 Copilot enablement resources",
      url: "https://learn.microsoft.com/en-us/microsoft-365/copilot/microsoft-365-copilot-enablement-resources"
    },
    "AFD-ADOPT-005": {
      portal: "Microsoft Copilot Dashboard",
      portalUrl: "https://insights.cloud.microsoft/",
      path: "Reports > Usage or Viva Insights > Copilot Dashboard",
      title: "Microsoft Copilot Dashboard",
      url: "https://learn.microsoft.com/en-us/viva/insights/org-team-insights/copilot-dashboard"
    },
    "AFD-ADOPT-006": {
      portal: "Organization's Copilot governance workspace",
      portalUrl: "https://learn.microsoft.com/en-us/microsoft-365/copilot/microsoft-365-copilot-enablement-resources",
      path: "Copilot governance cadence > schedule evidence refresh, expansion review, risk review, and rollback decisions",
      title: "Microsoft 365 Copilot enablement resources",
      url: "https://learn.microsoft.com/en-us/microsoft-365/copilot/microsoft-365-copilot-enablement-resources"
    }
  });

  function hasConclusiveCoverage(result) {
    const coverage = result?.coverage;
    return coverage?.complete === true &&
      Number.isInteger(coverage.population) &&
      Number.isInteger(coverage.evaluated) &&
      coverage.population >= 0 &&
      coverage.evaluated >= 0 &&
      coverage.evaluated <= coverage.population;
  }

  function hasCurrentFreshness(result, control, now) {
    if (!result?.observedAt || Number.isNaN(Date.parse(result.observedAt)) ||
        !result.freshUntil || Number.isNaN(Date.parse(result.freshUntil))) {
      return false;
    }
    const observedAt = Date.parse(result.observedAt);
    const freshUntil = Date.parse(result.freshUntil);
    const clockSkewMs = 5 * 60 * 1000;
    const maximumFreshnessMs = Number(control?.freshnessHours) * 60 * 60 * 1000;
    return observedAt <= now.getTime() + clockSkewMs &&
      freshUntil > now.getTime() &&
      freshUntil > observedAt &&
      (!Number.isFinite(maximumFreshnessMs) ||
       freshUntil <= observedAt + maximumFreshnessMs + clockSkewMs);
  }

  function isSatisfied(result, now = new Date(), control = null) {
    if (!result) return false;
    if (!hasConclusiveCoverage(result) || !hasCurrentFreshness(result, control, now)) {
      return false;
    }
    if (result.status === "Pass") return true;
    return result.status === "NotApplicable" &&
      result.applicability?.applies === false &&
      typeof result.applicability?.approvedBy === "string" &&
      result.applicability.approvedBy.trim() &&
      result.applicability.expiresAt &&
      !Number.isNaN(Date.parse(result.applicability.expiresAt)) &&
      Date.parse(result.applicability.expiresAt) > now.getTime();
  }

  function classify(result, now, control = null) {
    if (isSatisfied(result, now, control)) return "Complete";
    if (!result || result.status === "Unknown") return "Evidence required";
    if (!hasConclusiveCoverage(result) || !hasCurrentFreshness(result, control, now)) {
      return "Evidence required";
    }
    if (result.status === "Fail") return "Action required";
    return "Owner review";
  }

  function controlPlaybook(domain, control, result, now = new Date()) {
    const profile = DOMAIN_PROFILES[domain.id];
    if (!profile) throw new Error(`No enablement profile exists for domain '${domain.id}'.`);
    const override = CONTROL_OVERRIDES[control.id] || {};
    const status = result?.status || "Unknown";
    const category = classify(result, now, control);
    const evidenceSources = control.evidenceSources || [];
    const roles = domain.ownerRoles || [];
    const source = {
      title: override.title || profile.guidance.title,
      url: override.url || profile.guidance.url
    };
    const steps = [
      `Confirm the affected scope and accountable owner. Applicability: ${control.applicability}`,
      category === "Evidence required"
        ? `Connect or obtain the required evidence before making a decision: ${evidenceSources.join(", ")}.`
        : `Review the collected ${status} evidence and affected users or resources before changing configuration.`,
      `Open ${override.portal || profile.portal} (${override.portalUrl || profile.url}) and go to ${override.path || profile.path}.`,
      control.remediation,
      `Validate the result against this acceptance criterion: ${control.passCondition}`,
      `Capture fresh evidence from ${evidenceSources.join(", ")} and rerun AI Flight Deck within ${control.freshnessHours} hours.`
    ];
    return {
      controlId: control.id,
      domainId: domain.id,
      domainName: domain.name,
      title: control.title,
      requirement: control.requirement,
      missions: control.missions,
      status,
      category,
      requiredOutcome: control.passCondition,
      whyItMatters: control.description,
      responsibleRoles: roles,
      portal: override.portal || profile.portal,
      portalUrl: override.portalUrl || profile.url,
      adminPath: override.path || profile.path,
      prerequisites: {
        permissions: control.requiredPermissions || [],
        licenses: control.requiredLicenses || [],
        evidenceSources
      },
      steps,
      validation: {
        acceptanceCriterion: control.passCondition,
        evidenceSources,
        freshnessHours: control.freshnessHours
      },
      sources: [source],
      currentEvidence: result
        ? {
            observedAt: result.observedAt || null,
            freshUntil: result.freshUntil || null,
            limitations: result.limitations || [],
            evidenceRefs: result.evidenceRefs || []
          }
        : null
    };
  }

  function buildTenantPlan({
    catalog,
    controlResults = [],
    tenantName = "Microsoft 365 tenant",
    cohortId = null,
    cohortName = null,
    cohortApproved = false,
    evidenceTrusted = false,
    evidenceGeneratedAt = null,
    evidenceSuperseded = false,
    now = new Date()
  }) {
    if (!catalog || !Array.isArray(catalog.domains)) {
      throw new TypeError("A valid readiness catalogue is required.");
    }
    const targetResults = cohortId
      ? controlResults.filter(result => result.cohortId === cohortId)
      : controlResults.filter(result => !result.cohortId);
    const results = new Map();
    for (const result of targetResults) {
      if (results.has(result.controlId)) {
        throw new Error(`Duplicate result for cohort '${cohortId || "unspecified"}' and control '${result.controlId}'.`);
      }
      results.set(result.controlId, result);
    }
    const controls = catalog.domains.flatMap(domain =>
      domain.controls.map(control => controlPlaybook(domain, control, results.get(control.id), now))
    );
    const complete = controls.filter(control => control.category === "Complete").length;
    const actionRequired = controls.filter(control => control.category === "Action required").length;
    const evidenceRequired = controls.filter(control => control.category === "Evidence required").length;
    const ownerReview = controls.filter(control => control.category === "Owner review").length;
    const gateBlockers = controls.filter(control =>
      control.requirement === "Gate" && control.category !== "Complete"
    );
    const advisoryBlockers = controls.filter(control =>
      control.requirement !== "Gate" && control.category !== "Complete"
    );
    const completeEvidenceSet = targetResults.length === controls.length &&
      controls.every(control => control.category === "Complete");
    let recommendation = "READY";
    let reason = "Every catalog control has current conclusive evidence.";
    if (gateBlockers.length) {
      recommendation = "NO-GO";
      reason = `${gateBlockers.length} mandatory gate control${gateBlockers.length === 1 ? " is" : "s are"} unresolved.`;
    } else if (!evidenceTrusted) {
      recommendation = "NO-GO";
      reason = "The evidence is not sealed and verified by the local AI Flight Deck service.";
    } else if (evidenceSuperseded) {
      recommendation = "NO-GO";
      reason = "A newer bounded verification exists, but it does not contain a complete current estate assessment. Run a new full tenant scan before deciding.";
    } else if (!cohortId) {
      recommendation = "NO-GO";
      reason = "No explicit deployment cohort is bound to this assessment.";
    } else if (!cohortApproved) {
      recommendation = "NO-GO";
      reason = "The selected deployment cohort has not been approved by an accountable owner.";
    } else if (advisoryBlockers.length) {
      recommendation = "GO WITH CONDITIONS";
      reason = `Mandatory gates are satisfied; ${advisoryBlockers.length} advisory control${advisoryBlockers.length === 1 ? " requires" : "s require"} owner-approved treatment.`;
    } else if (!completeEvidenceSet) {
      recommendation = "NO-GO";
      reason = "The assessment does not contain one current result for every catalog control in the selected cohort.";
    }
    return {
      schemaVersion: "1.0",
      planType: "microsoft-365-copilot-tenant-enablement",
      tenantName,
      cohort: {
        id: cohortId,
        name: cohortName || cohortId || "Not selected",
        approved: cohortApproved
      },
      generatedAt: now.toISOString(),
      evidence: {
        trusted: evidenceTrusted,
        generatedAt: evidenceGeneratedAt,
        superseded: evidenceSuperseded
      },
      recommendation,
      reason,
      summary: {
        total: controls.length,
        complete,
        actionRequired,
        evidenceRequired,
        ownerReview,
        gateBlockers: gateBlockers.length,
        advisoryBlockers: advisoryBlockers.length
      },
      controls
    };
  }

  function markdownEscape(value) {
    return String(value ?? "")
      .replace(/[\u0000-\u001F\u007F]/g, " ")
      .replace(/\\/g, "\\\\")
      .replace(/([`*_[\]{}()#+.!|>~-])/g, "\\$1")
      .replace(/\s+/g, " ")
      .trim();
  }

  function tenantPlanMarkdown(plan) {
    const lines = [
      `# Microsoft 365 Copilot tenant enablement plan`,
      "",
      `**Tenant:** ${markdownEscape(plan.tenantName)}`,
      `**Deployment cohort:** ${markdownEscape(plan.cohort.name)} (${markdownEscape(plan.cohort.id || "not selected")})`,
      `**Cohort approval:** ${plan.cohort.approved ? "Approved" : "Not approved"}`,
      `**Generated:** ${plan.generatedAt}`,
      `**Evidence snapshot:** ${plan.evidence.generatedAt || "No tenant evidence loaded"}`,
      `**Evidence integrity:** ${plan.evidence.trusted ? "Locally sealed and verified" : "Unverified"}`,
      `**Recommendation:** ${plan.recommendation}`,
      `**Reason:** ${plan.reason}`,
      "",
      "## Summary",
      "",
      "| Total controls | Complete | Action required | Evidence required | Owner review | Mandatory gate blockers |",
      "|---:|---:|---:|---:|---:|---:|",
      `| ${plan.summary.total} | ${plan.summary.complete} | ${plan.summary.actionRequired} | ${plan.summary.evidenceRequired} | ${plan.summary.ownerReview} | ${plan.summary.gateBlockers} |`,
      "",
      "This plan is decision support, not a Microsoft certification. Tenant changes require normal approval, least privilege, change control, validation, and rollback.",
      ""
    ];
    const domains = [...new Set(plan.controls.map(control => control.domainName))];
    for (const domainName of domains) {
      lines.push(`## ${domainName}`, "");
      for (const control of plan.controls.filter(item => item.domainName === domainName)) {
        lines.push(
          `### ${control.controlId}: ${control.title}`,
          "",
          `- **State:** ${control.category} (${control.status})`,
          `- **Requirement:** ${control.requirement}`,
          `- **Responsible roles:** ${control.responsibleRoles.join(", ") || "Accountable owner required"}`,
          `- **Administration surface:** ${control.portal} — ${control.adminPath}`,
          `- **Required outcome:** ${control.requiredOutcome}`,
          "",
          "**Implementation steps:**",
          ""
        );
        control.steps.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
        lines.push("", "**Authoritative Microsoft source:**", "");
        control.sources.forEach(source => lines.push(`- [${markdownEscape(source.title)}](${source.url})`));
        lines.push("");
      }
    }
    return lines.join("\n");
  }

  const DOMAIN_DOCUMENTATION = Object.freeze(Object.fromEntries(
    Object.entries(DOMAIN_PROFILES).map(([domainId, profile]) => [
      domainId,
      { ...profile.guidance }
    ])
  ));

  return {
    DOMAIN_DOCUMENTATION,
    DOMAIN_PROFILES,
    CONTROL_OVERRIDES,
    hasConclusiveCoverage,
    hasCurrentFreshness,
    isSatisfied,
    classify,
    controlPlaybook,
    buildTenantPlan,
    tenantPlanMarkdown
  };
});
