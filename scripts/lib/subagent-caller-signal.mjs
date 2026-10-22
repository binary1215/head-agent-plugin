import fs from "node:fs";
import path from "node:path";
import { atomicWriteArtifact } from "./artifact-storage.mjs";
import { resolveProjectStorage } from "./project-storage-format.mjs";
import { resolveRuntimeOperationalStateRoot } from "./runtime-execution-lease.mjs";
import { hostRequestDigest } from "./session-host-request.mjs";
import { createNativeObservationStore } from "./native-session-observations.mjs";

// Adapter-owned P5 signal. Core decides the write. The ticket stores no prompt,
// argument body, or absolute path. It expires quickly and is consumed once.
const TTL_MS = 10_000;
const MAX_FILES = 64;

function signalDirectory(root, environment, create) {
  const projectRoot = fs.realpathSync(path.resolve(root));
  const storage = resolveProjectStorage(projectRoot);
  if (!storage) return null;
  const operational = resolveRuntimeOperationalStateRoot({ projectRoot, storage, environment, create });
  const directory = path.join(operational, "subagent-caller-signals");
  if (!fs.existsSync(directory)) {
    if (!create) return null;
    fs.mkdirSync(directory, { recursive: true });
  }
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
  return directory;
}

function ticketArguments(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  const copy = { ...args };
  // Session routing removes this field before the tool runs. The signal has to
  // match the arguments the MCP boundary actually evaluates.
  delete copy.session_id;
  return copy;
}

function ticketKey(toolName, args) {
  return hostRequestDigest({ toolName, arguments: ticketArguments(args) });
}

export function publishSubagentCallerSignal({ root, toolName, arguments: args, environment = process.env, subagent = false } = {}) {
  if (subagent !== true || typeof toolName !== "string" || !toolName) return { published: false };
  let directory;
  try { directory = signalDirectory(root, environment, true); }
  catch { return { published: false }; }
  if (!directory) return { published: false };
  const names = fs.readdirSync(directory).filter(name => name.endsWith(".json"));
  if (names.length >= MAX_FILES) {
    const oldest = names.map(name => path.join(directory, name)).sort((left, right) => fs.statSync(left).mtimeMs - fs.statSync(right).mtimeMs)[0];
    try { fs.unlinkSync(oldest); } catch { /* A full directory must not block the parent tool. */ }
  }
  const file = path.join(directory, ticketKey(toolName, args) + ".json");
  atomicWriteArtifact(file, JSON.stringify({ kind: "SubagentCallerSignal", version: 1, subagent: true, runtime: "opencode", expiresAt: Date.now() + TTL_MS }) + "\n");
  return { published: true };
}

export function consumeSubagentCallerSignal({ root, toolName, arguments: args, environment = process.env } = {}) {
  let directory;
  try { directory = signalDirectory(root, environment, false); }
  catch { return null; }
  if (!directory) return null;
  const file = path.join(directory, ticketKey(toolName, args) + ".json");
  if (!fs.existsSync(file)) return null;
  let body = null;
  try { body = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { body = null; }
  try { fs.unlinkSync(file); } catch { /* Consumed or already gone. */ }
  if (!body || body.kind !== "SubagentCallerSignal" || body.subagent !== true || !Number.isFinite(body.expiresAt) || body.expiresAt < Date.now()) return null;
  return { subagent: true, runtime: "opencode" };
}

export function recordedSubagentCaller({ root, runtime, nativeSessionId, environment = process.env } = {}) {
  if (runtime !== "codex" || typeof nativeSessionId !== "string" || !nativeSessionId) return false;
  try {
    const snapshot = createNativeObservationStore({ environment }).read({ root, caller: { runtime, nativeSessionId, agentId: null } });
    return Boolean(snapshot?.rows?.some(row => row.observation?.event === "SubagentStart" || row.observation?.phase === "child-start-observed"));
  } catch { return false; }
}
