import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { initializeProject, inspectProject } from "../scripts/lib/head-core.mjs";
import { compileContext } from "../scripts/lib/context-compiler.mjs";
import { createExecutionContract, createWholePlanSnapshot, readLineageArtifact } from "../scripts/lib/execution-lineage.mjs";
import { finishRun, getPendingReviewContext, reviewRun, startRun } from "../scripts/lib/run-lineage.mjs";
import { buildRuntimeVersionEvidence } from "../scripts/lib/runtime-machine-execution.mjs";
import { buildRuntimeProjectBinding, buildRuntimeProtocolEvidence } from "../scripts/lib/runtime-protocol-evidence.mjs";
import { buildRuntimeInvocationAuthorization, buildRuntimeInvocationLifecycleReceipt, buildRuntimeResultPacketDraft, normalizeRuntimeEvent } from "../scripts/lib/runtime-invocation-lifecycle.mjs";
import { RUNTIME_OPERATIONAL_STATE_ENV, withRuntimeExecutionLease } from "../scripts/lib/runtime-execution-lease.mjs";
import { persistRuntimeInvocationRecord, readRuntimeInvocationRecord } from "../scripts/lib/runtime-invocation-record.mjs";
import { applyRuntimeRunResult, readRuntimeInvocationResult } from "../scripts/lib/runtime-run-result-application.mjs";
import { withProjectMutationAsync } from "../scripts/lib/project-mutation-lock.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
console.log(JSON.stringify({ event: "owned-runtime-application-test", pid: process.pid, parentPid: process.ppid, command: process.execPath, args: process.argv.slice(1), cwd: process.cwd(), ports: [], liveProviderInvoked: false }));

function fixedCapabilitySpawn(_command, args, options) {
  const key = args.join(" ");
  const output = key === "--version" ? "codex 1.2.3\n"
    : key === "--help" ? "exec\nmcp-server\napp-server\n"
      : key === "exec --help" ? "Run Codex non-interactively\n--json\n--output-schema\n--color\n--sandbox\n--skip-git-repo-check\n--cd\n--ephemeral\nresume\n"
        : "stdio://\ngenerate-json-schema\n--listen\n";
  const childArgs = ["-e", "process.stdout.write(process.argv[1])", "--", output];
  console.log(JSON.stringify({ event: "owned-capability-fixture-launch", parentPid: process.pid, command: process.execPath, args: childArgs, cwd: pluginRoot, ports: [] }));
  const child = spawn(process.execPath, childArgs, { ...options, cwd: pluginRoot, windowsHide: true });
  child.on("spawn", () => console.log(JSON.stringify({ event: "owned-capability-fixture-start", pid: child.pid, parentPid: process.pid, cwd: pluginRoot, ports: [] })));
  child.on("close", (code) => {
    console.log(JSON.stringify({ event: "owned-capability-fixture-exit", pid: child.pid, parentPid: process.pid, code, ports: [] }));
    assert.throws(() => process.kill(child.pid, 0), { code: "ESRCH" });
  });
  return child;
}

async function fixture(t) {
  const parent = process.env.HEAD_AGENT_TEST_TMP || os.tmpdir();
  fs.mkdirSync(parent, { recursive: true });
  const container = fs.mkdtempSync(path.join(parent, "head-runtime-application-"));
  // macOS temporary paths may be /var aliases of /private/var. Compare and
  // bind canonical roots exactly as production does, not caller path spelling.
  const [root, operational, bin] = ["project", "operational", "capability-fixture"].map((name) => {
    const directory = path.join(container, name);
    fs.mkdirSync(directory);
    return fs.realpathSync(directory);
  });
  const previousOperational = process.env[RUNTIME_OPERATIONAL_STATE_ENV];
  process.env[RUNTIME_OPERATIONAL_STATE_ENV] = operational;
  t.after(() => {
    if (previousOperational === undefined) delete process.env[RUNTIME_OPERATIONAL_STATE_ENV];
    else process.env[RUNTIME_OPERATIONAL_STATE_ENV] = previousOperational;
    assert.equal(path.dirname(container), path.resolve(parent));
    assert.match(path.basename(container), /^head-runtime-application-/);
    fs.rmSync(container, { recursive: true, force: true });
  });
  initializeProject({ root, pluginRoot, runtimes: ["codex"] });
  const capsule = compileContext({ root, task: "Verify a synthetic completed record is applied to its own Run", persist: true }).capsule;
  const plan = createWholePlanSnapshot({ root, objective: "Verify exact application target", plan: [{ id: "apply", outcome: "Exact application evidence" }] }).artifact;
  const contract = createExecutionContract({ root, wholePlanId: plan.wholePlanId, capsuleId: capsule.capsuleId, scope: "Synthetic fixture A only", acceptanceCriteria: ["Preserve exact Run identity"], allowedActions: ["runtime.invoke", "project.read"] }).artifact;
  const run = startRun({ root, executionContractId: contract.executionContractId }).run;
  const executable = path.join(bin, process.platform === "win32" ? "codex.exe" : "codex");
  fs.writeFileSync(executable, "Capability schema fixture, never executed as a provider\n");
  if (process.platform !== "win32") fs.chmodSync(executable, 0o755);
  const environment = { ...process.env, PATH: bin };
  delete environment.Path;
  delete environment.path;
  const versionEvidence = await buildRuntimeVersionEvidence({ runtimes: ["codex"], environment, spawnImplementation: fixedCapabilitySpawn });
  const protocolEvidence = await buildRuntimeProtocolEvidence({ runtimes: ["codex"], environment, versionEvidence, spawnImplementation: fixedCapabilitySpawn });
  const inspected = inspectProject(root);
  const projectBinding = buildRuntimeProjectBinding({ projectId: inspected.project.projectId, headSessionId: inspected.state.sessionId, projectRoot: root, projectStatus: "ready", versionEvidence, protocolEvidence });
  const authorization = buildRuntimeInvocationAuthorization({ root, runtime: "codex", protocolEvidence, projectBinding, scope: { kind: "run" }, persist: true }).authorization;
  assert.equal(authorization.projectRootDigest, hash(root));
  // Model a completed-provider RECORD with real builders, hashes, durable lease,
  // and record readers. The operational booleans below are synthetic fixture
  // data, not real provider/supervisor observations or live conformance evidence.
  const providerResult = { schemaVersion: 1, kind: "RuntimeStructuredResult", protocolVersion: "0.1.0", outcome: "SCHEMA FIXTURE ONLY: modeled completed A result", evidence: ["Synthetic record fixture, no provider invoked"], planDelta: "", impactRadius: [], verification: ["Validate stored schema and application target only"], unknowns: ["No live provider or supervisor execution was tested"] };
  const events = [normalizeRuntimeEvent({ authorization, sequence: 0, line: JSON.stringify({ type: "turn.completed", fixtureOnly: true }) })];
  const leased = await withRuntimeExecutionLease({ projectRoot: root, authorization, ownerFenceDigest: hash("synthetic fixture owner") }, async ({ consumption }) => ({ receipt: buildRuntimeInvocationLifecycleReceipt({
    authorization, events, consumption, status: "completed", exitCode: 0, signal: "", stdoutBytes: 0, stderrBytes: 0, stdoutDigest: hash(""), stderrDigest: hash(""), callerFenceDigest: hash("synthetic caller"), childFenceDigest: hash("synthetic child"), childStarted: true, childExitObserved: true, terminationRequested: false, projectFenceValidated: true, inputDigestObserved: authorization.executionInput.digest, noDescendantFixture: false, descendantTreeOwnershipValidated: true, providerMode: "actual-codex", providerSessionCreated: true, structuredResult: providerResult,
    supervision: { supervisionMode: "native-process-tree", supervisionStrategy: process.platform === "win32" ? "windows-job-object" : "posix-process-group", supervisorManifestDigest: hash("synthetic manifest"), ownershipEstablished: true, providerChildStarted: true, providerChildExitObserved: true, treeCleanupAttempted: true, treeCleanupVerified: true },
  }) }));
  const receipt = leased.result.receipt;
  const draft = buildRuntimeResultPacketDraft({ authorization, receipt, leaseRelease: leased.release, providerResult });
  persistRuntimeInvocationRecord({ projectRoot: root, authorization, events, receipt, draft });
  const record = readRuntimeInvocationRecord({ root, authorizationId: authorization.authorizationId });
  assert.equal(record.status, "verified");
  assert.equal(record.draft.draftId, draft.draftId);
  return { root, run, plan, capsule, contract, authorization, record };
}

function snapshot(root) {
  const result = {};
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else result[path.relative(root, file)] = fs.readFileSync(file).toString("base64");
    }
  };
  walk(root);
  return result;
}

function accept(root) {
  return reviewRun({ root, reviewContextId: getPendingReviewContext({ root }).review.reviewContextId, disposition: "accept", rationale: "Only the bounded synthetic fixture result is accepted." });
}

function startB(f) {
  const contract = createExecutionContract({ root: f.root, wholePlanId: f.plan.wholePlanId, capsuleId: f.capsule.capsuleId, scope: "Different synthetic fixture B", acceptanceCriteria: ["Only B evidence may complete B"] }).artifact;
  return startRun({ root: f.root, executionContractId: contract.executionContractId }).run;
}

function missingApplicationOnce(operation) {
  const link = fs.linkSync;
  let injected = false;
  fs.linkSync = (source, target) => {
    if (!injected && path.basename(target) === "application.json") {
      injected = true;
      throw Object.assign(new Error("Isolated application receipt EIO"), { code: "EIO" });
    }
    return link(source, target);
  };
  try { assert.throws(operation, { code: "EIO" }); }
  finally { fs.linkSync = link; }
  assert.equal(injected, true);
}

test("runtime result receipt EIO then reviewed A and different Run B never mutates B", async (t) => {
  const f = await fixture(t);
  const input = { root: f.root, authorizationId: f.authorization.authorizationId };
  missingApplicationOnce(() => applyRuntimeRunResult(input));
  assert.equal(inspectProject(f.root).state.pendingReview.runId, f.run.runId);
  accept(f.root);
  const b = startB(f);
  const before = snapshot(f.root);
  let failure;
  try { applyRuntimeRunResult(input); } catch (error) { failure = error; }
  console.log(JSON.stringify({ event: "application-target-regression", errorCode: failure?.code, authorizedRunId: f.run.runId, expectedActiveRunId: b.runId, actualActiveRunId: inspectProject(f.root).state.activeRunId, projectBytesUnchanged: JSON.stringify(snapshot(f.root)) === JSON.stringify(before), evidenceScope: "stored schema fixture, no live provider" }));
  assert.equal(failure?.code, "RUNTIME_RUN_RESULT_APPLICATION_CONFLICT");
  assert.deepEqual(snapshot(f.root), before);
  assert.equal(inspectProject(f.root).state.activeRunId, b.runId);
});

test("normal application and complete-receipt replay stay exact and read-only across a later Run", async (t) => {
  const f = await fixture(t);
  const input = { root: f.root, authorizationId: f.authorization.authorizationId };
  const canon = fs.readFileSync(path.join(f.root, ".head/context/product-model.json"), "utf8");
  const owners = new Set();
  const stages = new Set();
  const observeLock = (stage) => {
    const entries = fs.readdirSync(path.join(f.root, ".head/.operations/session-recovery.lock"));
    assert.equal(entries.length, 1);
    assert.match(entries[0], new RegExp(`^owner-[a-f0-9]+-${process.pid}-[a-f0-9]+\\.json$`));
    owners.add(entries[0]);
    stages.add(stage);
  };
  const read = fs.readFileSync;
  const rename = fs.renameSync;
  const link = fs.linkSync;
  fs.readFileSync = (file, ...args) => {
    if (file === path.join(f.record.directory, "receipt.json")) observeLock("record-read");
    if (file === path.join(f.root, ".head/sessions/runs", f.run.runId, "run.json")) observeLock("run-read");
    return read(file, ...args);
  };
  fs.renameSync = (source, target) => {
    if (target === path.join(f.root, ".head/sessions/current.json")) observeLock("session-write");
    return rename(source, target);
  };
  fs.linkSync = (source, target) => {
    if (path.basename(target) === "application.json") observeLock("application-write");
    return link(source, target);
  };
  let applied;
  try { applied = applyRuntimeRunResult(input); }
  finally { fs.readFileSync = read; fs.renameSync = rename; fs.linkSync = link; }
  assert.equal(owners.size, 1, "one lease must cover validation and both mutations");
  assert.deepEqual([...stages].sort(), ["application-write", "record-read", "run-read", "session-write"]);
  assert.equal(applied.status, "runtime_run_result_applied");
  assert.equal(applied.application.runId, f.run.runId);
  assert.equal(applied.resultPacket.executionContractId, f.contract.executionContractId);
  assert.equal(applied.freshHeadReview.runId, f.run.runId);
  assert.equal(inspectProject(f.root).state.latestCheckpoint, null);
  assert.equal(fs.existsSync(path.join(f.root, ".head/lineage/review-decisions")), false);
  assert.equal(fs.readFileSync(path.join(f.root, ".head/context/product-model.json"), "utf8"), canon);
  const finished = snapshot(f.root);
  assert.equal(readRuntimeInvocationResult(input).application.applicationId, applied.application.applicationId);
  assert.equal(applyRuntimeRunResult(input).status, "runtime_run_result_already_applied");
  assert.deepEqual(snapshot(f.root), finished);
  accept(f.root);
  const b = startB(f);
  const next = snapshot(f.root);
  const replay = applyRuntimeRunResult(input);
  assert.equal(replay.application.applicationId, applied.application.applicationId);
  assert.equal(replay.freshHeadReview, null);
  assert.deepEqual(snapshot(f.root), next);
  assert.equal(inspectProject(f.root).state.activeRunId, b.runId);
});

test("missing application receipt recovers only the exact pending result and is retryable after partial Run completion", async (t) => {
  const f = await fixture(t);
  const input = { root: f.root, authorizationId: f.authorization.authorizationId };
  const rename = fs.renameSync;
  let injected = false;
  fs.renameSync = (source, target) => {
    if (!injected && target === path.join(f.root, ".head/sessions/current.json")) {
      injected = true;
      throw Object.assign(new Error("Exact Session pointer fixture EIO"), { code: "EIO" });
    }
    return rename(source, target);
  };
  try { assert.throws(() => applyRuntimeRunResult(input), { code: "EIO" }); }
  finally { fs.renameSync = rename; }
  assert.equal(injected, true);
  assert.equal(inspectProject(f.root).state.activeRunId, f.run.runId);
  missingApplicationOnce(() => applyRuntimeRunResult(input));
  const pending = inspectProject(f.root).state.pendingReview;
  const resultBytes = fs.readFileSync(path.join(f.root, ".head/lineage/result-packets", `${pending.resultPacketId}.json`), "utf8");
  const applied = applyRuntimeRunResult(input);
  assert.equal(applied.application.runId, f.run.runId);
  assert.equal(applied.resultPacket.resultPacketId, pending.resultPacketId);
  assert.equal(fs.readFileSync(path.join(f.root, ".head/lineage/result-packets", `${pending.resultPacketId}.json`), "utf8"), resultBytes);
});

test("Run identity remains fenced when B reuses A's ExecutionContract", async (t) => {
  const f = await fixture(t);
  const input = { root: f.root, authorizationId: f.authorization.authorizationId };
  missingApplicationOnce(() => applyRuntimeRunResult(input));
  accept(f.root);
  const b = startRun({ root: f.root, executionContractId: f.contract.executionContractId }).run;
  const before = snapshot(f.root);
  assert.throws(() => applyRuntimeRunResult(input), { code: "RUNTIME_RUN_RESULT_APPLICATION_CONFLICT" });
  assert.deepEqual(snapshot(f.root), before);
  assert.equal(inspectProject(f.root).state.activeRunId, b.runId);
});

test("delayed A result cannot complete B even when A was finished through another explicit result", async (t) => {
  const f = await fixture(t);
  finishRun({ root: f.root, outcome: "Separate explicit A fixture result", evidence: [{ uri: "fixture", digest: "different-evidence" }], verification: [{ check: "separate fixture", status: "passed" }] });
  accept(f.root);
  startB(f);
  const before = snapshot(f.root);
  assert.throws(() => applyRuntimeRunResult({ root: f.root, authorizationId: f.authorization.authorizationId }), { code: "RUNTIME_RUN_RESULT_APPLICATION_CONFLICT" });
  assert.deepEqual(snapshot(f.root), before);
});

test("Session drift and canonical digest tamper reject before application writes", async (t) => {
  const f = await fixture(t);
  const input = { root: f.root, authorizationId: f.authorization.authorizationId };
  const sessionFile = path.join(f.root, ".head/sessions/current.json");
  const sessionBytes = fs.readFileSync(sessionFile, "utf8");
  fs.writeFileSync(sessionFile, JSON.stringify({ ...JSON.parse(sessionBytes), sessionId: `session-${crypto.randomUUID()}` }));
  const drifted = snapshot(f.root);
  assert.throws(() => applyRuntimeRunResult(input), { code: "RUNTIME_RUN_RESULT_APPLICATION_CONFLICT" });
  assert.deepEqual(snapshot(f.root), drifted);
  fs.writeFileSync(sessionFile, sessionBytes);
  const contractFile = readLineageArtifact({ root: f.root, artifactId: f.contract.executionContractId }).file;
  const contractBytes = fs.readFileSync(contractFile, "utf8");
  fs.writeFileSync(contractFile, JSON.stringify({ ...JSON.parse(contractBytes), scope: "Tampered contract" }));
  const tampered = snapshot(f.root);
  assert.throws(() => applyRuntimeRunResult(input), { code: "LINEAGE_DIGEST_MISMATCH" });
  assert.deepEqual(snapshot(f.root), tampered);
  fs.writeFileSync(contractFile, contractBytes);
  assert.equal(applyRuntimeRunResult(input).status, "runtime_run_result_applied");
});

test("application competes within the same Session mutation scope and rechecks drift after it releases", async (t) => {
  const f = await fixture(t);
  const input = { root: f.root, authorizationId: f.authorization.authorizationId };
  let acquired;
  let release;
  const ready = new Promise((resolve) => { acquired = resolve; });
  const barrier = new Promise((resolve) => { release = resolve; });
  const competitor = withProjectMutationAsync({ root: f.root, scope: "session-recovery" }, async () => {
    acquired();
    await barrier;
    finishRun({ root: f.root, outcome: "Competing explicit A result", evidence: [{ uri: "fixture", digest: "competing-evidence" }], verification: [{ check: "fixture", status: "passed" }] });
    accept(f.root);
    startB(f);
  });
  await ready;
  try {
    const whileLocked = snapshot(f.root);
    assert.throws(() => applyRuntimeRunResult(input), { code: "PROJECT_MUTATION_BUSY" });
    assert.deepEqual(snapshot(f.root), whileLocked);
  } finally { release(); await competitor; }
  const afterDrift = snapshot(f.root);
  assert.throws(() => applyRuntimeRunResult(input), { code: "RUNTIME_RUN_RESULT_APPLICATION_CONFLICT" });
  assert.deepEqual(snapshot(f.root), afterDrift);
});
