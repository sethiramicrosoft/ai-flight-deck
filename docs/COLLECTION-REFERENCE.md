# Collection runtime reference

[README](../README.md) · [Connection guide](COLLECTOR-GUIDE.md) ·
[Installation](INSTALLATION.md) · [Evidence contracts](EVIDENCE-AND-VERIFICATION.md)

Start with the [13-domain connection guide](COLLECTOR-GUIDE.md#at-a-glance-all-13-domains)
for service-by-service sign-in, reads, limitations and next steps. This companion
preserves the implementation details: package contracts, acquisition outcomes,
identity binding, module isolation and scanner behavior. Repository file paths
below are relative to the repository root.

[Workload collection](#complete-evidence-the-graph-scan-cannot-collect) ·
[Exchange, SharePoint and Purview](#exchange-online-sharepoint-online-and-purview) ·
[Power Platform](#power-platform-and-copilot-studio) · [Scanner scope](#current-scanner-scope)

## Complete evidence the Graph scan cannot collect

**Connect and scan tenant** now runs Graph and the four workload collections
automatically. **Collect workload evidence** updates an existing verified
baseline without repeating its SharePoint sharing inventory. Complete each
Microsoft service's sign-in, MFA, or consent prompt when requested; the app
handles prerequisites, execution, temporary output, local ingestion and
assessment refresh. There are no required script downloads, administrator
exports, copied collection challenges or hand-filled workload JSON templates.

Per-workload outcomes remain visible in Set up and are saved with the assessment.
One service's role denial or missing module does not prevent other services from
being attempted. Each workload has a 15-minute deadline and collection can be
cancelled. Producer output is limited to 12 MB per workload; over-limit output
is an explicit gap, not silently truncated evidence. The default scan attempts
all four workloads. Availability still
depends on tenant licensing, roles, service support and local installation policy.

### Exchange Online, SharePoint Online, and Purview

The app launches `scanner/collect-admin-evidence.ps1` once per service, using
`ExchangeOnlineManagement` or `Microsoft.Online.SharePoint.PowerShell`. It
discovers the commercial SharePoint administration URL through the Graph
organization and root site, bound to the baseline tenant. It never passes the
Graph access token to a workload connector.

Producer output must match the current collection challenge, expected tenant,
supported producer/version and freshness contract. A workload cannot supply
another service's command keys. The app combines only the current run's admin
outputs, retains collection errors and per-service identity/timestamps, and
protects the result with the local workspace integrity key. An unsuccessful
current collection cannot silently substitute a previous successful result.

The schema stays at 1.0.0; the automated administrator producer is 1.1.0.
Command boundaries, counts, module versions and cleanup failures are retained.
Automatic installation includes `AllowClobber` for the allowlisted Microsoft
modules and their package-management dependencies, which can overlap Windows'
inbox `Find-Package`, `Install-Package` and `Uninstall-Package` commands.
Connector failures supply safe structured diagnostics to the workload status
instead of only a PowerShell exit code.
When every command fails, the collector still fails without admitting an
evidence package, but retains bounded per-command error details in the workload
panel and saved collection outcome. Authentication and command diagnostics use
fixed explanations and safe error codes, not raw service exceptions or tokens.
An unclassified connection failure is not automatically labelled a user cancellation.
If `Get-HybridConfiguration` is unavailable, the collector identifies its
[on-premises-only scope](https://learn.microsoft.com/powershell/module/exchangepowershell/get-hybridconfiguration)
rather than implying an Exchange Online role change will expose it. This does
not establish that hybrid configuration is absent or not applicable.

Warning-bearing rows are retained in a separate `observations` map, never
silently promoted to accepted source evidence. The workload panel separates
acquisition outcome, accepted rows, retained observations, and coverage gaps.
An observations-only run can be partial rather than discarding useful rows;
a genuinely empty, unsuccessful acquisition still fails.

`Get-SPOSite` no longer uses deprecated `-Detailed`. Each site-list query is
bounded to 1,000 rows, followed by identity-specific detail reads because list
queries can omit or default configuration properties. The process-wide detail
budget defaults to 200 sites, with caching across the three logical site queries.
Sites without successful detail reads, and rows returned with warnings, remain
incomplete observations—not proof of their settings.
These counts are per query and must not be summed as unique sites.

The Purview audit-log query now uses a supplemental Exchange Online connection
after the Purview compliance connection finishes reading policies. The audit
connection must report the same organization and signed-in account before it
reads records. An audit connection failure does not discard successfully
read Purview policies. This fixes which service is used; it does not
prove that every tenant exposes the command or that audit ingestion is healthy.

SharePoint Data Access Governance reads use
[documented report entities](https://learn.microsoft.com/powershell/module/microsoft.online.sharepoint.powershell/get-spodataaccessgovernanceinsight) and
`Snapshot` / `RecentActivity` report types. They read existing report metadata,
not report contents: the site-access query targets SharePoint permissions
snapshots, and the governance query targets recent Everyone-except-external-users
item reports. Neither query establishes complete site permissions or all forms
of oversharing, and neither creates a report.

Setup, Graph scans and workload collectors share a private module bootstrap.
Approved modules and dependencies are downloaded with `Save-Module -Path` from
the official HTTPS PowerShell Gallery into
`%LOCALAPPDATA%\AI Flight Deck\PowerShell\Modules`. Power Platform remains pinned
to `2.0.216`; Exchange and SharePoint minimum versions are preserved.
Each PowerShell host (including Windows PowerShell 5.1 and PowerShell 7's
SharePoint compatibility session) initializes process-local dependency discovery
with the private root first and native machine module paths only. Top-level
modules are imported by their private absolute paths, not reused from redirected
Documents, even when those copies have newer versions. No global `PSModulePath`,
execution policy, repository trust or OneDrive settings are changed.
An absent, network, synced or redirected local storage path fails explicitly;
there is no fallback to Documents. Existing OneDrive files are not copied,
deleted or unblocked. Organizational policy still applies to private downloads;
this storage choice is not a DLP exemption.
Exchange and Purview bind the service's reported tenant and signed-in account.
SharePoint's administration module does not expose those identities: they remain
null and `tenantVerified` remains false. Its connected administration URL must
match the Graph-derived target. The aggregate does not invent a common service
actor. Neither this URL binding nor local integrity sealing proves effective
tenant-wide access.

### Power Platform and Copilot Studio

The app launches `scanner/collect-power-platform-evidence.ps1` with the baseline
tenant and ingests its authenticated output automatically. The package retains
the original seven-resource contract: environments, DLP policies, connectors,
agents, agent owners, sharing and lifecycle. It also collects app, flow and
connection inventories independently of Dataverse. Unsupported or inaccessible resources
receive explicit errors instead of fabricated approval flags or empty-array
claims of complete coverage.

The supported path uses the pinned Microsoft PowerApps administration module
for environments, legacy DLP policies, custom connectors, apps, flows and
connections across the accessible environments, then each
accessible environment's Dataverse Web API for bots, record owners, explicit
shares and lifecycle metadata. It checks resource-specific token tenant/actor
bindings, validates Dataverse hosts and pagination links, and bounds collection
to 50 environments, 2,000 rows per resource, 500 explicit operations and 20 pages
per query by default. Administration-module pagination is opaque and its
internal HTTP request count is not asserted. Standard connector coverage,
effective role/team/inherited sharing, business approvals and tenant-wide
visibility are not proven. These boundaries stay explicit even when rows are
successfully returned.

When list metadata is insufficient, the collector reads details for that exact
environment and revalidates its authenticated context before accepting a
Dataverse endpoint. It never guesses a URL. A missing endpoint means database
availability is unknown, not that Dataverse does not exist: the module's
`CommonDataServiceDatabaseProvisioningState` label reflects generic environment
provisioning, not database existence.

Each dataset records a read outcome: collected, partial, failed or unavailable.
A successful empty read is distinct from a denied request. The workload panel
separates collection errors from coverage and review gaps; legacy packages
without recorded acquisition status remain explicitly labelled. The pinned
module's REST failure propagation is enabled temporarily and restored after
each read so a swallowed HTTP error cannot masquerade as a successful empty list.
App/flow definitions, connection credentials and connection strings are excluded.

These collection choices build on the separate non-Dataverse service paths in
[Microsoft's reference collector](https://github.com/microsoft/m365-copilot-automated-readiness-assessment/blob/f542406ffba2066d943643de8d7a87b755b98cab/Core/get_power_platform_client.py).
Unlike its selected-environment approach, this collector visits accessible
environments within explicit bounds. It does not adopt empty-on-error fallbacks
or infer bot coverage from app/flow inventory. These extra inventories are
observations; they do not add authority contracts or automatically clear controls.

Workload scripts run under Windows PowerShell 5.1, independently of the Graph
scanner's preferred PowerShell host. Execution-policy bypass is process-local;
the app does not change persisted policy or override organization-enforced
restrictions.

Successful collection does **not** automatically satisfy a rollout requirement.
The app can verify only the four automated checks and eleven types of owner
statement in the [evidence contracts](EVIDENCE-AND-VERIFICATION.md#evidence-authority-and-supported-boundaries).
Other checks remain unresolved. Signing in again or
protecting a local file against edits does not add the missing verification.

Existing offline import controls remain in a collapsed **Advanced: import an
existing evidence package (optional)** section. They are not part of the normal
collection flow; their one-time challenge and freshness rules remain enforced.

## Current scanner scope

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

Before sign-in, the local service displays a plan for thirteen topics. Its
suggested permissions, roles, licences and service addresses are **plans**, not
the exact sign-in request or proof that every connection works. Several topics
share one Microsoft connection. Labels proposing application-only sign-in do
not mean that connection has been implemented. The
[connection guide](COLLECTOR-GUIDE.md) explains what actually runs and what is missing.
Access tokens remain in memory,
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

## Estate-readiness domains

Use the **[13-topic connection table](COLLECTOR-GUIDE.md#at-a-glance-all-13-domains)**
as the single connection reference. Each topic explains the Microsoft service,
how you sign in, what is read, what cannot be checked and what to do next.
For example, listing Teams does not check every assigned Teams policy;
the planned separate Defender connections do not work yet; and testing this
computer's network does not test every employee's connection.
