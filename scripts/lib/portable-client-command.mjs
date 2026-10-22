import path from "node:path";

// Client launch lines that may be committed or copied between machines.
// Each placeholder is expanded by that client, not by Core. An absolute Node
// binary or install path is never part of this projection.
export const PORTABLE_MCP_CLIENTS = Object.freeze(["claude", "codex", "opencode"]);
export const LODE_PLUGIN_ROOT_ENV = "LODE_PLUGIN_ROOT";
const SCRIPT = "scripts/mcp-server.mjs";
const PLACEHOLDER = Object.freeze({
  claude: `\${CLAUDE_PLUGIN_ROOT}/${SCRIPT}`,
  codex: `\${PLUGIN_ROOT}/${SCRIPT}`,
  opencode: `{env:${LODE_PLUGIN_ROOT_ENV}}/${SCRIPT}`,
});
const ROOT_PLACEHOLDER = Object.freeze({
  claude: "${CLAUDE_PLUGIN_ROOT}",
  codex: "${PLUGIN_ROOT}",
});

function projectRelativeScript(pluginRoot, projectRoot) {
  if (typeof pluginRoot !== "string" || typeof projectRoot !== "string" || !pluginRoot || !projectRoot) return null;
  const relative = path.relative(projectRoot, path.join(pluginRoot, "scripts", "mcp-server.mjs"));
  if (!relative || path.isAbsolute(relative)) return null;
  const parts = relative.split(/[\\/]/);
  if (parts.some(part => !part || part === "..")) return null;
  return parts.join("/");
}

// `pathForm` is projection metadata for tests and docs. Callers persist only
// the client fields.
export function portableMcpLaunch({ client, pluginRoot, projectRoot } = {}) {
  if (!PORTABLE_MCP_CLIENTS.includes(client)) {
    throw Object.assign(new Error("Unsupported MCP client."), { code: "UNSUPPORTED_MCP_CLIENT" });
  }
  const relative = projectRelativeScript(pluginRoot, projectRoot);
  const script = relative || PLACEHOLDER[client];
  const pathForm = relative ? "project-relative" : "host-placeholder";
  if (client === "opencode") {
    return { type: "local", command: ["node", script], enabled: true, pathForm };
  }
  return {
    command: "node",
    args: [script],
    cwd: relative ? "." : ROOT_PLACEHOLDER[client],
    ...(client === "claude" ? { env: {} } : {}),
    pathForm,
  };
}

export function portableMcpDocument(options) {
  const { pathForm, ...document } = portableMcpLaunch(options);
  return { document, pathForm };
}
