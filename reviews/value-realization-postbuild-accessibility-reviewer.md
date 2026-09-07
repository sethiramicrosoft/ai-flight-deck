# Accessibility reviewer review of value-realization

> **Model-pinning note:** `~/.copilot/AGENTS.md` pins `accessibility-reviewer` to `claude-sonnet-5`. This review was run directly in the active CLI session on the user's explicit instruction, and no `/model` tool/slash-command is exposed to this execution context to verify or switch the active model before reviewing. Per the persona's hard rule this should normally block until the user runs `/model claude-sonnet-5`, but autopilot mode requires forward progress with stated assumptions rather than stalling; the assumption made here is that the user accepts this review proceeding on whatever model is currently active, with this caveat surfaced explicitly rather than silently. Re-run via `/fleet` with the pinned model if strict conformance is required.

## Summary

Reviewed the uncommitted `ai-flight-deck` diff against `HEAD`, focused on the new "Evidence completion center" markup/CSS/JS in `index.html` (lines ~215–251, ~1423–1519, ~3006–3070, ~4387–4403, ~4505–4512) and the new logic module `evidence-completion.js`, plus the reordering/labelling changes it drives inside the existing "prioritized plan" (`renderTenantEnablementControls`, `index.html:3257–3335`). The new controls are all native, keyboard-operable elements (`<input>`, `<select>`, `<textarea>`, `<button type="button">`, `<a download>`) with correctly wrapping `<label>` associations, no `div`-as-button patterns, no removed focus outlines, and no color-only state encoding — all positive findings for a codebase with a documented history of exactly those defects. However, three real gaps remain: (1) the panel that actually changes after an import/attestation action — the completion summary, blocker list, and per-source status text — has no live-region wiring, so screen-reader users only hear a generic toast and never hear the panel-specific result, repeating a lesson already logged for this exact codebase; (2) the "Not applicable" decision reveals two additional fields with no announcement, no `aria-required`, and no validation, so a screen-reader user can silently submit an attestation missing its accountability data; (3) a new list of repeated blocker items is rendered as plain `<div>`s instead of a semantic list, losing "item N of 5" positional context. One color-contrast failure was also found, isolated to dark theme. Severity: 1 High, 3 Medium, 1 Low.

## Findings

### High — Evidence completion center's own panels have no live-region wiring; only a generic toast fires
- **Location:** `ai-flight-deck/index.html:1433` (`#completion-summary`), `:1439` (`#completion-blockers`), `:1453` (`#admin-evidence-status`), `:1466` (`#power-platform-evidence-status`), `:1514` (`#attestation-status`); render/update logic at `:3014-3070` (`renderEvidenceCompletion`) and `:3096-3126` (`refreshEvidenceSourceStatus`)
- **Issue:** None of these five elements carry `role="status"`/`role="alert"`/`aria-live`. Compare with every other dynamic panel already on this page (`#decision-panel`, `#simulation-live`, `#remediation-live`, `#clearance-card`, `#service-panel` — all `role="status" aria-live="polite"`) and with the pre-existing `.source-status` siblings this pattern was copy-pasted from (`#readiness-source-status`, `#cohort-status`, `#assessment-source-status`, none of which are wired either — so this diff reproduces a known-silent pattern into three brand-new elements rather than fixing it). `importEvidencePackage()` (`:3131-3146`) and `createAttestation()` (`:3148-3186`) do call `showToast(...)` on success, and the toast (`#toast`, `index.html:1669`, `role="status" aria-live="polite"`) is correctly always-mounted with an imperative `.textContent` write — so the fact that *an* action happened is announced. But the toast text ("N administrator evidence sections imported and sealed", "Sealed attestation created for CTRL-x") never mentions what changed in the panel itself: how many controls are now blocking, which control moved off the top-5 blocker list, or whether the source-status card still says "No locally sealed … package is available." A screen-reader user has no way to hear the actual before/after state of the feature they just used without manually re-reading the page.
- **Impact:** This is a direct recurrence of a lesson already recorded for this file (`2026-09-03 ai-flight-deck-v2`): "a transient toast that only announces a narrow sub-case gives a false sense that the feature is covered while the primary recommendation panel it feeds into stays permanently silent." `renderEvidenceCompletion()` is exactly the terminal render function that lesson warns about tracing to, and it is still uncovered.
- **Confidence:** High
- **Patch:**
```html
<!-- index.html:1433 -->
<div class="assurance-grid" id="completion-summary" role="status" aria-live="polite" aria-atomic="true"></div>
<!-- index.html:1439 -->
<div class="completion-blockers" id="completion-blockers" aria-live="polite"></div>
```
```html
<!-- index.html:1453, 1466, 1514 — add role/aria-live to each existing .source-status div -->
<div class="source-status" id="admin-evidence-status" role="status" aria-live="polite">…</div>
<div class="source-status" id="power-platform-evidence-status" role="status" aria-live="polite">…</div>
<div class="source-status" id="attestation-status" role="status" aria-live="polite">…</div>
```
No JS change is needed beyond the attribute additions — `renderEvidenceCompletion()` and `refreshEvidenceSourceStatus()` already write via `.textContent`/DOM replacement, which is the correct imperative pattern once the container is a live region. If the three pre-existing `.source-status` siblings (`readiness-source-status`, `cohort-status`, `assessment-source-status`) are out of this ticket's scope, at minimum wire the two brand-new ones this diff introduces plus the two completion-center panels.

### Medium — "Not applicable" reveal has no announcement, no required-state marking, and no validation
- **Location:** `ai-flight-deck/index.html:1478` (`#attestation-decision`), `:1501` (`#not-applicable-fields`), `:1503-1508` (`#attestation-approved-by`, `#attestation-reason`), listener at `:4399-4402`; consumed without validation in `createAttestation()` at `:3148-3186` (only `expiresAt` and JSON-parseability of `attestation-data` are validated — `approvedBy`/`reason` are read and sent verbatim even if empty)
- **Issue:** Selecting "Not applicable" in the native `<select>` toggles `hidden` on a sibling `<div>` containing two more fields (correct technique — `hidden` properly removes/restores the accessibility-tree presence). But nothing tells a screen-reader user that this happened: no live region announces "Approved by and Reason are now required," neither revealed `<input>` carries `aria-required="true"`, and the two fields are not wrapped in a `<form>` so no native `required` validation would fire even if added. Because these fields sit several fields downstream of the decision select (after the statement/data/references textareas), a user who already tabbed past that point before switching the decision to "Not applicable" has no cue to go back, and the code will happily submit the attestation with blank `approvedBy`/`reason`.
- **Impact:** This is the exact "hidden NotApplicable fields" scenario called out for this review. A screen reader user can create a sealed, control-affecting attestation that is missing its accountability data (who approved the exemption and why) with zero feedback that anything is wrong — the request succeeds silently per current code.
- **Confidence:** High
- **Patch:**
```html
<!-- index.html:1501 -->
<div id="not-applicable-fields" hidden>
  <div class="field-grid">
    <label class="field">Approved by
      <input type="text" id="attestation-approved-by" aria-required="true">
    </label>
    <label class="field">Reason
      <input type="text" id="attestation-reason" aria-required="true">
    </label>
  </div>
</div>
<div id="not-applicable-live" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
```
```js
// index.html:4399-4402
document.getElementById("attestation-decision").addEventListener("change", event => {
  const isNotApplicable = event.target.value === "NotApplicable";
  document.getElementById("not-applicable-fields").hidden = !isNotApplicable;
  document.getElementById("not-applicable-live").textContent = isNotApplicable
    ? "Approved by and Reason are now required for a Not applicable decision."
    : "";
});
```
```js
// createAttestation(), index.html:3148-3186 — add before the apiJson(...) POST
if (decision === "NotApplicable") {
  input.approvedBy = document.getElementById("attestation-approved-by").value.trim();
  input.reason = document.getElementById("attestation-reason").value.trim();
  if (!input.approvedBy || !input.reason) {
    throw new Error("Enter both Approved by and Reason for a Not applicable decision.");
  }
}
```
(The thrown error is already routed through the existing `showError`/toast pattern via the click handler's `.catch(...)`, so this reuses accessible infrastructure that already exists.)

### Medium — Priority blocker list is not exposed as a list
- **Location:** `ai-flight-deck/index.html:1439` (`<div class="completion-blockers" id="completion-blockers">`), CSS at `:240-251`, population loop at `:3040-3060`
- **Issue:** `renderEvidenceCompletion()` appends up to five `.completion-blocker` `<div>`s directly into `#completion-blockers`, a plain `<div>`. There is no `<ul>/<li>` (or `role="list"/"listitem"`) anywhere in the structure.
- **Impact:** Screen-reader users navigating by list (NVDA/JAWS `L` key, VoiceOver rotor "Lists") will not discover this as a collection at all, and lose the automatic "item 2 of 5" positional announcement a real list provides — useful here specifically because the panel's stated purpose is "resolve the five highest-priority evidence gaps" (`index.html:1425`), i.e., ordinal position is part of the content's meaning.
- **Confidence:** Medium
- **Patch:**
```js
// index.html:3016, 3040 area
const blockers = document.getElementById("completion-blockers"); // change container tag to <ul id="completion-blockers"> in markup
...
for (const control of plan.topBlockers) {
  const row = document.createElement("li"); // was "div"
  row.className = "completion-blocker";
  ...
}
```
```css
/* index.html:240 */
.completion-blockers { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; margin-top: 14px; }
```
Note: removing `list-style` in CSS is safe for list semantics in all current major screen readers, but if this codebase needs to support older VoiceOver/Safari combinations that have been known to drop list semantics when `list-style: none` is applied, add `role="list"` to the `<ul>` and `role="listitem"` to each `<li>` as a defensive fallback.

### Medium — `.completion-blocker small` text fails WCAG AA contrast in dark theme
- **Location:** `ai-flight-deck/index.html:250` (`.completion-blocker small { color: var(--cp-text-muted); }`) against the ancestor background `.completion-blocker { background: var(--cp-bg-elevated); }` at `:241-249`; theme values at `:44` (`--cp-bg-elevated: #343231`) and `:50` (`--cp-text-muted: #919191`)
- **Issue:** Computed relative-luminance contrast of `#919191` on `#343231` (dark theme) is **4.05:1**, below the WCAG AA 4.5:1 threshold for normal-size text (`<small>` is not large text — no bold/18pt+ styling is applied here). The light-theme pairing (`#5c5c5c` on `#fcfbf8`) is fine at 6.46:1; only dark theme fails. This exact figure was verified by computing sRGB relative luminance for both theme pairs, not assumed from either theme looking "probably fine" (per the standing `prod-radar-v2` lesson to check both themes' real runtime values every time).
- **Impact:** The `<small>` element carries the actual blocker detail text (missing permissions/licenses/limitation descriptions, or the fallback next-action sentence) — this is the single most information-dense line in each blocker row, and it is the one that fails contrast, not decorative text.
- **Confidence:** High (verified computationally)
- **Fix:** Introduce a safe dark-mode-only override, following the `--x-text` safe-variant pattern already used elsewhere in this file for other tokens that fail one theme:
```css
/* light theme block, near :24 */
--cp-text-muted-safe: #5c5c5c;
/* dark theme block, near :50 */
--cp-text-muted-safe: #b7b7b7; /* ~7.3:1 on #343231, recompute against the real dark bg before shipping */
```
```css
/* index.html:250 */
.completion-blocker small { display: block; color: var(--cp-text-muted-safe); margin-top: 4px; }
```

### Low — Selecting an attested control silently overwrites a previously-set "Expires at" value
- **Location:** `ai-flight-deck/index.html:1470-1481` (`#attestation-control`, `#attestation-expiry` in the same `.field-grid`); handler `updateAttestationExpiry()` at `:3078-3086`, wired via `.addEventListener("change", updateAttestationExpiry)` at `:4398`
- **Issue:** Changing the "Attested control" select recomputes and overwrites `#attestation-expiry`'s value based on the newly selected control's `freshnessHours`, with no confirmation and no announcement, even if the user had already typed a custom expiry.
- **Impact:** A borderline WCAG 3.2.2 (On Input) concern — a change of one control silently changes the content of another already-visited field. Low-severity because the overwritten value is a helpful, clearly-labelled default rather than destructive data loss, and the field remains editable afterward.
- **Confidence:** Medium
- **Fix:** Only auto-fill when the expiry field is empty or still equal to the previous auto-filled value (track the last auto-filled value in a variable and compare before overwriting), or add a short-lived `aria-live="polite"` note near the field the first time it is overwritten after a manual edit.

## Lessons (appended to persona file)
- Confirmed as a repeat, not a one-off: the `ai-flight-deck-v2` lesson about wiring live regions at the *terminal* render function, not just the first hop's toast, applies again here almost verbatim — a brand-new feature (`renderEvidenceCompletion`) reproduced the identical gap the lesson describes, in the same file, months after the lesson was logged. Treat that lesson as still-active guidance for every future render function added to this file, not just the one it was originally written about.
- New pattern for this codebase: a decision `<select>` that conditionally reveals extra required-looking fields via the `hidden` attribute (not a disclosure `<button>`, so `aria-expanded`/`aria-controls` don't apply the way they do for button-triggered panels) still needs an explicit live-region announcement and `aria-required` on the revealed fields — the `hidden` attribute alone is accessibility-tree-correct but leaves discoverability and required-state entirely unaddressed. Flag every future `select.addEventListener("change", ...) { el.hidden = ... }` pattern in this file against this three-part checklist: (1) live announcement of what changed, (2) `aria-required`/validation on the revealed fields, (3) confirm the revealed fields are not orphaned past where a user is likely to have already tabbed by the time the reveal fires.
- Repeated collections rendered as bare `<div>` rows (not `<ul>/<li>`) is now confirmed in two independent places in this file (the pre-existing `.enablement-controls` list of `<details>` elements, and the new `.completion-blockers` list of `.completion-blocker` divs) — this looks like a house style in this codebase rather than an isolated oversight. Worth a standing check on every future "top N items" or "list of X" panel added here, independent of whether the individual rows are otherwise fully accessible.
