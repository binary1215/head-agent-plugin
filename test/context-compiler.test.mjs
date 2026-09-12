import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { CONTEXT_BUDGET_TIERS, DEFAULT_CONTEXT_BUDGET, compileContext, readContextCapsule, requireSufficientContextCapsule } from "../scripts/lib/context-compiler.mjs";
import { prepareContextWorkflow, previewContextWorkflow } from "../scripts/lib/context-workflow.mjs";
import { createExecutionContract, createWholePlanSnapshot } from "../scripts/lib/execution-lineage.mjs";
import { initializeProject } from "../scripts/lib/head-core.mjs";
import { GIT_HISTORY_ADAPTER_VERSION } from "../scripts/lib/git-history.mjs";
import { RuntimeStateFileAdapter } from "../scripts/lib/runtime-state.mjs";
import { startRun } from "../scripts/lib/run-lineage.mjs";
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

test("Context coverage packs only new relation IDs while retaining independently requested source carriers", async (t) => {
  const root = temporaryProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  for (const label of ["alpha", "opaque"]) {
    fs.writeFileSync(path.join(root, "src", `${label}-entry.mjs`), `import { ${label}Value } from './${label}-store.mjs';\nexport function ${label}Read() { return ${label}Value; }\n`);
    fs.writeFileSync(path.join(root, "src", `${label}-store.mjs`), `export const ${label}Value = 1;\n`);
  }
  initializeProject({ root, pluginRoot, runtimes: ["codex"] });
  await buildWorldModel({ root });
  const before = managedTreeSnapshot(root);
  const task = "Inspect alpha";
  const needs = [{ id: "two-imports", kind: "semantic-relation", paths: ["src/alpha-entry.mjs", "src/opaque-entry.mjs"], relationTypes: ["IMPORTS"], minimumItems: 2 }];
  const compile = (evidenceNeeds = needs) => compileContext({ root, task, evidenceNeeds, budget: 32_768 }).capsule;
  const plain = compile();
  assert.equal(plain.coverageAssessment.status, "coverage-complete");
  assert.equal(plain.repositoryContext.length, 2);
  const seen = new Set();
  for (const carrier of plain.repositoryContext) {
    const edgeIds = carrier.semanticRelationships.filter((edge) => edge.type === "IMPORTS").map((edge) => edge.id);
    assert.ok(edgeIds.some((id) => !seen.has(id)), "A relation-only carrier must contribute a previously uncovered relation.");
    edgeIds.forEach((id) => seen.add(id));
  }
  assert.equal(seen.size, 2);
  const proof = plain.coverageAssessment.proofs[0];
  assert.equal(proof.includedMatchCount, 2);
  assert.equal(proof.availableMatchCount, 2);
  assert.deepEqual(proof.availableCandidateIds, [
    "repository-file:src/alpha-entry.mjs", "repository-file:src/alpha-store.mjs",
    "repository-file:src/opaque-entry.mjs", "repository-file:src/opaque-store.mjs",
  ], "Deduplicated evidence counts must not hide alternative carriers from the proof.");
  const overlapping = compile([...needs, { id: "alpha-import", kind: "semantic-relation", paths: ["src/alpha-store.mjs"], relationTypes: ["IMPORTS"] }]);
  assert.equal(overlapping.coverageAssessment.status, "coverage-complete");
  assert.equal(overlapping.repositoryContext.length, 2);
  const independent = compile([...needs, {
    id: "alpha-source-files", kind: "repository-source", paths: ["src/alpha-entry.mjs", "src/alpha-store.mjs"], minimumItems: 2,
  }]);
  assert.equal(independent.coverageAssessment.status, "coverage-complete");
  assert.equal(independent.repositoryContext.length, 3);
  assert.ok(independent.repositoryContext.some((item) => item.path === "src/alpha-entry.mjs"));
  assert.ok(independent.repositoryContext.some((item) => item.path === "src/alpha-store.mjs"));
  const duplicateProof = independent.coverageAssessment.proofs.find((item) => item.evidenceNeedId === "two-imports")
    .includedEvidence.find((item) => item.carrierProvenance.length === 2);
  assert.ok(duplicateProof, "One evidence identity retains both independently required carrier records.");
  for (const provenance of duplicateProof.carrierProvenance) assert.match(provenance.recordDigest, /^[a-f0-9]{64}$/u);
  const throughMcp = await dispatchMcp({ jsonrpc: "2.0", id: 92, method: "tools/call", params: {
    name: "head_context_preview", arguments: { project_root: root, task, evidence_needs: needs },
  } });
  assert.equal(throughMcp.result.structuredContent.capsule.capsuleId, plain.capsuleId);
  assert.deepEqual(managedTreeSnapshot(root), before);

  // Adjust only the fixture's existing user-authored context to exercise fixed
  // tier boundaries without adding a test-only arbitrary-budget API.
  const projectContextFile = path.join(root, ".head", "instructions", "project.md");
  const originalContext = fs.readFileSync(projectContextFile, "utf8").trim();
  const carrierCosts = plain.repositoryContext.map((record) => Math.ceil(JSON.stringify(record).length / 4));
  const includedCost = carrierCosts.reduce((total, cost) => total + cost, 0);
  const baseCost = plain.budget.usedApproxTokens - includedCost;
  const setRemaining = (remaining) => fs.writeFileSync(projectContextFile, originalContext + "x".repeat((32_768 - baseCost - remaining) * 4));

  setRemaining(includedCost);
  const fittingBefore = managedTreeSnapshot(root);
  const fits = previewContextWorkflow({ root, task, evidenceNeeds: needs, budget: 32_768 });
  assert.equal(fits.capsule.coverageAssessment.status, "coverage-complete");
  assert.equal(fits.capsule.repositoryContext.length, 2);
  assert.equal(fits.capsule.budget.usedApproxTokens, 32_768);
  assert.deepEqual(fits.workflow.budget.attemptedTiers, [32_768], "A duplicate carrier must not cause an otherwise sufficient tier to expand.");
  assert.deepEqual(managedTreeSnapshot(root), fittingBefore);

  setRemaining(1);
  const emptyBefore = managedTreeSnapshot(root);
  const noneFit = compile();
  assert.equal(noneFit.repositoryContext.length, 0);
  assert.equal(noneFit.coverageAssessment.status, "coverage-incomplete");
  assert.equal(noneFit.coverageAssessment.recommendedMinimumApproxTokens, noneFit.budget.usedApproxTokens + includedCost,
    "Additional-budget estimation must count only the two carriers adding unique coverage.");
  assert.deepEqual(managedTreeSnapshot(root), emptyBefore);

  setRemaining(carrierCosts[0]);
  const partialBefore = managedTreeSnapshot(root);
  const partial = compile();
  assert.equal(partial.repositoryContext.length, 1);
  assert.equal(partial.coverageAssessment.status, "coverage-incomplete");
  assert.equal(partial.coverageAssessment.recommendedMinimumApproxTokens, partial.budget.usedApproxTokens + carrierCosts[1]);
  const alphaDuplicate = partial.selection.excluded.find((item) => item.id.startsWith("repository-file:src/alpha-"));
  assert.equal(alphaDuplicate.reason, "evidence-coverage-satisfied", "An already covered edge is not a budget gap even while another edge is missing.");
  assert.deepEqual(managedTreeSnapshot(root), partialBefore);
});

test("Context Canon objection pointers are exact optional read-only hints, not queries or authority", async (t) => {
  const root = temporaryProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeProject({ root, pluginRoot, runtimes: ["codex"] });
  const task = "Inspect continuity";
  const empty = previewContextWorkflow({ root, task });
  assert.deepEqual(empty.workflow.conformanceLookup.lookups, []);
  fs.writeFileSync(path.join(root, ".head/context/product-model.json"), JSON.stringify({
    schemaVersion: 1, featureGroups: [], features: [], requirements: [], constraints: [], decisions: [],
    capabilities: [{ key: "chosen", name: "Continuity" }, { key: "neighbor", name: "Continuity neighbor" }],
  }));
  await buildWorldModel({ root });
  const evidenceNeeds = [{ id: "chosen", kind: "product-context", entityKeys: ["chosen"] }];
  const before = managedTreeSnapshot(root);
  const direct = compileContext({ root, task, evidenceNeeds }).capsule;
  const wrapped = previewContextWorkflow({ root, task, evidenceNeeds });
  assert.equal(wrapped.capsule.capsuleId, direct.capsuleId);
  assert.deepEqual(wrapped.workflow.conformanceLookup.lookups, [{
    tool: "head_conformance_queue", arguments: { canon_anchor: { entity_kind: "Capability", entity_key: "chosen" } },
  }]);
  assert.equal(wrapped.workflow.conformanceLookup.status, "not-queried");
  assert.equal(wrapped.workflow.conformanceLookup.automaticQuery, false);
  assert.deepEqual(previewContextWorkflow({ root, task }).workflow.conformanceLookup.lookups, []);
  assert.deepEqual(managedTreeSnapshot(root), before);
});

test("Product coverage counts logical revisions across overlapping carriers and preserves provenance", async (t) => {
  const root = temporaryProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeProject({ root, pluginRoot, runtimes: ["codex"] });
  const productFile = path.join(root, ".head", "context", "product-model.json");
  const product = {
    schemaVersion: 1, featureGroups: [], requirements: [], constraints: [], decisions: [],
    capabilities: [{ key: "capability:opaque", name: "Opaque service" }],
    features: [{ key: "feature:linked", name: "Linked service", featureGroupKeys: [], capabilityKeys: ["capability:opaque"], governedBy: [] }],
  };
  fs.writeFileSync(productFile, JSON.stringify(product));
  await buildWorldModel({ root });
  const before = managedTreeSnapshot(root);
  const task = "Inspect linked service";
  const needs = [{ id: "three-product-keys", kind: "product-context", entityKeys: ["capability:opaque", "feature:linked", "feature:missing"], minimumItems: 3 }];
  const compile = (evidenceNeeds = needs) => compileContext({ root, task, evidenceNeeds }).capsule;
  const first = compile();
  assert.equal(first.capsuleId, compile().capsuleId);
  assert.equal(first.coverageAssessment.status, "coverage-incomplete");
  const proof = first.coverageAssessment.proofs[0];
  assert.equal(proof.includedMatchCount, 2);
  assert.equal(proof.availableMatchCount, 2);
  assert.equal(proof.availableCandidateIds.length, 2, "Both overlapping exact-key carriers remain discoverable.");
  assert.equal(first.productContext.length, 1, "A second carrier cannot contribute a nonexistent third entity.");
  assert.equal(first.coverageAssessment.recommendedMinimumApproxTokens, null);
  for (const evidence of proof.includedEvidence) {
    assert.match(evidence.productEntity.logicalEntityId, /^(?:feature|capability)-/u);
    assert.match(evidence.productEntity.revisionId, /revision/u);
    assert.ok(evidence.productEntity.productModelHash);
    assert.equal(evidence.carrierProvenance.length, 1);
    const carrier = first.productContext.find((item) => `product-context:${item.temporalTraversal.resultId}` === evidence.carrierCandidateId);
    const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
    assert.equal(evidence.carrierProvenance[0].recordDigest, crypto.createHash("sha256").update(JSON.stringify(canonical(carrier))).digest("hex"));
  }
  const unkeyed = compile([...needs, { id: "unkeyed-products", kind: "product-context", facets: ["service"], minimumItems: 3 }]);
  const unkeyedProof = unkeyed.coverageAssessment.proofs.find((item) => item.evidenceNeedId === "unkeyed-products");
  assert.equal(unkeyedProof.availableMatchCount, 2);
  assert.equal(unkeyedProof.includedMatchCount, 2, "Facet-only needs count entities rather than duplicate ProductContext bundles.");
  const guided = previewContextWorkflow({ root, task, evidenceNeeds: needs });
  assert.deepEqual(guided.workflow.budget.attemptedTiers, [32_768]);
  assert.equal(guided.workflow.budget.autoEscalationPerformed, false);
  const throughMcp = await dispatchMcp({ jsonrpc: "2.0", id: 93, method: "tools/call", params: {
    name: "head_context_preview", arguments: { project_root: root, task, evidence_needs: needs },
  } });
  assert.equal(throughMcp.result.structuredContent.capsule.capsuleId, first.capsuleId);
  assert.deepEqual(managedTreeSnapshot(root), before);

  product.capabilities[0].name = "Revised opaque service";
  fs.writeFileSync(productFile, JSON.stringify(product));
  await buildWorldModel({ root });
  const revisedBefore = managedTreeSnapshot(root);
  const revised = compile().coverageAssessment.proofs[0].includedEvidence;
  const oldCapability = proof.includedEvidence.find((item) => item.productEntity.entityKey === "capability:opaque");
  const newCapability = revised.find((item) => item.productEntity.entityKey === "capability:opaque");
  assert.equal(oldCapability.productEntity.logicalEntityId, newCapability.productEntity.logicalEntityId);
  assert.notEqual(oldCapability.productEntity.revisionId, newCapability.productEntity.revisionId);
  assert.notEqual(oldCapability.id, newCapability.id, "Different verified revisions must remain distinct evidence.");
  assert.deepEqual(managedTreeSnapshot(root), revisedBefore);
});

test("exact Product keys survive bounded neighbors and same-key kinds remain distinct", async (t) => {
  const root = temporaryProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeProject({ root, pluginRoot, runtimes: ["codex"] });
  const productFile = path.join(root, ".head", "context", "product-model.json");
  const key = "capability:opaque";
  const features = Array.from({ length: 32 }, (_, index) => ({
    key: `feature:hotfix-${index}`, name: "Hotfix feature", description: "Hotfix behavior",
    featureGroupKeys: [], capabilityKeys: [key], governedBy: [],
  }));
  const product = { schemaVersion: 1, featureGroups: [], requirements: [], constraints: [], decisions: [], capabilities: [{ key, name: "Opaque service" }], features };
  fs.writeFileSync(productFile, JSON.stringify(product));
  const indexed = await buildWorldModel({ root });
  const before = managedTreeSnapshot(root);
  const evidenceNeeds = [{ id: "opaque-capability", kind: "product-context", entityKeys: [key] }];
  for (const budget of [32_768, 524_288]) {
    const capsule = compileContext({ root, task: "hotfix", budget, evidenceNeeds }).capsule;
    assert.equal(capsule.coverageAssessment.status, "coverage-complete");
    assert.equal(capsule.coverageAssessment.proofs[0].includedMatchCount, 1);
    const carrier = capsule.productContext[0];
    assert.equal(carrier.entities.filter((item) => item.key === key).length, 2, "Exact logical and current revision nodes survive optional top-24 ranking.");
    assert.ok(carrier.entities.length <= 24);
    assert.ok(carrier.projectionOmissions.entities > 0);
    assert.equal(carrier.temporalTraversal.traversalQuerySummary.anchorMode, "exact-head-proposed");
    assert.equal(carrier.temporalTraversal.traversalQuerySummary.expectedGraphSnapshotId, indexed.snapshot.temporalProvenanceGraph.graphSnapshotId);
    assert.equal(carrier.temporalTraversal.traversalQuerySummary.maxNodes, 100);
    const includedNodeIds = new Set(carrier.entities.map((entity) => entity.nodeId));
    assert.equal(carrier.relationships.every((relationship) => includedNodeIds.has(relationship.from) && includedNodeIds.has(relationship.to)), true,
      "ProductContext must not emit dangling relationship endpoints.");
    if (carrier.projectionOmissions.entities > 0) {
      assert.equal(carrier.relationshipBoundary.complete, false);
      assert.equal(carrier.relationshipBoundary.items.length > 0, true);
      assert.equal(carrier.relationshipBoundary.items.every((item) => includedNodeIds.has(item.includedEndpointId)
        && !includedNodeIds.has(item.omittedEndpointId) && item.nextAnchorId === item.omittedEndpointId), true);
    }
    assert.equal(carrier.instructionAuthority, false);
    assert.equal(carrier.promotionAuthority, false);
  }
  const many = compileContext({ root, task: "hotfix", evidenceNeeds: [{ id: "many-exact-features", kind: "product-context", entityKeys: features.map((item) => item.key), minimumItems: 20 }] }).capsule;
  assert.equal(many.coverageAssessment.status, "coverage-complete");
  assert.equal(many.coverageAssessment.proofs[0].availableMatchCount, 32, "The per-carrier sample cannot hide any of 32 exact requested keys from available evidence.");
  for (const task of ["hotfix", "qzxvplmn"]) {
    const exact = compileContext({ root, task, evidenceNeeds }).capsule;
    assert.equal(exact.coverageAssessment.status, "coverage-complete");
  }
  const missing = compileContext({ root, task: "hotfix", evidenceNeeds: [{ id: "missing-product", kind: "product-context", entityKeys: ["capability:absent"] }] }).capsule;
  assert.equal(missing.coverageAssessment.status, "coverage-incomplete");
  assert.equal(missing.coverageAssessment.proofs[0].availableMatchCount, 0);
  assert.equal(missing.coverageAssessment.recommendedMinimumApproxTokens, null);
  assert.deepEqual(managedTreeSnapshot(root), before);

  const sharedKey = "shared-key";
  product.capabilities = [{ key: sharedKey, name: "Shared capability" }];
  product.features = [{ key: sharedKey, name: "Shared feature", featureGroupKeys: [], capabilityKeys: [sharedKey], governedBy: [] }];
  fs.writeFileSync(productFile, JSON.stringify(product));
  await buildWorldModel({ root });
  const sharedBefore = managedTreeSnapshot(root);
  const shared = compileContext({ root, task: "qzxvplmn", evidenceNeeds: [{ id: "both-kinds", kind: "product-context", entityKeys: [sharedKey], minimumItems: 2 }] }).capsule;
  assert.equal(shared.coverageAssessment.status, "coverage-complete");
  assert.equal(shared.coverageAssessment.proofs[0].includedMatchCount, 2);
  assert.equal(new Set(shared.coverageAssessment.proofs[0].includedEvidence.map((item) => item.productEntity.logicalEntityId)).size, 2);
  assert.equal(new Set(shared.coverageAssessment.proofs[0].includedEvidence.map((item) => item.id)).size, 2);
  assert.deepEqual(managedTreeSnapshot(root), sharedBefore);
});

test("mixed exact and facet Product needs preserve independent bounded discovery", async (t) => {
  const root = temporaryProject();
  t.after(() => {
    const actual = fs.realpathSync(root);
    assert.equal(path.dirname(actual), fs.realpathSync(path.dirname(root)));
    fs.rmSync(actual, { recursive: true, force: true });
  });
  initializeProject({ root, pluginRoot, runtimes: ["codex"] });
  const product = {
    schemaVersion: 1, featureGroups: [], features: [], requirements: [], constraints: [], decisions: [],
    capabilities: [{ key: "capability:refund", name: "Refund service" }, { key: "capability:audit", name: "Audit records" }],
  };
  const productFile = path.join(root, ".head", "context", "product-model.json");
  fs.writeFileSync(productFile, JSON.stringify(product));
  await buildWorldModel({ root });
  const before = managedTreeSnapshot(root);
  const refund = { id: "refund-product", kind: "product-context", facets: ["refund"] };
  const audit = { id: "audit-product", kind: "product-context", entityKeys: ["capability:audit"] };
  const compile = (evidenceNeeds, budget = 32_768, task = "refund audit") => compileContext({ root, task, evidenceNeeds, budget }).capsule;
  const alone = compile([refund]);
  const mixed = compile([refund, audit]);
  const bothExact = compile([{ ...refund, entityKeys: ["capability:refund"] }, audit]);
  assert.equal(alone.coverageAssessment.status, "coverage-complete");
  assert.equal(mixed.coverageAssessment.status, "coverage-complete");
  assert.equal(bothExact.coverageAssessment.status, "coverage-complete");
  for (const carrier of bothExact.productContext) {
    assert.ok(bothExact.selection.candidateIds.includes(`product-context:${carrier.temporalTraversal.resultId}`),
      "Exact-only carriers keep their existing traversal-derived identity.");
    assert.equal(carrier.temporalTraversal.traversalQuerySummary.anchorMode, "exact-head-proposed");
  }
  assert.equal(compile([audit, refund]).capsuleId, mixed.capsuleId);
  for (const budget of [32_768, 524_288]) {
    const capsule = compile([refund, audit], budget, "qzxvplmn");
    for (const proof of capsule.coverageAssessment.proofs) {
      assert.equal(proof.availableMatchCount, 1);
      assert.equal(proof.includedMatchCount, 1);
    }
    const refundCarrier = capsule.productContext.find((carrier) => carrier.entities.some((entity) => entity.key === "capability:refund"));
    assert.equal(refundCarrier.temporalTraversal.traversalQuerySummary.anchorMode, "lexical-discovery");
    assert.equal(refundCarrier.temporalTraversal.traversalQuerySummary.maxNodes, 100);
    assert.equal(refundCarrier.temporalTraversal.traversalQuerySummary.maxEdges, 200);
    assert.ok(refundCarrier.entities.length <= 24);
    assert.equal(capsule.coverageAssessment.semanticAcceptance, "not-assessed-HEAD-owned");
    assert.equal(capsule.coverageAssessment.authorityEffect, "none");
  }
  const equivalent = compile([refund, audit, { ...refund, id: "refund-equivalent", facets: ["REFUND", "refund"] },
    { id: "refund-exact", kind: "product-context", entityKeys: ["capability:refund", "capability:refund"] }]);
  for (const proof of equivalent.coverageAssessment.proofs) assert.equal(proof.availableMatchCount, 1);
  assert.equal(new Set(equivalent.coverageAssessment.proofs.flatMap((proof) => proof.includedEvidence.map((item) => item.id))).size, 2);
  assert.equal(equivalent.selection.candidateIds.filter((id) => id.startsWith("product-context:")).length, 3,
    "Equivalent normalized facet queries share a carrier; exact and lexical provenance remain separate.");
  const missing = compile([refund, { ...audit, entityKeys: ["capability:absent"] }]);
  assert.equal(missing.coverageAssessment.status, "coverage-incomplete");
  assert.equal(missing.coverageAssessment.proofs.find((proof) => proof.evidenceNeedId === refund.id).includedMatchCount, 1);
  assert.equal(missing.coverageAssessment.proofs.find((proof) => proof.evidenceNeedId === audit.id).availableMatchCount, 0);
  assert.equal(missing.coverageAssessment.recommendedMinimumApproxTokens, null);
  const preview = previewContextWorkflow({ root, task: "refund audit", evidenceNeeds: [refund, audit] });
  assert.deepEqual(preview.workflow.budget.attemptedTiers, [32_768]);
  assert.equal(preview.capsule.capsuleId, mixed.capsuleId);
  const throughMcp = await dispatchMcp({ jsonrpc: "2.0", id: 94, method: "tools/call", params: {
    name: "head_context_preview", arguments: { project_root: root, task: "refund audit", evidence_needs: [refund, audit] },
  } });
  assert.equal(throughMcp.result.structuredContent.capsule.capsuleId, mixed.capsuleId);
  assert.deepEqual(managedTreeSnapshot(root), before);

  const projectContextFile = path.join(root, ".head", "instructions", "project.md");
  const originalContext = fs.readFileSync(projectContextFile, "utf8").trim();
  const includedCost = mixed.productContext.reduce((total, record) => total + Math.ceil(JSON.stringify(record).length / 4), 0);
  const baseCost = mixed.budget.usedApproxTokens - includedCost;
  fs.writeFileSync(projectContextFile, originalContext + "x".repeat((32_768 - baseCost - 1) * 4));
  const overflowBefore = managedTreeSnapshot(root);
  const overflow = compile([refund, audit]);
  assert.equal(overflow.coverageAssessment.status, "coverage-incomplete");
  for (const proof of overflow.coverageAssessment.proofs) {
    assert.equal(proof.availableMatchCount, 1);
    assert.ok(proof.exclusionReasons.includes("context-budget"));
  }
  const recovered = previewContextWorkflow({ root, task: "refund audit", evidenceNeeds: [refund, audit] });
  assert.deepEqual(recovered.workflow.budget.attemptedTiers, [32_768, 65_536]);
  assert.equal(recovered.capsule.coverageAssessment.status, "coverage-complete");
  assert.equal(compile([refund, audit], 524_288).coverageAssessment.status, "coverage-complete");
  assert.deepEqual(managedTreeSnapshot(root), overflowBefore);
});

test("facet discovery is bounded per need without a global task-term eligibility limit", async (t) => {
  const root = temporaryProject();
  t.after(() => {
    const actual = fs.realpathSync(root);
    assert.equal(path.dirname(actual), fs.realpathSync(path.dirname(root)));
    fs.rmSync(actual, { recursive: true, force: true });
  });
  initializeProject({ root, pluginRoot, runtimes: ["codex"] });
  const facets = Array.from({ length: 24 }, (_, index) => `facet${String(index).padStart(2, "0")}`);
  const product = {
    schemaVersion: 1, featureGroups: [], features: [], requirements: [], constraints: [], decisions: [],
    capabilities: [
      { key: "capability:audit", name: "Audit records" },
      ...facets.map((facet) => ({ key: `capability:${facet}`, name: `${facet} service` })),
      ...Array.from({ length: 20 }, (_, index) => ({ key: `capability:collection-${index}`, name: `Collective service ${index}` })),
      ...Array.from({ length: 20 }, (_, index) => ({ key: `capability:opaque-${index}`, name: `Refund service ${index}` })),
    ],
  };
  product.features = Array.from({ length: 32 }, (_, index) => ({
    key: `feature:hotfix-${index}`, name: "Hotfix operation", featureGroupKeys: [],
    capabilityKeys: Array.from({ length: 20 }, (_, index) => `capability:opaque-${index}`), governedBy: [],
  }));
  fs.writeFileSync(path.join(root, ".head", "context", "product-model.json"), JSON.stringify(product));
  await buildWorldModel({ root });
  const before = managedTreeSnapshot(root);
  const needs = [
    { id: "audit-exact", kind: "product-context", entityKeys: ["capability:audit"] },
    ...facets.map((facet) => ({ id: facet, kind: "product-context", facets: [facet] })),
  ];
  const task = "qzxvplmn";
  const compile = (evidenceNeeds, budget = 32_768) => compileContext({ root, task, evidenceNeeds, budget }).capsule;
  const many = compile(needs);
  assert.equal(many.coverageAssessment.status, "coverage-complete");
  assert.equal(compile([...needs].reverse()).capsuleId, many.capsuleId);
  assert.equal(compile(needs, 524_288).coverageAssessment.status, "coverage-complete");
  for (const need of needs) {
    const proof = many.coverageAssessment.proofs.find((item) => item.evidenceNeedId === need.id);
    const alone = compile([need]).coverageAssessment.proofs[0];
    assert.equal(proof.availableMatchCount, alone.availableMatchCount);
    assert.equal(proof.includedMatchCount, 1);
  }
  assert.equal(many.selection.candidateIds.filter((id) => id.startsWith("product-context:")).length, 25);
  for (const carrier of many.productContext) {
    assert.ok(carrier.entities.length <= 24);
    assert.equal(carrier.temporalTraversal.traversalQuerySummary.maxDepth, 3);
    assert.equal(carrier.temporalTraversal.traversalQuerySummary.maxNodes, 100);
    assert.equal(carrier.temporalTraversal.traversalQuerySummary.maxEdges, 200);
  }
  const collectiveNeed = { id: "collective-products", kind: "product-context", facets: ["collective"], minimumItems: 20 };
  const collective = compile([needs[0], collectiveNeed]);
  assert.equal(collective.coverageAssessment.status, "coverage-complete");
  assert.equal(collective.coverageAssessment.proofs.find((item) => item.evidenceNeedId === collectiveNeed.id).includedMatchCount, 20);
  const distinctProjections = [needs[0], collectiveNeed, { ...collectiveNeed, id: "collective-single", minimumItems: 1 }];
  const projected = compile(distinctProjections);
  assert.equal(projected.selection.candidateIds.filter((id) => id.startsWith("product-context:")).length, 3,
    "Different bounded projections of one traversal retain separate carrier identities.");
  assert.equal(compile([...distinctProjections].reverse()).capsuleId, projected.capsuleId);
  const nonexistentFacet = compile([needs[0], { ...collectiveNeed, facets: ["collective", "absentterm"], minimumItems: 1 }]);
  assert.equal(nonexistentFacet.coverageAssessment.status, "coverage-incomplete");
  assert.equal(nonexistentFacet.coverageAssessment.proofs.find((item) => item.evidenceNeedId === collectiveNeed.id).availableMatchCount, 0,
    "Discovery selector metadata is not Product evidence for a missing facet.");
  const crowded = compileContext({ root, task: "Hotfix operation", evidenceNeeds: [needs[0], {
    id: "refund-crowded", kind: "product-context", facets: ["refund"], minimumItems: 20,
  }] }).capsule;
  assert.equal(crowded.coverageAssessment.status, "coverage-complete");
  const crowdedCarrier = crowded.productContext.find((carrier) => carrier.taskAnchor.selectedTerm === "refund");
  const reservedRefundRevisions = crowdedCarrier.entities.filter((entity) => entity.kind === "CapabilityRevision" && entity.semantic?.name.startsWith("Refund"));
  assert.equal(new Set(reservedRefundRevisions.map((entity) => entity.logicalEntityId)).size, 20,
    "Twenty requested matching revisions survive more than 24 task-matching neighbors without reserving duplicate logical representations.");
  assert.ok(crowdedCarrier.entities.length <= 24);
  assert.ok(crowdedCarrier.projectionOmissions.entities > 0);
  assert.equal(crowdedCarrier.temporalTraversal.traversalQuerySummary.anchorMode, "lexical-discovery");
  assert.deepEqual(managedTreeSnapshot(root), before);
});

test("Product facets use actual content equally for exact and discovery retrieval without query echo", async (t) => {
  for (const name of ["Repayment", "Pay service"]) {
    await t.test(name, async () => {
      const root = temporaryProject();
      try {
        initializeProject({ root, pluginRoot, runtimes: ["codex"] });
        const key = "capability:opaque";
        const product = { schemaVersion: 1, featureGroups: [], features: [], requirements: [], constraints: [], decisions: [],
          capabilities: [{ key, name }] };
        fs.writeFileSync(path.join(root, ".head", "context", "product-model.json"), JSON.stringify(product));
        await buildWorldModel({ root });
        const before = managedTreeSnapshot(root);
        const need = { id: "pay-evidence", kind: "product-context", facets: ["pay"] };
        const compile = (evidenceNeeds, budget = 32_768) => compileContext({ root, task: "qzxvplmn", evidenceNeeds, budget }).capsule;
        const expectedCount = name === "Repayment" ? 0 : 1;
        const discovery = compile([need]);
        const exact = compile([{ ...need, entityKeys: [key] }]);
        for (const capsule of [discovery, exact, compile([need], 524_288)]) {
          assert.equal(capsule.coverageAssessment.proofs[0].availableMatchCount, expectedCount,
            "The retrieval query is provenance, not evidence for its own facet.");
          assert.equal(capsule.coverageAssessment.proofs[0].includedMatchCount, expectedCount);
          assert.equal(capsule.coverageAssessment.semanticAcceptance, "not-assessed-HEAD-owned");
          assert.equal(capsule.coverageAssessment.authorityEffect, "none");
        }
        // Independently request the same entity so even a non-matching discovery
        // carrier is included and its full provenance can be inspected.
        const retain = { id: "retain-product", kind: "product-context" };
        const inspectable = compile([need, retain]);
        const carrier = inspectable.productContext[0];
        assert.equal(carrier.temporalTraversal.traversalQuerySummary.normalizedQuery, "pay");
        assert.equal(carrier.temporalTraversal.traversalQuerySummary.anchorMode, "lexical-discovery");
        assert.equal(carrier.taskAnchor.selectedTerm, "pay");
        assert.equal(carrier.entities.some((entity) => entity.semantic?.name === name), true);
        assert.equal(inspectable.coverageAssessment.proofs.find((proof) => proof.evidenceNeedId === need.id).includedMatchCount, expectedCount);
        assert.equal(inspectable.coverageAssessment.proofs.find((proof) => proof.evidenceNeedId === retain.id).includedMatchCount, 1);
        assert.equal(compile([retain, need]).capsuleId, inspectable.capsuleId);
        const preview = previewContextWorkflow({ root, task: "qzxvplmn", evidenceNeeds: [need] });
        assert.equal(preview.capsule.capsuleId, discovery.capsuleId);
        assert.deepEqual(preview.workflow.budget.attemptedTiers, [32_768]);
        const metadataNeeds = ["freshness", "traversal", "projection", "instruction", "description", "key", "authority"].map((facet) => ({
          id: `metadata-${facet}`, kind: "product-context", entityKeys: [key], facets: [facet],
        }));
        const metadataOnly = compile(metadataNeeds);
        assert.equal(metadataOnly.coverageAssessment.proofs.every((proof) => proof.availableMatchCount === 0), true,
          "Property names and diagnostic values are not Product content.");
        const temporal = compile([{ ...retain, entityKeys: [key] }, ...["revision", "authority", "edge"].map((facet) => ({
          id: `relation-${facet}`, kind: "temporal-relation", relationTypes: ["CURRENT_REVISION"], facets: [facet],
        }))]);
        assert.equal(temporal.coverageAssessment.proofs.find((proof) => proof.evidenceNeedId === "relation-revision").includedMatchCount, 1);
        for (const facet of ["authority", "edge"]) assert.equal(temporal.coverageAssessment.proofs.find((proof) => proof.evidenceNeedId === `relation-${facet}`).availableMatchCount, 0,
          "Temporal relation types are content; generated edge IDs and authority labels are not.");
        assert.deepEqual(managedTreeSnapshot(root), before);
      } finally {
        const actual = fs.realpathSync(root);
        assert.equal(path.dirname(actual), fs.realpathSync(path.dirname(root)));
        fs.rmSync(actual, { recursive: true, force: true });
      }
    });
  }
});

test("Curated facets use supported content values rather than IDs, provenance or arbitrary fields", (t) => {
  const root = temporaryProject();
  t.after(() => {
    const actual = fs.realpathSync(root);
    assert.equal(path.dirname(actual), fs.realpathSync(path.dirname(root)));
    fs.rmSync(actual, { recursive: true, force: true });
  });
  initializeProject({ root, pluginRoot, runtimes: ["codex"] });
  const knowledgeFile = path.join(root, ".head", "context", "knowledge.json");
  const evidence = { id: "evidence-pay", summary: "Repayment source", uri: "file:pay", digest: "a".repeat(64) };
  const record = { statement: "Repayment rule", title: "Repayment rule", decision: "Repayment rule", reason: "Repayment rule",
    evidenceIds: [evidence.id], diagnostic: "pay", importance: 3, tags: [] };
  const knowledge = { schemaVersion: 1, evidence: [evidence],
    claims: [{ ...record, id: "claim-pay" }], decisions: [{ ...record, id: "decision-pay" }], unknowns: [{ ...record, id: "unknown-pay" }] };
  const kinds = ["claim", "decision", "unknown"];
  const compile = (evidenceNeeds) => compileContext({ root, task: "qzxvplmn", evidenceNeeds }).capsule;
  fs.writeFileSync(knowledgeFile, JSON.stringify(knowledge));
  const before = managedTreeSnapshot(root);
  const negative = compile(kinds.flatMap((kind) => ["pay", "statement", "importance", "diagnostic", "instruction"].map((facet) => ({
    id: `${kind}-${facet}`, kind, facets: [facet],
  }))));
  assert.equal(negative.coverageAssessment.proofs.every((proof) => proof.availableMatchCount === 0), true);
  const raw = compile(kinds.map((kind) => ({ id: kind, kind })));
  assert.equal(raw.claims[0].diagnostic, "pay");
  assert.equal(raw.claims[0].evidence[0].uri, "file:pay", "Provenance is retained, not erased to fix matching.");
  assert.deepEqual(managedTreeSnapshot(root), before);

  knowledge.evidence[0].summary = "Pay instruction evidence";
  fs.writeFileSync(knowledgeFile, JSON.stringify(knowledge));
  const positiveBefore = managedTreeSnapshot(root);
  const positive = compile(kinds.map((kind) => ({ id: kind, kind, facets: ["pay", "instruction"] })));
  assert.equal(positive.coverageAssessment.proofs.every((proof) => proof.includedMatchCount === 1), true);
  assert.deepEqual(managedTreeSnapshot(root), positiveBefore);
});

test("Repository, relationship, Git and runtime facets exclude diagnostic text but retain observed values", async (t) => {
  for (const positive of [false, true]) await t.test(positive ? "actual values" : "metadata only", async () => {
    const root = temporaryProject();
    try {
      fs.mkdirSync(path.join(root, "src"), { recursive: true });
      fs.writeFileSync(path.join(root, "src", "plain.mjs"), `import { other } from './other.mjs';\nexport function ${positive ? "payInvoice" : "repayment"}() { return other(); }\n`);
      fs.writeFileSync(path.join(root, "src", "other.mjs"), "export function other() { return true; }\n");
      initializeProject({ root, pluginRoot, runtimes: ["codex"] });
      const commit = "a".repeat(40);
      fs.mkdirSync(path.join(root, ".git", "refs", "heads"), { recursive: true });
      fs.writeFileSync(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
      fs.writeFileSync(path.join(root, ".git", "refs", "heads", "main"), `${commit}\n`);
      const gitHistoryAdapter = {
        adapterVersion: GIT_HISTORY_ADAPTER_VERSION,
        describe: () => ({ adapterKind: "synthetic-content-values", adapterVersion: GIT_HISTORY_ADAPTER_VERSION,
          authority: "derived-evidence-only", rebuildable: true, uniqueAuthority: false, remote: false }),
        readHistory: () => ({ status: "available", coverage: "all-reachable-commits", reasonCode: "", commits: [{
          commit, parents: [], authoredAt: "2026-09-06T00:00:00Z", committedAt: "2026-09-06T00:00:00Z",
          author: { name: "Synthetic fixture" }, refs: ["HEAD -> main"], subject: positive ? "Pay invoices" : "Repayment", body: "",
        }] }),
      };
      const inputFile = path.join(root, ".head", "runtime-input.json");
      fs.writeFileSync(inputFile, JSON.stringify({ schemaVersion: 1, kind: "HeadRuntimeStateExport", observedAt: "2026-09-06T00:00:00Z", observations: [{
        runtime: "codex", kind: "session", state: "idle", externalId: "synthetic-pay", workspaceRoot: root,
        providerVersion: "1.0", capabilities: [positive ? "pay" : "repayment"],
      }] }));
      await buildWorldModel({ root, gitHistoryAdapter, runtimeStateAdapter: new RuntimeStateFileAdapter({ file: inputFile }) });
      const before = managedTreeSnapshot(root);
      const compile = (evidenceNeeds) => compileContext({ root, task: "history qzxvplmn", evidenceNeeds }).capsule;
      const needs = [
        { id: "source", kind: "repository-source", paths: ["src/plain.mjs"] },
        { id: "relation", kind: "semantic-relation", paths: ["src/plain.mjs"], relationTypes: ["CALLS"] },
        { id: "git", kind: "git-decision" }, { id: "runtime", kind: "runtime-state" },
      ];
      const evidence = compile(needs.map((need) => ({ ...need, facets: ["pay"] })));
      for (const proof of evidence.coverageAssessment.proofs) assert.equal(proof.includedMatchCount, positive ? 1 : 0, proof.evidenceNeedId);
      const metadata = compile(needs.flatMap((need) => ["instruction", "digest", "trust", "expansion", "specifier", "subject", "capabilities"].map((facet) => ({
        ...need, id: `${need.id}-${facet}`, facets: [facet],
      }))));
      assert.equal(metadata.coverageAssessment.proofs.every((proof) => proof.availableMatchCount === 0), true);
      const raw = compile(needs);
      assert.equal(raw.repositoryContext[0].trustBoundary, "evidence-not-instruction");
      assert.equal(raw.gitDecisionEvidence[0].evidence.instructionAuthority, false);
      assert.equal(raw.runtimeStateEvidence[0].controlAuthority, false);
      assert.deepEqual(managedTreeSnapshot(root), before);
    } finally {
      const actual = fs.realpathSync(root);
      assert.equal(path.dirname(actual), fs.realpathSync(path.dirname(root)));
      fs.rmSync(actual, { recursive: true, force: true });
    }
  });
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

test("Context Capsule readers reject an intact Capsule from another logical Project", async (t) => {
  const parent = temporaryProject();
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const projectA = path.join(parent, "project-a");
  const projectB = path.join(parent, "project-b");
  fs.mkdirSync(projectA);
  fs.mkdirSync(projectB);
  initializeProject({ root: projectA, pluginRoot, runtimes: ["codex"] });
  initializeProject({ root: projectB, pluginRoot, runtimes: ["codex"] });
  const task = "Inspect the current project context";
  const capsuleA = compileContext({ root: projectA, task, persist: true });
  const capsuleB = compileContext({ root: projectB, task, persist: true });
  assert.notEqual(capsuleA.capsule.snapshot.projectId, capsuleB.capsule.snapshot.projectId);

  const foreignFile = path.join(projectB, ".head", "context", "capsules", `${capsuleA.capsule.capsuleId}.json`);
  fs.copyFileSync(capsuleA.file, foreignFile, fs.constants.COPYFILE_EXCL);
  assert.throws(
    () => readContextCapsule({ root: projectB, capsuleId: capsuleA.capsule.capsuleId }),
    (error) => error.code === "CONTEXT_CAPSULE_PROJECT_MISMATCH",
  );

  const plan = createWholePlanSnapshot({
    root: projectB,
    objective: task,
    plan: [{ id: "inspect", outcome: "Inspect current Project B" }],
  });
  assert.throws(() => createExecutionContract({
    root: projectB,
    wholePlanId: plan.artifact.wholePlanId,
    capsuleId: capsuleA.capsule.capsuleId,
    scope: task,
    acceptanceCriteria: ["Use the current Project context"],
  }), (error) => error.code === "CONTEXT_CAPSULE_PROJECT_MISMATCH");

  const ownContract = createExecutionContract({
    root: projectB,
    wholePlanId: plan.artifact.wholePlanId,
    capsuleId: capsuleB.capsule.capsuleId,
    scope: task,
    acceptanceCriteria: ["Use the current Project context"],
  });
  assert.equal(startRun({ root: projectB, executionContractId: ownContract.artifact.executionContractId }).status, "run_started");
});
