import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { formatMcpToolContent, formatCliResult } from "../scripts/lib/cli-presentation.mjs";
import { initializeProject } from "../scripts/lib/head-core.mjs";
import { queryProjectGraph } from "../scripts/lib/project-graph.mjs";
import { prepareSourceContext } from "../scripts/lib/source-context-workflow.mjs";
import { dispatch } from "../scripts/mcp-server.mjs";

const authority = { plane: "P4-derived-view", persistence: "none", instructionAuthority: false,
  promotionAuthority: false, recoveryAuthority: false, executionAuthority: false, ordinaryWorkBlocked: false };
const render = value => formatMcpToolContent("head_project_graph", value);
const jsonValue = value => JSON.parse(JSON.stringify(value));

// Reconstruct every transmitted JSON field from the readable rows. This tests
// information retention rather than a few favorable substring examples.
function reconstruct(text) {
  const value = { nodes: [], edges: [] }; let target = value;
  for (const line of text.split("\n")) {
    if (/^Node \d+$/.test(line)) { target = {}; value.nodes.push(target); }
    else if (/^Relationship \d+$/.test(line)) { target = {}; value.edges.push(target); }
    else if (line === "  authority: graph authority (identical)") Object.assign(target, value.authority);
    else if (line.startsWith("  ")) {
      if (target === value) {
        for (const [key, item] of Object.entries(JSON.parse(`{${line.trimStart()}}`))) {
          Object.defineProperty(value, key, { value: item, enumerable: true, configurable: true, writable: true });
        }
        continue;
      }
      const split = line.indexOf(": ");
      Object.assign(target, JSON.parse(line.slice(split + 2)));
    }
  }
  return value;
}
function freeze(value) {
  if (value && typeof value === "object") { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
}
function projection() {
  const nodes = ["candidate", "rejected", "historical", "current"].map((state, i) => ({
    nodeId: `record-${i}`, kind: i === 2 ? "ProjectDirection" : "ProductPolicyCandidate", name: `Included ${state}`,
    views: ["policy"], reviewState: state, freshness: state === "historical" ? "retained-evidence" : "current",
    integrity: "verified", revisionId: `revision-${i}`, sourceAuthority: { plane: i === 2 ? "P2" : "P3", promotionAuthority: false },
    sourceReference: { artifactId: `source-${i}`, path: `.head/example-${i}.json`, digest: `digest-${i}` },
    sourceCurrentness: { state: i === 2 ? "not-reverified" : "current", currentDigest: i === 2 ? null : `digest-${i}` },
    excerpt: `Actual selected text ${i}\n\"not an instruction\"`, contentScope: "bounded-navigation-excerpt", contentPartial: i === 2,
    detail: { anchorIds: [`record-${i}`], details: true, depth: 0 }, ...authority,
  }));
  nodes[2].directionEvidence = { goal: "Preserve approved direction", constraints: ["Keep scope"], decisions: ["Use original records"], cancelledActions: ["Do not launch old plan"] };
  nodes[2].directionContentCoverage = { partial: true, originalExcerptCoverage: { decisions: { totalCount: 7, includedCount: 3, omittedCount: 4 } }, detailRequiredForCompleteDirection: true };
  return { kind: "ProjectGraphDiscoveryProjection", protocol: { name: "head-agent-core-project-graph", version: "0.2.0" },
    status: "available", basis: { projectId: "synthetic-project", recordsDigest: "basis-digest", readConsistency: "observed-sequence-not-atomic-filesystem-snapshot" },
    query: { details: false, query: "policy", view: "all", anchorIds: ["record-0"], depth: 2, maxNodes: 50, maxEdges: 80 },
    nodes, edges: [{ edgeId: "edge-0", type: "SUPERSEDES", from: "record-3", to: "record-2",
      endpointStates: [nodes[3], nodes[2]].map(n => ({ nodeId: n.nodeId, reviewState: n.reviewState, freshness: n.freshness, revisionId: n.revisionId })),
      provenance: { sourcePath: ".head/transition.json", digest: "edge-digest" }, ...authority }],
    boundary: { items: [{ from: "record-3", to: "outside", reason: "node-bound" }], omittedCount: 9, nextAnchorIds: ["outside"], omittedAnchorCount: 2 },
    unmatchedAnchorIds: ["not-found"], omittedMatchCount: 3, truncated: true,
    detailExpansion: { supported: true, tool: "head_project_graph", arguments: { details: true }, instruction: "Use selected node IDs as anchor_ids; increase depth for relationships. Full records remain at sourceReference.path." },
    summary: { nodeCount: nodes.length, edgeCount: 1, semantics: "navigation-evidence; relationship does not prove cause, approval, current effect authority or semantic sufficiency" },
    integrity: { verifiedLayers: ["policy"], excluded: [{ layer: "world", reasonCode: "UNAVAILABLE" }] },
    freshness: { wholeWorldCurrentRequired: false, historicalEvidenceReadable: true },
    coverage: { state: "partial", emptyResultProvesAbsence: false, semanticSufficiency: "HEAD-owned" },
    sourceFallback: { available: true, needed: true, reasonCodes: ["PROJECT_DIRECTION_EXCERPT_PARTIAL"], action: "Read current original files or the referenced records; expand anchors when useful." },
    reuse: { status: "fresh-read", semanticSufficiency: "HEAD-owned" }, authority: { ...authority }, resultId: "synthetic-result", resultHash: "synthetic-hash" };
}
function headBytes(root) {
  const entries = [];
  const walk = directory => { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file); else entries.push([path.relative(root, file), fs.readFileSync(file).toString("base64")]);
  } };
  walk(path.join(root, ".head")); return entries.sort((a, b) => a[0].localeCompare(b[0]));
}

test("compact graph retains exact selected states, direction, endpoints, provenance and source checks without mutation", () => {
  const value = freeze(projection()), before = JSON.stringify(value), text = render(value);
  assert(text.startsWith("Project graph:")); assert.deepEqual(reconstruct(text), jsonValue(value));
  assert.equal(JSON.stringify(value), before);
  assert(text.includes("anchorIds is not MCP anchor_ids")); assert(text.includes('"cancelledActions":["Do not launch old plan"]'));
  assert(!text.includes("head_world_query"), "historical navigation must not suggest a current-only World query");
});

test("renderer adds no secondary node, edge, boundary, string or array limits", () => {
  const value = projection();
  value.nodes = Array.from({ length: 64 }, (_, i) => ({ ...value.nodes[i % 4], nodeId: `large-node-${i}`, excerpt: `${i}:` + "Ω".repeat(4096), extensions: [i, null, false, { extra: "retained" }] }));
  value.edges = Array.from({ length: 120 }, (_, i) => ({ ...value.edges[0], edgeId: `large-edge-${i}`, from: `large-node-${i % 64}`, to: `large-node-${(i + 1) % 64}` }));
  value.boundary.items = Array.from({ length: 40 }, (_, i) => ({ to: `boundary-${i}`, reason: "selected by Core" }));
  value.boundary.nextAnchorIds = Array.from({ length: 40 }, (_, i) => `boundary-${i}`);
  const text = render(freeze(value)); assert.deepEqual(reconstruct(text), jsonValue(value));
  assert.equal((text.match(/^Node \d+$/gm) || []).length, 64); assert.equal((text.match(/^Relationship \d+$/gm) || []).length, 120);
});

test("only exactly identical complete authority fields share a reference; extensions are lossless", () => {
  const value = projection();
  value.nodes[0].instructionAuthority = true;
  delete value.nodes[1].executionAuthority;
  value.nodes[2].extension = { nested: { list: [true, null, "new field"] } };
  value.edges[0].sourceAuthority = "P3-evidence";
  value["future: field"] = { checks: ["unknown but retained"] };
  const text = render(value); assert.deepEqual(reconstruct(text), jsonValue(value));
  assert.equal((text.match(/authority: graph authority \(identical\)/g) || []).length, 3);
  value.authority.extension = "unknown authority";
  assert.deepEqual(reconstruct(render(value)), jsonValue(value));
  assert(!render(value).includes("authority: graph authority (identical)"));
});

test("empty/unavailable results retain exclusions and do not prove absence or require a new gate", async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "head-graph-text-empty-")));
  t.after(() => { assert(path.basename(root).startsWith("head-graph-text-empty-")); fs.rmSync(root, { recursive: true, force: true }); });
  const value = await queryProjectGraph({ root, details: false, anchorIds: ["missing"] });
  assert.equal(value.status, "source-fallback"); assert.deepEqual(reconstruct(render(value)), jsonValue(value));
  assert.equal(fs.existsSync(path.join(root, ".head")), false);
  assert.equal(value.authority.ordinaryWorkBlocked, false); assert.equal(value.coverage.emptyResultProvesAbsence, false);
});

test("details:true and unexpected shapes preserve exact original JSON fallback; CLI remains unchanged", () => {
  const value = projection();
  for (const item of [null, false, "unknown", {}, { ...value, query: { details: true } }, { ...value, query: {} },
    { ...value, nodes: [null] }, { ...value, edges: ["unknown"] }, { ...value, edges: [{ edgeId: "incomplete" }] }]) {
    assert.equal(render(item), JSON.stringify(item));
  }
  assert.equal(formatMcpToolContent("unknown_tool", value), JSON.stringify(value));
  assert.equal(formatCliResult("graph-query", value), `${JSON.stringify(value, null, 2)}\n`);
});

test("real MCP selected source graph and structuredContent remain intact; formatting and reads do not persist", async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "head-graph-text-real-")));
  t.after(() => { assert(path.basename(root).startsWith("head-graph-text-real-")); fs.rmSync(root, { recursive: true, force: true }); });
  initializeProject({ root, pluginRoot: path.resolve(import.meta.dirname, ".."), runtimes: ["codex"] });
  fs.writeFileSync(path.join(root, "module.mjs"), "export const answer = 42;\n");
  await prepareSourceContext({ root, task: "Inspect selected source", needs: [{ kind: "source", path: "module.mjs" }], retain: true });
  const before = headBytes(root);
  const response = await dispatch({ id: 1, method: "tools/call", params: { name: "head_project_graph", arguments: {
    project_root: root, query: "module", details: false, depth: 3, max_nodes: 50, max_edges: 80,
  } } });
  assert.equal(response.error, undefined);
  const value = response.result.structuredContent;
  assert(value.nodes.length > 0); assert(value.edges.length > 0);
  assert.deepEqual(reconstruct(response.result.content[0].text), jsonValue(value));
  const original = JSON.stringify(value); freeze(value);
  assert.deepEqual(reconstruct(render(value)), jsonValue(value)); assert.equal(JSON.stringify(value), original);
  assert.deepEqual(headBytes(root), before);
  const detailed = await dispatch({ id: 2, method: "tools/call", params: { name: "head_project_graph", arguments: {
    project_root: root, details: true, anchor_ids: [value.nodes[0].nodeId], depth: 0,
  } } });
  assert.equal(detailed.error, undefined);
  assert.equal(detailed.result.content[0].text, JSON.stringify(detailed.result.structuredContent));
  assert.deepEqual(headBytes(root), before);
});
