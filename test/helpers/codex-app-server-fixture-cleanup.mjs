import assert from "node:assert/strict";
import fs from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const absent = pid => {
  try { process.kill(pid, 0); return false; }
  catch (cause) { if (cause.code === "ESRCH") return true; throw cause; }
};

async function observeExit(transport, milliseconds) {
  const deadline = Date.now() + milliseconds;
  while (!transport.inspect().closed && Date.now() < deadline) await delay(10);
}

// Test-only protective teardown. A failed observation stays failed even when
// protective cleanup subsequently succeeds. Never rewrite the transport's
// already-recorded cleanup evidence or signal a PID recovered from a journal.
export async function finishCodexAppServerFixture({ transport, owner, journal, dir, verify, allowUncleanClose = false, priorError = null }) {
  const errors = priorError ? [priorError] : [];
  try {
    try { await transport.close(); }
    catch (cause) {
      if ((!allowUncleanClose || !["CODEX_RPC_UNCLEAN_EXIT", "CODEX_RPC_CLEANUP_UNCERTAIN"].includes(cause.code)) && !errors.includes(cause)) errors.push(cause);
    }
    if (verify) verify();
    else if (owner) {
      assert.equal(transport.inspect().closed, true);
      assert.equal(journal.find(event => event.event === "process-closed")?.supervision.treeCleanupVerified, true);
    } else assert.equal(transport.inspect().started, false);
  } catch (cause) { if (!errors.includes(cause)) errors.push(cause); }
  finally {
    // Only the exact live factory-owned child is eligible for an extra stop.
    // Read-only probes do not expose that capability: their own close remains
    // responsible for signaling, and we only observe its eventual exit here.
    try {
      if (!transport.inspect().closed) {
        if (owner?.child?.exitCode === null && owner.child.signalCode === null) owner.terminate(false);
        await observeExit(transport, 200);
        if (!transport.inspect().closed) {
          if (owner?.child?.exitCode === null && owner.child.signalCode === null) owner.terminate(true);
          await observeExit(transport, 1000);
        }
      }
    } catch (cause) { if (!errors.includes(cause)) errors.push(cause); }
    const closed = journal.find(event => event.event === "process-closed");
    const pids = [...new Set([owner?.child?.pid, owner?.pid, owner?.state?.providerPid, closed?.providerPid].filter(Boolean))];
    let allAbsent = true;
    for (const pid of pids) {
      try { assert.equal(absent(pid), true, `owned fixture PID ${pid} must be absent`); }
      catch (cause) { allAbsent = false; errors.push(cause); }
    }
    if (dir && allAbsent) {
      try { fs.rmSync(dir, { recursive: true, force: true }); }
      catch (cause) { errors.push(cause); }
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, "Fixture verification and/or protective cleanup failed");
}
