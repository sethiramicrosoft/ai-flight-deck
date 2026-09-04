"use strict";

const crypto = require("node:crypto");
const catalog = require("./schema/readiness-catalog.v1.json");

const VERSION = "1.0.0";
const MAX_ROWS = 100000;
const MICROSOFT_ASSESSMENT_PINNED_VERSION =
  "f542406ffba2066d943643de8d7a87b755b98cab";

function normalizeHeader(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function parseCsvDocument(text) {
  if (typeof text !== "string" || !text.trim()) {
    throw new TypeError("The imported CSV is empty.");
  }
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === "\"" && text[index + 1] === "\"") {
        field += "\"";
        index++;
      } else if (character === "\"") {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === "\"") {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\r" || character === "\n") {
      if (character === "\r" && text[index + 1] === "\n") index++;
      row.push(field);
      field = "";
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
      if (rows.length > MAX_ROWS + 1) {
        throw new Error(`The imported CSV exceeds the ${MAX_ROWS} row limit.`);
      }
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("The imported CSV contains an unterminated quoted value.");
  row.push(field);
  if (row.some(value => value.trim())) rows.push(row);
  if (rows.length < 2) throw new Error("The imported CSV must contain a header and at least one data row.");

  const headers = rows[0].map(normalizeHeader);
  if (headers.some(header => !header)) throw new Error("The imported CSV contains a blank column header.");
  if (new Set(headers).size !== headers.length) {
    throw new Error("The imported CSV contains duplicate column headers.");
  }
  const records = rows.slice(1).map((values, index) => {
    if (values.length !== headers.length) {
      throw new Error(
        `The imported CSV row ${index + 2} has ${values.length} fields; expected ${headers.length}.`
      );
    }
    return Object.fromEntries(
      headers.map((header, columnIndex) => [header, String(values[columnIndex] || "").trim()])
    );
  });
  return { headers, records };
}

function parseCsv(text) {
  return parseCsvDocument(text).records;
}

function findValue(row, aliases) {
  for (const alias of aliases) {
    const value = row[normalizeHeader(alias)];
    if (value !== undefined) return value;
  }
  return undefined;
}

function requireColumns(row, columns, reportName) {
  const missing = columns.filter(column =>
    findValue(row, column.aliases) === undefined);
  if (missing.length) {
    throw new Error(
      `${reportName} is missing required columns: ${missing.map(column => column.name).join(", ")}.`
    );
  }
}

function yesNo(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["yes", "true", "1", "assigned", "eligible"].includes(normalized)) return true;
  if (["no", "false", "0", "not assigned", "ineligible"].includes(normalized)) return false;
  return null;
}

function normalizeTimestamp(value, fieldName) {
  if (value === undefined || value === null || value === "") return null;
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`${fieldName} must be a valid date or ISO-8601 timestamp.`);
  }
  return timestamp.toISOString();
}

function sourceArtifact(text, headers) {
  return {
    sha256: crypto.createHash("sha256").update(text, "utf8").digest("hex"),
    byteSize: Buffer.byteLength(text, "utf8"),
    headers,
    parserVersion: VERSION
  };
}

function countBy(rows, selector) {
  return rows.reduce((counts, row) => {
    const key = selector(row);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

const READINESS_COLUMNS = Object.freeze({
  userName: {
    name: "User name",
    aliases: ["User name", "Username", "User principal name", "UPN"]
  },
  hasCopilotLicense: {
    name: "Has Copilot license been assigned",
    aliases: [
      "Has Copilot license been assigned",
      "Copilot license assigned",
      "Has Copilot licence been assigned"
    ]
  },
  eligibleUpdateChannel: {
    name: "Uses eligible update channel",
    aliases: ["Uses eligible update channel", "Eligible update channel"]
  },
  teamsMeetings: {
    name: "Uses Teams Meetings",
    aliases: ["Uses Teams Meetings", "Teams Meetings"]
  },
  teamsChat: {
    name: "Uses Teams chat",
    aliases: ["Uses Teams chat", "Teams chat"]
  },
  outlookEmail: {
    name: "Uses Outlook Email",
    aliases: ["Uses Outlook Email", "Outlook Email"]
  },
  officeDocs: {
    name: "Uses Office docs",
    aliases: ["Uses Office docs", "Office docs"]
  },
  suggestedCandidate: {
    name: "Suggested candidate for Copilot",
    aliases: ["Suggested candidate for Copilot", "Suggested candidate"]
  }
});

const ASSESSMENT_COLUMNS = Object.freeze({
  service: { name: "Service", aliases: ["Service", "Service Area"] },
  feature: { name: "Feature", aliases: ["Feature"] },
  status: { name: "Status", aliases: ["Status"] },
  priority: { name: "Priority", aliases: ["Priority"] },
  observation: { name: "Observation", aliases: ["Observation"] },
  recommendation: { name: "Recommendation", aliases: ["Recommendation"] }
});

const ASSESSMENT_OPTIONAL_COLUMNS = Object.freeze({
  linkText: ["LinkText", "Link Text"],
  linkUrl: ["LinkUrl", "Link URL"]
});

const ASSESSMENT_CROSSWALK = Object.freeze({
  "DLP Governance - BLOCKER: HTTP Connector": {
    controlId: "AFD-PPA-001",
    status: "Fail",
    rationale: "The verified upstream check reports that tenant DLP blocks a connector required for Copilot extensibility."
  },
  "DLP Governance - WARNING: Custom Connectors": {
    controlId: "AFD-PPA-001",
    status: "Warning",
    rationale: "The verified upstream check reports a material connector-governance constraint."
  },
  "DLP Governance - Premium Connector Restrictions": {
    controlId: "AFD-PPA-001",
    status: "Warning",
    rationale: "The verified upstream check reports premium-connector restrictions that require owner review."
  },
  "DLP Governance - Copilot Extensibility": {
    controlId: "AFD-PPA-001",
    status: "Fail",
    rationale: "The upstream check found no Power Platform DLP policies; Flight Deck requires a tenant DLP baseline."
  },
  "DLP Governance - Copilot Friendly": {
    controlId: "AFD-PPA-001",
    status: "Warning",
    rationale: "The upstream check found policies without known connector blockers, but does not prove complete tenant and environment coverage."
  },
  "DLP Governance - Assessment Needed": {
    controlId: "AFD-PPA-001",
    status: "Unknown",
    reasonCode: "UPSTREAM_PERMISSION_REQUIRED",
    rationale: "The upstream collector could not assess Power Platform DLP."
  },
  "DLP Governance - Verification Failed": {
    controlId: "AFD-PPA-001",
    status: "Unknown",
    reasonCode: "UPSTREAM_COLLECTION_FAILED",
    rationale: "The upstream collector reported that Power Platform DLP verification failed."
  },
  "Defender for Endpoint - Device Onboarding": {
    controlId: "AFD-SEC-005",
    deriveStatus: true,
    rationale: "The upstream check provides Defender for Endpoint onboarding evidence, but does not prove 95 percent cohort coverage."
  },
  "Graph Connectors Deployment": {
    controlId: "AFD-COPILOT-003",
    deriveStatus: true,
    rationale: "The upstream check provides Graph connector deployment evidence, but not owner and permission-governance completeness."
  }
});

function looksAnonymized(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return !normalized ||
    /^user[-_ ]?\d+$/.test(normalized) ||
    /^anonymous/.test(normalized) ||
    /^hidden/.test(normalized) ||
    !normalized.includes("@");
}

function parseM365CopilotReadinessCsv(text, metadata = {}) {
  const csvDocument = parseCsvDocument(text);
  const csvRows = csvDocument.records;
  requireColumns(csvRows[0], Object.values(READINESS_COLUMNS), "Microsoft Copilot Readiness CSV");
  const rows = csvRows.map((row, index) => ({
    rowNumber: index + 2,
    userName: findValue(row, READINESS_COLUMNS.userName.aliases),
    hasCopilotLicense: yesNo(findValue(row, READINESS_COLUMNS.hasCopilotLicense.aliases)),
    eligibleUpdateChannel: yesNo(findValue(row, READINESS_COLUMNS.eligibleUpdateChannel.aliases)),
    usesTeamsMeetings: yesNo(findValue(row, READINESS_COLUMNS.teamsMeetings.aliases)),
    usesTeamsChat: yesNo(findValue(row, READINESS_COLUMNS.teamsChat.aliases)),
    usesOutlookEmail: yesNo(findValue(row, READINESS_COLUMNS.outlookEmail.aliases)),
    usesOfficeDocs: yesNo(findValue(row, READINESS_COLUMNS.officeDocs.aliases)),
    suggestedCandidate: yesNo(findValue(row, READINESS_COLUMNS.suggestedCandidate.aliases))
  }));
  const identifiedCount = rows.filter(row => !looksAnonymized(row.userName)).length;
  const concealedCount = rows.length - identifiedCount;
  const identitiesVisible = concealedCount === 0;
  const duplicateUsers = [...new Set(rows
    .filter(row => !looksAnonymized(row.userName))
    .map(row => row.userName.toLowerCase())
    .filter((userName, index, all) => all.indexOf(userName) !== index))];
  if (duplicateUsers.length) {
    throw new Error(`The readiness CSV contains duplicate identified users: ${duplicateUsers.join(", ")}.`);
  }
  const licensed = rows.filter(row => row.hasCopilotLicense === true);
  const suggested = rows.filter(row => row.suggestedCandidate === true);
  const eligibleChannel = licensed.filter(row => row.eligibleUpdateChannel === true);
  const reportedAt = normalizeTimestamp(metadata.reportedAt, "reportedAt");
  return {
    sourceType: "m365-copilot-readiness",
    sourceVersion: VERSION,
    fileName: String(metadata.fileName || "microsoft-copilot-readiness.csv"),
    importedAt: metadata.importedAt || new Date().toISOString(),
    reportedAt,
    freshness: reportedAt ? "SourceTimestampProvided" : "MissingSourceTimestamp",
    sourceArtifact: sourceArtifact(text, csvDocument.headers),
    privacy: {
      identitiesVisible,
      mode: identifiedCount === rows.length ? "Identified" :
        identifiedCount === 0 ? "Concealed" : "Mixed",
      identifiedRows: identifiedCount,
      concealedRows: concealedCount
    },
    scope: {
      windowDays: 28,
      maximumLatencyHours: 72,
      populationNote: "The exported user table contains users with relevant Microsoft 365 engagement."
    },
    summary: {
      rows: rows.length,
      copilotLicensedUsers: licensed.length,
      suggestedCandidates: suggested.length,
      licensedUsersOnEligibleChannel: eligibleChannel.length
    },
    rows
  };
}

function deriveAssessmentStatus(row, mapping) {
  if (!mapping.deriveStatus) {
    return { status: mapping.status, reasonCode: mapping.reasonCode || null };
  }
  const upstreamStatus = String(row.status || "").trim().toLowerCase();
  if (row.feature === "Defender for Endpoint - Device Onboarding") {
    if (["critical", "missing", "missing prerequisite", "not licensed"].includes(upstreamStatus)) {
      return { status: "Fail", reasonCode: null };
    }
    if (["warning", "attention required", "action required"].includes(upstreamStatus)) {
      return { status: "Warning", reasonCode: null };
    }
    if (upstreamStatus === "success") {
      return { status: "Warning", reasonCode: "COHORT_COVERAGE_NOT_PROVEN" };
    }
  }
  if (row.feature === "Graph Connectors Deployment") {
    if (["success", "warning"].includes(upstreamStatus)) {
      return {
        status: "Warning",
        reasonCode: upstreamStatus === "success" ? "CONNECTOR_GOVERNANCE_NOT_PROVEN" : null
      };
    }
  }
  return { status: "Unknown", reasonCode: "UPSTREAM_STATUS_NOT_CONCLUSIVE" };
}

function parseMicrosoftAutomatedAssessmentCsv(text, metadata = {}) {
  const csvDocument = parseCsvDocument(text);
  const csvRows = csvDocument.records;
  requireColumns(
    csvRows[0],
    Object.values(ASSESSMENT_COLUMNS),
    "Microsoft automated readiness assessment CSV"
  );
  const upstreamVersion = String(metadata.upstreamVersion || "").trim();
  if (!upstreamVersion) {
    throw new Error("The Microsoft automated assessment commit or release is required.");
  }
  const reportedAt = normalizeTimestamp(metadata.reportedAt, "reportedAt");
  const rows = csvRows.map((row, index) => ({
    rowNumber: index + 2,
    service: findValue(row, ASSESSMENT_COLUMNS.service.aliases),
    feature: findValue(row, ASSESSMENT_COLUMNS.feature.aliases),
    status: findValue(row, ASSESSMENT_COLUMNS.status.aliases),
    priority: findValue(row, ASSESSMENT_COLUMNS.priority.aliases),
    observation: findValue(row, ASSESSMENT_COLUMNS.observation.aliases),
    recommendation: findValue(row, ASSESSMENT_COLUMNS.recommendation.aliases),
    linkText: findValue(row, ASSESSMENT_OPTIONAL_COLUMNS.linkText) || "",
    linkUrl: findValue(row, ASSESSMENT_OPTIONAL_COLUMNS.linkUrl) || ""
  }));
  const mappedRows = [];
  const stagedRows = [];
  for (const row of rows) {
    if (upstreamVersion !== MICROSOFT_ASSESSMENT_PINNED_VERSION) {
      stagedRows.push({ ...row, stagingReason: "UNSUPPORTED_UPSTREAM_VERSION" });
      continue;
    }
    const mapping = ASSESSMENT_CROSSWALK[row.feature];
    if (!mapping) {
      stagedRows.push({ ...row, stagingReason: "NO_VERIFIED_CONTROL_CROSSWALK" });
      continue;
    }
    const derived = deriveAssessmentStatus(row, mapping);
    mappedRows.push({
      ...row,
      controlId: mapping.controlId,
      proposedStatus: reportedAt ? derived.status : "Unknown",
      reasonCode: reportedAt ? derived.reasonCode : "MISSING_SOURCE_TIMESTAMP",
      mappingRationale: mapping.rationale
    });
  }
  return {
    sourceType: "microsoft-automated-readiness-assessment",
    sourceVersion: VERSION,
    fileName: String(metadata.fileName || "m365_recommendations.csv"),
    importedAt: normalizeTimestamp(metadata.importedAt || new Date().toISOString(), "importedAt"),
    reportedAt,
    freshness: reportedAt ? "SourceTimestampProvided" : "MissingSourceTimestamp",
    upstreamVersion,
    supportedUpstreamVersion: MICROSOFT_ASSESSMENT_PINNED_VERSION,
    sourceArtifact: sourceArtifact(text, csvDocument.headers),
    summary: {
      rows: rows.length,
      mappedRows: mappedRows.length,
      stagedRows: stagedRows.length,
      byService: countBy(rows, row => row.service || "Unspecified"),
      byStatus: countBy(rows, row => row.status || "Unspecified")
    },
    mappedRows,
    stagedRows
  };
}

function createPilotCohort(readinessImport, options = {}) {
  if (readinessImport?.sourceType !== "m365-copilot-readiness") {
    throw new TypeError("A Microsoft Copilot Readiness import is required.");
  }
  if (!readinessImport.privacy?.identitiesVisible) {
    throw new Error("Pilot members cannot be selected because the readiness report conceals user identities.");
  }
  const selected = [...new Set((options.userNames || [])
    .map(value => String(value || "").trim().toLowerCase())
    .filter(Boolean))].sort();
  if (!selected.length) throw new Error("Select at least one user for the pilot cohort.");
  const rows = new Map(readinessImport.rows.map(row => [row.userName.toLowerCase(), row]));
  const missing = selected.filter(userName => !rows.has(userName));
  if (missing.length) {
    throw new Error(`Selected users were not found in the readiness report: ${missing.join(", ")}.`);
  }
  const owner = String(options.owner || "").trim();
  if (!owner) throw new Error("An accountable cohort owner is required.");
  return {
    schemaVersion: VERSION,
    id: String(options.id || "copilot-pilot").trim(),
    name: String(options.name || "Microsoft 365 Copilot pilot").trim(),
    owner,
    approved: options.approved === true,
    approvedAt: options.approved === true ? new Date().toISOString() : null,
    source: "Microsoft 365 Copilot Readiness report",
    sourceImportedAt: readinessImport.importedAt,
    userPrincipalNames: selected,
    population: selected.length,
    members: selected.map(userName => {
      const row = rows.get(userName);
      return {
        userPrincipalName: row.userName,
        hasCopilotLicense: row.hasCopilotLicense,
        eligibleUpdateChannel: row.eligibleUpdateChannel,
        suggestedCandidate: row.suggestedCandidate,
        activeWorkloads: [
          row.usesTeamsMeetings ? "Teams Meetings" : null,
          row.usesTeamsChat ? "Teams chat" : null,
          row.usesOutlookEmail ? "Outlook Email" : null,
          row.usesOfficeDocs ? "Office docs" : null
        ].filter(Boolean)
      };
    })
  };
}

function findControl(controlId) {
  for (const domain of catalog.domains) {
    const control = domain.controls.find(item => item.id === controlId);
    if (control) return { domain, control };
  }
  return null;
}

function buildImportedResult({
  scan,
  controlId,
  status,
  observedValue,
  source,
  importedAt,
  observedAt = importedAt,
  population = 1,
  evaluated = population,
  complete = true,
  confidence = 1,
  limitations = [],
  recommendation = null
}) {
  const match = findControl(controlId);
  if (!match) throw new Error(`Unknown readiness control '${controlId}'.`);
  const cohortId = scan.estateAssessment?.cohorts?.[0]?.id || "tenant-wide";
  return {
    controlId,
    controlVersion: catalog.catalogVersion,
    instanceId: `${scan.tenant.tenantId}:${cohortId}:${controlId}`,
    domainId: match.domain.id,
    cohortId,
    status,
    requirement: match.control.requirement,
    applicability: { applies: true, reason: match.control.applicability },
    observedValue,
    expectedValue: match.control.passCondition,
    observedAt,
    freshUntil: new Date(Date.parse(observedAt) +
      match.control.freshnessHours * 3600000).toISOString(),
    coverage: { population, evaluated, complete, excluded: 0, reason: source },
    confidence,
    provenance: {
      collectorId: "microsoft-upstream-evidence",
      collectorVersion: VERSION,
      collectorRunId: `import-${Date.parse(importedAt)}`,
      tenantId: scan.tenant.tenantId,
      actorId: scan.auth?.actor?.id || "local-operator",
      source,
      sourceVersion: VERSION,
      requestIds: []
    },
    evidenceRefs: [],
    affectedPrincipals: [],
    affectedResources: [],
    owner: null,
    remediation: {
      state: "NotPlanned",
      action: recommendation || match.control.remediation,
      packageId: null
    },
    attestation: null,
    limitations
  };
}

function readinessControlResults(scan, readinessImport) {
  const licensed = readinessImport.rows.filter(row => row.hasCopilotLicense === true);
  if (!licensed.length) return [];
  const eligible = licensed.filter(row => row.eligibleUpdateChannel === true);
  const ratio = eligible.length / licensed.length;
  const sourceTimestamp = readinessImport.reportedAt;
  if (!sourceTimestamp) {
    return [buildImportedResult({
      scan,
      controlId: "AFD-DEV-001",
      status: "Unknown",
      observedValue: {
        observedCopilotLicensedUsers: licensed.length,
        observedEligibleUpdateChannelUsers: eligible.length,
        observedEligiblePercentage: Math.round(ratio * 1000) / 10
      },
      source: "Microsoft 365 admin center Copilot Readiness CSV",
      importedAt: readinessImport.importedAt,
      population: licensed.length,
      evaluated: licensed.length,
      complete: false,
      confidence: 0,
      limitations: [{
        code: "MISSING_SOURCE_TIMESTAMP",
        description: "The report as-of date was not supplied, so this evidence cannot affect a mission decision."
      }]
    })];
  }
  if (ratio >= 0.95) {
    return [buildImportedResult({
      scan,
      controlId: "AFD-DEV-001",
      status: "Unknown",
      observedValue: {
        observedCopilotLicensedUsers: licensed.length,
        observedEligibleUpdateChannelUsers: eligible.length,
        observedEligiblePercentage: Math.round(ratio * 1000) / 10
      },
      source: "Microsoft 365 admin center Copilot Readiness CSV",
      importedAt: readinessImport.importedAt,
      observedAt: sourceTimestamp,
      population: licensed.length,
      evaluated: licensed.length,
      complete: false,
      confidence: 0.7,
      limitations: [{
        code: "READINESS_REPORT_ACTIVITY_POPULATION",
        description: "The readiness CSV is limited to users represented in Microsoft 365 activity reporting and cannot prove complete device coverage."
      }]
    })];
  }
  return [buildImportedResult({
    scan,
    controlId: "AFD-DEV-001",
    status: "Fail",
    observedValue: {
      observedCopilotLicensedUsers: licensed.length,
      observedEligibleUpdateChannelUsers: eligible.length,
      observedEligiblePercentage: Math.round(ratio * 1000) / 10
    },
    source: "Microsoft 365 admin center Copilot Readiness CSV",
    importedAt: readinessImport.importedAt,
    observedAt: sourceTimestamp,
    population: licensed.length,
    evaluated: licensed.length,
    complete: false,
    confidence: 0.85,
    limitations: [{
      code: "READINESS_REPORT_ACTIVITY_POPULATION",
      description: "The report proves that observed licensed users are below the required update-channel threshold, but may omit inactive users."
    }]
  })];
}

function assessmentControlResults(scan, assessmentImport) {
  const byControl = new Map();
  for (const row of assessmentImport.mappedRows || []) {
    if (!byControl.has(row.controlId)) byControl.set(row.controlId, []);
    byControl.get(row.controlId).push(row);
  }
  const rank = { Fail: 4, Warning: 3, Unknown: 2, Pass: 1 };
  return [...byControl.entries()].map(([controlId, rows]) => {
    const strongest = [...rows].sort((left, right) =>
      rank[right.proposedStatus] - rank[left.proposedStatus])[0];
    return buildImportedResult({
      scan,
      controlId,
      status: strongest.proposedStatus,
      observedValue: {
        upstreamFeatures: rows.map(row => ({
          feature: row.feature,
          status: row.status,
          priority: row.priority,
          observation: row.observation,
          recommendation: row.recommendation,
          linkText: row.linkText,
          linkUrl: row.linkUrl
        })),
        upstreamVersion: assessmentImport.upstreamVersion,
        artifactSha256: assessmentImport.sourceArtifact.sha256
      },
      source: "Microsoft M365 Copilot automated readiness assessment",
      importedAt: assessmentImport.importedAt,
      observedAt: assessmentImport.reportedAt || assessmentImport.importedAt,
      population: rows.length,
      evaluated: rows.length,
      complete: false,
      confidence: assessmentImport.reportedAt ? 0.85 : 0,
      limitations: [
        ...(strongest.reasonCode ? [{
          code: strongest.reasonCode,
          description: strongest.mappingRationale
        }] : []),
        {
          code: "UPSTREAM_CROSSWALK_CONSERVATIVE",
          description: "Only exact feature labels verified against the pinned upstream source are mapped. Flight Deck does not infer control results from similar titles."
        }
      ],
      recommendation: strongest.recommendation || undefined
    });
  });
}

function mergeImportedControlResults(scan, importedResults, sourceSummary) {
  if (!scan?.estateAssessment?.controlResults) {
    throw new TypeError("A tenant baseline with control results is required.");
  }
  const replacements = new Map(importedResults.map(result => [
    `${result.cohortId}:${result.controlId}`,
    result
  ]));
  const conflicts = [];
  scan.estateAssessment.controlResults = scan.estateAssessment.controlResults.map(result => {
    const imported = replacements.get(`${result.cohortId}:${result.controlId}`);
    if (!imported) return result;
    const liveConclusive = result.status !== "Unknown" &&
      result.provenance?.collectorId !== "microsoft-upstream-evidence";
    if (liveConclusive) {
      conflicts.push({
        controlId: result.controlId,
        cohortId: result.cohortId,
        retainedStatus: result.status,
        importedStatus: imported.status,
        importedSource: sourceSummary.sourceType,
        reason: "Fresh authoritative live evidence takes precedence over imported evidence."
      });
      return result;
    }
    return imported;
  });
  const existingKeys = new Set(scan.estateAssessment.controlResults.map(result =>
    `${result.cohortId}:${result.controlId}`));
  for (const result of importedResults) {
    const key = `${result.cohortId}:${result.controlId}`;
    if (!existingKeys.has(key)) {
      scan.estateAssessment.controlResults.push(result);
      existingKeys.add(key);
    }
  }
  scan.estateAssessment.totalControls = scan.estateAssessment.controlResults.length;
  scan.estateAssessment.evaluatedControls = scan.estateAssessment.controlResults
    .filter(result => result.status !== "Unknown").length;
  scan.estateAssessment.unknownControls = scan.estateAssessment.controlResults
    .filter(result => result.status === "Unknown").length;
  scan.estateAssessment.domains = (scan.estateAssessment.domains || []).map(domain => {
    const results = scan.estateAssessment.controlResults
      .filter(result => result.domainId === domain.id);
    const unknown = results.filter(result => result.status === "Unknown").length;
    return {
      ...domain,
      status: unknown === 0 ? "Collected" : "Partial",
      summary: `${results.length - unknown} of ${results.length} controls evaluated; ` +
        `${unknown} require additional permission, workload connection, or accountable evidence.`,
      nextStep: unknown
        ? "Open the domain controls to resolve each specific evidence limitation."
        : "Review failed and warning controls, then assign remediation owners."
    };
  });
  scan.estateAssessment.collectedDomains = scan.estateAssessment.domains
    .filter(domain => domain.status === "Collected").length;
  scan.estateAssessment.partialDomains = scan.estateAssessment.domains
    .filter(domain => domain.status === "Partial").length;
  const sources = Array.isArray(scan.estateAssessment.upstreamSources)
    ? scan.estateAssessment.upstreamSources
    : [];
  scan.estateAssessment.upstreamSources = [
    ...sources.filter(source => source.sourceType !== sourceSummary.sourceType),
    sourceSummary
  ].sort((left, right) => left.sourceType.localeCompare(right.sourceType));
  scan.estateAssessment.upstreamConflicts = [
    ...(scan.estateAssessment.upstreamConflicts || [])
      .filter(conflict => conflict.importedSource !== sourceSummary.sourceType),
    ...conflicts
  ];
  return scan;
}

module.exports = {
  buildImportedResult,
  createPilotCohort,
  mergeImportedControlResults,
  normalizeHeader,
  parseCsv,
  parseMicrosoftAutomatedAssessmentCsv,
  parseM365CopilotReadinessCsv,
  readinessControlResults,
  assessmentControlResults
};
