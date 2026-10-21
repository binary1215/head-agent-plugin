// Private display state, bundled inline. No persistence, repository effects or inferred edges.
const explorerModel = (() => {
  function create(graph, axisFor = () => "context", extentFor = () => ({ left: 155, right: 155, top: 44, bottom: 84 })) {
    const nodes = new Map(graph.nodes.map(node => [node.nodeId, node]));
    const positions = new Map(), visible = new Set(), pinned = new Set(), history = [];
    const searchText = new Map();
    const cells = new Map(), occupied = new Map();
    const extents = new Map(), adjacency = new Map();
    let maxLeft = 155, maxRight = 155, maxTop = 44, maxBottom = 84;
    function extent(id) {
      if (extents.has(id)) return extents.get(id);
      const measured = extentFor(nodes.get(id)), value = {};
      for (const side of ["left", "right", "top", "bottom"]) value[side] = Number.isFinite(measured?.[side]) && measured[side] > 0 ? measured[side] : side === "top" ? 44 : side === "bottom" ? 84 : 155;
      extents.set(id, value); maxLeft = Math.max(maxLeft, value.left); maxRight = Math.max(maxRight, value.right);
      maxTop = Math.max(maxTop, value.top); maxBottom = Math.max(maxBottom, value.bottom); return value;
    }
    for (const edge of graph.edges) for (const id of new Set([edge.from, edge.to])) {
      if (!adjacency.has(id)) adjacency.set(id, []); adjacency.get(id).push(edge);
    }
    let cursor = -1;
    const links = id => adjacency.get(id) || [];
    const neighbors = id => [...new Set(links(id).flatMap(edge => [edge.from, edge.to]))].filter(other => other !== id && nodes.has(other));
    function cellKeys(id, point) {
      const e = extent(id), keys = [];
      const left = Math.floor((point.x - e.left) / 320), right = Math.floor((point.x + e.right) / 320);
      const top = Math.floor((point.y - e.top) / 160), bottom = Math.floor((point.y + e.bottom) / 160);
      for (let x = 0; x <= right - left; x++) for (let y = 0; y <= bottom - top; y++) keys.push(`${left + x},${top + y}`);
      return keys;
    }
    function put(id, point) {
      for (const key of occupied.get(id) || []) { const cell = cells.get(key); cell.delete(id); if (!cell.size) cells.delete(key); }
      const keys = cellKeys(id, point); occupied.set(id, keys); positions.set(id, point);
      for (const key of keys) { if (!cells.has(key)) cells.set(key, new Set()); cells.get(key).add(id); }
    }
    function free(id, point) {
      const e = extent(id);
      const nearby = new Set(cellKeys(id, point).flatMap(key => [...(cells.get(key) || [])]));
      for (const other of nearby) {
        if (other === id) continue;
        const p = positions.get(other), o = extent(other);
        if (point.x - e.left < p.x + o.right && point.x + e.right > p.x - o.left
          && point.y - e.top < p.y + o.bottom && point.y + e.bottom > p.y - o.top) return false;
      }
      return true;
    }
    function placer(center, horizontal, sign = 1) {
      const stepX = maxLeft + maxRight, stepY = maxTop + maxBottom;
      const primaryStep = Math.max(horizontal ? 240 : 210, horizontal ? stepX : stepY), secondaryStep = horizontal ? stepY : stepX;
      let band = 1, slot = 0;
      return id => {
        // One monotone cursor per expansion fan; occupied slots are not
        // rescanned for every neighbor. There is no evidence/count cutoff.
        for (;;) {
          const lanes = Math.floor(band * primaryStep / (2 * secondaryStep));
          if (slot > 2 * lanes) { band++; slot = 0; continue; }
          const lane = slot ? Math.ceil(slot / 2) * (slot % 2 ? 1 : -1) : 0;
          slot++;
          const primary = band * primaryStep, secondary = lane * secondaryStep;
          const point = horizontal ? { x: center.x + sign * primary, y: center.y + secondary }
            : { x: center.x + secondary, y: center.y + sign * primary };
          if (free(id, point)) { put(id, point); return; }
        }
      };
    }
    function expand(id) {
      if (!nodes.has(id)) return;
      if (!positions.has(id)) {
        const origin = { x: 500, y: 350 };
        if (free(id, origin)) put(id, origin); else placer(positions.get(history[cursor]) || origin, axisFor(nodes.get(id)) === "code")(id);
      }
      const center = positions.get(id); visible.add(id);
      const additions = neighbors(id).filter(other => !positions.has(other));
      additions.forEach(extent);
      const fans = new Map(), outgoing = new Set(links(id).filter(edge => edge.from === id).map(edge => edge.to));
      // Place only new neighbors. Previously explored/pinned nodes never jump on selection.
      additions.forEach(other => {
        const horizontal = axisFor(nodes.get(other)) === "code", sign = outgoing.has(other) ? 1 : -1, key = `${horizontal}:${sign}`;
        if (!fans.has(key)) fans.set(key, placer(center, horizontal, sign)); fans.get(key)(other);
      });
      neighbors(id).forEach(other => visible.add(other));
    }
    function visit(id, record = true) {
      if (!nodes.has(id)) return false;
      expand(id);
      if (record && history[cursor] !== id) { history.splice(cursor + 1); history.push(id); cursor = history.length - 1; }
      return true;
    }
    function travel(delta) {
      const next = cursor + delta;
      if (next < 0 || next >= history.length) return null;
      cursor = next; expand(history[cursor]); return history[cursor];
    }
    function move(id, x, y) { if (!nodes.has(id) || !Number.isFinite(x) || !Number.isFinite(y)) return; put(id, { x, y }); pinned.add(id); }
    function reset(id) { visible.clear(); positions.clear(); cells.clear(); occupied.clear(); pinned.clear(); history.length = 0; cursor = -1; visit(id); }
    function search(query, candidates = graph.nodes) {
      const folded = String(query || "").trim().toLocaleLowerCase();
      if (!folded) return candidates;
      return candidates.filter(node => {
        if (!searchText.has(node.nodeId)) searchText.set(node.nodeId, JSON.stringify(node).toLocaleLowerCase());
        return searchText.get(node.nodeId).includes(folded);
      });
    }
    return { nodes, positions, visible, pinned, history, neighbors, links, expand, visit, travel, move, reset, search,
      get cursor() { return cursor; }, get current() { return history[cursor] ?? null; } };
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
    function hit(x, y, included) {
      let best = null, distance = 8;
      const cellX = Math.floor(x / 8), cellY = Math.floor(y / 8);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++)
        for (const id of cells.get(`${cellX + dx},${cellY + dy}`) || []) {
          if (included && !included.has(id)) continue;
          const p = points.get(id), d = Math.hypot(p.x - x, p.y - y);
          if (d < distance) { best = id; distance = d; }
        }
      return best;
    }
    return { points, hit };
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
  return { create, overview, lineDelta };
})();
