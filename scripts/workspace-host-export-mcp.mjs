import { fileURLToPath } from "node:url";
import { serveMcp } from "./mcp-server.mjs";
import { VerifiedWorkspaceHostAdapter } from "./lib/workspace-host-coordination.mjs";
import { createWorkspaceHostExportDriver } from "./lib/workspace-host-export-driver.mjs";

const REQUIRED = [
  "HEAD_AGENT_HOST_PROJECT_ROOT",
  "HEAD_AGENT_WORKSPACE_HOST_EXPORT_ROOT",
  "HEAD_AGENT_HOST_WORKSPACE_ID",
  "HEAD_AGENT_HOST_TAB_ID",
  "HEAD_AGENT_HOST_ENDPOINT_ID",
  "HEAD_AGENT_HOST_PROCESS_PROOF",
  "HEAD_AGENT_COORDINATION_BINDING_TOKEN",
];

const requiredEnvironment = (environment, name) => {
  const value = String(environment[name] || "").trim();
  if (!value) {
    const error = new Error(`Required host-export environment reference ${name} is missing.`);
    error.code = "WORKSPACE_HOST_EXPORT_ENVIRONMENT_REQUIRED";
    throw error;
  }
  return value;
};

export function workspaceHostExportComposition({ environment = process.env } = {}) {
  const values = Object.fromEntries(REQUIRED.map((name) => [name, requiredEnvironment(environment, name)]));
  const projectRoot = values.HEAD_AGENT_HOST_PROJECT_ROOT;
  const bindingSeparator = values.HEAD_AGENT_COORDINATION_BINDING_TOKEN.indexOf(".");
  if (bindingSeparator <= 0) {
    const error = new Error("The host-injected coordination binding token is invalid.");
    error.code = "WORKSPACE_HOST_EXPORT_BINDING_REQUIRED";
    throw error;
  }
  const bindingId = values.HEAD_AGENT_COORDINATION_BINDING_TOKEN.slice(0, bindingSeparator);
  const caller = Object.freeze({
    workspaceId: values.HEAD_AGENT_HOST_WORKSPACE_ID,
    tabId: values.HEAD_AGENT_HOST_TAB_ID,
    endpointId: values.HEAD_AGENT_HOST_ENDPOINT_ID,
  });
  return Object.freeze({
    adapter: new VerifiedWorkspaceHostAdapter({
      driver: createWorkspaceHostExportDriver({
        exportRoot: values.HEAD_AGENT_WORKSPACE_HOST_EXPORT_ROOT,
        projectRoot,
        caller,
        bindingId,
        processProof: values.HEAD_AGENT_HOST_PROCESS_PROOF,
      }),
    }),
    caller,
    projectRoot,
    source: "trusted-host-export-environment",
    providerSessionIdentityPersisted: false,
  });
}

export function serveWorkspaceHostExportMcp({ environment = process.env } = {}) {
  return serveMcp({ coordinationWorkspaceHost: workspaceHostExportComposition({ environment }) });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) serveWorkspaceHostExportMcp();
