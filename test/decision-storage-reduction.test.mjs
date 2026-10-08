import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeProject, inspectProject } from "../scripts/lib/head-core.mjs";
import { compileContext } from "../scripts/lib/context-compiler.mjs";
import { createWholePlanSnapshot, createExecutionContract, readLineageArtifact } from "../scripts/lib/execution-lineage.mjs";
import { startRun, finishRun, getPendingReviewContext, reviewRun, sessionStateHash, operationPointerHash } from "../scripts/lib/run-lineage.mjs";
import { createRecoveryCheckpoint, inspectRecoveryCheckpointBasis, prepareCompaction, verifyCompaction, continueCompaction, inspectCompaction } from "../scripts/lib/compaction-recovery.mjs";
import { restoreSessionFromArtifacts, integrateReviewedRunCheckpoint, readRunResultIntegration } from "../scripts/lib/session-recovery.mjs";
import { createHeadSession, withSessionRoute } from "../scripts/lib/session-routing.mjs";
import { updateProjectDirection } from "../scripts/lib/project-direction.mjs";
import { proposeProductInitiative, reviewProductInitiative, inspectProductOperatingLoop } from "../scripts/lib/product-operating-loop.mjs";

console.log(JSON.stringify({ event: "owned-test-process", pid: process.pid, parentPid: process.ppid, command: process.execPath, args: process.argv.slice(1), cwd: process.cwd(), ports: [] }));
const pluginRoot = path.resolve(import.meta.dirname, "..");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "head-C-decision-"));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.match(path.basename(root), /^head-C-decision-/);
    fs.rmSync(root, { recursive: true, force: true });
  });
  initializeProject({ root, pluginRoot, runtimes: ["codex"] });
  return root;
}
function start(root) {
  const capsule = compileContext({ root, task: "Preserve exact decision and unknown effects", budget: 32768, persist: true }).capsule;
  const plan = createWholePlanSnapshot({ root, objective: "Finish the bounded task", plan: ["Return evidence"] }).artifact;
  const contract = createExecutionContract({ root, wholePlanId: plan.wholePlanId, capsuleId: capsule.capsuleId, scope: "Return the result", acceptanceCriteria: ["Preserve unknowns"] }).artifact;
  return startRun({ root, executionContractId: contract.executionContractId });
}
const resultInput = (root) => ({ root, outcome: "Fixture result", evidence: [{ uri: "fixture", digest: "C-fixture" }], verification: [{ check: "fixture", status: "passed" }], unknowns: ["External effect has not been observed"] });
const direction = { purpose: "Keep original user direction", approvedDecisions: ["Only the exact result is reviewed"], currentPosition: "Review complete", nextExpectedResult: "Investigate the unknown external effect", openReviewIds: [] };
const stateFile = (root) => path.join(root, ".head/sessions/current.json");
const runFile = (root, id) => path.join(root, ".head/sessions/runs", id, "run.json");
function publishFault(root, operation) {
  const rename = fs.renameSync;
  let injected = false;
  fs.renameSync = (source, target) => {
    if (!injected && path.resolve(target) === stateFile(root)) {
      injected = true;
      throw Object.assign(new Error("interrupted Session publication"), { code: "EIO" });
    }
    return rename(source, target);
  };
  try { assert.throws(operation, { code: "EIO" }); }
  finally { fs.renameSync = rename; }
  assert.ok(injected);
}
function reviewInput(root) {
  return { root, reviewContextId: getPendingReviewContext({ root }).review.reviewContextId, disposition: "accept", rationale: "Accept only this exact fixture result" };
}
function allBytes(root) {
  return Object.fromEntries(fs.readdirSync(path.join(root, ".head"), { recursive: true, withFileTypes: true })
    .filter((item) => item.isFile()).map((item) => {
      const file = path.join(item.parentPath, item.name);
      return [path.relative(root, file), fs.readFileSync(file, "base64")];
    }));
}

test("one decision binds the exact result and exact replay creates no additional record or Session write", (t) => {
  const root = fixture(t);
  start(root);
  const finished = finishRun(resultInput(root));
  const input = reviewInput(root);
  assert.throws(() => reviewRun({ ...input, reviewContextId: "fresh-head-review-000000000000000000000000" }), { code: "STALE_FRESH_HEAD_REVIEW" });
  const accepted = reviewRun(input);
  assert.equal(accepted.reviewDecision.resultPacketId, finished.resultPacket.resultPacketId);
  assert.equal(accepted.run.sessionTransition, undefined, "internal Session patch is not repeated in wire output");
  const before = allBytes(root);
  assert.equal(reviewRun(input).reviewDecision.reviewDecisionId, accepted.reviewDecision.reviewDecisionId);
  assert.deepEqual(allBytes(root), before);
  assert.throws(() => reviewRun({ ...input, disposition: "revise" }), { code: "RUN_TRANSITION_CONFLICT" });
  assert.deepEqual(readLineageArtifact({ root, artifactId: finished.resultPacket.resultPacketId }).artifact.unknowns, resultInput(root).unknowns);
});

test("interrupted finish and review resume only the missing Session publication", (t) => {
  const root = fixture(t);
  const begun = start(root);
  publishFault(root, () => finishRun(resultInput(root)));
  const pendingRun = JSON.parse(fs.readFileSync(runFile(root, begun.run.runId)));
  assert.equal(pendingRun.status, "awaiting_review");
  assert.ok(pendingRun.sessionTransition.before);
  assert.equal(pendingRun.sessionTransition.beforeSessionHash, undefined);
  assert.equal(inspectRecoveryCheckpointBasis({ root }).syncAvailability, "deferred-run-transition");
  finishRun(resultInput(root));
  const input = reviewInput(root);
  publishFault(root, () => reviewRun(input));
  assert.equal(inspectRecoveryCheckpointBasis({ root }).syncAvailability, "deferred-run-transition");
  const recorded = JSON.parse(fs.readFileSync(runFile(root, begun.run.runId))).reviewDecisionId;
  assert.equal(reviewRun(input).reviewDecision.reviewDecisionId, recorded);
  assert.equal(inspectRecoveryCheckpointBasis({ root }).syncAvailability, "ready");
});

test("an interrupted Session patch never overwrites a competing change to the same fields", (t) => {
  const root = fixture(t);
  start(root);
  publishFault(root, () => finishRun(resultInput(root)));
  const state = JSON.parse(fs.readFileSync(stateFile(root)));
  state.mode = "paused-by-owner";
  fs.writeFileSync(stateFile(root), JSON.stringify(state));
  const bytes = fs.readFileSync(stateFile(root));
  assert.throws(() => finishRun(resultInput(root)), { code: "RUN_TRANSITION_SESSION_DRIFT" });
  assert.deepEqual(fs.readFileSync(stateFile(root)), bytes);
});

test("interrupted Session publication preserves unrelated latest-checkpoint metadata", (t) => {
  const root = fixture(t);
  start(root);
  publishFault(root, () => finishRun(resultInput(root)));
  const state = JSON.parse(fs.readFileSync(stateFile(root)));
  state.latestCheckpoint = "checkpoint-000000000000000000000001";
  state.updatedAt = "2026-10-08T12:00:00.000Z";
  state.ownerNote = "Checkpoint metadata changed independently";
  fs.writeFileSync(stateFile(root), JSON.stringify(state));
  const finished = finishRun(resultInput(root));
  assert.equal(finished.state.latestCheckpoint, state.latestCheckpoint);
  assert.equal(finished.state.ownerNote, state.ownerNote);
});

test("legacy prepared hash transitions retain their identity and resume without a new approval", (t) => {
  const root = fixture(t);
  const begun = start(root);
  publishFault(root, () => finishRun(resultInput(root)));
  const file = runFile(root, begun.run.runId);
  const run = JSON.parse(fs.readFileSync(file));
  const state = inspectProject(root).state;
  const { before, patch, ...identity } = run.sessionTransition;
  run.sessionTransition = { ...identity, beforeSessionHash: sessionStateHash(state), afterSessionHash: sessionStateHash({ ...state, ...patch, updatedAt: identity.changedAt }), afterOperationPointerHash: operationPointerHash({ ...state, ...patch }) };
  fs.writeFileSync(file, JSON.stringify(run));
  const oldBytes = fs.readFileSync(file);
  assert.equal(finishRun(resultInput(root)).resultPacket.resultPacketId, identity.artifactId);
  assert.deepEqual(fs.readFileSync(file), oldBytes);
});

test("independent Sessions restore owned originals with latest common cancellation and missing optional result evidence", (t) => {
  const root = fixture(t);
  const originalId = inspectProject(root).state.sessionId;
  const other = createHeadSession({ root, purpose: "Independent investigation" });
  start(root);
  const finished = finishRun(resultInput(root));
  reviewRun(reviewInput(root));
  const checkpoint = createRecoveryCheckpoint({ root, ...direction }).checkpoint;
  const originalBytes = fs.readFileSync(stateFile(root));
  withSessionRoute(root, other.sessionId, () => createRecoveryCheckpoint({ root, ...direction, purpose: "Other Session purpose" }));
  updateProjectDirection({ root, input: { goal: "Investigate without deployment", constraints: ["Keep originals"], decisions: [], cancelledActions: ["deploy"] } });
  fs.unlinkSync(path.join(root, ".head/lineage/result-packets", `${finished.resultPacket.resultPacketId}.json`));
  const restored = restoreSessionFromArtifacts({ root });
  assert.equal(restored.projection.sessionId, originalId);
  assert.equal(restored.checkpoint.checkpointId, checkpoint.checkpointId);
  assert.equal(restored.projection.checkpoint.nextExpectedResult, direction.nextExpectedResult);
  assert.equal(restored.projection.lastResultEvidence.status, "missing-evidence");
  assert.deepEqual(restored.projection.currentProjectDirection.input.cancelledActions, ["deploy"]);
  assert.equal(withSessionRoute(root, other.sessionId, () => restoreSessionFromArtifacts({ root })).projection.checkpoint.purpose, "Other Session purpose");
  assert.deepEqual(fs.readFileSync(stateFile(root)), originalBytes);
});

test("compaction records only epoch verification and actual one-shot consumption; uncertain consumption never replays", (t) => {
  const root = fixture(t);
  const prepared = prepareCompaction({ root, ...direction, runtime: "manual", userTurnIdAtPrepare: 1 });
  const verified = verifyCompaction({ root, epochId: prepared.epoch.epochId, checkpointDigest: prepared.checkpoint.checkpointDigest, currentUserTurnId: 1, providerCompacted: true });
  assert.equal(verified.recoveryReceipt, undefined);
  assert.equal(fs.existsSync(path.join(root, ".head/sessions/compaction/receipts")), false);
  const rename = fs.renameSync;
  fs.renameSync = (source, target) => {
    if (String(target).endsWith(`${prepared.epoch.epochId}.json`) && JSON.parse(fs.readFileSync(source)).state === "continued") throw Object.assign(new Error("unknown consumed outcome"), { code: "EIO" });
    return rename(source, target);
  };
  const input = { root, epochId: prepared.epoch.epochId, continuationToken: prepared.continuationToken, currentUserTurnId: 1 };
  try { assert.throws(() => continueCompaction(input), { code: "EIO" }); }
  finally { fs.renameSync = rename; }
  assert.equal(inspectCompaction({ root }).continuationOutcome, "uncertain");
  assert.throws(() => continueCompaction(input), { code: "COMPACTION_TOKEN_CONSUMED" });
});

test("reviewed integration stores one checkpoint, resumes interruption, rejects divergent direction and cannot replace later direction", (t) => {
  const root = fixture(t);
  const begun = start(root);
  finishRun(resultInput(root));
  const accepted = reviewRun(reviewInput(root));
  const input = { root, runId: begun.run.runId, reviewDecisionId: accepted.reviewDecision.reviewDecisionId, ...direction };
  publishFault(root, () => integrateReviewedRunCheckpoint(input));
  assert.equal(fs.existsSync(path.join(root, ".head/sessions/integrations")), false);
  const durable = readRunResultIntegration({ root, reviewDecisionId: input.reviewDecisionId });
  assert.equal(durable.checkpoint.nextExpectedResult, direction.nextExpectedResult);
  const recovered = integrateReviewedRunCheckpoint(input);
  assert.equal(inspectProject(root).state.latestCheckpoint, durable.checkpoint.checkpointId);
  assert.equal(recovered.integrationReceipt, undefined);
  assert.equal(recovered.integration.integrationRequestId, undefined);
  const before = allBytes(root);
  integrateReviewedRunCheckpoint(input);
  assert.deepEqual(allBytes(root), before);
  assert.throws(() => integrateReviewedRunCheckpoint({ ...input, nextExpectedResult: "Different unapproved direction" }), { code: "RUN_RESULT_INTEGRATION_CONFLICT" });
  const later = createRecoveryCheckpoint({ root, ...direction, nextExpectedResult: "Later explicit direction" });
  integrateReviewedRunCheckpoint(input);
  assert.equal(inspectProject(root).state.latestCheckpoint, later.checkpoint.checkpointId);
  assert.equal(restoreSessionFromArtifacts({ root }).checkpoint.nextExpectedResult, "Later explicit direction");
});

test("Product approval has one original decision; derived outputs rebuild and legacy originals stay readable", async (t) => {
  const root = fixture(t);
  const proposed = await proposeProductInitiative({ root, title: "One decision", reasoning: "User requested durable learning" });
  const input = { root, initiativeCandidateId: proposed.initiativeCandidate.initiativeCandidateId, disposition: "accept", rationale: "Accept the exact candidate", featureResolution: { kind: "candidate", feature: { key: "new-feature", name: "New Feature" } } };
  const accepted = await reviewProductInitiative(input);
  assert.equal(fs.existsSync(path.join(root, ".head/product-operations/reviewed-initiatives")), false);
  assert.equal(fs.existsSync(path.join(root, ".head/product-operations/feature-candidates")), false);
  const projection = inspectProductOperatingLoop({ root, fresh: true }).projection;
  assert.equal(projection.reviewedInitiatives[0].initiativeId, accepted.reviewedInitiative.initiativeId);
  assert.equal(projection.featureCandidates[0].featureCandidateId, accepted.featureCandidate.featureCandidateId);
  assert.equal((await reviewProductInitiative(input)).reviewDecision.reviewDecisionId, accepted.reviewDecision.reviewDecisionId);
  const original = JSON.stringify(accepted.reviewedInitiative, null, 2);
  const directory = path.join(root, ".head/product-operations/reviewed-initiatives");
  fs.mkdirSync(directory);
  const file = path.join(directory, `${accepted.reviewedInitiative.initiativeId}.json`);
  fs.writeFileSync(file, original);
  assert.equal(inspectProductOperatingLoop({ root, fresh: true }).projection.reviewedInitiatives[0].initiativeId, accepted.reviewedInitiative.initiativeId);
  assert.equal(fs.readFileSync(file, "utf8"), original);
});

function acceptedIntegrationInput(root) {
  const begun = start(root);
  const finished = finishRun(resultInput(root));
  const accepted = reviewRun(reviewInput(root));
  return { input: { root, runId: begun.run.runId, reviewDecisionId: accepted.reviewDecision.reviewDecisionId, ...direction }, finished };
}

test("normal shared ledger keeps two accepted Session integrations independent for first publication, read and exact replay", (t) => {
  const root = fixture(t);
  const primary = acceptedIntegrationInput(root);
  const primaryIntegration = integrateReviewedRunCheckpoint(primary.input);
  createRecoveryCheckpoint({ root, ...direction, purpose: "Normal primary checkpoint before secondary integration" });
  const primaryOriginals = Object.fromEntries(Object.entries(allBytes(root)).filter(([file]) => {
    const name = file.replaceAll("\\", "/");
    return name === ".head/project.json" || name === ".head/sessions/current.json"
      || [".head/lineage/", ".head/context/capsules/", ".head/sessions/runs/", ".head/sessions/ledger/", ".head/sessions/records/"].some((prefix) => name.startsWith(prefix));
  }));
  const secondary = createHeadSession({ root, purpose: "Independent secondary accepted result" });
  const other = withSessionRoute(root, secondary.sessionId, () => {
    const accepted = acceptedIntegrationInput(root);
    const integrated = integrateReviewedRunCheckpoint(accepted.input);
    assert.equal(integrated.status, "run_result_integrated_checkpointed");
    return { ...accepted, integrated };
  });
  for (const [file, content] of Object.entries(primaryOriginals)) {
    assert.equal(fs.readFileSync(path.join(root, file), "base64"), content, "secondary integration preserves all existing primary originals");
  }
  createRecoveryCheckpoint({ root, ...direction, purpose: "Later primary direction", nextExpectedResult: "Continue primary work" });
  const readAndReplay = ({ input }, expectedId) => {
    const before = allBytes(root);
    assert.equal(readRunResultIntegration(input).checkpoint.checkpointId, expectedId);
    assert.equal(integrateReviewedRunCheckpoint(input).status, "run_result_integration_existing");
    assert.deepEqual(allBytes(root), before, "read and exact replay do not alter either Session or its originals");
  };
  readAndReplay(primary, primaryIntegration.checkpoint.checkpointId);
  withSessionRoute(root, secondary.sessionId, () => readAndReplay(other, other.integrated.checkpoint.checkpointId));
  const checkpointOriginal = fs.readFileSync(other.integrated.file);
  fs.unlinkSync(path.join(root, ".head/lineage/result-packets", `${other.finished.resultPacket.resultPacketId}.json`));
  updateProjectDirection({ root, input: { goal: "Investigate unknown effects", constraints: ["Keep independent Sessions"], decisions: [], cancelledActions: ["deploy"] } });
  withSessionRoute(root, secondary.sessionId, () => {
    readAndReplay(other, other.integrated.checkpoint.checkpointId);
    const restored = restoreSessionFromArtifacts({ root });
    assert.equal(restored.projection.lastResultEvidence.status, "missing-evidence");
    assert.equal(restored.checkpoint.nextExpectedResult, direction.nextExpectedResult);
    assert.deepEqual(restored.projection.currentProjectDirection.input.cancelledActions, ["deploy"]);
  });
  assert.deepEqual(fs.readFileSync(other.integrated.file), checkpointOriginal);
});

test("exact decision ledger lookup still rejects related damage, duplicate records and another Project or Session without writes", (t) => {
  const root = fixture(t);
  const secondary = createHeadSession({ root, purpose: "Validate only exact secondary decision" });
  withSessionRoute(root, secondary.sessionId, () => {
    const accepted = acceptedIntegrationInput(root);
    const integrated = integrateReviewedRunCheckpoint(accepted.input);
    const originalBytes = fs.readFileSync(integrated.file);
    const original = JSON.parse(originalBytes);
    const unchangedFailure = (code, publishCode = code) => {
      const before = allBytes(root);
      assert.throws(() => readRunResultIntegration(accepted.input), { code });
      assert.throws(() => integrateReviewedRunCheckpoint(accepted.input), { code: publishCode });
      assert.deepEqual(allBytes(root), before);
    };
    for (const [patch, code] of [
      [{ nextExpectedResult: "Corrupt current target" }, "COMPACTION_DIGEST_MISMATCH"],
      [{ projectId: "project-another" }, "INVALID_RECOVERY_CHECKPOINT"],
      [{ sessionId: "session-another" }, "INVALID_RECOVERY_CHECKPOINT"],
    ]) {
      fs.writeFileSync(integrated.file, JSON.stringify({ ...original, ...patch }));
      try { unchangedFailure(code); }
      finally { fs.writeFileSync(integrated.file, originalBytes); }
    }
    fs.writeFileSync(integrated.file, "{malformed routing metadata");
    try { unchangedFailure("INVALID_SESSION_RECOVERY_ARTIFACT", "INVALID_COMPACTION_CANON"); }
    finally { fs.writeFileSync(integrated.file, originalBytes); }
    const { checkpointId, checkpointDigest, ...payload } = original;
    payload.createdAt = new Date(Date.parse(payload.createdAt) + 1).toISOString();
    const duplicateDigest = sessionStateHash(payload);
    const duplicate = { ...payload, checkpointDigest: duplicateDigest, checkpointId: `checkpoint-${duplicateDigest.slice(0, 24)}` };
    const duplicateFile = path.join(root, ".head/sessions/ledger", `${duplicate.checkpointId}.json`);
    fs.writeFileSync(duplicateFile, JSON.stringify(duplicate));
    try { unchangedFailure("RUN_RESULT_INTEGRATION_MULTIPLE_CHECKPOINTS"); }
    finally { fs.unlinkSync(duplicateFile); }
    assert.deepEqual(fs.readFileSync(integrated.file), originalBytes);
  });
});
