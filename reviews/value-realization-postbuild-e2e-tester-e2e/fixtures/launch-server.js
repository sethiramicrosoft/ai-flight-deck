"use strict";
// Test-only fixture launcher for the e2e-tester persona's browser E2E pass over the
// uncommitted "value-realization" diff. This file lives outside the product tree
// (reviews/value-realization-postbuild-e2e-tester-e2e/) and imports the REAL,
// unmodified product modules (server.js, estate-collector-suite.js,
// attestation-evidence.js, evidence-integrity.js) exactly the way server.test.js does.
//
// It substitutes ONLY the untestable external dependency (Microsoft Graph device-code
// sign-in + the PowerShell scanner) with a deterministic in-process workflowRunner so a
// real browser can drive the real HTTP API, the real collector/attestation/evidence
// consumption logic, and the real UI end to end without any network access or product
// code changes.
//
// Usage: node launch-server.js <workspaceDir> <port>
// Prints "FIXTURE_SERVER_READY <port>" to stdout once listening.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PRODUCT_ROOT = path.resolve(__dirname, "..", "..", "..");
const { createApp } = require(path.join(PRODUCT_ROOT, "server.js"));
const { verifySignedAttestation } = require(path.join(PRODUCT_ROOT, "attestation-evidence.js"));
const { verifyEvidenceEnvelope, sha256Digest } = require(path.join(PRODUCT_ROOT, "evidence-integrity.js"));
const { collectEstate } = require(path.join(PRODUCT_ROOT, "estate-collector-suite.js"));
const catalog = require(path.join(PRODUCT_ROOT, "schema", "readiness-catalog.v1.json"));

const workspace = process.argv[2];
const port = Number(process.argv[3] || 0);
if (!workspace) {
  console.error("Usage: node launch-server.js <workspaceDir> <port>");
  process.exit(1);
}

fs.mkdirSync(workspace, { recursive: true });

// Pre-seed the same 32-byte integrity key file that server.js's own
// loadOrCreateIntegrityKey() would create, so our fixture's own verify* calls
// (used to keep the local collector's attestation/evidence-package consumption
// working exactly like production) sign and verify against the identical key the
// running server instance loads.
const keyPath = path.join(workspace, "integrity-key.bin");
if (!fs.existsSync(keyPath)) {
  fs.writeFileSync(keyPath, crypto.randomBytes(32), { flag: "wx", mode: 0o600 });
}
const integrityKey = fs.readFileSync(keyPath);
const integrityKeyId = `local-workspace-${crypto.createHash("sha256").update(integrityKey).digest("hex").slice(0, 16)}`;

const evidencePackageEnvelopePaths = {
  admin: path.join(workspace, "admin-evidence.envelope.json"),
  powerPlatform: path.join(workspace, "power-platform-evidence.envelope.json")
};

function verifyEvidencePackage(kind, document) {
  const envelopePath = evidencePackageEnvelopePaths[kind];
  if (!envelopePath || !fs.existsSync(envelopePath)) return false;
  const envelope = JSON.parse(fs.readFileSync(envelopePath, "utf8"));
  verifyEvidenceEnvelope(envelope, integrityKey);
  return sha256Digest(document) === envelope.payloadDigest;
}

const TENANT_ID = "e2eeeeee-1111-4444-8888-000000000001";
const COHORT_ID = "e2e-approved-pilot";

// index.html's validateScan() applies extensive defense-in-depth validation to ANY
// baseline artifact it loads -- via file import AND via the local-service job
// pipeline exercised here -- checking it was produced by the exact supported
// scanner/scoring version with consistent hashes, coverage, and evidence-set
// bookkeeping. A real scan-tenant.ps1 run always populates every one of these
// fields; this fixture must reproduce the same contract byte-for-byte so a real
// browser can get past the client gate without any product code changes.
const REQUIRED_EVIDENCE_SETS = [
  "anonymousPermissionIds", "organizationPermissionIds", "broadAccessSiteIds",
  "sharedItemIds", "guestUserIds", "criticalEvidenceIds"
];
const SUPPORTED_PRODUCER_VERSION = "1.5.0";
const SUPPORTED_SCORING_VERSION = "1.3.0";

function hex64(seed) {
  return crypto.createHash("sha256").update(seed).digest("hex");
}

function seedScan() {
  const emptyEvidenceSets = Object.fromEntries(REQUIRED_EVIDENCE_SETS.map(name => [name, []]));
  return {
    schemaVersion: "1.0.0",
    documentType: "tenant-scan",
    // Must equal exactly "ai-flight-deck/scan-tenant.ps1" -- validateScan() rejects
    // any other producer string, even though this fixture never actually runs the
    // PowerShell scanner.
    producer: "ai-flight-deck/scan-tenant.ps1",
    producerVersion: SUPPORTED_PRODUCER_VERSION,
    scoringVersion: SUPPORTED_SCORING_VERSION,
    policyHash: hex64("e2e-fixture-policy"),
    configHash: hex64("e2e-fixture-config"),
    generatedAt: new Date().toISOString(),
    tenant: { tenantId: TENANT_ID, displayName: "E2E Fixture Tenant" },
    auth: { mode: "device-code", actor: { id: "e2e-fixture-actor" } },
    // No delegated Graph scopes are granted in this offline fixture on purpose: every
    // Graph-backed control must resolve to an explicit "missing permission" Unknown
    // instead of a fabricated pass, exactly like a real customer who has not yet
    // consented. This keeps the run fully offline (no graph.microsoft.com calls).
    scope: { grantedScopes: [], fingerprint: hex64("e2e-fixture-scope") },
    completeness: { requiredEvidenceComplete: false },
    coverage: {
      sitesDiscovered: 0, sitesSelected: 0, sitesScanned: 0,
      discoveryComplete: true, selectionComplete: true, limitReached: false, complete: true
    },
    collectionMetadata: {},
    evidenceSets: emptyEvidenceSets,
    summary: {
      readinessScore: null, // must stay null while completeness.requiredEvidenceComplete is false
      criticalExposures: 0, exposedItems: 0, users: 0, guests: 0,
      sitesScanned: 0, sitesDiscovered: 0, anonymousLinks: 0, organizationLinks: 0,
      broadAccessSites: 0
    },
    findings: [],
    estateAssessment: {
      // Gate metadata that collectEstate()/updateEstateAssessment() (real product
      // code) do not themselves compute -- a genuine scan-tenant.ps1 run seeds these
      // before handing off to the enrichment step, so the fixture reproduces them here.
      assessmentType: "microsoft-365-copilot-estate-readiness",
      overallStatus: "InsufficientEvidence",
      decision: "EvidenceCollectionRequired",
      catalogVersion: catalog.catalogVersion,
      requiredDomains: catalog.domains.length,
      cohorts: [{
        id: COHORT_ID,
        name: "E2E approved pilot",
        approved: true,
        // Pre-resolved principalIds short-circuits inferLicensedCohort's Graph call
        // (estate-collector-suite.js: `if (existingCohort?.principalIds?.length) return
        // existingCohort;`), so cohort resolution also stays fully offline.
        principalIds: ["e2e-fixture-user-1"]
      }],
      controlResults: [],
      // updateEstateAssessment() (estate-collector-suite.js) maps over this array by
      // domain id and expects it to already exist -- the real PowerShell scanner
      // populates it from the same readiness catalog before handing off to
      // enrichEstateEvidence(). Mirror that here.
      domains: catalog.domains.map(domain => ({ id: domain.id, name: domain.name }))
    }
  };
}

async function workflowRunner(job, action, signal) {
  const scanPath = path.join(workspace, "baseline-scan.json");
  const scan = fs.existsSync(scanPath)
    ? JSON.parse(fs.readFileSync(scanPath, "utf8"))
    : seedScan();
  scan.generatedAt = new Date().toISOString();
  if (!scan.estateAssessment) scan.estateAssessment = { cohorts: [], controlResults: [] };
  fs.writeFileSync(scanPath, JSON.stringify(scan));
  const enriched = await collectEstate({
    rawToken: "e2e-fixture-unused-token",
    workspace,
    scan,
    signal,
    verifyAttestation: record => verifySignedAttestation(record, {
      key: integrityKey,
      keyId: integrityKeyId,
      now: new Date()
    }),
    verifyEvidencePackage,
    attestationIntegrity: { key: integrityKey, keyId: integrityKeyId },
    adapters: {
      // Safety net only: with grantedScopes = [] every Graph-gated control should be
      // rejected by the collector's own permission plan before ever calling request().
      // If this throws during a test run, it is a genuine signal that a control
      // collected evidence despite missing permissions.
      graphRequest: async () => {
        throw new Error(
          "E2E fixture: graph.microsoft.com was called despite an empty granted-scope " +
          "list; this indicates a permission-gating regression, not a fixture gap."
        );
      }
    }
  });
  fs.writeFileSync(scanPath, JSON.stringify(enriched));
  return "baseline";
}

const { server } = createApp({ port, workspace, workflowRunner });
server.listen(port, "127.0.0.1", () => {
  const actualPort = server.address().port;
  console.log(`FIXTURE_SERVER_READY ${actualPort}`);
});
process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
