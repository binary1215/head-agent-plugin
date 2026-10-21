import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { explorerDom } from "./helpers/graph-explorer-dom-fixture.mjs";

test("narrow selection controls collapse without losing selection and camera captions stay inside their viewport", () => {
  const snapshot = fixture(6000), before = JSON.stringify(snapshot), ui = explorerDom(snapshot, { narrow: true });
  assert.equal(ui.ids.get("selection-tools").open, false); assert.equal(ui.ids.get("display-options").open, false);
  const selected = ui.ids.get("selection-count").textContent;
  ui.ids.get("selection-tools").open = true;
  assert.equal(ui.ids.get("selection-count").textContent, selected);
  assert.equal(explorerDom(snapshot).ids.get("selection-tools").open, true);
  assert.equal(JSON.stringify(snapshot), before);
  const source = fs.readFileSync(new URL("../scripts/graph-explorer/browser.js", import.meta.url), "utf8");
  const start = source.indexOf("  function captionPlacement("), end = source.indexOf("\n  }\n", start) + 5;
  assert(start >= 0 && end > start);
  const place = vm.runInNewContext("(" + source.slice(start, end).trim() + ")");
  for (const [point, extent, viewport] of [[{ x: 990, y: 690 }, { left: 100, right: 100 }, [0, 0, 1000, 700]],
    [{ x: 388, y: 315 }, { left: 150, right: 150 }, [0, 0, 390, 320]]]) {
    const original = structuredClone(point), result = place(point, extent, viewport);
    assert(point.x + result.x - extent.left >= viewport[0]);
    assert(point.x + result.x + extent.right <= viewport[0] + viewport[2]);
    assert(point.y + result.y >= viewport[1]); assert(point.y + result.y + 17 <= viewport[1] + viewport[3]);
    assert.deepEqual(point, original, "Caption adjustment must not move a layout/pin coordinate");
  }
});

test("missing current source displays exact retained text without manufacturing an empty after-version", () => {
  const snapshot = fixture(6000), digest = "a".repeat(64);
  snapshot.graph.contextLineage = { events: [], recordedReasons: [], canonChanges: [], files: [{ path: "src/generic-0.mjs",
    currentObservation: { reasonCode: "ENOENT", explanation: "Current path not found; deletion and rename remain unproven." }, associations: [],
    renameEvidence: { candidates: [{ path: "src/moved.mjs", digest }] }, comparisons: [{ status: "unknown", after: null,
      citedReference: { path: "src/generic-0.mjs", digest }, retainedOriginal: { path: "src/generic-0.mjs", digest,
        text: "retained <script>not executable</script>", omittedLines: 12, textTruncated: false } }], unrecordedIntervals: "Unknown" }] };
  const before = JSON.stringify(snapshot), ui = explorerDom(snapshot), body = ui.ids.get("context-lineage-body").textContent;
  assert(body.includes("retained <script>not executable</script>")); assert(body.includes("not an after-version"));
  assert(body.includes("Partial historical excerpt")); assert(body.includes("not confirmed continuity"));
  assert(!body.includes("No byte differences")); assert.equal(ui.ids.get("show-code-diff").hidden, true);
  assert.equal(JSON.stringify(snapshot), before);
});

function fixture(count = 60000) {
  const nodes = Array.from({ length: count }, (_, i) => ({ nodeId: `generic-${i}`, kind: "File", path: `src/generic-${i}.mjs`, name: `Generic ${i}`,
    views: ["work"], freshness: i >= count - 5000 ? "domain-not-current" : "snapshot-evidence", currentTraversalEligible: i < count - 5000,
    detailCoverage: i ? "metadata-only" : "selected-detail", sourceReference: { path: `src/generic-${i}.mjs`, digest: "a".repeat(64) } }));
  const edges = nodes.slice(1).map((node, i) => ({ edgeId: `edge-${i}`, from: nodes[i].nodeId, to: node.nodeId, type: "NEXT" }));
  for (let i = 1; i <= Math.min(10000, count - 1); i++) edges.push({ edgeId: `star-${i}`, from: "generic-0", to: `generic-${i}`, type: "LINK" });
  return { kind: "GraphExplorerSnapshot", project: { projectId: "synthetic" }, generatedAt: "2026-10-21T00:00:00.000Z",
    graph: { nodes, edges, initialNodeId: "generic-0", coverage: { state: "verified-available-layers" }, contextLineage: null },
    codeGraph: { nodes: [], edges: [], status: "unavailable" }, originals: {}, history: { status: "not-requested", entries: [] } };
}

test("actual bundled UI script reaches all 60000 IDs through complete search/overview, with bounded DOM and explicit historical scope", t => {
  const snapshot = fixture(), before = JSON.stringify(snapshot), ui = explorerDom(snapshot);
  assert.equal(ui.document.documentElement.dataset.explorerReady, "true");
  assert(ui.ids.get("selected-title").textContent.includes("Generic 0"));
  assert(ui.ids.get("records").children.length <= 100); assert(ui.ids.get("relations").children.length <= 100);
  assert(ui.stats.svg < 1000, "Initial 10000-neighbor selection must not create an all-inventory SVG DOM");
  assert(ui.ids.get("status").textContent.includes("off-screen"));
  ui.event("records-next"); assert(ui.ids.get("records").children[0].textContent.includes("Generic 100"));
  ui.ids.get("search").value = "generic-59999"; ui.event("search", "input");
  assert.equal(ui.ids.get("records").children.length, 0);
  ui.ids.get("include-history").checked = true; ui.event("include-history", "change");
  assert(ui.ids.get("records").children.length > 0);
  ui.event(ui.ids.get("records").children[0].children[0]);
  assert(ui.ids.get("selected-title").textContent.includes("59999")); assert(ui.ids.get("detail-scope").textContent.includes("does not mean no change"));
  ui.ids.get("search").value = ""; ui.event("search", "input");
  const fills = ui.stats.fills; ui.event("overview-button");
  assert.equal(ui.stats.fills - fills, 60000); assert(ui.ids.get("status").textContent.includes("60000 filtered records"));
  assert.equal(ui.ids.get("graph").hidden, true); assert.equal(ui.ids.get("overview").hidden, false);
  ui.event("focus"); assert.equal(ui.ids.get("graph").hidden, false);
  const svg = ui.stats.svg; ui.event("graph", "wheel", { deltaY: 1 }); ui.event("graph", "wheel", { deltaY: 1 });
  assert.equal(ui.pendingFrames(), 1); ui.flush(); assert(ui.stats.svg > svg);
  assert.equal(JSON.stringify(snapshot), before);
  t.diagnostic(JSON.stringify({ scope: "Node VM + limited DOM/Canvas double; not actual browser or GUI", initialMs: ui.initialMs, svgCreated: ui.stats.svg }));
});

test("a retained non-current relationship is labelled before selection and opt-in preserves its exact endpoint", () => {
  const snapshot = fixture(6000);
  snapshot.graph.edges[3].currentTraversalEligible = false;
  snapshot.graph.edges[3].viewerCurrentness = "domain-not-current";
  snapshot.graph.edges[3].from = "generic-0";
  const ui = explorerDom(snapshot), rows = ui.ids.get("relations").children;
  const row = rows.find(item => item.textContent.includes("Generic 4") && item.textContent.includes("NEXT"));
  assert(row); assert(row.textContent.includes("Historical / non-current"));
  ui.event(row.children[0]); assert.equal(ui.ids.get("include-history").checked, true);
  assert(ui.ids.get("selected-title").textContent.includes("Generic 4"));
});

test("exact bounded excerpt UI shows additions/removals, line roles and missing detail honestly", () => {
  const snapshot = fixture(6000);
  snapshot.graph.contextLineage = { events: [], recordedReasons: [], canonChanges: [], files: [{ path: "src/generic-0.mjs", current: { digest: "a".repeat(64) }, associations: [{ nodeId: "generic-0" }],
    comparisons: [{ status: "verified", scope: "recorded-changeset-snapshot-pair", before: { digest: "a".repeat(64) }, after: { digest: "b".repeat(64) }, currentMatchesRecordedAfter: false, symbols: [], diff: { changed: true,
      before: { startLine: 10, text: "same\nold", omittedLines: 20 }, after: { startLine: 20, text: "same\nnew", textTruncated: true } } }], unrecordedIntervals: "Unknown unsaved work" }] };
  const ui = explorerDom(snapshot), body = ui.ids.get("context-lineage-body").textContent;
  assert(body.includes("− 11/· old")); assert(body.includes("+ ·/21 new"));
  assert(body.includes("Recorded after — not necessarily current")); assert(body.includes("Partial comparison excerpt"));
  assert.equal(ui.ids.get("show-code-diff").hidden, false);
  ui.event("show-code-diff"); assert.equal(ui.ids.get("context-lineage").open, true);
});
