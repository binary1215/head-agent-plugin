#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { initializeProject } from "./lib/head-core.mjs";
import { buildRuntimeVersionEvidence } from "./lib/runtime-machine-execution.mjs";
import { resolveReadOnlyRuntimeExecutableTarget } from "./lib/runtime-machine-discovery.mjs";
import { resolveVerifiedProcessSupervisor, spawnSupervisedProcess } from "./lib/runtime-process-supervisor.mjs";
import {
  issueCoordinationRoleBinding,
  openCoordinationGeneration,
  readCoordinationInbox,
  readCoordinationReply,
} from "./lib/role-coordination.mjs";
import {
  acknowledgeWorkspaceHostExportDelivery,
  claimWorkspaceHostExportDelivery,
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

function hostEnvironment({ bindingToken, endpointRole, proof }) {
  return {
    HEAD_AGENT_OPERATIONAL_STATE_ROOT: operationalRoot,
    HEAD_AGENT_COORDINATION_BINDING_TOKEN: bindingToken,
    HEAD_AGENT_HOST_PROJECT_ROOT: projectRoot,
    HEAD_AGENT_WORKSPACE_HOST_EXPORT_ROOT: exportRoot,
    HEAD_AGENT_HOST_WORKSPACE_ID: `workspace-${endpointRole}`,
    HEAD_AGENT_HOST_TAB_ID: `tab-${endpointRole}`,
    HEAD_AGENT_HOST_ENDPOINT_ID: `endpoint-${endpointRole}`,
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

function openCodeEnvironment(bindingToken, proof) {
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
    ...hostEnvironment({ bindingToken, endpointRole: "developer", proof }),
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

function launchSupervisedClient({ runtime, executablePath, args, environment, input, supervisorSelection }) {
  const controlDirectory = path.join(operationalRoot, "live-provider-control", runtime);
  fs.mkdirSync(controlDirectory, { recursive: true });
  const controlFile = path.join(controlDirectory, "supervisor-control.jsonl");
  assert(!fs.existsSync(controlFile), "Live provider control file already exists.", "LIVE_PROVIDER_COORDINATION_CONTROL_EXISTS");
  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  let lineBuffer = "";
  const records = [];
  let timedOut = false;
  let forceTimer = null;
  let settled = false;
  let child = null;
  const supervised = spawnSupervisedProcess({
    selection: supervisorSelection,
    executablePath,
    args,
    cwd: projectRoot,
    providerEnvironment: environment,
    input: Buffer.from(input, "utf8"),
    controlFile,
    terminationGraceMs: 5_000,
    onControlEvent: (event) => {
      if (event.type === "provider.started") recordProcess({
        type: "spawn", pid: event.providerPid, parentPid: child?.pid || process.pid,
        command: `${runtime} live coordination client`, cwd: projectRoot,
      });
      if (event.type === "provider.exited") recordProcess({
        type: "exit", pid: event.providerPid, parentPid: child?.pid || process.pid,
        exitCode: event.exitCode, signal: "none",
      });
    },
  });
  child = supervised.child;
  const terminate = (force = false) => {
    if (settled) return;
    supervised.terminate(force);
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
      if (stdout.length > 16 * 1024 * 1024) terminate(false);
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
      if (stderr.length > 4 * 1024 * 1024) terminate(false);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      terminate(false);
      forceTimer = setTimeout(() => terminate(true), 5_000);
      forceTimer.unref?.();
    }, clientTimeoutMs);
    timer.unref?.();
    child.once("close", (code, signal) => {
      settled = true;
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      if (lineBuffer.trim()) {
        try { records.push(JSON.parse(lineBuffer)); } catch {}
      }
      recordProcess({ type: "exit", pid: child.pid, parentPid: process.pid, exitCode: code, signal: signal || "none" });
      const supervision = supervised.finalize({ exactSupervisorExitObserved: true, terminationRequested: timedOut });
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
  return { runtime, child, supervised, terminate, completed };
}

async function stopClient(client) {
  if (!client) return null;
  if (client.child.exitCode === null && client.child.signalCode === null) client.terminate(false);
  return await Promise.race([
    client.completed,
    sleep(7_000).then(() => {
      client.terminate(true);
      return client.completed;
    }),
  ]);
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
  let developerResult = null;
  let headResult = null;
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
    const proofs = {
      developer: crypto.randomBytes(32).toString("base64url"),
      head: crypto.randomBytes(32).toString("base64url"),
    };
    const endpoints = [
      {
        workspaceId: "workspace-developer", tabId: "tab-developer", endpointId: "endpoint-developer",
        terminalId: "terminal-developer", cwd: projectRoot, runtime: "opencode",
        bindingId: developer.binding.bindingId,
        processProofHash: workspaceHostExportProcessProofHash(proofs.developer),
      },
      {
        workspaceId: "workspace-head", tabId: "tab-head", endpointId: "endpoint-head",
        terminalId: "terminal-head", cwd: projectRoot, runtime: "codex",
        bindingId: head.binding.bindingId,
        processProofHash: workspaceHostExportProcessProofHash(proofs.head),
      },
    ];
    const published = publishWorkspaceHostExportSnapshot({
      exportRoot, projectRoot, hostInstanceId: `live-provider-host-${digest(nonce).slice(0, 16)}`, endpoints,
    });
    const headBefore = treeBytes(path.join(projectRoot, ".head"));
    const messageMarker = `LIVE_PROVIDER_COORDINATION_${digest(nonce).slice(0, 24)}`;
    const replyMarker = `LIVE_PROVIDER_REPLY_${digest(`${nonce}\0reply`).slice(0, 24)}`;
    const idempotencyKey = `live-provider-${digest(nonce).slice(0, 24)}`;
    const openCodePrompt = [
      "Act only as the already-bound developer role in this isolated HEAD Agent verification.",
      "Use the head_core MCP tool head_coordination_send_message exactly once and no other tool.",
      `Call it with project_root=${JSON.stringify(projectRoot)}, to_role=\"head\", content=${JSON.stringify(messageMarker)}, and idempotency_key=${JSON.stringify(idempotencyKey)}.`,
      "Wait for the tool result. If and only if delivery is reported, answer exactly OPENCODE_LIVE_SEND_DELIVERED.",
      "Do not use shell, files, network tools, or disclose environment values.",
    ].join("\n");
    developerClient = launchSupervisedClient({
      runtime: "opencode",
      executablePath: targets.opencode.executablePath,
      args: ["run", "--format", "json", "--pure", "--dir", projectRoot, "--model", openCodeModel, "--auto", "--title", "HEAD live coordination developer"],
      environment: openCodeEnvironment(developer.bindingToken, proofs.developer),
      input: `${openCodePrompt}\n`,
      supervisorSelection,
    });
    const request = await waitForDeliveryRequest("endpoint-head", developerClient);
    assert(request.text.includes(messageMarker),
      "Live host request did not carry the expected opaque notification marker.", "LIVE_PROVIDER_COORDINATION_NOTIFICATION_MISMATCH");
    const claimed = claimWorkspaceHostExportDelivery({ exportRoot, projectRoot, request });
    assert(claimed.status === "claimed", "Live host could not acquire the exact pre-effect delivery claim.",
      "LIVE_PROVIDER_COORDINATION_CLAIM_FAILED", { status: claimed.status });

    const codexPrompt = [
      "Act only as the already-bound HEAD role in this isolated HEAD Agent verification.",
      "Use only head_core MCP coordination tools.",
      `First call head_coordination_read_inbox with project_root=${JSON.stringify(projectRoot)} and unread_only=true.`,
      `Find the one message whose content is ${JSON.stringify(messageMarker)}.`,
      `Then call head_coordination_reply_message with project_root=${JSON.stringify(projectRoot)}, in_reply_to set to that message_id, and content=${JSON.stringify(replyMarker)}.`,
      "After both tool calls succeed, answer exactly CODEX_LIVE_READ_REPLY_COMPLETED.",
      "Do not use shell, files, network tools, or disclose environment values.",
    ].join("\n");
    headClient = launchSupervisedClient({
      runtime: "codex",
      executablePath: targets.codex.executablePath,
      args: codexArguments(codexModel),
      environment: {
        ...baseRuntimeEnvironment(),
        ...hostEnvironment({ bindingToken: head.bindingToken, endpointRole: "head", proof: proofs.head }),
      },
      input: `${codexPrompt}\n`,
      supervisorSelection,
    });
    headResult = await headClient.completed;
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
    assert(reply.status === "replied" && reply.reply.content === replyMarker,
      "Durable developer reply did not prove the exact Codex reply.", "LIVE_PROVIDER_COORDINATION_REPLY_MISSING");
    const acknowledgement = acknowledgeWorkspaceHostExportDelivery({
      exportRoot, projectRoot, request, claim: claimed.claim,
    });
    developerResult = await developerClient.completed;
    assert(developerResult.exitCode === 0 && !developerResult.timedOut
      && developerResult.supervision.ownershipEstablished && developerResult.supervision.treeCleanupVerified,
    "Actual OpenCode developer client did not complete under verified descendant ownership.",
    "LIVE_PROVIDER_COORDINATION_OPENCODE_FAILED", providerSummary(developerResult));
    assert(developerResult.observedTools.includes("head_coordination_send_message"),
      "Actual OpenCode event stream did not prove its send-message tool call.",
      "LIVE_PROVIDER_COORDINATION_OPENCODE_TOOL_MISSING", providerSummary(developerResult));
    assert(canonicalJson(treeBytes(path.join(projectRoot, ".head"))) === canonicalJson(headBefore),
      "Live provider coordination changed canonical .head bytes.", "LIVE_PROVIDER_COORDINATION_PROJECT_MUTATION");
    for (const secret of [proofs.developer, proofs.head, developer.bindingToken, head.bindingToken]) {
      assert(!rootsContainBytes([projectRoot, operationalRoot, exportRoot], secret),
        "A raw process proof or role binding token persisted in scoped state.", "LIVE_PROVIDER_COORDINATION_SECRET_PERSISTED");
    }
    for (const providerSessionReference of [
      ...developerResult.providerSessionReferences,
      ...headResult.providerSessionReferences,
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
      messageId: request.messageId,
      acknowledgementHash: acknowledgement.acknowledgementHash,
      durableReadVerified: true,
      durableReplyVerified: true,
      exactDeliveryAcknowledgedAfterReply: true,
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
