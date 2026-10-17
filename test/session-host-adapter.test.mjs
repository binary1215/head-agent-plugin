import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeProject, inspectProject } from "../scripts/lib/head-core.mjs";
import { createHeadSession, withSessionRoute } from "../scripts/lib/session-routing.mjs";
import { createSessionHostAdapter } from "../scripts/lib/session-host-adapter.mjs";
import { sessionStartContext } from "../scripts/session-host-hook.mjs";
import { recordSessionWorkEvidence } from "../scripts/lib/session-work-context.mjs";
import { updateProjectDirection } from "../scripts/lib/project-direction.mjs";
import { dispatch } from "../scripts/mcp-server.mjs";
import { localContinuityCommand } from "./helpers/session-continuity-process.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
function fixture(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "head-session-host-")));
  const root = path.join(base, "project"), operational = path.join(base, "host");
  fs.mkdirSync(root);
  initializeProject({ root, pluginRoot, runtimes: ["codex"] });
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const environment = { HEAD_AGENT_OPERATIONAL_STATE_ROOT: operational };
  const host = (nativeSessionId, agentId = null, runtime = "codex") => createSessionHostAdapter({ runtime, nativeSessionId, agentId, environment });
  return { root, operational, environment, host };
}
const call = (root, name, args, host) => dispatch({ jsonrpc: "2.0", id: "trusted-host-fixture", method: "tools/call",
  params: { name, arguments: { project_root: root, ...args } } }, { resolveSessionContext: host.resolveSessionContext });
function files(root) {
  const items = [];
  function walk(dir) { if (!fs.existsSync(dir)) return; for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) walk(file); else items.push([file, fs.readFileSync(file, "utf8")]);
  } }
  walk(root);
  return items;
}

test("public adapter select/register -> new instance -> per-request resolver -> exact same Session", async (t) => {
  const { root, host, operational, environment } = fixture(t);
  const a = createHeadSession({ root, purpose: "Caller A" }), b = createHeadSession({ root, purpose: "Caller B" });
  const first = host("native-A"), second = host("native-B");
  assert.equal(first.read({ root }).status, "absent");
  assert.equal(first.select({ root, sessionId: a.sessionId, expectedRevision: 0 }).retained, true);
  assert.equal(second.select({ root, sessionId: b.sessionId, expectedRevision: 0 }).retained, true);
  withSessionRoute(root, a.sessionId, () => recordSessionWorkEvidence({ root, input: { unknowns: ["Caller A observation unresolved"] } }));
  const restartedA = host("native-A"), restartedB = host("native-B");
  const results = await Promise.all([
    call(root, "head_conversation_enter", {}, restartedA),
    call(root, "head_conversation_enter", {}, restartedB),
  ]);
  assert.equal(results[0].result.structuredContent.workContext.sessionId, a.sessionId);
  assert.equal(results[0].result.structuredContent.workContext.records[0].content.unknowns[0], "Caller A observation unresolved");
  assert.equal(results[1].result.structuredContent.workContext.sessionId, b.sessionId);
  assert.equal(results[1].result.structuredContent.workContext.records.length, 0);
  const before = files(root).concat(files(operational));
  for (const source of ["startup", "resume", "clear", "compact"]) {
    const output = sessionStartContext({ runtime: "codex", environment,
      event: { hook_event_name: "SessionStart", session_id: "native-A", cwd: root, source } });
    const context = JSON.parse(output.hookSpecificOutput.additionalContext);
    assert.equal(context.logicalSessionId, a.sessionId);
    assert.equal(context.records[0].content.unknowns[0], "Caller A observation unresolved");
    assert.equal(output.hookSpecificOutput.permissionDecision, undefined);
  }
  assert.deepEqual(files(root).concat(files(operational)), before);
  assert.equal(JSON.stringify(files(root)).includes("native-A"), false);
  assert.equal(JSON.stringify(files(operational)).includes("native-A"), false);
});

test("absent/fork caller never chooses default or sole candidate; explicit current request still succeeds", async (t) => {
  const { root, host, operational, environment } = fixture(t);
  const a = createHeadSession({ root, purpose: "Only extra Session" }), caller = host("never-registered");
  const before = files(root);
  assert.equal(caller.enter({ root }).status, "session_selection_unresolved");
  assert.equal(fs.existsSync(operational), false);
  const output = sessionStartContext({ runtime: "codex", environment,
    event: { hook_event_name: "SessionStart", session_id: "new-fork", cwd: root, source: "fork" } });
  assert.equal(JSON.parse(output.hookSpecificOutput.additionalContext).logicalSessionId, null);
  const explicit = await call(root, "head_conversation_enter", { session_id: a.sessionId }, caller);
  assert.equal(explicit.result.structuredContent.workContext.sessionId, a.sessionId);
  assert.equal(caller.read({ root }).status, "absent", "Request-local explicit args do not silently register durable selection.");
  assert.deepEqual(files(root), before);
  assert.equal(fs.existsSync(operational), false);
});

test("declared sharing/default/loss and compare-and-swap are caller scoped, not completion-order selection", async (t) => {
  const { root, host } = fixture(t);
  const a = createHeadSession({ root, purpose: "A" }), b = createHeadSession({ root, purpose: "B" });
  const first = host("first"), second = host("second");
  first.select({ root, sessionId: a.sessionId, expectedRevision: 0 });
  second.select({ root, sessionId: a.sessionId, expectedRevision: 0 });
  assert.equal(second.enter({ root }).workContext.sessionId, a.sessionId);
  const conflicting = first.select({ root, sessionId: b.sessionId, expectedRevision: 0 });
  assert.equal(conflicting.reasonCode, "SESSION_HOST_BINDING_CONFLICT");
  assert.equal(first.enter({ root }).status, "session_selection_unresolved");
  assert.equal(second.enter({ root }).workContext.sessionId, a.sessionId);
  const bound = first.select({ root, sessionId: b.sessionId, expectedRevision: 1 });
  assert.equal(bound.retained, true);
  assert.equal(first.select({ root, sessionId: b.sessionId, expectedRevision: 1 }).binding.revision, 2);
  first.lose({ root, expectedRevision: 2 });
  const lost = (await call(root, "head_conversation_enter", {}, host("first"))).result.structuredContent;
  assert.equal(lost.status, "session_selection_unresolved");
  assert.equal(lost.project.projectId, inspectProject(root).project.projectId);
  assert.equal(lost.ordinaryWorkBlocked, false);
  assert.equal((await call(root, "head_project_direction_read", {}, host("first"))).result.content[0].text, "null");
  first.select({ root, sessionId: "", expectedRevision: 3 });
  assert.equal(first.enter({ root }).workContext.sessionId, inspectProject(root).state.sessionId);
});

test("verified child caller cannot overwrite parent; ambiguous Codex tool Hook writes nothing", (t) => {
  const { root, host, operational, environment } = fixture(t);
  const a = createHeadSession({ root, purpose: "Parent" }), b = createHeadSession({ root, purpose: "Child" });
  host("shared-native").select({ root, sessionId: a.sessionId, expectedRevision: 0 });
  host("shared-native", "verified-child").select({ root, sessionId: b.sessionId, expectedRevision: 0 });
  assert.equal(host("shared-native").enter({ root }).workContext.sessionId, a.sessionId);
  assert.equal(host("shared-native", "verified-child").enter({ root }).workContext.sessionId, b.sessionId);
  const before = files(root).concat(files(operational));
  assert.deepEqual(sessionStartContext({ runtime: "codex", environment,
    event: { hook_event_name: "PostToolUse", session_id: "shared-native", cwd: root, tool_use_id: "child-call", tool_input: { session_id: b.sessionId } } }), {});
  assert.deepEqual(files(root).concat(files(operational)), before);
  const claudeRoot = host("claude-native", null, "claude"), claudeChild = host("claude-native", "claude-child", "claude");
  claudeRoot.select({ root, sessionId: a.sessionId, expectedRevision: 0 });
  claudeChild.select({ root, sessionId: b.sessionId, expectedRevision: 0 });
  const childOutput = sessionStartContext({ runtime: "claude", environment,
    event: { hook_event_name: "SessionStart", source: "resume", session_id: "claude-native", agent_id: "claude-child", cwd: root } });
  assert.equal(JSON.parse(childOutput.hookSpecificOutput.additionalContext).logicalSessionId, b.sessionId);
  assert.equal(claudeRoot.enter({ root }).workContext.sessionId, a.sessionId);
});

test("interrupted binding commit stays pending after restart; repair repeats persistence, not tool effects", async (t) => {
  const { root, host } = fixture(t), a = createHeadSession({ root, purpose: "A" }), b = createHeadSession({ root, purpose: "B" });
  const caller = host("interrupted");
  caller.select({ root, sessionId: a.sessionId, expectedRevision: 0 });
  const rename = fs.renameSync;
  let publications = 0;
  fs.renameSync = (source, target) => {
    if (target.endsWith("binding.json") && ++publications === 2) throw Object.assign(new Error("Injected final commit failure"), { code: "EIO" });
    return rename(source, target);
  };
  let failed;
  try { failed = caller.select({ root, sessionId: b.sessionId, expectedRevision: 1 }); }
  finally { fs.renameSync = rename; }
  assert.equal(failed.retained, false);
  assert.equal(host("interrupted").read({ root }).status, "pending");
  assert.equal(host("interrupted").enter({ root }).status, "session_selection_unresolved");
  const explicit = await call(root, "head_conversation_enter", { session_id: b.sessionId }, caller);
  assert.equal(explicit.result.structuredContent.workContext.sessionId, b.sessionId);
  assert.equal(host("interrupted").read({ root }).status, "pending", "Successful current request does not invent a completed registration.");
  const repaired = host("interrupted").select({ root, sessionId: b.sessionId, expectedRevision: 1 });
  assert.equal(repaired.retained, true);
  assert.equal(repaired.binding.revision, 2);
  assert.equal(host("interrupted").enter({ root }).workContext.sessionId, b.sessionId);
});

test("tampered/foreign binding never reaches default; explicit validated request survives resolver failure", async (t) => {
  const { root, host, operational } = fixture(t), a = createHeadSession({ root, purpose: "A" });
  const caller = host("tampered");
  caller.select({ root, sessionId: a.sessionId, expectedRevision: 0 });
  const bindingFile = files(operational).find(([file]) => file.endsWith("binding.json"))[0];
  const record = JSON.parse(fs.readFileSync(bindingFile, "utf8"));
  fs.writeFileSync(bindingFile, JSON.stringify({ ...record, projectId: "head-" + "0".repeat(20) }));
  assert.equal(caller.enter({ root }).status, "session_selection_unresolved");
  const explicit = await call(root, "head_conversation_enter", { session_id: a.sessionId }, caller);
  assert.equal(explicit.result.structuredContent.workContext.sessionId, a.sessionId);
  assert.equal(explicit.result._meta.headSessionBinding.persisted, false);
});

test("large startup direction/evidence is disclosed, bounded and never silently treated as empty", (t) => {
  const { root, host, environment } = fixture(t);
  host("large").select({ root, sessionId: "", expectedRevision: 0 });
  updateProjectDirection({ root, input: { goal: "Preserve current scope", constraints: ["x".repeat(12000)], cancelledActions: ["deploy"] } });
  recordSessionWorkEvidence({ root, input: { unknowns: ["u".repeat(10000)] } });
  const output = sessionStartContext({ runtime: "codex", environment,
    event: { hook_event_name: "SessionStart", source: "compact", session_id: "large", cwd: root } });
  assert.ok(output.hookSpecificOutput.additionalContext.length <= 7000);
  const context = JSON.parse(output.hookSpecificOutput.additionalContext);
  assert.equal(context.currentProjectDirection.contentIncluded, false);
  assert.match(context.requiredSourceExpansion, /no constraint or cancellation is assumed absent/i);
  assert.equal(context.omittedEvidenceIds.length, 1);
  assert.equal(context.persisted, false);
});

test("real hidden Node command consumes official-style startup stdin and exits; no live Hook activation", async (t) => {
  const { root, host, environment, operational } = fixture(t);
  const a = createHeadSession({ root, purpose: "Command caller" });
  host("command-native").select({ root, sessionId: a.sessionId, expectedRevision: 0 });
  withSessionRoute(root, a.sessionId, () => recordSessionWorkEvidence({ root, input: { summary: "Command reads original evidence" } }));
  const before = files(root).concat(files(operational));
  const event = { hook_event_name: "SessionStart", source: "compact", session_id: "command-native", cwd: root };
  const result = await localContinuityCommand([path.join(pluginRoot, "scripts/session-host-hook.mjs"), "--runtime", "codex"],
    { cwd: root, environment: { ...process.env, ...environment }, input: JSON.stringify(event) });
  assert.equal(result.code, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(JSON.parse(output.hookSpecificOutput.additionalContext).logicalSessionId, a.sessionId);
  const capability = JSON.parse(output.hookSpecificOutput.additionalContext).hostCapability;
  assert.match(capability, /verified Host\/explicit routing/i);
  assert.match(capability, /no extra bind\/save or repeated Session ID is required/i);
  assert.equal(output.continue, undefined);
  assert.equal(output.hookSpecificOutput.permissionDecision, undefined);
  assert.deepEqual(files(root).concat(files(operational)), before);
});

test("concurrent real local writers converge identical evidence and retain different Session work", async (t) => {
  const { root } = fixture(t), a = createHeadSession({ root, purpose: "A" }), b = createHeadSession({ root, purpose: "B" });
  const driver = path.join(pluginRoot, "test/helpers/session-work-driver.mjs");
  const results = await Promise.all([
    ...Array.from({ length: 3 }, () => localContinuityCommand([driver, root, a.sessionId, "Identical selected observation"], { cwd: root })),
    localContinuityCommand([driver, root, b.sessionId, "Different selected observation"], { cwd: root }),
  ]);
  results.forEach((result) => assert.equal(result.code, 0, result.stderr));
  const parsed = results.map((result) => JSON.parse(result.stdout));
  assert.equal(new Set(parsed.slice(0, 3).map((item) => item.evidenceId)).size, 1);
  assert.equal(parsed.slice(0, 3).reduce((sum, item) => sum + item.writes, 0), 1);
  assert.notEqual(parsed[3].evidenceId, parsed[0].evidenceId);
  assert.equal(withSessionRoute(root, a.sessionId, () => inspectProject(root).state.latestCheckpoint), null);
  assert.equal(withSessionRoute(root, b.sessionId, () => inspectProject(root).state.latestCheckpoint), null);
});
