(function (root) {
  "use strict";

  function mount({ container, api, monitorJob, context, onSaved, onError }) {
    let enabled = false;
    let directoryJobId = null;
    let decisions = {};
    let busy = false;
    let workflowRunning = false;
    container.innerHTML = `
      <h2 tabindex="-1">Choose the people and settings for your pilot</h2>
      <p>A pilot is the group of people you want to try Microsoft 365 Copilot with before a wider rollout. Tell Flight Deck who those people are, who is responsible for the pilot, and which settings they are expected to use.</p>
      <p>First run a tenant scan, or load a saved tenant assessment with the local service connected. Then select pilot users below before recording the two policy choices. These forms save notes in Flight Deck on this computer. They do not assign licences, change Microsoft 365 settings, or grant anyone access.</p>
      <p class="source-status" data-setup-status role="status">Checking whether a tenant assessment and the local service are available.</p>
      <details class="setup-form" id="setup-pilotCohort">
        <summary>Select and approve pilot users</summary>
        <p>Choose the people this assessment should consider for the pilot. Flight Deck searches your connected Microsoft Entra directory; it does not assume that everyone with a Copilot licence belongs in your pilot.</p>
        <ol>
          <li>Search by the start of a person's name, their sign-in address, or a group name. Choose whether to search for users or groups.</li>
          <li>Select the results you want, enter a pilot name and the person or team responsible, and tick the approval box.</li>
          <li>Select Save approved pilot. Flight Deck saves the selected people and checks the information already collected against that list.</li>
        </ol>
        <p>You can select up to 50 users or 10 groups in one search result. For groups, Flight Deck reads the users inside the selected groups, including nested groups, and removes duplicates. It stops if membership cannot be read completely within 1,000 membership records and 10 pages of results. Narrow the selection if it is too large.</p>
        <form data-directory-search>
          <div class="field-grid">
            <label class="field">Name or Microsoft 365 sign-in address<input name="query" maxlength="80" placeholder="For example: Alex or alex@contoso.com"></label>
            <label class="field">Search for<select name="kind"><option value="users">Users</option><option value="groups">Groups</option></select></label>
          </div>
          <button class="btn" type="submit">Search directory</button>
        </form>
        <form data-directory-cohort hidden>
          <p data-directory-description role="status"></p>
          <div class="candidate-list" data-directory-items></div>
          <div class="field-grid">
            <label class="field">Pilot name<input name="name" required maxlength="120" value="Microsoft 365 Copilot pilot"></label>
            <label class="field">Person or team responsible for this pilot<input name="owner" required maxlength="200" placeholder="For example: Alex Chen, Copilot program owner"></label>
          </div>
          <label class="candidate-row"><input type="checkbox" name="approved" required> I approve the selected people as the participants in this pilot.</label>
          <p>The saved list records membership at the time of this selection; it does not update itself when a group changes. Recent group changes may not appear immediately. Saving the list does not repeat the SharePoint file scan, assign licences, or grant access. Naming an owner here does not send that person a task or verify their approval authority.</p>
          <button class="btn primary" type="submit">Save approved pilot</button>
        </form>
      </details>
      <details class="setup-form" id="setup-hybridExchange">
        <summary>Tell us whether pilot users also use an on-premises Exchange server</summary>
        <p>Some organizations keep an Exchange email server on their own network as well as using Exchange Online. This is called hybrid Exchange. Flight Deck needs to know whether that arrangement applies to your pilot, because a cloud-only scan cannot inspect your on-premises server.</p>
        <p>Ask your email administrator if you are unsure. Choose Yes or No only after confirming the answer, name the person who confirmed it, and explain what they checked. Otherwise leave the answer unconfirmed.</p>
        <form data-policy-decision="hybridExchange">
          <label class="field">Do any pilot users use your organization's Exchange server alongside Exchange Online?
            <select name="value"><option value="unknown">Not decided / not confirmed</option value="yes">Yes</option><option value="no">No</option></select>
          </label>
          <label class="field">Person or team confirming the answer<input name="owner" required maxlength="200" placeholder="For example: Email administration team"></label>
          <label class="field">How was this confirmed?<textarea name="rationale" required maxlength="2000" placeholder="Describe who checked the email setup, when they checked it, and which pilot users the answer covers."></textarea></label>
          <button class="btn" type="submit">Save hybrid decision</button>
          <p>Saving this answer does not inspect or change Exchange configuration. Any technical checks still need information from the relevant email system.</p>
          <p data-decision-saved role="status">No answer has been saved for this pilot.</p>
        </form>
      </details>
      <details class="setup-form" id="setup-webGrounding">
        <summary>Record whether Copilot may use information from the public web</summary>
        <p>Copilot can use public-web information to help answer some questions. Microsoft calls this web grounding. Record whether your organization intends to allow or restrict that feature for the pilot.</p>
        <p>Confirm the choice with the person responsible for your Copilot or security policy. Record their name and the reason for the choice. This is a note of the intended policy, not a switch that changes Copilot.</p>
        <form data-policy-decision="webGrounding">
          <label class="field">May Copilot use public-web information for these pilot users?
            <select name="value"><option value="undecided">Not decided</option><option value="allow">Allow</option><option value="restrict">Restrict</option></select>
          </label>
          <label class="field">Person or team responsible for this policy<input name="owner" required maxlength="200" placeholder="For example: Copilot program owner or security team"></label>
          <label class="field">Why was this choice made?<textarea name="rationale" required maxlength="2000" placeholder="Describe the policy and the approval or discussion supporting it. Do not claim the Microsoft setting has changed unless an administrator has checked it."></textarea></label>
          <button class="btn" type="submit">Save public-web policy choice</button>
          <p>Flight Deck cannot yet verify the effective Microsoft setting. An administrator must check and, if approved, change that setting in Microsoft 365.</p>
          <p data-decision-saved role="status">No answer has been saved for this pilot.</p>
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
      if (!enabled) { onError("Run or load a tenant assessment and connect the local service before saving pilot choices."); return; }
      if (workflowRunning) { onError("Wait for the current scan or other running operation to finish before changing the pilot choices."); return; }
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
        status.textContent = "Reading the selected users or group members, then checking the saved assessment against those people.";
        const outcome = await monitorJob(job.id);
        if (outcome?.status !== "completed") throw new Error("Pilot approval did not complete. Check which people are in the saved pilot before trying again.");
        directoryJobId = null;
        cohortForm.hidden = true;
        await refresh();
        status.textContent = "Approved pilot saved. The assessment has been checked against the selected people. Checks this version cannot perform still need to be assessed outside Flight Deck.";
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
          if (!input.cohortId) throw new Error("Run or load a tenant assessment before recording choices for a pilot.");
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
          ? `Saved with ${saved.owner} named as responsible on ${new Date(saved.recordedAt).toLocaleString()}. This records the answer; it does not confirm that the Microsoft setting matches it.`
          : "No answer has been saved for this pilot.";
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
      const message = `${items.length} ${result.kind} found.${result.hasMore ? " More matches exist; use a more specific name to find them." : ""} Select the people or groups you want in this pilot.`;
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
          ? "Select the pilot participants first, then record the email and public-web policy answers. The section below lists anything the assessment still cannot confirm."
          : "These forms need a loaded tenant assessment and a connection to the local service. Run or load an assessment first. If an older service is running, restart it to use these forms.";
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
