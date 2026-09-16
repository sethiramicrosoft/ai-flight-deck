# Install AI Flight Deck on a Windows computer

[README](../README.md) · [Permissions and security](PERMISSIONS-AND-SECURITY.md) ·
[Connection guide](COLLECTOR-GUIDE.md)

[First-time setup](#simplest-first-time-setup) · [Requirements](#requirements) ·
[First scan](#complete-the-first-live-scan) · [Troubleshooting](#installation-troubleshooting) ·
[Returning users](#quick-start-for-returning-users) · [Test-tenant configuration](#scan-a-test-tenant)

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
   user through the private module bootstrap. Organizational policy may block
   downloads; Flight Deck does not change PowerShell Gallery repository trust.
3. The browser opens `https://microsoft.com/devicelogin`.
4. Copy the one-time code displayed in Flight Deck.
5. Enter the code on Microsoft's sign-in page.
6. Sign in with the approved Microsoft 365 tenant account.
7. Review the requested delegated permissions. Graph requests read access.
   Workload connectors use Microsoft's administration clients; their consent
   can be broader than the read-only commands this tool executes.
8. If tenant-wide admin consent is required, ask an authorized administrator
   to approve the displayed permissions.
9. Return to Flight Deck and leave the launcher window open until the scan
   finishes.
10. Flight Deck opens **Assessment** automatically when the baseline is ready.

The first run may take longer because missing Microsoft authentication and
administration modules and their dependencies are downloaded to the private
`%LOCALAPPDATA%\AI Flight Deck\PowerShell\Modules` store.

For the four workload sign-ins and per-domain limits, continue with the
[connection guide](COLLECTOR-GUIDE.md). Administrators can inspect the
[runtime and package contracts](COLLECTION-REFERENCE.md); required access is
listed in [permissions and security](PERMISSIONS-AND-SECURITY.md).

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
| Microsoft Graph module download or import fails | Run `SETUP-AI-Flight-Deck.cmd` again as the same Windows user. Check approved Gallery access, local write permissions and package-management availability. Setup uses the private LOCALAPPDATA store; do not install modules into redirected Documents. |
| Gallery source is rejected or bootstrap cannot run noninteractively | Ask your administrator to verify the official `https://www.powershellgallery.com/api/v2` source and approved package management. Flight Deck does not change repository trust or prompt for it. |
| Private module storage is unsafe or unavailable | Ask your administrator to verify a local, non-redirected `LOCALAPPDATA` directory outside Documents and OneDrive. Flight Deck stops instead of falling back to a synced directory. |
| OneDrive DLP notice names an existing module/help file | The updated bootstrap does not reuse those files. Leave blocked files and policy unchanged; ask your administrator to handle existing notices. Private downloads can still be restricted by organizational policy. |
| A module was already loaded outside the private/native machine paths | Restart through the launcher or use a fresh `-NoProfile` PowerShell host; do not reuse a session that imported Documents modules. |
| Device sign-in requires approval | Ask a tenant administrator to grant the displayed delegated read permissions. |
| The page says the integrated scanner is unavailable | Start the product with `Start-AI-Flight-Deck.cmd`; do not open `index.html` directly or use a generic static server. |
| Many checks remain `Unknown` | Open **What still needs to be checked** and the [connection guide](COLLECTOR-GUIDE.md#a-gap-is-not-always-a-tenant-fault). This version cannot verify 62 checks from returned records; granting more permissions or rescanning will not add that feature. Other checks may need administrator access, licences or a specific owner statement. |
| A pilot user list cannot be approved | Check the user/group lookup limits and use the same account that created the scan. Hidden or mixed identities in a readiness CSV cannot identify pilot users; select users from the directory or use an approved report with visible identities. Do not assume you must change your organization's privacy settings. |

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

Continue with [Microsoft report imports](EVIDENCE-AND-VERIFICATION.md#combine-microsoft-evidence),
[scanner scope](COLLECTION-REFERENCE.md#current-scanner-scope) and
[controlled verification](EVIDENCE-AND-VERIFICATION.md#act-and-prove).
