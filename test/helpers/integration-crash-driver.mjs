// Test-only process fault driver: the public CLI composition is unchanged.
// No production fault option, Host injection, provider, or account call.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [installed, root, inputFile, boundary, readyFile] = process.argv.slice(2);
if (!["started", "post-effect", "result-publication"].includes(boundary)) throw Error("Unknown test boundary");
const prefix = path.join(fs.realpathSync(root), ".head/runtime/worker-integrations") + path.sep;
const original = fs.linkSync;
let reached = false;
function stopAtBoundary(target) {
  reached = true;
  const fd = fs.openSync(readyFile, "wx", 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify({ boundary, pid: process.pid, parentPid: process.ppid,
      command: process.execPath, args: process.argv.slice(1), cwd: process.cwd(), ports: [], target }));
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  // Parent terminates this exact child after observing the durable marker.
  // An actual process dies here: no catch/finally rollback or lock release runs.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  throw Error("Crash driver unexpectedly resumed");
}
fs.linkSync = function(source, target, ...args) {
  if (!reached && String(target).startsWith(prefix)) {
    if (boundary === "started" && /\.effect-0(?:\.[^.]+)*\.started\.json$/.test(String(target))) {
      original.call(this, source, target, ...args); stopAtBoundary(target);
    }
    if (boundary === "post-effect" && /\.effect-0(?:\.[^.]+)*\.receipt\.json$/.test(String(target))) stopAtBoundary(target);
    if (boundary === "result-publication" && String(target).endsWith("--result-application.json")) stopAtBoundary(target);
  }
  return original.call(this, source, target, ...args);
};
const { runCommand } = await import(pathToFileURL(path.join(installed, "scripts/head.mjs")).href);
try {
  const result = await runCommand(["managed-maintenance", "worker-integrate", root, "--input", inputFile], {
    onProcess: event => process.stderr.write(JSON.stringify({ integrationDriverProcess: event }) + "\n"),
  });
  process.stdout.write(JSON.stringify(result) + "\n");
  if (!reached) throw Error("Requested fault boundary was not reached");
} finally { fs.linkSync = original; }
