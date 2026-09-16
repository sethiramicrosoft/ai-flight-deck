# Evidence and verification

[README](../README.md) · [Guided actions](ACTION-WORKFLOW.md) ·
[Connection guide](COLLECTOR-GUIDE.md) · [Collection runtime](COLLECTION-REFERENCE.md)

[Supported contracts](#evidence-authority-and-supported-boundaries) ·
[Freshness and admission](#admission-freshness-and-reader-parity) ·
[Sharing review](#how-the-sharepoint-access-and-sharing-review-works) ·
[Owner statements](#statements-from-accountable-owners) ·
[Microsoft imports](#combine-microsoft-evidence) · [Controlled verification](#act-and-prove)

This is the technical decision-evidence reference, not a rollout approval.
Repository paths and test commands below are relative to the repository root.

## Evidence authority and supported boundaries

This section explains **which results the app can use to support a rollout
decision**. It is the technical reference for administrators and developers:
a *control* is a check; a *cohort* is the approved list of pilot users; an evidence
*contract* specifies the facts required for a particular check; *admission* means
accepting a result for decision-making. The app must first read the information,
then interpret it, then verify whether the conclusion is supported. Those are
three different steps.

`collector-runtime.js` retains only source-derived proof facts and a digest before
discarding raw collector observations. It does not persist raw Graph user records,
tokens, invented request IDs, or credentials in the receipt. `evidence-authority.js`
checks those facts against the normalized decision and creates a locally
HMAC-sealed, source-bound observation receipt. Each new `evidenceRefs` entry resolves
to that receipt's record, rather than to a decorative string.

The four automated checks with implemented source verification are:

| Control | Validated observation boundary |
|---|---|
| AFD-LIC-001 | Complete Graph SKU/user enumeration, resolved approved cohort, active Copilot subscriptions, and **prepaid minus consumed** units covering the cohort, matching the catalogue criterion |
| AFD-LIC-002 | Complete Graph user enumeration, approved cohort membership, and enabled Copilot service-plan assignments with no missing members or licensed users outside the cohort; an assigned SKU alone is insufficient |
| AFD-LIC-004 | Complete, well-formed SKU/add-on inventory, with a matching normalized inventory; this does not independently prove entitlement to every downstream feature |
| AFD-IAM-003 | Complete Graph Conditional Access policy enumeration for the exact approved pilot; an enabled policy explicitly includes all pilot users or All users, All cloud apps, all client types, MFA AND compliant device, with no exclusions or extra targeting. No enabled policies is Fail; other unproven policy shapes are Unknown, not a recommendation to weaken policies |

The identity contract checks configuration, not runtime enforcement or MFA registration.
Its documented read endpoint is [`/v1.0/identity/conditionalAccess/policies`](https://learn.microsoft.com/en-us/graph/api/conditionalaccessroot-list-policies?view=graph-rest-1.0).
It requires `Policy.Read.All` and a supported reader role. Pagination stays on the
same Graph collection; oversized/truncated, denied or malformed reads cannot pass.

The automated Copilot entitlement contracts identify the
`M365_COPILOT_APPS` service plan by its documented identifier
`a62f8878-de10-42f3-b68f-6149a25ceb97`, rather than matching any product name
containing “Copilot.” This excludes Studio-only and unrelated Copilot products.
Source: Microsoft's [licensing identifier reference](https://learn.microsoft.com/en-us/entra/identity/users/licensing-service-plan-reference).
The boundary is Copilot in productivity apps; other features still require their
own applicable controls and evidence.

Eleven checks accept a specific statement from an accountable owner, called an
*attestation*. Each requires the information listed below.
An accepted statement means that the signer supplied the required
facts and references, not that Flight Deck fetched those documents or independently
tested effective settings. The local HMAC protects integrity; it does not authenticate
Microsoft's truth, prove the signer's service role, or constitute external evidence.
The existing local service/adapter and host remain trust boundaries.

| Check supported by an owner statement | Required data (non-empty text unless stated otherwise) |
|---|---|
| AFD-IAM-007 | `accountRef`, `owner`, `exclusionEvidenceRef`, `monitoringAlertRef` |
| AFD-DEV-005 | `owner`, `policyRef`, `conditionalAccessEvidenceRef`, `enrollmentRestrictionsEvidenceRef`, `settingsMatchPolicy: true` |
| AFD-OPS-004 | `owner`, `advisoryReviewRef`, `reviewedAt` within 7 days, `catalogueUpdated: true` |
| AFD-OPS-005 | `technicalContact`, `executiveContact`, exact `tenantId`, `reviewedAt` within 30 days |
| AFD-COPILOT-006 | `owner`, `decision`, `privacyAssessmentRef`, `tenantSettingEvidenceRef`, `tenantSettingMatch: true` |
| AFD-PPA-005 | Non-empty `sources`, each with `id`, `sensitivityLabel`, `dlpAlignment`, `promptInjectionReview`; `tools` array, each with `id`, `inputBoundary`, `outputBoundary` |
| AFD-ADOPT-001 | At least three `useCases`, each with owner, exact `targetCohort`, expected outcome and success metric |
| AFD-ADOPT-002 | Non-empty `cohorts`, including the selected cohort's `id`; each has owner, `groupId`, entry and exit criteria |
| AFD-ADOPT-003 | `training.deliveredAt` within 30 days; `support` with intake, owner and response target |
| AFD-ADOPT-004 | Non-empty `publishedUseCaseIds`, each covered by a current `acceptances` record with use-case ID, champion, impact assessment URL and expiry |
| AFD-ADOPT-006 | Non-empty `reviews` within 7 days, each with `driftReviewed: true` and non-empty textual decisions |

Set up shows the exact JSON structure for the selected control. The same examples
are in `schema/attestation-data-examples.v1.json`. Replace every blank with reviewed
facts; templates are not evidence. Include at least one evidence reference and a
current signature, statement, attester, tenant, cohort, domain, control and expiry.
Adoption controls also retain their existing domain normalization checks.
Only AFD-DEV-005, AFD-PPA-005, AFD-ADOPT-002 and AFD-ADOPT-003 support an attested
`NotApplicable`: provide `applicablePopulation: 0`, `scopeEvidenceRef`, a reason and
an approver. Signing an exemption for an unconditional control cannot bypass it.
Signed Fail/Warning reports remain findings for review rather than positive proof.

For all other controls, collectors and the existing 77-control guidance remain
available, but unimplemented observation validation paths explicitly remain
`Unknown` / “App capability missing.” Administrator/Power Platform imports
and upstream CSV reports remain useful input and findings; their local seal and
challenge do not establish source truth or effective enforcement. The administrator
package contract remains exactly version **1.0.0**. Network probes remain limited to
the scanner host; inventory and sampled access are not effective-access proofs.

<a id="admission-freshness-and-reader-parity"></a>
### How results are checked and kept consistent

- Binding must match the trusted tenant, cohort, domain, control, instance, actor,
  catalogue version and collector run. Cross-run or cross-tenant replay is rejected.
- Coverage must use non-negative safe integers, with `population = evaluated` and
  `excluded = 0`. Exclusion approval is not implemented; an “approved” text reason
  cannot substitute for it. Empty inventory may be valid; empty cohort evidence is not.
- Evidence must be current relative to evaluation time, no more than five minutes
  in the future, and expire within the catalogue's exact freshness cap. Signed
  statements are signature-checked again on read and expire with their evidence.
- Evidence limitations cannot coexist with a conclusive observation claim.
  Confidence is retained as reported, never used to manufacture authority, and
  missing confidence is displayed as “not reported,” not 0% or 100%.
- `evidence-admissibility.js` is the single satisfaction rule for missions,
  enablement, evidence completion, decision blockers and control CSV exports.
  Admission is process-local and binds the complete result against subsequent
  mutation. Serialized `Verified`/`Accepted` markers are never sufficient.
- The local service verifies the artifact envelope **and the separate observation
  receipts** before serving results. The browser admits only responses obtained
  through that same-origin artifact API; file-imported and legacy results display
  a recollection explanation. A JSON file is not a transferable trust token.
- Mission quality includes missing controls and missing confidence. A mission
  whose own controls pass still explains any blocked predecessor.

`schema/control-result.schema.v1.json` remains backward-compatible for legacy
results without authority; newly generated authority follows the strict
`schema/evidence-authority.schema.v2.json` contract. Older artifacts are displayed
for review, not silently grandfathered into a readiness decision. Result projection
can change as evidence expires; the stored artifact envelope still identifies the
original collected artifact.

Targeted verification:

```powershell
node --test evidence-authority.test.js mission-engine.test.js enablement-playbook.test.js evidence-completion.test.js estate-collector-suite.test.js server.test.js
```

The strict schema regression uses the existing Python `jsonschema` installation.

## How the SharePoint access and sharing review works

**Export review summary (CSV)** downloads `ai-flight-deck-sharing-review.csv`
with one row per review or inventory group. **Export collected evidence (CSV)**
downloads the individual collected records separately. Evidence references are
attached to their own rows, not repeated as an entire finding's ID list on every
row. Both support UTF-8, quoted multiline text and spreadsheet formula protection.
Machine-readable remediation bindings and verification artifacts remain JSON.

The default view groups access patterns by site, library and known permission
origin. Ordinary user/group grants remain **Permission inventory**, not automatic
remediation tasks. Inherited access is labelled inherited; missing origin
metadata remains explicitly unresolved rather than being assigned a guessed
parent. Public Microsoft 365 groups require access validation, not an automatic
claim of sensitive-content exposure.

The view displays 25 groups per page and at most 50 evidence records in a
drilldown. Counts distinguish sampled items from permission records. This bounds
the rendered interface, not the entire collection architecture: the existing
bounded, root-level scan artifact still loads locally into the browser. It is
not a recursive million-file inventory or server-side paginated data service.

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

## Statements from accountable owners

For checks that accept an owner statement (marked `Attested` in the code),
load a verified scan for explicitly approved pilot users. Then complete the
statement form under **What still needs to be checked**. Flight Deck:

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

## Optional Microsoft report imports

The live scan remains available at all times. To supplement it:

- Select **Import Microsoft readiness** to load the CSV exported from the
  Microsoft 365 admin center.
- Select **Import Microsoft assessment** to load the recommendation CSV from
  Microsoft's open-source automated readiness assessment.

Enter the report's real as-of date before importing it. Flight Deck deliberately
keeps evidence without a source date non-gating.

## Combine Microsoft evidence

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

## Act and prove

The guided local action workflow is described in
[ACTION-WORKFLOW.md](ACTION-WORKFLOW.md). It persists progress and preserves
history; action-linked checks distinguish supported technical observations from
owner statements and unverified work. It does not send anything or make changes.

Selected corrections can also be exported as an administrator review package
(not an authenticated approval) containing:

- Baseline evidence and affected tenant.
- Requested controls and business rationale.
- Forecast readiness and affected-user reduction.
- Explicit approval, least-privilege, rollback, and verification requirements.

For a controlled tenant test, use a test-only SharePoint site and dummy
documents. Capture a deliberately broad or anonymous sharing permission in the
baseline, then remove or restrict that permission through the normal
SharePoint administration experience. Do not use real sensitive content.

After administrators complete the approved test change, capture verification
using the locked baseline configuration. Run these commands from the repository
root (the folder containing `Start-AI-Flight-Deck.cmd`):

```powershell
.\scanner\test-live-tenant.ps1 -Phase Verification
```

Run the authoritative comparison:

```powershell
.\scanner\test-live-tenant.ps1 -Phase Compare
```

This produces persistent evidence for the rollout decision without applying
any tenant changes. For this bounded before/after sharing comparison,
`compare-scans.ps1` is the only positive-decision engine; it is not the
estate-wide control-evidence validator or rollout approval.
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
.\scanner\test-live-tenant.ps1 -Phase Status
```
