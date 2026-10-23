import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import crypto from "node:crypto";
import { explorerDom, visibleText } from "./helpers/graph-explorer-dom-fixture.mjs";

const source = fs.readFileSync(new URL("../scripts/graph-explorer/exploration.js", import.meta.url), "utf8");
const factory = () => vm.runInNewContext(source + "\nexplorerModel");
const nodes = (...ids) => ids.map(nodeId => ({ nodeId, name: nodeId, kind: "Feature", views: ["work"] }));
const edge = (from, to, edgeId = `${from}-${to}`, type = "LINK") => ({ from, to, edgeId, type });
const sorted = values => [...values].sort();
function input(graph) { return { kind: "GraphExplorerSnapshot", project: { projectId: "synthetic-only" }, generatedAt: "2026-10-21T00:00:00Z",
  graph: { ...graph, initialNodeId: "A" }, codeGraph: { nodes: [], edges: [], status: "unavailable" }, originals: {}, history: { entries: [] } }; }
function nodeElement(ui, id) { return ui.ids.get("graph").children.find(item => item.getAttribute("data-node") === id); }
function recordButton(ui, id) { return ui.ids.get("records").children.find(item => item.children[0].textContent.startsWith(id))?.children[0]; }
const camera = ui => ui.ids.get("graph").getAttribute("viewBox");
const selectionCount = ui => Number(ui.ids.get("selection-count").textContent.match(/^\d+/)[0]);
const cards = vm.runInNewContext(fs.readFileSync(new URL("../scripts/graph-explorer/cards.js", import.meta.url), "utf8") + "\nexplorerCards");
const descendants = element => [element, ...element.children.flatMap(descendants)];
const readingCard = (ui, id) => ui.ids.get("selection-cards").children.find(item => item.getAttribute("data-record") === `node:${id}`);

test("boundary expansion actually advances, retains stable positions, and folding removes only its contribution", async () => {
  const graph = { nodes: nodes("A", "B", "C", "D"), edges: [edge("A", "B"), edge("B", "C"), edge("C", "D")] };
  const before = JSON.stringify(graph), model = factory().create(graph);
  model.visit("A"); model.choose("A"); const firstPositions = [...model.positions].map(([id, point]) => [id, { ...point }]);
  assert.equal((await model.expandWave()).added, 1); assert(model.visible.has("C"));
  const checkpoint = model.capture();
  assert.equal((await model.expandWave()).added, 1); assert(model.visible.has("D"));
  model.collapse(); assert(!model.visible.has("D")); assert(model.visible.has("C"));
  model.restore(checkpoint); assert.deepEqual(sorted(model.visible), ["A", "B", "C"]);
  for (const [id, point] of firstPositions) assert.deepEqual({ ...model.positions.get(id) }, point);
  model.choose("D"); model.move("C", 2000, 2000); model.collapse();
  assert(model.visible.has("D"), "Explicit selection is not removed by folding"); assert(model.visible.has("C"), "Pinned record is retained");
  assert.equal(JSON.stringify(graph), before);
});

test("shared diamond, cycle, parallel and self edges retain exact evidence across independent additions", async () => {
  const graph = { nodes: nodes("A", "B", "X", "Y"), edges: [edge("A", "X"), edge("B", "X"), edge("X", "Y"), edge("Y", "A"), edge("A", "X", "parallel"), edge("X", "X", "self")] };
  const model = factory().create(graph); model.choose("A"); await model.expandWave();
  model.choose("B"); const prior = model.capture(); await model.expandWave({ key: "new roots" }); model.collapse();
  assert.deepEqual(sorted(model.visible), sorted(new Set([...prior.base, ...prior.steps.flatMap(step => [...step.nodes]), ...prior.chosen])));
  assert.equal(model.links("X").filter(item => item.edgeId === "self").length, 1);
  assert.equal(model.links("A").filter(item => item.to === "X").length, 2);
});

test("selected connections include all tie predecessors, preserve real directions, and cover disconnected selected components", async () => {
  const graph = { nodes: nodes("A", "L", "R", "T", "P", "Q", "B", "C", "isolated"), edges: [
    edge("L", "A", "reverse"), edge("A", "L", "parallel"), edge("L", "T"), edge("A", "R"), edge("R", "T"),
    edge("A", "P"), edge("P", "Q"), edge("Q", "T"), edge("B", "C"), edge("A", "A", "self")] };
  const before = JSON.stringify(graph), model = factory().create(graph);
  for (const id of ["A", "T", "B", "C", "isolated"]) model.choose(id);
  const result = await model.connectSelection({ reference: "A" });
  assert.equal(result.roots.length, 3); assert(result.edges.has(graph.edges[0])); assert(result.edges.has(graph.edges[1]));
  assert(result.edges.has(graph.edges[2])); assert(result.edges.has(graph.edges[3])); assert(result.edges.has(graph.edges[4]));
  assert(result.edges.has(graph.edges[8]), "B/C must not disappear because focus A is disconnected from them");
  assert(!result.edges.has(graph.edges[5]), "Longer branch is not a shortest branch"); assert(model.neighbors("A").includes("P"), "Longer branches remain explorable");
  const roots = JSON.stringify(result.roots); model.choose("T"); assert.equal(JSON.stringify(result.roots), roots, "Reading focus cannot rewrite an already computed result");
  assert.equal(graph.edges[0].from, "L"); assert.equal(graph.edges[0].to, "A"); assert.equal(JSON.stringify(graph), before);
});

test("large scans yield and cancel without committing partial connection, boundary or selection results", async () => {
  const graph = { nodes: nodes(...Array.from({ length: 6000 }, (_, i) => `N${i}`)), edges: Array.from({ length: 5999 }, (_, i) => edge("N0", `N${i + 1}`)) };
  const model = factory().create(graph); model.choose("N0"); const before = sorted(model.visible); let stop = false, yields = 0;
  const options = { cancelled: () => stop, yieldWork: async () => { yields++; stop = true; } };
  assert.equal((await model.expandWave(options)).status, "cancelled"); assert.deepEqual(sorted(model.visible), before);
  stop = false; model.choose("N5999"); assert.equal((await model.connectSelection(options)).status, "cancelled");
  stop = false; const selected = sorted(model.chosen); assert.equal(await model.chooseBatch(graph.nodes.map(node => node.nodeId), options), false);
  assert.deepEqual(sorted(model.chosen), selected); assert(yields >= 3);
});

test("viewport inverse includes CSS rectangle, letterbox and zoom; overview hit uses the same logical points", () => {
  const api = factory(), box = [100, -20, 800, 560], rect = { left: 65, top: 30, width: 600, height: 300 }, view = api.viewport(box, rect);
  const p = view.toClient(320, 170), recovered = view.fromClient(p.x, p.y); assert(Math.abs(recovered.x - 320) < 1e-9); assert(Math.abs(recovered.y - 170) < 1e-9);
  const graph = { nodes: nodes("A", "B", "C"), edges: [] }, overview = api.overview(graph), at = overview.points.get("B"), client = view.toClient(at.x, at.y), back = view.fromClient(client.x, client.y);
  assert.equal(overview.hit(back.x, back.y, new Set(["A", "B", "C"]), 8 / view.scale), "B");
  overview.move("B", 490, 330); assert.equal(overview.hit(490, 330), "B");
});

test("bundled UI keeps additive selection, cards, camera, map mode, folding and real view Back/Forward connected", async () => {
  const snapshot = input({ nodes: nodes("A", "B", "C", "D"), edges: [edge("A", "B"), edge("B", "C"), edge("C", "D")] });
  const before = JSON.stringify(snapshot), ui = explorerDom(snapshot), initialCamera = camera(ui), initialPasses = ui.document.documentElement.dataset.explorerSearchPasses;
  ui.event(nodeElement(ui, "B")); assert.equal(selectionCount(ui), 2); assert.equal(ui.ids.get("selection-cards").children.length, 2); assert.equal(camera(ui), initialCamera);
  ui.event(nodeElement(ui, "A")); assert.equal(selectionCount(ui), 2); assert.equal(camera(ui), initialCamera);
  assert.equal(ui.document.documentElement.dataset.explorerSearchPasses, initialPasses, "Focus must reuse metadata search");
  const cardA = ui.ids.get("selection-cards").children[0]; cardA.open = true; cardA.children.find(item => item.tagName === "details").open = true;
  ui.event(nodeElement(ui, "B")); assert.equal(ui.ids.get("selection-cards").children[0], cardA, "Focus must not replace other cards");
  ui.event("expand"); await ui.settle(); assert.match(ui.ids.get("operation-status").textContent, /1 newly exposed/); assert.equal(camera(ui), initialCamera);
  ui.event("expand"); await ui.settle(); assert.match(ui.ids.get("operation-status").textContent, /1 newly exposed/);
  ui.event("reset"); await ui.settle(); assert(nodeElement(ui, "C")); assert(nodeElement(ui, "D")); const expandedCamera = camera(ui);
  ui.event("collapse"); assert(!nodeElement(ui, "D")); assert.equal(selectionCount(ui), 2);
  ui.event("back"); assert(nodeElement(ui, "D")); assert.equal(camera(ui), expandedCamera);
  ui.event("forward"); assert(!nodeElement(ui, "D"));
  ui.event(nodeElement(ui, "A"), "keydown", { key: " " }); assert.equal(selectionCount(ui), 1);
  ui.ids.get("search").value = "not a match"; ui.event("search", "input"); assert.equal(ui.ids.get("records").children.length, 0); assert.equal(selectionCount(ui), 1); assert(ui.ids.get("selection-cards").textContent.includes("B"));
  ui.ids.get("hide-nonmatches").checked = true; ui.event("hide-nonmatches", "change"); assert.match(ui.ids.get("selection-count").textContent, /1 outside/);
  ui.event("restore-scope"); assert.equal(ui.ids.get("include-history").checked, false); assert.equal(selectionCount(ui), 1);
  assert.equal(JSON.stringify(snapshot), before);
});

test("connection result references survive reading focus; changing selection makes the old scope explicitly stale", async () => {
  const ui = explorerDom(input({ nodes: nodes("A", "B", "C", "D"), edges: [edge("A", "B"), edge("B", "C"), edge("C", "D")] }));
  ui.event(recordButton(ui, "C")); ui.event("connect-selection"); await ui.settle();
  const roots = ui.ids.get("connection-roots").textContent, box = camera(ui);
  ui.event(nodeElement(ui, "A")); assert.equal(ui.ids.get("connection-roots").textContent, roots); assert.doesNotMatch(ui.ids.get("connection-status").textContent, /Previous connection result/); assert.equal(camera(ui), box);
  ui.event(recordButton(ui, "D")); assert.match(ui.ids.get("connection-status").textContent, /Previous connection result/);
});

test("Canvas selection, zoom, pan, rectangle and Escape use CSS/DPR-aware coordinates without leaving overview", async () => {
  const graph = { nodes: nodes("A", "B", "C", "D", "E", "H"), edges: [edge("A", "B")] }; graph.nodes[5].historical = true;
  const snapshot = input(graph), ui = explorerDom(snapshot, { devicePixelRatio: 2 }), api = factory();
  const rect = { left: 45, top: 25, width: 600, height: 300 }; ui.rectangle("overview", rect); ui.event("overview-button");
  const points = api.overview(graph).points;
  function click(id) { const view = api.viewport(camera(ui).split(" ").map(Number), rect), at = points.get(id), client = view.toClient(at.x, at.y); ui.event("overview", "click", { clientX: client.x, clientY: client.y }); }
  click("B"); assert.equal(selectionCount(ui), 2); assert.equal(ui.ids.get("graph").hidden, true); assert.equal(ui.ids.get("overview").width, 1200); assert.equal(ui.ids.get("overview").height, 600);
  ui.event("zoom-in"); ui.flush(); const zoomed = camera(ui); click("B"); assert.equal(camera(ui), zoomed); assert.equal(ui.ids.get("graph").hidden, true);
  ui.event("overview", "pointerdown", { clientX: 47, clientY: 27, pointerId: 1 }); ui.event("overview", "pointermove", { clientX: 67, clientY: 37, pointerId: 1 }); ui.event("overview", "pointerup", { clientX: 67, clientY: 37, pointerId: 1 }); ui.flush(); assert.notEqual(camera(ui), zoomed); click("B"); assert.equal(selectionCount(ui), 2);
  ui.event("overview-button"); ui.event("overview", "pointerdown", { clientX: rect.left, clientY: rect.top, pointerId: 2, shiftKey: true });
  ui.event("overview", "pointermove", { clientX: rect.left + rect.width, clientY: rect.top + rect.height, pointerId: 2, shiftKey: true });
  ui.event("overview", "pointerup", { clientX: rect.left + rect.width, clientY: rect.top + rect.height, pointerId: 2, shiftKey: true }); await ui.settle();
  assert.equal(selectionCount(ui), 5); assert.equal(ui.ids.get("include-history").checked, false); assert.equal(ui.ids.get("graph").hidden, true);
  const box = camera(ui); ui.event("overview", "pointerdown", { clientX: 46, clientY: 26, pointerId: 3 }); ui.event("overview", "pointermove", { clientX: 70, clientY: 50, pointerId: 3 });
  ui.event("overview", "keydown", { key: "Escape" }); ui.flush(); assert.equal(camera(ui), box); assert.equal(selectionCount(ui), 5); assert.equal(ui.ids.get("selection-box").hidden, true);
  assert(ui.stats.transforms.some(item => item.id === "overview" && item.values[0] > 0));
});

test("multiple exact file pairs stay open with their roles, partial/missing state, provenance and file/hunk navigation", () => {
  const a = "a".repeat(64), b = "b".repeat(64), c = "c".repeat(64), d = "d".repeat(64);
  const records = nodes("A", "B", "C"); for (const record of records) { record.kind = "Evidence"; record.origin = { layer: "sessionWork" }; record.workContent = { summary: record.nodeId === "A" ? "긴 한국어 기록 <svg onload='bad()'>\u001b[31m" : `Recorded ${record.nodeId}`, unknowns: ["Outcome not verified"] }; }
  const diff = { kind: "bounded-line-comparison-not-semantic-diff", changed: true, before: { startLine: 10, text: "same\nold1\ncontext\nold2", omittedLines: 3 }, after: { startLine: 20, text: "same\nnew1\ncontext\nnew2", textTruncated: true } };
  const files = [{ path: "src/one.mjs", current: { digest: b }, associations: [{ nodeId: "A", source: { digest: a } }], comparisons: [
    { scope: "recorded-changeset-snapshot-pair", before: { digest: a }, after: { digest: b }, symbols: [], status: "observed", currentMatchesRecordedAfter: false, diff },
    { scope: "cited-revision-versus-observed-current-bytes", before: { digest: c }, after: { digest: d }, symbols: [], status: "observed", diff: { ...diff, before: { startLine: 1, text: "UNRELATED PAIR" }, after: { startLine: 1, text: "UNRELATED AFTER" } } }], unrecordedIntervals: "Other intervals unknown" },
    { path: "src/two.mjs", current: { digest: d }, associations: [{ nodeId: "B", source: { digest: c } }], comparisons: [{ scope: "explicit-work-chain-citation-pair-not-request-boundary", before: { digest: c }, after: { digest: d }, rightRecord: { nodeId: "B" }, symbols: [], status: "observed", diff }], unrecordedIntervals: "No request boundary inferred" },
    { path: "src/missing.mjs", current: { status: "unavailable" }, associations: [{ nodeId: "C" }], comparisons: [], currentObservation: { explanation: "Current path not found; deletion/rename not established." }, unrecordedIntervals: "Unknown" }];
  const snapshot = input({ nodes: records, edges: [], contextLineage: { status: "partial-recorded-context", events: [], files, recordedReasons: [], canonChanges: [] } }), before = JSON.stringify(snapshot);
  const ui = explorerDom(snapshot, { narrow: true }); ui.event(recordButton(ui, "B"));
  const body = ui.ids.get("context-lineage-body").textContent;
  assert(body.includes("src/one.mjs")); assert(body.includes("src/two.mjs")); assert(body.includes("Recorded after — not necessarily current")); assert(body.includes("Cited version B — not necessarily current"));
  assert(body.includes("Partial comparison excerpt")); assert(body.includes("time not retained")); assert(!body.includes("UNRELATED PAIR"));
  const visiblePartial = [];
  const walkVisible = element => { if (element.tagName === "details" && !element.open || element.hidden) return; if (element.className === "comparison-partial") visiblePartial.push(element.textContent); for (const child of element.children) walkVisible(child); };
  walkVisible(ui.ids.get("context-lineage-body"));
  assert(visiblePartial.some(value => value.includes("before") && value.includes("3 omitted lines")));
  assert(visiblePartial.some(value => value.includes("after") && value.includes("text truncated: yes")));
  assert.equal(ui.ids.get("comparison-files").children.length, 2); assert.equal(ui.ids.get("selection-cards").children.length, 2);
  ui.event("file-next"); assert.match(ui.ids.get("comparison-position").textContent, /File 2\/2/); assert(ui.stats.scrolled);
  ui.event("change-next"); assert.match(ui.ids.get("comparison-position").textContent, /changed region 1\/4/);
  ui.event("change-next"); assert.match(ui.ids.get("comparison-position").textContent, /changed region 2\/4/);
  const panel = ui.ids.get("context-lineage-body"); ui.event(recordButton(ui, "A")); assert.equal(ui.ids.get("context-lineage-body"), panel); assert.match(ui.ids.get("comparison-position").textContent, /changed region 2\/4/);
  ui.event(recordButton(ui, "C")); assert(ui.ids.get("context-lineage-body").textContent.includes("deletion/rename not established")); assert(ui.ids.get("context-lineage-body").textContent.includes("not an empty diff"));
  assert.doesNotMatch(ui.ids.get("selection-cards").textContent, /\u001b/); assert(ui.ids.get("selection-cards").textContent.includes("<svg"));
  ui.event("wide-reading"); assert.equal(ui.document.documentElement.dataset.readingWide, "true"); assert.equal(selectionCount(ui), 3);
  assert.equal(JSON.stringify(snapshot), before);
});

test("Project/layer/revision selections and their cameras remain separate even with the same ID or path", () => {
  const snapshot = input({ nodes: nodes("A", "B"), edges: [edge("A", "B")] });
  snapshot.codeGraph = { nodes: [{ nodeId: "A", name: "Code A", kind: "File", path: "same.mjs", revisionId: "code-revision" },
    { nodeId: "Z", name: "Code Z", kind: "File", path: "same.mjs", revisionId: "other-revision" }], edges: [edge("A", "Z", "code-link", "IMPORTS")], status: "current" };
  const before = JSON.stringify(snapshot), ui = explorerDom(snapshot); ui.event(recordButton(ui, "B")); ui.event("zoom-in"); ui.flush();
  const projectBox = camera(ui); ui.ids.get("layer").value = "code"; ui.event("layer", "change");
  assert.equal(selectionCount(ui), 1); assert(ui.ids.get("selection-cards").textContent.includes("Code A"));
  ui.event(recordButton(ui, "Code Z")); assert.equal(selectionCount(ui), 2);
  ui.ids.get("layer").value = "project"; ui.event("layer", "change");
  assert.equal(selectionCount(ui), 2); assert.equal(camera(ui), projectBox); assert(!ui.ids.get("selection-cards").textContent.includes("Code Z"));
  assert.equal(JSON.stringify(snapshot), before);
});

test("large complete inventory remains reachable, selection/cards are paged not capped, and focus reuses its basis", async t => {
  const count = 12000, graph = { nodes: nodes(...Array.from({ length: count }, (_, i) => i === 0 ? "A" : `N${i}`)), edges: Array.from({ length: count - 1 }, (_, i) => edge("A", `N${i + 1}`)) };
  const snapshot = input(graph), before = JSON.stringify(snapshot), started = performance.now(), ui = explorerDom(snapshot), initialMs = ui.initialMs;
  ui.event("overview-button");
  ui.event("overview", "pointerdown", { clientX: 0, clientY: 0, pointerId: 1, shiftKey: true });
  ui.event("overview", "pointermove", { clientX: 1000, clientY: 700, pointerId: 1, shiftKey: true });
  ui.event("overview", "pointerup", { clientX: 1000, clientY: 700, pointerId: 1, shiftKey: true }); await ui.settle();
  assert.equal(selectionCount(ui), count); assert.equal(ui.ids.get("selection-cards").children.length, 100);
  assert.match(ui.ids.get("reading-range").textContent, /1–100 of 12000/); ui.event("cards-next"); assert.match(ui.ids.get("reading-range").textContent, /101–200 of 12000/);
  const searches = ui.document.documentElement.dataset.explorerSearchPasses, box = camera(ui);
  ui.event(recordButton(ui, "A")); assert.equal(camera(ui), box); assert.equal(ui.document.documentElement.dataset.explorerSearchPasses, searches);
  ui.ids.get("search").value = "N11999"; ui.event("search", "input"); assert.equal(ui.ids.get("records").children.length, 1); assert.equal(selectionCount(ui), count);
  assert.equal(JSON.stringify(snapshot), before);
  t.diagnostic(JSON.stringify({ scope: "Same 12000-node synthetic inventory, actual shipped JS with limited DOM/Canvas; not real browser speed", initialMs, completeJourneyMs: performance.now() - started, selections: selectionCount(ui), visibleCards: ui.ids.get("selection-cards").children.length, framesRemaining: ui.pendingFrames() }));
});

test("list keyboard and checkboxes retain list focus; keyboard camera stages return with Back", () => {
  const ui = explorerDom(input({ nodes: nodes("A", "B", "C"), edges: [edge("A", "B")] }));
  ui.event(recordButton(ui, "B"), "keydown", { key: " " });
  assert.equal(selectionCount(ui), 2); assert.equal(ui.stats.focusedElement.getAttribute("data-record-entry"), "B");
  ui.event(recordButton(ui, "C"), "click", { detail: 0 });
  assert.equal(selectionCount(ui), 3); assert.equal(ui.stats.focusedElement.getAttribute("data-record-entry"), "C");
  const toggle = ui.ids.get("records").children.find(row => row.children[0].getAttribute("data-record-entry") === "B").children[1];
  ui.event(toggle, "change"); assert.equal(selectionCount(ui), 2); assert.equal(ui.stats.focusedElement.getAttribute("data-record-toggle"), "B");
  ui.event("overview-button"); const initial = camera(ui);
  ui.event("overview", "keydown", { key: "ArrowRight" }); ui.flush(); assert.notEqual(camera(ui), initial);
  ui.event("back"); assert.equal(camera(ui), initial);
  assert.match(ui.html, /<canvas id="overview"[^>]*tabindex="0"/);
});

test("comparison associations never cross graph layers even when IDs collide, and cached relationship scope refreshes", () => {
  const snapshot = input({ nodes: nodes("A", "B", "C"), edges: [edge("A", "B", "ab", "CALLS"), edge("A", "C", "ac", "IMPORTS")],
    contextLineage: { status: "partial-recorded-context", events: [], files: [{ path: "project-only.mjs", associations: [{ nodeId: "A" }], comparisons: [] }], recordedReasons: [], canonChanges: [] } });
  snapshot.codeGraph = { nodes: [{ nodeId: "A", name: "Code A", kind: "File" }], edges: [], status: "current" };
  const ui = explorerDom(snapshot);
  assert.match(ui.ids.get("context-lineage-body").textContent, /project-only.mjs/);
  const card = ui.ids.get("selection-cards").children[0];
  assert(!card.textContent.includes("outside current relationship scope"));
  ui.ids.get("relation-filter").value = "CALLS"; ui.event("relation-filter", "change");
  assert.equal(ui.ids.get("selection-cards").children[0], card); assert(card.textContent.includes("outside current relationship scope"));
  ui.ids.get("relation-filter").value = "all"; ui.event("relation-filter", "change"); assert(!card.textContent.includes("outside current relationship scope"));
  ui.ids.get("layer").value = "code"; ui.event("layer", "change");
  assert.equal(ui.ids.get("context-lineage").hidden, true); assert(!ui.ids.get("context-lineage-body").textContent.includes("project-only.mjs"));
});

test("plain SVG-node pointerdown/up/click keeps the node click target instead of the capture map", () => {
  const ui = explorerDom(input({ nodes: nodes("A", "B"), edges: [edge("A", "B")] }));
  const node = nodeElement(ui, "B"), box = camera(ui);
  ui.pointerClick(node, { clientX: 500, clientY: 560 });
  assert.equal(selectionCount(ui), 2); assert.equal(camera(ui), box);
  assert(ui.ids.get("selection-cards").textContent.includes("B"));
});

test("expanded cards use actual recorded text and known conditions, with full qualifiers beyond a grapheme-safe excerpt", async () => {
  const summary = "e\u0301".repeat(450) + " This is NOT approval; retain the original exception.";
  const work = { ...nodes("A")[0], revisionId: "work-r1", origin: { layer: "sessionWork", path: "work.json", digest: "a".repeat(64) },
    workContent: { summary, judgments: [{ assessment: "Proposal only", reason: "No user decision", alternatives: ["Keep investigating"] }], pending: ["Review pending"], unknowns: ["Effect unknown"] },
    workContentCoverage: { partial: true }, reviewState: "unreviewed" };
  const direction = { ...nodes("B")[0], kind: "ProjectDirection", revisionId: "direction-r1", directionEvidence: {
    goal: "Ship only after review", constraints: ["No remote effects"], cancelledActions: ["Do not deploy"], decisions: ["Keep this local"] } };
  const graph = { nodes: [work, direction, { ...nodes("C")[0], kind: "Run", purpose: "Investigate failure", status: "failed" }], edges: [edge("A", "B")] };
  const snapshot = input(graph), before = JSON.stringify(snapshot), index = cards.create(snapshot, graph, "project");
  assert.equal(index.describe(work).body, summary); assert.match(index.describe(work).conditions.join(" "), /Pending: 1.*Unknown: 1.*unreviewed.*Historical.*Partial/);
  assert.match(index.describe(direction).conditions.join(" "), /Cancelled actions: 1.*Constraints: 1/);
  assert.equal(index.describe(graph.nodes[2]).body, "Investigate failure");
  assert.equal(index.describe({ kind: "Unknown", nodeId: "empty" }).body, "");
  const ui = explorerDom(snapshot); assert(!visibleText(nodeElement(ui, "A")).includes("Pending"));
  ui.event(nodeElement(ui, "A").querySelectorAll("[data-card-control]")[0]); await ui.settle(); const map = visibleText(nodeElement(ui, "A"));
  assert.match(map, /Excerpt, not a complete summary/); assert(!map.includes("This is NOT approval"));
  assert.match(map, /e\u0301…/); readingCard(ui, "A").open = true; assert(visibleText(readingCard(ui, "A")).includes(summary));
  assert.match(visibleText(readingCard(ui, "A")), /not a captured user utterance.*No user decision.*Keep investigating/s);
  ui.event(recordButton(ui, "B")); readingCard(ui, "B").open = true; assert.match(visibleText(readingCard(ui, "B")), /No remote effects.*Do not deploy.*Keep this local/s);
  assert.equal(JSON.stringify(snapshot), before);
});

test("expanded simultaneous map/reading cards preserve unavailable, historical, current, unknown and unfamiliar currentness", async () => {
  const states = ["unavailable", "historical-source-bytes", "unknown", "future-source-state", "current-source-bytes", "constructor", "__proto__"];
  const graph = { nodes: [{ nodeId: "root", name: "root", kind: "Run", purpose: "Read recorded source states" },
    ...states.map((freshness, i) => ({ nodeId: `S${i}`, kind: "FileRevisionReference", name: `Source ${i}`, path: `src/source-${i}.mjs`, revisionId: `revision-${i}`,
      freshness, reviewState: "observed-evidence", sourceReference: { path: `src/source-${i}.mjs`, digest: String(i).repeat(64) },
      sourceCurrentness: { path: `src/source-${i}.mjs`, retainedDigest: String(i).repeat(64), currentDigest: i ? "f".repeat(64) : null, freshness },
      ...(i === 3 ? { viewerCurrentness: "future-relationship-state" } : {}) }))],
    edges: states.map((_, i) => edge("root", `S${i}`)) };
  const snapshot = input(graph); snapshot.graph.initialNodeId = "root";
  const before = JSON.stringify(snapshot), ui = explorerDom(snapshot), visibleConditions = card => card.children.find(item => item.className === "card-conditions").textContent;
  ui.ids.get("include-history").checked = true; ui.event("include-history", "change");
  for (let i = 0; i < states.length; i++) { ui.event(recordButton(ui, `Source ${i}`)); readingCard(ui, `S${i}`).open = true; }
  ui.event(recordButton(ui, "Source 1"));
  assert.match(ui.ids.get("selected-caption").textContent, /historical-source-bytes/);
  const unavailable = visibleConditions(readingCard(ui, "S0")), historical = visibleConditions(readingCard(ui, "S1"));
  assert.match(unavailable, /unavailable/); assert.match(historical, /historical-source-bytes/); assert.notEqual(unavailable, historical);
  assert.doesNotMatch(unavailable, /deleted|renamed|permission denied|deployment failed/i, "Unavailable bytes do not establish a cause");
  for (let i = 0; i < states.length; i++) {
    const condition = visibleConditions(readingCard(ui, `S${i}`)); assert(condition.includes(states[i]), states[i]);
    ui.event(recordButton(ui, `Source ${i}`)); ui.event("focus");
    ui.event(nodeElement(ui, `S${i}`).querySelectorAll("[data-card-control]")[0]); await ui.settle();
    const map = nodeElement(ui, `S${i}`); assert(map);
    const mapConditions = descendants(map).find(item => item.className === "map-card-conditions"); assert(visibleText(mapConditions).includes(states[i]), `Map ${states[i]}`);
  }
  assert.match(visibleConditions(readingCard(ui, "S3")), /future-relationship-state/);
  const index = cards.create(snapshot, graph, "project"), conflicting = { ...graph.nodes[1], sourceCurrentness: { freshness: "different-recorded-source-state" } };
  assert(index.describe(conflicting).conditions.join(" ").includes("different-recorded-source-state"), "A distinct recorded source state is not silently replaced by top-level freshness");
  assert.equal(JSON.stringify(snapshot), before);
});

test("group membership requires exact verified sources, preserves direct multi-membership and rejects inferred joins", () => {
  const origin = { layer: "product", path: "product-model.json", digest: "a".repeat(64) };
  const product = (id, kind, extra = {}) => ({ nodeId: id, name: id, kind, integrity: "verified", revisionId: "model-1", origin, key: id, ...extra });
  const g1 = product("G1", "FeatureGroup"), g2 = product("G2", "FeatureGroup"), f = product("F", "Feature", { featureGroupKeys: ["G1", "G2"] });
  const child = product("G3", "FeatureGroup", { parentFeatureGroupKeys: ["G1"] });
  const graph = { nodes: [g1, g2, f, child, product("isolated", "Feature"),
    ...[{ revisionId: "other-model" }, { projectId: "another-project" }, { integrity: "unverified" }, { origin: { ...origin, digest: "b".repeat(64) } },
      { origin: { ...origin, layer: "unrelated" } }].map((invalid, i) => product(`invalid-${i}`, "Feature", { featureGroupKeys: ["G1"], ...invalid }))],
    edges: [edge("G2", "isolated", "not-membership", "CONTAINS")] };
  const snapshot = input(graph), before = JSON.stringify(snapshot), index = cards.create(snapshot, graph, "project");
  assert.equal(index.groups.size, 2); assert.equal(index.memberships.get("F").size, 2);
  assert.deepEqual(sorted([...index.groups.values()].find(group => group.rootId === "G1").members), ["F", "G1", "G3"]);
  for (const id of ["isolated", ...graph.nodes.filter(node => node.nodeId.startsWith("invalid-")).map(node => node.nodeId)]) assert(!index.memberships.has(id), id);
  assert.equal(index.anchor("F", new Map()), null); assert.equal(index.anchor("F", new Map([["G2", { x: 0, y: 0 }]])), "G2");
  const world = (id, kind, extra = {}) => ({ nodeId: id, kind, integrity: "verified", sourceSnapshotId: "source-1", origin: { layer: "world", worldModelId: "world-1", graphSnapshotId: "graph-1" }, ...extra });
  const wg = { nodes: [world("WG", "FeatureGroup"), world("WF", "Feature"), world("wrong-source", "Feature", { sourceSnapshotId: "source-2" })],
    edges: [edge("WG", "WF", "valid", "CONTAINS"), edge("WG", "wrong-source", "bad", "CONTAINS")].map(item => ({ ...item, sourceSnapshotId: "source-1", provenance: { worldModelId: "world-1", graphSnapshotId: "graph-1" } })) };
  const worldIndex = cards.create(input(wg), wg, "project"); assert.equal(worldIndex.groups.size, 1); assert(!worldIndex.memberships.has("wrong-source"));
  for (const patch of [{ sourceSnapshotId: "source-2" }, { provenance: { worldModelId: "world-2", graphSnapshotId: "graph-1" } }]) {
    const invalid = { ...wg, edges: [{ ...wg.edges[0], ...patch }] }; assert.equal(cards.create(input(invalid), invalid, "project").groups.size, 0);
  }
  const work = (id, sessionId = "session-1") => ({ nodeId: id, name: id, integrity: "verified", sessionId, origin: { layer: "sessionWork", path: `${id}.json`, digest: id.repeat(64) } });
  const a = work("a"), b = work("b"), c = work("c", "other-session");
  const workEdge = { ...edge("b", "a", "work", "DECLARES_WORK_ROOT"), provenance: { ...b.origin } };
  const workGraph = { nodes: [a, b, c], edges: [workEdge, { ...workEdge, from: "c" }] };
  assert.equal(cards.create(input(workGraph), workGraph, "project").groups.size, 1);
  for (const patch of [{ type: "FOLLOWS_WORK_EVIDENCE" }, { type: "RECORDED_FOR_SESSION" }, { provenance: { ...b.origin, digest: "wrong" } }]) {
    const invalid = { ...workGraph, edges: [{ ...workEdge, ...patch }] }; assert.equal(cards.create(input(invalid), invalid, "project").groups.size, 0);
  }
  const group = [...index.groups.values()].find(group => group.rootId === "G1");
  const points = new Map([["G1", { left: 0, right: 100, top: 0, bottom: 100 }], ["G3", { left: 200, right: 300, top: 0, bottom: 100 }]]);
  assert.equal(cards.groupGeometry(new Map([[group.key, group]]), index.memberships, points)[0].enclosure, true);
  points.set("isolated", { left: 130, right: 160, top: 20, bottom: 40 });
  assert.equal(cards.groupGeometry(new Map([[group.key, group]]), index.memberships, points)[0].enclosure, false);
  points.delete("isolated"); points.set("F", { left: 400, right: 500, top: 0, bottom: 100 });
  assert(cards.groupGeometry(index.groups, index.memberships, points).every(group => !group.enclosure));
  assert.equal(JSON.stringify(snapshot), before);
  const id = index.identity(f);
  for (const [s, g, layer, value] of [[{ project: { projectId: "different" } }, graph, "project", f], [snapshot, graph, "code", f],
    [snapshot, graph, "project", { ...f, revisionId: "model-2" }], [snapshot, graph, "project", { ...f, origin: { ...origin, digest: "changed" } }]])
    assert.notEqual(cards.create(s, g, layer).identity(value), id);
  assert.equal(index.identity({ nodeId: "unqualified" }), null);
});

test("reading cards retain A/B expansion, scroll and pages through C changes, filtering, history and layer collisions", async () => {
  const graph = { nodes: nodes("A", "B", "C", ...Array.from({ length: 104 }, (_, i) => `N${i}`)).map(node => ({ ...node, revisionId: "revision-1", sourceReference: { path: `${node.nodeId}.json`, digest: "a".repeat(64) } })),
    edges: ["B", "C", ...Array.from({ length: 104 }, (_, i) => `N${i}`)].map(id => edge("A", id)) };
  const snapshot = input(graph); snapshot.originals = Object.fromEntries(["A", "B"].map(id => [JSON.stringify([`${id}.json`, "a".repeat(64)]), { status: "verified-exact-bytes", text: `${id} long original\n`.repeat(30) }]));
  snapshot.codeGraph = { nodes: [{ ...graph.nodes[0], name: "Code A", revisionId: "different-revision" }], edges: [], status: "current" };
  const before = JSON.stringify(snapshot), ui = explorerDom(snapshot); ui.event(recordButton(ui, "B"));
  const remember = id => { const card = readingCard(ui, id); card.open = true; const details = card.children.filter(item => item.tagName === "details"); for (const detail of details) detail.open = true;
    const pre = descendants(card).find(item => item.tagName === "pre"); pre.scrollTop = 77; pre.scrollLeft = 9; card.scrollTop = 31; return { card, pre }; };
  const a = remember("A"), b = remember("B"), mapA = nodeElement(ui, "A"), transform = mapA.getAttribute("transform"), box = camera(ui);
  ui.event(mapA, "keydown", { shiftKey: true, key: "ArrowRight" }); const pinned = mapA.getAttribute("transform");
  ui.event(recordButton(ui, "C")); assert.equal(readingCard(ui, "A"), a.card); assert.equal(readingCard(ui, "B"), b.card);
  const removeC = descendants(readingCard(ui, "C")).find(item => item.tagName === "button" && item.textContent === "Remove"); ui.event(removeC);
  assert.equal(readingCard(ui, "A"), a.card); assert.equal(a.pre.scrollTop, 77); assert.equal(camera(ui), box); assert.notEqual(transform, pinned);
  ui.event("overview-button"); ui.event("overview", "pointerdown", { clientX: 0, clientY: 0, pointerId: 1, shiftKey: true });
  ui.event("overview", "pointermove", { clientX: 1000, clientY: 700, pointerId: 1, shiftKey: true }); ui.event("overview", "pointerup", { clientX: 1000, clientY: 700, pointerId: 1, shiftKey: true }); await ui.settle();
  a.pre.focus(); ui.event("cards-next"); assert.equal(ui.stats.focusedElement.id, "reading-range");
  assert(!ui.ids.get("selection-cards").contains(a.pre)); ui.event("cards-prev");
  const restoredA = readingCard(ui, "A"), restoredB = readingCard(ui, "B");
  for (const card of [restoredA, restoredB]) { assert(card.open); assert(card.children.filter(item => item.tagName === "details").every(item => item.open)); const pre = descendants(card).find(item => item.tagName === "pre"); assert.equal(pre.scrollTop, 77); assert.equal(pre.scrollLeft, 9); assert.equal(card.scrollTop, 31); }
  ui.ids.get("search").value = "N103"; ui.event("search", "input"); ui.event("back"); ui.event("forward");
  assert.equal(readingCard(ui, "A"), restoredA); assert.equal(readingCard(ui, "B"), restoredB);
  ui.ids.get("layer").value = "code"; ui.event("layer", "change"); assert(!readingCard(ui, "A").children.filter(item => item.tagName === "details").some(item => item.open));
  ui.ids.get("layer").value = "project"; ui.event("layer", "change");
  assert.equal(descendants(readingCard(ui, "A")).find(item => item.tagName === "pre").scrollTop, 77);
  ui.event(descendants(readingCard(ui, "A")).find(item => item.tagName === "button" && item.textContent === "Read focus"));
  ui.event("focus"); assert.equal(nodeElement(ui, "A")?.getAttribute("transform"), pinned); assert.equal(JSON.stringify(snapshot), before);
});

test("rectangle geometry uses positive-area corners and keeps directed, parallel, reversed and self endpoints outside cards", () => {
  const e = { left: 140, right: 140, top: 100, bottom: 100 }, a = { x: 0, y: 0 }, b = { x: 400, y: 200 }, bounds = cards.bounds(a, e);
  assert(cards.intersects(bounds, { left: 139, right: 145, top: 99, bottom: 110 }));
  assert(!cards.intersects(bounds, { left: 140, right: 145, top: 100, bottom: 110 }));
  assert(!cards.intersects(bounds, { left: 0, right: 0, top: 0, bottom: 100 }));
  for (const [start, end, offset] of [[a, b, 0], [a, b, 48], [b, a, -48], [a, a, 0], [a, a, -180]]) {
    const geometry = cards.edgeGeometry(start, end, e, e, offset); assert(!/NaN|Infinity/.test(geometry.path)); assert(geometry.bounds.bottom > geometry.bounds.top);
    const numbers = geometry.path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi).map(Number);
    for (const [point, center] of [[numbers.slice(0, 2), start], [numbers.slice(-2), end]]) {
      const r = cards.bounds(center, e); assert(point[0] < r.left || point[0] > r.right || point[1] < r.top || point[1] > r.bottom);
    }
    for (let i = 0; i < numbers.length; i += 2) { assert(numbers[i] >= geometry.bounds.left && numbers[i] <= geometry.bounds.right); assert(numbers[i + 1] >= geometry.bounds.top && numbers[i + 1] <= geometry.bounds.bottom); }
  }
  const largeTarget = { ...e, top: 400, right: 200 }, coincident = cards.edgeGeometry(a, a, e, largeTarget).path.match(/-?\d+(?:\.\d+)?/g).map(Number);
  assert(coincident.at(-1) < -largeTarget.top, "Coincident unequal pinned cards must use the target extent for the arrow end");
});

test("declared work groups keep one map card per node and restore member pagination without detaching focused controls", async () => {
  const work = id => ({ nodeId: id, name: id, kind: "SessionWorkEvidence", integrity: "verified", sessionId: "s1", revisionId: `revision-${id}`,
    origin: { layer: "sessionWork", path: `${id}.json`, digest: "a".repeat(64) }, workContent: { summary: `Recorded ${id}` } });
  const groupNodes = [work("A"), ...Array.from({ length: 25 }, (_, i) => work(`Member${i}`)), work("C")];
  const graph = { nodes: groupNodes, edges: groupNodes.slice(1, -1).map(node => ({ ...edge(node.nodeId, "A", node.nodeId, "DECLARES_WORK_ROOT"), provenance: { ...node.origin } })) };
  const snapshot = input(graph), before = JSON.stringify(snapshot), ui = explorerDom(snapshot), card = readingCard(ui, "A");
  card.open = true; const membership = card.children.find(item => item.className === "record-membership"); assert(membership); membership.open = true; ui.event(membership, "toggle");
  const nav = membership.children.find(item => item.tagName === "nav"), next = nav.children[2]; next.focus(); ui.event(next);
  assert.equal(ui.stats.focusedElement, next); assert(membership.contains(next)); assert.match(nav.textContent, /21–26 \/ 26/);
  ui.event(recordButton(ui, "C")); assert.equal(readingCard(ui, "A"), card); assert(membership.open);
  const remove = descendants(card).find(item => item.tagName === "button" && item.textContent === "Remove"); ui.event(remove);
  ui.event(recordButton(ui, "A")); const restored = readingCard(ui, "A"), group = restored.children.find(item => item.className === "record-membership");
  assert(group.open); assert.match(group.textContent, /21–26 \/ 26/);
  const mapped = ui.ids.get("graph").children.filter(item => item.getAttribute("data-node")), mappedIds = mapped.map(item => item.getAttribute("data-node"));
  assert.equal(new Set(mappedIds).size, mappedIds.length);
  ui.event(nodeElement(ui, "A").querySelectorAll("[data-card-control]")[0]); await ui.settle();
  assert(ui.ids.get("graph").textContent.includes("exported"));
  assert.match(restored.textContent, /Declared work group/); assert.equal(JSON.stringify(snapshot), before);
});

test("header drag and corner rectangle selection do not swallow body text selection or native accessibility zoom", async () => {
  for (const dpr of [1, 2]) {
    const ui = explorerDom(input({ nodes: nodes("A", "B"), edges: [edge("A", "B")] }), { devicePixelRatio: dpr });
    ui.event(nodeElement(ui, "A").querySelectorAll("[data-card-control]")[0]); await ui.settle();
    const a = nodeElement(ui, "A"), body = a.querySelectorAll("[data-card-body]")[0], before = a.getAttribute("transform"), box = camera(ui);
    ui.pointerClick(body, { clientX: 500, clientY: 350 }); assert.equal(selectionCount(ui), 1); assert.equal(camera(ui), box);
    ui.event("graph", "pointerdown", { target: body, clientX: 500, clientY: 350, pointerId: 1 }); ui.event("graph", "pointermove", { clientX: 550, clientY: 380, pointerId: 1 }); ui.event("graph", "pointerup", { clientX: 550, clientY: 380, pointerId: 1 });
    assert.equal(a.getAttribute("transform"), before); assert.equal(camera(ui), box);
    let prevented = false; ui.event("graph", "wheel", { ctrlKey: true, deltaY: 1, preventDefault() { prevented = true; } }); assert(!prevented); assert.equal(camera(ui), box);
    const header = a.querySelectorAll("[data-card-header]")[0]; ui.event("graph", "pointerdown", { target: header, clientX: 500, clientY: 350, pointerId: 2 });
    ui.event("graph", "pointermove", { clientX: 550, clientY: 380, pointerId: 2 }); ui.flush(); assert.notEqual(a.getAttribute("transform"), before);
    ui.event("graph", "keydown", { key: "Escape" }); ui.flush(); assert.equal(nodeElement(ui, "A").getAttribute("transform"), before); assert.equal(nodeElement(ui, "A").dataset.pinned, "false");
    ui.event("clear-selection");
    const r = nodeElement(ui, "A").children[0], at = /translate\(([^,]+),([^\)]+)\)/.exec(nodeElement(ui, "A").getAttribute("transform")), cameraBox = camera(ui).split(" ").map(Number);
    ui.rectangle("graph", { left: 23, top: 17, width: 800, height: 400 }); const view = factory().viewport(cameraBox, ui.ids.get("graph").getBoundingClientRect());
    const corner = view.toClient(Number(at[1]) + Number(r.getAttribute("x")) + 1, Number(at[2]) + Number(r.getAttribute("y")) + 1);
    ui.event("graph", "pointerdown", { clientX: corner.x, clientY: corner.y, pointerId: 3, shiftKey: true });
    ui.event("graph", "pointermove", { clientX: corner.x + 8, clientY: corner.y + 8, pointerId: 3 }); ui.event("graph", "pointerup", { clientX: corner.x + 8, clientY: corner.y + 8, pointerId: 3 }); await ui.settle();
    assert.equal(selectionCount(ui), 1, "A corner intersection, not center containment, selects the card");
  }
});

test("title-only map and reading disclosures are independent, measured, cancellable and preserve other nodes, pins and keyboard defaults", async () => {
  const graph = { nodes: nodes("A", "B", "C").map(node => ({ ...node, revisionId: `r-${node.nodeId}`, summary: `RECORDED BODY ${node.nodeId}`,
    reviewState: "unreviewed", freshness: "unavailable", sourceReference: { path: `src/${node.nodeId}.mjs`, digest: "a".repeat(64) } })), edges: [edge("A", "B")] };
  for (const node of graph.nodes) node.freshness = "snapshot-evidence"; graph.edges.push(edge("A", "C"));
  const snapshot = input(graph), original = Array.from({ length: 60 }, (_, i) => `// synthetic recorded line ${i}`).join("\n"), digest = crypto.createHash("sha256").update(original).digest("hex");
  graph.nodes[0].sourceReference.digest = digest;
  snapshot.originals[JSON.stringify(["src/A.mjs", digest])] = { status: "verified-exact-bytes", digest, text: original };
  const before = JSON.stringify(snapshot), ui = explorerDom(snapshot, { cardMeasure: (element, size) => (element.children[1].hidden ? 56 : 250) * size / 14 });
  await ui.settle(); const nodeA = () => nodeElement(ui, "A"), nodeB = () => nodeElement(ui, "B"), control = id => nodeElement(ui, id).querySelectorAll("[data-card-control]")[0];
  assert.equal(visibleText(nodeA()), "A+"); assert(!visibleText(nodeA()).includes("unreviewed")); assert.equal(visibleText(readingCard(ui, "A")), "A"); assert.equal(readingCard(ui, "A").open, false);
  const cameraBefore = camera(ui), closedHeight = Number(nodeA().children[0].getAttribute("height")), untouchedC = nodeElement(ui, "C").getAttribute("transform");
  ui.event(nodeB(), "keydown", { shiftKey: true, key: "ArrowRight" }); const pinnedB = nodeB().getAttribute("transform");
  const aControl = control("A"); aControl.focus(); ui.pointerClick(aControl); await ui.settle();
  assert.equal(selectionCount(ui), 1, "Disclosure must not implicitly select a record"); assert.equal(control("A").getAttribute("aria-expanded"), "true");
  assert(visibleText(nodeA()).includes("RECORDED BODY A")); assert(visibleText(nodeA()).includes("unreviewed")); assert(visibleText(nodeA()).includes("src/A.mjs"));
  assert(Number(nodeA().children[0].getAttribute("height")) > closedHeight); assert.equal(nodeB().getAttribute("transform"), pinnedB); assert.equal(camera(ui), cameraBefore);
  assert.equal(readingCard(ui, "A").open, false, "Map disclosure does not force independent reading open");
  const scrollingBody = nodeA().querySelectorAll("[data-card-body]")[0]; scrollingBody.scrollTop = 41; ui.event(scrollingBody, "scroll");
  ui.event(control("A")); await ui.settle(); ui.event(control("A")); await ui.settle();
  assert.equal(nodeA().querySelectorAll("[data-card-body]")[0].scrollTop, 41, "Map body scroll survives an explicit fold/open");
  let prevented = false; ui.event(nodeA(), "keydown", { target: control("A"), key: "Enter", preventDefault() { prevented = true; } }); assert(!prevented);
  ui.event(nodeA(), "keydown", { target: control("A"), key: " ", preventDefault() { prevented = true; } }); assert(!prevented);
  const content = nodeA().querySelectorAll("[data-card-body]")[0];
  ui.event("graph", "wheel", { target: content, deltaY: 1, preventDefault() { prevented = true; } }); assert(!prevented); assert.equal(camera(ui), cameraBefore);
  const openRead = descendants(nodeA()).find(item => item.tagName === "button" && item.textContent === "Read full record"); ui.event(openRead);
  assert(readingCard(ui, "A").open); assert(visibleText(readingCard(ui, "A")).includes("RECORDED BODY A"));
  const record = readingCard(ui, "A"); for (const element of descendants(record)) if (element.tagName === "details") element.open = true;
  const inner = descendants(record).find(element => element.tagName === "pre"); inner.scrollTop = 37;
  ui.event(record.children[0]); record.open = false; ui.event(record, "toggle"); inner.scrollTop = 0;
  record.open = true; ui.event(record, "toggle"); assert.equal(inner.scrollTop, 37, "Explicit reading collapse does not lose its internal scroll position");
  ui.event(recordButton(ui, "B")); assert.equal(readingCard(ui, "B").open, false); assert(readingCard(ui, "A").open);
  ui.event(control("A")); ui.event("cancel-work"); await ui.settle(); assert.equal(control("A").getAttribute("aria-expanded"), "true");
  ui.event(control("A")); ui.event(control("B")); await ui.settle();
  assert.equal(control("A").getAttribute("aria-expanded"), "false"); assert.equal(control("B").getAttribute("aria-expanded"), "true");
  assert.equal(nodeB().getAttribute("transform"), pinnedB); assert.equal(nodeElement(ui, "C").getAttribute("transform"), untouchedC); assert.equal(camera(ui), cameraBefore); assert(readingCard(ui, "A").open);
  ui.ids.get("search").value = "not-a-match"; ui.event("search", "input"); ui.event("back"); ui.event("forward");
  assert.equal(control("B").getAttribute("aria-expanded"), "true"); assert(readingCard(ui, "A").open); assert.equal(JSON.stringify(snapshot), before);
});
