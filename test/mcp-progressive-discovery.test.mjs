import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { dispatch, discoverTools, tools, catalogTools } from "../scripts/mcp-server.mjs";
import { initializeProject } from "../scripts/lib/head-core.mjs";
import { runCommand, usage } from "../scripts/head.mjs";
const pluginRoot = path.resolve(import.meta.dirname, "..");
const request = (name, args = {}) => ({ id: 1, method: "tools/call", params: { name, arguments: args } });
const call = (name, args = {}, options) => dispatch(request(name, args), options);
function fixture(t) {
  const parent = fs.realpathSync(process.env.HEAD_AGENT_TEST_TMP || os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, "head-progressive-"));
  t.after(() => { assert.equal(path.dirname(root), parent); fs.rmSync(root, { recursive: true, force: true }); });
  initializeProject({ root, pluginRoot, runtimes: ["codex"] });
  return root;
}
function snapshot(root) {
  return fs.readdirSync(root, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name)).flatMap(e => {
    const file = path.join(root, e.name);
    return e.isDirectory() ? snapshot(file) : [[file, fs.readFileSync(file).toString("base64")]];
  });
}

test("small default catalog discovers every ordinary contract without registering, unlocking or initializing", async () => {
  assert.equal(tools.length, 17);
  assert(tools.some(tool => tool.name === "head_project_graph"));
  assert(Buffer.byteLength(JSON.stringify(tools)) < 112030 / 2);
  for (const name of ["head_operating_lane_recommend", "head_product_note", "head_context_prepare", "head_world_model"]) {
    assert(!tools.some(tool => tool.name === name));
  }
  const groups = (await call("head_tools_discover")).result.structuredContent;
  assert.equal(groups.persisted, false); assert.equal(groups.grantsAuthorization, false);
  const found = [];
  for (const { prefix } of groups.prefixes) {
    let offset = 0;
    do {
      const page = (await call("head_tools_discover", { prefix, offset, limit: 2 })).result.structuredContent;
      found.push(...page.tools); offset = page.nextOffset;
    } while (offset != null);
  }
  assert.deepEqual(found.map(x => x.name).sort(), catalogTools.map(x => x.name).sort());
  for (const tool of found) {
    assert.deepEqual(tool.inputSchema, catalogTools.find(x => x.name === tool.name).inputSchema);
    assert.equal(tool.invokeWith, tool.annotations.readOnlyHint ? "head_tools_read" : "head_tools_call");
  }
  assert.equal(discoverTools({ prefix: "compatibility" }).tools.length, 0);
  for (const name of ["head_operating_lane_recommend", "head_product_note", "head_metric_follow_up", "head_observation_status", "head_observation_collect"]) {
    assert.throws(() => discoverTools({ name }), /Unknown or unavailable tool/);
    assert((await call(name, {})).error, name);
    assert((await call("head_tools_call", { name, arguments: {} })).error, name);
    assert(!usage({ all: true }).commands.some(command => command.split(/\s+/)[1] === name.replace(/^head_/, "").replaceAll("_", "-")));
  }
  assert((await call("head_tools_discover", { name: "head_product_note", prefix: "head_" })).error);
});

test("direct small work, optional context, status and recovery preserve authority without advisory tools", async t => {
  const root = fixture(t);
  const before = snapshot(root);
  const status = await call("head_project_status", { project_root: root });
  assert.equal(status.error, undefined);
  assert.equal(status.result.structuredContent.readiness.core.state, "ready");
  fs.writeFileSync(path.join(root, "small.txt"), "direct work\n");
  assert.equal(fs.readFileSync(path.join(root, "small.txt"), "utf8"), "direct work\n");
  assert.deepEqual(snapshot(root).filter(([file]) => file !== path.join(root, "small.txt")), before);
  const current = snapshot(root), task = "Prepare reproducible selected context for handoff";
  for (const [name, args] of [["head_context_prepare", { project_root: root, task }],
    ["head_checkpoint_diagnose", { project_root: root }]]) {
    const direct = await call(name, args);
    const routed = await call("head_tools_read", { name, arguments: args });
    assert.deepEqual(routed, direct);
  }
  assert.deepEqual(snapshot(root), current);
  assert.equal(usage().contextPreparationRequired, false);
  assert(!usage().commands.some(command => /context-prepare|operating-lane-recommend|product-note/.test(command)));
  assert.equal(usage({ all: true }).compatibilityDiagnostics, undefined);
  const diagnosis = runCommand(["checkpoint-diagnose", root]);
  assert.equal(diagnosis.diagnosis.state, "no-current-checkpoint");
});

test("routed effects cannot masquerade as reads, enable maintenance, nest routers or evade original rejection", async t => {
  const root = fixture(t), before = snapshot(root);
  const deniedRead = await call("head_tools_read", { name: "head_checkpoint_sync", arguments: { project_root: root } });
  assert.match(deniedRead.error.message, /not read-only/);
  const deniedManaged = await call("head_tools_call", { name: "head_bounded_worker_start", arguments: { project_root: root, surface: "managed-maintenance" } });
  assert.match(deniedManaged.error.message, /not available on the ordinary/);
  assert((await call("head_tools_call", { name: "head_tools_call", arguments: {} })).error);
  for (const name of ["head_onboarding_review", "head_checkpoint_sync", "head_bounded_worker_cancel"]) {
    const args = { project_root: root };
    const direct = await call(name, args), routed = await call("head_tools_call", { name, arguments: args });
    assert(direct.error, name); assert.deepEqual(routed, direct);
  }
  const explicit = await call("head_tools_call", { name: "head_bounded_worker_start", arguments: { project_root: root } }, { surface: "managed-maintenance" });
  assert(explicit.error); assert.doesNotMatch(explicit.error.message, /not available on the ordinary/);
  assert.deepEqual(snapshot(root), before);
});

test("cold catalog and Core contract avoid optional implementations and survive optional module failure", () => {
  const args = [path.join(pluginRoot, "test/helpers/mcp-loading-probe.mjs")];
  console.log(JSON.stringify({ event: "planned", command: process.execPath, args, parentPid: process.pid, cwd: pluginRoot, ports: [] }));
  const child = spawnSync(process.execPath, args, { cwd: pluginRoot, windowsHide: true, encoding: "utf8", timeout: 15000 });
  console.log(JSON.stringify({ event: "closed", pid: child.pid, parentPid: process.pid, exitCode: child.status, ports: [] }));
  assert.equal(child.error, undefined); assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout.trim());
  assert.equal(result.optionalFailureScoped, true); assert.equal(result.providerInvoked, false);
  console.log(JSON.stringify(result));
});

test("conversation onboarding discovers advanced schemas and exercises the advertised routes end to end", () => {
  const args = [path.join(pluginRoot, "scripts/verify-conversational-onboarding.mjs")];
  console.log(JSON.stringify({ event: "planned", command: process.execPath, args, parentPid: process.pid, cwd: pluginRoot, ports: [] }));
  const child = spawnSync(process.execPath, args, { cwd: pluginRoot, windowsHide: true, encoding: "utf8", timeout: 30000 });
  console.log(JSON.stringify({ event: "closed", pid: child.pid, parentPid: process.pid, exitCode: child.status, ports: [] }));
  assert.equal(child.error, undefined); assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout.trim());
  assert.equal(result.status, "conversational_onboarding_verified");
  assert.equal(result.defaultToolCount, tools.length);
  assert.equal(result.discoveryGrantsAuthorization, false);
  assert.equal(result.unconfirmedGraphDbActivationRejected, true);
  assert.equal(result.graphDbCredentialPreflightNetworkRequests, 0);
  assert.equal(result.worldGraphContextDocumentsReady, true);
  for (const name of ["head_onboarding_guide", "head_onboarding_review", "head_markdown_projection_build",
    "head_context_prepare", "head_context_preview", "head_graphdb_connection_preflight", "head_graphdb_projection_activate"]) {
    assert(result.advancedToolsDiscovered.includes(name), name);
    assert(result.advancedToolsRouted.includes(name), name);
  }
});
