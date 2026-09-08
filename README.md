# AI Flight Deck

**Evidence-based Microsoft 365 Copilot estate readiness assessment.**

AI Flight Deck is a hackathon-ready product prototype for assessing the full
customer estate before Microsoft 365 Copilot enablement. Its mission-control
experience organizes evidence across thirteen independently governed systems:
licensing, identity, devices and apps, network connectivity, service health,
Exchange, Teams, SharePoint and OneDrive, Purview, security, Copilot
configuration, Power Platform and agents, and adoption and operational
governance. A missing domain blocks an estate-wide decision instead of being
hidden behind an aggregate score.

The collector suite attempts all 77 controls across all thirteen domains.
Microsoft Graph and local network probes evaluate the directly observable
subset. The Evidence completion center classifies every unresolved control as
a missing permission, missing licence, administrator evidence package, Power
Platform evidence package, signed attestation, expired evidence, or live
recollection requirement. The product never converts missing evidence into a
passing result.

## Microsoft tools used and credited

AI Flight Deck is an independent hackathon prototype. It is not a Microsoft
product, service, or replacement for Microsoft's readiness tooling.

It deliberately builds on evidence produced by these Microsoft resources:

| Microsoft resource | What Microsoft provides | How AI Flight Deck uses it |
|---|---|---|
| [Microsoft 365 Copilot Readiness report](https://learn.microsoft.com/en-us/microsoft-365/admin/activity-reports/microsoft-365-copilot-readiness?view=o365-worldwide) | Microsoft 365 admin-center reporting for licence assignment, eligible app update channel, recent workload usage, and suggested Copilot candidates | Imports the CSV as time-bounded cohort-planning evidence and preserves its privacy, 28-day activity-window, and reporting-latency limitations |
| [Microsoft M365 Copilot automated readiness assessment](https://github.com/microsoft/m365-copilot-automated-readiness-assessment) | Microsoft-authored open-source collection and recommendations across Microsoft 365, Entra, Defender, Purview, Power Platform, Copilot Studio, and Agent 365 | Imports its recommendation CSV, records the source revision, maps only verified exact checks, and stages unrecognized rows instead of guessing |
| [Microsoft Graph](https://learn.microsoft.com/en-us/graph/overview) | Microsoft APIs for tenant, identity, policy, device, service-health, security, collaboration, and reporting data | Performs the live delegated read-only scan |
| [Microsoft Learn](https://learn.microsoft.com/) | Authoritative product documentation and configuration guidance | Links every readiness control and correction back to relevant Microsoft documentation |

Microsoft's open-source readiness assessment is licensed under the MIT
License by its authors. AI Flight Deck currently consumes its exported report;
it does not copy or redistribute the upstream source code. See
[`ACKNOWLEDGEMENTS.md`](ACKNOWLEDGEMENTS.md) for attribution and integration
details.

## What AI Flight Deck adds

Microsoft's tools remain the source for valuable readiness observations. AI
Flight Deck adds the decision and evidence workflow around them:

| AI Flight Deck capability | What it offers |
|---|---|
| Cross-source evidence control tower | Combines Microsoft reports, a live Graph scan, workload evidence, and accountable attestations without hiding their source |
| Named pilot cohort | Converts suggested candidates into an explicitly selected pilot with an accountable owner, then resolves every selected user against Microsoft Entra |
| 13 domains and 77 controls | Normalizes licensing, identity, devices, network, service health, Exchange, Teams, SharePoint/OneDrive, Purview, security, Copilot configuration, Power Platform/agents, and adoption/governance |
| Actionable evidence gaps | Reclassifies unresolved controls as a missing permission, licence, workload package, attestation, or recollection requirement instead of showing bare `Unknown` |
| Evidence completion center | Shows the current mission and the five highest-priority blockers, links each to its expanded control instructions, and distinguishes available collection paths from inputs that still need integration |
| Mission gates | Shows whether activation, safe pilot, scale, and assurance missions can advance and identifies the exact blocking controls |
| Readiness-impact traces | Connects evidence source to control, affected mission, decision impact, and required correction when a full access graph is unavailable |
| SharePoint access and sharing review | Converts public SharePoint sites and sampled Anyone or organization-wide sharing links into named, evidence-backed validation scenarios with bounded audience estimates, explicit limitations, and administrator actions |
| Tenant-wide enablement plan | Produces a `Ready`, `Go with conditions`, or `No-go` recommendation and turns all 77 controls into accountable owners, administration paths, control-specific checklists, acceptance criteria, and supporting Microsoft documentation |
| Evidence-bound corrections | Produces administrator action packages tied to the selected controls and signed baseline rather than claiming that changes were applied |
| Before-and-after proof | Re-scans after remediation and distinguishes verified improvement, no material change, and regression |
| Provenance and freshness | Retains source artifact hashes, report dates, collector identity, evidence limitations, and conflicts between imported and live evidence |
| Detailed exports | Exports the complete control-level assessment and correction context for review outside the application |

In one sentence: **Microsoft tools tell you what they observed; AI Flight Deck
tells you whether a specific pilot can launch, why it cannot, who must act, and
whether the evidence proves the fix worked.**

### Using the control instructions

Select **View exact steps and references** on a Set up blocker to open and
focus that control in the Decision page's plan, including when the previous filter
would have hidden it. Every control includes its affected identifiers (when
recorded), prerequisites, owner, two control-specific inspection/treatment
steps, acceptance criterion, evidence collection instructions, and collection
boundary. The same instructions and policy/source qualifications are included
in the downloadable plan and control CSV.

The 77-control catalogue is **AI Flight Deck rollout policy**, not an official
Microsoft certification or universal prerequisite list. Linked Microsoft pages
are supporting documentation; the application does not assert their live
currency or that they mandate every custom threshold. Entitlement prerequisites
are not displayed as missing licences simply because no complete entitlement
inventory is available. In the completion API, omitted/null `availableLicenses`
means unknown; an explicit array is the caller's complete normalized inventory.

**Evidence integration required** means the production pipeline still lacks an
input used by the evaluator, such as effective Teams policy assignments.
Repeated rescans, additional consent, or an unrelated attestation do not supply
that input. The Power Platform package remains a manually populated export
format, not an authenticated collector. Owner approvals and local package seals
do not prove effective permissions or complete workload coverage.

Administrator packages retain their version 1.0.0 contract. The consumer accepts
command-only entries produced by the shipped script only when the command has
one purpose in that workload's query plan. Exact entries and exact errors take
precedence. Multi-purpose commands such as `Get-SPOSite`,
`Get-SPODataAccessGovernanceInsight` and `Get-AutoSensitivityLabelPolicy` still
require the purpose-specific key. Collection requests now carry the scan tenant
ID into package validation.

## How the SharePoint access and sharing review works

The Assessment page does not treat every sharing signal as confirmed sensitive
data exposure. It separates four questions:

1. **What resource was observed?** A public SharePoint site, sampled file,
   sampled folder, or sharing link.
2. **Why was it selected?** The site is connected to a public Microsoft 365
   group, or the sampled item has an Anyone or organization-wide sharing scope.
3. **Who might be able to use the path?** The product reports a bounded
   potential audience, not a fabricated exact affected-user count.
4. **What must the administrator do?** Confirm ownership and business need,
   inspect permissions and content, restrict unnecessary access, and rescan.

The live review currently produces these evidence-backed scenario types:

| Scenario | What the scan proves | Audience treatment | Required review |
|---|---|---|---|
| Public SharePoint site | Its connected Microsoft 365 group is Public | Up to the enabled member-account population inventoried by the scan | Confirm public visibility, site owners, permissions, sharing links, and content |
| Anyone link on a sampled item | Anonymous link scope exists on the sampled file or folder | Unbounded because recipients are not identifiable | Remove the link unless unauthenticated access is explicitly approved |
| Organization-wide link on a sampled item | Organization link scope exists on the sampled file or folder | Up to the enabled member-account population inventoried by the scan | Replace broad link access with named people or groups when it is unnecessary |
| Specific-people link | A bounded permission detail names the link recipient set | Named principals observed on the permission | Validate recipients, role, expiry, and continued business need |
| Direct user or guest grant | A sampled item permission names user or guest principals | Directly named principals only | Confirm sponsorship and business need; remove stale access |
| Direct group grant | A sampled item permission names a group or SharePoint site group | Group principals are known; nested members are not expanded | Review group ownership and membership before relying on the audience estimate |
| Application or agent grant | A sampled item permission names an application principal | Application principals observed on the permission | Validate workload identity, resource scope, and agent governance |
| Inherited permission | The sampled item reports inheritance from a parent resource | Complete downstream audience is not expanded | Review the parent permission and break or narrow inheritance when necessary |
| Guest identity context | Guest accounts exist in the bounded directory inventory | No resource-level claim is made | Review sponsorship, lifecycle, group membership, and external sharing |
| Collection boundary | Root-level sampling does not recursively inspect every nested item or effective permission | Not calculated | Complete deeper SharePoint governance evidence for priority sites |

**Potential audience is not the same as affected users.** For example, a
public site can create a tenant-wide potential audience, while an Anyone link
has an unbounded audience. An exact affected-user count would require
resource-by-resource effective-permission evaluation, nested group expansion,
guest mapping, inherited permissions, and link-use context. AI Flight Deck
shows the supported upper bound and the missing evidence instead of presenting
an unsupported precise number.

For sampled root items that Microsoft Graph marks as shared, the scanner also
performs a bounded, best-effort permission-detail pass. This can distinguish
specific-people links, direct user, guest, group, application or agent grants,
and inherited permissions. It records roles and expiration when Graph returns
them. It does not recursively enumerate every item or expand nested group
membership.

The scanner reads metadata and permissions only. It does not retrieve document
contents, and therefore does not claim that a flagged resource contains
sensitive information. A scenario identifies a sharing configuration that
requires validation before rollout; it is not proof of a Copilot data leak.

The Decision page also provides a complete customer handoff for tenant-wide
enablement. Customers can filter remaining requirements in the application or
download a Markdown plan covering licensing, Entra ID, devices, network,
service health, Exchange, Teams, SharePoint and OneDrive, Purview, Defender,
Copilot configuration, Power Platform and agents, and adoption governance.
Every control identifies the responsible roles, administration portal and
navigation path, ordered implementation procedure, validation condition, and
relevant authoritative Microsoft documentation.

## See the product before installing

[Open the complete AI Flight Deck visual tour](docs/VISUAL-TOUR.md) to see
all four workflow stages, what each provides, and how evidence moves from
collection to a cohort-specific decision.

[![AI Flight Deck evidence completion center](docs/screenshots/02-setup-evidence-center.png)](docs/VISUAL-TOUR.md)

The screenshots use the built-in synthetic Contoso Aviation demonstration
data. They do not contain tenant data and are intended to show the product
experience before a live scan is connected.

## Install AI Flight Deck on a Windows computer

AI Flight Deck is a local Windows application. It runs a web interface on
`127.0.0.1` and does not require Azure hosting, a database, `npm install`, or a
web-server setup.

### Simplest first-time setup

1. Download the repository ZIP from GitHub.
2. Extract the entire ZIP to a normal local folder.
3. Double-click:

   ```text
   SETUP-AI-Flight-Deck.cmd
   ```

The guided setup checks that all application files are present, checks the
Node.js version, offers to install Node.js LTS through Windows Package Manager
when necessary, installs `Microsoft.Graph.Authentication` for the current
Windows user, checks port `8080`, offers to create a desktop shortcut, and
starts AI Flight Deck.

The setup asks before installing prerequisites. It does not connect to or
change a Microsoft 365 tenant. Tenant sign-in starts only after the user selects
**Connect and scan tenant** inside the application.

### Requirements

Before downloading the repository, confirm that the computer has:

- Windows 10 or Windows 11.
- Permission to run PowerShell.
- Microsoft Edge, Google Chrome, or another current browser.
- Network access to Microsoft sign-in, Microsoft Graph, and Microsoft 365.
- A Microsoft 365 test-tenant account approved to grant or request the
  displayed read-only permissions.

The guided setup can install
[Node.js 18 or later](https://nodejs.org/en/download) when Windows Package
Manager is available. Git is optional and is needed only when installing with
`git clone`.

### Manual fallback: install Node.js

Use this only if the guided setup cannot install Node.js. Download and install
the current Node.js LTS release:

```text
https://nodejs.org/en/download
```

Keep the installer option that adds Node.js to `PATH`. Close and reopen
Command Prompt after installation, then confirm:

```powershell
node --version
```

The command must print version 18 or later. No Node packages need to be
installed for AI Flight Deck.

### Download AI Flight Deck

Choose either method.

#### Option A - Download the ZIP

1. Open
   [sethiramicrosoft/ai-flight-deck](https://github.com/sethiramicrosoft/ai-flight-deck).
2. Sign in to GitHub with an account that has access to the repository.
3. Select **Code**, then **Download ZIP**.
4. Extract the ZIP to a normal local folder, for example:

   ```text
   C:\Tools\ai-flight-deck
   ```

5. Do not run the launcher from inside the compressed ZIP preview.

#### Option B - Clone with Git

Open PowerShell and run:

```powershell
cd C:\Tools
git clone https://github.com/sethiramicrosoft/ai-flight-deck.git
cd .\ai-flight-deck
```

Because the repository is private, GitHub may ask the user to authenticate.

### Start after setup

For later sessions, open the extracted or cloned `ai-flight-deck` folder and
double-click:

```text
Start-AI-Flight-Deck.cmd
```

Alternatively, start it from PowerShell:

```powershell
cd C:\Tools\ai-flight-deck
.\Start-AI-Flight-Deck.cmd
```

The launcher:

1. Checks that `node.exe` is available.
2. Starts the localhost control plane on port `8080`.
3. Opens the following page in the default browser:

   ```text
   http://127.0.0.1:8080/index.html
   ```

Keep the launcher window open while using the application. Closing that window
stops the local service.

### Complete the first live scan

1. On **Set up**, select **Connect and scan tenant**.
2. If required, Flight Deck installs the
   `Microsoft.Graph.Authentication` PowerShell module for the current Windows
   user. PowerShell Gallery may ask whether it can install or trust supporting
   components.
3. The browser opens `https://microsoft.com/devicelogin`.
4. Copy the one-time code displayed in Flight Deck.
5. Enter the code on Microsoft's sign-in page.
6. Sign in with the approved Microsoft 365 tenant account.
7. Review the requested delegated permissions. The scanner requests read-only
   access and does not request tenant write permissions.
8. If tenant-wide admin consent is required, ask an authorized administrator
   to approve the displayed permissions.
9. Return to Flight Deck and leave the launcher window open until the scan
   finishes.
10. Flight Deck opens **Assessment** automatically when the baseline is ready.

The first run may take longer because the Microsoft Graph authentication module
is installed before sign-in.

### Complete evidence the Graph scan cannot collect

The live scan remains the primary authenticated path. Use the **Evidence
completion center** on **Set up** (the first navigation tab) for controls
that cross a separate Microsoft 365 administration boundary.

#### Exchange Online, SharePoint Online, and Purview

Install the required Microsoft administration modules for the current Windows
user:

```powershell
Install-Module ExchangeOnlineManagement -Scope CurrentUser
Install-Module Microsoft.Online.SharePoint.PowerShell -Scope CurrentUser
```

On **Set up**, in the Evidence completion center, select **Create collection
challenge**. Then run the shipped
read-only producer with the tenant ID shown by the live scan, the one-time
challenge, and the tenant's SharePoint administration URL:

```powershell
.\scanner\collect-admin-evidence.ps1 `
  -TenantId "<tenant-guid>" `
  -WorkspacePath "$env:LOCALAPPDATA\AI Flight Deck\live-test" `
  -CollectionChallenge "<one-time-challenge>" `
  -SharePointAdminUrl "https://<tenant>-admin.sharepoint.com"
```

The challenge is valid for 30 minutes and can be used once. The producer opens
the workload sign-in experiences, executes the bounded read commands used by
Flight Deck, records command-level failures, and writes
`admin-evidence.<timestamp>.json`. Import that file in the Evidence completion
center. The local service validates its producer identity, one-time challenge,
schema, verified-baseline tenant, object shape, and 24-hour freshness, then
seals it before the next scan can consume it.

If an individual administration command fails, the producer continues with the
remaining commands and records the exact failure in the package's `errors`
map. Importing a partially collected package is supported: affected controls
remain evidence gaps with the command failure, while independently collected
controls can still be evaluated.

#### Power Platform and Copilot Studio

Download
[`schema/power-platform-evidence.template.v1.json`](schema/power-platform-evidence.template.v1.json),
select **Create collection challenge** for Power Platform, then replace the
challenge, tenant, actor, timestamp, and seven evidence arrays with current
authenticated exports before importing it. The
required arrays are environments, DLP policies, connectors, agents, agent
owners, sharing, and lifecycle. Cross-tenant, stale, malformed, or unsealed
packages are rejected.

#### Accountable governance attestations

For controls whose catalogue automation class is `Attested`, load a locally
verified baseline for an explicitly approved cohort, then complete the
attestation form in the Evidence completion center. Flight Deck:

1. Restricts attestations to controls explicitly marked `Attested`.
2. Derives the attester from the verified scan actor and binds the statement
   to that identity, the verified tenant, approved cohort, control, supporting
   data, and evidence references. A different attester must authenticate and
   produce the verified scan used for the statement.
3. Caps expiry to the control's catalogue freshness window.
4. Seals the record with the local workspace integrity key.
5. Verifies the signature during the next scan before the record can affect a
   control result.

`NotApplicable` attestations additionally require a named approver, reason, and
future expiry. Missing expiry or incomplete control coverage cannot satisfy a
mission gate.

## Permissions required

There are two different permission sets: permissions on the Windows computer
and permissions in the Microsoft 365 tenant.

### Windows computer permissions

The person installing the prototype needs permission to:

- Extract files to a local folder.
- Run `.cmd` and PowerShell scripts.
- Install Node.js if it is not already present. Windows may display an
  elevation prompt depending on the device policy and Node.js installer.
- Install the `Microsoft.Graph.Authentication` module with
  `-Scope CurrentUser`. This normally does not require local administrator
  rights.
- Open a localhost listener on `127.0.0.1:8080`.
- Create a desktop shortcut if that option is selected.

If software installation, PowerShell Gallery, Windows Package Manager, or
script execution is controlled by the organization, IT must approve or perform
those prerequisite steps.

### Microsoft 365 account requirements

Use a dedicated test-tenant assessment account where possible. The account
must:

- Be a member of the Microsoft 365 tenant being assessed.
- Be allowed to complete Microsoft device-code sign-in.
- Be allowed to request or use the delegated Microsoft Graph permissions below.
- Have sufficient directory or workload roles to read the requested data.
- Have access to the licensed services being assessed.

The application uses the Microsoft Graph Command Line Tools client for
interactive delegated authentication. It does not ask the user to create an app
registration for the local prototype.

An administrator may need to grant consent before the account can use
organization-wide delegated permissions. Consent allows the application to
request a scope; the signed-in user's own role and service access still limit
what the scan can read.

### Delegated permissions requested by the live scanner

The localhost scanner currently requests these exact Microsoft Graph delegated
scopes from `server.js`:

| Evidence area | Requested delegated scopes |
|---|---|
| Sign-in session | `openid`, `profile`, `offline_access` |
| Tenant and directory inventory | `Organization.Read.All`, `Directory.Read.All`, `User.Read.All`, `Group.Read.All`, `Application.Read.All` |
| Identity governance and access | `AccessReview.Read.All`, `AuditLog.Read.All`, `Policy.Read.All`, `IdentityRiskyUser.Read.All`, `RoleManagement.Read.Directory`, `UserAuthenticationMethod.Read.All` |
| Devices and Microsoft 365 Apps | `DeviceManagementApps.Read.All`, `DeviceManagementConfiguration.Read.All`, `DeviceManagementManagedDevices.Read.All`, `DeviceManagementServiceConfig.Read.All`, `OrgSettings-Microsoft365Install.Read.All` |
| Service health and operations | `ServiceHealth.Read.All`, `ServiceMessage.Read.All` |
| Teams, apps, and collaboration inventory | `Team.ReadBasic.All`, `Channel.ReadBasic.All`, `AppCatalog.Read.All` |
| SharePoint, OneDrive, Search, and connectors | `Sites.Read.All`, `SharePointTenantSettings.Read.All`, `ExternalConnection.Read.All` |
| Security evidence | `SecurityAlert.Read.All`, `SecurityEvents.Read.All`, `SecurityIncident.Read.All`, `ThreatIndicators.Read.All` |
| Information protection | `InformationProtectionPolicy.Read` |
| Usage evidence | `Reports.Read.All` |

All requested Microsoft Graph data permissions are read scopes. The scanner
does not request Graph write permissions.

The list above is the source of truth for the current local sign-in flow. If
the code changes, review `GRAPH_SCOPE_LIST` in `server.js` before approving a
new consent request.

### Roles used across the 13 readiness domains

No single role makes every one of the 77 controls technically available.
Microsoft Graph, workload administration, licensing, and human governance
evidence have different access boundaries.

The capability plan identifies these roles for the relevant domain:

| Readiness area | Relevant reader or administrator role |
|---|---|
| Licensing and entitlement | License Administrator |
| Identity and access | Global Reader |
| Devices and Microsoft 365 Apps | Intune Administrator |
| Network checks | Network Administrator or approved network operator |
| Service health | Service Support Administrator |
| Exchange Online | Exchange Administrator |
| Microsoft Teams | Teams Administrator |
| SharePoint and OneDrive | SharePoint Administrator |
| Microsoft Purview | Compliance Administrator |
| Microsoft Defender and security | Security Reader |
| Copilot tenant configuration | Global Reader |
| Power Platform and Copilot Studio | Power Platform Administrator |
| Adoption and organizational governance | Named business owner or signed attester |

These roles describe who can provide complete evidence; they are not permission
to make changes through AI Flight Deck. The current application remains
read-only.

If the signed-in account lacks a required role, permission, licence, connector,
or attestation, the affected control remains technically `Unknown` in the
evidence contract. The customer interface translates that state into the exact
next evidence action. That is expected behavior and does not mean the
installation failed.

### Optional Microsoft report imports

The live scan remains available at all times. To supplement it:

- Select **Import Microsoft readiness** to load the CSV exported from the
  Microsoft 365 admin center.
- Select **Import Microsoft assessment** to load the recommendation CSV from
  Microsoft's open-source automated readiness assessment.

Enter the report's real as-of date before importing it. Flight Deck deliberately
keeps evidence without a source date non-gating.

### Stop and restart

To stop AI Flight Deck, close the launcher window or press `Ctrl+C` in it.

To restart, double-click `Start-AI-Flight-Deck.cmd` again. Previous local
artifacts remain available because they are stored outside the repository at:

```text
%LOCALAPPDATA%\AI Flight Deck\live-test
```

This folder can contain tenant metadata and should be protected according to
the organization's data-handling requirements.

### Update an existing installation

For a Git installation:

```powershell
cd C:\Tools\ai-flight-deck
git pull origin main
```

For a ZIP installation, download the latest ZIP and extract it to a new folder.
Do not copy the local evidence workspace into the repository.

### Installation troubleshooting

| Problem | Resolution |
|---|---|
| Guided setup stops on Node.js | Allow the Windows Package Manager installation, or install Node.js LTS manually, reopen setup, and confirm `node --version`. |
| Windows blocks the downloaded setup file | Open file **Properties**, select **Unblock** if shown, then run `SETUP-AI-Flight-Deck.cmd` again. Follow organizational security policy. |
| The browser does not open | Manually open `http://127.0.0.1:8080/index.html`. |
| Port `8080` is already in use | Close the other AI Flight Deck launcher or process using that port, then start again. |
| Microsoft Graph module installation fails | Open PowerShell as the same Windows user and run `Install-Module Microsoft.Graph.Authentication -Scope CurrentUser`, then restart Flight Deck. |
| PowerShell Gallery asks to install NuGet or trust PSGallery | Review and accept the prompt if allowed by organizational policy. |
| Device sign-in requires approval | Ask a tenant administrator to grant the displayed delegated read permissions. |
| The page says the integrated scanner is unavailable | Start the product with `Start-AI-Flight-Deck.cmd`; do not open `index.html` directly or use a generic static server. |
| Many controls remain `Unknown` | The installation is working. Those controls require additional workload connectors, permissions, Microsoft reports, or accountable attestations. |
| A named cohort cannot be created | The Microsoft readiness export contains concealed or mixed identities. Change the Microsoft 365 report privacy setting or use an identified export. |

## Quick start for returning users

Double-click:

```text
Start-AI-Flight-Deck.cmd
```

The launcher starts the localhost-only control plane and opens
`http://127.0.0.1:8080/index.html`. From the Set up page, select
**Connect and scan tenant**. The product prepares the Microsoft Graph
authentication connector if needed, opens Microsoft sign-in, runs the
read-only baseline, stores evidence in the protected user-local workspace, and
loads Assessment automatically.

Do not host `index.html` with a generic static server when using the integrated
scanner. Static hosting supports demonstration and manual imports only.

## Scan a test tenant

The test-tenant integration uses an interactive Microsoft Graph sign-in and
delegated, read-only permissions. Credentials and tokens are never stored in the
HTML application.

### 1. Connect and scan

Select **Connect and scan tenant** inside AI Flight Deck. On first use, the
local control plane installs `Microsoft.Graph.Authentication` for the current
Windows user if it is missing.

Microsoft Graph opens a device sign-in and requests delegated, read-only
permissions for the enabled Graph collectors. The exact list is maintained in
`server.js` as `GRAPH_SCOPE_LIST` and includes directory, policy, device
management, service health, collaboration, reporting, security, SharePoint,
and information-protection reads.

An administrator may need to grant consent in the test tenant. The scanner does
not request write permissions.

Authentication modes are `Interactive`, `DeviceCode`, `ExistingContext`,
`ManagedIdentity`, and `Certificate`. Interactive delegated authentication is
the default. Certificate authentication requires `TenantId`, `ClientId`, and
`CertificateThumbprint`; the thumbprint is used only for the current command
and is not persisted in the locked configuration. The scan records the
authentication mode and actor so verification cannot compare evidence gathered
under a different identity.

The live-test runner stores tenant evidence outside the repository by default:

```text
%LOCALAPPDATA%\AI Flight Deck\live-test
```

It prints the resolved workspace path and locks collection settings in
`test-config.json`. This prevents verification from silently using different
limits, authentication mode, or scope. Use `-WorkspacePath` only when an
approved protected location is required.

### 2. Review the assessment

After sign-in and collection complete, the product loads the baseline
automatically. Assessment renders thirteen estate systems in an interactive
three-dimensional mission map. Each system remains evidence-backed as
**Online** (collected), **Degraded** (partial), or **Unscanned** (not collected),
then presents the bounded sharing signal and its evidence. It does not
substitute total directory population for affected users or present the sharing
signal as a rollout recommendation.

Manual **Import existing scan** remains available for offline evidence review.

### Combine Microsoft evidence

The Set up page supports three complementary evidence paths:

1. **Fast path - Microsoft 365 Copilot Readiness CSV.** Export the readiness
   report from the Microsoft 365 admin center, enter its displayed as-of date,
   and import it. Flight Deck records the source digest, 28-day activity scope,
   reporting privacy mode, licence assignment, update-channel observations, and
   suggested candidates. Activity-limited report rows never prove complete
   tenant or device coverage.
2. **Microsoft assessment path.** Run Microsoft's
   `m365-copilot-automated-readiness-assessment`, then import its
   `m365_recommendations_*.csv` file with the source commit or release and the
   assessment date. Flight Deck maps only exact checks verified against that
   source version. Unrecognized feature rows remain visible in a staged inbox;
   title similarity is never treated as evidence.
3. **Live path.** Run **Connect and scan tenant** to collect current Graph and
   network evidence. Fresh conclusive live evidence takes precedence if an
   imported result conflicts with it.

For identified readiness reports, select users in the candidate list, enter a
cohort name and accountable owner, and save the approved cohort. Run the live
scan again so Flight Deck can resolve every selected user to a Microsoft Graph
identity. The saved cohort is not approved for mission gating if any selected
identity cannot be resolved. Microsoft Graph paging is followed beyond the
first 999 directory users.

If the Microsoft 365 reporting privacy setting conceals any identities, Flight
Deck labels the import `Concealed` or `Mixed` and blocks named cohort creation.
If an as-of date is missing, imported results remain `Unknown` with
`MISSING_SOURCE_TIMESTAMP`.

### Current scanner scope

The collector suite is deliberately bounded:

- Registers one executable collector owner for every catalogue control and
  always emits exactly 77 normalized control results.
- Reads organization, subscribed SKU, service-plan, user, guest, group,
  Conditional Access, identity risk, Intune, service health, Teams, connector,
  application, site, drive, and root-level item metadata where Graph exposes
  the required evidence.
- Runs deterministic DNS, HTTPS, TLS, reachability, and latency probes from the
  scanner host.
- Detects anonymous and organization-wide item sharing scopes plus SharePoint
  sites connected to public Microsoft 365 groups.
- For sampled root items that Graph marks as shared, performs a separately
  bounded, best-effort drive-item permission pass to classify specific-people
  links, direct user, guest, group, application or agent grants, roles,
  inheritance, and expiration metadata.
- Does not call the Graph site ACL endpoint because Microsoft requires the
  write-capable `Sites.FullControl.All` permission even for that GET request.
- Deterministically selects sites by stable site identifier and samples
  root-level drive items.
- Does not recursively enumerate every nested item or expand nested group
  membership; those limitations remain visible in the access review.
- Reports discovered, selected, and scanned site coverage explicitly.
- Counts only risk-qualified sampled items as exposed evidence.
- Bounds users, groups, sites, drives, items, and total Graph requests.
- Retries Graph throttling and transient 502, 503, and 504 responses using
  `Retry-After`, exponential backoff, and jitter.
- Does not retrieve document contents.
- Does not change tenant configuration.
- Returns explicit `Unknown` results when a workload-specific administration
  session, service token, approved cohort, or signed attestation is required.
- Supports local administrative evidence, Power Platform evidence, and signed
  attestation adapter inputs without presenting absent inputs as completed
  checks.

Before sign-in, the local service exposes a thirteen-service capability plan
that lists the minimum permissions, administrator roles, licences, and
endpoints required by each collector. Delegated local operation and production
application identity are planned separately. Access tokens remain in memory,
are bound to one tenant/job/collector tuple through opaque one-time handles,
and are cleared on completion or cancellation.

Every scan carries a versioned producer, scoring policy, policy hash,
configuration hash, scope fingerprint, collection status, and stable evidence
identifiers. It also emits one normalized, cohort-aware result for every
catalogue control. Missing collector capabilities are explicitly `Unknown` and
block mission progression. Reaching a configured collection bound marks
required evidence as incomplete rather than presenting a smaller sample as
improvement.

Local workflow artifacts are sealed with a workspace HMAC envelope before being
served to the browser. The service rejects modified artifacts, binds generated
action packages to the signed baseline digest and selected evidence or control
IDs, and maintains an append-only digest chain for each control result. The
32-byte signing key is stored in the protected user-local workspace so sealed
artifacts remain verifiable after the local service restarts.

When a sealed, minimized evidence graph is available, the simulator performs a
deterministic access-path traversal:

```text
Principal -> Membership -> Resource -> Content signal -> AI surface -> Policy
```

It reports reachable resources, affected principals, policy blockers,
confidence, and missing graph edges. When that graph is unavailable, the
experience switches to a readiness-impact trace built from the actual failed,
warning, and unknown control results. The trace shows
`Evidence source -> Control -> Mission gate -> Decision impact` and the required
correction instead of displaying a dead-end simulator error. Neither mode sends
prompts to Copilot, uses an LLM to decide access, infers missing evidence, or
executes remediation.

The product keeps the overall status at `InsufficientEvidence` until all
mandatory domains have sufficient, current evidence.

### Estate-readiness domains

| Domain | Current state |
|---|---|
| Licensing and tenant entitlement | Automated Graph inventory plus cohort and renewal evidence |
| Identity and access | Automated Graph policy, sign-in, risk, role, and directory checks |
| Devices and Microsoft 365 Apps | Automated Intune and application checks plus policy evidence |
| Network and client connectivity | Automated local probes plus enterprise network evidence |
| Service health and tenant operations | Automated Graph issues and messages plus ownership evidence |
| Exchange Online readiness | Workload administration adapter required |
| Teams readiness | Automated inventory plus Teams policy administration evidence |
| SharePoint and OneDrive content governance | Graph scan plus SharePoint administration evidence |
| Purview information protection and compliance | Graph label read plus Purview administration evidence |
| Security posture | Graph security reads plus Defender service connections |
| Copilot configuration and feature governance | Graph inventory plus tenant policy evidence |
| Power Platform, Copilot Studio and agents | Power Platform administration evidence required |
| Adoption, measurement and operational governance | Usage reports and signed attestations required |

## Relationship to Microsoft's open-source readiness accelerator

Microsoft publishes the
[`m365-copilot-automated-readiness-assessment`](https://github.com/microsoft/m365-copilot-automated-readiness-assessment)
repository under the Microsoft GitHub organization. It is Microsoft-authored
open-source software released under the MIT License, but it should not be
represented as a supported Microsoft 365 product or service.

The current import crosswalk is pinned to upstream commit
`f542406ffba2066d943643de8d7a87b755b98cab`. That revision exports the columns
`Service`, `Feature`, `Status`, `Priority`, `Observation`, `Recommendation`,
`LinkText`, and `LinkUrl`. Flight Deck does not trust the upstream `Status`
field alone because some recommendation modules use `Success` for a completed
collector even when the observation identifies a governance gap. Exact feature
semantics and source provenance determine the proposed Flight Deck result.

AI Flight Deck can include equivalent assessment domains without losing its
product differentiation:

| Assessment domain | AI Flight Deck treatment |
|---|---|
| Microsoft 365 licensing | Validate prerequisite licenses and service-plan state |
| Entra | Model users, guests, groups, risky identities and Conditional Access |
| Defender | Incorporate Secure Score, incidents, vulnerabilities and exposure signals |
| Purview | Add labels, DLP, retention and oversharing evidence to attack paths |
| Power Platform | Evaluate environments, connectors, DLP boundaries and AI Builder |
| Copilot Studio | Inventory agents, authentication, tools and accessible resources |
| Agent 365 | Evaluate agent catalog, ownership, deployment scope and access expansion |

The additional AI Flight Deck layer remains:

- Adversarial scenario simulation.
- User and agent permission attack paths.
- Business-impact and affected-user calculation.
- Before-and-after remediation forecasting.
- Evidence-backed estate-domain coverage and pilot recommendation only after
  every mandatory domain is sufficiently assessed.

Capability ideas can be implemented independently from public documentation and
supported APIs. If source code from the Microsoft repository is copied or
adapted, the Microsoft copyright notice and MIT permission notice must be
retained in the copied or substantial portions as required by that license.

## Product workflow

The product is organized around four customer tasks:

1. **Set up** - Review permissions and boundaries, run the read-only baseline,
   import Microsoft evidence, and approve a named pilot cohort.
2. **Assessment** - Review domain coverage, evidence gaps, the sharing posture
   signal, and evidence-backed findings.
3. **Corrections** - Create an approval-ready correction package. Forecasts are
   planning aids and never count as proof.
4. **Decision** - Re-scan and verify sharing corrections independently from
   the estate-wide decision. `SharingControlsVerified` never means Copilot
   rollout is approved.

Synthetic scenarios remain available to explain permission-path risk. They are
not represented as live tenant evidence.

The prototype includes three synthetic scenarios:

- Confidential acquisition information exposed through broad site inheritance.
- Employee compensation data exposed through stale group membership.
- A procurement agent receiving excessive Finance access.

## Product differentiation

Existing readiness tools largely report whether controls are configured. AI
Flight Deck demonstrates the outcome:

- What could AI retrieve?
- Which users or agents could retrieve it?
- Why is it reachable?
- What is the business impact?
- Which control closes the path?
- What would readiness look like after remediation?

## Production adoption architecture

The static prototype intentionally separates the product experience from future
data collectors. A production implementation should introduce these layers:

| Layer | Responsibility | Candidate Microsoft integration |
|---|---|---|
| Experience | Assessment, evidence paths, corrections and rollout decision | React and Fluent UI |
| Orchestration | Assessment jobs, evidence correlation and policy evaluation | Azure Functions or Container Apps |
| Identity graph | Users, groups, guests, roles and effective membership | Microsoft Graph |
| Content graph | Sites, files, sharing links and inherited access | Microsoft Graph and SharePoint APIs |
| Data security | Labels, DLP, risky AI use and oversharing posture | Microsoft Purview DSPM for AI |
| Security posture | Identity and device risk signals | Microsoft Defender and Entra |
| Agent governance | Agent inventory, owners, tools and accessible resources | Microsoft 365 admin and agent APIs |
| Evidence store | Timestamped scans, simulations and approvals | Azure Cosmos DB or Azure SQL |

Collectors should normalize evidence into a common model:

```text
Principal -> Membership -> Resource -> Content signal -> AI surface -> Policy
```

The simulation engine can then calculate:

```text
Exposure risk = discoverability x sensitivity x audience x control weakness
```

## Security and product boundaries

- Default to read-only data collection and least-privilege permissions.
- Do not submit discovered content to an external model.
- Prefer metadata and deterministic policy evaluation for the initial release.
- Require explicit approval before any remediation changes tenant state.
- Record the evidence, policy version, actor, and timestamp for every decision.
- Treat the recommendation as decision support, not a compliance certification.
- Verify every forecast against a post-change tenant scan.

## Act and prove

The product does not stop at forecasting. Selected corrections can be
exported as an administrator approval package containing:

- Baseline evidence and affected tenant.
- Requested controls and business rationale.
- Forecast readiness and affected-user reduction.
- Explicit approval, least-privilege, rollback, and verification requirements.

For a controlled tenant test, use a test-only SharePoint site and dummy
documents. Capture a deliberately broad or anonymous sharing permission in the
baseline, then remove or restrict that permission through the normal
SharePoint administration experience. Do not use real sensitive content.

After administrators complete the approved test change, capture verification
using the locked baseline configuration:

```powershell
.\ai-flight-deck\scanner\test-live-tenant.ps1 -Phase Verification
```

Run the authoritative comparison:

```powershell
.\ai-flight-deck\scanner\test-live-tenant.ps1 -Phase Compare
```

This produces persistent evidence for the rollout decision without applying
any tenant changes. `compare-scans.ps1` is the only positive-decision engine.
It rejects different tenants, stale timestamps, incomplete evidence or
coverage, different scopes, different authentication actors, and different
producer or scoring contracts. The browser accepts the resulting
`verification-report.json`; it does not turn a raw verification scan or a
forecast selection into a positive recommendation.

The default user-local workspace contains:

```text
%LOCALAPPDATA%\AI Flight Deck\live-test\baseline-scan.json
%LOCALAPPDATA%\AI Flight Deck\live-test\verification-scan.json
%LOCALAPPDATA%\AI Flight Deck\live-test\verification-report.json
%LOCALAPPDATA%\AI Flight Deck\live-test\test-config.json
```

Check progress at any time:

```powershell
.\ai-flight-deck\scanner\test-live-tenant.ps1 -Phase Status
```

## Suggested product roadmap

### Hackathon MVP

- Synthetic data and three attack-path simulations.
- Evidence-backed findings and affected-user visualization.
- Read-only remediation modelling.
- Exportable flight-clearance report.

### Product incubation

- Microsoft Graph and Purview data adapters.
- Customer-defined personas, prompts, policies, and launch thresholds.
- Scheduled rescans and drift detection.
- Approval packages for remediation owners.

### Product integration

- A supported entry point agreed with the relevant Microsoft 365 product team.
- Integration with DSPM for AI and SharePoint Advanced Management.
- Supported remediation workflows with verification and rollback.
- Continuous rollout monitoring for Copilot and deployed agents.
