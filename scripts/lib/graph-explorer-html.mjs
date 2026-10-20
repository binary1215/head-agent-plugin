import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function renderGraphExplorer(snapshot) {
  const nonce = crypto.randomBytes(24).toString("base64");
  const assets = path.resolve(import.meta.dirname, "../graph-explorer");
  const css = fs.readFileSync(path.join(assets, "style.css"), "utf8");
  const script = fs.readFileSync(path.join(assets, "exploration.js"), "utf8") + "\n" + fs.readFileSync(path.join(assets, "browser.js"), "utf8");
  const json = JSON.stringify(snapshot).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'none'; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'">
<title>Lode Graph Explorer</title><style nonce="${nonce}">${css}</style></head><body>
<header><div><span class="eyebrow">LODE / LOCAL EVIDENCE</span><h1>Graph Explorer</h1><p id="project"></p></div><div class="snapshot"><strong>Read-only snapshot</strong><span id="generated"></span><span id="coverage"></span></div></header>
<main><aside aria-label="Graph controls"><label for="search">Search this snapshot</label><input id="search" type="search" placeholder="Purpose, source, decision…">
<label for="layer">Evidence layer</label><select id="layer"><option value="project">Project purpose &amp; lineage</option><option value="code">Source imports &amp; calls</option></select>
<p id="layer-info" class="hint"></p>
<label for="axis">Show</label><select id="axis"><option value="all">All connections</option><option value="code">Code &amp; sources</option><option value="context">Purpose &amp; work</option></select>
<label for="view">Original graph view</label><select id="view"><option value="all">Both views</option><option value="product">Product</option><option value="work">Work</option></select>
<p class="hint">Choose a starting record, then follow its connections.</p><h2>Find a starting point</h2><p id="count" class="hint"></p><ul id="records" aria-label="Included graph records"></ul></aside>
<section class="canvas-section" aria-label="Graph map"><div class="toolbar"><div class="legend"><span id="legend-left" class="code-dot">Code &amp; sources</span><span id="legend-right" class="context-dot">Purpose &amp; work</span></div><div><button id="back" aria-label="Previous explored record">←</button><button id="forward" aria-label="Next explored record">→</button><button id="zoom-out" aria-label="Zoom out">−</button><button id="zoom-in" aria-label="Zoom in">+</button><button id="reset">Fit map</button><button id="restart">Start here</button></div></div>
<nav id="trail" aria-label="Exploration path"></nav>
<svg id="graph" viewBox="0 0 1000 700" role="group" tabindex="0" aria-label="Evidence connections. Select records with Enter; pan the canvas with arrow keys."></svg>
<div id="status" role="status" aria-live="polite"></div><p class="hint canvas-note">Code spreads horizontally ↔ · Purpose, product &amp; operations vertically ↕. Select to unfold; drag to pin; Shift + arrows also moves a node. Axes and distance are display guides, not authority or similarity.</p></section>
<section class="detail" aria-label="Selected evidence"><h2 id="selected-title" tabindex="-1">Follow a connection</h2><p id="selected-caption" class="hint">Select a record or relationship to see its exact reference.</p><div id="selected-summary"></div><button id="expand" disabled>Follow included connections</button><p id="expansion" class="hint"></p>
<details><summary>Exact original</summary><p id="original-state" class="hint"></p><pre id="original">Select a record to inspect retained text.</pre><details id="raw-original-details" hidden><summary>Raw original / unknown fields</summary><pre id="raw-original"></pre></details></details>
<details><summary>Record identity &amp; evidence</summary><pre id="evidence">No record selected.</pre></details>
<details id="context-lineage" hidden><summary>Recorded code context</summary><div id="context-lineage-body"></div></details>
<details><summary>Snapshot basis &amp; omissions (diagnostics)</summary><pre id="basis"></pre></details><details id="history"><summary>Retained graph structure (diagnostics)</summary><div id="history-body"></div></details></section></main>
<footer>This file has no runtime fetch, server or action controls. Selecting a historical Session changes this display only. New work and recovery remain in your normal Lode conversation.</footer>
<script nonce="${nonce}" id="snapshot" type="application/json">${json}</script><script nonce="${nonce}">${script}</script></body></html>\n`;
}
