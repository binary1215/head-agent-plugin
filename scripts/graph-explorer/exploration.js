// Private display state, bundled inline. No persistence, repository effects or inferred edges.
const explorerModel = (() => {
  function create(graph, axisFor = () => "context", extentFor = () => ({ left: 155, right: 155, top: 44, bottom: 84 }), anchorFor = () => null) {
    const nodes = new Map(graph.nodes.map(node => [node.nodeId, node]));
    const positions = new Map(), visible = new Set(), pinned = new Set(), history = [];
    const chosen = new Set(), baseVisible = new Set();
    let focusId = null, steps = [], frontier = [], processed = new Set(), expansionKey = null, selectionVersion = 0;
    const searchText = new Map();
    const cells = new Map(), occupied = new Map();
    const extents = new Map(), adjacency = new Map();
    const live = { positions, cells, occupied, extents, maxLeft: 155, maxRight: 155, maxTop: 44, maxBottom: 84 };
    let geometryVersion = 0;
    function extent(id, space = live) {
      if (space.extents.has(id)) return space.extents.get(id);
      const measured = extentFor(nodes.get(id)), value = {};
      for (const side of ["left", "right", "top", "bottom"]) value[side] = Number.isFinite(measured?.[side]) && measured[side] > 0 ? measured[side] : side === "top" ? 44 : side === "bottom" ? 84 : 155;
      space.extents.set(id, value); space.maxLeft = Math.max(space.maxLeft, value.left); space.maxRight = Math.max(space.maxRight, value.right);
      space.maxTop = Math.max(space.maxTop, value.top); space.maxBottom = Math.max(space.maxBottom, value.bottom); return value;
    }
    for (const edge of graph.edges) for (const id of new Set([edge.from, edge.to])) {
      if (!adjacency.has(id)) adjacency.set(id, []); adjacency.get(id).push(edge);
    }
    let cursor = -1;
    const links = id => adjacency.get(id) || [];
    const neighbors = id => [...new Set(links(id).flatMap(edge => [edge.from, edge.to]))].filter(other => other !== id && nodes.has(other));
    function cellKeys(id, point, space = live) {
      const e = extent(id, space), keys = [];
      const left = Math.floor((point.x - e.left) / 320), right = Math.floor((point.x + e.right) / 320);
      const top = Math.floor((point.y - e.top) / 160), bottom = Math.floor((point.y + e.bottom) / 160);
      for (let x = 0; x <= right - left; x++) for (let y = 0; y <= bottom - top; y++) keys.push(`${left + x},${top + y}`);
      return keys;
    }
    function put(id, point, space = live) {
      for (const key of space.occupied.get(id) || []) { const cell = space.cells.get(key); cell.delete(id); if (!cell.size) space.cells.delete(key); }
      const keys = cellKeys(id, point, space); space.occupied.set(id, keys); space.positions.set(id, point);
      for (const key of keys) { if (!space.cells.has(key)) space.cells.set(key, new Set()); space.cells.get(key).add(id); }
      if (space === live) geometryVersion++;
    }
    function free(id, point, space = live) {
      const e = extent(id, space);
      const nearby = new Set(cellKeys(id, point, space).flatMap(key => [...(space.cells.get(key) || [])]));
      for (const other of nearby) {
        if (other === id) continue;
        const p = space.positions.get(other), o = extent(other, space);
        if (point.x - e.left < p.x + o.right && point.x + e.right > p.x - o.left
          && point.y - e.top < p.y + o.bottom && point.y + e.bottom > p.y - o.top) return false;
      }
      return true;
    }
    function placer(center, horizontal, sign = 1, space = live) {
      const stepX = space.maxLeft + space.maxRight + 18, stepY = space.maxTop + space.maxBottom + 18;
      const primaryStep = Math.max(horizontal ? 240 : 210, horizontal ? stepX : stepY), secondaryStep = horizontal ? stepY : stepX;
      let band = 1, slot = 0;
      return id => {
        // One monotone cursor per expansion fan; occupied slots are not
        // rescanned for every neighbor. There is no evidence/count cutoff.
        for (;;) {
          const lanes = Math.max(1, Math.floor(band * primaryStep / (2 * secondaryStep)));
          if (slot >= 2 * lanes) { band++; slot = 0; continue; }
          const lane = (Math.floor(slot / 2) + .5) * (slot % 2 ? 1 : -1);
          slot++;
          const primary = band * primaryStep, secondary = lane * secondaryStep;
          const point = horizontal ? { x: center.x + sign * primary, y: center.y + secondary }
            : { x: center.x + secondary, y: center.y + sign * primary };
          if (free(id, point, space)) { put(id, point, space); return; }
        }
      };
    }
    function expand(id, { placeNeighbors = true } = {}) {
      if (!nodes.has(id)) return;
      if (!positions.has(id)) {
        const origin = { x: 500, y: 350 };
        if (free(id, origin)) put(id, origin); else placer(positions.get(history[cursor]) || origin, axisFor(nodes.get(id)) === "code")(id);
      }
      const center = positions.get(id); visible.add(id);
      const additions = placeNeighbors ? neighbors(id).filter(other => !positions.has(other)) : [];
      additions.forEach(id => extent(id));
      const fans = new Map(), outgoing = new Set(links(id).filter(edge => edge.from === id).map(edge => edge.to));
      // Place only new neighbors. Previously explored/pinned nodes never jump on selection.
      additions.forEach(other => {
        const horizontal = axisFor(nodes.get(other)) === "code", sign = outgoing.has(other) ? 1 : -1, key = `${horizontal}:${sign}`;
        const anchor = anchorFor(other, positions), groupedKey = `${key}:${anchor || ""}`;
        if (!fans.has(groupedKey)) fans.set(groupedKey, placer(positions.get(anchor) || center, horizontal, sign)); fans.get(groupedKey)(other);
      });
      neighbors(id).forEach(other => visible.add(other));
    }
    function visit(id, record = true, options) {
      if (!nodes.has(id)) return false;
      expand(id, options);
      for (const shown of visible) baseVisible.add(shown);
      focusId = id;
      if (record && history[cursor] !== id) { history.splice(cursor + 1); history.push(id); cursor = history.length - 1; }
      return true;
    }
    function travel(delta) {
      const next = cursor + delta;
      if (next < 0 || next >= history.length) return null;
      cursor = next; focusId = history[cursor]; expand(history[cursor]); return history[cursor];
    }
    function move(id, x, y) { if (!nodes.has(id) || !Number.isFinite(x) || !Number.isFinite(y)) return; put(id, { x, y }); pinned.add(id); }
    function reset(id, options) { visible.clear(); baseVisible.clear(); chosen.clear(); steps = []; frontier = []; processed.clear(); expansionKey = null;
      positions.clear(); cells.clear(); occupied.clear(); extents.clear(); pinned.clear(); history.length = 0; cursor = -1; visit(id, true, options); }
    function place(id, near = focusId) {
      if (!nodes.has(id) || positions.has(id)) return;
      extent(id); const origin = positions.get(anchorFor(id, positions) || near) || { x: 500, y: 350 };
      if (free(id, origin)) put(id, origin); else placer(origin, axisFor(nodes.get(id)) === "code")(id);
    }
    function rebuildVisible() {
      visible.clear();
      for (const id of baseVisible) visible.add(id);
      for (const step of steps) for (const id of step.nodes) visible.add(id);
      for (const id of chosen) visible.add(id);
      for (const id of pinned) visible.add(id);
    }
    function choose(id, { toggle = false, only = false, position = true } = {}) {
      if (!nodes.has(id)) return false;
      const changed = only ? chosen.size !== 1 || !chosen.has(id) : toggle || !chosen.has(id);
      if (only) chosen.clear();
      if (toggle && chosen.has(id)) chosen.delete(id);
      else { chosen.add(id); baseVisible.add(id); if (position) place(id); }
      focusId = chosen.has(id) ? id : chosen.has(focusId) ? focusId : chosen.values().next().value || null;
      if (changed) selectionVersion++;
      if (changed) rebuildVisible(); return true;
    }
    function clearSelection() { if (chosen.size) selectionVersion++; chosen.clear(); focusId = null; rebuildVisible(); }
    function reveal(id) { if (!nodes.has(id)) return; place(id); baseVisible.add(id); visible.add(id); }
    async function chooseBatch(ids, { position = false, cancelled = () => false, yieldWork = async () => {} } = {}) {
      const valid = []; let inspected = 0;
      for (const id of ids) { if (nodes.has(id)) valid.push(id); if (++inspected % 512 === 0) { await yieldWork(); if (cancelled()) return false; } }
      if (position && !await placeBatch(valid, { cancelled, yieldWork })) return false;
      if (cancelled()) return false;
      let changed = false;
      for (const id of valid) { if (!chosen.has(id)) changed = true; chosen.add(id); baseVisible.add(id); focusId = id; }
      if (changed) selectionVersion++; rebuildVisible(); return true;
    }
    const capture = () => ({ chosen: [...chosen], focusId, base: [...baseVisible], steps: [...steps], frontier: [...frontier], processed: [...processed], expansionKey });
    function restore(state) {
      chosen.clear(); state.chosen.forEach(id => chosen.add(id)); focusId = state.focusId;
      baseVisible.clear(); state.base.forEach(id => baseVisible.add(id));
      steps = [...state.steps]; frontier = [...state.frontier]; processed = new Set(state.processed); expansionKey = state.expansionKey; selectionVersion++; rebuildVisible();
    }
    function collapse() {
      const step = steps.pop(); if (!step) return null;
      frontier = [...step.before.frontier]; processed = new Set(step.before.processed); expansionKey = step.before.expansionKey;
      rebuildVisible(); return step;
    }
    function draft() {
      return { ...live, positions: new Map(positions), cells: new Map([...cells].map(([key, ids]) => [key, new Set(ids)])),
        occupied: new Map(occupied), extents: new Map(extents) };
    }
    function commit(space, basis) {
      if (geometryVersion !== basis) return false;
      for (const field of ["positions", "cells", "occupied", "extents"]) { live[field].clear(); for (const [key, value] of space[field]) live[field].set(key, value); }
      for (const field of ["maxLeft", "maxRight", "maxTop", "maxBottom"]) live[field] = space[field];
      geometryVersion++; return true;
    }
    async function placeBatch(ids, { cancelled = () => false, yieldWork = async () => {} } = {}) {
      const space = draft(), basis = geometryVersion;
      const additions = [...ids].filter(id => nodes.has(id) && !positions.has(id));
      for (let i = 0; i < additions.length; i++) { extent(additions[i], space); if (i % 32 === 31) { await yieldWork(); if (cancelled() || basis !== geometryVersion) return false; } }
      const center = positions.get(focusId) || { x: 500, y: 350 }, fans = new Map();
      for (let i = 0; i < additions.length; i++) {
        const id = additions[i], horizontal = axisFor(nodes.get(id)) === "code";
        const anchor = anchorFor(id, space.positions), key = `${horizontal}:${anchor || ""}`;
        if (!fans.has(key)) fans.set(key, placer(space.positions.get(anchor) || center, horizontal, 1, space));
        fans.get(key)(id);
        if (i % 256 === 255) { await yieldWork(); if (cancelled()) return false; }
      }
      return !cancelled() && commit(space, basis);
    }
    async function remeasure(ids, { cancelled = () => false, yieldWork = async () => {}, yieldBeforeCommit = false, onCommit = () => {}, area = null } = {}) {
      const requested = new Set([...ids].filter(id => positions.has(id))), affected = new Set(), basis = geometryVersion, space = draft();
      let count = 0;
      for (const id of requested) {
        const previous = extent(id); space.extents.delete(id); const next = extent(id, space);
        if (["left", "right", "top", "bottom"].some(side => next[side] !== previous[side])) affected.add(id);
        if (++count % 32 === 0) { await yieldWork(); if (cancelled() || basis !== geometryVersion) return false; }
      }
      space.positions.clear(); space.cells.clear(); space.occupied.clear();
      // Pins and unaffected coordinates always win. Manual pinned overlap stays
      // visible, never silently corrected; full reading cards remain available.
      for (const [id, point] of positions) if (pinned.has(id) || !affected.has(id)) put(id, point, space);
      count = 0;
      for (const [id, point] of positions) if (affected.has(id) && !pinned.has(id)) {
        let preferred = null;
        if (area) {
          const e = extent(id, space), left = area.left + e.left, right = area.right - e.right, top = area.top + e.top, bottom = area.bottom - e.bottom;
          if (left <= right && top <= bottom) {
            const xs = new Set([Math.max(left, Math.min(right, point.x)), left, right]), ys = new Set([Math.max(top, Math.min(bottom, point.y)), top, bottom]);
            for (let x = left; x <= right; x += Math.max(e.left + e.right + 18, (right - left) / 32)) xs.add(x);
            for (let y = top; y <= bottom; y += Math.max(e.top + e.bottom + 18, (bottom - top) / 32)) ys.add(y);
            const candidates = [...xs].flatMap(x => [...ys].map(y => ({ x, y }))).sort((a, b) => Math.hypot(a.x - point.x, a.y - point.y) - Math.hypot(b.x - point.x, b.y - point.y));
            preferred = candidates.find(candidate => free(id, candidate, space));
          }
        }
        if (preferred) put(id, preferred, space); else if (free(id, point, space)) put(id, point, space); else placer(point, axisFor(nodes.get(id)) === "code", 1, space)(id);
        if (++count % 256 === 0) { await yieldWork(); if (cancelled() || basis !== geometryVersion) return false; }
      }
      if (yieldBeforeCommit) { await yieldWork(); if (cancelled() || basis !== geometryVersion) return false; }
      const applied = !cancelled() && commit(space, basis); if (applied) onCommit(); return applied;
    }
    async function expandWave({ key = "", allowed = () => true, edgeAllowed = () => true, cancelled = () => false, yieldWork = async () => {}, progress = () => {} } = {}) {
      const scope = JSON.stringify([[...chosen], key]);
      const before = { frontier: [...frontier], processed: [...processed], expansionKey };
      let pending = expansionKey === scope ? [...frontier] : [...chosen].filter(id => allowed(nodes.get(id)));
      const visited = expansionKey === scope ? new Set(processed) : new Set(), contributed = new Set(), edges = new Set();
      let reads = 0;
      while (pending.length) {
        const next = new Set();
        for (const id of pending) {
          if (visited.has(id) || !allowed(nodes.get(id))) continue;
          visited.add(id); contributed.add(id);
          for (const edge of links(id)) {
            if (!edgeAllowed(edge)) continue;
            const other = edge.from === id ? edge.to : edge.from;
            if (!nodes.has(other) || !allowed(nodes.get(other))) continue;
            contributed.add(other); edges.add(edge); if (!visited.has(other)) next.add(other);
            if (++reads % 512 === 0) { progress({ examinedEdges: reads }); await yieldWork(); if (cancelled()) return { status: "cancelled" }; }
          }
        }
        pending = [...next];
        if ([...contributed].some(id => !visible.has(id))) break;
      }
      const additions = [...contributed].filter(id => !visible.has(id));
      if (!await placeBatch([...contributed].filter(id => !positions.has(id)), { cancelled, yieldWork })) return { status: "cancelled" };
      if (cancelled()) return { status: "cancelled" };
      frontier = pending; processed = visited; expansionKey = scope;
      const step = { kind: "expand", nodes: contributed, edges, before, added: additions.length, examinedEdges: reads };
      if (contributed.size) steps.push(step); rebuildVisible();
      return { status: pending.length ? "expanded" : "complete", added: additions.length, edges: edges.size, frontier: pending.length, examinedEdges: reads };
    }
    async function connectSelection({ allowed = () => true, edgeAllowed = () => true, cancelled = () => false, yieldWork = async () => {}, reference = focusId } = {}) {
      const selected = [...chosen].filter(id => allowed(nodes.get(id))), selectedSet = new Set(selected), visited = new Set();
      const result = { status: "complete", nodes: new Set(), edges: new Set(), roots: [], selected: [...chosen], outsideScope: [...chosen].filter(id => !selectedSet.has(id)), inspectedEdges: 0, inspectedNodes: 0 };
      const seeds = selectedSet.has(reference) ? [reference, ...selected.filter(id => id !== reference)] : selected;
      for (const root of seeds) {
        if (visited.has(root)) continue;
        const distance = new Map([[root, 0]]), predecessors = new Map(), queue = [root], targets = [];
        visited.add(root);
        for (let index = 0; index < queue.length; index++) {
          const id = queue[index]; if (selectedSet.has(id)) targets.push(id);
          if (++result.inspectedNodes % 512 === 0) { await yieldWork(); if (cancelled()) return { status: "cancelled" }; }
          for (const edge of links(id)) {
            if (!edgeAllowed(edge)) continue;
            const other = edge.from === id ? edge.to : edge.from;
            if (!nodes.has(other) || !allowed(nodes.get(other))) continue;
            const depth = distance.get(id) + 1;
            if (!distance.has(other)) { distance.set(other, depth); visited.add(other); queue.push(other); predecessors.set(other, []); }
            if (distance.get(other) === depth) predecessors.get(other).push({ id, edge });
            if (++result.inspectedEdges % 512 === 0) { await yieldWork(); if (cancelled()) return { status: "cancelled" }; }
          }
        }
        result.roots.push({ root, targets });
        const pending = [...targets], traced = new Set();
        while (pending.length) {
          const id = pending.pop(); if (traced.has(id)) continue; traced.add(id); result.nodes.add(id);
          for (const prior of predecessors.get(id) || []) { result.edges.add(prior.edge); pending.push(prior.id); }
          if (traced.size % 512 === 0) { await yieldWork(); if (cancelled()) return { status: "cancelled" }; }
        }
      }
      return cancelled() ? { status: "cancelled" } : result;
    }
    async function showConnections(result, { cancelled = () => false, yieldWork = async () => {} } = {}) {
      if (!await placeBatch(result.nodes, { cancelled, yieldWork })) return false;
      if (cancelled()) return false;
      steps.push({ kind: "connections", nodes: result.nodes, edges: result.edges, before: { frontier: [...frontier], processed: [...processed], expansionKey } });
      rebuildVisible(); return true;
    }
    function search(query, candidates = graph.nodes) {
      const folded = String(query || "").trim().toLocaleLowerCase();
      if (!folded) return candidates;
      return candidates.filter(node => {
        if (!searchText.has(node.nodeId)) searchText.set(node.nodeId, JSON.stringify(node).toLocaleLowerCase());
        return searchText.get(node.nodeId).includes(folded);
      });
    }
    return { nodes, positions, visible, pinned, history, neighbors, links, expand, visit, travel, move, reset, search,
      chosen, choose, chooseBatch, clearSelection, reveal, place, placeBatch, remeasure, extent, capture, restore, collapse, expandWave, connectSelection, showConnections,
      get selectionVersion() { return selectionVersion; },
      get steps() { return steps; }, get focus() { return focusId; },
      get cursor() { return cursor; }, get current() { return focusId ?? history[cursor] ?? null; } };
  }
  function overview(graph, axisFor = () => "context") {
    const points = new Map(), cells = new Map(), groups = [[], []];
    for (const node of graph.nodes) groups[axisFor(node) === "code" ? 0 : 1].push(node);
    const both = groups.every(group => group.length);
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      const group = groups[groupIndex], left = both && groupIndex ? 515 : 25, width = both ? 460 : 950;
      const columns = Math.max(1, Math.ceil(Math.sqrt(group.length * width / 640))), rows = Math.max(1, Math.ceil(group.length / columns));
      group.forEach((node, index) => {
        const point = { x: left + (index % columns + .5) * width / columns, y: 30 + (Math.floor(index / columns) + .5) * 640 / rows };
        points.set(node.nodeId, point);
        const key = `${Math.floor(point.x / 8)},${Math.floor(point.y / 8)}`;
        if (!cells.has(key)) cells.set(key, []); cells.get(key).push(node.nodeId);
      });
    }
    function hit(x, y, included, radius = 8) {
      let best = null, distance = radius;
      const cellX = Math.floor(x / 8), cellY = Math.floor(y / 8);
      const span = Math.ceil(radius / 8), candidates = [];
      if (!Number.isFinite(span) || (2 * span + 1) ** 2 > cells.size) for (const id of points.keys()) candidates.push(id);
      else for (let dx = -span; dx <= span; dx++) for (let dy = -span; dy <= span; dy++) candidates.push(...(cells.get(`${cellX + dx},${cellY + dy}`) || []));
      for (const id of candidates) {
          if (included && !included.has(id)) continue;
          const p = points.get(id), d = Math.hypot(p.x - x, p.y - y);
          if (d < distance) { best = id; distance = d; }
      }
      return best;
    }
    function move(id, x, y) {
      const old = points.get(id); if (!old) return;
      const oldKey = `${Math.floor(old.x / 8)},${Math.floor(old.y / 8)}`;
      const group = cells.get(oldKey); if (group) { const index = group.indexOf(id); if (index >= 0) group.splice(index, 1); if (!group.length) cells.delete(oldKey); }
      points.set(id, { x, y }); const key = `${Math.floor(x / 8)},${Math.floor(y / 8)}`;
      if (!cells.has(key)) cells.set(key, []); cells.get(key).push(id);
    }
    return { points, hit, move };
  }
  function viewport(box, rect) {
    const scale = Math.min(rect.width / box[2], rect.height / box[3]);
    const left = (rect.width - box[2] * scale) / 2, top = (rect.height - box[3] * scale) / 2;
    return { scale, left, top,
      fromClient: (x, y) => ({ x: box[0] + (x - rect.left - left) / scale, y: box[1] + (y - rect.top - top) / scale }),
      toClient: (x, y) => ({ x: rect.left + left + (x - box[0]) * scale, y: rect.top + top + (y - box[1]) * scale }) };
  }
  function lineDelta(before, after) {
    const a = before.text ? before.text.split("\n") : [], b = after.text ? after.text.split("\n") : [];
    if (a.length > 161 || b.length > 161 || before.text.length > 32768 || after.text.length > 32768)
      return { status: "unavailable", reasonCode: "COMPARISON_EXCERPT_BOUND", lines: [] };
    const width = b.length + 1, table = new Uint16Array((a.length + 1) * width);
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
      table[i * width + j] = a[i] === b[j] ? 1 + table[(i + 1) * width + j + 1]
        : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    const lines = []; let i = 0, j = 0;
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) {
        lines.push({ kind: "context", beforeLine: before.startLine + i, afterLine: after.startLine + j, text: a[i] }); i++; j++;
      } else if (i < a.length && (j === b.length || table[(i + 1) * width + j] >= table[i * width + j + 1])) {
        lines.push({ kind: "removed", beforeLine: before.startLine + i, text: a[i] }); i++;
      } else { lines.push({ kind: "added", afterLine: after.startLine + j, text: b[j] }); j++; }
    }
    return { status: "bounded-excerpt-comparison", lines };
  }
  return { create, overview, viewport, lineDelta };
})();
