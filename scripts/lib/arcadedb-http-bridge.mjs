#!/usr/bin/env node
import fs from "node:fs";

const fail = (message, code, exitCode = 1) => {
  fs.writeSync(1, JSON.stringify({ ok: false, error: { code, message } }));
  process.exit(exitCode);
};

async function readInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { fail("ArcadeDB bridge input is invalid JSON.", "ARCADEDB_BRIDGE_INVALID_INPUT"); }
}

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) fail(`${label} is required.`, "ARCADEDB_BRIDGE_INVALID_INPUT");
  return value.trim();
}

const input = await readInput();
const endpoint = requiredText(input.endpoint, "ArcadeDB endpoint").replace(/\/$/, "");
const database = requiredText(input.database, "ArcadeDB database");
const usernameReference = requiredText(input.secretReferenceNames?.username, "ArcadeDB username reference");
const passwordReference = requiredText(input.secretReferenceNames?.password, "ArcadeDB password reference");
const username = process.env[usernameReference];
const password = process.env[passwordReference];
if (!username || !password) fail("ArcadeDB credential references are unavailable in the process environment.", "ARCADEDB_CREDENTIALS_UNAVAILABLE", 2);

const operation = requiredText(input.operation, "ArcadeDB operation");
if (!new Set(["query", "command", "ready", "exists", "create-database", "drop-database"]).has(operation)) {
  fail("ArcadeDB bridge operation is unsupported.", "ARCADEDB_BRIDGE_INVALID_INPUT");
}
const timeoutMs = Number(input.timeoutMs ?? 15000);
if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) {
  fail("ArcadeDB bridge timeout is invalid.", "ARCADEDB_BRIDGE_INVALID_INPUT");
}

const path = operation === "ready"
  ? "/api/v1/ready"
  : operation === "exists"
    ? `/api/v1/exists/${encodeURIComponent(database)}`
    : operation === "create-database" || operation === "drop-database"
      ? "/api/v1/server"
      : `/api/v1/${operation}/${encodeURIComponent(database)}`;
const headers = {
  Accept: "application/json",
  Authorization: `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`,
};
const readOnlyGet = operation === "ready" || operation === "exists";
const request = { method: readOnlyGet ? "GET" : "POST", headers, signal: AbortSignal.timeout(timeoutMs) };
if (!readOnlyGet) {
  headers["Content-Type"] = "application/json";
  request.body = operation === "create-database" || operation === "drop-database"
    ? JSON.stringify({ command: `${operation === "create-database" ? "create" : "drop"} database ${database}` })
    : JSON.stringify({
      language: requiredText(input.language, "ArcadeDB language"),
      command: requiredText(input.command, "ArcadeDB command"),
      params: input.params && typeof input.params === "object" && !Array.isArray(input.params) ? input.params : {},
      ...(operation === "command" ? { autoCommit: true } : {}),
    });
}

let response;
try { response = await fetch(`${endpoint}${path}`, request); }
catch (error) {
  const unavailable = error?.name === "TimeoutError" || error?.name === "AbortError" || error instanceof TypeError;
  fail(
    unavailable ? "ArcadeDB transport is unavailable." : "ArcadeDB request failed.",
    unavailable ? "ARCADEDB_TRANSPORT_UNAVAILABLE" : "ARCADEDB_REQUEST_FAILED",
    unavailable ? 2 : 1,
  );
}

const responseText = await response.text();
let body = null;
if (responseText) {
  try { body = JSON.parse(responseText); }
  catch { body = { message: responseText.slice(0, 1000) }; }
}
fs.writeSync(1, JSON.stringify({ ok: response.ok, status: response.status, body }));
process.exit(response.ok ? 0 : 3);
