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

The current collector suite attempts all 77 controls across all thirteen
domains. Microsoft Graph and local network probes can evaluate a subset
directly. Controls that require Exchange, SharePoint administration, Purview,
Defender, Power Platform, or accountable human evidence return `Unknown` until
the required workload connection or signed attestation is supplied. The
product never converts missing evidence into a passing result.

## Run the product

Double-click:

```text
ai-flight-deck\Start-AI-Flight-Deck.cmd
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
- Detects anonymous and organization-wide item sharing scopes plus public
  Microsoft 365 collaboration workspaces.
- Does not call the Graph site ACL endpoint because Microsoft requires the
  write-capable `Sites.FullControl.All` permission even for that GET request.
- Deterministically selects sites by stable site identifier and samples
  root-level drive items.
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

The simulator consumes only a sealed, minimized evidence graph. Its traversal
is deterministic:

```text
Principal -> Membership -> Resource -> Content signal -> AI surface -> Policy
```

It reports reachable resources, affected principals, policy blockers,
confidence, and missing graph edges. It does not send prompts to Copilot, use
an LLM to decide access, infer missing evidence, or execute remediation.

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

## Positioning

> Existing tools tell customers whether controls are configured. AI Flight Deck
> shows what could actually go wrong, why it can happen, and how to prevent it
> before AI takes off.
