// Operational ownership for the native host verifier, not a Core/runtime authority.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

function exists(target) {
  try { process.kill(target, 0); return true; }
  catch (error) { if (error.code === "ESRCH") return false; throw error; }
}

// POSIX callers must spawn this child with detached:true. Capture its group ID
// immediately, while it is owned; a group outlives its original root process.
export function createNativeSmokeCleanup(child, { cwd, graceMs = 1_000, killWaitMs = 5_000 } = {}) {
  const pid = child.pid;
  const target = process.platform === "win32" ? pid : -pid;
  let stopping;
  let gone = !pid;
  const isAlive = () => {
    if (gone) return false;
    // Unlike a retained POSIX group, a Windows root PID no longer identifies
    // our child after its exit event and may already have been reused.
    if ((process.platform === "win32" && (child.exitCode !== null || child.signalCode !== null)) || !exists(target)) gone = true;
    return !gone;
  };
  const waitUntilGone = async (timeoutMs) => {
    const end = Date.now() + timeoutMs;
    while (isAlive() && Date.now() < end) await delay(Math.min(25, Math.max(1, end - Date.now())));
    return !isAlive();
  };
  const signal = async (force) => {
    if (process.platform !== "win32") {
      try { process.kill(target, force ? "SIGKILL" : "SIGTERM"); }
      catch (error) { if (error.code !== "ESRCH") throw error; }
      return;
    }
    // Windows has no POSIX process group. Keep the existing exact /PID /T
    // tree request before killing the parent; native execution additionally
    // uses the existing supervisor Job Object. Never use process-name kills.
    const args = ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])];
    process.stderr.write(`CHILD_PREPARE parent=${process.pid} command=taskkill.exe ${args.join(" ")} cwd=${cwd} ports=none\n`);
    const cleanup = spawn("taskkill.exe", args, { cwd, shell: false, windowsHide: true, stdio: "ignore" });
    process.stderr.write(`CHILD_START pid=${cleanup.pid ?? "spawn-failed"} parent=${process.pid} command=taskkill.exe ${args.join(" ")} cwd=${cwd} ports=none\n`);
    await new Promise((resolve, reject) => { cleanup.once("error", reject); cleanup.once("close", resolve); });
    process.stderr.write(`CHILD_END pid=${cleanup.pid} command=taskkill.exe\n`);
  };
  // Return the exact same promise for timeout, output-limit, interrupt and
  // finally cleanup. A root 'exit' event never proves its POSIX group is gone.
  const stop = () => stopping ||= (async () => {
    if (!isAlive()) return;
    await signal(false);
    if (await waitUntilGone(graceMs)) return;
    await signal(true);
    assert.equal(await waitUntilGone(killWaitMs), true, `Owned ${process.platform === "win32" ? "process" : "process group"} remains: ${pid}`);
  })();
  return { pid, target, isAlive, stop };
}
