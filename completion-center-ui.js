(function (root) {
  "use strict";
  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = String(text);
    if (className) element.className = className;
    return element;
  }
  function render(container, plan, { onDecision, onControl, onCollect, onAttest }) {
    container.replaceChildren();
    const lanes = plan.lanes;
    if (!lanes) throw new Error("The completion plan does not expose actionable categories. Reload the updated application.");
    const descriptions = [
      ["userDecisions", "Your decisions", "Choose the assessment scope and record accountable decisions. Saving a decision does not prove that a Microsoft setting has been applied."],
      ["administratorActions", "Administrator actions", "Only act on a confirmed access, licence or collection requirement. An unavailable command is not automatically a missing permission."],
      ["configurationActions", "Configuration actions", "These are reported configuration findings that need review and new evidence after an approved change."],
      ["appLimitations", "App limitations", "These checks cannot currently be verified by the app. Repeated scans, permission grants or manual imports do not implement missing validation."]
    ];
    let found = false;
    for (const [key, title, description] of descriptions) {
      const items = lanes[key] || [];
      if (key === "configurationActions" && !items.length) continue;
      const lane = node("li", undefined, "completion-lane");
      lane.dataset.lane = key;
      lane.append(node("h3", `${title} (${items.length})`), node("p", description));
      const list = node("ul", undefined, "completion-blockers");
      lane.append(list);
      container.append(lane);
      if (!items.length) {
        list.append(node("li", key === "userDecisions"
          ? "No outstanding setup decision for this scope."
          : "No items in this category.", "source-status"));
        continue;
      }
      found = true;
      let visible = 0;
      const more = node("button", "Show more in this category", "btn");
      more.type = "button";
      function addPage() {
        const end = Math.min(items.length, visible + 5);
        for (; visible < end; visible++) {
          const item = items[visible];
          const row = node("li", undefined, "completion-blocker");
          const content = node("div");
          content.append(node("strong", item.controlId ? `${item.controlId}: ${item.title}` : item.title));
          if (item.owner) content.append(node("small", `Owner: ${item.owner}`, "completion-blocker-meta"));
          content.append(node("small", item.description || item.nextAction || item.reason || ""));
          if (item.description && item.nextAction && item.nextAction !== item.description) {
            content.append(node("small", item.nextAction));
          }
          if (item.why) content.append(node("small", item.why));
          if (item.warning) content.append(node("small", item.warning));
          if (item.limitations?.length) {
            const detail = node("details");
            detail.append(node("summary", "Why this is unresolved"),
              node("small", item.limitations.map(reason => `${reason.code}: ${reason.description}`).join("; ")));
            content.append(detail);
          }
          const action = node("button", undefined, "btn");
          action.type = "button";
          const decisionId = item.id || item.decisionId;
          if (["pilotCohort", "hybridExchange", "webGrounding"].includes(decisionId)) {
            action.textContent = "Record this decision";
            action.addEventListener("click", () => onDecision(decisionId));
          } else if (key === "appLimitations") {
            action.textContent = "View control definition";
            action.addEventListener("click", () => onControl(item.controlId));
          } else if (item.state === "SignedAttestationRequired") {
            action.textContent = "Record owner statement";
            action.addEventListener("click", () => onAttest(item.controlId));
          } else if (["AdminEvidenceRequired", "PowerPlatformEvidenceRequired", "RecollectionRequired", "LiveCollectionRequired"].includes(item.state)) {
            action.textContent = "Go to collection";
            action.addEventListener("click", onCollect);
          } else {
            action.textContent = "View required action";
            action.addEventListener("click", () => onControl(item.controlId));
          }
          action.setAttribute("aria-label", `${action.textContent}: ${item.controlId || item.title}`);
          if (item.controlId) action.dataset.controlId = item.controlId;
          content.append(action);
          row.append(content, node("span", key === "appLimitations" ? "App capability missing" : item.stateLabel || "Decision needed", "completion-state"));
          list.append(row);
        }
        more.hidden = visible >= items.length;
      }
      more.addEventListener("click", addPage);
      lane.append(more);
      addPage();
    }
    container.append(node("li", `${plan.summary.complete} checks validated; ${plan.summary.total - plan.summary.complete} not yet verified. Unverified does not mean failed or misconfigured.${found ? " Items above separate actions from app limitations." : ""}`, "source-status"));
  }
  root.FlightDeckCompletionUI = { render };
})(typeof globalThis !== "undefined" ? globalThis : this);
