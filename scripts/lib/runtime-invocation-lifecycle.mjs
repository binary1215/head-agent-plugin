import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { inspectProject, SCHEMA_VERSION } from "./head-core.mjs";
import { readContextCapsule } from "./context-compiler.mjs";
import { readLineageArtifact } from "./execution-lineage.mjs";
import {
  verifyRuntimeProjectBinding,
  verifyRuntimeProtocolEvidence,
} from "./runtime-protocol-evidence.mjs";

export const RUNTIME_INVOCATION_AUTHORIZATION_VERSION = "0.1.0";
export const RUNTIME_EVENT_ENVELOPE_VERSION = "0.1.0";
export const RUNTIME_LIFECYCLE_RECEIPT_VERSION = "0.1.0";
export const RUNTIME_RESULT_DRAFT_VERSION = "0.1.0";

const RUNTIMES = Object.freeze(["codex", "opencode"]);
const WORKSPACE_MODES = Object.freeze(["read-only", "workspace-write"]);
const REQUIRED_INVOKE_ACTION = "runtime.invoke";
const WORKSPACE_ACTION = Object.freeze({
  "read-only": "project.read",
  "workspace-write": "project.write",
});
const DEFAULT_LIMITS = Object.freeze({
  timeoutMs: 60_000,
  terminationGraceMs: 1_000,
  maxInputBytes: 2 * 1024 * 1024,
  maxStdoutBytes: 4 * 1024 * 1024,
  maxStderrBytes: 256 * 1024,
  maxEvents: 4_096,
  maxEventBytes: 128 * 1024,
});

const fail = (message, code = "RUNTIME_INVOCATION_LIFECYCLE_ERROR") => {
  const error = new Error(message);
  error.code = code;
  throw error;
};

const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort(compareText).map((key) => [key, canonicalValue(value[key])]));
  }
  return value;
}

const canonicalJson = (value) => JSON.stringify(canonicalValue(value));
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function identify(payload, prefix, idKey, hashKey) {
  const hash = digest(canonicalJson(payload));
  return { ...payload, [idKey]: `${prefix}-${hash.slice(0, 24)}`, [hashKey]: hash };
}

function verifyIdentity(document, { prefix, idKey, hashKey, code }) {
  const payload = { ...document };
  delete payload[idKey];
  delete payload[hashKey];
  const hash = digest(canonicalJson(payload));
  if (document[hashKey] !== hash || document[idKey] !== `${prefix}-${hash.slice(0, 24)}`) {
    fail("Runtime invocation artifact digest verification failed.", code);
  }
}

function assertFields(value, fields, label, code = "INVALID_RUNTIME_INVOCATION_ARTIFACT") {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} is invalid.`, code);
  const expected = new Set(fields);
  if (Object.keys(value).some((field) => !expected.has(field)) || fields.some((field) => !(field in value))) {
    fail(`${label} fields are invalid.`, code);
  }
}

function requiredText(value, label, code = "INVALID_RUNTIME_INVOCATION_INPUT") {
  if (typeof value !== "string" || !value.trim()) fail(`${label} is required.`, code);
  return value.trim();
}

function normalizeRuntime(value) {
  const runtime = String(value || "").trim().toLowerCase();
  if (!RUNTIMES.includes(runtime)) fail(`Unsupported runtime: ${runtime || "(empty)"}.`, "UNSUPPORTED_RUNTIME_INVOCATION");
  return runtime;
}

function normalizeWorkspaceMode(value) {
  const mode = String(value || "read-only").trim().toLowerCase();
  if (!WORKSPACE_MODES.includes(mode)) fail(`Unsupported workspace mode: ${mode || "(empty)"}.`, "INVALID_RUNTIME_WORKSPACE_MODE");
  return mode;
}

function normalizeLimits(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Invocation limits must be an object.", "INVALID_RUNTIME_INVOCATION_LIMITS");
  const unexpected = Object.keys(value).filter((key) => !(key in DEFAULT_LIMITS));
  if (unexpected.length) fail(`Invocation limits contain unsupported fields: ${unexpected.sort().join(", ")}.`, "INVALID_RUNTIME_INVOCATION_LIMITS");
  const limits = { ...DEFAULT_LIMITS, ...value };
  const ranges = {
    timeoutMs: [1_000, 3_600_000],
    terminationGraceMs: [100, 10_000],
    maxInputBytes: [1_024, 8 * 1024 * 1024],
    maxStdoutBytes: [1_024, 16 * 1024 * 1024],
    maxStderrBytes: [1_024, 2 * 1024 * 1024],
    maxEvents: [1, 16_384],
    maxEventBytes: [256, 1024 * 1024],
  };
  for (const [key, [minimum, maximum]] of Object.entries(ranges)) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < minimum || limits[key] > maximum) {
      fail(`${key} must be an integer from ${minimum} through ${maximum}.`, "INVALID_RUNTIME_INVOCATION_LIMITS");
    }
  }
  if (limits.maxEventBytes > limits.maxStdoutBytes) {
    fail("maxEventBytes cannot exceed maxStdoutBytes.", "INVALID_RUNTIME_INVOCATION_LIMITS");
  }
  return limits;
}

function realRoot(root) {
  return fs.realpathSync(path.resolve(root));
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
  catch (error) { fail(`${label} is invalid JSON: ${error.message}`, "INVALID_RUNTIME_INVOCATION_ARTIFACT"); }
}

function runCanon(projectRoot, runId) {
  const file = path.join(projectRoot, ".head", "sessions", "runs", runId, "run.json");
  if (!fs.existsSync(file)) fail(`Active Run canon is missing: ${runId}.`, "RUNTIME_INVOCATION_RUN_MISSING");
  const run = readJson(file, "Run canon");
  if (run.runId !== runId || run.status !== "active") fail("Runtime invocation requires the exact active Run canon.", "RUNTIME_INVOCATION_RUN_NOT_ACTIVE");
  return run;
}

function lineage(root, artifactId, kind) {
  const artifact = readLineageArtifact({ root, artifactId }).artifact;
  if (artifact.kind !== kind) fail(`Expected ${kind}: ${artifactId}.`, "RUNTIME_INVOCATION_LINEAGE_KIND_MISMATCH");
  return artifact;
}

function invocationInput({ plan, contract, capsule }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "RuntimeExecutionInput",
    protocolVersion: RUNTIME_INVOCATION_AUTHORIZATION_VERSION,
    wholePlan: {
      wholePlanId: plan.wholePlanId,
      objective: plan.objective,
      plan: plan.plan,
      generation: plan.generation,
      invariants: plan.invariants,
    },
    executionContract: {
      executionContractId: contract.executionContractId,
      scope: contract.scope,
      acceptanceCriteria: contract.acceptanceCriteria,
      constraints: contract.constraints,
      allowedActions: contract.allowedActions,
      forbiddenActions: contract.forbiddenActions,
    },
    contextCapsule: capsule,
    returnContract: {
      kind: "ResultPacketDraft",
      requiredSections: ["outcome", "evidence", "planDelta", "impactRadius", "verification", "unknowns"],
      transcriptIsNotResultPacket: true,
      evidenceInstructionAuthority: false,
    },
  };
}

function authorizationFile(root, authorizationId) {
  return path.join(root, ".head", "runtime", "invocation-authorizations", `${authorizationId}.json`);
}

export function buildRuntimeInvocationAuthorization({
  root = ".",
  runtime,
  workspaceMode = "read-only",
  protocolEvidence,
  projectBinding,
  limits = {},
  persist = true,
} = {}) {
  const inspected = inspectProject(root);
  if (inspected.status !== "ready") fail(`Project must be ready for runtime invocation authorization; current status: ${inspected.status}.`, "PROJECT_NOT_READY");
  const selectedRuntime = normalizeRuntime(runtime);
  const selectedWorkspaceMode = normalizeWorkspaceMode(workspaceMode);
  if (!inspected.project.runtimes.includes(selectedRuntime)) fail("Runtime is not enabled for this HEAD project.", "RUNTIME_NOT_ENABLED_FOR_PROJECT");
  if (!inspected.state.activeRunId || !inspected.state.activeExecutionContractId) {
    fail("Runtime invocation authorization requires an active contract-bound Run.", "ACTIVE_CONTRACT_BOUND_RUN_REQUIRED");
  }
  const projectRoot = inspected.project.projectRoot;
  const run = runCanon(projectRoot, inspected.state.activeRunId);
  const contract = lineage(projectRoot, inspected.state.activeExecutionContractId, "ExecutionContract");
  const plan = lineage(projectRoot, contract.wholePlanId, "WholePlanSnapshot");
  const capsule = readContextCapsule({ root: projectRoot, capsuleId: contract.capsuleId }).capsule;
  if (run.executionContractId !== contract.executionContractId || run.wholePlanId !== plan.wholePlanId || run.capsuleId !== capsule.capsuleId) {
    fail("Active Run, ExecutionContract, WholePlanSnapshot, and ContextCapsule do not compose.", "RUNTIME_INVOCATION_LINEAGE_CONFLICT");
  }
  const allowed = new Set(contract.allowedActions || []);
  const forbidden = new Set(contract.forbiddenActions || []);
  const requiredActions = [REQUIRED_INVOKE_ACTION, WORKSPACE_ACTION[selectedWorkspaceMode]];
  if (requiredActions.some((action) => !allowed.has(action)) || requiredActions.some((action) => forbidden.has(action))) {
    fail(`ExecutionContract must allow ${requiredActions.join(" and ")} and must not forbid either action.`, "RUNTIME_INVOCATION_NOT_AUTHORIZED");
  }
  const verifiedProtocol = verifyRuntimeProtocolEvidence(protocolEvidence);
  const verifiedBinding = verifyRuntimeProjectBinding(projectBinding);
  const runtimeObservation = verifiedProtocol.observations.find((item) => item.runtime === selectedRuntime);
  const runtimeBinding = verifiedBinding.bindings.find((item) => item.runtime === selectedRuntime);
  const rootDigest = digest(realRoot(projectRoot));
  if (verifiedBinding.projectId !== inspected.project.projectId
    || verifiedBinding.headSessionId !== inspected.state.sessionId
    || verifiedBinding.projectRootDigest !== rootDigest
    || verifiedBinding.protocolEvidenceId !== verifiedProtocol.evidenceId
    || verifiedBinding.status !== "verified-head-project-session-capability-binding"
    || runtimeBinding?.capabilityStatus !== "observed"
    || !runtimeObservation?.protocolNegotiationObserved) {
    fail("Runtime capability evidence is not an exact verified binding for this project, Session, and runtime.", "RUNTIME_INVOCATION_CAPABILITY_BINDING_INVALID");
  }
  const normalizedLimits = normalizeLimits(limits);
  const input = invocationInput({ plan, contract, capsule });
  const inputBytes = Buffer.byteLength(canonicalJson(input));
  if (inputBytes > normalizedLimits.maxInputBytes) fail("Runtime execution input exceeds the accepted input bound.", "RUNTIME_INVOCATION_INPUT_LIMIT");
  const payload = {
    schemaVersion: 1,
    kind: "RuntimeInvocationAuthorization",
    protocolVersion: RUNTIME_INVOCATION_AUTHORIZATION_VERSION,
    projectId: inspected.project.projectId,
    headSessionId: inspected.state.sessionId,
    runId: run.runId,
    wholePlanId: plan.wholePlanId,
    executionContractId: contract.executionContractId,
    contextCapsuleId: capsule.capsuleId,
    runtime: selectedRuntime,
    workspaceMode: selectedWorkspaceMode,
    requiredAllowedActions: requiredActions,
    projectRootDigest: rootDigest,
    runtimeProjectBindingId: verifiedBinding.bindingId,
    runtimeProtocolEvidenceId: verifiedProtocol.evidenceId,
    runtimeProtocolObservationId: runtimeObservation.observationId,
    executionInput: {
      digest: digest(canonicalJson(input)),
      bytes: inputBytes,
      transport: "bounded-stdin-required",
      retention: "ephemeral-only",
      includesContextCapsule: true,
      rawContentPersisted: false,
    },
    limits: normalizedLimits,
    authorizationBoundary: {
      acceptedContractDerived: true,
      exactActiveRunRequired: true,
      projectFenceRequired: true,
      callerFenceRequiredAtExecution: true,
      exactChildOwnershipRequired: true,
      descendantTreeOwnershipRequiredForProviderControl: true,
      providerEventValidationRequired: true,
      resultPacketDraftRequired: true,
      capabilityDoesNotGrantAuthorization: true,
      singleInvocationExecutionLeaseRequired: true,
      executionLeaseActivated: false,
      providerControlEnabled: false,
    },
    authority: "execution-contract-bounded-single-invocation-authorization",
    instructionAuthority: false,
    promotionAuthority: false,
    mutatesCanon: false,
  };
  const authorization = verifyRuntimeInvocationAuthorization(identify(
    payload,
    "runtime-invocation-authorization",
    "authorizationId",
    "authorizationHash",
  ));
  if (!persist) return { status: "preview", authorization };
  const file = authorizationFile(projectRoot, authorization.authorizationId);
  if (fs.existsSync(file)) {
    return { status: "existing", file, authorization: readRuntimeInvocationAuthorization({ root: projectRoot, authorizationId: authorization.authorizationId }).authorization };
  }
  atomicWrite(file, json(authorization));
  return { status: "recorded", file, authorization };
}

export function verifyRuntimeInvocationAuthorization(document) {
  assertFields(document, [
    "schemaVersion", "kind", "protocolVersion", "projectId", "headSessionId", "runId", "wholePlanId",
    "executionContractId", "contextCapsuleId", "runtime", "workspaceMode", "requiredAllowedActions",
    "projectRootDigest", "runtimeProjectBindingId", "runtimeProtocolEvidenceId", "runtimeProtocolObservationId",
    "executionInput", "limits", "authorizationBoundary", "authority", "instructionAuthority", "promotionAuthority",
    "mutatesCanon", "authorizationId", "authorizationHash",
  ], "Runtime invocation authorization");
  assertFields(document.executionInput, [
    "digest", "bytes", "transport", "retention", "includesContextCapsule", "rawContentPersisted",
  ], "Runtime invocation execution input");
  assertFields(document.authorizationBoundary, [
    "acceptedContractDerived", "exactActiveRunRequired", "projectFenceRequired", "callerFenceRequiredAtExecution",
    "exactChildOwnershipRequired", "descendantTreeOwnershipRequiredForProviderControl", "providerEventValidationRequired",
    "resultPacketDraftRequired", "capabilityDoesNotGrantAuthorization", "singleInvocationExecutionLeaseRequired",
    "executionLeaseActivated", "providerControlEnabled",
  ], "Runtime invocation authorization boundary");
  const runtime = normalizeRuntime(document.runtime);
  const workspaceMode = normalizeWorkspaceMode(document.workspaceMode);
  const expectedActions = [REQUIRED_INVOKE_ACTION, WORKSPACE_ACTION[workspaceMode]];
  const expectedBoundary = {
    acceptedContractDerived: true,
    exactActiveRunRequired: true,
    projectFenceRequired: true,
    callerFenceRequiredAtExecution: true,
    exactChildOwnershipRequired: true,
    descendantTreeOwnershipRequiredForProviderControl: true,
    providerEventValidationRequired: true,
    resultPacketDraftRequired: true,
    capabilityDoesNotGrantAuthorization: true,
    singleInvocationExecutionLeaseRequired: true,
    executionLeaseActivated: false,
    providerControlEnabled: false,
  };
  if (document.schemaVersion !== 1 || document.kind !== "RuntimeInvocationAuthorization"
    || document.protocolVersion !== RUNTIME_INVOCATION_AUTHORIZATION_VERSION || document.runtime !== runtime
    || document.workspaceMode !== workspaceMode || canonicalJson(document.requiredAllowedActions) !== canonicalJson(expectedActions)
    || !/^head-[a-f0-9]{20}$/.test(document.projectId || "")
    || !/^session-[A-Fa-f0-9-]{36}$/.test(document.headSessionId || "")
    || !/^run-[0-9]+-[a-f0-9]{6}$/.test(document.runId || "")
    || !/^whole-plan-[a-f0-9]{24}$/.test(document.wholePlanId || "")
    || !/^execution-contract-[a-f0-9]{24}$/.test(document.executionContractId || "")
    || !/^capsule-[a-f0-9]{24}$/.test(document.contextCapsuleId || "")
    || !/^[a-f0-9]{64}$/.test(document.projectRootDigest || "")
    || !/^runtime-project-binding-[a-f0-9]{24}$/.test(document.runtimeProjectBindingId || "")
    || !/^runtime-protocol-evidence-[a-f0-9]{24}$/.test(document.runtimeProtocolEvidenceId || "")
    || !/^runtime-protocol-observation-[a-f0-9]{24}$/.test(document.runtimeProtocolObservationId || "")
    || !/^[a-f0-9]{64}$/.test(document.executionInput.digest || "")
    || !Number.isSafeInteger(document.executionInput.bytes) || document.executionInput.bytes < 1
    || document.executionInput.transport !== "bounded-stdin-required"
    || document.executionInput.retention !== "ephemeral-only"
    || document.executionInput.includesContextCapsule !== true || document.executionInput.rawContentPersisted !== false
    || canonicalJson(document.limits) !== canonicalJson(normalizeLimits(document.limits))
    || canonicalJson(document.authorizationBoundary) !== canonicalJson(expectedBoundary)
    || document.authority !== "execution-contract-bounded-single-invocation-authorization"
    || document.instructionAuthority !== false || document.promotionAuthority !== false || document.mutatesCanon !== false) {
    fail("Runtime invocation authorization is invalid.", "INVALID_RUNTIME_INVOCATION_AUTHORIZATION");
  }
  verifyIdentity(document, {
    prefix: "runtime-invocation-authorization",
    idKey: "authorizationId",
    hashKey: "authorizationHash",
    code: "RUNTIME_INVOCATION_AUTHORIZATION_DIGEST_MISMATCH",
  });
  return document;
}

export function readRuntimeInvocationAuthorization({ root = ".", authorizationId } = {}) {
  if (!/^runtime-invocation-authorization-[a-f0-9]{24}$/.test(authorizationId || "")) {
    fail("Runtime invocation authorization id is invalid.", "INVALID_RUNTIME_INVOCATION_AUTHORIZATION_ID");
  }
  const inspected = inspectProject(root);
  if (inspected.status === "not_initialized") fail("HEAD Agent Core is not initialized.", "NOT_INITIALIZED");
  const file = authorizationFile(inspected.project.projectRoot, authorizationId);
  if (!fs.existsSync(file)) fail(`Runtime invocation authorization not found: ${authorizationId}.`, "RUNTIME_INVOCATION_AUTHORIZATION_NOT_FOUND");
  const authorization = verifyRuntimeInvocationAuthorization(readJson(file, "Runtime invocation authorization"));
  if (authorization.projectId !== inspected.project.projectId) fail("Runtime invocation authorization belongs to another project.", "RUNTIME_INVOCATION_PROJECT_MISMATCH");
  return { status: "verified", file, authorization };
}

function eventType(record) {
  for (const key of ["type", "eventType", "kind"]) {
    if (typeof record[key] === "string" && record[key].trim()) return record[key].trim().slice(0, 128);
  }
  return "unknown";
}

function eventClass(type) {
  const value = type.toLowerCase();
  if (/error|fail/.test(value)) return "error";
  if (/assistant|message|output|text/.test(value)) return "assistant-output";
  if (/tool|command|file|patch|edit/.test(value)) return "tool-observation";
  if (/usage|metric|token/.test(value)) return "usage";
  if (/session|thread|turn|start|complete|finish|close/.test(value)) return "lifecycle";
  return "unknown";
}

function sessionReferences(record) {
  const found = [];
  const visit = (value, depth = 0) => {
    if (!value || depth > 4) return;
    if (Array.isArray(value)) return value.slice(0, 64).forEach((item) => visit(item, depth + 1));
    if (typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (["thread_id", "session_id", "sessionid", "threadid"].includes(key.toLowerCase())
        && typeof item === "string" && item.trim()) found.push(item.trim());
      else visit(item, depth + 1);
    }
  };
  visit(record);
  return [...new Set(found)].sort(compareText);
}

export function normalizeRuntimeEvent({ authorization, sequence, line } = {}) {
  const verified = verifyRuntimeInvocationAuthorization(authorization);
  if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence >= verified.limits.maxEvents) {
    fail("Runtime event sequence exceeds the authorization bound.", "RUNTIME_EVENT_LIMIT");
  }
  if (typeof line !== "string" || !line.trim()) fail("Runtime event line is empty.", "INVALID_RUNTIME_EVENT");
  const bytes = Buffer.byteLength(line);
  if (bytes > verified.limits.maxEventBytes) fail("Runtime event exceeds the per-event bound.", "RUNTIME_EVENT_OUTPUT_LIMIT");
  let record;
  try { record = JSON.parse(line); }
  catch { fail("Runtime emitted non-JSON event output.", "INVALID_RUNTIME_EVENT_JSON"); }
  if (!record || typeof record !== "object" || Array.isArray(record)) fail("Runtime event must be one JSON object.", "INVALID_RUNTIME_EVENT");
  const canonical = canonicalJson(record);
  const type = eventType(record);
  const references = sessionReferences(record).map((value) => digest(`${verified.authorizationId}\n${value}`));
  const payload = {
    schemaVersion: 1,
    kind: "RuntimeEventEnvelope",
    protocolVersion: RUNTIME_EVENT_ENVELOPE_VERSION,
    authorizationId: verified.authorizationId,
    runtime: verified.runtime,
    sequence,
    eventType: type,
    eventClass: eventClass(type),
    payloadDigest: digest(canonical),
    payloadBytes: Buffer.byteLength(canonical),
    providerSessionReferenceDigests: references,
    rawPayloadPersisted: false,
    transcriptAuthority: "none",
    instructionAuthority: false,
    promotionAuthority: false,
  };
  return verifyRuntimeEventEnvelope(identify(payload, "runtime-event", "eventId", "eventHash"));
}

export function verifyRuntimeEventEnvelope(document) {
  assertFields(document, [
    "schemaVersion", "kind", "protocolVersion", "authorizationId", "runtime", "sequence", "eventType",
    "eventClass", "payloadDigest", "payloadBytes", "providerSessionReferenceDigests", "rawPayloadPersisted",
    "transcriptAuthority", "instructionAuthority", "promotionAuthority", "eventId", "eventHash",
  ], "Runtime event envelope");
  const allowedClasses = new Set(["error", "lifecycle", "assistant-output", "tool-observation", "usage", "unknown"]);
  if (document.schemaVersion !== 1 || document.kind !== "RuntimeEventEnvelope"
    || document.protocolVersion !== RUNTIME_EVENT_ENVELOPE_VERSION
    || !/^runtime-invocation-authorization-[a-f0-9]{24}$/.test(document.authorizationId || "")
    || document.runtime !== normalizeRuntime(document.runtime)
    || !Number.isSafeInteger(document.sequence) || document.sequence < 0
    || typeof document.eventType !== "string" || !document.eventType || document.eventType.length > 128
    || !allowedClasses.has(document.eventClass) || document.eventClass !== eventClass(document.eventType)
    || !/^[a-f0-9]{64}$/.test(document.payloadDigest || "")
    || !Number.isSafeInteger(document.payloadBytes) || document.payloadBytes < 2
    || !Array.isArray(document.providerSessionReferenceDigests)
    || canonicalJson(document.providerSessionReferenceDigests) !== canonicalJson([...new Set(document.providerSessionReferenceDigests)].sort(compareText))
    || document.providerSessionReferenceDigests.some((item) => !/^[a-f0-9]{64}$/.test(item))
    || document.rawPayloadPersisted !== false || document.transcriptAuthority !== "none"
    || document.instructionAuthority !== false || document.promotionAuthority !== false) {
    fail("Runtime event envelope is invalid.", "INVALID_RUNTIME_EVENT_ENVELOPE");
  }
  verifyIdentity(document, { prefix: "runtime-event", idKey: "eventId", hashKey: "eventHash", code: "RUNTIME_EVENT_DIGEST_MISMATCH" });
  return document;
}

function lifecycleSummary({ authorization, events, status, exitCode, signal, stdoutBytes, stderrBytes, stdoutDigest, stderrDigest,
  callerFenceDigest, childFenceDigest, childStarted, childExitObserved, terminationRequested, projectFenceValidated,
  inputDigestObserved, noDescendantFixture }) {
  const eventIds = events.map((item) => item.eventId);
  const eventTypes = [...new Set(events.map((item) => item.eventType))].sort(compareText);
  const unknownEventTypes = [...new Set(events.filter((item) => item.eventClass === "unknown").map((item) => item.eventType))].sort(compareText);
  const providerSessionReferenceDigests = [...new Set(events.flatMap((item) => item.providerSessionReferenceDigests))].sort(compareText);
  return {
    schemaVersion: 1,
    kind: "RuntimeInvocationLifecycleReceipt",
    protocolVersion: RUNTIME_LIFECYCLE_RECEIPT_VERSION,
    authorizationId: authorization.authorizationId,
    projectId: authorization.projectId,
    headSessionId: authorization.headSessionId,
    runId: authorization.runId,
    executionContractId: authorization.executionContractId,
    runtime: authorization.runtime,
    status,
    exitCode,
    signal,
    eventIds,
    eventTypes,
    unknownEventTypes,
    providerSessionReferenceDigests,
    eventCount: eventIds.length,
    stdoutBytes,
    stderrBytes,
    stdoutDigest,
    stderrDigest,
    inputDigestObserved,
    processBoundary: {
      callerFenceDigest,
      childFenceDigest,
      exactChildStarted: childStarted,
      exactChildExitObserved: childExitObserved,
      terminationRequested,
      projectFenceValidated,
      shellInterpretation: false,
      rawCommandPersisted: false,
      rawOutputPersisted: false,
      childPidPersisted: false,
      noDescendantFixture,
      descendantTreeOwnershipValidated: noDescendantFixture && childStarted && childExitObserved,
    },
    providerBoundary: {
      conformanceFixtureOnly: true,
      actualProviderInvoked: false,
      actualProviderSessionCreated: false,
      providerControlEnabled: false,
      lifecycleConformanceEvidenceOnly: true,
    },
    authority: "execution-evidence-not-canon",
    instructionAuthority: false,
    promotionAuthority: false,
    mutatesCanon: false,
  };
}

export function verifyRuntimeInvocationLifecycleReceipt(document) {
  assertFields(document, [
    "schemaVersion", "kind", "protocolVersion", "authorizationId", "projectId", "headSessionId", "runId",
    "executionContractId", "runtime", "status", "exitCode", "signal", "eventIds", "eventTypes",
    "unknownEventTypes", "providerSessionReferenceDigests", "eventCount", "stdoutBytes", "stderrBytes",
    "stdoutDigest", "stderrDigest", "inputDigestObserved", "processBoundary", "providerBoundary", "authority",
    "instructionAuthority", "promotionAuthority", "mutatesCanon", "receiptId", "receiptHash",
  ], "Runtime invocation lifecycle receipt");
  assertFields(document.processBoundary, [
    "callerFenceDigest", "childFenceDigest", "exactChildStarted", "exactChildExitObserved", "terminationRequested",
    "projectFenceValidated", "shellInterpretation", "rawCommandPersisted", "rawOutputPersisted", "childPidPersisted",
    "noDescendantFixture", "descendantTreeOwnershipValidated",
  ], "Runtime invocation process boundary");
  assertFields(document.providerBoundary, [
    "conformanceFixtureOnly", "actualProviderInvoked", "actualProviderSessionCreated", "providerControlEnabled",
    "lifecycleConformanceEvidenceOnly",
  ], "Runtime invocation provider boundary");
  const statuses = new Set(["completed", "failed", "cancelled", "timed-out", "output-limited", "invalid-event"]);
  const sortedUnique = (items) => Array.isArray(items) && canonicalJson(items) === canonicalJson([...new Set(items)].sort(compareText));
  const completed = document.status === "completed";
  const terminated = new Set(["cancelled", "timed-out", "output-limited", "invalid-event"]).has(document.status);
  if (document.schemaVersion !== 1 || document.kind !== "RuntimeInvocationLifecycleReceipt"
    || document.protocolVersion !== RUNTIME_LIFECYCLE_RECEIPT_VERSION || !statuses.has(document.status)
    || document.runtime !== normalizeRuntime(document.runtime)
    || !/^runtime-invocation-authorization-[a-f0-9]{24}$/.test(document.authorizationId || "")
    || !/^head-[a-f0-9]{20}$/.test(document.projectId || "")
    || !/^session-[A-Fa-f0-9-]{36}$/.test(document.headSessionId || "")
    || !/^run-[0-9]+-[a-f0-9]{6}$/.test(document.runId || "")
    || !/^execution-contract-[a-f0-9]{24}$/.test(document.executionContractId || "")
    || !Number.isInteger(document.exitCode) && document.exitCode !== null
    || typeof document.signal !== "string" || document.signal.length > 32
    || !sortedUnique(document.eventIds) || document.eventIds.some((item) => !/^runtime-event-[a-f0-9]{24}$/.test(item))
    || !sortedUnique(document.eventTypes) || !sortedUnique(document.unknownEventTypes) || !sortedUnique(document.providerSessionReferenceDigests)
    || document.eventCount !== document.eventIds.length
    || !Number.isSafeInteger(document.stdoutBytes) || document.stdoutBytes < 0
    || !Number.isSafeInteger(document.stderrBytes) || document.stderrBytes < 0
    || !/^[a-f0-9]{64}$/.test(document.stdoutDigest || "") || !/^[a-f0-9]{64}$/.test(document.stderrDigest || "")
    || !/^[a-f0-9]{64}$/.test(document.inputDigestObserved || "")
    || !/^[a-f0-9]{64}$/.test(document.processBoundary.callerFenceDigest || "")
    || !/^[a-f0-9]{64}$/.test(document.processBoundary.childFenceDigest || "")
    || document.processBoundary.exactChildStarted !== document.processBoundary.exactChildExitObserved
    || document.processBoundary.projectFenceValidated !== true || document.processBoundary.shellInterpretation !== false
    || document.processBoundary.rawCommandPersisted !== false || document.processBoundary.rawOutputPersisted !== false
    || document.processBoundary.childPidPersisted !== false || document.processBoundary.noDescendantFixture !== true
    || document.processBoundary.descendantTreeOwnershipValidated !== document.processBoundary.exactChildStarted
    || (completed && (document.exitCode !== 0 || document.processBoundary.terminationRequested !== false))
    || (terminated && document.processBoundary.terminationRequested !== true)
    || canonicalJson(document.providerBoundary) !== canonicalJson({
      conformanceFixtureOnly: true,
      actualProviderInvoked: false,
      actualProviderSessionCreated: false,
      providerControlEnabled: false,
      lifecycleConformanceEvidenceOnly: true,
    })
    || document.authority !== "execution-evidence-not-canon" || document.instructionAuthority !== false
    || document.promotionAuthority !== false || document.mutatesCanon !== false) {
    fail("Runtime invocation lifecycle receipt is invalid.", "INVALID_RUNTIME_LIFECYCLE_RECEIPT");
  }
  verifyIdentity(document, { prefix: "runtime-lifecycle-receipt", idKey: "receiptId", hashKey: "receiptHash", code: "RUNTIME_LIFECYCLE_RECEIPT_DIGEST_MISMATCH" });
  return document;
}

const FIXTURE_SOURCE = String.raw`
const crypto = require('node:crypto');
const runtime = process.argv[1];
const mode = process.argv[2];
let input = Buffer.alloc(0);
process.stdin.on('data', (chunk) => { input = Buffer.concat([input, chunk]); });
process.on('SIGTERM', () => process.exit(143));
process.stdin.on('end', () => {
  const inputDigest = crypto.createHash('sha256').update(input).digest('hex');
  const write = (record) => process.stdout.write(JSON.stringify(record) + '\n');
  write({ type: 'session.started', sessionId: 'fixture-session', runtime, inputDigest });
  if (mode === 'invalid-event') process.stdout.write('{invalid-json}\n');
  else if (mode === 'output-limit') process.stdout.write(JSON.stringify({ type: 'assistant.output', text: 'x'.repeat(1024 * 1024) }) + '\n');
  else {
    write({ type: 'assistant.completed', runtime, result: 'fixture-completed' });
    write({ type: 'turn.completed', runtime, verification: 'fixture-success' });
  }
  if (mode === 'wait') setInterval(() => {}, 1000);
});
`;

function minimalEnvironment(environment) {
  const allowed = new Set(["systemroot", "windir", "temp", "tmp", "lang", "lc_all"]);
  const result = {};
  for (const [key, value] of Object.entries(environment || {})) {
    if (allowed.has(key.toLowerCase()) && typeof value === "string") result[key] = value;
  }
  result.CI = "1";
  result.NO_COLOR = "1";
  result.TERM = "dumb";
  return result;
}

function callerFence(root, authorizationId) {
  return digest(canonicalJson({
    authorizationId,
    pid: process.pid,
    parentPid: process.ppid,
    executable: process.execPath,
    projectRoot: realRoot(root),
  }));
}

export async function runRuntimeLifecycleConformance({
  root = ".",
  authorization,
  mode = "success",
  signal = null,
  spawnImplementation = spawn,
  onProcessEvent = () => {},
} = {}) {
  const verified = verifyRuntimeInvocationAuthorization(authorization);
  if (!new Set(["success", "wait", "invalid-event", "output-limit"]).has(mode)) fail("Unsupported lifecycle conformance mode.", "INVALID_RUNTIME_CONFORMANCE_MODE");
  const inspected = inspectProject(root);
  if (inspected.status !== "ready" || inspected.project.projectId !== verified.projectId
    || inspected.state.sessionId !== verified.headSessionId || inspected.state.activeRunId !== verified.runId
    || inspected.state.activeExecutionContractId !== verified.executionContractId) {
    fail("Lifecycle conformance requires the authorization's exact active project, Session, Run, and ExecutionContract.", "RUNTIME_INVOCATION_FENCE_MISMATCH");
  }
  const projectRoot = inspected.project.projectRoot;
  if (digest(realRoot(projectRoot)) !== verified.projectRootDigest) fail("Runtime invocation project root changed after authorization.", "RUNTIME_INVOCATION_PROJECT_DRIFT");
  const contract = lineage(projectRoot, verified.executionContractId, "ExecutionContract");
  const plan = lineage(projectRoot, verified.wholePlanId, "WholePlanSnapshot");
  const capsule = readContextCapsule({ root: projectRoot, capsuleId: verified.contextCapsuleId }).capsule;
  const input = Buffer.from(canonicalJson(invocationInput({ plan, contract, capsule })), "utf8");
  if (input.length !== verified.executionInput.bytes || digest(input) !== verified.executionInput.digest) {
    fail("Runtime execution input changed after authorization.", "RUNTIME_INVOCATION_INPUT_DRIFT");
  }
  const callerFenceDigest = callerFence(projectRoot, verified.authorizationId);
  const ownershipNonce = crypto.randomBytes(32).toString("hex");
  let child;
  let timer;
  let abortHandler;
  let terminationRequested = false;
  let timedOut = false;
  let cancelled = false;
  let outputLimited = false;
  let invalidEvent = false;
  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  let lineBuffer = "";
  const events = [];

  const receipt = await new Promise((resolve, reject) => {
    try {
      child = spawnImplementation(process.execPath, ["-e", FIXTURE_SOURCE, verified.runtime, mode], {
        cwd: projectRoot,
        env: minimalEnvironment(process.env),
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      reject(Object.assign(new Error(`Lifecycle conformance child could not start: ${error.message}`), { code: "RUNTIME_CONFORMANCE_SPAWN_FAILED" }));
      return;
    }
    let childStarted = false;
    let childExitObserved = false;
    let childFenceDigest = digest(`${callerFenceDigest}\nnot-started\n${ownershipNonce}`);
    let inputDigestObserved = digest(Buffer.alloc(0));
    const terminate = (reason) => {
      if (!childStarted || childExitObserved || terminationRequested) return;
      terminationRequested = true;
      if (reason === "timeout") timedOut = true;
      if (reason === "cancel") cancelled = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!childExitObserved) child.kill("SIGKILL");
      }, verified.limits.terminationGraceMs).unref();
    };
    timer = setTimeout(() => terminate("timeout"), verified.limits.timeoutMs);
    if (signal) {
      if (signal.aborted) terminate("cancel");
      else {
        abortHandler = () => terminate("cancel");
        signal.addEventListener("abort", abortHandler, { once: true });
      }
    }
    child.once("spawn", () => {
      childStarted = true;
      childFenceDigest = digest(`${callerFenceDigest}\n${child.pid}\n${ownershipNonce}`);
      onProcessEvent({ type: "spawn", pid: child.pid, parentPid: process.pid, command: process.execPath, cwd: projectRoot, ports: "none" });
      child.stdin.end(input);
    });
    child.once("error", (error) => reject(Object.assign(new Error(`Lifecycle conformance child failed: ${error.message}`), { code: "RUNTIME_CONFORMANCE_SPAWN_FAILED" })));
    child.stdout.on("data", (chunk) => {
      stdout = Buffer.concat([stdout, chunk]);
      if (stdout.length > verified.limits.maxStdoutBytes) {
        outputLimited = true;
        terminate("output-limit");
        return;
      }
      lineBuffer += chunk.toString("utf8");
      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        if (events.length >= verified.limits.maxEvents) {
          outputLimited = true;
          terminate("output-limit");
          break;
        }
        try {
          const envelope = normalizeRuntimeEvent({ authorization: verified, sequence: events.length, line });
          events.push(envelope);
          const raw = JSON.parse(line);
          if (typeof raw.inputDigest === "string" && /^[a-f0-9]{64}$/.test(raw.inputDigest)) inputDigestObserved = raw.inputDigest;
        } catch (error) {
          invalidEvent = true;
          terminate("invalid-event");
          break;
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr = Buffer.concat([stderr, chunk]);
      if (stderr.length > verified.limits.maxStderrBytes) {
        outputLimited = true;
        terminate("output-limit");
      }
    });
    child.once("exit", (code, childSignal) => {
      childExitObserved = true;
      onProcessEvent({ type: "exit", pid: child.pid, parentPid: process.pid, exitCode: Number.isInteger(code) ? code : null, signal: childSignal || "none" });
      clearTimeout(timer);
      if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
      const status = cancelled ? "cancelled" : timedOut ? "timed-out" : outputLimited ? "output-limited"
        : invalidEvent ? "invalid-event" : code === 0 ? "completed" : "failed";
      const payload = lifecycleSummary({
        authorization: verified,
        events: events.sort((left, right) => compareText(left.eventId, right.eventId)),
        status,
        exitCode: Number.isInteger(code) ? code : null,
        signal: childSignal || "",
        stdoutBytes: stdout.length,
        stderrBytes: stderr.length,
        stdoutDigest: digest(stdout),
        stderrDigest: digest(stderr),
        callerFenceDigest,
        childFenceDigest,
        childStarted,
        childExitObserved,
        terminationRequested,
        projectFenceValidated: true,
        inputDigestObserved,
        noDescendantFixture: true,
      });
      resolve(verifyRuntimeInvocationLifecycleReceipt(identify(payload, "runtime-lifecycle-receipt", "receiptId", "receiptHash")));
    });
  });
  if (receipt.inputDigestObserved !== verified.executionInput.digest && receipt.status === "completed") {
    fail("Lifecycle conformance fixture did not observe the authorized execution input.", "RUNTIME_INVOCATION_INPUT_NOT_OBSERVED");
  }
  return { status: "lifecycle_conformance_recorded", receipt, events };
}

export function buildRuntimeResultPacketDraft({ authorization, receipt } = {}) {
  const verifiedAuthorization = verifyRuntimeInvocationAuthorization(authorization);
  const verifiedReceipt = verifyRuntimeInvocationLifecycleReceipt(receipt);
  if (verifiedReceipt.authorizationId !== verifiedAuthorization.authorizationId
    || verifiedReceipt.executionContractId !== verifiedAuthorization.executionContractId
    || verifiedReceipt.runId !== verifiedAuthorization.runId) {
    fail("Runtime receipt does not belong to the authorized Run.", "RUNTIME_RESULT_DRAFT_LINEAGE_CONFLICT");
  }
  const successful = verifiedReceipt.status === "completed" && verifiedReceipt.exitCode === 0
    && verifiedReceipt.inputDigestObserved === verifiedAuthorization.executionInput.digest;
  const payload = {
    schemaVersion: 1,
    kind: "RuntimeResultPacketDraft",
    protocolVersion: RUNTIME_RESULT_DRAFT_VERSION,
    authorizationId: verifiedAuthorization.authorizationId,
    lifecycleReceiptId: verifiedReceipt.receiptId,
    executionContractId: verifiedAuthorization.executionContractId,
    runId: verifiedAuthorization.runId,
    outcome: successful ? "Provider lifecycle conformance completed." : `Provider lifecycle conformance ended with ${verifiedReceipt.status}.`,
    evidence: [{
      kind: "RuntimeLifecycleEvidence",
      lifecycleReceiptId: verifiedReceipt.receiptId,
      eventIds: verifiedReceipt.eventIds,
      eventTypes: verifiedReceipt.eventTypes,
      providerSessionReferenceDigests: verifiedReceipt.providerSessionReferenceDigests,
      instructionAuthority: false,
    }],
    planDelta: "",
    impactRadius: [],
    verification: [{
      kind: "RuntimeLifecycleVerification",
      status: successful ? "passed" : "failed",
      projectFenceValidated: verifiedReceipt.processBoundary.projectFenceValidated,
      exactChildExitObserved: verifiedReceipt.processBoundary.exactChildExitObserved,
      descendantTreeOwnershipValidated: verifiedReceipt.processBoundary.descendantTreeOwnershipValidated,
      inputDigestMatched: verifiedReceipt.inputDigestObserved === verifiedAuthorization.executionInput.digest,
    }],
    unknowns: verifiedReceipt.unknownEventTypes.map((type) => `Unrecognized provider event type: ${type}`),
    finalResultPacketPersisted: false,
    freshHeadReviewRequired: true,
    rawTranscriptIncluded: false,
    authority: "draft-evidence-not-reviewed-result",
    instructionAuthority: false,
    promotionAuthority: false,
    mutatesCanon: false,
  };
  return verifyRuntimeResultPacketDraft(identify(payload, "runtime-result-draft", "draftId", "draftHash"));
}

export function verifyRuntimeResultPacketDraft(document) {
  assertFields(document, [
    "schemaVersion", "kind", "protocolVersion", "authorizationId", "lifecycleReceiptId", "executionContractId",
    "runId", "outcome", "evidence", "planDelta", "impactRadius", "verification", "unknowns",
    "finalResultPacketPersisted", "freshHeadReviewRequired", "rawTranscriptIncluded", "authority",
    "instructionAuthority", "promotionAuthority", "mutatesCanon", "draftId", "draftHash",
  ], "Runtime ResultPacket draft");
  if (!Array.isArray(document.evidence) || document.evidence.length !== 1
    || !Array.isArray(document.verification) || document.verification.length !== 1) {
    fail("Runtime ResultPacket draft evidence and verification cardinality are invalid.", "INVALID_RUNTIME_RESULT_PACKET_DRAFT");
  }
  const evidence = document.evidence[0];
  const verification = document.verification[0];
  assertFields(evidence, [
    "kind", "lifecycleReceiptId", "eventIds", "eventTypes", "providerSessionReferenceDigests", "instructionAuthority",
  ], "Runtime ResultPacket draft evidence");
  assertFields(verification, [
    "kind", "status", "projectFenceValidated", "exactChildExitObserved", "descendantTreeOwnershipValidated", "inputDigestMatched",
  ], "Runtime ResultPacket draft verification");
  const sortedUnique = (items) => Array.isArray(items) && canonicalJson(items) === canonicalJson([...new Set(items)].sort(compareText));
  if (document.schemaVersion !== 1 || document.kind !== "RuntimeResultPacketDraft"
    || document.protocolVersion !== RUNTIME_RESULT_DRAFT_VERSION
    || !/^runtime-invocation-authorization-[a-f0-9]{24}$/.test(document.authorizationId || "")
    || !/^runtime-lifecycle-receipt-[a-f0-9]{24}$/.test(document.lifecycleReceiptId || "")
    || !/^execution-contract-[a-f0-9]{24}$/.test(document.executionContractId || "")
    || !/^run-[0-9]+-[a-f0-9]{6}$/.test(document.runId || "")
    || typeof document.outcome !== "string" || !document.outcome
    || evidence.kind !== "RuntimeLifecycleEvidence" || evidence.lifecycleReceiptId !== document.lifecycleReceiptId
    || !sortedUnique(evidence.eventIds) || evidence.eventIds.some((item) => !/^runtime-event-[a-f0-9]{24}$/.test(item))
    || !sortedUnique(evidence.eventTypes) || !sortedUnique(evidence.providerSessionReferenceDigests)
    || evidence.providerSessionReferenceDigests.some((item) => !/^[a-f0-9]{64}$/.test(item))
    || evidence.instructionAuthority !== false
    || verification.kind !== "RuntimeLifecycleVerification" || !new Set(["passed", "failed"]).has(verification.status)
    || [verification.projectFenceValidated, verification.exactChildExitObserved, verification.descendantTreeOwnershipValidated, verification.inputDigestMatched].some((item) => typeof item !== "boolean")
    || typeof document.planDelta !== "string"
    || !Array.isArray(document.impactRadius) || document.impactRadius.length !== 0
    || !Array.isArray(document.unknowns) || document.unknowns.some((item) => typeof item !== "string" || !item)
    || document.finalResultPacketPersisted !== false || document.freshHeadReviewRequired !== true
    || document.rawTranscriptIncluded !== false || document.authority !== "draft-evidence-not-reviewed-result"
    || document.instructionAuthority !== false || document.promotionAuthority !== false || document.mutatesCanon !== false) {
    fail("Runtime ResultPacket draft is invalid.", "INVALID_RUNTIME_RESULT_PACKET_DRAFT");
  }
  verifyIdentity(document, { prefix: "runtime-result-draft", idKey: "draftId", hashKey: "draftHash", code: "RUNTIME_RESULT_DRAFT_DIGEST_MISMATCH" });
  return document;
}

export const RUNTIME_INVOCATION_REQUIRED_ACTIONS = Object.freeze({
  invoke: REQUIRED_INVOKE_ACTION,
  readOnly: WORKSPACE_ACTION["read-only"],
  workspaceWrite: WORKSPACE_ACTION["workspace-write"],
});
