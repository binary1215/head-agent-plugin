// Real Node protocol process, not a Codex executable or a model invocation.
import fs from "node:fs";
import path from "node:path";
const [directory, key, authorizationId, model] = process.argv.slice(2);
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => { input += chunk; });
process.stdin.on("end", async () => {
  const started = { key, authorizationId, model, pid: process.pid, parentPid: process.ppid,
    command: process.execPath, args: process.argv.slice(1), cwd: process.cwd(), ports: [],
    startedUnixMs: Date.now(), actualProviderInvoked: false, inputBytes: Buffer.byteLength(input) };
  fs.writeFileSync(path.join(directory, `${key}.started.json`), JSON.stringify(started), { flag: "wx" });
  const deadline = Date.now() + 15000;
  while (!fs.existsSync(path.join(directory, "release"))) {
    if (Date.now() >= deadline) throw new Error("Connected fixture barrier timed out");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const write = value => process.stdout.write(`${JSON.stringify(value)}\n`);
  write({ type: "thread.started", thread_id: `synthetic-${key}` });
  write({ type: "turn.started" });
  const result = { schemaVersion: 1, kind: "RuntimeStructuredResult", protocolVersion: "0.1.0",
    outcome: `Synthetic protocol result for ${key}`, evidence: ["Actual Node process, no model invocation"],
    planDelta: "", impactRadius: [], verification: ["Exact bounded input received"], unknowns: ["Real model behavior not assessed"] };
  write({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(result) } });
  write({ type: "turn.completed" });
  fs.writeFileSync(path.join(directory, `${key}.finished.json`), JSON.stringify({ ...started, finishedUnixMs: Date.now() }), { flag: "wx" });
});
