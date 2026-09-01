import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { inspectProject, SCHEMA_VERSION } from "./head-core.mjs";
import {
  OBSERVATION_PROTOCOL_VERSION,
  createDerivedObservationRecord,
  createObservationRecord,
  createObservationTypeDescriptor,
  observationCanonicalJson,
  observationDigest,
  verifyDerivedObservationRecord,
  verifyObservationRecord,
  verifyObservationTypeDescriptor,
} from "./observation-contract.mjs";

export const OBSERVATION_DESCRIPTOR_DIRECTORY = ".head/observations/descriptors";
export const OBSERVATION_RECORD_DIRECTORY = ".head/observations/records/by-source-key";
export const DERIVED_OBSERVATION_DIRECTORY = ".head/observations/derived";
export const OBSERVATION_RECEIPT_DIRECTORY = ".head/observations/receipts";

const LIMITS = Object.freeze({ maxArtifacts: 4096, maxArtifactBytes: 1024 * 1024, maxTotalBytes: 64 * 1024 * 1024 });
const fail = (message, code = "OBSERVATION_STORE_ERROR") => { const error = new Error(message); error.code = code; throw error; };
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function safeDirectory(projectRoot, relative) {
  const root = path.resolve(projectRoot);
  const directory = path.resolve(root, ...relative.split("/"));
  const fromRoot = path.relative(root, directory);
  if (fromRoot === ".." || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) fail("Observation path escapes project root.", "OBSERVATION_PATH_ESCAPE");
  let current = root;
  for (const segment of fromRoot.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) fail("Observation path traverses a symlink.", "OBSERVATION_SYMLINK_PATH");
  }
  return directory;
}

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
  try { fs.writeFileSync(temporary, content, { encoding: "utf8", flag: "wx" }); fs.renameSync(temporary, file); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

function persistCreateOnly(projectRoot, relative, fileName, document, divergentCode = "OBSERVATION_IMMUTABLE_COLLISION") {
  const file = path.join(safeDirectory(projectRoot, relative), fileName);
  if (fs.existsSync(file)) {
    const existing = JSON.parse(fs.readFileSync(file, "utf8"));
    if (observationCanonicalJson(existing) !== observationCanonicalJson(document)) fail(`Create-only Observation key has divergent content: ${fileName}`, divergentCode);
    return { status: "existing", file };
  }
  atomicWrite(file, json(document));
  return { status: "recorded", file };
}

function readDirectory(projectRoot, relative, label) {
  const directory = safeDirectory(projectRoot, relative);
  if (!fs.existsSync(directory)) return [];
  const entries = fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".json")).sort((a, b) => a.name.localeCompare(b.name));
  if (entries.length > LIMITS.maxArtifacts) fail(`${label} count exceeds its bound.`, "OBSERVATION_STORE_LIMIT");
  let totalBytes = 0;
  return entries.map((entry) => {
    const file = path.join(directory, entry.name);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > LIMITS.maxArtifactBytes) fail(`${label} artifact is unsafe or too large.`, "OBSERVATION_STORE_LIMIT");
    totalBytes += stat.size;
    if (totalBytes > LIMITS.maxTotalBytes) fail(`${label} total bytes exceed its bound. Use bounded source aggregation.`, "OBSERVATION_STORE_LIMIT");
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { fail(`${label} contains invalid JSON: ${error.message}`, "INVALID_OBSERVATION_ARTIFACT"); }
  });
}

function readyProject(root) {
  const inspected = inspectProject(root);
  if (inspected.status !== "ready") fail(`Project must be ready for Observation use; current status: ${inspected.status}.`, "PROJECT_NOT_READY");
  return inspected;
}

function receiptIdentity(payload) {
  const hash = observationDigest(payload);
  return { ...payload, receiptId: `observation-receipt-${hash.slice(0, 24)}`, receiptHash: hash };
}

export function verifyObservationCollectionReceipt(document, projectId = "") {
  if (!document || typeof document !== "object" || Array.isArray(document)) fail("ObservationCollectionReceipt is invalid.", "INVALID_OBSERVATION_RECEIPT");
  const expectedFields = ["schemaVersion", "kind", "protocol", "projectId", "observationId", "observationHash", "descriptorId", "adapterKey", "adapterVersion", "adapterDescriptorDigest", "sourceScopeDigest", "authority", "instructionAuthority", "promotionAuthority", "recoveryAuthority", "receiptId", "receiptHash"].sort();
  if (observationCanonicalJson(Object.keys(document).sort()) !== observationCanonicalJson(expectedFields)
    || observationCanonicalJson(Object.keys(document.protocol || {}).sort()) !== observationCanonicalJson(["name", "version"])) fail("ObservationCollectionReceipt fields are invalid.", "INVALID_OBSERVATION_RECEIPT");
  const payload = { ...document }; delete payload.receiptId; delete payload.receiptHash;
  const hash = observationDigest(payload);
  if (document.receiptId !== `observation-receipt-${hash.slice(0, 24)}` || document.receiptHash !== hash
    || document.schemaVersion !== SCHEMA_VERSION || document.kind !== "ObservationCollectionReceipt"
    || document.protocol?.name !== "head-agent-core-observation" || document.protocol?.version !== OBSERVATION_PROTOCOL_VERSION
    || projectId && document.projectId !== projectId || !/^observation-[a-f0-9]{24}$/.test(document.observationId || "")
    || !/^observation-type-[a-f0-9]{24}$/.test(document.descriptorId || "") || !/^[a-f0-9]{64}$/.test(document.observationHash || "")
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(document.adapterKey || "") || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(document.adapterVersion || "")
    || !/^[a-f0-9]{64}$/.test(document.adapterDescriptorDigest || "") || !/^[a-f0-9]{64}$/.test(document.sourceScopeDigest || "")
    || document.authority !== "collection-evidence-not-source-or-product-authority" || document.instructionAuthority !== false
    || document.promotionAuthority !== false || document.recoveryAuthority !== false) fail("ObservationCollectionReceipt fields or authority are invalid.", "INVALID_OBSERVATION_RECEIPT");
  return document;
}

function descriptorMap(descriptors) {
  const map = new Map();
  for (const descriptor of descriptors) {
    verifyObservationTypeDescriptor(descriptor);
    if (map.has(descriptor.descriptorId)) fail("Duplicate ObservationTypeDescriptor.", "DUPLICATE_OBSERVATION_DESCRIPTOR");
    map.set(descriptor.descriptorId, descriptor);
  }
  return map;
}

export function loadObservationArtifacts({ projectRoot, projectId } = {}) {
  const descriptors = readDirectory(projectRoot, OBSERVATION_DESCRIPTOR_DIRECTORY, "ObservationTypeDescriptor");
  const descriptorsById = descriptorMap(descriptors);
  const observations = readDirectory(projectRoot, OBSERVATION_RECORD_DIRECTORY, "ObservationRecord").map((record) => {
    const descriptor = descriptorsById.get(record.descriptorId);
    if (!descriptor) fail("ObservationRecord references an unknown descriptor.", "UNKNOWN_OBSERVATION_DESCRIPTOR");
    return verifyObservationRecord(record, descriptor, projectId);
  });
  const observationIds = new Map();
  const sourceKeys = new Map();
  for (const record of observations) {
    if (observationIds.has(record.observationId)) fail("Duplicate ObservationRecord.", "DUPLICATE_OBSERVATION_RECORD");
    const existing = sourceKeys.get(record.source.sourceEventKeyDigest);
    if (existing && existing !== record.observationId) fail("Observation source key has divergent records.", "DIVERGENT_OBSERVATION_REPLAY");
    observationIds.set(record.observationId, record);
    sourceKeys.set(record.source.sourceEventKeyDigest, record.observationId);
  }
  const derivedObservations = readDirectory(projectRoot, DERIVED_OBSERVATION_DIRECTORY, "DerivedObservationRecord").map((record) => {
    const descriptor = descriptorsById.get(record.descriptorId);
    if (!descriptor) fail("DerivedObservationRecord references an unknown descriptor.", "UNKNOWN_OBSERVATION_DESCRIPTOR");
    verifyDerivedObservationRecord(record, descriptor, projectId);
    for (const input of record.inputObservations) {
      const source = observationIds.get(input.observationId);
      if (!source || source.observationHash !== input.observationHash) fail("DerivedObservationRecord input is missing or changed.", "DERIVED_OBSERVATION_INPUT_MISMATCH");
    }
    return record;
  });
  const receipts = readDirectory(projectRoot, OBSERVATION_RECEIPT_DIRECTORY, "ObservationCollectionReceipt").map((receipt) => verifyObservationCollectionReceipt(receipt, projectId));
  const receiptObservationIds = new Set();
  for (const receipt of receipts) {
    const record = observationIds.get(receipt.observationId);
    if (!record || record.observationHash !== receipt.observationHash || record.descriptorId !== receipt.descriptorId) fail("ObservationCollectionReceipt lineage is invalid.", "INVALID_OBSERVATION_RECEIPT_LINEAGE");
    if (receiptObservationIds.has(receipt.observationId)) fail("ObservationRecord has multiple collection receipts.", "DUPLICATE_OBSERVATION_RECEIPT");
    receiptObservationIds.add(receipt.observationId);
  }
  for (const record of observations) if (!receiptObservationIds.has(record.observationId)) fail("ObservationRecord lacks its collection receipt.", "OBSERVATION_RECEIPT_MISSING");
  return {
    descriptors: descriptors.sort((a, b) => a.descriptorId.localeCompare(b.descriptorId)),
    observations: observations.sort((a, b) => a.observationId.localeCompare(b.observationId)),
    derivedObservations: derivedObservations.sort((a, b) => a.derivedObservationId.localeCompare(b.derivedObservationId)),
    receipts: receipts.sort((a, b) => a.receiptId.localeCompare(b.receiptId)),
  };
}

export function registerObservationType({ root = ".", descriptor } = {}) {
  const inspected = readyProject(root);
  const normalized = descriptor?.kind === "ObservationTypeDescriptor" ? verifyObservationTypeDescriptor(descriptor) : createObservationTypeDescriptor(descriptor);
  const persisted = persistCreateOnly(inspected.project.projectRoot, OBSERVATION_DESCRIPTOR_DIRECTORY, `${normalized.descriptorId}.json`, normalized);
  return { ...persisted, descriptor: normalized };
}

export function recordCollectedObservation({ root = ".", descriptor, input, adapterDescriptor, sourceScopeDigest } = {}) {
  const inspected = readyProject(root);
  const registered = registerObservationType({ root: inspected.project.projectRoot, descriptor }).descriptor;
  const record = createObservationRecord({
    projectId: inspected.project.projectId,
    descriptor: registered,
    subject: input.subject,
    form: input.form,
    temporalScope: input.temporalScope,
    coverage: input.coverage,
    payload: input.payload,
    source: {
      adapterKey: adapterDescriptor.adapterKey,
      adapterVersion: adapterDescriptor.adapterVersion,
      sourceScopeDigest,
      sourceEventKeyDigest: input.sourceEventKeyDigest,
      sourceEvidenceDigest: input.sourceEvidenceDigest,
    },
  });
  const recordPersisted = persistCreateOnly(inspected.project.projectRoot, OBSERVATION_RECORD_DIRECTORY, `${record.source.sourceEventKeyDigest}.json`, record, "DIVERGENT_OBSERVATION_REPLAY");
  const receiptPayload = {
    schemaVersion: SCHEMA_VERSION,
    kind: "ObservationCollectionReceipt",
    protocol: { name: "head-agent-core-observation", version: OBSERVATION_PROTOCOL_VERSION },
    projectId: inspected.project.projectId,
    observationId: record.observationId,
    observationHash: record.observationHash,
    descriptorId: registered.descriptorId,
    adapterKey: adapterDescriptor.adapterKey,
    adapterVersion: adapterDescriptor.adapterVersion,
    adapterDescriptorDigest: observationDigest(adapterDescriptor),
    sourceScopeDigest,
    authority: "collection-evidence-not-source-or-product-authority",
    instructionAuthority: false,
    promotionAuthority: false,
    recoveryAuthority: false,
  };
  const receipt = verifyObservationCollectionReceipt(receiptIdentity(receiptPayload), inspected.project.projectId);
  const receiptPersisted = persistCreateOnly(inspected.project.projectRoot, OBSERVATION_RECEIPT_DIRECTORY, `${receipt.receiptId}.json`, receipt);
  return { status: recordPersisted.status === "existing" && receiptPersisted.status === "existing" ? "existing" : "recorded", descriptor: registered, observation: record, receipt };
}

export function recordDerivedObservation({ root = ".", descriptor, input } = {}) {
  const inspected = readyProject(root);
  const registered = registerObservationType({ root: inspected.project.projectRoot, descriptor }).descriptor;
  const current = loadObservationArtifacts({ projectRoot: inspected.project.projectRoot, projectId: inspected.project.projectId });
  const byId = new Map(current.observations.map((record) => [record.observationId, record]));
  const inputs = (input.inputObservationIds || []).map((id) => {
    const record = byId.get(id);
    if (!record) fail(`Derived Observation input not found: ${id}`, "OBSERVATION_NOT_FOUND");
    return { observationId: record.observationId, observationHash: record.observationHash };
  });
  const derived = createDerivedObservationRecord({ projectId: inspected.project.projectId, descriptor: registered, subject: input.subject, temporalScope: input.temporalScope, inputObservations: inputs, algorithm: input.algorithm, coverage: input.coverage, payload: input.payload });
  const persisted = persistCreateOnly(inspected.project.projectRoot, DERIVED_OBSERVATION_DIRECTORY, `${derived.derivedObservationId}.json`, derived);
  return { ...persisted, descriptor: registered, derivedObservation: derived };
}

export function readObservation({ root = ".", observationId } = {}) {
  const inspected = readyProject(root);
  const artifacts = loadObservationArtifacts({ projectRoot: inspected.project.projectRoot, projectId: inspected.project.projectId });
  const observation = artifacts.observations.find((item) => item.observationId === observationId) || null;
  const derivedObservation = artifacts.derivedObservations.find((item) => item.derivedObservationId === observationId) || null;
  if (!observation && !derivedObservation) fail(`Observation not found: ${observationId}`, "OBSERVATION_NOT_FOUND");
  return { status: "verified", projectId: inspected.project.projectId, observation: observation || derivedObservation };
}
