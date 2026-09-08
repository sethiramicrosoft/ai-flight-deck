(function (root) {
  "use strict";

  function mount({ container, api, monitorJob, context, onSaved, onError }) {
    let enabled = false;
    let directoryJobId = null;
    let decisions = {};
    let busy = false;
    let workflowRunning = false;
    container.innerHTML = `
      <h3 tabindex="-1">Your setup decisions</h3>
      <p>These actions record the intended assessment scope and policy decisions locally. They do not change Microsoft settings or approve a readiness check.</p>
      <p class="source-status" data-setup-status role="status">Connect to the updated local service to record decisions.</p>
      <details class="setup-form" id="setup-pilotCohort">
        <summary>Select and approve pilot users</summary>
        <p>Search the live directory, select users or groups, and name the accountable owner. Group membership is resolved within explicit limits before the cohort is saved. No CSV is required.</p>
        <form data-directory-search>
          <div class="field-grid">
            <label class="field">Search name or user principal name<input name="query" maxlength="80" placeholder="Start of a name"></label>
            <label class="field">Search for<select name="kind"><option value="users">Users</option><option value="groups">Groups</option></select></label>
          </div>
          <button class="btn" type="submit">Search directory</button>
        </form>
        <form data-directory-cohort hidden>
          <p data-directory-description role="status"></p>
          <div class="candidate-list" data-directory-items></div>
          <div class="field-grid">
            <label class="field">Pilot name<input name="name" required maxlength="120" value="Microsoft 365 Copilot pilot"></label>
            <label class="field">Accountable owner<input name="owner" required maxlength="200" placeholder="Name or role"></label>
          </div>
          <label class="candidate-row"><input type="checkbox" name="approved" required> I approve the selected users or group membership as the pilot scope.</label>
          <p>This saves a membership snapshot and re-evaluates available evidence. Group results can lag recent directory changes. It does not repeat the SharePoint file scan or grant anyone access.</p>
          <button class="btn primary" type="submit">Save approved pilot</button>
        </form>
      </details>
      <details class="setup-form" id="setup-hybridExchange">
        <summary>Record whether hybrid Exchange applies</summary>
        <form data-policy-decision="hybridExchange">
          <label class="field">Does the assessed scope use on-premises Exchange alongside Exchange Online?
            <select name="value"><option value="unknown">Not decided / not confirmed</option value="yes">Yes</option><option value="no">No</option></select>
          </label>
          <label class="field">Accountable owner<input name="owner" required maxlength="200" placeholder="Exchange owner"></label>
          <label class="field">Basis for the decision<textarea name="rationale" required maxlength="2000" placeholder="What was confirmed, and for which scope?"></textarea></label>
          <button class="btn" type="submit">Save hybrid decision</button>
          <p data-decision-saved role="status">No decision recorded for this scope.</p>
        </form>
      </details>
      <details class="setup-form" id="setup-webGrounding">
        <summary>Record the web-grounding policy decision</summary>
        <form data-policy-decision="webGrounding">
          <label class="field">May the assessed scope use public-web information?
            <select name="value"><option value="undecided">Not decided</option><option value="allow">Allow</option><option value="restrict">Restrict</option></select>
          </label>
          <label class="field">Accountable owner<input name="owner" required maxlength="200" placeholder="Business or security owner"></label>
          <label class="field">Decision and rationale<textarea name="rationale" required maxlength="2000" placeholder="Record the intended policy, not an unverified claim that it is already configured."></textarea></label>
          <button class="btn" type="submit">Save web-grounding decision</button>
          <p data-decision-saved role="status">No decision recorded for this scope.</p>
        </form>
      </details>`;

    const status = container.querySelector("[data-setup-status]");
    const cohortForm = container.querySelector("[data-directory-cohort]");
    const searchForm = container.querySelector("[data-directory-search]");
    const post = (url, body) => api(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Flight-Deck": "local-ui" },
      body: JSON.stringify(body)
    });
    function updateDisabled() {
      container.querySelectorAll("button,input,select,textarea").forEach(element => {
        element.disabled = !enabled || busy || workflowRunning;
      });
    }
    async function run(operation) {
      if (!enabled) { onError("Restart the local service to use the setup decision workflows."); return; }
      if (workflowRunning) { onError("Wait for the active workflow to finish before changing the assessment setup."); return; }
      if (busy) return;
      busy = true;
      updateDisabled();
      try { await operation(); }
      catch (error) { status.textContent = error.message; onError(error.message); }
      finally { busy = false; updateDisabled(); }
    }
    searchForm.addEventListener("submit", event => {
      event.preventDefault();
      const query = searchForm.elements.query.value.trim();
      const kind = searchForm.elements.kind.value;
      run(async () => {
        directoryJobId = null;
        cohortForm.hidden = true;
        status.textContent = "Searching the selected tenant. Complete Microsoft sign-in if prompted.";
        const job = await post("/api/directory-search", { query, kind });
        const outcome = await monitorJob(job.id);
        if (outcome?.status !== "completed") throw new Error("Directory search was cancelled; no selection was saved.");
      });
    });
    cohortForm.addEventListener("submit", event => {
      event.preventDefault();
      const selectedIds = [...cohortForm.querySelectorAll("[data-directory-id]:checked")]
        .map(input => input.dataset.directoryId);
      const input = {
        directoryJobId, selectedIds,
        name: cohortForm.elements.name.value.trim(),
        owner: cohortForm.elements.owner.value.trim(),
        approved: cohortForm.elements.approved.checked
      };
      run(async () => {
        if (!directoryJobId || !selectedIds.length) throw new Error("Search the directory and select at least one user or group.");
        const job = await post("/api/directory-cohort", input);
        status.textContent = "Resolving the approved pilot and re-evaluating available evidence.";
        const outcome = await monitorJob(job.id);
        if (outcome?.status !== "completed") throw new Error("Pilot approval did not complete. Review the saved scope before retrying.");
        directoryJobId = null;
        cohortForm.hidden = true;
        await refresh();
        status.textContent = "Approved pilot saved. Available evidence was re-evaluated; unsupported checks remain unresolved.";
        onSaved();
      });
    });
    container.querySelectorAll("[data-policy-decision]").forEach(form => {
      form.addEventListener("submit", event => {
        event.preventDefault();
        const input = {
          kind: form.dataset.policyDecision, value: form.elements.value.value,
          owner: form.elements.owner.value.trim(), rationale: form.elements.rationale.value.trim(),
          cohortId: context()?.cohortId
        };
        run(async () => {
          if (!input.cohortId) throw new Error("Load a tenant assessment before recording a scoped decision.");
          applyDecisions(await post("/api/setup-decisions", input));
          status.textContent = "Decision recorded locally. Microsoft settings and readiness results were not changed.";
          onSaved();
        });
      });
    });

    function applyDecisions(payload) {
      decisions = payload?.decisions || {};
      for (const form of container.querySelectorAll("[data-policy-decision]")) {
        const saved = decisions[form.dataset.policyDecision];
        form.elements.value.value = saved?.value || (form.dataset.policyDecision === "hybridExchange" ? "unknown" : "undecided");
        form.elements.owner.value = saved?.owner || "";
        form.elements.rationale.value = saved?.rationale || "";
        form.querySelector("[data-decision-saved]").textContent = saved
          ? `Recorded by ${saved.owner} on ${new Date(saved.recordedAt).toLocaleString()}. This is a decision, not configuration verification.`
          : "No decision recorded for this scope.";
      }
    }
    async function refresh() {
      if (!enabled || !context()?.cohortId) { applyDecisions(null); return; }
      applyDecisions(await api("/api/setup-decisions"));
    }
    function acceptDirectoryResult(result, jobId) {
      const items = result?.items;
      if (!Array.isArray(items) || items.length > 50 || !["users", "groups"].includes(result.kind)) {
        throw new Error("The directory search returned an invalid or oversized result.");
      }
      if (typeof result.tenantId !== "string" ||
          result.tenantId.toLowerCase() !== context()?.tenantId?.toLowerCase()) {
        throw new Error("Directory results do not match the loaded assessment tenant. Reload the assessment before selecting users.");
      }
      directoryJobId = jobId;
      const list = container.querySelector("[data-directory-items]");
      list.replaceChildren();
      for (const item of items) {
        const label = document.createElement("label");
        label.className = "candidate-row";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.dataset.directoryId = item.id;
        const text = document.createElement("span");
        text.textContent = item.userPrincipalName
          ? `${item.displayName || item.userPrincipalName} (${item.userPrincipalName})`
          : item.displayName || item.id;
        label.append(checkbox, text);
        list.append(label);
      }
      cohortForm.hidden = !items.length;
      const message = `${items.length} ${result.kind} returned.${result.hasMore ? " More matches exist; refine the search." : ""} Select only the intended pilot scope.`;
      container.querySelector("[data-directory-description]").textContent = message;
      status.textContent = items.length ? message : "No matches returned. Refine the search; this does not prove the directory is empty.";
      updateDisabled();
    }
    updateDisabled();
    return {
      refresh, acceptDirectoryResult,
      getDecisions: () => decisions,
      setWorkflowRunning(value) { workflowRunning = value === true; updateDisabled(); },
      async setEnabled(value) {
        enabled = value === true;
        updateDisabled();
        status.textContent = enabled
          ? "Choose pilot users and record policy decisions below. App limitations are separate."
          : "The updated local service and a live assessment are required. Restart the service if it has not loaded the new workflows.";
        await refresh();
      },
      open(id) {
        const panel = container.querySelector(`#setup-${id}`);
        if (!panel) throw new Error("Unknown setup decision.");
        panel.open = true;
        panel.scrollIntoView({ block: "start", behavior: "smooth" });
        panel.querySelector("summary").focus();
      }
    };
  }
  root.FlightDeckSetupUI = { mount };
})(typeof globalThis !== "undefined" ? globalThis : this);
