#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dispatch } from "./mcp-server.mjs";

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "head-agent-conversation-"));
const projectRoot = path.join(temporaryRoot, "sample-project");
const graphProjectRoot = path.join(temporaryRoot, "graph-project");
const coreProjectRoot = path.join(temporaryRoot, "core-project");

async function tool(name, args) {
  const response = await dispatch({
    jsonrpc: "2.0",
    id: `${name}-${Date.now()}`,
    method: "tools/call",
    params: { name, arguments: args },
  });
  if (response.error) throw new Error(`${name}: ${response.error.message}`);
  return response.result.structuredContent;
}

try {
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "camera.mjs"), [
    "export function captureImage() { return 'frame'; }",
    "export function calibrateSensor() { return 'calibrated'; }",
    "export function publishPreview() { return captureImage(); }",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(projectRoot, "README.md"), "# Camera acquisition\n\nCapture and calibrate camera images.\n");

  const listed = await dispatch({ jsonrpc: "2.0", id: "tools", method: "tools/list", params: {} });
  const names = new Set(listed.result.tools.map((entry) => entry.name));
  for (const name of [
    "head_onboarding_guide",
    "head_project_initialize_or_resume",
    "head_onboarding_review",
    "head_markdown_projection_build",
    "head_graphdb_connection_preflight",
    "head_graphdb_database_initialize",
    "head_graphdb_projection_activate",
  ]) assert(names.has(name), `Missing conversational MCP tool: ${name}`);
  const graphDbActivateTool = listed.result.tools.find((entry) => entry.name === "head_graphdb_projection_activate");
  assert.deepEqual(graphDbActivateTool.inputSchema.required, ["project_root", "confirm_remote_write"]);
  assert.equal(graphDbActivateTool.inputSchema.additionalProperties, false);
  assert.equal(Object.keys(graphDbActivateTool.inputSchema.properties).some((key) => /password|username|credential|token/i.test(key)), false);

  fs.mkdirSync(coreProjectRoot, { recursive: true });
  fs.writeFileSync(path.join(coreProjectRoot, "core.mjs"), "export const coordinated = true;\n");
  const coreInitialized = await tool("head_project_initialize_or_resume", {
    project_root: coreProjectRoot,
    runtimes: ["codex"],
  });
  assert.equal(coreInitialized.status, "core_ready");
  assert.equal(coreInitialized.profile, "core");
  assert.equal(coreInitialized.productGovernanceActivated, false);
  assert.equal(coreInitialized.onboardingAction, "not-activated");
  assert.equal(coreInitialized.onboarding.candidateSetId, null);
  assert.equal(coreInitialized.nextAction.id, "work_directly");
  assert.equal(coreInitialized.capabilities.find((item) => item.id === "product-governance").availability, "available-not-activated");
  const coreStatus = await tool("head_project_status", { project_root: coreProjectRoot });
  assert.equal(coreStatus.status, "core_ready");
  assert.equal(coreStatus.readiness.product.state, "not_activated");
  assert.equal(coreStatus.authority.mutatesProject, false);
  assert.equal(coreStatus.authority.activatesCapabilities, false);

  fs.mkdirSync(graphProjectRoot, { recursive: true });
  fs.writeFileSync(path.join(graphProjectRoot, "service.mjs"), "export function serve() { return true; }\n");
  await tool("head_project_initialize_or_resume", {
    project_root: graphProjectRoot,
    profile: "product",
    runtimes: ["codex"],
    mode: "existing",
    source_scope: { include_roots: [], exclude_roots: [] },
    storage: {
      mode: "graphdb",
      endpoint: "https://fixture-target.invalid",
      database: "fixture-target-database",
      username_secret_reference: "HEAD_FIXTURE_GRAPHDB_USERNAME_MISSING",
      password_secret_reference: "HEAD_FIXTURE_GRAPHDB_PASSWORD_MISSING",
    },
  });
  const graphDbPreflight = await tool("head_graphdb_connection_preflight", { project_root: graphProjectRoot });
  assert.equal(graphDbPreflight.status, "credential-references-unavailable");
  assert.equal(graphDbPreflight.allReferencesPresent, false);
  assert.equal(graphDbPreflight.hostRestartMayBeRequired, true);
  assert.equal(graphDbPreflight.references.username.name, "HEAD_FIXTURE_GRAPHDB_USERNAME_MISSING");
  assert.equal(graphDbPreflight.references.username.present, false);
  assert.equal(graphDbPreflight.references.password.present, false);
  assert.equal(graphDbPreflight.credentialValuesReturned, false);
  assert.equal(graphDbPreflight.targetValuesReturned, false);
  assert.equal(graphDbPreflight.networkRequestPerformed, false);
  assert.equal(JSON.stringify(graphDbPreflight).includes("fixture-target.invalid"), false);
  assert.equal(JSON.stringify(graphDbPreflight).includes("fixture-target-database"), false);
  const fixtureUsernameReference = "HEAD_FIXTURE_GRAPHDB_USERNAME_MISSING";
  const fixturePasswordReference = "HEAD_FIXTURE_GRAPHDB_PASSWORD_MISSING";
  const previousFixtureUsername = process.env[fixtureUsernameReference];
  const previousFixturePassword = process.env[fixturePasswordReference];
  try {
    process.env[fixtureUsernameReference] = "fixture-username-value-not-a-secret";
    process.env[fixturePasswordReference] = "fixture-password-value-not-a-secret";
    const availablePreflight = await tool("head_graphdb_connection_preflight", { project_root: graphProjectRoot });
    assert.equal(availablePreflight.status, "credential-references-available");
    assert.equal(availablePreflight.allReferencesPresent, true);
    assert.equal(availablePreflight.hostRestartMayBeRequired, false);
    assert.equal(availablePreflight.references.username.present, true);
    assert.equal(availablePreflight.references.password.present, true);
    assert.equal(availablePreflight.networkRequestPerformed, false);
    assert.equal(JSON.stringify(availablePreflight).includes("fixture-username-value-not-a-secret"), false);
    assert.equal(JSON.stringify(availablePreflight).includes("fixture-password-value-not-a-secret"), false);
  } finally {
    if (previousFixtureUsername == null) delete process.env[fixtureUsernameReference];
    else process.env[fixtureUsernameReference] = previousFixtureUsername;
    if (previousFixturePassword == null) delete process.env[fixturePasswordReference];
    else process.env[fixturePasswordReference] = previousFixturePassword;
  }

  const before = await tool("head_onboarding_guide", { project_root: projectRoot });
  assert.equal(before.status, "not_initialized");
  assert.equal(before.nextAction, "initialize_or_resume");

  const initialized = await tool("head_project_initialize_or_resume", {
    project_root: projectRoot,
    profile: "product",
    runtimes: ["claude", "codex", "opencode"],
    mode: "existing",
    source_scope: { include_roots: [], exclude_roots: [] },
    storage: { mode: "local" },
  });
  assert.equal(initialized.status, "product_review_required");
  assert.equal(initialized.nextAction.id, "review_product_candidates");
  assert.equal(initialized.onboarding.candidateCount > 0, true);

  const reviewGuide = await tool("head_onboarding_guide", { project_root: projectRoot, candidate_limit: 200 });
  assert.equal(reviewGuide.status, "awaiting_review");
  assert.equal(reviewGuide.nextAction, "review_candidates");
  assert.equal(reviewGuide.review.truncated, false);
  assert.equal(reviewGuide.review.candidates.every((candidate) => candidate.authority === "candidate-only-until-explicit-review"), true);

  const revised = await tool("head_onboarding_review", {
    project_root: projectRoot,
    candidate_set_id: reviewGuide.review.candidateSetId,
    disposition: "revise",
    added_entities: [{
      kind: "Capability",
      entity: {
        key: "capability:reviewed-continuity",
        name: "Reviewed continuity",
        description: "Preserve explicit successor review lineage.",
      },
    }],
    rationale: "Add one user-authored concept through the required two-review path.",
  });
  assert.equal(revised.status, "onboarding_revision_awaiting_review");
  assert.equal(revised.state.latestReviewDecisionId, revised.reviewDecision.reviewDecisionId);

  const successorGuide = await tool("head_onboarding_guide", { project_root: projectRoot, candidate_limit: 200 });
  assert.equal(successorGuide.status, "awaiting_review");
  assert.notEqual(successorGuide.review.candidateSetId, reviewGuide.review.candidateSetId);

  const reviewed = await tool("head_onboarding_review", {
    project_root: projectRoot,
    candidate_set_id: successorGuide.review.candidateSetId,
    disposition: "accept-all",
    rationale: "Fixture reviewer inspected every candidate in the immutable successor batch.",
  });
  assert.equal(reviewed.status, "onboarding_ready");
  assert.equal(reviewed.authorityEffect, "explicit-product-canon-transition");
  assert.notEqual(reviewed.state.latestReviewDecisionId, revised.reviewDecision.reviewDecisionId);

  const documents = await tool("head_markdown_projection_build", { project_root: projectRoot });
  assert.equal(documents.status, "projected");
  assert.equal(documents.authority, "rebuildable-derived-human-view-not-project-canon");

  const context = await tool("head_context_preview", {
    project_root: projectRoot,
    task: "Locate camera capture and calibration evidence",
    budget: 32_768,
  });
  assert.equal(context.status, "preview");
  assert.match(context.capsule.capsuleId, /^capsule-[a-f0-9]{24}$/);
  assert.equal(context.capsule.trustBoundary.temporalProvenance, "rebuildable-derived-evidence-not-project-canon");

  const ready = await tool("head_onboarding_guide", { project_root: projectRoot });
  assert.equal(ready.status, "ready");
  assert.equal(ready.nextAction, "ready");
  assert.equal(ready.readiness.world, "current");
  assert.equal(ready.readiness.graph, "current");
  assert.equal(ready.readiness.documents, "current");
  assert.equal(ready.readiness.documentProjectionId, documents.documentProjectionId);

  const resumed = await tool("head_project_initialize_or_resume", {
    project_root: projectRoot,
    profile: "product",
    runtimes: ["claude", "codex", "opencode"],
  });
  assert.equal(resumed.project.projectId, initialized.project.projectId);
  assert.equal(resumed.project.sessionId, initialized.project.sessionId);
  assert.equal(resumed.onboardingAction, "already-ready");

  process.stdout.write(`${JSON.stringify({
    status: "conversational_onboarding_verified",
    constitutionalCoreDefaultVerified: true,
    projectIdentityPreserved: true,
    sessionIdentityPreserved: true,
    explicitReviewRequired: true,
    worldGraphContextDocumentsReady: true,
    optionalGraphDbConversationOperationsDiscoverable: true,
    graphDbCredentialPreflightNetworkRequests: 0,
    graphDbTargetValuesReturnedByPreflight: false,
    graphDbCredentialValuesAcceptedByTools: false,
    graphDbRequired: false,
    gitRequired: false,
    credentialValuesPersisted: false,
  }, null, 2)}\n`);
} finally {
  const resolvedTemporaryRoot = path.resolve(temporaryRoot);
  if (resolvedTemporaryRoot.startsWith(path.resolve(os.tmpdir()) + path.sep)
    && path.basename(resolvedTemporaryRoot).startsWith("head-agent-conversation-")) {
    fs.rmSync(resolvedTemporaryRoot, { recursive: true, force: true });
  }
}
