import { inspectProject, SCHEMA_VERSION } from "./head-core.mjs";
import { OBSERVATION_PROTOCOL_VERSION, observationCanonicalJson, observationDigest } from "./observation-contract.mjs";
import { loadObservationArtifacts } from "./observation-store.mjs";

const fail = (message, code = "OBSERVATION_PROJECTION_ERROR") => { const error = new Error(message); error.code = code; throw error; };

function edge(type, from, to, evidenceIds) {
  const payload = { type, from, to, evidenceIds: [...new Set(evidenceIds)].sort(), authority: "derived-evidence-relation", instructionAuthority: false, promotionAuthority: false };
  const hash = observationDigest(payload);
  return { edgeId: `observation-edge-${hash.slice(0, 24)}`, ...payload, edgeHash: hash };
}

function projectionPayload({ projectId, descriptors, observations, derivedObservations, receipts }) {
  const nodes = [];
  const edges = [];
  for (const descriptor of descriptors) nodes.push({
    nodeId: descriptor.descriptorId,
    kind: "ObservationTypeDescriptor",
    descriptorHash: descriptor.descriptorHash,
    typeKey: descriptor.typeKey,
    typeVersion: descriptor.typeVersion,
    forms: descriptor.forms,
    authority: descriptor.authority,
    epistemicClass: "derived-projection",
    semanticAuthority: false,
  });
  for (const receipt of receipts) nodes.push({
    nodeId: receipt.receiptId,
    kind: "ObservationCollectionReceipt",
    receiptHash: receipt.receiptHash,
    adapterKey: receipt.adapterKey,
    adapterVersion: receipt.adapterVersion,
    sourceScopeDigest: receipt.sourceScopeDigest,
    authority: receipt.authority,
    epistemicClass: "observed-fact",
    semanticAuthority: false,
  });
  const receiptByObservation = new Map(receipts.map((receipt) => [receipt.observationId, receipt]));
  for (const observation of observations) {
    nodes.push({
      nodeId: observation.observationId,
      kind: "ObservationRecord",
      observationHash: observation.observationHash,
      descriptorId: observation.descriptorId,
      typeKey: observation.typeKey,
      typeVersion: observation.typeVersion,
      subject: observation.subject,
      form: observation.form,
      temporalScope: observation.temporalScope,
      coverage: observation.coverage,
      payload: observation.payload,
      epistemicClass: observation.epistemicClass,
      authority: observation.authority,
      semanticAuthority: false,
      contextEligibility: "exact-evidence-need-only",
    });
    edges.push(edge("CONFORMS_TO", observation.observationId, observation.descriptorId, [observation.observationId, observation.descriptorId]));
    const receipt = receiptByObservation.get(observation.observationId);
    edges.push(edge("EVIDENCED_BY", observation.observationId, receipt.receiptId, [observation.observationId, receipt.receiptId]));
  }
  for (const derived of derivedObservations) {
    nodes.push({
      nodeId: derived.derivedObservationId,
      kind: "DerivedObservationRecord",
      derivedObservationHash: derived.derivedObservationHash,
      descriptorId: derived.descriptorId,
      typeKey: derived.typeKey,
      typeVersion: derived.typeVersion,
      subject: derived.subject,
      form: derived.form,
      temporalScope: derived.temporalScope,
      coverage: derived.coverage,
      payload: derived.payload,
      algorithm: derived.algorithm,
      epistemicClass: derived.epistemicClass,
      authority: derived.authority,
      semanticAuthority: false,
      contextEligibility: "exact-evidence-need-only",
    });
    edges.push(edge("CONFORMS_TO", derived.derivedObservationId, derived.descriptorId, [derived.derivedObservationId, derived.descriptorId]));
    for (const input of derived.inputObservations) edges.push(edge("DERIVED_FROM", derived.derivedObservationId, input.observationId, [derived.derivedObservationId, input.observationId]));
  }
  nodes.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  edges.sort((a, b) => a.edgeId.localeCompare(b.edgeId));
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "ObservationStatusProjection",
    protocol: { name: "head-agent-core-observation-projection", version: OBSERVATION_PROTOCOL_VERSION },
    projectId,
    descriptorIds: descriptors.map((item) => item.descriptorId),
    observationIds: observations.map((item) => item.observationId),
    derivedObservationIds: derivedObservations.map((item) => item.derivedObservationId),
    receiptIds: receipts.map((item) => item.receiptId),
    nodes,
    edges,
    graphPolicy: {
      automaticRelations: ["CONFORMS_TO", "DERIVED_FROM", "EVIDENCED_BY"],
      automaticSemanticRelations: false,
      productFeatureLinks: "forbidden-without-existing-candidate-review-flow",
      contextEligibility: "exact-evidence-need-only",
    },
    authority: "rebuildable-observation-view-not-product-or-recovery-canon",
    instructionAuthority: false,
    promotionAuthority: false,
    recoveryAuthority: false,
  };
}

export function verifyObservationProjection(document, projectId = "") {
  if (!document || typeof document !== "object" || Array.isArray(document)) fail("ObservationStatusProjection is invalid.", "INVALID_OBSERVATION_PROJECTION");
  const payload = { ...document }; delete payload.projectionId; delete payload.projectionHash;
  const hash = observationDigest(payload);
  if (document.projectionId !== `observation-projection-${hash.slice(0, 24)}` || document.projectionHash !== hash
    || document.schemaVersion !== SCHEMA_VERSION || document.kind !== "ObservationStatusProjection"
    || document.protocol?.name !== "head-agent-core-observation-projection" || document.protocol?.version !== OBSERVATION_PROTOCOL_VERSION
    || projectId && document.projectId !== projectId || !Array.isArray(document.nodes) || !Array.isArray(document.edges)
    || document.graphPolicy?.automaticSemanticRelations !== false || document.graphPolicy?.contextEligibility !== "exact-evidence-need-only"
    || document.authority !== "rebuildable-observation-view-not-product-or-recovery-canon"
    || document.instructionAuthority !== false || document.promotionAuthority !== false || document.recoveryAuthority !== false) fail("ObservationStatusProjection fields, digest, or authority are invalid.", "INVALID_OBSERVATION_PROJECTION");
  const nodes = new Map(document.nodes.map((node) => [node.nodeId, node]));
  if (nodes.size !== document.nodes.length || new Set(document.edges.map((item) => item.edgeId)).size !== document.edges.length) fail("ObservationStatusProjection contains duplicates.", "INVALID_OBSERVATION_PROJECTION");
  for (const item of document.edges) {
    const edgePayload = { type: item.type, from: item.from, to: item.to, evidenceIds: item.evidenceIds, authority: item.authority, instructionAuthority: item.instructionAuthority, promotionAuthority: item.promotionAuthority };
    const edgeHash = observationDigest(edgePayload);
    if (item.edgeId !== `observation-edge-${edgeHash.slice(0, 24)}` || item.edgeHash !== edgeHash || !nodes.has(item.from) || !nodes.has(item.to)
      || !["CONFORMS_TO", "DERIVED_FROM", "EVIDENCED_BY"].includes(item.type) || item.authority !== "derived-evidence-relation"
      || item.instructionAuthority !== false || item.promotionAuthority !== false) fail("ObservationStatusProjection relation is invalid.", "INVALID_OBSERVATION_PROJECTION_RELATION");
  }
  return document;
}

export function loadObservationProjection({ projectRoot, projectId } = {}) {
  const artifacts = loadObservationArtifacts({ projectRoot, projectId });
  const payload = projectionPayload({ projectId, ...artifacts });
  const projectionHash = observationDigest(payload);
  return verifyObservationProjection({ ...payload, projectionId: `observation-projection-${projectionHash.slice(0, 24)}`, projectionHash }, projectId);
}

export function inspectObservations({ root = "." } = {}) {
  const inspected = inspectProject(root);
  if (inspected.status !== "ready") fail(`Project must be ready for Observation inspection; current status: ${inspected.status}.`, "PROJECT_NOT_READY");
  const projection = loadObservationProjection({ projectRoot: inspected.project.projectRoot, projectId: inspected.project.projectId });
  return {
    status: projection.observationIds.length || projection.derivedObservationIds.length ? "active" : "not_started",
    projectId: inspected.project.projectId,
    sessionId: inspected.state.sessionId,
    projection,
    graphIntegration: "separate-rebuildable-evidence-view",
    worldRefreshRequiredForProductGraph: false,
    authority: { observations: "P3-evidence-only", graph: "P4-derived", productCanon: "unchanged", recovery: "unchanged" },
  };
}

export function observationProjectionEvidenceDigest(projection) {
  return observationDigest(observationCanonicalJson(verifyObservationProjection(projection)));
}
