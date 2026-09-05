import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { inspectProject, SCHEMA_VERSION } from "./head-core.mjs";
import { readChangeSet } from "./change-set.mjs";
import { readLineageArtifact } from "./execution-lineage.mjs";
import { readProductModelCanon } from "./product-model.mjs";
import { loadObservationArtifacts } from "./observation-store.mjs";

export const PRODUCT_OPERATING_LOOP_VERSION = "0.3.0";
export const PRODUCT_SIGNAL_DIRECTORY = ".head/product-operations/signals";
export const PRODUCT_HYPOTHESIS_DIRECTORY = ".head/product-operations/hypotheses";
export const PRODUCT_INITIATIVE_CANDIDATE_DIRECTORY = ".head/product-operations/initiative-candidates";
export const PRODUCT_INITIATIVE_REVIEW_DIRECTORY = ".head/product-operations/initiative-reviews";
export const REVIEWED_PRODUCT_INITIATIVE_DIRECTORY = ".head/product-operations/reviewed-initiatives";
export const PRODUCT_FEATURE_CANDIDATE_DIRECTORY = ".head/product-operations/feature-candidates";
export const OUTCOME_OBSERVATION_DIRECTORY = ".head/product-operations/outcome-observations";

const DIRECTORIES = Object.freeze({
  signals: PRODUCT_SIGNAL_DIRECTORY,
  hypotheses: PRODUCT_HYPOTHESIS_DIRECTORY,
  initiativeCandidates: PRODUCT_INITIATIVE_CANDIDATE_DIRECTORY,
  initiativeReviews: PRODUCT_INITIATIVE_REVIEW_DIRECTORY,
  reviewedInitiatives: REVIEWED_PRODUCT_INITIATIVE_DIRECTORY,
  featureCandidates: PRODUCT_FEATURE_CANDIDATE_DIRECTORY,
  outcomeObservations: OUTCOME_OBSERVATION_DIRECTORY,
});

const LIMITS = Object.freeze({ maxArtifacts: 512, maxArtifactBytes: 1024 * 1024, maxTotalBytes: 32 * 1024 * 1024 });
const LEGACY_PROTOCOL_VERSIONS = new Set(["0.1.0", "0.2.0"]);
const projectionReadCache = new Map();
const worldSummaryReadCache = new Map();
const fail = (message, code = "PRODUCT_OPERATING_LOOP_ERROR") => { const error = new Error(message); error.code = code; throw error; };
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

export function productOperatingCanonicalJson(value) { return JSON.stringify(canonical(value)); }
export function productOperatingDigest(value) { return crypto.createHash("sha256").update(value).digest("hex"); }

function supportedProtocolVersion(value) {
  return value === PRODUCT_OPERATING_LOOP_VERSION || LEGACY_PROTOCOL_VERSIONS.has(value);
}

function cacheRoot(root) { return path.resolve(root); }

export function invalidateProductOperatingReadCache(root = ".") {
  const key = cacheRoot(root);
  projectionReadCache.delete(key);
  worldSummaryReadCache.delete(key);
}

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) fail(`${label} is required.`, "INVALID_PRODUCT_OPERATING_INPUT");
  return value.trim();
}

function optionalText(value, label) {
  if (value == null) return "";
  if (typeof value !== "string") fail(`${label} must be a string.`, "INVALID_PRODUCT_OPERATING_INPUT");
  return value.trim();
}

function stableKey(value, label) {
  const normalized = requiredText(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(normalized)) fail(`${label} is not a stable key.`, "INVALID_PRODUCT_OPERATING_KEY");
  return normalized;
}

function sortedIds(values, label) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !value.trim())) fail(`${label} must be an array of identities.`, "INVALID_PRODUCT_OPERATING_INPUT");
  return [...new Set(values.map((value) => value.trim()))].sort();
}

function readyProject(root, action) {
  const inspected = inspectProject(root);
  if (inspected.status !== "ready") fail(`Project must be ready for ${action}; current status: ${inspected.status}.`, "PROJECT_NOT_READY");
  return inspected;
}

export function prepareProductLearningNote({
  root = ".",
  statement,
  epistemicClass,
  source = "",
  rationale = "",
  evidenceIds = [],
  referencedByAnotherRun = false,
  needsRebuttal = false,
  affectsProductState = false,
  handoff = false,
} = {}) {
  const inspected = readyProject(root, "a non-persisted product learning note is prepared");
  if (!["observed-fact", "hypothesis", "inferred-meaning"].includes(epistemicClass)) fail("Product learning note epistemicClass must be observed-fact, hypothesis, or inferred-meaning.", "INVALID_PRODUCT_LEARNING_NOTE");
  for (const [label, value] of Object.entries({ referencedByAnotherRun, needsRebuttal, affectsProductState, handoff })) {
    if (typeof value !== "boolean") fail(`Product learning note ${label} must be a boolean.`, "INVALID_PRODUCT_LEARNING_NOTE");
  }
  const persistenceReasons = [
    referencedByAnotherRun && "referenced-by-another-run",
    needsRebuttal && "rebuttal-or-audit-needed",
    affectsProductState && "affects-product-state",
    handoff && "handoff-or-context-loss",
  ].filter(Boolean).sort();
  return {
    status: "ephemeral",
    note: {
      kind: "ProductLearningNote",
      projectId: inspected.project.projectId,
      sessionId: inspected.state.sessionId,
      statement: requiredText(statement, "Product learning note statement"),
      epistemicClass,
      source: optionalText(source, "Product learning note source"),
      rationale: optionalText(rationale, "Product learning note rationale"),
      evidenceIds: sortedIds(evidenceIds, "Product learning note evidenceIds"),
      authority: epistemicClass === "observed-fact" ? "non-authoritative-observation" : epistemicClass === "hypothesis" ? "non-authoritative-hypothesis" : "non-authoritative-inferred-meaning",
      persisted: false,
      contentIdentityAssigned: false,
      instructionAuthority: false,
      promotionAuthority: false,
    },
    persistence: {
      recommended: persistenceReasons.length > 0,
      reasons: persistenceReasons,
      rule: "persist-only-at-handoff-audit-product-state-or-cross-run-boundaries",
    },
  };
}

function safeDirectory(projectRoot, relative) {
  const root = path.resolve(projectRoot);
  const directory = path.resolve(root, ...relative.split("/"));
  const fromRoot = path.relative(root, directory);
  if (fromRoot === ".." || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) fail("Product operating path escapes project root.", "PRODUCT_OPERATING_PATH_ESCAPE");
  let current = root;
  for (const segment of fromRoot.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) fail("Product operating path traverses a symlink.", "PRODUCT_OPERATING_SYMLINK_PATH");
  }
  return directory;
}

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
  try { fs.writeFileSync(temporary, content, { encoding: "utf8", flag: "wx" }); fs.renameSync(temporary, file); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

function persistImmutable(projectRoot, relative, id, document) {
  const file = path.join(safeDirectory(projectRoot, relative), `${id}.json`);
  if (fs.existsSync(file)) {
    const existing = JSON.parse(fs.readFileSync(file, "utf8"));
    if (productOperatingCanonicalJson(existing) !== productOperatingCanonicalJson(document)) fail(`Immutable identity collision: ${id}`, "PRODUCT_OPERATING_IMMUTABLE_COLLISION");
    return { status: "existing", file };
  }
  atomicWrite(file, json(document));
  invalidateProductOperatingReadCache(projectRoot);
  return { status: "recorded", file };
}

function artifact(payload, prefix, idField, hashField) {
  const hash = productOperatingDigest(productOperatingCanonicalJson(payload));
  return { ...payload, [idField]: `${prefix}-${hash.slice(0, 24)}`, [hashField]: hash };
}

function verifyIdentity(document, prefix, idField, hashField, label) {
  if (!document || typeof document !== "object" || Array.isArray(document)) fail(`${label} is invalid.`, "INVALID_PRODUCT_OPERATING_ARTIFACT");
  const payload = { ...document }; delete payload[idField]; delete payload[hashField];
  const hash = productOperatingDigest(productOperatingCanonicalJson(payload));
  if (document[hashField] !== hash || document[idField] !== `${prefix}-${hash.slice(0, 24)}`) fail(`${label} digest verification failed.`, "PRODUCT_OPERATING_DIGEST_MISMATCH");
  return document;
}

function commonValid(document, kind, projectId, epistemicClass, authority) {
  return document.schemaVersion === SCHEMA_VERSION && document.kind === kind
    && document.protocol?.name === "head-agent-core-product-operating-loop" && supportedProtocolVersion(document.protocol?.version)
    && (!projectId || document.projectId === projectId) && document.epistemicClass === epistemicClass
    && document.authority === authority && document.instructionAuthority === false && document.promotionAuthority === false;
}

export function verifyProductSignal(document, projectId = "") {
  verifyIdentity(document, "product-signal", "signalId", "signalHash", "ProductSignal");
  if (!commonValid(document, "ProductSignal", projectId, "observed-fact", "non-authoritative-observation")
    || typeof document.statement !== "string" || !document.statement || typeof document.observedAt !== "string" || Number.isNaN(Date.parse(document.observedAt))) fail("ProductSignal fields are invalid.", "INVALID_PRODUCT_SIGNAL");
  sortedIds(document.evidenceIds, "ProductSignal evidenceIds");
  return document;
}

export function verifyProductHypothesis(document, projectId = "") {
  verifyIdentity(document, "product-hypothesis", "hypothesisId", "hypothesisHash", "ProductHypothesis");
  const signalIds = sortedIds(document.signalIds || [], "ProductHypothesis signalIds");
  const observationIds = sortedIds(document.observationIds || [], "ProductHypothesis observationIds");
  if (!commonValid(document, "ProductHypothesis", projectId, "hypothesis", "non-authoritative-hypothesis")
    || typeof document.statement !== "string" || !document.statement || !signalIds.length && !observationIds.length
    || observationIds.some((id) => !/^(?:observation|derived-observation)-[a-f0-9]{24}$/.test(id))) fail("ProductHypothesis fields are invalid.", "INVALID_PRODUCT_HYPOTHESIS");
  if (document.protocol.version !== PRODUCT_OPERATING_LOOP_VERSION && document.observationIds != null) fail("Legacy ProductHypothesis may not gain Observation references.", "INVALID_PRODUCT_HYPOTHESIS");
  return document;
}

function verifyFeatureResolution(resolution) {
  if (!resolution || typeof resolution !== "object" || !["existing-feature", "candidate", "gap"].includes(resolution.kind)) fail("Feature resolution is invalid.", "INVALID_FEATURE_RESOLUTION");
  if (resolution.kind === "existing-feature" && (!resolution.featureKey || !resolution.productModelId)) fail("Existing Feature resolution is incomplete.", "INVALID_FEATURE_RESOLUTION");
  if (resolution.kind === "candidate" && !/^product-feature-candidate-[a-f0-9]{24}$/.test(resolution.featureCandidateId || "")) fail("Feature candidate resolution is incomplete.", "INVALID_FEATURE_RESOLUTION");
  if (resolution.kind === "gap" && !resolution.reason) fail("Feature gap requires a reason.", "INVALID_FEATURE_RESOLUTION");
  return resolution;
}

export function verifyProductFeatureCandidate(document, projectId = "") {
  verifyIdentity(document, "product-feature-candidate", "featureCandidateId", "featureCandidateHash", "ProductFeatureCandidate");
  if (!commonValid(document, "ProductFeatureCandidate", projectId, "inferred-meaning", "candidate-not-product-canon")
    || !/^[a-f0-9]{64}$/.test(document.initiativeCandidateSeed || "") || !document.feature?.key || !document.feature?.name) fail("ProductFeatureCandidate fields are invalid.", "INVALID_PRODUCT_FEATURE_CANDIDATE");
  sortedIds(document.feature.capabilityKeys, "Feature candidate capabilityKeys");
  return document;
}

export function verifyProductInitiativeCandidate(document, projectId = "") {
  verifyIdentity(document, "product-initiative-candidate", "initiativeCandidateId", "initiativeCandidateHash", "ProductInitiativeCandidate");
  if (!commonValid(document, "ProductInitiativeCandidate", projectId, "inferred-meaning", "candidate-not-approved-decision")
    || !document.title || !Array.isArray(document.hypothesisIds)
    || (!document.hypothesisIds.length && !(typeof document.reasoning === "string" && document.reasoning))) fail("ProductInitiativeCandidate fields are invalid.", "INVALID_PRODUCT_INITIATIVE_CANDIDATE");
  sortedIds(document.hypothesisIds, "Initiative hypothesisIds");
  if (document.featureResolution != null) verifyFeatureResolution(document.featureResolution);
  return document;
}

export function verifyProductInitiativeReviewDecision(document, projectId = "") {
  verifyIdentity(document, "product-initiative-review", "reviewDecisionId", "reviewDecisionHash", "Product Initiative ReviewDecision");
  if (document.schemaVersion !== SCHEMA_VERSION || document.kind !== "ReviewDecision" || document.protocol?.name !== "head-agent-core-product-initiative-review"
    || !supportedProtocolVersion(document.protocol?.version) || (!projectId || document.projectId === projectId) === false
    || document.decisionScope !== "product-initiative" || !["accept", "reject"].includes(document.disposition) || !document.rationale
    || document.authority !== "explicit-user-product-initiative-review" || document.instructionAuthority !== true
    || document.promotionAuthority !== (document.disposition === "accept")) fail("Product Initiative ReviewDecision fields are invalid.", "INVALID_PRODUCT_INITIATIVE_REVIEW");
  return document;
}

export function verifyReviewedProductInitiative(document, projectId = "") {
  verifyIdentity(document, "reviewed-product-initiative", "initiativeId", "initiativeHash", "ReviewedProductInitiative");
  if (!commonValid(document, "ReviewedProductInitiative", projectId, "approved-decision", "reviewed-product-initiative-not-product-canon")
    || !document.initiativeCandidateId || !document.reviewDecisionId || !document.title || !Array.isArray(document.hypothesisIds)) fail("ReviewedProductInitiative fields are invalid.", "INVALID_REVIEWED_PRODUCT_INITIATIVE");
  verifyFeatureResolution(document.featureResolution);
  return document;
}

export function verifyOutcomeObservation(document, projectId = "") {
  verifyIdentity(document, "outcome-observation", "outcomeObservationId", "outcomeObservationHash", "OutcomeObservation");
  if (!commonValid(document, "OutcomeObservation", projectId, document.epistemicClass, "non-authoritative-outcome-evidence")
    || !["observed-fact", "derived-projection"].includes(document.epistemicClass) || !document.statement
    || !document.changeSetId || !document.resultPacketId || !document.executionReviewDecisionId) fail("OutcomeObservation fields are invalid.", "INVALID_OUTCOME_OBSERVATION");
  sortedIds(document.evidenceIds, "OutcomeObservation evidenceIds");
  return document;
}

function readArtifacts(projectRoot, relative, limit = LIMITS.maxArtifacts) {
  const directory = safeDirectory(projectRoot, relative);
  if (!fs.existsSync(directory)) return [];
  const files = fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => path.join(directory, entry.name)).sort();
  if (files.length > limit) fail("Product operating artifact count exceeds its bound.", "PRODUCT_OPERATING_LIMIT");
  let bytes = 0;
  return files.map((file) => {
    const size = fs.statSync(file).size; bytes += size;
    if (size > LIMITS.maxArtifactBytes || bytes > LIMITS.maxTotalBytes) fail("Product operating artifacts exceed their byte bound.", "PRODUCT_OPERATING_LIMIT");
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { fail(`Product operating artifact is invalid JSON: ${error.message}`, "INVALID_PRODUCT_OPERATING_ARTIFACT"); }
  });
}

export function verifyProductOperatingProjectionInput(projection) {
  if (!projection || projection.kind !== "ProductOperatingProjectionInput"
    || projection.protocol?.name !== "head-agent-core-product-operating-projection"
    || !supportedProtocolVersion(projection.protocol?.version)
    || typeof projection.projectId !== "string" || !projection.projectId
    || projection.authority !== "derived-product-graph-input-not-product-or-execution-canon"
    || projection.instructionAuthority !== false || projection.promotionAuthority !== false) {
    fail("Product operating projection input is invalid.", "INVALID_PRODUCT_OPERATING_PROJECTION");
  }
  for (const field of Object.keys(DIRECTORIES)) if (!Array.isArray(projection[field])) fail(`Product operating projection ${field} is invalid.`, "INVALID_PRODUCT_OPERATING_PROJECTION");
  const payload = { ...projection }; delete payload.projectionInputId; delete payload.projectionInputHash;
  const hash = productOperatingDigest(productOperatingCanonicalJson(payload));
  if (projection.projectionInputHash !== hash || projection.projectionInputId !== `product-operating-projection-${hash.slice(0, 24)}`) {
    fail("Product operating projection digest verification failed.", "PRODUCT_OPERATING_PROJECTION_DIGEST_MISMATCH");
  }
  return projection;
}

export function loadProductOperatingProjection({ projectRoot, projectId } = {}) {
  const arrays = Object.fromEntries(Object.entries(DIRECTORIES).map(([key, relative]) => [key, readArtifacts(projectRoot, relative)]));
  const validators = {
    signals: verifyProductSignal, hypotheses: verifyProductHypothesis, initiativeCandidates: verifyProductInitiativeCandidate,
    initiativeReviews: verifyProductInitiativeReviewDecision, reviewedInitiatives: verifyReviewedProductInitiative,
    featureCandidates: verifyProductFeatureCandidate, outcomeObservations: verifyOutcomeObservation,
  };
  for (const [key, values] of Object.entries(arrays)) for (const value of values) validators[key](value, projectId);
  const by = (values, field) => new Map(values.map((value) => [value[field], value]));
  const signals = by(arrays.signals, "signalId");
  const hypotheses = by(arrays.hypotheses, "hypothesisId");
  const initiatives = by(arrays.initiativeCandidates, "initiativeCandidateId");
  const featureCandidates = by(arrays.featureCandidates, "featureCandidateId");
  const reviews = by(arrays.initiativeReviews, "reviewDecisionId");
  const reviewedInitiatives = by(arrays.reviewedInitiatives, "initiativeId");
  const referencedObservationIds = new Set(arrays.hypotheses.flatMap((hypothesis) => hypothesis.observationIds || []));
  const observationIds = new Set();
  if (referencedObservationIds.size) {
    const observationArtifacts = loadObservationArtifacts({ projectRoot, projectId });
    for (const item of observationArtifacts.observations) observationIds.add(item.observationId);
    for (const item of observationArtifacts.derivedObservations) observationIds.add(item.derivedObservationId);
  }
  const changes = new Map(readArtifacts(projectRoot, ".head/change-sets/records").map((value) => [value.changeSetId, value]));
  for (const hypothesis of arrays.hypotheses) if (hypothesis.signalIds.some((id) => !signals.has(id))) fail("ProductHypothesis references an unknown ProductSignal.", "UNKNOWN_PRODUCT_SIGNAL");
  for (const hypothesis of arrays.hypotheses) if ((hypothesis.observationIds || []).some((id) => !observationIds.has(id))) fail("ProductHypothesis references an unknown Observation.", "UNKNOWN_OBSERVATION");
  for (const initiative of arrays.initiativeCandidates) {
    if (initiative.hypothesisIds.some((id) => !hypotheses.has(id))) fail("ProductInitiativeCandidate references an unknown ProductHypothesis.", "UNKNOWN_PRODUCT_HYPOTHESIS");
    if (initiative.featureResolution?.kind === "candidate") {
      const featureCandidate = featureCandidates.get(initiative.featureResolution.featureCandidateId);
      if (!featureCandidate) fail("ProductInitiativeCandidate references an unknown ProductFeatureCandidate.", "UNKNOWN_PRODUCT_FEATURE_CANDIDATE");
      const seedInput = { projectId: initiative.projectId, title: initiative.title, description: initiative.description, hypothesisIds: initiative.hypothesisIds };
      if (initiative.protocol?.version !== "0.1.0") seedInput.reasoning = initiative.reasoning || "";
      const expectedSeed = productOperatingDigest(productOperatingCanonicalJson(seedInput));
      if (featureCandidate.initiativeCandidateSeed !== expectedSeed) fail("ProductFeatureCandidate seed does not match its ProductInitiativeCandidate.", "PRODUCT_FEATURE_CANDIDATE_SEED_MISMATCH");
    }
  }
  const reviewedCandidateIds = new Set();
  for (const review of arrays.initiativeReviews) {
    if (!initiatives.has(review.initiativeCandidateId)) fail("Product Initiative review references an unknown candidate.", "UNKNOWN_PRODUCT_INITIATIVE_CANDIDATE");
    if (reviewedCandidateIds.has(review.initiativeCandidateId)) fail("Product Initiative candidate has conflicting ReviewDecisions.", "PRODUCT_INITIATIVE_ALREADY_REVIEWED");
    reviewedCandidateIds.add(review.initiativeCandidateId);
  }
  for (const reviewed of arrays.reviewedInitiatives) {
    const review = reviews.get(reviewed.reviewDecisionId);
    if (!review || review.disposition !== "accept" || review.initiativeCandidateId !== reviewed.initiativeCandidateId) fail("ReviewedProductInitiative lacks its accepting ReviewDecision.", "INVALID_REVIEWED_PRODUCT_INITIATIVE_LINEAGE");
    const candidate = initiatives.get(reviewed.initiativeCandidateId);
    const reviewedMeaning = { title: reviewed.title, description: reviewed.description, reasoning: reviewed.reasoning || "", hypothesisIds: reviewed.hypothesisIds };
    const candidateMeaning = { title: candidate?.title, description: candidate?.description, reasoning: candidate?.reasoning || "", hypothesisIds: candidate?.hypothesisIds };
    if (!candidate || productOperatingCanonicalJson(reviewedMeaning) !== productOperatingCanonicalJson(candidateMeaning)
      || (candidate.featureResolution != null && productOperatingCanonicalJson(reviewed.featureResolution) !== productOperatingCanonicalJson(candidate.featureResolution))) {
      fail("ReviewedProductInitiative rewrites its immutable candidate.", "REVIEWED_PRODUCT_INITIATIVE_CANDIDATE_MISMATCH");
    }
    if (reviewed.featureResolution.kind === "candidate") {
      const featureCandidate = featureCandidates.get(reviewed.featureResolution.featureCandidateId);
      if (!featureCandidate) fail("ReviewedProductInitiative references an unknown ProductFeatureCandidate.", "UNKNOWN_PRODUCT_FEATURE_CANDIDATE");
      const seedInput = { projectId: candidate.projectId, title: candidate.title, description: candidate.description, hypothesisIds: candidate.hypothesisIds };
      if (candidate.protocol?.version !== "0.1.0") seedInput.reasoning = candidate.reasoning || "";
      const expectedSeed = productOperatingDigest(productOperatingCanonicalJson(seedInput));
      if (featureCandidate.initiativeCandidateSeed !== expectedSeed) fail("Reviewed ProductFeatureCandidate seed does not match its ProductInitiativeCandidate.", "PRODUCT_FEATURE_CANDIDATE_SEED_MISMATCH");
    }
  }
  for (const outcome of arrays.outcomeObservations) {
    const changeSet = changes.get(outcome.changeSetId);
    if (!changeSet) fail("OutcomeObservation references an unknown ChangeSet.", "UNKNOWN_CHANGE_SET");
    if (outcome.resultPacketId !== changeSet.resultPacketId || outcome.executionReviewDecisionId !== changeSet.reviewDecisionId) fail("OutcomeObservation does not match its ChangeSet execution lineage.", "OUTCOME_CHANGE_SET_LINEAGE_MISMATCH");
    if (outcome.initiativeId && !reviewedInitiatives.has(outcome.initiativeId)) fail("OutcomeObservation references an unknown ReviewedProductInitiative.", "UNKNOWN_REVIEWED_PRODUCT_INITIATIVE");
  }
  const idFields = { signals: "signalId", hypotheses: "hypothesisId", initiativeCandidates: "initiativeCandidateId", initiativeReviews: "reviewDecisionId", reviewedInitiatives: "initiativeId", featureCandidates: "featureCandidateId", outcomeObservations: "outcomeObservationId" };
  const payload = {
    schemaVersion: SCHEMA_VERSION, kind: "ProductOperatingProjectionInput",
    protocol: { name: "head-agent-core-product-operating-projection", version: PRODUCT_OPERATING_LOOP_VERSION },
    projectId, ...Object.fromEntries(Object.entries(arrays).map(([key, values]) => [key, values.sort((a, b) => a[idFields[key]].localeCompare(b[idFields[key]]))])),
    authority: "derived-product-graph-input-not-product-or-execution-canon", instructionAuthority: false, promotionAuthority: false,
  };
  const projectionInputHash = productOperatingDigest(productOperatingCanonicalJson(payload));
  return verifyProductOperatingProjectionInput({ ...payload, projectionInputId: `product-operating-projection-${projectionInputHash.slice(0, 24)}`, projectionInputHash });
}

function statToken(file) {
  const stat = fs.statSync(file, { bigint: true });
  return `${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
}

function productOperatingReadFingerprint(projectRoot) {
  const entries = [];
  for (const [kind, relative] of Object.entries(DIRECTORIES)) {
    const directory = safeDirectory(projectRoot, relative);
    if (!fs.existsSync(directory)) { entries.push(`${kind}:absent`); continue; }
    const files = fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name).sort();
    entries.push(`${kind}:${files.map((name) => `${name}:${statToken(path.join(directory, name))}`).join("|")}`);
  }
  return productOperatingDigest(entries.join("\n"));
}

function readProductOperatingProjection(inspected, { fresh = false } = {}) {
  const key = cacheRoot(inspected.project.projectRoot);
  const fingerprint = productOperatingReadFingerprint(inspected.project.projectRoot);
  const cached = projectionReadCache.get(key);
  if (!fresh && cached?.projectId === inspected.project.projectId && cached.fingerprint === fingerprint) {
    return { projection: cached.projection, verification: { mode: "cached-verified-snapshot", cacheKey: `${cached.projection.projectionInputId}:${fingerprint}`, writeInvalidates: true } };
  }
  const projection = loadProductOperatingProjection({ projectRoot: inspected.project.projectRoot, projectId: inspected.project.projectId });
  projectionReadCache.set(key, { projectId: inspected.project.projectId, fingerprint, projection });
  return { projection, verification: { mode: "fresh-full-verification", cacheKey: `${projection.projectionInputId}:${fingerprint}`, writeInvalidates: true } };
}

async function readWorldSummary(inspected, { fresh = false } = {}) {
  const key = cacheRoot(inspected.project.projectRoot);
  const pointerFile = path.join(inspected.project.projectRoot, ".head", "world-model", "current.json");
  if (!fs.existsSync(pointerFile)) {
    worldSummaryReadCache.delete(key);
    return { summary: null, verification: { mode: "not-built", cacheKey: null, writeInvalidates: true } };
  }
  const pointerRaw = fs.readFileSync(pointerFile, "utf8");
  let pointer;
  try { pointer = JSON.parse(pointerRaw); } catch { fail("World Model pointer is invalid JSON.", "INVALID_WORLD_MODEL_POINTER"); }
  const cached = worldSummaryReadCache.get(key);
  if (!fresh && cached?.pointerRaw === pointerRaw) {
    return { summary: cached.summary, verification: { mode: "cached-verified-snapshot", cacheKey: `${cached.summary.worldModelId}:${cached.summary.worldModelHash}`, writeInvalidates: true } };
  }
  const { readWorldModel } = await import("./world-model.mjs");
  const world = readWorldModel({ root: inspected.project.projectRoot }).snapshot;
  if (pointer.worldModelId !== world.worldModelId || pointer.worldModelHash !== world.worldModelHash) fail("World Model pointer changed during continuity read.", "WORLD_MODEL_POINTER_MISMATCH");
  const summary = {
    worldModelId: world.worldModelId,
    worldModelHash: world.worldModelHash,
    graphSnapshotId: world.temporalProvenanceGraph?.graphSnapshotId || null,
    graphSnapshotHash: world.temporalProvenanceGraph?.graphSnapshotHash || null,
    sourceSnapshotId: world.temporalProvenanceGraph?.sourceSnapshotId || null,
  };
  worldSummaryReadCache.set(key, { pointerRaw, summary });
  return { summary, verification: { mode: "fresh-full-verification", cacheKey: `${summary.worldModelId}:${summary.worldModelHash}`, writeInvalidates: true } };
}

function findById(projectRoot, relative, id, prefix, validator, projectId) {
  if (!new RegExp(`^${prefix}-[a-f0-9]{24}$`).test(id || "")) fail(`Invalid ${prefix} identity.`, "INVALID_PRODUCT_OPERATING_ID");
  const file = path.join(safeDirectory(projectRoot, relative), `${id}.json`);
  if (!fs.existsSync(file)) fail(`Product operating artifact not found: ${id}`, "PRODUCT_OPERATING_ARTIFACT_NOT_FOUND");
  return { file, artifact: validator(JSON.parse(fs.readFileSync(file, "utf8")), projectId) };
}

async function projectProductOperatingGraph(inspected) {
  const projection = loadProductOperatingProjection({ projectRoot: inspected.project.projectRoot, projectId: inspected.project.projectId });
  const { buildWorldModel } = await import("./world-model.mjs");
  const built = await buildWorldModel({ root: inspected.project.projectRoot, persist: true, productOperatingProjectionInput: projection });
  return { projectionInputId: projection.projectionInputId, worldModelId: built.snapshot.worldModelId, graphSnapshotId: built.snapshot.temporalProvenanceGraph.graphSnapshotId };
}

export async function recordProductSignal({ root = ".", statement, observedAt = new Date().toISOString(), evidenceIds = [], source = "" } = {}) {
  const inspected = readyProject(root, "a ProductSignal is recorded");
  const payload = { schemaVersion: SCHEMA_VERSION, kind: "ProductSignal", protocol: { name: "head-agent-core-product-operating-loop", version: PRODUCT_OPERATING_LOOP_VERSION }, projectId: inspected.project.projectId, statement: requiredText(statement, "ProductSignal statement"), observedAt: new Date(observedAt).toISOString(), source: optionalText(source, "ProductSignal source"), evidenceIds: sortedIds(evidenceIds, "ProductSignal evidenceIds"), epistemicClass: "observed-fact", authority: "non-authoritative-observation", instructionAuthority: false, promotionAuthority: false };
  const signal = verifyProductSignal(artifact(payload, "product-signal", "signalId", "signalHash"), inspected.project.projectId);
  const persisted = persistImmutable(inspected.project.projectRoot, PRODUCT_SIGNAL_DIRECTORY, signal.signalId, signal);
  return { ...persisted, signal, productGraph: await projectProductOperatingGraph(inspected) };
}

export async function recordProductHypothesis({ root = ".", statement, signalIds = [], observationIds = [], rationale = "" } = {}) {
  const inspected = readyProject(root, "a ProductHypothesis is recorded");
  const ids = sortedIds(signalIds, "ProductHypothesis signalIds");
  const exactObservationIds = sortedIds(observationIds, "ProductHypothesis observationIds");
  if (!ids.length && !exactObservationIds.length) fail("ProductHypothesis requires at least one ProductSignal or exact Observation.", "PRODUCT_HYPOTHESIS_EVIDENCE_REQUIRED");
  for (const id of ids) findById(inspected.project.projectRoot, PRODUCT_SIGNAL_DIRECTORY, id, "product-signal", verifyProductSignal, inspected.project.projectId);
  if (exactObservationIds.length) {
    const observationArtifacts = loadObservationArtifacts({ projectRoot: inspected.project.projectRoot, projectId: inspected.project.projectId });
    const knownObservationIds = new Set([
      ...observationArtifacts.observations.map((item) => item.observationId),
      ...observationArtifacts.derivedObservations.map((item) => item.derivedObservationId),
    ]);
    for (const id of exactObservationIds) if (!knownObservationIds.has(id)) fail(`ProductHypothesis Observation not found: ${id}`, "UNKNOWN_OBSERVATION");
  }
  const payload = { schemaVersion: SCHEMA_VERSION, kind: "ProductHypothesis", protocol: { name: "head-agent-core-product-operating-loop", version: PRODUCT_OPERATING_LOOP_VERSION }, projectId: inspected.project.projectId, statement: requiredText(statement, "ProductHypothesis statement"), rationale: optionalText(rationale, "ProductHypothesis rationale"), signalIds: ids, observationIds: exactObservationIds, epistemicClass: "hypothesis", authority: "non-authoritative-hypothesis", instructionAuthority: false, promotionAuthority: false };
  const hypothesis = verifyProductHypothesis(artifact(payload, "product-hypothesis", "hypothesisId", "hypothesisHash"), inspected.project.projectId);
  const persisted = persistImmutable(inspected.project.projectRoot, PRODUCT_HYPOTHESIS_DIRECTORY, hypothesis.hypothesisId, hypothesis);
  return { ...persisted, hypothesis, productGraph: await projectProductOperatingGraph(inspected) };
}

function resolveFeature(projectRoot, projectId, featureResolution, initiativeCandidateSeed) {
  if (!featureResolution || !["existing-feature", "candidate", "gap"].includes(featureResolution.kind)) fail("featureResolution.kind is required.", "INVALID_FEATURE_RESOLUTION");
  if (featureResolution.kind === "gap") return { resolution: { kind: "gap", reason: requiredText(featureResolution.reason, "Feature gap reason") }, featureCandidate: null };
  if (featureResolution.kind === "existing-feature") {
    const featureKey = stableKey(featureResolution.featureKey, "Existing Feature key");
    const product = readProductModelCanon({ projectRoot }).model;
    const feature = product.features.find((item) => item.key === featureKey);
    if (!feature) fail(`Existing Product Canon Feature not found: ${featureKey}`, "PRODUCT_FEATURE_NOT_FOUND");
    return { resolution: { kind: "existing-feature", featureKey, productModelId: product.productModelId }, featureCandidate: null };
  }
  const feature = featureResolution.feature;
  if (!feature || typeof feature !== "object") fail("Feature candidate body is required.", "INVALID_FEATURE_RESOLUTION");
  const normalized = { key: stableKey(feature.key, "Feature candidate key"), name: requiredText(feature.name, "Feature candidate name"), description: optionalText(feature.description, "Feature candidate description"), capabilityKeys: sortedIds(feature.capabilityKeys || [], "Feature candidate capabilityKeys") };
  const payload = { schemaVersion: SCHEMA_VERSION, kind: "ProductFeatureCandidate", protocol: { name: "head-agent-core-product-operating-loop", version: PRODUCT_OPERATING_LOOP_VERSION }, projectId, initiativeCandidateSeed, feature: normalized, epistemicClass: "inferred-meaning", authority: "candidate-not-product-canon", instructionAuthority: false, promotionAuthority: false };
  return { resolution: { kind: "candidate", pendingFeature: normalized }, featureCandidatePayload: payload };
}

export async function proposeProductInitiative({ root = ".", title, description = "", reasoning = "", hypothesisIds = [], featureResolution = null } = {}) {
  const inspected = readyProject(root, "a ProductInitiativeCandidate is proposed");
  const ids = sortedIds(hypothesisIds, "ProductInitiativeCandidate hypothesisIds");
  for (const id of ids) findById(inspected.project.projectRoot, PRODUCT_HYPOTHESIS_DIRECTORY, id, "product-hypothesis", verifyProductHypothesis, inspected.project.projectId);
  const normalizedTitle = requiredText(title, "ProductInitiativeCandidate title");
  const normalizedDescription = optionalText(description, "ProductInitiativeCandidate description");
  const normalizedReasoning = optionalText(reasoning, "ProductInitiativeCandidate reasoning");
  if (!ids.length && !normalizedReasoning) fail("ProductInitiativeCandidate requires ProductHypothesis identities or explicit inline reasoning.", "PRODUCT_INITIATIVE_REASONING_REQUIRED");
  const seed = productOperatingDigest(productOperatingCanonicalJson({ projectId: inspected.project.projectId, title: normalizedTitle, description: normalizedDescription, hypothesisIds: ids, reasoning: normalizedReasoning }));
  const resolved = featureResolution == null ? { resolution: null, featureCandidatePayload: null } : resolveFeature(inspected.project.projectRoot, inspected.project.projectId, featureResolution, seed);
  let featureCandidate = null;
  let resolution = resolved.resolution;
  if (resolved.featureCandidatePayload) {
    featureCandidate = verifyProductFeatureCandidate(artifact(resolved.featureCandidatePayload, "product-feature-candidate", "featureCandidateId", "featureCandidateHash"), inspected.project.projectId);
    resolution = { kind: "candidate", featureCandidateId: featureCandidate.featureCandidateId };
  }
  const payload = { schemaVersion: SCHEMA_VERSION, kind: "ProductInitiativeCandidate", protocol: { name: "head-agent-core-product-operating-loop", version: PRODUCT_OPERATING_LOOP_VERSION }, projectId: inspected.project.projectId, title: normalizedTitle, description: normalizedDescription, reasoning: normalizedReasoning, hypothesisIds: ids, featureResolution: resolution, epistemicClass: "inferred-meaning", authority: "candidate-not-approved-decision", instructionAuthority: false, promotionAuthority: false };
  const initiativeCandidate = verifyProductInitiativeCandidate(artifact(payload, "product-initiative-candidate", "initiativeCandidateId", "initiativeCandidateHash"), inspected.project.projectId);
  if (featureCandidate) {
    persistImmutable(inspected.project.projectRoot, PRODUCT_FEATURE_CANDIDATE_DIRECTORY, featureCandidate.featureCandidateId, featureCandidate);
  }
  const persisted = persistImmutable(inspected.project.projectRoot, PRODUCT_INITIATIVE_CANDIDATE_DIRECTORY, initiativeCandidate.initiativeCandidateId, initiativeCandidate);
  return { ...persisted, initiativeCandidate, featureCandidate, productGraph: await projectProductOperatingGraph(inspected) };
}

export async function reviewProductInitiative({ root = ".", initiativeCandidateId, disposition, rationale, featureResolution = null } = {}) {
  const inspected = readyProject(root, "a Product Initiative is reviewed");
  const candidate = findById(inspected.project.projectRoot, PRODUCT_INITIATIVE_CANDIDATE_DIRECTORY, initiativeCandidateId, "product-initiative-candidate", verifyProductInitiativeCandidate, inspected.project.projectId).artifact;
  const current = loadProductOperatingProjection({ projectRoot: inspected.project.projectRoot, projectId: inspected.project.projectId });
  if (current.initiativeReviews.some((review) => review.initiativeCandidateId === initiativeCandidateId)) fail("Product Initiative candidate already has a ReviewDecision.", "PRODUCT_INITIATIVE_ALREADY_REVIEWED");
  if (!["accept", "reject"].includes(disposition)) fail("Product Initiative review disposition must be accept or reject.", "INVALID_PRODUCT_INITIATIVE_REVIEW");
  if (disposition === "reject" && featureResolution != null) fail("A rejected Product Initiative cannot resolve a Feature.", "REJECTED_PRODUCT_INITIATIVE_FEATURE_RESOLUTION");
  if (candidate.featureResolution != null && featureResolution != null) fail("Review cannot replace the candidate's frozen Feature resolution.", "PRODUCT_INITIATIVE_FEATURE_RESOLUTION_ALREADY_FROZEN");
  let reviewedFeatureResolution = candidate.featureResolution;
  let featureCandidate = null;
  if (disposition === "accept" && reviewedFeatureResolution == null) {
    if (featureResolution == null) fail("Accepted Product Initiative review requires existing Feature, Feature candidate, or honest gap resolution.", "PRODUCT_INITIATIVE_REVIEW_FEATURE_RESOLUTION_REQUIRED");
    const seed = productOperatingDigest(productOperatingCanonicalJson({ projectId: candidate.projectId, title: candidate.title, description: candidate.description, hypothesisIds: candidate.hypothesisIds, reasoning: candidate.reasoning || "" }));
    const resolved = resolveFeature(inspected.project.projectRoot, inspected.project.projectId, featureResolution, seed);
    reviewedFeatureResolution = resolved.resolution;
    if (resolved.featureCandidatePayload) {
      featureCandidate = verifyProductFeatureCandidate(artifact(resolved.featureCandidatePayload, "product-feature-candidate", "featureCandidateId", "featureCandidateHash"), inspected.project.projectId);
      reviewedFeatureResolution = { kind: "candidate", featureCandidateId: featureCandidate.featureCandidateId };
    }
  }
  const payload = { schemaVersion: SCHEMA_VERSION, kind: "ReviewDecision", protocol: { name: "head-agent-core-product-initiative-review", version: PRODUCT_OPERATING_LOOP_VERSION }, projectId: inspected.project.projectId, sessionId: inspected.state.sessionId, decisionScope: "product-initiative", initiativeCandidateId, disposition, rationale: requiredText(rationale, "Product Initiative review rationale"), authority: "explicit-user-product-initiative-review", instructionAuthority: true, promotionAuthority: disposition === "accept" };
  const reviewDecision = verifyProductInitiativeReviewDecision(artifact(payload, "product-initiative-review", "reviewDecisionId", "reviewDecisionHash"), inspected.project.projectId);
  persistImmutable(inspected.project.projectRoot, PRODUCT_INITIATIVE_REVIEW_DIRECTORY, reviewDecision.reviewDecisionId, reviewDecision);
  let reviewedInitiative = null;
  if (disposition === "accept") {
    if (featureCandidate) persistImmutable(inspected.project.projectRoot, PRODUCT_FEATURE_CANDIDATE_DIRECTORY, featureCandidate.featureCandidateId, featureCandidate);
    const approved = { schemaVersion: SCHEMA_VERSION, kind: "ReviewedProductInitiative", protocol: { name: "head-agent-core-product-operating-loop", version: PRODUCT_OPERATING_LOOP_VERSION }, projectId: inspected.project.projectId, initiativeCandidateId, reviewDecisionId: reviewDecision.reviewDecisionId, title: candidate.title, description: candidate.description, reasoning: candidate.reasoning || "", hypothesisIds: candidate.hypothesisIds, featureResolution: reviewedFeatureResolution, epistemicClass: "approved-decision", authority: "reviewed-product-initiative-not-product-canon", instructionAuthority: false, promotionAuthority: false };
    reviewedInitiative = verifyReviewedProductInitiative(artifact(approved, "reviewed-product-initiative", "initiativeId", "initiativeHash"), inspected.project.projectId);
    persistImmutable(inspected.project.projectRoot, REVIEWED_PRODUCT_INITIATIVE_DIRECTORY, reviewedInitiative.initiativeId, reviewedInitiative);
  }
  return { status: disposition === "accept" ? "initiative_accepted" : "initiative_rejected", reviewDecision, reviewedInitiative, featureCandidate, productCanonMutated: false, productGraph: await projectProductOperatingGraph(inspected) };
}

export async function observeProductOutcome({ root = ".", changeSetId, statement, epistemicClass = "observed-fact", evidenceIds = [], initiativeId = "" } = {}) {
  const inspected = readyProject(root, "an OutcomeObservation is recorded");
  const changeSet = readChangeSet({ root: inspected.project.projectRoot, changeSetId }).changeSet;
  const result = readLineageArtifact({ root: inspected.project.projectRoot, artifactId: changeSet.resultPacketId }).artifact;
  const review = readLineageArtifact({ root: inspected.project.projectRoot, artifactId: changeSet.reviewDecisionId }).artifact;
  if (result.kind !== "ResultPacket" || review.kind !== "ReviewDecision" || review.disposition !== "accept" || review.resultPacketId !== result.resultPacketId) fail("OutcomeObservation requires accepted execution lineage.", "OUTCOME_EXECUTION_LINEAGE_REQUIRED");
  if (!["observed-fact", "derived-projection"].includes(epistemicClass)) fail("OutcomeObservation epistemicClass must be observed-fact or derived-projection.", "INVALID_OUTCOME_EPISTEMIC_CLASS");
  if (initiativeId) findById(inspected.project.projectRoot, REVIEWED_PRODUCT_INITIATIVE_DIRECTORY, initiativeId, "reviewed-product-initiative", verifyReviewedProductInitiative, inspected.project.projectId);
  const payload = { schemaVersion: SCHEMA_VERSION, kind: "OutcomeObservation", protocol: { name: "head-agent-core-product-operating-loop", version: PRODUCT_OPERATING_LOOP_VERSION }, projectId: inspected.project.projectId, initiativeId: initiativeId || null, changeSetId: changeSet.changeSetId, resultPacketId: result.resultPacketId, executionReviewDecisionId: review.reviewDecisionId, statement: requiredText(statement, "OutcomeObservation statement"), evidenceIds: sortedIds(evidenceIds, "OutcomeObservation evidenceIds"), epistemicClass, authority: "non-authoritative-outcome-evidence", instructionAuthority: false, promotionAuthority: false };
  const outcomeObservation = verifyOutcomeObservation(artifact(payload, "outcome-observation", "outcomeObservationId", "outcomeObservationHash"), inspected.project.projectId);
  const persisted = persistImmutable(inspected.project.projectRoot, OUTCOME_OBSERVATION_DIRECTORY, outcomeObservation.outcomeObservationId, outcomeObservation);
  return { ...persisted, outcomeObservation, featureStatusMutated: false, successJudgmentRecorded: false, productGraph: await projectProductOperatingGraph(inspected) };
}

export function inspectProductOperatingLoop({ root = ".", fresh = false } = {}) {
  const inspected = readyProject(root, "Product Operating Loop inspection");
  const read = readProductOperatingProjection(inspected, { fresh });
  const projection = read.projection;
  const artifactCount = Object.keys(DIRECTORIES).reduce((count, key) => count + projection[key].length, 0);
  return { status: artifactCount ? "active" : "not_started", projectId: inspected.project.projectId, sessionId: inspected.state.sessionId, projection, readVerification: read.verification, defaultPath: "ephemeral-note-then-persist-only-at-handoff-audit-product-state-or-cross-run-boundaries", authority: { observations: "evidence-only", hypotheses: "non-authoritative", initiativeCandidates: "candidate", reviewedInitiatives: "explicit-user-reviewed-but-not-product-canon", featureCandidates: "candidate-until-separate-product-canon-review", outcomes: "evidence-only", graph: "derived-projection" } };
}

export async function buildHeadContinuitySnapshot({ root = ".", fresh = false } = {}) {
  const inspected = readyProject(root, "HEAD continuity is read");
  const productRead = readProductOperatingProjection(inspected, { fresh });
  const projection = productRead.projection;
  let worldRead;
  try {
    worldRead = await readWorldSummary(inspected, { fresh });
  } catch { worldRead = { summary: null, verification: { mode: "unavailable", cacheKey: null, writeInvalidates: true } }; }
  const snapshot = {
    schemaVersion: SCHEMA_VERSION, kind: "HEADContinuitySnapshot", protocol: { name: "head-agent-core-head-continuity", version: PRODUCT_OPERATING_LOOP_VERSION },
    projectId: inspected.project.projectId, sessionId: inspected.state.sessionId, sessionMode: inspected.state.mode,
    activeRunId: inspected.state.activeRunId || null, currentWholePlanId: inspected.state.currentWholePlanId || null,
    activeExecutionContractId: inspected.state.activeExecutionContractId || null, lastResultPacketId: inspected.state.lastResultPacketId || null,
    lastReviewDecisionId: inspected.state.lastReviewDecisionId || null, latestCheckpointId: inspected.state.latestCheckpoint || null,
    productModelId: readProductModelCanon({ projectRoot: inspected.project.projectRoot }).model.productModelId,
    worldModel: worldRead.summary,
    productOperatingProjectionId: projection.projectionInputId,
    productSignalIds: projection.signals.map((item) => item.signalId),
    productHypothesisIds: projection.hypotheses.map((item) => item.hypothesisId),
    reviewedProductInitiativeIds: projection.reviewedInitiatives.map((item) => item.initiativeId),
    outcomeObservationIds: projection.outcomeObservations.map((item) => item.outcomeObservationId),
    authority: "on-demand-derived-reference-view", persisted: false, recoveryAuthority: false, instructionAuthority: false, promotionAuthority: false,
    recoveryCanon: ".head/sessions/current.json and Session/Run checkpoints", objectiveRewrite: false,
  };
  const snapshotHash = productOperatingDigest(productOperatingCanonicalJson(snapshot));
  return { status: "derived", snapshot: { ...snapshot, snapshotId: `head-continuity-${snapshotHash.slice(0, 24)}`, snapshotHash }, readVerification: { productOperating: productRead.verification, worldModel: worldRead.verification } };
}
