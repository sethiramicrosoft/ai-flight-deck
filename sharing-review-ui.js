(function (root) {
  "use strict";
  const states = new WeakMap();
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  }
  function button(text, action) {
    const node = element("button", text, "btn");
    node.type = "button";
    node.addEventListener("click", action);
    return node;
  }
  function render(container, model, { severity = "all", onError = () => {} } = {}) {
    const api = root.FlightDeckSharingReview;
    let state = states.get(container);
    if (!state || state.model !== model) {
      state = { model, bucket: "review", query: "", offset: 0, severity };
      states.set(container, state);
    }
    if (state.severity !== severity) { state.severity = severity; state.offset = 0; }
    const run = operation => {
      try { operation(); } catch (error) { onError(error.message); }
    };
    const repaint = (selector = "[data-sharing-page]") => {
      render(container, model, { severity, onError });
      container.querySelector(selector)?.focus({ preventScroll: true });
    };
    container.replaceChildren();
    const summary = model.summary;
    const overview = element("section", undefined, "card sharing-overview");
    overview.setAttribute("aria-label", "Sharing evidence summary");
    overview.append(
      element("h3", "Review access patterns, not every permission"),
      element("p", `${summary.sitesScanned} scanned sites · ${summary.fileCount} files and ${summary.folderCount} folders observed · ${summary.permissionRecords.toLocaleString()} permission records`),
      element("p", `${summary.inheritedRecords.toLocaleString()} inherited records are grouped. ${summary.unresolvedInheritedRecords.toLocaleString()} have an unresolved inheritance source. Counts describe sampled evidence, not every item in the tenant.`, "subtitle")
    );
    const tabs = element("div", undefined, "actions");
    for (const [bucket, label, count] of [
      ["review", "Needs access review", summary.reviewGroupCount],
      ["inventory", "Permission inventory", summary.inventoryGroupCount]
    ]) {
      const tab = button(`${label} (${count})`, () => {
        state.bucket = bucket;
        state.offset = 0;
        repaint(`[data-sharing-bucket="${bucket}"]`);
      });
      tab.dataset.sharingBucket = bucket;
      tab.setAttribute("aria-pressed", String(state.bucket === bucket));
      if (state.bucket === bucket) tab.classList.add("primary");
      tabs.append(tab);
    }
    overview.append(tabs, element("p", state.bucket === "review"
      ? "Potentially risky access observations need context and owner review. They are not proof that sensitive content was accessed."
      : "Ordinary user and group grants are inventory, not automatic remediation tasks. Inherited access is never labelled a direct grant.", "subtitle"));
    const search = element("form", undefined, "sharing-search");
    const label = element("label", "Find a site, library or access pattern", "field");
    const input = element("input");
    input.type = "search";
    input.value = state.query;
    input.maxLength = 200;
    label.append(input);
    const submit = element("button", "Filter groups", "btn");
    submit.type = "submit";
    search.append(label, submit);
    search.addEventListener("submit", event => {
      event.preventDefault();
      run(() => { state.query = input.value.trim(); state.offset = 0; repaint('input[type="search"]'); });
    });
    overview.append(search);
    container.append(overview);
    const page = api.pageReviewGroups(model, {
      bucket: state.bucket, query: state.query, offset: state.offset, limit: 25,
      severity: state.bucket === "review" ? severity : "all"
    });
    const announcement = element("p", page.total
      ? `Showing groups ${page.offset + 1}-${page.offset + page.items.length} of ${page.total}. Individual records are displayed only when you open a group.`
      : "No matching groups in the collected scope. This does not establish complete tenant coverage.", "source-status");
    announcement.setAttribute("role", "status");
    announcement.dataset.sharingPage = "";
    announcement.tabIndex = -1;
    container.append(announcement);
    for (const group of page.items) {
      const card = element("article", undefined, "card sharing-review-card");
      card.dataset.groupId = group.id;
      card.append(
        element("h3", group.title),
        element("p", `${group.siteName} / ${group.libraryName}`, "subtitle"),
        element("p", `${group.affectedItems} distinct sampled items · ${group.permissionRecords} permission records · ${group.originLabel}`),
        element("p", group.reason),
        element("p", `Owner: ${group.owner || "Owner not assigned"}`, "completion-blocker-meta"),
        element("p", `Next action: ${group.nextAction}`),
        element("small", group.coverageLabel, "subtitle")
      );
      const open = button("View grouped evidence", () => run(() => showDetails(container, model, group, open, onError)));
      card.append(open);
      container.append(card);
    }
    const navigation = element("nav", undefined, "actions sharing-pagination");
    navigation.setAttribute("aria-label", "Review group pages");
    const previous = button("Previous groups", () => { state.offset = Math.max(0, state.offset - 25); repaint(); });
    const next = button("Next groups", () => { state.offset += 25; repaint(); });
    previous.disabled = state.offset === 0;
    next.disabled = page.offset + page.items.length >= page.total;
    navigation.append(previous, next);
    container.append(navigation);
  }

  function showDetails(container, model, group, trigger, onError) {
    container.querySelector("dialog")?.remove();
    const modal = element("dialog", undefined, "sharing-detail-dialog");
    const heading = element("h3", group.title);
    heading.id = "sharing-detail-heading";
    modal.setAttribute("aria-labelledby", heading.id);
    const close = button("Close evidence", () => modal.close());
    const body = element("div");
    let offset = 0;
    const paint = () => {
      const page = root.FlightDeckSharingReview.getReviewDetails(model, group.id, { offset, limit: 50 });
      body.replaceChildren();
      const count = element("p", `Records ${page.items.length ? offset + 1 : 0}-${offset + page.items.length} of ${page.total}. At most 50 records are displayed.`, "source-status");
      count.setAttribute("role", "status");
      count.tabIndex = -1;
      const list = element("ul", undefined, "evidence-detail-list");
      for (const row of page.items) {
        const item = element("li", undefined, "evidence-detail");
        item.append(
          element("strong", row.displayName || "Unnamed resource"),
          element("span", `${row.siteName} / ${row.libraryName} · ${row.itemType || "Resource"}`),
          element("span", row.originLabel),
          element("span", row.reason || group.reason),
          element("span", `Action: ${row.nextAction || group.nextAction}`),
          element("small", `Evidence reference: ${row.evidenceId || "Not provided"}`)
        );
        list.append(item);
      }
      const navigation = element("nav", undefined, "actions");
      navigation.setAttribute("aria-label", "Evidence record pages");
      const change = value => {
        try {
          offset = value;
          paint();
          body.querySelector('[role="status"]').focus();
        } catch (error) { onError(error.message); }
      };
      const previous = button("Previous records", () => change(Math.max(0, offset - 50)));
      const next = button("Next records", () => change(offset + 50));
      previous.disabled = offset === 0;
      next.disabled = offset + page.items.length >= page.total;
      navigation.append(previous, next);
      body.append(count, list, navigation);
    };
    paint();
    modal.append(heading, close, body);
    modal.addEventListener("close", () => { modal.remove(); trigger.focus(); }, { once: true });
    container.append(modal);
    modal.showModal();
    close.focus();
  }

  function summaryCsv(model, { tenant, observedAt, csvCell }) {
    const columns = ["Tenant", "Scan observed at", "Category", "Review group", "Site", "Library",
      "Permission origin", "Distinct sampled items", "Permission records", "Owner", "Reason", "Next action", "Coverage"];
    const rows = [];
    for (const bucket of ["review", "inventory"]) {
      let offset = 0;
      while (true) {
        const page = root.FlightDeckSharingReview.pageReviewGroups(model, { bucket, offset, limit: 50 });
        for (const group of page.items) rows.push([
          tenant, observedAt, bucket, group.title, group.siteName, group.libraryName, group.originLabel,
          group.affectedItems, group.permissionRecords, group.owner, group.reason, group.nextAction, group.coverageLabel
        ].map(csvCell).join(","));
        offset += page.items.length;
        if (offset >= page.total || !page.items.length) break;
      }
    }
    return `\uFEFF${columns.map(csvCell).join(",")}\r\n${rows.join("\r\n")}`;
  }
  function fullEvidenceCsv(model, { tenant, observedAt, csvCell }) {
    const columns = ["Tenant", "Scan observed at", "Evidence reference", "Item reference", "Resource",
      "Site", "Library", "Item type", "Permission origin", "Access pattern", "Recorded access type (source label)", "Roles", "Review reason", "Next action",
      "Coverage", "Principal references", "Principal types", "Expiration", "Expiration status",
      "Inherited from item", "Inherited from drive", "Inherited from path", "Owner"];
    const rows = [];
    let offset = 0;
    while (true) {
      const page = root.FlightDeckSharingReview.pageAllEvidence(model, { offset, limit: 50 });
      for (const row of page.items) {
        rows.push([tenant, observedAt, row.evidenceId, row.itemEvidenceId, row.displayName,
          row.siteName, row.libraryName, row.itemType, row.originLabel, row.accessLabel, row.accessType,
          row.roles, row.reason, row.nextAction, "Observed sample only; not a complete tenant inventory.",
          row.principalRefs, row.principalTypes, row.expirationDateTime, row.expirationStatus,
          row.inheritedFromId, row.inheritedFromDriveId, row.inheritedFromPath, row.owner]
          .map(csvCell).join(","));
      }
      offset += page.items.length;
      if (offset >= page.total || !page.items.length) break;
    }
    return `\uFEFF${columns.map(csvCell).join(",")}\r\n${rows.join("\r\n")}`;
  }
  root.FlightDeckSharingReviewUI = { render, summaryCsv, fullEvidenceCsv };
})(typeof globalThis !== "undefined" ? globalThis : this);
