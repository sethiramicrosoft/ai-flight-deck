# ux-critic review of value-realization (post-build)

> Model: this session ran the review directly (not via `/fleet`). The persona's pinned
> model per `~/.copilot/AGENTS.md` → Persona model assignment is `claude-sonnet-5`
> (the persona file's own header note says `claude-sonnet-4.6`, but the binding table
> in AGENTS.md says `claude-sonnet-5` — flagging this table/header mismatch for the
> user, since I have no `/model` tool available to switch or verify from inside this
> session). Findings below were produced by reading the code and reproducing behavior
> with `node`, not by inference — see each finding's Confidence line.

## Summary

The Evidence completion center (new `evidence-completion.js`, and the new markup/JS
wired into `index.html`'s Decision page) is a real step toward "next mission → top
blockers → supply the missing evidence" — the loop the pre-build fleet asked for. But
it does not make value realization complete yet. I found two **Critical** issues that
will actively confuse or mislead a first-time user (the README sends them to the wrong
tab to find the feature, and the same control shows two contradicting instructions in
one expanded card), plus a **High**-severity gap where the new top-five blocker list
ships without the owner, effort, and action-button fields the pre-build spec explicitly
required at "Level 0" — fields the code already computes but never renders. There are
also real gaps in evidence-import busy states, attestation-form reuse safety, attestation
expiry guidance, and mobile layout for the new blocker list. No findings on: raw
`Unknown` status text leaking to users (it doesn't — every path resolves to a labelled,
actionable state), or on the evidence-package import error copy (it is specific and
actionable as written).

## Findings

### Critical — README sends the user to the wrong tab to find the Evidence completion center
- **Location:** `README.md:229-231`; actual feature location `index.html:1250` (`<section class="page" id="clearance">`) vs. nav labels `index.html:1072-1075`
- **Confidence:** High — confirmed by direct read of both files.
- **Issue:** The README's new "Complete evidence the Graph scan cannot collect" section says: *"Use the **Evidence completion center** on **Set up**."* But the sidebar nav (`index.html:1072-1075`) has exactly four tabs — "Set up" (`data-page="guide"`), "Assessment" (`data-page="overview"`), "Corrections" (`data-page="remediation"`), "Decision" (`data-page="clearance"`) — and the Evidence completion center markup (`index.html:1423` onward, "Evidence completion center" heading at line 1428) is physically inside `<section class="page" id="clearance">`, i.e. the **Decision** tab, not **Set up**. A customer who reads the README top to bottom will open the app, click "Set up" (the first, active-by-default tab), scroll the whole page, and never find the section the README told them to use — because it is three tabs away. This is exactly the kind of "instructions and reality disagree" bug that generates a support ticket on day one, before the user has even run their first scan.
- **Patch:**
  ```diff
  -Install the required Microsoft administration modules for the current Windows
  -user:
  +### Complete evidence the Graph scan cannot collect
  +
  +The live scan remains the primary authenticated path. Use the **Evidence
  +completion center** on **Decision** (the fourth tab) for controls that cross a
  +separate Microsoft 365 administration boundary.
  ```
  Either fix the copy to say "Decision," or — better, since "Set up" is where a
  first-time user is already standing before their first scan — move the Evidence
  completion center's import/attestation cards to the "Set up" page and leave only
  the top-five blocker summary on "Decision," so the README and the UI describe the
  same place.

### Critical — The same control gives the user two contradicting instructions in the same expanded row
- **Location:** `index.html:3299-3319` (badge + "Next evidence step" paragraph in the Decision-blockers detail list), compared against `enablement-playbook.js:577-583` (`classify`) vs. `evidence-completion.js:104-129` (`classify`)
- **Confidence:** High — reproduced with a script, not inferred. See transcript below.
- **Issue:** The pre-existing "Decision blockers" list (below the new Evidence completion center, same Decision page) renders each control's badge from the **old** `enablement-playbook.js` category, but unconditionally renders the "Next evidence step" line from the **new** `evidence-completion.js` module's `nextAction` (`index.html:3316-3319`):
  ```js
  badge.textContent = control.category === "Evidence required" && evidenceCompletion
    ? evidenceCompletion.stateLabel
    : control.category;                 // <- old label when category isn't "Evidence required"
  ...
  const evidence = document.createElement("p");
  evidence.textContent = evidenceCompletion
    ? `Next evidence step: ${evidenceCompletion.nextAction}`   // <- ALWAYS the new module's action
    : "Next evidence step: collect fresh evidence after implementation.";
  ```
  The two modules do not classify every control the same way. I reproduced this for a real, non-Attested control (`AFD-LIC-001`) with a `NotApplicable` result that has complete coverage and valid freshness but no `approvedBy` yet:
  - `enablement-playbook.js` → category **`Owner review`** (`plan.summary.ownerReview: 1`)
  - `evidence-completion.js` → state **`LiveCollectionRequired`** → `nextAction: "Connect the tenant with the required read-only access and run the live scan."`

  Because the badge only swaps to the new label when the *old* category equals exactly `"Evidence required"`, this control's row shows badge **"Owner review"** directly above the sentence **"Next evidence step: Connect the tenant with the required read-only access and run the live scan."** — one says "someone needs to review this," the other says "you haven't scanned this yet, go run a scan." A user cannot act on both at once, and whichever they do, the other instruction remains unresolved-looking. This is not a rare edge case — it happens for every `Warning` or unapproved-`NotApplicable` control whose finer-grained new-module state isn't itself `OwnerReview`/`ConfigurationAction` (e.g. it needs a permission, licence, or admin-evidence package instead of "review").
- **Patch:** Compute the badge and the "Next evidence step" text from the **same** module. The simplest fix: always source the badge from `evidenceCompletion.stateLabel` when `evidenceCompletion` exists (drop the `control.category === "Evidence required"` guard), so both lines in the card agree:
  ```diff
  -          badge.textContent = control.category === "Evidence required" && evidenceCompletion
  -            ? evidenceCompletion.stateLabel
  -            : control.category;
  +          badge.textContent = evidenceCompletion ? evidenceCompletion.stateLabel : control.category;
  ```
  Then retire `enablement-playbook.js`'s independent `classify()`/summary counters (or have it delegate to `evidence-completion.js`) so the top-of-page "Decision blockers" summary metrics and the new "Evidence completion center" summary metrics can never disagree for the same scan.

### High — The new top-five blocker cards ship without owner, effort, or an action button that the pre-build spec required, and that the code already computes
- **Location:** `index.html:3050-3072` (`renderEvidenceCompletion`, the `.completion-blocker` row builder); computed-but-unused fields at `evidence-completion.js:184` (`owner`) and `evidence-completion.js:185-189` (`effort`)
- **Confidence:** High — confirmed the fields are computed and confirmed (via targeted grep across the whole file) that `control.owner` and `control.effort` from this module are never read anywhere in `index.html`.
- **Issue:** `buildEvidenceCompletionPlan()` computes `owner` (`control.ownerRoles?.[0] || "Accountable owner"`) and a coarse `effort` band (`"<15 minutes"`, `"<1 hour"`, `"1-4 hours"`, `"Varies"`) for every control. The top-five blocker row that renders this plan only builds `title`, a `missing`/`nextAction` line, and the state label:
  ```js
  const title = document.createElement("strong");
  title.textContent = `${control.controlId}: ${control.title}`;
  const detail = document.createElement("small");
  detail.textContent = missing.length ? missing.join("; ") : control.nextAction;
  ...
  const state = document.createElement("span");
  state.className = "completion-state";
  state.textContent = control.stateLabel;
  ```
  Neither `control.owner` nor `control.effort` appears. This directly fails the review question "owner/effort clarity" — a user scanning the five highest-priority blockers cannot tell *who* should act or *how long* it will take without opening the separate "Decision blockers" list further down the page (which shows `responsibleRoles` but, from a **different** module, and still never shows effort at all — see `index.html:3311`).

  This is also a regression against the pre-build spec in `reviews/value-realization-ux-ui-researcher.md:151`, which explicitly defined the always-visible Level-0 row as: *"control ID, one-line title, owner chip, effort band, status pill … one primary button (`Do it` / `Assign` / `Review`)."* The shipped row has the control ID, title, and a status pill — and stops there. It also has no button at all, so the top-five list is inert: nothing in the new feature lets the user act on a blocker from the card itself; they must separately locate the same control lower on the page.
- **Patch:**
  ```diff
       const content = document.createElement("div");
       const title = document.createElement("strong");
       title.textContent = `${control.controlId}: ${control.title}`;
       const detail = document.createElement("small");
       ...
  -    content.append(title, detail);
  +    const meta = document.createElement("small");
  +    meta.className = "completion-blocker-meta";
  +    meta.textContent = `Owner: ${control.owner} · Effort: ${control.effort}`;
  +    content.append(title, meta, detail);
       const state = document.createElement("span");
       state.className = "completion-state";
       state.textContent = control.stateLabel;
  -    row.append(content, state);
  +    const action = document.createElement("button");
  +    action.type = "button";
  +    action.className = "btn";
  +    action.textContent = "Review";
  +    action.addEventListener("click", () => {
  +      document.querySelector(`[data-go="remediation"]`)?.click();
  +      // then scroll/expand the matching <details> for control.controlId
  +    });
  +    row.append(content, state, action);
  ```

### High — Attestation form does not clear after a successful submission; stale statement/data can be resubmitted against a new control
- **Location:** `index.html:3146-3186` (`createAttestation`)
- **Confidence:** High — confirmed no reset call exists between the successful `apiJson("/api/attestations", ...)` call and the closing `showToast(...)`.
- **Issue:** After a signed attestation is created, the handler only calls `refreshEvidenceSourceStatus()` and `showToast(...)`. The Statement textarea, Supporting-data textarea, Evidence-references textarea, and "Attested by" input all keep their previous values. If the accountable owner then picks a **different** control from the "Attested control" dropdown to attest next (the only field they are prompted to change, via `updateAttestationExpiry` on `change`), the old Statement text — which the field's own placeholder says must "state exactly what was reviewed, approved, and for which cohort" — is still sitting in the box, and nothing on screen indicates it belongs to the previous control. Because this is a signed, timestamped, compliance record (`attestation-evidence.js` binds it to tenant/cohort/control/signer and seals it), a copy-paste-style mistake here is not a cosmetic bug — it creates an incorrect accountable record that the product's own integrity model treats as authoritative.
- **Patch:**
  ```diff
       await apiJson("/api/attestations", { ... });
       await refreshEvidenceSourceStatus();
       showToast(`Sealed attestation created for ${input.controlId}; run a new scan to evaluate it`);
  +    document.getElementById("attestation-statement").value = "";
  +    document.getElementById("attestation-data").value = "{}";
  +    document.getElementById("attestation-references").value = "";
  +    document.getElementById("attestation-owner").value = "";
  +    document.getElementById("attestation-approved-by").value = "";
  +    document.getElementById("attestation-reason").value = "";
  +    document.getElementById("attestation-decision").value = "Pass";
  +    document.getElementById("not-applicable-fields").hidden = true;
  +    populateAttestationControls();
  ```

### Medium-High — The new blocker list has no mobile layout at all, unlike every sibling grid in the same diff
- **Location:** `index.html:240-251` (`.completion-blockers` / `.completion-blocker` / `.completion-state` CSS) vs. media queries at `index.html:986-1002`, `1003-1051`, `1053+`
- **Confidence:** Medium-High — code-verified absence of any responsive rule (I grepped every `@media` block for `completion-blocker`/`completion-blockers` and found zero matches); the resulting visual squeeze is inferred from the CSS, not screenshotted.
- **Issue:** `.completion-blocker` is `grid-template-columns: minmax(0, 1fr) auto;` with no `@media` override anywhere. Every other new or reused grid in this same diff gets one: `.assurance-grid` collapses to `1fr 1fr` at ≤1040px, `.evidence-source-grid` collapses to `1fr` at ≤1040px, `.field-grid` collapses to `1fr` at ≤760px. The `auto` column here holds `.completion-state`, whose text is a full label like *"Power Platform evidence required"* or *"Administrator evidence required"* — the longest labels in the whole state table. On a 375px-wide phone, that label competing for space against the `minmax(0, 1fr)` description column (which itself contains the concatenated missing-permissions/licences/limitations text) is very likely to force a cramped, wrapped, or overflowing row for exactly the feature this task asked to be reviewed for mobile behavior.
- **Patch:**
  ```diff
   @media (max-width: 760px) {
  +  .completion-blocker { grid-template-columns: 1fr; }
  +  .completion-state { justify-self: start; }
     .field-grid, .source-metrics { grid-template-columns: 1fr; }
  ```

### Medium — Evidence-import and attestation buttons give no busy/disabled feedback, unlike the app's established pattern
- **Location:** `index.html:4390-4399` (`import-admin-evidence`, `import-power-platform-evidence`, `create-attestation` click handlers) vs. the existing convention at `index.html:2465-2508` (`runSimulation`: `button.setAttribute("aria-busy", "true")`, `button.disabled = true`, label swapped to a running-state string, then restored)
- **Confidence:** High — confirmed by reading both handler sets; the new ones never touch `disabled`/`aria-busy`/label text.
- **Issue:** `importEvidencePackage()` and `createAttestation()` are `async` functions that read a file (up to the server's 12 MB limit), POST it, and wait for a response — real network latency, especially for administrator or Power Platform evidence packages that can be large. Nothing disables the "Import administrator evidence," "Import Power Platform evidence," or "Create sealed attestation" buttons while the request is in flight, and nothing tells the user work is happening (no `aria-busy`, no label change). A user who isn't sure the click registered can click again, firing a duplicate import/attestation request, and in the meantime has no way to distinguish "still processing" from "did nothing."
- **Patch:**
  ```diff
   document.getElementById("import-admin-evidence").addEventListener("click", () => {
  -  importEvidencePackage("admin").catch(error => showError(error.message));
  +  const button = document.getElementById("import-admin-evidence");
  +  button.disabled = true;
  +  button.setAttribute("aria-busy", "true");
  +  const original = button.textContent;
  +  button.textContent = "Importing…";
  +  importEvidencePackage("admin")
  +    .catch(error => showError(error.message))
  +    .finally(() => {
  +      button.disabled = false;
  +      button.removeAttribute("aria-busy");
  +      button.textContent = original;
  +    });
   });
  ```
  Apply the same pattern to the Power Platform import and "Create sealed attestation" buttons.

### Medium — Attestation "Expires at" field never discloses its per-control cap before the user submits
- **Location:** `index.html:1489` (`<input type="datetime-local" id="attestation-expiry">`), auto-fill logic at `index.html:3095-3103` (`updateAttestationExpiry`), server-side enforcement at `attestation-evidence.js:44-49`
- **Confidence:** High — confirmed the input has no `max` attribute and no adjacent caption, and confirmed the server rejects a later value with `expiresAt cannot exceed the ${control.freshnessHours}-hour freshness window for ${control.id}.`
- **Issue:** `updateAttestationExpiry()` pre-fills a sensible default (`min(control.freshnessHours, 168)` hours from now), but the datetime-local input has no `max` attribute, so a user is free to pick a later date in the picker with no visual warning. The constraint only surfaces after the user has filled in the Statement, Supporting data, and Evidence references fields and clicked "Create sealed attestation," at which point the server throws and `showError` shows the message — the correct message, but at the wrong time, after the user has done all the other work.
- **Patch:**
  ```diff
     function updateAttestationExpiry() {
       const option = document.getElementById("attestation-control")?.selectedOptions?.[0];
       const expiry = document.getElementById("attestation-expiry");
       if (!option || !expiry) return;
       const hours = Math.min(Number(option.dataset.freshnessHours) || 24, 168);
       const date = new Date(Date.now() + hours * 3600000);
       date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
       expiry.value = date.toISOString().slice(0, 16);
  +    expiry.max = expiry.value;
  +    document.getElementById("attestation-expiry-hint").textContent =
  +      `This control's evidence stays fresh for up to ${hours} hours; the expiry cannot be set later than that.`;
     }
  ```
  (Add a `<small id="attestation-expiry-hint">` under the field.)

### Medium — Top-five blocker list gives no total-blocker count and no severity differentiation between its five entries
- **Location:** `index.html:1429` (subtitle copy), `index.html:3050-3072` (row rendering), `index.html:251` (`.completion-state { color: var(--cp-accent); }` — one color for every state)
- **Confidence:** Medium — this is a judgment call about clarity rather than a reproducible defect.
- **Issue:** The section subtitle promises "the five highest-priority evidence gaps," but nothing on the card says how many total unresolved controls exist beyond those five (`plan.summary.evidenceRequired + plan.counts.ConfigurationAction + plan.counts.OwnerReview` is already computed but not shown next to the list), so a user cannot tell whether resolving these five clears the estate or barely dents a much longer queue. Separately, every one of the five states — from `MissingPermission` (a 5-minute admin-consent grant) to `ConfigurationAction` (an actual control failure) to `OwnerReview` (waiting on a person) — renders in the identical `--cp-accent` color and weight, so nothing about the card's appearance tells the user which of the five is most urgent; they must read all five small-text lines to find out. The "Current mission" value is also inert: it names the mission (e.g. "Activation") but offers no click-through to the matching controls on the Corrections tab, so the user must locate them manually.
- **Patch:** Add a line under the list such as `"Showing 5 of {total} unresolved controls."`, and give `ConfigurationAction` a red/`--cp-danger` treatment, `MissingPermission`/`MissingLicense` an amber/`--cp-warning` treatment, and `OwnerReview`/attestation-pending states a neutral treatment — mirroring the color convention already used for `.control-detail.pass/.fail/.warning` badges elsewhere in the same file (`index.html:553-555`). Make the "Current mission" value a link/button that switches to Corrections and filters to that mission's controls.

## No findings on
- Raw `Unknown` status text never reaches the user: every render path (badge, blocker card, detail paragraph) resolves through a labelled `stateLabel`/`nextAction`/`category`, never the bare word "Unknown." Confirmed by reading every `.status` and `.category` render site in `index.html`.
- Evidence-package import error copy (`collector-adapters.js:validateEvidencePackage`) is specific and actionable as written (names the exact schema, tenant, or age problem) and needs no rewrite.

## Lessons (appended to persona file)
- See `~/.copilot/personas/ux-critic.md` — three new lessons appended below, generalizing (1) badge/next-step text sourced from two different classification modules on one card, (2) a pre-build spec's "always-visible row fields" silently dropped from the shipped row despite the backing data existing, and (3) README location copy that doesn't match the actual DOM section id.
