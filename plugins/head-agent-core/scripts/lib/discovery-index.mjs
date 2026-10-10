import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { atomicWriteArtifact } from "./artifact-storage.mjs";
import { artifactAuthorityBoundary } from "./authority-plane-contract.mjs";

// A replaceable inventory of original records, not a second record store. No
// bodies, decisions, credentials or provider handles are copied into the index.
export const PROJECT_GRAPH_INDEX_PATH = ".head/graph-discovery/index.json";
export const PROJECT_GRAPH_RECORD_DIRECTORIES = Object.freeze([
  ".head/observations", ".head/lineage", ".head/onboarding/candidate-sets",
  ".head/onboarding/review-decisions", ".head/onboarding/product-model-revisions",
  ".head/product-policy", ".head/change-sets", ".head/release-observations",
  ".head/conformance", ".head/sessions/records", ".head/sessions/by-id",
  ".head/sessions/ledger", ".head/sessions/runs", ".head/project-direction/revisions",
]);
const singletonPaths = [".head/context/product-model.json", ".head/world-model/current.json",
  ".head/sessions/current.json", ".head/project-direction/current.json"];
const MAX_RECORDS = 10000;
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_INVENTORY_BYTES = 128 * 1024 * 1024;
// These are reader inputs, not additional semantic nodes. Include directory
// shape as well as bytes: an empty/unexpected directory or non-JSON file can
// invalidate the historical reader without changing any ordinary record.
const ONBOARDING_READER_DIRECTORIES = [
  ".head/onboarding/historical-boundaries", ".head/onboarding/historical-continuity",
  ".head/onboarding/candidate-sets", ".head/onboarding/review-decisions",
  ".head/onboarding/product-model-revisions",
];
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
export function canonicalGraphJson(value) {
  const sort = (entry) => Array.isArray(entry) ? entry.map(sort) : entry && typeof entry === "object"
    ? Object.fromEntries(Object.keys(entry).sort().map((key) => [key, sort(entry[key])])) : entry;
  return JSON.stringify(sort(value));
}
export const projectGraphDigest = (value) => hash(typeof value === "string" || Buffer.isBuffer(value) ? value : canonicalGraphJson(value));
const fail = (code) => { const error = new Error(code); error.code = code; throw error; };

export function safeGraphFile(root, relative) {
  if (typeof relative !== "string" || !relative || relative.includes("\\") || relative.split("/").some((part) => !part || part === "." || part === "..")) fail("PROJECT_GRAPH_PATH_ESCAPE");
  const target = path.resolve(root, relative);
  if (path.relative(root, target).startsWith("..") || path.isAbsolute(path.relative(root, target))) fail("PROJECT_GRAPH_PATH_ESCAPE");
  let current = root;
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) fail("PROJECT_GRAPH_SYMLINK_PATH");
  }
  return target;
}

export function readGraphProject(root) {
  const projectRoot = fs.realpathSync(path.resolve(root));
  const file = safeGraphFile(projectRoot, ".head/project.json");
  if (!fs.existsSync(file)) return { projectRoot, project: null };
  const project = JSON.parse(fs.readFileSync(file, "utf8"));
  if (project.schemaVersion !== 1 || project.projectRoot !== projectRoot || !/^head-[a-f0-9]{20}$/.test(project.projectId || "")) fail("PROJECT_IDENTITY_MISMATCH");
  return { projectRoot, project };
}

export function readGraphRecord(root, relative, maximum = MAX_BYTES) {
  const file = safeGraphFile(root, relative);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size > maximum) fail("PROJECT_GRAPH_RECORD_LIMIT");
  const bytes = fs.readFileSync(file);
  if (bytes.length > maximum) fail("PROJECT_GRAPH_RECORD_LIMIT");
  return { document: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), bytes, digest: hash(bytes) };
}

export function collectProjectGraphInventory(root) {
  const { projectRoot, project } = readGraphProject(root);
  if (!project) return { projectRoot, project, entries: [], unavailable: [], complete: false, recordsDigest: null };
  const entries = [], unavailable = [];
  let complete = true, examinedBytes = 0;
  const add = (relative) => {
    if (relative.startsWith(".head/sessions/by-id/") && !/^\.head\/sessions\/by-id\/session-[a-fA-F0-9-]{36}\/current\.json$/.test(relative)) return;
    if (relative.startsWith(".head/sessions/runs/") && !relative.endsWith("/run.json")) return;
    if (entries.length >= MAX_RECORDS) { complete = false; return; }
    try {
      const file = safeGraphFile(projectRoot, relative);
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.size > MAX_BYTES) fail("PROJECT_GRAPH_RECORD_LIMIT");
      if (examinedBytes + stat.size > MAX_INVENTORY_BYTES) { complete = false; return; }
      examinedBytes += stat.size;
      // Byte hashing, never mtime alone, detects tampering even on unchanged
      // stat metadata. Unchanged records reuse verification/analysis later.
      entries.push({ path: relative, sha256: hash(fs.readFileSync(file)), bytes: stat.size });
    } catch (error) { unavailable.push({ path: relative, reasonCode: error.code || "PROJECT_GRAPH_RECORD_UNAVAILABLE" }); }
  };
  const visit = (relative, depth = 0) => {
    if (entries.length >= MAX_RECORDS || depth > 8) { complete = false; return; }
    try {
      const directory = safeGraphFile(projectRoot, relative);
      if (!fs.existsSync(directory)) return;
      for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isSymbolicLink()) { unavailable.push({ path: `${relative}/${entry.name}`, reasonCode: "PROJECT_GRAPH_SYMLINK_PATH" }); continue; }
        if (entry.isDirectory()) visit(`${relative}/${entry.name}`, depth + 1);
        else if (entry.isFile() && entry.name.endsWith(".json")) add(`${relative}/${entry.name}`);
      }
    } catch (error) { unavailable.push({ path: relative, reasonCode: error.code || "PROJECT_GRAPH_DIRECTORY_UNAVAILABLE" }); }
  };
  for (const directory of PROJECT_GRAPH_RECORD_DIRECTORIES) visit(directory);
  for (const relative of singletonPaths) {
    try { if (fs.existsSync(safeGraphFile(projectRoot, relative))) add(relative); }
    catch (error) { unavailable.push({ path: relative, reasonCode: error.code }); }
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  unavailable.sort((a, b) => a.path.localeCompare(b.path));
  const dependencies = { entries: [], layout: [], unavailable: [], complete: true };
  const alreadyHashed = new Map(entries.map((entry) => [entry.path, entry]));
  let dependencyBytes = 0;
  const dependencyFile = (relative) => {
    if (dependencies.entries.some((entry) => entry.path === relative)) return;
    if (alreadyHashed.has(relative)) { dependencies.entries.push(alreadyHashed.get(relative)); return; }
    try {
      const file = safeGraphFile(projectRoot, relative), stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.size > MAX_BYTES || dependencyBytes + stat.size > MAX_INVENTORY_BYTES
        || dependencies.entries.length >= MAX_RECORDS) fail("PROJECT_GRAPH_DEPENDENCY_LIMIT");
      dependencyBytes += stat.size;
      dependencies.entries.push({ path: relative, sha256: hash(fs.readFileSync(file)), bytes: stat.size });
    } catch (error) { dependencies.unavailable.push({ path: relative, reasonCode: error.code || "PROJECT_GRAPH_DEPENDENCY_UNAVAILABLE" }); }
  };
  const dependencyDirectory = (relative, depth = 0) => {
    if (depth > 8 || dependencies.layout.length >= MAX_RECORDS) { dependencies.complete = false; return; }
    try {
      const directory = safeGraphFile(projectRoot, relative);
      if (!fs.existsSync(directory)) { dependencies.layout.push({ path: relative, type: "absent" }); return; }
      if (!fs.lstatSync(directory).isDirectory()) fail("PROJECT_GRAPH_DEPENDENCY_DIRECTORY_INVALID");
      dependencies.layout.push({ path: relative, type: "directory" });
      for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (dependencies.layout.length >= MAX_RECORDS) { dependencies.complete = false; break; }
        const child = `${relative}/${entry.name}`;
        if (entry.isDirectory()) dependencyDirectory(child, depth + 1);
        else {
          dependencies.layout.push({ path: child, type: entry.isSymbolicLink() ? "symlink" : entry.isFile() ? "file" : "other" });
          if (entry.isFile()) dependencyFile(child);
        }
      }
    } catch (error) { dependencies.unavailable.push({ path: relative, reasonCode: error.code || "PROJECT_GRAPH_DEPENDENCY_UNAVAILABLE" }); }
  };
  for (const directory of ONBOARDING_READER_DIRECTORIES) dependencyDirectory(directory);
  // A committed boundary also verifies exact retained World bytes. Read only
  // path references here; the authority-aware reader validates their meaning.
  for (const entry of [...dependencies.entries].filter((entry) => entry.path.endsWith("/boundary.json"))) {
    try {
      const document = readGraphRecord(projectRoot, entry.path).document;
      for (const reference of (Array.isArray(document.entries) ? document.entries : []).slice(0, 512)) {
        if (reference.role === "legacy-world-embedding-reference" && typeof reference.path === "string") dependencyFile(reference.path);
      }
    } catch { /* Malformed boundary is rejected by its original typed reader. */ }
  }
  for (const field of ["entries", "layout", "unavailable"]) dependencies[field].sort((a, b) => a.path.localeCompare(b.path));
  const readerDependencies = { onboarding: dependencies };
  const recordsDigest = projectGraphDigest({ projectId: project.projectId, projectRoot, entries, unavailable, complete, readerDependencies });
  return { projectRoot, project, entries, unavailable, complete, readerDependencies, recordsDigest };
}

export function refreshProjectGraphIndex({ root = "." } = {}) {
  const inventory = collectProjectGraphInventory(root);
  if (!inventory.project) return { status: "not-initialized", ordinaryWorkBlocked: false };
  const payload = { kind: "ProjectGraphRecordIndex", version: 1, projectId: inventory.project.projectId,
    rootDigest: hash(inventory.projectRoot), recordsDigest: inventory.recordsDigest,
    entries: inventory.entries, unavailable: inventory.unavailable, complete: inventory.complete,
    readerDependencies: inventory.readerDependencies,
    authorityBoundary: artifactAuthorityBoundary("ProjectGraphRecordIndex"),
    authority: "P4-replaceable-record-inventory", instructionAuthority: false, promotionAuthority: false, recoveryAuthority: false };
  return publishInventory(inventory.projectRoot, payload);
}

function publishInventory(root, payload) {
  const content = `${canonicalGraphJson(payload)}\n`;
  const file = safeGraphFile(root, PROJECT_GRAPH_INDEX_PATH);
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === content) return { status: "reused", indexPath: PROJECT_GRAPH_INDEX_PATH, recordsDigest: payload.recordsDigest, recordCount: payload.entries.length, ordinaryWorkBlocked: false };
  atomicWriteArtifact(file, content);
  return { status: "indexed", indexPath: PROJECT_GRAPH_INDEX_PATH, recordsDigest: payload.recordsDigest, recordCount: payload.entries.length, ordinaryWorkBlocked: false };
}

function updateProjectGraphIndex(root, changedPaths) {
  const { projectRoot, project } = readGraphProject(root);
  if (!project) return { status: "not-initialized", ordinaryWorkBlocked: false };
  const indexFile = safeGraphFile(projectRoot, PROJECT_GRAPH_INDEX_PATH);
  if (!fs.existsSync(indexFile)) return refreshProjectGraphIndex({ root });
  const previous = JSON.parse(fs.readFileSync(indexFile, "utf8"));
  if (!previous.readerDependencies || changedPaths.some((relative) => relative.startsWith(".head/onboarding/")
    || relative.startsWith(".head/world-model/snapshots/"))) return refreshProjectGraphIndex({ root });
  if (previous.kind !== "ProjectGraphRecordIndex" || previous.version !== 1 || previous.projectId !== project.projectId
    || previous.rootDigest !== hash(projectRoot) || !Array.isArray(previous.entries) || previous.entries.length > MAX_RECORDS
    || !Array.isArray(previous.unavailable) || previous.authority !== "P4-replaceable-record-inventory"
    || previous.instructionAuthority !== false || previous.promotionAuthority !== false || previous.recoveryAuthority !== false
    || previous.entries.some((entry) => typeof entry.path !== "string" || entry.path.includes("..") || !entry.path.startsWith(".head/")
      || !/^[a-f0-9]{64}$/.test(entry.sha256 || "") || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0)) return refreshProjectGraphIndex({ root });
  const entries = new Map(previous.entries.map((entry) => [entry.path, entry]));
  const unavailable = previous.unavailable.filter((entry) => !changedPaths.includes(entry.path));
  for (const relative of changedPaths) {
    const target = safeGraphFile(projectRoot, relative);
    if (!fs.existsSync(target)) { entries.delete(relative); continue; }
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.size > MAX_BYTES) { entries.delete(relative); unavailable.push({ path: relative, reasonCode: "PROJECT_GRAPH_RECORD_LIMIT" }); continue; }
    entries.set(relative, { path: relative, sha256: hash(fs.readFileSync(target)), bytes: stat.size });
  }
  const allEntries = [...entries.values()].sort((a, b) => a.path.localeCompare(b.path));
  const complete = previous.complete && allEntries.length <= MAX_RECORDS;
  const boundedEntries = allEntries.slice(0, MAX_RECORDS);
  const recordsDigest = projectGraphDigest({ projectId: project.projectId, projectRoot, entries: boundedEntries, unavailable, complete,
    readerDependencies: previous.readerDependencies });
  return publishInventory(projectRoot, { ...previous, authorityBoundary: artifactAuthorityBoundary("ProjectGraphRecordIndex"),
    entries: boundedEntries, unavailable, complete, recordsDigest });
}

// Writers already verified/persisted their evidence. Index failure is a loss
// of a derived optimization and cannot undo that success or demand reapproval.
export function noteProjectGraphChange(root, changedPaths = null) {
  try { return changedPaths ? updateProjectGraphIndex(root, changedPaths) : refreshProjectGraphIndex({ root }); }
  catch (error) { return { status: "unavailable", reasonCode: error.code || "PROJECT_GRAPH_INDEX_UNAVAILABLE", ordinaryWorkBlocked: false }; }
}
