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

export function formatCliResult(command, value) {
  if (["help", "--help", "-h", "help-all"].includes(command)) return formatHelp(value);
  if (command === "status" || command === "doctor") return formatProjectStatus(value, { doctor: command === "doctor" });
  return `${JSON.stringify(value, null, 2)}\n`;
}
