import fs from "node:fs";
import { dispatch } from "../../scripts/mcp-server.mjs";
import { VerifiedWorkspaceHostAdapter, WORKSPACE_HOST_COORDINATION_VERSION } from "../../scripts/lib/workspace-host-coordination.mjs";

const [requestFile, snapshotFile, deliveryFile] = process.argv.slice(2);
if (![requestFile, snapshotFile, deliveryFile].every(Boolean)) throw new Error("request, snapshot, and delivery files are required");

const descriptor = Object.freeze({
  schemaVersion: 1,
  kind: "WorkspaceHostDriverDescriptor",
  protocol: { name: "head-agent-core-workspace-host-driver", version: WORKSPACE_HOST_COORDINATION_VERSION },
  hostKind: "fixture-host",
  transport: "fixture-file",
  providerNeutral: true,
  tuiScraping: false,
  providerSessionIdentityPersisted: false,
});

const driver = {
  describe() { return descriptor; },
  snapshot() { return JSON.parse(fs.readFileSync(snapshotFile, "utf8")); },
  send({ endpoint, messageId, text }) {
    fs.appendFileSync(deliveryFile, `${JSON.stringify({ endpoint, messageId, text })}\n`);
    const snapshot = this.snapshot();
    return {
      status: "delivered",
      messageId,
      hostInstanceId: snapshot.hostInstanceId,
      workspaceId: endpoint.workspaceId,
      tabId: endpoint.tabId,
      endpointId: endpoint.endpointId,
      terminalId: endpoint.terminalId,
    };
  },
};

const request = JSON.parse(fs.readFileSync(requestFile, "utf8"));
const coordinationWorkspaceHost = {
  adapter: new VerifiedWorkspaceHostAdapter({ driver }),
  caller: {
    workspaceId: process.env.HEAD_AGENT_HOST_WORKSPACE_ID,
    tabId: process.env.HEAD_AGENT_HOST_TAB_ID,
    endpointId: process.env.HEAD_AGENT_HOST_ENDPOINT_ID,
  },
};
const response = await dispatch(request, { coordinationWorkspaceHost });
process.stdout.write(`${JSON.stringify(response)}\n`);
