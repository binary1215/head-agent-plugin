import fs from "node:fs";
import path from "node:path";
import { resolveOperation } from "./lode-operation-contract.mjs";
const semanticToolName = name => resolveOperation(name)?.semanticName ?? name;
const helperName = name => semanticToolName(name) === "head_session_host_request_prepare";
const routerName = name => ["head_tools_read", "head_tools_call"].includes(semanticToolName(name));
const hasProjectMarker = root => [".head", ".lode"].some(directory => fs.existsSync(path.join(root, directory, "project.json")));
import { sessionCallRequiresBinding } from "./session-routing.mjs";
import { createSessionHostRequestRegistry } from "./session-host-request.mjs";

const validCaller = (id) => typeof id === "string" && id.length > 0 && id.length <= 512 && !/[\u0000-\u001f]/u.test(id);
const missingCaller = () => { throw Object.assign(new Error("Native caller metadata is unavailable; never substitute another caller."), { code: "NATIVE_SESSION_CALLER_UNAVAILABLE" }); };

// Thin Host transport composition. Nothing in tool arguments can supply a native
// caller, and this module authors neither P2 direction nor effect authorization.
export function createNativeSessionHostBridge({ environment = process.env, runtime = null, requestRegistry = createSessionHostRequestRegistry() } = {}) {
  let transportRuntime = runtime, observedNativeMetadata = false, observedClaudeHook = false;
  const adapters = new Map();
  function callerFor(request) {
    if (transportRuntime === "claude") {
      const meta = request.params?._meta;
      const hasId = meta && typeof meta === "object" && Object.hasOwn(meta, "claudecode/toolUseId");
      if (hasId) observedNativeMetadata = true;
      if (!hasId && !observedClaudeHook && !observedNativeMetadata && runtime !== "claude") return { status: "legacy" };
      if (!hasId || !validCaller(meta["claudecode/toolUseId"])) return { status: "unavailable" };
      try {
        const claim = requestRegistry.claim({ key: meta["claudecode/toolUseId"], name: request.params.name, arguments: request.params.arguments });
        return { status: "known", ...claim.caller, release: claim.release };
      } catch { return { status: "unavailable" }; }
    }
    if (transportRuntime !== "codex") return { status: "legacy" };
    const meta = request.params?._meta;
    if (meta && typeof meta === "object" && Object.hasOwn(meta, "threadId")) {
      if (!validCaller(meta.threadId)) return { status: "unavailable" };
      observedNativeMetadata = true;
      return { status: "known", runtime: "codex", nativeSessionId: meta.threadId };
    }
    // This remembers only the transport capability, NEVER the last caller.
    return { status: observedNativeMetadata ? "unavailable" : "legacy" };
  }
  async function adapterFor(caller) {
    const key = JSON.stringify([caller.runtime, caller.nativeSessionId, caller.agentId || null]);
    const { createSessionHostAdapter } = await import("./session-host-adapter.mjs");
    if (!adapters.has(key)) adapters.set(key, createSessionHostAdapter({ ...caller, environment }));
    return adapters.get(key);
  }
  const reply = (request, error = null) => ({ jsonrpc: "2.0", id: request.id ?? null, result: {
    content: [{ type: "text", text: error ? "Native Host request correlation unavailable (" + (error.code || "INVALID_HOST_REQUEST") + ")." : "{}" }],
    ...(error ? { isError: true } : {}),
  } });
  function prepareHookRequest(request) {
    try {
      // Verified stock CLI provenance seam, not arbitrary-client authentication.
      // Ordinary model calls have this outer meta even when args contain a fake.
      if (transportRuntime !== "claude" || request.params?._meta && Object.hasOwn(request.params._meta, "claudecode/toolUseId")) throw Object.assign(new Error(), { code: "NATIVE_HOOK_INGRESS_REQUIRED" });
      observedClaudeHook = true;
      const value = request.params.arguments;
      const fields = ["native_session_id", "native_agent_id", "tool_use_id", "outer_tool_name", "original_arguments"];
      if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))
        || ![value.native_session_id, value.tool_use_id, value.outer_tool_name].every(id => validCaller(id) && !id.includes("${"))
        || value.native_agent_id != null && value.native_agent_id !== "" && (!validCaller(value.native_agent_id) || value.native_agent_id.includes("${"))
        || typeof value.original_arguments !== "string") throw Object.assign(new Error(), { code: "INVALID_NATIVE_HOOK_INPUT" });
      const match = /^mcp__.+__([a-z][a-z0-9_]+)$/u.exec(value.outer_tool_name);
      if (!match || !resolveOperation(match[1]) || helperName(match[1])) throw Object.assign(new Error(), { code: "INVALID_NATIVE_HOOK_TARGET" });
      const original = JSON.parse(value.original_arguments);
      if (!original || typeof original !== "object" || Array.isArray(original)) throw Object.assign(new Error(), { code: "INVALID_NATIVE_HOOK_ARGUMENTS" });
      const routed = routerName(match[1]);
      const name = semanticToolName(routed ? original.name : match[1]);
      if (helperName(name)) throw Object.assign(new Error(), { code: "NATIVE_HOOK_RECURSION" });
      // Router Project-only no-op: no registry, Session/P5 read or graph work.
      if (!sessionCallRequiresBinding(name)) return reply(request);
      requestRegistry.prepare({ key: value.tool_use_id, name: match[1], arguments: original,
        caller: { runtime: "claude", nativeSessionId: value.native_session_id, agentId: value.native_agent_id || null } });
      return reply(request);
    } catch (error) { return reply(request, error); }
  }
  async function dispatchProjectRequest(request, handler, caller) {
      const outer = request.params?.arguments;
      const routed = routerName(request.params?.name);
      const args = routed ? outer?.arguments : outer;
      const name = semanticToolName(routed ? outer?.name : request.params?.name);
      if (helperName(name)) return reply(request, Object.assign(new Error(), { code: "NATIVE_HOOK_DIRECT_INGRESS_REQUIRED" }));
      if (typeof args?.project_root !== "string" || !args.project_root) return handler(request, {});
      if (caller.status === "legacy") return handler(request, {});
      if (!sessionCallRequiresBinding(name) && !Object.hasOwn(args, "session_id")) return handler(request, {});
      if (caller.status !== "known") {
        // Creating a new Project has no existing Session to guess or lose.
        // Keep that original Core setup usable, but never claim native linkage.
        if (name === "head_project_initialize_or_resume" && !Object.hasOwn(args, "session_id")
          && !hasProjectMarker(args.project_root)) {
          const response = await handler(request, {});
          if (response?.result) response.result._meta = { ...response.result._meta,
            headSessionBinding: { status: "unavailable", reasonCode: "NATIVE_SESSION_CALLER_UNAVAILABLE",
              retained: false, persisted: false, recoveryAuthority: false, executionReplayAllowed: false } };
          return response;
        }
        return handler(request, { resolveSessionContext: missingCaller });
      }
      let adapter;
      try { adapter = await adapterFor(caller); }
      catch (error) { return handler(request, { resolveSessionContext: () => { throw error; } }); }
      const initialized = hasProjectMarker(args.project_root);
      const selecting = name === "head_project_initialize_or_resume" && semanticToolName(request.params?.name) !== "head_tools_read"
        && (args.profile === undefined || ["core", "product"].includes(args.profile));
      let prepared = null, preparationFailure = null, selectionBasis = null, requestContext = null;
      const resolveSessionContext = (original) => {
        if (prepared) return prepared.context;
        if (!initialized) return null;
        if (requestContext) return requestContext;
        requestContext = adapter.resolveSessionContext(original, { allowAbsentDefault: true,
          onBindingRead: binding => { selectionBasis = { expectedRevision: binding.revision,
            expectedBindingDigest: binding.bindingDigest || null }; } });
        return requestContext;
      };
      const onValidatedSessionSelection = selecting ? ({ root, sessionId }) => {
        try { prepared = adapter.prepareSelection({ root, sessionId, ...selectionBasis }); }
        catch (error) { preparationFailure = error.code || "HOST_BINDING_STORAGE_ERROR"; }
      } : null;
      let response;
      const readRelatedNativeContext = name === "head_conversation_enter" ? ({ childSessionId }) => {
        // Internal trusted caller only; not a model-native-ID argument. Entry
        // invokes this synchronously before its final child basis recheck.
        return nativeRelatedReader?.({ root: args.project_root, caller, childSessionId, environment });
      } : null;
      let nativeRelatedReader = null;
      if (readRelatedNativeContext) {
        try { nativeRelatedReader = (await import("./native-session-observations.mjs")).readRelatedNativeWorkContext; }
        catch { /* Optional context cannot replace primary Core errors. */ }
      }
      try { response = await handler(request, { resolveSessionContext, onValidatedSessionSelection, readRelatedNativeContext }); }
      catch (error) {
        if (prepared) adapter.settleSelection({ ticket: prepared.ticket, outcome: "uncertain" });
        throw error;
      }
      if (!selecting) {
        if (name === "head_project_status" && response?.result && !response.error && !response.result.isError) {
          try {
            const { projectNativeObservations, appendNativeStatus } = await import("./native-session-observations.mjs");
            const projection = await projectNativeObservations({ root: args.project_root, caller, environment });
            return { ...response, result: appendNativeStatus(response.result, projection) };
          } catch { /* Preserve exactly the successful primary response. */ }
        }
        return response;
      }
      const value = response?.result?.structuredContent;
      const confirmed = !response?.result?.isError && !response?.error
        && ["initialized", "resumed"].includes(value?.projectAction) && validCaller(value?.project?.projectId)
        && typeof value?.project?.sessionId === "string";
      if (confirmed && !initialized) {
        try { prepared = adapter.prepareSelection({ root: args.project_root, sessionId: value.project.sessionId,
          expectedRevision: 0, expectedBindingDigest: null }); }
        catch (error) { preparationFailure = error.code || "HOST_BINDING_STORAGE_ERROR"; }
      }
      let settlement;
      if (prepared) settlement = adapter.settleSelection({ ticket: prepared.ticket,
        outcome: confirmed && prepared.sessionId === value.project.sessionId ? "succeeded" : "uncertain" });
      else if (preparationFailure) settlement = { status: "host_selection_not_retained", reasonCode: preparationFailure,
        retained: false, persisted: false, executionReplayAllowed: false };
      if (settlement && response?.result) response.result._meta = { ...response.result._meta,
        headSessionBinding: { ...settlement, binding: undefined, scope: "host-linkage-only", recoveryAuthority: false } };
      return response;
  }
  return Object.freeze({
    describe: () => ({ authorityPlane: "P5", runtime: transportRuntime, sharedCurrentSelector: false,
      recoveryAuthority: false, instructionAuthority: false }),
    async dispatch(request, handler) {
      if (request.method === "initialize") {
        if (runtime === null) transportRuntime = request.params?.clientInfo?.name === "codex-mcp-client" ? "codex"
          : request.params?.clientInfo?.name === "claude-code" ? "claude" : null;
        return handler(request, {});
      }
      if (request.method !== "tools/call") return handler(request, {});
      if (helperName(request.params?.name)) return prepareHookRequest(request);
      const routed = routerName(request.params?.name);
      const targetName = routed ? request.params?.arguments?.name : request.params?.name;
      if (helperName(targetName)) return reply(request, Object.assign(new Error(), { code: "NATIVE_HOOK_DIRECT_INGRESS_REQUIRED" }));
      if (!sessionCallRequiresBinding(targetName)) return handler(request, {});
      const caller = callerFor(request);
      try { return await dispatchProjectRequest(request, handler, caller); }
      finally { caller.release?.(); }
    },
    requestStatus: () => requestRegistry.describe(),
    dispose() { requestRegistry.dispose(); adapters.clear(); },
  });
}
