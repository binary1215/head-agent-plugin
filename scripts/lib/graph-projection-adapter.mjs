import crypto from "node:crypto";
import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ONBOARDING_STORAGE_DIRECTORY, verifyOnboardingState, verifyStorageSelection } from "./onboarding-contract.mjs";
import { queryTemporalProvenanceGraph, verifyTemporalProvenanceGraph } from "./temporal-provenance.mjs";

export const GRAPH_PROJECTION_ADAPTER_VERSION = "0.1.0";
export const GRAPH_PROJECTION_CONTRACT = "replaceable-rebuildable-derived-graph-projection";
export const ARCADEDB_GRAPH_PROJECTION_VERSION = "0.1.0";
export const ARCADEDB_GRAPH_TOPOLOGY_VERSION = "0.1.0";
export const ARCADEDB_SERVER_TRAVERSAL_VERSION = "0.1.0";
export const PREPARED_TRAVERSAL_VERSION = "0.1.0";

const ARCADEDB_SNAPSHOT_TYPE = "HeadAgentGraphSnapshot";
const ARCADEDB_POINTER_TYPE = "HeadAgentGraphPointer";
const ARCADEDB_NODE_TYPE = "HeadAgentGraphNode";
const ARCADEDB_EDGE_TYPE = "HeadAgentGraphEdge";
const ARCADEDB_TOPOLOGY_TYPE = "HeadAgentGraphTopology";
const ARCADEDB_ACTIVATION_DIRECTORY = path.join(".head", "graph-projection", "arcadedb", "activations");
const ARCADEDB_CONFORMANCE_DIRECTORY = path.join(".head", "graph-projection", "arcadedb", "conformance");
const ARCADEDB_ACTIVATION_POINTER = path.join(".head", "graph-projection", "arcadedb", "current.json");
const ARCADEDB_TOPOLOGY_ACTIVATION_DIRECTORY = path.join(".head", "graph-projection", "arcadedb", "topology", "activations");
const ARCADEDB_TOPOLOGY_ACTIVATION_POINTER = path.join(".head", "graph-projection", "arcadedb", "topology", "current.json");
const ARCADEDB_TRANSPORT_METHODS = ["describe", "ensureSchema", "readPointer", "readSnapshot", "writePointer", "writeSnapshot", "listSnapshotIds"];
const ARCADEDB_TOPOLOGY_TRANSPORT_METHODS = ["ensureTopologySchema", "readTopology", "writeTopology"];
const ARCADEDB_SERVER_TRAVERSAL_TRANSPORT_METHODS = ["queryTopology"];
const ARCADEDB_PREPARED_TRAVERSAL_TRANSPORT_METHODS = ["readTopologyManifest", "queryTopology"];
const ARCADEDB_SERVER_TRAVERSAL_MODE = "server-expanded-client-canonicalized";
const ARCADEDB_SERVER_TRAVERSAL_MAX_RECORDS = 8192;
const PREPARED_TRAVERSAL_ORDERING = "record-depth-then-semantic-id-ascending";
const BRIDGE_FILE = fileURLToPath(new URL("./arcadedb-http-bridge.mjs", import.meta.url));

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

function assertFields(value, fields, label, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} is invalid.`, code);
  const expected = new Set(fields);
  const unexpected = Object.keys(value).filter((field) => !expected.has(field));
  const missing = fields.filter((field) => !(field in value));
  if (unexpected.length || missing.length) fail(`${label} fields are invalid.`, code);
}

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
  if (descriptor.preparedTraversalProtocolVersion != null
    && (descriptor.preparedTraversalProtocolVersion !== PREPARED_TRAVERSAL_VERSION
      || typeof descriptor.preparedTraversalMode !== "string" || !descriptor.preparedTraversalMode.trim()
      || typeof adapter.queryPrepared !== "function")) {
    fail("GraphProjectionAdapter prepared traversal capability is invalid.", "INVALID_GRAPH_PROJECTION_ADAPTER");
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

function topologyPayload(graph) {
  verifyTemporalProvenanceGraph(graph);
  return {
    schemaVersion: 1,
    kind: "ArcadeDbGraphTopology",
    protocol: { name: "head-agent-core-arcadedb-graph-topology", version: ARCADEDB_GRAPH_TOPOLOGY_VERSION },
    projectId: graph.projectId,
    graphSnapshotId: graph.graphSnapshotId,
    graphSnapshotHash: graph.graphSnapshotHash,
    sourceSnapshotId: graph.sourceSnapshotId,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    nodeSetHash: digest(graphProjectionCanonicalJson(graph.nodes)),
    edgeSetHash: digest(graphProjectionCanonicalJson(graph.edges)),
    authority: "derived-evidence-only",
    rebuildable: true,
    uniqueAuthority: false,
    instructionAuthority: false,
    promotionAuthority: false,
    serverRecordIdentitySemantic: false,
  };
}

export function buildArcadeDbGraphTopology(graph) {
  const payload = topologyPayload(graph);
  const topologyHash = digest(graphProjectionCanonicalJson(payload));
  return { ...payload, topologyId: `arcadedb-graph-topology-${topologyHash.slice(0, 24)}`, topologyHash };
}

export function verifyArcadeDbGraphTopology(document, graph = null) {
  assertFields(document, [
    "schemaVersion", "kind", "protocol", "projectId", "graphSnapshotId", "graphSnapshotHash", "sourceSnapshotId", "nodeCount",
    "edgeCount", "nodeSetHash", "edgeSetHash", "authority", "rebuildable", "uniqueAuthority", "instructionAuthority",
    "promotionAuthority", "serverRecordIdentitySemantic", "topologyId", "topologyHash",
  ], "ArcadeDB graph topology", "INVALID_ARCADEDB_GRAPH_TOPOLOGY");
  if (!document || document.kind !== "ArcadeDbGraphTopology" || document.schemaVersion !== 1
    || document.protocol?.name !== "head-agent-core-arcadedb-graph-topology"
    || document.protocol?.version !== ARCADEDB_GRAPH_TOPOLOGY_VERSION
    || typeof document.projectId !== "string" || !document.projectId
    || !/^graph-snapshot-[a-f0-9]{24}$/.test(document.graphSnapshotId || "")
    || !/^[a-f0-9]{64}$/.test(document.graphSnapshotHash || "")
    || !/^source-snapshot-[a-f0-9]{24}$/.test(document.sourceSnapshotId || "")
    || !Number.isInteger(document.nodeCount) || document.nodeCount < 0
    || !Number.isInteger(document.edgeCount) || document.edgeCount < 0
    || !/^[a-f0-9]{64}$/.test(document.nodeSetHash || "") || !/^[a-f0-9]{64}$/.test(document.edgeSetHash || "")
    || document.authority !== "derived-evidence-only" || document.rebuildable !== true || document.uniqueAuthority !== false
    || document.instructionAuthority !== false || document.promotionAuthority !== false || document.serverRecordIdentitySemantic !== false
    || !/^arcadedb-graph-topology-[a-f0-9]{24}$/.test(document.topologyId || "")
    || !/^[a-f0-9]{64}$/.test(document.topologyHash || "")) {
    fail("ArcadeDB graph topology is invalid.", "INVALID_ARCADEDB_GRAPH_TOPOLOGY");
  }
  const payload = { ...document };
  delete payload.topologyId;
  delete payload.topologyHash;
  const hash = digest(graphProjectionCanonicalJson(payload));
  if (document.topologyHash !== hash || document.topologyId !== `arcadedb-graph-topology-${hash.slice(0, 24)}`) {
    fail("ArcadeDB graph topology digest verification failed.", "ARCADEDB_GRAPH_TOPOLOGY_DIGEST_MISMATCH");
  }
  if (graph) {
    const expected = buildArcadeDbGraphTopology(graph);
    if (graphProjectionCanonicalJson(document) !== graphProjectionCanonicalJson(expected)) {
      fail("ArcadeDB graph topology does not match the expected GraphSnapshot.", "ARCADEDB_GRAPH_TOPOLOGY_MISMATCH");
    }
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

function assertArcadeDbTransport(transport) {
  if (!transport || typeof transport !== "object") fail("An ArcadeDB transport is required.", "INVALID_ARCADEDB_TRANSPORT");
  for (const method of ARCADEDB_TRANSPORT_METHODS) if (typeof transport[method] !== "function") {
    fail(`ArcadeDB transport is missing ${method}().`, "INVALID_ARCADEDB_TRANSPORT");
  }
  const described = transport.describe();
  if (!described || described.protocol !== "arcadedb-http-json" || described.credentialsPersisted !== false) {
    fail("ArcadeDB transport descriptor is invalid.", "INVALID_ARCADEDB_TRANSPORT");
  }
  return transport;
}

function assertArcadeDbTopologyTransport(transport) {
  for (const method of ARCADEDB_TOPOLOGY_TRANSPORT_METHODS) if (typeof transport?.[method] !== "function") {
    fail(`ArcadeDB transport is missing topology method ${method}().`, "INVALID_ARCADEDB_TOPOLOGY_TRANSPORT");
  }
  return transport;
}

function assertArcadeDbServerTraversalTransport(transport) {
  for (const method of ARCADEDB_SERVER_TRAVERSAL_TRANSPORT_METHODS) if (typeof transport?.[method] !== "function") {
    fail(`ArcadeDB transport is missing server traversal method ${method}().`, "INVALID_ARCADEDB_SERVER_TRAVERSAL_TRANSPORT");
  }
  return transport;
}

function assertArcadeDbPreparedTraversalTransport(transport) {
  for (const method of ARCADEDB_PREPARED_TRAVERSAL_TRANSPORT_METHODS) if (typeof transport?.[method] !== "function") {
    fail(`ArcadeDB transport is missing prepared traversal method ${method}().`, "INVALID_ARCADEDB_PREPARED_TRAVERSAL_TRANSPORT");
  }
  return transport;
}

function supportsPreparedTraversal(adapter) {
  const described = adapter.describe();
  return described.preparedTraversalProtocolVersion === PREPARED_TRAVERSAL_VERSION
    && typeof adapter.queryPrepared === "function";
}

function bridgeError(result) {
  let document = null;
  try { document = JSON.parse(String(result.stdout || "")); } catch { /* handled below */ }
  const code = document?.error?.code || (result.error?.code === "ETIMEDOUT" ? "ARCADEDB_TRANSPORT_UNAVAILABLE" : "ARCADEDB_BRIDGE_FAILED");
  const error = new Error(document?.error?.message || "ArcadeDB HTTP bridge failed.");
  error.code = code;
  throw error;
}

function responseRecords(response) {
  const result = response?.body?.result;
  if (result == null) return [];
  if (!Array.isArray(result)) fail("ArcadeDB returned an invalid result envelope.", "ARCADEDB_INVALID_RESPONSE");
  return result;
}

export class ArcadeDbHttpTransport {
  constructor({ storageSelection, timeoutMs = 15000 } = {}) {
    this.storageSelection = verifyStorageSelection(storageSelection);
    if (this.storageSelection.mode !== "graphdb") fail("ArcadeDB transport requires a GraphDB storage selection.", "ARCADEDB_SELECTION_REQUIRED");
    this.timeoutMs = Number(timeoutMs);
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1000 || this.timeoutMs > 120000) {
      fail("ArcadeDB timeout must be from 1000 through 120000 milliseconds.", "INVALID_ARCADEDB_TIMEOUT");
    }
  }

  describe() {
    return {
      protocol: "arcadedb-http-json",
      protocolVersion: ARCADEDB_GRAPH_PROJECTION_VERSION,
      remote: true,
      durable: true,
      credentialsPersisted: false,
      secretResolution: "environment-reference-at-request-time",
    };
  }

  invoke(operation, { language = "sql", command = "", params = {} } = {}) {
    const input = {
      endpoint: this.storageSelection.graphdb.endpoint,
      database: this.storageSelection.graphdb.database,
      secretReferenceNames: this.storageSelection.graphdb.secretReferenceNames,
      operation,
      timeoutMs: this.timeoutMs,
      ...(operation === "ready" ? {} : { language, command, params }),
    };
    const result = childProcess.spawnSync(process.execPath, [BRIDGE_FILE], {
      input: JSON.stringify(input),
      encoding: "utf8",
      windowsHide: true,
      timeout: this.timeoutMs + 2000,
      maxBuffer: 64 * 1024 * 1024,
      env: process.env,
    });
    if (result.error || result.status == null || result.status === 2) bridgeError(result);
    let response;
    try { response = JSON.parse(String(result.stdout || "")); }
    catch { fail("ArcadeDB HTTP bridge returned invalid JSON.", "ARCADEDB_INVALID_RESPONSE"); }
    if (result.status !== 0 || response.ok !== true) {
      const status = Number(response.status || 0);
      const code = status === 401 || status === 403
        ? "ARCADEDB_AUTHENTICATION_FAILED"
        : status === 429 || status >= 500
          ? "ARCADEDB_TRANSPORT_UNAVAILABLE"
          : "ARCADEDB_REQUEST_REJECTED";
      fail(`ArcadeDB request was rejected${status ? ` with HTTP ${status}` : ""}.`, code);
    }
    return response;
  }

  ensureSchema() {
    const command = [
      `CREATE DOCUMENT TYPE ${ARCADEDB_SNAPSHOT_TYPE} IF NOT EXISTS`,
      `CREATE PROPERTY ${ARCADEDB_SNAPSHOT_TYPE}.projectId IF NOT EXISTS STRING`,
      `CREATE PROPERTY ${ARCADEDB_SNAPSHOT_TYPE}.graphSnapshotId IF NOT EXISTS STRING`,
      `CREATE PROPERTY ${ARCADEDB_SNAPSHOT_TYPE}.graphSnapshotHash IF NOT EXISTS STRING`,
      `CREATE PROPERTY ${ARCADEDB_SNAPSHOT_TYPE}.sourceSnapshotId IF NOT EXISTS STRING`,
      `CREATE PROPERTY ${ARCADEDB_SNAPSHOT_TYPE}.documentJson IF NOT EXISTS STRING`,
      `CREATE INDEX IF NOT EXISTS ON ${ARCADEDB_SNAPSHOT_TYPE} (projectId, graphSnapshotId) UNIQUE`,
      `CREATE DOCUMENT TYPE ${ARCADEDB_POINTER_TYPE} IF NOT EXISTS`,
      `CREATE PROPERTY ${ARCADEDB_POINTER_TYPE}.projectId IF NOT EXISTS STRING`,
      `CREATE PROPERTY ${ARCADEDB_POINTER_TYPE}.pointerJson IF NOT EXISTS STRING`,
      `CREATE INDEX IF NOT EXISTS ON ${ARCADEDB_POINTER_TYPE} (projectId) UNIQUE`,
    ].join(";\n");
    this.invoke("command", { language: "sqlscript", command });
  }

  ensureTopologySchema() {
    const command = [
      `CREATE VERTEX TYPE ${ARCADEDB_NODE_TYPE} IF NOT EXISTS`,
      `CREATE PROPERTY ${ARCADEDB_NODE_TYPE}.projectId IF NOT EXISTS STRING`,
      `CREATE PROPERTY ${ARCADEDB_NODE_TYPE}.graphSnapshotId IF NOT EXISTS STRING`,
      `CREATE PROPERTY ${ARCADEDB_NODE_TYPE}.graphSnapshotHash IF NOT EXISTS STRING`,
      `CREATE PROPERTY ${ARCADEDB_NODE_TYPE}.sourceSnapshotId IF NOT EXISTS STRING`,
      `CREATE PROPERTY ${ARCADEDB_NODE_TYPE}.nodeId IF NOT EXISTS STRING`,
      `CREATE PROPERTY ${ARCADEDB_NODE_TYPE}.nodeKind IF NOT EXISTS STRING`,
      `CREATE PROPERTY ${ARCADEDB_NODE_TYPE}.nodeJson IF NOT EXISTS STRING`,
      `CREATE INDEX IF NOT EXISTS ON ${ARCADEDB_NODE_TYPE} (projectId, graphSnapshotId, nodeId) UNIQUE`,
      `CREATE EDGE TYPE ${ARCADEDB_EDGE_TYPE} UNIDIRECTIONAL IF NOT EXISTS`,
      `CREATE PROPERTY ${ARCADEDB_EDGE_TYPE}.projectId IF NOT EXISTS STRING`,
      `CREATE PROPERTY ${ARCADEDB_EDGE_TYPE}.graphSnapshotId IF NOT EXISTS STRING`,
      `CREATE PROPERTY ${ARCADEDB_EDGE_TYPE}.graphSnapshotHash IF NOT EXISTS STRING`,
      `CREATE PROPERTY ${ARCADEDB_EDGE_TYPE}.sourceSnapshotId IF NOT EXISTS STRING`,
      `CREATE PROPERTY ${ARCADEDB_EDGE_TYPE}.edgeId IF NOT EXISTS STRING`,
      `CREATE PROPERTY ${ARCADEDB_EDGE_TYPE}.edgeType IF NOT EXISTS STRING`,
      `CREATE PROPERTY ${ARCADEDB_EDGE_TYPE}.edgeJson IF NOT EXISTS STRING`,
      `CREATE INDEX IF NOT EXISTS ON ${ARCADEDB_EDGE_TYPE} (projectId, graphSnapshotId, edgeId) UNIQUE`,
      `CREATE DOCUMENT TYPE ${ARCADEDB_TOPOLOGY_TYPE} IF NOT EXISTS`,
      `CREATE PROPERTY ${ARCADEDB_TOPOLOGY_TYPE}.projectId IF NOT EXISTS STRING`,
      `CREATE PROPERTY ${ARCADEDB_TOPOLOGY_TYPE}.graphSnapshotId IF NOT EXISTS STRING`,
      `CREATE PROPERTY ${ARCADEDB_TOPOLOGY_TYPE}.topologyId IF NOT EXISTS STRING`,
      `CREATE PROPERTY ${ARCADEDB_TOPOLOGY_TYPE}.topologyJson IF NOT EXISTS STRING`,
      `CREATE INDEX IF NOT EXISTS ON ${ARCADEDB_TOPOLOGY_TYPE} (projectId, graphSnapshotId) UNIQUE`,
    ].join(";\n");
    this.invoke("command", { language: "sqlscript", command });
  }

  readPointer(projectId) {
    const response = this.invoke("query", {
      command: `SELECT pointerJson FROM ${ARCADEDB_POINTER_TYPE} WHERE projectId = :projectId LIMIT 1`,
      params: { projectId },
    });
    return responseRecords(response)[0]?.pointerJson ?? null;
  }

  readSnapshot(projectId, id) {
    const response = this.invoke("query", {
      command: `SELECT documentJson FROM ${ARCADEDB_SNAPSHOT_TYPE} WHERE projectId = :projectId AND graphSnapshotId = :graphSnapshotId LIMIT 1`,
      params: { projectId, graphSnapshotId: id },
    });
    return responseRecords(response)[0]?.documentJson ?? null;
  }

  writeSnapshot(projectId, id, documentJson, metadata) {
    try {
      this.invoke("command", {
        command: `INSERT INTO ${ARCADEDB_SNAPSHOT_TYPE} SET projectId = :projectId, graphSnapshotId = :graphSnapshotId, graphSnapshotHash = :graphSnapshotHash, sourceSnapshotId = :sourceSnapshotId, documentJson = :documentJson`,
        params: { projectId, graphSnapshotId: id, documentJson, ...metadata },
      });
      return true;
    } catch (error) {
      if (error.code === "ARCADEDB_REQUEST_REJECTED" && this.readSnapshot(projectId, id) != null) return false;
      throw error;
    }
  }

  writePointer(projectId, pointerJson) {
    this.invoke("command", {
      command: `UPDATE ${ARCADEDB_POINTER_TYPE} SET pointerJson = :pointerJson UPSERT WHERE projectId = :projectId`,
      params: { projectId, pointerJson },
    });
  }

  listSnapshotIds(projectId) {
    const response = this.invoke("query", {
      command: `SELECT graphSnapshotId FROM ${ARCADEDB_SNAPSHOT_TYPE} WHERE projectId = :projectId ORDER BY graphSnapshotId`,
      params: { projectId },
    });
    return responseRecords(response).map((record) => record.graphSnapshotId);
  }

  readTopologyManifest(projectId, graphSnapshotId) {
    const response = this.invoke("query", {
      command: `SELECT topologyJson FROM ${ARCADEDB_TOPOLOGY_TYPE} WHERE projectId = :projectId AND graphSnapshotId = :graphSnapshotId LIMIT 1`,
      params: { projectId, graphSnapshotId },
    });
    return responseRecords(response)[0]?.topologyJson ?? null;
  }

  readTopology(projectId, graphSnapshotId) {
    const topologyJson = this.readTopologyManifest(projectId, graphSnapshotId);
    const nodeResponse = this.invoke("query", {
      command: `SELECT nodeJson FROM ${ARCADEDB_NODE_TYPE} WHERE projectId = :projectId AND graphSnapshotId = :graphSnapshotId ORDER BY nodeId`,
      params: { projectId, graphSnapshotId },
    });
    const edgeResponse = this.invoke("query", {
      command: `SELECT edgeJson FROM ${ARCADEDB_EDGE_TYPE} WHERE projectId = :projectId AND graphSnapshotId = :graphSnapshotId ORDER BY edgeId`,
      params: { projectId, graphSnapshotId },
    });
    const nodeJsons = responseRecords(nodeResponse).map((record) => record.nodeJson);
    const edgeJsons = responseRecords(edgeResponse).map((record) => record.edgeJson);
    if (topologyJson == null && nodeJsons.length === 0 && edgeJsons.length === 0) return null;
    return {
      topologyJson,
      nodeJsons,
      edgeJsons,
    };
  }

  writeTopology(projectId, graphSnapshotId, graph, topology) {
    this.ensureTopologySchema();
    for (const node of graph.nodes) {
      this.invoke("command", {
        command: `UPDATE ${ARCADEDB_NODE_TYPE} SET projectId = :projectId, graphSnapshotId = :graphSnapshotId, nodeId = :nodeId, graphSnapshotHash = :graphSnapshotHash, sourceSnapshotId = :sourceSnapshotId, nodeKind = :nodeKind, nodeJson = :nodeJson UPSERT WHERE projectId = :projectId AND graphSnapshotId = :graphSnapshotId AND nodeId = :nodeId`,
        params: {
          projectId,
          graphSnapshotId,
          graphSnapshotHash: graph.graphSnapshotHash,
          sourceSnapshotId: graph.sourceSnapshotId,
          nodeId: node.nodeId,
          nodeKind: node.kind,
          nodeJson: graphProjectionCanonicalJson(node),
        },
      });
    }
    for (const edge of graph.edges) {
      const params = {
        projectId,
        graphSnapshotId,
        graphSnapshotHash: graph.graphSnapshotHash,
        sourceSnapshotId: graph.sourceSnapshotId,
        edgeId: edge.edgeId,
        edgeType: edge.type,
        edgeJson: graphProjectionCanonicalJson(edge),
        fromNodeId: edge.from,
        toNodeId: edge.to,
      };
      const existing = responseRecords(this.invoke("query", {
        command: `SELECT edgeId FROM ${ARCADEDB_EDGE_TYPE} WHERE projectId = :projectId AND graphSnapshotId = :graphSnapshotId AND edgeId = :edgeId LIMIT 1`,
        params,
      }));
      if (existing.length) continue;
      try {
        this.invoke("command", {
          command: `CREATE EDGE ${ARCADEDB_EDGE_TYPE} FROM (SELECT FROM ${ARCADEDB_NODE_TYPE} WHERE projectId = :projectId AND graphSnapshotId = :graphSnapshotId AND nodeId = :fromNodeId) TO (SELECT FROM ${ARCADEDB_NODE_TYPE} WHERE projectId = :projectId AND graphSnapshotId = :graphSnapshotId AND nodeId = :toNodeId) SET projectId = :projectId, graphSnapshotId = :graphSnapshotId, graphSnapshotHash = :graphSnapshotHash, sourceSnapshotId = :sourceSnapshotId, edgeId = :edgeId, edgeType = :edgeType, edgeJson = :edgeJson`,
          params,
        });
      } catch (error) {
        const raced = responseRecords(this.invoke("query", {
          command: `SELECT edgeId FROM ${ARCADEDB_EDGE_TYPE} WHERE projectId = :projectId AND graphSnapshotId = :graphSnapshotId AND edgeId = :edgeId LIMIT 1`,
          params,
        }));
        if (!raced.length) throw error;
      }
    }
    this.invoke("command", {
      command: `UPDATE ${ARCADEDB_TOPOLOGY_TYPE} SET projectId = :projectId, graphSnapshotId = :graphSnapshotId, topologyId = :topologyId, topologyJson = :topologyJson UPSERT WHERE projectId = :projectId AND graphSnapshotId = :graphSnapshotId`,
      params: { projectId, graphSnapshotId, topologyId: topology.topologyId, topologyJson: graphProjectionCanonicalJson(topology) },
    });
  }

  queryTopology(projectId, graphSnapshotId, { anchorIds, maxDepth, maxRecords }) {
    if (!Array.isArray(anchorIds) || anchorIds.length > 500
      || anchorIds.some((nodeId) => typeof nodeId !== "string" || !nodeId)
      || !Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 3
      || !Number.isInteger(maxRecords) || maxRecords < 1 || maxRecords > ARCADEDB_SERVER_TRAVERSAL_MAX_RECORDS) {
      fail("ArcadeDB server traversal request is invalid.", "INVALID_ARCADEDB_SERVER_TRAVERSAL_REQUEST");
    }
    if (anchorIds.length === 0) return {
      protocolVersion: ARCADEDB_SERVER_TRAVERSAL_VERSION,
      graphSnapshotId,
      anchorIds: [],
      maxDepth,
      maxRecords,
      truncated: false,
      records: [],
    };
    const response = this.invoke("query", {
      command: `SELECT @type AS recordType, nodeJson, edgeJson, $depth AS recordDepth FROM (TRAVERSE bothE('${ARCADEDB_EDGE_TYPE}'), bothV() FROM (SELECT FROM ${ARCADEDB_NODE_TYPE} WHERE projectId = :projectId AND graphSnapshotId = :graphSnapshotId AND nodeId IN :anchorIds) MAXDEPTH ${maxDepth * 2} LIMIT ${maxRecords + 1} STRATEGY BREADTH_FIRST)`,
      params: { projectId, graphSnapshotId, anchorIds },
    });
    const records = responseRecords(response);
    return {
      protocolVersion: ARCADEDB_SERVER_TRAVERSAL_VERSION,
      graphSnapshotId,
      anchorIds: [...anchorIds],
      maxDepth,
      maxRecords,
      truncated: records.length > maxRecords,
      records: records.slice(0, maxRecords),
    };
  }
}

function parseRemoteJson(value, label) {
  if (typeof value !== "string") fail(`${label} is not a JSON string.`, "ARCADEDB_INVALID_RESPONSE");
  try { return JSON.parse(value); }
  catch { fail(`${label} is invalid JSON.`, "ARCADEDB_INVALID_RESPONSE"); }
}

function verifyResumablePartialTopology(remote, graph) {
  if (!remote || remote.topologyJson != null || !Array.isArray(remote.nodeJsons) || !Array.isArray(remote.edgeJsons)) {
    fail("ArcadeDB graph topology partial state is invalid.", "ARCADEDB_GRAPH_TOPOLOGY_CONTENT_MISMATCH");
  }
  const expectedNodes = new Map(graph.nodes.map((node) => [node.nodeId, graphProjectionCanonicalJson(node)]));
  const expectedEdges = new Map(graph.edges.map((edge) => [edge.edgeId, graphProjectionCanonicalJson(edge)]));
  const seenNodes = new Set();
  const seenEdges = new Set();
  for (const value of remote.nodeJsons) {
    const node = parseRemoteJson(value, "ArcadeDB partial graph topology node");
    if (seenNodes.has(node.nodeId) || expectedNodes.get(node.nodeId) !== graphProjectionCanonicalJson(node)) {
      fail("ArcadeDB graph topology contains a conflicting partial node.", "ARCADEDB_GRAPH_TOPOLOGY_CONTENT_MISMATCH");
    }
    seenNodes.add(node.nodeId);
  }
  for (const value of remote.edgeJsons) {
    const edge = parseRemoteJson(value, "ArcadeDB partial graph topology edge");
    if (seenEdges.has(edge.edgeId) || expectedEdges.get(edge.edgeId) !== graphProjectionCanonicalJson(edge)) {
      fail("ArcadeDB graph topology contains a conflicting partial edge.", "ARCADEDB_GRAPH_TOPOLOGY_CONTENT_MISMATCH");
    }
    seenEdges.add(edge.edgeId);
  }
  return true;
}

function unfilteredTraversalRadius(graph, anchorIds, maxDepth) {
  const nodeDepths = new Map(anchorIds.map((nodeId) => [nodeId, 0]));
  const edgeDepths = new Map();
  let frontier = new Set(anchorIds);
  for (let level = 0; level < maxDepth && frontier.size; level += 1) {
    const next = new Set();
    for (const edge of graph.edges) {
      if (!frontier.has(edge.from) && !frontier.has(edge.to)) continue;
      if (!edgeDepths.has(edge.edgeId)) edgeDepths.set(edge.edgeId, (level * 2) + 1);
      for (const nodeId of [edge.from, edge.to]) {
        if (nodeDepths.has(nodeId)) continue;
        nodeDepths.set(nodeId, (level + 1) * 2);
        next.add(nodeId);
      }
    }
    frontier = next;
  }
  return { nodeDepths, edgeDepths };
}

function traversalOptionsFromQuery(query) {
  return {
    query: query.normalizedQuery,
    kinds: [...query.allowedKinds],
    relations: [...query.allowedRelations],
    authorityClasses: [...query.allowedAuthorityClasses],
    freshness: [...query.allowedFreshness],
    minConfidence: query.minConfidence,
    includeUnreviewedCandidates: query.includeUnreviewedCandidates,
    depth: query.maxDepth,
    maxNodes: query.maxNodes,
    maxEdges: query.maxEdges,
  };
}

function preparedExpansion(graph, query) {
  const radius = unfilteredTraversalRadius(graph, query.anchorIds, query.maxDepth);
  const nodesById = new Map(graph.nodes.map((node) => [node.nodeId, node]));
  const edgesById = new Map(graph.edges.map((edge) => [edge.edgeId, edge]));
  const nodes = [...radius.nodeDepths.entries()].map(([nodeId, recordDepth]) => ({
    nodeId,
    recordDepth,
    nodeJson: graphProjectionCanonicalJson(nodesById.get(nodeId)),
  })).sort((left, right) => left.recordDepth - right.recordDepth || left.nodeId.localeCompare(right.nodeId));
  const edges = [...radius.edgeDepths.entries()].map(([edgeId, recordDepth]) => ({
    edgeId,
    recordDepth,
    edgeJson: graphProjectionCanonicalJson(edgesById.get(edgeId)),
  })).sort((left, right) => left.recordDepth - right.recordDepth || left.edgeId.localeCompare(right.edgeId));
  return {
    ordering: PREPARED_TRAVERSAL_ORDERING,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    recordCount: nodes.length + edges.length,
    nodes,
    edges,
  };
}

function preparedGraphManifest(graph) {
  const payload = {
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    nodeSetHash: digest(graphProjectionCanonicalJson(graph.nodes)),
    edgeSetHash: digest(graphProjectionCanonicalJson(graph.edges)),
  };
  return { ...payload, graphManifestHash: digest(graphProjectionCanonicalJson(payload)) };
}

export function buildPreparedTraversalRequest({ graph, result } = {}) {
  verifyTemporalProvenanceGraph(graph);
  if (!result || result.kind !== "TemporalTraversalResult" || !result.traversalQuery) {
    fail("Prepared traversal requires a deterministic TemporalTraversalResult.", "INVALID_PREPARED_TRAVERSAL_REQUEST");
  }
  const recomputed = queryTemporalProvenanceGraph(graph, traversalOptionsFromQuery(result.traversalQuery));
  if (graphProjectionCanonicalJson(recomputed) !== graphProjectionCanonicalJson(result)) {
    fail("Prepared traversal result differs from the deterministic GraphSnapshot result.", "PREPARED_TRAVERSAL_RESULT_MISMATCH");
  }
  const expansion = preparedExpansion(graph, result.traversalQuery);
  const expansionHash = digest(graphProjectionCanonicalJson(expansion));
  const payload = {
    schemaVersion: 1,
    kind: "PreparedTraversalRequest",
    protocol: { name: "head-agent-core-prepared-traversal", version: PREPARED_TRAVERSAL_VERSION },
    projectId: graph.projectId,
    graphSnapshotId: graph.graphSnapshotId,
    graphSnapshotHash: graph.graphSnapshotHash,
    sourceSnapshotId: graph.sourceSnapshotId,
    traversalQuery: clone(result.traversalQuery),
    queryId: result.queryId,
    queryHash: result.queryHash,
    resultId: result.resultId,
    resultHash: result.resultHash,
    graphManifest: preparedGraphManifest(graph),
    expansion,
    expansionHash,
    authority: "derived-verification-evidence-only",
    instructionAuthority: false,
    promotionAuthority: false,
  };
  const requestHash = digest(graphProjectionCanonicalJson(payload));
  return verifyPreparedTraversalRequest({ ...payload, requestId: `prepared-traversal-${requestHash.slice(0, 24)}`, requestHash });
}

export function verifyPreparedTraversalRequest(document, { graph = null, result = null } = {}) {
  assertFields(document, [
    "schemaVersion", "kind", "protocol", "projectId", "graphSnapshotId", "graphSnapshotHash", "sourceSnapshotId",
    "traversalQuery", "queryId", "queryHash", "resultId", "resultHash", "graphManifest", "expansion", "expansionHash", "authority",
    "instructionAuthority", "promotionAuthority", "requestId", "requestHash",
  ], "Prepared traversal request", "INVALID_PREPARED_TRAVERSAL_REQUEST");
  const query = document?.traversalQuery;
  if (query && typeof query === "object" && !Array.isArray(query)) assertFields(query, [
    "normalizedQuery", "anchorIds", "allowedKinds", "allowedRelations", "allowedAuthorityClasses", "allowedFreshness",
    "minConfidence", "includeUnreviewedCandidates", "maxDepth", "maxNodes", "maxEdges", "ordering",
  ], "Prepared traversal query", "INVALID_PREPARED_TRAVERSAL_REQUEST");
  const expansion = document?.expansion;
  const graphManifest = document?.graphManifest;
  if (graphManifest && typeof graphManifest === "object" && !Array.isArray(graphManifest)) assertFields(graphManifest, [
    "nodeCount", "edgeCount", "nodeSetHash", "edgeSetHash", "graphManifestHash",
  ], "Prepared traversal graph manifest", "INVALID_PREPARED_TRAVERSAL_REQUEST");
  if (expansion && typeof expansion === "object" && !Array.isArray(expansion)) assertFields(expansion, [
    "ordering", "nodeCount", "edgeCount", "recordCount", "nodes", "edges",
  ], "Prepared traversal expansion", "INVALID_PREPARED_TRAVERSAL_REQUEST");
  if (!document || document.kind !== "PreparedTraversalRequest" || document.schemaVersion !== 1
    || document.protocol?.name !== "head-agent-core-prepared-traversal" || document.protocol?.version !== PREPARED_TRAVERSAL_VERSION
    || typeof document.projectId !== "string" || !document.projectId
    || !/^graph-snapshot-[a-f0-9]{24}$/.test(document.graphSnapshotId || "")
    || !/^[a-f0-9]{64}$/.test(document.graphSnapshotHash || "")
    || !/^source-snapshot-[a-f0-9]{24}$/.test(document.sourceSnapshotId || "")
    || !query || typeof query.normalizedQuery !== "string" || !query.normalizedQuery
    || !Array.isArray(query.anchorIds) || query.anchorIds.length > 500
    || query.anchorIds.some((nodeId) => typeof nodeId !== "string" || !nodeId)
    || !Array.isArray(query.allowedKinds) || !Array.isArray(query.allowedRelations)
    || !Array.isArray(query.allowedAuthorityClasses) || !Array.isArray(query.allowedFreshness)
    || !Number.isFinite(query.minConfidence) || query.minConfidence < 0 || query.minConfidence > 1
    || typeof query.includeUnreviewedCandidates !== "boolean"
    || !Number.isInteger(query.maxDepth) || query.maxDepth < 0 || query.maxDepth > 3
    || !Number.isInteger(query.maxNodes) || query.maxNodes < 1 || query.maxNodes > 500
    || !Number.isInteger(query.maxEdges) || query.maxEdges < 0 || query.maxEdges > 1000
    || query.ordering !== "nodeId-then-edgeId-ascending"
    || !/^traversal-query-[a-f0-9]{24}$/.test(document.queryId || "") || !/^[a-f0-9]{64}$/.test(document.queryHash || "")
    || !/^traversal-result-[a-f0-9]{24}$/.test(document.resultId || "") || !/^[a-f0-9]{64}$/.test(document.resultHash || "")
    || !graphManifest || !Number.isInteger(graphManifest.nodeCount) || graphManifest.nodeCount < 0
    || !Number.isInteger(graphManifest.edgeCount) || graphManifest.edgeCount < 0
    || !/^[a-f0-9]{64}$/.test(graphManifest.nodeSetHash || "")
    || !/^[a-f0-9]{64}$/.test(graphManifest.edgeSetHash || "")
    || !/^[a-f0-9]{64}$/.test(graphManifest.graphManifestHash || "")
    || !expansion || expansion.ordering !== PREPARED_TRAVERSAL_ORDERING
    || !Number.isInteger(expansion.nodeCount) || expansion.nodeCount < 0
    || !Number.isInteger(expansion.edgeCount) || expansion.edgeCount < 0
    || !Number.isInteger(expansion.recordCount) || expansion.recordCount < 0
    || !Array.isArray(expansion.nodes) || !Array.isArray(expansion.edges)
    || expansion.nodeCount !== expansion.nodes.length || expansion.edgeCount !== expansion.edges.length
    || expansion.recordCount !== expansion.nodes.length + expansion.edges.length
    || expansion.nodeCount > graphManifest.nodeCount || expansion.edgeCount > graphManifest.edgeCount
    || !/^[a-f0-9]{64}$/.test(document.expansionHash || "")
    || document.authority !== "derived-verification-evidence-only"
    || document.instructionAuthority !== false || document.promotionAuthority !== false
    || !/^prepared-traversal-[a-f0-9]{24}$/.test(document.requestId || "")
    || !/^[a-f0-9]{64}$/.test(document.requestHash || "")) {
    fail("Prepared traversal request is invalid.", "INVALID_PREPARED_TRAVERSAL_REQUEST");
  }
  const queryHash = digest(graphProjectionCanonicalJson(query));
  if (document.queryHash !== queryHash || document.queryId !== `traversal-query-${queryHash.slice(0, 24)}`) {
    fail("Prepared traversal query digest verification failed.", "PREPARED_TRAVERSAL_QUERY_DIGEST_MISMATCH");
  }
  const nodeIds = new Set();
  for (const record of expansion.nodes) {
    assertFields(record, ["nodeId", "recordDepth", "nodeJson"], "Prepared traversal node", "INVALID_PREPARED_TRAVERSAL_REQUEST");
    let node;
    try { node = JSON.parse(record.nodeJson); } catch { fail("Prepared traversal node JSON is invalid.", "INVALID_PREPARED_TRAVERSAL_REQUEST"); }
    if (!node || typeof node !== "object" || Array.isArray(node) || node.nodeId !== record.nodeId
      || nodeIds.has(record.nodeId) || record.nodeJson !== graphProjectionCanonicalJson(node)
      || !Number.isInteger(record.recordDepth) || record.recordDepth < 0 || record.recordDepth > query.maxDepth * 2
      || record.recordDepth % 2 !== 0) {
      fail("Prepared traversal node is invalid, duplicated, or out of bounds.", "INVALID_PREPARED_TRAVERSAL_REQUEST");
    }
    nodeIds.add(record.nodeId);
  }
  const edgeIds = new Set();
  for (const record of expansion.edges) {
    assertFields(record, ["edgeId", "recordDepth", "edgeJson"], "Prepared traversal edge", "INVALID_PREPARED_TRAVERSAL_REQUEST");
    let edge;
    try { edge = JSON.parse(record.edgeJson); } catch { fail("Prepared traversal edge JSON is invalid.", "INVALID_PREPARED_TRAVERSAL_REQUEST"); }
    if (!edge || typeof edge !== "object" || Array.isArray(edge) || edge.edgeId !== record.edgeId
      || edgeIds.has(record.edgeId) || record.edgeJson !== graphProjectionCanonicalJson(edge)
      || !Number.isInteger(record.recordDepth) || record.recordDepth < 1 || record.recordDepth > query.maxDepth * 2
      || record.recordDepth % 2 !== 1) {
      fail("Prepared traversal edge is invalid, duplicated, or out of bounds.", "INVALID_PREPARED_TRAVERSAL_REQUEST");
    }
    edgeIds.add(record.edgeId);
  }
  const canonicalNodes = [...expansion.nodes].sort((left, right) => left.recordDepth - right.recordDepth || left.nodeId.localeCompare(right.nodeId));
  const canonicalEdges = [...expansion.edges].sort((left, right) => left.recordDepth - right.recordDepth || left.edgeId.localeCompare(right.edgeId));
  const rootIds = expansion.nodes.filter((record) => record.recordDepth === 0).map((record) => record.nodeId).sort();
  if (graphProjectionCanonicalJson(expansion.nodes) !== graphProjectionCanonicalJson(canonicalNodes)
    || graphProjectionCanonicalJson(expansion.edges) !== graphProjectionCanonicalJson(canonicalEdges)
    || graphProjectionCanonicalJson(rootIds) !== graphProjectionCanonicalJson([...query.anchorIds].sort())) {
    fail("Prepared traversal expansion ordering or anchors are invalid.", "INVALID_PREPARED_TRAVERSAL_REQUEST");
  }
  if (document.expansionHash !== digest(graphProjectionCanonicalJson(expansion))) {
    fail("Prepared traversal expansion digest verification failed.", "PREPARED_TRAVERSAL_EXPANSION_DIGEST_MISMATCH");
  }
  const graphManifestPayload = { ...graphManifest };
  delete graphManifestPayload.graphManifestHash;
  if (graphManifest.graphManifestHash !== digest(graphProjectionCanonicalJson(graphManifestPayload))) {
    fail("Prepared traversal graph manifest digest verification failed.", "PREPARED_TRAVERSAL_GRAPH_MANIFEST_DIGEST_MISMATCH");
  }
  const payload = { ...document };
  delete payload.requestId;
  delete payload.requestHash;
  const requestHash = digest(graphProjectionCanonicalJson(payload));
  if (document.requestHash !== requestHash || document.requestId !== `prepared-traversal-${requestHash.slice(0, 24)}`) {
    fail("Prepared traversal request digest verification failed.", "PREPARED_TRAVERSAL_DIGEST_MISMATCH");
  }
  if (graph || result) {
    if (!graph || !result) fail("Prepared traversal expected graph and result must be supplied together.", "INVALID_PREPARED_TRAVERSAL_EXPECTATION");
    const expected = buildPreparedTraversalRequest({ graph, result });
    if (graphProjectionCanonicalJson(document) !== graphProjectionCanonicalJson(expected)) {
      fail("Prepared traversal request differs from the deterministic expected request.", "PREPARED_TRAVERSAL_REQUEST_MISMATCH");
    }
  }
  return document;
}

function buildPreparedTraversalVerification(request, verificationMode) {
  const prepared = verifyPreparedTraversalRequest(request);
  if (typeof verificationMode !== "string" || !/^[a-z0-9-]+$/.test(verificationMode)) {
    fail("Prepared traversal verification mode is invalid.", "INVALID_PREPARED_TRAVERSAL_VERIFICATION");
  }
  const payload = {
    schemaVersion: 1,
    kind: "PreparedTraversalVerification",
    protocol: { name: "head-agent-core-prepared-traversal", version: PREPARED_TRAVERSAL_VERSION },
    requestId: prepared.requestId,
    requestHash: prepared.requestHash,
    graphSnapshotId: prepared.graphSnapshotId,
    graphSnapshotHash: prepared.graphSnapshotHash,
    queryId: prepared.queryId,
    queryHash: prepared.queryHash,
    resultId: prepared.resultId,
    resultHash: prepared.resultHash,
    expansionHash: prepared.expansionHash,
    nodeCount: prepared.expansion.nodeCount,
    edgeCount: prepared.expansion.edgeCount,
    verificationMode,
    authority: "derived-verification-evidence-only",
    instructionAuthority: false,
    promotionAuthority: false,
  };
  const verificationHash = digest(graphProjectionCanonicalJson(payload));
  return verifyPreparedTraversalVerification({
    ...payload,
    verificationId: `prepared-traversal-verification-${verificationHash.slice(0, 24)}`,
    verificationHash,
  });
}

export function verifyPreparedTraversalVerification(document, expectedRequest = null) {
  assertFields(document, [
    "schemaVersion", "kind", "protocol", "requestId", "requestHash", "graphSnapshotId", "graphSnapshotHash",
    "queryId", "queryHash", "resultId", "resultHash", "expansionHash", "nodeCount", "edgeCount", "verificationMode",
    "authority", "instructionAuthority", "promotionAuthority", "verificationId", "verificationHash",
  ], "Prepared traversal verification", "INVALID_PREPARED_TRAVERSAL_VERIFICATION");
  if (!document || document.kind !== "PreparedTraversalVerification" || document.schemaVersion !== 1
    || document.protocol?.name !== "head-agent-core-prepared-traversal" || document.protocol?.version !== PREPARED_TRAVERSAL_VERSION
    || !/^prepared-traversal-[a-f0-9]{24}$/.test(document.requestId || "") || !/^[a-f0-9]{64}$/.test(document.requestHash || "")
    || !/^graph-snapshot-[a-f0-9]{24}$/.test(document.graphSnapshotId || "") || !/^[a-f0-9]{64}$/.test(document.graphSnapshotHash || "")
    || !/^traversal-query-[a-f0-9]{24}$/.test(document.queryId || "") || !/^[a-f0-9]{64}$/.test(document.queryHash || "")
    || !/^traversal-result-[a-f0-9]{24}$/.test(document.resultId || "") || !/^[a-f0-9]{64}$/.test(document.resultHash || "")
    || !/^[a-f0-9]{64}$/.test(document.expansionHash || "")
    || !Number.isInteger(document.nodeCount) || document.nodeCount < 0
    || !Number.isInteger(document.edgeCount) || document.edgeCount < 0
    || typeof document.verificationMode !== "string" || !/^[a-z0-9-]+$/.test(document.verificationMode)
    || document.authority !== "derived-verification-evidence-only"
    || document.instructionAuthority !== false || document.promotionAuthority !== false
    || !/^prepared-traversal-verification-[a-f0-9]{24}$/.test(document.verificationId || "")
    || !/^[a-f0-9]{64}$/.test(document.verificationHash || "")) {
    fail("Prepared traversal verification is invalid.", "INVALID_PREPARED_TRAVERSAL_VERIFICATION");
  }
  const payload = { ...document };
  delete payload.verificationId;
  delete payload.verificationHash;
  const verificationHash = digest(graphProjectionCanonicalJson(payload));
  if (document.verificationHash !== verificationHash
    || document.verificationId !== `prepared-traversal-verification-${verificationHash.slice(0, 24)}`) {
    fail("Prepared traversal verification digest verification failed.", "PREPARED_TRAVERSAL_VERIFICATION_DIGEST_MISMATCH");
  }
  if (expectedRequest) {
    const request = verifyPreparedTraversalRequest(expectedRequest);
    const expected = buildPreparedTraversalVerification(request, document.verificationMode);
    if (graphProjectionCanonicalJson(document) !== graphProjectionCanonicalJson(expected)) {
      fail("Prepared traversal verification does not match its request.", "PREPARED_TRAVERSAL_VERIFICATION_MISMATCH");
    }
  }
  return document;
}

function verifyArcadeDbServerTraversalResponse({ request, response, maxRecords }) {
  const prepared = verifyPreparedTraversalRequest(request);
  const query = prepared.traversalQuery;
  assertFields(response, [
    "protocolVersion", "graphSnapshotId", "anchorIds", "maxDepth", "maxRecords", "truncated", "records",
  ], "ArcadeDB server traversal response", "ARCADEDB_SERVER_TRAVERSAL_RESPONSE_MISMATCH");
  if (response.protocolVersion !== ARCADEDB_SERVER_TRAVERSAL_VERSION
    || response.graphSnapshotId !== prepared.graphSnapshotId
    || graphProjectionCanonicalJson(response.anchorIds) !== graphProjectionCanonicalJson(query.anchorIds)
    || response.maxDepth !== query.maxDepth || response.maxRecords !== maxRecords
    || typeof response.truncated !== "boolean" || !Array.isArray(response.records)
    || response.records.length > maxRecords) {
    fail("ArcadeDB server traversal response envelope is invalid or stale.", "ARCADEDB_SERVER_TRAVERSAL_RESPONSE_MISMATCH");
  }
  if (response.truncated) {
    fail("ArcadeDB server traversal exceeded its bounded response budget.", "ARCADEDB_SERVER_TRAVERSAL_TRUNCATED");
  }

  const expectedNodes = new Map(prepared.expansion.nodes.map((record) => [record.nodeId, record]));
  const expectedEdges = new Map(prepared.expansion.edges.map((record) => [record.edgeId, record]));
  const returnedNodes = new Set();
  const returnedEdges = new Set();
  for (const record of response.records) {
    if (!record || typeof record !== "object" || Array.isArray(record)
      || !Number.isInteger(record.recordDepth) || record.recordDepth < 0 || record.recordDepth > query.maxDepth * 2) {
      fail("ArcadeDB server traversal returned an invalid record envelope.", "ARCADEDB_SERVER_TRAVERSAL_RESPONSE_MISMATCH");
    }
    if (record.recordType === ARCADEDB_NODE_TYPE && typeof record.nodeJson === "string" && record.edgeJson == null) {
      const node = parseRemoteJson(record.nodeJson, "ArcadeDB server traversal node");
      const expected = expectedNodes.get(node.nodeId);
      if (!expected || returnedNodes.has(node.nodeId)
        || graphProjectionCanonicalJson(node) !== expected.nodeJson
        || expected.recordDepth !== record.recordDepth) {
        fail("ArcadeDB server traversal returned a duplicate, forged, or out-of-radius node.", "ARCADEDB_SERVER_TRAVERSAL_RESPONSE_MISMATCH");
      }
      returnedNodes.add(node.nodeId);
      continue;
    }
    if (record.recordType === ARCADEDB_EDGE_TYPE && typeof record.edgeJson === "string" && record.nodeJson == null) {
      const edge = parseRemoteJson(record.edgeJson, "ArcadeDB server traversal edge");
      const expected = expectedEdges.get(edge.edgeId);
      if (!expected || returnedEdges.has(edge.edgeId)
        || graphProjectionCanonicalJson(edge) !== expected.edgeJson
        || expected.recordDepth !== record.recordDepth) {
        fail("ArcadeDB server traversal returned a duplicate, forged, or out-of-radius edge.", "ARCADEDB_SERVER_TRAVERSAL_RESPONSE_MISMATCH");
      }
      returnedEdges.add(edge.edgeId);
      continue;
    }
    fail("ArcadeDB server traversal returned an unknown record type.", "ARCADEDB_SERVER_TRAVERSAL_RESPONSE_MISMATCH");
  }

  if (returnedNodes.size !== expectedNodes.size || returnedEdges.size !== expectedEdges.size
    || [...expectedNodes.keys()].some((nodeId) => !returnedNodes.has(nodeId))
    || [...expectedEdges.keys()].some((edgeId) => !returnedEdges.has(edgeId))) {
    fail("ArcadeDB server traversal did not return the complete bounded graph radius.", "ARCADEDB_SERVER_TRAVERSAL_COVERAGE_MISMATCH");
  }
  return true;
}

export class ArcadeDbGraphProjectionAdapter {
  constructor({
    storageSelection,
    transport = null,
    topologyRequired = false,
    serverTraversalRequired = false,
    preparedTraversalRequired = false,
  } = {}) {
    this.storageSelection = verifyStorageSelection(storageSelection);
    if (this.storageSelection.mode !== "graphdb") fail("ArcadeDB adapter requires a GraphDB storage selection.", "ARCADEDB_SELECTION_REQUIRED");
    this.projectId = this.storageSelection.projectId;
    this.transport = assertArcadeDbTransport(transport || new ArcadeDbHttpTransport({ storageSelection: this.storageSelection }));
    this.adapterVersion = GRAPH_PROJECTION_ADAPTER_VERSION;
    const endpoint = new URL(this.storageSelection.graphdb.endpoint);
    this.locationBase = `arcadedb://${endpoint.host}/${encodeURIComponent(this.storageSelection.graphdb.database)}/head-agent/${encodeURIComponent(this.projectId)}`;
    this.schemaReady = false;
    this.topologySchemaReady = false;
    this.preparedTraversalRequired = preparedTraversalRequired === true;
    this.serverTraversalRequired = serverTraversalRequired === true || this.preparedTraversalRequired;
    this.topologyRequired = topologyRequired === true || this.serverTraversalRequired;
    if (this.serverTraversalRequired) assertArcadeDbServerTraversalTransport(this.transport);
    if (this.preparedTraversalRequired) assertArcadeDbPreparedTraversalTransport(this.transport);
  }

  describe() {
    return {
      ...descriptor("arcadedb-http", { remote: true, durable: true }),
      remoteProtocol: this.transport.describe().protocol,
      remoteProtocolVersion: ARCADEDB_GRAPH_PROJECTION_VERSION,
      credentialsPersisted: false,
      serverRecordIdentitySemantic: false,
      topologyMode: this.topologyRequired ? "snapshot-scoped-vertex-edge-verified" : "not-required",
      traversalMode: this.serverTraversalRequired
        ? ARCADEDB_SERVER_TRAVERSAL_MODE
        : this.topologyRequired ? "verified-topology-client-reference" : "verified-snapshot-client-reference",
      ...(this.serverTraversalRequired ? {
        serverTraversalProtocolVersion: ARCADEDB_SERVER_TRAVERSAL_VERSION,
      } : {}),
      ...(this.preparedTraversalRequired ? {
        preparedTraversalProtocolVersion: PREPARED_TRAVERSAL_VERSION,
        preparedTraversalMode: "manifest-and-bounded-records",
      } : {}),
    };
  }

  ensureSchema() {
    if (!this.schemaReady) {
      this.transport.ensureSchema();
      this.schemaReady = true;
    }
  }

  ensureTopologySchema() {
    if (!this.topologySchemaReady) {
      assertArcadeDbTopologyTransport(this.transport).ensureTopologySchema();
      this.topologySchemaReady = true;
    }
  }

  readPointer() {
    const value = this.transport.readPointer(this.projectId);
    return value == null ? null : { location: `${this.locationBase}/current`, document: parseRemoteJson(value, "ArcadeDB graph projection pointer") };
  }

  readSnapshot(id) {
    graphSnapshotId(id);
    const value = this.transport.readSnapshot(this.projectId, id);
    if (value == null) return null;
    const document = parseRemoteJson(value, "ArcadeDB graph projection snapshot");
    if (this.topologyRequired) this.readTopology(document);
    return { location: `${this.locationBase}/snapshots/${id}`, document };
  }

  writeSnapshot(id, document) {
    graphSnapshotId(id);
    this.ensureSchema();
    if (this.topologyRequired) this.materializeTopology(document);
    const created = this.transport.writeSnapshot(this.projectId, id, graphProjectionCanonicalJson(document), {
      graphSnapshotHash: document.graphSnapshotHash,
      sourceSnapshotId: document.sourceSnapshotId,
    });
    const entry = this.readSnapshot(id);
    if (!entry) fail("ArcadeDB did not return the written GraphSnapshot.", "GRAPH_PROJECTION_WRITE_MISMATCH");
    return { ...entry, created };
  }

  writePointer(document) {
    this.ensureSchema();
    this.transport.writePointer(this.projectId, graphProjectionCanonicalJson(document));
    const entry = this.readPointer();
    if (!entry) fail("ArcadeDB did not return the written graph pointer.", "GRAPH_PROJECTION_WRITE_MISMATCH");
    return entry;
  }

  listSnapshotIds() {
    return this.transport.listSnapshotIds(this.projectId).map(graphSnapshotId).sort();
  }

  materializeTopology(graph) {
    verifyTemporalProvenanceGraph(graph);
    this.ensureTopologySchema();
    const transport = assertArcadeDbTopologyTransport(this.transport);
    const topology = buildArcadeDbGraphTopology(graph);
    const existing = transport.readTopology(this.projectId, graph.graphSnapshotId);
    if (existing?.topologyJson != null) return this.readTopology(graph).topology;
    if (existing) verifyResumablePartialTopology(existing, graph);
    transport.writeTopology(this.projectId, graph.graphSnapshotId, clone(graph), clone(topology));
    return this.readTopology(graph).topology;
  }

  readTopology(graph) {
    verifyTemporalProvenanceGraph(graph);
    const remote = assertArcadeDbTopologyTransport(this.transport).readTopology(this.projectId, graph.graphSnapshotId);
    if (!remote) fail("ArcadeDB graph topology is missing.", "ARCADEDB_GRAPH_TOPOLOGY_MISSING");
    if (typeof remote.topologyJson !== "string" || !Array.isArray(remote.nodeJsons) || !Array.isArray(remote.edgeJsons)) {
      if (Array.isArray(remote.nodeJsons) || Array.isArray(remote.edgeJsons)) {
        fail("ArcadeDB graph topology is partial.", "ARCADEDB_GRAPH_TOPOLOGY_CONTENT_MISMATCH");
      }
      fail("ArcadeDB graph topology record envelope is invalid.", "ARCADEDB_INVALID_RESPONSE");
    }
    const topology = verifyArcadeDbGraphTopology(parseRemoteJson(remote.topologyJson, "ArcadeDB graph topology"), graph);
    const nodes = remote.nodeJsons.map((value) => parseRemoteJson(value, "ArcadeDB graph topology node"))
      .sort((left, right) => String(left.nodeId).localeCompare(String(right.nodeId)));
    const edges = remote.edgeJsons.map((value) => parseRemoteJson(value, "ArcadeDB graph topology edge"))
      .sort((left, right) => String(left.edgeId).localeCompare(String(right.edgeId)));
    if (nodes.length !== topology.nodeCount || edges.length !== topology.edgeCount
      || digest(graphProjectionCanonicalJson(nodes)) !== topology.nodeSetHash
      || digest(graphProjectionCanonicalJson(edges)) !== topology.edgeSetHash
      || graphProjectionCanonicalJson(nodes) !== graphProjectionCanonicalJson(graph.nodes)
      || graphProjectionCanonicalJson(edges) !== graphProjectionCanonicalJson(graph.edges)) {
      fail("ArcadeDB graph topology is partial, conflicting, or divergent.", "ARCADEDB_GRAPH_TOPOLOGY_CONTENT_MISMATCH");
    }
    return { topology, nodes, edges, location: `${this.locationBase}/topologies/${graph.graphSnapshotId}` };
  }

  query(id, options) {
    const entry = this.readSnapshot(id);
    if (!entry) fail(`Graph projection snapshot is missing: ${id}`, "GRAPH_PROJECTION_SNAPSHOT_MISSING");
    const reference = queryTemporalProvenanceGraph(entry.document, options);
    if (!this.serverTraversalRequired || reference.traversalQuery.anchorIds.length === 0) return reference;
    const request = buildPreparedTraversalRequest({ graph: entry.document, result: reference });
    if (request.expansion.recordCount > ARCADEDB_SERVER_TRAVERSAL_MAX_RECORDS) {
      fail("ArcadeDB server traversal expansion exceeds the record budget.", "ARCADEDB_SERVER_TRAVERSAL_RECORD_LIMIT");
    }
    const maxRecords = Math.max(1, request.expansion.recordCount);
    const response = assertArcadeDbServerTraversalTransport(this.transport).queryTopology(
      this.projectId,
      entry.document.graphSnapshotId,
      {
        anchorIds: [...reference.traversalQuery.anchorIds],
        maxDepth: reference.traversalQuery.maxDepth,
        maxRecords,
      },
    );
    verifyArcadeDbServerTraversalResponse({ request, response, maxRecords });
    return reference;
  }

  queryPrepared(request) {
    if (!this.preparedTraversalRequired) {
      fail("ArcadeDB prepared traversal is not active for this adapter.", "PREPARED_TRAVERSAL_NOT_ACTIVE");
    }
    const prepared = verifyPreparedTraversalRequest(request);
    if (prepared.projectId !== this.projectId) {
      fail("Prepared traversal project does not match the ArcadeDB adapter.", "PREPARED_TRAVERSAL_PROJECT_MISMATCH");
    }
    if (prepared.expansion.recordCount > ARCADEDB_SERVER_TRAVERSAL_MAX_RECORDS) {
      fail("ArcadeDB prepared traversal expansion exceeds the record budget.", "ARCADEDB_SERVER_TRAVERSAL_RECORD_LIMIT");
    }
    const pointerEntry = this.readPointer();
    if (!pointerEntry) fail("ArcadeDB graph projection pointer is missing.", "GRAPH_PROJECTION_SNAPSHOT_MISSING");
    verifyGraphProjectionPointer(pointerEntry.document, prepared);
    const transport = assertArcadeDbPreparedTraversalTransport(this.transport);
    const topologyJson = transport.readTopologyManifest(this.projectId, prepared.graphSnapshotId);
    if (typeof topologyJson !== "string") fail("ArcadeDB graph topology manifest is missing.", "ARCADEDB_GRAPH_TOPOLOGY_MISSING");
    const topology = verifyArcadeDbGraphTopology(parseRemoteJson(topologyJson, "ArcadeDB graph topology manifest"));
    const graphManifest = prepared.graphManifest;
    if (topology.projectId !== prepared.projectId || topology.graphSnapshotId !== prepared.graphSnapshotId
      || topology.graphSnapshotHash !== prepared.graphSnapshotHash || topology.sourceSnapshotId !== prepared.sourceSnapshotId
      || topology.nodeCount !== graphManifest.nodeCount || topology.edgeCount !== graphManifest.edgeCount
      || topology.nodeSetHash !== graphManifest.nodeSetHash || topology.edgeSetHash !== graphManifest.edgeSetHash) {
      fail("ArcadeDB graph topology manifest is stale or cannot cover the prepared traversal.", "ARCADEDB_GRAPH_TOPOLOGY_MISMATCH");
    }
    if (prepared.traversalQuery.anchorIds.length > 0) {
      const maxRecords = Math.max(1, prepared.expansion.recordCount);
      const response = transport.queryTopology(this.projectId, prepared.graphSnapshotId, {
        anchorIds: [...prepared.traversalQuery.anchorIds],
        maxDepth: prepared.traversalQuery.maxDepth,
        maxRecords,
      });
      verifyArcadeDbServerTraversalResponse({ request: prepared, response, maxRecords });
    }
    return buildPreparedTraversalVerification(prepared, "arcadedb-manifest-bounded-expansion");
  }
}

const FALLBACK_CODES = new Set(["ARCADEDB_TRANSPORT_UNAVAILABLE", "ARCADEDB_CREDENTIALS_UNAVAILABLE"]);

export class ActivatedArcadeDbGraphProjectionAdapter {
  constructor({ projectRoot, storageSelection, remoteAdapter = null, transport = null } = {}) {
    this.adapterVersion = GRAPH_PROJECTION_ADAPTER_VERSION;
    this.projectRoot = path.resolve(projectRoot || ".");
    this.local = new LocalJsonGraphProjectionAdapter({ projectRoot });
    this.remote = remoteAdapter || new ArcadeDbGraphProjectionAdapter({ storageSelection, transport });
    this.fallbackUsed = false;
    this.fallbackReasonCode = "";
    this.remoteObserved = false;
    this.remoteMutated = false;
    this.pendingTopologyActivation = null;
  }

  describe() {
    const remoteDescriptor = this.remote.describe();
    return {
      ...descriptor("activated-arcadedb-with-local-mirror", { remote: true, durable: true }),
      credentialsPersisted: false,
      localMirror: true,
      fallbackPolicy: "unavailable-before-remote-observation-only",
      topologyMode: remoteDescriptor.topologyMode,
      traversalMode: remoteDescriptor.traversalMode,
      ...(remoteDescriptor.serverTraversalProtocolVersion
        ? { serverTraversalProtocolVersion: remoteDescriptor.serverTraversalProtocolVersion }
        : {}),
      ...(remoteDescriptor.preparedTraversalProtocolVersion ? {
        preparedTraversalProtocolVersion: remoteDescriptor.preparedTraversalProtocolVersion,
        preparedTraversalMode: remoteDescriptor.preparedTraversalMode,
      } : {}),
    };
  }

  diagnostics() {
    return { fallbackUsed: this.fallbackUsed, fallbackReasonCode: this.fallbackReasonCode };
  }

  callRemote(operation, fallback) {
    if (this.fallbackUsed) return fallback();
    try { return operation(); }
    catch (error) {
      if (!FALLBACK_CODES.has(error.code) || this.remoteObserved || this.remoteMutated) throw error;
      this.fallbackUsed = true;
      this.fallbackReasonCode = error.code;
      return fallback();
    }
  }

  readPointer() {
    const entry = this.callRemote(() => this.remote.readPointer(), () => this.local.readPointer());
    if (!this.fallbackUsed && entry) this.remoteObserved = true;
    return entry;
  }

  readSnapshot(id) {
    const entry = this.callRemote(() => this.remote.readSnapshot(id), () => this.local.readSnapshot(id));
    if (!this.fallbackUsed && entry) this.remoteObserved = true;
    return entry;
  }

  writeSnapshot(id, document) {
    const entry = this.callRemote(() => {
      this.remoteMutated = true;
      const remoteEntry = this.remote.writeSnapshot(id, document);
      const localEntry = this.local.writeSnapshot(id, document);
      if (graphProjectionCanonicalJson(localEntry.document) !== graphProjectionCanonicalJson(remoteEntry.document)) {
        fail("ArcadeDB and local mirror snapshots differ.", "GRAPH_PROJECTION_SNAPSHOT_CONFLICT");
      }
      if (this.remote.topologyRequired) {
        const topology = this.remote.readTopology(document).topology;
        this.pendingTopologyActivation = buildArcadeDbGraphTopologyActivation({
          storageSelection: this.remote.storageSelection,
          graph: document,
          topology,
        });
      }
      return remoteEntry;
    }, () => this.local.writeSnapshot(id, document));
    return entry;
  }

  writePointer(document) {
    return this.callRemote(() => {
      this.remoteMutated = true;
      const remoteEntry = this.remote.writePointer(document);
      const localEntry = this.local.writePointer(document);
      if (graphProjectionCanonicalJson(localEntry.document) !== graphProjectionCanonicalJson(remoteEntry.document)) {
        fail("ArcadeDB and local mirror pointers differ.", "GRAPH_PROJECTION_WRITE_MISMATCH");
      }
      if (this.pendingTopologyActivation) {
        if (this.pendingTopologyActivation.graphSnapshotId !== document.graphSnapshotId
          || this.pendingTopologyActivation.graphSnapshotHash !== document.graphSnapshotHash) {
          fail("ArcadeDB topology activation does not match the advancing graph pointer.", "ARCADEDB_TOPOLOGY_ACTIVATION_STALE");
        }
        persistArcadeDbGraphTopologyActivation({ projectRoot: this.projectRoot, activation: this.pendingTopologyActivation });
        this.pendingTopologyActivation = null;
      }
      return remoteEntry;
    }, () => this.local.writePointer(document));
  }

  listSnapshotIds() {
    return this.callRemote(() => {
      const remoteIds = this.remote.listSnapshotIds();
      if (remoteIds.length) this.remoteObserved = true;
      return [...new Set([...remoteIds, ...this.local.listSnapshotIds()])].sort();
    }, () => this.local.listSnapshotIds());
  }

  query(id, options) {
    const result = this.callRemote(() => this.remote.query(id, options), () => this.local.query(id, options));
    if (!this.fallbackUsed) this.remoteObserved = true;
    return result;
  }

  queryPrepared(request) {
    const verification = this.callRemote(
      () => this.remote.queryPrepared(request),
      () => this.local.queryPrepared(request),
    );
    if (!this.fallbackUsed) this.remoteObserved = true;
    return verification;
  }
}

export class LocalJsonGraphProjectionAdapter {
  constructor({ projectRoot }) {
    if (typeof projectRoot !== "string" || !projectRoot.trim()) fail("Local graph projection requires projectRoot.", "GRAPH_PROJECTION_ROOT_REQUIRED");
    this.projectRoot = path.resolve(projectRoot);
    this.adapterVersion = GRAPH_PROJECTION_ADAPTER_VERSION;
  }

  describe() {
    return {
      ...descriptor("local-json", { remote: false, durable: true }),
      preparedTraversalProtocolVersion: PREPARED_TRAVERSAL_VERSION,
      preparedTraversalMode: "local-snapshot-reference",
    };
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

  queryPrepared(request) {
    const prepared = verifyPreparedTraversalRequest(request);
    const entry = this.readSnapshot(prepared.graphSnapshotId);
    if (!entry) fail(`Graph projection snapshot is missing: ${prepared.graphSnapshotId}`, "GRAPH_PROJECTION_SNAPSHOT_MISSING");
    const result = queryTemporalProvenanceGraph(entry.document, traversalOptionsFromQuery(prepared.traversalQuery));
    verifyPreparedTraversalRequest(prepared, { graph: entry.document, result });
    return buildPreparedTraversalVerification(prepared, "local-snapshot-reference");
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
    return {
      ...descriptor(this.adapterKind, { remote: false, durable: false }),
      preparedTraversalProtocolVersion: PREPARED_TRAVERSAL_VERSION,
      preparedTraversalMode: "memory-snapshot-reference",
    };
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

  queryPrepared(request) {
    const prepared = verifyPreparedTraversalRequest(request);
    const entry = this.readSnapshot(prepared.graphSnapshotId);
    if (!entry) fail(`Graph projection snapshot is missing: ${prepared.graphSnapshotId}`, "GRAPH_PROJECTION_SNAPSHOT_MISSING");
    const result = queryTemporalProvenanceGraph(entry.document, traversalOptionsFromQuery(prepared.traversalQuery));
    verifyPreparedTraversalRequest(prepared, { graph: entry.document, result });
    return buildPreparedTraversalVerification(prepared, "memory-snapshot-reference");
  }
}

function activationPayload({ storageSelection, graph, conformanceReport }) {
  const selection = verifyStorageSelection(storageSelection);
  if (selection.mode !== "graphdb") fail("GraphDB activation requires a GraphDB storage selection.", "ARCADEDB_SELECTION_REQUIRED");
  verifyTemporalProvenanceGraph(graph);
  if (!conformanceReport || !/^graph-projection-conformance-[a-f0-9]{24}$/.test(conformanceReport.conformanceReportId || "")
    || !/^[a-f0-9]{64}$/.test(conformanceReport.conformanceReportHash || "")
    || conformanceReport.graphSnapshotId !== graph.graphSnapshotId
    || conformanceReport.graphSnapshotHash !== graph.graphSnapshotHash
    || conformanceReport.semanticIdentity !== "adapter-neutral") {
    fail("GraphDB activation requires a current adapter-neutral conformance report.", "INVALID_ARCADEDB_ACTIVATION_CONFORMANCE");
  }
  return {
    schemaVersion: 1,
    kind: "ArcadeDbGraphProjectionActivation",
    protocol: { name: "head-agent-core-arcadedb-graph-projection", version: ARCADEDB_GRAPH_PROJECTION_VERSION },
    projectId: selection.projectId,
    storageSelectionId: selection.storageSelectionId,
    storageSelectionHash: selection.storageSelectionHash,
    graphSnapshotId: graph.graphSnapshotId,
    graphSnapshotHash: graph.graphSnapshotHash,
    conformanceReportId: conformanceReport.conformanceReportId,
    conformanceReportHash: conformanceReport.conformanceReportHash,
    adapterKind: "arcadedb-http",
    authority: "derived-evidence-only",
    rebuildable: true,
    uniqueAuthority: false,
    instructionAuthority: false,
    promotionAuthority: false,
    credentialValuesPersisted: false,
    serverRecordIdentitySemantic: false,
    activationStatus: "verified-active",
  };
}

export function buildArcadeDbGraphProjectionActivation({ storageSelection, graph, conformanceReport } = {}) {
  const payload = activationPayload({ storageSelection, graph, conformanceReport });
  const activationHash = digest(graphProjectionCanonicalJson(payload));
  return { ...payload, activationId: `arcadedb-graph-activation-${activationHash.slice(0, 24)}`, activationHash };
}

export function verifyArcadeDbGraphProjectionActivation(document) {
  assertFields(document, [
    "schemaVersion", "kind", "protocol", "projectId", "storageSelectionId", "storageSelectionHash", "graphSnapshotId", "graphSnapshotHash",
    "conformanceReportId", "conformanceReportHash", "adapterKind", "authority", "rebuildable", "uniqueAuthority", "instructionAuthority",
    "promotionAuthority", "credentialValuesPersisted", "serverRecordIdentitySemantic", "activationStatus", "activationId", "activationHash",
  ], "ArcadeDB graph projection activation", "INVALID_ARCADEDB_ACTIVATION");
  if (!document || !/^arcadedb-graph-activation-[a-f0-9]{24}$/.test(document.activationId || "")
    || !/^[a-f0-9]{64}$/.test(document.activationHash || "")) {
    fail("ArcadeDB graph projection activation is invalid.", "INVALID_ARCADEDB_ACTIVATION");
  }
  const payload = { ...document };
  delete payload.activationId;
  delete payload.activationHash;
  const hash = digest(graphProjectionCanonicalJson(payload));
  if (document.activationHash !== hash || document.activationId !== `arcadedb-graph-activation-${hash.slice(0, 24)}`
    || document.kind !== "ArcadeDbGraphProjectionActivation" || document.schemaVersion !== 1
    || document.protocol?.name !== "head-agent-core-arcadedb-graph-projection"
    || document.protocol?.version !== ARCADEDB_GRAPH_PROJECTION_VERSION
    || typeof document.projectId !== "string" || !document.projectId
    || !/^onboarding-storage-[a-f0-9]{24}$/.test(document.storageSelectionId || "")
    || !/^[a-f0-9]{64}$/.test(document.storageSelectionHash || "")
    || !/^graph-snapshot-[a-f0-9]{24}$/.test(document.graphSnapshotId || "")
    || !/^[a-f0-9]{64}$/.test(document.graphSnapshotHash || "")
    || !/^graph-projection-conformance-[a-f0-9]{24}$/.test(document.conformanceReportId || "")
    || !/^[a-f0-9]{64}$/.test(document.conformanceReportHash || "")
    || document.adapterKind !== "arcadedb-http"
    || document.authority !== "derived-evidence-only" || document.rebuildable !== true || document.uniqueAuthority !== false
    || document.instructionAuthority !== false || document.promotionAuthority !== false
    || document.credentialValuesPersisted !== false || document.serverRecordIdentitySemantic !== false
    || document.activationStatus !== "verified-active") {
    fail("ArcadeDB graph projection activation digest verification failed.", "ARCADEDB_ACTIVATION_DIGEST_MISMATCH");
  }
  return document;
}

function activationPointerFor(activation) {
  const payload = {
    schemaVersion: 1,
    kind: "ArcadeDbGraphProjectionActivationPointer",
    protocol: { name: "head-agent-core-arcadedb-graph-projection", version: ARCADEDB_GRAPH_PROJECTION_VERSION },
    projectId: activation.projectId,
    storageSelectionId: activation.storageSelectionId,
    activationId: activation.activationId,
    activationHash: activation.activationHash,
    credentialValuesPersisted: false,
  };
  const pointerHash = digest(graphProjectionCanonicalJson(payload));
  return { ...payload, pointerId: `arcadedb-graph-activation-pointer-${pointerHash.slice(0, 24)}`, pointerHash };
}

function verifyActivationPointer(document) {
  assertFields(document, [
    "schemaVersion", "kind", "protocol", "projectId", "storageSelectionId", "activationId", "activationHash",
    "credentialValuesPersisted", "pointerId", "pointerHash",
  ], "ArcadeDB activation pointer", "INVALID_ARCADEDB_ACTIVATION_POINTER");
  if (!document || !/^arcadedb-graph-activation-pointer-[a-f0-9]{24}$/.test(document.pointerId || "")
    || !/^[a-f0-9]{64}$/.test(document.pointerHash || "") || document.credentialValuesPersisted !== false
    || document.kind !== "ArcadeDbGraphProjectionActivationPointer" || document.schemaVersion !== 1
    || document.protocol?.name !== "head-agent-core-arcadedb-graph-projection"
    || document.protocol?.version !== ARCADEDB_GRAPH_PROJECTION_VERSION
    || typeof document.projectId !== "string" || !document.projectId
    || !/^onboarding-storage-[a-f0-9]{24}$/.test(document.storageSelectionId || "")
    || !/^arcadedb-graph-activation-[a-f0-9]{24}$/.test(document.activationId || "")
    || !/^[a-f0-9]{64}$/.test(document.activationHash || "")) {
    fail("ArcadeDB activation pointer is invalid.", "INVALID_ARCADEDB_ACTIVATION_POINTER");
  }
  const payload = { ...document };
  delete payload.pointerId;
  delete payload.pointerHash;
  const hash = digest(graphProjectionCanonicalJson(payload));
  if (document.pointerHash !== hash || document.pointerId !== `arcadedb-graph-activation-pointer-${hash.slice(0, 24)}`) {
    fail("ArcadeDB activation pointer digest verification failed.", "ARCADEDB_ACTIVATION_POINTER_DIGEST_MISMATCH");
  }
  return document;
}

export function persistArcadeDbGraphProjectionActivation({ projectRoot, activation, conformanceReport } = {}) {
  const root = path.resolve(projectRoot || ".");
  const verified = verifyArcadeDbGraphProjectionActivation(activation);
  const verifiedConformance = verifyGraphProjectionConformanceReport(conformanceReport);
  if (verifiedConformance.conformanceReportId !== verified.conformanceReportId
    || verifiedConformance.conformanceReportHash !== verified.conformanceReportHash
    || verifiedConformance.graphSnapshotId !== verified.graphSnapshotId
    || verifiedConformance.graphSnapshotHash !== verified.graphSnapshotHash) {
    fail("ArcadeDB activation and conformance report identities differ.", "ARCADEDB_ACTIVATION_CONFORMANCE_MISMATCH");
  }
  const conformanceFile = path.join(root, ARCADEDB_CONFORMANCE_DIRECTORY, `${verifiedConformance.conformanceReportId}.json`);
  if (fs.existsSync(conformanceFile)) {
    const existing = parseDocument(conformanceFile, "Graph projection conformance report");
    if (graphProjectionCanonicalJson(existing) !== graphProjectionCanonicalJson(verifiedConformance)) {
      fail("Graph projection conformance identity conflicts with existing content.", "GRAPH_PROJECTION_CONFORMANCE_CONFLICT");
    }
  } else atomicWrite(conformanceFile, json(verifiedConformance));
  const activationFile = path.join(root, ARCADEDB_ACTIVATION_DIRECTORY, `${verified.activationId}.json`);
  if (fs.existsSync(activationFile)) {
    const existing = parseDocument(activationFile, "ArcadeDB graph projection activation");
    if (graphProjectionCanonicalJson(existing) !== graphProjectionCanonicalJson(verified)) {
      fail("ArcadeDB activation identity conflicts with existing content.", "ARCADEDB_ACTIVATION_CONFLICT");
    }
  } else atomicWrite(activationFile, json(verified));
  const pointer = activationPointerFor(verified);
  const pointerFile = path.join(root, ARCADEDB_ACTIVATION_POINTER);
  atomicWrite(pointerFile, json(pointer));
  return { activation: verified, activationFile, conformanceReport: verifiedConformance, conformanceFile, pointer, pointerFile };
}

function currentStorageSelection(projectRoot) {
  const stateFile = path.join(projectRoot, ".head", "onboarding", "current.json");
  if (!fs.existsSync(stateFile)) return null;
  const state = verifyOnboardingState(parseDocument(stateFile, "Onboarding state"));
  const selectionFile = path.join(projectRoot, ONBOARDING_STORAGE_DIRECTORY, `${state.storageSelectionId}.json`);
  if (!fs.existsSync(selectionFile)) fail("Onboarding storage selection is missing.", "ONBOARDING_STORAGE_SELECTION_MISSING");
  return verifyStorageSelection(parseDocument(selectionFile, "Onboarding storage selection"), state.projectId);
}

export function inspectArcadeDbGraphProjectionActivation({ projectRoot } = {}) {
  const root = path.resolve(projectRoot || ".");
  const storageSelection = currentStorageSelection(root);
  if (!storageSelection || storageSelection.mode !== "graphdb") return {
    status: "not-configured",
    storageSelection,
    activation: null,
    credentialValuesPersisted: false,
  };
  const pointerFile = path.join(root, ARCADEDB_ACTIVATION_POINTER);
  if (!fs.existsSync(pointerFile)) return {
    status: "pending-activation",
    storageSelection,
    activation: null,
    credentialValuesPersisted: false,
  };
  const pointer = verifyActivationPointer(parseDocument(pointerFile, "ArcadeDB activation pointer"));
  if (pointer.projectId !== storageSelection.projectId || pointer.storageSelectionId !== storageSelection.storageSelectionId) return {
    status: "pending-activation",
    storageSelection,
    activation: null,
    previousActivationId: pointer.activationId,
    credentialValuesPersisted: false,
  };
  const activationFile = path.join(root, ARCADEDB_ACTIVATION_DIRECTORY, `${pointer.activationId}.json`);
  if (!fs.existsSync(activationFile)) fail("ArcadeDB activation pointer references a missing receipt.", "ARCADEDB_ACTIVATION_MISSING");
  const activation = verifyArcadeDbGraphProjectionActivation(parseDocument(activationFile, "ArcadeDB graph projection activation"));
  if (activation.activationHash !== pointer.activationHash || activation.projectId !== storageSelection.projectId
    || activation.storageSelectionId !== storageSelection.storageSelectionId
    || activation.storageSelectionHash !== storageSelection.storageSelectionHash) {
    fail("ArcadeDB activation does not match the current storage selection.", "ARCADEDB_ACTIVATION_STALE");
  }
  const conformanceFile = path.join(root, ARCADEDB_CONFORMANCE_DIRECTORY, `${activation.conformanceReportId}.json`);
  if (!fs.existsSync(conformanceFile)) fail("ArcadeDB activation references a missing conformance report.", "ARCADEDB_CONFORMANCE_MISSING");
  const conformanceReport = verifyGraphProjectionConformanceReport(parseDocument(conformanceFile, "Graph projection conformance report"));
  if (conformanceReport.conformanceReportHash !== activation.conformanceReportHash
    || conformanceReport.graphSnapshotId !== activation.graphSnapshotId
    || conformanceReport.graphSnapshotHash !== activation.graphSnapshotHash) {
    fail("ArcadeDB activation conformance report is stale or conflicting.", "ARCADEDB_ACTIVATION_CONFORMANCE_MISMATCH");
  }
  return {
    status: "verified-active",
    storageSelection,
    activation,
    pointer,
    activationFile,
    conformanceReport,
    conformanceFile,
    pointerFile,
    credentialValuesPersisted: false,
  };
}

function topologyActivationPayload({ storageSelection, graph, topology }) {
  const selection = verifyStorageSelection(storageSelection);
  if (selection.mode !== "graphdb") fail("Graph topology activation requires a GraphDB storage selection.", "ARCADEDB_SELECTION_REQUIRED");
  verifyTemporalProvenanceGraph(graph);
  verifyArcadeDbGraphTopology(topology, graph);
  return {
    schemaVersion: 1,
    kind: "ArcadeDbGraphTopologyActivation",
    protocol: { name: "head-agent-core-arcadedb-graph-topology", version: ARCADEDB_GRAPH_TOPOLOGY_VERSION },
    projectId: selection.projectId,
    storageSelectionId: selection.storageSelectionId,
    storageSelectionHash: selection.storageSelectionHash,
    graphSnapshotId: graph.graphSnapshotId,
    graphSnapshotHash: graph.graphSnapshotHash,
    sourceSnapshotId: graph.sourceSnapshotId,
    topologyId: topology.topologyId,
    topologyHash: topology.topologyHash,
    nodeCount: topology.nodeCount,
    edgeCount: topology.edgeCount,
    adapterKind: "arcadedb-http",
    authority: "derived-verification-evidence-only",
    rebuildable: true,
    uniqueAuthority: false,
    instructionAuthority: false,
    promotionAuthority: false,
    credentialValuesPersisted: false,
    serverRecordIdentitySemantic: false,
    traversalMode: "verified-topology-client-reference",
    activationStatus: "verified-active",
  };
}

export function buildArcadeDbGraphTopologyActivation({ storageSelection, graph, topology } = {}) {
  const payload = topologyActivationPayload({ storageSelection, graph, topology });
  const activationHash = digest(graphProjectionCanonicalJson(payload));
  return { ...payload, activationId: `arcadedb-topology-activation-${activationHash.slice(0, 24)}`, activationHash };
}

export function verifyArcadeDbGraphTopologyActivation(document) {
  assertFields(document, [
    "schemaVersion", "kind", "protocol", "projectId", "storageSelectionId", "storageSelectionHash", "graphSnapshotId",
    "graphSnapshotHash", "sourceSnapshotId", "topologyId", "topologyHash", "nodeCount", "edgeCount", "adapterKind", "authority",
    "rebuildable", "uniqueAuthority", "instructionAuthority", "promotionAuthority", "credentialValuesPersisted",
    "serverRecordIdentitySemantic", "traversalMode", "activationStatus", "activationId", "activationHash",
  ], "ArcadeDB graph topology activation", "INVALID_ARCADEDB_TOPOLOGY_ACTIVATION");
  if (!document || document.kind !== "ArcadeDbGraphTopologyActivation" || document.schemaVersion !== 1
    || document.protocol?.name !== "head-agent-core-arcadedb-graph-topology"
    || document.protocol?.version !== ARCADEDB_GRAPH_TOPOLOGY_VERSION
    || typeof document.projectId !== "string" || !document.projectId
    || !/^onboarding-storage-[a-f0-9]{24}$/.test(document.storageSelectionId || "")
    || !/^[a-f0-9]{64}$/.test(document.storageSelectionHash || "")
    || !/^graph-snapshot-[a-f0-9]{24}$/.test(document.graphSnapshotId || "")
    || !/^[a-f0-9]{64}$/.test(document.graphSnapshotHash || "")
    || !/^source-snapshot-[a-f0-9]{24}$/.test(document.sourceSnapshotId || "")
    || !/^arcadedb-graph-topology-[a-f0-9]{24}$/.test(document.topologyId || "")
    || !/^[a-f0-9]{64}$/.test(document.topologyHash || "")
    || !Number.isInteger(document.nodeCount) || document.nodeCount < 0
    || !Number.isInteger(document.edgeCount) || document.edgeCount < 0
    || document.adapterKind !== "arcadedb-http" || document.authority !== "derived-verification-evidence-only"
    || document.rebuildable !== true || document.uniqueAuthority !== false || document.instructionAuthority !== false
    || document.promotionAuthority !== false || document.credentialValuesPersisted !== false
    || document.serverRecordIdentitySemantic !== false || document.traversalMode !== "verified-topology-client-reference"
    || document.activationStatus !== "verified-active"
    || !/^arcadedb-topology-activation-[a-f0-9]{24}$/.test(document.activationId || "")
    || !/^[a-f0-9]{64}$/.test(document.activationHash || "")) {
    fail("ArcadeDB graph topology activation is invalid.", "INVALID_ARCADEDB_TOPOLOGY_ACTIVATION");
  }
  const payload = { ...document };
  delete payload.activationId;
  delete payload.activationHash;
  const hash = digest(graphProjectionCanonicalJson(payload));
  if (document.activationHash !== hash || document.activationId !== `arcadedb-topology-activation-${hash.slice(0, 24)}`) {
    fail("ArcadeDB graph topology activation digest verification failed.", "ARCADEDB_TOPOLOGY_ACTIVATION_DIGEST_MISMATCH");
  }
  return document;
}

function topologyActivationPointerFor(activation) {
  const payload = {
    schemaVersion: 1,
    kind: "ArcadeDbGraphTopologyActivationPointer",
    protocol: { name: "head-agent-core-arcadedb-graph-topology", version: ARCADEDB_GRAPH_TOPOLOGY_VERSION },
    projectId: activation.projectId,
    storageSelectionId: activation.storageSelectionId,
    activationId: activation.activationId,
    activationHash: activation.activationHash,
    credentialValuesPersisted: false,
  };
  const pointerHash = digest(graphProjectionCanonicalJson(payload));
  return { ...payload, pointerId: `arcadedb-topology-pointer-${pointerHash.slice(0, 24)}`, pointerHash };
}

function verifyTopologyActivationPointer(document) {
  assertFields(document, [
    "schemaVersion", "kind", "protocol", "projectId", "storageSelectionId", "activationId", "activationHash",
    "credentialValuesPersisted", "pointerId", "pointerHash",
  ], "ArcadeDB graph topology activation pointer", "INVALID_ARCADEDB_TOPOLOGY_POINTER");
  if (!document || document.kind !== "ArcadeDbGraphTopologyActivationPointer" || document.schemaVersion !== 1
    || document.protocol?.name !== "head-agent-core-arcadedb-graph-topology"
    || document.protocol?.version !== ARCADEDB_GRAPH_TOPOLOGY_VERSION
    || typeof document.projectId !== "string" || !document.projectId
    || !/^onboarding-storage-[a-f0-9]{24}$/.test(document.storageSelectionId || "")
    || !/^arcadedb-topology-activation-[a-f0-9]{24}$/.test(document.activationId || "")
    || !/^[a-f0-9]{64}$/.test(document.activationHash || "") || document.credentialValuesPersisted !== false
    || !/^arcadedb-topology-pointer-[a-f0-9]{24}$/.test(document.pointerId || "")
    || !/^[a-f0-9]{64}$/.test(document.pointerHash || "")) {
    fail("ArcadeDB graph topology activation pointer is invalid.", "INVALID_ARCADEDB_TOPOLOGY_POINTER");
  }
  const payload = { ...document };
  delete payload.pointerId;
  delete payload.pointerHash;
  const hash = digest(graphProjectionCanonicalJson(payload));
  if (document.pointerHash !== hash || document.pointerId !== `arcadedb-topology-pointer-${hash.slice(0, 24)}`) {
    fail("ArcadeDB graph topology activation pointer digest verification failed.", "ARCADEDB_TOPOLOGY_POINTER_DIGEST_MISMATCH");
  }
  return document;
}

export function persistArcadeDbGraphTopologyActivation({ projectRoot, activation } = {}) {
  const root = path.resolve(projectRoot || ".");
  const verified = verifyArcadeDbGraphTopologyActivation(activation);
  const activationFile = path.join(root, ARCADEDB_TOPOLOGY_ACTIVATION_DIRECTORY, `${verified.activationId}.json`);
  if (fs.existsSync(activationFile)) {
    const existing = verifyArcadeDbGraphTopologyActivation(parseDocument(activationFile, "ArcadeDB graph topology activation"));
    if (graphProjectionCanonicalJson(existing) !== graphProjectionCanonicalJson(verified)) {
      fail("ArcadeDB graph topology activation identity conflicts with existing content.", "ARCADEDB_TOPOLOGY_ACTIVATION_CONFLICT");
    }
  } else atomicWrite(activationFile, json(verified));
  const pointer = topologyActivationPointerFor(verified);
  const pointerFile = path.join(root, ARCADEDB_TOPOLOGY_ACTIVATION_POINTER);
  atomicWrite(pointerFile, json(pointer));
  return { activation: verified, activationFile, pointer, pointerFile };
}

export function inspectArcadeDbGraphTopologyActivation({ projectRoot, graph = null } = {}) {
  const root = path.resolve(projectRoot || ".");
  const storageSelection = currentStorageSelection(root);
  if (!storageSelection || storageSelection.mode !== "graphdb") return { status: "not-configured", storageSelection, activation: null };
  const pointerFile = path.join(root, ARCADEDB_TOPOLOGY_ACTIVATION_POINTER);
  if (!fs.existsSync(pointerFile)) return { status: "pending-topology-activation", storageSelection, activation: null };
  const pointer = verifyTopologyActivationPointer(parseDocument(pointerFile, "ArcadeDB graph topology activation pointer"));
  if (pointer.projectId !== storageSelection.projectId || pointer.storageSelectionId !== storageSelection.storageSelectionId) {
    return { status: "pending-topology-activation", storageSelection, activation: null, previousActivationId: pointer.activationId };
  }
  const activationFile = path.join(root, ARCADEDB_TOPOLOGY_ACTIVATION_DIRECTORY, `${pointer.activationId}.json`);
  if (!fs.existsSync(activationFile)) fail("ArcadeDB graph topology pointer references a missing activation.", "ARCADEDB_TOPOLOGY_ACTIVATION_MISSING");
  const activation = verifyArcadeDbGraphTopologyActivation(parseDocument(activationFile, "ArcadeDB graph topology activation"));
  if (activation.activationHash !== pointer.activationHash || activation.projectId !== storageSelection.projectId
    || activation.storageSelectionId !== storageSelection.storageSelectionId
    || activation.storageSelectionHash !== storageSelection.storageSelectionHash) {
    fail("ArcadeDB graph topology activation does not match the current storage selection.", "ARCADEDB_TOPOLOGY_ACTIVATION_STALE");
  }
  if (graph && (activation.graphSnapshotId !== graph.graphSnapshotId || activation.graphSnapshotHash !== graph.graphSnapshotHash
    || activation.sourceSnapshotId !== graph.sourceSnapshotId)) {
    return { status: "stale", storageSelection, activation, pointer, activationFile, pointerFile };
  }
  return { status: "verified-active", storageSelection, activation, pointer, activationFile, pointerFile };
}

export function createActivatedArcadeDbGraphProjectionAdapter({ projectRoot, transport = null } = {}) {
  const inspected = inspectArcadeDbGraphProjectionActivation({ projectRoot });
  if (inspected.status !== "verified-active") return null;
  const topology = inspectArcadeDbGraphTopologyActivation({ projectRoot });
  const serverTraversalRequired = inspected.conformanceReport?.candidateAdapter?.traversalMode === ARCADEDB_SERVER_TRAVERSAL_MODE;
  const preparedTraversalRequired = inspected.conformanceReport?.candidateAdapter?.preparedTraversalProtocolVersion
    === PREPARED_TRAVERSAL_VERSION;
  return new ActivatedArcadeDbGraphProjectionAdapter({
    projectRoot,
    storageSelection: inspected.storageSelection,
    remoteAdapter: new ArcadeDbGraphProjectionAdapter({
      storageSelection: inspected.storageSelection,
      transport,
      topologyRequired: serverTraversalRequired || topology.status === "verified-active" || topology.status === "stale",
      serverTraversalRequired,
      preparedTraversalRequired,
    }),
  });
}

export function createGraphProjectionAdapter({ projectRoot, adapter = null } = {}) {
  return assertGraphProjectionAdapter(adapter
    || createActivatedArcadeDbGraphProjectionAdapter({ projectRoot })
    || new LocalJsonGraphProjectionAdapter({ projectRoot }));
}

function adapterReport(adapter) {
  return { ...adapter.describe(), ...(typeof adapter.diagnostics === "function" ? adapter.diagnostics() : {}) };
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
    adapter: adapterReport(selected),
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
    adapter: adapterReport(selected),
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
      adapter: adapterReport(selected),
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
    adapter: adapterReport(selected),
  };
}

function inspectPreparedGraphProjection({ projectRoot, graph, adapter }) {
  verifyTemporalProvenanceGraph(graph);
  const selected = createGraphProjectionAdapter({ projectRoot, adapter });
  const pointerEntry = selected.readPointer();
  if (!pointerEntry) return {
    status: "not-materialized",
    graphSnapshotId: graph.graphSnapshotId,
    fallbackAvailable: true,
    adapter: adapterReport(selected),
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
      adapter: adapterReport(selected),
    };
  }
  return {
    status: "current",
    graphSnapshotId: graph.graphSnapshotId,
    pointer,
    pointerLocation: pointerEntry.location,
    snapshotVerification: "query-scoped-prepared",
    fallbackAvailable: true,
    adapter: adapterReport(selected),
  };
}

export function queryGraphProjection({ projectRoot, graph, adapter = null, query = {} } = {}) {
  const selected = createGraphProjectionAdapter({ projectRoot, adapter });
  const expected = queryTemporalProvenanceGraph(graph, query);
  const prepared = supportsPreparedTraversal(selected);
  const inspected = prepared
    ? inspectPreparedGraphProjection({ projectRoot, graph, adapter: selected })
    : inspectGraphProjection({ projectRoot, graph, adapter: selected });
  if (inspected.status === "not-materialized") return {
    result: expected,
    diagnostics: {
      adapter: adapterReport(selected),
      executionMode: "embedded-graph-fallback",
      fallbackUsed: true,
      fallbackReasonCode: "GRAPH_PROJECTION_NOT_MATERIALIZED",
    },
  };
  if (inspected.status === "stale") {
    fail("Graph projection adapter is stale and cannot answer a current query.", "GRAPH_PROJECTION_STALE");
  }
  if (prepared) {
    const request = buildPreparedTraversalRequest({ graph, result: expected });
    const verification = verifyPreparedTraversalVerification(selected.queryPrepared(clone(request)), request);
    const selectedDiagnostics = typeof selected.diagnostics === "function" ? selected.diagnostics() : {};
    return {
      result: expected,
      diagnostics: {
        adapter: adapterReport(selected),
        executionMode: "prepared-graph-projection-adapter",
        fallbackUsed: selectedDiagnostics.fallbackUsed === true,
        fallbackReasonCode: selectedDiagnostics.fallbackReasonCode || "",
        preparedTraversal: {
          requestId: request.requestId,
          expansionHash: request.expansionHash,
          verificationId: verification.verificationId,
          verificationMode: verification.verificationMode,
        },
      },
    };
  }
  const candidate = selected.query(graph.graphSnapshotId, clone(query));
  if (graphProjectionCanonicalJson(candidate) !== graphProjectionCanonicalJson(expected)) {
    fail("Graph projection adapter query result differs from the deterministic reference result.", "GRAPH_PROJECTION_QUERY_MISMATCH");
  }
  return {
    result: candidate,
    diagnostics: {
      adapter: adapterReport(selected),
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
  return verifyGraphProjectionConformanceReport({ ...payload, conformanceReportId: `graph-projection-conformance-${conformanceReportHash.slice(0, 24)}`, conformanceReportHash });
}

export function verifyGraphProjectionConformanceReport(document) {
  assertFields(document, [
    "schemaVersion", "kind", "protocol", "graphSnapshotId", "graphSnapshotHash", "sourceSnapshotId", "referenceAdapter",
    "candidateAdapter", "cases", "semanticIdentity", "authority", "instructionAuthority", "promotionAuthority",
    "conformanceReportId", "conformanceReportHash",
  ], "Graph projection conformance report", "INVALID_GRAPH_PROJECTION_CONFORMANCE_REPORT");
  if (!document || document.kind !== "GraphProjectionConformanceReport" || document.schemaVersion !== 1
    || document.protocol?.name !== "head-agent-core-graph-projection-conformance"
    || document.protocol?.version !== GRAPH_PROJECTION_ADAPTER_VERSION
    || !/^graph-snapshot-[a-f0-9]{24}$/.test(document.graphSnapshotId || "")
    || !/^[a-f0-9]{64}$/.test(document.graphSnapshotHash || "")
    || !/^source-snapshot-[a-f0-9]{24}$/.test(document.sourceSnapshotId || "")
    || !Array.isArray(document.cases) || document.cases.length < 1 || document.cases.length > 64
    || document.semanticIdentity !== "adapter-neutral"
    || document.authority !== "derived-verification-evidence-only"
    || document.instructionAuthority !== false || document.promotionAuthority !== false
    || !/^graph-projection-conformance-[a-f0-9]{24}$/.test(document.conformanceReportId || "")
    || !/^[a-f0-9]{64}$/.test(document.conformanceReportHash || "")) {
    fail("Graph projection conformance report is invalid.", "INVALID_GRAPH_PROJECTION_CONFORMANCE_REPORT");
  }
  for (const adapter of [document.referenceAdapter, document.candidateAdapter]) {
    if (!adapter || adapter.contract !== GRAPH_PROJECTION_CONTRACT || adapter.adapterVersion !== GRAPH_PROJECTION_ADAPTER_VERSION
      || typeof adapter.adapterKind !== "string" || !adapter.adapterKind.trim()
      || typeof adapter.remote !== "boolean" || typeof adapter.durable !== "boolean"
      || adapter.authority !== "derived-evidence-only" || adapter.rebuildable !== true
      || adapter.uniqueAuthority !== false || adapter.instructionAuthority !== false || adapter.promotionAuthority !== false) {
      fail("Graph projection conformance report contains an invalid adapter descriptor.", "INVALID_GRAPH_PROJECTION_CONFORMANCE_REPORT");
    }
  }
  const names = new Set();
  for (const fixture of document.cases) {
    assertFields(fixture, ["name", "queryId", "queryHash", "resultId", "resultHash"], "Graph projection conformance case", "INVALID_GRAPH_PROJECTION_CONFORMANCE_REPORT");
    if (!fixture || typeof fixture.name !== "string" || !fixture.name.trim() || names.has(fixture.name)
      || !/^traversal-query-[a-f0-9]{24}$/.test(fixture.queryId || "") || !/^[a-f0-9]{64}$/.test(fixture.queryHash || "")
      || !/^traversal-result-[a-f0-9]{24}$/.test(fixture.resultId || "") || !/^[a-f0-9]{64}$/.test(fixture.resultHash || "")) {
      fail("Graph projection conformance report case is invalid.", "INVALID_GRAPH_PROJECTION_CONFORMANCE_REPORT");
    }
    names.add(fixture.name);
  }
  if (graphProjectionCanonicalJson([...names]) !== graphProjectionCanonicalJson([...names].sort())) {
    fail("Graph projection conformance cases are not canonically ordered.", "INVALID_GRAPH_PROJECTION_CONFORMANCE_REPORT");
  }
  const payload = { ...document };
  delete payload.conformanceReportId;
  delete payload.conformanceReportHash;
  const hash = digest(graphProjectionCanonicalJson(payload));
  if (document.conformanceReportHash !== hash || document.conformanceReportId !== `graph-projection-conformance-${hash.slice(0, 24)}`) {
    fail("Graph projection conformance report digest verification failed.", "GRAPH_PROJECTION_CONFORMANCE_DIGEST_MISMATCH");
  }
  return document;
}
