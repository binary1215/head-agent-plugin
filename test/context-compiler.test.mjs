import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { CONTEXT_BUDGET_TIERS, DEFAULT_CONTEXT_BUDGET, compileContext, requireSufficientContextCapsule } from "../scripts/lib/context-compiler.mjs";
import { prepareContextWorkflow, previewContextWorkflow } from "../scripts/lib/context-workflow.mjs";
import { initializeProject } from "../scripts/lib/head-core.mjs";
import { buildWorldModel, readWorldModel } from "../scripts/lib/world-model.mjs";
import { dispatch as dispatchMcp } from "../scripts/mcp-server.mjs";
import { runCommand } from "../scripts/head.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");

function temporaryProject() {
  const parent = process.env.HEAD_AGENT_TEST_TMP || os.tmpdir();
  fs.mkdirSync(parent, { recursive: true });
  return fs.mkdtempSync(path.join(parent, "head-context-sufficiency-test-"));
}

function managedTreeSnapshot(root) {
  const headRoot = path.join(root, ".head");
  const result = {};
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else result[path.relative(headRoot, absolute).replaceAll("\\", "/")] = fs.readFileSync(absolute, "utf8");
    }
  };
  visit(headRoot);
  return result;
}

test("HEAD defines task evidence needs and Compiler proves only actual inclusion", async (t) => {
  const root = temporaryProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "tests"), { recursive: true });
  fs.mkdirSync(path.join(root, "patchnote_md"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "PrimaryRouter.py"), [
    "from DurableCommandStore import DurableCommandStore",
    "",
    "class PrimaryRouter:",
    "    def route_primary_command(self):",
    "        return 'primary-route'",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(root, "src", "DurableCommandStore.py"), [
    "class DurableCommandStore:",
    "    def store_durable_command(self):",
    "        return 'durable-command'",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(root, "src", "LegacyCommandBridge.py"), [
    "class LegacyCommandBridge:",
    "    def translate_legacy_command(self):",
    "        return 'legacy-command'",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(root, "src", "opaque-engine.mjs"), "export function zed(value) { return value; }\n");
  fs.writeFileSync(path.join(root, "tests", "test_command_contract.py"), [
    "def test_command_contract():",
    "    assert True",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(root, "patchnote_md", "architecture_report.md"), [
    "# Complete command routing redesign flow",
    ...Array.from({ length: 40 }, (_, index) => `## Command routing architecture report section ${index}`),
    "",
  ].join("\n"));

  initializeProject({ root, pluginRoot, runtimes: ["codex"] });
  await buildWorldModel({ root });

  const task = "Redesign the primary routing flow and durable command architecture";
  const evidenceNeeds = [
    {
      id: "router-implementation",
      kind: "repository-source",
      facets: ["Router"],
      rationale: "The task changes the primary routing implementation.",
    },
    {
      id: "command-implementations",
      kind: "repository-source",
      facets: ["Command"],
      minimumItems: 2,
      rationale: "The task spans the current store and legacy bridge.",
    },
    {
      id: "durable-import-edge",
      kind: "semantic-relation",
      facets: ["Durable"],
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
  assert.equal(throughMcp.result.structuredContent.workflow.explanation.kind, "ContextExplanationCard");
  assert.equal(throughMcp.result.structuredContent.workflow.explanation.semanticSufficiencyOwner, "HEAD");
  assert.equal(throughMcp.result.structuredContent.workflow.explanation.userDecisionRequired, false);
  assert.equal(throughMcp.result.structuredContent.workflow.explanation.included.totalCandidateCount, throughMcp.result.structuredContent.capsule.selection.includedIds.length);
  assert.equal(throughMcp.result.structuredContent.workflow.explanation.intentionallyOmitted.total, throughMcp.result.structuredContent.capsule.selection.excluded.length);
  assert.equal(Buffer.byteLength(JSON.stringify(throughMcp.result.structuredContent.workflow), "utf8") < 32 * 1024, true);
  assert.equal(first.capsule.coverageAssessment.status, "coverage-complete");
  assert.equal(first.capsule.coverageAssessment.mechanicalCoverageSatisfied, true);
  assert.equal(first.capsule.coverageAssessment.semanticAcceptance, "not-assessed-HEAD-owned");
  assert.equal(first.capsule.coverageAssessment.satisfiedEvidenceNeedIds.includes("router-implementation"), true);
  assert.equal(first.capsule.coverageAssessment.satisfiedEvidenceNeedIds.includes("command-implementations"), true);
  assert.equal(first.capsule.coverageAssessment.satisfiedEvidenceNeedIds.includes("durable-import-edge"), true);
  assert.equal(first.capsule.coverageAssessment.proofDigest.length, 64);
  assert.equal(first.capsule.evidenceNeedContract.owner, "HEAD");
  assert.equal(first.capsule.evidenceNeedContract.needs.some((item) => item.kind === "repository-test"), false);
  assert.equal(first.capsule.sufficiency.status, "coverage-complete");
  assert.equal(first.capsule.sufficiency.deprecated, true);
  assert.equal(first.capsule.sufficiency.executionEligible, true);
  assert.equal(first.capsule.repositoryContext.some((item) => item.classification === "source"), true);
  assert.equal(first.capsule.repositoryContext.some((item) => item.path === "src/DurableCommandStore.py"), true);
  const importProof = first.capsule.coverageAssessment.proofs.find((item) => item.evidenceNeedId === "durable-import-edge");
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

  const exactPathNeed = [{
    id: "actual-cli-defect",
    kind: "repository-source",
    paths: ["src/opaque-engine.mjs"],
    rationale: "Fresh HEAD identified this exact current file after semantic task analysis despite zero lexical overlap.",
  }];
  const exactPath = compileContext({ root, task: "Repair the user-facing command routing defect", evidenceNeeds: exactPathNeed });
  assert.equal(exactPath.capsule.coverageAssessment.status, "coverage-complete");
  assert.equal(exactPath.capsule.repositoryContext.some((item) => item.path === "src/opaque-engine.mjs"), true);
  assert.equal(exactPath.capsule.evidenceNeedContract.needs[0].paths[0], "src/opaque-engine.mjs");
  assert.deepEqual(exactPath.capsule.coverageAssessment.proofs[0].includedEvidence[0].representation, {
    kind: "repository-metadata",
    sourceBodyIncluded: false,
    sourceBodyConsumptionVerified: false,
  });
  const metadataIsNotContent = compileContext({ root, task, evidenceNeeds: [{
    id: "source-content-not-coverage-label", kind: "repository-source", paths: ["src/opaque-engine.mjs"], facets: ["consumption"],
  }] });
  assert.equal(metadataIsNotContent.capsule.coverageAssessment.proofs[0].availableMatchCount, 0);
  assert.equal(exactPath.capsule.compiler.lexicalRole, "fallback-ranking-only-never-candidate-eligibility-or-semantic-acceptance");
  const unguided = compileContext({ root, task: "Repair the user-facing command routing defect" });
  assert.equal(unguided.capsule.repositoryContext.some((item) => item.path === "src/opaque-engine.mjs"), true);
  assert.equal(unguided.capsule.selection.excluded.some((item) => item.reason === "low-relevance"), false);

  const missingTestNeed = [{
    id: "router-test-evidence",
    kind: "repository-test",
    facets: ["router"],
    rationale: "HEAD explicitly requires a test for this risk-bearing task.",
  }];
  const incomplete = compileContext({ root, task, budget: DEFAULT_CONTEXT_BUDGET, evidenceNeeds: missingTestNeed, persist: true });
  assert.equal(incomplete.status, "compiled");
  assert.equal(incomplete.capsule.coverageAssessment.status, "coverage-incomplete");
  assert.equal(incomplete.capsule.coverageAssessment.mechanicalCoverageSatisfied, false);
  assert.equal(incomplete.capsule.coverageAssessment.unmetEvidenceNeeds[0].evidenceNeed.id, "router-test-evidence");
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
  assert.throws(
    () => compileContext({ root, task, evidenceNeeds: [{ id: "bad-path", kind: "repository-source", paths: ["../outside.mjs"] }] }),
    { code: "INVALID_EVIDENCE_NEEDS" },
  );
});

test("HEAD relation paths preserve source and target evidence despite zero lexical overlap and discovery limits", async (t) => {
  const root = temporaryProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  const imports = Array.from({ length: 8 }, (_, index) => {
    fs.writeFileSync(path.join(root, "src", `store${index}.mjs`), `export const value${index} = ${index};\n`);
    return `import { value${index} } from './store${index}.mjs';`;
  });
  fs.writeFileSync(path.join(root, "src", "router.mjs"), `${imports.join("\n")}\nexport function route() { return value7; }\n`);
  fs.writeFileSync(path.join(root, "src", "unrelated.mjs"), "export const untouched = true;\n");
  for (let index = 0; index < 40; index += 1) {
    fs.writeFileSync(path.join(root, "src", `qzxvplmn-${index}.mjs`), "export const lexicalDistractor = true;\n");
  }
  initializeProject({ root, pluginRoot, runtimes: ["codex"] });
  const indexed = await buildWorldModel({ root });
  const before = managedTreeSnapshot(root);
  const task = "qzxvplmn";
  const noNeeds = compileContext({ root, task });
  const baselineRouter = noNeeds.capsule.repositoryContext.find((item) => item.path === "src/router.mjs");
  assert.ok(baselineRouter);
  assert.equal(baselineRouter.semanticRelationships.length, 0);
  assert.ok(baselineRouter.evidenceOmissions.semanticRelationships >= 8, "Unexpanded adjacency must be disclosed instead of reported as absent.");

  const sourceNeed = [{ id: "source-imports", kind: "semantic-relation", paths: ["src\\router.mjs"], relationTypes: ["IMPORTS"], minimumItems: 6 }];
  const source = compileContext({ root, task, evidenceNeeds: sourceNeed });
  assert.equal(source.capsule.coverageAssessment.status, "coverage-complete");
  const sourceProof = source.capsule.coverageAssessment.proofs[0];
  assert.ok(sourceProof.includedMatchCount >= 6, "The four-edge discovery sample must not override HEAD's explicit minimum.");
  const multiNeed = compileContext({ root, task, evidenceNeeds: [
    ...sourceNeed,
    { id: "last-two-targets", kind: "semantic-relation", paths: ["src/store6.mjs", "src/store7.mjs"], relationTypes: ["IMPORTS"], minimumItems: 2 },
  ] });
  assert.equal(multiNeed.capsule.coverageAssessment.status, "coverage-complete");
  for (const proof of multiNeed.capsule.coverageAssessment.proofs) {
    assert.ok(new Set(proof.includedEvidence.map((item) => item.id)).size >= proof.requiredMinimumItems);
  }
  for (const carrier of source.capsule.repositoryContext) {
    const containedEdges = carrier.semanticRelationships;
    assert.equal(carrier.evidenceOmissions.semanticRelationships,
      indexed.snapshot.semanticGraph.edges.filter((edge) => {
        const nodes = new Map(indexed.snapshot.semanticGraph.nodes.map((node) => [node.id, node]));
        return [edge.evidence?.path, nodes.get(edge.from)?.path, nodes.get(edge.to)?.path].includes(carrier.path);
      }).length - containedEdges.length);
  }
  for (const proof of sourceProof.includedEvidence) {
    const relation = source.capsule.repositoryContext.flatMap((item) => item.semanticRelationships).find((item) => item.id === proof.id);
    assert.equal(relation.from.path, "src/router.mjs");
    assert.equal(relation.evidence.path, "src/router.mjs");
    assert.ok(relation.endpointPaths.includes(relation.from.path));
    assert.ok(relation.endpointPaths.includes(relation.to.path));
    assert.ok(relation.endpointPaths.includes(relation.evidence.path));
  }
  const targetNeed = [{ id: "target-import", kind: "semantic-relation", paths: ["src/store7.mjs"], relationTypes: ["IMPORTS"] }];
  const target = compileContext({ root, task, evidenceNeeds: targetNeed });
  assert.equal(target.capsule.coverageAssessment.status, "coverage-complete");
  const targetProof = target.capsule.coverageAssessment.proofs[0];
  assert.equal(targetProof.availableMatchCount, 1);
  const targetRelation = target.capsule.repositoryContext.flatMap((item) => item.semanticRelationships).find((item) => item.id === targetProof.includedEvidence[0].id);
  assert.equal(targetRelation.to.path, "src/store7.mjs");
  const noPath = compileContext({ root, task, evidenceNeeds: [{ id: "any-import", kind: "semantic-relation", relationTypes: ["IMPORTS"] }] });
  assert.equal(noPath.capsule.coverageAssessment.status, "coverage-complete");
  for (const wrongPath of ["src/unrelated.mjs", "src/missing.mjs"]) {
    const missing = compileContext({ root, task, evidenceNeeds: [{ ...targetNeed[0], paths: [wrongPath] }] });
    assert.equal(missing.capsule.coverageAssessment.status, "coverage-incomplete");
    assert.equal(missing.capsule.coverageAssessment.proofs[0].availableMatchCount, 0);
  }
  const throughMcp = await dispatchMcp({ jsonrpc: "2.0", id: 91, method: "tools/call", params: {
    name: "head_context_preview", arguments: { project_root: root, task, evidence_needs: targetNeed },
  } });
  const needsFile = path.join(root, ".head", "relation-needs.json");
  fs.writeFileSync(needsFile, JSON.stringify(targetNeed));
  const throughCli = runCommand(["context-preview", root, "--task", task, "--evidence-needs", needsFile]);
  fs.unlinkSync(needsFile);
  assert.equal(throughMcp.result.structuredContent.capsule.capsuleId, target.capsule.capsuleId);
  assert.equal(throughCli.capsule.capsuleId, target.capsule.capsuleId);
  assert.deepEqual(managedTreeSnapshot(root), before, "Preview must not persist new authority or recovery artifacts.");
  assert.equal(target.capsule.coverageAssessment.semanticAcceptance, "not-assessed-HEAD-owned");
  assert.equal(target.capsule.coverageAssessment.authorityEffect, "none");
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
  assert.match(throughMcp.result.content[0].text, /requested evidence is included/u);
  assert.match(throughMcp.result.content[0].text, /Automatic expansion: 32,768 → 65,536/u);
  assert.match(throughMcp.result.content[0].text, /User action: none/u);
  assert.equal(throughMcp.result.content[0].text.trimStart().startsWith("{"), false);

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

test("Core-only Context preparation explains the explicit Product/World path without activating it", (t) => {
  const root = temporaryProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "router.mjs"), "export function route(value) { return value; }\n");
  initializeProject({ root, pluginRoot, runtimes: ["codex"] });
  const before = managedTreeSnapshot(root);

  const prepared = prepareContextWorkflow({ root, task: "Repair the current command routing behavior" });

  assert.deepEqual(managedTreeSnapshot(root), before);
  assert.equal(prepared.preparation.protocolVersion, "0.2.0");
  assert.equal(prepared.preparation.status, "curated_only");
  assert.equal(prepared.preparation.nextAction.id, "continue_core_only");
  assert.equal(prepared.preparation.nextAction.entrypoint.mode, "active-conversation");
  assert.equal(prepared.preparation.nextAction.optionalEscalation.requiresExplicitActivation, true);
  assert.equal(prepared.preparation.nextAction.optionalEscalation.mcpTool, "head_project_initialize_or_resume");
  assert.deepEqual(prepared.preparation.nextAction.optionalEscalation.mcpArguments, { profile: "product" });
  assert.equal(prepared.preparation.nextAction.optionalEscalation.coreSelectsPath, false);
  assert.equal(prepared.preparation.lexicalBaseline.includedRepositoryFileCount, 0);
  assert.equal(prepared.preparation.authority.persisted, false);
  assert.equal(prepared.preparation.authority.promotionAuthority, false);
  assert.equal(prepared.preparation.authority.instructionAuthority, false);
});

test("task-only Context preparation is a bounded P4 projection and CLI/MCP share its identity", async (t) => {
  const root = temporaryProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "test"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "router.mjs"), "export function route(value) { return value; }\n");
  fs.writeFileSync(path.join(root, "test", "router.test.mjs"), "import { route } from '../src/router.mjs';\nexport const result = route('ok');\n");
  initializeProject({ root, pluginRoot, runtimes: ["codex"] });
  await buildWorldModel({ root });
  const before = managedTreeSnapshot(root);
  const task = "Repair the current command routing behavior";

  const direct = prepareContextWorkflow({ root, task });
  const after = managedTreeSnapshot(root);
  assert.deepEqual(after, before);
  assert.equal(direct.status, "prepared");
  assert.equal(direct.preparation.status, "ready_for_head_evidence_proposal");
  assert.equal(direct.preparation.nextAction.entrypoint.mcpTool, "head_context_preview");
  assert.equal(direct.preparation.nextAction.entrypoint.requiresHeadSemanticProposal, true);
  assert.equal(direct.preparation.conversation.userInput, "task-text-only");
  assert.equal(direct.preparation.conversation.structuredInputAuthor, "provider-neutral-HEAD");
  assert.equal(direct.preparation.evidenceNeedContract.userMustWriteStructuredInput, false);
  assert.equal(direct.preparation.exactGraphAnchorMaterial.selectsAnchor, false);
  assert.equal(direct.preparation.authority.plane, "P4");
  assert.equal(direct.preparation.authority.persisted, false);
  assert.equal(direct.preparation.authority.selectsEvidenceNeeds, false);
  assert.equal(direct.preparation.authority.writesRecoveryDirection, false);
  assert.equal(direct.preparation.recoveryBoundary.p2RestoreFirst, true);
  assert.equal(direct.preparation.lexicalBaseline.repositoryFiles.some((item) => item.path === "src/router.mjs"), true);
  assert.equal(direct.preparation.exactGraphAnchorMaterial.candidateNodes.some((item) => item.path === "src/router.mjs"), true);
  assert.equal(Buffer.byteLength(JSON.stringify(direct.preparation), "utf8") < 64 * 1024, true);
  assert.equal(/providerSession|threadId|pane|socket|pid|Herdr/i.test(JSON.stringify(direct.preparation)), false);

  const throughMcp = await dispatchMcp({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "head_context_prepare", arguments: { project_root: root, task } },
  });
  const throughCli = runCommand(["context-prepare", root, "--task", task]);
  assert.equal(throughMcp.result.structuredContent.preparation.preparationId, direct.preparation.preparationId);
  assert.equal(throughCli.preparation.preparationId, direct.preparation.preparationId);
  assert.match(throughMcp.result.content[0].text, /User action: none/u);
  assert.match(throughMcp.result.content[0].text, /run the preview itself/u);
  assert.equal(throughMcp.result.content[0].text.trimStart().startsWith("{"), false);

  const humanCli = spawnSync(process.execPath, [path.join(pluginRoot, "scripts", "head.mjs"), "context-prepare", root, "--task", task], { encoding: "utf8" });
  assert.equal(humanCli.status, 0, humanCli.stderr);
  assert.match(humanCli.stdout, /current repository evidence is ready/u);
  assert.match(humanCli.stdout, /You do not need to write EvidenceNeed JSON/u);
  assert.equal(humanCli.stdout.trimStart().startsWith("{"), false);

  const jsonCli = spawnSync(process.execPath, [path.join(pluginRoot, "scripts", "head.mjs"), "context-prepare", root, "--task", task, "--json"], { encoding: "utf8" });
  assert.equal(jsonCli.status, 0, jsonCli.stderr);
  assert.equal(JSON.parse(jsonCli.stdout).preparation.preparationId, direct.preparation.preparationId);

  const anchorNode = direct.preparation.exactGraphAnchorMaterial.candidateNodes.find((item) => item.path === "src/router.mjs");
  fs.appendFileSync(path.join(root, "src", "router.mjs"), "export const changed = true;\n");
  const stale = prepareContextWorkflow({ root, task });
  assert.equal(stale.preparation.status, "world_refresh_required");
  assert.equal(stale.preparation.nextAction.entrypoint.requiresExplicitMutation, true);
  assert.equal(stale.preparation.nextAction.entrypoint.mcpTool, null);
  assert.equal(stale.preparation.exactGraphAnchorMaterial.candidateNodes.length, 0);
  assert.throws(() => previewContextWorkflow({
    root,
    task,
    evidenceNeeds: [{
      id: "stale-anchor",
      kind: "temporal-relation",
      relationTypes: ["CONTAINS"],
      graphAnchor: {
        projectId: direct.preparation.currentBinding.projectId,
        worldModelId: direct.preparation.currentBinding.worldModelId,
        graphSnapshotId: direct.preparation.currentBinding.graphSnapshotId,
        nodeIds: [anchorNode.nodeId],
        depth: 1,
        maxNodes: 16,
        maxEdges: 24,
      },
    }],
  }), { code: "GRAPH_ANCHOR_WORLD_MODEL_STALE" });
  assert.deepEqual(managedTreeSnapshot(root), after);
});

test("HEAD exact graph evidence improves annotated recall and lowers lexical filler noise", async (t) => {
  const root = temporaryProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "test"), { recursive: true });
  const groundTruthPath = "src/zz-opaque-engine.mjs";
  fs.writeFileSync(path.join(root, groundTruthPath), "export function zed(value) { return value === 'fault' ? 'recovered' : value; }\n");
  fs.writeFileSync(path.join(root, "test", "zz-opaque-engine.test.mjs"), "import { zed } from '../src/zz-opaque-engine.mjs';\nexport const result = zed('fault');\n");
  for (let index = 0; index < 240; index += 1) {
    const suffix = String(index).padStart(3, "0");
    fs.writeFileSync(path.join(root, "src", `command-routing-guide-${suffix}.mjs`), `export function publicCommandRoutingGuide${suffix}() { return '${"advisory ".repeat(12)}'; }\n`);
  }
  initializeProject({ root, pluginRoot, runtimes: ["codex"] });
  await buildWorldModel({ root });
  const task = "Repair the public command routing failure";
  const baseline = compileContext({ root, task, budget: 32_768, persist: false });
  const world = readWorldModel({ root }).snapshot;
  const anchor = world.temporalProvenanceGraph.nodes.find((node) => node.kind === "FileRevision" && node.path === groundTruthPath);
  assert.ok(anchor);
  const exact = compileContext({
    root,
    task,
    budget: 32_768,
    persist: false,
    evidenceNeeds: [{
      id: "annotated-implementation-lineage",
      kind: "temporal-relation",
      relationTypes: ["DECLARES"],
      minimumItems: 1,
      rationale: "Fresh HEAD identified the exact implementation lineage after semantic repository inspection.",
      graphAnchor: {
        projectId: world.projectId,
        worldModelId: world.worldModelId,
        graphSnapshotId: world.temporalProvenanceGraph.graphSnapshotId,
        nodeIds: [anchor.nodeId],
        depth: 1,
        maxNodes: 12,
        maxEdges: 16,
      },
    }],
  });
  const baselinePaths = new Set(baseline.capsule.repositoryContext.map((item) => item.path));
  const exactPaths = new Set([
    ...exact.capsule.repositoryContext.map((item) => item.path),
    ...exact.capsule.graphTraversalEvidence.flatMap((item) => item.nodes.map((node) => node.path).filter(Boolean)),
  ]);
  const recall = (paths) => paths.has(groundTruthPath) ? 1 : 0;
  const noise = (paths) => paths.size ? [...paths].filter((item) => item !== groundTruthPath).length / paths.size : 0;
  assert.equal(recall(baselinePaths), 0);
  assert.equal(recall(exactPaths), 1);
  assert.equal(noise(exactPaths) < noise(baselinePaths), true);
  assert.equal(exact.capsule.coverageAssessment.status, "coverage-complete");
  assert.equal(exact.capsule.selection.excluded.some((item) => item.reason === "outside-head-evidence-contract"), true);
  assert.equal(exact.capsule.budget.usedApproxTokens < baseline.capsule.budget.usedApproxTokens, true);
});
