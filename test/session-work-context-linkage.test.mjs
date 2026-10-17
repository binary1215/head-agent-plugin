import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { inspectProject } from "../scripts/lib/head-core.mjs";
import { createHeadSession, withSessionRoute } from "../scripts/lib/session-routing.mjs";
import { normalizeSessionWorkEvidence, recordSessionWorkEvidence } from "../scripts/lib/session-work-context.mjs";
import { fixture, exact, link, citation, representative, snapshot, sha, encoded, accounting, recordFor } from "./helpers/session-work-linkage-fixture.mjs";

test("legacy optional-absent normalized bytes, identity, protocol and exact retry remain unchanged", t => {
  const f = fixture(t), input = { summary: "  Legacy selected work  ", judgments: [{ assessment: "Keep", reason: "Original reason" }] };
  const legacy = { summary: "Legacy selected work", judgments: [{ assessment: "Keep", reason: "Original reason", alternatives: [] }],
    observedWork: [], pending: [], unknowns: [], suggestedFollowUp: [], references: [], occurrenceKey: null };
  assert.equal(encoded(normalizeSessionWorkEvidence(input)), encoded(legacy));
  const owner = f.route(() => inspectProject(f.root)), saved = f.save(input);
  const id = "work-evidence-" + sha(encoded({ projectId: owner.project.projectId, sessionId: f.session.sessionId, content: legacy })).slice(0, 24);
  assert.equal(saved.evidence.evidenceId, id);
  assert.deepEqual(saved.evidence.protocol, { name: "head-agent-core-session-work-evidence", version: "0.1.0" });
  assert.equal(saved.evidence.schemaVersion, 1);
  const { evidenceDigest, ...payload } = saved.evidence;
  assert.equal(evidenceDigest, sha(encoded(payload)));
  assert.equal(fs.readFileSync(saved.file, "utf8"), JSON.stringify(saved.evidence, null, 2) + "\n");
  const before = snapshot(f.base), retried = f.save(input), read = f.read();
  assert.equal(retried.writes, 0); assert.deepEqual(retried.evidence, saved.evidence);
  assert.equal(read.records[0].selectionRole, undefined); assert.equal(read.organization, undefined);
  assert.deepEqual(snapshot(f.base), before); accounting(read);
});

test("optional shapes are strict; observation alone is meaningful and link alone is not", t => {
  const f = fixture(t), root = f.save({ summary: "Anchor" }), before = snapshot(f.base);
  for (const input of [
    { workLink: link(root) }, { summary: "x", workLink: null }, { summary: "x", executionObservation: null },
    { summary: "x", workLink: { ...link(root), extra: true } },
    { summary: "x", workLink: { root: { ...exact(root), path: "injected" }, predecessor: exact(root) } },
    { executionObservation: { state: "complete" } }, { executionObservation: { state: "ended", target: null } },
    { executionObservation: { state: "ended", current: true } },
    { executionObservation: { state: "ended", target: { evidenceId: root.evidence.evidenceId, evidenceDigest: "F".repeat(64) } } },
  ]) assert.throws(() => f.save(input), JSON.stringify(input));
  assert.deepEqual(snapshot(f.base), before);
  const saved = f.save({ executionObservation: { state: "ended" } });
  assert.deepEqual(saved.evidence.content.executionObservation, { state: "ended" });
  assert.equal(saved.evidence.content.workLink, undefined);
});

test("exact existing linked anchors can be reused without merging their historical memberships", t => {
  const f = fixture(t), a0 = f.save({ summary: "A0" }), a1 = f.save({ summary: "A1", workLink: link(a0) });
  const b1 = f.save({ summary: "B1 uses A1 as its anchor", workLink: link(a1) });
  const b2 = f.save({ summary: "B2", workLink: link(a1, b1) });
  assert.deepEqual(a1.evidence.content.workLink.root, exact(a0));
  assert.deepEqual(b1.evidence.content.workLink.root, exact(a1));
  assert.deepEqual(b2.evidence.content.workLink.predecessor, exact(b1));
  assert.throws(() => f.save({ summary: "Wrong direct membership", workLink: link(a0, b1) }));
  const read = f.read({ maxRecords: 8 }); accounting(read);
  assert.deepEqual(recordFor(read, a1).content.workLink.root, exact(a0));
  assert.deepEqual(recordFor(read, b2).content.workLink.root, exact(a1));
});

test("new endpoints require exact same-owner originals; wrong digest, missing and foreign records cannot publish", t => {
  const f = fixture(t), root = f.save({ summary: "Root" });
  const other = createHeadSession({ root: f.root, purpose: "Other Session" });
  const foreign = withSessionRoute(f.root, other.sessionId, () => recordSessionWorkEvidence({ root: f.root, input: { summary: "Other owner" } }));
  const foreignProject = fixture(t), elsewhere = foreignProject.save({ summary: "Other Project" });
  const wrong = { ...exact(root), evidenceDigest: "0".repeat(64) }, missing = { evidenceId: "work-evidence-" + "0".repeat(24), evidenceDigest: "0".repeat(64) };
  // A foreign record placed in the local directory still fails owner verification.
  const copied = path.join(path.dirname(root.file), path.basename(elsewhere.file));
  fs.copyFileSync(elsewhere.file, copied);
  const before = snapshot(f.base);
  for (const endpoint of [wrong, missing, exact(foreign), exact(elsewhere)]) {
    assert.throws(() => f.save({ summary: "Reject root endpoint", workLink: { root: endpoint, predecessor: endpoint } }));
    assert.throws(() => f.save({ summary: "Reject predecessor", workLink: { root: exact(root), predecessor: endpoint } }));
    assert.throws(() => f.save({ executionObservation: { state: "ended", target: endpoint } }));
  }
  assert.deepEqual(snapshot(f.base), before);
});

test("an endpoint symlink is rejected on new publication", t => {
  const f = fixture(t), root = f.save({ summary: "Endpoint" }), copy = path.join(f.root, "endpoint-copy.json");
  fs.copyFileSync(root.file, copy); fs.unlinkSync(root.file);
  try { fs.symlinkSync(copy, root.file, "file"); }
  catch (error) { if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) { t.skip("Local account cannot create a synthetic file symlink"); return; } throw error; }
  assert.throws(() => f.save({ summary: "No symlink endpoint", workLink: link(root) }));
});

test("exact retry precedes endpoint and reference validation after publication acknowledgement failure", t => {
  const f = fixture(t), root = f.save({ summary: "Root" }), input = { summary: "Published effect evidence", workLink: link(root),
    executionObservation: { state: "ended", target: exact(root) }, references: [citation(f, root)] };
  const originalLink = fs.linkSync;
  fs.linkSync = (source, target) => {
    const result = originalLink(source, target);
    if (String(target).includes("work-evidence")) throw Object.assign(new Error("Synthetic acknowledgement failure"), { code: "EIO" });
    return result;
  };
  try { assert.throws(() => f.save(input), { code: "EIO" }); } finally { fs.linkSync = originalLink; }
  fs.unlinkSync(root.file);
  const before = snapshot(f.base), retried = f.save(input);
  assert.equal(retried.status, "session_work_evidence_reused"); assert.equal(retried.writes, 0);
  assert.equal(retried.executionReplayAllowed, false); assert.deepEqual(snapshot(f.base), before);
  const read = f.read();
  assert.ok(recordFor(read, retried)); assert.equal(read.ordinaryWorkBlocked, false);
  assert.ok(recordFor(read, retried).savedActivity.relations.some(relation => relation.status === "unavailable"));
});

test("same-target running paused ended unknown observations coexist without a current winner or conflict", t => {
  const f = fixture(t), root = f.save({ summary: "Root" }), target = f.save({ summary: "Note describes two bounded workers", workLink: link(root),
    executionObservation: { state: "running" }, pending: ["X"], unknowns: ["Worker effect unknown"] });
  let predecessor = target;
  const qualifiers = ["running", "paused", "ended", "unknown"].map(state => {
    predecessor = f.save({ executionObservation: { state, target: exact(target) }, workLink: link(root, predecessor) }); return predecessor;
  });
  const read = f.read({ maxRecords: 16 }), note = recordFor(read, target), activity = note.savedActivity;
  assert.deepEqual([...activity.states].sort(), ["ended", "paused", "running", "unknown"]);
  assert.equal(activity.qualifierCount, 4); assert.equal(activity.unavailableQualifierCount, 0);
  assert.equal(activity.qualifiers.length + activity.omittedQualifierCount, 4);
  assert.ok(activity.qualifiers.every(q => qualifiers.some(saved => q.evidenceId === saved.evidence.evidenceId && q.evidenceDigest === saved.evidence.evidenceDigest)));
  assert.equal(activity.coverage, "verified-scan");
  assert.equal(activity.state, undefined); assert.equal(activity.currentState, undefined); assert.equal(activity.conflict, undefined);
  assert.equal(note.content.executionObservation.state, "running"); assert.deepEqual(note.content.pending, ["X"]);
  assert.deepEqual(note.content.unknowns, ["Worker effect unknown"]); accounting(read);
});

for (const late of [false, true]) test(`exact historical close does not close a resumed sibling (late close ${late})`, t => {
  const f = fixture(t), root = f.save({ summary: "Root" }), first = f.save({ summary: "First note", workLink: link(root), executionObservation: { state: "running" } });
  const resume = () => f.save({ summary: "Resumed separate note", workLink: link(root, first), executionObservation: { state: "running" }, pending: ["X still needed"] });
  const close = () => f.save({ executionObservation: { state: "ended", target: exact(first) }, workLink: link(root, first) });
  let resumed; if (late) { resumed = resume(); close(); } else { close(); resumed = resume(); }
  f.save({ executionObservation: { state: "ended" } }); // An unscoped note closes nothing else.
  const read = f.read({ maxRecords: 16 });
  assert.deepEqual(recordFor(read, first).savedActivity.states, ["ended"]);
  assert.ok(!recordFor(read, resumed).savedActivity.states.includes("ended"));
  assert.deepEqual(recordFor(read, resumed).content.pending, ["X still needed"]); accounting(read);
});

test("default interleaves recent result, cited reason and root, with M1/M2 caps and unique bodies", t => {
  const f = fixture(t), saved = representative(f), before = snapshot(f.base);
  const value = f.read({ maxRecords: 4 });
  assert.deepEqual(value.records.map(r => r.evidenceId), [saved.ended, saved.judgment, saved.root, saved.running].map(s => s.evidence.evidenceId));
  assert.deepEqual(value.records.map(r => r.selectionRole), ["recent", "cited", "root", "recent"]);
  assert.equal(value.records[1].content.judgments[0].reason, "EXACT REASON: A loses retained provenance");
  assert.deepEqual(value.records[0].content.pending, ["X remains"]); assert.ok(value.organization);
  for (const maxRecords of [1, 2, 3, 8]) {
    const read = f.read({ maxRecords }); accounting(read, maxRecords);
    assert.equal(read.records[0].evidenceId, saved.ended.evidence.evidenceId);
    assert.ok(read.records.filter(record => record.selectionRole !== "recent").length <= Math.floor(maxRecords / 2));
    if (maxRecords === 2) assert.equal(read.records[1].evidenceId, saved.judgment.evidence.evidenceId);
  }
  assert.deepEqual(snapshot(f.base), before); accounting(value);
});

test("shared root and citations reuse a single fresh proof and related attempts remain bounded", t => {
  const f = fixture(t), root = f.save({ summary: "Shared root" }), cited = f.save({ summary: "Shared cited original" });
  for (let i = 0; i < 10; i += 1) f.save({ summary: `Seed ${i}`, workLink: link(root), references: [citation(f, cited)] });
  const before = snapshot(f.base), readFile = fs.readFileSync, reads = new Map();
  fs.readFileSync = (file, ...args) => {
    if (/work-evidence-[a-f0-9]{24}\.json$/.test(String(file))) reads.set(String(file), (reads.get(String(file)) || 0) + 1);
    return readFile(file, ...args);
  };
  let value; try { value = f.read({ maxRecords: 4 }); } finally { fs.readFileSync = readFile; }
  assert.ok(value.organization.relatedReadAttempts <= 4);
  for (const [file, count] of reads) assert.ok(count <= 2, `${file}: one metadata scan plus at most one fresh selected/related load, got ${count}`);
  assert.equal(value.records.filter(record => record.evidenceId === root.evidence.evidenceId).length, 1);
  assert.equal(value.records.filter(record => record.evidenceId === cited.evidence.evidenceId).length, 1);
  accounting(value); assert.deepEqual(snapshot(f.base), before);
});

test("qualifier detail is bounded independently of full incoming state/count evidence", t => {
  const f = fixture(t), target = f.save({ summary: "Target root" });
  for (let i = 0; i < 18; i += 1) f.save({ occurrenceKey: `qualifier-${i}`, workLink: link(target),
    executionObservation: { state: ["running", "paused", "ended", "unknown"][i % 4], target: exact(target) } });
  const value = f.read({ maxRecords: 2 }), activity = recordFor(value, target).savedActivity;
  assert.deepEqual([...activity.states].sort(), ["ended", "paused", "running", "unknown"]);
  assert.equal(activity.qualifierCount, 18); assert.ok(activity.qualifiers.length <= 2);
  assert.equal(activity.qualifiers.length + activity.omittedQualifierCount, 18);
  assert.equal(activity.unavailableQualifierCount, 0); accounting(value, 2);
});

test("related-load attempt exhaustion is disclosed without making the latest result ineligible", t => {
  const f = fixture(t), root = f.save({ summary: "Root" });
  const citations = Array.from({ length: 7 }, (_, index) => f.save({ summary: `Explicit citation ${index}` }));
  const latest = f.save({ summary: "Latest result", pending: ["X"], workLink: link(root), references: citations.map(saved => citation(f, saved)) });
  const before = snapshot(f.base), value = f.read({ maxRecords: 2 });
  assert.equal(value.records[0].evidenceId, latest.evidence.evidenceId);
  assert.deepEqual(value.records[0].content.pending, ["X"]);
  assert.ok(value.organization.relatedReadAttempts <= 2); assert.ok(value.organization.relatedExpansionDeferred > 0);
  assert.equal(value.ordinaryWorkBlocked, false); accounting(value, 2); assert.deepEqual(snapshot(f.base), before);
});

test("file-byte citation digest is distinct from evidenceDigest and source/arbitrary artifacts do not become cited work", t => {
  const f = fixture(t), root = f.save({ summary: "Root" }), reason = f.save({ summary: "Actual cited work" }), ref = citation(f, reason);
  assert.notEqual(ref.digest, reason.evidence.evidenceDigest);
  assert.throws(() => f.save({ summary: "Wrong citation digest domain", workLink: link(root), references: [{ ...ref, digest: reason.evidence.evidenceDigest }] }));
  const sourceFile = path.join(f.root, "source.txt"), artifactFile = path.join(f.root, "arbitrary.json");
  fs.writeFileSync(sourceFile, "Source is not a work judgment");
  fs.writeFileSync(artifactFile, JSON.stringify({ projectId: root.evidence.projectId, text: "Arbitrary retained evidence" }));
  f.save({ summary: "Latest source references", workLink: link(root), references: [
    { path: "source.txt", digest: sha(fs.readFileSync(sourceFile)), kind: "source" },
    { path: "arbitrary.json", digest: sha(fs.readFileSync(artifactFile)), kind: "artifact" },
  ] });
  const read = f.read({ maxRecords: 2 }); assert.ok(!read.records.some(record => record.selectionRole === "cited")); accounting(read);
});

test("oversized related originals do not block a small latest result; actual overlays and references consume the budget", t => {
  const f = fixture(t), root = f.save({ summary: "LARGE ROOT " + "r".repeat(18000) });
  const cited = f.save({ summary: "LARGE REASON " + "c".repeat(18000) });
  const latest = f.save({ summary: "Small latest result", pending: ["X"], workLink: link(root), references: [citation(f, cited)] });
  const value = f.read({ maxRecords: 4, maxCharacters: 7000 });
  assert.ok(recordFor(value, latest)); assert.deepEqual(recordFor(value, latest).content.pending, ["X"]);
  assert.equal(recordFor(value, root), undefined); assert.equal(recordFor(value, cited), undefined); accounting(value, 4, 7000);
  const tiny = f.read({ maxRecords: 4, maxCharacters: 2 }); assert.deepEqual(tiny.records, []); accounting(tiny, 4, 2);
});

test("exact and lexical page reads keep only requested bodies and disclose uninspected relation scope", t => {
  const f = fixture(t), saved = representative(f), before = snapshot(f.base);
  const value = f.read({ evidenceIds: [saved.ended.evidence.evidenceId, saved.ended.evidence.evidenceId], maxRecords: 8 });
  assert.deepEqual(value.records.map(r => r.evidenceId), [saved.ended.evidence.evidenceId]);
  assert.equal(value.records[0].savedActivity.coverage, "not-inspected");
  assert.equal(value.coverage.inspected, 1); assert.equal(value.omissions.uninspected, null); accounting(value);
  const names = fs.readdirSync(path.dirname(saved.root.file)).filter(name => /^work-evidence-.*\.json$/.test(name)).sort();
  const anchor = names.at(-2).slice(0, -5), page = f.read({ afterEvidenceId: anchor, maxRecords: 8 });
  assert.deepEqual(page.records.map(r => r.evidenceId), [names.at(-1).slice(0, -5)]);
  assert.equal(page.nextAfterEvidenceId, null); accounting(page);
  assert.deepEqual(snapshot(f.base), before);
});

test("a selected qualifier changed after metadata scan makes dependent activity partial in the same response", t => {
  const f = fixture(t), target = f.save({ summary: "Target", executionObservation: { state: "running" } });
  const qualifier = f.save({ workLink: link(target), executionObservation: { state: "ended", target: exact(target) } });
  const originalRead = fs.readFileSync; let changed = false;
  fs.readFileSync = (file, ...args) => {
    const bytes = originalRead(file, ...args);
    if (file === qualifier.file && !changed) { changed = true; fs.writeFileSync(file, "{}"); }
    return bytes;
  };
  let value; try { value = f.read({ maxRecords: 8 }); } finally { fs.readFileSync = originalRead; }
  assert.equal(changed, true); assert.equal(recordFor(value, qualifier), undefined);
  const activity = recordFor(value, target).savedActivity;
  assert.equal(activity.coverage, "partial"); assert.ok(activity.unavailableQualifierCount >= 1);
  assert.ok(!activity.states.includes("ended")); assert.equal(value.ordinaryWorkBlocked, false); accounting(value);
});

test("a selected target changed after scan cannot leave its qualifier relation verified or suppress the intact latest note", t => {
  const f = fixture(t), target = f.save({ summary: "Target root" });
  const qualifier = f.save({ pending: ["X survives missing anchor"], workLink: link(target), executionObservation: { state: "ended", target: exact(target) } });
  const originalRead = fs.readFileSync; let changed = false;
  fs.readFileSync = (file, ...args) => {
    const bytes = originalRead(file, ...args);
    if (file === target.file && !changed) { changed = true; fs.writeFileSync(file, "{}"); }
    return bytes;
  };
  let value; try { value = f.read({ maxRecords: 4 }); } finally { fs.readFileSync = originalRead; }
  assert.equal(changed, true); assert.equal(recordFor(value, target), undefined);
  const latest = recordFor(value, qualifier);
  assert.ok(latest); assert.deepEqual(latest.content.pending, ["X survives missing anchor"]);
  assert.equal(latest.savedActivity.coverage, "partial");
  assert.equal(latest.savedActivity.relations.find(relation => relation.role === "target").status, "unavailable");
  accounting(value);
});

test("a root absent before enumeration is an unavailable relation, not an extra inspected original", t => {
  const f = fixture(t), root = f.save({ summary: "Root saved before bounded work" });
  const latest = f.save({ summary: "Intact latest result", pending: ["X remains"], workLink: link(root) });
  fs.unlinkSync(root.file);
  const before = snapshot(f.base), value = f.read();
  assert.equal(value.coverage.originals, 1); assert.equal(value.coverage.inspected, 1);
  assert.equal(value.coverage.valid, 1); assert.equal(value.coverage.unavailable, 0);
  assert.deepEqual(value.unavailable, []);
  const selected = recordFor(value, latest);
  assert.ok(selected); assert.deepEqual(selected.content.pending, ["X remains"]);
  assert.equal(selected.savedActivity.relations.find(relation => relation.role === "root").status, "unavailable");
  assert.equal(selected.savedActivity.coverage, "partial");
  assert.ok(value.organization.unavailableRelations >= 1);
  accounting(value); assert.deepEqual(snapshot(f.base), before);
});

test("a citation absent before enumeration preserves reference diagnosis without inflating inspected-original counts", t => {
  const f = fixture(t), root = f.save({ summary: "Intact root" }), cited = f.save({ summary: "Previously cited reason" });
  const latest = f.save({ summary: "Intact latest result", pending: ["X remains"], workLink: link(root), references: [citation(f, cited)] });
  fs.unlinkSync(cited.file);
  const before = snapshot(f.base), value = f.read();
  assert.equal(value.coverage.originals, 2); assert.equal(value.coverage.inspected, 2);
  assert.equal(value.coverage.valid, 2); assert.equal(value.coverage.unavailable, 0);
  assert.deepEqual(value.unavailable, []);
  const selected = recordFor(value, latest);
  assert.ok(selected); assert.deepEqual(selected.content.pending, ["X remains"]);
  assert.equal(selected.references[0].status, "unavailable");
  assert.equal(selected.references[0].contentReconstructed, false);
  assert.ok(recordFor(value, root)); assert.equal(recordFor(value, cited), undefined);
  accounting(value); assert.deepEqual(snapshot(f.base), before);
});
