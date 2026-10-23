import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { safeGraphFile } from "./discovery-index.mjs";
import { MAX_REFERENCE_BYTES } from "./session-work-evidence-original.mjs";

const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
// Preserve a valid BOM too: sha(UTF-8 text) must still identify the raw bytes.
const decode = bytes => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);

function currentBytes(root, relative) {
  const file = safeGraphFile(root, relative), fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_REFERENCE_BYTES) throw Object.assign(new Error("Source byte bound"), { code: "SOURCE_BYTE_BOUND" });
    const bytes = Buffer.alloc(Math.min(stat.size + 1, MAX_REFERENCE_BYTES + 1)); let count = 0;
    while (count < bytes.length) { const n = fs.readSync(fd, bytes, count, bytes.length - count, count); if (!n) break; count += n; }
    // A growing source is unavailable, never an exact truncated version.
    if (count > stat.size || count > MAX_REFERENCE_BYTES || fs.fstatSync(fd).size !== count) throw Object.assign(new Error("Source changed while reading"), { code: "SOURCE_READ_DRIFT" });
    return bytes.subarray(0, count);
  } finally { fs.closeSync(fd); }
}

function git(root, args) {
  return new Promise(resolve => {
    const chunks = [], diagnostics = []; let total = 0, diagnosticBytes = 0, reasonCode = null, child;
    const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_NO_REPLACE_OBJECTS: "1", GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };
    for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"]) delete env[key];
    try { child = spawn("git", ["--no-optional-locks", "--literal-pathspecs", ...args], { cwd: root, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env }); }
    catch { resolve({ bytes: null, reasonCode: "LOCAL_GIT_UNAVAILABLE" }); return; }
    const timer = setTimeout(() => { reasonCode ||= "LOCAL_GIT_READ_TIMEOUT"; child.kill(); }, 1500);
    child.stdout.on("data", chunk => { total += chunk.length; if (total > MAX_REFERENCE_BYTES) { reasonCode ||= "LOCAL_GIT_OUTPUT_BYTE_BOUND"; child.kill(); } else chunks.push(chunk); });
    child.stderr.on("data", chunk => { diagnosticBytes += chunk.length; if (diagnosticBytes <= 4096) diagnostics.push(chunk); });
    child.on("error", () => { reasonCode ||= "LOCAL_GIT_UNAVAILABLE"; });
    child.once("close", code => {
      clearTimeout(timer);
      // Only a bounded, complete, C-locale discovery diagnostic classifies
      // ordinary non-Git folders. Permission/corrupt .git/other errors remain
      // command failures; stderr itself is never exposed as source evidence.
      const diagnostic = diagnosticBytes <= 4096 ? Buffer.concat(diagnostics).toString("utf8") : "";
      const notRepository = args[0] === "rev-parse" && code === 128 && /^(?:fatal: not a git repository \(or any of the parent directories\): \.git\r?\n?|fatal: not a git repository \(or any parent up to mount point [^\r\n]+\)\r?\nStopping at filesystem boundary \(GIT_DISCOVERY_ACROSS_FILESYSTEM not set\)\.\r?\n?)$/u.test(diagnostic);
      resolve(reasonCode || code !== 0 ? { bytes: null, reasonCode: reasonCode || (notRepository ? "LOCAL_GIT_NOT_A_REPOSITORY" : "LOCAL_GIT_COMMAND_FAILED") }
        : { bytes: Buffer.concat(chunks), reasonCode: null });
    });
  });
}

// Per-request only. Git is an optional byte supplier, never a work/Run oracle.
export function createContextSourceReader(root, projectId) {
  const retained = new Map(), histories = new Map(); let prefix, gitCalls = 0, lastCommandReason = null, prefixReason = null;
  const command = async args => {
    if (gitCalls >= 24) { lastCommandReason = "LOCAL_GIT_READ_BUDGET_REACHED"; return null; }
    gitCalls++; const result = await git(root, args); lastCommandReason = result.reasonCode; return result.bytes;
  };
  return {
    async read(relative, expectedDigest = null) {
      const cacheKey = JSON.stringify([relative, expectedDigest]);
      if (retained.has(cacheKey)) return retained.get(cacheKey);
      let current = null, currentReason = null;
      try {
        if (/^(?:\.git|\.head|\.lode)(?:\/|$)/i.test(relative)) throw Object.assign(new Error("Not repository source"), { code: "SOURCE_PATH_NOT_CODE" });
        safeGraphFile(root, relative);
        const bytes = currentBytes(root, relative), digest = sha(bytes);
        current = { projectId, path: relative, digest, text: decode(bytes), basis: { kind: "current-disk-bytes", commitAttribution: "not-determined" } };
        if (!expectedDigest || digest === expectedDigest) { retained.set(cacheKey, current); return current; }
      } catch (error) { currentReason = error.code || "SOURCE_UNAVAILABLE"; }
      // A rejected path/encoding is not permission to obtain it via Git.
      if (currentReason && currentReason !== "ENOENT" && currentReason !== "SOURCE_READ_DRIFT") return { status: "unavailable", path: relative, expectedDigest, reasonCode: currentReason };
      if (!expectedDigest || !/^[a-f0-9]{64}$/.test(expectedDigest)) return { status: "unavailable", path: relative, reasonCode: currentReason || "EXACT_SOURCE_DIGEST_REQUIRED" };
      try { safeGraphFile(root, relative); } catch (error) { return { status: "unavailable", path: relative, reasonCode: error.code }; }
      if (prefix === undefined) {
        const bytes = await command(["rev-parse", "--show-toplevel", "--show-prefix"]);
        prefixReason = lastCommandReason;
        try {
          const [top, relativeRoot = ""] = bytes ? decode(bytes).split(/\r?\n/) : [];
          prefix = top && fs.realpathSync(path.resolve(top, relativeRoot)) === fs.realpathSync(root) ? relativeRoot : null;
        } catch { prefix = null; }
      }
      if (prefix === null) return { status: "unavailable", path: relative, expectedDigest, reasonCode: prefixReason || "HISTORICAL_BYTES_NOT_AVAILABLE_LOCALLY" };
      if (!histories.has(relative)) {
        const history = await command(["log", "-n", "16", "--no-show-signature", "--no-patch", "--no-decorate", "--no-notes", "--format=%H", "--", relative]);
        histories.set(relative, { commits: history ? decode(history).trim().split(/\s+/).filter(id => /^[a-f0-9]{40,64}$/.test(id)) : [], reasonCode: lastCommandReason });
      }
      let historyReason = histories.get(relative).reasonCode;
      for (const commit of histories.get(relative).commits) {
        const bytes = await command(["cat-file", "blob", `${commit}:${prefix}${relative}`]);
        if (!bytes) historyReason = lastCommandReason;
        if (!bytes || sha(bytes) !== expectedDigest) continue;
        const version = { projectId, path: relative, digest: expectedDigest, text: decode(bytes), basis: { kind: "local-git-exact-blob", commit,
          commitAttribution: "byte-location-only-not-Run-or-decision-cause" } };
        retained.set(cacheKey, version); return version;
      }
      return { status: "unavailable", path: relative, expectedDigest, reasonCode: historyReason || "EXACT_HISTORICAL_BYTES_NOT_RETAINED_IN_BOUNDED_HISTORY" };
    },
    async renameCandidates(relative, expectedDigest) {
      // Optional, after exact-source reads: never spend their budget first.
      // R100 is Git's exact-byte move observation, not canonical identity.
      const version = retained.get(JSON.stringify([relative, expectedDigest]));
      const commit = histories.get(relative)?.commits[0];
      if (version?.basis.kind !== "local-git-exact-blob" || !commit) return { candidates: [], status: "exact-cited-source-required" };
      const bytes = await command(["diff-tree", "--root", "--no-commit-id", "--name-status", "-z", "-r", "-M100%", "--no-ext-diff", "--no-textconv", commit]);
      if (!bytes) return { candidates: [], status: "bounded-local-rename-evidence-unavailable", reasonCode: lastCommandReason };
      const candidates = [];
      try {
        const fields = decode(bytes).split("\0");
        for (let i = 0; i < fields.length && fields[i];) {
          const status = fields[i++], from = fields[i++], to = /^R\d+$/.test(status) ? fields[i++] : null;
          if (status !== "R100" || from !== `${prefix}${relative}` || !to?.startsWith(prefix)) continue;
          const candidatePath = to.slice(prefix.length);
          if (/^(?:\.git|\.head|\.lode)(?:\/|$)/i.test(candidatePath)) continue;
          safeGraphFile(root, candidatePath);
          const original = await command(["cat-file", "blob", `${commit}:${to}`]);
          if (!original || sha(original) !== expectedDigest) continue;
          candidates.push({ path: candidatePath, commit, digest: expectedDigest, evidence: "local-git-R100-and-exact-cited-digest",
            interpretation: "Historical rename candidate only; current path, logical identity and cause are not established." });
        }
      } catch { return { candidates: [], status: "local-rename-evidence-unavailable" }; }
      return { candidates, status: gitCalls >= 24 ? "partial-local-git-budget" : "observed-most-recent-path-change-only", renameEstablished: false };
    },
    diagnostics() { return { localGitCommands: gitCalls, maxLocalGitCommands: 24, maxPathHistoryCommits: 16, maxSourceBytes: MAX_REFERENCE_BYTES,
      writes: false, sourceScope: "requested-files-only", interpretation: "No ancestry, rename, Run ownership or rationale inferred from a commit." }; },
  };
}
