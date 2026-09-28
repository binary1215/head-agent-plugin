import assert from "node:assert/strict";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeProject, inspectProject } from "../scripts/lib/head-core.mjs";
import { compileContext } from "../scripts/lib/context-compiler.mjs";
import { createExecutionContract, createWholePlanSnapshot } from "../scripts/lib/execution-lineage.mjs";
import { finishRun, getPendingReviewContext, reviewRun, startRun } from "../scripts/lib/run-lineage.mjs";
import { buildRuntimeVersionEvidence } from "../scripts/lib/runtime-machine-execution.mjs";
import { buildRuntimeProjectBinding, buildRuntimeProtocolEvidence } from "../scripts/lib/runtime-protocol-evidence.mjs";
import { buildRuntimeInvocationAuthorization, prepareRuntimeInvocationExecution, verifyRuntimeInvocationCurrentLineage } from "../scripts/lib/runtime-invocation-lifecycle.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
console.log(JSON.stringify({ event: "owned-current-lineage-test", pid: process.pid, parentPid: process.ppid,
  command: process.execPath, args: process.argv.slice(1), cwd: process.cwd(), ports: [], actualProviderInvoked: false }));

// Schema-only protocol inputs: no executable, provider or child process is run.
// The synthetic child token is never used for process discovery/termination.
function syntheticCapabilitySpawn(_command, args) {
  const output = args.join(" ") === "--version" ? "codex 1.2.3\n"
    : args.join(" ") === "--help" ? "exec\nmcp-server\napp-server\n"
      : args.join(" ") === "exec --help" ? "Run Codex non-interactively\n--json\n--output-schema\n--color\n--sandbox\n--skip-git-repo-check\n--cd\n--ephemeral\nresume\n"
        : "stdio://\ngenerate-json-schema\n--listen\n";
  const child = new EventEmitter();
  child.pid = 1; // Modeled existence only, not an actual owned PID.
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => { throw new Error("The schema fixture must never control a process"); };
  queueMicrotask(() => {
    child.stdout.emit("data", Buffer.from(output));
    child.exitCode = 0;
    child.emit("close", 0, null);
  });
  return child;
}

async function fixture(t, { scopeKind = "run", worker = false } = {}) {
  const parent = path.resolve(process.env.HEAD_AGENT_TEST_TMP || os.tmpdir());
  fs.mkdirSync(parent, { recursive: true });
  const container = fs.mkdtempSync(path.join(parent, "head-current-lineage-"));
  t.after(() => {
    assert.equal(path.dirname(container), parent);
    assert.match(path.basename(container), /^head-current-lineage-/);
    fs.rmSync(container, { recursive: true, force: true });
  });
  const root = path.join(container, "project");
  const bin = path.join(container, "synthetic-capability");
  fs.mkdirSync(root);
  fs.mkdirSync(bin);
  initializeProject({ root, pluginRoot, runtimes: ["codex"] });
  fs.writeFileSync(path.join(root, "selected.txt"), "selected initial bytes\n");
  const capsule = compileContext({ root, task: "Verify exact synthetic current execution lineage", persist: true }).capsule;
  const plan = createWholePlanSnapshot({ root, objective: "Keep exact execution lineage", plan: [{ id: "check", outcome: "Verify current binding" }] }).artifact;
  const contractOptions = { root, wholePlanId: plan.wholePlanId, capsuleId: capsule.capsuleId,
    scope: "Synthetic current-lineage fixture", acceptanceCriteria: ["No stale execution"], allowedActions: ["runtime.invoke", "project.read"] };
  const contract = createExecutionContract(contractOptions).artifact;
  const run = scopeKind === "run" ? startRun({ root, executionContractId: contract.executionContractId }).run : null;
  const executable = path.join(bin, process.platform === "win32" ? "codex.exe" : "codex");
  fs.writeFileSync(executable, "Synthetic schema fixture; never executed\n");
  if (process.platform !== "win32") fs.chmodSync(executable, 0o755);
  const environment = { ...process.env, PATH: bin };
  delete environment.Path;
  delete environment.path;
  const versionEvidence = await buildRuntimeVersionEvidence({ runtimes: ["codex"], environment, spawnImplementation: syntheticCapabilitySpawn });
  const protocolEvidence = await buildRuntimeProtocolEvidence({ runtimes: ["codex"], environment, versionEvidence, spawnImplementation: syntheticCapabilitySpawn });
  const inspected = inspectProject(root);
  const projectBinding = buildRuntimeProjectBinding({ projectId: inspected.project.projectId,
    headSessionId: inspected.state.sessionId, projectRoot: root, projectStatus: "ready", versionEvidence, protocolEvidence });
  const sessionRequest = "Read only the selected synthetic source";
  const options = { root, runtime: "codex", protocolEvidence, projectBinding,
    scope: scopeKind === "run" ? { kind: "run" } : { kind: "session", request: sessionRequest },
    ...(worker ? { worker: { taskKey: "current-lineage", role: "coder", outcome: "Return bounded synthetic evidence",
      selectedContext: "No model or provider invoked", sourcePaths: ["selected.txt"] } } : {}) };
  const authorization = buildRuntimeInvocationAuthorization(options).authorization;
  const input = { root, authorization, ...(scopeKind === "session" ? { sessionRequest } : {}) };
  const sessionFile = path.join(root, ".head/sessions/current.json");
  const runFile = run ? path.join(root, ".head/sessions/runs", run.runId, "run.json") : null;
  return { root, plan, capsule, contract, contractOptions, run, options, authorization, input, sessionFile, runFile };
}

function snapshot(root) {
  const files = {};
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else files[path.relative(root, file)] = fs.readFileSync(file).toString("base64");
    }
  };
  walk(root);
  return files;
}

function assertRejectedUnchanged(f, code, input = f.input) {
  const before = snapshot(f.root);
  for (const operation of [verifyRuntimeInvocationCurrentLineage, prepareRuntimeInvocationExecution]) {
    assert.throws(() => operation(input), { code });
    assert.deepEqual(snapshot(f.root), before);
  }
}

function withJsonChange(file, mutate, check) {
  const bytes = fs.readFileSync(file);
  fs.writeFileSync(file, JSON.stringify(mutate(JSON.parse(bytes))));
  try { check(); }
  finally { fs.writeFileSync(file, bytes); }
}

test("normal active lineage remains usable and both preparation reads create no artifacts", async (t) => {
  const f = await fixture(t);
  for (const nullTransition of [false, true]) {
    if (nullTransition) fs.writeFileSync(f.runFile, JSON.stringify({ ...f.run, sessionTransition: null }));
    const before = snapshot(f.root);
    const result = verifyRuntimeInvocationCurrentLineage(f.input);
    assert.equal(result.sourceBasisVerified, false);
    assert.equal(result.executionPrepared, false);
    assert.deepEqual(prepareRuntimeInvocationExecution(f.input).input, result.input);
    const contract = JSON.parse(result.input.toString("utf8")).returnContract;
    assert.equal(contract.kind, "ResultPacketDraft");
    assert.equal(contract.fixedFields, undefined);
    assert.equal(contract.wireResultShape.planDelta, "string describing the completed plan delta");
    assert.deepEqual(contract.wireResultShape.impactRadius, ["relative paths or bounded impact descriptions"]);
    assert.deepEqual(snapshot(f.root), before);
  }
});

test("current WholePlan, mode and pending-review drift reject only the affected execution", async (t) => {
  const f = await fixture(t);
  for (const patch of [{ currentWholePlanId: `whole-plan-${"a".repeat(24)}` }, { mode: "review" },
    { pendingReview: { runId: f.run.runId, wholePlanId: f.plan.wholePlanId, resultPacketId: `result-packet-${"b".repeat(24)}` } }]) {
    withJsonChange(f.sessionFile, (state) => ({ ...state, ...patch }), () => assertRejectedUnchanged(f, "RUNTIME_INVOCATION_FENCE_MISMATCH"));
  }
  assert.equal(prepareRuntimeInvocationExecution(f.input).authorization.authorizationId, f.authorization.authorizationId);
});

test("active Session pointers cannot conceal missing, terminal or mismatched Run canon", async (t) => {
  const f = await fixture(t);
  for (const [patch, code] of [
    [{ runId: "run-1-abcdef" }, "RUNTIME_INVOCATION_RUN_NOT_ACTIVE"],
    [{ status: "awaiting_review" }, "RUNTIME_INVOCATION_RUN_NOT_ACTIVE"],
    [{ wholePlanId: `whole-plan-${"a".repeat(24)}` }, "RUNTIME_INVOCATION_LINEAGE_CONFLICT"],
    [{ executionContractId: `execution-contract-${"a".repeat(24)}` }, "RUNTIME_INVOCATION_LINEAGE_CONFLICT"],
    [{ capsuleId: `capsule-${"a".repeat(24)}` }, "RUNTIME_INVOCATION_LINEAGE_CONFLICT"],
  ]) {
    withJsonChange(f.runFile, (run) => ({ ...run, ...patch }), () => assertRejectedUnchanged(f, code));
  }
  const bytes = fs.readFileSync(f.runFile);
  fs.unlinkSync(f.runFile);
  try { assertRejectedUnchanged(f, "RUNTIME_INVOCATION_RUN_MISSING"); }
  finally { fs.writeFileSync(f.runFile, bytes); }
});

test("individually digest-valid plan and Capsule cannot be mixed with another contract", async (t) => {
  const f = await fixture(t);
  const otherPlan = createWholePlanSnapshot({ root: f.root, objective: "Independent synthetic plan", plan: [{ id: "other", outcome: "Separate lineage" }] }).artifact;
  const otherCapsule = compileContext({ root: f.root, task: "Independent synthetic Capsule", persist: true }).capsule;
  for (const contractOptions of [{ ...f.contractOptions, wholePlanId: otherPlan.wholePlanId },
    { ...f.contractOptions, capsuleId: otherCapsule.capsuleId }]) {
    const contract = createExecutionContract(contractOptions).artifact;
    // A digest is not authorization to combine unrelated valid artifacts.
    const { authorizationHash: _hash, authorizationId: _id, ...payload } = f.authorization;
    payload.scope = { ...payload.scope, executionContractId: contract.executionContractId };
    const authorizationHash = crypto.createHash("sha256").update(JSON.stringify(canonical(payload))).digest("hex");
    const authorization = { ...payload, authorizationHash, authorizationId: `execution-authorization-${authorizationHash.slice(0, 24)}` };
    withJsonChange(f.sessionFile, (state) => ({ ...state, activeExecutionContractId: contract.executionContractId }), () => {
      withJsonChange(f.runFile, (run) => ({ ...run, executionContractId: contract.executionContractId }), () => {
        assertRejectedUnchanged(f, "RUNTIME_INVOCATION_LINEAGE_CONFLICT", { root: f.root, authorization });
      });
    });
  }
});

test("real prepared finish prevents new execution but the exact finish retry still converges", async (t) => {
  const f = await fixture(t);
  const finishInput = { root: f.root, outcome: "Synthetic whole result", evidence: [{ fixture: "no provider" }],
    verification: [{ check: "synthetic result boundary", status: "passed" }] };
  const rename = fs.renameSync;
  let injected = false;
  fs.renameSync = (source, target) => {
    const result = rename(source, target);
    if (!injected && target === f.runFile && JSON.parse(fs.readFileSync(target)).sessionTransition?.kind === "finish") {
      injected = true;
      throw Object.assign(new Error("Synthetic failure after durable finish preparation"), { code: "EIO" });
    }
    return result;
  };
  try { assert.throws(() => finishRun(finishInput), { code: "EIO" }); }
  finally { fs.renameSync = rename; }
  assert.equal(injected, true);
  assert.equal(JSON.parse(fs.readFileSync(f.runFile)).status, "active");
  assert.equal(inspectProject(f.root).state.activeRunId, f.run.runId);
  assertRejectedUnchanged(f, "RUNTIME_INVOCATION_RUN_TRANSITION_PENDING");
  const before = snapshot(f.root);
  assert.throws(() => buildRuntimeInvocationAuthorization(f.options), { code: "RUNTIME_INVOCATION_RUN_TRANSITION_PENDING" });
  assert.deepEqual(snapshot(f.root), before);
  const finished = finishRun(finishInput);
  assert.equal(finished.run.runId, f.run.runId);
  assertRejectedUnchanged(f, "RUNTIME_INVOCATION_FENCE_MISMATCH");
  const unchanged = snapshot(f.root);
  assert.equal(finishRun(finishInput).resultPacket.resultPacketId, finished.resultPacket.resultPacketId);
  assert.deepEqual(snapshot(f.root), unchanged);
  reviewRun({ root: f.root, reviewContextId: getPendingReviewContext({ root: f.root }).review.reviewContextId,
    disposition: "accept", rationale: "Explicit synthetic fixture review only" });
  const nextRun = startRun({ root: f.root, executionContractId: f.contract.executionContractId }).run;
  assert.notEqual(nextRun.runId, f.run.runId);
  const nextAuthorization = buildRuntimeInvocationAuthorization(f.options).authorization;
  assert.equal(prepareRuntimeInvocationExecution({ root: f.root, authorization: nextAuthorization }).authorization.scope.runId, nextRun.runId);
});

test("lineage-only inspection preserves retained input but cannot suppress source execution checks", async (t) => {
  const f = await fixture(t, { worker: true });
  fs.writeFileSync(path.join(f.root, "selected.txt"), "changed by a source owner\n");
  const before = snapshot(f.root);
  const inspected = verifyRuntimeInvocationCurrentLineage(f.input);
  assert.equal(inspected.sourceBasisVerified, false);
  assert.equal(inspected.executionPrepared, false);
  assert.equal(Buffer.from(inspected.authorization.workerInput.sourceBasis[0].contentBase64, "base64").toString(), "selected initial bytes\n");
  assert.throws(() => prepareRuntimeInvocationExecution({ ...inspected, root: f.root, verifyCurrentSources: false }), { code: "WORKER_SOURCE_BASIS_DRIFT" });
  assert.deepEqual(snapshot(f.root), before);
});

test("idle Session authorization remains usable without Run lineage or a Capsule", async (t) => {
  const f = await fixture(t, { scopeKind: "session", worker: true });
  const before = snapshot(f.root);
  const inspected = verifyRuntimeInvocationCurrentLineage(f.input);
  const prepared = prepareRuntimeInvocationExecution(f.input);
  assert.equal(prepared.authorization.scope.kind, "session");
  assert.equal(prepared.authorization.scope.contextCapsuleId, null);
  assert.deepEqual(prepared.executionInput.returnContract.fixedFields, { planDelta: "", impactRadius: [] });
  assert.match(prepared.executionInput.returnContract.scopeInstruction, /fixed values, not examples/);
  assert.deepEqual(prepared.input, inspected.input);
  assert.deepEqual(snapshot(f.root), before);
  assert.throws(() => prepareRuntimeInvocationExecution({ ...f.input, sessionRequest: "A different request" }), { code: "RUNTIME_INVOCATION_INPUT_DRIFT" });
});
