import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { WORKSPACE_HOST_COORDINATION_VERSION } from "./workspace-host-coordination.mjs";

export const WORKSPACE_HOST_EXPORT_VERSION = "0.1.0";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const RUNTIMES = new Set(["codex", "opencode"]);
const MAX_JSON_BYTES = 128 * 1024;
const MAX_NOTIFICATION_BYTES = 8192;

const fail = (message, code = "WORKSPACE_HOST_EXPORT_ERROR") => {
  const error = new Error(message);
  error.code = code;
  throw error;
};

const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort(compareText).map((key) => [key, canonical(value[key])]));
  }
  return value;
}

const canonicalJson = (value) => JSON.stringify(canonical(value));
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");

function exactFields(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} is invalid.`, "INVALID_WORKSPACE_HOST_EXPORT_VALUE");
  const expected = new Set(fields);
  if (Object.keys(value).some((field) => !expected.has(field)) || fields.some((field) => !(field in value))) {
    fail(`${label} fields are invalid.`, "INVALID_WORKSPACE_HOST_EXPORT_VALUE");
  }
  return value;
}

function exactId(value, label) {
  const normalized = String(value || "");
  if (!ID.test(normalized)) fail(`${label} is invalid.`, "INVALID_WORKSPACE_HOST_EXPORT_IDENTITY");
  return normalized;
}

function directDirectory(value, label, { create = false } = {}) {
  if (typeof value !== "string" || !path.isAbsolute(value)) fail(`${label} must be absolute.`, "INVALID_WORKSPACE_HOST_EXPORT_PATH");
  if (create) fs.mkdirSync(value, { recursive: true });
  try {
    const stat = fs.lstatSync(value);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("unsafe directory");
    return fs.realpathSync(value);
  } catch {
    fail(`${label} is unavailable or unsafe.`, "INVALID_WORKSPACE_HOST_EXPORT_PATH");
  }
}

function separatedRoots(exportRoot, projectRoot) {
  if (typeof exportRoot !== "string" || !path.isAbsolute(exportRoot)) {
    fail("Workspace host export root must be absolute.", "INVALID_WORKSPACE_HOST_EXPORT_PATH");
  }
  const project = directDirectory(projectRoot, "Workspace host project root");
  const requestedExport = path.resolve(exportRoot);
  const requestedRelativeFromProject = path.relative(project, requestedExport);
  const requestedRelativeFromExport = path.relative(requestedExport, project);
  const inside = (relative) => relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  if (inside(requestedRelativeFromProject) || inside(requestedRelativeFromExport)) {
    fail("Workspace host export state must be outside and must not contain the project.", "WORKSPACE_HOST_EXPORT_PROJECT_OVERLAP");
  }
  const exported = directDirectory(exportRoot, "Workspace host export root");
  const relativeFromProject = path.relative(project, exported);
  const relativeFromExport = path.relative(exported, project);
  if (inside(relativeFromProject) || inside(relativeFromExport)) {
    fail("Workspace host export state must be outside and must not contain the project.", "WORKSPACE_HOST_EXPORT_PROJECT_OVERLAP");
  }
  return { exportRoot: exported, projectRoot: project };
}

function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function safePath(root, ...segments) {
  const candidate = path.resolve(root, ...segments);
  if (!within(root, candidate)) fail("Workspace host export path escapes its root.", "WORKSPACE_HOST_EXPORT_PATH_ESCAPE");
  return candidate;
}

function directParent(root, file) {
  const parent = path.dirname(file);
  fs.mkdirSync(parent, { recursive: true });
  const stat = fs.lstatSync(parent);
  const real = fs.realpathSync(parent);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !within(root, real)) {
    fail("Workspace host export parent is unsafe.", "INVALID_WORKSPACE_HOST_EXPORT_PATH");
  }
  return parent;
}

function readJson(root, file, label, { optional = false } = {}) {
  try {
    const stat = fs.lstatSync(file);
    const real = fs.realpathSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_JSON_BYTES || !within(root, real)) {
      fail(`${label} is unsafe.`, "INVALID_WORKSPACE_HOST_EXPORT_FILE");
    }
    return JSON.parse(fs.readFileSync(real, "utf8"));
  } catch (error) {
    if (optional && error?.code === "ENOENT") return null;
    if (error?.code?.startsWith?.("INVALID_WORKSPACE_HOST_EXPORT")) throw error;
    fail(`${label} is unavailable or invalid.`, "INVALID_WORKSPACE_HOST_EXPORT_FILE");
  }
}

function writeExclusive(root, file, value) {
  directParent(root, file);
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(bytes) > MAX_JSON_BYTES) fail("Workspace host export record is too large.", "WORKSPACE_HOST_EXPORT_SIZE_LIMIT");
  try { fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o600 }); }
  catch (error) { if (error.code !== "EEXIST") throw error; else return false; }
  return true;
}

function replacePointer(root, file, value) {
  const parent = directParent(root, file);
  const temporary = safePath(root, path.relative(root, parent), `.current-${process.pid}-${crypto.randomUUID()}.json`);
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    try { fs.unlinkSync(temporary); } catch {}
  }
}

function validateEndpoint(value) {
  exactFields(value, ["workspaceId", "tabId", "endpointId", "terminalId", "cwd", "runtime"], "Workspace host export endpoint");
  const runtime = String(value.runtime || "").toLowerCase();
  if (![value.workspaceId, value.tabId, value.endpointId, value.terminalId].every((item) => ID.test(String(item || "")))
    || typeof value.cwd !== "string" || !path.isAbsolute(value.cwd) || !RUNTIMES.has(runtime)) {
    fail("Workspace host export endpoint is invalid.", "INVALID_WORKSPACE_HOST_EXPORT_ENDPOINT");
  }
  return { ...value, runtime };
}

function snapshotPayload({ hostInstanceId, endpoints }) {
  const normalized = endpoints.map(validateEndpoint).sort((left, right) => compareText(canonicalJson(left), canonicalJson(right)));
  const identities = new Set();
  for (const endpoint of normalized) {
    const identity = canonicalJson([endpoint.workspaceId, endpoint.tabId, endpoint.endpointId, endpoint.terminalId]);
    if (identities.has(identity)) fail("Workspace host export endpoint is duplicated.", "INVALID_WORKSPACE_HOST_EXPORT_ENDPOINT");
    identities.add(identity);
  }
  const semanticHash = digest(canonicalJson({ hostInstanceId, endpoints: normalized }));
  return {
    schemaVersion: 1,
    kind: "WorkspaceHostExportSnapshot",
    protocol: { name: "head-agent-core-workspace-host-export", version: WORKSPACE_HOST_EXPORT_VERSION },
    hostInstanceId: exactId(hostInstanceId, "Workspace host instance"),
    snapshotSequence: `host-export-snapshot-${semanticHash.slice(0, 24)}`,
    endpoints: normalized,
  };
}

function identifySnapshot(payload) {
  const snapshotHash = digest(canonicalJson(payload));
  return { ...payload, snapshotId: `host-export-${snapshotHash.slice(0, 32)}`, snapshotHash };
}

function verifySnapshot(value) {
  exactFields(value, [
    "schemaVersion", "kind", "protocol", "hostInstanceId", "snapshotSequence", "endpoints", "snapshotId", "snapshotHash",
  ], "Workspace host export snapshot");
  exactFields(value.protocol, ["name", "version"], "Workspace host export snapshot protocol");
  const payload = { ...value };
  delete payload.snapshotId;
  delete payload.snapshotHash;
  const expected = identifySnapshot(snapshotPayload({ hostInstanceId: value.hostInstanceId, endpoints: value.endpoints }));
  if (value.schemaVersion !== 1 || value.kind !== "WorkspaceHostExportSnapshot"
    || value.protocol.name !== "head-agent-core-workspace-host-export"
    || value.protocol.version !== WORKSPACE_HOST_EXPORT_VERSION
    || value.snapshotSequence !== expected.snapshotSequence || value.snapshotId !== expected.snapshotId
    || value.snapshotHash !== expected.snapshotHash || canonicalJson(value) !== canonicalJson(expected)) {
    fail("Workspace host export snapshot failed verification.", "INVALID_WORKSPACE_HOST_EXPORT_SNAPSHOT");
  }
  return value;
}

function pointerFor(snapshot) {
  const payload = {
    schemaVersion: 1,
    kind: "WorkspaceHostExportPointer",
    snapshotId: snapshot.snapshotId,
    snapshotHash: snapshot.snapshotHash,
  };
  return { ...payload, pointerHash: digest(canonicalJson(payload)) };
}

function verifyPointer(value) {
  exactFields(value, ["schemaVersion", "kind", "snapshotId", "snapshotHash", "pointerHash"], "Workspace host export pointer");
  const payload = { ...value };
  delete payload.pointerHash;
  if (value.schemaVersion !== 1 || value.kind !== "WorkspaceHostExportPointer"
    || !/^host-export-[a-f0-9]{32}$/u.test(value.snapshotId || "") || !/^[a-f0-9]{64}$/u.test(value.snapshotHash || "")
    || value.pointerHash !== digest(canonicalJson(payload))) {
    fail("Workspace host export pointer failed verification.", "INVALID_WORKSPACE_HOST_EXPORT_POINTER");
  }
  return value;
}

function bridgePaths(exportRoot) {
  const root = safePath(exportRoot, "workspace-host-export", "v1");
  return {
    root,
    current: safePath(root, "current.json"),
    snapshot: (snapshotId) => safePath(root, "snapshots", `${snapshotId}.json`),
    request: (endpointId, messageId) => safePath(root, "deliveries", digest(endpointId), `${messageId}.request.json`),
    claim: (endpointId, messageId) => safePath(root, "claims", digest(endpointId), `${messageId}.claim.json`),
    acknowledgement: (endpointId, messageId) => safePath(root, "acks", digest(endpointId), `${messageId}.ack.json`),
    requestDirectory: (endpointId) => safePath(root, "deliveries", digest(endpointId)),
  };
}

export function publishWorkspaceHostExportSnapshot({ exportRoot, projectRoot, hostInstanceId, endpoints } = {}) {
  const roots = separatedRoots(exportRoot, projectRoot);
  const paths = bridgePaths(roots.exportRoot);
  fs.mkdirSync(paths.root, { recursive: true });
  const snapshot = identifySnapshot(snapshotPayload({ hostInstanceId, endpoints: Array.isArray(endpoints) ? endpoints : [] }));
  const file = paths.snapshot(snapshot.snapshotId);
  if (!writeExclusive(roots.exportRoot, file, snapshot)) {
    const existing = verifySnapshot(readJson(roots.exportRoot, file, "Workspace host export snapshot"));
    if (canonicalJson(existing) !== canonicalJson(snapshot)) fail("Workspace host export snapshot identity collides.", "WORKSPACE_HOST_EXPORT_COLLISION");
  }
  replacePointer(roots.exportRoot, paths.current, pointerFor(snapshot));
  return snapshot;
}

function readCurrentSnapshot(roots) {
  const paths = bridgePaths(roots.exportRoot);
  const pointer = verifyPointer(readJson(roots.exportRoot, paths.current, "Workspace host export current pointer"));
  const snapshot = verifySnapshot(readJson(roots.exportRoot, paths.snapshot(pointer.snapshotId), "Workspace host export current snapshot"));
  if (snapshot.snapshotHash !== pointer.snapshotHash) fail("Workspace host export pointer and snapshot differ.", "INVALID_WORKSPACE_HOST_EXPORT_POINTER");
  return snapshot;
}

function deliveryPayload({ snapshot, endpoint, messageId, text }) {
  const payload = {
    schemaVersion: 1,
    kind: "WorkspaceHostExportDeliveryRequest",
    protocol: { name: "head-agent-core-workspace-host-export", version: WORKSPACE_HOST_EXPORT_VERSION },
    hostInstanceId: snapshot.hostInstanceId,
    snapshotSequence: snapshot.snapshotSequence,
    workspaceId: endpoint.workspaceId,
    tabId: endpoint.tabId,
    endpointId: endpoint.endpointId,
    terminalId: endpoint.terminalId,
    cwd: endpoint.cwd,
    runtime: endpoint.runtime,
    messageId,
    text,
  };
  return { ...payload, requestHash: digest(canonicalJson(payload)) };
}

function verifyDeliveryRequest(value) {
  exactFields(value, [
    "schemaVersion", "kind", "protocol", "hostInstanceId", "snapshotSequence", "workspaceId", "tabId", "endpointId",
    "terminalId", "cwd", "runtime", "messageId", "text", "requestHash",
  ], "Workspace host export delivery request");
  exactFields(value.protocol, ["name", "version"], "Workspace host export delivery protocol");
  const payload = { ...value };
  delete payload.requestHash;
  if (value.schemaVersion !== 1 || value.kind !== "WorkspaceHostExportDeliveryRequest"
    || value.protocol.name !== "head-agent-core-workspace-host-export"
    || value.protocol.version !== WORKSPACE_HOST_EXPORT_VERSION
    || ![value.hostInstanceId, value.snapshotSequence, value.workspaceId, value.tabId, value.endpointId,
      value.terminalId, value.messageId].every((item) => ID.test(String(item || "")))
    || typeof value.cwd !== "string" || !path.isAbsolute(value.cwd)
    || value.runtime !== String(value.runtime || "").toLowerCase() || !RUNTIMES.has(value.runtime)
    || typeof value.text !== "string" || !value.text || Buffer.byteLength(value.text) > MAX_NOTIFICATION_BYTES
    || value.requestHash !== digest(canonicalJson(payload))) {
    fail("Workspace host export delivery request failed verification.", "INVALID_WORKSPACE_HOST_EXPORT_DELIVERY");
  }
  return value;
}

function acknowledgementFor(request) {
  const payload = {
    schemaVersion: 1,
    kind: "WorkspaceHostExportDeliveryAck",
    protocol: { name: "head-agent-core-workspace-host-export", version: WORKSPACE_HOST_EXPORT_VERSION },
    status: "delivered",
    requestHash: request.requestHash,
    hostInstanceId: request.hostInstanceId,
    workspaceId: request.workspaceId,
    tabId: request.tabId,
    endpointId: request.endpointId,
    terminalId: request.terminalId,
    messageId: request.messageId,
  };
  return { ...payload, acknowledgementHash: digest(canonicalJson(payload)) };
}

function claimFor(request) {
  const payload = {
    schemaVersion: 1,
    kind: "WorkspaceHostExportDeliveryClaim",
    protocol: { name: "head-agent-core-workspace-host-export", version: WORKSPACE_HOST_EXPORT_VERSION },
    requestHash: request.requestHash,
    hostInstanceId: request.hostInstanceId,
    endpointId: request.endpointId,
    terminalId: request.terminalId,
    messageId: request.messageId,
    effectAuthority: "host-delivery-effect-only",
    providerSessionIdentityPersisted: false,
  };
  return { ...payload, claimHash: digest(canonicalJson(payload)) };
}

function verifyClaim(value, request) {
  exactFields(value, [
    "schemaVersion", "kind", "protocol", "requestHash", "hostInstanceId", "endpointId", "terminalId", "messageId",
    "effectAuthority", "providerSessionIdentityPersisted", "claimHash",
  ], "Workspace host export delivery claim");
  const expected = claimFor(request);
  if (canonicalJson(value) !== canonicalJson(expected)) {
    fail("Workspace host export delivery claim failed verification.", "INVALID_WORKSPACE_HOST_EXPORT_CLAIM");
  }
  return value;
}

function verifyAcknowledgement(value, request) {
  exactFields(value, [
    "schemaVersion", "kind", "protocol", "status", "requestHash", "hostInstanceId", "workspaceId", "tabId",
    "endpointId", "terminalId", "messageId", "acknowledgementHash",
  ], "Workspace host export delivery acknowledgment");
  const expected = acknowledgementFor(request);
  if (canonicalJson(value) !== canonicalJson(expected)) {
    fail("Workspace host export delivery acknowledgment failed verification.", "INVALID_WORKSPACE_HOST_EXPORT_ACK");
  }
  return value;
}

function rootContext({ exportRoot, projectRoot }) {
  const roots = separatedRoots(exportRoot, projectRoot);
  fs.mkdirSync(bridgePaths(roots.exportRoot).root, { recursive: true });
  return roots;
}

export function listWorkspaceHostExportDeliveryRequests({ exportRoot, projectRoot, endpointId } = {}) {
  const roots = rootContext({ exportRoot, projectRoot });
  const paths = bridgePaths(roots.exportRoot);
  exactId(endpointId, "Workspace host export endpoint");
  const directory = paths.requestDirectory(endpointId);
  let names = [];
  try { names = fs.readdirSync(directory).filter((name) => name.endsWith(".request.json")).sort(); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  return names.map((name) => verifyDeliveryRequest(readJson(roots.exportRoot, safePath(directory, name), "Workspace host export delivery request")))
    .filter((request) => request.endpointId === endpointId)
    .filter((request) => {
      const acknowledgement = readJson(roots.exportRoot, paths.acknowledgement(request.endpointId, request.messageId), "Workspace host export delivery acknowledgment", { optional: true });
      if (acknowledgement) {
        verifyAcknowledgement(acknowledgement, request);
        return false;
      }
      const claim = readJson(roots.exportRoot, paths.claim(request.endpointId, request.messageId), "Workspace host export delivery claim", { optional: true });
      if (claim) {
        verifyClaim(claim, request);
        return false;
      }
      return true;
    });
}

export function claimWorkspaceHostExportDelivery({ exportRoot, projectRoot, request } = {}) {
  const roots = rootContext({ exportRoot, projectRoot });
  const verified = verifyDeliveryRequest(request);
  const paths = bridgePaths(roots.exportRoot);
  const acknowledgement = readJson(roots.exportRoot, paths.acknowledgement(verified.endpointId, verified.messageId), "Workspace host export delivery acknowledgment", { optional: true });
  if (acknowledgement) {
    verifyAcknowledgement(acknowledgement, verified);
    return { status: "already_acknowledged", claim: null };
  }
  const claim = claimFor(verified);
  const file = paths.claim(verified.endpointId, verified.messageId);
  if (!writeExclusive(roots.exportRoot, file, claim)) {
    const existing = verifyClaim(readJson(roots.exportRoot, file, "Workspace host export delivery claim"), verified);
    return { status: "ambiguous_existing_claim", claim: existing };
  }
  const snapshot = readCurrentSnapshot(roots);
  const endpoint = {
    workspaceId: verified.workspaceId,
    tabId: verified.tabId,
    endpointId: verified.endpointId,
    terminalId: verified.terminalId,
    cwd: verified.cwd,
    runtime: verified.runtime,
  };
  if (snapshot.hostInstanceId !== verified.hostInstanceId || snapshot.snapshotSequence !== verified.snapshotSequence
    || snapshot.endpoints.filter((candidate) => canonicalJson(candidate) === canonicalJson(endpoint)).length !== 1) {
    return { status: "stale_claimed", claim };
  }
  return { status: "claimed", claim };
}

export function acknowledgeWorkspaceHostExportDelivery({ exportRoot, projectRoot, request, claim } = {}) {
  const roots = rootContext({ exportRoot, projectRoot });
  const verified = verifyDeliveryRequest(request);
  const paths = bridgePaths(roots.exportRoot);
  const verifiedClaim = verifyClaim(claim, verified);
  const persistedClaim = verifyClaim(readJson(roots.exportRoot, paths.claim(verified.endpointId, verified.messageId), "Workspace host export delivery claim"), verified);
  if (persistedClaim.claimHash !== verifiedClaim.claimHash) {
    fail("Workspace host export delivery claim changed before acknowledgment.", "INVALID_WORKSPACE_HOST_EXPORT_CLAIM");
  }
  const acknowledgement = acknowledgementFor(verified);
  const file = paths.acknowledgement(verified.endpointId, verified.messageId);
  if (!writeExclusive(roots.exportRoot, file, acknowledgement)) {
    verifyAcknowledgement(readJson(roots.exportRoot, file, "Workspace host export delivery acknowledgment"), verified);
  }
  return acknowledgement;
}

export function createWorkspaceHostExportDriver({
  exportRoot, projectRoot, acknowledgementTimeoutMs = 10_000, pollIntervalMs = 10,
} = {}) {
  if (!Number.isInteger(acknowledgementTimeoutMs) || acknowledgementTimeoutMs < 10 || acknowledgementTimeoutMs > 60_000
    || !Number.isInteger(pollIntervalMs) || pollIntervalMs < 1 || pollIntervalMs > 1_000
    || pollIntervalMs > acknowledgementTimeoutMs) {
    fail("Workspace host export timing bounds are invalid.", "INVALID_WORKSPACE_HOST_EXPORT_TIMING");
  }
  const roots = rootContext({ exportRoot, projectRoot });
  const paths = bridgePaths(roots.exportRoot);
  const descriptor = Object.freeze({
    schemaVersion: 1,
    kind: "WorkspaceHostDriverDescriptor",
    protocol: { name: "head-agent-core-workspace-host-driver", version: WORKSPACE_HOST_COORDINATION_VERSION },
    hostKind: "host-export",
    transport: "filesystem-mailbox",
    providerNeutral: true,
    tuiScraping: false,
    providerSessionIdentityPersisted: false,
  });
  return Object.freeze({
    describe() { return descriptor; },
    snapshot() {
      const snapshot = readCurrentSnapshot(roots);
      return {
        schemaVersion: 1,
        kind: "WorkspaceHostSnapshot",
        protocol: { name: "head-agent-core-workspace-host-snapshot", version: WORKSPACE_HOST_COORDINATION_VERSION },
        hostKind: descriptor.hostKind,
        transport: descriptor.transport,
        hostInstanceId: snapshot.hostInstanceId,
        snapshotSequence: snapshot.snapshotSequence,
        endpoints: snapshot.endpoints.map((endpoint) => ({ ...endpoint })),
      };
    },
    send({ endpoint, messageId, text } = {}) {
      const verifiedEndpoint = validateEndpoint(endpoint);
      exactId(messageId, "Workspace host export message");
      if (typeof text !== "string" || !text || Buffer.byteLength(text) > MAX_NOTIFICATION_BYTES) {
        fail("Workspace host export notification is invalid.", "INVALID_WORKSPACE_HOST_EXPORT_DELIVERY");
      }
      const snapshot = readCurrentSnapshot(roots);
      const exact = snapshot.endpoints.filter((candidate) => canonicalJson(candidate) === canonicalJson(verifiedEndpoint));
      if (exact.length !== 1) fail("Workspace host export endpoint is no longer exact.", "STALE_WORKSPACE_HOST_EXPORT_ENDPOINT");
      const request = deliveryPayload({ snapshot, endpoint: verifiedEndpoint, messageId, text });
      const requestFile = paths.request(verifiedEndpoint.endpointId, messageId);
      if (!writeExclusive(roots.exportRoot, requestFile, request)) {
        const existing = verifyDeliveryRequest(readJson(roots.exportRoot, requestFile, "Workspace host export delivery request"));
        if (canonicalJson(existing) !== canonicalJson(request)) fail("Workspace host export message identity was reused.", "WORKSPACE_HOST_EXPORT_DELIVERY_CONFLICT");
      }
      const ackFile = paths.acknowledgement(verifiedEndpoint.endpointId, messageId);
      const deadline = Date.now() + acknowledgementTimeoutMs;
      while (Date.now() <= deadline) {
        const acknowledgement = readJson(roots.exportRoot, ackFile, "Workspace host export delivery acknowledgment", { optional: true });
        if (acknowledgement) {
          verifyAcknowledgement(acknowledgement, request);
          return {
            status: "delivered",
            messageId,
            hostInstanceId: snapshot.hostInstanceId,
            workspaceId: verifiedEndpoint.workspaceId,
            tabId: verifiedEndpoint.tabId,
            endpointId: verifiedEndpoint.endpointId,
            terminalId: verifiedEndpoint.terminalId,
          };
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pollIntervalMs);
      }
      fail("Workspace host export delivery acknowledgment timed out.", "WORKSPACE_HOST_EXPORT_ACK_TIMEOUT");
    },
  });
}
