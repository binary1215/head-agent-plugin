import crypto from "node:crypto";

export const TEMPORAL_PROVENANCE_VERSION = "0.1.0";
export const TEMPORAL_RELATION_TYPES = Object.freeze([
  "CONTAINS",
  "HAS_REVISION",
  "CURRENT_REVISION",
  "PARENT_OF",
  "DECLARES",
  "REFERENCES",
]);

export const TEMPORAL_NODE_KINDS = Object.freeze([
  "Repository",
  "File",
  "FileRevision",
  "Symbol",
  "SymbolRevision",
  "Test",
  "TestRevision",
  "SourceSnapshot",
  "SourceSnapshotReference",
  "RevisionReference",
]);

const PRODUCER = "head-agent-core-temporal-provenance";
const AUTHORITY_CLASSES = new Set(["canon-projected", "reviewed", "derived", "heuristic", "runtime-observed"]);
const FRESHNESS_STATES = new Set(["current", "stale", "historical"]);

const fail = (message, code = "TEMPORAL_PROVENANCE_ERROR") => {
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

function identity(prefix, value) {
  return `${prefix}-${digest(canonicalJson(value)).slice(0, 24)}`;
}

function sortedUniqueStrings(values, label) {
  if (!Array.isArray(values)) fail(`${label} must be an array.`, "INVALID_TEMPORAL_PARENT_SET");
  const normalized = values.map((value) => String(value || "").trim());
  if (normalized.some((value) => !value)) fail(`${label} contains an empty identity.`, "INVALID_TEMPORAL_PARENT_SET");
  return [...new Set(normalized)].sort();
}

export function normalizeParentSourceSnapshotIds(values = []) {
  const normalized = sortedUniqueStrings(values, "parentSourceSnapshotIds");
  for (const value of normalized) {
    if (!/^source-snapshot-[a-f0-9]{24}$/.test(value)) {
      fail(`Invalid parent SourceSnapshot identity: ${value}`, "INVALID_SOURCE_SNAPSHOT_PARENT");
    }
  }
  return normalized;
}

export function normalizeRevisionParentIds(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("revisionParentIds must be an object keyed by logical entity identity.", "INVALID_REVISION_PARENT_SET");
  }
  const normalized = {};
  for (const logicalEntityId of Object.keys(value).sort()) {
    const parents = sortedUniqueStrings(value[logicalEntityId], `revisionParentIds.${logicalEntityId}`);
    if (parents.length) normalized[logicalEntityId] = parents;
  }
  return normalized;
}

function evidenceId(file) {
  return identity("evidence", { kind: "file-content", path: file.path, digest: file.digest });
}

function nodeMetadata({ evidenceIds = [], sourceSnapshotId = null, authorityClass = "derived", origin = "derived-source-scan", confidence } = {}) {
  const metadata = {
    authorityClass,
    origin,
    evidenceIds: sortedUniqueStrings(evidenceIds, "evidenceIds"),
    freshness: "current",
    producer: PRODUCER,
    producerVersion: TEMPORAL_PROVENANCE_VERSION,
    instructionAuthority: false,
    promotionAuthority: false,
  };
  if (sourceSnapshotId) metadata.sourceSnapshotId = sourceSnapshotId;
  if (confidence != null) metadata.confidence = confidence;
  return metadata;
}

function edgeRecord({ type, from, to, sourceSnapshotId, evidenceIds = [], origin = "derived-source-scan", authorityClass = "derived", confidence }) {
  const payload = {
    type,
    from,
    to,
    authorityClass,
    origin,
    evidenceIds: sortedUniqueStrings(evidenceIds, "edge evidenceIds"),
    freshness: "current",
    sourceSnapshotId,
    producer: PRODUCER,
    producerVersion: TEMPORAL_PROVENANCE_VERSION,
    instructionAuthority: false,
    promotionAuthority: false,
  };
  if (confidence != null) payload.confidence = confidence;
  return { edgeId: identity("temporal-edge", payload), ...payload };
}

function parentIdsFor(revisionParentIds, logicalEntityId, prefix) {
  const values = revisionParentIds[logicalEntityId] || [];
  for (const value of values) {
    if (!new RegExp(`^${prefix}-[a-f0-9]{24}$`).test(value)) {
      fail(`Revision parent ${value} does not match ${prefix}.`, "INVALID_REVISION_PARENT");
    }
  }
  return values;
}

function revisionReferenceKind(revisionId) {
  if (revisionId.startsWith("file-revision-")) return "FileRevision";
  if (revisionId.startsWith("symbol-revision-")) return "SymbolRevision";
  if (revisionId.startsWith("test-revision-")) return "TestRevision";
  return "";
}

export function buildTemporalProvenanceGraph({ projectId, files, parentSourceSnapshotIds = [], revisionParentIds = {} } = {}) {
  if (typeof projectId !== "string" || !projectId.trim()) fail("projectId is required.", "TEMPORAL_PROJECT_ID_REQUIRED");
  if (!Array.isArray(files)) fail("files must be an array.", "TEMPORAL_FILES_REQUIRED");
  const parents = normalizeParentSourceSnapshotIds(parentSourceSnapshotIds);
  const revisionParents = normalizeRevisionParentIds(revisionParentIds);
  const orderedFiles = [...files].sort((left, right) => String(left.path).localeCompare(String(right.path)));
  const repositoryId = identity("repository", { projectId });
  const records = [];
  const knownLogicalIds = new Set();

  for (const file of orderedFiles) {
    if (!file || typeof file.path !== "string" || !file.path || !/^[a-f0-9]{64}$/.test(file.digest || "")) {
      fail("Every temporal file requires a path and SHA-256 digest.", "INVALID_TEMPORAL_FILE");
    }
    const fileId = identity("file", { projectId, path: file.path });
    knownLogicalIds.add(fileId);
    const fileParentRevisionIds = parentIdsFor(revisionParents, fileId, "file-revision");
    const fileRevisionId = identity("file-revision", {
      logicalEntityId: fileId,
      digest: file.digest,
      language: file.language || "text",
      classification: file.classification || "source",
      parentRevisionIds: fileParentRevisionIds,
    });
    const occurrences = new Map();
    const symbols = [...(file.symbols || [])].sort((left, right) => Number(left.line || 0) - Number(right.line || 0)
      || String(left.kind).localeCompare(String(right.kind)) || String(left.name).localeCompare(String(right.name)));
    const symbolRecords = symbols.map((symbol) => {
      const occurrenceKey = `${symbol.kind || "symbol"}:${symbol.name || ""}`;
      const occurrence = (occurrences.get(occurrenceKey) || 0) + 1;
      occurrences.set(occurrenceKey, occurrence);
      const symbolId = identity("symbol", {
        fileId,
        symbolKind: symbol.kind || "symbol",
        name: symbol.name || "",
        occurrence,
      });
      knownLogicalIds.add(symbolId);
      const symbolParentRevisionIds = parentIdsFor(revisionParents, symbolId, "symbol-revision");
      const symbolRevisionId = identity("symbol-revision", {
        logicalEntityId: symbolId,
        fileRevisionId,
        line: Number(symbol.line || 1),
        parentRevisionIds: symbolParentRevisionIds,
      });
      return {
        symbolId,
        symbolRevisionId,
        symbolParentRevisionIds,
        name: symbol.name || "",
        symbolKind: symbol.kind || "symbol",
        occurrence,
        line: Number(symbol.line || 1),
      };
    });
    let testRecord = null;
    if (file.classification === "test") {
      const testId = identity("test", { projectId, path: file.path });
      knownLogicalIds.add(testId);
      const testParentRevisionIds = parentIdsFor(revisionParents, testId, "test-revision");
      const testRevisionId = identity("test-revision", {
        logicalEntityId: testId,
        fileRevisionId,
        parentRevisionIds: testParentRevisionIds,
      });
      testRecord = { testId, testRevisionId, testParentRevisionIds };
    }
    records.push({ file, fileId, fileRevisionId, fileParentRevisionIds, symbolRecords, testRecord, evidenceId: evidenceId(file) });
  }

  for (const logicalEntityId of Object.keys(revisionParents)) {
    if (!knownLogicalIds.has(logicalEntityId)) {
      fail(`Revision parents reference an unknown logical entity: ${logicalEntityId}`, "UNKNOWN_REVISION_PARENT_ENTITY");
    }
  }

  const fileRevisionIds = records.map((record) => record.fileRevisionId).sort();
  const symbolRevisionIds = records.flatMap((record) => record.symbolRecords.map((symbol) => symbol.symbolRevisionId)).sort();
  const testRevisionIds = records.flatMap((record) => record.testRecord ? [record.testRecord.testRevisionId] : []).sort();
  const stateDigest = digest(canonicalJson({ projectId, fileRevisionIds, symbolRevisionIds, testRevisionIds, producerVersion: TEMPORAL_PROVENANCE_VERSION }));
  const sourceSnapshotId = identity("source-snapshot", {
    projectId,
    parentSnapshotIds: parents,
    fileRevisionIds,
    symbolRevisionIds,
    testRevisionIds,
    stateDigest,
    producerVersion: TEMPORAL_PROVENANCE_VERSION,
  });
  if (parents.includes(sourceSnapshotId)) fail("A SourceSnapshot cannot parent itself.", "TEMPORAL_SOURCE_CYCLE");

  const nodes = [];
  const edges = [];
  const allEvidenceIds = records.map((record) => record.evidenceId).sort();
  nodes.push({
    nodeId: sourceSnapshotId,
    kind: "SourceSnapshot",
    projectId,
    parentSnapshotIds: parents,
    fileRevisionIds,
    symbolRevisionIds,
    testRevisionIds,
    stateDigest,
    ...nodeMetadata({ evidenceIds: allEvidenceIds }),
  });
  nodes.push({
    nodeId: repositoryId,
    kind: "Repository",
    projectId,
    ...nodeMetadata({ evidenceIds: allEvidenceIds, sourceSnapshotId }),
  });

  for (const parentSnapshotId of parents) {
    nodes.push({
      nodeId: parentSnapshotId,
      kind: "SourceSnapshotReference",
      referencedSourceSnapshotId: parentSnapshotId,
      ...nodeMetadata({ evidenceIds: [identity("evidence", { kind: "declared-parent", parentSnapshotId })], sourceSnapshotId, origin: "declared-parent" }),
    });
    edges.push(edgeRecord({
      type: "PARENT_OF",
      from: parentSnapshotId,
      to: sourceSnapshotId,
      sourceSnapshotId,
      evidenceIds: [identity("evidence", { kind: "declared-parent", parentSnapshotId })],
      origin: "declared-parent",
    }));
  }

  const revisionReferences = new Map();
  const addRevisionParents = (logicalEntityId, revisionId, parentRevisionIds, revisionKind, evidenceIds) => {
    for (const parentRevisionId of parentRevisionIds) {
      if (parentRevisionId === revisionId) fail("A revision cannot parent itself.", "TEMPORAL_REVISION_CYCLE");
      const existing = revisionReferences.get(parentRevisionId);
      if (existing && (existing.logicalEntityId !== logicalEntityId || existing.revisionKind !== revisionKind)) {
        fail(`Revision parent identity is associated with conflicting logical entities: ${parentRevisionId}`, "REVISION_PARENT_IDENTITY_CONFLICT");
      }
      if (!existing) revisionReferences.set(parentRevisionId, { logicalEntityId, revisionKind, evidenceIds });
      edges.push(edgeRecord({ type: "PARENT_OF", from: parentRevisionId, to: revisionId, sourceSnapshotId, evidenceIds, origin: "declared-parent" }));
    }
  };

  for (const record of records) {
    const { file, fileId, fileRevisionId, fileParentRevisionIds, symbolRecords, testRecord } = record;
    const evidenceIds = [record.evidenceId];
    nodes.push({
      nodeId: fileId,
      kind: "File",
      projectId,
      path: file.path,
      ...nodeMetadata({ evidenceIds, sourceSnapshotId }),
    });
    nodes.push({
      nodeId: fileRevisionId,
      kind: "FileRevision",
      logicalEntityId: fileId,
      path: file.path,
      digest: file.digest,
      language: file.language || "text",
      classification: file.classification || "source",
      parentRevisionIds: fileParentRevisionIds,
      ...nodeMetadata({ evidenceIds, sourceSnapshotId }),
    });
    edges.push(edgeRecord({ type: "CONTAINS", from: repositoryId, to: fileId, sourceSnapshotId, evidenceIds }));
    edges.push(edgeRecord({ type: "CONTAINS", from: sourceSnapshotId, to: fileRevisionId, sourceSnapshotId, evidenceIds }));
    edges.push(edgeRecord({ type: "HAS_REVISION", from: fileId, to: fileRevisionId, sourceSnapshotId, evidenceIds }));
    edges.push(edgeRecord({ type: "CURRENT_REVISION", from: fileId, to: fileRevisionId, sourceSnapshotId, evidenceIds }));
    addRevisionParents(fileId, fileRevisionId, fileParentRevisionIds, "FileRevision", evidenceIds);

    for (const symbol of symbolRecords) {
      nodes.push({
        nodeId: symbol.symbolId,
        kind: "Symbol",
        fileId,
        path: file.path,
        name: symbol.name,
        symbolKind: symbol.symbolKind,
        occurrence: symbol.occurrence,
        ...nodeMetadata({ evidenceIds, sourceSnapshotId, authorityClass: "heuristic", origin: "heuristic-symbol-scan", confidence: 0.6 }),
      });
      nodes.push({
        nodeId: symbol.symbolRevisionId,
        kind: "SymbolRevision",
        logicalEntityId: symbol.symbolId,
        fileRevisionId,
        path: file.path,
        name: symbol.name,
        symbolKind: symbol.symbolKind,
        occurrence: symbol.occurrence,
        line: symbol.line,
        parentRevisionIds: symbol.symbolParentRevisionIds,
        ...nodeMetadata({ evidenceIds, sourceSnapshotId, authorityClass: "heuristic", origin: "heuristic-symbol-scan", confidence: 0.6 }),
      });
      edges.push(edgeRecord({ type: "HAS_REVISION", from: symbol.symbolId, to: symbol.symbolRevisionId, sourceSnapshotId, evidenceIds, authorityClass: "heuristic", origin: "heuristic-symbol-scan", confidence: 0.6 }));
      edges.push(edgeRecord({ type: "CURRENT_REVISION", from: symbol.symbolId, to: symbol.symbolRevisionId, sourceSnapshotId, evidenceIds, authorityClass: "heuristic", origin: "heuristic-symbol-scan", confidence: 0.6 }));
      edges.push(edgeRecord({ type: "DECLARES", from: fileRevisionId, to: symbol.symbolRevisionId, sourceSnapshotId, evidenceIds, authorityClass: "heuristic", origin: "heuristic-symbol-scan", confidence: 0.6 }));
      addRevisionParents(symbol.symbolId, symbol.symbolRevisionId, symbol.symbolParentRevisionIds, "SymbolRevision", evidenceIds);
    }

    if (testRecord) {
      nodes.push({
        nodeId: testRecord.testId,
        kind: "Test",
        projectId,
        path: file.path,
        fileId,
        ...nodeMetadata({ evidenceIds, sourceSnapshotId }),
      });
      nodes.push({
        nodeId: testRecord.testRevisionId,
        kind: "TestRevision",
        logicalEntityId: testRecord.testId,
        fileRevisionId,
        path: file.path,
        parentRevisionIds: testRecord.testParentRevisionIds,
        ...nodeMetadata({ evidenceIds, sourceSnapshotId }),
      });
      edges.push(edgeRecord({ type: "CONTAINS", from: repositoryId, to: testRecord.testId, sourceSnapshotId, evidenceIds }));
      edges.push(edgeRecord({ type: "HAS_REVISION", from: testRecord.testId, to: testRecord.testRevisionId, sourceSnapshotId, evidenceIds }));
      edges.push(edgeRecord({ type: "CURRENT_REVISION", from: testRecord.testId, to: testRecord.testRevisionId, sourceSnapshotId, evidenceIds }));
      edges.push(edgeRecord({ type: "REFERENCES", from: testRecord.testRevisionId, to: fileRevisionId, sourceSnapshotId, evidenceIds }));
      addRevisionParents(testRecord.testId, testRecord.testRevisionId, testRecord.testParentRevisionIds, "TestRevision", evidenceIds);
    }
  }

  for (const [parentRevisionId, reference] of revisionReferences) {
    nodes.push({
      nodeId: parentRevisionId,
      kind: "RevisionReference",
      referencedRevisionId: parentRevisionId,
      revisionKind: reference.revisionKind,
      logicalEntityId: reference.logicalEntityId,
      ...nodeMetadata({ evidenceIds: reference.evidenceIds, sourceSnapshotId, origin: "declared-parent" }),
    });
  }

  nodes.sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  edges.sort((left, right) => left.edgeId.localeCompare(right.edgeId));
  const summary = {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    fileCount: nodes.filter((node) => node.kind === "File").length,
    fileRevisionCount: nodes.filter((node) => node.kind === "FileRevision").length,
    symbolCount: nodes.filter((node) => node.kind === "Symbol").length,
    symbolRevisionCount: nodes.filter((node) => node.kind === "SymbolRevision").length,
    testCount: nodes.filter((node) => node.kind === "Test").length,
    testRevisionCount: nodes.filter((node) => node.kind === "TestRevision").length,
    sourceParentCount: parents.length,
    revisionParentCount: edges.filter((edge) => edge.type === "PARENT_OF" && edge.to !== sourceSnapshotId).length,
  };
  const payload = {
    kind: "GraphSnapshot",
    protocol: { name: "head-agent-core-temporal-provenance", version: TEMPORAL_PROVENANCE_VERSION },
    authority: "derived-evidence-only",
    rebuildable: true,
    uniqueAuthority: false,
    projectId,
    sourceSnapshotId,
    parentSourceSnapshotIds: parents,
    revisionParentIds: revisionParents,
    relationTypes: [...TEMPORAL_RELATION_TYPES],
    nodeKinds: [...TEMPORAL_NODE_KINDS],
    nodes,
    edges,
    summary,
  };
  const graphSnapshotHash = digest(canonicalJson(payload));
  const graph = { ...payload, graphSnapshotId: `graph-snapshot-${graphSnapshotHash.slice(0, 24)}`, graphSnapshotHash };
  return verifyTemporalProvenanceGraph(graph);
}

function requireMetadata(record, label, { sourceSnapshotRequired = true } = {}) {
  for (const field of ["authorityClass", "origin", "evidenceIds", "freshness", "producer", "producerVersion", "instructionAuthority", "promotionAuthority"]) {
    if (!(field in record)) fail(`${label} is missing ${field}.`, "TEMPORAL_PROVENANCE_MISSING");
  }
  if (sourceSnapshotRequired && !record.sourceSnapshotId) fail(`${label} is missing sourceSnapshotId.`, "TEMPORAL_PROVENANCE_MISSING");
  if (!AUTHORITY_CLASSES.has(record.authorityClass)) fail(`${label} has an invalid authorityClass.`, "INVALID_TEMPORAL_AUTHORITY");
  if (!FRESHNESS_STATES.has(record.freshness)) fail(`${label} has invalid freshness.`, "INVALID_TEMPORAL_FRESHNESS");
  if (!Array.isArray(record.evidenceIds) || canonicalJson(record.evidenceIds) !== canonicalJson([...new Set(record.evidenceIds)].sort())) {
    fail(`${label} evidenceIds must be sorted and unique.`, "INVALID_TEMPORAL_EVIDENCE");
  }
  if (typeof record.instructionAuthority !== "boolean" || typeof record.promotionAuthority !== "boolean") {
    fail(`${label} authority flags must be boolean.`, "INVALID_TEMPORAL_AUTHORITY");
  }
  if (record.authorityClass === "heuristic" || record.origin.startsWith("heuristic")) {
    if (typeof record.confidence !== "number" || record.confidence < 0 || record.confidence > 1) {
      fail(`${label} requires confidence from zero through one.`, "INVALID_TEMPORAL_CONFIDENCE");
    }
  } else if (record.confidence != null && (typeof record.confidence !== "number" || record.confidence < 0 || record.confidence > 1)) {
    fail(`${label} has invalid confidence.`, "INVALID_TEMPORAL_CONFIDENCE");
  }
}

function expectedNodeId(node) {
  if (node.kind === "Repository") return identity("repository", { projectId: node.projectId });
  if (node.kind === "File") return identity("file", { projectId: node.projectId, path: node.path });
  if (node.kind === "FileRevision") return identity("file-revision", {
    logicalEntityId: node.logicalEntityId,
    digest: node.digest,
    language: node.language,
    classification: node.classification,
    parentRevisionIds: node.parentRevisionIds,
  });
  if (node.kind === "Symbol") return identity("symbol", {
    fileId: node.fileId,
    symbolKind: node.symbolKind,
    name: node.name,
    occurrence: node.occurrence,
  });
  if (node.kind === "SymbolRevision") return identity("symbol-revision", {
    logicalEntityId: node.logicalEntityId,
    fileRevisionId: node.fileRevisionId,
    line: node.line,
    parentRevisionIds: node.parentRevisionIds,
  });
  if (node.kind === "Test") return identity("test", { projectId: node.projectId, path: node.path });
  if (node.kind === "TestRevision") return identity("test-revision", {
    logicalEntityId: node.logicalEntityId,
    fileRevisionId: node.fileRevisionId,
    parentRevisionIds: node.parentRevisionIds,
  });
  if (node.kind === "SourceSnapshot") return identity("source-snapshot", {
    projectId: node.projectId,
    parentSnapshotIds: node.parentSnapshotIds,
    fileRevisionIds: node.fileRevisionIds,
    symbolRevisionIds: node.symbolRevisionIds,
    testRevisionIds: node.testRevisionIds,
    stateDigest: node.stateDigest,
    producerVersion: node.producerVersion,
  });
  if (node.kind === "SourceSnapshotReference") return node.referencedSourceSnapshotId;
  if (node.kind === "RevisionReference") return node.referencedRevisionId;
  return "";
}

function validEndpointKinds(type, fromKind, toKind) {
  if (type === "CONTAINS") return (fromKind === "Repository" && ["File", "Test"].includes(toKind))
    || (fromKind === "SourceSnapshot" && toKind === "FileRevision");
  if (["HAS_REVISION", "CURRENT_REVISION"].includes(type)) return (fromKind === "File" && toKind === "FileRevision")
    || (fromKind === "Symbol" && toKind === "SymbolRevision") || (fromKind === "Test" && toKind === "TestRevision");
  if (type === "PARENT_OF") return (["SourceSnapshot", "SourceSnapshotReference"].includes(fromKind) && toKind === "SourceSnapshot")
    || (fromKind === "RevisionReference" && ["FileRevision", "SymbolRevision", "TestRevision"].includes(toKind));
  if (type === "DECLARES") return fromKind === "FileRevision" && toKind === "SymbolRevision";
  if (type === "REFERENCES") return fromKind === "TestRevision" && toKind === "FileRevision";
  return false;
}

export function verifyTemporalProvenanceGraph(graph) {
  if (!graph || graph.kind !== "GraphSnapshot" || graph.protocol?.name !== "head-agent-core-temporal-provenance"
    || graph.protocol.version !== TEMPORAL_PROVENANCE_VERSION) {
    fail("Temporal provenance GraphSnapshot is invalid.", "INVALID_TEMPORAL_PROVENANCE_GRAPH");
  }
  if (graph.authority !== "derived-evidence-only" || graph.rebuildable !== true || graph.uniqueAuthority !== false) {
    fail("Temporal provenance graph cannot claim canonical or unique authority.", "INVALID_TEMPORAL_GRAPH_AUTHORITY");
  }
  const payload = { ...graph };
  delete payload.graphSnapshotId;
  delete payload.graphSnapshotHash;
  const actualHash = digest(canonicalJson(payload));
  if (graph.graphSnapshotHash !== actualHash || graph.graphSnapshotId !== `graph-snapshot-${actualHash.slice(0, 24)}`) {
    fail("Temporal provenance graph digest verification failed.", "TEMPORAL_GRAPH_DIGEST_MISMATCH");
  }
  if (canonicalJson(graph.parentSourceSnapshotIds) !== canonicalJson(normalizeParentSourceSnapshotIds(graph.parentSourceSnapshotIds))) {
    fail("SourceSnapshot parents must be sorted and unique.", "INVALID_SOURCE_SNAPSHOT_PARENT");
  }
  if (canonicalJson(graph.revisionParentIds) !== canonicalJson(normalizeRevisionParentIds(graph.revisionParentIds))) {
    fail("Revision parents must be normalized.", "INVALID_REVISION_PARENT_SET");
  }
  if (canonicalJson(graph.relationTypes) !== canonicalJson([...TEMPORAL_RELATION_TYPES])
    || canonicalJson(graph.nodeKinds) !== canonicalJson([...TEMPORAL_NODE_KINDS])) {
    fail("Temporal graph vocabulary does not match the implemented allowlist.", "TEMPORAL_VOCABULARY_MISMATCH");
  }
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) fail("Temporal graph nodes and edges are required.", "INVALID_TEMPORAL_PROVENANCE_GRAPH");
  if (canonicalJson(graph.nodes.map((node) => node.nodeId)) !== canonicalJson(graph.nodes.map((node) => node.nodeId).sort())
    || canonicalJson(graph.edges.map((edge) => edge.edgeId)) !== canonicalJson(graph.edges.map((edge) => edge.edgeId).sort())) {
    fail("Temporal graph nodes and edges must use deterministic ordering.", "TEMPORAL_ORDER_MISMATCH");
  }
  const nodes = new Map();
  for (const node of graph.nodes) {
    if (!TEMPORAL_NODE_KINDS.includes(node.kind) || typeof node.nodeId !== "string") fail("Temporal graph contains an unsupported node.", "UNSUPPORTED_TEMPORAL_NODE");
    if (nodes.has(node.nodeId)) fail(`Duplicate temporal node: ${node.nodeId}`, "DUPLICATE_TEMPORAL_NODE");
    requireMetadata(node, `Node ${node.nodeId}`, { sourceSnapshotRequired: node.kind !== "SourceSnapshot" });
    if (node.kind !== "SourceSnapshot" && node.sourceSnapshotId !== graph.sourceSnapshotId) fail(`Node ${node.nodeId} is scoped to a different SourceSnapshot.`, "TEMPORAL_SCOPE_MISMATCH");
    for (const field of ["parentRevisionIds", "parentSnapshotIds", "fileRevisionIds", "symbolRevisionIds", "testRevisionIds"]) {
      if (node[field] && canonicalJson(node[field]) !== canonicalJson([...new Set(node[field])].sort())) fail(`Node ${node.nodeId} has a non-normalized ${field}.`, "INVALID_TEMPORAL_PARENT_SET");
    }
    if (expectedNodeId(node) !== node.nodeId) fail(`Temporal node identity mismatch: ${node.nodeId}`, "TEMPORAL_NODE_IDENTITY_MISMATCH");
    nodes.set(node.nodeId, node);
  }
  const sourceSnapshot = nodes.get(graph.sourceSnapshotId);
  if (!sourceSnapshot || sourceSnapshot.kind !== "SourceSnapshot") fail("Current SourceSnapshot node is missing.", "SOURCE_SNAPSHOT_MISSING");
  if (sourceSnapshot.parentSnapshotIds.includes(sourceSnapshot.nodeId)) fail("A SourceSnapshot cannot parent itself.", "TEMPORAL_SOURCE_CYCLE");
  if (sourceSnapshot.projectId !== graph.projectId
    || canonicalJson(sourceSnapshot.parentSnapshotIds) !== canonicalJson(graph.parentSourceSnapshotIds)) {
    fail("SourceSnapshot scope or parents do not match the GraphSnapshot.", "SOURCE_SNAPSHOT_SCOPE_MISMATCH");
  }
  const actualFileRevisionIds = graph.nodes.filter((node) => node.kind === "FileRevision").map((node) => node.nodeId).sort();
  const actualSymbolRevisionIds = graph.nodes.filter((node) => node.kind === "SymbolRevision").map((node) => node.nodeId).sort();
  const actualTestRevisionIds = graph.nodes.filter((node) => node.kind === "TestRevision").map((node) => node.nodeId).sort();
  if (canonicalJson(sourceSnapshot.fileRevisionIds) !== canonicalJson(actualFileRevisionIds)
    || canonicalJson(sourceSnapshot.symbolRevisionIds) !== canonicalJson(actualSymbolRevisionIds)
    || canonicalJson(sourceSnapshot.testRevisionIds) !== canonicalJson(actualTestRevisionIds)) {
    fail("SourceSnapshot revision sets do not match the projected revisions.", "SOURCE_SNAPSHOT_REVISION_MISMATCH");
  }
  const expectedStateDigest = digest(canonicalJson({
    projectId: graph.projectId,
    fileRevisionIds: actualFileRevisionIds,
    symbolRevisionIds: actualSymbolRevisionIds,
    testRevisionIds: actualTestRevisionIds,
    producerVersion: TEMPORAL_PROVENANCE_VERSION,
  }));
  if (sourceSnapshot.stateDigest !== expectedStateDigest) fail("SourceSnapshot state digest is invalid.", "SOURCE_SNAPSHOT_STATE_MISMATCH");
  const repositories = graph.nodes.filter((node) => node.kind === "Repository");
  if (repositories.length !== 1 || repositories[0].projectId !== graph.projectId) fail("Temporal graph requires exactly one matching Repository.", "TEMPORAL_REPOSITORY_MISMATCH");
  const actualRevisionParentIds = {};
  for (const node of graph.nodes) {
    if (node.projectId && node.projectId !== graph.projectId) fail(`Node ${node.nodeId} belongs to another project.`, "TEMPORAL_PROJECT_SCOPE_MISMATCH");
    if (!["FileRevision", "SymbolRevision", "TestRevision"].includes(node.kind)) continue;
    const logical = nodes.get(node.logicalEntityId);
    const expectedLogicalKind = node.kind.replace("Revision", "");
    if (!logical || logical.kind !== expectedLogicalKind) fail(`Revision ${node.nodeId} has no matching logical entity.`, "REVISION_LOGICAL_ENTITY_MISMATCH");
    if (node.parentRevisionIds.length) actualRevisionParentIds[node.logicalEntityId] = node.parentRevisionIds;
    if (node.kind === "FileRevision" && logical.path !== node.path) fail(`FileRevision ${node.nodeId} path does not match its File.`, "REVISION_LOGICAL_ENTITY_MISMATCH");
    if (node.kind === "SymbolRevision") {
      if (logical.fileId !== nodes.get(node.fileRevisionId)?.logicalEntityId || logical.path !== node.path || logical.name !== node.name
        || logical.symbolKind !== node.symbolKind || logical.occurrence !== node.occurrence) {
        fail(`SymbolRevision ${node.nodeId} does not match its Symbol.`, "REVISION_LOGICAL_ENTITY_MISMATCH");
      }
    }
    if (node.kind === "TestRevision" && (logical.path !== node.path || logical.fileId !== nodes.get(node.fileRevisionId)?.logicalEntityId)) {
      fail(`TestRevision ${node.nodeId} does not match its Test.`, "REVISION_LOGICAL_ENTITY_MISMATCH");
    }
  }
  if (canonicalJson(actualRevisionParentIds) !== canonicalJson(graph.revisionParentIds)) {
    fail("GraphSnapshot revision parent map does not match Revision nodes.", "REVISION_PARENT_MAP_MISMATCH");
  }
  const edgeIds = new Set();
  for (const edge of graph.edges) {
    if (!TEMPORAL_RELATION_TYPES.includes(edge.type)) fail(`Unsupported temporal relation: ${edge.type}`, "UNSUPPORTED_TEMPORAL_RELATION");
    if (edgeIds.has(edge.edgeId)) fail(`Duplicate temporal edge: ${edge.edgeId}`, "DUPLICATE_TEMPORAL_EDGE");
    requireMetadata(edge, `Edge ${edge.edgeId}`);
    if (edge.sourceSnapshotId !== graph.sourceSnapshotId) fail(`Edge ${edge.edgeId} is scoped to a different SourceSnapshot.`, "TEMPORAL_SCOPE_MISMATCH");
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (!from || !to) fail(`Temporal edge ${edge.edgeId} has a dangling endpoint.`, "TEMPORAL_DANGLING_ENDPOINT");
    if (!validEndpointKinds(edge.type, from.kind, to.kind)) fail(`Temporal edge ${edge.edgeId} has invalid endpoint kinds.`, "TEMPORAL_ENDPOINT_KIND_MISMATCH");
    const payloadForId = { ...edge };
    delete payloadForId.edgeId;
    if (identity("temporal-edge", payloadForId) !== edge.edgeId) fail(`Temporal edge identity mismatch: ${edge.edgeId}`, "TEMPORAL_EDGE_IDENTITY_MISMATCH");
    edgeIds.add(edge.edgeId);
  }
  const hasEdge = (type, from, to) => graph.edges.some((edge) => edge.type === type && edge.from === from && edge.to === to);
  for (const parentSnapshotId of graph.parentSourceSnapshotIds) {
    if (nodes.get(parentSnapshotId)?.kind !== "SourceSnapshotReference" || !hasEdge("PARENT_OF", parentSnapshotId, graph.sourceSnapshotId)) {
      fail(`SourceSnapshot parent projection is incomplete: ${parentSnapshotId}`, "SOURCE_SNAPSHOT_PARENT_MISSING");
    }
  }
  for (const node of graph.nodes) {
    if (!["FileRevision", "SymbolRevision", "TestRevision"].includes(node.kind)) continue;
    if (!hasEdge("HAS_REVISION", node.logicalEntityId, node.nodeId) || !hasEdge("CURRENT_REVISION", node.logicalEntityId, node.nodeId)) {
      fail(`Revision projection is missing logical links: ${node.nodeId}`, "REVISION_LINK_MISSING");
    }
    for (const parentRevisionId of node.parentRevisionIds) {
      const reference = nodes.get(parentRevisionId);
      if (!reference || reference.kind !== "RevisionReference" || reference.logicalEntityId !== node.logicalEntityId
        || reference.revisionKind !== node.kind || revisionReferenceKind(parentRevisionId) !== node.kind
        || !hasEdge("PARENT_OF", parentRevisionId, node.nodeId)) {
        fail(`Revision parent projection is incomplete: ${parentRevisionId}`, "REVISION_PARENT_MISSING");
      }
    }
  }
  const summary = {
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    fileCount: graph.nodes.filter((node) => node.kind === "File").length,
    fileRevisionCount: graph.nodes.filter((node) => node.kind === "FileRevision").length,
    symbolCount: graph.nodes.filter((node) => node.kind === "Symbol").length,
    symbolRevisionCount: graph.nodes.filter((node) => node.kind === "SymbolRevision").length,
    testCount: graph.nodes.filter((node) => node.kind === "Test").length,
    testRevisionCount: graph.nodes.filter((node) => node.kind === "TestRevision").length,
    sourceParentCount: graph.parentSourceSnapshotIds.length,
    revisionParentCount: graph.edges.filter((edge) => edge.type === "PARENT_OF" && edge.to !== graph.sourceSnapshotId).length,
  };
  if (canonicalJson(summary) !== canonicalJson(graph.summary)) fail("Temporal graph summary does not match its contents.", "TEMPORAL_SUMMARY_MISMATCH");
  return graph;
}

function normalizeAllowlist(values, supported, label) {
  const source = values == null ? [...supported] : Array.isArray(values) ? values : [values];
  const normalized = sortedUniqueStrings(source, label);
  for (const value of normalized) if (!supported.includes(value)) fail(`${label} contains unsupported value: ${value}`, "INVALID_TEMPORAL_QUERY_ALLOWLIST");
  return normalized;
}

function searchable(node) {
  return [node.nodeId, node.kind, node.path, node.name, node.symbolKind, node.classification, node.language,
    node.logicalEntityId, node.fileId, node.fileRevisionId, node.referencedSourceSnapshotId, node.referencedRevisionId]
    .filter(Boolean).join(" ").toLocaleLowerCase();
}

export function queryTemporalProvenanceGraph(graph, {
  query,
  kinds = null,
  relations = null,
  authorityClasses = ["derived", "heuristic"],
  freshness = ["current"],
  minConfidence = 0,
  includeUnreviewedCandidates = false,
  depth = 1,
  maxNodes = 100,
  maxEdges = 200,
} = {}) {
  verifyTemporalProvenanceGraph(graph);
  const normalizedQuery = String(query || "").trim().toLocaleLowerCase();
  if (!normalizedQuery) fail("Temporal graph query is required.", "TEMPORAL_QUERY_REQUIRED");
  const allowedKinds = normalizeAllowlist(kinds, TEMPORAL_NODE_KINDS, "kinds");
  const allowedRelations = normalizeAllowlist(relations, TEMPORAL_RELATION_TYPES, "relations");
  const allowedAuthorityClasses = normalizeAllowlist(authorityClasses, [...AUTHORITY_CLASSES], "authorityClasses");
  const allowedFreshness = normalizeAllowlist(freshness, [...FRESHNESS_STATES], "freshness");
  const safeDepth = Number(depth);
  const safeMaxNodes = Number(maxNodes);
  const safeMaxEdges = Number(maxEdges);
  const safeMinimumConfidence = Number(minConfidence);
  if (!Number.isInteger(safeDepth) || safeDepth < 0 || safeDepth > 3) fail("Temporal traversal depth must be from 0 to 3.", "INVALID_TEMPORAL_QUERY_DEPTH");
  if (!Number.isInteger(safeMaxNodes) || safeMaxNodes < 1 || safeMaxNodes > 500) fail("Temporal traversal maxNodes must be from 1 to 500.", "INVALID_TEMPORAL_QUERY_NODE_LIMIT");
  if (!Number.isInteger(safeMaxEdges) || safeMaxEdges < 0 || safeMaxEdges > 1000) fail("Temporal traversal maxEdges must be from 0 to 1000.", "INVALID_TEMPORAL_QUERY_EDGE_LIMIT");
  if (!Number.isFinite(safeMinimumConfidence) || safeMinimumConfidence < 0 || safeMinimumConfidence > 1) fail("Temporal traversal minConfidence must be from zero through one.", "INVALID_TEMPORAL_QUERY_CONFIDENCE");
  if (includeUnreviewedCandidates !== false) fail("This graph slice has no candidate-eligible traversal surface.", "TEMPORAL_CANDIDATE_TRAVERSAL_UNAVAILABLE");

  const confidenceOf = (record) => record.confidence == null ? 1 : record.confidence;
  const nodeEligible = (node) => allowedKinds.includes(node.kind) && allowedAuthorityClasses.includes(node.authorityClass)
    && allowedFreshness.includes(node.freshness) && confidenceOf(node) >= safeMinimumConfidence;
  const edgeEligible = (edge) => allowedRelations.includes(edge.type) && allowedAuthorityClasses.includes(edge.authorityClass)
    && allowedFreshness.includes(edge.freshness) && confidenceOf(edge) >= safeMinimumConfidence;
  const eligibleNodes = graph.nodes.filter(nodeEligible);
  const eligibleNodeIds = new Set(eligibleNodes.map((node) => node.nodeId));
  const matching = eligibleNodes.filter((node) => searchable(node).includes(normalizedQuery));
  const anchors = matching.slice(0, safeMaxNodes);
  const selected = new Set(anchors.map((node) => node.nodeId));
  const inclusionReasons = new Map(anchors.map((node) => [node.nodeId, "query-match"]));
  let frontier = new Set(selected);
  const selectedEdges = [];
  let nodeLimitExcluded = Math.max(0, matching.length - anchors.length);
  let edgeLimitExcluded = 0;
  const eligibleEdges = graph.edges.filter((edge) => edgeEligible(edge) && eligibleNodeIds.has(edge.from) && eligibleNodeIds.has(edge.to));
  for (let level = 0; level < safeDepth && frontier.size; level += 1) {
    const next = new Set();
    for (const edge of eligibleEdges) {
      if (!frontier.has(edge.from) && !frontier.has(edge.to)) continue;
      if (selectedEdges.length >= safeMaxEdges) { edgeLimitExcluded += 1; continue; }
      const missing = [edge.from, edge.to].filter((nodeId) => !selected.has(nodeId) && !next.has(nodeId));
      if (selected.size + next.size + missing.length > safeMaxNodes) { nodeLimitExcluded += missing.length; continue; }
      for (const nodeId of missing) {
        next.add(nodeId);
        inclusionReasons.set(nodeId, `traversed-depth-${level + 1}`);
      }
      if (!selectedEdges.some((candidate) => candidate.edgeId === edge.edgeId)) selectedEdges.push(edge);
    }
    for (const nodeId of next) selected.add(nodeId);
    frontier = next;
  }
  const nodes = graph.nodes.filter((node) => selected.has(node.nodeId));
  selectedEdges.sort((left, right) => left.edgeId.localeCompare(right.edgeId));
  const traversalQuery = {
    normalizedQuery,
    anchorIds: anchors.map((node) => node.nodeId),
    allowedKinds,
    allowedRelations,
    allowedAuthorityClasses,
    allowedFreshness,
    minConfidence: safeMinimumConfidence,
    includeUnreviewedCandidates: false,
    maxDepth: safeDepth,
    maxNodes: safeMaxNodes,
    maxEdges: safeMaxEdges,
    ordering: "nodeId-then-edgeId-ascending",
  };
  const queryHash = digest(canonicalJson(traversalQuery));
  const resultPayload = {
    kind: "TemporalTraversalResult",
    protocol: { name: "head-agent-core-temporal-traversal", version: TEMPORAL_PROVENANCE_VERSION },
    graphSnapshotId: graph.graphSnapshotId,
    graphSnapshotHash: graph.graphSnapshotHash,
    sourceSnapshotId: graph.sourceSnapshotId,
    traversalQuery,
    queryId: `traversal-query-${queryHash.slice(0, 24)}`,
    queryHash,
    nodes,
    edges: selectedEdges,
    inclusion: nodes.map((node) => ({ nodeId: node.nodeId, reason: inclusionReasons.get(node.nodeId) || "connected-selected-endpoint" })),
    exclusion: {
      unmatchedNodeCount: graph.nodes.filter((node) => nodeEligible(node) && !searchable(node).includes(normalizedQuery) && !selected.has(node.nodeId)).length,
      disallowedNodeCount: graph.nodes.filter((node) => !nodeEligible(node)).length,
      disallowedEdgeCount: graph.edges.filter((edge) => !edgeEligible(edge)).length,
      nodeLimitExcluded,
      edgeLimitExcluded,
      unreviewedCandidatesExcluded: 0,
    },
    truncated: nodeLimitExcluded > 0 || edgeLimitExcluded > 0,
    authority: "derived-evidence-only",
    instructionAuthority: false,
    promotionAuthority: false,
  };
  const resultHash = digest(canonicalJson(resultPayload));
  return { ...resultPayload, resultId: `traversal-result-${resultHash.slice(0, 24)}`, resultHash };
}
