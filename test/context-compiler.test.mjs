import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CONTEXT_BUDGET_TIERS, DEFAULT_CONTEXT_BUDGET, compileContext, requireSufficientContextCapsule } from "../scripts/lib/context-compiler.mjs";
import { initializeProject } from "../scripts/lib/head-core.mjs";
import { buildWorldModel } from "../scripts/lib/world-model.mjs";
import { dispatch as dispatchMcp } from "../scripts/mcp-server.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");

function temporaryProject() {
  const parent = process.env.HEAD_AGENT_TEST_TMP || os.tmpdir();
  fs.mkdirSync(parent, { recursive: true });
  return fs.mkdtempSync(path.join(parent, "head-context-sufficiency-test-"));
}

test("HEAD defines task evidence needs and Compiler proves only actual inclusion", async (t) => {
  const root = temporaryProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "tests"), { recursive: true });
  fs.mkdirSync(path.join(root, "patchnote_md"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "CommandReceiver_asan.py"), [
    "from ModbusCommandReceiver import ModbusCommandReceiver",
    "",
    "class CommandReceiverAsan:",
    "    def receive_asan_command(self):",
    "        return 'asan'",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(root, "src", "ModbusCommandReceiver.py"), [
    "class ModbusCommandReceiver:",
    "    def receive_modbus_command(self):",
    "        return 'modbus'",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(root, "src", "LegacyModbusBridge.py"), [
    "class LegacyModbusBridge:",
    "    def translate_modbus_command(self):",
    "        return 'legacy-modbus'",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(root, "tests", "test_modbus_contract.py"), [
    "def test_modbus_command_contract():",
    "    assert True",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(root, "patchnote_md", "architecture_report.md"), [
    "# Complete Modbus ASAN redesign flow",
    ...Array.from({ length: 40 }, (_, index) => `## Modbus ASAN architecture report section ${index}`),
    "",
  ].join("\n"));

  initializeProject({ root, pluginRoot, runtimes: ["codex"] });
  await buildWorldModel({ root });

  const task = "Redesign the ASAN flow and Modbus command architecture";
  const evidenceNeeds = [
    {
      id: "asan-implementation",
      kind: "repository-source",
      facets: ["ASAN"],
      rationale: "The task changes the ASAN implementation.",
    },
    {
      id: "modbus-implementations",
      kind: "repository-source",
      facets: ["Modbus"],
      minimumItems: 2,
      rationale: "The task spans the current receiver and legacy bridge.",
    },
    {
      id: "modbus-import-edge",
      kind: "semantic-relation",
      facets: ["Modbus"],
      relationTypes: ["IMPORTS"],
      rationale: "The direct import boundary must be present.",
    },
  ];
  const first = compileContext({ root, task, budget: DEFAULT_CONTEXT_BUDGET, evidenceNeeds, persist: false });
  const second = compileContext({ root, task, budget: DEFAULT_CONTEXT_BUDGET, evidenceNeeds: [...evidenceNeeds].reverse(), persist: false });
  assert.equal(first.capsule.capsuleId, second.capsule.capsuleId);
  const throughMcp = await dispatchMcp({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "head_context_preview", arguments: { project_root: root, task, budget: DEFAULT_CONTEXT_BUDGET, evidence_needs: evidenceNeeds } },
  });
  assert.equal(throughMcp.result.structuredContent.capsule.capsuleId, first.capsule.capsuleId);
  assert.equal(first.capsule.coverageAssessment.status, "coverage-complete");
  assert.equal(first.capsule.coverageAssessment.mechanicalCoverageSatisfied, true);
  assert.equal(first.capsule.coverageAssessment.semanticAcceptance, "not-assessed-HEAD-owned");
  assert.equal(first.capsule.coverageAssessment.satisfiedEvidenceNeedIds.includes("asan-implementation"), true);
  assert.equal(first.capsule.coverageAssessment.satisfiedEvidenceNeedIds.includes("modbus-implementations"), true);
  assert.equal(first.capsule.coverageAssessment.satisfiedEvidenceNeedIds.includes("modbus-import-edge"), true);
  assert.equal(first.capsule.coverageAssessment.proofDigest.length, 64);
  assert.equal(first.capsule.evidenceNeedContract.owner, "HEAD");
  assert.equal(first.capsule.evidenceNeedContract.needs.some((item) => item.kind === "repository-test"), false);
  assert.equal(first.capsule.sufficiency.status, "coverage-complete");
  assert.equal(first.capsule.sufficiency.deprecated, true);
  assert.equal(first.capsule.sufficiency.executionEligible, true);
  assert.equal(first.capsule.repositoryContext.some((item) => item.classification === "source"), true);
  assert.equal(first.capsule.repositoryContext.some((item) => item.path === "src/ModbusCommandReceiver.py"), true);
  const importProof = first.capsule.coverageAssessment.proofs.find((item) => item.evidenceNeedId === "modbus-import-edge");
  assert.equal(importProof.includedEvidence.every((item) => first.capsule.selection.includedIds.includes(item.carrierCandidateId)), true);
  assert.equal(first.capsule.repositoryContext.some((item) => item.semanticRelationships.some((edge) => edge.type === "IMPORTS")), true);
  assert.equal(first.capsule.compiler.lexicalNormalization.includes("camel-snake-path"), true);

  const noNeeds = compileContext({ root, task, budget: DEFAULT_CONTEXT_BUDGET, persist: false });
  assert.equal(noNeeds.capsule.coverageAssessment.status, "not-requested");
  assert.equal(noNeeds.capsule.sufficiency.status, "unassessed");

  const missingTestNeed = [{
    id: "asan-test-evidence",
    kind: "repository-test",
    facets: ["asan"],
    rationale: "HEAD explicitly requires a test for this risk-bearing task.",
  }];
  const incomplete = compileContext({ root, task, budget: DEFAULT_CONTEXT_BUDGET, evidenceNeeds: missingTestNeed, persist: true });
  assert.equal(incomplete.status, "compiled");
  assert.equal(incomplete.capsule.coverageAssessment.status, "coverage-incomplete");
  assert.equal(incomplete.capsule.coverageAssessment.mechanicalCoverageSatisfied, false);
  assert.equal(incomplete.capsule.coverageAssessment.unmetEvidenceNeeds[0].evidenceNeed.id, "asan-test-evidence");
  assert.equal(incomplete.capsule.coverageAssessment.unmetEvidenceNeeds[0].availableMatchCount, 0);
  assert.equal(incomplete.capsule.sufficiency.executionEligible, false);
  assert.throws(
    () => requireSufficientContextCapsule({ root, capsuleId: incomplete.capsule.capsuleId }),
    { code: "CONTEXT_CAPSULE_COVERAGE_INCOMPLETE" },
  );

  const changedContract = compileContext({ root, task, budget: DEFAULT_CONTEXT_BUDGET, evidenceNeeds: evidenceNeeds.slice(0, 1), persist: false });
  assert.notEqual(first.capsule.capsuleId, changedContract.capsule.capsuleId);
  assert.throws(
    () => compileContext({ root, task, budget: DEFAULT_CONTEXT_BUDGET, evidenceNeeds: [{ id: "bad", kind: "repository-source", unexpected: true }] }),
    { code: "INVALID_EVIDENCE_NEEDS" },
  );
});

test("Context budget uses fixed approximate-token tiers from 32K through 512K", () => {
  const root = temporaryProject();
  try {
    initializeProject({ root, pluginRoot, runtimes: ["codex"] });
    assert.deepEqual(CONTEXT_BUDGET_TIERS, [32_768, 65_536, 131_072, 262_144, 524_288]);
    for (const budget of CONTEXT_BUDGET_TIERS) {
      const compiled = compileContext({ root, task: "Inspect current project context", budget, persist: false });
      assert.equal(compiled.capsule.budget.maxApproxTokens, budget);
      assert.equal(compiled.capsule.budget.tier, `approx-${budget / 1024}k`);
      assert.equal(compiled.capsule.budget.metric.exact, false);
      assert.equal(compiled.capsule.budget.metric.providerFit, "must-be-validated-at-runtime-adapter-boundary");
    }
    assert.equal(compileContext({ root, task: "Use the default tier", persist: false }).capsule.budget.maxApproxTokens, DEFAULT_CONTEXT_BUDGET);
    assert.throws(() => compileContext({ root, task: "Reject an arbitrary budget", budget: 50_000 }), { code: "INVALID_CONTEXT_BUDGET" });
    assert.throws(() => compileContext({ root, task: "Reject the discarded cap", budget: 786_432 }), { code: "INVALID_CONTEXT_BUDGET" });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
