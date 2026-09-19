// Local, domain-neutral comparison; bytes are NOT provider-token/cost estimates.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initializeProject } from "./lib/head-core.mjs";
import { buildWorldModel } from "./lib/world-model.mjs";
import { createRepositoryScanReferenceAdapter } from "./lib/repository-scan.mjs";
import { dispatch } from "./mcp-server.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const root = fs.mkdtempSync(path.join(process.env.HEAD_AGENT_TEST_TMP || os.tmpdir(), "declaration-measure-"));
const events = [], measurements = [];
const onProcess = (event) => { events.push(event); process.stderr.write(`${JSON.stringify({ sourceProcess: event })}\n`); };
const bytes = (value) => Buffer.byteLength(JSON.stringify(value));
const selected = 'def target(value: str = "a  b"):\n    return value.strip()';
const large = Array.from({ length: 40 }, (_, i) => `def helper${i}():\n    return "${"x".repeat(900)}"\n\n`).join("") + selected + "\n";
const small = "def small(): return 1\n";
const sourceNeed = (kind, symbol = "", selection) => ({ kind, path: "module.py", symbol, ...(selection ? { selection } : {}) });
async function call(label, name, args) {
  const start = performance.now(), offset = events.length;
  const response = await dispatch({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: { project_root: root, ...args } } }, { onProcess });
  if (response.error || response.result?.isError) throw new Error(JSON.stringify(response));
  const result = response.result.structuredContent;
  measurements.push({ label, calls: 1, elapsedMs: performance.now() - start, structuredBytes: bytes(result), envelopeBytes: bytes(response),
    childProcesses: events.slice(offset).filter((e) => e.event === "started").length, status: result.status ?? "returned" });
  return result;
}
async function source(label, needs) { return call(label, "head_source_context", { task: "Read target declaration", needs }); }
try {
  const start = performance.now(); initializeProject({ root, pluginRoot, runtimes: ["codex"] });
  const commonInitializationMs = performance.now() - start;
  fs.writeFileSync(path.join(root, "module.py"), large);
  for (const pass of ["initial", "repeated"]) {
    await source(`large.source.${pass}`, [sourceNeed("source")]);
    const exact = await source(`large.known-selected.${pass}`, [sourceNeed("selected-source", "target")]);
    if (JSON.parse(exact.context.capsule.observationEvidence[0].payload.details).source !== selected) throw new Error("exact source mismatch");
    const outline = await source(`large.unfamiliar-outline.${pass}`, [sourceNeed("declarations")]);
    const declaration = JSON.parse(outline.context.capsule.observationEvidence[0].payload.details).declarations.find((d) => d.qualifiedName === "target");
    await source(`large.unfamiliar-selected.${pass}`, [sourceNeed("selected-source", "target", declaration.selection)]);
  }
  const buildStart = performance.now();
  await buildWorldModel({ root, computeAdapter: createRepositoryScanReferenceAdapter() });
  measurements.push({ label: "world.build", calls: 1, elapsedMs: performance.now() - buildStart, childProcesses: 0,
    structuredBytes: null, envelopeBytes: null, note: "local JS build prerequisite; output not sent to a model" });
  for (const pass of ["initial", "repeated"]) {
    const graph = await call(`world.query.${pass}`, "head_world_query", { query: "module.py", depth: 0, limit: 500 });
    const symbol = graph.nodes.find((n) => n.kind === "Symbol" && n.qualifiedName === "target");
    if (!symbol) throw new Error("World target missing");
    const directStart = performance.now();
    const text = fs.readFileSync(path.join(root, "module.py"), "utf8");
    const excerpt = text.split("\n").slice(symbol.line - 1, symbol.endLine).join("\n");
    measurements.push({ label: `world.direct-range.${pass}`, calls: 1, elapsedMs: performance.now() - directStart, childProcesses: 0,
      structuredBytes: bytes({ path: "module.py", source: excerpt }), envelopeBytes: null, exactEqual: excerpt === selected,
      containsTarget: excerpt.includes(selected), note: "direct local read; no invented MCP envelope; World range may include trailing newline" });
  }
  fs.writeFileSync(path.join(root, "module.py"), small);
  await source("small.source.initial", [sourceNeed("source")]);
  await source("small.source.repeated", [sourceNeed("source")]);
  await source("small.selected.initial", [sourceNeed("selected-source", "small")]);
  fs.writeFileSync(path.join(root, "module.py"), "def f(): pass\ndef f(): return 1\n");
  await source("failure.ambiguous", [sourceNeed("selected-source", "f")]);
  const outline = await source("failure.outline", [sourceNeed("declarations")]);
  const old = JSON.parse(outline.context.capsule.observationEvidence[0].payload.details).declarations[0].selection;
  fs.appendFileSync(path.join(root, "module.py"), "# changed\n");
  await source("failure.stale", [sourceNeed("selected-source", "f", old)]);
  fs.writeFileSync(path.join(root, "module.py"), "def broken(\n");
  await source("failure.parse", [sourceNeed("declarations")]);
  const started = events.filter((e) => e.event === "started"), closed = events.filter((e) => e.event === "closed");
  if (started.some((e) => !closed.some((c) => c.pid === e.pid))) throw new Error("unclosed child");
  console.log(JSON.stringify({ fixture: "synthetic generic Python helpers", largeSourceBytes: Buffer.byteLength(large), smallSourceBytes: Buffer.byteLength(small),
    commonInitializationMs, measurements, userInterventions: 0, scope: "one local sample; current working-tree implementation; no provider invocation",
    providerTokens: "UNKNOWN", providerCost: "UNKNOWN", hostSavings: "UNKNOWN", processesClosed: started.length }, null, 2));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
