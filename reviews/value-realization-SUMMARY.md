# Fleet summary — value-realization

## Triangulated (raised by 2+ personas — fix first)

- [TRIANGULATED] `index.html` — the 77-control inventory is being presented as
  the primary customer artifact. The first screen must instead answer the next
  mission decision and show a small, ordered queue of blockers and evidence
  gaps. (sceptical-architect, ux-ui-researcher)
- [TRIANGULATED] `collector-adapters.js`, `estate-collector-suite.js`,
  `server.js` — administrator-evidence and attestation readers exist, but the
  shipping product does not provide the corresponding producer and verifier
  paths. This makes a large set of controls permanently `Unknown`.
  (sceptical-architect, data-engineer)
- [TRIANGULATED] `index.html`, `enablement-playbook.js` — bare `Unknown` is not
  actionable. Every unresolved control must identify whether it needs a
  permission, licence, workload connection, administrator evidence package,
  signed attestation, re-scan, or approved scope decision.
  (ux-ui-researcher, data-engineer)
- [TRIANGULATED] `index.html`, `estate-collector-suite.js` — readiness must be
  bound to an explicitly approved cohort. A silent tenant-wide fallback makes
  the decision ambiguous and weakens the customer handoff.
  (sceptical-architect, ux-ui-researcher, data-engineer)
- [TRIANGULATED] `mission-engine.js`, `schema/control-result.schema.v1.json` —
  incomplete coverage and unbounded `NotApplicable` approvals must never
  satisfy a gate. (sceptical-architect, data-engineer)
- [TRIANGULATED] `enablement-playbook.js`, `index.html` — the valuable loop is
  evidence → prioritized action → accountable owner → new evidence → verified
  closure. The product must optimize for completing that loop rather than
  maximizing the number of displayed controls. (all three personas)

## Conflicts (human decides)

- Product scope — sceptical-architect recommends shrinking the shipped product
  to a SharePoint sharing baseline and moving unsupported domains to a roadmap;
  ux-ui-researcher recommends retaining the four missions and using the
  existing 77-control model behind a prioritized plan; data-engineer recommends
  retaining the model and shipping the missing evidence producers. The
  implementation will preserve the tenant-wide end goal while making each
  unsupported evidence path explicit and progressively completable.
- Decision language — sceptical-architect recommends removing tenant-wide
  `READY / NO-GO` until every domain has a working collector; ux-ui-researcher
  recommends retaining mission-level decisions; data-engineer supports strict
  gating once all producer paths exist. The implementation will retain strict
  decisions but distinguish evidence gaps from configuration failures and
  refuse positive results until the selected mission has complete verified
  evidence.
- Synthetic demonstration — sceptical-architect recommends removing it;
  ux-ui-researcher uses it to explain the target journey. It will remain
  clearly marked as synthetic, but no demonstration value will be allowed to
  influence a real recommendation.

## Out of scope (in the diff, not in the ticket)

- None. The current uncommitted files are fleet reports only.

## Everything else, ranked

### Critical

- `server.js` — wire a real attestation verifier instead of the permanent
  fail-closed default, and expose a supported way to create the exact signed
  evidence envelope. (data-engineer)
- `scanner/` — provide a documented producer for `admin-evidence.json` and
  validate schema, tenant, source age, and per-command failures when reading it.
  (data-engineer)
- `index.html` — replace the first-screen score and long inventory with the
  current mission answer and its top blockers. (ux-ui-researcher)

### High

- `collector-runtime.js` — expose a control-level preflight plan showing which
  controls are collectible and the exact missing dependency before a scan.
  (data-engineer)
- `index.html` — prioritize by current mission, evidence gap, owner, and effort;
  expand rows in place to show the existing playbook. (ux-ui-researcher)
- `index.html` — enable owner-scoped worklists and evidence-backed completion,
  without automatically sending outbound messages. (ux-ui-researcher)
- `mission-engine.js` — block `Pass` results with incomplete coverage and block
  `NotApplicable` without an approver and future expiry. (data-engineer)

### Medium

- `upstream-evidence.js` — version the Microsoft assessment crosswalk by
  feature identity rather than one global commit and expose its small real
  coverage. (data-engineer, sceptical-architect)
- `schema/` — model source-specific freshness and preserve the evidence
  snapshot used by the decision. (data-engineer)
- `README.md` — describe the shipped evidence-completion workflow precisely and
  stop implying that importing a Microsoft report resolves the full catalog.
  (sceptical-architect)
