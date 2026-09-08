# AI Flight Deck visual tour

AI Flight Deck turns Microsoft 365 Copilot readiness evidence into a four-stage
workflow: set up the evidence, assess the estate, prepare corrections, and make
a cohort-specific rollout decision. This tour follows the complete customer
journey and uses only an isolated synthetic offline fixture. Every screenshot
is labelled accordingly; none is a production tenant assessment.

The current validator admits three automated licensing observation contracts
and eleven accountable attestation contracts. Other controls remain visible
with their findings and instructions, but cannot approve a rollout until their
source-observation validation is implemented. A collected inventory, local
signature, or high confidence value is not automatically a passed control.

[Return to the README](../README.md)

## 1. Set up the assessment

### Choose the evidence path

Start a read-only tenant scan with automatic workload collection, import an existing AI Flight Deck artifact, or
bring in evidence from the Microsoft 365 Copilot Readiness report and
Microsoft's automated readiness assessment.

The opening view identifies who uses the tool and keeps the collection boundary
visible. AI Flight Deck reads the evidence required by enabled collectors; it
does not enable Copilot or silently change tenant configuration.

[![Choose the assessment evidence path](screenshots/01-setup-overview.png)](screenshots/01-setup-overview.png)

### Prioritize incomplete evidence

The Evidence completion center identifies the current rollout mission and the
five highest-priority unresolved controls. Each blocker shows:

- the control and evidence state;
- the accountable owner;
- estimated effort;
- the missing requirement; and
- the next action.

An unresolved result is therefore presented as a specific missing permission,
licence, administrator package, Power Platform package, accountable
attestation, configuration action, owner review, recollection requirement, or
an explicit evidence-integration/observation-validation gap. Select **View exact
steps and references** to open that control's detailed instructions.

[![Prioritize missing evidence](screenshots/02-setup-evidence-center.png)](screenshots/02-setup-evidence-center.png)

### Collect workload evidence

Some controls cross administration boundaries that Microsoft Graph cannot
cover by itself.

Select **Connect and scan tenant**, or **Collect workload evidence** for an
existing baseline. The app prepares connectors, opens workload authentication,
runs Exchange Online, SharePoint Online, Purview and Power Platform / Copilot
Studio collection, and processes the results. No operator-run scripts or
hand-filled export packages are required.

Workload progress and specific collection failures appear in Set up and are
saved with the assessment. Sign-in, MFA, consent and genuine owner approvals
remain human actions. Successful collection does not override missing
observation-validation contracts or prove complete effective access.

The local service rejects stale, malformed, cross-tenant, replayed, or
unsupported packages before they can affect a control result.

[![Collect administrator and Power Platform evidence](screenshots/03-setup-workload-evidence.png)](screenshots/03-setup-workload-evidence.png)

### Create accountable human evidence

Controls explicitly classified as `Attested` can use a locally sealed
attestation. The record includes the statement, supporting JSON, evidence
references, and bounded expiry.

The attester is derived from the verified scan actor. The record is bound to
the tenant, approved cohort, control, signer, and freshness window.
`NotApplicable` is accepted only for supported conditional controls with a
named approver, reason, zero applicable population and a scope-evidence reference.
The control-specific data example explains the required fields. The local
signature protects an accountable statement; it does not independently verify
the referenced documents or tenant settings.

[![Create accountable attestations](screenshots/04-setup-attestation.png)](screenshots/04-setup-attestation.png)

### Follow the complete operating workflow

The lower part of Set up documents the operating sequence: connect, capture a
baseline, assess, prepare approved corrections, implement changes through
normal administration, rescan, and compare the result.

A forecast is never treated as proof. Only admitted, current evidence meeting
a supported control contract can close a control and advance a rollout mission.

[![Follow the operating workflow](screenshots/05-setup-operating-workflow.png)](screenshots/05-setup-operating-workflow.png)

## 2. Assess the estate

### Review the control plane

Assessment maps 13 readiness domains and 77 controls across Activation, Safe
pilot, Scale, and Assure. Online, degraded, and unscanned domains remain
visible rather than being hidden behind a single score.

Domain totals are recomputed from admitted evidence, not imported status counters.
Select a domain to inspect its controls, evidence state, collection coverage,
limitations, recommended next action, and Microsoft guidance. Evidence added
on Set up is evaluated during the next scan and then appears here.

[![Review the readiness control plane](screenshots/06-assessment-control-plane.png)](screenshots/06-assessment-control-plane.png)

### Review SharePoint access and sharing evidence

The live assessment names the resources it discovered instead of presenting
generic “access-path scenarios.” It can identify:

- SharePoint sites connected to public Microsoft 365 groups;
- sampled files and folders with Anyone links;
- sampled files and folders with organization-wide links;
- specific-people links and direct user, guest, group, application, or agent
  permissions when Graph returns bounded permission detail;
- inherited permissions on sampled shared items;
- guest-identity context that still requires a separate resource-access
  review; and
- the bounded collector coverage that remains unverified.

For each item, AI Flight Deck explains what was observed, why the sharing
configuration matters, the potential audience, what the scan did not prove,
and the administrator action required. Public sites are shown as SharePoint
sites. Files, folders, and sharing links retain their actual resource type.

The audience is deliberately bounded. A public site or organization-wide link
shows up to the inventoried tenant-user population; an Anyone link shows an
unbounded audience. The product does not label that estimate as “affected
users” because exact effective access requires per-resource permission
evaluation, nested-group expansion, guest mapping, inherited permissions, and
link-use context.

The offline fixture can show a readiness-blocker trace instead when there is
no supported sealed sharing path. That is not a simulated effective-access proof.

[![Review the fixture's available evidence scenarios](screenshots/07-assessment-sharing-review.png)](screenshots/07-assessment-sharing-review.png)

### Inspect the evidence-backed action

Selecting an item traces the potential audience, access mechanism, exact
SharePoint resource, location, content-inspection boundary, Copilot relevance,
and required validation. The result distinguishes confirmed sharing
configuration from unproven sensitive-content exposure.

If no public site or broad sharing link is found, the review reports that no
broad path was observed in the sampled scope and continues to show the
remaining collection boundary. When no sealed access graph is available, the
product falls back to a deterministic readiness-impact trace connecting
missing evidence to its control, mission, decision, and correction.

[![Inspect the fixture's evidence-to-decision trace](screenshots/08-assessment-sharing-result.png)](screenshots/08-assessment-sharing-result.png)

### Review evidence-backed findings

Findings expose the concrete evidence behind sharing and access risks. Filter
the list by severity and move a selected finding into correction planning.

This view keeps the technical signal, affected resource or population, and
expected Copilot exposure outcome together for security, compliance, identity,
SharePoint, and program owners.

[![Review evidence-backed findings](screenshots/09-assessment-findings.png)](screenshots/09-assessment-findings.png)

## 3. Prepare corrections

Corrections presents evidence-linked technical changes for administrator
review. Selecting a correction updates only the demonstration forecast and can
produce an approval package; it does not modify the tenant.

Administrators implement approved changes through normal Microsoft 365
administration and change-control processes. A new scan is required to prove
the resulting state. Evidence-collection tasks remain prioritized in the
Evidence completion center, while this page focuses on technical remediation.

[![Prepare technical corrections](screenshots/10-corrections.png)](screenshots/10-corrections.png)

## 4. Make the rollout decision

### Review the cohort-specific outcome

Decision shows whether the explicitly approved cohort can proceed to its next
mission. Missing permissions, incomplete coverage, stale evidence, invalid
exemptions, or unsupported packages keep the relevant mission blocked.

The summary separates a bounded sharing signal from the complete estate
decision and lists the mandatory gates that still prevent progression.

[![Review the rollout decision](screenshots/11-decision-summary.png)](screenshots/11-decision-summary.png)

### Follow the tenant enablement plan

The enablement plan covers all 77 controls and orders unresolved work using the
same evidence priorities as the Evidence completion center.

Each control provides the responsible roles, administration path,
prerequisites, required outcome, implementation steps, acceptance criteria,
next evidence action, and supporting Microsoft references. The catalogue's
gates and thresholds are AI Flight Deck rollout policy, not a universal
Microsoft prerequisite list. The complete
customer handoff can be downloaded as Markdown.

[![Follow the tenant enablement plan](screenshots/12-decision-enablement-plan.png)](screenshots/12-decision-enablement-plan.png)

### Verify and preserve the decision trail

After administrators complete approved work, run a new scan and return to
Decision. The evidence trail distinguishes the baseline, imported sources,
forecast actions, verification evidence, and final cohort decision.

Evidence expiry, drift, or newly opened risk can reopen a previously satisfied
gate. The product therefore supports a repeatable evidence cycle rather than a
one-time readiness score.

[![Verify the decision evidence trail](screenshots/13-decision-evidence-trail.png)](screenshots/13-decision-evidence-trail.png)

## How the stages connect

1. **Set up:** Connect or import evidence, identify the current mission, and
   complete missing evidence.
2. **Assessment:** Inspect domain, control, trace, and finding results.
3. **Corrections:** Review proposed technical changes without modifying the
   tenant.
4. **Decision:** Follow the enablement plan, rescan, and determine whether the
   approved cohort can proceed.

[Return to the README](../README.md)
