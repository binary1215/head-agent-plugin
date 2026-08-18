import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  ONBOARDING_CANDIDATE_DIRECTORY,
  ONBOARDING_PRODUCT_REVISION_DIRECTORY,
  ONBOARDING_REVIEW_DIRECTORY,
  onboardingCanonicalJson,
  onboardingDigest,
} from "./onboarding-contract.mjs";
import { emptyProductModelDocument, normalizeProductModelDocument, PRODUCT_ENTITY_KINDS } from "./product-model.mjs";

export const ONBOARDING_GRAPH_PROJECTION_VERSION = "0.1.0";

const ARTIFACT_LIMITS = Object.freeze({
  maxCandidateSets: 128,
  maxReviewDecisions: 128,
  maxProductModelRevisions: 128,
  maxArtifactBytes: 8 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
});
const CANDIDATE_SET_LIMITS = Object.freeze({
  maxInferredSymbols: 24,
  maxCandidates: 200,
  maxEvidenceRecords: 250,
  maxUnknowns: 100,
});
const CANDIDATE_PROTOCOL_VERSIONS = new Set(["0.1.0", "0.2.0"]);
const KIND_ORDER = new Map(PRODUCT_ENTITY_KINDS.map((kind, index) => [kind, index]));
const ARRAY_BY_KIND = Object.freeze({
  FeatureGroup: "featureGroups",
  Capability: "capabilities",
  Feature: "features",
  Requirement: "requirements",
  Constraint: "constraints",
  Decision: "decisions",
});

const fail = (message, code = "ONBOARDING_PROJECTION_ERROR") => {
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

function compareText(left, right) {
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortedUnique(values, label) {
  if (!Array.isArray(values)) fail(`${label} must be an array.`, "INVALID_ONBOARDING_PROJECTION_ARTIFACT");
  const normalized = values.map((value) => String(value || "").trim());
  if (normalized.some((value) => !value)) fail(`${label} contains an empty identity.`, "INVALID_ONBOARDING_PROJECTION_ARTIFACT");
  const sorted = [...new Set(normalized)].sort(compareText);
  if (canonicalJson(values) !== canonicalJson(sorted)) fail(`${label} must be sorted and unique.`, "INVALID_ONBOARDING_PROJECTION_ORDER");
  return sorted;
}

function verifyContentIdentity(document, { idField, hashField, prefix, label }) {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    fail(`${label} is invalid.`, "INVALID_ONBOARDING_PROJECTION_ARTIFACT");
  }
  const payload = { ...document };
  delete payload[idField];
  delete payload[hashField];
  const hash = onboardingDigest(onboardingCanonicalJson(payload));
  if (document[hashField] !== hash || document[idField] !== `${prefix}-${hash.slice(0, 24)}`) {
    fail(`${label} digest verification failed.`, "ONBOARDING_PROJECTION_DIGEST_MISMATCH");
  }
  return document;
}

function candidateModel(candidates) {
  const document = emptyProductModelDocument();
  for (const candidate of candidates) {
    if (!PRODUCT_ENTITY_KINDS.includes(candidate.productKind)) {
      fail(`Unsupported onboarding product kind: ${candidate.productKind}`, "INVALID_ONBOARDING_PROJECTION_CANDIDATE");
    }
    document[ARRAY_BY_KIND[candidate.productKind]].push(candidate.proposedEntity);
  }
  return normalizeProductModelDocument(document);
}

function verifyEvidence(evidence) {
  verifyContentIdentity(evidence, {
    idField: "evidenceId",
    hashField: "evidenceHash",
    prefix: "onboarding-evidence",
    label: "Onboarding Evidence",
  });
  if (evidence.instructionAuthority !== false || evidence.promotionAuthority !== false
    || typeof evidence.sourceKind !== "string" || !evidence.sourceKind
    || typeof evidence.sourceId !== "string" || !evidence.sourceId
    || typeof evidence.statement !== "string" || !evidence.statement) {
    fail("Onboarding Evidence fields or authority are invalid.", "INVALID_ONBOARDING_PROJECTION_EVIDENCE");
  }
  return evidence;
}

function verifyCandidate(candidate) {
  verifyContentIdentity(candidate, {
    idField: "candidateId",
    hashField: "candidateHash",
    prefix: "onboarding-candidate",
    label: "Onboarding product candidate",
  });
  if (candidate.schemaVersion !== 1 || candidate.kind !== "OnboardingProductCandidate" || !PRODUCT_ENTITY_KINDS.includes(candidate.productKind)
    || candidate.authorityClass !== "candidate" || candidate.instructionAuthority !== false || candidate.promotionAuthority !== false
    || typeof candidate.confidence !== "number" || candidate.confidence < 0 || candidate.confidence > 1
    || candidate.producer !== "head-agent-core-onboarding-inference" || candidate.producerVersion !== "0.1.0"
    || typeof candidate.explanation !== "string" || !candidate.explanation
    || !/^source-snapshot-[a-f0-9]{24}$/.test(candidate.sourceSnapshotId || "")) {
    fail("Onboarding product candidate fields or authority are invalid.", "INVALID_ONBOARDING_PROJECTION_CANDIDATE");
  }
  sortedUnique(candidate.evidenceIds, `Candidate ${candidate.candidateId} evidenceIds`);
  return candidate;
}

export function verifyOnboardingCandidateSetForProjection(document, projectId = "") {
  verifyContentIdentity(document, {
    idField: "candidateSetId",
    hashField: "candidateSetHash",
    prefix: "onboarding-candidates",
    label: "Onboarding candidate set",
  });
  const candidateProtocolVersion = document.protocol?.version;
  if (document.kind !== "OnboardingCandidateSet" || document.protocol?.name !== "head-agent-core-onboarding-candidates"
    || !CANDIDATE_PROTOCOL_VERSIONS.has(candidateProtocolVersion)
    || document.schemaVersion !== 1 || (projectId && document.projectId !== projectId)
    || !/^head-[a-f0-9]{20}$/.test(document.projectId || "")
    || !/^session-[A-Fa-f0-9-]{36}$/.test(document.sessionId || "")
    || !["existing", "new"].includes(document.inputMode)
    || !/^onboarding-storage-[a-f0-9]{24}$/.test(document.storageSelectionId || "")
    || (candidateProtocolVersion === "0.1.0" && !/^world-model-[a-f0-9]{24}$/.test(document.worldModelId || ""))
    || (candidateProtocolVersion === "0.2.0" && document.worldModelId != null)
    || !/^source-snapshot-[a-f0-9]{24}$/.test(document.sourceSnapshotId || "")
    || !/^product-model-[a-f0-9]{24}$/.test(document.productModelId || "")
    || document.authorityClass !== "candidate-set" || document.instructionAuthority !== false || document.promotionAuthority !== false) {
    fail("Onboarding candidate set fields or authority are invalid.", "INVALID_ONBOARDING_PROJECTION_CANDIDATE_SET");
  }
  if (canonicalJson(document.limits) !== canonicalJson(CANDIDATE_SET_LIMITS)) {
    fail("Onboarding candidate set limits do not match the protocol bounds.", "INVALID_ONBOARDING_PROJECTION_CANDIDATE_SET");
  }
  if (!Array.isArray(document.candidates) || !Array.isArray(document.evidence) || !Array.isArray(document.unknowns)) {
    fail("Onboarding candidate set collections are invalid.", "INVALID_ONBOARDING_PROJECTION_CANDIDATE_SET");
  }
  if (document.candidates.length > Number(document.limits?.maxCandidates)
    || document.evidence.length > Number(document.limits?.maxEvidenceRecords)
    || document.unknowns.length > Number(document.limits?.maxUnknowns)) {
    fail("Onboarding candidate set exceeds its recorded bounds.", "ONBOARDING_PROJECTION_LIMIT");
  }
  const evidenceIds = new Set();
  for (const evidence of document.evidence) {
    verifyEvidence(evidence);
    if (evidenceIds.has(evidence.evidenceId)) fail(`Duplicate onboarding Evidence: ${evidence.evidenceId}`, "DUPLICATE_ONBOARDING_PROJECTION_ARTIFACT");
    evidenceIds.add(evidence.evidenceId);
  }
  if (canonicalJson(document.evidence.map((item) => item.evidenceId)) !== canonicalJson([...evidenceIds].sort(compareText))) {
    fail("Onboarding Evidence must use deterministic ordering.", "INVALID_ONBOARDING_PROJECTION_ORDER");
  }
  if (document.briefEvidenceId != null && (!/^onboarding-brief-[a-f0-9]{24}$/.test(document.briefEvidenceId)
    || !document.evidence.some((item) => item.sourceKind === "user-owned-onboarding-brief" && item.sourceId === document.briefEvidenceId))) {
    fail("Onboarding candidate set references missing brief Evidence.", "UNKNOWN_ONBOARDING_PROJECTION_EVIDENCE");
  }
  const candidateIds = new Set();
  for (const candidate of document.candidates) {
    verifyCandidate(candidate);
    if (candidate.sourceSnapshotId !== document.sourceSnapshotId) fail("Candidate source snapshot does not match its set.", "ONBOARDING_PROJECTION_SOURCE_MISMATCH");
    if (candidateIds.has(candidate.candidateId)) fail(`Duplicate onboarding candidate: ${candidate.candidateId}`, "DUPLICATE_ONBOARDING_PROJECTION_ARTIFACT");
    candidateIds.add(candidate.candidateId);
    for (const evidenceId of candidate.evidenceIds) if (!evidenceIds.has(evidenceId)) {
      fail(`Candidate references unknown Evidence: ${evidenceId}`, "UNKNOWN_ONBOARDING_PROJECTION_EVIDENCE");
    }
  }
  const orderedCandidates = [...document.candidates].sort((left, right) => (KIND_ORDER.get(left.productKind) - KIND_ORDER.get(right.productKind))
    || compareText(left.proposedEntity?.key, right.proposedEntity?.key) || compareText(left.candidateId, right.candidateId));
  if (canonicalJson(document.candidates.map((item) => item.candidateId)) !== canonicalJson(orderedCandidates.map((item) => item.candidateId))) {
    fail("Onboarding candidates must use deterministic ordering.", "INVALID_ONBOARDING_PROJECTION_ORDER");
  }
  candidateModel(document.candidates);
  const unknownIds = new Set();
  for (const unknown of document.unknowns) {
    if (!unknown || !/^onboarding-unknown-[a-f0-9]{24}$/.test(unknown.unknownId || "")
      || typeof unknown.statement !== "string" || !unknown.statement || unknown.status !== "open") {
      fail("Onboarding Unknown is invalid.", "INVALID_ONBOARDING_PROJECTION_UNKNOWN");
    }
    sortedUnique(unknown.evidenceIds || [], `Unknown ${unknown.unknownId} evidenceIds`);
    for (const evidenceId of unknown.evidenceIds || []) if (!evidenceIds.has(evidenceId)) {
      fail(`Unknown references missing Evidence: ${evidenceId}`, "UNKNOWN_ONBOARDING_PROJECTION_EVIDENCE");
    }
    if (unknownIds.has(unknown.unknownId)) fail(`Duplicate onboarding Unknown: ${unknown.unknownId}`, "DUPLICATE_ONBOARDING_PROJECTION_ARTIFACT");
    unknownIds.add(unknown.unknownId);
  }
  if (canonicalJson(document.unknowns.map((item) => item.unknownId)) !== canonicalJson([...unknownIds].sort(compareText))) {
    fail("Onboarding Unknowns must use deterministic ordering.", "INVALID_ONBOARDING_PROJECTION_ORDER");
  }
  for (const parentId of sortedUnique(document.parentCandidateSetIds || [], "parentCandidateSetIds")) {
    if (!/^onboarding-candidates-[a-f0-9]{24}$/.test(parentId)) fail("Candidate-set parent identity is invalid.", "INVALID_ONBOARDING_PROJECTION_PARENT");
  }
  if (document.reviewDecisionId != null && !/^onboarding-review-decision-[a-f0-9]{24}$/.test(document.reviewDecisionId)) {
    fail("Candidate-set review identity is invalid.", "INVALID_ONBOARDING_PROJECTION_REVIEW");
  }
  return document;
}

export function verifyOnboardingReviewDecisionForProjection(document, candidateSet, projectId = "") {
  verifyContentIdentity(document, {
    idField: "reviewDecisionId",
    hashField: "reviewDecisionHash",
    prefix: "onboarding-review-decision",
    label: "Onboarding ReviewDecision",
  });
  const dispositions = new Set(["accept-all", "accept-selection", "revise", "reject"]);
  if (document.kind !== "ReviewDecision" || document.protocol?.name !== "head-agent-core-onboarding-review"
    || document.protocol?.version !== "0.1.0" || document.schemaVersion !== 1
    || document.decisionScope !== "product-canon-bootstrap" || !dispositions.has(document.disposition)
    || (projectId && document.projectId !== projectId) || document.projectId !== candidateSet.projectId
    || document.sessionId !== candidateSet.sessionId || document.candidateSetId !== candidateSet.candidateSetId
    || !/^head-[a-f0-9]{20}$/.test(document.projectId || "") || !/^session-[A-Fa-f0-9-]{36}$/.test(document.sessionId || "")
    || !Array.isArray(document.userEdits) || !Array.isArray(document.addedEntities) || !Array.isArray(document.lineage)
    || typeof document.rationale !== "string" || !document.rationale
    || document.authority !== "explicit-user-onboarding-review" || document.instructionAuthority !== true) {
    fail("Onboarding ReviewDecision fields or authority are invalid.", "INVALID_ONBOARDING_PROJECTION_REVIEW");
  }
  const accepted = sortedUnique(document.acceptedCandidateIds, `Review ${document.reviewDecisionId} acceptedCandidateIds`);
  const rejected = sortedUnique(document.rejectedCandidateIds, `Review ${document.reviewDecisionId} rejectedCandidateIds`);
  const known = new Set(candidateSet.candidates.map((candidate) => candidate.candidateId));
  if ([...accepted, ...rejected].some((candidateId) => !known.has(candidateId)) || accepted.some((candidateId) => rejected.includes(candidateId))) {
    fail("Onboarding ReviewDecision candidate references are invalid.", "INVALID_ONBOARDING_PROJECTION_REVIEW");
  }
  const accepting = document.disposition.startsWith("accept");
  if (document.promotionAuthority !== accepting
    || (accepting && (!/^product-model-[a-f0-9]{24}$/.test(document.resultingProductModelId || "") || !/^[a-f0-9]{64}$/.test(document.resultingProductModelHash || "")))
    || (!accepting && (document.resultingProductModelId != null || document.resultingProductModelHash != null))
    || !/^product-model-[a-f0-9]{24}$/.test(document.previousProductModelId || "")
    || !/^[a-f0-9]{64}$/.test(document.previousProductModelHash || "")) {
    fail("Onboarding ReviewDecision promotion fields are invalid.", "INVALID_ONBOARDING_PROJECTION_REVIEW");
  }
  if (document.disposition === "reject" && (accepted.length || rejected.length !== known.size)) {
    fail("Rejected onboarding review must reject the complete candidate set.", "INVALID_ONBOARDING_PROJECTION_REVIEW");
  }
  if (accepting && accepted.length + rejected.length !== known.size) {
    fail("Accepting onboarding review must disposition the complete candidate set.", "INVALID_ONBOARDING_PROJECTION_REVIEW");
  }
  if (document.disposition === "revise" && accepted.length) {
    fail("Revision review cannot accept candidates into Product Canon.", "INVALID_ONBOARDING_PROJECTION_REVIEW");
  }
  return document;
}

export function verifyProductModelRevisionForProjection(document) {
  if (!document || document.schemaVersion !== 1 || document.kind !== "ProductModelRevision" || document.authority !== "user-owned-project-canon-revision") {
    fail("Product Model revision is invalid.", "INVALID_ONBOARDING_PRODUCT_REVISION");
  }
  const model = normalizeProductModelDocument(document.document);
  if (document.productModelId !== model.productModelId || document.productModelHash !== model.productModelHash) {
    fail("Product Model revision digest verification failed.", "ONBOARDING_PRODUCT_REVISION_DIGEST_MISMATCH");
  }
  return document;
}

function safeDirectory(projectRoot, relativeDirectory) {
  const root = path.resolve(projectRoot);
  const directory = path.resolve(root, ...relativeDirectory.split("/"));
  const relative = path.relative(root, directory);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail(`Onboarding projection directory escapes the project root: ${relativeDirectory}`, "ONBOARDING_PROJECTION_PATH_ESCAPE");
  }
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      fail(`Onboarding projection directory traverses a symlink: ${relativeDirectory}`, "ONBOARDING_PROJECTION_SYMLINK");
    }
  }
  return directory;
}

function readArtifactDirectory(projectRoot, relativeDirectory, { idPattern, idField, limit, label }) {
  const directory = safeDirectory(projectRoot, relativeDirectory);
  if (!fs.existsSync(directory)) return { documents: [], totalBytes: 0 };
  if (!fs.statSync(directory).isDirectory()) fail(`${label} path is not a directory.`, "INVALID_ONBOARDING_PROJECTION_PATH");
  const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => compareText(left.name, right.name));
  const jsonEntries = entries.filter((entry) => entry.name.endsWith(".json"));
  if (jsonEntries.length > limit) fail(`${label} exceeds its artifact-count bound.`, "ONBOARDING_PROJECTION_LIMIT");
  const documents = [];
  let totalBytes = 0;
  for (const entry of jsonEntries) {
    if (entry.isSymbolicLink() || !entry.isFile()) fail(`${label} contains a non-file artifact.`, "ONBOARDING_PROJECTION_SYMLINK");
    const id = entry.name.slice(0, -5);
    if (!idPattern.test(id)) fail(`${label} filename is invalid: ${entry.name}`, "INVALID_ONBOARDING_PROJECTION_PATH");
    const file = path.join(directory, entry.name);
    const size = fs.statSync(file).size;
    if (size > ARTIFACT_LIMITS.maxArtifactBytes) fail(`${label} artifact exceeds the byte bound: ${entry.name}`, "ONBOARDING_PROJECTION_LIMIT");
    totalBytes += size;
    if (totalBytes > ARTIFACT_LIMITS.maxTotalBytes) fail(`${label} exceeds the total byte bound.`, "ONBOARDING_PROJECTION_LIMIT");
    let document;
    try { document = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (error) { fail(`${label} is invalid JSON: ${entry.name}: ${error.message}`, "INVALID_ONBOARDING_PROJECTION_JSON"); }
    if (document[idField] !== id) fail(`${label} filename does not match its identity: ${entry.name}`, "ONBOARDING_PROJECTION_IDENTITY_MISMATCH");
    documents.push(document);
  }
  return { documents, totalBytes };
}

function mergeArtifacts(stored, additions, idField, label) {
  const byId = new Map();
  for (const document of [...stored, ...(additions || [])]) {
    const id = document?.[idField];
    if (typeof id !== "string" || !id) fail(`${label} addition has no identity.`, "INVALID_ONBOARDING_PROJECTION_ARTIFACT");
    const existing = byId.get(id);
    if (existing && canonicalJson(existing) !== canonicalJson(document)) fail(`${label} identity collision: ${id}`, "ONBOARDING_PROJECTION_IDENTITY_COLLISION");
    byId.set(id, document);
  }
  return [...byId.values()].sort((left, right) => compareText(left[idField], right[idField]));
}

export function loadOnboardingGraphProjection({
  projectRoot,
  projectId,
  currentProductModelId,
  additionalCandidateSets = [],
  additionalReviewDecisions = [],
  additionalProductModelRevisions = [],
} = {}) {
  if (typeof projectRoot !== "string" || !projectRoot || !/^head-[a-f0-9]{20}$/.test(projectId || "")
    || !/^product-model-[a-f0-9]{24}$/.test(currentProductModelId || "")) {
    fail("Onboarding graph projection scope is invalid.", "INVALID_ONBOARDING_PROJECTION_SCOPE");
  }
  const candidateFiles = readArtifactDirectory(projectRoot, ONBOARDING_CANDIDATE_DIRECTORY, {
    idPattern: /^onboarding-candidates-[a-f0-9]{24}$/,
    idField: "candidateSetId",
    limit: ARTIFACT_LIMITS.maxCandidateSets,
    label: "Onboarding candidate-set directory",
  });
  const reviewFiles = readArtifactDirectory(projectRoot, ONBOARDING_REVIEW_DIRECTORY, {
    idPattern: /^onboarding-review-decision-[a-f0-9]{24}$/,
    idField: "reviewDecisionId",
    limit: ARTIFACT_LIMITS.maxReviewDecisions,
    label: "Onboarding review directory",
  });
  const revisionFiles = readArtifactDirectory(projectRoot, ONBOARDING_PRODUCT_REVISION_DIRECTORY, {
    idPattern: /^product-model-[a-f0-9]{24}$/,
    idField: "productModelId",
    limit: ARTIFACT_LIMITS.maxProductModelRevisions,
    label: "Product Model revision directory",
  });
  const totalBytes = candidateFiles.totalBytes + reviewFiles.totalBytes + revisionFiles.totalBytes;
  if (totalBytes > ARTIFACT_LIMITS.maxTotalBytes) fail("Onboarding projection exceeds the total byte bound.", "ONBOARDING_PROJECTION_LIMIT");
  const candidateSets = mergeArtifacts(candidateFiles.documents, additionalCandidateSets, "candidateSetId", "Onboarding candidate set");
  const reviewDecisions = mergeArtifacts(reviewFiles.documents, additionalReviewDecisions, "reviewDecisionId", "Onboarding ReviewDecision");
  const productModelRevisions = mergeArtifacts(revisionFiles.documents, additionalProductModelRevisions, "productModelId", "Product Model revision");
  if (candidateSets.length > ARTIFACT_LIMITS.maxCandidateSets || reviewDecisions.length > ARTIFACT_LIMITS.maxReviewDecisions
    || productModelRevisions.length > ARTIFACT_LIMITS.maxProductModelRevisions) {
    fail("Onboarding projection additions exceed artifact-count bounds.", "ONBOARDING_PROJECTION_LIMIT");
  }
  const candidateById = new Map();
  for (const candidateSet of candidateSets) {
    verifyOnboardingCandidateSetForProjection(candidateSet, projectId);
    candidateById.set(candidateSet.candidateSetId, candidateSet);
  }
  for (const review of reviewDecisions) {
    const candidateSet = candidateById.get(review.candidateSetId);
    if (!candidateSet) fail(`Review references a missing candidate set: ${review.candidateSetId}`, "ONBOARDING_PROJECTION_DANGLING_REVIEW");
    verifyOnboardingReviewDecisionForProjection(review, candidateSet, projectId);
  }
  const revisionById = new Map();
  for (const revision of productModelRevisions) {
    verifyProductModelRevisionForProjection(revision);
    revisionById.set(revision.productModelId, revision);
  }
  for (const candidateSet of candidateSets) {
    for (const parentId of candidateSet.parentCandidateSetIds) if (!candidateById.has(parentId)) {
      fail(`Candidate set references a missing parent: ${parentId}`, "ONBOARDING_PROJECTION_DANGLING_PARENT");
    }
    if (candidateSet.reviewDecisionId) {
      const review = reviewDecisions.find((item) => item.reviewDecisionId === candidateSet.reviewDecisionId);
      if (!review || review.disposition !== "revise" || !candidateSet.parentCandidateSetIds.includes(review.candidateSetId)) {
        fail(`Successor candidate set has an invalid revision ReviewDecision: ${candidateSet.candidateSetId}`, "ONBOARDING_PROJECTION_REVIEW_CONFLICT");
      }
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const visitCandidateSet = (candidateSetId) => {
    if (visited.has(candidateSetId)) return;
    if (visiting.has(candidateSetId)) fail(`Candidate-set ancestry contains a cycle: ${candidateSetId}`, "ONBOARDING_PROJECTION_PARENT_CYCLE");
    visiting.add(candidateSetId);
    for (const parentId of candidateById.get(candidateSetId).parentCandidateSetIds) visitCandidateSet(parentId);
    visiting.delete(candidateSetId);
    visited.add(candidateSetId);
  };
  for (const candidateSet of candidateSets) visitCandidateSet(candidateSet.candidateSetId);
  for (const review of reviewDecisions.filter((item) => item.promotionAuthority)) {
    const previous = revisionById.get(review.previousProductModelId);
    const resulting = revisionById.get(review.resultingProductModelId);
    if (!previous || !resulting || previous.productModelHash !== review.previousProductModelHash
      || resulting.productModelHash !== review.resultingProductModelHash) {
      fail(`Accepted ReviewDecision has incomplete Product Model revision evidence: ${review.reviewDecisionId}`, "ONBOARDING_PROJECTION_PRODUCT_REVISION_MISSING");
    }
  }
  const payload = {
    kind: "OnboardingGraphProjectionInput",
    protocol: { name: "head-agent-core-onboarding-graph-projection", version: ONBOARDING_GRAPH_PROJECTION_VERSION },
    projectId,
    currentProductModelId,
    candidateSets,
    reviewDecisions,
    productModelRevisions,
    limits: ARTIFACT_LIMITS,
    authority: "mixed-source-derived-projection-input",
    instructionAuthority: false,
    promotionAuthority: false,
  };
  const projectionInputHash = digest(canonicalJson(payload));
  return {
    ...payload,
    projectionInputId: `onboarding-graph-input-${projectionInputHash.slice(0, 24)}`,
    projectionInputHash,
  };
}

export function verifyOnboardingGraphProjectionInput(document) {
  if (!document || document.kind !== "OnboardingGraphProjectionInput"
    || document.protocol?.name !== "head-agent-core-onboarding-graph-projection"
    || document.protocol.version !== ONBOARDING_GRAPH_PROJECTION_VERSION
    || document.authority !== "mixed-source-derived-projection-input"
    || document.instructionAuthority !== false || document.promotionAuthority !== false) {
    fail("Onboarding graph projection input is invalid.", "INVALID_ONBOARDING_GRAPH_PROJECTION_INPUT");
  }
  const payload = { ...document };
  delete payload.projectionInputId;
  delete payload.projectionInputHash;
  const hash = digest(canonicalJson(payload));
  if (document.projectionInputHash !== hash || document.projectionInputId !== `onboarding-graph-input-${hash.slice(0, 24)}`) {
    fail("Onboarding graph projection input digest verification failed.", "ONBOARDING_GRAPH_PROJECTION_DIGEST_MISMATCH");
  }
  return document;
}
