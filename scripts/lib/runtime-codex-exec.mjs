import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveReadOnlyRuntimeExecutableTarget } from "./runtime-machine-discovery.mjs";
import { verifyRuntimeProjectBinding, verifyRuntimeProtocolEvidence } from "./runtime-protocol-evidence.mjs";
import { buildFreshHeadReview, readLineageArtifact } from "./execution-lineage.mjs";
import { finishRun, getPendingReviewContext } from "./run-lineage.mjs";
import {
  buildRuntimeInvocationCallerFence,
  buildRuntimeInvocationLifecycleReceipt,
  buildRuntimeResultPacketDraft,
  normalizeRuntimeEvent,
  prepareRuntimeInvocationExecution,
  readRuntimeInvocationAuthorization,
  verifyRuntimeEventEnvelope,
  verifyRuntimeInvocationAuthorization,
  verifyRuntimeInvocationLifecycleReceipt,
  verifyRuntimeResultPacketDraft,
  verifyRuntimeStructuredResult,
  RUNTIME_STRUCTURED_RESULT_VERSION,
} from "./runtime-invocation-lifecycle.mjs";
import {
  verifyRuntimeExecutionLeaseOwnership,
  withRuntimeExecutionLease,
} from "./runtime-execution-lease.mjs";
import {
  resolveVerifiedProcessSupervisor,
  spawnSupervisedProcess,
} from "./runtime-process-supervisor.mjs";

export const CODEX_EXEC_PROVIDER_VERSION = "0.1.0";
export const RUNTIME_RUN_RESULT_APPLICATION_VERSION = "0.1.0";
const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const fail = (message, code = "CODEX_EXEC_PROVIDER_ERROR") => {
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
const prettyJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

function assertExactFields(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} is invalid.`, "INVALID_RUNTIME_RUN_RESULT_APPLICATION");
  const expected = new Set(fields);
  if (Object.keys(value).some((field) => !expected.has(field)) || fields.some((field) => !(field in value))) {
    fail(`${label} fields are invalid.`, "INVALID_RUNTIME_RUN_RESULT_APPLICATION");
  }
}

function identifyApplication(payload) {
  const applicationHash = digest(canonicalJson(payload));
  return {
    ...payload,
    applicationId: `runtime-run-result-application-${applicationHash.slice(0, 24)}`,
    applicationHash,
  };
}

export function verifyRuntimeRunResultApplication(document) {
  assertExactFields(document, [
    "schemaVersion", "kind", "protocolVersion", "authorizationId", "lifecycleReceiptId", "draftId",
    "runId", "executionContractId", "resultPacketId", "reviewContextId", "status",
    "freshHeadReviewRequired", "rawTranscriptIncluded", "authority", "instructionAuthority",
    "promotionAuthority", "mutatesCanon", "applicationId", "applicationHash",
  ], "Runtime Run result application");
  const { applicationId, applicationHash, ...payload } = document;
  const expectedHash = digest(canonicalJson(payload));
  if (document.schemaVersion !== 1 || document.kind !== "RuntimeRunResultApplication"
    || document.protocolVersion !== RUNTIME_RUN_RESULT_APPLICATION_VERSION
    || !/^execution-authorization-[a-f0-9]{24}$/.test(document.authorizationId || "")
    || !/^runtime-lifecycle-receipt-[a-f0-9]{24}$/.test(document.lifecycleReceiptId || "")
    || !/^runtime-result-draft-[a-f0-9]{24}$/.test(document.draftId || "")
    || !/^run-[0-9]+-[a-f0-9]{6}$/.test(document.runId || "")
    || !/^execution-contract-[a-f0-9]{24}$/.test(document.executionContractId || "")
    || !/^result-packet-[a-f0-9]{24}$/.test(document.resultPacketId || "")
    || !/^fresh-head-review-[a-f0-9]{24}$/.test(document.reviewContextId || "")
    || document.status !== "run-result-applied-awaiting-review"
    || document.freshHeadReviewRequired !== true || document.rawTranscriptIncluded !== false
    || document.authority !== "execution-lineage-application-evidence"
    || document.instructionAuthority !== false || document.promotionAuthority !== false || document.mutatesCanon !== false
    || applicationHash !== expectedHash
    || applicationId !== `runtime-run-result-application-${expectedHash.slice(0, 24)}`) {
    fail("Runtime Run result application is invalid.", "INVALID_RUNTIME_RUN_RESULT_APPLICATION");
  }
  return document;
}

export const CODEX_EXEC_RESULT_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "kind", "protocolVersion", "outcome", "evidence", "planDelta", "impactRadius", "verification", "unknowns"],
  properties: {
    schemaVersion: { const: 1 },
    kind: { const: "RuntimeStructuredResult" },
    protocolVersion: { const: RUNTIME_STRUCTURED_RESULT_VERSION },
    outcome: { type: "string", minLength: 1, maxLength: 16_384 },
    evidence: { type: "array", maxItems: 64, items: { type: "string", minLength: 1, maxLength: 8_192 } },
    planDelta: { type: "string", maxLength: 16_384 },
    impactRadius: { type: "array", maxItems: 64, items: { type: "string", minLength: 1, maxLength: 8_192 } },
    verification: { type: "array", maxItems: 64, items: { type: "string", minLength: 1, maxLength: 8_192 } },
    unknowns: { type: "array", maxItems: 64, items: { type: "string", minLength: 1, maxLength: 8_192 } },
  },
});

function providerEnvironment(environment = process.env) {
  const allowed = new Set([
    "appdata", "codex_api_key", "codex_home", "comspec", "home", "homedrive", "homepath",
    "http_proxy", "https_proxy", "lang", "lc_all", "localappdata", "no_proxy", "openai_api_key",
    "path", "ssl_cert_dir", "ssl_cert_file", "systemroot", "temp", "tmp", "userprofile", "windir",
  ]);
  const result = {};
  for (const [key, value] of Object.entries(environment || {})) {
    if (allowed.has(key.toLowerCase()) && typeof value === "string") result[key] = value;
  }
  result.CI = "1";
  result.NO_COLOR = "1";
  result.TERM = "dumb";
  return result;
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function operationalProviderDirectory(operationalStateRoot, authorization) {
  const directory = path.join(
    operationalStateRoot,
    "runtime-provider-invocations",
    authorization.projectId,
    authorization.authorizationId,
  );
  if (!isWithin(operationalStateRoot, directory) || directory === operationalStateRoot) {
    fail("Codex operational invocation directory escaped its host-local root.", "UNSAFE_CODEX_OPERATIONAL_STATE");
  }
  return directory;
}

function createOperationalSchemaFile(operationalStateRoot, authorization) {
  const directory = operationalProviderDirectory(operationalStateRoot, authorization);
  fs.mkdirSync(directory, { recursive: true });
  const fixed = [
    path.join(operationalStateRoot, "runtime-provider-invocations"),
    path.join(operationalStateRoot, "runtime-provider-invocations", authorization.projectId),
    directory,
  ];
  for (const item of fixed) {
    const stat = fs.lstatSync(item);
    const resolved = fs.realpathSync(item);
    if (!stat.isDirectory() || stat.isSymbolicLink() || !isWithin(operationalStateRoot, resolved)) {
      fail("Codex operational invocation path is unsafe.", "UNSAFE_CODEX_OPERATIONAL_STATE");
    }
  }
  const file = path.join(directory, "result.schema.json");
  const controlFile = path.join(directory, "supervisor-control.jsonl");
  fs.writeFileSync(file, prettyJson(CODEX_EXEC_RESULT_SCHEMA), { encoding: "utf8", flag: "wx" });
  return { directory, file, controlFile };
}

function removeOperationalSchemaFile(operationalStateRoot, authorization, state) {
  if (!state) return;
  const expected = operationalProviderDirectory(operationalStateRoot, authorization);
  const resolved = fs.realpathSync(state.directory);
  if (resolved !== expected || !isWithin(operationalStateRoot, resolved)) {
    fail("Refusing unsafe Codex operational cleanup.", "UNSAFE_CODEX_OPERATIONAL_STATE");
  }
  const entries = fs.readdirSync(resolved).sort(compareText);
  const expectedEntries = fs.existsSync(state.controlFile)
    ? ["result.schema.json", "supervisor-control.jsonl"] : ["result.schema.json"];
  if (canonicalJson(entries) !== canonicalJson(expectedEntries)) {
    fail("Codex operational invocation directory contains unexpected files.", "UNSAFE_CODEX_OPERATIONAL_STATE");
  }
  if (fs.existsSync(state.controlFile)) fs.unlinkSync(state.controlFile);
  fs.unlinkSync(state.file);
  fs.rmdirSync(resolved);
  for (const parent of [
    path.dirname(resolved),
    path.join(operationalStateRoot, "runtime-provider-invocations"),
  ]) {
    if (!fs.existsSync(parent) || fs.readdirSync(parent).length) break;
    const stat = fs.lstatSync(parent);
    const canonical = fs.realpathSync(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink() || !isWithin(operationalStateRoot, canonical) || canonical === operationalStateRoot) {
      fail("Codex operational parent cleanup is unsafe.", "UNSAFE_CODEX_OPERATIONAL_STATE");
    }
    fs.rmdirSync(canonical);
  }
}

function codexArguments({ projectRoot, schemaFile, workspaceMode }) {
  return [
    "exec",
    "--json",
    "--ephemeral",
    "--color", "never",
    "--ask-for-approval", "never",
    "--sandbox", workspaceMode,
    "--skip-git-repo-check",
    "--cd", projectRoot,
    "--output-schema", schemaFile,
    "-",
  ];
}

function collectAgentMessageStrings(record) {
  if (record?.type !== "item.completed" || record?.item?.type !== "agent_message") return [];
  const found = [];
  const visit = (value, depth = 0) => {
    if (depth > 5 || value === null || value === undefined) return;
    if (typeof value === "string") {
      if (value.trim()) found.push(value.trim());
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 128)) visit(item, depth + 1);
      return;
    }
    if (typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (["text", "output_text", "content", "message"].includes(key.toLowerCase())) visit(item, depth + 1);
    }
  };
  visit(record.item);
  return [...new Set(found)];
}

export function extractCodexStructuredResult(record, { scopeKind = null } = {}) {
  for (const candidate of collectAgentMessageStrings(record)) {
    try {
      return verifyRuntimeStructuredResult(JSON.parse(candidate), { scopeKind });
    } catch {}
  }
  return null;
}

function structuredResultExposesRoot(result, roots) {
  if (!result) return false;
  const content = canonicalJson(result).toLowerCase();
  return roots.filter(Boolean).some((root) => {
    const resolved = path.resolve(root).toLowerCase();
    return content.includes(resolved) || content.includes(resolved.replaceAll("\\", "/"));
  });
}

function verifyCurrentCodexTarget({ authorization, protocolEvidence, projectBinding, targetResolver, platform, environment, fileSystem }) {
  const protocol = verifyRuntimeProtocolEvidence(protocolEvidence);
  const binding = verifyRuntimeProjectBinding(projectBinding);
  if (authorization.runtime !== "codex") fail("Codex exec requires a Codex authorization.", "CODEX_AUTHORIZATION_REQUIRED");
  if (protocol.evidenceId !== authorization.runtimeProtocolEvidenceId
    || binding.bindingId !== authorization.runtimeProjectBindingId
    || binding.protocolEvidenceId !== protocol.evidenceId
    || binding.projectId !== authorization.projectId
    || binding.headSessionId !== authorization.headSessionId) {
    fail("Codex capability and project binding changed after authorization.", "CODEX_EXEC_CAPABILITY_BINDING_DRIFT");
  }
  const observation = protocol.observations.find((item) => item.runtime === "codex");
  if (!observation || observation.observationId !== authorization.runtimeProtocolObservationId
    || !observation.protocolNegotiationObserved) {
    fail("Authorized Codex protocol observation is unavailable.", "CODEX_EXEC_PROTOCOL_NOT_VERIFIED");
  }
  const target = targetResolver({ runtime: "codex", platform, environment, fileSystem });
  if (!target?.executablePath || !path.isAbsolute(target.executablePath)
    || canonicalJson(target.observation) !== canonicalJson(observation.executable)
    || target.observation.availability !== "candidate-found" || !target.observation.directSpawnSafe
    || target.observation.symbolicLink) {
    fail("Codex executable identity changed or is not safe for direct spawn.", "CODEX_EXEC_EXECUTABLE_DRIFT");
  }
  return { target, observation };
}

function terminateExactTree(supervised, state, reason) {
  if (!state.childStarted || state.childExitObserved || state.terminationRequested) return;
  state.terminationRequested = true;
  if (reason === "timeout") state.timedOut = true;
  if (reason === "cancel") state.cancelled = true;
  if (reason === "output-limit") state.outputLimited = true;
  if (reason === "invalid-event") state.invalidEvent = true;
  supervised.terminate(false);
}

async function runCodexChild({
  executablePath,
  args,
  projectRoot,
  environment,
  authorization,
  input,
  consumption,
  callerFenceDigest,
  signal,
  spawnImplementation,
  onProcessEvent,
  providerMode,
  sensitiveRoots,
  supervisorSelection,
  supervisorControlFile,
}) {
  const state = {
    childStarted: false,
    childExitObserved: false,
    terminationRequested: false,
    timedOut: false,
    cancelled: false,
    outputLimited: false,
    invalidEvent: false,
  };
  let child;
  let supervised;
  let timer;
  let forceTimer;
  let abortHandler;
  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  let lineBuffer = "";
  let inputDigestObserved = digest(Buffer.alloc(0));
  let inputWriteFailed = false;
  let providerResult = null;
  const events = [];
  const ownershipNonce = crypto.randomBytes(32).toString("hex");

  const receipt = await new Promise((resolve, reject) => {
    let settled = false;
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
      reject(error);
    };
    try {
      supervised = spawnSupervisedProcess({
        selection: supervisorSelection,
        executablePath,
        args,
        cwd: projectRoot,
        providerEnvironment: providerEnvironment(environment),
        input,
        controlFile: supervisorControlFile,
        terminationGraceMs: authorization.limits.terminationGraceMs,
        spawnImplementation,
        onControlEvent: (event) => {
          if (event.type === "provider.started") {
            inputDigestObserved = digest(input);
            onProcessEvent({ type: "spawn", pid: event.providerPid, parentPid: child?.pid || process.pid, command: "codex exec", cwd: projectRoot, ports: "none" });
          } else if (event.type === "provider.exited") {
            onProcessEvent({ type: "exit", pid: event.providerPid, parentPid: child?.pid || process.pid, exitCode: event.exitCode, signal: "none" });
          }
        },
      });
      child = supervised.child;
    } catch (error) {
      rejectOnce(Object.assign(new Error(`Codex exec could not start: ${error.message}`), { code: "CODEX_EXEC_SPAWN_FAILED" }));
      return;
    }
    let childFenceDigest = digest(`${callerFenceDigest}\nnot-started\n${ownershipNonce}`);
    const terminate = (reason) => {
      const before = state.terminationRequested;
      terminateExactTree(supervised, state, reason);
      if (!before && state.terminationRequested) {
        forceTimer = setTimeout(() => {
          if (!state.childExitObserved) supervised.terminate(true);
        }, authorization.limits.terminationGraceMs);
        forceTimer.unref();
      }
    };
    const consumeLine = (line) => {
      if (!line.trim()) return;
      if (events.length >= authorization.limits.maxEvents) {
        terminate("output-limit");
        return;
      }
      try {
        const record = JSON.parse(line);
        const envelope = normalizeRuntimeEvent({ authorization, sequence: events.length, line });
        events.push(envelope);
        const result = extractCodexStructuredResult(record, { scopeKind: authorization.scope.kind });
        if (result && structuredResultExposesRoot(result, sensitiveRoots)) terminate("invalid-event");
        else if (result) providerResult = result;
      } catch {
        terminate("invalid-event");
      }
    };
    timer = setTimeout(() => terminate("timeout"), authorization.limits.timeoutMs);
    if (signal) {
      if (signal.aborted) terminate("cancel");
      else {
        abortHandler = () => terminate("cancel");
        signal.addEventListener("abort", abortHandler, { once: true });
      }
    }
    child.once("spawn", () => {
      state.childStarted = true;
      childFenceDigest = digest(`${callerFenceDigest}\n${child.pid}\n${ownershipNonce}`);
      onProcessEvent({ type: "spawn", pid: child.pid, parentPid: process.pid, command: "head-agent process-supervisor", cwd: path.dirname(supervisorSelection.binaryPath), ports: "none" });
    });
    child.once("error", (error) => {
      rejectOnce(Object.assign(new Error(`Codex exec child failed: ${error.message}`), { code: "CODEX_EXEC_SPAWN_FAILED" }));
    });
    child.stdin.on("error", () => {
      inputWriteFailed = true;
      inputDigestObserved = digest(Buffer.alloc(0));
    });
    child.stdout.on("data", (chunk) => {
      stdout = Buffer.concat([stdout, chunk]);
      if (stdout.length > authorization.limits.maxStdoutBytes) {
        terminate("output-limit");
        return;
      }
      lineBuffer += chunk.toString("utf8");
      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = lines.pop() || "";
      for (const line of lines) consumeLine(line);
    });
    child.stderr.on("data", (chunk) => {
      stderr = Buffer.concat([stderr, chunk]);
      if (stderr.length > authorization.limits.maxStderrBytes) terminate("output-limit");
    });
    child.once("close", (code, childSignal) => {
      if (settled) return;
      settled = true;
      state.childExitObserved = true;
      if (lineBuffer.trim()) consumeLine(lineBuffer);
      onProcessEvent({ type: "exit", pid: child.pid, parentPid: process.pid, exitCode: Number.isInteger(code) ? code : null, signal: childSignal || "none" });
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
      const supervision = supervised.finalize({
        exactSupervisorExitObserved: state.childExitObserved,
        terminationRequested: state.terminationRequested,
      });
      if (!supervision.providerChildExitObserved && supervision.providerPid) {
        onProcessEvent({ type: "exit", pid: supervision.providerPid, parentPid: child.pid, exitCode: null, signal: state.terminationRequested ? "terminated-tree" : "unknown" });
      }
      const sessionCreated = events.some((item) => item.providerSessionReferenceDigests.length > 0);
      const turnCompleted = events.some((item) => item.eventType === "turn.completed");
      const providerOutputComplete = providerResult !== null && sessionCreated && turnCompleted
        && inputDigestObserved === authorization.executionInput.digest && supervision.requestWritten;
      const status = state.cancelled ? "cancelled" : state.timedOut ? "timed-out" : state.outputLimited ? "output-limited"
        : state.invalidEvent || supervision.controlInvalid ? "invalid-event"
          : code === 0 && providerOutputComplete && supervision.ownershipEstablished && supervision.treeCleanupVerified ? "completed" : "failed";
      const receiptDocument = buildRuntimeInvocationLifecycleReceipt({
        authorization,
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
        childStarted: state.childStarted,
        childExitObserved: state.childExitObserved,
        terminationRequested: state.terminationRequested,
        projectFenceValidated: true,
        inputDigestObserved,
        noDescendantFixture: false,
        descendantTreeOwnershipValidated: supervision.ownershipEstablished && supervision.treeCleanupVerified
          && state.childStarted && state.childExitObserved,
        supervision,
        consumption,
        providerMode,
        providerSessionCreated: sessionCreated,
        structuredResult: providerResult,
      });
      resolve({ receipt: receiptDocument, events, providerResult });
    });
  });
  return receipt;
}

function invocationRecordDirectory(projectRoot, authorizationId) {
  return path.join(projectRoot, ".head", "runtime", "invocations", authorizationId);
}

function atomicWriteExclusive(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, content, { encoding: "utf8", flag: "wx" });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function persistInvocationRecord({ projectRoot, authorization, events, receipt, draft }) {
  const directory = invocationRecordDirectory(projectRoot, authorization.authorizationId);
  if (fs.existsSync(directory)) fail("Runtime invocation record already exists.", "RUNTIME_INVOCATION_RECORD_EXISTS");
  const base = path.dirname(directory);
  fs.mkdirSync(base, { recursive: true });
  const baseStat = fs.lstatSync(base);
  const resolvedBase = fs.realpathSync(base);
  if (!baseStat.isDirectory() || baseStat.isSymbolicLink() || !isWithin(fs.realpathSync(projectRoot), resolvedBase)) {
    fail("Runtime invocation record base is unsafe.", "UNSAFE_RUNTIME_INVOCATION_RECORD");
  }
  const temporary = path.join(base, `.${authorization.authorizationId}.${crypto.randomUUID()}.tmp`);
  fs.mkdirSync(temporary, { recursive: false });
  try {
    for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
      atomicWriteExclusive(path.join(temporary, `event-${String(event.sequence).padStart(6, "0")}-${event.eventId}.json`), prettyJson(event));
    }
    atomicWriteExclusive(path.join(temporary, "receipt.json"), prettyJson(receipt));
    atomicWriteExclusive(path.join(temporary, "draft.json"), prettyJson(draft));
    fs.renameSync(temporary, directory);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { recursive: true, force: true });
  }
  return { recorded: true, eventCount: events.length, receiptId: receipt.receiptId, draftId: draft.draftId };
}

function runResultApplicationFile(projectRoot, authorizationId) {
  return path.join(invocationRecordDirectory(projectRoot, authorizationId), "application.json");
}

function canonicalRunResultFields(record) {
  const { receipt, draft } = record;
  const lifecycleEvidence = draft.evidence[0];
  const lifecycleVerification = draft.verification[0];
  if (draft.scopeKind !== "run" || !draft.providerResult || draft.freshHeadReviewRequired !== true
    || receipt.status !== "completed" || receipt.exitCode !== 0
    || receipt.providerBoundary.actualProviderInvoked !== true
    || receipt.providerBoundary.structuredResultObserved !== true
    || receipt.processBoundary.descendantTreeOwnershipValidated !== true
    || lifecycleVerification.status !== "passed") {
    fail("Only a completed, native-supervised actual-provider Run result can enter canonical Execution Lineage.", "RUNTIME_RUN_RESULT_NOT_APPLICABLE");
  }
  return {
    outcome: draft.outcome,
    evidence: [{
      kind: "RuntimeInvocationResultEvidence",
      runtime: "codex",
      authorizationId: draft.authorizationId,
      runtimeResultDraftId: draft.draftId,
      lifecycleReceiptId: draft.lifecycleReceiptId,
      executionLeaseConsumptionId: draft.executionLeaseConsumptionId,
      executionLeaseReleaseId: draft.executionLeaseReleaseId,
      eventIds: [...lifecycleEvidence.eventIds],
      eventTypes: [...lifecycleEvidence.eventTypes],
      providerSessionReferenceDigests: [...lifecycleEvidence.providerSessionReferenceDigests],
      structuredResultDigest: lifecycleEvidence.structuredResultDigest,
      providerEvidence: [...draft.providerResult.evidence],
      actualProviderInvoked: true,
      rawTranscriptIncluded: false,
      instructionAuthority: false,
    }],
    planDelta: draft.planDelta,
    impactRadius: [...draft.impactRadius],
    verification: [{
      kind: "RuntimeInvocationResultVerification",
      runtime: "codex",
      status: "passed",
      lifecycleReceiptId: draft.lifecycleReceiptId,
      projectFenceValidated: lifecycleVerification.projectFenceValidated,
      exactChildExitObserved: lifecycleVerification.exactChildExitObserved,
      descendantTreeOwnershipValidated: lifecycleVerification.descendantTreeOwnershipValidated,
      inputDigestMatched: lifecycleVerification.inputDigestMatched,
      providerVerification: [...draft.providerResult.verification],
    }],
    unknowns: [...draft.unknowns],
    knowledgeProposals: [],
  };
}

function verifyCanonicalRunResultPacket(resultPacket, fields, authorization) {
  if (resultPacket?.kind !== "ResultPacket"
    || resultPacket.executionContractId !== authorization.scope.executionContractId
    || canonicalJson({
      outcome: resultPacket.outcome,
      evidence: resultPacket.evidence,
      planDelta: resultPacket.planDelta,
      impactRadius: resultPacket.impactRadius,
      verification: resultPacket.verification,
      unknowns: resultPacket.unknowns,
      knowledgeProposals: resultPacket.knowledgeProposals,
    }) !== canonicalJson(fields)) {
    fail("Canonical ResultPacket does not exactly match the verified runtime draft.", "RUNTIME_RUN_RESULT_PACKET_CONFLICT");
  }
  return resultPacket;
}

function readRuntimeRunResultApplication({ projectRoot, authorizationId, receipt, draft }) {
  const file = runResultApplicationFile(projectRoot, authorizationId);
  if (!fs.existsSync(file)) return null;
  const application = verifyRuntimeRunResultApplication(JSON.parse(fs.readFileSync(file, "utf8")));
  if (application.authorizationId !== authorizationId || application.lifecycleReceiptId !== receipt.receiptId
    || application.draftId !== draft.draftId || application.runId !== draft.runId
    || application.executionContractId !== draft.executionContractId) {
    fail("Runtime Run result application conflicts with its invocation record.", "RUNTIME_RUN_RESULT_APPLICATION_CONFLICT");
  }
  const resultPacket = readLineageArtifact({ root: projectRoot, artifactId: application.resultPacketId }).artifact;
  if (resultPacket.kind !== "ResultPacket" || resultPacket.executionContractId !== application.executionContractId) {
    fail("Runtime Run result application points to an invalid ResultPacket.", "RUNTIME_RUN_RESULT_APPLICATION_CONFLICT");
  }
  const authorization = readRuntimeInvocationAuthorization({ root: projectRoot, authorizationId }).authorization;
  if (authorization.scope.kind !== "run" || authorization.scope.runId !== application.runId
    || authorization.scope.executionContractId !== application.executionContractId) {
    fail("Runtime Run result application does not match its authorization lineage.", "RUNTIME_RUN_RESULT_APPLICATION_CONFLICT");
  }
  const expectedReview = buildFreshHeadReview({
    root: projectRoot,
    wholePlanId: authorization.scope.wholePlanId,
    resultPacketId: resultPacket.resultPacketId,
    sessionId: authorization.headSessionId,
    runId: authorization.scope.runId,
  }).review;
  if (expectedReview.reviewContextId !== application.reviewContextId) {
    fail("Runtime Run result application does not match the deterministic Fresh HEAD context.", "RUNTIME_RUN_RESULT_APPLICATION_CONFLICT");
  }
  return application;
}

export function readCodexRuntimeInvocationResult({ root = ".", authorizationId } = {}) {
  if (!/^execution-authorization-[a-f0-9]{24}$/.test(authorizationId || "")) fail("Runtime invocation authorization id is invalid.", "INVALID_RUNTIME_INVOCATION_AUTHORIZATION_ID");
  const preparedRoot = fs.realpathSync(path.resolve(root));
  const directory = invocationRecordDirectory(preparedRoot, authorizationId);
  if (!fs.existsSync(directory)) fail("Runtime invocation result is not recorded.", "RUNTIME_INVOCATION_RESULT_NOT_FOUND");
  const stat = fs.lstatSync(directory);
  const resolvedDirectory = fs.realpathSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !isWithin(preparedRoot, resolvedDirectory)) {
    fail("Runtime invocation record path is unsafe.", "UNSAFE_RUNTIME_INVOCATION_RECORD");
  }
  const receipt = verifyRuntimeInvocationLifecycleReceipt(JSON.parse(fs.readFileSync(path.join(directory, "receipt.json"), "utf8")));
  const draft = verifyRuntimeResultPacketDraft(JSON.parse(fs.readFileSync(path.join(directory, "draft.json"), "utf8")));
  const events = fs.readdirSync(directory).filter((item) => /^event-[0-9]{6}-runtime-event-[a-f0-9]{24}\.json$/.test(item)).sort(compareText)
    .map((item) => verifyRuntimeEventEnvelope(JSON.parse(fs.readFileSync(path.join(directory, item), "utf8"))));
  const ids = events.map((item) => item.eventId).sort(compareText);
  if (receipt.authorizationId !== authorizationId || draft.authorizationId !== authorizationId
    || canonicalJson(ids) !== canonicalJson(receipt.eventIds)) {
    fail("Runtime invocation record lineage is inconsistent.", "RUNTIME_INVOCATION_RECORD_CONFLICT");
  }
  const application = readRuntimeRunResultApplication({ projectRoot: preparedRoot, authorizationId, receipt, draft });
  return { status: "verified", authorizationId, receipt, draft, events, application };
}

export function applyCodexRuntimeRunResult({ root = ".", authorizationId } = {}) {
  const preparedRoot = fs.realpathSync(path.resolve(root));
  const authorization = readRuntimeInvocationAuthorization({ root: preparedRoot, authorizationId }).authorization;
  const record = readCodexRuntimeInvocationResult({ root: preparedRoot, authorizationId });
  if (authorization.runtime !== "codex" || authorization.scope.kind !== "run"
    || authorization.scope.runId !== record.draft.runId
    || authorization.scope.executionContractId !== record.draft.executionContractId) {
    fail("Runtime invocation is not the exact authorized Codex Run.", "CODEX_RUN_AUTHORIZATION_REQUIRED");
  }
  const fields = canonicalRunResultFields(record);
  if (record.application) {
    const resultPacket = readLineageArtifact({ root: preparedRoot, artifactId: record.application.resultPacketId }).artifact;
    verifyCanonicalRunResultPacket(resultPacket, fields, authorization);
    return {
      status: "runtime_run_result_already_applied",
      authorizationId,
      application: record.application,
      resultPacket,
      freshHeadReview: null,
    };
  }

  let resultPacket;
  let freshHead;
  try {
    resultPacket = finishRun({ root: preparedRoot, ...fields }).resultPacket;
    freshHead = getPendingReviewContext({ root: preparedRoot });
  } catch (error) {
    if (error.code !== "NO_ACTIVE_RUN") throw error;
    freshHead = getPendingReviewContext({ root: preparedRoot });
    if (freshHead.pendingReview.runId !== authorization.scope.runId) {
      fail("Pending Fresh HEAD review belongs to another Run.", "RUNTIME_RUN_RESULT_APPLICATION_CONFLICT");
    }
    resultPacket = readLineageArtifact({ root: preparedRoot, artifactId: freshHead.pendingReview.resultPacketId }).artifact;
  }
  verifyCanonicalRunResultPacket(resultPacket, fields, authorization);
  if (freshHead.pendingReview.runId !== authorization.scope.runId
    || freshHead.pendingReview.resultPacketId !== resultPacket.resultPacketId
    || freshHead.review.reviewContextId === "") {
    fail("Fresh HEAD review does not match the applied runtime Run result.", "RUNTIME_RUN_RESULT_APPLICATION_CONFLICT");
  }
  const application = verifyRuntimeRunResultApplication(identifyApplication({
    schemaVersion: 1,
    kind: "RuntimeRunResultApplication",
    protocolVersion: RUNTIME_RUN_RESULT_APPLICATION_VERSION,
    authorizationId,
    lifecycleReceiptId: record.receipt.receiptId,
    draftId: record.draft.draftId,
    runId: authorization.scope.runId,
    executionContractId: authorization.scope.executionContractId,
    resultPacketId: resultPacket.resultPacketId,
    reviewContextId: freshHead.review.reviewContextId,
    status: "run-result-applied-awaiting-review",
    freshHeadReviewRequired: true,
    rawTranscriptIncluded: false,
    authority: "execution-lineage-application-evidence",
    instructionAuthority: false,
    promotionAuthority: false,
    mutatesCanon: false,
  }));
  const applicationFile = runResultApplicationFile(preparedRoot, authorizationId);
  try {
    atomicWriteExclusive(applicationFile, prettyJson(application));
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const concurrent = readCodexRuntimeInvocationResult({ root: preparedRoot, authorizationId }).application;
    if (!concurrent || concurrent.applicationId !== application.applicationId) {
      fail("Concurrent runtime Run result application diverged.", "RUNTIME_RUN_RESULT_APPLICATION_CONFLICT");
    }
  }
  return {
    status: "runtime_run_result_applied",
    authorizationId,
    application,
    resultPacket,
    freshHeadReview: freshHead.review,
  };
}

export async function executeCodexRuntimeInvocation({
  root = ".",
  authorization,
  sessionRequest = "",
  protocolEvidence,
  projectBinding,
  signal = null,
  platform = process.platform,
  environment = process.env,
  fileSystem = fs,
  spawnImplementation = spawn,
  targetResolver = resolveReadOnlyRuntimeExecutableTarget,
  supervisorSelection = null,
  providerArguments = null,
  onProcessEvent = () => {},
  evidenceMode = "actual-provider",
  persist = true,
} = {}) {
  const verified = verifyRuntimeInvocationAuthorization(authorization);
  if (!new Set(["actual-provider", "protocol-fixture"]).has(evidenceMode)) fail("Codex execution evidence mode is invalid.", "INVALID_CODEX_EXEC_EVIDENCE_MODE");
  const prepared = prepareRuntimeInvocationExecution({ root, authorization: verified, sessionRequest });
  const { target } = verifyCurrentCodexTarget({
    authorization: verified,
    protocolEvidence,
    projectBinding,
    targetResolver,
    platform,
    environment,
    fileSystem,
  });
  if (evidenceMode === "actual-provider" && providerArguments !== null) {
    fail("Actual Codex execution arguments cannot be replaced.", "CODEX_EXEC_ARGUMENT_OVERRIDE_REJECTED");
  }
  const selectedSupervisor = supervisorSelection || resolveVerifiedProcessSupervisor({ pluginRoot });
  const selectedArguments = providerArguments === null ? null : providerArguments;
  const callerFenceDigest = buildRuntimeInvocationCallerFence(prepared.projectRoot, verified.authorizationId);
  const providerMode = evidenceMode === "actual-provider" ? "actual-codex" : "codex-protocol-fixture";
  const leased = await withRuntimeExecutionLease({
    projectRoot: prepared.projectRoot,
    authorization: verified,
    ownerFenceDigest: callerFenceDigest,
  }, async ({ lease, consumption, operationalStateRoot }) => {
    verifyRuntimeExecutionLeaseOwnership({
      projectRoot: prepared.projectRoot,
      operationalStateRoot,
      authorization: verified,
      lease,
      consumption,
    });
    let schemaState;
    try {
      schemaState = createOperationalSchemaFile(operationalStateRoot, verified);
      return await runCodexChild({
        executablePath: target.executablePath,
        args: providerArguments === null
          ? codexArguments({ projectRoot: prepared.projectRoot, schemaFile: schemaState.file, workspaceMode: verified.workspaceMode })
          : selectedArguments,
        projectRoot: prepared.projectRoot,
        environment,
        authorization: verified,
        input: prepared.input,
        consumption,
        callerFenceDigest,
        signal,
        spawnImplementation,
        onProcessEvent,
        providerMode,
        sensitiveRoots: [prepared.projectRoot, operationalStateRoot],
        supervisorSelection: selectedSupervisor,
        supervisorControlFile: schemaState.controlFile,
      });
    } finally {
      removeOperationalSchemaFile(operationalStateRoot, verified, schemaState);
    }
  });
  const draft = buildRuntimeResultPacketDraft({
    authorization: verified,
    receipt: leased.result.receipt,
    leaseRelease: leased.release,
    providerResult: leased.result.providerResult,
  });
  const record = persist
    ? persistInvocationRecord({ projectRoot: prepared.projectRoot, authorization: verified, events: leased.result.events, receipt: leased.result.receipt, draft })
    : { recorded: false, eventCount: leased.result.events.length, receiptId: leased.result.receipt.receiptId, draftId: draft.draftId };
  return {
    status: leased.result.receipt.status === "completed" ? "provider_invocation_completed" : "provider_invocation_finished_with_evidence",
    authorizationId: verified.authorizationId,
    scopeKind: verified.scope.kind,
    runtime: "codex",
    providerMode,
    actualProviderInvoked: leased.result.receipt.providerBoundary.actualProviderInvoked,
    descendantTreeOwnershipValidated: leased.result.receipt.processBoundary.descendantTreeOwnershipValidated,
    receipt: leased.result.receipt,
    draft,
    executionLease: { consumption: leased.consumption, release: leased.release },
    record,
  };
}
