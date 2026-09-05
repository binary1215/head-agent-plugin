import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawn } from "node:child_process";
import { withProjectMutation, withProjectMutationAsync } from "../scripts/lib/project-mutation-lock.mjs";
import { withRefreshWriterLease, inspectRefreshWriterLease } from "../scripts/lib/refresh-writer-lease.mjs";
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

function projectBytes(root) {
  return Object.fromEntries(fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => [path.relative(root, path.join(entry.parentPath, entry.name)), fs.readFileSync(path.join(entry.parentPath, entry.name), "base64")])
    .sort(([a], [b]) => a.localeCompare(b)));
}

function recoveryChild(t, action, input, { holdLock = false, crashAfter = null, crashAfterConsumption = false, crashRefreshStaging = false } = {}) {
  const script = `
    import { prepareCompaction, continueCompaction } from './scripts/lib/compaction-recovery.mjs';
    import { withProjectMutation } from './scripts/lib/project-mutation-lock.mjs';
    import fs from 'node:fs';
    import { withRefreshWriterLease } from './scripts/lib/refresh-writer-lease.mjs';
    import { inspectProject } from './scripts/lib/head-core.mjs';
    const input = JSON.parse(process.argv[1]);
    console.error(JSON.stringify({pid: process.pid, parentPid: process.ppid, command: ['node', '--input-type=module', '--eval', 'recovery-test-worker'], cwd: process.cwd(), ports: []}));
    ${crashAfter ? `const rename = fs.renameSync;
      fs.renameSync = (source, target) => { rename(source, target); if (target.replaceAll('\\\\', '/').endsWith(${JSON.stringify(crashAfter)})) process.exit(29); };` : ""}
    ${crashAfterConsumption ? `const write = fs.writeFileSync;
      fs.writeFileSync = (file, ...args) => { write(file, ...args); if (typeof file === 'string' && file.replaceAll('\\\\', '/').includes('/compaction/consumptions/')) process.exit(29); };` : ""}
    ${crashRefreshStaging ? `const mkdir = fs.mkdirSync;
      fs.mkdirSync = (file, ...args) => { const result = mkdir(file, ...args); if (typeof file === 'string' && file.replaceAll('\\\\', '/').includes('/refresh/writer.lock.') && file.endsWith('.staging')) {
        ${crashRefreshStaging === "partial" ? "fs.writeFileSync(file + '/owner.json', '{\\\"pid\\\":', {flag:'wx'});" : ""}
        process.exit(29);
      } return result; };
      await withRefreshWriterLease({projectRoot:input.root, projectId: inspectProject(input.root).project.projectId}, () => {});` : ""}
    ${holdLock ? "withProjectMutation({root: input.root, scope: 'session-recovery'}, () => process.exit(29));" : `try { const result = ${action === "prepare" ? "prepareCompaction" : "continueCompaction"}(input); console.log(JSON.stringify({status: result.status, checkpointId: result.checkpoint.checkpointId, nextExpectedResult: result.checkpoint.nextExpectedResult})); }
    catch(error) { console.log(JSON.stringify({code: error.code, message: error.message})); }`}
  `;
  console.error(JSON.stringify({parentPid: process.pid, command: [process.execPath, "--input-type=module", "--eval", "recovery-test-worker"], cwd: pluginRoot, ports: []}));
  const child = spawn(process.execPath, ["--input-type=module", "--eval", script, JSON.stringify(input)], { cwd: pluginRoot, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  console.error(JSON.stringify({pid: child.pid, parentPid: process.pid, operation: action, cwd: pluginRoot, ports: []}));
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill(); });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { process.stderr.write(chunk); });
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      console.error(JSON.stringify({pid: child.pid, exited: true, exitCode: code, ports: []}));
      if ((holdLock || crashAfter || crashAfterConsumption || crashRefreshStaging) && code === 29) return resolve({code});
      if (code !== 0) return reject(new Error(`Recovery child failed: ${code}`));
      try { resolve(JSON.parse(output.trim())); } catch (error) { reject(error); }
    });
  });
  return { child, done };
}

test("rejected prepare preserves every project byte and validates the turn before writes", (t) => {
  const root = initialize(temporaryProject());
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const initial = projectBytes(root);
  for (const userTurnIdAtPrepare of [undefined, -1, 1.5, "7"]) {
    assert.throws(() => prepareCompaction({ root, ...recoveryInput({ userTurnIdAtPrepare }) }), { code: "INVALID_USER_TURN_ID" });
    assert.deepEqual(projectBytes(root), initial);
  }
  const prepared = prepareCompaction({ root, ...recoveryInput() });
  const beforeRejected = projectBytes(root);
  assert.throws(() => prepareCompaction({ root, ...recoveryInput({ nextExpectedResult: "Divergent direction B" }) }), { code: "COMPACTION_EPOCH_ALREADY_OPEN" });
  assert.deepEqual(projectBytes(root), beforeRejected);
  assert.equal(verifyCompaction({ root, epochId: prepared.epoch.epochId, checkpointDigest: prepared.checkpoint.checkpointDigest, currentUserTurnId: 7, providerCompacted: true }).status, "compaction_verified");
});

test("a public checkpoint change prevents stale continuation without consuming its token", (t) => {
  const root = initialize(temporaryProject());
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prepared = prepareCompaction({ root, ...recoveryInput() });
  verifyCompaction({ root, epochId: prepared.epoch.epochId, checkpointDigest: prepared.checkpoint.checkpointDigest, currentUserTurnId: 7, providerCompacted: true });
  runCommand(["checkpoint", root, "--summary", "Current checkpoint B", "--next", "Do B"]);
  const before = projectBytes(root);
  assert.throws(() => continueCompaction({ root, epochId: prepared.epoch.epochId, continuationToken: prepared.continuationToken, currentUserTurnId: 7 }), { code: "COMPACTION_CHECKPOINT_STALE" });
  assert.deepEqual(projectBytes(root), before);
  assert.equal(inspectCompaction({ root }).epoch.state, "verified");
});

test("independent concurrent prepares publish exactly one checkpoint and one epoch", async (t) => {
  const root = initialize(temporaryProject());
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const outcomes = await Promise.all(Array.from({ length: 4 }, (_, index) => recoveryChild(t, "prepare", { root, ...recoveryInput({ nextExpectedResult: `Direction ${index}` }) }).done));
  const winners = outcomes.filter((item) => item.status === "compaction_prepared");
  assert.equal(winners.length, 1);
  assert.equal(outcomes.filter((item) => item.code === "COMPACTION_EPOCH_ALREADY_OPEN").length, 3);
  const current = inspectCompaction({ root });
  assert.equal(current.checkpoint.checkpointId, winners[0].checkpointId);
  assert.equal(inspectProject(root).state.latestCheckpoint, winners[0].checkpointId);
  assert.equal(fs.readdirSync(path.join(root, ".head", "sessions", "ledger")).filter((name) => name.endsWith(".json")).length, 1);
  assert.equal(fs.readdirSync(path.join(root, ".head", "sessions", "compaction", "epochs")).length, 1);
});

test("independent continuation waits for a checkpoint writer and verifies the committed direction", async (t) => {
  const root = initialize(temporaryProject());
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prepared = prepareCompaction({ root, ...recoveryInput() });
  verifyCompaction({ root, epochId: prepared.epoch.epochId, checkpointDigest: prepared.checkpoint.checkpointDigest, currentUserTurnId: 7, providerCompacted: true });
  let waiting;
  await withProjectMutationAsync({ root, scope: "session-recovery" }, async () => {
    waiting = recoveryChild(t, "continue", { root, epochId: prepared.epoch.epochId, continuationToken: prepared.continuationToken, currentUserTurnId: 7 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    runCommand(["checkpoint", root, "--summary", "Concurrent checkpoint B", "--next", "Do B"]);
  });
  assert.equal((await waiting.done).code, "COMPACTION_CHECKPOINT_STALE");
  assert.equal(inspectCompaction({ root }).epoch.state, "verified");
  assert.equal(fs.existsSync(path.join(root, ".head", "sessions", "compaction", "consumptions", `${prepared.epoch.epochId}.json`)), false);
});

test("an interrupted mutation lock is reclaimed only after its exact owner exits", async (t) => {
  const root = initialize(temporaryProject());
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await recoveryChild(t, "crash-lock", { root }, { holdLock: true }).done;
  assert.equal(withProjectMutation({ root, scope: "session-recovery" }, () => "reclaimed"), "reclaimed");
  assert.equal(prepareCompaction({ root, ...recoveryInput() }).status, "compaction_prepared");
});

test("interrupted prepare preserves complete P2 direction and closes only uncertain P5 state", async (t) => {
  for (const crashAfter of ["/compaction/current.json", "/sessions/current.json"]) {
    const root = initialize(temporaryProject());
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const before = runCommand(["checkpoint", root, "--summary", "Prior direction", "--next", "Prior next"]).checkpoint;
    await recoveryChild(t, "prepare", { root, ...recoveryInput() }, { crashAfter }).done;
    const interrupted = inspectCompaction({ root });
    assert.equal(interrupted.status, "interrupted-prepare");
    const currentId = inspectProject(root).state.latestCheckpoint;
    const current = readRecoveryCheckpoint({ root, checkpointId: currentId }).checkpoint;
    assert.equal(current.nextExpectedResult, crashAfter === "/compaction/current.json" ? before.nextExpectedResult : recoveryInput().nextExpectedResult);
    const recovered = prepareCompaction({ root, ...recoveryInput({ nextExpectedResult: "New explicit direction after uncertain prepare" }) });
    assert.equal(recovered.status, "compaction_prepared");
    const previousEpoch = JSON.parse(fs.readFileSync(path.join(root, ".head", "sessions", "compaction", "epochs", `${interrupted.epoch.epochId}.json`)));
    assert.equal(previousEpoch.state, "aborted");
    assert.equal(previousEpoch.continuationTokenBindingHash, null);
  }
});

test("concurrent continuation consumes once and an interrupted consumption never replays", async (t) => {
  for (const crashAfterConsumption of [false, true]) {
    const root = initialize(temporaryProject());
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const prepared = prepareCompaction({ root, ...recoveryInput() });
    verifyCompaction({ root, epochId: prepared.epoch.epochId, checkpointDigest: prepared.checkpoint.checkpointDigest, currentUserTurnId: 7, providerCompacted: true });
    const input = { root, epochId: prepared.epoch.epochId, continuationToken: prepared.continuationToken, currentUserTurnId: 7 };
    if (crashAfterConsumption) {
      await recoveryChild(t, "continue", input, { crashAfterConsumption }).done;
      assert.throws(() => continueCompaction(input), { code: "COMPACTION_TOKEN_CONSUMED" });
    } else {
      const outcomes = await Promise.all(Array.from({ length: 8 }, () => recoveryChild(t, "continue", input).done));
      assert.equal(outcomes.filter((item) => item.status === "compaction_continuation_consumed").length, 1, JSON.stringify(outcomes));
      assert.equal(outcomes.filter((item) => item.code === "COMPACTION_TOKEN_CONSUMED").length, 7, JSON.stringify(outcomes));
    }
    assert.equal(fs.readdirSync(path.join(root, ".head", "sessions", "compaction", "consumptions")).length, 1);
    assert.equal(fs.existsSync(path.join(root, ".head", ".operations")), false);
  }
});

test("a Run started after verification invalidates the old continuation without a new user turn", (t) => {
  const root = initialize(temporaryProject());
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prepared = prepareCompaction({ root, ...recoveryInput() });
  verifyCompaction({ root, epochId: prepared.epoch.epochId, checkpointDigest: prepared.checkpoint.checkpointDigest, currentUserTurnId: 7, providerCompacted: true });
  const capsule = compileContext({ root, task: "A bounded new Run", persist: true });
  const plan = createWholePlanSnapshot({ root, objective: "A bounded new Run", plan: [{ id: "observe", outcome: "Observe only" }] });
  const contract = createExecutionContract({ root, wholePlanId: plan.artifact.wholePlanId, capsuleId: capsule.capsule.capsuleId, scope: "Observe only", acceptanceCriteria: ["Observation recorded"] });
  startRun({ root, executionContractId: contract.artifact.executionContractId });
  const before = projectBytes(root);
  assert.throws(() => continueCompaction({ root, epochId: prepared.epoch.epochId, continuationToken: prepared.continuationToken, currentUserTurnId: 7 }), { code: "COMPACTION_SESSION_DRIFT" });
  assert.deepEqual(projectBytes(root), before);
});

test("refresh lease recovers an empty legacy lock and a crash before owner publication", async (t) => {
  const root = initialize(temporaryProject());
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectId = inspectProject(root).project.projectId;
  fs.mkdirSync(path.join(root, ".head", "refresh", "writer.lock"), { recursive: true });
  await withRefreshWriterLease({ projectRoot: root, projectId }, () => "recovered-empty-legacy-lock");
  for (const crashRefreshStaging of [true, "partial"]) {
    await recoveryChild(t, "refresh-crash", { root }, { crashRefreshStaging }).done;
    assert.equal(await withRefreshWriterLease({ projectRoot: root, projectId }, () => "recovered-staging"), "recovered-staging");
  }
  assert.equal(inspectRefreshWriterLease({ projectRoot: root, projectId }).status, "idle");
  assert.equal(fs.readdirSync(path.join(root, ".head", "refresh")).some((name) => name.includes("writer.lock")), false);
  assert.equal(fs.existsSync(path.join(root, ".head", ".operations")), false);
});

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
  const capsule = compileContext({ root, task: "Preserve the active Run across compaction", budget: 32_768, persist: true }).capsule;
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

test("compaction verification rejects Session pointer drift beyond the active Run tuple", (t) => {
  const root = initialize(temporaryProject());
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prepared = prepareCompaction({ root, ...recoveryInput({ userTurnIdAtPrepare: 22 }) });
  const stateFile = path.join(root, ".head", "sessions", "current.json");
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  state.lastReviewDecisionId = "review-decision-000000000000000000000000";
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  assert.throws(() => verifyCompaction({
    root,
    epochId: prepared.epoch.epochId,
    checkpointDigest: prepared.checkpoint.checkpointDigest,
    currentUserTurnId: 22,
    providerCompacted: true,
  }), { code: "COMPACTION_SESSION_DRIFT" });
  assert.equal(inspectCompaction({ root }).epoch.state, "aborted");
});

test("checkpoint recovery remains sufficient after ResultPacket evidence is deleted", (t) => {
  const root = initialize(temporaryProject());
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const capsule = compileContext({ root, task: "Prove checkpoint-only recovery", budget: 32_768, persist: true }).capsule;
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

test("CLI default help exposes safe compaction status while mutations remain advanced", async (t) => {
  const root = initialize(temporaryProject());
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const inputFile = path.join(root, "compact-prepare.json");
  fs.writeFileSync(inputFile, `${JSON.stringify(recoveryInput({ runtime: "manual", userTurnIdAtPrepare: 30 }), null, 2)}\n`);
  const prepared = runCommand(["compact-prepare", root, "--input", inputFile]);
  assert.equal(prepared.epoch.runtime, "manual");
  assert.equal(runCommand(["compact-status", root]).epoch.state, "prepared");
  assert.equal(runCommand(["help"]).commands.some((command) => command.includes("compact-status")), true);
  assert.equal(runCommand(["help"]).commands.some((command) => command.includes("compact-prepare")), false);
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
