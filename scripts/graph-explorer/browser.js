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
  let activeGraph = data.graph, selected = null;
  let box = [0, 0, 1000, 700], drag = null, suppressClick = false;
  const layerStates = new Map();
  let contextSelection = null;
  let mapMode = "focus", listPage = 0, relationPage = 0, relationSelection = null, foundIds = new Set(), visibleMatches = [], cameraFrame = null;
  const overviewStates = new WeakMap(), PAGE_SIZE = 100;
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
  function nodeExtent(node) {
    if (measuredExtents.has(node)) return measuredExtents.get(node);
    // Match the SVG's actual system font and include both label rows, the
    // selected circle, stroke and breathing room. No DOM text is executed.
    const width = (value, size) => {
      if (!measure) return Array.from(value).length * size;
      measure.font = `${size}px system-ui, sans-serif`; return measure.measureText(value).width;
    };
    const half = Math.max(27, width(shorten(label(node), 23), 12) / 2, width(`${node.kind} · pinned`, 10) / 2) + 18;
    const extent = { left: half, right: half, top: 45, bottom: 85 };
    measuredExtents.set(node, extent); return extent;
  }
  const newModel = graph => explorerModel.create(graph, node => isCode(node) ? "code" : "context", nodeExtent);
  let model = newModel(activeGraph);
  const historical = node => node.currentTraversalEligible === false || node.snapshotState === "historical" || node.historical === true
    || /^(?:historical|domain-not-current|unavailable)/.test(node.freshness || "");
  const inEvidenceScope = node => node && ($("include-history").checked || !historical(node))
    && ($("axis").value === "all" || ($("axis").value === "code") === isCode(node))
    && ($("view").value === "all" || node.views?.includes($("view").value));
  function matches() {
    return model.search($("search").value.trim().toLocaleLowerCase(), activeGraph.nodes.filter(inEvidenceScope));
  }
  function setBox() { $("graph").setAttribute("viewBox", box.join(" ")); }
  function focusCamera() {
    const point = model.positions.get(selected?.kind === "node" ? selected.value.nodeId : model.current);
    if (!point) return;
    $("graph").hidden = false;
    const width = $("graph").clientWidth || 1000, height = $("graph").clientHeight || 700;
    box = [point.x - width / 2, point.y - height / 2, width, height]; setBox();
  }
  function redrawCamera() {
    if (cameraFrame !== null) return;
    cameraFrame = requestAnimationFrame(() => { cameraFrame = null; if (mapMode !== "overview") renderGraph(visibleMatches); });
  }
  function fit() {
    const points = [...model.positions].filter(([id]) => inEvidenceScope(model.nodes.get(id)) && model.visible.has(id)).map(([, point]) => point);
    if (!points.length) box = [0, 0, 1000, 700];
    else {
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
      for (const p of points) { left = Math.min(left, p.x - 170); top = Math.min(top, p.y - 85); right = Math.max(right, p.x + 170); bottom = Math.max(bottom, p.y + 85); }
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
    ctx.clearRect(0, 0, 1000, 700); ctx.strokeStyle = "#627b9e"; ctx.globalAlpha = .18; ctx.beginPath();
    let edges = 0;
    for (const edge of activeGraph.edges) {
      if (!foundIds.has(edge.from) || !foundIds.has(edge.to) || (!$("include-history").checked && historical(edge))) continue;
      const a = overview.points.get(edge.from), b = overview.points.get(edge.to);
      if (a && b) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); edges++; }
    }
    ctx.stroke(); ctx.globalAlpha = 1;
    for (const node of found) {
      const point = overview.points.get(node.nodeId); if (!point) continue;
      ctx.fillStyle = historical(node) ? "#a38baa" : isCode(node) ? "#80baff" : "#eabd87";
      ctx.fillRect(point.x - 1, point.y - 1, 2, 2);
    }
    $("status").textContent = `All evidence overview: ${found.length} filtered records, ${edges} shown / ${activeGraph.edges.length} exported relationships, ${activeGraph.nodes.length} total exported records. Other relationships have filtered or unavailable endpoints. Select a point for readable exact connections.`;
  }
  function zoom(factor) {
    const [x, y, width, height] = box, next = width * factor, scale = next / width;
    if (!Number.isFinite(next) || next <= 0 || !Number.isFinite(height * scale)) return;
    box = [x + (width - next) / 2, y + (height - height * scale) / 2, next, height * scale]; setBox(); redrawCamera();
  }
  function selectNode(node, keyboard = false, record = true) {
    if (!node || !model.visit(node.nodeId, record)) return;
    if (historical(node)) $("include-history").checked = true;
    selected = { kind: "node", value: node }; mapMode = "focus"; focusCamera(); render();
    if (keyboard) $("selected-title").focus();
  }
  function selectEdge(edge, keyboard = false) { selected = { kind: "edge", value: edge }; render(); if (keyboard) $("selected-title").focus(); }
  function accessibleActivate(el, action) {
    el.addEventListener("click", event => { if (!suppressClick) action(event.detail === 0); });
    el.addEventListener("keydown", event => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); action(true); } });
  }
  function renderList(found) {
    $("records").replaceChildren();
    listPage = Math.min(listPage, Math.max(0, Math.ceil(found.length / PAGE_SIZE) - 1));
    for (const node of found.slice(listPage * PAGE_SIZE, (listPage + 1) * PAGE_SIZE)) {
      const entry = button(label(node), event => selectNode(node, event.detail === 0)), item = text("li", "");
      entry.append(text("span", `${node.kind} · ${node.freshness || "freshness unknown"}`, "record-kind"));
      entry.setAttribute("aria-pressed", String(selected?.kind === "node" && selected.value.nodeId === node.nodeId)); item.append(entry); $("records").append(item);
    }
    const past = activeGraph.nodes.reduce((count, node) => count + Number(historical(node)), 0);
    $("count").textContent = `${found.length} matching / ${activeGraph.nodes.length} exported (${activeGraph.nodes.length - past} current/retained, ${past} historical/non-current). Page ${listPage + 1} of ${Math.max(1, Math.ceil(found.length / PAGE_SIZE))}. All exported metadata is searchable; page size is not an export limit.`;
    const exclusions = activeGraph.integrity?.excluded || [], omittedOriginals = Object.values(data.originals).filter(original => original.status !== "verified-exact-bytes").length;
    $("inventory-gaps").textContent = `${activeGraph.coverage?.state || activeGraph.status || "Coverage unknown"}. ${exclusions.length} excluded metadata inputs/layers; unavailable-node totals may be unknown. ${omittedOriginals} omitted/unavailable references in the focused original bundle. See snapshot basis for exact reasons.`;
    $("records-prev").disabled = listPage === 0; $("records-next").disabled = (listPage + 1) * PAGE_SIZE >= found.length;
  }
  function renderTrail() {
    $("trail").replaceChildren();
    model.history.forEach((id, index) => {
      if (index) $("trail").append(text("span", "›", "trail-divider"));
      const entry = button(shorten(label(model.nodes.get(id)), 22), () => {
        const target = model.travel(index - model.cursor); if (target) selectNode(model.nodes.get(target), false, false);
      });
      if (index === model.cursor) entry.setAttribute("aria-current", "step"); $("trail").append(entry);
    });
    $("back").disabled = model.cursor <= 0; $("forward").disabled = model.cursor >= model.history.length - 1;
    $("restart").disabled = !model.current;
  }
  function renderGraph(found) {
    const focus = selected?.kind === "node" ? selected.value.nodeId : null, neighborhood = new Set(focus ? [focus, ...model.neighbors(focus)] : []);
    const intended = mapMode === "explored" ? model.visible : neighborhood;
    // Search narrows the record list/overview, not the selected journey. Explicit
    // history, axis and original-view scope still govern every drawn record.
    const scope = [...intended].map(id => model.nodes.get(id)).filter(inEvidenceScope), scopeIds = new Set(scope.map(node => node.nodeId));
    const canvas = $("graph"), shown = scope.filter(node => {
      if (!intended.has(node.nodeId)) return false;
      const p = model.positions.get(node.nodeId); if (!p) return false;
      const e = nodeExtent(node);
      return p.x + e.right >= box[0] && p.x - e.left <= box[0] + box[2] && p.y + e.bottom >= box[1] && p.y - e.top <= box[1] + box[3];
    }), shownIds = new Set(shown.map(node => node.nodeId));
    const selectedEdges = [...new Set(shown.flatMap(node => model.links(node.nodeId)))].filter(edge => shownIds.has(edge.from) && shownIds.has(edge.to)
      && ($("include-history").checked || !historical(edge)));
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
      const isSelected = selected?.kind === "edge" && selected.value === edge, incident = focus && (edge.from === focus || edge.to === focus);
      const group = svg("g", { class: `connection${isSelected || incident ? " highlighted" : focus ? " muted" : ""}` });
      const siblings = edgeGroups.get(JSON.stringify([edge.from, edge.to].sort())), offset = (siblings.indexOf(edge) - (siblings.length - 1) / 2) * 48 * (edge.from <= edge.to ? 1 : -1);
      const cx = (a.x + b.x) / 2 - uy * offset, cy = (a.y + b.y) / 2 + ux * offset;
      const shape = edge.from === edge.to ? `M ${a.x - 17} ${a.y - 18} C ${a.x - 90} ${a.y - 100 - offset} ${a.x + 90} ${a.y - 100 - offset} ${a.x + 17} ${a.y - 27}`
        : `M ${a.x + ux * 25} ${a.y + uy * 25} Q ${cx} ${cy} ${b.x - ux * 32} ${b.y - uy * 32}`;
      const attributes = { d: shape, fill: "none" };
      const hit = svg("path", { ...attributes, class: "edge-hit", tabindex: 0, role: "button", "aria-label": `${relation(edge)}: ${label(model.nodes.get(edge.from))} to ${label(model.nodes.get(edge.to))}`, "data-edge": edge.edgeId || `${edge.from}:${edge.to}` });
      accessibleActivate(hit, keyboard => selectEdge(edge, keyboard));
      const line = svg("path", { ...attributes, "marker-end": "url(#edge-arrow)", class: "edge", "pointer-events": "none" });
      const caption = svg("text", { x: cx, y: edge.from === edge.to ? a.y - 85 - offset : cy - 9, "text-anchor": "middle", class: "edge-label", "pointer-events": "none" }); caption.textContent = relation(edge);
      const title = svg("title", {}); title.textContent = relation(edge); group.append(title, hit, line, caption); canvas.append(group);
    }
    for (const node of shown) {
      const p = model.positions.get(node.nodeId), focused = focus === node.nodeId, pinned = model.pinned.has(node.nodeId);
      const group = svg("g", { transform: `translate(${p.x},${p.y})`, class: `node${isCode(node) ? " code" : " context"}${focused ? " selected" : ""}${focus && !neighborhood.has(node.nodeId) ? " muted" : ""}`,
        tabindex: 0, role: "button", "aria-label": `${node.kind}: ${label(node)}${pinned ? ". Position pinned on this screen" : ""}`, "data-node": node.nodeId });
      group.append(svg("circle", { r: focused ? 27 : 22 }));
      const glyph = svg("text", { y: 4, "text-anchor": "middle", class: "glyph" }); glyph.textContent = String(node.kind || "?").slice(0, 1);
      const caption = svg("text", { y: 49, "text-anchor": "middle", class: "node-label" }); caption.textContent = shorten(label(node), 23);
      const kind = svg("text", { y: 66, "text-anchor": "middle", class: "kind" }); kind.textContent = displayText(`${node.kind}${pinned ? " · pinned" : ""}`);
      const title = svg("title", {}); title.textContent = label(node); group.append(glyph, caption, kind, title);
      accessibleActivate(group, keyboard => selectNode(node, keyboard));
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
  function renderDetail() {
    $("show-code-diff").hidden = true;
    renderContextLineage();
    let relations = $("relations"); if (!relations) { relations = text("ul", ""); relations.id = "relations"; relations.setAttribute("aria-label", "Follow included connections"); $("expansion").after(relations); } relations.replaceChildren();
    $("expand").disabled = !selected || selected.kind !== "node";
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
  function renderContextLineage() {
    const context = data.graph.contextLineage, panel = $("context-lineage"), body = $("context-lineage-body"); body.replaceChildren(); panel.hidden = !context;
    if (!context) return;
    body.append(text("p", "Recorded reasons, byte changes and associations are different evidence. No historical cause or current permission is inferred.", "hint"));
    if (context.status === "unavailable") { body.append(text("p", context.reasonCode || "Context unavailable", "hint")); return; }
    const value = selected?.value, digest = value?.digest || value?.fileDigest || value?.sourceReference?.digest;
    const selectionKey = value?.nodeId || value?.edgeId || null;
    if (contextSelection !== selectionKey) { panel.open = Boolean(value && context.status !== "unavailable"); contextSelection = selectionKey; }
    const event = (context.events || []).find(item => item.nodeId === value?.nodeId);
    if (event) {
      body.append(text("p", event.sourceRole === "HEAD-authored-P3-work-evidence-not-user-transcript"
        ? "Agent-authored work evidence; not a captured user transcript" : event.sourceRole, "hint"));
      for (const connection of event.connections) {
        const other = connection.from === event.nodeId ? connection.to : connection.from, target = model.nodes.get(other);
        const entry = button(`${relation({ type: connection.relation })} · ${target ? label(target) : "Not included in this layer"}`, () => selectNode(target)); entry.disabled = !target; body.append(entry);
      }
      if (event.missingLink) body.append(text("p", event.missingLink, "hint"));
    }
    const candidates = (context.files || []).filter(file => file.path === value?.path || value?.nodeId && (file.associations.some(item => item.nodeId === value.nodeId)
      || file.comparisons.some(pair => pair.changeSet?.nodeId === value.nodeId || pair.recordedReviewDecisionId === value.nodeId))), relatedIds = new Set(value?.nodeId ? [value.nodeId] : []);
    if ($("show-code-diff")) $("show-code-diff").hidden = !candidates.some(file => file.comparisons.some(pair => pair.diff));
    if (value && !candidates.length) body.append(text("p", "No exact code comparison included for this selection. This does not mean unchanged. Use the existing exporter with --query and this source path to include bounded exact detail.", "hint"));
    for (const file of candidates) {
      const recordConnection = value?.nodeId && (file.associations.some(item => item.nodeId === value.nodeId)
        || file.comparisons.some(pair => pair.changeSet?.nodeId === value.nodeId || pair.recordedReviewDecisionId === value.nodeId));
      const exact = recordConnection || digest && (file.current.digest === digest || file.comparisons.some(pair => pair.before?.digest === digest || pair.after?.digest === digest));
      body.append(text("h3", file.path));
      if (file.currentObservation) body.append(text("p", file.currentObservation.explanation, "hint"));
      if (!exact) { body.append(text("p", "Same path only; an exact revision link is not established for this selection.", "hint")); continue; }
      body.append(text("p", "File-level context; not automatically the reason for each symbol."));
      for (const association of file.associations) relatedIds.add(association.nodeId);
      for (const pair of file.comparisons) {
        if (pair.recordedReviewDecisionId) relatedIds.add(pair.recordedReviewDecisionId);
        body.append(text("p", `${pair.status} · file bytes ${pair.fileBytes || "unknown"} · ${pair.scope}`));
        const list = text("ul", ""); list.className = "record-facts";
        for (const symbol of pair.symbols) list.append(text("li", `${symbol.after?.qualifiedName || symbol.before?.qualifiedName}: ${symbol.observation}${symbol.locationChanged ? " · line location changed" : ""}`));
        body.append(list);
        if (pair.currentMatchesRecordedAfter === false) body.append(text("p", "Recorded after differs from current. Later changes remain separate.", "hint"));
        if (pair.diff && !pair.diff.changed) body.append(text("p", "No byte differences in this included comparison. Other versions or intervals may differ.", "hint"));
        if (pair.diff?.changed) {
          const delta = explorerModel.lineDelta(pair.diff.before, pair.diff.after), pre = text("pre", "");
          body.append(text("h3", "Bounded excerpt changes"), text("p", "− removed / + added. Line numbers belong to their respective exact excerpts; not a full-file or semantic comparison.", "hint"));
          for (const line of delta.lines) pre.append(text("span", `${line.kind === "removed" ? "−" : line.kind === "added" ? "+" : " "} ${line.beforeLine ?? "·"}/${line.afterLine ?? "·"} ${line.text}`, `diff-line ${line.kind}`));
          if (delta.reasonCode) body.append(text("p", delta.reasonCode, "hint")); else body.append(pre);
          const excerpts = text("details", ""); excerpts.append(text("summary", "Exact before / after excerpts"));
          for (const [side, title] of [["before", "Recorded/cited source"], ["after", pair.scope === "recorded-changeset-snapshot-pair" ? "Recorded after — not necessarily current" : "Observed current source"]]) {
            const excerpt = pair.diff[side]; excerpts.append(text("h3", `${pair.labels?.[side] || title} · line ${excerpt.startLine}`), text("pre", excerpt.text));
            if (excerpt.omittedLines || excerpt.textTruncated) excerpts.append(text("p", "Partial comparison excerpt; more remains in the exact source.", "hint"));
          }
          body.append(excerpts);
        }
        if (pair.reasonCode || pair.gap) body.append(text("p", pair.reasonCode || pair.gap.reasonCode, "hint"));
      }
      body.append(text("p", file.unrecordedIntervals, "hint"));
    }
    for (const reason of context.recordedReasons || []) if (relatedIds.has(reason.nodeId)) {
      body.append(text("h3", "Recorded reason (not proven cause)"));
      body.append(text("p", reason.reason || reason.rationale || reason.assessment));
      body.append(text("p", `${reason.reviewState} · ${reason.reference?.path || reason.nodeId}`, "hint"));
    }
    for (const delta of context.canonChanges || []) if (value?.nodeId && (delta.review.nodeId === value.nodeId || [delta.before.nodeId, delta.after.nodeId].includes(value.nodeId))) {
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
  }
  function render() {
    const started = performance.now(), found = matches(); visibleMatches = found; foundIds = new Set(found.map(node => node.nodeId));
    $("graph").hidden = mapMode === "overview"; $("overview").hidden = $("overview-note").hidden = mapMode !== "overview";
    renderList(found); renderTrail(); if (mapMode === "overview") renderOverview(found); else renderGraph(found); renderDetail();
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
  for (const id of ["search", "axis", "view", "include-history"]) $(id).addEventListener(id === "search" ? "input" : "change", () => { listPage = 0; render(); });
  $("records-prev").addEventListener("click", () => { listPage--; renderList(visibleMatches); });
  $("records-next").addEventListener("click", () => { listPage++; renderList(visibleMatches); });
  $("layer").addEventListener("change", () => {
    const next = $("layer").value; layerStates.set(activeGraph === data.graph ? "project" : "code", { model, selected, box: [...box], mapMode, listPage });
    activeGraph = next === "code" ? data.codeGraph : data.graph;
    const retained = layerStates.get(next); model = retained?.model || newModel(activeGraph); selected = retained?.selected || null; box = retained?.box || [0, 0, 1000, 700];
    mapMode = retained?.mapMode || "focus"; listPage = retained?.listPage || 0;
    $("view").value = "all"; $("axis").value = "all"; $("view").disabled = $("axis").disabled = next === "code";
    $("legend-left").textContent = next === "code" ? "Structural evidence" : "Code & sources"; $("legend-right").textContent = next === "code" ? "Existing imports & calls" : "Purpose & work";
    $("layer-info").textContent = next === "code" ? "Complete verified structural metadata; no synthetic Project joins. Non-current evidence is labelled separately." : "Project purpose, work and retained lineage. No Session is selected by this map.";
    $("coverage").textContent = `${activeGraph.coverage?.state || activeGraph.status || "unavailable"} · snapshot, not live`;
    const first = matches()[0]; if (!selected && first) selectNode(first); else render();
  });
  $("expand").addEventListener("click", () => { if (selected?.kind === "node") { model.expand(selected.value.nodeId); mapMode = "focus"; focusCamera(); render(); } });
  for (const [id, direction] of [["back", -1], ["forward", 1]]) $(id).addEventListener("click", () => { const target = model.travel(direction); if (target) selectNode(model.nodes.get(target), false, false); });
  $("restart").addEventListener("click", () => { if (model.current) { model.reset(model.current); mapMode = "focus"; focusCamera(); render(); } });
  $("zoom-in").addEventListener("click", () => zoom(.8)); $("zoom-out").addEventListener("click", () => zoom(1.25));
  $("focus").addEventListener("click", () => { mapMode = "focus"; focusCamera(); render(); });
  $("reset").addEventListener("click", () => { mapMode = "explored"; fit(); render(); });
  $("overview-button").addEventListener("click", () => { mapMode = "overview"; render(); });
  $("overview").addEventListener("click", event => {
    const rect = $("overview").getBoundingClientRect(), id = overviewModel().hit((event.clientX - rect.left) * 1000 / rect.width, (event.clientY - rect.top) * 700 / rect.height, foundIds);
    if (id) selectNode(model.nodes.get(id));
  });
  $("show-code-diff").addEventListener("click", () => { $("context-lineage").open = true; $("context-lineage").scrollIntoView({ block: "nearest" }); });
  const canvas = $("graph");
  function point(event) { const p = canvas.createSVGPoint(); p.x = event.clientX; p.y = event.clientY; const matrix = canvas.getScreenCTM(); return matrix ? p.matrixTransform(matrix.inverse()) : null; }
  canvas.addEventListener("wheel", event => { event.preventDefault(); zoom(event.deltaY > 0 ? 1.12 : .89); }, { passive: false });
  canvas.addEventListener("pointerdown", event => {
    if (event.button !== 0 || event.target.closest("[data-edge]")) return;
    const at = point(event); if (!at) return;
    const node = event.target.closest("[data-node]"); drag = { id: node?.getAttribute("data-node"), at, clientX: event.clientX, clientY: event.clientY, box: [...box], moved: false };
    if (!node) canvas.setPointerCapture(event.pointerId); suppressClick = false;
  });
  canvas.addEventListener("pointermove", event => {
    if (!drag) return;
    if (Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) < 5 && !drag.moved) return;
    const at = point(event); if (!at) return; if (!drag.moved && drag.id) canvas.setPointerCapture(event.pointerId); drag.moved = true;
    if (drag.id) model.move(drag.id, at.x, at.y);
    else { box = [box[0] - (at.x - drag.at.x), box[1] - (at.y - drag.at.y), ...box.slice(2)]; setBox(); }
    redrawCamera();
  });
  canvas.addEventListener("pointerup", () => { const moved = drag?.moved; drag = null; suppressClick = Boolean(moved); if (moved) setTimeout(() => { suppressClick = false; }, 0); });
  canvas.addEventListener("pointercancel", () => { drag = null; suppressClick = false; });
  canvas.addEventListener("keydown", event => { if (event.target !== canvas) return; const delta = { ArrowLeft: [-50, 0], ArrowRight: [50, 0], ArrowUp: [0, -50], ArrowDown: [0, 50] }[event.key]; if (delta) { event.preventDefault(); box[0] += delta[0]; box[1] += delta[1]; setBox(); redrawCamera(); } });
  if (typeof matchMedia === "function" && matchMedia("(max-width:650px)").matches) $("display-options").open = false;
  const first = matches().find(node => node.nodeId === activeGraph.initialNodeId) || matches()[0];
  if (first) selectNode(first); else render();
  document.documentElement.dataset.explorerReady = "true"; document.documentElement.dataset.explorerInitialRenderMs = String(performance.now() - initialTime);
})();
