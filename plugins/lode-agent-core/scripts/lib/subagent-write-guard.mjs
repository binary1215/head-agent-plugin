// Optional MCP policy. Default off preserves the previous design, where a
// subagent may record canon, checkpoints, and lineage. Enforcement rejects
// those state writes so a child caller cannot bypass the parent review gate.
export const SUBAGENT_WRITE_GUARD_ENV = "LODE_SUBAGENT_WRITE_GUARD";
export const SUBAGENT_STATE_WRITE_REJECTED = "SUBAGENT_STATE_WRITE_REJECTED";
export const SUBAGENT_WRITE_GUARD_INVALID = "SUBAGENT_WRITE_GUARD_INVALID";

export function diagnoseSubagentWriteGuard(environment = process.env) {
  const value = environment?.[SUBAGENT_WRITE_GUARD_ENV];
  const enabled = value === "enforce";
  const valid = value === undefined || value === null || value === "" || value === "off" || enabled;
  return { enabled, valid, ...(valid ? {} : { code: SUBAGENT_WRITE_GUARD_INVALID,
    message: `${SUBAGENT_WRITE_GUARD_INVALID}: ${SUBAGENT_WRITE_GUARD_ENV} must be exactly "enforce" or "off" (unset defaults off). Invalid configuration was ignored; subagent write protection is OFF. Ordinary work is not blocked.` }) };
}

// Remember at most the last invalid value, not an unbounded set of environment
// contents. Do not print the value: configuration can contain accidental secrets.
let lastInvalidValue;
export function subagentWriteGuardEnabled(environment = process.env, { warn = message => process.stderr.write(message + "\n") } = {}) {
  const diagnostic = diagnoseSubagentWriteGuard(environment);
  if (!diagnostic.valid) {
    const value = environment?.[SUBAGENT_WRITE_GUARD_ENV];
    if (value !== lastInvalidValue) {
      lastInvalidValue = value;
      try { warn(diagnostic.message); } catch { /* Diagnostics never gate work. */ }
    }
  } else lastInvalidValue = undefined;
  return diagnostic.enabled;
}

export function assessSubagentStateWrite({ caller = null, readOnly = true } = {}) {
  if (readOnly || caller?.subagent !== true) return { allowed: true };
  return {
    allowed: false,
    code: SUBAGENT_STATE_WRITE_REJECTED,
    message: SUBAGENT_STATE_WRITE_REJECTED + ": a subagent caller cannot mutate Lode state (canon, checkpoints, lineage, reviews, or other non-read-only tools). Read tools still work. The parent session records protected state. LODE_SUBAGENT_WRITE_GUARD=enforce is optional and defaults off.",
  };
}
