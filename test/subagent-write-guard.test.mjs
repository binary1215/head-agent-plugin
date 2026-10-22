import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeProject } from "../scripts/lib/lode-core.mjs";
import { createNativeSessionHostBridge } from "../scripts/lib/session-native-host.mjs";
import { SESSION_HOST_REQUEST_HELPER } from "../scripts/lib/session-host-request.mjs";
import { observeNativeHook } from "../scripts/lib/native-session-observations.mjs";
import { SUBAGENT_STATE_WRITE_REJECTED } from "../scripts/lib/subagent-write-guard.mjs";
import { dispatch } from "../scripts/mcp-server.mjs";
import plugin from "../scripts/opencode-plugin.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");

function project(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lode-subagent-guard-")));
  const root = path.join(base, "project");
  fs.mkdirSync(root);
  initializeProject({ root, pluginRoot, runtimes: ["claude", "codex", "opencode"] });
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const operational = path.join(base, "operational");
  const environment = enforced => ({
    HEAD_AGENT_OPERATIONAL_STATE_ROOT: operational,
    ...(enforced ? { LODE_SUBAGENT_WRITE_GUARD: "enforce" } : {}),
  });
  const canon = () => fs.readdirSync(path.join(root, ".lode"), { recursive: true }).sort();
  return { base, root, operational, environment, canon };
}

const rejected = response => response?.error?.message?.includes(SUBAGENT_STATE_WRITE_REJECTED) === true;

function claudeWire(root, name, args, id, routed = false) {
  const request = {
    jsonrpc: "2.0", id, method: "tools/call",
    params: {
      _meta: { "claudecode/toolUseId": id },
      name: routed ? "head_tools_call" : name,
      arguments: routed ? { name, arguments: { project_root: root, ...args } } : { project_root: root, ...args },
    },
  };
  return request;
}

function claudeHook(wire, nativeSessionId, agentId) {
  return {
    id: "hook", method: "tools/call",
    params: {
      name: SESSION_HOST_REQUEST_HELPER,
      arguments: {
        native_session_id: nativeSessionId,
        native_agent_id: agentId,
        tool_use_id: wire.params._meta["claudecode/toolUseId"],
        outer_tool_name: "mcp__lode_core__" + wire.params.name,
        original_arguments: JSON.stringify(wire.params.arguments),
      },
    },
  };
}

async function claudeCall(bridge, wire, agentId) {
  const prepared = await dispatch(claudeHook(wire, "native-claude-root", agentId), { nativeSessionBridge: bridge });
  assert.equal(prepared.result?.isError, undefined);
  return dispatch(wire, { nativeSessionBridge: bridge });
}

test("Claude subagent writes are rejected only while the guard is enforced", async t => {
  const { root, environment, canon } = project(t);
  const enforced = createNativeSessionHostBridge({ runtime: "claude", environment: environment(true) });
  const child = claudeWire(root, "head_session_create", { purpose: "child canon" }, "claude-child", true);
  const before = canon();
  const blocked = await claudeCall(enforced, child, "agent-child");
  assert.equal(rejected(blocked), true);
  assert.deepEqual(canon(), before, "A rejected subagent write does not change canon.");
  const status = await claudeCall(enforced, claudeWire(root, "head_project_status", {}, "claude-read"), "agent-child");
  assert.equal(rejected(status), false);
  assert.equal(status.result?.structuredContent?.project?.projectId != null || status.result?.structuredContent?.status != null || status.result?.content != null, true);
  const parent = await claudeCall(enforced, claudeWire(root, "head_session_create", { purpose: "parent canon" }, "claude-parent", true), "");
  assert.equal(rejected(parent), false);
  assert.equal(typeof parent.result?.structuredContent?.sessionId, "string");
  const checkpoint = await claudeCall(enforced, claudeWire(root, "head_checkpoint_sync", { purpose: "child checkpoint" }, "claude-checkpoint"), "agent-checkpoint");
  assert.equal(rejected(checkpoint), true);
  const open = createNativeSessionHostBridge({ runtime: "claude", environment: environment(false) });
  const allowed = await claudeCall(open, claudeWire(root, "head_session_create", { purpose: "guard off" }, "claude-off", true), "agent-off");
  assert.equal(rejected(allowed), false);
  assert.equal(typeof allowed.result?.structuredContent?.sessionId, "string");
  enforced.dispose();
  open.dispose();
});

test("Codex subagent meta and SubagentStart observations reject state writes when enforced", async t => {
  const { root, environment, canon } = project(t);
  const bridge = createNativeSessionHostBridge({ runtime: "codex", environment: environment(true) });
  const call = (threadId, extra = {}, purpose = "codex child") => dispatch({
    jsonrpc: "2.0", id: purpose, method: "tools/call",
    params: {
      _meta: { threadId, ...extra },
      name: "head_session_create",
      arguments: { project_root: root, purpose },
    },
  }, { nativeSessionBridge: bridge });
  const before = canon();
  assert.equal(rejected(await call("parent-thread", { agent_id: "child-agent" }, "meta agent")), true);
  assert.equal(rejected(await call("parent-thread", { subagent: true }, "meta flag")), true);
  assert.deepEqual(canon(), before);
  const parent = await call("parent-thread", {}, "parent write");
  assert.equal(rejected(parent), false);
  assert.equal(typeof parent.result?.structuredContent?.sessionId, "string");
  const read = await dispatch({
    jsonrpc: "2.0", id: "codex-read", method: "tools/call",
    params: { _meta: { threadId: "parent-thread", subagent: true }, name: "head_project_status", arguments: { project_root: root } },
  }, { nativeSessionBridge: bridge });
  assert.equal(rejected(read), false);
  assert.equal(read.error, undefined);
  await observeNativeHook({
    runtime: "codex", environment: environment(true),
    event: { hook_event_name: "SubagentStart", session_id: "parent-thread", agent_id: "observed-child", cwd: root, turn_id: "turn-child" },
  });
  assert.equal(rejected(await call("observed-child", {}, "observed child")), true);
  const quiet = createNativeSessionHostBridge({ runtime: "codex", environment: environment(false) });
  const off = await dispatch({
    jsonrpc: "2.0", id: "codex-off", method: "tools/call",
    params: { _meta: { threadId: "parent-thread", subagent: true }, name: "head_session_create", arguments: { project_root: root, purpose: "guard off" } },
  }, { nativeSessionBridge: quiet });
  assert.equal(rejected(off), false);
  assert.equal(typeof off.result?.structuredContent?.sessionId, "string");
  bridge.dispose();
  quiet.dispose();
});

test("OpenCode child sessions publish a ticket and the MCP server rejects the write", async t => {
  const { root, operational, environment, canon } = project(t);
  const child = "ses_child";
  const client = { session: {
    async get() { return { data: { id: child, projectID: "host-project", directory: root, parentID: "ses_parent" } }; },
    async status() { return { data: {} }; },
  } };
  const enforcedHooks = await plugin.server({ client, project: { id: "host-project" }, directory: root }, { environment: environment(true) });
  t.after(() => enforcedHooks.dispose());
  await enforcedHooks.config({ mcp: { my_head: { type: "local", command: ["node", path.join(pluginRoot, "scripts/mcp-server.mjs")] } } });
  const bridge = createNativeSessionHostBridge({ environment: environment(true) });
  t.after(() => bridge.dispose());
  const before = canon();
  await enforcedHooks["tool.execute.before"]({
    tool: "my_head_lode_session_create", sessionID: child, callID: "call-child",
    args: { project_root: root, purpose: "child session" },
  }, {});
  const blocked = await dispatch({
    jsonrpc: "2.0", id: "opencode-child", method: "tools/call",
    params: { name: "lode_session_create", arguments: { project_root: root, purpose: "child session" } },
  }, { nativeSessionBridge: bridge });
  assert.equal(rejected(blocked), true);
  assert.deepEqual(canon(), before);
  await enforcedHooks["tool.execute.before"]({
    tool: "my_head_head_tools_call", sessionID: child, callID: "call-router",
    args: { name: "head_checkpoint_sync", arguments: { project_root: root, purpose: "routed child" } },
  }, {});
  const routed = await dispatch({
    jsonrpc: "2.0", id: "opencode-routed", method: "tools/call",
    params: { name: "head_tools_call", arguments: { name: "head_checkpoint_sync", arguments: { project_root: root, purpose: "routed child" } } },
  }, { nativeSessionBridge: bridge });
  assert.equal(rejected(routed), true);
  await enforcedHooks["tool.execute.before"]({
    tool: "my_head_head_project_status", sessionID: child, callID: "call-read",
    args: { project_root: root },
  }, {});
  const read = await dispatch({
    jsonrpc: "2.0", id: "opencode-read", method: "tools/call",
    params: { name: "head_project_status", arguments: { project_root: root } },
  }, { nativeSessionBridge: bridge });
  assert.equal(rejected(read), false);
  assert.equal(read.error, undefined);
  const parentClient = { session: {
    async get() { return { data: { id: "ses_parent", projectID: "host-project", directory: root } }; },
    async status() { return { data: {} }; },
  } };
  const parentHooks = await plugin.server({ client: parentClient, project: { id: "host-project" }, directory: root }, { environment: environment(true) });
  t.after(() => parentHooks.dispose());
  await parentHooks.config({ mcp: { my_head: { type: "local", command: ["node", path.join(pluginRoot, "scripts/mcp-server.mjs")] } } });
  await parentHooks["tool.execute.before"]({
    tool: "my_head_lode_session_create", sessionID: "ses_parent", callID: "call-parent",
    args: { project_root: root, purpose: "parent session" },
  }, {});
  const parent = await dispatch({
    jsonrpc: "2.0", id: "opencode-parent", method: "tools/call",
    params: { name: "lode_session_create", arguments: { project_root: root, purpose: "parent session" } },
  }, { nativeSessionBridge: bridge });
  assert.equal(rejected(parent), false);
  assert.equal(typeof parent.result?.structuredContent?.sessionId, "string");
  const offHooks = await plugin.server({ client, project: { id: "host-project" }, directory: root }, { environment: environment(false) });
  t.after(() => offHooks.dispose());
  await offHooks.config({ mcp: { my_head: { type: "local", command: ["node", path.join(pluginRoot, "scripts/mcp-server.mjs")] } } });
  const signals = path.join(operational, "subagent-caller-signals");
  const beforeOff = fs.existsSync(signals) ? fs.readdirSync(signals).sort() : [];
  await offHooks["tool.execute.before"]({
    tool: "my_head_lode_session_create", sessionID: child, callID: "call-off",
    args: { project_root: root, purpose: "guard off" },
  }, {});
  const afterOff = fs.existsSync(signals) ? fs.readdirSync(signals).sort() : [];
  assert.deepEqual(afterOff, beforeOff, "A disabled guard does not publish a caller ticket.");
  const quiet = createNativeSessionHostBridge({ environment: environment(false) });
  t.after(() => quiet.dispose());
  const allowed = await dispatch({
    jsonrpc: "2.0", id: "opencode-off", method: "tools/call",
    params: { name: "lode_session_create", arguments: { project_root: root, purpose: "guard off" } },
  }, { nativeSessionBridge: quiet });
  assert.equal(rejected(allowed), false);
  assert.equal(typeof allowed.result?.structuredContent?.sessionId, "string");
});
