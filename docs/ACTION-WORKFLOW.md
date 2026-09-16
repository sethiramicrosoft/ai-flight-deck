# Guided correction actions

[README](../README.md) · [Visual tour](VISUAL-TOUR.md) · [Collector guide](COLLECTOR-GUIDE.md)

For exact proof contracts, required statement data, report imports and controlled
before/after sharing comparisons, see [Evidence and verification](EVIDENCE-AND-VERIFICATION.md).

Corrections now includes **Move your pilot forward**, above the
optional legacy review-file export. This is persistent local workflow, not a
Microsoft 365 change service. The app sends no email, Teams message or tracker
task; copying a draft is not sending it. No new tenant permissions are requested.

The customer path is **choose pilot > see blockers > complete next action >
check evidence > review decision**. **Work on this next** selects an unresolved
supported check, prioritising an observed failure. It is not a risk ranking of
all requirements: unsupported checks remain in the decision snapshot.
The current work stage opens automatically; scope, guidance, central response,
the draft preview and technical history remain expandable.

After reporting completion, `AFD-OPS-005` (escalation contacts) and
`AFD-ADOPT-003` (training and support) have plain-language review fields inside
the action workspace, with no JSON required. Provide real reviewed references
and a future expiry within the control's limit. Training must already have
occurred in the last 30 days. Saving is not validation: collect fresh evidence
afterward. Other supported statements link directly to their selected Set up form.

**Review pilot decision** and **Download current decision snapshot** include
all 77 checks, exact pilot context, evidence dates, recorded owners, action
verification and next steps. Download refreshes the source first and fails on
unreadable evidence rather than exporting an older successful snapshot.
The snapshot distinguishes a current passing check from evidence acquired
after an action's completion. It is not organisational rollout approval.

## Walk through an action

1. Start the local app and collect a baseline through **Set up**. Select the
   intended pilot snapshot. Demo data or client-supplied Pass values cannot
   create authoritative source facts.
2. In **Assessment**, open a readiness check and choose **Start guided action**.
   Sharing review groups also link to the relevant oversharing review control;
   that does not make their sampled records technical proof of effective access.
   Alternatively, open **Corrections** and choose the saved tenant/cohort and
   readiness check.
3. Select **Create or resume action**. Repeated clicks return the existing
   action for that exact control/context, not duplicates. Review the frozen
   starting evidence, catalogue requirement and acceptance criterion.
4. Record the exact intended scope, owner, team, due date if needed, concrete
   proposed work and responsibility: local, central, shared or still unknown.
   Record prerequisites, impact and rollback considerations. Review and confirm
   the prerequisite checkbox.
5. If approval is required, record the decision, approver and reference before
   **Start guided work**. This is a statement entered by the local operator,
   not an authenticated approval or proof that the named person has authority.
   Unknown responsibility, missing scope/owner/team or unconfirmed prerequisites
   blocks starting and completion.
6. Select prerequisite actions if needed. They must already exist in the same
   exact context, cannot form a cycle and must be reported complete before
   dependent work starts/completes. This is workflow ordering, not technical
   proof. A reopened prerequisite blocks the transition again.
7. Follow the control-specific steps and Microsoft documentation. Tick steps
   as progress is reported, then **Save progress**. Step ticks record progress;
   they neither execute configuration changes nor prove success. Work that
   requires tenant changes is performed outside Flight Deck under the normal
   change process.
8. For central/shared responsibility, record the central IT request, response
   and response-evidence reference. Preview the complete manual hand-off draft
   before **Copy reviewed draft (not sent)**. Deliver it yourself through your
   approved process. Local names and responses do not become signed accountable
   statements automatically.
9. Enter what work was completed and choose **Report completion**. The server
   records the reporting time; historical execution dates entered in notes do
   not backdate that boundary. Work remains unverified until admissible evidence
   is actually observed and signed after that timestamp.
10. Choose **Check saved evidence**, or expand **Collect fresh read-only
    evidence, then check this action**, review the consent text, and explicitly
    agree to run the existing full workload collection. It is not a narrow
    action-specific scan. Complete any required sign-in in **Set up**; after
    collection the app returns to Corrections and checks the action.
11. Read the result, evidence provenance and **Action history**. Use
    **Reload saved actions** to resume after a restart or recover from an edit
    conflict. A conflict leaves the other edit intact; reload and reapply your
    intended changes. Do not retry by overwriting a newer revision.
12. Use **Reopen work** to change reported-complete work. The previous proposal,
    completion report and verification events remain in history; report
    completion again and collect newer evidence.

## What verification means

| Result shown in the app | Meaning |
|---|---|
| Not verified | Work may be reported complete, but qualifying evidence is missing, too old, outside the exact context, unsupported or not yet checked |
| Settings verified by a supported check | One of AFD-LIC-001, AFD-LIC-002, AFD-LIC-004 or AFD-IAM-003 meets its bounded source-observation contract after reported completion |
| Owner statement accepted (not a technical check) | One of the eleven supported statement contracts is current, locally signed, bound to the exact control/context and accepted by the existing authority validator; not independent technical proof of settings |
| Needs attention again | Previously satisfied evidence is no longer sufficient, the context changed, or the operator explicitly reopened the work |

The eleven statement controls are AFD-IAM-007, AFD-DEV-005, AFD-OPS-004,
AFD-OPS-005, AFD-COPILOT-006, AFD-PPA-005, AFD-ADOPT-001, AFD-ADOPT-002,
AFD-ADOPT-003, AFD-ADOPT-004 and AFD-ADOPT-006. Use the existing control-specific
statement form in Set up when applicable; a central response note is not a
substitute for that exact contract.

The remaining **62 of 77** catalogue controls can have guided work and completion
reports, but remain unverified. A closed task, a document link, a CSV, a
hand-off response or an old Pass re-sealed today cannot close that gap.
AFD-LIC-002 is a cohort-wide licensing contract, not proof of per-user causation.
Reverification compares current state with the frozen app criterion; it does
not establish who caused a change. Actions never promote control or mission
gates themselves: the existing evidence-authority engine remains the proof source.

`AFD-IAM-003` supports a deliberately bounded policy shape: enabled, all pilot
users explicitly or All users, All cloud apps, all client types, MFA AND
compliant device, no exclusions or extra targeting conditions. No enabled
policies is Fail; unproven policy shapes, incomplete collection and read errors
remain Unknown. Do not weaken or broaden an approved policy to fit the checker.
An accepted configuration is not proof of runtime enforcement.

### Implementation lesson: verify the real API, not only its fixture

The previous identity/device collectors requested the nonexistent
`/policies/conditionalAccessPolicies` route, and the pagination fixture repeated
it. The supported route is `/identity/conditionalAccess/policies`. The bounded
contract now rejects source truncation, unsupported policy targeting and
pagination that changes collection endpoint. Regression coverage is in
`conditional-access-evidence.test.js`; both collectors use the corrected route.

## Persistence, integrity and current context

The default workspace remains `%LOCALAPPDATA%\AI Flight Deck\live-test`, outside
OneDrive. `guided-actions.json` is a version-1, locally integrity-sealed store
using atomic replacement and a short exclusive transaction lock. Revision
checks prevent lost updates from retries or concurrent tabs. The local
signature detects edits without the workspace key; it is not an external
identity signature or protection against someone who controls both files and key.

Starting evidence, catalogue identity and exact cohort snapshot are retained.
An action is never rebound to a new tenant or broader cohort. Historical
contexts remain visible but read-only; create a separate action in the current
context. Checks happen on action API reads and operations, not through continuous
background monitoring. A later workload/baseline collection updates the sealed
action assessment; a later comparison scan also supplies its assessment. Newer
failure or unknown results cannot be replaced by selecting an older passing row.

Capacity is deliberately bounded: 500 actions, 200 history entries per action,
16 MiB total store, up to 30 dependencies and 4,000 characters per text field.
History is not silently discarded. Capacity, corruption, incompatible schema
and integrity failures return explicit errors; no empty-store success fallback.
Retain a trusted workspace backup, including its integrity key, under your
organization's access controls. Restore while the service is stopped. A lock
left after a crash requires operator recovery while no service is running;
the app does not guess that a lock is safe to delete. There is no automatic
archival, externally authenticated approval, assignment, reminder or deletion UI.

## Reusable offline validation

From the repository directory:

```powershell
node --test conditional-access-evidence.test.js action-workflow.test.js evidence-authority.test.js setup-decisions-server.test.js enablement-playbook.test.js
node tests\action-browser.test.js
```

The browser runner uses the already provisioned Playwright installation under
`reviews\value-realization-postbuild-e2e-tester-e2e\node_modules`. Set
`PLAYWRIGHT_MODULE` to another installed `playwright` module if needed.
It launches its own random-port synthetic server and blocks non-fixture origins.
For manual synthetic screenshots, start:

```powershell
node tests\action-fixture.js
```

The launcher prints `ACTION_FIXTURE_READY http://127.0.0.1:<random-port>`.
Open that exact URL with `?page=remediation`; never use an existing tenant server
for this exercise. The fixture creates a fresh workspace within `tests`, supplies
only synthetic observations and substitutes all external adapters.

## Screenshots

The [visual tour](VISUAL-TOUR.md#3-prepare-corrections) was refreshed on
**11 September 2026**. It shows the action list, a licensing action with supported
technical verification, and a manually recorded central-team hand-off that
remains unverified. All screenshots use explicitly labelled synthetic data;
they do not establish a successful live-tenant rollout.
