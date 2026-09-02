const PRODUCT_LABELS = {
  unavailable: "unavailable until Core initialization",
  not_activated: "not activated",
  inspection_blocked: "inspection blocked by Core drift",
  migration_required: "migration required",
  evidence_required: "evidence required",
  review_required: "review required",
  rejected: "rejected; Core remains usable",
  ready: "ready",
  refresh_required: "World refresh required",
};

const CONTEXT_LABELS = {
  blocked: "blocked until Core is ready",
  "curated-only": "curated evidence only; Product/World remains optional",
  "repository-ready": "current repository World evidence available",
  "world-refresh-required": "stale repository World excluded; refresh required",
};

const RECOVERY_LABELS = {
  "unavailable-until-core-ready": "available after Core initialization",
  "blocked-by-core-drift": "attention required because Core projections drifted",
  "no-current-checkpoint": "no current checkpoint; ordinary Session work is available",
  "verified-current-checkpoint": "current checkpoint verified and restorable",
  "attention-required": "current checkpoint needs attention before recovery",
};

function compactText(value, maxLength = 180) {
  const text = String(value || "").replace(/\s+/gu, " ").trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

function formatBudget(value) {
  return Number.isFinite(value) ? Number(value).toLocaleString("en-US") : "unknown";
}

function commandGroups(commands) {
  const groups = { "Core flow": [], Context: [], "Optional Product/World": [], "Advanced and recovery": [] };
  for (const command of commands) {
    if (/\b(context-|world-query|world-temporal|world-history|world-runtime)/u.test(command)) groups.Context.push(command);
    else if (/\b(onboarding|feature-mapping|world-|product-|release-|change-set|change-impact)/u.test(command)) groups["Optional Product/World"].push(command);
    else if (/\b(init|resume|status|doctor|--version)\b/u.test(command)) groups["Core flow"].push(command);
    else groups["Advanced and recovery"].push(command);
  }
  return groups;
}

export function formatHelp(value) {
  const groups = commandGroups(value.commands || []);
  const lines = [
    "HEAD Agent Core",
    "In a supported coding conversation, describe the task in ordinary language; HEAD handles the internal setup.",
    "Core-first by default. Product, World, Graph, durable Runs, and workers stay explicit.",
    "",
  ];
  for (const [name, commands] of Object.entries(groups)) {
    if (!commands.length) continue;
    lines.push(`${name}:`, ...commands.map((command) => `  ${command}`), "");
  }
  if (value.advancedCompatibilityCommand) lines.push(`All compatibility commands: ${value.advancedCompatibilityCommand}`);
  lines.push("Machine-readable output: add --json");
  return `${lines.join("\n").trimEnd()}\n`;
}

export function formatProjectStatus(value, { doctor = false } = {}) {
  const core = value.readiness?.core;
  const product = value.readiness?.product;
  const context = value.readiness?.context;
  const recovery = value.readiness?.recovery;
  const productDecision = product?.state === "review_required"
    ? "Product candidates need review; ordinary work remains available"
    : "none for ordinary work";
  const integrityAttention = core?.state === "drifted" || recovery?.userActionRequired;
  const next = value.nextAction?.id === "work_directly"
    ? "Continue the user's original task."
    : compactText(value.nextAction?.summary || "Continue with the task.");
  const lines = [
    core?.state === "ready"
      ? "HEAD is ready — continue the task in your coding conversation."
      : "HEAD needs one setup step before it can coordinate this project.",
    "",
    `Project: ${core?.state || value.status}`,
    `Recovery: ${RECOVERY_LABELS[recovery?.state] || recovery?.state || "unknown"}`,
    `Product knowledge: ${PRODUCT_LABELS[product?.state] || product?.state || "unknown"}`,
    `Context: ${CONTEXT_LABELS[context?.state] || context?.state || "unknown"}`,
    `User decision: ${productDecision}`,
  ];
  if (integrityAttention) {
    lines.push(core?.state === "drifted"
      ? "Integrity notice: inspect managed projection drift before a mutating HEAD operation."
      : "Recovery notice: inspect the checkpoint before relying on recovery; ordinary work remains available when it does not depend on that checkpoint.");
  }
  if (doctor || (value.drift?.length || 0) > 0) {
    lines.push(`Active package: ${value.runtime?.activePackageVersion || "unknown"}`);
    lines.push(`Managed projection drift: ${value.drift?.length || 0}`);
    for (const item of value.drift || []) lines.push(`  - ${item.path || item.kind || "managed artifact"}`);
    if (recovery?.reasonCode) lines.push(`Recovery diagnostic: ${recovery.reasonCode}`);
  }
  if (value.nextAction) {
    lines.push("", `Next: ${next}`);
    if (doctor && value.nextAction.entrypoint?.cli) lines.push(`Command: ${value.nextAction.entrypoint.cli}`);
    if (doctor && value.nextAction.entrypoint?.mcpTool) lines.push(`MCP: ${value.nextAction.entrypoint.mcpTool}`);
  }
  lines.push("", "This is read-only guidance; it grants no authority and changes no project state.");
  return `${lines.join("\n")}\n`;
}

export function formatProjectBootstrap(value) {
  const core = value.readiness?.core;
  const product = value.readiness?.product;
  const recovery = value.readiness?.recovery;
  const ready = core?.state === "ready";
  const needsProductReview = product?.state === "review_required";
  const integrityAttention = !ready || recovery?.userActionRequired;
  const next = value.nextAction?.id === "work_directly"
    ? "Continue the user's original task in this conversation."
    : compactText(value.nextAction?.summary || "Continue with the task.");
  return `${[
    ready ? "HEAD is ready." : "HEAD could not reach a ready Core state.",
    "",
    `Project: ${value.projectAction || "inspected"}`,
    `Recovery: ${RECOVERY_LABELS[recovery?.state] || recovery?.state || "unknown"}`,
    `Product knowledge: ${PRODUCT_LABELS[product?.state] || product?.state || "unknown"}`,
    `User decision: ${needsProductReview ? "required before Product candidates can be approved; ordinary work remains available" : "none"}`,
    ...(integrityAttention ? [ready
      ? "Recovery notice: inspect the checkpoint before relying on recovery; ordinary work remains available when independent of it."
      : "Integrity notice: inspect the reported Core boundary before a mutating HEAD operation."] : []),
    "",
    `Next: ${next}`,
    "Technical details remain available in the structured result or with --json.",
  ].join("\n")}\n`;
}

export function formatSessionRestore(value) {
  const checkpoint = value?.checkpoint || {};
  return `${[
    "HEAD recovered the current direction from verified project artifacts.",
    "",
    `Purpose: ${compactText(checkpoint.purpose || "not recorded", 240)}`,
    `Current position: ${compactText(checkpoint.currentPosition || "not recorded", 240)}`,
    `Next expected result: ${compactText(checkpoint.nextExpectedResult || "not recorded", 240)}`,
    `Open reviews: ${Array.isArray(checkpoint.openReviewIds) ? checkpoint.openReviewIds.length : 0}`,
    "",
    "A newer real user request takes priority over prepared continuation; this read changed no checkpoint or authority.",
    "Technical details remain available in the structured result or with --json.",
  ].join("\n")}\n`;
}

export function formatConversationRecovery(value) {
  const entry = value?.conversationEntry || value;
  const restored = entry?.restore?.checkpoint || entry?.restore?.projection?.checkpoint || {};
  const lines = [];
  if (value?.status === "compaction_lifecycle_prepared") {
    lines.push(
      "HEAD and the Host prepared compaction recovery automatically.",
      "The exact P2 direction is checkpointed and the one-time transport token stays Host-local.",
      "User action: none.",
    );
  } else if (entry?.status === "conversation_direction_restored") {
    lines.push(
      "HEAD restored the verified project direction automatically.",
      "User action: none — continue the original task.",
      "",
      `Purpose: ${compactText(restored.purpose || "verified current checkpoint", 240)}`,
      `Next expected result: ${compactText(restored.nextExpectedResult || "continue from the verified checkpoint", 240)}`,
    );
  } else if (entry?.status === "conversation_ready") {
    lines.push(
      "HEAD conversation entry is ready.",
      "No recovery checkpoint exists, so ordinary work continues without a recovery gate.",
      "User action: none.",
    );
  } else {
    lines.push(
      "HEAD could not verify recovery-dependent direction automatically.",
      `Reason: ${entry?.reasonCode || value?.reasonCode || "recovery evidence needs inspection"}`,
      "Ordinary independent work remains available; only work that depends on the unverified checkpoint is paused.",
      "User action: none unless HEAD identifies a material decision after inspection.",
    );
  }
  if (value?.status === "host_lifecycle_unavailable") {
    lines.push("Host compaction hooks are unavailable; first-turn artifact restore still works and provider compaction remains Host-owned.");
  } else if (value?.status === "compaction_lifecycle_prepared") {
    lines.push("The Host retained the one-time continuation internally; no token or lifecycle JSON is required from the user.");
  } else if (value?.status === "provider_compaction_outcome_uncertain") {
    lines.push("The provider outcome is uncertain and will not be replayed automatically. Verified P2 direction remains available.");
  } else if (value?.status === "conversation_direction_restored_without_transport_continuation") {
    lines.push("Transport continuation was unavailable, so HEAD will continue as a fresh logical HEAD from verified P2 artifacts.");
  } else if (value?.status === "compaction_lifecycle_continued" || value?.status === "compaction_lifecycle_already_continued") {
    lines.push("Verified continuation converged; duplicate Host delivery cannot apply it twice.");
  } else if (value?.status === "provider_compaction_failed" || value?.status === "provider_compaction_failure_already_recorded") {
    lines.push("Provider compaction failed; only that epoch was closed and verified P2 direction remains available.");
  } else if (value?.status === "compaction_lifecycle_superseded") {
    lines.push("A newer real user turn superseded the older prepared continuation.");
  } else if (value?.status === "head_direction_required") {
    lines.push("Provider HEAD must author the current bounded recovery direction internally; the user is not asked to fill a schema.");
  }
  lines.push("", "No provider summary, provider session identity, review result, or Product Canon was promoted by this projection.", "Technical details: use the structured result or --json");
  return `${lines.join("\n")}\n`;
}

export function formatOnboardingGuide(value) {
  const review = value?.review || {};
  const lines = [];
  if (["awaiting_review", "revision_required"].includes(value?.status)) {
    lines.push(
      "Product meaning needs your review.",
      "",
      `Subject: ${review.candidateCount || 0} evidence-linked Product candidates`,
      "Why now: candidates cannot become Product Canon without your explicit decision.",
    );
    for (const candidate of (review.candidates || []).slice(0, 5)) {
      lines.push(`  - ${compactText(candidate.name || "unnamed evidence-linked candidate", 120)} (${candidate.productKind || "candidate"})`);
    }
    if (review.truncated) lines.push(`  - ${Math.max(0, (review.candidateCount || 0) - (review.returnedCandidateCount || 0))} more candidates require inspection before a complete accept-all review.`);
    lines.push(
      `Unknowns: ${review.unknownCount || 0}`,
      "Options: accept all, accept a selection, revise, or reject.",
      "Recommendation: HEAD should assess the evidence in this conversation; Core supplies no automatic disposition.",
      "",
      "Reply in natural language. HEAD will re-read the exact current candidate set before applying an unambiguous decision.",
    );
  } else if (value?.status === "ready") {
    lines.push("Product knowledge is reviewed and ready for task-scoped use.", "User decision: none.", "Next: continue the original task.");
  } else {
    lines.push(
      `Product onboarding: ${value?.status || "inspection required"}.`,
      `Next: ${value?.nextAction || "inspect the current state"}.`,
      `User input needed: ${(value?.materialChoicesRequired || []).length ? value.materialChoicesRequired.join(", ") : "none"}.`,
    );
  }
  lines.push("", "This guidance is non-authoritative; technical IDs remain in the structured result.");
  return `${lines.join("\n")}\n`;
}

export function formatFeatureMappingStatus(value) {
  const candidates = value?.candidateSet?.candidates || [];
  const lines = [];
  if (value?.status === "awaiting_review") {
    lines.push(
      "Feature-to-code relationships need your review.",
      "",
      `Subject: ${candidates.length} evidence-linked mapping candidates`,
      "Why now: proposed relationships remain evidence until an explicit review.",
    );
    for (const candidate of candidates.slice(0, 5)) {
      lines.push(`  - ${compactText(candidate.explanation || candidate.description || "evidence-linked mapping proposal", 160)}`);
    }
    if (candidates.length > 5) lines.push(`  - ${candidates.length - 5} more candidates`);
    lines.push(
      "Options: accept all, accept a selection, or reject.",
      "Recommendation: none is generated mechanically; HEAD assesses the exact evidence.",
      "",
      "Reply in natural language. HEAD will verify the unchanged candidate set before applying the decision.",
    );
  } else if (value?.status === "reviewed") {
    lines.push("Feature mappings have an explicit review.", "Next: use reviewed relationships as task evidence when relevant.");
  } else {
    lines.push(`Feature mapping: ${value?.status || "not started"}.`, `Next: ${compactText(value?.nextAction || "inspect only when the task needs this mapping.")}`);
  }
  lines.push("", "Product Canon is unchanged; technical IDs remain in the structured result.");
  return `${lines.join("\n")}\n`;
}

export function formatPendingReview(value) {
  const review = value?.review || {};
  const plan = review.wholePlan || {};
  const result = review.resultPacket || {};
  const options = review.reviewProtocol?.allowedDispositions || [];
  return `${[
    "A durable Run result needs Fresh HEAD review.",
    "",
    `Objective: ${compactText(plan.objective || "not recorded", 240)}`,
    `Result: ${compactText(result.summary || result.status || "evidence packet ready", 240)}`,
    `Verification evidence: ${Array.isArray(result.verification) ? result.verification.length : Array.isArray(result.evidence) ? result.evidence.length : 0} item(s)`,
    `Options: ${options.length ? options.join(", ") : "accept, revise, expand, rollback, or escalate"}`,
    "",
    "Worker or ResultPacket completion is not acceptance. Review the evidence and reply with the intended disposition.",
    "Technical IDs remain in the structured result.",
  ].join("\n")}\n`;
}

export function formatConformanceQueue(value) {
  const findings = value?.findings || [];
  const lines = [
    `Conformance review queue: ${value?.totalMatches || 0} finding(s).`,
    "Ordinary work is not blocked by this queue.",
  ];
  for (const finding of findings.slice(0, 5)) {
    lines.push(`  - [${finding.status || "open"}] ${compactText(finding.claim?.summary || "finding", 160)}`);
  }
  if ((value?.omitted || 0) > 0) lines.push(`  - ${value.omitted} more finding(s) available on the next bounded page`);
  lines.push("", "A finding is evidence, not a violation or decision. Inspect one exact finding before disposition.", "Technical IDs remain in the structured result.");
  return `${lines.join("\n")}\n`;
}

export function formatConformanceFinding(value) {
  const finding = value?.finding || {};
  return `${[
    "One Conformance finding is ready for review.",
    "",
    `Subject: ${compactText(finding.claim?.summary || "conformance finding", 200)}`,
    `Risk hint: ${finding.claim?.riskHint || "unknown"}`,
    `Evidence anchors: ${Array.isArray(finding.evidenceAnchors) ? finding.evidenceAnchors.length : 0}`,
    `Resolution candidates: ${Array.isArray(value?.resolutions) ? value.resolutions.length : 0}`,
    "Options: acknowledge, defer, dismiss, request a code fix, request Canon revision, or accept an exact resolution.",
    "",
    "Reply in natural language. HEAD must re-read this exact current finding before recording a disposition.",
    "This finding neither blocks ordinary work nor authorizes a fix by itself.",
  ].join("\n")}\n`;
}

export function formatReviewOutcome(value) {
  const disposition = value?.reviewDecision?.disposition || value?.disposition?.disposition || "recorded";
  const authorityChanged = value?.authorityEffect === "explicit-product-canon-transition";
  return `${[
    "The explicit user decision was recorded.",
    "",
    `Disposition: ${disposition}`,
    `Product Canon changed: ${authorityChanged ? "yes, through the scoped ReviewDecision" : "no"}`,
    "Verification: the Core accepted the exact current target and structured decision.",
    "Remaining uncertainty: semantic correctness remains subject to the user's decision and cited evidence.",
    "",
    "Technical IDs remain in the structured result.",
  ].join("\n")}\n`;
}

export function formatContextPreparation(value) {
  const preparation = value?.preparation || {};
  const status = preparation.status;
  const titles = {
    curated_only: "HEAD Context: direct work is ready.",
    ready_for_head_evidence_proposal: "HEAD Context: current repository evidence is ready.",
    world_refresh_required: "HEAD Context: direct work is ready; stale World evidence remains excluded.",
  };
  const next = {
    curated_only: "HEAD will continue in this conversation and inspect the repository normally when needed.",
    ready_for_head_evidence_proposal: "HEAD will inspect the task, choose only the evidence it needs, and run the preview itself.",
    world_refresh_required: "HEAD will continue direct inspection and refresh World only if this task truly needs a reproducible Capsule.",
  };
  const lines = [
    titles[status] || `HEAD Context: ${status || value?.status || "prepared"}.`,
    "Task binding: verified for the supplied task.",
    "User action: none. You do not need to write EvidenceNeed JSON, choose graph IDs, or select a token budget.",
    `Next: ${next[status] || compactText(preparation.nextAction?.summary || "HEAD continues with the task.")}`,
  ];
  if (status === "curated_only") {
    lines.push("Product/World remains optional and will be mentioned only if reproducible governed evidence is actually needed.");
  }
  lines.push("", "Technical details: rerun with --json");
  return `${lines.join("\n")}\n`;
}

export function formatContextPreview(value) {
  const workflow = value?.workflow || {};
  const coverage = value?.capsule?.coverageAssessment || {};
  const budget = workflow.budget || value?.capsule?.budget || {};
  const titles = {
    ready_for_head_semantic_assessment: "HEAD Context preview: requested evidence is included.",
    evidence_needs_unassessed: "HEAD Context preview: ready for HEAD task analysis.",
    world_evidence_unavailable: "HEAD Context preview: direct work remains available; requested World evidence is unavailable.",
    world_refresh_required: "HEAD Context preview: direct work remains available; stale World evidence was excluded.",
    evidence_gap_requires_head_action: "HEAD Context preview: some requested evidence is still missing.",
  };
  const lines = [
    titles[workflow.status] || `HEAD Context preview: ${workflow.status || value?.status || "complete"}.`,
    `Mechanical coverage: ${coverage.status || workflow.evidenceNeeds?.status || "not requested"}`,
    `Budget: ${formatBudget(budget.usedApproxTokens)} used at the ${formatBudget(budget.currentTier || budget.maxApproxTokens)} tier`,
  ];
  if ((budget.attemptedTiers || []).length > 1) {
    lines.push(`Automatic expansion: ${(budget.attemptedTiers || []).map(formatBudget).join(" → ")}`);
  }
  if (workflow.status === "ready_for_head_semantic_assessment") {
    lines.push("User action: none. HEAD now makes the separate semantic sufficiency judgment.");
  } else if (["evidence_needs_unassessed", "world_evidence_unavailable", "world_refresh_required"].includes(workflow.status)) {
    lines.push("User action: none unless HEAD explains that a governed, reproducible Capsule is required for this task.");
  } else {
    lines.push("Next: HEAD will inspect or gather the missing evidence; this preview is not treated as execution approval.");
  }
  lines.push("This preview changed no project state and granted no authority.", "", "Technical details: rerun with --json");
  return `${lines.join("\n")}\n`;
}

export function formatMcpToolContent(name, value) {
  if (name === "head_project_status") return formatProjectStatus(value);
  if (name === "head_project_initialize_or_resume") return formatProjectBootstrap(value);
  if (name === "head_session_restore") return formatSessionRestore(value);
  if (["head_conversation_enter", "head_compaction_lifecycle_step"].includes(name)) return formatConversationRecovery(value);
  if (name === "head_onboarding_guide") return formatOnboardingGuide(value);
  if (name === "head_feature_mapping_status") return formatFeatureMappingStatus(value);
  if (name === "head_pending_review") return formatPendingReview(value);
  if (name === "head_conformance_queue") return formatConformanceQueue(value);
  if (name === "head_conformance_read") return formatConformanceFinding(value);
  if (["head_onboarding_review", "head_feature_mapping_review", "head_conformance_disposition", "head_product_initiative_review"].includes(name)) return formatReviewOutcome(value);
  if (name === "head_context_prepare") return formatContextPreparation(value);
  if (name === "head_context_preview") return formatContextPreview(value);
  return JSON.stringify(value);
}

export function formatCliError(error) {
  return [
    "HEAD could not complete that step.",
    `Reason: ${compactText(error?.message || "Unknown error", 500)}`,
    `Code: ${error?.code || "HEAD_CLI_ERROR"}`,
    "No failed operation should be interpreted as a state change or approval.",
    "Technical details: rerun with --json",
    "",
  ].join("\n");
}

export function formatCliResult(command, value) {
  if (["help", "--help", "-h", "help-all"].includes(command)) return formatHelp(value);
  if (command === "status" || command === "doctor") return formatProjectStatus(value, { doctor: command === "doctor" });
  if (command === "init" || command === "resume") return formatProjectBootstrap(value);
  if (command === "session-restore") return formatSessionRestore(value);
  if (["conversation-enter", "compaction-lifecycle-step"].includes(command)) return formatConversationRecovery(value);
  if (command === "feature-mapping-status") return formatFeatureMappingStatus(value);
  if (command === "run-review-context") return formatPendingReview(value);
  if (command === "conformance-queue") return formatConformanceQueue(value);
  if (command === "conformance-read") return formatConformanceFinding(value);
  if (["onboarding-review", "feature-mapping-review", "run-review", "conformance-disposition", "product-initiative-review"].includes(command)) return formatReviewOutcome(value);
  if (command === "context-prepare") return formatContextPreparation(value);
  if (command === "context-preview") return formatContextPreview(value);
  return `${JSON.stringify(value, null, 2)}\n`;
}
