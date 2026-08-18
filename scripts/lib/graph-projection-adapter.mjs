import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { queryTemporalProvenanceGraph, verifyTemporalProvenanceGraph } from "./temporal-provenance.mjs";

export const GRAPH_PROJECTION_ADAPTER_VERSION = "0.1.0";
export const GRAPH_PROJECTION_CONTRACT = "replaceable-rebuildable-derived-graph-projection";

const REQUIRED_METHODS = [
  "describe",
  "readPointer",
  "readSnapshot",
  "writePointer",
  "writeSnapshot",
  "listSnapshotIds",
  "query",
];

const fail = (message, code = "GRAPH_PROJECTION_ERROR") => {
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

export function graphProjectionCanonicalJson(value) {
  return JSON.stringify(canonical(value));
}

const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const clone = (value) => JSON.parse(JSON.stringify(value));

function graphSnapshotId(value) {
  if (typeof value !== "string" || !/^graph-snapshot-[a-f0-9]{24}$/.test(value)) {
    fail("GraphSnapshot id is invalid.", "INVALID_GRAPH_SNAPSHOT_ID");
  }
  return value;
}

function parseDocument(file, label) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { fail(`${label} is invalid JSON: ${error.message}`, "INVALID_GRAPH_PROJECTION_DOCUMENT"); }
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

export function assertGraphProjectionAdapter(adapter) {
  if (!adapter || typeof adapter !== "object") fail("A GraphProjectionAdapter object is required.", "INVALID_GRAPH_PROJECTION_ADAPTER");
  if (adapter.adapterVersion !== GRAPH_PROJECTION_ADAPTER_VERSION) {
    fail(`GraphProjectionAdapter version must be ${GRAPH_PROJECTION_ADAPTER_VERSION}.`, "INCOMPATIBLE_GRAPH_PROJECTION_ADAPTER");
  }
  for (const method of REQUIRED_METHODS) if (typeof adapter[method] !== "function") {
    fail(`GraphProjectionAdapter is missing ${method}().`, "INVALID_GRAPH_PROJECTION_ADAPTER");
  }
  const descriptor = adapter.describe();
  if (!descriptor || descriptor.contract !== GRAPH_PROJECTION_CONTRACT
    || typeof descriptor.adapterKind !== "string" || !descriptor.adapterKind.trim()
    || descriptor.adapterVersion !== GRAPH_PROJECTION_ADAPTER_VERSION) {
    fail("GraphProjectionAdapter descriptor is invalid.", "INVALID_GRAPH_PROJECTION_ADAPTER");
  }
  if (descriptor.authority !== "derived-evidence-only" || descriptor.instructionAuthority !== false
    || descriptor.promotionAuthority !== false || descriptor.rebuildable !== true || descriptor.uniqueAuthority !== false) {
    fail("GraphProjectionAdapter cannot claim canon, instruction, promotion, or unique authority.", "INVALID_GRAPH_PROJECTION_AUTHORITY");
  }
  if (typeof descriptor.remote !== "boolean" || typeof descriptor.durable !== "boolean") {
    fail("GraphProjectionAdapter must disclose remote and durable behavior.", "INVALID_GRAPH_PROJECTION_ADAPTER");
  }
  return adapter;
}

function pointerPayload(graph) {
  return {
    schemaVersion: 1,
    kind: "GraphProjectionPointer",
    protocol: { name: "head-agent-core-graph-projection", version: GRAPH_PROJECTION_ADAPTER_VERSION },
    projectId: graph.projectId,
    graphSnapshotId: graph.graphSnapshotId,
    graphSnapshotHash: graph.graphSnapshotHash,
    sourceSnapshotId: graph.sourceSnapshotId,
    authority: "derived-evidence-only",
    rebuildable: true,
    uniqueAuthority: false,
    instructionAuthority: false,
    promotionAuthority: false,
  };
}

function pointerFor(graph) {
  const payload = pointerPayload(graph);
  const pointerHash = digest(graphProjectionCanonicalJson(payload));
  return { ...payload, pointerId: `graph-projection-pointer-${pointerHash.slice(0, 24)}`, pointerHash };
}

export function verifyGraphProjectionPointer(document, expectedGraph = null) {
  if (!document || document.kind !== "GraphProjectionPointer" || document.schemaVersion !== 1
    || document.protocol?.name !== "head-agent-core-graph-projection"
    || document.protocol?.version !== GRAPH_PROJECTION_ADAPTER_VERSION
    || typeof document.projectId !== "string" || !document.projectId
    || !/^graph-snapshot-[a-f0-9]{24}$/.test(document.graphSnapshotId || "")
    || !/^[a-f0-9]{64}$/.test(document.graphSnapshotHash || "")
    || !/^source-snapshot-[a-f0-9]{24}$/.test(document.sourceSnapshotId || "")
    || document.authority !== "derived-evidence-only" || document.rebuildable !== true || document.uniqueAuthority !== false
    || document.instructionAuthority !== false || document.promotionAuthority !== false) {
    fail("Graph projection pointer is invalid.", "INVALID_GRAPH_PROJECTION_POINTER");
  }
  const payload = { ...document };
  delete payload.pointerId;
  delete payload.pointerHash;
  const pointerHash = digest(graphProjectionCanonicalJson(payload));
  if (document.pointerHash !== pointerHash || document.pointerId !== `graph-projection-pointer-${pointerHash.slice(0, 24)}`) {
    fail("Graph projection pointer digest verification failed.", "GRAPH_PROJECTION_POINTER_DIGEST_MISMATCH");
  }
  if (expectedGraph && (document.projectId !== expectedGraph.projectId
    || document.graphSnapshotId !== expectedGraph.graphSnapshotId
    || document.graphSnapshotHash !== expectedGraph.graphSnapshotHash
    || document.sourceSnapshotId !== expectedGraph.sourceSnapshotId)) {
    fail("Graph projection pointer does not match the expected GraphSnapshot.", "GRAPH_PROJECTION_STALE");
  }
  return document;
}

function descriptor(adapterKind, { remote, durable }) {
  return {
    contract: GRAPH_PROJECTION_CONTRACT,
    adapterKind,
    adapterVersion: GRAPH_PROJECTION_ADAPTER_VERSION,
    authority: "derived-evidence-only",
    rebuildable: true,
    uniqueAuthority: false,
    instructionAuthority: false,
    promotionAuthority: false,
    remote,
    durable,
  };
}

export class LocalJsonGraphProjectionAdapter {
  constructor({ projectRoot }) {
    if (typeof projectRoot !== "string" || !projectRoot.trim()) fail("Local graph projection requires projectRoot.", "GRAPH_PROJECTION_ROOT_REQUIRED");
    this.projectRoot = path.resolve(projectRoot);
    this.adapterVersion = GRAPH_PROJECTION_ADAPTER_VERSION;
  }

  describe() {
    return descriptor("local-json", { remote: false, durable: true });
  }

  pointerLocation() {
    return path.join(this.projectRoot, ".head", "graph-projection", "current.json");
  }

  snapshotLocation(id) {
    return path.join(this.projectRoot, ".head", "graph-projection", "snapshots", `${graphSnapshotId(id)}.json`);
  }

  readPointer() {
    const location = this.pointerLocation();
    return fs.existsSync(location) ? { location, document: parseDocument(location, "Graph projection pointer") } : null;
  }

  readSnapshot(id) {
    const location = this.snapshotLocation(id);
    return fs.existsSync(location) ? { location, document: parseDocument(location, "Graph projection snapshot") } : null;
  }

  writeSnapshot(id, document) {
    const location = this.snapshotLocation(id);
    if (fs.existsSync(location)) return { location, created: false, document: parseDocument(location, "Graph projection snapshot") };
    atomicWrite(location, json(document));
    return { location, created: true, document };
  }

  writePointer(document) {
    const location = this.pointerLocation();
    atomicWrite(location, json(document));
    return { location, document };
  }

  listSnapshotIds() {
    const directory = path.join(this.projectRoot, ".head", "graph-projection", "snapshots");
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^graph-snapshot-[a-f0-9]{24}\.json$/.test(entry.name))
      .map((entry) => entry.name.slice(0, -5)).sort();
  }

  query(id, options) {
    const entry = this.readSnapshot(id);
    if (!entry) fail(`Graph projection snapshot is missing: ${id}`, "GRAPH_PROJECTION_SNAPSHOT_MISSING");
    return queryTemporalProvenanceGraph(entry.document, options);
  }
}

export class InMemoryGraphProjectionAdapter {
  constructor({ adapterKind = "in-memory" } = {}) {
    this.adapterVersion = GRAPH_PROJECTION_ADAPTER_VERSION;
    this.adapterKind = adapterKind;
    this.pointer = null;
    this.snapshots = new Map();
  }

  describe() {
    return descriptor(this.adapterKind, { remote: false, durable: false });
  }

  readPointer() {
    return this.pointer ? { location: "memory://graph-projection/current", document: clone(this.pointer) } : null;
  }

  readSnapshot(id) {
    graphSnapshotId(id);
    const document = this.snapshots.get(id);
    return document ? { location: `memory://graph-projection/snapshots/${id}`, document: clone(document) } : null;
  }

  writeSnapshot(id, document) {
    graphSnapshotId(id);
    const created = !this.snapshots.has(id);
    if (created) this.snapshots.set(id, clone(document));
    return { location: `memory://graph-projection/snapshots/${id}`, created, document: clone(this.snapshots.get(id)) };
  }

  writePointer(document) {
    this.pointer = clone(document);
    return { location: "memory://graph-projection/current", document: clone(document) };
  }

  listSnapshotIds() {
    return [...this.snapshots.keys()].sort();
  }

  query(id, options) {
    const entry = this.readSnapshot(id);
    if (!entry) fail(`Graph projection snapshot is missing: ${id}`, "GRAPH_PROJECTION_SNAPSHOT_MISSING");
    return queryTemporalProvenanceGraph(entry.document, options);
  }
}

export function createGraphProjectionAdapter({ projectRoot, adapter = null } = {}) {
  return assertGraphProjectionAdapter(adapter || new LocalJsonGraphProjectionAdapter({ projectRoot }));
}

export function materializeGraphProjection({ projectRoot, graph, adapter = null } = {}) {
  verifyTemporalProvenanceGraph(graph);
  const selected = createGraphProjectionAdapter({ projectRoot, adapter });
  const existing = selected.readSnapshot(graph.graphSnapshotId);
  let snapshotEntry;
  if (existing) {
    verifyTemporalProvenanceGraph(existing.document);
    if (graphProjectionCanonicalJson(existing.document) !== graphProjectionCanonicalJson(graph)) {
      fail("Graph projection adapter returned conflicting content for the same GraphSnapshot id.", "GRAPH_PROJECTION_SNAPSHOT_CONFLICT");
    }
    snapshotEntry = existing;
  } else {
    snapshotEntry = selected.writeSnapshot(graph.graphSnapshotId, clone(graph));
    verifyTemporalProvenanceGraph(snapshotEntry.document);
    if (graphProjectionCanonicalJson(snapshotEntry.document) !== graphProjectionCanonicalJson(graph)) {
      fail("Graph projection adapter changed the GraphSnapshot during materialization.", "GRAPH_PROJECTION_WRITE_MISMATCH");
    }
  }
  const pointer = pointerFor(graph);
  const pointerEntry = selected.writePointer(clone(pointer));
  verifyGraphProjectionPointer(pointerEntry.document, graph);
  if (graphProjectionCanonicalJson(pointerEntry.document) !== graphProjectionCanonicalJson(pointer)) {
    fail("Graph projection adapter changed the pointer during materialization.", "GRAPH_PROJECTION_WRITE_MISMATCH");
  }
  return {
    status: existing ? "unchanged" : "projected",
    pointer,
    pointerLocation: pointerEntry.location,
    snapshotLocation: snapshotEntry.location,
    adapter: selected.describe(),
  };
}

export function inspectGraphProjection({ projectRoot, graph, adapter = null } = {}) {
  verifyTemporalProvenanceGraph(graph);
  const selected = createGraphProjectionAdapter({ projectRoot, adapter });
  const pointerEntry = selected.readPointer();
  if (!pointerEntry) return {
    status: "not-materialized",
    graphSnapshotId: graph.graphSnapshotId,
    fallbackAvailable: true,
    adapter: selected.describe(),
  };
  const pointer = verifyGraphProjectionPointer(pointerEntry.document);
  if (pointer.graphSnapshotId !== graph.graphSnapshotId || pointer.graphSnapshotHash !== graph.graphSnapshotHash
    || pointer.sourceSnapshotId !== graph.sourceSnapshotId || pointer.projectId !== graph.projectId) {
    return {
      status: "stale",
      expectedGraphSnapshotId: graph.graphSnapshotId,
      projectedGraphSnapshotId: pointer.graphSnapshotId,
      fallbackAvailable: false,
      pointer,
      adapter: selected.describe(),
    };
  }
  const snapshotEntry = selected.readSnapshot(pointer.graphSnapshotId);
  if (!snapshotEntry) fail("Graph projection pointer references a missing snapshot.", "GRAPH_PROJECTION_SNAPSHOT_MISSING");
  verifyTemporalProvenanceGraph(snapshotEntry.document);
  if (graphProjectionCanonicalJson(snapshotEntry.document) !== graphProjectionCanonicalJson(graph)) {
    fail("Graph projection snapshot differs from the embedded recoverable GraphSnapshot.", "GRAPH_PROJECTION_SNAPSHOT_CONFLICT");
  }
  return {
    status: "current",
    graphSnapshotId: graph.graphSnapshotId,
    pointer,
    pointerLocation: pointerEntry.location,
    snapshotLocation: snapshotEntry.location,
    fallbackAvailable: true,
    adapter: selected.describe(),
  };
}

export function queryGraphProjection({ projectRoot, graph, adapter = null, query = {} } = {}) {
  const selected = createGraphProjectionAdapter({ projectRoot, adapter });
  const expected = queryTemporalProvenanceGraph(graph, query);
  const inspected = inspectGraphProjection({ projectRoot, graph, adapter: selected });
  if (inspected.status === "not-materialized") return {
    result: expected,
    diagnostics: {
      adapter: selected.describe(),
      executionMode: "embedded-graph-fallback",
      fallbackUsed: true,
      fallbackReasonCode: "GRAPH_PROJECTION_NOT_MATERIALIZED",
    },
  };
  if (inspected.status === "stale") {
    fail("Graph projection adapter is stale and cannot answer a current query.", "GRAPH_PROJECTION_STALE");
  }
  const candidate = selected.query(graph.graphSnapshotId, clone(query));
  if (graphProjectionCanonicalJson(candidate) !== graphProjectionCanonicalJson(expected)) {
    fail("Graph projection adapter query result differs from the deterministic reference result.", "GRAPH_PROJECTION_QUERY_MISMATCH");
  }
  return {
    result: candidate,
    diagnostics: {
      adapter: selected.describe(),
      executionMode: "graph-projection-adapter",
      fallbackUsed: false,
      fallbackReasonCode: "",
    },
  };
}

export function verifyGraphProjectionAdapterConformance({
  projectRoot,
  graph,
  referenceAdapter,
  candidateAdapter,
  queries = [],
} = {}) {
  verifyTemporalProvenanceGraph(graph);
  const reference = createGraphProjectionAdapter({ projectRoot, adapter: referenceAdapter });
  const candidate = createGraphProjectionAdapter({ projectRoot, adapter: candidateAdapter });
  if (!Array.isArray(queries) || queries.length < 1 || queries.length > 64) {
    fail("Graph projection conformance requires from one through 64 query fixtures.", "INVALID_GRAPH_PROJECTION_CONFORMANCE_FIXTURES");
  }
  const names = new Set();
  const normalized = queries.map((fixture) => {
    if (!fixture || typeof fixture.name !== "string" || !fixture.name.trim() || !fixture.query || typeof fixture.query !== "object") {
      fail("Every graph projection conformance fixture requires a name and query object.", "INVALID_GRAPH_PROJECTION_CONFORMANCE_FIXTURES");
    }
    const name = fixture.name.trim();
    if (names.has(name)) fail(`Duplicate graph projection conformance fixture: ${name}`, "INVALID_GRAPH_PROJECTION_CONFORMANCE_FIXTURES");
    names.add(name);
    return { name, query: fixture.query };
  }).sort((left, right) => left.name.localeCompare(right.name));

  materializeGraphProjection({ projectRoot, graph, adapter: reference });
  materializeGraphProjection({ projectRoot, graph, adapter: candidate });
  const cases = normalized.map((fixture) => {
    const referenceResult = queryGraphProjection({ projectRoot, graph, adapter: reference, query: fixture.query }).result;
    const candidateResult = queryGraphProjection({ projectRoot, graph, adapter: candidate, query: fixture.query }).result;
    if (graphProjectionCanonicalJson(referenceResult) !== graphProjectionCanonicalJson(candidateResult)) {
      fail(`Graph projection adapters diverged for fixture: ${fixture.name}`, "GRAPH_PROJECTION_CONFORMANCE_MISMATCH");
    }
    return {
      name: fixture.name,
      queryId: referenceResult.queryId,
      queryHash: referenceResult.queryHash,
      resultId: referenceResult.resultId,
      resultHash: referenceResult.resultHash,
    };
  });
  const payload = {
    schemaVersion: 1,
    kind: "GraphProjectionConformanceReport",
    protocol: { name: "head-agent-core-graph-projection-conformance", version: GRAPH_PROJECTION_ADAPTER_VERSION },
    graphSnapshotId: graph.graphSnapshotId,
    graphSnapshotHash: graph.graphSnapshotHash,
    sourceSnapshotId: graph.sourceSnapshotId,
    referenceAdapter: reference.describe(),
    candidateAdapter: candidate.describe(),
    cases,
    semanticIdentity: "adapter-neutral",
    authority: "derived-verification-evidence-only",
    instructionAuthority: false,
    promotionAuthority: false,
  };
  const conformanceReportHash = digest(graphProjectionCanonicalJson(payload));
  return { ...payload, conformanceReportId: `graph-projection-conformance-${conformanceReportHash.slice(0, 24)}`, conformanceReportHash };
}
