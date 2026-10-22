// Optional MCP policy. Default off preserves the previous design, where a
// subagent may record canon, checkpoints, and lineage. Enforcement rejects
// those state writes so a child caller cannot bypass the parent review gate.
export const SUBAGENT_WRITE_GUARD_ENV = "LODE_SUBAGENT_WRITE_GUARD";
export const SUBAGENT_STATE_WRITE_REJECTED = "SUBAGENT_STATE_WRITE_REJECTED";

export function subagentWriteGuardEnabled(environment = process.env) {
  return environment?.[SUBAGENT_WRITE_GUARD_ENV] === "enforce";
}

export function assessSubagentStateWrite({ caller = null, readOnly = true } = {}) {
  if (readOnly || caller?.subagent !== true) return { allowed: true };
  return {
    allowed: false,
    code: SUBAGENT_STATE_WRITE_REJECTED,
    message: SUBAGENT_STATE_WRITE_REJECTED + ": a subagent caller cannot mutate Lode state (canon, checkpoints, lineage, reviews, or other non-read-only tools). Read tools still work. The parent session records protected state. LODE_SUBAGENT_WRITE_GUARD=enforce is optional and defaults off.",
  };
}
