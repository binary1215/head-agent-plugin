import { withSessionRoute } from "../../scripts/lib/session-routing.mjs";
import { recordSessionWorkEvidence } from "../../scripts/lib/session-work-context.mjs";
const [root, sessionId, summary] = process.argv.slice(2);
const result = withSessionRoute(root, sessionId, () => recordSessionWorkEvidence({ root, input: { summary } }));
process.stdout.write(JSON.stringify({ status: result.status, evidenceId: result.evidence.evidenceId, writes: result.writes }) + "\n");
