import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { artifactAuthorityBoundary, verifyArtifactAuthorityBoundary } from "./authority-plane-contract.mjs";
import { inspectProject } from "./head-core.mjs";
import { inspectRuntimeExecutionLease } from "./runtime-execution-lease.mjs";
import { readRuntimeInvocationAuthorization } from "./runtime-invocation-lifecycle.mjs";
import { executeRuntimeInvocation } from "./runtime-one-shot-exec.mjs";
import { writeRuntimeInvocationArtifactExclusive } from "./runtime-invocation-record.mjs";
import { applyRuntimeRunResult, readRuntimeInvocationResult } from "./runtime-run-result-application.mjs";

export const BOUNDED_WORKER_DISPATCH_VERSION = "0.1.0";

const fail = (message, code = "BOUNDED_WORKER_DISPATCH_ERROR") => {
  const error = new Error(message);
  error.code = code;
  throw error;
};

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

const canonicalJson = (value) => JSON.stringify(canonical(value));
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
const pretty = (value) => `${JSON.stringify(value, null, 2)}\n`;

function ready(root, action) {
  const inspected = inspectProject(root);
  if (inspected.status !== "ready") fail(`Project must be ready before ${action}; current status: ${inspected.status}.`, "PROJECT_NOT_READY");
  return inspected;
}

function workerRole(inspected, value) {
  const role = String(value || "").trim().toLowerCase();
  if (role === "head" || !/^[a-z][a-z0-9-]{0,63}$/.test(role)) {
    fail("Bounded worker role must be one registered non-HEAD project role.", "INVALID_BOUNDED_WORKER_ROLE");
  }
  const rolesRoot = path.join(inspected.project.projectRoot, ".head", "roles");
  const file = path.join(rolesRoot, `${role}.md`);
  try {
    const rolesReal = fs.realpathSync(rolesRoot);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(path.dirname(file)) !== rolesReal) throw new Error("unsafe role");
  } catch {
    fail("Bounded worker role must be one registered non-HEAD project role.", "INVALID_BOUNDED_WORKER_ROLE");
  }
  return role;
}

function dispatchDirectory(root) {
  return path.join(root, ".head", "runtime", "worker-dispatches");
}

function dispatchFile(root, authorizationId) {
  if (!/^execution-authorization-[a-f0-9]{24}$/.test(authorizationId || "")) {
    fail("Bounded worker dispatch authorization id is invalid.", "INVALID_BOUNDED_WORKER_DISPATCH_ID");
  }
  return path.join(dispatchDirectory(root), `${authorizationId}.json`);
}

function identify(payload) {
  const dispatchHash = digest(canonicalJson(payload));
  return { ...payload, dispatchId: `bounded-worker-dispatch-${dispatchHash.slice(0, 24)}`, dispatchHash };
}

export function verifyBoundedWorkerDispatch(document) {
  const fields = [
    "schemaVersion", "kind", "protocol", "authorityBoundary", "projectId", "headSessionId", "authorizationId",
    "authorizationHash", "runtime", "workerRole", "runId", "wholePlanId", "executionContractId", "contextCapsuleId",
    "ownershipBoundary", "authority", "recoveryAuthority", "instructionAuthority", "reviewAuthority",
    "promotionAuthority", "mutatesCanon", "dispatchId", "dispatchHash",
  ];
  if (!document || typeof document !== "object" || Array.isArray(document)
    || canonicalJson(Object.keys(document).sort()) !== canonicalJson([...fields].sort())) {
    fail("BoundedWorkerDispatch fields are invalid.", "INVALID_BOUNDED_WORKER_DISPATCH");
  }
  verifyArtifactAuthorityBoundary("BoundedWorkerDispatch", document.authorityBoundary);
  const payload = { ...document };
  delete payload.dispatchId;
  delete payload.dispatchHash;
  const expected = identify(payload);
  const boundary = {
    wholeOutcomeOwner: "head",
    executionScopeOwner: "bounded-worker",
    authorizationConsumedAtMostOnce: true,
    waitStateOperationalOnly: true,
    resultAuthority: "evidence-only",
    reviewDecisionCreated: false,
    recoveryDirectionWritable: false,
  };
  if (document.schemaVersion !== 1 || document.kind !== "BoundedWorkerDispatch"
    || document.protocol?.name !== "head-agent-core-bounded-worker-dispatch"
    || document.protocol?.version !== BOUNDED_WORKER_DISPATCH_VERSION
    || !/^head-[a-f0-9]{20}$/.test(document.projectId || "")
    || !/^session-[A-Fa-f0-9-]{36}$/.test(document.headSessionId || "")
    || !/^execution-authorization-[a-f0-9]{24}$/.test(document.authorizationId || "")
    || !/^[a-f0-9]{64}$/.test(document.authorizationHash || "")
    || !new Set(["claude", "codex", "opencode"]).has(document.runtime)
    || document.workerRole === "head" || typeof document.workerRole !== "string" || !document.workerRole
    || !/^run-[0-9]+-[a-f0-9]{6}$/.test(document.runId || "")
    || !/^whole-plan-[a-f0-9]{24}$/.test(document.wholePlanId || "")
    || !/^execution-contract-[a-f0-9]{24}$/.test(document.executionContractId || "")
    || !/^capsule-[a-f0-9]{24}$/.test(document.contextCapsuleId || "")
    || canonicalJson(document.ownershipBoundary) !== canonicalJson(boundary)
    || document.authority !== "bounded-worker-scope-and-result-ownership-evidence"
    || document.recoveryAuthority !== false || document.instructionAuthority !== false
    || document.reviewAuthority !== false || document.promotionAuthority !== false || document.mutatesCanon !== false
    || document.dispatchId !== expected.dispatchId || document.dispatchHash !== expected.dispatchHash) {
    fail("BoundedWorkerDispatch violates the P3 ownership boundary.", "INVALID_BOUNDED_WORKER_DISPATCH");
  }
  return document;
}

function verifiedDispatchForAuthorization(inspected, authorizationId) {
  const file = dispatchFile(inspected.project.projectRoot, authorizationId);
  if (!fs.existsSync(file)) fail(`Bounded worker dispatch not found for ${authorizationId}.`, "BOUNDED_WORKER_DISPATCH_NOT_FOUND");
  let document;
  try { document = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { fail(`Bounded worker dispatch is invalid JSON: ${error.message}`, "INVALID_BOUNDED_WORKER_DISPATCH"); }
  const dispatch = verifyBoundedWorkerDispatch(document);
  workerRole(inspected, dispatch.workerRole);
  const authorization = readRuntimeInvocationAuthorization({ root: inspected.project.projectRoot, authorizationId }).authorization;
  if (dispatch.projectId !== inspected.project.projectId || dispatch.headSessionId !== inspected.state.sessionId
    || dispatch.authorizationHash !== authorization.authorizationHash || dispatch.runtime !== authorization.runtime
    || authorization.scope.kind !== "run" || dispatch.runId !== authorization.scope.runId
    || dispatch.wholePlanId !== authorization.scope.wholePlanId
    || dispatch.executionContractId !== authorization.scope.executionContractId
    || dispatch.contextCapsuleId !== authorization.scope.contextCapsuleId) {
    fail("Bounded worker dispatch conflicts with its exact Run authorization.", "BOUNDED_WORKER_DISPATCH_LINEAGE_CONFLICT");
  }
  return { file, dispatch, authorization };
}

export function createBoundedWorkerDispatch({ root = ".", authorizationId, role } = {}) {
  const inspected = ready(root, "a bounded worker is dispatched");
  const selectedRole = workerRole(inspected, role);
  const authorization = readRuntimeInvocationAuthorization({ root: inspected.project.projectRoot, authorizationId }).authorization;
  if (authorization.scope.kind !== "run" || inspected.state.activeRunId !== authorization.scope.runId
    || inspected.state.activeExecutionContractId !== authorization.scope.executionContractId) {
    fail("Bounded worker dispatch requires the exact current contract-bound Run authorization.", "BOUNDED_WORKER_DISPATCH_RUN_CONFLICT");
  }
  const dispatch = verifyBoundedWorkerDispatch(identify({
    schemaVersion: 1,
    kind: "BoundedWorkerDispatch",
    protocol: { name: "head-agent-core-bounded-worker-dispatch", version: BOUNDED_WORKER_DISPATCH_VERSION },
    authorityBoundary: artifactAuthorityBoundary("BoundedWorkerDispatch"),
    projectId: inspected.project.projectId,
    headSessionId: inspected.state.sessionId,
    authorizationId: authorization.authorizationId,
    authorizationHash: authorization.authorizationHash,
    runtime: authorization.runtime,
    workerRole: selectedRole,
    runId: authorization.scope.runId,
    wholePlanId: authorization.scope.wholePlanId,
    executionContractId: authorization.scope.executionContractId,
    contextCapsuleId: authorization.scope.contextCapsuleId,
    ownershipBoundary: {
      wholeOutcomeOwner: "head",
      executionScopeOwner: "bounded-worker",
      authorizationConsumedAtMostOnce: true,
      waitStateOperationalOnly: true,
      resultAuthority: "evidence-only",
      reviewDecisionCreated: false,
      recoveryDirectionWritable: false,
    },
    authority: "bounded-worker-scope-and-result-ownership-evidence",
    recoveryAuthority: false,
    instructionAuthority: false,
    reviewAuthority: false,
    promotionAuthority: false,
    mutatesCanon: false,
  }));
  const file = dispatchFile(inspected.project.projectRoot, authorization.authorizationId);
  try {
    writeRuntimeInvocationArtifactExclusive(file, pretty(dispatch));
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existing = verifiedDispatchForAuthorization(inspected, authorization.authorizationId).dispatch;
    if (existing.dispatchId !== dispatch.dispatchId) {
      fail("The authorization is already owned by another bounded worker dispatch.", "BOUNDED_WORKER_DISPATCH_OWNERSHIP_CONFLICT");
    }
    return { status: "existing", file, dispatch: existing };
  }
  return { status: "dispatched", file, dispatch };
}

export function readBoundedWorkerDispatch({ root = ".", authorizationId } = {}) {
  const inspected = ready(root, "a bounded worker dispatch is read");
  return { status: "verified", ...verifiedDispatchForAuthorization(inspected, authorizationId) };
}

function waitOutcome({ dispatch, leaseStatus, result, status, timedOut }) {
  const payload = {
    schemaVersion: 1,
    kind: "BoundedWorkerWaitOutcome",
    protocol: { name: "head-agent-core-bounded-worker-wait", version: BOUNDED_WORKER_DISPATCH_VERSION },
    authorityBoundary: artifactAuthorityBoundary("BoundedWorkerWaitOutcome"),
    projectId: dispatch.projectId,
    headSessionId: dispatch.headSessionId,
    dispatchId: dispatch.dispatchId,
    authorizationId: dispatch.authorizationId,
    status,
    leaseStatus,
    lifecycleReceiptId: result?.receipt?.receiptId || null,
    resultDraftId: result?.draft?.draftId || null,
    timedOut,
    persisted: false,
    recoveryAuthority: false,
    instructionAuthority: false,
    reviewAuthority: false,
    promotionAuthority: false,
    mutatesCanon: false,
  };
  const waitOutcomeHash = digest(canonicalJson(payload));
  return verifyBoundedWorkerWaitOutcome({
    ...payload,
    waitOutcomeId: `bounded-worker-wait-${waitOutcomeHash.slice(0, 24)}`,
    waitOutcomeHash,
  });
}

export function verifyBoundedWorkerWaitOutcome(document) {
  const fields = [
    "schemaVersion", "kind", "protocol", "authorityBoundary", "projectId", "headSessionId", "dispatchId",
    "authorizationId", "status", "leaseStatus", "lifecycleReceiptId", "resultDraftId", "timedOut", "persisted",
    "recoveryAuthority", "instructionAuthority", "reviewAuthority", "promotionAuthority", "mutatesCanon",
    "waitOutcomeId", "waitOutcomeHash",
  ];
  if (!document || typeof document !== "object" || Array.isArray(document)
    || canonicalJson(Object.keys(document).sort()) !== canonicalJson([...fields].sort())) {
    fail("BoundedWorkerWaitOutcome fields are invalid.", "INVALID_BOUNDED_WORKER_WAIT_OUTCOME");
  }
  verifyArtifactAuthorityBoundary("BoundedWorkerWaitOutcome", document?.authorityBoundary);
  const payload = { ...document };
  const id = payload.waitOutcomeId;
  const hash = payload.waitOutcomeHash;
  delete payload.waitOutcomeId;
  delete payload.waitOutcomeHash;
  const expectedHash = digest(canonicalJson(payload));
  if (document.schemaVersion !== 1 || document.kind !== "BoundedWorkerWaitOutcome"
    || document.protocol?.name !== "head-agent-core-bounded-worker-wait"
    || document.protocol?.version !== BOUNDED_WORKER_DISPATCH_VERSION
    || !/^head-[a-f0-9]{20}$/.test(document.projectId || "")
    || !/^session-[A-Fa-f0-9-]{36}$/.test(document.headSessionId || "")
    || !/^bounded-worker-dispatch-[a-f0-9]{24}$/.test(document.dispatchId || "")
    || !/^execution-authorization-[a-f0-9]{24}$/.test(document.authorizationId || "")
    || !new Set(["pending", "active", "completed", "failed", "timed-out"]).has(document.status)
    || typeof document.leaseStatus !== "string" || !document.leaseStatus
    || document.timedOut !== (document.status === "timed-out")
    || document.status === "completed" && (!/^runtime-lifecycle-receipt-[a-f0-9]{24}$/.test(document.lifecycleReceiptId || "")
      || !/^runtime-result-draft-[a-f0-9]{24}$/.test(document.resultDraftId || ""))
    || document.status !== "completed" && (document.lifecycleReceiptId !== null || document.resultDraftId !== null)
    || document.persisted !== false || document.recoveryAuthority !== false || document.instructionAuthority !== false
    || document.reviewAuthority !== false || document.promotionAuthority !== false || document.mutatesCanon !== false
    || hash !== expectedHash || id !== `bounded-worker-wait-${expectedHash.slice(0, 24)}`) {
    fail("BoundedWorkerWaitOutcome violates the P5 wait boundary.", "INVALID_BOUNDED_WORKER_WAIT_OUTCOME");
  }
  return document;
}

function currentResult(root, authorizationId) {
  try { return readRuntimeInvocationResult({ root, authorizationId }); }
  catch (error) {
    if (error.code === "RUNTIME_INVOCATION_RESULT_NOT_FOUND") return null;
    throw error;
  }
}

export async function waitForBoundedWorkerDispatch({
  root = ".", authorizationId, timeoutMs = 0, pollIntervalMs = 100, signal = null,
} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 600_000
    || !Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 10 || pollIntervalMs > 5_000) {
    fail("Bounded worker wait limits are invalid.", "INVALID_BOUNDED_WORKER_WAIT");
  }
  const inspected = ready(root, "a bounded worker dispatch is awaited");
  const { dispatch, authorization } = verifiedDispatchForAuthorization(inspected, authorizationId);
  const started = Date.now();
  while (true) {
    if (signal?.aborted) fail("Bounded worker wait was aborted.", "BOUNDED_WORKER_WAIT_ABORTED");
    const result = currentResult(root, authorization.authorizationId);
    const lease = inspectRuntimeExecutionLease({
      projectRoot: inspected.project.projectRoot,
      projectId: authorization.projectId,
      authorizationId: authorization.authorizationId,
    });
    if (result) {
      const status = result.receipt.status === "completed" ? "completed" : "failed";
      return { status: `bounded_worker_${status}`, dispatch, result, waitOutcome: waitOutcome({ dispatch, leaseStatus: lease.status, result: status === "completed" ? result : null, status, timedOut: false }) };
    }
    if (Date.now() - started >= timeoutMs) {
      const status = timeoutMs > 0 ? "timed-out" : lease.status === "claimed" || lease.status === "consumed-active" ? "active" : "pending";
      return { status: `bounded_worker_${status}`, dispatch, result: null, waitOutcome: waitOutcome({ dispatch, leaseStatus: lease.status, result: null, status, timedOut: status === "timed-out" }) };
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, timeoutMs - (Date.now() - started))));
  }
}

export async function executeBoundedWorkerDispatch({ root = ".", authorizationId, role, execution = {} } = {}) {
  const created = createBoundedWorkerDispatch({ root, authorizationId, role });
  const { authorization } = readBoundedWorkerDispatch({ root, authorizationId });
  const result = await executeRuntimeInvocation({ ...execution, root, authorization, persist: true });
  return { status: "bounded_worker_execution_completed", dispatch: created.dispatch, result };
}

export function applyBoundedWorkerDispatchResult({ root = ".", authorizationId } = {}) {
  const { dispatch } = readBoundedWorkerDispatch({ root, authorizationId });
  const applied = applyRuntimeRunResult({ root, authorizationId });
  return { status: "bounded_worker_result_applied_for_fresh_head_review", dispatch, applied };
}
