import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const loaded = [];
const hook = registerHooks({ load(url, context, nextLoad) {
  loaded.push(url);
  if (url.endsWith("/lib/world-model.mjs")) throw new Error("SYNTHETIC_OPTIONAL_MODULE_UNAVAILABLE");
  return nextLoad(url, context);
} });
try {
  const { dispatch } = await import("../../scripts/mcp-server.mjs");
  const call = (name, args = {}) => dispatch({ id: 1, method: "tools/call", params: { name, arguments: args } });
  const listed = await dispatch({ id: 0, method: "tools/list" });
  assert(!listed.error);
  assert(!(await call("head_core_contract")).error);
  assert(!(await call("head_tools_discover", { prefix: "head_world_" })).error);
  const cold = [...loaded];
  for (const file of ["world-model", "context-compiler", "bounded-worker-job", "bounded-worker-wave", "worker-integration-workflow", "product-operating-loop", "observation-adapter", "operating-lane"]) {
    assert(!cold.some(url => url.endsWith(`/lib/${file}.mjs`)), file);
  }
  const unavailable = await call("head_tools_read", { name: "head_world_model", arguments: { project_root: "." } });
  assert.match(unavailable.error.message, /SYNTHETIC_OPTIONAL_MODULE_UNAVAILABLE/);
  assert(!(await call("head_core_contract")).error);
  assert(!(await dispatch({ id: 3, method: "tools/list" })).error);
  console.log(JSON.stringify({ status: "pass", pid: process.pid, parentPid: process.ppid,
    command: process.execPath, cwd: process.cwd(), ports: [], coldLoadedModules: cold.length,
    defaultTools: listed.result.tools.length, catalogBytes: Buffer.byteLength(JSON.stringify(listed.result.tools)),
    optionalFailureScoped: true, providerInvoked: false }));
} finally { hook.deregister(); }
