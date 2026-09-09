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
      ["userDecisions", "Decisions for you", "These items need information from the person responsible for the pilot: who will take part, which policies should apply, or a written answer that software cannot establish. Open an item, record the answer and explain who confirmed it. Saving an answer does not change a Microsoft 365 setting."],
      ["administratorActions", "Help needed from an administrator", "Flight Deck could not obtain some information needed for these checks. Read the reason on each item before contacting the administrator for that service. They may need to sign in, review a denied read permission, confirm a licence, or run collection again. Do not grant broader permissions just because a command failed."],
      ["configurationActions", "Settings to review", "The collected information points to a setting that needs review. Ask the administrator to compare the finding with your organization's requirements before changing anything. If a change is approved, make it in the normal Microsoft administration tool and run another scan to check the result. Flight Deck does not make the change."],
      ["appLimitations", "Checks this version cannot perform", "The software is missing the connection or checking logic needed for these items. These are not tasks you can finish by changing a Microsoft 365 setting. Repeated scans or extra permissions will not add the missing software feature. Review the requirement outside Flight Deck; an app update is needed before Flight Deck can confirm the result."]
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
          ? "No unanswered setup choices are listed for this pilot."
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
          content.append(node("strong", item.title));
          if (item.controlId) content.append(node("small", `Flight Deck check reference: ${item.controlId}. This is an app identifier, not a Microsoft certification.`, "completion-blocker-meta"));
          if (item.owner) content.append(node("small", `Suggested person or team to contact: ${item.owner}. No task has been assigned or message sent.`, "completion-blocker-meta"));
          content.append(node("small", item.description || item.nextAction || item.reason || ""));
          if (item.description && item.nextAction && item.nextAction !== item.description) {
            content.append(node("small", item.nextAction));
          }
          if (item.why) content.append(node("small", item.why));
          if (item.warning) content.append(node("small", item.warning));
          if (item.limitations?.length) {
            const detail = node("details");
            detail.append(node("summary", "Technical details for the administrator or app maintainer"),
              node("small", item.limitations.map(reason => `${reason.code}: ${reason.description}`).join("; ")));
            content.append(detail);
          }
          const action = node("button", undefined, "btn");
          action.type = "button";
          const decisionId = item.id || item.decisionId;
          if (["pilotCohort", "hybridExchange", "webGrounding"].includes(decisionId)) {
            action.textContent = "Open the form to answer this";
            action.addEventListener("click", () => onDecision(decisionId));
          } else if (key === "appLimitations") {
            action.textContent = "Read what this check requires";
            action.addEventListener("click", () => onControl(item.controlId));
          } else if (item.state === "SignedAttestationRequired") {
            action.textContent = "Write the responsible person's answer";
            action.addEventListener("click", () => onAttest(item.controlId));
          } else if (["AdminEvidenceRequired", "PowerPlatformEvidenceRequired", "RecollectionRequired", "LiveCollectionRequired"].includes(item.state)) {
            action.textContent = "Open the collection controls";
            action.addEventListener("click", onCollect);
          } else {
            action.textContent = "Read the recommended next step";
            action.addEventListener("click", () => onControl(item.controlId));
          }
          action.setAttribute("aria-label", `${action.textContent}: ${item.controlId || item.title}`);
          if (item.controlId) action.dataset.controlId = item.controlId;
          content.append(action);
          row.append(content, node("span", key === "appLimitations" ? "Not supported by this version" : item.stateLabel || "An answer is needed", "completion-state"));
          list.append(row);
        }
        more.hidden = visible >= items.length;
      }
      more.addEventListener("click", addPage);
      lane.append(more);
      addPage();
    }
    container.append(node("li", `${plan.summary.complete} of ${plan.summary.total} checks have enough current information to meet Flight Deck's rules. The other ${plan.summary.total - plan.summary.complete} checks do not. This may be because information is missing, a setting needs review, or the app cannot perform the check; it does not mean all of those Microsoft 365 settings are wrong.${found ? " Use the categories above to see who can take the next step." : ""}`, "source-status"));
  }
  root.FlightDeckCompletionUI = { render };
})(typeof globalThis !== "undefined" ? globalThis : this);
