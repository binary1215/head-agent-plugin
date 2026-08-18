import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { inspectProject, SCHEMA_VERSION } from "./head-core.mjs";
import { readContextCapsule } from "./context-compiler.mjs";
import { readLineageArtifact } from "./execution-lineage.mjs";
import {
  buildWorldModel,
  findWorldModelSnapshot,
  inspectWorldModel,
  readWorldModelSnapshot,
} from "./world-model.mjs";
import {
  CHANGE_IMPACT_CANDIDATE_DIRECTORY,
  CHANGE_IMPACT_REVIEW_DIRECTORY,
  CHANGE_SET_DIRECTORY,
  CHANGE_SET_VERSION,
  changeSetCanonicalJson,
  changeSetDigest,
  loadChangeSetProjection,
  verifyChangeImpactCandidateSet,
  verifyChangeImpactReviewDecision,
  verifyChangeSet,
} from "./change-set-projection.mjs";

const STATE_RELATIVE_PATH = ".head/change-sets/current.json";

const fail = (message, code = "CHANGE_SET_ERROR") => {
  const error = new Error(message);
  error.code = code;
  throw error;
};

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function readyProject(root, action) {
  const inspected = inspectProject(root);
  if (inspected.status !== "ready") fail(`Project must be ready for ${action}; current status: ${inspected.status}.`, "PROJECT_NOT_READY");
  return inspected;
}

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) fail(`${label} is required.`, "INVALID_CHANGE_SET_INPUT");
  return value.trim();
}

function normalizedIds(values, label) {
  if (values == null) return [];
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !value)) fail(`${label} must be an array of identities.`, "INVALID_CHANGE_SET_INPUT");
  return [...new Set(values)].sort();
}

function safeFile(projectRoot, relative, id, prefix) {
  if (!new RegExp(`^${prefix}-[a-f0-9]{24}$`).test(id || "")) fail(`Invalid ${prefix} identity.`, "INVALID_CHANGE_SET_ID");
  return path.join(projectRoot, ...relative.split("/"), `${id}.json`);
}

function stateFile(projectRoot) {
  return path.join(projectRoot, ...STATE_RELATIVE_PATH.split("/"));
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

function persistImmutable(file, document, label) {
  if (fs.existsSync(file)) {
    let existing;
    try { existing = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (error) { fail(`${label} is invalid JSON: ${error.message}`, "INVALID_CHANGE_SET_ARTIFACT"); }
    if (changeSetCanonicalJson(existing) !== changeSetCanonicalJson(document)) fail(`${label} immutable identity collision.`, "CHANGE_SET_IMMUTABLE_COLLISION");
    return "existing";
  }
  atomicWrite(file, json(document));
  return "recorded";
}

function readJson(file, label) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { fail(`${label} is invalid JSON: ${error.message}`, "INVALID_CHANGE_SET_ARTIFACT"); }
}

function stateArtifact(project, body) {
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    kind: "ChangeSetStatePointer",
    protocol: { name: "head-agent-core-change-set-state", version: CHANGE_SET_VERSION },
    projectId: project.projectId,
    sessionId: body.sessionId,
    phase: body.phase,
    changeSetId: body.changeSetId,
    candidateSetId: body.candidateSetId,
    reviewDecisionId: body.reviewDecisionId || null,
    worldModelId: body.worldModelId,
    graphSnapshotId: body.graphSnapshotId,
    sourceSnapshotId: body.sourceSnapshotId,
  };
  const stateHash = changeSetDigest(changeSetCanonicalJson(payload));
  return { ...payload, stateId: `change-set-state-${stateHash.slice(0, 24)}`, stateHash };
}

function verifyState(document, project) {
  if (!document || document.kind !== "ChangeSetStatePointer" || document.protocol?.version !== CHANGE_SET_VERSION
    || document.projectId !== project.projectId || document.sessionId !== project.sessionId
    || !["awaiting-review", "awaiting-evidence", "reviewed", "rejected"].includes(document.phase)) {
    fail("ChangeSet state pointer is invalid.", "INVALID_CHANGE_SET_STATE");
  }
  const payload = { ...document };
  delete payload.stateId;
  delete payload.stateHash;
  const hash = changeSetDigest(changeSetCanonicalJson(payload));
  if (document.stateHash !== hash || document.stateId !== `change-set-state-${hash.slice(0, 24)}`) fail("ChangeSet state pointer digest verification failed.", "CHANGE_SET_STATE_DIGEST_MISMATCH");
  return document;
}

function writeState(projectRoot, project, body) {
  const state = stateArtifact({ ...project, sessionId: body.sessionId }, body);
  atomicWrite(stateFile(projectRoot), json(state));
  return state;
}

function revisionState(snapshot) {
  const graph = snapshot.temporalProvenanceGraph;
  const revisionKinds = new Map([["FileRevision", "File"], ["SymbolRevision", "Symbol"], ["TestRevision", "Test"]]);
  const revisions = new Map();
  for (const node of graph.nodes) if (revisionKinds.has(node.kind)) revisions.set(node.logicalEntityId, {
    revisionId: node.nodeId,
    entityKind: revisionKinds.get(node.kind),
    path: node.path || "",
    name: node.name || "",
  });
  return revisions;
}

function revisionChanges(before, after) {
  const beforeState = revisionState(before);
  const afterState = revisionState(after);
  const logicalIds = [...new Set([...beforeState.keys(), ...afterState.keys()])].sort();
  return logicalIds.flatMap((logicalEntityId) => {
    const previous = beforeState.get(logicalEntityId) || null;
    const current = afterState.get(logicalEntityId) || null;
    if (previous?.revisionId === current?.revisionId) return [];
    const payload = {
      changeKind: !previous ? "added" : !current ? "removed" : "modified",
      logicalEntityId,
      entityKind: current?.entityKind || previous.entityKind,
      path: current?.path || previous.path,
      name: current?.name || previous.name,
      beforeRevisionId: previous?.revisionId || null,
      afterRevisionId: current?.revisionId || null,
    };
    const hash = changeSetDigest(changeSetCanonicalJson(payload));
    return [{ changeId: `change-record-${hash.slice(0, 24)}`, ...payload }];
  }).sort((left, right) => left.changeId.localeCompare(right.changeId));
}

function snapshotReference(snapshot) {
  return {
    graphSnapshotId: snapshot.temporalProvenanceGraph.graphSnapshotId,
    sourceSnapshotId: snapshot.temporalProvenanceGraph.sourceSnapshotId,
  };
}

function currentProductRevision(graph, logicalEntityId) {
  const edge = graph.edges.find((candidate) => candidate.type === "CURRENT_REVISION" && candidate.from === logicalEntityId);
  return edge?.to || "";
}

function impactCandidateSet(changeSet, afterSnapshot) {
  const graph = afterSnapshot.temporalProvenanceGraph;
  const changeByLogical = new Map();
  for (const change of changeSet.changes) {
    if (!changeByLogical.has(change.logicalEntityId)) changeByLogical.set(change.logicalEntityId, []);
    changeByLogical.get(change.logicalEntityId).push(change);
  }
  const grouped = new Map();
  for (const relationship of graph.nodes.filter((node) => node.kind === "ReviewedRelationship")) {
    let changedLogicalId = "";
    let targetNodeId = "";
    let targetKind = "";
    if (relationship.relationshipType === "IMPLEMENTS" && changeByLogical.has(relationship.fromNodeId)) {
      changedLogicalId = relationship.fromNodeId;
      targetNodeId = relationship.toNodeId;
      targetKind = relationship.toKind;
    } else if (relationship.relationshipType === "VERIFIED_BY" && changeByLogical.has(relationship.toNodeId)) {
      changedLogicalId = relationship.toNodeId;
      targetNodeId = relationship.fromNodeId;
      targetKind = relationship.fromKind;
    }
    if (!changedLogicalId || !["Feature", "Capability"].includes(targetKind)) continue;
    const revisionId = currentProductRevision(graph, targetNodeId);
    if (!revisionId) continue;
    const key = `${targetKind}:${targetNodeId}:${revisionId}`;
    if (!grouped.has(key)) grouped.set(key, { target: { kind: targetKind, nodeId: targetNodeId, revisionId }, changeIds: new Set(), reviewedRelationshipIds: new Set() });
    const group = grouped.get(key);
    for (const change of changeByLogical.get(changedLogicalId)) group.changeIds.add(change.changeId);
    group.reviewedRelationshipIds.add(relationship.nodeId);
  }
  const candidates = [...grouped.values()].map((group) => {
    const payload = {
      schemaVersion: SCHEMA_VERSION,
      kind: "ChangeImpactCandidate",
      protocol: { name: "head-agent-core-change-impact-candidates", version: CHANGE_SET_VERSION },
      changeSetId: changeSet.changeSetId,
      relationshipType: "IMPACTS",
      target: group.target,
      changeIds: [...group.changeIds].sort(),
      reviewedRelationshipIds: [...group.reviewedRelationshipIds].sort(),
      confidence: 1,
      explanation: "Reviewed Feature mapping relations connect changed code or tests to this product concept.",
      authorityClass: "candidate",
      instructionAuthority: false,
      promotionAuthority: false,
    };
    const hash = changeSetDigest(changeSetCanonicalJson(payload));
    return { ...payload, candidateId: `change-impact-candidate-${hash.slice(0, 24)}`, candidateHash: hash };
  }).sort((left, right) => left.candidateId.localeCompare(right.candidateId));
  const unknowns = candidates.length ? [] : (() => {
    const payload = { changeSetId: changeSet.changeSetId, statement: "No reviewed Feature or Capability mapping connects the changed File, Symbol, or Test entities to Product Canon.", status: "open" };
    const hash = changeSetDigest(changeSetCanonicalJson(payload));
    return [{ ...payload, unknownId: `change-impact-unknown-${hash.slice(0, 24)}` }];
  })();
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    kind: "ChangeImpactCandidateSet",
    protocol: { name: "head-agent-core-change-impact-candidates", version: CHANGE_SET_VERSION },
    projectId: changeSet.projectId,
    sessionId: changeSet.sessionId,
    changeSetId: changeSet.changeSetId,
    afterSourceSnapshotId: changeSet.after.sourceSnapshotId,
    afterGraphSnapshotId: changeSet.after.graphSnapshotId,
    candidates,
    unknowns,
    authorityClass: "candidate-set",
    instructionAuthority: false,
    promotionAuthority: false,
  };
  const hash = changeSetDigest(changeSetCanonicalJson(payload));
  return verifyChangeImpactCandidateSet({ ...payload, candidateSetId: `change-impact-candidates-${hash.slice(0, 24)}`, candidateSetHash: hash }, changeSet, changeSet.projectId);
}

function lineageForChangeSet(projectRoot, resultPacketId, reviewDecisionId) {
  const result = readLineageArtifact({ root: projectRoot, artifactId: requiredText(resultPacketId, "ResultPacket id") }).artifact;
  const review = readLineageArtifact({ root: projectRoot, artifactId: requiredText(reviewDecisionId, "ReviewDecision id") }).artifact;
  if (result.kind !== "ResultPacket" || review.kind !== "ReviewDecision" || review.resultPacketId !== result.resultPacketId) {
    fail("ChangeSet ResultPacket and ReviewDecision lineage do not match.", "CHANGE_SET_LINEAGE_CONFLICT");
  }
  if (review.disposition !== "accept") fail("Only an accepted execution ReviewDecision may authorize a ChangeSet.", "CHANGE_SET_REVIEW_NOT_ACCEPTED");
  const contract = readLineageArtifact({ root: projectRoot, artifactId: result.executionContractId }).artifact;
  const capsule = readContextCapsule({ root: projectRoot, capsuleId: contract.capsuleId }).capsule;
  if (!capsule.repositoryTemporalGraph?.graphSnapshotId) fail("The ExecutionContract ContextCapsule did not pin a temporal GraphSnapshot.", "CHANGE_SET_BASE_SNAPSHOT_MISSING");
  return { result, review, contract, capsule };
}

async function rebuildProjection({ projectRoot, projectId, sourceWorld, additionalChangeSets = [], additionalCandidateSets = [], additionalReviewDecisions = [] }) {
  const projection = loadChangeSetProjection({ projectRoot, projectId, additionalChangeSets, additionalCandidateSets, additionalReviewDecisions });
  return buildWorldModel({
    root: projectRoot,
    persist: true,
    changeSetProjectionInput: projection,
    parentSourceSnapshotIds: sourceWorld.temporalProvenanceGraph.parentSourceSnapshotIds,
    revisionParentIds: sourceWorld.temporalProvenanceGraph.revisionParentIds,
  });
}

export function readChangeSet({ root = ".", changeSetId } = {}) {
  const inspected = readyProject(root, "ChangeSet inspection");
  const file = safeFile(inspected.project.projectRoot, CHANGE_SET_DIRECTORY, changeSetId, "change-set");
  if (!fs.existsSync(file)) fail(`ChangeSet not found: ${changeSetId}`, "CHANGE_SET_NOT_FOUND");
  return { status: "verified", file, changeSet: verifyChangeSet(readJson(file, "ChangeSet"), inspected.project.projectId) };
}

export function readChangeImpactCandidateSet({ root = ".", candidateSetId } = {}) {
  const inspected = readyProject(root, "Change impact candidate inspection");
  const file = safeFile(inspected.project.projectRoot, CHANGE_IMPACT_CANDIDATE_DIRECTORY, candidateSetId, "change-impact-candidates");
  if (!fs.existsSync(file)) fail(`Change impact candidate set not found: ${candidateSetId}`, "CHANGE_IMPACT_CANDIDATE_SET_NOT_FOUND");
  const candidateSet = readJson(file, "Change impact candidate set");
  const changeSet = readChangeSet({ root: inspected.project.projectRoot, changeSetId: candidateSet.changeSetId }).changeSet;
  return { status: "verified", file, candidateSet: verifyChangeImpactCandidateSet(candidateSet, changeSet, inspected.project.projectId) };
}

export function readChangeImpactReviewDecision({ root = ".", reviewDecisionId } = {}) {
  const inspected = readyProject(root, "Change impact review inspection");
  const file = safeFile(inspected.project.projectRoot, CHANGE_IMPACT_REVIEW_DIRECTORY, reviewDecisionId, "change-impact-review-decision");
  if (!fs.existsSync(file)) fail(`Change impact ReviewDecision not found: ${reviewDecisionId}`, "CHANGE_IMPACT_REVIEW_NOT_FOUND");
  const review = readJson(file, "Change impact ReviewDecision");
  const candidateSet = readChangeImpactCandidateSet({ root: inspected.project.projectRoot, candidateSetId: review.candidateSetId }).candidateSet;
  return { status: "verified", file, reviewDecision: verifyChangeImpactReviewDecision(review, candidateSet, inspected.project.projectId) };
}

export async function recordChangeSet({ root = ".", resultPacketId, reviewDecisionId, beforeWorldModelId = "", parentChangeSetIds = [] } = {}) {
  const inspected = readyProject(root, "ChangeSet recording");
  if (inspected.state.activeRunId || inspected.state.pendingReview) fail("ChangeSet recording requires the execution Run and Fresh HEAD review to be complete.", "CHANGE_SET_RUN_CONFLICT");
  const projectRoot = inspected.project.projectRoot;
  const existingStateFile = stateFile(projectRoot);
  if (fs.existsSync(existingStateFile)) {
    const currentState = verifyState(readJson(existingStateFile, "ChangeSet state pointer"), { ...inspected.project, sessionId: inspected.state.sessionId });
    if (currentState.phase === "awaiting-review") fail("The current Change impact candidate set requires review before another ChangeSet is recorded.", "CHANGE_IMPACT_REVIEW_REQUIRED");
  }
  const lineage = lineageForChangeSet(projectRoot, resultPacketId, reviewDecisionId);
  let before;
  if (beforeWorldModelId) before = readWorldModelSnapshot({ root: projectRoot, worldModelId: beforeWorldModelId }).snapshot;
  else {
    const matches = findWorldModelSnapshot({ root: projectRoot, graphSnapshotId: lineage.capsule.repositoryTemporalGraph.graphSnapshotId }).matches;
    const expectedHash = lineage.capsule.snapshot?.sourceDigests?.repositoryWorldModel || "";
    before = matches.find((snapshot) => !expectedHash || snapshot.worldModelHash === expectedHash) || null;
    if (!before) fail("The ContextCapsule World Model snapshot cannot be recovered.", "CHANGE_SET_BASE_SNAPSHOT_MISSING");
  }
  const current = inspectWorldModel({ root: projectRoot });
  if (current.status !== "current") fail("Current repository evidence is stale; index it before recording a ChangeSet.", "CHANGE_SET_SOURCE_DRIFT");
  const after = current.snapshot;
  const changes = revisionChanges(before, after);
  if (!changes.length) fail("No File, Symbol, or Test revision changed between the pinned execution context and current state.", "EMPTY_CHANGE_SET");
  const parents = normalizedIds(parentChangeSetIds, "parentChangeSetIds");
  for (const parentId of parents) readChangeSet({ root: projectRoot, changeSetId: parentId });
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    kind: "ChangeSet",
    protocol: { name: "head-agent-core-change-set", version: CHANGE_SET_VERSION },
    projectId: inspected.project.projectId,
    sessionId: inspected.state.sessionId,
    parentChangeSetIds: parents,
    before: snapshotReference(before),
    after: snapshotReference(after),
    wholePlanId: lineage.review.wholePlanId,
    executionContractId: lineage.result.executionContractId,
    resultPacketId: lineage.result.resultPacketId,
    reviewDecisionId: lineage.review.reviewDecisionId,
    reviewDisposition: lineage.review.disposition,
    changes,
    authority: "reviewed-execution-change-lineage",
    instructionAuthority: false,
    promotionAuthority: false,
  };
  const hash = changeSetDigest(changeSetCanonicalJson(payload));
  const changeSet = verifyChangeSet({ ...payload, changeSetId: `change-set-${hash.slice(0, 24)}`, changeSetHash: hash }, inspected.project.projectId);
  const candidateSet = impactCandidateSet(changeSet, after);
  const projected = await rebuildProjection({ projectRoot, projectId: inspected.project.projectId, sourceWorld: after, additionalChangeSets: [changeSet], additionalCandidateSets: [candidateSet] });
  persistImmutable(safeFile(projectRoot, CHANGE_SET_DIRECTORY, changeSet.changeSetId, "change-set"), changeSet, "ChangeSet");
  persistImmutable(safeFile(projectRoot, CHANGE_IMPACT_CANDIDATE_DIRECTORY, candidateSet.candidateSetId, "change-impact-candidates"), candidateSet, "Change impact candidate set");
  const phase = candidateSet.candidates.length ? "awaiting-review" : "awaiting-evidence";
  const state = writeState(projectRoot, inspected.project, {
    sessionId: inspected.state.sessionId,
    phase,
    changeSetId: changeSet.changeSetId,
    candidateSetId: candidateSet.candidateSetId,
    reviewDecisionId: null,
    worldModelId: projected.snapshot.worldModelId,
    graphSnapshotId: projected.snapshot.temporalProvenanceGraph.graphSnapshotId,
    sourceSnapshotId: projected.snapshot.temporalProvenanceGraph.sourceSnapshotId,
  });
  return { status: phase === "awaiting-review" ? "awaiting_change_impact_review" : "awaiting_change_impact_evidence", state, changeSet, candidateSet, worldModel: { worldModelId: projected.snapshot.worldModelId, ...snapshotReference(projected.snapshot) }, authority: "impact-candidates-have-no-promotion-authority" };
}

function buildImpactReview(candidateSet, disposition, acceptedCandidateIds, rationale) {
  const allIds = candidateSet.candidates.map((item) => item.candidateId);
  const selected = disposition === "accept-all" ? allIds : disposition === "reject" ? [] : normalizedIds(acceptedCandidateIds, "acceptedCandidateIds");
  const known = new Set(allIds);
  if (selected.some((id) => !known.has(id))) fail("Change impact review references an unknown candidate.", "UNKNOWN_CHANGE_IMPACT_CANDIDATE");
  if (disposition === "accept-selection" && !selected.length) fail("accept-selection requires at least one candidate.", "CHANGE_IMPACT_SELECTION_REQUIRED");
  const accepted = new Set(selected);
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    kind: "ReviewDecision",
    protocol: { name: "head-agent-core-change-impact-review", version: CHANGE_SET_VERSION },
    decisionScope: "change-impact",
    projectId: candidateSet.projectId,
    sessionId: candidateSet.sessionId,
    changeSetId: candidateSet.changeSetId,
    candidateSetId: candidateSet.candidateSetId,
    disposition,
    acceptedCandidateIds: selected,
    rejectedCandidateIds: allIds.filter((id) => !accepted.has(id)),
    rationale: requiredText(rationale, "Review rationale"),
    authority: "explicit-user-change-impact-review",
    instructionAuthority: true,
    promotionAuthority: disposition.startsWith("accept"),
  };
  const hash = changeSetDigest(changeSetCanonicalJson(payload));
  return verifyChangeImpactReviewDecision({ ...payload, reviewDecisionId: `change-impact-review-decision-${hash.slice(0, 24)}`, reviewDecisionHash: hash }, candidateSet, candidateSet.projectId);
}

export async function reviewChangeImpact({ root = ".", candidateSetId, disposition, acceptedCandidateIds = [], rationale } = {}) {
  const inspected = readyProject(root, "Change impact review");
  if (inspected.state.activeRunId || inspected.state.pendingReview) fail("Change impact review cannot advance while a Run is active or awaiting review.", "CHANGE_SET_RUN_CONFLICT");
  const projectRoot = inspected.project.projectRoot;
  if (!fs.existsSync(stateFile(projectRoot))) fail("No ChangeSet is awaiting impact review.", "CHANGE_SET_NOT_STARTED");
  const state = verifyState(readJson(stateFile(projectRoot), "ChangeSet state pointer"), { ...inspected.project, sessionId: inspected.state.sessionId });
  if (state.phase !== "awaiting-review" || state.candidateSetId !== candidateSetId) fail("Change impact review references a stale or non-reviewable candidate set.", "STALE_CHANGE_IMPACT_CANDIDATE_SET");
  const candidateSet = readChangeImpactCandidateSet({ root: projectRoot, candidateSetId }).candidateSet;
  const current = inspectWorldModel({ root: projectRoot });
  if (current.status !== "current" || current.snapshot.worldModelId !== state.worldModelId
    || current.snapshot.temporalProvenanceGraph.graphSnapshotId !== state.graphSnapshotId
    || current.snapshot.temporalProvenanceGraph.sourceSnapshotId !== candidateSet.afterSourceSnapshotId) {
    fail("Repository evidence changed after impact inference; record a new ChangeSet or candidate set.", "CHANGE_IMPACT_SOURCE_DRIFT");
  }
  const normalizedDisposition = requiredText(disposition, "Review disposition").toLocaleLowerCase();
  if (!["accept-all", "accept-selection", "reject"].includes(normalizedDisposition)) fail("Change impact disposition must be accept-all, accept-selection, or reject.", "INVALID_CHANGE_IMPACT_REVIEW_DISPOSITION");
  const review = buildImpactReview(candidateSet, normalizedDisposition, acceptedCandidateIds, rationale);
  const projected = await rebuildProjection({ projectRoot, projectId: inspected.project.projectId, sourceWorld: current.snapshot, additionalReviewDecisions: [review] });
  persistImmutable(safeFile(projectRoot, CHANGE_IMPACT_REVIEW_DIRECTORY, review.reviewDecisionId, "change-impact-review-decision"), review, "Change impact ReviewDecision");
  const nextPhase = normalizedDisposition === "reject" ? "rejected" : "reviewed";
  const nextState = writeState(projectRoot, inspected.project, {
    sessionId: inspected.state.sessionId,
    phase: nextPhase,
    changeSetId: state.changeSetId,
    candidateSetId,
    reviewDecisionId: review.reviewDecisionId,
    worldModelId: projected.snapshot.worldModelId,
    graphSnapshotId: projected.snapshot.temporalProvenanceGraph.graphSnapshotId,
    sourceSnapshotId: projected.snapshot.temporalProvenanceGraph.sourceSnapshotId,
  });
  return { status: nextPhase === "reviewed" ? "change_impacts_reviewed" : "change_impacts_rejected", state: nextState, reviewDecision: review, reviewedImpactCount: review.acceptedCandidateIds.length, worldModel: { worldModelId: projected.snapshot.worldModelId, ...snapshotReference(projected.snapshot) } };
}

export function inspectChangeSets({ root = "." } = {}) {
  const inspected = readyProject(root, "ChangeSet inspection");
  const file = stateFile(inspected.project.projectRoot);
  if (!fs.existsSync(file)) return { status: "not_started", projectId: inspected.project.projectId, sessionId: inspected.state.sessionId, nextAction: "Record a ChangeSet after an accepted execution review and repository re-index." };
  const state = verifyState(readJson(file, "ChangeSet state pointer"), { ...inspected.project, sessionId: inspected.state.sessionId });
  const changeSet = readChangeSet({ root: inspected.project.projectRoot, changeSetId: state.changeSetId }).changeSet;
  const candidateSet = readChangeImpactCandidateSet({ root: inspected.project.projectRoot, candidateSetId: state.candidateSetId }).candidateSet;
  const reviewDecision = state.reviewDecisionId ? readChangeImpactReviewDecision({ root: inspected.project.projectRoot, reviewDecisionId: state.reviewDecisionId }).reviewDecision : null;
  const world = inspectWorldModel({ root: inspected.project.projectRoot });
  return {
    status: state.phase.replaceAll("-", "_"), state, changeSet, candidateSet, reviewDecision,
    worldModel: { status: world.status, worldModelId: world.snapshot.worldModelId, graphSnapshotId: world.snapshot.temporalProvenanceGraph.graphSnapshotId, sourceSnapshotId: world.snapshot.temporalProvenanceGraph.sourceSnapshotId, matchesState: world.snapshot.worldModelId === state.worldModelId },
    authority: { changeSet: "reviewed-execution-change-lineage", impactCandidates: "non-authoritative-until-explicit-review", reviewedImpacts: "explicit-user-reviewed-impact-facts", graph: "rebuildable-derived-projection", git: "optional-vcs-evidence-not-required" },
  };
}
