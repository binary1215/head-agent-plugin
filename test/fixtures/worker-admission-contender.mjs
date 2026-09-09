import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  enqueueWorkerAdmission,
  openWorkerAdmissionHost,
} from "../../scripts/lib/worker-admission.mjs";
import { readBoundedWorkerDispatch } from "../../scripts/lib/bounded-worker-dispatch.mjs";
import { readRuntimeInvocationAuthorization } from "../../scripts/lib/runtime-invocation-lifecycle.mjs";
import { withRuntimeExecutionLease } from "../../scripts/lib/runtime-execution-lease.mjs";

const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const config = JSON.parse(fs.readFileSync(path.resolve(process.argv[2]), "utf8"));
process.stdout.write(`${JSON.stringify({ event: "owned-worker-admission-contender", pid: process.pid, parentPid: process.ppid, command: process.execPath, cwd: process.cwd(), ports: [] })}\n`);

const host = openWorkerAdmissionHost({
  operationalStateRoot: config.admissionOperationalRoot,
  hostExpectationRoot: config.hostExpectationRoot,
  admissionDomainId: config.admissionDomainId,
  expectedDomainInstanceId: config.domainInstanceId,
  expectedMetadataHash: config.metadataHash,
  preStartValidate: async () => ({ status: "current" }),
});
const { authorization } = readRuntimeInvocationAuthorization({ root: config.root, authorizationId: config.authorizationId });
const { dispatch } = readBoundedWorkerDispatch({ root: config.root, authorizationId: config.authorizationId });
const reservation = await enqueueWorkerAdmission({
  host,
  root: config.root,
  authorizationId: authorization.authorizationId,
  dispatchId: dispatch.dispatchId,
  mode: "detached",
});
fs.writeFileSync(config.reservedMarker, `${reservation.requestId}\n`, { flag: "wx" });
await withRuntimeExecutionLease({
  projectRoot: config.root,
  authorization,
  ownerFenceDigest: hash(`worker-admission-contender/${process.pid}/${authorization.authorizationId}`),
}, async () => {
  fs.writeFileSync(config.startedMarker, `${process.pid}\n`, { flag: "wx" });
  while (!fs.existsSync(config.releaseMarker)) await new Promise((resolve) => setTimeout(resolve, 10));
  return {};
}, { preConsumeGate: reservation.preConsumeGate });
await reservation.finalize({ outcomeCode: "completed" });
process.stdout.write(`${JSON.stringify({ event: "owned-worker-admission-contender-complete", pid: process.pid, parentPid: process.ppid, ports: [] })}\n`);
