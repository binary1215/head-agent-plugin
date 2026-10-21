import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
const source = fs.readFileSync(new URL("../scripts/graph-explorer/exploration.js", import.meta.url), "utf8");

test("all 60000 metadata IDs stay searchable while layout measures only explored neighbors", () => {
  const factory = vm.runInNewContext(source + "\nexplorerModel");
  const nodes = Array.from({ length: 60000 }, (_, i) => ({ nodeId: `generic-${i}`, kind: "File", path: `src/generic-${i}.mjs` }));
  const graph = { nodes, edges: nodes.slice(1).map((node, i) => ({ edgeId: `e${i}`, from: nodes[i].nodeId, to: node.nodeId })) };
  let measurements = 0;
  const model = factory.create(graph, () => "code", () => { measurements++; return { left: 155, right: 155, top: 44, bottom: 84 }; });
  assert.equal(model.nodes.size, 60000); assert.equal(measurements, 0);
  for (const id of ["generic-64", "generic-500", "generic-59999"]) {
    assert(model.search(`"${id}"`).some(node => node.nodeId === id)); assert(model.visit(id));
  }
  assert(measurements < 20); assert.equal(model.nodes.size, 60000);
});

test("1000 direct neighbors remain reachable and disjoint without an all-inventory scan for each placement", () => {
  const factory = vm.runInNewContext(source + "\nexplorerModel");
  const nodes = Array.from({ length: 1001 }, (_, i) => ({ nodeId: String(i), kind: i % 2 ? "File" : "Feature" }));
  const graph = { nodes, edges: nodes.slice(1).map(node => ({ from: "0", to: node.nodeId, type: "LINK" })) };
  const model = factory.create(graph, node => node.kind === "File" ? "code" : "context");
  assert(model.visit("0")); assert.equal(model.visible.size, nodes.length); assert.equal(model.neighbors("0").length, 1000);
  const retained = [...model.positions].map(([id, point]) => [id, { ...point }]);
  for (let a = 0; a < retained.length; a++) for (let b = a + 1; b < retained.length; b++) {
    const p = retained[a][1], q = retained[b][1];
    assert(!(p.x - 155 < q.x + 155 && p.x + 155 > q.x - 155 && p.y - 44 < q.y + 84 && p.y + 84 > q.y - 44));
  }
  model.visit("1");
  for (const [id, point] of retained) assert.deepEqual({ ...model.positions.get(id) }, point);
});
