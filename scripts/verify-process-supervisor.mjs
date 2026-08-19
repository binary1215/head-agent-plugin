#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveVerifiedProcessSupervisor,
  spawnSupervisedProcess,
} from "./lib/runtime-process-supervisor.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function processExists(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === "EPERM"; }
}

async function waitForExit(pid, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (processExists(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return !processExists(pid);
}

const PROVIDER_FIXTURE = String.raw`
const { spawn } = require('node:child_process');
const mode = process.argv[1];
const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
  shell: false,
  windowsHide: true,
  stdio: 'ignore',
});
process.stdout.write(JSON.stringify({ descendantPid: descendant.pid }) + '\n');
if (mode === 'normal') setTimeout(() => process.exit(0), 50);
else setInterval(() => {}, 1000);
`;

async function runScenario(selection, mode) {
  let descendantPid = null;
  let providerPid = null;
  let output = "";
  let stderrOutput = "";
  let supervised;
  const controlFile = path.join(path.dirname(selection.manifestPath), `.supervisor-control-${process.pid}-${mode}-${crypto.randomUUID()}.jsonl`);
  try {
    supervised = spawnSupervisedProcess({
      selection,
      executablePath: process.execPath,
      args: ["-e", PROVIDER_FIXTURE, mode],
      cwd: repositoryRoot,
      providerEnvironment: {
        SystemRoot: process.env.SystemRoot || process.env.SYSTEMROOT || "",
        PATH: process.env.PATH || "",
      },
      input: Buffer.alloc(0),
      controlFile,
      terminationGraceMs: 500,
      onControlEvent: (event) => {
        if (event.type === "provider.started") {
          providerPid = event.providerPid;
          process.stderr.write(`NESTED_CHILD_START pid=${providerPid} parent=${supervised?.child.pid || process.pid} command=node-provider-fixture cwd=${repositoryRoot} ports=none\n`);
        }
        if (event.type === "provider.exited") {
          process.stderr.write(`NESTED_CHILD_END pid=${event.providerPid} parent=${supervised?.child.pid || process.pid} exit=${event.exitCode} signal=none\n`);
        }
      },
    });
    process.stderr.write(`NESTED_CHILD_START pid=${supervised.child.pid} parent=${process.pid} command=head-agent-process-supervisor cwd=${path.dirname(selection.binaryPath)} ports=none\n`);
    supervised.child.stdout.on("data", (chunk) => {
      output += chunk.toString("utf8");
      for (const line of output.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const record = JSON.parse(line);
          if (Number.isSafeInteger(record.descendantPid)) descendantPid = record.descendantPid;
        } catch {}
      }
    });
    supervised.child.stderr.on("data", (chunk) => { stderrOutput += chunk.toString("utf8"); });
    if (mode === "cancel") {
      const deadline = Date.now() + 2_000;
      while ((!descendantPid || !providerPid) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert(descendantPid && providerPid, "Cancellation fixture did not expose its owned process tree.");
      process.stderr.write(`NESTED_CHILD_START pid=${descendantPid} parent=${providerPid} command=node-descendant-fixture cwd=${repositoryRoot} ports=none\n`);
      supervised.terminate(false);
    }
    const closed = await new Promise((resolve, reject) => {
      supervised.child.once("error", reject);
      supervised.child.once("close", (code, signal) => resolve({ code, signal }));
    });
    process.stderr.write(`NESTED_CHILD_END pid=${supervised.child.pid} parent=${process.pid} exit=${closed.code ?? "null"} signal=${closed.signal || "none"}\n`);
    if (mode === "normal") {
      const parsed = output.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
      descendantPid = parsed.find((item) => Number.isSafeInteger(item.descendantPid))?.descendantPid || null;
      assert(descendantPid && providerPid, `Normal fixture did not expose its owned process tree: ${stderrOutput.trim() || "no supervisor stderr"}`);
      process.stderr.write(`NESTED_CHILD_START pid=${descendantPid} parent=${providerPid} command=node-descendant-fixture cwd=${repositoryRoot} ports=none\n`);
    }
    const boundary = supervised.finalize({ exactSupervisorExitObserved: true, terminationRequested: mode === "cancel" });
    assert(boundary.ownershipEstablished && boundary.treeCleanupVerified, `${mode} process-tree cleanup was not verified.`);
    assert(await waitForExit(providerPid), `${mode} provider process remained alive.`);
    assert(await waitForExit(descendantPid), `${mode} descendant process remained alive.`);
    process.stderr.write(`NESTED_CHILD_END pid=${descendantPid} parent=${providerPid} exit=null signal=supervised-tree-cleanup\n`);
    return {
      mode,
      supervisionStrategy: boundary.supervisionStrategy,
      ownershipEstablished: boundary.ownershipEstablished,
      treeCleanupVerified: boundary.treeCleanupVerified,
      providerExitObserved: boundary.providerChildExitObserved,
    };
  } finally {
    if (supervised?.child && supervised.child.exitCode === null && supervised.child.signalCode === null) {
      supervised.terminate(true);
      await waitForExit(supervised.child.pid);
    }
    if (descendantPid && processExists(descendantPid)) {
      try { process.kill(descendantPid, "SIGKILL"); } catch {}
      await waitForExit(descendantPid);
    }
    if (fs.existsSync(controlFile)) fs.unlinkSync(controlFile);
  }
}

async function main() {
  const pluginRoot = path.resolve(option("--plugin-root", process.env.HEAD_AGENT_PROCESS_SUPERVISOR_FIXTURE_ROOT || repositoryRoot));
  const selection = resolveVerifiedProcessSupervisor({ pluginRoot });
  const normal = await runScenario(selection, "normal");
  const cancelled = await runScenario(selection, "cancel");
  process.stdout.write(`${JSON.stringify({
    status: "process_supervisor_verified",
    manifestId: selection.manifest.manifestId,
    scenarios: [normal, cancelled],
    rawPidPersisted: false,
    shellInterpretation: false,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ status: "failed", code: error.code || "PROCESS_SUPERVISOR_VERIFY_ERROR", error: error.message })}\n`);
  process.exitCode = 1;
});
