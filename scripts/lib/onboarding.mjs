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
  ONBOARDING_PRODUCT_REVISION_DIRECTORY,
  ONBOARDING_PROTOCOL_VERSION,
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
import { buildWorldModel, inspectWorldModel, readWorldModel } from "./world-model.mjs";
import { readRepositorySourceScope, writeRepositorySourceScope } from "./repository-source-scope.mjs";

export const ONBOARDING_CANDIDATE_VERSION = "0.2.0";
export const ONBOARDING_REVIEW_VERSION = "0.1.0";
export const ONBOARDING_INFERENCE_VERSION = "0.2.0";

const MAX_INFERRED_SYMBOLS = 24;
const MAX_CANDIDATES = 200;
const MAX_EVIDENCE_RECORDS = 250;
const MAX_UNKNOWNS = 100;
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
  const state = buildOnboardingState({
    ...previous,
    ...changes,
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
  if (typeof confidence !== "number" || confidence < 0 || confidence > 1) {
    fail("Onboarding candidate confidence must be from zero through one.", "INVALID_ONBOARDING_CONFIDENCE");
  }
  const payload = {
    schemaVersion: 1,
    kind: "OnboardingProductCandidate",
    productKind: kind,
    proposedEntity: entity,
    evidenceIds: [...new Set(evidenceIds)].sort(),
    explanation: requiredText(explanation, "Candidate explanation"),
    confidence: Number(confidence.toFixed(6)),
    sourceSnapshotId: requiredText(sourceSnapshotId, "Candidate sourceSnapshotId"),
    origin: requiredText(origin, "Candidate origin"),
    producer: "head-agent-core-onboarding-inference",
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

function buildCandidateSet({ projectId, sessionId, inputMode, storageSelectionId, worldModel, candidates, evidence, unknowns, parentCandidateSetIds = [], reviewDecisionId = null, briefEvidenceId = null }) {
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
    reviewDecisionId,
    reviewProtocol: {
      decisionScope: "product-canon-bootstrap",
      allowedDispositions: ["accept-all", "accept-selection", "revise", "reject"],
      authorityTransition: "only-an-explicit-onboarding-review-decision-may-write-product-canon",
    },
    limits: {
      maxInferredSymbols: MAX_INFERRED_SYMBOLS,
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

function stableKey(prefix, value) {
  const slug = String(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return `${prefix}:${slug || onboardingDigest(String(value)).slice(0, 12)}`;
}

function humanName(value) {
  return String(value).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function productSymbolScore({ file, symbol }) {
  const words = humanName(symbol.name).toLowerCase();
  let score = file.classification === "source" ? 20 : 4;
  score += symbol.kind === "function" ? 14 : symbol.kind === "class" ? 8 : 2;
  if (/\b(?:create|start|stop|open|close|connect|disconnect|read|write|send|receive|process|detect|pick|calibrate|align|capture|preview|serve|control|update|load|save|run|handle|publish|subscribe|transport|infer|verify|track|manage)\w*\b/u.test(words)) score += 16;
  if (/\b(?:mock|fake|stub|broken|benchmark|spec|descriptor|observation|record|stats?|dict|list|array|batch|base|block|head|queue|reader|writer|fixture)\w*\b/u.test(words)) score -= 24;
  if (file.classification === "test") score -= 8;
  if (symbol.name.length < 4) score -= 4;
  return score;
}

function inferRepositoryCandidates(worldModel) {
  const evidence = [];
  const candidates = [];
  const unknowns = [];
  const sourceSnapshotId = worldModel.temporalProvenanceGraph.sourceSnapshotId;
  const documentationHeadings = worldModel.files.flatMap((file) => (
    file.classification === "documentation"
      ? file.symbols.filter((symbol) => symbol.kind === "heading").map((symbol) => ({ file, symbol }))
      : []
  )).sort((left, right) => compareText(left.file.path, right.file.path) || left.symbol.line - right.symbol.line || compareText(left.symbol.name, right.symbol.name));
  let featureGroup = null;
  if (documentationHeadings.length) {
    const selected = documentationHeadings[0];
    const groupEvidence = evidenceRecord({
      sourceKind: "repository-documentation-heading",
      sourceId: sourceSnapshotId,
      path: selected.file.path,
      line: selected.symbol.line,
      contentDigest: selected.file.digest,
      statement: `Documentation heading proposes a possible product grouping: ${selected.symbol.name}`,
    });
    evidence.push(groupEvidence);
    featureGroup = {
      key: stableKey("group", selected.symbol.name),
      name: humanName(selected.symbol.name),
      description: "Candidate product grouping inferred from an observed documentation heading; repository layout was not used as product taxonomy.",
      parentFeatureGroupKeys: [],
    };
    candidates.push(candidateArtifact({
      kind: "FeatureGroup",
      entity: featureGroup,
      evidenceIds: [groupEvidence.evidenceId],
      explanation: "A repository document heading is product-language evidence, but remains a candidate until user review.",
      confidence: 0.6,
      sourceSnapshotId,
      origin: "repository-documentation-heuristic",
    }));
  } else {
    const hash = onboardingDigest(onboardingCanonicalJson({ sourceSnapshotId, kind: "feature-group-taxonomy" }));
    unknowns.push({
      unknownId: `onboarding-unknown-${hash.slice(0, 24)}`,
      statement: "Observed implementation evidence does not justify a FeatureGroup taxonomy; directory structure was intentionally not promoted into product meaning.",
      evidenceIds: [],
      status: "open",
    });
  }

  const symbols = worldModel.files.flatMap((file) => (
    ["source", "test"].includes(file.classification)
      ? file.symbols.filter((symbol) => symbol.kind !== "heading" && !symbol.name.startsWith("_")).map((symbol) => ({ file, symbol }))
      : []
  )).map((item) => ({ ...item, productScore: productSymbolScore(item) }))
    .sort((left, right) => right.productScore - left.productScore
      || compareText(left.symbol.name, right.symbol.name)
      || compareText(left.file.path, right.file.path)
      || left.symbol.line - right.symbol.line);
  const selectedSymbols = [];
  const seenNames = new Set();
  for (const item of symbols) {
    const normalizedName = item.symbol.name.toLowerCase();
    if (seenNames.has(normalizedName)) continue;
    seenNames.add(normalizedName);
    selectedSymbols.push(item);
    if (selectedSymbols.length >= MAX_INFERRED_SYMBOLS) break;
  }
  for (const { file, symbol, productScore } of selectedSymbols) {
    const testEvidence = file.classification === "test";
    const symbolEvidence = evidenceRecord({
      sourceKind: testEvidence ? "repository-test-symbol" : "repository-symbol",
      sourceId: sourceSnapshotId,
      path: file.path,
      line: symbol.line,
      contentDigest: file.digest,
      statement: `Observed ${testEvidence ? "test " : ""}${symbol.kind} symbol ${symbol.name} may represent a product-visible behavior.`,
    });
    evidence.push(symbolEvidence);
    const name = humanName(symbol.name);
    const capabilityKey = stableKey("capability", symbol.name);
    candidates.push(candidateArtifact({
      kind: "Capability",
      entity: { key: capabilityKey, name, description: `Candidate capability inferred from observed ${testEvidence ? "test " : ""}${symbol.kind} symbol ${symbol.name}.` },
      evidenceIds: [symbolEvidence.evidenceId],
      explanation: "A deterministically ranked public implementation symbol is evidence of behavior, not proof of approved product intent.",
      confidence: testEvidence ? 0.45 : Math.min(0.7, 0.5 + Math.max(0, productScore) / 200),
      sourceSnapshotId,
      origin: testEvidence ? "repository-test-symbol-heuristic" : "repository-symbol-heuristic",
    }));
    candidates.push(candidateArtifact({
      kind: "Feature",
      entity: {
        key: stableKey("feature", symbol.name),
        name,
        description: `Candidate feature inferred from observed ${testEvidence ? "test " : ""}${symbol.kind} symbol ${symbol.name}.`,
        featureGroupKeys: featureGroup ? [featureGroup.key] : [],
        capabilityKeys: [capabilityKey],
        governedBy: [],
      },
      evidenceIds: [symbolEvidence.evidenceId],
      explanation: "Deterministically ranked implementation behavior can propose a Feature, but only onboarding review can adopt it as Product Canon.",
      confidence: testEvidence ? 0.4 : Math.min(0.65, 0.45 + Math.max(0, productScore) / 200),
      sourceSnapshotId,
      origin: testEvidence ? "repository-test-symbol-heuristic" : "repository-symbol-heuristic",
    }));
  }
  if (!selectedSymbols.length) {
    const hash = onboardingDigest(onboardingCanonicalJson({ sourceSnapshotId, kind: "product-behavior" }));
    unknowns.push({
      unknownId: `onboarding-unknown-${hash.slice(0, 24)}`,
      statement: "No supported source symbol currently provides enough evidence to propose a Capability or Feature.",
      evidenceIds: [],
      status: "open",
    });
  }
  if (symbols.length > selectedSymbols.length) {
    const hash = onboardingDigest(onboardingCanonicalJson({ sourceSnapshotId, kind: "candidate-bound", total: symbols.length, selected: selectedSymbols.length }));
    unknowns.push({
      unknownId: `onboarding-unknown-${hash.slice(0, 24)}`,
      statement: `Candidate inference was bounded to ${MAX_INFERRED_SYMBOLS} unique symbols; ${symbols.length - selectedSymbols.length} additional observations were excluded from this review set.`,
      evidenceIds: [],
      status: "open",
    });
  }
  return { candidates, evidence, unknowns };
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

function mergeCandidateSources(inferred, fromBrief) {
  const candidates = new Map();
  for (const candidate of inferred.candidates) candidates.set(`${candidate.productKind}:${candidate.proposedEntity.key}`, candidate);
  for (const candidate of fromBrief.candidates) candidates.set(`${candidate.productKind}:${candidate.proposedEntity.key}`, candidate);
  const evidence = new Map();
  for (const record of [...inferred.evidence, ...fromBrief.evidence]) evidence.set(record.evidenceId, record);
  const usedEvidence = new Set([...candidates.values()].flatMap((candidate) => candidate.evidenceIds));
  return {
    candidates: [...candidates.values()],
    evidence: [...evidence.values()].filter((record) => usedEvidence.has(record.evidenceId)),
    unknowns: inferred.unknowns,
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

export async function startOnboarding({ root = ".", mode = "existing", storage = null, brief = null, sourceScope = null } = {}) {
  const inspected = readyProject(root, "onboarding start");
  if (inspected.state.activeRunId || inspected.state.pendingReview) {
    fail("Onboarding cannot change product authority while a Run is active or awaiting review.", "ONBOARDING_RUN_CONFLICT");
  }
  const projectRoot = inspected.project.projectRoot;
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
      reviewDecisionId: null,
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
  const inferred = inferRepositoryCandidates(world.snapshot);
  const briefCandidates = candidatesFromBrief(briefInput, world.snapshot.temporalProvenanceGraph.sourceSnapshotId);
  const merged = mergeCandidateSources(inferred, briefCandidates);
  const candidateSet = buildCandidateSet({
    projectId: inspected.project.projectId,
    sessionId: inspected.state.sessionId,
    inputMode,
    storageSelectionId: normalizedStorage.storageSelectionId,
    worldModel: world.snapshot,
    candidates: merged.candidates,
    evidence: merged.evidence,
    unknowns: merged.unknowns,
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
    reviewDecisionId: null,
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
    reviewDecisionId: reviewDecision.reviewDecisionId,
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

function restoreAfterPromotionFailure({ projectRoot, previousCanonExisted, previousCanonBytes, previousPointer }) {
  const canonFile = relativeFile(projectRoot, PRODUCT_MODEL_RELATIVE_PATH);
  if (previousCanonExisted) atomicWrite(canonFile, previousCanonBytes);
  else if (fs.existsSync(canonFile)) fs.unlinkSync(canonFile);
  if (previousPointer) atomicWrite(previousPointer.pointerFile, json(previousPointer.pointer));
}

export async function reviewOnboarding({
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
  if (candidateSet.sourceSnapshotId !== state.sourceSnapshotId) {
    fail("Onboarding candidate set no longer matches the recorded source snapshot.", "ONBOARDING_SOURCE_SNAPSHOT_CONFLICT");
  }
  const currentWorld = inspectWorldModel({ root: projectRoot });
  if (currentWorld.status !== "current"
    || currentWorld.snapshot.temporalProvenanceGraph.sourceSnapshotId !== candidateSet.sourceSnapshotId) {
    fail("Observed project state changed after candidate inference; re-index and create a new candidate set.", "ONBOARDING_SOURCE_DRIFT");
  }
  const normalizedDisposition = requiredText(disposition, "Review disposition").toLowerCase();
  if (!new Set(["accept-all", "accept-selection", "revise", "reject"]).has(normalizedDisposition)) {
    fail("Onboarding ReviewDecision disposition is invalid.", "INVALID_ONBOARDING_REVIEW_DISPOSITION");
  }
  const currentCanon = readProductModelCanon({ projectRoot });
  if (currentCanon.model.productModelId !== candidateSet.productModelId || currentCanon.model.productModelId !== state.productModelId) {
    fail("Product Canon changed after candidate inference; a new onboarding candidate set is required.", "ONBOARDING_PRODUCT_CANON_DRIFT");
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
      reviewDecisionId: review.reviewDecisionId,
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
      reviewDecisionId: review.reviewDecisionId,
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
  const previousWorld = readWorldModel({ root: projectRoot });
  const previousProductRevision = productModelRevisionDocument(currentCanon.model);
  const resultingProductRevision = productModelRevisionDocument(nextModel);
  const canonFile = relativeFile(projectRoot, PRODUCT_MODEL_RELATIVE_PATH);
  const previousCanonExisted = fs.existsSync(canonFile);
  const previousCanonBytes = previousCanonExisted ? fs.readFileSync(canonFile, "utf8") : "";
  let promoted = false;
  try {
    atomicWrite(canonFile, json(productModelDocument(nextModel)));
    promoted = true;
    const rebuilt = await rebuildWithOnboardingProjection({
      projectRoot,
      projectId: inspected.project.projectId,
      currentProductModelId: nextModel.productModelId,
      sourceWorld: previousWorld,
      additionalReviewDecisions: [review],
      additionalProductModelRevisions: [previousProductRevision, resultingProductRevision],
      parentSourceSnapshotIds: [candidateSet.sourceSnapshotId],
      revisionParentIds: {},
    });
    persistProductRevision(projectRoot, currentCanon.model);
    persistProductRevision(projectRoot, nextModel);
    persistImmutable(reviewDecisionFile(projectRoot, review.reviewDecisionId), review, "Onboarding ReviewDecision");
    const verifiedWorld = inspectWorldModel({ root: projectRoot });
    if (verifiedWorld.status !== "current"
      || rebuilt.snapshot.productModel.productModelId !== nextModel.productModelId
      || rebuilt.snapshot.temporalProvenanceGraph.productModelId !== nextModel.productModelId
      || !rebuilt.snapshot.temporalProvenanceGraph.parentSourceSnapshotIds.includes(candidateSet.sourceSnapshotId)
      || !rebuilt.snapshot.temporalProvenanceGraph.onboardingProjection.reviewDecisionIds.includes(review.reviewDecisionId)
      || !rebuilt.snapshot.temporalProvenanceGraph.onboardingProjection.productModelRevisionIds.includes(nextModel.productModelId)) {
      fail("Promoted Product Canon did not produce the expected verified GraphSnapshot.", "ONBOARDING_GRAPH_VERIFICATION_FAILED");
    }
    const nextState = writeState(projectRoot, state, {
      phase: "ready",
      worldModelId: rebuilt.snapshot.worldModelId,
      sourceSnapshotId: rebuilt.snapshot.temporalProvenanceGraph.sourceSnapshotId,
      reviewDecisionId: review.reviewDecisionId,
      productModelId: nextModel.productModelId,
      previousProductModelId: currentCanon.model.productModelId,
    });
    return {
      status: "onboarding_ready",
      state: nextState,
      reviewDecision: review,
      productModel: nextModel,
      worldModel: {
        worldModelId: rebuilt.snapshot.worldModelId,
        sourceSnapshotId: rebuilt.snapshot.temporalProvenanceGraph.sourceSnapshotId,
        graphSnapshotId: rebuilt.snapshot.temporalProvenanceGraph.graphSnapshotId,
      },
    };
  } catch (error) {
    if (promoted) restoreAfterPromotionFailure({ projectRoot, previousCanonExisted, previousCanonBytes, previousPointer: previousWorld });
    throw error;
  }
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
  const reviewDecision = state.reviewDecisionId
    ? readOnboardingReviewDecision({ root: projectRoot, reviewDecisionId: state.reviewDecisionId }).reviewDecision
    : null;
  const productCanon = readProductModelCanon({ projectRoot });
  if (candidateSet?.reviewDecisionId && candidateSet.reviewDecisionId !== state.reviewDecisionId) {
    fail("Onboarding successor candidate set does not match its recorded ReviewDecision.", "ONBOARDING_REVIEW_CONFLICT");
  }
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
