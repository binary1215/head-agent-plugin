import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { createHeadSession, withSessionRoute, sessionStatePath } from "../scripts/lib/session-routing.mjs";
import { recordSessionWorkEvidence } from "../scripts/lib/session-work-context.mjs";
import { queryProjectGraph, indexProjectGraph } from "../scripts/lib/project-graph.mjs";
import { PROJECT_GRAPH_INDEX_PATH, collectProjectGraphInventory } from "../scripts/lib/discovery-index.mjs";
import { createSessionWorkReadContext } from "../scripts/lib/session-work-evidence-original.mjs";
import { createWholePlanSnapshot } from "../scripts/lib/execution-lineage.mjs";
import { fixture, exact, link, citation, snapshot, sha, encoded } from "./helpers/session-work-linkage-fixture.mjs";

// Public local writers/readers and synthetic faults only. No subprocess,
// installed Host, provider, model or actual execution evidence.
const relative = (f, file) => path.relative(f.root, file).replaceAll("\\", "/");

test("work read cache saturation does not reject an otherwise valid reference", t => {
  const f = fixture(t), originalRead = fs.readFileSync, shared = Buffer.alloc(16 * 1024 * 1024);
  const names = Array.from({ length: 9 }, (_, i) => `cache-reference-${i}.txt`);
  const targets = new Set(names.map(name => path.join(f.root, name)));
  for (const name of names) fs.writeFileSync(path.join(f.root, name), "stub");
  // Mock logical cache occupancy without writing/allocating nine large files.
  fs.readFileSync = function (file, ...args) {
    return targets.has(String(file)) ? shared : originalRead.call(this, file, ...args);
  };
  try {
    const context = createSessionWorkReadContext(f.root);
    for (const name of names) assert.equal(context.read(name, shared.length), shared);
    assert.equal(context.read(names.at(-1), shared.length), shared);
    assert.throws(() => context.read(names.at(-1), 65536), { code: "SESSION_WORK_REFERENCE_UNAVAILABLE" });
  } finally { fs.readFileSync = originalRead; }
});
const indexFile = f => path.join(f.root, PROJECT_GRAPH_INDEX_PATH);
const q = (f, saved, extra = {}) => ({ root: f.root, anchorIds: [saved.evidence.evidenceId], view: "work", details: true,
  depth: 0, maxNodes: 1, maxEdges: 0, ...extra });
const nodeFor = (result, saved) => result.nodes.find(node => node.nodeId === saved.evidence.evidenceId);
const edgeFor = (result, type, from, to) => result.edges.find(edge => edge.type === type
  && edge.from === from.evidence.evidenceId && edge.to === (to.evidence?.evidenceId || to.sessionId));
function noAuthority(result) {
  for (const value of [result.authority, ...result.nodes, ...result.edges]) {
    for (const field of ["instructionAuthority", "promotionAuthority", "recoveryAuthority", "executionAuthority"]) assert.equal(value[field], false);
  }
  assert.equal(result.authority.ordinaryWorkBlocked, false);
}
function assertWork(result, saved) {
  const node = nodeFor(result, saved); assert.ok(node, "Missing exact work original " + saved.evidence.evidenceId);
  assert.equal(node.kind, "Evidence"); assert.equal(node.subtype, "SessionWorkEvidence");
  assert.equal(node.sessionId, saved.evidence.sessionId); assert.equal(node.evidenceDigest, saved.evidence.evidenceDigest);
  assert.deepEqual(node.workContent, saved.evidence.content);
  assert.equal(node.sourceReference.digest, sha(fs.readFileSync(saved.file)));
  noAuthority(result); return node;
}
function replaceSameMetadata(file, before, after) {
  const stat = fs.statSync(file), text = fs.readFileSync(file, "utf8");
  assert.ok(text.includes(before)); const changed = text.replace(before, after);
  assert.equal(Buffer.byteLength(changed), Buffer.byteLength(text));
  fs.writeFileSync(file, changed); fs.utimesSync(file, stat.atime, stat.mtime);
}
async function warm(f, saved, extra = {}) {
  indexProjectGraph({ root: f.root });
  const request = q(f, saved, extra);
  // Re-priming can encounter the independent same-basis result cache after a
  // cold comparison. A nonmatching previousResult takes the existing public
  // original-backed path through remember, rather than that early return.
  const cold = await queryProjectGraph({ ...request, previousResult: { resultId: "not-a-retained-prime-result" } });
  assert.equal(cold.reuse.status, "fresh-read");
  const reused = await queryProjectGraph({ ...request, previousResult: cold });
  assert.equal(reused.reuse.status, "scoped-originals-reused");
  assert.equal(reused.reuse.wholeProjectCurrent, false);
  assert.deepEqual(reused.nodes, cold.nodes); assert.deepEqual(reused.edges, cold.edges);
  noAuthority(reused); return { request, cold, reused };
}
// Only the current selected payload/incident navigation is compared with a new
// original-backed discovery. Retained inventory/layer/exclusion diagnostics are
// deliberately not represented as a fresh whole-Project observation.
const selectedProjection = result => ({ nodes: result.nodes, edges: result.edges, boundary: result.boundary,
  unmatchedAnchorIds: result.unmatchedAnchorIds, omittedMatchCount: result.omittedMatchCount, truncated: result.truncated });
async function compareWithCold(request, actual) {
  // A deliberately nonmatching previous result uses the existing cold path;
  // callers neither seed the private cache nor supply verification authority.
  const cold = await queryProjectGraph({ ...request, previousResult: { resultId: "not-a-retained-result" } });
  assert.notEqual(cold.reuse.status, "scoped-originals-reused");
  assert.deepEqual(selectedProjection(actual), selectedProjection(cold));
  noAuthority(actual); noAuthority(cold); return cold;
}
function changeValidHeader(saved) {
  const stat = fs.statSync(saved.file), bytes = fs.readFileSync(saved.file), { evidenceDigest, ...payload } = JSON.parse(bytes);
  payload.recordedAt = new Date(Date.parse(payload.recordedAt) + 1000).toISOString();
  const evidence = { ...payload, evidenceDigest: sha(encoded(payload)) }, changed = JSON.stringify(evidence, null, 2) + "\n";
  assert.notEqual(evidence.evidenceDigest, evidenceDigest); assert.equal(Buffer.byteLength(changed), bytes.length);
  fs.writeFileSync(saved.file, changed); fs.utimesSync(saved.file, stat.atime, stat.mtime);
  saved.evidence = evidence; return bytes;
}

test("new default/named public work publications add exact index paths without scanning unrelated work bodies", t => {
  const f = fixture(t), defaultSaved = recordSessionWorkEvidence({ root: f.root, input: { summary: "Default work original" } });
  const unrelated = f.save({ summary: "Unrelated named work" });
  assert.ok(relative(f, defaultSaved.file).startsWith(".head/sessions/work-evidence/"));
  assert.ok(relative(f, unrelated.file).startsWith(".head/sessions/by-id/" + f.session.sessionId + "/work-evidence/"));
  const read = fs.readFileSync; let unrelatedReads = 0;
  fs.readFileSync = (file, ...args) => { if (file === unrelated.file) unrelatedReads++; return read(file, ...args); };
  let saved; try { saved = f.save({ summary: "New exact incremental work hint" }); } finally { fs.readFileSync = read; }
  assert.equal(saved.status, "session_work_evidence_recorded"); assert.equal(saved.writes, 1);
  assert.equal(unrelatedReads, 0, "A compatible mutation hint must not refresh every saved work body");
  const index = JSON.parse(fs.readFileSync(indexFile(f), "utf8"));
  for (const original of [defaultSaved, unrelated, saved]) {
    const entry = index.entries.find(item => item.path === relative(f, original.file));
    assert.ok(entry); assert.equal(entry.sha256, sha(fs.readFileSync(original.file)));
    assert.equal(entry.bytes, fs.statSync(original.file).size);
  }
  assert.ok(index.readerDependencies.sessionWork);
});

test("intact retry writes zero and never repairs an absent index or revalidates a disappeared dependency", t => {
  const f = fixture(t), root = f.save({ summary: "Root" }), input = { summary: "Already retained result", workLink: link(root), references: [citation(f, root)] };
  const saved = f.save(input); fs.unlinkSync(root.file); fs.unlinkSync(indexFile(f));
  const before = snapshot(f.base), read = fs.readFileSync; let indexReads = 0;
  fs.readFileSync = (file, ...args) => {
    if (file === indexFile(f)) { indexReads++; throw new Error("Retry must not inspect/repair the graph index"); }
    return read(file, ...args);
  };
  let retried; try { retried = f.save(input); } finally { fs.readFileSync = read; }
  assert.equal(retried.status, "session_work_evidence_reused"); assert.equal(retried.writes, 0);
  assert.equal(retried.evidence.evidenceId, saved.evidence.evidenceId);
  assert.equal(retried.evidence.evidenceDigest, saved.evidence.evidenceDigest);
  assert.equal(retried.executionReplayAllowed, false); assert.equal(indexReads, 0);
  assert.equal(fs.existsSync(indexFile(f)), false); assert.deepEqual(snapshot(f.base), before);
});

test("post-commit graph publication failure preserves primary success and reports only deferred graph evidence", t => {
  const f = fixture(t); f.save({ summary: "Prime a compatible graph index" });
  const rename = fs.renameSync; let injected = 0;
  fs.renameSync = (source, target) => {
    if (target === indexFile(f)) { injected++; throw Object.assign(new Error("Synthetic derived failure"), { code: "EIO" }); }
    return rename(source, target);
  };
  let saved; try { saved = f.save({ summary: "Primary evidence survives failed graph update" }); } finally { fs.renameSync = rename; }
  assert.ok(injected > 0); assert.equal(saved.status, "session_work_evidence_recorded"); assert.equal(saved.writes, 1);
  assert.equal(saved.persisted, true); assert.equal(fs.existsSync(saved.file), true);
  assert.equal(saved.graphIndex.status, "deferred"); assert.equal(saved.graphIndex.ordinaryWorkBlocked, false);
  assert.ok(typeof saved.graphIndex.reasonCode === "string");
  const bytes = fs.readFileSync(saved.file), retried = f.save({ summary: "Primary evidence survives failed graph update" });
  assert.equal(retried.writes, 0); assert.deepEqual(fs.readFileSync(saved.file), bytes);
});

test("primary permission and post-publication acknowledgement failures remain errors, never deferred successes", t => {
  const f = fixture(t), linkSync = fs.linkSync;
  for (const published of [false, true]) {
    const input = { summary: "Primary error, published " + published }, before = snapshot(f.base);
    fs.linkSync = (source, target) => {
      if (String(target).includes("work-evidence")) {
        if (published) linkSync(source, target);
        throw Object.assign(new Error("Synthetic primary failure"), { code: published ? "EIO" : "EACCES" });
      }
      return linkSync(source, target);
    };
    try { assert.throws(() => f.save(input), { code: published ? "EIO" : "EACCES" }); } finally { fs.linkSync = linkSync; }
    if (!published) assert.deepEqual(snapshot(f.base), before);
    else {
      const afterFailure = snapshot(f.base), retry = f.save(input);
      assert.equal(retry.writes, 0); assert.equal(retry.status, "session_work_evidence_reused");
      assert.deepEqual(snapshot(f.base), afterFailure);
    }
  }
});

test("primary validation and partial staging writes fail before graph hints and preserve prior originals", t => {
  const f = fixture(t), before = snapshot(f.base);
  assert.throws(() => f.save({ summary: "No authority injection", approvedDecisions: ["Injected approval"] }), { code: "INVALID_SESSION_WORK_EVIDENCE" });
  const open = fs.openSync, write = fs.writeFileSync, descriptors = new Set(); let injected = false;
  fs.openSync = (file, ...args) => {
    const descriptor = open(file, ...args);
    if (String(file).includes(".work-evidence-") && String(file).endsWith(".tmp")) descriptors.add(descriptor);
    return descriptor;
  };
  fs.writeFileSync = (file, content, ...args) => {
    if (descriptors.has(file)) {
      injected = true; write(file, String(content).slice(0, 31), ...args);
      throw Object.assign(new Error("Synthetic partial primary stage"), { code: "EIO" });
    }
    return write(file, content, ...args);
  };
  try { assert.throws(() => f.save({ summary: "Partial primary write is not graph deferred" }), { code: "EIO" }); }
  finally { fs.openSync = open; fs.writeFileSync = write; }
  assert.equal(injected, true); assert.deepEqual(snapshot(f.base), before);
});

test("primary staging cleanup failure propagates after publication and exact retry does not repair graph or replay work", t => {
  const f = fixture(t), unlink = fs.unlinkSync; let injected = false;
  fs.unlinkSync = file => {
    if (!injected && String(file).includes(".work-evidence-") && String(file).endsWith(".tmp")) {
      injected = true; throw Object.assign(new Error("Synthetic primary cleanup failure"), { code: "EIO" });
    }
    return unlink(file);
  };
  const input = { summary: "Published bytes with unconfirmed primary cleanup" };
  try { assert.throws(() => f.save(input), { code: "EIO" }); } finally { fs.unlinkSync = unlink; }
  assert.equal(injected, true);
  const afterFailure = snapshot(f.base), retry = f.save(input);
  assert.equal(retry.writes, 0); assert.equal(retry.status, "session_work_evidence_reused");
  assert.deepEqual(snapshot(f.base), afterFailure);
});

test("one malformed work original does not remove independent work or plan evidence", async t => {
  const f = fixture(t), bad = f.save({ summary: "Will become malformed" }), good = f.save({ summary: "Independent intact original" });
  const plan = f.route(() => createWholePlanSnapshot({ root: f.root, objective: "Independent plan", plan: ["Retain evidence"] }).artifact);
  fs.writeFileSync(bad.file, "{"); const before = snapshot(f.base);
  const result = await queryProjectGraph({ root: f.root, view: "work", details: true, maxNodes: 100 });
  assertWork(result, good); assert.equal(nodeFor(result, bad), undefined);
  assert.ok(result.nodes.some(node => node.nodeId === plan.wholePlanId));
  assert.ok(JSON.stringify(result.integrity.excluded).includes(relative(f, bad.file)));
  assert.deepEqual(snapshot(f.base), before);
});

test("a damaged named owner restricts its own work without default adoption or loss of another named owner", async t => {
  const f = fixture(t), bad = f.save({ summary: "Owner A work" });
  const second = createHeadSession({ root: f.root, purpose: "Independent owner B" });
  const good = withSessionRoute(f.root, second.sessionId, () => recordSessionWorkEvidence({ root: f.root, input: { summary: "Owner B work" } }));
  const ownerFile = f.route(() => sessionStatePath(f.root));
  const owner = JSON.parse(fs.readFileSync(ownerFile, "utf8")); owner.projectId = "head-" + "0".repeat(20);
  fs.writeFileSync(ownerFile, JSON.stringify(owner)); const before = snapshot(f.base);
  const result = await queryProjectGraph({ root: f.root, view: "work", details: true, maxNodes: 100 });
  assertWork(result, good); assert.equal(nodeFor(result, bad), undefined);
  assert.ok(result.edges.some(edge => edge.type === "RECORDED_FOR_SESSION" && edge.from === good.evidence.evidenceId && edge.to === second.sessionId));
  assert.deepEqual(snapshot(f.base), before);
  // Existing exact named routing tolerates unrelated malformed default JSON.
  fs.writeFileSync(path.join(f.root, ".head/sessions/current.json"), "{");
  const damagedDefault = snapshot(f.base), named = await queryProjectGraph(q(f, good));
  assertWork(named, good); assert.deepEqual(snapshot(f.base), damagedDefault);
});

test("missing/corrupt links preserve source selectors and independent observation target while excluding only affected edges", async t => {
  const f = fixture(t), root = f.save({ summary: "Context A" }), predecessor = f.save({ summary: "A predecessor", workLink: link(root) });
  const otherRoot = f.save({ summary: "Independent target B" });
  const saved = f.save({ summary: "A note observes B without merging membership", pending: ["X"], workLink: link(root, predecessor),
    executionObservation: { state: "ended", target: exact(otherRoot) } });
  let result = await queryProjectGraph(q(f, saved, { depth: 1, maxNodes: 20, maxEdges: 30 }));
  assertWork(result, saved);
  assert.ok(edgeFor(result, "DECLARES_WORK_ROOT", saved, root));
  assert.ok(edgeFor(result, "FOLLOWS_WORK_EVIDENCE", saved, predecessor));
  assert.ok(edgeFor(result, "SAVED_OBSERVATION_OF", saved, otherRoot));
  fs.unlinkSync(root.file); fs.writeFileSync(predecessor.file, "{}"); const before = snapshot(f.base);
  result = await queryProjectGraph(q(f, saved, { depth: 1, maxNodes: 20, maxEdges: 30 }));
  const node = assertWork(result, saved);
  assert.deepEqual(node.workContent.workLink, saved.evidence.content.workLink);
  assert.equal(edgeFor(result, "DECLARES_WORK_ROOT", saved, root), undefined);
  assert.equal(edgeFor(result, "FOLLOWS_WORK_EVIDENCE", saved, predecessor), undefined);
  assert.ok(edgeFor(result, "SAVED_OBSERVATION_OF", saved, otherRoot));
  assert.deepEqual(node.workContent.pending, ["X"]); assert.deepEqual(snapshot(f.base), before);
});

test("same evidence ID with a changed valid header digest does not satisfy an exact historical link selector", async t => {
  const f = fixture(t), root = f.save({ summary: "Root identity excludes recording time" });
  const saved = f.save({ summary: "Keep exact historical root selector", workLink: link(root) });
  const { evidenceDigest, ...payload } = root.evidence;
  payload.recordedAt = "2026-01-02T00:00:00.000Z";
  const changed = { ...payload, evidenceDigest: sha(encoded(payload)) };
  assert.notEqual(changed.evidenceDigest, evidenceDigest);
  fs.writeFileSync(root.file, JSON.stringify(changed, null, 2) + "\n");
  const before = snapshot(f.base), result = await queryProjectGraph(q(f, saved, { depth: 1, maxNodes: 10, maxEdges: 10 }));
  assertWork(result, saved);
  assert.deepEqual(nodeFor(result, saved).workContent.workLink.root, exact(root));
  assert.equal(edgeFor(result, "DECLARES_WORK_ROOT", saved, root), undefined);
  assert.equal(edgeFor(result, "FOLLOWS_WORK_EVIDENCE", saved, root), undefined);
  assert.deepEqual(snapshot(f.base), before);
});

test("depth>0 keeps the conservative hidden-owner/nonselected-work proof even with zero visible edges", async t => {
  const f = fixture(t), selected = f.save({ summary: "Exact anchor" });
  const other = createHeadSession({ root: f.root, purpose: "Unselected work owner" });
  const nonselected = withSessionRoute(f.root, other.sessionId, () => recordSessionWorkEvidence({ root: f.root, input: { summary: "Nonselected candidate" } }));
  const { request, reused } = await warm(f, selected, { depth: 1 }), before = snapshot(f.base);
  for (const file of [selected.file, nonselected.file, f.route(() => sessionStatePath(f.root)), path.join(f.root, ".head/sessions/by-id", other.sessionId, "current.json")]) {
    assert.ok(reused.integrity.verifiedRecordPaths.includes(relative(f, file)), "Missing hidden proof " + relative(f, file));
  }
  assert.deepEqual(snapshot(f.base), before);
  replaceSameMetadata(nonselected.file, "Nonselected candidate", "Nonselected corrupted");
  const after = snapshot(f.base), changed = await queryProjectGraph({ ...request, previousResult: reused });
  assert.notEqual(changed.reuse.status, "scoped-originals-reused"); assertWork(changed, selected);
  assert.deepEqual(snapshot(f.base), after);
});

test("A1 exact depth0 omits only independent valid work bytes, retains hidden owners and distinguishes retained global exclusions", async t => {
  const f = fixture(t), selected = f.save({ summary: "Exact useful anchor", pending: ["X"], unknowns: ["Effect unknown"] });
  const other = createHeadSession({ root: f.root, purpose: "Independent retained work owner" });
  const independent = withSessionRoute(f.root, other.sessionId, () => recordSessionWorkEvidence({ root: f.root,
    input: { summary: "Independent candidate" } }));
  const { request, reused } = await warm(f, selected);
  assert.ok(!reused.integrity.verifiedRecordPaths.includes(relative(f, independent.file)));
  for (const file of [selected.file, f.route(() => sessionStatePath(f.root)),
    path.join(f.root, ".head/sessions/by-id", other.sessionId, "current.json"), path.join(f.root, ".head/sessions/current.json")]) {
    assert.ok(reused.integrity.verifiedRecordPaths.includes(relative(f, file)), "Required owner/default proof " + relative(f, file));
  }
  changeValidHeader(independent);
  let before = snapshot(f.base), result = await queryProjectGraph({ ...request, previousResult: reused });
  assert.equal(result.reuse.status, "scoped-originals-reused"); assertWork(result, selected);
  await compareWithCold(request, result); assert.deepEqual(snapshot(f.base), before);
  // Re-prime against the changed header before testing a separate independent
  // corruption. The fixture mutation is not a query-side repair/write.
  const again = await warm(f, selected);
  replaceSameMetadata(independent.file, "Independent candidate", "Independent corrupted");
  before = snapshot(f.base); result = await queryProjectGraph({ ...again.request, previousResult: again.reused });
  assert.equal(result.reuse.status, "scoped-originals-reused"); assertWork(result, selected);
  const cold = await compareWithCold(again.request, result);
  assert.deepEqual(result.integrity.excluded, again.reused.integrity.excluded);
  assert.deepEqual(result.sourceFallback.excludedInputs, again.reused.sourceFallback.excludedInputs);
  assert.notDeepEqual(cold.integrity.excluded, result.integrity.excluded, "Cold discovers a global exclusion that the retained diagnostic does not claim to refresh");
  assert.match(result.sourceFallback.action, /retain/i); assert.match(result.sourceFallback.action, /exclu/i);
  assert.equal(result.reuse.wholeProjectCurrent, false); assert.deepEqual(snapshot(f.base), before);
});

test("per-reference source/artifact kind and changed/missing facts do not overwrite intact work freshness", async t => {
  const f = fixture(t), sourceFile = path.join(f.root, "source.txt"), artifactFile = path.join(f.root, "retained.json");
  const projectId = f.route(() => JSON.parse(fs.readFileSync(path.join(f.root, ".head/project.json"), "utf8")).projectId);
  fs.writeFileSync(sourceFile, "source version 11");
  fs.writeFileSync(artifactFile, JSON.stringify({ projectId, label: "Retained artifact" }));
  const source = { path: "source.txt", digest: sha(fs.readFileSync(sourceFile)), kind: "source" };
  const artifact = { path: "retained.json", digest: sha(fs.readFileSync(artifactFile)), kind: "artifact" };
  const saved = f.save({ summary: "Keep this intact historical work", pending: ["X"], references: [source, artifact] });
  const reversed = f.save({ summary: "Same reference facts, reversed order", references: [artifact, source] });
  const request = q(f, saved, { depth: 1, maxNodes: 20, maxEdges: 20 });
  let result = await queryProjectGraph(request), node = assertWork(result, saved);
  const freshness = node.freshness;
  const byPath = new Map(node.referenceEvidence.map(ref => [ref.path, ref]));
  assert.equal(byPath.get(source.path).status, "matching-current-bytes");
  assert.equal(byPath.get(artifact.path).status, "intact-retained-original");
  for (const ref of [source, artifact]) {
    const fact = byPath.get(ref.path);
    assert.equal(fact.kind, ref.kind); assert.equal(fact.digest, ref.digest);
    assert.equal(fact.currentness, "current"); assert.equal(fact.currentDigest, ref.digest);
    assert.equal(fact.contentReconstructed, false);
  }
  replaceSameMetadata(sourceFile, "11", "22"); fs.unlinkSync(artifactFile);
  const before = snapshot(f.base);
  result = await queryProjectGraph({ root: f.root, anchorIds: [saved.evidence.evidenceId, reversed.evidence.evidenceId],
    view: "work", details: true, depth: 1, maxNodes: 30, maxEdges: 30 });
  node = assertWork(result, saved); assert.equal(node.freshness, freshness);
  const facts = new Map(node.referenceEvidence.map(ref => [ref.path, ref]));
  assert.equal(facts.get(source.path).currentness, "changed");
  assert.equal(facts.get(source.path).currentDigest, sha(fs.readFileSync(sourceFile)));
  assert.equal(facts.get(artifact.path).currentness, "missing");
  assert.equal(facts.get(artifact.path).currentDigest, null);
  for (const fact of facts.values()) {
    assert.equal(fact.status, "unavailable"); assert.equal(fact.historicalContentAvailable, false);
    assert.equal(fact.contentReconstructed, false);
  }
  const sort = refs => [...refs].sort((a, b) => a.path.localeCompare(b.path));
  assert.deepEqual(sort(node.referenceEvidence), sort(nodeFor(result, reversed).referenceEvidence));
  assert.deepEqual(node.workContent.pending, ["X"]); assert.deepEqual(snapshot(f.base), before);
});

test("two retained file digests stay separate while exact work citations verify the actual cross-Session owner", async t => {
  const f = fixture(t), sourceFile = path.join(f.root, "versioned.txt");
  fs.writeFileSync(sourceFile, "version 11");
  const ref11 = { path: "versioned.txt", digest: sha(fs.readFileSync(sourceFile)), kind: "source" };
  const first = f.save({ summary: "First retained revision", references: [ref11] });
  replaceSameMetadata(sourceFile, "11", "22");
  const ref22 = { ...ref11, digest: sha(fs.readFileSync(sourceFile)) };
  const other = createHeadSession({ root: f.root, purpose: "Actual cited work owner" });
  const target = withSessionRoute(f.root, other.sessionId, () => recordSessionWorkEvidence({ root: f.root, input: { summary: "Cross-Session cited evidence" } }));
  const second = f.save({ summary: "Second retained revision", references: [ref22, citation(f, target)] });
  const before = snapshot(f.base), result = await queryProjectGraph({ root: f.root,
    anchorIds: [first.evidence.evidenceId, second.evidence.evidenceId], view: "work", details: true, depth: 1, maxNodes: 30, maxEdges: 40 });
  assertWork(result, first); assertWork(result, second); assertWork(result, target);
  assert.equal(nodeFor(result, first).referenceEvidence.find(ref => ref.path === ref11.path).currentness, "changed");
  assert.equal(nodeFor(result, second).referenceEvidence.find(ref => ref.path === ref22.path).currentness, "current");
  assert.ok(edgeFor(result, "CITES_WORK_EVIDENCE", second, target));
  assert.equal(nodeFor(result, target).sessionId, other.sessionId);
  assert.equal(nodeFor(result, second).sessionId, f.session.sessionId);
  const firstRevision = result.edges.find(edge => edge.type === "CITES_EXACT_REVISION" && edge.from === first.evidence.evidenceId);
  const secondRevision = result.edges.find(edge => edge.type === "CITES_EXACT_REVISION" && edge.from === second.evidence.evidenceId
    && result.nodes.find(node => node.nodeId === edge.to)?.path === ref22.path);
  assert.ok(firstRevision); assert.ok(secondRevision); assert.notEqual(firstRevision.to, secondRevision.to);
  assert.deepEqual(snapshot(f.base), before);
});

test("identical file bytes cited as source and artifact preserve both explicit reference kinds", async t => {
  const f = fixture(t), file = path.join(f.root, "dual-kind.json");
  const projectId = JSON.parse(fs.readFileSync(path.join(f.root, ".head/project.json"), "utf8")).projectId;
  fs.writeFileSync(file, JSON.stringify({ projectId, label: "Same physical bytes" }));
  const digest = sha(fs.readFileSync(file)), saved = f.save({ summary: "Explicit kinds are not interchangeable", references: [
    { path: "dual-kind.json", digest, kind: "source" }, { path: "dual-kind.json", digest, kind: "artifact" },
  ] });
  const result = await queryProjectGraph(q(f, saved, { depth: 1, maxNodes: 10, maxEdges: 10 }));
  const node = assertWork(result, saved);
  assert.deepEqual(node.referenceEvidence.map(ref => ref.kind).sort(), ["artifact", "source"]);
  assert.equal(result.edges.filter(edge => edge.type === "CITES_EXACT_REVISION" && edge.from === saved.evidence.evidenceId).length, 2);
});

test("reference bytes and missing-file creation invalidate exact warm reuse even when work and owner bytes are unchanged", async t => {
  const f = fixture(t), file = path.join(f.root, "proof-source.txt");
  fs.writeFileSync(file, "proof source 11");
  const reference = { path: "proof-source.txt", digest: sha(fs.readFileSync(file)), kind: "source" };
  const saved = f.save({ summary: "Reference-dependent exact anchor", references: [reference] });
  const { request, reused } = await warm(f, saved);
  replaceSameMetadata(file, "11", "22"); let before = snapshot(f.base);
  let result = await queryProjectGraph({ ...request, previousResult: reused });
  assert.notEqual(result.reuse.status, "scoped-originals-reused");
  assert.equal(nodeFor(result, saved).referenceEvidence[0].currentness, "changed"); assert.deepEqual(snapshot(f.base), before);
  fs.unlinkSync(file); indexProjectGraph({ root: f.root });
  const absent = await queryProjectGraph(request), absentRepeat = await queryProjectGraph({ ...request, previousResult: absent });
  assert.equal(nodeFor(absentRepeat, saved).referenceEvidence[0].currentness, "missing");
  fs.writeFileSync(file, "proof source 11"); before = snapshot(f.base);
  result = await queryProjectGraph({ ...request, previousResult: absentRepeat });
  assert.notEqual(result.reuse.status, "scoped-originals-reused");
  assert.equal(nodeFor(result, saved).referenceEvidence[0].currentness, "current"); assert.deepEqual(snapshot(f.base), before);
});

test("restoring an excluded same-path producer discovers its incoming relation via proof invalidation or safe cold fallback", async t => {
  const f = fixture(t), root = f.save({ summary: "Exact root anchor" }), producer = f.save({ summary: "Incoming producer", workLink: link(root) });
  const bytes = fs.readFileSync(producer.file); fs.writeFileSync(producer.file, "{}");
  indexProjectGraph({ root: f.root });
  const request = q(f, root, { depth: 1, maxNodes: 20, maxEdges: 20 }), cold = await queryProjectGraph(request);
  // A damaged dependency may legitimately prevent priming scoped reuse.
  const reused = await queryProjectGraph({ ...request, previousResult: cold });
  assert.equal(nodeFor(reused, producer), undefined);
  fs.writeFileSync(producer.file, bytes); const before = snapshot(f.base);
  const restored = await queryProjectGraph({ ...request, previousResult: reused });
  assert.notEqual(restored.reuse.status, "scoped-originals-reused"); assertWork(restored, producer);
  assert.ok(edgeFor(restored, "DECLARES_WORK_ROOT", producer, root)); assert.deepEqual(snapshot(f.base), before);
});

test("text/path/exact discovery performs no sync or async file writes and leaves current Session/P2 originals unchanged", async t => {
  const f = fixture(t), saved = f.save({ judgments: [{ assessment: "Choose B", reason: "Proof sentinel reason", alternatives: ["Keep A"] }], pending: ["X"] });
  const sequence = await warm(f, saved);
  const before = snapshot(f.base), originals = [], attempts = [];
  const trap = name => (...args) => { attempts.push(name); throw new Error("Read-only graph attempted " + name); };
  const replace = (object, name, value) => { originals.push([object, name, object[name]]); object[name] = value; };
  for (const name of ["writeFileSync", "appendFileSync", "mkdirSync", "unlinkSync", "renameSync", "linkSync", "rmSync", "copyFileSync", "truncateSync"]) replace(fs, name, trap(name));
  for (const name of ["writeFile", "appendFile", "mkdir", "unlink", "rename", "link", "rm", "copyFile", "truncate"]) replace(fsp, name, trap("promises." + name));
  const openSync = fs.openSync, open = fsp.open;
  replace(fs, "openSync", (file, flags, ...args) => {
    if (typeof flags !== "string" || flags !== "r") return trap("openSync-write")(file, flags);
    return openSync(file, flags, ...args);
  });
  replace(fsp, "open", (file, flags, ...args) => {
    if (typeof flags !== "string" || flags !== "r") return trap("promises.open-write")(file, flags);
    return open(file, flags, ...args);
  });
  syncBuiltinESMExports();
  try {
    const repeated = await queryProjectGraph({ ...sequence.request, previousResult: sequence.reused });
    assert.equal(repeated.reuse.status, "scoped-originals-reused"); assertWork(repeated, saved);
    for (const options of [q(f, saved), { root: f.root, paths: [relative(f, saved.file)], details: true },
      { root: f.root, query: "Proof sentinel reason", details: true }]) assertWork(await queryProjectGraph(options), saved);
  } finally {
    for (const [object, name, value] of originals.reverse()) object[name] = value;
    syncBuiltinESMExports();
  }
  assert.deepEqual(attempts, []); assert.deepEqual(snapshot(f.base), before);
});

test("external named work membership without an index hint is rediscovered rather than silently omitted", async t => {
  const f = fixture(t), selected = f.save({ summary: "Existing anchor" });
  const external = createHeadSession({ root: f.root, purpose: "Initially empty candidate owner" });
  const published = withSessionRoute(f.root, external.sessionId, () => recordSessionWorkEvidence({ root: f.root, input: { summary: "External candidate work" } }));
  const bytes = fs.readFileSync(published.file); fs.unlinkSync(published.file);
  const { request, reused } = await warm(f, selected);
  fs.writeFileSync(published.file, bytes); const before = snapshot(f.base);
  const result = await queryProjectGraph({ ...request, previousResult: reused });
  assert.notEqual(result.reuse.status, "scoped-originals-reused"); assertWork(result, selected);
  const freshQuestion = await queryProjectGraph({ root: f.root, query: "External candidate work", details: true });
  assertWork(freshQuestion, published); assert.deepEqual(snapshot(f.base), before);
});

test("an externally appearing named Session plus work directory invalidates membership without an index repair", async t => {
  const f = fixture(t), selected = f.save({ summary: "Existing exact anchor" });
  const external = createHeadSession({ root: f.root, purpose: "New external named owner" });
  const saved = withSessionRoute(f.root, external.sessionId, () => recordSessionWorkEvidence({ root: f.root, input: { summary: "New named owner evidence" } }));
  const directory = path.join(f.root, ".head/sessions/by-id", external.sessionId), parked = path.join(f.base, "parked-owner");
  fs.renameSync(directory, parked); // Both exact paths belong to this fixture.
  const { request, reused } = await warm(f, selected);
  fs.renameSync(parked, directory);
  const before = snapshot(f.base), result = await queryProjectGraph({ ...request, previousResult: reused });
  assert.notEqual(result.reuse.status, "scoped-originals-reused"); assertWork(result, selected);
  const discovered = await queryProjectGraph(q(f, saved)); assertWork(discovered, saved);
  assert.deepEqual(snapshot(f.base), before);
});

test("same-path owner tampering invalidates warm proof instead of retaining a formerly valid work owner", async t => {
  const f = fixture(t), selected = f.save({ summary: "Owner-bound original" }), { request, reused } = await warm(f, selected);
  const file = f.route(() => sessionStatePath(f.root)), owner = JSON.parse(fs.readFileSync(file, "utf8"));
  const replacement = owner.projectId.endsWith("0") ? "1" : "0";
  replaceSameMetadata(file, owner.projectId, owner.projectId.slice(0, -1) + replacement);
  const before = snapshot(f.base), result = await queryProjectGraph({ ...request, previousResult: reused });
  assert.notEqual(result.reuse.status, "scoped-originals-reused"); assert.equal(nodeFor(result, selected), undefined);
  noAuthority(result); assert.deepEqual(snapshot(f.base), before);
});

test("actual default Session identity is a hidden work dependency and a default/named collision cannot be adopted", async t => {
  const f = fixture(t), saved = recordSessionWorkEvidence({ root: f.root, input: { summary: "Default-owned original" } });
  const { request, reused } = await warm(f, saved);
  assert.ok(reused.integrity.verifiedRecordPaths.includes(".head/sessions/current.json"));
  assert.equal(nodeFor(reused, saved).sessionId, saved.evidence.sessionId);
  const file = path.join(f.root, ".head/sessions/current.json"), state = JSON.parse(fs.readFileSync(file, "utf8"));
  state.sessionId = f.session.sessionId; fs.writeFileSync(file, JSON.stringify(state));
  const before = snapshot(f.base), result = await queryProjectGraph({ ...request, previousResult: reused });
  assert.notEqual(result.reuse.status, "scoped-originals-reused"); assert.equal(nodeFor(result, saved), undefined);
  noAuthority(result); assert.deepEqual(snapshot(f.base), before);
});

test("old/no work index uses originals without query-time repair or Session selection changes", async t => {
  const f = fixture(t), saved = f.save({ summary: "Original-backed discovery" });
  for (const mode of ["old", "absent"]) {
    if (mode === "old") {
      const index = JSON.parse(fs.readFileSync(indexFile(f), "utf8")); delete index.readerDependencies.sessionWork;
      index.entries = index.entries.filter(entry => !entry.path.includes("/work-evidence/"));
      fs.writeFileSync(indexFile(f), JSON.stringify(index));
    } else fs.unlinkSync(indexFile(f));
    const before = snapshot(f.base), defaultState = fs.readFileSync(path.join(f.root, ".head/sessions/current.json"));
    const selectedState = f.route(() => fs.readFileSync(sessionStatePath(f.root)));
    const result = await queryProjectGraph(q(f, saved)); assertWork(result, saved);
    assert.notEqual(result.reuse.status, "scoped-originals-reused");
    assert.deepEqual(fs.readFileSync(path.join(f.root, ".head/sessions/current.json")), defaultState);
    assert.deepEqual(f.route(() => fs.readFileSync(sessionStatePath(f.root))), selectedState);
    assert.deepEqual(snapshot(f.base), before);
  }
});

test("A1 selected header bytes remain fresh despite identical size/mtime, and a returned clone cannot mutate private cache state", async t => {
  const f = fixture(t), selected = f.save({ summary: "Selected header must be current", pending: ["X"] });
  const { request, reused } = await warm(f, selected), retained = structuredClone(reused);
  reused.nodes[0].workContent.pending.push("Caller injection"); reused.boundary.nextAnchorIds.push("Caller anchor");
  const isolated = await queryProjectGraph({ ...request, previousResult: retained });
  assert.equal(isolated.reuse.status, "scoped-originals-reused");
  assert.deepEqual(selectedProjection(isolated), selectedProjection(retained));
  changeValidHeader(selected); const before = snapshot(f.base);
  const changed = await queryProjectGraph({ ...request, previousResult: isolated });
  assert.notEqual(changed.reuse.status, "scoped-originals-reused"); assertWork(changed, selected);
  assert.notEqual(nodeFor(changed, selected).sourceReference.digest, nodeFor(isolated, selected).sourceReference.digest);
  await compareWithCold(request, changed); assert.deepEqual(snapshot(f.base), before);
});

for (const mode of ["root", "observation", "potential-citation", "potential-source"]) test(`A1 ${mode} producer header remains a proof dependency even when no current citation edge exists`, async t => {
  const f = fixture(t), selected = f.save({ summary: "Selected producer target" });
  const producer = f.save(mode === "root" ? { summary: "Related root producer", workLink: link(selected) }
    : mode === "observation" ? { executionObservation: { state: "paused", target: exact(selected) } }
      : { summary: "Potential exact-path reference producer", references: [{ ...citation(f, selected), kind: mode === "potential-source" ? "source" : "artifact" }] });
  if (mode === "potential-citation") changeValidHeader(selected); // P's retained artifact digest is now stale, but its exact path is still potential.
  const { request, reused } = await warm(f, selected);
  assert.ok(reused.integrity.verifiedRecordPaths.includes(relative(f, producer.file)));
  const originalBoundary = structuredClone(reused.boundary);
  changeValidHeader(producer); const before = snapshot(f.base);
  const changed = await queryProjectGraph({ ...request, previousResult: reused });
  assert.notEqual(changed.reuse.status, "scoped-originals-reused"); assertWork(changed, selected);
  if (mode === "root" || mode === "observation") assert.notDeepEqual(changed.boundary, originalBoundary, "Current producer raw provenance changes its incident edge identity");
  await compareWithCold(request, changed); assert.deepEqual(snapshot(f.base), before);
});

for (const mode of ["missing", "digest-mismatch"]) test(`A1 hidden root gate ${mode} restoration discovers the previously suppressed incoming predecessor boundary`, async t => {
  const f = fixture(t), root = f.save({ summary: "Separate required root gate" });
  const selected = f.save({ summary: "Selected predecessor", workLink: link(root) });
  const producer = f.save({ summary: "Potential follows producer", workLink: link(root, selected) });
  const rootBytes = fs.readFileSync(root.file);
  if (mode === "missing") fs.unlinkSync(root.file); else changeValidHeader(root);
  const { request, reused } = await warm(f, selected);
  assert.ok(reused.integrity.verifiedRecordPaths.includes(relative(f, producer.file)));
  if (mode !== "missing") assert.ok(reused.integrity.verifiedRecordPaths.includes(relative(f, root.file)));
  assert.ok(!reused.boundary.nextAnchorIds.includes(producer.evidence.evidenceId));
  fs.writeFileSync(root.file, rootBytes); const before = snapshot(f.base);
  const restored = await queryProjectGraph({ ...request, previousResult: reused });
  assert.notEqual(restored.reuse.status, "scoped-originals-reused"); assertWork(restored, selected);
  assert.ok(restored.boundary.nextAnchorIds.includes(producer.evidence.evidenceId));
  await compareWithCold(request, restored); assert.deepEqual(snapshot(f.base), before);
});

test("A1 same-path invalid producer and unowned original restoration cannot be mistaken for independent valid work", async t => {
  const f = fixture(t), selected = f.save({ summary: "Independent valid selected original" });
  const producer = f.save({ summary: "Initially invalid incoming producer", workLink: link(selected) });
  const producerBytes = fs.readFileSync(producer.file); fs.writeFileSync(producer.file, "{}");
  let sequence = await warm(f, selected);
  assert.ok(sequence.reused.integrity.verifiedRecordPaths.includes(relative(f, producer.file)));
  fs.writeFileSync(producer.file, producerBytes); let before = snapshot(f.base);
  let result = await queryProjectGraph({ ...sequence.request, previousResult: sequence.reused });
  assert.notEqual(result.reuse.status, "scoped-originals-reused");
  assert.ok(result.boundary.nextAnchorIds.includes(producer.evidence.evidenceId));
  await compareWithCold(sequence.request, result); assert.deepEqual(snapshot(f.base), before);
  const other = createHeadSession({ root: f.root, purpose: "Temporarily invalid owner" });
  const unowned = withSessionRoute(f.root, other.sessionId, () => recordSessionWorkEvidence({ root: f.root,
    input: { summary: "Unowned exact citation producer", references: [citation(f, selected)] } }));
  const ownerPath = path.join(f.root, ".head/sessions/by-id", other.sessionId, "current.json");
  const ownerBytes = fs.readFileSync(ownerPath), state = JSON.parse(ownerBytes);
  state.projectId = "head-" + "0".repeat(20); fs.writeFileSync(ownerPath, JSON.stringify(state));
  // A bad generic Session layer may make the existing proof unsupported; this
  // is legitimate cold fallback, not a reason to weaken owner verification.
  indexProjectGraph({ root: f.root });
  const request = q(f, selected), absent = await queryProjectGraph(request);
  const repeated = await queryProjectGraph({ ...request, previousResult: absent });
  assert.equal(nodeFor(repeated, unowned), undefined);
  assert.ok(!repeated.boundary.nextAnchorIds.includes(unowned.evidence.evidenceId));
  const workBytes = fs.readFileSync(unowned.file); fs.writeFileSync(ownerPath, ownerBytes);
  before = snapshot(f.base); result = await queryProjectGraph({ ...request, previousResult: repeated });
  assert.notEqual(result.reuse.status, "scoped-originals-reused");
  assert.ok(result.boundary.nextAnchorIds.includes(unowned.evidence.evidenceId));
  assert.deepEqual(fs.readFileSync(unowned.file), workBytes, "Only the real owner was repaired, not the work original");
  await compareWithCold(request, result); assert.deepEqual(snapshot(f.base), before);
});

for (const field of ["activeRunId", "lastResultPacketId", "latestCheckpoint", "currentWholePlanId"]) test(`A1 retains another named owner's mutable ${field} even when it newly points to a work ID`, async t => {
  const f = fixture(t), selected = f.save({ summary: "Incoming generic state target" });
  const other = createHeadSession({ root: f.root, purpose: "Mutable nonselected owner" });
  withSessionRoute(f.root, other.sessionId, () => recordSessionWorkEvidence({ root: f.root, input: { summary: "Independent owned work" } }));
  const ownerPath = path.join(f.root, ".head/sessions/by-id", other.sessionId, "current.json");
  const { request, reused } = await warm(f, selected);
  assert.ok(reused.integrity.verifiedRecordPaths.includes(relative(f, ownerPath)));
  const state = JSON.parse(fs.readFileSync(ownerPath)); state[field] = selected.evidence.evidenceId;
  fs.writeFileSync(ownerPath, JSON.stringify(state)); const before = snapshot(f.base);
  const changed = await queryProjectGraph({ ...request, previousResult: reused });
  assert.notEqual(changed.reuse.status, "scoped-originals-reused"); assertWork(changed, selected);
  assert.ok(changed.boundary.nextAnchorIds.includes(other.sessionId));
  await compareWithCold(request, changed); assert.deepEqual(snapshot(f.base), before);
});

test("A1 shared selected reference wins over independent-work exclusion, retaining separate source/artifact facts through changed/missing/reappeared bytes", async t => {
  const f = fixture(t), file = path.join(f.root, "shared-selected.json");
  fs.writeFileSync(file, JSON.stringify({ projectId: f.session.projectId, value: "shared 11" }));
  const bytes = fs.readFileSync(file), references = ["source", "artifact"].map(kind => ({ path: "shared-selected.json", digest: sha(bytes), kind }));
  const selected = f.save({ summary: "Selected reference-dependent body", references });
  const independent = f.save({ summary: "Independent sibling shares physical bytes", references });
  for (const mutate of [() => replaceSameMetadata(file, "11", "22"), () => fs.unlinkSync(file), () => fs.writeFileSync(file, bytes)]) {
    const { request, reused } = await warm(f, selected);
    // A shared FileRevisionReference is a first-hop required node. Its origin
    // can be this sibling's work path under inventory ordering, so the accepted
    // conservative origin rule may retain that work too. The no-ref A1 case
    // separately requires genuinely independent work exclusion; here selected
    // descriptor/raw-reference proof takes precedence over removal savings.
    const siblingRetained = reused.integrity.verifiedRecordPaths.includes(relative(f, independent.file));
    t.diagnostic(`Shared-reference sibling proof retained=${siblingRetained}; first-hop FileRevisionReference origin may conservatively retain it. Selected reference proof/currentness and cold boundary equality remain required.`);
    if (fs.existsSync(file)) assert.ok(reused.integrity.verifiedRecordPaths.includes("shared-selected.json"));
    mutate(); const before = snapshot(f.base), changed = await queryProjectGraph({ ...request, previousResult: reused });
    assert.notEqual(changed.reuse.status, "scoped-originals-reused");
    const facts = nodeFor(changed, selected).referenceEvidence;
    assert.deepEqual(facts.map(ref => ref.kind).sort(), ["artifact", "source"]);
    assert.ok(facts.every(ref => ref.contentReconstructed === false));
    assert.ok(facts.every(ref => ref.currentDigest === (fs.existsSync(file) ? sha(fs.readFileSync(file)) : null)));
    await compareWithCold(request, changed); assert.deepEqual(snapshot(f.base), before);
  }
});

test("A1 requires every exact anchor to be returned; partial/unmatched anchors retain conservative behavior rather than hiding omitted matches", async t => {
  const f = fixture(t), first = f.save({ summary: "First requested anchor" }), second = f.save({ summary: "Second requested anchor" });
  const independent = f.save({ summary: "Unrelated independent sibling" }), anchorIds = [first.evidence.evidenceId, second.evidence.evidenceId];
  const all = await warm(f, first, { anchorIds, maxNodes: 2 });
  assert.equal(all.reused.nodes.length, 2); assert.equal(all.reused.omittedMatchCount, 0);
  assert.ok(!all.reused.integrity.verifiedRecordPaths.includes(relative(f, independent.file)));
  const partial = await warm(f, first, { anchorIds, maxNodes: 1 });
  assert.equal(partial.reused.nodes.length, 1); assert.equal(partial.reused.omittedMatchCount, 1);
  assert.ok(partial.reused.integrity.verifiedRecordPaths.includes(relative(f, independent.file)));
  replaceSameMetadata(independent.file, "Unrelated independent sibling", "Unrelated independent corrupt");
  const before = snapshot(f.base), changed = await queryProjectGraph({ ...partial.request, previousResult: partial.reused });
  assert.notEqual(changed.reuse.status, "scoped-originals-reused"); await compareWithCold(partial.request, changed);
  const request = q(f, first, { anchorIds: [first.evidence.evidenceId, "work-evidence-" + "0".repeat(24)], maxNodes: 2 });
  const cold = await queryProjectGraph(request), repeat = await queryProjectGraph({ ...request, previousResult: cold });
  assert.notEqual(repeat.reuse.status, "scoped-originals-reused"); assert.equal(repeat.unmatchedAnchorIds.length, 1);
  assert.deepEqual(snapshot(f.base), before);
});

test("A1 selected inventory identity ambiguity preserves raw duplicate/independent proofs instead of classifying an origin by node ID alone", async t => {
  const f = fixture(t), selected = f.save({ summary: "Exact selected identity" }), independent = f.save({ summary: "Independent original" });
  const other = createHeadSession({ root: f.root, purpose: "Duplicate path owner" });
  const otherWork = withSessionRoute(f.root, other.sessionId, () => recordSessionWorkEvidence({ root: f.root, input: { summary: "Other owner work" } }));
  const duplicate = path.join(path.dirname(otherWork.file), path.basename(selected.file));
  fs.copyFileSync(selected.file, duplicate); // Public bytes, deliberately wrong owner at this second recognized path.
  const { request, reused } = await warm(f, selected);
  assert.ok(reused.integrity.verifiedRecordPaths.includes(relative(f, duplicate)));
  assert.ok(reused.integrity.verifiedRecordPaths.includes(relative(f, independent.file)));
  replaceSameMetadata(independent.file, "Independent original", "Independent corrupt!");
  const before = snapshot(f.base), changed = await queryProjectGraph({ ...request, previousResult: reused });
  assert.notEqual(changed.reuse.status, "scoped-originals-reused"); assertWork(changed, selected);
  await compareWithCold(request, changed); assert.deepEqual(snapshot(f.base), before);
});

test("A1 late index change after the hit's single index observation is a sequential boundary, not a promised post-proof recheck", async t => {
  const f = fixture(t), selected = f.save({ summary: "Stable selected body through late index drift" });
  const { request, reused } = await warm(f, selected), read = fs.readFileSync;
  const originalIndex = fs.readFileSync(indexFile(f)); let injected = false;
  fs.readFileSync = (file, ...args) => {
    const bytes = read(file, ...args);
    if (path.resolve(String(file)) === path.resolve(indexFile(f)) && !injected) {
      injected = true; fs.appendFileSync(indexFile(f), " ");
    }
    return bytes;
  };
  let value; try { value = await queryProjectGraph({ ...request, previousResult: reused }); } finally { fs.readFileSync = read; }
  assert.equal(injected, true); assert.equal(value.reuse.status, "scoped-originals-reused");
  assert.deepEqual(selectedProjection(value), selectedProjection(reused));
  assert.notDeepEqual(fs.readFileSync(indexFile(f)), originalIndex);
  const before = snapshot(f.base), next = await queryProjectGraph({ ...request, previousResult: value });
  assert.notEqual(next.reuse.status, "scoped-originals-reused"); assertWork(next, selected);
  await compareWithCold(request, next); assert.deepEqual(snapshot(f.base), before);
  t.diagnostic("Fault injection writes the synthetic index after its observed bytes are returned; this is not an atomic/latest-at-return or query-write claim.");
});

for (const kind of ["selected", "reference"]) test(`A1 ${kind} file-to-directory layout change invalidates warm reuse without read-side repair`, async t => {
  const f = fixture(t), referencePath = path.join(f.root, "required-layout.txt"); fs.writeFileSync(referencePath, "Required exact bytes");
  const selected = f.save({ summary: "Layout-bound selected evidence", references: [{ path: "required-layout.txt", digest: sha(fs.readFileSync(referencePath)), kind: "source" }] });
  const { request, reused } = await warm(f, selected), file = kind === "selected" ? selected.file : referencePath;
  fs.unlinkSync(file); fs.mkdirSync(file); const before = snapshot(f.base);
  const result = await queryProjectGraph({ ...request, previousResult: reused });
  assert.notEqual(result.reuse.status, "scoped-originals-reused");
  if (kind === "selected") assert.equal(nodeFor(result, selected), undefined);
  else { assertWork(result, selected); assert.equal(nodeFor(result, selected).referenceEvidence[0].status, "unavailable"); }
  await compareWithCold(request, result); assert.deepEqual(snapshot(f.base), before);
});

test("B navigation publication leaves graph inventory identity unchanged and cold collection adds no header-verification pass", async t => {
  const f = fixture(t), root = f.save({ summary: "Original graph root" });
  const latest = f.save({ pending: ["Original graph pending X"], workLink: link(root) });
  indexProjectGraph({ root: f.root });
  const published = JSON.parse(fs.readFileSync(indexFile(f))), legacy = { ...published };
  assert.equal(published.sessionWorkNavigation.rows.length, 2);
  delete legacy.sessionWorkNavigation;
  fs.writeFileSync(indexFile(f), JSON.stringify(legacy)); // Pre-read legacy fixture, not a reader repair.
  const before = snapshot(f.base), parse = JSON.parse; let workParses = 0;
  JSON.parse = function (...args) {
    const value = parse.apply(this, args);
    if (value?.kind === "Evidence" && value.subtype === "SessionWorkEvidence") workParses++;
    return value;
  };
  let collected; try { collected = collectProjectGraphInventory(f.root); } finally { JSON.parse = parse; }
  assert.equal(workParses, 2, "Existing dependency normalization only; navigation production must not run in collection");
  for (const field of ["entries", "unavailable", "complete", "readerDependencies", "recordsDigest"]) assert.deepEqual(collected[field], published[field]);
  const query = await queryProjectGraph(q(f, latest)); assertWork(query, latest);
  assert.deepEqual(snapshot(f.base), before);
  indexProjectGraph({ root: f.root }); // Legitimate publication outside the read snapshot.
  const restored = JSON.parse(fs.readFileSync(indexFile(f)));
  for (const field of ["entries", "unavailable", "complete", "readerDependencies", "recordsDigest"]) assert.deepEqual(restored[field], legacy[field]);
  assert.deepEqual(restored.sessionWorkNavigation, published.sessionWorkNavigation);
});

test("B navigation-only index replacement conservatively invalidates A1 raw-index reuse without changing original graph output", async t => {
  const f = fixture(t), saved = f.save({ summary: "Stable graph contents through optional header change" });
  indexProjectGraph({ root: f.root });
  const request = q(f, saved), first = await queryProjectGraph(request), warmResult = await queryProjectGraph(request);
  assert.equal(warmResult.reuse.status, "scoped-originals-reused");
  const index = JSON.parse(fs.readFileSync(indexFile(f))); delete index.sessionWorkNavigation;
  fs.writeFileSync(indexFile(f), JSON.stringify(index));
  const before = snapshot(f.base), observed = await queryProjectGraph(request);
  assert.notEqual(observed.reuse.status, "scoped-originals-reused");
  assert.deepEqual(selectedProjection(observed), selectedProjection(first));
  assert.deepEqual(snapshot(f.base), before);
  t.diagnostic("Actual metadata-invalidation reuse state: " + observed.reuse.status + "; not relabelled as a fresh read or reseed");
});
