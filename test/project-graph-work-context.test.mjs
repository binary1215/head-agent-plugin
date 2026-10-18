import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { isDeepStrictEqual } from "node:util";
import { initializeProject, inspectProject } from "../scripts/lib/head-core.mjs";
import { createHeadSession, withSessionRoute } from "../scripts/lib/session-routing.mjs";
import { recordSessionWorkEvidence, readSessionWorkContext } from "../scripts/lib/session-work-context.mjs";
import { queryProjectGraph } from "../scripts/lib/project-graph.mjs";
import { runCommand } from "../scripts/head.mjs";
import { dispatch } from "../scripts/mcp-server.mjs";
import { formatCliResult } from "../scripts/lib/cli-presentation.mjs";
import { readProjectDirection, updateProjectDirection } from "../scripts/lib/project-direction.mjs";
import { sha, snapshot } from "./helpers/session-work-linkage-fixture.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const isWork = node => node.kind === "Evidence" && node.subtype === "SessionWorkEvidence";
const workNodes = value => value.nodes.filter(isWork);
function assertJsonMember(text, name, value) {
  if (value !== undefined) assert.ok(text.includes(JSON.stringify({ [name]: value }, null, 2).slice(2, -2)), `Missing original ${name}`);
}
function assertLiteralValues(text, value) {
  if (typeof value === "string") assert.ok(text.includes(value) || text.includes(JSON.stringify(value)), `Missing original literal: ${value}`);
  else if (Array.isArray(value)) for (const item of value) assertLiteralValues(text, item);
  else if (value && typeof value === "object") for (const item of Object.values(value)) assertLiteralValues(text, item);
}
function assertCommonNodes(text, nodes) {
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const members = nodes.map((value, index) => ({ value, index })).filter(({ value }) => object(value) && Object.hasOwn(value, "workContent"));
  const first = members[0]?.value;
  const eligible = members.length >= 2 && members.every(({ value }) => ["projectId", "sessionId", "kind", "subtype", "workContent"].every(key => Object.hasOwn(value, key))
    && value.kind === "Evidence" && value.subtype === "SessionWorkEvidence" && object(value.workContent)
    && ["projectId", "sessionId"].every(key => typeof value[key] === "string" && value[key].length > 0 && value[key] === first[key]));
  const expected = eligible ? Object.fromEntries(["projectId", "sessionId", "kind", "subtype", "schemaVersion", "protocol", "authorityBoundary"]
    .filter(key => Object.hasOwn(first, key) && members.every(({ value }) => Object.hasOwn(value, key)
      && typeof value[key] === typeof first[key] && JSON.stringify(value[key]) === JSON.stringify(first[key])))
    .map(key => [key, first[key]])) : {};
  const blocks = [...text.matchAll(/^Common stored fields for (.+):\n/gmu)];
  assert.equal(blocks.length, Object.keys(expected).length ? 1 : 0);
  if (blocks.length) {
    const block = blocks[0], firstNode = text.indexOf("\nNode[0]:\n");
    assert.equal(block[1], members.map(({ index }) => `Node[${index}]`).join(", "), "Common membership uses original node indices, never navigation nodes");
    assert.ok(block.index < firstNode);
    assert.deepEqual(JSON.parse(text.slice(block.index + block[0].length, firstNode)), expected);
  }
  return expected;
}
function assertGraphPresentation(text, value) {
  const common = assertCommonNodes(text, value.nodes);
  for (const name of ["coverage", "sourceFallback", "boundary"]) assertJsonMember(text, name, value[name]);
  for (const [index, node] of value.nodes.entries()) {
    const start = text.indexOf(`\nNode[${index}]:\n`), next = text.indexOf(`\nNode[${index + 1}]:\n`, start);
    assert.ok(start >= 0, `Missing Node[${index}]`);
    const edge = text.indexOf("\nEdge[0]:\n", start), end = [next, edge,
      text.indexOf("Additional original fields at graph:\n", start)].filter(offset => offset >= 0);
    const section = text.slice(start, end.length ? Math.min(...end) : undefined);
    assert.ok(section.includes(`nodeId: ${JSON.stringify(node.nodeId)}`));
    if (!isWork(node) && node.sessionId !== undefined) assert.ok(section.includes(`sessionId: ${JSON.stringify(node.sessionId)}`));
    if (isWork(node)) {
      for (const name of ["projectId", "sessionId", "kind", "subtype"]) {
        if (Object.hasOwn(node, name)) assert.equal(section.split("\n").includes(`${name}: ${JSON.stringify(node[name])}`),
          !Object.hasOwn(common, name), `Node[${index}] ${name} must be local or exact common`);
      }
      assertLiteralValues(section, node.workContent);
      for (const name of ["evidenceDigest", "referenceEvidence", "originalExpansion"]) assertJsonMember(section, name, node[name]);
      if (node.workContentCoverage) {
        const { partial, ...residual } = node.workContentCoverage;
        assert.ok(section.includes(`workContentCoverage.partial: ${JSON.stringify(partial)}`));
        for (const [name, value] of Object.entries(residual)) assertJsonMember(section, name, value);
      }
      if (node.workContentExcerpts) {
        if (!node.workContentExcerpts.length) assert.ok(section.includes("workContentExcerpts: []"));
        for (const [excerptIndex, excerpt] of node.workContentExcerpts.entries()) {
          const location = `workContentExcerpts[${excerptIndex}]`;
          for (const name of ["field", "index", "subfield", "alternativeIndex", "start", "end", "totalCharacters"]) {
            if (Object.hasOwn(excerpt, name)) assert.ok(section.includes(`${location}.${name}: ${JSON.stringify(excerpt[name])}`));
          }
          assert.ok(section.includes(`${location}.text (original text):`));
          assert.ok(section.includes(excerpt.text));
        }
      }
    }
  }
  assert.equal(text.includes(`\nNode[${value.nodes.length}]:\n`), false);
}
function fixture(t) {
  const parent = process.env.HEAD_AGENT_TEST_TMP || os.tmpdir();
  fs.mkdirSync(parent, { recursive: true });
  const base = fs.realpathSync(fs.mkdtempSync(path.join(parent, "head-graph-work-context-")));
  const root = path.join(base, "project");
  fs.mkdirSync(root);
  initializeProject({ root, pluginRoot, runtimes: ["codex"] });
  const session = createHeadSession({ root, purpose: "Synthetic graph investigation; no external effects" });
  t.after(() => {
    assert.equal(path.dirname(base), fs.realpathSync(parent));
    assert.ok(path.basename(base).startsWith("head-graph-work-context-"));
    fs.rmSync(base, { recursive: true, force: true });
  });
  return { base, root, session,
    save: (input, sessionId = session.sessionId) => withSessionRoute(root, sessionId, () => recordSessionWorkEvidence({ root, input })),
    read: options => withSessionRoute(root, session.sessionId, () => readSessionWorkContext({ root, ...options })),
  };
}
async function call(name, arguments_, routed = false, options = {}) {
  const response = await dispatch({ jsonrpc: "2.0", id: "graph-work-consumer", method: "tools/call", params: {
    name: routed ? "head_tools_read" : name,
    arguments: routed ? { name, arguments: arguments_ } : arguments_,
  } }, options);
  assert.equal(response.error, undefined, JSON.stringify(response));
  assert.notEqual(response.result?.isError, true, JSON.stringify(response));
  return response.result;
}
async function withoutGraphWrites(action) {
  const restore = [], attempts = [];
  const block = (object, name, asynchronous = false) => {
    const original = object[name];
    if (typeof original !== "function") return;
    restore.push(() => { object[name] = original; });
    const rejected = () => { attempts.push(name); assert.fail(`Read-only graph attempted ${name}`); };
    object[name] = asynchronous ? async () => rejected() : rejected;
  };
  const writable = flags => typeof flags === "number"
    ? Boolean(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND))
    : /[wa+]/u.test(flags || "");
  const guardOpen = (object, name) => {
    const original = object[name]; restore.push(() => { object[name] = original; });
    object[name] = (file, flags, ...args) => {
      if (writable(flags)) { attempts.push(name); assert.fail("Read-only graph attempted writable open"); }
      return original.call(object, file, flags, ...args);
    };
  };
  for (const name of ["writeFileSync", "appendFileSync", "writeSync", "mkdirSync", "renameSync", "unlinkSync", "rmSync", "rmdirSync", "truncateSync", "ftruncateSync", "chmodSync", "fchmodSync", "utimesSync", "linkSync", "symlinkSync", "createWriteStream"]) block(fs, name);
  for (const name of ["writeFile", "appendFile", "write", "mkdir", "rename", "unlink", "rm", "rmdir", "truncate", "ftruncate", "chmod", "fchmod", "utimes", "link", "symlink"]) block(fs, name);
  for (const name of ["writeFile", "appendFile", "mkdir", "rename", "unlink", "rm", "rmdir", "truncate", "chmod", "utimes", "link", "symlink"]) block(fs.promises, name, true);
  guardOpen(fs, "openSync"); guardOpen(fs, "open"); guardOpen(fs.promises, "open");
  try { return await action(); }
  finally { for (const undo of restore.reverse()) undo(); assert.deepEqual(attempts, [], "Caught writes still violate graph read-only behavior"); }
}
async function graphResponse(args, routed, binding) {
  const result = await call("head_project_graph", args, routed, { resolveSessionContext() {
    binding.calls++; throw new Error("Project graph must not ask for native binding");
  } });
  assertGraphPresentation(result.content[0].text, result.structuredContent);
  return result.structuredContent;
}
const originalPath = (f, saved) => path.relative(f.root, saved.file).replaceAll("\\", "/");
function scopedWorkResult(value, f, saved, referencePath) {
  const node = completeNode(value, saved);
  assert.equal(value.reuse.status, "scoped-originals-reused"); assert.equal(value.reuse.wholeProjectCurrent, false);
  assert.deepEqual(value.integrity.verifiedLayers, []);
  assert.ok(value.integrity.verifiedRecordPaths.includes(originalPath(f, saved)));
  assert.ok(value.integrity.verifiedRecordPaths.includes(referencePath));
  assert.equal(new Set(value.integrity.verifiedRecordPaths).size, value.integrity.verifiedRecordPaths.length);
  assert.ok(value.integrity.verifiedRecordPaths.length <= 256);
  assert.equal(value.integrity.verifiedRecordCount, value.integrity.verifiedRecordPaths.length + value.integrity.omittedVerifiedRecordPathCount);
  assert.match(value.basis.proofDigest, /^[a-f0-9]{64}$/u);
  assert.match(value.basis.recordsDigestScope, /retained/iu);
  assert.equal(value.coverage.membership, "current-names-and-types");
  assert.equal(value.coverage.unrelatedRecordBytesReverified, false);
  assert.ok(value.coverage.layers.every(layer => layer.status === "retained-discovery-basis"));
  assert.match(value.sourceFallback.action, /retained/iu);
  assert.match(value.sourceFallback.action, /exclu/iu);
  assert.match(value.sourceFallback.action, /historical|not a fresh/iu);
  return node;
}
function completeNode(value, saved) {
  const node = workNodes(value).find(item => item.nodeId === saved.evidence.evidenceId);
  assert.ok(node, `Missing work original ${saved.evidence.evidenceId}`);
  assert.equal(node.sessionId, saved.evidence.sessionId);
  assert.equal(node.evidenceDigest, saved.evidence.evidenceDigest);
  assert.equal(node.sourceReference.digest, sha(fs.readFileSync(saved.file)));
  assert.deepEqual(node.workContent, saved.evidence.content);
  assert.equal(node.workContentCoverage.partial, false);
  fieldCoverage(node, saved.evidence.content);
  assert.notEqual(node.contentPartial, true, "A complete work body must not be an omitted generic excerpt");
  for (const key of ["instructionAuthority", "promotionAuthority", "recoveryAuthority", "executionAuthority"]) assert.equal(node[key], false);
  return node;
}
function expansion(node, f, saved) {
  assert.equal(node.originalExpansion.tool, "head_session_work_read");
  const args = node.originalExpansion.arguments;
  assert.equal(args.project_root, f.root);
  assert.equal(args.session_id, saved.evidence.sessionId);
  assert.deepEqual(args.evidence_ids, [saved.evidence.evidenceId]);
  assert.equal(args.max_records, 1);
  assert.ok(Number.isSafeInteger(args.max_characters) && args.max_characters >= 2 && args.max_characters <= 524288);
  return args;
}
function exactResult(value, saved, args) {
  assert.equal(value.records.length, 1, "A callable expansion must return its original, not a budget-only omission");
  assert.equal(value.omissions.byBudget, 0);
  assert.equal(value.records[0].evidenceId, saved.evidence.evidenceId);
  assert.equal(value.records[0].sessionId, saved.evidence.sessionId);
  assert.equal(value.records[0].evidenceDigest, saved.evidence.evidenceDigest);
  assert.deepEqual(value.records[0].content, saved.evidence.content);
  assert.equal(args.max_characters, JSON.stringify(value.records).length);
}
function semanticCharacters(content) {
  const fields = [content.summary, ...(content.judgments || []).flatMap(item => [item.assessment, item.reason, ...item.alternatives]),
    ...["observedWork", "pending", "unknowns", "suggestedFollowUp"].flatMap(field => content[field] || [])];
  return fields.reduce((total, value) => total + (typeof value === "string" ? value.length : 0), 0);
}
function originalExcerpts(node, original) {
  const content = original.evidence.content, coverage = node.workContentCoverage;
  fieldCoverage(node, content);
  assert.equal(coverage.totalCharacters, semanticCharacters(content));
  assert.equal(coverage.totalCharacters, coverage.includedCharacters + coverage.omittedCharacters);
  assert.equal(coverage.partial, coverage.omittedCharacters > 0);
  for (const [field, value] of Object.entries(node.workContent || {})) {
    assert.ok(Object.hasOwn(content, field), `Unexpected projected work field: ${field}`);
    if (Array.isArray(value)) {
      for (const item of value) assert.ok(content[field].some(source => isDeepStrictEqual(source, item)), `Incomplete item presented as original ${field}`);
    } else assert.deepEqual(value, content[field], `Truncated value presented as complete ${field}`);
  }
  for (const excerpt of node.workContentExcerpts || []) {
    let source;
    if (excerpt.field === "judgments") {
      assert.ok(Number.isSafeInteger(excerpt.index) && excerpt.index >= 0 && excerpt.index < content.judgments.length);
      assert.ok(["assessment", "reason", "alternatives"].includes(excerpt.subfield));
      const judgment = content.judgments[excerpt.index];
      if (excerpt.subfield === "alternatives") {
        assert.ok(Number.isSafeInteger(excerpt.alternativeIndex) && excerpt.alternativeIndex >= 0 && excerpt.alternativeIndex < judgment.alternatives.length);
        source = judgment.alternatives[excerpt.alternativeIndex];
      } else source = judgment[excerpt.subfield];
    } else {
      assert.equal(excerpt.subfield, null);
      if (Array.isArray(content[excerpt.field])) {
        assert.ok(Number.isSafeInteger(excerpt.index) && excerpt.index >= 0 && excerpt.index < content[excerpt.field].length);
        source = content[excerpt.field][excerpt.index];
      } else { assert.equal(excerpt.index, null); source = content[excerpt.field]; }
    }
    assert.equal(typeof source, "string");
    assert.ok(Number.isSafeInteger(excerpt.start) && Number.isSafeInteger(excerpt.end) && excerpt.start >= 0 && excerpt.end > excerpt.start && excerpt.end <= source.length);
    assert.equal(excerpt.totalCharacters, source.length);
    assert.equal(excerpt.text, source.slice(excerpt.start, excerpt.end));
  }
}

function fieldCoverage(node, original) {
  assert.equal(node.workContentCoverage.rangeSource, "workContentExcerpts");
  for (const field of ["summary", "judgments", "observedWork", "pending", "unknowns", "suggestedFollowUp"]) {
    const originalItems = field === "summary" ? Number(typeof original.summary === "string") : original[field].length;
    const completeItems = field === "summary" ? Number(typeof node.workContent.summary === "string") : node.workContent[field].length;
    const partialItems = new Set((node.workContentExcerpts || []).filter(e => e.field === field).map(e => e.index)).size;
    const counts = node.workContentCoverage.fieldItems[field];
    assert.deepEqual(counts, { originalItems, completeItems, partialItems, omittedItems: originalItems - completeItems - partialItems });
    assert.ok(counts.omittedItems >= 0);
    if (!node.contentPartial) assert.equal(counts.completeItems, originalItems);
  }
}

test("public saved semantic fields are discoverable in fitting short, detail, path, anchor and owner-neighbor results", async t => {
  const f = fixture(t), saved = f.save({ summary: "A plain progress note", judgments: [{
    assessment: "AssessmentNeedle", reason: "Earlier context. ".repeat(40) + "ReasonNeedle preserves the original tradeoff", alternatives: ["AlternativeNeedle"] }],
    observedWork: ["ObservationNeedle"], pending: ["PendingNeedle"], unknowns: ["UnknownNeedle"], suggestedFollowUp: ["FollowUpNeedle"] });
  const before = snapshot(f.base);
  for (const query of ["AssessmentNeedle", "ReasonNeedle", "AlternativeNeedle", "ObservationNeedle", "PendingNeedle", "UnknownNeedle", "FollowUpNeedle"]) {
    completeNode(await queryProjectGraph({ root: f.root, query, depth: 0 }), saved);
  }
  const relative = path.relative(f.root, saved.file).replaceAll("\\", "/");
  for (const options of [{ paths: [relative], depth: 0 }, { anchorIds: [saved.evidence.evidenceId], depth: 0 },
    { anchorIds: [saved.evidence.evidenceId], depth: 0, details: true }, { anchorIds: [f.session.sessionId], depth: 1, maxNodes: 20, maxEdges: 30 }]) {
    const value = await queryProjectGraph({ root: f.root, ...options });
    expansion(completeNode(value, saved), f, saved);
  }
  const related = await queryProjectGraph({ root: f.root, anchorIds: [saved.evidence.evidenceId], depth: 1 });
  assert.ok(related.edges.some(edge => edge.type === "RECORDED_FOR_SESSION" && edge.from === saved.evidence.evidenceId && edge.to === f.session.sessionId));
  assert.deepEqual(snapshot(f.base), before);
});

test("CLI and direct/router MCP retain the same work body without requesting native binding or writing", async t => {
  const f = fixture(t), saved = f.save({ judgments: [{ assessment: "Keep original", reason: "SurfaceReasonNeedle", alternatives: ["Rejected alternative"] }], pending: ["X remains"], unknowns: ["Provider unverified"] });
  const before = snapshot(f.base), core = await queryProjectGraph({ root: f.root, query: "SurfaceReasonNeedle", depth: 0 });
  const expected = completeNode(core, saved), cli = await runCommand(["graph-query", f.root, "--query", "SurfaceReasonNeedle", "--depth", "0"]);
  assert.deepEqual(completeNode(cli, saved).workContent, expected.workContent);
  assertGraphPresentation(formatCliResult("graph-query", cli), cli);
  let bindingCalls = 0;
  for (const routed of [false, true]) {
    const result = await call("head_project_graph", { project_root: f.root, query: "SurfaceReasonNeedle", depth: 0 }, routed,
      { resolveSessionContext() { bindingCalls++; throw new Error("Project graph must not require native binding"); } });
    assert.deepEqual(completeNode(result.structuredContent, saved).workContent, expected.workContent);
    assertGraphPresentation(result.content[0].text, result.structuredContent);
  }
  assert.equal(bindingCalls, 0);
  assert.deepEqual(snapshot(f.base), before);
});

test("returned node detail follows direct/router MCP with default120, compact12 and explicit0 scoped keys", async t => {
  const f = fixture(t), selectedReference = "selected-source.txt", sourceBytes = Buffer.from("Small required reference; not execution authority");
  fs.writeFileSync(path.join(f.root, selectedReference), sourceBytes);
  fs.writeFileSync(path.join(f.root, "independent-source.txt"), "i".repeat(16384));
  const anchor = f.save({ summary: "Declared earlier anchor", pending: ["Earlier X remains"] });
  const exactAnchor = { evidenceId: anchor.evidence.evidenceId, evidenceDigest: anchor.evidence.evidenceDigest };
  const saved = f.save({ judgments: [{ assessment: "Preserve the original choice", reason: "ConnectedDetailReasonNeedle ".padEnd(6073, "r"), alternatives: ["Rejected rewrite"] }],
    pending: ["X remains"], unknowns: ["External effect is unknown"],
    references: [{ path: selectedReference, digest: sha(sourceBytes), kind: "source" }],
    workLink: { root: exactAnchor, predecessor: exactAnchor }, executionObservation: { state: "paused", target: exactAnchor } });
  f.save({ summary: "Independent work with an unrelated reference", references: [{ path: "independent-source.txt", digest: sha(fs.readFileSync(path.join(f.root, "independent-source.txt"))), kind: "source" }] });
  const direction = updateProjectDirection({ root: f.root, input: { goal: "Inspect retained graph evidence only", constraints: ["No external effects"], cancelledActions: ["deployment"] } }).direction;
  const before = snapshot(f.base), binding = { calls: 0 };
  await withoutGraphWrites(async () => {
    const broad = await queryProjectGraph({ root: f.root, query: "ConnectedDetailReasonNeedle", depth: 0 });
    const discovered = completeNode(broad, saved), detail = structuredClone(discovered.detail);
    assert.deepEqual(detail.anchorIds, [saved.evidence.evidenceId]); assert.equal(detail.details, true); assert.equal(detail.depth, 0);
    assert.equal(Object.hasOwn(detail, "maxEdges"), false, "Follow the actual returned detail without silently forcing zero edges");
    const keys = new Set();
    for (const mode of [
      { details: detail.details, expectedEdges: 120 },
      { details: false, expectedEdges: 12 },
      { details: detail.details, maxEdges: 0, expectedEdges: 0 },
    ]) {
      const args = { project_root: f.root, anchor_ids: detail.anchorIds, details: mode.details, depth: detail.depth,
        ...(mode.maxEdges !== undefined ? { max_edges: mode.maxEdges } : {}) };
      const first = await graphResponse(args, false, binding);
      assert.equal(first.query.maxEdges, mode.expectedEdges); assert.equal(first.query.details, mode.details);
      assert.equal(first.query.maxNodes, mode.details ? 60 : 8); assert.equal(first.query.depth, detail.depth);
      assert.deepEqual(first.query.anchorIds, detail.anchorIds);
      const original = completeNode(first, saved);
      assert.equal(original.referenceEvidence[0].currentness, "current"); assert.equal(original.referenceEvidence[0].currentDigest, sha(sourceBytes));
      assert.ok(first.boundary.nextAnchorIds.includes(f.session.sessionId), "Depth0 still discloses its incident boundary");
      assert.equal(first.edges.length, 0);
      for (const routed of [false, true]) {
        const warm = await graphResponse(args, routed, binding), node = scopedWorkResult(warm, f, saved, selectedReference);
        assert.equal(warm.query.maxEdges, mode.expectedEdges); assert.equal(warm.query.details, mode.details);
        assert.deepEqual(node.workContent, original.workContent); assert.deepEqual(node.workContentCoverage, original.workContentCoverage);
        assert.deepEqual(node.referenceEvidence, original.referenceEvidence); assert.deepEqual(node.originalExpansion, original.originalExpansion);
        assert.deepEqual(node.sourceReference, original.sourceReference); assert.deepEqual(warm.boundary, first.boundary);
        assert.deepEqual(warm.edges, first.edges); assert.deepEqual(warm.unmatchedAnchorIds, first.unmatchedAnchorIds);
        assert.equal(warm.omittedMatchCount, first.omittedMatchCount);
        assert.deepEqual(node.workContent.pending, ["X remains"]); assert.deepEqual(node.workContent.unknowns, ["External effect is unknown"]);
        keys.add(warm.resultId);
        node.workContent.pending[0] = "Caller mutation must not enter cache";
        warm.boundary.nextAnchorIds.push("caller-supplied-anchor");
        const repeated = await graphResponse(args, routed, binding);
        assert.deepEqual(completeNode(repeated, saved).workContent, original.workContent);
        assert.deepEqual(repeated.boundary, first.boundary);
      }
    }
    assert.equal(keys.size, 3, "Normalized default120/default12/explicit0 queries retain separate identities");
    assert.deepEqual(readProjectDirection({ root: f.root }), direction);
  });
  assert.equal(binding.calls, 0); assert.deepEqual(snapshot(f.base), before);
});

test("partial matched anchors and unsupported detail queries retain conservative proof or cold fallback", async t => {
  const f = fixture(t), selected = f.save({ summary: "ConservativeDetailNeedle one", pending: ["X remains"], unknowns: ["Unknown effect"] });
  const other = f.save({ summary: "ConservativeDetailNeedle two" }), independent = f.save({ summary: "Independent unselected work" });
  const before = snapshot(f.base), binding = { calls: 0 };
  await withoutGraphWrites(async () => {
    const found = await queryProjectGraph({ root: f.root, query: "ConservativeDetailNeedle", depth: 0 });
    const detail = completeNode(found, selected).detail;
    const cases = [
      { label: "partial-matched", args: { anchor_ids: [...detail.anchorIds, other.evidence.evidenceId], details: detail.details, depth: detail.depth, max_nodes: 1 } },
      { label: "unmatched", args: { anchor_ids: [...detail.anchorIds, "work-evidence-" + "f".repeat(24)], details: detail.details, depth: detail.depth } },
      { label: "depth1", args: { anchor_ids: detail.anchorIds, details: detail.details, depth: 1 } },
      { label: "text-query", args: { anchor_ids: detail.anchorIds, details: detail.details, depth: detail.depth, query: "ConservativeDetailNeedle" } },
    ];
    for (const entry of cases) {
      const args = { project_root: f.root, ...entry.args };
      await graphResponse(args, false, binding);
      for (const routed of [false, true]) {
        const value = await graphResponse(args, routed, binding);
        assert.equal(value.query.maxEdges, 120);
        for (const node of workNodes(value)) completeNode(value, [selected, other, independent].find(saved => saved.evidence.evidenceId === node.nodeId));
        if (entry.label === "partial-matched") {
          assert.equal(workNodes(value).length, 1); assert.equal(value.omittedMatchCount, 1);
          assert.deepEqual(value.unmatchedAnchorIds, [], "Matched-but-unreturned is not an unmatched anchor");
        }
        if (entry.label === "unmatched") {
          assert.deepEqual(value.unmatchedAnchorIds, ["work-evidence-" + "f".repeat(24)]);
          assert.notEqual(value.reuse?.status, "scoped-originals-reused", "An unresolved requested anchor cannot prime narrow reuse");
        }
        if (value.reuse?.status === "scoped-originals-reused") {
          for (const saved of [selected, other, independent]) assert.ok(value.integrity.verifiedRecordPaths.includes(originalPath(f, saved)), `${entry.label}: unsupported narrowing must retain the old conservative work proof`);
        }
      }
    }
  });
  assert.equal(binding.calls, 0); assert.deepEqual(snapshot(f.base), before);
});

test("identical text in separate Sessions keeps distinct graph identity and exact expansion ownership", async t => {
  const f = fixture(t), other = createHeadSession({ root: f.root, purpose: "Independent second owner" });
  const direction = updateProjectDirection({ root: f.root, input: { goal: "Inspect retained work only", constraints: ["No external effects"], cancelledActions: ["deploy"] } }).direction;
  const input = { judgments: [{ assessment: "Same", reason: "DistinctOwnerNeedle", alternatives: ["Same alternative"] }] };
  const a = f.save(input), b = f.save(input, other.sessionId), d = f.save(input, inspectProject(f.root).state.sessionId), before = snapshot(f.base);
  assert.notEqual(a.evidence.evidenceId, b.evidence.evidenceId);
  const found = await queryProjectGraph({ root: f.root, query: "DistinctOwnerNeedle", depth: 0 });
  assert.equal(workNodes(found).length, 3);
  assert.equal(new Set(workNodes(found).map(node => node.nodeId)).size, 3);
  for (const saved of [a, b, d]) {
    const args = expansion(completeNode(found, saved), f, saved);
    const result = await call("head_session_work_read", args);
    exactResult(result.structuredContent, saved, args);
  }
  assert.deepEqual(readProjectDirection({ root: f.root }), direction);
  assert.deepEqual(snapshot(f.base), before);
});

test("one near-limit work keeps its full reason in question, path, anchor and neighbor output despite navigation nodes", async t => {
  const f = fixture(t), reason = "LargeSingleReasonNeedle " + "r".repeat(59000), saved = f.save({
    judgments: [{ assessment: "Preserve the exact long reason", reason, alternatives: ["Do not replace it with a generic prefix"] }], pending: ["X"], unknowns: ["External effect unknown"] });
  assert.ok(fs.statSync(saved.file).size > 58000 && fs.statSync(saved.file).size <= 65536);
  const originalDefault = f.read({ evidenceIds: [saved.evidence.evidenceId], maxRecords: 1 });
  assert.equal(originalDefault.records.length, 0); assert.equal(originalDefault.omissions.byBudget, 1);
  const before = snapshot(f.base), relative = path.relative(f.root, saved.file).replaceAll("\\", "/");
  for (const options of [{ query: "LargeSingleReasonNeedle", depth: 1 }, { paths: [relative], depth: 1 },
    { anchorIds: [saved.evidence.evidenceId], depth: 1 }, { anchorIds: [f.session.sessionId], depth: 1, maxNodes: 20, maxEdges: 30 },
    { anchorIds: [saved.evidence.evidenceId], details: true, depth: 1 }]) {
    const value = await queryProjectGraph({ root: f.root, ...options });
    assert.equal(workNodes(value).length, 1);
    assert.ok(value.nodes.some(node => !isWork(node)), "The single-work rule must count work originals, not navigation nodes");
    const args = expansion(completeNode(value, saved), f, saved);
    assert.ok(args.max_characters > 32768);
    for (const routed of [false, true]) exactResult((await call("head_session_work_read", args, routed)).structuredContent, saved, args);
  }
  assert.deepEqual(snapshot(f.base), before);
});

test("graph-generated exact expansion fits the actual enriched record through reader, CLI and direct/router MCP", async t => {
  const f = fixture(t), anchor = f.save({ summary: "Referenced original" });
  const saved = f.save({ judgments: [{ assessment: "Long linked reason", reason: "EnrichedExactNeedle " + "e".repeat(58000), alternatives: ["Keep the original alternatives"] }],
    workLink: { root: { evidenceId: anchor.evidence.evidenceId, evidenceDigest: anchor.evidence.evidenceDigest }, predecessor: { evidenceId: anchor.evidence.evidenceId, evidenceDigest: anchor.evidence.evidenceDigest } },
    executionObservation: { state: "ended", target: { evidenceId: anchor.evidence.evidenceId, evidenceDigest: anchor.evidence.evidenceDigest } },
    references: [{ path: path.relative(f.root, anchor.file).replaceAll("\\", "/"), digest: sha(fs.readFileSync(anchor.file)), kind: "artifact" }], pending: ["X remains"] });
  const value = await queryProjectGraph({ root: f.root, anchorIds: [saved.evidence.evidenceId], depth: 0 });
  const args = expansion(completeNode(value, saved), f, saved);
  const inputFile = path.join(f.base, "exact-reader-input.json");
  fs.writeFileSync(inputFile, JSON.stringify({ evidenceIds: args.evidence_ids, maxRecords: args.max_records, maxCharacters: args.max_characters }));
  const before = snapshot(f.base);
  exactResult(f.read({ evidenceIds: args.evidence_ids, maxRecords: args.max_records, maxCharacters: args.max_characters }), saved, args);
  exactResult(await runCommand(["session-work-read", f.root, "--session", args.session_id, "--input", inputFile]), saved, args);
  for (const routed of [false, true]) exactResult((await call("head_session_work_read", args, routed)).structuredContent, saved, args);
  assert.deepEqual(snapshot(f.base), before);
});

test("multiple small 6073-character reasons automatically fit together beyond the old default body budget", async t => {
  const f = fixture(t), saved = [];
  for (let i = 0; i < 6; i++) saved.push(f.save({ judgments: [{ assessment: `Choice ${i}`, reason: ("SmallBundleReasonNeedle " + String(i) + " ").padEnd(6073, "s"), alternatives: [`Alternative ${i}`] }], pending: [`X${i}`], unknowns: [`Unknown ${i}`] }));
  const before = snapshot(f.base);
  for (const details of [false, true]) {
    const value = await queryProjectGraph({ root: f.root, query: "SmallBundleReasonNeedle", depth: 0, details });
    assert.equal(workNodes(value).length, saved.length);
    for (const original of saved) completeNode(value, original);
    assert.ok(JSON.stringify(workNodes(value).map(node => node.workContent)).length > 32768);
  }
  assert.deepEqual(snapshot(f.base), before);
});

test("large multiple work bodies disclose real original excerpts and preserve exact expansion instead of claiming complete text", async t => {
  const f = fixture(t), saved = [];
  for (let i = 0; i < 10; i++) saved.push(f.save({ judgments: [{ assessment: `Large choice ${i}`, reason: `LargeBundleReasonNeedle ${i} 가🙂 ` + String(i).repeat(58000), alternatives: [`Alternative ${i}`] }], pending: [`Pending ${i}`], unknowns: [`Unknown ${i}`] }));
  const before = snapshot(f.base);
  for (const options of [{ details: false, expected: 8 }, { details: true, expected: 10 }, { details: true, maxNodes: 500, expected: 10 }]) {
    const { expected, ...queryOptions } = options;
    const value = await queryProjectGraph({ root: f.root, query: "LargeBundleReasonNeedle", depth: 0, maxEdges: 0, ...queryOptions });
    const nodes = workNodes(value), partial = nodes.filter(node => node.workContentCoverage.partial);
    assert.equal(nodes.length, expected); assert.ok(partial.length > 0);
    for (const node of nodes) {
      const original = saved.find(item => item.evidence.evidenceId === node.nodeId);
      expansion(node, f, original);
      originalExcerpts(node, original);
      if (!node.workContentCoverage.partial) assert.deepEqual(node.workContent, original.evidence.content);
      assert.ok(node.workContent.pending?.length || node.workContentExcerpts?.some(excerpt => excerpt.field === "pending"), "Every represented node must retain its original pending work");
      assert.ok(node.workContent.unknowns?.length || node.workContentExcerpts?.some(excerpt => excerpt.field === "unknowns"), "Every represented node must retain its original unknowns");
    }
    assert.ok(partial.some(node => Array.isArray(node.workContentExcerpts) && node.workContentExcerpts.length > 0), "Partial long reasons need actual original ranges, not paths alone");
    t.diagnostic(JSON.stringify({ scope: "synthetic-graph-presentation-only", details: options.details, maxNodes: value.query.maxNodes, workNodes: nodes.length, partial: partial.length,
      coreCharacters: JSON.stringify(value).length, coreBytes: Buffer.byteLength(JSON.stringify(value)), cliPrettyBytes: Buffer.byteLength(formatCliResult("graph-query", value)) }));
  }
  assert.deepEqual(snapshot(f.base), before);
});

test("escaped semantic text fits real JSON shares without dropping reasons, pending or unknowns", async t => {
  const f = fixture(t), saved = [];
  for (let i = 0; i < 2; i++) saved.push(f.save({
    summary: `EscapedBudgetNeedle ${i}`,
    judgments: [{ assessment: "Keep uncertainty", reason: '"'.repeat(10000), alternatives: [] }],
    pending: ["\\".repeat(5000)], unknowns: ["\u0001".repeat(2000)],
  }));
  const before = snapshot(f.base), options = { root: f.root, query: "EscapedBudgetNeedle", depth: 0, maxEdges: 0 };
  const core = await queryProjectGraph(options), cli = await runCommand(["graph-query", f.root, "--query", options.query, "--depth", "0", "--max-edges", "0"]);
  const mcp = (await call("head_project_graph", { project_root: f.root, query: options.query, depth: 0, max_edges: 0 })).structuredContent;
  for (const result of [core, cli, mcp]) {
    const nodes = workNodes(result); assert.equal(nodes.length, 2);
    assert.ok(nodes.reduce((sum, node) => sum + JSON.stringify({ workContent: node.workContent, workContentExcerpts: node.workContentExcerpts }).length, 0) <= 32768);
    for (const node of nodes) {
      const original = saved.find(item => item.evidence.evidenceId === node.nodeId);
      originalExcerpts(node, original);
      for (const field of ["pending", "unknowns"]) assert.ok(node.workContent[field].length || node.workContentExcerpts.some(e => e.field === field && e.text.length));
      assert.ok(node.workContent.judgments.some(j => j.reason.length) || node.workContentExcerpts.some(e => e.subfield === "reason" && e.text.length));
    }
  }
  assert.deepEqual(workNodes(core).map(n => [n.workContent, n.workContentExcerpts, n.workContentCoverage]), workNodes(mcp).map(n => [n.workContent, n.workContentExcerpts, n.workContentCoverage]));
  assert.deepEqual(snapshot(f.base), before);
});

test("escaped unknowns alone and surrogate-rich reasons preserve exact nonempty ranges", async t => {
  const f = fixture(t), saved = [];
  for (let i = 0; i < 2; i++) saved.push(f.save({ summary: `EscapedUnknownNeedle ${i}`, unknowns: ['"'.repeat(25000)] }));
  for (let i = 0; i < 2; i++) saved.push(f.save({ summary: `SurrogateBudgetNeedle ${i}`,
    judgments: [{ assessment: "Retain code points", reason: '🙂"\\\u0001'.repeat(4000), alternatives: [] }] }));
  for (const query of ["EscapedUnknownNeedle", "SurrogateBudgetNeedle"]) {
    const result = await queryProjectGraph({ root: f.root, query, depth: 0, maxEdges: 0 });
    assert.equal(workNodes(result).length, 2);
    for (const node of workNodes(result)) {
      const original = saved.find(item => item.evidence.evidenceId === node.nodeId); originalExcerpts(node, original);
      const excerpts = node.workContentExcerpts.filter(e => query === "EscapedUnknownNeedle" ? e.field === "unknowns" : e.subfield === "reason");
      assert.ok(excerpts.length > 0);
      for (const entry of excerpts) {
        assert.ok(entry.text.length > 0); assert.equal(entry.text.isWellFormed(), true);
      }
    }
  }
});
