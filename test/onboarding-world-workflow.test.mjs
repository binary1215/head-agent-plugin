import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runCommand } from "../scripts/head.mjs";
import { dispatch } from "../scripts/mcp-server.mjs";
import { initializeProject } from "../scripts/lib/head-core.mjs";
import { inspectOnboarding, reviewOnboarding, startOnboarding } from "../scripts/lib/onboarding.mjs";
import { inspectConversationalOnboarding } from "../scripts/lib/onboarding-conversation.mjs";
import { initializeOrResumeProject, inspectProjectExperience } from "../scripts/lib/project-bootstrap.mjs";
import { refreshWorldModel } from "../scripts/lib/incremental-refresh.mjs";
import { startFeatureMapping, reviewFeatureMapping } from "../scripts/lib/feature-mapping.mjs";
import { inspectWorldModel } from "../scripts/lib/world-model.mjs";
import { compileContext } from "../scripts/lib/context-compiler.mjs";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function bytes(root) {
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

function authority(root) {
  return Object.fromEntries(Object.entries(bytes(root)).filter(([name]) => name === ".head/project.json"
    || name.startsWith(".head/sessions/") || name === ".head/context/product-model.json" || name.startsWith(".head/onboarding/")));
}

async function approvedFixture(t) {
  const root = fs.mkdtempSync(path.join(pluginRoot, ".qa-onboarding-world-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "README.md"), "# Delivery service\n");
  fs.writeFileSync(path.join(root, "src/delivery.mjs"), "export function deliver(message) { return { delivered: message }; }\n");
  initializeProject({ root, pluginRoot, runtimes: ["codex"] });
  const started = await startOnboarding({ root, mode: "new", brief: {
    schemaVersion: 1, name: "Delivery", summary: "Deliver one message.",
    capabilities: [{ key: "delivery", name: "Delivery", description: "Deliver a message." }],
  } });
  const request = { root, candidateSetId: started.candidateSet.candidateSetId, disposition: "accept-all", rationale: "Approve the exact delivery concept." };
  const accepted = await reviewOnboarding(request);
  assert.equal(accepted.status, "onboarding_ready", JSON.stringify(accepted.projection));
  return { root, request, accepted };
}

async function statusParity(root) {
  const expected = inspectProjectExperience({ root });
  const cli = await runCommand(["status", root]);
  const mcp = await dispatch({ jsonrpc: "2.0", id: "workflow-status", method: "tools/call",
    params: { name: "head_project_status", arguments: { project_root: root } } });
  assert.equal(mcp.error, undefined);
  for (const result of [cli, mcp.result.structuredContent]) {
    assert.equal(result.status, expected.status);
    assert.deepEqual(result.readiness, expected.readiness);
    assert.deepEqual(result.nextAction, expected.nextAction);
  }
  return expected;
}

function proposal(root) {
  const current = inspectWorldModel({ root });
  assert.equal(current.status, "current");
  const graph = current.snapshot.temporalProvenanceGraph;
  return {
    schemaVersion: 1, sourceSnapshotId: graph.sourceSnapshotId, productModelId: current.snapshot.productModel.productModelId,
    candidates: [{ relationshipType: "IMPLEMENTS",
      sourceNodeId: graph.nodes.find((node) => node.kind === "File" && node.path === "src/delivery.mjs").nodeId,
      productNodeId: graph.nodes.find((node) => node.kind === "Capability" && node.key === "delivery").nodeId,
      explanation: "HEAD cites the deliver implementation for the reviewed delivery capability.", confidence: 0.9 }],
  };
}

test("accepted and refreshed Worlds support mapping and exact Context without changing approval history", async (t) => {
  for (const changeSource of [false, true]) {
    const { root, request, accepted } = await approvedFixture(t);
    const protectedBytes = authority(root);
    if (changeSource) {
      fs.appendFileSync(path.join(root, "README.md"), "\nCurrent delivery documentation.\n");
      const stale = await statusParity(root);
      assert.equal(stale.nextAction.entrypoint.worldOperation, "incremental-refresh");
      assert.equal((await runCommand(["world-refresh", root])).status, "refreshed");
    }
    const current = inspectWorldModel({ root });
    const beforeRead = bytes(root);
    const status = await statusParity(root);
    assert.equal(status.status, "product_ready");
    assert.equal(status.readiness.context.worldModelId, current.snapshot.worldModelId);
    assert.equal((await initializeOrResumeProject({ root, pluginRoot, profile: "product" })).status, "product_ready");
    assert.notEqual(inspectConversationalOnboarding({ root }).nextAction, "refresh_or_reconcile_world");
    const replay = await reviewOnboarding(request);
    assert.equal(replay.status, "onboarding_ready");
    assert.equal(replay.worldModel.worldModelId, current.snapshot.worldModelId);
    assert.equal(replay.productCanonChanged, false);
    assert.deepEqual(bytes(root), beforeRead, "readiness, resume and completed replay are pure");
    assert.equal(inspectOnboarding({ root }).state.worldModelId, accepted.worldModel.worldModelId, "historical approval reference is retained");

    const input = proposal(root);
    const inputBytes = JSON.stringify(input);
    const started = await startFeatureMapping({ root, semanticProposal: input });
    assert.equal(started.status, "awaiting_feature_mapping_review");
    assert.equal(JSON.stringify(input), inputBytes);
    const mappingWorld = inspectWorldModel({ root }).snapshot;
    assert.equal(mappingWorld.temporalProvenanceGraph.sourceSnapshotId, input.sourceSnapshotId);
    assert.deepEqual(mappingWorld.temporalProvenanceGraph.parentSourceSnapshotIds, current.snapshot.temporalProvenanceGraph.parentSourceSnapshotIds);
    assert.deepEqual(mappingWorld.temporalProvenanceGraph.revisionParentIds, current.snapshot.temporalProvenanceGraph.revisionParentIds);
    assert.deepEqual(mappingWorld.files, current.snapshot.files);
    assert.equal(mappingWorld.productModel.productModelHash, current.snapshot.productModel.productModelHash);
    assert.deepEqual(authority(root), protectedBytes);
    const reviewed = await reviewFeatureMapping({ root, candidateSetId: started.candidateSet.candidateSetId,
      disposition: "accept-all", rationale: "Approve the exact implementation relationship." });
    assert.equal(reviewed.status, "feature_mappings_reviewed");
    const reviewedWorld = inspectWorldModel({ root });
    assert.equal(reviewedWorld.status, "current");
    assert.equal(reviewedWorld.snapshot.temporalProvenanceGraph.sourceSnapshotId, input.sourceSnapshotId);
    assert.deepEqual(reviewedWorld.snapshot.temporalProvenanceGraph.parentSourceSnapshotIds, current.snapshot.temporalProvenanceGraph.parentSourceSnapshotIds);
    assert.deepEqual(reviewedWorld.snapshot.temporalProvenanceGraph.revisionParentIds, current.snapshot.temporalProvenanceGraph.revisionParentIds);
    const capsule = compileContext({ root, task: "Explain the reviewed delivery implementation.", persist: false,
      evidenceNeeds: [{ id: "delivery-product", kind: "product-context", entityKeys: ["delivery"], minimumItems: 1 },
        { id: "delivery-source", kind: "repository-source", paths: ["src/delivery.mjs"], minimumItems: 1 }] }).capsule;
    assert.equal(capsule.coverageAssessment.status, "coverage-complete");
    assert.equal(capsule.coverageAssessment.semanticAcceptance, "not-assessed-HEAD-owned", "mechanical coverage does not grant semantic approval");
    assert.equal((await statusParity(root)).status, "product_ready");
    assert.deepEqual(authority(root), protectedBytes);
    assert.equal((await refreshWorldModel({ root })).status, "unchanged");
    const stable = bytes(root);
    assert.equal((await refreshWorldModel({ root })).status, "unchanged");
    assert.deepEqual(bytes(root), stable, "repeated unchanged refresh reuses its exact records");
  }
});

test("missing World guidance executes a rebuild and converges without reapproval", async (t) => {
  for (const missing of ["directory", "snapshot"]) {
    const { root, request, accepted } = await approvedFixture(t);
    const protectedBytes = authority(root);
    if (missing === "directory") fs.rmSync(path.join(root, ".head/world-model"), { recursive: true, force: true });
    else fs.unlinkSync(path.join(root, ".head/world-model/snapshots", `${accepted.worldModel.worldModelId}.json`));
    const beforeRead = bytes(root);
    const status = await statusParity(root);
    assert.equal(status.readiness.core.state, "ready");
    assert.equal(status.readiness.context.worldModelId, null);
    assert.equal(status.nextAction.entrypoint.worldOperation, "rebuild");
    assert.equal(status.nextAction.entrypoint.cli, "head-agent world-index <project>");
    assert.equal(inspectConversationalOnboarding({ root }).nextAction, "refresh_or_reconcile_world");
    assert.deepEqual(bytes(root), beforeRead);
    const command = status.nextAction.entrypoint.cli.split(" ")[1];
    await runCommand([command, root]);
    assert.equal((await statusParity(root)).status, "product_ready");
    assert.equal((await initializeOrResumeProject({ root, pluginRoot, profile: "product" })).status, "product_ready");
    assert.equal((await reviewOnboarding(request)).status, "onboarding_ready");
    assert.deepEqual(authority(root), protectedBytes);
    assert.equal((await refreshWorldModel({ root })).status, "unchanged");
    assert.equal((await statusParity(root)).status, "product_ready");
  }
});

test("mapping preserves real source drift and digest failures without preliminary indexing", async (t) => {
  const { root } = await approvedFixture(t);
  const input = proposal(root);
  const source = path.join(root, "src/delivery.mjs");
  const originalSource = fs.readFileSync(source);
  fs.appendFileSync(source, "\nexport const changed = true;\n");
  let before = bytes(root);
  await assert.rejects(() => startFeatureMapping({ root, semanticProposal: input }), { code: "FEATURE_MAPPING_SOURCE_DRIFT" });
  assert.deepEqual(bytes(root), before);
  fs.writeFileSync(source, originalSource);
  before = bytes(root);
  await assert.rejects(() => startFeatureMapping({ root, semanticProposal: { ...input, sourceSnapshotId: `source-snapshot-${"0".repeat(24)}` } }), { code: "FEATURE_MAPPING_PROPOSAL_DRIFT" });
  assert.deepEqual(bytes(root), before);
  const canonFile = path.join(root, ".head/context/product-model.json");
  const canonBytes = fs.readFileSync(canonFile);
  const changedCanon = JSON.parse(canonBytes);
  changedCanon.capabilities[0].description = "A different product contract.";
  fs.writeFileSync(canonFile, JSON.stringify(changedCanon));
  before = bytes(root);
  await assert.rejects(() => startFeatureMapping({ root, semanticProposal: input }), { code: "FEATURE_MAPPING_SOURCE_DRIFT" });
  await assert.rejects(() => statusParity(root), { code: "ONBOARDING_PRODUCT_CANON_DRIFT" });
  assert.deepEqual(bytes(root), before);
  fs.writeFileSync(canonFile, canonBytes);
  const pointer = JSON.parse(fs.readFileSync(path.join(root, ".head/world-model/current.json"), "utf8"));
  const filename = path.join(root, ".head/world-model/snapshots", `${pointer.worldModelId}.json`);
  const world = JSON.parse(fs.readFileSync(filename, "utf8"));
  world.worldModelHash = "0".repeat(64);
  fs.writeFileSync(filename, JSON.stringify(world));
  before = bytes(root);
  assert.throws(() => inspectWorldModel({ root }));
  await assert.rejects(() => startFeatureMapping({ root, semanticProposal: input }));
  await assert.rejects(() => statusParity(root));
  assert.deepEqual(bytes(root), before);
});

test("explicit mapping setup without a pinned proposal refreshes stale evidence in one operation", async (t) => {
  const { root } = await approvedFixture(t);
  const previous = inspectWorldModel({ root }).snapshot.temporalProvenanceGraph;
  const previousRevision = previous.nodes.find((node) => node.kind === "FileRevision" && node.path === "src/delivery.mjs");
  const protectedBytes = authority(root);
  fs.appendFileSync(path.join(root, "src/delivery.mjs"), "\nexport const deliveryFormat = 'message';\n");
  const setup = await startFeatureMapping({ root });
  assert.equal(setup.status, "awaiting_feature_mapping_evidence");
  assert.equal(setup.candidateSet.candidates.length, 0);
  assert.ok(setup.candidateSet.unknowns.length > 0);
  assert.equal(fs.existsSync(path.join(root, ".head/feature-mappings/review-decisions")), false, "setup does not manufacture a mapping decision");
  const current = inspectWorldModel({ root });
  assert.equal(current.status, "current");
  assert.ok(current.snapshot.temporalProvenanceGraph.parentSourceSnapshotIds.includes(previous.sourceSnapshotId));
  assert.ok(Object.values(current.snapshot.temporalProvenanceGraph.revisionParentIds).flat().includes(previousRevision.nodeId));
  assert.deepEqual(authority(root), protectedBytes);
  const started = await startFeatureMapping({ root, semanticProposal: proposal(root) });
  assert.equal(started.status, "awaiting_feature_mapping_review");
  assert.deepEqual(authority(root), protectedBytes);
});
