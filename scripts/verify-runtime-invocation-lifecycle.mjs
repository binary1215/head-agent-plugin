#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { initializeProject, inspectProject } from "./lib/head-core.mjs";
import { compileContext } from "./lib/context-compiler.mjs";
import { createExecutionContract, createWholePlanSnapshot } from "./lib/execution-lineage.mjs";
import { startRun } from "./lib/run-lineage.mjs";
import { runCommand } from "./head.mjs";
import { dispatch } from "./mcp-server.mjs";
import { buildRuntimeVersionEvidence } from "./lib/runtime-machine-execution.mjs";
import {
  buildRuntimeProjectBinding,
  buildRuntimeProtocolEvidence,
} from "./lib/runtime-protocol-evidence.mjs";
import {
  buildRuntimeInvocationAuthorization,
  buildRuntimeResultPacketDraft,
  inspectRuntimeInvocationExecutionLease,
  readRuntimeInvocationAuthorization,
  runRuntimeLifecycleConformance,
  verifyRuntimeInvocationAuthorization,
  verifyRuntimeInvocationLifecycleReceipt,
  verifyRuntimeResultPacketDraft,
} from "./lib/runtime-invocation-lifecycle.mjs";
import {
  verifyRuntimeExecutionLeaseConsumption,
  verifyRuntimeExecutionLeaseRelease,
} from "./lib/runtime-execution-lease.mjs";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = path.join(pluginRoot, `.test-tmp-runtime-lifecycle-${process.pid}-${Date.now()}`);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function recordProcess(event) {
  if (event.type === "spawn") {
    process.stderr.write(`NESTED_CHILD_START pid=${event.pid} parent=${event.parentPid} command=${event.command} cwd=${event.cwd} ports=${event.ports}\n`);
  } else {
    process.stderr.write(`NESTED_CHILD_END pid=${event.pid} parent=${event.parentPid} exit=${event.exitCode ?? "null"} signal=${event.signal}\n`);
  }
}

function recordingSpawn(command, args, options) {
  const child = spawn(command, args, options);
  child.once("spawn", () => recordProcess({
    type: "spawn",
    pid: child.pid,
    parentPid: process.pid,
    command: [command, ...args].join(" "),
    cwd: options.cwd,
    ports: "none",
  }));
  child.once("exit", (exitCode, signal) => recordProcess({
    type: "exit",
    pid: child.pid,
    parentPid: process.pid,
    exitCode,
    signal: signal || "none",
  }));
  return child;
}

async function main() {
  const resolvedRoot = path.resolve(temporaryRoot);
  assert(resolvedRoot.startsWith(`${pluginRoot}${path.sep}`) && path.basename(resolvedRoot).startsWith(".test-tmp-runtime-lifecycle-"), "Temporary lifecycle root escaped the plugin workspace.");
  fs.mkdirSync(resolvedRoot, { recursive: false });
  try {
    fs.writeFileSync(path.join(resolvedRoot, "example.mjs"), "export const answer = 42;\n", "utf8");
    const initialized = initializeProject({ root: resolvedRoot, pluginRoot, runtimes: ["codex", "opencode"] });
    assert(initialized.status === "ready", "Fixture project initialization failed.");
    const initializedProject = inspectProject(resolvedRoot);
    assert(initializedProject.status === "ready", "Fixture project did not remain ready after initialization.");
    const capsule = compileContext({
      root: resolvedRoot,
      task: "Prove bounded provider-neutral runtime lifecycle conformance without changing project files.",
      budget: 1_024,
      persist: true,
    }).capsule;
    const plan = createWholePlanSnapshot({
      root: resolvedRoot,
      objective: "Verify the runtime invocation lifecycle boundary.",
      plan: ["Bind the active Run", "Execute a no-descendant conformance fixture", "Return a ResultPacket draft"],
      invariants: ["Do not mutate Product Canon", "Do not persist raw provider output"],
      persist: true,
    }).artifact;
    const contract = createExecutionContract({
      root: resolvedRoot,
      wholePlanId: plan.wholePlanId,
      capsuleId: capsule.capsuleId,
      scope: "Execute the bounded runtime lifecycle conformance fixture only.",
      acceptanceCriteria: ["Exact child exit is observed", "Events are JSONL-bounded", "A transcript-free ResultPacket draft is produced"],
      constraints: ["No actual provider invocation", "No descendants", "No project mutation"],
      allowedActions: ["runtime.invoke", "project.read"],
      forbiddenActions: ["project.write", "network.write", "canon.mutate"],
      persist: true,
    }).artifact;
    const run = startRun({ root: resolvedRoot, executionContractId: contract.executionContractId }).run;
    const versionEvidence = await buildRuntimeVersionEvidence({
      runtimes: ["codex", "opencode"],
      spawnImplementation: recordingSpawn,
    });
    const protocolEvidence = await buildRuntimeProtocolEvidence({
      runtimes: ["codex", "opencode"],
      versionEvidence,
      spawnImplementation: recordingSpawn,
    });
    const projectBinding = buildRuntimeProjectBinding({
      projectId: initialized.project.projectId,
      headSessionId: initializedProject.state.sessionId,
      projectRoot: resolvedRoot,
      projectStatus: "ready",
      versionEvidence,
      protocolEvidence,
    });
    const results = [];
    for (const runtime of ["codex", "opencode"]) {
      const authorization = buildRuntimeInvocationAuthorization({
        root: resolvedRoot,
        runtime,
        workspaceMode: "read-only",
        protocolEvidence,
        projectBinding,
        limits: { timeoutMs: 5_000 },
        persist: true,
      }).authorization;
      verifyRuntimeInvocationAuthorization(authorization);
      const read = readRuntimeInvocationAuthorization({ root: resolvedRoot, authorizationId: authorization.authorizationId });
      assert(read.authorization.authorizationHash === authorization.authorizationHash, `${runtime} authorization did not round-trip.`);
      const cliRead = await runCommand(["runtime-invocation-read", resolvedRoot, "--authorization", authorization.authorizationId]);
      assert(cliRead.authorization.authorizationHash === authorization.authorizationHash, `${runtime} CLI authorization read failed.`);
      const mcpRead = await dispatch({
        jsonrpc: "2.0",
        id: runtime,
        method: "tools/call",
        params: { name: "head_runtime_invocation_authorization", arguments: { project_root: resolvedRoot, authorization_id: authorization.authorizationId } },
      });
      assert(mcpRead.result?.structuredContent?.authorization?.authorizationHash === authorization.authorizationHash, `${runtime} MCP authorization read failed.`);
      const success = await runRuntimeLifecycleConformance({
        root: resolvedRoot,
        authorization,
        mode: "success",
        onProcessEvent: recordProcess,
      });
      verifyRuntimeInvocationLifecycleReceipt(success.receipt);
      assert(success.receipt.status === "completed", `${runtime} success lifecycle did not complete.`);
      assert(success.receipt.processBoundary.descendantTreeOwnershipValidated === true, `${runtime} fixture ownership was not validated.`);
      assert(success.receipt.inputDigestObserved === authorization.executionInput.digest, `${runtime} input digest was not observed.`);
      verifyRuntimeExecutionLeaseConsumption(success.executionLease.consumption);
      verifyRuntimeExecutionLeaseRelease(success.executionLease.release);
      const tamperedConsumption = { ...success.executionLease.consumption, consumedAt: new Date(0).toISOString() };
      let consumptionTamperRejected = false;
      try { verifyRuntimeExecutionLeaseConsumption(tamperedConsumption); }
      catch { consumptionTamperRejected = true; }
      assert(consumptionTamperRejected, `${runtime} execution lease consumption tamper was accepted.`);
      assert(success.executionLease.release.operationStatus === "completed", `${runtime} execution lease release did not record completion.`);
      const leaseStatus = inspectRuntimeInvocationExecutionLease({ root: resolvedRoot, authorizationId: authorization.authorizationId });
      assert(leaseStatus.lease.status === "consumed-released", `${runtime} execution lease did not remain durably consumed.`);
      assert(leaseStatus.lease.replayAllowed === false, `${runtime} execution authorization remained replayable.`);
      const cliLeaseStatus = await runCommand(["runtime-invocation-lease-status", resolvedRoot, "--authorization", authorization.authorizationId]);
      assert(cliLeaseStatus.lease.release.releaseId === success.executionLease.release.releaseId, `${runtime} CLI lease inspection failed.`);
      const mcpLeaseStatus = await dispatch({
        jsonrpc: "2.0",
        id: `${runtime}-lease`,
        method: "tools/call",
        params: { name: "head_runtime_invocation_lease_status", arguments: { project_root: resolvedRoot, authorization_id: authorization.authorizationId } },
      });
      assert(mcpLeaseStatus.result?.structuredContent?.lease?.release?.releaseId === success.executionLease.release.releaseId, `${runtime} MCP lease inspection failed.`);
      let replayRejected = false;
      try {
        await runRuntimeLifecycleConformance({ root: resolvedRoot, authorization, mode: "success", onProcessEvent: recordProcess });
      } catch (error) {
        replayRejected = error.code === "RUNTIME_INVOCATION_AUTHORIZATION_ALREADY_CONSUMED";
      }
      assert(replayRejected, `${runtime} consumed authorization was replayed.`);
      const draft = buildRuntimeResultPacketDraft({
        authorization,
        receipt: success.receipt,
        leaseRelease: success.executionLease.release,
      });
      verifyRuntimeResultPacketDraft(draft);
      assert(draft.rawTranscriptIncluded === false && draft.finalResultPacketPersisted === false, `${runtime} draft crossed the result boundary.`);
      const publicArtifacts = JSON.stringify({ authorization, events: success.events, receipt: success.receipt, executionLease: success.executionLease, draft });
      assert(!publicArtifacts.includes(resolvedRoot), `${runtime} artifacts exposed the project root.`);
      assert(!publicArtifacts.includes("fixture-session"), `${runtime} artifacts exposed the provider-session reference.`);
      assert(!publicArtifacts.includes("answer = 42"), `${runtime} artifacts exposed project content.`);
      assert(!publicArtifacts.includes('"pid":'), `${runtime} artifacts exposed a PID.`);
      results.push({
        runtime,
        authorizationId: authorization.authorizationId,
        receiptId: success.receipt.receiptId,
        consumptionId: success.executionLease.consumption.consumptionId,
        releaseId: success.executionLease.release.releaseId,
        draftId: draft.draftId,
        eventCount: success.receipt.eventCount,
        replayRejected,
      });
    }
    const codexAuthorization = readRuntimeInvocationAuthorization({ root: resolvedRoot, authorizationId: results[0].authorizationId }).authorization;
    const timeoutAuthorization = {
      ...codexAuthorization,
      limits: { ...codexAuthorization.limits, timeoutMs: 1_000 },
    };
    delete timeoutAuthorization.authorizationId;
    delete timeoutAuthorization.authorizationHash;
    let timeoutRejected = false;
    try { verifyRuntimeInvocationAuthorization(timeoutAuthorization); }
    catch { timeoutRejected = true; }
    assert(timeoutRejected, "Tampered authorization was accepted.");
    const timeoutPlan = buildRuntimeInvocationAuthorization({
      root: resolvedRoot,
      runtime: "codex",
      workspaceMode: "read-only",
      protocolEvidence,
      projectBinding,
      limits: { timeoutMs: 1_000 },
      persist: true,
    }).authorization;
    const timedOut = await runRuntimeLifecycleConformance({
      root: resolvedRoot,
      authorization: timeoutPlan,
      mode: "wait",
      onProcessEvent: recordProcess,
    });
    assert(timedOut.receipt.status === "timed-out", "Timeout lifecycle did not fail closed.");
    assert(timedOut.receipt.processBoundary.exactChildExitObserved === true, "Timed-out child exit was not observed.");
    assert(timedOut.executionLease.release.operationStatus === "timed-out", "Timed-out lease release was not recorded.");
    const cancellationPlan = buildRuntimeInvocationAuthorization({
      root: resolvedRoot,
      runtime: "codex",
      workspaceMode: "read-only",
      protocolEvidence,
      projectBinding,
      limits: { timeoutMs: 5_000, maxEvents: 4_095 },
      persist: true,
    }).authorization;
    const cancellation = new AbortController();
    const cancellationRun = runRuntimeLifecycleConformance({
      root: resolvedRoot,
      authorization: cancellationPlan,
      mode: "wait",
      signal: cancellation.signal,
      onProcessEvent: recordProcess,
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const activeLease = inspectRuntimeInvocationExecutionLease({ root: resolvedRoot, authorizationId: cancellationPlan.authorizationId });
    assert(activeLease.lease.status === "consumed-active", "In-flight execution lease was not visible as consumed and active.");
    let concurrentReplayRejected = false;
    try {
      await runRuntimeLifecycleConformance({ root: resolvedRoot, authorization: cancellationPlan, mode: "success", onProcessEvent: recordProcess });
    } catch (error) {
      concurrentReplayRejected = error.code === "RUNTIME_INVOCATION_AUTHORIZATION_ALREADY_CONSUMED";
    }
    assert(concurrentReplayRejected, "Concurrent authorization replay was not rejected.");
    cancellation.abort();
    const cancelled = await cancellationRun;
    assert(cancelled.receipt.status === "cancelled", "Caller cancellation did not fail closed.");
    assert(cancelled.receipt.processBoundary.exactChildExitObserved === true, "Cancelled child exit was not observed.");
    assert(cancelled.executionLease.release.operationStatus === "cancelled", "Cancelled lease release was not recorded.");
    const spawnFailureAuthorization = buildRuntimeInvocationAuthorization({
      root: resolvedRoot,
      runtime: "codex",
      workspaceMode: "read-only",
      protocolEvidence,
      projectBinding,
      limits: { timeoutMs: 5_000, maxEvents: 4_094 },
      persist: true,
    }).authorization;
    let spawnFailureRejected = false;
    try {
      await runRuntimeLifecycleConformance({
        root: resolvedRoot,
        authorization: spawnFailureAuthorization,
        spawnImplementation: () => { throw new Error("synthetic spawn failure"); },
        onProcessEvent: recordProcess,
      });
    } catch (error) {
      spawnFailureRejected = error.code === "RUNTIME_CONFORMANCE_SPAWN_FAILED";
    }
    assert(spawnFailureRejected, "Synthetic spawn failure did not fail closed.");
    const spawnFailureLease = inspectRuntimeInvocationExecutionLease({
      root: resolvedRoot,
      authorizationId: spawnFailureAuthorization.authorizationId,
    });
    assert(spawnFailureLease.lease.status === "consumed-released", "Spawn failure lease was not durably released.");
    assert(spawnFailureLease.lease.release.operationStatus === "threw", "Spawn failure lease did not record the thrown operation.");
    let writeRejected = false;
    try {
      buildRuntimeInvocationAuthorization({
        root: resolvedRoot,
        runtime: "codex",
        workspaceMode: "workspace-write",
        protocolEvidence,
        projectBinding,
        persist: false,
      });
    } catch (error) {
      writeRejected = error.code === "RUNTIME_INVOCATION_NOT_AUTHORIZED";
    }
    assert(writeRejected, "Workspace-write invocation was not rejected by the read-only ExecutionContract.");
    process.stdout.write(`${JSON.stringify({
      status: "runtime_invocation_lifecycle_verified",
      projectId: initialized.project.projectId,
      sessionId: initializedProject.state.sessionId,
      runId: run.runId,
      executionContractId: contract.executionContractId,
      protocolEvidenceId: protocolEvidence.evidenceId,
      projectBindingId: projectBinding.bindingId,
      runtimes: results,
      timeoutReceiptId: timedOut.receipt.receiptId,
      cancellationReceiptId: cancelled.receipt.receiptId,
      singleUseLeaseVerified: true,
      replayRejected: true,
      concurrentReplayRejected,
      spawnFailureReleased: true,
      exactChildCleanupVerified: true,
      workspaceWriteRejected: true,
      rawTranscriptPersisted: false,
      actualProviderInvoked: false,
      providerControlEnabled: false,
    }, null, 2)}\n`);
  } finally {
    const resolved = path.resolve(temporaryRoot);
    if (!resolved.startsWith(`${pluginRoot}${path.sep}`) || !path.basename(resolved).startsWith(".test-tmp-runtime-lifecycle-")) {
      throw new Error("Refusing to remove an unverified lifecycle temporary directory.");
    }
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ status: "failed", code: error.code || "RUNTIME_LIFECYCLE_VERIFY_ERROR", error: error.message })}\n`);
  process.exitCode = 1;
});
