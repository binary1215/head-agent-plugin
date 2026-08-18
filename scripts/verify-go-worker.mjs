#!/usr/bin/env node

import path from "node:path";
import { executeComputeOperation, verifyComputeAdapterConformance } from "./lib/compute-adapter.mjs";
import {
  createWorkerHealthReferenceAdapter,
  GoWorkerComputeAdapter,
  WORKER_HEALTH_INPUT,
  WORKER_HEALTH_OPERATION,
  WORKER_HEALTH_SEMANTIC_PRODUCER,
  WORKER_LIFECYCLE_INPUT,
  WORKER_LIFECYCLE_OPERATION,
  WORKER_LIFECYCLE_SEMANTIC_PRODUCER,
} from "./lib/go-worker-adapter.mjs";

function pluginRootFrom(values) {
  if (values.length !== 2 || values[0] !== "--plugin-root" || !values[1]) throw new Error("usage: verify-go-worker.mjs --plugin-root <path>");
  return path.resolve(values[1]);
}

function processExists(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

async function waitForNoOwnedProcesses(adapter) {
  const deadline = Date.now() + 2_000;
  while (adapter.activeProcessIds().length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
  if (adapter.activeProcessIds().length) throw new Error(`Go worker PIDs remained after cancellation: ${adapter.activeProcessIds().join(",")}`);
}

try {
  const pluginRoot = pluginRootFrom(process.argv.slice(2));
  const referenceAdapter = createWorkerHealthReferenceAdapter();
  const candidateAdapter = new GoWorkerComputeAdapter({ pluginRoot });
  const fixture = {
    name: "worker-health",
    operation: WORKER_HEALTH_OPERATION,
    input: WORKER_HEALTH_INPUT,
    semanticProducer: WORKER_HEALTH_SEMANTIC_PRODUCER,
  };
  const conformance = await verifyComputeAdapterConformance({ referenceAdapter, candidateAdapter, fixtures: [fixture] });
  const execution = await executeComputeOperation({
    adapter: candidateAdapter,
    operation: WORKER_HEALTH_OPERATION,
    input: WORKER_HEALTH_INPUT,
    semanticProducer: WORKER_HEALTH_SEMANTIC_PRODUCER,
  });
  if (execution.diagnostics.backend !== "go-worker" || execution.diagnostics.fallbackUsed !== false) throw new Error("verification used fallback instead of the Go worker");
  if (execution.result.status !== "ready" || execution.result.instructionAuthority !== false
    || execution.result.promotionAuthority !== false || execution.result.controlAuthority !== false) throw new Error("Go worker health result violates its authority contract");
  if (processExists(execution.diagnostics.workerPid)) throw new Error(`Go worker PID ${execution.diagnostics.workerPid} remained alive after response`);
  let cancellation = "not-advertised";
  if (candidateAdapter.describe().supportedOperations.includes(WORKER_LIFECYCLE_OPERATION)) {
    try {
      await executeComputeOperation({
        adapter: candidateAdapter,
        operation: WORKER_LIFECYCLE_OPERATION,
        input: WORKER_LIFECYCLE_INPUT,
        semanticProducer: WORKER_LIFECYCLE_SEMANTIC_PRODUCER,
        limits: { timeoutMs: 10 },
      });
      throw new Error("lifecycle fixture unexpectedly completed");
    } catch (error) {
      if (error.code !== "COMPUTE_TIMEOUT") throw error;
    }
    await waitForNoOwnedProcesses(candidateAdapter);
    cancellation = "verified-timeout-and-pid-exit";
  }
  process.stdout.write(`${JSON.stringify({
    status: "verified",
    operation: WORKER_HEALTH_OPERATION,
    conformanceReportId: conformance.conformanceReportId,
    resultDigest: execution.response.resultDigest,
    workerRelativePath: execution.diagnostics.workerRelativePath,
    workerSha256: execution.diagnostics.workerSha256,
    processCleanup: "verified-exited",
    cancellation,
    authorityEffect: "none",
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
