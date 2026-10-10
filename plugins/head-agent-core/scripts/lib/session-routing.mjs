import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { withProjectMutation } from "./project-mutation-lock.mjs";
import { atomicCreateArtifact } from "./artifact-storage.mjs";
import { noteProjectGraphChange } from "./discovery-index.mjs";
export { readProjectDirection, updateProjectDirection } from "./project-direction.mjs";

// Routing is request-local Host selection, never a persisted global selector.
const routes = new AsyncLocalStorage();
const fail = (message, code) => { throw Object.assign(new Error(message), { code }); };
const canonicalRoot = (root) => fs.realpathSync(path.resolve(root || "."));
const validId = (id) => typeof id === "string" && /^session-[a-fA-F0-9-]{36}$/.test(id);

export function safeSessionPath(root, ...parts) {
  const base = canonicalRoot(root);
  const file = path.resolve(base, ...parts);
  const relative = path.relative(base, file);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail("Session path escapes Project root.", "SESSION_PATH_ESCAPE");
  let current = base;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) fail("Session path traverses a symlink.", "SESSION_PATH_ESCAPE");
  }
  return file;
}

function read(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { fail(`Session record cannot be read: ${error.message}`, "INVALID_SESSION_CANON"); }
}

export function defaultSessionStatePath(root) { return safeSessionPath(root, ".head", "sessions", "current.json"); }

export function assertRunSession(root, run, state) {
  // Historical Runs predate the explicit owner field; their original default
  // Session can still read/finish them, but a new Session cannot adopt them.
  const owner = run.sessionId || read(defaultSessionStatePath(root)).sessionId;
  if (owner !== state.sessionId) fail("Run belongs to another logical HEAD Session.", "RUN_SESSION_MISMATCH");
}

function selectedRoute(root) { return routes.getStore()?.get(canonicalRoot(root)) || null; }
function selectedId(root) { return selectedRoute(root)?.sessionId || null; }

export function sessionStatePath(root) {
  const route = selectedRoute(root);
  const defaultFile = defaultSessionStatePath(root);
  if (!route) return defaultFile;
  const file = safeSessionPath(root, path.relative(canonicalRoot(root), route.stateFile));
  const state = read(file);
  const project = read(safeSessionPath(root, ".head", "project.json"));
  if (state.sessionId !== route.sessionId || project.projectId !== route.projectId
    || state.projectId && state.projectId !== route.projectId) fail("Selected logical Session identity changed during the request.", "HEAD_SESSION_IDENTITY_MISMATCH");
  return file;
}

// Immutable, content-addressed checkpoints/runs remain shared and identity-bound.
// Mutable epoch pointers and operational progress belong to the selected Session.
export function sessionDataPath(root, ...parts) {
  const state = sessionStatePath(root);
  return state === defaultSessionStatePath(root)
    ? safeSessionPath(root, ".head", "sessions", ...parts)
    : safeSessionPath(root, ".head", "sessions", "by-id", selectedId(root), ...parts);
}

export function withSessionRoute(root, sessionId, operation) {
  const base = canonicalRoot(root);
  if (sessionId == null || sessionId === "") return operation();
  if (!validId(sessionId)) fail("Expected a logical HEAD Session id.", "INVALID_HEAD_SESSION_ID");
  const defaultState = read(defaultSessionStatePath(base));
  const file = defaultState.sessionId === sessionId ? defaultSessionStatePath(base)
    : safeSessionPath(base, ".head", "sessions", "by-id", sessionId, "current.json");
  if (!fs.existsSync(file)) fail("Logical HEAD Session does not exist.", "HEAD_SESSION_NOT_FOUND");
  const state = read(file);
  const project = read(safeSessionPath(base, ".head", "project.json"));
  if (state.sessionId !== sessionId || state.projectId && state.projectId !== project.projectId) fail("Session identity does not match this Project.", "HEAD_SESSION_IDENTITY_MISMATCH");
  const active = new Map(routes.getStore() || []);
  active.set(base, { sessionId, stateFile: file, projectId: project.projectId });
  return routes.run(active, operation);
}

export function createHeadSession({ root = ".", sessionId = `session-${crypto.randomUUID()}`, purpose = "" } = {}) {
  if (!validId(sessionId) || typeof purpose !== "string") fail("Invalid logical Session input.", "INVALID_HEAD_SESSION_INPUT");
  const base = canonicalRoot(root);
  return withProjectMutation({ root: base, scope: "head-session-create" }, () => {
    const project = read(safeSessionPath(base, ".head", "project.json"));
    if (project.projectRoot !== base) fail("Project root identity differs.", "PROJECT_IDENTITY_MISMATCH");
    const defaultState = read(defaultSessionStatePath(base));
    const file = defaultState.sessionId === sessionId ? defaultSessionStatePath(base)
      : safeSessionPath(base, ".head", "sessions", "by-id", sessionId, "current.json");
    if (fs.existsSync(file)) {
      const state = read(file);
      if (state.sessionId !== sessionId || state.projectId && state.projectId !== project.projectId || purpose && state.purpose !== purpose) fail("Session create retry differs from its existing identity or purpose.", "HEAD_SESSION_CREATE_CONFLICT");
      return { status: "existing", projectId: project.projectId, sessionId, state };
    }
    const state = { schemaVersion: 1, projectId: project.projectId, sessionId, purpose,
      mode: "session", currentWholePlanId: null, activeRunId: null, activeExecutionContractId: null,
      lastResultPacketId: null, pendingReview: null, lastReviewDecisionId: null,
      requiredPlanAction: null, latestCheckpoint: null, updatedAt: new Date().toISOString() };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    safeSessionPath(base, path.relative(base, file));
    atomicCreateArtifact(file, `${JSON.stringify(state, null, 2)}\n`);
    noteProjectGraphChange(base);
    return { status: "created", projectId: project.projectId, sessionId, state };
  });
}

export function listHeadSessions({ root = "." } = {}) {
  const base = canonicalRoot(root);
  const project = read(safeSessionPath(base, ".head", "project.json"));
  if (project.projectRoot !== base) fail("Project root identity differs.", "PROJECT_IDENTITY_MISMATCH");
  const defaultState = read(defaultSessionStatePath(base));
  const sessions = [{ sessionId: defaultState.sessionId, purpose: defaultState.purpose || "", default: true, state: defaultState }];
  const directory = safeSessionPath(base, ".head", "sessions", "by-id");
  if (fs.existsSync(directory)) for (const id of fs.readdirSync(directory).sort()) {
    if (!validId(id)) fail("Unexpected entry in logical Sessions.", "INVALID_HEAD_SESSION_ID");
    const state = read(safeSessionPath(base, ".head", "sessions", "by-id", id, "current.json"));
    if (state.sessionId !== id || state.projectId !== project.projectId) fail("Session belongs to another Project.", "HEAD_SESSION_IDENTITY_MISMATCH");
    sessions.push({ sessionId: id, purpose: state.purpose || "", default: false, state });
  }
  return { projectId: project.projectId, defaultSessionId: defaultState.sessionId, sessions };
}
