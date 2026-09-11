"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const catalog = require("./schema/readiness-catalog.v1.json");
const { controlPlaybook } = require("./enablement-playbook");
const { handoff } = require("./action-workflow-ui");
const { validateAssessmentAuthority } = require("./evidence-authority");
const { createEvidenceEnvelope, verifyEvidenceEnvelope, sha256Digest } = require("./evidence-integrity");

const TECHNICAL = ["AFD-LIC-001", "AFD-LIC-002", "AFD-LIC-004"];
const STATEMENTS = ["AFD-IAM-007", "AFD-DEV-005", "AFD-OPS-004", "AFD-OPS-005",
  "AFD-COPILOT-006", "AFD-PPA-005", "AFD-ADOPT-001", "AFD-ADOPT-002",
  "AFD-ADOPT-003", "AFD-ADOPT-004", "AFD-ADOPT-006"];
const SATISFIED = ["TechnicalVerification", "SupportedOwnerStatement"];
const STATES = ["Draft", "InProgress", "ReportedComplete"];
const DISPOSITIONS = ["Unverified", "Reopened", ...SATISFIED];
const STRING_FIELDS = ["scopeDescription", "owner", "team", "approvalRecord", "prerequisites",
  "proposedWork", "centralRequest", "centralResponse", "centralEvidence"];
const EDIT_FIELDS = [...STRING_FIELDS, "responsibility", "dueDate", "approvalRequired",
  "prerequisitesConfirmed", "dependencies", "completedSteps"];
const clone = value => structuredClone(value);
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
const object = v => v && typeof v === "object" && !Array.isArray(v);
function keys(input, allowed) {
  if (!object(input) || Object.keys(input).some(k => !allowed.includes(k))) fail("Unsupported action fields.");
}
function text(value, maximum = 4000) {
  if (typeof value !== "string" || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    fail("Action text is invalid or too long.");
  }
  return value.trim();
}
function identity(scan, cohort) {
  const tenantId = scan.tenant?.tenantId;
  if (!tenantId || !cohort?.id) fail("A sealed tenant and cohort assessment is required.");
  const snapshot = clone(cohort);
  if (Array.isArray(snapshot.principalIds)) snapshot.principalIds.sort();
  const context = { tenantId, cohort: snapshot, catalogueVersion: catalog.catalogVersion,
    catalogueDigest: sha256Digest(catalog) };
  return { ...context, id: sha256Digest(context) };
}
function contexts(scan) {
  return (scan.estateAssessment?.cohorts || []).map(c => identity(scan, c));
}
function validateEdits(input, action) {
  keys(input, EDIT_FIELDS);
  const value = clone(input);
  for (const field of STRING_FIELDS) if (field in value) value[field] = text(value[field]);
  for (const field of ["approvalRequired", "prerequisitesConfirmed"]) {
    if (field in value && typeof value[field] !== "boolean") fail("Action confirmation must be true or false.");
  }
  if ("responsibility" in value && !["unknown", "local", "central", "shared"].includes(value.responsibility)) {
    fail("Choose unknown, local, central or shared responsibility.");
  }
  if ("dueDate" in value && value.dueDate !== "" &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(value.dueDate) ||
       !Number.isFinite(Date.parse(value.dueDate)) ||
       new Date(value.dueDate).toISOString().slice(0, 10) !== value.dueDate)) fail("Use a valid due date.");
  if ("dependencies" in value && (!Array.isArray(value.dependencies) || value.dependencies.length > 30 ||
      value.dependencies.some(id => typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) ||
      new Set(value.dependencies).size !== value.dependencies.length)) fail("Invalid action dependencies.");
  if ("completedSteps" in value && (!Array.isArray(value.completedSteps) ||
      value.completedSteps.some(n => !Number.isSafeInteger(n) || n < 0 || n >= action.proposal.guidance.steps.length) ||
      new Set(value.completedSteps).size !== value.completedSteps.length)) fail("Invalid guided steps.");
  return value;
}

function createActionStore({ workspace, integrity, writeJsonAtomic, readBaseline, readAssessment,
  contextIsCurrent = () => true, clock = () => new Date() }) {
  const file = path.join(workspace, "guided-actions.json");
  const lock = `${file}.lock`;
  const currentContexts = scan => contexts(scan).filter(contextIsCurrent);
  function read() {
    if (!fs.existsSync(file)) return { schemaVersion: 1, actions: [] };
    try {
      if (fs.statSync(file).size > 16 * 1024 * 1024) throw new Error();
      const envelope = JSON.parse(fs.readFileSync(file, "utf8"));
      verifyEvidenceEnvelope(envelope, integrity.key);
      const doc = envelope.payload;
      if (envelope.keyId !== integrity.keyId || envelope.producer !== "ai-flight-deck/guided-actions" ||
          doc.schemaVersion !== 1 || !Array.isArray(doc.actions) || doc.actions.length > 500) throw new Error();
      const ids = new Set(), bindings = new Set();
      for (const a of doc.actions) {
        if (!object(a) || !/^[0-9a-f-]{36}$/.test(a.id) || ids.has(a.id) ||
            !Number.isSafeInteger(a.revision) || a.revision < 1 || !STATES.includes(a.state) ||
            !DISPOSITIONS.includes(a.verification?.disposition) || !object(a.context) ||
            typeof a.verification.everSatisfied !== "boolean" || typeof a.verification.reason !== "string" ||
            a.context.id !== sha256Digest(Object.fromEntries(Object.entries(a.context).filter(([k]) => k !== "id"))) ||
            !object(a.proposal) || !a.proposal.guidance?.steps?.length ||
            a.proposal.catalogueControl?.id !== a.controlId || a.proposal.guidance.controlId !== a.controlId ||
            typeof a.handoffDraft !== "string" || a.handoffDraft.length > 64000 ||
            !Array.isArray(a.history) || !a.history.length || a.history.length > 200 ||
            a.revision !== a.history.length ||
            a.history.some(h => !object(h) || !Number.isFinite(Date.parse(h.at)) || typeof h.event !== "string" || !object(h.details)) ||
            (a.state === "ReportedComplete"
              ? !Number.isFinite(Date.parse(a.completedAt)) || typeof a.completionReport !== "string" || !a.completionReport.trim()
              : a.completedAt !== null) ||
            !Number.isFinite(Date.parse(a.createdAt)) || !Number.isFinite(Date.parse(a.updatedAt)) ||
            !object(a.fields) || EDIT_FIELDS.some(key => !(key in a.fields)) ||
            !catalog.domains.some(d => d.controls.some(c => c.id === a.controlId))) throw new Error();
        validateEdits(a.fields, a);
        const binding = `${a.context.id}:${a.controlId}`;
        if (bindings.has(binding)) throw new Error();
        ids.add(a.id); bindings.add(binding);
      }
      for (const a of doc.actions) validateDependencies(doc, a);
      return doc;
    } catch {
      fail("The local action store is corrupt, incompatible or failed integrity verification. Restore a trusted backup; it has not been reset.", 409);
    }
  }
  function save(doc) {
    const envelope = createEvidenceEnvelope({ tenant: "local-action-workspace",
      producer: "ai-flight-deck/guided-actions", payload: doc,
      generatedAt: clock().toISOString(), ...integrity });
    if (Buffer.byteLength(JSON.stringify(envelope)) > 16 * 1024 * 1024) fail("Action store capacity reached. Retain a backup before maintenance.", 409);
    writeJsonAtomic(file, envelope);
  }
  function transaction(fn) {
    let fd;
    try { fd = fs.openSync(lock, "wx", 0o600); }
    catch { fail("Action store is busy. Retry after the other request finishes; if a service crashed, restore access to its lock file while stopped.", 409); }
    try {
      const doc = read();
      const before = sha256Digest(doc);
      const result = fn(doc);
      if (before !== sha256Digest(doc)) save(doc);
      return clone(result);
    } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
  }
  function event(a, kind, details) {
    if (a.history.length >= 200) fail("This action reached its history limit. Preserve it for audit before maintenance.", 409);
    const at = clock().toISOString();
    a.revision++; a.updatedAt = at;
    a.history.push({ at, event: kind, details: clone(details) });
  }
  function validateDependencies(doc, action) {
    const visited = new Set();
    const visit = (id, trail) => {
      if (trail.has(id)) fail("Action dependencies cannot contain cycles or the action itself.");
      if (visited.has(id)) return;
      const found = doc.actions.find(a => a.id === id);
      if (!found || found.context.id !== action.context.id) fail("Dependencies must be existing actions in the exact same context.");
      const next = new Set(trail); next.add(id);
      for (const dep of found.fields.dependencies) visit(dep, next);
      visited.add(id);
    };
    for (const id of action.fields.dependencies) visit(id, new Set([action.id]));
  }
  function evidenceState(a, baseline, assessment) {
    const current = currentContexts(baseline).some(c => c.id === a.context.id);
    const supported = TECHNICAL.includes(a.controlId) || STATEMENTS.includes(a.controlId);
    let reason = !current ? "The current tenant, cohort snapshot or catalogue differs. This action is historical; start a separate action for the new context."
      : !a.completedAt ? "Report completion before requesting an evidence check."
      : !supported ? "No supported observation contract exists for this control. Reported work, links, CSVs and hand-off responses cannot technically verify it."
      : null;
    const match = contexts(assessment).some(c => c.id === a.context.id);
    if (!reason && !match) reason = "The latest saved assessment targets a different context. Collect the exact action cohort again.";
    const r = assessment.estateAssessment?.controlResults?.find(r =>
      r.controlId === a.controlId && r.cohortId === a.context.cohort.id);
    if (!reason && (!r || r.authority?.validationStatus !== "Accepted" ||
        !["Pass", "NotApplicable"].includes(r.status))) {
      reason = "The latest authoritative assessment is failing, unknown, expired or missing admissible evidence. Collect supported current evidence.";
    }
    const receipt = r?.authority?.evidenceRecord;
    if (!reason && (!(Date.parse(r.observedAt) > Date.parse(a.completedAt)) ||
        !(Date.parse(receipt?.generatedAt) > Date.parse(a.completedAt)) ||
        (receipt?.payload?.facts?.record &&
          !(Date.parse(receipt.payload.facts.record.attestedAt) > Date.parse(a.completedAt))))) {
      reason = "Evidence was observed or signed before completion. Re-sealing or reloading an old scan does not count; recollect after the reported work.";
    }
    const disposition = reason ? (a.verification.everSatisfied || a.history.some(h => h.event === "reopen") ? "Reopened" : "Unverified")
      : STATEMENTS.includes(a.controlId) ? "SupportedOwnerStatement" : "TechnicalVerification";
    return { disposition, reason: reason || (disposition === "SupportedOwnerStatement"
      ? "A supported accountable statement was accepted, not independent proof of service settings."
      : "Current source observations meet the frozen catalogue criterion. This does not prove who caused the change; LIC-002 is cohort-wide, not per-user causation."),
    everSatisfied: a.verification.everSatisfied || SATISFIED.includes(disposition),
    evidence: r ? { status: r.status, observedAt: r.observedAt, freshUntil: r.freshUntil,
      collectorRunId: r.provenance?.collectorRunId, receiptDigest: receipt ? sha256Digest(receipt) : null,
      contract: receipt?.payload?.contract || null, assessmentDigest: assessment.integrity?.envelopeDigest ||
        sha256Digest({ tenant: assessment.tenant, run: assessment.estateAssessment?.collectorRun,
          generatedAt: assessment.generatedAt }) } : null };
  }
  function refresh(doc) {
    const baseline = readBaseline();
    const assessment = readAssessment();
    validateAssessmentAuthority(assessment, integrity, clock());
    for (const a of doc.actions) {
      // Explicit reopen suspends satisfaction until a new completion report.
      const next = evidenceState(a, baseline, assessment);
      if (sha256Digest(next) !== sha256Digest(a.verification)) {
        a.verification = next;
        event(a, "EvidenceChecked", next);
      }
    }
    return baseline;
  }
  function response(doc, baseline) {
    const availableContexts = currentContexts(baseline);
    return { schemaVersion: 1, contexts: availableContexts,
      controls: catalog.domains.flatMap(d => d.controls.map(c => ({
        id: c.id, title: c.title, domain: d.name,
        support: TECHNICAL.includes(c.id) ? "TechnicalVerification" :
          STATEMENTS.includes(c.id) ? "SupportedOwnerStatement" : "Unverified"
      }))),
      actions: doc.actions.map(a => ({ ...a, historical: !availableContexts.some(c => c.id === a.context.id) })) };
  }
  function list() {
    return transaction(doc => response(doc, refresh(doc)));
  }
  function create(input) {
    keys(input, ["controlId", "contextId"]);
    return transaction(doc => {
      const baseline = refresh(doc);
      const context = currentContexts(baseline).find(c => c.id === input.contextId);
      const domain = catalog.domains.find(d => d.controls.some(c => c.id === input.controlId));
      if (!context || !domain) fail("Choose a known control and the exact current assessment context.");
      const existing = doc.actions.find(a => a.controlId === input.controlId && a.context.id === context.id);
      if (existing) return existing;
      if (doc.actions.length >= 500) fail("Action capacity reached. Preserve existing records before maintenance.", 409);
      const control = domain.controls.find(c => c.id === input.controlId);
      const startingEvidence = baseline.estateAssessment.controlResults?.find(r =>
        r.controlId === control.id && r.cohortId === context.cohort.id) || null;
      const guidance = controlPlaybook(domain, control, startingEvidence, clock());
      const at = clock().toISOString();
      const action = { id: crypto.randomUUID(), revision: 1, controlId: control.id, context,
        createdAt: at, updatedAt: at, state: "Draft", completedAt: null, completionReport: "",
        proposal: { proposedAt: at, startingEvidence: clone(startingEvidence),
          baselineDigest: baseline.integrity?.envelopeDigest || sha256Digest(baseline),
          catalogueControl: clone(control), guidance, proposedWork: control.remediation,
          acceptanceCriterion: control.passCondition },
        fields: { scopeDescription: "", owner: "", team: "", responsibility: "unknown",
          dueDate: "", approvalRequired: true, approvalRecord: "", prerequisites: "",
          prerequisitesConfirmed: false, dependencies: [], completedSteps: [],
          proposedWork: control.remediation, centralRequest: "", centralResponse: "", centralEvidence: "" },
        verification: { disposition: "Unverified", reason: "Report completion before requesting an evidence check.",
          everSatisfied: false, evidence: null },
        history: [{ at, event: "Proposed", details: { controlId: control.id, contextId: context.id } }] };
      doc.actions.push(action);
      action.handoffDraft = handoff(action);
      action.proposal.handoffDraft = action.handoffDraft;
      refresh(doc);
      return action;
    });
  }
  function update(id, input) {
    keys(input, ["revision", "operation", "fields", "completionReport"]);
    return transaction(doc => {
      const a = doc.actions.find(a => a.id === id);
      if (!a) fail("Action not found.", 404);
      if (input.revision !== a.revision) fail("This action changed. Reload its saved version before editing again.", 409);
      const baseline = refresh(doc);
      if (!currentContexts(baseline).some(c => c.id === a.context.id)) fail("Historical actions cannot be moved to another context.", 409);
      const op = input.operation;
      if (!["save", "start", "complete", "check", "reopen"].includes(op)) fail("Unsupported action operation.");
      if (op !== "complete" && "completionReport" in input) fail("Completion reports require the completion operation.");
      if (op === "check") {
        if ("fields" in input) fail("Evidence checks cannot edit action fields.");
        return a;
      }
      if (op === "reopen") {
        if ("fields" in input) fail("Reopen before editing action fields.");
        if (a.state !== "ReportedComplete") fail("Only reported-complete work can be reopened.");
        a.state = "InProgress"; a.completedAt = null;
        a.verification = { ...a.verification, disposition: "Reopened",
          reason: "Work explicitly reopened; report completion again before verification." };
      } else {
        if (a.state === "ReportedComplete") fail("Reopen the work before editing its completion or scope.", 409);
        const fields = validateEdits(input.fields || {}, a);
        Object.assign(a.fields, fields);
        validateDependencies(doc, a);
        if (op === "start" || op === "complete") {
          if (!a.fields.scopeDescription || !a.fields.owner || !a.fields.team ||
              a.fields.responsibility === "unknown" || !a.fields.prerequisitesConfirmed) {
            fail("Record scope, owner, team, responsibility and confirm prerequisites before starting or completing work.");
          }
          if (a.fields.approvalRequired && !a.fields.approvalRecord) fail("Record the required approval first. This is a user-recorded decision, not identity-verified approval.");
          if (a.fields.dependencies.some(id => {
            const dep = doc.actions.find(d => d.id === id);
            return dep.state !== "ReportedComplete" || dep.verification.disposition === "Reopened";
          })) fail("Complete prerequisite actions first. Dependency completion is reported work, not proof of technical verification.");
        }
        if (op === "start") {
          if (a.state !== "Draft") fail("This action is already started.");
          a.state = "InProgress";
        }
        if (op === "complete") {
          if (a.state !== "InProgress") fail("Start the guided work before reporting completion.");
          if (["central", "shared"].includes(a.fields.responsibility) &&
              (!a.fields.centralRequest || !a.fields.centralResponse || !a.fields.centralEvidence)) {
            fail("Record the central IT request, response and response evidence reference before reporting completion.");
          }
          a.completionReport = text(input.completionReport);
          if (!a.completionReport) fail("Describe the work reported complete.");
          a.completedAt = clock().toISOString(); a.state = "ReportedComplete";
        }
      }
      a.handoffDraft = handoff(a);
      event(a, op, { fields: clone(a.fields), state: a.state, handoffDraft: a.handoffDraft,
        completionReport: a.completionReport, completedAt: a.completedAt,
        approvalNotice: "User-recorded only; identity and authorization not verified. Nothing sent." });
      return a;
    });
  }
  return { list, create, update };
}

module.exports = { createActionStore, identity, TECHNICAL, STATEMENTS };
