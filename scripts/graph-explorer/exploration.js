// Private display state, bundled inline. No persistence, repository effects or inferred edges.
const explorerModel = (() => {
  function create(graph, axisFor = () => "context", extentFor = () => ({ left: 155, right: 155, top: 44, bottom: 84 })) {
    const nodes = new Map(graph.nodes.map(node => [node.nodeId, node]));
    const positions = new Map(), visible = new Set(), pinned = new Set(), history = [];
    const extents = new Map([...nodes].map(([id, node]) => {
      const measured = extentFor(node), extent = {};
      for (const side of ["left", "right", "top", "bottom"]) extent[side] = Number.isFinite(measured?.[side]) && measured[side] > 0 ? measured[side] : side === "top" ? 44 : side === "bottom" ? 84 : 155;
      return [id, extent];
    }));
    const stepX = Math.max(155, ...[...extents.values()].map(e => e.left)) + Math.max(155, ...[...extents.values()].map(e => e.right));
    const stepY = Math.max(44, ...[...extents.values()].map(e => e.top)) + Math.max(84, ...[...extents.values()].map(e => e.bottom));
    let cursor = -1;
    const links = id => graph.edges.filter(edge => edge.from === id || edge.to === id);
    const neighbors = id => [...new Set(links(id).flatMap(edge => [edge.from, edge.to]))].filter(other => other !== id && nodes.has(other));
    function free(id, point) {
      const e = extents.get(id);
      for (const [other, p] of positions) {
        if (other === id) continue;
        const o = extents.get(other);
        if (point.x - e.left < p.x + o.right && point.x + e.right > p.x - o.left
          && point.y - e.top < p.y + o.bottom && point.y + e.bottom > p.y - o.top) return false;
      }
      return true;
    }
    function place(id, center, sign = 1) {
      const horizontal = axisFor(nodes.get(id)) === "code", primaryStep = horizontal ? stepX : stepY, secondaryStep = horizontal ? stepY : stepX;
      let best = null, bestCost = Infinity;
      // Each existing footprint can block at most two full-width/height
      // slots on the primary ray. 2N+1 slots therefore include a free one.
      // Prefer nearer sideways lanes when available; never move old nodes.
      for (let band = 0; band <= positions.size * 2; band++) {
        const primary = Math.max(horizontal ? 240 : 210, primaryStep) + band * primaryStep;
        if (primary * primary >= bestCost) break;
        const lanes = Math.min(positions.size, Math.floor(primary / secondaryStep));
        for (let lane = 0; lane <= lanes; lane++) for (const side of lane ? [1, -1] : [1]) {
          const secondary = lane * secondaryStep * side, cost = primary * primary + secondary * secondary;
          if (cost >= bestCost) continue;
          const point = horizontal ? { x: center.x + sign * primary, y: center.y + secondary }
            : { x: center.x + secondary, y: center.y + sign * primary };
          if (free(id, point)) { best = point; bestCost = cost; }
        }
      }
      // This is a display placement algorithm, not an evidence/admission gate.
      // The finite occupied inventory guarantees a free primary-ray slot.
      positions.set(id, best);
    }
    function expand(id) {
      if (!nodes.has(id)) return;
      if (!positions.has(id)) {
        const origin = { x: 500, y: 350 };
        if (free(id, origin)) positions.set(id, origin); else place(id, positions.get(history[cursor]) || origin);
      }
      const center = positions.get(id); visible.add(id);
      const additions = neighbors(id).filter(other => !positions.has(other));
      // Place only new neighbors. Previously explored/pinned nodes never jump on selection.
      additions.forEach(other => {
        const outgoing = links(id).some(edge => edge.from === id && edge.to === other), sign = outgoing ? 1 : -1;
        place(other, center, sign);
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
    function move(id, x, y) { if (!nodes.has(id) || !Number.isFinite(x) || !Number.isFinite(y)) return; positions.set(id, { x, y }); pinned.add(id); }
    function reset(id) { visible.clear(); positions.clear(); pinned.clear(); history.length = 0; cursor = -1; visit(id); }
    return { nodes, positions, visible, pinned, history, neighbors, links, expand, visit, travel, move, reset,
      get cursor() { return cursor; }, get current() { return history[cursor] ?? null; } };
  }
  return { create };
})();
