import { inspectProject } from "./head-core.mjs";

export const OPERATING_LANE_POLICY_VERSION = "0.1.0";

const LANES = Object.freeze(["observe", "session", "run", "authority"]);
const WORKSPACE_EFFECTS = Object.freeze(["none", "reversible", "consequential"]);

function fail(message, code = "INVALID_OPERATING_LANE_INPUT") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function boolean(value, label) {
  if (value == null) return false;
  if (typeof value !== "boolean") fail(`${label} must be a boolean.`);
  return value;
}

function boundedInteger(value, label, minimum, maximum) {
  if (value == null) return minimum;
  if (!Number.isInteger(value) || value < minimum || value > maximum) fail(`${label} must be an integer from ${minimum} to ${maximum}.`);
  return value;
}

function enumValue(value, label, allowed, fallback) {
  const normalized = value == null ? fallback : String(value).trim().toLowerCase();
  if (!allowed.includes(normalized)) fail(`${label} must be one of: ${allowed.join(", ")}.`);
  return normalized;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

export function recommendOperatingLane({
  root = ".",
  intent = "observe",
  workspaceEffect = "none",
  dependencyCount = 0,
  providerInvocation = false,
  handoff = false,
  contextReplacement = false,
  independentReview = false,
  failureBranches = false,
  humanDecisionDuringExecution = false,
  irreversible = false,
  externalWrite = false,
  usesCredentials = false,
  productCanonMutation = false,
  productInitiativeDecision = false,
  recoveryCheckpointReplacement = false,
} = {}) {
  const inspected = inspectProject(root);
  if (inspected.status !== "ready") fail(`Project must be ready for lane recommendation; current status: ${inspected.status}.`, "PROJECT_NOT_READY");
  const input = {
    intent: enumValue(intent, "intent", ["observe", "execute"], "observe"),
    workspaceEffect: enumValue(workspaceEffect, "workspaceEffect", WORKSPACE_EFFECTS, "none"),
    dependencyCount: boundedInteger(dependencyCount, "dependencyCount", 0, 32),
    providerInvocation: boolean(providerInvocation, "providerInvocation"),
    handoff: boolean(handoff, "handoff"),
    contextReplacement: boolean(contextReplacement, "contextReplacement"),
    independentReview: boolean(independentReview, "independentReview"),
    failureBranches: boolean(failureBranches, "failureBranches"),
    humanDecisionDuringExecution: boolean(humanDecisionDuringExecution, "humanDecisionDuringExecution"),
    irreversible: boolean(irreversible, "irreversible"),
    externalWrite: boolean(externalWrite, "externalWrite"),
    usesCredentials: boolean(usesCredentials, "usesCredentials"),
    productCanonMutation: boolean(productCanonMutation, "productCanonMutation"),
    productInitiativeDecision: boolean(productInitiativeDecision, "productInitiativeDecision"),
    recoveryCheckpointReplacement: boolean(recoveryCheckpointReplacement, "recoveryCheckpointReplacement"),
  };

  const authorityReasons = uniqueSorted([
    input.productCanonMutation && "product-canon-mutation",
    input.productInitiativeDecision && "product-initiative-decision",
    input.externalWrite && "external-write",
    input.usesCredentials && "credential-bound-action",
    input.recoveryCheckpointReplacement && "recovery-checkpoint-replacement",
  ]);
  const runReasons = uniqueSorted([
    input.workspaceEffect === "consequential" && "consequential-workspace-effect",
    input.dependencyCount >= 2 && "multiple-dependent-results",
    input.independentReview && "independent-review-required",
    input.failureBranches && "failure-recovery-branches",
    input.humanDecisionDuringExecution && "mid-run-human-decision",
    input.irreversible && "irreversible-effect",
  ]);
  const sessionReasons = uniqueSorted([
    input.intent === "execute" && "execution-requested",
    input.providerInvocation && "provider-invocation",
    input.workspaceEffect === "reversible" && "reversible-workspace-effect",
    input.handoff && "handoff-needs-bounded-context",
    input.contextReplacement && "context-replacement-needs-bounded-context",
  ]);

  const lane = authorityReasons.length ? "authority" : runReasons.length ? "run" : sessionReasons.length ? "session" : "observe";
  const selectedReasons = lane === "authority" ? authorityReasons : lane === "run" ? runReasons : lane === "session" ? sessionReasons : ["read-or-reason-only"];
  const contracts = lane === "observe"
    ? []
    : lane === "session"
      ? ["exact-session-request", "session-scoped-execution-authorization-if-provider-invoked", ...(input.handoff || input.contextReplacement ? ["optional-context-capsule"] : [])]
      : ["WholePlanSnapshot", "ExecutionContract", "ContextCapsule", "ResultPacket", "FreshHeadReview", ...(lane === "authority" ? ["explicit-user-decision-at-affected-boundary"] : [])];

  return {
    status: "recommended",
    protocol: { name: "head-agent-core-operating-lane-policy", version: OPERATING_LANE_POLICY_VERSION },
    projectId: inspected.project.projectId,
    sessionId: inspected.state.sessionId,
    lane,
    reasons: selectedReasons,
    input,
    minimumContracts: contracts,
    persistence: lane === "observe" ? "none-by-default" : lane === "session" ? "session-position-and-execution-evidence-only" : "recoverable-lineage-required",
    automaticEscalation: {
      toSession: ["provider-invocation", "reversible-workspace-effect", "handoff", "context-replacement"],
      toRun: ["multiple-dependent-results", "consequential-or-irreversible-effect", "failure-recovery-branch", "independent-review", "mid-run-human-decision"],
      toAuthority: ["product-canon-mutation", "product-initiative-decision", "external-write", "credential-bound-action", "recovery-checkpoint-replacement"],
    },
    supportedLanes: LANES,
    authority: "advisory-lane-selection-only",
    persisted: false,
    instructionAuthority: false,
    promotionAuthority: false,
  };
}
