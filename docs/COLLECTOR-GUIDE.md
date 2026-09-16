# What Flight Deck connects to and what it checks

[README](../README.md) · [How to use each page](VISUAL-TOUR.md) ·
[Which results can support a rollout decision](EVIDENCE-AND-VERIFICATION.md#evidence-authority-and-supported-boundaries) ·
[Collection runtime contracts](COLLECTION-REFERENCE.md)

This guide answers five questions for each topic: **Which Microsoft service
connects? How do I sign in? What does the app read? What can it not check?
What do I need to do?** Technical commands and code links follow the explanations
so administrators and developers can inspect exactly what runs.

The **13 domains are 13 organizing topics**, such as licensing or devices—not
13 separate, fully reliable automated assessments. Several topics use the same
connection. The 77 checks identified by `AFD-*` are this project's requirements,
not Microsoft standard control IDs or a certification.

## Start here: connection flow

1. In Set up, select **Connect and scan tenant**. Here, *tenant* means your
   organization's Microsoft 365 environment. Enter the displayed code on
   Microsoft's sign-in page and review the requested read permissions.
2. The app reads information through **Microsoft Graph**, Microsoft's interface
   for directory and service information. It receives temporary permission to
   read as you, called a *delegated access token*. Your own permissions still
   limit what it can read.
3. The app also starts **four separate Microsoft service connections**: Exchange
   Online, SharePoint Online, Purview and Power Platform. Complete their
   Microsoft sign-in, multifactor authentication and consent prompts. The app
   does **not pass the Graph token to these services**.
4. Choose your pilot users or groups, let the app look up the members, name an
   owner and explicitly approve that saved list. A list of licensed users is
   **not** an automatically approved pilot.
5. Open **What still needs to be checked**. Start with **Decisions for you**,
   then review **Help needed from an administrator**, **Settings to review**
   and **Checks this version cannot perform**.

These categories tell you who needs to do what. Your decisions are choices such
as which users join the pilot. Administrator help means resolving a specific
service-access problem. Settings to review are findings to inspect before making
changes. Checks this version cannot perform require improvements to the app,
not necessarily changes to your Microsoft 365 environment.

For an existing verified scan, **Collect workload evidence** rereads the four
administration services without repeating the SharePoint file-sharing scan.

The app only reads Microsoft 365 information. It saves results and decisions on
your computer and can install required local software. Selecting pilot users,
recording whether you use on-premises Exchange, or deciding whether Copilot
should use public web information does **not** change a Microsoft setting.
Administrators make approved changes outside Flight Deck.

### Authentication and permission legend

| Service or source | How you sign in | What limits access |
|---|---|---|
| Microsoft Graph | Enter Microsoft's device code using the Microsoft Graph Command Line Tools client; local module: `Microsoft.Graph.Authentication` | [These read permissions](PERMISSIONS-AND-SECURITY.md#delegated-permissions-requested-by-the-live-scanner) are requested by `GRAPH_SCOPE_LIST` in [server.js](../server.js). Your account's roles, licences and the availability of each Microsoft interface still matter |
| Exchange Online | Separate Microsoft sign-in using `ExchangeOnlineManagement` (minimum 3.7.2), `Connect-ExchangeOnline -DisableWAM` | Exchange permissions attached to your account. The connection reports the organization and account used |
| SharePoint Online | Separate browser sign-in using `Microsoft.Online.SharePoint.PowerShell`, `Connect-SPOService -Url … -UseSystemBrowser $true` | Connects to the administration address found through Graph. The module must support browser sign-in. It does not report enough identity information for the app to independently confirm the signed-in account and organization |
| Microsoft Purview | Separate compliance-service sign-in using `Connect-IPPSSession -DisableWAM`; another Exchange Online connection reads audit records later | Compliance roles and licences. The later audit connection must report the same account and organization as the compliance connection |
| Power Platform and Dataverse | Browser sign-in using `Microsoft.PowerApps.Administration.PowerShell` 2.0.216, `Add-PowerAppsAccount -UseSystemBrowser $true` | Your accessible environments and Dataverse permissions. The app checks that each temporary access token belongs to the expected service, organization and account |
| Your computer's network | No Microsoft 365 sign-in | Tests only the connection from the computer running Flight Deck |
| Statements from an owner | Use the account that produced the verified scan, then complete a supported statement for the approved pilot users | The app checks required information and detects local edits. It does not independently establish that the person is authorized by your organization to approve rollout |

**The planned permission list is not what the sign-in requests.**
[collector-definitions.js](../collector-definitions.js) and related code list
suggested roles, permissions, licences and service addresses. Labels such as
`localDelegated` and `productionApplication` do not mean every proposed connection
has been built. In particular, `Sites.FullControl.All` and `Exchange.ManageAsApp`
appear in those plans but are **not requested by the local Graph sign-in**.
The app does not call the Graph site-permissions interface requiring the former.
Exchange uses its separate interactive sign-in, not the latter application-only
permission.

Microsoft's administration tools may request broader consent than the read
commands Flight Deck executes. Global Reader, SharePoint Administrator or
Compliance Administrator are not universal permission recipes: none guarantees
that every operation works. Inspect the actual error, account permissions,
licences and installed software support rather than granting every suggested
permission. Microsoft calls individual Graph permissions *scopes*.

### What happens behind the sign-in windows

- The four administration scripts use **native Windows PowerShell 5.1** and its
  module search paths, independently of the PowerShell host used for Graph.
  Each service has a **15-minute deadline and 12 MB output limit**. A failure
  in one service does not prevent attempts to read the others.
- The administrator script saves **31 separately named command results**:
  11 Exchange, including Security's three mail-protection reads; 7 SharePoint;
  and 13 Purview. These are not 31 independently verified readiness checks.
  The output file format is version **1.0.0**, and the script is version **1.1.0**.
- Before accepting a result file, the app checks its collection identifier,
  expected organization, supported script version, age and protection against
  local changes. A failed current attempt cannot silently reuse earlier success.
- Rows returned with warnings are saved separately as `observations`. A
  successful read with no results is different from a denied or failed read.
  Returning rows does not mean those rows can support a rollout decision.
- SharePoint's administration address must match the target found through Graph.
  However, its module does not report the signed-in identity: the output retains
  `observedTenantId: null`, `actorId: null`, `tenantVerified: false`. The app does
  not invent a common account across services. Other Microsoft clouds and
  SharePoint geographies are not automatically discovered.

Implementation: [service launcher](../workload-collection.js),
[result readers](../collector-adapters.js),
[administrator script](../scanner/collect-admin-evidence.ps1),
[Power Platform script](../scanner/collect-power-platform-evidence.ps1).

## At a glance: all 13 domains

Permissions below are examples from the **actual Graph sign-in request**, not
a promise that your account can read everything. Suggested administrator roles
are guidance, not universally sufficient grants. Each topic links to its limits
and next steps.

| Topic | Microsoft connection used | Relevant permission or suggested owner | What is read; what is not confirmed |
|---|---|---|---|
| [Licensing](#licensing) | Graph | `Organization.Read.All`, `User.Read.All`; License Administrator | Subscriptions and user licence assignments; three licensing checks can support a decision |
| [Identity](#identity) | Graph; owner statement | `Policy.Read.All`, `AuditLog.Read.All`, `AccessReview.Read.All`, role/authentication/risk read permissions; Global Reader | Sign-in policies, registrations, risk and roles; not complete protection of every pilot user |
| [Devices](#devices) | Graph; owner statement | Four `DeviceManagement*.Read.All` permissions, `Application.Read.All`, `Policy.Read.All`; Intune Administrator | Devices, apps and policies; not proof that every pilot device receives the intended settings |
| [Network](#network) | Tests from this computer | Approved network operator; no Graph permission needed | Address lookup, secure connections and response times; not every employee's network |
| [Service health](#servicehealth) | Graph; owner statements | `ServiceHealth.Read.All`, `ServiceMessage.Read.All`; Service Support Administrator | Service issues and messages; not proof that someone reviewed or acted on them |
| [Exchange](#exchange) | Graph and Exchange Online | Directory/device reads plus Exchange permissions; Exchange Administrator | Mailboxes, permissions and mail-flow settings; not on-premises hybrid configuration |
| [Teams](#teams) | Graph | `Group.Read.All`, `Team.ReadBasic.All`, `Channel.ReadBasic.All`, `AppCatalog.Read.All`; Teams Administrator | Teams, channels, owners and apps; not a complete check of assigned Teams policies |
| [SharePoint and OneDrive](#sharepointonedrive) | Graph and SharePoint administration | `Sites.Read.All`, `SharePointTenantSettings.Read.All`; SharePoint Administrator and applicable advanced-management licences | Sampled top-level items, settings and existing report information; not every file or effective access path |
| [Purview](#purview) | Graph, Purview and an Exchange audit connection | `InformationProtectionPolicy.Read` plus compliance/audit permissions; Compliance Administrator | Labels, data-loss prevention policies and audit samples; not proof that the policies work for all relevant content |
| [Security](#security) | Graph and Exchange Online | Security event/incident/alert and threat-indicator read permissions; Security Reader | Security scores, alerts and mail protection; separate Defender service connections are missing |
| [Copilot settings](#copilotconfiguration) | Graph; owner statement | `ExternalConnection.Read.All`, `AppCatalog.Read.All`, `Application.Read.All`, `OrgSettings-Microsoft365Install.Read.All`; Global Reader | Apps, connected services and installation settings; not complete Copilot settings verification |
| [Power Platform and agents](#powerplatformagents) | Power Platform and Dataverse; owner statement | Power Platform Administrator; permissions and licences for each accessible environment | Apps, flows, connections and bot information; not complete access or business approval |
| [Adoption](#adoption) | Graph; owner statements; optional reports | `Reports.Read.All`; accountable business owners | Usage report attempt and owner statements; not independent proof of adoption or business value |

## What can count as readiness evidence?

Reading a setting and confirming a rollout requirement are different things:

1. **Did the app obtain information?** The service may return records, no records,
   a warning or an error.
2. **What does that information suggest?** The app prepares a proposed check
   result. A proposed `Pass` is not yet a verified conclusion.
3. **Can that result support a rollout decision?** The app must check the source
   facts, the organization and pilot users they describe, their age, and whether
   the conclusion matches the facts.

This last verification is implemented for **four automated checks**:
`AFD-LIC-001`, `AFD-LIC-002`, `AFD-LIC-004`, and the bounded identity baseline
`AFD-IAM-003`. The app also supports **eleven
specific owner statements** with required facts and references.

The other **62 checks cannot become a readiness Pass just because records were
returned**. This version has not implemented the necessary source verification.
Their findings can help an administrator investigate, but signing in again,
granting more permissions, importing a report or signing unrelated text does
not add that missing app feature.

Owner statements confirm what the signer supplied—not that Flight Deck fetched
the referenced documents or independently tested the setting. Protection against
local file edits, implemented with an HMAC signature, does not establish that a
Microsoft setting is correct or that the signer has organizational authority.

For developers, the rules for required evidence are called *contracts*;
checking whether a result can be used is called *admission*.
Source verification is in [evidence-authority.js](../evidence-authority.js), and
the shared decision rule is in [evidence-admissibility.js](../evidence-admissibility.js).
See the [full list of supported checks and required statements](EVIDENCE-AND-VERIFICATION.md#evidence-authority-and-supported-boundaries).

## Domain reference

The technical paths below are Microsoft Graph addresses relative to
`https://graph.microsoft.com`, unless another service is named. A listed request
is implemented, but it may still fail for your account, licence or service version.

### Licensing

**Connects to:** Microsoft Graph using the initial sign-in.

**Reads:** purchased subscriptions, available and consumed licences, service
plans included in those subscriptions, and users' assigned licences.

**Can confirm:** `AFD-LIC-001` compares active Copilot capacity—**prepaid minus
consumed units**—with the explicitly approved pilot users. `AFD-LIC-002` checks
that those users have the enabled `M365_COPILOT_APPS` service plan, and identifies
missing users or licensed users outside the approved list. `AFD-LIC-004` checks
that the subscription/add-on inventory is complete and well formed. A product
name containing “Copilot” or an assigned product licence alone is insufficient.

**Cannot confirm / your next step:** renewal commitments and entitlement to every
downstream feature are not independently checked. Approve the pilot user list,
investigate assignment/capacity findings and resolve incomplete collection.
The other licensing checks cannot yet support a verified Pass.

**Technical reads:** `GET /v1.0/subscribedSkus` and `GET /v1.0/users`, including
`capabilityStatus`, `prepaidUnits`, `consumedUnits`, `servicePlans`,
`assignedLicenses` and `assignedPlans`. Follows subsequent result pages under
a 10,000-request budget; complete enumeration is required, not the first 999 users.
Code: [licensing.js](../collectors/licensing.js),
[source verification](../evidence-authority.js).

### Identity

**Connects to:** Microsoft Graph using the initial sign-in.

**Reads:** Conditional Access and Security Defaults settings, multifactor
authentication registrations, seven days of sign-ins, risky users, administrative
roles and their policies, guests, groups and access-review definitions.

**Supported bounded check:** `AFD-IAM-003` requires a complete policy listing and
an enabled baseline explicitly including every pilot user or All users, All
cloud apps, all client types, MFA AND compliant device, with no exclusions or
extra targeting conditions. No enabled policies is Fail. Other policy shapes
remain Unknown: do not weaken approved policy to fit the checker. This is
configuration evidence, not a sign-in simulation, MFA registration check or
proof of privileged-role activation. The emergency access owner statement
`AFD-IAM-007` is also supported; other identity checks remain unverified.

**Limits:** normally 1,000 items / 20 pages per query. Additional membership reads
visit at most 100 configured integrated groups.

**Technical reads:** `/v1.0/identity/conditionalAccess/policies`,
`/v1.0/policies/identitySecurityDefaultsEnforcementPolicy`;
`/beta/reports/authenticationMethods/userRegistrationDetails`,
`/beta/auditLogs/signIns`, `/beta/identityProtection/riskyUsers`;
`/v1.0/roleManagement/directory/roleAssignments` and
`/v1.0/roleManagement/directory/roleDefinitions`;
`/beta/policies/roleManagementPolicyAssignments` and `/beta/policies/roleManagementPolicies`
with expanded rules; guest-filtered `/v1.0/users`, `/v1.0/groups`,
`/beta/identityGovernance/accessReviews/definitions` and
`/v1.0/groups/{id}/transitiveMembers`.
Code: `collectIdentity` in [graph-domains.js](../collectors/graph-domains.js).

### Devices

**Connects to:** Microsoft Graph, including Intune, using the initial sign-in.

**Reads:** managed devices, compliance and configuration policies, app protection,
enrollment settings, detected apps, Conditional Access and registered applications.

**Cannot confirm / your next step:** listed devices are not necessarily all pilot
devices, and a listed policy is not proof that every intended device receives it.
Ask the device owner to verify assignments and current enrollment. The specific
enrollment/policy statement `AFD-DEV-005` is supported; other device checks cannot
yet support a verified Pass.

**Limits:** 1,000 items / 20 pages per query by default.

**Technical reads:** `/beta/deviceManagement/managedDevices`,
`/beta/deviceManagement/deviceConfigurations`,
`/beta/deviceManagement/deviceCompliancePolicies`,
`/beta/deviceManagement/deviceEnrollmentConfigurations`,
`/beta/deviceManagement/detectedApps`;
`/beta/deviceAppManagement/managedAppPolicies`;
`/v1.0/policies/conditionalAccessPolicies`, `/v1.0/applications`.
Code: `collectDevices` in [graph-domains.js](../collectors/graph-domains.js).

### Network

**Connects from:** the computer running Flight Deck; no tenant sign-in.

**Tests:** whether service names resolve to network addresses, whether secure
connections open, whether web requests return, and how long three requests take.

**Cannot confirm / your next step:** this does not test every office, remote
worker or VPN path. Proxy, WebSocket and Teams media tests are listed in the
plan but **not implemented** by the shipped network reader. Ask the network
owner for representative enterprise testing. No network check can yet support
a verified Pass.

**Technical probes:** DNS lookup, TLS on port 443, HTTPS `HEAD`, and three HTTPS
latency samples for `outlook.office.com`, `sharepoint.com`,
`teams.microsoft.com`, `copilot.microsoft.com` and `graph.microsoft.com`.
The reported percentile is the largest of three samples, not an enterprise
response-time study. Generic `sharepoint.com` does not test every tenant address.
Code: `NETWORK_QUERY_PLAN` in [operational-domains.js](../collectors/operational-domains.js),
`createNetworkProbe` in [collector-adapters.js](../collector-adapters.js).

<a id="servicehealth"></a>
### Service health

**Connects to:** Microsoft Graph using the initial sign-in.

**Reads:** Microsoft service issues and service messages.

**Cannot confirm / your next step:** receiving a message does not prove someone
reviewed it or has an escalation process. Ask the service owner to review current
advisories and contact details. The review statement `AFD-OPS-004` and
technical/executive-contact statement `AFD-OPS-005` are supported; other
service-health checks cannot yet support a verified Pass.

**Technical reads:** `/v1.0/admin/serviceAnnouncement/issues` and
`/v1.0/admin/serviceAnnouncement/messages`;
normally 1,000 items / 20 pages each.
Code: `collectOperations` in [graph-domains.js](../collectors/graph-domains.js).

### Exchange

**Connects to:** Exchange Online with its separate sign-in, plus Graph for users
and detected Outlook apps.

**Reads:** mailboxes, mailbox permissions, organization relationships, remote
domains, transport rules and recent message traces. The same Exchange connection
also reads the three protection policies described under Security.

**Cannot confirm / your next step:** `Get-HybridConfiguration` is an
**on-premises Exchange command**, normally unavailable from this cloud connection.
More cloud permissions cannot supply it. Ask the Exchange owner for on-premises
evidence where relevant; a failed command does not mean hybrid Exchange is absent.
No Exchange check can yet support a verified Pass.

**Limits:** mailbox and permission commands request `-ResultSize Unlimited`,
but the service's time/output caps and result-reader limits still apply.
Message trace is limited to **seven days / 5,000 rows**.

**Technical reads:** `Get-EXOMailbox`, `Get-HybridConfiguration`,
`Get-OrganizationRelationship`, `Get-RemoteDomain`, `Get-EXOMailboxPermission`,
`Get-EXORecipientPermission`, `Get-TransportRule`, `Get-MessageTraceV2`;
Graph `/v1.0/users` and `/beta/deviceManagement/detectedApps` filtered for Outlook.
Code: `exchangePlan` in [governance-domains.js](../collectors/governance-domains.js),
[administrator script](../scanner/collect-admin-evidence.ps1).

### Teams

**Connects to:** Microsoft Graph using the initial sign-in; there is no complete
Teams PowerShell policy-reading connection.

**Reads:** teams, channels, owners, available apps and app settings.

**Cannot confirm / your next step:** this does not establish which meeting,
transcription and app policies apply to every pilot user. Ask the Teams owner to
review those assignments. Additional Graph consent does not build the missing
policy reader. No Teams check can yet support a verified Pass.

**Limits:** normally 1,000 items / 20 pages per query. Channel/owner details visit
at most **200 teams**, with **200 channels / 100 owners per team**.

**Technical reads:** `/v1.0/groups` filtered for Team provisioning,
`/v1.0/teams/{id}/channels`, `/v1.0/groups/{id}/owners`,
`/v1.0/appCatalogs/teamsApps` with definitions, `/beta/teamwork/teamsAppSettings`.
Code: `collectTeams` in [graph-domains.js](../collectors/graph-domains.js).

<a id="sharepointonedrive"></a>
### SharePoint and OneDrive

**Connects to:** Graph and a separate SharePoint administration sign-in. The
administration address must match the organization found through Graph, but the
SharePoint module does not report enough information to verify the signed-in
account or independently confirm the organization.

**Reads:** sites, document libraries, sampled top-level files/folders and sharing
permissions; tenant settings; selected site details; restricted-search settings;
information about existing Data Access Governance reports.

**Cannot confirm / your next step:** it does not read document bodies, every
nested file, all inherited/group access or complete governance reports. It does
not create reports. Site owners must review important resources, actual access
and business need. A broad sharing link is not proof of sensitive content or a
Copilot data leak. No SharePoint check can yet support a verified Pass.

**Limits:**
- The initial Graph scan defaults to **25 sites, 20 libraries/site, 100 top-level
  items/library, 10,000 users, 10,000 groups and 10,000 Graph requests**.
  Check the saved scan configuration for the actual limits.
- SharePoint administration lists at most **1,000 sites per inventory query**.
  It then reads individual site details because list results can omit settings
  or return default values. Those detail reads share a **200-site budget**,
  configurable up to **1,000**, and reuse results across the three logical
  queries. It does not use deprecated `-Detailed`.
- Sites without successful detail reads and rows with warnings remain incomplete
  observations—not proof of their settings. Do not add overlapping query counts
  as though they were distinct sites.
- The screen shows **25 review groups/page and 50 records/detail view**. These
  display limits do not mean the backend can search millions of files.

**Technical Graph reads:** `/v1.0/admin/sharepoint/settings`,
`/v1.0/sites?search=*`, organization/users/groups,
`/v1.0/groups/{id}/sites/root`, `/v1.0/sites/{id}/drives`,
`/v1.0/drives/{id}/root/children`, and
`/v1.0/drives/{id}/items/{id}/permissions` for sampled shared items.
No Graph site-permissions endpoint requiring `Sites.FullControl.All` is called.

**Seven administration results:**
- `Get-SPODataAccessGovernanceInsight`: existing `PermissionsReport / Snapshot`
  information under `siteAccessReport`, and existing
  `EveryoneExceptExternalUsersForItems / RecentActivity` information under
  `dataAccessGovernance`; both target SharePoint, not full report contents.
- `Get-SPOTenantRestrictedSearchMode`, `Get-SPOTenantRestrictedSearchAllowedList`.
- `Get-SPOSite` for `restrictedContent`, `siteLifecycle`, `oneDriveOverrides`
  (the last includes personal sites).

Code: [initial scan](../scanner/scan-tenant.ps1),
`sharePointPlan` in [governance-domains.js](../collectors/governance-domains.js),
[administrator script](../scanner/collect-admin-evidence.ps1).
See also [how the sharing review works](EVIDENCE-AND-VERIFICATION.md#how-the-sharepoint-access-and-sharing-review-works).

### Purview

**Connects to:** Graph and a separate Microsoft Purview compliance sign-in.
After reading policies, the app connects to Exchange Online to read audit records.
That later connection must report the same organization and account.

**Reads:** sensitivity labels, label policies, data-loss prevention policies and
rules, audit configuration, retention settings, compliance cases and holds,
insider-risk policies, communication-review policies and a recent audit sample.

**Cannot confirm / your next step:** a policy listing does not prove enforcement
for all intended content, healthy audit recording or a completed compliance
review. Ask authorized compliance owners for those checks. None of the automated
Purview checks can yet support a verified Pass.

**Limits:** audit reads cover **one day / 5,000 Copilot interaction records**.
A failed audit connection does not discard successfully read compliance policies.
The two auto-label outputs run the same policy command, not an independent
simulation-result collection. Commands such as `Get-Label` and
`Get-AutoSensitivityLabelRule` appear in plans but are not extra reads performed
by the shipped script.

**Thirteen administration results:** `Get-LabelPolicy`;
`Get-AutoSensitivityLabelPolicy` twice (`autoLabelPolicies`, `autoLabelReport`);
`Get-DlpCompliancePolicy`, `Get-DlpComplianceRule`, `Get-AdminAuditLogConfig`,
`Get-RetentionCompliancePolicy`, `Get-ComplianceTag`, `Get-ComplianceCase`,
`Get-CaseHoldPolicy`, `Get-InsiderRiskPolicy`, `Get-SupervisoryReviewPolicyV2`,
`Search-UnifiedAuditLog -RecordType CopilotInteraction`.
Graph reads `/beta/security/informationProtection/sensitivityLabels`.
Code: `purviewPlan` in [governance-domains.js](../collectors/governance-domains.js)
describes requested results; the
[administrator script](../scanner/collect-admin-evidence.ps1) determines actual commands.

### Security

**Connects to:** Graph for security information, plus the existing Exchange
Online sign-in for mail-protection policies.

**Reads:** Secure Score, score recommendations, incidents, alerts, Safe Links,
Safe Attachments and anti-phishing policies.

**Cannot connect / your next step:** Cloud Apps OAuth-app/alert/policy addresses
under `portal.cloudappsecurity.com` and Endpoint machine/vulnerability addresses
under `api.securitycenter.microsoft.com` appear in the plan, but the live reader
**refuses non-Graph hosts with `SERVICE_TOKEN_REQUIRED`**. The app does not have
the separate service tokens needed. More Graph permissions will not fix that.
Ask security owners for the missing service information; completing these
connections and result verification requires app development.

No automated Security check can yet support a verified Pass. Scores and alerts
do not independently prove complete protection or that an issue was fixed.

**Technical reads:** `/v1.0/security/secureScores`,
`/v1.0/security/secureScoreControlProfiles`, `/v1.0/security/incidents`,
`/v1.0/security/alerts_v2`; `Get-SafeLinksPolicy`, `Get-SafeAttachmentPolicy`,
`Get-AntiPhishPolicy`. This reader normally limits collections to **5,000 items /
20 pages**, with **500 requests** per topic.
Code: `securityPlan` in [governance-domains.js](../collectors/governance-domains.js),
`graphRequest` in [collector-adapters.js](../collector-adapters.js).

<a id="copilotconfiguration"></a>
### Copilot settings

**Connects to:** Microsoft Graph using the initial sign-in.

**Reads:** subscriptions, external connections, Teams apps, registered
applications, application identities and Microsoft 365 Apps installation options.

**Cannot confirm / your next step:** finding an app or connected service does not
prove it is approved or safely configured. Ask the owner to inspect actual
feature settings and permissions. The privacy/tenant-setting statement
`AFD-COPILOT-006` is supported; other configuration checks cannot yet support a
verified Pass. A local choice about public web information does not change or
independently verify Microsoft's corresponding setting.

**Technical reads:** `/v1.0/subscribedSkus`, `/v1.0/external/connections`,
`/v1.0/appCatalogs/teamsApps` with definitions, `/v1.0/applications`,
`/v1.0/servicePrincipals`, `/beta/admin/microsoft365Apps/installationOptions`.
Normally **1,000 items / 20 pages** per query.
Code: `collectCopilot` in [graph-domains.js](../collectors/graph-domains.js).

<a id="powerplatformagents"></a>
### Power Platform and agents

**Connects to:** Power Platform using its separate browser sign-in, then
Dataverse for each accessible environment using service-specific access tokens.

**Reads:** environments, data-loss prevention policies, custom connectors, apps,
flows and connections. Where Dataverse is available, it reads bot details,
record owners, explicitly shared access and publication/status information.
App/flow/connection reads do not require a successful Dataverse bot read.

**Cannot confirm / your next step:** custom connectors are not the full standard
connector catalogue. A bot's record owner is not necessarily its accountable
business owner. Explicit shares do not show all role, team or inherited access,
and publication does not mean approval. Ask owners to review missing environments,
actual access, knowledge sources and tools. Only the source/tool-review statement
`AFD-PPA-005` is supported for decision-making.

A missing Dataverse address means availability is unknown, not that a database
does not exist. App/flow definitions, credentials, connection strings and bot
contents are excluded from collection.

**Limits:** **50 environments, 2,000 rows per resource, 500 explicit operations,
20 pages per query**, plus the shared time/output limits. The Microsoft module
does its own paging internally, so 500 operations is **not** a count of all its
HTTP requests. The original file format still contains seven required resources:
environments, DLP policies, connectors, agents, owners, sharing and lifecycle.

**Technical reads:** `Get-AdminPowerAppEnvironment` and exact-environment details
when needed; `Get-AdminDlpPolicy`, `Get-AdminPowerAppConnector`,
`Get-AdminPowerApp`, `Get-AdminFlow`, `Get-AdminPowerAppConnection`.
Dataverse reads `/api/data/v9.2/WhoAmI`,
`EntityDefinitions(LogicalName='bot')/Attributes`, `bots`,
`RetrieveSharedPrincipalsAndAccess`. Addresses and subsequent-page links are
checked; tokens must match the intended service, organization and account.
Code: [launcher](../scanner/collect-power-platform-evidence.ps1),
[PowerPlatform.Evidence.ps1](../scanner/PowerPlatform.Evidence.ps1),
`POWER_PLATFORM_QUERY_PLAN` in [operational-domains.js](../collectors/operational-domains.js).

### Adoption

**Connects to:** Graph for a seven-day Copilot usage report, plus statements
supplied by accountable owners. Microsoft CSV report imports are optional.

**Reads:** attempts to retrieve usage information. Owner statements describe
use cases, pilot users, training/support, acceptance of published use cases and
recent reviews of changes.

**Cannot confirm / your next step:** usage is not proof of business value or
organizational readiness. Reporting delays and concealed identities limit
interpretation. Ask owners for meaningful, current facts and references.
Statements `AFD-ADOPT-001/002/003/004/006` are supported, but are not independent
verification that training or approval happened. `AFD-ADOPT-005` cannot yet
support a verified Pass.

**Technical request:** `/v1.0/reports/getMicrosoft365CopilotUsageUserDetail(period='D7')`
with `$format=application/json`, using `Reports.Read.All`.
Code: `ADOPTION_REPORT_QUERY_PLAN` in [operational-domains.js](../collectors/operational-domains.js),
`createGraphReportsClient` in [collector-adapters.js](../collector-adapters.js).
See [required statement information](EVIDENCE-AND-VERIFICATION.md#evidence-authority-and-supported-boundaries).

## Pilot selection is its own evidence boundary

The app saves an explicitly approved list of pilot users; the code calls this
a *cohort*. It does not automatically approve everyone with a Copilot licence.
You can select **up to 50 users or 10 groups**. For groups, the app reads up to
**1,000 returned member rows / 10 pages across all selected groups**, before
removing duplicate members. An incomplete lookup prevents approval.

Microsoft's group index may lag recent membership changes. The saved list is a
snapshot, not continuous tracking or proof of membership at this instant.
Use the same signed-in account that created the scan when approving and
reevaluating pilot users. An owner name or local signature does not independently
establish organizational approval authority.

Technical reads: `/v1.0/users`, `/v1.0/groups`,
`/v1.0/groups/{id}/transitiveMembers/microsoft.graph.user` with
`ConsistencyLevel: eventual`. Code: [setup-decisions.js](../setup-decisions.js)
and account checks in [server.js](../server.js).

## Microsoft report imports are another source, not a connector launch

- The Microsoft 365 Copilot Readiness CSV helps choose pilot users. Its
  **28-day activity window**, report date, reporting delays and privacy settings
  still apply. Hidden or mixed identities cannot create a named pilot from that
  report.
- The automated-assessment CSV import recognizes **nine exact check names,
  mapped to three Flight Deck checks**: `AFD-PPA-001`, `AFD-SEC-005`,
  `AFD-COPILOT-003`, at source revision
  `f542406ffba2066d943643de8d7a87b755b98cab`. Other names/revisions are kept for
  review, not automatically interpreted. Those three checks still lack the
  verification needed to support a Pass; recognizing a recommendation does not
  prove the issue was resolved.
- Flight Deck **does not launch Microsoft's assessment** or verify all of its
  output. Run that tool separately under its own requirements. An upstream
  `Success` label is not automatically a readiness Pass.

Code: [upstream-evidence.js](../upstream-evidence.js).
Microsoft's tool is MIT-licensed; see [ACKNOWLEDGEMENTS.md](../ACKNOWLEDGEMENTS.md).

## A gap is not always a tenant fault

| What you see | What to do |
|---|---|
| Sign-in or consent denied | Check the intended organization/account and displayed permissions; ask an authorized administrator |
| Role or licence denied | Ask the service owner to check the actual requirement; a suggested administrator role is not a guarantee |
| Unsupported command or Microsoft interface | Check the service and installed module version; broader permissions may not help |
| Private module download/import failed | Retry setup for Graph or application-managed workload collection in a fresh no-profile host. Check approved Gallery access, local write permissions and package management; do not install into redirected Documents |
| Private storage unsafe, or OneDrive DLP notice | Flight Deck requires a local, non-redirected `LOCALAPPDATA` directory outside Documents and OneDrive. Existing blocked files and notices are for your administrator to handle; do not move, delete or unblock them |
| Partial results, warning, size limit or timeout | Inspect what was returned and what was missed; ask for deeper or more representative information |
| `SERVICE_TOKEN_REQUIRED` | This version lacks the separate connection to that service; additional Graph permissions cannot supply it |
| Checks this version cannot perform | Keep the finding for review. The app needs a new connection or verification feature; there may be nothing wrong with your Microsoft settings |

Module downloads use the shared private store
`%LOCALAPPDATA%\AI Flight Deck\PowerShell\Modules`, including dependencies, via
`Save-Module -Path` from the validated official HTTPS PowerShell Gallery.
Graph, Exchange, SharePoint, Purview and Power Platform use this bootstrap;
Power Platform remains pinned to `2.0.216`. Every host initializes its own
process-local dependency paths and explicitly imports the private package.
Redirected Documents modules are not reused. Native machine module paths remain
available for platform dependencies. No global module path, repository trust,
execution policy or OneDrive configuration is changed, and no fallback to
Documents occurs. This does not bypass organizational DLP policy or resolve
notices for files already in OneDrive.
| A supported owner statement is missing | Supply the required facts, dates and references through the statement form; do not claim the app independently verified them |

Synthetic tests and browser exercises show how the implementation behaves.
They do **not** demonstrate a complete real-tenant pilot-to-rollout lifecycle,
complete access checking or measurable savings. A successful collection must
not be used to approve an organization-wide production rollout.
