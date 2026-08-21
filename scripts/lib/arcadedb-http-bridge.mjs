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
const operation = requiredText(input.operation, "ArcadeDB operation");
if (!new Set(["credential-status", "query", "query-batch", "command", "ready", "exists", "create-database", "drop-database"]).has(operation)) {
  fail("ArcadeDB bridge operation is unsupported.", "ARCADEDB_BRIDGE_INVALID_INPUT");
}
const username = process.env[usernameReference];
const password = process.env[passwordReference];
const timeoutMs = Number(input.timeoutMs ?? 15000);
if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) {
  fail("ArcadeDB bridge timeout is invalid.", "ARCADEDB_BRIDGE_INVALID_INPUT");
}
if (operation === "credential-status") {
  const usernameReferencePresent = typeof username === "string" && username.length > 0;
  const passwordReferencePresent = typeof password === "string" && password.length > 0;
  fs.writeSync(1, JSON.stringify({
    ok: true,
    status: 200,
    body: {
      usernameReferencePresent,
      passwordReferencePresent,
      allReferencesPresent: usernameReferencePresent && passwordReferencePresent,
      credentialValuesReturned: false,
      networkRequestPerformed: false,
    },
  }));
  process.exit(0);
}
if (!username || !password) fail("ArcadeDB credential references are unavailable in the process environment.", "ARCADEDB_CREDENTIALS_UNAVAILABLE", 2);

const queryBatch = operation === "query-batch" ? input.queries : null;
if (operation === "query-batch" && (!Array.isArray(queryBatch) || queryBatch.length < 1 || queryBatch.length > 8)) {
  fail("ArcadeDB query batch must contain from one through eight queries.", "ARCADEDB_BRIDGE_INVALID_INPUT");
}
if (operation === "query-batch" && (input.protocol?.name !== "head-agent-core-arcadedb-query-batch" || input.protocol?.version !== "0.1.0")) {
  fail("ArcadeDB query batch protocol is incompatible.", "ARCADEDB_BRIDGE_INVALID_INPUT");
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
async function performRequest({ requestPath, requestBody = null, method = "POST" }) {
  const requestHeaders = { ...headers };
  const request = { method, headers: requestHeaders, signal: AbortSignal.timeout(timeoutMs) };
  if (requestBody != null) {
    requestHeaders["Content-Type"] = "application/json";
    request.body = JSON.stringify(requestBody);
  }
  let response;
  try { response = await fetch(`${endpoint}${requestPath}`, request); }
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
  return { ok: response.ok, status: response.status, body };
}

if (operation === "query-batch") {
  const responses = [];
  let failedResponse = null;
  for (const [index, query] of queryBatch.entries()) {
    if (!query || typeof query !== "object" || Array.isArray(query)) {
      fail(`ArcadeDB query batch entry ${index} is invalid.`, "ARCADEDB_BRIDGE_INVALID_INPUT");
    }
    const language = requiredText(query.language ?? "sql", `ArcadeDB query batch entry ${index} language`);
    const command = requiredText(query.command, `ArcadeDB query batch entry ${index} command`);
    if (language.toLowerCase() !== "sql" || !/^select(?:\s|$)/iu.test(command)
      || command.includes(";") || command.includes("--") || command.includes("/*") || command.includes("*/")) {
      fail(`ArcadeDB query batch entry ${index} is not a bounded read-only SQL query.`, "ARCADEDB_BRIDGE_INVALID_INPUT");
    }
    const params = query.params && typeof query.params === "object" && !Array.isArray(query.params) ? query.params : {};
    const response = await performRequest({
      requestPath: `/api/v1/query/${encodeURIComponent(database)}`,
      requestBody: { language, command, params },
    });
    if (!response.ok) {
      failedResponse = { ...response, failedQueryIndex: index };
      break;
    }
    responses.push({ status: response.status, body: response.body });
  }
  fs.writeSync(1, JSON.stringify(failedResponse || { ok: true, status: 200, body: { responses } }));
  process.exitCode = failedResponse ? 3 : 0;
} else {
  const requestBody = readOnlyGet
    ? null
    : operation === "create-database" || operation === "drop-database"
      ? { command: `${operation === "create-database" ? "create" : "drop"} database ${database}` }
      : {
        language: requiredText(input.language, "ArcadeDB language"),
        command: requiredText(input.command, "ArcadeDB command"),
        params: input.params && typeof input.params === "object" && !Array.isArray(input.params) ? input.params : {},
        ...(operation === "command" ? { autoCommit: true } : {}),
      };
  const response = await performRequest({ requestPath: path, requestBody, method: readOnlyGet ? "GET" : "POST" });
  fs.writeSync(1, JSON.stringify(response));
  process.exitCode = response.ok ? 0 : 3;
}
