import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { inspectProject, SCHEMA_VERSION } from "./head-core.mjs";
import { ONBOARDING_PRODUCT_REVISION_DIRECTORY } from "./onboarding-contract.mjs";
import { verifyProductModelRevisionForProjection } from "./onboarding-projection.mjs";
import {
  normalizeProductModelDocument,
  productModelDocument,
  PRODUCT_MODEL_RELATIVE_PATH,
  readProductModelCanon,
  upgradeProductModelDocument,
} from "./product-model.mjs";
import { withProjectMutation, withProjectMutationAsync } from "./project-mutation-lock.mjs";
import { artifactAuthorityBoundary, verifyArtifactAuthorityBoundary } from "./authority-plane-contract.mjs";
import { buildWorldModel, readWorldModel } from "./world-model.mjs";
import { refreshWorldModel } from "./incremental-refresh.mjs";
import { inspectProductPolicyEvidenceCurrentness } from "./product-policy-evidence.mjs";

export const PRODUCT_POLICY_VERSION = "0.1.0";
export const PRODUCT_POLICY_CANDIDATE_DIRECTORY = ".head/product-policy/candidates";
export const PRODUCT_POLICY_REVIEW_DIRECTORY = ".head/product-policy/review-decisions";

const HASH = /^[a-f0-9]{64}$/;
const CANDIDATE_ID = /^policy-candidate-[a-f0-9]{24}$/;
const REVIEW_ID = /^review-decision-[a-f0-9]{24}$/;
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const MAX_REVIEWS = 1024;

const fail = (message, code = "PRODUCT_POLICY_ERROR") => {
  const error = new Error(message);
  error.code = code;
  throw error;
};

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

export const productPolicyCanonicalJson = (value) => JSON.stringify(canonical(value));
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function requiredText(value, label, max = 4000) {
  if (typeof value !== "string" || !value.trim()) fail(`${label} is required.`, "INVALID_PRODUCT_POLICY_INPUT");
  const normalized = value.trim();
  if (normalized.length > max) fail(`${label} is too long.`, "INVALID_PRODUCT_POLICY_INPUT");
  return normalized;
}

function optionalText(value, label, max = 4000) {
  if (value == null) return "";
  if (typeof value !== "string") fail(`${label} must be text.`, "INVALID_PRODUCT_POLICY_INPUT");
  const normalized = value.trim();
  if (normalized.length > max) fail(`${label} is too long.`, "INVALID_PRODUCT_POLICY_INPUT");
  return normalized;
}

function exactFields(value, fields, label) {
  const expected = [...fields].sort();
  const actual = Object.keys(value || {}).sort();
  if (productPolicyCanonicalJson(actual) !== productPolicyCanonicalJson(expected)) fail(`${label} contains unsupported or missing fields.`, `INVALID_${label.replaceAll(" ", "_").toUpperCase()}`);
}

function readyProject(root, action) {
  const inspected = inspectProject(root);
  if (inspected.status !== "ready") fail(`Project must be ready for ${action}.`, "PROJECT_NOT_READY");
  return inspected;
}

function safeFile(projectRoot, relative) {
  const root = fs.realpathSync(path.resolve(projectRoot));
  const file = path.resolve(root, ...relative.split("/"));
  const fromRoot = path.relative(root, file);
  if (fromRoot === ".." || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) fail("Product Policy artifact path escapes the project root.", "PRODUCT_POLICY_PATH_ESCAPE");
  let current = root;
  for (const segment of fromRoot.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) fail("Product Policy artifact path traverses a symlink.", "PRODUCT_POLICY_SYMLINK_PATH");
  }
  return file;
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
  catch (error) { fail(`${label} is invalid JSON: ${error.message}`, "INVALID_PRODUCT_POLICY_ARTIFACT"); }
}

function persistImmutable(file, document, verifier, label) {
  const bytes = Buffer.byteLength(json(document));
  if (bytes > MAX_ARTIFACT_BYTES) fail(`${label} exceeds the bounded artifact size.`, "PRODUCT_POLICY_ARTIFACT_LIMIT");
  if (fs.existsSync(file)) {
    const existing = verifier(readJson(file, label));
    if (productPolicyCanonicalJson(existing) !== productPolicyCanonicalJson(document)) fail(`${label} identity collision detected.`, "PRODUCT_POLICY_IMMUTABLE_COLLISION");
    return { status: "existing", file, document: existing };
  }
  atomicWrite(file, json(document));
  return { status: "recorded", file, document };
}

function normalizeEvidenceAnchors(value = []) {
  if (!Array.isArray(value) || value.length > 32) fail("Policy evidenceAnchors must be an array of at most 32 records.", "INVALID_PRODUCT_POLICY_EVIDENCE");
  const allowedKinds = new Set(["user-request", "source", "observation", "decision", "other"]);
  const anchors = value.map((record, index) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) fail(`Policy evidenceAnchors[${index}] must be an object.`, "INVALID_PRODUCT_POLICY_EVIDENCE");
    const unexpected = Object.keys(record).filter((key) => !["kind", "reference", "digest", "summary"].includes(key));
    if (unexpected.length) fail(`Policy evidenceAnchors[${index}] contains unsupported fields.`, "INVALID_PRODUCT_POLICY_EVIDENCE");
    const kind = requiredText(record.kind, `Policy evidenceAnchors[${index}].kind`, 32);
    if (!allowedKinds.has(kind)) fail(`Policy evidenceAnchors[${index}].kind is invalid.`, "INVALID_PRODUCT_POLICY_EVIDENCE");
    let reference = requiredText(record.reference, `Policy evidenceAnchors[${index}].reference`, 1024);
    if (kind === "source") {
      reference = reference.replaceAll("\\", "/").replace(/^\.\//, "");
      if (!reference || path.posix.isAbsolute(reference) || /^[A-Za-z]:\//.test(reference)
        || reference === ".." || reference.startsWith("../") || reference.includes("/../")) {
        fail(`Policy evidenceAnchors[${index}].reference must be a project-relative source path.`, "INVALID_PRODUCT_POLICY_EVIDENCE");
      }
      reference = path.posix.normalize(reference);
    }
    const anchorDigest = record.digest == null ? null : requiredText(record.digest, `Policy evidenceAnchors[${index}].digest`, 64);
    if (anchorDigest !== null && !HASH.test(anchorDigest)) fail(`Policy evidenceAnchors[${index}].digest must be SHA-256.`, "INVALID_PRODUCT_POLICY_EVIDENCE");
    return { kind, reference, digest: anchorDigest, summary: optionalText(record.summary, `Policy evidenceAnchors[${index}].summary`, 1000) };
  }).sort((left, right) => productPolicyCanonicalJson(left).localeCompare(productPolicyCanonicalJson(right)));
  if (new Set(anchors.map(productPolicyCanonicalJson)).size !== anchors.length) fail("Policy evidenceAnchors contains duplicates.", "INVALID_PRODUCT_POLICY_EVIDENCE");
  return anchors;
}

function evidenceStatusFor(anchors) {
  if (!anchors.length) return "not-supplied";
  const sourceCount = anchors.filter((anchor) => anchor.kind === "source").length;
  if (!sourceCount) return "unverified-external";
  return sourceCount === anchors.length ? "local-source-bound" : "partially-bound";
}

function sourceEvidenceDigest(projectRoot, reference) {
  const file = safeFile(projectRoot, reference);
  if (!fs.existsSync(file)) fail(`Policy source evidence is missing: ${reference}`, "PRODUCT_POLICY_EVIDENCE_NOT_FOUND");
  const stat = fs.statSync(file);
  if (!stat.isFile()) fail(`Policy source evidence is not a regular file: ${reference}`, "PRODUCT_POLICY_EVIDENCE_UNSAFE");
  if (stat.size > MAX_SOURCE_BYTES) fail(`Policy source evidence exceeds 64 MiB: ${reference}`, "PRODUCT_POLICY_EVIDENCE_TOO_LARGE");
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    while (true) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!read) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally { fs.closeSync(fd); }
  return hash.digest("hex");
}

function bindLocalEvidence(projectRoot, anchors) {
  return normalizeEvidenceAnchors(anchors).map((anchor) => {
    if (anchor.kind !== "source") return anchor;
    const currentDigest = sourceEvidenceDigest(projectRoot, anchor.reference);
    if (anchor.digest && anchor.digest !== currentDigest) fail(`Policy source evidence digest does not match: ${anchor.reference}`, "PRODUCT_POLICY_EVIDENCE_STALE");
    return { ...anchor, digest: currentDigest };
  }).sort((left, right) => productPolicyCanonicalJson(left).localeCompare(productPolicyCanonicalJson(right)));
}

function revalidateLocalEvidence(projectRoot, candidate) {
  let verifiedLocalSourceCount = 0;
  for (const anchor of candidate.evidenceAnchors) {
    if (anchor.kind !== "source") continue;
    if (sourceEvidenceDigest(projectRoot, anchor.reference) !== anchor.digest) {
      fail(`Policy source evidence changed after proposal: ${anchor.reference}`, "PRODUCT_POLICY_EVIDENCE_STALE");
    }
    verifiedLocalSourceCount += 1;
  }
  return {
    status: candidate.evidenceStatus,
    verifiedLocalSourceCount,
    unverifiedExternalCount: candidate.evidenceAnchors.length - verifiedLocalSourceCount,
  };
}

function policyHash(policy) { return policy ? digest(productPolicyCanonicalJson(policy)) : null; }

function candidateFile(projectRoot, candidateId) {
  if (!CANDIDATE_ID.test(candidateId || "")) fail("Product Policy candidate id is invalid.", "INVALID_PRODUCT_POLICY_CANDIDATE_ID");
  return safeFile(projectRoot, `${PRODUCT_POLICY_CANDIDATE_DIRECTORY}/${candidateId}.json`);
}

function reviewFile(projectRoot, reviewDecisionId) {
  if (!REVIEW_ID.test(reviewDecisionId || "")) fail("Product Policy ReviewDecision id is invalid.", "INVALID_PRODUCT_POLICY_REVIEW_ID");
  return safeFile(projectRoot, `${PRODUCT_POLICY_REVIEW_DIRECTORY}/${reviewDecisionId}.json`);
}

function revisionFile(projectRoot, productModelId) {
  return safeFile(projectRoot, `${ONBOARDING_PRODUCT_REVISION_DIRECTORY}/${productModelId}.json`);
}

function productRevision(model) {
  return verifyProductModelRevisionForProjection({
    schemaVersion: SCHEMA_VERSION,
    kind: "ProductModelRevision",
    productModelId: model.productModelId,
    productModelHash: model.productModelHash,
    document: productModelDocument(model),
    authority: "user-owned-project-canon-revision",
  });
}

function nextPolicyModel({ baseModel, operation, key, name, description, statement, appliesTo, governedBy }) {
  const document = upgradeProductModelDocument(baseModel);
  const index = document.policies.findIndex((policy) => policy.key === key);
  const prior = index >= 0 ? document.policies[index] : null;
  if (operation === "create" && prior) fail(`Policy already exists: ${key}`, "PRODUCT_POLICY_ALREADY_EXISTS");
  if (operation !== "create" && !prior) fail(`Policy does not exist: ${key}`, "PRODUCT_POLICY_NOT_FOUND");
  if (operation !== "create" && prior.status === "retired") fail(`Policy is already retired: ${key}`, "PRODUCT_POLICY_RETIRED");
  let proposed;
  if (operation === "retire") proposed = { ...prior, status: "retired" };
  else proposed = {
    key,
    name: requiredText(name ?? prior?.name, "Policy name", 256),
    description: optionalText(description ?? prior?.description, "Policy description", 4000),
    statement: requiredText(statement ?? prior?.statement, "Policy statement", 8000),
    status: "active",
    appliesTo: appliesTo ?? prior?.appliesTo ?? [],
    governedBy: governedBy ?? prior?.governedBy ?? [],
  };
  if (index < 0) document.policies.push(proposed);
  else document.policies[index] = proposed;
  const resultingModel = normalizeProductModelDocument(document);
  const normalizedPolicy = resultingModel.policies.find((policy) => policy.key === key);
  if (resultingModel.productModelId === baseModel.productModelId) fail("Product Policy proposal would not change Product Canon.", "PRODUCT_POLICY_NO_CHANGE");
  return { prior, proposed: normalizedPolicy, resultingModel };
}

function buildCandidate({ inspected, operation, key, baseModel, prior, proposed, resultingModel, evidenceAnchors, explanation }) {
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    kind: "ProductPolicyCandidate",
    protocol: { name: "head-agent-core-product-policy-candidate", version: PRODUCT_POLICY_VERSION },
    projectId: inspected.project.projectId,
    sessionId: inspected.state.sessionId,
    operation,
    policyKey: key,
    baseProductModelId: baseModel.productModelId,
    baseProductModelHash: baseModel.productModelHash,
    baseProductModelDocument: productModelDocument(baseModel),
    priorPolicyHash: policyHash(prior),
    proposedPolicy: proposed,
    resultingProductModelId: resultingModel.productModelId,
    resultingProductModelHash: resultingModel.productModelHash,
    resultingProductModelDocument: productModelDocument(resultingModel),
    evidenceAnchors,
    evidenceStatus: evidenceStatusFor(evidenceAnchors),
    explanation,
    epistemicClass: "proposed-meaning",
    authority: "candidate-not-product-canon",
    authorityBoundary: artifactAuthorityBoundary("PolicyCandidate"),
    instructionAuthority: false,
    promotionAuthority: false,
    recoveryAuthority: false,
    mutatesCanon: false,
    blocksOrdinaryWork: false,
  };
  const candidateHash = digest(productPolicyCanonicalJson(payload));
  return { ...payload, candidateId: `policy-candidate-${candidateHash.slice(0, 24)}`, candidateHash };
}

export function verifyProductPolicyCandidate(document, projectId = "") {
  exactFields(document, ["schemaVersion", "kind", "protocol", "projectId", "sessionId", "operation", "policyKey", "baseProductModelId", "baseProductModelHash", "baseProductModelDocument", "priorPolicyHash", "proposedPolicy", "resultingProductModelId", "resultingProductModelHash", "resultingProductModelDocument", "evidenceAnchors", "evidenceStatus", "explanation", "epistemicClass", "authority", "authorityBoundary", "instructionAuthority", "promotionAuthority", "recoveryAuthority", "mutatesCanon", "blocksOrdinaryWork", "candidateId", "candidateHash"], "Product Policy candidate");
  if (!document || document.schemaVersion !== SCHEMA_VERSION || document.kind !== "ProductPolicyCandidate"
    || document.protocol?.name !== "head-agent-core-product-policy-candidate" || document.protocol.version !== PRODUCT_POLICY_VERSION
    || !CANDIDATE_ID.test(document.candidateId || "") || !HASH.test(document.candidateHash || "")
    || projectId && document.projectId !== projectId || !["create", "revise", "retire"].includes(document.operation)
    || document.policyKey !== document.proposedPolicy?.key || !["not-supplied", "local-source-bound", "partially-bound", "unverified-external"].includes(document.evidenceStatus)
    || document.epistemicClass !== "proposed-meaning" || document.authority !== "candidate-not-product-canon"
    || document.instructionAuthority !== false || document.promotionAuthority !== false || document.recoveryAuthority !== false
    || document.mutatesCanon !== false || document.blocksOrdinaryWork !== false) fail("Product Policy candidate is invalid.", "INVALID_PRODUCT_POLICY_CANDIDATE");
  verifyArtifactAuthorityBoundary("PolicyCandidate", document.authorityBoundary);
  const base = normalizeProductModelDocument(document.baseProductModelDocument);
  const result = normalizeProductModelDocument(document.resultingProductModelDocument);
  if (base.productModelId !== document.baseProductModelId || base.productModelHash !== document.baseProductModelHash
    || result.productModelId !== document.resultingProductModelId || result.productModelHash !== document.resultingProductModelHash) {
    fail("Product Policy candidate Product Model binding is invalid.", "PRODUCT_POLICY_MODEL_BINDING_MISMATCH");
  }
  const normalizedEvidence = normalizeEvidenceAnchors(document.evidenceAnchors);
  if (productPolicyCanonicalJson(normalizedEvidence) !== productPolicyCanonicalJson(document.evidenceAnchors)
    || normalizedEvidence.some((anchor) => anchor.kind === "source" && !anchor.digest)
    || document.evidenceStatus !== evidenceStatusFor(normalizedEvidence)) fail("Product Policy candidate evidence is not normalized or accurately disclosed.", "INVALID_PRODUCT_POLICY_EVIDENCE");
  let expected;
  try {
    expected = nextPolicyModel({
      baseModel: base,
      operation: document.operation,
      key: document.policyKey,
      name: document.proposedPolicy?.name,
      description: document.proposedPolicy?.description,
      statement: document.proposedPolicy?.statement,
      appliesTo: document.proposedPolicy?.appliesTo,
      governedBy: document.proposedPolicy?.governedBy,
    });
  } catch (error) {
    fail(`Product Policy candidate transition is invalid: ${error.message}`, "PRODUCT_POLICY_TRANSITION_MISMATCH");
  }
  if (policyHash(expected.prior) !== document.priorPolicyHash
    || productPolicyCanonicalJson(expected.proposed) !== productPolicyCanonicalJson(document.proposedPolicy)
    || productPolicyCanonicalJson(productModelDocument(expected.resultingModel)) !== productPolicyCanonicalJson(productModelDocument(result))) {
    fail("Product Policy candidate changes more than its declared operation.", "PRODUCT_POLICY_TRANSITION_MISMATCH");
  }
  const payload = { ...document };
  delete payload.candidateId;
  delete payload.candidateHash;
  const hash = digest(productPolicyCanonicalJson(payload));
  if (hash !== document.candidateHash || document.candidateId !== `policy-candidate-${hash.slice(0, 24)}`) fail("Product Policy candidate digest verification failed.", "PRODUCT_POLICY_CANDIDATE_DIGEST_MISMATCH");
  return document;
}

function buildReview({ candidate, disposition, rationale }) {
  const accepting = disposition === "accept";
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    kind: "ReviewDecision",
    protocol: { name: "head-agent-core-product-policy-review", version: PRODUCT_POLICY_VERSION },
    projectId: candidate.projectId,
    sessionId: candidate.sessionId,
    candidateId: candidate.candidateId,
    candidateHash: candidate.candidateHash,
    disposition,
    rationale,
    previousProductModelId: candidate.baseProductModelId,
    previousProductModelHash: candidate.baseProductModelHash,
    resultingProductModelId: accepting ? candidate.resultingProductModelId : null,
    resultingProductModelHash: accepting ? candidate.resultingProductModelHash : null,
    authority: "explicit-user-review-decision",
    authorityBoundary: artifactAuthorityBoundary("ReviewDecision"),
    instructionAuthority: false,
    promotionAuthority: accepting,
    recoveryAuthority: false,
    mutatesCanon: accepting,
    blocksOrdinaryWork: false,
  };
  const reviewDecisionHash = digest(productPolicyCanonicalJson(payload));
  return { ...payload, reviewDecisionId: `review-decision-${reviewDecisionHash.slice(0, 24)}`, reviewDecisionHash };
}

export function verifyProductPolicyReviewDecision(document, candidate = null, projectId = "") {
  exactFields(document, ["schemaVersion", "kind", "protocol", "projectId", "sessionId", "candidateId", "candidateHash", "disposition", "rationale", "previousProductModelId", "previousProductModelHash", "resultingProductModelId", "resultingProductModelHash", "authority", "authorityBoundary", "instructionAuthority", "promotionAuthority", "recoveryAuthority", "mutatesCanon", "blocksOrdinaryWork", "reviewDecisionId", "reviewDecisionHash"], "Product Policy ReviewDecision");
  if (!document || document.schemaVersion !== SCHEMA_VERSION || document.kind !== "ReviewDecision"
    || document.protocol?.name !== "head-agent-core-product-policy-review" || document.protocol.version !== PRODUCT_POLICY_VERSION
    || !REVIEW_ID.test(document.reviewDecisionId || "") || !HASH.test(document.reviewDecisionHash || "")
    || projectId && document.projectId !== projectId || !["accept", "reject"].includes(document.disposition)
    || document.authority !== "explicit-user-review-decision" || document.instructionAuthority !== false
    || document.promotionAuthority !== (document.disposition === "accept") || document.recoveryAuthority !== false
    || document.mutatesCanon !== (document.disposition === "accept") || document.blocksOrdinaryWork !== false) fail("Product Policy ReviewDecision is invalid.", "INVALID_PRODUCT_POLICY_REVIEW");
  verifyArtifactAuthorityBoundary("ReviewDecision", document.authorityBoundary);
  const accepting = document.disposition === "accept";
  if (accepting !== Boolean(document.resultingProductModelId) || accepting !== Boolean(document.resultingProductModelHash)) fail("Product Policy ReviewDecision promotion fields are invalid.", "INVALID_PRODUCT_POLICY_REVIEW");
  if (candidate) {
    verifyProductPolicyCandidate(candidate, projectId || candidate.projectId);
    if (document.projectId !== candidate.projectId || document.sessionId !== candidate.sessionId || document.candidateId !== candidate.candidateId
      || document.candidateHash !== candidate.candidateHash || document.previousProductModelId !== candidate.baseProductModelId
      || document.previousProductModelHash !== candidate.baseProductModelHash
      || accepting && (document.resultingProductModelId !== candidate.resultingProductModelId || document.resultingProductModelHash !== candidate.resultingProductModelHash)) {
      fail("Product Policy ReviewDecision does not match its exact candidate.", "PRODUCT_POLICY_REVIEW_SCOPE_MISMATCH");
    }
  }
  const payload = { ...document };
  delete payload.reviewDecisionId;
  delete payload.reviewDecisionHash;
  const hash = digest(productPolicyCanonicalJson(payload));
  if (hash !== document.reviewDecisionHash || document.reviewDecisionId !== `review-decision-${hash.slice(0, 24)}`) fail("Product Policy ReviewDecision digest verification failed.", "PRODUCT_POLICY_REVIEW_DIGEST_MISMATCH");
  return document;
}

function recordedReview(projectRoot, candidate) {
  const directory = safeFile(projectRoot, PRODUCT_POLICY_REVIEW_DIRECTORY);
  if (!fs.existsSync(directory)) return null;
  const names = fs.readdirSync(directory).filter((name) => name.endsWith(".json")).sort();
  if (names.length > MAX_REVIEWS) fail("Product Policy review directory exceeds its bounded audit limit.", "PRODUCT_POLICY_ARTIFACT_LIMIT");
  const matches = [];
  for (const name of names) {
    if (!REVIEW_ID.test(name.slice(0, -5))) fail("Product Policy review directory contains an unexpected artifact.", "INVALID_PRODUCT_POLICY_ARTIFACT");
    const review = verifyProductPolicyReviewDecision(readJson(path.join(directory, name), "Product Policy ReviewDecision"));
    if (review.reviewDecisionId !== name.slice(0, -5)) fail("Product Policy ReviewDecision filename does not match its identity.", "PRODUCT_POLICY_ARTIFACT_IDENTITY_MISMATCH");
    if (review.candidateId === candidate.candidateId) matches.push(verifyProductPolicyReviewDecision(review, candidate, candidate.projectId));
  }
  if (matches.length > 1) fail("Product Policy candidate has conflicting durable decisions.", "PRODUCT_POLICY_REVIEW_CONFLICT");
  return matches[0] || null;
}

export async function proposeProductPolicy({ root = ".", operation = "create", key, name = null, description = null, statement = null, appliesTo = null, governedBy = null, evidenceAnchors = [], explanation = "" } = {}) {
  return withProjectMutationAsync({ root, scope: "onboarding-promotion" }, async () => {
    const inspected = readyProject(root, "Product Policy proposal");
    const canon = readProductModelCanon({ projectRoot: inspected.project.projectRoot }).model;
    const normalizedOperation = requiredText(operation, "Policy operation", 16).toLowerCase();
    if (!["create", "revise", "retire"].includes(normalizedOperation)) fail("Policy operation must be create, revise, or retire.", "INVALID_PRODUCT_POLICY_INPUT");
    const policyKey = requiredText(key, "Policy key", 128);
    const transition = nextPolicyModel({ baseModel: canon, operation: normalizedOperation, key: policyKey, name, description, statement, appliesTo, governedBy });
    const candidate = verifyProductPolicyCandidate(buildCandidate({
      inspected,
      operation: normalizedOperation,
      key: policyKey,
      baseModel: canon,
      prior: transition.prior,
      proposed: transition.proposed,
      resultingModel: transition.resultingModel,
      evidenceAnchors: bindLocalEvidence(inspected.project.projectRoot, evidenceAnchors),
      explanation: optionalText(explanation, "Policy proposal explanation", 4000),
    }), inspected.project.projectId);
    const entry = persistImmutable(candidateFile(inspected.project.projectRoot, candidate.candidateId), candidate, (value) => verifyProductPolicyCandidate(value, inspected.project.projectId), "Product Policy candidate");
    return {
      status: "awaiting-review",
      file: entry.file,
      candidate,
      reviewRequired: true,
      ordinaryWorkBlocked: false,
      userAction: `Review exact candidate ${candidate.candidateId}; accepting changes Product Canon, rejecting only records the disposition.`,
    };
  });
}

export function readProductPolicyCandidate({ root = ".", candidateId } = {}) {
  const inspected = readyProject(root, "Product Policy candidate inspection");
  const file = candidateFile(inspected.project.projectRoot, candidateId);
  if (!fs.existsSync(file)) fail(`Product Policy candidate is missing: ${candidateId}`, "PRODUCT_POLICY_CANDIDATE_NOT_FOUND");
  const candidate = verifyProductPolicyCandidate(readJson(file, "Product Policy candidate"), inspected.project.projectId);
  if (candidate.candidateId !== candidateId) fail("Product Policy candidate filename does not match its identity.", "PRODUCT_POLICY_ARTIFACT_IDENTITY_MISMATCH");
  return { status: "verified", file, candidate };
}

export function readProductPolicyReviewDecision({ root = ".", reviewDecisionId } = {}) {
  const inspected = readyProject(root, "Product Policy review inspection");
  const file = reviewFile(inspected.project.projectRoot, reviewDecisionId);
  if (!fs.existsSync(file)) fail(`Product Policy ReviewDecision is missing: ${reviewDecisionId}`, "PRODUCT_POLICY_REVIEW_NOT_FOUND");
  const review = verifyProductPolicyReviewDecision(readJson(file, "Product Policy ReviewDecision"), null, inspected.project.projectId);
  if (review.reviewDecisionId !== reviewDecisionId) fail("Product Policy ReviewDecision filename does not match its identity.", "PRODUCT_POLICY_ARTIFACT_IDENTITY_MISMATCH");
  const candidate = readProductPolicyCandidate({ root: inspected.project.projectRoot, candidateId: review.candidateId }).candidate;
  return { status: "verified", file, reviewDecision: verifyProductPolicyReviewDecision(review, candidate, inspected.project.projectId), candidate };
}

async function refreshPolicyProjection(projectRoot, reviewDecisionId) {
  try {
    readWorldModel({ root: projectRoot });
    return await refreshWorldModel({ root: projectRoot, triggerKind: "manual", triggerEvidenceIds: [reviewDecisionId] });
  } catch (error) {
    if (!new Set(["WORLD_MODEL_NOT_BUILT", "WORLD_MODEL_SNAPSHOT_MISSING"]).has(error.code)) throw error;
    return buildWorldModel({ root: projectRoot });
  }
}

export async function reviewProductPolicy({ root = ".", candidateId, disposition, rationale } = {}) {
  const normalizedDisposition = requiredText(disposition, "Policy review disposition", 16).toLowerCase();
  if (!["accept", "reject"].includes(normalizedDisposition)) fail("Policy review disposition must be accept or reject.", "INVALID_PRODUCT_POLICY_REVIEW");
  const normalizedRationale = requiredText(rationale, "Policy review rationale", 4000);
  const applied = await withProjectMutationAsync({ root, scope: "onboarding-promotion" }, async () => {
    const outer = readyProject(root, "Product Policy review");
    return withProjectMutation({ root: outer.project.projectRoot, scope: "session-recovery" }, () => {
      const inspected = readyProject(outer.project.projectRoot, "Product Policy review");
      const candidate = readProductPolicyCandidate({ root: inspected.project.projectRoot, candidateId }).candidate;
      if (candidate.sessionId !== inspected.state.sessionId) fail("Product Policy candidate belongs to another HEAD Session.", "PRODUCT_POLICY_SESSION_DRIFT");
      const intended = verifyProductPolicyReviewDecision(buildReview({ candidate, disposition: normalizedDisposition, rationale: normalizedRationale }), candidate, inspected.project.projectId);
      const existing = recordedReview(inspected.project.projectRoot, candidate);
      if (existing && existing.reviewDecisionId !== intended.reviewDecisionId) fail(`A different ReviewDecision is already durable for this candidate: ${existing.reviewDecisionId}`, "PRODUCT_POLICY_REVIEW_CONFLICT");
      const review = existing || intended;
      const canon = readProductModelCanon({ projectRoot: inspected.project.projectRoot }).model;
      if (normalizedDisposition === "reject") {
        const entry = persistImmutable(reviewFile(inspected.project.projectRoot, review.reviewDecisionId), review, (value) => verifyProductPolicyReviewDecision(value, candidate, inspected.project.projectId), "Product Policy ReviewDecision");
        return { status: "rejected", inspected, candidate, review, reviewFile: entry.file, canonChanged: false };
      }
      const atBase = canon.productModelId === candidate.baseProductModelId && canon.productModelHash === candidate.baseProductModelHash;
      const atResult = canon.productModelId === candidate.resultingProductModelId && canon.productModelHash === candidate.resultingProductModelHash;
      if (!atBase && !atResult) fail("Product Canon changed after this Policy proposal; create and review a fresh candidate.", "PRODUCT_POLICY_CANON_DRIFT");
      if (atBase && (inspected.state.activeRunId || inspected.state.pendingReview)) {
        fail("Product Policy acceptance cannot change Product Canon while a Run is active or awaiting result review.", "PRODUCT_POLICY_RUN_CONFLICT");
      }
      const evidenceCheck = existing ? { status: "bound-by-durable-review", replayed: true }
        : { ...revalidateLocalEvidence(inspected.project.projectRoot, candidate), replayed: false };
      const entry = persistImmutable(reviewFile(inspected.project.projectRoot, review.reviewDecisionId), review, (value) => verifyProductPolicyReviewDecision(value, candidate, inspected.project.projectId), "Product Policy ReviewDecision");
      const baseModel = normalizeProductModelDocument(candidate.baseProductModelDocument);
      const resultModel = normalizeProductModelDocument(candidate.resultingProductModelDocument);
      persistImmutable(revisionFile(inspected.project.projectRoot, baseModel.productModelId), productRevision(baseModel), verifyProductModelRevisionForProjection, "Product Model revision");
      persistImmutable(revisionFile(inspected.project.projectRoot, resultModel.productModelId), productRevision(resultModel), verifyProductModelRevisionForProjection, "Product Model revision");
      if (atBase) atomicWrite(safeFile(inspected.project.projectRoot, PRODUCT_MODEL_RELATIVE_PATH), json(productModelDocument(resultModel)));
      return { status: "accepted", inspected, candidate, review, reviewFile: entry.file, canonChanged: atBase, evidenceCheck };
    });
  });
  if (applied.status !== "accepted") return { ...applied, ordinaryWorkBlocked: false };
  try {
    const projection = await refreshPolicyProjection(applied.inspected.project.projectRoot, applied.review.reviewDecisionId);
    return { ...applied, status: "accepted", projectionStatus: "current", projection, ordinaryWorkBlocked: false, additionalUserReviewRequired: false };
  } catch (error) {
    return {
      ...applied,
      status: "accepted-projection-pending",
      projectionStatus: "refresh-required",
      projectionError: { code: error.code || "PRODUCT_POLICY_PROJECTION_FAILED", message: error.message },
      ordinaryWorkBlocked: false,
      additionalUserReviewRequired: false,
      userAction: "Retry this unchanged ReviewDecision to repair only the derived World/Graph projection; no new approval is required.",
    };
  }
}

function acceptedPolicySuccessors(projectRoot, projectId) {
  const directory = safeFile(projectRoot, PRODUCT_POLICY_REVIEW_DIRECTORY);
  const successors = new Map();
  if (!fs.existsSync(directory)) return successors;
  const names = fs.readdirSync(directory).filter((name) => name.endsWith(".json")).sort();
  if (names.length > MAX_REVIEWS) fail("Product Policy review directory exceeds its bounded audit limit.", "PRODUCT_POLICY_ARTIFACT_LIMIT");
  for (const name of names) {
    const reviewDecisionId = name.slice(0, -5);
    if (!REVIEW_ID.test(reviewDecisionId)) fail("Product Policy review directory contains an unexpected artifact.", "INVALID_PRODUCT_POLICY_ARTIFACT");
    const review = verifyProductPolicyReviewDecision(readJson(path.join(directory, name), "Product Policy ReviewDecision"), null, projectId);
    if (review.reviewDecisionId !== reviewDecisionId) fail("Product Policy ReviewDecision filename does not match its identity.", "PRODUCT_POLICY_ARTIFACT_IDENTITY_MISMATCH");
    if (review.disposition !== "accept") continue;
    const candidate = readProductPolicyCandidate({ root: projectRoot, candidateId: review.candidateId }).candidate;
    verifyProductPolicyReviewDecision(review, candidate, projectId);
    const current = successors.get(candidate.baseProductModelId) || new Set();
    current.add(candidate.resultingProductModelId);
    successors.set(candidate.baseProductModelId, current);
  }
  return successors;
}

function reachesProductModel(successors, start, target) {
  const visited = new Set();
  const queue = [start];
  while (queue.length) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    if (current === target) return true;
    visited.add(current);
    for (const next of successors.get(current) || []) if (!visited.has(next)) queue.push(next);
  }
  return false;
}

export function inspectProductPolicyStatus({ root = ".", candidateId } = {}) {
  const inspected = readyProject(root, "Product Policy status");
  const candidate = readProductPolicyCandidate({ root: inspected.project.projectRoot, candidateId }).candidate;
  const review = recordedReview(inspected.project.projectRoot, candidate);
  const canon = readProductModelCanon({ projectRoot: inspected.project.projectRoot }).model;
  const superseded = review?.disposition === "accept" && reachesProductModel(
    acceptedPolicySuccessors(inspected.project.projectRoot, inspected.project.projectId),
    candidate.resultingProductModelId,
    canon.productModelId,
  );
  const canonState = canon.productModelId === candidate.resultingProductModelId ? "result-current"
    : superseded ? "superseded" : canon.productModelId === candidate.baseProductModelId ? "base-current" : "diverged";
  const status = !review ? "awaiting-review" : review.disposition === "reject" ? "rejected"
    : canonState === "result-current" ? "accepted"
      : canonState === "superseded" ? "accepted-historical" : "review-recorded-application-pending";
  return {
    status,
    candidateId: candidate.candidateId,
    reviewDecisionId: review?.reviewDecisionId || null,
    canonState,
    evidenceStatus: candidate.evidenceStatus,
    evidenceCurrentness: inspectProductPolicyEvidenceCurrentness({ projectRoot: inspected.project.projectRoot, candidate }),
    ordinaryWorkBlocked: false,
    userAction: review ? null : `Review exact candidate ${candidate.candidateId}.`,
  };
}
