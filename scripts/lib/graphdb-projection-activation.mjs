import {
  ArcadeDbGraphProjectionAdapter,
  LocalJsonGraphProjectionAdapter,
  buildArcadeDbGraphProjectionActivation,
  buildArcadeDbGraphTopologyActivation,
  createActivatedArcadeDbGraphProjectionAdapter,
  inspectArcadeDbGraphProjectionActivation,
  inspectArcadeDbGraphTopologyActivation,
  persistArcadeDbGraphProjectionActivation,
  persistArcadeDbGraphTopologyActivation,
  verifyGraphProjectionAdapterConformance,
} from "./graph-projection-adapter.mjs";
import { inspectWorldGraphProjection, inspectWorldModel } from "./world-model.mjs";

const fail = (message, code = "ARCADEDB_ACTIVATION_ERROR") => {
  const error = new Error(message);
  error.code = code;
  throw error;
};

function conformanceQueries(graph) {
  const candidateKinds = new Set([
    "OnboardingCandidateSet", "OnboardingProductCandidate", "OnboardingEvidence", "OnboardingUnknown", "ProductConceptReference",
    "FeatureMappingCandidateSet", "FeatureMappingCandidate", "FeatureMappingEvidence", "FeatureMappingUnknown", "MappingEndpointReference",
    "ChangeImpactCandidateSet", "ChangeImpactCandidate", "ChangeImpactUnknown", "ChangeProductReference",
    "DocumentChangeCandidateSet", "DocumentChangeCandidate",
  ]);
  const anchor = graph.nodes.find((node) => node.freshness === "current" && !candidateKinds.has(node.kind)) || graph.nodes[0];
  if (!anchor) fail("GraphDB activation requires at least one GraphSnapshot node.", "ARCADEDB_ACTIVATION_EMPTY_GRAPH");
  return [
    {
      name: "current-anchor-exact",
      query: { query: anchor.nodeId, depth: 0, maxNodes: 25, maxEdges: 0 },
    },
    {
      name: "current-anchor-neighborhood",
      query: { query: anchor.nodeId, depth: 2, maxNodes: 100, maxEdges: 200 },
    },
  ];
}

export function activateArcadeDbGraphProjection({ root = ".", transport = null } = {}) {
  const world = inspectWorldModel({ root });
  if (world.status !== "current") fail("A current verified World Model is required before GraphDB activation.", "WORLD_MODEL_STALE");
  const configured = inspectArcadeDbGraphProjectionActivation({ projectRoot: world.snapshot.projectRoot });
  if (!configured.storageSelection || configured.storageSelection.mode !== "graphdb") {
    fail("Onboarding must select GraphDB before remote projection activation.", "ARCADEDB_SELECTION_REQUIRED");
  }
  const graph = world.snapshot.temporalProvenanceGraph;
  const remoteAdapter = new ArcadeDbGraphProjectionAdapter({ storageSelection: configured.storageSelection, transport });
  remoteAdapter.ensureSchema();
  verifyGraphProjectionAdapterConformance({
    projectRoot: world.snapshot.projectRoot,
    graph,
    referenceAdapter: new LocalJsonGraphProjectionAdapter({ projectRoot: world.snapshot.projectRoot }),
    candidateAdapter: remoteAdapter,
    queries: conformanceQueries(graph),
  });
  const topology = remoteAdapter.materializeTopology(graph);
  const serverTraversalAdapter = new ArcadeDbGraphProjectionAdapter({
    storageSelection: configured.storageSelection,
    transport,
    topologyRequired: true,
    serverTraversalRequired: true,
  });
  const conformanceReport = verifyGraphProjectionAdapterConformance({
    projectRoot: world.snapshot.projectRoot,
    graph,
    referenceAdapter: new LocalJsonGraphProjectionAdapter({ projectRoot: world.snapshot.projectRoot }),
    candidateAdapter: serverTraversalAdapter,
    queries: conformanceQueries(graph),
  });
  const topologyActivation = buildArcadeDbGraphTopologyActivation({
    storageSelection: configured.storageSelection,
    graph,
    topology,
  });
  const persistedTopology = persistArcadeDbGraphTopologyActivation({
    projectRoot: world.snapshot.projectRoot,
    activation: topologyActivation,
  });
  const activation = buildArcadeDbGraphProjectionActivation({
    storageSelection: configured.storageSelection,
    graph,
    conformanceReport,
  });
  const persisted = persistArcadeDbGraphProjectionActivation({ projectRoot: world.snapshot.projectRoot, activation, conformanceReport });
  return {
    status: "verified-active",
    projectId: world.snapshot.projectId,
    worldModelId: world.snapshot.worldModelId,
    graphSnapshotId: graph.graphSnapshotId,
    storageSelectionId: configured.storageSelection.storageSelectionId,
    activation: persisted.activation,
    pointer: persisted.pointer,
    conformanceReport,
    topology: persistedTopology.activation,
    traversalMode: conformanceReport.candidateAdapter.traversalMode,
    credentialsPersisted: false,
    authority: "rebuildable-derived-projection-not-project-canon",
  };
}

export function inspectArcadeDbGraphProjectionStatus({ root = ".", transport = null } = {}) {
  const world = inspectWorldModel({ root });
  const activation = inspectArcadeDbGraphProjectionActivation({ projectRoot: world.snapshot.projectRoot });
  const topology = inspectArcadeDbGraphTopologyActivation({
    projectRoot: world.snapshot.projectRoot,
    graph: world.snapshot.temporalProvenanceGraph,
  });
  if (activation.status !== "verified-active") return {
    status: activation.status,
    worldModelStatus: world.status,
    worldModelId: world.snapshot.worldModelId,
    graphSnapshotId: world.snapshot.temporalProvenanceGraph.graphSnapshotId,
    storageSelection: activation.storageSelection,
    activation: null,
    topology,
    traversalMode: null,
    credentialsPersisted: false,
    authority: "rebuildable-derived-projection-not-project-canon",
  };
  const adapter = createActivatedArcadeDbGraphProjectionAdapter({ projectRoot: world.snapshot.projectRoot, transport });
  const projection = inspectWorldGraphProjection({ root, graphProjectionAdapter: adapter });
  return {
    status: projection.status === "current" ? "verified-active-current" : projection.status,
    worldModelStatus: world.status,
    worldModelId: world.snapshot.worldModelId,
    graphSnapshotId: world.snapshot.temporalProvenanceGraph.graphSnapshotId,
    storageSelectionId: activation.storageSelection.storageSelectionId,
    activation: activation.activation,
    topology,
    projection: projection.projection,
    traversalMode: adapter.describe().traversalMode,
    credentialsPersisted: false,
    authority: "rebuildable-derived-projection-not-project-canon",
  };
}
