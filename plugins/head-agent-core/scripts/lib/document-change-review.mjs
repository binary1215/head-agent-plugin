import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { inspectProject, SCHEMA_VERSION } from "./head-core.mjs";
import {
  createDocumentProjectionAdapter,
  materializeMarkdownProjection,
  materializeReviewedMarkdownProjection,
  readDocumentChangeCandidateSet,
  verifyDocumentChangeCandidateSet,
  verifyDocumentChangeCandidateSetAgainstPublished,
} from "./document-projection-adapter.mjs";
import { createGraphProjectionAdapter } from "./graph-projection-adapter.mjs";
import {
  normalizeProductModelDocument,
  PRODUCT_MODEL_RELATIVE_PATH,
  readProductModelCanon,
} from "./product-model.mjs";
import { withRefreshWriterLease } from "./refresh-writer-lease.mjs";
import {
  buildWorldModel,
  deriveIncrementalRevisionParents,
  findWorldModelSnapshot,
  inspectWorldModel,
} from "./world-model.mjs";
import { createWorldModelStoreAdapter } from "./world-model-store.mjs";
import {
  artifactAuthorityBoundary,
  assertNoAuthorityAmplification,
  assertReceiptProjectedOnlyInChild,
  verifyArtifactAuthorityBoundary,
} from "./authority-plane-contract.mjs";

export const DOCUMENT_CHANGE_REVIEW_VERSION = "0.1.0";
export const DOCUMENT_CHANGE_REVIEW_DIRECTORY = ".head/document-changes/review-decisions";
export const DOCUMENT_CHANGE_PRODUCT_REVISION_DIRECTORY = ".head/document-changes/product-model-revisions";
export const DOCUMENT_CHANGE_APPLICATION_DIRECTORY = ".head/document-changes/applications";

const MAX_ARTIFACTS = 128;
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
const REVIEW_ID_PATTERN = /^document-change-review-decision-[a-f0-9]{24}$/;
const APPLICATION_ID_PATTERN = /^document-change-application-[a-f0-9]{24}$/;
const PRODUCT_MODEL_ID_PATTERN = /^product-model-[a-f0-9]{24}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

const fail = (message, code = "DOCUMENT_CHANGE_REVIEW_ERROR") => {
  const error = new Error(message);
  error.code = code;
  throw error;
};

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function documentChangeReviewCanonicalJson(value) {
  return JSON.stringify(canonical(value));
}

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) fail(`${label} is required.`, "INVALID_DOCUMENT_CHANGE_REVIEW");
  return value.trim();
}

function sortedUnique(values, label) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !value)) {
    fail(`${label} must be an array of non-empty strings.`, "INVALID_DOCUMENT_CHANGE_REVIEW");
  }
  const normalized = [...new Set(values)].sort();
  if (documentChangeReviewCanonicalJson(normalized) !== documentChangeReviewCanonicalJson(values)) {
    fail(`${label} must be sorted and unique.`, "DOCUMENT_CHANGE_REVIEW_ORDER_MISMATCH");
  }
  return normalized;
}

function modelDocument(model) {
  return {
    schemaVersion: 1,
    featureGroups: model.featureGroups,
    capabilities: model.capabilities,
    features: model.features,
    requirements: model.requirements,
    constraints: model.constraints,
    decisions: model.decisions,
  };
}

function readyProject(root, action) {
  const inspected = inspectProject(root);
  if (inspected.status !== "ready") fail(`Project must be ready for ${action}.`, "PROJECT_NOT_READY");
  return inspected;
}

function assertAuthorityMutable(inspected) {
  if (inspected.state.activeRunId || inspected.state.pendingReview) {
    fail("Document-change review cannot change product authority while a Run is active or awaiting review.", "DOCUMENT_CHANGE_RUN_CONFLICT");
  }
}

function safeFile(projectRoot, relativeDirectory, id, pattern, code) {
  if (!pattern.test(id || "")) fail("Document-change artifact id is invalid.", code);
  const root = path.resolve(projectRoot);
  const file = path.resolve(root, ...relativeDirectory.split("/"), `${id}.json`);
  const relative = path.relative(root, file);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail("Document-change artifact path escapes the project root.", "DOCUMENT_CHANGE_PATH_ESCAPE");
  }
  let current = root;
  for (const segment of path.dirname(relative).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      fail("Document-change artifact path traverses a symlink.", "DOCUMENT_CHANGE_SYMLINK_PATH");
    }
  }
  return file;
}

function reviewFile(projectRoot, id) {
  return safeFile(projectRoot, DOCUMENT_CHANGE_REVIEW_DIRECTORY, id, REVIEW_ID_PATTERN, "INVALID_DOCUMENT_CHANGE_REVIEW_ID");
}

function applicationFile(projectRoot, id) {
  return safeFile(projectRoot, DOCUMENT_CHANGE_APPLICATION_DIRECTORY, id, APPLICATION_ID_PATTERN, "INVALID_DOCUMENT_CHANGE_APPLICATION_ID");
}

function revisionFile(projectRoot, id) {
  return safeFile(projectRoot, DOCUMENT_CHANGE_PRODUCT_REVISION_DIRECTORY, id, PRODUCT_MODEL_ID_PATTERN, "INVALID_PRODUCT_MODEL_REVISION");
}

function parseJson(file, label) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { fail(`${label} is invalid JSON: ${error.message}`, "INVALID_DOCUMENT_CHANGE_ARTIFACT_JSON"); }
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, content, { encoding: "utf8", flag: "wx" });
  try { fs.renameSync(temporary, file); }
  catch (error) {
    try { fs.unlinkSync(temporary); } catch { /* best effort */ }
    throw error;
  }
}

function persistImmutable(file, document, verifier, label) {
  if (fs.existsSync(file)) {
    const existing = verifier(parseJson(file, label));
    if (documentChangeReviewCanonicalJson(existing) !== documentChangeReviewCanonicalJson(document)) {
      fail(`${label} conflicts with an existing immutable identity.`, "DOCUMENT_CHANGE_IMMUTABLE_COLLISION");
    }
    return { file, created: false, document: existing };
  }
  atomicWrite(file, json(document));
  return { file, created: true, document: verifier(parseJson(file, label)) };
}

function buildProductModelRevision({ projectId, model }) {
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    kind: "ProductModelRevision",
    protocol: { name: "head-agent-core-document-change-product-revision", version: DOCUMENT_CHANGE_REVIEW_VERSION },
    projectId,
    authorityBoundary: artifactAuthorityBoundary("ProductModelRevision"),
    productModelId: model.productModelId,
    productModelHash: model.productModelHash,
    document: modelDocument(model),
    authority: "explicit-user-reviewed-product-canon-revision",
    instructionAuthority: true,
    promotionAuthority: true,
  };
  return { ...payload, revisionHash: digest(documentChangeReviewCanonicalJson(payload)) };
}

export function verifyDocumentChangeProductModelRevision(document, projectId = "") {
  if (!document || document.schemaVersion !== 1 || document.kind !== "ProductModelRevision"
    || document.protocol?.name !== "head-agent-core-document-change-product-revision"
    || document.protocol?.version !== DOCUMENT_CHANGE_REVIEW_VERSION
    || (projectId && document.projectId !== projectId)
    || !PRODUCT_MODEL_ID_PATTERN.test(document.productModelId || "")
    || !HASH_PATTERN.test(document.productModelHash || "")
    || !HASH_PATTERN.test(document.revisionHash || "")
    || document.authority !== "explicit-user-reviewed-product-canon-revision"
    || document.instructionAuthority !== true || document.promotionAuthority !== true) {
    fail("Document-change ProductModelRevision is invalid.", "INVALID_DOCUMENT_CHANGE_PRODUCT_REVISION");
  }
  if (document.authorityBoundary) verifyArtifactAuthorityBoundary("ProductModelRevision", document.authorityBoundary);
  const normalized = normalizeProductModelDocument(document.document);
  if (normalized.productModelId !== document.productModelId || normalized.productModelHash !== document.productModelHash) {
    fail("Document-change ProductModelRevision does not match its Product Model.", "DOCUMENT_CHANGE_PRODUCT_REVISION_MISMATCH");
  }
  const payload = { ...document };
  delete payload.revisionHash;
  if (document.revisionHash !== digest(documentChangeReviewCanonicalJson(payload))) {
    fail("Document-change ProductModelRevision digest verification failed.", "DOCUMENT_CHANGE_PRODUCT_REVISION_DIGEST_MISMATCH");
  }
  return document;
}

function buildReviewDecision({ candidateSet, disposition, acceptedCandidateIds, rejectedCandidateIds, rationale, candidateProductModel, reviewedProductModel, resultingProductModel }) {
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    kind: "ReviewDecision",
    protocol: { name: "head-agent-core-document-change-review", version: DOCUMENT_CHANGE_REVIEW_VERSION },
    decisionScope: "document-to-product-canon",
    projectId: candidateSet.projectId,
    authorityBoundary: artifactAuthorityBoundary("ReviewDecision"),
    candidateSetId: candidateSet.candidateSetId,
    candidateSetHash: candidateSet.candidateSetHash,
    documentProjectionId: candidateSet.documentProjectionId,
    documentProjectionHash: candidateSet.documentProjectionHash,
    candidateGraphSnapshotId: candidateSet.graphSnapshotId,
    candidateGraphSnapshotHash: candidateSet.graphSnapshotHash,
    candidateSourceSnapshotId: candidateSet.sourceSnapshotId,
    candidateProductModelId: candidateProductModel.productModelId,
    candidateProductModelHash: candidateProductModel.productModelHash,
    reviewedProductModelId: reviewedProductModel.productModelId,
    reviewedProductModelHash: reviewedProductModel.productModelHash,
    disposition,
    acceptedCandidateIds,
    rejectedCandidateIds,
    rationale: requiredText(rationale, "Review rationale"),
    resultingProductModelId: resultingProductModel?.productModelId || null,
    resultingProductModelHash: resultingProductModel?.productModelHash || null,
    authority: "explicit-user-document-change-review",
    instructionAuthority: true,
    promotionAuthority: disposition.startsWith("accept"),
    lineage: [
      { relation: "reviews-candidate-set", targetId: candidateSet.candidateSetId },
      { relation: "reviews-document-projection", targetId: candidateSet.documentProjectionId },
      { relation: "reviews-product-model", targetId: reviewedProductModel.productModelId },
      ...(resultingProductModel ? [{ relation: "authorizes-product-model", targetId: resultingProductModel.productModelId }] : []),
    ],
  };
  const hash = digest(documentChangeReviewCanonicalJson(payload));
  return { ...payload, reviewDecisionId: `document-change-review-decision-${hash.slice(0, 24)}`, reviewDecisionHash: hash };
}

export function verifyDocumentChangeReviewDecision(document, candidateSet = null, projectId = "") {
  if (!document || document.schemaVersion !== 1 || document.kind !== "ReviewDecision"
    || document.protocol?.name !== "head-agent-core-document-change-review"
    || document.protocol?.version !== DOCUMENT_CHANGE_REVIEW_VERSION
    || document.decisionScope !== "document-to-product-canon"
    || (projectId && document.projectId !== projectId)
    || !REVIEW_ID_PATTERN.test(document.reviewDecisionId || "")
    || !HASH_PATTERN.test(document.reviewDecisionHash || "")
    || !["accept-all", "accept-selection", "reject"].includes(document.disposition)
    || document.authority !== "explicit-user-document-change-review"
    || document.instructionAuthority !== true
    || document.promotionAuthority !== document.disposition.startsWith("accept")
    || typeof document.rationale !== "string" || !document.rationale
    || !PRODUCT_MODEL_ID_PATTERN.test(document.candidateProductModelId || "")
    || !HASH_PATTERN.test(document.candidateProductModelHash || "")
    || !PRODUCT_MODEL_ID_PATTERN.test(document.reviewedProductModelId || "")
    || !HASH_PATTERN.test(document.reviewedProductModelHash || "")) {
    fail("Document-change ReviewDecision is invalid.", "INVALID_DOCUMENT_CHANGE_REVIEW");
  }
  if (document.authorityBoundary) verifyArtifactAuthorityBoundary("ReviewDecision", document.authorityBoundary);
  const payload = { ...document };
  delete payload.reviewDecisionId;
  delete payload.reviewDecisionHash;
  const hash = digest(documentChangeReviewCanonicalJson(payload));
  if (document.reviewDecisionHash !== hash || document.reviewDecisionId !== `document-change-review-decision-${hash.slice(0, 24)}`) {
    fail("Document-change ReviewDecision digest verification failed.", "DOCUMENT_CHANGE_REVIEW_DIGEST_MISMATCH");
  }
  sortedUnique(document.acceptedCandidateIds, "acceptedCandidateIds");
  sortedUnique(document.rejectedCandidateIds, "rejectedCandidateIds");
  if (candidateSet) {
    verifyDocumentChangeCandidateSet(candidateSet);
    if (document.projectId !== candidateSet.projectId || document.candidateSetId !== candidateSet.candidateSetId
      || document.candidateSetHash !== candidateSet.candidateSetHash
      || document.documentProjectionId !== candidateSet.documentProjectionId
      || document.documentProjectionHash !== candidateSet.documentProjectionHash
      || document.candidateGraphSnapshotId !== candidateSet.graphSnapshotId
      || document.candidateGraphSnapshotHash !== candidateSet.graphSnapshotHash
      || document.candidateSourceSnapshotId !== candidateSet.sourceSnapshotId) {
      fail("Document-change ReviewDecision scope does not match its candidate set.", "DOCUMENT_CHANGE_REVIEW_SCOPE_MISMATCH");
    }
    const known = candidateSet.candidates.map((candidate) => candidate.candidateId).sort();
    const partition = [...document.acceptedCandidateIds, ...document.rejectedCandidateIds].sort();
    if (new Set(partition).size !== partition.length || documentChangeReviewCanonicalJson(known) !== documentChangeReviewCanonicalJson(partition)) {
      fail("Document-change ReviewDecision candidate partition is invalid.", "DOCUMENT_CHANGE_REVIEW_SELECTION_MISMATCH");
    }
  }
  const accepting = document.disposition.startsWith("accept");
  if ((accepting && (!PRODUCT_MODEL_ID_PATTERN.test(document.resultingProductModelId || "") || !HASH_PATTERN.test(document.resultingProductModelHash || "")))
    || (!accepting && (document.resultingProductModelId !== null || document.resultingProductModelHash !== null))
    || (accepting && document.acceptedCandidateIds.length < 1)
    || (!accepting && document.acceptedCandidateIds.length !== 0)) {
    fail("Document-change ReviewDecision promotion fields are invalid.", "INVALID_DOCUMENT_CHANGE_REVIEW");
  }
  return document;
}

function buildApplicationReceipt({ review, candidateSet, beforeWorld, afterWorld, projection, canonChanged }) {
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    kind: "DocumentCanonApplicationReceipt",
    protocol: { name: "head-agent-core-document-change-application", version: DOCUMENT_CHANGE_REVIEW_VERSION },
    projectId: review.projectId,
    reviewDecisionId: review.reviewDecisionId,
    reviewDecisionHash: review.reviewDecisionHash,
    candidateSetId: candidateSet.candidateSetId,
    candidateSetHash: candidateSet.candidateSetHash,
    disposition: review.disposition,
    previousProductModelId: review.reviewedProductModelId,
    previousProductModelHash: review.reviewedProductModelHash,
    resultingProductModelId: review.resultingProductModelId || review.reviewedProductModelId,
    resultingProductModelHash: review.resultingProductModelHash || review.reviewedProductModelHash,
    before: {
      worldModelId: beforeWorld.worldModelId,
      sourceSnapshotId: beforeWorld.temporalProvenanceGraph.sourceSnapshotId,
      graphSnapshotId: beforeWorld.temporalProvenanceGraph.graphSnapshotId,
      graphSnapshotHash: beforeWorld.temporalProvenanceGraph.graphSnapshotHash,
    },
    after: {
      worldModelId: afterWorld.worldModelId,
      sourceSnapshotId: afterWorld.temporalProvenanceGraph.sourceSnapshotId,
      graphSnapshotId: afterWorld.temporalProvenanceGraph.graphSnapshotId,
      graphSnapshotHash: afterWorld.temporalProvenanceGraph.graphSnapshotHash,
      documentProjectionId: projection.documentProjectionId,
      documentProjectionHash: projection.documentProjectionHash,
    },
    canonChanged,
    canonMutation: canonChanged ? "exact-user-reviewed-product-model" : "none",
    activeRunMutation: "none",
    authority: "application-evidence-not-independent-authority",
    authorityBoundary: artifactAuthorityBoundary("DocumentCanonApplicationReceipt"),
    instructionAuthority: false,
    promotionAuthority: false,
  };
  const hash = digest(documentChangeReviewCanonicalJson(payload));
  return { ...payload, applicationReceiptId: `document-change-application-${hash.slice(0, 24)}`, applicationReceiptHash: hash };
}

export function verifyDocumentChangeApplicationReceipt(document, review = null, candidateSet = null, projectId = "") {
  if (!document || document.schemaVersion !== 1 || document.kind !== "DocumentCanonApplicationReceipt"
    || document.protocol?.name !== "head-agent-core-document-change-application"
    || document.protocol?.version !== DOCUMENT_CHANGE_REVIEW_VERSION
    || (projectId && document.projectId !== projectId)
    || !APPLICATION_ID_PATTERN.test(document.applicationReceiptId || "")
    || !HASH_PATTERN.test(document.applicationReceiptHash || "")
    || typeof document.canonChanged !== "boolean"
    || document.canonMutation !== (document.canonChanged ? "exact-user-reviewed-product-model" : "none")
    || document.activeRunMutation !== "none"
    || document.authority !== "application-evidence-not-independent-authority"
    || document.instructionAuthority !== false || document.promotionAuthority !== false) {
    fail("Document-change application receipt is invalid.", "INVALID_DOCUMENT_CHANGE_APPLICATION");
  }
  if (document.authorityBoundary) verifyArtifactAuthorityBoundary("DocumentCanonApplicationReceipt", document.authorityBoundary);
  for (const identity of [document.previousProductModelId, document.resultingProductModelId]) if (!PRODUCT_MODEL_ID_PATTERN.test(identity || "")) {
    fail("Document-change application Product Model identity is invalid.", "INVALID_DOCUMENT_CHANGE_APPLICATION");
  }
  for (const hash of [document.previousProductModelHash, document.resultingProductModelHash, document.before?.graphSnapshotHash, document.after?.graphSnapshotHash, document.after?.documentProjectionHash]) if (!HASH_PATTERN.test(hash || "")) {
    fail("Document-change application digest field is invalid.", "INVALID_DOCUMENT_CHANGE_APPLICATION");
  }
  for (const id of [document.before?.worldModelId, document.after?.worldModelId]) if (!/^world-model-[a-f0-9]{24}$/.test(id || "")) fail("Document-change application World Model identity is invalid.", "INVALID_DOCUMENT_CHANGE_APPLICATION");
  for (const id of [document.before?.sourceSnapshotId, document.after?.sourceSnapshotId]) if (!/^source-snapshot-[a-f0-9]{24}$/.test(id || "")) fail("Document-change application SourceSnapshot identity is invalid.", "INVALID_DOCUMENT_CHANGE_APPLICATION");
  for (const id of [document.before?.graphSnapshotId, document.after?.graphSnapshotId]) if (!/^graph-snapshot-[a-f0-9]{24}$/.test(id || "")) fail("Document-change application GraphSnapshot identity is invalid.", "INVALID_DOCUMENT_CHANGE_APPLICATION");
  if (!/^document-projection-[a-f0-9]{24}$/.test(document.after?.documentProjectionId || "")) fail("Document-change application DocumentProjection identity is invalid.", "INVALID_DOCUMENT_CHANGE_APPLICATION");
  const payload = { ...document };
  delete payload.applicationReceiptId;
  delete payload.applicationReceiptHash;
  const hash = digest(documentChangeReviewCanonicalJson(payload));
  if (document.applicationReceiptHash !== hash || document.applicationReceiptId !== `document-change-application-${hash.slice(0, 24)}`) {
    fail("Document-change application receipt digest verification failed.", "DOCUMENT_CHANGE_APPLICATION_DIGEST_MISMATCH");
  }
  if (review && (document.reviewDecisionId !== review.reviewDecisionId || document.reviewDecisionHash !== review.reviewDecisionHash
    || document.disposition !== review.disposition || document.previousProductModelId !== review.reviewedProductModelId
    || document.resultingProductModelId !== (review.resultingProductModelId || review.reviewedProductModelId))) {
    fail("Document-change application receipt does not match its ReviewDecision.", "DOCUMENT_CHANGE_APPLICATION_REVIEW_MISMATCH");
  }
  if (candidateSet && (document.candidateSetId !== candidateSet.candidateSetId || document.candidateSetHash !== candidateSet.candidateSetHash)) {
    fail("Document-change application receipt does not match its candidate set.", "DOCUMENT_CHANGE_APPLICATION_CANDIDATE_MISMATCH");
  }
  return document;
}

function artifactFiles(projectRoot, relativeDirectory) {
  const directory = path.resolve(projectRoot, ...relativeDirectory.split("/"));
  if (!fs.existsSync(directory)) return [];
  const files = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(directory, entry.name)).sort();
  if (files.length > MAX_ARTIFACTS) fail("Document-change artifact count exceeds its bound.", "DOCUMENT_CHANGE_ARTIFACT_LIMIT");
  for (const file of files) if (fs.statSync(file).size > MAX_ARTIFACT_BYTES) fail("Document-change artifact exceeds its byte bound.", "DOCUMENT_CHANGE_ARTIFACT_LIMIT");
  return files;
}

function reviewForCandidate(projectRoot, candidateSetId) {
  let found = null;
  for (const file of artifactFiles(projectRoot, DOCUMENT_CHANGE_REVIEW_DIRECTORY)) {
    const review = verifyDocumentChangeReviewDecision(parseJson(file, "Document-change ReviewDecision"));
    if (path.basename(file) !== `${review.reviewDecisionId}.json`) fail("Document-change ReviewDecision file name does not match its identity.", "DOCUMENT_CHANGE_ARTIFACT_ID_MISMATCH");
    if (review.candidateSetId !== candidateSetId) continue;
    if (found && found.reviewDecisionId !== review.reviewDecisionId) fail("DocumentChangeCandidateSet has conflicting ReviewDecisions.", "DOCUMENT_CHANGE_REVIEW_CONFLICT");
    found = review;
  }
  return found;
}

function applicationForReview(projectRoot, reviewDecisionId) {
  let found = null;
  for (const file of artifactFiles(projectRoot, DOCUMENT_CHANGE_APPLICATION_DIRECTORY)) {
    const receipt = verifyDocumentChangeApplicationReceipt(parseJson(file, "Document-change application receipt"));
    if (path.basename(file) !== `${receipt.applicationReceiptId}.json`) fail("Document-change application file name does not match its identity.", "DOCUMENT_CHANGE_ARTIFACT_ID_MISMATCH");
    if (receipt.reviewDecisionId !== reviewDecisionId) continue;
    if (found && found.applicationReceiptId !== receipt.applicationReceiptId) fail("Document-change ReviewDecision has conflicting application receipts.", "DOCUMENT_CHANGE_APPLICATION_CONFLICT");
    found = receipt;
  }
  return found;
}

export function readDocumentChangeReviewDecision({ root = ".", reviewDecisionId } = {}) {
  const inspected = readyProject(root, "document-change review inspection");
  const file = reviewFile(inspected.project.projectRoot, reviewDecisionId);
  if (!fs.existsSync(file)) fail(`Document-change ReviewDecision is missing: ${reviewDecisionId}`, "DOCUMENT_CHANGE_REVIEW_NOT_FOUND");
  const review = verifyDocumentChangeReviewDecision(parseJson(file, "Document-change ReviewDecision"), null, inspected.project.projectId);
  if (review.reviewDecisionId !== reviewDecisionId) fail("Document-change ReviewDecision file does not contain the requested identity.", "DOCUMENT_CHANGE_ARTIFACT_ID_MISMATCH");
  const candidateSet = readDocumentChangeCandidateSet({ projectRoot: inspected.project.projectRoot, id: review.candidateSetId }).candidateSet;
  verifyDocumentChangeReviewDecision(review, candidateSet, inspected.project.projectId);
  let resultingProductModelRevision = null;
  if (review.resultingProductModelId) {
    const revision = revisionFile(inspected.project.projectRoot, review.resultingProductModelId);
    if (!fs.existsSync(revision)) fail("Reviewed ProductModelRevision is missing.", "DOCUMENT_CHANGE_PRODUCT_REVISION_NOT_FOUND");
    resultingProductModelRevision = verifyDocumentChangeProductModelRevision(parseJson(revision, "Document-change ProductModelRevision"), inspected.project.projectId);
    if (resultingProductModelRevision.productModelId !== review.resultingProductModelId
      || resultingProductModelRevision.productModelHash !== review.resultingProductModelHash) fail("ReviewDecision ProductModelRevision binding is inconsistent.", "DOCUMENT_CHANGE_PRODUCT_REVISION_MISMATCH");
  }
  return { status: "verified", file, reviewDecision: review, candidateSet, resultingProductModelRevision };
}

export function readDocumentChangeApplicationReceipt({ root = ".", applicationReceiptId } = {}) {
  const inspected = readyProject(root, "document-change application inspection");
  const file = applicationFile(inspected.project.projectRoot, applicationReceiptId);
  if (!fs.existsSync(file)) fail(`Document-change application receipt is missing: ${applicationReceiptId}`, "DOCUMENT_CHANGE_APPLICATION_NOT_FOUND");
  const receipt = verifyDocumentChangeApplicationReceipt(parseJson(file, "Document-change application receipt"), null, null, inspected.project.projectId);
  if (receipt.applicationReceiptId !== applicationReceiptId) fail("Document-change application file does not contain the requested identity.", "DOCUMENT_CHANGE_ARTIFACT_ID_MISMATCH");
  const review = readDocumentChangeReviewDecision({ root: inspected.project.projectRoot, reviewDecisionId: receipt.reviewDecisionId });
  verifyDocumentChangeApplicationReceipt(receipt, review.reviewDecision, review.candidateSet, inspected.project.projectId);
  return { status: "verified", file, applicationReceipt: receipt, reviewDecision: review.reviewDecision, candidateSet: review.candidateSet };
}

function restorePublishedDocuments(adapter, documents, pointer) {
  const after = adapter.readPublishedDocuments();
  const beforePaths = new Set(documents.map((item) => item.relativePath));
  adapter.publishDocuments(documents.map((item) => ({ relativePath: item.relativePath, content: item.content })), {
    removeRelativePaths: after.map((item) => item.relativePath).filter((relativePath) => !beforePaths.has(relativePath)),
  });
  if (pointer) adapter.writePointer(pointer);
}

async function buildDocumentAuditChild({ projectRoot, beforeWorld, storeAdapter, graphProjectionAdapter, computeAdapter, writerLease }) {
  const common = {
    root: projectRoot,
    persist: false,
    storeAdapter,
    graphProjectionAdapter,
    computeAdapter,
    parentSourceSnapshotIds: beforeWorld.temporalProvenanceGraph.parentSourceSnapshotIds,
    revisionParentIds: beforeWorld.temporalProvenanceGraph.revisionParentIds,
  };
  const sameLineagePreview = await buildWorldModel(common);
  const revisionParentIds = deriveIncrementalRevisionParents({
    previousGraph: beforeWorld.temporalProvenanceGraph,
    candidateGraph: sameLineagePreview.snapshot.temporalProvenanceGraph,
  });
  const parentSourceSnapshotIds = [beforeWorld.temporalProvenanceGraph.sourceSnapshotId];
  const preview = await buildWorldModel({ ...common, parentSourceSnapshotIds, revisionParentIds });
  return buildWorldModel({
    ...common,
    persist: true,
    parentSourceSnapshotIds,
    revisionParentIds,
    expectedWorldModelId: preview.snapshot.worldModelId,
    expectedCurrentWorldModelId: beforeWorld.worldModelId,
    writerLease,
  });
}

async function applyReviewLocked({ inspected, reviewDecisionId, storeAdapter = null, graphProjectionAdapter = null, documentProjectionAdapter = null, computeAdapter = null, writerLease }) {
  assertAuthorityMutable(inspected);
  const projectRoot = inspected.project.projectRoot;
  const reviewed = readDocumentChangeReviewDecision({ root: projectRoot, reviewDecisionId });
  const review = reviewed.reviewDecision;
  const candidateSet = reviewed.candidateSet;
  const existingApplication = applicationForReview(projectRoot, review.reviewDecisionId);
  if (existingApplication) {
    verifyDocumentChangeApplicationReceipt(existingApplication, review, candidateSet, inspected.project.projectId);
    return { status: "already-applied", applicationReceipt: existingApplication, reviewDecision: review };
  }
  verifyDocumentChangeCandidateSetAgainstPublished({ projectRoot, candidateSet, adapter: documentProjectionAdapter });
  const currentStatus = inspectWorldModel({ root: projectRoot, storeAdapter });
  const documentOnlyDriftKeys = new Set(["documentChangeProjectionChanged", "temporalProvenanceChanged"]);
  const nonDocumentDrift = Object.entries(currentStatus.changes || {}).some(([key, value]) => !documentOnlyDriftKeys.has(key)
    && (Array.isArray(value) ? value.length > 0 : value === true));
  if (currentStatus.status !== "current" && (!currentStatus.changes?.documentChangeProjectionChanged || nonDocumentDrift)) {
    fail("Repository World Model has non-document drift and must be refreshed before applying a document-change review.", "DOCUMENT_CHANGE_WORLD_MODEL_STALE");
  }
  const beforeWorld = currentStatus.snapshot;
  const currentCanon = readProductModelCanon({ projectRoot });
  if (currentCanon.model.productModelId !== review.reviewedProductModelId || currentCanon.model.productModelHash !== review.reviewedProductModelHash) {
    fail("Product Canon changed after document review; a new candidate review is required.", "DOCUMENT_CHANGE_PRODUCT_CANON_DRIFT");
  }
  const selectedStore = createWorldModelStoreAdapter({ projectRoot, adapter: storeAdapter });
  const selectedGraph = createGraphProjectionAdapter({ projectRoot, adapter: graphProjectionAdapter });
  const selectedDocuments = createDocumentProjectionAdapter({ projectRoot, adapter: documentProjectionAdapter });
  const worldPointerBefore = selectedStore.readPointer()?.document || null;
  const graphPointerBefore = selectedGraph.readPointer()?.document || null;
  const documentPointerBefore = selectedDocuments.readPointer()?.document || null;
  const publishedBefore = selectedDocuments.readPublishedDocuments();
  const canonFile = path.resolve(projectRoot, ...PRODUCT_MODEL_RELATIVE_PATH.split("/"));
  const canonExisted = fs.existsSync(canonFile);
  const canonBefore = canonExisted ? fs.readFileSync(canonFile, "utf8") : "";
  let canonWritten = false;
  let createdReceiptFile = "";
  try {
    let afterWorld = beforeWorld;
    if (review.promotionAuthority) {
      assertNoAuthorityAmplification({
        sourceKind: "CandidateSet",
        targetKind: "ProductCanon",
        reviewDecision: review,
        effect: "apply-exact-user-reviewed-product-model",
      });
      const revision = reviewed.resultingProductModelRevision;
      atomicWrite(canonFile, json(revision.document));
      canonWritten = true;
      const common = {
        root: projectRoot,
        persist: false,
        storeAdapter: selectedStore,
        graphProjectionAdapter: selectedGraph,
        computeAdapter,
        parentSourceSnapshotIds: beforeWorld.temporalProvenanceGraph.parentSourceSnapshotIds,
        revisionParentIds: beforeWorld.temporalProvenanceGraph.revisionParentIds,
      };
      const sameLineagePreview = await buildWorldModel(common);
      const revisionParentIds = deriveIncrementalRevisionParents({
        previousGraph: beforeWorld.temporalProvenanceGraph,
        candidateGraph: sameLineagePreview.snapshot.temporalProvenanceGraph,
      });
      const parentSourceSnapshotIds = [beforeWorld.temporalProvenanceGraph.sourceSnapshotId];
      const preview = await buildWorldModel({ ...common, parentSourceSnapshotIds, revisionParentIds });
      const rebuilt = await buildWorldModel({
        ...common,
        persist: true,
        parentSourceSnapshotIds,
        revisionParentIds,
        expectedWorldModelId: preview.snapshot.worldModelId,
        expectedCurrentWorldModelId: beforeWorld.worldModelId,
        writerLease,
      });
      afterWorld = rebuilt.snapshot;
      if (afterWorld.productModel.productModelId !== review.resultingProductModelId
        || afterWorld.productModel.productModelHash !== review.resultingProductModelHash
        || !afterWorld.temporalProvenanceGraph.parentSourceSnapshotIds.includes(beforeWorld.temporalProvenanceGraph.sourceSnapshotId)) {
        fail("Document review did not produce the expected Product Canon GraphSnapshot.", "DOCUMENT_CHANGE_GRAPH_VERIFICATION_FAILED");
      }
    }
    const materialized = materializeReviewedMarkdownProjection({
      projectRoot,
      graph: afterWorld.temporalProvenanceGraph,
      candidateSet,
      reviewDecision: review,
      adapter: selectedDocuments,
    });
    const receipt = verifyDocumentChangeApplicationReceipt(buildApplicationReceipt({
      review,
      candidateSet,
      beforeWorld,
      afterWorld,
      projection: materialized.projection,
      canonChanged: review.promotionAuthority,
    }), review, candidateSet, inspected.project.projectId);
    const persistedReceipt = persistImmutable(applicationFile(projectRoot, receipt.applicationReceiptId), receipt, (value) => verifyDocumentChangeApplicationReceipt(value, review, candidateSet, inspected.project.projectId), "Document-change application receipt");
    if (persistedReceipt.created) createdReceiptFile = persistedReceipt.file;
    const audit = await buildDocumentAuditChild({
      projectRoot,
      beforeWorld: afterWorld,
      storeAdapter: selectedStore,
      graphProjectionAdapter: selectedGraph,
      computeAdapter,
      writerLease,
    });
    assertReceiptProjectedOnlyInChild({
      receiptId: receipt.applicationReceiptId,
      namedGraphSnapshotId: receipt.after.graphSnapshotId,
      namedGraphReceiptIds: afterWorld.temporalProvenanceGraph.documentChangeProjection.applicationReceiptIds,
      namedSourceSnapshotId: afterWorld.temporalProvenanceGraph.sourceSnapshotId,
      childGraphSnapshotId: audit.snapshot.temporalProvenanceGraph.graphSnapshotId,
      childParentSourceSnapshotIds: audit.snapshot.temporalProvenanceGraph.parentSourceSnapshotIds,
      childGraphReceiptIds: audit.snapshot.temporalProvenanceGraph.documentChangeProjection.applicationReceiptIds,
    });
    const auditProjection = materializeMarkdownProjection({ projectRoot, graph: audit.snapshot.temporalProvenanceGraph, adapter: selectedDocuments });
    const verifiedWorld = inspectWorldModel({ root: projectRoot, storeAdapter: selectedStore });
    if (verifiedWorld.status !== "current" || verifiedWorld.snapshot.worldModelId !== audit.snapshot.worldModelId) {
      fail("Applied document review did not leave a current verified World Model.", "DOCUMENT_CHANGE_APPLICATION_WORLD_MISMATCH");
    }
    return {
      status: review.promotionAuthority ? "applied" : "rejected-and-reconciled",
      reviewDecision: review,
      applicationReceipt: persistedReceipt.document,
      worldModel: afterWorld,
      auditWorldModel: audit.snapshot,
      documentProjection: auditProjection.projection,
    };
  } catch (error) {
    if (createdReceiptFile && fs.existsSync(createdReceiptFile)) fs.unlinkSync(createdReceiptFile);
    if (canonWritten) {
      if (canonExisted) atomicWrite(canonFile, canonBefore);
      else if (fs.existsSync(canonFile)) fs.unlinkSync(canonFile);
    }
    if (worldPointerBefore) selectedStore.writePointer(worldPointerBefore);
    if (graphPointerBefore) selectedGraph.writePointer(graphPointerBefore);
    restorePublishedDocuments(selectedDocuments, publishedBefore, documentPointerBefore);
    throw error;
  }
}

export async function applyDocumentChangeReview({ root = ".", reviewDecisionId, storeAdapter = null, graphProjectionAdapter = null, documentProjectionAdapter = null, computeAdapter = null } = {}) {
  const inspected = readyProject(root, "document-change review application");
  return withRefreshWriterLease({
    projectRoot: inspected.project.projectRoot,
    projectId: inspected.project.projectId,
  }, (writerLease) => applyReviewLocked({ inspected, reviewDecisionId: requiredText(reviewDecisionId, "reviewDecisionId"), storeAdapter, graphProjectionAdapter, documentProjectionAdapter, computeAdapter, writerLease }));
}

export async function reviewDocumentChanges({
  root = ".",
  candidateSetId,
  disposition,
  acceptedCandidateIds = [],
  resultingProductModel = null,
  rationale,
  apply = true,
  storeAdapter = null,
  graphProjectionAdapter = null,
  documentProjectionAdapter = null,
  computeAdapter = null,
} = {}) {
  const inspected = readyProject(root, "document-change review");
  return withRefreshWriterLease({
    projectRoot: inspected.project.projectRoot,
    projectId: inspected.project.projectId,
  }, async (writerLease) => {
    assertAuthorityMutable(inspected);
    if (typeof apply !== "boolean") fail("apply must be a boolean.", "INVALID_DOCUMENT_CHANGE_REVIEW");
    const projectRoot = inspected.project.projectRoot;
    const candidateSet = readDocumentChangeCandidateSet({ projectRoot, id: requiredText(candidateSetId, "candidateSetId") }).candidateSet;
    verifyDocumentChangeCandidateSetAgainstPublished({ projectRoot, candidateSet, adapter: documentProjectionAdapter });
    const normalizedDisposition = requiredText(disposition, "Review disposition").toLowerCase();
    if (!["accept-all", "accept-selection", "reject"].includes(normalizedDisposition)) fail("Document-change review disposition is invalid.", "INVALID_DOCUMENT_CHANGE_REVIEW_DISPOSITION");
    const historical = findWorldModelSnapshot({ root: projectRoot, graphSnapshotId: candidateSet.graphSnapshotId, storeAdapter });
    const candidateWorld = historical.matches.find((snapshot) => snapshot.temporalProvenanceGraph.graphSnapshotHash === candidateSet.graphSnapshotHash
      && snapshot.temporalProvenanceGraph.sourceSnapshotId === candidateSet.sourceSnapshotId);
    if (!candidateWorld) fail("DocumentChangeCandidateSet base GraphSnapshot is unavailable or divergent.", "DOCUMENT_CHANGE_CANDIDATE_GRAPH_MISSING");
    const currentCanon = readProductModelCanon({ projectRoot });
    const allCandidateIds = candidateSet.candidates.map((candidate) => candidate.candidateId).sort();
    let accepted = [];
    if (normalizedDisposition === "accept-all") {
      if (acceptedCandidateIds.length) fail("accept-all cannot specify acceptedCandidateIds.", "INVALID_DOCUMENT_CHANGE_REVIEW_SELECTION");
      accepted = allCandidateIds;
    } else if (normalizedDisposition === "accept-selection") {
      accepted = [...new Set(acceptedCandidateIds)].sort();
      if (!accepted.length || accepted.length !== acceptedCandidateIds.length || accepted.some((id) => !allCandidateIds.includes(id))) {
        fail("accept-selection requires a non-empty unique subset of candidate ids.", "INVALID_DOCUMENT_CHANGE_REVIEW_SELECTION");
      }
    } else if (acceptedCandidateIds.length || resultingProductModel !== null) {
      fail("reject cannot include accepted candidates or a resulting Product Model.", "INVALID_DOCUMENT_CHANGE_REVIEW_SELECTION");
    }
    const rejected = allCandidateIds.filter((id) => !accepted.includes(id));
    let nextModel = null;
    if (normalizedDisposition.startsWith("accept")) {
      if (currentCanon.model.productModelId !== candidateWorld.productModel.productModelId
        || currentCanon.model.productModelHash !== candidateWorld.productModel.productModelHash) {
        fail("Product Canon changed after the candidate document projection; capture and review a new candidate set.", "DOCUMENT_CHANGE_PRODUCT_CANON_DRIFT");
      }
      if (!resultingProductModel) fail("Accepted document changes require an explicit complete resultingProductModel.", "DOCUMENT_CHANGE_PRODUCT_MODEL_REQUIRED");
      nextModel = normalizeProductModelDocument(resultingProductModel);
      if (nextModel.productModelId === currentCanon.model.productModelId) {
        fail("Accepted document changes must produce a different explicit Product Model; reject the candidates to discard them.", "DOCUMENT_CHANGE_CANON_CHANGE_REQUIRED");
      }
    }
    const review = verifyDocumentChangeReviewDecision(buildReviewDecision({
      candidateSet,
      disposition: normalizedDisposition,
      acceptedCandidateIds: accepted,
      rejectedCandidateIds: rejected,
      rationale,
      candidateProductModel: candidateWorld.productModel,
      reviewedProductModel: currentCanon.model,
      resultingProductModel: nextModel,
    }), candidateSet, inspected.project.projectId);
    const existing = reviewForCandidate(projectRoot, candidateSet.candidateSetId);
    if (existing && existing.reviewDecisionId !== review.reviewDecisionId) fail("DocumentChangeCandidateSet already has a different ReviewDecision.", "DOCUMENT_CHANGE_ALREADY_REVIEWED");
    let productRevision = null;
    if (nextModel) {
      productRevision = verifyDocumentChangeProductModelRevision(buildProductModelRevision({ projectId: inspected.project.projectId, model: nextModel }), inspected.project.projectId);
      persistImmutable(revisionFile(projectRoot, productRevision.productModelId), productRevision, (value) => verifyDocumentChangeProductModelRevision(value, inspected.project.projectId), "Document-change ProductModelRevision");
    }
    persistImmutable(reviewFile(projectRoot, review.reviewDecisionId), review, (value) => verifyDocumentChangeReviewDecision(value, candidateSet, inspected.project.projectId), "Document-change ReviewDecision");
    if (!apply) return { status: "reviewed-awaiting-application", reviewDecision: review, productModelRevision: productRevision };
    return applyReviewLocked({ inspected, reviewDecisionId: review.reviewDecisionId, storeAdapter, graphProjectionAdapter, documentProjectionAdapter, computeAdapter, writerLease });
  });
}

export function inspectDocumentChangeReviewStatus({ root = ".", candidateSetId } = {}) {
  const inspected = readyProject(root, "document-change review status");
  const candidateSet = readDocumentChangeCandidateSet({ projectRoot: inspected.project.projectRoot, id: requiredText(candidateSetId, "candidateSetId") }).candidateSet;
  const review = reviewForCandidate(inspected.project.projectRoot, candidateSet.candidateSetId);
  if (!review) return { status: "awaiting-review", candidateSetId: candidateSet.candidateSetId, candidateCount: candidateSet.candidates.length };
  verifyDocumentChangeReviewDecision(review, candidateSet, inspected.project.projectId);
  const application = applicationForReview(inspected.project.projectRoot, review.reviewDecisionId);
  if (application) verifyDocumentChangeApplicationReceipt(application, review, candidateSet, inspected.project.projectId);
  const canon = readProductModelCanon({ projectRoot: inspected.project.projectRoot });
  return {
    status: application ? (application.canonChanged ? "applied" : "rejected-and-reconciled") : "reviewed-awaiting-application",
    candidateSetId: candidateSet.candidateSetId,
    reviewDecisionId: review.reviewDecisionId,
    applicationReceiptId: application?.applicationReceiptId || null,
    disposition: review.disposition,
    reviewedProductModelId: review.reviewedProductModelId,
    resultingProductModelId: review.resultingProductModelId,
    currentProductModelId: canon.model.productModelId,
    authority: "status-only",
    instructionAuthority: false,
    promotionAuthority: false,
  };
}
