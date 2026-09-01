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
  const lines = [
    core?.state === "ready"
      ? "HEAD is ready — describe the task in your coding conversation."
      : "HEAD needs one setup step before it can coordinate this project.",
    "",
    `HEAD Core: ${core?.state || value.status}`,
    `Product governance: ${PRODUCT_LABELS[product?.state] || product?.state || "unknown"}`,
    `Context: ${CONTEXT_LABELS[context?.state] || context?.state || "unknown"}`,
    `Active package: ${value.runtime?.activePackageVersion || "unknown"}`,
  ];
  if (doctor || (value.drift?.length || 0) > 0) {
    lines.push(`Managed projection drift: ${value.drift?.length || 0}`);
    for (const item of value.drift || []) lines.push(`  - ${item.path || item.kind || "managed artifact"}`);
  }
  if (value.nextAction) {
    lines.push("", `Next: ${value.nextAction.summary}`);
    if (value.nextAction.entrypoint?.cli) lines.push(`Command: ${value.nextAction.entrypoint.cli}`);
    if (value.nextAction.entrypoint?.mcpTool) lines.push(`MCP: ${value.nextAction.entrypoint.mcpTool}`);
  }
  lines.push("", "This is read-only guidance; it grants no authority and changes no project state.");
  return `${lines.join("\n")}\n`;
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
  if (command === "context-prepare") return formatContextPreparation(value);
  if (command === "context-preview") return formatContextPreview(value);
  return `${JSON.stringify(value, null, 2)}\n`;
}
