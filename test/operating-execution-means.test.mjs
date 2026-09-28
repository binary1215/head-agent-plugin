import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeProject } from "../scripts/lib/head-core.mjs";
import { recommendOperatingLane } from "../scripts/lib/operating-lane.mjs";
import { createBoundedWorkerDispatch } from "../scripts/lib/bounded-worker-dispatch.mjs";
import { runCommand } from "../scripts/head.mjs";
import { dispatch } from "../scripts/mcp-server.mjs";

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
test("direct and ordinary Host advice requires no managed preparation and leaves every project artifact unchanged", t => {
  const root = fixture(t), before = snapshot(root);
  const direct = recommendOperatingLane({ root, intent: "execute", workspaceEffect: "reversible" });
  const delegated = recommendOperatingLane({ root, intent: "execute", providerInvocation: true, independentReview: true });
  for (const advice of [direct, delegated]) {
    assert.equal(advice.lane, "session");
    assert.deepEqual(advice.minimumContracts, ["exact-session-request"]);
    assert.equal(advice.executionMeans.default, "head-direct");
    assert.equal(advice.executionMeans.laneSelectsExecutionMeans, false);
    assert.equal(advice.executionMeans.requiresUserSelection, false);
    assert.deepEqual(advice.executionMeans.hostFallback, ["head-direct", "sequential"]);
    assert.equal(advice.executionMeans.fallbackCondition, "not-started-or-confirmed-no-remaining-effects");
    assert.equal(Object.hasOwn(advice.executionMeans, "managed"), false);
    assert.equal(advice.executionMeans.grantsPermission, false);
    assert.equal(advice.persisted, false);
  }
  delegated.executionMeans.hostFallback.length = 0;
  assert.deepEqual(recommendOperatingLane({ root }).executionMeans.hostFallback, ["head-direct", "sequential"]);
  assert.deepEqual(snapshot(root), before);
});
test("real durable dependencies and protected effects retain their lanes without selecting managed delegates", t => {
  const root = fixture(t);
  for (const input of [{ dependencyCount: 2 }, { failureBranches: true }, { irreversible: true, authorizationStatus: "within-approved-scope" }]) {
    const result = recommendOperatingLane({ root, ...input });
    assert.equal(result.lane, "run");
    assert(result.minimumContracts.includes("FreshHeadReview"));
    assert.equal(result.executionMeans.laneSelectsExecutionMeans, false);
  }
  for (const input of [{ externalWrite: true }, { productCanonMutation: true }, { recoveryCheckpointReplacement: true }]) {
    const result = recommendOperatingLane({ root, ...input });
    assert.equal(result.lane, "authority");
    assert.equal(result.authorizationAssessment.permissionGranted, false);
  }
  assert.throws(() => createBoundedWorkerDispatch({ root }), "Host advice cannot bypass managed authorization");
});
test("CLI and typed MCP expose identical lane semantics without injecting a managed Host", async t => {
  const root = fixture(t), input = { intent: "execute", providerInvocation: true, independentReview: true };
  const filename = path.join(root, "risk.json"); fs.writeFileSync(filename, JSON.stringify(input));
  const before = snapshot(root);
  const cli = runCommand(["operating-lane-recommend", root, "--input", filename]);
  const response = await dispatch({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "head_operating_lane_recommend", arguments: {
    project_root: root, intent: "execute", provider_invocation: true, independent_review: true,
  } } });
  assert.equal(response.error, undefined); assert.equal(response.result.isError, undefined);
  assert.deepEqual(response.result.structuredContent, cli);
  assert.deepEqual(runCommand(["help"]).executionMeans, cli.executionMeans);
  assert.equal(runCommand(["help"]).laneRecommendationRequired, false);
  assert.deepEqual(snapshot(root), before);
});
