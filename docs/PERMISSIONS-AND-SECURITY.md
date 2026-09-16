# Permissions and security

[README](../README.md) · [Installation](INSTALLATION.md) ·
[Connection guide](COLLECTOR-GUIDE.md) · [Evidence contracts](EVIDENCE-AND-VERIFICATION.md)

[Windows permissions](#windows-computer-permissions) ·
[Microsoft 365 account](#microsoft-365-account-requirements) ·
[Exact Graph scopes](#delegated-permissions-requested-by-the-live-scanner) ·
[Roles](#roles-used-across-the-13-readiness-domains) · [Security boundaries](#security-and-product-boundaries)

## Permissions required

There are two different permission sets: permissions on the Windows computer
and permissions in the Microsoft 365 tenant.

## Windows computer permissions

The person installing the prototype needs permission to:

- Extract files to a local folder.
- Run `.cmd` and PowerShell scripts.
- Install Node.js if it is not already present. Windows may display an
  elevation prompt depending on the device policy and Node.js installer.
- Save `Microsoft.Graph.Authentication` and dependencies into the private
  `%LOCALAPPDATA%\AI Flight Deck\PowerShell\Modules` directory, normally without
  local administrator rights. If needed, the NuGet package provider uses its
  current-user package-provider location (not the Documents module directory).
- Open a localhost listener on `127.0.0.1:8080`.
- Create a desktop shortcut if that option is selected.

If software installation, PowerShell Gallery, Windows Package Manager, or
script execution is controlled by the organization, IT must approve or perform
those prerequisite steps.

## Microsoft 365 account requirements

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

## Delegated permissions requested by the live scanner

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

## Roles used across the 13 readiness domains

No single role makes every one of the 77 controls technically available.
Microsoft Graph, workload administration, licensing, and human governance
evidence have different access boundaries.

The [connection table](COLLECTOR-GUIDE.md#at-a-glance-all-13-domains)
lists relevant Graph read permissions and suggested administrators beside each
Microsoft service, with links to what it reads and cannot check.

These are suggested roles, not a universal permission recipe. What the app can
read depends on the signed-in account's permissions for that service, licences
and software support. Flight Deck does not use those permissions to change
Microsoft settings. The [connection guide](COLLECTOR-GUIDE.md#authentication-and-permission-legend)
separates permissions actually requested at Graph sign-in from plans such as
`Sites.FullControl.All` and `Exchange.ManageAsApp`, neither of which is requested
by the local Graph sign-in.

If the signed-in account lacks a required role, permission, licence, connector,
or attestation, the affected control remains technically `Unknown` in the
evidence contract. The customer interface translates that state into the exact
next evidence action. That is expected behavior and does not mean the
installation failed.

## Security and product boundaries

These are design constraints, not a claim that tenant remediation is implemented.
Administrators make changes outside Flight Deck through their approved process.

- Default to read-only data collection and least-privilege permissions.
- Do not submit discovered content to an external model.
- Prefer metadata and deterministic policy evaluation for the initial release.
- Require explicit approval before any remediation changes tenant state.
- Record the evidence, policy version, actor, and timestamp for every decision.
- Treat the recommendation as decision support, not a compliance certification.
- Verify every forecast against a post-change tenant scan.

## Local storage and trust

Evidence is stored outside the repository at
`%LOCALAPPDATA%\AI Flight Deck\live-test`; it can contain tenant metadata.
Protect this workspace, backups and its local integrity key under organizational
data-handling rules. Modules use the separate private
`%LOCALAPPDATA%\AI Flight Deck\PowerShell\Modules` store, not redirected Documents.
No storage choice is a DLP exemption.

See [stop/restart and storage](INSTALLATION.md#stop-and-restart),
[token and artifact handling](COLLECTION-REFERENCE.md#current-scanner-scope) and
[local evidence trust boundaries](EVIDENCE-AND-VERIFICATION.md#evidence-authority-and-supported-boundaries).
