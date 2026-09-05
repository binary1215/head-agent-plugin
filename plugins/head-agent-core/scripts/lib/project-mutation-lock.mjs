import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";

// Local P5 serialization only. These transient files never supply project
// direction, survive as Canon, or lock ordinary read-only work.
const context = new AsyncLocalStorage();
const pause = new Int32Array(new SharedArrayBuffer(4));
const WAIT_MS = 10_000;
const HOST = crypto.createHash("sha256").update(os.hostname()).digest("hex").slice(0, 16);
const OWNER = /^owner-([a-f0-9]{16})-([1-9][0-9]*)-([a-f0-9]{32})\.json$/;

function fail(message, code = "PROJECT_MUTATION_BUSY") {
  throw Object.assign(new Error(message), { code });
}

function lockFor(root, scope) {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(scope)) fail("Invalid mutation scope.", "INVALID_PROJECT_MUTATION_SCOPE");
  const canonicalRoot = fs.realpathSync(path.resolve(root));
  const headRoot = path.join(canonicalRoot, ".head");
  if (!fs.existsSync(headRoot)) fail("HEAD Agent Core is not initialized.", "NOT_INITIALIZED");
  safeDirectory(headRoot);
  return path.join(headRoot, ".operations", `${scope}.lock`);
}

function safeDirectory(directory) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("Unsafe mutation lock path.", "INVALID_PROJECT_MUTATION_LOCK");
  return stat;
}

function absent(pid) {
  try { process.kill(pid, 0); return false; }
  catch (error) { return error.code === "ESRCH"; }
}

function release(owner) {
  // Never unlink a generic owner path: another process may already have
  // acquired a new directory after a stale-owner cleanup.
  try { fs.unlinkSync(owner.file); }
  catch (error) { if (error.code !== "ENOENT") throw error; return; }
  try { fs.rmdirSync(owner.directory); }
  catch (error) {
    // Ownership is already released by the exact nonce unlink. A succeeding
    // writer (or a Windows enumeration handle) may prevent directory removal;
    // never turn a committed operation into failure for this empty-shell cleanup.
    if (!new Set(["ENOENT", "ENOTEMPTY", "EEXIST", "EPERM", "EACCES"]).has(error.code)) throw error;
  }
  try { fs.rmdirSync(path.dirname(owner.directory)); } catch {}
}

function attempt(directory) {
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  try { safeDirectory(path.dirname(directory)); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
  if (fs.existsSync(directory)) {
    try {
      safeDirectory(directory);
      const files = fs.readdirSync(directory);
      for (const name of files) {
        const match = OWNER.exec(name);
        if (!match) fail("Unexpected mutation lock entry.", "INVALID_PROJECT_MUTATION_LOCK");
        if (match[1] === HOST && absent(Number(match[2]))) release({ directory, file: path.join(directory, name) });
      }
      if (files.length) return null;
      // Empty means a released owner was removed before rmdir. A populated
      // owner is always published atomically; rmdir cannot remove a new owner.
      try { fs.rmdirSync(directory); }
      catch (error) { if (!new Set(["ENOENT", "ENOTEMPTY", "EEXIST", "EPERM", "EACCES"]).has(error.code)) throw error; }
      return null;
    } catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }
  const name = `owner-${HOST}-${process.pid}-${crypto.randomBytes(16).toString("hex")}.json`;
  const staging = path.join(path.dirname(directory), `.${path.basename(directory)}-${name}.staging`);
  const owner = { directory, file: path.join(directory, name) };
  let publishing = false;
  try {
    fs.mkdirSync(staging);
    fs.writeFileSync(path.join(staging, name), JSON.stringify({ pid: process.pid, parentPid: process.ppid, scope: path.basename(directory), authorityPlane: "P5", recoveryAuthority: false }), { flag: "wx" });
    // Publish a fully populated directory. The visible lock never has a gap
    // without owner identity, even when the publishing process exits abruptly.
    publishing = true;
    fs.renameSync(staging, directory);
    return owner;
  } catch (error) {
    if (error.code === "ENOENT" || publishing && new Set(["EEXIST", "ENOTEMPTY", "EPERM", "EACCES"]).has(error.code) || fs.existsSync(directory)) return null;
    throw error;
  } finally {
    if (fs.existsSync(staging)) {
      try { fs.unlinkSync(path.join(staging, name)); } catch (error) { if (error.code !== "ENOENT") throw error; }
      try { fs.rmdirSync(staging); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }
}

function cleanInterruptedStaging(directory) {
  const parent = path.dirname(directory);
  if (!fs.existsSync(parent)) return;
  let files;
  try {
    safeDirectory(parent);
    files = fs.readdirSync(parent);
  } catch (error) { if (error.code === "ENOENT") return; throw error; }
  const prefix = `.${path.basename(directory)}-`;
  for (const name of files) {
    if (!name.startsWith(prefix) || !name.endsWith(".staging")) continue;
    const ownerName = name.slice(prefix.length, -".staging".length);
    const match = OWNER.exec(ownerName);
    if (!match || match[1] !== HOST || !absent(Number(match[2]))) continue;
    const staging = path.join(parent, name);
    try {
      safeDirectory(staging);
      const entries = fs.readdirSync(staging);
      if (entries.some((entry) => entry !== ownerName)) fail("Unexpected staged mutation lock entry.", "INVALID_PROJECT_MUTATION_LOCK");
      if (entries.length) release({ directory: staging, file: path.join(staging, ownerName) });
      else fs.rmdirSync(staging);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

function nestedOwner(directory) {
  const owner = context.getStore()?.get(directory);
  if (owner && fs.existsSync(owner.file)) return owner;
  return null;
}

export function withProjectMutation({ root = ".", scope }, operation) {
  const directory = lockFor(root, scope);
  if (nestedOwner(directory)) return operation();
  cleanInterruptedStaging(directory);
  const deadline = Date.now() + WAIT_MS;
  let owner;
  while (!(owner = attempt(directory))) {
    // A synchronous caller cannot wait for an unrelated async owner in this
    // event loop: doing so would prevent that owner from releasing its lock.
    try {
      if (fs.readdirSync(directory).some((name) => {
        const match = OWNER.exec(name);
        return match?.[1] === HOST && match[2] === String(process.pid);
      })) {
        fail(`The ${scope} operation is active in this process; retry shortly.`);
      }
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (Date.now() >= deadline) fail(`The ${scope} operation is busy; retry this operation shortly.`);
    Atomics.wait(pause, 0, 0, 10);
  }
  try {
    const active = new Map(context.getStore() || []);
    active.set(directory, owner);
    const result = context.run(active, operation);
    if (result && typeof result.then === "function") fail("Use the asynchronous mutation coordinator for asynchronous operations.", "INVALID_PROJECT_MUTATION_OPERATION");
    return result;
  } finally { release(owner); }
}

export async function withProjectMutationAsync({ root = ".", scope }, operation) {
  const directory = lockFor(root, scope);
  if (nestedOwner(directory)) return operation();
  cleanInterruptedStaging(directory);
  const deadline = Date.now() + WAIT_MS;
  let owner;
  while (!(owner = attempt(directory))) {
    if (Date.now() >= deadline) fail(`The ${scope} operation is busy; retry this operation shortly.`);
    await delay(10);
  }
  try {
    const active = new Map(context.getStore() || []);
    active.set(directory, owner);
    return await context.run(active, operation);
  } finally { release(owner); }
}
