# UX/UI researcher — AI Flight Deck: value realization journey

> Pinned model: `claude-opus-4.7`. Confirmed active on this run.
> Scope: end-to-end customer journey so a M365 admin + Copilot program owner leave the product knowing exactly what is required to safely enable Microsoft 365 Copilot across the tenant and applications, with authoritative implementation guidance.
> Non-goal: no code, no CSS, no diff. This is a wireframe-level spec a developer and `ux-critic` can argue with.

---

## Users

Two co-primary users. This is not a single-persona product and pretending it is (which today's UI does) is part of the value-realization problem.

- **Priya — Microsoft 365 Administrator**
  - Context: Windows admin workstation, Edge, uses admin.microsoft.com, entra.microsoft.com, security.microsoft.com and admin.teams.microsoft.com every day. Time-pressed. Wants a numbered to-do list scoped to *her* portal, not a 77-row spreadsheet.
  - Reads: control ID, portal, admin path, exact steps, acceptance criterion, Microsoft Learn link.
  - Ignores: mission taxonomy, evidence provenance, cohort semantics unless they change what she clicks.

- **Sam — Copilot Program Owner / M365 Service Owner**
  - Context: PM / architect. Runs a weekly readiness standup. Presents to security, compliance, and business sponsors.
  - Reads: "Can we launch?" (yes / conditions / no), the 3–5 things blocking the next mission gate, who owns each, target date, and the risk of proceeding without them.
  - Ignores: exact PowerShell strings, individual acceptance criteria wording.

Secondary but present in the journey: **Security/compliance reviewer** (Purview, Defender, Entra IdP owner) and **site/data owners** (SharePoint, Teams). Today they only exist as bullet points on the Set up page; the journey never actually hands work to them.

## Jobs-to-be-done (in their own words)

- Priya: *"Tell me the next five things I have to click, in the order I should click them, without making me read a 77-row table."*
- Sam: *"Tell me if I can launch the pilot next Tuesday. If not, tell me what's blocking it, who's fixing it, and when it'll be unblocked — in one screen I can screenshot into the standup deck."*
- Security reviewer: *"Show me only the identity, Purview, Defender, and Copilot-config gates and let me sign off on the ones that are done."*
- Site/data owner: *"Someone told me a SharePoint site is a blocker. Show me what to change on the site and how to prove it's fixed."*

Frequency: Priya opens the product 3–5x/week during activation, then weekly during safe pilot and scale. Sam opens it 1–2x/week and every time a stakeholder asks "are we ready?" Reviewers open it on demand — usually because Sam sent them a link.

## Riskiest assumption

**"77 controls presented as a scannable inventory is the artifact customers need."** It is not. Customers need a *plan* — a small, ordered, owner-bound worklist that produces a decision. The 77-control inventory is the evidence store *behind* the plan, not the plan itself.

Cheapest falsification: put five program owners in front of the current Decision page for 90 seconds and ask "what would you do first thing tomorrow morning?" If more than one cannot name the same next step, the inventory is failing as UI, regardless of how correct it is as data.

Secondary risky assumption: **"Unknown is neutral."** In the current UI, `Unknown` is rendered like a fifth colour on a status wheel. In the customer's head it reads as "the tool doesn't work" or "we skipped something." `Unknown` must be re-typed as one of two very different things — *evidence-not-yet-collected* (do this to fix it: connect a workload) or *evidence-not-collectable-here* (do this to fix it: attest via signed statement or approve NotApplicable). Today's UI collapses those two into one word and the customer stalls.

## Existing patterns to reuse

Do not invent. Reach for patterns customers already know from Microsoft's own admin surfaces and adjacent products, and from the app's own catalog.

- **Microsoft 365 Admin Center "Setup" / Copilot page (`admin.microsoft.com` → Copilot → Setup).** Task-list pattern with owner, status pill, "Get started" button per row, and rollup progress bar. This is the shape Priya expects.
- **Microsoft Secure Score.** "Improvement action" cards ranked by impact, each with points, category, status (To address / Planned / Risk accepted / Completed / Resolved through third party), and a linked action. Two things AI Flight Deck should copy verbatim: the *ranked queue* and the *risk-accepted / third-party-resolved* states (mapping cleanly to today's `approvedNotApplicable`).
- **Microsoft Entra "recommendations" blade.** Recommendation → why it matters → affected resources → step-by-step remediation → mark as dismissed / postpone. Same shape works for the 77 controls.
- **GitHub Advanced Security "Code scanning" alerts view.** Filter chips (severity, owner, status), grouped rows collapsed by rule, click-through to the specific finding with a "fix suggestion." AI Flight Deck's Findings page is already close to this; extend to Controls.
- **AI Flight Deck's own `mission-engine.js` + `enablement-playbook.js`.** The primitives are already correct: missions gate the estate, `classify()` already returns `Complete / Action required / Evidence required / Owner review`, and `controlPlaybook()` already emits portal + path + ordered steps + acceptance + Microsoft source per control. **The information architecture is already there — the UI is not yet exposing it as the primary artifact.** Every recommendation below is "surface the primitive that already exists, don't build a new one."

## Journey overview — the five moments

The customer journey should be five moments, not four pages. Today's nav (`Set up → Assessment → Corrections → Decision`) is a *product architecture*. The five moments are the *user's job*. The current pages can host them with reordering and one new page, not a rewrite.

1. **Moment 1 — "Where do I stand?"** (30 seconds after opening the app)
2. **Moment 2 — "What has to happen next, in order, and who owns it?"** (the actionable plan)
3. **Moment 3 — "I am Priya. Just show me my clicks."** (owner-scoped worklist)
4. **Moment 4 — "Prove the fix worked."** (verify loop, per unblock, not per full re-scan)
5. **Moment 5 — "Can we launch on the pilot cohort? Sign it off."** (decision + signed record)

Each moment gets a dedicated screen recommendation below.

---

## Moment 1 — The first-screen answer

### Primary flow

1. User opens the app (or clicks the top-nav home).
2. In one card, they see one sentence: **"Can Contoso Aviation activate Copilot for the *Pilot A* cohort today? — No, 4 blockers. Safe pilot: also No, 11 blockers."**
3. Below that, four mission chips (Activation / Safe pilot / Scale / Assure) each showing `Ready | X blockers | Y evidence gaps`, colour-coded, click-through to Moment 2.
4. Three tertiary numbers only: `Evidence freshness (h)`, `Cohort resolved (users)`, `Last scan (ago)`. Nothing else above the fold.

The current Assessment page opens with "Sharing posture signal 64" as its primary metric. That is a legacy holdover from an earlier product scope and it **actively misleads** — the customer reads "64/100, we're doing pretty well" when the honest answer is "0/13 systems fully evidenced, we cannot decide." Sharing signal must be demoted to a domain-level detail.

### Wireframe (text)

```
+---------------------------------------------------------------------------+
| CONTOSO AVIATION — Copilot readiness                    [Rescan]  [Export]|
+---------------------------------------------------------------------------+
|                                                                           |
|  Can we activate Copilot for Pilot A?    ***NO — 4 blockers***            |
|  Safe pilot for Pilot A?                 ***NO — 11 blockers***           |
|  Evidence is 3h old. 42/50 pilot users resolved in Entra.                 |
|                                                                           |
|  [ See the 4 activation blockers  ->  ]                                   |
|                                                                           |
+---------------------------------------------------------------------------+
| MISSION GATES                                                             |
| +--------------+ +--------------+ +--------------+ +--------------+       |
| | 01 ACTIVATE  | | 02 SAFE PIL. | | 03 SCALE     | | 04 ASSURE    |       |
| | 4 blockers   | | 11 blockers  | | 24 blockers  | | monitoring   |       |
| | 3 evidence   | | 8 evidence   | | 14 evidence  | | not started  |       |
| | gaps         | | gaps         | | gaps         | |              |       |
| | [Open plan]  | | [Open plan]  | | [Open plan]  | | [Open plan]  |       |
| +--------------+ +--------------+ +--------------+ +--------------+       |
+---------------------------------------------------------------------------+
| BLOCKING NOW  (top of Moment 2, pinned)                                   |
|  01. AFD-IAM-001  MFA CA policy   Priya (M365 admin)      [Do it >]       |
|  02. AFD-LIC-002  Assign licences Priya (M365 admin)      [Do it >]       |
|  03. AFD-SPO-001  Ext sharing     Rob (SP admin)          [Assign >]      |
|  04. AFD-PURV-004 Audit on        Meera (Compliance)      [Assign >]      |
|                                                                           |
|                                            [See all 15 activation items > |
+---------------------------------------------------------------------------+
```

### Why this shape

- The **first sentence answers the JTBD** ("can we launch?") in plain English before any chart, colour, or number. Sam can screenshot this row into a deck.
- The four mission chips are the correct *taxonomy for progression*. They already exist in `mission-engine.js` and are already computed. The current UI hides them inside a 3D control plane that is beautiful but does not answer the question.
- Blocking-now is a **maximum-4 preview** of the true plan (Moment 2). Anything more turns the home page back into an inventory.

### Rejected alternatives

- **A single readiness percentage** ("You are 63% ready"). Rejected — every honest reading of this product's own evidence semantics (Unknown ≠ Fail, gate ≠ advisory, cohort scoping) makes a single percent a lie. Reference: Secure Score deliberately does not give one overall percent for compliance; it gives a *score* that is explicitly not a compliance grade.
- **Keep the 3D "control plane" as the hero.** Rejected — it is a *diagnostic* visualization, not a *decision* visualization. Move it to Moment 2 as an optional inspection view. The customer's first question is "can we go?", not "show me the estate as a constellation."
- **Show the 13-system donut chart first.** Rejected — 0/13 fully evidenced tells the customer nothing about what to do next; it just makes them feel worse.

---

## Moment 2 — The prioritized plan (this replaces the 77-row list as the primary artifact)

### Primary flow

1. From Moment 1 the user clicks a mission chip (default: the next unsatisfied mission — usually `Activation`).
2. Screen opens on the **ordered plan for that mission**: a numbered queue of only the items required to satisfy *that* gate for *that* cohort. Not 77. Typically 15–25.
3. Each row expands in place to reveal the full playbook already produced by `controlPlaybook()`. No page navigation to see steps.
4. Filter chips at the top: `Owner` (M365 admin, Entra admin, SP admin, Compliance, Copilot program), `Effort` (< 15 min / < 1 hr / half-day / multi-day), `Blocker type` (Evidence required, Action required, Owner review), `Domain` (13 domains). Chips are additive.
5. Each row has three affordances: **Do it** (open playbook + portal deep link), **Assign** (send to owner — Moment 3), **Defer** (approve NotApplicable OR risk-accept, both requiring an owner name + expiry — reuse the existing `approvedNotApplicable` machinery).

### Prioritization model

The queue is not sorted by control ID. It is sorted by a **deterministic 4-key sort** the customer can predict:

1. **Requirement × Mission**: `Gate` for the current mission first, `Gate` for a later mission second, `Advisory` last.
2. **Evidence gap vs action gap**: within the same tier, `Evidence required` before `Action required` before `Owner review`. Rationale: you cannot decide on an action until you have the evidence, so unblocking the collector unlocks the largest downstream fan-out.
3. **Owner concentration**: within the same tier, group by owner (Priya's rows adjacent, Rob's rows adjacent). This is the Priya-JTBD "let me do all my Entra clicks in one session."
4. **Estimated effort ascending**: within an owner, shortest actions first — the "wins-in-under-an-hour" tier. This is the Sam-JTBD "get me to the standup with visible progress."

Effort is an *estimate* — persona lesson: never render an estimate as if it were a measurement. Show it as a coarse band (`<15m / <1h / half-day / multi-day`), never as a minute count, and hollow-mark it when the value is inferred rather than known.

The pre-existing `classify()` in `enablement-playbook.js` already yields the four buckets `Complete / Action required / Evidence required / Owner review`. The pre-existing `evaluateMissions()` already tells you which controls block which mission for which cohort. **The sort above is a pure function of already-computed fields.** No schema change required. No new persona to loop in — just an ordering.

### Progressive disclosure

Three levels:

- **Level 0 — Row** (always visible in queue): control ID, one-line title, owner chip, effort band, status pill (`Evidence required` / `Action required` / `Complete` / `Deferred`), one primary button (`Do it` / `Assign` / `Review`).
- **Level 1 — Row expanded in place** (one click): why it matters (1 sentence from `whyItMatters`), acceptance criterion, portal + admin path + deep link, prerequisites, and the ordered 6 steps from `controlPlaybook()`. Microsoft Learn link is a right-anchored button, not buried at the bottom.
- **Level 2 — Full-screen playbook** (only if the row expansion is not enough): the entire `controlPlaybook()` payload including current evidence, freshness, evidence refs, source. This is the developer-and-auditor view, not the daily-driver view.

The 3D "control plane" visualization becomes a *Level-2* inspection view accessible from any row's "Show me this control on the estate map" — useful, not primary.

### Wireframe (text)

```
+---------------------------------------------------------------------------+
| ACTIVATION plan — Pilot A (50 users)     4 blockers | 3 evidence gaps    |
+---------------------------------------------------------------------------+
| Owner: [All] [M365 admin] [Entra] [SP] [Purview] [Defender] [Program]     |
| Effort: [<15m] [<1h] [half-day] [multi-day]                               |
| Type:   [Evidence] [Action] [Review] [Deferred] [Complete]                |
+---------------------------------------------------------------------------+
|  1. AFD-IAM-001  Require MFA via Conditional Access                       |
|     [M365 admin] [<1h] [Action required — Gate]           [Do it >]       |
|  ---- expanded -------------------------------------------------------    |
|  Why: every Copilot user must MFA. Currently 12 pilot users uncovered.    |
|  Acceptance: enabled CA policy targets pilot group with MFA grant.        |
|  Portal:  Microsoft Entra admin center                                    |
|  Path:    Protection > Conditional Access > Policies                      |
|  Steps:   1. Confirm scope: Pilot A cohort (50 users).                    |
|           2. Review 12 uncovered users listed in evidence.                |
|           3. Open portal (link) > Policies > New policy...                |
|           4. Apply grant: Require MFA.                                    |
|           5. Validate: sign-in log shows MFA challenge for 12 users.      |
|           6. Rescan within 24h to refresh evidence.                       |
|  [Open Entra portal ↗]  [Microsoft Learn: CA MFA ↗]  [Assign to owner]    |
|  -----------------------------------------------------------------------  |
|                                                                           |
|  2. AFD-LIC-002  Assign Copilot licences to pilot cohort                  |
|     [M365 admin] [<15m] [Action required — Gate]          [Do it >]       |
|                                                                           |
|  3. AFD-SPO-001  Set org-wide external sharing to New+Existing guests     |
|     [SP admin]   [half-day] [Action required — Gate]      [Assign >]      |
|                                                                           |
|  4. AFD-PURV-004 Enable Purview Audit (Standard/Premium)                  |
|     [Compliance][<1h] [Evidence required — Gate]          [Assign >]      |
|                                                                           |
|  5. AFD-COPILOT-001  Configure Copilot tenant settings                    |
|     [Program]   [half-day] [Owner review — Gate]          [Review >]      |
|                                                                           |
|  ...11 more activation items (advisory & later missions collapsed)        |
|  [Show 62 items required for Safe pilot / Scale / Assure]                 |
+---------------------------------------------------------------------------+
```

### Wireframe — expanded row is the whole product

The persona lesson from parent-progression-radar applies here in reverse: **the row expansion IS the primary artifact**, not a stepping-stone. If it is not enough for Priya to complete the click-path, we have failed. This is why steps must be the fully-materialized `controlPlaybook().steps`, not a summarized version. Do not paraphrase Microsoft's guidance — link it.

### Rejected alternatives

- **Keep the flat 77-row list on the Decision page, add filter dropdowns.** Rejected — the filter dropdown already exists (`enablement-filter` in `index.html`) and the current UI still overwhelms. Filtering a 77-row list into a 24-row list is still a list, not a plan. The prioritization *ordering* is what turns a list into a plan.
- **Kanban board (`To do / Doing / Done`).** Rejected — Kanban implies parallelism, but activation gates are largely serial and owner-bound. It also loses the mission taxonomy. Secure Score's ranked queue is the right shape.
- **Wizard ("click Next through 77 controls")**. Rejected — wizards remove the customer's ability to work in owner batches (Priya's JTBD).
- **AI-suggested "recommended next 3."** Rejected as a v1 — this is a *deterministic* domain (mission gates are set-theoretic, cohort membership is a Graph query). A deterministic sort the customer can predict beats a probabilistic one the customer cannot audit. Reintroduce later only if telemetry shows the deterministic sort mismatches what customers actually do next.

---

## Moment 3 — Owner handoff (Priya's screen, Rob's screen, Meera's screen)

Today the product implicitly assumes one person operates it end-to-end. That is false. The 13 domains map to at least 5 owner roles. If the product cannot hand a *scoped* worklist to each of them, the program owner (Sam) ends up manually copy-pasting into email — which is exactly the failure mode the value-realization brief calls out.

### Primary flow

1. From Moment 2 the user selects one or more rows and clicks **Assign**.
2. A modal collects: owner (name + role, defaulting to the row's `responsibleRoles[0]`), target date, message, and delivery channel (email / Teams / copy link).
3. The product produces a **shareable owner-scoped view** — a URL that opens the product in a filtered state showing *only that owner's assigned rows*, with the same expand-in-place playbook.
4. The assignment writes a row into an evidence-log entry (`decision evidence trail` already exists) so the record of who was asked, when, and for what is preserved.
5. When the owner opens the URL: they see the same Moment 2 screen filtered to their rows, with a "Mark done — evidence attached" affordance on each row that requires either (a) a re-scan that turns the control `Complete`, or (b) a signed attestation upload for human-evidence controls, or (c) an owner-approved `NotApplicable` with expiry — reusing `approvedNotApplicable`.

Nothing outbound is auto-sent. Every assign action shows the full draft (recipient, message, control list) and requires an explicit send. (This matches the Additional Hard Boundaries in the operator's AGENTS.md — "never send without explicit ask" — and the persona's rule that we surface the mechanism to a critic.)

### Wireframe (text)

```
+---------------------------------------------------------------------------+
| ASSIGN 3 CONTROLS                                                     [X] |
+---------------------------------------------------------------------------+
| Rows selected: AFD-SPO-001, AFD-SPO-002, AFD-SPO-003                      |
|                                                                           |
| Owner:   [ Rob Chen                              ]  [Directory ↗]         |
| Role:    [ SharePoint administrator              v]                       |
| Target:  [ 2026-09-14 ]                                                   |
| Channel: (o) Email    ( ) Teams    ( ) Copy link only                     |
|                                                                           |
| Draft message (editable):                                                 |
| +---------------------------------------------------------------------+   |
| | Hi Rob,                                                             |   |
| |                                                                     |   |
| | Three SharePoint external-sharing controls are blocking the         |   |
| | Copilot pilot activation for Pilot A. They should take under half   |   |
| | a day.                                                              |   |
| |                                                                     |   |
| | Open your worklist: https://.../owner/rob-chen?token=...            |   |
| |                                                                     |   |
| | Steps and Microsoft Learn links are pre-populated per control.      |   |
| |                                                                     |   |
| | Thanks,                                                             |   |
| | Sam                                                                 |   |
| +---------------------------------------------------------------------+   |
|                                                                           |
| [Show what Rob will see ↗]                                                |
|                                                                           |
|                              [Cancel]   [Send + log assignment >]         |
+---------------------------------------------------------------------------+
```

### Rejected alternatives

- **Export to CSV, email it yourself.** Already exists. Already failing the JTBD — CSVs strip the six-step playbook and force the owner back to the tool anyway. Keep the export as an audit artifact, not as the handoff mechanism.
- **Assign inside the app to an internal task queue with no external channel.** Rejected — Rob does not open the tool daily. Meet the owner where they already work (Outlook / Teams).
- **Auto-assign by role from the catalog's `ownerRoles`.** Rejected — role-strings ("Global Administrator", "SharePoint Administrator") are not people. Auto-assignment must be a one-click default, never a silent action.

### Schema/API impact

**Yes — small.** The Decision page's evidence-log already carries assignment rows conceptually (it has a `Remediation package` entry). Formalize an `assignments` collection on the evidence graph with: control IDs, owner (name, role, contact), assigned-at, target date, channel, message, revoke-at, completion evidence ref. This is additive; existing `controlResults` and playbook remain unchanged. Loop in `data-engineer` and `sceptical-architect` for the schema so the assignments record cannot be tampered with post-hoc (evidence integrity already has a pattern in `evidence-integrity.js`).

---

## Moment 4 — Evidence collection experience

This is where `Unknown` becomes actionable, and where the tension the brief calls out ("many Unknown states can overwhelm") is dissolved.

### The reclassification

Every current `Unknown` result must be shown to the customer as one of exactly three things, never as bare "Unknown":

- **Not yet collected** — a workload connector has not been connected or has failed. The row's primary action is `Connect <workload>` with the exact permissions/roles required.
- **Not collectable here** — this control requires a human-signed attestation (adoption, RAI review, governance cadence). The row's primary action is `Attach signed attestation` (uploads a signed statement + attributes owner + expiry).
- **Not applicable** — the customer has judged the control does not apply. Requires owner name + expiry + reason, exactly as `approvedNotApplicable()` already enforces.

The reclassification is a *rendering* change, not a schema change. `mission-engine.evaluateControl()` already distinguishes `Missing / InvalidFreshness / Expired / UnapprovedNotApplicable`; the UI simply has to stop collapsing them into the word "Unknown."

### Primary flow — connecting a workload

1. From Moment 2 the user clicks a row whose type is *Not yet collected*.
2. The playbook expansion shows: **what evidence is missing**, **which collector produces it**, **which permission/role is required**, and a **`Connect this workload`** button.
3. `Connect this workload` opens the existing consent-broker flow, scoped to *only the scopes needed for this control* (progressive consent), and returns to the same row.
4. On return, the row shows the fresh result, the freshness clock, and the mission chip re-evaluates in place. If the result is Pass, the row congratulates + rolls the queue forward. If it is Fail, the row rewrites itself to an *Action required* playbook.

Progressive consent is critical. The current model asks for a wide consent up front; the customer's mental model needs "you asked me for this scope because *this specific control* needs it." Cite existing pattern: Microsoft Graph's incremental consent.

### Primary flow — attesting a human control

1. Row expansion shows: what statement is required (e.g., "RAI review completed for Pilot A"), who must sign (role), and what fields the statement must contain (from `enablement-playbook.controlPlaybook.validation.acceptanceCriterion`).
2. Two options: **Attach signed statement** (PDF or signed JSON) or **Compose statement from template** (product renders the required fields into a fillable form; owner signs; the signed artifact is stored in the evidence store hashed).
3. Attestation carries an expiry (matches control's `freshnessHours`). At expiry the row auto-flips back to *Not yet collected* with a callout "This attestation expired on <date>, request re-attestation."

### Wireframe (text) — the row-level "connect / attest" experience

```
+---------------------------------------------------------------------------+
|  AFD-PURV-001  Publish Purview sensitivity labels                         |
|  [Compliance] [<1h] [Evidence required — Gate]         [Connect >]        |
|  ---- expanded --------------------------------------------------------   |
|  Not yet collected — we cannot see your Purview labels.                   |
|                                                                           |
|  What produces this evidence:                                             |
|    Purview label collector (delegated, read-only).                        |
|  Required scopes:                                                         |
|    InformationProtectionPolicy.Read.All                                   |
|  Required role for the sign-in account:                                   |
|    Compliance Administrator (or read-only equivalent)                     |
|                                                                           |
|  [Connect Purview ↗]     [Request access from Compliance owner]           |
|                                                                           |
|  Or, if labels are managed outside this tenant:                           |
|  [Attach signed attestation of external label program]                    |
|                                                                           |
|  Or, if this control does not apply to Pilot A:                           |
|  [Mark Not Applicable] (requires owner + expiry)                          |
+---------------------------------------------------------------------------+
```

### Rejected alternatives

- **Show all `Unknown`s in one bucket with a "connect everything" button.** Rejected — customers already have that (the Set up page). It has not solved the problem. The overwhelm comes from *not knowing which Unknowns to care about first.* Moment 2's sort solves that; Moment 4 makes each Unknown individually actionable.
- **Auto-attest human controls to reduce Unknown noise.** Rejected explicitly — this would violate evidence integrity. Human-evidence controls must have a signed statement. The persona lesson from home-challenge-engagement applies: never silently reconcile at save time.

---

## Moment 5 — Verification loop and the decision record

The current Decision page treats verification as a single "rescan the SharePoint sharing" event and reserves the estate-wide decision for a full re-scan. That is too coarse-grained for the actual workflow — customers unblock 3–5 controls at a time and want to see the mission gate re-evaluate *without* running a full multi-hour scan.

### Primary flow

1. When an owner marks a row done (Moment 4 mechanism), the row triggers a **scoped re-collection** targeting only the collectors that produce that control's evidence sources.
2. The re-collection completes in seconds-to-minutes (per control), the mission chip re-scores in place, and the row updates to `Complete` or explains why it did not.
3. When a mission's blocker count reaches zero, the top-of-page answer flips from "No" to "Yes — with conditions" or "Yes." The customer is not required to leave the plan view to see the answer change.
4. On the Decision screen, once a mission is `Ready`, the user can generate a **signed decision record**: recommendation (`READY` / `GO WITH CONDITIONS` / `NO-GO`), the cohort, the mission, every satisfied control with its evidence ref + hash, every deferred control with its approver + expiry, every advisory that remains open with owner acceptance. This is the artifact Sam presents to the sponsor.

### Wireframe (text) — Decision record

```
+---------------------------------------------------------------------------+
| DECISION RECORD — Pilot A — Mission 01 Activation                         |
+---------------------------------------------------------------------------+
| Recommendation:   *** GO WITH CONDITIONS ***                              |
| Signed by:        Sam Rivera (Copilot Program Owner)                      |
| Signed at:        2026-09-14 14:22 AEST                                   |
| Cohort:           Pilot A — 50 users (Entra group: pilot-a-copilot)       |
| Evidence sealed:  yes (SHA-256 8f2c...)                                   |
|                                                                           |
| 18 of 18 activation Gate controls satisfied                               |
| 2  Advisory controls deferred with owner acceptance:                      |
|    AFD-IAM-004  Identity Protection risk policies                        |
|      Deferred by Priya Menon (M365 admin) until 2026-10-14.               |
|      Rationale: no Entra ID P2 licence for pilot cohort.                  |
|    AFD-ADOPT-005 Copilot Dashboard usage baseline                        |
|      Deferred by Sam Rivera (Program) until 2026-09-28.                   |
|      Rationale: dashboard requires 7 days of usage post-activation.       |
|                                                                           |
| Conditions the sponsor must accept:                                       |
|  - Activation is bounded to Pilot A only. Scale mission blocks remain.    |
|  - Deferred controls must be revisited by their expiry dates.             |
|                                                                           |
|   [Download signed decision record (PDF + JSON)]                          |
|   [Copy shareable summary for the sponsor deck]                           |
+---------------------------------------------------------------------------+
```

### Rejected alternatives

- **Only allow decision after a full 77-control re-scan.** Rejected — it is the current model and it turns the verify loop into an all-or-nothing event, which encourages customers to skip verification. Scoped re-collection per control is the pattern.
- **Auto-approve the decision when all gates pass.** Rejected — the decision is a business judgement (accept the conditions, accept the deferred advisories). The system produces the *record*; the owner signs it. This is the same author-then-sign shape as Microsoft's Compliance Manager.

---

## Global measurable success criteria

Instrument every one of these. They are the falsification tests for the whole redesign.

- **Time to first answer (TTFA).** From opening the app on a tenant with a fresh scan, elapsed time until the customer sees the yes/no/conditions answer for at least one mission. Target: median under 30 seconds. Today: unmeasured; likely 3–5 minutes because customers land on Assessment's sharing-signal card.
- **Time to first click-path (TTFCP).** From opening the app, elapsed time until the customer opens the playbook for one control. Target: median under 90 seconds.
- **Plan-to-completion conversion.** Of controls that appear in a mission's plan and are `Action required`, the % that reach `Complete` within 14 days of first appearing. Target: >60% for pilot cohorts. Today: unmeasured.
- **Owner handoff acceptance.** Of controls assigned to a non-primary owner via Moment 3, the % where the assignee opens the shared worklist within 3 days. Target: >70%.
- **Unknown resolution rate.** Of controls in `Evidence required` state at open, the % that move to any non-Unknown state within 7 days. Target: >50%.
- **Attestation-to-verified ratio.** Of controls resolved via attestation vs. via automated re-collection. Watching this catches gaming: if attestation is >80% for a control that has an automated collector available, we have a UX bug pushing owners toward the easy path.
- **Signed decision records issued per tenant per month.** The true north metric. If a tenant runs the tool for 4 weeks and never signs a decision record, we have not delivered value — regardless of how many controls we scanned.
- **Return usage after activation.** % of tenants that re-open the app within 30 days of an activation decision. If this is <40%, Mission 04 (Assure) is failing as a product, and we have shipped a single-use audit tool, not a control tower.
- **Decision-page attention split.** Ratio of time spent on the top-of-page decision summary vs. on the 77-control list. Target: >50% on the summary. Today: presumably ~5% on the summary given how long the control list is.

## Edge cases the build must handle

- **Empty state — no scan yet.** Home shows only Moment 1's `See how to start` variant, mission chips greyed with "no evidence yet." Do NOT show fake numbers. Never render "0 blockers" when the true state is "we don't know" — that's a false-pass.
- **Partial scan — some workloads connected, others not.** Missions display separately: `Activation: 4 blockers + 3 evidence gaps` where evidence gaps come from unconnected workloads. Never hide the evidence-gap count behind the blocker count; the two are semantically different.
- **Cohort not defined.** Every mission chip says `Bind a cohort to evaluate` with a single call to action. Do not evaluate against `all licensed users` as an implicit fallback — the current code already refuses this and correctly returns NO-GO with reason "No explicit deployment cohort is bound." Surface that reason as the primary CTA, not as an inline warning.
- **Evidence expired mid-session.** The freshness clock in Moment 1 and Moment 2 must count down live. When it hits zero, the mission chip flips to `Evidence expired — rescan` in place. Do not require a page reload to see this.
- **Assignment sent to a role that has no named person.** Modal refuses to send — role strings are not deliverable. Forces the customer to resolve to a person, mirroring the persona lesson: never let a UI pretend a role is a mailbox.
- **Signed attestation uploaded but signature invalid.** Row remains `Evidence required` with a specific reason: "signature invalid: unknown signer / expired certificate / hash mismatch." Never silently accept.
- **Concurrent edit — two owners resolve the same row simultaneously.** Last write wins is not acceptable. Use optimistic concurrency (same pattern as the operator's ADO-append rule): read `rev`, write with `test op` on `rev`, fail-fast on collision, show a diff.
- **Hostile input on attestation upload.** Accept only signed PDF and signed JSON with a whitelisted schema; reject `.exe`, `.html`, and macro-enabled formats; strip metadata; hash before storage; never render uploaded content as HTML.
- **Slow network on scoped re-collection.** Row shows a determinate progress bar with the collector name; if it exceeds 60s, offer `Run in background — I'll notify you.` Do not block the plan view.
- **Deferred control expires while a decision is being signed.** Decision record signing must revalidate all deferrals at signing time; if any expired between open and sign, refuse to sign and highlight the expired row.

## Open questions for the PM (the human)

- Is the target customer for v1 a single admin doing the whole workflow, or a program owner delegating to 3–5 admins? The whole owner-handoff investment (Moment 3) is only justified if it's the second. Today's UI answers the first; the brief implies the second.
- Do we consider the four missions (Activation, Safe pilot, Scale, Assure) as four separate "products the customer wants to finish", or as a single continuous readiness ladder? The wireframes above treat them as four discrete goal-states with independent plans; this is a bigger reframing than a nav change.
- Is there a supported channel for delivering an owner-scoped share URL (Moment 3) inside the customer's own M365 (deep-link to Teams / email drafted in Outlook), or does the tool have to stay local-only and hand off through OS clipboard? This decision changes the assign UX materially.
- What is the intended relationship between the AI Flight Deck decision record and a customer's existing change-management system (ServiceNow, ADO, internal risk register)? A signed PDF/JSON is a starting point; if we need first-class integration, that's a separate persona conversation.
- For deferred / risk-accepted controls, is there an organizational approver above the row-level owner (e.g., CISO for security-domain deferrals)? If yes, we need a two-signature model, not the single owner+expiry we have today.

## Hand-off

- **Schema/API impact:**
  - Additive: an `assignments` record on the evidence graph (Moment 3). Loop in `data-engineer` and `sceptical-architect`.
  - Additive: a signed `decision-record` artifact type distinct from the evidence-log entry (Moment 5). Reuse `evidence-integrity.js` primitives; do not invent a new signing scheme. Loop in `sceptical-architect` for the trust model.
  - No breaking change to `readiness-catalog.v1.json`, `control-result.schema.v1.json`, or the existing `mission-engine` outputs. The prioritized plan is a *view* over already-computed fields.
  - Scoped re-collection (Moment 4) requires the collector-orchestrator to accept a `controlId[]` filter. Confirm with the collector engineer that per-control targeting is safe.
- **Accessibility risks the build must own:**
  - The status pill vocabulary (`Complete / Action required / Evidence required / Owner review / Deferred`) must be readable without colour. Persona lesson (radars): never let colour be the only channel for a distinction that changes the decision.
  - The four mission chips are the top of every screen; they must be keyboard-navigable in a single tab stop and announce their state (`Activation — 4 blockers — click to open plan`) to a screen reader.
  - Expand-in-place rows must not trap focus, must not reflow content above them, and must expose the six playbook steps as a real `<ol>`, not as visual list items.
  - `Unknown` reclassification (Moment 4): the three states must have distinct screen-reader labels (`Evidence not yet collected`, `Signed attestation required`, `Not applicable — approved`). Never a bare "Unknown."
  - The 3D control-plane (relegated to Level 2 inspection) must have a fully equivalent tabular view with the same information; treat this as a hard blocker on Moment 2 shipping.
  - Freshness countdown clocks must be pause-able (WCAG 2.2.2 — moving content) and must not use colour alone to signal "about to expire."

---

## What NOT to change

Two things about the current product are already right and the redesign should preserve them explicitly, because the temptation on a rewrite is to lose them:

- **Honest `Unknown`** as a first-class state that never becomes a false pass. The rendering changes (Moment 4) but the underlying refusal to guess is correct and hard-won. Any UI iteration that turns `Unknown` into a soft-fail or an "80% ready" fills a gauge is a regression.
- **The playbook payload from `controlPlaybook()`** is genuinely useful and the closest thing to "authoritative implementation guidance" the customer has. The redesign surfaces it earlier and in-place, but changes nothing about its shape. Do not rewrite the six-step template; it's the artifact the customer came for.
