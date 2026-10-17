import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { dispatch } from "../scripts/mcp-server.mjs";
import { runCommand } from "../scripts/head.mjs";
import { formatCliResult, formatMcpToolContent, formatConversationRecovery } from "../scripts/lib/cli-presentation.mjs";
import { enterConversationRecovery } from "../scripts/lib/compaction-lifecycle.mjs";
import { inspectRecoveryCheckpointBasis, syncRecoveryCheckpoint } from "../scripts/lib/compaction-recovery.mjs";
import { updateProjectDirection } from "../scripts/lib/project-direction.mjs";
import { createSessionHostAdapter } from "../scripts/lib/session-host-adapter.mjs";
import { compileContext } from "../scripts/lib/context-compiler.mjs";
import { createWholePlanSnapshot, createExecutionContract } from "../scripts/lib/execution-lineage.mjs";
import { startRun, finishRun } from "../scripts/lib/run-lineage.mjs";
import { sessionStartContext } from "../scripts/session-host-hook.mjs";
import { fixture, exact, link, representative, snapshot, recordFor, accounting, pluginRoot } from "./helpers/session-work-linkage-fixture.mjs";

const directionView = value => value ? Object.fromEntries(["directionId", "directionHash", "input"].filter(key => value[key] !== undefined).map(key => [key, value[key]])) : null;

// Real local API/serializer fixtures, not native Host/model compliance evidence.
async function call(f, name, args = {}, routed = false) {
  const arguments_ = { project_root: f.root, session_id: f.session.sessionId, ...args };
  const response = await dispatch({ jsonrpc: "2.0", id: "synthetic-linked-consumer", method: "tools/call", params: {
    name: routed ? "head_tools_call" : name, arguments: routed ? { name, arguments: arguments_ } : arguments_,
  } });
  assert.equal(response.error, undefined, JSON.stringify(response));
  assert.equal(response.result?.isError, undefined, JSON.stringify(response));
  return response.result;
}
function presentedWork(text) {
  const heading = "Selected Session work evidence (P3, not current direction or permission):\n";
  const start = text.indexOf(heading);
  assert.ok(start >= 0, text);
  return JSON.parse(text.slice(start + heading.length).split("\n")[0]);
}
function checkpoint(f) {
  return f.route(() => syncRecoveryCheckpoint({ root: f.root,
    expectedRecoveryBasisId: inspectRecoveryCheckpointBasis({ root: f.root }).basis.basisId,
    purpose: "CURRENT LOCAL PURPOSE: explain only", approvedDecisions: ["CURRENT LOCAL CONSTRAINT: no network"],
    currentPosition: "CURRENT LOCAL POSITION: execution outcome remains separate",
    nextExpectedResult: "CURRENT LOCAL NEXT: provide evidence, no deployment" }));
}
function hostFixture(f, runtime) {
  const environment = { HEAD_AGENT_OPERATIONAL_STATE_ROOT: f.operational }, nativeSessionId = "synthetic-linked-" + runtime;
  const host = createSessionHostAdapter({ runtime, nativeSessionId, environment });
  assert.equal(host.select({ root: f.root, sessionId: f.session.sessionId, expectedRevision: 0 }).retained, true);
  return { host, read() {
    const output = sessionStartContext({ runtime, environment, event: { hook_event_name: "SessionStart", source: "resume", cwd: f.root, session_id: nativeSessionId } });
    const text = output.hookSpecificOutput.additionalContext;
    assert.ok(text.length <= (runtime === "codex" ? 32768 : 10000));
    return { text, value: JSON.parse(text) };
  } };
}

test("shared optional schema travels through direct record, CLI JSON and checkpoint work_evidence without extra saves", async t => {
  const f = fixture(t);
  const root = (await call(f, "head_session_work_record", { evidence: { summary: "Synthetic initial anchor" } })).structuredContent;
  const input = { summary: "CLI running note", workLink: link(root), executionObservation: { state: "running" } };
  const inputFile = path.join(f.base, "cli-evidence.json"); fs.writeFileSync(inputFile, JSON.stringify(input));
  const running = runCommand(["session-work-record", f.root, "--session", f.session.sessionId, "--input", inputFile]);
  assert.deepEqual(running.evidence.content.workLink, input.workLink);
  const basis = f.route(() => inspectRecoveryCheckpointBasis({ root: f.root }).basis.basisId);
  const synced = (await call(f, "head_checkpoint_sync", {
    expected_recovery_basis_id: basis, purpose: "Explain synthetic work", approved_decisions: [],
    current_position: "Observed bounded completion", next_expected_result: "Explain remaining X",
    work_evidence: { pending: ["X"], workLink: link(root, running), executionObservation: { state: "ended", target: exact(running) } },
  }, true)).structuredContent;
  assert.equal(synced.outcome, "created"); assert.equal(synced.workEvidence.writes, 1);
  assert.equal(synced.checkpoint.workEvidence, undefined);
  const before = snapshot(f.base), read = f.read({ maxRecords: 8 });
  assert.equal(read.coverage.originals, 3); assert.deepEqual(recordFor(read, running).savedActivity.states, ["ended"]);
  const retry = await call(f, "head_session_work_record", { evidence: input }, true);
  assert.equal(retry.structuredContent.writes, 0); assert.equal(retry.structuredContent.executionReplayAllowed, false);
  assert.deepEqual(snapshot(f.base), before); accounting(read);
});

test("organized originals and overlays reach CLI, direct/router MCP and entry with zero writes", async t => {
  const f = fixture(t), saved = representative(f), expected = f.read(), before = snapshot(f.base);
  const cli = runCommand(["session-work-read", f.root, "--session", f.session.sessionId]);
  assert.deepEqual(cli, expected);
  const presented = presentedWork(formatCliResult("session-work-read", cli));
  for (const name of ["organization", "coverage", "omissions"]) assert.deepEqual(presented[name], expected[name]);
  for (const record of presented.records) {
    const original = expected.records.find(item => item.evidenceId === record.evidenceId);
    assert.deepEqual(record.savedActivity, original.savedActivity); assert.equal(record.selectionRole, original.selectionRole);
    assert.deepEqual(record.content, original.content);
  }
  assert.ok(JSON.stringify(presented).includes("EXACT REASON: A loses retained provenance"));
  assert.ok(JSON.stringify(presented).includes("X remains"));
  for (const routed of [false, true]) {
    const read = await call(f, "head_session_work_read", {}, routed);
    assert.deepEqual(read.structuredContent, expected);
    assert.equal(read.content[0].text, formatMcpToolContent("head_session_work_read", expected));
    assert.deepEqual(presentedWork(read.content[0].text).organization, expected.organization);
    const entry = await call(f, "head_conversation_enter", {}, routed);
    assert.deepEqual(entry.structuredContent.workContext, expected);
    assert.ok(JSON.stringify(entry.content).includes("EXACT REASON: A loses retained provenance"));
    assert.equal(entry.structuredContent.ordinaryWorkBlocked, false);
  }
  assert.deepEqual(f.route(() => enterConversationRecovery({ root: f.root })).workContext, expected);
  assert.deepEqual(snapshot(f.base), before);
  assert.deepEqual(recordFor(expected, saved.running).savedActivity.states, ["ended"]);
});

for (const runtime of ["codex", "claude"]) test(`${runtime} public synthetic Hook carries saved activity with its body and current P2/common priority`, t => {
  const f = fixture(t, "CURRENT SELECTED PURPOSE: investigate locally"), saved = representative(f);
  const direction = updateProjectDirection({ root: f.root, input: { goal: "CURRENT COMMON GOAL: explain only", constraints: ["No external effects"], cancelledActions: ["deployment"] } }).direction;
  const synced = checkpoint(f), caller = hostFixture(f, runtime), before = snapshot(f.base);
  const entry = caller.host.enter({ root: f.root }), { value, text } = caller.read();
  assert.deepEqual(value.currentProjectDirection, directionView(direction)); assert.equal(value.sessionPurpose, entry.workContext.sessionPurpose);
  assert.equal(value.sessionRecovery.checkpointId, synced.checkpoint.checkpointId);
  assert.deepEqual(value.sessionRecovery.approvedDecisions, synced.checkpoint.approvedDecisions);
  assert.equal(value.sessionRecovery.historicalNextExpectedResult, synced.checkpoint.nextExpectedResult);
  assert.equal(value.sessionRecovery.historicalApprovalGrantsCurrentEffect, false);
  assert.deepEqual(value.route, { session_id: f.session.sessionId });
  assert.equal(value.savedObservationScope, "Saved historical observations coexist; no current live state, success or authority is inferred.");
  assert.ok(text.includes("X remains")); assert.ok(text.includes("EXACT REASON: A loses retained provenance"));
  assert.ok(value.records.some(record => record.evidenceId === saved.ended.evidence.evidenceId));
  for (const record of value.records) {
    const original = entry.workContext.records.find(item => item.evidenceId === record.evidenceId);
    assert.ok(original); assert.deepEqual(record.content, original.content);
    if (original.savedActivity) assert.deepEqual(record.savedActivity, original.savedActivity);
    assert.equal(record.selectionRole, original.selectionRole);
  }
  for (const flag of ["persisted", "userDecisionRequired", "ordinaryWorkBlocked"]) assert.equal(value[flag], false);
  assert.deepEqual(snapshot(f.base), before);
  t.diagnostic(JSON.stringify({ scope: "synthetic-public-adapter-and-hook-only", runtime, length: text.length, modelAndNativeHostVerified: false }));
});

for (const runtime of ["codex", "claude"]) test(`${runtime} optional organized bodies cannot evict a fitting long current purpose or leave an overlayless note`, t => {
  const f = fixture(t, "CURRENT LONG PURPOSE " + "p".repeat(4100)); representative(f);
  const direction = updateProjectDirection({ root: f.root, input: { goal: "Current common direction", cancelledActions: ["deployment"] } }).direction;
  const caller = hostFixture(f, runtime), before = snapshot(f.base), entry = caller.host.enter({ root: f.root });
  const { value } = caller.read();
  assert.equal(value.sessionPurpose, entry.workContext.sessionPurpose); assert.deepEqual(value.currentProjectDirection, directionView(direction));
  for (const record of value.records) {
    const original = entry.workContext.records.find(item => item.evidenceId === record.evidenceId);
    if (original.savedActivity) assert.deepEqual(record.savedActivity, original.savedActivity);
  }
  if (value.records.some(record => record.selectionRole)) assert.equal(value.savedObservationScope,
    "Saved historical observations coexist; no current live state, success or authority is inferred.");
  assert.equal(value.omittedEvidenceCount, entry.workContext.records.length - value.records.length);
  assert.deepEqual(snapshot(f.base), before);
});

test("P3 ended never clears canonical pending review, and CLI/Hook expose the separate verified axis", t => {
  const f = fixture(t), root = f.save({ summary: "Original bounded work", executionObservation: { state: "running" } });
  checkpoint(f);
  f.route(() => {
    const capsule = compileContext({ root: f.root, task: "Synthetic local bounded implementation", persist: true }).capsule;
    const plan = createWholePlanSnapshot({ root: f.root, objective: "Synthetic bounded result", plan: [{ id: "inspect", outcome: "Local evidence" }], invariants: ["No external effects"] }).artifact;
    const contract = createExecutionContract({ root: f.root, wholePlanId: plan.wholePlanId, capsuleId: capsule.capsuleId,
      scope: "Synthetic local evidence", acceptanceCriteria: ["Local evidence returned"] }).artifact;
    startRun({ root: f.root, executionContractId: contract.executionContractId, startRequestId: "synthetic-linked-run" });
    finishRun({ root: f.root, outcome: "Local synthetic result", evidence: [{ uri: "synthetic", digest: "evidence" }], verification: [{ check: "local", status: "passed" }] });
  });
  f.save({ executionObservation: { state: "ended", target: exact(root) }, pending: ["X remains and review is separate"], workLink: link(root) });
  const callers = ["codex", "claude"].map(runtime => hostFixture(f, runtime)), before = snapshot(f.base);
  const entry = f.route(() => enterConversationRecovery({ root: f.root }));
  const current = entry.restore.projection.currentExecution;
  assert.equal(current.status, "verified"); assert.ok(current.sessionPointer.pendingReview);
  assert.deepEqual(recordFor(entry.workContext, root).savedActivity.states, ["ended"]);
  const cli = formatCliResult("conversation-enter", entry);
  assert.ok(cli.includes(current.sessionPointer.pendingReview.runId));
  for (const caller of callers) {
    const { value } = caller.read();
    assert.equal(value.currentExecution.status, current.status);
    assert.ok(JSON.stringify(value.currentExecution).includes(current.sessionPointer.pendingReview.runId));
    assert.ok(JSON.stringify(value.records).includes("X remains and review is separate"));
    assert.equal(value.userDecisionRequired, false); assert.equal(value.ordinaryWorkBlocked, false);
  }
  assert.deepEqual(snapshot(f.base), before);
});

test("private startup serializer retains record-overlay tuples at 9999/10000 and omits them whole beyond capacity", t => {
  // Serializer-only capacity evidence complements the public Hook fixtures.
  const source = fs.readFileSync(path.join(pluginRoot, "scripts/session-host-hook.mjs"), "utf8");
  const formatter = new Function("path", source.slice(source.indexOf("const MAX_CONTEXT_CHARACTERS"), source.indexOf("// A read-only command Hook")) + "\nreturn startupProjection;")(path);
  const id = "work-evidence-" + "a".repeat(24), digest = "b".repeat(64);
  const activity = { states: ["ended"], qualifierCount: 1, qualifiers: [{ evidenceId: "work-evidence-" + "c".repeat(24), evidenceDigest: digest, state: "ended" }],
    omittedQualifierCount: 0, unavailableQualifierCount: 0, coverage: "verified-scan", relations: [] };
  const entry = { status: "conversation_ready", currentProjectDirection: null, workContext: {
    sessionId: "session-AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE", sessionPurpose: "Protected local purpose", organization: {
      interpretation: "Saved historical observations coexist; neither their state, time nor predecessor establishes current live state, success or authority.",
      liveState: "not-observed", scope: "discovered-selected-session", roots: 1, branchingPredecessors: 0,
      unavailableRelations: 0, uninspectedRelations: 0, relatedReadAttempts: 0, relatedExpansionDeferred: 0,
    },
    records: [{ evidenceId: id, evidenceDigest: digest, selectionRole: "recent", content: { summary: "" }, references: [], savedActivity: activity }],
    coverage: { originals: 1, inspected: 1, valid: 1, included: 1 }, omissions: { byBudget: 0, uninspected: 0, evidenceIds: [] }, nextAfterEvidenceId: null,
  } };
  let boundary = null;
  // Output overhead can change when optional coverage is omitted. Search the
  // finite 10000-character input domain; no model or filesystem mutation occurs.
  for (let length = 0; length <= 10000; length += 1) {
    entry.workContext.records[0].content.summary = "s".repeat(length);
    const text = formatter(entry, pluginRoot), value = JSON.parse(text);
    assert.ok(text.length <= 10000);
    if (value.records.length) {
      assert.deepEqual(value.records[0].savedActivity, activity);
      assert.equal(value.savedObservationScope, "Saved historical observations coexist; no current live state, success or authority is inferred.");
      if (text.length === 9999 || text.length === 10000) boundary = { length, outputLength: text.length };
    } else if (boundary) break;
  }
  assert.ok(boundary, "An included tuple must reach the final 9999/10000 boundary");
  entry.workContext.records[0].content.summary = "s".repeat(14000);
  const overflow = JSON.parse(formatter(entry, pluginRoot));
  assert.deepEqual(overflow.records, []); assert.equal(overflow.omittedEvidenceCount, 1);
  assert.equal(overflow.savedObservationScope, undefined);
  assert.equal(overflow.sessionPurpose, "Protected local purpose");
  t.diagnostic(JSON.stringify({ scope: "private-serializer-only", ...boundary }));
});

test("serializer-only incomplete/conflict execution status survives CLI quiet/common-unavailable/normal and private Hook without P2 writes", t => {
  const f = fixture(t), before = snapshot(f.base);
  const source = fs.readFileSync(path.join(pluginRoot, "scripts/session-host-hook.mjs"), "utf8");
  const formatter = new Function("path", source.slice(source.indexOf("const MAX_CONTEXT_CHARACTERS"), source.indexOf("// A read-only command Hook")) + "\nreturn startupProjection;")(path);
  const activeRunId = "run-1767225600000-abcdef";
  for (const status of ["incomplete", "conflict"]) {
    const entry = { status: "conversation_direction_restored", currentProjectDirection: null,
      restore: { checkpoint: { checkpointId: "checkpoint-" + "a".repeat(24), purpose: "Retained local direction", approvedDecisions: [],
        currentPosition: "Incomplete execution remains a separate observation", nextExpectedResult: "Explain only" },
      projection: { currentExecution: { status, sessionPointer: { activeRunId, pendingReview: null, lastReviewDecisionId: null, requiredPlanAction: null },
        activeRun: null, pendingReview: null, storageTransition: { status } } } },
      workContext: { status: "work_context_not_recorded", sessionId: f.session.sessionId, sessionPurpose: "Current selected purpose", records: [] } };
    for (const branch of ["quiet", "common-unavailable", "normal"]) {
      const input = structuredClone(entry);
      if (branch === "quiet") input.presentation = { mode: "quiet" };
      if (branch === "common-unavailable") input.projectStatus = { currentProjectDirection: null,
        currentProjectDirectionAvailability: { status: "unavailable", reasonCode: "PROJECT_DIRECTION_UNAVAILABLE", dependentEffectsBlocked: true } };
      const original = structuredClone(input), text = formatConversationRecovery(input);
      const heading = `Canonical execution observation (${status}):\n`, offset = text.indexOf(heading);
      assert.ok(offset >= 0, `${branch}/${status}: ${text}`);
      const axis = JSON.parse(text.slice(offset + heading.length).split("\n")[0]);
      assert.equal(axis.status, status); assert.equal(axis.sessionPointer.activeRunId, activeRunId);
      assert.equal(axis.activeRun, undefined); // A pointer is not a verified Run body.
      const hook = JSON.parse(formatter(input, f.root));
      assert.equal(hook.currentExecution.status, status);
      assert.equal(hook.currentExecution.sessionPointer.activeRunId, activeRunId);
      assert.equal(hook.currentExecution.activeRun, undefined);
      assert.equal(hook.persisted, false); assert.equal(hook.ordinaryWorkBlocked, false);
      assert.deepEqual(input, original);
    }
  }
  assert.deepEqual(snapshot(f.base), before);
  t.diagnostic("serializer-only injected source-shaped incomplete/conflict; not an actual Run transition or Host execution");
});

test("private Hook execution-detail omission keeps an expansion notice without evicting fitting protected fields", t => {
  const source = fs.readFileSync(path.join(pluginRoot, "scripts/session-host-hook.mjs"), "utf8");
  const formatter = new Function("path", source.slice(source.indexOf("const MAX_CONTEXT_CHARACTERS"), source.indexOf("// A read-only command Hook")) + "\nreturn startupProjection;")(path);
  const entry = { status: "conversation_direction_restored", currentProjectDirection: { directionId: "direction-" + "a".repeat(24),
    input: { goal: "Current goal", constraints: ["Local only"], cancelledActions: ["deployment"] } },
    restore: { checkpoint: { checkpointId: "checkpoint-" + "b".repeat(24), purpose: "Retained P2 purpose", approvedDecisions: ["No network"],
      currentPosition: "Retained P2 position", nextExpectedResult: "Retained P2 next result" }, projection: {} },
    workContext: { sessionId: "session-AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE", sessionPurpose: "", records: [] } };
  let protectedView;
  for (let length = 0; length <= 10000; length += 1) {
    entry.workContext.sessionPurpose = "p".repeat(length);
    const text = formatter(entry, pluginRoot), value = JSON.parse(text);
    if (value.sessionPurpose === entry.workContext.sessionPurpose && text.length >= 9970) { protectedView = value; break; }
  }
  assert.ok(protectedView, "A near-capacity intact protected context must be available");
  const activeRunId = "run-1767225600000-abcdef";
  entry.restore.projection.currentExecution = { status: "conflict", activeRun: null, sessionPointer: { activeRunId,
    pendingReview: { runId: activeRunId, wholePlanId: "whole-plan-" + "c".repeat(24), resultPacketId: "result-packet-" + "d".repeat(24) },
    lastReviewDecisionId: "review-decision-" + "e".repeat(24), requiredPlanAction: { kind: "replan", disposition: "revise",
      wholePlanId: "whole-plan-" + "c".repeat(24), reviewDecisionId: "review-decision-" + "e".repeat(24) } } };
  const original = structuredClone(entry), text = formatter(entry, pluginRoot), value = JSON.parse(text);
  assert.ok(text.length <= 10000);
  assert.equal(value.sessionPurpose, protectedView.sessionPurpose);
  assert.deepEqual(value.currentProjectDirection, protectedView.currentProjectDirection);
  assert.deepEqual(value.sessionRecovery, protectedView.sessionRecovery);
  assert.equal(value.requiredSourceExpansion, undefined);
  assert.ok(!value.currentExecution?.sessionPointer, "Execution details must yield before fitting protected content");
  if (value.currentExecution) { assert.equal(value.currentExecution.status, "conflict"); assert.equal(value.currentExecution.contentIncluded, false); }
  assert.ok(value.scope.includes("Execution details omitted; expand entry"));
  assert.equal(value.persisted, false); assert.deepEqual(entry, original);
  t.diagnostic("private serializer capacity only; no P2 transition or actual execution fault was injected");
});
