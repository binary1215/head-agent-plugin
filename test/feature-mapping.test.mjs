import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { compileContext } from "../scripts/lib/context-compiler.mjs";
import { createExecutionContract, createWholePlanSnapshot } from "../scripts/lib/execution-lineage.mjs";
import {
  inspectFeatureMapping,
  readFeatureMappingCandidateSet,
  readFeatureMappingReviewDecision,
  reviewFeatureMapping,
  startFeatureMapping,
} from "../scripts/lib/feature-mapping.mjs";
import {
  featureMappingCanonicalJson,
  featureMappingDigest,
  verifyFeatureMappingCandidateSet,
} from "../scripts/lib/feature-mapping-projection.mjs";
import { initializeProject } from "../scripts/lib/head-core.mjs";
import { inspectWorldModel, queryWorldTemporalGraph } from "../scripts/lib/world-model.mjs";
import { refreshWorldModel } from "../scripts/lib/incremental-refresh.mjs";
import { startRun } from "../scripts/lib/run-lineage.mjs";
import { dispatch as dispatchMcp } from "../scripts/mcp-server.mjs";
import { runCommand } from "../scripts/head.mjs";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testParent = process.env.HEAD_AGENT_TEST_TMP || os.tmpdir();

function temporaryProject() {
  fs.mkdirSync(testParent, { recursive: true });
  return fs.realpathSync(fs.mkdtempSync(path.join(testParent, "head-agent-feature-mapping-")));
}

function treeBytes(root) {
  const result = {};
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else result[path.relative(root, file).replaceAll("\\", "/")] = fs.readFileSync(file).toString("base64");
    }
  };
  visit(root);
  return result;
}

async function interruptMappingPointer(root, request) {
  const pointer = path.join(root, ".head/feature-mappings/current.json");
  const pointerBefore = fs.readFileSync(pointer);
  const rename = fs.renameSync;
  let injected = false;
  try {
    fs.renameSync = function(from, to) {
      if (!injected && to === pointer) {
        injected = true;
        throw Object.assign(new Error("Fixture EIO before final mapping pointer rename"), { code: "EIO" });
      }
      return rename.apply(this, arguments);
    };
    await assert.rejects(() => reviewFeatureMapping(request), { code: "EIO" });
  } finally { fs.renameSync = rename; }
  assert.equal(injected, true);
  assert.deepEqual(fs.readFileSync(pointer), pointerBefore);
  const directory = path.join(root, ".head/feature-mappings/review-decisions");
  const reviews = fs.readdirSync(directory).filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(fs.readFileSync(path.join(directory, name), "utf8")))
    .filter((review) => review.candidateSetId === request.candidateSetId);
  assert.equal(reviews.length, 1);
  return reviews[0];
}

function mappingMcp(root, request) {
  return dispatchMcp({ jsonrpc: "2.0", id: "mapping-review-retry", method: "tools/call", params: {
    name: "head_feature_mapping_review", arguments: { project_root: root, candidate_set_id: request.candidateSetId,
      disposition: request.disposition, accepted_candidate_ids: request.acceptedCandidateIds || [], rationale: request.rationale, confirm_user_review: true },
  } });
}

function productDocument() {
  return {
    schemaVersion: 1,
    featureGroups: [{ key: "messaging", name: "Messaging", description: "User communication" }],
    capabilities: [{ key: "message-delivery", name: "Message delivery", description: "Deliver a message" }],
    features: [{
      key: "message-send",
      name: "Message delivery",
      description: "Send and deliver one user-authored message",
      featureGroupKeys: ["messaging"],
      capabilityKeys: ["message-delivery"],
      governedBy: [],
    }],
    requirements: [],
    constraints: [],
    decisions: [],
  };
}

function initializedProject() {
  const root = temporaryProject();
  initializeProject({ root, pluginRoot, runtimes: ["codex"] });
  fs.writeFileSync(path.join(root, ".head", "context", "product-model.json"), `${JSON.stringify(productDocument(), null, 2)}\n`);
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "test"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "message-delivery.mjs"), "export function deliverMessage(message) { return message; }\n");
  fs.writeFileSync(path.join(root, "test", "message-delivery.test.mjs"), "export function verifiesMessageDelivery() { return true; }\n");
  return root;
}

function semanticMappingProposal(root) {
  const world = inspectWorldModel({ root });
  assert.equal(world.status, "current");
  const graph = world.snapshot.temporalProvenanceGraph;
  const productNode = graph.nodes.find((node) => node.kind === "Feature" && node.key === "message-send");
  const sourceNode = graph.nodes.find((node) => node.kind === "File" && node.path === "src/message-delivery.mjs");
  const testNode = graph.nodes.find((node) => node.kind === "Test" && node.path === "test/message-delivery.test.mjs");
  assert.ok(productNode);
  assert.ok(sourceNode);
  assert.ok(testNode);
  return {
    schemaVersion: 1,
    sourceSnapshotId: graph.sourceSnapshotId,
    productModelId: world.snapshot.productModel.productModelId,
    candidates: [
      {
        relationshipType: "IMPLEMENTS",
        sourceNodeId: sourceNode.nodeId,
        productNodeId: productNode.nodeId,
        explanation: "Fresh HEAD identifies the exact current implementation evidence for the reviewed Feature.",
        confidence: 0.9,
      },
      {
        relationshipType: "VERIFIED_BY",
        sourceNodeId: testNode.nodeId,
        productNodeId: productNode.nodeId,
        explanation: "Fresh HEAD identifies the exact current verification evidence for the reviewed Feature.",
        confidence: 0.9,
      },
    ],
  };
}

async function startWithSemanticProposal(root) {
  const awaitingEvidence = await startFeatureMapping({ root });
  assert.equal(awaitingEvidence.status, "awaiting_feature_mapping_evidence");
  assert.equal(awaitingEvidence.candidateSet.candidates.length, 0);
  assert.equal(awaitingEvidence.candidateSet.unknowns.some((item) => /Fresh HEAD semantic implementation-mapping candidates/.test(item.statement)), true);
  return startFeatureMapping({ root, semanticProposal: semanticMappingProposal(root) });
}

test("accepts a typed MCP semantic proposal but requires explicit confirmation for review authority", async (t) => {
  const root = initializedProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const awaitingEvidence = await startFeatureMapping({ root });
  assert.equal(awaitingEvidence.status, "awaiting_feature_mapping_evidence");
  const proposal = semanticMappingProposal(root);
  const response = await dispatchMcp({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "head_feature_mapping_propose",
      arguments: {
        project_root: root,
        semantic_proposal: {
          schema_version: proposal.schemaVersion,
          source_snapshot_id: proposal.sourceSnapshotId,
          product_model_id: proposal.productModelId,
          candidates: proposal.candidates.map((candidate) => ({
            relationship_type: candidate.relationshipType,
            source_node_id: candidate.sourceNodeId,
            product_node_id: candidate.productNodeId,
            explanation: candidate.explanation,
            confidence: candidate.confidence,
          })),
        },
      },
    },
  });
  assert.equal(response.error, undefined);
  assert.equal(response.result.structuredContent.status, "awaiting_feature_mapping_review");
  assert.equal(response.result.structuredContent.candidateSet.candidates.length, 2);
  assert.equal(response.result.structuredContent.candidateSet.candidates.every((candidate) => candidate.promotionAuthority === false), true);
  assert.equal(inspectFeatureMapping({ root }).status, "awaiting_review");
  const freshStatus = await dispatchMcp({ jsonrpc: "2.0", id: "fresh-mapping-status", method: "tools/call",
    params: { name: "head_feature_mapping_status", arguments: { project_root: root } } });
  assert.match(freshStatus.result.content[0].text, /Options: accept all, accept a selection, or reject/u);

  const reviewArguments = {
    project_root: root,
    candidate_set_id: response.result.structuredContent.candidateSet.candidateSetId,
    disposition: "accept-all",
    rationale: "The user explicitly reviewed the exact current mapping candidates.",
    confirm_user_review: false,
  };
  const denied = await dispatchMcp({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "head_feature_mapping_review", arguments: reviewArguments } });
  assert.match(denied.error.message, /explicit user confirmation/i);
  assert.equal(inspectFeatureMapping({ root }).status, "awaiting_review");

  const accepted = await dispatchMcp({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "head_feature_mapping_review", arguments: { ...reviewArguments, confirm_user_review: true } } });
  assert.equal(accepted.error, undefined);
  assert.equal(accepted.result.structuredContent.status, "feature_mappings_reviewed");
  assert.equal(inspectFeatureMapping({ root }).status, "reviewed");
});

test("fails closed on stale, misdirected, duplicate, and retired lexical mapping proposals", async (t) => {
  const root = initializedProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await startFeatureMapping({ root });
  const baseline = semanticMappingProposal(root);

  const stale = structuredClone(baseline);
  stale.sourceSnapshotId = `source-snapshot-${"0".repeat(24)}`;
  await assert.rejects(() => startFeatureMapping({ root, semanticProposal: stale }), { code: "FEATURE_MAPPING_PROPOSAL_DRIFT" });

  const misdirected = structuredClone(baseline);
  misdirected.candidates[0].sourceNodeId = baseline.candidates[1].sourceNodeId;
  await assert.rejects(() => startFeatureMapping({ root, semanticProposal: misdirected }), { code: "INVALID_FEATURE_MAPPING_DIRECTION" });

  const duplicate = structuredClone(baseline);
  duplicate.candidates = [duplicate.candidates[0], structuredClone(duplicate.candidates[0])];
  await assert.rejects(() => startFeatureMapping({ root, semanticProposal: duplicate }), { code: "DUPLICATE_FEATURE_MAPPING_PROPOSAL" });

  const current = await startFeatureMapping({ root, semanticProposal: baseline });
  const retired = structuredClone(current.candidateSet);
  retired.protocol.version = "0.1.0";
  delete retired.candidateSetId;
  delete retired.candidateSetHash;
  retired.candidateSetHash = featureMappingDigest(featureMappingCanonicalJson(retired));
  retired.candidateSetId = `feature-mapping-candidates-${retired.candidateSetHash.slice(0, 24)}`;
  assert.throws(() => verifyFeatureMappingCandidateSet(retired, retired.projectId), { code: "INVALID_FEATURE_MAPPING_CANDIDATE_SET" });
});

test("keeps HEAD-proposed Feature mappings non-authoritative until explicit review creates separate reviewed relationships", async (t) => {
  const root = initializedProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const started = await startWithSemanticProposal(root);
  assert.equal(started.status, "awaiting_feature_mapping_review");
  assert.equal(started.candidateSet.candidates.length > 0, true);
  assert.equal(started.candidateSet.candidates.every((candidate) => candidate.promotionAuthority === false), true);
  assert.equal(started.candidateSet.candidates.some((candidate) => candidate.relationshipType === "IMPLEMENTS"), true);
  assert.equal(started.candidateSet.candidates.some((candidate) => candidate.relationshipType === "VERIFIED_BY"), true);

  const candidateId = started.candidateSet.candidates[0].candidateId;
  const hidden = queryWorldTemporalGraph({ root, query: candidateId, depth: 1 });
  assert.equal(hidden.nodes.some((node) => node.nodeId === candidateId), false);
  assert.equal(hidden.exclusion.unreviewedCandidatesExcluded > 0, true);
  const explicit = queryWorldTemporalGraph({ root, query: candidateId, includeUnreviewedCandidates: true, depth: 1 });
  assert.equal(explicit.nodes.some((node) => node.nodeId === candidateId), true);
  assert.equal(explicit.edges.some((edge) => ["IMPLEMENTS", "VERIFIED_BY"].includes(edge.type)), false);

  const reviewed = await reviewFeatureMapping({
    root,
    candidateSetId: started.candidateSet.candidateSetId,
    disposition: "accept-all",
    rationale: "The exact current implementation and test evidence supports the reviewed product concepts.",
  });
  assert.equal(reviewed.status, "feature_mappings_reviewed");
  assert.equal(reviewed.reviewedRelationshipCount, started.candidateSet.candidates.length);
  const status = inspectFeatureMapping({ root });
  assert.equal(status.status, "reviewed");
  assert.equal(status.worldModel.matchesMappingState, true);
  const graph = queryWorldTemporalGraph({
    root,
    query: "Message delivery",
    relations: ["HAS_REVISION", "CURRENT_REVISION", "IMPLEMENTS", "VERIFIED_BY", "PRODUCES"],
    depth: 3,
    maxNodes: 200,
    maxEdges: 400,
  });
  assert.equal(graph.edges.some((edge) => edge.type === "IMPLEMENTS" && edge.authorityClass === "reviewed"), true);
  assert.equal(graph.edges.some((edge) => edge.type === "VERIFIED_BY" && edge.authorityClass === "reviewed"), true);
  assert.equal(graph.nodes.some((node) => node.kind === "FeatureMappingCandidate"), false);
  const capsule = compileContext({ root, task: "Change Message delivery and its verification coverage", budget: 32_768, persist: false });
  assert.equal(capsule.capsule.productContext.length, 1);
  const relationshipTypes = capsule.capsule.productContext[0].relationships.map((edge) => edge.type);
  assert.equal(relationshipTypes.includes("IMPLEMENTS") || relationshipTypes.includes("VERIFIED_BY"), true);
  assert.equal(capsule.capsule.productContext[0].entities.some((node) => node.kind === "FeatureMappingCandidate"), false);
});

test("records rejection without creating reviewed implementation relations", async (t) => {
  const root = initializedProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const started = await startWithSemanticProposal(root);
  const rejected = await reviewFeatureMapping({
    root,
    candidateSetId: started.candidateSet.candidateSetId,
    disposition: "reject",
    rationale: "The proposed evidence is insufficient for this project.",
  });
  assert.equal(rejected.status, "feature_mappings_rejected");
  const explicit = queryWorldTemporalGraph({ root, query: started.candidateSet.candidateSetId, includeUnreviewedCandidates: true, depth: 2 });
  assert.equal(explicit.edges.some((edge) => ["IMPLEMENTS", "VERIFIED_BY"].includes(edge.type)), false);
  assert.equal(explicit.edges.filter((edge) => edge.type === "REJECTED_BY").length, started.candidateSet.candidates.length);
  const aliasId = `feature-mapping-review-decision-${"0".repeat(24)}`;
  const aliasFile = path.join(root, ".head/feature-mappings/review-decisions", `${aliasId}.json`);
  fs.writeFileSync(aliasFile, JSON.stringify(rejected.reviewDecision));
  const beforeAliasRead = treeBytes(root);
  assert.throws(() => readFeatureMappingReviewDecision({ root, reviewDecisionId: aliasId }), { code: "FEATURE_MAPPING_REVIEW_IDENTITY_MISMATCH" });
  assert.deepEqual(treeBytes(root), beforeAliasRead);
  fs.unlinkSync(aliasFile);
  assert.deepEqual(readFeatureMappingReviewDecision({ root, reviewDecisionId: rejected.reviewDecision.reviewDecisionId }).reviewDecision, rejected.reviewDecision);
});

test("blocks stale and tampered Feature mapping review artifacts", async (t) => {
  const driftRoot = initializedProject();
  t.after(() => fs.rmSync(driftRoot, { recursive: true, force: true }));
  const drifted = await startWithSemanticProposal(driftRoot);
  fs.appendFileSync(path.join(driftRoot, "src", "message-delivery.mjs"), "export const drift = true;\n");
  await assert.rejects(reviewFeatureMapping({
    root: driftRoot,
    candidateSetId: drifted.candidateSet.candidateSetId,
    disposition: "accept-all",
    rationale: "Attempted review after source drift.",
  }), { code: "FEATURE_MAPPING_SOURCE_DRIFT" });

  const tamperRoot = initializedProject();
  t.after(() => fs.rmSync(tamperRoot, { recursive: true, force: true }));
  const started = await startWithSemanticProposal(tamperRoot);
  const file = path.join(tamperRoot, ".head", "feature-mappings", "candidate-sets", `${started.candidateSet.candidateSetId}.json`);
  const tampered = JSON.parse(fs.readFileSync(file, "utf8"));
  tampered.candidates[0].confidence = 0;
  fs.writeFileSync(file, JSON.stringify(tampered));
  assert.throws(() => readFeatureMappingCandidateSet({ root: tamperRoot, candidateSetId: started.candidateSet.candidateSetId }), {
    code: "FEATURE_MAPPING_DIGEST_MISMATCH",
  });
});

test("rejecting a historical Product mapping projects the current Canon and retains the reviewed target", async (t) => {
  const root = initializedProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const started = await startWithSemanticProposal(root);
  // This isolated fixture supplies the next valid Canon as a fixture boundary;
  // rejection itself must neither create nor rewrite product authority.
  const canonFile = path.join(root, ".head/context/product-model.json");
  const changed = productDocument();
  changed.features[0].description = "Deliver a current version of the user-authored message";
  fs.writeFileSync(canonFile, JSON.stringify(changed));
  await refreshWorldModel({ root });
  const current = inspectWorldModel({ root });
  assert.equal(current.status, "current");
  assert.notEqual(current.snapshot.productModel.productModelId, started.candidateSet.productModelId);
  const before = treeBytes(root);
  await assert.rejects(() => reviewFeatureMapping({ root, candidateSetId: started.candidateSet.candidateSetId,
    disposition: "accept-all", rationale: "Cannot approve a different Canon." }), { code: "FEATURE_MAPPING_SOURCE_DRIFT" });
  assert.deepEqual(treeBytes(root), before);
  const rejected = await reviewFeatureMapping({ root, candidateSetId: started.candidateSet.candidateSetId,
    disposition: "reject", rationale: "Reject the old product-evidence proposal, not current Canon." });
  assert.equal(rejected.status, "feature_mappings_rejected");
  assert.equal(rejected.reviewDecision.productModelId, started.candidateSet.productModelId);
  assert.equal(rejected.reviewDecision.productModelHash, started.candidateSet.productModelHash);
  const projected = inspectWorldModel({ root });
  assert.equal(projected.status, "current");
  assert.equal(projected.snapshot.productModel.productModelId, current.snapshot.productModel.productModelId);
  assert.equal(projected.snapshot.temporalProvenanceGraph.summary.reviewedRelationshipCount, 0);
  for (const [name, value] of Object.entries(before).filter(([name]) => name.startsWith(".head/sessions/")
    || name === ".head/project.json" || name === ".head/context/product-model.json")) {
    assert.equal(treeBytes(root)[name], value);
  }
  assert.equal((await startFeatureMapping({ root, semanticProposal: semanticMappingProposal(root) })).status, "awaiting_feature_mapping_review");
});

test("stale rejection validates the exact request, candidate and Session before refreshing or writing", async (t) => {
  const root = initializedProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const started = await startWithSemanticProposal(root);
  fs.appendFileSync(path.join(root, "src/message-delivery.mjs"), "export const changed = true;\n");
  const request = { root, candidateSetId: started.candidateSet.candidateSetId, disposition: "reject", rationale: "Reject the exact obsolete candidate." };
  const noWrite = async (input, code) => {
    const before = treeBytes(root);
    await assert.rejects(() => reviewFeatureMapping(input), { code });
    assert.deepEqual(treeBytes(root), before);
  };
  await noWrite({ ...request, candidateSetId: `feature-mapping-candidates-${"0".repeat(24)}` }, "STALE_FEATURE_MAPPING_CANDIDATE_SET");
  await noWrite({ ...request, disposition: "abandon" }, "INVALID_FEATURE_MAPPING_REVIEW_DISPOSITION");
  await noWrite({ ...request, rationale: " " }, "INVALID_FEATURE_MAPPING_INPUT");
  await noWrite({ ...request, acceptedCandidateIds: "not-an-array" }, "INVALID_FEATURE_MAPPING_REVIEW_SELECTION");
  const candidateFile = path.join(root, ".head/feature-mappings/candidate-sets", `${request.candidateSetId}.json`);
  const candidateBytes = fs.readFileSync(candidateFile);
  const pointerFile = path.join(root, ".head/feature-mappings/current.json");
  const pointerBytes = fs.readFileSync(pointerFile);
  fs.writeFileSync(candidateFile, JSON.stringify({ ...started.candidateSet, candidateSetHash: "0".repeat(64) }));
  await noWrite(request, "FEATURE_MAPPING_DIGEST_MISMATCH");
  fs.writeFileSync(candidateFile, candidateBytes);
  fs.writeFileSync(pointerFile, JSON.stringify({ ...started.state, pointerHash: "0".repeat(64) }));
  await noWrite(request, "FEATURE_MAPPING_STATE_DIGEST_MISMATCH");
  fs.writeFileSync(pointerFile, pointerBytes);
  const foreign = { ...started.candidateSet, sessionId: "different-head-session" };
  delete foreign.candidateSetId;
  delete foreign.candidateSetHash;
  foreign.candidateSetHash = featureMappingDigest(featureMappingCanonicalJson(foreign));
  foreign.candidateSetId = `feature-mapping-candidates-${foreign.candidateSetHash.slice(0, 24)}`;
  fs.writeFileSync(candidateFile, JSON.stringify(foreign));
  await noWrite(request, "FEATURE_MAPPING_CANDIDATE_SET_IDENTITY_MISMATCH");
  fs.writeFileSync(candidateFile, candidateBytes);
  const foreignFile = path.join(root, ".head/feature-mappings/candidate-sets", `${foreign.candidateSetId}.json`);
  fs.writeFileSync(foreignFile, JSON.stringify(foreign));
  const foreignPointer = { ...started.state, candidateSetId: foreign.candidateSetId };
  delete foreignPointer.pointerHash;
  foreignPointer.pointerHash = featureMappingDigest(featureMappingCanonicalJson(foreignPointer));
  fs.writeFileSync(pointerFile, JSON.stringify(foreignPointer));
  await noWrite({ ...request, candidateSetId: foreign.candidateSetId }, "FEATURE_MAPPING_CANDIDATE_SET_IDENTITY_MISMATCH");
  const beforeStatus = treeBytes(root);
  assert.throws(() => inspectFeatureMapping({ root }), { code: "FEATURE_MAPPING_CANDIDATE_SET_IDENTITY_MISMATCH" });
  assert.deepEqual(treeBytes(root), beforeStatus);
  fs.writeFileSync(pointerFile, pointerBytes);
  fs.unlinkSync(foreignFile);
  assert.equal((await reviewFeatureMapping(request)).status, "feature_mappings_rejected");
});

test("rejection does not silently rebuild missing World or replace corrupt World", async (t) => {
  for (const damage of ["missing", "corrupt"]) {
    const root = initializedProject();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const started = await startWithSemanticProposal(root);
    const current = inspectWorldModel({ root });
    const file = path.join(root, ".head/world-model/snapshots", `${current.snapshot.worldModelId}.json`);
    if (damage === "missing") fs.unlinkSync(file);
    else fs.writeFileSync(file, JSON.stringify({ ...current.snapshot, worldModelHash: "0".repeat(64) }));
    const before = treeBytes(root);
    await assert.rejects(() => reviewFeatureMapping({ root, candidateSetId: started.candidateSet.candidateSetId,
      disposition: "reject", rationale: "Reject cannot use an unverified or absent projection as authority." }));
    assert.deepEqual(treeBytes(root), before);
  }
});

test("mapping readiness discloses the existing active Run restriction consistently without writing", async (t) => {
  const root = initializedProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const started = await startWithSemanticProposal(root);
  const capsule = compileContext({ root, task: "Inspect message delivery", persist: true });
  const plan = createWholePlanSnapshot({ root, objective: "Inspect delivery in a bounded Run", plan: [{ id: "inspect", outcome: "Report evidence" }] });
  const contract = createExecutionContract({ root, wholePlanId: plan.artifact.wholePlanId, capsuleId: capsule.capsule.capsuleId,
    scope: "Read message delivery", acceptanceCriteria: ["Report exact inspected evidence"] });
  startRun({ root, executionContractId: contract.artifact.executionContractId });
  const before = treeBytes(root);
  const status = inspectFeatureMapping({ root });
  assert.equal(status.reviewReadiness.runConflict, true);
  assert.equal(status.reviewReadiness.acceptanceAvailable, false);
  assert.equal(status.reviewReadiness.explicitRejectionAvailable, false);
  assert.match(status.reviewReadiness.nextAction, /existing Run/);
  assert.deepEqual(await runCommand(["feature-mapping-status", root]), status);
  const mcp = await dispatchMcp({ jsonrpc: "2.0", id: "active-run-mapping-status", method: "tools/call",
    params: { name: "head_feature_mapping_status", arguments: { project_root: root } } });
  assert.deepEqual(mcp.result.structuredContent, status);
  assert.match(mcp.result.content[0].text, /waiting for the current Run boundary/u);
  assert.match(mcp.result.content[0].text, /User decision: none/u);
  assert.doesNotMatch(mcp.result.content[0].text, /Options: accept/u);
  await assert.rejects(() => reviewFeatureMapping({ root, candidateSetId: started.candidateSet.candidateSetId,
    disposition: "reject", rationale: "The existing Run restriction still applies." }), { code: "FEATURE_MAPPING_RUN_CONFLICT" });
  assert.deepEqual(treeBytes(root), before);
});

test("the same explicit stale rejection retries after projection, decision or state write interruption", async (t) => {
  for (const boundary of ["projection", "decision", "state"]) {
    const root = initializedProject();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const started = await startWithSemanticProposal(root);
    fs.appendFileSync(path.join(root, "src/message-delivery.mjs"), "export const format = 'updated';\n");
    await refreshWorldModel({ root });
    const request = { root, candidateSetId: started.candidateSet.candidateSetId, disposition: "reject",
      rationale: "One explicit decision for the exact obsolete proposal, retried unchanged." };
    const stateFile = path.join(root, ".head/feature-mappings/current.json");
    const stateBytes = fs.readFileSync(stateFile);
    const protectedBytes = Object.fromEntries(Object.entries(treeBytes(root)).filter(([name]) => name.startsWith(".head/sessions/")
      || name === ".head/project.json" || name === ".head/context/product-model.json"));
    const rename = fs.renameSync;
    let injected = false;
    try {
      fs.renameSync = function(from, to) {
        const relative = path.relative(root, String(to)).replaceAll("\\", "/");
        const matches = boundary === "projection" ? relative === ".head/world-model/current.json"
          : boundary === "decision" ? relative.startsWith(".head/feature-mappings/review-decisions/")
            : relative === ".head/feature-mappings/current.json";
        if (!injected && matches) {
          injected = true;
          throw Object.assign(new Error(`Injected ${boundary} write interruption`), { code: "TEST_MAPPING_WRITE_INTERRUPTION" });
        }
        return rename.apply(this, arguments);
      };
      await assert.rejects(() => reviewFeatureMapping(request), { code: "TEST_MAPPING_WRITE_INTERRUPTION" });
    } finally { fs.renameSync = rename; }
    assert.equal(injected, true, boundary);
    assert.deepEqual(fs.readFileSync(stateFile), stateBytes, `${boundary}: interrupted state must remain awaiting-review`);
    const reviewDirectory = path.join(root, ".head/feature-mappings/review-decisions");
    const decisionsBefore = fs.existsSync(reviewDirectory) ? fs.readdirSync(reviewDirectory).filter((name) => name.endsWith(".json")) : [];
    assert.equal(decisionsBefore.length, boundary === "decision" ? 0 : 1, "P1 is durable before its rebuildable P4 projection");
    const retried = await reviewFeatureMapping(request);
    assert.equal(retried.status, "feature_mappings_rejected");
    assert.equal(retried.reviewDecision.rationale, request.rationale);
    assert.equal(inspectWorldModel({ root }).status, "current");
    assert.deepEqual(fs.readdirSync(reviewDirectory).filter((name) => name.endsWith(".json")), [`${retried.reviewDecision.reviewDecisionId}.json`]);
    assert.equal(inspectWorldModel({ root }).snapshot.temporalProvenanceGraph.summary.reviewedRelationshipCount, 0);
    for (const [name, value] of Object.entries(protectedBytes)) assert.equal(treeBytes(root)[name], value);
  }
});

test("acceptance retries safely across decision, projection, and mapping-pointer write failures", async (t) => {
  for (const boundary of ["decision", "projection", "state"]) {
    const root = initializedProject();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const started = await startWithSemanticProposal(root);
    const request = { root, candidateSetId: started.candidateSet.candidateSetId, disposition: "accept-all",
      rationale: "Approve one exact immutable mapping request across writer recovery." };
    const mappingPointer = path.join(root, ".head/feature-mappings/current.json");
    const worldPointer = path.join(root, ".head/world-model/current.json");
    const mappingPointerBytes = fs.readFileSync(mappingPointer);
    const worldPointerBytes = fs.readFileSync(worldPointer);
    const rename = fs.renameSync;
    let injected = false;
    try {
      fs.renameSync = function(from, to) {
        const relative = path.relative(root, String(to)).replaceAll("\\", "/");
        const matches = boundary === "decision" ? relative.startsWith(".head/feature-mappings/review-decisions/")
          : boundary === "projection" ? relative === ".head/world-model/current.json"
            : relative === ".head/feature-mappings/current.json";
        if (!injected && matches) {
          injected = true;
          throw Object.assign(new Error(`Injected ${boundary} acceptance write interruption`), { code: "TEST_MAPPING_ACCEPT_WRITE_INTERRUPTION" });
        }
        return rename.apply(this, arguments);
      };
      await assert.rejects(() => reviewFeatureMapping(request), { code: "TEST_MAPPING_ACCEPT_WRITE_INTERRUPTION" });
    } finally { fs.renameSync = rename; }
    assert.equal(injected, true, boundary);
    assert.deepEqual(fs.readFileSync(mappingPointer), mappingPointerBytes, `${boundary}: mapping pointer remains pending`);
    const reviewDirectory = path.join(root, ".head/feature-mappings/review-decisions");
    const decisions = fs.existsSync(reviewDirectory) ? fs.readdirSync(reviewDirectory).filter((name) => name.endsWith(".json")) : [];
    assert.equal(decisions.length, boundary === "decision" ? 0 : 1, `${boundary}: only a completed P1 write is durable`);
    if (boundary === "decision") {
      assert.deepEqual(fs.readFileSync(worldPointer), worldPointerBytes, "a failed P1 write cannot publish a P4 decision projection");
      assert.equal(inspectWorldModel({ root }).status, "current");
    } else {
      const beforeConflict = treeBytes(root);
      await assert.rejects(() => reviewFeatureMapping({ ...request, disposition: "reject", rationale: "A different decision." }),
        { code: "FEATURE_MAPPING_REVIEW_CONFLICT" });
      assert.deepEqual(treeBytes(root), beforeConflict, `${boundary}: a different request cannot replace the durable decision`);
    }
    const recovered = await reviewFeatureMapping(request);
    assert.equal(recovered.status, "feature_mappings_reviewed");
    assert.equal(inspectWorldModel({ root }).status, "current");
    assert.equal(inspectFeatureMapping({ root }).reviewRecovery, null);
    assert.equal(fs.readdirSync(reviewDirectory).filter((name) => name.endsWith(".json")).length, 1);
  }
});

test("an exact current request repairs a legacy orphan projection without treating Graph as decision authority", async (t) => {
  const root = initializedProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const started = await startWithSemanticProposal(root);
  const mappingPointer = path.join(root, ".head/feature-mappings/current.json");
  const pendingPointerBytes = fs.readFileSync(mappingPointer);
  const request = { root, candidateSetId: started.candidateSet.candidateSetId, disposition: "accept-all",
    rationale: "Approve the exact legacy recovery fixture request." };
  const completed = await reviewFeatureMapping(request);
  const decisionFile = path.join(root, ".head/feature-mappings/review-decisions", `${completed.reviewDecision.reviewDecisionId}.json`);
  fs.unlinkSync(decisionFile);
  fs.writeFileSync(mappingPointer, pendingPointerBytes);
  const orphan = inspectWorldModel({ root });
  assert.equal(orphan.status, "stale");
  assert.equal(orphan.changes.featureMappingProjectionChanged, true);
  assert.equal(orphan.changes.temporalProvenanceChanged, true);
  const beforeChangedRequest = treeBytes(root);
  await assert.rejects(() => reviewFeatureMapping({ ...request, rationale: "A different request cannot inherit Graph authority." }),
    { code: "FEATURE_MAPPING_SOURCE_DRIFT" });
  assert.deepEqual(treeBytes(root), beforeChangedRequest);
  assert.equal(fs.existsSync(decisionFile), false, "Graph alone cannot manufacture a P1 ReviewDecision");
  const recovered = await reviewFeatureMapping(request);
  assert.equal(recovered.status, "feature_mappings_reviewed");
  assert.equal(recovered.reviewDecision.reviewDecisionId, completed.reviewDecision.reviewDecisionId);
  assert.equal(fs.existsSync(decisionFile), true);
  assert.equal(inspectWorldModel({ root }).status, "current");
});

test("a durable partial mapping decision rejects conflicting retry before writes and completes only its missing pointer", async (t) => {
  for (const mode of ["completed-control", "divergent-retry", "same-retry-control"]) {
    const root = initializedProject();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const started = await startWithSemanticProposal(root);
    const accept = { root, candidateSetId: started.candidateSet.candidateSetId, disposition: "accept-all", rationale: "Approve this exact fixture mapping." };
    const reject = { ...accept, disposition: "reject", rationale: "A different decision for the same fixture candidate." };
    const pointer = path.join(root, ".head/feature-mappings/current.json");
    if (mode === "completed-control") {
      await reviewFeatureMapping(accept);
      const before = treeBytes(root);
      await assert.rejects(() => reviewFeatureMapping(reject), { code: "STALE_FEATURE_MAPPING_CANDIDATE_SET" });
      assert.deepEqual(treeBytes(root), before);
      continue;
    }
    const pointerBefore = fs.readFileSync(pointer);
    const rename = fs.renameSync;
    let injected = false;
    try {
      fs.renameSync = function(from, to) {
        if (!injected && to === pointer) {
          injected = true;
          throw Object.assign(new Error("Fixture EIO before final mapping pointer rename"), { code: "EIO" });
        }
        return rename.apply(this, arguments);
      };
      await assert.rejects(() => reviewFeatureMapping(accept), { code: "EIO" });
    } finally { fs.renameSync = rename; }
    assert.equal(injected, true);
    assert.deepEqual(fs.readFileSync(pointer), pointerBefore);
    const directory = path.join(root, ".head/feature-mappings/review-decisions");
    const files = fs.readdirSync(directory).filter((name) => name.endsWith(".json"));
    assert.equal(files.length, 1);
    const durable = JSON.parse(fs.readFileSync(path.join(directory, files[0]), "utf8"));
    const before = treeBytes(root);
    if (mode === "divergent-retry") {
      await assert.rejects(() => reviewFeatureMapping(reject), { code: "FEATURE_MAPPING_REVIEW_CONFLICT" });
      assert.deepEqual(treeBytes(root), before);
    }
    const replayed = await reviewFeatureMapping(accept);
    assert.equal(replayed.reviewDecision.reviewDecisionId, durable.reviewDecisionId);
    assert.equal(replayed.status, "feature_mappings_reviewed");
    assert.equal(inspectWorldModel({ root }).status, "current");
    const after = treeBytes(root);
    assert.deepEqual(Object.keys(after).filter((name) => after[name] !== before[name]), [".head/feature-mappings/current.json"], "exact retry completes only the missing pointer");
  }
});

test("partial accept-all, selection and reject bind normalized input across CLI/MCP retry and subsequent source drift", async (t) => {
  for (const disposition of ["accept-all", "accept-selection", "reject"]) {
    const root = initializedProject();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const started = await startWithSemanticProposal(root);
    const ids = started.candidateSet.candidates.map((candidate) => candidate.candidateId);
    const request = { root, candidateSetId: started.candidateSet.candidateSetId, disposition,
      acceptedCandidateIds: disposition === "accept-selection" ? ids : [], rationale: "The exact immutable reviewed fixture input." };
    const durable = await interruptMappingPointer(root, request);
    const beforeRead = treeBytes(root);
    const status = inspectFeatureMapping({ root });
    assert.deepEqual(status.reviewRecovery, { status: "pointer-update-pending", reviewDecisionId: durable.reviewDecisionId, requiresNewUserDecision: false });
    assert.equal(status.reviewReadiness.acceptanceAvailable, false);
    assert.equal(status.reviewReadiness.explicitRejectionAvailable, false);
    assert.deepEqual(status.reviewDecision, durable);
    assert.deepEqual(await runCommand(["feature-mapping-status", root]), status);
    const mcpStatus = await dispatchMcp({ jsonrpc: "2.0", id: "mapping-pending-status", method: "tools/call",
      params: { name: "head_feature_mapping_status", arguments: { project_root: root } } });
    assert.deepEqual(mcpStatus.result.structuredContent, status);
    assert.match(mcpStatus.result.content[0].text, /decision is already saved/u);
    assert.match(mcpStatus.result.content[0].text, /User decision: none/u);
    assert.doesNotMatch(mcpStatus.result.content[0].text, /Options: accept/u);
    assert.deepEqual(treeBytes(root), beforeRead, "pending-decision status is read-only");
    const divergent = [{ ...request, rationale: "A different rationale is a different decision." },
      { ...request, disposition: disposition === "reject" ? "accept-all" : "reject" }];
    if (disposition === "accept-selection") divergent.push({ ...request, acceptedCandidateIds: [ids[0]] });
    for (const changed of divergent) {
      const before = treeBytes(root);
      await assert.rejects(() => reviewFeatureMapping(changed), { code: "FEATURE_MAPPING_REVIEW_CONFLICT" });
      assert.deepEqual(treeBytes(root), before);
      const denied = await mappingMcp(root, changed);
      assert.match(denied.error.message, /already durable/);
      assert.deepEqual(treeBytes(root), before, "MCP shares the same conflict fence");
    }
    fs.appendFileSync(path.join(root, "src/message-delivery.mjs"), "export const laterVersion = true;\n");
    assert.equal(inspectWorldModel({ root }).status, "stale");
    const replayRequest = { ...request, acceptedCandidateIds: [...request.acceptedCandidateIds].reverse(), rationale: ` ${request.rationale} ` };
    let replay;
    const inputFile = path.join(root, ".head/mapping-replay-input.json");
    if (disposition === "accept-all") fs.writeFileSync(inputFile, JSON.stringify(replayRequest));
    const beforeReplay = treeBytes(root);
    if (disposition === "accept-all") replay = await runCommand(["feature-mapping-review", root, "--input", inputFile]);
    else if (disposition === "accept-selection") {
      const response = await mappingMcp(root, replayRequest);
      assert.equal(response.error, undefined, JSON.stringify(response.error));
      replay = response.result.structuredContent;
    } else replay = await reviewFeatureMapping(replayRequest);
    assert.equal(replay.reusedReviewDecision, true);
    assert.deepEqual(replay.reviewDecision, durable);
    assert.equal(replay.worldModel.status, "stale", "durable approval recovery does not claim current source evidence");
    const after = treeBytes(root);
    assert.deepEqual(Object.keys(after).filter((name) => after[name] !== beforeReplay[name]), [".head/feature-mappings/current.json"]);
    assert.equal(inspectFeatureMapping({ root }).reviewRecovery, null);
    const stable = treeBytes(root);
    assert.equal((await reviewFeatureMapping(replayRequest)).reusedReviewDecision, true);
    assert.deepEqual(treeBytes(root), stable, "completed exact retry is read-only");
  }
});

test("pending mapping replay refuses missing/tampered projections and conflicting durable history without writing", async (t) => {
  for (const damage of ["missing-snapshot", "tampered-snapshot", "conflicting-history", "decision-alias", "decision-tamper"]) {
    const root = initializedProject();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const started = await startWithSemanticProposal(root);
    const request = { root, candidateSetId: started.candidateSet.candidateSetId, disposition: "accept-all", rationale: "Approve the exact fixture mapping." };
    const durable = await interruptMappingPointer(root, request);
    const snapshot = inspectWorldModel({ root }).snapshot;
    const snapshotFile = path.join(root, ".head/world-model/snapshots", `${snapshot.worldModelId}.json`);
    const directory = path.join(root, ".head/feature-mappings/review-decisions");
    const decisionFile = path.join(directory, `${durable.reviewDecisionId}.json`);
    let expectedCode;
    if (damage === "missing-snapshot") fs.unlinkSync(snapshotFile);
    else if (damage === "tampered-snapshot") fs.writeFileSync(snapshotFile, JSON.stringify({ ...snapshot, worldModelHash: "0".repeat(64) }));
    else if (damage === "decision-tamper") {
      fs.writeFileSync(decisionFile, JSON.stringify({ ...durable, reviewDecisionHash: "0".repeat(64) }));
      expectedCode = "FEATURE_MAPPING_DIGEST_MISMATCH";
    } else if (damage === "decision-alias") {
      fs.writeFileSync(path.join(directory, `feature-mapping-review-decision-${"0".repeat(24)}.json`), JSON.stringify(durable));
      expectedCode = "FEATURE_MAPPING_REVIEW_IDENTITY_MISMATCH";
    } else {
      // A preexisting contradictory but internally valid decision is test
      // corruption: Core must neither select a winner nor delete either record.
      const other = { ...durable, rationale: "A conflicting recorded rationale." };
      delete other.reviewDecisionId;
      delete other.reviewDecisionHash;
      other.reviewDecisionHash = featureMappingDigest(featureMappingCanonicalJson(other));
      other.reviewDecisionId = `feature-mapping-review-decision-${other.reviewDecisionHash.slice(0, 24)}`;
      fs.writeFileSync(path.join(directory, `${other.reviewDecisionId}.json`), JSON.stringify(other));
      expectedCode = "FEATURE_MAPPING_REVIEW_CONFLICT";
    }
    const before = treeBytes(root);
    if (expectedCode) await assert.rejects(() => reviewFeatureMapping(request), { code: expectedCode });
    else await assert.rejects(() => reviewFeatureMapping(request));
    assert.deepEqual(treeBytes(root), before, damage);
    assert.equal(fs.readdirSync(path.join(root, ".head/.operations")).some((name) => name === "session-recovery.lock" || name.endsWith(".staging")), false, "failed paths release mutation ownership");
  }
});

test("concurrent mapping review and start calls share one target/decision publication scope", async (t) => {
  for (const mode of ["same-decision", "different-decision", "new-start"]) {
    const root = initializedProject();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const started = await startWithSemanticProposal(root);
    const request = { root, candidateSetId: started.candidateSet.candidateSetId, disposition: "accept-all", rationale: "One concurrent exact mapping decision." };
    const first = reviewFeatureMapping(request);
    let second;
    if (mode === "same-decision") second = mappingMcp(root, request);
    else if (mode === "different-decision") second = reviewFeatureMapping({ ...request, disposition: "reject" });
    else second = startFeatureMapping({ root });
    const [a, b] = await Promise.allSettled([first, second]);
    assert.equal(a.status, "fulfilled", String(a.reason));
    if (mode === "same-decision") {
      assert.equal(b.status, "fulfilled");
      assert.equal(b.value.error, undefined, JSON.stringify(b.value.error));
      assert.equal(b.value.result.structuredContent.reusedReviewDecision, true);
      assert.equal(b.value.result.structuredContent.reviewDecision.reviewDecisionId, a.value.reviewDecision.reviewDecisionId);
    } else if (mode === "different-decision") {
      assert.equal(b.status, "rejected");
      assert.equal(b.reason.code, "STALE_FEATURE_MAPPING_CANDIDATE_SET");
    } else {
      assert.equal(b.status, "fulfilled", String(b.reason));
      assert.equal(b.value.status, "awaiting_feature_mapping_evidence");
      const beforeOldRetry = treeBytes(root);
      await assert.rejects(() => reviewFeatureMapping(request), { code: "STALE_FEATURE_MAPPING_CANDIDATE_SET" });
      assert.deepEqual(treeBytes(root), beforeOldRetry, "old completed decisions cannot roll back a newer candidate pointer");
    }
    assert.equal(inspectWorldModel({ root }).status, "current");
    assert.equal(fs.readdirSync(path.join(root, ".head/feature-mappings/review-decisions")).filter((name) => name.endsWith(".json")).length, 1);
    assert.equal(fs.readdirSync(path.join(root, ".head/.operations")).some((name) => name === "session-recovery.lock" || name.endsWith(".staging")), false);
  }
});
