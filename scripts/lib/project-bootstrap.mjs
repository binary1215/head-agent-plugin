import { convergeProjectInstallation, initializeProject, inspectProject } from "./head-core.mjs";
import { inspectOnboarding, refreshOnboardingCandidates, startOnboarding } from "./onboarding.mjs";
import { buildRepositorySourceScope } from "./repository-source-scope.mjs";

export const PROJECT_BOOTSTRAP_PROTOCOL_VERSION = "0.2.0";

const PROJECT_PROFILES = new Set(["core", "product"]);

const ALLOWED_ONBOARDING_FIELDS = new Set(["mode", "storage", "brief", "sourceScope"]);

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
    return {
      status: "head_ready",
      protocolVersion: PROJECT_BOOTSTRAP_PROTOCOL_VERSION,
      profile,
      projectAction: before.status === "not_initialized" ? "initialized" : "resumed",
      installationAction: installation.status,
      onboardingAction: productGovernanceActivated ? "preserved-existing-state" : "not-activated",
      inputDisposition: "not-applicable",
      productGovernanceActivated,
      project: {
        projectId: current.sessionRecord.projectId,
        sessionId: current.sessionRecord.sessionId,
        runtimes: inspectProject(root).project.runtimes,
      },
      onboarding: onboardingSummary(current),
    };
  }

  let onboardingAction;
  if (["initialized", "migration_required", "awaiting_evidence", "rejected"].includes(current.status)) {
    const started = await startOnboarding({ root, ...onboardingInput });
    onboardingAction = current.status === "initialized" || current.status === "migration_required" ? "started" : "resumed-analysis";
    const inspected = inspectOnboarding({ root });
    return {
      status: started.status,
      protocolVersion: PROJECT_BOOTSTRAP_PROTOCOL_VERSION,
      profile,
      productGovernanceActivated: true,
      projectAction: before.status === "not_initialized" ? "initialized" : "resumed",
      installationAction: installation.status,
      onboardingAction,
      inputDisposition: "applied",
      project: {
        projectId: inspected.sessionRecord.projectId,
        sessionId: inspected.sessionRecord.sessionId,
        runtimes: inspectProject(root).project.runtimes,
      },
      onboarding: onboardingSummary(inspected),
    };
  }

  if (current.status === "awaiting_review" || current.status === "revision_required") {
    const refresh = await refreshOnboardingCandidates({ root });
    if (refresh.refreshed) {
      current = inspectOnboarding({ root });
      return {
        status: current.status,
        protocolVersion: PROJECT_BOOTSTRAP_PROTOCOL_VERSION,
        profile,
        productGovernanceActivated: true,
        projectAction: before.status === "not_initialized" ? "initialized" : "resumed",
        installationAction: installation.status,
        onboardingAction: "refreshed-stale-candidates",
        inputDisposition: Object.keys(onboardingInput).length ? "not-reapplied-to-existing-authority-state" : "not-required",
        project: {
          projectId: current.sessionRecord.projectId,
          sessionId: current.sessionRecord.sessionId,
          runtimes: inspectProject(root).project.runtimes,
        },
        onboarding: onboardingSummary(current),
        previousCandidateSetId: refresh.previousCandidateSetId,
      };
    }
  }

  const resumableWithoutMutation = new Set(["awaiting_review", "revision_required", "ready", "ready_world_changed"]);
  if (!resumableWithoutMutation.has(current.status)) {
    fail("PROJECT_BOOTSTRAP_STATE_UNSUPPORTED", `Unsupported onboarding resume status: ${current.status}`);
  }
  return {
    status: current.status,
    protocolVersion: PROJECT_BOOTSTRAP_PROTOCOL_VERSION,
    profile,
    productGovernanceActivated: true,
    projectAction: before.status === "not_initialized" ? "initialized" : "resumed",
    installationAction: installation.status,
    onboardingAction: current.status === "awaiting_review" || current.status === "revision_required" ? "review-required" : "already-ready",
    inputDisposition: Object.keys(onboardingInput).length ? "not-reapplied-to-existing-authority-state" : "not-required",
    project: {
      projectId: current.sessionRecord.projectId,
      sessionId: current.sessionRecord.sessionId,
      runtimes: inspectProject(root).project.runtimes,
    },
    onboarding: onboardingSummary(current),
  };
}
