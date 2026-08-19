#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dispatch } from "./mcp-server.mjs";

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "head-agent-conversation-"));
const projectRoot = path.join(temporaryRoot, "sample-project");

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
  ]) assert(names.has(name), `Missing conversational MCP tool: ${name}`);

  const before = await tool("head_onboarding_guide", { project_root: projectRoot });
  assert.equal(before.status, "not_initialized");
  assert.equal(before.nextAction, "initialize_or_resume");

  const initialized = await tool("head_project_initialize_or_resume", {
    project_root: projectRoot,
    runtimes: ["codex", "opencode"],
    mode: "existing",
    source_scope: { include_roots: [], exclude_roots: [] },
    storage: { mode: "local" },
  });
  assert.equal(initialized.status, "awaiting_onboarding_review");
  assert.equal(initialized.onboarding.candidateCount > 0, true);

  const reviewGuide = await tool("head_onboarding_guide", { project_root: projectRoot, candidate_limit: 200 });
  assert.equal(reviewGuide.status, "awaiting_review");
  assert.equal(reviewGuide.nextAction, "review_candidates");
  assert.equal(reviewGuide.review.truncated, false);
  assert.equal(reviewGuide.review.candidates.every((candidate) => candidate.authority === "candidate-only-until-explicit-review"), true);

  const reviewed = await tool("head_onboarding_review", {
    project_root: projectRoot,
    candidate_set_id: reviewGuide.review.candidateSetId,
    disposition: "accept-all",
    rationale: "Fixture reviewer inspected every bounded evidence-linked candidate.",
  });
  assert.equal(reviewed.status, "onboarding_ready");
  assert.equal(reviewed.authorityEffect, "explicit-product-canon-transition");

  const documents = await tool("head_markdown_projection_build", { project_root: projectRoot });
  assert.equal(documents.status, "projected");
  assert.equal(documents.authority, "rebuildable-derived-human-view-not-project-canon");

  const context = await tool("head_context_preview", {
    project_root: projectRoot,
    task: "Locate camera capture and calibration evidence",
    budget: 2000,
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

  const resumed = await tool("head_project_initialize_or_resume", {
    project_root: projectRoot,
    runtimes: ["codex", "opencode"],
  });
  assert.equal(resumed.project.projectId, initialized.project.projectId);
  assert.equal(resumed.project.sessionId, initialized.project.sessionId);
  assert.equal(resumed.onboardingAction, "already-ready");

  process.stdout.write(`${JSON.stringify({
    status: "conversational_onboarding_verified",
    projectIdentityPreserved: true,
    sessionIdentityPreserved: true,
    explicitReviewRequired: true,
    worldGraphContextDocumentsReady: true,
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
