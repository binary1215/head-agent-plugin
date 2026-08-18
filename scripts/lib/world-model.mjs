import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { inspectProject, SCHEMA_VERSION } from "./head-core.mjs";
import {
  buildGitDecisionHistory,
  GIT_DECISION_HISTORY_VERSION,
  GIT_HISTORY_ADAPTER_VERSION,
  queryGitDecisionHistory,
  verifyGitDecisionHistory,
} from "./git-history.mjs";
import { buildSemanticGraph, querySemanticGraph, SEMANTIC_GRAPH_VERSION, verifySemanticGraph } from "./semantic-graph.mjs";
import { normalizeProductModelDocument, PRODUCT_MODEL_VERSION, readProductModelCanon } from "./product-model.mjs";
import { loadOnboardingGraphProjection, ONBOARDING_GRAPH_PROJECTION_VERSION } from "./onboarding-projection.mjs";
import { FEATURE_MAPPING_VERSION, loadFeatureMappingProjection } from "./feature-mapping-projection.mjs";
import {
  CHANGE_SET_PROJECTION_VERSION,
  CHANGE_SET_VERSION,
  loadChangeSetProjection,
  VCS_EVIDENCE_VERSION,
} from "./change-set-projection.mjs";
import {
  buildRepositoryScanInput,
  createRepositoryScanComputeAdapter,
  executeRepositoryScan,
  managedRootFilesForProject,
  REPOSITORY_SCAN_DEFAULTS,
  REPOSITORY_SCAN_EXCLUDED_DIRECTORIES,
  REPOSITORY_SCAN_VERSION,
  scanRepositoryReference,
  validateRepositoryScanResult,
} from "./repository-scan.mjs";
import {
  buildTemporalProvenanceGraph,
  queryTemporalProvenanceGraph,
  TEMPORAL_PROVENANCE_VERSION,
  verifyTemporalProvenanceGraph,
} from "./temporal-provenance.mjs";
import {
  buildExternalRuntimeState,
  EXTERNAL_RUNTIME_STATE_VERSION,
  queryExternalRuntimeState,
  RUNTIME_STATE_ADAPTER_VERSION,
  runtimeStateAdapterFromDescriptor,
  verifyExternalRuntimeState,
} from "./runtime-state.mjs";
import {
  createWorldModelStoreAdapter,
  WORLD_MODEL_STORAGE_CONTRACT,
} from "./world-model-store.mjs";

export const WORLD_MODEL_VERSION = "0.8.0";
export const WORLD_MODEL_STORE = WORLD_MODEL_STORAGE_CONTRACT;

const fail = (message, code = "WORLD_MODEL_ERROR") => {
  const error = new Error(message);
  error.code = code;
  throw error;
};

const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonical(value));
}

function readyProject(root) {
  const inspected = inspectProject(root);
  if (inspected.status !== "ready") {
    fail(`Project must be ready to build a World Model; current status: ${inspected.status}.`, "PROJECT_NOT_READY");
  }
  return inspected;
}

function gitReferenceState(gitPath) {
  const files = [];
  const references = new Map();
  const tagNames = new Set();
  const add = (file, relative) => {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return;
    const normalized = relative.replaceAll("\\", "/");
    const content = fs.readFileSync(file, "utf8");
    files.push({ path: normalized, digest: digest(content) });
    if (/^refs\/(?:heads|remotes)\//.test(normalized)) {
      const value = content.trim().toLocaleLowerCase();
      if (/^[a-f0-9]{40,64}$/.test(value)) references.set(normalized, value);
    }
    if (normalized.startsWith("refs/tags/")) tagNames.add(normalized.slice("refs/tags/".length));
  };
  add(path.join(gitPath, "HEAD"), "HEAD");
  add(path.join(gitPath, "packed-refs"), "packed-refs");
  const packedRefs = path.join(gitPath, "packed-refs");
  if (fs.existsSync(packedRefs)) for (const line of fs.readFileSync(packedRefs, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([a-f0-9]{40,64})\s+(refs\/(?:heads|remotes)\/[A-Za-z0-9._\/-]+)$/i);
    if (match) references.set(match[2], match[1].toLocaleLowerCase());
    const tag = line.match(/^[a-f0-9]{40,64}\s+refs\/tags\/(.+)$/i);
    if (tag) tagNames.add(tag[1]);
  }
  const refsRoot = path.join(gitPath, "refs");
  const stack = fs.existsSync(refsRoot) ? [refsRoot] : [];
  while (stack.length) {
    const directory = stack.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) stack.push(absolute);
      else if (entry.isFile()) add(absolute, path.relative(gitPath, absolute));
    }
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  return {
    referencesDigest: digest(canonicalJson(files)),
    references: [...references.entries()].map(([ref, commit]) => ({ ref, commit })).sort((left, right) => left.ref.localeCompare(right.ref)),
    tagNames: [...tagNames].sort(),
  };
}

function gitHeadState(root) {
  const gitPath = path.join(root, ".git");
  if (!fs.existsSync(gitPath)) return { status: "not-a-git-repository", ref: "", commit: "", referencesDigest: "" };
  if (!fs.statSync(gitPath).isDirectory()) return { status: "external-gitdir-not-followed", ref: "", commit: "", referencesDigest: "" };
  const referenceState = gitReferenceState(gitPath);
  const { referencesDigest, references, tagNames } = referenceState;
  const referencedCommits = () => [...new Set(references.map((item) => item.commit))].sort();
  const headFile = path.join(gitPath, "HEAD");
  if (!fs.existsSync(headFile)) return { status: "head-missing", ref: "", commit: "", referencesDigest, references, referenceCommits: referencedCommits(), referenceTags: tagNames };
  const head = fs.readFileSync(headFile, "utf8").trim();
  if (!head.startsWith("ref: ")) return {
    status: /^[a-f0-9]{40,64}$/i.test(head) ? "detached-head" : "invalid-head",
    ref: "",
    commit: /^[a-f0-9]{40,64}$/i.test(head) ? head.toLowerCase() : "",
    referencesDigest,
    references,
    referenceCommits: [...new Set([...referencedCommits(), ...(/^[a-f0-9]{40,64}$/i.test(head) ? [head.toLowerCase()] : [])])].sort(),
    referenceTags: tagNames,
  };
  const ref = head.slice(5).trim().replaceAll("\\", "/");
  if (!/^refs\/[A-Za-z0-9._\/-]+$/.test(ref) || ref.includes("../")) return { status: "invalid-ref", ref, commit: "", referencesDigest, references, referenceCommits: referencedCommits(), referenceTags: tagNames };
  const refFile = path.join(gitPath, ...ref.split("/"));
  let commit = "";
  if (fs.existsSync(refFile)) {
    const value = fs.readFileSync(refFile, "utf8").trim();
    if (/^[a-f0-9]{40,64}$/i.test(value)) commit = value.toLowerCase();
  }
  if (!commit) commit = references.find((item) => item.ref === ref)?.commit || "";
  return {
    status: commit ? "head-and-local-refs" : "unresolved-ref",
    ref,
    commit,
    referencesDigest,
    references,
    referenceCommits: [...new Set([...referencedCommits(), ...(commit ? [commit] : [])])].sort(),
    referenceTags: tagNames,
  };
}

function runtimeStateFor(state) {
  return canonical({
    sessionId: state.sessionId || "",
    mode: state.mode || "session",
    currentWholePlanId: state.currentWholePlanId || null,
    activeRunId: state.activeRunId || null,
    activeExecutionContractId: state.activeExecutionContractId || null,
    lastResultPacketId: state.lastResultPacketId || null,
    pendingReview: state.pendingReview || null,
    lastReviewDecisionId: state.lastReviewDecisionId || null,
    requiredPlanAction: state.requiredPlanAction || null,
    latestCheckpoint: state.latestCheckpoint || null,
  });
}

function verifiedSnapshot(snapshot, expectedId = "") {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) fail("World Model snapshot is invalid.", "INVALID_WORLD_MODEL");
  const recordedHash = snapshot.worldModelHash;
  const recordedId = snapshot.worldModelId;
  const payload = { ...snapshot };
  delete payload.worldModelId;
  delete payload.worldModelHash;
  const actualHash = digest(canonicalJson(payload));
  if (recordedHash !== actualHash || recordedId !== `world-model-${actualHash.slice(0, 24)}` || (expectedId && recordedId !== expectedId)) {
    fail("World Model snapshot digest verification failed.", "WORLD_MODEL_DIGEST_MISMATCH");
  }
  if (snapshot.repositoryScan) validateRepositoryScanResult({
    schemaVersion: 1,
    kind: "RepositoryScanResult",
    ...snapshot.repositoryScan,
    files: snapshot.files,
    skipped: snapshot.skipped,
  });
  if (snapshot.semanticGraph) verifySemanticGraph(snapshot.semanticGraph);
  if (snapshot.productModel) {
    const normalizedProductModel = normalizeProductModelDocument({
      schemaVersion: snapshot.productModel.schemaVersion,
      featureGroups: snapshot.productModel.featureGroups,
      capabilities: snapshot.productModel.capabilities,
      features: snapshot.productModel.features,
      requirements: snapshot.productModel.requirements,
      constraints: snapshot.productModel.constraints,
      decisions: snapshot.productModel.decisions,
    });
    if (normalizedProductModel.productModelId !== snapshot.productModel.productModelId
      || normalizedProductModel.productModelHash !== snapshot.productModel.productModelHash) {
      fail("World Model product canon projection is invalid.", "PRODUCT_MODEL_IDENTITY_MISMATCH");
    }
  }
  if (snapshot.temporalProvenanceGraph) verifyTemporalProvenanceGraph(snapshot.temporalProvenanceGraph);
  if (snapshot.protocol?.version === WORLD_MODEL_VERSION) {
    const projection = snapshot.onboardingProjection;
    const graphProjection = snapshot.temporalProvenanceGraph?.onboardingProjection;
    if (!projection || projection.authority !== "derived-projection-manifest-not-project-canon"
      || projection.instructionAuthority !== false || projection.promotionAuthority !== false
      || projection.projectionInputId !== graphProjection?.projectionInputId
      || projection.projectionInputHash !== graphProjection?.projectionInputHash
      || canonicalJson(projection.candidateSetIds) !== canonicalJson(graphProjection?.candidateSetIds)
      || canonicalJson(projection.reviewDecisionIds) !== canonicalJson(graphProjection?.reviewDecisionIds)
      || canonicalJson(projection.productModelRevisionIds) !== canonicalJson(graphProjection?.productModelRevisionIds)) {
      fail("World Model onboarding projection and temporal graph disagree.", "ONBOARDING_TEMPORAL_IDENTITY_MISMATCH");
    }
    const mappingProjection = snapshot.featureMappingProjection;
    const graphMappingProjection = snapshot.temporalProvenanceGraph?.featureMappingProjection;
    if (!mappingProjection || mappingProjection.authority !== "derived-projection-manifest-not-project-canon"
      || mappingProjection.instructionAuthority !== false || mappingProjection.promotionAuthority !== false
      || mappingProjection.projectionInputId !== graphMappingProjection?.projectionInputId
      || mappingProjection.projectionInputHash !== graphMappingProjection?.projectionInputHash
      || canonicalJson(mappingProjection.candidateSetIds) !== canonicalJson(graphMappingProjection?.candidateSetIds)
      || canonicalJson(mappingProjection.reviewDecisionIds) !== canonicalJson(graphMappingProjection?.reviewDecisionIds)) {
      fail("World Model Feature mapping projection and temporal graph disagree.", "FEATURE_MAPPING_TEMPORAL_IDENTITY_MISMATCH");
    }
    const changeProjection = snapshot.changeSetProjection;
    const graphChangeProjection = snapshot.temporalProvenanceGraph?.changeSetProjection;
    if (!changeProjection || changeProjection.authority !== "derived-projection-manifest-not-change-lineage-authority"
      || changeProjection.instructionAuthority !== false || changeProjection.promotionAuthority !== false
      || changeProjection.projectionInputId !== graphChangeProjection?.projectionInputId
      || changeProjection.projectionInputHash !== graphChangeProjection?.projectionInputHash
      || canonicalJson(changeProjection.changeSetIds) !== canonicalJson(graphChangeProjection?.changeSetIds)
      || canonicalJson(changeProjection.candidateSetIds) !== canonicalJson(graphChangeProjection?.candidateSetIds)
      || canonicalJson(changeProjection.reviewDecisionIds) !== canonicalJson(graphChangeProjection?.reviewDecisionIds)
      || canonicalJson(changeProjection.vcsEvidenceIds) !== canonicalJson(graphChangeProjection?.vcsEvidenceIds)) {
      fail("World Model ChangeSet projection and temporal graph disagree.", "CHANGE_SET_TEMPORAL_IDENTITY_MISMATCH");
    }
  }
  if (snapshot.productModel && snapshot.temporalProvenanceGraph
    && (snapshot.productModel.productModelId !== snapshot.temporalProvenanceGraph.productModelId
      || snapshot.productModel.productModelHash !== snapshot.temporalProvenanceGraph.productModelHash)) {
    fail("World Model product canon and temporal graph disagree.", "PRODUCT_TEMPORAL_IDENTITY_MISMATCH");
  }
  if (snapshot.gitDecisionHistory) verifyGitDecisionHistory(snapshot.gitDecisionHistory);
  if (snapshot.externalRuntimeState) verifyExternalRuntimeState(snapshot.externalRuntimeState);
  return snapshot;
}

function changesBetween(previous, current) {
  const before = new Map((previous?.files || []).map((item) => [item.path, item.digest]));
  const after = new Map(current.files.map((item) => [item.path, item.digest]));
  return {
    added: [...after.keys()].filter((file) => !before.has(file)).sort(),
    changed: [...after.keys()].filter((file) => before.has(file) && before.get(file) !== after.get(file)).sort(),
    removed: [...before.keys()].filter((file) => !after.has(file)).sort(),
  };
}

function indexerState() {
  return {
    worldModelVersion: WORLD_MODEL_VERSION,
    repositoryScanVersion: REPOSITORY_SCAN_VERSION,
    semanticGraphVersion: SEMANTIC_GRAPH_VERSION,
    productModelVersion: PRODUCT_MODEL_VERSION,
    onboardingGraphProjectionVersion: ONBOARDING_GRAPH_PROJECTION_VERSION,
    featureMappingVersion: FEATURE_MAPPING_VERSION,
    changeSetVersion: CHANGE_SET_VERSION,
    changeSetProjectionVersion: CHANGE_SET_PROJECTION_VERSION,
    vcsEvidenceVersion: VCS_EVIDENCE_VERSION,
    temporalProvenanceVersion: TEMPORAL_PROVENANCE_VERSION,
    gitDecisionHistoryVersion: GIT_DECISION_HISTORY_VERSION,
    gitHistoryAdapterVersion: GIT_HISTORY_ADAPTER_VERSION,
    externalRuntimeStateVersion: EXTERNAL_RUNTIME_STATE_VERSION,
    runtimeStateAdapterVersion: RUNTIME_STATE_ADAPTER_VERSION,
  };
}

function sourceDigestFor(files, productModel, onboardingProjection, featureMappingProjection, changeSetProjection, git, runtimeState, externalRuntimeState, indexer, parentSourceSnapshotIds = [], revisionParentIds = {}) {
  return digest(canonicalJson({
    files,
    productModel: { productModelId: productModel.productModelId, productModelHash: productModel.productModelHash },
    onboardingProjection: {
      projectionInputId: onboardingProjection.projectionInputId,
      projectionInputHash: onboardingProjection.projectionInputHash,
    },
    featureMappingProjection: {
      projectionInputId: featureMappingProjection.projectionInputId,
      projectionInputHash: featureMappingProjection.projectionInputHash,
    },
    changeSetProjection: {
      projectionInputId: changeSetProjection.projectionInputId,
      projectionInputHash: changeSetProjection.projectionInputHash,
    },
    git,
    runtimeState,
    externalRuntimeState: externalRuntimeState.runtimeStateHash,
    indexer,
    temporalParents: { parentSourceSnapshotIds, revisionParentIds },
  }));
}

export function readWorldModel({ root = ".", storeAdapter = null } = {}) {
  const inspected = readyProject(root);
  const projectRoot = inspected.project.projectRoot;
  const adapter = createWorldModelStoreAdapter({ projectRoot, adapter: storeAdapter });
  const pointerEntry = adapter.readPointer();
  if (!pointerEntry) fail("Repository World Model has not been built.", "WORLD_MODEL_NOT_BUILT");
  const pointer = pointerEntry.document;
  if (pointer.projectId !== inspected.project.projectId || typeof pointer.worldModelId !== "string") {
    fail("World Model pointer does not match this project.", "WORLD_MODEL_IDENTITY_MISMATCH");
  }
  const snapshotEntry = adapter.readSnapshot(pointer.worldModelId);
  if (!snapshotEntry) fail("World Model snapshot is missing.", "WORLD_MODEL_SNAPSHOT_MISSING");
  const snapshot = verifiedSnapshot(snapshotEntry.document, pointer.worldModelId);
  if (snapshot.worldModelHash !== pointer.worldModelHash) fail("World Model pointer hash does not match its snapshot.", "WORLD_MODEL_POINTER_MISMATCH");
  return {
    status: "verified",
    pointerFile: pointerEntry.location,
    file: snapshotEntry.location,
    pointer,
    snapshot,
    storeAdapter: adapter.describe(),
  };
}

export function readWorldModelSnapshot({ root = ".", worldModelId, storeAdapter = null } = {}) {
  const inspected = readyProject(root);
  if (!/^world-model-[a-f0-9]{24}$/.test(worldModelId || "")) fail("World Model snapshot id is invalid.", "INVALID_WORLD_MODEL_ID");
  const adapter = createWorldModelStoreAdapter({ projectRoot: inspected.project.projectRoot, adapter: storeAdapter });
  const snapshotEntry = adapter.readSnapshot(worldModelId);
  if (!snapshotEntry) fail(`World Model snapshot is missing: ${worldModelId}`, "WORLD_MODEL_SNAPSHOT_MISSING");
  return {
    status: "verified",
    file: snapshotEntry.location,
    snapshot: verifiedSnapshot(snapshotEntry.document, worldModelId),
    storeAdapter: adapter.describe(),
  };
}

export function findWorldModelSnapshot({ root = ".", graphSnapshotId = "", sourceSnapshotId = "", storeAdapter = null } = {}) {
  const inspected = readyProject(root);
  if (!graphSnapshotId && !sourceSnapshotId) fail("A GraphSnapshot or SourceSnapshot identity is required.", "WORLD_MODEL_SNAPSHOT_QUERY_REQUIRED");
  const adapter = createWorldModelStoreAdapter({ projectRoot: inspected.project.projectRoot, adapter: storeAdapter });
  const matches = [];
  for (const worldModelId of adapter.listSnapshotIds()) {
    const snapshot = readWorldModelSnapshot({ root: inspected.project.projectRoot, worldModelId, storeAdapter: adapter }).snapshot;
    if (graphSnapshotId && snapshot.temporalProvenanceGraph?.graphSnapshotId !== graphSnapshotId) continue;
    if (sourceSnapshotId && snapshot.temporalProvenanceGraph?.sourceSnapshotId !== sourceSnapshotId) continue;
    matches.push(snapshot);
  }
  matches.sort((left, right) => left.worldModelId.localeCompare(right.worldModelId));
  if (!matches.length) fail("No verified World Model snapshot matches the requested temporal identity.", "WORLD_MODEL_SNAPSHOT_NOT_FOUND");
  return { status: "verified", matches };
}

export function inspectWorldModel({ root = ".", storeAdapter = null, runtimeStateAdapter = null } = {}) {
  const stored = readWorldModel({ root, storeAdapter });
  const inspected = readyProject(root);
  const scanInput = buildRepositoryScanInput({
    projectRoot: inspected.project.projectRoot,
    managedRootFiles: managedRootFilesForProject(inspected.project),
  });
  const scan = scanRepositoryReference(scanInput);
  const productCanon = readProductModelCanon({ projectRoot: inspected.project.projectRoot });
  const onboardingProjection = loadOnboardingGraphProjection({
    projectRoot: inspected.project.projectRoot,
    projectId: inspected.project.projectId,
    currentProductModelId: productCanon.model.productModelId,
  });
  const featureMappingProjection = loadFeatureMappingProjection({
    projectRoot: inspected.project.projectRoot,
    projectId: inspected.project.projectId,
    currentProductModelId: productCanon.model.productModelId,
  });
  const changeSetProjection = loadChangeSetProjection({
    projectRoot: inspected.project.projectRoot,
    projectId: inspected.project.projectId,
  });
  const git = gitHeadState(inspected.project.projectRoot);
  const runtimeState = runtimeStateFor(inspected.state);
  const selectedRuntimeAdapter = runtimeStateAdapter || runtimeStateAdapterFromDescriptor(stored.pointer.sourceAdapters?.runtimeState);
  const externalRuntimeResult = buildExternalRuntimeState({ projectRoot: inspected.project.projectRoot, adapter: selectedRuntimeAdapter });
  const externalRuntimeState = externalRuntimeResult.runtimeState;
  const currentTemporalProvenanceGraph = buildTemporalProvenanceGraph({
    projectId: inspected.project.projectId,
    files: scan.files,
    productModel: productCanon.model,
    productEvidenceId: productCanon.evidenceId,
    onboardingProjection,
    featureMappingProjection,
    changeSetProjection,
    parentSourceSnapshotIds: stored.snapshot.temporalProvenanceGraph?.parentSourceSnapshotIds || [],
    revisionParentIds: stored.snapshot.temporalProvenanceGraph?.revisionParentIds || {},
  });
  const currentSourceDigest = sourceDigestFor(
    scan.files,
    productCanon.model,
    onboardingProjection,
    featureMappingProjection,
    changeSetProjection,
    git,
    runtimeState,
    externalRuntimeState,
    indexerState(),
    stored.snapshot.temporalProvenanceGraph?.parentSourceSnapshotIds || [],
    stored.snapshot.temporalProvenanceGraph?.revisionParentIds || {},
  );
  const current = { files: scan.files };
  const currentByPath = new Map(scan.files.map((item) => [item.path, item.digest]));
  const storedByPath = new Map(stored.snapshot.files.map((item) => [item.path, item.digest]));
  const fileFreshness = stored.snapshot.files.map((item) => ({
    path: item.path,
    status: !currentByPath.has(item.path)
      ? "removed"
      : currentByPath.get(item.path) === item.digest
        ? "active"
        : "stale",
  }));
  for (const item of scan.files) if (!storedByPath.has(item.path)) fileFreshness.push({ path: item.path, status: "unindexed" });
  fileFreshness.sort((left, right) => left.path.localeCompare(right.path));
  const fileChanges = changesBetween(stored.snapshot, current);
  return {
    ...stored,
    status: currentSourceDigest === stored.snapshot.sourceDigest ? "current" : "stale",
    currentSourceDigest,
    changes: {
      ...fileChanges,
      gitChanged: canonicalJson(git) !== canonicalJson(stored.snapshot.git),
      gitHistoryChanged: git.referencesDigest !== stored.snapshot.git?.referencesDigest,
      runtimeStateChanged: canonicalJson(runtimeState) !== canonicalJson(stored.snapshot.runtimeState),
      externalRuntimeStateChanged: externalRuntimeState.runtimeStateHash !== stored.snapshot.externalRuntimeState?.runtimeStateHash,
      productModelChanged: productCanon.model.productModelHash !== stored.snapshot.productModel?.productModelHash,
      onboardingProjectionChanged: onboardingProjection.projectionInputHash !== stored.snapshot.onboardingProjection?.projectionInputHash,
      featureMappingProjectionChanged: featureMappingProjection.projectionInputHash !== stored.snapshot.featureMappingProjection?.projectionInputHash,
      changeSetProjectionChanged: changeSetProjection.projectionInputHash !== stored.snapshot.changeSetProjection?.projectionInputHash,
      temporalProvenanceChanged: currentTemporalProvenanceGraph.graphSnapshotHash !== stored.snapshot.temporalProvenanceGraph?.graphSnapshotHash,
    },
    fileFreshness,
    sourceAdapters: { runtimeState: externalRuntimeResult.adapter },
    sourceDiagnostics: { runtimeState: externalRuntimeResult.diagnostics },
  };
}

export async function buildWorldModel({
  root = ".",
  persist = true,
  storeAdapter = null,
  gitHistoryAdapter = null,
  runtimeStateAdapter = null,
  computeAdapter = null,
  onboardingProjectionInput = null,
  featureMappingProjectionInput = null,
  changeSetProjectionInput = null,
  parentSourceSnapshotIds = [],
  revisionParentIds = {},
} = {}) {
  const inspected = readyProject(root);
  const project = inspected.project;
  const repositoryScanExecution = await executeRepositoryScan({
    adapter: computeAdapter || createRepositoryScanComputeAdapter(),
    projectRoot: project.projectRoot,
    managedRootFiles: managedRootFilesForProject(project),
  });
  const scan = validateRepositoryScanResult(repositoryScanExecution.result);
  const productCanon = readProductModelCanon({ projectRoot: project.projectRoot });
  const onboardingProjection = onboardingProjectionInput || loadOnboardingGraphProjection({
    projectRoot: project.projectRoot,
    projectId: project.projectId,
    currentProductModelId: productCanon.model.productModelId,
  });
  const featureMappingProjection = featureMappingProjectionInput || loadFeatureMappingProjection({
    projectRoot: project.projectRoot,
    projectId: project.projectId,
    currentProductModelId: productCanon.model.productModelId,
  });
  const changeSetProjection = changeSetProjectionInput || loadChangeSetProjection({
    projectRoot: project.projectRoot,
    projectId: project.projectId,
  });
  const git = gitHeadState(project.projectRoot);
  const runtimeState = runtimeStateFor(inspected.state);
  const indexer = indexerState();
  const externalRuntimeResult = buildExternalRuntimeState({ projectRoot: project.projectRoot, adapter: runtimeStateAdapter });
  const externalRuntimeState = externalRuntimeResult.runtimeState;
  const semanticGraph = buildSemanticGraph({ files: scan.files });
  const temporalProvenanceGraph = buildTemporalProvenanceGraph({
    projectId: project.projectId,
    files: scan.files,
    productModel: productCanon.model,
    productEvidenceId: productCanon.evidenceId,
    onboardingProjection,
    featureMappingProjection,
    changeSetProjection,
    parentSourceSnapshotIds,
    revisionParentIds,
  });
  const sourceDigest = sourceDigestFor(
    scan.files,
    productCanon.model,
    onboardingProjection,
    featureMappingProjection,
    changeSetProjection,
    git,
    runtimeState,
    externalRuntimeState,
    indexer,
    temporalProvenanceGraph.parentSourceSnapshotIds,
    temporalProvenanceGraph.revisionParentIds,
  );
  const gitHistoryResult = await buildGitDecisionHistory({
    projectRoot: project.projectRoot,
    adapter: gitHistoryAdapter,
    referenceCommits: git.referenceCommits || [],
    referenceTags: git.referenceTags || [],
  });
  const gitDecisionHistory = gitHistoryResult.history;
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    kind: "RepositoryWorldModel",
    protocol: { name: "head-agent-core-world-model", version: WORLD_MODEL_VERSION },
    storageContract: WORLD_MODEL_STORAGE_CONTRACT,
    projectId: project.projectId,
    projectRoot: project.projectRoot,
    sourceDigest,
    indexer,
    rules: {
      maxFileBytes: REPOSITORY_SCAN_DEFAULTS.maxFileBytes,
      maxFiles: REPOSITORY_SCAN_DEFAULTS.maxFiles,
      maxTotalBytes: REPOSITORY_SCAN_DEFAULTS.maxTotalBytes,
      maxSymbolsPerFile: REPOSITORY_SCAN_DEFAULTS.maxSymbolsPerFile,
      excludedDirectories: REPOSITORY_SCAN_EXCLUDED_DIRECTORIES,
      managedRootProjectionsExcluded: managedRootFilesForProject(project),
    },
    coverage: {
      files: "supported-text-files-within-rules",
      repositoryScan: "compute-adapter-validated-relative-path-digest-and-source-facts",
      symbols: "heuristic-javascript-typescript-python-markdown-with-content-derived-identities",
      dependencies: "heuristic-module-resolution-and-package-manifests",
      semanticGraph: "heuristic-file-symbol-import-call-graph-with-evidence-locations",
      temporalProvenanceGraph: "content-addressed-file-symbol-test-revisions-with-multiple-parent-dag",
      productModel: "user-owned-feature-capability-requirement-constraint-decision-canon-projected-into-temporal-graph",
      onboardingProjection: "immutable-candidates-evidence-unknowns-reviews-and-product-model-revision-receipts-projected-without-authority-escalation",
      featureMappingProjection: "immutable-feature-mapping-candidates-and-explicit-review-decisions-with-separate-reviewed-relationship-promotion",
      changeSetProjection: "reviewed-provider-neutral-changesets-with-review-gated-feature-impact-and-optional-vcs-evidence-relations",
      gitHistory: gitDecisionHistory.coverage,
      runtimeState: "canonical-head-lifecycle-state",
      externalRuntimeState: externalRuntimeState.coverage,
    },
    git,
    gitDecisionHistory,
    runtimeState,
    externalRuntimeState,
    productModel: productCanon.model,
    productModelSource: { status: productCanon.status, relativePath: productCanon.relativePath, evidenceId: productCanon.evidenceId },
    onboardingProjection: {
      projectionInputId: onboardingProjection.projectionInputId,
      projectionInputHash: onboardingProjection.projectionInputHash,
      candidateSetIds: onboardingProjection.candidateSets.map((item) => item.candidateSetId),
      reviewDecisionIds: onboardingProjection.reviewDecisions.map((item) => item.reviewDecisionId),
      productModelRevisionIds: onboardingProjection.productModelRevisions.map((item) => item.productModelId),
      authority: "derived-projection-manifest-not-project-canon",
      instructionAuthority: false,
      promotionAuthority: false,
    },
    featureMappingProjection: {
      projectionInputId: featureMappingProjection.projectionInputId,
      projectionInputHash: featureMappingProjection.projectionInputHash,
      candidateSetIds: featureMappingProjection.candidateSets.map((item) => item.candidateSetId),
      reviewDecisionIds: featureMappingProjection.reviewDecisions.map((item) => item.reviewDecisionId),
      authority: "derived-projection-manifest-not-project-canon",
      instructionAuthority: false,
      promotionAuthority: false,
    },
    changeSetProjection: {
      projectionInputId: changeSetProjection.projectionInputId,
      projectionInputHash: changeSetProjection.projectionInputHash,
      changeSetIds: changeSetProjection.changeSets.map((item) => item.changeSetId),
      candidateSetIds: changeSetProjection.candidateSets.map((item) => item.candidateSetId),
      reviewDecisionIds: changeSetProjection.reviewDecisions.map((item) => item.reviewDecisionId),
      vcsEvidenceIds: changeSetProjection.vcsEvidence.map((item) => item.vcsEvidenceId),
      authority: "derived-projection-manifest-not-change-lineage-authority",
      instructionAuthority: false,
      promotionAuthority: false,
    },
    repositoryScan: {
      scanId: scan.scanId,
      scanHash: scan.scanHash,
      protocol: scan.protocol,
      sourceAnalysisVersion: scan.sourceAnalysisVersion,
      authority: scan.authority,
      instructionAuthority: false,
      promotionAuthority: false,
      summary: scan.summary,
    },
    files: scan.files,
    semanticGraph,
    temporalProvenanceGraph,
    skipped: scan.skipped,
    summary: {
      fileCount: scan.files.length,
      symbolCount: scan.files.reduce((count, item) => count + item.symbols.length, 0),
      dependencyCount: scan.files.reduce((count, item) => count + item.dependencies.length, 0),
      semanticNodeCount: semanticGraph.summary.nodeCount,
      semanticEdgeCount: semanticGraph.summary.edgeCount,
      callEdgeCount: semanticGraph.summary.callEdgeCount,
      temporalNodeCount: temporalProvenanceGraph.summary.nodeCount,
      temporalEdgeCount: temporalProvenanceGraph.summary.edgeCount,
      sourceSnapshotId: temporalProvenanceGraph.sourceSnapshotId,
      featureGroupCount: temporalProvenanceGraph.summary.featureGroupCount,
      capabilityCount: temporalProvenanceGraph.summary.capabilityCount,
      featureCount: temporalProvenanceGraph.summary.featureCount,
      requirementCount: temporalProvenanceGraph.summary.requirementCount,
      constraintCount: temporalProvenanceGraph.summary.constraintCount,
      decisionCount: temporalProvenanceGraph.summary.decisionCount,
      onboardingCandidateSetCount: temporalProvenanceGraph.summary.onboardingCandidateSetCount,
      onboardingCandidateCount: temporalProvenanceGraph.summary.onboardingCandidateCount,
      onboardingEvidenceCount: temporalProvenanceGraph.summary.onboardingEvidenceCount,
      onboardingUnknownCount: temporalProvenanceGraph.summary.onboardingUnknownCount,
      onboardingReviewDecisionCount: temporalProvenanceGraph.summary.onboardingReviewDecisionCount,
      onboardingAcceptedCandidateCount: temporalProvenanceGraph.summary.onboardingAcceptedCandidateCount,
      onboardingRejectedCandidateCount: temporalProvenanceGraph.summary.onboardingRejectedCandidateCount,
      productModelRevisionReceiptCount: temporalProvenanceGraph.summary.productModelRevisionReceiptCount,
      featureMappingCandidateSetCount: temporalProvenanceGraph.summary.featureMappingCandidateSetCount,
      featureMappingCandidateCount: temporalProvenanceGraph.summary.featureMappingCandidateCount,
      featureMappingReviewDecisionCount: temporalProvenanceGraph.summary.featureMappingReviewDecisionCount,
      reviewedRelationshipCount: temporalProvenanceGraph.summary.reviewedRelationshipCount,
      changeSetCount: temporalProvenanceGraph.summary.changeSetCount,
      changeRecordCount: temporalProvenanceGraph.summary.changeRecordCount,
      changeImpactCandidateCount: temporalProvenanceGraph.summary.changeImpactCandidateCount,
      changeImpactReviewDecisionCount: temporalProvenanceGraph.summary.changeImpactReviewDecisionCount,
      reviewedImpactCount: temporalProvenanceGraph.summary.reviewedImpactCount,
      gitCommitCount: gitDecisionHistory.summary.commitCount,
      runtimeObservationCount: externalRuntimeState.summary.observationCount,
    },
  };
  const worldModelHash = digest(canonicalJson(payload));
  const worldModelId = `world-model-${worldModelHash.slice(0, 24)}`;
  const snapshot = { ...payload, worldModelId, worldModelHash };
  if (!persist) return {
    status: "preview",
    snapshot,
    sourceAdapters: { compute: repositoryScanExecution.diagnostics },
    sourceDiagnostics: { compute: repositoryScanExecution.diagnostics },
  };

  const adapter = createWorldModelStoreAdapter({ projectRoot: project.projectRoot, adapter: storeAdapter });
  let previous = null;
  let previousPointer = null;
  if (adapter.readPointer()) {
    const current = readWorldModel({ root: project.projectRoot, storeAdapter: adapter });
    previous = current.snapshot;
    previousPointer = current.pointer;
  }
  const existingSnapshot = adapter.readSnapshot(worldModelId);
  let snapshotEntry;
  if (existingSnapshot) {
    verifiedSnapshot(existingSnapshot.document, worldModelId);
    snapshotEntry = existingSnapshot;
  } else {
    snapshotEntry = adapter.writeSnapshot(worldModelId, snapshot);
  }
  verifiedSnapshot(snapshotEntry.document, worldModelId);
  const changed = !previous || previous.worldModelId !== worldModelId;
  const fileChanges = changed ? changesBetween(previous, snapshot) : { added: [], changed: [], removed: [] };
  const changes = {
    ...fileChanges,
    gitChanged: changed && canonicalJson(previous?.git || null) !== canonicalJson(snapshot.git),
    gitHistoryChanged: changed && previous?.gitDecisionHistory?.historyHash !== snapshot.gitDecisionHistory.historyHash,
    runtimeStateChanged: changed && canonicalJson(previous?.runtimeState || null) !== canonicalJson(snapshot.runtimeState),
    externalRuntimeStateChanged: changed && previous?.externalRuntimeState?.runtimeStateHash !== snapshot.externalRuntimeState.runtimeStateHash,
    productModelChanged: changed && previous?.productModel?.productModelHash !== snapshot.productModel.productModelHash,
    onboardingProjectionChanged: changed && previous?.onboardingProjection?.projectionInputHash !== snapshot.onboardingProjection.projectionInputHash,
    featureMappingProjectionChanged: changed && previous?.featureMappingProjection?.projectionInputHash !== snapshot.featureMappingProjection.projectionInputHash,
    changeSetProjectionChanged: changed && previous?.changeSetProjection?.projectionInputHash !== snapshot.changeSetProjection.projectionInputHash,
    temporalProvenanceChanged: changed && previous?.temporalProvenanceGraph?.graphSnapshotHash !== snapshot.temporalProvenanceGraph.graphSnapshotHash,
  };
  const pointer = {
    schemaVersion: SCHEMA_VERSION,
    kind: "WorldModelPointer",
    projectId: project.projectId,
    storage: adapter.describe(),
    worldModelId,
    worldModelHash,
    previousWorldModelId: changed ? previous?.worldModelId || null : previousPointer?.previousWorldModelId || null,
    sourceAdapters: {
      compute: {
        backend: repositoryScanExecution.diagnostics.backend,
        adapterName: repositoryScanExecution.diagnostics.adapterName,
        executionMode: repositoryScanExecution.diagnostics.executionMode,
        requestId: repositoryScanExecution.request.requestId,
        resultDigest: repositoryScanExecution.response.resultDigest,
        fallbackUsed: repositoryScanExecution.diagnostics.fallbackUsed || false,
        fallbackReasonCode: repositoryScanExecution.diagnostics.fallbackReasonCode || "",
        workerRelativePath: repositoryScanExecution.diagnostics.workerRelativePath || "",
        workerSha256: repositoryScanExecution.diagnostics.workerSha256 || "",
      },
      runtimeState: externalRuntimeResult.adapter,
    },
    tiers: {
      hot: worldModelId,
      warm: changes,
      cold: "adapter-retained-snapshots",
      coldSnapshotCount: adapter.listSnapshotIds().length,
    },
  };
  const pointerEntry = adapter.writePointer(pointer);
  if (canonicalJson(pointerEntry.document) !== canonicalJson(pointer)) {
    fail("World Model store adapter changed the pointer during persistence.", "WORLD_MODEL_STORE_WRITE_MISMATCH");
  }
  return {
    status: changed ? "indexed" : "unchanged",
    pointerFile: pointerEntry.location,
    file: snapshotEntry.location,
    pointer,
    snapshot,
    storeAdapter: adapter.describe(),
    sourceAdapters: {
      compute: pointer.sourceAdapters.compute,
      gitHistory: gitHistoryResult.adapter,
      runtimeState: externalRuntimeResult.adapter,
    },
    sourceDiagnostics: {
      compute: repositoryScanExecution.diagnostics,
      gitHistory: gitHistoryResult.diagnostics,
      runtimeState: externalRuntimeResult.diagnostics,
    },
  };
}

export function queryWorldModel({ root = ".", query, depth = 1, maxResults = 100, storeAdapter = null } = {}) {
  const inspected = inspectWorldModel({ root, storeAdapter });
  if (inspected.status !== "current") fail("Repository World Model is stale and cannot answer semantic queries.", "WORLD_MODEL_STALE");
  if (!inspected.snapshot.semanticGraph) fail("Repository World Model has no semantic graph.", "SEMANTIC_GRAPH_NOT_BUILT");
  return {
    status: "current",
    worldModelId: inspected.snapshot.worldModelId,
    ...querySemanticGraph(inspected.snapshot.semanticGraph, { query, depth, maxResults }),
  };
}

export function queryWorldTemporalGraph({
  root = ".",
  query,
  kinds = null,
  relations = null,
  authorityClasses = ["canon-projected", "reviewed", "derived", "heuristic"],
  freshness = ["current"],
  minConfidence = 0,
  includeUnreviewedCandidates = false,
  depth = 1,
  maxNodes = 100,
  maxEdges = 200,
  storeAdapter = null,
} = {}) {
  const inspected = inspectWorldModel({ root, storeAdapter });
  if (inspected.status !== "current") fail("Repository World Model is stale and cannot answer temporal provenance queries.", "WORLD_MODEL_STALE");
  if (!inspected.snapshot.temporalProvenanceGraph) fail("Repository World Model has no temporal provenance graph.", "TEMPORAL_PROVENANCE_NOT_BUILT");
  return {
    status: "current",
    worldModelId: inspected.snapshot.worldModelId,
    ...queryTemporalProvenanceGraph(inspected.snapshot.temporalProvenanceGraph, {
      query,
      kinds,
      relations,
      authorityClasses,
      freshness,
      minConfidence,
      includeUnreviewedCandidates,
      depth,
      maxNodes,
      maxEdges,
    }),
  };
}

export function queryWorldHistory({ root = ".", query = "", limit = 50, storeAdapter = null } = {}) {
  const inspected = inspectWorldModel({ root, storeAdapter });
  if (inspected.status !== "current") fail("Repository World Model is stale and cannot answer Git history queries.", "WORLD_MODEL_STALE");
  if (!inspected.snapshot.gitDecisionHistory) fail("Repository World Model has no Git decision history.", "GIT_DECISION_HISTORY_NOT_BUILT");
  return {
    status: "current",
    worldModelId: inspected.snapshot.worldModelId,
    ...queryGitDecisionHistory(inspected.snapshot.gitDecisionHistory, { query, limit }),
  };
}

export function queryWorldRuntimeState({ root = ".", query = "", runtime = "", state = "", kind = "", limit = 50, storeAdapter = null, runtimeStateAdapter = null } = {}) {
  const inspected = inspectWorldModel({ root, storeAdapter, runtimeStateAdapter });
  if (inspected.status !== "current") fail("Repository World Model is stale and cannot answer runtime state queries.", "WORLD_MODEL_STALE");
  if (!inspected.snapshot.externalRuntimeState) fail("Repository World Model has no external runtime state.", "EXTERNAL_RUNTIME_STATE_NOT_BUILT");
  return {
    status: "current",
    worldModelId: inspected.snapshot.worldModelId,
    ...queryExternalRuntimeState(inspected.snapshot.externalRuntimeState, { query, runtime, state, kind, limit }),
  };
}
