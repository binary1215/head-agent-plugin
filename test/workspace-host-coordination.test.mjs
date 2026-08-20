import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { coreContract, initializeProject } from "../scripts/lib/head-core.mjs";
import {
  attachCoordinationWorkspaceHost,
  createCoordinationWorkspaceHostDeliveryAdapter,
  detachCoordinationWorkspaceHost,
  inspectRoleCoordination,
  issueCoordinationRoleBinding,
  openCoordinationGeneration,
  readCoordinationInbox,
  sendCoordinationMessage,
} from "../scripts/lib/role-coordination.mjs";
import { buildRuntimeAdapterComposition, validateWorkspaceHostAdapter } from "../scripts/lib/runtime-adapter.mjs";
import { VerifiedWorkspaceHostAdapter, WORKSPACE_HOST_COORDINATION_VERSION } from "../scripts/lib/workspace-host-coordination.mjs";
import {
  claimWorkspaceHostExportDelivery,
  createWorkspaceHostExportDriver,
  listWorkspaceHostExportDeliveryRequests,
  publishWorkspaceHostExportSnapshot,
  workspaceHostExportProcessProofHash,
} from "../scripts/lib/workspace-host-export-driver.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const client = path.join(import.meta.dirname, "fixtures", "workspace-host-client.mjs");
const exportMcp = path.join(pluginRoot, "scripts", "workspace-host-export-mcp.mjs");
const exportAcker = path.join(import.meta.dirname, "fixtures", "workspace-host-export-acker.mjs");
const liveProviderVerifier = path.join(pluginRoot, "scripts", "verify-live-provider-coordination.mjs");

function fixture() {
  const parent = process.env.HEAD_AGENT_TEST_TMP || os.tmpdir();
  fs.mkdirSync(parent, { recursive: true });
  const base = fs.mkdtempSync(path.join(parent, "head-workspace-host-"));
  const root = path.join(base, "project");
  const operationalRoot = path.join(base, "operational");
  fs.mkdirSync(root);
  initializeProject({ root, pluginRoot, runtimes: ["codex", "opencode"] });
  return { base, root, operationalRoot, environment: { ...process.env, HEAD_AGENT_OPERATIONAL_STATE_ROOT: operationalRoot } };
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

function treeContainsBytes(root, value) {
  const needle = Buffer.from(value);
  const walk = (directory) => fs.readdirSync(directory).some((name) => {
    const file = path.join(directory, name);
    const stat = fs.lstatSync(file);
    return stat.isDirectory() ? walk(file) : fs.readFileSync(file).indexOf(needle) !== -1;
  });
  return walk(root);
}

function snapshot(fx, endpoints) {
  return {
    schemaVersion: 1,
    kind: "WorkspaceHostSnapshot",
    protocol: { name: "head-agent-core-workspace-host-snapshot", version: WORKSPACE_HOST_COORDINATION_VERSION },
    hostKind: "fixture-host",
    transport: "fixture-memory",
    hostInstanceId: "fixture-host-instance",
    snapshotSequence: `snapshot-${endpoints.map((endpoint) => endpoint.terminalId).join("-")}`,
    endpoints: endpoints.map((endpoint) => ({ cwd: fx.root, ...endpoint })),
  };
}

function driver(fx, state = {}) {
  // Test double only. Production composition is scripts/workspace-host-export-mcp.mjs.
  state.endpoints ||= [
    { workspaceId: "workspace-head", tabId: "tab-head", endpointId: "endpoint-head", terminalId: "terminal-head", runtime: "codex" },
    { workspaceId: "workspace-developer", tabId: "tab-developer", endpointId: "endpoint-developer", terminalId: "terminal-developer", runtime: "opencode" },
  ];
  state.deliveries ||= [];
  return {
    state,
    describe() {
      return {
        schemaVersion: 1,
        kind: "WorkspaceHostDriverDescriptor",
        protocol: { name: "head-agent-core-workspace-host-driver", version: WORKSPACE_HOST_COORDINATION_VERSION },
        hostKind: "fixture-host",
        transport: "fixture-memory",
        providerNeutral: true,
        tuiScraping: false,
        providerSessionIdentityPersisted: false,
      };
    },
    snapshot() { return snapshot(fx, state.endpoints); },
    send({ endpoint, messageId, text }) {
      state.deliveries.push({ endpoint: { ...endpoint }, messageId, text });
      if (state.afterSend) state.afterSend();
      if (state.throwAfterSend) throw new Error("ambiguous fixture send");
      return {
        status: "delivered",
        messageId,
        hostInstanceId: "fixture-host-instance",
        workspaceId: endpoint.workspaceId,
        tabId: endpoint.tabId,
        endpointId: endpoint.endpointId,
        terminalId: endpoint.terminalId,
      };
    },
  };
}

const caller = (role) => ({ workspaceId: `workspace-${role}`, tabId: `tab-${role}`, endpointId: `endpoint-${role}` });
const processProof = () => crypto.randomBytes(32).toString("base64url");

function exportEndpoints(fx, bindings, proofs) {
  return driver(fx).state.endpoints.map((endpoint) => {
    const role = endpoint.endpointId.replace("endpoint-", "");
    return {
      cwd: fx.root,
      ...endpoint,
      bindingId: bindings[role].binding.bindingId,
      processProofHash: workspaceHostExportProcessProofHash(proofs[role]),
    };
  });
}

function startExportAcker({ exportRoot, projectRoot, endpointId, outputFile }) {
  const child = spawn(process.execPath, [exportAcker, exportRoot, projectRoot, endpointId, outputFile], {
    cwd: pluginRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const ready = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.stdout.setEncoding("utf8");
    child.stdout.once("data", (chunk) => chunk.includes("READY") ? resolve() : reject(new Error(`Unexpected acker readiness: ${chunk}`)));
    child.once("exit", (code) => { if (code !== 0) reject(new Error(`Workspace host export acker exited ${code}: ${stderr}`)); });
  });
  const completed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Workspace host export acker exited ${code}: ${stderr}`)));
  });
  return { child, ready, completed };
}

test("actual provider-client coordination verifier requires explicit opt-in", () => {
  const environment = { ...process.env };
  delete environment.HEAD_AGENT_LIVE_COORDINATION_E2E;
  const result = spawnSync(process.execPath, [liveProviderVerifier], {
    cwd: pluginRoot,
    env: environment,
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /LIVE_PROVIDER_COORDINATION_OPT_IN_REQUIRED/u);
});

test("active WorkspaceHostAdapter delivers only after durable acceptance and exact target proof", (t) => {
  const fx = fixture();
  t.after(() => fs.rmSync(fx.base, { recursive: true, force: true }));
  const projectBefore = treeBytes(path.join(fx.root, ".head"));
  openCoordinationGeneration({ root: fx.root, environment: fx.environment });
  const developer = issueCoordinationRoleBinding({ root: fx.root, role: "developer", environment: fx.environment });
  const head = issueCoordinationRoleBinding({ root: fx.root, role: "head", environment: fx.environment });
  const hostDriver = driver(fx);
  const adapter = new VerifiedWorkspaceHostAdapter({ driver: hostDriver });
  validateWorkspaceHostAdapter(adapter);
  const composition = buildRuntimeAdapterComposition({ workspaceHostAdapter: adapter });
  assert.equal(composition.activationBoundary.workspaceHostMessagingEnabled, true);
  assert.equal(composition.activationBoundary.runtimeControlEnabled, false);
  assert.equal(composition.workspaceHostProbe.status, "active");
  assert.ok(coreContract().activeCapabilities.includes("verified-workspace-host-adapter"));
  assert.ok(coreContract().activeCapabilities.includes("host-export-filesystem-workspace-driver"));
  assert.ok(coreContract().activeCapabilities.includes("binding-scoped-offline-workspace-wake"));
  assert.ok(coreContract().activeCapabilities.includes("actual-codex-opencode-role-round-trip"));
  assert.ok(coreContract().deferredCapabilities.includes("host-specific-workspace-adapter"));

  assert.equal(attachCoordinationWorkspaceHost({ root: fx.root, environment: fx.environment, bindingToken: developer.bindingToken, workspaceHostAdapter: adapter, caller: caller("developer") }).status, "attached");
  assert.equal(attachCoordinationWorkspaceHost({ root: fx.root, environment: fx.environment, bindingToken: head.bindingToken, workspaceHostAdapter: adapter, caller: caller("head") }).status, "attached");
  assert.deepEqual(inspectRoleCoordination({ root: fx.root, environment: fx.environment }).attachedRoles, ["developer", "head"]);

  const accepted = sendCoordinationMessage({
    root: fx.root,
    environment: fx.environment,
    bindingToken: developer.bindingToken,
    toRole: "head",
    content: "Review the evidence; this message grants no authority.",
    idempotencyKey: "live-delivery",
    deliveryAdapter: createCoordinationWorkspaceHostDeliveryAdapter({ root: fx.root, environment: fx.environment, workspaceHostAdapter: adapter }),
  });
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.delivery.status, "delivered");
  assert.match(accepted.delivery.targetAttachmentId, /^workspace-attachment-[a-f0-9]{32}$/);
  assert.equal(hostDriver.state.deliveries.length, 1);
  assert.match(hostDriver.state.deliveries[0].text, /^\[HEAD coordination evidence only; from developer; msg:/);
  assert.equal(readCoordinationInbox({ root: fx.root, environment: fx.environment, bindingToken: head.bindingToken }).messages[0].messageId, accepted.message.messageId);
  assert.deepEqual(treeBytes(path.join(fx.root, ".head")), projectBefore);
  const deliveryReceiptFile = path.join(
    fx.operationalRoot, "role-coordination", "v1", accepted.message.projectId, accepted.message.headSessionId,
    "generation-state", accepted.message.authorityGeneration, "deliveries", `${accepted.message.messageId}.json`,
  );
  const operational = fs.readFileSync(deliveryReceiptFile, "utf8");
  assert.equal(operational.includes("providerSession"), false);
  const tamperedReceipt = JSON.parse(operational);
  tamperedReceipt.targetAttachmentId = "workspace-attachment-00000000000000000000000000000000";
  fs.writeFileSync(deliveryReceiptFile, `${JSON.stringify(tamperedReceipt, null, 2)}\n`);
  assert.throws(() => sendCoordinationMessage({ root: fx.root, environment: fx.environment, bindingToken: developer.bindingToken, toRole: "head", content: "Review the evidence; this message grants no authority.", idempotencyKey: "live-delivery" }), { code: "INVALID_COORDINATION_DELIVERY_RECEIPT" });
});

test("stale, replaced, detached, and post-send-changed targets never become delivered", (t) => {
  const fx = fixture();
  t.after(() => fs.rmSync(fx.base, { recursive: true, force: true }));
  const opened = openCoordinationGeneration({ root: fx.root, environment: fx.environment });
  const developer = issueCoordinationRoleBinding({ root: fx.root, role: "developer", environment: fx.environment });
  const head = issueCoordinationRoleBinding({ root: fx.root, role: "head", environment: fx.environment });
  const state = {};
  const hostDriver = driver(fx, state);
  const adapter = new VerifiedWorkspaceHostAdapter({ driver: hostDriver });
  attachCoordinationWorkspaceHost({ root: fx.root, environment: fx.environment, bindingToken: head.bindingToken, workspaceHostAdapter: adapter, caller: caller("head") });

  state.endpoints[0].terminalId = "terminal-head-replaced";
  const stale = sendCoordinationMessage({ root: fx.root, environment: fx.environment, bindingToken: developer.bindingToken, toRole: "head", content: "stale", idempotencyKey: "stale", deliveryAdapter: createCoordinationWorkspaceHostDeliveryAdapter({ root: fx.root, environment: fx.environment, workspaceHostAdapter: adapter }) });
  assert.equal(stale.delivery.status, "unavailable");
  assert.equal(state.deliveries.length, 0);

  state.endpoints[0].terminalId = "terminal-head";
  state.afterSend = () => { state.endpoints[0].terminalId = "terminal-head-after-send"; };
  const changed = sendCoordinationMessage({ root: fx.root, environment: fx.environment, bindingToken: developer.bindingToken, toRole: "head", content: "changed", idempotencyKey: "changed", deliveryAdapter: createCoordinationWorkspaceHostDeliveryAdapter({ root: fx.root, environment: fx.environment, workspaceHostAdapter: adapter }) });
  assert.equal(changed.delivery.status, "ambiguous");
  assert.equal(state.deliveries.length, 1);
  state.afterSend = null;
  state.endpoints[0].terminalId = "terminal-head";

  state.endpoints.push({ workspaceId: "workspace-head-2", tabId: "tab-head-2", endpointId: "endpoint-head-2", terminalId: "terminal-head-2", runtime: "codex" });
  state.afterSend = () => attachCoordinationWorkspaceHost({
    root: fx.root,
    environment: fx.environment,
    bindingToken: head.bindingToken,
    workspaceHostAdapter: adapter,
    caller: { workspaceId: "workspace-head-2", tabId: "tab-head-2", endpointId: "endpoint-head-2" },
  });
  const targetChanged = sendCoordinationMessage({ root: fx.root, environment: fx.environment, bindingToken: developer.bindingToken, toRole: "head", content: "target changed", idempotencyKey: "target-changed", deliveryAdapter: createCoordinationWorkspaceHostDeliveryAdapter({ root: fx.root, environment: fx.environment, workspaceHostAdapter: adapter }) });
  assert.equal(targetChanged.delivery.status, "ambiguous");
  state.afterSend = null;

  const replacement = issueCoordinationRoleBinding({ root: fx.root, role: "head", environment: fx.environment });
  assert.deepEqual(inspectRoleCoordination({ root: fx.root, environment: fx.environment }).attachedRoles, []);
  const replaced = sendCoordinationMessage({ root: fx.root, environment: fx.environment, bindingToken: developer.bindingToken, toRole: "head", content: "replaced", idempotencyKey: "replaced", deliveryAdapter: createCoordinationWorkspaceHostDeliveryAdapter({ root: fx.root, environment: fx.environment, workspaceHostAdapter: adapter }) });
  assert.equal(replaced.delivery.status, "unavailable");
  const head2 = state.endpoints.at(-1);
  head2.cwd = fx.base;
  assert.throws(() => attachCoordinationWorkspaceHost({ root: fx.root, environment: fx.environment, bindingToken: replacement.bindingToken, workspaceHostAdapter: adapter, caller: { workspaceId: head2.workspaceId, tabId: head2.tabId, endpointId: head2.endpointId } }), { code: "WORKSPACE_HOST_PROJECT_MISMATCH" });
  head2.cwd = fx.root;
  attachCoordinationWorkspaceHost({ root: fx.root, environment: fx.environment, bindingToken: replacement.bindingToken, workspaceHostAdapter: adapter, caller: caller("head") });
  assert.equal(detachCoordinationWorkspaceHost({ root: fx.root, environment: fx.environment, bindingToken: replacement.bindingToken, workspaceHostAdapter: adapter }).status, "detached");
  const detached = sendCoordinationMessage({ root: fx.root, environment: fx.environment, bindingToken: developer.bindingToken, toRole: "head", content: "detached", idempotencyKey: "detached", deliveryAdapter: createCoordinationWorkspaceHostDeliveryAdapter({ root: fx.root, environment: fx.environment, workspaceHostAdapter: adapter }) });
  assert.equal(detached.delivery.status, "unavailable");

  const targetRoot = path.join(fx.operationalRoot, "role-coordination", "v1", opened.generation.projectId, opened.generation.headSessionId, "generation-state", opened.generation.authorityGeneration, "targets");
  const records = fs.readdirSync(path.join(targetRoot, "by-id")).map((name) => JSON.parse(fs.readFileSync(path.join(targetRoot, "by-id", name), "utf8"))).filter((record) => record.role === "head").sort((left, right) => left.targetSequence - right.targetSequence);
  const first = records[0];
  fs.writeFileSync(path.join(targetRoot, "roles", "head.json"), `${JSON.stringify({ schemaVersion: 1, projectId: first.projectId, headSessionId: first.headSessionId, authorityGeneration: first.authorityGeneration, role: first.role, targetId: first.targetId, targetHash: first.targetHash, targetSequence: first.targetSequence, updatedAt: new Date().toISOString() }, null, 2)}\n`);
  assert.throws(() => inspectRoleCoordination({ root: fx.root, environment: fx.environment }), { code: "COORDINATION_TARGET_ROLLBACK" });
});

test("two fresh MCP processes share exact host-local targets without provider session identity", (t) => {
  const fx = fixture();
  t.after(() => fs.rmSync(fx.base, { recursive: true, force: true }));
  openCoordinationGeneration({ root: fx.root, environment: fx.environment });
  const developer = issueCoordinationRoleBinding({ root: fx.root, role: "developer", environment: fx.environment });
  const head = issueCoordinationRoleBinding({ root: fx.root, role: "head", environment: fx.environment });
  const snapshotFile = path.join(fx.base, "snapshot.json");
  const deliveryFile = path.join(fx.base, "deliveries.jsonl");
  const requestFile = path.join(fx.base, "request.json");
  fs.writeFileSync(snapshotFile, `${JSON.stringify({ ...snapshot(fx, driver(fx).state.endpoints), transport: "fixture-file" }, null, 2)}\n`);
  fs.writeFileSync(deliveryFile, "");
  const invoke = ({ token, role, request }) => {
    fs.writeFileSync(requestFile, `${JSON.stringify(request, null, 2)}\n`);
    const result = spawnSync(process.execPath, [client, requestFile, snapshotFile, deliveryFile], {
      cwd: pluginRoot,
      encoding: "utf8",
      env: {
        ...fx.environment,
        HEAD_AGENT_COORDINATION_BINDING_TOKEN: token,
        HEAD_AGENT_HOST_WORKSPACE_ID: `workspace-${role}`,
        HEAD_AGENT_HOST_TAB_ID: `tab-${role}`,
        HEAD_AGENT_HOST_ENDPOINT_ID: `endpoint-${role}`,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const headAttached = invoke({ token: head.bindingToken, role: "head", request: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "head_coordination_read_inbox", arguments: { project_root: fx.root } } } });
  assert.deepEqual(headAttached.result.structuredContent.messages, []);
  const listed = invoke({ token: developer.bindingToken, role: "developer", request: { jsonrpc: "2.0", id: 10, method: "tools/list", params: {} } });
  const roleTools = listed.result.tools.filter((tool) => tool.name.startsWith("head_coordination_"));
  assert.deepEqual(roleTools.map((tool) => tool.name), [
    "head_coordination_send_message",
    "head_coordination_read_inbox",
    "head_coordination_wait_reply",
    "head_coordination_reply_message",
  ]);
  for (const tool of roleTools) {
    const properties = Object.keys(tool.inputSchema.properties || {});
    assert.deepEqual(properties.filter((field) => ["caller", "workspace_id", "tab_id", "endpoint_id", "terminal_id", "attachment_id"].includes(field)), []);
  }
  const sent = invoke({ token: developer.bindingToken, role: "developer", request: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "head_coordination_send_message", arguments: { project_root: fx.root, to_role: "head", content: "fresh process delivery", idempotency_key: "fresh-host-process" } } } });
  assert.equal(sent.result.structuredContent.delivery.status, "delivered");
  const inbox = invoke({ token: head.bindingToken, role: "head", request: { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "head_coordination_read_inbox", arguments: { project_root: fx.root } } } });
  assert.equal(inbox.result.structuredContent.messages[0].content, "fresh process delivery");
  const allState = fs.readFileSync(deliveryFile, "utf8") + fs.readFileSync(snapshotFile, "utf8");
  assert.equal(allState.includes("providerSession"), false);
});

test("production host-export bridge delivers through create-only request and exact acknowledgment", async (t) => {
  const fx = fixture();
  t.after(() => fs.rmSync(fx.base, { recursive: true, force: true }));
  const exportRoot = path.join(fx.base, "host-export");
  fs.mkdirSync(exportRoot);
  const outputFile = path.join(fx.base, "host-delivery.json");
  openCoordinationGeneration({ root: fx.root, environment: fx.environment });
  const developer = issueCoordinationRoleBinding({ root: fx.root, role: "developer", environment: fx.environment });
  const head = issueCoordinationRoleBinding({ root: fx.root, role: "head", environment: fx.environment });
  const bindings = { developer, head };
  const proofs = { developer: processProof(), head: processProof() };
  const endpoints = exportEndpoints(fx, bindings, proofs);
  publishWorkspaceHostExportSnapshot({ exportRoot, projectRoot: fx.root, hostInstanceId: "host-export-live", endpoints });
  assert.doesNotThrow(() => createWorkspaceHostExportDriver({
    exportRoot,
    projectRoot: fx.root,
    caller: caller("head"),
    bindingId: head.binding.bindingId,
    processProof: proofs.head,
    acknowledgementTimeoutMs: 600_000,
  }));
  assert.throws(() => createWorkspaceHostExportDriver({
    exportRoot,
    projectRoot: fx.root,
    caller: caller("head"),
    bindingId: head.binding.bindingId,
    processProof: proofs.head,
    acknowledgementTimeoutMs: 600_001,
  }), { code: "INVALID_WORKSPACE_HOST_EXPORT_TIMING" });
  const projectBefore = treeBytes(path.join(fx.root, ".head"));
  const invoke = ({ token, role, endpointRole = role, proof = proofs[endpointRole], request }) => {
    const result = spawnSync(process.execPath, [exportMcp], {
      cwd: pluginRoot,
      encoding: "utf8",
      input: `${JSON.stringify(request)}\n`,
      env: {
        ...fx.environment,
        HEAD_AGENT_COORDINATION_BINDING_TOKEN: token,
        HEAD_AGENT_HOST_PROJECT_ROOT: fx.root,
        HEAD_AGENT_WORKSPACE_HOST_EXPORT_ROOT: exportRoot,
        HEAD_AGENT_HOST_WORKSPACE_ID: `workspace-${endpointRole}`,
        HEAD_AGENT_HOST_TAB_ID: `tab-${endpointRole}`,
        HEAD_AGENT_HOST_ENDPOINT_ID: `endpoint-${endpointRole}`,
        HEAD_AGENT_HOST_PROCESS_PROOF: proof,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout.trim());
  };
  assert.deepEqual(inspectRoleCoordination({ root: fx.root, environment: fx.environment }).attachedRoles, []);
  const missingProofEnvironment = {
    ...fx.environment,
    HEAD_AGENT_COORDINATION_BINDING_TOKEN: head.bindingToken,
    HEAD_AGENT_HOST_PROJECT_ROOT: fx.root,
    HEAD_AGENT_WORKSPACE_HOST_EXPORT_ROOT: exportRoot,
    HEAD_AGENT_HOST_WORKSPACE_ID: "workspace-head",
    HEAD_AGENT_HOST_TAB_ID: "tab-head",
    HEAD_AGENT_HOST_ENDPOINT_ID: "endpoint-head",
  };
  const missingProof = spawnSync(process.execPath, [exportMcp], {
    cwd: pluginRoot,
    encoding: "utf8",
    input: `${JSON.stringify({ jsonrpc: "2.0", id: 8, method: "tools/list", params: {} })}\n`,
    env: missingProofEnvironment,
  });
  assert.notEqual(missingProof.status, 0);
  assert.match(missingProof.stderr, /HEAD_AGENT_HOST_PROCESS_PROOF/u);
  const copiedEndpoint = invoke({ token: developer.bindingToken, role: "developer", endpointRole: "head", request: { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "head_coordination_read_inbox", arguments: { project_root: fx.root } } } });
  assert.equal(copiedEndpoint.error.code, -32000);
  const forgedProof = invoke({ token: developer.bindingToken, role: "developer", proof: proofs.head, request: { jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "head_coordination_read_inbox", arguments: { project_root: fx.root } } } });
  assert.equal(forgedProof.error.code, -32000);

  const acker = startExportAcker({ exportRoot, projectRoot: fx.root, endpointId: "endpoint-head", outputFile });
  t.after(() => { if (acker.child.exitCode === null) acker.child.kill(); });
  await acker.ready;
  const sent = invoke({ token: developer.bindingToken, role: "developer", request: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "head_coordination_send_message", arguments: { project_root: fx.root, to_role: "head", content: "portable live host delivery", idempotency_key: "host-export-live" } } } });
  assert.equal(sent.result.structuredContent.delivery.status, "delivered");
  assert.equal(sent.result.structuredContent.delivery.targetBindingId, head.binding.bindingId);
  await acker.completed;
  const hostDelivery = JSON.parse(fs.readFileSync(outputFile, "utf8"));
  assert.equal(hostDelivery.endpointId, "endpoint-head");
  assert.equal(hostDelivery.targetBindingId, head.binding.bindingId);
  assert.match(hostDelivery.text, /portable live host delivery/);

  const inbox = invoke({ token: head.bindingToken, role: "head", request: { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "head_coordination_read_inbox", arguments: { project_root: fx.root } } } });
  assert.equal(inbox.result.structuredContent.messages[0].content, "portable live host delivery");
  const detached = detachCoordinationWorkspaceHost({
    root: fx.root,
    environment: fx.environment,
    bindingToken: head.bindingToken,
    workspaceHostAdapter: new VerifiedWorkspaceHostAdapter({
      driver: createWorkspaceHostExportDriver({
        exportRoot,
        projectRoot: fx.root,
        caller: caller("head"),
        bindingId: head.binding.bindingId,
        processProof: proofs.head,
      }),
    }),
  });
  assert.equal(detached.status, "detached");
  const detachedSend = invoke({ token: developer.bindingToken, role: "developer", request: { jsonrpc: "2.0", id: 30, method: "tools/call", params: { name: "head_coordination_send_message", arguments: { project_root: fx.root, to_role: "head", content: "must remain detached", idempotency_key: "host-export-detached" } } } });
  assert.equal(detachedSend.result.structuredContent.delivery.status, "unavailable");
  assert.deepEqual(listWorkspaceHostExportDeliveryRequests({ exportRoot, projectRoot: fx.root, endpointId: "endpoint-head" }), []);
  const endpointHash = crypto.createHash("sha256").update("endpoint-head").digest("hex");
  const bridgeRoot = path.join(exportRoot, "workspace-host-export", "v1");
  const request = JSON.parse(fs.readFileSync(path.join(bridgeRoot, "deliveries", endpointHash, `${hostDelivery.messageId}.request.json`), "utf8"));
  fs.unlinkSync(path.join(bridgeRoot, "acks", endpointHash, `${hostDelivery.messageId}.ack.json`));
  const claimedAgain = claimWorkspaceHostExportDelivery({ exportRoot, projectRoot: fx.root, request });
  assert.equal(claimedAgain.status, "ambiguous_existing_claim");
  assert.deepEqual(listWorkspaceHostExportDeliveryRequests({ exportRoot, projectRoot: fx.root, endpointId: "endpoint-head" }), []);
  const wrongProject = invoke({ token: head.bindingToken, role: "head", request: { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "head_coordination_read_inbox", arguments: { project_root: fx.base } } } });
  assert.equal(wrongProject.error.code, -32000);
  assert.deepEqual(treeBytes(path.join(fx.root, ".head")), projectBefore);
  const disclosed = fs.readFileSync(outputFile, "utf8") + JSON.stringify(sent);
  assert.equal(disclosed.includes('"providerSessionId"'), false);
  assert.equal(disclosed.includes('"provider_session_id"'), false);
  assert.equal(disclosed.includes(proofs.head), false);
  assert.equal(disclosed.includes(proofs.developer), false);

  openCoordinationGeneration({ root: fx.root, environment: fx.environment, rotate: true });
  const nextDeveloper = issueCoordinationRoleBinding({ root: fx.root, role: "developer", environment: fx.environment });
  const nextHead = issueCoordinationRoleBinding({ root: fx.root, role: "head", environment: fx.environment });
  const nextBindings = { developer: nextDeveloper, head: nextHead };
  const nextProofs = { developer: processProof(), head: processProof() };
  publishWorkspaceHostExportSnapshot({
    exportRoot,
    projectRoot: fx.root,
    hostInstanceId: "host-export-live",
    endpoints: exportEndpoints(fx, nextBindings, nextProofs),
  });
  const oldProof = invoke({ token: nextHead.bindingToken, role: "head", proof: proofs.head, request: { jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "head_coordination_read_inbox", arguments: { project_root: fx.root } } } });
  assert.equal(oldProof.error.code, -32000);
  const oldBindingAndProof = invoke({ token: head.bindingToken, role: "head", proof: proofs.head, request: { jsonrpc: "2.0", id: 12, method: "tools/call", params: { name: "head_coordination_read_inbox", arguments: { project_root: fx.root } } } });
  assert.equal(oldBindingAndProof.error.code, -32000);
  for (const proof of [...Object.values(proofs), ...Object.values(nextProofs)]) {
    assert.equal(treeContainsBytes(fx.base, proof), false);
  }
});

test("host-export bridge fails closed on overlap, missing acknowledgment, and pointer tamper", (t) => {
  const fx = fixture();
  t.after(() => fs.rmSync(fx.base, { recursive: true, force: true }));
  assert.throws(() => createWorkspaceHostExportDriver({ exportRoot: path.join(fx.root, "bridge"), projectRoot: fx.root }), { code: "WORKSPACE_HOST_EXPORT_PROJECT_OVERLAP" });
  assert.equal(fs.existsSync(path.join(fx.root, "bridge")), false);
  const exportRoot = path.join(fx.base, "host-export");
  fs.mkdirSync(exportRoot);
  openCoordinationGeneration({ root: fx.root, environment: fx.environment });
  const developer = issueCoordinationRoleBinding({ root: fx.root, role: "developer", environment: fx.environment });
  const head = issueCoordinationRoleBinding({ root: fx.root, role: "head", environment: fx.environment });
  const bindings = { developer, head };
  const proofs = { developer: processProof(), head: processProof() };
  const endpoints = exportEndpoints(fx, bindings, proofs);
  publishWorkspaceHostExportSnapshot({ exportRoot, projectRoot: fx.root, hostInstanceId: "host-export-failure", endpoints });
  assert.throws(() => publishWorkspaceHostExportSnapshot({
    exportRoot,
    projectRoot: fx.root,
    hostInstanceId: "host-export-failure",
    endpoints: endpoints.map((endpoint) => endpoint.endpointId === "endpoint-developer" ? { ...endpoint, bindingId: head.binding.bindingId } : endpoint),
  }), { code: "INVALID_WORKSPACE_HOST_EXPORT_ENDPOINT" });
  const forgedAdapter = new VerifiedWorkspaceHostAdapter({
    driver: createWorkspaceHostExportDriver({
      exportRoot,
      projectRoot: fx.root,
      caller: caller("head"),
      bindingId: head.binding.bindingId,
      processProof: proofs.developer,
      acknowledgementTimeoutMs: 30,
      pollIntervalMs: 5,
    }),
  });
  assert.throws(() => forgedAdapter.attach({ caller: caller("head"), boundary: { projectId: "project-test", headSessionId: "session-test", authorityGeneration: "generation-test", role: "head", bindingId: head.binding.bindingId, projectRoot: fx.root } }), { code: "WORKSPACE_HOST_PROCESS_PROOF_MISMATCH" });
  const adapter = new VerifiedWorkspaceHostAdapter({
    driver: createWorkspaceHostExportDriver({
      exportRoot,
      projectRoot: fx.root,
      caller: caller("head"),
      bindingId: head.binding.bindingId,
      processProof: proofs.head,
      acknowledgementTimeoutMs: 30,
      pollIntervalMs: 5,
    }),
  });
  attachCoordinationWorkspaceHost({ root: fx.root, environment: fx.environment, bindingToken: head.bindingToken, workspaceHostAdapter: adapter, caller: caller("head") });
  const ambiguous = sendCoordinationMessage({ root: fx.root, environment: fx.environment, bindingToken: developer.bindingToken, toRole: "head", content: "no host ack", idempotencyKey: "host-export-no-ack", deliveryAdapter: createCoordinationWorkspaceHostDeliveryAdapter({ root: fx.root, environment: fx.environment, workspaceHostAdapter: adapter }) });
  assert.equal(ambiguous.delivery.status, "ambiguous");
  const endpointHash = crypto.createHash("sha256").update("endpoint-head").digest("hex");
  const requestFile = path.join(exportRoot, "workspace-host-export", "v1", "deliveries", endpointHash, `${ambiguous.message.messageId}.request.json`);
  const request = JSON.parse(fs.readFileSync(requestFile, "utf8"));
  const changedEndpoints = endpoints.map((endpoint) => endpoint.endpointId === "endpoint-head" ? { ...endpoint, terminalId: "terminal-head-replaced" } : endpoint);
  publishWorkspaceHostExportSnapshot({ exportRoot, projectRoot: fx.root, hostInstanceId: "host-export-failure", endpoints: changedEndpoints });
  const staleClaim = claimWorkspaceHostExportDelivery({ exportRoot, projectRoot: fx.root, request });
  assert.equal(staleClaim.status, "stale_claimed");
  assert.deepEqual(listWorkspaceHostExportDeliveryRequests({ exportRoot, projectRoot: fx.root, endpointId: "endpoint-head" }), []);
  const pointerFile = path.join(exportRoot, "workspace-host-export", "v1", "current.json");
  const pointer = JSON.parse(fs.readFileSync(pointerFile, "utf8"));
  pointer.pointerHash = "0".repeat(64);
  fs.writeFileSync(pointerFile, `${JSON.stringify(pointer, null, 2)}\n`);
  assert.throws(() => adapter.attach({ caller: caller("developer"), boundary: { projectId: "project-test", headSessionId: "session-test", authorityGeneration: "generation-test", role: "developer", bindingId: "binding-test", projectRoot: fx.root } }), { code: "INVALID_WORKSPACE_HOST_EXPORT_POINTER" });
});
