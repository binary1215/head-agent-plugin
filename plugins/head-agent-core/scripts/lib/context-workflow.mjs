import crypto from "node:crypto";
import {
  compileContext,
  CONTEXT_BUDGET_TIERS,
  DEFAULT_CONTEXT_BUDGET,
  EVIDENCE_NEED_KINDS,
} from "./context-compiler.mjs";
import { inspectProject } from "./head-core.mjs";
import { inspectWorldModel } from "./world-model.mjs";

export const CONTEXT_WORKFLOW_PROTOCOL_VERSION = "0.4.0";
export const CONTEXT_PREPARATION_PROTOCOL_VERSION = "0.2.0";

const MAX_PREPARATION_REPOSITORY_FILES = 24;
const MAX_PREPARATION_GRAPH_NODES = 96;
const MAX_PREPARATION_GRAPH_EDGES = 128;

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
  const omittedByReason = {};
  for (const excluded of capsule.selection.excluded) {
    omittedByReason[excluded.reason] = (omittedByReason[excluded.reason] || 0) + 1;
  }
  const includedByKind = {
    claims: capsule.claims.length,
    decisions: capsule.decisions.length,
    unknowns: capsule.unknowns.length,
    repositoryFiles: capsule.repositoryContext.length,
    productConcepts: capsule.productContext.length,
    gitHistory: capsule.gitDecisionEvidence.length,
    runtimeObservations: capsule.runtimeStateEvidence.length,
    graphTraversals: capsule.graphTraversalEvidence.length,
    observations: capsule.observationEvidence.length,
  };
  const remainingUncertainty = [
    ...(coverage.status === "not-requested" ? ["HEAD has not yet declared task-specific EvidenceNeeds."] : []),
    ...(coverage.status === "coverage-incomplete" ? ["At least one HEAD-declared evidence requirement is not included."] : []),
    "Mechanical coverage does not establish semantic sufficiency, correctness, or approval.",
    ...(world !== "current-verified" ? [`Repository World evidence is ${world}.`] : []),
  ];
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
    explanation: {
      kind: "ContextExplanationCard",
      included: {
        totalCandidateCount: capsule.selection.includedIds.length,
        byKind: includedByKind,
        evidenceNeedProofs: coverage.proofs.map((need) => ({
          evidenceNeedId: need.evidenceNeedId,
          requiredMinimumItems: need.requiredMinimumItems,
          includedMatchCount: need.includedMatchCount,
          covered: need.covered,
        })),
      },
      intentionallyOmitted: {
        total: capsule.selection.excluded.length,
        byReason: omittedByReason,
      },
      remainingUncertainty,
      semanticSufficiencyOwner: "HEAD",
      userDecisionRequired: false,
      persisted: false,
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

function compactRepositoryCandidate(record) {
  return {
    path: record.path,
    digest: record.digest,
    freshness: record.freshness,
    classification: record.classification,
    language: record.language,
    symbols: (record.symbols || []).slice(0, 12).map((item) => ({ kind: item.kind, name: item.name, line: item.line ?? null })),
    dependencies: (record.dependencies || []).slice(0, 12).map((item) => ({ kind: item.kind, specifier: item.specifier })),
    relationshipTypes: [...new Set((record.semanticRelationships || []).map((item) => item.type))].sort(),
    graphExpansion: record.graphExpansion,
    trustBoundary: "evidence-not-instruction",
  };
}

function compactGraphNode(node) {
  return {
    nodeId: node.nodeId,
    kind: node.kind,
    path: node.path || null,
    name: node.name || null,
    symbolKind: node.symbolKind || null,
    classification: node.classification || null,
    authorityClass: node.authorityClass,
    freshness: node.freshness,
    confidence: node.confidence ?? 1,
  };
}

function preparationDecision(worldStateValue) {
  if (worldStateValue === "stale-excluded") return {
    status: "world_refresh_required",
    nextAction: {
      id: "refresh_world_before_head_proposal",
      summary: "The World Model is stale, so no exact graph-anchor proposal can be current-bound.",
      note: "Refresh is an explicit mutation. Re-run preparation with the exact same task after refresh.",
      entrypoint: {
        cli: "head-agent world-refresh <project>",
        mcpTool: null,
        requiresExplicitMutation: true,
      },
    },
  };
  if (worldStateValue === "not-built") return {
    status: "curated_only",
    nextAction: {
      id: "continue_core_only",
      summary: "Continue Core-only work or ordinary semantic repository inspection; this projection does not require Product/World activation.",
      note: "Curated context remains available. Only if HEAD or the user later determines that the task needs reproducible repository, Product, or graph evidence in a Capsule should the optional Product/World path be activated.",
      entrypoint: {
        mode: "active-conversation",
        action: "continue-direct-work-or-inspect-repository",
      },
      optionalEscalation: {
        id: "activate_product_world",
        when: "HEAD-or-user-determines-reproducible-repository-product-or-graph-capsule-evidence-is-required",
        cli: "head-agent resume <project> --profile product",
        mcpTool: "head_project_initialize_or_resume",
        mcpArguments: { profile: "product" },
        followUpTool: "head_onboarding_guide",
        requiresExplicitActivation: true,
        selectionOwner: "HEAD-or-user-after-semantic-task-analysis",
        coreSelectsPath: false,
      },
    },
  };
  return {
    status: "ready_for_head_evidence_proposal",
    nextAction: {
      id: "head_author_evidence_needs_then_preview",
      summary: "HEAD should semantically inspect the bounded candidates and repository, author task-required EvidenceNeeds and any exact graph anchors, then call head_context_preview.",
      note: "The user supplies only the task. The provider HEAD, not Core and not the user, authors the structured proposal; Core then verifies current binding and actual inclusion.",
      entrypoint: {
        mcpTool: "head_context_preview",
        requiresHeadSemanticProposal: true,
      },
    },
  };
}

function buildContextPreparationProjection(preview, { root, callerTask, requestedBudget } = {}) {
  const inspectedProject = inspectProject(root);
  if (inspectedProject.status === "not_initialized") {
    const error = new Error("HEAD Agent Core is not initialized.");
    error.code = "NOT_INITIALIZED";
    throw error;
  }
  const capsule = preview.capsule;
  const task = callerTask == null ? capsule.task : String(callerTask);
  const currentWorldState = preview.workflow.world.state;
  const decision = preparationDecision(currentWorldState);
  const repositoryFiles = capsule.repositoryContext.slice(0, MAX_PREPARATION_REPOSITORY_FILES).map(compactRepositoryCandidate);
  const selectedPaths = new Set(repositoryFiles.map((item) => item.path));
  let worldModelId = null;
  let graphSnapshotId = null;
  let sourceSnapshotId = null;
  let graphNodes = [];
  let graphEdges = [];
  let availableRelationTypes = [];
  let graphNodeOmissions = 0;
  let graphEdgeOmissions = 0;

  if (currentWorldState === "current-verified") {
    const inspectedWorld = inspectWorldModel({ root: inspectedProject.project.projectRoot });
    if (inspectedWorld.status !== "current") {
      const error = new Error("Context preparation requires the same current World Model verified by the preview.");
      error.code = "CONTEXT_PREPARATION_WORLD_DRIFT";
      throw error;
    }
    const graph = inspectedWorld.snapshot.temporalProvenanceGraph;
    worldModelId = inspectedWorld.snapshot.worldModelId;
    graphSnapshotId = graph?.graphSnapshotId || null;
    sourceSnapshotId = graph?.sourceSnapshotId || null;
    if (graph) {
      const matchingNodes = graph.nodes.filter((node) => selectedPaths.has(node.path));
      graphNodes = matchingNodes.slice(0, MAX_PREPARATION_GRAPH_NODES).map(compactGraphNode);
      graphNodeOmissions = Math.max(0, matchingNodes.length - graphNodes.length);
      const selectedNodeIds = new Set(graphNodes.map((node) => node.nodeId));
      const matchingEdges = graph.edges.filter((edge) => selectedNodeIds.has(edge.from) || selectedNodeIds.has(edge.to));
      graphEdges = matchingEdges.slice(0, MAX_PREPARATION_GRAPH_EDGES).map((edge) => ({
        edgeId: edge.edgeId,
        type: edge.type,
        from: edge.from,
        to: edge.to,
        authorityClass: edge.authorityClass,
        freshness: edge.freshness,
        confidence: edge.confidence ?? 1,
      }));
      graphEdgeOmissions = Math.max(0, matchingEdges.length - graphEdges.length);
      availableRelationTypes = [...new Set(graph.edges.map((edge) => edge.type))].sort();
    }
  }

  const payload = {
    schemaVersion: 1,
    kind: "ContextPreparationProjection",
    protocolVersion: CONTEXT_PREPARATION_PROTOCOL_VERSION,
    status: decision.status,
    taskBinding: {
      callerTaskDigest: digest(task),
      callerTaskByteLength: Buffer.byteLength(task, "utf8"),
      compiledTaskDigest: digest(capsule.task),
      reuseRequirement: "hold-the-caller-task-byte-identical-through-proposal-and-preview",
    },
    currentBinding: {
      projectId: inspectedProject.project.projectId,
      worldModelId,
      graphSnapshotId,
      sourceSnapshotId,
      freshness: currentWorldState,
    },
    conversation: {
      userInput: "task-text-only",
      structuredInputAuthor: "provider-neutral-HEAD",
      coreRole: "bound-candidate-projection-and-proposal-verification-only",
      steps: [
        "HEAD semantically analyzes the exact user task.",
        "HEAD inspects these bounded candidates and uses ordinary repository search when the required evidence is absent.",
        "HEAD authors only task-required EvidenceNeeds and exact current graph anchors.",
        "HEAD calls head_context_preview; Core verifies current binding, bounds, eligibility, and actual inclusion.",
        "HEAD separately accepts or revises semantic sufficiency; coverage-complete is only a mechanical proof.",
      ],
    },
    lexicalBaseline: {
      role: "bounded-discovery-baseline-not-semantic-ranking-or-eligibility",
      capsuleId: capsule.capsuleId,
      budgetTier: capsule.budget.maxApproxTokens,
      usedApproxTokens: capsule.budget.usedApproxTokens,
      includedRepositoryFileCount: capsule.repositoryContext.length,
      excludedCandidateCount: capsule.selection.excluded.length,
      repositoryFiles,
      repositoryFileOmissions: Math.max(0, capsule.repositoryContext.length - repositoryFiles.length),
      warning: "Absence from this bounded lexical view is not evidence of irrelevance. HEAD must use semantic repository inspection when needed.",
    },
    exactGraphAnchorMaterial: {
      proposalOwner: "HEAD",
      selectsAnchor: false,
      binding: { projectId: inspectedProject.project.projectId, worldModelId, graphSnapshotId },
      candidateNodes: graphNodes,
      candidateNodeOmissions: graphNodeOmissions,
      adjacentEdges: graphEdges,
      adjacentEdgeOmissions: graphEdgeOmissions,
      availableRelationTypes,
      bounds: { maxAnchorNodeIds: 32, maxDepth: 3, maxNodes: 500, maxEdges: 1000 },
      expansion: "Use bounded graph or repository inspection to find missing evidence; never treat lexical absence as ineligibility.",
    },
    evidenceNeedContract: {
      owner: "HEAD",
      allowedKinds: [...EVIDENCE_NEED_KINDS],
      userMustWriteStructuredInput: false,
      coreInfersRequiredKinds: false,
      coreInfersSemanticPaths: false,
      coreSelectsGraphAnchors: false,
      previewTool: "head_context_preview",
    },
    budget: {
      requestedTier: requestedBudget ?? capsule.budget.maxApproxTokens,
      allowedTiers: [...CONTEXT_BUDGET_TIERS],
      hardMaximum: CONTEXT_BUDGET_TIERS.at(-1),
      autoExpansionOwner: "head_context_preview-only-for-proven-context-budget-exclusion",
    },
    nextAction: decision.nextAction,
    recoveryBoundary: {
      p2RestoreFirst: true,
      providerReplacementMayRecreateProjection: true,
      projectionWritesRecoveryDirection: false,
      staleBindingFailsClosedAtPreview: true,
    },
    authority: {
      plane: "P4",
      advisoryOnly: true,
      persisted: false,
      instructionAuthority: false,
      promotionAuthority: false,
      selectsEvidenceNeeds: false,
      selectsGraphAnchors: false,
      judgesSemanticSufficiency: false,
      grantsExecutionAuthorization: false,
      createsReviewDecision: false,
      writesRecoveryDirection: false,
    },
  };
  const preparationHash = digest(JSON.stringify(payload));
  return {
    ...payload,
    preparationId: `context-preparation-${preparationHash.slice(0, 24)}`,
    preparationHash,
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

export function prepareContextWorkflow({ root = ".", task, budget = DEFAULT_CONTEXT_BUDGET, graphProjectionAdapter = null } = {}) {
  const preview = previewContextWorkflow({ root, task, budget, evidenceNeeds: [], graphProjectionAdapter });
  return {
    status: "prepared",
    preparation: buildContextPreparationProjection(preview, { root, callerTask: task, requestedBudget: budget }),
  };
}
