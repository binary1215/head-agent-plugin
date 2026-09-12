export const EXPERIENCE_PROJECTION_PROTOCOL_VERSION = "0.1.0";

function item({ id, owner, severity = "notice", actionability: itemActionability = "immediate", summary, blockedOperations = [] }) {
  return { id, owner, severity, actionability: itemActionability, summary, blockedOperations };
}

export function actionability({
  userDecisionRequired = false,
  headActionRequired = false,
  recoveryDependentWorkBlocked = false,
  ordinaryWorkBlocked = false,
  blockedOperations = [],
} = {}) {
  return {
    userDecisionRequired: userDecisionRequired === true,
    headActionRequired: headActionRequired === true,
    recoveryDependentWorkBlocked: recoveryDependentWorkBlocked === true,
    ordinaryWorkBlocked: ordinaryWorkBlocked === true,
    blockedOperations: [...new Set(blockedOperations)].sort(),
  };
}

export function buildAttentionProjection(experience) {
  const core = experience?.readiness?.core || {};
  const product = experience?.readiness?.product || {};
  const recovery = experience?.readiness?.recovery || {};
  const runtime = experience?.runtime || {};
  const items = [];

  if (core.state === "not_initialized") items.push(item({
    id: "core-initialization",
    owner: "HEAD",
    summary: "Initialize the Core only because HEAD use was requested for this project.",
    blockedOperations: ["head-managed-capabilities"],
  }));
  if (core.state === "drifted") items.push(item({
    id: "managed-projection-drift",
    owner: "HEAD",
    severity: "integrity",
    summary: "Inspect managed projection drift before a mutating HEAD operation.",
    blockedOperations: ["head-managed-mutation"],
  }));
  if (recovery.headActionRequired) items.push(item({
    id: "recovery-verification",
    owner: "HEAD",
    severity: "integrity",
    summary: `Inspect recovery evidence before checkpoint-dependent work (${recovery.reasonCode || recovery.state}).`,
    blockedOperations: ["checkpoint-dependent-work"],
  }));
  if (product.state === "review_required") items.push(item({
    id: "product-canon-review",
    owner: "user",
    severity: "decision",
    actionability: "when-product-governance-is-in-scope",
    summary: "Product candidates need an explicit review before Product Canon promotion.",
    blockedOperations: ["product-canon-promotion"],
  }));
  if (["evidence_required", "refresh_required", "migration_required"].includes(product.state)) items.push(item({
    id: "product-governance-follow-up",
    owner: "HEAD",
    actionability: "when-product-governance-is-in-scope",
    summary: "Product governance needs bounded follow-up only when the current task depends on it.",
    blockedOperations: ["product-governance-dependent-work"],
  }));
  if (runtime.state === "project-integration-outdated") items.push(item({
    id: "plugin-integration-update",
    owner: "HEAD",
    summary: "Converge the project integration, then restart the Host to load the configured package.",
    blockedOperations: ["new-plugin-capabilities"],
  }));

  const immediate = items.filter((entry) => entry.actionability === "immediate");
  const userDecisionRequired = immediate.some((entry) => entry.owner === "user");
  const headActionRequired = immediate.some((entry) => entry.owner === "HEAD");
  return {
    kind: "HeadAttentionProjection",
    protocolVersion: EXPERIENCE_PROJECTION_PROTOCOL_VERSION,
    status: immediate.length ? "attention" : items.length ? "notice" : "clear",
    items,
    counts: {
      total: items.length,
      userDecision: immediate.filter((entry) => entry.owner === "user").length,
      headAction: immediate.filter((entry) => entry.owner === "HEAD").length,
      availableUserDecision: items.filter((entry) => entry.owner === "user" && entry.actionability !== "immediate").length,
      conditionalHeadAction: items.filter((entry) => entry.owner === "HEAD" && entry.actionability !== "immediate").length,
    },
    ...actionability({
      userDecisionRequired,
      headActionRequired,
      recoveryDependentWorkBlocked: recovery.recoveryDependentWorkBlocked,
      ordinaryWorkBlocked: false,
      blockedOperations: items.flatMap((entry) => entry.blockedOperations),
    }),
    authority: {
      plane: "P4",
      advisoryOnly: true,
      persisted: false,
      createsReviewDecision: false,
      writesRecoveryDirection: false,
      grantsAuthorization: false,
    },
  };
}

export function buildPresentationProjection(attention) {
  const mode = attention.userDecisionRequired ? "decision"
    : attention.headActionRequired ? "exception"
      : attention.status === "notice" ? "notice" : "quiet";
  return {
    kind: "HeadPresentationProjection",
    protocolVersion: EXPERIENCE_PROJECTION_PROTOCOL_VERSION,
    mode,
    successPolicy: "one-line-unless-details-requested",
    exceptionPolicy: "show-owner-reason-affected-scope-and-next-action",
    technicalDetails: "structured-result-or-json",
    userDecisionRequired: attention.userDecisionRequired,
    headActionRequired: attention.headActionRequired,
    ordinaryWorkBlocked: attention.ordinaryWorkBlocked,
    authority: {
      advisoryOnly: true,
      persisted: false,
      createsReviewDecision: false,
      writesRecoveryDirection: false,
    },
  };
}

export function withExperienceProjections(experience) {
  const attention = buildAttentionProjection(experience);
  return { ...experience, attention, presentation: buildPresentationProjection(attention) };
}
