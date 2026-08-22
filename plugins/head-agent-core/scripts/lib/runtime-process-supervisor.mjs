import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export const PROCESS_SUPERVISOR_PROTOCOL_VERSION = "0.1.0";
export const PROCESS_SUPERVISOR_MANIFEST_VERSION = "0.1.0";
export const RUNTIME_ONE_SHOT_CONTROL_VERSION = "0.1.0";

const TARGETS = Object.freeze({
  "darwin-arm64": Object.freeze({ platform: "darwin", arch: "arm64", directory: "darwin-arm64", executable: "head-agent-supervisor" }),
  "darwin-x64": Object.freeze({ platform: "darwin", arch: "x64", directory: "darwin-x64", executable: "head-agent-supervisor" }),
  "linux-arm64": Object.freeze({ platform: "linux", arch: "arm64", directory: "linux-arm64", executable: "head-agent-supervisor" }),
  "linux-x64": Object.freeze({ platform: "linux", arch: "x64", directory: "linux-x64", executable: "head-agent-supervisor" }),
  "win32-x64": Object.freeze({ platform: "win32", arch: "x64", directory: "windows-x64", executable: "head-agent-supervisor.exe" }),
});

const fail = (message, code = "PROCESS_SUPERVISOR_ERROR") => {
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

function targetFor(platform = process.platform, arch = process.arch) {
  const target = TARGETS[`${platform}-${arch}`];
  if (!target) fail(`Unsupported process-supervisor target: ${platform}-${arch}.`, "PROCESS_SUPERVISOR_TARGET_UNSUPPORTED");
  return target;
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function assertFields(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} is invalid.`, "INVALID_PROCESS_SUPERVISOR_MANIFEST");
  const expected = new Set(fields);
  if (Object.keys(value).some((field) => !expected.has(field)) || fields.some((field) => !(field in value))) {
    fail(`${label} fields are invalid.`, "INVALID_PROCESS_SUPERVISOR_MANIFEST");
  }
}

function manifestPayload({ target, binary }) {
  return {
    schemaVersion: 1,
    kind: "HeadAgentProcessSupervisorManifest",
    manifestVersion: PROCESS_SUPERVISOR_MANIFEST_VERSION,
    supervisorProtocolVersion: PROCESS_SUPERVISOR_PROTOCOL_VERSION,
    target,
    binary,
    processModel: {
      transport: "single-request-stdio-with-control-fd3",
      windowsTreeOwnership: "job-object-kill-on-close",
      posixTreeOwnership: "isolated-process-group",
      shellInterpretation: false,
    },
    authority: {
      kind: "operational-process-control-only",
      instructionAuthority: false,
      promotionAuthority: false,
      mutatesCanon: false,
    },
  };
}

function withIdentity(payload) {
  const manifestHash = digest(canonicalJson(payload));
  return { ...payload, manifestId: `process-supervisor-manifest-${manifestHash.slice(0, 24)}`, manifestHash };
}

export function createProcessSupervisorManifest({ platform, arch, binaryFile, manifestDirectory } = {}) {
  const target = targetFor(platform, arch);
  const root = path.resolve(manifestDirectory || ".");
  const file = path.resolve(binaryFile || "");
  if (!isWithin(root, file)) fail("Process supervisor binary must remain beneath its manifest directory.", "PROCESS_SUPERVISOR_PATH_ESCAPE");
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.isSymbolicLink()) fail("Process supervisor binary is missing or unsafe.", "PROCESS_SUPERVISOR_BINARY_MISSING");
  const relativePath = path.relative(root, file).replaceAll("\\", "/");
  if (relativePath !== target.executable) fail("Process supervisor binary name does not match its target.", "INVALID_PROCESS_SUPERVISOR_MANIFEST");
  return verifyProcessSupervisorManifest(withIdentity(manifestPayload({
    target: { platform: target.platform, arch: target.arch, directory: target.directory },
    binary: { relativePath, sha256: digest(fs.readFileSync(file)), size: stat.size },
  })), { platform, arch });
}

export function verifyProcessSupervisorManifest(manifest, { platform = process.platform, arch = process.arch } = {}) {
  assertFields(manifest, [
    "schemaVersion", "kind", "manifestVersion", "supervisorProtocolVersion", "target", "binary",
    "processModel", "authority", "manifestId", "manifestHash",
  ], "Process supervisor manifest");
  assertFields(manifest.target, ["platform", "arch", "directory"], "Process supervisor target");
  assertFields(manifest.binary, ["relativePath", "sha256", "size"], "Process supervisor binary");
  assertFields(manifest.processModel, ["transport", "windowsTreeOwnership", "posixTreeOwnership", "shellInterpretation"], "Process supervisor process model");
  assertFields(manifest.authority, ["kind", "instructionAuthority", "promotionAuthority", "mutatesCanon"], "Process supervisor authority");
  const target = targetFor(platform, arch);
  const expectedTarget = { platform: target.platform, arch: target.arch, directory: target.directory };
  if (manifest.schemaVersion !== 1 || manifest.kind !== "HeadAgentProcessSupervisorManifest"
    || manifest.manifestVersion !== PROCESS_SUPERVISOR_MANIFEST_VERSION
    || manifest.supervisorProtocolVersion !== PROCESS_SUPERVISOR_PROTOCOL_VERSION
    || canonicalJson(manifest.target) !== canonicalJson(expectedTarget)
    || manifest.binary.relativePath !== target.executable || !/^[a-f0-9]{64}$/.test(manifest.binary.sha256 || "")
    || !Number.isSafeInteger(manifest.binary.size) || manifest.binary.size < 1
    || canonicalJson(manifest.processModel) !== canonicalJson({
      transport: "single-request-stdio-with-control-fd3",
      windowsTreeOwnership: "job-object-kill-on-close",
      posixTreeOwnership: "isolated-process-group",
      shellInterpretation: false,
    })
    || canonicalJson(manifest.authority) !== canonicalJson({
      kind: "operational-process-control-only", instructionAuthority: false, promotionAuthority: false, mutatesCanon: false,
    })) {
    fail("Process supervisor manifest contract is invalid.", "INVALID_PROCESS_SUPERVISOR_MANIFEST");
  }
  const payload = { ...manifest };
  delete payload.manifestId;
  delete payload.manifestHash;
  const expected = withIdentity(payload);
  if (manifest.manifestId !== expected.manifestId || manifest.manifestHash !== expected.manifestHash) {
    fail("Process supervisor manifest digest verification failed.", "PROCESS_SUPERVISOR_MANIFEST_DIGEST_MISMATCH");
  }
  return manifest;
}

export function defaultProcessSupervisorManifestPath({ pluginRoot = ".", platform = process.platform, arch = process.arch } = {}) {
  return path.join(path.resolve(pluginRoot), "dist", targetFor(platform, arch).directory, "SUPERVISOR-MANIFEST.json");
}

export function resolveVerifiedProcessSupervisor({ pluginRoot = ".", manifestFile = null, platform = process.platform, arch = process.arch } = {}) {
  const root = fs.realpathSync(path.resolve(pluginRoot));
  const manifestPath = path.resolve(manifestFile || defaultProcessSupervisorManifestPath({ pluginRoot: root, platform, arch }));
  if (!isWithin(root, manifestPath)) fail("Process supervisor manifest escaped the plugin distribution root.", "PROCESS_SUPERVISOR_PATH_ESCAPE");
  const manifestStat = fs.lstatSync(manifestPath, { throwIfNoEntry: false });
  if (!manifestStat?.isFile() || manifestStat.isSymbolicLink()) fail("Process supervisor manifest is unavailable or unsafe.", "PROCESS_SUPERVISOR_NOT_AVAILABLE");
  const realManifest = fs.realpathSync(manifestPath);
  if (!isWithin(root, realManifest)) fail("Process supervisor manifest resolved outside the plugin distribution root.", "PROCESS_SUPERVISOR_PATH_ESCAPE");
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(realManifest, "utf8")); }
  catch { fail("Process supervisor manifest is not valid JSON.", "INVALID_PROCESS_SUPERVISOR_MANIFEST"); }
  verifyProcessSupervisorManifest(manifest, { platform, arch });
  const binaryPath = path.resolve(path.dirname(realManifest), manifest.binary.relativePath);
  const binaryStat = fs.lstatSync(binaryPath, { throwIfNoEntry: false });
  if (!isWithin(root, binaryPath) || !binaryStat?.isFile() || binaryStat.isSymbolicLink()) {
    fail("Process supervisor binary is unavailable or unsafe.", "PROCESS_SUPERVISOR_BINARY_MISSING");
  }
  const realBinary = fs.realpathSync(binaryPath);
  if (!isWithin(root, realBinary) || path.dirname(realBinary) !== path.dirname(realManifest)) {
    fail("Process supervisor binary resolved outside its immutable distribution directory.", "PROCESS_SUPERVISOR_PATH_ESCAPE");
  }
  if (platform !== "win32" && (binaryStat.mode & 0o111) === 0) fail("Process supervisor binary is not executable.", "PROCESS_SUPERVISOR_BINARY_NOT_EXECUTABLE");
  const bytes = fs.readFileSync(realBinary);
  if (bytes.length !== manifest.binary.size || digest(bytes) !== manifest.binary.sha256) {
    fail("Process supervisor binary digest verification failed.", "PROCESS_SUPERVISOR_BINARY_DIGEST_MISMATCH");
  }
  return Object.freeze({ manifest, manifestPath: realManifest, binaryPath: realBinary });
}

function minimalSupervisorEnvironment(environment = process.env) {
  const allowed = new Set(["systemroot", "windir", "temp", "tmp", "tmpdir", "lang", "lc_all"]);
  const result = {};
  for (const [key, value] of Object.entries(environment || {})) {
    if (allowed.has(key.toLowerCase()) && typeof value === "string") result[key] = value;
  }
  result.LANG = "C";
  return result;
}

function boundedSupervisorRequest({ executablePath, args, cwd, providerEnvironment, input, controlFile, terminationGraceMs }) {
  if (!path.isAbsolute(executablePath) || !path.isAbsolute(cwd) || !Buffer.isBuffer(input)
    || input.length > 4 * 1024 * 1024 || !path.isAbsolute(controlFile) || controlFile.includes("\0") || fs.existsSync(controlFile)
    || !Array.isArray(args) || args.length > 256 || args.some((item) => typeof item !== "string" || item.includes("\0") || Buffer.byteLength(item) > 64 * 1024)
    || !Number.isSafeInteger(terminationGraceMs) || terminationGraceMs < 100 || terminationGraceMs > 10_000) {
    fail("Process supervisor request is outside its fixed boundary.", "INVALID_PROCESS_SUPERVISOR_REQUEST");
  }
  const environment = {};
  const environmentEntries = Object.entries(providerEnvironment || {});
  if (environmentEntries.length > 256) fail("Provider environment exceeds its supervised execution bound.", "INVALID_PROCESS_SUPERVISOR_REQUEST");
  for (const [key, value] of environmentEntries) {
    if (!key || key.includes("=") || key.includes("\0") || typeof value !== "string" || value.includes("\0")
      || Buffer.byteLength(key) + Buffer.byteLength(value) > 64 * 1024) {
      fail("Provider environment is invalid for supervised execution.", "INVALID_PROCESS_SUPERVISOR_REQUEST");
    }
    environment[key] = value;
  }
  const request = {
    schemaVersion: 1,
    protocolVersion: PROCESS_SUPERVISOR_PROTOCOL_VERSION,
    executable: executablePath,
    arguments: [...args],
    workingDirectory: cwd,
    environment,
    inputBase64: input.toString("base64"),
    controlFile,
    terminationGraceMs,
  };
  const bytes = Buffer.from(canonicalJson(request), "utf8");
  if (bytes.length > 8 * 1024 * 1024) fail("Process supervisor request exceeds its transport bound.", "PROCESS_SUPERVISOR_REQUEST_LIMIT");
  return bytes;
}

function validateControlEvent(value, expectedStrategy = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.protocolVersion !== PROCESS_SUPERVISOR_PROTOCOL_VERSION
    || !new Set(["supervisor.ready", "provider.started", "provider.exited", "supervisor.cleanup"]).has(value.type)) {
    fail("Process supervisor emitted an invalid control event.", "INVALID_PROCESS_SUPERVISOR_CONTROL_EVENT");
  }
  if (value.type !== "provider.exited" && !new Set(["windows-job-object", "posix-process-group"]).has(value.strategy)) {
    fail("Process supervisor emitted an invalid ownership strategy.", "INVALID_PROCESS_SUPERVISOR_CONTROL_EVENT");
  }
  if (expectedStrategy && value.strategy && value.strategy !== expectedStrategy) fail("Process supervisor strategy changed during execution.", "PROCESS_SUPERVISOR_STRATEGY_DRIFT");
  if (value.type === "supervisor.ready" && value.treeOwnershipEstablished !== true) fail("Process supervisor did not establish tree ownership.", "PROCESS_SUPERVISOR_OWNERSHIP_FAILED");
  if (value.type === "provider.started" && (!Number.isSafeInteger(value.providerPid) || value.providerPid < 1 || value.treeOwnershipEstablished !== true)) {
    fail("Process supervisor provider start event is invalid.", "INVALID_PROCESS_SUPERVISOR_CONTROL_EVENT");
  }
  if (value.type === "provider.exited" && (!Number.isSafeInteger(value.providerPid) || value.providerPid < 1 || !Number.isInteger(value.exitCode))) {
    fail("Process supervisor provider exit event is invalid.", "INVALID_PROCESS_SUPERVISOR_CONTROL_EVENT");
  }
  if (value.type === "supervisor.cleanup" && [value.cleanupAttempted, value.cleanupVerified, value.forceUsed, value.kernelCleanupOnExit].some((item) => typeof item !== "boolean")) {
    fail("Process supervisor cleanup event is invalid.", "INVALID_PROCESS_SUPERVISOR_CONTROL_EVENT");
  }
  return value;
}

function processGroupSignal(pid, signal) {
  if (!Number.isSafeInteger(pid) || pid < 1 || process.platform === "win32") return;
  try { process.kill(-pid, signal); }
  catch (error) { if (error.code !== "ESRCH") throw error; }
}

export function spawnSupervisedProcess({
  selection,
  executablePath,
  args,
  cwd,
  providerEnvironment,
  input,
  controlFile,
  terminationGraceMs,
  spawnImplementation = spawn,
  onControlEvent = () => {},
} = {}) {
  if (!selection?.manifest || !selection?.binaryPath) fail("A verified process supervisor selection is required.", "PROCESS_SUPERVISOR_SELECTION_REQUIRED");
  verifyProcessSupervisorManifest(selection.manifest);
  const request = boundedSupervisorRequest({ executablePath, args, cwd, providerEnvironment, input, controlFile, terminationGraceMs });
  const child = spawnImplementation(selection.binaryPath, [], {
    cwd: path.dirname(selection.binaryPath),
    env: minimalSupervisorEnvironment(),
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const state = {
    controlInvalid: false,
    strategy: null,
    ownershipEstablished: false,
    providerStarted: false,
    providerPid: null,
    providerExitObserved: false,
    cleanup: null,
    requestWritten: false,
  };
  let controlBuffer = "";
  let controlBytesRead = 0;
  const consume = (line) => {
    if (!line.trim() || state.controlInvalid) return;
    try {
      const event = validateControlEvent(JSON.parse(line), state.strategy);
      if (event.strategy) state.strategy = event.strategy;
      if (event.type === "supervisor.ready") state.ownershipEstablished = true;
      if (event.type === "provider.started") {
        state.providerStarted = true;
        state.providerPid = event.providerPid;
      }
      if (event.type === "provider.exited") {
        if (event.providerPid !== state.providerPid) throw Object.assign(new Error("Provider PID changed."), { code: "PROCESS_SUPERVISOR_PROVIDER_DRIFT" });
        state.providerExitObserved = true;
      }
      if (event.type === "supervisor.cleanup") state.cleanup = event;
      onControlEvent(event);
    } catch {
      state.controlInvalid = true;
      try { child.kill("SIGTERM"); } catch {}
    }
  };
  const readControlFile = () => {
    if (!fs.existsSync(controlFile) || state.controlInvalid) return;
    const stat = fs.lstatSync(controlFile);
    const resolvedParent = fs.realpathSync(path.dirname(controlFile));
    if (!stat.isFile() || stat.isSymbolicLink() || !isWithin(resolvedParent, fs.realpathSync(controlFile)) || stat.size < controlBytesRead || stat.size > 64 * 1024) {
      state.controlInvalid = true;
      try { child.kill("SIGTERM"); } catch {}
      return;
    }
    const bytes = fs.readFileSync(controlFile);
    const chunk = bytes.subarray(controlBytesRead);
    controlBytesRead = bytes.length;
    controlBuffer += chunk.toString("utf8");
    if (Buffer.byteLength(controlBuffer) > 64 * 1024) {
      state.controlInvalid = true;
      try { child.kill("SIGTERM"); } catch {}
      return;
    }
    const lines = controlBuffer.split(/\r?\n/);
    controlBuffer = lines.pop() || "";
    for (const line of lines) consume(line);
  };
  const controlPoll = setInterval(readControlFile, 20);
  controlPoll.unref?.();
  child.once("close", () => {
    clearInterval(controlPoll);
    readControlFile();
  });
  child.once("spawn", () => {
    child.stdin.end(request, () => { state.requestWritten = true; });
  });
  const terminate = (force = false) => {
    const signal = force ? "SIGKILL" : "SIGTERM";
    processGroupSignal(state.providerPid, signal);
    if (child.exitCode === null && child.signalCode === null) {
      try { child.kill(signal); } catch {}
    }
  };
  const finalize = ({ exactSupervisorExitObserved, terminationRequested }) => {
    readControlFile();
    if (controlBuffer.trim()) consume(controlBuffer);
    const expectedStrategy = process.platform === "win32" ? "windows-job-object" : "posix-process-group";
    const windowsKernelBoundary = state.strategy === "windows-job-object" && state.ownershipEstablished
      && state.providerStarted && exactSupervisorExitObserved;
    const cleanupVerified = state.cleanup?.cleanupVerified === true
      || windowsKernelBoundary && (state.cleanup?.kernelCleanupOnExit === true || terminationRequested);
    return Object.freeze({
      supervisionMode: "native-process-tree",
      supervisionStrategy: state.strategy || "unavailable",
      supervisorManifestDigest: selection.manifest.manifestHash,
      ownershipEstablished: state.ownershipEstablished && state.strategy === expectedStrategy && !state.controlInvalid,
      providerChildStarted: state.providerStarted,
      providerChildExitObserved: state.providerExitObserved,
      treeCleanupAttempted: state.cleanup?.cleanupAttempted === true || terminationRequested,
      treeCleanupVerified: cleanupVerified && !state.controlInvalid,
      requestWritten: state.requestWritten,
      providerPid: state.providerPid,
      controlInvalid: state.controlInvalid,
    });
  };
  return { child, state, terminate, finalize };
}

function canonicalControlValue(value) {
  if (Array.isArray(value)) return value.map(canonicalControlValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalControlValue(value[key])]));
  }
  return value;
}

const canonicalControlJson = (value) => JSON.stringify(canonicalControlValue(value));
const controlDigest = (value) => crypto.createHash("sha256").update(value).digest("hex");

export function spawnBoundedRuntimeOneShot(options = {}) {
  const runtime = String(options.runtime || "").trim().toLowerCase();
  if (!new Set(["codex", "opencode"]).has(runtime)) {
    fail("Bounded runtime control requires an explicit supported runtime.", "RUNTIME_ONE_SHOT_CONTROL_RUNTIME_REQUIRED");
  }
  const supervised = spawnSupervisedProcess(options);
  const controlToken = crypto.randomBytes(32).toString("base64url");
  const controlTokenHash = controlDigest(`head-agent-runtime-control\n${runtime}\n${controlToken}`);
  let action = null;
  let finalized = null;

  const authenticate = (provided) => {
    const observed = controlDigest(`head-agent-runtime-control\n${runtime}\n${String(provided || "")}`);
    const left = Buffer.from(controlTokenHash, "hex");
    const right = Buffer.from(observed, "hex");
    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
      fail("Runtime one-shot control token is invalid.", "RUNTIME_ONE_SHOT_CONTROL_UNAUTHORIZED");
    }
  };
  const request = (requestedAction, provided) => {
    authenticate(provided);
    if (finalized) fail("Runtime one-shot control is already finalized.", "RUNTIME_ONE_SHOT_CONTROL_FINALIZED");
    if (action && action !== requestedAction) {
      fail(`Runtime one-shot control already accepted ${action}.`, "RUNTIME_ONE_SHOT_CONTROL_CONFLICT");
    }
    if (!action) {
      action = requestedAction;
      supervised.terminate(false);
    }
    return Object.freeze({ status: `${requestedAction}_requested`, action: requestedAction, bounded: true });
  };
  const unsupported = (operation) => {
    fail(`Runtime one-shot ${operation} remains deferred; use canonical recovery and a new authorization instead.`, "RUNTIME_ADAPTER_CONTROL_NOT_ENABLED");
  };
  const finalizeControl = ({ token, exactSupervisorExitObserved = true } = {}) => {
    authenticate(token);
    if (finalized) return finalized;
    const supervision = supervised.finalize({
      exactSupervisorExitObserved,
      terminationRequested: action !== null,
    });
    const payload = {
      schemaVersion: 1,
      kind: "RuntimeOneShotControlReceipt",
      protocolVersion: RUNTIME_ONE_SHOT_CONTROL_VERSION,
      runtime,
      controlScope: "exact-owned-one-shot-provider-tree",
      action,
      actionAccepted: action !== null,
      supervisionMode: supervision.supervisionMode,
      supervisionStrategy: supervision.supervisionStrategy,
      ownershipEstablished: supervision.ownershipEstablished,
      providerChildStarted: supervision.providerChildStarted,
      providerChildExitObserved: supervision.providerChildExitObserved,
      treeCleanupAttempted: supervision.treeCleanupAttempted,
      treeCleanupVerified: supervision.treeCleanupVerified,
      controlTokenPersisted: false,
      providerSessionIdentityPersisted: false,
      resumeEnabled: false,
      streamEnabled: false,
      instructionAuthority: false,
      promotionAuthority: false,
      reviewAuthority: false,
      canonMutationAuthority: false,
    };
    const receiptHash = controlDigest(canonicalControlJson(payload));
    finalized = Object.freeze({
      ...payload,
      receiptId: `runtime-one-shot-control-${receiptHash.slice(0, 24)}`,
      receiptHash,
    });
    return finalized;
  };
  return Object.freeze({
    child: supervised.child,
    state: supervised.state,
    controlToken,
    interrupt: ({ token } = {}) => request("interrupt", token),
    close: ({ token } = {}) => request("close", token),
    resume: () => unsupported("resume"),
    stream: () => unsupported("stream"),
    finalize: finalizeControl,
  });
}
