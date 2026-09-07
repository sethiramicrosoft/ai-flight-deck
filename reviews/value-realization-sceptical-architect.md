# value-realization — sceptical-architect

**Persona:** sceptical-architect (pinned model: `claude-opus-4.7`)
**Product:** AI Flight Deck (`C:\Users\sethirajulu\Agency-Cowork\Agency-Cowork\ai-flight-deck`)
**Review date:** 2026-09-07
**Scope:** Read-only inspection of code, schema, docs. No product code changed.
**Prompt in one sentence:** the user wants customer value realization moved from *partial* to *complete*; my job is to say what the smallest coherent product architecture that delivers real end-to-end value looks like, what to remove, and how to phase it.

---

## The one-sentence version

Ship the SharePoint sharing baseline → verify loop as its own product with a named ≤50-user pilot cohort; retire the tenant-wide 77-control decision engine, the four-mission gate lifecycle, and 6 of the 13 domains until each has a collector that can actually answer without a bespoke evidence-package import path the installer does not build.

---

## Substrate reality check (measured from this tree, not from README claims)

| Fact | Evidence | Consequence |
|---|---|---|
| The 77-control catalog spans 13 domains. | `schema/readiness-catalog.v1.json` counted: 77 controls, 13 domains, 22 marked `Automated`, 0 marked `Attestation`. | The 22:55 automated-to-non-automated ratio is already a red flag; the "attempted for all 77 controls" claim in `README.md` line ~17 is honest about attempted, silent about actionable. |
| The default scan requests exactly three Graph delegated scopes. | `schema/scan-contract.v1.json` `scopeContract.requiredPermissions`: `Directory.Read.All`, `Organization.Read.All`, `Sites.Read.All`. | The catalog's own `requiredPermissions` fields name ~15 additional scopes (`Sites.FullControl.All`, `AuditLog.Read.All`, `Policy.Read.All`, `SecurityEvents.Read.All`, `InformationProtectionPolicy.Read`, `SharePointTenantSettings.Read.All`, `DeviceManagementApps.Read.All`, `RoleManagement.Read.Directory`, `IdentityRiskyUser.Read.All`, `MailboxSettings.Read`, `ThreatIndicators.Read.All`, `SecurityIncident.Read.All`, `SecurityAlert.Read.All`, `Reports.Read.All`, `Exchange.ManageAsApp` etc.). None of them are requested. |
| The installer provisions exactly one PowerShell module. | `setup-ai-flight-deck.ps1` line 178+: only `Microsoft.Graph.Authentication`. | Zero of `ExchangeOnlineManagement`, `PnP.PowerShell`, `MicrosoftTeams`, `Microsoft.Online.SharePoint.PowerShell`, `MSCommerce`, Purview, Defender modules are provisioned. Every collector that needs one of those is dead on arrival. |
| The Microsoft "automated assessment" crosswalk maps three unique control IDs. | `upstream-evidence.js` `ASSESSMENT_CROSSWALK`: 12 crosswalk entries → `AFD-PPA-001` (7 entries), `AFD-SEC-005` (1), `AFD-COPILOT-003` (1); plus a Defender for Endpoint and Graph connector `deriveStatus` case. | The imported Microsoft assessment CSV can influence three catalog controls out of 77 (≈4%). The other 74 remain untouched by import. |
| The Microsoft "Copilot Readiness" CSV crosswalk maps zero controls. | `upstream-evidence.js` — the readiness CSV drives `suggestedCandidate`/cohort planning; there is no `readinessCrosswalk` from its columns to `AFD-*` control IDs. | The Readiness CSV builds a cohort candidate list, not readiness evidence. The word "readiness" is doing two jobs in the marketing; only one of them is a control-level input. |
| The decision function has a single-branch outcome for any Unknown gate. | `enablement-playbook.js` lines 687–708: `NO-GO` when any Gate control is not `Complete`, when evidence isn't sealed, when no cohort is bound, when cohort isn't approved, and — critically — even after all the above pass, `NO-GO` again unless `targetResults.length === controls.length && every control === Complete`. | With only Directory / Organization / Sites.Read scopes on a real tenant, roughly 5–10 controls of 77 will resolve to Pass/Fail; the rest are Unknown; the decision function will therefore return `NO-GO` on 100% of fresh installs, forever, with no discriminating information for the customer. |
| The catalog is hand-typed in three places. | `schema/readiness-catalog.v1.json` declares 13 domains; `scanner/scan-tenant.ps1` iterates a `$requiredPermissions` list from the contract; `index.html` `buildDemoEstateAssessment` synthesises 13 domain rows for the "Contoso Aviation" synthetic tenant; the `demoEstate*` and `demoScenarios` blocks in `index.html` (grep hits, several) are the demo copies. | R233 catalogue-drift in this file's own Lessons: three parallel copies, none tested for agreement. |
| The cohort primitive silently defaults to "tenant-wide". | `index.html` line 1806 and line 1968-70: when no cohort is bound, code substitutes `{ id: "tenant-wide", name: "Tenant-wide baseline" }`; `cohortControlResults` then filters on that string. | The "named cohort with accountable owner" story in the README is one falsy check away from collapsing to a tenant-wide default that no code path treats as different in kind. R233e lesson from this file applies verbatim. |

The customer's own concern in the prompt — *"many controls remain Unknown due to missing workload connectors or attestations, so it may only be a better checklist"* — is not a fear. It is a measurement.

---

## Findings

### F1 — Critical — the middle two verbs (Evaluate, Decide) have no collector for the catalogue they name

**Location:** `schema/readiness-catalog.v1.json` + `enablement-playbook.js` `computeTenantEnablement` + `scanner/scan-tenant.ps1` + `setup-ai-flight-deck.ps1`.
**Regret in one sentence:** in six months you will want to add a single workload collector without shipping a new installer, a new PowerShell module bootstrap, a new schema hash bucket, and a new evidence-package format, and this design will fight you because the catalogue is a **fixed 77-item list hand-typed in three files** with **one** decision function that requires **all** items green and **one** default scope set that can resolve **at most ~10** of them.
**Regret shape (existing lesson):** this is exactly `2026-09-03 ai-flight-deck` (verb chain — outer verbs cheap, middle verbs hardcoded) + `2026-09-04 R233` (13-domain catalogue is a legend not a data structure) + `2026-09-04 R233c` ("positive decision" whose predicate reads only one workstream) applied verbatim.
**Smaller change:** kill the 77-control fixed catalogue as the top-level product frame. Ship a **cohort-scoped sharing baseline** with the ~8–12 controls the default Graph scopes can actually resolve, and stop calling anything else a "control" until it has (a) a collector file, (b) an evaluator that reads at least one non-string field, (c) a scope in the request set, and (d) an installer step that provisions the module it depends on.

### F2 — Critical — the decision function is a legend renderer, not a decision engine

**Location:** `enablement-playbook.js` lines 687–708.
**Regret in one sentence:** in six months you will want to change one control's threshold from Pass to Warning, and this code will fight you because `recommendation === "READY"` is gated on `every control === Complete` across the entire hand-typed catalog, so any addition or removal of a control globally invalidates every stored baseline for every customer.
**Regret shape (existing lesson):** `2026-09-04 R233c` — any decision-shaped field that names three tenant verbs is a *sub*-decision unless the predicate reads at least one field from every required domain's evaluator; here the predicate reads a count, not a field. Also `2026-09-04 R233d` — the hash scope is global, not per-axis, so a licensing collector change invalidates the sharing baselines.
**Smaller change:** demote `recommendation` to `sharingCohortRecommendation` — the only workstream whose collector is real today. Rename `enablement-playbook.js` → `sharing-cohort-decision.js`. Everything else is `subDecisions[]` with `status: 'AwaitingCollector' | 'AwaitingImport' | 'AwaitingAttestation'`, never `NO-GO`. The customer never sees `NO-GO` on a control the product cannot evaluate; they see `AwaitingCollector` and it is greyed out.

### F3 — Critical — the nav rail promises verbs the substrate cannot produce

**Location:** `index.html` — Assessment (13-domain mission map), Simulator ("Live simulation remains unavailable until the collector has effective permission paths"), Findings, Remediation plan, Rollout decision. Guide-step 4 admits the simulator is empty on real data.
**Regret in one sentence:** in six months you will want to add a genuine simulator and this design will fight you because the customer has already read the label, clicked the empty-state, and formed the "this product is a checklist with a broken simulator" mental model — the empty-state honesty comes *after* the nav promise.
**Regret shape (existing lesson):** `2026-09-03 ai-flight-deck-v2` — a verb the nav rail promises but the current substrate cannot produce is worse than a verb the nav rail does not name.
**Smaller change:** hide (not "empty-state") Simulator and Rollout decision behind a `hasEffectivePermissionPaths` feature detect that is false on every fresh install. The nav shows exactly the verbs the current substrate can execute: **Baseline → Findings → Remediation → Verification**. Move the four-mission lifecycle diagram from the top of the app to a single explanatory panel in the guide.

### F4 — Critical — the 6-scope illusion vs the 3-scope reality

**Location:** `schema/scan-contract.v1.json` `scopeContract.requiredPermissions` = 3 scopes; catalog's per-control `requiredPermissions` = 15+ scopes across the 77 controls.
**Regret in one sentence:** in six months a customer will request the "purview evidence" that the catalog promises and this design will fight you because the request set is not the union of the catalog's requirements, so shipping the Purview collector is a scope-change day for every existing customer's admin-consent flow — a same-tenant re-consent that will fail more often than it succeeds.
**Regret shape (existing lesson):** `2026-09-04 R233b` — `AuthMode` `ValidateSet("Interactive","DeviceCode","AccessToken","ExistingContext","ManagedIdentity","Certificate")` with only Interactive/AccessToken reachable end-to-end is exactly this axis; the flexibility exists (6 modes), only 1–2 are exercised. Same for scopes.
**Smaller change:** the request set must be *computed* from the catalog's per-control `requiredPermissions`, filtered by which collectors are enabled in this build. If a collector is not enabled, its scopes are not requested. Ship a Phase 1 build that enables 3 collectors (licensing-basic, network-probes, sharing-baseline) and requests exactly the union of their scopes — currently that's the three already in the contract, which happens to be right by accident. When a new collector lands, both the collector and the scope union move in the same PR.

### F5 — High — 6 domains are decorative

**Location:** `schema/readiness-catalog.v1.json` — `exchangeOnline`, `sharePointOneDrive` (admin-tenant-settings half), `purviewCompliance`, `securityPosture`, `copilotConfiguration` (settings half), `powerPlatformAgents`, `adoptionMeasurementGovernance`, `teamsReadiness` (policy half).
**Regret in one sentence:** in six months a customer will ask which evidence bundle format populates the Purview or Adoption domain and this design will fight you because the collectors expect a `context.copilotSettingsEvidence[controlId]` / `context.teamsPolicyEvidence[controlId]` / attestation store shape that (a) has no producer in the installer, (b) has no JSON Schema anywhere in `schema/`, (c) has no worked example in `docs/`, and (d) has no CI test that a well-formed one round-trips.
**Regret shape (existing lesson):** `2026-09-04 R233` — refuse to ship a catalog whose ids don't each have a collector file *and* an evaluator file *and* a test that the emitter's output domain-id set equals the catalog's domain-id set.
**Smaller change:** delete these 6 domains from the shipped catalog. Move them to `schema/roadmap-catalog.v1.json` as **candidates**, not controls. When one of them gets a real collector + scope + installer entry + fixture in a PR, promote it back. The remaining 5 domains (licensing, identity, devices, network, service-health + sharing-half-of-SPO) are the honest v1 catalog. That is ~30 controls; realistically ~10–15 will be automated end-to-end on default scopes. That is a real product.

### F6 — High — cohort default silently degrades to tenant-wide

**Location:** `index.html` line 1806 (`scan.estateAssessment?.cohorts?.[0]?.id || "tenant-wide"`); line 1967–68 (`cohort = cohorts[0] || { id: "tenant-wide", name: "Tenant-wide baseline" }`).
**Regret in one sentence:** in six months you will want to enforce "no evaluation without a named cohort" and this code will fight you because two call sites silently synthesise a `tenant-wide` cohort id whenever the customer hasn't approved one, so the invariant is unenforceable without touching every reader.
**Regret shape (existing lesson):** `2026-09-04 R233e` — cohort primitive present in the schema but the top-level readers substitute a string when it isn't set.
**Smaller change:** if no cohort is approved, the Assessment page renders one panel ("Approve a named pilot cohort") and everything else is disabled. `cohort || "tenant-wide"` is deleted; `cohort === null` propagates as `null` and the top-level renderers early-return with the cohort-required empty state. This is a Phase 0 change (~30 minutes) and it forces every other design decision honestly.

### F7 — High — three parallel copies of the domain catalog

**Location:** `schema/readiness-catalog.v1.json` (canonical), `scanner/scan-tenant.ps1` (per-domain sections), `index.html` `buildDemoEstateAssessment` (synthetic Contoso demo).
**Regret in one sentence:** in six months you will add a fourteenth domain and one of the three files will still say thirteen for at least a release, because no test asserts they agree.
**Regret shape (existing lesson):** `2026-09-03 ai-flight-deck-v2` half-adopted single-source-of-truth: the JSON contract sits in the tree, and the browser copy and the PowerShell copy hand-type the numbers.
**Smaller change:** the browser fetches `schema/readiness-catalog.v1.json` at boot and iterates the array to render the mission map; the PowerShell scanner reads the same JSON and iterates the same array to loop the collector dispatch. A boot-time test asserts `emitter.domainIds() === catalog.domains.map(d=>d.id)`. The `buildDemoEstateAssessment` synthetic tenant is deleted; the "screenshots use synthetic Contoso Aviation" claim in README is replaced with real-tenant screenshots or the screenshots are removed. R229b third-caller trap avoided.

### F8 — High — the ONE workflow that works end-to-end is not the headline

**Location:** SharePoint sharing collector (`collectors/governance-domains.js` `normalizeSharePoint` — AFD-SPO-002/003/004/006 read from `dataAccessGovernance`/`sitePermissions` observations), `scanner/scan-tenant.ps1` sites/permissions inventory, `scanner/compare-scans.ps1` diff logic, README guide-steps 4–7.
**Regret in one sentence:** in six months you will realise the sharing baseline → verification loop was the one honest customer-facing artefact the whole time, and every other slide in the deck was rendering a decision the substrate could not produce, and the customer will have already stopped opening the app because they read the `NO-GO` on the front page as "product doesn't work".
**Regret shape (existing lesson):** `2026-09-04 R233c` — sub-decisions vs top decision. The sharing workstream is where the actual sub-decision lives; it should be the top decision until other sub-decisions exist.
**Smaller change:** promote sharing baseline + verification to the product's primary noun. Rename the app "SharePoint Sharing Baseline & Verification for M365 Copilot pilots". The first screen after cohort approval is the sharing findings table. The `compare-scans.ps1` re-verification is the second screen. Everything else is a `Later capabilities` link. Customers still get the evidence-integrity chain, the signed baseline, the Markdown export, the "before-and-after proof" — those are load-bearing IP. They just get them for the workstream that actually runs.

### F9 — Medium — the auth mode enum has six values and one code path

**Location:** `scanner/scan-tenant.ps1` line ~53 `ValidateSet("Interactive","DeviceCode","AccessToken","ExistingContext","ManagedIdentity","Certificate")`; every downstream use is `Interactive` in the installer, `AccessToken` in headless server-driven scans, occasional `ExistingContext`. `ManagedIdentity` and `Certificate` are unreachable from any UI or documented path.
**Regret in one sentence:** in six months a customer will ask for service-principal-with-certificate for unattended tenant assessment and this code will fight you because the mode exists but the *supporting artefacts* (app registration, key rotation, client-id publication) do not, so the code will grow a fifth branch outside the enum.
**Regret shape (existing lesson):** `2026-09-04 R233b` — an `AuthMode` value may only exist alongside a collector that requires it, a smoke test that exercises it, and an integration-test doc explaining who owns provisioning.
**Smaller change:** delete `ManagedIdentity` and `Certificate` from the enum until the first customer with a working stub for either. Keep `Interactive`, `DeviceCode`, `AccessToken`, `ExistingContext` — each has a live caller. Corollary from the same lesson: **stop reusing Microsoft's public `Microsoft Graph Command Line Tools` client id `14d82eec-…`**. Ship a multi-tenant AI Flight Deck app registration on day one; the reused client id is a landmine for tenant admin-consent policy and Microsoft's own allowlist.

### F10 — Medium — upstream-evidence crosswalk covers 3 of 77 controls, but the marketing implies more

**Location:** `upstream-evidence.js` `ASSESSMENT_CROSSWALK` (unique controlIds: AFD-PPA-001, AFD-SEC-005, AFD-COPILOT-003) + `README.md` claim "AI Flight Deck adds… Combines Microsoft reports, a live Graph scan, workload evidence, and accountable attestations".
**Regret in one sentence:** in six months a customer will notice that the Microsoft assessment CSV import moved 3 of 77 controls, and the value story ("import Microsoft readiness reports plus live evidence, evaluate 77 controls") will read as marketing rather than description.
**Regret shape (existing lesson):** `2026-09-03 ai-flight-deck` metric-definition drift by data source — same story on the coverage axis: the label "verified upstream check" is doing more work than the mapping supports.
**Smaller change:** either (a) grow the crosswalk to cover every upstream-assessment finding class before shipping the "77 controls" claim, or (b) rewrite the value claim as "import Microsoft's readiness report to select a cohort; run our sharing baseline for that cohort; verify the fix." That is the true product. This is a docs+website change, not a code change, but it is Medium because customers who read the README before installing will feel misled the day they finish the scan.

### F11 — Medium — six of the eight "workload evidence" input contracts have no producer in this tree

**Location:** `collectors/governance-domains.js` reads `context.copilotSettingsEvidence`, `context.teamsPolicyEvidence`, `context.hybridValidation`, plus attestations for adoption; `collectors/operational-domains.js` reads adoption attestations. None of these input shapes have a producer script in `scanner/`, a JSON Schema in `schema/`, or a worked example in `docs/`.
**Regret in one sentence:** in six months a customer will ask how to produce `teamsPolicyEvidence` and the answer will be "hand-craft this JSON blob against no schema", which is not a product answer.
**Regret shape (existing lesson):** `2026-09-04 R233` — a control id whose evaluator reads a `context.*Evidence` blob is a legend until a schema for that blob exists and a producer for it ships.
**Smaller change:** one of two paths. Either (a) ship one **generic** signed-evidence-package format — `{ controlId, status: 'Pass'|'Fail'|'Warning', evidenceRefs[], observedAt, signedBy, expiresAt }` — with a JSON Schema and a `scanner/produce-attestation.ps1` that prompts an admin for the fields and signs, and delete the six per-workload contract shapes; or (b) drop the workload-evidence controls from the catalog entirely and file the collectors as roadmap. Do not keep the six input-contract shapes in the code without a producer — every one is a future collector's blocker.

### F12 — Low — hardcoded Pass on AFD-LIC-004

**Location:** `collectors/licensing.js` line 211 — `results.push(evidenceResult("AFD-LIC-004", "Pass", context, {…}))` unconditionally, and `governance-domains.js` line 327 `if (controlId === "AFD-PURV-004") return null` (a one-control special case in the applicability logic).
**Regret in one sentence:** in three months a bug will land whose diagnosis will involve a reader asking "why does LIC-004 pass for every tenant" and no one will remember the answer.
**Regret shape (existing lesson):** `2026-09-04 R233c` — `subDecisions` labelled as `decisions` at the top field.
**Smaller change:** `AFD-LIC-004` (add-on entitlement inventory) is not a Pass/Fail; it is a report. Return it as `status: "Advisory"` with the inventory in `observedValue`, or move it out of the control catalogue into an "entitlement inventory" side panel. Same for the `AFD-PURV-004` special-case.

---

## Smallest coherent product architecture

**Product name:** *SharePoint Sharing Baseline & Verification for M365 Copilot Pilots*. (Not: *AI Flight Deck*, not: *Estate Readiness Control Tower*.)

**Nouns the code shall carry:**

| Noun | Shape | Owner | Persistence |
|---|---|---|---|
| `Cohort` | `{ id, name, principalIds[], approvedBy, approvedAt }` | Explicit — never defaulted to `tenant-wide`. | Signed workspace artefact. |
| `SharingBaseline` | `{ cohortId, scanId, observedAt, scopeFingerprint, siteFindings[], itemFindings[], anonymousLinkCount, orgWideLinkCount, guestAccessCount }` | Graph delegated `Sites.Read.All` collector. | Signed workspace artefact. |
| `Finding` | `{ id, siteId | itemId, kind, severity, evidenceRef, recommendedRemediation }` | Derived from `SharingBaseline`. | Materialised for UI. |
| `RemediationPackage` | `{ cohortId, findings[], generatedAt, format: 'markdown' | 'json' }` | UI selection → export. | Signed export artefact. |
| `SharingVerification` | `{ cohortId, baselineScanId, verificationScanId, verifiedFindings[], regressions[], unchanged[] }` | `scanner/compare-scans.ps1` on two baselines. | Signed workspace artefact. |
| `CohortRecommendation` | `{ cohortId, sharingStatus: 'BaselineOnly' | 'FindingsPresent' | 'Verified' | 'Regressed', reason, subDecisions[] }` | **Never** `READY`/`NO-GO` at the tenant level. Cohort-scoped, sharing-scoped. | Materialised for UI. |
| `RoadmapCollector` | `{ id, name, requires: [scope|module|attestationSchema], status: 'AwaitingCollector' | 'AwaitingImport' }` | Read-only listing from `schema/roadmap-catalog.v1.json`. | Not a control. |

**Verbs the code shall implement, end-to-end, on default install:**

1. **Approve cohort** — Copilot Readiness CSV imported → candidate list → admin picks ≤50 users → cohort signed and named.
2. **Baseline sharing** — one signed `SharingBaseline` artefact for the cohort's site touchpoints. Producer: `Sites.Read.All` Graph collector; already exists in `collectors/governance-domains.js`.
3. **Review findings** — one signed `Finding` list, each with a site/item id, a Microsoft doc link, and a "how to remediate in native SPO admin" pointer.
4. **Export remediation package** — Markdown to the admin's clipboard/OneDrive, listing each finding, the native admin path, the acceptance criterion.
5. **Verify** — after the admin remediates in native SPO admin, run baseline again → `compare-scans.ps1` produces a `SharingVerification` artefact that says whether the exact site/item findings from the earlier scan are gone. This is the load-bearing "before-and-after proof".

That is five verbs. Every one has a real collector or a real diff function today. Every one produces a signed artefact. Every one is defensible to an auditor.

**What the mission engine becomes:** a one-page "Roadmap capabilities" section that lists the 6–8 deferred domains and, for each, names the exact thing that unblocks it (a scope, a module, an evidence schema). No mission gates, no lifecycle diagram, no `READY`/`NO-GO`.

---

## What to remove or de-emphasise

**Remove from the shipped product (Phase 0 — same PR as the pivot):**

1. Domains: `exchangeOnline`, `purviewCompliance`, `securityPosture`, `copilotConfiguration` (settings half), `powerPlatformAgents`, `adoptionMeasurementGovernance`, `teamsReadiness` (policy half). Move to `schema/roadmap-catalog.v1.json`.
2. Missions: `activation`, `safePilot`, `scale`, `assure` as UI primitives. Retain the vocabulary in the roadmap doc; drop from the catalog and from `mission-engine.js`.
3. `enablement-playbook.js` `recommendation === "READY" | "GO WITH CONDITIONS" | "NO-GO"` at the tenant scope. Replace with `sharingCohortRecommendation`.
4. `index.html` `buildDemoEstateAssessment` synthetic Contoso; `demoScenarios`, `demoFindings`, `demoRemediations` inline arrays. If a demo is needed, ship a canned real scan output loaded from a JSON file that survives a `git blame`.
5. `Simulator` nav item until a collector produces reachability paths.
6. `Rollout decision` nav item at tenant scope.
7. Five of six `AuthMode` values that have no live caller (keep `Interactive`, `DeviceCode`, `AccessToken`, `ExistingContext`; delete `ManagedIdentity`, `Certificate` until wired).
8. The reused `Microsoft Graph Command Line Tools` client id. Ship a proper multi-tenant app registration.

**De-emphasise (Phase 0 — docs + nav copy):**

1. The "13 domains, 77 controls" headline. Replace with "cohort-scoped sharing baseline and verification". That is the honest one-liner.
2. The `Microsoft Learn` citation table at the top of the README. It reads as endorsement; it is documentation of upstream input files. Move to `ACKNOWLEDGEMENTS.md`.
3. The "native entry point in Microsoft admin experience" if it appears anywhere in the roadmap (it does not appear in this tree today — keep it out; see the R143-positioning lesson).

**Keep (load-bearing IP):**

1. `evidence-integrity.js`, `evidence-graph.js`, `consent-broker.js` — the signed evidence chain is real product value.
2. `scanner/compare-scans.ps1` — the diff engine is the "verify the fix worked" surface.
3. `upstream-evidence.js` Copilot Readiness CSV parser — cohort selection is a real use case.
4. Cohort primitive (with the F6 fix — no silent tenant-wide default).
5. Freshness/expiry model in `mission-engine.js` `evaluateControl`.
6. The Markdown export path.

---

## High-value workflow that must work completely

**One workflow. One customer artefact. One measurable outcome.**

```
[Customer state:  M365 tenant, ~5–50 named pilot users, wants to know
                  if enabling Copilot for them will over-expose data]

  1. Install AI Flight Deck (existing installer).
  2. Import Microsoft Copilot Readiness CSV.
       → candidate list of eligible users (existing parser).
  3. Approve a named pilot cohort (≤50 users, an accountable owner).
       → signed Cohort artefact.
  4. Connect and scan tenant with delegated Sites.Read.All +
     Directory.Read.All + Organization.Read.All.
       → signed SharingBaseline artefact for the cohort's site scope.
  5. Review findings: anonymous links, org-wide links, guest access,
     broad-access sites within the cohort's SharePoint touchpoints.
       → prioritised Finding list.
  6. Export the Remediation package as Markdown.
       → the admin knows exactly which native SPO admin paths to walk.
  7. Admin remediates in the Microsoft admin centres (out of scope
     for us — we don't touch tenant state).
  8. Re-scan and verify.
       → signed SharingVerification artefact says which findings are
         gone, which changed, which regressed.
  9. The customer keeps three signed artefacts: baseline, remediation
     package, verification. That is the deliverable.
```

**Success criterion for Phase 1:** a customer with a real 20-user pilot can complete steps 1–9 in one session, hand the three signed artefacts to their compliance owner, and get "yes proceed" on the sharing question alone. Copilot enablement decisions for the pilot are still made by humans reading the other domains from other tools — and the product is honest about that.

**What this workflow explicitly does not do:**

- It does not tell the customer whether Purview labels are configured.
- It does not tell the customer whether Copilot Cloud Policy is set correctly.
- It does not tell the customer whether Defender for Endpoint covers the cohort.
- It does not tell the customer whether Power Platform DLP is in place.
- It does not tell the customer whether hybrid mail flow works.
- It does not tell the customer whether Teams policies are Copilot-safe.
- It does not tell the customer whether adoption cohorts have training.

Every one of those is a valid future collector — none of them is a shipped collector today. The product is honest about that or the product is a legend.

---

## Phased design

### Phase 0 — the pivot (1 sprint, no new collectors)

Deliverables that are all code+doc changes to what already exists:

1. `schema/readiness-catalog.v1.json` split into `catalog.v1.json` (retained domains: `licensingAndTenantEntitlement` [partial], `identityAndAccess`, `devicesAndApps`, `networkConnectivity`, `serviceHealthOperations`, `sharePointOneDrive` [sharing controls only]) and `roadmap-catalog.v1.json` (the other 6+ domains).
2. `enablement-playbook.js` → `sharing-cohort-decision.js`; the decision function returns `sharingStatus` and `subDecisions[]`; the strings `READY`/`GO WITH CONDITIONS`/`NO-GO` are removed from the code path that renders to the customer.
3. `index.html` nav rail reduced to: **Baseline → Findings → Remediation → Verification → Roadmap**. Guide is preserved; missions become a paragraph in Roadmap.
4. Cohort default `"tenant-wide"` removed; every reader early-returns to the "approve a cohort" panel when cohort is null.
5. `buildDemoEstateAssessment` and inline `demoScenarios`/`demoFindings`/`demoRemediations` deleted; replace with a canned JSON of a real (redacted) scan or with an "install and scan your own tenant to see this page" empty state.
6. `AuthMode` enum trimmed to the four live callers. `Microsoft Graph Command Line Tools` client id replaced with a new AI Flight Deck app registration (or the reuse is called out in `SECURITY.md` as a known limitation).
7. Boot-time test: `emitter.domainIds() === catalog.domains.map(d=>d.id)` in the browser bundle. Same check runs in `scanner/scan-tenant.ps1` against the JSON.
8. README rewritten to describe the sharing-baseline product. `Roadmap capabilities` section names each deferred domain and its unblocker.

### Phase 1 — honest MVP (1–2 sprints)

Everything Phase 0 promises must run end-to-end for a real 20-user pilot on a real tenant. Everything in the workflow above must complete.

1. Sharing collector: hardened. Cohort-scope filter on the site inventory (only sites the cohort touches, discovered via `/users/{id}/drive/root/sharedWithMe` and cohort group membership — this changes the scope from "the whole tenant" to "what the cohort can currently reach", which is the correct Copilot exposure surface anyway).
2. Findings UI: severity by `anonymousLink` > `orgWideLink` > `guestAccess` > `broadSiteAccess` × `cohortReachable`.
3. Remediation export: Markdown listing each finding with the native SPO admin path (link) and the acceptance criterion.
4. Verification: `compare-scans.ps1` produces `SharingVerification` with regression detection.
5. Signed artefact chain: baseline → remediation package → verification, each signing the previous.

Success: three signed artefacts, one customer, one session, no `Unknown`s in the shipped workflow.

### Phase 2 — one more collector, chosen by demand (later, gated on Phase 1 customer count ≥ 5)

Pick **one** deferred domain to promote. Not two. Not three. **One.** The order I would predict from Copilot rollout risk:

1. `identityAndAccessCohortHardening` — cohort MFA coverage, cohort role assignments, cohort guest-account hygiene. Scopes: `Policy.Read.All`, `RoleManagement.Read.Directory`, `AuditLog.Read.All`. Installer step: none new. **This is the cheapest promotion**; the collectors already exist in `graph-domains.js`, they only need the scopes in the request set.
2. `devicesAndAppsCohortHardening` — cohort Intune enrolment, cohort app protection coverage, cohort Windows update ring. Scopes: `DeviceManagementApps.Read.All`, `DeviceManagementManagedDevices.Read.All`. Installer step: none new. Same as above.

If Phase 1 goes well, one of these two adds ~5–7 controls to the shipped catalog and preserves the sharing-focused UX. This is the R229b third-caller rule inverted: the first collector shows the pattern; the second confirms it; the third earns the abstraction.

### Phase 3 — the generic attestation ingestor (only if Phase 2 has real customers)

For every deferred domain that requires an out-of-band evidence package (EXO hybrid validation, Purview label config, Copilot Cloud Policy, Teams policy, adoption use cases), ship **one** attestation ingestor:

- One signed JSON envelope schema: `{ controlId, status, observedAt, evidenceRefs[], signedBy, signature, expiresAt, notes }`.
- One `scanner/produce-attestation.ps1` that prompts an admin for the fields, hashes the referenced evidence file(s), signs, and writes to the workspace.
- One collector-side reader that treats the envelope as if the collector produced it.
- Zero per-domain evidence formats. `context.teamsPolicyEvidence`, `context.copilotSettingsEvidence`, `context.hybridValidation` all go through the same envelope.

Now — and *only* now — the catalog can grow controls that require attestation, because there is exactly one shape for attestation. R232 four-copies avoided.

### Phase 4 — genuine external evidence connectors (much later)

If, and only if, Phase 3 has ≥ 3 domains covered by attestations and customers are asking for automation, extract a `HostDriver`-shaped `EvidenceCollector` interface with two working driver implementations on day one (Exchange PowerShell exporter, SharePoint tenant-settings exporter). Same rule as the orcastra-v1 lesson: two implementations from commit #1 or the abstraction is theatre.

### Phase 5 — tenant-wide expansion

Consider it. Not before. Everything above must have real customers; the R233 verb-chain pattern must not have recurred inside any promoted domain. The `READY` / `NO-GO` strings can come back at the tenant scope only when the predicate reads at least one non-string field from every required domain's evaluator.

---

## What the customer prompt asked for, mapped

| Ask | Answer |
|---|---|
| *Smallest coherent product architecture that delivers real end-to-end customer value* | Sharing baseline + verification for a named ≤50-user cohort. Five verbs, five signed artefacts, zero `Unknown` in the shipped workflow. |
| *Identify what should be removed or de-emphasized* | 6 domains, 4 mission gates, tenant-wide `READY`/`NO-GO`, Simulator nav, Rollout decision nav, synthetic Contoso demo, 2 unused auth modes, reused public client id, "13 domains 77 controls" headline. |
| *High-value workflow that must work completely* | The nine-step SharePoint sharing baseline → remediation → verification loop above. |
| *Implementable phased design* | Phase 0 (pivot, no new collectors) → Phase 1 (honest MVP for the sharing workflow) → Phase 2 (one deferred domain, cohort-scoped) → Phase 3 (generic attestation ingestor) → Phase 4 (external connectors with two drivers day one) → Phase 5 (tenant scope, only if it has earned it). |

---

## The uncomfortable summary

The current product answers the question *"has the customer done all the things Microsoft would want them to do?"* with all-of-nothing on real data, because ~70+ of 77 controls will be `Unknown` on any fresh install and the decision function collapses that to `NO-GO`. The customer's own concern in the prompt (*"only a better checklist"*) is a floor, not a ceiling.

The one product surface that does answer a real question end-to-end — *"which of my pilot cohort's SharePoint touchpoints will Copilot over-expose, and did our remediation actually close them?"* — is the last screen in the guide (`compare-scans.ps1` re-verification) and the fifth of seven nav items (Rollout decision empty-state). It should be the product.

Ship the sharing baseline + verification workflow as its own product. Keep the signed evidence chain. Move everything else to a roadmap that ships collectors one at a time, each with its own scope-request PR, its own installer step, its own fixture, and its own evaluator. Every promoted domain earns its place; nothing is decorative.

That is the pivot from partial to complete: not adding more collectors, but shrinking the promise to what the collectors that exist actually deliver — and letting the roadmap tell the truth about the rest.

---

*Persona: sceptical-architect. Model: Claude Opus 4.7. No product code changed. New lesson appended to `~/.copilot/personas/sceptical-architect.md` before exit.*
