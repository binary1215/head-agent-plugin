import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readGraphProject, safeGraphFile } from "./discovery-index.mjs";
import { relativeProjectArtifact } from "./project-storage-format.mjs";
import { queryProjectGraph } from "./project-graph.mjs";
import { LocalJsonGraphProjectionAdapter } from "./graph-projection-adapter.mjs";
import { LocalJsonWorldModelStoreAdapter } from "./world-model-store.mjs";
import { inspectGraphLineage, diffGraphLineage } from "./graph-lineage.mjs";
import { queryWorldModel } from "./world-model.mjs";
import { renderGraphExplorer } from "./graph-explorer-html.mjs";

const MAX_ORIGINAL = 64 * 1024, MAX_ORIGINAL_TOTAL = 256 * 1024, MAX_HTML = 8 * 1024 * 1024;
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const fail = code => { throw Object.assign(new Error(code), { code }); };
const reason = error => /^[A-Z][A-Z0-9_]{0,95}$/.test(error?.code || "") ? error.code : "GRAPH_EXPLORER_UNAVAILABLE";
export const explorerReferenceKey = reference => JSON.stringify([reference?.path || null, reference?.digest || null]);

function readOnlyLocalAdapter(Base, owner, directory) {
  const adapter = new Base(owner);
  for (const method of ["pointerLocation", "snapshotLocation"]) {
    const original = adapter[method].bind(adapter);
    adapter[method] = (...args) => safeGraphFile(owner.projectRoot, path.relative(owner.projectRoot, original(...args)).replaceAll("\\", "/"));
  }
  const list = adapter.listSnapshotIds.bind(adapter);
  adapter.listSnapshotIds = () => { safeGraphFile(owner.projectRoot, relativeProjectArtifact(owner.storage, directory, "snapshots")); return list(); };
  adapter.writePointer = adapter.writeSnapshot = () => fail("GRAPH_EXPLORER_READ_ONLY");
  return adapter;
}

function boundedBytes(file, maximum) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > maximum) return null;
    const bytes = Buffer.alloc(maximum + 1); let count = 0;
    while (count < bytes.length) {
      const read = fs.readSync(fd, bytes, count, bytes.length - count, count);
      if (!read) break; count += read;
    }
    return count > maximum ? null : bytes.subarray(0, count);
  } finally { fs.closeSync(fd); }
}

function exactOriginal(root, reference, remaining) {
  if (!reference?.path || !/^[a-f0-9]{64}$/.test(reference.digest || "")) return { status: "unavailable", reasonCode: "EXACT_REFERENCE_NOT_RETAINED" };
  try {
    const file = safeGraphFile(root, reference.path), stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > MAX_ORIGINAL || stat.size > remaining) return { status: "omitted", reasonCode: "ORIGINAL_BYTE_BOUND", bytes: stat.size };
    // JSON records already passed their typed layer's reader before query
    // emitted this exact reference. Digest equality binds this read to it.
    const raw = boundedBytes(file, Math.min(remaining, MAX_ORIGINAL));
    if (!raw) return { status: "omitted", reasonCode: "ORIGINAL_BYTE_BOUND" };
    const digest = sha(raw);
    if (digest !== reference.digest) return { status: "unavailable", reasonCode: "EXACT_REVISION_NOT_ON_DISK", expectedDigest: reference.digest, currentDigest: digest };
    return { status: "verified-exact-bytes", bytes: raw.length, digest,
      text: new TextDecoder("utf-8", { fatal: true }).decode(raw) };
  } catch (error) { return { status: "unavailable", reasonCode: reason(error) }; }
}

// UI-private projection. No Session selection, initialization or refresh occurs.
export async function buildGraphExplorerSnapshot({ root = ".", query = "", history = false } = {}) {
  const started = performance.now(), owner = readGraphProject(root), projectRoot = owner.projectRoot;
  const adapterOwner = { projectRoot, storage: owner.storage };
  const graphAdapter = readOnlyLocalAdapter(LocalJsonGraphProjectionAdapter, adapterOwner, "graph-projection");
  const worldAdapter = readOnlyLocalAdapter(LocalJsonWorldModelStoreAdapter, adapterOwner, "world-model");
  const queryStarted = performance.now();
  const graph = await queryProjectGraph({ root: projectRoot, query, view: "all", details: true, depth: 2,
    maxNodes: 60, maxEdges: 120, graphProjectionAdapter: graphAdapter, storeAdapter: worldAdapter });
  const queryMs = performance.now() - queryStarted;
  if (owner.project && graph.basis?.projectId && graph.basis.projectId !== owner.project.projectId) fail("GRAPH_EXPLORER_PROJECT_MISMATCH");
  // The temporal Project view and structural semantic graph have different
  // identities. Query the existing code reader, never invent path-based joins.
  const sourceAnchor = query || graph.nodes.find(node => node.kind === "FileRevision" && node.sourceCurrentness?.freshness === "current-source-bytes")?.path;
  let codeGraph = { status: "unavailable", nodes: [], edges: [], reasonCode: "NO_EXPORTED_SOURCE_ANCHOR", fallback: "original-source" };
  const codeStarted = performance.now();
  if (owner.project && sourceAnchor) {
    try {
      const code = queryWorldModel({ root: projectRoot, query: sourceAnchor, depth: 2, maxResults: 40, storeAdapter: worldAdapter });
      codeGraph = { ...code, layer: "structural-code-evidence", sourceAnchor,
        nodes: code.nodes.map(node => ({ ...node, nodeId: node.id, revisionId: code.semanticGraphId,
          sourceReference: node.path && (node.digest || node.fileDigest) ? { path: node.path, digest: node.digest || node.fileDigest } : null })),
        edges: code.edges.slice(0, 120).map(edge => ({ ...edge, edgeId: edge.id, sourceReference: edge.evidence })),
        omittedEdgeCount: Math.max(0, code.edges.length - 120), truncated: Boolean(code.truncated || code.edges.length > 120) };
    } catch (error) { codeGraph.reasonCode = reason(error); }
  }
  const codeQueryMs = performance.now() - codeStarted;
  const originals = {}, unavailable = [], seen = new Set(); let originalBytes = 0, originalReadCount = 0;
  for (const item of [...graph.nodes, ...graph.edges, ...codeGraph.nodes, ...codeGraph.edges]) {
    if (item.projectId && item.projectId !== owner.project?.projectId) fail("GRAPH_EXPLORER_PROJECT_MISMATCH");
    const reference = item.sourceReference || item.provenance, key = explorerReferenceKey(reference);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!reference?.path || !reference.digest) continue;
    const original = exactOriginal(projectRoot, reference, MAX_ORIGINAL_TOTAL - originalBytes);
    originals[key] = { reference, ...original }; originalReadCount += 1;
    if (original.status === "verified-exact-bytes") originalBytes += original.bytes;
  }
  let retainedHistory = { status: "not-requested", entries: [], diff: null };
  if (history && owner.project) {
    try {
      const lineage = inspectGraphLineage({ root: projectRoot, limit: 3, storeAdapter: worldAdapter });
      if (lineage.projectId !== owner.project.projectId) fail("GRAPH_EXPLORER_PROJECT_MISMATCH");
      const entries = lineage.segment.entries;
      const current = entries.find(entry => entry.worldModelId === lineage.currentWorldModelId);
      const parent = entries.find(entry => current?.parentSourceSnapshotIds.includes(entry.sourceSnapshotId));
      const pair = current && parent ? [parent, current] : entries.slice(0, 2);
      const diff = pair.length === 2 ? diffGraphLineage({ root: projectRoot,
        fromWorldModelId: pair[0].worldModelId, toWorldModelId: pair[1].worldModelId, limit: 40, storeAdapter: worldAdapter }) : null;
      retainedHistory = { status: "retained", lineage, entries, diff,
        comparison: parent ? "retained-parent-to-current" : "exact-retained-pair-not-chronological-inference" };
    } catch (error) { retainedHistory = { status: "unavailable", entries: [], diff: null, reasonCode: reason(error) }; }
  }
  if (!owner.project) unavailable.push("PROJECT_GRAPH_NOT_INITIALIZED");
  return {
    kind: "GraphExplorerSnapshot", schemaVersion: 1, authorityPlane: "P4-derived-view", runtimeAuthority: false,
    generatedAt: new Date().toISOString(), project: owner.project ? { projectId: owner.project.projectId, root: projectRoot } : null,
    focus: { kind: "project", nativeSessionSelectionClaimed: false }, graph, codeGraph, originals, history: retainedHistory, unavailable,
    bounds: { maxProjectNodes: 60, maxProjectEdges: 120, maxCodeNodes: 40, maxCodeEdges: 120,
      maxOriginalBytes: MAX_ORIGINAL, maxOriginalTotalBytes: MAX_ORIGINAL_TOTAL, maxHtmlBytes: MAX_HTML },
    metrics: { queryMs, codeQueryMs, exportMs: performance.now() - started, originalReferenceCount: originalReadCount, originalBytes,
      queryInventoryReads: "not-measured-by-this-view; output-node-limit-is-not-an-inventory-read-limit" },
    interpretation: "A generated local evidence snapshot, not a live view, Session binding, recovery direction or action approval.",
  };
}

export async function exportGraphExplorer({ root = ".", query = "", history = false, output = null } = {}) {
  // Validate explicit output before doing potentially expensive reads. Only the
  // newly requested report is writable; no canonical/runtime directory is used.
  let file = output ? path.resolve(output) : null;
  const protect = value => { if (value.split(/[\\/]/).some(part => [".head", ".lode", ".git"].includes(part.toLowerCase()))) fail("GRAPH_EXPLORER_PROTECTED_OUTPUT"); };
  if (file) {
    protect(file);
    let ancestor = path.dirname(file);
    while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
    const resolved = fs.realpathSync.native(ancestor); protect(resolved);
    file = path.resolve(resolved, path.relative(ancestor, file));
  }
  if (file && fs.existsSync(file)) fail("GRAPH_EXPLORER_OUTPUT_EXISTS");
  const snapshot = await buildGraphExplorerSnapshot({ root, query, history }), html = renderGraphExplorer(snapshot);
  const bytes = Buffer.byteLength(html);
  if (bytes > MAX_HTML) fail("GRAPH_EXPLORER_EXPORT_BYTE_BOUND");
  if (!file) file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lode-graph-explorer-")), "index.html");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return { status: "created", file, bytes, projectId: snapshot.project?.projectId || null,
    nodes: snapshot.graph.nodes.length, edges: snapshot.graph.edges.length, coverage: snapshot.graph.coverage,
    metrics: snapshot.metrics, generatedAt: snapshot.generatedAt, snapshotAuthority: "P4-derived-view", ordinaryWorkBlocked: false };
}
