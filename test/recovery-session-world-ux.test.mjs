import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeProject, inspectProject } from "../scripts/lib/head-core.mjs";
import { compileContext } from "../scripts/lib/context-compiler.mjs";
import { createWholePlanSnapshot, createExecutionContract } from "../scripts/lib/execution-lineage.mjs";
import { startRun, finishRun, reviewRun, getPendingReviewContext } from "../scripts/lib/run-lineage.mjs";
import { createRecoveryCheckpoint, prepareCompaction, verifyCompaction, continueCompaction } from "../scripts/lib/compaction-recovery.mjs";
import { restoreSessionFromArtifacts } from "../scripts/lib/session-recovery.mjs";
import { createHeadSession, createSessionCallContext, withSessionCallContext, withSessionRoute } from "../scripts/lib/session-routing.mjs";
import { updateProjectDirection } from "../scripts/lib/project-direction.mjs";
import { dispatch } from "../scripts/mcp-server.mjs";
import { runCommand } from "../scripts/head.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const direction = { purpose: "Preserve the task", currentPosition: "Before bounded work", nextExpectedResult: "Historical step, not a new execution authorization" };
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "head-recovery-v2-")));
  initializeProject({ root, pluginRoot, runtimes: ["codex"] });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function contract(root) {
  const capsule = compileContext({ root, task: "Inspect a synthetic local library", persist: true }).capsule;
  const plan = createWholePlanSnapshot({ root, objective: "Inspect a synthetic local library", plan: [{ id: "inspect", outcome: "Bounded evidence" }], invariants: ["No external effects"] }).artifact;
  return createExecutionContract({ root, wholePlanId: plan.wholePlanId, capsuleId: capsule.capsuleId, scope: "Local evidence", acceptanceCriteria: ["Exact result"] }).artifact;
}
function bytes(root) {
  const entries = [];
  const walk = (dir) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.isFile()) entries.push([path.relative(root, file), crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")]);
  } };
  walk(root);
  return entries.sort((a, b) => a[0].localeCompare(b[0]));
}
const call = (root, name, args = {}, options = {}) => dispatch({ jsonrpc: "2.0", id: "local-fixture", method: "tools/call", params: { name, arguments: { project_root: root, ...args } } }, options);

test("checkpoint/start/finish/review restore current facts without rewriting meaning or replaying historical actions", async (t) => {
  const root = fixture(t), c = contract(root);
  const checkpoint = createRecoveryCheckpoint({ root, ...direction }).checkpoint;
  const ledger = path.join(root, ".head", "sessions", "ledger", `${checkpoint.checkpointId}.json`);
  const checkpointBytes = fs.readFileSync(ledger);
  const trace = [];
  trace.push("start");
  const started = await call(root, "head_run_start", { execution_contract_id: c.executionContractId, start_request_id: "logical-request-one" });
  assert.equal(started.result.structuredContent.status, "run_started");
  const active = restoreSessionFromArtifacts({ root });
  assert.equal(active.projection.currentExecution.activeRun.runId, started.result.structuredContent.run.runId);
  assert.equal(active.projection.checkpointMatchesCurrentExecution, false);
  assert.equal(active.projection.consumerInstruction.nextExpectedResult, undefined);
  assert.equal(active.projection.consumerInstruction.historicalCheckpointContext.nextExpectedResult, direction.nextExpectedResult);
  trace.push("finish");
  finishRun({ root, outcome: "Local evidence returned", evidence: [{ uri: "synthetic", digest: "evidence" }], verification: [{ check: "read", status: "passed" }] });
  trace.push("pending-review");
  const review = getPendingReviewContext({ root });
  trace.push("review");
  reviewRun({ root, reviewContextId: review.review.reviewContextId, disposition: "accept", rationale: "Bounded evidence inspected" });
  updateProjectDirection({ root, input: { goal: "Preserve the task", cancelledActions: ["deploy"], constraints: ["Local only"], decisions: [] } });
  const beforeEntry = bytes(root);
  trace.push("entry");
  const entry = (await call(root, "head_conversation_enter")).result.structuredContent;
  assert.equal(entry.ordinaryWorkBlocked, false);
  assert.equal(entry.restore.projection.currentExecution.sessionPointer.mode, "session");
  assert.equal(entry.restore.projection.lastReviewDecision.disposition, "accept");
  assert.deepEqual(entry.restore.projection.currentProjectDirection.input.cancelledActions, ["deploy"]);
  assert.deepEqual(bytes(root), beforeEntry);
  assert.deepEqual(fs.readFileSync(ledger), checkpointBytes);
  assert.deepEqual(trace, ["start", "finish", "pending-review", "review", "entry"]);
  const retry = await call(root, "head_run_start", { execution_contract_id: c.executionContractId, start_request_id: "logical-request-one" });
  assert.equal(retry.result.structuredContent.status, "run_start_already_committed");
  assert.equal(retry.result.structuredContent.executionReplayAllowed, false);
  assert.deepEqual(bytes(root), beforeEntry);
});

test("trusted caller contexts preserve A/B, sharing, explicit default and known loss without global selectors", async (t) => {
  const root = fixture(t), original = inspectProject(root).state.sessionId;
  const a = createHeadSession({ root, purpose: "A" }), b = createHeadSession({ root, purpose: "B" });
  const first = createSessionCallContext(), second = createSessionCallContext();
  const selected = await Promise.all([
    call(root, "head_project_status", { session_id: a.sessionId }, { sessionContext: first }),
    call(root, "head_project_status", { session_id: b.sessionId }, { sessionContext: second }),
  ]);
  assert.equal(selected[0].result.structuredContent.project.sessionId, a.sessionId);
  assert.equal(selected[1].result.structuredContent.project.sessionId, b.sessionId);
  assert.equal((await call(root, "head_project_status", {}, { sessionContext: first })).result.structuredContent.project.sessionId, a.sessionId);
  second.select(root, a.sessionId);
  assert.equal((await call(root, "head_project_status", {}, { sessionContext: second })).result.structuredContent.project.sessionId, a.sessionId);
  assert.equal(inspectProject(root).state.sessionId, original);
  first.lose(root);
  const before = bytes(root);
  for (const name of ["head_project_status", "head_session_restore", "head_conversation_enter", "head_run_start",
    "head_compact_prepare", "head_compact_verify", "head_compact_continue", "head_compact_status", "head_compact_abort", "head_continuity_snapshot"]) {
    const unresolved = (await call(root, name, {}, { sessionContext: first })).result.structuredContent;
    assert.equal(unresolved.status, "session_selection_unresolved");
    assert.equal(unresolved.sessionId, null);
    assert.equal(unresolved.ordinaryWorkBlocked, false);
    assert.equal(unresolved.userDecisionRequired, false);
  }
  const independent = await call(root, "head_project_direction_read", {}, { sessionContext: first });
  assert.equal(independent.error, undefined);
  const brokenResolver = () => { throw Object.assign(new Error("Host binding unavailable"), { code: "HEAD_SESSION_CONTEXT_UNAVAILABLE" }); };
  assert.equal((await call(root, "head_project_status", {}, { resolveSessionContext: brokenResolver })).result.structuredContent.sessionId, null);
  const routed = await dispatch({ jsonrpc: "2.0", id: "wrapped-status", method: "tools/call", params: {
    name: "head_tools_read", arguments: { name: "head_compact_status", arguments: { project_root: root } },
  } }, { sessionContext: first });
  assert.equal(routed.result.structuredContent.status, "session_selection_unresolved");
  assert.equal((await call(root, "head_project_direction_read", {}, { resolveSessionContext: brokenResolver })).error, undefined);
  assert.deepEqual(bytes(root), before);
  const defaultAgain = await call(root, "head_project_status", { session_id: "" }, { sessionContext: first });
  assert.equal(defaultAgain.result.structuredContent.project.sessionId, original);
  assert.equal(first.read(root).status, "default");
  assert.throws(() => withSessionCallContext({ root, context: { read() { return { sessionId: a.sessionId }; } } }, () => {}), { code: "INVALID_HEAD_SESSION_CALL_CONTEXT" });
  assert.throws(() => first.select(root, b.sessionId, 0), { code: "HEAD_SESSION_BINDING_CONFLICT" });
});

test("CLI context and explicit routes agree; no checkpoint and unsupported binding remain nonblocking", (t) => {
  const root = fixture(t), a = createHeadSession({ root, purpose: "A" }), context = createSessionCallContext();
  const initial = runCommand(["conversation-enter", root]);
  assert.equal(initial.recoveryState, "no-current-checkpoint");
  assert.equal(initial.ordinaryWorkBlocked, false);
  runCommand(["status", root, "--session", a.sessionId], { sessionContext: context });
  assert.equal(runCommand(["status", root], { sessionContext: context }).project.sessionId, a.sessionId);
  context.lose(root);
  assert.equal(runCommand(["status", root], { sessionContext: context }).sessionId, null);
  assert.equal(runCommand(["project-direction-read", root], { sessionContext: context }), null);
  assert.equal(withSessionRoute(root, a.sessionId, () => inspectProject(root).state.sessionId), a.sessionId);
});

test("explicit MCP routing survives unavailable Host persistence without guessing or changing another caller", async (t) => {
  const root = fixture(t), a = createHeadSession({ root, purpose: "Explicit route" }), b = createHeadSession({ root, purpose: "Other caller" });
  withSessionRoute(root, a.sessionId, () => createRecoveryCheckpoint({ root, ...direction }));
  const other = createSessionCallContext(); other.select(root, b.sessionId);
  const otherBefore = other.read(root), before = bytes(root);
  const unavailable = { resolveSessionContext: async () => { throw Object.assign(new Error("Synthetic Host persistence unavailable"), { code: "SYNTHETIC_BINDING_UNAVAILABLE" }); } };
  const reference = await call(root, "head_session_restore", { session_id: a.sessionId });
  for (const route of [null, "head_tools_read", "head_tools_call"]) {
    const request = { jsonrpc: "2.0", id: "explicit-route", method: "tools/call", params: route
      ? { name: route, arguments: { name: "head_session_restore", arguments: { project_root: root, session_id: a.sessionId } } }
      : { name: "head_session_restore", arguments: { project_root: root, session_id: a.sessionId } } };
    const restored = await dispatch(request, unavailable);
    assert.deepEqual(restored.result.structuredContent, reference.result.structuredContent);
    assert.equal(restored.result.structuredContent.projection.sessionId, a.sessionId);
    assert.deepEqual(restored.result.content, reference.result.content, "Host metadata must not replace the existing MCP presentation");
    assert.deepEqual(restored.result._meta.headSessionBinding, { status: "unavailable", reasonCode: "SYNTHETIC_BINDING_UNAVAILABLE", scope: "current-explicit-request-only", retainedForSubsequentCalls: false, persisted: false });
  }
  assert.equal((await call(root, "head_session_restore", {}, unavailable)).result.structuredContent.status, "session_selection_unresolved");
  const foreign = createHeadSession({ root: fixture(t), purpose: "Foreign owner" });
  for (const session_id of ["not-a-session", foreign.sessionId, null, undefined, 42]) {
    const rejected = await call(root, "head_session_restore", { session_id }, unavailable);
    assert(rejected.error, "resolver failure must not bypass explicit identity verification");
    assert.equal(rejected.result, undefined);
  }
  const explicitDefault = await call(root, "head_project_status", { session_id: "" }, unavailable);
  assert.equal(explicitDefault.result.structuredContent.project.sessionId, inspectProject(root).state.sessionId);
  const selectedFile = path.join(root, ".head/sessions/by-id", a.sessionId, "current.json"), selectedBytes = fs.readFileSync(selectedFile);
  try {
    const state = JSON.parse(selectedBytes); state.projectId = "head-foreign";
    fs.writeFileSync(selectedFile, JSON.stringify(state));
    assert((await call(root, "head_session_restore", { session_id: a.sessionId }, unavailable)).error);
  } finally { fs.writeFileSync(selectedFile, selectedBytes); }
  assert.deepEqual(other.read(root), otherBefore);
  assert.deepEqual(bytes(root), before);
});

test("lost caller binding never gates CLI information or Project evidence but still guards selected Session facts", async (t) => {
  const root = fixture(t), selected = createHeadSession({ root, purpose: "Lost caller" }), context = createSessionCallContext();
  fs.writeFileSync(path.join(root, "independent.mjs"), "export const observed = true;\n");
  context.select(root, selected.sessionId); context.lose(root);
  const before = bytes(root), binding = context.read(root);
  for (const name of ["version", "--version", "help", "--help", "-h", "help-all", "observation-sources", "observation-query", "session-list", "project-direction-read"]) {
    assert.deepEqual(await runCommand([name, root], { sessionContext: context }), await runCommand([name, root]));
  }
  assert.deepEqual(runCommand(["version"], { sessionContext: context }), runCommand(["version"]), "global information requires no initialized Project");
  const source = await runCommand(["source-context", root, "--task", "Inspect local source", "--source", "independent.mjs", "--kind", "source"], { sessionContext: context });
  assert.equal(source.status, "observed");
  assert.equal(source.context.capsule.sessionId, undefined, "Project-only evidence must not claim the default is the selected Session");
  for (const name of ["status", "doctor", "session-restore", "session-continue", "run-start", "run-finish", "run-review", "compact-status", "checkpoint-basis", "world-status", "product-operating-status"]) {
    const unresolved = await runCommand([name, root], { sessionContext: context });
    assert.equal(unresolved.status, "session_selection_unresolved", name);
    assert.equal(unresolved.sessionId, null);
    assert.equal(unresolved.userDecisionRequired, false);
  }
  assert.equal((await call(root, "head_observation_sources", {}, { sessionContext: context })).result.structuredContent.status, "available");
  assert.equal((await call(root, "head_product_operating_status", {}, { sessionContext: context })).result.structuredContent.status, "session_selection_unresolved");
  assert.deepEqual(context.read(root), binding);
  assert.deepEqual(bytes(root), before);
});

test("general meaning recovery cannot relax exact one-shot targets or consumed tokens", (t) => {
  const badRoot = fixture(t);
  const invalid = prepareCompaction({ root: badRoot, runtime: "codex", userTurnIdAtPrepare: 7, ...direction });
  assert.throws(() => verifyCompaction({ root: badRoot, epochId: invalid.epoch.epochId, checkpointDigest: "0".repeat(64), currentUserTurnId: 7, providerCompacted: true }));
  const root = fixture(t);
  const prepared = prepareCompaction({ root, runtime: "codex", userTurnIdAtPrepare: 7, ...direction });
  const epochId = prepared.epoch.epochId, checkpointDigest = prepared.checkpoint.checkpointDigest;
  verifyCompaction({ root, epochId, checkpointDigest, currentUserTurnId: 7, providerCompacted: true });
  const token = prepared.continuationToken;
  assert.ok(token);
  continueCompaction({ root, epochId, continuationToken: token, currentUserTurnId: 7 });
  assert.throws(() => continueCompaction({ root, epochId, continuationToken: token, currentUserTurnId: 7 }));
  assert.equal(restoreSessionFromArtifacts({ root }).projection.consumerInstruction.nextExpectedResult, undefined);
});

test("operational lock cleanup failure after commit never changes the original retry target", (t) => {
  const root = fixture(t), c = contract(root), unlink = fs.unlinkSync;
  let result;
  fs.unlinkSync = function(file, ...args) {
    if (String(file).includes("session-recovery.lock") && path.basename(String(file)).startsWith("owner-")) throw Object.assign(new Error("Synthetic release failure"), { code: "EIO" });
    return unlink.call(this, file, ...args);
  };
  try { result = startRun({ root, executionContractId: c.executionContractId, startRequestId: "cleanup-boundary" }); }
  finally { fs.unlinkSync = unlink; }
  assert.equal(result.canonicalCommit, "committed");
  assert.equal(result.operationalCleanup.status, "incomplete");
  assert.equal(result.executionReplayAllowed, false);
  assert.equal(inspectProject(root).state.activeRunId, result.run.runId);
});

test("a demonstrably default-owned historical active Run is not another Session's start gate", (t) => {
  const root = fixture(t), c = contract(root);
  const original = startRun({ root, executionContractId: c.executionContractId });
  const file = path.join(root, ".head/sessions/runs", original.run.runId, "run.json");
  const legacy = JSON.parse(fs.readFileSync(file));
  delete legacy.sessionId; delete legacy.startOperation; delete legacy.sessionTransition;
  fs.writeFileSync(file, JSON.stringify(legacy));
  const defaultBytes = fs.readFileSync(path.join(root, ".head/sessions/current.json"));
  const second = createHeadSession({ root, purpose: "Independent bounded work" });
  const started = withSessionRoute(root, second.sessionId, () => startRun({ root, executionContractId: contract(root).executionContractId, startRequestId: "independent-session" }));
  assert.equal(started.run.sessionId, second.sessionId);
  assert.deepEqual(fs.readFileSync(path.join(root, ".head/sessions/current.json")), defaultBytes);
});
