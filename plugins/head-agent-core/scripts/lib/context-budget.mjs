// Shared schema constants; importing an MCP catalog must not load the Compiler.
export const CONTEXT_BUDGET_PROTOCOL_VERSION = "1.0.0";
export const CONTEXT_BUDGET_TIERS = Object.freeze([32_768, 65_536, 131_072, 262_144, 524_288]);
export const DEFAULT_CONTEXT_BUDGET = CONTEXT_BUDGET_TIERS[0];
