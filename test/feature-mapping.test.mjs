import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { compileContext } from "../scripts/lib/context-compiler.mjs";
import {
  inspectFeatureMapping,
  readFeatureMappingCandidateSet,
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
import { dispatch as dispatchMcp } from "../scripts/mcp-server.mjs";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testParent = process.env.HEAD_AGENT_TEST_TMP || os.tmpdir();

function temporaryProject() {
  fs.mkdirSync(testParent, { recursive: true });
  return fs.mkdtempSync(path.join(testParent, "head-agent-feature-mapping-"));
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
