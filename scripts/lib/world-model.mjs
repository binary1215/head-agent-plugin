import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { inspectProject, SCHEMA_VERSION } from "./head-core.mjs";
import {
  buildGitDecisionHistory,
  classifyGitReference,
  GIT_DECISION_HISTORY_VERSION,
  GIT_HISTORY_ADAPTER_VERSION,
  queryGitDecisionHistory,
  verifyGitDecisionHistory,
} from "./git-history.mjs";
import { buildSemanticGraph, querySemanticGraph, SEMANTIC_GRAPH_VERSION, verifySemanticGraph } from "./semantic-graph.mjs";
import { normalizeProductModelDocument, PRODUCT_MODEL_RELATIVE_PATH, PRODUCT_MODEL_VERSION, readProductModelCanon } from "./product-model.mjs";
import { assertProjectionDidNotMutateCanon } from "./authority-plane-contract.mjs";
import { loadOnboardingGraphProjection, ONBOARDING_GRAPH_PROJECTION_VERSION } from "./onboarding-projection.mjs";
import { FEATURE_MAPPING_VERSION, loadFeatureMappingProjection } from "./feature-mapping-projection.mjs";
import {
  CHANGE_SET_PROJECTION_VERSION,
  CHANGE_SET_VERSION,
  loadChangeSetProjection,
  VCS_EVIDENCE_VERSION,
} from "./change-set-projection.mjs";
import { DOCUMENT_CHANGE_GRAPH_PROJECTION_VERSION, loadDocumentChangeProjection } from "./document-change-projection.mjs";
import { loadProductOperatingProjection, PRODUCT_OPERATING_LOOP_VERSION } from "./product-operating-loop.mjs";
import {
  buildRepositoryScanInput,
  createRepositoryScanComputeAdapter,
  executeRepositoryScan,
  inspectRepositoryScanFreshness,
  managedRootFilesForProject,
  REPOSITORY_SCAN_DEFAULTS,
  REPOSITORY_SCAN_EXCLUDED_DIRECTORIES,
  REPOSITORY_SCAN_VERSION,
  scanRepositoryReference,
  validateRepositoryScanExecution,
  validateRepositoryScanResult,
} from "./repository-scan.mjs";
import { buildRepositorySourceScope, readRepositorySourceScope } from "./repository-source-scope.mjs";
import {
  buildTemporalProvenanceGraph,
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
import {
  GRAPH_PROJECTION_ADAPTER_VERSION,
  inspectGraphProjection,
  materializeGraphProjection,
  queryGraphProjection,
} from "./graph-projection-adapter.mjs";
import {
  captureDocumentChangeCandidates,
  inspectMarkdownProjection,
  materializeMarkdownProjection,
  readDocumentChangeCandidateSet,
} from "./document-projection-adapter.mjs";
import { withRefreshWriterLease } from "./refresh-writer-lease.mjs";

export const WORLD_MODEL_VERSION = "0.13.0";
export const WORLD_MODEL_STORE = WORLD_MODEL_STORAGE_CONTRACT;
export const WORLD_MODEL_STATUS_PROJECTION_VERSION = "0.1.0";
export const WORLD_MODEL_STATUS_PROJECTION_MAX_BYTES = 512 * 1024;

const WORLD_MODEL_STATUS_SAMPLE_LIMIT = 20;
const verifiedSnapshotByteLengths = new WeakMap();

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

function restoreCanonBytes(file, beforeBytes) {
  if (beforeBytes === null) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, beforeBytes, { flag: "wx" });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function materializeGraphProjectionWithCanonFence({ projectRoot, graph, adapter }) {
  const canonFile = path.resolve(projectRoot, ...PRODUCT_MODEL_RELATIVE_PATH.split("/"));
  const beforeBytes = fs.existsSync(canonFile) ? fs.readFileSync(canonFile) : null;
  let result;
  let operationError = null;
  try {
    result = materializeGraphProjection({ projectRoot, graph, adapter });
  } catch (error) {
    operationError = error;
  }
  const afterBytes = fs.existsSync(canonFile) ? fs.readFileSync(canonFile) : null;
  try {
    assertProjectionDidNotMutateCanon({ beforeBytes, afterBytes });
  } catch (error) {
    restoreCanonBytes(canonFile, beforeBytes);
    throw error;
  }
  if (operationError) throw operationError;
  return result;
}

function readyProject(root) {
  const inspected = inspectProject(root);
  if (inspected.status !== "ready") {
    fail(`Project must be ready to build a World Model; current status: ${inspected.status}.`, "PROJECT_NOT_READY");
  }
  return inspected;
}

function productReferenceKind(ref) {
  if (ref.startsWith("refs/heads/")) return "branch";
  if (ref.startsWith("refs/remotes/")) return "remote";
  if (ref.startsWith("refs/tags/")) return "tag";
  return "";
}

function referenceRecord(ref, content, peeled = "") {
  const value = String(content || "").trim();
  if (/^[a-f0-9]{40,64}$/i.test(value)) return {
    ref,
    kind: productReferenceKind(ref),
    targetType: "direct",
    target: value.toLocaleLowerCase(),
    peeled: /^[a-f0-9]{40,64}$/i.test(peeled) ? peeled.toLocaleLowerCase() : "",
    commit: value.toLocaleLowerCase(),
  };
  if (!value.startsWith("ref: ")) return null;
  const target = value.slice(5).trim().replaceAll("\\", "/");
  if (classifyGitReference(target) === "invalid") return null;
  return {
    ref,
    kind: productReferenceKind(ref),
    targetType: "symbolic",
    target,
    peeled: "",
    commit: "",
  };
}

function gitReferenceState(gitPath) {
  const packedReferences = new Map();
  const productReferences = new Map();
  const packedRefs = path.join(gitPath, "packed-refs");
  if (fs.existsSync(packedRefs) && fs.statSync(packedRefs).isFile()) {
    let previousRef = "";
    for (const line of fs.readFileSync(packedRefs, "utf8").split(/\r?\n/)) {
      const direct = line.match(/^([a-f0-9]{40,64})\s+(refs\/\S+)$/i);
      if (direct && classifyGitReference(direct[2]) !== "invalid") {
        previousRef = direct[2];
        const record = referenceRecord(previousRef, direct[1]);
        packedReferences.set(previousRef, record);
        if (classifyGitReference(previousRef) === "product") productReferences.set(previousRef, record);
        continue;
      }
      const peeled = line.match(/^\^([a-f0-9]{40,64})$/i);
      if (peeled && previousRef) {
        const current = packedReferences.get(previousRef);
        const record = referenceRecord(previousRef, current?.target || "", peeled[1]);
        packedReferences.set(previousRef, record);
        if (classifyGitReference(previousRef) === "product") productReferences.set(previousRef, record);
        continue;
      }
      previousRef = "";
    }
  }
  const refsRoot = path.join(gitPath, "refs");
  const stack = fs.existsSync(refsRoot) ? [refsRoot] : [];
  while (stack.length) {
    const directory = stack.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const ref = path.relative(gitPath, absolute).replaceAll("\\", "/");
      if (classifyGitReference(ref) !== "product") continue;
      const content = fs.readFileSync(absolute, "utf8");
      const record = referenceRecord(ref, content) || {
        ref,
        kind: productReferenceKind(ref),
        targetType: "invalid",
        target: "",
        peeled: "",
        commit: "",
        invalidContentDigest: digest(content),
      };
      productReferences.set(ref, record);
    }
  }
  const references = [...productReferences.values()].sort((left, right) => left.ref.localeCompare(right.ref));
  return {
    referencesDigest: digest(canonicalJson(references)),
    references,
    tagNames: references.filter((item) => item.kind === "tag").map((item) => item.ref.slice("refs/tags/".length)).sort(),
    packedReferences,
  };
}

function looseReferenceRecord(gitPath, ref) {
  if (classifyGitReference(ref) === "invalid") return null;
  const file = path.join(gitPath, ...ref.split("/"));
  if (!fs.existsSync(file)) return null;
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) return null;
  return referenceRecord(ref, fs.readFileSync(file, "utf8"));
}

function resolvedReferenceCommit(gitPath, references, packedReferences, ref, visited = new Set()) {
  if (!ref || visited.has(ref)) return "";
  visited.add(ref);
  const record = references.get(ref) || looseReferenceRecord(gitPath, ref) || packedReferences.get(ref);
  if (!record) return "";
  if (record.targetType === "symbolic") return resolvedReferenceCommit(gitPath, references, packedReferences, record.target, visited);
  return record.kind === "tag" && record.peeled ? record.peeled : record.target;
}

function gitHeadState(root) {
  const gitPath = path.join(root, ".git");
  if (!fs.existsSync(gitPath)) return { status: "not-a-git-repository", ref: "", commit: "", referencesDigest: "" };
  if (!fs.statSync(gitPath).isDirectory()) return { status: "external-gitdir-not-followed", ref: "", commit: "", referencesDigest: "" };
  const referenceState = gitReferenceState(gitPath);
  const { referencesDigest, references, tagNames, packedReferences } = referenceState;
  const referencesByName = new Map(references.map((item) => [item.ref, item]));
  const referencedCommits = () => [...new Set(references
    .filter((item) => item.kind === "branch" || item.kind === "remote")
    .map((item) => resolvedReferenceCommit(gitPath, referencesByName, packedReferences, item.ref))
    .filter(Boolean))].sort();
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
  if (classifyGitReference(ref) === "invalid") return { status: "invalid-ref", ref, commit: "", referencesDigest, references, referenceCommits: referencedCommits(), referenceTags: tagNames };
  const commit = resolvedReferenceCommit(gitPath, referencesByName, packedReferences, ref);
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
  const canonicalPayload = canonicalJson(payload);
  const actualHash = digest(canonicalPayload);
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
  if (new Set(["0.11.0", "0.12.0", WORLD_MODEL_VERSION]).has(snapshot.protocol?.version)) {
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
    const documentChangeProjection = snapshot.documentChangeProjection;
    const graphDocumentChangeProjection = snapshot.temporalProvenanceGraph?.documentChangeProjection;
    if (!documentChangeProjection || documentChangeProjection.authority !== "derived-projection-manifest-not-document-authority"
      || documentChangeProjection.instructionAuthority !== false || documentChangeProjection.promotionAuthority !== false
      || documentChangeProjection.projectionInputId !== graphDocumentChangeProjection?.projectionInputId
      || documentChangeProjection.projectionInputHash !== graphDocumentChangeProjection?.projectionInputHash
      || canonicalJson(documentChangeProjection.candidateSetIds) !== canonicalJson(graphDocumentChangeProjection?.candidateSetIds)
      || canonicalJson(documentChangeProjection.reviewDecisionIds) !== canonicalJson(graphDocumentChangeProjection?.reviewDecisionIds)
      || canonicalJson(documentChangeProjection.productModelRevisionIds) !== canonicalJson(graphDocumentChangeProjection?.productModelRevisionIds)
      || canonicalJson(documentChangeProjection.applicationReceiptIds) !== canonicalJson(graphDocumentChangeProjection?.applicationReceiptIds)) {
      fail("World Model document-change projection and temporal graph disagree.", "DOCUMENT_CHANGE_TEMPORAL_IDENTITY_MISMATCH");
    }
    const operatingProjection = snapshot.productOperatingProjection;
    const graphOperatingProjection = snapshot.temporalProvenanceGraph?.productOperatingProjection;
    if (!operatingProjection || operatingProjection.authority !== "derived-product-graph-manifest-not-product-or-execution-canon"
      || operatingProjection.instructionAuthority !== false || operatingProjection.promotionAuthority !== false
      || operatingProjection.projectionInputId !== graphOperatingProjection?.projectionInputId
      || operatingProjection.projectionInputHash !== graphOperatingProjection?.projectionInputHash
      || canonicalJson(operatingProjection.signalIds) !== canonicalJson(graphOperatingProjection?.signalIds)
      || canonicalJson(operatingProjection.hypothesisIds) !== canonicalJson(graphOperatingProjection?.hypothesisIds)
      || canonicalJson(operatingProjection.initiativeCandidateIds) !== canonicalJson(graphOperatingProjection?.initiativeCandidateIds)
      || canonicalJson(operatingProjection.reviewDecisionIds) !== canonicalJson(graphOperatingProjection?.reviewDecisionIds)
      || canonicalJson(operatingProjection.reviewedInitiativeIds) !== canonicalJson(graphOperatingProjection?.reviewedInitiativeIds)
      || canonicalJson(operatingProjection.featureCandidateIds) !== canonicalJson(graphOperatingProjection?.featureCandidateIds)
      || canonicalJson(operatingProjection.outcomeObservationIds) !== canonicalJson(graphOperatingProjection?.outcomeObservationIds)) {
      fail("World Model product-operating projection and temporal graph disagree.", "PRODUCT_OPERATING_TEMPORAL_IDENTITY_MISMATCH");
    }
  }
  if (snapshot.productModel && snapshot.temporalProvenanceGraph
    && (snapshot.productModel.productModelId !== snapshot.temporalProvenanceGraph.productModelId
      || snapshot.productModel.productModelHash !== snapshot.temporalProvenanceGraph.productModelHash)) {
    fail("World Model product canon and temporal graph disagree.", "PRODUCT_TEMPORAL_IDENTITY_MISMATCH");
  }
  if (snapshot.gitDecisionHistory) verifyGitDecisionHistory(snapshot.gitDecisionHistory);
  if (snapshot.externalRuntimeState) verifyExternalRuntimeState(snapshot.externalRuntimeState);
  const identityBytes = Buffer.byteLength(`,"worldModelHash":${JSON.stringify(recordedHash)},"worldModelId":${JSON.stringify(recordedId)}`, "utf8");
  verifiedSnapshotByteLengths.set(snapshot, Buffer.byteLength(canonicalPayload, "utf8") + identityBytes);
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

const REVISION_KINDS = new Set([
  "FileRevision", "SymbolRevision", "TestRevision", "FeatureGroupRevision",
  "CapabilityRevision", "FeatureRevision", "RequirementRevision", "ConstraintRevision", "DecisionRevision",
]);

function revisionSemantic(node, nodes) {
  const base = { kind: node.kind, logicalEntityId: node.logicalEntityId };
  if (node.kind === "FileRevision") return {
    ...base,
    digest: node.digest,
    language: node.language,
    classification: node.classification,
  };
  if (node.kind === "SymbolRevision") return {
    ...base,
    path: node.path,
    name: node.name,
    symbolKind: node.symbolKind,
    occurrence: node.occurrence,
    line: node.line,
    fileDigest: nodes.get(node.fileRevisionId)?.digest || "",
  };
  if (node.kind === "TestRevision") return {
    ...base,
    path: node.path,
    fileDigest: nodes.get(node.fileRevisionId)?.digest || "",
  };
  return { ...base, key: node.key, semantic: node.semantic };
}

export function deriveIncrementalRevisionParents({ previousGraph, candidateGraph } = {}) {
  verifyTemporalProvenanceGraph(previousGraph);
  verifyTemporalProvenanceGraph(candidateGraph);
  if (previousGraph.projectId !== candidateGraph.projectId) fail("Refresh graphs do not belong to the same project.", "REFRESH_GRAPH_SCOPE_MISMATCH");
  const previousNodes = new Map(previousGraph.nodes.map((node) => [node.nodeId, node]));
  const candidateNodes = new Map(candidateGraph.nodes.map((node) => [node.nodeId, node]));
  const previousRevisions = new Map(previousGraph.nodes
    .filter((node) => REVISION_KINDS.has(node.kind) && node.logicalEntityId)
    .map((node) => [node.logicalEntityId, node]));
  const parents = {};
  for (const candidate of candidateGraph.nodes.filter((node) => REVISION_KINDS.has(node.kind) && node.logicalEntityId)) {
    const previous = previousRevisions.get(candidate.logicalEntityId);
    if (!previous || previous.kind !== candidate.kind) continue;
    const unchanged = canonicalJson(revisionSemantic(previous, previousNodes)) === canonicalJson(revisionSemantic(candidate, candidateNodes));
    parents[candidate.logicalEntityId] = unchanged ? [...previous.parentRevisionIds] : [previous.nodeId];
  }
  return Object.fromEntries(Object.entries(parents).sort(([left], [right]) => left.localeCompare(right)));
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
    documentChangeGraphProjectionVersion: DOCUMENT_CHANGE_GRAPH_PROJECTION_VERSION,
    productOperatingLoopVersion: PRODUCT_OPERATING_LOOP_VERSION,
    vcsEvidenceVersion: VCS_EVIDENCE_VERSION,
    temporalProvenanceVersion: TEMPORAL_PROVENANCE_VERSION,
    graphProjectionAdapterVersion: GRAPH_PROJECTION_ADAPTER_VERSION,
    gitDecisionHistoryVersion: GIT_DECISION_HISTORY_VERSION,
    gitHistoryAdapterVersion: GIT_HISTORY_ADAPTER_VERSION,
    externalRuntimeStateVersion: EXTERNAL_RUNTIME_STATE_VERSION,
    runtimeStateAdapterVersion: RUNTIME_STATE_ADAPTER_VERSION,
  };
}

function sourceDigestFor(files, sourceScope, productModel, onboardingProjection, featureMappingProjection, changeSetProjection, documentChangeProjection, productOperatingProjection, git, runtimeState, externalRuntimeState, indexer, parentSourceSnapshotIds = [], revisionParentIds = {}) {
  return digest(canonicalJson({
    files,
    sourceScope: { sourceScopeId: sourceScope.sourceScopeId, sourceScopeHash: sourceScope.sourceScopeHash },
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
    documentChangeProjection: {
      projectionInputId: documentChangeProjection.projectionInputId,
      projectionInputHash: documentChangeProjection.projectionInputHash,
    },
    productOperatingProjection: {
      projectionInputId: productOperatingProjection.projectionInputId,
      projectionInputHash: productOperatingProjection.projectionInputHash,
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
  const sourceScopeState = readRepositorySourceScope({ projectRoot: inspected.project.projectRoot });
  const sourceScope = sourceScopeState.sourceScope;
  const scanInput = buildRepositoryScanInput({
    projectRoot: inspected.project.projectRoot,
    managedRootFiles: managedRootFilesForProject(inspected.project),
    sourceScope,
  });
  const storedSourceScope = stored.snapshot.repositoryScan?.sourceScope || buildRepositorySourceScope();
  const freshness = inspectRepositoryScanFreshness({
    projectRoot: inspected.project.projectRoot,
    managedRootFiles: managedRootFilesForProject(inspected.project),
    sourceScope,
    storedFiles: stored.snapshot.files,
  });
  const sourceScopeChanged = sourceScope.sourceScopeId !== storedSourceScope.sourceScopeId;
  const scan = freshness.status === "unchanged" && !sourceScopeChanged
    ? { files: stored.snapshot.files }
    : scanRepositoryReference(scanInput);
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
  const documentChangeProjection = loadDocumentChangeProjection({
    projectRoot: inspected.project.projectRoot,
    projectId: inspected.project.projectId,
  });
  const productOperatingProjection = loadProductOperatingProjection({
    projectRoot: inspected.project.projectRoot,
    projectId: inspected.project.projectId,
  });
  const git = gitHeadState(inspected.project.projectRoot);
  const runtimeState = runtimeStateFor(inspected.state);
  const selectedRuntimeAdapter = runtimeStateAdapter || runtimeStateAdapterFromDescriptor(stored.pointer.sourceAdapters?.runtimeState);
  const externalRuntimeResult = buildExternalRuntimeState({ projectRoot: inspected.project.projectRoot, adapter: selectedRuntimeAdapter });
  const externalRuntimeState = externalRuntimeResult.runtimeState;
  const currentSourceDigest = sourceDigestFor(
    scan.files,
    sourceScope,
    productCanon.model,
    onboardingProjection,
    featureMappingProjection,
    changeSetProjection,
    documentChangeProjection,
    productOperatingProjection,
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
  const productModelChanged = productCanon.model.productModelHash !== stored.snapshot.productModel?.productModelHash;
  const onboardingProjectionChanged = onboardingProjection.projectionInputHash !== stored.snapshot.onboardingProjection?.projectionInputHash;
  const featureMappingProjectionChanged = featureMappingProjection.projectionInputHash !== stored.snapshot.featureMappingProjection?.projectionInputHash;
  const changeSetProjectionChanged = changeSetProjection.projectionInputHash !== stored.snapshot.changeSetProjection?.projectionInputHash;
  const documentChangeProjectionChanged = documentChangeProjection.projectionInputHash !== stored.snapshot.documentChangeProjection?.projectionInputHash;
  const productOperatingProjectionChanged = productOperatingProjection.projectionInputHash !== stored.snapshot.productOperatingProjection?.projectionInputHash;
  return {
    ...stored,
    status: currentSourceDigest === stored.snapshot.sourceDigest ? "current" : "stale",
    currentSourceDigest,
    changes: {
      ...fileChanges,
      sourceScopeChanged,
      gitChanged: canonicalJson(git) !== canonicalJson(stored.snapshot.git),
      gitHistoryChanged: git.referencesDigest !== stored.snapshot.git?.referencesDigest,
      runtimeStateChanged: canonicalJson(runtimeState) !== canonicalJson(stored.snapshot.runtimeState),
      externalRuntimeStateChanged: externalRuntimeState.runtimeStateHash !== stored.snapshot.externalRuntimeState?.runtimeStateHash,
      productModelChanged,
      onboardingProjectionChanged,
      featureMappingProjectionChanged,
      changeSetProjectionChanged,
      documentChangeProjectionChanged,
      productOperatingProjectionChanged,
      temporalProvenanceChanged: sourceScopeChanged || fileChanges.added.length > 0 || fileChanges.changed.length > 0 || fileChanges.removed.length > 0
        || productModelChanged || onboardingProjectionChanged || featureMappingProjectionChanged || changeSetProjectionChanged || documentChangeProjectionChanged || productOperatingProjectionChanged,
    },
    fileFreshness,
    sourceAdapters: { runtimeState: externalRuntimeResult.adapter },
    sourceDiagnostics: { runtimeState: externalRuntimeResult.diagnostics },
  };
}

function boundedPathSummary(items, limit) {
  const values = [...new Set((Array.isArray(items) ? items : []).filter((item) => typeof item === "string"))]
    .sort((left, right) => left.localeCompare(right));
  return {
    count: values.length,
    sample: values.slice(0, limit),
    omittedCount: Math.max(0, values.length - limit),
  };
}

function snapshotSerializedByteLength(snapshot) {
  const verifiedLength = verifiedSnapshotByteLengths.get(snapshot);
  return Number.isSafeInteger(verifiedLength)
    ? verifiedLength
    : Buffer.byteLength(JSON.stringify(snapshot), "utf8");
}

export function buildWorldModelStatusProjection(inspection, { sampleLimit = WORLD_MODEL_STATUS_SAMPLE_LIMIT } = {}) {
  if (!inspection?.snapshot || !inspection?.pointer || !new Set(["current", "stale"]).has(inspection.status)) {
    fail("A verified World Model inspection is required for status projection.", "INVALID_WORLD_MODEL_STATUS_INPUT");
  }
  if (!Number.isInteger(sampleLimit) || sampleLimit < 0 || sampleLimit > WORLD_MODEL_STATUS_SAMPLE_LIMIT) {
    fail(`World Model status sample limit must be between 0 and ${WORLD_MODEL_STATUS_SAMPLE_LIMIT}.`, "INVALID_WORLD_MODEL_STATUS_SAMPLE_LIMIT");
  }

  const snapshot = inspection.snapshot;
  const freshnessCounts = { active: 0, stale: 0, removed: 0, unindexed: 0 };
  const nonActiveFiles = [];
  for (const item of inspection.fileFreshness || []) {
    if (Object.hasOwn(freshnessCounts, item.status)) freshnessCounts[item.status] += 1;
    if (item.status !== "active") nonActiveFiles.push({ path: item.path, status: item.status });
  }
  nonActiveFiles.sort((left, right) => left.path.localeCompare(right.path) || left.status.localeCompare(right.status));

  const changeFlags = Object.fromEntries(Object.entries(inspection.changes || {})
    .filter(([, value]) => typeof value === "boolean")
    .sort(([left], [right]) => left.localeCompare(right)));
  const counts = Object.fromEntries(Object.entries(snapshot.summary || {})
    .filter(([, value]) => Number.isSafeInteger(value) && value >= 0)
    .sort(([left], [right]) => left.localeCompare(right)));
  const skippedCounts = Object.fromEntries(Object.entries(snapshot.skipped || {})
    .filter(([, value]) => Number.isSafeInteger(value) && value >= 0)
    .sort(([left], [right]) => left.localeCompare(right)));
  const storage = inspection.storeAdapter || {};
  const temporalGraph = snapshot.temporalProvenanceGraph || {};

  const payload = {
    schemaVersion: 1,
    kind: "WorldModelStatusProjection",
    protocol: { name: "head-agent-core-world-model-status", version: WORLD_MODEL_STATUS_PROJECTION_VERSION },
    status: inspection.status,
    verification: {
      completeSnapshotDigestVerified: true,
      completeSnapshotStructureVerified: true,
      completeRepositoryFreshnessChecked: true,
    },
    authority: "derived-read-only-status-projection",
    authorityPlane: "P4-derived-relation-view",
    instructionAuthority: false,
    promotionAuthority: false,
    mutationAuthority: false,
    identities: {
      projectId: snapshot.projectId,
      worldModelId: snapshot.worldModelId,
      worldModelHash: snapshot.worldModelHash,
      storedSourceDigest: snapshot.sourceDigest,
      currentSourceDigest: inspection.currentSourceDigest,
      sourceSnapshotId: temporalGraph.sourceSnapshotId || snapshot.summary?.sourceSnapshotId || null,
      graphSnapshotId: temporalGraph.graphSnapshotId || null,
      graphSnapshotHash: temporalGraph.graphSnapshotHash || null,
      semanticGraphId: snapshot.semanticGraph?.semanticGraphId || null,
      semanticGraphHash: snapshot.semanticGraph?.semanticGraphHash || null,
      productModelId: snapshot.productModel?.productModelId || null,
      productModelHash: snapshot.productModel?.productModelHash || null,
    },
    counts,
    freshness: {
      files: {
        counts: freshnessCounts,
        nonActiveSample: nonActiveFiles.slice(0, sampleLimit),
        omittedNonActiveCount: Math.max(0, nonActiveFiles.length - sampleLimit),
      },
      changes: {
        added: boundedPathSummary(inspection.changes?.added, sampleLimit),
        changed: boundedPathSummary(inspection.changes?.changed, sampleLimit),
        removed: boundedPathSummary(inspection.changes?.removed, sampleLimit),
        flags: changeFlags,
      },
    },
    skipped: {
      counts: skippedCounts,
      totalCount: Object.values(skippedCounts).reduce((total, count) => total + count, 0),
    },
    storage: {
      contract: storage.contract || null,
      adapterKind: storage.adapterKind || null,
      adapterVersion: storage.adapterVersion || null,
      authority: storage.authority || null,
      rebuildable: storage.rebuildable === true,
      uniqueAuthority: storage.uniqueAuthority === true,
      remote: storage.remote === true,
      durable: storage.durable === true,
    },
    fullSnapshot: {
      omitted: true,
      serializedByteLength: snapshotSerializedByteLength(snapshot),
      worldModelId: snapshot.worldModelId,
      worldModelHash: snapshot.worldModelHash,
      localInspectionCommand: "head-agent world-status <project>",
      boundedDetailTools: ["head_world_query", "head_temporal_graph", "head_git_history", "head_runtime_state"],
    },
  };
  const statusProjectionHash = digest(canonicalJson(payload));
  const projection = {
    ...payload,
    statusProjectionId: `world-model-status-${statusProjectionHash.slice(0, 24)}`,
    statusProjectionHash,
  };
  const byteLength = Buffer.byteLength(JSON.stringify(projection), "utf8");
  if (byteLength > WORLD_MODEL_STATUS_PROJECTION_MAX_BYTES) {
    fail(`World Model status projection exceeds ${WORLD_MODEL_STATUS_PROJECTION_MAX_BYTES} bytes.`, "WORLD_MODEL_STATUS_PROJECTION_TOO_LARGE");
  }
  return projection;
}

export function inspectWorldModelStatus({ root = ".", storeAdapter = null, runtimeStateAdapter = null } = {}) {
  return buildWorldModelStatusProjection(inspectWorldModel({ root, storeAdapter, runtimeStateAdapter }));
}

async function buildWorldModelLocked({
  root = ".",
  persist = true,
  storeAdapter = null,
  graphProjectionAdapter = null,
  gitHistoryAdapter = null,
  runtimeStateAdapter = null,
  computeAdapter = null,
  onboardingProjectionInput = null,
  featureMappingProjectionInput = null,
  changeSetProjectionInput = null,
  documentChangeProjectionInput = null,
  productOperatingProjectionInput = null,
  parentSourceSnapshotIds = [],
  revisionParentIds = {},
  repositoryScanExecution = null,
  expectedWorldModelId = "",
  expectedCurrentWorldModelId = "",
  writerLease = null,
} = {}) {
  const inspected = readyProject(root);
  const project = inspected.project;
  const managedRootFiles = managedRootFilesForProject(project);
  const sourceScope = readRepositorySourceScope({ projectRoot: project.projectRoot }).sourceScope;
  const selectedRepositoryScanExecution = repositoryScanExecution
    ? validateRepositoryScanExecution(repositoryScanExecution, { projectRoot: project.projectRoot, managedRootFiles, sourceScope })
    : await executeRepositoryScan({
      adapter: computeAdapter || createRepositoryScanComputeAdapter(),
      projectRoot: project.projectRoot,
      managedRootFiles,
      sourceScope,
    });
  const scan = validateRepositoryScanResult(selectedRepositoryScanExecution.result);
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
  const documentChangeProjection = documentChangeProjectionInput || loadDocumentChangeProjection({
    projectRoot: project.projectRoot,
    projectId: project.projectId,
  });
  const productOperatingProjection = productOperatingProjectionInput || loadProductOperatingProjection({
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
    documentChangeProjection,
    productOperatingProjection,
    parentSourceSnapshotIds,
    revisionParentIds,
  });
  const sourceDigest = sourceDigestFor(
    scan.files,
    sourceScope,
    productCanon.model,
    onboardingProjection,
    featureMappingProjection,
    changeSetProjection,
    documentChangeProjection,
    productOperatingProjection,
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
      sourceScope,
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
      documentChangeProjection: "immutable-document-edit-candidates-reviews-product-revisions-and-application-receipts-projected-as-non-authoritative-audit-lineage",
      productOperatingProjection: "epistemically-typed-signals-hypotheses-human-reviewed-initiatives-feature-links-and-outcome-observations-as-derived-product-graph",
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
    documentChangeProjection: {
      projectionInputId: documentChangeProjection.projectionInputId,
      projectionInputHash: documentChangeProjection.projectionInputHash,
      candidateSetIds: documentChangeProjection.candidateSets.map((item) => item.candidateSetId),
      reviewDecisionIds: documentChangeProjection.reviewDecisions.map((item) => item.reviewDecisionId),
      productModelRevisionIds: documentChangeProjection.productModelRevisions.map((item) => `document-product-model-revision-${item.revisionHash.slice(0, 24)}`),
      applicationReceiptIds: documentChangeProjection.applicationReceipts.map((item) => item.applicationReceiptId),
      authority: "derived-projection-manifest-not-document-authority",
      instructionAuthority: false,
      promotionAuthority: false,
    },
    productOperatingProjection: {
      projectionInputId: productOperatingProjection.projectionInputId,
      projectionInputHash: productOperatingProjection.projectionInputHash,
      signalIds: productOperatingProjection.signals.map((item) => item.signalId),
      hypothesisIds: productOperatingProjection.hypotheses.map((item) => item.hypothesisId),
      initiativeCandidateIds: productOperatingProjection.initiativeCandidates.map((item) => item.initiativeCandidateId),
      reviewDecisionIds: productOperatingProjection.initiativeReviews.map((item) => item.reviewDecisionId),
      reviewedInitiativeIds: productOperatingProjection.reviewedInitiatives.map((item) => item.initiativeId),
      featureCandidateIds: productOperatingProjection.featureCandidates.map((item) => item.featureCandidateId),
      outcomeObservationIds: productOperatingProjection.outcomeObservations.map((item) => item.outcomeObservationId),
      authority: "derived-product-graph-manifest-not-product-or-execution-canon",
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
      sourceScope: scan.sourceScope,
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
      documentChangeCandidateSetCount: temporalProvenanceGraph.summary.documentChangeCandidateSetCount,
      documentChangeCandidateCount: temporalProvenanceGraph.summary.documentChangeCandidateCount,
      documentChangeReviewDecisionCount: temporalProvenanceGraph.summary.documentChangeReviewDecisionCount,
      documentChangeProductModelRevisionCount: temporalProvenanceGraph.summary.documentChangeProductModelRevisionCount,
      documentChangeApplicationCount: temporalProvenanceGraph.summary.documentChangeApplicationCount,
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
    sourceAdapters: { compute: selectedRepositoryScanExecution.diagnostics },
    sourceDiagnostics: { compute: selectedRepositoryScanExecution.diagnostics },
  };

  if (expectedWorldModelId && worldModelId !== expectedWorldModelId) {
    fail("World Model changed after refresh preview; current pointer was not advanced.", "REFRESH_PREVIEW_DRIFT");
  }

  const adapter = createWorldModelStoreAdapter({ projectRoot: project.projectRoot, adapter: storeAdapter });
  let previous = null;
  let previousPointer = null;
  const currentPointerEntry = adapter.readPointer();
  if (expectedCurrentWorldModelId && currentPointerEntry?.document?.worldModelId !== expectedCurrentWorldModelId) {
    fail("World Model current pointer changed during refresh.", "REFRESH_POINTER_CONFLICT");
  }
  if (currentPointerEntry) {
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
  const graphProjection = materializeGraphProjectionWithCanonFence({
    projectRoot: project.projectRoot,
    graph: temporalProvenanceGraph,
    adapter: graphProjectionAdapter,
  });
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
    productOperatingProjectionChanged: changed && previous?.productOperatingProjection?.projectionInputHash !== snapshot.productOperatingProjection.projectionInputHash,
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
        backend: selectedRepositoryScanExecution.diagnostics.backend,
        adapterName: selectedRepositoryScanExecution.diagnostics.adapterName,
        executionMode: selectedRepositoryScanExecution.diagnostics.executionMode,
        requestId: selectedRepositoryScanExecution.request.requestId,
        resultDigest: selectedRepositoryScanExecution.response.resultDigest,
        fallbackUsed: selectedRepositoryScanExecution.diagnostics.fallbackUsed || false,
        fallbackReasonCode: selectedRepositoryScanExecution.diagnostics.fallbackReasonCode || "",
        workerRelativePath: selectedRepositoryScanExecution.diagnostics.workerRelativePath || "",
        workerSha256: selectedRepositoryScanExecution.diagnostics.workerSha256 || "",
      },
      runtimeState: externalRuntimeResult.adapter,
      graphProjection: {
        ...graphProjection.adapter,
        pointerId: graphProjection.pointer.pointerId,
        graphSnapshotId: graphProjection.pointer.graphSnapshotId,
        graphSnapshotHash: graphProjection.pointer.graphSnapshotHash,
      },
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
    graphProjection,
    sourceAdapters: {
      compute: pointer.sourceAdapters.compute,
      gitHistory: gitHistoryResult.adapter,
      runtimeState: externalRuntimeResult.adapter,
      graphProjection: pointer.sourceAdapters.graphProjection,
    },
    sourceDiagnostics: {
      compute: selectedRepositoryScanExecution.diagnostics,
      gitHistory: gitHistoryResult.diagnostics,
      runtimeState: externalRuntimeResult.diagnostics,
    },
  };
}

export async function buildWorldModel(options = {}) {
  const persist = options.persist ?? true;
  if (!persist) return buildWorldModelLocked(options);
  const inspected = readyProject(options.root ?? ".");
  return withRefreshWriterLease({
    projectRoot: inspected.project.projectRoot,
    projectId: inspected.project.projectId,
    lease: options.writerLease || null,
  }, (writerLease) => buildWorldModelLocked({ ...options, writerLease }));
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
  authorityClasses = ["canon-projected", "reviewed", "derived", "heuristic", "runtime-observed"],
  freshness = ["current"],
  minConfidence = 0,
  includeUnreviewedCandidates = false,
  depth = 1,
  maxNodes = 100,
  maxEdges = 200,
  storeAdapter = null,
  graphProjectionAdapter = null,
} = {}) {
  const inspected = inspectWorldModel({ root, storeAdapter });
  if (inspected.status !== "current") fail("Repository World Model is stale and cannot answer temporal provenance queries.", "WORLD_MODEL_STALE");
  if (!inspected.snapshot.temporalProvenanceGraph) fail("Repository World Model has no temporal provenance graph.", "TEMPORAL_PROVENANCE_NOT_BUILT");
  const projected = queryGraphProjection({
    projectRoot: inspected.snapshot.projectRoot,
    graph: inspected.snapshot.temporalProvenanceGraph,
    adapter: graphProjectionAdapter,
    query: {
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
    },
  });
  return {
    status: "current",
    worldModelId: inspected.snapshot.worldModelId,
    ...projected.result,
    graphProjection: projected.diagnostics,
  };
}

export function inspectWorldGraphProjection({ root = ".", storeAdapter = null, graphProjectionAdapter = null } = {}) {
  const inspected = inspectWorldModel({ root, storeAdapter });
  const projection = inspectGraphProjection({
    projectRoot: inspected.snapshot.projectRoot,
    graph: inspected.snapshot.temporalProvenanceGraph,
    adapter: graphProjectionAdapter,
  });
  return {
    status: projection.status,
    worldModelStatus: inspected.status,
    worldModelId: inspected.snapshot.worldModelId,
    graphSnapshotId: inspected.snapshot.temporalProvenanceGraph.graphSnapshotId,
    projection,
    authority: "rebuildable-derived-projection-not-project-canon",
  };
}

export function materializeWorldMarkdownProjection({ root = ".", storeAdapter = null, documentProjectionAdapter = null } = {}) {
  const inspected = inspectWorldModel({ root, storeAdapter });
  if (inspected.status !== "current") fail("Repository World Model is stale and cannot regenerate document projections.", "WORLD_MODEL_STALE");
  const materialized = materializeMarkdownProjection({
    projectRoot: inspected.snapshot.projectRoot,
    graph: inspected.snapshot.temporalProvenanceGraph,
    adapter: documentProjectionAdapter,
  });
  return {
    status: materialized.status,
    worldModelStatus: inspected.status,
    worldModelId: inspected.snapshot.worldModelId,
    graphSnapshotId: inspected.snapshot.temporalProvenanceGraph.graphSnapshotId,
    documentProjectionId: materialized.projection.documentProjectionId,
    projection: materialized,
    authority: "rebuildable-derived-human-view-not-project-canon",
  };
}

export function inspectWorldMarkdownProjection({ root = ".", storeAdapter = null, documentProjectionAdapter = null } = {}) {
  const inspected = inspectWorldModel({ root, storeAdapter });
  const projection = inspectMarkdownProjection({
    projectRoot: inspected.snapshot.projectRoot,
    graph: inspected.snapshot.temporalProvenanceGraph,
    adapter: documentProjectionAdapter,
  });
  const documentOnlyDriftKeys = new Set(["documentChangeProjectionChanged", "temporalProvenanceChanged"]);
  const hasNonDocumentDrift = Object.entries(inspected.changes || {}).some(([key, value]) => !documentOnlyDriftKeys.has(key)
    && (Array.isArray(value) ? value.length > 0 : value === true));
  const status = inspected.status !== "current" && hasNonDocumentDrift && projection.status === "current" ? "source-stale" : projection.status;
  return {
    status,
    worldModelStatus: inspected.status,
    worldModelId: inspected.snapshot.worldModelId,
    graphSnapshotId: inspected.snapshot.temporalProvenanceGraph.graphSnapshotId,
    projection,
    authority: "rebuildable-derived-human-view-not-project-canon",
  };
}

export function captureWorldMarkdownChanges({ root = ".", storeAdapter = null, documentProjectionAdapter = null, persist = true } = {}) {
  const inspected = inspectWorldModel({ root, storeAdapter });
  const documentOnlyDriftKeys = new Set(["documentChangeProjectionChanged", "temporalProvenanceChanged"]);
  const nonDocumentDrift = Object.entries(inspected.changes || {}).some(([key, value]) => !documentOnlyDriftKeys.has(key)
    && (Array.isArray(value) ? value.length > 0 : value === true));
  if (inspected.status !== "current" && (!inspected.changes?.documentChangeProjectionChanged || nonDocumentDrift)) {
    fail("Repository World Model has non-document drift and cannot anchor document change candidates.", "WORLD_MODEL_STALE");
  }
  const captured = captureDocumentChangeCandidates({
    projectRoot: inspected.snapshot.projectRoot,
    graph: inspected.snapshot.temporalProvenanceGraph,
    adapter: documentProjectionAdapter,
    persist,
  });
  return {
    status: captured.status,
    worldModelId: inspected.snapshot.worldModelId,
    graphSnapshotId: inspected.snapshot.temporalProvenanceGraph.graphSnapshotId,
    ...captured,
    authority: "unreviewed-document-change-candidates-not-project-canon",
  };
}

export function readWorldDocumentChangeCandidateSet({ root = ".", candidateSetId: id } = {}) {
  const inspected = readyProject(root);
  return readDocumentChangeCandidateSet({ projectRoot: inspected.project.projectRoot, id });
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
