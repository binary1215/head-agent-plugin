import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { LEGACY_FORMAT, PROTOCOL_PAIRS, KIND_PAIRS, VALUE_PAIRS } from "../../compat/head/format.mjs";

const lodeFormat = Object.freeze({ dialect: "lode", directory: ".lode", projectPrefix: "lode-", roleField: "lode", sessionIdField: "lodeSessionId",
  protocol: value => Object.hasOwn(PROTOCOL_PAIRS, value) ? PROTOCOL_PAIRS[value] : value,
  kind: value => Object.hasOwn(KIND_PAIRS, value) ? KIND_PAIRS[value] : value,
  value: value => Object.hasOwn(VALUE_PAIRS, value) ? VALUE_PAIRS[value] : value });
const markerBases = new WeakMap();
const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const fail = (message, code) => { throw Object.assign(new Error(message), { code }); };

// Pure callers must carry the tuple from upper selection. A bare ID or a
// historical Project object never selects a new dialect, even with a lode ID.
export function formatForVerifiedOwner(owner) {
  const storage = owner?.storage ?? owner;
  if (!storage || typeof storage !== "object" || storage.dialect === undefined) return LEGACY_FORMAT;
  if (storage.dialect === "head" && storage.directory === ".head") return LEGACY_FORMAT;
  if (storage.dialect === "lode" && storage.directory === ".lode") return lodeFormat;
  fail("Project storage tuple is inconsistent.", "PROJECT_IDENTITY_MISMATCH");
}

export function relativeProjectArtifact(owner, ...neutralSegments) {
  return [formatForVerifiedOwner(owner).directory, ...neutralSegments].join("/");
}

// Select the original wire family without changing any original object. The
// owning verifier still checks its original version, strict shape and digest.
export function familyFormatForOriginal(family, record, expectedOwner) {
  if (family?.sessionIdentity === true && record && typeof record === "object") {
    const hasLegacy = Object.hasOwn(record, "headSessionId"), hasLode = Object.hasOwn(record, "lodeSessionId");
    if (hasLegacy && hasLode) return null;
    const format = hasLode ? lodeFormat : hasLegacy ? LEGACY_FORMAT : formatForVerifiedOwner(expectedOwner);
    return expectedOwner != null && formatForVerifiedOwner(expectedOwner).dialect !== format.dialect ? null : format;
  }
  if (family && typeof family === "object" && family.kind && record && typeof record === "object") {
    const hasLegacy = Object.hasOwn(record, "headSessionId"), hasLode = Object.hasOwn(record, "lodeSessionId");
    if (hasLegacy && hasLode) return null;
    const brandedKind = Object.hasOwn(KIND_PAIRS, family.kind) && record.kind === KIND_PAIRS[family.kind];
    const format = hasLode || brandedKind ? lodeFormat : hasLegacy ? LEGACY_FORMAT : formatForVerifiedOwner(expectedOwner);
    if (record.kind !== format.kind(family.kind)) return null;
    if (expectedOwner != null && formatForVerifiedOwner(expectedOwner).dialect !== format.dialect) return null;
    return format;
  }
  const legacy = typeof family === "string" ? family : family?.legacy;
  const canonical = typeof family === "string" ? Object.hasOwn(PROTOCOL_PAIRS, family) ? PROTOCOL_PAIRS[family] : null : family?.lode;
  if (!legacy || !canonical || !record || typeof record !== "object") return null;
  const originalProtocol = typeof record.protocol === "string" ? record.protocol : record.protocol?.name;
  const format = originalProtocol === legacy ? LEGACY_FORMAT : originalProtocol === canonical ? lodeFormat : null;
  if (!format) return null;
  const opposite = format.dialect === "head" ? "lodeSessionId" : "headSessionId";
  if (Object.hasOwn(record, opposite)) return null;
  if (expectedOwner != null && formatForVerifiedOwner(expectedOwner).dialect !== format.dialect) return null;
  return format;
}

function marker(root, directory) {
  const projectFile = path.join(root, directory, "project.json");
  let bytes;
  try { bytes = fs.readFileSync(projectFile); }
  catch (error) {
    if (error.code === "ENOENT") return { state: "absent", projectFile };
    return { state: "unknown", projectFile, error };
  }
  let project;
  try { project = JSON.parse(bytes.toString("utf8")); }
  catch (error) {
    return { state: "unknown", projectFile, error: Object.assign(new Error(`Project canon is invalid JSON: ${error.message}`), { code: "INVALID_CANON" }) };
  }
  if (directory === ".head") {
    if (project?.schemaVersion !== 1 || project.projectRoot !== root) return { state: "foreign", projectFile, project, bytes };
    return { state: "owned", projectFile, project, bytes };
  }
  const expectedId = `lode-${digest(root).slice(0, 20)}`;
  const branded = project?.schemaVersion === 1 && typeof project.projectId === "string"
    && typeof project.projectRoot === "string"
    && typeof project.authority?.lode === "string" && typeof project.authority?.user === "string";
  const related = project?.projectRoot === root || project?.projectId === expectedId;
  if (!branded || !related) return { state: "foreign", projectFile, project, bytes };
  if (typeof project.createdAt !== "string" || !Number.isFinite(Date.parse(project.createdAt))
    || !Array.isArray(project.runtimes) || !project.runtimes.length || !project.runtimes.every(value => typeof value === "string")
    || !project.integrations || typeof project.integrations !== "object" || Array.isArray(project.integrations)) {
    fail("Recognized Lode Project canon is malformed.", "INVALID_CANON");
  }
  if (project.projectRoot !== root || project.projectId !== expectedId || Object.hasOwn(project.authority, "head")) {
    fail("Project canon does not match this canonical root.", "PROJECT_IDENTITY_MISMATCH");
  }
  for (const candidate of [path.join(root, directory), projectFile]) {
    if (fs.lstatSync(candidate).isSymbolicLink()) fail(`Managed path traverses a symlink: ${candidate}`, "SYMLINK_PATH");
  }
  return { state: "owned", projectFile, project, bytes };
}

// This is the existing upper Project-selection boundary only. It deliberately
// does not read a Session, manifest, World, graph or operational lease.
export function resolveProjectStorage(root = ".", { readLegacyProject } = {}) {
  const projectRoot = fs.realpathSync(path.resolve(root || "."));
  const legacy = marker(projectRoot, ".head");
  const canonical = marker(projectRoot, ".lode");
  if (legacy.state === "owned" && canonical.state === "owned") {
    fail("Two owned Project storage roots conflict.", "PROJECT_STORAGE_CONFLICT");
  }
  const selected = legacy.state === "owned" ? legacy : canonical.state === "owned" ? canonical : null;
  if (!selected) {
    // Preserve the original legacy marker dependency and its diagnostic cause.
    if (legacy.error) {
      if (readLegacyProject) readLegacyProject(legacy.projectFile);
      throw legacy.error;
    }
    if (legacy.state === "foreign") {
      if (readLegacyProject) readLegacyProject(legacy.projectFile);
      fail("Project canon does not match this canonical root.", "PROJECT_IDENTITY_MISMATCH");
    }
    return null;
  }
  // Caller-specific original validation may include its selected Session. It
  // runs only after marker ownership/conflict selection; its failure must never
  // turn an owned Project into an unknown sibling or select another root.
  if (selected === legacy && readLegacyProject) readLegacyProject(legacy.projectFile);
  const dialect = selected === legacy ? "head" : "lode";
  const storage = Object.freeze({ projectRoot, projectId: selected.project.projectId, dialect,
    directory: dialect === "head" ? ".head" : ".lode", projectFile: selected.projectFile });
  markerBases.set(storage, digest(selected.bytes));
  return storage;
}

export function assertProjectStorageUnchanged(storage) {
  if (!storage || !markerBases.has(storage)) fail("Expected the selected Project storage basis.", "PROJECT_IDENTITY_MISMATCH");
  // Re-read the selected original first: a known owned failure cannot silently
  // become another dialect or an absent/default Project after selection.
  const bytes = fs.readFileSync(storage.projectFile);
  if (digest(bytes) !== markerBases.get(storage)) fail("Project storage changed during the operation.", "PROJECT_IDENTITY_MISMATCH");
  const current = resolveProjectStorage(storage.projectRoot);
  if (!current || current.dialect !== storage.dialect || current.projectId !== storage.projectId) {
    fail("Project storage changed during the operation.", "PROJECT_IDENTITY_MISMATCH");
  }
  return storage;
}
