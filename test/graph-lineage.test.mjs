import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { compileContext } from "../scripts/lib/context-compiler.mjs";
import { createExecutionContract, createResultPacket, createWholePlanSnapshot } from "../scripts/lib/execution-lineage.mjs";
import { diffGraphLineage, inspectGraphLineage, projectExecutionLineageOverlay, traceGraphLineage } from "../scripts/lib/graph-lineage.mjs";
import { initializeProject } from "../scripts/lib/head-core.mjs";
import { buildWorldModel } from "../scripts/lib/world-model.mjs";
import { runCommand } from "../scripts/head.mjs";
import { dispatch as dispatchMcp, tools as mcpTools } from "../scripts/mcp-server.mjs";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "head-agent-graph-lineage-"));
  initializeProject({ root, pluginRoot, runtimes: ["codex"] });
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  return root;
}

test("projects retained graph genealogy without creating another artifact stream", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const content = "export const stable = true;\n";
  fs.writeFileSync(path.join(root, "src", "before.mjs"), content);
  const first = await buildWorldModel({ root });
  fs.renameSync(path.join(root, "src", "before.mjs"), path.join(root, "src", "after.mjs"));
  const second = await buildWorldModel({ root, parentSourceSnapshotIds: [first.snapshot.temporalProvenanceGraph.sourceSnapshotId] });

  const snapshotsDirectory = path.join(root, ".head", "world-model", "snapshots");
  const beforeRead = fs.readdirSync(snapshotsDirectory).sort();
  const status = inspectGraphLineage({ root, limit: 100 });
  const afterRead = fs.readdirSync(snapshotsDirectory).sort();
  assert.deepEqual(afterRead, beforeRead);
  assert.equal(status.totalRetainedSnapshots, 2);
  assert.equal(status.tiers.persistedSegmentArtifacts, false);
  assert.equal(status.authority.plane, "P4-derived-view");
  assert.equal(status.authority.ordinaryWorkBlocked, false);
  assert.equal(status.segment.entries.find((item) => item.worldModelId === second.snapshot.worldModelId).tier, "hot");
  assert.equal(status.segment.entries.find((item) => item.worldModelId === first.snapshot.worldModelId).tier, "warm");

  const diff = diffGraphLineage({ root, fromWorldModelId: first.snapshot.worldModelId, toWorldModelId: second.snapshot.worldModelId });
  assert.deepEqual(diff.changes.possibleMoves.items.map((item) => [item.fromPath, item.toPath]), [["src/before.mjs", "src/after.mjs"]]);
  assert.equal(diff.changes.possibleMoves.items[0].semanticContinuityClaimed, false);
  assert.equal(diff.semantics.reviewRequiredOnlyIfContinuityIsPromoted, true);

  const afterFile = second.snapshot.temporalProvenanceGraph.nodes.find((node) => node.kind === "File" && node.path === "src/after.mjs");
  const trace = traceGraphLineage({ root, anchorId: afterFile.nodeId, depth: 1 });
  assert.equal(trace.anchorMode, "exact");
  assert.equal(trace.graph.traversalQuery.anchorIds.includes(afterFile.nodeId), true);
  assert.equal(trace.semantics.graphWritesRecoveryDirection, false);

  const cli = await runCommand(["graph-lineage-diff", root, "--from", first.snapshot.worldModelId, "--to", second.snapshot.worldModelId]);
  assert.equal(cli.kind, "GraphLineageDiffProjection");
  assert.equal(mcpTools.some((tool) => tool.name === "head_graph_lineage_status"), true);
  const mcp = await dispatchMcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "head_graph_lineage_trace", arguments: { project_root: root, anchor_id: afterFile.nodeId, depth: 0 } } });
  assert.equal(mcp.result.structuredContent.kind, "GraphLineageTraceProjection");

  fs.writeFileSync(path.join(root, "src", "unindexed.mjs"), "export const drift = true;\n");
  assert.throws(() => traceGraphLineage({ root, anchorId: afterFile.nodeId }), { code: "WORLD_MODEL_STALE" });
  const historical = traceGraphLineage({ root, worldModelId: second.snapshot.worldModelId, anchorId: afterFile.nodeId, depth: 0 });
  assert.equal(historical.worldModelId, second.snapshot.worldModelId);
  assert.equal(historical.authority.ordinaryWorkBlocked, false);
});

test("execution overlay reads exact lineage but cannot promote or recover", (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const compiled = compileContext({ root, task: "Verify a bounded execution overlay", persist: true });
  const plan = createWholePlanSnapshot({ root, objective: "Keep graph reads non-authoritative", plan: ["create lineage", "read projection"] });
  const contract = createExecutionContract({
    root,
    wholePlanId: plan.artifact.wholePlanId,
    capsuleId: compiled.capsule.capsuleId,
    scope: "Read exact execution lineage",
    acceptanceCriteria: ["No authority amplification"],
  });
  const result = createResultPacket({
    root,
    executionContractId: contract.artifact.executionContractId,
    outcome: "Projection verified",
    evidence: [{ uri: "test/graph-lineage.test.mjs", digest: "graph-lineage-test", summary: "bounded test evidence" }],
    verification: [{ check: "graph lineage test", status: "passed" }],
  });
  const overlay = projectExecutionLineageOverlay(root, { nodes: [{ kind: "ExecutionLineageReference", referencedArtifactId: result.artifact.resultPacketId }] });
  const ids = new Set(overlay.artifacts.map((item) => item.artifactId));
  assert.equal(ids.has(result.artifact.resultPacketId), true);
  assert.equal(ids.has(contract.artifact.executionContractId), true);
  assert.equal(ids.has(plan.artifact.wholePlanId), true);
  assert.equal(overlay.authority.instructionAuthority, false);
  assert.equal(overlay.authority.promotionAuthority, false);
  assert.equal(overlay.authority.recoveryAuthority, false);
});
