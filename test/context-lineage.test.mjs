import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { spawn } from "node:child_process";
import vm from "node:vm";
import { compareExactSourceVersions } from "../scripts/lib/context-source-delta.mjs";
import { createContextSourceReader } from "../scripts/lib/context-source-reader.mjs";
import { queryProjectGraph } from "../scripts/lib/project-graph.mjs";
import { buildGraphExplorerSnapshot, exportGraphExplorer } from "../scripts/lib/graph-explorer.mjs";
import { formatCliResult } from "../scripts/lib/cli-presentation.mjs";
import { dispatch } from "../scripts/mcp-server.mjs";
import { fixture, sha, snapshot, pluginRoot } from "./helpers/session-work-linkage-fixture.mjs";
import { buildWorldModel } from "../scripts/lib/world-model.mjs";
import { compileContext } from "../scripts/lib/context-compiler.mjs";
import { createWholePlanSnapshot, createExecutionContract } from "../scripts/lib/execution-lineage.mjs";
import { startRun, finishRun, getPendingReviewContext, reviewRun } from "../scripts/lib/run-lineage.mjs";
import { recordChangeSet } from "../scripts/lib/change-set.mjs";
import { proposeProductPolicy, reviewProductPolicy } from "../scripts/lib/product-policy.mjs";
import { createHeadSession, withSessionRoute } from "../scripts/lib/session-routing.mjs";
import { recordSessionWorkEvidence } from "../scripts/lib/session-work-context.mjs";
import { normalizeProductModelDocument } from "../scripts/lib/product-model.mjs";

const oldSource = "export function f() { return 'allow'; }\nexport function g() { return 2; }\n";
const newSource = oldSource.replace("'allow'", "'block'");
const version = (text, file = "src/action.mjs", projectId = "synthetic-project") => ({ text, digest: sha(text), path: file, projectId, basis: { kind: "synthetic-exact-version" } });
const compare = (a, b, file) => compareExactSourceVersions(version(a, file), version(b, file), "synthetic-project");
const symbol = (result, name) => result.symbols.find(item => (item.after || item.before).qualifiedName === name);

test("comment removal preserves token boundaries and line terminators instead of claiming code edits are comment-only", () => {
  const pairs = [
    ["function f(x) { return typeof/**/x; }\n", "function f(x) { return typeofx/**/; }\n", "number", "sentinel"],
    ["function f() { return/*\n*/1; }\n", "function f() { return/**/1; }\n", undefined, 1],
    ["function f() { return/*\r*/1; }\n", "function f() { return/**/1; }\n", undefined, 1],
    ["function f() { return/*\u2028*/1; }\n", "function f() { return/**/1; }\n", undefined, 1],
    ["function f() { return/*\u2029*/1; }\n", "function f() { return/**/1; }\n", undefined, 1],
    ["function f() { let x=1; return x +/**/+ 2; }\n", "function f() { let x=1; return x++/**/ + 2; }\n", 3, 3],
  ];
  for (const [before, after, beforeValue, afterValue] of pairs) {
    // Execute only these fixed synthetic strings, never repository input.
    assert.equal(vm.runInNewContext(before + "f(1)", { typeofx: "sentinel" }), beforeValue);
    assert.equal(vm.runInNewContext(after + "f(1)", { typeofx: "sentinel" }), afterValue);
    assert.notEqual(symbol(compare(before, after), "f").observation, "comment-text-only-difference");
  }
  assert.equal(symbol(compare("function f(){ return typeof/* first */x; }", "function f(){ return typeof/* second */x; }"), "f").observation, "comment-text-only-difference");
});

test("Canon changed description, status and relationships remain visible in both actual presentation consumers", () => {
  const document = { schemaVersion: 2, featureGroups: [{ key: "local", name: "Local" }], capabilities: [],
    features: [{ key: "export", name: "Export" }], requirements: [{ key: "approval", statement: "Require approval" }], constraints: [], decisions: [],
    policies: [{ key: "export", name: "Export policy", statement: "Allow local export", description: "BEFORE_REQUIRES_APPROVAL", status: "active", appliesTo: [], governedBy: [] }] };
  const before = normalizeProductModelDocument(document), changed = structuredClone(document);
  Object.assign(changed.policies[0], { description: "AFTER_EXPORT_DENIED", status: "retired", appliesTo: [{ kind: "Feature", key: "export" }], governedBy: [{ kind: "Requirement", key: "approval" }] });
  const after = normalizeProductModelDocument(changed);
  const change = { field: "policies", key: "export", before: before.policies[0], after: after.policies[0] };
  const context = { files: [], events: [], recordedReasons: [], canonChanges: [{ review: { nodeId: "review" }, before: { nodeId: before.productModelId }, after: { nodeId: after.productModelId },
    status: "exact-recorded-model-delta", rationale: "Historical review, not current permission", changes: [change], omittedChangeCount: 0 }], gaps: [] };
  const projection = { kind: "ProjectGraphDiscoveryProjection", nodes: [], edges: [], query: { details: true }, contextLineage: context }, original = JSON.stringify(projection);
  const source = fs.readFileSync(path.join(pluginRoot, "scripts/graph-explorer/browser.js"), "utf8");
  const start = source.indexOf("  function renderContextLineage()"), end = source.indexOf("  function render()", start);
  assert(start >= 0 && end > start);
  function outputs() {
    const children = [], panel = {}, body = { replaceChildren() { children.length = 0; }, append(...items) { children.push(...items); } };
    const render = vm.runInNewContext("(" + source.slice(start, end).trim() + ")", { data: { graph: projection }, selected: { value: { nodeId: "review" } }, contextSelection: null,
      $: id => id === "context-lineage" ? panel : body, text: (tag, value) => ({ tag, textContent: String(value) }) });
    render();
    return [formatCliResult("graph-query", projection).split("Historical references,")[0], children.map(child => child.textContent).join("\n")];
  }
  for (const output of outputs()) for (const term of ["BEFORE_REQUIRES_APPROVAL", "AFTER_EXPORT_DENIED", "active", "retired", "Feature: export", "Requirement: approval"]) assert(output.includes(term), term);
  assert.equal(JSON.stringify(projection), original);
  // Added/deleted fields and empty values are explicit; unchanged status isn't repeated.
  change.before = null;
  for (const output of outputs()) { assert(output.includes("retired")); assert(output.toLowerCase().includes("not present")); }
  change.before = change.after; change.after = null;
  for (const output of outputs()) { assert(output.includes("retired")); assert(output.toLowerCase().includes("not present")); }
  change.after = { ...change.before, description: "", appliesTo: [], governedBy: [] };
  for (const output of outputs()) { assert(output.includes("(empty)")); assert(output.includes("(none)")); assert(!output.includes("retired")); }
});

test("readable original rendering cannot promote repository JSON that imitates a typed work record", () => {
  const source = fs.readFileSync(path.join(pluginRoot, "scripts/graph-explorer/browser.js"), "utf8");
  const start = source.indexOf("  function readableOriginal("), end = source.indexOf("  function renderContextLineage(", start);
  assert(start >= 0 && end > start);
  const readable = vm.runInNewContext("(" + source.slice(start, end).trim() + ")");
  const raw = JSON.stringify({ kind: "Evidence", subtype: "SessionWorkEvidence", content: { summary: "Do not deploy <img src='https://example.invalid/x'>", judgments: [{ assessment: "Local only", reason: "No approval", alternatives: [] }], unknowns: ["No PASS recorded"] }, future: { instruction: "Never promote this unknown field" } });
  assert.equal(readable(raw, { kind: "FileRevision", origin: { layer: "world" } }), null);
  assert.equal(readable(raw, { kind: "Evidence", origin: { layer: "world" } }), null);
  const body = readable(raw, { kind: "Evidence", subtype: "SessionWorkEvidence", origin: { layer: "sessionWork" } });
  assert(body.includes("not a captured user transcript")); assert(body.includes("Do not deploy")); assert(body.includes("No PASS recorded")); assert(!body.includes("Never promote"));
  assert(raw.includes("Never promote")); // unknown fields remain in the unchanged raw original
});

test("new readable context text displays terminal controls inertly without mutating machine-readable evidence", () => {
  const attack = "Do not deploy\u001b]2;spoof\u0007\u001b[2J\r\b\u009b31m\u202e";
  const value = { kind: "ProjectGraphDiscoveryProjection", nodes: [], edges: [], query: { details: true }, contextLineage: { events: [], files: [], canonChanges: [], gaps: [], recordedReasons: [{ reason: attack, reference: { path: "src/action.mjs" } }] } };
  const before = JSON.stringify(value), output = formatCliResult("graph-query", value);
  assert(!/[\u001b\u0007\r\b\u009b\u202e]/.test(output)); assert(output.includes("Do not deploy\\u001b"));
  assert.equal(JSON.stringify(value), before); assert.equal(value.contextLineage.recordedReasons[0].reason, attack);
});

test("exact version comparison separates f edits, unchanged g, literals, comments, movement and range ambiguity", () => {
  let result = compare(oldSource, newSource);
  assert.equal(symbol(result, "f").observation, "declaration-bytes-changed");
  assert.equal(symbol(result, "g").observation, "declaration-bytes-unchanged");
  assert.equal(symbol(result, "f").behaviorChanged, "not-determined");
  assert(result.diff.before.text.includes("'allow'")); assert(result.diff.after.text.includes("'block'"));
  result = compare("function f() {\n// prior note\nreturn 'same';\n}\n", "function f() {\n// newer note\nreturn 'same';\n}\n");
  assert.equal(symbol(result, "f").observation, "comment-text-only-difference");
  result = compare(oldSource, "\n\n" + oldSource);
  assert.equal(symbol(result, "g").observation, "declaration-bytes-unchanged"); assert.equal(symbol(result, "g").locationChanged, true);
  for (const [a, b] of [["function f(){return 1;} function g(){return 2;}", "function f(){return 3;} function g(){return 2;}"],
    ["function f(){return 1;} log(1);", "function f(){return 1;} log(2);"],
    ["function f(x={a:1}) { return x; }", "function f(x={a:2}) { return x; }"],
    ["function f(){return /a{2}/;}", "function f(){return /a{3}/;}"],
    ["function f(){return `literal`;}", "function f(){return `changed`;}"],
    ["function f(){return 1;}\nfunction f(){return 2;}", "function f(){return 3;}\nfunction f(){return 2;}"]]) {
    result = compare(a, b); assert.equal(symbol(result, "f").observation, "unknown-boundary");
  }
  result = compare("def f():\n    return 'allow'\n\ndef g():\n    return 2\n", "def f():\n    return 'block'\n\ndef g():\n    return 2\n", "src/action.py");
  assert.equal(symbol(result, "f").observation, "declaration-bytes-changed"); assert.equal(symbol(result, "g").observation, "declaration-bytes-unchanged");
  result = compare("def f():\n    return 1\n# first\ndef g():\n    return 2\n", "def f():\n    return 1\n# other\ndef g():\n    return 2\n", "src/action.py");
  assert.equal(symbol(result, "f").observation, "unknown-boundary");
  result = compare("def f():\n    \"\"\"allow\"\"\"\n    return 1\n", "def f():\n    \"\"\"block\"\"\"\n    return 1\n", "src/action.py");
  assert.notEqual(symbol(result, "f").observation, "comment-text-only-difference");
});

test("rename, deletion, nested names, unsupported languages, truncated analysis and mismatched originals stay conservative", () => {
  const removed = compare(oldSource, "export function f() { return 'allow'; }\n");
  assert.equal(symbol(removed, "g").observation, "unmatched-declaration-not-proven-rename-or-continuity");
  const nested = compare("class A:\n    def f(self):\n        return 1\nclass B:\n    def f(self):\n        return 2\n", "class A:\n    def f(self):\n        return 3\nclass B:\n    def f(self):\n        return 2\n", "src/a.py");
  assert.equal(symbol(nested, "A.f").observation, "declaration-bytes-changed"); assert.equal(symbol(nested, "B.f").observation, "declaration-bytes-unchanged");
  const go = compare("package a", "package b", "src/a.go"); assert.equal(go.analysis.before.status, "unsupported-language"); assert.deepEqual(go.symbols, []);
  const many = Array.from({ length: 201 }, (_, i) => `function f${i}(){ return ${i}; }`).join("\n");
  assert.equal(compare(many, many).analysis.before.potentiallyTruncated, true);
  for (const after of [version(newSource, "src/renamed.mjs"), version(newSource, "src/action.mjs", "another-project"), { ...version(newSource), digest: sha(oldSource) }]) {
    assert.equal(compareExactSourceVersions(version(oldSource), after, "synthetic-project").status, "unknown");
  }
});

async function run(t, command, args, cwd) {
  t.diagnostic(JSON.stringify({ event: "planned-child", command, args, cwd, parent: process.pid, ports: [] }));
  const child = spawn(command, args, { cwd, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null", GIT_TERMINAL_PROMPT: "0" } });
  t.diagnostic(JSON.stringify({ event: "started-child", pid: child.pid, parent: process.pid, command, cwd, ports: [] }));
  let stdout = "", stderr = ""; child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
  const timer = setTimeout(() => child.kill(), 15000);
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); }).finally(() => clearTimeout(timer));
  t.diagnostic(JSON.stringify({ event: "exited-child", pid: child.pid, code, ports: [] })); assert.equal(code, 0, stderr); return stdout;
}
async function localGit(t, f, source = oldSource) {
  fs.mkdirSync(path.join(f.root, "src")); fs.writeFileSync(path.join(f.root, "src/action.mjs"), source);
  fs.mkdirSync(path.join(f.base, "no-hooks"));
  const git = args => run(t, "git", ["-c", `core.hooksPath=${path.join(f.base, "no-hooks")}`, "-c", "user.name=Synthetic", "-c", "user.email=synthetic@example.invalid", "-c", "commit.gpgsign=false", ...args], f.root);
  await git(["init", "--quiet"]); await git(["add", "--", "src/action.mjs"]); await git(["commit", "--quiet", "-m", "Synthetic baseline; no Run attribution"]);
  return git;
}
function graph(root, extra = {}) { return queryProjectGraph({ root, paths: ["src/action.mjs"], details: true, depth: 3, ...extra }); }

test("Run-free and non-Git work preserves recorded reasons, proposal-only gaps and same-mtime source drift without World or new writes", async t => {
  const f = fixture(t); fs.mkdirSync(path.join(f.root, "src")); fs.writeFileSync(path.join(f.root, "src/action.mjs"), oldSource);
  const saved = f.save({ summary: "Investigate action; proposal only, not permission to deploy", judgments: [{ assessment: "Compare exact action sources", reason: "Keep caller conditions and prior reasoning" }],
    pending: ["No execution result recorded"], unknowns: ["Deployment not verified"], references: [{ kind: "source", path: "src/action.mjs", digest: sha(oldSource) }] });
  const before = snapshot(f.base), first = await graph(f.root); assert.deepEqual(snapshot(f.base), before);
  assert(first.contextLineage.recordedReasons.some(item => item.reason.includes("caller conditions")));
  assert(first.contextLineage.events.some(item => item.nodeId === saved.evidence.evidenceId && item.sourceRole.includes("not-user-transcript")));
  const stat = fs.statSync(path.join(f.root, "src/action.mjs")); fs.writeFileSync(path.join(f.root, "src/action.mjs"), newSource); fs.utimesSync(path.join(f.root, "src/action.mjs"), stat.atime, stat.mtime);
  const modified = snapshot(f.base), second = await graph(f.root, { previousResult: first }); assert.deepEqual(snapshot(f.base), modified);
  assert.notEqual(second.basis.contextLineageDigest, first.basis.contextLineageDigest);
  assert.equal(second.contextLineage.files[0].current.digest, sha(newSource));
  assert(second.contextLineage.files[0].comparisons.some(pair => pair.status === "unknown"));
  const eventOnly = await queryProjectGraph({ root: f.root, anchorIds: [saved.evidence.evidenceId], details: true, depth: 0 });
  assert(eventOnly.contextLineage.events.length); assert.equal(eventOnly.contextLineage.authority.executionAuthority, false);
});

test("local exact Git bytes connect writer, query, typed MCP, CLI and Explorer without attributing a mixed commit or creating records", async t => {
  const f = fixture(t), git = await localGit(t, f);
  fs.writeFileSync(path.join(f.root, "notes.md"), "Unrelated concurrent work\n"); await git(["add", "--", "notes.md"]); await git(["commit", "--quiet", "-m", "Mixed scope; same code blob"]);
  const saved = f.save({ summary: "Recorded action investigation", judgments: [{ assessment: "Check f, leave g unchanged", reason: "Preserve the independent g behavior; outcome is unverified" }], references: [{ kind: "source", path: "src/action.mjs", digest: sha(oldSource) }] });
  fs.writeFileSync(path.join(f.root, "src/action.mjs"), newSource);
  const before = snapshot(f.base), found = await graph(f.root); assert.deepEqual(snapshot(f.base), before);
  const pair = found.contextLineage.files[0].comparisons[0]; assert.equal(pair.before.digest, sha(oldSource)); assert.equal(pair.after.digest, sha(newSource));
  assert.equal(pair.before.basis.kind, "local-git-exact-blob"); assert.equal(symbol(pair, "g").observation, "declaration-bytes-unchanged");
  assert(pair.before.basis.commitAttribution.includes("not-Run")); assert(found.contextLineage.events.some(item => item.nodeId === saved.evidence.evidenceId));
  const mcp = await dispatch({ id: 1, method: "tools/call", params: { name: "head_project_graph", arguments: { project_root: f.root, paths: ["src/action.mjs"], details: true, depth: 3 } } });
  assert(!mcp.error); assert(!mcp.result.isError); assert(JSON.stringify(mcp.result).includes("declaration-bytes-unchanged"));
  const cli = await run(t, process.execPath, [path.join(pluginRoot, "scripts/lode.mjs"), "graph-query", f.root, "--paths", "src/action.mjs", "--details"], pluginRoot);
  assert(cli.includes("Source context")); assert(cli.includes("'allow'")); assert(cli.includes("'block'"));
  assert(formatCliResult("graph-query", found).includes("Recorded reason (not proven change cause)"));
  const explorer = await buildGraphExplorerSnapshot({ root: f.root, query: "src/action.mjs" });
  assert(explorer.graph.contextLineage.files.some(file => file.path === "src/action.mjs"));
  const exported = await exportGraphExplorer({ root: f.root, query: "src/action.mjs", output: path.join(f.base, "context.html") });
  const html = fs.readFileSync(exported.file, "utf8"); assert(html.includes("Recorded code context")); assert(html.includes("Recorded/cited source")); assert(html.includes("declaration-bytes-changed"));
  const after = snapshot(f.base); delete after["context.html"]; assert.deepEqual(after, before);
});

test("a reviewed ChangeSet exposes exact recorded before/after separately from later current and unchanged g revisions", async t => {
  const f = fixture(t); await localGit(t, f);
  const beforeWorld = await buildWorldModel({ root: f.root });
  const capsule = f.route(() => compileContext({ root: f.root, task: "Change f, preserve g", budget: 32768, persist: true })).capsule;
  const plan = f.route(() => createWholePlanSnapshot({ root: f.root, objective: "Change f only", plan: [{ id: "edit", outcome: "Exact f edit" }] })).artifact;
  const contract = f.route(() => createExecutionContract({ root: f.root, wholePlanId: plan.wholePlanId, capsuleId: capsule.capsuleId, scope: "f only", acceptanceCriteria: ["g bytes unchanged"] })).artifact;
  f.route(() => startRun({ root: f.root, executionContractId: contract.executionContractId })); fs.writeFileSync(path.join(f.root, "src/action.mjs"), newSource);
  const result = f.route(() => finishRun({ root: f.root, outcome: "Recorded f edit", evidence: [{ uri: "src/action.mjs", digest: sha(newSource), summary: "Exact synthetic edit" }], verification: [{ check: "Fixture bytes", status: "passed" }] }));
  const pending = f.route(() => getPendingReviewContext({ root: f.root }));
  const review = f.route(() => reviewRun({ root: f.root, reviewContextId: pending.review.reviewContextId, disposition: "accept", rationale: "Synthetic review of exact recorded f scope" }));
  await buildWorldModel({ root: f.root });
  const recorded = await f.route(() => recordChangeSet({ root: f.root, resultPacketId: result.resultPacket.resultPacketId, reviewDecisionId: review.reviewDecision.reviewDecisionId, beforeWorldModelId: beforeWorld.snapshot.worldModelId }));
  assert(recorded.changeSet.changes.some(change => change.name === "g" && change.changeKind === "modified"));
  const found = await graph(f.root, { depth: 4 });
  const pair = found.contextLineage.files[0].comparisons.find(item => item.scope === "recorded-changeset-snapshot-pair");
  assert(pair); assert.equal(pair.before.digest, sha(oldSource)); assert.equal(pair.after.digest, sha(newSource)); assert.equal(symbol(pair, "g").observation, "declaration-bytes-unchanged");
  // Preserve a local exact after blob, then make an unrelated later edit.
  const git = args => run(t, "git", ["-c", `core.hooksPath=${path.join(f.base, "no-hooks")}`, "-c", "user.name=Synthetic", "-c", "user.email=synthetic@example.invalid", "-c", "commit.gpgsign=false", ...args], f.root);
  await git(["add", "--", "src/action.mjs"]); await git(["commit", "--quiet", "-m", "Recorded after blob; not unique Run ownership"]);
  const later = newSource.replace("'block'", "'later'"); fs.writeFileSync(path.join(f.root, "src/action.mjs"), later);
  const unchanged = snapshot(f.base), current = await graph(f.root, { depth: 4 }); assert.deepEqual(snapshot(f.base), unchanged);
  const historical = current.contextLineage.files[0].comparisons.find(item => item.scope === "recorded-changeset-snapshot-pair");
  assert.equal(historical.after.digest, sha(newSource)); assert.equal(historical.currentMatchesRecordedAfter, false);
  assert.equal(current.contextLineage.files[0].current.digest, sha(later));
});

test("work event anchors expose code and document citation comparisons without claiming a captured request or fulfillment", async t => {
  const f = fixture(t), git = await localGit(t, f), beforeDoc = "# Review boundary\nDo not deploy.\n", afterDoc = "# Review boundary\nDo not deploy; local review only.\n";
  fs.writeFileSync(path.join(f.root, "notes.md"), beforeDoc); await git(["add", "--", "notes.md"]); await git(["commit", "--quiet", "-m", "Synthetic documentation baseline"]);
  const root = f.save({ summary: "Recorded request context: inspect f and notes; deployment remains cancelled", judgments: [{ assessment: "Inspect locally", reason: "기존 기록을 지우지 말고, 배포하지 말 것" }],
    references: [{ kind: "source", path: "src/action.mjs", digest: sha(oldSource) }, { kind: "source", path: "notes.md", digest: sha(beforeDoc) }] });
  fs.writeFileSync(path.join(f.root, "src/action.mjs"), newSource); fs.writeFileSync(path.join(f.root, "notes.md"), afterDoc);
  const target = { evidenceId: root.evidence.evidenceId, evidenceDigest: root.evidence.evidenceDigest };
  const observed = f.save({ summary: "HEAD observed local f and notes edits; external result unknown", observedWork: ["Local source and document bytes changed"], pending: ["Independent review remains"], unknowns: ["No deployment was verified"],
    workLink: { root: target, predecessor: target }, references: [{ kind: "source", path: "src/action.mjs", digest: sha(newSource) }, { kind: "source", path: "notes.md", digest: sha(afterDoc) }] });
  await git(["add", "--", "src/action.mjs", "notes.md"]); await git(["commit", "--quiet", "-m", "Two files; commit is not event causality"]);
  const before = snapshot(f.base), found = await queryProjectGraph({ root: f.root, anchorIds: [observed.evidence.evidenceId], details: true, depth: 3 });
  assert.deepEqual(snapshot(f.base), before);
  assert(found.contextLineage.files.some(file => file.path === "src/action.mjs")); assert(found.contextLineage.files.some(file => file.path === "notes.md"));
  for (const file of found.contextLineage.files) assert(file.comparisons.some(pair => pair.scope === "explicit-work-chain-citation-pair-not-request-boundary" && pair.timeOrder.includes("not-established")));
  const body = formatCliResult("graph-query", found); assert(body.includes("Do not deploy")); assert(body.includes("기존 기록을 지우지 말고")); assert(body.includes("Cited version A")); assert(body.includes("not a captured user message"));
  const again = await queryProjectGraph({ root: f.root, anchorIds: [observed.evidence.evidenceId], details: true, depth: 3, previousResult: found });
  assert.deepEqual(again.contextLineage.files, found.contextLineage.files);
  // Historical availability changes without changing the same current sources.
  const retainedGit = path.resolve(f.base, "retained-git"); assert.equal(path.dirname(retainedGit), f.base); assert(path.join(f.root, ".git").startsWith(f.base + path.sep));
  fs.renameSync(path.join(f.root, ".git"), retainedGit);
  const lost = await queryProjectGraph({ root: f.root, anchorIds: [observed.evidence.evidenceId], details: true, depth: 3, previousResult: again });
  assert.notEqual(lost.basis.contextLineageDigest, again.basis.contextLineageDigest);
  assert(lost.contextLineage.files.some(file => file.comparisons.some(pair => pair.status === "unknown")));
});

test("Canon comparison reads exact retained models and actual review reason, not graph ID differences", async t => {
  const f = fixture(t), proposed = await proposeProductPolicy({ root: f.root, operation: "create", key: "keep-local", name: "Keep local", statement: "Do not deploy without explicit permission." });
  const accepted = await reviewProductPolicy({ root: f.root, candidateId: proposed.candidate.candidateId, disposition: "accept", rationale: "Retain the user's cancellation boundary." });
  const before = snapshot(f.base), found = await queryProjectGraph({ root: f.root, details: true, depth: 3, query: "Keep local" });
  assert.deepEqual(snapshot(f.base), before);
  const delta = found.contextLineage?.canonChanges.find(item => item.status === "exact-recorded-model-delta");
  assert(delta); assert(delta.rationale.includes("cancellation")); assert(delta.changes.some(item => item.key === "keep-local" && item.after.statement.includes("Do not deploy")));
});

test("same-title source citations from two logical Sessions stay distinct and neither supplies direct user authorship or completion", async t => {
  const f = fixture(t); fs.mkdirSync(path.join(f.root, "src")); fs.writeFileSync(path.join(f.root, "src/action.mjs"), oldSource);
  const content = { summary: "Same title, proposal only", judgments: [{ assessment: "Inspect source", reason: "No execution result or deployment approval" }], references: [{ kind: "source", path: "src/action.mjs", digest: sha(oldSource) }] };
  const a = f.save(content), second = createHeadSession({ root: f.root, purpose: "Independent investigation" });
  const b = withSessionRoute(f.root, second.sessionId, () => recordSessionWorkEvidence({ root: f.root, input: content }));
  const before = snapshot(f.base), found = await graph(f.root); assert.deepEqual(snapshot(f.base), before);
  const events = found.contextLineage.events.filter(item => [a.evidence.evidenceId, b.evidence.evidenceId].includes(item.nodeId));
  assert.equal(events.length, 2); assert.equal(new Set(events.map(item => item.sessionId)).size, 2);
  assert(events.every(item => item.sourceRole === "HEAD-authored-P3-work-evidence-not-user-transcript"));
  assert.equal(found.contextLineage.files[0].associations.length, 2); assert.equal(found.contextLineage.projectId, f.owner.project.projectId);
});

test("source reader refuses traversal, links, invalid UTF8 and absent old bytes without switching to unsafe reads", async t => {
  const f = fixture(t), reader = createContextSourceReader(f.root, f.owner.project.projectId);
  assert.equal((await reader.read("../outside", "a".repeat(64))).status, "unavailable");
  fs.writeFileSync(path.join(f.root, "bad.mjs"), Buffer.from([0xff, 0xfe]));
  assert.equal((await reader.read("bad.mjs", "a".repeat(64))).status, "unavailable");
  const missing = await reader.read("missing.mjs", "a".repeat(64)); assert.equal(missing.status, "unavailable"); assert.equal(reader.diagnostics().writes, false);
  fs.mkdirSync(path.join(f.base, "outside-source")); fs.writeFileSync(path.join(f.base, "outside-source/action.mjs"), oldSource);
  try { fs.symlinkSync(path.join(f.base, "outside-source"), path.join(f.root, "linked"), process.platform === "win32" ? "junction" : "dir");
    const linked = await reader.read("linked/action.mjs", sha(oldSource)); assert.equal(linked.reasonCode, "PROJECT_GRAPH_SYMLINK_PATH");
  } catch (error) { if (!["EPERM", "EACCES"].includes(error.code)) throw error; t.diagnostic(`Directory-link fixture unavailable: ${error.code}; physical link case not claimed`); }
  fs.writeFileSync(path.join(f.root, "denied.mjs"), oldSource);
  const open = fs.openSync, denied = createContextSourceReader(f.root, f.owner.project.projectId);
  t.mock.method(fs, "openSync", function(file, ...args) { if (file === path.join(f.root, "denied.mjs")) throw Object.assign(new Error("Synthetic permission denial"), { code: "EACCES" }); return open.call(this, file, ...args); });
  assert.equal((await denied.read("denied.mjs", sha(oldSource))).reasonCode, "EACCES"); assert.equal(denied.diagnostics().localGitCommands, 0);
});

test("merge parents, literal paths, rename/delete and missing promisor blob never become Run ownership or invented source continuity", async t => {
  const f = fixture(t), git = await localGit(t, f);
  const branch = (await git(["branch", "--show-current"])).trim(); await git(["checkout", "--quiet", "-b", "side"]);
  fs.writeFileSync(path.join(f.root, "side.md"), "Independent side work\n"); await git(["add", "--", "side.md"]); await git(["commit", "--quiet", "-m", "Other request side"]);
  await git(["checkout", "--quiet", branch]); fs.writeFileSync(path.join(f.root, "main.md"), "Independent main work\n"); await git(["add", "--", "main.md"]); await git(["commit", "--quiet", "-m", "Other request main"]);
  await git(["merge", "--quiet", "--no-ff", "side", "-m", "Mixed merge; no request-wide causality"]);
  assert.equal((await git(["rev-list", "--parents", "-n", "1", "HEAD"])).trim().split(" ").length, 3);
  fs.writeFileSync(path.join(f.root, "src/a[1].mjs"), oldSource); await git(["add", "--", ":(literal)src/a[1].mjs"]); await git(["commit", "--quiet", "-m", "Literal source name"]);
  fs.writeFileSync(path.join(f.root, "src/a[1].mjs"), newSource);
  const literal = await createContextSourceReader(f.root, f.owner.project.projectId).read("src/a[1].mjs", sha(oldSource)); assert.equal(literal.digest, sha(oldSource)); assert(literal.basis.commitAttribution.includes("not-Run"));
  await git(["mv", "--", "src/action.mjs", "src/renamed.mjs"]); await git(["commit", "--quiet", "-m", "Rename is not a verified logical bridge"]);
  const reader = createContextSourceReader(f.root, f.owner.project.projectId), removedPath = await reader.read("src/action.mjs", sha(oldSource)); assert.equal(removedPath.digest, sha(oldSource));
  const otherPath = await reader.read("src/renamed.mjs", sha(oldSource)); assert.equal(compareExactSourceVersions(removedPath, otherPath, f.owner.project.projectId).reasonCode, "SOURCE_PAIR_IDENTITY_MISMATCH");
  const blob = (await git(["hash-object", "--", "src/renamed.mjs"])).trim(), object = path.resolve(f.root, ".git/objects", blob.slice(0, 2), blob.slice(2));
  assert(object.startsWith(path.resolve(f.root, ".git/objects") + path.sep)); assert(fs.existsSync(object));
  fs.renameSync(object, path.join(f.base, "retained-source-object")); fs.writeFileSync(path.join(f.root, "src/renamed.mjs"), newSource);
  await git(["config", "extensions.partialClone", "origin"]); await git(["config", "remote.origin.promisor", "true"]);
  // A local absent path only; even a broken lazy-fetch guard cannot contact a service.
  await git(["config", "remote.origin.url", path.join(f.base, "no-remote-exists")]);
  const unavailable = await createContextSourceReader(f.root, f.owner.project.projectId).read("src/renamed.mjs", sha(oldSource)); assert.equal(unavailable.status, "unavailable");
});
