import fs from "node:fs";
import { artifactAuthorityBoundary } from "./authority-plane-contract.mjs";
import {
  canonicalGraphJson, collectProjectGraphInventory, projectGraphDigest,
  readGraphRecord, refreshProjectGraphIndex, safeGraphFile,
} from "./discovery-index.mjs";

export const PROJECT_GRAPH_PROTOCOL_VERSION = "0.2.0";
export const indexProjectGraph = refreshProjectGraphIndex;
const layerCache = new Map();
const resultCache = new Map();
const adapterFailures = new Map();
const adapterIds = new WeakMap();
let adapterSequence = 0;
const authority = Object.freeze({ plane: "P4-derived-view", persistence: "none", instructionAuthority: false,
  promotionAuthority: false, recoveryAuthority: false, executionAuthority: false, ordinaryWorkBlocked: false });
const id = (prefix, payload) => `${prefix}-${projectGraphDigest(payload).slice(0, 24)}`;
const fail = (code, message = code) => { const error = new Error(message); error.code = code; throw error; };
const reason = (error) => error.code || "PROJECT_GRAPH_LAYER_UNAVAILABLE";
const clone = (value) => structuredClone(value);
function boundedCache(cache, key, value, limit = 16) { if (cache.size >= limit) cache.delete(cache.keys().next().value); cache.set(key, value); return value; }
const layerFor = (relative) => relative.startsWith(".head/observations/source-bundles/") ? "source-bundles"
  : relative.startsWith(".head/observations/") ? "observations"
    : relative.startsWith(".head/onboarding/") ? "onboarding"
      : relative.startsWith(".head/product-policy/") ? "policy"
        : relative.startsWith(".head/change-sets/") ? "changes"
          : relative.startsWith(".head/release-observations/") ? "releases"
            : relative.startsWith(".head/conformance/") ? "conformance"
              : relative.startsWith(".head/lineage/") ? "lineage"
                : relative.startsWith(".head/sessions/") ? "sessions"
                  : relative.startsWith(".head/project-direction/") ? "direction" : "product";

function recordIdentity(document) {
  const field = {
    ObservationRecord: "observationId", DerivedObservationRecord: "derivedObservationId", ObservationTypeDescriptor: "descriptorId",
    ObservationCollectionReceipt: "receiptId", OnboardingCandidateSet: "candidateSetId", OnboardingProductCandidate: "candidateId",
    ProductPolicyCandidate: "candidateId", ReviewDecision: "reviewDecisionId", ProductModelRevision: "productModelId",
    WholePlanSnapshot: "wholePlanId", ExecutionContract: "executionContractId", ResultPacket: "resultPacketId",
    ConformanceFindingCandidate: "findingId", ConformanceDispositionReceipt: "receiptId", ConformanceResolutionCandidate: "resolutionId",
    ChangeSet: "changeSetId", ChangeImpactCandidateSet: "candidateSetId", VcsEvidence: "vcsEvidenceId",
    BranchStateObservation: "branchStateObservationId", DeploymentResultObservation: "deploymentResultObservationId", ReleaseObservation: "releaseObservationId",
    HeadSession: "sessionRecordId", HeadSessionStateReference: "sessionId", RunStateReference: "runId",
    ProjectDirection: "directionId", SessionRunCheckpoint: "checkpointId",
  }[document.kind];
  if (field && document[field]) return document[field];
  for (const key of ["artifactId", "observationId", "derivedObservationId", "descriptorId", "receiptId", "candidateSetId", "candidateId", "reviewDecisionId", "productModelId", "wholePlanId", "executionContractId", "resultPacketId", "findingId", "resolutionId", "changeSetId", "vcsEvidenceId", "branchStateObservationId", "deploymentResultObservationId", "releaseObservationId", "checkpointId", "directionId", "sessionRecordId", "runId", "sessionId"]) if (document[key]) return document[key];
  return null;
}

function nodeFromRecord(document, origin, views, extra = {}) {
  const nodeId = recordIdentity(document);
  if (!nodeId) fail("PROJECT_GRAPH_RECORD_ID_MISSING");
  // Only bounded navigation facts are projected. A ReviewDecision's effect
  // payload, provider runtime identity and arbitrary instruction fields are
  // never exposed as usable authorization through this view.
  const fields = ["kind", "name", "statement", "rationale", "objective", "purpose", "scope", "status", "disposition", "outcome", "planDelta", "unknowns", "explanation", "productKind", "key", "typeKey", "subject", "temporalScope", "coverage", "claim", "assessment", "sourceSnapshotId", "worldModelId", "productModelId", "sessionId", "runId", "ref", "commit", "environmentKey", "policyKey", "baseProductModelId", "previousProductModelId", "resultingProductModelId"];
  const content = Object.fromEntries(fields.filter((field) => Object.hasOwn(document, field)).map((field) => [field, document[field]]));
  for (const key of ["statement", "rationale", "objective", "purpose", "scope", "explanation", "outcome", "planDelta"]) if (typeof content[key] === "string") content[key] = content[key].slice(0, 2048);
  if (content.unknowns) content.unknowns = content.unknowns.slice(0, 32).map((entry) => String(entry).slice(0, 512));
  if (document.kind === "ProductPolicyCandidate") content.proposedPolicy = Object.fromEntries(
    ["key", "name", "statement", "description"].filter((field) => typeof document.proposedPolicy?.[field] === "string")
      .map((field) => [field, document.proposedPolicy[field].slice(0, 2048)]));
  if (document.kind === "ProjectDirection") {
    // This is an excerpt of an independently verified P2 original, not a new
    // direction, a recovery field source or an execution authorization.
    const input = document.input;
    content.directionEvidence = { goal: input.goal.slice(0, 2048) };
    const coverage = { goal: { truncated: input.goal.length > 2048 } };
    for (const field of ["constraints", "decisions", "cancelledActions"]) {
      content.directionEvidence[field] = input[field].slice(0, 32).map(value => value.slice(0, 512));
      coverage[field] = { totalCount: input[field].length, includedCount: content.directionEvidence[field].length,
        omittedCount: Math.max(0, input[field].length - 32), truncatedCount: input[field].slice(0, 32).filter(value => value.length > 512).length };
    }
    content.directionContentCoverage = { ...coverage, partial: coverage.goal.truncated ||
      ["constraints", "decisions", "cancelledActions"].some(field => coverage[field].omittedCount || coverage[field].truncatedCount) };
  }
  return { nodeId, ...content, kind: document.kind || "RecordReference", views, origin,
    sourceReference: { artifactId: nodeId, path: origin.path, digest: origin.digest },
    integrity: "verified", freshness: "retained-evidence", reviewState: document.disposition || "not-applicable",
    sourceAuthority: document.authority || null, ...authority, ...extra };
}

function relation(type, from, to, provenance, extra = {}) {
  const payload = { type, from, to, provenance, ...extra, instructionAuthority: false, promotionAuthority: false, recoveryAuthority: false, executionAuthority: false };
  return { edgeId: id("project-relation", payload), ...payload };
}

async function verifiedLayer(inventory, layer, entries, model) {
  const dependencies = inventory.readerDependencies?.[layer] || null;
  const key = projectGraphDigest({ root: inventory.projectRoot, projectId: inventory.project.projectId, layer,
    entries, dependencies, model: ["onboarding", "policy"].includes(layer) ? model?.productModelId : null });
  // Never reuse success on an incomplete dependency observation. A failed
  // optional layer remains local to that layer, not an ordinary-work gate.
  if (dependencies && (!dependencies.complete || dependencies.unavailable.length)) fail("PROJECT_GRAPH_DEPENDENCY_UNAVAILABLE");
  if (layerCache.has(key)) return { ...clone(layerCache.get(key)), reused: true };
  const nodes = [], edges = [], skipped = [], sources = [];
  const projectId = inventory.project.projectId, root = inventory.projectRoot;
  const add = (document, relative, views = ["work"], extra = {}) => {
    const entry = entries.find((item) => item.path === relative);
    const node = nodeFromRecord(document, { layer, path: relative, digest: entry?.sha256 || projectGraphDigest(document) }, views, extra);
    nodes.push(node); return node;
  };
  const records = entries.map((entry) => {
    const read = readGraphRecord(root, entry.path);
    if (read.digest !== entry.sha256) fail("PROJECT_GRAPH_READ_DRIFT");
    if (read.document.projectId && read.document.projectId !== projectId) fail("PROJECT_GRAPH_CROSS_PROJECT");
    if (read.document.projectRoot && read.document.projectRoot !== root) fail("PROJECT_GRAPH_CROSS_ROOT");
    return { ...read, path: entry.path };
  });
  if (layer === "product") {
    if (model) {
      const origin = { layer, path: ".head/context/product-model.json", digest: entries[0]?.sha256 || model.productModelHash };
      nodes.push(nodeFromRecord({ ...model, kind: "ProductModelRevision" }, origin, ["product", "work"], { reviewState: "canon-source", revisionId: model.productModelId }));
      for (const [field, kind] of Object.entries({ featureGroups: "FeatureGroup", capabilities: "Capability", features: "Feature", requirements: "Requirement", constraints: "Constraint", decisions: "Decision", policies: "Policy" })) {
        for (const entity of model[field] || []) {
          const nodeId = id("product-reference", { projectId, revisionId: model.productModelId, kind, key: entity.key });
          nodes.push({ nodeId, kind, ...entity, origin, views: ["product"], revisionId: model.productModelId,
            reviewState: "canon-source", freshness: "current-canon-bytes", integrity: "verified",
            sourceReference: { artifactId: model.productModelId, path: origin.path, digest: origin.digest, entityKey: entity.key }, ...authority });
          edges.push(relation("CONTAINS", model.productModelId, nodeId, origin));
        }
      }
    }
  } else if (layer === "observations") {
    const { loadObservationArtifacts } = await import("./observation-store.mjs");
    const verified = loadObservationArtifacts({ projectRoot: root, projectId });
    for (const document of [...verified.descriptors, ...verified.observations, ...verified.derivedObservations, ...verified.receipts]) {
      const record = records.find((item) => recordIdentity(item.document) === recordIdentity(document));
      const node = add(document, record.path, ["work", "product"], { reviewState: "observed-evidence", payload: safeObservationPayload(document) });
      if (document.descriptorId && node.nodeId !== document.descriptorId) edges.push(relation("CONFORMS_TO", node.nodeId, document.descriptorId, node.origin));
      for (const input of document.inputObservations || []) edges.push(relation("DERIVED_FROM", node.nodeId, input.observationId, node.origin));
      if (document.kind === "ObservationCollectionReceipt") edges.push(relation("EVIDENCED_BY", document.observationId, node.nodeId, node.origin));
      if (document.payload?.path && document.payload?.sourceDigest) sources.push({ path: document.payload.path, digest: document.payload.sourceDigest, nodeId: node.nodeId, origin: node.origin });
    }
  } else if (layer === "source-bundles") {
    const { verifySourceObservation, readSourceFailure } = await import("./source-observation.mjs");
    for (const record of records) {
      if (record.document.failure) {
        const key = record.path.split("/").at(-1).slice(0, -5);
        const retained = readSourceFailure(root, projectId, key);
        const failure = retained.failure;
        const nodeId = `source-failure-${key}`;
        const origin = { layer, path: record.path, digest: record.digest };
        nodes.push({ nodeId, kind: "SourceCollectionFailure", reasonCode: failure.reasonCode || failure.outcome?.reasonCode || "source-unavailable",
          views: ["work"], origin, integrity: "verified", freshness: retained.sourceState, reviewState: "failed-observation",
          sourceReference: { path: record.path, digest: record.digest }, ...authority });
        for (const source of failure.sources || []) sources.push({ ...source, nodeId, origin });
      } else {
        verifySourceObservation(root, projectId, record.document, { requireCurrent: false });
        const { evidence, observation } = record.document;
        const node = add(observation, record.path, ["work", "product"], { reviewState: "observed-evidence", payload: safeObservationPayload(observation) });
        for (const source of evidence.sources) sources.push({ path: source.path, digest: source.digest, nodeId: node.nodeId, origin: node.origin });
      }
    }
  } else if (layer === "lineage") {
    const { readLineageArtifact } = await import("./execution-lineage.mjs");
    for (const record of records) {
      const artifactId = record.path.split("/").at(-1).slice(0, -5);
      const artifact = readLineageArtifact({ root, artifactId }).artifact;
      if (projectGraphDigest(artifact) !== projectGraphDigest(record.document)) fail("PROJECT_GRAPH_READ_DRIFT");
      const node = add(artifact, record.path, ["work", "product"], { revisionId: artifactId,
        reviewState: artifact.kind === "ReviewDecision" ? `historical-${artifact.disposition}` : "not-applicable" });
      for (const link of artifact.lineage || []) edges.push(relation(link.relation, node.nodeId, link.targetId, node.origin));
    }
  } else if (layer === "onboarding") {
    const { loadOnboardingGraphProjection } = await import("./onboarding-projection.mjs");
    const projected = loadOnboardingGraphProjection({ projectRoot: root, projectId, currentProductModelId: model.productModelId });
    for (const document of [...projected.candidateSets, ...projected.reviewDecisions, ...projected.productModelRevisions]) {
      const record = records.find((item) => recordIdentity(item.document) === recordIdentity(document));
      const node = add(document, record.path, ["work", "product"], { revisionId: document.productModelId || document.candidateSetId,
        reviewState: document.kind.includes("Review") ? `historical-${document.disposition}` : document.candidates ? "candidate" : "retained-product-revision" });
      for (const candidate of document.candidates || []) {
        const reviews = projected.reviewDecisions.filter((review) => review.candidateSetId === document.candidateSetId);
        const accepted = reviews.some((review) => review.acceptedCandidateIds?.includes(candidate.candidateId));
        const rejected = reviews.some((review) => review.rejectedCandidateIds?.includes(candidate.candidateId) || review.disposition === "reject");
        const reviewState = accepted && rejected ? "conflicting-reviewed-evidence" : accepted ? "accepted-candidate-evidence" : rejected ? "rejected" : "candidate";
        nodes.push({ ...candidate, nodeId: candidate.candidateId, kind: "OnboardingProductCandidate", views: ["work", "product"], origin: node.origin,
          sourceReference: { ...node.sourceReference, candidateId: candidate.candidateId }, integrity: "verified", freshness: "retained-evidence", reviewState,
          revisionId: document.productModelId, ...authority });
        edges.push(relation("CONTAINS", node.nodeId, candidate.candidateId, node.origin));
        for (const evidenceId of candidate.evidenceIds || []) edges.push(relation("SUPPORTED_BY", candidate.candidateId, evidenceId, node.origin));
      }
      for (const evidence of document.evidence || []) {
        nodes.push({ ...evidence, nodeId: evidence.evidenceId, kind: "OnboardingEvidence", views: ["work", "product"], origin: node.origin,
          integrity: "verified", freshness: "retained-evidence", reviewState: "observed-evidence", ...authority });
        if (evidence.path && evidence.contentDigest) sources.push({ path: evidence.path, digest: evidence.contentDigest, nodeId: evidence.evidenceId, origin: node.origin });
      }
      if (document.candidateSetId && document.reviewDecisionId) {
        edges.push(relation("REVIEWS", node.nodeId, document.candidateSetId, node.origin));
        for (const candidateId of document.acceptedCandidateIds || []) edges.push(relation("ACCEPTS_EVIDENCE", node.nodeId, candidateId, node.origin));
        for (const candidateId of document.rejectedCandidateIds || []) edges.push(relation("REJECTS", node.nodeId, candidateId, node.origin));
      }
    }
    for (const reference of projected.historicalCoverage?.references || []) {
      nodes.push({ nodeId: reference.artifactId, kind: "HistoricalRecordReference", views: ["work", "product"],
        sourceReference: { path: reference.path, digest: reference.sha256 }, origin: { layer, path: reference.path, digest: reference.sha256 },
        revisionId: reference.artifactId, integrity: "verified-historical-boundary", freshness: "historical", reviewState: "historical-opaque", ...authority });
    }
  } else if (layer === "policy") {
    const { verifyProductPolicyCandidate, verifyProductPolicyReviewDecision } = await import("./product-policy.mjs");
    const candidates = records.filter((record) => record.document.kind === "ProductPolicyCandidate").map((record) => verifyProductPolicyCandidate(record.document, projectId));
    const reviews = records.filter((record) => record.document.kind === "ReviewDecision").map((record) => {
      const candidate = candidates.find((item) => item.candidateId === record.document.candidateId);
      if (!candidate) fail("PROJECT_GRAPH_POLICY_LINEAGE_MISSING");
      return verifyProductPolicyReviewDecision(record.document, candidate, projectId);
    });
    if (new Set(reviews.map((review) => review.candidateId)).size !== reviews.length) fail("PRODUCT_POLICY_REVIEW_CONFLICT");
    for (const document of [...candidates, ...reviews]) {
      const record = records.find((item) => recordIdentity(item.document) === recordIdentity(document));
      const review = reviews.find((item) => item.candidateId === document.candidateId);
      const node = add(document, record.path, ["work", "product"], { reviewState: document.reviewDecisionId ? `historical-${document.disposition}`
        : review?.disposition === "reject" ? "rejected" : review?.disposition === "accept" ? "accepted-candidate-evidence" : "candidate",
        revisionId: recordIdentity(document),
        policyKey: document.policyKey || candidates.find((item) => item.candidateId === document.candidateId)?.policyKey,
        baseProductModelId: document.baseProductModelId || document.previousProductModelId,
        applicationStatus: !review ? "awaiting-review" : review.disposition === "reject" ? "rejected"
          : document.resultingProductModelId === model?.productModelId ? "applied-current" : "accepted-historical-or-diverged" });
      if (document.reviewDecisionId) edges.push(relation("REVIEWS", node.nodeId, document.candidateId, node.origin));
    }
  } else if (layer === "releases" || layer === "changes") {
    const projection = layer === "releases" ? await import("./release-observation.mjs") : await import("./change-set-projection.mjs");
    const projected = layer === "releases" ? projection.loadReleaseObservationProjection({ projectRoot: root, projectId })
      : projection.loadChangeSetProjection({ projectRoot: root, projectId });
    for (const documents of Object.values(projected)) if (Array.isArray(documents)) for (const document of documents) {
      const record = records.find((item) => recordIdentity(item.document) === recordIdentity(document));
      if (!record || !document.kind) continue;
      const node = add(document, record.path, ["work", "product"], { reviewState: document.candidates ? "candidate" : "observed-evidence" });
      for (const [field, type] of [["branchStateObservationId", "AT_BRANCH_STATE"], ["deploymentResultObservationId", "OBSERVES_DEPLOYMENT"], ["changeSetId", "RELATES_TO_CHANGE"], ["candidateSetId", "REVIEWS"]]) {
        if (document[field] && document[field] !== node.nodeId) edges.push(relation(type, node.nodeId, document[field], node.origin));
      }
    }
  } else if (layer === "conformance") {
    const contract = await import("./conformance-contract.mjs");
    const findings = new Map();
    for (const record of records.filter((item) => item.document.kind === "ConformanceFindingCandidate")) {
      contract.verifyConformanceFindingCandidate(record.document, projectId); findings.set(record.document.findingId, record);
      add(record.document, record.path, ["work", "product"], { reviewState: "candidate" });
    }
    for (const record of records.filter((item) => item.document.kind !== "ConformanceFindingCandidate")) {
      const document = record.document, finding = findings.get(document.findingId)?.document;
      if (!finding) fail("PROJECT_GRAPH_FINDING_LINEAGE_MISSING");
      if (document.kind === "ConformanceDispositionReceipt") contract.verifyConformanceDispositionReceipt(document, finding, projectId);
      else if (document.kind === "ConformanceResolutionCandidate") contract.verifyConformanceResolutionCandidate(document, finding, projectId);
      else { skipped.push({ path: record.path, reasonCode: "PROJECT_GRAPH_UNSUPPORTED_RECORD" }); continue; }
      const node = add(document, record.path, ["work", "product"], { reviewState: document.kind.endsWith("Candidate") ? "candidate" : `disposition-${document.disposition}` });
      edges.push(relation("RELATES_TO_FINDING", node.nodeId, document.findingId, node.origin));
    }
  } else if (layer === "direction") {
    const { readProjectDirection, readProjectDirectionRevision } = await import("./project-direction.mjs");
    let current = null;
    try { current = readProjectDirection({ root }); }
    catch (error) { skipped.push({ path: ".head/project-direction/current.json", reasonCode: reason(error) }); }
    for (const record of records.filter((entry) => entry.path.includes("/revisions/"))) {
      const document = readProjectDirectionRevision({ root, directionId: record.document.directionId });
      if (projectGraphDigest(document) !== projectGraphDigest(record.document)) fail("PROJECT_GRAPH_READ_DRIFT");
      const node = add({ ...document, objective: document.input.goal }, record.path, ["work", "product"], {
        revisionId: document.directionId, freshness: document.directionId === current?.directionId ? "current-direction-reference" : "historical-direction-reference",
        reviewState: "user-direction-reference" });
      if (document.previousDirectionId) edges.push(relation("FOLLOWS_DIRECTION", node.nodeId, document.previousDirectionId, node.origin));
    }
  } else if (layer === "sessions") {
    const { verifySessionRecord } = await import("./onboarding-contract.mjs");
    const { readRecoveryCheckpoint } = await import("./compaction-recovery.mjs");
    const defaultState = records.find((entry) => entry.path === ".head/sessions/current.json")?.document;
    for (const record of records) {
      const document = record.document;
      if (record.path.includes("/records/")) {
        verifySessionRecord(document, { projectId });
        const node = add(document, record.path, ["work"], { freshness: "historical-session-anchor", reviewState: "session-identity-reference" });
        edges.push(relation("IDENTIFIES_SESSION", node.nodeId, document.sessionId, node.origin));
      } else if (record.path.includes("/ledger/")) {
        const checkpoint = readRecoveryCheckpoint({ root, checkpointId: document.checkpointId, historical: true }).checkpoint;
        if (projectGraphDigest(checkpoint) !== projectGraphDigest(document)) fail("PROJECT_GRAPH_READ_DRIFT");
        const node = add(checkpoint, record.path, ["work"], { freshness: "historical-checkpoint-reference", reviewState: "recovery-record-reference", revisionId: checkpoint.checkpointId });
        edges.push(relation("RECORDED_FOR_SESSION", node.nodeId, checkpoint.sessionId, node.origin));
        for (const [field, type] of [["wholePlanId", "REFERS_TO_PLAN"], ["executionContractId", "REFERS_TO_CONTRACT"], ["resultPacketId", "REFERS_TO_RESULT"]]) {
          if (checkpoint[field]) edges.push(relation(type, node.nodeId, checkpoint[field], node.origin));
        }
      } else if (record.path.endsWith("/current.json")) {
        const expectedId = record.path === ".head/sessions/current.json" ? document.sessionId : record.path.split("/")[3];
        if (document.schemaVersion !== 1 || !/^session-[a-fA-F0-9-]{36}$/.test(document.sessionId || "") || expectedId !== document.sessionId
          || document.projectId && document.projectId !== projectId) fail("HEAD_SESSION_IDENTITY_MISMATCH");
        const node = add({ ...document, kind: "HeadSessionStateReference" }, record.path, ["work"], { freshness: "current-session-record-bytes", reviewState: "session-progress-reference",
          activeRunId: document.activeRunId || null, mode: document.mode, latestCheckpoint: document.latestCheckpoint || null,
          revisionId: record.digest, integrity: "identity-and-original-bytes-verified" });
        for (const [field, type] of [["currentWholePlanId", "REFERS_TO_PLAN"], ["activeRunId", "ACTIVE_RUN"], ["lastResultPacketId", "LAST_RESULT"], ["latestCheckpoint", "CHECKPOINT_REFERENCE"]]) {
          if (document[field]) edges.push(relation(type, node.nodeId, document[field], node.origin));
        }
      } else if (record.path.endsWith("/run.json")) {
        const ownerId = document.sessionId || defaultState?.sessionId;
        if (document.schemaVersion !== 1 || document.projectId !== projectId || !/^run-[0-9]+-[a-f0-9]{6}$/.test(document.runId || "")
          || !/^session-[a-fA-F0-9-]{36}$/.test(ownerId || "") || record.path.split("/").at(-2) !== document.runId
          || !["active", "awaiting_review", "reviewed", "failed", "cancelled", "unknown"].includes(document.status)) fail("PROJECT_GRAPH_RUN_IDENTITY_MISMATCH");
        const node = add({ ...document, kind: "RunStateReference", sessionId: ownerId }, record.path, ["work", "product"], {
          freshness: "retained-run-record-bytes", reviewState: "execution-progress-evidence", revisionId: record.digest, integrity: "identity-and-original-bytes-verified" });
        edges.push(relation("RECORDED_FOR_SESSION", node.nodeId, ownerId, node.origin));
        for (const [field, type] of [["wholePlanId", "REFERS_TO_PLAN"], ["executionContractId", "REFERS_TO_CONTRACT"], ["resultPacketId", "REFERS_TO_RESULT"], ["reviewDecisionId", "REFERS_TO_REVIEW"]]) {
          if (document[field]) edges.push(relation(type, node.nodeId, document[field], node.origin));
        }
      } else skipped.push({ path: record.path, reasonCode: "PROJECT_GRAPH_UNSUPPORTED_RECORD" });
    }
  } else {
    for (const record of records) skipped.push({ path: record.path, reasonCode: "PROJECT_GRAPH_UNSUPPORTED_RECORD" });
  }
  const result = { nodes, edges, sources, skipped, reused: false };
  boundedCache(layerCache, key, clone(result), 32);
  return result;
}

function safeObservationPayload(document) {
  // Retained Observation payload is domain data. Bound its display and avoid
  // duplicating parser response dumps into the graph's normal explanation.
  if (!document.payload) return undefined;
  const payload = { ...document.payload }; delete payload.details;
  return canonicalGraphJson(payload).length <= 4096 ? payload : { omitted: true, evidenceDigest: projectGraphDigest(payload) };
}

function limits(options) {
  const integer = (value, defaultValue, max, minimum = 1) => { const number = value == null ? defaultValue : Number(value); if (!Number.isInteger(number) || number < minimum || number > max) fail("INVALID_PROJECT_GRAPH_BOUND"); return number; };
  const strings = (values, max) => { if (values == null) return []; if (!Array.isArray(values) || values.length > max || values.some((value) => typeof value !== "string" || !value || value.length > 512)) fail("INVALID_PROJECT_GRAPH_FILTER"); return [...new Set(values)].sort(); };
  if (!["all", "work", "product"].includes(options.view || "all")) fail("INVALID_PROJECT_GRAPH_VIEW");
  if (options.query != null && (typeof options.query !== "string" || options.query.length > 4096)) fail("INVALID_PROJECT_GRAPH_QUERY");
  if (options.details != null && typeof options.details !== "boolean") fail("INVALID_PROJECT_GRAPH_DETAILS");
  const details = options.details === true;
  return { query: String(options.query || "").trim(), anchorIds: strings(options.anchorIds, 32), paths: [...new Set(strings(options.paths, 32).map(value => value.replaceAll("\\", "/")))].sort(), details,
    view: options.view || "all", depth: integer(options.depth, 1, 8, 0), maxNodes: integer(options.maxNodes, details ? 60 : 8, 500), maxEdges: integer(options.maxEdges, details ? 120 : 12, 1000),
    includeCandidates: options.includeCandidates !== false };
}

function sourceFacts(root, sources, nodes) {
  const facts = new Map(), byId = new Map(nodes.map((node) => [node.nodeId, node]));
  for (const source of sources) {
    const key = canonicalGraphJson({ path: source.path, digest: source.digest });
    if (!facts.has(key)) {
      let currentDigest = null, state = "unavailable";
      try { const file = safeGraphFile(root, source.path); const stat = fs.lstatSync(file); if (!stat.isFile() || stat.size > 64 * 1024 * 1024) fail("PROJECT_GRAPH_SOURCE_LIMIT"); currentDigest = projectGraphDigest(fs.readFileSync(file)); state = currentDigest === source.digest ? "current-source-bytes" : "historical-source-bytes"; }
      catch { /* Missing original does not corrupt intact retained evidence. */ }
      facts.set(key, { path: source.path, retainedDigest: source.digest, currentDigest, freshness: state });
    }
    const fact = facts.get(key), node = byId.get(source.nodeId);
    if (node) { node.freshness = fact.freshness; node.sourceCurrentness = fact; }
  }
  return [...facts.values()].sort((a, b) => canonicalGraphJson(a).localeCompare(canonicalGraphJson(b)));
}

const foldSearch = value => value.normalize("NFKC").toLowerCase();
const nodePaths = node => [node.path, node.sourceCurrentness?.path, node.sourceReference?.path].filter(value => typeof value === "string");
function searchTerms(value) {
  // Identifier and punctuation normalization only, not product/task inference.
  // Preserve originals; Korean particle stripping adds an alias, never a gate.
  const text = value.normalize("NFKC");
  const terms = new Set();
  for (const token of text.match(/[\p{Script=Hangul}]+|[\p{Script=Latin}\p{N}_$]+|[\p{L}\p{N}]+/gu) || []) {
    terms.add(foldSearch(token));
    for (const part of token.replace(/([a-z\d])([A-Z])/g, "$1 $2").replace(/([A-Z])([A-Z][a-z])/g, "$1 $2").split(/[\s_$]+/u)) if (part) terms.add(foldSearch(part));
    if (/^[\p{Script=Hangul}]+$/u.test(token)) {
      const stem = token.replace(/(?:에서는|으로는|에서|으로|에게|까지|부터|처럼|보다|은|는|이|가|을|를|의|도|와|과)$/u, "");
      if (stem.length >= 2) terms.add(foldSearch(stem));
    }
  }
  return terms;
}
function searchText(node) {
  // Only display/domain values participate. Hashes, authority flags, revision
  // keys and provenance boilerplate must not crowd out actual task evidence.
  const values = [];
  function append(value, depth = 0) {
    if (values.length >= 256 || depth > 4) return;
    if (typeof value === "string") values.push(value.slice(0, 4096));
    else if (Array.isArray(value)) for (const entry of value.slice(0, 32)) append(entry, depth + 1);
    else if (value && typeof value === "object") for (const [key, entry] of Object.entries(value).slice(0, 64)) {
      if (!/(?:authority|digest|hash|revision|schema|protocol|provenance|sessionId|runId|artifactId|sourceSnapshotId|worldModelId|productModelId)/i.test(key)) append(entry, depth + 1);
    }
  }
  for (const field of ["name", "title", "label", "qualifiedName", "key", "typeKey", "statement", "rationale", "objective", "purpose", "scope", "description", "explanation", "outcome", "planDelta", "unknowns", "claim", "assessment", "subject", "payload", "proposedPolicy", "directionEvidence"]) append(node[field]);
  for (const relative of nodePaths(node)) append(relative);
  return values.join("\n");
}
function rankedMatches(visible, options) {
  const candidates = visible.filter(node => !options.paths.length || nodePaths(node).some(relative => options.paths.includes(relative.replaceAll("\\", "/"))));
  if (!options.query) return candidates;
  // Fold the query before alias generation: the spelling/case of a question
  // must not add several votes for one camel-case identifier.
  const queryTerms = [...searchTerms(foldSearch(options.query))], query = foldSearch(options.query.replaceAll("\\", "/"));
  const entries = candidates.map(node => {
    const text = searchText(node);
    return { node, text: foldSearch(text), terms: searchTerms(text) };
  });
  const frequency = new Map(queryTerms.map(term => [term, entries.filter(entry => entry.terms.has(term)).length]));
  return entries.map(entry => {
    const exact = entry.node.nodeId === options.query || nodePaths(entry.node).some(relative => foldSearch(relative.replaceAll("\\", "/")) === query);
    const matched = queryTerms.filter(term => entry.terms.has(term));
    // Rare explicit identifiers outrank common conversational words. All
    // matching evidence stays eligible: this is bounded lexical navigation,
    // not a semantic sufficiency decision or an authorization predicate.
    const weights = matched.map(term => 1 + Math.log1p(entries.length / frequency.get(term)));
    const specificity = weights.length ? Math.max(...weights) : 0;
    const score = weights.reduce((sum, weight) => sum + weight, 0);
    return { node: entry.node, exact, matched: matched.length, specificity, score, phrase: entry.text.includes(query) };
  }).filter(entry => entry.exact || entry.matched).sort((a, b) => Number(b.exact) - Number(a.exact) ||
    b.specificity - a.specificity || b.score - a.score || Number(b.phrase) - Number(a.phrase) || a.node.nodeId.localeCompare(b.node.nodeId)).map(entry => entry.node);
}

function viewTraversal(nodes, edges, options) {
  const visible = nodes.filter((node) => (options.view === "all" || node.views.includes(options.view))
    && (options.includeCandidates || !["candidate", "rejected", "historical-opaque"].includes(node.reviewState)));
  const byId = new Map(visible.map((node) => [node.nodeId, node]));
  const matches = options.anchorIds.length ? options.anchorIds.map((anchor) => byId.get(anchor)).filter(Boolean) : rankedMatches(visible, options);
  const selected = new Set(matches.slice(0, options.maxNodes).map((node) => node.nodeId));
  const inclusion = new Map([...selected].map((nodeId) => [nodeId, options.anchorIds.length ? "exact-anchor" : "discovery-match"]));
  const selectedEdges = [], boundary = []; let frontier = new Set(selected);
  const eligibleEdges = edges.filter((edge) => byId.has(edge.from) && byId.has(edge.to));
  const edgeIds = new Set();
  for (let depth = 0; depth < options.depth && frontier.size; depth += 1) {
    const next = new Set();
    for (const edge of eligibleEdges) {
      if (edgeIds.has(edge.edgeId) || !frontier.has(edge.from) && !frontier.has(edge.to)) continue;
      const missing = [edge.from, edge.to].filter((nodeId) => !selected.has(nodeId));
      if (selected.size + missing.length > options.maxNodes || selectedEdges.length >= options.maxEdges) { boundary.push({ edgeId: edge.edgeId, nextAnchorIds: missing, reason: "result-bound" }); continue; }
      for (const nodeId of missing) { selected.add(nodeId); next.add(nodeId); inclusion.set(nodeId, `relation-depth-${depth + 1}`); }
      selectedEdges.push(edge); edgeIds.add(edge.edgeId);
    }
    frontier = next;
  }
  for (const edge of eligibleEdges) if (!edgeIds.has(edge.edgeId) && (selected.has(edge.from) || selected.has(edge.to))) {
    const missing = [edge.from, edge.to].filter((nodeId) => !selected.has(nodeId));
    if (missing.length) boundary.push({ edgeId: edge.edgeId, nextAnchorIds: missing, reason: "depth-or-result-bound" });
  }
  const selectedNodes = [...selected].map(nodeId => byId.get(nodeId));
  // Endpoint state is carried on every relationship. A summary or neighbor
  // expansion cannot make a rejected/candidate revision look approved.
  const enrichedEdges = selectedEdges.map((edge) => ({ ...edge, endpointStates: [edge.from, edge.to].map((nodeId) => ({ nodeId,
    ...navigationState(byId.get(nodeId)) })) }));
  return { nodes: selectedNodes, edges: enrichedEdges, inclusion: selectedNodes.map((node) => ({ nodeId: node.nodeId, reason: inclusion.get(node.nodeId) })),
    boundary: { items: boundary.slice(0, 100), omittedCount: Math.max(0, boundary.length - 100), nextAnchorIds: [...new Set(boundary.flatMap((item) => item.nextAnchorIds))].slice(0, 100) },
    unmatchedAnchorIds: options.anchorIds.filter((anchor) => !byId.has(anchor)), omittedMatchCount: Math.max(0, matches.length - Math.min(matches.length, options.maxNodes)),
    truncated: boundary.length > 0 || matches.length > options.maxNodes };
}

function navigationState(node) {
  return { reviewState: node.reviewState, freshness: node.freshness, revisionId: node.revisionId || null,
    ...(node.policyKey ? { policyKey: node.policyKey, baseProductModelId: node.baseProductModelId || null,
      resultingProductModelId: node.resultingProductModelId || null, proposedPolicy: node.proposedPolicy || null } : {}) };
}

function compactNode(node) {
  const fields = ["nodeId", "kind", "name", "key", "path", "digest", "revisionId", "views", "reviewState", "freshness", "integrity", "sourceAuthority", "sourceReference", "sourceCurrentness", "snapshotState", "policyKey", "baseProductModelId", "resultingProductModelId"];
  const compact = Object.fromEntries(fields.filter(key => node[key] !== undefined).map(key => [key, node[key]]));
  const text = searchText(node);
  const excerpt = text.slice(0, 360);
  const direction = node.directionEvidence;
  const directionEvidence = direction ? { goal: direction.goal.slice(0, 240), ...Object.fromEntries(
    ["constraints", "decisions", "cancelledActions"].map(key => [key, direction[key].slice(0, 3).map(value => value.slice(0, 160))])) } : null;
  const directionPartial = direction && (node.directionContentCoverage.partial || direction.goal.length > 240
    || ["constraints", "decisions", "cancelledActions"].some(key => direction[key].length > 3 || direction[key].some(value => value.length > 160)));
  return { ...compact, excerpt, contentScope: "bounded-navigation-excerpt", contentPartial: excerpt.length < text.length || Boolean(directionPartial),
    ...(direction ? { directionEvidence, directionContentCoverage: { partial: Boolean(directionPartial),
      originalExcerptCoverage: node.directionContentCoverage, detailRequiredForCompleteDirection: Boolean(directionPartial) } } : {}),
    detail: { anchorIds: [node.nodeId], details: true, depth: 0 }, ...authority };
}

function compactTraversal(traversed) {
  return { ...traversed, nodes: traversed.nodes.map(compactNode),
    edges: traversed.edges.map(edge => ({ edgeId: edge.edgeId, type: edge.type, from: edge.from, to: edge.to,
      endpointStates: edge.endpointStates.map(({ proposedPolicy, ...state }) => state), provenance: edge.provenance, ...authority })),
    boundary: { items: traversed.boundary.items.slice(0, 8),
      omittedCount: traversed.boundary.omittedCount + Math.max(0, traversed.boundary.items.length - 8),
      nextAnchorIds: traversed.boundary.nextAnchorIds.slice(0, 16),
      omittedAnchorCount: Math.max(0, traversed.boundary.nextAnchorIds.length - 16) } };
}

export async function queryProjectGraph(options = {}) {
  const normalized = limits(options);
  let inventory;
  try { inventory = collectProjectGraphInventory(options.root || "."); }
  catch (error) { return fallbackProjection(normalized, reason(error)); }
  if (!inventory.project) return fallbackProjection(normalized, "PROJECT_GRAPH_NOT_INITIALIZED");
  const root = inventory.projectRoot, projectId = inventory.project.projectId;
  const grouped = new Map(), nodes = [], edges = [], sources = [], unavailable = [...inventory.unavailable], layers = [];
  for (const entry of inventory.entries.filter((item) => item.path !== ".head/world-model/current.json")) {
    const layer = layerFor(entry.path); if (!grouped.has(layer)) grouped.set(layer, []); grouped.get(layer).push(entry);
  }
  let model = null;
  try { const { readProductModelCanon } = await import("./product-model.mjs"); model = readProductModelCanon({ projectRoot: root }).model; }
  catch (error) { unavailable.push({ layer: "product", reasonCode: reason(error) }); }
  for (const [layer, entries] of grouped) {
    try {
      const result = await verifiedLayer(inventory, layer, entries, model);
      nodes.push(...result.nodes); edges.push(...result.edges); sources.push(...result.sources);
      unavailable.push(...result.skipped); layers.push({ layer, status: "verified", reused: result.reused, recordCount: entries.length });
    } catch (error) { unavailable.push({ layer, reasonCode: reason(error) }); layers.push({ layer, status: "excluded", reasonCode: reason(error) }); }
  }
  let world = null, adapter = { status: "not-used", fallbackUsed: false }, queryAdapter = null;
  try {
    const { readWorldModelForDiscovery } = await import("./world-model.mjs");
    world = readWorldModelForDiscovery({ root, worldModelId: options.worldModelId || "", storeAdapter: options.storeAdapter || null });
    const graph = world.snapshot.temporalProvenanceGraph;
    if (!graph) fail("TEMPORAL_PROVENANCE_NOT_BUILT");
    for (const node of graph.nodes) {
      const product = node.authorityClass === "canon-projected" || node.kind.startsWith("Product");
      nodes.push({ ...node, views: product ? ["product", "work"] : ["work", "product"], sourceAuthority: node.authorityClass,
        origin: { layer: "world", worldModelId: world.snapshot.worldModelId, graphSnapshotId: graph.graphSnapshotId },
        sourceReference: { artifactId: node.nodeId, worldModelId: world.snapshot.worldModelId, path: node.path || null, digest: node.digest || null },
        integrity: "verified", freshness: world.historical ? "historical" : "snapshot-evidence", snapshotState: world.historical ? "historical" : "pointer-snapshot",
        revisionId: node.kind.endsWith("Revision") ? node.nodeId : node.productModelId || graph.sourceSnapshotId,
        reviewState: node.kind.includes("ReviewDecision") ? `historical-${node.disposition || "review"}`
          : node.kind.includes("Candidate") ? "candidate" : node.authorityClass === "canon-projected" ? "canon-projected" : "observed-evidence", ...authority });
      if (node.kind === "FileRevision" && node.path && node.digest) sources.push({ path: node.path, digest: node.digest, nodeId: node.nodeId });
    }
    edges.push(...graph.edges.map((edge) => ({ ...edge, ...authority, provenance: { graphSnapshotId: graph.graphSnapshotId, worldModelId: world.snapshot.worldModelId } })));
    queryAdapter = async () => {
      const { queryGraphProjection } = await import("./graph-projection-adapter.mjs");
      const adapterKey = options.graphProjectionAdapter ? adapterIds.get(options.graphProjectionAdapter) || (() => { const key = ++adapterSequence; adapterIds.set(options.graphProjectionAdapter, key); return key; })() : "configured";
      const key = projectGraphDigest({ projectId, root, graph: graph.graphSnapshotHash, adapterKey, query: normalized });
      if (adapterFailures.has(key)) return clone(adapterFailures.get(key));
      try {
      const temporalAnchors = normalized.anchorIds.filter((anchor) => graph.nodes.some((node) => node.nodeId === anchor));
      if (!temporalAnchors.length && !normalized.anchorIds.length && !normalized.query && normalized.paths.length) {
        // Bind paths to logical File identities in this verified retained
        // snapshot, rather than an unbound empty temporal query.
        for (const relative of normalized.paths) {
          const file = graph.nodes.find(node => node.kind === "File" && node.path === relative);
          if (file) temporalAnchors.push(file.nodeId);
        }
      }
      if (!temporalAnchors.length && !normalized.query) return { status: "not-used", fallbackUsed: false,
        reasonCode: "COMBINED_LOCAL_ONLY", scope: "combined-local-navigation", acceleratesCombinedTraversal: false };
      const projected = queryGraphProjection({ projectRoot: root, graph, adapter: options.graphProjectionAdapter || null,
        query: { query: temporalAnchors.length ? null : normalized.query || null, anchorIds: temporalAnchors.length ? temporalAnchors : null,
          expectedGraphSnapshotId: temporalAnchors.length ? graph.graphSnapshotId : null, freshness: ["current", "historical", "stale"],
          authorityClasses: ["canon-projected", "reviewed", "derived", "heuristic", "runtime-observed"], includeUnreviewedCandidates: normalized.includeCandidates,
          depth: Math.min(normalized.depth, 3), maxNodes: normalized.maxNodes, maxEdges: normalized.maxEdges } });
        return { status: "verified", ...projected.diagnostics, scope: "temporal-query-verification", verifiedDepth: Math.min(normalized.depth, 3), acceleratesCombinedTraversal: false };
      } catch (error) {
        return boundedCache(adapterFailures, key, { status: "unavailable", fallbackUsed: true, fallbackReasonCode: reason(error), executionMode: "verified-embedded-fallback",
          scope: "temporal-query-verification", acceleratesCombinedTraversal: false });
      }
    };
    layers.push({ layer: "world", status: "verified", worldModelId: world.snapshot.worldModelId, historical: world.historical });
  } catch (error) {
    if (reason(error) !== "WORLD_MODEL_NOT_BUILT") unavailable.push({ layer: "world", reasonCode: reason(error) });
    layers.push({ layer: "world", status: reason(error) === "WORLD_MODEL_NOT_BUILT" ? "absent" : "excluded", reasonCode: reason(error) });
  }
  // A shared original identity is one node in two views, not two decisions.
  // More direct verified live records override an older graph projection's
  // navigation labels while retaining both provenance references.
  const unique = new Map();
  for (const node of nodes) {
    const existing = unique.get(node.nodeId);
    if (!existing) unique.set(node.nodeId, node);
    else if (node.origin.layer !== "world") unique.set(node.nodeId, { ...node, views: [...new Set([...node.views, ...existing.views])], projectedReferences: [existing.sourceReference] });
    else existing.projectedReferences = [...(existing.projectedReferences || []), node.sourceReference];
  }
  const allNodes = [...unique.values()];
  const reviewedEvidenceStates = new Map();
  for (const edge of edges) {
    const candidateId = edge.type === "REJECTED_BY" || edge.type === "ACCEPTED_BY" ? edge.from
      : edge.type === "REJECTS" || edge.type === "ACCEPTS_EVIDENCE" ? edge.to : null;
    const candidate = candidateId ? unique.get(candidateId) : null;
    if (candidate) {
      if (!reviewedEvidenceStates.has(candidateId)) reviewedEvidenceStates.set(candidateId, new Set());
      reviewedEvidenceStates.get(candidateId).add(["REJECTED_BY", "REJECTS"].includes(edge.type) ? "rejected" : "accepted-candidate-evidence");
    }
  }
  for (const [candidateId, states] of reviewedEvidenceStates) unique.get(candidateId).reviewState = states.size > 1
    ? "conflicting-reviewed-evidence" : [...states][0];
  const sourceCurrentness = sourceFacts(root, sources, allNodes);
  for (const source of sources) {
    if (!/^[a-f0-9]{64}$/.test(source.digest || "")) continue;
    let target = allNodes.find((node) => ["FileRevision", "FileRevisionReference"].includes(node.kind) && node.path === source.path && node.digest === source.digest);
    if (!target) {
      const nodeId = id("source-revision-reference", { projectId, path: source.path, digest: source.digest });
      const currentness = sourceCurrentness.find((entry) => entry.path === source.path && entry.retainedDigest === source.digest);
      target = { nodeId, kind: "FileRevisionReference", path: source.path, digest: source.digest, revisionId: nodeId,
        views: ["work", "product"], reviewState: "observed-evidence", integrity: "verified-reference", freshness: currentness?.freshness || "unavailable",
        sourceCurrentness: currentness, sourceReference: { path: source.path, digest: source.digest }, origin: source.origin || { layer: "world" }, ...authority };
      allNodes.push(target); unique.set(nodeId, target);
    }
    if (target.nodeId !== source.nodeId) edges.push(relation("OBSERVES_EXACT_REVISION", source.nodeId, target.nodeId, source.origin || { layer: "world" }));
  }
  const graphEdges = [...new Map(edges.map((edge) => [edge.edgeId, edge])).values()].sort((a, b) => a.edgeId.localeCompare(b.edgeId));
  allNodes.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  const basis = { projectId, rootDigest: projectGraphDigest(root), recordsDigest: inventory.recordsDigest,
    worldModelId: world?.snapshot.worldModelId || null, graphSnapshotId: world?.snapshot.temporalProvenanceGraph?.graphSnapshotId || null,
    sourceCurrentnessDigest: projectGraphDigest(sourceCurrentness), layerDigest: projectGraphDigest(layers.map(({ reused, ...layer }) => layer)), readConsistency: "observed-sequence-not-atomic-filesystem-snapshot" };
  const selectedAdapterId = options.graphProjectionAdapter ? adapterIds.get(options.graphProjectionAdapter) || (() => { const key = ++adapterSequence; adapterIds.set(options.graphProjectionAdapter, key); return key; })() : "configured";
  const queryKey = projectGraphDigest({ basis, query: normalized, selectedAdapterId });
  const previous = options.previousResult;
  if (resultCache.has(queryKey) && (!previous || previous.resultId === resultCache.get(queryKey).resultId
    && canonicalGraphJson({ ...previous, reuse: null }) === canonicalGraphJson({ ...resultCache.get(queryKey), reuse: null }))) {
    return { ...clone(resultCache.get(queryKey)), reuse: { status: "same-basis-result-reused", semanticSufficiency: "HEAD-owned" } };
  }
  if (queryAdapter) adapter = await queryAdapter();
  const traversed = viewTraversal(allNodes, graphEdges, normalized);
  const partialDirection = traversed.nodes.some(node => node.directionContentCoverage?.partial);
  const count = (field) => Object.fromEntries([...new Set(traversed.nodes.map((node) => node[field] || "unknown"))].sort().map((key) => [key, traversed.nodes.filter((node) => (node[field] || "unknown") === key).length]));
  const presentation = normalized.details ? traversed : compactTraversal(traversed);
  const partialContent = presentation.nodes.some(node => node.contentPartial);
  const payload = { kind: "ProjectGraphDiscoveryProjection", protocol: { name: "head-agent-core-project-graph", version: PROJECT_GRAPH_PROTOCOL_VERSION },
    authorityBoundary: artifactAuthorityBoundary("ProjectGraphDiscoveryProjection"),
    status: traversed.nodes.length ? "available" : "source-fallback", basis, query: normalized, ...presentation,
    detailExpansion: { supported: true, tool: "head_project_graph", arguments: { details: true },
      instruction: "Use selected node IDs as anchor_ids; increase depth for relationships. Full records remain at sourceReference.path." },
    summary: { nodeCount: traversed.nodes.length, edgeCount: traversed.edges.length, reviewStates: count("reviewState"), freshnessStates: count("freshness"),
      policyReferences: traversed.nodes.filter((node) => node.policyKey).map((node) => { const { proposedPolicy, ...state } = navigationState(node); return { nodeId: node.nodeId, ...state, ...(normalized.details ? { proposedPolicy } : {}) }; }),
      directionReferences: presentation.nodes.filter(node => node.kind === "ProjectDirection").map(node => ({ nodeId: node.nodeId,
        ...navigationState(node), sourceReference: node.sourceReference, contentCoverage: node.directionContentCoverage })),
      semantics: "navigation-evidence; relationship does not prove cause, approval, current effect authority or semantic sufficiency" },
    integrity: { verifiedLayers: layers.filter((layer) => layer.status === "verified").map((layer) => layer.layer), excluded: unavailable },
    freshness: { scope: "referenced-source-bytes-and-retained-revisions", wholeWorldCurrentRequired: false, historicalEvidenceReadable: true },
    coverage: { state: "partial", inventoryBoundReached: !inventory.complete, layers: layers.map(({ reused, ...layer }) => layer), verifiedNodeCount: allNodes.length, matchedNodeCount: traversed.nodes.length,
      emptyResultProvesAbsence: false, semanticSufficiency: "HEAD-owned" },
    sourceFallback: { available: true, needed: !traversed.nodes.length || traversed.truncated || unavailable.length > 0 || !inventory.complete || partialDirection || partialContent,
      action: "Read current original files or the referenced records; expand anchors when useful.", reasonCodes: [...unavailable.map((entry) => entry.reasonCode), ...(partialDirection ? ["PROJECT_DIRECTION_EXCERPT_PARTIAL"] : []), ...(partialContent ? ["PROJECT_GRAPH_COMPACT_CONTENT_PARTIAL"] : [])],
      excludedInputs: unavailable }, adapter, reuse: { status: "fresh-read", semanticSufficiency: "HEAD-owned" }, authority };
  const resultHash = projectGraphDigest(payload), result = { ...payload, resultId: `project-graph-result-${resultHash.slice(0, 24)}`, resultHash };
  boundedCache(resultCache, queryKey, clone(result));
  return result;
}

function fallbackProjection(query, reasonCode) {
  const payload = { kind: "ProjectGraphDiscoveryProjection", protocol: { name: "head-agent-core-project-graph", version: PROJECT_GRAPH_PROTOCOL_VERSION },
    authorityBoundary: artifactAuthorityBoundary("ProjectGraphDiscoveryProjection"),
    status: "source-fallback", basis: null, query, nodes: [], edges: [], summary: { nodeCount: 0, edgeCount: 0, reviewStates: {} },
    coverage: { state: "unavailable", emptyResultProvesAbsence: false, semanticSufficiency: "HEAD-owned" },
    integrity: { verifiedLayers: [], excluded: [{ reasonCode }] }, freshness: { wholeWorldCurrentRequired: false },
    sourceFallback: { available: true, needed: true, action: "Continue from current original files and project records.", reasonCodes: [reasonCode] },
    reuse: { status: "fresh-read" }, adapter: { status: "not-used" }, authority };
  const resultHash = projectGraphDigest(payload);
  return { ...payload, resultId: `project-graph-result-${resultHash.slice(0, 24)}`, resultHash };
}
