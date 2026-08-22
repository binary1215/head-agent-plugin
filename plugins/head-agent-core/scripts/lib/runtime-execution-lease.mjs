import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const RUNTIME_EXECUTION_LEASE_VERSION = "0.3.0";
export const RUNTIME_OPERATIONAL_STATE_VERSION = "0.1.0";
export const RUNTIME_OPERATIONAL_STATE_ENV = "HEAD_AGENT_OPERATIONAL_STATE_ROOT";
const SUPPORTED_DURABLE_LEASE_VERSIONS = new Set(["0.2.0", RUNTIME_EXECUTION_LEASE_VERSION]);

const fail = (message, code = "RUNTIME_EXECUTION_LEASE_ERROR") => {
  const error = new Error(message);
  error.code = code;
  throw error;
};

const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort(compareText).map((key) => [key, canonicalValue(value[key])]));
  }
  return value;
}

const canonicalJson = (value) => JSON.stringify(canonicalValue(value));
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function identify(payload, prefix, idKey, hashKey) {
  const hash = digest(canonicalJson(payload));
  return { ...payload, [idKey]: `${prefix}-${hash.slice(0, 24)}`, [hashKey]: hash };
}

function verifyIdentity(document, { prefix, idKey, hashKey, code }) {
  const payload = { ...document };
  delete payload[idKey];
  delete payload[hashKey];
  const hash = digest(canonicalJson(payload));
  if (document[hashKey] !== hash || document[idKey] !== `${prefix}-${hash.slice(0, 24)}`) {
    fail("Runtime execution lease artifact digest verification failed.", code);
  }
}

function assertFields(value, fields, label, code = "INVALID_RUNTIME_EXECUTION_LEASE") {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} is invalid.`, code);
  const expected = new Set(fields);
  if (Object.keys(value).some((field) => !expected.has(field)) || fields.some((field) => !(field in value))) {
    fail(`${label} fields are invalid.`, code);
  }
}

function requireAuthorizationShape(authorization) {
  if (!authorization || typeof authorization !== "object" || Array.isArray(authorization)
    || !/^execution-authorization-[a-f0-9]{24}$/.test(authorization.authorizationId || "")
    || !/^[a-f0-9]{64}$/.test(authorization.authorizationHash || "")
    || !/^head-[a-f0-9]{20}$/.test(authorization.projectId || "")
    || !/^session-[A-Fa-f0-9-]{36}$/.test(authorization.headSessionId || "")
    || !new Set(["session", "run"]).has(authorization.scope?.kind)
    || authorization.scope.kind === "run" && (!/^run-[0-9]+-[a-f0-9]{6}$/.test(authorization.scope.runId || "")
      || !/^execution-contract-[a-f0-9]{24}$/.test(authorization.scope.executionContractId || ""))
    || authorization.scope.kind === "session" && (authorization.scope.runId !== null || authorization.scope.executionContractId !== null)
    || !new Set(["codex", "opencode"]).has(authorization.runtime)
    || !Number.isSafeInteger(authorization.limits?.timeoutMs)
    || !Number.isSafeInteger(authorization.limits?.terminationGraceMs)) {
    fail("Runtime execution lease requires a verified invocation authorization.", "INVALID_RUNTIME_EXECUTION_LEASE_AUTHORIZATION");
  }
  const payload = { ...authorization };
  delete payload.authorizationId;
  delete payload.authorizationHash;
  const authorizationHash = digest(canonicalJson(payload));
  if (authorization.authorizationHash !== authorizationHash
    || authorization.authorizationId !== `execution-authorization-${authorizationHash.slice(0, 24)}`) {
    fail("Runtime invocation authorization digest verification failed at lease acquisition.", "RUNTIME_EXECUTION_LEASE_AUTHORIZATION_DIGEST_MISMATCH");
  }
  return authorization;
}

function verifyPersistedAuthorization(projectRoot, authorization) {
  const file = path.join(
    path.resolve(projectRoot),
    ".head",
    "runtime",
    "execution-authorizations",
    `${authorization.authorizationId}.json`,
  );
  if (!fs.existsSync(file)) {
    fail("Runtime execution lease requires the persisted invocation authorization.", "RUNTIME_EXECUTION_LEASE_AUTHORIZATION_NOT_PERSISTED");
  }
  const stat = fs.lstatSync(file);
  const resolvedProject = fs.realpathSync(path.resolve(projectRoot));
  const resolvedFile = fs.realpathSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || !resolvedFile.startsWith(`${resolvedProject}${path.sep}`)) {
    fail("Runtime execution lease authorization path is unsafe.", "UNSAFE_RUNTIME_EXECUTION_LEASE_AUTHORIZATION");
  }
  const stored = requireAuthorizationShape(readJson(file, "Runtime invocation authorization"));
  if (canonicalJson(stored) !== canonicalJson(authorization)) {
    fail("Runtime execution lease authorization differs from its durable record.", "RUNTIME_EXECUTION_LEASE_AUTHORIZATION_MISMATCH");
  }
  return stored;
}

function durableLeaseDirectory(projectRoot, authorizationId) {
  return path.join(path.resolve(projectRoot), ".head", "runtime", "execution-leases", authorizationId);
}

function configuredOperationalStateRoot({ environment = process.env, platform = process.platform, homeDirectory = os.homedir() } = {}) {
  const override = String(environment?.[RUNTIME_OPERATIONAL_STATE_ENV] || "").trim();
  if (override) {
    if (!path.isAbsolute(override)) fail(`${RUNTIME_OPERATIONAL_STATE_ENV} must be an absolute path.`, "INVALID_RUNTIME_OPERATIONAL_STATE_ROOT");
    return path.resolve(override);
  }
  if (platform === "win32") {
    const localAppData = String(environment?.LOCALAPPDATA || environment?.LocalAppData || "").trim();
    if (!localAppData || !path.isAbsolute(localAppData)) {
      fail("Windows runtime operational state requires an absolute LOCALAPPDATA path or explicit host override.", "RUNTIME_OPERATIONAL_STATE_ROOT_UNAVAILABLE");
    }
    return path.resolve(localAppData, "head-agent-core", "operational-state");
  }
  const xdgStateHome = String(environment?.XDG_STATE_HOME || "").trim();
  if (xdgStateHome) {
    if (!path.isAbsolute(xdgStateHome)) fail("XDG_STATE_HOME must be an absolute path.", "INVALID_RUNTIME_OPERATIONAL_STATE_ROOT");
    return path.resolve(xdgStateHome, "head-agent-core");
  }
  if (!homeDirectory || !path.isAbsolute(homeDirectory)) fail("Runtime operational state home is unavailable.", "RUNTIME_OPERATIONAL_STATE_ROOT_UNAVAILABLE");
  return path.resolve(homeDirectory, ".local", "state", "head-agent-core");
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function resolveRuntimeOperationalStateRoot({
  projectRoot,
  environment = process.env,
  platform = process.platform,
  homeDirectory = os.homedir(),
  create = true,
} = {}) {
  const resolvedProject = fs.realpathSync(path.resolve(projectRoot));
  const configured = configuredOperationalStateRoot({ environment, platform, homeDirectory });
  if (configured === path.parse(configured).root || isWithin(resolvedProject, configured) || isWithin(configured, resolvedProject)) {
    fail("Runtime operational state root must be a dedicated host-local directory outside the project tree.", "UNSAFE_RUNTIME_OPERATIONAL_STATE_ROOT");
  }
  if (create) fs.mkdirSync(configured, { recursive: true });
  if (!fs.existsSync(configured)) {
    if (!create) return configured;
    fail("Runtime operational state root does not exist.", "RUNTIME_OPERATIONAL_STATE_ROOT_UNAVAILABLE");
  }
  const stat = fs.lstatSync(configured);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("Runtime operational state root is unsafe.", "UNSAFE_RUNTIME_OPERATIONAL_STATE_ROOT");
  const resolvedOperational = fs.realpathSync(configured);
  if (resolvedOperational === path.parse(resolvedOperational).root
    || isWithin(resolvedProject, resolvedOperational)
    || isWithin(resolvedOperational, resolvedProject)) {
    fail("Runtime operational state root must be a dedicated host-local directory outside the project tree.", "UNSAFE_RUNTIME_OPERATIONAL_STATE_ROOT");
  }
  return resolvedOperational;
}

function operationalLeaseDirectory(operationalStateRoot, projectId, authorizationId) {
  return path.join(operationalStateRoot, "runtime-execution-leases", projectId, authorizationId);
}

function lockDirectory(operationalStateRoot, projectId, authorizationId) {
  return path.join(operationalLeaseDirectory(operationalStateRoot, projectId, authorizationId), "owner.lock");
}

function ownerFile(operationalStateRoot, projectId, authorizationId) {
  return path.join(lockDirectory(operationalStateRoot, projectId, authorizationId), "owner.json");
}

function consumptionFile(projectRoot, authorizationId) {
  return path.join(durableLeaseDirectory(projectRoot, authorizationId), "consumption.json");
}

function releaseFile(projectRoot, authorizationId) {
  return path.join(durableLeaseDirectory(projectRoot, authorizationId), "release.json");
}

function legacyProjectLockDirectory(projectRoot, authorizationId) {
  return path.join(durableLeaseDirectory(projectRoot, authorizationId), "owner.lock");
}

function verifyConfinedDurableLeaseDirectory(projectRoot, authorizationId) {
  const resolvedProject = fs.realpathSync(path.resolve(projectRoot));
  const fixedSegments = [
    path.join(resolvedProject, ".head"),
    path.join(resolvedProject, ".head", "runtime"),
    path.join(resolvedProject, ".head", "runtime", "execution-leases"),
    path.join(resolvedProject, ".head", "runtime", "execution-leases", authorizationId),
  ];
  for (const segment of fixedSegments) {
    const stat = fs.lstatSync(segment);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail("Runtime execution lease path is unsafe.", "UNSAFE_RUNTIME_EXECUTION_LEASE");
  }
  const resolvedLease = fs.realpathSync(fixedSegments.at(-1));
  if (!resolvedLease.startsWith(`${resolvedProject}${path.sep}`)) {
    fail("Runtime execution lease escaped the project root.", "UNSAFE_RUNTIME_EXECUTION_LEASE");
  }
  return resolvedLease;
}

function verifyConfinedOperationalLeaseDirectory(operationalStateRoot, projectId, authorizationId) {
  const fixedSegments = [
    path.join(operationalStateRoot, "runtime-execution-leases"),
    path.join(operationalStateRoot, "runtime-execution-leases", projectId),
    path.join(operationalStateRoot, "runtime-execution-leases", projectId, authorizationId),
  ];
  for (const segment of fixedSegments) {
    const stat = fs.lstatSync(segment);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail("Runtime operational lease path is unsafe.", "UNSAFE_RUNTIME_OPERATIONAL_STATE");
  }
  const resolvedLease = fs.realpathSync(fixedSegments.at(-1));
  if (!isWithin(operationalStateRoot, resolvedLease)) fail("Runtime operational lease escaped its host-local root.", "UNSAFE_RUNTIME_OPERATIONAL_STATE");
  return resolvedLease;
}

function atomicWriteExclusive(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, content, { encoding: "utf8", flag: "wx" });
    try { fs.linkSync(temporary, file); }
    catch (error) {
      if (error?.code === "EEXIST") fail("Runtime invocation authorization was already consumed.", "RUNTIME_INVOCATION_AUTHORIZATION_ALREADY_CONSUMED");
      throw error;
    }
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function readJson(file, label) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { fail(`${label} is invalid JSON: ${error.message}`, "INVALID_RUNTIME_EXECUTION_LEASE"); }
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

function verifyOwner(owner, { authorization, token = "" } = {}) {
  assertFields(owner, [
    "schemaVersion", "kind", "protocolVersion", "authorizationId", "projectId", "headSessionId", "scopeKind", "runId",
    "executionContractId", "runtime", "pid", "token", "ownerFenceDigest", "claimedAt", "holdDeadlineAt",
    "authority", "instructionAuthority", "promotionAuthority", "mutatesCanon",
  ], "Runtime execution lease owner");
  const claimedAt = Date.parse(owner.claimedAt);
  const deadline = Date.parse(owner.holdDeadlineAt);
  if (owner.schemaVersion !== 1 || owner.kind !== "RuntimeExecutionLeaseOwner"
    || owner.protocolVersion !== RUNTIME_EXECUTION_LEASE_VERSION
    || !/^execution-authorization-[a-f0-9]{24}$/.test(owner.authorizationId || "")
    || !/^head-[a-f0-9]{20}$/.test(owner.projectId || "")
    || !/^session-[A-Fa-f0-9-]{36}$/.test(owner.headSessionId || "")
    || !new Set(["session", "run"]).has(owner.scopeKind)
    || owner.scopeKind === "run" && (!/^run-[0-9]+-[a-f0-9]{6}$/.test(owner.runId || "")
      || !/^execution-contract-[a-f0-9]{24}$/.test(owner.executionContractId || ""))
    || owner.scopeKind === "session" && (owner.runId !== null || owner.executionContractId !== null)
    || !new Set(["codex", "opencode"]).has(owner.runtime)
    || !Number.isInteger(owner.pid) || owner.pid <= 0
    || !/^[a-f0-9]{32}$/.test(owner.token || "")
    || !/^[a-f0-9]{64}$/.test(owner.ownerFenceDigest || "")
    || Number.isNaN(claimedAt) || Number.isNaN(deadline) || deadline <= claimedAt
    || owner.authority !== "operational-single-invocation-serialization-only"
    || owner.instructionAuthority !== false || owner.promotionAuthority !== false || owner.mutatesCanon !== false) {
    fail("Runtime execution lease owner is invalid.", "INVALID_RUNTIME_EXECUTION_LEASE_OWNER");
  }
  if (authorization) {
    const expected = {
      authorizationId: authorization.authorizationId,
      projectId: authorization.projectId,
      headSessionId: authorization.headSessionId,
      scopeKind: authorization.scope.kind,
      runId: authorization.scope.runId,
      executionContractId: authorization.scope.executionContractId,
      runtime: authorization.runtime,
    };
    for (const field of Object.keys(expected)) {
      if (owner[field] !== expected[field]) fail("Runtime execution lease owner does not match the authorization.", "RUNTIME_EXECUTION_LEASE_AUTHORIZATION_MISMATCH");
    }
  }
  if (token && owner.token !== token) fail("Runtime execution lease token does not match the active owner.", "RUNTIME_EXECUTION_LEASE_TOKEN_MISMATCH");
  return owner;
}

function readOwner(operationalStateRoot, projectId, authorizationId) {
  const file = ownerFile(operationalStateRoot, projectId, authorizationId);
  if (!fs.existsSync(file)) return null;
  return verifyOwner(readJson(file, "Runtime execution lease owner"));
}

function verifySafeLockDirectory(operationalStateRoot, projectId, authorizationId) {
  const directory = lockDirectory(operationalStateRoot, projectId, authorizationId);
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("Runtime operational lease lock path is unsafe.", "UNSAFE_RUNTIME_OPERATIONAL_STATE");
  const entries = fs.readdirSync(directory).sort(compareText);
  if (entries.length !== 1 || entries[0] !== "owner.json") fail("Runtime operational lease lock contains unexpected files.", "UNSAFE_RUNTIME_OPERATIONAL_STATE");
  const resolved = fs.realpathSync(directory);
  if (!isWithin(operationalStateRoot, resolved)) fail("Runtime operational lease lock escaped its host-local root.", "UNSAFE_RUNTIME_OPERATIONAL_STATE");
  return directory;
}

function removeEmptyOperationalParents(operationalStateRoot, projectId, authorizationId) {
  const candidates = [
    operationalLeaseDirectory(operationalStateRoot, projectId, authorizationId),
    path.join(operationalStateRoot, "runtime-execution-leases", projectId),
    path.join(operationalStateRoot, "runtime-execution-leases"),
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) break;
    const stat = fs.lstatSync(candidate);
    const resolved = fs.realpathSync(candidate);
    if (!stat.isDirectory() || stat.isSymbolicLink() || !isWithin(operationalStateRoot, resolved) || resolved === operationalStateRoot) {
      fail("Runtime operational cleanup path is unsafe.", "UNSAFE_RUNTIME_OPERATIONAL_STATE");
    }
    if (fs.readdirSync(candidate).length) break;
    fs.rmdirSync(candidate);
  }
}

function removeOwnedLock(operationalStateRoot, authorization, owner) {
  const directory = verifySafeLockDirectory(operationalStateRoot, authorization.projectId, authorization.authorizationId);
  const stored = verifyOwner(readOwner(operationalStateRoot, authorization.projectId, authorization.authorizationId), { authorization, token: owner.token });
  if (stored.pid !== owner.pid || stored.ownerFenceDigest !== owner.ownerFenceDigest) {
    fail("Runtime execution lease ownership changed before release.", "RUNTIME_EXECUTION_LEASE_NOT_OWNED");
  }
  fs.unlinkSync(ownerFile(operationalStateRoot, authorization.projectId, authorization.authorizationId));
  fs.rmdirSync(directory);
  removeEmptyOperationalParents(operationalStateRoot, authorization.projectId, authorization.authorizationId);
}

function recoverDeadOwner(operationalStateRoot, authorization) {
  const directory = lockDirectory(operationalStateRoot, authorization.projectId, authorization.authorizationId);
  if (!fs.existsSync(directory)) return false;
  verifySafeLockDirectory(operationalStateRoot, authorization.projectId, authorization.authorizationId);
  const owner = verifyOwner(readOwner(operationalStateRoot, authorization.projectId, authorization.authorizationId), { authorization });
  if (processState(owner.pid) !== "absent") {
    fail("Runtime execution lease owner is active or cannot be proven absent.", "RUNTIME_EXECUTION_LEASE_BUSY");
  }
  removeOwnedLock(operationalStateRoot, authorization, owner);
  return true;
}

function acquire({ projectRoot, operationalStateRoot, authorization, ownerFenceDigest }) {
  const verified = requireAuthorizationShape(authorization);
  verifyPersistedAuthorization(projectRoot, verified);
  if (!/^[a-f0-9]{64}$/.test(ownerFenceDigest || "")) fail("Runtime execution owner fence digest is invalid.", "INVALID_RUNTIME_EXECUTION_OWNER_FENCE");
  const directory = durableLeaseDirectory(projectRoot, verified.authorizationId);
  const operationalDirectory = operationalLeaseDirectory(operationalStateRoot, verified.projectId, verified.authorizationId);
  const lock = lockDirectory(operationalStateRoot, verified.projectId, verified.authorizationId);
  fs.mkdirSync(directory, { recursive: true });
  verifyConfinedDurableLeaseDirectory(projectRoot, verified.authorizationId);
  if (fs.existsSync(legacyProjectLockDirectory(projectRoot, verified.authorizationId))) {
    fail("A legacy project-local runtime owner lock requires explicit recovery before execution.", "LEGACY_PROJECT_OPERATIONAL_STATE_REQUIRES_RECOVERY");
  }
  if (fs.existsSync(consumptionFile(projectRoot, verified.authorizationId))) {
    verifyRuntimeExecutionLeaseConsumption(readJson(consumptionFile(projectRoot, verified.authorizationId), "Runtime execution lease consumption"));
    fail("Runtime invocation authorization was already consumed.", "RUNTIME_INVOCATION_AUTHORIZATION_ALREADY_CONSUMED");
  }
  fs.mkdirSync(operationalDirectory, { recursive: true });
  verifyConfinedOperationalLeaseDirectory(operationalStateRoot, verified.projectId, verified.authorizationId);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.mkdirSync(lock);
      const claimedAt = new Date();
      const maximumHoldMs = verified.limits.timeoutMs + verified.limits.terminationGraceMs + 30_000;
      const owner = verifyOwner({
        schemaVersion: 1,
        kind: "RuntimeExecutionLeaseOwner",
        protocolVersion: RUNTIME_EXECUTION_LEASE_VERSION,
        authorizationId: verified.authorizationId,
        projectId: verified.projectId,
        headSessionId: verified.headSessionId,
        scopeKind: verified.scope.kind,
        runId: verified.scope.runId,
        executionContractId: verified.scope.executionContractId,
        runtime: verified.runtime,
        pid: process.pid,
        token: crypto.randomBytes(16).toString("hex"),
        ownerFenceDigest,
        claimedAt: claimedAt.toISOString(),
        holdDeadlineAt: new Date(claimedAt.getTime() + maximumHoldMs).toISOString(),
        authority: "operational-single-invocation-serialization-only",
        instructionAuthority: false,
        promotionAuthority: false,
        mutatesCanon: false,
      }, { authorization: verified });
      try {
        fs.writeFileSync(ownerFile(operationalStateRoot, verified.projectId, verified.authorizationId), json(owner), { encoding: "utf8", flag: "wx" });
        if (fs.existsSync(consumptionFile(projectRoot, verified.authorizationId))) {
          removeOwnedLock(operationalStateRoot, verified, owner);
          fail("Runtime invocation authorization was already consumed.", "RUNTIME_INVOCATION_AUTHORIZATION_ALREADY_CONSUMED");
        }
        return owner;
      } catch (error) {
        if (fs.existsSync(lock)) {
          try {
            const entries = fs.readdirSync(lock);
            if (!entries.length) fs.rmdirSync(lock);
          } catch {}
        }
        throw error;
      }
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (attempt === 0 && recoverDeadOwner(operationalStateRoot, verified)) {
        fs.mkdirSync(operationalDirectory, { recursive: true });
        verifyConfinedOperationalLeaseDirectory(operationalStateRoot, verified.projectId, verified.authorizationId);
        continue;
      }
      fail("Runtime execution lease is already claimed.", "RUNTIME_EXECUTION_LEASE_BUSY");
    }
  }
  fail("Runtime execution lease could not be acquired.", "RUNTIME_EXECUTION_LEASE_BUSY");
}

export function verifyRuntimeExecutionLeaseConsumption(document) {
  assertFields(document, [
    "schemaVersion", "kind", "protocolVersion", "authorizationId", "authorizationHash", "projectId",
    "headSessionId", "scopeKind", "runId", "executionContractId", "runtime", "ownerFenceDigest", "claimedAt", "consumedAt",
    "holdDeadlineAt", "singleUseBoundary", "authority", "instructionAuthority", "promotionAuthority", "mutatesCanon",
    "consumptionId", "consumptionHash",
  ], "Runtime execution lease consumption");
  assertFields(document.singleUseBoundary, [
    "authorizationConsumedBeforeInvocation", "atMostOnce", "replayAllowed", "providerInvokedAtConsumption",
    "crashRecovery",
  ], "Runtime execution lease single-use boundary");
  const claimedAt = Date.parse(document.claimedAt);
  const consumedAt = Date.parse(document.consumedAt);
  const deadline = Date.parse(document.holdDeadlineAt);
  if (document.schemaVersion !== 1 || document.kind !== "RuntimeExecutionLeaseConsumption"
    || !SUPPORTED_DURABLE_LEASE_VERSIONS.has(document.protocolVersion)
    || !/^execution-authorization-[a-f0-9]{24}$/.test(document.authorizationId || "")
    || !/^[a-f0-9]{64}$/.test(document.authorizationHash || "")
    || !/^head-[a-f0-9]{20}$/.test(document.projectId || "")
    || !/^session-[A-Fa-f0-9-]{36}$/.test(document.headSessionId || "")
    || !new Set(["session", "run"]).has(document.scopeKind)
    || document.scopeKind === "run" && (!/^run-[0-9]+-[a-f0-9]{6}$/.test(document.runId || "")
      || !/^execution-contract-[a-f0-9]{24}$/.test(document.executionContractId || ""))
    || document.scopeKind === "session" && (document.runId !== null || document.executionContractId !== null)
    || !new Set(["codex", "opencode"]).has(document.runtime)
    || !/^[a-f0-9]{64}$/.test(document.ownerFenceDigest || "")
    || Number.isNaN(claimedAt) || Number.isNaN(consumedAt) || Number.isNaN(deadline)
    || consumedAt < claimedAt || deadline <= claimedAt
    || canonicalJson(document.singleUseBoundary) !== canonicalJson({
      authorizationConsumedBeforeInvocation: true,
      atMostOnce: true,
      replayAllowed: false,
      providerInvokedAtConsumption: false,
      crashRecovery: "authorization-remains-consumed-new-head-decision-required",
    })
    || document.authority !== "operational-at-most-once-execution-evidence"
    || document.instructionAuthority !== false || document.promotionAuthority !== false || document.mutatesCanon !== false) {
    fail("Runtime execution lease consumption is invalid.", "INVALID_RUNTIME_EXECUTION_LEASE_CONSUMPTION");
  }
  verifyIdentity(document, {
    prefix: "runtime-execution-consumption",
    idKey: "consumptionId",
    hashKey: "consumptionHash",
    code: "RUNTIME_EXECUTION_LEASE_CONSUMPTION_DIGEST_MISMATCH",
  });
  return document;
}

function consume(projectRoot, authorization, owner) {
  verifyRuntimeExecutionLeaseOwnership({ projectRoot, authorization, lease: owner });
  const payload = {
    schemaVersion: 1,
    kind: "RuntimeExecutionLeaseConsumption",
    protocolVersion: RUNTIME_EXECUTION_LEASE_VERSION,
    authorizationId: authorization.authorizationId,
    authorizationHash: authorization.authorizationHash,
    projectId: authorization.projectId,
    headSessionId: authorization.headSessionId,
    scopeKind: authorization.scope.kind,
    runId: authorization.scope.runId,
    executionContractId: authorization.scope.executionContractId,
    runtime: authorization.runtime,
    ownerFenceDigest: owner.ownerFenceDigest,
    claimedAt: owner.claimedAt,
    consumedAt: new Date().toISOString(),
    holdDeadlineAt: owner.holdDeadlineAt,
    singleUseBoundary: {
      authorizationConsumedBeforeInvocation: true,
      atMostOnce: true,
      replayAllowed: false,
      providerInvokedAtConsumption: false,
      crashRecovery: "authorization-remains-consumed-new-head-decision-required",
    },
    authority: "operational-at-most-once-execution-evidence",
    instructionAuthority: false,
    promotionAuthority: false,
    mutatesCanon: false,
  };
  const receipt = verifyRuntimeExecutionLeaseConsumption(identify(
    payload,
    "runtime-execution-consumption",
    "consumptionId",
    "consumptionHash",
  ));
  atomicWriteExclusive(consumptionFile(projectRoot, authorization.authorizationId), json(receipt));
  return receipt;
}

export function verifyRuntimeExecutionLeaseRelease(document) {
  assertFields(document, [
    "schemaVersion", "kind", "protocolVersion", "authorizationId", "consumptionId", "projectId", "scopeKind", "runId",
    "executionContractId", "runtime", "operationStatus", "lifecycleReceiptId", "errorCodeDigest", "releasedAt",
    "releaseBoundary", "authority", "instructionAuthority", "promotionAuthority", "mutatesCanon", "releaseId", "releaseHash",
  ], "Runtime execution lease release");
  assertFields(document.releaseBoundary, [
    "exactOwnerLockRemoved", "authorizationRemainsConsumed", "replayAllowed", "rawErrorPersisted",
  ], "Runtime execution lease release boundary");
  const statuses = new Set(["completed", "failed", "cancelled", "timed-out", "output-limited", "invalid-event", "threw"]);
  if (document.schemaVersion !== 1 || document.kind !== "RuntimeExecutionLeaseRelease"
    || !SUPPORTED_DURABLE_LEASE_VERSIONS.has(document.protocolVersion)
    || !/^execution-authorization-[a-f0-9]{24}$/.test(document.authorizationId || "")
    || !/^runtime-execution-consumption-[a-f0-9]{24}$/.test(document.consumptionId || "")
    || !/^head-[a-f0-9]{20}$/.test(document.projectId || "")
    || !new Set(["session", "run"]).has(document.scopeKind)
    || document.scopeKind === "run" && (!/^run-[0-9]+-[a-f0-9]{6}$/.test(document.runId || "")
      || !/^execution-contract-[a-f0-9]{24}$/.test(document.executionContractId || ""))
    || document.scopeKind === "session" && (document.runId !== null || document.executionContractId !== null)
    || !new Set(["codex", "opencode"]).has(document.runtime)
    || !statuses.has(document.operationStatus)
    || document.lifecycleReceiptId !== null && !/^runtime-lifecycle-receipt-[a-f0-9]{24}$/.test(document.lifecycleReceiptId || "")
    || document.errorCodeDigest !== null && !/^[a-f0-9]{64}$/.test(document.errorCodeDigest || "")
    || Number.isNaN(Date.parse(document.releasedAt))
    || canonicalJson(document.releaseBoundary) !== canonicalJson({
      exactOwnerLockRemoved: true,
      authorizationRemainsConsumed: true,
      replayAllowed: false,
      rawErrorPersisted: false,
    })
    || document.authority !== "operational-at-most-once-release-evidence"
    || document.instructionAuthority !== false || document.promotionAuthority !== false || document.mutatesCanon !== false) {
    fail("Runtime execution lease release is invalid.", "INVALID_RUNTIME_EXECUTION_LEASE_RELEASE");
  }
  verifyIdentity(document, {
    prefix: "runtime-execution-release",
    idKey: "releaseId",
    hashKey: "releaseHash",
    code: "RUNTIME_EXECUTION_LEASE_RELEASE_DIGEST_MISMATCH",
  });
  return document;
}

function recordRelease({ projectRoot, authorization, consumption, operationStatus, lifecycleReceiptId = null, errorCode = "" }) {
  const payload = {
    schemaVersion: 1,
    kind: "RuntimeExecutionLeaseRelease",
    protocolVersion: RUNTIME_EXECUTION_LEASE_VERSION,
    authorizationId: authorization.authorizationId,
    consumptionId: consumption.consumptionId,
    projectId: authorization.projectId,
    scopeKind: authorization.scope.kind,
    runId: authorization.scope.runId,
    executionContractId: authorization.scope.executionContractId,
    runtime: authorization.runtime,
    operationStatus,
    lifecycleReceiptId,
    errorCodeDigest: errorCode ? digest(errorCode) : null,
    releasedAt: new Date().toISOString(),
    releaseBoundary: {
      exactOwnerLockRemoved: true,
      authorizationRemainsConsumed: true,
      replayAllowed: false,
      rawErrorPersisted: false,
    },
    authority: "operational-at-most-once-release-evidence",
    instructionAuthority: false,
    promotionAuthority: false,
    mutatesCanon: false,
  };
  const receipt = verifyRuntimeExecutionLeaseRelease(identify(
    payload,
    "runtime-execution-release",
    "releaseId",
    "releaseHash",
  ));
  atomicWriteExclusive(releaseFile(projectRoot, authorization.authorizationId), json(receipt));
  return receipt;
}

export function verifyRuntimeExecutionLeaseOwnership({ projectRoot, operationalStateRoot = null, authorization, lease, consumption = null }) {
  const verified = requireAuthorizationShape(authorization);
  const operationalRoot = operationalStateRoot || resolveRuntimeOperationalStateRoot({ projectRoot, create: false });
  const owner = verifyOwner(lease, { authorization: verified, token: lease?.token || "" });
  if (owner.pid !== process.pid) fail("Runtime execution lease is not owned by this process.", "RUNTIME_EXECUTION_LEASE_NOT_OWNED");
  verifySafeLockDirectory(operationalRoot, verified.projectId, verified.authorizationId);
  const stored = verifyOwner(readOwner(operationalRoot, verified.projectId, verified.authorizationId), { authorization: verified, token: owner.token });
  if (stored.pid !== owner.pid || stored.ownerFenceDigest !== owner.ownerFenceDigest) {
    fail("Runtime execution lease stored owner does not match this process.", "RUNTIME_EXECUTION_LEASE_NOT_OWNED");
  }
  if (consumption) {
    const verifiedConsumption = verifyRuntimeExecutionLeaseConsumption(consumption);
    if (verifiedConsumption.authorizationId !== verified.authorizationId
      || verifiedConsumption.authorizationHash !== verified.authorizationHash
      || verifiedConsumption.ownerFenceDigest !== owner.ownerFenceDigest) {
      fail("Runtime execution lease consumption does not match the active owner.", "RUNTIME_EXECUTION_LEASE_CONSUMPTION_MISMATCH");
    }
    const persisted = verifyRuntimeExecutionLeaseConsumption(readJson(
      consumptionFile(projectRoot, verified.authorizationId),
      "Runtime execution lease consumption",
    ));
    if (persisted.consumptionHash !== verifiedConsumption.consumptionHash) {
      fail("Runtime execution lease consumption differs from the durable record.", "RUNTIME_EXECUTION_LEASE_CONSUMPTION_MISMATCH");
    }
  }
  return { owner, consumption };
}

export async function withRuntimeExecutionLease({ projectRoot, authorization, ownerFenceDigest }, operation) {
  if (typeof operation !== "function") fail("Runtime execution lease requires an operation.", "INVALID_RUNTIME_EXECUTION_LEASE_OPERATION");
  const verified = requireAuthorizationShape(authorization);
  const operationalStateRoot = resolveRuntimeOperationalStateRoot({ projectRoot, create: true });
  const owner = acquire({ projectRoot, operationalStateRoot, authorization: verified, ownerFenceDigest });
  let consumption;
  let result;
  let operationError;
  try {
    consumption = consume(projectRoot, verified, owner);
    result = await operation({ lease: owner, consumption, operationalStateRoot });
  } catch (error) {
    operationError = error;
  }
  try {
    removeOwnedLock(operationalStateRoot, verified, owner);
  } catch (releaseError) {
    if (operationError) releaseError.cause = operationError;
    throw releaseError;
  }
  if (!consumption) {
    if (operationError) throw operationError;
    fail("Runtime execution lease ended without a durable consumption receipt.", "RUNTIME_EXECUTION_LEASE_CONSUMPTION_MISSING");
  }
  let release;
  try {
    const lifecycleStatus = result?.receipt?.status;
    const operationStatus = operationError ? "threw"
      : new Set(["completed", "failed", "cancelled", "timed-out", "output-limited", "invalid-event"]).has(lifecycleStatus)
        ? lifecycleStatus : "completed";
    release = recordRelease({
      projectRoot,
      authorization: verified,
      consumption,
      operationStatus,
      lifecycleReceiptId: result?.receipt?.receiptId || null,
      errorCode: operationError?.code || "",
    });
  } catch (releaseError) {
    if (operationError) releaseError.cause = operationError;
    throw releaseError;
  }
  if (operationError) throw operationError;
  return { result, consumption, release };
}

export function inspectRuntimeExecutionLease({ projectRoot, projectId, authorizationId }) {
  if (!/^head-[a-f0-9]{20}$/.test(projectId || "")
    || !/^execution-authorization-[a-f0-9]{24}$/.test(authorizationId || "")) {
    fail("Runtime execution lease inspection input is invalid.", "INVALID_RUNTIME_EXECUTION_LEASE_INSPECTION");
  }
  const operationalStateRoot = resolveRuntimeOperationalStateRoot({ projectRoot, create: false });
  const directory = durableLeaseDirectory(projectRoot, authorizationId);
  const durableStateExists = fs.existsSync(directory);
  if (durableStateExists) {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail("Runtime execution lease path is unsafe.", "UNSAFE_RUNTIME_EXECUTION_LEASE");
    verifyConfinedDurableLeaseDirectory(projectRoot, authorizationId);
    if (fs.existsSync(legacyProjectLockDirectory(projectRoot, authorizationId))) {
      fail("A legacy project-local runtime owner lock requires explicit recovery before lease inspection.", "LEGACY_PROJECT_OPERATIONAL_STATE_REQUIRES_RECOVERY");
    }
  }
  const consumptionPath = consumptionFile(projectRoot, authorizationId);
  const releasePath = releaseFile(projectRoot, authorizationId);
  const operationalDirectory = operationalLeaseDirectory(operationalStateRoot, projectId, authorizationId);
  const lockPath = lockDirectory(operationalStateRoot, projectId, authorizationId);
  if (fs.existsSync(operationalDirectory)) verifyConfinedOperationalLeaseDirectory(operationalStateRoot, projectId, authorizationId);
  const consumption = durableStateExists && fs.existsSync(consumptionPath)
    ? verifyRuntimeExecutionLeaseConsumption(readJson(consumptionPath, "Runtime execution lease consumption")) : null;
  const release = durableStateExists && fs.existsSync(releasePath)
    ? verifyRuntimeExecutionLeaseRelease(readJson(releasePath, "Runtime execution lease release")) : null;
  let ownerStatus = "none";
  let holdDeadlineExceeded = false;
  if (fs.existsSync(lockPath)) {
    verifySafeLockDirectory(operationalStateRoot, projectId, authorizationId);
    const owner = verifyOwner(readOwner(operationalStateRoot, projectId, authorizationId));
    if (owner.projectId !== projectId || owner.authorizationId !== authorizationId) {
      fail("Runtime execution lease belongs to another project or authorization.", "RUNTIME_EXECUTION_LEASE_PROJECT_MISMATCH");
    }
    const state = processState(owner.pid);
    ownerStatus = state === "alive" ? "active" : "stale-or-unknown";
    holdDeadlineExceeded = Date.now() > Date.parse(owner.holdDeadlineAt);
  }
  if (consumption && (consumption.projectId !== projectId || consumption.authorizationId !== authorizationId)) {
    fail("Runtime execution lease consumption belongs to another project.", "RUNTIME_EXECUTION_LEASE_PROJECT_MISMATCH");
  }
  if (release && (!consumption || release.projectId !== projectId || release.authorizationId !== authorizationId
    || release.consumptionId !== consumption.consumptionId)) {
    fail("Runtime execution lease release does not match its consumption.", "RUNTIME_EXECUTION_LEASE_RELEASE_MISMATCH");
  }
  if (release && ownerStatus !== "none") fail("Released runtime execution lease still has an owner lock.", "INVALID_RUNTIME_EXECUTION_LEASE_STATE");
  const status = release ? "consumed-released"
    : consumption && ownerStatus !== "none" ? "consumed-active"
      : consumption ? "consumed-incomplete"
        : ownerStatus !== "none" ? "claimed" : "available";
  return {
    status,
    authorizationId,
    singleUseConsumed: Boolean(consumption),
    replayAllowed: !consumption,
    ownerStatus,
    holdDeadlineExceeded,
    operationalState: {
      protocolVersion: RUNTIME_OPERATIONAL_STATE_VERSION,
      location: "host-local-outside-project",
      pathExposed: false,
      pidPersistedInProject: false,
      tokenPersistedInProject: false,
      ownerLockPersistedInProject: false,
    },
    consumption: consumption ? {
      consumptionId: consumption.consumptionId,
      consumedAt: consumption.consumedAt,
      atMostOnce: consumption.singleUseBoundary.atMostOnce,
      crashRecovery: consumption.singleUseBoundary.crashRecovery,
    } : null,
    release: release ? {
      releaseId: release.releaseId,
      releasedAt: release.releasedAt,
      operationStatus: release.operationStatus,
      lifecycleReceiptId: release.lifecycleReceiptId,
      exactOwnerLockRemoved: release.releaseBoundary.exactOwnerLockRemoved,
    } : null,
  };
}
