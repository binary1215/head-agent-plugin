import { verifyRuntimeInvocationAuthorization } from "./runtime-invocation-lifecycle.mjs";
import { executeClaudeRuntimeInvocation } from "./runtime-claude-print.mjs";
import { executeCodexRuntimeInvocation } from "./runtime-codex-exec.mjs";
import { executeOpenCodeRuntimeInvocation } from "./runtime-opencode-run.mjs";

export function executeRuntimeInvocation(options = {}) {
  const authorization = verifyRuntimeInvocationAuthorization(options.authorization);
  if (authorization.runtime === "claude") return executeClaudeRuntimeInvocation({ ...options, authorization });
  if (authorization.runtime === "codex") return executeCodexRuntimeInvocation({ ...options, authorization });
  if (authorization.runtime === "opencode") return executeOpenCodeRuntimeInvocation({ ...options, authorization });
  const error = new Error(`Unsupported runtime invocation adapter: ${authorization.runtime}.`);
  error.code = "RUNTIME_INVOCATION_ADAPTER_UNAVAILABLE";
  throw error;
}
