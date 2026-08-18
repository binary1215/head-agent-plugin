import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { inspectProject, SCHEMA_VERSION } from "./head-core.mjs";
import {
  FEATURE_MAPPING_CANDIDATE_DIRECTORY,
  FEATURE_MAPPING_REVIEW_DIRECTORY,
  FEATURE_MAPPING_STATE_RELATIVE_PATH,
  FEATURE_MAPPING_VERSION,
  featureMappingCanonicalJson,
  featureMappingDigest,
  loadFeatureMappingProjection,
  verifyFeatureMappingCandidateSet,
  verifyFeatureMappingReviewDecision,
} from "./feature-mapping-projection.mjs";
import { buildWorldModel, inspectWorldModel } from "./world-model.mjs";

const MAX_CANDIDATES = 500;
const MAX_EVIDENCE = 750;
const MAX_UNKNOWNS = 100;
const STOP_TERMS = new Set([
  "and", "the", "for", "from", "with", "this", "that", "into", "feature", "capability", "service",
  "handler", "manager", "model", "core", "main", "index", "file", "test", "tests", "spec", "src",
]);

const fail = (message, code = "FEATURE_MAPPING_ERROR") => {
  const error = new Error(message);
  error.code = code;
  throw error;
};

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const now = () => new Date().toISOString();

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) fail(`${label} is required.`, "INVALID_FEATURE_MAPPING_INPUT");
  return value.trim();
}

function readyProject(root, action = "feature mapping") {
  const inspected = inspectProject(root);
  if (inspected.status !== "ready") {
    fail(`Project must be ready for ${action}; current status: ${inspected.status}.`, "PROJECT_NOT_READY");
  }
  return inspected;
}

function relativeFile(projectRoot, relative) {
  const root = path.resolve(projectRoot);
  const candidate = path.resolve(root, ...relative.split("/"));
  const fromRoot = path.relative(root, candidate);
  if (fromRoot === ".." || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) {
    fail(`Feature mapping artifact path escapes the project root: ${relative}`, "FEATURE_MAPPING_PATH_ESCAPE");
  }
  let current = root;
  for (const segment of fromRoot.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      fail(`Feature mapping artifact path traverses a symlink: ${relative}`, "FEATURE_MAPPING_SYMLINK_PATH");
    }
  }
  return candidate;
}

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, content, { encoding: "utf8", flag: "wx" });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function readJson(file, label) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { fail(`${label} is invalid JSON: ${error.message}`, "INVALID_FEATURE_MAPPING_ARTIFACT"); }
}

function persistImmutable(file, document, label) {
  if (fs.existsSync(file)) {
    const existing = readJson(file, label);
    if (featureMappingCanonicalJson(existing) !== featureMappingCanonicalJson(document)) {
      fail(`${label} identity collision detected.`, "FEATURE_MAPPING_IMMUTABLE_COLLISION");
    }
    return { status: "existing", file, document: existing };
  }
  atomicWrite(file, json(document));
  return { status: "recorded", file, document };
}

function stateFile(projectRoot) {
  return relativeFile(projectRoot, FEATURE_MAPPING_STATE_RELATIVE_PATH);
}

function candidateSetFile(projectRoot, candidateSetId) {
  if (!/^feature-mapping-candidates-[a-f0-9]{24}$/.test(candidateSetId || "")) {
    fail("Feature mapping candidate-set id is invalid.", "INVALID_FEATURE_MAPPING_CANDIDATE_SET_ID");
  }
  return relativeFile(projectRoot, `${FEATURE_MAPPING_CANDIDATE_DIRECTORY}/${candidateSetId}.json`);
}

function reviewDecisionFile(projectRoot, reviewDecisionId) {
  if (!/^feature-mapping-review-decision-[a-f0-9]{24}$/.test(reviewDecisionId || "")) {
    fail("Feature mapping ReviewDecision id is invalid.", "INVALID_FEATURE_MAPPING_REVIEW_ID");
  }
  return relativeFile(projectRoot, `${FEATURE_MAPPING_REVIEW_DIRECTORY}/${reviewDecisionId}.json`);
}

function buildState({ projectId, sessionId, phase, stateRevision, candidateSetId = null, reviewDecisionId = null,
  worldModelId = null, graphSnapshotId = null, sourceSnapshotId = null, productModelId = null, updatedAt } = {}) {
  if (!["awaiting-evidence", "awaiting-review", "reviewed", "rejected"].includes(phase)
    || !Number.isInteger(stateRevision) || stateRevision < 0) {
    fail("Feature mapping state fields are invalid.", "INVALID_FEATURE_MAPPING_STATE");
  }
  const payload = {
    schemaVersion: 1,
    kind: "FeatureMappingStatePointer",
    protocol: { name: "head-agent-core-feature-mapping", version: FEATURE_MAPPING_VERSION },
    projectId: requiredText(projectId, "projectId"),
    sessionId: requiredText(sessionId, "sessionId"),
    phase,
    stateRevision,
    candidateSetId,
    reviewDecisionId,
    worldModelId,
    graphSnapshotId,
    sourceSnapshotId,
    productModelId,
    updatedAt: requiredText(updatedAt, "updatedAt"),
  };
  return { ...payload, pointerHash: featureMappingDigest(featureMappingCanonicalJson(payload)) };
}

function verifyState(document, { projectId, sessionId }) {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    fail("Feature mapping state pointer is invalid.", "INVALID_FEATURE_MAPPING_STATE");
  }
  const payload = { ...document };
  delete payload.pointerHash;
  if (document.pointerHash !== featureMappingDigest(featureMappingCanonicalJson(payload))) {
    fail("Feature mapping state pointer digest verification failed.", "FEATURE_MAPPING_STATE_DIGEST_MISMATCH");
  }
  const rebuilt = buildState({ ...payload });
  if (featureMappingCanonicalJson(rebuilt) !== featureMappingCanonicalJson(document)
    || document.projectId !== projectId || document.sessionId !== sessionId) {
    fail("Feature mapping state pointer identity is invalid.", "FEATURE_MAPPING_STATE_IDENTITY_MISMATCH");
  }
  return document;
}

function writeState(projectRoot, previous, changes) {
  const state = buildState({
    ...previous,
    ...changes,
    stateRevision: previous ? previous.stateRevision + 1 : 0,
    updatedAt: now(),
  });
  atomicWrite(stateFile(projectRoot), json(state));
  return state;
}

function terms(...values) {
  const text = values.filter(Boolean).join(" ").normalize("NFKC").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLocaleLowerCase();
  return new Set((text.match(/[\p{L}\p{N}]+/gu) || []).filter((term) => term.length >= 3 && !STOP_TERMS.has(term)));
}

function intersection(left, right) {
  return [...left].filter((value) => right.has(value)).sort();
}

function endpointFor(node, revision, extra = {}) {
  return {
    nodeId: node.nodeId,
    kind: node.kind,
    revisionId: revision.nodeId,
    path: node.path || "",
    name: node.name || "",
    key: node.key || "",
    ...extra,
  };
}

function evidenceArtifact({ sourceKind, sourceNodeId, sourceRevisionId, path: sourcePath = "", line = null, contentDigest = "", statement }) {
  const payload = {
    schemaVersion: 1,
    kind: "FeatureMappingEvidence",
    sourceKind,
    sourceNodeId,
    sourceRevisionId,
    path: sourcePath,
    line: Number.isInteger(line) && line > 0 ? line : null,
    contentDigest,
    statement: requiredText(statement, "Evidence statement"),
    instructionAuthority: false,
    promotionAuthority: false,
  };
  const hash = featureMappingDigest(featureMappingCanonicalJson(payload));
  return { ...payload, evidenceId: `feature-mapping-evidence-${hash.slice(0, 24)}`, evidenceHash: hash };
}

function candidateArtifact({ relationshipType, from, to, evidenceIds, explanation, confidence, sourceSnapshotId, origin }) {
  const payload = {
    schemaVersion: 1,
    kind: "FeatureMappingCandidate",
    relationshipType,
    from,
    to,
    evidenceIds: [...new Set(evidenceIds)].sort(),
    explanation: requiredText(explanation, "Candidate explanation"),
    confidence: Number(confidence.toFixed(6)),
    sourceSnapshotId,
    origin,
    producer: "head-agent-core-feature-mapping-inference",
    producerVersion: FEATURE_MAPPING_VERSION,
    authorityClass: "candidate",
    instructionAuthority: false,
    promotionAuthority: false,
  };
  const hash = featureMappingDigest(featureMappingCanonicalJson(payload));
  return { ...payload, candidateId: `feature-mapping-candidate-${hash.slice(0, 24)}`, candidateHash: hash };
}

function unknownArtifact(sourceSnapshotId, kind, statement, evidenceIds = []) {
  const normalizedEvidenceIds = [...new Set(evidenceIds)].sort();
  const hash = featureMappingDigest(featureMappingCanonicalJson({ sourceSnapshotId, kind, statement, evidenceIds: normalizedEvidenceIds }));
  return { unknownId: `feature-mapping-unknown-${hash.slice(0, 24)}`, statement, evidenceIds: normalizedEvidenceIds, status: "open" };
}

function candidateSetArtifact({ project, sessionId, worldModel, candidates, evidence, unknowns }) {
  const orderedCandidates = [...candidates].sort((left, right) => left.candidateId.localeCompare(right.candidateId)).slice(0, MAX_CANDIDATES);
  const usedEvidence = new Set(orderedCandidates.flatMap((candidate) => candidate.evidenceIds));
  const orderedEvidence = [...evidence].filter((item) => usedEvidence.has(item.evidenceId))
    .sort((left, right) => left.evidenceId.localeCompare(right.evidenceId)).slice(0, MAX_EVIDENCE);
  const payload = {
    schemaVersion: 1,
    kind: "FeatureMappingCandidateSet",
    protocol: { name: "head-agent-core-feature-mapping-candidates", version: FEATURE_MAPPING_VERSION },
    projectId: project.projectId,
    sessionId,
    worldModelId: worldModel.worldModelId,
    graphSnapshotId: worldModel.temporalProvenanceGraph.graphSnapshotId,
    sourceSnapshotId: worldModel.temporalProvenanceGraph.sourceSnapshotId,
    productModelId: worldModel.productModel.productModelId,
    productModelHash: worldModel.productModel.productModelHash,
    candidates: orderedCandidates,
    evidence: orderedEvidence,
    unknowns: [...unknowns].sort((left, right) => left.unknownId.localeCompare(right.unknownId)).slice(0, MAX_UNKNOWNS),
    reviewProtocol: {
      decisionScope: "feature-implementation-mapping",
      allowedDispositions: ["accept-all", "accept-selection", "reject"],
      authorityTransition: "only-an-explicit-feature-mapping-review-may-create-reviewed-relationships",
      reviewedRelationshipsAreSeparateFromCandidates: true,
    },
    limits: { maxCandidates: MAX_CANDIDATES, maxEvidence: MAX_EVIDENCE, maxUnknowns: MAX_UNKNOWNS },
    authorityClass: "candidate-set",
    instructionAuthority: false,
    promotionAuthority: false,
  };
  const hash = featureMappingDigest(featureMappingCanonicalJson(payload));
  return verifyFeatureMappingCandidateSet({
    ...payload,
    candidateSetId: `feature-mapping-candidates-${hash.slice(0, 24)}`,
    candidateSetHash: hash,
  }, project.projectId);
}

function inferCandidates(worldModel) {
  const graph = worldModel.temporalProvenanceGraph;
  const nodeById = new Map(graph.nodes.map((node) => [node.nodeId, node]));
  const currentRevisionByLogical = new Map(graph.edges.filter((edge) => edge.type === "CURRENT_REVISION")
    .map((edge) => [edge.from, nodeById.get(edge.to)]));
  const fileDigestById = new Map(graph.nodes.filter((node) => node.kind === "FileRevision")
    .map((revision) => [revision.logicalEntityId, revision.digest]));
  const fileClassificationById = new Map(graph.nodes.filter((node) => node.kind === "FileRevision")
    .map((revision) => [revision.logicalEntityId, revision.classification]));
  const productNodes = graph.nodes.filter((node) => ["Feature", "Capability"].includes(node.kind));
  const implementationNodes = graph.nodes.filter((node) => ["File", "Symbol"].includes(node.kind)
    && fileClassificationById.get(node.kind === "Symbol" ? node.fileId : node.nodeId) !== "test");
  const testNodes = graph.nodes.filter((node) => node.kind === "Test");
  const evidenceById = new Map();
  const candidates = [];
  const unknowns = [];

  if (!productNodes.length) {
    unknowns.push(unknownArtifact(graph.sourceSnapshotId, "missing-product-canon", "No authoritative Feature or Capability exists. Complete Product Canon onboarding before implementation mapping."));
    return { candidates, evidence: [], unknowns };
  }

  const addCandidate = ({ productNode, productRevision, sourceNode, sourceRevision, relationshipType, overlapTerms, confidence }) => {
    const sourceFileId = sourceNode.kind === "Symbol" ? sourceNode.fileId : sourceNode.fileId || sourceNode.nodeId;
    const contentDigest = fileDigestById.get(sourceFileId) || "";
    const evidence = evidenceArtifact({
      sourceKind: `repository-${sourceNode.kind.toLocaleLowerCase()}`,
      sourceNodeId: sourceNode.nodeId,
      sourceRevisionId: sourceRevision.nodeId,
      path: sourceNode.path || sourceRevision.path || "",
      line: sourceRevision.line || null,
      contentDigest,
      statement: `Observed ${sourceNode.kind} ${sourceNode.name || sourceNode.path} shares terms [${overlapTerms.join(", ")}] with authoritative ${productNode.kind} ${productRevision.semantic.name || productNode.key}.`,
    });
    evidenceById.set(evidence.evidenceId, evidence);
    const productEndpoint = endpointFor(productNode, productRevision, { name: productRevision.semantic.name || "" });
    const sourceEndpoint = endpointFor(sourceNode, sourceRevision);
    const from = relationshipType === "IMPLEMENTS" ? sourceEndpoint : productEndpoint;
    const to = relationshipType === "IMPLEMENTS" ? productEndpoint : sourceEndpoint;
    candidates.push(candidateArtifact({
      relationshipType,
      from,
      to,
      evidenceIds: [evidence.evidenceId],
      explanation: relationshipType === "IMPLEMENTS"
        ? "Lexical repository evidence can propose an implementation relationship, but only explicit review may promote it."
        : "Lexical test evidence can propose verification coverage, but only explicit review may promote it.",
      confidence,
      sourceSnapshotId: graph.sourceSnapshotId,
      origin: relationshipType === "IMPLEMENTS" ? "repository-product-term-overlap" : "repository-test-product-term-overlap",
    }));
  };

  for (const productNode of productNodes.sort((left, right) => left.nodeId.localeCompare(right.nodeId))) {
    const productRevision = currentRevisionByLogical.get(productNode.nodeId);
    if (!productRevision?.semantic) continue;
    const productTerms = terms(productNode.key, productRevision.semantic.name, productRevision.semantic.description);
    const implementationMatches = [];
    for (const sourceNode of implementationNodes) {
      const sourceRevision = currentRevisionByLogical.get(sourceNode.nodeId);
      if (!sourceRevision) continue;
      const overlapTerms = intersection(productTerms, terms(sourceNode.path, sourceNode.name, sourceNode.symbolKind));
      if (!overlapTerms.length) continue;
      const base = sourceNode.kind === "Symbol" ? 0.5 : 0.35;
      implementationMatches.push({ sourceNode, sourceRevision, overlapTerms, confidence: Math.min(0.95, base + overlapTerms.length * 0.08) });
    }
    implementationMatches.sort((left, right) => right.confidence - left.confidence || left.sourceNode.nodeId.localeCompare(right.sourceNode.nodeId));
    for (const match of implementationMatches.slice(0, 8)) addCandidate({ productNode, productRevision, relationshipType: "IMPLEMENTS", ...match });

    const testMatches = [];
    for (const sourceNode of testNodes) {
      const sourceRevision = currentRevisionByLogical.get(sourceNode.nodeId);
      if (!sourceRevision) continue;
      const overlapTerms = intersection(productTerms, terms(sourceNode.path));
      if (!overlapTerms.length) continue;
      testMatches.push({ sourceNode, sourceRevision, overlapTerms, confidence: Math.min(0.95, 0.5 + overlapTerms.length * 0.08) });
    }
    testMatches.sort((left, right) => right.confidence - left.confidence || left.sourceNode.nodeId.localeCompare(right.sourceNode.nodeId));
    for (const match of testMatches.slice(0, 5)) addCandidate({ productNode, productRevision, relationshipType: "VERIFIED_BY", ...match });

    if (!implementationMatches.length && !testMatches.length) {
      unknowns.push(unknownArtifact(graph.sourceSnapshotId, `unmapped:${productNode.nodeId}`,
        `No bounded lexical evidence currently proposes an implementation or verification mapping for ${productNode.kind} ${productRevision.semantic.name || productNode.key}.`));
    }
  }

  const deduplicated = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  return { candidates: [...deduplicated.values()], evidence: [...evidenceById.values()], unknowns };
}

function buildReviewDecision({ candidateSet, disposition, acceptedCandidateIds, rejectedCandidateIds, rationale }) {
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    kind: "ReviewDecision",
    protocol: { name: "head-agent-core-feature-mapping-review", version: FEATURE_MAPPING_VERSION },
    decisionScope: "feature-implementation-mapping",
    projectId: candidateSet.projectId,
    sessionId: candidateSet.sessionId,
    candidateSetId: candidateSet.candidateSetId,
    disposition,
    acceptedCandidateIds: [...acceptedCandidateIds].sort(),
    rejectedCandidateIds: [...rejectedCandidateIds].sort(),
    rationale: requiredText(rationale, "Review rationale"),
    sourceSnapshotId: candidateSet.sourceSnapshotId,
    productModelId: candidateSet.productModelId,
    productModelHash: candidateSet.productModelHash,
    authority: "explicit-user-feature-mapping-review",
    instructionAuthority: true,
    promotionAuthority: disposition.startsWith("accept"),
    lineage: [
      { relation: "reviews-candidate-set", targetId: candidateSet.candidateSetId },
      ...acceptedCandidateIds.map((candidateId) => ({ relation: "promotes-candidate-to-separate-reviewed-relationship", targetId: candidateId })),
    ],
  };
  const hash = featureMappingDigest(featureMappingCanonicalJson(payload));
  return verifyFeatureMappingReviewDecision({
    ...payload,
    reviewDecisionId: `feature-mapping-review-decision-${hash.slice(0, 24)}`,
    reviewDecisionHash: hash,
  }, candidateSet, candidateSet.projectId);
}

async function rebuildWithProjection({ projectRoot, projectId, currentProductModelId, sourceWorld,
  additionalCandidateSets = [], additionalReviewDecisions = [] }) {
  const projection = loadFeatureMappingProjection({
    projectRoot,
    projectId,
    currentProductModelId,
    additionalCandidateSets,
    additionalReviewDecisions,
  });
  return buildWorldModel({
    root: projectRoot,
    persist: true,
    featureMappingProjectionInput: projection,
    parentSourceSnapshotIds: sourceWorld.temporalProvenanceGraph.parentSourceSnapshotIds,
    revisionParentIds: sourceWorld.temporalProvenanceGraph.revisionParentIds,
  });
}

export async function startFeatureMapping({ root = "." } = {}) {
  const inspected = readyProject(root, "feature mapping start");
  if (inspected.state.activeRunId || inspected.state.pendingReview) {
    fail("Feature mapping cannot change reviewed relationships while a Run is active or awaiting review.", "FEATURE_MAPPING_RUN_CONFLICT");
  }
  const projectRoot = inspected.project.projectRoot;
  const currentStateFile = stateFile(projectRoot);
  const previousState = fs.existsSync(currentStateFile)
    ? verifyState(readJson(currentStateFile, "Feature mapping state pointer"), { projectId: inspected.project.projectId, sessionId: inspected.state.sessionId })
    : null;
  if (previousState?.phase === "awaiting-review") {
    fail("The current Feature mapping candidate set requires review before inference can restart.", "FEATURE_MAPPING_REVIEW_REQUIRED");
  }
  const indexed = await buildWorldModel({ root: projectRoot, persist: true });
  const inferred = inferCandidates(indexed.snapshot);
  const candidateSet = candidateSetArtifact({
    project: inspected.project,
    sessionId: inspected.state.sessionId,
    worldModel: indexed.snapshot,
    candidates: inferred.candidates,
    evidence: inferred.evidence,
    unknowns: inferred.unknowns,
  });
  const projected = await rebuildWithProjection({
    projectRoot,
    projectId: inspected.project.projectId,
    currentProductModelId: indexed.snapshot.productModel.productModelId,
    sourceWorld: indexed.snapshot,
    additionalCandidateSets: [candidateSet],
  });
  persistImmutable(candidateSetFile(projectRoot, candidateSet.candidateSetId), candidateSet, "Feature mapping candidate set");
  const phase = candidateSet.candidates.length ? "awaiting-review" : "awaiting-evidence";
  const state = writeState(projectRoot, previousState, {
    projectId: inspected.project.projectId,
    sessionId: inspected.state.sessionId,
    phase,
    candidateSetId: candidateSet.candidateSetId,
    reviewDecisionId: null,
    worldModelId: projected.snapshot.worldModelId,
    graphSnapshotId: projected.snapshot.temporalProvenanceGraph.graphSnapshotId,
    sourceSnapshotId: projected.snapshot.temporalProvenanceGraph.sourceSnapshotId,
    productModelId: projected.snapshot.productModel.productModelId,
  });
  return {
    status: phase === "awaiting-review" ? "awaiting_feature_mapping_review" : "awaiting_feature_mapping_evidence",
    state,
    candidateSet,
    worldModel: {
      evidenceWorldModelId: indexed.snapshot.worldModelId,
      projectedWorldModelId: projected.snapshot.worldModelId,
      sourceSnapshotId: projected.snapshot.temporalProvenanceGraph.sourceSnapshotId,
      graphSnapshotId: projected.snapshot.temporalProvenanceGraph.graphSnapshotId,
    },
    authority: "candidates-have-no-promotion-authority",
  };
}

export function readFeatureMappingCandidateSet({ root = ".", candidateSetId } = {}) {
  const inspected = readyProject(root, "Feature mapping candidate-set inspection");
  const file = candidateSetFile(inspected.project.projectRoot, candidateSetId);
  if (!fs.existsSync(file)) fail(`Feature mapping candidate set not found: ${candidateSetId}`, "FEATURE_MAPPING_CANDIDATE_SET_NOT_FOUND");
  return { status: "verified", file, candidateSet: verifyFeatureMappingCandidateSet(readJson(file, "Feature mapping candidate set"), inspected.project.projectId) };
}

export function readFeatureMappingReviewDecision({ root = ".", reviewDecisionId } = {}) {
  const inspected = readyProject(root, "Feature mapping review inspection");
  const file = reviewDecisionFile(inspected.project.projectRoot, reviewDecisionId);
  if (!fs.existsSync(file)) fail(`Feature mapping ReviewDecision not found: ${reviewDecisionId}`, "FEATURE_MAPPING_REVIEW_NOT_FOUND");
  const review = readJson(file, "Feature mapping ReviewDecision");
  const candidateSet = readFeatureMappingCandidateSet({ root: inspected.project.projectRoot, candidateSetId: review.candidateSetId }).candidateSet;
  return { status: "verified", file, reviewDecision: verifyFeatureMappingReviewDecision(review, candidateSet, inspected.project.projectId) };
}

export async function reviewFeatureMapping({ root = ".", candidateSetId, disposition, acceptedCandidateIds = [], rationale } = {}) {
  const inspected = readyProject(root, "Feature mapping review");
  if (inspected.state.activeRunId || inspected.state.pendingReview) {
    fail("Feature mapping review cannot change reviewed relationships while a Run is active or awaiting review.", "FEATURE_MAPPING_RUN_CONFLICT");
  }
  const projectRoot = inspected.project.projectRoot;
  const pointerFile = stateFile(projectRoot);
  if (!fs.existsSync(pointerFile)) fail("Feature mapping has not started.", "FEATURE_MAPPING_NOT_STARTED");
  const state = verifyState(readJson(pointerFile, "Feature mapping state pointer"), { projectId: inspected.project.projectId, sessionId: inspected.state.sessionId });
  if (state.phase !== "awaiting-review" || state.candidateSetId !== candidateSetId) {
    fail("Feature mapping review references a stale or non-reviewable candidate set.", "STALE_FEATURE_MAPPING_CANDIDATE_SET");
  }
  const candidateSet = readFeatureMappingCandidateSet({ root: projectRoot, candidateSetId }).candidateSet;
  const currentWorld = inspectWorldModel({ root: projectRoot });
  if (currentWorld.status !== "current"
    || currentWorld.snapshot.temporalProvenanceGraph.sourceSnapshotId !== candidateSet.sourceSnapshotId
    || currentWorld.snapshot.productModel.productModelId !== candidateSet.productModelId
    || currentWorld.snapshot.productModel.productModelHash !== candidateSet.productModelHash) {
    fail("Repository evidence or Product Canon changed after mapping inference; re-index and create a new candidate set.", "FEATURE_MAPPING_SOURCE_DRIFT");
  }
  const normalizedDisposition = requiredText(disposition, "Review disposition").toLocaleLowerCase();
  if (!["accept-all", "accept-selection", "reject"].includes(normalizedDisposition)) {
    fail("Feature mapping disposition must be accept-all, accept-selection, or reject.", "INVALID_FEATURE_MAPPING_REVIEW_DISPOSITION");
  }
  if (!Array.isArray(acceptedCandidateIds) || acceptedCandidateIds.some((id) => typeof id !== "string" || !id)) {
    fail("acceptedCandidateIds must be an array of identities.", "INVALID_FEATURE_MAPPING_REVIEW_SELECTION");
  }
  const allIds = candidateSet.candidates.map((candidate) => candidate.candidateId);
  const known = new Set(allIds);
  const selectedIds = normalizedDisposition === "accept-all" ? allIds : normalizedDisposition === "reject" ? [] : [...new Set(acceptedCandidateIds)].sort();
  if (selectedIds.some((id) => !known.has(id))) fail("Feature mapping review references an unknown candidate.", "UNKNOWN_FEATURE_MAPPING_CANDIDATE");
  if (normalizedDisposition === "accept-selection" && !selectedIds.length) {
    fail("accept-selection requires at least one candidate.", "FEATURE_MAPPING_SELECTION_REQUIRED");
  }
  const selected = new Set(selectedIds);
  const rejectedIds = allIds.filter((id) => !selected.has(id));
  const review = buildReviewDecision({
    candidateSet,
    disposition: normalizedDisposition,
    acceptedCandidateIds: selectedIds,
    rejectedCandidateIds: rejectedIds,
    rationale,
  });
  const projected = await rebuildWithProjection({
    projectRoot,
    projectId: inspected.project.projectId,
    currentProductModelId: candidateSet.productModelId,
    sourceWorld: currentWorld.snapshot,
    additionalReviewDecisions: [review],
  });
  persistImmutable(reviewDecisionFile(projectRoot, review.reviewDecisionId), review, "Feature mapping ReviewDecision");
  const nextPhase = normalizedDisposition === "reject" ? "rejected" : "reviewed";
  const nextState = writeState(projectRoot, state, {
    phase: nextPhase,
    reviewDecisionId: review.reviewDecisionId,
    worldModelId: projected.snapshot.worldModelId,
    graphSnapshotId: projected.snapshot.temporalProvenanceGraph.graphSnapshotId,
    sourceSnapshotId: projected.snapshot.temporalProvenanceGraph.sourceSnapshotId,
    productModelId: projected.snapshot.productModel.productModelId,
  });
  return {
    status: nextPhase === "reviewed" ? "feature_mappings_reviewed" : "feature_mappings_rejected",
    state: nextState,
    reviewDecision: review,
    reviewedRelationshipCount: selectedIds.length,
    worldModel: {
      worldModelId: projected.snapshot.worldModelId,
      graphSnapshotId: projected.snapshot.temporalProvenanceGraph.graphSnapshotId,
      sourceSnapshotId: projected.snapshot.temporalProvenanceGraph.sourceSnapshotId,
    },
  };
}

export function inspectFeatureMapping({ root = "." } = {}) {
  const inspected = readyProject(root, "Feature mapping inspection");
  const file = stateFile(inspected.project.projectRoot);
  if (!fs.existsSync(file)) {
    return {
      status: "not_started",
      projectId: inspected.project.projectId,
      sessionId: inspected.state.sessionId,
      nextAction: "Run feature-mapping-start after Product Canon and World Model are available.",
    };
  }
  const state = verifyState(readJson(file, "Feature mapping state pointer"), { projectId: inspected.project.projectId, sessionId: inspected.state.sessionId });
  const candidateSet = state.candidateSetId
    ? readFeatureMappingCandidateSet({ root: inspected.project.projectRoot, candidateSetId: state.candidateSetId }).candidateSet
    : null;
  const reviewDecision = state.reviewDecisionId
    ? readFeatureMappingReviewDecision({ root: inspected.project.projectRoot, reviewDecisionId: state.reviewDecisionId }).reviewDecision
    : null;
  const world = inspectWorldModel({ root: inspected.project.projectRoot });
  return {
    status: state.phase.replaceAll("-", "_"),
    state,
    candidateSet,
    reviewDecision,
    worldModel: {
      status: world.status,
      worldModelId: world.snapshot.worldModelId,
      graphSnapshotId: world.snapshot.temporalProvenanceGraph.graphSnapshotId,
      sourceSnapshotId: world.snapshot.temporalProvenanceGraph.sourceSnapshotId,
      matchesMappingState: world.snapshot.worldModelId === state.worldModelId
        && world.snapshot.temporalProvenanceGraph.graphSnapshotId === state.graphSnapshotId,
    },
    authority: {
      candidates: "non-authoritative-until-explicit-review",
      reviewedRelationships: "explicit-user-reviewed-mapping-facts",
      productCanon: "unchanged-user-owned-project-canon",
      graph: "rebuildable-derived-projection",
    },
  };
}
