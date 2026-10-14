import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { finishCodexAppServerFixture } from "./helpers/codex-app-server-fixture-cleanup.mjs";

function directory(t) {
  const dir = fs.mkdtempSync(path.join(process.env.HEAD_AGENT_TEST_TMP || os.tmpdir(), "head-fixture-cleanup-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const journal = [{ event: "process-closed", supervision: { treeCleanupVerified: true } }];

for (const code of ["CODEX_RPC_UNCLEAN_EXIT", "CODEX_RPC_CLEANUP_UNCERTAIN", "OTHER_CLOSE_FAILURE"]) {
  test(`strict fixture close preserves ${code} even with confirmed cleanup`, async t => {
    const dir = directory(t);
    const original = Object.assign(new Error(code), { code });
    const transport = { close: async () => { throw original; }, inspect: () => ({ closed: true, started: true }) };
    await assert.rejects(finishCodexAppServerFixture({ transport, owner: {}, journal, dir }), cause => cause === original);
    assert.equal(fs.existsSync(dir), false, "original failure cannot skip finally cleanup");
  });
}

test("close and verification failures both survive protective cleanup", async t => {
  const priorError = new Error("body assertion failed"), closeError = new Error("close failed"), verificationError = new Error("verification failed");
  const dir = directory(t);
  const transport = { close: async () => { throw closeError; }, inspect: () => ({ closed: true }) };
  await assert.rejects(finishCodexAppServerFixture({ transport, journal, dir, priorError, verify: () => { throw verificationError; } }),
    cause => cause instanceof AggregateError && cause.errors[0] === priorError && cause.errors[1] === closeError && cause.errors[2] === verificationError);
  assert.equal(fs.existsSync(dir), false);
});

test("known exact provider PID is checked when process-closed journal is missing", async t => {
  const dir = directory(t);
  const transport = { close: async () => {}, inspect: () => ({ closed: true }) };
  // This test runner is deliberately live. inspect.closed prevents any stop,
  // and the helper may only observe this PID, never signal it for termination.
  await assert.rejects(finishCodexAppServerFixture({ transport, owner: { state: { providerPid: process.pid } },
    journal: [], dir, verify: () => {} }), /owned fixture PID .* must be absent/);
  assert.equal(fs.existsSync(dir), true, "retain control evidence while a known PID remains");
});

test("protective stop failure cannot replace the original close error", async t => {
  const original = new Error("original close error"), stopError = new Error("protective stop error");
  const dir = directory(t);
  const transport = { close: async () => { throw original; }, inspect: () => ({ closed: false }) };
  const owner = { child: { exitCode: null, signalCode: null }, terminate: () => { throw stopError; } };
  await assert.rejects(finishCodexAppServerFixture({ transport, owner, journal: [], dir, verify: () => {} }),
    cause => cause instanceof AggregateError && cause.errors.includes(original) && cause.errors.includes(stopError));
});
