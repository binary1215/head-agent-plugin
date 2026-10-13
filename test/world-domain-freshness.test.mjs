import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeProject } from "../scripts/lib/head-core.mjs";
import { createHeadSession, withSessionRoute } from "../scripts/lib/session-routing.mjs";
import { buildWorldModel, inspectWorldModel, inspectWorldDomainFreshness, readWorldModelForDiscovery,
  buildWorldTraversalEligibility, queryWorldModel, queryWorldTemporalGraph } from "../scripts/lib/world-model.mjs";
import { queryTemporalProvenanceGraph, buildTemporalProvenanceGraph } from "../scripts/lib/temporal-provenance.mjs";
import { normalizeProductModelDocument } from "../scripts/lib/product-model.mjs";
import { compileContext } from "../scripts/lib/context-compiler.mjs";
import { queryGraphProjection } from "../scripts/lib/graph-projection-adapter.mjs";
import { SOURCE_ANALYSIS_VERSION } from "../scripts/lib/source-analysis.mjs";
import { writeRepositorySourceScope } from "../scripts/lib/repository-source-scope.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
function bytes(root) {
  const result = {};
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else result[path.relative(root, file)] = fs.readFileSync(file).toString("base64");
    }
  }
  visit(root); return result;
}
async function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "head-domain-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeProject({ root, pluginRoot, runtimes: ["codex"] });
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src/main.mjs"), "import { relay } from './relay.mjs';\nexport function start(value) { return relay(value); }\n");
  fs.writeFileSync(path.join(root, "src/relay.mjs"), "export function relay(value) { return value; }\n");
  await buildWorldModel({ root });
  return root;
}
function mutateSession(root, patch) {
  const file = path.join(root, ".head/sessions/current.json");
  const state = JSON.parse(fs.readFileSync(file));
  fs.writeFileSync(file, JSON.stringify({ ...state, ...patch })); return state;
}
function retainedStore(snapshot) {
  // Existing in-memory adapter shape, no network or persistence.
  return { adapterKind: "fixture", adapterVersion: "0.1.0", describe() { return { adapterKind: "fixture",
    authority: "derived-evidence-only", rebuildable: true, uniqueAuthority: false }; },
    readPointer() { return { document: { schemaVersion: 1, kind: "WorldModelPointer", projectId: snapshot.projectId,
      worldModelId: snapshot.worldModelId, worldModelHash: snapshot.worldModelHash } }; },
    readSnapshot(id) { return id === snapshot.worldModelId ? { document: snapshot } : null; },
    listSnapshotIds() { return [snapshot.worldModelId]; }, writePointer() { throw Error("read-only"); }, writeSnapshot() { throw Error("read-only"); } };
}

test("runtime/checkpoint drift preserves code query and Context; reads leave every byte unchanged", async t => {
  const root = await fixture(t), original = readWorldModelForDiscovery({ root }).snapshot;
  assert.equal(inspectWorldModel({ root }).status, "current");
  mutateSession(root, { latestCheckpoint: { checkpointId: "checkpoint-fixture", digest: "a".repeat(64) } });
  const before = bytes(root);
  const full = inspectWorldModel({ root });
  assert.equal(full.status, "stale");
  assert.equal(full.freshness.domains.runtime.status, "stale");
  assert.equal(full.freshness.domains.code.status, "current");
  const scoped = inspectWorldDomainFreshness({ root, domains: ["code"] });
  assert.deepEqual(Object.keys(scoped.freshness.domains), ["code"]);
  const queried = queryWorldModel({ root, query: "start", depth: 2 });
  assert.equal(queried.status, "current");
  assert(queried.edges.some(edge => edge.type === "CALLS"));
  assert(queried.edges.some(edge => edge.type === "IMPORTS"));
  const capsule = compileContext({ root, task: "Inspect relay implementation" }).capsule;
  assert(capsule.repositoryContext.some(item => item.path === "src/relay.mjs"));
  assert.equal(capsule.repositoryWorldFreshness.domains.runtime.status, "stale");
  assert.equal(capsule.repositoryGraph.semanticGraphId, original.semanticGraph.semanticGraphId);
  const temporal = queryWorldTemporalGraph({ root, query: "main.mjs" });
  assert.equal(temporal.graphSnapshotId, original.temporalProvenanceGraph.graphSnapshotId);
  assert.equal(temporal.graphSnapshotHash, original.temporalProvenanceGraph.graphSnapshotHash);
  assert.deepEqual(bytes(root), before);
});

test("code-only query never reads unrelated current Product, Session, observation or runtime readers", async t => {
  const root = await fixture(t);
  fs.writeFileSync(path.join(root, ".head/context/product-model.json"), "broken-product-json");
  const codeContext = compileContext({ root, task: "Inspect source", evidenceNeeds: [{ id: "code", kind: "repository-source", paths: ["src/main.mjs"] }] }).capsule;
  assert.deepEqual(Object.keys(codeContext.repositoryWorldFreshness.domains), ["code"]);
  assert(codeContext.repositoryContext.some(item => item.path === "src/main.mjs"));
  fs.writeFileSync(path.join(root, ".head/sessions/current.json"), "broken-session-json");
  const before = bytes(root);
  assert.equal(inspectWorldDomainFreshness({ root, domains: ["code"] }).freshness.domains.code.status, "current");
  assert.equal(queryWorldModel({ root, query: "relay" }).status, "current");
  const mixed = inspectWorldDomainFreshness({ root });
  assert.equal(mixed.freshness.domains.code.status, "current");
  assert.equal(mixed.freshness.domains.product.status, "unavailable");
  assert.equal(mixed.freshness.domains.runtime.status, "unavailable");
  assert.deepEqual(bytes(root), before);
});

test("capture owner remains Session A while Session B is selected; no World copy per Session", async t => {
  const root = await fixture(t), original = readWorldModelForDiscovery({ root }).snapshot;
  const second = createHeadSession({ root, purpose: "Independent work" }).sessionId;
  const before = bytes(root);
  withSessionRoute(root, second, () => {
    const full = inspectWorldModel({ root });
    assert.equal(full.status, "current");
    assert.equal(full.capturedRuntimeSessionId, original.runtimeState.sessionId);
    assert.equal(full.selectedSessionState.sessionId, second);
    const runtime = inspectWorldDomainFreshness({ root, domains: ["runtime"] });
    assert.equal(runtime.freshness.domains.runtime.status, "current");
    assert.equal(runtime.freshness.domains.runtime.capturedSessionId, original.runtimeState.sessionId);
    assert.equal(queryWorldModel({ root, query: "relay" }).status, "current");
  });
  assert.deepEqual(bytes(root), before);
});

test("add/delete/rename invalidate all code relations, including unchanged importer; source fallback is non-writing", async t => {
  for (const operation of ["add", "delete", "rename", "edit"]) {
    const root = await fixture(t), importer = fs.readFileSync(path.join(root, "src/main.mjs"));
    if (operation === "add") fs.writeFileSync(path.join(root, "src/extra.mjs"), "export const extra = 1;\n");
    if (operation === "delete") fs.unlinkSync(path.join(root, "src/relay.mjs"));
    if (operation === "rename") fs.renameSync(path.join(root, "src/relay.mjs"), path.join(root, "src/renamed.mjs"));
    if (operation === "edit") fs.appendFileSync(path.join(root, "src/relay.mjs"), "export const changed = 1;\n");
    const before = bytes(root), scoped = inspectWorldDomainFreshness({ root, domains: ["code"] });
    assert.equal(scoped.freshness.domains.code.status, "stale", operation);
    assert.deepEqual(fs.readFileSync(path.join(root, "src/main.mjs")), importer);
    const queried = queryWorldModel({ root, query: "main.mjs" });
    assert.equal(queried.status, "stale"); assert.equal(queried.fallback, "original-source"); assert.deepEqual(queried.edges, []);
    assert.equal(compileContext({ root, task: "main" }).capsule.repositoryGraph, null);
    assert.deepEqual(bytes(root), before);
  }
});

test("SourceScope and recorded analyzer basis are genuine invalidators, not runtime aliases", async t => {
  const root = await fixture(t), snapshot = readWorldModelForDiscovery({ root }).snapshot;
  assert.equal(snapshot.analysisBasis.sourceAnalysisVersion, SOURCE_ANALYSIS_VERSION);
  assert.equal(snapshot.indexer.sourceAnalysisVersion, SOURCE_ANALYSIS_VERSION);
  writeRepositorySourceScope({ projectRoot: root, selection: { excludeRoots: ["src"] } });
  const before = bytes(root);
  assert.equal(inspectWorldDomainFreshness({ root, domains: ["code"] }).freshness.domains.code.status, "stale");
  assert.deepEqual(bytes(root), before);
  const tampered = structuredClone(snapshot);
  tampered.analysisBasis.sourceAnalysisVersion = "unproved-parser";
  delete tampered.worldModelId; delete tampered.worldModelHash;
  tampered.worldModelHash = hash(tampered); tampered.worldModelId = `world-model-${tampered.worldModelHash.slice(0, 24)}`;
  assert.throws(() => readWorldModelForDiscovery({ root, storeAdapter: retainedStore(tampered) }), { code: "WORLD_DOMAIN_BASIS_MISMATCH" });
});

test("an unchanged importer's newly resolved target needs the existing refresh, not guessed traversal", async t => {
  const root = await fixture(t);
  fs.appendFileSync(path.join(root, "src/main.mjs"), "import { optional } from './optional.mjs';\n");
  const first = (await buildWorldModel({ root })).snapshot;
  assert(first.semanticGraph.summary.unresolvedImportCount > 0);
  const importerDigest = first.files.find(file => file.path === "src/main.mjs").digest;
  fs.writeFileSync(path.join(root, "src/optional.mjs"), "export const optional = true;\n");
  assert.equal(inspectWorldDomainFreshness({ root, domains: ["code"] }).freshness.domains.code.status, "stale");
  assert.deepEqual(queryWorldModel({ root, query: "main.mjs" }).edges, []);
  const second = (await buildWorldModel({ root })).snapshot;
  assert.equal(second.files.find(file => file.path === "src/main.mjs").digest, importerDigest);
  assert.notEqual(second.worldModelId, first.worldModelId);
  assert.equal(second.semanticGraph.summary.unresolvedImportCount, 0);
  assert(queryWorldModel({ root, query: "optional.mjs" }).edges.some(edge => edge.type === "IMPORTS"));
  assert(fs.existsSync(path.join(root, ".head/world-model/snapshots", `${first.worldModelId}.json`)));
});

test("product Git branch drift remains observable without invalidating unrelated code", async t => {
  const root = await fixture(t);
  fs.mkdirSync(path.join(root, ".git/refs/heads"), { recursive: true });
  fs.writeFileSync(path.join(root, ".git/HEAD"), "ref: refs/heads/main\n");
  fs.writeFileSync(path.join(root, ".git/refs/heads/main"), `${"1".repeat(40)}\n`);
  const before = bytes(root), domains = inspectWorldDomainFreshness({ root });
  assert.equal(domains.freshness.domains.git.status, "stale");
  assert.equal(domains.freshness.domains.code.status, "current");
  assert.equal(queryWorldModel({ root, query: "main.mjs" }).status, "current");
  assert.deepEqual(bytes(root), before);
});

test("Product drift excludes only Product links while current code remains available to Context", async t => {
  const root = await fixture(t), productFile = path.join(root, ".head/context/product-model.json");
  const product = { schemaVersion: 1, featureGroups: [], capabilities: [{ key: "relay", name: "Relay", description: "Forward a message" }],
    features: [], requirements: [], constraints: [], decisions: [] };
  fs.writeFileSync(productFile, JSON.stringify(product)); await buildWorldModel({ root });
  product.capabilities[0].description = "Different current Product meaning";
  fs.writeFileSync(productFile, JSON.stringify(product));
  const before = bytes(root), inspected = inspectWorldDomainFreshness({ root });
  assert.equal(inspected.freshness.domains.product.status, "stale");
  assert.equal(inspected.freshness.domains.code.status, "current");
  assert.equal(queryWorldModel({ root, query: "start" }).status, "current");
  const capsule = compileContext({ root, task: "Relay source implementation" }).capsule;
  assert(capsule.repositoryContext.some(item => item.path === "src/relay.mjs"));
  assert.deepEqual(capsule.productContext, []);
  const temporal = queryWorldTemporalGraph({ root, query: "main.mjs", depth: 3 });
  assert(temporal.nodes.some(node => node.kind === "File"));
  assert(!temporal.nodes.some(node => node.kind === "Capability"));
  assert(temporal.exclusion.domainExcludedNodes > 0);
  assert.deepEqual(bytes(root), before);
});

test("legacy 0.18 snapshots remain verified historical evidence without invented analysis currentness", async t => {
  const root = await fixture(t), original = readWorldModelForDiscovery({ root }).snapshot;
  const legacy = structuredClone(original);
  delete legacy.analysisBasis; delete legacy.domainBases; delete legacy.worldModelId; delete legacy.worldModelHash;
  legacy.protocol.version = "0.18.0";
  legacy.worldModelHash = hash(legacy); legacy.worldModelId = `world-model-${legacy.worldModelHash.slice(0, 24)}`;
  const storeAdapter = retainedStore(legacy);
  assert.equal(readWorldModelForDiscovery({ root, storeAdapter }).snapshot.worldModelId, legacy.worldModelId);
  const scoped = inspectWorldDomainFreshness({ root, storeAdapter, domains: ["code"] });
  assert.equal(scoped.freshness.domains.code.status, "unknown");
  assert.equal(queryWorldModel({ root, storeAdapter, query: "relay" }).fallback, "original-source");
  const tampered = structuredClone(legacy); tampered.productPolicyProjection.projectionInputHash = "f".repeat(64);
  delete tampered.worldModelId; delete tampered.worldModelHash;
  tampered.worldModelHash = hash(tampered); tampered.worldModelId = `world-model-${tampered.worldModelHash.slice(0, 24)}`;
  assert.throws(() => readWorldModelForDiscovery({ root, storeAdapter: retainedStore(tampered) }), { code: "PRODUCT_POLICY_TEMPORAL_IDENTITY_MISMATCH" });
});

test("mixed traversal filters stale bridge BEFORE expansion, retains exact identity, and avoids unsupported remote adapter", async t => {
  const root = await fixture(t), snapshot = readWorldModelForDiscovery({ root }).snapshot;
  const productModel = normalizeProductModelDocument({ schemaVersion: 1, featureGroups: [],
    capabilities: [{ key: "relay", name: "Relay", description: "Forward messages" }], features: [], requirements: [], constraints: [], decisions: [] });
  const graph = buildTemporalProvenanceGraph({ projectId: snapshot.projectId, files: snapshot.files, productModel });
  const file = graph.nodes.find(node => node.kind === "File" && node.path === "src/main.mjs");
  const product = graph.nodes.find(node => node.kind === "Capability");
  // Repository CONTAINS is a genuine existing mixed-domain bridge to Product.
  const repository = graph.nodes.find(node => node.kind === "Repository");
  const domainFreshness = { code: { status: "current" }, product: { status: "stale" }, git: { status: "current" },
    runtime: { status: "stale" }, observations: { status: "current" } };
  const eligibility = buildWorldTraversalEligibility({ ...snapshot, temporalProvenanceGraph: graph }, domainFreshness);
  assert(!eligibility.nodeIds.includes(product.nodeId));
  const query = { anchorIds: [repository.nodeId], expectedGraphSnapshotId: graph.graphSnapshotId, depth: 3, maxNodes: 100, eligibility };
  const before = JSON.stringify(graph);
  const result = queryTemporalProvenanceGraph(graph, query);
  assert(result.nodes.some(node => node.nodeId === file.nodeId));
  assert(!result.nodes.some(node => node.nodeId === product.nodeId));
  assert(result.exclusion.domainExcludedEdges > 0);
  assert.equal(result.graphSnapshotId, graph.graphSnapshotId); assert.equal(result.graphSnapshotHash, graph.graphSnapshotHash);
  assert.throws(() => queryTemporalProvenanceGraph(graph, { ...query, expectedGraphSnapshotId: "graph-snapshot-stale" }), { code: "TEMPORAL_GRAPH_SNAPSHOT_MISMATCH" });
  assert.throws(() => queryTemporalProvenanceGraph(graph, { ...query, eligibility: { ...eligibility, graphSnapshotHash: "f".repeat(64) } }), { code: "TEMPORAL_ELIGIBILITY_SNAPSHOT_MISMATCH" });
  let remoteCalls = 0;
  const adapter = new Proxy({}, { get() { remoteCalls++; throw Error("unsupported remote must not be invoked"); } });
  const projected = queryGraphProjection({ projectRoot: root, graph, adapter, query });
  assert.equal(remoteCalls, 0); assert.equal(projected.diagnostics.executionMode, "embedded-domain-eligibility-fallback");
  assert.deepEqual(projected.result, result); assert.equal(JSON.stringify(graph), before);
});
