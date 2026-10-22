import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createNativeObservationStore, nativeId, projectNativeObservations, appendNativeStatus } from "./lib/native-session-observations.mjs";
import { createSessionHostAdapter } from "./lib/session-host-adapter.mjs";
import { startupProjection, MAX_CONTEXT_CHARACTERS } from "./lib/session-host-context-projection.mjs";

// Dependency-free OpenCode V1 server entry, source-shaped against v1.19.0.
// No client creation, daemon, auth/config edits or canonical HEAD mutation.
const sanitize = name => name.replace(/[^a-zA-Z0-9_-]/gu, "_");
const packagedServer = fileURLToPath(new URL("./mcp-server.mjs", import.meta.url));
const portableOpenCodeScript = "{env:LODE_PLUGIN_ROOT}/scripts/mcp-server.mjs";
const real = p => fs.realpathSync(path.resolve(p));
const samePath = (a, b) => real(a) === real(b);
const supportedEvents = new Map([["session.created", "start-observed"], ["session.status", "status-observed"],
  ["session.idle", "idle-observed"], ["session.deleted", "caller-deleted-observed"], ["session.error", "error-observed"]]);
const object = x => x !== null && typeof x === "object" && !Array.isArray(x);
async function bounded(call) {
  const controller = new AbortController(); let timer;
  try {
    const result = await Promise.race([call(controller.signal), new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("Optional native lookup timed out.")); }, 750);
    })]);
    if (!object(result) || result.error || Buffer.byteLength(JSON.stringify(result.data)) > 64 * 1024) return null;
    return result.data;
  } catch { return null; } finally { clearTimeout(timer); }
}
export default {
  id: "head-agent-native-observations",
  async server({ client, project, directory }, { environment = process.env } = {}) {
    let aliases = new Map(), disposed = false, pending = 0, queue = Promise.resolve();
    let contextSupported = true, deliveries = new WeakMap();
    const store = createNativeObservationStore({ environment });
    const caller = id => ({ runtime: "opencode", nativeSessionId: id, agentId: null });
    function sessionScope(session, id) {
      try {
        return !disposed && nativeId(id) && nativeId(project?.id) && session?.id === id && session.projectID === project.id
          && typeof session.directory === "string" && session.directory.length <= 32768 && samePath(session.directory, directory);
      } catch { return false; }
    }
    async function exactSession(id) {
      if (disposed || !nativeId(id) || !nativeId(project?.id) || typeof directory !== "string") return null;
      const session = await bounded(signal => client.session.get({ path: { id }, query: { directory }, signal }));
      return sessionScope(session, id) ? session : null;
    }
    function enqueue(operation) {
      if (disposed || pending >= 64) return Promise.resolve();
      pending++;
      const work = queue.then(() => disposed ? undefined : operation()).catch(() => {}).finally(() => { pending--; });
      queue = work; return work;
    }
    return {
      async config(config) {
        aliases = new Map();
        contextSupported = config?.experimental?.code_mode !== true;
        if (disposed || config?.experimental?.code_mode === true) return;
        const entries = Object.entries(config?.mcp || {}), counts = new Map();
        for (const [name] of entries) counts.set(sanitize(name), (counts.get(sanitize(name)) || 0) + 1);
        for (const [name, item] of entries) {
          // Only this packaged local server command, not a matching suffix or
          // a remote server calling itself HEAD. Sanitized collisions skip both.
          if (counts.get(sanitize(name)) !== 1 || item?.type !== "local" || item.enabled === false
            || !Array.isArray(item.command) || item.command.length !== 2 || typeof item.command[0] !== "string"
            || !/^(node|node\.exe)$/iu.test(path.basename(item.command[0])) || typeof item.command[1] !== "string") continue;
          try {
            // Shared opencode.json keeps a host placeholder. Resolve it only in
            // this process so the spawned server is this package and the file
            // the user can commit does not gain a machine path.
            if (item.command[1] === portableOpenCodeScript) item.command = ["node", packagedServer];
            if (!samePath(path.resolve(directory, item.command[1]), packagedServer)) continue;
            for (const tool of ["head_project_status", "head_tools_read", "head_tools_call"]) aliases.set(sanitize(name) + "_" + tool, tool);
          } catch { /* Unsupported config shape is not a user setup gate. */ }
        }
      },
      async "experimental.chat.system.transform"(input, output) {
        try {
          const system = output?.system;
          if (!Array.isArray(system) || !system.every(text => typeof text === "string")
            || !Object.isExtensible(system) || !Object.getOwnPropertyDescriptor(system, "length")?.writable) return;
          const previous = deliveries.get(system);
          const ownsSlot = previous && previous.index !== null && system[previous.index] === previous.text
            && Object.getOwnPropertyDescriptor(system, String(previous.index))?.writable;
          // Only our own slot may be refreshed. Other plugins' strings/order and
          // the caller's array stay intact. No last-Session or basis cache.
          const delivery = { index: ownsSlot ? previous.index : null, text: "" };
          deliveries.set(system, delivery);
          if (ownsSlot) system[delivery.index] = "";
          if (disposed || !contextSupported || !nativeId(input?.sessionID)) return;
          const session = await exactSession(input.sessionID);
          if (!session || disposed || !contextSupported || deliveries.get(system) !== delivery) return;
          if (![".head", ".lode"].some(name => fs.existsSync(path.join(directory, name, "project.json")))) return;
          let text;
          try {
            const adapter = createSessionHostAdapter({ runtime: "opencode", nativeSessionId: session.id, environment });
            text = startupProjection(adapter.enter({ root: directory }), directory, "opencode");
            if (text.length > MAX_CONTEXT_CHARACTERS.opencode) throw new Error("Context exceeds its delivery bound.");
          } catch (error) {
            const code = typeof error?.code === "string" && /^[A-Z0-9_]{1,128}$/.test(error.code)
              ? error.code : "HOST_CONTEXT_UNAVAILABLE";
            text = "Lode optional request context unavailable (" + code + "). Continue independent work; no default Session was substituted or recovery state written.";
          }
          if (disposed || !contextSupported || output.system !== system || deliveries.get(system) !== delivery
            || !sessionScope(session, input.sessionID)) return;
          if (delivery.index === null) {
            delivery.index = system.length;
            Array.prototype.push.call(system, text);
          } else {
            const descriptor = Object.getOwnPropertyDescriptor(system, String(delivery.index));
            if (!descriptor?.writable || system[delivery.index] !== delivery.text) return;
            system[delivery.index] = text;
          }
          delivery.text = text;
        } catch { /* Unsupported optional delivery never blocks the Host request. */ }
      },
      async event({ event }) {
        if (!supportedEvents.has(event?.type) || !nativeId(event.id)) return;
        const eventType = event.type, eventId = event.id;
        const id = event.properties?.sessionID || event.properties?.info?.id;
        if (!nativeId(id)) return;
        // Deletion is delivered after the upstream record may have disappeared.
        // Capture only the actually delivered scope scalars, not its free-form
        // title/body. A missing get/status entry is never deletion evidence.
        const info = event.properties?.info;
        const deletedInfo = eventType === "session.deleted" && object(info)
          ? { id: info.id, projectID: info.projectID, directory: info.directory } : null;
        if (eventType === "session.deleted" && (!sessionScope(deletedInfo, id)
          || Object.hasOwn(event.properties, "sessionID") && event.properties.sessionID !== deletedInfo.id)) return;
        // Keep queued input allowlisted, not an entire message/status/error body.
        const status = ["busy", "retry", "idle"].includes(event.properties?.status?.type) ? event.properties.status.type : null;
        return enqueue(async () => {
          if (eventType === "session.deleted" ? !sessionScope(deletedInfo, id) : !await exactSession(id)) return;
          const observation = { kind: "event", event: eventType, phase: supportedEvents.get(eventType),
            requestId: null, source: null, reason: null, ...(status ? { nativeStatus: status } : {}) };
          await store.observe({ root: directory, caller: caller(id), observation, eventId });
        });
      },
      async "tool.execute.after"(input, output) {
        try {
          const tool = aliases.get(input?.tool), routed = ["head_tools_read", "head_tools_call"].includes(tool);
          const name = routed ? input.args?.name : tool, args = routed ? input.args?.arguments : input?.args;
          if (disposed || name !== "head_project_status" || !nativeId(input.sessionID) || !nativeId(input.callID)
            || !object(args) || typeof args.project_root !== "string" || !samePath(args.project_root, directory)
            || !object(output) || output.isError || !object(output.structuredContent) || !Array.isArray(output.content)
            || !Object.isExtensible(output) || !["content", "structuredContent"].every(key => {
              const d = Object.getOwnPropertyDescriptor(output, key); return d?.writable === true && !d.get && !d.set;
            })) return;
          if (!await exactSession(input.sessionID)) return;
          const projection = await projectNativeObservations({ root: directory, caller: caller(input.sessionID), environment })
            || { authorityPlane: "P5", scope: "native-caller-not-logical-session-execution", caller: caller(input.sessionID),
              observations: [], omitted: 0, persisted: false, recoveryAuthority: false, instructionAuthority: false };
          // One supplied map, O(A) payload, not an exact-ID status API. Absence
          // means no non-idle entry was returned, not native/process/work end.
          const map = await bounded(signal => client.session.status({ query: { directory }, signal }));
          const state = object(map) && Object.hasOwn(map, input.sessionID) ? map[input.sessionID]?.type : null;
          projection.currentObservation = { state: ["busy", "retry", "idle"].includes(state) ? state
            : object(map) && !Object.hasOwn(map, input.sessionID) ? "no-non-idle-entry" : "unknown",
          checkedAt: new Date().toISOString(), scope: "supplied-opencode-session-at-check-not-task-state" };
          const next = appendNativeStatus(output, projection);
          if (next === output) return;
          // The real Host ignores callback return values. Commit the two prepared
          // optional additions to the actual raw result; preserve canonical items.
          output.content = next.content;
          output.structuredContent = next.structuredContent;
        } catch { /* Unsupported/malformed/optional API errors leave Core untouched. */ }
      },
      async dispose() { disposed = true; aliases.clear(); deliveries = new WeakMap(); await queue; },
    };
  },
};
