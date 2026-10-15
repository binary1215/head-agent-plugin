import { spawn } from "node:child_process";
import os from "node:os";

// Only inert local Node fixture/Hook commands; no shell, daemon or provider.
// Record ownership before/after launch and wait for close on every path.
export async function localContinuityCommand(args, { cwd, environment = process.env, input = "" }) {
  console.log(JSON.stringify({ event: "planned", parentPid: process.pid, command: process.execPath, args, cwd, ports: [], windowsHide: true }));
  const child = spawn(process.execPath, args, { cwd, env: environment, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  console.log(JSON.stringify({ event: "started", pid: child.pid, parentPid: process.pid, command: process.execPath, args, cwd, ports: [], at: new Date().toISOString() }));
  if (child.pid) { try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch (error) {
    console.log(JSON.stringify({ event: "priority-unavailable", pid: child.pid, parentPid: process.pid, reasonCode: error.code }));
  } }
  let stdout = "", stderr = "", failure = null, force = null;
  const timeout = setTimeout(() => {
    failure = new Error("Owned continuity command exceeded its test bound.");
    child.kill("SIGTERM");
    force = setTimeout(() => child.kill("SIGKILL"), 1000);
  }, 15000);
  const closed = new Promise((resolve) => {
    child.on("error", (error) => { failure = error; });
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdin.on("error", (error) => { if (error.code !== "EPIPE") failure = error; });
  child.stdin.end(input);
  try {
    const outcome = await closed;
    console.log(JSON.stringify({ event: "closed", pid: child.pid, parentPid: process.pid, command: process.execPath, cwd, ports: [], ...outcome }));
    if (failure) throw failure;
    return { ...outcome, stdout, stderr };
  } finally {
    clearTimeout(timeout);
    if (force) clearTimeout(force);
    child.stdout.destroy(); child.stderr.destroy(); child.stdin.destroy();
    if (child.pid) {
      try { process.kill(child.pid, 0); throw new Error("Owned child still exists after close: " + child.pid); }
      catch (error) { if (error.code !== "ESRCH") throw error; }
    }
  }
}
