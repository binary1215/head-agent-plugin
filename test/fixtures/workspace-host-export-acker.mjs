import fs from "node:fs";
import {
  acknowledgeWorkspaceHostExportDelivery,
  claimWorkspaceHostExportDelivery,
  listWorkspaceHostExportDeliveryRequests,
} from "../../scripts/lib/workspace-host-export-driver.mjs";

const [exportRoot, projectRoot, endpointId, outputFile] = process.argv.slice(2);
if (![exportRoot, projectRoot, endpointId, outputFile].every(Boolean)) throw new Error("export root, project root, endpoint, and output file are required");

process.stdout.write("READY\n");

const deadline = Date.now() + 15_000;
while (Date.now() <= deadline) {
  const requests = listWorkspaceHostExportDeliveryRequests({ exportRoot, projectRoot, endpointId });
  if (requests.length) {
    const request = requests[0];
    const claimed = claimWorkspaceHostExportDelivery({ exportRoot, projectRoot, request });
    if (claimed.status !== "claimed") throw new Error(`Workspace host export delivery was not claimable: ${claimed.status}`);
    fs.writeFileSync(outputFile, `${JSON.stringify({ endpointId, messageId: request.messageId, text: request.text })}\n`, { flag: "wx" });
    acknowledgeWorkspaceHostExportDelivery({ exportRoot, projectRoot, request, claim: claimed.claim });
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 10));
}

throw new Error("No workspace host export delivery arrived before the fixture deadline.");
