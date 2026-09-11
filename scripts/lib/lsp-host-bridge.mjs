import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  LSP_HOST_LIMITS,
  LspFrameParser,
  boundedFixtureCallRanges,
  boundedFixtureFunctionIdentity,
  canonicalJson,
  createPendingTable,
  createSnapshotDescriptor,
  encodeLspMessage,
  protocolError,
  relationSemanticDigest,
  relativePathFromUri,
  sha256,
  snapshotUri,
  terminalResult,
  validateRange,
  verifyOwnershipBinding,
} from "./lsp-host-protocol.mjs";
import { spawnSupervisedProcess } from "./runtime-process-supervisor.mjs";

const moduleFile = fileURLToPath(import.meta.url);
const ALLOWED_SCENARIOS = new Set([
  "barrel", "direct", "false-positive", "wrong-position", "prepare-null", "prepare-empty",
  "hierarchy-null", "hierarchy-empty", "notifications", "notification-flood", "frame-oversize",
  "server-requests", "unknown-server-request", "unknown-notification", "fragmented", "bad-header",
  "invalid-json", "unknown-id", "duplicate-id", "late-response", "timeout", "cancel", "crash",
  "ambiguous", "external-uri", "invalid-range", "grandchild", "reordered", "emoji-crlf",
  "slow-work", "slow-shutdown", "stderr-limit", "external-abort", "grandchild-cancel",
  "grandchild-flood", "delete-self",
]);

function safeOwnedRoot(qaRoot, ownedRoot) {
  const root = fs.realpathSync(path.resolve(qaRoot));
  const candidate = path.resolve(ownedRoot);
  const relative = path.relative(root, candidate);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw protocolError("invalid-input", "Owned LSP temporary root escaped or equaled its QA root.");
  }
  return { root, candidate };
}

function removeOwnedRoot(qaRoot, ownedRoot) {
  const { candidate } = safeOwnedRoot(qaRoot, ownedRoot);
  if (fs.existsSync(candidate)) fs.rmSync(candidate, { recursive: true, force: false });
}

function profileProvenance(profile) {
  if (!profile) return null;
  if (profile.kind !== "head-lsp-fake-v1" || !ALLOWED_SCENARIOS.has(profile.scenario || "barrel")
    || !path.isAbsolute(profile.serverFile || "") || !/^[a-f0-9]{64}$/.test(profile.serverDigest || "")) {
    throw protocolError("unsupported-profile", "Only a reviewed, exact fake LSP profile is supported by E1A-P.");
  }
  const stat = fs.lstatSync(profile.serverFile, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.isSymbolicLink() || sha256(fs.readFileSync(profile.serverFile)) !== profile.serverDigest) {
    throw protocolError("profile-drift", "Fake LSP profile bytes do not match the admitted digest.");
  }
  const nodeFile = fs.realpathSync(process.execPath);
  const nodeBytes = fs.readFileSync(nodeFile);
  return {
    kind: profile.kind,
    scenario: profile.scenario || "barrel",
    serverFile: fs.realpathSync(profile.serverFile),
    serverDigest: profile.serverDigest,
    nodeFile,
    nodeVersion: process.version,
    nodeDigest: sha256(nodeBytes),
    producerDigest: sha256(canonicalJson({
      kind: profile.kind,
      serverDigest: profile.serverDigest,
      nodeDigest: sha256(nodeBytes),
      nodeVersion: process.version,
    })),
  };
}

function baseProvenance(collectionId, descriptor, producerDigest = null) {
  return {
    collectionId,
    projectId: descriptor?.projectId ?? null,
    generationDigest: descriptor?.generationDigest ?? null,
    snapshotManifestDigest: descriptor?.snapshotManifestDigest ?? null,
    producerDigest,
  };
}

function terminalFromError(error, provenance, cleanup, fallbackStage = "launch") {
  const contaminated = new Set([
    "mapping-mismatch", "project-mismatch", "generation-mismatch", "manifest-mismatch", "producer-mismatch",
    "uri-outside-snapshot", "invalid-range", "source-drift", "config-drift", "profile-drift",
  ]);
  const reason = error?.code && [
    "invalid-input", "launch-failed", "request-timeout", "cancelled", "frame-oversize", "stdout-limit",
    "stderr-limit", "frame-limit", "notification-limit", "invalid-framing", "invalid-json", "invalid-message",
    "unsupported-server-request", "unsupported-server-notification", "unknown-response-id", "duplicate-response-id",
    "late-response", "ambiguous-prepared-item", "invalid-prepare-result", "invalid-hierarchy-result",
    "process-crash", "cleanup-failed", "limit-exceeded", "mapping-mismatch", "project-mismatch",
    "generation-mismatch", "manifest-mismatch", "producer-mismatch", "uri-outside-snapshot", "invalid-range",
    "source-drift", "config-drift", "profile-drift",
  ].includes(error.code) ? error.code : "launch-failed";
  const failureStage = error?.details?.stage || fallbackStage;
  return terminalResult({
    status: contaminated.has(reason) ? "contaminated" : "failed",
    reason,
    stage: "closed",
    failureStage,
    provenance,
    cleanup,
  });
}

function writeImmutableSnapshot(root, descriptor, collectionId) {
  const manifest = [];
  for (const document of descriptor.documents) {
    const file = path.join(root, ...document.path.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, document.text, { encoding: "utf8", flag: "wx" });
    try { fs.chmodSync(file, 0o444); } catch {}
    manifest.push({ ...document, uri: snapshotUri(collectionId, document.path), file });
  }
  return manifest;
}

function assertSnapshotUnchanged(documents) {
  for (const document of documents) {
    const bytes = fs.readFileSync(document.file);
    if (bytes.length !== document.bytes || sha256(bytes) !== document.digest) {
      throw protocolError(document.path === "tsconfig.json" ? "config-drift" : "source-drift", "Owned LSP snapshot changed during collection.");
    }
  }
}

async function waitForClose(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

async function waitForChildCleanup(childExit, child, timeoutMs = LSP_HOST_LIMITS.gracefulCleanupMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch {}
      finish({ code: null, signal: "SIGTERM" });
    }, timeoutMs);
    childExit.then(finish);
  });
}

export async function collectOutgoingCallEvidence({
  projectId,
  generationDigest,
  sources,
  profile = null,
  supervisorSelection = null,
  qaRoot,
  signal = null,
  onProcessEvent = () => {},
} = {}) {
  const collectionStartedAt = Date.now();
  const collectionId = `lsp-${crypto.randomUUID()}`;
  if (!profile) return terminalResult({ status: "not-configured", reason: "no-profile", stage: "discovery", provenance: { collectionId } });
  let descriptor;
  let producer;
  try {
    descriptor = createSnapshotDescriptor({ projectId, generationDigest, sources });
    producer = profileProvenance(profile);
  } catch (error) {
    const status = error.code === "unsupported-profile" ? "unsupported" : error.code === "profile-drift" ? "contaminated" : "failed";
    return terminalResult({ status, reason: error.code || "invalid-input", stage: "discovery", failureStage: "discovery", provenance: baseProvenance(collectionId, descriptor, producer?.producerDigest) });
  }
  const provenance = baseProvenance(collectionId, descriptor, producer.producerDigest);
  if (!supervisorSelection) return terminalResult({ status: "unsupported", reason: "unsupported-profile", stage: "discovery", provenance });
  if (typeof qaRoot !== "string" || !path.isAbsolute(qaRoot) || !fs.existsSync(qaRoot)) {
    return terminalFromError(protocolError("invalid-input", "An existing absolute QA root is required."), provenance, {}, "discovery");
  }

  let ownedRoot = null;
  let snapshotDocuments = [];
  let supervised;
  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  let outerFailure = null;
  let forced = false;
  let softTimer;
  let forceTimer;
  let abortHandler;
  let result;
  try {
    ownedRoot = fs.mkdtempSync(path.join(fs.realpathSync(qaRoot), "lsp-host-"));
    safeOwnedRoot(qaRoot, ownedRoot);
    const controlFile = path.join(ownedRoot, "supervisor-control.jsonl");
    const cancelFile = path.join(ownedRoot, "cancel.json");
    const snapshotRoot = path.join(ownedRoot, "snapshot");
    fs.mkdirSync(snapshotRoot, { recursive: false });
    snapshotDocuments = writeImmutableSnapshot(snapshotRoot, descriptor, collectionId);
    const request = {
      schemaVersion: 1,
      expectedBinding: provenance,
      binding: provenance,
      profile: producer,
      scenario: producer.scenario,
      deadlines: {
        workEpochMs: collectionStartedAt + LSP_HOST_LIMITS.workBudgetMs,
        closingEpochMs: collectionStartedAt + LSP_HOST_LIMITS.workBudgetMs + LSP_HOST_LIMITS.gracefulCleanupMs,
        totalEpochMs: collectionStartedAt + LSP_HOST_LIMITS.totalTimeoutMs,
      },
      cancelFile,
      documents: snapshotDocuments.map(({ path: relativePath, languageId, text, bytes, digest, uri }) => ({ relativePath, languageId, text, bytes, digest, uri })),
    };
    supervised = spawnSupervisedProcess({
      selection: supervisorSelection,
      executablePath: process.execPath,
      args: [moduleFile, "--bridge", "--cancel-file", cancelFile],
      cwd: path.dirname(moduleFile),
      providerEnvironment: {
        SystemRoot: process.env.SystemRoot || process.env.SYSTEMROOT || "",
        PATH: process.env.PATH || "",
      },
      input: Buffer.from(canonicalJson(request), "utf8"),
      controlFile,
      terminationGraceMs: LSP_HOST_LIMITS.gracefulCleanupMs,
      onControlEvent: (event) => {
        if (event.type === "provider.started") onProcessEvent({ type: "spawn", pid: event.providerPid, parentPid: supervised?.child.pid || process.pid, command: "node lsp-host-bridge --bridge", cwd: path.dirname(moduleFile), ports: "none" });
        if (event.type === "provider.exited") onProcessEvent({ type: "exit", pid: event.providerPid, parentPid: supervised?.child.pid || process.pid, exitCode: event.exitCode, signal: "none" });
      },
    });
    onProcessEvent({ type: "spawn", pid: supervised.child.pid, parentPid: process.pid, command: "head-agent-supervisor", cwd: path.dirname(supervisorSelection.binaryPath), ports: "none" });
    const requestCancel = () => {
      if (!fs.existsSync(cancelFile)) {
        try { fs.writeFileSync(cancelFile, canonicalJson({ collectionId, requestedAt: Date.now() }), { encoding: "utf8", flag: "wx" }); } catch {}
      }
    };
    const stop = (reason, force = false) => {
      outerFailure ||= protocolError(reason, `LSP Host ${reason}.`, { stage: "closing" });
      if (force) forced = true;
      supervised.terminate(force);
    };
    softTimer = setTimeout(() => stop("request-timeout", false), Math.max(1, request.deadlines.closingEpochMs - Date.now()));
    forceTimer = setTimeout(() => stop("request-timeout", true), Math.max(1, request.deadlines.totalEpochMs - Date.now()));
    softTimer.unref?.();
    forceTimer.unref?.();
    if (signal) {
      if (signal.aborted) requestCancel();
      else { abortHandler = requestCancel; signal.addEventListener("abort", abortHandler, { once: true }); }
    }
    supervised.child.stdout.on("data", (chunk) => {
      if (outerFailure) return;
      if (stdout.length + chunk.length > LSP_HOST_LIMITS.maxStdoutBytes) { stop("stdout-limit", false); return; }
      stdout = Buffer.concat([stdout, chunk]);
    });
    supervised.child.stderr.on("data", (chunk) => {
      if (outerFailure) return;
      if (stderr.length + chunk.length > LSP_HOST_LIMITS.maxStderrBytes) { stop("stderr-limit", false); return; }
      stderr = Buffer.concat([stderr, chunk]);
    });
    const closed = await waitForClose(supervised.child);
    onProcessEvent({ type: "exit", pid: supervised.child.pid, parentPid: process.pid, exitCode: closed.code, signal: closed.signal || "none" });
    clearTimeout(softTimer);
    clearTimeout(forceTimer);
    if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
    assertSnapshotUnchanged(snapshotDocuments);
    let finalProducer;
    try { finalProducer = profileProvenance(profile); }
    catch { throw protocolError("producer-mismatch", "Fake LSP producer disappeared or changed before result publication.", { stage: "closing" }); }
    if (finalProducer.producerDigest !== producer.producerDigest) throw protocolError("producer-mismatch", "Fake LSP producer changed before result publication.", { stage: "closing" });
    const supervision = supervised.finalize({ exactSupervisorExitObserved: true, terminationRequested: Boolean(outerFailure) });
    const cleanup = { attempted: true, verified: supervision.treeCleanupVerified, forced };
    if (outerFailure) result = terminalFromError(outerFailure, provenance, cleanup);
    else if (!supervision.ownershipEstablished || !supervision.treeCleanupVerified) result = terminalFromError(protocolError("cleanup-failed", "Owned LSP process tree cleanup was not verified.", { stage: "closing" }), provenance, cleanup);
    else if (closed.code !== 0) result = terminalFromError(protocolError("process-crash", `LSP bridge exited ${closed.code}: ${stderr.toString("utf8").slice(0, 512)}`, { stage: "launch" }), provenance, cleanup);
    const lines = stdout.toString("utf8").split(/\r?\n/).filter(Boolean);
    if (!result) {
      if (lines.length !== 1) result = terminalFromError(protocolError("invalid-message", "LSP bridge did not emit exactly one result envelope.", { stage: "closing" }), provenance, cleanup);
      else {
        try { result = JSON.parse(lines[0]); }
        catch { result = terminalFromError(protocolError("invalid-json", "LSP bridge result is invalid JSON.", { stage: "closing" }), provenance, cleanup); }
      }
    }
    if (result.provenance) {
      const expectedResultProvenance = { ...provenance, publishedCandidateCount: result.provenance.publishedCandidateCount ?? 0 };
      if (canonicalJson(result.provenance) !== canonicalJson(expectedResultProvenance)) result = terminalFromError(protocolError("mapping-mismatch", "LSP bridge result mapping does not match its Host-owned collection.", { stage: "closing" }), provenance, cleanup);
    }
    result = Object.freeze({ ...result, cleanup, transport: { supervisorManifestDigest: supervision.supervisorManifestDigest, ownershipEstablished: supervision.ownershipEstablished, treeCleanupVerified: supervision.treeCleanupVerified } });
  } catch (error) {
    if (supervised?.child && supervised.child.exitCode === null && supervised.child.signalCode === null) {
      supervised.terminate(true);
      try { await waitForClose(supervised.child); } catch {}
    }
    result = terminalFromError(error, provenance, { attempted: Boolean(supervised), verified: false, forced: true }, error?.details?.stage || "launch");
  } finally {
    clearTimeout(softTimer);
    clearTimeout(forceTimer);
    if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
    if (ownedRoot) {
      try { removeOwnedRoot(qaRoot, ownedRoot); }
      catch (error) { result = terminalFromError(protocolError("cleanup-failed", `Owned LSP temporary root cleanup failed: ${error.message}`, { stage: "closing" }), provenance, { attempted: true, verified: false, forced }, "closing"); }
    }
  }
  return result;
}

function positionOf(text, needle) {
  const offset = text.indexOf(needle);
  if (offset < 0) throw protocolError("invalid-input", `Fixture marker ${needle} is missing.`);
  const before = text.slice(0, offset);
  const lines = before.split("\n");
  return { line: lines.length - 1, character: lines.at(-1).replace(/\r$/, "").length };
}

function validateMessageBase(message) {
  if (message.jsonrpc !== "2.0") throw protocolError("invalid-message", "LSP message lacks jsonrpc 2.0.");
}

function validateItem(item, documents, collectionId, expected = null) {
  if (!item || typeof item !== "object" || typeof item.name !== "string" || typeof item.kind !== "number") throw protocolError("invalid-hierarchy-result", "Call hierarchy item is invalid.");
  const allowed = new Set(documents.map((document) => document.relativePath));
  const relativePath = relativePathFromUri(item.uri, collectionId, allowed);
  const document = documents.find((candidate) => candidate.relativePath === relativePath);
  const itemRange = validateRange(document.text, item.range);
  const selectionRange = validateRange(document.text, item.selectionRange);
  if (selectionRange.start < itemRange.start || selectionRange.end > itemRange.end) throw protocolError("invalid-range", "Call hierarchy selectionRange escaped its symbol range.");
  if (expected && (item.name !== expected.name || item.kind !== 12 || item.uri !== document.uri
    || canonicalJson(item.range) !== canonicalJson(expected.range)
    || canonicalJson(item.selectionRange) !== canonicalJson(expected.selectionRange))) {
    throw protocolError("mapping-mismatch", "Call hierarchy item does not match the requested fixture declaration.");
  }
  return { relativePath, document };
}

async function runBridge(request) {
  const binding = request?.binding;
  const documents = request?.documents;
  verifyOwnershipBinding(request?.expectedBinding, binding);
  const cancelArg = process.argv.indexOf("--cancel-file");
  if (!Array.isArray(documents) || documents.length !== 4 || !path.isAbsolute(request?.cancelFile || "")
    || cancelArg < 0 || process.argv[cancelArg + 1] !== request.cancelFile
    || !request.deadlines || ![request.deadlines.workEpochMs, request.deadlines.closingEpochMs, request.deadlines.totalEpochMs].every(Number.isSafeInteger)
    || request.deadlines.workEpochMs > request.deadlines.closingEpochMs || request.deadlines.closingEpochMs > request.deadlines.totalEpochMs
    || canonicalJson(request.profile?.producerDigest) !== canonicalJson(binding.producerDigest)) {
    throw protocolError("mapping-mismatch", "Bridge input ownership or deadline mapping is invalid.", { stage: "launch" });
  }
  if (request.profile.serverDigest !== sha256(fs.readFileSync(request.profile.serverFile)) || request.profile.nodeDigest !== sha256(fs.readFileSync(process.execPath))) {
    throw protocolError("producer-mismatch", "Bridge producer changed after Host admission.", { stage: "launch" });
  }
  for (const document of documents) {
    if (Buffer.byteLength(document.text, "utf8") !== document.bytes || sha256(Buffer.from(document.text, "utf8")) !== document.digest) {
      throw protocolError(document.relativePath === "tsconfig.json" ? "config-drift" : "source-drift", "Bridge snapshot bytes changed.", { stage: "launch" });
    }
  }
  const child = spawn(process.execPath, [request.profile.serverFile, request.scenario], {
    cwd: path.dirname(request.profile.serverFile),
    env: { SystemRoot: process.env.SystemRoot || process.env.SYSTEMROOT || "", PATH: process.env.PATH || "", LANG: "C" },
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const parser = new LspFrameParser();
  const pending = createPendingTable(binding);
  const waiters = new Map();
  const opened = [];
  const transcript = [];
  const fixtureOwnedProcesses = [{ pid: child.pid, parentPid: process.pid, observedAt: new Date().toISOString(), command: "node lsp-host-fake-server", cwd: path.dirname(request.profile.serverFile), ports: "none" }];
  let stage = "initialize";
  let notificationCount = 0;
  let stderrBytes = 0;
  let firstAsyncFailure = null;
  let fatalTransport = false;
  let childClosed = false;

  const settleOutstanding = (error, fatal = false) => {
    firstAsyncFailure ||= error;
    fatalTransport ||= fatal;
    for (const waiter of waiters.values()) waiter.reject(firstAsyncFailure);
    waiters.clear();
  };
  const send = (message) => {
    if (childClosed || child.stdin.destroyed) throw protocolError("process-crash", "LSP transport is closed.", { stage });
    transcript.push({ direction: "out", method: message.method || null, id: message.id ?? null });
    child.stdin.write(encodeLspMessage(message));
  };
  const requestWithDeadline = (method, params, requestStage, deadlineEpochMs) => {
    if (fatalTransport) return Promise.reject(firstAsyncFailure);
    const remaining = Math.min(LSP_HOST_LIMITS.requestTimeoutMs, deadlineEpochMs - Date.now());
    if (remaining <= 0) return Promise.reject(protocolError("request-timeout", `LSP ${requestStage} exhausted its shared deadline.`, { stage: requestStage }));
    const id = pending.issue(method);
    send({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.delete(id);
        reject(protocolError("request-timeout", `LSP ${requestStage} request timed out.`, { stage: requestStage }));
      }, remaining);
      waiters.set(id, {
        method,
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
    });
  };
  const serverRequestResponse = (message) => {
    const id = message.id;
    if (message.method === "workspace/configuration") {
      if (!Array.isArray(message.params?.items) || message.params.items.length > LSP_HOST_LIMITS.maxConfigurationItems) throw protocolError("limit-exceeded", "workspace/configuration exceeded its item bound.", { stage });
      send({ jsonrpc: "2.0", id, result: message.params.items.map(() => null) });
    } else if (message.method === "workspace/applyEdit") {
      send({ jsonrpc: "2.0", id, result: { applied: false, failureReason: "HEAD LSP Host profile is read-only" } });
    } else if (message.method === "window/workDoneProgress/create") {
      const token = message.params?.token;
      if (!(typeof token === "string" || typeof token === "number") || String(token).length > 256) throw protocolError("invalid-message", "Progress token is invalid.", { stage });
      send({ jsonrpc: "2.0", id, result: null });
    } else if (message.method === "window/showMessageRequest") {
      if (typeof message.params?.message !== "string" || message.params.message.length > 4096 || !Array.isArray(message.params.actions) || message.params.actions.length > 16) throw protocolError("invalid-message", "showMessageRequest is invalid.", { stage });
      send({ jsonrpc: "2.0", id, result: null });
    } else {
      send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not supported" } });
      throw protocolError("unsupported-server-request", "LSP server requested an unsupported Host operation.", { stage });
    }
  };
  const allowedNotifications = new Set(["window/logMessage", "window/showMessage", "$/progress", "textDocument/publishDiagnostics", "_typescript.version", "telemetry/event"]);
  const requestFailureStage = (method) => method === "textDocument/prepareCallHierarchy" ? "prepare"
    : method === "callHierarchy/outgoingCalls" ? "hierarchy"
      : method === "initialize" ? "initialize"
        : null;
  const handle = (message) => {
    validateMessageBase(message);
    transcript.push({ direction: "in", method: message.method || null, id: message.id ?? null });
    if ("method" in message && "id" in message) return serverRequestResponse(message);
    if ("method" in message) {
      notificationCount += 1;
      if (notificationCount > LSP_HOST_LIMITS.maxNotifications) throw protocolError("notification-limit", "LSP notification count exceeded its bound.", { stage });
      if (!allowedNotifications.has(message.method)) throw protocolError("unsupported-server-notification", "LSP server emitted an unsupported notification.", { stage });
      if (message.method === "telemetry/event" && Number.isSafeInteger(message.params?.headTestDescendantPid) && message.params.headTestDescendantPid > 0) {
        fixtureOwnedProcesses.push({ pid: message.params.headTestDescendantPid, parentPid: child.pid, observedAt: new Date().toISOString(), command: "node lsp-host-child", cwd: path.dirname(request.profile.serverFile), ports: "none" });
      }
      return;
    }
    const entry = pending.consume(message, binding);
    const waiter = waiters.get(message.id);
    if (!waiter) throw protocolError("late-response", "LSP response arrived after its bounded waiter closed.", { stage });
    if (waiter.method !== entry.method) throw protocolError("mapping-mismatch", "Bridge pending table diverged from the response waiter.", { stage });
    waiters.delete(message.id);
    if ("error" in message) waiter.reject(protocolError("invalid-message", `LSP request ${entry.method} failed.`, { stage }));
    else waiter.resolve(message.result);
  };
  child.stdout.on("data", (chunk) => {
    if (fatalTransport) return;
    try { for (const message of parser.feed(chunk)) handle(message); }
    catch (error) { settleOutstanding(Object.assign(error, { details: { ...error.details, stage: error.details?.stage || requestFailureStage(error.details?.method) || stage } }), true); child.stdout.pause(); }
  });
  child.stderr.on("data", (chunk) => {
    if (fatalTransport) return;
    stderrBytes += chunk.length;
    if (stderrBytes > LSP_HOST_LIMITS.maxStderrBytes) {
      settleOutstanding(protocolError("stderr-limit", "LSP stderr exceeded its bound.", { stage }), true);
      child.stderr.destroy();
    }
  });
  child.stdin.on("error", (error) => settleOutstanding(protocolError("process-crash", `LSP stdin failed: ${error.message}`, { stage }), true));
  const childExit = new Promise((resolve) => child.once("close", (code, signal) => {
    childClosed = true;
    if (waiters.size > 0) settleOutstanding(protocolError("process-crash", "Fake LSP server exited with outstanding requests.", { stage }), true);
    resolve({ code, signal });
  }));
  const cancelPoll = setInterval(() => {
    if (!firstAsyncFailure && fs.existsSync(request.cancelFile)) settleOutstanding(protocolError("cancelled", "LSP collection was cancelled by its Host owner.", { stage }), false);
  }, 10);
  cancelPoll.unref?.();

  let candidates = [];
  let reason = "empty";
  let failure = null;
  const caller = documents.find((item) => item.relativePath === "caller.ts");
  const targetDocument = documents.find((item) => item.relativePath === "target.ts");
  const callerIdentity = caller ? boundedFixtureFunctionIdentity(caller.text, "caller") : null;
  const targetIdentity = targetDocument ? boundedFixtureFunctionIdentity(targetDocument.text, "target") : null;
  try {
    const initialized = await requestWithDeadline("initialize", { processId: process.pid, rootUri: null, capabilities: {} }, "initialize", request.deadlines.workEpochMs);
    if (!initialized || typeof initialized !== "object") throw protocolError("invalid-message", "LSP initialize result is invalid.", { stage });
    send({ jsonrpc: "2.0", method: "initialized", params: {} });
    stage = "open";
    for (const document of documents.filter((item) => item.languageId === "typescript")) {
      send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri: document.uri, languageId: document.languageId, version: 1, text: document.text } } });
      opened.push(document);
    }
    if (!caller || !callerIdentity) { reason = "no-prepared-item"; }
    else {
      stage = "prepare";
      const prepared = await requestWithDeadline("textDocument/prepareCallHierarchy", { textDocument: { uri: caller.uri }, position: callerIdentity.selectionRange.start }, "prepare", request.deadlines.workEpochMs);
      if (prepared === null || Array.isArray(prepared) && prepared.length === 0) reason = "no-prepared-item";
      else {
        if (!Array.isArray(prepared)) throw protocolError("invalid-prepare-result", "prepareCallHierarchy did not return an array or null.", { stage });
        if (prepared.length !== 1) throw protocolError("ambiguous-prepared-item", "prepareCallHierarchy returned more than one item.", { stage });
        validateItem(prepared[0], documents, binding.collectionId, callerIdentity);
        stage = "hierarchy";
        const outgoing = await requestWithDeadline("callHierarchy/outgoingCalls", { item: prepared[0] }, "hierarchy", request.deadlines.workEpochMs);
        if (outgoing === null || Array.isArray(outgoing) && outgoing.length === 0) reason = "empty";
        else {
          if (!Array.isArray(outgoing) || outgoing.length > 256) throw protocolError("invalid-hierarchy-result", "outgoingCalls did not return a bounded array or null.", { stage });
          if (!targetIdentity) throw protocolError("mapping-mismatch", "Outgoing target fixture declaration is missing.", { stage });
          const allowedRanges = boundedFixtureCallRanges(caller.text, callerIdentity, "target");
          const allowedKeys = new Set(allowedRanges.map(canonicalJson));
          const observedKeys = new Set();
          for (const relation of outgoing) {
            if (!relation || !Array.isArray(relation.fromRanges) || relation.fromRanges.length < 1 || relation.fromRanges.length > 256) throw protocolError("invalid-hierarchy-result", "Outgoing call relation is invalid.", { stage });
            const target = validateItem(relation.to, documents, binding.collectionId, targetIdentity);
            if (target.relativePath !== "target.ts") throw protocolError("mapping-mismatch", "Outgoing relation changed the fixture target document.", { stage });
            for (const fromRange of relation.fromRanges) {
              validateRange(caller.text, fromRange);
              const key = canonicalJson(fromRange);
              if (!allowedKeys.has(key)) throw protocolError("mapping-mismatch", "Outgoing callsite does not match an actual fixture call expression.", { stage });
              observedKeys.add(key);
              const candidate = { direction: "outgoing", caller: { path: "caller.ts", range: fromRange }, target: { path: "target.ts", range: relation.to.selectionRange, name: relation.to.name } };
              candidates.push({ ...candidate, semanticDigest: relationSemanticDigest({
                projectId: binding.projectId, generationDigest: binding.generationDigest, snapshotManifestDigest: binding.snapshotManifestDigest,
                producerDigest: binding.producerDigest, direction: candidate.direction, callerPath: candidate.caller.path,
                callerRange: candidate.caller.range, targetPath: candidate.target.path, targetRange: candidate.target.range,
              }) });
            }
          }
          if (observedKeys.size !== allowedKeys.size || [...allowedKeys].some((key) => !observedKeys.has(key))) throw protocolError("invalid-hierarchy-result", "Outgoing result omitted an admitted fixture callsite.", { stage });
          candidates = [...new Map(candidates.map((candidate) => [candidate.semanticDigest, candidate])).values()]
            .sort((left, right) => left.semanticDigest < right.semanticDigest ? -1 : left.semanticDigest > right.semanticDigest ? 1 : 0);
          reason = candidates.length > 0 ? "candidates" : "empty";
        }
      }
    }
  } catch (error) {
    failure = firstAsyncFailure || error;
  }

  const originalFailure = failure || firstAsyncFailure;
  stage = "closing";
  if (originalFailure) {
    for (const id of pending.outstanding()) { try { send({ jsonrpc: "2.0", method: "$/cancelRequest", params: { id } }); } catch {} }
  }
  for (const document of opened) { try { send({ jsonrpc: "2.0", method: "textDocument/didClose", params: { textDocument: { uri: document.uri } } }); } catch {} }
  if (fatalTransport && !childClosed) {
    try { child.stdin.end(); child.kill("SIGTERM"); } catch {}
  } else if (!childClosed) {
    const closingDeadline = Math.min(request.deadlines.closingEpochMs, Date.now() + LSP_HOST_LIMITS.gracefulCleanupMs);
    try { await requestWithDeadline("shutdown", null, "closing", closingDeadline); }
    catch (error) { failure ||= originalFailure || firstAsyncFailure || error; }
    try { send({ jsonrpc: "2.0", method: "exit", params: null }); child.stdin.end(); } catch {}
  }
  const closed = await waitForChildCleanup(childExit, child, Math.max(1, Math.min(LSP_HOST_LIMITS.gracefulCleanupMs, request.deadlines.totalEpochMs - Date.now())));
  clearInterval(cancelPoll);
  try { parser.end(); } catch (error) { failure ||= originalFailure || firstAsyncFailure || Object.assign(error, { details: { ...error.details, stage: error.details?.stage || stage } }); }
  failure ||= originalFailure || firstAsyncFailure;
  if (closed.code !== 0 && !failure) failure = protocolError("process-crash", "Fake LSP server exited unexpectedly.", { stage });
  if (failure) return Object.freeze({
    ...terminalFromError(failure, binding, { attempted: true, verified: childClosed || closed.signal === "SIGTERM", forced: closed.signal === "SIGTERM" }, failure.details?.stage || stage),
    fixtureTransport: { ownedPids: fixtureOwnedProcesses.map((item) => item.pid), ownedProcesses: fixtureOwnedProcesses, transcript },
  });
  return Object.freeze({
    ...terminalResult({ status: "completed", reason, stage: "closed", provenance: binding, candidates, cleanup: { attempted: true, verified: true, forced: false } }),
    fixtureTransport: { ownedPids: fixtureOwnedProcesses.map((item) => item.pid), ownedProcesses: fixtureOwnedProcesses, transcript },
  });
}

async function readStdinBounded() {
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    total += chunk.length;
    if (total > 4 * 1024 * 1024) throw protocolError("limit-exceeded", "Bridge input exceeded its transport bound.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

if (process.argv[1] && path.resolve(process.argv[1]) === moduleFile && process.argv[2] === "--bridge") {
  try {
    const result = await runBridge(await readStdinBounded());
    process.stdout.write(`${canonicalJson(result)}\n`);
  } catch (error) {
    const fallback = terminalFromError(error, {}, { attempted: true, verified: false, forced: false }, error?.details?.stage || "launch");
    process.stdout.write(`${canonicalJson(fallback)}\n`);
  }
}

export const __private = Object.freeze({ ALLOWED_SCENARIOS, runBridge, safeOwnedRoot, profileProvenance });
