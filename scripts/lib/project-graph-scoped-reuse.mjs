import fs from "node:fs";
import { canonicalGraphJson, projectGraphDigest, readGraphProject, readGraphRecord, safeGraphFile,
  PROJECT_GRAPH_INDEX_PATH, PROJECT_GRAPH_RECORD_DIRECTORIES } from "./discovery-index.mjs";

// Process-local optimization of an already typed/byte-verified discovery, not
// a new record store. Cold, broad, World and custom-store queries keep the
// original-backed path. Caller projections cannot seed or alter this cache.
const cache = new Map();
const supported = (options, query) => query.anchorIds.length > 0 && !query.query && !query.paths.length
  && !options.storeAdapter && !options.worldModelId && !options.graphProjectionAdapter;
const keyFor = (root, query) => projectGraphDigest({ root, query });
const singletons = [".head/context/product-model.json", ".head/world-model/current.json",
  ".head/sessions/current.json", ".head/project-direction/current.json"];

// Membership is navigation only. Inspect names/types (including symlinks),
// not unrelated Session bodies. Add/delete/rename invalidates warm reuse.
// Non-JSON layout matters to historical onboarding readers as well.
function membership(root) {
  const layout = [];
  function visit(relative, depth = 0) {
    if (depth > 8 || layout.length >= 10000) throw new Error("scoped membership limit");
    const file = safeGraphFile(root, relative);
    if (!fs.existsSync(file)) { layout.push([relative, "absent"]); return; }
    if (!fs.lstatSync(file).isDirectory()) throw new Error("invalid membership directory");
    layout.push([relative, "directory"]);
    for (const entry of fs.readdirSync(file, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (layout.length >= 10000) throw new Error("scoped membership limit");
      const child = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error("symlink membership");
      if (entry.isDirectory()) visit(child, depth + 1);
      else layout.push([child, entry.isFile() ? "file" : "other"]);
    }
  }
  for (const directory of [...PROJECT_GRAPH_RECORD_DIRECTORIES,
    ".head/onboarding/historical-boundaries", ".head/onboarding/historical-continuity"]) visit(directory);
  for (const relative of singletons) layout.push([relative, fs.existsSync(safeGraphFile(root, relative)) ? "present" : "absent"]);
  return projectGraphDigest(layout);
}

function previousMatches(previous, entry) {
  if (!previous) return true;
  return [entry.result, entry.scopedResult].some(result => previous.resultId === result.resultId
    && canonicalGraphJson({ ...previous, reuse: null }) === canonicalGraphJson({ ...result, reuse: null }));
}

export function beginScopedDiscovery(options, normalized) {
  if (!supported(options, normalized)) return null;
  try {
    const root = readGraphProject(options.root || ".").projectRoot;
    if (fs.existsSync(safeGraphFile(root, ".head/world-model/current.json"))) return null;
    return membership(root);
  } catch { return null; }
}

export function rememberScopedDiscovery({ options, normalized, inventory, result, nodes, edges, world, sourceCurrentness, initialMembership }) {
  if (!supported(options, normalized) || world || inventory.entries.some(entry => entry.path === ".head/world-model/current.json")
    || !inventory.complete || inventory.unavailable.length
    || result.unmatchedAnchorIds.length || !result.nodes.length) return;
  // Exact local anchors only: no ranked discovery over unread bodies, and no
  // World/adapter result/currentness assertions from an unobserved snapshot.
  try {
    const root = inventory.projectRoot, index = readGraphRecord(root, PROJECT_GRAPH_INDEX_PATH);
    if (index.document.kind !== "ProjectGraphRecordIndex" || index.document.projectId !== inventory.project.projectId
      || index.document.rootDigest !== projectGraphDigest(root) || index.document.recordsDigest !== inventory.recordsDigest
      || canonicalGraphJson(index.document.entries) !== canonicalGraphJson(inventory.entries)
      || canonicalGraphJson(index.document.readerDependencies) !== canonicalGraphJson(inventory.readerDependencies)) return;
    const selected = new Set(result.nodes.map(node => node.nodeId));
    // Include boundary endpoints even when maxNodes/maxEdges cuts them out.
    // Their state and relationship producers are hidden semantic dependencies.
    const requiredIds = new Set(selected);
    for (const edge of edges) if (selected.has(edge.from) || selected.has(edge.to)) {
      requiredIds.add(edge.from); requiredIds.add(edge.to);
    }
    // Failure projections can depend on source inputs not exposed as normal
    // sourceCurrentness facts. Do not pretend this proof covers those readers.
    if (nodes.some(node => requiredIds.has(node.nodeId) && node.kind === "SourceCollectionFailure")) return;
    const paths = new Set();
    for (const node of nodes) if (requiredIds.has(node.nodeId) && node.origin?.path) paths.add(node.origin.path);
    for (const edge of edges) if (requiredIds.has(edge.from) || requiredIds.has(edge.to)) {
      if (edge.provenance?.path) paths.add(edge.provenance.path);
    }
    // Typed layer readers have global uniqueness, review and lineage inputs.
    // Reverify all of those, rather than just the returned candidate/receipt.
    // Only unrelated mutable Session current-state bodies may be skipped.
    for (const entry of inventory.entries) if (!entry.path.startsWith(".head/sessions/by-id/")
      || paths.has(entry.path)) paths.add(entry.path);
    for (const dependencies of Object.values(inventory.readerDependencies || {})) {
      if (!dependencies.complete || dependencies.unavailable.length) return;
      for (const entry of dependencies.entries) paths.add(entry.path);
    }
    const entries = new Map([...inventory.entries, ...Object.values(inventory.readerDependencies || {})
      .flatMap(dependencies => dependencies.entries)].map(entry => [entry.path, entry]));
    if ([...paths].some(relative => !entries.has(relative))) return;
    const proof = [...paths].sort().map(relative => entries.get(relative));
    const selectedSourcePaths = new Set(nodes.filter(node => requiredIds.has(node.nodeId))
      .flatMap(node => [node.sourceCurrentness?.path, node.sourceReference?.path]).filter(relative => relative && !relative.startsWith(".head/")));
    const sources = sourceCurrentness.filter(source => selectedSourcePaths.has(source.path));
    const retained = structuredClone(result);
    const scopedPayload = { ...retained, basis: { ...retained.basis,
      verificationScope: "selected-originals-and-semantic-dependencies", recordsDigestScope: "retained-discovery-inventory",
      layerDigestScope: "retained-discovery-layer-status",
      sourceCurrentnessDigest: projectGraphDigest(sources), sourceCurrentnessScope: "selected-and-boundary-source-bytes",
      indexDigest: index.digest, proofDigest: projectGraphDigest(proof) },
      integrity: { ...retained.integrity, verifiedLayers: [], retainedVerifiedLayers: retained.integrity.verifiedLayers,
        verifiedRecordPaths: proof.slice(0, 256).map(entry => entry.path), verifiedRecordCount: proof.length,
        omittedVerifiedRecordPathCount: Math.max(0, proof.length - 256), scope: "selected-originals-and-semantic-dependencies" },
      freshness: { ...retained.freshness, scope: "selected-originals-and-dependencies-current-bytes; unrelated-bodies-not-reverified" },
      coverage: { ...retained.coverage, verifiedNodeCount: retained.nodes.length,
        retainedDiscoveryNodeCount: retained.coverage.verifiedNodeCount,
        layers: retained.coverage.layers.map(layer => ({ ...layer, status: "retained-discovery-basis" })),
        membership: "current-names-and-types", unrelatedRecordBytesReverified: false,
        relationScope: "retained-discovery-relations-with-original-producers-reverified",
        broadQueriesUseFullDiscovery: true },
      sourceFallback: { ...retained.sourceFallback, needed: true,
        reasonCodes: [...new Set([...retained.sourceFallback.reasonCodes, "PROJECT_GRAPH_SCOPED_VERIFICATION"])],
        action: "Read affected originals before relying on current effects; use a new or broad query to rediscover unrelated changes." },
      reuse: { status: "scoped-originals-reused", semanticSufficiency: "HEAD-owned", wholeProjectCurrent: false } };
    delete scopedPayload.resultId; delete scopedPayload.resultHash;
    const resultHash = projectGraphDigest(scopedPayload);
    const scopedResult = { ...scopedPayload, resultId: `project-graph-result-${resultHash.slice(0, 24)}`, resultHash };
    const projectRead = readGraphRecord(root, ".head/project.json");
    if (canonicalGraphJson(projectRead.document) !== canonicalGraphJson(inventory.project)) return;
    const projectDigest = projectRead.digest;
    const membershipDigest = membership(root);
    if (!initialMembership || membershipDigest !== initialMembership) return;
    const entry = { projectId: inventory.project.projectId, projectDigest, indexDigest: index.digest,
      membershipDigest, proof, sources, result: retained, scopedResult };
    // Do not prime from a mixed sequence if the index changed during proof assembly.
    if (readGraphRecord(root, PROJECT_GRAPH_INDEX_PATH).digest !== index.digest) return;
    if (cache.size >= 16) cache.delete(cache.keys().next().value);
    cache.set(keyFor(root, normalized), entry);
  } catch { /* Missing/stale index or unsupported proof is a normal fallback. */ }
}

export function reuseScopedDiscovery(options, normalized) {
  if (!supported(options, normalized) || !cache.size) return null;
  let key;
  try {
    const { projectRoot: root, project } = readGraphProject(options.root || ".");
    key = keyFor(root, normalized);
    const entry = cache.get(key);
    if (!entry || !project || project.projectId !== entry.projectId || !previousMatches(options.previousResult, entry)) return null;
    if (readGraphRecord(root, ".head/project.json").digest !== entry.projectDigest
      || readGraphRecord(root, PROJECT_GRAPH_INDEX_PATH).digest !== entry.indexDigest
      || membership(root) !== entry.membershipDigest) throw new Error("navigation basis changed");
    for (const proof of entry.proof) if (readGraphRecord(root, proof.path).digest !== proof.sha256) throw new Error("original bytes changed");
    for (const source of entry.sources) {
      let digest = null;
      try {
        const file = safeGraphFile(root, source.path), stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.size > 64 * 1024 * 1024) throw new Error("source limit");
        digest = projectGraphDigest(fs.readFileSync(file));
      } catch { /* Absence is compared with the original observed absence. */ }
      if (digest !== source.currentDigest) throw new Error("selected source changed");
    }
    return structuredClone(entry.scopedResult);
  } catch { if (key) cache.delete(key); return null; }
}
