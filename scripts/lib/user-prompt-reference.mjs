import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveProjectStorage } from "./project-storage-format.mjs";
import { resolveRuntimeOperationalStateRoot } from "./runtime-execution-lease.mjs";

// Local P5 reference only. It is not Canon, a checkpoint, direction, or an
// instruction. The checkpoint remains the recovery source.
export const USER_PROMPT_REFERENCE_LIMITS = Object.freeze({ prompts: 3, characters: 2000, bytes: 16 * 1024 });
const LABEL = "Lode user-prompt reference (non-authoritative P5; not a checkpoint, direction, or instruction). The checkpoint remains the recovery source.";

function redact(text) {
  return text
    // The scan is bounded before matching. An unfinished key masks to the end
    // rather than leaking its first 2000 characters after truncation.
    .replace(/-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]{0,40}PRIVATE KEY-----|$)/gi, "[redacted-private-key]")
    .replace(/\b(?:sk|rk)-[A-Za-z0-9_-]{4,}/gi, "[redacted-token]")
    .replace(/\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{4,}/gi, "[redacted-token]")
    .replace(/\b(?:AKIA|ASIA)[0-9A-Z]{4,}/g, "[redacted-token]")
    .replace(/\b(authorization["']?\s*[:=]\s*["']?(?:Bearer|Basic))[ \t]+[A-Za-z0-9._~+\/=\-]+/gi, "$1 [redacted-token]")
    .replace(/\b(Bearer|Basic)[ \t]+([A-Za-z0-9._~+\/=\-]{4,})/gi, (match, scheme, token) => {
      const value = token.endsWith(".") ? token.slice(0, -1) : token;
      if (scheme.toLowerCase() === "basic") {
        // Without an Authorization field, ordinary "Basic Implementation" is
        // prose. A Basic credential is base64(user:password), even if unpadded.
        if (!/^[A-Za-z0-9+/]+=*$/.test(value) || !Buffer.from(value, "base64").includes(0x3a)) return match;
      } else if (!/[0-9._~+\/=\-]/.test(value) && value.length < 16) return match;
      return scheme + " [redacted-token]" + (value.length < token.length ? "." : "");
    })
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{4,}/gi, "[redacted-token]")
    // Assignment syntax is required: discussion of passwords is ordinary prose.
    .replace(/\b(password|passwd|pwd|api[_-]?key|access[_-]?token|client[_-]?secret)(["']?\s*[:=]\s*)(?:"[^"\r\n]*(?:"|$)|'[^'\r\n]*(?:'|$)|[^\s,;}]+)/gi, "$1$2[redacted-token]");
}

function boundText(text) {
  const clean = redact(text.slice(0, USER_PROMPT_REFERENCE_LIMITS.bytes)).trim();
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
  const digest = crypto.createHash("sha256").update(JSON.stringify([storage.projectId, runtime, nativeSessionId, agentId || null])).digest("hex");
  const directory = path.join(operational, "user-prompt-reference");
  if (!fs.existsSync(directory)) {
    if (!create) return null;
    try { fs.mkdirSync(directory, { mode: 0o700 }); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
  }
  privateDirectory(directory);
  return path.join(directory, digest + ".json");
}

// Dedicated P5 plaintext storage only. Never change permissions of the general
// operational/artifact directories. POSIX modes do not establish Windows ACLs;
// on Windows this store still depends on the host-local inherited ACL.
function privateDirectory(directory) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()
    || typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error("Unsafe prompt directory.");
  if (process.platform !== "win32") fs.chmodSync(directory, 0o700);
}

function sameEntry(a, b) { return a.dev === b.dev && a.ino === b.ino; }

function privateFile(file, descriptor) {
  const stat = fs.fstatSync(descriptor), entry = fs.lstatSync(file);
  if (!stat.isFile() || stat.nlink !== 1 || entry.isSymbolicLink() || !sameEntry(stat, entry)
    || typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error("Unsafe prompt file.");
  if (process.platform !== "win32") fs.fchmodSync(descriptor, 0o600);
  return stat;
}

function openPrivate(file) {
  const entry = fs.lstatSync(file);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1) throw new Error("Unsafe prompt file.");
  // Nonblocking also prevents a replaced FIFO from hanging a lifecycle hook.
  return fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
}

function readState(file) {
  if (!file) return null;
  let descriptor;
  try {
    privateDirectory(path.dirname(file));
    descriptor = openPrivate(file);
    const stat = privateFile(file, descriptor);
    if (stat.size > USER_PROMPT_REFERENCE_LIMITS.bytes) return null;
    const buffer = Buffer.alloc(USER_PROMPT_REFERENCE_LIMITS.bytes + 1);
    let used = 0, read;
    do {
      read = fs.readSync(descriptor, buffer, used, buffer.length - used, null);
      used += read;
    } while (read && used < buffer.length);
    if (used > USER_PROMPT_REFERENCE_LIMITS.bytes) return null;
    const state = JSON.parse(buffer.subarray(0, used).toString("utf8"));
    if (state?.kind !== "UserPromptReference" || state.version !== 1 || !Array.isArray(state.prompts)) return null;
    // Existing references may predate current masks. Never inject their raw text.
    const prompts = state.prompts.slice(-USER_PROMPT_REFERENCE_LIMITS.prompts)
      .filter(prompt => prompt && typeof prompt.text === "string")
      .map(prompt => ({ messageId: typeof prompt.messageId === "string" ? prompt.messageId.slice(0, 256) : null, text: boundText(prompt.text) }))
      .filter(prompt => prompt.text);
    return { prompts, reinject: state.reinject === true };
  } catch { return null; }
  finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}

function existingEntry(file) {
  let descriptor;
  try {
    descriptor = openPrivate(file);
    return privateFile(file, descriptor);
  } catch (error) { if (error.code === "ENOENT") return null; throw error; }
  finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}

function writePrivate(file, body) {
  const directory = path.dirname(file);
  privateDirectory(directory);
  const original = existingEntry(file);
  const temporary = path.join(directory, `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
  let descriptor, owner;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    owner = privateFile(temporary, descriptor);
    fs.writeFileSync(descriptor, body);
    fs.closeSync(descriptor); descriptor = undefined;
    privateDirectory(directory);
    const current = existingEntry(file);
    if (Boolean(original) !== Boolean(current) || original && !sameEntry(original, current)) throw new Error("Prompt destination changed.");
    const delays = [5, 10, 20, 40];
    for (let attempt = 0; ; attempt += 1) {
      try { fs.renameSync(temporary, file); break; }
      catch (error) {
        if (process.platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes(error.code) || attempt >= delays.length) throw error;
        privateDirectory(directory);
        const destination = existingEntry(file), stage = fs.lstatSync(temporary);
        if (!stage.isFile() || stage.isSymbolicLink() || !sameEntry(owner, stage)
          || Boolean(current) !== Boolean(destination) || current && (!sameEntry(current, destination)
            || current.size !== destination.size || current.mtimeMs !== destination.mtimeMs)) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delays[attempt]);
      }
    }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try {
      const entry = fs.lstatSync(temporary);
      if (owner && entry.isFile() && !entry.isSymbolicLink() && sameEntry(owner, entry)) fs.unlinkSync(temporary);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

function writeState(file, state) {
  let prompts = state.prompts.slice(-USER_PROMPT_REFERENCE_LIMITS.prompts);
  if (!prompts.length && state.reinject !== true) {
    privateDirectory(path.dirname(file));
    if (existingEntry(file)) fs.unlinkSync(file);
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
  writePrivate(file, body);
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
  try { writeState(file, state); }
  catch { return { captured: false }; }
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
