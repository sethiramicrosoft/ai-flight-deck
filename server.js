const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const crypto = require("crypto");
const catalog = require("./schema/readiness-catalog.v1.json");
const { AUTH_MODES, ConsentBroker, buildServicePlans } = require("./consent-broker");
const { buildCollectorDefinitions } = require("./collector-definitions");
const { collectEstate } = require("./estate-collector-suite");
const {
  assessmentControlResults,
  createPilotCohort,
  mergeImportedControlResults,
  parseMicrosoftAutomatedAssessmentCsv,
  parseM365CopilotReadinessCsv,
  readinessControlResults
} = require("./upstream-evidence");
const {
  appendControlHistory,
  createActionPackageBinding,
  createEvidenceEnvelope,
  deriveDriftByControl,
  evidenceEnvelopeDigest,
  sha256Digest,
  verifyEvidenceEnvelope
} = require("./evidence-integrity");
const {
  createSignedAttestation,
  verifySignedAttestation
} = require("./attestation-evidence");
const { validateEvidencePackage } = require("./collector-adapters");
const { buildEvidenceCompletionPlan } = require("./evidence-completion");

const DEFAULT_PORT = 8080;
const MAX_LOG_LENGTH = 50000;
const ALLOWED_ACTIONS = new Set(["baseline", "verify"]);
const GRAPH_CLI_CLIENT_ID = "14d82eec-204b-4c2f-b7e8-296a70dab67e";
const GRAPH_SCOPE_LIST = [
  "openid",
  "profile",
  "offline_access",
  "https://graph.microsoft.com/AccessReview.Read.All",
  "https://graph.microsoft.com/AppCatalog.Read.All",
  "https://graph.microsoft.com/Application.Read.All",
  "https://graph.microsoft.com/AuditLog.Read.All",
  "https://graph.microsoft.com/Channel.ReadBasic.All",
  "https://graph.microsoft.com/DeviceManagementApps.Read.All",
  "https://graph.microsoft.com/DeviceManagementConfiguration.Read.All",
  "https://graph.microsoft.com/DeviceManagementManagedDevices.Read.All",
  "https://graph.microsoft.com/DeviceManagementServiceConfig.Read.All",
  "https://graph.microsoft.com/Organization.Read.All",
  "https://graph.microsoft.com/Directory.Read.All",
  "https://graph.microsoft.com/ExternalConnection.Read.All",
  "https://graph.microsoft.com/Group.Read.All",
  "https://graph.microsoft.com/IdentityRiskyUser.Read.All",
  "https://graph.microsoft.com/InformationProtectionPolicy.Read",
  "https://graph.microsoft.com/OrgSettings-Microsoft365Install.Read.All",
  "https://graph.microsoft.com/Policy.Read.All",
  "https://graph.microsoft.com/Reports.Read.All",
  "https://graph.microsoft.com/RoleManagement.Read.Directory",
  "https://graph.microsoft.com/SecurityAlert.Read.All",
  "https://graph.microsoft.com/SecurityEvents.Read.All",
  "https://graph.microsoft.com/SecurityIncident.Read.All",
  "https://graph.microsoft.com/ServiceHealth.Read.All",
  "https://graph.microsoft.com/ServiceMessage.Read.All",
  "https://graph.microsoft.com/SharePointTenantSettings.Read.All",
  "https://graph.microsoft.com/Sites.Read.All",
  "https://graph.microsoft.com/Team.ReadBasic.All",
  "https://graph.microsoft.com/ThreatIndicators.Read.All",
  "https://graph.microsoft.com/User.Read.All",
  "https://graph.microsoft.com/UserAuthenticationMethod.Read.All"
];
const GRAPH_SCOPES = GRAPH_SCOPE_LIST.join(" ");

function resolvePowerShell() {
  const pwsh = spawnSync("where.exe", ["pwsh.exe"], { encoding: "utf8", windowsHide: true });
  if (pwsh.status === 0 && pwsh.stdout.trim()) {
    return pwsh.stdout.trim().split(/\r?\n/)[0];
  }
  return path.join(
    process.env.SystemRoot || "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe"
  );
}

function defaultWorkspace() {
  const localData = process.env.LOCALAPPDATA || process.env.USERPROFILE;
  if (!localData) {
    throw new Error("Unable to resolve the user-local application data directory.");
  }
  return path.join(localData, "AI Flight Deck", "live-test");
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

async function readJsonBody(req, maximumBytes) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > maximumBytes) throw new Error("Request body is too large.");
  }
  return JSON.parse(body || "{}");
}

function loadOrCreateIntegrityKey(workspace) {
  fs.mkdirSync(workspace, { recursive: true });
  const keyPath = path.join(workspace, "integrity-key.bin");
  if (fs.existsSync(keyPath)) {
    const existing = fs.readFileSync(keyPath);
    if (existing.length !== 32) {
      throw new Error("The local evidence integrity key has an invalid length.");
    }
    return existing;
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(keyPath, key, { flag: "wx", mode: 0o600 });
  return key;
}

function appendLog(job, text) {
  job.log = `${job.log}${text}`.slice(-MAX_LOG_LENGTH);
  job.updatedAt = new Date().toISOString();
}

function abortableDelay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new Error("Operation cancelled."));
      return;
    }
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason || new Error("Operation cancelled."));
    }, { once: true });
  });
}

function runPowerShell(job, executable, args, extraEnv = {}, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new Error("Workflow cancelled."));
      return;
    }
    const child = spawn(executable, args, {
      cwd: path.resolve(__dirname, ".."),
      windowsHide: false,
      env: { ...process.env, ...extraEnv, NO_COLOR: "1" }
    });
    job.pid = child.pid;
    child.stdout.on("data", chunk => appendLog(job, chunk.toString()));
    child.stderr.on("data", chunk => appendLog(job, chunk.toString()));
    const cancel = () => child.kill();
    signal?.addEventListener("abort", cancel, { once: true });
    child.on("error", reject);
    child.on("exit", code => {
      signal?.removeEventListener("abort", cancel);
      job.pid = null;
      if (signal?.aborted) {
        reject(signal.reason || new Error("Workflow cancelled."));
        return;
      }
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`The local workflow exited with code ${code}.`));
      }
    });
  });
}

async function acquireGraphToken(job, signal) {
  const deviceResponse = await fetch("https://login.microsoftonline.com/organizations/oauth2/v2.0/devicecode", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal,
    body: new URLSearchParams({
      client_id: GRAPH_CLI_CLIENT_ID,
      scope: GRAPH_SCOPES
    })
  });
  const device = await deviceResponse.json();
  if (!deviceResponse.ok || !device.device_code || !device.user_code) {
    throw new Error(device.error_description || "Microsoft sign-in could not be started.");
  }

  job.auth = {
    verificationUri: device.verification_uri,
    userCode: device.user_code,
    expiresAt: new Date(Date.now() + Number(device.expires_in) * 1000).toISOString()
  };
  job.updatedAt = new Date().toISOString();
  appendLog(job, "Microsoft sign-in is ready. Enter the one-time code shown above.\n");

  let intervalSeconds = Math.max(2, Number(device.interval) || 5);
  const deadline = Date.now() + Number(device.expires_in) * 1000;
  while (Date.now() < deadline) {
    await abortableDelay(intervalSeconds * 1000, signal);
    const tokenResponse = await fetch("https://login.microsoftonline.com/organizations/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal,
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: GRAPH_CLI_CLIENT_ID,
        device_code: device.device_code
      })
    });
    const token = await tokenResponse.json();
    if (tokenResponse.ok && token.access_token) {
      job.auth = null;
      job.updatedAt = new Date().toISOString();
      appendLog(job, "Microsoft sign-in completed.\n");
      return {
        value: token.access_token,
        expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000,
        tenantId: readJwtClaim(token.access_token, "tid")
      };
    }
    if (token.error === "authorization_pending") continue;
    if (token.error === "slow_down") {
      intervalSeconds += 5;
      continue;
    }
    throw new Error(token.error_description || "Microsoft sign-in was not completed.");
  }
  throw new Error("The Microsoft sign-in code expired. Start the scan again.");
}

function readJwtClaim(token, claim) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return "unresolved";
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof decoded[claim] === "string" && decoded[claim] ? decoded[claim] : "unresolved";
  } catch {
    return "unresolved";
  }
}

function createWorkflowRunner({
  workspace = defaultWorkspace(),
  executable = resolvePowerShell(),
  verifyAttestation,
  verifyEvidencePackage,
  attestationIntegrity
} = {}) {
  const workflowScript = path.join(__dirname, "scanner", "test-live-tenant.ps1");
  let cachedToken = null;
  const consentBroker = new ConsentBroker();
  const installCommand = [
    "-NoProfile",
    "-Command",
    [
      "$ErrorActionPreference = 'Stop'",
      "if (-not (Get-Module -ListAvailable -Name Microsoft.Graph.Authentication)) {",
      "  Install-Module Microsoft.Graph.Authentication -Scope CurrentUser -Force -AllowClobber -Confirm:$false",
      "}",
      "Write-Host 'Microsoft Graph authentication connector is ready.'"
    ].join("; ")
  ];

  async function enrichEstateEvidence(rawToken, artifactPath, signal, job) {
    const scan = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    const enriched = await collectEstate({
      rawToken,
      workspace,
      scan,
      signal,
      verifyAttestation,
      verifyEvidencePackage,
      attestationIntegrity
    });
    writeJsonAtomic(artifactPath, enriched);
    appendLog(job,
      `Estate collectors attempted all 13 domains and evaluated ` +
      `${enriched.estateAssessment.evaluatedControls} of 77 controls.\n`);
  }

  return async (job, action, signal) => {
    appendLog(job, "Preparing the Microsoft Graph connector...\n");
    await runPowerShell(job, executable, installCommand, {}, signal);
    if (!cachedToken || cachedToken.expiresAt - Date.now() < 5 * 60 * 1000) {
      appendLog(job, "Requesting Microsoft sign-in...\n");
      cachedToken = await acquireGraphToken(job, signal);
    } else {
      appendLog(job, "Reusing the current in-memory Microsoft sign-in.\n");
    }
    const binding = {
      tenantId: cachedToken.tenantId,
      jobId: job.id,
      collectorId: "graph-bounded-tenant-inventory",
      authMode: AUTH_MODES.LOCAL_DELEGATED,
      signal
    };
    const tokenHandle = consentBroker.createTokenHandle({
      ...binding,
      rawToken: cachedToken.value,
      expiresAt: cachedToken.expiresAt
    });
    if (action === "baseline") {
      appendLog(job, "Starting the read-only baseline scan...\n");
      await consentBroker.withTokenHandle(tokenHandle, binding, rawToken =>
        runPowerShell(job, executable, [
          "-NoProfile",
          "-File",
          workflowScript,
          "-Phase",
          "Baseline",
          "-WorkspacePath",
          workspace,
          "-AuthMode",
          "AccessToken"
        ], { FLIGHT_DECK_GRAPH_ACCESS_TOKEN: rawToken }, signal)
          .then(() => enrichEstateEvidence(
            rawToken,
            path.join(workspace, "baseline-scan.json"),
            signal,
            job
          )));
      return "baseline";
    }

    appendLog(job, "Starting post-change verification...\n");
    await consentBroker.withTokenHandle(tokenHandle, binding, rawToken =>
      runPowerShell(job, executable, [
        "-NoProfile",
        "-File",
        workflowScript,
        "-Phase",
        "Verification",
        "-WorkspacePath",
        workspace
      ], { FLIGHT_DECK_GRAPH_ACCESS_TOKEN: rawToken }, signal)
        .then(() => enrichEstateEvidence(
          rawToken,
          path.join(workspace, "verification-scan.json"),
          signal,
          job
        )));
    appendLog(job, "Comparing the baseline and verification evidence...\n");
    await runPowerShell(job, executable, [
      "-NoProfile",
      "-File",
      workflowScript,
      "-Phase",
      "Compare",
      "-WorkspacePath",
      workspace
    ], {}, signal);
    return "report";
  };
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(payload);
}

function createApp({
  port = DEFAULT_PORT,
  root = __dirname,
  workspace = defaultWorkspace(),
  workflowRunner = null
} = {}) {
  const jobs = new Map();
  const jobControllers = new Map();
  const evidenceChallenges = new Map();
  const integrityKey = loadOrCreateIntegrityKey(workspace);
  const integrityKeyId =
    `local-workspace-${crypto.createHash("sha256").update(integrityKey).digest("hex").slice(0, 16)}`;
  const evidencePackagePaths = {
    admin: path.join(workspace, "admin-evidence.json"),
    powerPlatform: path.join(workspace, "power-platform-evidence.json")
  };
  const evidencePackageEnvelopePaths = {
    admin: path.join(workspace, "admin-evidence.envelope.json"),
    powerPlatform: path.join(workspace, "power-platform-evidence.envelope.json")
  };
  const attestationsPath = path.join(workspace, "attestations.json");

  function verifyEvidencePackage(kind, document) {
    const envelopePath = evidencePackageEnvelopePaths[kind];
    if (!envelopePath || !fs.existsSync(envelopePath)) return false;
    const envelope = JSON.parse(fs.readFileSync(envelopePath, "utf8"));
    verifyEvidenceEnvelope(envelope, integrityKey);
    return sha256Digest(document) === envelope.payloadDigest;
  }

  function evidencePackageReady(kind) {
    const documentPath = evidencePackagePaths[kind];
    if (!fs.existsSync(documentPath)) return false;
    try {
      return verifyEvidencePackage(
        kind,
        JSON.parse(fs.readFileSync(documentPath, "utf8"))
      );
    } catch {
      return false;
    }
  }

  const runWorkflow = workflowRunner || createWorkflowRunner({
    workspace,
    verifyAttestation: record => verifySignedAttestation(record, {
      key: integrityKey,
      keyId: integrityKeyId,
      now: new Date()
    }),
    verifyEvidencePackage,
    attestationIntegrity: { key: integrityKey, keyId: integrityKeyId }
  });
  let activeJobId = null;
  const artifactPaths = {
    baseline: path.join(workspace, "baseline-scan.json"),
    report: path.join(workspace, "verification-report.json"),
    history: path.join(workspace, "control-history.json"),
    readinessImport: path.join(workspace, "m365-copilot-readiness.json"),
    assessmentImport: path.join(workspace, "microsoft-automated-assessment.json"),
    cohort: path.join(workspace, "cohort-config.json")
  };
  const envelopePaths = {
    baseline: path.join(workspace, "baseline-scan.envelope.json"),
    report: path.join(workspace, "verification-report.envelope.json")
  };

  function sealArtifact(kind) {
    const artifactPath = artifactPaths[kind];
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    if (kind === "baseline") {
      if (artifact.evidenceGraph) {
        artifact.evidenceGraphEnvelope = createEvidenceEnvelope({
          tenant: artifact.tenant?.tenantId || artifact.tenant?.id,
          producer: "ai-flight-deck/evidence-graph-builder",
          generatedAt: artifact.generatedAt,
          payload: artifact.evidenceGraph,
          keyId: integrityKeyId,
          key: integrityKey
        });
        delete artifact.evidenceGraph;
        writeJsonAtomic(artifactPath, artifact);
      }

      const history = fs.existsSync(artifactPaths.history)
        ? JSON.parse(fs.readFileSync(artifactPaths.history, "utf8"))
        : {};
      for (const result of artifact.estateAssessment?.controlResults || []) {
        history[result.controlId] = appendControlHistory(history[result.controlId] || [], result);
      }
      writeJsonAtomic(artifactPaths.history, history);
    }
    const envelope = createEvidenceEnvelope({
      tenant: artifact.tenant?.tenantId || artifact.tenant?.id,
      producer: artifact.producer,
      generatedAt: artifact.generatedAt,
      payload: artifact,
      keyId: integrityKeyId,
      key: integrityKey
    });
    writeJsonAtomic(envelopePaths[kind], envelope);
    return envelope;
  }

  function readVerifiedArtifact(kind) {
    const artifact = JSON.parse(fs.readFileSync(artifactPaths[kind], "utf8"));
    const envelope = JSON.parse(fs.readFileSync(envelopePaths[kind], "utf8"));
    verifyEvidenceEnvelope(envelope, integrityKey);
    if (sha256Digest(artifact) !== envelope.payloadDigest) {
      throw new Error("The stored artifact no longer matches its signed evidence envelope.");
    }
    return {
      ...artifact,
      integrity: {
        verifiedByLocalService: true,
        keyId: envelope.keyId,
        envelopeDigest: evidenceEnvelopeDigest(envelope)
      }
    };
  }

  function sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    const host = req.headers.host;
    return typeof host === "string" &&
      (/^127\.0\.0\.1:\d+$/.test(host) || /^localhost:\d+$/.test(host)) &&
      origin === `http://${host}`;
  }

  function trustedUiMutation(req) {
    const origin = req.headers.origin;
    const host = req.headers.host;
    const localHost = typeof host === "string" &&
      (/^127\.0\.0\.1:\d+$/.test(host) || /^localhost:\d+$/.test(host));
    return localHost && origin === `http://${host}` &&
      req.headers["x-flight-deck"] === "local-ui";
  }

  function requireTrustedUiMutation(req, res) {
    if (trustedUiMutation(req)) return true;
    json(res, 403, {
      error: "State-changing requests require the trusted local UI origin."
    });
    return false;
  }

  function verifiedBaselineContext() {
    if (!fs.existsSync(artifactPaths.baseline) || !fs.existsSync(envelopePaths.baseline)) {
      throw new Error("A locally verified live baseline is required.");
    }
    const baseline = readVerifiedArtifact("baseline");
    const tenantId = baseline.tenant?.tenantId || baseline.tenant?.id;
    if (!tenantId) throw new Error("The verified baseline does not identify its tenant.");
    return { baseline, tenantId };
  }

  async function startJob(action) {
    if (!ALLOWED_ACTIONS.has(action)) {
      throw new Error("Unsupported workflow action.");
    }
    if (activeJobId) {
      const active = jobs.get(activeJobId);
      if (active && active.status === "running") {
        throw new Error("Another tenant workflow is already running.");
      }
    }
    const id = crypto.randomUUID();
    const job = {
      id,
      action,
      status: "running",
      result: null,
      error: null,
      log: "",
      pid: null,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    jobs.set(id, job);
    const controller = new AbortController();
    jobControllers.set(id, controller);
    activeJobId = id;
    Promise.resolve()
      .then(() => runWorkflow(job, action, controller.signal))
      .then(result => {
        sealArtifact(result);
        job.status = "completed";
        job.result = result;
        job.updatedAt = new Date().toISOString();
      })
      .catch(error => {
        job.status = controller.signal.aborted ? "cancelled" : "failed";
        job.error = error.message || "The tenant workflow failed.";
        job.auth = null;
        job.updatedAt = new Date().toISOString();
      })
      .finally(() => {
        jobControllers.delete(id);
        if (activeJobId === id) activeJobId = null;
      });
    return job;
  }

  const server = http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url, `http://127.0.0.1:${port}`);
      const pathname = decodeURIComponent(requestUrl.pathname);

      if (pathname.startsWith("/api/")) {
        if (!sameOrigin(req)) {
          json(res, 403, { error: "Cross-origin requests are not allowed." });
          return;
        }
        if (req.method === "GET" && pathname === "/api/status") {
          json(res, 200, {
            service: "ai-flight-deck-local",
            ready: true,
            activeJobId,
            artifacts: {
              baseline: fs.existsSync(artifactPaths.baseline),
              report: fs.existsSync(artifactPaths.report),
              adminEvidence: evidencePackageReady("admin"),
              powerPlatformEvidence: evidencePackageReady("powerPlatform"),
              attestations: fs.existsSync(attestationsPath)
            }
          });
          return;
        }
        if (req.method === "GET" && pathname === "/api/evidence-sources") {
          const attestations = fs.existsSync(attestationsPath)
            ? JSON.parse(fs.readFileSync(attestationsPath, "utf8"))
            : { attestations: [] };
          json(res, 200, {
            adminEvidence: fs.existsSync(evidencePackagePaths.admin),
            powerPlatformEvidence: fs.existsSync(evidencePackagePaths.powerPlatform),
            attestations: Array.isArray(attestations)
              ? attestations.length
              : (attestations.attestations || []).length,
            maximumPackageAgeHours: 24
          });
          return;
        }
        if (req.method === "POST" && pathname === "/api/evidence-challenges") {
          if (!requireTrustedUiMutation(req, res)) return;
          const input = await readJsonBody(req, 4096);
          if (!["admin", "powerPlatform"].includes(input.kind)) {
            throw new Error("Evidence challenge kind must be admin or powerPlatform.");
          }
          const { tenantId } = verifiedBaselineContext();
          const challenge = crypto.randomBytes(32).toString("base64url");
          const record = {
            challenge,
            kind: input.kind,
            tenantId,
            expiresAt: Date.now() + 30 * 60 * 1000
          };
          evidenceChallenges.set(challenge, record);
          json(res, 201, {
            kind: record.kind,
            tenantId: record.tenantId,
            challenge: record.challenge,
            expiresAt: new Date(record.expiresAt).toISOString()
          });
          return;
        }
        if (req.method === "POST" && pathname === "/api/evidence-packages") {
          if (!requireTrustedUiMutation(req, res)) return;
          const input = await readJsonBody(req, 12 * 1024 * 1024);
          if (!["admin", "powerPlatform"].includes(input.kind)) {
            throw new Error("Evidence package kind must be admin or powerPlatform.");
          }
          const document = typeof input.content === "string"
            ? JSON.parse(input.content)
            : input.document;
          const schema = input.kind === "admin"
            ? "ai-flight-deck/admin-evidence"
            : "ai-flight-deck/power-platform-evidence";
          const expectedProducer = input.kind === "admin"
            ? "ai-flight-deck/admin-evidence-collector"
            : "ai-flight-deck/power-platform-evidence-template";
          const { tenantId } = verifiedBaselineContext();
          const challenge = evidenceChallenges.get(document?.collectionChallenge);
          if (!challenge ||
              challenge.kind !== input.kind ||
              challenge.tenantId !== tenantId ||
              challenge.expiresAt <= Date.now()) {
            throw new Error(
              "The evidence package does not contain a current one-time collection challenge."
            );
          }
          if (document.producerId !== expectedProducer ||
              document.producerVersion !== "1.0.0") {
            throw new Error("The evidence package producer identity is not supported.");
          }
          validateEvidencePackage(document, {
            schema,
            tenantId,
            maximumAgeHours: 24,
            fileName: `${input.kind} evidence package`
          });
          writeJsonAtomic(evidencePackagePaths[input.kind], document);
          const envelope = createEvidenceEnvelope({
            tenant: document.tenantId,
            producer: `ai-flight-deck/${input.kind}-evidence-import`,
            generatedAt: document.producedAt,
            payload: document,
            keyId: integrityKeyId,
            key: integrityKey
          });
          writeJsonAtomic(evidencePackageEnvelopePaths[input.kind], envelope);
          evidenceChallenges.delete(document.collectionChallenge);
          json(res, 200, {
            kind: input.kind,
            tenantId: document.tenantId,
            producedAt: document.producedAt,
            evidenceItems: Object.keys(document.evidence || {}).length,
            errors: Object.keys(document.errors || {}).length,
            integrityVerified: true
          });
          return;
        }
        if (req.method === "GET" && pathname === "/api/attestations") {
          const document = fs.existsSync(attestationsPath)
            ? JSON.parse(fs.readFileSync(attestationsPath, "utf8"))
            : { schema: "ai-flight-deck/attestations", version: "1.0.0", attestations: [] };
          json(res, 200, document);
          return;
        }
        if (req.method === "POST" && pathname === "/api/attestations") {
          if (!requireTrustedUiMutation(req, res)) return;
          const input = await readJsonBody(req, 1024 * 1024);
          const { baseline, tenantId: baselineTenantId } = verifiedBaselineContext();
          const cohort = (baseline.estateAssessment?.cohorts || [])
            .find(item => item.id === input.cohortId);
          if (baselineTenantId !== input.tenantId) {
            throw new Error("The attestation tenant does not match the verified live baseline.");
          }
          if (!cohort || cohort.approved !== true) {
            throw new Error("The attestation must target an explicitly approved baseline cohort.");
          }
          const record = createSignedAttestation({
            catalog,
            input: {
              ...input,
              attestedBy: baseline.auth?.actor?.id ||
                baseline.auth?.actor?.userPrincipalName ||
                "verified-scan-actor"
            },
            key: integrityKey,
            keyId: integrityKeyId,
            now: new Date()
          });
          const document = fs.existsSync(attestationsPath)
            ? JSON.parse(fs.readFileSync(attestationsPath, "utf8"))
            : { schema: "ai-flight-deck/attestations", version: "1.0.0", attestations: [] };
          const records = Array.isArray(document) ? document : document.attestations;
          const next = {
            schema: "ai-flight-deck/attestations",
            version: "1.0.0",
            attestations: [...(records || []), record]
          };
          writeJsonAtomic(attestationsPath, next);
          json(res, 201, {
            ...record,
            signature: undefined,
            integrityVerified: true
          });
          return;
        }
        if (req.method === "GET" && pathname === "/api/capabilities") {
          const authMode = requestUrl.searchParams.get("authMode") || "local-delegated";
          const plans = buildServicePlans(buildCollectorDefinitions(), {
            authMode,
            grantedPermissions: GRAPH_SCOPES.split(" ")
              .filter(scope => scope.startsWith("https://graph.microsoft.com/"))
              .map(scope => scope.replace("https://graph.microsoft.com/", "")),
            availableLicenses: [],
            assignedAdminRoles: []
          });
          json(res, 200, {
            authMode,
            inventoryStatus: "Pre-authentication requirements only",
            plans,
            controlPlan: buildEvidenceCompletionPlan({
              catalog,
              grantedPermissions: GRAPH_SCOPES.split(" ")
                .filter(scope => scope.startsWith("https://graph.microsoft.com/"))
                .map(scope => scope.replace("https://graph.microsoft.com/", "")),
              availableLicenses: [],
              now: new Date()
            }).controls
          });
          return;
        }
        if (req.method === "GET" && pathname === "/api/control-history") {
          if (!fs.existsSync(artifactPaths.history)) {
            json(res, 200, { histories: {}, drift: {} });
            return;
          }
          const histories = JSON.parse(fs.readFileSync(artifactPaths.history, "utf8"));
          json(res, 200, {
            histories,
            drift: deriveDriftByControl(histories, new Date())
          });
          return;
        }
        if (req.method === "GET" && pathname === "/api/upstream-evidence") {
          const readiness = fs.existsSync(artifactPaths.readinessImport)
            ? JSON.parse(fs.readFileSync(artifactPaths.readinessImport, "utf8"))
            : null;
          const assessment = fs.existsSync(artifactPaths.assessmentImport)
            ? JSON.parse(fs.readFileSync(artifactPaths.assessmentImport, "utf8"))
            : null;
          const cohort = fs.existsSync(artifactPaths.cohort)
            ? JSON.parse(fs.readFileSync(artifactPaths.cohort, "utf8"))
            : null;
          json(res, 200, { readiness, assessment, cohort });
          return;
        }
        if (req.method === "POST" && pathname === "/api/upstream-evidence") {
          if (!requireTrustedUiMutation(req, res)) return;
          const input = await readJsonBody(req, 12 * 1024 * 1024);
          if (!["m365-copilot-readiness", "microsoft-automated-readiness-assessment"]
            .includes(input.sourceType)) {
            throw new Error("Unsupported upstream evidence source.");
          }
          const importedAt = new Date().toISOString();
          const imported = input.sourceType === "m365-copilot-readiness"
            ? parseM365CopilotReadinessCsv(input.content, {
              fileName: input.fileName,
              importedAt,
              reportedAt: input.reportedAt || null
            })
            : parseMicrosoftAutomatedAssessmentCsv(input.content, {
              fileName: input.fileName,
              importedAt,
              reportedAt: input.reportedAt || null,
              upstreamVersion: input.upstreamVersion
            });
          const importPath = imported.sourceType === "m365-copilot-readiness"
            ? artifactPaths.readinessImport
            : artifactPaths.assessmentImport;
          writeJsonAtomic(importPath, imported);
          let artifactUpdated = false;
          if (fs.existsSync(artifactPaths.baseline) && fs.existsSync(envelopePaths.baseline)) {
            const baseline = readVerifiedArtifact("baseline");
            delete baseline.integrity;
            mergeImportedControlResults(
              baseline,
              imported.sourceType === "m365-copilot-readiness"
                ? readinessControlResults(baseline, imported)
                : assessmentControlResults(baseline, imported),
              {
                sourceType: imported.sourceType,
                importedAt: imported.importedAt,
                reportedAt: imported.reportedAt,
                fileName: imported.fileName,
                rows: imported.summary.rows,
                privacyMode: imported.privacy?.mode,
                upstreamVersion: imported.upstreamVersion,
                artifactSha256: imported.sourceArtifact.sha256,
                mappedRows: imported.summary.mappedRows,
                stagedRows: imported.summary.stagedRows
              }
            );
            writeJsonAtomic(artifactPaths.baseline, baseline);
            sealArtifact("baseline");
            artifactUpdated = true;
          }
          json(res, 200, {
            ...imported,
            artifactUpdated
          });
          return;
        }
        if (req.method === "POST" && pathname === "/api/cohorts") {
          if (!requireTrustedUiMutation(req, res)) return;
          if (!fs.existsSync(artifactPaths.readinessImport)) {
            throw new Error("Import the Microsoft Copilot Readiness CSV before creating a pilot cohort.");
          }
          const input = await readJsonBody(req, 1024 * 1024);
          const readiness = JSON.parse(fs.readFileSync(artifactPaths.readinessImport, "utf8"));
          const cohort = createPilotCohort(readiness, {
            id: input.id,
            name: input.name,
            owner: input.owner,
            approved: input.approved === true,
            userNames: input.userNames
          });
          writeJsonAtomic(artifactPaths.cohort, cohort);
          json(res, 200, cohort);
          return;
        }
        if (req.method === "POST" && pathname === "/api/action-bindings") {
          if (!requireTrustedUiMutation(req, res)) return;
          const input = await readJsonBody(req, 1048576);
          const baselineEnvelope = JSON.parse(fs.readFileSync(envelopePaths.baseline, "utf8"));
          verifyEvidenceEnvelope(baselineEnvelope, integrityKey);
          const binding = createActionPackageBinding({
            baselineDigest: evidenceEnvelopeDigest(baselineEnvelope),
            selectedEvidenceIds: input.selectedEvidenceIds,
            selectedControlIds: input.selectedControlIds,
            actionPackage: input.actionPackage
          });
          json(res, 200, binding);
          return;
        }
        if (req.method === "POST" && pathname === "/api/jobs") {
          if (!requireTrustedUiMutation(req, res)) return;
          const input = await readJsonBody(req, 4096);
          const job = await startJob(input.action);
          json(res, 202, { id: job.id, status: job.status });
          return;
        }
        const jobMatch = pathname.match(/^\/api\/jobs\/([0-9a-f-]+)$/i);
        if (req.method === "DELETE" && jobMatch) {
          if (!requireTrustedUiMutation(req, res)) return;
          const job = jobs.get(jobMatch[1]);
          const controller = jobControllers.get(jobMatch[1]);
          if (!job || !controller) {
            json(res, 404, { error: "Running workflow job not found." });
            return;
          }
          controller.abort(new Error("Workflow cancelled by the local operator."));
          job.status = "cancelling";
          job.auth = null;
          job.updatedAt = new Date().toISOString();
          json(res, 202, { id: job.id, status: job.status });
          return;
        }
        if (req.method === "GET" && jobMatch) {
          const job = jobs.get(jobMatch[1]);
          if (!job) {
            json(res, 404, { error: "Workflow job not found." });
            return;
          }
          json(res, 200, job);
          return;
        }
        const artifactMatch = pathname.match(/^\/api\/artifacts\/(baseline|report)$/);
        if (req.method === "GET" && artifactMatch) {
          const artifactPath = artifactPaths[artifactMatch[1]];
          if (!fs.existsSync(artifactPath)) {
            json(res, 404, { error: "The requested evidence artifact is not available." });
            return;
          }
          if (!fs.existsSync(envelopePaths[artifactMatch[1]])) {
            json(res, 409, { error: "The requested artifact has not been sealed by this local service session." });
            return;
          }
          const data = Buffer.from(JSON.stringify(readVerifiedArtifact(artifactMatch[1])));
          res.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Length": data.length,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff"
          });
          res.end(data);
          return;
        }
        json(res, 404, { error: "API route not found." });
        return;
      }

      const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
      const filePath = path.resolve(root, relativePath);
      if (filePath !== path.resolve(root) && !filePath.startsWith(`${path.resolve(root)}${path.sep}`)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
      fs.readFile(filePath, (error, data) => {
        if (error) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        const mime = {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".json": "application/json; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".png": "image/png",
          ".svg": "image/svg+xml"
        };
        res.writeHead(200, {
          "Content-Type": mime[path.extname(filePath)] || "application/octet-stream",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff"
        });
        res.end(data);
      });
    } catch (error) {
      json(res, error.message === "Another tenant workflow is already running." ? 409 : 400, {
        error: error.message || "Request failed."
      });
    }
  });

  return { server, jobs, artifactPaths };
}

if (require.main === module) {
  const port = Number(process.argv[2] || DEFAULT_PORT);
  const { server } = createApp({ port });
  server.listen(port, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${port}/index.html`;
    console.log(`AI Flight Deck is running at ${url}`);
    if (process.argv.includes("--open")) {
      const opener = spawn(process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe", ["/c", "start", "", url], {
        detached: true,
        stdio: "ignore",
        windowsHide: true
      });
      opener.unref();
    }
  });
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
  process.on("SIGINT", () => server.close(() => process.exit(0)));
}

module.exports = { createApp, createWorkflowRunner, defaultWorkspace, GRAPH_SCOPE_LIST };
