import { convergeProjectInstallation, initializeProject, inspectProject } from "./head-core.mjs";
import { inspectOnboarding, startOnboarding } from "./onboarding.mjs";
import { buildRepositorySourceScope } from "./repository-source-scope.mjs";

export const PROJECT_BOOTSTRAP_PROTOCOL_VERSION = "0.1.0";

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

function onboardingSummary(inspected) {
  return {
    status: inspected.status,
    phase: inspected.state.phase,
    stateRevision: inspected.state.stateRevision,
    storageMode: inspected.storageSelection.mode,
    candidateSetId: inspected.state.candidateSetId,
    candidateCount: inspected.candidateSet?.candidates.length || 0,
    reviewDecisionId: inspected.state.reviewDecisionId,
    productModelId: inspected.state.productModelId,
    worldModelId: inspected.state.worldModelId,
    sourceSnapshotId: inspected.state.sourceSnapshotId,
  };
}

export async function initializeOrResumeProject({ root = ".", pluginRoot, runtimes = null, onboarding = null } = {}) {
  const onboardingInput = validateOnboardingInput(onboarding);
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

  const current = inspectOnboarding({ root });
  let onboardingAction;
  if (["initialized", "migration_required", "awaiting_evidence", "rejected"].includes(current.status)) {
    const started = await startOnboarding({ root, ...onboardingInput });
    onboardingAction = current.status === "initialized" || current.status === "migration_required" ? "started" : "resumed-analysis";
    const inspected = inspectOnboarding({ root });
    return {
      status: started.status,
      protocolVersion: PROJECT_BOOTSTRAP_PROTOCOL_VERSION,
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

  const resumableWithoutMutation = new Set(["awaiting_review", "revision_required", "ready", "ready_world_changed"]);
  if (!resumableWithoutMutation.has(current.status)) {
    fail("PROJECT_BOOTSTRAP_STATE_UNSUPPORTED", `Unsupported onboarding resume status: ${current.status}`);
  }
  return {
    status: current.status,
    protocolVersion: PROJECT_BOOTSTRAP_PROTOCOL_VERSION,
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
