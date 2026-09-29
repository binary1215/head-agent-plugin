const mode = process.env.HEAD_TEST_BRIDGE_FAULT;
process.stderr.write(`${JSON.stringify({ event: "started", pid: process.pid, parentPid: process.ppid, command: process.execPath + " bridge fault " + mode, cwd: process.cwd(), ports: [] })}\n`);
globalThis.fetch = async () => {
  const reset = () => Object.assign(new Error("Synthetic reset; no network"), { code: "ECONNRESET" });
  if (mode === "headers") throw reset();
  if (mode === "empty") return { ok: true, status: 200, body: (async function* () {})() };
  if (mode === "malformed") return { ok: true, status: 200, body: (async function* () { yield Buffer.from("not-json"); })() };
  return { ok: mode !== "auth", status: mode === "auth" ? 401 : 200, body: (async function* () {
    yield Buffer.from('{"result":[');
    if (mode === "timeout") throw Object.assign(new Error("Timeout"), { name: "TimeoutError" });
    throw reset();
  })() };
};
