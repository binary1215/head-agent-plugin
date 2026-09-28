// TEST ONLY. No provider, network, listening socket, or OS sandbox is used.
import fs from "node:fs";
import path from "node:path";
console.error(JSON.stringify({ event: "owned-selected-codex-fixture", pid: process.pid, parentPid: process.ppid,
  command: process.execPath, args: process.argv.slice(1), cwd: process.cwd(), ports: [], actualProviderInvoked: false }));
let bytes = Buffer.alloc(0);
process.stdin.on("data", chunk => { bytes = Buffer.concat([bytes, chunk]); });
process.stdin.on("end", () => {
  const mode = process.argv[2];
  const write = value => process.stdout.write(JSON.stringify(value) + "\n");
  write({ type: "thread.started", thread_id: "selected-synthetic-provider" });
  write({ type: "turn.started" });
  if (mode === "wait") { setInterval(() => {}, 1000); return; }
  if (mode === "write") fs.writeFileSync(path.join(process.cwd(), "selected.txt"), "synthetic selected edit\n");
  const result = { schemaVersion: 1, kind: "RuntimeStructuredResult", protocolVersion: "0.1.0",
    outcome: mode === "expose-root" ? process.cwd() : "Synthetic selected provider result",
    evidence: ["Synthetic transport only"], planDelta: "", impactRadius: [], verification: ["Fixture protocol result"],
    unknowns: ["Actual Codex and effective sandbox were not exercised"] };
  write({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(result) } });
  write({ type: "turn.completed" });
});
