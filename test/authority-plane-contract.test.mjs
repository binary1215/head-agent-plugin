import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  artifactAuthorityBoundary,
  assertNoAuthorityAmplification,
  assertProjectionDidNotMutateCanon,
  assertReceiptProjectedOnlyInChild,
  authorityPlaneContract,
  verifyArtifactAuthorityBoundary,
} from "../scripts/lib/authority-plane-contract.mjs";
import { initializeProject } from "../scripts/lib/head-core.mjs";
import { InMemoryGraphProjectionAdapter } from "../scripts/lib/graph-projection-adapter.mjs";
import { buildWorldModel } from "../scripts/lib/world-model.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");

function temporaryProject() {
  const parent = process.env.HEAD_AGENT_TEST_TMP || os.tmpdir();
  fs.mkdirSync(parent, { recursive: true });
  return fs.mkdtempSync(path.join(parent, "head-authority-plane-test-"));
}

test("freezes the five semantic authority planes separately from Distribution and Host", () => {
  const first = authorityPlaneContract();
  const second = authorityPlaneContract();
  assert.equal(first.contractId, second.contractId);
  assert.equal(first.contractHash, second.contractHash);
  assert.deepEqual(Object.keys(first.semanticPlanes), ["P1", "P2", "P3", "P4", "P5"]);
  assert.deepEqual(Object.keys(first.architecturalPlanes), ["Distribution", "Host"]);
  assert.equal(artifactAuthorityBoundary("ReviewDecision").planeId, "P1");
  assert.equal(artifactAuthorityBoundary("ProductCanonFeature").planeId, "P1");
  assert.equal(artifactAuthorityBoundary("FeatureCandidate").planeId, "P3");
  assert.equal(artifactAuthorityBoundary("SessionRunCheckpoint").planeId, "P2");
  assert.equal(artifactAuthorityBoundary("ResultPacket").planeId, "P3");
  assert.equal(artifactAuthorityBoundary("RunResultIntegrationRequest").planeId, "P3");
  assert.equal(artifactAuthorityBoundary("RunResultIntegrationReceipt").planeId, "P3");
  assert.equal(artifactAuthorityBoundary("GraphSnapshot").planeId, "P4");
  assert.equal(artifactAuthorityBoundary("SessionRestoreProjection").planeId, "P4");
  assert.equal(artifactAuthorityBoundary("CoordinationInbox").planeId, "P5");
  verifyArtifactAuthorityBoundary("GraphSnapshot", artifactAuthorityBoundary("GraphSnapshot"));
  verifyArtifactAuthorityBoundary("ResultPacket", { ...artifactAuthorityBoundary("ResultPacket"), contractVersion: "0.1.0" });
});

test("rejects upward authority amplification and projection mutation without explicit review", () => {
  assert.throws(() => assertNoAuthorityAmplification({ sourceKind: "GraphSnapshot", targetKind: "ProductCanon" }), {
    code: "AUTHORITY_AMPLIFICATION_REJECTED",
  });
  const reviewed = assertNoAuthorityAmplification({
    sourceKind: "CandidateSet",
    targetKind: "ProductCanon",
    reviewDecision: {
      kind: "ReviewDecision",
      reviewDecisionId: `review-decision-${"a".repeat(24)}`,
      promotionAuthority: true,
      authorityBoundary: artifactAuthorityBoundary("ReviewDecision"),
    },
    effect: "apply-exact-reviewed-product-model",
  });
  assert.equal(reviewed.reviewDecisionRequired, true);
  assert.throws(() => assertNoAuthorityAmplification({ sourceKind: "ResultPacket", targetKind: "SessionRunCheckpoint" }), {
    code: "RECOVERY_AUTHORITY_AMPLIFICATION_REJECTED",
  });
  assert.throws(() => assertNoAuthorityAmplification({ sourceKind: "GraphSnapshot", targetKind: "SessionRunCheckpoint" }), {
    code: "RECOVERY_AUTHORITY_AMPLIFICATION_REJECTED",
  });
  assert.throws(() => assertNoAuthorityAmplification({ sourceKind: "ProviderSessionReference", targetKind: "SessionRunCheckpoint" }), {
    code: "RECOVERY_AUTHORITY_AMPLIFICATION_REJECTED",
  });
  assert.throws(() => assertProjectionDidNotMutateCanon({ beforeBytes: Buffer.from("canon-a"), afterBytes: Buffer.from("canon-b") }), {
    code: "GRAPH_PROJECTION_AUTHORITY_AMPLIFICATION",
  });
});

test("forbids receipt self-reference and requires a later child projection", () => {
  const proof = {
    receiptId: "receipt-1",
    namedGraphSnapshotId: "graph-snapshot-parent",
    namedGraphReceiptIds: [],
    namedSourceSnapshotId: "source-snapshot-parent",
    childGraphSnapshotId: "graph-snapshot-child",
    childParentSourceSnapshotIds: ["source-snapshot-parent"],
    childGraphReceiptIds: ["receipt-1"],
  };
  assert.equal(assertReceiptProjectedOnlyInChild(proof), true);
  assert.throws(() => assertReceiptProjectedOnlyInChild({ ...proof, namedGraphReceiptIds: ["receipt-1"] }), {
    code: "GRAPH_SNAPSHOT_RECEIPT_SELF_REFERENCE",
  });
  assert.throws(() => assertReceiptProjectedOnlyInChild({ ...proof, childGraphReceiptIds: [] }), {
    code: "GRAPH_SNAPSHOT_RECEIPT_CHILD_REQUIRED",
  });
});

test("fences actual graph materialization from Product Canon bytes", async (t) => {
  const root = temporaryProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "service.mjs"), "export const ready = true;\n");
  initializeProject({ root, pluginRoot, runtimes: ["codex"] });
  const canonFile = path.join(root, ".head", "context", "product-model.json");
  const canonBefore = fs.readFileSync(canonFile);
  const adapter = new InMemoryGraphProjectionAdapter({ adapterKind: "canon-mutating-projection-test" });
  const writeSnapshot = adapter.writeSnapshot.bind(adapter);
  adapter.writeSnapshot = (graphSnapshotId, document) => {
    fs.writeFileSync(canonFile, "projection attempted to replace Product Canon\n");
    return writeSnapshot(graphSnapshotId, document);
  };
  await assert.rejects(buildWorldModel({ root, graphProjectionAdapter: adapter }), {
    code: "GRAPH_PROJECTION_AUTHORITY_AMPLIFICATION",
  });
  assert.deepEqual(fs.readFileSync(canonFile), canonBefore);
});
