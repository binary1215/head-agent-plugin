import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeProject } from "../scripts/lib/lode-core.mjs";
import { createNativeObservationStore } from "../scripts/lib/native-session-observations.mjs";
import { appendUserPromptReference, captureUserPrompt, freezeUserPromptReference, takeUserPromptReference, USER_PROMPT_REFERENCE_LIMITS } from "../scripts/lib/user-prompt-reference.mjs";
import { runSessionHostHook } from "../scripts/session-host-hook.mjs";
import plugin from "../scripts/opencode-plugin.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const tree = root => fs.existsSync(root) ? fs.readdirSync(root, { recursive: true }).sort() : [];

function fixture(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lode-prompt-reference-")));
  const root = path.join(base, "project");
  fs.mkdirSync(root);
  initializeProject({ root, pluginRoot, runtimes: ["claude", "codex", "opencode"] });
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const environment = { HEAD_AGENT_OPERATIONAL_STATE_ROOT: path.join(base, "operational") };
  return { base, root, environment };
}

const start = (root, runtime, source, sessionId) => ({
  hook_event_name: "SessionStart", source, cwd: root, session_id: sessionId,
});

test("prompt reference is redacted, bounded, and omitted when it does not fit", t => {
  const { root, environment } = fixture(t);
  const secret = [
    "-----BEGIN PRIVATE KEY-----\nsecret-key-body\n-----END PRIVATE KEY-----",
    "sk-abcdefghijklmnopqrstuvwxyz",
    "ghp_abcdefghijklmnopqrstuvwxyz",
    "github_pat_abcdefghijklmnopqrstuvwxyz",
    "AKIAABCDEFGHIJKLMNOP",
    "Bearer abcdefghijklmnop",
    "xoxb-abcdefghijklmnopqrstuvwxyz",
  ].join(" ");
  captureUserPrompt({ root, runtime: "claude", nativeSessionId: "redacted-session", text: secret, environment });
  freezeUserPromptReference({ root, runtime: "claude", nativeSessionId: "redacted-session", environment });
  const redacted = takeUserPromptReference({ root, runtime: "claude", nativeSessionId: "redacted-session", environment });
  assert.equal(redacted.includes("secret-key-body"), false);
  assert.equal(redacted.includes("sk-abcdefghijklmnopqrstuvwxyz"), false);
  assert.equal(redacted.includes("ghp_abcdefghijklmnopqrstuvwxyz"), false);
  assert.equal(redacted.includes("github_pat_abcdefghijklmnopqrstuvwxyz"), false);
  assert.equal(redacted.includes("AKIAABCDEFGHIJKLMNOP"), false);
  assert.equal(redacted.includes("abcdefghijklmnop"), false);
  assert.equal(redacted.includes("[redacted-private-key]"), true);
  assert.equal(redacted.includes("[redacted-token]"), true);
  assert.equal(appendUserPromptReference("base", "1. later", 8), "base");
  assert.equal(USER_PROMPT_REFERENCE_LIMITS.prompts, 3);
  assert.equal(USER_PROMPT_REFERENCE_LIMITS.characters, 2000);
  assert.equal(USER_PROMPT_REFERENCE_LIMITS.bytes, 16 * 1024);
});

test("Claude and Codex restore the frozen prompt after compact or clear and not on startup", async t => {
  const { root, environment } = fixture(t);
  const canon = () => tree(path.join(root, ".lode"));
  for (const runtime of ["claude", "codex"]) {
    const sessionId = runtime + "-session";
    const before = canon();
    const prompt = "restore " + runtime + " prompt sk-abcdefghijklmnopqrstuvwxyz";
    assert.deepEqual(await runSessionHostHook({
      runtime, environment, observeOnly: true,
      event: { hook_event_name: "UserPromptSubmit", cwd: root, session_id: sessionId, prompt_id: "p1", turn_id: "p1", prompt },
    }), {});
    assert.deepEqual(await runSessionHostHook({
      runtime, environment, observeOnly: true,
      event: { hook_event_name: "Stop", cwd: root, session_id: sessionId, prompt_id: "p1", turn_id: "p1", last_assistant_message: "SECRET" },
    }), {});
    const snapshot = createNativeObservationStore({ environment }).read({
      root, caller: { runtime, nativeSessionId: sessionId, agentId: null },
    });
    assert.equal(JSON.stringify(snapshot).includes(prompt), false);
    assert.equal(JSON.stringify(snapshot).includes("SECRET"), false);
    assert.deepEqual(await runSessionHostHook({
      runtime, environment, observeOnly: true,
      event: { hook_event_name: "PreCompact", cwd: root, session_id: sessionId, trigger: "auto", turn_id: "p1" },
    }), {});
    await runSessionHostHook({
      runtime, environment, observeOnly: true,
      event: { hook_event_name: "UserPromptSubmit", cwd: root, session_id: sessionId, prompt_id: "p2", turn_id: "p2", prompt: "replacement after freeze" },
    });
    const startup = await runSessionHostHook({ runtime, environment, event: start(root, runtime, "startup", sessionId) });
    assert.equal(startup.hookSpecificOutput.additionalContext.includes("restore " + runtime), false);
    const compact = await runSessionHostHook({ runtime, environment, event: start(root, runtime, "compact", sessionId) });
    const text = compact.hookSpecificOutput.additionalContext;
    assert.equal(text.includes("non-authoritative"), true);
    assert.equal(text.includes("restore " + runtime + " prompt"), true);
    assert.equal(text.includes("sk-abcdefghijklmnopqrstuvwxyz"), false);
    assert.equal(text.includes("[redacted-token]"), true);
    assert.equal(text.includes("replacement after freeze"), false);
    assert.equal(text.includes("SECRET"), false);
    assert.ok(text.length <= (runtime === "claude" ? 10000 : 32768));
    const again = await runSessionHostHook({ runtime, environment, event: start(root, runtime, "compact", sessionId) });
    assert.equal(again.hookSpecificOutput.additionalContext.includes("restore " + runtime), false);
    await runSessionHostHook({
      runtime, environment, observeOnly: true,
      event: { hook_event_name: "UserPromptSubmit", cwd: root, session_id: sessionId, prompt_id: "p3", turn_id: "p3", prompt: "after clear " + runtime },
    });
    const cleared = await runSessionHostHook({ runtime, environment, event: start(root, runtime, "clear", sessionId) });
    assert.equal(cleared.hookSpecificOutput.additionalContext.includes("after clear " + runtime), true);
    assert.deepEqual(canon(), before);
  }
  const claude = JSON.parse(fs.readFileSync(path.join(pluginRoot, "hooks/claude.json"), "utf8"));
  const codex = JSON.parse(fs.readFileSync(path.join(pluginRoot, "hooks/codex.json"), "utf8"));
  assert.equal(claude.hooks.PreCompact[0].matcher, "manual|auto");
  assert.equal(codex.hooks.PreCompact[0].matcher, "manual|auto");
  assert.ok(claude.hooks.PreCompact[0].hooks[0].command.endsWith("--runtime claude --observe-only"));
  assert.ok(codex.hooks.PreCompact[0].hooks[0].command.endsWith("--runtime codex --observe-only"));
});

test("capture keeps three bounded prompts and drops a frozen replacement", t => {
  const { root, environment } = fixture(t);
  for (const text of ["one", "two", "three", "x".repeat(2500)]) {
    captureUserPrompt({ root, runtime: "opencode", nativeSessionId: "ses_bounds", text, environment });
  }
  const file = fs.readdirSync(path.join(environment.HEAD_AGENT_OPERATIONAL_STATE_ROOT, "user-prompt-reference"))[0];
  const state = JSON.parse(fs.readFileSync(path.join(environment.HEAD_AGENT_OPERATIONAL_STATE_ROOT, "user-prompt-reference", file), "utf8"));
  assert.deepEqual(state.prompts.map(prompt => prompt.text.slice(0, 3)), ["two", "thr", "xxx"]);
  assert.equal(state.prompts.at(-1).text.length, 2000);
  assert.ok(Buffer.byteLength(JSON.stringify(state)) <= USER_PROMPT_REFERENCE_LIMITS.bytes);
});

test("OpenCode reinjects once after compaction or clear and ignores synthetic parts", async t => {
  const { root, environment } = fixture(t);
  const sessionID = "ses_prompt";
  const canon = tree(path.join(root, ".lode"));
  const client = { session: {
    async get() { return { data: { id: sessionID, projectID: "host-project", directory: root } }; },
    async status() { return { data: {} }; },
  } };
  const hooks = await plugin.server({ client, project: { id: "host-project" }, directory: root }, { environment });
  t.after(() => hooks.dispose());
  await hooks.event({ event: { id: "user-message", type: "message.updated", properties: { info: { id: "msg_user", sessionID, role: "user" } } } });
  await hooks.event({ event: { id: "assistant-message", type: "message.updated", properties: { info: { id: "msg_assistant", sessionID, role: "assistant" } } } });
  await hooks.event({ event: { id: "user-part", type: "message.part.updated", properties: { part: {
    id: "part-user", sessionID, messageID: "msg_user", type: "text", text: "keep the opencode prompt",
  } } } });
  await hooks.event({ event: { id: "synthetic-part", type: "message.part.updated", properties: { part: {
    id: "part-synthetic", sessionID, messageID: "msg_user", type: "text", text: "synthetic secret", synthetic: true,
  } } } });
  await hooks.event({ event: { id: "assistant-part", type: "message.part.updated", properties: { part: {
    id: "part-assistant", sessionID, messageID: "msg_assistant", type: "text", text: "assistant secret",
  } } } });
  const ordinary = { system: [] };
  await hooks["experimental.chat.system.transform"]({ sessionID }, ordinary);
  assert.equal(ordinary.system.some(text => text.includes("keep the opencode prompt")), false);
  const compaction = { context: ["host context"], prompt: undefined };
  await hooks["experimental.session.compacting"]({ sessionID }, compaction);
  assert.deepEqual(compaction, { context: ["host context"], prompt: undefined });
  await hooks.event({ event: { id: "later-part", type: "message.part.updated", properties: { part: {
    id: "part-later", sessionID, messageID: "msg_user", type: "text", text: "replacement after freeze",
  } } } });
  await hooks.event({ event: { id: "compacted", type: "session.compacted", properties: { sessionID } } });
  const restored = { system: [] };
  await hooks["experimental.chat.system.transform"]({ sessionID }, restored);
  const combined = restored.system.join("\n");
  assert.equal(combined.includes("keep the opencode prompt"), true);
  assert.equal(combined.includes("non-authoritative"), true);
  assert.equal(combined.includes("synthetic secret"), false);
  assert.equal(combined.includes("assistant secret"), false);
  assert.equal(combined.includes("replacement after freeze"), false);
  const repeated = { system: [] };
  await hooks["experimental.chat.system.transform"]({ sessionID }, repeated);
  assert.equal(repeated.system.some(text => text.includes("keep the opencode prompt")), false);
  await hooks.event({ event: { id: "clear-message", type: "message.updated", properties: { info: { id: "msg_clear", sessionID, role: "user" } } } });
  await hooks.event({ event: { id: "clear-part", type: "message.part.updated", properties: { part: {
    id: "part-clear", sessionID, messageID: "msg_clear", type: "text", text: "after opencode clear",
  } } } });
  await hooks["command.executed"]({ name: "clear", sessionID, arguments: "" });
  const cleared = { system: [] };
  await hooks["experimental.chat.system.transform"]({ sessionID }, cleared);
  assert.equal(cleared.system.join("\n").includes("after opencode clear"), true);
  assert.deepEqual(tree(path.join(root, ".lode")), canon);
});
