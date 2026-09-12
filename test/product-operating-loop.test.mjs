import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { recordChangeSet } from "../scripts/lib/change-set.mjs";
import { compileContext } from "../scripts/lib/context-compiler.mjs";
import { createExecutionContract, createWholePlanSnapshot } from "../scripts/lib/execution-lineage.mjs";
import { initializeProject } from "../scripts/lib/head-core.mjs";
import {
  buildHeadContinuitySnapshot,
  inspectProductOperatingLoop,
  observeProductOutcome,
  prepareProductLearningNote,
  PRODUCT_OPERATING_LOOP_VERSION,
  productOperatingCanonicalJson,
  productOperatingDigest,
  proposeProductInitiative,
  recordProductHypothesis,
  recordProductSignal,
  reviewProductInitiative,
} from "../scripts/lib/product-operating-loop.mjs";
import { recommendOperatingLane } from "../scripts/lib/operating-lane.mjs";
import { finishRun, getPendingReviewContext, reviewRun, startRun } from "../scripts/lib/run-lineage.mjs";
import { buildWorldModel, inspectWorldModel, queryWorldTemporalGraph } from "../scripts/lib/world-model.mjs";
import { dispatch as dispatchMcp } from "../scripts/mcp-server.mjs";
import { runCommand } from "../scripts/head.mjs";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testParent = process.env.HEAD_AGENT_TEST_TMP || os.tmpdir();

function fixture() {
  fs.mkdirSync(testParent, { recursive: true });
  const root = fs.mkdtempSync(path.join(testParent, "head-agent-product-loop-"));
  initializeProject({ root, pluginRoot, runtimes: ["codex"] });
  const product = {
    schemaVersion: 1,
    featureGroups: [{ key: "coordination", name: "Coordination", description: "Whole outcome coordination" }],
    capabilities: [{ key: "continuity", name: "Continuity", description: "Preserve exact references" }],
    features: [{ key: "head-continuity", name: "HEAD continuity", description: "Portable exact-reference continuity", featureGroupKeys: ["coordination"], capabilityKeys: ["continuity"], governedBy: [] }],
    requirements: [], constraints: [], decisions: [],
  };
  fs.writeFileSync(path.join(root, ".head", "context", "product-model.json"), `${JSON.stringify(product, null, 2)}\n`);
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "feature.mjs"), "export const continuity = true;\n");
  return root;
}

test("connects the minimal Product Operating Loop while keeping Product Canon and recovery authority separate", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const productCanonFile = path.join(root, ".head", "context", "product-model.json");
  const canonBefore = fs.readFileSync(productCanonFile, "utf8");

  const signal = await recordProductSignal({ root, statement: "Operators lose the exact product decision context after a provider session is replaced.", source: "manual-observation", evidenceIds: ["evidence-session-replacement"] });
  assert.equal(signal.signal.epistemicClass, "observed-fact");
  const hypothesis = await recordProductHypothesis({ root, statement: "An on-demand exact-reference continuity view will reduce recovery ambiguity.", signalIds: [signal.signal.signalId], rationale: "The observation points to reference loss, not missing free-text summaries." });
  assert.equal(hypothesis.hypothesis.epistemicClass, "hypothesis");

  const proposed = await proposeProductInitiative({
    root,
    title: "Portable HEAD continuity",
    description: "Expose exact current identities without creating new recovery canon.",
    hypothesisIds: [hypothesis.hypothesis.hypothesisId],
    featureResolution: { kind: "existing-feature", featureKey: "head-continuity" },
  });
  assert.equal(proposed.initiativeCandidate.featureResolution.kind, "existing-feature");
  const reviewed = await reviewProductInitiative({ root, initiativeCandidateId: proposed.initiativeCandidate.initiativeCandidateId, disposition: "accept", rationale: "The bounded initiative preserves Session/Run recovery authority and addresses the observed gap." });
  assert.equal(reviewed.productCanonMutated, false);
  assert.equal(reviewed.reviewedInitiative.epistemicClass, "approved-decision");
  assert.equal(fs.readFileSync(productCanonFile, "utf8"), canonBefore);

  const candidateProposal = await proposeProductInitiative({
    root,
    title: "  Candidate-only product view  ",
    description: "  Candidate meaning must be normalized before its seed is frozen.  ",
    hypothesisIds: [hypothesis.hypothesis.hypothesisId],
    featureResolution: { kind: "candidate", feature: { key: "product-loop-view", name: "Product loop view", description: "Queryable product operations", capabilityKeys: ["continuity"] } },
  });
  assert.equal(candidateProposal.featureCandidate.authority, "candidate-not-product-canon");
  const candidateFile = path.join(root, ".head", "product-operations", "initiative-candidates", `${candidateProposal.initiativeCandidate.initiativeCandidateId}.json`);
  const frozenCandidateBytes = fs.readFileSync(candidateFile, "utf8");
  const candidateReview = await reviewProductInitiative({ root, initiativeCandidateId: candidateProposal.initiativeCandidate.initiativeCandidateId, disposition: "accept", rationale: "The Feature proposal stays a candidate and the Initiative is separately reviewed." });
  assert.equal(fs.readFileSync(candidateFile, "utf8"), frozenCandidateBytes);
  assert.equal(candidateReview.reviewedInitiative.featureResolution.featureCandidateId, candidateProposal.featureCandidate.featureCandidateId);
  assert.equal(fs.readFileSync(productCanonFile, "utf8"), canonBefore);
  const gapProposal = await proposeProductInitiative({ root, title: "Broad product learning", hypothesisIds: [hypothesis.hypothesis.hypothesisId], featureResolution: { kind: "gap", reason: "The initiative is broader than one Feature; do not force a one-to-one mapping." } });
  assert.equal(gapProposal.initiativeCandidate.featureResolution.kind, "gap");
  const deniedReview = await dispatchMcp({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "head_product_initiative_review", arguments: { project_root: root, initiative_candidate_id: gapProposal.initiativeCandidate.initiativeCandidateId, disposition: "reject", rationale: "The gap is intentionally unresolved.", confirm_user_review: false } } });
  assert.match(deniedReview.error.message, /explicit user confirmation/);

  const graph = inspectWorldModel({ root }).snapshot.temporalProvenanceGraph;
  assert.equal(graph.nodes.some((node) => node.kind === "ProductSignal" && node.nodeId === signal.signal.signalId), true);
  assert.equal(graph.nodes.some((node) => node.kind === "ReviewedProductInitiative" && node.nodeId === reviewed.reviewedInitiative.initiativeId), true);
  assert.equal(graph.nodes.some((node) => node.kind === "ProductFeatureCandidate" && node.nodeId === candidateProposal.featureCandidate.featureCandidateId), true);
  assert.equal(graph.edges.some((edge) => edge.type === "SUPPORTED_BY" && edge.from === hypothesis.hypothesis.hypothesisId && edge.to === signal.signal.signalId), true);
  assert.equal(graph.edges.some((edge) => edge.type === "PRODUCES" && edge.from === reviewed.reviewDecision.reviewDecisionId && edge.to === reviewed.reviewedInitiative.initiativeId), true);

  const capsule = compileContext({ root, task: "Implement the reviewed continuity initiative", budget: 32_768, persist: true });
  const plan = createWholePlanSnapshot({ root, objective: "Implement continuity with reviewed execution lineage", plan: [{ id: "implement", outcome: "Verified continuity implementation" }] });
  const contract = createExecutionContract({ root, wholePlanId: plan.artifact.wholePlanId, capsuleId: capsule.capsule.capsuleId, scope: "Change the fixture implementation", acceptanceCriteria: ["Return implementation evidence"] });
  startRun({ root, executionContractId: contract.artifact.executionContractId });
  fs.appendFileSync(path.join(root, "src", "feature.mjs"), "export const productLoop = true;\n");
  const finished = finishRun({ root, outcome: "Continuity implementation changed", evidence: [{ uri: "src/feature.mjs", digest: "fixture-product-loop", summary: "Implemented product loop" }], verification: [{ check: "fixture", status: "passed" }] });
  const reviewContext = getPendingReviewContext({ root });
  const executionReview = reviewRun({ root, reviewContextId: reviewContext.review.reviewContextId, disposition: "accept", rationale: "The implementation satisfies the bounded execution contract." });
  await buildWorldModel({ root, persist: true });
  const change = await recordChangeSet({ root, resultPacketId: finished.resultPacket.resultPacketId, reviewDecisionId: executionReview.reviewDecision.reviewDecisionId });
  const observation = await observeProductOutcome({ root, initiativeId: reviewed.reviewedInitiative.initiativeId, changeSetId: change.changeSet.changeSetId, statement: "The accepted ChangeSet now exposes exact continuity references in the fixture.", epistemicClass: "observed-fact", evidenceIds: ["fixture-product-loop"] });
  assert.equal(observation.featureStatusMutated, false);
  assert.equal(observation.successJudgmentRecorded, false);
  const outcomeGraph = queryWorldTemporalGraph({ root, query: "exact continuity references", kinds: ["OutcomeObservation", "ChangeSet", "ReviewedProductInitiative"], relations: ["OBSERVES"], includeUnreviewedCandidates: true, depth: 2, maxNodes: 100, maxEdges: 100 });
  assert.equal(outcomeGraph.nodes.some((node) => node.nodeId === observation.outcomeObservation.outcomeObservationId), true);
  assert.equal(inspectWorldModel({ root }).snapshot.temporalProvenanceGraph.edges.some((edge) => edge.type === "OBSERVES" && edge.from === observation.outcomeObservation.outcomeObservationId && edge.to === change.changeSet.changeSetId), true);

  const continuity = await buildHeadContinuitySnapshot({ root });
  assert.equal(continuity.snapshot.persisted, false);
  assert.equal(continuity.snapshot.recoveryAuthority, false);
  assert.equal(continuity.snapshot.reviewedProductInitiativeIds.includes(reviewed.reviewedInitiative.initiativeId), true);
  assert.deepEqual(continuity.snapshot.outcomeObservationIds, [observation.outcomeObservation.outcomeObservationId]);
  assert.equal(fs.existsSync(path.join(root, ".head", "continuity")), false);
  assert.equal(runCommand(["product-operating-status", root]).authority.graph, "derived-projection");
  const mcp = await dispatchMcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "head_continuity_snapshot", arguments: { project_root: root } } });
  assert.equal(mcp.result.structuredContent.snapshot.snapshotId, continuity.snapshot.snapshotId);
  assert.equal(inspectProductOperatingLoop({ root }).projection.outcomeObservations.length, 1);
});

test("keeps everyday learning ephemeral, defers Feature resolution to review, and caches only verified reads", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const productCanonFile = path.join(root, ".head", "context", "product-model.json");
  const canonBefore = fs.readFileSync(productCanonFile, "utf8");
  await buildWorldModel({ root, persist: true });
  const worldPointerFile = path.join(root, ".head", "world-model", "current.json");
  const pointerBefore = fs.readFileSync(worldPointerFile, "utf8");

  const note = prepareProductLearningNote({ root, statement: "A universal default should avoid persistence ritual.", epistemicClass: "hypothesis", rationale: "Same-Session reasoning does not cross an authority or recovery boundary." });
  assert.equal(note.status, "ephemeral");
  assert.equal(note.note.persisted, false);
  assert.equal(note.note.contentIdentityAssigned, false);
  assert.equal(note.persistence.recommended, false);
  assert.equal("requiredLane" in note, false);
  assert.equal(fs.readFileSync(worldPointerFile, "utf8"), pointerBefore);
  assert.equal(fs.existsSync(path.join(root, ".head", "product-operations")), false);

  const handoffNote = prepareProductLearningNote({ root, statement: "Another Run must rebut this observation.", epistemicClass: "observed-fact", referencedByAnotherRun: true, needsRebuttal: true });
  assert.deepEqual(handoffNote.persistence.reasons, ["rebuttal-or-audit-needed", "referenced-by-another-run"]);

  assert.equal(recommendOperatingLane({ root }).lane, "observe");
  const sessionLane = recommendOperatingLane({ root, intent: "execute", providerInvocation: true, workspaceEffect: "reversible" });
  assert.equal(sessionLane.lane, "session");
  assert.equal(sessionLane.minimumContracts.includes("WholePlanSnapshot"), false);
  const runLane = recommendOperatingLane({ root, intent: "execute", dependencyCount: 2, failureBranches: true });
  assert.equal(runLane.lane, "run");
  assert.equal(runLane.minimumContracts.includes("FreshHeadReview"), true);
  const authorityLane = recommendOperatingLane({ root, externalWrite: true });
  assert.equal(authorityLane.lane, "authority");
  assert.equal(authorityLane.minimumContracts.includes("explicit-user-decision-at-affected-boundary"), true);
  assert.equal(authorityLane.minimumContracts.includes("WholePlanSnapshot"), false);
  assert.equal(recommendOperatingLane({ root, usesCredentials: true }).lane, "observe");
  const secondOpinion = recommendOperatingLane({ root, intent: "observe", workspaceEffect: "none", dependencyCount: 0, providerInvocation: true, independentReview: true });
  assert.equal(secondOpinion.lane, "session");
  assert.equal(secondOpinion.minimumContracts.includes("WholePlanSnapshot"), false);
  assert.equal(secondOpinion.reasons.includes("bounded-independent-review"), true);
  assert.equal(recommendOperatingLane({ root, independentReview: true, dependencyCount: 2 }).lane, "run");
  assert.equal(recommendOperatingLane({ root, independentReview: true, failureBranches: true }).lane, "run");
  const approvedWrite = recommendOperatingLane({ root, externalWrite: true, authorizationStatus: "within-approved-scope" });
  assert.equal(approvedWrite.lane, "session");
  assert.equal(approvedWrite.authorizationAssessment.permissionGranted, false);
  assert.equal(approvedWrite.minimumContracts.includes("WholePlanSnapshot"), false);
  assert.equal(recommendOperatingLane({ root, externalWrite: true, authorizationStatus: "within-approved-scope", irreversible: true }).lane, "run");
  assert.equal(recommendOperatingLane({ root, productCanonMutation: true, authorizationStatus: "within-approved-scope" }).lane, "authority");
  assert.equal(recommendOperatingLane({ root, authorizationStatus: "requires-user-decision" }).lane, "authority");
  assert.throws(() => recommendOperatingLane({ root, authorizationStatus: "assume-approved" }), { code: "INVALID_OPERATING_LANE_INPUT" });
  assert.equal(runCommand(["help"]).commands.includes("head product-signal-record <project> --input <signal.json>"), false);
  assert.equal(runCommand(["help"]).laneRecommendationRequired, false);
  assert.equal(runCommand(["help-all"]).commands.includes("head product-signal-record <project> --input <signal.json>"), true);

  const proposed = await proposeProductInitiative({
    root,
    title: "Relax everyday product learning",
    description: "Persist only at a real handoff, audit, product-state, or review boundary.",
    reasoning: "Observed and hypothetical notes can stay ephemeral until the user reviews an inferred Initiative.",
  });
  assert.deepEqual(proposed.initiativeCandidate.hypothesisIds, []);
  assert.equal(proposed.initiativeCandidate.featureResolution, null);
  assert.equal(proposed.featureCandidate, null);
  const candidateFile = path.join(root, ".head", "product-operations", "initiative-candidates", `${proposed.initiativeCandidate.initiativeCandidateId}.json`);
  const candidateBytes = fs.readFileSync(candidateFile, "utf8");
  assert.equal(fs.existsSync(path.join(root, ".head", "product-operations", "feature-candidates")), false);

  await assert.rejects(
    reviewProductInitiative({ root, initiativeCandidateId: proposed.initiativeCandidate.initiativeCandidateId, disposition: "accept", rationale: "Resolution is intentionally missing." }),
    (error) => error.code === "PRODUCT_INITIATIVE_REVIEW_FEATURE_RESOLUTION_REQUIRED",
  );
  assert.equal(inspectProductOperatingLoop({ root, fresh: true }).projection.initiativeReviews.length, 0);

  const denied = await dispatchMcp({ jsonrpc: "2.0", id: 20, method: "tools/call", params: { name: "head_product_initiative_review", arguments: { project_root: root, initiative_candidate_id: proposed.initiativeCandidate.initiativeCandidateId, disposition: "accept", rationale: "The user must own this decision.", confirm_user_review: false, feature_resolution: { kind: "candidate", feature: { key: "relaxed-product-learning", name: "Relaxed product learning", capability_keys: ["continuity"] } } } } });
  assert.match(denied.error.message, /explicit user confirmation/);
  const accepted = await dispatchMcp({ jsonrpc: "2.0", id: 21, method: "tools/call", params: { name: "head_product_initiative_review", arguments: { project_root: root, initiative_candidate_id: proposed.initiativeCandidate.initiativeCandidateId, disposition: "accept", rationale: "The reviewed Initiative preserves authority while removing ordinary persistence ritual.", confirm_user_review: true, feature_resolution: { kind: "candidate", feature: { key: "relaxed-product-learning", name: "Relaxed product learning", capability_keys: ["continuity"] } } } } });
  const reviewed = accepted.result.structuredContent;
  assert.equal(reviewed.status, "initiative_accepted");
  assert.equal(fs.readFileSync(candidateFile, "utf8"), candidateBytes);
  assert.equal(reviewed.reviewedInitiative.reasoning, proposed.initiativeCandidate.reasoning);
  assert.equal(reviewed.reviewedInitiative.featureResolution.featureCandidateId, reviewed.featureCandidate.featureCandidateId);
  assert.equal(fs.readFileSync(productCanonFile, "utf8"), canonBefore);

  const firstStatus = inspectProductOperatingLoop({ root, fresh: true });
  const cachedStatus = inspectProductOperatingLoop({ root });
  assert.equal(firstStatus.readVerification.mode, "fresh-full-verification");
  assert.equal(cachedStatus.readVerification.mode, "cached-verified-snapshot");
  assert.equal(cachedStatus.projection.projectionInputId, firstStatus.projection.projectionInputId);
  const firstContinuity = await buildHeadContinuitySnapshot({ root, fresh: true });
  const cachedContinuity = await buildHeadContinuitySnapshot({ root });
  assert.equal(firstContinuity.readVerification.productOperating.mode, "fresh-full-verification");
  assert.equal(cachedContinuity.readVerification.productOperating.mode, "cached-verified-snapshot");
  assert.equal(cachedContinuity.readVerification.worldModel.mode, "cached-verified-snapshot");
  assert.equal(cachedContinuity.snapshot.snapshotId, firstContinuity.snapshot.snapshotId);
  assert.equal(cachedContinuity.snapshot.persisted, false);
  assert.equal(cachedContinuity.snapshot.recoveryAuthority, false);
  assert.equal(runCommand(["product-operating-status", root, "--fresh"]).readVerification.mode, "fresh-full-verification");
  assert.equal((await runCommand(["head-continuity", root, "--fresh"])).readVerification.productOperating.mode, "fresh-full-verification");

  await recordProductSignal({ root, statement: "A write must invalidate the verified read cache." });
  assert.equal(inspectProductOperatingLoop({ root }).readVerification.mode, "fresh-full-verification");

  const noteInput = path.join(root, "note.json");
  fs.writeFileSync(noteInput, JSON.stringify({ statement: "CLI notes are ephemeral.", epistemicClass: "observed-fact" }));
  assert.equal(runCommand(["product-note", root, "--input", noteInput]).note.persisted, false);
  const laneInput = path.join(root, "lane.json");
  fs.writeFileSync(laneInput, JSON.stringify({ intent: "execute", workspaceEffect: "reversible" }));
  assert.equal(runCommand(["operating-lane-recommend", root, "--input", laneInput]).lane, "session");
  const noteMcp = await dispatchMcp({ jsonrpc: "2.0", id: 22, method: "tools/call", params: { name: "head_product_note", arguments: { project_root: root, statement: "MCP notes are ephemeral.", epistemic_class: "hypothesis" } } });
  assert.equal(noteMcp.result.structuredContent.note.persisted, false);
  const graph = inspectWorldModel({ root }).snapshot.temporalProvenanceGraph;
  assert.equal(graph.nodes.some((node) => node.statement === "CLI notes are ephemeral." || node.statement === "MCP notes are ephemeral."), false);

  const tamperedCandidate = JSON.parse(candidateBytes);
  tamperedCandidate.title = "Tampered cached candidate";
  fs.writeFileSync(candidateFile, `${JSON.stringify(tamperedCandidate, null, 2)}\n`);
  assert.throws(() => inspectProductOperatingLoop({ root }), (error) => error.code === "PRODUCT_OPERATING_DIGEST_MISMATCH");
  await assert.rejects(
    reviewProductInitiative({ root, initiativeCandidateId: proposed.initiativeCandidate.initiativeCandidateId, disposition: "reject", rationale: "A cached read must never replace review-time candidate verification." }),
    (error) => error.code === "PRODUCT_OPERATING_DIGEST_MISMATCH",
  );
});

function productArtifact(payload, prefix, idField, hashField) {
  const hash = productOperatingDigest(productOperatingCanonicalJson(payload));
  return { ...payload, [idField]: `${prefix}-${hash.slice(0, 24)}`, [hashField]: hash };
}

test("recovers an exact accepted Initiative after the final create-only write fails and rejects divergent retries", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const proposed = await proposeProductInitiative({ root, title: "Recover an accepted initiative", reasoning: "A durable user decision must remain replay-safe after a transient output failure." });
  const request = {
    root,
    initiativeCandidateId: proposed.initiativeCandidate.initiativeCandidateId,
    disposition: "accept",
    rationale: "Accept this exact initiative and its explicit Feature gap.",
    featureResolution: { kind: "gap", reason: "The initiative spans more than one current Feature." },
  };
  const reviewedDirectory = path.join(root, ".head", "product-operations", "reviewed-initiatives");
  const originalLink = fs.linkSync;
  let injected = 0;
  fs.linkSync = function (source, destination, ...rest) {
    if (!injected && path.dirname(path.resolve(String(destination))) === reviewedDirectory) {
      injected += 1;
      throw Object.assign(new Error("Injected one-time EIO at ReviewedProductInitiative publication"), { code: "EIO" });
    }
    return originalLink.call(fs, source, destination, ...rest);
  };
  try {
    await assert.rejects(() => reviewProductInitiative(request), (error) => error.code === "EIO");
  } finally { fs.linkSync = originalLink; }
  assert.equal(injected, 1);
  const reviewDirectory = path.join(root, ".head", "product-operations", "initiative-reviews");
  const decisionFiles = fs.readdirSync(reviewDirectory).filter((name) => name.endsWith(".json"));
  assert.equal(decisionFiles.length, 1);
  const durableDecision = JSON.parse(fs.readFileSync(path.join(reviewDirectory, decisionFiles[0]), "utf8"));
  assert.equal(durableDecision.initiativeCandidateHash, proposed.initiativeCandidate.initiativeCandidateHash);
  assert.deepEqual(durableDecision.featureResolution, request.featureResolution);
  assert.equal(durableDecision.featureCandidate, null);
  assert.equal(fs.existsSync(reviewedDirectory) ? fs.readdirSync(reviewedDirectory).length : 0, 0);

  const recovered = await reviewProductInitiative(request);
  assert.equal(recovered.status, "initiative_accepted");
  assert.equal(recovered.persistenceStatus, "recovered");
  assert.equal(inspectProductOperatingLoop({ root, fresh: true }).projection.reviewedInitiatives.length, 1);
  const decisionBytes = fs.readFileSync(path.join(reviewDirectory, decisionFiles[0]), "utf8");
  const reviewedFile = path.join(reviewedDirectory, `${recovered.reviewedInitiative.initiativeId}.json`);
  const reviewedBytes = fs.readFileSync(reviewedFile, "utf8");
  await assert.rejects(() => reviewProductInitiative({ ...request, rationale: "A divergent replacement rationale." }), (error) => error.code === "PRODUCT_INITIATIVE_ALREADY_REVIEWED");
  await assert.rejects(() => reviewProductInitiative({ ...request, featureResolution: { kind: "gap", reason: "A different Feature choice." } }), (error) => error.code === "PRODUCT_INITIATIVE_ALREADY_REVIEWED");
  assert.equal(fs.readFileSync(path.join(reviewDirectory, decisionFiles[0]), "utf8"), decisionBytes);
  assert.equal(fs.readFileSync(reviewedFile, "utf8"), reviewedBytes);
  assert.equal(fs.readdirSync(reviewDirectory).filter((name) => name.endsWith(".json")).length, 1);
  assert.equal(fs.readdirSync(reviewedDirectory).filter((name) => name.endsWith(".json")).length, 1);
  assert.equal(fs.readdirSync(reviewedDirectory).some((name) => name.endsWith(".tmp")), false);
});

test("keeps completed legacy Initiative reviews readable but never guesses a missing legacy Feature selection", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const proposed = await proposeProductInitiative({ root, title: "Legacy review compatibility", reasoning: "Older digest-valid records remain audit-readable." });
  const request = {
    root,
    initiativeCandidateId: proposed.initiativeCandidate.initiativeCandidateId,
    disposition: "accept",
    rationale: "Accept the legacy-compatible test initiative.",
    featureResolution: { kind: "gap", reason: "No exact current Feature represents this test initiative." },
  };
  const completed = await reviewProductInitiative(request);
  const reviewDirectory = path.join(root, ".head", "product-operations", "initiative-reviews");
  const reviewedDirectory = path.join(root, ".head", "product-operations", "reviewed-initiatives");
  const currentDecisionFile = path.join(reviewDirectory, `${completed.reviewDecision.reviewDecisionId}.json`);
  const currentReviewedFile = path.join(reviewedDirectory, `${completed.reviewedInitiative.initiativeId}.json`);
  const legacyDecisionPayload = structuredClone(completed.reviewDecision);
  delete legacyDecisionPayload.reviewDecisionId;
  delete legacyDecisionPayload.reviewDecisionHash;
  delete legacyDecisionPayload.initiativeCandidateHash;
  delete legacyDecisionPayload.featureResolution;
  delete legacyDecisionPayload.featureCandidate;
  legacyDecisionPayload.protocol.version = "0.3.0";
  const legacyDecision = productArtifact(legacyDecisionPayload, "product-initiative-review", "reviewDecisionId", "reviewDecisionHash");
  const legacyReviewedPayload = structuredClone(completed.reviewedInitiative);
  delete legacyReviewedPayload.initiativeId;
  delete legacyReviewedPayload.initiativeHash;
  legacyReviewedPayload.protocol.version = "0.3.0";
  legacyReviewedPayload.reviewDecisionId = legacyDecision.reviewDecisionId;
  const legacyReviewed = productArtifact(legacyReviewedPayload, "reviewed-product-initiative", "initiativeId", "initiativeHash");
  fs.unlinkSync(currentDecisionFile);
  fs.unlinkSync(currentReviewedFile);
  fs.writeFileSync(path.join(reviewDirectory, `${legacyDecision.reviewDecisionId}.json`), `${JSON.stringify(legacyDecision, null, 2)}\n`);
  fs.writeFileSync(path.join(reviewedDirectory, `${legacyReviewed.initiativeId}.json`), `${JSON.stringify(legacyReviewed, null, 2)}\n`);
  const legacyProjection = inspectProductOperatingLoop({ root, fresh: true }).projection;
  assert.equal(legacyProjection.initiativeReviews[0].protocol.version, "0.3.0");
  const exactReplay = await reviewProductInitiative(request);
  assert.equal(exactReplay.persistenceStatus, "existing");
  assert.equal(exactReplay.reviewedInitiative.initiativeId, legacyReviewed.initiativeId);
  fs.unlinkSync(path.join(reviewedDirectory, `${legacyReviewed.initiativeId}.json`));
  await assert.rejects(() => reviewProductInitiative(request), (error) => error.code === "PRODUCT_INITIATIVE_REVIEW_RECOVERY_UNAVAILABLE" && /create a new candidate/.test(error.message));
});

test("uses legacy frozen Feature evidence for review and missing-output recovery without another user gate", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = JSON.parse(fs.readFileSync(path.join(root, ".head", "project.json"), "utf8"));
  const candidateMeaning = { projectId: project.projectId, title: "Legacy frozen Feature candidate", description: "", hypothesisIds: [] };
  const legacySeed = productOperatingDigest(productOperatingCanonicalJson(candidateMeaning));
  const featureCandidatePayload = {
    schemaVersion: 1,
    kind: "ProductFeatureCandidate",
    protocol: { name: "head-agent-core-product-operating-loop", version: "0.1.0" },
    projectId: project.projectId,
    initiativeCandidateSeed: legacySeed,
    feature: { key: "legacy-frozen-feature", name: "Legacy frozen Feature", description: "", capabilityKeys: [] },
    epistemicClass: "inferred-meaning",
    authority: "candidate-not-product-canon",
    instructionAuthority: false,
    promotionAuthority: false,
  };
  const featureCandidate = productArtifact(featureCandidatePayload, "product-feature-candidate", "featureCandidateId", "featureCandidateHash");
  const initiativePayload = {
    schemaVersion: 1,
    kind: "ProductInitiativeCandidate",
    protocol: { name: "head-agent-core-product-operating-loop", version: "0.1.0" },
    projectId: project.projectId,
    title: candidateMeaning.title,
    description: candidateMeaning.description,
    reasoning: "Legacy reasoning is intentionally excluded from the 0.1.0 Feature seed.",
    hypothesisIds: [],
    featureResolution: { kind: "candidate", featureCandidateId: featureCandidate.featureCandidateId },
    epistemicClass: "inferred-meaning",
    authority: "candidate-not-approved-decision",
    instructionAuthority: false,
    promotionAuthority: false,
  };
  const initiative = productArtifact(initiativePayload, "product-initiative-candidate", "initiativeCandidateId", "initiativeCandidateHash");
  const featureDirectory = path.join(root, ".head", "product-operations", "feature-candidates");
  const candidateDirectory = path.join(root, ".head", "product-operations", "initiative-candidates");
  fs.mkdirSync(featureDirectory, { recursive: true });
  fs.mkdirSync(candidateDirectory, { recursive: true });
  fs.writeFileSync(path.join(featureDirectory, `${featureCandidate.featureCandidateId}.json`), `${JSON.stringify(featureCandidate, null, 2)}\n`);
  fs.writeFileSync(path.join(candidateDirectory, `${initiative.initiativeCandidateId}.json`), `${JSON.stringify(initiative, null, 2)}\n`);
  const request = { root, initiativeCandidateId: initiative.initiativeCandidateId, disposition: "accept", rationale: "Accept the exact frozen legacy Feature candidate." };
  const accepted = await reviewProductInitiative(request);
  assert.equal(accepted.status, "initiative_accepted");
  assert.equal(accepted.reviewDecision.featureCandidate.featureCandidateId, featureCandidate.featureCandidateId);

  const reviewDirectory = path.join(root, ".head", "product-operations", "initiative-reviews");
  const reviewedDirectory = path.join(root, ".head", "product-operations", "reviewed-initiatives");
  const legacyDecisionPayload = structuredClone(accepted.reviewDecision);
  delete legacyDecisionPayload.reviewDecisionId;
  delete legacyDecisionPayload.reviewDecisionHash;
  delete legacyDecisionPayload.initiativeCandidateHash;
  delete legacyDecisionPayload.featureResolution;
  delete legacyDecisionPayload.featureCandidate;
  legacyDecisionPayload.protocol.version = "0.3.0";
  const legacyDecision = productArtifact(legacyDecisionPayload, "product-initiative-review", "reviewDecisionId", "reviewDecisionHash");
  fs.unlinkSync(path.join(reviewDirectory, `${accepted.reviewDecision.reviewDecisionId}.json`));
  fs.unlinkSync(path.join(reviewedDirectory, `${accepted.reviewedInitiative.initiativeId}.json`));
  fs.writeFileSync(path.join(reviewDirectory, `${legacyDecision.reviewDecisionId}.json`), `${JSON.stringify(legacyDecision, null, 2)}\n`);
  const recovered = await reviewProductInitiative(request);
  assert.equal(recovered.persistenceStatus, "recovered");
  assert.equal(recovered.reviewedInitiative.featureResolution.featureCandidateId, featureCandidate.featureCandidateId);
  assert.equal(inspectProductOperatingLoop({ root, fresh: true }).projection.reviewedInitiatives.length, 1);
});

test("replays an exact legacy rejection without treating its frozen Feature proposal as approved", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const proposed = await proposeProductInitiative({
    root,
    title: "Legacy rejected frozen Feature gap",
    reasoning: "A rejected proposal retains its evidence without adopting the proposed Feature resolution.",
    featureResolution: { kind: "gap", reason: "This proposal spans current Features." },
  });
  const request = {
    root,
    initiativeCandidateId: proposed.initiativeCandidate.initiativeCandidateId,
    disposition: "reject",
    rationale: "Do not adopt this Product Initiative.",
  };
  const rejected = await reviewProductInitiative(request);
  const reviewDirectory = path.join(root, ".head", "product-operations", "initiative-reviews");
  const currentDecisionFile = path.join(reviewDirectory, `${rejected.reviewDecision.reviewDecisionId}.json`);
  const legacyDecisionPayload = structuredClone(rejected.reviewDecision);
  delete legacyDecisionPayload.reviewDecisionId;
  delete legacyDecisionPayload.reviewDecisionHash;
  delete legacyDecisionPayload.initiativeCandidateHash;
  delete legacyDecisionPayload.featureResolution;
  delete legacyDecisionPayload.featureCandidate;
  legacyDecisionPayload.protocol.version = "0.3.0";
  const legacyDecision = productArtifact(legacyDecisionPayload, "product-initiative-review", "reviewDecisionId", "reviewDecisionHash");
  fs.unlinkSync(currentDecisionFile);
  fs.writeFileSync(path.join(reviewDirectory, `${legacyDecision.reviewDecisionId}.json`), `${JSON.stringify(legacyDecision, null, 2)}\n`);

  const replay = await reviewProductInitiative(request);
  assert.equal(replay.status, "initiative_rejected");
  assert.equal(replay.persistenceStatus, "existing");
  assert.equal(replay.reviewDecision.reviewDecisionId, legacyDecision.reviewDecisionId);
  assert.equal(replay.featureCandidate, null);
  assert.equal(inspectProductOperatingLoop({ root, fresh: true }).projection.reviewedInitiatives.length, 0);
  assert.equal(fs.readdirSync(reviewDirectory).filter((name) => name.endsWith(".json")).length, 1);
});

test("rejects Product Operating size, count, total-byte, and compound-output limits before durable writes", async (t) => {
  const roots = [];
  t.after(() => { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }); });

  const oversizedRoot = fixture(); roots.push(oversizedRoot);
  const oversizedSignals = path.join(oversizedRoot, ".head", "product-operations", "signals");
  await assert.rejects(() => recordProductSignal({ root: oversizedRoot, statement: "x".repeat(1024 * 1024) }), (error) => error.code === "PRODUCT_OPERATING_LIMIT");
  assert.equal(fs.existsSync(oversizedSignals), false);
  const laterSignal = await recordProductSignal({ root: oversizedRoot, statement: "A later bounded signal remains usable." });
  assert.equal(laterSignal.status, "recorded");
  assert.equal(inspectProductOperatingLoop({ root: oversizedRoot, fresh: true }).projection.signals.length, 1);

  const countRoot = fixture(); roots.push(countRoot);
  const countDirectory = path.join(countRoot, ".head", "product-operations", "signals");
  fs.mkdirSync(countDirectory, { recursive: true });
  for (let index = 0; index < 512; index += 1) fs.writeFileSync(path.join(countDirectory, `count-${String(index).padStart(3, "0")}.json`), "{}\n");
  await assert.rejects(() => recordProductSignal({ root: countRoot, statement: "The 513th artifact must not be written." }), (error) => error.code === "PRODUCT_OPERATING_LIMIT");
  assert.equal(fs.readdirSync(countDirectory).filter((name) => name.endsWith(".json")).length, 512);

  const totalRoot = fixture(); roots.push(totalRoot);
  const totalDirectory = path.join(totalRoot, ".head", "product-operations", "signals");
  fs.mkdirSync(totalDirectory, { recursive: true });
  for (let index = 0; index < 32; index += 1) {
    const file = path.join(totalDirectory, `total-${String(index).padStart(2, "0")}.json`);
    fs.closeSync(fs.openSync(file, "wx"));
    fs.truncateSync(file, 1024 * 1024);
  }
  await assert.rejects(() => recordProductSignal({ root: totalRoot, statement: "A write beyond the existing total-byte bound must not persist." }), (error) => error.code === "PRODUCT_OPERATING_LIMIT");
  assert.equal(fs.readdirSync(totalDirectory).filter((name) => name.endsWith(".json")).length, 32);

  const compoundRoot = fixture(); roots.push(compoundRoot);
  const project = JSON.parse(fs.readFileSync(path.join(compoundRoot, ".head", "project.json"), "utf8"));
  const baseCandidate = {
    schemaVersion: 1,
    kind: "ProductInitiativeCandidate",
    protocol: { name: "head-agent-core-product-operating-loop", version: PRODUCT_OPERATING_LOOP_VERSION },
    projectId: project.projectId,
    title: "Bounded compound review output",
    description: "",
    reasoning: "x",
    hypothesisIds: [],
    featureResolution: null,
    epistemicClass: "inferred-meaning",
    authority: "candidate-not-approved-decision",
    instructionAuthority: false,
    promotionAuthority: false,
  };
  const probeCandidate = productArtifact(baseCandidate, "product-initiative-candidate", "initiativeCandidateId", "initiativeCandidateHash");
  const probeBytes = Buffer.byteLength(`${JSON.stringify(probeCandidate, null, 2)}\n`);
  baseCandidate.reasoning = "x".repeat(1 + (1024 * 1024 - 1 - probeBytes));
  const nearLimitCandidate = productArtifact(baseCandidate, "product-initiative-candidate", "initiativeCandidateId", "initiativeCandidateHash");
  const candidateBytes = `${JSON.stringify(nearLimitCandidate, null, 2)}\n`;
  assert.equal(Buffer.byteLength(candidateBytes), 1024 * 1024 - 1);
  const candidateDirectory = path.join(compoundRoot, ".head", "product-operations", "initiative-candidates");
  fs.mkdirSync(candidateDirectory, { recursive: true });
  fs.writeFileSync(path.join(candidateDirectory, `${nearLimitCandidate.initiativeCandidateId}.json`), candidateBytes);
  const decisionDirectory = path.join(compoundRoot, ".head", "product-operations", "initiative-reviews");
  await assert.rejects(() => reviewProductInitiative({
    root: compoundRoot,
    initiativeCandidateId: nearLimitCandidate.initiativeCandidateId,
    disposition: "accept",
    rationale: "The final reviewed artifact should exceed its bound.",
    featureResolution: { kind: "gap", reason: "Synthetic bound test." },
  }), (error) => error.code === "PRODUCT_OPERATING_LIMIT");
  assert.equal(fs.existsSync(decisionDirectory), false);
});

test("serializes Product Operating writers without turning review or capacity checks into user gates", async (t) => {
  const reviewRoot = fixture();
  const countRoot = fixture();
  t.after(() => {
    fs.rmSync(reviewRoot, { recursive: true, force: true });
    fs.rmSync(countRoot, { recursive: true, force: true });
  });

  const rejectedCandidate = await proposeProductInitiative({
    root: reviewRoot,
    title: "Reject a frozen Feature gap normally",
    reasoning: "A rejected Initiative does not adopt its candidate Feature resolution.",
    featureResolution: { kind: "gap", reason: "This candidate intentionally has no one-to-one Feature." },
  });
  const rejected = await reviewProductInitiative({ root: reviewRoot, initiativeCandidateId: rejectedCandidate.initiativeCandidate.initiativeCandidateId, disposition: "reject", rationale: "Do not adopt this Initiative." });
  assert.equal(rejected.status, "initiative_rejected");
  assert.equal(rejected.reviewDecision.featureResolution, null);
  assert.equal(inspectProductOperatingLoop({ root: reviewRoot, fresh: true }).projection.reviewedInitiatives.length, 0);

  const competingCandidate = await proposeProductInitiative({
    root: reviewRoot,
    title: "Competing review decisions",
    reasoning: "Only one exact user decision may become durable for one candidate.",
    featureResolution: { kind: "gap", reason: "Synthetic concurrency scope." },
  });
  const competing = await Promise.allSettled([
    reviewProductInitiative({ root: reviewRoot, initiativeCandidateId: competingCandidate.initiativeCandidate.initiativeCandidateId, disposition: "accept", rationale: "Accept the first exact decision." }),
    reviewProductInitiative({ root: reviewRoot, initiativeCandidateId: competingCandidate.initiativeCandidate.initiativeCandidateId, disposition: "reject", rationale: "Reject through a competing decision." }),
  ]);
  assert.equal(competing.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(competing.filter((item) => item.status === "rejected" && item.reason.code === "PRODUCT_INITIATIVE_ALREADY_REVIEWED").length, 1);
  const reviewProjection = inspectProductOperatingLoop({ root: reviewRoot, fresh: true }).projection;
  assert.equal(reviewProjection.initiativeReviews.filter((item) => item.initiativeCandidateId === competingCandidate.initiativeCandidate.initiativeCandidateId).length, 1);

  const project = JSON.parse(fs.readFileSync(path.join(countRoot, ".head", "project.json"), "utf8"));
  const signalsDirectory = path.join(countRoot, ".head", "product-operations", "signals");
  fs.mkdirSync(signalsDirectory, { recursive: true });
  for (let index = 0; index < 511; index += 1) {
    const payload = {
      schemaVersion: 1,
      kind: "ProductSignal",
      protocol: { name: "head-agent-core-product-operating-loop", version: PRODUCT_OPERATING_LOOP_VERSION },
      projectId: project.projectId,
      statement: `Seed signal ${index}.`,
      observedAt: "2026-09-07T00:00:00.000Z",
      source: "",
      evidenceIds: [],
      epistemicClass: "observed-fact",
      authority: "non-authoritative-observation",
      instructionAuthority: false,
      promotionAuthority: false,
    };
    const signal = productArtifact(payload, "product-signal", "signalId", "signalHash");
    fs.writeFileSync(path.join(signalsDirectory, `${signal.signalId}.json`), `${JSON.stringify(signal, null, 2)}\n`);
  }
  const bounded = await Promise.allSettled([
    recordProductSignal({ root: countRoot, statement: "Concurrent bounded signal A.", observedAt: "2026-09-07T00:00:01.000Z" }),
    recordProductSignal({ root: countRoot, statement: "Concurrent bounded signal B.", observedAt: "2026-09-07T00:00:02.000Z" }),
  ]);
  assert.equal(bounded.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(bounded.filter((item) => item.status === "rejected" && item.reason.code === "PRODUCT_OPERATING_LIMIT").length, 1);
  assert.equal(fs.readdirSync(signalsDirectory).filter((name) => name.endsWith(".json")).length, 512);
  assert.equal(inspectProductOperatingLoop({ root: countRoot, fresh: true }).projection.signals.length, 512);
});

test("serializes competing Product decisions and capacity checks across independent Node writers", async (t) => {
  const reviewRoot = fixture();
  const countRoot = fixture();
  const children = [];
  t.after(() => {
    for (const child of children) if (child.exitCode == null && child.signalCode == null) child.kill();
    fs.rmSync(reviewRoot, { recursive: true, force: true });
    fs.rmSync(countRoot, { recursive: true, force: true });
  });
  const productUrl = pathToFileURL(path.join(pluginRoot, "scripts", "lib", "product-operating-loop.mjs")).href;
  const workerSource = `
    import fs from "node:fs";
    import { setTimeout as delay } from "node:timers/promises";
    import * as product from ${JSON.stringify(productUrl)};
    const request = JSON.parse(process.argv[1]);
    while (!fs.existsSync(request.startFile)) await delay(2);
    try {
      const result = await product[request.method](request.options);
      process.stdout.write(JSON.stringify({ status: result.status, persistenceStatus: result.persistenceStatus || null }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ code: error.code || null, message: error.message }));
      process.exitCode = 2;
    }
  `;
  function launch(startFile, method, options) {
    const child = spawn(process.execPath, ["--input-type=module", "-e", workerSource, JSON.stringify({ startFile, method, options })], { cwd: pluginRoot, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    children.push(child);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const started = new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    const completed = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        try { resolve({ code, signal, stderr, result: JSON.parse(stdout) }); }
        catch (error) { reject(Object.assign(error, { stdout, stderr, code, signal })); }
      });
    });
    return { started, completed };
  }
  async function race(startFile, calls) {
    const workers = calls.map((call) => launch(startFile, call.method, call.options));
    try { await Promise.all(workers.map((worker) => worker.started)); }
    catch (error) {
      if (error?.code === "EPERM") { t.skip("The local sandbox forbids nested process creation; same-process serialization still runs."); return null; }
      throw error;
    }
    fs.writeFileSync(startFile, "start\n", { flag: "wx" });
    return Promise.all(workers.map((worker) => worker.completed));
  }

  const proposed = await proposeProductInitiative({
    root: reviewRoot,
    title: "Cross-process competing review",
    reasoning: "Only one exact user decision may become durable.",
    featureResolution: { kind: "gap", reason: "Synthetic process-race scope." },
  });
  const reviewStart = path.join(reviewRoot, "start-product-review-writers.flag");
  const reviews = await race(reviewStart, [
    { method: "reviewProductInitiative", options: { root: reviewRoot, initiativeCandidateId: proposed.initiativeCandidate.initiativeCandidateId, disposition: "accept", rationale: "Accept the exact candidate." } },
    { method: "reviewProductInitiative", options: { root: reviewRoot, initiativeCandidateId: proposed.initiativeCandidate.initiativeCandidateId, disposition: "reject", rationale: "Reject the exact candidate." } },
  ]);
  if (reviews == null) return;
  assert.equal(reviews.filter((item) => item.code === 0 && item.result.status === "initiative_accepted").length
    + reviews.filter((item) => item.code === 0 && item.result.status === "initiative_rejected").length, 1);
  assert.equal(reviews.filter((item) => item.code === 2 && item.result.code === "PRODUCT_INITIATIVE_ALREADY_REVIEWED").length, 1);
  assert.equal(reviews.every((item) => item.signal === null && item.stderr === ""), true);
  assert.equal(inspectProductOperatingLoop({ root: reviewRoot, fresh: true }).projection.initiativeReviews.length, 1);

  const project = JSON.parse(fs.readFileSync(path.join(countRoot, ".head", "project.json"), "utf8"));
  const signalsDirectory = path.join(countRoot, ".head", "product-operations", "signals");
  fs.mkdirSync(signalsDirectory, { recursive: true });
  for (let index = 0; index < 511; index += 1) {
    const payload = {
      schemaVersion: 1,
      kind: "ProductSignal",
      protocol: { name: "head-agent-core-product-operating-loop", version: PRODUCT_OPERATING_LOOP_VERSION },
      projectId: project.projectId,
      statement: `Process seed signal ${index}.`,
      observedAt: "2026-09-07T00:00:00.000Z",
      source: "",
      evidenceIds: [],
      epistemicClass: "observed-fact",
      authority: "non-authoritative-observation",
      instructionAuthority: false,
      promotionAuthority: false,
    };
    const signal = productArtifact(payload, "product-signal", "signalId", "signalHash");
    fs.writeFileSync(path.join(signalsDirectory, `${signal.signalId}.json`), `${JSON.stringify(signal, null, 2)}\n`);
  }
  const countStart = path.join(countRoot, "start-product-capacity-writers.flag");
  const signals = await race(countStart, [
    { method: "recordProductSignal", options: { root: countRoot, statement: "Cross-process bounded signal A.", observedAt: "2026-09-07T00:00:01.000Z" } },
    { method: "recordProductSignal", options: { root: countRoot, statement: "Cross-process bounded signal B.", observedAt: "2026-09-07T00:00:02.000Z" } },
  ]);
  assert.equal(signals.filter((item) => item.code === 0 && item.result.status === "recorded").length, 1);
  assert.equal(signals.filter((item) => item.code === 2 && item.result.code === "PRODUCT_OPERATING_LIMIT").length, 1);
  assert.equal(signals.every((item) => item.signal === null && item.stderr === ""), true);
  assert.equal(fs.readdirSync(signalsDirectory).filter((name) => name.endsWith(".json")).length, 512);
});
