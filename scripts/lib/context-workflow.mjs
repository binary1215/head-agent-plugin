import crypto from "node:crypto";
import {
  compileContext,
  CONTEXT_BUDGET_TIERS,
  DEFAULT_CONTEXT_BUDGET,
  EVIDENCE_NEED_KINDS,
} from "./context-compiler.mjs";

export const CONTEXT_WORKFLOW_PROTOCOL_VERSION = "0.2.0";

const WORLD_EVIDENCE_KINDS = new Set([
  "git-decision",
  "product-context",
  "repository-file",
  "repository-source",
  "repository-test",
  "runtime-state",
  "semantic-relation",
  "temporal-relation",
]);

const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");

function worldState(capsule) {
  const coverage = capsule.snapshot.coverage;
  if (coverage.includes("stale-repository-world-model-excluded")) return "stale-excluded";
  if (coverage.includes("repository-world-model")) return "current-verified";
  return "not-built";
}

function nextBudgetTier(current) {
  const index = CONTEXT_BUDGET_TIERS.indexOf(current);
  return index >= 0 ? CONTEXT_BUDGET_TIERS[index + 1] || null : null;
}

function unmetSummary(coverage) {
  return coverage.unmetEvidenceNeeds.map((item) => ({
    evidenceNeedId: item.evidenceNeed.id,
    kind: item.evidenceNeed.kind,
    requiredMinimumItems: item.includedMatchCount + item.shortfall,
    includedMatchCount: item.includedMatchCount,
    availableMatchCount: item.availableMatchCount,
    shortfall: item.shortfall,
    exclusionReasons: item.exclusionReasons,
  }));
}

function workflowDecision(capsule) {
  const coverage = capsule.coverageAssessment;
  const world = worldState(capsule);
  const needsWorld = capsule.evidenceNeedContract.needs.some((need) => WORLD_EVIDENCE_KINDS.has(need.kind));
  const unmet = unmetSummary(coverage);
  const budgetBlocked = unmet.some((item) => item.exclusionReasons.includes("context-budget") && item.availableMatchCount > item.includedMatchCount);
  const nextTier = budgetBlocked ? nextBudgetTier(capsule.budget.maxApproxTokens) : null;

  if (world === "stale-excluded" && needsWorld) return {
    status: "world_refresh_required",
    nextAction: {
      id: "refresh_world_explicitly",
      summary: "HEAD requested repository or product evidence, but the stale World Model was excluded from this preview.",
      cli: "head-agent world-refresh <project>",
      mcpTool: null,
      note: "Refresh is a separate explicit mutation. Reuse the exact same task and EvidenceNeeds for the next preview.",
    },
    nextTier: null,
    stopReason: "world-refresh-required",
  };
  if (world === "not-built" && needsWorld) return {
    status: "world_evidence_unavailable",
    nextAction: {
      id: "build_world_explicitly_or_revise_evidence_needs",
      summary: "HEAD requested evidence supplied by the World Model, but no World Model is available.",
      cli: "head-agent init <project> --profile product, then head-agent world-index <project>",
      mcpTool: "head_project_initialize_or_resume",
      note: "Product/World activation and indexing remain explicit. Do not remove a valid EvidenceNeed merely to obtain coverage-complete.",
    },
    nextTier: null,
    stopReason: "world-evidence-unavailable",
  };
  if (coverage.status === "not-requested") return {
    status: "evidence_needs_unassessed",
    nextAction: {
      id: "head_define_evidence_needs_or_explicitly_accept_none",
      summary: "HEAD has not declared mechanical evidence requirements for this exact task.",
      mcpTool: "head_context_preview",
      note: "Choose only task-required evidence kinds. The Compiler must not invent universal code, test, Product, or graph requirements.",
    },
    nextTier: null,
    stopReason: "evidence-needs-unassessed",
  };
  if (coverage.status === "coverage-incomplete" && nextTier) return {
    status: "budget_expansion_required",
    nextAction: {
      id: "retry_preview_at_next_fixed_budget_tier",
      summary: `Matching evidence exists but did not fit. The read-only preview may retry at ${nextTier} approximate tokens.`,
      mcpTool: null,
      note: "This mechanical retry does not establish semantic sufficiency or persist a Capsule.",
    },
    nextTier,
    stopReason: null,
  };
  if (coverage.status === "coverage-incomplete") return {
    status: "evidence_gap_requires_head_action",
    nextAction: {
      id: "gather_evidence_or_revise_the_head_requirement",
      summary: budgetBlocked
        ? "Matching evidence still does not fit at the 512K hard maximum. HEAD must narrow or gather bounded evidence without increasing the ceiling."
        : "At least one HEAD-defined EvidenceNeed is not mechanically covered and a larger budget cannot solve it.",
      mcpTool: null,
      note: "Gather or inspect bounded evidence, or revise the requirement only if HEAD determines the original need was wrong.",
    },
    nextTier: null,
    stopReason: budgetBlocked ? "hard-maximum-reached" : "non-budget-evidence-gap",
  };
  return {
    status: "ready_for_head_semantic_assessment",
    nextAction: {
      id: "head_assess_semantic_sufficiency",
      summary: "All HEAD-defined EvidenceNeeds are mechanically covered. HEAD must still assess whether the included evidence is semantically sufficient for the task.",
      mcpTool: null,
      note: "coverage-complete is not approval, correctness, execution authorization, or a ReviewDecision.",
    },
    nextTier: null,
    stopReason: "mechanical-coverage-complete",
  };
}

function buildContextWorkflowProjection(preview, { callerTask, requestedBudget, attempts = [] } = {}) {
  if (preview?.status !== "preview" || preview.capsule?.kind !== "ContextCapsule") {
    const error = new Error("A non-persisted Context Capsule preview is required.");
    error.code = "CONTEXT_WORKFLOW_PREVIEW_REQUIRED";
    throw error;
  }
  const capsule = preview.capsule;
  const task = callerTask == null ? capsule.task : String(callerTask);
  const decision = workflowDecision(capsule);
  const coverage = capsule.coverageAssessment;
  const world = worldState(capsule);
  return {
    schemaVersion: 1,
    kind: "ContextWorkflowProjection",
    protocolVersion: CONTEXT_WORKFLOW_PROTOCOL_VERSION,
    status: decision.status,
    taskBinding: {
      callerTaskDigest: digest(task),
      callerTaskByteLength: Buffer.byteLength(task, "utf8"),
      compiledTaskDigest: digest(capsule.task),
      normalizedAtCompilerBoundary: task !== capsule.task,
      reuseRequirement: "hold-the-caller-task-byte-identical-across-preview-retries",
    },
    world: {
      state: world,
      coverage: capsule.snapshot.coverage,
      worldModelDigest: capsule.snapshot.sourceDigests.repositoryWorldModel || null,
      sourceSnapshotId: capsule.repositoryTemporalGraph?.sourceSnapshotId || null,
      fullSnapshotReturned: false,
      boundedStatusTool: world === "not-built" ? null : "head_world_model",
      localFullStatusUse: "exceptional-operator-inspection-only",
    },
    evidenceNeeds: {
      owner: "HEAD",
      specifiedCount: capsule.evidenceNeedContract.needs.length,
      allowedKinds: [...EVIDENCE_NEED_KINDS],
      status: coverage.status,
      mechanicalCoverageSatisfied: coverage.mechanicalCoverageSatisfied,
      semanticAcceptance: coverage.semanticAcceptance,
      unmet: unmetSummary(coverage),
      authoringQuestions: [
        "Which evidence kinds are actually required by this task and its risk?",
        "Which facets or graph relations must be directly represented?",
        "What minimum item count is necessary without imposing universal test or graph rules?",
      ],
    },
    budget: {
      requestedTier: requestedBudget ?? capsule.budget.maxApproxTokens,
      currentTier: capsule.budget.maxApproxTokens,
      allowedTiers: [...CONTEXT_BUDGET_TIERS],
      hardMaximum: CONTEXT_BUDGET_TIERS.at(-1),
      usedApproxTokens: capsule.budget.usedApproxTokens,
      recommendedMinimumApproxTokens: coverage.recommendedMinimumApproxTokens,
      nextEligibleTier: decision.nextTier,
      attemptedTiers: attempts.map((attempt) => attempt.budgetTier),
      attempts,
      autoEscalates: true,
      autoEscalationPerformed: attempts.length > 1,
      autoEscalationStopReason: decision.stopReason,
      providerFitVerified: false,
    },
    capsule: {
      capsuleId: capsule.capsuleId,
      previewOnly: true,
      persisted: false,
      identityVerifiedByCompiler: true,
      coverageProofDigest: coverage.proofDigest,
    },
    nextAction: decision.nextAction,
    authority: {
      advisoryOnly: true,
      persisted: false,
      mutatesWorldModel: false,
      persistsCapsule: false,
      selectsEvidenceNeeds: false,
      judgesSemanticSufficiency: false,
      grantsExecutionAuthorization: false,
      createsReviewDecision: false,
      writesRecoveryDirection: false,
    },
  };
}

export function previewContextWorkflow({ root = ".", task, budget = DEFAULT_CONTEXT_BUDGET, evidenceNeeds = [], graphProjectionAdapter = null } = {}) {
  const requestedBudget = budget;
  let currentBudget = budget;
  const attempts = [];

  for (let attemptIndex = 0; attemptIndex < CONTEXT_BUDGET_TIERS.length; attemptIndex += 1) {
    const preview = compileContext({ root, task, budget: currentBudget, evidenceNeeds, persist: false, graphProjectionAdapter });
    const decision = workflowDecision(preview.capsule);
    attempts.push({
      attempt: attemptIndex + 1,
      budgetTier: currentBudget,
      capsuleId: preview.capsule.capsuleId,
      coverageProofDigest: preview.capsule.coverageAssessment.proofDigest,
      coverageStatus: preview.capsule.coverageAssessment.status,
      mechanicalCoverageSatisfied: preview.capsule.coverageAssessment.mechanicalCoverageSatisfied,
      workflowStatus: decision.status,
    });

    if (decision.status !== "budget_expansion_required") return {
      ...preview,
      workflow: buildContextWorkflowProjection(preview, { callerTask: task, requestedBudget, attempts }),
    };

    currentBudget = decision.nextTier;
  }

  const error = new Error("Context preview exceeded the fixed automatic budget-tier retry bound.");
  error.code = "CONTEXT_WORKFLOW_RETRY_BOUND_EXCEEDED";
  throw error;
}
