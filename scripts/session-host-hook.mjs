#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createSessionHostAdapter } from "./lib/session-host-adapter.mjs";
import { startupProjection } from "./lib/session-host-context-projection.mjs";

// A read-only command Hook renderer. The outer command also records optional P5
// observations, but never creates selection bindings or changes this rendering.
export function sessionStartContext({ runtime, event, environment = process.env } = {}) {
  if (!["codex", "claude"].includes(runtime) || event?.hook_event_name !== "SessionStart"
    || !["startup", "resume", "clear", "compact", "fork"].includes(event.source)
    || typeof event.cwd !== "string" || typeof event.session_id !== "string") return {};
  if (![".head", ".lode"].some(directory => fs.existsSync(path.join(event.cwd, directory, "project.json")))) return {};
  // Codex's per-tool parent ID is ambiguous. Never use an unexpected agent hint
  // to select/write the parent; stock tool hooks are intentionally not wired.
  if (runtime === "codex" && event.agent_id) return {};
  let entry;
  try {
    const adapter = createSessionHostAdapter({ runtime, nativeSessionId: event.session_id,
      agentId: runtime === "claude" ? event.agent_id || null : null, environment });
    entry = adapter.enter({ root: event.cwd });
  } catch (error) {
    const code = typeof error?.code === "string" && /^[A-Z0-9_]{1,128}$/.test(error.code)
      ? error.code : "HOST_CONTEXT_UNAVAILABLE";
    return { hookSpecificOutput: { hookEventName: "SessionStart",
      additionalContext: "HEAD optional startup context unavailable (" + code + "). Continue independent work; use a previously verified exact logical Session only for dependent work. No state was changed." } };
  }
  return { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: startupProjection(entry, event.cwd, runtime) } };
}

export async function runSessionHostHook({ runtime, event, environment = process.env, observeOnly = false } = {}) {
  try {
    const { observeNativeHook } = await import("./lib/native-session-observations.mjs");
    await observeNativeHook({ runtime, event, environment });
  } catch { /* Observations cannot block native flow or existing recovery. */ }
  return observeOnly ? {} : sessionStartContext({ runtime, event, environment });
}

async function main() {
  const args = process.argv.slice(2), index = args.indexOf("--runtime");
  let bytes = 0; const chunks = [];
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 64 * 1024) { process.stdout.write("{}\n"); return; }
    chunks.push(chunk);
  }
  try { process.stdout.write(JSON.stringify(await runSessionHostHook({ runtime: args[index + 1],
    event: JSON.parse(Buffer.concat(chunks).toString("utf8")), observeOnly: args.includes("--observe-only") })) + "\n"); }
  catch { process.stdout.write("{}\n"); }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
