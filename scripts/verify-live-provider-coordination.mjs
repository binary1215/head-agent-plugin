#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { initializeProject } from "./lib/head-core.mjs";
import { buildRuntimeVersionEvidence } from "./lib/runtime-machine-execution.mjs";
import { resolveReadOnlyRuntimeExecutableTarget } from "./lib/runtime-machine-discovery.mjs";
import { resolveVerifiedProcessSupervisor, spawnBoundedRuntimeOneShot } from "./lib/runtime-process-supervisor.mjs";
import {
  attachCoordinationWorkspaceHost,
  issueCoordinationRoleBinding,
  inspectRoleCoordination,
  openCoordinationGeneration,
  readCoordinationInbox,
  readCoordinationReply,
} from "./lib/role-coordination.mjs";
import { VerifiedWorkspaceHostAdapter } from "./lib/workspace-host-coordination.mjs";
import {
  acknowledgeWorkspaceHostExportDelivery,
  claimWorkspaceHostExportDelivery,
  createWorkspaceHostExportDriver,
  listWorkspaceHostExportDeliveryRequests,
  publishWorkspaceHostExportSnapshot,
  workspaceHostExportProcessProofHash,
} from "./lib/workspace-host-export-driver.mjs";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nonce = `${process.pid}-${Date.now()}`;
const projectRoot = path.join(pluginRoot, `.qa-live-coordination-${nonce}`);
const operationalRoot = path.join(pluginRoot, `.qa-live-coordination-operational-${nonce}`);
const exportRoot = path.join(pluginRoot, `.qa-live-coordination-export-${nonce}`);
const liveOptIn = "HEAD_AGENT_LIVE_COORDINATION_E2E";
const codexModel = String(process.env.HEAD_AGENT_LIVE_COORDINATION_CODEX_MODEL || "gpt-5.6-sol").trim();
const openCodeModel = String(process.env.HEAD_AGENT_LIVE_COORDINATION_OPENCODE_MODEL || "opencode/big-pickle").trim();
const clientTimeoutMs = 600_000;
const ackTimeoutMs = 600_000;
const exportMcp = path.join(pluginRoot, "scripts", "workspace-host-export-mcp.mjs");
const knownTools = new Set([
  "head_coordination_send_message",
  "head_coordination_read_inbox",
  "head_coordination_wait_reply",
  "head_coordination_reply_message",
]);

const fail = (message, code = "LIVE_PROVIDER_COORDINATION_ASSERTION", details = null) => {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
};

const assert = (condition, message, code, details) => {
  if (!condition) fail(message, code, details);
};

const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
const canonicalValue = (value) => Array.isArray(value) ? value.map(canonicalValue)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]))
    : value;
const canonicalJson = (value) => JSON.stringify(canonicalValue(value));
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function recordProcess(event) {
  if (event.type === "spawn") {
    process.stderr.write(`NESTED_CHILD_START pid=${event.pid} parent=${event.parentPid} command=${event.command} cwd=${event.cwd} ports=none\n`);
  } else {
    process.stderr.write(`NESTED_CHILD_END pid=${event.pid} parent=${event.parentPid} exit=${event.exitCode ?? "null"} signal=${event.signal || "none"}\n`);
  }
}

function recordingSpawn(command, args, options) {
  const child = spawn(command, args, options);
  child.once("spawn", () => recordProcess({
    type: "spawn", pid: child.pid, parentPid: process.pid,
    command: `${path.basename(command)} ${args.join(" ")}`.trim(), cwd: options.cwd,
  }));
  child.once("exit", (exitCode, signal) => recordProcess({
    type: "exit", pid: child.pid, parentPid: process.pid, exitCode, signal: signal || "none",
  }));
  return child;
}

function validateOwnedRoot(root, prefix) {
  assert(path.dirname(root) === pluginRoot && path.basename(root).startsWith(prefix),
    "Live coordination fixture root escaped its fixed plugin-owned boundary.", "LIVE_PROVIDER_COORDINATION_PATH_ESCAPE");
  assert(!fs.existsSync(root), "Live coordination fixture root already exists.", "LIVE_PROVIDER_COORDINATION_PATH_EXISTS");
}

function removeOwnedRoot(root, prefix) {
  if (!fs.existsSync(root)) return;
  assert(path.dirname(root) === pluginRoot && path.basename(root).startsWith(prefix),
    "Refusing unsafe live coordination cleanup.", "LIVE_PROVIDER_COORDINATION_UNSAFE_CLEANUP");
  const stat = fs.lstatSync(root);
  assert(stat.isDirectory() && !stat.isSymbolicLink(),
    "Refusing unsafe live coordination cleanup target.", "LIVE_PROVIDER_COORDINATION_UNSAFE_CLEANUP");
  fs.rmSync(root, { recursive: true, force: false });
}

function treeBytes(root) {
  const entries = [];
  const walk = (directory) => {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name);
      const relative = path.relative(root, file).replaceAll("\\", "/");
      const stat = fs.lstatSync(file);
      if (stat.isDirectory()) walk(file);
      else entries.push([relative, fs.readFileSync(file).toString("base64")]);
    }
  };
  walk(root);
  return entries;
}

function rootsContainBytes(roots, value) {
  const needle = Buffer.from(value);
  const visit = (candidate) => {
    const stat = fs.lstatSync(candidate);
    if (stat.isDirectory()) return fs.readdirSync(candidate).some((name) => visit(path.join(candidate, name)));
    return stat.isFile() && fs.readFileSync(candidate).indexOf(needle) !== -1;
  };
  return roots.filter((root) => fs.existsSync(root)).some(visit);
}

function rootsHaveExactJsonKey(roots, forbiddenKeys) {
  const forbidden = new Set(forbiddenKeys);
  const inspectValue = (value) => {
    if (Array.isArray(value)) return value.some(inspectValue);
    if (!value || typeof value !== "object") return false;
    return Object.entries(value).some(([key, child]) => forbidden.has(key) || inspectValue(child));
  };
  const visit = (candidate) => {
    const stat = fs.lstatSync(candidate);
    if (stat.isDirectory()) return fs.readdirSync(candidate).some((name) => visit(path.join(candidate, name)));
    if (!stat.isFile() || path.extname(candidate).toLowerCase() !== ".json") return false;
    try { return inspectValue(JSON.parse(fs.readFileSync(candidate, "utf8"))); } catch { return false; }
  };
  return roots.filter((root) => fs.existsSync(root)).some(visit);
}

function baseRuntimeEnvironment(environment = process.env) {
  const allowed = new Set([
    "appdata", "codex_home", "comspec", "home", "homedrive", "homepath",
    "http_proxy", "https_proxy", "lang", "lc_all", "localappdata", "no_proxy",
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

function endpointIdentity(role, suffix = "current") {
  return {
    workspaceId: `workspace-${role}`,
    tabId: `tab-${role}`,
    endpointId: `endpoint-${role}-${suffix}`,
    terminalId: `terminal-${role}-${suffix}`,
  };
}

function hostEnvironment({ bindingToken, endpoint, proof }) {
  return {
    HEAD_AGENT_OPERATIONAL_STATE_ROOT: operationalRoot,
    HEAD_AGENT_COORDINATION_BINDING_TOKEN: bindingToken,
    HEAD_AGENT_HOST_PROJECT_ROOT: projectRoot,
    HEAD_AGENT_WORKSPACE_HOST_EXPORT_ROOT: exportRoot,
    HEAD_AGENT_HOST_WORKSPACE_ID: endpoint.workspaceId,
    HEAD_AGENT_HOST_TAB_ID: endpoint.tabId,
    HEAD_AGENT_HOST_ENDPOINT_ID: endpoint.endpointId,
    HEAD_AGENT_HOST_PROCESS_PROOF: proof,
    HEAD_AGENT_WORKSPACE_HOST_ACK_TIMEOUT_MS: String(ackTimeoutMs),
  };
}

function codexArguments(model) {
  const forwarded = [
    "HEAD_AGENT_OPERATIONAL_STATE_ROOT",
    "HEAD_AGENT_COORDINATION_BINDING_TOKEN",
    "HEAD_AGENT_HOST_PROJECT_ROOT",
    "HEAD_AGENT_WORKSPACE_HOST_EXPORT_ROOT",
    "HEAD_AGENT_HOST_WORKSPACE_ID",
    "HEAD_AGENT_HOST_TAB_ID",
    "HEAD_AGENT_HOST_ENDPOINT_ID",
    "HEAD_AGENT_HOST_PROCESS_PROOF",
    "HEAD_AGENT_WORKSPACE_HOST_ACK_TIMEOUT_MS",
  ];
  const config = (key, value) => ["-c", `${key}=${value}`];
  return [
    "exec",
    "--ignore-user-config",
    "--ignore-rules",
    "--ephemeral",
    "--json",
    "--color", "never",
    "--sandbox", "read-only",
    "--skip-git-repo-check",
    "--cd", projectRoot,
    "--model", model,
    ...config("mcp_servers.head_core.command", JSON.stringify(process.execPath)),
    ...config("mcp_servers.head_core.args", JSON.stringify([exportMcp])),
    ...config("mcp_servers.head_core.cwd", JSON.stringify(projectRoot)),
    ...config("mcp_servers.head_core.env_vars", JSON.stringify(forwarded)),
    ...config("mcp_servers.head_core.required", "true"),
    ...config("mcp_servers.head_core.startup_timeout_sec", "30"),
    ...config("mcp_servers.head_core.tool_timeout_sec", "600"),
    ...config("mcp_servers.head_core.enabled_tools", JSON.stringify([
      "head_coordination_read_inbox", "head_coordination_reply_message",
    ])),
    ...config("mcp_servers.head_core.default_tools_approval_mode", JSON.stringify("approve")),
    "-",
  ];
}

function openCodeEnvironment(bindingToken, endpoint, proof) {
  const permission = {
    "*": "allow",
    bash: "deny",
    edit: "deny",
    write: "deny",
    patch: "deny",
    multiedit: "deny",
    task: "deny",
    skill: "deny",
    webfetch: "deny",
    websearch: "deny",
    codesearch: "deny",
    external_directory: "deny",
  };
  const config = {
    $schema: "https://opencode.ai/config.json",
    autoupdate: false,
    share: "disabled",
    permission,
    mcp: {
      head_core: {
        type: "local",
        command: [process.execPath, exportMcp],
        cwd: projectRoot,
        enabled: true,
        timeout: ackTimeoutMs,
      },
    },
  };
  return {
    ...baseRuntimeEnvironment(),
    ...hostEnvironment({ bindingToken, endpoint, proof }),
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
    OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
    OPENCODE_PURE: "1",
    OPENCODE_PERMISSION: canonicalJson(permission),
    OPENCODE_CONFIG_CONTENT: canonicalJson(config),
  };
}

function toolEvidence(records) {
  const observedTools = new Set();
  const eventTypes = new Set();
  const diagnostics = new Set();
  const providerSessionReferences = new Set();
  const sanitizeDiagnostic = (value) => String(value || "")
    .replaceAll(projectRoot, "<project-root>")
    .replaceAll(operationalRoot, "<operational-root>")
    .replaceAll(exportRoot, "<export-root>")
    .replaceAll(pluginRoot, "<plugin-root>")
    .replace(/(api\s*key(?:\s+provided)?\s*[:=])\s*[^\s.]+/giu, "$1 <redacted>")
    .replace(/\b(?:sk|sess)-[A-Za-z0-9_-]+\b/gu, "<redacted-credential>")
    .replace(/coord-binding-[A-Za-z0-9-]+\.[A-Za-z0-9_-]+/gu, "<binding-token>")
    .replace(/\b[A-Za-z0-9_-]{43,512}\b/gu, "<opaque-value>")
    .slice(0, 1_000);
  const visit = (value, key = "", depth = 0) => {
    if (depth > 10 || value === null || value === undefined) return;
    if (typeof value === "string") {
      if ((key === "tool" || key === "name") && [...knownTools].some((name) => value === name || value.endsWith(`_${name}`))) {
        observedTools.add([...knownTools].find((name) => value === name || value.endsWith(`_${name}`)));
      }
      if (["code", "error", "name", "message", "output", "status", "statusCode"].includes(key) && value.trim()) diagnostics.add(sanitizeDiagnostic(value));
      if (["sessionID", "session_id", "thread_id"].includes(key) && value.trim()) providerSessionReferences.add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, key, depth + 1);
      return;
    }
    if (typeof value !== "object") return;
    for (const [childKey, child] of Object.entries(value)) visit(child, childKey, depth + 1);
  };
  for (const record of records) {
    if (typeof record?.type === "string") eventTypes.add(record.type);
    visit(record);
  }
  return {
    observedTools: [...observedTools].sort(),
    eventTypes: [...eventTypes].sort(),
    diagnostics: [...diagnostics].sort().slice(0, 16),
    providerSessionReferences: [...providerSessionReferences].sort(),
  };
}

function launchSupervisedClient({ runtime, label = runtime, executablePath, args, environment, input, supervisorSelection }) {
  const controlDirectory = path.join(operationalRoot, "live-provider-control", label);
  fs.mkdirSync(controlDirectory, { recursive: true });
  const controlFile = path.join(controlDirectory, "supervisor-control.jsonl");
  assert(!fs.existsSync(controlFile), "Live provider control file already exists.", "LIVE_PROVIDER_COORDINATION_CONTROL_EXISTS");
  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  let lineBuffer = "";
  const records = [];
  let timedOut = false;
  let settled = false;
  let child = null;
  let providerStartEvent = null;
  let resolveProviderStarted;
  const providerStarted = new Promise((resolve) => { resolveProviderStarted = resolve; });
  const controlled = spawnBoundedRuntimeOneShot({
    runtime,
    selection: supervisorSelection,
    executablePath,
    args,
    cwd: projectRoot,
    providerEnvironment: environment,
    input: Buffer.from(input, "utf8"),
    controlFile,
    terminationGraceMs: 5_000,
    onControlEvent: (event) => {
      if (event.type === "provider.started") {
        providerStartEvent = event;
        resolveProviderStarted(event);
        recordProcess({
          type: "spawn", pid: event.providerPid, parentPid: child?.pid || process.pid,
          command: `${runtime} live coordination client`, cwd: projectRoot,
        });
      }
      if (event.type === "provider.exited") recordProcess({
        type: "exit", pid: event.providerPid, parentPid: child?.pid || process.pid,
        exitCode: event.exitCode, signal: "none",
      });
    },
  });
  child = controlled.child;
  const requestControl = (action = "close") => {
    if (settled) return;
    return controlled[action]({ token: controlled.controlToken });
  };
  const completed = new Promise((resolve, reject) => {
    child.once("spawn", () => recordProcess({
      type: "spawn", pid: child.pid, parentPid: process.pid,
      command: `head-agent process-supervisor for ${runtime}`, cwd: path.dirname(supervisorSelection.binaryPath),
    }));
    child.once("error", (error) => reject(Object.assign(new Error(`${runtime} supervisor failed: ${error.message}`), {
      code: "LIVE_PROVIDER_COORDINATION_SPAWN_FAILED",
    })));
    child.stdout.on("data", (chunk) => {
      stdout = Buffer.concat([stdout, chunk]);
      if (stdout.length > 16 * 1024 * 1024) requestControl("close");
      lineBuffer += chunk.toString("utf8");
      const lines = lineBuffer.split(/\r?\n/u);
      lineBuffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try { records.push(JSON.parse(line)); } catch {}
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr = Buffer.concat([stderr, chunk]);
      if (stderr.length > 4 * 1024 * 1024) requestControl("close");
    });
    const timer = setTimeout(() => {
      timedOut = true;
      requestControl("close");
    }, clientTimeoutMs);
    timer.unref?.();
    child.once("close", (code, signal) => {
      settled = true;
      if (!providerStartEvent) resolveProviderStarted(null);
      clearTimeout(timer);
      if (lineBuffer.trim()) {
        try { records.push(JSON.parse(lineBuffer)); } catch {}
      }
      recordProcess({ type: "exit", pid: child.pid, parentPid: process.pid, exitCode: code, signal: signal || "none" });
      const supervision = controlled.finalize({ token: controlled.controlToken, exactSupervisorExitObserved: true });
      const evidence = toolEvidence(records);
      if (fs.existsSync(controlFile)) fs.unlinkSync(controlFile);
      if (fs.existsSync(controlDirectory) && fs.readdirSync(controlDirectory).length === 0) fs.rmdirSync(controlDirectory);
      resolve({
        runtime,
        exitCode: Number.isInteger(code) ? code : null,
        signal: signal || null,
        timedOut,
        stdoutBytes: stdout.length,
        stderrBytes: stderr.length,
        stdoutDigest: digest(stdout),
        stderrDigest: digest(stderr),
        records: records.length,
        ...evidence,
        supervision,
      });
    });
  });
  return {
    runtime, child, controlled, providerStarted, completed,
    interrupt: () => requestControl("interrupt"),
    close: () => requestControl("close"),
  };
}

async function stopClient(client) {
  if (!client) return null;
  if (client.child.exitCode === null && client.child.signalCode === null) client.close();
  return client.completed;
}

function providerSummary(result) {
  if (!result) return null;
  return {
    runtime: result.runtime,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    stdoutBytes: result.stdoutBytes,
    stderrBytes: result.stderrBytes,
    stdoutDigest: result.stdoutDigest,
    stderrDigest: result.stderrDigest,
    records: result.records,
    eventTypes: result.eventTypes,
    observedTools: result.observedTools,
    ...(result.exitCode !== 0 || result.timedOut ? { diagnostics: result.diagnostics } : {}),
    providerSessionReferenceDigests: result.providerSessionReferences.map((value) => digest(value)).sort(),
    supervisionMode: result.supervision.supervisionMode,
    supervisionStrategy: result.supervision.supervisionStrategy,
    controlAction: result.supervision.action,
    ownershipEstablished: result.supervision.ownershipEstablished,
    treeCleanupVerified: result.supervision.treeCleanupVerified,
  };
}

async function waitForDeliveryRequest(endpointId, developerClient) {
  const deadline = Date.now() + 300_000;
  let developerFinished = false;
  let developerResult = null;
  developerClient.completed.then((result) => {
    developerFinished = true;
    developerResult = result;
  });
  while (Date.now() <= deadline) {
    const requests = listWorkspaceHostExportDeliveryRequests({ exportRoot, projectRoot, endpointId });
    if (requests.length === 1) return requests[0];
    assert(requests.length === 0, "Live host observed multiple unclaimed delivery requests.", "LIVE_PROVIDER_COORDINATION_REQUEST_AMBIGUOUS");
    if (developerFinished) {
      fail("OpenCode exited before publishing its live coordination request.", "LIVE_PROVIDER_COORDINATION_SEND_MISSING", providerSummary(developerResult));
    }
    await sleep(100);
  }
  fail("Timed out waiting for OpenCode's live coordination request.", "LIVE_PROVIDER_COORDINATION_REQUEST_TIMEOUT");
}

function endpointRecord({ endpoint, runtime, bindingId, proof }) {
  return {
    ...endpoint,
    cwd: projectRoot,
    runtime,
    bindingId,
    processProofHash: workspaceHostExportProcessProofHash(proof),
  };
}

async function waitForRolesAttached(environment, roles, clients, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const status = inspectRoleCoordination({ root: projectRoot, environment });
    if (roles.every((role) => status.attachedRoles.includes(role))) return status;
    for (const client of clients) {
      if (client.child.exitCode !== null || client.child.signalCode !== null) {
        fail("A provider exited before its exact endpoint attachment was observed.",
          "LIVE_PROVIDER_COORDINATION_ATTACHMENT_MISSING", { role: roles.join(","), runtime: client.runtime });
      }
    }
    await sleep(50);
  }
  fail("Timed out waiting for exact already-running endpoint attachments.",
    "LIVE_PROVIDER_COORDINATION_ATTACHMENT_TIMEOUT", { roles });
}

async function waitForProviderStart(client, label) {
  const event = await Promise.race([client.providerStarted, sleep(30_000).then(() => null)]);
  assert(event?.type === "provider.started" && Number.isSafeInteger(event.providerPid),
    `${label} did not expose one owned provider child before coordination.`,
    "LIVE_PROVIDER_COORDINATION_PROVIDER_START_MISSING");
  return event;
}

async function main() {
  assert(process.env[liveOptIn] === "1",
    `${liveOptIn}=1 is required because this verifier performs real Codex and OpenCode model calls.`,
    "LIVE_PROVIDER_COORDINATION_OPT_IN_REQUIRED");
  assert(codexModel && openCodeModel.includes("/"),
    "Explicit Codex and provider/model OpenCode selections are required.", "LIVE_PROVIDER_COORDINATION_MODEL_REQUIRED");
  validateOwnedRoot(projectRoot, ".qa-live-coordination-");
  validateOwnedRoot(operationalRoot, ".qa-live-coordination-operational-");
  validateOwnedRoot(exportRoot, ".qa-live-coordination-export-");

  const supervisorSelection = resolveVerifiedProcessSupervisor({ pluginRoot });
  const targets = Object.fromEntries(["codex", "opencode"].map((runtime) => [
    runtime,
    resolveReadOnlyRuntimeExecutableTarget({ runtime }),
  ]));
  for (const [runtime, target] of Object.entries(targets)) {
    assert(target.executablePath && target.observation.directSpawnSafe,
      `${runtime} executable is unavailable or unsafe for direct supervised execution.`, "LIVE_PROVIDER_COORDINATION_RUNTIME_UNAVAILABLE");
  }

  let developerClient = null;
  let headClient = null;
  let coderControlClient = null;
  let reviewerControlClient = null;
  let developerResult = null;
  let headResult = null;
  let coderControlResult = null;
  let reviewerControlResult = null;
  let successSummary = null;
  fs.mkdirSync(projectRoot);
  fs.mkdirSync(operationalRoot);
  fs.mkdirSync(exportRoot);
  try {
    const versions = await buildRuntimeVersionEvidence({
      runtimes: ["codex", "opencode"],
      spawnImplementation: recordingSpawn,
    });
    assert(versions.summary.allRequestedVersionsVerified,
      "Codex/OpenCode version evidence was not verified.", "LIVE_PROVIDER_COORDINATION_VERSION_UNVERIFIED");
    initializeProject({ root: projectRoot, pluginRoot, runtimes: ["codex", "opencode"] });
    const environment = { ...process.env, HEAD_AGENT_OPERATIONAL_STATE_ROOT: operationalRoot };
    const generation = openCoordinationGeneration({ root: projectRoot, environment });
    const developer = issueCoordinationRoleBinding({ root: projectRoot, role: "developer", environment });
    const head = issueCoordinationRoleBinding({ root: projectRoot, role: "head", environment });
    const coder = issueCoordinationRoleBinding({ root: projectRoot, role: "coder", environment });
    const reviewer = issueCoordinationRoleBinding({ root: projectRoot, role: "reviewer", environment });
    const proofs = {
      developer: crypto.randomBytes(32).toString("base64url"),
      head: crypto.randomBytes(32).toString("base64url"),
      coder: crypto.randomBytes(32).toString("base64url"),
      reviewer: crypto.randomBytes(32).toString("base64url"),
    };
    const endpoint = {
      developer: endpointIdentity("developer"),
      head: endpointIdentity("head"),
      staleHead: endpointIdentity("head", "stale"),
      coder: endpointIdentity("coder"),
      reviewer: endpointIdentity("reviewer"),
    };
    const hostInstanceId = `live-provider-host-${digest(nonce).slice(0, 16)}`;
    const staleEndpoints = [
      endpointRecord({ endpoint: endpoint.developer, runtime: "opencode", bindingId: developer.binding.bindingId, proof: proofs.developer }),
      endpointRecord({ endpoint: endpoint.staleHead, runtime: "codex", bindingId: head.binding.bindingId, proof: proofs.head }),
      endpointRecord({ endpoint: endpoint.coder, runtime: "codex", bindingId: coder.binding.bindingId, proof: proofs.coder }),
      endpointRecord({ endpoint: endpoint.reviewer, runtime: "opencode", bindingId: reviewer.binding.bindingId, proof: proofs.reviewer }),
    ];
    publishWorkspaceHostExportSnapshot({ exportRoot, projectRoot, hostInstanceId, endpoints: staleEndpoints });
    const staleCaller = {
      workspaceId: endpoint.staleHead.workspaceId,
      tabId: endpoint.staleHead.tabId,
      endpointId: endpoint.staleHead.endpointId,
    };
    const staleAdapter = new VerifiedWorkspaceHostAdapter({
      driver: createWorkspaceHostExportDriver({
        exportRoot, projectRoot, caller: staleCaller, bindingId: head.binding.bindingId,
        processProof: proofs.head, acknowledgementTimeoutMs: ackTimeoutMs,
      }),
    });
    const staleAttachment = attachCoordinationWorkspaceHost({
      root: projectRoot, environment, bindingToken: head.bindingToken,
      workspaceHostAdapter: staleAdapter, caller: staleCaller,
    });
    const endpoints = staleEndpoints.map((candidate) => candidate.bindingId === head.binding.bindingId
      ? endpointRecord({ endpoint: endpoint.head, runtime: "codex", bindingId: head.binding.bindingId, proof: proofs.head })
      : candidate);
    const published = publishWorkspaceHostExportSnapshot({
      exportRoot, projectRoot, hostInstanceId, endpoints,
    });
    const headBefore = treeBytes(path.join(projectRoot, ".head"));
    const messageMarker = `LIVE_PROVIDER_COORDINATION_${digest(nonce).slice(0, 24)}`;
    const replyMarker = `LIVE_PROVIDER_REPLY_${digest(`${nonce}\0reply`).slice(0, 24)}`;
    const idempotencyKey = `live-provider-${digest(nonce).slice(0, 24)}`;
    const codexPrompt = [
      "Act only as the already-bound HEAD role in this isolated HEAD Agent verification.",
      "Use only head_core MCP coordination tools.",
      `Call head_coordination_read_inbox with project_root=${JSON.stringify(projectRoot)}, unread_only=true, and wait_timeout_ms=600000.`,
      `Wait for and find the one authority question whose content is ${JSON.stringify(messageMarker)}.`,
      `Then call head_coordination_reply_message with project_root=${JSON.stringify(projectRoot)}, in_reply_to set to that message_id, and content=${JSON.stringify(replyMarker)}.`,
      "After both tool calls succeed, answer exactly CODEX_LIVE_READ_REPLY_COMPLETED.",
      "Do not use shell, files, network tools, or disclose environment values.",
    ].join("\n");
    headClient = launchSupervisedClient({
      runtime: "codex",
      label: "head-already-running",
      executablePath: targets.codex.executablePath,
      args: codexArguments(codexModel),
      environment: {
        ...baseRuntimeEnvironment(),
        ...hostEnvironment({ bindingToken: head.bindingToken, endpoint: endpoint.head, proof: proofs.head }),
      },
      input: `${codexPrompt}\n`,
      supervisorSelection,
    });
    const headProviderStart = await waitForProviderStart(headClient, "Codex HEAD");
    await waitForRolesAttached(environment, ["head"], [headClient]);
    const openCodePrompt = [
      "Act only as the already-bound developer role in this isolated HEAD Agent verification.",
      "Use only the head_core MCP coordination tools named below.",
      `Call head_coordination_send_message exactly once with project_root=${JSON.stringify(projectRoot)}, to_role=\"head\", content=${JSON.stringify(messageMarker)}, and idempotency_key=${JSON.stringify(idempotencyKey)}.`,
      "From that result, retain message_id. Then call head_coordination_wait_reply with the same project_root, that message_id, and wait_timeout_ms=600000.",
      `Only after the reply content equals ${JSON.stringify(replyMarker)}, answer exactly OPENCODE_LIVE_REPLY_OBSERVED.`,
      "Do not use shell, files, network tools, or disclose environment values.",
    ].join("\n");
    developerClient = launchSupervisedClient({
      runtime: "opencode",
      label: "developer-already-running",
      executablePath: targets.opencode.executablePath,
      args: ["run", "--format", "json", "--pure", "--dir", projectRoot, "--model", openCodeModel, "--auto", "--title", "HEAD live coordination developer"],
      environment: openCodeEnvironment(developer.bindingToken, endpoint.developer, proofs.developer),
      input: `${openCodePrompt}\n`,
      supervisorSelection,
    });
    const developerProviderStart = await waitForProviderStart(developerClient, "OpenCode developer");
    const request = await waitForDeliveryRequest(endpoint.head.endpointId, developerClient);
    assert(request.text.includes(messageMarker),
      "Live host request did not carry the expected opaque notification marker.", "LIVE_PROVIDER_COORDINATION_NOTIFICATION_MISMATCH");
    const claimed = claimWorkspaceHostExportDelivery({ exportRoot, projectRoot, request });
    assert(claimed.status === "claimed", "Live host could not acquire the exact pre-effect delivery claim.",
      "LIVE_PROVIDER_COORDINATION_CLAIM_FAILED", { status: claimed.status });
    assert(listWorkspaceHostExportDeliveryRequests({
      exportRoot, projectRoot, endpointId: endpoint.staleHead.endpointId,
    }).length === 0, "The replaced stale HEAD endpoint received a delivery request.",
    "LIVE_PROVIDER_COORDINATION_STALE_ENDPOINT_RECEIVED");
    assert(headProviderStart.providerPid !== developerProviderStart.providerPid,
      "Codex and OpenCode did not expose distinct already-running process proofs.",
      "LIVE_PROVIDER_COORDINATION_PROVIDER_PROOF_REUSED");
    const acknowledgement = acknowledgeWorkspaceHostExportDelivery({
      exportRoot, projectRoot, request, claim: claimed.claim,
    });
    [headResult, developerResult] = await Promise.all([headClient.completed, developerClient.completed]);
    assert(headResult.exitCode === 0 && !headResult.timedOut
      && headResult.supervision.ownershipEstablished && headResult.supervision.treeCleanupVerified,
    "Actual Codex HEAD client did not complete under verified descendant ownership.",
    "LIVE_PROVIDER_COORDINATION_CODEX_FAILED", providerSummary(headResult));
    assert(headResult.observedTools.includes("head_coordination_read_inbox")
      && headResult.observedTools.includes("head_coordination_reply_message"),
    "Actual Codex event stream did not prove both read-inbox and reply tool calls.",
    "LIVE_PROVIDER_COORDINATION_CODEX_TOOLS_MISSING", providerSummary(headResult));

    const inbox = readCoordinationInbox({
      root: projectRoot, environment, bindingToken: head.bindingToken, unreadOnly: false,
    });
    const message = inbox.messages.find((candidate) => candidate.messageId === request.messageId);
    assert(message?.content === messageMarker && message.read === true,
      "Durable HEAD inbox did not prove the exact message was read.", "LIVE_PROVIDER_COORDINATION_READ_MISSING");
    const reply = readCoordinationReply({
      root: projectRoot, environment, bindingToken: developer.bindingToken, messageId: request.messageId,
    });
    assert(reply.status === "replied" && reply.reply.content === replyMarker
      && reply.reply.reviewAuthority === false && reply.reply.promotionAuthority === false,
      "Durable developer reply did not prove the exact Codex reply.", "LIVE_PROVIDER_COORDINATION_REPLY_MISSING");
    assert(developerResult.exitCode === 0 && !developerResult.timedOut
      && developerResult.supervision.ownershipEstablished && developerResult.supervision.treeCleanupVerified,
    "Actual OpenCode developer client did not complete under verified descendant ownership.",
    "LIVE_PROVIDER_COORDINATION_OPENCODE_FAILED", providerSummary(developerResult));
    assert(developerResult.observedTools.includes("head_coordination_send_message")
      && developerResult.observedTools.includes("head_coordination_wait_reply"),
      "Actual OpenCode event stream did not prove both send and bounded reply-wait tool calls.",
      "LIVE_PROVIDER_COORDINATION_OPENCODE_TOOL_MISSING", providerSummary(developerResult));

    const controlPrompt = (role) => [
      `Act only as the already-bound ${role} role in this isolated control verification.`,
      `Call head_coordination_read_inbox with project_root=${JSON.stringify(projectRoot)}, unread_only=true, and wait_timeout_ms=600000.`,
      "Wait for the call. Do not use any other tool or disclose environment values.",
    ].join("\n");
    coderControlClient = launchSupervisedClient({
      runtime: "codex",
      label: "coder-interrupt-control",
      executablePath: targets.codex.executablePath,
      args: codexArguments(codexModel),
      environment: {
        ...baseRuntimeEnvironment(),
        ...hostEnvironment({ bindingToken: coder.bindingToken, endpoint: endpoint.coder, proof: proofs.coder }),
      },
      input: `${controlPrompt("coder")}\n`,
      supervisorSelection,
    });
    reviewerControlClient = launchSupervisedClient({
      runtime: "opencode",
      label: "reviewer-close-control",
      executablePath: targets.opencode.executablePath,
      args: ["run", "--format", "json", "--pure", "--dir", projectRoot, "--model", openCodeModel, "--auto", "--title", "HEAD bounded close reviewer"],
      environment: openCodeEnvironment(reviewer.bindingToken, endpoint.reviewer, proofs.reviewer),
      input: `${controlPrompt("reviewer")}\n`,
      supervisorSelection,
    });
    await Promise.all([
      waitForProviderStart(coderControlClient, "Codex coder control"),
      waitForProviderStart(reviewerControlClient, "OpenCode reviewer control"),
    ]);
    await waitForRolesAttached(environment, ["coder", "reviewer"], [coderControlClient, reviewerControlClient]);
    coderControlClient.interrupt();
    reviewerControlClient.close();
    [coderControlResult, reviewerControlResult] = await Promise.all([
      coderControlClient.completed,
      reviewerControlClient.completed,
    ]);
    assert(coderControlResult.supervision.action === "interrupt"
      && coderControlResult.supervision.ownershipEstablished
      && coderControlResult.supervision.treeCleanupVerified,
    "Actual Codex bounded interrupt did not verify exact owned-tree cleanup.",
    "LIVE_PROVIDER_COORDINATION_INTERRUPT_FAILED", providerSummary(coderControlResult));
    assert(reviewerControlResult.supervision.action === "close"
      && reviewerControlResult.supervision.ownershipEstablished
      && reviewerControlResult.supervision.treeCleanupVerified,
    "Actual OpenCode bounded close did not verify exact owned-tree cleanup.",
    "LIVE_PROVIDER_COORDINATION_CLOSE_FAILED", providerSummary(reviewerControlResult));
    assert(canonicalJson(treeBytes(path.join(projectRoot, ".head"))) === canonicalJson(headBefore),
      "Live provider coordination changed canonical .head bytes.", "LIVE_PROVIDER_COORDINATION_PROJECT_MUTATION");
    for (const secret of [
      ...Object.values(proofs),
      developer.bindingToken, head.bindingToken, coder.bindingToken, reviewer.bindingToken,
      developerClient.controlled.controlToken, headClient.controlled.controlToken,
      coderControlClient.controlled.controlToken, reviewerControlClient.controlled.controlToken,
    ]) {
      assert(!rootsContainBytes([projectRoot, operationalRoot, exportRoot], secret),
        "A raw process proof or role binding token persisted in scoped state.", "LIVE_PROVIDER_COORDINATION_SECRET_PERSISTED");
    }
    for (const providerSessionReference of [
      ...developerResult.providerSessionReferences,
      ...headResult.providerSessionReferences,
      ...coderControlResult.providerSessionReferences,
      ...reviewerControlResult.providerSessionReferences,
    ]) {
      assert(!rootsContainBytes([projectRoot, operationalRoot, exportRoot], providerSessionReference),
        "An actual provider session reference persisted in scoped state.", "LIVE_PROVIDER_COORDINATION_PROVIDER_SESSION_PERSISTED");
    }
    assert(!rootsHaveExactJsonKey([projectRoot, operationalRoot, exportRoot], ["providerSessionId", "provider_session_id"]),
      "A provider session identity key persisted in scoped JSON state.", "LIVE_PROVIDER_COORDINATION_PROVIDER_SESSION_PERSISTED");
    successSummary = {
      status: "live_provider_coordination_verified",
      evidenceKind: "actual-codex-opencode-provider-client-e2e",
      models: { codex: codexModel, opencode: openCodeModel },
      runtimeVersions: Object.fromEntries(versions.observations.map((item) => [item.runtime, item.outcome.version])),
      projectId: generation.generation.projectId,
      headSessionId: generation.generation.headSessionId,
      authorityGeneration: generation.generation.authorityGeneration,
      hostSnapshotId: published.snapshotId,
      replacedAttachmentId: staleAttachment.attachmentId,
      messageId: request.messageId,
      acknowledgementHash: acknowledgement.acknowledgementHash,
      codexProviderStartedBeforeRequest: true,
      opencodeProviderStartedBeforeRequest: true,
      spawnedOnClaim: false,
      exactCurrentEndpointReceived: request.endpointId === endpoint.head.endpointId,
      staleEndpointRequestCount: 0,
      endpointReplacementVerified: true,
      durableReadVerified: true,
      durableReplyVerified: true,
      boundedReplyWaitVerified: true,
      replyAuthority: "coordination-evidence-only",
      reviewDecisionCreated: false,
      deliveryReceiptIndependentOfReply: true,
      runtimeOneShotControl: {
        interrupt: providerSummary(coderControlResult),
        close: providerSummary(reviewerControlResult),
        resumeEnabled: false,
        streamEnabled: false,
      },
      projectHeadBytesUnchanged: true,
      providerSessionIdentityPersisted: false,
      rawProcessProofPersisted: false,
      rawBindingTokenPersisted: false,
      herdrSpecificIntegration: false,
      providers: {
        opencode: providerSummary(developerResult),
        codex: providerSummary(headResult),
      },
    };
  } finally {
    developerResult ||= await stopClient(developerClient);
    headResult ||= await stopClient(headClient);
    coderControlResult ||= await stopClient(coderControlClient);
    reviewerControlResult ||= await stopClient(reviewerControlClient);
    removeOwnedRoot(exportRoot, ".qa-live-coordination-export-");
    removeOwnedRoot(operationalRoot, ".qa-live-coordination-operational-");
    removeOwnedRoot(projectRoot, ".qa-live-coordination-");
  }
  process.stdout.write(`${JSON.stringify(successSummary, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    status: "live_provider_coordination_failed",
    code: error.code || "LIVE_PROVIDER_COORDINATION_FAILED",
    message: error.message,
    details: error.details || null,
  })}\n`);
  process.exitCode = 1;
});
