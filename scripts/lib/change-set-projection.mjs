import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const CHANGE_SET_VERSION = "0.1.0";
export const CHANGE_SET_DIRECTORY = ".head/change-sets/records";
export const CHANGE_IMPACT_CANDIDATE_DIRECTORY = ".head/change-sets/impact-candidate-sets";
export const CHANGE_IMPACT_REVIEW_DIRECTORY = ".head/change-sets/impact-review-decisions";

const LIMITS = Object.freeze({
  maxChangeSets: 256,
  maxCandidateSets: 256,
  maxReviewDecisions: 256,
  maxChangesPerSet: 2000,
  maxCandidatesPerSet: 1000,
  maxUnknownsPerSet: 100,
  maxArtifactBytes: 8 * 1024 * 1024,
  maxTotalBytes: 48 * 1024 * 1024,
});

const fail = (message, code = "CHANGE_SET_PROJECTION_ERROR") => {
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

export function changeSetCanonicalJson(value) {
  return JSON.stringify(canonical(value));
}

export function changeSetDigest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function verifyIdentity(document, { idField, hashField, prefix, label }) {
  if (!document || typeof document !== "object" || Array.isArray(document)) fail(`${label} is invalid.`, "INVALID_CHANGE_SET_ARTIFACT");
  const payload = { ...document };
  delete payload[idField];
  delete payload[hashField];
  const hash = changeSetDigest(changeSetCanonicalJson(payload));
  if (document[hashField] !== hash || document[idField] !== `${prefix}-${hash.slice(0, 24)}`) {
    fail(`${label} digest verification failed.`, "CHANGE_SET_DIGEST_MISMATCH");
  }
  return document;
}

function sortedUnique(values, label) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !value)) {
    fail(`${label} must be an array of non-empty strings.`, "INVALID_CHANGE_SET_ARTIFACT");
  }
  const normalized = [...new Set(values)].sort();
  if (changeSetCanonicalJson(values) !== changeSetCanonicalJson(normalized)) {
    fail(`${label} must be sorted and unique.`, "CHANGE_SET_ORDER_MISMATCH");
  }
  return normalized;
}

function verifySnapshotReference(reference, label) {
  if (!reference || typeof reference !== "object" || Array.isArray(reference)
    || changeSetCanonicalJson(Object.keys(reference).sort()) !== changeSetCanonicalJson(["graphSnapshotId", "sourceSnapshotId"])
    || !/^graph-snapshot-[a-f0-9]{24}$/.test(reference.graphSnapshotId || "")
    || !/^source-snapshot-[a-f0-9]{24}$/.test(reference.sourceSnapshotId || "")) {
    fail(`${label} is invalid.`, "INVALID_CHANGE_SET_SNAPSHOT_REFERENCE");
  }
  return reference;
}

function verifyChange(change) {
  if (!change || typeof change !== "object" || Array.isArray(change)
    || !/^change-record-[a-f0-9]{24}$/.test(change.changeId || "")
    || !["added", "modified", "removed"].includes(change.changeKind)
    || !["File", "Symbol", "Test"].includes(change.entityKind)
    || typeof change.logicalEntityId !== "string" || !change.logicalEntityId
    || (change.beforeRevisionId !== null && typeof change.beforeRevisionId !== "string")
    || (change.afterRevisionId !== null && typeof change.afterRevisionId !== "string")) {
    fail("ChangeSet revision change is invalid.", "INVALID_CHANGE_SET_CHANGE");
  }
  const payload = { ...change };
  delete payload.changeId;
  const hash = changeSetDigest(changeSetCanonicalJson(payload));
  if (change.changeId !== `change-record-${hash.slice(0, 24)}`) fail("ChangeSet revision change identity is invalid.", "CHANGE_SET_CHANGE_IDENTITY_MISMATCH");
  if ((change.changeKind === "added" && (change.beforeRevisionId !== null || !change.afterRevisionId))
    || (change.changeKind === "removed" && (!change.beforeRevisionId || change.afterRevisionId !== null))
    || (change.changeKind === "modified" && (!change.beforeRevisionId || !change.afterRevisionId || change.beforeRevisionId === change.afterRevisionId))) {
    fail("ChangeSet revision endpoints do not match the change kind.", "INVALID_CHANGE_SET_CHANGE");
  }
  return change;
}

export function verifyChangeSet(document, projectId = "") {
  verifyIdentity(document, { idField: "changeSetId", hashField: "changeSetHash", prefix: "change-set", label: "ChangeSet" });
  if (document.schemaVersion !== 1 || document.kind !== "ChangeSet"
    || document.protocol?.name !== "head-agent-core-change-set" || document.protocol?.version !== CHANGE_SET_VERSION
    || (projectId && document.projectId !== projectId)
    || typeof document.sessionId !== "string" || !document.sessionId
    || !/^result-packet-[a-f0-9]{24}$/.test(document.resultPacketId || "")
    || !/^review-decision-[a-f0-9]{24}$/.test(document.reviewDecisionId || "")
    || document.reviewDisposition !== "accept"
    || document.authority !== "reviewed-execution-change-lineage"
    || document.instructionAuthority !== false || document.promotionAuthority !== false
    || !Array.isArray(document.changes) || document.changes.length < 1 || document.changes.length > LIMITS.maxChangesPerSet) {
    fail("ChangeSet fields or authority are invalid.", "INVALID_CHANGE_SET");
  }
  verifySnapshotReference(document.before, "ChangeSet before snapshot");
  verifySnapshotReference(document.after, "ChangeSet after snapshot");
  if (document.before.sourceSnapshotId === document.after.sourceSnapshotId) {
    fail("ChangeSet before and after snapshots must differ.", "EMPTY_CHANGE_SET");
  }
  sortedUnique(document.parentChangeSetIds, "parentChangeSetIds");
  if (document.parentChangeSetIds.includes(document.changeSetId)) fail("A ChangeSet cannot parent itself.", "CHANGE_SET_CYCLE");
  const ids = new Set();
  for (const change of document.changes) {
    verifyChange(change);
    if (ids.has(change.changeId)) fail("Duplicate ChangeSet revision change.", "DUPLICATE_CHANGE_SET_CHANGE");
    ids.add(change.changeId);
  }
  if (changeSetCanonicalJson(document.changes.map((item) => item.changeId)) !== changeSetCanonicalJson([...ids].sort())) {
    fail("ChangeSet revision changes must use identity order.", "CHANGE_SET_ORDER_MISMATCH");
  }
  return document;
}

function verifyImpactCandidate(candidate, changeSet) {
  verifyIdentity(candidate, { idField: "candidateId", hashField: "candidateHash", prefix: "change-impact-candidate", label: "Change impact candidate" });
  if (candidate.schemaVersion !== 1 || candidate.kind !== "ChangeImpactCandidate" || candidate.relationshipType !== "IMPACTS"
    || candidate.changeSetId !== changeSet.changeSetId
    || !["Feature", "Capability"].includes(candidate.target.kind)
    || typeof candidate.target.nodeId !== "string" || !candidate.target.nodeId
    || typeof candidate.target.revisionId !== "string" || !candidate.target.revisionId
    || typeof candidate.confidence !== "number" || candidate.confidence < 0 || candidate.confidence > 1
    || typeof candidate.explanation !== "string" || !candidate.explanation
    || candidate.authorityClass !== "candidate" || candidate.instructionAuthority !== false || candidate.promotionAuthority !== false) {
    fail("Change impact candidate fields or authority are invalid.", "INVALID_CHANGE_IMPACT_CANDIDATE");
  }
  sortedUnique(candidate.changeIds, `Candidate ${candidate.candidateId} changeIds`);
  sortedUnique(candidate.reviewedRelationshipIds, `Candidate ${candidate.candidateId} reviewedRelationshipIds`);
  const knownChanges = new Set(changeSet.changes.map((item) => item.changeId));
  if (!candidate.changeIds.length || candidate.changeIds.some((id) => !knownChanges.has(id))) {
    fail("Change impact candidate references an unknown ChangeSet change.", "UNKNOWN_CHANGE_SET_CHANGE");
  }
  return candidate;
}

export function verifyChangeImpactCandidateSet(document, changeSet, projectId = "") {
  verifyIdentity(document, { idField: "candidateSetId", hashField: "candidateSetHash", prefix: "change-impact-candidates", label: "Change impact candidate set" });
  if (document.schemaVersion !== 1 || document.kind !== "ChangeImpactCandidateSet"
    || document.protocol?.name !== "head-agent-core-change-impact-candidates" || document.protocol?.version !== CHANGE_SET_VERSION
    || (projectId && document.projectId !== projectId) || !changeSet || document.changeSetId !== changeSet.changeSetId
    || document.afterSourceSnapshotId !== changeSet.after.sourceSnapshotId
    || document.authorityClass !== "candidate-set" || document.instructionAuthority !== false || document.promotionAuthority !== false
    || !Array.isArray(document.candidates) || !Array.isArray(document.unknowns)
    || document.candidates.length > LIMITS.maxCandidatesPerSet || document.unknowns.length > LIMITS.maxUnknownsPerSet) {
    fail("Change impact candidate-set fields or authority are invalid.", "INVALID_CHANGE_IMPACT_CANDIDATE_SET");
  }
  const ids = new Set();
  for (const candidate of document.candidates) {
    verifyImpactCandidate(candidate, changeSet);
    if (ids.has(candidate.candidateId)) fail("Duplicate Change impact candidate.", "DUPLICATE_CHANGE_IMPACT_CANDIDATE");
    ids.add(candidate.candidateId);
  }
  if (changeSetCanonicalJson(document.candidates.map((item) => item.candidateId)) !== changeSetCanonicalJson([...ids].sort())) {
    fail("Change impact candidates must use identity order.", "CHANGE_SET_ORDER_MISMATCH");
  }
  for (const unknown of document.unknowns) if (!unknown || !/^change-impact-unknown-[a-f0-9]{24}$/.test(unknown.unknownId || "")
    || typeof unknown.statement !== "string" || !unknown.statement || unknown.status !== "open") {
    fail("Change impact Unknown is invalid.", "INVALID_CHANGE_IMPACT_UNKNOWN");
  }
  return document;
}

export function verifyChangeImpactReviewDecision(document, candidateSet, projectId = "") {
  verifyIdentity(document, { idField: "reviewDecisionId", hashField: "reviewDecisionHash", prefix: "change-impact-review-decision", label: "Change impact ReviewDecision" });
  if (document.schemaVersion !== 1 || document.kind !== "ReviewDecision"
    || document.protocol?.name !== "head-agent-core-change-impact-review" || document.protocol?.version !== CHANGE_SET_VERSION
    || document.decisionScope !== "change-impact" || (projectId && document.projectId !== projectId)
    || !["accept-all", "accept-selection", "reject"].includes(document.disposition)
    || document.authority !== "explicit-user-change-impact-review" || document.instructionAuthority !== true
    || document.promotionAuthority !== document.disposition.startsWith("accept")
    || typeof document.rationale !== "string" || !document.rationale || !candidateSet || document.candidateSetId !== candidateSet.candidateSetId) {
    fail("Change impact ReviewDecision fields or authority are invalid.", "INVALID_CHANGE_IMPACT_REVIEW");
  }
  sortedUnique(document.acceptedCandidateIds, "acceptedCandidateIds");
  sortedUnique(document.rejectedCandidateIds, "rejectedCandidateIds");
  const known = new Set(candidateSet.candidates.map((item) => item.candidateId));
  const accepted = new Set(document.acceptedCandidateIds);
  const rejected = new Set(document.rejectedCandidateIds);
  if ([...accepted, ...rejected].some((id) => !known.has(id)) || [...accepted].some((id) => rejected.has(id))
    || accepted.size + rejected.size !== known.size || (document.disposition === "reject" && accepted.size)
    || (document.disposition.startsWith("accept") && !accepted.size)) {
    fail("Change impact ReviewDecision candidate partition is invalid.", "INVALID_CHANGE_IMPACT_REVIEW_SELECTION");
  }
  return document;
}

function safeDirectory(projectRoot, relative) {
  const root = path.resolve(projectRoot);
  const directory = path.resolve(root, ...relative.split("/"));
  const fromRoot = path.relative(root, directory);
  if (fromRoot === ".." || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) fail("ChangeSet projection path escapes the project root.", "CHANGE_SET_PATH_ESCAPE");
  let current = root;
  for (const segment of fromRoot.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) fail("ChangeSet projection path traverses a symlink.", "CHANGE_SET_SYMLINK_PATH");
  }
  return directory;
}

function readArtifacts(projectRoot, relative, label, limit) {
  const directory = safeDirectory(projectRoot, relative);
  if (!fs.existsSync(directory)) return [];
  const files = fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(directory, entry.name)).sort();
  if (files.length > limit) fail(`${label} count exceeds its bound.`, "CHANGE_SET_PROJECTION_LIMIT");
  const documents = [];
  let bytes = 0;
  for (const file of files) {
    const size = fs.statSync(file).size;
    if (size > LIMITS.maxArtifactBytes || (bytes += size) > LIMITS.maxTotalBytes) fail(`${label} artifacts exceed their byte bound.`, "CHANGE_SET_PROJECTION_LIMIT");
    try { documents.push(JSON.parse(fs.readFileSync(file, "utf8"))); }
    catch (error) { fail(`${label} artifact is invalid JSON: ${error.message}`, "INVALID_CHANGE_SET_ARTIFACT"); }
  }
  return documents;
}

function merge(items, additional, idField, label) {
  const merged = new Map();
  for (const item of [...items, ...additional]) {
    const existing = merged.get(item[idField]);
    if (existing && changeSetCanonicalJson(existing) !== changeSetCanonicalJson(item)) fail(`${label} identity collision.`, "CHANGE_SET_IMMUTABLE_COLLISION");
    merged.set(item[idField], item);
  }
  return [...merged.values()].sort((left, right) => left[idField].localeCompare(right[idField]));
}

export function verifyChangeSetProjectionInput(projection) {
  if (!projection || projection.kind !== "ChangeSetProjectionInput"
    || projection.protocol?.name !== "head-agent-core-change-set-projection" || projection.protocol?.version !== CHANGE_SET_VERSION
    || !Array.isArray(projection.changeSets) || !Array.isArray(projection.candidateSets) || !Array.isArray(projection.reviewDecisions)) {
    fail("ChangeSet projection input is invalid.", "INVALID_CHANGE_SET_PROJECTION");
  }
  const changeSets = new Map();
  for (const changeSet of projection.changeSets) {
    verifyChangeSet(changeSet, projection.projectId);
    if (changeSets.has(changeSet.changeSetId)) fail("Duplicate ChangeSet.", "DUPLICATE_CHANGE_SET");
    changeSets.set(changeSet.changeSetId, changeSet);
  }
  for (const changeSet of changeSets.values()) for (const parentId of changeSet.parentChangeSetIds) {
    if (!changeSets.has(parentId)) fail(`ChangeSet parent is missing: ${parentId}`, "CHANGE_SET_PARENT_MISSING");
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (changeSetId) => {
    if (visiting.has(changeSetId)) fail(`ChangeSet ancestry contains a cycle: ${changeSetId}`, "CHANGE_SET_CYCLE");
    if (visited.has(changeSetId)) return;
    visiting.add(changeSetId);
    for (const parentId of changeSets.get(changeSetId).parentChangeSetIds) visit(parentId);
    visiting.delete(changeSetId);
    visited.add(changeSetId);
  };
  for (const changeSetId of changeSets.keys()) visit(changeSetId);
  const candidateSets = new Map();
  for (const candidateSet of projection.candidateSets) {
    const changeSet = changeSets.get(candidateSet.changeSetId);
    if (!changeSet) fail("Change impact candidate set references an unknown ChangeSet.", "UNKNOWN_CHANGE_SET");
    verifyChangeImpactCandidateSet(candidateSet, changeSet, projection.projectId);
    candidateSets.set(candidateSet.candidateSetId, candidateSet);
  }
  const reviewIds = new Set();
  for (const review of projection.reviewDecisions) {
    const candidateSet = candidateSets.get(review.candidateSetId);
    if (!candidateSet) fail("Change impact review references an unknown candidate set.", "UNKNOWN_CHANGE_IMPACT_CANDIDATE_SET");
    verifyChangeImpactReviewDecision(review, candidateSet, projection.projectId);
    if (reviewIds.has(review.reviewDecisionId)) fail("Duplicate Change impact ReviewDecision.", "DUPLICATE_CHANGE_IMPACT_REVIEW");
    reviewIds.add(review.reviewDecisionId);
  }
  const payload = { ...projection };
  delete payload.projectionInputId;
  delete payload.projectionInputHash;
  const hash = changeSetDigest(changeSetCanonicalJson(payload));
  if (projection.projectionInputHash !== hash || projection.projectionInputId !== `change-set-projection-${hash.slice(0, 24)}`) {
    fail("ChangeSet projection digest verification failed.", "CHANGE_SET_PROJECTION_DIGEST_MISMATCH");
  }
  return projection;
}

export function loadChangeSetProjection({ projectRoot, projectId, additionalChangeSets = [], additionalCandidateSets = [], additionalReviewDecisions = [] } = {}) {
  const changeSets = merge(readArtifacts(projectRoot, CHANGE_SET_DIRECTORY, "ChangeSet", LIMITS.maxChangeSets), additionalChangeSets, "changeSetId", "ChangeSet");
  const candidateSets = merge(readArtifacts(projectRoot, CHANGE_IMPACT_CANDIDATE_DIRECTORY, "Change impact candidate set", LIMITS.maxCandidateSets), additionalCandidateSets, "candidateSetId", "Change impact candidate set");
  const reviewDecisions = merge(readArtifacts(projectRoot, CHANGE_IMPACT_REVIEW_DIRECTORY, "Change impact ReviewDecision", LIMITS.maxReviewDecisions), additionalReviewDecisions, "reviewDecisionId", "Change impact ReviewDecision");
  const payload = {
    schemaVersion: 1,
    kind: "ChangeSetProjectionInput",
    protocol: { name: "head-agent-core-change-set-projection", version: CHANGE_SET_VERSION },
    projectId,
    changeSets,
    candidateSets,
    reviewDecisions,
    authority: "derived-projection-input-not-change-lineage-authority",
    instructionAuthority: false,
    promotionAuthority: false,
  };
  const hash = changeSetDigest(changeSetCanonicalJson(payload));
  return verifyChangeSetProjectionInput({ ...payload, projectionInputId: `change-set-projection-${hash.slice(0, 24)}`, projectionInputHash: hash });
}
