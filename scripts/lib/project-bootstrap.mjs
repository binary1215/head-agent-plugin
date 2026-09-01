import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { convergeProjectInstallation, initializeProject, inspectProject } from "./head-core.mjs";
import { inspectOnboarding, refreshOnboardingCandidates, startOnboarding } from "./onboarding.mjs";
import { buildRepositorySourceScope } from "./repository-source-scope.mjs";

export const PROJECT_BOOTSTRAP_PROTOCOL_VERSION = "0.4.0";

const packageVersion = JSON.parse(fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json"),
  "utf8",
)).version;

const PROJECT_PROFILES = new Set(["core", "product"]);

const ALLOWED_ONBOARDING_FIELDS = new Set(["mode", "storage", "brief", "semanticProposal", "sourceScope"]);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function validateOnboardingInput(value) {
  const source = value == null ? {} : value;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    fail("PROJECT_BOOTSTRAP_INPUT_INVALID", "Onboarding input must be an object.");
  }
  const unexpected = Object.keys(source).filter((field) => !ALLOWED_ONBOARDING_FIELDS.has(field));
  if (unexpected.length) fail("PROJECT_BOOTSTRAP_INPUT_INVALID", `Onboarding input contains unsupported fields: ${unexpected.sort().join(", ")}`);
  if (source.sourceScope != null) buildRepositorySourceScope(source.sourceScope);
  return source;
}

function validateProfile(value) {
  const profile = value == null ? "core" : String(value).trim();
  if (!PROJECT_PROFILES.has(profile)) {
    fail("PROJECT_BOOTSTRAP_PROFILE_INVALID", `Project profile must be one of: ${[...PROJECT_PROFILES].join(", ")}.`);
  }
  return profile;
}

function onboardingSummary(inspected) {
  const latestReviewDecisionId = inspected.state.latestReviewDecisionId ?? inspected.state.reviewDecisionId ?? null;
  return {
    status: inspected.status,
    phase: inspected.state.phase,
    stateRevision: inspected.state.stateRevision,
    storageMode: inspected.storageSelection.mode,
    candidateSetId: inspected.state.candidateSetId,
    candidateCount: inspected.candidateSet?.candidates.length || 0,
    latestReviewDecisionId,
    reviewDecisionId: latestReviewDecisionId,
    productModelId: inspected.state.productModelId,
    worldModelId: inspected.state.worldModelId,
    sourceSnapshotId: inspected.state.sourceSnapshotId,
  };
}

function productReadiness(status) {
  const states = {
    initialized: {
      state: "not_activated",
      status: "core_ready",
      action: "work_directly",
      summary: "The constitutional Core is ready. Use Product governance only when product meaning or governed projections are needed.",
    },
    migration_required: {
      state: "migration_required",
      status: "product_migration_required",
      action: "resume_product_governance",
      summary: "Core is ready, but legacy Product onboarding state must be migrated before Product governance can continue.",
    },
    awaiting_evidence: {
      state: "evidence_required",
      status: "product_evidence_required",
      action: "provide_product_evidence",
      summary: "Product governance is active and needs a user-owned brief or a fresh HEAD semantic proposal bound to current repository evidence.",
    },
    awaiting_review: {
      state: "review_required",
      status: "product_review_required",
      action: "review_product_candidates",
      summary: "Evidence-linked Product candidates are waiting for an explicit user ReviewDecision.",
    },
    revision_required: {
      state: "review_required",
      status: "product_review_required",
      action: "review_product_candidates",
      summary: "A revised Product candidate set is waiting for an explicit user ReviewDecision.",
    },
    rejected: {
      state: "rejected",
      status: "product_rejected",
      action: "resume_product_governance",
      summary: "The current Product candidate set was rejected. Core remains ready and Product governance may be resumed explicitly.",
    },
    ready: {
      state: "ready",
      status: "product_ready",
      action: "work_with_product_context",
      summary: "Core and the reviewed Product/World path are ready for task-scoped use.",
    },
    ready_world_changed: {
      state: "refresh_required",
      status: "product_refresh_required",
      action: "refresh_product_world",
      summary: "Reviewed Product Canon is preserved, but its derived World projection must be refreshed or reconciled.",
    },
  };
  return states[status] || {
    state: "inspection_required",
    status: "product_inspection_required",
    action: "inspect_product_governance",
    summary: `Product governance reported an unrecognized state: ${status}.`,
  };
}

function contextReadiness({ coreState, productState, onboardingInspection = null }) {
  const entrypoint = {
    cli: "head-agent context-prepare <project> --task <exact-task>",
    mcpTool: "head_context_prepare",
  };
  if (coreState !== "ready") return {
    state: "blocked",
    repositoryEvidence: "blocked-until-core-ready",
    worldModelId: null,
    entrypoint,
  };
  if (productState === "refresh_required") return {
    state: "world-refresh-required",
    repositoryEvidence: "stale-excluded",
    worldModelId: onboardingInspection?.state?.worldModelId || null,
    entrypoint,
  };
  if (onboardingInspection?.state?.worldModelId) return {
    state: "repository-ready",
    repositoryEvidence: "available-current-world",
    worldModelId: onboardingInspection.state.worldModelId,
    entrypoint,
  };
  return {
    state: "curated-only",
    repositoryEvidence: "requires-explicit-product-world",
    worldModelId: null,
    entrypoint,
  };
}

function runtimeProjection() {
  return {
    activePackageVersion: packageVersion,
    reloadPolicy: "restart-host-after-install-or-upgrade",
    providerSessionIdentityPersisted: false,
  };
}

function entrypoint(action) {
  const entries = {
    initialize_core: {
      cli: "head-agent init <project> --runtime <runtimes>",
      mcpTool: "head_project_initialize_or_resume",
      mcpArguments: { profile: "core" },
    },
    review_managed_projection_drift: {
      cli: "head-agent doctor <project>",
      mcpTool: "head_project_status",
      note: "Review each reported managed-file drift before choosing an explicit repair.",
    },
    work_directly: {
      cli: "head-agent status <project>",
      mcpTool: "head_project_status",
      alternative: { mcpTool: "head_project_initialize_or_resume", mcpArguments: { profile: "product" } },
    },
    provide_product_evidence: {
      cli: "head-agent resume <project> --profile product --input <onboarding.json>",
      mcpTool: "head_project_initialize_or_resume",
      mcpArguments: { profile: "product" },
    },
    review_product_candidates: {
      cli: "head-agent onboarding-status <project>",
      mcpTool: "head_onboarding_guide",
    },
    resume_product_governance: {
      cli: "head-agent resume <project> --profile product",
      mcpTool: "head_project_initialize_or_resume",
      mcpArguments: { profile: "product" },
    },
    refresh_product_world: {
      cli: "head-agent world-refresh <project>",
      mcpTool: null,
      note: "The current typed MCP surface is read-only for refresh state; use the explicit CLI mutation entrypoint.",
    },
    work_with_product_context: {
      cli: "head-agent context-prepare <project> --task <exact-task>",
      mcpTool: "head_context_prepare",
    },
    inspect_product_governance: {
      cli: "head-agent onboarding-status <project>",
      mcpTool: "head_onboarding_guide",
    },
  };
  return entries[action];
}

function capabilityGuide({ coreState, productState, contextState, runtimes = [] }) {
  const coreAvailable = coreState === "ready";
  const blocked = coreAvailable ? null : "blocked-until-core-ready";
  return [
    {
      id: "direct-work",
      availability: blocked || "available",
      useWhen: "The task can be completed coherently in the current Project and Session without durable execution governance.",
      entrypoint: "Use the active coding conversation; HEAD artifacts are not required for ordinary edits.",
    },
    {
      id: "product-governance",
      availability: blocked || (productState === "not_activated" ? "available-not-activated" : productState === "ready" ? "active-ready" : "active-action-required"),
      useWhen: "The task needs reviewed product meaning, World/Graph evidence, or governed document projections.",
      entrypoint: "head_project_initialize_or_resume profile=product, then head_onboarding_guide",
    },
    {
      id: "context-compiler",
      availability: blocked || contextState.repositoryEvidence,
      useWhen: "The exact task needs reproducible minimum-sufficient evidence or a durable Run Capsule.",
      entrypoint: "head_context_prepare",
    },
    {
      id: "durable-run",
      availability: blocked || "available-on-demand",
      useWhen: "Execution is long, risky, review-sensitive, or must survive provider/context loss.",
      entrypoint: "WholePlanSnapshot -> ExecutionContract + ContextCapsule -> ResultPacket -> Fresh HEAD review",
    },
    {
      id: "bounded-workers",
      availability: blocked || "requires-active-run-authorization",
      useWhen: "Independent, bounded whole outcomes can run in parallel under one Whole-plan HEAD.",
      entrypoint: "Create exact per-worker authorizations before dispatch or wave grouping.",
    },
    {
      id: "compaction-recovery",
      availability: blocked || "available-on-demand",
      useWhen: "Direction must survive intentional compaction or provider replacement.",
      entrypoint: "Prepare and verify an immutable checkpoint before one-shot continuation.",
    },
    {
      id: "provider-runtime",
      availability: blocked || "requires-capability-inspection-and-authorization",
      useWhen: "A selected provider must execute an explicitly bounded Session or Run action.",
      entrypoint: "head_runtime_adapters, then an exact ExecutionAuthorization",
      selectedRuntimes: runtimes,
    },
  ];
}

function projectExperience(projectInspection, onboardingInspection = null) {
  if (projectInspection.status === "not_initialized") {
    const action = "initialize_core";
    const context = contextReadiness({ coreState: "not_initialized", productState: "unavailable" });
    return {
      kind: "HeadProjectExperienceProjection",
      protocolVersion: PROJECT_BOOTSTRAP_PROTOCOL_VERSION,
      status: "not_initialized",
      projectRoot: projectInspection.projectRoot,
      readiness: {
        core: { state: "not_initialized", managedProjectionDriftCount: 0 },
        product: { state: "unavailable", governanceActivated: false, onboardingStatus: null },
        context,
      },
      nextAction: { id: action, summary: "Initialize the constitutional Core and one canonical Project/Session before using optional capabilities.", entrypoint: entrypoint(action) },
      capabilities: capabilityGuide({ coreState: "not_initialized", productState: "unavailable", contextState: context }),
      runtime: runtimeProjection(),
      authority: { advisoryOnly: true, persisted: false, mutatesProject: false, activatesCapabilities: false, grantsAuthorization: false },
    };
  }

  const product = onboardingInspection ? productReadiness(onboardingInspection.status) : {
    state: "inspection_blocked",
    status: "core_drifted",
    action: "review_managed_projection_drift",
    summary: "Managed project projections have drifted. Product readiness is not inferred until Core integrity is restored.",
  };
  const coreState = projectInspection.status === "ready" ? "ready" : "drifted";
  const context = contextReadiness({ coreState, productState: product.state, onboardingInspection });
  const action = coreState === "ready" ? product.action : "review_managed_projection_drift";
  return {
    kind: "HeadProjectExperienceProjection",
    protocolVersion: PROJECT_BOOTSTRAP_PROTOCOL_VERSION,
    status: coreState === "ready" ? product.status : "core_drifted",
    project: { ...projectInspection.project, sessionId: projectInspection.state.sessionId },
    state: projectInspection.state,
    drift: projectInspection.drift,
    readiness: {
      core: { state: coreState, managedProjectionDriftCount: projectInspection.drift.length },
      product: {
        state: product.state,
        governanceActivated: onboardingInspection ? !["initialized", "migration_required"].includes(onboardingInspection.status) : null,
        onboardingStatus: onboardingInspection?.status || null,
      },
      context,
    },
    nextAction: {
      id: action,
      summary: coreState === "ready" ? product.summary : "Review managed-file drift before any mutating HEAD operation. No automatic repair is attempted.",
      entrypoint: entrypoint(action),
    },
    capabilities: capabilityGuide({ coreState, productState: product.state, contextState: context, runtimes: projectInspection.project.runtimes }),
    runtime: runtimeProjection(),
    authority: { advisoryOnly: true, persisted: false, mutatesProject: false, activatesCapabilities: false, grantsAuthorization: false },
  };
}

export function inspectProjectExperience({ root = "." } = {}) {
  const project = inspectProject(root);
  if (project.status !== "ready") return projectExperience(project);
  return projectExperience(project, inspectOnboarding({ root }));
}

function bootstrapResponse({ root, profile, before, installation, onboardingAction, inputDisposition, inspected, extra = {} }) {
  const experience = projectExperience(inspectProject(root), inspected);
  return {
    ...experience,
    profile,
    profileSemantics: "operation-choice-not-persisted-project-mode",
    projectAction: before.status === "not_initialized" ? "initialized" : "resumed",
    installationAction: installation.status,
    onboardingAction,
    inputDisposition,
    productGovernanceActivated: experience.readiness.product.governanceActivated,
    onboarding: onboardingSummary(inspected),
    ...extra,
  };
}

export async function initializeOrResumeProject({ root = ".", pluginRoot, runtimes = null, profile: requestedProfile = "core", onboarding = null } = {}) {
  const profile = validateProfile(requestedProfile);
  const onboardingInput = validateOnboardingInput(onboarding);
  if (profile === "core" && Object.keys(onboardingInput).length) {
    fail("PROJECT_BOOTSTRAP_PROFILE_REQUIRED", "Onboarding input requires the explicit product profile.");
  }
  const before = inspectProject(root);
  let initialization;
  let installation;
  if (before.status === "not_initialized") {
    initialization = initializeProject({ root, pluginRoot, runtimes: runtimes || undefined });
    installation = {
      status: "initialized-current",
      projectId: initialization.project.projectId,
      sessionId: inspectProject(root).state.sessionId,
      pluginRootChanged: false,
      updatedManagedFiles: [],
    };
  } else {
    initialization = {
      status: "resumed-existing-project",
      project: before.project,
      integrations: before.project.integrations,
    };
    installation = convergeProjectInstallation({ root, pluginRoot, runtimes });
  }

  let current = inspectOnboarding({ root });
  if (profile === "core") {
    const productGovernanceActivated = !["initialized", "migration_required"].includes(current.status);
    return bootstrapResponse({
      root,
      profile,
      onboardingAction: productGovernanceActivated ? "preserved-existing-state" : "not-activated",
      inputDisposition: "not-applicable",
      before,
      installation,
      inspected: current,
    });
  }

  let onboardingAction;
  if (["initialized", "migration_required", "rejected"].includes(current.status)
    || (current.status === "awaiting_evidence" && Object.keys(onboardingInput).length)) {
    const started = await startOnboarding({ root, ...onboardingInput });
    onboardingAction = current.status === "initialized" || current.status === "migration_required" ? "started" : "resumed-analysis";
    const inspected = inspectOnboarding({ root });
    return bootstrapResponse({
      root,
      profile,
      onboardingAction,
      inputDisposition: "applied",
      before,
      installation,
      inspected,
      extra: { onboardingOperationStatus: started.status },
    });
  }

  if (current.status === "awaiting_evidence") {
    return bootstrapResponse({
      root,
      profile,
      onboardingAction: "evidence-required",
      inputDisposition: "semantic-proposal-or-user-brief-required",
      before,
      installation,
      inspected: current,
    });
  }

  if (current.status === "awaiting_review" || current.status === "revision_required") {
    const refresh = await refreshOnboardingCandidates({ root, semanticProposal: onboardingInput.semanticProposal || null });
    if (refresh.refreshed) {
      current = inspectOnboarding({ root });
      return bootstrapResponse({
        root,
        profile,
        onboardingAction: "refreshed-stale-candidates",
        inputDisposition: Object.keys(onboardingInput).length ? "not-reapplied-to-existing-authority-state" : "not-required",
        before,
        installation,
        inspected: current,
        extra: { previousCandidateSetId: refresh.previousCandidateSetId },
      });
    }
    if (refresh.status === "onboarding_semantic_reproposal_required") {
      const response = bootstrapResponse({
        root,
        profile,
        onboardingAction: "fresh-head-semantic-reproposal-required",
        inputDisposition: "semantic-proposal-required",
        before,
        installation,
        inspected: current,
        extra: { currentSourceSnapshotId: refresh.currentSourceSnapshotId },
      });
      return {
        ...response,
        status: "product_evidence_required",
        readiness: {
          ...response.readiness,
          product: { ...response.readiness.product, state: "evidence_required" },
        },
        nextAction: {
          id: "provide_product_evidence",
          summary: "Repository evidence changed. Re-inspect the current SourceSnapshot and submit a fresh HEAD semantic proposal; do not review the stale candidate set.",
          entrypoint: entrypoint("provide_product_evidence"),
        },
      };
    }
  }

  const resumableWithoutMutation = new Set(["awaiting_review", "revision_required", "ready", "ready_world_changed"]);
  if (!resumableWithoutMutation.has(current.status)) {
    fail("PROJECT_BOOTSTRAP_STATE_UNSUPPORTED", `Unsupported onboarding resume status: ${current.status}`);
  }
  return bootstrapResponse({
    root,
    profile,
    onboardingAction: current.status === "awaiting_review" || current.status === "revision_required" ? "review-required" : "already-ready",
    inputDisposition: Object.keys(onboardingInput).length ? "not-reapplied-to-existing-authority-state" : "not-required",
    before,
    installation,
    inspected: current,
  });
}
