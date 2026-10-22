import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { atomicWriteArtifact } from "./artifact-storage.mjs";
import { resolveProjectStorage } from "./project-storage-format.mjs";
import { resolveRuntimeOperationalStateRoot } from "./runtime-execution-lease.mjs";

// Local P5 reference only. It is not Canon, a checkpoint, direction, or an
// instruction. The checkpoint remains the recovery source.
export const USER_PROMPT_REFERENCE_LIMITS = Object.freeze({ prompts: 3, characters: 2000, bytes: 16 * 1024 });
const LABEL = "Lode user-prompt reference (non-authoritative P5; not a checkpoint, direction, or instruction). The checkpoint remains the recovery source.";

function redact(text) {
  return text
    .replace(/-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----[\s\S]{0,8000}?-----END [A-Z ]{0,40}PRIVATE KEY-----/g, "[redacted-private-key]")
    .replace(/\b(?:sk|rk)-[A-Za-z0-9_-]{8,}/g, "[redacted-token]")
    .replace(/\b(?:ghp_|github_pat_)[A-Za-z0-9_]{8,}/g, "[redacted-token]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[redacted-token]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{8,}/g, "Bearer [redacted-token]")
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{8,}/g, "[redacted-token]");
}

function boundText(text) {
  const clean = redact(text).trim();
  if (!clean) return "";
  return clean.length > USER_PROMPT_REFERENCE_LIMITS.characters
    ? clean.slice(0, USER_PROMPT_REFERENCE_LIMITS.characters) : clean;
}

function callerFile(root, runtime, nativeSessionId, agentId, environment, create) {
  if (!["claude", "codex", "opencode"].includes(runtime) || typeof nativeSessionId !== "string" || !nativeSessionId) return null;
  const projectRoot = fs.realpathSync(path.resolve(root));
  const storage = resolveProjectStorage(projectRoot);
  if (!storage) return null;
  const operational = resolveRuntimeOperationalStateRoot({ projectRoot, storage, environment, create });
  const digest = crypto.createHash("sha256").update(JSON.stringify([runtime, nativeSessionId, agentId || null])).digest("hex");
  const directory = path.join(operational, "user-prompt-reference");
  if (!fs.existsSync(directory)) {
    if (!create) return null;
    fs.mkdirSync(directory, { recursive: true });
  }
  return path.join(directory, digest + ".json");
}

function readState(file) {
  if (!file || !fs.existsSync(file)) return null;
  try {
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    if (state?.kind !== "UserPromptReference" || state.version !== 1 || !Array.isArray(state.prompts)) return null;
    return state;
  } catch { return null; }
}

function writeState(file, state) {
  let prompts = state.prompts.slice(-USER_PROMPT_REFERENCE_LIMITS.prompts);
  if (!prompts.length && state.reinject !== true) {
    try { fs.unlinkSync(file); } catch { /* Already consumed. */ }
    return;
  }
  let body = "";
  do {
    body = JSON.stringify({
      kind: "UserPromptReference", version: 1, authorityPlane: "P5",
      recoveryAuthority: false, instructionAuthority: false, reinject: state.reinject === true, prompts,
    }) + "\n";
    if (Buffer.byteLength(body) <= USER_PROMPT_REFERENCE_LIMITS.bytes) break;
    prompts = prompts.slice(1);
  } while (prompts.length);
  if (!prompts.length && state.reinject !== true) return;
  atomicWriteArtifact(file, body);
}

export function captureUserPrompt({ root, runtime, nativeSessionId, agentId = null, text, messageId = null, environment = process.env } = {}) {
  const next = boundText(typeof text === "string" ? text : "");
  if (!next) return { captured: false };
  let file;
  try { file = callerFile(root, runtime, nativeSessionId, agentId, environment, true); }
  catch { return { captured: false }; }
  if (!file) return { captured: false };
  const state = readState(file) || { prompts: [], reinject: false };
  // A freeze holds the pre-compaction text. Later synthetic turns cannot replace it.
  if (state.reinject === true) return { captured: false, frozen: true };
  const last = state.prompts.at(-1);
  if (messageId && last?.messageId === messageId) {
    last.text = last.text.includes(next) && next.length <= last.text.length ? last.text : boundText(last.text.includes(next) ? next : last.text + "\n" + next);
  } else {
    state.prompts.push({ messageId: messageId || null, text: next });
  }
  writeState(file, state);
  return { captured: true };
}

export function freezeUserPromptReference({ root, runtime, nativeSessionId, agentId = null, environment = process.env } = {}) {
  let file;
  try { file = callerFile(root, runtime, nativeSessionId, agentId, environment, false); }
  catch { return { frozen: false }; }
  const state = readState(file);
  if (!state?.prompts?.length) return { frozen: false };
  state.reinject = true;
  try { writeState(file, state); }
  catch { return { frozen: false }; }
  return { frozen: true };
}

export function takeUserPromptReference({ root, runtime, nativeSessionId, agentId = null, environment = process.env, force = false } = {}) {
  let file;
  try { file = callerFile(root, runtime, nativeSessionId, agentId, environment, false); }
  catch { return ""; }
  const state = readState(file);
  // Compact and clear pass force so a host without PreCompact still restores.
  // Ordinary requests leave an unfrozen reference in place.
  if (!state?.prompts?.length || (!state.reinject && force !== true)) return "";
  const lines = state.prompts.map((prompt, index) => (index + 1) + ". " + prompt.text);
  state.reinject = false;
  state.prompts = [];
  try { writeState(file, state); }
  catch { return ""; }
  return LABEL + "\n" + lines.join("\n");
}

export function appendUserPromptReference(additionalContext, reference, limit) {
  if (typeof additionalContext !== "string" || typeof reference !== "string" || !reference) return additionalContext;
  const next = additionalContext + "\n\n" + reference;
  return next.length <= limit ? next : additionalContext;
}
