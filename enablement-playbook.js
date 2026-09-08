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

  const CONTROL_CHECKLISTS = Object.freeze({
    "AFD-LIC-001": ["Compare the approved cohort size with active Copilot subscription capacity and current assignments.", "Record any capacity shortfall; have the License Administrator allocate existing capacity before requesting additional licences."],
    "AFD-LIC-002": ["Compare named pilot members with users assigned the Copilot service plan; list missing and out-of-scope assignments.", "Review group-based licensing errors and reconcile only the approved membership differences."],
    "AFD-LIC-003": ["Open each affected user's licence details and inspect the prerequisite service plans listed by this control.", "Check the licensing group that owns a disabled plan before changing an individual assignment."],
    "AFD-LIC-004": ["List the optional capabilities selected for the rollout and compare their entitlements with the tenant subscription inventory.", "Ask the workload owner to confirm applicability before requesting an add-on or an exception."],
    "AFD-LIC-005": ["Record subscription identifiers, renewal dates and the owner responsible for each in-scope subscription.", "Resolve expiring subscriptions with the Billing Administrator and retain the renewal decision and date."],
    "AFD-IAM-001": ["Inspect enabled Conditional Access policies, cohort assignments and exclusions; registration for MFA alone is not enforcement.", "Evaluate affected pilot accounts against the proposed policy and preserve approved emergency-access arrangements before enforcement."],
    "AFD-IAM-002": ["Identify legacy-client sign-ins and inspect the legacy-authentication policy's state, target users and exclusions.", "Identify application dependencies and their owners before enforcing the blocking policy."],
    "AFD-IAM-003": ["Compare the pilot's users and target applications with the assignments and exclusions of the approved Conditional Access baseline.", "Review effective grant controls for representative pilot accounts, including nested-group assignments."],
    "AFD-IAM-004": ["Inspect the approved sign-in and user-risk thresholds, policy assignments and current risk detections.", "Have the security owner approve treatment of excluded accounts and unresolved detections."],
    "AFD-IAM-005": ["Identify pilot-integrated groups, guest membership, group labels and accountable sponsors.", "Review access-review scope and decisions; record the guest memberships approved for retention or removal."],
    "AFD-IAM-006": ["Compare active privileged role assignments with eligible assignments and the approved emergency-access inventory.", "Review activation approval, authentication requirements and standing-access exceptions with the identity owner."],
    "AFD-IAM-007": ["Record emergency account identifiers, custodians, approved exclusions and recovery procedures without recording credentials.", "Document a recent access exercise and the sign-in alert recipient; submit the dated owner attestation."],
    "AFD-DEV-001": ["Join pilot users to their actual Microsoft 365 Apps installations and record channel, build and observation date.", "Compare each installation with the linked Microsoft requirements; identify devices needing channel or build updates."],
    "AFD-DEV-002": ["List pilot devices and their current compliance states, including pilot users for whom no device evidence exists.", "Open each non-compliant device's reported settings and assign remediation to its device administrator."],
    "AFD-DEV-003": ["Resolve effective update-ring and feature-update assignments to the pilot's Windows devices.", "Identify unsupported builds and assignment exclusions before approving update-ring changes."],
    "AFD-DEV-004": ["Inspect effective app-protection settings and assignments for the mobile apps used by the pilot.", "Check encryption and data-transfer controls explicitly; do not treat the mere existence of an app-protection policy as coverage."],
    "AFD-DEV-005": ["Document allowed personal-device scenarios and the owner-approved access boundary.", "Compare that boundary with effective Conditional Access and enrollment restrictions, then attest to the result."],
    "AFD-DEV-006": ["List permitted add-ins and plugins, their owners, and the pilot groups assigned the client policy.", "Review unmanaged installation controls against the approved allow-list and retain the effective policy export."],
    "AFD-NET-001": ["Run connectivity evidence collection from every representative pilot network location, not just the scanner host.", "Give the network owner the failing destination, DNS result, proxy route and timestamp before changing egress rules."],
    "AFD-NET-002": ["Collect WebSocket and Teams media diagnostics from the pilot locations using the linked Microsoft guidance.", "Record blocked destinations and required protocols; retest the same locations after approved network changes."],
    "AFD-NET-003": ["Record negotiated TLS and certificate validation from pilot locations, including any inspection appliance.", "Review obsolete TLS dependencies before the network owner changes protocol or inspection settings."],
    "AFD-NET-004": ["Measure latency from the affected pilot locations and compare it with the explicitly approved network target.", "Document the existing route and compare an approved local-egress alternative before changing routing."],
    "AFD-NET-005": ["Record DNS, connection and TLS results for the Copilot destinations relevant to the selected features.", "Give the network owner exact failing endpoints and retest them from the same user locations."],
    "AFD-OPS-001": ["Open the incident identifier in Service health and confirm that the affected service and time window apply to the pilot.", "Track Microsoft's incident status and the pilot impact; do not change tenant settings to work around an unrelated advisory."],
    "AFD-OPS-002": ["List relevant Message Center post IDs, action dates and accountable owners.", "Record the action or explicit no-action decision for each overdue post."],
    "AFD-OPS-003": ["Record the Service health review time, relevant warnings and the person responsible for follow-up.", "Link each unresolved pilot-impacting issue to an owner and an incident or support reference."],
    "AFD-OPS-004": ["Review Copilot advisories since the last recorded review and identify changed deployment assumptions.", "Record affected control IDs, decisions and review expiry in the accountable attestation."],
    "AFD-OPS-005": ["Confirm technical and business escalation contacts and their coverage for this pilot.", "Record the last contact review and escalation route; do not include credentials or private contact data in public exports."],
    "AFD-EXO-001": ["Match the approved pilot's user IDs to Exchange mailbox type and cloud residency.", "Have the Exchange owner review unmatched or non-cloud mailboxes before migration or cohort changes."],
    "AFD-EXO-002": ["Collect hybrid configuration, organization relationships and remote-domain evidence.", "Record dated free/busy and mail-flow results for representative hybrid users before deciding whether configuration changes are needed."],
    "AFD-EXO-003": ["List Full Access and recipient delegation grants for the affected mailboxes, including disabled trustees.", "Obtain the mailbox owner's retention or removal decision for each stale delegation."],
    "AFD-EXO-004": ["Map pilot users and shared-mailbox scenarios to actual Outlook clients and supported versions.", "Have the Exchange owner record scenario results and per-user coverage rather than relying only on detected-app totals."],
    "AFD-EXO-005": ["Identify the transport-rule and message-trace records relevant to a reproduced pilot problem.", "Review the matching rule and business purpose before changing it; repeat the same message-flow scenario afterward."],
    "AFD-TEAMS-001": ["Resolve the effective meeting policy for pilot users and inspect the transcription setting.", "Record whether transcription is required for the selected scenario before approving any policy change."],
    "AFD-TEAMS-002": ["Inspect recording policy assignments, recording storage and the applicable retention configuration.", "Have the data owner approve retention treatment before changing recording or retention settings."],
    "AFD-TEAMS-003": ["Reconcile discovered teams, private channels, owners and assigned labels against the pilot's collaboration scope.", "Assign an accountable owner to each ownerless team and review the appropriate label with its data owner."],
    "AFD-TEAMS-004": ["Compare effective external and guest-access settings with the approved collaboration boundary.", "Record required partner access and exceptions before narrowing access."],
    "AFD-TEAMS-005": ["Inspect the effective Copilot meeting setting for each pilot user, including policy-assignment precedence.", "Compare the setting with the approved meeting scenario and retain the policy-assignment evidence."],
    "AFD-TEAMS-006": ["Compare apps available to the pilot with the approved application inventory and owner decisions.", "Resolve effective app governance and assignment settings using current Teams administration guidance before removing access."],
    "AFD-SPO-001": ["Record SharePoint and OneDrive tenant sharing settings and the organization's approved maximum sharing posture.", "Review legitimate external collaboration before approving a tenant-level change."],
    "AFD-SPO-002": ["Select the pilot's relevant sites and record site sharing settings, access-request recipients and business owners.", "Ask each site owner to resolve unintended sharing or missing access-request ownership."],
    "AFD-SPO-003": ["Obtain a dated access-governance report for the selected sites and record its coverage and exclusions.", "Assign an owner and treatment decision to each reported oversharing concern; a sampled result is not full effective access."],
    "AFD-SPO-004": ["List the resources the data owner wants excluded from discovery and identify the supported restriction mechanism.", "Apply only the approved restriction and evaluate discovery separately from the user's underlying permission to open content."],
    "AFD-SPO-005": ["Confirm that Restricted SharePoint Search is part of the approved pilot strategy before changing it.", "Compare enabled state and allowed site identifiers with that strategy; search restriction is not permission removal."],
    "AFD-SPO-006": ["Identify owners and lifecycle decisions for the pilot's in-scope sites.", "Obtain retention and business-owner approval before archiving or removing an inactive site."],
    "AFD-SPO-007": ["Compare OneDrive default link type and permission with the documented sharing posture.", "Identify actual site-level overrides and their owners before narrowing defaults or exceptions."],
    "AFD-PURV-001": ["Inspect label definitions and publication-policy scope for the pilot.", "Have the information-protection owner confirm classification guidance and resolve missing publication assignments."],
    "AFD-PURV-002": ["Inspect auto-labelling policy scope, mode and available simulation results.", "Review matching content and false positives before approving enforcement; policy inventory alone does not prove content coverage."],
    "AFD-PURV-003": ["Inspect DLP rules, workload locations, pilot assignments, mode and exceptions.", "Have the compliance owner review simulation outcomes before promoting a policy to enforcement."],
    "AFD-PURV-004": ["Inspect audit configuration and retrieve dated Copilot activity records for an appropriate activity window.", "Distinguish no observed activity from a collection failure; record the approved retention requirement separately."],
    "AFD-PURV-005": ["Map grounding locations to their applicable retention labels and policies.", "Obtain records-management approval for gaps or conflicts before changing retention."],
    "AFD-PURV-006": ["Have the legal/compliance owner identify the applicable case, hold scope and authorized reviewers.", "Record a dated hold-validation result; do not create legal holds solely because this prototype reports a gap."],
    "AFD-PURV-007": ["Inspect applicable insider-risk and communication-compliance policy scope and alert queues.", "Record alert ownership and treatment using authorized reviewers; policy existence is not proof that alerts are handled."],
    "AFD-SEC-001": ["Compare the observed Secure Score with the organization's approved baseline and identify relevant recommendations.", "Assign recommendation owners rather than treating Microsoft's score as an automatic Copilot launch threshold."],
    "AFD-SEC-002": ["Inspect Safe Links, Safe Attachments and anti-phishing policy settings and effective pilot coverage.", "Review preset versus custom policies and exclusions before approving changes."],
    "AFD-SEC-003": ["Obtain authenticated Defender for Cloud Apps application and alert evidence using its own service connection.", "Assign review decisions to unapproved OAuth applications and outstanding alerts."],
    "AFD-SEC-004": ["Identify unresolved incidents that affect the pilot, their severity, age and owner.", "Follow the incident-response process and record resolution or accepted treatment before reassessing rollout."],
    "AFD-SEC-005": ["Map pilot devices to Defender onboarding and vulnerability evidence.", "Assign owners to missing device coverage and relevant critical vulnerabilities; retain the mitigation evidence."],
    "AFD-SEC-006": ["Inspect unmanaged-access monitoring policies and the associated alert queue.", "Confirm who receives and handles alerts; do not equate an empty or inaccessible queue with healthy monitoring."],
    "AFD-COPILOT-001": ["Record the selected Copilot experiences and the business-approved tenant configuration.", "Compare current settings with that record before approving tenant-wide changes."],
    "AFD-COPILOT-002": ["Record the business and privacy decision on web grounding for the pilot.", "Compare the applicable settings and assignments with the decision and retain owner approval."],
    "AFD-COPILOT-003": ["List external connections, source owners, ingestion health and approved grounding scope.", "Review source permissions and ingestion failures before expanding connector availability."],
    "AFD-COPILOT-004": ["Reconcile plugins and message extensions available to the pilot with the approved inventory.", "Record each integration's owner, approval and review date before removing or retaining it."],
    "AFD-COPILOT-005": ["Inspect the approved Cloud Policy settings and resolve their assignments to pilot users.", "Record effective settings and exclusions, not merely the existence of a policy."],
    "AFD-COPILOT-006": ["Record the feedback/telemetry decision, privacy reference and accountable owner.", "Compare the relevant setting with that decision and submit a dated attestation."],
    "AFD-PPA-001": ["List in-scope environments and effective DLP policies, including connector groups and exclusions.", "Review business dependencies before changing connector classification or policy scope."],
    "AFD-PPA-002": ["Record environment purpose, owner, security group and applicable DLP policy.", "Have the environment owner resolve missing assignments and document intentional exceptions."],
    "AFD-PPA-003": ["Reconcile agent identifiers, environments, owners, business purposes and approval status.", "Obtain an owner decision for every unapproved or ownerless agent before changing availability."],
    "AFD-PPA-004": ["Inspect each agent's authentication mode, connection identity, connectors and effective permissions.", "Have the connection owner remove unintended access; never include credential values in the evidence package."],
    "AFD-PPA-005": ["List each agent's knowledge sources and tools with its approved purpose and access scope.", "Record the data/tool owners' review decisions and expiry in the attestation."],
    "AFD-PPA-006": ["Inspect published agents, available channels, sharing and release approvals.", "Compare the current published version with the approved release and record any required withdrawal through normal change control."],
    "AFD-ADOPT-001": ["Record each priority use case with its owner, target users, intended outcome and success measure.", "Have the program owner approve the register and provide it as structured attestation data."],
    "AFD-ADOPT-002": ["Define pilot group membership, owner, entry criteria and exit criteria.", "Reconcile the register with the actual directory group and record the approved segmentation."],
    "AFD-ADOPT-003": ["Record delivered training, its date, and the support intake, owner and response target.", "Have the adoption owner confirm that support is operating rather than merely planned."],
    "AFD-ADOPT-004": ["Link each published use case to its Responsible AI review, accountable approver and expiry.", "Resolve missing or expired acceptance through the organization's governance process."],
    "AFD-ADOPT-005": ["Collect dated usage evidence and record each business measure's owner, current value, target and measurement date.", "Distinguish measured value from a forecast; submit the measures alongside the report-backed review."],
    "AFD-ADOPT-006": ["Record the most recent expansion review, the drift examined and the decisions taken.", "Assign follow-up owners and a review date; an invitation alone is not evidence that the review happened."]
  });

  // These evaluators have no production input path for the listed dependencies yet.
  const UNCONNECTED_INPUTS = Object.freeze({
    "AFD-LIC-005": "subscription renewal dates and accountable renewal owners",
    "AFD-IAM-005": "the approved set of Copilot-integrated groups",
    "AFD-IAM-006": "the approved emergency-access account identifiers",
    "AFD-DEV-001": "per-user Microsoft 365 Apps channel/build evidence",
    "AFD-DEV-003": "effective device update-policy assignments",
    "AFD-DEV-006": "the effective client plugin allow-list",
    "AFD-NET-002": "WebSocket and Teams media diagnostics from pilot locations",
    "AFD-OPS-002": "Message Center action ownership",
    "AFD-OPS-003": "ownership for active service-health warnings",
    "AFD-EXO-002": "dated hybrid mail-flow and free/busy results",
    "AFD-EXO-003": "mailbox-owner delegation reviews",
    "AFD-EXO-004": "per-user Outlook readiness evidence",
    "AFD-TEAMS-001": "effective meeting transcription policy assignments",
    "AFD-TEAMS-002": "effective recording and retention policy evidence",
    "AFD-TEAMS-004": "effective external and guest-access policy evidence",
    "AFD-TEAMS-005": "effective Copilot meeting policy assignments",
    "AFD-TEAMS-006": "effective Teams application policy evidence",
    "AFD-SPO-001": "the customer-approved maximum sharing posture",
    "AFD-SPO-002": "the approved in-scope site list",
    "AFD-SPO-004": "the data owner's restricted resource list",
    "AFD-SPO-005": "the approved Restricted SharePoint Search allowed-site list",
    "AFD-SPO-006": "the approved grounding-site scope",
    "AFD-SPO-007": "the customer-approved OneDrive default link settings",
    "AFD-PURV-004": "validated audit-retention posture",
    "AFD-PURV-007": "the premium monitoring and alert-review record",
    "AFD-SEC-001": "the customer-approved Secure Score baseline",
    "AFD-SEC-003": "a Defender for Cloud Apps service connection and review context",
    "AFD-SEC-005": "a Defender for Endpoint service connection",
    "AFD-SEC-006": "a Defender for Cloud Apps policy connection",
    "AFD-COPILOT-001": "approved Copilot tenant settings",
    "AFD-COPILOT-002": "the approved web-grounding decision and effective settings",
    "AFD-COPILOT-003": "connector ownership, scope and ingestion-health records",
    "AFD-COPILOT-004": "the approved Copilot plugin inventory",
    "AFD-COPILOT-005": "effective Cloud Policy assignments",
    "AFD-ADOPT-005": "the signed usage/value measurement record (the evaluator exists, but the attestation selector does not expose this partially automated control)"
  });

  function collectionGuidance(domain, control) {
    if (UNCONNECTED_INPUTS[control.id]) {
      return {
        kind: "IntegrationRequired",
        limitation: `The live pipeline does not yet supply ${UNCONNECTED_INPUTS[control.id]}. This can prevent automated completion; permissions or a rescan alone will not supply it.`,
        steps: [
          `Ask the ${domain.ownerRoles[0]} to retain ${UNCONNECTED_INPUTS[control.id]} with tenant, scope and observation date.`,
          `Have the product integrator connect this evidence to ${control.id}. Do not edit the scan JSON or use an unrelated attestation to force a Pass.`
        ]
      };
    }
    if (control.automation === "Attested" || domain.id === "adoptionMeasurementGovernance") {
      return {
        kind: "SignedAttestationRequired",
        limitation: "An attestation records an accountable human statement; it does not turn a policy decision into machine-observed proof.",
        steps: [
          `In Set up, select ${control.id} under Create a locally sealed attestation after loading an approved cohort.`,
          "Provide the statement, structured supporting JSON, reference links and expiry; create the attestation and run a new tenant scan."
        ]
      };
    }
    if (domain.id === "powerPlatformAgents") {
      return {
        kind: "PowerPlatformEvidenceRequired",
        limitation: "This release reads an imported package; it does not authenticate directly to Power Platform. Its template is an evidence format, not an automated collector.",
        steps: [
          "In Set up, prepare a Power Platform collection challenge and download the evidence template.",
          "Have the Power Platform Administrator populate environments, dlpPolicies, connectors, agents, agentOwners, agentSharing and agentLifecycle from authenticated administrative exports; retain source dates, scope and errors.",
          "Use the baseline tenant ID and current challenge, import the package before the challenge expires, then run a new tenant scan. Empty arrays or inferred values do not establish complete coverage."
        ]
      };
    }
    const workloads = { exchangeOnline: "exchangeOnline", sharePointOneDrive: "sharePointOnline", purviewCompliance: "purview", securityPosture: "exchangeOnline" };
    if (workloads[domain.id] && (domain.id !== "securityPosture" || control.id === "AFD-SEC-002")) {
      return {
        kind: "AdminEvidenceRequired",
        limitation: "The package supplements Graph evidence. Raw command output must match the evaluator's required fields; successful import alone does not close the control.",
        steps: [
          `In Set up, prepare an administrator collection challenge and download scanner/collect-admin-evidence.ps1 for workload ${workloads[domain.id]}.`,
          `From the downloaded collector's folder, run: .\\collect-admin-evidence.ps1 -TenantId "<baseline tenant GUID>" -WorkspacePath "<local output folder>" -CollectionChallenge "<current challenge>" -Workloads "${workloads[domain.id]}". Replace each placeholder; add -SharePointAdminUrl "https://<tenant>-admin.sharepoint.com" for SharePoint.`,
          `The required module is ${domain.id === "sharePointOneDrive" ? "Microsoft.Online.SharePoint.PowerShell" : "ExchangeOnlineManagement"}. Install it through your approved PowerShell module process if it is missing.`,
          "Sign in to the intended tenant, retain command errors, import the generated package before the challenge expires, and rerun the tenant scan. Review any remaining evidence limitations."
        ]
      };
    }
    return {
      kind: "LiveCollectionRequired",
      limitation: domain.id === "networkConnectivity"
        ? "Built-in probes represent the scanner host. Proxy, WebSocket, media and other pilot locations are not fully collected by these probes."
        : "Successful authentication or an inventory count alone does not prove effective policy coverage.",
      steps: [
        "In Set up, connect and scan the intended tenant with the listed read permissions and an approved pilot cohort.",
        `Inspect ${control.id} after collection. Retain scope, timestamps and errors; resolve the specific limitation rather than repeatedly rescanning unchanged inputs.`
      ]
    };
  }

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
      url: override.url || profile.guidance.url,
      relationship: "Supporting Microsoft product documentation; not certification of this AI Flight Deck gate or threshold.",
      verification: "Mapped reference; live page currency and support for each policy threshold are not asserted."
    };
    const collection = collectionGuidance(domain, control);
    const checklist = CONTROL_CHECKLISTS[control.id];
    if (!checklist) throw new Error(`No implementation checklist exists for '${control.id}'.`);
    const steps = [
      `Confirm the affected resources and ${roles.join(" / ")} owner before changing configuration; preserve the current settings and agree a rollback or recovery procedure.`,
      `Open ${override.portal || profile.portal} (${override.portalUrl || profile.url}) and go to ${override.path || profile.path}. Review the linked Microsoft guidance for the current administration experience.`,
      ...checklist,
      `Agree the treatment against the AI Flight Deck criterion: ${control.passCondition} Apply only the owner-approved change, or retain evidence of a justified exception.`,
      `Recollect using the evidence instructions below within ${control.freshnessHours} hours. Confirm the affected control's result and remaining limitations before considering the work complete.`
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
      requirementOrigin: "AI Flight Deck rollout policy. Gates, thresholds and applicability require customer approval; they are not automatically Microsoft deployment prerequisites.",
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
      collection,
      affectedScope: {
        resources: [...(result?.affectedResources || [])],
        principals: [...(result?.affectedPrincipals || [])]
      },
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
      .replace(/([`*_[\]{}()#+.!|<>~-])/g, "\\$1")
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
          `- **Requirement origin:** ${control.requirementOrigin}`,
          `- **Affected resources:** ${control.affectedScope.resources.length ? control.affectedScope.resources.map(markdownEscape).join(", ") : "No resource identifiers recorded; establish scope before making changes."}`,
          `- **Affected principals:** ${control.affectedScope.principals.length ? control.affectedScope.principals.map(markdownEscape).join(", ") : "No principal identifiers recorded."}`,
          `- **Read permissions:** ${control.prerequisites.permissions.join(", ") || "None listed"}`,
          `- **Entitlement prerequisites (not a finding of missing licences):** ${control.prerequisites.licenses.join(", ") || "None listed"}`,
          "",
          "**Implementation steps:**",
          ""
        );
        control.steps.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
        lines.push("", "**Evidence collection and completion:**", "");
        control.collection.steps.forEach((step, index) => lines.push(`${index + 1}. ${markdownEscape(step)}`));
        lines.push("", `**Collection boundary:** ${control.collection.limitation}`, "", "**Microsoft guidance reference:**", "");
        control.sources.forEach(source => lines.push(`- [${markdownEscape(source.title)}](${source.url})`));
        lines.push("", control.sources[0].relationship, control.sources[0].verification);
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
    CONTROL_CHECKLISTS,
    collectionGuidance,
    hasConclusiveCoverage,
    hasCurrentFreshness,
    isSatisfied,
    classify,
    controlPlaybook,
    buildTenantPlan,
    tenantPlanMarkdown
  };
});
