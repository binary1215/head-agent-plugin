import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeProject, inspectProject } from "../scripts/lib/head-core.mjs";
import { createBoundedWorkerDispatch } from "../scripts/lib/bounded-worker-dispatch.mjs";
import { runCommand } from "../scripts/head.mjs";
import { dispatch, catalogTools } from "../scripts/mcp-server.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
function fixture(t) {
  const parent = fs.realpathSync(process.env.HEAD_AGENT_TEST_TMP || os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, "head-execution-means-"));
  t.after(() => { assert.equal(path.dirname(root), parent); assert(path.basename(root).startsWith("head-execution-means-")); fs.rmSync(root, { recursive: true }); });
  initializeProject({ root, pluginRoot, runtimes: ["codex"] });
  return root;
}
function snapshot(root) {
  const files = {};
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else files[path.relative(root, file)] = fs.readFileSync(file).toString("base64");
    }
  }
  visit(path.join(root, ".head")); return files;
}

test("static execution help needs no initialized project or classifier and grants no permission", () => {
  const help = runCommand(["help"]), guidance = help.executionMeans;
  assert.equal(guidance.default, "head-direct");
  assert.equal(guidance.delegation, "existing-host-tools-when-useful");
  assert.equal(guidance.managedSelectionIsAutomatic, false);
  assert.equal(guidance.requiresUserSelection, false);
  assert.equal(guidance.grantsPermission, false);
  assert.deepEqual(guidance.hostFallback, ["head-direct", "sequential"]);
  assert.equal(guidance.fallbackCondition, "not-started-or-confirmed-no-remaining-effects");
  assert.equal(guidance.uncertainOutcome, "inspect-affected-work-before-replacement");
  assert.equal(help.contextPreparationRequired, false);
  assert.equal(Object.hasOwn(guidance, "laneSelectsExecutionMeans"), false);
  guidance.hostFallback.length = 0;
  assert.deepEqual(runCommand(["help"]).executionMeans.hostFallback, ["head-direct", "sequential"]);
});

test("ordinary project inspection preserves Session and artifacts without Run or Capsule preparation", t => {
  const root = fixture(t), before = snapshot(root), initial = inspectProject(root);
  assert.equal(initial.status, "ready");
  const status = runCommand(["status", root]);
  assert.equal(status.readiness.core.state, "ready");
  assert.equal(inspectProject(root).state.sessionId, initial.state.sessionId);
  assert.equal(inspectProject(root).state.activeRunId, initial.state.activeRunId);
  assert.deepEqual(snapshot(root), before);
  assert.throws(() => createBoundedWorkerDispatch({ root, role: "developer" }), { code: "INVALID_RUNTIME_INVOCATION_AUTHORIZATION_ID" });
  assert.deepEqual(snapshot(root), before, "execution help cannot substitute for actual managed authorization");
});

test("removed lane API has no module, CLI command or MCP tool and creates no fallback records", async t => {
  const root = fixture(t), before = snapshot(root);
  assert.equal(fs.existsSync(path.join(pluginRoot, "scripts/lib/operating-lane.mjs")), false);
  assert(!catalogTools.some(tool => tool.name === "head_operating_lane_recommend"));
  for (const mode of ["help", "help-all"]) assert(!runCommand([mode]).commands.some(command => command.includes("operating-lane-recommend")));
  assert.throws(() => runCommand(["operating-lane-recommend", root]), /Unknown command/u);
  const response = await dispatch({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "head_operating_lane_recommend", arguments: { project_root: root, intent: "execute" } } });
  assert.match(response.error?.message || "", /Unknown tool/u);
  assert.deepEqual(snapshot(root), before);
});
