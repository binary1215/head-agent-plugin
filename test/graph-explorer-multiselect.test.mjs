import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { explorerDom } from "./helpers/graph-explorer-dom-fixture.mjs";

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
  const cardA = ui.ids.get("selection-cards").children[0]; cardA.children.find(item => item.tagName === "details").open = true;
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
