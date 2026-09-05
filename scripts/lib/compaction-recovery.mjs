import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { inspectProject, SCHEMA_VERSION } from "./head-core.mjs";
import { readContextCapsule } from "./context-compiler.mjs";
import { buildFreshHeadReview, readLineageArtifact } from "./execution-lineage.mjs";
import { artifactAuthorityBoundary, verifyArtifactAuthorityBoundary } from "./authority-plane-contract.mjs";
import { withProjectMutation } from "./project-mutation-lock.mjs";

export const COMPACTION_RECOVERY_VERSION = "0.3.0";
const RUN_RESULT_INTEGRATION_VERSION = "0.1.0";

const OPEN_STATES = new Set(["preparing", "prepared", "provider_compacted", "verified"]);
const TERMINAL_STATES = new Set(["continued", "superseded", "aborted"]);

const fail = (message, code = "COMPACTION_RECOVERY_ERROR") => {
  const error = new Error(message);
  error.code = code;
  throw error;
};

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const now = () => new Date().toISOString();
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonical(value));
}

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) fail(`${label} is required.`, "INVALID_COMPACTION_INPUT");
  return value.trim();
}

function stringList(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    fail(`${label} must be an array of non-empty strings.`, "INVALID_COMPACTION_INPUT");
  }
  return [...new Set(value.map((item) => item.trim()))].sort();
}

function turnId(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label} must be a non-negative safe integer.`, "INVALID_USER_TURN_ID");
  return value;
}

function readyProject(root, action) {
  const inspected = inspectProject(root);
  if (inspected.status === "not_initialized") fail("HEAD Agent Core is not initialized.", "NOT_INITIALIZED");
  if (inspected.status === "drifted") fail(`Managed file drift must be resolved before ${action}.`, "MANAGED_DRIFT");
  if (inspected.status !== "ready") fail(`Project must be ready before ${action}; current status: ${inspected.status}.`, "PROJECT_NOT_READY");
  return inspected;
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

function replaceJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, json(value), { encoding: "utf8", flag: "wx" });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function readJson(file, label) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { fail(`${label} is invalid JSON: ${error.message}`, "INVALID_COMPACTION_CANON"); }
}

function checkpointDirectory(root) {
  return path.join(root, ".head", "sessions", "ledger");
}

function checkpointFile(root, checkpointId) {
  if (typeof checkpointId !== "string" || !/^checkpoint-[a-f0-9]{24}$/.test(checkpointId)) {
    fail("Recovery checkpoint id is invalid.", "INVALID_RECOVERY_CHECKPOINT_ID");
  }
  return path.join(checkpointDirectory(root), `${checkpointId}.json`);
}

function compactionRoot(root) {
  return path.join(root, ".head", "sessions", "compaction");
}

function epochFile(root, epochId) {
  if (typeof epochId !== "string" || !/^compaction-epoch-[a-f0-9-]{36}$/.test(epochId)) {
    fail("Compaction epoch id is invalid.", "INVALID_COMPACTION_EPOCH_ID");
  }
  return path.join(compactionRoot(root), "epochs", `${epochId}.json`);
}

function currentEpochFile(root) {
  return path.join(compactionRoot(root), "current.json");
}

function consumptionFile(root, epochId) {
  return path.join(compactionRoot(root), "consumptions", `${epochId}.json`);
}

function receiptDirectory(root) {
  return path.join(compactionRoot(root), "receipts");
}

function verifyContentIdentity(document, { idField, hashField, prefix, label }) {
  const payload = { ...document };
  const recordedId = payload[idField];
  const recordedHash = payload[hashField];
  delete payload[idField];
  delete payload[hashField];
  const actualHash = digest(canonicalJson(payload));
  if (recordedHash !== actualHash || recordedId !== `${prefix}-${actualHash.slice(0, 24)}`) {
    fail(`${label} digest verification failed.`, "COMPACTION_DIGEST_MISMATCH");
  }
  return document;
}

function readRunPointer(inspected) {
  const state = inspected.state;
  if (!state.activeRunId) return null;
  if (!state.activeExecutionContractId || !state.currentWholePlanId) {
    fail("Active Run state is missing its ExecutionContract or WholePlan pointer.", "COMPACTION_RUN_POINTER_REQUIRED");
  }
  const runFile = path.join(inspected.project.projectRoot, ".head", "sessions", "runs", state.activeRunId, "run.json");
  const run = readJson(runFile, "Active Run canon");
  if (run.status !== "active" || run.runId !== state.activeRunId || run.wholePlanId !== state.currentWholePlanId
    || run.executionContractId !== state.activeExecutionContractId) {
    fail("Active Run state does not match Run canon.", "COMPACTION_RUN_POINTER_MISMATCH");
  }
  const contract = readLineageArtifact({ root: inspected.project.projectRoot, artifactId: run.executionContractId }).artifact;
  if (contract.kind !== "ExecutionContract" || contract.wholePlanId !== run.wholePlanId || contract.capsuleId !== run.capsuleId) {
    fail("Active Run does not match its verified ExecutionContract.", "COMPACTION_RUN_LINEAGE_MISMATCH");
  }
  const plan = readLineageArtifact({ root: inspected.project.projectRoot, artifactId: run.wholePlanId }).artifact;
  if (plan.kind !== "WholePlanSnapshot") fail("Active Run WholePlan pointer is invalid.", "COMPACTION_RUN_LINEAGE_MISMATCH");
  const capsule = readContextCapsule({ root: inspected.project.projectRoot, capsuleId: run.capsuleId }).capsule;
  return {
    runId: run.runId,
    wholePlanId: run.wholePlanId,
    executionContractId: run.executionContractId,
    contextCapsuleDigest: capsule.capsuleHash,
    currentResultPacketId: state.lastResultPacketId || null,
  };
}

function readSessionPointer(inspected) {
  const state = inspected.state;
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

function verifyIntegrationRequest(inspected, input, checkpointInput) {
  const requestFile = path.join(
    inspected.project.projectRoot,
    ".head",
    "sessions",
    "integrations",
    "requests",
    `${input.reviewDecisionId}.json`,
  );
  if (!fs.existsSync(requestFile)) {
    fail("Reviewed Run integration requires its create-only P3 request.", "RUN_RESULT_INTEGRATION_REQUEST_REQUIRED");
  }
  const request = readJson(requestFile, "Run result integration request");
  if (request.kind !== "RunResultIntegrationRequest"
    || request.protocol?.name !== "head-agent-core-run-result-integration"
    || request.protocol?.version !== RUN_RESULT_INTEGRATION_VERSION
    || request.projectId !== inspected.project.projectId
    || request.sessionId !== inspected.state.sessionId
    || request.runId !== input.runId
    || request.reviewDecisionId !== input.reviewDecisionId
    || request.integrationRequestId !== input.integrationRequestId
    || request.integrationInputHash !== input.integrationInputHash
    || request.recoveryAuthority !== false
    || request.instructionAuthority !== false
    || request.promotionAuthority !== false) {
    fail("Run result integration request does not match the current transaction.", "RUN_RESULT_INTEGRATION_REQUEST_CONFLICT");
  }
  verifyArtifactAuthorityBoundary("RunResultIntegrationRequest", request.authorityBoundary);
  const payload = { ...request };
  const recordedId = payload.integrationRequestId;
  const recordedHash = payload.integrationRequestHash;
  delete payload.integrationRequestId;
  delete payload.integrationRequestHash;
  const actualHash = digest(canonicalJson(payload));
  if (recordedHash !== actualHash
    || recordedId !== `run-result-integration-request-${actualHash.slice(0, 24)}`
    || request.integrationInputHash !== digest(canonicalJson(request.input))
    || canonicalJson(request.input) !== canonicalJson(checkpointInput)) {
    fail("Run result integration request cannot author a different recovery direction.", "RUN_RESULT_INTEGRATION_REQUEST_CONFLICT");
  }
  return request;
}

function verifiedReviewedRunIntegration(inspected, input, checkpointInput) {
  if (input == null) return null;
  const keys = Object.keys(input).sort();
  if (canonicalJson(keys) !== canonicalJson(["integrationInputHash", "integrationRequestId", "reviewDecisionId", "runId"])) {
    fail("Reviewed Run integration requires one exact create-only request identity.", "INVALID_RUN_RESULT_INTEGRATION");
  }
  const runId = requiredText(input.runId, "Reviewed Run id");
  const reviewDecisionId = requiredText(input.reviewDecisionId, "Reviewed Run ReviewDecision id");
  const integrationRequestId = requiredText(input.integrationRequestId, "Run result integration request id");
  const integrationInputHash = requiredText(input.integrationInputHash, "Run result integration input hash");
  if (!/^run-[0-9]+-[a-f0-9]{6}$/.test(runId) || !/^review-decision-[a-f0-9]{24}$/.test(reviewDecisionId)
    || !/^run-result-integration-request-[a-f0-9]{24}$/.test(integrationRequestId) || !/^[a-f0-9]{64}$/.test(integrationInputHash)) {
    fail("Reviewed Run integration identities are invalid.", "INVALID_RUN_RESULT_INTEGRATION");
  }
  verifyIntegrationRequest(inspected, { runId, reviewDecisionId, integrationRequestId, integrationInputHash }, checkpointInput);
  if (inspected.state.activeRunId || inspected.state.pendingReview || inspected.state.lastReviewDecisionId !== reviewDecisionId) {
    fail("Reviewed Run integration requires the current completed review state.", "RUN_RESULT_INTEGRATION_STATE_CONFLICT");
  }
  const file = path.join(inspected.project.projectRoot, ".head", "sessions", "runs", runId, "run.json");
  if (!fs.existsSync(file)) fail(`Reviewed Run canon not found: ${runId}`, "RUN_RESULT_INTEGRATION_RUN_NOT_FOUND");
  const run = readJson(file, "Reviewed Run canon");
  if (run.runId !== runId || run.status !== "reviewed" || run.reviewDecisionId !== reviewDecisionId || !run.resultPacketId) {
    fail("Reviewed Run canon does not match the integration request.", "RUN_RESULT_INTEGRATION_RUN_CONFLICT");
  }
  const review = readLineageArtifact({ root: inspected.project.projectRoot, artifactId: reviewDecisionId }).artifact;
  const result = readLineageArtifact({ root: inspected.project.projectRoot, artifactId: run.resultPacketId }).artifact;
  if (review.kind !== "ReviewDecision" || result.kind !== "ResultPacket" || review.disposition !== "accept"
    || review.resultPacketId !== result.resultPacketId || review.resultPacketId !== run.resultPacketId
    || review.wholePlanId !== run.wholePlanId) {
    fail("Only an accepted ResultPacket with exact Fresh HEAD review lineage may be integrated.", "RUN_RESULT_NOT_ACCEPTED");
  }
  const contract = readLineageArtifact({ root: inspected.project.projectRoot, artifactId: result.executionContractId }).artifact;
  const plan = readLineageArtifact({ root: inspected.project.projectRoot, artifactId: review.wholePlanId }).artifact;
  const capsule = readContextCapsule({ root: inspected.project.projectRoot, capsuleId: contract.capsuleId }).capsule;
  const freshReview = buildFreshHeadReview({
    root: inspected.project.projectRoot,
    wholePlanId: run.wholePlanId,
    resultPacketId: run.resultPacketId,
    sessionId: inspected.state.sessionId,
    runId,
  }).review;
  if (contract.kind !== "ExecutionContract" || plan.kind !== "WholePlanSnapshot"
    || contract.executionContractId !== run.executionContractId || contract.wholePlanId !== plan.wholePlanId
    || run.capsuleId !== contract.capsuleId || review.reviewContextId !== freshReview.reviewContextId) {
    fail("Reviewed Run integration lineage is inconsistent.", "RUN_RESULT_INTEGRATION_LINEAGE_CONFLICT");
  }
  return {
    runId,
    wholePlanId: plan.wholePlanId,
    executionContractId: contract.executionContractId,
    contextCapsuleDigest: capsule.capsuleHash,
    resultPacketId: result.resultPacketId,
    reviewDecisionId: review.reviewDecisionId,
    reviewContextId: review.reviewContextId,
    integrationRequestId,
    integrationInputHash,
    disposition: review.disposition,
    reviewedAt: requiredText(run.reviewedAt, "Reviewed Run timestamp"),
  };
}

function recoveryCheckpointPayload({ inspected, purpose, approvedDecisions, currentPosition, nextExpectedResult, openReviewIds, reviewedRunIntegration }) {
  const pendingReviewIds = inspected.state.pendingReview?.resultPacketId ? [inspected.state.pendingReview.resultPacketId] : [];
  const normalizedCheckpointInput = {
    runId: reviewedRunIntegration?.runId || null,
    reviewDecisionId: reviewedRunIntegration?.reviewDecisionId || null,
    purpose: requiredText(purpose, "Checkpoint purpose"),
    approvedDecisions: stringList(approvedDecisions, "Approved decisions"),
    currentPosition: requiredText(currentPosition, "Current position"),
    nextExpectedResult: requiredText(nextExpectedResult, "Next expected result"),
    openReviewIds: [...new Set([...stringList(openReviewIds || [], "Open review ids"), ...pendingReviewIds])].sort(),
  };
  const verifiedIntegration = verifiedReviewedRunIntegration(inspected, reviewedRunIntegration, normalizedCheckpointInput);
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "SessionRunCheckpoint",
    protocol: { name: "head-agent-core-session-run-recovery", version: COMPACTION_RECOVERY_VERSION },
    projectId: inspected.project.projectId,
    sessionId: inspected.state.sessionId,
    authorityBoundary: artifactAuthorityBoundary("SessionRunCheckpoint"),
    purpose: normalizedCheckpointInput.purpose,
    approvedDecisions: normalizedCheckpointInput.approvedDecisions,
    currentPosition: normalizedCheckpointInput.currentPosition,
    nextExpectedResult: normalizedCheckpointInput.nextExpectedResult,
    sessionPointer: readSessionPointer(inspected),
    runPointer: readRunPointer(inspected),
    reviewedRunIntegration: verifiedIntegration,
    openReviewIds: normalizedCheckpointInput.openReviewIds,
    createdAt: verifiedIntegration?.reviewedAt || now(),
    authority: {
      recovery: "canonical-session-run-checkpoint",
      recoveryFieldSources: "explicit-head-user-direction-and-verified-p2-lineage-only",
      evidenceRecords: "reference-only-not-recovery-field-source",
      providerSummary: "orientation-only",
      continuitySnapshot: "derived-view-not-recovery-input",
    },
  };
}

export function createRecoveryCheckpoint(options = {}) {
  return withRecoveryMutation(options, () => createRecoveryCheckpointLocked(options));
}

function createRecoveryCheckpointLocked({ root = ".", purpose, approvedDecisions = [], currentPosition, nextExpectedResult, openReviewIds = [], reviewedRunIntegration = null } = {}) {
  const inspected = readyProject(root, "a recovery checkpoint is created");
  const payload = recoveryCheckpointPayload({ inspected, purpose, approvedDecisions, currentPosition, nextExpectedResult, openReviewIds, reviewedRunIntegration });
  const checkpointDigest = digest(canonicalJson(payload));
  const checkpointId = `checkpoint-${checkpointDigest.slice(0, 24)}`;
  const checkpoint = { ...payload, checkpointId, checkpointDigest };
  return persistRecoveryCheckpoint(inspected, checkpoint);
}

function persistRecoveryCheckpoint(inspected, checkpoint) {
  const { checkpointId } = checkpoint;
  const file = checkpointFile(inspected.project.projectRoot, checkpointId);
  let existed = fs.existsSync(file);
  if (!existed) {
    try {
      atomicWrite(file, json(checkpoint));
    } catch (error) {
      // Two identical integrations may derive the same immutable checkpoint
      // before either process observes the file. The losing create converges
      // only when the exact content-addressed target now exists and verifies.
      if (!fs.existsSync(file)) throw error;
      existed = true;
    }
  }
  if (existed) readRecoveryCheckpoint({ root: inspected.project.projectRoot, checkpointId });
  const state = { ...inspected.state, latestCheckpoint: checkpointId, updatedAt: now() };
  replaceJson(path.join(inspected.project.projectRoot, ".head", "sessions", "current.json"), state);
  return { status: existed ? "existing" : "checkpointed", file, checkpoint, state };
}

export function readRecoveryCheckpoint({ root = ".", checkpointId } = {}) {
  const inspected = readyProject(root, "a recovery checkpoint is read");
  const file = checkpointFile(inspected.project.projectRoot, checkpointId);
  if (!fs.existsSync(file)) fail(`Recovery checkpoint not found: ${checkpointId}`, "RECOVERY_CHECKPOINT_NOT_FOUND");
  const checkpoint = readJson(file, "Recovery checkpoint");
  if (checkpoint.kind !== "SessionRunCheckpoint" || checkpoint.projectId !== inspected.project.projectId
    || checkpoint.sessionId !== inspected.state.sessionId || !checkpoint.purpose || !Array.isArray(checkpoint.approvedDecisions)
    || !checkpoint.currentPosition || !checkpoint.nextExpectedResult) {
    fail("Recovery checkpoint is incomplete or belongs to another Project/Session.", "INVALID_RECOVERY_CHECKPOINT");
  }
  const checkpointVersion = checkpoint.protocol?.version;
  if (checkpoint.protocol?.name !== "head-agent-core-session-run-recovery" || !new Set(["0.1.0", "0.2.0", COMPACTION_RECOVERY_VERSION]).has(checkpointVersion)) {
    fail("Recovery checkpoint protocol is invalid.", "INVALID_RECOVERY_CHECKPOINT");
  }
  if (new Set(["0.2.0", COMPACTION_RECOVERY_VERSION]).has(checkpointVersion)) {
    verifyArtifactAuthorityBoundary("SessionRunCheckpoint", checkpoint.authorityBoundary);
  }
  if (checkpointVersion === COMPACTION_RECOVERY_VERSION && (!checkpoint.sessionPointer || typeof checkpoint.sessionPointer !== "object"
    || !("reviewedRunIntegration" in checkpoint))) {
    fail("Current recovery checkpoint is missing its immutable Session pointer.", "INVALID_RECOVERY_CHECKPOINT");
  }
  verifyContentIdentity(checkpoint, { idField: "checkpointId", hashField: "checkpointDigest", prefix: "checkpoint", label: "Recovery checkpoint" });
  return { status: "verified", file, checkpoint };
}

function readEpoch(root, epochId) {
  const file = epochFile(root, epochId);
  if (!fs.existsSync(file)) fail(`Compaction epoch not found: ${epochId}`, "COMPACTION_EPOCH_NOT_FOUND");
  const epoch = readJson(file, "Compaction epoch");
  if (epoch.epochId !== epochId || epoch.kind !== "CompactionEpoch") fail("Compaction epoch identity is invalid.", "INVALID_COMPACTION_EPOCH");
  return { file, epoch };
}

function writeEpoch(file, epoch, state, fields = {}) {
  const updated = { ...epoch, ...fields, state, updatedAt: now() };
  replaceJson(file, updated);
  return updated;
}

function currentEpoch(root) {
  const file = currentEpochFile(root);
  if (!fs.existsSync(file)) return null;
  const pointer = readJson(file, "Current compaction epoch pointer");
  return readEpoch(root, pointer.epochId).epoch;
}

function withRecoveryMutation(options, operation) {
  return withProjectMutation({ root: options.root, scope: "session-recovery" }, () => {
    const inspected = readyProject(options.root, "a recovery operation runs");
    const previous = currentEpoch(inspected.project.projectRoot);
    if (previous?.state === "preparing") {
      // The previous process stopped before prepare returned. Preserve whichever
      // complete P2 checkpoint was published, and close only the P5 token whose
      // delivery is now uncertain. No raw token or direction is reconstructed.
      writeEpoch(epochFile(inspected.project.projectRoot, previous.epochId), previous, "aborted", {
        abortReason: "prepare-interrupted-before-token-delivery",
        continuationTokenBindingHash: null,
      });
    }
    return operation();
  });
}

function assertCurrentStateMatchesCheckpoint(inspected, checkpoint) {
  if (inspected.state.sessionId !== checkpoint.sessionId || inspected.state.latestCheckpoint !== checkpoint.checkpointId) {
    fail("Current Session no longer points to the prepared recovery checkpoint.", "COMPACTION_CHECKPOINT_STALE");
  }
  if (checkpoint.protocol?.version === COMPACTION_RECOVERY_VERSION
    && canonicalJson(readSessionPointer(inspected)) !== canonicalJson(checkpoint.sessionPointer)) {
    fail("Current Session pointer changed after compaction prepare.", "COMPACTION_SESSION_DRIFT");
  }
  const currentRun = readRunPointer(inspected);
  if (canonicalJson(currentRun) !== canonicalJson(checkpoint.runPointer)) {
    fail("Current Run pointer changed after compaction prepare.", "COMPACTION_RUN_DRIFT");
  }
  const currentReviews = inspected.state.pendingReview?.resultPacketId ? [inspected.state.pendingReview.resultPacketId] : [];
  if (currentReviews.some((id) => !checkpoint.openReviewIds.includes(id))) {
    fail("An open review is missing from the recovery checkpoint.", "COMPACTION_REVIEW_DRIFT");
  }
}

function maybeSupersede(root, epochFilePath, epoch, currentUserTurnId) {
  const current = turnId(currentUserTurnId, "Current user turn id");
  if (!OPEN_STATES.has(epoch.state)) return epoch;
  if (current <= epoch.userTurnIdAtPrepare) return epoch;
  const superseded = writeEpoch(epochFilePath, epoch, "superseded", {
    supersededByUserTurnId: current,
    continuationTokenBindingHash: null,
  });
  writeRecoveryReceipt(root, superseded, {
    verifiedDigest: null,
    continuationSubmitted: false,
    supersededByUserTurnId: current,
  });
  return superseded;
}

function writeRecoveryReceipt(root, epoch, { verifiedDigest = null, continuationSubmitted = false, supersededByUserTurnId = null } = {}) {
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    kind: "CompactionRecoveryReceipt",
    protocol: { name: "head-agent-core-compaction-recovery", version: COMPACTION_RECOVERY_VERSION },
    projectId: epoch.projectId,
    sessionId: epoch.sessionId,
    epochId: epoch.epochId,
    checkpointId: epoch.checkpointId,
    verifiedDigest,
    recoveredAt: now(),
    continuationSubmitted,
    supersededByUserTurnId,
    authority: "derived-observation-only",
    instructionAuthority: false,
    recoveryAuthority: false,
    objectiveRewrite: false,
  };
  const receiptHash = digest(canonicalJson(payload));
  const receiptId = `compaction-receipt-${receiptHash.slice(0, 24)}`;
  const receipt = { ...payload, receiptId, receiptHash };
  const file = path.join(receiptDirectory(root), `${receiptId}.json`);
  if (!fs.existsSync(file)) atomicWrite(file, json(receipt));
  return { file, receipt };
}

function validateCompactionRuntime(runtime) {
  if (!new Set(["manual", "claude", "codex", "opencode"]).has(runtime)) {
    fail("Compaction runtime is invalid.", "INVALID_COMPACTION_RUNTIME");
  }
  return runtime;
}

function createCompactionEpoch({ inspected, checkpoint, runtime, userTurnIdAtPrepare, commitCheckpoint = null }) {
  const previous = currentEpoch(inspected.project.projectRoot);
  if (previous && OPEN_STATES.has(previous.state)) fail(`Compaction epoch is already open: ${previous.epochId}`, "COMPACTION_EPOCH_ALREADY_OPEN");
  if (inspected.state.activeRunId && !checkpoint.runPointer) {
    fail("Active Run compaction requires a verified Run pointer.", "COMPACTION_RUN_POINTER_REQUIRED");
  }
  const epochId = `compaction-epoch-${crypto.randomUUID()}`;
  const continuationToken = crypto.randomBytes(32).toString("base64url");
  const epoch = {
    schemaVersion: SCHEMA_VERSION,
    kind: "CompactionEpoch",
    protocol: { name: "head-agent-core-compaction-recovery", version: COMPACTION_RECOVERY_VERSION },
    epochId,
    projectId: inspected.project.projectId,
    sessionId: inspected.state.sessionId,
    runId: checkpoint.runPointer?.runId || null,
    checkpointId: checkpoint.checkpointId,
    checkpointDigest: checkpoint.checkpointDigest,
    userTurnIdAtPrepare: turnId(userTurnIdAtPrepare, "User turn id at prepare"),
    continuationTokenBindingHash: digest(`${epochId}\n${checkpoint.checkpointDigest}\n${continuationToken}`),
    runtime: validateCompactionRuntime(runtime),
    state: "preparing",
    createdAt: now(),
    updatedAt: now(),
    providerSessionIdentityPersisted: false,
  };
  const file = epochFile(inspected.project.projectRoot, epochId);
  const pointerFile = currentEpochFile(inspected.project.projectRoot);
  const sessionFile = path.join(inspected.project.projectRoot, ".head", "sessions", "current.json");
  const previousPointer = fs.existsSync(pointerFile) ? fs.readFileSync(pointerFile) : null;
  const previousSession = fs.readFileSync(sessionFile);
  const checkpointPath = checkpointFile(inspected.project.projectRoot, checkpoint.checkpointId);
  const checkpointExisted = fs.existsSync(checkpointPath);
  let prepared;
  try {
    atomicWrite(file, json(epoch));
    replaceJson(pointerFile, { schemaVersion: SCHEMA_VERSION, epochId, updatedAt: now() });
    if (commitCheckpoint) commitCheckpoint();
    prepared = writeEpoch(file, epoch, "prepared");
  } catch (error) {
    // Synchronous failures restore exact pointers. Abrupt process death is
    // handled by the preparing state on the next mutation, without replaying
    // the lost token or treating a P5 journal as recovery authority.
    atomicWrite(sessionFile, previousSession);
    if (previousPointer) atomicWrite(pointerFile, previousPointer);
    else if (fs.existsSync(pointerFile)) fs.unlinkSync(pointerFile);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    if (!checkpointExisted && fs.existsSync(checkpointPath)) fs.unlinkSync(checkpointPath);
    throw error;
  }
  return {
    status: "compaction_prepared",
    checkpoint,
    epoch: prepared,
    continuationToken,
    warning: "Compaction is lossy; recovery authority remains the Session/Run checkpoint.",
    providerAction: "Perform provider compaction explicitly, then verify it with trusted user-turn evidence.",
  };
}

export function prepareCompaction(options = {}) {
  validateCompactionRuntime(options.runtime ?? "manual");
  turnId(options.userTurnIdAtPrepare, "User turn id at prepare");
  return withRecoveryMutation(options, () => prepareCompactionLocked(options));
}

function prepareCompactionLocked({ root = ".", runtime = "manual", userTurnIdAtPrepare, purpose, approvedDecisions = [], currentPosition, nextExpectedResult, openReviewIds = [] } = {}) {
  const inspected = readyProject(root, "compaction is prepared");
  validateCompactionRuntime(runtime);
  turnId(userTurnIdAtPrepare, "User turn id at prepare");
  const previous = currentEpoch(inspected.project.projectRoot);
  if (previous && OPEN_STATES.has(previous.state)) fail(`Compaction epoch is already open: ${previous.epochId}`, "COMPACTION_EPOCH_ALREADY_OPEN");
  const payload = recoveryCheckpointPayload({ inspected, purpose, approvedDecisions, currentPosition, nextExpectedResult, openReviewIds });
  const checkpointDigest = digest(canonicalJson(payload));
  const checkpoint = { ...payload, checkpointId: `checkpoint-${checkpointDigest.slice(0, 24)}`, checkpointDigest };
  return createCompactionEpoch({
    inspected,
    checkpoint,
    runtime,
    userTurnIdAtPrepare,
    commitCheckpoint: () => persistRecoveryCheckpoint(inspected, checkpoint),
  });
}

export function prepareCompactionFromCurrentCheckpoint(options = {}) {
  validateCompactionRuntime(options.runtime ?? "manual");
  turnId(options.userTurnIdAtPrepare, "User turn id at prepare");
  return withRecoveryMutation(options, () => prepareCompactionFromCurrentCheckpointLocked(options));
}

function prepareCompactionFromCurrentCheckpointLocked({ root = ".", runtime = "manual", userTurnIdAtPrepare } = {}) {
  const inspected = readyProject(root, "compaction is prepared from the current recovery checkpoint");
  validateCompactionRuntime(runtime);
  if (!inspected.state.latestCheckpoint) {
    fail("A current canonical recovery checkpoint is required.", "SESSION_RESTORE_CHECKPOINT_REQUIRED");
  }
  const checkpoint = readRecoveryCheckpoint({
    root: inspected.project.projectRoot,
    checkpointId: inspected.state.latestCheckpoint,
  }).checkpoint;
  if (checkpoint.protocol?.version !== COMPACTION_RECOVERY_VERSION || !checkpoint.sessionPointer) {
    fail("Only a current checkpoint with the complete Session pointer can be reused.", "SESSION_RESTORE_CURRENT_CHECKPOINT_REQUIRED");
  }
  assertCurrentStateMatchesCheckpoint(inspectProject(inspected.project.projectRoot), checkpoint);
  return {
    ...createCompactionEpoch({ inspected, checkpoint, runtime, userTurnIdAtPrepare }),
    checkpointReused: true,
  };
}

export function verifyCompaction(options = {}) {
  turnId(options.currentUserTurnId, "Current user turn id");
  return withRecoveryMutation(options, () => verifyCompactionLocked(options));
}

function verifyCompactionLocked({ root = ".", epochId, checkpointDigest, currentUserTurnId, providerCompacted = false, recoverySource = "canonical-checkpoint" } = {}) {
  const inspected = readyProject(root, "compaction recovery is verified");
  const loaded = readEpoch(inspected.project.projectRoot, epochId);
  let epoch = maybeSupersede(inspected.project.projectRoot, loaded.file, loaded.epoch, currentUserTurnId);
  if (epoch.state === "superseded") fail("A newer real user turn superseded the pending continuation.", "COMPACTION_SUPERSEDED");
  if (recoverySource !== "canonical-checkpoint") fail("Recovery must use only the canonical Session/Run checkpoint.", "NON_CANONICAL_RECOVERY_SOURCE");
  if (epoch.state !== "prepared" && epoch.state !== "provider_compacted") fail(`Compaction cannot be verified from state ${epoch.state}.`, "INVALID_COMPACTION_STATE");
  if (!providerCompacted && epoch.state === "prepared") {
    writeEpoch(loaded.file, epoch, "aborted", { abortReason: "provider-compaction-failed", continuationTokenBindingHash: null });
    fail("Provider compaction did not succeed; a new prepare is required before retry.", "PROVIDER_COMPACTION_FAILED");
  }
  if (epoch.state === "prepared") epoch = writeEpoch(loaded.file, epoch, "provider_compacted", { providerCompactedAt: now() });
  if (checkpointDigest !== epoch.checkpointDigest) {
    writeEpoch(loaded.file, epoch, "aborted", { abortReason: "checkpoint-digest-mismatch", continuationTokenBindingHash: null });
    fail("Prepared checkpoint digest does not match the supplied digest.", "COMPACTION_DIGEST_MISMATCH");
  }
  let checkpoint;
  try {
    checkpoint = readRecoveryCheckpoint({ root: inspected.project.projectRoot, checkpointId: epoch.checkpointId }).checkpoint;
    assertCurrentStateMatchesCheckpoint(inspectProject(inspected.project.projectRoot), checkpoint);
  } catch (error) {
    writeEpoch(loaded.file, epoch, "aborted", { abortReason: error.code || "checkpoint-verification-failed", continuationTokenBindingHash: null });
    throw error;
  }
  epoch = writeEpoch(loaded.file, epoch, "verified", { verifiedAt: now() });
  const receipt = writeRecoveryReceipt(inspected.project.projectRoot, epoch, { verifiedDigest: checkpoint.checkpointDigest });
  return {
    status: "compaction_verified",
    epoch,
    checkpoint,
    recoveryReceipt: receipt.receipt,
    recoverySource: "canonical-session-run-checkpoint",
    excludedSources: ["provider-transcript", "provider-summary", "provider-session-identity", "HEADContinuitySnapshot"],
  };
}

export function continueCompaction(options = {}) {
  turnId(options.currentUserTurnId, "Current user turn id");
  return withRecoveryMutation(options, () => continueCompactionLocked(options));
}

function continueCompactionLocked({ root = ".", epochId, continuationToken, currentUserTurnId } = {}) {
  const inspected = readyProject(root, "compaction continuation is authorized");
  const loaded = readEpoch(inspected.project.projectRoot, epochId);
  let epoch = maybeSupersede(inspected.project.projectRoot, loaded.file, loaded.epoch, currentUserTurnId);
  if (epoch.state === "superseded") fail("A newer real user turn superseded the pending continuation.", "COMPACTION_SUPERSEDED");
  if (epoch.state === "continued" || fs.existsSync(consumptionFile(inspected.project.projectRoot, epochId))) {
    fail("Compaction continuation token was already consumed.", "COMPACTION_TOKEN_CONSUMED");
  }
  if (epoch.state !== "verified") fail(`Compaction continuation requires verified state; current state: ${epoch.state}.`, "COMPACTION_NOT_VERIFIED");
  const token = requiredText(continuationToken, "Continuation token");
  const bindingHash = digest(`${epochId}\n${epoch.checkpointDigest}\n${token}`);
  if (bindingHash !== epoch.continuationTokenBindingHash) fail("Continuation token does not match this epoch and checkpoint.", "INVALID_COMPACTION_TOKEN");
  const checkpoint = readRecoveryCheckpoint({ root: inspected.project.projectRoot, checkpointId: epoch.checkpointId }).checkpoint;
  if (checkpoint.checkpointDigest !== epoch.checkpointDigest || epoch.projectId !== inspected.project.projectId
    || epoch.sessionId !== inspected.state.sessionId || currentEpoch(inspected.project.projectRoot)?.epochId !== epoch.epochId) {
    fail("The continuation no longer matches the current Project, Session, epoch, and checkpoint.", "COMPACTION_CHECKPOINT_STALE");
  }
  assertCurrentStateMatchesCheckpoint(readyProject(inspected.project.projectRoot, "continuation is consumed"), checkpoint);
  const consumption = {
    schemaVersion: SCHEMA_VERSION,
    kind: "CompactionContinuationConsumption",
    epochId,
    checkpointId: epoch.checkpointId,
    checkpointDigest: epoch.checkpointDigest,
    consumedAt: now(),
    providerSessionIdentityPersisted: false,
  };
  const consumedFile = consumptionFile(inspected.project.projectRoot, epochId);
  fs.mkdirSync(path.dirname(consumedFile), { recursive: true });
  try { fs.writeFileSync(consumedFile, json(consumption), { encoding: "utf8", flag: "wx" }); }
  catch (error) {
    if (error.code === "EEXIST") fail("Compaction continuation token was already consumed.", "COMPACTION_TOKEN_CONSUMED");
    throw error;
  }
  epoch = writeEpoch(loaded.file, epoch, "continued", { continuedAt: now(), continuationTokenBindingHash: null });
  const receipt = writeRecoveryReceipt(inspected.project.projectRoot, epoch, {
    verifiedDigest: checkpoint.checkpointDigest,
    continuationSubmitted: true,
  });
  return {
    status: "compaction_continuation_consumed",
    epoch,
    checkpoint,
    recoveryReceipt: receipt.receipt,
    continuationInstruction: `Continue from checkpoint ${checkpoint.checkpointId} toward its exact nextExpectedResult without rewriting purpose or approved decisions.`,
    providerSubmission: "adapter-or-user-owned",
  };
}

export function abortCompaction(options = {}) {
  return withRecoveryMutation(options, () => abortCompactionLocked(options));
}

function abortCompactionLocked({ root = ".", epochId, reason = "explicit-abort" } = {}) {
  const inspected = readyProject(root, "compaction is aborted");
  const loaded = readEpoch(inspected.project.projectRoot, epochId);
  if (TERMINAL_STATES.has(loaded.epoch.state)) fail(`Compaction epoch is already terminal: ${loaded.epoch.state}.`, "COMPACTION_ALREADY_TERMINAL");
  const epoch = writeEpoch(loaded.file, loaded.epoch, "aborted", {
    abortReason: requiredText(reason, "Abort reason"),
    continuationTokenBindingHash: null,
  });
  return { status: "compaction_aborted", epoch };
}

export function inspectCompaction({ root = "." } = {}) {
  const inspected = readyProject(root, "compaction status is read");
  const epoch = currentEpoch(inspected.project.projectRoot);
  if (!epoch) return { status: "idle", sessionId: inspected.state.sessionId, recoveryAuthority: "session-run-checkpoint" };
  let checkpoint = null;
  let checkpointVerification = { status: "verified", code: null };
  try { checkpoint = readRecoveryCheckpoint({ root: inspected.project.projectRoot, checkpointId: epoch.checkpointId }).checkpoint; }
  catch (error) { checkpointVerification = { status: "failed", code: error.code || "COMPACTION_RECOVERY_ERROR" }; }
  return {
    status: epoch.state === "preparing" ? "interrupted-prepare" : OPEN_STATES.has(epoch.state) ? "open" : "terminal",
    epoch: { ...epoch, continuationTokenBindingHash: epoch.continuationTokenBindingHash ? "present-not-disclosed" : null },
    checkpoint,
    checkpointVerification,
    recoveryAuthority: "session-run-checkpoint",
    providerSessionIdentityPersisted: false,
  };
}
