import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { pathToFileURL } from "node:url";
import { buildGraphExplorerSnapshot, exportGraphExplorer } from "../scripts/lib/graph-explorer.mjs";
import { renderGraphExplorer } from "../scripts/lib/graph-explorer-html.mjs";
import { buildWorldModel } from "../scripts/lib/world-model.mjs";
import { queryProjectGraph } from "../scripts/lib/project-graph.mjs";
import { LocalJsonGraphProjectionAdapter, createGraphProjectionAdapter } from "../scripts/lib/graph-projection-adapter.mjs";
import { LocalJsonWorldModelStoreAdapter } from "../scripts/lib/world-model-store.mjs";
import { buildStorageSelection, buildOnboardingState } from "../scripts/lib/onboarding-contract.mjs";
import { buildCodexMarketplaceSnapshot } from "../scripts/lib/codex-marketplace.mjs";
import { buildClaudeMarketplaceSnapshot } from "../scripts/lib/claude-marketplace.mjs";
import { snapshot, pluginRoot } from "./helpers/session-work-linkage-fixture.mjs";
import { explorerFixture } from "./helpers/graph-explorer-fixture.mjs";
import { runCommand, usage } from "../scripts/lode.mjs";

test("exploration is reversible display state over exact edges, with stable positions and no cross-layer merging", () => {
  const source = fs.readFileSync(path.join(pluginRoot, "scripts/graph-explorer/exploration.js"), "utf8");
  new vm.Script(source + "\n" + fs.readFileSync(path.join(pluginRoot, "scripts/graph-explorer/browser.js"), "utf8"));
  const factory = vm.runInNewContext(source + "\nexplorerModel", Object.freeze({}));
  const graph = { nodes: [{ nodeId: "a", path: "same.mjs", revisionId: "old" }, { nodeId: "b", path: "same.mjs", revisionId: "new" }, { nodeId: "c" }, { nodeId: "isolated" }],
    edges: [{ from: "a", to: "a", type: "SELF" }, { from: "a", to: "b", type: "IMPORTS" }, { from: "a", to: "b", type: "CALLS" }, { from: "b", to: "c", type: "NEXT" }, { from: "c", to: "a", type: "BACK" }, { from: "a", to: "not-exported", type: "MISSING" }] };
  const before = JSON.stringify(graph), model = factory.create(graph);
  assert.equal(model.visible.size, 0); assert.equal(model.visit("a"), true);
  assert.deepEqual([...model.visible].sort(), ["a", "b", "c"]); assert.equal(model.links("a").length, 5);
  const a = { ...model.positions.get("a") }, b = { ...model.positions.get("b") };
  model.visit("b"); model.expand("b"); model.expand("b");
  assert.deepEqual({ ...model.positions.get("a") }, a); assert.deepEqual({ ...model.positions.get("b") }, b);
  model.move("a", 123, 456); model.visit("c"); assert.equal(model.pinned.has("a"), true);
  assert.deepEqual({ ...model.positions.get("a") }, { x: 123, y: 456 });
  assert.equal(model.travel(-1), "b"); assert.equal(model.travel(-1), "a"); assert.equal(model.travel(1), "b");
  model.visit("isolated"); assert.deepEqual([...model.history], ["a", "b", "isolated"]); assert.equal(model.travel(1), null);
  assert.equal(model.visit("not-exported"), false); assert.equal(model.visible.has("not-exported"), false);
  const otherLayer = factory.create({ nodes: [{ nodeId: "a", revisionId: "different-project" }], edges: [] });
  otherLayer.visit("a"); assert.equal(otherLayer.pinned.size, 0); assert.equal(otherLayer.nodes.get("a").revisionId, "different-project");
  model.reset("a"); assert.deepEqual([...model.history], ["a"]); assert.equal(model.pinned.size, 0);
  assert.equal(JSON.stringify(graph), before);
  const axes = factory.create({ nodes: [{ nodeId: "seed" }, { nodeId: "code", kind: "File" }, { nodeId: "product", kind: "Feature" }], edges: [{ from: "seed", to: "code" }, { from: "seed", to: "product" }] }, node => node.kind === "File" ? "code" : "context");
  axes.visit("seed"); const origin = axes.positions.get("seed"), code = axes.positions.get("code"), product = axes.positions.get("product");
  assert(Math.abs(code.x - origin.x) > Math.abs(code.y - origin.y));
  assert(Math.abs(product.y - origin.y) > Math.abs(product.x - origin.x));
});

test("expanded nodes reserve their full label rectangles across dense, repeated, pinned and disconnected exploration", () => {
  const source = fs.readFileSync(path.join(pluginRoot, "scripts/graph-explorer/exploration.js"), "utf8");
  const factory = vm.runInNewContext(source + "\nexplorerModel", Object.freeze({}));
  const nodes = Array.from({ length: 70 }, (_, i) => ({ nodeId: String(i), kind: i % 2 ? "File" : "Feature", name: "긴 한국어 표시 이름 ".repeat(5) }));
  const edges = nodes.slice(1, 51).map(node => ({ from: "0", to: node.nodeId, type: "LINK" }));
  for (let i = 51; i < 69; i++) edges.push({ from: String(i - 50), to: String(i), type: "NEXT" });
  edges.push({ from: "0", to: "0", type: "SELF" }, { from: "0", to: "1", type: "PARALLEL" }, { from: "51", to: "1", type: "CYCLE" });
  const extent = node => ({ left: 160 + Number(node.nodeId) % 3 * 35, right: 160 + Number(node.nodeId) % 3 * 35, top: 45, bottom: 85 });
  const graph = { nodes, edges }, before = JSON.stringify(graph);
  const model = factory.create(graph, node => node.kind === "File" ? "code" : "context", extent);
  function disjoint() {
    const points = [...model.positions];
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
      const [a, p] = points[i], [b, q] = points[j], e = extent(model.nodes.get(a)), o = extent(model.nodes.get(b));
      assert(!(p.x - e.left < q.x + o.right && p.x + e.right > q.x - o.left && p.y - e.top < q.y + o.bottom && p.y + e.bottom > q.y - o.top), `Label rectangles overlap: ${a}, ${b}`);
    }
  }
  model.visit("0"); disjoint(); model.move("0", -3000, -3000); disjoint();
  for (const node of nodes.slice(1)) {
    const retained = new Map([...model.positions].map(([id, p]) => [id, { ...p }]));
    model.visit(node.nodeId); model.expand(node.nodeId); model.expand(node.nodeId); disjoint();
    for (const [id, point] of retained) assert.deepEqual({ ...model.positions.get(id) }, point);
  }
  assert.equal(model.visible.size, nodes.length); assert.equal(model.pinned.has("0"), true);
  assert.equal(JSON.stringify(graph), before);
});

test("Explorer reuses exact Project/code identities and originals without writes, selection or configured adapter access", async t => {
  const f = await explorerFixture(t), sentinel = path.join(f.root, ".lode/graph-projection/arcadedb/current.json");
  const selection = buildStorageSelection({ projectId: f.projectId, selection: { mode: "graphdb", endpoint: "https://example.invalid", database: "synthetic",
    secretReferenceNames: { username: "LODE_TEST_EXPLORER_USER", password: "LODE_TEST_EXPLORER_PASSWORD" } } }, f.storage);
  fs.writeFileSync(path.join(f.root, ".lode/onboarding/storage-selections", `${selection.storageSelectionId}.json`), JSON.stringify(selection), { flag: "wx" });
  const pointer = path.join(f.root, ".lode/onboarding/current.json"), state = JSON.parse(fs.readFileSync(pointer));
  fs.writeFileSync(pointer, JSON.stringify(buildOnboardingState({ ...state, storageSelectionId: selection.storageSelectionId, stateRevision: state.stateRevision + 1 }, f.storage)));
  fs.mkdirSync(path.dirname(sentinel), { recursive: true }); fs.writeFileSync(sentinel, "{configured external selection sentinel");
  assert.throws(() => createGraphProjectionAdapter({ projectRoot: f.root, storage: f.storage }));
  const before = snapshot(f.base), writes = [], originalRead = fs.readFileSync; let sentinelReads = 0, network = 0, tracking = true;
  t.mock.method(fs, "readFileSync", function(file, ...args) { if (tracking && file === sentinel) { sentinelReads++; throw Error("Configured adapter must not be consulted"); } return originalRead.call(this, file, ...args); });
  for (const name of ["writeFileSync", "appendFileSync", "mkdirSync", "renameSync", "unlinkSync", "rmSync"]) {
    const original = fs[name];
    t.mock.method(fs, name, function(...args) { if (tracking) { writes.push(name); throw Error("Unexpected write"); } return original.apply(this, args); });
  }
  t.mock.method(globalThis, "fetch", () => { network++; throw Error("Network forbidden"); });
  let result, codeResult;
  try { result = await buildGraphExplorerSnapshot({ root: f.root }); codeResult = await buildGraphExplorerSnapshot({ root: f.root, query: "relay" }); } finally { tracking = false; }
  assert.deepEqual(writes, []); assert.equal(sentinelReads, 0); assert.equal(network, 0); assert.deepEqual(snapshot(f.base), before);
  assert.equal(result.focus.kind, "project"); assert.equal(result.focus.nativeSessionSelectionClaimed, false);
  assert.equal(result.graph.basis.projectId, f.projectId); assert.equal(result.runtimeAuthority, false);
  assert(codeResult.codeGraph.edges.some(edge => edge.type === "CALLS"));
  assert(codeResult.codeGraph.nodes.every(node => node.id === node.nodeId && node.revisionId === codeResult.codeGraph.semanticGraphId));
  assert(JSON.stringify(result).includes("Do not deploy")); assert(JSON.stringify(result).includes("External outcome remains unverified"));
  assert(Object.values(result.originals).some(original => original.text?.includes("Keep exact prior rationale")));
  const direct = await queryProjectGraph({ root: f.root, query: "", view: "all", details: true, depth: 2, maxNodes: 60, maxEdges: 120,
    graphProjectionAdapter: new LocalJsonGraphProjectionAdapter({ projectRoot: f.root, storage: f.storage }), storeAdapter: new LocalJsonWorldModelStoreAdapter({ projectRoot: f.root, storage: f.storage }) });
  for (const node of direct.nodes) {
    const { detailCoverage, ...actual } = result.graph.nodes.find(item => item.nodeId === node.nodeId);
    assert.deepEqual(actual, node);
  }
  for (const edge of direct.edges) {
    const { currentTraversalEligible, viewerCurrentness, ...actual } = result.graph.edges.find(item => item.edgeId === edge.edgeId);
    assert.deepEqual(actual, edge);
  }
});

test("optional retained history uses exact IDs without refresh and remains a derived comparison", async t => {
  const f = await explorerFixture(t, { history: true }), before = snapshot(f.base);
  const result = await buildGraphExplorerSnapshot({ root: f.root, history: true });
  assert.deepEqual(snapshot(f.base), before); assert.equal(result.history.status, "retained");
  assert(result.history.entries.length >= 2); assert(result.history.diff);
  assert.equal(result.history.diff.projectId, f.projectId); assert.equal(result.history.diff.authority.recoveryAuthority, false);
  assert.notEqual(result.history.diff.from.worldModelId, result.history.diff.to.worldModelId);
});

test("exact original drift is unavailable rather than silently replaced by current bytes", async t => {
  const f = await explorerFixture(t), target = path.join(f.root, "src/relay.mjs"), open = fs.openSync; let changed = false;
  t.mock.method(fs, "openSync", function(file, ...args) {
    if (file === target && !changed) { changed = true; fs.writeFileSync(target, "export const unrelatedCurrentBytes = 123;\n"); }
    return open.call(this, file, ...args);
  });
  const result = await buildGraphExplorerSnapshot({ root: f.root, query: "relay" });
  assert(changed);
  const original = Object.values(result.originals).find(item => item.reference.path === "src/relay.mjs");
  assert.equal(original.status, "unavailable"); assert.equal(original.reasonCode, "EXACT_REVISION_NOT_ON_DISK"); assert.equal(original.text, undefined);
});

test("empty Project, absent history and stale code keep partial navigation without initialization", async t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "lode-explorer-empty-")); t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const before = snapshot(base), empty = await buildGraphExplorerSnapshot({ root: base });
  assert.deepEqual(snapshot(base), before); assert.equal(empty.project, null); assert.deepEqual(empty.graph.nodes, []);
  const f = await explorerFixture(t); fs.appendFileSync(path.join(f.root, "src/relay.mjs"), "\n// drift\n");
  const stale = await buildGraphExplorerSnapshot({ root: f.root, query: "relay" });
  assert.equal(stale.codeGraph.fallback, "original-source"); assert.notEqual(stale.codeGraph.status, "current");
  assert.equal(stale.history.status, "not-requested"); assert.equal(stale.graph.coverage.emptyResultProvesAbsence, false);
});

test("self-contained HTML escapes repository text, keeps strong CSP and creates only the requested export", async t => {
  const f = await explorerFixture(t, { adversarial: true }), before = snapshot(f.root), output = path.join(f.base, "reports/view.html");
  const result = await exportGraphExplorer({ root: f.root, query: "relay", output });
  assert.deepEqual(snapshot(f.root), before); assert.equal(result.file, output);
  const html = fs.readFileSync(output, "utf8");
  assert.equal(result.bytes, Buffer.byteLength(html));
  assert(!html.includes(f.attack)); assert(html.includes("\\u003c/script\\u003e")); assert(html.includes("connect-src 'none'"));
  const executableMarkup = html.replace(/<script nonce="[^"]+" id="snapshot" type="application\/json">[\s\S]*?<\/script>/, "");
  assert(!/\b(?:src|href)=["']https?:/i.test(executableMarkup)); assert(!html.includes("innerHTML"));
  const exact = await buildGraphExplorerSnapshot({ root: f.root }); assert(renderGraphExplorer(exact).includes("Project purpose &amp; lineage"));
  await assert.rejects(exportGraphExplorer({ root: f.root, output }), { code: "GRAPH_EXPLORER_OUTPUT_EXISTS" });
  await assert.rejects(exportGraphExplorer({ root: f.root, output: path.join(f.root, ".lode/view.html") }), { code: "GRAPH_EXPLORER_PROTECTED_OUTPUT" });
});

test("protected output aliases and symlinked World originals cannot escape the local read boundary", async t => {
  const f = await explorerFixture(t), alias = path.join(f.base, "output-alias");
  try { fs.symlinkSync(path.join(f.root, ".lode"), alias, process.platform === "win32" ? "junction" : "dir"); }
  catch (error) { if (["EPERM", "EACCES"].includes(error.code)) { t.skip("Host does not permit this synthetic directory-link probe"); return; } throw error; }
  await assert.rejects(exportGraphExplorer({ root: f.root, output: path.join(alias, "view.html") }), { code: "GRAPH_EXPLORER_PROTECTED_OUTPUT" });
  const world = path.join(f.root, ".lode/world-model/snapshots"), retained = path.join(f.base, "retained-outside-project");
  fs.renameSync(world, retained); fs.symlinkSync(retained, world, process.platform === "win32" ? "junction" : "dir");
  const result = await buildGraphExplorerSnapshot({ root: f.root, query: "relay", history: true });
  assert.equal(result.codeGraph.status, "unavailable"); assert.equal(result.history.status, "unavailable");
  assert.equal(result.focus.kind, "project"); assert.equal(result.graph.coverage.emptyResultProvesAbsence, false);
});

test("ordinary CLI exposes the same create-only viewer without a Session binding or project mutation", async t => {
  const f = await explorerFixture(t), before = snapshot(f.root), output = path.join(f.base, "cli-view.html");
  const result = await runCommand(["graph-explorer", f.root, "--query", "relay", "--output", output],
    { sessionContext: { read() { throw Error("Viewer must not require native/logical binding"); } } });
  assert.equal(result.status, "created"); assert.equal(result.file, output);
  assert(usage().commands.some(line => line.includes("graph-explorer")));
  assert.deepEqual(snapshot(f.root), before);
});

test("oversize original bodies are omitted with exact references and explicit bounds", async t => {
  const f = await explorerFixture(t);
  fs.writeFileSync(path.join(f.root, "src/relay.mjs"), "export function relay(value) { return value; }\n//" + "x".repeat(70 * 1024));
  await buildWorldModel({ root: f.root });
  const result = await buildGraphExplorerSnapshot({ root: f.root, query: "relay" });
  const original = Object.values(result.originals).find(item => item.reference.path === "src/relay.mjs");
  assert.equal(original.status, "omitted"); assert.equal(original.reasonCode, "ORIGINAL_BYTE_BOUND"); assert.equal(original.text, undefined);
  assert(result.metrics.originalBytes <= result.bounds.maxOriginalTotalBytes);
});

test("canonical and legacy Codex/Claude packages include assets and execute the real exporter without installation", async t => {
  const f = await explorerFixture(t), before = snapshot(f.root);
  for (const [provider, build] of [["codex", buildCodexMarketplaceSnapshot], ["claude", buildClaudeMarketplaceSnapshot]]) for (const name of ["lode-agent-plugin", "head-agent-plugin"]) {
    const destination = path.join(f.base, `${provider}-${name}`), built = build({ sourceRoot: pluginRoot, outputRoot: destination, name, repository: "local", commit: "local" });
    const root = path.join(destination, "plugins", built.pluginName);
    for (const asset of ["scripts/graph-explorer.mjs", "scripts/graph-explorer/browser.js", "scripts/graph-explorer/exploration.js", "scripts/graph-explorer/style.css"]) assert(fs.existsSync(path.join(root, asset)));
    const packaged = await import(pathToFileURL(path.join(root, "scripts/lib/graph-explorer.mjs")));
    const report = await packaged.exportGraphExplorer({ root: f.root, query: "relay", output: path.join(f.base, `${provider}-${name}.html`) });
    assert.equal(report.projectId, f.projectId); assert(fs.readFileSync(report.file, "utf8").includes("Source imports &amp; calls"));
  }
  assert.deepEqual(snapshot(f.root), before);
});
