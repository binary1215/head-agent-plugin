import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const REFRESH_WRITER_LEASE_VERSION = "0.1.0";

const fail = (message, code = "REFRESH_WRITER_LEASE_ERROR") => {
  const error = new Error(message);
  error.code = code;
  throw error;
};

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function leaseDirectory(projectRoot) {
  return path.join(path.resolve(projectRoot), ".head", "refresh", "writer.lock");
}

function ownerFile(projectRoot) {
  return path.join(leaseDirectory(projectRoot), "owner.json");
}

function readOwner(projectRoot) {
  const file = ownerFile(projectRoot);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { fail(`Refresh writer lease owner is invalid JSON: ${error.message}`, "INVALID_REFRESH_WRITER_LEASE"); }
}

function verifyOwner(owner, { projectId = "", token = "" } = {}) {
  if (!owner || typeof owner !== "object" || Array.isArray(owner)
    || owner.schemaVersion !== 1 || owner.kind !== "RefreshWriterLease"
    || owner.protocol?.name !== "head-agent-core-refresh-writer-lease"
    || owner.protocol?.version !== REFRESH_WRITER_LEASE_VERSION
    || typeof owner.projectId !== "string" || !/^head-[a-f0-9]{20}$/.test(owner.projectId)
    || !Number.isInteger(owner.pid) || owner.pid <= 0
    || typeof owner.token !== "string" || !/^[a-f0-9]{32}$/.test(owner.token)
    || typeof owner.startedAt !== "string" || Number.isNaN(Date.parse(owner.startedAt))
    || owner.authority !== "operational-refresh-serialization-only"
    || owner.instructionAuthority !== false || owner.promotionAuthority !== false
    || owner.canonMutationAuthority !== false) {
    fail("Refresh writer lease owner is invalid.", "INVALID_REFRESH_WRITER_LEASE");
  }
  if (projectId && owner.projectId !== projectId) fail("Refresh writer lease belongs to another project.", "REFRESH_WRITER_LEASE_PROJECT_MISMATCH");
  if (token && owner.token !== token) fail("Refresh writer lease token does not match the active owner.", "REFRESH_WRITER_LEASE_TOKEN_MISMATCH");
  return owner;
}

function processState(pid) {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error) {
    if (error?.code === "ESRCH") return "absent";
    return "unknown";
  }
}

function removeOwnedDirectory(projectRoot, owner) {
  const directory = leaseDirectory(projectRoot);
  const file = ownerFile(projectRoot);
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("Refresh writer lease path is not a safe directory.", "UNSAFE_REFRESH_WRITER_LEASE");
  const stored = verifyOwner(readOwner(projectRoot), { projectId: owner.projectId, token: owner.token });
  if (stored.pid !== owner.pid) fail("Refresh writer lease PID changed before release.", "REFRESH_WRITER_LEASE_TOKEN_MISMATCH");
  const entries = fs.readdirSync(directory).sort();
  if (entries.length !== 1 || entries[0] !== "owner.json") fail("Refresh writer lease contains unexpected files.", "UNSAFE_REFRESH_WRITER_LEASE");
  fs.unlinkSync(file);
  fs.rmdirSync(directory);
}

function recoverDeadOwner(projectRoot, projectId) {
  const directory = leaseDirectory(projectRoot);
  if (!fs.existsSync(directory)) return false;
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("Refresh writer lease path is not a safe directory.", "UNSAFE_REFRESH_WRITER_LEASE");
  const owner = verifyOwner(readOwner(projectRoot), { projectId });
  const state = processState(owner.pid);
  if (state !== "absent") {
    fail(`Refresh writer is already active or cannot be proven absent (pid ${owner.pid}).`, "REFRESH_WRITER_BUSY");
  }
  removeOwnedDirectory(projectRoot, owner);
  return true;
}

function acquire({ projectRoot, projectId }) {
  const directory = leaseDirectory(projectRoot);
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.mkdirSync(directory);
      const owner = {
        schemaVersion: 1,
        kind: "RefreshWriterLease",
        protocol: { name: "head-agent-core-refresh-writer-lease", version: REFRESH_WRITER_LEASE_VERSION },
        projectId,
        pid: process.pid,
        token: crypto.randomBytes(16).toString("hex"),
        startedAt: new Date().toISOString(),
        authority: "operational-refresh-serialization-only",
        instructionAuthority: false,
        promotionAuthority: false,
        canonMutationAuthority: false,
      };
      try {
        fs.writeFileSync(ownerFile(projectRoot), json(owner), { encoding: "utf8", flag: "wx" });
        return owner;
      } catch (error) {
        try { fs.rmdirSync(directory); } catch {}
        throw error;
      }
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (attempt === 0 && recoverDeadOwner(projectRoot, projectId)) continue;
      fail("Refresh writer is already active.", "REFRESH_WRITER_BUSY");
    }
  }
  fail("Refresh writer lease could not be acquired.", "REFRESH_WRITER_BUSY");
}

export function verifyRefreshWriterLease({ projectRoot, projectId, lease }) {
  const owner = verifyOwner(lease, { projectId, token: lease?.token || "" });
  if (owner.pid !== process.pid) fail("Refresh writer lease is not owned by this process.", "REFRESH_WRITER_LEASE_NOT_OWNED");
  const stored = verifyOwner(readOwner(projectRoot), { projectId, token: owner.token });
  if (stored.pid !== owner.pid) fail("Refresh writer lease PID does not match its stored owner.", "REFRESH_WRITER_LEASE_NOT_OWNED");
  return lease;
}

export async function withRefreshWriterLease({ projectRoot, projectId, lease = null }, operation) {
  if (typeof operation !== "function") fail("Refresh writer lease requires an operation.", "INVALID_REFRESH_WRITER_LEASE_OPERATION");
  if (lease) {
    verifyRefreshWriterLease({ projectRoot, projectId, lease });
    return operation(lease);
  }
  const acquired = acquire({ projectRoot, projectId });
  try {
    return await operation(acquired);
  } finally {
    removeOwnedDirectory(projectRoot, acquired);
  }
}

export function inspectRefreshWriterLease({ projectRoot, projectId }) {
  const directory = leaseDirectory(projectRoot);
  if (!fs.existsSync(directory)) return { status: "idle", leaseDirectory: directory };
  const owner = verifyOwner(readOwner(projectRoot), { projectId });
  return {
    status: processState(owner.pid) === "alive" ? "active" : "stale-or-unknown",
    leaseDirectory: directory,
    owner: { pid: owner.pid, startedAt: owner.startedAt, protocol: owner.protocol },
  };
}
