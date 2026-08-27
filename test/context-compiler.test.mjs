import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CONTEXT_BUDGET_TIERS, DEFAULT_CONTEXT_BUDGET, compileContext, requireSufficientContextCapsule } from "../scripts/lib/context-compiler.mjs";
import { previewContextWorkflow } from "../scripts/lib/context-workflow.mjs";
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
  assert.equal(throughMcp.result.structuredContent.workflow.status, "ready_for_head_semantic_assessment");
  assert.equal(throughMcp.result.structuredContent.workflow.nextAction.id, "head_assess_semantic_sufficiency");
  assert.equal(throughMcp.result.structuredContent.workflow.world.state, "current-verified");
  assert.equal(throughMcp.result.structuredContent.workflow.budget.autoEscalates, true);
  assert.equal(throughMcp.result.structuredContent.workflow.budget.autoEscalationPerformed, false);
  assert.deepEqual(throughMcp.result.structuredContent.workflow.budget.attemptedTiers, [DEFAULT_CONTEXT_BUDGET]);
  assert.equal(throughMcp.result.structuredContent.workflow.authority.judgesSemanticSufficiency, false);
  assert.equal(throughMcp.result.structuredContent.workflow.authority.persistsCapsule, false);
  assert.equal(Buffer.byteLength(JSON.stringify(throughMcp.result.structuredContent.workflow), "utf8") < 32 * 1024, true);
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
  const guidedNoNeeds = previewContextWorkflow({ root, task, budget: DEFAULT_CONTEXT_BUDGET });
  assert.equal(guidedNoNeeds.workflow.status, "evidence_needs_unassessed");
  assert.equal(guidedNoNeeds.workflow.nextAction.id, "head_define_evidence_needs_or_explicitly_accept_none");
  assert.equal(guidedNoNeeds.workflow.evidenceNeeds.owner, "HEAD");
  assert.equal(guidedNoNeeds.workflow.authority.selectsEvidenceNeeds, false);

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
  const guidedGap = previewContextWorkflow({ root, task, budget: DEFAULT_CONTEXT_BUDGET, evidenceNeeds: missingTestNeed });
  assert.equal(guidedGap.workflow.status, "evidence_gap_requires_head_action");
  assert.equal(guidedGap.workflow.budget.nextEligibleTier, null);
  assert.equal(guidedGap.workflow.budget.autoEscalationPerformed, false);
  assert.equal(guidedGap.workflow.budget.autoEscalationStopReason, "non-budget-evidence-gap");
  assert.equal(guidedGap.workflow.nextAction.id, "gather_evidence_or_revise_the_head_requirement");
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

test("Context workflow guides World freshness without mutation or authority", async (t) => {
  const root = temporaryProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  const sourceFile = path.join(root, "src", "controller.mjs");
  fs.writeFileSync(sourceFile, "export function control() { return true; }\n");
  initializeProject({ root, pluginRoot, runtimes: ["codex"] });

  const repositoryNeed = [{ id: "controller-source", kind: "repository-source", facets: ["controller"] }];
  const withoutWorld = previewContextWorkflow({ root, task: "Inspect controller source", evidenceNeeds: repositoryNeed });
  assert.equal(withoutWorld.workflow.status, "world_evidence_unavailable");
  assert.equal(withoutWorld.workflow.nextAction.id, "build_world_explicitly_or_revise_evidence_needs");
  assert.equal(withoutWorld.workflow.budget.autoEscalationPerformed, false);
  assert.equal(withoutWorld.workflow.budget.autoEscalationStopReason, "world-evidence-unavailable");
  assert.equal(withoutWorld.workflow.authority.mutatesWorldModel, false);

  await buildWorldModel({ root });
  const pointerFile = path.join(root, ".head", "world-model", "current.json");
  const pointerBefore = fs.readFileSync(pointerFile, "utf8");
  const capsuleDirectory = path.join(root, ".head", "context", "capsules");
  const capsulesBefore = fs.existsSync(capsuleDirectory) ? fs.readdirSync(capsuleDirectory).sort() : [];
  fs.appendFileSync(sourceFile, "export const changed = true;\n");

  const stale = previewContextWorkflow({ root, task: "Inspect controller source", evidenceNeeds: repositoryNeed });
  assert.equal(stale.workflow.status, "world_refresh_required");
  assert.equal(stale.workflow.world.state, "stale-excluded");
  assert.equal(stale.workflow.nextAction.id, "refresh_world_explicitly");
  assert.equal(stale.workflow.nextAction.mcpTool, null);
  assert.equal(stale.workflow.budget.autoEscalationPerformed, false);
  assert.equal(stale.workflow.budget.autoEscalationStopReason, "world-refresh-required");
  assert.equal(stale.workflow.capsule.persisted, false);
  assert.equal(fs.readFileSync(pointerFile, "utf8"), pointerBefore);
  assert.deepEqual(fs.existsSync(capsuleDirectory) ? fs.readdirSync(capsuleDirectory).sort() : [], capsulesBefore);
});

test("Context workflow automatically retries only justified fixed budget tiers", async (t) => {
  const root = temporaryProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeProject({ root, pluginRoot, runtimes: ["codex"] });
  const knowledgeFile = path.join(root, ".head", "context", "knowledge.json");
  const knowledge = JSON.parse(fs.readFileSync(knowledgeFile, "utf8"));
  knowledge.claims = Array.from({ length: 20 }, (_, index) => ({
    id: `claim-budget-${index}`,
    statement: `Budget evidence ${index} ${"bounded context evidence ".repeat(420)}`,
    status: "active",
    importance: 5,
    tags: ["budget"],
    evidenceIds: [],
  }));
  fs.writeFileSync(knowledgeFile, `${JSON.stringify(knowledge, null, 2)}\n`);
  const task = "Inspect all budget evidence claims";
  const needs = [{ id: "budget-claims", kind: "claim", facets: ["budget"], minimumItems: 20 }];

  const constrained = previewContextWorkflow({ root, task, budget: 32_768, evidenceNeeds: needs });
  assert.equal(constrained.workflow.status, "ready_for_head_semantic_assessment");
  assert.equal(constrained.workflow.budget.requestedTier, 32_768);
  assert.equal(constrained.workflow.budget.currentTier, 65_536);
  assert.equal(constrained.workflow.budget.nextEligibleTier, null);
  assert.equal(constrained.workflow.budget.autoEscalates, true);
  assert.equal(constrained.workflow.budget.autoEscalationPerformed, true);
  assert.equal(constrained.workflow.budget.autoEscalationStopReason, "mechanical-coverage-complete");
  assert.deepEqual(constrained.workflow.budget.attemptedTiers, [32_768, 65_536]);
  assert.equal(constrained.workflow.budget.attempts[0].workflowStatus, "budget_expansion_required");
  assert.equal(constrained.workflow.budget.attempts[1].workflowStatus, "ready_for_head_semantic_assessment");
  assert.equal(constrained.capsule.budget.maxApproxTokens, 65_536);
  assert.equal(fs.existsSync(path.join(root, ".head", "context", "capsules")), false);

  const throughMcp = await dispatchMcp({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "head_context_preview", arguments: { project_root: root, task, budget: 32_768, evidence_needs: needs } },
  });
  assert.equal(throughMcp.result.structuredContent.capsule.capsuleId, constrained.capsule.capsuleId);
  assert.deepEqual(throughMcp.result.structuredContent.workflow.budget.attemptedTiers, [32_768, 65_536]);

  const expanded = previewContextWorkflow({ root, task, budget: 65_536, evidenceNeeds: needs });
  assert.equal(expanded.workflow.status, "ready_for_head_semantic_assessment");
  assert.equal(expanded.workflow.budget.autoEscalationPerformed, false);
  assert.deepEqual(expanded.workflow.budget.attemptedTiers, [65_536]);
  assert.equal(expanded.workflow.budget.nextEligibleTier, null);
  assert.equal(expanded.capsule.budget.maxApproxTokens, 65_536);

  const oversizedClaims = Array.from({ length: 20 }, (_, index) => ({
    id: `claim-ceiling-${index}`,
    statement: `Ceiling evidence ${index} ${"bounded ceiling evidence ".repeat(5_200)}`,
    status: "active",
    importance: 5,
    tags: ["ceiling"],
    evidenceIds: [],
  }));
  knowledge.claims = oversizedClaims;
  fs.writeFileSync(knowledgeFile, `${JSON.stringify(knowledge, null, 2)}\n`);
  const ceiling = previewContextWorkflow({
    root,
    task: "Inspect all ceiling evidence claims",
    budget: 32_768,
    evidenceNeeds: [{ id: "ceiling-claims", kind: "claim", facets: ["ceiling"], minimumItems: 20 }],
  });
  assert.equal(ceiling.workflow.status, "evidence_gap_requires_head_action");
  assert.equal(ceiling.workflow.budget.currentTier, 524_288);
  assert.deepEqual(ceiling.workflow.budget.attemptedTiers, CONTEXT_BUDGET_TIERS);
  assert.equal(ceiling.workflow.budget.autoEscalationPerformed, true);
  assert.equal(ceiling.workflow.budget.autoEscalationStopReason, "hard-maximum-reached");
  assert.equal(ceiling.workflow.budget.nextEligibleTier, null);
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
