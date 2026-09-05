import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { inspectProject, SCHEMA_VERSION } from "./head-core.mjs";
import {
  buildOnboardingState,
  buildSessionRecord,
  buildStorageSelection,
  ONBOARDING_CANDIDATE_DIRECTORY,
  onboardingCanonicalJson,
  onboardingDigest,
  onboardingStateLatestReviewDecisionId,
  ONBOARDING_PRODUCT_REVISION_DIRECTORY,
  ONBOARDING_REVIEW_DIRECTORY,
  ONBOARDING_STATE_RELATIVE_PATH,
  ONBOARDING_STORAGE_DIRECTORY,
  SESSION_RECORD_DIRECTORY,
  verifyOnboardingState,
  verifySessionRecord,
  verifyStorageSelection,
} from "./onboarding-contract.mjs";
import {
  loadOnboardingGraphProjection,
  onboardingCandidateProducerReviewDecisionId,
  verifyOnboardingCandidateSetForProjection,
  verifyOnboardingReviewDecisionForProjection,
  verifyProductModelRevisionForProjection,
} from "./onboarding-projection.mjs";
import {
  emptyProductModelDocument,
  normalizeProductModelDocument,
  PRODUCT_ENTITY_KINDS,
  PRODUCT_MODEL_RELATIVE_PATH,
  readProductModelCanon,
} from "./product-model.mjs";
import { buildWorldModel, inspectWorldModel, readWorldModel, readWorldModelSnapshot } from "./world-model.mjs";
import { readRepositorySourceScope, writeRepositorySourceScope } from "./repository-source-scope.mjs";
import { withProjectMutation, withProjectMutationAsync } from "./project-mutation-lock.mjs";

export const ONBOARDING_CANDIDATE_VERSION = "0.4.0";
export const ONBOARDING_REVIEW_VERSION = "0.1.0";
export const ONBOARDING_INFERENCE_VERSION = "0.4.0";

const MAX_CANDIDATES = 200;
const MAX_EVIDENCE_RECORDS = 250;
const MAX_UNKNOWNS = 100;
const MAX_PROPOSAL_EVIDENCE_PER_CANDIDATE = 8;
const KIND_ORDER = new Map(PRODUCT_ENTITY_KINDS.map((kind, index) => [kind, index]));
const ARRAY_BY_KIND = Object.freeze({
  FeatureGroup: "featureGroups",
  Capability: "capabilities",
  Feature: "features",
  Requirement: "requirements",
  Constraint: "constraints",
  Decision: "decisions",
});

const fail = (message, code = "ONBOARDING_ERROR") => {
  const error = new Error(message);
  error.code = code;
  throw error;
};

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const now = () => new Date().toISOString();
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) fail(`${label} is required.`, "INVALID_ONBOARDING_INPUT");
  return value.trim();
}

function textList(value, label) {
  const source = value == null ? [] : value;
  if (!Array.isArray(source) || source.some((item) => typeof item !== "string" || !item.trim())) {
    fail(`${label} must be an array of non-empty strings.`, "INVALID_ONBOARDING_INPUT");
  }
  const normalized = source.map((item) => item.trim());
  if (new Set(normalized).size !== normalized.length) fail(`${label} contains duplicate values.`, "DUPLICATE_ONBOARDING_INPUT");
  return normalized.sort();
}

function recordList(value, label) {
  const source = value == null ? [] : value;
  if (!Array.isArray(source) || source.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    fail(`${label} must be an array of objects.`, "INVALID_ONBOARDING_INPUT");
  }
  return source;
}

function assertRecordFields(record, allowed, label) {
  const unexpected = Object.keys(record).filter((field) => !allowed.includes(field));
  if (unexpected.length) fail(`${label} contains unsupported fields: ${unexpected.sort().join(", ")}`, "UNSUPPORTED_ONBOARDING_FIELD");
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

function readJson(file, label, code = "INVALID_ONBOARDING_ARTIFACT") {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { fail(`${label} is invalid JSON: ${error.message}`, code); }
}

function readyProject(root, action = "onboarding") {
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
    fail(`Onboarding artifact path escapes the project root: ${relative}`, "ONBOARDING_PATH_ESCAPE");
  }
  let current = root;
  for (const segment of fromRoot.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      fail(`Onboarding artifact path traverses a symlink: ${relative}`, "ONBOARDING_SYMLINK_PATH");
    }
  }
  return candidate;
}

function stateFile(projectRoot) {
  return relativeFile(projectRoot, ONBOARDING_STATE_RELATIVE_PATH);
}

function sessionRecordFile(projectRoot, sessionId) {
  return relativeFile(projectRoot, `${SESSION_RECORD_DIRECTORY}/${sessionId}.json`);
}

function storageSelectionFile(projectRoot, storageSelectionId) {
  return relativeFile(projectRoot, `${ONBOARDING_STORAGE_DIRECTORY}/${storageSelectionId}.json`);
}

function candidateSetFile(projectRoot, candidateSetId) {
  if (!/^onboarding-candidates-[a-f0-9]{24}$/.test(candidateSetId || "")) {
    fail("Onboarding candidate-set id is invalid.", "INVALID_ONBOARDING_CANDIDATE_SET_ID");
  }
  return relativeFile(projectRoot, `${ONBOARDING_CANDIDATE_DIRECTORY}/${candidateSetId}.json`);
}

function reviewDecisionFile(projectRoot, reviewDecisionId) {
  if (!/^onboarding-review-decision-[a-f0-9]{24}$/.test(reviewDecisionId || "")) {
    fail("Onboarding ReviewDecision id is invalid.", "INVALID_ONBOARDING_REVIEW_ID");
  }
  return relativeFile(projectRoot, `${ONBOARDING_REVIEW_DIRECTORY}/${reviewDecisionId}.json`);
}

function persistImmutable(file, document, label) {
  if (fs.existsSync(file)) {
    const existing = readJson(file, label);
    if (onboardingCanonicalJson(existing) !== onboardingCanonicalJson(document)) {
      fail(`${label} identity collision detected.`, "ONBOARDING_IMMUTABLE_COLLISION");
    }
    return { status: "existing", file, document: existing };
  }
  atomicWrite(file, json(document));
  return { status: "recorded", file, document };
}

function productModelDocument(model) {
  return {
    schemaVersion: 1,
    featureGroups: structuredClone(model.featureGroups),
    capabilities: structuredClone(model.capabilities),
    features: structuredClone(model.features),
    requirements: structuredClone(model.requirements),
    constraints: structuredClone(model.constraints),
    decisions: structuredClone(model.decisions),
  };
}

function productModelHasEntities(model) {
  return Object.values(ARRAY_BY_KIND).some((field) => model[field].length > 0);
}

function writeState(projectRoot, previous, changes) {
  const latestReviewDecisionId = Object.hasOwn(changes, "latestReviewDecisionId")
    ? changes.latestReviewDecisionId
    : onboardingStateLatestReviewDecisionId(previous);
  const state = buildOnboardingState({
    ...previous,
    ...changes,
    latestReviewDecisionId,
    stateRevision: previous.stateRevision + 1,
    updatedAt: now(),
  });
  atomicWrite(stateFile(projectRoot), json(state));
  return state;
}

function migrationPreview(inspected) {
  const product = readProductModelCanon({ projectRoot: inspected.project.projectRoot });
  const storageSelection = buildStorageSelection({ projectId: inspected.project.projectId, selection: { mode: "local" } });
  const sessionRecord = buildSessionRecord({ project: inspected.project, sessionState: inspected.state });
  const state = buildOnboardingState({
    projectId: inspected.project.projectId,
    sessionId: inspected.state.sessionId,
    phase: "initialized",
    stateRevision: 0,
    storageSelectionId: storageSelection.storageSelectionId,
    productModelId: product.model.productModelId,
    migration: "legacy-missing-state-v1",
    updatedAt: inspected.project.createdAt || inspected.state.updatedAt,
  });
  return { product, storageSelection, sessionRecord, state };
}

function ensureOnboardingState(inspected) {
  const projectRoot = inspected.project.projectRoot;
  const file = stateFile(projectRoot);
  if (!fs.existsSync(file)) {
    const migration = migrationPreview(inspected);
    persistImmutable(
      sessionRecordFile(projectRoot, migration.sessionRecord.sessionId),
      migration.sessionRecord,
      "HEAD Session record",
    );
    persistImmutable(
      storageSelectionFile(projectRoot, migration.storageSelection.storageSelectionId),
      migration.storageSelection,
      "Onboarding storage selection",
    );
    atomicWrite(file, json(migration.state));
    return migration.state;
  }
  const state = verifyOnboardingState(readJson(file, "Onboarding state pointer"), {
    projectId: inspected.project.projectId,
    sessionId: inspected.state.sessionId,
  });
  const sessionFile = sessionRecordFile(projectRoot, state.sessionId);
  if (!fs.existsSync(sessionFile)) fail("HEAD Session record is missing.", "ONBOARDING_SESSION_RECORD_MISSING");
  verifySessionRecord(readJson(sessionFile, "HEAD Session record"), {
    projectId: inspected.project.projectId,
    sessionId: inspected.state.sessionId,
  });
  const storageFile = storageSelectionFile(projectRoot, state.storageSelectionId);
  if (!fs.existsSync(storageFile)) fail("Onboarding storage selection is missing.", "ONBOARDING_STORAGE_SELECTION_MISSING");
  verifyStorageSelection(readJson(storageFile, "Onboarding storage selection"), inspected.project.projectId);
  return state;
}

function evidenceRecord(fields) {
  const payload = {
    sourceKind: requiredText(fields.sourceKind, "Evidence sourceKind"),
    sourceId: requiredText(fields.sourceId, "Evidence sourceId"),
    path: fields.path || "",
    line: Number.isInteger(fields.line) && fields.line > 0 ? fields.line : null,
    contentDigest: fields.contentDigest || "",
    statement: requiredText(fields.statement, "Evidence statement"),
    instructionAuthority: false,
    promotionAuthority: false,
  };
  const hash = onboardingDigest(onboardingCanonicalJson(payload));
  return { ...payload, evidenceId: `onboarding-evidence-${hash.slice(0, 24)}`, evidenceHash: hash };
}

function candidateArtifact({ kind, entity, evidenceIds, explanation, confidence, sourceSnapshotId, origin }) {
  if (!PRODUCT_ENTITY_KINDS.includes(kind)) fail(`Unsupported product candidate kind: ${kind}`, "INVALID_ONBOARDING_CANDIDATE");
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    fail("Onboarding candidate confidence must be from zero through one.", "INVALID_ONBOARDING_CONFIDENCE");
  }
  const normalizedExplanation = requiredText(explanation, "Candidate explanation");
  if (normalizedExplanation.length > 2000) {
    fail("Onboarding candidate explanation must contain at most 2000 characters.", "INVALID_ONBOARDING_CANDIDATE");
  }
  const payload = {
    schemaVersion: 1,
    kind: "OnboardingProductCandidate",
    productKind: kind,
    proposedEntity: entity,
    evidenceIds: [...new Set(evidenceIds)].sort(),
    explanation: normalizedExplanation,
    confidence: Number(confidence.toFixed(6)),
    sourceSnapshotId: requiredText(sourceSnapshotId, "Candidate sourceSnapshotId"),
    origin: requiredText(origin, "Candidate origin"),
    producer: origin === "user-owned-brief-candidate"
      ? "head-agent-core-user-brief-normalizer"
      : "head-agent-core-semantic-proposal-normalizer",
    producerVersion: ONBOARDING_INFERENCE_VERSION,
    authorityClass: "candidate",
    instructionAuthority: false,
    promotionAuthority: false,
  };
  const hash = onboardingDigest(onboardingCanonicalJson(payload));
  return { ...payload, candidateId: `onboarding-candidate-${hash.slice(0, 24)}`, candidateHash: hash };
}

function candidateCompare(left, right) {
  return (KIND_ORDER.get(left.productKind) - KIND_ORDER.get(right.productKind))
    || compareText(left.proposedEntity.key, right.proposedEntity.key)
    || compareText(left.candidateId, right.candidateId);
}

function modelFromCandidateEntities(candidates) {
  const document = emptyProductModelDocument();
  for (const candidate of candidates) document[ARRAY_BY_KIND[candidate.productKind]].push(candidate.proposedEntity);
  return normalizeProductModelDocument(document);
}

function buildCandidateSet({ projectId, sessionId, inputMode, storageSelectionId, worldModel, candidates, evidence, unknowns, parentCandidateSetIds = [], producerReviewDecisionId = null, briefEvidenceId = null }) {
  if (candidates.length > MAX_CANDIDATES || evidence.length > MAX_EVIDENCE_RECORDS || unknowns.length > MAX_UNKNOWNS) {
    fail("Onboarding candidate set exceeds its deterministic size bounds.", "ONBOARDING_CANDIDATE_SET_LIMIT");
  }
  const orderedCandidates = [...candidates].sort(candidateCompare);
  modelFromCandidateEntities(orderedCandidates);
  const orderedEvidence = [...evidence].sort((left, right) => compareText(left.evidenceId, right.evidenceId));
  const knownEvidence = new Set(orderedEvidence.map((item) => item.evidenceId));
  for (const candidate of orderedCandidates) {
    for (const evidenceId of candidate.evidenceIds) if (!knownEvidence.has(evidenceId)) {
      fail(`Candidate references unknown evidence: ${evidenceId}`, "UNKNOWN_ONBOARDING_EVIDENCE");
    }
  }
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    kind: "OnboardingCandidateSet",
    protocol: { name: "head-agent-core-onboarding-candidates", version: ONBOARDING_CANDIDATE_VERSION },
    projectId,
    sessionId,
    inputMode,
    storageSelectionId,
    sourceSnapshotId: worldModel.temporalProvenanceGraph.sourceSnapshotId,
    productModelId: worldModel.productModel.productModelId,
    briefEvidenceId,
    candidates: orderedCandidates,
    evidence: orderedEvidence,
    unknowns: [...unknowns].sort((left, right) => compareText(left.unknownId, right.unknownId)),
    parentCandidateSetIds: [...new Set(parentCandidateSetIds)].sort(),
    producerReviewDecisionId,
    reviewProtocol: {
      decisionScope: "product-canon-bootstrap",
      allowedDispositions: ["accept-all", "accept-selection", "revise", "reject"],
      authorityTransition: "only-an-explicit-onboarding-review-decision-may-write-product-canon",
    },
    limits: {
      maxSemanticProposalEvidencePerCandidate: MAX_PROPOSAL_EVIDENCE_PER_CANDIDATE,
      maxCandidates: MAX_CANDIDATES,
      maxEvidenceRecords: MAX_EVIDENCE_RECORDS,
      maxUnknowns: MAX_UNKNOWNS,
    },
    authorityClass: "candidate-set",
    instructionAuthority: false,
    promotionAuthority: false,
  };
  const hash = onboardingDigest(onboardingCanonicalJson(payload));
  return { ...payload, candidateSetId: `onboarding-candidates-${hash.slice(0, 24)}`, candidateSetHash: hash };
}

function verifyCandidateSet(document, projectId = "") {
  if (!document || document.kind !== "OnboardingCandidateSet") fail("Onboarding candidate set is invalid.", "INVALID_ONBOARDING_CANDIDATE_SET");
  const payload = { ...document };
  delete payload.candidateSetId;
  delete payload.candidateSetHash;
  const hash = onboardingDigest(onboardingCanonicalJson(payload));
  if (document.candidateSetHash !== hash || document.candidateSetId !== `onboarding-candidates-${hash.slice(0, 24)}`) {
    fail("Onboarding candidate-set digest verification failed.", "ONBOARDING_CANDIDATE_SET_DIGEST_MISMATCH");
  }
  if (projectId && document.projectId !== projectId) fail("Onboarding candidate set belongs to another project.", "ONBOARDING_PROJECT_MISMATCH");
  modelFromCandidateEntities(document.candidates || []);
  const evidenceIds = new Set((document.evidence || []).map((item) => item.evidenceId));
  for (const candidate of document.candidates || []) {
    if (candidate.instructionAuthority !== false || candidate.promotionAuthority !== false || candidate.authorityClass !== "candidate") {
      fail("Onboarding candidate attempts to acquire authority.", "ONBOARDING_CANDIDATE_AUTHORITY_VIOLATION");
    }
    const candidatePayload = { ...candidate };
    delete candidatePayload.candidateId;
    delete candidatePayload.candidateHash;
    const candidateHash = onboardingDigest(onboardingCanonicalJson(candidatePayload));
    if (candidate.candidateHash !== candidateHash || candidate.candidateId !== `onboarding-candidate-${candidateHash.slice(0, 24)}`) {
      fail("Onboarding candidate digest verification failed.", "ONBOARDING_CANDIDATE_DIGEST_MISMATCH");
    }
    for (const evidenceId of candidate.evidenceIds || []) if (!evidenceIds.has(evidenceId)) {
      fail(`Candidate references unknown evidence: ${evidenceId}`, "UNKNOWN_ONBOARDING_EVIDENCE");
    }
  }
  return verifyOnboardingCandidateSetForProjection(document, projectId);
}

export function readOnboardingCandidateSet({ root = ".", candidateSetId } = {}) {
  const inspected = readyProject(root, "candidate-set inspection");
  const file = candidateSetFile(inspected.project.projectRoot, candidateSetId);
  if (!fs.existsSync(file)) fail(`Onboarding candidate set not found: ${candidateSetId}`, "ONBOARDING_CANDIDATE_SET_NOT_FOUND");
  return { status: "verified", file, candidateSet: verifyCandidateSet(readJson(file, "Onboarding candidate set"), inspected.project.projectId) };
}

function normalizedBrief(brief) {
  if (brief == null) return null;
  if (!brief || typeof brief !== "object" || Array.isArray(brief)) fail("Onboarding brief must be an object.", "INVALID_ONBOARDING_BRIEF");
  const allowed = new Set(["schemaVersion", "name", "summary", ...Object.values(ARRAY_BY_KIND)]);
  const unexpected = Object.keys(brief).filter((field) => !allowed.has(field));
  if (unexpected.length) fail(`Onboarding brief contains unsupported fields: ${unexpected.sort().join(", ")}`, "UNSUPPORTED_ONBOARDING_FIELD");
  if (brief.schemaVersion !== 1) fail("Onboarding brief schemaVersion must be 1.", "INVALID_ONBOARDING_BRIEF");
  const model = normalizeProductModelDocument({
    schemaVersion: 1,
    featureGroups: brief.featureGroups || [],
    capabilities: brief.capabilities || [],
    features: brief.features || [],
    requirements: brief.requirements || [],
    constraints: brief.constraints || [],
    decisions: brief.decisions || [],
  });
  const normalized = {
    schemaVersion: 1,
    name: typeof brief.name === "string" ? brief.name.trim() : "",
    summary: typeof brief.summary === "string" ? brief.summary.trim() : "",
    ...productModelDocument(model),
  };
  const hash = onboardingDigest(onboardingCanonicalJson(normalized));
  return { document: normalized, model, evidenceId: `onboarding-brief-${hash.slice(0, 24)}`, evidenceHash: hash };
}

function semanticProposalRequiredUnknown(sourceSnapshotId) {
  const statement = "Fresh HEAD semantic product candidates are required. Core intentionally does not infer product meaning from file names, symbols, or lexical overlap.";
  const hash = onboardingDigest(onboardingCanonicalJson({ sourceSnapshotId, kind: "semantic-product-proposal-required", statement }));
  return { unknownId: `onboarding-unknown-${hash.slice(0, 24)}`, statement, evidenceIds: [], status: "open" };
}

function normalizedProposalEvidence(value, index, { projectRoot, sourceSnapshotId, filesByPath }) {
  assertRecordFields(value, ["path", "line", "contentDigest", "symbol"], `Semantic proposal evidence ${index}`);
  const relativePath = requiredText(value.path, `Semantic proposal evidence ${index}.path`).replace(/\\/g, "/");
  if (path.posix.isAbsolute(relativePath) || relativePath.split("/").some((part) => !part || part === "." || part === "..")) {
    fail(`Semantic proposal evidence ${index}.path must be a normalized project-relative path.`, "INVALID_ONBOARDING_SEMANTIC_PROPOSAL");
  }
  const file = filesByPath.get(relativePath);
  if (!file) fail(`Semantic proposal evidence path is absent from the current World Model: ${relativePath}`, "ONBOARDING_SEMANTIC_EVIDENCE_MISSING");
  const contentDigest = value.contentDigest == null ? file.digest : requiredText(value.contentDigest, `Semantic proposal evidence ${index}.contentDigest`).toLowerCase();
  if (contentDigest !== file.digest) fail(`Semantic proposal evidence digest does not match the current World Model: ${relativePath}`, "ONBOARDING_SEMANTIC_EVIDENCE_DRIFT");
  const line = value.line;
  const source = fs.readFileSync(path.join(projectRoot, ...relativePath.split("/")), "utf8");
  const lineCount = source.split(/\r?\n/u).length;
  if (!Number.isInteger(line) || line < 1 || line > lineCount) fail(`Semantic proposal evidence line is outside the current file: ${relativePath}:${value.line}`, "INVALID_ONBOARDING_SEMANTIC_PROPOSAL");
  let symbol = null;
  if (value.symbol != null) {
    assertRecordFields(value.symbol, ["name", "kind", "line"], `Semantic proposal evidence ${index}.symbol`);
    symbol = {
      name: requiredText(value.symbol.name, `Semantic proposal evidence ${index}.symbol.name`),
      kind: requiredText(value.symbol.kind, `Semantic proposal evidence ${index}.symbol.kind`),
      line: value.symbol.line,
    };
    if (!Number.isInteger(symbol.line) || symbol.line < 1) fail(`Semantic proposal evidence ${index}.symbol.line is invalid.`, "INVALID_ONBOARDING_SEMANTIC_PROPOSAL");
    if (!(file.symbols || []).some((item) => item.name === symbol.name && item.kind === symbol.kind && item.line === symbol.line)) {
      fail(`Semantic proposal symbol is absent from the current World Model: ${relativePath}:${symbol.name}`, "ONBOARDING_SEMANTIC_EVIDENCE_MISSING");
    }
  }
  return { file, relativePath, line, symbol, sourceSnapshotId };
}

function candidatesFromSemanticProposal(proposal, worldModel, projectRoot) {
  if (proposal == null) return { candidates: [], evidence: [], unknowns: [semanticProposalRequiredUnknown(worldModel.temporalProvenanceGraph.sourceSnapshotId)] };
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) fail("Semantic product proposal must be an object.", "INVALID_ONBOARDING_SEMANTIC_PROPOSAL");
  assertRecordFields(proposal, ["schemaVersion", "sourceSnapshotId", "candidates"], "Semantic product proposal");
  if (proposal.schemaVersion !== 1) fail("Semantic product proposal schemaVersion must be 1.", "INVALID_ONBOARDING_SEMANTIC_PROPOSAL");
  const sourceSnapshotId = requiredText(proposal.sourceSnapshotId, "Semantic product proposal sourceSnapshotId");
  if (sourceSnapshotId !== worldModel.temporalProvenanceGraph.sourceSnapshotId) fail("Semantic product proposal is bound to a stale SourceSnapshot.", "ONBOARDING_SEMANTIC_PROPOSAL_DRIFT");
  const proposed = recordList(proposal.candidates, "Semantic product proposal candidates");
  if (!proposed.length) fail("Semantic product proposal must contain at least one candidate.", "INVALID_ONBOARDING_SEMANTIC_PROPOSAL");
  if (proposed.length > MAX_CANDIDATES) fail("Semantic product proposal exceeds the candidate bound.", "ONBOARDING_CANDIDATE_SET_LIMIT");
  const filesByPath = new Map(worldModel.files.map((file) => [file.path, file]));
  const evidenceById = new Map();
  const candidates = proposed.map((item, candidateIndex) => {
    assertRecordFields(item, ["productKind", "proposedEntity", "evidence", "explanation", "confidence"], `Semantic product candidate ${candidateIndex}`);
    const productKind = requiredText(item.productKind, `Semantic product candidate ${candidateIndex}.productKind`);
    const evidenceInput = recordList(item.evidence, `Semantic product candidate ${candidateIndex}.evidence`);
    if (!evidenceInput.length || evidenceInput.length > MAX_PROPOSAL_EVIDENCE_PER_CANDIDATE) {
      fail(`Semantic product candidate ${candidateIndex} must contain 1 through ${MAX_PROPOSAL_EVIDENCE_PER_CANDIDATE} evidence records.`, "INVALID_ONBOARDING_SEMANTIC_PROPOSAL");
    }
    const evidenceIds = evidenceInput.map((record, evidenceIndex) => {
      const normalized = normalizedProposalEvidence(record, evidenceIndex, { projectRoot, sourceSnapshotId, filesByPath });
      const evidence = evidenceRecord({
        sourceKind: normalized.symbol ? "head-semantic-proposal-symbol" : "head-semantic-proposal-source",
        sourceId: sourceSnapshotId,
        path: normalized.relativePath,
        line: normalized.line,
        contentDigest: normalized.file.digest,
        statement: normalized.symbol
          ? `Current ${normalized.symbol.kind} symbol ${normalized.symbol.name} is cited as evidence for proposed ${productKind}.`
          : `Current repository source ${normalized.relativePath}:${normalized.line} is cited as evidence for proposed ${productKind}.`,
      });
      evidenceById.set(evidence.evidenceId, evidence);
      return evidence.evidenceId;
    });
    return candidateArtifact({
      kind: productKind,
      entity: item.proposedEntity,
      evidenceIds,
      explanation: requiredText(item.explanation, `Semantic product candidate ${candidateIndex}.explanation`),
      confidence: item.confidence,
      sourceSnapshotId,
      origin: "fresh-head-semantic-proposal",
    });
  });
  modelFromCandidateEntities(candidates);
  return { candidates, evidence: [...evidenceById.values()], unknowns: [] };
}

function candidatesFromBrief(brief, sourceSnapshotId) {
  if (!brief) return { candidates: [], evidence: [], unknowns: [] };
  const briefEvidence = evidenceRecord({
    sourceKind: "user-owned-onboarding-brief",
    sourceId: brief.evidenceId,
    contentDigest: brief.evidenceHash,
    statement: brief.document.summary || brief.document.name || "User-provided onboarding brief",
  });
  const candidates = [];
  for (const kind of PRODUCT_ENTITY_KINDS) {
    for (const entity of brief.model[ARRAY_BY_KIND[kind]]) {
      candidates.push(candidateArtifact({
        kind,
        entity,
        evidenceIds: [briefEvidence.evidenceId],
        explanation: "The user-owned brief supplies direct product evidence, but explicit onboarding review remains the authority transition into Product Canon.",
        confidence: 1,
        sourceSnapshotId,
        origin: "user-owned-brief-candidate",
      }));
    }
  }
  return { candidates, evidence: [briefEvidence], unknowns: [] };
}

function mergeCandidateSources(semantic, fromBrief) {
  const candidates = new Map();
  for (const candidate of semantic.candidates) candidates.set(`${candidate.productKind}:${candidate.proposedEntity.key}`, candidate);
  for (const candidate of fromBrief.candidates) candidates.set(`${candidate.productKind}:${candidate.proposedEntity.key}`, candidate);
  const evidence = new Map();
  for (const record of [...semantic.evidence, ...fromBrief.evidence]) evidence.set(record.evidenceId, record);
  const usedEvidence = new Set([...candidates.values()].flatMap((candidate) => candidate.evidenceIds));
  return {
    candidates: [...candidates.values()],
    evidence: [...evidence.values()].filter((record) => usedEvidence.has(record.evidenceId)),
    unknowns: semantic.unknowns,
  };
}

function persistStorageSelection(projectRoot, selection) {
  const file = storageSelectionFile(projectRoot, selection.storageSelectionId);
  return persistImmutable(file, selection, "Onboarding storage selection");
}

async function rebuildWithOnboardingProjection({
  projectRoot,
  projectId,
  currentProductModelId,
  sourceWorld,
  additionalCandidateSets = [],
  additionalReviewDecisions = [],
  additionalProductModelRevisions = [],
  parentSourceSnapshotIds = null,
  revisionParentIds = null,
}) {
  const sourceGraph = sourceWorld.snapshot.temporalProvenanceGraph;
  const onboardingProjectionInput = loadOnboardingGraphProjection({
    projectRoot,
    projectId,
    currentProductModelId,
    additionalCandidateSets,
    additionalReviewDecisions,
    additionalProductModelRevisions,
  });
  return buildWorldModel({
    root: projectRoot,
    persist: true,
    onboardingProjectionInput,
    parentSourceSnapshotIds: parentSourceSnapshotIds ?? sourceGraph.parentSourceSnapshotIds,
    revisionParentIds: revisionParentIds ?? sourceGraph.revisionParentIds,
  });
}

export async function startOnboarding(options = {}) {
  return withProjectMutationAsync({ root: options.root ?? ".", scope: "onboarding-promotion" }, () => startOnboardingLocked(options));
}

async function startOnboardingLocked({ root = ".", mode = "existing", storage = null, brief = null, semanticProposal = null, sourceScope = null } = {}) {
  const recovered = await recoverOnboardingPromotionLocked({ root });
  if (recovered) return recovered;
  const inspected = readyProject(root, "onboarding start");
  if (inspected.state.activeRunId || inspected.state.pendingReview) {
    fail("Onboarding cannot change product authority while a Run is active or awaiting review.", "ONBOARDING_RUN_CONFLICT");
  }
  const projectRoot = inspected.project.projectRoot;
  if (brief != null && semanticProposal != null) fail("Onboarding accepts either a user-owned brief or a fresh HEAD semantic proposal, not both.", "ONBOARDING_INPUT_CONFLICT");
  const previousState = ensureOnboardingState(inspected);
  if (new Set(["awaiting-review", "revision-required"]).has(previousState.phase)) {
    fail("The current onboarding candidate set requires review before onboarding can restart.", "ONBOARDING_REVIEW_REQUIRED");
  }
  if (previousState.phase === "ready") fail("Onboarding is already ready.", "ONBOARDING_ALREADY_READY");
  const inputMode = requiredText(mode, "Onboarding mode").toLowerCase();
  if (!new Set(["existing", "new"]).has(inputMode)) fail("Onboarding mode must be existing or new.", "INVALID_ONBOARDING_MODE");
  const selectedSourceScope = sourceScope == null
    ? readRepositorySourceScope({ projectRoot })
    : writeRepositorySourceScope({ projectRoot, selection: sourceScope });
  const normalizedStorage = buildStorageSelection({ projectId: inspected.project.projectId, selection: storage || { mode: "local" } });
  persistStorageSelection(projectRoot, normalizedStorage);
  const world = await buildWorldModel({ root: projectRoot, persist: true });
  const productCanon = readProductModelCanon({ projectRoot });
  if (productModelHasEntities(productCanon.model)) {
    const state = writeState(projectRoot, previousState, {
      phase: "ready",
      storageSelectionId: normalizedStorage.storageSelectionId,
      worldModelId: world.snapshot.worldModelId,
      sourceSnapshotId: world.snapshot.temporalProvenanceGraph.sourceSnapshotId,
      candidateSetId: null,
      latestReviewDecisionId: null,
      productModelId: productCanon.model.productModelId,
      previousProductModelId: productCanon.model.productModelId,
    });
    return {
      status: "ready_existing_product_canon",
      state,
      storageSelection: normalizedStorage,
      sourceScope: selectedSourceScope.sourceScope,
      worldModel: { worldModelId: world.snapshot.worldModelId, sourceSnapshotId: world.snapshot.temporalProvenanceGraph.sourceSnapshotId },
      productModel: productCanon.model,
      disclosure: normalizedStorage.mode === "graphdb" ? "GraphDB adapter is pending; onboarding completed on the local conformance path." : "Local materialization is active.",
    };
  }
  const briefInput = normalizedBrief(brief);
  const semantic = semanticProposal == null && briefInput
    ? { candidates: [], evidence: [], unknowns: [] }
    : candidatesFromSemanticProposal(semanticProposal, world.snapshot, projectRoot);
  const briefCandidates = candidatesFromBrief(briefInput, world.snapshot.temporalProvenanceGraph.sourceSnapshotId);
  const merged = mergeCandidateSources(semantic, briefCandidates);
  const candidateSet = buildCandidateSet({
    projectId: inspected.project.projectId,
    sessionId: inspected.state.sessionId,
    inputMode,
    storageSelectionId: normalizedStorage.storageSelectionId,
    worldModel: world.snapshot,
    candidates: merged.candidates,
    evidence: merged.evidence,
    unknowns: merged.unknowns,
    parentCandidateSetIds: previousState.candidateSetId ? [previousState.candidateSetId] : [],
    briefEvidenceId: briefInput?.evidenceId || null,
  });
  const projectedWorld = await rebuildWithOnboardingProjection({
    projectRoot,
    projectId: inspected.project.projectId,
    currentProductModelId: productCanon.model.productModelId,
    sourceWorld: world,
    additionalCandidateSets: [candidateSet],
  });
  persistImmutable(candidateSetFile(projectRoot, candidateSet.candidateSetId), candidateSet, "Onboarding candidate set");
  const phase = candidateSet.candidates.length ? "awaiting-review" : "awaiting-evidence";
  const state = writeState(projectRoot, previousState, {
    phase,
    storageSelectionId: normalizedStorage.storageSelectionId,
    worldModelId: projectedWorld.snapshot.worldModelId,
    sourceSnapshotId: projectedWorld.snapshot.temporalProvenanceGraph.sourceSnapshotId,
    candidateSetId: candidateSet.candidateSetId,
    latestReviewDecisionId: null,
    productModelId: productCanon.model.productModelId,
    previousProductModelId: productCanon.model.productModelId,
  });
  return {
    status: phase === "awaiting-review" ? "awaiting_onboarding_review" : "awaiting_onboarding_evidence",
    state,
    storageSelection: normalizedStorage,
    sourceScope: selectedSourceScope.sourceScope,
    candidateSet,
    worldModel: {
      evidenceWorldModelId: world.snapshot.worldModelId,
      projectedWorldModelId: projectedWorld.snapshot.worldModelId,
      sourceSnapshotId: projectedWorld.snapshot.temporalProvenanceGraph.sourceSnapshotId,
      graphSnapshotId: projectedWorld.snapshot.temporalProvenanceGraph.graphSnapshotId,
    },
    disclosure: normalizedStorage.mode === "graphdb" ? "GraphDB adapter is pending; local materialization remains active." : "Local materialization is active.",
  };
}

export async function refreshOnboardingCandidates(options = {}) {
  return withProjectMutationAsync({ root: options.root ?? ".", scope: "onboarding-promotion" }, () => refreshOnboardingCandidatesLocked(options));
}

async function refreshOnboardingCandidatesLocked({ root = ".", semanticProposal = null } = {}) {
  const recovered = await recoverOnboardingPromotionLocked({ root });
  if (recovered) return { ...recovered, refreshed: false };
  const inspected = readyProject(root, "onboarding candidate refresh");
  if (inspected.state.activeRunId || inspected.state.pendingReview) {
    fail("Onboarding candidate refresh cannot run while a Run is active or awaiting review.", "ONBOARDING_RUN_CONFLICT");
  }
  const projectRoot = inspected.project.projectRoot;
  const state = ensureOnboardingState(inspected);
  if (!new Set(["awaiting-review", "revision-required"]).has(state.phase)) {
    fail("Onboarding candidate refresh requires a review-pending candidate set.", "ONBOARDING_REFRESH_NOT_AVAILABLE");
  }
  const previousSet = readOnboardingCandidateSet({ root: projectRoot, candidateSetId: state.candidateSetId }).candidateSet;
  if (previousSet.inputMode !== "existing" || previousSet.briefEvidenceId) {
    return { status: "onboarding_candidates_current", refreshed: false, reason: "user-brief-requires-explicit-review", state, candidateSet: previousSet };
  }
  const productCanon = readProductModelCanon({ projectRoot });
  if (productCanon.model.productModelId !== state.productModelId || productCanon.model.productModelId !== previousSet.productModelId) {
    fail("Product Canon changed after candidate proposal; candidate evidence cannot refresh automatically.", "ONBOARDING_PRODUCT_CANON_DRIFT");
  }
  const world = await buildWorldModel({ root: projectRoot, persist: true });
  if (world.snapshot.temporalProvenanceGraph.sourceSnapshotId === previousSet.sourceSnapshotId && semanticProposal == null) {
    return { status: "onboarding_candidates_current", refreshed: false, reason: "source-snapshot-current", state, candidateSet: previousSet };
  }
  if (semanticProposal == null) {
    return {
      status: "onboarding_semantic_reproposal_required",
      refreshed: false,
      reason: "source-snapshot-changed-fresh-head-semantic-proposal-required",
      state,
      candidateSet: previousSet,
      currentSourceSnapshotId: world.snapshot.temporalProvenanceGraph.sourceSnapshotId,
    };
  }
  const semantic = candidatesFromSemanticProposal(semanticProposal, world.snapshot, projectRoot);
  const candidateSet = buildCandidateSet({
    projectId: inspected.project.projectId,
    sessionId: inspected.state.sessionId,
    inputMode: previousSet.inputMode,
    storageSelectionId: previousSet.storageSelectionId,
    worldModel: world.snapshot,
    candidates: semantic.candidates,
    evidence: semantic.evidence,
    unknowns: semantic.unknowns,
    parentCandidateSetIds: [previousSet.candidateSetId],
  });
  const projectedWorld = await rebuildWithOnboardingProjection({
    projectRoot,
    projectId: inspected.project.projectId,
    currentProductModelId: productCanon.model.productModelId,
    sourceWorld: world,
    additionalCandidateSets: [candidateSet],
  });
  persistImmutable(candidateSetFile(projectRoot, candidateSet.candidateSetId), candidateSet, "Onboarding candidate set");
  const phase = candidateSet.candidates.length ? "awaiting-review" : "awaiting-evidence";
  const nextState = writeState(projectRoot, state, {
    phase,
    candidateSetId: candidateSet.candidateSetId,
    latestReviewDecisionId: null,
    worldModelId: projectedWorld.snapshot.worldModelId,
    sourceSnapshotId: projectedWorld.snapshot.temporalProvenanceGraph.sourceSnapshotId,
  });
  return {
    status: "onboarding_candidates_refreshed",
    refreshed: true,
    reason: "source-snapshot-changed",
    state: nextState,
    candidateSet,
    previousCandidateSetId: previousSet.candidateSetId,
    worldModel: {
      worldModelId: projectedWorld.snapshot.worldModelId,
      sourceSnapshotId: projectedWorld.snapshot.temporalProvenanceGraph.sourceSnapshotId,
      graphSnapshotId: projectedWorld.snapshot.temporalProvenanceGraph.graphSnapshotId,
    },
  };
}

function editedCandidates(candidateSet, userEdits, addedEntities = [], removedCandidateIds = []) {
  const edits = new Map();
  for (const [index, edit] of recordList(userEdits, "userEdits").entries()) {
    assertRecordFields(edit, ["candidateId", "entity"], `userEdits[${index}]`);
    const candidateId = requiredText(edit.candidateId, "userEdits.candidateId");
    if (!edit.entity || typeof edit.entity !== "object" || Array.isArray(edit.entity)) fail("userEdits.entity is required.", "INVALID_ONBOARDING_EDIT");
    if (edits.has(candidateId)) fail(`Duplicate edit for ${candidateId}.`, "DUPLICATE_ONBOARDING_EDIT");
    edits.set(candidateId, edit.entity);
  }
  const removed = new Set(textList(removedCandidateIds, "removedCandidateIds"));
  const known = new Map(candidateSet.candidates.map((candidate) => [candidate.candidateId, candidate]));
  for (const candidateId of [...edits.keys(), ...removed]) if (!known.has(candidateId)) {
    fail(`Unknown onboarding candidate: ${candidateId}`, "UNKNOWN_ONBOARDING_CANDIDATE");
  }
  const provisional = candidateSet.candidates.filter((candidate) => !removed.has(candidate.candidateId)).map((candidate) => ({
    kind: candidate.productKind,
    entity: edits.get(candidate.candidateId) || candidate.proposedEntity,
    source: candidate,
  }));
  for (const [index, addition] of recordList(addedEntities, "addedEntities").entries()) {
    assertRecordFields(addition, ["kind", "entity"], `addedEntities[${index}]`);
    if (!PRODUCT_ENTITY_KINDS.includes(addition.kind) || !addition.entity || typeof addition.entity !== "object" || Array.isArray(addition.entity)) {
      fail("addedEntities entries require a supported kind and entity.", "INVALID_ONBOARDING_ADDITION");
    }
    provisional.push({ kind: addition.kind, entity: addition.entity, source: null });
  }
  const document = emptyProductModelDocument();
  for (const item of provisional) document[ARRAY_BY_KIND[item.kind]].push(item.entity);
  const normalized = normalizeProductModelDocument(document);
  const normalizedByIdentity = new Map();
  for (const kind of PRODUCT_ENTITY_KINDS) for (const entity of normalized[ARRAY_BY_KIND[kind]]) {
    normalizedByIdentity.set(`${kind}:${entity.key}`, entity);
  }
  return provisional.map((item) => ({
    ...item,
    entity: normalizedByIdentity.get(`${item.kind}:${String(item.entity.key || "").trim()}`),
  }));
}

function revisionCandidateSet({ candidateSet, revisionItems, reviewDecision, worldModel }) {
  const reviewEvidence = evidenceRecord({
    sourceKind: "onboarding-review-input",
    sourceId: reviewDecision.reviewDecisionId,
    contentDigest: reviewDecision.reviewDecisionHash,
    statement: "User-authored onboarding revision input for a successor candidate set.",
  });
  const evidence = [...candidateSet.evidence, reviewEvidence];
  const candidates = revisionItems.map((item) => candidateArtifact({
    kind: item.kind,
    entity: item.entity,
    evidenceIds: item.source ? [...item.source.evidenceIds, reviewEvidence.evidenceId] : [reviewEvidence.evidenceId],
    explanation: item.source
      ? "The user revised or retained this prior candidate; it remains non-authoritative until a later acceptance review."
      : "The user proposed this entity during revision; it remains non-authoritative until a later acceptance review.",
    confidence: item.source && onboardingCanonicalJson(item.source.proposedEntity) === onboardingCanonicalJson(item.entity) ? item.source.confidence : 1,
    sourceSnapshotId: candidateSet.sourceSnapshotId,
    origin: item.source ? "onboarding-review-revision" : "onboarding-review-addition",
  }));
  return buildCandidateSet({
    projectId: candidateSet.projectId,
    sessionId: candidateSet.sessionId,
    inputMode: candidateSet.inputMode,
    storageSelectionId: candidateSet.storageSelectionId,
    worldModel,
    candidates,
    evidence,
    unknowns: candidateSet.unknowns,
    parentCandidateSetIds: [candidateSet.candidateSetId],
    producerReviewDecisionId: reviewDecision.reviewDecisionId,
    briefEvidenceId: candidateSet.briefEvidenceId,
  });
}

function mergeAcceptedIntoCanon(previousModel, acceptedItems) {
  const document = productModelDocument(previousModel);
  const existing = new Map();
  for (const kind of PRODUCT_ENTITY_KINDS) for (const entity of document[ARRAY_BY_KIND[kind]]) {
    existing.set(`${kind}:${entity.key}`, entity);
  }
  for (const item of acceptedItems) {
    const identity = `${item.kind}:${item.entity.key}`;
    if (existing.has(identity) && onboardingCanonicalJson(existing.get(identity)) !== onboardingCanonicalJson(item.entity)) {
      fail(`Product Canon conflict for ${identity}.`, "ONBOARDING_PRODUCT_CANON_CONFLICT");
    }
    if (!existing.has(identity)) document[ARRAY_BY_KIND[item.kind]].push(item.entity);
    existing.set(identity, item.entity);
  }
  return normalizeProductModelDocument(document);
}

function buildReviewDecision({ candidateSet, disposition, acceptedCandidateIds, rejectedCandidateIds, userEdits, addedEntities, rationale, previousProductModel, resultingProductModel = null }) {
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    kind: "ReviewDecision",
    protocol: { name: "head-agent-core-onboarding-review", version: ONBOARDING_REVIEW_VERSION },
    decisionScope: "product-canon-bootstrap",
    projectId: candidateSet.projectId,
    sessionId: candidateSet.sessionId,
    candidateSetId: candidateSet.candidateSetId,
    disposition,
    acceptedCandidateIds: [...acceptedCandidateIds].sort(),
    rejectedCandidateIds: [...rejectedCandidateIds].sort(),
    userEdits,
    addedEntities,
    rationale: requiredText(rationale, "Review rationale"),
    previousProductModelId: previousProductModel.productModelId,
    previousProductModelHash: previousProductModel.productModelHash,
    resultingProductModelId: resultingProductModel?.productModelId || null,
    resultingProductModelHash: resultingProductModel?.productModelHash || null,
    authority: "explicit-user-onboarding-review",
    instructionAuthority: true,
    promotionAuthority: disposition.startsWith("accept"),
    lineage: [
      { relation: "reviews-candidate-set", targetId: candidateSet.candidateSetId },
      { relation: "reviews-product-model", targetId: previousProductModel.productModelId },
      ...(resultingProductModel ? [{ relation: "promotes-to", targetId: resultingProductModel.productModelId }] : []),
    ],
  };
  const hash = onboardingDigest(onboardingCanonicalJson(payload));
  return { ...payload, reviewDecisionId: `onboarding-review-decision-${hash.slice(0, 24)}`, reviewDecisionHash: hash };
}

function verifyReviewDecision(document, projectId = "") {
  if (!document || document.kind !== "ReviewDecision" || document.decisionScope !== "product-canon-bootstrap") {
    fail("Onboarding ReviewDecision is invalid.", "INVALID_ONBOARDING_REVIEW");
  }
  const payload = { ...document };
  delete payload.reviewDecisionId;
  delete payload.reviewDecisionHash;
  const hash = onboardingDigest(onboardingCanonicalJson(payload));
  if (document.reviewDecisionHash !== hash || document.reviewDecisionId !== `onboarding-review-decision-${hash.slice(0, 24)}`) {
    fail("Onboarding ReviewDecision digest verification failed.", "ONBOARDING_REVIEW_DIGEST_MISMATCH");
  }
  if (projectId && document.projectId !== projectId) fail("Onboarding ReviewDecision belongs to another project.", "ONBOARDING_PROJECT_MISMATCH");
  if (!new Set(["accept-all", "accept-selection", "revise", "reject"]).has(document.disposition)) {
    fail("Onboarding ReviewDecision disposition is invalid.", "INVALID_ONBOARDING_REVIEW");
  }
  return document;
}

export function readOnboardingReviewDecision({ root = ".", reviewDecisionId } = {}) {
  const inspected = readyProject(root, "onboarding review inspection");
  const file = reviewDecisionFile(inspected.project.projectRoot, reviewDecisionId);
  if (!fs.existsSync(file)) fail(`Onboarding ReviewDecision not found: ${reviewDecisionId}`, "ONBOARDING_REVIEW_NOT_FOUND");
  const reviewDecision = verifyReviewDecision(readJson(file, "Onboarding ReviewDecision"), inspected.project.projectId);
  if (reviewDecision.reviewDecisionId !== reviewDecisionId) fail("Onboarding ReviewDecision identity does not match its requested file.", "ONBOARDING_REVIEW_IDENTITY_MISMATCH");
  const candidateSet = readOnboardingCandidateSet({ root: inspected.project.projectRoot, candidateSetId: reviewDecision.candidateSetId }).candidateSet;
  verifyOnboardingReviewDecisionForProjection(reviewDecision, candidateSet, inspected.project.projectId);
  if (candidateSet.sessionId !== reviewDecision.sessionId) fail("Onboarding ReviewDecision Session identity is invalid.", "ONBOARDING_SESSION_MISMATCH");
  const known = new Set(candidateSet.candidates.map((candidate) => candidate.candidateId));
  const accepted = new Set(reviewDecision.acceptedCandidateIds || []);
  const rejected = new Set(reviewDecision.rejectedCandidateIds || []);
  if ([...accepted, ...rejected].some((candidateId) => !known.has(candidateId))
    || [...accepted].some((candidateId) => rejected.has(candidateId))) {
    fail("Onboarding ReviewDecision candidate references are invalid.", "INVALID_ONBOARDING_REVIEW");
  }
  const accepting = reviewDecision.disposition.startsWith("accept");
  if (reviewDecision.promotionAuthority !== accepting
    || (accepting && (!reviewDecision.resultingProductModelId || !reviewDecision.resultingProductModelHash))
    || (!accepting && (reviewDecision.resultingProductModelId || reviewDecision.resultingProductModelHash))) {
    fail("Onboarding ReviewDecision promotion fields are invalid.", "INVALID_ONBOARDING_REVIEW");
  }
  return { status: "verified", file, reviewDecision };
}

function productModelRevisionDocument(model) {
  return {
    schemaVersion: 1,
    kind: "ProductModelRevision",
    productModelId: model.productModelId,
    productModelHash: model.productModelHash,
    document: productModelDocument(model),
    authority: "user-owned-project-canon-revision",
  };
}

function persistProductRevision(projectRoot, model) {
  const revision = productModelRevisionDocument(model);
  return persistImmutable(
    relativeFile(projectRoot, `${ONBOARDING_PRODUCT_REVISION_DIRECTORY}/${model.productModelId}.json`),
    revision,
    "Product Model revision",
  );
}

function readProductRevision(projectRoot, productModelId) {
  if (!/^product-model-[a-f0-9]{24}$/.test(productModelId || "")) {
    fail("Product Model revision id is invalid.", "INVALID_PRODUCT_MODEL_REVISION");
  }
  const file = relativeFile(projectRoot, `${ONBOARDING_PRODUCT_REVISION_DIRECTORY}/${productModelId}.json`);
  if (!fs.existsSync(file)) fail(`Product Model revision is missing: ${productModelId}`, "PRODUCT_MODEL_REVISION_MISSING");
  const revision = readJson(file, "Product Model revision");
  const normalized = normalizeProductModelDocument(revision.document);
  if (revision.kind !== "ProductModelRevision"
    || revision.productModelId !== productModelId
    || revision.productModelId !== normalized.productModelId
    || revision.productModelHash !== normalized.productModelHash
    || revision.authority !== "user-owned-project-canon-revision") {
    fail("Product Model revision digest verification failed.", "PRODUCT_MODEL_REVISION_DIGEST_MISMATCH");
  }
  verifyProductModelRevisionForProjection(revision);
  return { file, revision };
}

function acceptanceForState(projectRoot, state) {
  if (!state.candidateSetId) return null;
  const directory = relativeFile(projectRoot, ONBOARDING_REVIEW_DIRECTORY);
  if (!fs.existsSync(directory)) return null;
  const decisions = [];
  for (const name of fs.readdirSync(directory).sort()) {
    if (!/^onboarding-review-decision-[a-f0-9]{24}\.json$/.test(name)) continue;
    const document = readJson(relativeFile(projectRoot, `${ONBOARDING_REVIEW_DIRECTORY}/${name}`), "Onboarding ReviewDecision");
    if (document.candidateSetId !== state.candidateSetId || !document.disposition?.startsWith("accept")) continue;
    decisions.push(readOnboardingReviewDecision({ root: projectRoot, reviewDecisionId: name.slice(0, -5) }).reviewDecision);
  }
  if (decisions.length > 1) fail("The current candidate set has conflicting acceptance decisions.", "ONBOARDING_REVIEW_CONFLICT");
  return decisions[0] || null;
}

function verifiedPromotion({ projectRoot, state, review, allowUnpublishedReview = false }) {
  const decisionFile = reviewDecisionFile(projectRoot, review.reviewDecisionId);
  if (fs.existsSync(decisionFile)) {
    const durable = readOnboardingReviewDecision({ root: projectRoot, reviewDecisionId: review.reviewDecisionId }).reviewDecision;
    if (durable.reviewDecisionHash !== review.reviewDecisionHash) fail("Onboarding decision changed during application.", "ONBOARDING_REVIEW_CONFLICT");
  } else if (!allowUnpublishedReview) {
    fail("Approved onboarding recovery requires its durable decision.", "ONBOARDING_REVIEW_NOT_FOUND");
  }
  const candidateSet = readOnboardingCandidateSet({ root: projectRoot, candidateSetId: review.candidateSetId }).candidateSet;
  const canon = readProductModelCanon({ projectRoot });
  if (![review.previousProductModelId, review.resultingProductModelId].includes(canon.model.productModelId)
    || ![review.previousProductModelId, review.resultingProductModelId].includes(state.productModelId)) {
    fail("A later Product Canon or onboarding state cannot be overwritten by an earlier review.", "ONBOARDING_PRODUCT_CANON_DRIFT");
  }
  const previousFile = relativeFile(projectRoot, `${ONBOARDING_PRODUCT_REVISION_DIRECTORY}/${review.previousProductModelId}.json`);
  const previous = fs.existsSync(previousFile) ? readProductRevision(projectRoot, review.previousProductModelId).revision
    : canon.model.productModelId === review.previousProductModelId ? productModelRevisionDocument(canon.model) : null;
  if (!previous) fail("The approved promotion's previous Product revision is unavailable.", "PRODUCT_MODEL_REVISION_MISSING");
  const selected = new Set(review.acceptedCandidateIds);
  const reviewedItems = editedCandidates(candidateSet, review.userEdits, [], []).filter((item) => selected.has(item.source.candidateId));
  const expected = mergeAcceptedIntoCanon(normalizeProductModelDocument(previous.document), reviewedItems);
  const resultingFile = relativeFile(projectRoot, `${ONBOARDING_PRODUCT_REVISION_DIRECTORY}/${review.resultingProductModelId}.json`);
  const resulting = fs.existsSync(resultingFile) ? readProductRevision(projectRoot, review.resultingProductModelId).revision
    : productModelRevisionDocument(expected);
  if (review.sessionId !== state.sessionId || review.candidateSetId !== state.candidateSetId
    || previous.productModelHash !== review.previousProductModelHash
    || resulting.productModelHash !== review.resultingProductModelHash
    || expected.productModelHash !== review.resultingProductModelHash) {
    fail("Onboarding promotion does not match its approved Product revisions.", "ONBOARDING_REVIEW_CONFLICT");
  }
  if (state.phase === "ready") {
    if (onboardingStateLatestReviewDecisionId(state) !== review.reviewDecisionId
      || state.productModelId !== review.resultingProductModelId
      || canon.model.productModelId !== review.resultingProductModelId) {
      fail("Completed onboarding does not match its acceptance decision.", "ONBOARDING_REVIEW_CONFLICT");
    }
  } else {
    if (!["awaiting-review", "revision-required"].includes(state.phase)
      || state.productModelId !== review.previousProductModelId) {
      fail("Onboarding promotion has an incompatible current phase.", "ONBOARDING_REVIEW_CONFLICT");
    }
    const prior = onboardingStateLatestReviewDecisionId(state);
    if (prior !== onboardingCandidateProducerReviewDecisionId(candidateSet)) {
      fail("Onboarding promotion cannot replace a later disposition.", "ONBOARDING_REVIEW_CONFLICT");
    }
  }
  return { candidateSet, previous, resulting, canon };
}

function promotionResult({ state, review, productModel, world, reasonCode = null }) {
  return {
    status: reasonCode ? "onboarding_approved_projection_pending" : "onboarding_ready",
    state,
    reviewDecision: review,
    productModel,
    productCanonChanged: true,
    ...(reasonCode ? { projection: { status: "refresh_required", reasonCode, ordinaryWorkBlocked: false, userReviewRequired: false } } : {}),
    worldModel: world ? {
      worldModelId: world.snapshot.worldModelId,
      sourceSnapshotId: world.snapshot.temporalProvenanceGraph.sourceSnapshotId,
      graphSnapshotId: world.snapshot.temporalProvenanceGraph.graphSnapshotId,
    } : null,
  };
}

// The already durable P1 ReviewDecision is the commit intent. Recovery never
// creates approval from a graph, a transaction receipt, or a caller's retry.
async function applyApprovedPromotion({ projectRoot, state, review, publishReview = false }) {
  if (!publishReview && state.phase === "ready") {
    const verified = verifiedPromotion({ projectRoot, state, review });
    if (state.sourceSnapshotId !== verified.candidateSet.sourceSnapshotId) {
      let world = null;
      let reasonCode = null;
      try {
        world = readWorldModelSnapshot({ root: projectRoot, worldModelId: state.worldModelId });
        const current = inspectWorldModel({ root: projectRoot });
        if (current.status !== "current" || current.snapshot.worldModelId !== state.worldModelId) reasonCode = "WORLD_MODEL_STALE";
      } catch (error) { reasonCode = error.code || "ONBOARDING_GRAPH_REBUILD_FAILED"; }
      return { ...promotionResult({ state, review, productModel: normalizeProductModelDocument(verified.resulting.document), world, reasonCode }), productCanonChanged: false };
    }
  }
  const prepared = withProjectMutation({ root: projectRoot, scope: "session-recovery" }, () => {
    const { candidateSet, previous, resulting, canon } = verifiedPromotion({ projectRoot, state, review, allowUnpublishedReview: publishReview });
    const inspected = readyProject(projectRoot, "onboarding promotion recovery");
    if (inspected.state.sessionId !== state.sessionId || inspected.state.activeRunId || inspected.state.pendingReview) {
      fail("Onboarding promotion cannot replace current Session or active Run authority.", "ONBOARDING_RUN_CONFLICT");
    }
    if (publishReview) persistImmutable(reviewDecisionFile(projectRoot, review.reviewDecisionId), review, "Onboarding ReviewDecision");
    const nextModel = normalizeProductModelDocument(resulting.document);
    persistProductRevision(projectRoot, normalizeProductModelDocument(previous.document));
    persistProductRevision(projectRoot, nextModel);
    if (canon.model.productModelId !== review.resultingProductModelId) {
      atomicWrite(relativeFile(projectRoot, PRODUCT_MODEL_RELATIVE_PATH), json(resulting.document));
    }
    let nextState = state;
    if (state.phase !== "ready") {
      // Canon and its authority pointer converge before any awaited derived work.
      // The old World remains visibly stale until the rebuild is verified.
      nextState = writeState(projectRoot, state, {
        phase: "ready",
        latestReviewDecisionId: review.reviewDecisionId,
        productModelId: review.resultingProductModelId,
        previousProductModelId: review.previousProductModelId,
      });
    }
    return { candidateSet, nextModel, nextState, inspected };
  });
  const { candidateSet, nextModel, inspected } = prepared;
  let { nextState } = prepared;
  try {
    let currentWorld = null;
    try { currentWorld = inspectWorldModel({ root: projectRoot }); }
    catch (error) { if (error.code !== "WORLD_MODEL_NOT_BUILT") throw error; }
    const alreadyProjected = currentWorld?.status === "current"
      && currentWorld.snapshot.productModel.productModelId === nextModel.productModelId
      && currentWorld.snapshot.temporalProvenanceGraph.parentSourceSnapshotIds.includes(candidateSet.sourceSnapshotId)
      && currentWorld.snapshot.temporalProvenanceGraph.onboardingProjection.reviewDecisionIds.includes(review.reviewDecisionId);
    const rebuilt = alreadyProjected ? currentWorld : await rebuildWithOnboardingProjection({
      projectRoot,
      projectId: inspected.project.projectId,
      currentProductModelId: nextModel.productModelId,
      sourceWorld: currentWorld || { snapshot: { temporalProvenanceGraph: {} } },
      parentSourceSnapshotIds: [candidateSet.sourceSnapshotId],
      revisionParentIds: {},
    });
    const verifiedWorld = inspectWorldModel({ root: projectRoot });
    if (verifiedWorld.status !== "current"
      || rebuilt.snapshot.productModel.productModelId !== nextModel.productModelId
      || rebuilt.snapshot.temporalProvenanceGraph.productModelId !== nextModel.productModelId
      || !rebuilt.snapshot.temporalProvenanceGraph.parentSourceSnapshotIds.includes(candidateSet.sourceSnapshotId)
      || !rebuilt.snapshot.temporalProvenanceGraph.onboardingProjection.reviewDecisionIds.includes(review.reviewDecisionId)
      || !rebuilt.snapshot.temporalProvenanceGraph.onboardingProjection.productModelRevisionIds.includes(nextModel.productModelId)) {
      fail("Approved Product Canon did not produce the expected verified GraphSnapshot.", "ONBOARDING_GRAPH_VERIFICATION_FAILED");
    }
    withProjectMutation({ root: projectRoot, scope: "session-recovery" }, () => {
      const after = ensureOnboardingState(readyProject(projectRoot));
      verifiedPromotion({ projectRoot, state: after, review });
      if (after.pointerHash !== nextState.pointerHash) {
        fail("Onboarding state changed during projection rebuild.", "ONBOARDING_REVIEW_CONFLICT");
      }
      if (nextState.worldModelId !== rebuilt.snapshot.worldModelId
        || nextState.sourceSnapshotId !== rebuilt.snapshot.temporalProvenanceGraph.sourceSnapshotId) {
        nextState = writeState(projectRoot, nextState, {
          worldModelId: rebuilt.snapshot.worldModelId,
          sourceSnapshotId: rebuilt.snapshot.temporalProvenanceGraph.sourceSnapshotId,
        });
      }
    });
    return promotionResult({ state: nextState, review, productModel: nextModel, world: rebuilt });
  } catch (error) {
    // Approval remains P1 even when optional P4 materialization fails. Do not
    // roll back newer Canon or make the user repeat an already durable decision.
    verifiedPromotion({ projectRoot, state: ensureOnboardingState(readyProject(projectRoot)), review });
    if (["ONBOARDING_REVIEW_CONFLICT", "ONBOARDING_PRODUCT_CANON_DRIFT", "ONBOARDING_RUN_CONFLICT", "ONBOARDING_STATE_IDENTITY_MISMATCH"].includes(error.code)) throw error;
    return promotionResult({ state: nextState, review, productModel: nextModel, world: null, reasonCode: error.code || "ONBOARDING_GRAPH_REBUILD_FAILED" });
  }
}

async function recoverOnboardingPromotionLocked({ root = "." } = {}) {
  const inspected = readyProject(root, "onboarding promotion recovery");
  const projectRoot = inspected.project.projectRoot;
  if (!fs.existsSync(stateFile(projectRoot))) return null;
  const state = ensureOnboardingState(inspected);
  const review = acceptanceForState(projectRoot, state);
  if (!review) return null;
  // A completed historical review is not a request to refresh every later World.
  if (state.phase === "ready" && state.sourceSnapshotId !== readOnboardingCandidateSet({ root: projectRoot, candidateSetId: review.candidateSetId }).candidateSet.sourceSnapshotId) return null;
  return applyApprovedPromotion({ projectRoot, state, review });
}

export async function recoverOnboardingPromotion(options = {}) {
  return withProjectMutationAsync({ root: options.root ?? ".", scope: "onboarding-promotion" }, () => recoverOnboardingPromotionLocked(options));
}

export async function reviewOnboarding(options = {}) {
  return withProjectMutationAsync({ root: options.root ?? ".", scope: "onboarding-promotion" }, () => reviewOnboardingLocked(options));
}

function assertAcceptanceReplay({ projectRoot, state, candidateSet, review, disposition, acceptedCandidateIds, removedCandidateIds, userEdits, addedEntities, rationale }) {
  const normalizedDisposition = requiredText(disposition, "Review disposition").toLowerCase();
  if (!normalizedDisposition.startsWith("accept") || removedCandidateIds.length || addedEntities.length) {
    fail("The candidate set already has a different durable user decision.", "ONBOARDING_REVIEW_REPLAY_CONFLICT");
  }
  const previous = normalizeProductModelDocument(verifiedPromotion({ projectRoot, state, review }).previous.document);
  const items = editedCandidates(candidateSet, userEdits, [], []);
  const selectedIds = normalizedDisposition === "accept-all" ? candidateSet.candidates.map((item) => item.candidateId) : textList(acceptedCandidateIds, "acceptedCandidateIds");
  const selected = new Set(selectedIds);
  const edits = recordList(userEdits, "userEdits").map((edit) => ({
    candidateId: edit.candidateId,
    entity: items.find((item) => item.source?.candidateId === edit.candidateId).entity,
  })).sort((left, right) => compareText(left.candidateId, right.candidateId));
  const requested = buildReviewDecision({
    candidateSet,
    disposition: normalizedDisposition,
    acceptedCandidateIds: selectedIds,
    rejectedCandidateIds: candidateSet.candidates.map((item) => item.candidateId).filter((id) => !selected.has(id)),
    userEdits: edits,
    addedEntities: [],
    rationale,
    previousProductModel: previous,
    resultingProductModel: mergeAcceptedIntoCanon(previous, items.filter((item) => selected.has(item.source.candidateId))),
  });
  if (requested.reviewDecisionHash !== review.reviewDecisionHash) {
    fail("A divergent retry cannot rewrite the durable user decision.", "ONBOARDING_REVIEW_REPLAY_CONFLICT");
  }
}

async function reviewOnboardingLocked({
  root = ".",
  candidateSetId,
  disposition,
  acceptedCandidateIds = [],
  removedCandidateIds = [],
  userEdits = [],
  addedEntities = [],
  rationale,
} = {}) {
  const inspected = readyProject(root, "onboarding review");
  if (inspected.state.activeRunId || inspected.state.pendingReview) {
    fail("Onboarding review cannot change product authority while a Run is active or awaiting review.", "ONBOARDING_RUN_CONFLICT");
  }
  const projectRoot = inspected.project.projectRoot;
  const state = ensureOnboardingState(inspected);
  const reviewedSetId = requiredText(candidateSetId, "candidateSetId");
  if (state.candidateSetId !== reviewedSetId) fail("Onboarding review references a stale candidate set.", "STALE_ONBOARDING_CANDIDATE_SET");
  const candidateSet = readOnboardingCandidateSet({ root: projectRoot, candidateSetId: reviewedSetId }).candidateSet;
  const recordedAcceptance = acceptanceForState(projectRoot, state);
  if (recordedAcceptance) {
    assertAcceptanceReplay({ projectRoot, state, candidateSet, review: recordedAcceptance, disposition, acceptedCandidateIds, removedCandidateIds, userEdits, addedEntities, rationale });
    return applyApprovedPromotion({ projectRoot, state, review: recordedAcceptance });
  }
  if (candidateSet.sourceSnapshotId !== state.sourceSnapshotId) {
    fail("Onboarding candidate set no longer matches the recorded source snapshot.", "ONBOARDING_SOURCE_SNAPSHOT_CONFLICT");
  }
  const currentWorld = inspectWorldModel({ root: projectRoot });
  if (currentWorld.status !== "current"
    || currentWorld.snapshot.temporalProvenanceGraph.sourceSnapshotId !== candidateSet.sourceSnapshotId) {
    fail("Observed project state changed after candidate proposal; re-index and create a new candidate set.", "ONBOARDING_SOURCE_DRIFT");
  }
  const normalizedDisposition = requiredText(disposition, "Review disposition").toLowerCase();
  if (!new Set(["accept-all", "accept-selection", "revise", "reject"]).has(normalizedDisposition)) {
    fail("Onboarding ReviewDecision disposition is invalid.", "INVALID_ONBOARDING_REVIEW_DISPOSITION");
  }
  const currentCanon = readProductModelCanon({ projectRoot });
  if (currentCanon.model.productModelId !== candidateSet.productModelId || currentCanon.model.productModelId !== state.productModelId) {
    fail("Product Canon changed after candidate proposal; a new onboarding candidate set is required.", "ONBOARDING_PRODUCT_CANON_DRIFT");
  }
  const revisionItems = editedCandidates(candidateSet, userEdits, addedEntities, removedCandidateIds);
  const allCandidateIds = candidateSet.candidates.map((candidate) => candidate.candidateId);
  const normalizedUserEdits = recordList(userEdits, "userEdits").map((edit) => {
    const revised = revisionItems.find((item) => item.source?.candidateId === edit.candidateId);
    if (!revised) fail(`Edited candidate was removed or is unavailable: ${edit.candidateId}`, "INVALID_ONBOARDING_EDIT");
    return { candidateId: edit.candidateId, entity: revised.entity };
  }).sort((left, right) => compareText(left.candidateId, right.candidateId));
  const normalizedAddedEntities = revisionItems.filter((item) => !item.source)
    .map((item) => ({ kind: item.kind, entity: item.entity }))
    .sort((left, right) => (KIND_ORDER.get(left.kind) - KIND_ORDER.get(right.kind)) || compareText(left.entity.key, right.entity.key));

  if (normalizedDisposition === "revise") {
    if (!userEdits.length && !addedEntities.length && !removedCandidateIds.length) {
      fail("Revise requires an edit, addition, or removal.", "ONBOARDING_REVISION_REQUIRED");
    }
    const review = buildReviewDecision({
      candidateSet,
      disposition: normalizedDisposition,
      acceptedCandidateIds: [],
      rejectedCandidateIds: textList(removedCandidateIds, "removedCandidateIds"),
      userEdits: normalizedUserEdits,
      addedEntities: normalizedAddedEntities,
      rationale,
      previousProductModel: currentCanon.model,
    });
    verifyReviewDecision(review, inspected.project.projectId);
    const sourceWorld = readWorldModel({ root: projectRoot }).snapshot;
    const nextSet = revisionCandidateSet({ candidateSet, revisionItems, reviewDecision: review, worldModel: sourceWorld });
    const projectedWorld = await rebuildWithOnboardingProjection({
      projectRoot,
      projectId: inspected.project.projectId,
      currentProductModelId: currentCanon.model.productModelId,
      sourceWorld: { snapshot: sourceWorld },
      additionalCandidateSets: [nextSet],
      additionalReviewDecisions: [review],
    });
    persistImmutable(reviewDecisionFile(projectRoot, review.reviewDecisionId), review, "Onboarding ReviewDecision");
    persistImmutable(candidateSetFile(projectRoot, nextSet.candidateSetId), nextSet, "Onboarding candidate set");
    const nextState = writeState(projectRoot, state, {
      phase: nextSet.candidates.length ? "awaiting-review" : "awaiting-evidence",
      candidateSetId: nextSet.candidateSetId,
      latestReviewDecisionId: review.reviewDecisionId,
      worldModelId: projectedWorld.snapshot.worldModelId,
      sourceSnapshotId: projectedWorld.snapshot.temporalProvenanceGraph.sourceSnapshotId,
    });
    return {
      status: "onboarding_revision_awaiting_review",
      state: nextState,
      reviewDecision: review,
      candidateSet: nextSet,
      worldModel: {
        worldModelId: projectedWorld.snapshot.worldModelId,
        sourceSnapshotId: projectedWorld.snapshot.temporalProvenanceGraph.sourceSnapshotId,
        graphSnapshotId: projectedWorld.snapshot.temporalProvenanceGraph.graphSnapshotId,
      },
    };
  }

  if (normalizedDisposition === "reject") {
    if (userEdits.length || addedEntities.length || acceptedCandidateIds.length) {
      fail("Reject cannot include accepted candidates, edits, or additions.", "INVALID_ONBOARDING_REJECTION");
    }
    const review = buildReviewDecision({
      candidateSet,
      disposition: normalizedDisposition,
      acceptedCandidateIds: [],
      rejectedCandidateIds: allCandidateIds,
      userEdits: [],
      addedEntities: [],
      rationale,
      previousProductModel: currentCanon.model,
    });
    verifyReviewDecision(review, inspected.project.projectId);
    const sourceWorld = readWorldModel({ root: projectRoot });
    const projectedWorld = await rebuildWithOnboardingProjection({
      projectRoot,
      projectId: inspected.project.projectId,
      currentProductModelId: currentCanon.model.productModelId,
      sourceWorld,
      additionalReviewDecisions: [review],
    });
    persistImmutable(reviewDecisionFile(projectRoot, review.reviewDecisionId), review, "Onboarding ReviewDecision");
    const nextState = writeState(projectRoot, state, {
      phase: "rejected",
      latestReviewDecisionId: review.reviewDecisionId,
      worldModelId: projectedWorld.snapshot.worldModelId,
      sourceSnapshotId: projectedWorld.snapshot.temporalProvenanceGraph.sourceSnapshotId,
    });
    return {
      status: "onboarding_rejected",
      state: nextState,
      reviewDecision: review,
      productCanonChanged: false,
      worldModel: {
        worldModelId: projectedWorld.snapshot.worldModelId,
        sourceSnapshotId: projectedWorld.snapshot.temporalProvenanceGraph.sourceSnapshotId,
        graphSnapshotId: projectedWorld.snapshot.temporalProvenanceGraph.graphSnapshotId,
      },
    };
  }

  if (!candidateSet.candidates.length) fail("An empty candidate set cannot be accepted.", "ONBOARDING_EVIDENCE_REQUIRED");
  if (addedEntities.length || removedCandidateIds.length) {
    fail("Additions and removals require a revise decision followed by review of the successor candidate set.", "ONBOARDING_REVISION_REQUIRED");
  }
  const selectedIds = normalizedDisposition === "accept-all"
    ? allCandidateIds
    : textList(acceptedCandidateIds, "acceptedCandidateIds");
  if (!selectedIds.length) fail("accept-selection requires at least one candidate.", "ONBOARDING_SELECTION_REQUIRED");
  const candidateById = new Map(candidateSet.candidates.map((candidate) => [candidate.candidateId, candidate]));
  for (const candidateId of selectedIds) if (!candidateById.has(candidateId)) {
    fail(`Unknown onboarding candidate: ${candidateId}`, "UNKNOWN_ONBOARDING_CANDIDATE");
  }
  const selected = new Set(selectedIds);
  for (const edit of userEdits) if (!selected.has(edit.candidateId)) {
    fail("A user edit can only target an accepted candidate.", "INVALID_ONBOARDING_EDIT");
  }
  const acceptedItems = revisionItems.filter((item) => item.source && selected.has(item.source.candidateId));
  const nextModel = mergeAcceptedIntoCanon(currentCanon.model, acceptedItems);
  const rejectedIds = allCandidateIds.filter((candidateId) => !selected.has(candidateId));
  const review = buildReviewDecision({
    candidateSet,
    disposition: normalizedDisposition,
    acceptedCandidateIds: selectedIds,
    rejectedCandidateIds: rejectedIds,
    userEdits: normalizedUserEdits,
    addedEntities: [],
    rationale,
    previousProductModel: currentCanon.model,
    resultingProductModel: nextModel,
  });
  verifyReviewDecision(review, inspected.project.projectId);
  return applyApprovedPromotion({ projectRoot, state, review, publishReview: true });
}

function verifyCurrentOnboardingReviewLineage({ projectRoot, state, candidateSet, latestReviewDecision }) {
  const latestReviewDecisionId = onboardingStateLatestReviewDecisionId(state);
  const producerReviewDecisionId = candidateSet
    ? onboardingCandidateProducerReviewDecisionId(candidateSet)
    : null;
  let producerReviewDecision = null;

  if (producerReviewDecisionId) {
    producerReviewDecision = readOnboardingReviewDecision({
      root: projectRoot,
      reviewDecisionId: producerReviewDecisionId,
    }).reviewDecision;
    const producerEvidence = candidateSet.evidence.find((evidence) => (
      evidence.sourceKind === "onboarding-review-input"
      && evidence.sourceId === producerReviewDecisionId
      && evidence.contentDigest === producerReviewDecision.reviewDecisionHash
    ));
    if (producerReviewDecision.disposition !== "revise"
      || producerReviewDecision.projectId !== candidateSet.projectId
      || producerReviewDecision.sessionId !== candidateSet.sessionId
      || !candidateSet.parentCandidateSetIds.includes(producerReviewDecision.candidateSetId)
      || !producerEvidence) {
      fail("Onboarding successor candidate set has invalid producer ReviewDecision lineage.", "ONBOARDING_REVIEW_CONFLICT");
    }
  }

  if ((latestReviewDecision?.reviewDecisionId || null) !== latestReviewDecisionId) {
    fail("Onboarding state latest ReviewDecision could not be verified.", "ONBOARDING_REVIEW_CONFLICT");
  }

  if (["awaiting-review", "awaiting-evidence", "revision-required"].includes(state.phase)) {
    if (latestReviewDecisionId !== producerReviewDecisionId) {
      fail("Review-pending onboarding state does not match its successor-producing ReviewDecision.", "ONBOARDING_REVIEW_CONFLICT");
    }
  } else if (state.phase === "ready" && candidateSet) {
    if (!latestReviewDecision?.disposition.startsWith("accept")
      || latestReviewDecision.candidateSetId !== candidateSet.candidateSetId) {
      fail("Ready onboarding state does not name the acceptance ReviewDecision for its current candidate set.", "ONBOARDING_REVIEW_CONFLICT");
    }
  } else if (state.phase === "rejected") {
    if (!candidateSet || latestReviewDecision?.disposition !== "reject"
      || latestReviewDecision.candidateSetId !== candidateSet.candidateSetId) {
      fail("Rejected onboarding state does not name the rejection ReviewDecision for its current candidate set.", "ONBOARDING_REVIEW_CONFLICT");
    }
  } else if (!candidateSet && latestReviewDecisionId) {
    fail("Onboarding state names a ReviewDecision without a current candidate set.", "ONBOARDING_REVIEW_CONFLICT");
  }

  return {
    producerReviewDecisionId,
    latestReviewDecisionId,
    producerReviewDecision,
  };
}

export function inspectOnboarding({ root = "." } = {}) {
  const inspected = readyProject(root, "onboarding inspection");
  const projectRoot = inspected.project.projectRoot;
  const file = stateFile(projectRoot);
  if (!fs.existsSync(file)) {
    const migration = migrationPreview(inspected);
    return {
      status: "migration_required",
      projectId: inspected.project.projectId,
      sessionId: inspected.state.sessionId,
      migration: {
        kind: migration.state.migration,
        phase: migration.state.phase,
        storageSelectionId: migration.storageSelection.storageSelectionId,
        writesRequired: [
          ONBOARDING_STATE_RELATIVE_PATH,
          `${SESSION_RECORD_DIRECTORY}/${migration.sessionRecord.sessionId}.json`,
          `${ONBOARDING_STORAGE_DIRECTORY}/${migration.storageSelection.storageSelectionId}.json`,
        ],
      },
    };
  }
  const state = verifyOnboardingState(readJson(file, "Onboarding state pointer"), {
    projectId: inspected.project.projectId,
    sessionId: inspected.state.sessionId,
  });
  const sessionRecord = verifySessionRecord(
    readJson(sessionRecordFile(projectRoot, state.sessionId), "HEAD Session record"),
    { projectId: inspected.project.projectId, sessionId: inspected.state.sessionId },
  );
  const storageSelection = verifyStorageSelection(
    readJson(storageSelectionFile(projectRoot, state.storageSelectionId), "Onboarding storage selection"),
    inspected.project.projectId,
  );
  const candidateSet = state.candidateSetId
    ? readOnboardingCandidateSet({ root: projectRoot, candidateSetId: state.candidateSetId }).candidateSet
    : null;
  const latestReviewDecisionId = onboardingStateLatestReviewDecisionId(state);
  const reviewDecision = latestReviewDecisionId
    ? readOnboardingReviewDecision({ root: projectRoot, reviewDecisionId: latestReviewDecisionId }).reviewDecision
    : null;
  const productCanon = readProductModelCanon({ projectRoot });
  const pendingAcceptance = candidateSet && state.sourceSnapshotId === candidateSet.sourceSnapshotId
    ? acceptanceForState(projectRoot, state) : null;
  if (pendingAcceptance) {
    const promotion = verifiedPromotion({ projectRoot, state, review: pendingAcceptance });
    return {
      status: "promotion_recovery_pending",
      state,
      sessionRecord,
      storageSelection,
      candidateSet,
      reviewDecision: pendingAcceptance,
      productModel: productCanon.model,
      productModelRevisions: { previous: promotion.previous, resulting: promotion.resulting },
      worldModel: null,
      recovery: { nextAction: "resume_product_governance", userReviewRequired: false, ordinaryWorkBlocked: false },
      authority: {
        productCanon: "user-owned-project-canon",
        candidates: "non-authoritative-until-review",
        graph: "rebuildable-derived-evidence",
      },
    };
  }
  const reviewLineage = verifyCurrentOnboardingReviewLineage({
    projectRoot,
    state,
    candidateSet,
    latestReviewDecision: reviewDecision,
  });
  if (productCanon.model.productModelId !== state.productModelId) {
    fail("Onboarding state Product Model identity does not match current canon.", "ONBOARDING_PRODUCT_CANON_DRIFT");
  }
  const productModelRevisions = reviewDecision?.promotionAuthority ? {
    previous: readProductRevision(projectRoot, reviewDecision.previousProductModelId).revision,
    resulting: readProductRevision(projectRoot, reviewDecision.resultingProductModelId).revision,
  } : null;
  let world = null;
  if (state.worldModelId) {
    const inspectedWorld = inspectWorldModel({ root: projectRoot });
    world = {
      status: inspectedWorld.status,
      worldModelId: inspectedWorld.snapshot.worldModelId,
      sourceSnapshotId: inspectedWorld.snapshot.temporalProvenanceGraph.sourceSnapshotId,
      graphSnapshotId: inspectedWorld.snapshot.temporalProvenanceGraph.graphSnapshotId,
      matchesOnboardingSnapshot: inspectedWorld.snapshot.worldModelId === state.worldModelId
        && inspectedWorld.snapshot.temporalProvenanceGraph.sourceSnapshotId === state.sourceSnapshotId,
    };
  }
  const status = state.phase === "ready"
    ? world?.status === "current" && world.matchesOnboardingSnapshot ? "ready" : "ready_world_changed"
    : state.phase.replaceAll("-", "_");
  return {
    status,
    state,
    sessionRecord,
    storageSelection,
    candidateSet,
    reviewDecision,
    reviewLineage: {
      producerReviewDecisionId: reviewLineage.producerReviewDecisionId,
      latestReviewDecisionId: reviewLineage.latestReviewDecisionId,
    },
    productModel: productCanon.model,
    productModelRevisions,
    worldModel: world,
    authority: {
      productCanon: "user-owned-project-canon",
      candidates: "non-authoritative-until-review",
      graph: "rebuildable-derived-evidence",
    },
  };
}
