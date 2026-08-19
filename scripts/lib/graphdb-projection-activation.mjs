import {
  ArcadeDbGraphProjectionAdapter,
  LocalJsonGraphProjectionAdapter,
  buildArcadeDbGraphProjectionActivation,
  buildArcadeDbGraphTopologyActivation,
  buildGraphProjectionPointer,
  createActivatedArcadeDbGraphProjectionAdapter,
  inspectArcadeDbGraphProjectionActivation,
  inspectArcadeDbIncrementalSyncReceipt,
  inspectArcadeDbGraphTopologyActivation,
  persistArcadeDbIncrementalSyncReceipt,
  persistArcadeDbGraphProjectionActivation,
  persistArcadeDbGraphTopologyActivation,
  verifyGraphProjectionAdapterConformance,
} from "./graph-projection-adapter.mjs";
import { buildArcadeDbIncrementalSyncReceipt, incrementalSyncCanonicalJson } from "./arcadedb-incremental-sync.mjs";
import { inspectArcadeDbDatabaseCompatibility } from "./arcadedb-database-lifecycle.mjs";
import { inspectWorldGraphProjection, inspectWorldModel } from "./world-model.mjs";

const fail = (message, code = "ARCADEDB_ACTIVATION_ERROR") => {
  const error = new Error(message);
  error.code = code;
  throw error;
};

function activationStage(name, operation) {
  try { return operation(); }
  catch (error) { fail(`ArcadeDB activation stage failed: ${name}.`, `ARCADEDB_ACTIVATION_STAGE_${name.toUpperCase().replaceAll("-", "_")}:${error.code || "UNKNOWN"}`); }
}

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
  const databaseAudit = inspectArcadeDbDatabaseCompatibility({ root: world.snapshot.projectRoot, transport });
  if (!databaseAudit.databaseExists) {
    fail("The selected ArcadeDB database is missing; initialize it explicitly before activation.", "ARCADEDB_DATABASE_INITIALIZATION_REQUIRED");
  }
  if (!databaseAudit.canActivateWithoutReset) {
    fail("The selected ArcadeDB database has an incompatible reserved schema.", "ARCADEDB_DATABASE_INCOMPATIBLE");
  }
  const graph = world.snapshot.temporalProvenanceGraph;
  const localAdapter = new LocalJsonGraphProjectionAdapter({ projectRoot: world.snapshot.projectRoot });
  const localPointer = localAdapter.readPointer();
  const localBase = localPointer == null ? null : localAdapter.readSnapshot(localPointer.document.graphSnapshotId)?.document || null;
  const targetPointer = buildGraphProjectionPointer(graph);
  const remoteAdapter = new ArcadeDbGraphProjectionAdapter({
    storageSelection: configured.storageSelection,
    transport,
    topologyRequired: true,
    incrementalSyncRequired: true,
    baseGraph: localBase,
  });
  remoteAdapter.ensureSchema();
  activationStage("incremental-snapshot-sync", () => remoteAdapter.writeSnapshot(graph.graphSnapshotId, graph));
  const topology = remoteAdapter.pendingIncrementalSync?.topology;
  if (!topology) fail("Incremental GraphDB sync did not produce verified topology evidence.", "ARCADEDB_INCREMENTAL_SYNC_TOPOLOGY_MISSING");
  const baselineAdapter = new ArcadeDbGraphProjectionAdapter({
    storageSelection: configured.storageSelection,
    transport,
    stagedPointer: targetPointer,
  });
  activationStage("baseline-conformance", () => verifyGraphProjectionAdapterConformance({
    projectRoot: world.snapshot.projectRoot,
    graph,
    referenceAdapter: localAdapter,
    candidateAdapter: baselineAdapter,
    queries: conformanceQueries(graph),
  }));
  const serverTraversalAdapter = new ArcadeDbGraphProjectionAdapter({
    storageSelection: configured.storageSelection,
    transport,
    topologyRequired: true,
    serverTraversalRequired: true,
    preparedTraversalRequired: true,
    stagedPointer: targetPointer,
  });
  const conformanceReport = activationStage("server-conformance", () => verifyGraphProjectionAdapterConformance({
    projectRoot: world.snapshot.projectRoot,
    graph,
    referenceAdapter: localAdapter,
    candidateAdapter: serverTraversalAdapter,
    queries: conformanceQueries(graph),
  }));
  const localSnapshot = activationStage("local-recovery-snapshot", () => localAdapter.writeSnapshot(graph.graphSnapshotId, graph));
  if (incrementalSyncCanonicalJson(localSnapshot.document) !== incrementalSyncCanonicalJson(graph)) {
    fail("Local recovery GraphSnapshot differs from the verified remote target.", "ARCADEDB_INCREMENTAL_SYNC_LOCAL_MIRROR_MISMATCH");
  }
  const remotePointer = activationStage("atomic-pointer-transition", () => remoteAdapter.writePointer(targetPointer));
  const localMirrorPointer = activationStage("local-recovery-pointer", () => localAdapter.writePointer(targetPointer));
  if (incrementalSyncCanonicalJson(remotePointer.document) !== incrementalSyncCanonicalJson(localMirrorPointer.document)) {
    fail("Local recovery pointer differs from the verified remote pointer.", "ARCADEDB_INCREMENTAL_SYNC_LOCAL_MIRROR_MISMATCH");
  }
  const completedSync = remoteAdapter.takeCompletedIncrementalSync();
  if (!completedSync) fail("Incremental GraphDB sync completion evidence is missing.", "ARCADEDB_INCREMENTAL_SYNC_RECEIPT_MISSING");
  const syncReceipt = buildArcadeDbIncrementalSyncReceipt({
    manifest: completedSync.manifest,
    syncState: completedSync.syncState,
    pointerBefore: completedSync.pointerBefore,
    pointerAfter: completedSync.pointerAfter,
    snapshotVerified: true,
    topologyVerified: true,
    localMirrorVerified: true,
  });
  const persistedSync = persistArcadeDbIncrementalSyncReceipt({ projectRoot: world.snapshot.projectRoot, receipt: syncReceipt });
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
    incrementalSync: persistedSync.receipt,
    databaseAuditId: databaseAudit.auditId,
    databaseAuditHash: databaseAudit.auditHash,
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
  const incrementalSync = inspectArcadeDbIncrementalSyncReceipt({
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
    incrementalSync,
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
    incrementalSync,
    projection: projection.projection,
    traversalMode: adapter.describe().traversalMode,
    credentialsPersisted: false,
    authority: "rebuildable-derived-projection-not-project-canon",
  };
}
