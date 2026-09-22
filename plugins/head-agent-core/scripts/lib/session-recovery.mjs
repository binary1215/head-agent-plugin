import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { inspectProject, SCHEMA_VERSION } from "./head-core.mjs";
import { readContextCapsule } from "./context-compiler.mjs";
import { buildFreshHeadReview, readLineageArtifact } from "./execution-lineage.mjs";
import { COMPACTION_RECOVERY_VERSION, createRecoveryCheckpoint, readRecoveryCheckpoint } from "./compaction-recovery.mjs";
import { artifactAuthorityBoundary, verifyArtifactAuthorityBoundary } from "./authority-plane-contract.mjs";

export const SESSION_RECOVERY_VERSION = "0.1.0";

const fail = (message, code = "SESSION_RECOVERY_ERROR") => {
  const error = new Error(message);
  error.code = code;
  throw error;
};

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const now = () => new Date().toISOString();

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

const canonicalJson = (value) => JSON.stringify(canonical(value));
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) fail(`${label} is required.`, "INVALID_SESSION_RECOVERY_INPUT");
  return value.trim();
}

function stringList(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    fail(`${label} must be an array of non-empty strings.`, "INVALID_SESSION_RECOVERY_INPUT");
  }
  return [...new Set(value.map((item) => item.trim()))].sort();
}

function readyProject(root, action) {
  const inspected = inspectProject(root);
  if (inspected.status !== "ready") fail(`Project must be ready before ${action}; current status: ${inspected.status}.`, "PROJECT_NOT_READY");
  if (typeof inspected.state?.sessionId !== "string" || !inspected.state.sessionId) {
    fail("Session canon is missing its canonical identity.", "INVALID_SESSION_CANON");
  }
  return inspected;
}

function sessionPointer(state) {
  return {
    mode: state.mode,
    currentWholePlanId: state.currentWholePlanId || null,
    activeRunId: state.activeRunId || null,
    activeExecutionContractId: state.activeExecutionContractId || null,
    lastResultPacketId: state.lastResultPacketId || null,
    pendingReview: state.pendingReview == null ? null : canonical(state.pendingReview),
    lastReviewDecisionId: state.lastReviewDecisionId || null,
    requiredPlanAction: state.requiredPlanAction == null ? null : canonical(state.requiredPlanAction),
  };
}

function readJson(file, label) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { fail(`${label} is invalid JSON: ${error.message}`, "INVALID_SESSION_RECOVERY_ARTIFACT"); }
}

function runFile(root, runId) {
  if (typeof runId !== "string" || !/^run-[0-9]+-[a-f0-9]{6}$/.test(runId)) {
    fail("Run id is invalid.", "INVALID_SESSION_RUN_ID");
  }
  return path.join(root, ".head", "sessions", "runs", runId, "run.json");
}

function readRun(root, runId) {
  const file = runFile(root, runId);
  if (!fs.existsSync(file)) fail(`Run canon not found: ${runId}`, "SESSION_RUN_NOT_FOUND");
  const run = readJson(file, "Run canon");
  if (run.runId !== runId) fail("Run canon identity is invalid.", "SESSION_RUN_IDENTITY_MISMATCH");
  return run;
}

function verifiedArtifact(root, artifactId, kind) {
  const artifact = readLineageArtifact({ root, artifactId }).artifact;
  if (artifact.kind !== kind) fail(`Expected ${kind}: ${artifactId}`, "SESSION_RECOVERY_LINEAGE_KIND_MISMATCH");
  return artifact;
}

function verifiedActiveRun(root, pointer, checkpointRunPointer) {
  const run = readRun(root, pointer.activeRunId);
  if (run.status !== "active" || run.executionContractId !== pointer.activeExecutionContractId
    || run.wholePlanId !== pointer.currentWholePlanId) {
    fail("Active Run canon does not match the Session pointer.", "SESSION_RESTORE_ACTIVE_RUN_CONFLICT");
  }
  const contract = verifiedArtifact(root, run.executionContractId, "ExecutionContract");
  const plan = verifiedArtifact(root, run.wholePlanId, "WholePlanSnapshot");
  const capsule = readContextCapsule({ root, capsuleId: run.capsuleId }).capsule;
  const expected = {
    runId: run.runId,
    wholePlanId: plan.wholePlanId,
    executionContractId: contract.executionContractId,
    contextCapsuleDigest: capsule.capsuleHash,
    currentResultPacketId: pointer.lastResultPacketId,
  };
  if (canonicalJson(expected) !== canonicalJson(checkpointRunPointer)) {
    fail("Active Run lineage does not match the recovery checkpoint.", "SESSION_RESTORE_ACTIVE_RUN_CHECKPOINT_CONFLICT");
  }
  return expected;
}

function optionalResultEvidence(root, resultPacketId) {
  if (!resultPacketId) return { status: "not-applicable", resultPacketId: null };
  try {
    const result = verifiedArtifact(root, resultPacketId, "ResultPacket");
    return { status: "verified", resultPacketId: result.resultPacketId, artifactHash: result.artifactHash };
  } catch (error) {
    if (error.code !== "LINEAGE_ARTIFACT_NOT_FOUND") throw error;
    return { status: "missing-evidence", resultPacketId, artifactHash: null };
  }
}

function verifiedPendingReview(root, pointer) {
  const pending = pointer.pendingReview;
  if (!pending || typeof pending !== "object" || !pending.runId || !pending.wholePlanId || !pending.resultPacketId) {
    fail("Pending review Session pointer is incomplete.", "SESSION_RESTORE_PENDING_REVIEW_CONFLICT");
  }
  const run = readRun(root, pending.runId);
  if (run.status !== "awaiting_review" || run.wholePlanId !== pending.wholePlanId || run.resultPacketId !== pending.resultPacketId) {
    fail("Pending review does not match Run canon.", "SESSION_RESTORE_PENDING_REVIEW_CONFLICT");
  }
  verifiedArtifact(root, pending.wholePlanId, "WholePlanSnapshot");
  const evidence = optionalResultEvidence(root, pending.resultPacketId);
  let freshHeadReviewContextId = null;
  if (evidence.status === "verified") {
    freshHeadReviewContextId = buildFreshHeadReview({
      root,
      wholePlanId: pending.wholePlanId,
      resultPacketId: pending.resultPacketId,
      sessionId: pointer.sessionId,
      runId: pending.runId,
    }).review.reviewContextId;
  }
  return { ...pending, resultEvidence: evidence, freshHeadReviewContextId };
}

function verifyLastReview(root, pointer) {
  if (!pointer.lastReviewDecisionId) return null;
  const review = verifiedArtifact(root, pointer.lastReviewDecisionId, "ReviewDecision");
  if (pointer.requiredPlanAction && pointer.requiredPlanAction.reviewDecisionId !== review.reviewDecisionId) {
    fail("Required plan action does not match the last ReviewDecision.", "SESSION_RESTORE_REQUIRED_PLAN_ACTION_CONFLICT");
  }
  return {
    reviewDecisionId: review.reviewDecisionId,
    artifactHash: review.artifactHash,
    disposition: review.disposition,
    wholePlanId: review.wholePlanId,
    resultPacketId: review.resultPacketId,
  };
}

function verifyReviewedRunIntegration(root, checkpoint) {
  const integration = checkpoint.reviewedRunIntegration;
  if (integration == null) return null;
  const run = readRun(root, integration.runId);
  const review = verifiedArtifact(root, integration.reviewDecisionId, "ReviewDecision");
  const plan = verifiedArtifact(root, integration.wholePlanId, "WholePlanSnapshot");
  const contract = verifiedArtifact(root, integration.executionContractId, "ExecutionContract");
  const capsule = readContextCapsule({ root, capsuleId: contract.capsuleId }).capsule;
  const expected = {
    runId: run.runId,
    wholePlanId: plan.wholePlanId,
    executionContractId: contract.executionContractId,
    contextCapsuleDigest: capsule.capsuleHash,
    resultPacketId: integration.resultPacketId,
    reviewDecisionId: review.reviewDecisionId,
    reviewContextId: review.reviewContextId,
    integrationRequestId: integration.integrationRequestId,
    integrationInputHash: integration.integrationInputHash,
    disposition: review.disposition,
    reviewedAt: run.reviewedAt,
  };
  const checkpointInput = {
    runId: integration.runId,
    reviewDecisionId: integration.reviewDecisionId,
    purpose: checkpoint.purpose,
    approvedDecisions: checkpoint.approvedDecisions,
    currentPosition: checkpoint.currentPosition,
    nextExpectedResult: checkpoint.nextExpectedResult,
    openReviewIds: checkpoint.openReviewIds,
  };
  const checkpointInputHash = digest(canonicalJson(checkpointInput));
  if (run.status !== "reviewed" || run.reviewDecisionId !== review.reviewDecisionId
    || run.resultPacketId !== integration.resultPacketId || run.wholePlanId !== plan.wholePlanId
    || run.executionContractId !== contract.executionContractId || run.capsuleId !== contract.capsuleId
    || review.disposition !== "accept" || review.resultPacketId !== integration.resultPacketId
    || review.wholePlanId !== plan.wholePlanId
    || !/^run-result-integration-request-[a-f0-9]{24}$/.test(integration.integrationRequestId)
    || integration.integrationInputHash !== checkpointInputHash
    || canonicalJson(expected) !== canonicalJson(integration)) {
    fail("Reviewed Run integration reference no longer matches verified lineage.", "SESSION_RESTORE_INTEGRATION_LINEAGE_CONFLICT");
  }
  return expected;
}

function verifyPointerShape(pointer) {
  if (!new Set(["session", "run", "review"]).has(pointer.mode)) {
    fail("Session mode is invalid for artifact-only restore.", "SESSION_RESTORE_MODE_CONFLICT");
  }
  if (pointer.activeRunId && pointer.pendingReview) {
    fail("Session cannot have an active Run and pending review simultaneously.", "SESSION_RESTORE_MODE_CONFLICT");
  }
  if ((pointer.mode === "run") !== Boolean(pointer.activeRunId)
    || (pointer.mode === "review") !== Boolean(pointer.pendingReview)
    || (pointer.mode === "session") !== (!pointer.activeRunId && !pointer.pendingReview)) {
    fail("Session mode does not match its Run/review pointers.", "SESSION_RESTORE_MODE_CONFLICT");
  }
}

function projectionIdentity(payload) {
  const sessionRestoreHash = digest(canonicalJson(payload));
  return { ...payload, sessionRestoreId: `session-restore-${sessionRestoreHash.slice(0, 24)}`, sessionRestoreHash };
}

export function restoreSessionFromArtifacts({ root = ".", checkpointId = null } = {}) {
  const inspected = readyProject(root, "artifact-only Session restore");
  const selectedCheckpointId = checkpointId == null ? inspected.state.latestCheckpoint : requiredText(checkpointId, "Recovery checkpoint id");
  if (!selectedCheckpointId) fail("Session restore requires a current canonical recovery checkpoint.", "SESSION_RESTORE_CHECKPOINT_REQUIRED");
  if (inspected.state.latestCheckpoint !== selectedCheckpointId) {
    fail("Session restore accepts only the current canonical checkpoint pointer.", "SESSION_RESTORE_CHECKPOINT_NOT_CURRENT");
  }
  const checkpoint = readRecoveryCheckpoint({ root: inspected.project.projectRoot, checkpointId: selectedCheckpointId }).checkpoint;
  if (checkpoint.protocol.version !== COMPACTION_RECOVERY_VERSION || !checkpoint.sessionPointer) {
    fail("Legacy checkpoints remain readable but cannot drive artifact-only Session restore.", "SESSION_RESTORE_CURRENT_CHECKPOINT_REQUIRED");
  }
  const currentPointer = { sessionId: inspected.state.sessionId, ...sessionPointer(inspected.state) };
  const checkpointPointer = { sessionId: checkpoint.sessionId, ...checkpoint.sessionPointer };
  if (canonicalJson(currentPointer) !== canonicalJson(checkpointPointer)) {
    fail("Current Session canon diverged from the checkpoint Session pointer.", "SESSION_RESTORE_POINTER_DRIFT");
  }
  verifyPointerShape(currentPointer);
  if (currentPointer.currentWholePlanId) verifiedArtifact(inspected.project.projectRoot, currentPointer.currentWholePlanId, "WholePlanSnapshot");
  const activeRun = currentPointer.activeRunId
    ? verifiedActiveRun(inspected.project.projectRoot, currentPointer, checkpoint.runPointer)
    : null;
  if (!currentPointer.activeRunId && checkpoint.runPointer !== null) {
    fail("Checkpoint carries an active Run pointer while the Session does not.", "SESSION_RESTORE_ACTIVE_RUN_CHECKPOINT_CONFLICT");
  }
  const pendingReview = currentPointer.pendingReview
    ? verifiedPendingReview(inspected.project.projectRoot, currentPointer)
    : null;
  const lastReviewDecision = verifyLastReview(inspected.project.projectRoot, currentPointer);
  const reviewedRunIntegration = verifyReviewedRunIntegration(inspected.project.projectRoot, checkpoint);
  const lastResultEvidence = optionalResultEvidence(inspected.project.projectRoot, currentPointer.lastResultPacketId);
  const integrationEvidence = reviewedRunIntegration?.resultPacketId
    ? optionalResultEvidence(inspected.project.projectRoot, reviewedRunIntegration.resultPacketId)
    : { status: "not-applicable", resultPacketId: null, artifactHash: null };
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    kind: "SessionRestoreProjection",
    protocol: { name: "head-agent-core-artifact-session-restore", version: SESSION_RECOVERY_VERSION },
    projectId: inspected.project.projectId,
    sessionId: inspected.state.sessionId,
    authorityBoundary: artifactAuthorityBoundary("SessionRestoreProjection"),
    checkpoint: {
      checkpointId: checkpoint.checkpointId,
      checkpointDigest: checkpoint.checkpointDigest,
      purpose: checkpoint.purpose,
      approvedDecisions: checkpoint.approvedDecisions,
      currentPosition: checkpoint.currentPosition,
      nextExpectedResult: checkpoint.nextExpectedResult,
      openReviewIds: checkpoint.openReviewIds,
    },
    sessionPointer: checkpoint.sessionPointer,
    activeRun,
    pendingReview,
    lastReviewDecision,
    lastResultEvidence,
    reviewedRunIntegration,
    integrationEvidence,
    consumerInstruction: {
      mode: "fresh-logical-head-from-verified-artifacts",
      purpose: checkpoint.purpose,
      currentPosition: checkpoint.currentPosition,
      nextExpectedResult: checkpoint.nextExpectedResult,
    },
    providerBoundary: {
      providerSessionIdentityRequired: false,
      providerSessionIdentityPersisted: false,
      providerTranscriptUsed: false,
      providerSummaryUsed: false,
      resumeEnabled: false,
      streamEnabled: false,
    },
    persisted: false,
    recoveryAuthority: false,
    instructionAuthority: false,
    promotionAuthority: false,
    objectiveRewrite: false,
  };
  return { status: "session_restored_from_artifacts", projection: projectionIdentity(payload), checkpoint };
}

function integrationDirectory(root) {
  return path.join(root, ".head", "sessions", "integrations");
}

function integrationRequestFile(root, reviewDecisionId) {
  return path.join(integrationDirectory(root), "requests", `${reviewDecisionId}.json`);
}

function integrationFile(root, reviewDecisionId) {
  if (typeof reviewDecisionId !== "string" || !/^review-decision-[a-f0-9]{24}$/.test(reviewDecisionId)) {
    fail("Run result integration ReviewDecision id is invalid.", "INVALID_RUN_RESULT_INTEGRATION_ID");
  }
  return path.join(integrationDirectory(root), `${reviewDecisionId}.json`);
}

function integrationInput({ runId, reviewDecisionId, purpose, approvedDecisions, currentPosition, nextExpectedResult, openReviewIds }) {
  return {
    runId: requiredText(runId, "Reviewed Run id"),
    reviewDecisionId: requiredText(reviewDecisionId, "ReviewDecision id"),
    purpose: requiredText(purpose, "Integration checkpoint purpose"),
    approvedDecisions: stringList(approvedDecisions || [], "Approved decisions"),
    currentPosition: requiredText(currentPosition, "Integration current position"),
    nextExpectedResult: requiredText(nextExpectedResult, "Integration next expected result"),
    openReviewIds: stringList(openReviewIds || [], "Open review ids"),
  };
}

function preflightAcceptedIntegration(inspected, input) {
  if (inspected.state.activeRunId || inspected.state.pendingReview || inspected.state.lastReviewDecisionId !== input.reviewDecisionId) {
    fail("Run result integration requires the current completed review state.", "RUN_RESULT_INTEGRATION_STATE_CONFLICT");
  }
  const run = readRun(inspected.project.projectRoot, input.runId);
  const review = verifiedArtifact(inspected.project.projectRoot, input.reviewDecisionId, "ReviewDecision");
  if (run.status !== "reviewed" || run.reviewDecisionId !== review.reviewDecisionId || !run.resultPacketId) {
    fail("Reviewed Run canon does not match the integration request.", "RUN_RESULT_INTEGRATION_RUN_CONFLICT");
  }
  const result = verifiedArtifact(inspected.project.projectRoot, run.resultPacketId, "ResultPacket");
  if (review.disposition !== "accept" || review.resultPacketId !== result.resultPacketId
    || review.resultPacketId !== run.resultPacketId || review.wholePlanId !== run.wholePlanId) {
    fail("Only an accepted ResultPacket with exact Fresh HEAD review lineage may be integrated.", "RUN_RESULT_NOT_ACCEPTED");
  }
  const contract = verifiedArtifact(inspected.project.projectRoot, result.executionContractId, "ExecutionContract");
  const plan = verifiedArtifact(inspected.project.projectRoot, review.wholePlanId, "WholePlanSnapshot");
  const capsule = readContextCapsule({ root: inspected.project.projectRoot, capsuleId: contract.capsuleId }).capsule;
  const freshReview = buildFreshHeadReview({
    root: inspected.project.projectRoot,
    wholePlanId: run.wholePlanId,
    resultPacketId: run.resultPacketId,
    sessionId: inspected.state.sessionId,
    runId: run.runId,
  }).review;
  if (contract.executionContractId !== run.executionContractId || contract.wholePlanId !== plan.wholePlanId
    || run.capsuleId !== contract.capsuleId || !capsule.capsuleHash
    || review.reviewContextId !== freshReview.reviewContextId) {
    fail("Reviewed Run integration lineage is inconsistent.", "RUN_RESULT_INTEGRATION_LINEAGE_CONFLICT");
  }
}

function verifyIntegrationRequest(root, request, expectedInput = null, expectedInputHash = null) {
  if (request?.kind !== "RunResultIntegrationRequest" || request.protocol?.name !== "head-agent-core-run-result-integration"
    || request.protocol?.version !== SESSION_RECOVERY_VERSION) {
    fail("Run result integration request is invalid.", "INVALID_RUN_RESULT_INTEGRATION_REQUEST");
  }
  const expectedInputKeys = ["approvedDecisions", "currentPosition", "nextExpectedResult", "openReviewIds", "purpose", "reviewDecisionId", "runId"];
  if (!request.input || canonicalJson(Object.keys(request.input).sort()) !== canonicalJson(expectedInputKeys)
    || request.recoveryAuthority !== false || request.instructionAuthority !== false
    || request.promotionAuthority !== false || Number.isNaN(Date.parse(request.requestedAt))) {
    fail("Run result integration request schema is invalid.", "INVALID_RUN_RESULT_INTEGRATION_REQUEST");
  }
  verifyArtifactAuthorityBoundary("RunResultIntegrationRequest", request.authorityBoundary);
  const payload = { ...request };
  const recordedId = payload.integrationRequestId;
  const recordedHash = payload.integrationRequestHash;
  delete payload.integrationRequestId;
  delete payload.integrationRequestHash;
  const actualHash = digest(canonicalJson(payload));
  if (recordedHash !== actualHash || recordedId !== `run-result-integration-request-${actualHash.slice(0, 24)}`
    || request.integrationInputHash !== digest(canonicalJson(request.input))) {
    fail("Run result integration request digest verification failed.", "RUN_RESULT_INTEGRATION_REQUEST_DIGEST_MISMATCH");
  }
  if ((expectedInputHash && request.integrationInputHash !== expectedInputHash)
    || (expectedInput && canonicalJson(request.input) !== canonicalJson(expectedInput))) {
    fail("ReviewDecision already has a different create-only integration request.", "RUN_RESULT_INTEGRATION_CONFLICT");
  }
  const inspected = readyProject(root, "a Run result integration request is verified");
  if (request.projectId !== inspected.project.projectId || request.sessionId !== inspected.state.sessionId
    || request.reviewDecisionId !== request.input.reviewDecisionId || request.runId !== request.input.runId) {
    fail("Run result integration request belongs to another Project, Session, Run, or ReviewDecision.", "RUN_RESULT_INTEGRATION_REQUEST_CONFLICT");
  }
  return request;
}

function ensureIntegrationRequest(inspected, input, integrationInputHash) {
  const file = integrationRequestFile(inspected.project.projectRoot, input.reviewDecisionId);
  if (fs.existsSync(file)) {
    return { file, request: verifyIntegrationRequest(inspected.project.projectRoot, readJson(file, "Run result integration request"), input, integrationInputHash) };
  }
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    kind: "RunResultIntegrationRequest",
    protocol: { name: "head-agent-core-run-result-integration", version: SESSION_RECOVERY_VERSION },
    projectId: inspected.project.projectId,
    sessionId: inspected.state.sessionId,
    authorityBoundary: artifactAuthorityBoundary("RunResultIntegrationRequest"),
    runId: input.runId,
    reviewDecisionId: input.reviewDecisionId,
    input,
    integrationInputHash,
    requestedAt: now(),
    recoveryAuthority: false,
    instructionAuthority: false,
    promotionAuthority: false,
  };
  const integrationRequestHash = digest(canonicalJson(payload));
  const request = {
    ...payload,
    integrationRequestId: `run-result-integration-request-${integrationRequestHash.slice(0, 24)}`,
    integrationRequestHash,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try { fs.writeFileSync(file, json(request), { encoding: "utf8", flag: "wx" }); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    return { file, request: verifyIntegrationRequest(inspected.project.projectRoot, readJson(file, "Run result integration request"), input, integrationInputHash) };
  }
  return { file, request: verifyIntegrationRequest(inspected.project.projectRoot, request, input, integrationInputHash) };
}

function verifyIntegrationReceipt(root, receipt, expectedReviewDecisionId = null) {
  if (receipt?.kind !== "RunResultIntegrationReceipt" || receipt.protocol?.name !== "head-agent-core-run-result-integration"
    || receipt.protocol?.version !== SESSION_RECOVERY_VERSION || receipt.reviewDecisionId !== (expectedReviewDecisionId || receipt.reviewDecisionId)) {
    fail("Run result integration receipt is invalid.", "INVALID_RUN_RESULT_INTEGRATION_RECEIPT");
  }
  verifyArtifactAuthorityBoundary("RunResultIntegrationReceipt", receipt.authorityBoundary);
  const payload = { ...receipt };
  const recordedId = payload.integrationReceiptId;
  const recordedHash = payload.integrationReceiptHash;
  delete payload.integrationReceiptId;
  delete payload.integrationReceiptHash;
  const actualHash = digest(canonicalJson(payload));
  if (recordedHash !== actualHash || recordedId !== `run-result-integration-${actualHash.slice(0, 24)}`) {
    fail("Run result integration receipt digest verification failed.", "RUN_RESULT_INTEGRATION_RECEIPT_DIGEST_MISMATCH");
  }
  const checkpoint = readRecoveryCheckpoint({ root, checkpointId: receipt.checkpointId }).checkpoint;
  const request = verifyIntegrationRequest(root, readJson(integrationRequestFile(root, receipt.reviewDecisionId), "Run result integration request"));
  const expectedInputHash = digest(canonicalJson({
    runId: receipt.runId,
    reviewDecisionId: receipt.reviewDecisionId,
    purpose: checkpoint.purpose,
    approvedDecisions: checkpoint.approvedDecisions,
    currentPosition: checkpoint.currentPosition,
    nextExpectedResult: checkpoint.nextExpectedResult,
    openReviewIds: checkpoint.openReviewIds,
  }));
  if (checkpoint.projectId !== receipt.projectId || checkpoint.sessionId !== receipt.sessionId
    || request.integrationRequestId !== receipt.integrationRequestId || request.integrationInputHash !== receipt.integrationInputHash
    || checkpoint.checkpointDigest !== receipt.checkpointDigest || receipt.integrationInputHash !== expectedInputHash
    || checkpoint.reviewedRunIntegration?.reviewDecisionId !== receipt.reviewDecisionId
    || checkpoint.reviewedRunIntegration?.runId !== receipt.runId
    || checkpoint.reviewedRunIntegration?.integrationRequestId !== receipt.integrationRequestId
    || checkpoint.reviewedRunIntegration?.integrationInputHash !== receipt.integrationInputHash) {
    fail("Run result integration receipt does not match its recovery checkpoint.", "RUN_RESULT_INTEGRATION_RECEIPT_CONFLICT");
  }
  return { receipt, checkpoint };
}

export function readRunResultIntegration({ root = ".", reviewDecisionId } = {}) {
  const inspected = readyProject(root, "a Run result integration is read");
  const file = integrationFile(inspected.project.projectRoot, reviewDecisionId);
  if (!fs.existsSync(file)) fail(`Run result integration not found: ${reviewDecisionId}`, "RUN_RESULT_INTEGRATION_NOT_FOUND");
  return { status: "verified", file, ...verifyIntegrationReceipt(inspected.project.projectRoot, readJson(file, "Run result integration receipt"), reviewDecisionId) };
}

function checkpointMatchesInput(checkpoint, input, integrationRequest) {
  return checkpoint.purpose === input.purpose
    && canonicalJson(checkpoint.approvedDecisions) === canonicalJson(input.approvedDecisions)
    && checkpoint.currentPosition === input.currentPosition
    && checkpoint.nextExpectedResult === input.nextExpectedResult
    && canonicalJson(checkpoint.openReviewIds) === canonicalJson(input.openReviewIds)
    && checkpoint.reviewedRunIntegration?.runId === input.runId
    && checkpoint.reviewedRunIntegration?.reviewDecisionId === input.reviewDecisionId
    && checkpoint.reviewedRunIntegration?.integrationRequestId === integrationRequest.integrationRequestId
    && checkpoint.reviewedRunIntegration?.integrationInputHash === integrationRequest.integrationInputHash;
}

function existingIntegrationCheckpoint(root, input, integrationRequest) {
  const ledger = path.join(root, ".head", "sessions", "ledger");
  if (!fs.existsSync(ledger)) return null;
  const matches = [];
  for (const entry of fs.readdirSync(ledger, { withFileTypes: true })) {
    if (!entry.isFile() || !/^checkpoint-[a-f0-9]{24}\.json$/.test(entry.name)) continue;
    const checkpointId = entry.name.slice(0, -5);
    let checkpoint;
    try { checkpoint = readRecoveryCheckpoint({ root, checkpointId }).checkpoint; }
    catch (error) {
      if (error.code === "INVALID_RECOVERY_CHECKPOINT") continue;
      throw error;
    }
    if (checkpoint.reviewedRunIntegration?.reviewDecisionId === input.reviewDecisionId) matches.push(checkpoint);
  }
  if (matches.length > 1) fail("ReviewDecision is linked to multiple recovery checkpoints.", "RUN_RESULT_INTEGRATION_MULTIPLE_CHECKPOINTS");
  if (matches[0] && !checkpointMatchesInput(matches[0], input, integrationRequest)) {
    fail("ReviewDecision was already integrated with a different recovery direction.", "RUN_RESULT_INTEGRATION_CONFLICT");
  }
  return matches[0] || null;
}

function writeIntegrationReceipt(root, input, checkpoint, integrationInputHash, integrationRequest) {
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    kind: "RunResultIntegrationReceipt",
    protocol: { name: "head-agent-core-run-result-integration", version: SESSION_RECOVERY_VERSION },
    projectId: checkpoint.projectId,
    sessionId: checkpoint.sessionId,
    authorityBoundary: artifactAuthorityBoundary("RunResultIntegrationReceipt"),
    runId: input.runId,
    reviewDecisionId: input.reviewDecisionId,
    resultPacketId: checkpoint.reviewedRunIntegration.resultPacketId,
    checkpointId: checkpoint.checkpointId,
    checkpointDigest: checkpoint.checkpointDigest,
    integrationRequestId: integrationRequest.integrationRequestId,
    integrationInputHash,
    integratedAt: now(),
    checkpointFieldSource: "explicit-head-user-integration-input-only",
    resultPacketRole: "reference-evidence-only",
    reviewDecisionCreated: false,
    recoveryAuthority: false,
    instructionAuthority: false,
    promotionAuthority: false,
  };
  const integrationReceiptHash = digest(canonicalJson(payload));
  const receipt = {
    ...payload,
    integrationReceiptId: `run-result-integration-${integrationReceiptHash.slice(0, 24)}`,
    integrationReceiptHash,
  };
  const file = integrationFile(root, input.reviewDecisionId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try { fs.writeFileSync(file, json(receipt), { encoding: "utf8", flag: "wx" }); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    return readRunResultIntegration({ root, reviewDecisionId: input.reviewDecisionId });
  }
  return { status: "recorded", file, ...verifyIntegrationReceipt(root, receipt, input.reviewDecisionId) };
}

export function integrateReviewedRunCheckpoint({ root = ".", runId, reviewDecisionId, purpose, approvedDecisions = [], currentPosition, nextExpectedResult, openReviewIds = [] } = {}) {
  const inspected = readyProject(root, "a reviewed Run result is integrated");
  const input = integrationInput({ runId, reviewDecisionId, purpose, approvedDecisions, currentPosition, nextExpectedResult, openReviewIds });
  const integrationInputHash = digest(canonicalJson(input));
  preflightAcceptedIntegration(inspected, input);
  const integrationRequest = ensureIntegrationRequest(inspected, input, integrationInputHash).request;
  const receiptFile = integrationFile(inspected.project.projectRoot, input.reviewDecisionId);
  if (fs.existsSync(receiptFile)) {
    const existing = readRunResultIntegration({ root: inspected.project.projectRoot, reviewDecisionId: input.reviewDecisionId });
    if (existing.receipt.integrationInputHash !== integrationInputHash) {
      fail("ReviewDecision was already integrated with a different recovery direction.", "RUN_RESULT_INTEGRATION_CONFLICT");
    }
    return { ...existing, status: "run_result_integration_existing" };
  }
  let checkpoint = existingIntegrationCheckpoint(inspected.project.projectRoot, input, integrationRequest);
  if (!checkpoint) {
    checkpoint = createRecoveryCheckpoint({
      root: inspected.project.projectRoot,
      purpose: input.purpose,
      approvedDecisions: input.approvedDecisions,
      currentPosition: input.currentPosition,
      nextExpectedResult: input.nextExpectedResult,
      openReviewIds: input.openReviewIds,
      reviewedRunIntegration: {
        runId: input.runId,
        reviewDecisionId: input.reviewDecisionId,
        integrationRequestId: integrationRequest.integrationRequestId,
        integrationInputHash: integrationRequest.integrationInputHash,
      },
    }).checkpoint;
  }
  const recorded = writeIntegrationReceipt(inspected.project.projectRoot, input, checkpoint, integrationInputHash, integrationRequest);
  return {
    status: "run_result_integrated_checkpointed",
    checkpoint: recorded.checkpoint,
    integrationReceipt: recorded.receipt,
    file: recorded.file,
  };
}
