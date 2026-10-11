import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { formatMcpToolContent, formatCliResult } from "../scripts/lib/cli-presentation.mjs";
import { initializeProject } from "../scripts/lib/head-core.mjs";
import { prepareSourceContext } from "../scripts/lib/source-context-workflow.mjs";
import { dispatch } from "../scripts/mcp-server.mjs";

const render = value => formatMcpToolContent("head_project_graph", value);
const call = (root, args = {}) => dispatch({ id: 1, method: "tools/call",
  params: { name: "head_project_graph", arguments: { project_root: root, ...args } } });
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "head-graph-json-")));
  t.after(() => { assert(path.basename(root).startsWith("head-graph-json-")); fs.rmSync(root, { recursive: true, force: true }); });
  return root;
}
function bytes(root) {
  const entries = [];
  const walk = directory => { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file); else entries.push([path.relative(root, file), fs.readFileSync(file).toString("base64")]);
  } };
  walk(root); return entries.sort((a, b) => a[0].localeCompare(b[0]));
}

test("graph text uses the original exact JSON fallback, including unknown values; CLI is unchanged", () => {
  for (const value of [null, false, "unknown", {}, Object.freeze({ kind: "ProjectGraphDiscoveryProjection",
    query: { details: false }, nodes: [{ nodeId: "rejected", reviewState: "rejected", sourceAuthority: { plane: "P3" } }],
    edges: [], coverage: { state: "partial" }, "future: field": { list: [null, false, "Ω\\nquoted\\\""] } })]) {
    const original = JSON.stringify(value);
    assert.equal(render(value), original);
    assert.deepEqual(JSON.parse(render(value)), JSON.parse(original));
    assert.equal(JSON.stringify(value), original);
    assert.equal(formatCliResult("graph-query", value), `${JSON.stringify(value, null, 2)}\n`);
  }
});

test("actual MCP default, compact and detailed text parse to unchanged structuredContent without persistence", async t => {
  const root = fixture(t);
  initializeProject({ root, pluginRoot: path.resolve(import.meta.dirname, ".."), runtimes: ["codex"] });
  fs.writeFileSync(path.join(root, "module.mjs"), "export const answer = 42;\n");
  await prepareSourceContext({ root, task: "Inspect selected source", needs: [{ kind: "source", path: "module.mjs" }], retain: true });
  const before = bytes(root);
  for (const args of [{}, { details: false }, { details: true }]) {
    const response = await call(root, { query: "module", depth: 3, max_nodes: 50, max_edges: 80, ...args });
    assert.equal(response.error, undefined);
    // dispatch is in-process; MCP JSON transport omits optional undefined keys
    // from structuredContent as well as from its JSON text representation.
    const { structuredContent: value, content } = JSON.parse(JSON.stringify(response.result));
    assert(value.nodes.length > 0); assert(value.edges.length > 0);
    assert.equal(value.query.details, args.details ?? false);
    assert.equal(content[0].text, JSON.stringify(value));
    assert.deepEqual(JSON.parse(content[0].text), value);
    const original = JSON.stringify(value); Object.freeze(value);
    assert.equal(render(value), original); assert.equal(JSON.stringify(value), original);
    assert.deepEqual(bytes(root), before);
  }
});

test("MCP unavailable-source JSON keeps fallback and authority boundaries without initializing or writing", async t => {
  const root = fixture(t), before = bytes(root), response = await call(root);
  assert.equal(response.error, undefined);
  const { structuredContent: value, content } = response.result;
  assert.equal(value.status, "source-fallback");
  assert.equal(content[0].text, JSON.stringify(value));
  assert.deepEqual(JSON.parse(content[0].text), value);
  assert.equal(value.sourceFallback.needed, true);
  assert.equal(value.authority.ordinaryWorkBlocked, false);
  assert.equal(value.coverage.emptyResultProvesAbsence, false);
  assert.deepEqual(bytes(root), before);
});
