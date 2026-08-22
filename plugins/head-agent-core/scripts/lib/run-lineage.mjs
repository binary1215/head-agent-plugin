import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { inspectProject, SCHEMA_VERSION } from "./head-core.mjs";
import { readContextCapsule } from "./context-compiler.mjs";
import { buildFreshHeadReview, createResultPacket, createReviewDecision, readLineageArtifact } from "./execution-lineage.mjs";

const fail = (message, code = "RUN_LINEAGE_ERROR") => {
  const error = new Error(message);
  error.code = code;
  throw error;
};

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const now = () => new Date().toISOString();

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, content, { encoding: "utf8", flag: "wx" });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function readJson(file, label) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { fail(`${label} is invalid JSON: ${error.message}`, "INVALID_RUN_CANON"); }
}

function readyProject(root, action) {
  const inspected = inspectProject(root);
  if (inspected.status !== "ready") {
    fail(`Project must be ready before ${action}; current status: ${inspected.status}.`, "PROJECT_NOT_READY");
  }
  return inspected;
}

function requireArtifact(root, artifactId, kind) {
  const result = readLineageArtifact({ root, artifactId });
  if (result.artifact.kind !== kind) fail(`Expected ${kind}: ${artifactId}`, "RUN_LINEAGE_KIND_MISMATCH");
  return result.artifact;
}

function runFile(root, runId) {
  return path.join(root, ".head", "sessions", "runs", runId, "run.json");
}

function stateFile(root) {
  return path.join(root, ".head", "sessions", "current.json");
}

function pendingReviewBundle(root) {
  const inspected = readyProject(root, "pending review is read");
  if (inspected.state.activeRunId) fail("The active Run must finish before review.", "RUN_STILL_ACTIVE");
  const pending = inspected.state.pendingReview;
  if (!pending?.runId || !pending?.wholePlanId || !pending?.resultPacketId) {
    fail("No Result Packet is awaiting review.", "NO_PENDING_REVIEW");
  }
  const projectRoot = inspected.project.projectRoot;
  const file = runFile(projectRoot, pending.runId);
  const run = readJson(file, "Run canon");
  if (run.status !== "awaiting_review" || run.resultPacketId !== pending.resultPacketId || run.wholePlanId !== pending.wholePlanId) {
    fail("Pending review state does not match Run canon.", "RUN_REVIEW_CONFLICT");
  }
  return { inspected, pending, projectRoot, file, run };
}

export function getPendingReviewContext({ root = "." } = {}) {
  const bundle = pendingReviewBundle(root);
  const built = buildFreshHeadReview({
    root: bundle.projectRoot,
    wholePlanId: bundle.pending.wholePlanId,
    resultPacketId: bundle.pending.resultPacketId,
    sessionId: bundle.inspected.state.sessionId,
    runId: bundle.pending.runId,
  });
  return { ...built, pendingReview: bundle.pending };
}

export function startRun({ root = ".", executionContractId } = {}) {
  if (typeof executionContractId !== "string" || !executionContractId.trim()) {
    fail("A verified Execution Contract is required to start a Run.", "EXECUTION_CONTRACT_REQUIRED");
  }
  const inspected = readyProject(root, "a Run starts");
  if (inspected.state.activeRunId) fail(`Run already active: ${inspected.state.activeRunId}`, "RUN_ALREADY_ACTIVE");
  if (inspected.state.pendingReview) fail("The previous Result Packet requires a ReviewDecision before another Run starts.", "RUN_REVIEW_REQUIRED");
  const projectRoot = inspected.project.projectRoot;
  const contract = requireArtifact(projectRoot, executionContractId.trim(), "ExecutionContract");
  const plan = requireArtifact(projectRoot, contract.wholePlanId, "WholePlanSnapshot");
  readContextCapsule({ root: projectRoot, capsuleId: contract.capsuleId });
  const requiredPlanAction = inspected.state.requiredPlanAction;
  if (requiredPlanAction?.kind === "user-direction") {
    fail(`Review disposition ${requiredPlanAction.disposition} requires an explicit user-owned direction before another Run.`, "USER_DIRECTION_REQUIRED");
  }
  if (requiredPlanAction?.kind === "next-whole-plan") {
    const respondsToReview = (plan.lineage || []).some((link) => (
      link.relation === "responds-to" && link.targetId === requiredPlanAction.reviewDecisionId
    ));
    if (!respondsToReview || plan.previousWholePlanId !== requiredPlanAction.wholePlanId) {
      fail("The next Run requires a new WholePlanSnapshot created from the pending ReviewDecision.", "NEXT_WHOLE_PLAN_REQUIRED");
    }
  }

  const runId = `run-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const run = {
    schemaVersion: SCHEMA_VERSION,
    runId,
    status: "active",
    goal: contract.scope,
    wholePlanId: contract.wholePlanId,
    capsuleId: contract.capsuleId,
    executionContractId: contract.executionContractId,
    startedAt: now(),
  };
  atomicWrite(runFile(projectRoot, runId), json(run));
  const state = {
    ...inspected.state,
    mode: "run",
    currentWholePlanId: contract.wholePlanId,
    activeRunId: runId,
    activeExecutionContractId: contract.executionContractId,
    requiredPlanAction: null,
    updatedAt: now(),
  };
  atomicWrite(stateFile(projectRoot), json(state));
  return { status: "run_started", run, state };
}

export function finishRun({ root = ".", outcome, evidence, planDelta = "", impactRadius = [], verification, unknowns = [], knowledgeProposals = [] } = {}) {
  const inspected = readyProject(root, "a Run finishes");
  const runId = inspected.state.activeRunId;
  if (!runId) fail("No active Run exists.", "NO_ACTIVE_RUN");
  const projectRoot = inspected.project.projectRoot;
  const file = runFile(projectRoot, runId);
  const run = readJson(file, "Run canon");
  if (run.status !== "active" || !run.executionContractId) fail("Active Run canon is not bound to an Execution Contract.", "INVALID_RUN_LINEAGE");
  const contract = requireArtifact(projectRoot, run.executionContractId, "ExecutionContract");
  if (contract.wholePlanId !== run.wholePlanId || contract.capsuleId !== run.capsuleId) {
    fail("Run canon does not match its Execution Contract.", "RUN_LINEAGE_CONFLICT");
  }
  const result = createResultPacket({
    root: projectRoot,
    executionContractId: run.executionContractId,
    outcome,
    evidence,
    planDelta,
    impactRadius,
    verification,
    unknowns,
    knowledgeProposals,
    persist: true,
  });
  const completedAt = now();
  const completedRun = { ...run, status: "awaiting_review", resultPacketId: result.artifact.resultPacketId, completedAt };
  atomicWrite(file, json(completedRun));
  const pendingReview = {
    runId,
    wholePlanId: run.wholePlanId,
    resultPacketId: result.artifact.resultPacketId,
  };
  const state = {
    ...inspected.state,
    mode: "review",
    activeRunId: null,
    activeExecutionContractId: null,
    lastResultPacketId: result.artifact.resultPacketId,
    pendingReview,
    updatedAt: completedAt,
  };
  atomicWrite(stateFile(projectRoot), json(state));
  return { status: "run_awaiting_review", run: completedRun, resultPacket: result.artifact, state };
}

export function reviewRun({ root = ".", reviewContextId, disposition, rationale, nextActions = [], knowledgeProposalRecommendations = [] } = {}) {
  if (typeof reviewContextId !== "string" || !reviewContextId.trim()) {
    fail("The current Fresh HEAD review context id is required.", "FRESH_HEAD_REVIEW_REQUIRED");
  }
  const bundle = pendingReviewBundle(root);
  const inspected = bundle.inspected;
  const pending = bundle.pending;
  const projectRoot = bundle.projectRoot;
  const file = bundle.file;
  const run = bundle.run;
  const currentReview = buildFreshHeadReview({
    root: projectRoot,
    wholePlanId: pending.wholePlanId,
    resultPacketId: pending.resultPacketId,
    sessionId: inspected.state.sessionId,
    runId: pending.runId,
  }).review;
  if (currentReview.reviewContextId !== reviewContextId.trim()) {
    fail("ReviewDecision was prepared from a stale or different Fresh HEAD review context.", "STALE_FRESH_HEAD_REVIEW");
  }
  const review = createReviewDecision({
    root: projectRoot,
    wholePlanId: pending.wholePlanId,
    resultPacketId: pending.resultPacketId,
    reviewContext: currentReview,
    disposition,
    rationale,
    nextActions,
    knowledgeProposalRecommendations,
    persist: true,
  });
  const reviewedAt = now();
  const reviewedRun = {
    ...run,
    status: "reviewed",
    reviewDecisionId: review.artifact.reviewDecisionId,
    reviewDisposition: review.artifact.disposition,
    reviewedAt,
  };
  atomicWrite(file, json(reviewedRun));
  const requiredPlanAction = review.artifact.disposition === "accept"
    ? null
    : new Set(["revise", "expand"]).has(review.artifact.disposition)
      ? {
          kind: "next-whole-plan",
          disposition: review.artifact.disposition,
          wholePlanId: pending.wholePlanId,
          reviewDecisionId: review.artifact.reviewDecisionId,
        }
      : {
          kind: "user-direction",
          disposition: review.artifact.disposition,
          wholePlanId: pending.wholePlanId,
          reviewDecisionId: review.artifact.reviewDecisionId,
        };
  const state = {
    ...inspected.state,
    mode: "session",
    pendingReview: null,
    lastReviewDecisionId: review.artifact.reviewDecisionId,
    requiredPlanAction,
    updatedAt: reviewedAt,
  };
  atomicWrite(stateFile(projectRoot), json(state));
  return { status: "run_reviewed", run: reviewedRun, reviewDecision: review.artifact, state };
}
