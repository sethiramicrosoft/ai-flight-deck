# Architecture, capabilities and roadmap

[README](../README.md) · [Visual tour](VISUAL-TOUR.md) ·
[Evidence contracts](EVIDENCE-AND-VERIFICATION.md) · [Assessment comparison](ASSESSMENT-COMPARISON.md)

[Vision](#project-vision) · [Implemented capabilities](#what-the-prototype-can-already-do) ·
[Unproven work](#what-is-not-yet-implemented-or-proven) ·
[Control instructions](#using-the-control-instructions) ·
[Future architecture](#production-adoption-architecture) · [Roadmap](#suggested-product-roadmap)

This reference retains the detailed capability inventory separately from future
design ideas. Proposed integrations and roadmap stages are not release claims.
For collection mechanics, see the [runtime reference](COLLECTION-REFERENCE.md).

## Project vision

**Help a rollout owner move from assessment findings to an accountable,
evidence-supported pilot decision—and keep that decision current as the
environment changes.**

The ambition is a follow-through workflow around Microsoft's assessments and
other evidence sources, not a replacement collector. A mature Flight Deck would
help a team:

1. Define the users and scope of a pilot.
2. Connect relevant findings to rollout requirements and explain what is missing.
3. Route work to accountable people, track reviews and approvals, and distinguish
   tenant issues from limitations of the assessment itself.
4. Validate evidence of closure after an approved change, rather than treating
   a completed task or a successful collection as proof.
5. Revisit eligibility when evidence expires or the environment changes.

The question we want it to answer is:

> "Can this defined pilot proceed, what blocks it, who needs to act, and what
> evidence supports that decision?"

**This is the project vision, not a description of a complete capability
available today.** The current prototype implements parts of that workflow.

## What the prototype can already do

The local interface follows **Set up → Assessment → Corrections → Decision**.
These capabilities are implemented, with the boundaries shown below.

| Capability available now | What it does | Important boundary |
|---|---|---|
| Pilot selection | Searches Microsoft Entra for users/groups and saves the people you explicitly approve for the pilot, with a named owner | The saved list does not update automatically. Recent group changes may not appear immediately, and large or incomplete selections are rejected |
| App-managed collection | Signs in to Microsoft Graph and the Exchange, SharePoint, Purview and Power Platform administration services to read information | You must complete sign-in and approve appropriate read access. Reading information successfully does not mean a readiness check passed |
| Grouped sharing review | Groups related permission records, with 25 groups per page, up to 50 individual records when a group is opened, and separate CSV exports | Only a limited sample of top-level files and folders is read. It does not search every nested file or establish exactly who can access everything |
| What still needs to be checked | Shows decisions for you, help needed from an administrator, settings to review and checks this version cannot perform | A missing result may mean the app cannot check it—not that your settings are wrong. Suggested owners are not automatically assigned tasks |
| Local decisions and statements | Records pilot approval, whether on-premises Exchange applies, whether Copilot should use public web information, and supported owner statements | Recording a choice does not change a Microsoft setting. An owner name or local signature does not independently prove authority or confirm the setting |
| Persistent guided actions | Creates or resumes one saved action per control and exact tenant/cohort/catalogue context; preserves starting evidence, guidance, ownership records, dependencies, progress, hand-off drafts and history | Local records only: no authenticated approval, external assignment, notification or tenant write. Administrators act through their existing process |
| Action-linked verification | Rechecks reported completion against admissible, freshly collected evidence; reopens previous satisfaction on expiry, later failure/unknown or context changes | Three licensing contracts and one bounded Conditional Access baseline contract support technical verification; eleven support separately labelled owner statements. The other 62 remain unverified. Completion, a link or an imported CSV is not proof |
| Guided next step and pilot snapshot | Suggests the next supported action, expands the current work stage, offers no-JSON escalation/support statement forms and downloads a text decision snapshot containing all 77 requirements | Unsupported checks remain visible; the snapshot is not organisational approval, an authenticated assignment, a live customer outcome or continuous monitoring |
| Limited checks for rollout decisions | Checks that supported results describe the right organization and pilot users, are recent enough and contain the required facts | Implemented for four automated checks and eleven types of owner statement—not all 77 checks |
| Reassessment and comparison | Lets you run another collection and compare saved sharing results; information that has become too old no longer satisfies a check when reevaluated | It does not continuously monitor Microsoft 365. A comparison of sampled sharing records does not prove that every proposed change was completed |
| Microsoft report imports | Accepts Microsoft readiness reports and recognizes a small set of recommendations from the automated assessment CSV | Nine exact check names from the supported Microsoft assessment version map to three Flight Deck checks. Other rows or versions are retained for review, not automatically interpreted |

### What has been demonstrated

Synthetic integration and browser exercises cover directory selection and
approval, local decisions, cancellation, evidence handling and expiry behavior.
The guided-action regression suite uses only isolated synthetic tenants and
offline adapters, including restart persistence, conflict handling, manual
hand-off and post-completion checks.
The grouped review has also been exercised against a saved tenant assessment.
These are useful checks of implementation, **not proof of a complete real-tenant
pilot-to-rollout lifecycle**.

## What is not yet implemented or proven

Flight Deck has **77 application-defined controls across 13 organizing domains**.
This is a policy catalogue, not 77 fully validated automated checks or a claim
of broader coverage than Microsoft's differently grouped service areas.

**Not yet implemented:** the rules needed to confirm the remaining
**62 checks** from collected information; an operational task-assignment, reminder and approval system;
continuous change monitoring and automatic follow-up; and a production-scale,
complete effective-access collection service. Flight Deck also does not
automatically launch Microsoft's assessment or correlate its entire output.

**Not yet proven:** an end-to-end live-tenant trial of directory selection and
approval, a real pilot progressing through the complete rollout lifecycle,
and measurable savings in coordination effort. Passing synthetic exercises or
displaying mission gates does not establish those outcomes.

Do not use this version to approve an estate-wide production rollout.

## Implemented prototype components

These components support the project vision within the limits described above.
Their presence does not establish a complete operational rollout workflow.

| AI Flight Deck capability | What it offers |
|---|---|
| Results from multiple sources | Keeps Microsoft reports, Graph reads, administration-service reads and owner statements together, with their sources visible |
| Approved pilot user list | Searches Microsoft Entra users or groups and saves an explicitly approved list with an accountable owner; no CSV is required |
| 13 topics and 77 checks | Organizes results across licensing, identity, devices, network, service health, Exchange, Teams, SharePoint/OneDrive, Purview, security, Copilot settings, Power Platform/agents and adoption |
| Reasons a check is unfinished | Preserves the actual error. The cause may be permissions, unsupported software or a missing feature in this app |
| What still needs to be checked | Shows **Decisions for you**, **Help needed from an administrator**, **Settings to review** and **Checks this version cannot perform**, with five items initially shown per category and links to the relevant form or instructions |
| Mission gates | Shows whether activation, safe pilot, scale, and assurance missions can advance and identifies the exact blocking controls |
| Readiness-impact traces | Connects evidence source to control, affected mission, decision impact, and required correction when a full access graph is unavailable |
| SharePoint access and sharing review | Converts public SharePoint sites and sampled Anyone or organization-wide sharing links into named, evidence-backed validation scenarios with bounded audience estimates, explicit limitations, and administrator actions |
| Tenant-wide enablement plan | Computes a recommendation under custom policy and lists suggested accountable roles, administration paths, checklists, acceptance criteria and Microsoft references. Missing validation contracts prevent an estate-wide approval |
| Evidence-bound corrections | Saves guided actions with frozen evidence/context, progress, local responsibility/approval records, manual hand-off and completion history; separately checks new supported evidence. Optional administrator review packages remain available |
| Bounded before-and-after comparison | Compares collected sharing baselines and verification results. This does not prove remediation across all 77 controls |
| Provenance and freshness | Retains source artifact hashes, report dates, collector identity, evidence limitations, and conflicts between imported and live evidence |
| Detailed exports | Exports the complete control-level assessment and correction context for review outside the application |

In one sentence: **Flight Deck implements parts of a pilot evidence-and-decision
workspace; the complete follow-through workflow is the vision still to prove.**

### Using the control instructions

**What still needs to be checked** separates four different situations:

- **Decisions for you:** choices the app cannot make for your organization, such
  as who joins the pilot or whether Copilot may use public web information.
- **Help needed from an administrator:** a Microsoft service could not be read,
  for example because sign-in, a required role or a licence is missing. Review
  the actual error with that service's administrator.
- **Settings to review:** the scan returned information suggesting a setting
  needs attention. An administrator should inspect it before deciding to change it.
- **Checks this version cannot perform:** the app lacks the connection or
  verification needed. Repeated sign-ins or changes to Microsoft settings will
  not add that missing app feature.

These are different next steps. “Not checked” by itself does not tell you that a
setting is wrong.

Select **View required action** or **View control definition** on a Set up item to open and
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
that input. The app now launches authenticated workload collectors and ingests
their results itself; operators do not assemble export packages. Owner approvals
and local package seals still do not prove effective permissions or complete
workload coverage.

Administrator packages retain their version 1.0.0 contract. The consumer accepts
command-only entries produced by the shipped script only when the command has
one purpose in that workload's query plan. Exact entries and exact errors take
precedence. Multi-purpose commands such as `Get-SPOSite`,
`Get-SPODataAccessGovernanceInsight` and `Get-AutoSensitivityLabelPolicy` still
require the purpose-specific key. Collection requests now carry the scan tenant
ID into package validation.

## See the product before installing

[Read how to use each page](VISUAL-TOUR.md) for screenshots and practical
instructions: what each page does, how to use its controls, what the results
mean and what to do next. For service sign-ins, collected information, limits
and error explanations, use the [connection guide](COLLECTOR-GUIDE.md).

[![AI Flight Deck: what still needs to be checked](screenshots/02-setup-evidence-center.png)](VISUAL-TOUR.md)

All 16 tour screenshots were captured on **11 September 2026**, including
the saved-action workflow, supported verification and manual hand-off. They use explicitly labelled
synthetic examples, not real tenant data, so you can see the product before
connecting your organization.

## Product workflow

The product is organized around four customer tasks:

1. **Set up** - Review permissions and boundaries, run the read-only baseline,
   import Microsoft evidence, and approve a named pilot cohort.
2. **Assessment** - Review domain coverage, evidence gaps, the sharing posture
   signal, and evidence-backed findings.
3. **Corrections** - Save guided work and manual hand-off, report completion,
   and check fresh supported evidence. Optional review packages and forecasts
   remain planning aids; none authenticate approval or prove a tenant change.
4. **Decision** - Re-scan and verify sharing corrections independently from
   the estate-wide decision. `SharingControlsVerified` never means Copilot
   rollout is approved.

Synthetic scenarios remain available to explain permission-path risk. They are
not represented as live tenant evidence.

The prototype includes three synthetic scenarios:

- Confidential acquisition information exposed through broad site inheritance.
- Employee compensation data exposed through stale group membership.
- A procurement agent receiving excessive Finance access.

## Questions the product aims to answer

The envisioned workflow aims to answer the following questions. Synthetic
scenarios and bounded sharing review illustrate parts of them; the current
collectors do not establish complete tenant-wide answers:

- What could AI retrieve?
- Which users or agents could retrieve it?
- Why is it reachable?
- What is the business impact?
- Which control closes the path?
- What would readiness look like after remediation?

## Production adoption architecture

The local prototype has implemented collectors, but the production architecture
below is a future design, not the current deployment or an existing Azure service.
A production implementation should introduce these layers:

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

## Suggested product roadmap

These are suggested stages, not completed milestones. Some ideas now have bounded
implementations described above; that does not establish completion of a stage.
Scheduled rescans, operational approvals and continuous monitoring remain planned.

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
