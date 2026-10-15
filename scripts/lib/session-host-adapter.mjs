import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { atomicWriteArtifact } from "./artifact-storage.mjs";
import { withProjectMutation } from "./project-mutation-lock.mjs";
import { resolveRuntimeOperationalStateRoot } from "./runtime-execution-lease.mjs";
import { createSessionCallContext, safeSessionPath, withSessionCallContext, sessionSelectionUnresolved } from "./session-routing.mjs";
import { enterConversationRecovery } from "./compaction-lifecycle.mjs";

export const SESSION_HOST_ADAPTER_VERSION = "0.1.0";
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const encode = (value) => JSON.stringify(value);
function fail(message, code = "INVALID_SESSION_HOST_INPUT") { throw Object.assign(new Error(message), { code }); }
function required(value) { return typeof value === "string" && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f]/.test(value); }
function project(root) {
  const base = fs.realpathSync(path.resolve(root));
  const record = JSON.parse(fs.readFileSync(safeSessionPath(base, ".head", "project.json"), "utf8"));
  if (record.schemaVersion !== 1 || record.projectRoot !== base || !/^head-[a-f0-9]{20}$/.test(record.projectId || "")) fail("Project identity differs.", "PROJECT_IDENTITY_MISMATCH");
  return { root: base, projectId: record.projectId };
}

// Trusted Host composition API, deliberately NOT a public MCP native-ID input.
// The embedding Host must obtain the actual per-request caller. Stock Codex
// Pre/PostToolUse parent session_id alone cannot do that for child agents.
export function createSessionHostAdapter({ runtime, nativeSessionId, agentId = null, environment = process.env,
  platform = process.platform, homeDirectory } = {}) {
  if (!["codex", "claude", "opencode"].includes(runtime) || !required(nativeSessionId) || agentId !== null && !required(agentId)) fail("A verified runtime/caller identity is required.");
  const callerDigest = sha(encode([runtime, nativeSessionId, agentId]));
  const locallyUnconfirmed = new Set();
  function location(owner, create = false) {
    const operationalRoot = resolveRuntimeOperationalStateRoot({ projectRoot: owner.root, environment, platform, homeDirectory, create });
    const parts = ["session-bindings", sha(encode([owner.projectId, owner.root, callerDigest]))];
    let current = operationalRoot;
    for (const part of parts) {
      current = path.join(current, part);
      if (fs.existsSync(current)) {
        const stat = fs.lstatSync(current);
        if (!stat.isDirectory() || stat.isSymbolicLink()) fail("Unsafe Host binding directory.", "UNSAFE_SESSION_HOST_BINDING");
      }
    }
    const file = path.join(current, "binding.json");
    if (fs.existsSync(file)) {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) fail("Unsafe Host binding file.", "UNSAFE_SESSION_HOST_BINDING");
    }
    if (create) fs.mkdirSync(current, { recursive: true });
    return file;
  }
  function readOwner(owner) {
    const file = location(owner);
    if (!fs.existsSync(file)) return { status: "absent", revision: 0, authorityPlane: "P5", retained: false };
    const record = JSON.parse(fs.readFileSync(file, "utf8"));
    const { bindingDigest, ...payload } = record;
    const fields = ["kind", "version", "authorityPlane", "projectId", "callerDigest", "status", "sessionId", "revision",
      "previousDigest", "recoveryAuthority", "instructionAuthority", "bindingDigest"];
    if (Object.keys(record).length !== fields.length || Object.keys(record).some((key) => !fields.includes(key))
      || record.kind !== "HostSessionBinding" || record.version !== SESSION_HOST_ADAPTER_VERSION || record.authorityPlane !== "P5"
      || record.projectId !== owner.projectId || record.callerDigest !== callerDigest || !["bound", "default", "pending", "lost"].includes(record.status)
      || record.recoveryAuthority !== false || record.instructionAuthority !== false
      || !Number.isSafeInteger(record.revision) || record.revision < 1 || bindingDigest !== sha(encode(payload))
      || record.status === "lost" && record.sessionId !== null
      || record.status !== "lost" && !/^session-[A-Fa-f0-9-]{36}$/.test(record.sessionId || "")
      || record.previousDigest !== null && !/^[a-f0-9]{64}$/.test(record.previousDigest)) {
      fail("Host binding is corrupt or belongs to another caller/Project.", "SESSION_HOST_BINDING_INTEGRITY");
    }
    return record;
  }
  const write = (owner, payload) => {
    const record = { ...payload, bindingDigest: sha(encode(payload)) };
    const file = location(owner, true);
    location(owner); // recheck newly created namespace before atomic publication
    atomicWriteArtifact(file, encode(record) + "\n");
    return record;
  };
  function selection({ root = ".", sessionId = undefined, expectedRevision, lost = false } = {}) {
    const owner = project(root);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !lost && sessionId === undefined) fail("Explicit selection needs its observed binding revision.");
    // Validate the declared canonical selection before P5 publication; provider
    // handles, names and timestamps never select a logical Session.
    const selected = lost ? null : createSessionCallContext().select(owner.root, sessionId);
    try {
      const binding = withProjectMutation({ root: owner.root, scope: "host-session-binding" }, () => {
        if (project(owner.root).projectId !== owner.projectId) fail("Project changed before Host selection.", "PROJECT_IDENTITY_MISMATCH");
        const before = readOwner(owner);
        const targetStatus = lost ? "lost" : selected.status;
        if (before.status === targetStatus && before.sessionId === (selected?.sessionId || null)
          && [before.revision, before.revision - 1].includes(expectedRevision)) return before;
        const interrupted = before.status === "pending" && before.sessionId === selected?.sessionId
          && expectedRevision === before.revision - 1;
        if (!interrupted && before.revision !== expectedRevision) fail("Host selection changed; reconcile only this selection.", "SESSION_HOST_BINDING_CONFLICT");
        const payload = {
          kind: "HostSessionBinding", version: SESSION_HOST_ADAPTER_VERSION, authorityPlane: "P5",
          projectId: owner.projectId, callerDigest, status: targetStatus, sessionId: selected?.sessionId || null,
          revision: interrupted ? before.revision : before.revision + 1,
          previousDigest: interrupted ? before.previousDigest : before.bindingDigest || null,
          recoveryAuthority: false, instructionAuthority: false,
        };
        // Only a declared selection change gets this pending P5 state. A crash
        // between intent and commit leaves known loss, never the old/default
        // route. Retrying performs persistence only, never a task/tool effect.
        if (!lost && !interrupted) write(owner, { ...payload, status: "pending" });
        return write(owner, payload);
      });
      locallyUnconfirmed.delete(owner.root);
      return { status: "host_selection_retained", projectId: owner.projectId, sessionId: binding.sessionId,
        binding, retained: true, persisted: true, recoveryAuthority: false, executionReplayAllowed: false };
    } catch (error) {
      locallyUnconfirmed.add(owner.root);
      return { status: "host_selection_not_retained", projectId: owner.projectId, sessionId: selected?.sessionId || null,
        retained: false, persisted: "unconfirmed", reasonCode: error.code || "HOST_BINDING_STORAGE_ERROR",
        currentExplicitRequestsAllowed: true, ordinaryWorkBlocked: false, executionReplayAllowed: false,
        nextHeadAction: "Keep the current explicit request result. Repair only optional Host linkage; do not repeat completed effects. Across restart, only the last durably confirmed state or pending loss can be known." };
    }
  }
  function contextFor(projectRoot) {
    const owner = project(projectRoot), context = createSessionCallContext();
    if (locallyUnconfirmed.has(owner.root)) { context.lose(owner.root); return context; }
    const binding = readOwner(owner);
    if (["bound", "default"].includes(binding.status)) context.select(owner.root, binding.sessionId);
    else context.lose(owner.root);
    return context;
  }
  return Object.freeze({
    describe: () => ({ adapterKey: "head.session-host", version: SESSION_HOST_ADAPTER_VERSION, authorityPlane: "P5",
      nativeIdentitySource: "trusted-embedding-host-per-request-caller", providerIdentityInCanon: false,
      recoveryAuthority: false, instructionAuthority: false, stockMcpNativeIdentityAssumed: false }),
    read({ root = "." } = {}) { return readOwner(project(root)); },
    select: (options) => selection(options),
    lose: (options) => selection({ ...options, lost: true }),
    resolveSessionContext(request) {
      const outer = request?.params?.arguments;
      const args = ["head_tools_read", "head_tools_call"].includes(request?.params?.name) ? outer?.arguments : outer;
      if (!args?.project_root) fail("Expected an exact Project-scoped MCP request.");
      return contextFor(args.project_root);
    },
    enter({ root = "." } = {}) {
      try {
        const context = contextFor(root);
        return withSessionCallContext({ root, context }, () => enterConversationRecovery({ root }));
      } catch (error) {
        // Same narrow Project-only path as MCP; no default Session is inspected
        // and then hidden. A damaged common original remains an error.
        return sessionSelectionUnresolved(root, { includeProjectFacts: true, reasonCode: error.code || "HOST_BINDING_UNAVAILABLE" });
      }
    },
  });
}
