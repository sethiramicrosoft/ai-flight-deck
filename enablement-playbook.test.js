"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const catalog = require("./schema/readiness-catalog.v1.json");
const {
  DOMAIN_PROFILES,
  CONTROL_OVERRIDES,
  CONTROL_CHECKLISTS,
  controlPlaybook,
  buildTenantPlan,
  tenantPlanMarkdown
} = require("./enablement-playbook");

test("every readiness control produces an actionable Microsoft-sourced playbook", () => {
  const playbooks = catalog.domains.flatMap(domain =>
    domain.controls.map(control => controlPlaybook(domain, control))
  );

  assert.equal(playbooks.length, 77);
  assert.equal(Object.keys(DOMAIN_PROFILES).length, 13);
  assert.equal(Object.keys(CONTROL_OVERRIDES).length, 77);
  assert.equal(Object.keys(CONTROL_CHECKLISTS).length, 77);
  for (const playbook of playbooks) {
    assert.match(playbook.portalUrl, /^https:\/\//);
    assert.ok(playbook.adminPath.length > 8);
    assert.ok(playbook.responsibleRoles.length > 0);
    assert.equal(playbook.steps.length, 6);
    assert.ok(playbook.steps.every(step => step.length > 20));
    assert.deepEqual(playbook.steps.slice(2, 4), CONTROL_CHECKLISTS[playbook.controlId]);
    assert.match(playbook.requirementOrigin, /not automatically Microsoft deployment prerequisites/);
    assert.ok(playbook.collection.steps.length >= 2);
    assert.ok(playbook.collection.limitation.length > 20);
    assert.ok(playbook.sources.length > 0);
    assert.ok(playbook.sources.every(source =>
      /^https:\/\/(learn|adoption)\.microsoft\.com\//.test(source.url)
    ));
    assert.ok(playbook.validation.acceptanceCriterion.length > 20);
    assert.ok(playbook.validation.evidenceSources.length > 0);
  }
});

test("tenant recommendation distinguishes mandatory gates from advisory conditions", () => {
  const unknownPlan = buildTenantPlan({ catalog, controlResults: [], tenantName: "Contoso" });
  assert.equal(unknownPlan.recommendation, "NO-GO");
  assert.equal(unknownPlan.summary.total, 77);
  assert.ok(unknownPlan.summary.gateBlockers > 0);

  const observedAt = "2026-09-07T00:00:00Z";
  const passResults = catalog.domains.flatMap(domain =>
    domain.controls.map(control => ({
      controlId: control.id,
      cohortId: "tenant-wide",
      status: "Pass",
      observedAt,
      freshUntil: new Date(
        Date.parse(observedAt) + control.freshnessHours * 60 * 60 * 1000
      ).toISOString(),
      coverage: {
        population: 100,
        evaluated: 100,
        complete: true
      }
    }))
  );
  const readyPlan = buildTenantPlan({
    catalog,
    controlResults: passResults,
    tenantName: "Contoso",
    cohortId: "tenant-wide",
    cohortApproved: true,
    evidenceTrusted: true,
    now: new Date("2026-09-07T00:30:00Z")
  });
  assert.equal(readyPlan.recommendation, "READY");
  assert.equal(readyPlan.summary.complete, 77);

  const advisory = catalog.domains.flatMap(domain => domain.controls)
    .find(control => control.requirement === "Advisory");
  const conditionalResults = passResults.map(result =>
    result.controlId === advisory.id ? { ...result, status: "Warning" } : result
  );
  const conditionalPlan = buildTenantPlan({
    catalog,
    controlResults: conditionalResults,
    tenantName: "Contoso",
    cohortId: "tenant-wide",
    cohortApproved: true,
    evidenceTrusted: true,
    now: new Date("2026-09-07T00:30:00Z")
  });
  assert.equal(conditionalPlan.recommendation, "GO WITH CONDITIONS");
  assert.equal(conditionalPlan.summary.ownerReview, 1);

  const expiredResults = passResults.map(result =>
    result.controlId === "AFD-LIC-001"
      ? { ...result, freshUntil: "2026-01-01T00:00:00Z" }
      : result
  );
  const expiredPlan = buildTenantPlan({
    catalog,
    controlResults: expiredResults,
    tenantName: "Contoso",
    cohortId: "tenant-wide",
    cohortApproved: true,
    evidenceTrusted: true,
    now: new Date("2026-09-07T00:00:00Z")
  });
  assert.equal(expiredPlan.recommendation, "NO-GO");
  assert.equal(expiredPlan.summary.evidenceRequired, 1);

  const untrustedPlan = buildTenantPlan({
    catalog,
    controlResults: passResults,
    tenantName: "Contoso",
    cohortId: "tenant-wide",
    cohortApproved: true,
    now: new Date("2026-09-07T00:30:00Z")
  });
  assert.equal(untrustedPlan.recommendation, "NO-GO");
  assert.match(untrustedPlan.reason, /not sealed and verified/);

  const mixedCohortResults = passResults.map((result, index) =>
    index === 0 ? { ...result, cohortId: "different-cohort" } : result
  );
  const mixedCohortPlan = buildTenantPlan({
    catalog,
    controlResults: mixedCohortResults,
    tenantName: "Contoso",
    cohortId: "tenant-wide",
    cohortApproved: true,
    evidenceTrusted: true,
    now: new Date("2026-09-07T00:30:00Z")
  });
  assert.equal(mixedCohortPlan.recommendation, "NO-GO");
  assert.equal(mixedCohortPlan.summary.evidenceRequired, 1);

  const supersededPlan = buildTenantPlan({
    catalog,
    controlResults: passResults,
    tenantName: "Contoso",
    cohortId: "tenant-wide",
    cohortApproved: true,
    evidenceTrusted: true,
    evidenceSuperseded: true,
    now: new Date("2026-09-07T00:30:00Z")
  });
  assert.equal(supersededPlan.recommendation, "NO-GO");
  assert.match(supersededPlan.reason, /new full tenant scan/);

  const incompleteCoverage = passResults.map((result, index) =>
    index === 0
      ? { ...result, coverage: { population: 100, evaluated: 0, complete: false } }
      : result
  );
  const incompleteCoveragePlan = buildTenantPlan({
    catalog,
    controlResults: incompleteCoverage,
    tenantName: "Contoso",
    cohortId: "tenant-wide",
    cohortApproved: true,
    evidenceTrusted: true,
    now: new Date("2026-09-07T00:30:00Z")
  });
  assert.equal(incompleteCoveragePlan.recommendation, "NO-GO");
  assert.equal(incompleteCoveragePlan.summary.evidenceRequired, 1);
});

test("downloadable Markdown contains every control, implementation steps, and citations", () => {
  const plan = buildTenantPlan({
    catalog,
    controlResults: [],
    tenantName: "Contoso `fake`\n![remote](https://example.test/tracker)",
    cohortId: "tenant-wide",
    cohortApproved: true
  });
  const markdown = tenantPlanMarkdown(plan);

  assert.match(markdown, /# Microsoft 365 Copilot tenant enablement plan/);
  assert.match(markdown, /\*\*Recommendation:\*\* NO-GO/);
  assert.match(markdown, /\*\*Implementation steps:\*\*/);
  assert.match(markdown, /\*\*Microsoft guidance reference:\*\*/);
  assert.match(markdown, /\*\*Evidence collection and completion:\*\*/);
  assert.match(markdown, /not certification of this AI Flight Deck gate/);
  assert.doesNotMatch(markdown, /Authoritative Microsoft source/);
  assert.doesNotMatch(markdown, /\n!\[remote\]/);
  assert.ok(markdown.includes("Contoso \\`fake\\`"));
  for (const domain of catalog.domains) assert.match(markdown, new RegExp(`## ${domain.name}`));
  for (const control of catalog.domains.flatMap(domain => domain.controls)) {
    assert.ok(markdown.includes(`### ${control.id}: ${control.title}`));
  }
});

test("evidence routes distinguish unconnected inputs, templates, attestations and supported collectors", () => {
  const plan = buildTenantPlan({ catalog });
  const byId = new Map(plan.controls.map(control => [control.controlId, control]));
  for (const id of ["AFD-TEAMS-001", "AFD-SEC-003", "AFD-DEV-006", "AFD-ADOPT-005", "AFD-NET-002"]) {
    assert.equal(byId.get(id).collection.kind, "IntegrationRequired");
    assert.match(byId.get(id).collection.limitation, /rescan alone/);
  }
  assert.equal(byId.get("AFD-IAM-007").collection.kind, "SignedAttestationRequired");
  assert.equal(byId.get("AFD-PPA-001").collection.kind, "PowerPlatformEvidenceRequired");
  assert.match(byId.get("AFD-PPA-001").collection.limitation, /not an automated collector/);
  assert.equal(byId.get("AFD-EXO-001").collection.kind, "AdminEvidenceRequired");
  assert.match(byId.get("AFD-EXO-001").collection.steps.join(" "), /-Workloads "exchangeOnline"/);
  assert.equal(byId.get("AFD-SEC-004").collection.kind, "LiveCollectionRequired");
});

test("affected identifiers survive in playbooks and are escaped in Markdown exports", () => {
  const plan = buildTenantPlan({
    catalog,
    controlResults: [{
      controlId: "AFD-EXO-001",
      status: "Fail",
      affectedResources: ["mailbox-1", "![tracking](https://example.test/image)"],
      affectedPrincipals: ["user-1"]
    }]
  });
  const control = plan.controls.find(item => item.controlId === "AFD-EXO-001");
  assert.deepEqual(control.affectedScope.principals, ["user-1"]);
  const markdown = tenantPlanMarkdown(plan);
  assert.ok(markdown.includes("mailbox\\-1"));
  assert.ok(markdown.includes("\\!\\[tracking\\]"));
  assert.doesNotMatch(markdown, /!\[tracking\]/);
});
