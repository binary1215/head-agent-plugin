#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  ContractOnlyPlatformAdapter,
  ContractOnlyWorkspaceHostAdapter,
  ProjectionOnlyAgentRuntimeAdapter,
  RUNTIME_ADAPTER_PLATFORMS,
  RUNTIME_ADAPTER_RUNTIMES,
  buildRuntimeAdapterComposition,
  buildRuntimeAdapterContractMatrix,
  validateAgentRuntimeAdapter,
  verifyRuntimeAdapterComposition,
  verifyRuntimeAdapterContractMatrix,
} from "./lib/runtime-adapter.mjs";
import {
  RUNTIME_MACHINE_CONTROL_METHODS,
  ReadOnlyAgentRuntimeAdapter,
  ReadOnlyPlatformAdapter,
  ReadOnlyWorkspaceHostAdapter,
  buildRuntimeMachineComposition,
  verifyRuntimeMachineComposition,
} from "./lib/runtime-machine-discovery.mjs";
import {
  BoundedVersionAgentRuntimeAdapter,
  BoundedVersionPlatformAdapter,
  BoundedVersionWorkspaceHostAdapter,
  RUNTIME_VERSION_CONTROL_METHODS,
  buildRuntimeVersionEvidence,
  verifyRuntimeVersionEvidence,
} from "./lib/runtime-machine-execution.mjs";

const clone = (value) => JSON.parse(JSON.stringify(value));
const hasOwnKeyDeep = (value, key) => {
  if (Array.isArray(value)) return value.some((item) => hasOwnKeyDeep(item, key));
  if (!value || typeof value !== "object") return false;
  return Object.prototype.hasOwnProperty.call(value, key)
    || Object.values(value).some((item) => hasOwnKeyDeep(item, key));
};

try {
  const matrix = buildRuntimeAdapterContractMatrix();
  verifyRuntimeAdapterContractMatrix(matrix);
  assert.deepEqual(matrix, buildRuntimeAdapterContractMatrix());
  assert.deepEqual(matrix.platforms, RUNTIME_ADAPTER_PLATFORMS);
  assert.deepEqual(matrix.runtimes, RUNTIME_ADAPTER_RUNTIMES);
  assert.equal(matrix.actualPlatformExecutionValidated, false);
  assert.equal(matrix.actualRuntimeControlValidated, false);

  const compositions = RUNTIME_ADAPTER_PLATFORMS.map((platform) => {
    const first = buildRuntimeAdapterComposition({ platform, runtimes: [...RUNTIME_ADAPTER_RUNTIMES].reverse() });
    const repeated = buildRuntimeAdapterComposition({ platform, runtimes: RUNTIME_ADAPTER_RUNTIMES });
    assert.deepEqual(first, repeated);
    verifyRuntimeAdapterComposition(first);
    assert.equal(first.activationBoundary.runtimeControlEnabled, false);
    assert.equal(first.activationBoundary.machineInterfacesVerified, false);
    assert.equal(first.activationBoundary.tuiScrapingAllowed, false);
    assert.equal(first.controlAuthority, false);
    assert.equal(first.mutatesCanon, false);
    return first;
  });

  for (const runtime of RUNTIME_ADAPTER_RUNTIMES) {
    const adapter = new ProjectionOnlyAgentRuntimeAdapter({ runtime });
    validateAgentRuntimeAdapter(adapter);
    for (const operation of ["start", "resume", "stream", "interrupt", "close"]) {
      assert.throws(() => adapter[operation](), { code: "RUNTIME_ADAPTER_CONTROL_NOT_ENABLED" });
    }
  }
  const platformAdapter = new ContractOnlyPlatformAdapter({ platform: process.platform });
  for (const method of ["resolveExecutable", "spawnOwned", "inspectOwned", "terminateOwned"]) {
    assert.throws(() => platformAdapter[method](), { code: "RUNTIME_ADAPTER_CONTROL_NOT_ENABLED" });
  }
  const hostAdapter = new ContractOnlyWorkspaceHostAdapter();
  for (const method of ["attach", "send", "receive", "detach"]) {
    assert.throws(() => hostAdapter[method](), { code: "RUNTIME_ADAPTER_CONTROL_NOT_ENABLED" });
  }

  class EscalatingRuntimeAdapter extends ProjectionOnlyAgentRuntimeAdapter {
    describe() { return { ...super.describe(), controlOperationsEnabled: true, controlAuthority: true }; }
  }
  assert.throws(
    () => validateAgentRuntimeAdapter(new EscalatingRuntimeAdapter({ runtime: "codex" })),
    { code: "INVALID_AGENT_RUNTIME_ADAPTER" },
  );
  class DivergentRuntimeAdapter extends ProjectionOnlyAgentRuntimeAdapter {
    probe() { return new ProjectionOnlyAgentRuntimeAdapter({ runtime: "opencode" }).probe(); }
  }
  assert.throws(
    () => validateAgentRuntimeAdapter(new DivergentRuntimeAdapter({ runtime: "codex" })),
    { code: "INVALID_AGENT_RUNTIME_ADAPTER" },
  );
  assert.throws(
    () => buildRuntimeAdapterComposition({ runtimes: [] }),
    { code: "RUNTIME_ADAPTER_RUNTIME_REQUIRED" },
  );
  const tampered = clone(compositions[0]);
  tampered.activationBoundary.runtimeControlEnabled = true;
  assert.throws(() => verifyRuntimeAdapterComposition(tampered), { code: "INVALID_RUNTIME_ADAPTER_COMPOSITION" });
  assert.equal(hasOwnKeyDeep(compositions, "providerSessionId"), false);

  const machineComposition = buildRuntimeMachineComposition();
  verifyRuntimeMachineComposition(machineComposition);
  assert.equal(machineComposition.activationBoundary.machineInterfaceDiscoveryValidated, true);
  assert.equal(machineComposition.activationBoundary.actualPlatformExecutionValidated, false);
  assert.equal(machineComposition.activationBoundary.runtimeControlEnabled, false);
  assert.equal(machineComposition.discoverySummary.rawPathsExposed, false);
  assert.equal(hasOwnKeyDeep(machineComposition, "path"), false);
  assert.equal(hasOwnKeyDeep(machineComposition, "executablePath"), false);
  assert.equal(hasOwnKeyDeep(machineComposition, "providerSessionId"), false);
  const discoveryPlatform = new ReadOnlyPlatformAdapter();
  for (const runtime of RUNTIME_ADAPTER_RUNTIMES) {
    const adapter = new ReadOnlyAgentRuntimeAdapter({ runtime, platformAdapter: discoveryPlatform });
    for (const method of RUNTIME_MACHINE_CONTROL_METHODS.agent) {
      assert.throws(() => adapter[method](), { code: "RUNTIME_ADAPTER_CONTROL_NOT_ENABLED" });
    }
  }
  for (const method of RUNTIME_MACHINE_CONTROL_METHODS.platform) {
    assert.throws(() => discoveryPlatform[method](), { code: "RUNTIME_ADAPTER_CONTROL_NOT_ENABLED" });
  }
  const discoveryHost = new ReadOnlyWorkspaceHostAdapter();
  for (const method of RUNTIME_MACHINE_CONTROL_METHODS.workspaceHost) {
    assert.throws(() => discoveryHost[method](), { code: "RUNTIME_ADAPTER_CONTROL_NOT_ENABLED" });
  }

  const versionEvidence = await buildRuntimeVersionEvidence();
  verifyRuntimeVersionEvidence(versionEvidence);
  assert.equal(versionEvidence.activationBoundary.actualRuntimeControlValidated, false);
  assert.equal(versionEvidence.activationBoundary.runtimeControlEnabled, false);
  assert.equal(versionEvidence.activationBoundary.providerSessionCreated, false);
  assert.equal(versionEvidence.summary.rawPathsExposed, false);
  assert.equal(versionEvidence.summary.rawOutputExposed, false);
  assert.equal(hasOwnKeyDeep(versionEvidence, "path"), false);
  assert.equal(hasOwnKeyDeep(versionEvidence, "executablePath"), false);
  assert.equal(hasOwnKeyDeep(versionEvidence, "stdout"), false);
  assert.equal(hasOwnKeyDeep(versionEvidence, "stderr"), false);
  assert.equal(hasOwnKeyDeep(versionEvidence, "providerSessionId"), false);
  const tamperedVersionEvidence = clone(versionEvidence);
  tamperedVersionEvidence.activationBoundary.runtimeControlEnabled = true;
  assert.throws(() => verifyRuntimeVersionEvidence(tamperedVersionEvidence), { code: "INVALID_RUNTIME_VERSION_EVIDENCE" });
  await assert.rejects(() => buildRuntimeVersionEvidence({ runtimes: [] }), { code: "RUNTIME_VERSION_RUNTIME_REQUIRED" });
  const versionHost = new BoundedVersionWorkspaceHostAdapter();
  const versionPlatform = new BoundedVersionPlatformAdapter({ workspaceHostAdapter: versionHost });
  for (const runtime of RUNTIME_ADAPTER_RUNTIMES) {
    const adapter = new BoundedVersionAgentRuntimeAdapter({ runtime, platformAdapter: versionPlatform });
    for (const method of RUNTIME_VERSION_CONTROL_METHODS) {
      assert.throws(() => adapter[method](), { code: "RUNTIME_ADAPTER_CONTROL_NOT_ENABLED" });
    }
  }
  for (const method of ["spawnOwned", "inspectOwned", "terminateOwned"]) {
    assert.throws(() => versionPlatform[method](), { code: "RUNTIME_ADAPTER_CONTROL_NOT_ENABLED" });
  }
  for (const method of ["attach", "send", "receive", "detach"]) {
    assert.throws(() => versionHost[method](), { code: "RUNTIME_ADAPTER_CONTROL_NOT_ENABLED" });
  }

  process.stdout.write(`${JSON.stringify({
    status: "verified",
    matrixId: matrix.matrixId,
    compositionIds: compositions.map((item) => item.compositionId),
    platforms: matrix.platforms,
    runtimes: matrix.runtimes,
    runtimeControlEnabled: false,
    actualPlatformExecutionValidated: false,
    actualRuntimeControlValidated: false,
    machineDiscoveryCompositionId: machineComposition.compositionId,
    discoveredRuntimes: machineComposition.discoverySummary.discoveredRuntimes,
    unavailableRuntimes: machineComposition.discoverySummary.unavailableRuntimes,
    versionEvidenceId: versionEvidence.evidenceId,
    versionVerifiedRuntimes: versionEvidence.summary.verifiedRuntimes,
    versionUnavailableRuntimes: versionEvidence.summary.unavailableRuntimes,
    versionFailedRuntimes: versionEvidence.summary.failedRuntimes,
    boundedVersionExecutionValidated: versionEvidence.activationBoundary.actualPlatformExecutionValidated,
    authorityEffect: "none",
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.code ? `${error.code}: ` : ""}${error.message}\n`);
  process.exitCode = 1;
}
