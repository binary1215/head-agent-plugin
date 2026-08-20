import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { recordChangeSet } from "../scripts/lib/change-set.mjs";
import { compileContext } from "../scripts/lib/context-compiler.mjs";
import { createExecutionContract, createWholePlanSnapshot } from "../scripts/lib/execution-lineage.mjs";
import { initializeProject } from "../scripts/lib/head-core.mjs";
import {
  buildHeadContinuitySnapshot,
  inspectProductOperatingLoop,
  observeProductOutcome,
  prepareProductLearningNote,
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

  const capsule = compileContext({ root, task: "Implement the reviewed continuity initiative", budget: 12000, persist: true });
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
