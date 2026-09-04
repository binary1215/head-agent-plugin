import crypto from "node:crypto";
import { inspectProject } from "./head-core.mjs";
import { readLineageArtifact } from "./execution-lineage.mjs";
import { queryTemporalProvenanceGraph } from "./temporal-provenance.mjs";
import { createWorldModelStoreAdapter } from "./world-model-store.mjs";
import { inspectWorldModel, readWorldModel, readWorldModelSnapshot } from "./world-model.mjs";

export const GRAPH_LINEAGE_VIEW_VERSION = "0.1.0";
const PAGE_LIMIT_MAX = 100;
const TRACE_ARTIFACT_LIMIT = 128;

const fail = (message, code = "GRAPH_LINEAGE_ERROR") => { const error = new Error(message); error.code = code; throw error; };
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
const canonicalJson = (value) => JSON.stringify(canonical(value));

function authority() {
  return {
    plane: "P4-derived-view",
    persistence: "none",
    instructionAuthority: false,
    promotionAuthority: false,
    recoveryAuthority: false,
    ordinaryWorkBlocked: false,
  };
}

function readyProject(root) {
  const inspected = inspectProject(root);
  if (inspected.status !== "ready") fail(`Project must be ready for Graph lineage inspection; current status: ${inspected.status}.`, "PROJECT_NOT_READY");
  return inspected;
}

function normalizeLimit(value, fallback, maximum, label) {
  const selected = value == null ? fallback : Number(value);
  if (!Number.isInteger(selected) || selected < 1 || selected > maximum) fail(`${label} must be from 1 to ${maximum}.`, "INVALID_GRAPH_LINEAGE_LIMIT");
  return selected;
}

function snapshotDescriptor(snapshot, currentWorldModelId, currentParentSourceIds) {
  const graph = snapshot.temporalProvenanceGraph;
  const tier = snapshot.worldModelId === currentWorldModelId
    ? "hot"
    : currentParentSourceIds.has(graph.sourceSnapshotId) ? "warm" : "cold";
  return {
    worldModelId: snapshot.worldModelId,
    worldModelHash: snapshot.worldModelHash,
    graphSnapshotId: graph.graphSnapshotId,
    graphSnapshotHash: graph.graphSnapshotHash,
    sourceSnapshotId: graph.sourceSnapshotId,
    parentSourceSnapshotIds: graph.parentSourceSnapshotIds,
    productModelId: snapshot.productModel?.productModelId || null,
    tier,
  };
}

export function inspectGraphLineage({ root = ".", cursor = "", limit = 25, storeAdapter = null } = {}) {
  const inspected = readyProject(root);
  const selectedLimit = normalizeLimit(limit, 25, PAGE_LIMIT_MAX, "Graph lineage page limit");
  const current = readWorldModel({ root: inspected.project.projectRoot, storeAdapter });
  const adapter = createWorldModelStoreAdapter({ projectRoot: inspected.project.projectRoot, adapter: storeAdapter });
  const ids = adapter.listSnapshotIds();
  const start = cursor ? ids.findIndex((id) => id === cursor) + 1 : 0;
  if (cursor && start === 0) fail("Graph lineage cursor is not a retained World Model snapshot.", "INVALID_GRAPH_LINEAGE_CURSOR");
  const pageIds = ids.slice(start, start + selectedLimit);
  const currentParents = new Set(current.snapshot.temporalProvenanceGraph.parentSourceSnapshotIds);
  const snapshots = pageIds.map((worldModelId) => readWorldModelSnapshot({ root: inspected.project.projectRoot, worldModelId, storeAdapter: adapter }).snapshot);
  const entries = snapshots.map((snapshot) => snapshotDescriptor(snapshot, current.snapshot.worldModelId, currentParents));
  const segmentPayload = { projectId: inspected.project.projectId, cursor: cursor || null, entries };
  const segmentHash = digest(canonicalJson(segmentPayload));
  return {
    kind: "GraphLineageStatusProjection",
    protocol: { name: "head-agent-core-graph-lineage-view", version: GRAPH_LINEAGE_VIEW_VERSION },
    projectId: inspected.project.projectId,
    currentWorldModelId: current.snapshot.worldModelId,
    totalRetainedSnapshots: ids.length,
    segment: { segmentId: `graph-lineage-segment-${segmentHash.slice(0, 24)}`, segmentHash, entries },
    nextCursor: start + pageIds.length < ids.length ? pageIds.at(-1) : null,
    tiers: {
      hot: "current verified World Model snapshot",
      warm: "direct SourceSnapshot parents of the current graph",
      cold: "other retained content-addressed snapshots",
      persistedSegmentArtifacts: false,
    },
    authority: authority(),
  };
}

function selectedSnapshot({ root, worldModelId, requireCurrent, storeAdapter }) {
  if (worldModelId) return readWorldModelSnapshot({ root, worldModelId, storeAdapter }).snapshot;
  if (requireCurrent) {
    const inspected = inspectWorldModel({ root, storeAdapter });
    if (inspected.status !== "current") fail("Current World Model is stale; refresh it or select an exact retained snapshot.", "WORLD_MODEL_STALE");
    return inspected.snapshot;
  }
  return readWorldModel({ root, storeAdapter }).snapshot;
}

export function projectExecutionLineageOverlay(root, graphResult) {
  const initial = new Set();
  for (const node of graphResult.nodes) {
    if (node.kind === "ExecutionLineageReference" && node.referencedArtifactId) initial.add(node.referencedArtifactId);
    if (node.kind === "ChangeSet") for (const field of ["wholePlanId", "executionContractId", "resultPacketId", "executionReviewDecisionId"]) if (node[field]) initial.add(node[field]);
  }
  const queue = [...initial].sort();
  const seen = new Set();
  const artifacts = [];
  const edges = [];
  const unavailable = [];
  while (queue.length && artifacts.length < TRACE_ARTIFACT_LIMIT) {
    const artifactId = queue.shift();
    if (seen.has(artifactId)) continue;
    seen.add(artifactId);
    try {
      const artifact = readLineageArtifact({ root, artifactId }).artifact;
      artifacts.push({
        artifactId,
        kind: artifact.kind,
        artifactHash: artifact.artifactHash,
        authority: artifact.authority,
        instructionAuthority: artifact.instructionAuthority,
        promotionAuthority: artifact.promotionAuthority,
      });
      for (const link of artifact.lineage || []) {
        edges.push({ relation: link.relation, from: artifactId, to: link.targetId });
        if (!seen.has(link.targetId)) queue.push(link.targetId);
      }
      queue.sort();
    } catch (error) {
      unavailable.push({ artifactId, reasonCode: String(error?.code || "LINEAGE_ARTIFACT_UNAVAILABLE") });
    }
  }
  return {
    artifacts: artifacts.sort((a, b) => a.artifactId.localeCompare(b.artifactId)),
    edges: edges.sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b))),
    unavailable: unavailable.sort((a, b) => a.artifactId.localeCompare(b.artifactId)),
    omittedArtifactCount: queue.length,
    authority: authority(),
  };
}

export function traceGraphLineage({
  root = ".", worldModelId = "", anchorId = "", query = "", depth = 2,
  maxNodes = 100, maxEdges = 200, includeExecution = true, storeAdapter = null,
} = {}) {
  const inspected = readyProject(root);
  if (!anchorId && !String(query || "").trim()) fail("Graph lineage trace requires an exact anchorId or discovery query.", "GRAPH_LINEAGE_ANCHOR_REQUIRED");
  const snapshot = selectedSnapshot({ root: inspected.project.projectRoot, worldModelId, requireCurrent: !worldModelId, storeAdapter });
  const graph = snapshot.temporalProvenanceGraph;
  const result = queryTemporalProvenanceGraph(graph, {
    anchorIds: anchorId ? [anchorId] : null,
    query: anchorId ? null : query,
    expectedGraphSnapshotId: graph.graphSnapshotId,
    freshness: ["current", "stale", "historical"],
    includeUnreviewedCandidates: true,
    depth,
    maxNodes,
    maxEdges,
  });
  return {
    kind: "GraphLineageTraceProjection",
    protocol: { name: "head-agent-core-graph-lineage-view", version: GRAPH_LINEAGE_VIEW_VERSION },
    projectId: inspected.project.projectId,
    worldModelId: snapshot.worldModelId,
    graphSnapshotId: graph.graphSnapshotId,
    anchorMode: anchorId ? "exact" : "discovery",
    graph: result,
    executionLineage: includeExecution ? projectExecutionLineageOverlay(inspected.project.projectRoot, result) : null,
    semantics: {
      discoverySelectsAuthority: false,
      graphWritesRecoveryDirection: false,
      executionCompletionImpliesIntegration: false,
    },
    authority: authority(),
  };
}

function boundedChanges(values, limit) {
  return { count: values.length, items: values.slice(0, limit), omittedCount: Math.max(0, values.length - limit) };
}

function possibleMoves(fromSnapshot, toSnapshot) {
  const before = new Map(fromSnapshot.files.map((item) => [item.path, item.digest]));
  const after = new Map(toSnapshot.files.map((item) => [item.path, item.digest]));
  const removed = [...before].filter(([path]) => !after.has(path));
  const added = [...after].filter(([path]) => !before.has(path));
  const moves = [];
  for (const [fromPath, fromDigest] of removed) for (const [toPath, toDigest] of added) if (fromDigest === toDigest) moves.push({
    fromPath, toPath, digest: fromDigest,
    classification: "exact-content-possible-move",
    semanticContinuityClaimed: false,
    automaticSameAsRelation: false,
    reviewRequiredOnlyForSemanticPromotion: true,
  });
  return moves.sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
}

export function diffGraphLineage({ root = ".", fromWorldModelId, toWorldModelId, limit = 100, storeAdapter = null } = {}) {
  const inspected = readyProject(root);
  const selectedLimit = normalizeLimit(limit, 100, 500, "Graph lineage diff limit");
  if (fromWorldModelId === toWorldModelId) fail("Graph lineage diff requires two different snapshots.", "GRAPH_LINEAGE_DIFF_IDENTICAL");
  const fromSnapshot = readWorldModelSnapshot({ root: inspected.project.projectRoot, worldModelId: fromWorldModelId, storeAdapter }).snapshot;
  const toSnapshot = readWorldModelSnapshot({ root: inspected.project.projectRoot, worldModelId: toWorldModelId, storeAdapter }).snapshot;
  const beforeNodes = new Map(fromSnapshot.temporalProvenanceGraph.nodes.map((node) => [node.nodeId, node]));
  const afterNodes = new Map(toSnapshot.temporalProvenanceGraph.nodes.map((node) => [node.nodeId, node]));
  const beforeEdges = new Map(fromSnapshot.temporalProvenanceGraph.edges.map((edge) => [edge.edgeId, edge]));
  const afterEdges = new Map(toSnapshot.temporalProvenanceGraph.edges.map((edge) => [edge.edgeId, edge]));
  const addedNodes = [...afterNodes.keys()].filter((id) => !beforeNodes.has(id)).sort();
  const removedNodes = [...beforeNodes.keys()].filter((id) => !afterNodes.has(id)).sort();
  const changedNodes = [...afterNodes.keys()].filter((id) => beforeNodes.has(id) && canonicalJson(afterNodes.get(id)) !== canonicalJson(beforeNodes.get(id))).sort();
  const addedEdges = [...afterEdges.keys()].filter((id) => !beforeEdges.has(id)).sort();
  const removedEdges = [...beforeEdges.keys()].filter((id) => !afterEdges.has(id)).sort();
  const moves = possibleMoves(fromSnapshot, toSnapshot);
  return {
    kind: "GraphLineageDiffProjection",
    protocol: { name: "head-agent-core-graph-lineage-view", version: GRAPH_LINEAGE_VIEW_VERSION },
    projectId: inspected.project.projectId,
    from: { worldModelId: fromSnapshot.worldModelId, graphSnapshotId: fromSnapshot.temporalProvenanceGraph.graphSnapshotId, sourceSnapshotId: fromSnapshot.temporalProvenanceGraph.sourceSnapshotId },
    to: { worldModelId: toSnapshot.worldModelId, graphSnapshotId: toSnapshot.temporalProvenanceGraph.graphSnapshotId, sourceSnapshotId: toSnapshot.temporalProvenanceGraph.sourceSnapshotId },
    changes: {
      addedNodes: boundedChanges(addedNodes, selectedLimit),
      removedNodes: boundedChanges(removedNodes, selectedLimit),
      changedNodes: boundedChanges(changedNodes, selectedLimit),
      addedEdges: boundedChanges(addedEdges, selectedLimit),
      removedEdges: boundedChanges(removedEdges, selectedLimit),
      possibleMoves: boundedChanges(moves, selectedLimit),
    },
    semantics: {
      exactContentPossibleMoveIsIdentityProof: false,
      semanticContinuityRequiresHeadProposal: true,
      reviewRequiredOnlyIfContinuityIsPromoted: true,
    },
    authority: authority(),
  };
}
