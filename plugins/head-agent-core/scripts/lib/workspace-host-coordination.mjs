import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  buildWorkspaceHostProbe,
  validateWorkspaceHostAdapter,
  verifiedWorkspaceHostDescriptor,
} from "./runtime-adapter.mjs";

export const WORKSPACE_HOST_COORDINATION_VERSION = "0.1.0";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ROLE = /^[a-z][a-z0-9-]{0,63}$/;
const RUNTIMES = new Set(["claude", "codex", "opencode"]);
const TRANSPORT = /^[a-z][a-z0-9-]{0,63}$/;
const MAX_NOTIFICATION_BYTES = 8192;

const fail = (message, code = "WORKSPACE_HOST_COORDINATION_ERROR") => {
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
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} is invalid.`, "INVALID_WORKSPACE_HOST_VALUE");
  const expected = new Set(fields);
  if (Object.keys(value).some((field) => !expected.has(field)) || fields.some((field) => !(field in value))) {
    fail(`${label} fields are invalid.`, "INVALID_WORKSPACE_HOST_VALUE");
  }
  return value;
}

function exactId(value, label) {
  const normalized = String(value || "");
  if (!ID.test(normalized)) fail(`${label} is invalid.`, "INVALID_WORKSPACE_HOST_IDENTITY");
  return normalized;
}

function directCanonicalDirectory(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)) fail(`${label} must be an absolute directory.`, "INVALID_WORKSPACE_HOST_PATH");
  try {
    const stat = fs.lstatSync(value);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("unsafe directory");
    return fs.realpathSync(value);
  } catch {
    fail(`${label} is unavailable or unsafe.`, "INVALID_WORKSPACE_HOST_PATH");
  }
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function driverDescriptor(value) {
  exactFields(value, [
    "schemaVersion", "kind", "protocol", "hostKind", "transport", "providerNeutral", "tuiScraping",
    "providerSessionIdentityPersisted",
  ], "WorkspaceHostDriver descriptor");
  exactFields(value.protocol, ["name", "version"], "WorkspaceHostDriver protocol");
  if (value.schemaVersion !== 1 || value.kind !== "WorkspaceHostDriverDescriptor"
    || value.protocol.name !== "head-agent-core-workspace-host-driver"
    || value.protocol.version !== WORKSPACE_HOST_COORDINATION_VERSION
    || !TRANSPORT.test(value.hostKind || "") || !TRANSPORT.test(value.transport || "")
    || value.providerNeutral !== true || value.tuiScraping !== false
    || value.providerSessionIdentityPersisted !== false) {
    fail("WorkspaceHostDriver descriptor violates the provider-neutral boundary.", "INVALID_WORKSPACE_HOST_DRIVER");
  }
  return value;
}

function validateDriver(driver) {
  if (!driver || typeof driver !== "object"
    || typeof driver.describe !== "function" || typeof driver.snapshot !== "function" || typeof driver.send !== "function") {
    fail("A describe/snapshot/send WorkspaceHostDriver is required.", "INVALID_WORKSPACE_HOST_DRIVER");
  }
  if ("resolveBindingEndpoint" in driver && typeof driver.resolveBindingEndpoint !== "function") {
    fail("WorkspaceHostDriver binding resolution is invalid.", "INVALID_WORKSPACE_HOST_DRIVER");
  }
  const descriptor = driverDescriptor(driver.describe());
  return { driver, descriptor };
}

function validateEndpoint(value) {
  exactFields(value, ["workspaceId", "tabId", "endpointId", "terminalId", "cwd", "runtime"], "WorkspaceHost endpoint");
  const runtime = String(value.runtime || "").toLowerCase();
  if (![value.workspaceId, value.tabId, value.endpointId, value.terminalId].every((item) => ID.test(String(item || "")))
    || typeof value.cwd !== "string" || !path.isAbsolute(value.cwd) || !RUNTIMES.has(runtime)) {
    fail("WorkspaceHost endpoint identity is invalid.", "INVALID_WORKSPACE_HOST_SNAPSHOT");
  }
  return { ...value, runtime };
}

function validateSnapshot(value, descriptor) {
  exactFields(value, [
    "schemaVersion", "kind", "protocol", "hostKind", "transport", "hostInstanceId", "snapshotSequence", "endpoints",
  ], "WorkspaceHost snapshot");
  exactFields(value.protocol, ["name", "version"], "WorkspaceHost snapshot protocol");
  if (value.schemaVersion !== 1 || value.kind !== "WorkspaceHostSnapshot"
    || value.protocol.name !== "head-agent-core-workspace-host-snapshot"
    || value.protocol.version !== WORKSPACE_HOST_COORDINATION_VERSION
    || value.hostKind !== descriptor.hostKind || value.transport !== descriptor.transport
    || !ID.test(value.hostInstanceId || "") || !ID.test(value.snapshotSequence || "") || !Array.isArray(value.endpoints)) {
    fail("WorkspaceHost snapshot boundary is invalid.", "INVALID_WORKSPACE_HOST_SNAPSHOT");
  }
  const endpoints = value.endpoints.map(validateEndpoint);
  const identities = new Set();
  for (const endpoint of endpoints) {
    const identity = canonicalJson([endpoint.workspaceId, endpoint.tabId, endpoint.endpointId, endpoint.terminalId]);
    if (identities.has(identity)) fail("WorkspaceHost snapshot contains a duplicate endpoint.", "INVALID_WORKSPACE_HOST_SNAPSHOT");
    identities.add(identity);
  }
  return { ...value, endpoints };
}

function validateCaller(value) {
  exactFields(value, ["workspaceId", "tabId", "endpointId"], "WorkspaceHost caller");
  return {
    workspaceId: exactId(value.workspaceId, "WorkspaceHost caller workspace"),
    tabId: exactId(value.tabId, "WorkspaceHost caller tab"),
    endpointId: exactId(value.endpointId, "WorkspaceHost caller endpoint"),
  };
}

function validateBoundary(value) {
  exactFields(value, [
    "projectId", "headSessionId", "authorityGeneration", "role", "bindingId", "projectRoot",
  ], "WorkspaceHost coordination boundary");
  const role = String(value.role || "");
  if (!ROLE.test(role)) fail("WorkspaceHost coordination role is invalid.", "INVALID_WORKSPACE_HOST_BOUNDARY");
  return {
    projectId: exactId(value.projectId, "Project identity"),
    headSessionId: exactId(value.headSessionId, "HEAD Session identity"),
    authorityGeneration: exactId(value.authorityGeneration, "Coordination generation"),
    role,
    bindingId: exactId(value.bindingId, "Coordination binding"),
    projectRoot: directCanonicalDirectory(value.projectRoot, "Project root"),
  };
}

function exactEndpoint(snapshot, caller) {
  const matches = snapshot.endpoints.filter((endpoint) => endpoint.workspaceId === caller.workspaceId
    && endpoint.tabId === caller.tabId && endpoint.endpointId === caller.endpointId);
  if (matches.length !== 1) return null;
  return matches[0];
}

function attachmentPayload({ descriptor, snapshot, endpoint, boundary }) {
  return {
    schemaVersion: 1,
    kind: "WorkspaceHostAttachmentEvidence",
    protocol: { name: "head-agent-core-workspace-host-attachment", version: WORKSPACE_HOST_COORDINATION_VERSION },
    projectId: boundary.projectId,
    headSessionId: boundary.headSessionId,
    authorityGeneration: boundary.authorityGeneration,
    role: boundary.role,
    bindingId: boundary.bindingId,
    hostKind: descriptor.hostKind,
    transport: descriptor.transport,
    hostInstanceId: snapshot.hostInstanceId,
    workspaceId: endpoint.workspaceId,
    tabId: endpoint.tabId,
    endpointId: endpoint.endpointId,
    terminalId: endpoint.terminalId,
    cwd: endpoint.cwd,
    runtime: endpoint.runtime,
    snapshotSequence: snapshot.snapshotSequence,
    providerSessionIdentityPersisted: false,
    instructionAuthority: false,
    promotionAuthority: false,
    controlAuthority: false,
    mutatesCanon: false,
  };
}

function identifyAttachment(payload) {
  const attachmentHash = digest(canonicalJson(payload));
  return { ...payload, attachmentId: `workspace-attachment-${attachmentHash.slice(0, 32)}`, attachmentHash };
}

function validateAttachment(value, boundary = null) {
  exactFields(value, [
    "schemaVersion", "kind", "protocol", "projectId", "headSessionId", "authorityGeneration", "role", "bindingId",
    "hostKind", "transport", "hostInstanceId", "workspaceId", "tabId", "endpointId", "terminalId", "cwd", "runtime",
    "snapshotSequence", "providerSessionIdentityPersisted", "instructionAuthority", "promotionAuthority", "controlAuthority",
    "mutatesCanon", "attachmentId", "attachmentHash",
  ], "WorkspaceHost attachment evidence");
  const payload = { ...value };
  delete payload.attachmentId;
  delete payload.attachmentHash;
  const expected = identifyAttachment(payload);
  if (value.schemaVersion !== 1 || value.kind !== "WorkspaceHostAttachmentEvidence"
    || value.protocol?.name !== "head-agent-core-workspace-host-attachment"
    || value.protocol?.version !== WORKSPACE_HOST_COORDINATION_VERSION
    || value.attachmentId !== expected.attachmentId || value.attachmentHash !== expected.attachmentHash
    || value.providerSessionIdentityPersisted !== false || value.instructionAuthority !== false
    || value.promotionAuthority !== false || value.controlAuthority !== false || value.mutatesCanon !== false
    || !ROLE.test(value.role || "") || !RUNTIMES.has(value.runtime)) {
    fail("WorkspaceHost attachment evidence failed verification.", "INVALID_WORKSPACE_HOST_ATTACHMENT");
  }
  if (boundary && ["projectId", "headSessionId", "authorityGeneration", "role", "bindingId"].some((key) => value[key] !== boundary[key])) {
    fail("WorkspaceHost attachment belongs to another coordination boundary.", "STALE_WORKSPACE_HOST_ATTACHMENT");
  }
  return value;
}

function endpointMatchesAttachment(snapshot, attachment) {
  if (snapshot.hostInstanceId !== attachment.hostInstanceId) return null;
  const endpoint = exactEndpoint(snapshot, attachment);
  if (!endpoint) return null;
  return endpoint.terminalId === attachment.terminalId && endpoint.cwd === attachment.cwd
    && endpoint.runtime === attachment.runtime ? endpoint : null;
}

function validateBindingEndpointResolution(value, boundary) {
  exactFields(value, ["status", "bindingId", "hostInstanceId", "snapshotSequence", "endpoint"], "WorkspaceHost binding endpoint resolution");
  if (!new Set(["resolved", "unavailable"]).has(value.status)
    || value.bindingId !== boundary.bindingId || !ID.test(value.hostInstanceId || "") || !ID.test(value.snapshotSequence || "")
    || value.status === "unavailable" && value.endpoint !== null
    || value.status === "resolved" && value.endpoint === null) {
    fail("WorkspaceHost binding endpoint resolution violates the coordination boundary.", "INVALID_WORKSPACE_HOST_BINDING_RESOLUTION");
  }
  return { ...value, endpoint: value.endpoint === null ? null : validateEndpoint(value.endpoint) };
}

function validateDeliveryMessage(message, boundary) {
  if (!message || message.projectId !== boundary.projectId || message.headSessionId !== boundary.headSessionId
    || message.authorityGeneration !== boundary.authorityGeneration || message.toRole !== boundary.role
    || !ID.test(message.messageId || "") || message.instructionAuthority !== false || message.decisionAuthority !== false
    || message.promotionAuthority !== false || message.canonMutationAuthority !== false
    || message.reviewAuthority !== false || message.executionAuthorizationAuthority !== false) {
    fail("WorkspaceHost delivery message violates the coordination boundary.", "INVALID_WORKSPACE_HOST_MESSAGE");
  }
  return message;
}

function boundedNotification(message) {
  const content = String(message.content || "").replace(/[\r\n]+/g, " ").trim();
  const text = `[HEAD coordination evidence only; from ${message.fromRole}; msg:${message.messageId}] ${content}`;
  return Buffer.from(text, "utf8").subarray(0, MAX_NOTIFICATION_BYTES).toString("utf8");
}

export class VerifiedWorkspaceHostAdapter {
  constructor({ driver } = {}) {
    const validated = validateDriver(driver);
    this.driver = validated.driver;
    this.driverDescriptor = validated.descriptor;
    validateWorkspaceHostAdapter(this);
  }

  describe() { return verifiedWorkspaceHostDescriptor(); }
  probe() { return buildWorkspaceHostProbe(this.describe()); }

  attach({ caller, boundary } = {}) {
    const verifiedCaller = validateCaller(caller);
    const verifiedBoundary = validateBoundary(boundary);
    const snapshot = validateSnapshot(this.driver.snapshot(), this.driverDescriptor);
    const endpoint = exactEndpoint(snapshot, verifiedCaller);
    if (!endpoint) fail("The host caller is not one exact live endpoint.", "STALE_WORKSPACE_HOST_CALLER");
    const endpointCwd = directCanonicalDirectory(endpoint.cwd, "WorkspaceHost endpoint CWD");
    if (!isWithin(verifiedBoundary.projectRoot, endpointCwd)) {
      fail("The host caller endpoint is outside the exact project root.", "WORKSPACE_HOST_PROJECT_MISMATCH");
    }
    return identifyAttachment(attachmentPayload({
      descriptor: this.driverDescriptor,
      snapshot,
      endpoint: { ...endpoint, cwd: endpointCwd },
      boundary: verifiedBoundary,
    }));
  }

  sendToBinding({ boundary, message } = {}) {
    const verifiedBoundary = validateBoundary(boundary);
    const verifiedMessage = validateDeliveryMessage(message, verifiedBoundary);
    if (typeof this.driver.resolveBindingEndpoint !== "function") {
      return { status: "unavailable", targetBindingId: verifiedBoundary.bindingId, attachmentId: null };
    }
    const resolution = validateBindingEndpointResolution(
      this.driver.resolveBindingEndpoint({ bindingId: verifiedBoundary.bindingId }),
      verifiedBoundary,
    );
    if (resolution.status !== "resolved") {
      return { status: "unavailable", targetBindingId: verifiedBoundary.bindingId, attachmentId: null };
    }
    const snapshot = validateSnapshot(this.driver.snapshot(), this.driverDescriptor);
    const matches = snapshot.endpoints.filter((endpoint) => canonicalJson(endpoint) === canonicalJson(resolution.endpoint));
    if (snapshot.hostInstanceId !== resolution.hostInstanceId || snapshot.snapshotSequence !== resolution.snapshotSequence
      || matches.length !== 1) {
      return { status: "unavailable", targetBindingId: verifiedBoundary.bindingId, attachmentId: null };
    }
    const endpointCwd = directCanonicalDirectory(resolution.endpoint.cwd, "WorkspaceHost endpoint CWD");
    if (!isWithin(verifiedBoundary.projectRoot, endpointCwd)) {
      fail("The resolved host endpoint is outside the exact project root.", "WORKSPACE_HOST_PROJECT_MISMATCH");
    }
    const attachment = identifyAttachment(attachmentPayload({
      descriptor: this.driverDescriptor,
      snapshot,
      endpoint: { ...resolution.endpoint, cwd: endpointCwd },
      boundary: verifiedBoundary,
    }));
    return this.send({ attachment, boundary: verifiedBoundary, message: verifiedMessage });
  }

  send({ attachment, boundary, message } = {}) {
    const verifiedBoundary = validateBoundary(boundary);
    const verifiedAttachment = validateAttachment(attachment, verifiedBoundary);
    const verifiedMessage = validateDeliveryMessage(message, verifiedBoundary);
    const before = validateSnapshot(this.driver.snapshot(), this.driverDescriptor);
    const endpoint = endpointMatchesAttachment(before, verifiedAttachment);
    if (!endpoint) return { status: "unavailable", targetBindingId: verifiedBoundary.bindingId, attachmentId: verifiedAttachment.attachmentId };
    let acknowledgement;
    try {
      acknowledgement = this.driver.send({
        endpoint: { ...endpoint },
        targetBindingId: verifiedBoundary.bindingId,
        messageId: verifiedMessage.messageId,
        text: boundedNotification(verifiedMessage),
      });
    } catch {
      return { status: "ambiguous", targetBindingId: verifiedBoundary.bindingId, attachmentId: verifiedAttachment.attachmentId };
    }
    const after = validateSnapshot(this.driver.snapshot(), this.driverDescriptor);
    const afterEndpoint = endpointMatchesAttachment(after, verifiedAttachment);
    const acknowledged = acknowledgement && acknowledgement.status === "delivered"
      && acknowledgement.messageId === message.messageId
      && acknowledgement.hostInstanceId === verifiedAttachment.hostInstanceId
      && acknowledgement.workspaceId === verifiedAttachment.workspaceId
      && acknowledgement.tabId === verifiedAttachment.tabId
      && acknowledgement.endpointId === verifiedAttachment.endpointId
      && acknowledgement.terminalId === verifiedAttachment.terminalId;
    return {
      status: acknowledged && afterEndpoint ? "delivered" : "ambiguous",
      targetBindingId: verifiedBoundary.bindingId,
      attachmentId: verifiedAttachment.attachmentId,
    };
  }

  receive({ attachment, boundary } = {}) {
    const verifiedBoundary = validateBoundary(boundary);
    const verifiedAttachment = validateAttachment(attachment, verifiedBoundary);
    const snapshot = validateSnapshot(this.driver.snapshot(), this.driverDescriptor);
    return {
      status: endpointMatchesAttachment(snapshot, verifiedAttachment) ? "attached" : "unavailable",
      attachmentId: verifiedAttachment.attachmentId,
      targetBindingId: verifiedBoundary.bindingId,
    };
  }

  detach({ attachment, boundary } = {}) {
    const verifiedBoundary = validateBoundary(boundary);
    const verifiedAttachment = validateAttachment(attachment, verifiedBoundary);
    const snapshot = validateSnapshot(this.driver.snapshot(), this.driverDescriptor);
    return {
      status: "detached",
      attachmentId: verifiedAttachment.attachmentId,
      endpointWasLive: !!endpointMatchesAttachment(snapshot, verifiedAttachment),
      targetBindingId: verifiedBoundary.bindingId,
    };
  }
}
