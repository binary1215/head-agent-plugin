import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeProject, inspectProject } from "../scripts/lib/head-core.mjs";
import { compileContext } from "../scripts/lib/context-compiler.mjs";
import { createExecutionContract, createWholePlanSnapshot } from "../scripts/lib/execution-lineage.mjs";
import { finishRun, startRun } from "../scripts/lib/run-lineage.mjs";
import {
  abortCompaction,
  continueCompaction,
  inspectCompaction,
  prepareCompaction,
  readRecoveryCheckpoint,
  verifyCompaction,
} from "../scripts/lib/compaction-recovery.mjs";
import { dispatch, tools as mcpTools } from "../scripts/mcp-server.mjs";
import { runCommand } from "../scripts/head.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");

function temporaryProject(prefix = "head-compaction-test-") {
  const parent = process.env.HEAD_AGENT_TEST_TMP || os.tmpdir();
  fs.mkdirSync(parent, { recursive: true });
  return fs.mkdtempSync(path.join(parent, prefix));
}

function initialize(root) {
  initializeProject({ root, pluginRoot, runtimes: ["codex", "opencode"] });
  return root;
}

function recoveryInput(overrides = {}) {
  return {
    runtime: "codex",
    userTurnIdAtPrepare: 7,
    purpose: "Preserve the accepted compaction recovery direction",
    approvedDecisions: ["Session/Run checkpoint remains recovery canon", "Provider summaries remain orientation only"],
    currentPosition: "The provider-neutral compaction protocol is ready for verification",
    nextExpectedResult: "One digest-verified continuation without objective rewrite",
    openReviewIds: [],
    ...overrides,
  };
}

function hasOwnKeyDeep(value, key) {
  if (Array.isArray(value)) return value.some((item) => hasOwnKeyDeep(item, key));
  if (!value || typeof value !== "object") return false;
  return Object.prototype.hasOwnProperty.call(value, key) || Object.values(value).some((item) => hasOwnKeyDeep(item, key));
}

test("compaction recovers only from a canonical checkpoint and consumes continuation once", (t) => {
  const root = initialize(temporaryProject());
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const productFile = path.join(root, ".head", "context", "product-model.json");
  const productBefore = fs.readFileSync(productFile);

  const prepared = prepareCompaction({ root, ...recoveryInput() });
  assert.equal(prepared.status, "compaction_prepared");
  assert.equal(prepared.epoch.state, "prepared");
  assert.match(prepared.checkpoint.checkpointId, /^checkpoint-[a-f0-9]{24}$/u);
  assert.equal(prepared.checkpoint.purpose, recoveryInput().purpose);
  assert.deepEqual(prepared.checkpoint.approvedDecisions, [...recoveryInput().approvedDecisions].sort());
  assert.equal(prepared.checkpoint.runPointer, null);
  assert.equal(hasOwnKeyDeep(prepared.epoch, "providerSessionId"), false);
  assert.notEqual(prepared.continuationToken, prepared.epoch.continuationTokenBindingHash);

  assert.throws(() => continueCompaction({
    root,
    epochId: prepared.epoch.epochId,
    continuationToken: prepared.continuationToken,
    currentUserTurnId: 7,
  }), { code: "COMPACTION_NOT_VERIFIED" });
  assert.throws(() => verifyCompaction({
    root,
    epochId: prepared.epoch.epochId,
    checkpointDigest: prepared.checkpoint.checkpointDigest,
    currentUserTurnId: 7,
    providerCompacted: true,
    recoverySource: "provider-summary",
  }), { code: "NON_CANONICAL_RECOVERY_SOURCE" });

  const verified = verifyCompaction({
    root,
    epochId: prepared.epoch.epochId,
    checkpointDigest: prepared.checkpoint.checkpointDigest,
    currentUserTurnId: 7,
    providerCompacted: true,
  });
  assert.equal(verified.epoch.state, "verified");
  assert.equal(verified.checkpoint.checkpointDigest, prepared.checkpoint.checkpointDigest);
  assert.equal(verified.recoveryReceipt.recoveryAuthority, false);
  assert.equal(verified.recoveryReceipt.objectiveRewrite, false);
  assert.equal(verified.excludedSources.includes("HEADContinuitySnapshot"), true);

  const continued = continueCompaction({
    root,
    epochId: prepared.epoch.epochId,
    continuationToken: prepared.continuationToken,
    currentUserTurnId: 7,
  });
  assert.equal(continued.epoch.state, "continued");
  assert.equal(continued.recoveryReceipt.continuationSubmitted, true);
  assert.equal(continued.checkpoint.purpose, prepared.checkpoint.purpose);
  assert.throws(() => continueCompaction({
    root,
    epochId: prepared.epoch.epochId,
    continuationToken: prepared.continuationToken,
    currentUserTurnId: 7,
  }), { code: "COMPACTION_TOKEN_CONSUMED" });
  assert.deepEqual(fs.readFileSync(productFile), productBefore);
  assert.equal(inspectCompaction({ root }).epoch.state, "continued");
});

test("a newer real user turn supersedes a prepared continuation", (t) => {
  const root = initialize(temporaryProject());
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prepared = prepareCompaction({ root, ...recoveryInput({ userTurnIdAtPrepare: 10 }) });
  assert.throws(() => verifyCompaction({
    root,
    epochId: prepared.epoch.epochId,
    checkpointDigest: prepared.checkpoint.checkpointDigest,
    currentUserTurnId: 11,
    providerCompacted: true,
  }), { code: "COMPACTION_SUPERSEDED" });
  const status = inspectCompaction({ root });
  assert.equal(status.epoch.state, "superseded");
  assert.equal(status.epoch.supersededByUserTurnId, 11);
  assert.equal(status.epoch.continuationTokenBindingHash, null);
  assert.throws(() => continueCompaction({
    root,
    epochId: prepared.epoch.epochId,
    continuationToken: prepared.continuationToken,
    currentUserTurnId: 11,
  }), { code: "COMPACTION_SUPERSEDED" });
});

test("provider failure and checkpoint tamper abort instead of guessing recovery", (t) => {
  const root = initialize(temporaryProject());
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const failedProvider = prepareCompaction({ root, ...recoveryInput({ userTurnIdAtPrepare: 12 }) });
  assert.throws(() => verifyCompaction({
    root,
    epochId: failedProvider.epoch.epochId,
    checkpointDigest: failedProvider.checkpoint.checkpointDigest,
    currentUserTurnId: 12,
    providerCompacted: false,
  }), { code: "PROVIDER_COMPACTION_FAILED" });
  assert.equal(inspectCompaction({ root }).epoch.state, "aborted");

  const tampered = prepareCompaction({ root, ...recoveryInput({ userTurnIdAtPrepare: 13 }) });
  const checkpointFile = path.join(root, ".head", "sessions", "ledger", `${tampered.checkpoint.checkpointId}.json`);
  const checkpoint = JSON.parse(fs.readFileSync(checkpointFile, "utf8"));
  checkpoint.nextExpectedResult = "A provider summary silently replaced the next result";
  fs.writeFileSync(checkpointFile, `${JSON.stringify(checkpoint, null, 2)}\n`);
  assert.throws(() => verifyCompaction({
    root,
    epochId: tampered.epoch.epochId,
    checkpointDigest: tampered.checkpoint.checkpointDigest,
    currentUserTurnId: 13,
    providerCompacted: true,
  }), { code: "COMPACTION_DIGEST_MISMATCH" });
  assert.equal(inspectCompaction({ root }).epoch.state, "aborted");
});

test("an active Run checkpoint pins verified plan, contract, and capsule identities", (t) => {
  const root = initialize(temporaryProject());
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const capsule = compileContext({ root, task: "Preserve the active Run across compaction", budget: 2000, persist: true }).capsule;
  const plan = createWholePlanSnapshot({
    root,
    objective: "Complete the provider-neutral compaction recovery vertical",
    plan: [{ id: "verify", outcome: "Direction-preserving recovery" }],
    invariants: ["Provider summary cannot rewrite the objective"],
  }).artifact;
  const contract = createExecutionContract({
    root,
    wholePlanId: plan.wholePlanId,
    capsuleId: capsule.capsuleId,
    scope: "Implement and verify compaction recovery",
    acceptanceCriteria: ["Run identity survives compaction"],
  }).artifact;
  const run = startRun({ root, executionContractId: contract.executionContractId }).run;
  const prepared = prepareCompaction({ root, ...recoveryInput({ userTurnIdAtPrepare: 20 }) });
  assert.deepEqual(prepared.checkpoint.runPointer, {
    runId: run.runId,
    wholePlanId: plan.wholePlanId,
    executionContractId: contract.executionContractId,
    contextCapsuleDigest: capsule.capsuleHash,
    currentResultPacketId: null,
  });
  const verified = verifyCompaction({
    root,
    epochId: prepared.epoch.epochId,
    checkpointDigest: prepared.checkpoint.checkpointDigest,
    currentUserTurnId: 20,
    providerCompacted: true,
  });
  assert.equal(verified.checkpoint.runPointer.runId, inspectProject(root).state.activeRunId);
  abortCompaction({ root, epochId: prepared.epoch.epochId, reason: "fixture cleanup" });
});

test("checkpoint recovery remains sufficient after ResultPacket evidence is deleted", (t) => {
  const root = initialize(temporaryProject());
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const capsule = compileContext({ root, task: "Prove checkpoint-only recovery", budget: 2000, persist: true }).capsule;
  const plan = createWholePlanSnapshot({
    root,
    objective: "Keep the next expected result recoverable without ResultPacket evidence",
    plan: [{ id: "checkpoint", outcome: "Self-contained recovery record" }],
  }).artifact;
  const contract = createExecutionContract({
    root,
    wholePlanId: plan.wholePlanId,
    capsuleId: capsule.capsuleId,
    scope: "Produce evidence and checkpoint the next direction",
    acceptanceCriteria: ["Checkpoint remains readable after evidence deletion"],
  }).artifact;
  startRun({ root, executionContractId: contract.executionContractId });
  const finished = finishRun({
    root,
    outcome: "Evidence recorded before checkpoint",
    evidence: [{ uri: "test/compaction-recovery.test.mjs", digest: "checkpoint-deletion-proof" }],
    verification: [{ check: "result packet created", status: "passed" }],
  });
  const nextExpectedResult = "Continue from the exact checkpoint direction without consulting the deleted ResultPacket";
  const prepared = prepareCompaction({ root, ...recoveryInput({ userTurnIdAtPrepare: 21, nextExpectedResult }) });
  assert.equal(prepared.checkpoint.authorityBoundary.planeId, "P2");
  const resultFile = path.join(root, ".head", "lineage", "result-packets", `${finished.resultPacket.resultPacketId}.json`);
  fs.unlinkSync(resultFile);
  const recovered = readRecoveryCheckpoint({ root, checkpointId: prepared.checkpoint.checkpointId }).checkpoint;
  assert.equal(recovered.nextExpectedResult, nextExpectedResult);
  assert.equal(recovered.authorityBoundary.recoveryAuthority, true);
  assert.equal(recovered.authority.recoveryFieldSources, "explicit-head-user-direction-and-verified-p2-lineage-only");
  assert.equal(recovered.authority.evidenceRecords, "reference-only-not-recovery-field-source");
  assert.equal(fs.existsSync(resultFile), false);
  abortCompaction({ root, epochId: prepared.epoch.epochId, reason: "fixture cleanup" });
});

test("CLI and MCP expose advanced explicit compaction recovery without provider invocation", async (t) => {
  const root = initialize(temporaryProject());
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const inputFile = path.join(root, "compact-prepare.json");
  fs.writeFileSync(inputFile, `${JSON.stringify(recoveryInput({ runtime: "manual", userTurnIdAtPrepare: 30 }), null, 2)}\n`);
  const prepared = runCommand(["compact-prepare", root, "--input", inputFile]);
  assert.equal(prepared.epoch.runtime, "manual");
  assert.equal(runCommand(["compact-status", root]).epoch.state, "prepared");
  assert.equal(runCommand(["help"]).commands.some((command) => command.includes("compact-")), false);
  assert.equal(runCommand(["help-all"]).commands.some((command) => command.includes("compact-prepare")), true);
  assert.equal(mcpTools.some((tool) => tool.name === "head_compact_prepare"), true);
  const status = await dispatch({
    jsonrpc: "2.0",
    id: 501,
    method: "tools/call",
    params: { name: "head_compact_status", arguments: { project_root: root } },
  });
  assert.equal(status.result.structuredContent.epoch.state, "prepared");
  assert.equal(status.result.structuredContent.epoch.continuationTokenBindingHash, "present-not-disclosed");
  abortCompaction({ root, epochId: prepared.epoch.epochId, reason: "fixture cleanup" });
});
