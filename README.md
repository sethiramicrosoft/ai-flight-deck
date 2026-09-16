# AI Flight Deck

**A prototype for turning Copilot readiness findings into scoped actions,
fresh evidence and a clearer pilot decision. Built for Microsoft 365 Copilot.**

Coordinate a pilot's unfinished checks and next steps in one local workspace.
Flight Deck supports the decision; it does not grant rollout clearance.

[Watch the demo](#demo) · [Try it](#try-it) · [Read the guides](#guides)

## Why AI Flight Deck?

After assessment: “For this pilot, what blocks us, who needs to act,
and what evidence supports the next decision?”

Microsoft already provides automated checks, recommendations and repeatable
reports. Flight Deck adds scoped follow-through: pilot membership, guided work
and supported verification—not superior collection or greater authority.

If automated checks are all you need, start with
[Microsoft's assessment](https://github.com/microsoft/m365-copilot-automated-readiness-assessment).
Your existing tracker may be simpler; coordination savings remain unproven.
[Read the sourced comparison and trade-offs](docs/ASSESSMENT-COMPARISON.md).

## Demo

### Latest video: V11

<video controls src="https://github.com/user-attachments/assets/09df481b-4e0b-4d4b-8bb6-af571d2aecba" title="AI Flight Deck Demo V11 (~114 seconds)"></video>

[Download the V11 video](docs/demo/AIFlightDeckDemoV11.mp4)
([captions](docs/demo/AIFlightDeckCaptionsV11.srt)).

In ~114 seconds: the 3D domain map, setup boundaries, guided actions,
evidence re-checks and a pilot decision snapshot.

Actual application screens, isolated synthetic data—not a live customer
deployment. No live Microsoft sign-in or tenant changes are demonstrated.
Repository access is required while this repository is private.
Earlier demo versions remain in `docs/demo`.

## How it works

1. **Connect** — sign in for read-only collection;
   select and explicitly approve pilot users.
2. **Understand** — see findings, missing evidence and checks the app cannot
   perform. “Unknown” does not necessarily mean your tenant is misconfigured.
3. **Act** — save guided work and a manual hand-off.
   Administrators make approved changes through their existing process.
4. **Verify** — collect fresh evidence and check supported results.
   Task completion or an imported report is not proof of a corrected setting.
5. **Decide** — review remaining blockers and download the pilot snapshot.
   The accountable owner makes the real decision.

The interface follows **Set up → Assessment → Corrections → Decision**.
[Explore each page with screenshots](docs/VISUAL-TOUR.md).

## What the prototype can already do

- **Keep a pilot in scope:** save users/groups, an owner and local decisions
  without changing Microsoft settings.
- **Bring evidence together:** read Graph and four administration services;
  add Microsoft reports and supported owner statements.
- **Make gaps understandable:** group sampled sharing records, explain
  unfinished checks and show control-specific administrator instructions.
- **Keep work across sessions:** resume actions, track dependencies,
  record progress and prepare hand-offs.
- **Check and explain progress:** reevaluate supported evidence, reopen stale
  or unsatisfied work, compare sharing scans and export all
  77 requirements in a pilot decision snapshot.

[Full capability inventory and what has been demonstrated](docs/ARCHITECTURE-AND-ROADMAP.md#what-the-prototype-can-already-do)
· [Walk through a guided action](docs/ACTION-WORKFLOW.md).

<a id="evidence-authority-and-supported-boundaries"></a>
## Know the boundaries

The catalogue contains **77 application-defined controls across 13 domains**,
not 77 validated automated checks or a Microsoft certification.

| Evidence supported today | Boundary |
|---|---|
| **4 technical checks** | Three licensing contracts and one bounded Conditional Access configuration contract |
| **11 owner-statement checks** | Required facts, references and local integrity—not independent proof of settings or approval authority |
| **62 unsupported verification checks** | Findings and guided work remain available, but completion cannot make them verified |

No automatic remediation, external task assignment, authenticated approval
or continuous monitoring. Sampled sharing is not complete access analysis;
local signatures do not establish source truth.

Synthetic exercises do not prove a real-tenant rollout lifecycle or savings.
**Do not use this version to approve an
estate-wide production rollout.**

[Exact supported contracts, freshness and verification rules](docs/EVIDENCE-AND-VERIFICATION.md).

<a id="quick-start-for-returning-users"></a>
## Try it

Already set up? Run from PowerShell in the repository folder:

```powershell
.\Start-AI-Flight-Deck.cmd
```

Keep the launcher open. The local service opens at
`http://127.0.0.1:8080/index.html`; choose **Connect and scan tenant** in Set up.
Do not use a generic static server for integrated scanning.

<a id="install-ai-flight-deck-on-a-windows-computer"></a>
First time? Follow the [Windows installation guide](docs/INSTALLATION.md):
extract the repository and run `SETUP-AI-Flight-Deck.cmd`.
Windows and Node.js 18 or later are required; no `npm install`, Azure hosting
or database. Setup asks before installing prerequisites.
Use an approved test account and
[review permissions first](docs/PERMISSIONS-AND-SECURITY.md).

<a id="documentation"></a>
## Guides

| I want to… | Start here |
|---|---|
| Understand the screens | [Visual tour](docs/VISUAL-TOUR.md) |
| Install, sign in, restart or troubleshoot | [Installation](docs/INSTALLATION.md) |
| Review requested access and local data handling | [Permissions and security](docs/PERMISSIONS-AND-SECURITY.md) |
| Know what each Microsoft service reads and misses | [13-domain connection guide](docs/COLLECTOR-GUIDE.md) |
| Work through a correction and hand-off | [Guided action workflow](docs/ACTION-WORKFLOW.md) |
| Inspect proof rules, imports and scan comparisons | [Evidence and verification](docs/EVIDENCE-AND-VERIFICATION.md) |
| Inspect collection limits and runtime contracts | [Collection implementation reference](docs/COLLECTION-REFERENCE.md) |
| Separate implemented capabilities from future plans | [Architecture and roadmap](docs/ARCHITECTURE-AND-ROADMAP.md) |
| Compare approaches and inspect Microsoft sources | [Assessment comparison](docs/ASSESSMENT-COMPARISON.md) |

<a id="delegated-permissions-requested-by-the-live-scanner"></a>
<a id="admission-freshness-and-reader-parity"></a>
<a id="how-the-sharepoint-access-and-sharing-review-works"></a>
<a id="project-vision"></a>
Legacy reference links:
[Graph scopes](docs/PERMISSIONS-AND-SECURITY.md#delegated-permissions-requested-by-the-live-scanner) ·
[Evidence admission](docs/EVIDENCE-AND-VERIFICATION.md#admission-freshness-and-reader-parity) ·
[Sharing review](docs/EVIDENCE-AND-VERIFICATION.md#how-the-sharepoint-access-and-sharing-review-works) ·
[Project vision](docs/ARCHITECTURE-AND-ROADMAP.md#project-vision).

## Credits and sources

Independent hackathon prototype—not a Microsoft product or service.
Built on the Microsoft 365 Copilot Readiness report, Microsoft's open-source
automated readiness assessment, Microsoft Graph and Microsoft Learn.
[Acknowledgements and licensing](ACKNOWLEDGEMENTS.md) ·
[Documented source revision and import limits](docs/ASSESSMENT-COMPARISON.md#relationship-to-microsofts-open-source-readiness-accelerator).
