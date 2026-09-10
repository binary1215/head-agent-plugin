import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  LSP_HOST_LIMITS,
  LspFrameParser,
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

async function waitForChildCleanup(childExit, child) {
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
    }, LSP_HOST_LIMITS.gracefulCleanupMs);
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

  const ownedRoot = fs.mkdtempSync(path.join(fs.realpathSync(qaRoot), "lsp-host-"));
  safeOwnedRoot(qaRoot, ownedRoot);
  const controlFile = path.join(ownedRoot, "supervisor-control.jsonl");
  const snapshotRoot = path.join(ownedRoot, "snapshot");
  fs.mkdirSync(snapshotRoot, { recursive: false });
  const snapshotDocuments = writeImmutableSnapshot(snapshotRoot, descriptor, collectionId);
  const request = {
    schemaVersion: 1,
    expectedBinding: provenance,
    binding: provenance,
    profile: producer,
    scenario: producer.scenario,
    documents: snapshotDocuments.map(({ path: relativePath, languageId, text, bytes, digest, uri }) => ({ relativePath, languageId, text, bytes, digest, uri })),
  };
  let supervised;
  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  let timedOut = false;
  let cancelled = false;
  let transportLimit = null;
  let forced = false;
  let timer;
  let forceTimer;
  let abortHandler;
  try {
    supervised = spawnSupervisedProcess({
      selection: supervisorSelection,
      executablePath: process.execPath,
      args: [moduleFile, "--bridge"],
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
    const terminate = (kind) => {
      if (kind === "timeout") timedOut = true;
      if (kind === "cancel") cancelled = true;
      if (kind === "stdout-limit" || kind === "stderr-limit") transportLimit = kind;
      supervised.terminate(false);
      forceTimer = setTimeout(() => { forced = true; supervised.terminate(true); }, LSP_HOST_LIMITS.forceCleanupMs);
      forceTimer.unref?.();
    };
    timer = setTimeout(() => terminate("timeout"), LSP_HOST_LIMITS.totalTimeoutMs);
    if (signal) {
      if (signal.aborted) terminate("cancel");
      else { abortHandler = () => terminate("cancel"); signal.addEventListener("abort", abortHandler, { once: true }); }
    }
    supervised.child.stdout.on("data", (chunk) => {
      stdout = Buffer.concat([stdout, chunk]);
      if (stdout.length > LSP_HOST_LIMITS.maxStdoutBytes) terminate("stdout-limit");
    });
    supervised.child.stderr.on("data", (chunk) => {
      stderr = Buffer.concat([stderr, chunk]);
      if (stderr.length > LSP_HOST_LIMITS.maxStderrBytes) terminate("stderr-limit");
    });
    const closed = await waitForClose(supervised.child);
    onProcessEvent({ type: "exit", pid: supervised.child.pid, parentPid: process.pid, exitCode: closed.code, signal: closed.signal || "none" });
    clearTimeout(timer);
    clearTimeout(forceTimer);
    if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
    assertSnapshotUnchanged(snapshotDocuments);
    const supervision = supervised.finalize({ exactSupervisorExitObserved: true, terminationRequested: timedOut || cancelled });
    const cleanup = { attempted: true, verified: supervision.treeCleanupVerified, forced };
    if (cancelled) return terminalFromError(protocolError("cancelled", "LSP collection was cancelled.", { stage: "launch" }), provenance, cleanup);
    if (timedOut) return terminalFromError(protocolError("request-timeout", "LSP collection exceeded its total deadline.", { stage: "launch" }), provenance, cleanup);
    if (transportLimit) return terminalFromError(protocolError(transportLimit, "LSP bridge transport exceeded its byte bound.", { stage: "launch" }), provenance, cleanup);
    if (!supervision.ownershipEstablished || !supervision.treeCleanupVerified) return terminalFromError(protocolError("cleanup-failed", "Owned LSP process tree cleanup was not verified.", { stage: "closing" }), provenance, cleanup);
    if (closed.code !== 0) return terminalFromError(protocolError("process-crash", `LSP bridge exited ${closed.code}: ${stderr.toString("utf8").slice(0, 512)}`, { stage: "launch" }), provenance, cleanup);
    const lines = stdout.toString("utf8").split(/\r?\n/).filter(Boolean);
    if (lines.length !== 1) return terminalFromError(protocolError("invalid-message", "LSP bridge did not emit exactly one result envelope.", { stage: "closing" }), provenance, cleanup);
    let result;
    try { result = JSON.parse(lines[0]); } catch { return terminalFromError(protocolError("invalid-json", "LSP bridge result is invalid JSON.", { stage: "closing" }), provenance, cleanup); }
    const expectedResultProvenance = { ...provenance, publishedCandidateCount: result.provenance?.publishedCandidateCount ?? 0 };
    if (canonicalJson(result.provenance) !== canonicalJson(expectedResultProvenance)) {
      return terminalFromError(protocolError("mapping-mismatch", "LSP bridge result mapping does not match its Host-owned collection.", { stage: "closing" }), provenance, cleanup);
    }
    return Object.freeze({ ...result, cleanup, transport: { supervisorManifestDigest: supervision.supervisorManifestDigest, ownershipEstablished: supervision.ownershipEstablished, treeCleanupVerified: supervision.treeCleanupVerified } });
  } catch (error) {
    if (supervised?.child && supervised.child.exitCode === null && supervised.child.signalCode === null) {
      supervised.terminate(true);
      try { await waitForClose(supervised.child); } catch {}
    }
    return terminalFromError(error, provenance, { attempted: Boolean(supervised), verified: false, forced: true }, error?.details?.stage || "launch");
  } finally {
    clearTimeout(timer);
    clearTimeout(forceTimer);
    if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
    try { removeOwnedRoot(qaRoot, ownedRoot); } catch {}
  }
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

function validateItem(item, documents, collectionId) {
  if (!item || typeof item !== "object" || typeof item.name !== "string" || typeof item.kind !== "number") throw protocolError("invalid-hierarchy-result", "Call hierarchy item is invalid.");
  const allowed = new Set(documents.map((document) => document.relativePath));
  const relativePath = relativePathFromUri(item.uri, collectionId, allowed);
  const document = documents.find((candidate) => candidate.relativePath === relativePath);
  validateRange(document.text, item.range);
  validateRange(document.text, item.selectionRange);
  return { relativePath, document };
}

async function runBridge(request) {
  const binding = request?.binding;
  const documents = request?.documents;
  verifyOwnershipBinding(request?.expectedBinding, binding);
  if (!Array.isArray(documents) || documents.length !== 4 || canonicalJson(request.profile?.producerDigest) !== canonicalJson(binding.producerDigest)) {
    throw protocolError("mapping-mismatch", "Bridge input ownership is invalid.", { stage: "launch" });
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
  let stage = "initialize";
  let notificationCount = 0;
  const fixtureOwnedPids = [];
  let stderrBytes = 0;
  let terminalError = null;
  let childClosed = false;

  const send = (message) => {
    transcript.push({ direction: "out", method: message.method || null, id: message.id ?? null });
    child.stdin.write(encodeLspMessage(message));
  };
  const requestServer = (method, params) => {
    if (terminalError) throw terminalError;
    const id = pending.issue(method);
    send({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => waiters.set(id, { resolve, reject, method }));
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
  const handle = (message) => {
    validateMessageBase(message);
    transcript.push({ direction: "in", method: message.method || null, id: message.id ?? null });
    if ("method" in message && "id" in message) return serverRequestResponse(message);
    if ("method" in message) {
      notificationCount += 1;
      if (notificationCount > LSP_HOST_LIMITS.maxNotifications) throw protocolError("notification-limit", "LSP notification count exceeded its bound.", { stage });
      if (!allowedNotifications.has(message.method)) throw protocolError("unsupported-server-notification", "LSP server emitted an unsupported notification.", { stage });
      if (message.method === "telemetry/event" && Number.isSafeInteger(message.params?.headTestDescendantPid) && message.params.headTestDescendantPid > 0) {
        fixtureOwnedPids.push(message.params.headTestDescendantPid);
      }
      return;
    }
    const entry = pending.consume(message, binding);
    const waiter = waiters.get(message.id);
    if (!waiter || waiter.method !== entry.method) throw protocolError("mapping-mismatch", "Bridge pending table diverged from the response waiter.", { stage });
    waiters.delete(message.id);
    if ("error" in message) waiter.reject(protocolError("invalid-message", `LSP request ${entry.method} failed.`, { stage }));
    else waiter.resolve(message.result);
  };
  child.stdout.on("data", (chunk) => {
    if (terminalError) return;
    try { for (const message of parser.feed(chunk)) handle(message); }
    catch (error) { terminalError = error; for (const waiter of waiters.values()) waiter.reject(error); waiters.clear(); }
  });
  child.stderr.on("data", (chunk) => {
    stderrBytes += chunk.length;
    if (stderrBytes > LSP_HOST_LIMITS.maxStderrBytes && !terminalError) terminalError = protocolError("stderr-limit", "LSP stderr exceeded its bound.", { stage });
  });
  const childExit = new Promise((resolve) => child.once("close", (code, signal) => {
    childClosed = true;
    if (waiters.size > 0 && !terminalError) {
      terminalError = protocolError("process-crash", "Fake LSP server exited with outstanding requests.", { stage });
      for (const waiter of waiters.values()) waiter.reject(terminalError);
      waiters.clear();
    }
    resolve({ code, signal });
  }));

  const withDeadline = (promise, requestStage) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(protocolError("request-timeout", `LSP ${requestStage} request timed out.`, { stage: requestStage })), LSP_HOST_LIMITS.requestTimeoutMs);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
  let candidates = [];
  let reason = "empty";
  let failure = null;
  try {
    const initialized = await withDeadline(requestServer("initialize", { processId: process.pid, rootUri: null, capabilities: {} }), "initialize");
    if (!initialized || typeof initialized !== "object") throw protocolError("invalid-message", "LSP initialize result is invalid.", { stage });
    send({ jsonrpc: "2.0", method: "initialized", params: {} });
    stage = "open";
    for (const document of documents.filter((item) => item.languageId === "typescript")) {
      send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri: document.uri, languageId: document.languageId, version: 1, text: document.text } } });
      opened.push(document);
    }
    const caller = documents.find((item) => item.relativePath === "caller.ts");
    if (!caller) throw protocolError("invalid-input", "caller.ts is required.", { stage });
    stage = "prepare";
    const position = request.scenario === "wrong-position" ? { line: 99, character: 0 } : positionOf(caller.text, "caller");
    const prepareRequest = requestServer("textDocument/prepareCallHierarchy", { textDocument: { uri: caller.uri }, position });
    const prepared = await withDeadline(request.scenario === "cancel" ? Promise.race([
      prepareRequest,
      new Promise((resolve, reject) => setTimeout(() => reject(protocolError("cancelled", "LSP analysis was cancelled.", { stage: "prepare" })), 50)),
    ]) : prepareRequest, "prepare");
    if (prepared === null || Array.isArray(prepared) && prepared.length === 0) reason = "no-prepared-item";
    else {
      if (!Array.isArray(prepared)) throw protocolError("invalid-prepare-result", "prepareCallHierarchy did not return an array or null.", { stage });
      if (prepared.length !== 1) throw protocolError("ambiguous-prepared-item", "prepareCallHierarchy returned more than one item.", { stage });
      validateItem(prepared[0], documents, binding.collectionId);
      stage = "hierarchy";
      const outgoing = await withDeadline(requestServer("callHierarchy/outgoingCalls", { item: prepared[0] }), "hierarchy");
      if (outgoing === null || Array.isArray(outgoing) && outgoing.length === 0) reason = "empty";
      else {
        if (!Array.isArray(outgoing)) throw protocolError("invalid-hierarchy-result", "outgoingCalls did not return an array or null.", { stage });
        candidates = outgoing.map((relation) => {
          if (!relation || !Array.isArray(relation.fromRanges) || relation.fromRanges.length !== 1) throw protocolError("invalid-hierarchy-result", "Outgoing call relation is invalid.", { stage });
          const callerPath = relativePathFromUri(prepared[0].uri, binding.collectionId, new Set(documents.map((item) => item.relativePath)));
          const callerDocument = documents.find((item) => item.relativePath === callerPath);
          validateRange(callerDocument.text, relation.fromRanges[0]);
          const target = validateItem(relation.to, documents, binding.collectionId);
          const candidate = {
            direction: "outgoing",
            caller: { path: callerPath, range: relation.fromRanges[0] },
            target: { path: target.relativePath, range: relation.to.selectionRange, name: relation.to.name },
          };
          return { ...candidate, semanticDigest: relationSemanticDigest({
            projectId: binding.projectId,
            generationDigest: binding.generationDigest,
            snapshotManifestDigest: binding.snapshotManifestDigest,
            producerDigest: binding.producerDigest,
            direction: candidate.direction,
            callerPath: candidate.caller.path,
            callerRange: candidate.caller.range,
            targetPath: candidate.target.path,
            targetRange: candidate.target.range,
          }) };
        });
        reason = candidates.length > 0 ? "candidates" : "empty";
      }
    }
  } catch (error) {
    failure = error;
  }

  stage = "closing";
  if (failure) {
    for (const id of pending.outstanding()) {
      try { send({ jsonrpc: "2.0", method: "$/cancelRequest", params: { id } }); } catch {}
    }
  }
  for (const document of opened) {
    try { send({ jsonrpc: "2.0", method: "textDocument/didClose", params: { textDocument: { uri: document.uri } } }); } catch {}
  }
  if (terminalError && !childClosed) {
    try { child.stdin.end(); child.kill("SIGTERM"); } catch {}
  } else if (!childClosed) {
    try { await withDeadline(requestServer("shutdown", null), "closing"); } catch (error) { failure ||= error; }
    try { send({ jsonrpc: "2.0", method: "exit", params: null }); child.stdin.end(); } catch {}
  }
  const closed = await waitForChildCleanup(childExit, child);
  try { parser.end(); } catch (error) { failure ||= error; }
  if (terminalError) failure ||= terminalError;
  if (closed.code !== 0 && !failure) failure = protocolError("process-crash", "Fake LSP server exited unexpectedly.", { stage });
  if (failure) return terminalFromError(failure, binding, { attempted: true, verified: childClosed || closed.signal === "SIGTERM", forced: closed.signal === "SIGTERM" }, failure.details?.stage || stage);
  return Object.freeze({
    ...terminalResult({ status: "completed", reason, stage: "closed", provenance: binding, candidates, cleanup: { attempted: true, verified: true, forced: false } }),
    fixtureTransport: { ownedPids: fixtureOwnedPids },
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
