import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scenario = process.argv[2] || "barrel";
const opened = new Map();
let buffer = Buffer.alloc(0);
let expected = null;
let descendant = null;
let configurationChecked = false;
let applyEditChecked = false;
let progressChecked = false;
let messageChecked = false;

function encode(message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`, "ascii"), payload]);
}

function write(message, mode = "normal") {
  const bytes = encode(message);
  if (mode === "fragmented") {
    const one = Math.max(1, Math.floor(bytes.length / 3));
    process.stdout.write(bytes.subarray(0, one));
    setTimeout(() => process.stdout.write(bytes.subarray(one, one * 2)), 2);
    setTimeout(() => process.stdout.write(bytes.subarray(one * 2)), 4);
  } else process.stdout.write(bytes);
}

function position(text, offset) {
  const before = text.slice(0, offset);
  const lines = before.split("\n");
  return { line: lines.length - 1, character: lines.at(-1).replace(/\r$/, "").length };
}

function range(text, start, length) {
  return { start: position(text, start), end: position(text, start + length) };
}

function documentBySuffix(suffix) {
  return [...opened.entries()].find(([uri]) => uri.endsWith(`/${suffix}`));
}

function callerItem() {
  const [uri, text] = documentBySuffix("caller.ts") || [];
  if (!uri) return null;
  const start = text.indexOf("caller");
  if (start < 0) return null;
  return { name: "caller", kind: 12, uri, range: range(text, start, "caller".length), selectionRange: range(text, start, "caller".length) };
}

function targetItem() {
  const [uri, text] = documentBySuffix("target.ts") || [];
  if (!uri) return null;
  const start = text.indexOf("target");
  if (start < 0) return null;
  const item = { name: "target", kind: 12, uri, range: range(text, start, "target".length), selectionRange: range(text, start, "target".length) };
  if (scenario === "external-uri") item.uri = "file:///outside/target.ts";
  if (scenario === "invalid-range") item.selectionRange = { start: { line: 999, character: 0 }, end: { line: 999, character: 1 } };
  return item;
}

function verifyServerResponse(message) {
  if (message.id === "server-config") configurationChecked = Array.isArray(message.result) && message.result.length === 2 && message.result.every((item) => item === null);
  if (message.id === "server-edit") applyEditChecked = message.result?.applied === false && message.result?.failureReason === "HEAD LSP Host profile is read-only";
  if (message.id === "server-progress") progressChecked = message.result === null;
  if (message.id === "server-message") messageChecked = message.result === null;
}

function respond(message) {
  if (message.id !== undefined && message.method === undefined) {
    verifyServerResponse(message);
    return;
  }
  if (message.method === "initialize") {
    if (scenario === "bad-header") { process.stdout.write("Content-Length nope\r\n\r\n{}"); return; }
    if (scenario === "invalid-json") { process.stdout.write("Content-Length: 1\r\n\r\n{"); return; }
    if (scenario === "unknown-id") { write({ jsonrpc: "2.0", id: 999, result: {} }); return; }
    if (scenario === "frame-oversize") { process.stdout.write("Content-Length: 524289\r\n\r\n"); return; }
    write({ jsonrpc: "2.0", id: message.id, result: { capabilities: { callHierarchyProvider: true } } }, scenario === "fragmented" ? "fragmented" : "normal");
    return;
  }
  if (message.method === "initialized") {
    if (["notifications", "reordered", "server-requests"].includes(scenario)) {
      write({ jsonrpc: "2.0", method: "window/logMessage", params: { type: 3, message: "bounded fixture log" } });
      write({ jsonrpc: "2.0", method: "_typescript.version", params: { version: "fixture" } });
      write({ jsonrpc: "2.0", method: "$/progress", params: { token: "fixture", value: { kind: "report" } } });
    }
    if (scenario === "notification-flood") for (let index = 0; index < 129; index += 1) write({ jsonrpc: "2.0", method: "window/logMessage", params: { type: 3, message: String(index) } });
    if (scenario === "unknown-notification") write({ jsonrpc: "2.0", method: "head/unknown", params: {} });
    if (scenario === "unknown-server-request") write({ jsonrpc: "2.0", id: "server-unknown", method: "workspace/executeCommand", params: {} });
    if (scenario === "server-requests") {
      write({ jsonrpc: "2.0", id: "server-config", method: "workspace/configuration", params: { items: [{ section: "a" }, { section: "b" }] } });
      write({ jsonrpc: "2.0", id: "server-edit", method: "workspace/applyEdit", params: { edit: { changes: { "file:///must-not-be-read": [] } } } });
      write({ jsonrpc: "2.0", id: "server-progress", method: "window/workDoneProgress/create", params: { token: "fixture" } });
      write({ jsonrpc: "2.0", id: "server-message", method: "window/showMessageRequest", params: { message: "fixture", actions: [] } });
    }
    if (scenario === "grandchild") {
      const childFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "lsp-host-child.mjs");
      descendant = spawn(process.execPath, [childFile], { shell: false, windowsHide: true, stdio: "ignore" });
      descendant.unref();
      write({ jsonrpc: "2.0", method: "telemetry/event", params: { headTestDescendantPid: descendant.pid } });
    }
    return;
  }
  if (message.method === "textDocument/didOpen") {
    opened.set(message.params.textDocument.uri, message.params.textDocument.text);
    return;
  }
  if (message.method === "textDocument/prepareCallHierarchy") {
    if (scenario === "crash") process.exit(31);
    if (["timeout", "cancel"].includes(scenario)) return;
    if (scenario === "prepare-null" || scenario === "wrong-position") { write({ jsonrpc: "2.0", id: message.id, result: null }); return; }
    if (scenario === "prepare-empty" || scenario === "false-positive") { write({ jsonrpc: "2.0", id: message.id, result: [] }); return; }
    const item = callerItem();
    if (!item) { write({ jsonrpc: "2.0", id: message.id, result: [] }); return; }
    if (scenario === "ambiguous") { write({ jsonrpc: "2.0", id: message.id, result: [item, { ...item, name: "caller2" }] }); return; }
    write({ jsonrpc: "2.0", id: message.id, result: [item] });
    if (scenario === "duplicate-id") write({ jsonrpc: "2.0", id: message.id, result: [item] });
    return;
  }
  if (message.method === "callHierarchy/outgoingCalls") {
    if (scenario === "hierarchy-null") { write({ jsonrpc: "2.0", id: message.id, result: null }); return; }
    if (scenario === "hierarchy-empty") { write({ jsonrpc: "2.0", id: message.id, result: [] }); return; }
    const [, callerText] = documentBySuffix("caller.ts") || [];
    const target = targetItem();
    const callStart = callerText?.indexOf("target();") ?? -1;
    const importExpected = scenario === "direct" ? /from\s+["']\.\/target["']/ : /from\s+["']\.\/barrel["']/;
    const validCall = callStart >= 0 && importExpected.test(callerText || "") && target;
    const result = validCall ? [{ to: target, fromRanges: [range(callerText, callStart, "target".length)] }] : [];
    if (scenario === "late-response") {
      write({ jsonrpc: "2.0", id: message.id, result });
      write({ jsonrpc: "2.0", id: message.id, result });
      return;
    }
    if (scenario === "server-requests" && !(configurationChecked && applyEditChecked && progressChecked && messageChecked)) {
      write({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "Host server-request responses were incorrect" } });
      return;
    }
    write({ jsonrpc: "2.0", id: message.id, result }, scenario === "fragmented" ? "fragmented" : "normal");
    return;
  }
  if (message.method === "shutdown") {
    write({ jsonrpc: "2.0", id: message.id, result: null });
    return;
  }
  if (message.method === "exit") {
    setTimeout(() => process.exit(0), 10);
    return;
  }
  if (message.method === "$/cancelRequest" && ["timeout", "cancel"].includes(scenario)) {
    setTimeout(() => process.exit(0), 10);
  }
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    if (expected === null) {
      const marker = buffer.indexOf("\r\n\r\n");
      if (marker < 0) return;
      const header = buffer.subarray(0, marker).toString("ascii");
      const match = /Content-Length:\s*([0-9]+)/i.exec(header);
      if (!match) process.exit(32);
      expected = Number(match[1]);
      buffer = buffer.subarray(marker + 4);
    }
    if (buffer.length < expected) return;
    const payload = buffer.subarray(0, expected);
    buffer = buffer.subarray(expected);
    expected = null;
    respond(JSON.parse(payload.toString("utf8")));
  }
});

process.stdin.resume();
