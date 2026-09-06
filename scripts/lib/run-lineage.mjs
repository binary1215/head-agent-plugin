import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { inspectProject, SCHEMA_VERSION } from "./head-core.mjs";
import { readContextCapsule } from "./context-compiler.mjs";
import { buildFreshHeadReview, createResultPacket, createReviewDecision, readLineageArtifact } from "./execution-lineage.mjs";
import { withProjectMutation } from "./project-mutation-lock.mjs";

const fail = (message, code = "RUN_LINEAGE_ERROR") => {
  const error = new Error(message);
  error.code = code;
  throw error;
};

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const now = () => new Date().toISOString();

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
const stateHash = (state) => crypto.createHash("sha256").update(JSON.stringify(canonical(state))).digest("hex");

function operationPointerHash(state) {
  return stateHash(Object.fromEntries([
    "sessionId", "mode", "currentWholePlanId", "activeRunId", "activeExecutionContractId",
    "lastResultPacketId", "pendingReview", "lastReviewDecisionId", "lastReviewedRunId", "requiredPlanAction",
  ].map((key) => [key, state[key] ?? null])));
}

function completedTransitionMatches(run, state, patch) {
  const transition = run.sessionTransition;
  const terminal = transition.kind === "finish" ? run.status === "awaiting_review" : run.status === "reviewed";
  return terminal && operationPointerHash(state) === transition.afterOperationPointerHash
    && Object.entries(patch).every(([key, value]) => JSON.stringify(canonical(state[key])) === JSON.stringify(canonical(value)));
}

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
  if (typeof runId !== "string" || !/^run-[0-9]+-[a-f0-9]{6}$/.test(runId)) fail("Run id is invalid.", "INVALID_RUN_LINEAGE");
  return path.join(root, ".head", "sessions", "runs", runId, "run.json");
}

function stateFile(root) {
  return path.join(root, ".head", "sessions", "current.json");
}

// An explicit operation first binds its validated input to the existing P2 Run.
// This is not a second journal, an approval, or recovery direction. Its hashes
// permit only the missing Session write, never overwriting intervening P2 work.
function prepareTransition({ run, inspected, kind, artifactId, changedAt, patch, file }) {
  const existing = run.sessionTransition;
  if (existing?.kind === kind) {
    if (existing.artifactId !== artifactId || existing.projectId !== inspected.project.projectId
      || existing.sessionId !== inspected.state.sessionId || existing.runId !== run.runId) {
      fail("Run transition retry differs from its recorded input or identity.", "RUN_TRANSITION_CONFLICT");
    }
    const completedReplay = completedTransitionMatches(run, inspected.state, patch);
    const hash = stateHash(inspected.state);
    if (!completedReplay && hash !== existing.beforeSessionHash && hash !== existing.afterSessionHash) {
      fail("Session changed after the recorded Run transition.", "RUN_TRANSITION_SESSION_DRIFT");
    }
    if (!completedReplay && stateHash({ ...inspected.state, ...patch, updatedAt: existing.changedAt }) !== existing.afterSessionHash) {
      fail("Run transition target does not match its exact Session change.", "RUN_TRANSITION_CONFLICT");
    }
    if ((kind === "finish" && run.status === "awaiting_review" && run.completedAt !== existing.changedAt)
      || (kind === "review" && run.status === "reviewed" && run.reviewedAt !== existing.changedAt)) {
      fail("Run transition timestamp does not match Run canon.", "RUN_TRANSITION_CONFLICT");
    }
    return run;
  }
  const transition = {
    kind, artifactId, projectId: inspected.project.projectId,
    sessionId: inspected.state.sessionId, runId: run.runId, changedAt,
    beforeSessionHash: stateHash(inspected.state),
    afterSessionHash: stateHash({ ...inspected.state, ...patch, updatedAt: changedAt }),
    afterOperationPointerHash: operationPointerHash({ ...inspected.state, ...patch }),
  };
  const prepared = { ...run, sessionTransition: transition };
  atomicWrite(file, json(prepared));
  return prepared;
}

function commitSessionTransition({ root, inspected, run, patch }) {
  const transition = run.sessionTransition;
  const currentHash = stateHash(inspected.state);
  // A later explicit checkpoint may change only checkpoint metadata. Once the
  // exact operation is committed, acknowledge it without restoring older P2.
  if (completedTransitionMatches(run, inspected.state, patch)) return inspected.state;
  if (currentHash === transition.afterSessionHash) return inspected.state;
  const state = { ...inspected.state, ...patch, updatedAt: transition.changedAt };
  if (currentHash !== transition.beforeSessionHash || stateHash(state) !== transition.afterSessionHash) {
    fail("Run transition cannot overwrite changed Session state.", "RUN_TRANSITION_SESSION_DRIFT");
  }
  atomicWrite(stateFile(root), json(state));
  return state;
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

export function startRun(options = {}) {
  return withProjectMutation({ root: options.root, scope: "session-recovery" }, () => startRunLocked(options));
}

function startRunLocked({ root = ".", executionContractId } = {}) {
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

export function finishRun(options = {}) {
  return withProjectMutation({ root: options.root, scope: "session-recovery" }, () => finishRunLocked(options));
}

function finishRunLocked({ root = ".", outcome, evidence, planDelta = "", impactRadius = [], verification, unknowns = [], knowledgeProposals = [] } = {}) {
  const inspected = readyProject(root, "a Run finishes");
  const runId = inspected.state.activeRunId || inspected.state.pendingReview?.runId;
  if (!runId) fail("No active Run exists.", "NO_ACTIVE_RUN");
  const projectRoot = inspected.project.projectRoot;
  const file = runFile(projectRoot, runId);
  let run = readJson(file, "Run canon");
  if (run.runId !== runId || !["active", "awaiting_review"].includes(run.status) || !run.executionContractId) fail("Active Run canon is not bound to an Execution Contract.", "INVALID_RUN_LINEAGE");
  if (run.sessionTransition?.kind === "review") fail("This Run already has an exact review transition; finish cannot replace it.", "RUN_TRANSITION_CONFLICT");
  if (inspected.state.currentWholePlanId !== run.wholePlanId
    || inspected.state.activeRunId && inspected.state.activeExecutionContractId !== run.executionContractId
    || !inspected.state.activeRunId && (inspected.state.pendingReview?.resultPacketId !== run.resultPacketId || run.status !== "awaiting_review")) {
    fail("Session does not point to this Run transition.", "RUN_LINEAGE_CONFLICT");
  }
  const contract = requireArtifact(projectRoot, run.executionContractId, "ExecutionContract");
  if (contract.wholePlanId !== run.wholePlanId || contract.capsuleId !== run.capsuleId) {
    fail("Run canon does not match its Execution Contract.", "RUN_LINEAGE_CONFLICT");
  }
  const input = {
    root: projectRoot,
    executionContractId: run.executionContractId,
    outcome,
    evidence,
    planDelta,
    impactRadius,
    verification,
    unknowns,
    knowledgeProposals,
    persist: false,
  };
  const preview = createResultPacket(input).artifact;
  if (run.resultPacketId && run.resultPacketId !== preview.resultPacketId) fail("Run result retry differs from the recorded ResultPacket.", "RUN_TRANSITION_CONFLICT");
  const pendingReview = {
    runId,
    wholePlanId: run.wholePlanId,
    resultPacketId: preview.resultPacketId,
  };
  const patch = {
    mode: "review",
    activeRunId: null,
    activeExecutionContractId: null,
    lastResultPacketId: preview.resultPacketId,
    pendingReview,
  };
  run = prepareTransition({ run, inspected, kind: "finish", artifactId: preview.resultPacketId, changedAt: run.completedAt || now(), patch, file });
  const resultPacket = run.status === "awaiting_review"
    ? requireArtifact(projectRoot, preview.resultPacketId, "ResultPacket")
    : createResultPacket({ ...input, persist: true }).artifact;
  const completedRun = { ...run, status: "awaiting_review", resultPacketId: resultPacket.resultPacketId, completedAt: run.sessionTransition.changedAt };
  if (run.status !== "awaiting_review") atomicWrite(file, json(completedRun));
  const state = commitSessionTransition({ root: projectRoot, inspected, run: completedRun, patch });
  return { status: "run_awaiting_review", run: completedRun, resultPacket, state };
}

export function reviewRun(options = {}) {
  return withProjectMutation({ root: options.root, scope: "session-recovery" }, () => reviewRunLocked(options));
}

function reviewRunLocked({ root = ".", reviewContextId, disposition, rationale, nextActions = [], knowledgeProposalRecommendations = [] } = {}) {
  if (typeof reviewContextId !== "string" || !reviewContextId.trim()) {
    fail("The current Fresh HEAD review context id is required.", "FRESH_HEAD_REVIEW_REQUIRED");
  }
  const inspected = readyProject(root, "a Run is reviewed");
  if (inspected.state.activeRunId) fail("The active Run must finish before review.", "RUN_STILL_ACTIVE");
  const projectRoot = inspected.project.projectRoot;
  const runId = inspected.state.pendingReview?.runId || inspected.state.lastReviewedRunId;
  if (!runId) fail("No Result Packet is awaiting review.", "NO_PENDING_REVIEW");
  const file = runFile(projectRoot, runId);
  let run = readJson(file, "Run canon");
  const pending = inspected.state.pendingReview || { runId, wholePlanId: run.wholePlanId, resultPacketId: run.resultPacketId };
  if (run.runId !== runId || !["awaiting_review", "reviewed"].includes(run.status)
    || run.resultPacketId !== pending.resultPacketId || run.wholePlanId !== pending.wholePlanId
    || inspected.state.currentWholePlanId !== run.wholePlanId
    || !inspected.state.pendingReview && (run.status !== "reviewed" || inspected.state.lastReviewDecisionId !== run.reviewDecisionId)) {
    fail("Pending review state does not match Run canon.", "RUN_REVIEW_CONFLICT");
  }
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
  const input = {
    root: projectRoot,
    wholePlanId: pending.wholePlanId,
    resultPacketId: pending.resultPacketId,
    reviewContext: currentReview,
    disposition,
    rationale,
    nextActions,
    knowledgeProposalRecommendations,
    persist: false,
  };
  const preview = createReviewDecision(input).artifact;
  if (run.reviewDecisionId && run.reviewDecisionId !== preview.reviewDecisionId) fail("Run review retry differs from the recorded ReviewDecision.", "RUN_TRANSITION_CONFLICT");
  if (run.status === "reviewed" && run.reviewDisposition !== preview.disposition) fail("Run disposition differs from its exact ReviewDecision.", "RUN_TRANSITION_CONFLICT");
  const requiredPlanAction = preview.disposition === "accept"
    ? null
    : new Set(["revise", "expand"]).has(preview.disposition)
      ? {
          kind: "next-whole-plan",
          disposition: preview.disposition,
          wholePlanId: pending.wholePlanId,
          reviewDecisionId: preview.reviewDecisionId,
        }
      : {
          kind: "user-direction",
          disposition: preview.disposition,
          wholePlanId: pending.wholePlanId,
          reviewDecisionId: preview.reviewDecisionId,
        };
  const patch = {
    mode: "session",
    pendingReview: null,
    lastReviewDecisionId: preview.reviewDecisionId,
    lastReviewedRunId: runId,
    requiredPlanAction,
  };
  run = prepareTransition({ run, inspected, kind: "review", artifactId: preview.reviewDecisionId, changedAt: run.reviewedAt || now(), patch, file });
  const reviewDecision = run.status === "reviewed"
    ? requireArtifact(projectRoot, preview.reviewDecisionId, "ReviewDecision")
    : createReviewDecision({ ...input, persist: true }).artifact;
  const reviewedRun = { ...run, status: "reviewed", reviewDecisionId: reviewDecision.reviewDecisionId, reviewDisposition: reviewDecision.disposition, reviewedAt: run.sessionTransition.changedAt };
  if (run.status !== "reviewed") atomicWrite(file, json(reviewedRun));
  const state = commitSessionTransition({ root: projectRoot, inspected, run: reviewedRun, patch });
  return { status: "run_reviewed", run: reviewedRun, reviewDecision, state };
}
