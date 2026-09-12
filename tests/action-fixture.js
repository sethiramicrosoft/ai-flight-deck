"use strict";

// Offline fixture only. Every service adapter is replaced; no real tenant, auth or network.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createApp } = require("../server");
const { collectEstate } = require("../estate-collector-suite");
const { createEvidenceEnvelope, sha256Digest } = require("../evidence-integrity");
const { createSignedAttestation, verifySignedAttestation } = require("../attestation-evidence");
const { observations, catalog } = require("../authority-test-fixtures");
const { STATEMENTS } = require("../action-workflow");
const tenantId = "11111111-1111-4111-8111-111111111111";
const cohort = { id: "action-pilot", name: "Synthetic action pilot", approved: true, principalIds: ["user-1"] };

function seedScan(selectedCohort = cohort) {
  const sets = ["anonymousPermissionIds", "organizationPermissionIds", "broadAccessSiteIds",
    "sharedItemIds", "guestUserIds", "criticalEvidenceIds"];
  return {
    schemaVersion: "1.0.0", documentType: "tenant-scan", producer: "ai-flight-deck/scan-tenant.ps1",
    producerVersion: "1.5.0", scoringVersion: "1.3.0", policyHash: sha256Digest("synthetic-policy").slice(7),
    configHash: sha256Digest("synthetic-config").slice(7), generatedAt: new Date().toISOString(),
    tenant: { tenantId, displayName: "Synthetic guided-action tenant" },
    auth: { mode: "device-code", actor: { id: "synthetic-actor" } },
    scope: { grantedScopes: ["Directory.Read.All", "Organization.Read.All", "Reports.Read.All", "Policy.Read.All"], fingerprint: sha256Digest("offline").slice(7) },
    completeness: { requiredEvidenceComplete: false },
    coverage: { sitesDiscovered: 0, sitesSelected: 0, sitesScanned: 0, discoveryComplete: true,
      selectionComplete: true, limitReached: false, complete: true },
    collectionMetadata: {}, evidenceSets: Object.fromEntries(sets.map(s => [s, []])),
    summary: { readinessScore: null, criticalExposures: 0, exposedItems: 0, users: 1,
      guests: 0, sitesScanned: 0, sitesDiscovered: 0, anonymousLinks: 0, organizationLinks: 0, broadAccessSites: 0 },
    findings: [],
    estateAssessment: { assessmentType: "microsoft-365-copilot-estate-readiness",
      overallStatus: "InsufficientEvidence", decision: "EvidenceCollectionRequired",
      catalogVersion: catalog.catalogVersion, requiredDomains: catalog.domains.length,
      cohorts: [structuredClone(selectedCohort)], controlResults: [],
      domains: catalog.domains.map(d => ({ id: d.id, name: d.name })) }
  };
}
function statementData(id, now, selectedCohort) {
  const common = { owner: "Synthetic owner" };
  return {
    "AFD-IAM-007": { ...common, accountRef: "account", exclusionEvidenceRef: "review:exclusion", monitoringAlertRef: "review:alert" },
    "AFD-DEV-005": { ...common, policyRef: "policy", conditionalAccessEvidenceRef: "review:ca", enrollmentRestrictionsEvidenceRef: "review:enroll", settingsMatchPolicy: true },
    "AFD-OPS-004": { ...common, advisoryReviewRef: "review:advisory", reviewedAt: now.toISOString(), catalogueUpdated: true },
    "AFD-OPS-005": { technicalContact: "Synthetic technical", executiveContact: "Synthetic executive", tenantId, reviewedAt: now.toISOString() },
    "AFD-COPILOT-006": { ...common, decision: "Allowed", privacyAssessmentRef: "review:privacy", tenantSettingEvidenceRef: "review:setting", tenantSettingMatch: true },
    "AFD-PPA-005": { sources: [{ id: "source", sensitivityLabel: "internal", dlpAlignment: "reviewed", promptInjectionReview: "review:boundary" }], tools: [] },
    "AFD-ADOPT-001": { useCases: [1, 2, 3].map(n => ({ id: `case-${n}`, ...common, targetCohort: selectedCohort.id, expectedOutcome: "Outcome", successMetric: "Metric" })) },
    "AFD-ADOPT-002": { cohorts: [{ id: selectedCohort.id, ...common, groupId: "group", entryCriteria: "entry", exitCriteria: "exit" }] },
    "AFD-ADOPT-003": { training: { deliveredAt: now.toISOString() }, support: { intake: "queue", ...common, responseTarget: "one day" } },
    "AFD-ADOPT-004": { publishedUseCaseIds: ["case-1"], acceptances: [{ useCaseId: "case-1", champion: "Synthetic champion", impactAssessmentUrl: "review:impact", expiresAt: new Date(now.getTime() + 3600000).toISOString() }] },
    "AFD-ADOPT-006": { reviews: [{ heldAt: now.toISOString(), driftReviewed: true, decisions: ["Continue"] }] }
  }[id];
}
async function fixture({ workspace, statements = [], start = true } = {}) {
  const owned = !workspace;
  workspace ||= fs.mkdtempSync(path.join(__dirname, ".guided-action-test-"));
  fs.mkdirSync(workspace, { recursive: true });
  const key = crypto.randomBytes(32);
  const integrity = { key, keyId: `local-workspace-${crypto.createHash("sha256").update(key).digest("hex").slice(0, 16)}` };
  fs.writeFileSync(path.join(workspace, "integrity-key.bin"), key, { mode: 0o600 });
  let selectedCohort = structuredClone(cohort), source = structuredClone(observations);
  async function assessment({ statementIds, cohort: nextCohort = selectedCohort,
    observations: nextSource = source, mutate } = {}) {
    selectedCohort = structuredClone(nextCohort); source = structuredClone(nextSource);
    const now = new Date();
    const storedPath = path.join(workspace, "attestations.json");
    const records = statementIds === undefined && fs.existsSync(storedPath)
      ? JSON.parse(fs.readFileSync(storedPath, "utf8")).attestations
      : (statementIds || statements).map(id => createSignedAttestation({
      catalog, ...integrity, now, input: { tenantId, cohortId: selectedCohort.id,
        controlId: id, decision: "Pass", statement: "Synthetic owner reviewed the referenced evidence.",
        attestedBy: "Synthetic owner", expiresAt: new Date(now.getTime() + 3600000).toISOString(),
        evidenceReferences: ["review:synthetic"], data: statementData(id, now, selectedCohort) }
    }));
    fs.writeFileSync(path.join(workspace, "attestations.json"), JSON.stringify({ attestations: records }));
    const scan = await collectEstate({
      rawToken: "synthetic-unused", workspace, scan: seedScan(selectedCohort), attestationIntegrity: integrity,
      verifyAttestation: record => verifySignedAttestation(record, { ...integrity, now: new Date() }),
      verifyEvidencePackage: () => false,
      adapters: {
        graphRequest: async ({ url }) => ({ value: structuredClone(url.includes("subscribedSkus")
          ? source.skus : url.includes("/identity/conditionalAccess/policies") ? source.conditionalAccess || []
            : url.includes("/users") ? source.users : []) }),
        adminCommand: async () => { throw Object.assign(new Error("Offline fixture"), { code: "COMMAND_UNAVAILABLE" }); },
        networkProbe: { probe: async () => ({ unavailable: true, reason: "Offline fixture" }) },
        powerPlatformClient: { query: async () => ({ value: [] }) },
        graphReportsClient: { query: async () => ({ value: [] }) },
        attestationStore: { list: async ({ domainId }) => records.filter(r => r.domainId === domainId),
          verify: async record => verifySignedAttestation(record, { ...integrity, now: new Date() }) }
      }
    });
    if (mutate) mutate(scan);
    return scan;
  }
  function seal(scan, kind = "baseline-scan") {
    fs.writeFileSync(path.join(workspace, `${kind}.json`), JSON.stringify(scan));
    fs.writeFileSync(path.join(workspace, `${kind}.envelope.json`), JSON.stringify(createEvidenceEnvelope({
      tenant: tenantId, producer: scan.producer, generatedAt: scan.generatedAt, payload: scan, ...integrity
    })));
  }
  seal(await assessment());
  let app, origin;
  const boot = async () => {
    app = createApp({ port: 0, workspace, workflowRunner: async (job, action) => {
      if (!["baseline", "workloads"].includes(action)) throw new Error("Offline fixture supports baseline and workloads only.");
      seal(await assessment()); return "baseline";
    } });
    await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${app.server.address().port}`;
  };
  if (start) await boot();
  const request = async (route, body, headers = {}) => {
    const res = await fetch(`${origin}${route}`, { method: body ? "POST" : "GET",
      headers: { Origin: origin, "X-Flight-Deck": "local-ui", "Content-Type": "application/json", ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, body: await res.json() };
  };
  return { workspace, integrity, assessment, seal, request, get origin() { return origin; },
    async restart() { await new Promise(resolve => app.server.close(resolve)); await boot(); },
    async close() { if (app) await new Promise(resolve => app.server.close(resolve)); if (owned) fs.rmSync(workspace, { recursive: true, force: true }); }
  };
}
if (require.main === module) {
  // Always creates a fresh, isolated workspace. The optional directory must be inside this repository.
  const workspace = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
  const repo = path.resolve(__dirname, "..");
  if (workspace && (!workspace.startsWith(`${repo}${path.sep}`) || fs.existsSync(workspace))) {
    throw new Error("Choose a new synthetic workspace directory inside this repository.");
  }
  fixture({ workspace }).then(f => {
    console.log(`ACTION_FIXTURE_READY ${f.origin}`);
    const close = () => f.close().then(() => process.exit(0));
    process.on("SIGTERM", close); process.on("SIGINT", close);
  }).catch(() => { console.error("Synthetic fixture failed to start."); process.exitCode = 1; });
}
module.exports = { fixture, tenantId, cohort, STATEMENTS };
