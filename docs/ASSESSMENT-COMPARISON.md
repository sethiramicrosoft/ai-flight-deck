# Assessment comparison and Microsoft sources

[README](../README.md) · [Architecture and roadmap](ARCHITECTURE-AND-ROADMAP.md) ·
[Report import guide](EVIDENCE-AND-VERIFICATION.md#combine-microsoft-evidence) ·
[Acknowledgements](../ACKNOWLEDGEMENTS.md)

[Workflow comparison](#why-use-this-if-microsoft-already-has-an-automated-readiness-assessment) ·
[DLP example](#example-a-data-loss-prevention-concern) ·
[Microsoft resources](#microsoft-tools-used-and-credited) ·
[Import revision](#relationship-to-microsofts-open-source-readiness-accelerator)

Source scope: this preserves the comparison documented in this repository before
the README reorganization on **16 September 2026**. No new live source review was
performed for that reorganization; the earlier review date is not recorded here.
Claims below refer to the pinned source revision, not the latest upstream release.

## Why use this if Microsoft already has an automated readiness assessment?

**If you only need automated tenant checks and recommendations, start with
[Microsoft's assessment](https://github.com/microsoft/m365-copilot-automated-readiness-assessment).
Flight Deck is not required for that job.**

Microsoft already provides automated collection, prioritized recommendations,
CSV/Excel reports and repeatable assessments with timestamped outputs.
Flight Deck adds a **local guided follow-through workflow**; operational
assignment and authenticated approval remain vision, not implemented services.
This is not superior collection or greater authority.

| Area | Microsoft's documented workflow | Flight Deck's implemented addition |
|---|---|---|
| Scope | Select a tenant and service areas to assess | Save a named, approved pilot membership snapshot |
| Findings | Report feature status, priority, observations and recommendations | Organize findings and app limitations within a custom control/mission interface |
| Evidence | Produce timestamped reports and support reassessment | Apply tenant/cohort binding, local integrity and expiry rules to supported evidence contracts |
| Review | Inspect assessment outputs | Browse grouped sharing evidence, record local owner decisions and prepare correction context |
| Decision | Provide readiness observations and recommendations to stakeholders | Calculate eligibility under Flight Deck's custom policy, with unsupported proof kept unresolved |

This does **not** mean Flight Deck already provides the envisioned operational
workflow end to end. Its current value is a workspace for evaluating that
approach, and for reviewing bounded evidence with its limitations visible.
If that does not improve the team's work, Microsoft's assessment with an
existing tracker is the simpler choice.

**Practical alternative (inferred trade-off, not a measured product result):**
keep the assessment's reports and use your existing tracker for owners, due
dates and review references. This may avoid a second local workspace and its
maintenance. Flight Deck instead brings pilot context and bounded evidence
checks alongside saved actions; it still leaves external assignment and
authenticated approval to your existing process. Neither comparison establishes
measurable coordination savings.

Other experiences, including Analytics Hub, are comparison candidates only:
their current capabilities were not reviewed for this document. No absence of
features or superiority over those products is established here.

This repository also contains its own authenticated collectors. That overlaps
with Microsoft's collection work and creates maintenance cost; it is not the
differentiator. The direction is to reuse Microsoft's evidence and collection
capabilities where practical, while developing and proving the additional
workflow.

Sources: upstream [README](https://github.com/microsoft/m365-copilot-automated-readiness-assessment/blob/f542406ffba2066d943643de8d7a87b755b98cab/README.md)
and [run guide](https://github.com/microsoft/m365-copilot-automated-readiness-assessment/blob/f542406ffba2066d943643de8d7a87b755b98cab/RUN.md)
at Flight Deck's supported import revision `f542406ffba2066d943643de8d7a87b755b98cab`.
This compares documented workflows, not an exhaustive claim that an upstream
feature is absent. The revision is an integration reference, not a claim about
the latest upstream HEAD.

### Example: a data-loss prevention concern

**Today:** Flight Deck can keep a recognized data-loss prevention (DLP) finding,
link it to a check and suggest which administrator should review it. This version
cannot independently verify the DLP setting, so it cannot mark that rollout
requirement as satisfied.

**In the envisioned workflow:** the concern would move through an assigned
owner's investigation, an approved change, fresh source evidence and validated
closure, with the pilot decision updated accordingly. That complete sequence
remains work to build and demonstrate.

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
[`ACKNOWLEDGEMENTS.md`](../ACKNOWLEDGEMENTS.md) for attribution and integration
details.

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

At that revision, **nine exact check names map to only three controls**:
`AFD-PPA-001`, `AFD-SEC-005` and `AFD-COPILOT-003`. Other names/revisions remain
available for review without automatic interpretation. These mappings retain
findings; the app cannot yet verify any of those three checks sufficiently to
mark them Pass for a rollout decision. Flight Deck does not launch the upstream
assessment. See [import boundaries](COLLECTOR-GUIDE.md#microsoft-report-imports-are-another-source-not-a-connector-launch)
and the [project vision](ARCHITECTURE-AND-ROADMAP.md#project-vision) rather than treating comparable domain
names as equivalent collection or proof.

Capability ideas can be implemented independently from public documentation and
supported APIs. If source code from the Microsoft repository is copied or
adapted, the Microsoft copyright notice and MIT permission notice must be
retained in the copied or substantial portions as required by that license.
