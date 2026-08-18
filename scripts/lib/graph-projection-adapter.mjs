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

const ARCADEDB_SNAPSHOT_TYPE = "HeadAgentGraphSnapshot";
const ARCADEDB_POINTER_TYPE = "HeadAgentGraphPointer";
const ARCADEDB_ACTIVATION_DIRECTORY = path.join(".head", "graph-projection", "arcadedb", "activations");
const ARCADEDB_CONFORMANCE_DIRECTORY = path.join(".head", "graph-projection", "arcadedb", "conformance");
const ARCADEDB_ACTIVATION_POINTER = path.join(".head", "graph-projection", "arcadedb", "current.json");
const ARCADEDB_TRANSPORT_METHODS = ["describe", "ensureSchema", "readPointer", "readSnapshot", "writePointer", "writeSnapshot", "listSnapshotIds"];
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
}

function parseRemoteJson(value, label) {
  if (typeof value !== "string") fail(`${label} is not a JSON string.`, "ARCADEDB_INVALID_RESPONSE");
  try { return JSON.parse(value); }
  catch { fail(`${label} is invalid JSON.`, "ARCADEDB_INVALID_RESPONSE"); }
}

export class ArcadeDbGraphProjectionAdapter {
  constructor({ storageSelection, transport = null } = {}) {
    this.storageSelection = verifyStorageSelection(storageSelection);
    if (this.storageSelection.mode !== "graphdb") fail("ArcadeDB adapter requires a GraphDB storage selection.", "ARCADEDB_SELECTION_REQUIRED");
    this.projectId = this.storageSelection.projectId;
    this.transport = assertArcadeDbTransport(transport || new ArcadeDbHttpTransport({ storageSelection: this.storageSelection }));
    this.adapterVersion = GRAPH_PROJECTION_ADAPTER_VERSION;
    const endpoint = new URL(this.storageSelection.graphdb.endpoint);
    this.locationBase = `arcadedb://${endpoint.host}/${encodeURIComponent(this.storageSelection.graphdb.database)}/head-agent/${encodeURIComponent(this.projectId)}`;
    this.schemaReady = false;
  }

  describe() {
    return {
      ...descriptor("arcadedb-http", { remote: true, durable: true }),
      remoteProtocol: this.transport.describe().protocol,
      remoteProtocolVersion: ARCADEDB_GRAPH_PROJECTION_VERSION,
      credentialsPersisted: false,
      serverRecordIdentitySemantic: false,
      traversalMode: "verified-snapshot-client-reference",
    };
  }

  ensureSchema() {
    if (!this.schemaReady) {
      this.transport.ensureSchema();
      this.schemaReady = true;
    }
  }

  readPointer() {
    const value = this.transport.readPointer(this.projectId);
    return value == null ? null : { location: `${this.locationBase}/current`, document: parseRemoteJson(value, "ArcadeDB graph projection pointer") };
  }

  readSnapshot(id) {
    graphSnapshotId(id);
    const value = this.transport.readSnapshot(this.projectId, id);
    return value == null ? null : { location: `${this.locationBase}/snapshots/${id}`, document: parseRemoteJson(value, "ArcadeDB graph projection snapshot") };
  }

  writeSnapshot(id, document) {
    graphSnapshotId(id);
    this.ensureSchema();
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

  query(id, options) {
    const entry = this.readSnapshot(id);
    if (!entry) fail(`Graph projection snapshot is missing: ${id}`, "GRAPH_PROJECTION_SNAPSHOT_MISSING");
    return queryTemporalProvenanceGraph(entry.document, options);
  }
}

const FALLBACK_CODES = new Set(["ARCADEDB_TRANSPORT_UNAVAILABLE", "ARCADEDB_CREDENTIALS_UNAVAILABLE"]);

export class ActivatedArcadeDbGraphProjectionAdapter {
  constructor({ projectRoot, storageSelection, remoteAdapter = null, transport = null } = {}) {
    this.adapterVersion = GRAPH_PROJECTION_ADAPTER_VERSION;
    this.local = new LocalJsonGraphProjectionAdapter({ projectRoot });
    this.remote = remoteAdapter || new ArcadeDbGraphProjectionAdapter({ storageSelection, transport });
    this.fallbackUsed = false;
    this.fallbackReasonCode = "";
    this.remoteObserved = false;
    this.remoteMutated = false;
  }

  describe() {
    return {
      ...descriptor("activated-arcadedb-with-local-mirror", { remote: true, durable: true }),
      credentialsPersisted: false,
      localMirror: true,
      fallbackPolicy: "unavailable-before-remote-observation-only",
      traversalMode: "verified-snapshot-client-reference",
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
      const remoteEntry = this.remote.writeSnapshot(id, document);
      this.remoteMutated = true;
      const localEntry = this.local.writeSnapshot(id, document);
      if (graphProjectionCanonicalJson(localEntry.document) !== graphProjectionCanonicalJson(remoteEntry.document)) {
        fail("ArcadeDB and local mirror snapshots differ.", "GRAPH_PROJECTION_SNAPSHOT_CONFLICT");
      }
      return remoteEntry;
    }, () => this.local.writeSnapshot(id, document));
    return entry;
  }

  writePointer(document) {
    return this.callRemote(() => {
      const remoteEntry = this.remote.writePointer(document);
      this.remoteMutated = true;
      const localEntry = this.local.writePointer(document);
      if (graphProjectionCanonicalJson(localEntry.document) !== graphProjectionCanonicalJson(remoteEntry.document)) {
        fail("ArcadeDB and local mirror pointers differ.", "GRAPH_PROJECTION_WRITE_MISMATCH");
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

export function createActivatedArcadeDbGraphProjectionAdapter({ projectRoot, transport = null } = {}) {
  const inspected = inspectArcadeDbGraphProjectionActivation({ projectRoot });
  if (inspected.status !== "verified-active") return null;
  return new ActivatedArcadeDbGraphProjectionAdapter({
    projectRoot,
    storageSelection: inspected.storageSelection,
    transport,
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

export function queryGraphProjection({ projectRoot, graph, adapter = null, query = {} } = {}) {
  const selected = createGraphProjectionAdapter({ projectRoot, adapter });
  const expected = queryTemporalProvenanceGraph(graph, query);
  const inspected = inspectGraphProjection({ projectRoot, graph, adapter: selected });
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
