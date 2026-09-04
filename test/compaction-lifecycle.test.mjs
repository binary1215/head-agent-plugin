import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeProject, inspectProject } from "../scripts/lib/head-core.mjs";
import { createRecoveryCheckpoint, inspectCompaction } from "../scripts/lib/compaction-recovery.mjs";
import {
  enterConversationRecovery,
  InMemoryCompactionLifecycleHostAdapter,
  processCompactionLifecycle,
} from "../scripts/lib/compaction-lifecycle.mjs";
import { formatCliResult } from "../scripts/lib/cli-presentation.mjs";
import { dispatch, tools as mcpTools } from "../scripts/mcp-server.mjs";
import { runCommand } from "../scripts/head.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");

function temporaryProject(prefix = "head-compaction-lifecycle-test-") {
  const parent = process.env.HEAD_AGENT_TEST_TMP || os.tmpdir();
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, prefix));
  initializeProject({ root, pluginRoot, runtimes: ["codex", "claude", "opencode"] });
  return root;
}

function direction(overrides = {}) {
  return {
    purpose: "Preserve the current whole outcome across provider compaction",
    approvedDecisions: ["P2 artifacts remain recovery authority"],
    currentPosition: "Automatic lifecycle recovery is being verified",
    nextExpectedResult: "Continue the original task without a user recovery ritual",
    openReviewIds: [],
    ...overrides,
  };
}

function checkpoint(root, overrides = {}) {
  return createRecoveryCheckpoint({ root, ...direction(overrides) }).checkpoint;
}

function event(root, kind, overrides = {}) {
  const inspected = inspectProject(root);
  return {
    eventId: `compaction-event-${kind}-${Math.random().toString(16).slice(2)}`,
    kind,
    projectId: inspected.project.projectId,
    sessionId: inspected.state.sessionId,
    runtime: "codex",
    userTurnId: 10,
    epochId: null,
    outcome: null,
    ...overrides,
  };
}

function enqueue(adapter, value) {
  adapter.enqueue(value);
  return adapter;
}

function projectFiles(root) {
  return fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
    .sort();
}

test("conversation entry restores current P2 direction automatically and otherwise creates no gate", (t) => {
  const root = temporaryProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const before = fs.readFileSync(path.join(root, ".head", "sessions", "current.json"));
  const filesBefore = projectFiles(root);
  const empty = enterConversationRecovery({ root });
  assert.equal(empty.status, "conversation_ready");
  assert.equal(empty.userDecisionRequired, false);
  assert.equal(empty.projectStatus.kind, "HeadProjectExperienceProjection");
  assert.equal(empty.attention.status, "clear");
  assert.equal(empty.ordinaryWorkBlocked, false);
  assert.deepEqual(fs.readFileSync(path.join(root, ".head", "sessions", "current.json")), before);
  assert.deepEqual(projectFiles(root), filesBefore);

  const canonical = checkpoint(root);
  const stateAfterCheckpoint = fs.readFileSync(path.join(root, ".head", "sessions", "current.json"));
  const restored = enterConversationRecovery({ root });
  assert.equal(restored.status, "conversation_direction_restored");
  assert.equal(restored.restore.checkpoint.checkpointId, canonical.checkpointId);
  assert.equal(restored.restore.projection.consumerInstruction.nextExpectedResult, canonical.nextExpectedResult);
  assert.equal(restored.restore.projection.providerBoundary.providerTranscriptUsed, false);
  assert.equal(restored.userDecisionRequired, false);
  assert.equal(Buffer.byteLength(JSON.stringify(restored), "utf8") < 64 * 1024, true);
  assert.deepEqual(fs.readFileSync(path.join(root, ".head", "sessions", "current.json")), stateAfterCheckpoint);
});

test("tampered recovery stops only checkpoint-dependent work and never guesses direction", (t) => {
  const root = temporaryProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const canonical = checkpoint(root);
  const file = path.join(root, ".head", "sessions", "ledger", `${canonical.checkpointId}.json`);
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  value.nextExpectedResult = "provider summary supplied direction";
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  const restored = enterConversationRecovery({ root });
  assert.equal(restored.status, "recovery_attention_required");
  assert.equal(restored.recoveryDependentWorkBlocked, true);
  assert.equal(restored.ordinaryWorkBlocked, false);
  assert.equal(restored.userDecisionRequired, false);
  assert.equal(restored.attention.headActionRequired, true);
  assert.equal(Object.hasOwn(restored, "restore"), false);
});

test("missing Host lifecycle hooks stay optional while artifact entry recovery remains available", (t) => {
  const root = temporaryProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  checkpoint(root);
  const result = processCompactionLifecycle({ root });
  assert.equal(result.status, "host_lifecycle_unavailable");
  assert.equal(result.conversationEntry.status, "conversation_direction_restored");
  assert.equal(result.ordinaryWorkBlocked, false);
  assert.equal(result.userDecisionRequired, false);
});

test("before-compaction reuses an exact current checkpoint and keeps the raw token Host-local", (t) => {
  const root = temporaryProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const canonical = checkpoint(root);
  const stateBefore = fs.readFileSync(path.join(root, ".head", "sessions", "current.json"));
  const adapter = enqueue(new InMemoryCompactionLifecycleHostAdapter(), event(root, "before-compaction"));
  const prepared = processCompactionLifecycle({ root, hostAdapter: adapter });
  assert.equal(prepared.status, "compaction_lifecycle_prepared");
  assert.equal(prepared.checkpointReused, true);
  assert.equal(prepared.checkpoint.checkpointId, canonical.checkpointId);
  assert.equal(prepared.continuationTokenDisclosed, false);
  assert.equal(Object.hasOwn(prepared, "continuationToken"), false);
  assert.equal(adapter.inspectHostState().retainedContinuationCount, 1);
  assert.match(formatCliResult("compaction-lifecycle-step", prepared), /User action: none/u);
  assert.doesNotMatch(formatCliResult("compaction-lifecycle-step", prepared), /could not verify/u);
  assert.deepEqual(fs.readFileSync(path.join(root, ".head", "sessions", "current.json")), stateBefore);
  const persisted = fs.readFileSync(path.join(root, ".head", "sessions", "compaction", "epochs", `${prepared.epoch.epochId}.json`), "utf8");
  const persistedEpoch = JSON.parse(persisted);
  assert.equal(persistedEpoch.providerSessionIdentityPersisted, false);
  assert.equal(Object.hasOwn(persistedEpoch, "providerSessionId"), false);
  assert.equal(Object.hasOwn(persistedEpoch, "continuationToken"), false);
});

test("HEAD authors missing recovery direction internally instead of asking the user for lifecycle JSON", (t) => {
  const root = temporaryProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const adapter = enqueue(new InMemoryCompactionLifecycleHostAdapter(), event(root, "before-compaction"));
  const needsHead = processCompactionLifecycle({ root, hostAdapter: adapter });
  assert.equal(needsHead.status, "head_direction_required");
  assert.equal(needsHead.headActionRequired, true);
  assert.equal(needsHead.userDecisionRequired, false);
  assert.equal(needsHead.ordinaryWorkBlocked, false);
  const prepared = processCompactionLifecycle({ root, hostAdapter: adapter, direction: direction() });
  assert.equal(prepared.status, "compaction_lifecycle_prepared");
  assert.equal(prepared.checkpointReused, false);
});

test("successful after-compaction restores P2 first, consumes once, and duplicate delivery converges", (t) => {
  const root = temporaryProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  checkpoint(root);
  const adapter = enqueue(new InMemoryCompactionLifecycleHostAdapter(), event(root, "before-compaction"));
  const prepared = processCompactionLifecycle({ root, hostAdapter: adapter });
  const after = event(root, "after-compaction", { epochId: prepared.epoch.epochId, outcome: "succeeded" });
  adapter.enqueue(after);
  const continued = processCompactionLifecycle({ root, hostAdapter: adapter });
  assert.equal(continued.status, "compaction_lifecycle_continued");
  assert.equal(continued.conversationEntry.status, "conversation_direction_restored");
  assert.equal(continued.continuationConsumed, true);
  assert.equal(inspectCompaction({ root }).epoch.state, "continued");

  adapter.enqueue({ ...after, eventId: `${after.eventId}-duplicate` });
  const duplicate = processCompactionLifecycle({ root, hostAdapter: adapter });
  assert.equal(duplicate.status, "compaction_lifecycle_already_continued");
  assert.equal(duplicate.continuationConsumed, true);

  adapter.enqueue({ ...after, eventId: `${after.eventId}-divergent`, outcome: "failed" });
  assert.throws(() => processCompactionLifecycle({ root, hostAdapter: adapter }), { code: "COMPACTION_LIFECYCLE_DIVERGENT_OUTCOME" });
});

test("uncertain, failed, and newer-turn outcomes never replay or silently continue", (t) => {
  const roots = [temporaryProject(), temporaryProject(), temporaryProject()];
  t.after(() => roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })));
  for (const root of roots) checkpoint(root);

  const uncertainHost = enqueue(new InMemoryCompactionLifecycleHostAdapter(), event(roots[0], "before-compaction"));
  const uncertainPrepared = processCompactionLifecycle({ root: roots[0], hostAdapter: uncertainHost });
  uncertainHost.enqueue(event(roots[0], "after-compaction", { epochId: uncertainPrepared.epoch.epochId, outcome: "uncertain" }));
  const uncertain = processCompactionLifecycle({ root: roots[0], hostAdapter: uncertainHost });
  assert.equal(uncertain.status, "provider_compaction_outcome_uncertain");
  assert.equal(uncertain.retryAllowed, false);
  assert.equal(uncertain.continuationConsumed, false);
  assert.equal(inspectCompaction({ root: roots[0] }).epoch.state, "prepared");

  const failedHost = enqueue(new InMemoryCompactionLifecycleHostAdapter(), event(roots[1], "before-compaction"));
  const failedPrepared = processCompactionLifecycle({ root: roots[1], hostAdapter: failedHost });
  failedHost.enqueue(event(roots[1], "after-compaction", { epochId: failedPrepared.epoch.epochId, outcome: "failed" }));
  const failed = processCompactionLifecycle({ root: roots[1], hostAdapter: failedHost });
  assert.equal(failed.status, "provider_compaction_failed");
  assert.equal(inspectCompaction({ root: roots[1] }).epoch.state, "aborted");

  const newerHost = enqueue(new InMemoryCompactionLifecycleHostAdapter(), event(roots[2], "before-compaction"));
  const newerPrepared = processCompactionLifecycle({ root: roots[2], hostAdapter: newerHost });
  newerHost.enqueue(event(roots[2], "after-compaction", { epochId: newerPrepared.epoch.epochId, outcome: "succeeded", userTurnId: 11 }));
  const newer = processCompactionLifecycle({ root: roots[2], hostAdapter: newerHost });
  assert.equal(newer.status, "compaction_lifecycle_superseded");
  assert.equal(newer.continuationConsumed, false);
  assert.equal(inspectCompaction({ root: roots[2] }).epoch.state, "superseded");
});

test("Host token retention and loss fail safely while verified P2 remains usable", (t) => {
  const roots = [temporaryProject(), temporaryProject()];
  t.after(() => roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })));
  for (const root of roots) checkpoint(root);

  class UncertainRetentionHost extends InMemoryCompactionLifecycleHostAdapter {
    retainContinuation() { return { status: "uncertain" }; }
  }
  const retentionHost = enqueue(new UncertainRetentionHost(), event(roots[0], "before-compaction"));
  const retention = processCompactionLifecycle({ root: roots[0], hostAdapter: retentionHost });
  assert.equal(retention.status, "recovery_attention_required");
  assert.equal(retention.reasonCode, "COMPACTION_HOST_RETENTION_UNCERTAIN");
  assert.equal(retention.userDecisionRequired, false);
  assert.equal(inspectCompaction({ root: roots[0] }).epoch.state, "aborted");
  assert.equal(enterConversationRecovery({ root: roots[0] }).status, "conversation_direction_restored");

  class MissingTokenHost extends InMemoryCompactionLifecycleHostAdapter {
    loadContinuation() { return { status: "unavailable" }; }
  }
  const missingHost = enqueue(new MissingTokenHost(), event(roots[1], "before-compaction"));
  const prepared = processCompactionLifecycle({ root: roots[1], hostAdapter: missingHost });
  missingHost.enqueue(event(roots[1], "after-compaction", { epochId: prepared.epoch.epochId, outcome: "succeeded" }));
  const missing = processCompactionLifecycle({ root: roots[1], hostAdapter: missingHost });
  assert.equal(missing.status, "conversation_direction_restored_without_transport_continuation");
  assert.equal(missing.conversationEntry.status, "conversation_direction_restored");
  assert.equal(missing.freshLogicalHeadRequired, true);
  assert.equal(missing.userDecisionRequired, false);
  assert.equal(inspectCompaction({ root: roots[1] }).epoch.state, "aborted");
});

test("conversation-entry and provider replacement restore artifacts and supersede stale transport only", (t) => {
  const root = temporaryProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  checkpoint(root);
  const adapter = enqueue(new InMemoryCompactionLifecycleHostAdapter(), event(root, "before-compaction"));
  const prepared = processCompactionLifecycle({ root, hostAdapter: adapter });
  adapter.enqueue(event(root, "provider-replaced", { userTurnId: 11 }));
  const replacement = processCompactionLifecycle({ root, hostAdapter: adapter });
  assert.equal(replacement.status, "conversation_direction_restored");
  assert.equal(replacement.pendingContinuationSuperseded, true);
  assert.equal(replacement.conversationEntry.restore.checkpoint.checkpointId, prepared.checkpoint.checkpointId);
  assert.equal(inspectCompaction({ root }).epoch.state, "superseded");
});

test("cross-project events and authority-amplifying Host descriptors fail closed", (t) => {
  const root = temporaryProject();
  const other = temporaryProject();
  t.after(() => [root, other].forEach((item) => fs.rmSync(item, { recursive: true, force: true })));
  const cross = enqueue(new InMemoryCompactionLifecycleHostAdapter(), event(other, "conversation-entry"));
  assert.throws(() => processCompactionLifecycle({ root, hostAdapter: cross }), { code: "COMPACTION_LIFECYCLE_PROJECT_MISMATCH" });

  const base = new InMemoryCompactionLifecycleHostAdapter();
  const bad = {
    describe: () => ({ ...base.describe(), recoveryAuthority: true }),
    nextEvent: (...args) => base.nextEvent(...args),
    retainContinuation: (...args) => base.retainContinuation(...args),
    loadContinuation: (...args) => base.loadContinuation(...args),
    acknowledge: (...args) => base.acknowledge(...args),
  };
  assert.throws(() => processCompactionLifecycle({ root, hostAdapter: bad }), { code: "COMPACTION_LIFECYCLE_AUTHORITY_VIOLATION" });
});

test("MCP and CLI expose the same Core behavior without making recovery a user ritual", async (t) => {
  const root = temporaryProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  checkpoint(root);
  assert.equal(mcpTools.some((tool) => tool.name === "head_conversation_enter"), true);
  assert.equal(mcpTools.some((tool) => tool.name === "head_compaction_lifecycle_step"), true);
  assert.equal(runCommand(["help"]).commands.some((command) => command.includes("conversation-enter")), false);
  assert.equal(runCommand(["help-all"]).commands.some((command) => command.includes("conversation-enter")), true);
  assert.equal(runCommand(["conversation-enter", root]).status, "conversation_direction_restored");
  assert.equal(runCommand(["compaction-lifecycle-step", root]).status, "host_lifecycle_unavailable");

  const mcp = await dispatch({
    jsonrpc: "2.0",
    id: 901,
    method: "tools/call",
    params: { name: "head_conversation_enter", arguments: { project_root: root } },
  });
  assert.equal(mcp.result.structuredContent.status, "conversation_direction_restored");
  assert.match(mcp.result.content[0].text, /continue the task/u);
  assert.doesNotMatch(mcp.result.content[0].text, /checkpoint-[a-f0-9]{24}/u);
  const cli = formatCliResult("conversation-enter", runCommand(["conversation-enter", root]));
  assert.match(cli, /continue the task/u);
  assert.doesNotMatch(cli, /checkpoint-[a-f0-9]{24}/u);
});
