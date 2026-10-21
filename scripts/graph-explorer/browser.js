(() => {
  "use strict";
  const initialTime = performance.now();
  let data;
  try {
    data = explorerCodec.decode(JSON.parse(document.getElementById("snapshot").textContent));
    if (data?.kind !== "GraphExplorerSnapshot" || !Array.isArray(data.graph?.nodes) || !Array.isArray(data.graph?.edges)) throw new Error("Invalid snapshot");
  }
  catch { document.getElementById("status").textContent = "Snapshot data could not be decoded. Original records were not changed; regenerate this optional report."; return; }
  const $ = id => document.getElementById(id), ns = "http://www.w3.org/2000/svg";
  const hide = (element, value) => { element.hidden = value; if (value) element.setAttribute("hidden", ""); else element.removeAttribute("hidden"); };
  let activeGraph = data.graph, selected = null;
  let box = [0, 0, 1000, 700], drag = null, suppressClick = false;
  const layerStates = new Map();
  let contextSelection = null;
  let mapMode = "focus", listPage = 0, relationPage = 0, relationSelection = null, foundIds = new Set(), visibleMatches = [], cameraFrame = null;
  const overviewStates = new WeakMap(), PAGE_SIZE = 100;
  let chosenEdges = new Set(), edgeVersion = 0, cardPage = 0, viewHistory = [], viewCursor = -1;
  let scopeCache = null, cardsCache = null, comparisonsCache = null, connectionResult = null, connectionKey = null;
  let jobSerial = 0, busy = false, jobKind = null, drawnNodeIds = new Set(), comparisonFiles = [], changeHunks = [], fileCursor = 0, changeCursor = -1, rootPage = 0;
  const historyCounts = new WeakMap(), edgeKeys = new WeakMap();
  const filterIds = ["search", "hide-nonmatches", "axis", "view", "include-history", "relation-filter", "kind-filter"];
  const yieldWork = () => new Promise(resolve => requestAnimationFrame(resolve));
  const label = node => displayText(node?.name || node?.title || node?.qualifiedName || node?.objective || node?.purpose || node?.directionEvidence?.goal || node?.workContent?.summary || node?.summary || node?.proposedPolicy?.name || node?.planDelta || node?.outcome || node?.path || node?.statement || node?.assessment || node?.rationale || (node?.kind === "ChangeSet" ? "Recorded source revision changes" : `${node?.kind || "Unnamed record"} · ${String(node?.nodeId || "unknown").slice(-12)}`));
  const isCode = node => $("layer").value === "code" || /^(File|Symbol|Source|Directory|Dependency|ExternalDependency)/.test(node.kind || "");
  const relation = edge => {
    const code = edge.type || edge.relation;
    return displayText(({ CITES_EXACT_REVISION: "Mentioned source version", CITES_WORK_EVIDENCE: "Cited work record", DECLARES_WORK_ROOT: "Declared work starting point",
      FOLLOWS_WORK_EVIDENCE: "Previous work record", RECORDED_RESULT: "Recorded result", RECORDED_REVIEW: "Recorded review",
      OBSERVES_BEFORE_REVISION: "Recorded before revision", OBSERVES_AFTER_REVISION: "Recorded after revision",
      REFERS_TO_PREVIOUS_CANON: "Previous recorded Canon", REFERS_TO_BASE_CANON: "Base recorded Canon", REFERS_TO_RESULT_CANON: "Resulting recorded Canon",
      CALLS: "Calls", IMPORTS: "Imports" })[code] || code || "Relationship");
  };
  const key = reference => JSON.stringify([reference?.path || null, reference?.digest || null]);
  const displayText = value => String(value ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/gu, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  const text = (tag, value, className) => { const el = document.createElement(tag); el.textContent = displayText(value); if (className) el.className = className; return el; };
  const button = (value, action) => { const el = text("button", value); el.type = "button"; el.addEventListener("click", action); return el; };
  const svg = (tag, attributes) => { const el = document.createElementNS(ns, tag); for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, displayText(value)); return el; };
  const shorten = (value, length) => Array.from(value).length > length ? Array.from(value).slice(0, length).join("") + "…" : value;
  const measure = document.createElement("canvas").getContext("2d");
  const measuredExtents = new WeakMap();
  const textWidth = (value, size) => {
    if (!measure) return Array.from(value).length * size;
    measure.font = `${size}px system-ui, sans-serif`; return measure.measureText(value).width;
  };
  function nodeExtent(node) {
    if (measuredExtents.has(node)) return measuredExtents.get(node);
    // Match the SVG's actual system font and include both label rows, the
    // selected circle, stroke and breathing room. No DOM text is executed.
    const half = Math.max(27, textWidth(shorten(label(node), 23), 12) / 2, textWidth(`${node.kind} · pinned`, 10) / 2) + 18;
    const extent = { left: half, right: half, top: 45, bottom: 85 };
    measuredExtents.set(node, extent); return extent;
  }
  function captionPlacement(point, extent, viewport) {
    const [left, top, width, height] = viewport;
    const half = Math.min(Math.max(extent.left, extent.right), Math.max(0, width / 2 - 12));
    const center = Math.max(left + half + 12, Math.min(left + width - half - 12, point.x));
    const baseline = Math.max(top + 12, Math.min(top + height - 24, point.y + 49));
    return { x: center - point.x, y: baseline - point.y, maxWidth: Math.max(1, width - 24) };
  }
  const newModel = graph => explorerModel.create(graph, node => isCode(node) ? "code" : "context", nodeExtent);
  let model = newModel(activeGraph);
  const kindName = value => value?.origin?.layer === "sessionWork" ? "Agent-authored work record"
    : ({ ProjectDirection: "Caller-conveyed project direction", FileRevision: "Source file revision", SymbolRevision: "Source symbol revision",
      File: "Source file", Symbol: "Source declaration", LodeSessionStateReference: "Logical Session record", HeadSessionStateReference: "Logical Session record",
      Run: "Recorded execution Run", ResultPacket: "Recorded execution result", ReviewDecision: "Recorded review decision", ChangeSet: "Recorded source changes",
      ProductModelRevision: "Recorded Product Model revision", Feature: "Product feature", Requirement: "Product requirement", Constraint: "Product constraint" })[value?.kind] || value?.kind || "Recorded relationship";
  function recordKey(value) {
    if (value.nodeId) return `node:${value.nodeId}`;
    if (!edgeKeys.has(value)) edgeKeys.set(value, `edge:${value.edgeId || activeGraph.edges.indexOf(value)}`);
    return edgeKeys.get(value);
  }
  function selectionValues() { return [...model.chosen].map(id => model.nodes.get(id)).concat([...chosenEdges]); }
  function filterState() { return Object.fromEntries(filterIds.map(id => [id, $(id).type === "checkbox" || ["include-history", "hide-nonmatches"].includes(id) ? $(id).checked : $(id).value])); }
  function restoreFilters(state) { for (const id of filterIds) { if (typeof state[id] === "boolean") $(id).checked = state[id]; else $(id).value = state[id]; } scopeCache = null; }
  function viewState(title) { return { title, model: model.capture(), selected, chosenEdges: [...chosenEdges], box: [...box], mapMode, filters: filterState(), connectionResult, connectionKey, operationStatus: $("operation-status").textContent }; }
  function remember(title) { viewHistory.splice(viewCursor + 1); viewHistory.push(viewState(title)); viewCursor = viewHistory.length - 1; renderTrail(); }
  function travelView(index) {
    const state = viewHistory[index]; if (!state) return;
    cancelWork(false); viewCursor = index; model.restore(state.model); selected = state.selected; chosenEdges = new Set(state.chosenEdges); edgeVersion++;
    box = [...state.box]; mapMode = state.mapMode; restoreFilters(state.filters); connectionResult = state.connectionResult; connectionKey = state.connectionKey;
    $("operation-status").textContent = state.operationStatus;
    cardsCache = comparisonsCache = null; render();
  }
  function cancelWork(announce = true) { jobSerial++; if (busy && announce) $("operation-status").textContent = "Cancelled calculation; previous committed view and selection retained."; busy = false; jobKind = null; $("cancel-work").disabled = true; }
  function operationKey() { const filters = filterState(); if (!filters["hide-nonmatches"]) filters.search = "";
    return JSON.stringify([[...model.chosen], [...chosenEdges].map(recordKey), filters]); }
  const historical = node => node.currentTraversalEligible === false || node.snapshotState === "historical" || node.historical === true
    || /^(?:historical|domain-not-current|unavailable)/.test(node.freshness || "");
  const inEvidenceScope = node => node && ($("include-history").checked || !historical(node))
    && ($("axis").value === "all" || ($("axis").value === "code") === isCode(node))
    && ($("view").value === "all" || node.views?.includes($("view").value));
  function matches() {
    const scopeKey = JSON.stringify(filterState());
    if (scopeCache?.graph === activeGraph && scopeCache.key === scopeKey) return scopeCache.found;
    document.documentElement.dataset.explorerSearchPasses = String(Number(document.documentElement.dataset.explorerSearchPasses || 0) + 1);
    const eligible = activeGraph.nodes.filter(inEvidenceScope), found = model.search($("search").value.trim().toLocaleLowerCase(), eligible);
    scopeCache = { graph: activeGraph, key: scopeKey, found, foundIds: new Set(found.map(node => node.nodeId)), eligible,
      shown: $("hide-nonmatches").checked ? found : eligible };
    scopeCache.shownIds = new Set(scopeCache.shown.map(node => node.nodeId)); return found;
  }
  const inDisplayScope = node => inEvidenceScope(node) && (!$("hide-nonmatches").checked || scopeCache?.foundIds.has(node.nodeId));
  const edgeInScope = edge => ($("include-history").checked || !historical(edge)) && ($("relation-filter").value === "all" || !$("relation-filter").value || (edge.type || edge.relation) === $("relation-filter").value);
  function operationNode(node) {
    if (!node || !inDisplayScope(node)) return false;
    if (model.chosen.has(node.nodeId) || $("kind-filter").value === "all" || !$("kind-filter").value) return true;
    return ({ code: /^(File|Symbol|Source|Directory|Dependency)/, judgment: /Direction|Review|Decision|Policy|Requirement|Constraint/,
      execution: /Run|Result|Execution|Worker/ })[$("kind-filter").value]?.test(node.kind || "");
  }
  function setBox() { $("graph").setAttribute("viewBox", box.join(" ")); }
  function focusCamera() {
    let point = model.positions.get(selected?.kind === "node" ? selected.value.nodeId : model.current);
    if (selected?.kind === "edge") {
      for (const id of [selected.value.from, selected.value.to]) model.reveal(id);
      const a = model.positions.get(selected.value.from), b = model.positions.get(selected.value.to);
      point = a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a || b;
    }
    if (!point) return;
    hide($("graph"), false);
    const width = $("graph").clientWidth || 1000, height = $("graph").clientHeight || 700;
    box = [point.x - width / 2, point.y - height / 2, width, height]; setBox();
  }
  function redrawCamera() {
    if (cameraFrame !== null) return;
    cameraFrame = requestAnimationFrame(() => { cameraFrame = null; if (mapMode === "overview") renderOverview(scopeCache.shown); else renderGraph(visibleMatches); });
  }
  function fit() {
    const points = [...model.positions].filter(([id]) => inEvidenceScope(model.nodes.get(id)) && model.visible.has(id))
      .map(([id, point]) => ({ point, extent: nodeExtent(model.nodes.get(id)) }));
    if (!points.length) box = [0, 0, 1000, 700];
    else {
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
      for (const { point: p, extent: e } of points) {
        left = Math.min(left, p.x - e.left); top = Math.min(top, p.y - e.top);
        right = Math.max(right, p.x + e.right); bottom = Math.max(bottom, p.y + e.bottom);
      }
      box = [left, top, Math.max(650, right - left), Math.max(480, bottom - top)];
    }
    setBox();
  }
  function overviewModel() {
    if (!overviewStates.has(activeGraph)) overviewStates.set(activeGraph, explorerModel.overview(activeGraph, node => isCode(node) ? "code" : "context"));
    return overviewStates.get(activeGraph);
  }
  function renderOverview(found) {
    const canvas = $("overview"), ctx = canvas.getContext("2d"), overview = overviewModel();
    if (!ctx) { $("status").textContent = "Canvas unavailable; every record remains reachable in the complete searchable list."; return; }
    const rect = canvas.getBoundingClientRect(), camera = explorerModel.viewport(box, rect), dpr = globalThis.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr)); canvas.height = Math.max(1, Math.round(rect.height * dpr));
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * camera.scale, 0, 0, dpr * camera.scale, dpr * (camera.left - box[0] * camera.scale), dpr * (camera.top - box[1] * camera.scale));
    ctx.strokeStyle = "#627b9e"; ctx.globalAlpha = .22; ctx.beginPath();
    let edges = 0;
    for (const edge of activeGraph.edges) {
      if (!scopeCache.shownIds.has(edge.from) || !scopeCache.shownIds.has(edge.to) || !edgeInScope(edge)) continue;
      const a = overview.points.get(edge.from), b = overview.points.get(edge.to);
      if (a && b) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); edges++; }
    }
    ctx.stroke(); ctx.globalAlpha = 1;
    for (const node of found) {
      const point = overview.points.get(node.nodeId); if (!point) continue;
      if (point.x < box[0] || point.x > box[0] + box[2] || point.y < box[1] || point.y > box[1] + box[3]) continue;
      ctx.fillStyle = model.chosen.has(node.nodeId) ? "#ffffff" : connectionResult?.nodes.has(node.nodeId) ? "#96e4c0" : $("search").value && foundIds.has(node.nodeId) ? "#f2d674" : historical(node) ? "#a38baa" : isCode(node) ? "#80baff" : "#eabd87";
      const radius = (model.chosen.has(node.nodeId) ? 3 : 1) / camera.scale;
      ctx.fillRect(point.x - radius, point.y - radius, radius * 2, radius * 2);
    }
    // Highlight actual directed relationships without reversing their stored ends.
    ctx.strokeStyle = "#96e4c0"; ctx.lineWidth = 2 / camera.scale; ctx.beginPath();
    const highlighted = new Set([...(connectionResult?.edges || []), ...chosenEdges]);
    for (const id of model.chosen) for (const edge of model.links(id)) if (model.chosen.has(edge.from) && model.chosen.has(edge.to)) highlighted.add(edge);
    for (const edge of highlighted) if (scopeCache.shownIds.has(edge.from) && scopeCache.shownIds.has(edge.to) && edgeInScope(edge)) {
      const a = overview.points.get(edge.from), b = overview.points.get(edge.to); if (a && b) {
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        const length = Math.hypot(b.x - a.x, b.y - a.y), size = 5 / camera.scale;
        if (length) { const ux = (b.x - a.x) / length, uy = (b.y - a.y) / length;
          ctx.moveTo(b.x - ux * size - uy * size / 2, b.y - uy * size + ux * size / 2); ctx.lineTo(b.x, b.y); ctx.lineTo(b.x - ux * size + uy * size / 2, b.y - uy * size - ux * size / 2);
        }
      }
    } ctx.stroke();
    $("status").textContent = `All evidence overview: ${found.length} filtered records, ${edges} shown / ${activeGraph.edges.length} exported relationships, ${activeGraph.nodes.length} total exported records. Search highlights ${visibleMatches.length} matches; selection stays in this view. Read directed relationship types in the selected cards/detail list.`;
  }
  function zoom(factor) {
    if (jobKind === "fit") cancelWork();
    const [x, y, width, height] = box, next = width * factor, scale = next / width;
    if (!Number.isFinite(next) || next <= 0 || !Number.isFinite(height * scale)) return;
    box = [x + (width - next) / 2, y + (height - height * scale) / 2, next, height * scale]; setBox(); redrawCamera();
  }
  function selectNode(node, keyboard = false, event = {}) {
    if (!node) return;
    const before = model.selectionVersion, previous = selected?.value;
    if (!model.choose(node.nodeId, { toggle: Boolean(event.ctrlKey || event.metaKey || event.key === " " || event.toggle), only: event.only === true, position: mapMode !== "overview" })) return;
    if (event.only) { chosenEdges.clear(); edgeVersion++; }
    if (before !== model.selectionVersion) cancelWork();
    selected = model.focus ? { kind: "node", value: model.nodes.get(model.focus) } : chosenEdges.size ? { kind: "edge", value: [...chosenEdges][0] } : null;
    if (before !== model.selectionVersion || previous !== selected?.value) remember(`Read ${shorten(label(node), 32)}`);
    render();
    if (keyboard) { const target = [...$("graph").children].find(el => el.getAttribute("data-node") === node.nodeId); target?.focus(); }
  }
  function selectEdge(edge, keyboard = false, event = {}) {
    const toggle = event.ctrlKey || event.metaKey || event.key === " ";
    const changed = toggle || !chosenEdges.has(edge);
    if (toggle && chosenEdges.has(edge)) chosenEdges.delete(edge); else chosenEdges.add(edge);
    if (changed) { edgeVersion++; cancelWork(); } selected = chosenEdges.has(edge) ? { kind: "edge", value: edge } : model.focus ? { kind: "node", value: model.nodes.get(model.focus) } : null;
    remember(`Read ${relation(edge)}`); render(); if (keyboard) $("selected-title").focus();
  }
  function accessibleActivate(el, action) {
    el.addEventListener("click", event => { if (!suppressClick) action(event.detail === 0, event); });
    el.addEventListener("keydown", event => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); action(true, event); } });
  }
  function renderList(found) {
    $("records").replaceChildren();
    listPage = Math.min(listPage, Math.max(0, Math.ceil(found.length / PAGE_SIZE) - 1));
    for (const node of found.slice(listPage * PAGE_SIZE, (listPage + 1) * PAGE_SIZE)) {
      const activate = (event, toggle = false) => {
        selectNode(node, false, toggle ? { toggle: true } : event);
        // Rendering replaces the list. Keep keyboard/checkbox work in that
        // list instead of moving focus to a different map control.
        const attribute = toggle ? "data-record-toggle" : "data-record-entry";
        for (const row of $("records").children) for (const control of row.children)
          if (control.getAttribute(attribute) === node.nodeId) control.focus();
      };
      const entry = button(label(node), event => activate(event)), item = text("li", "");
      entry.setAttribute("data-record-entry", node.nodeId);
      entry.addEventListener("keydown", event => { if (event.key === " ") { event.preventDefault(); activate({ toggle: true }); } });
      entry.append(text("span", `${node.kind} · ${node.freshness || "freshness unknown"}`, "record-kind"));
      entry.setAttribute("aria-pressed", String(model.chosen.has(node.nodeId)));
      const toggle = document.createElement("input"); toggle.type = "checkbox"; toggle.checked = model.chosen.has(node.nodeId);
      toggle.setAttribute("data-record-toggle", node.nodeId);
      toggle.setAttribute("aria-label", `Toggle selection: ${label(node)}`); toggle.addEventListener("change", event => activate(event, true));
      item.append(entry, toggle); $("records").append(item);
    }
    if (!historyCounts.has(activeGraph)) historyCounts.set(activeGraph, activeGraph.nodes.reduce((count, node) => count + Number(historical(node)), 0));
    const past = historyCounts.get(activeGraph);
    $("count").textContent = `${found.length} matching / ${activeGraph.nodes.length} exported (${activeGraph.nodes.length - past} current/retained, ${past} historical/non-current). Page ${listPage + 1} of ${Math.max(1, Math.ceil(found.length / PAGE_SIZE))}. All exported metadata is searchable; page size is not an export limit.`;
    const exclusions = activeGraph.integrity?.excluded || [], omittedOriginals = Object.values(data.originals).filter(original => original.status !== "verified-exact-bytes").length;
    $("inventory-gaps").textContent = `${activeGraph.coverage?.state || activeGraph.status || "Coverage unknown"}. ${exclusions.length} excluded metadata inputs/layers; unavailable-node totals may be unknown. ${omittedOriginals} omitted/unavailable references in the focused original bundle. See snapshot basis for exact reasons.`;
    $("records-prev").disabled = listPage === 0; $("records-next").disabled = (listPage + 1) * PAGE_SIZE >= found.length;
  }
  function renderTrail() {
    $("trail").replaceChildren();
    const start = Math.max(0, viewCursor - PAGE_SIZE + 1);
    viewHistory.slice(start, start + PAGE_SIZE).forEach((state, offset) => {
      const index = start + offset;
      const entry = button(shorten(state.title, 28), () => travelView(index));
      if (index === viewCursor) entry.setAttribute("aria-current", "step"); $("trail").append(entry);
    });
    $("back").disabled = viewCursor <= 0; $("forward").disabled = viewCursor >= viewHistory.length - 1;
    $("restart").disabled = !model.current;
  }
  function renderGraph(found) {
    const focus = selected?.kind === "node" ? selected.value.nodeId : null, neighborhood = new Set(focus ? [focus, ...model.neighbors(focus)] : []);
    const intended = model.visible;
    // Search narrows the record list/overview, not the selected journey. Explicit
    // history, axis and original-view scope still govern every drawn record.
    const scope = [...intended].map(id => model.nodes.get(id)).filter(inDisplayScope), scopeIds = new Set(scope.map(node => node.nodeId));
    const canvas = $("graph"), shown = scope.filter(node => {
      if (!intended.has(node.nodeId)) return false;
      const p = model.positions.get(node.nodeId); if (!p) return false;
      const e = nodeExtent(node);
      return p.x + e.right >= box[0] && p.x - e.left <= box[0] + box[2] && p.y + e.bottom >= box[1] && p.y - e.top <= box[1] + box[3];
    }), shownIds = new Set(shown.map(node => node.nodeId)); drawnNodeIds = shownIds;
    const selectedEdges = [...new Set(shown.flatMap(node => model.links(node.nodeId)))].filter(edge => shownIds.has(edge.from) && shownIds.has(edge.to)
      && edgeInScope(edge));
    canvas.replaceChildren();
    const origin = model.positions.get(model.current);
    if (origin) {
      const guides = svg("g", { class: "axis-guides", "aria-hidden": "true", "pointer-events": "none" });
      guides.append(svg("line", { x1: origin.x - 1400, y1: origin.y, x2: origin.x + 1400, y2: origin.y }));
      if ($("layer").value !== "code") guides.append(svg("line", { x1: origin.x, y1: origin.y - 1200, x2: origin.x, y2: origin.y + 1200 }));
      canvas.append(guides);
    }
    const defs = svg("defs", {}), marker = svg("marker", { id: "edge-arrow", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 5, markerHeight: 5, orient: "auto" });
    marker.append(svg("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "#8ca6c9" })); defs.append(marker); canvas.append(defs);
    const edgeGroups = new Map();
    for (const edge of selectedEdges) { const pair = JSON.stringify([edge.from, edge.to].sort()); if (!edgeGroups.has(pair)) edgeGroups.set(pair, []); edgeGroups.get(pair).push(edge); }
    for (const edge of selectedEdges) {
      if (!shownIds.has(edge.from) || !shownIds.has(edge.to)) continue;
      const a = model.positions.get(edge.from), b = model.positions.get(edge.to), distance = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const ux = (b.x - a.x) / distance, uy = (b.y - a.y) / distance;
      const isSelected = chosenEdges.has(edge), incident = focus && (edge.from === focus || edge.to === focus);
      const joined = model.chosen.has(edge.from) && model.chosen.has(edge.to), path = connectionResult?.edges.has(edge);
      const group = svg("g", { class: `connection${isSelected || incident || joined || path ? " highlighted" : ""}${path ? " selected-path" : ""}` });
      const siblings = edgeGroups.get(JSON.stringify([edge.from, edge.to].sort())), offset = (siblings.indexOf(edge) - (siblings.length - 1) / 2) * 48 * (edge.from <= edge.to ? 1 : -1);
      const cx = (a.x + b.x) / 2 - uy * offset, cy = (a.y + b.y) / 2 + ux * offset;
      const shape = edge.from === edge.to ? `M ${a.x - 17} ${a.y - 18} C ${a.x - 90} ${a.y - 100 - offset} ${a.x + 90} ${a.y - 100 - offset} ${a.x + 17} ${a.y - 27}`
        : `M ${a.x + ux * 25} ${a.y + uy * 25} Q ${cx} ${cy} ${b.x - ux * 32} ${b.y - uy * 32}`;
      const attributes = { d: shape, fill: "none" };
      const hit = svg("path", { ...attributes, class: "edge-hit", tabindex: 0, role: "button", "aria-label": `${relation(edge)}: ${label(model.nodes.get(edge.from))} to ${label(model.nodes.get(edge.to))}`, "data-edge": edge.edgeId || `${edge.from}:${edge.to}` });
      accessibleActivate(hit, (keyboard, event) => selectEdge(edge, keyboard, event));
      const line = svg("path", { ...attributes, "marker-end": "url(#edge-arrow)", class: "edge", "pointer-events": "none" });
      const caption = svg("text", { x: cx, y: edge.from === edge.to ? a.y - 85 - offset : cy - 9, "text-anchor": "middle", class: "edge-label", "pointer-events": "none" }); caption.textContent = relation(edge);
      const title = svg("title", {}); title.textContent = relation(edge); group.append(title, hit, line, caption); canvas.append(group);
    }
    for (const node of shown) {
      const p = model.positions.get(node.nodeId), focused = focus === node.nodeId, pinned = model.pinned.has(node.nodeId);
      const group = svg("g", { transform: `translate(${p.x},${p.y})`, class: `node${isCode(node) ? " code" : " context"}${model.chosen.has(node.nodeId) ? " selected" : ""}${connectionResult?.nodes.has(node.nodeId) ? " selected-path" : ""}${$("search").value && foundIds.has(node.nodeId) ? " search-match" : ""}`,
        tabindex: 0, role: "button", "aria-label": `${node.kind}: ${label(node)}${pinned ? ". Position pinned on this screen" : ""}`, "data-node": node.nodeId });
      group.append(svg("circle", { r: focused ? 27 : 22 }));
      group.setAttribute("aria-pressed", String(model.chosen.has(node.nodeId)));
      const glyph = svg("text", { y: 4, "text-anchor": "middle", class: "glyph" }); glyph.textContent = model.chosen.has(node.nodeId) ? "✓" : String(node.kind || "?").slice(0, 1);
      // Move captions only, never pin/layout/selection coordinates. A leader
      // retains their association when camera edges require an offset.
      const placement = captionPlacement(p, nodeExtent(node), box);
      const caption = svg("text", { x: placement.x, y: placement.y, "text-anchor": "middle", class: "node-label" }); caption.textContent = shorten(label(node), 23);
      const kind = svg("text", { x: placement.x, y: placement.y + 17, "text-anchor": "middle", class: "kind" }); kind.textContent = displayText(`${node.kind}${pinned ? " · pinned" : ""}`);
      for (const [element, size] of [[caption, 12], [kind, 10]]) if (textWidth(element.textContent, size) > placement.maxWidth) {
        element.setAttribute("textLength", placement.maxWidth); element.setAttribute("lengthAdjust", "spacingAndGlyphs");
      }
      if (placement.x || placement.y !== 49) group.append(svg("line", { x1: 0, y1: 25, x2: placement.x, y2: placement.y - 12, class: "caption-guide", "pointer-events": "none" }));
      const title = svg("title", {}); title.textContent = label(node); group.append(glyph, caption, kind, title);
      accessibleActivate(group, (keyboard, event) => selectNode(node, keyboard, event));
      group.addEventListener("keydown", event => {
        const delta = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }[event.key];
        if (!event.shiftKey || !delta) return; event.preventDefault(); const at = model.positions.get(node.nodeId); model.move(node.nodeId, at.x + delta[0], at.y + delta[1]); renderGraph(visibleMatches);
        const replacement = [...canvas.querySelectorAll("[data-node]")].find(el => el.getAttribute("data-node") === node.nodeId); replacement?.focus();
      }); canvas.append(group);
    }
    if (!shown.length) { const empty = svg("text", { x: 60, y: 90, class: "empty" }); empty.textContent = selected?.kind === "node" && !inEvidenceScope(selected.value)
      ? "Selected record is outside the current evidence scope. Change scope or choose a result; it has not been removed."
      : scope.length ? "Selected context is off-screen. Use Focus selection or pan." : "Choose a starting record from the list. Empty coverage does not prove absence."; canvas.append(empty); }
    const hidden = [...intended].filter(id => !scopeIds.has(id)).length, offscreen = scope.length - shown.length;
    $("status").textContent = `${mapMode === "focus" ? "Selected & direct connections" : "Explored map"}: ${shown.length} on screen, ${offscreen} off-screen, ${hidden} unavailable/outside evidence scope / ${activeGraph.nodes.length} exported. Search narrows the list and overview; eligible selected context stays visible.${selected?.kind === "node" && !inEvidenceScope(selected.value) ? " Selected record is outside the current evidence scope; it has not been removed." : ""}${activeGraph.reasonCode ? ` ${activeGraph.reasonCode}` : ""}`;
    setBox();
  }
  function renderSelectionCards() {
    const values = selectionValues(), focusedKey = selected ? recordKey(selected.value) : null;
    const hidden = values.filter(value => value.nodeId ? !inDisplayScope(value) : !edgeInScope(value)).length;
    $("selection-count").textContent = `${values.length} selected · ${hidden} outside current evidence scope`;
    $("clear-selection").disabled = values.length === 0; $("only-focus").disabled = !selected;
    $("collapse").disabled = model.steps.length === 0 || busy; $("connect-selection").disabled = model.chosen.size < 2 || busy;
    const pageCount = Math.max(1, Math.ceil(values.length / PAGE_SIZE)); cardPage = Math.min(cardPage, pageCount - 1);
    $("reading-range").textContent = `${values.length ? cardPage * PAGE_SIZE + 1 : 0}–${Math.min(values.length, (cardPage + 1) * PAGE_SIZE)} of ${values.length} selected records. Reading focus does not replace other cards or move the camera.`;
    $("cards-prev").disabled = cardPage === 0; $("cards-next").disabled = (cardPage + 1) * PAGE_SIZE >= values.length;
    const same = cardsCache?.model === model && cardsCache.version === model.selectionVersion && cardsCache.edgeVersion === edgeVersion && cardsCache.page === cardPage;
    if (!same) {
      const body = $("selection-cards"); body.replaceChildren();
      const entries = new Map();
      for (const value of values.slice(cardPage * PAGE_SIZE, (cardPage + 1) * PAGE_SIZE)) {
        const node = Boolean(value.nodeId), card = text("article", "", "selection-card"), identity = recordKey(value);
        card.setAttribute("data-record", identity); card.append(text("h3", node ? label(value) : relation(value)));
        card.append(text("p", `${kindName(value)} · ${value.kind || value.type || "relationship"}`, "record-kind"));
        const conditions = [value.freshness, value.reviewState, value.status, value.state,
          historical(value) ? "historical / non-current" : null, value.contentPartial || value.workContentCoverage?.partial || value.directionContentCoverage?.partial ? "partial excerpt" : null,
          node && !inDisplayScope(value) || !node && !edgeInScope(value) ? "outside evidence scope — selection retained" : null].filter(item => typeof item === "string" && item);
        const conditionsElement = text("p", conditions.join(" · "), "card-conditions"); card.append(conditionsElement);
        if (value.origin?.layer === "sessionWork") card.append(text("p", "Agent-authored work; not a captured user utterance.", "hint"));
        if (value.kind === "ProjectDirection") card.append(text("p", "Caller-conveyed direction; not automatic transcript capture.", "hint"));
        card.append(text("p", value.workContent?.summary || value.description || value.summary || value.directionEvidence?.goal || value.rationale || value.outcome || value.statement || value.path || (node ? "No summary included." : `${label(model.nodes.get(value.from))} → ${label(model.nodes.get(value.to))}`)));
        for (const [heading, facts] of [["Recorded judgments", value.workContent?.judgments], ["Pending", value.workContent?.pending], ["Unknown", value.workContent?.unknowns || value.unknowns],
          ["Constraints", value.directionEvidence?.constraints], ["Cancelled actions", value.directionEvidence?.cancelledActions]]) if (Array.isArray(facts) && facts.length) {
          card.append(text("strong", heading)); const list = text("ul", "", "record-facts");
          for (const fact of facts) {
            const row = text("li", typeof fact === "string" ? fact : fact.assessment || "Recorded judgment");
            if (fact && typeof fact === "object") { row.append(text("p", fact.reason || "No recorded reason included.")); for (const alternative of fact.alternatives || []) row.append(text("p", alternative, "hint")); }
            list.append(row);
          } card.append(list);
        }
        if (!value.rationale && !value.workContent?.judgments?.length) card.append(text("p", "No recorded reason included for this record.", "hint"));
        const actions = text("div", "", "reading-actions");
        actions.append(button("Read focus", () => node ? selectNode(value) : selectEdge(value)),
          button("Only this", () => {
            if (node) selectNode(value, false, { only: true });
            else { model.clearSelection(); chosenEdges = new Set([value]); edgeVersion++; selected = { kind: "edge", value }; cancelWork(); remember("Select one relationship"); render(); }
          }), button("Remove", () => node ? selectNode(value, false, { toggle: true }) : selectEdge(value, false, { ctrlKey: true })));
        card.append(actions);
        const links = node ? model.links(value.nodeId) : [value];
        const connections = text("details", ""); connections.append(text("summary", `${links.length} actual relationships (direction and type)`));
        const rows = text("ul", ""), pages = text("nav", "", "list-pages"); let page = 0;
        const listConnections = () => {
          rows.replaceChildren();
          for (const edge of links.slice(page * 20, (page + 1) * 20)) {
            const from = model.nodes.get(edge.from), to = model.nodes.get(edge.to), row = text("li", "");
            row.append(text("p", `${from ? label(from) : "Endpoint not exported"} → ${to ? label(to) : "Endpoint not exported"} · ${relation(edge)}${edgeInScope(edge) ? "" : " · outside current relationship scope"}`));
            row.append(button("Read relationship", () => selectEdge(edge))); rows.append(row);
          }
          pages.replaceChildren(text("span", `${page * 20 + (links.length ? 1 : 0)}–${Math.min(links.length, (page + 1) * 20)} / ${links.length}`));
          const previous = button("Previous", () => { page--; listConnections(); }), next = button("Next", () => { page++; listConnections(); });
          previous.disabled = page === 0; next.disabled = (page + 1) * 20 >= links.length; pages.append(previous, next);
        }; listConnections(); connections.append(rows, pages); card.append(connections);
        const original = data.originals[key(value.sourceReference || value.provenance)], detail = text("details", "");
        detail.append(text("summary", "Exact original & identity"));
        detail.append(text("p", original?.status || "Exact original not included", "hint"));
        if (original?.reasonCode) detail.append(text("p", original.reasonCode, "hint"));
        if (original?.text) detail.append(text("pre", readableOriginal(original.text, value) ?? original.text));
        const raw = text("details", ""); raw.append(text("summary", "Raw original / unknown fields / identifiers"), text("pre", original?.text || "Original not included"), text("pre", JSON.stringify(value, null, 2))); detail.append(raw); card.append(detail);
        entries.set(identity, { card, value, conditionsElement, refreshConnections: listConnections }); body.append(card);
      }
      if (!values.length) body.append(text("p", "Select records to read together. The explored map remains intact.", "hint"));
      cardsCache = { model, version: model.selectionVersion, edgeVersion, page: cardPage, scope: scopeCache.key, entries };
    }
    if (cardsCache.scope !== scopeCache.key) {
      for (const entry of cardsCache.entries.values()) entry.refreshConnections();
      cardsCache.scope = scopeCache.key;
    }
    for (const [identity, entry] of cardsCache.entries) {
      const { card, value, conditionsElement } = entry;
      card.dataset.focused = String(identity === focusedKey); card.setAttribute("aria-label", identity === focusedKey ? "Reading focus" : "Selected record");
      conditionsElement.textContent = displayText([value.freshness, value.reviewState, value.status, value.state,
        historical(value) ? "historical / non-current" : null, value.contentPartial || value.workContentCoverage?.partial || value.directionContentCoverage?.partial ? "partial excerpt" : null,
        value.nodeId ? !inDisplayScope(value) ? "outside evidence scope — selection retained" : null : !edgeInScope(value) ? "outside relationship scope — selection retained" : null].filter(item => typeof item === "string" && item).join(" · "));
    }
    $("connection-roots").replaceChildren();
    if (connectionResult) {
      const stale = connectionKey !== operationKey();
      $("connection-status").textContent = `${stale ? "Previous connection result — scope/selection changed; run again to update. " : "Selected connections: "}Bidirectional adjacency search; shortest connection branches with all equal predecessors, not all paths or directed execution. ${connectionResult.roots.length} component(s), ${connectionResult.outsideScope.length} selected outside scope; absence here is not global absence. Longer branches remain available with Expand.`;
      rootPage = Math.min(rootPage, Math.max(0, Math.ceil(connectionResult.roots.length / PAGE_SIZE) - 1));
      for (const component of connectionResult.roots.slice(rootPage * PAGE_SIZE, (rootPage + 1) * PAGE_SIZE)) {
        const row = text("li", `Fixed reference: ${label(model.nodes.get(component.root))} → ${component.targets.length} selected record(s). `);
        row.append(button("Read reference", () => selectNode(model.nodes.get(component.root)))); $("connection-roots").append(row);
      }
    } else $("connection-status").textContent = "Direct relationships between selected records are highlighted. Show selected connections finds recorded branches; it cannot establish cause, approval or completion.";
    $("roots-prev").disabled = !connectionResult || rootPage === 0; $("roots-next").disabled = !connectionResult || (rootPage + 1) * PAGE_SIZE >= connectionResult.roots.length;
  }
  async function runExpansion() {
    cancelWork(false); const serial = ++jobSerial; busy = true; jobKind = "expand"; $("cancel-work").disabled = false;
    $("operation-status").textContent = "Finding the next unexpanded boundary…"; renderSelectionCards();
    const result = await model.expandWave({ key: operationKey(), allowed: operationNode, edgeAllowed: edgeInScope, cancelled: () => serial !== jobSerial, yieldWork,
      progress: value => { $("operation-status").textContent = `Examining boundary: ${value.examinedEdges} actual relationships; not yet committed.`; } });
    if (serial !== jobSerial) return; busy = false; jobKind = null; $("cancel-work").disabled = true;
    $("operation-status").textContent = `${result.status}: ${result.added || 0} newly exposed records · ${result.edges || 0} actual relationships · ${result.frontier || 0} next-boundary records. Camera, mode, prior positions and selection retained.`;
    remember(`Expand ${result.added || 0}`); render();
  }
  async function runConnections() {
    cancelWork(false); const serial = ++jobSerial, basis = operationKey(); busy = true; jobKind = "connections"; $("cancel-work").disabled = false;
    $("operation-status").textContent = "Computing selected connection branches within this export and filters…"; renderSelectionCards();
    const result = await model.connectSelection({ allowed: operationNode, edgeAllowed: edgeInScope, reference: selected?.kind === "node" ? selected.value.nodeId : null,
      cancelled: () => serial !== jobSerial, yieldWork });
    if (serial !== jobSerial || result.status === "cancelled") return;
    if (!await model.showConnections(result, { cancelled: () => serial !== jobSerial, yieldWork })) return;
    if (serial !== jobSerial) return;
    connectionResult = result; connectionKey = basis; rootPage = 0; busy = false; jobKind = null; $("cancel-work").disabled = true;
    $("operation-status").textContent = `Connection result ready: ${result.nodes.size} records, ${result.edges.size} actual relationships; reference fixed until an explicit new calculation.`;
    remember("Selected connections"); render();
  }
  async function fitExplored() {
    cancelWork(false); const serial = ++jobSerial; busy = true; jobKind = "fit"; $("cancel-work").disabled = false;
    $("operation-status").textContent = "Placing previously unplaced explored records; existing positions remain fixed…";
    if (!await model.placeBatch([...model.visible].filter(id => inDisplayScope(model.nodes.get(id))), { cancelled: () => serial !== jobSerial, yieldWork })) return;
    if (serial !== jobSerial) return;
    busy = false; jobKind = null; $("cancel-work").disabled = true; mapMode = "explored"; fit(); remember("Fit explored map"); render();
  }
  function renderDetail() {
    renderContextLineage();
    let relations = $("relations"); if (!relations) { relations = text("ul", ""); relations.id = "relations"; relations.setAttribute("aria-label", "Follow included connections"); $("expansion").after(relations); } relations.replaceChildren();
    $("expand").disabled = model.chosen.size === 0 || busy;
    if ($("relation-pages")) $("relation-pages").hidden = !selected;
    if (!selected) {
      $("selected-title").textContent = "Where do you want to start?"; $("selected-caption").textContent = "Choose a record to unfold its connected evidence.";
      $("selected-summary").textContent = "The map follows existing links, without making product decisions.";
      $("evidence").textContent = "No record selected."; $("original").textContent = "No record selected."; $("raw-original").textContent = ""; $("raw-original-details").hidden = true; $("original-state").textContent = ""; $("expansion").textContent = ""; return;
    }
    const value = selected.value, node = selected.kind === "node", reference = value.sourceReference || value.provenance;
    const selectionId = value.nodeId || value.edgeId;
    if (relationSelection !== selectionId) { relationPage = 0; relationSelection = selectionId; }
    $("detail-scope").textContent = value.detailCoverage === "metadata-only"
      ? "Metadata only for this record. Missing original/comparison does not mean no change. Regenerate the snapshot with this source as --query for bounded exact detail."
      : "Detail is bounded to the export query, not complete file history. A missing comparison does not mean unchanged.";
    const detailQuery = value.path || value.sourceReference?.path;
    if (detailQuery && data.regenerate?.argv) {
      const powershell = data.regenerate.shell === "powershell", quote = arg => powershell ? `'${String(arg).replaceAll("'", "''")}'` : `'${String(arg).replaceAll("'", `'"'"'`)}'`;
      $("detail-scope").append(text("pre", `${powershell ? "& " : ""}${[...data.regenerate.argv, "--query", detailQuery].map(quote).join(" ")}`));
    }
    $("selected-title").textContent = displayText(node ? label(value) : relation(value));
    $("selected-caption").textContent = displayText(node ? [value.kind, value.freshness || "freshness unknown", value.reviewState || "review unknown", value.status, value.state, value.historical ? "historical" : null].filter(item => typeof item === "string").join(" · ") : `Existing relationship · ${value.viewerCurrentness || value.freshness || "currentness unknown"} · not an execution permission`);
    const summary = $("selected-summary"); summary.replaceChildren();
    summary.append(text("p", String(value.description || value.workContent?.summary || value.summary || value.proposedPolicy?.statement || value.statement || value.purpose || value.objective || value.directionEvidence?.goal || value.rationale || value.planDelta || value.outcome || value.assessment || (node ? "Follow a connection below, or open its exact original." : `${label(model.nodes.get(value.from))} → ${label(model.nodes.get(value.to))}`))));
    for (const [heading, items] of [["Constraints", value.directionEvidence?.constraints], ["Cancelled actions", value.directionEvidence?.cancelledActions], ["Unknowns", value.workContent?.unknowns || value.unknowns], ["Pending", value.workContent?.pending], ["Recorded judgments", value.workContent?.judgments]]) {
      if (!Array.isArray(items) || !items.length) continue;
      summary.append(text("strong", heading)); const list = text("ul", ""); list.className = "record-facts";
      for (const item of items) {
        const entry = text("li", typeof item === "string" ? item : item.assessment || "Recorded judgment");
        if (item && typeof item === "object") { if (item.reason) entry.append(text("p", item.reason)); for (const alternative of item.alternatives || []) entry.append(text("p", alternative, "hint")); }
        list.append(entry);
      } summary.append(list);
    }
    if (value.directionContentCoverage?.partial) summary.append(text("p", "Direction excerpt is partial; the exact original may contain more.", "hint"));
    if (value.contentPartial || value.workContentCoverage?.partial) summary.append(text("p", "Work excerpt is partial; record identity retains exact excerpt metadata.", "hint"));
    $("evidence").textContent = displayText(JSON.stringify(value, null, 2));
    const original = data.originals[key(reference)];
    $("original-state").textContent = original ? `${original.status}${original.reasonCode ? ` · ${original.reasonCode}` : ""}` : "Exact original not included. Reference remains available under record identity.";
    const readable = original?.text ? readableOriginal(original.text, value) : null;
    $("original").textContent = displayText(readable ?? original?.text ?? "Exact original not included for this selection; this is not evidence of absence or no change.");
    $("raw-original").textContent = displayText(original?.text || ""); $("raw-original-details").hidden = readable === null;
    const links = node ? model.links(value.nodeId) : [value];
    const unavailable = node ? new Set(links.flatMap(edge => [edge.from, edge.to]).filter(id => !model.nodes.has(id))).size : 0;
    const filteredOut = node ? model.neighbors(value.nodeId).filter(id => !foundIds.has(id)).length : 0;
    $("expansion").textContent = node ? `${links.length} included connections${unavailable ? ` · ${unavailable} endpoints not exported` : ""}${filteredOut ? ` · ${filteredOut} neighbors hidden by your filters` : ""}.` : "Follow an endpoint:";
    let pages = $("relation-pages");
    if (!pages) {
      pages = text("nav", "", "list-pages"); pages.id = "relation-pages"; pages.setAttribute("aria-label", "Connection pages");
      pages.append(button("Previous connections", () => { relationPage--; renderDetail(); }), button("Next connections", () => { relationPage++; renderDetail(); })); relations.before(pages);
    }
    relationPage = Math.min(Math.max(0, relationPage), Math.max(0, Math.ceil(links.length / PAGE_SIZE) - 1));
    pages.hidden = links.length <= PAGE_SIZE;
    pages.children[0].disabled = relationPage === 0; pages.children[1].disabled = (relationPage + 1) * PAGE_SIZE >= links.length;
    $("expansion").textContent += ` Connection page ${relationPage + 1} of ${Math.max(1, Math.ceil(links.length / PAGE_SIZE))}; every included connection is reachable.`;
    for (const edge of links.slice(relationPage * PAGE_SIZE, (relationPage + 1) * PAGE_SIZE)) {
      const targets = node ? [edge.from === value.nodeId ? edge.to : edge.from] : [edge.from, edge.to];
      for (const id of targets) {
        const target = model.nodes.get(id), row = text("li", ""), direction = edge.from === value.nodeId ? "→" : "←";
        const condition = historical(edge) || target && historical(target) ? "[Historical / non-current] " : "";
        const state = target?.reviewState && target.reviewState !== "not-applicable" ? ` · ${target.reviewState}` : "";
        const outside = target && !foundIds.has(id) ? " · outside current filters" : "";
        const entry = button(node ? `${condition}${direction} ${relation(edge)} · ${target ? label(target) : "Not exported"}${state}${outside}` : label(target), () => {
          if (historical(edge) || target && historical(target)) $("include-history").checked = true;
          selectNode(target);
        }); entry.disabled = !target;
        row.append(entry); if (node) row.append(button("ⓘ", () => selectEdge(edge))); relations.append(row);
      }
    }
  }
  function readableOriginal(raw, node) {
    let record; try { record = JSON.parse(raw); } catch { return null; }
    if (!record || typeof record !== "object") return null;
    // A repository JSON file can imitate any kind/subtype. Only originals
    // supplied by a verified typed record layer get record-specific language.
    if (!["sessionWork", "direction", "lineage", "onboarding", "policy", "product"].includes(node?.origin?.layer)) return null;
    const canon = node?.kind === "ProductModelRevision" || node?.origin?.layer === "product";
    if (record.kind !== node?.kind && !canon) return null;
    const lines = [], put = (title, value) => {
      if (typeof value === "string") lines.push(`${title}: ${value}`);
      else if (Array.isArray(value)) for (const item of value) if (typeof item === "string") lines.push(`${title}: ${item}`);
    };
    if (record.kind === "Evidence" && record.subtype === "SessionWorkEvidence" && node.subtype === "SessionWorkEvidence" && node.origin.layer === "sessionWork" && record.content) {
      lines.push("Agent-authored recorded work evidence; not a captured user transcript.");
      const c = record.content; put("Summary", c.summary);
      for (const judgment of c.judgments || []) { put("Assessment", judgment.assessment); put("Recorded reason", judgment.reason); put("Alternative", judgment.alternatives); }
      for (const [field, title] of [["observedWork", "Recorded observation"], ["pending", "Recorded pending"], ["unknowns", "Unknown"], ["suggestedFollowUp", "Suggested follow-up (not approval)"]]) put(title, c[field]);
    } else if (record.kind === "ProjectDirection" && record.input) {
      lines.push("Caller-conveyed user direction — not transcript capture."); put("Goal", record.input.goal); put("Constraint", record.input.constraints); put("Decision", record.input.decisions); put("Cancelled action", record.input.cancelledActions);
    } else if (record.kind === "ReviewDecision") {
      lines.push("Historical recorded review — not current effect permission."); put("Disposition", record.disposition); put("Recorded reason", record.rationale);
    } else if (record.kind === "ResultPacket") {
      lines.push("Recorded execution result — not independently re-run by this view."); put("Outcome", record.outcome); put("Plan delta", record.planDelta);
      for (const item of record.verification || []) { put("Recorded check", item.check); put("Recorded status", item.status); }
      put("Unknown", record.unknowns);
    } else if (record.kind === "ProductPolicyCandidate") {
      lines.push("Proposed policy — not an approval or automatic Canon promotion."); put("Name", record.proposedPolicy?.name); put("Proposed statement", record.proposedPolicy?.statement); put("Description", record.proposedPolicy?.description);
    } else {
      const model = record.kind === "ProductModelRevision" ? record.document : record;
      if (!canon || !Array.isArray(model?.features) || !Array.isArray(model?.constraints)) return null;
      lines.push("Recorded Product Canon content; its historical/current state is shown above.");
      for (const field of ["featureGroups", "capabilities", "features", "requirements", "constraints", "decisions", "policies"]) for (const entity of model[field] || []) {
        if (!entity || typeof entity !== "object") continue;
        put(field, entity.name || entity.key); put("Statement", entity.statement); put("Description", entity.description); put("Recorded reason", entity.rationale);
      }
    }
    lines.push("Known fields rendered from the exact original. Unknown fields and full identity remain in raw-original diagnostics.");
    return lines.join("\n\n");
  }
  function pairMatches(value, file, pair) {
    if ([pair.changeSet?.nodeId, pair.recordedReviewDecisionId, pair.recordedResultPacketId, pair.leftRecord?.nodeId, pair.rightRecord?.nodeId].some(id => id && id === value.nodeId)) return true;
    const digests = new Set([pair.before?.digest, pair.after?.digest, pair.citedReference?.digest, pair.gap?.expectedDigest,
      ...(pair.gaps || []).map(gap => gap.expectedDigest)].filter(Boolean));
    if ((value.path === file.path || value.sourceReference?.path === file.path) && digests.has(value.digest || value.fileDigest || value.sourceReference?.digest)) return true;
    return (file.associations || []).some(item => item.nodeId === value.nodeId && digests.has(item.source?.digest));
  }
  function fileMatches(value, file) {
    return value.path === file.path || value.sourceReference?.path === file.path || (file.associations || []).some(item => item.nodeId === value.nodeId)
      || (file.comparisons || []).some(pair => pairMatches(value, file, pair));
  }
  function comparisonPosition() {
    $("comparison-position").textContent = `File ${comparisonFiles.length ? fileCursor + 1 : 0}/${comparisonFiles.length} · changed region ${changeCursor >= 0 ? changeCursor + 1 : 0}/${changeHunks.length}. All included comparisons stay open; missing regions are not reconstructed.`;
    $("file-prev").disabled = fileCursor <= 0; $("file-next").disabled = fileCursor >= comparisonFiles.length - 1;
    $("change-prev").disabled = changeCursor <= 0; $("change-next").disabled = changeCursor >= changeHunks.length - 1;
  }
  function renderContextLineage() {
    const context = activeGraph.contextLineage, panel = $("context-lineage"), body = $("context-lineage-body"); panel.hidden = !context;
    if (comparisonsCache?.model === model && comparisonsCache.version === model.selectionVersion && comparisonsCache.edgeVersion === edgeVersion) return;
    comparisonsCache = { model, version: model.selectionVersion, edgeVersion }; body.replaceChildren();
    comparisonFiles = []; changeHunks = []; fileCursor = 0; changeCursor = -1; $("comparison-files").replaceChildren(); comparisonPosition();
    $("show-code-diff").hidden = true;
    if (!context) return;
    body.append(text("p", "Recorded reasons, byte changes and associations are different evidence. No historical cause or current permission is inferred.", "hint"));
    if (context.status === "unavailable") { body.append(text("p", context.reasonCode || "Context unavailable", "hint")); return; }
    const values = selectionValues(), selectedIds = new Set(values.map(value => value.nodeId).filter(Boolean));
    const selectionKey = JSON.stringify(values.map(recordKey));
    if (contextSelection !== selectionKey) { panel.open = Boolean(values.length && context.status !== "unavailable"); contextSelection = selectionKey; }
    for (const event of (context.events || []).filter(item => selectedIds.has(item.nodeId))) {
      body.append(text("p", event.sourceRole === "HEAD-authored-P3-work-evidence-not-user-transcript"
        ? "Agent-authored work evidence; not a captured user transcript" : event.sourceRole, "hint"));
      for (const connection of event.connections) {
        const other = connection.from === event.nodeId ? connection.to : connection.from, target = model.nodes.get(other);
        const entry = button(`${relation({ type: connection.relation })} · ${target ? label(target) : "Not included in this layer"}`, () => selectNode(target)); entry.disabled = !target; body.append(entry);
      }
      if (event.missingLink) body.append(text("p", event.missingLink, "hint"));
    }
    const candidates = (context.files || []).filter(file => values.some(value => fileMatches(value, file))), relatedIds = new Set(selectedIds);
    for (const value of values) if (!candidates.some(file => fileMatches(value, file))) body.append(text("p", `${value.nodeId ? label(value) : relation(value)}: No exact code comparison included. This does not mean unchanged.`, "hint"));
    const outerBody = body;
    for (const file of candidates) {
      const body = text("section", "", "file-comparison"); outerBody.append(body); comparisonFiles.push(body); body.tabIndex = -1;
      const fileIndex = comparisonFiles.length - 1, entry = text("li", "");
      entry.append(button(file.path, () => { fileCursor = fileIndex; body.scrollIntoView({ block: "nearest" }); body.focus(); comparisonPosition(); })); $("comparison-files").append(entry);
      const owners = values.filter(value => fileMatches(value, file));
      body.append(text("h3", file.path));
      body.append(text("p", `Selected references: ${owners.map(value => value.nodeId ? label(value) : relation(value)).join(" · ")}`, "hint"));
      if (file.currentObservation) body.append(text("p", file.currentObservation.explanation, "hint"));
      for (const candidate of file.renameEvidence?.candidates || []) body.append(text("p", `Historical rename candidate — not confirmed continuity: ${candidate.path}. Current identity and cause remain unverified.`, "hint"));
      if (file.renameEvidence) body.append(text("p", file.renameEvidence.status === "observed-most-recent-path-change-only"
        ? "Move lookup checked only the most recent recorded path change; other moves remain unknown."
        : "Move lookup is partial, unavailable or lacks an exact historical source basis; no absence or continuity established.", "hint"));
      const pairs = (file.comparisons || []).filter(pair => values.some(value => pairMatches(value, file, pair)));
      if (!pairs.length) body.append(text("p", "No exact source comparison for these selected references. Same path alone does not establish a revision pair; unavailable data is not an empty diff.", "hint"));
      body.append(text("p", "File-level context; not automatically the reason for each symbol."));
      for (const association of file.associations || []) if (selectedIds.has(association.nodeId)) relatedIds.add(association.nodeId);
      for (const pair of pairs) {
        if (pair.retainedOriginal) {
          const original = pair.retainedOriginal;
          body.append(text("h4", "Exact cited historical source — current path unavailable, not an after-version"), text("pre", original.text));
          if (original.omittedLines || original.textTruncated) body.append(text("p", `Partial historical excerpt: ${original.omittedLines} omitted lines; text truncated ${Boolean(original.textTruncated)}.`, "hint"));
        }
        if (pair.recordedReviewDecisionId) relatedIds.add(pair.recordedReviewDecisionId);
        body.append(text("p", `${pair.status} · file bytes ${pair.fileBytes || "unknown"} · ${pair.scope}`));
        const scopeLabel = pair.scope === "recorded-changeset-snapshot-pair" ? "Recorded snapshot before / after — not request fulfillment"
          : pair.scope === "explicit-work-chain-citation-pair-not-request-boundary" ? "Cited version A / B — not a request boundary"
            : "Cited revision / export-observed current — not live";
        body.append(text("h4", scopeLabel), text("p", `Linked selected records: ${values.filter(value => pairMatches(value, file, pair)).map(value => value.nodeId ? label(value) : relation(value)).join(" · ")}`, "hint"));
        for (const side of ["before", "after"]) body.append(text("p", `${side}: ${pair[side]?.revisionId || pair[side]?.digest || "Version bytes unavailable"} · time not retained in this comparison`, "comparison-basis"));
        const provenance = text("details", ""); provenance.append(text("summary", "Exact comparison provenance"), text("pre", JSON.stringify({ scope: pair.scope, retainedOriginal: pair.retainedOriginal ? { ...pair.retainedOriginal, text: undefined } : undefined, renameEvidence: file.renameEvidence, before: pair.before, after: pair.after, citedReference: pair.citedReference, changeSet: pair.changeSet, leftRecord: pair.leftRecord, rightRecord: pair.rightRecord, recordedResultPacketId: pair.recordedResultPacketId, recordedReviewDecisionId: pair.recordedReviewDecisionId }, null, 2))); body.append(provenance);
        const list = text("ul", ""); list.className = "record-facts";
        for (const symbol of pair.symbols || []) list.append(text("li", `${symbol.after?.qualifiedName || symbol.before?.qualifiedName}: ${symbol.observation}${symbol.locationChanged ? " · line location changed" : ""}`));
        body.append(list);
        if (pair.currentMatchesRecordedAfter === false) body.append(text("p", "Recorded after differs from current. Later changes remain separate.", "hint"));
        if (pair.diff && !pair.diff.changed) body.append(text("p", "No byte differences in this included comparison. Other versions or intervals may differ.", "hint"));
        if (pair.diff?.changed && typeof pair.diff.before?.text === "string" && typeof pair.diff.after?.text === "string") {
          $("show-code-diff").hidden = false;
          const delta = explorerModel.lineDelta(pair.diff.before, pair.diff.after), pre = text("pre", "");
          body.append(text("h3", "Bounded excerpt changes"), text("p", "− removed / + added. Line numbers belong to their respective exact excerpts; not a full-file or semantic comparison.", "hint"));
          for (const side of ["before", "after"]) {
            const excerpt = pair.diff[side];
            if (excerpt.omittedLines || excerpt.textTruncated) body.append(text("p", `Partial comparison excerpt (${side}): ${excerpt.omittedLines ?? "unknown"} omitted lines; text truncated: ${excerpt.textTruncated === true ? "yes" : "no"}. More remains outside this included comparison.`, "comparison-partial"));
          }
          let hunk = null;
          for (const line of delta.lines) {
            if (line.kind === "context") hunk = null;
            else if (!hunk) { hunk = text("span", "", "change-hunk"); hunk.tabIndex = -1; changeHunks.push({ element: hunk, file: fileIndex }); pre.append(hunk); }
            const row = text("span", `${line.kind === "removed" ? "−" : line.kind === "added" ? "+" : " "} ${line.beforeLine ?? "·"}/${line.afterLine ?? "·"} ${line.text}`, `diff-line ${line.kind}`);
            (hunk || pre).append(row);
          }
          if (delta.reasonCode) body.append(text("p", delta.reasonCode, "hint")); else body.append(pre);
          const excerpts = text("details", ""); excerpts.append(text("summary", "Exact before / after excerpts"));
          for (const [side, title] of [["before", "Recorded/cited source"], ["after", pair.scope === "recorded-changeset-snapshot-pair" ? "Recorded after — not necessarily current" : pair.scope === "explicit-work-chain-citation-pair-not-request-boundary" ? "Cited version B — not necessarily current" : "Export-observed current source — not live"]]) {
            const excerpt = pair.diff[side]; excerpts.append(text("h3", `${pair.labels?.[side] || title} · line ${excerpt.startLine}`), text("pre", excerpt.text));
            if (excerpt.omittedLines || excerpt.textTruncated) excerpts.append(text("p", "Partial comparison excerpt; more remains in the exact source.", "hint"));
          }
          body.append(excerpts);
        }
        if (pair.reasonCode || pair.gap) body.append(text("p", pair.reasonCode || pair.gap.reasonCode, "hint"));
        for (const gap of pair.gaps || []) body.append(text("p", gap.reasonCode || "Source bytes unavailable", "hint"));
      }
      body.append(text("p", file.unrecordedIntervals, "hint"));
    }
    for (const reason of context.recordedReasons || []) if (relatedIds.has(reason.nodeId)) {
      body.append(text("h3", "Recorded reason (not proven cause)"));
      body.append(text("p", reason.reason || reason.rationale || reason.assessment));
      body.append(text("p", `${reason.reviewState} · ${reason.reference?.path || reason.nodeId}`, "hint"));
    }
    for (const delta of context.canonChanges || []) if ([delta.review.nodeId, delta.before.nodeId, delta.after.nodeId].some(id => selectedIds.has(id))) {
      body.append(text("h3", "Recorded Canon comparison")); body.append(text("p", delta.status));
      if (delta.rationale) body.append(text("p", delta.rationale));
      for (const change of delta.changes) {
        body.append(text("h3", `${change.field} · ${change.key}`));
        const describe = value => value === undefined || value === null ? "Not present" : Array.isArray(value)
          ? value.map(item => typeof item === "string" ? item : `${item.kind}: ${item.key}`).join("; ") || "(none)" : value === "" ? "(empty)" : String(value);
        // Show changed normalized fields, not a preferred sentence that can
        // conceal retirement, changed conditions or removed relationships.
        for (const field of ["name", "statement", "description", "status", "parentFeatureGroupKeys", "featureGroupKeys", "capabilityKeys", "governedBy", "appliesTo"])
          if (JSON.stringify(change.before?.[field]) !== JSON.stringify(change.after?.[field])) {
            body.append(text("h4", field), text("p", `Before: ${describe(change.before?.[field])}`), text("p", `After: ${describe(change.after?.[field])}`));
          }
      }
      if (delta.omittedChangeCount) body.append(text("p", `${delta.omittedChangeCount} further changes omitted from this view.`, "hint"));
    }
    if (!candidates.length && !relatedIds.size) body.append(text("p", "Select a source or recorded review to follow its available context.", "hint"));
    comparisonPosition();
  }
  function render() {
    setBox();
    const started = performance.now(), found = matches(); visibleMatches = found; foundIds = scopeCache.foundIds;
    hide($("graph"), mapMode === "overview"); hide($("overview"), mapMode !== "overview"); hide($("overview-note"), mapMode !== "overview");
    renderList(found); renderTrail(); if (mapMode === "overview") renderOverview(scopeCache.shown); else renderGraph(found); renderSelectionCards(); renderDetail();
    document.documentElement.dataset.explorerLastRenderMs = String(performance.now() - started);
  }
  $("project").textContent = data.project ? `${data.project.projectId} · Project view` : "No initialized Project. Ordinary work can continue.";
  $("generated").textContent = `Generated ${data.generatedAt}`;
  $("coverage").textContent = `${data.graph.coverage?.state || data.graph.status || "unavailable"} · snapshot, not live`;
  $("layer-info").textContent = "Project purpose, work and retained lineage. No Session is selected by this map.";
  $("basis").textContent = JSON.stringify({ project: data.project, basis: data.graph.basis, coverage: data.graph.coverage, boundary: data.graph.boundary, sourceFallback: data.graph.sourceFallback,
    codeBasis: { worldModelId: data.codeGraph.worldModelId, semanticGraphId: data.codeGraph.semanticGraphId, sourceAnchor: data.codeGraph.sourceAnchor, status: data.codeGraph.status, omittedEdgeCount: data.codeGraph.omittedEdgeCount },
    unavailable: data.unavailable, bounds: data.bounds, metrics: data.metrics, interpretation: data.interpretation }, null, 2);
  $("history-body").append(text("p", data.history.status === "not-requested" ? "No history included. Optional --history includes a bounded retained comparison." : `Retained history: ${data.history.status}${data.history.reasonCode ? ` · ${data.history.reasonCode}` : ""}`, "hint"));
  for (const entry of data.history.entries) $("history-body").append(text("div", `${entry.tier} · ${entry.worldModelId}`, "history-entry"));
  if (data.history.diff) { const pre = text("pre", JSON.stringify({ comparison: data.history.comparison, ...data.history.diff }, null, 2)); $("history-body").append(pre); }
  function populateRelationships() {
    const target = $("relation-filter"); target.replaceChildren();
    const option = (value, title) => { const entry = text("option", title); entry.value = value; target.append(entry); };
    option("all", "All relationship types"); for (const type of [...new Set(activeGraph.edges.map(edge => edge.type || edge.relation).filter(Boolean))].sort()) option(type, type);
    target.value = "all";
  }
  for (const id of filterIds) $(id).addEventListener(id === "search" ? "input" : "change", () => {
    listPage = 0; scopeCache = null; if (id !== "search" || $("hide-nonmatches").checked) cancelWork();
    remember(`Scope: ${id}`); render();
  });
  $("records-prev").addEventListener("click", () => { listPage--; renderList(visibleMatches); });
  $("records-next").addEventListener("click", () => { listPage++; renderList(visibleMatches); });
  $("layer").addEventListener("change", () => {
    cancelWork(false); const next = $("layer").value;
    layerStates.set(activeGraph === data.graph ? "project" : "code", { model, selected, chosenEdges, box: [...box], mapMode, listPage, cardPage, viewHistory, viewCursor, filters: filterState(), connectionResult, connectionKey });
    activeGraph = next === "code" ? data.codeGraph : data.graph;
    const retained = layerStates.get(next); model = retained?.model || newModel(activeGraph); selected = retained?.selected || null; box = retained?.box || [0, 0, 1000, 700];
    chosenEdges = retained?.chosenEdges || new Set(); edgeVersion++; viewHistory = retained?.viewHistory || []; viewCursor = retained?.viewCursor ?? -1;
    connectionResult = retained?.connectionResult || null; connectionKey = retained?.connectionKey || null; cardPage = retained?.cardPage || 0;
    mapMode = retained?.mapMode || "focus"; listPage = retained?.listPage || 0; populateRelationships();
    $("view").value = "all"; $("axis").value = "all"; $("view").disabled = $("axis").disabled = next === "code";
    if (retained) restoreFilters(retained.filters); scopeCache = cardsCache = comparisonsCache = null;
    $("legend-left").textContent = next === "code" ? "Structural evidence" : "Code & sources"; $("legend-right").textContent = next === "code" ? "Existing imports & calls" : "Purpose & work";
    $("layer-info").textContent = next === "code" ? "Complete verified structural metadata; no synthetic Project joins. Non-current evidence is labelled separately." : "Project purpose, work and retained lineage. No Session is selected by this map.";
    $("coverage").textContent = `${activeGraph.coverage?.state || activeGraph.status || "unavailable"} · snapshot, not live`;
    const first = matches()[0]; if (!retained && first) { model.visit(first.nodeId); model.choose(first.nodeId); selected = { kind: "node", value: first }; focusCamera(); remember(`Start ${shorten(label(first), 24)}`); } render();
  });
  const calculationFailed = error => { cancelWork(false); $("operation-status").textContent = `Calculation failed (${error?.name || "unknown"}); no partial result is presented as complete.`; render(); };
  $("expand").addEventListener("click", () => { runExpansion().catch(calculationFailed); });
  $("connect-selection").addEventListener("click", () => { runConnections().catch(calculationFailed); });
  $("collapse").addEventListener("click", () => { cancelWork(false); const step = model.collapse(); $("operation-status").textContent = step ? "Folded the last addition only. Shared, selected, pinned and pre-existing records remain." : "No addition to fold."; remember("Fold last addition"); render(); });
  $("cancel-work").addEventListener("click", () => { cancelWork(); render(); });
  for (const [id, direction] of [["back", -1], ["forward", 1]]) $(id).addEventListener("click", () => travelView(viewCursor + direction));
  $("restart").addEventListener("click", () => { if (model.current) { cancelWork(false); const id = model.current; model.reset(id); model.choose(id); chosenEdges.clear(); edgeVersion++; selected = { kind: "node", value: model.nodes.get(id) }; connectionResult = null; mapMode = "focus"; focusCamera(); remember("Start here"); render(); } });
  $("zoom-in").addEventListener("click", () => { zoom(.8); remember("Zoom in"); }); $("zoom-out").addEventListener("click", () => { zoom(1.25); remember("Zoom out"); });
  $("focus").addEventListener("click", () => { if (model.focus) model.place(model.focus); mapMode = "focus"; focusCamera(); remember("Center reading focus"); render(); });
  $("reset").addEventListener("click", () => { fitExplored().catch(calculationFailed); });
  $("overview-button").addEventListener("click", () => { mapMode = "overview"; box = [0, 0, 1000, 700]; setBox(); remember("All evidence"); render(); });
  $("overview").addEventListener("click", event => {
    if (suppressClick) return;
    const camera = explorerModel.viewport(box, $("overview").getBoundingClientRect()), point = camera.fromClient(event.clientX, event.clientY);
    const id = overviewModel().hit(point.x, point.y, scopeCache.shownIds, 8 / camera.scale);
    if (id) selectNode(model.nodes.get(id), event.detail === 0, event);
  });
  $("clear-selection").addEventListener("click", () => { cancelWork(); model.clearSelection(); chosenEdges.clear(); edgeVersion++; selected = null; remember("Clear selection only"); render(); });
  $("only-focus").addEventListener("click", () => { if (selected?.kind === "node") selectNode(selected.value, false, { only: true }); else if (selected) { chosenEdges = new Set([selected.value]); model.clearSelection(); edgeVersion++; cancelWork(); remember("Select only relationship"); render(); } });
  $("restore-scope").addEventListener("click", () => { cancelWork(); $("axis").value = $("view").value = $("relation-filter").value = $("kind-filter").value = "all"; $("hide-nonmatches").checked = false;
    if (selectionValues().some(historical)) $("include-history").checked = true; scopeCache = null; remember("Show selected scope"); render(); });
  $("wide-reading").addEventListener("click", () => { const wide = document.documentElement.dataset.readingWide !== "true"; document.documentElement.dataset.readingWide = String(wide); $("wide-reading").setAttribute("aria-pressed", String(wide)); $("wide-reading").textContent = wide ? "Compact reading area" : "Widen reading area"; redrawCamera(); });
  $("cards-prev").addEventListener("click", () => { cardPage--; renderSelectionCards(); }); $("cards-next").addEventListener("click", () => { cardPage++; renderSelectionCards(); });
  $("roots-prev").addEventListener("click", () => { rootPage--; renderSelectionCards(); }); $("roots-next").addEventListener("click", () => { rootPage++; renderSelectionCards(); });
  for (const [id, delta] of [["file-prev", -1], ["file-next", 1]]) $(id).addEventListener("click", () => {
    fileCursor = Math.max(0, Math.min(comparisonFiles.length - 1, fileCursor + delta)); const target = comparisonFiles[fileCursor]; if (target) { target.scrollIntoView({ block: "nearest" }); target.focus(); } comparisonPosition();
  });
  for (const [id, delta] of [["change-prev", -1], ["change-next", 1]]) $(id).addEventListener("click", () => {
    changeCursor = Math.max(0, Math.min(changeHunks.length - 1, changeCursor + delta)); const target = changeHunks[changeCursor]; if (target) { fileCursor = target.file; target.element.scrollIntoView({ block: "nearest" }); target.element.focus(); } comparisonPosition();
  });
  $("show-code-diff").addEventListener("click", () => { $("context-lineage").open = true; $("context-lineage").scrollIntoView({ block: "nearest" }); });
  function cancelGesture() {
    if (drag) { box = [...drag.box]; if (drag.id && drag.original) { if (drag.overview) overviewModel().move(drag.id, drag.original.x, drag.original.y); else model.move(drag.id, drag.original.x, drag.original.y); if (!drag.wasPinned) model.pinned.delete(drag.id); } }
    drag = null; hide($("selection-box"), true); suppressClick = false; setBox(); redrawCamera();
  }
  function bindMap(canvas, overview) {
  const camera = () => explorerModel.viewport(box, canvas.getBoundingClientRect());
  canvas.addEventListener("wheel", event => { event.preventDefault(); zoom(event.deltaY > 0 ? 1.12 : .89); }, { passive: false });
  canvas.addEventListener("pointerdown", event => {
    if (event.button !== 0 || event.target.closest("[data-edge]")) return;
    if (jobKind === "fit") cancelWork();
    const transform = camera(), at = transform.fromClient(event.clientX, event.clientY);
    const node = event.target.closest("[data-node]"), id = overview ? overviewModel().hit(at.x, at.y, scopeCache.shownIds, 8 / transform.scale) : node?.getAttribute("data-node");
    const rectangle = $("rectangle-mode").checked || event.shiftKey && !id;
    const original = id ? (overview ? overviewModel().points : model.positions).get(id) : null;
    drag = { id: rectangle ? null : id, rectangle, transform, at, overview, original: original && { ...original }, wasPinned: model.pinned.has(id), clientX: event.clientX, clientY: event.clientY, box: [...box], moved: false };
    // Capturing a plain SVG-node pointerup at the map retargets its native
    // click to the map as well. Capture background/Canvas now, node drags
    // only after the movement threshold; ordinary node clicks keep their target.
    if (overview || rectangle || !id) canvas.setPointerCapture(event.pointerId);
    suppressClick = false;
  });
  canvas.addEventListener("pointermove", event => {
    if (!drag) return;
    if (Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) < 5 && !drag.moved) return;
    const at = drag.transform.fromClient(event.clientX, event.clientY);
    if (!drag.moved && drag.id && !overview) canvas.setPointerCapture(event.pointerId);
    drag.moved = true;
    if (drag.rectangle) {
      hide($("selection-box"), false); const ghost = $("selection-rect");
      for (const [key, value] of Object.entries({ x: Math.min(event.clientX, drag.clientX), y: Math.min(event.clientY, drag.clientY), width: Math.abs(event.clientX - drag.clientX), height: Math.abs(event.clientY - drag.clientY) })) ghost.setAttribute(key, String(value)); return;
    }
    if (drag.id && drag.original) { const x = drag.original.x + at.x - drag.at.x, y = drag.original.y + at.y - drag.at.y;
      if (overview) { overviewModel().move(drag.id, x, y); model.pinned.add(drag.id); } else model.move(drag.id, x, y);
    } else { box = [drag.box[0] - (at.x - drag.at.x), drag.box[1] - (at.y - drag.at.y), ...drag.box.slice(2)]; setBox(); }
    redrawCamera();
  });
  canvas.addEventListener("pointerup", event => {
    const state = drag; drag = null; hide($("selection-box"), true); suppressClick = Boolean(state?.moved);
    if (state?.rectangle && state.moved) {
      const finish = state.transform.fromClient(event.clientX, event.clientY), left = Math.min(state.at.x, finish.x), right = Math.max(state.at.x, finish.x), top = Math.min(state.at.y, finish.y), bottom = Math.max(state.at.y, finish.y);
      const positions = overview ? overviewModel().points : model.positions, included = overview ? scopeCache.shownIds : drawnNodeIds, picked = [];
      cancelWork(false);
      for (const id of included) { const point = positions.get(id); if (point && point.x >= Math.max(left, box[0]) && point.x <= Math.min(right, box[0] + box[2]) && point.y >= Math.max(top, box[1]) && point.y <= Math.min(bottom, box[1] + box[3])) picked.push(id); }
      const serial = ++jobSerial, previous = selected; busy = true; jobKind = "rectangle"; $("cancel-work").disabled = false;
      $("operation-status").textContent = `Selecting ${picked.length} visible records…`;
      model.chooseBatch(picked, { position: !overview, yieldWork, cancelled: () => serial !== jobSerial }).then(applied => {
        if (!applied || serial !== jobSerial) return;
        if (selected !== previous && selected?.kind === "node") model.choose(selected.value.nodeId, { position: !overview });
        else selected = model.focus ? { kind: "node", value: model.nodes.get(model.focus) } : selected;
        busy = false; jobKind = null; $("cancel-work").disabled = true; $("operation-status").textContent = `Added the rectangle's ${picked.length} records to selection; camera and mode retained.`; remember("Rectangle selection"); render();
      }).catch(calculationFailed);
    } else if (state?.moved) remember(state.id ? "Pin position" : "Pan camera");
    if (state?.moved) setTimeout(() => { suppressClick = false; }, 0);
  });
  canvas.addEventListener("pointercancel", cancelGesture);
  canvas.addEventListener("keydown", event => { if (event.target !== canvas) return; const delta = { ArrowLeft: [-50, 0], ArrowRight: [50, 0], ArrowUp: [0, -50], ArrowDown: [0, 50] }[event.key]; if (delta) { event.preventDefault(); box[0] += delta[0]; box[1] += delta[1]; setBox(); redrawCamera(); remember("Pan camera with keyboard"); } });
  canvas.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); cancelGesture(); cancelWork(); render(); } });
  }
  bindMap($("graph"), false); bindMap($("overview"), true);
  if (typeof globalThis.addEventListener === "function") { globalThis.addEventListener("resize", redrawCamera); globalThis.addEventListener("keydown", event => { if (event.key === "Escape") { cancelGesture(); cancelWork(); render(); } }); }
  if (typeof matchMedia === "function") {
    const narrow = matchMedia("(max-width:650px)").matches;
    $("selection-tools").open = !narrow;
    if (narrow) $("display-options").open = false;
  }
  populateRelationships();
  const first = matches().find(node => node.nodeId === activeGraph.initialNodeId) || matches()[0];
  if (first) { model.visit(first.nodeId); model.choose(first.nodeId); selected = { kind: "node", value: first }; focusCamera(); remember(`Start ${shorten(label(first), 24)}`); } render();
  document.documentElement.dataset.explorerReady = "true"; document.documentElement.dataset.explorerInitialRenderMs = String(performance.now() - initialTime);
})();
