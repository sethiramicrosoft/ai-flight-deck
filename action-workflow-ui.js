(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FlightDeckActions = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const stateLabels = { Draft: "Work not started", InProgress: "Work in progress", ReportedComplete: "Work reported complete" };
  const resultLabels = { Unverified: "Not verified", Reopened: "Needs attention again",
    TechnicalVerification: "Settings verified by a supported check", SupportedOwnerStatement: "Owner statement accepted (not a technical check)" };
  const supportLabels = { Unverified: "No supported verification yet",
    TechnicalVerification: "Supported automated check", SupportedOwnerStatement: "Supported owner statement" };
  const responsibilityLabels = { unknown: "Not yet known", local: "Your business unit",
    central: "Central IT", shared: "Your business unit and central IT" };
  const eventLabels = { Proposed: "Action created", save: "Progress saved", start: "Guided work started",
    complete: "Completion reported", reopen: "Work reopened", EvidenceChecked: "Saved evidence checked" };
  function handoff(a, fields = a.fields) {
    return [
      "DRAFT — MANUAL HAND-OFF ONLY. Not sent, assigned or identity-verified.",
      `Control: ${a.controlId} — ${a.proposal.guidance.title}`,
      `Tenant: ${a.context.tenantId}; cohort: ${a.context.cohort.id}`,
      `Context: ${a.context.id}`,
      `Scope: ${fields.scopeDescription || "Not recorded"}`,
      `Owner / team: ${fields.owner || "Not recorded"} / ${fields.team || "Not recorded"}`,
      `Responsibility: ${responsibilityLabels[fields.responsibility]}; due: ${fields.dueDate || "Not recorded"}`,
      `Proposed work: ${fields.proposedWork}`,
      `Why: ${a.proposal.guidance.whyItMatters}`,
      `Acceptance criterion (app policy): ${a.proposal.acceptanceCriterion}`,
      `Prerequisites: ${fields.prerequisites || "Not recorded"}`,
      `Approval required: ${fields.approvalRequired ? "Yes" : "No (user-recorded)"}`,
      `Approval record (user-recorded, not authenticated): ${fields.approvalRecord || "Not recorded"}`,
      `Central IT request: ${fields.centralRequest || "Not recorded"}`,
      `Central response: ${fields.centralResponse || "Not recorded"}`,
      `Response evidence reference: ${fields.centralEvidence || "Not recorded"}`,
      "Please review scope, authority, impact and rollback through the normal change process before any administrator acts.",
      "After reported completion, collect fresh evidence. A completed hand-off is not proof of settings.",
      "The app sends nothing and makes no Microsoft 365 changes."
    ].join("\n\n");
  }
  function decisionText(d) {
    return [
      "AI FLIGHT DECK - PILOT DECISION SNAPSHOT",
      `Decision: ${d.outcome}`,
      `Pilot: ${d.pilot} | ${d.people} recorded people | Tenant: ${d.tenantId}`,
      `Prepared: ${d.generatedAt} | Assessment: ${d.assessmentAt || "No matching current assessment"} | Catalogue: ${d.catalogueVersion}`,
      `${d.checks.length - d.remaining} of ${d.checks.length} checks meet current rules; ${d.remaining} remain unconfirmed or need work.`,
      "A current check is distinct from an action verified after completion. Human statements are not independent technical evidence. Names are records, not assignments.",
      "This snapshot is not rollout authorisation, Microsoft certification or continuous monitoring. Refresh before relying on it. Review again after evidence expiry, changed pilot membership or changed settings.",
      ...d.checks.map(c => [
        `${c.id} - ${c.title}`, `${c.status} | ${c.method} | Action: ${c.actionState}`,
        `Owner / team: ${c.owner || "Not recorded"} / ${c.team || "Not recorded"}`,
        `Observed: ${c.observedAt || "Not available"} | Review by: ${c.freshUntil || "Not available"}`,
        `Next: ${c.nextAction}`
      ].join("\n"))
    ].join("\n\n");
  }
  function mount({ container, navigate, collect, openStatement }) {
    const el = (tag, content, className) => {
      const node = document.createElement(tag);
      if (content != null) node.textContent = content;
      if (className) node.className = className;
      return node;
    };
    const button = (label, id, fn) => {
      const node = el("button", label, "btn");
      node.type = "button"; node.id = id;
      node.addEventListener("click", fn); return node;
    };
    let data = null, selected = null, busy = false;
    const status = el("p", "", "action-status");
    status.id = "actions-status"; status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    const header = el("div");
    header.append(el("h2", "Move your pilot forward"),
      el("p", "Choose pilot > see blockers > complete next action > check evidence > review decision."),
      el("p", "Flight Deck helps you follow findings through to evidence. Nothing is sent or changed in Microsoft 365."));
    const controls = el("div", null, "action-picker");
    const contextLabel = el("label", "Saved tenant / cohort snapshot");
    const context = el("select"); context.id = "action-context"; contextLabel.htmlFor = context.id;
    const controlLabel = el("label", "Readiness check to act on");
    const control = el("select"); control.id = "action-control"; controlLabel.htmlFor = control.id;
    const start = button("Create or resume action", "action-create", () => run(async () => {
      const action = await api("/api/actions", { contextId: context.value, controlId: control.value });
      selected = action.id; await refresh();
      container.querySelector("#action-editor-title")?.focus();
    }));
    controls.append(contextLabel, context, controlLabel, control, start);
    const list = el("div"); list.id = "action-list";
    const editor = el("div"); editor.id = "action-editor";
    const decision = el("details"); decision.id = "action-decision";
    const suggestion = el("div"); suggestion.id = "action-suggestion";
    container.append(header, status, button("Reload saved actions", "actions-reload", () => run(refresh)),
      decision, suggestion, controls, list, editor);
    context.addEventListener("change", renderDecision);
    function renderDecision() {
      const d = data?.decisions?.find(d => d.contextId === context.value);
      suggestion.replaceChildren();
      decision.replaceChildren(el("summary", d ? `Review pilot decision: ${d.outcome}` : "Review pilot decision"));
      if (!d) { decision.append(el("p", "Collect a baseline for the selected pilot first.")); return; }
      const candidates = d.checks.filter(c => !c.satisfied && c.method !== "Not supported by this version");
      const next = candidates.find(c => c.status === "Needs corrective work") || candidates[0];
      if (next) suggestion.append(el("p", `Next supported action for ${d.pilot}: ${next.title}`),
        button("Work on this next", "action-suggested-start", () => { control.value = next.id; start.click(); }),
        el("p", "This prioritises an actionable check, not all rollout risk. Other required checks remain in the pilot decision."));
      decision.append(el("p", `${d.pilot}: ${d.checks.length - d.remaining} of ${d.checks.length} checks meet current rules. ${d.remaining} remain unconfirmed or need work.`),
        el("p", "Four supported technical checks and eleven owner-statement checks. Other requirements remain visible. This is not rollout approval or a security certification."));
      const preview = el("pre", decisionText(d)); preview.id = "action-decision-preview";
      decision.append(preview, button("Download current decision snapshot", "action-decision-download", () => run(async () => {
        await refresh();
        const current = data.decisions.find(d => d.contextId === context.value);
        if (!current) throw new Error("The selected pilot context changed. Collect and review its current assessment first.");
        const url = URL.createObjectURL(new Blob([decisionText(current)], { type: "text/plain;charset=utf-8" }));
        const link = el("a"); link.href = url; link.download = "flight-deck-pilot-decision.txt"; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        status.textContent = "Current decision snapshot downloaded locally. Nothing was shared.";
      })));
    }
    async function api(route, body) {
      const res = await fetch(route, body ? { method: "POST", headers: {
        "Content-Type": "application/json", "X-Flight-Deck": "local-ui"
      }, body: JSON.stringify(body) } : {});
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Unable to save actions.");
      return json;
    }
    async function run(fn) {
      if (busy) return;
      busy = true; container.setAttribute("aria-busy", "true"); status.textContent = "";
      try { await fn(); }
      catch (error) { status.textContent = error.message; }
      finally { busy = false; container.removeAttribute("aria-busy"); }
    }
    async function refresh() {
      data = await api("/api/actions");
      const oldControl = control.value, oldContext = context.value;
      control.replaceChildren(...data.controls.map(c => {
        const option = el("option", `${c.title} — ${supportLabels[c.support]} (${c.id})`); option.value = c.id; return option;
      }));
      context.replaceChildren(...data.contexts.map(c => {
        const option = el("option", `${c.tenantId} / ${c.cohort.name || c.cohort.id} / ${c.cohort.principalIds?.length || 0} recorded people`);
        option.value = c.id; return option;
      }));
      if (data.controls.some(c => c.id === oldControl)) control.value = oldControl;
      if (data.contexts.some(c => c.id === oldContext)) context.value = oldContext;
      start.disabled = !data.contexts.length;
      if (!data.contexts.length) status.textContent = "No current assessed cohort matches the saved pilot selection. Recollect the selected cohort in Set up; prior actions remain historical.";
      renderDecision(); renderList(); renderEditor();
    }
    function renderList() {
      list.replaceChildren(el("h3", "Saved actions"));
      if (!data.actions.length) list.append(el("p", "No saved actions yet. Choose a check above or use Start guided action in Assessment. A saved baseline is required; demo or imported display results cannot create source facts."));
      for (const a of data.actions) {
        const card = el("article", null, "action-card");
        const open = button(`${a.controlId}: ${a.proposal.guidance.title}`, `open-action-${a.id}`, () => {
          selected = a.id; renderEditor(); container.querySelector("#action-editor-title")?.focus();
        });
        card.append(open, el("p", `${stateLabels[a.state]} · ${resultLabels[a.verification.disposition]} · ${a.fields.owner || "Owner not recorded"} · ${a.historical ? "Previous assessment scope — read only" : "Current assessment scope"}`));
        list.append(card);
      }
    }
    function renderEditor() {
      editor.replaceChildren();
      const a = data.actions.find(a => a.id === selected);
      if (!a) return;
      const heading = el("h3", `${a.controlId}: ${a.proposal.guidance.title}`);
      heading.id = "action-editor-title"; heading.tabIndex = -1;
      const result = el("p", `${resultLabels[a.verification.disposition]}: ${a.verification.reason}`); result.id = "action-verification";
      const supported = data.controls.find(c => c.id === a.controlId)?.support;
      const next = a.historical ? "This is a previous pilot scope. Create a new action for the current pilot." :
        ["TechnicalVerification", "SupportedOwnerStatement"].includes(a.verification.disposition)
          ? "Review the pilot decision. This action has supporting evidence, but other requirements may still block rollout." :
        a.state === "Draft" ? "Record who will do the work, its scope and the required approval, then start guided work." :
        a.state === "InProgress" ? "Follow the guidance and report what was completed. Reporting completion is not proof." :
        supported === "Unverified" ? "Review this requirement outside Flight Deck. This version cannot verify it; rescanning will not resolve that limitation." :
        supported === "SupportedOwnerStatement" ? "Record a fresh owner statement below, then collect and check evidence." :
          "Collect fresh evidence below. Evidence from before completion cannot close this action.";
      const nextStep = el("p", `Your next step: ${next}`, "action-status"); nextStep.id = "action-next-step";
      editor.append(heading, el("p", `Saved version ${a.revision} · ${stateLabels[a.state]} · Pilot: ${a.context.cohort.name || a.context.cohort.id}`),
        nextStep, result, el("p", `Why: ${a.proposal.guidance.whyItMatters}`),
        el("p", `Frozen acceptance criterion: ${a.proposal.acceptanceCriterion}`),
        el("p", "The criterion is application policy, not a Microsoft certification. Names and approval records below are entered by you, not identity-verified authorization or notifications."));
      const form = el("form"); form.id = "action-form";
      form.addEventListener("submit", event => { event.preventDefault(); operate("save"); });
      const fieldset = el("fieldset"); fieldset.disabled = a.historical || a.state === "ReportedComplete";
      fieldset.append(el("legend", "Work record"));
      function section(title, id, open) {
        const details = el("details"); details.id = id; details.open = open;
        details.append(el("summary", title)); fieldset.append(details); return details;
      }
      let currentSection = section("1. Scope, owner and approval", "action-plan", a.state === "Draft");
      const inputs = {};
      function field(key, title, type = "textarea", options = null) {
        const wrap = el("div", null, "action-field");
        const label = el("label", title); label.htmlFor = `action-${key}`;
        const input = el(options ? "select" : type === "textarea" ? "textarea" : "input");
        input.id = label.htmlFor; input.name = key;
        if (options) options.forEach(v => { const option = el("option", responsibilityLabels[v] || v); option.value = v; input.append(option); });
        else if (type !== "textarea") input.type = type;
        if (type === "checkbox") input.checked = a.fields[key] === true;
        else { input.value = a.fields[key] || ""; if (!options && type !== "date") input.maxLength = 4000; }
        inputs[key] = input; wrap.append(label, input); currentSection.append(wrap);
        return input;
      }
      field("scopeDescription", "Exact scope and intended affected resources");
      field("owner", "Work owner name (record only)", "text");
      field("team", "Owner team", "text");
      field("responsibility", "Who must act?", "select", ["unknown", "local", "central", "shared"]);
      field("dueDate", "Due date (optional)", "date");
      field("proposedWork", "Concrete work proposed");
      field("approvalRequired", "Approval required under your process", "checkbox");
      field("approvalRecord", "Approval decision, approver and reference (user-recorded, not authenticated)");
      field("prerequisites", "Prerequisites, permissions, impact and rollback notes");
      field("prerequisitesConfirmed", "I have reviewed the prerequisites and normal change process", "checkbox");
      const deps = el("fieldset"); deps.append(el("legend", "Prerequisite saved actions (same context only)"));
      const depInputs = data.actions.filter(d => d.id !== a.id && d.context.id === a.context.id).map(d => {
        const label = el("label", `${d.controlId} — ${stateLabels[d.state]}`);
        const input = el("input"); input.type = "checkbox"; input.value = d.id;
        input.checked = a.fields.dependencies.includes(d.id); label.prepend(input); deps.append(label); return input;
      });
      if (!depInputs.length) deps.append(el("p", "No other actions in this exact context."));
      currentSection.append(deps);
      currentSection = section("2. Follow the guidance", "action-guidance", a.state === "InProgress");
      const guidance = a.proposal.guidance;
      currentSection.append(el("p", `Where: ${guidance.portal} > ${guidance.adminPath}`),
        el("p", `Suggested roles: ${guidance.responsibleRoles.join(", ")}. Required read permissions: ${guidance.prerequisites.permissions.join(", ") || "See collection instructions"}.`),
        el("p", `Licence prerequisites: ${guidance.prerequisites.licenses.join(", ") || "See the Microsoft guidance"}.`));
      const steps = el("ol");
      const stepInputs = guidance.steps.map((step, i) => {
        const li = el("li"); const label = el("label", step); const input = el("input");
        input.type = "checkbox"; input.checked = a.fields.completedSteps.includes(i);
        input.dataset.actionStep = i; label.prepend(input); li.append(label); steps.append(li); return input;
      });
      currentSection.append(steps);
      for (const source of guidance.sources) {
        try {
          const url = new URL(source.url);
          if (url.protocol !== "https:" || !["learn.microsoft.com", "support.microsoft.com"].includes(url.hostname)) continue;
          const link = el("a", source.title); link.href = url.href; link.target = "_blank"; link.rel = "noopener noreferrer";
          currentSection.append(link);
        } catch { /* Do not render unrecognized documentation URLs. */ }
      }
      currentSection.append(el("p", `Collection limitation: ${guidance.collection.limitation}`));
      currentSection = section("3. Central IT request and response", "action-shared",
        a.state !== "ReportedComplete" && ["central", "shared"].includes(a.fields.responsibility));
      inputs.responsibility.addEventListener("change", () => {
        editor.querySelector("#action-shared").open = ["central", "shared"].includes(inputs.responsibility.value);
      });
      field("centralRequest", "Central IT request and reference (required for central/shared work)");
      field("centralResponse", "Central IT response recorded locally");
      field("centralEvidence", "Response evidence reference (not proof by itself)");
      const preview = el("textarea"); preview.id = "action-handoff-preview"; preview.readOnly = true; preview.rows = 12;
      const previewLabel = el("label", "Full hand-off draft preview — nothing sent"); previewLabel.htmlFor = preview.id;
      function values() {
        const fields = Object.fromEntries(Object.entries(inputs).map(([key, input]) =>
          [key, input.type === "checkbox" ? input.checked : input.value]));
        fields.dependencies = depInputs.filter(i => i.checked).map(i => i.value);
        fields.completedSteps = stepInputs.flatMap((input, i) => input.checked ? [i] : []);
        return fields;
      }
      const updatePreview = () => { preview.value = handoff(a, values()); };
      fieldset.addEventListener("input", updatePreview); updatePreview();
      const handoffDetails = el("details"); handoffDetails.id = "action-handoff";
      handoffDetails.append(el("summary", "Preview and copy a hand-off draft"), previewLabel, preview,
        button("Copy reviewed draft (not sent)", "action-copy", () => run(async () => {
        await navigator.clipboard.writeText(preview.value);
        status.textContent = "Draft copied. Nothing was sent and no owner was notified.";
      })));
      form.append(fieldset, handoffDetails);
      const collection = el("details");
      collection.append(el("summary", "How to collect the required evidence"));
      const instructions = el("ol");
      guidance.collection.steps.forEach(step => instructions.append(el("li", step)));
      collection.append(instructions, el("p", guidance.collection.limitation),
        button("Open Set up for statements and connections", "action-open-setup", () => navigate("guide")));
      form.append(collection);
      if (!a.historical && supported === "SupportedOwnerStatement") {
        if (["AFD-OPS-005", "AFD-ADOPT-003"].includes(a.controlId)) {
          const statement = el("details"); statement.id = "action-owner-statement";
          statement.open = a.state === "ReportedComplete";
          statement.append(el("summary", "Record the responsible person's review"),
            el("p", "These are recorded human statements, not independent checks or authenticated approval. Report completion first, then record the review and its real supporting references. No JSON is needed."));
          const statementInputs = {};
          const fields = a.controlId === "AFD-OPS-005"
            ? [["technicalContact", "Technical escalation contact", "text"], ["executiveContact", "Executive escalation contact", "text"]]
            : [["intake", "Support intake channel or reference", "text"], ["owner", "Support owner", "text"], ["responseTarget", "Agreed response target", "text"], ["deliveredAt", "Training delivered at", "datetime-local"]];
          fields.push(["statement", "What did the responsible person review?"],
            ["references", "Supporting references (one per line)"], ["expiresAt", "Review this statement by", "datetime-local"]);
          for (const [key, title, type] of fields) {
            const label = el("label", title); label.htmlFor = `action-statement-${key}`;
            const input = el(type ? "input" : "textarea"); input.id = label.htmlFor;
            if (type) input.type = type;
            if (type !== "datetime-local") input.maxLength = 4000;
            statementInputs[key] = input; statement.append(label, input);
          }
          statement.append(button("Save reviewed owner statement locally", "action-statement-save", () => run(async () => {
            if (a.state !== "ReportedComplete") throw new Error("Report completion before recording closure evidence.");
            const values = Object.fromEntries(Object.entries(statementInputs).map(([k, input]) => [k, input.value.trim()]));
            if (Object.values(values).some(v => !v)) throw new Error("Fill every review field, including references and review date.");
            const now = new Date();
            const expires = new Date(values.expiresAt);
            const maxHours = Math.min(a.proposal.catalogueControl.freshnessHours, 168);
            if (!Number.isFinite(expires.getTime()) || expires <= now || expires - now > maxHours * 3600000) {
              throw new Error(`Choose a future review date within ${maxHours} hours.`);
            }
            if (a.controlId === "AFD-ADOPT-003" && (!Number.isFinite(Date.parse(values.deliveredAt)) ||
                Date.parse(values.deliveredAt) > now.getTime() || now.getTime() - Date.parse(values.deliveredAt) > 30 * 86400000)) {
              throw new Error("Record actual training delivered within the last 30 days, not a planned or future session.");
            }
            const payload = a.controlId === "AFD-OPS-005"
              ? { technicalContact: values.technicalContact, executiveContact: values.executiveContact,
                tenantId: a.context.tenantId, reviewedAt: now.toISOString() }
              : { support: { intake: values.intake, owner: values.owner, responseTarget: values.responseTarget },
                training: { deliveredAt: new Date(values.deliveredAt).toISOString() } };
            const latest = await api("/api/actions");
            if (!latest.actions.some(item => item.id === a.id && !item.historical && item.revision === a.revision)) {
              throw new Error("This action or pilot changed. Reload and review before saving the statement.");
            }
            await api("/api/attestations", { tenantId: a.context.tenantId, cohortId: a.context.cohort.id,
              actionId: a.id, actionRevision: a.revision,
              controlId: a.controlId, decision: "Pass", statement: values.statement,
              expiresAt: expires.toISOString(), evidenceReferences: values.references.split(/\r?\n/).filter(Boolean), data: payload });
            status.textContent = "Owner statement saved locally, not yet accepted as evidence. Review and run the read-only collection below.";
          })));
          form.append(statement);
        } else if (openStatement) {
          form.append(button("Open this requirement's owner-statement form", "action-open-statement",
            () => openStatement(a.controlId)));
        }
      }
      if (!a.historical) {
        const operations = el("div", null, "actions-row");
        if (a.state !== "ReportedComplete") {
          operations.append(button("Save progress", "action-save", () => operate("save")));
          if (a.state === "Draft") operations.append(button("Start guided work", "action-start", () => operate("start")));
          else {
            const reportLabel = el("label", "4. What work was completed? (local report, not proof)"); reportLabel.htmlFor = "action-completion";
            const report = el("textarea"); report.id = reportLabel.htmlFor; report.maxLength = 4000;
            form.append(reportLabel, report);
            operations.append(button("Report completion", "action-complete", () => operate("complete", report.value)));
          }
        } else operations.append(button("Reopen work", "action-reopen", () => operate("reopen")));
        operations.append(button("Check saved evidence", "action-check", () => operate("check")));
        form.append(operations);
        const consent = el("details"); consent.id = "action-scan-consent";
        consent.append(el("summary", "Collect fresh read-only evidence, then check this action"),
          el("p", "This runs the existing full workload collection, not a narrow action-only scan. It can require Microsoft sign-in and reads connected services. It refreshes the saved assessment, but makes no tenant changes. Save progress first. Report completion before collecting evidence for closure."));
        const label = el("label", "I agree to this read-only collection now");
        const agree = el("input"); agree.type = "checkbox"; agree.id = "action-scan-agree"; label.prepend(agree);
        const scan = button("Run read-only collection, then check", "action-scan", () => run(async () => {
          if (!agree.checked) throw new Error("Review and agree to the read-only collection first.");
          if (a.state !== "ReportedComplete") throw new Error("Report completion before collecting closure evidence.");
          try { await collect(); }
          finally { navigate("remediation"); }
          await refresh(); status.textContent = "Collection finished. The action was checked against the latest saved evidence; review the result above.";
        }));
        consent.append(label, scan);
        if (supported !== "Unverified") form.append(consent);
      }
      editor.append(form);
      const evidence = el("details"); evidence.id = "action-evidence";
      evidence.append(el("summary", "Frozen starting evidence, context and latest verification provenance"),
        el("pre", JSON.stringify({ context: a.context, proposal: a.proposal,
          verification: a.verification, completionReport: a.completionReport, completedAt: a.completedAt }, null, 2)));
      const history = el("details"); history.id = "action-history";
      history.append(el("summary", `Action history (${a.history.length} entries)`));
      const events = el("ol");
      for (const entry of a.history) {
        const row = el("li");
        row.append(el("strong", `${eventLabels[entry.event] || entry.event} — ${new Date(entry.at).toLocaleString()}`));
        if (entry.details.disposition) row.append(el("p", `${resultLabels[entry.details.disposition]}: ${entry.details.reason}`));
        if (entry.details.fields) row.append(el("p", `Recorded owner: ${entry.details.fields.owner || "Not recorded"}. Team: ${entry.details.fields.team || "Not recorded"}.`));
        if (entry.event === "complete") row.append(el("p", entry.details.completionReport));
        events.append(row);
      }
      const rawHistory = el("details");
      rawHistory.append(el("summary", "Advanced: complete saved history (JSON)"), el("pre", JSON.stringify(a.history, null, 2)));
      history.append(events, rawHistory);
      editor.append(evidence, history);
      function operate(operation, completionReport) {
        return run(async () => {
          const input = { revision: a.revision, operation };
          if (["save", "start", "complete"].includes(operation)) input.fields = values();
          if (operation === "complete") input.completionReport = completionReport;
          await api(`/api/actions/${a.id}`, input);
          await refresh(); status.textContent = "Saved locally. No message sent, permission granted or tenant setting changed.";
        });
      }
    }
    async function pick(controlId) {
      await run(async () => {
        navigate("remediation");
        await refresh();
        if (data.controls.some(c => c.id === controlId)) control.value = controlId;
        control.focus(); container.scrollIntoView({ block: "start" });
      });
    }
    return { refresh: () => run(refresh), pick };
  }
  return { mount, handoff, decisionText };
});
