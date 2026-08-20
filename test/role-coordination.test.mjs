import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { coreContract, initializeProject } from "../scripts/lib/head-core.mjs";
import { runCommand } from "../scripts/head.mjs";
import { dispatch, tools as mcpTools } from "../scripts/mcp-server.mjs";
import {
  inspectRoleCoordination,
  issueCoordinationRoleBinding,
  openCoordinationGeneration,
  readCoordinationInbox,
  readCoordinationReply,
  replyCoordinationMessage,
  sendCoordinationMessage,
} from "../scripts/lib/role-coordination.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");

function fixture() {
  const parent = process.env.HEAD_AGENT_TEST_TMP || os.tmpdir();
  fs.mkdirSync(parent, { recursive: true });
  const base = fs.mkdtempSync(path.join(parent, "head-role-coordination-"));
  const root = path.join(base, "project");
  const operationalRoot = path.join(base, "operational");
  fs.mkdirSync(root);
  initializeProject({ root, pluginRoot, runtimes: ["codex", "opencode"] });
  return {
    base,
    root,
    operationalRoot,
    environment: { ...process.env, HEAD_AGENT_OPERATIONAL_STATE_ROOT: operationalRoot },
  };
}

function treeBytes(root) {
  const entries = [];
  const walk = (directory) => {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name);
      const relative = path.relative(root, file).replaceAll("\\", "/");
      const stat = fs.lstatSync(file);
      if (stat.isDirectory()) walk(file);
      else entries.push([relative, fs.readFileSync(file).toString("base64")]);
    }
  };
  walk(root);
  return entries;
}

function allOperationalText(root) {
  const values = [];
  const walk = (directory) => {
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name);
      const stat = fs.lstatSync(file);
      if (stat.isDirectory()) walk(file);
      else values.push(fs.readFileSync(file, "utf8"));
    }
  };
  walk(root);
  return values.join("\n");
}

function hasOwnKeyDeep(value, key) {
  if (Array.isArray(value)) return value.some((item) => hasOwnKeyDeep(item, key));
  if (!value || typeof value !== "object") return false;
  return Object.prototype.hasOwnProperty.call(value, key) || Object.values(value).some((item) => hasOwnKeyDeep(item, key));
}

test("host-issued bindings derive roles and durable messages remain non-authoritative", (t) => {
  const fx = fixture();
  t.after(() => fs.rmSync(fx.base, { recursive: true, force: true }));
  const projectBefore = treeBytes(path.join(fx.root, ".head"));

  assert.equal(inspectRoleCoordination({ root: fx.root, environment: fx.environment }).status, "not_opened");

  const opened = openCoordinationGeneration({ root: fx.root, environment: fx.environment });
  assert.equal(opened.status, "opened");
  assert.equal(opened.generation.instructionAuthority, false);
  const developer = issueCoordinationRoleBinding({ root: fx.root, role: "developer", environment: fx.environment });
  const head = issueCoordinationRoleBinding({ root: fx.root, role: "head", environment: fx.environment });
  assert.equal(developer.binding.roleSelfClaimed, false);
  assert.equal(head.binding.tokenBindingHash, "present-not-disclosed");

  const accepted = sendCoordinationMessage({
    root: fx.root,
    environment: fx.environment,
    bindingToken: developer.bindingToken,
    toRole: "head",
    content: "Please review the exact ResultPacket evidence.",
    evidenceIds: ["result-packet-example", "execution-contract-example"],
    idempotencyKey: "request-review-1",
    lane: "run",
  });
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.message.fromRole, "developer");
  assert.equal(accepted.message.toRole, "head");
  assert.equal(accepted.message.roleDerivedFrom, "host-issued-binding");
  assert.equal(accepted.message.instructionAuthority, false);
  assert.equal(accepted.message.decisionAuthority, false);
  assert.equal(accepted.message.promotionAuthority, false);
  assert.equal(accepted.message.canonMutationAuthority, false);
  assert.equal(accepted.message.reviewAuthority, false);
  assert.equal(accepted.message.executionAuthorizationAuthority, false);
  assert.equal(accepted.delivery.status, "not_configured");
  assert.equal(accepted.delivery.durableInboxAccepted, true);

  const replay = sendCoordinationMessage({
    root: fx.root,
    environment: fx.environment,
    bindingToken: developer.bindingToken,
    toRole: "head",
    content: "Please review the exact ResultPacket evidence.",
    evidenceIds: ["execution-contract-example", "result-packet-example"],
    idempotencyKey: "request-review-1",
    lane: "run",
  });
  assert.equal(replay.status, "replayed");
  assert.equal(replay.message.messageId, accepted.message.messageId);
  assert.throws(() => sendCoordinationMessage({
    root: fx.root,
    environment: fx.environment,
    bindingToken: developer.bindingToken,
    toRole: "head",
    content: "Conflicting content",
    idempotencyKey: "request-review-1",
    lane: "run",
  }), { code: "COORDINATION_IDEMPOTENCY_CONFLICT" });

  const inbox = readCoordinationInbox({ root: fx.root, environment: fx.environment, bindingToken: head.bindingToken });
  assert.equal(inbox.role, "head");
  assert.equal(inbox.messages.length, 1);
  assert.equal(inbox.messages[0].fromRole, "developer");
  assert.equal(inbox.messages[0].read, false);
  assert.equal(readCoordinationInbox({ root: fx.root, environment: fx.environment, bindingToken: head.bindingToken }).messages.length, 0);
  assert.equal(readCoordinationInbox({ root: fx.root, environment: fx.environment, bindingToken: head.bindingToken, unreadOnly: false }).messages[0].read, true);

  const replied = replyCoordinationMessage({
    root: fx.root,
    environment: fx.environment,
    bindingToken: head.bindingToken,
    inReplyTo: accepted.message.messageId,
    content: "Reviewed; the message itself does not approve the ResultPacket.",
  });
  assert.equal(replied.reply.fromRole, "head");
  assert.equal(replied.reply.toRole, "developer");
  assert.equal(replied.reply.reviewAuthority, false);
  assert.equal(replyCoordinationMessage({
    root: fx.root,
    environment: fx.environment,
    bindingToken: head.bindingToken,
    inReplyTo: accepted.message.messageId,
    content: "Reviewed; the message itself does not approve the ResultPacket.",
  }).status, "existing");
  assert.throws(() => replyCoordinationMessage({
    root: fx.root,
    environment: fx.environment,
    bindingToken: head.bindingToken,
    inReplyTo: accepted.message.messageId,
    content: "Different reply",
  }), { code: "COORDINATION_REPLY_IMMUTABLE" });
  const receivedReply = readCoordinationReply({
    root: fx.root,
    environment: fx.environment,
    bindingToken: developer.bindingToken,
    messageId: accepted.message.messageId,
  });
  assert.equal(receivedReply.status, "replied");
  assert.equal(receivedReply.reply.content, replied.reply.content);
  const replayWithReply = sendCoordinationMessage({
    root: fx.root,
    environment: fx.environment,
    bindingToken: developer.bindingToken,
    toRole: "head",
    content: "Please review the exact ResultPacket evidence.",
    evidenceIds: ["result-packet-example", "execution-contract-example"],
    idempotencyKey: "request-review-1",
    lane: "run",
  });
  assert.equal(replayWithReply.reply.content, replied.reply.content);

  const status = inspectRoleCoordination({ root: fx.root, environment: fx.environment });
  assert.deepEqual(status.boundRoles, ["developer", "head"]);
  assert.deepEqual(status.publicRoleTools, ["send", "read-inbox", "reply"]);
  assert.equal(status.projectCanonMutated, false);
  assert.deepEqual(treeBytes(path.join(fx.root, ".head")), projectBefore);
  const operationalText = allOperationalText(fx.operationalRoot);
  assert.equal(operationalText.includes(developer.bindingToken), false);
  assert.equal(operationalText.includes(head.bindingToken), false);
});

test("generation rotation, replacement, project fences, and delivery ambiguity fail safely", (t) => {
  const fx = fixture();
  t.after(() => fs.rmSync(fx.base, { recursive: true, force: true }));
  const opened = openCoordinationGeneration({ root: fx.root, environment: fx.environment });
  const developer = issueCoordinationRoleBinding({ root: fx.root, role: "developer", environment: fx.environment });
  const replaced = issueCoordinationRoleBinding({ root: fx.root, role: "developer", environment: fx.environment });
  assert.throws(() => readCoordinationInbox({ root: fx.root, environment: fx.environment, bindingToken: developer.bindingToken }), { code: "STALE_COORDINATION_BINDING" });
  const stateRoot = path.join(fx.operationalRoot, "role-coordination", "v1", opened.generation.projectId, opened.generation.headSessionId);
  const developerPointer = path.join(stateRoot, "generation-state", opened.generation.authorityGeneration, "bindings", "roles", "developer.json");
  fs.writeFileSync(developerPointer, `${JSON.stringify({ schemaVersion: 1, projectId: opened.generation.projectId, headSessionId: opened.generation.headSessionId, authorityGeneration: opened.generation.authorityGeneration, role: "developer", bindingId: developer.binding.bindingId, bindingHash: developer.binding.bindingHash, bindingSequence: developer.binding.bindingSequence, updatedAt: new Date().toISOString() }, null, 2)}\n`);
  assert.throws(() => readCoordinationInbox({ root: fx.root, environment: fx.environment, bindingToken: developer.bindingToken }), { code: "COORDINATION_BINDING_ROLLBACK" });
  fs.writeFileSync(developerPointer, `${JSON.stringify({ schemaVersion: 1, projectId: opened.generation.projectId, headSessionId: opened.generation.headSessionId, authorityGeneration: opened.generation.authorityGeneration, role: "developer", bindingId: replaced.binding.bindingId, bindingHash: replaced.binding.bindingHash, bindingSequence: replaced.binding.bindingSequence, updatedAt: new Date().toISOString() }, null, 2)}\n`);

  const ambiguous = sendCoordinationMessage({
    root: fx.root,
    environment: fx.environment,
    bindingToken: replaced.bindingToken,
    toRole: "head",
    content: "Durable before notification",
    idempotencyKey: "ambiguous-delivery",
    deliveryAdapter: { deliver() { throw new Error("unknown host completion"); } },
  });
  assert.equal(ambiguous.status, "accepted");
  assert.equal(ambiguous.delivery.status, "ambiguous");
  assert.equal(ambiguous.delivery.retryPolicy, "no-automatic-retry");
  let deliveryCalls = 0;
  const replay = sendCoordinationMessage({
    root: fx.root,
    environment: fx.environment,
    bindingToken: replaced.bindingToken,
    toRole: "head",
    content: "Durable before notification",
    idempotencyKey: "ambiguous-delivery",
    deliveryAdapter: { deliver() { deliveryCalls += 1; return { status: "delivered" }; } },
  });
  assert.equal(replay.status, "replayed");
  assert.equal(replay.delivery.status, "ambiguous");
  assert.equal(deliveryCalls, 0);

  const rotated = openCoordinationGeneration({ root: fx.root, environment: fx.environment, rotate: true });
  assert.equal(rotated.status, "rotated");
  assert.notEqual(rotated.generation.authorityGeneration, ambiguous.message.authorityGeneration);
  assert.throws(() => readCoordinationInbox({ root: fx.root, environment: fx.environment, bindingToken: replaced.bindingToken }), { code: "STALE_COORDINATION_BINDING" });
  const generationPointer = path.join(stateRoot, "current-generation.json");
  fs.writeFileSync(generationPointer, `${JSON.stringify({ schemaVersion: 1, projectId: opened.generation.projectId, headSessionId: opened.generation.headSessionId, authorityGeneration: opened.generation.authorityGeneration, generationHash: opened.generation.generationHash, generationSequence: opened.generation.generationSequence, updatedAt: new Date().toISOString() }, null, 2)}\n`);
  assert.throws(() => inspectRoleCoordination({ root: fx.root, environment: fx.environment }), { code: "COORDINATION_GENERATION_ROLLBACK" });

  const foreignRoot = path.join(fx.base, "foreign");
  fs.mkdirSync(foreignRoot);
  initializeProject({ root: foreignRoot, pluginRoot, runtimes: ["codex"] });
  const foreignEnvironment = { ...process.env, HEAD_AGENT_OPERATIONAL_STATE_ROOT: fx.operationalRoot };
  openCoordinationGeneration({ root: foreignRoot, environment: foreignEnvironment });
  assert.throws(() => readCoordinationInbox({ root: foreignRoot, environment: foreignEnvironment, bindingToken: replaced.bindingToken }), { code: "STALE_COORDINATION_BINDING" });
});

test("binding corruption and authority escalation in host-local messages fail closed", (t) => {
  const fx = fixture();
  t.after(() => fs.rmSync(fx.base, { recursive: true, force: true }));
  const opened = openCoordinationGeneration({ root: fx.root, environment: fx.environment });
  const developer = issueCoordinationRoleBinding({ root: fx.root, role: "developer", environment: fx.environment });
  const head = issueCoordinationRoleBinding({ root: fx.root, role: "head", environment: fx.environment });
  const corruptedToken = `${developer.bindingToken.slice(0, -1)}${developer.bindingToken.endsWith("x") ? "y" : "x"}`;
  assert.throws(() => readCoordinationInbox({
    root: fx.root,
    environment: fx.environment,
    bindingToken: corruptedToken,
  }), { code: "INVALID_COORDINATION_BINDING_TOKEN" });
  assert.throws(() => issueCoordinationRoleBinding({ root: fx.root, role: "../head", environment: fx.environment }), { code: "INVALID_AGENT_ROLE" });

  const sent = sendCoordinationMessage({
    root: fx.root,
    environment: fx.environment,
    bindingToken: developer.bindingToken,
    toRole: "head",
    content: "This remains evidence only",
    idempotencyKey: "tamper-message",
  });
  const messagePath = path.join(
    fx.operationalRoot,
    "role-coordination", "v1",
    sent.message.projectId,
    sent.message.headSessionId,
    "generation-state", opened.generation.authorityGeneration,
    "inboxes", "head", `${sent.message.messageId}.json`,
  );
  const tampered = JSON.parse(fs.readFileSync(messagePath, "utf8"));
  tampered.reviewAuthority = true;
  fs.writeFileSync(messagePath, `${JSON.stringify(tampered, null, 2)}\n`);
  assert.throws(() => readCoordinationInbox({ root: fx.root, environment: fx.environment, bindingToken: head.bindingToken }), { code: "INVALID_COORDINATION_MESSAGE" });
});

test("advanced CLI administration and exactly three role-bound MCP tools share the Core contract", async (t) => {
  const fx = fixture();
  t.after(() => fs.rmSync(fx.base, { recursive: true, force: true }));
  const previousOperational = process.env.HEAD_AGENT_OPERATIONAL_STATE_ROOT;
  const previousBinding = process.env.HEAD_AGENT_COORDINATION_BINDING_TOKEN;
  t.after(() => {
    if (previousOperational === undefined) delete process.env.HEAD_AGENT_OPERATIONAL_STATE_ROOT;
    else process.env.HEAD_AGENT_OPERATIONAL_STATE_ROOT = previousOperational;
    if (previousBinding === undefined) delete process.env.HEAD_AGENT_COORDINATION_BINDING_TOKEN;
    else process.env.HEAD_AGENT_COORDINATION_BINDING_TOKEN = previousBinding;
  });
  process.env.HEAD_AGENT_OPERATIONAL_STATE_ROOT = fx.operationalRoot;

  assert.equal(runCommand(["coordination-open", fx.root]).status, "opened");
  const developer = runCommand(["coordination-bind", fx.root, "--role", "developer"]);
  const head = runCommand(["coordination-bind", fx.root, "--role", "head"]);
  const inputFile = path.join(fx.base, "message.json");
  fs.writeFileSync(inputFile, `${JSON.stringify({ toRole: "head", content: "CLI durable message", evidenceIds: [], idempotencyKey: "cli-message", lane: "session" })}\n`);
  process.env.HEAD_AGENT_COORDINATION_BINDING_TOKEN = developer.bindingToken;
  const sent = runCommand(["coordination-send", fx.root, "--input", inputFile]);
  assert.equal(sent.message.fromRole, "developer");
  assert.equal(runCommand(["coordination-status", fx.root]).stateLocation, "host-local-operational-root");

  const roleTools = mcpTools.filter((tool) => tool.name.startsWith("head_coordination_"));
  assert.deepEqual(roleTools.map((tool) => tool.name), [
    "head_coordination_send_message",
    "head_coordination_read_inbox",
    "head_coordination_reply_message",
  ]);
  for (const tool of roleTools) {
    const serialized = JSON.stringify(tool.inputSchema);
    assert.equal(serialized.includes("self"), false);
    assert.equal(serialized.includes("from_role"), false);
    assert.equal(serialized.includes("binding_token"), false);
  }
  const contract = coreContract();
  assert.equal(contract.activeCapabilities.includes("provider-neutral-durable-role-coordination"), true);
  assert.equal(contract.activeCapabilities.includes("role-bound-mcp-send-read-reply"), true);
  assert.equal(contract.activeCapabilities.includes("verified-workspace-host-adapter"), true);
  assert.equal(contract.activeCapabilities.includes("fresh-snapshot-exact-endpoint-delivery"), true);
  assert.equal(contract.deferredCapabilities.includes("agent-comm"), false);
  assert.equal(contract.deferredCapabilities.includes("live-caller-fencing"), false);
  assert.equal(contract.deferredCapabilities.includes("herdr"), false);
  assert.equal(contract.activeCapabilities.includes("binding-scoped-offline-workspace-wake"), true);
  assert.equal(contract.activeCapabilities.includes("actual-codex-opencode-role-round-trip"), true);
  assert.equal(contract.deferredCapabilities.includes("host-specific-workspace-adapter"), true);

  process.env.HEAD_AGENT_COORDINATION_BINDING_TOKEN = head.bindingToken;
  const inboxResponse = await dispatch({
    jsonrpc: "2.0", id: 1, method: "tools/call",
    params: { name: "head_coordination_read_inbox", arguments: { project_root: fx.root } },
  });
  assert.equal(inboxResponse.result.structuredContent.role, "head");
  assert.equal(inboxResponse.result.structuredContent.messages[0].messageId, sent.message.messageId);
  const replyResponse = await dispatch({
    jsonrpc: "2.0", id: 2, method: "tools/call",
    params: { name: "head_coordination_reply_message", arguments: { project_root: fx.root, in_reply_to: sent.message.messageId, content: "MCP immutable reply" } },
  });
  assert.equal(replyResponse.result.structuredContent.reply.fromRole, "head");

  delete process.env.HEAD_AGENT_COORDINATION_BINDING_TOKEN;
  const unbound = await dispatch({
    jsonrpc: "2.0", id: 3, method: "tools/call",
    params: { name: "head_coordination_read_inbox", arguments: { project_root: fx.root } },
  });
  assert.match(unbound.error.message, /trusted host-injected/u);
});

test("fresh CLI processes recover the same durable host-local inbox without provider identity", (t) => {
  const fx = fixture();
  t.after(() => fs.rmSync(fx.base, { recursive: true, force: true }));
  const projectBefore = treeBytes(path.join(fx.root, ".head"));
  openCoordinationGeneration({ root: fx.root, environment: fx.environment });
  const developer = issueCoordinationRoleBinding({ root: fx.root, role: "developer", environment: fx.environment });
  const reviewer = issueCoordinationRoleBinding({ root: fx.root, role: "reviewer", environment: fx.environment });
  const inputFile = path.join(fx.base, "fresh-message.json");
  fs.writeFileSync(inputFile, `${JSON.stringify({ toRole: "reviewer", content: "Recover this inbox in a fresh process", evidenceIds: ["result-packet-fresh-process"], idempotencyKey: "fresh-process-send", lane: "run" })}\n`);
  const baseEnvironment = {
    ...process.env,
    HEAD_AGENT_OPERATIONAL_STATE_ROOT: fx.operationalRoot,
  };
  const send = spawnSync(process.execPath, [path.join(pluginRoot, "scripts", "head.mjs"), "coordination-send", fx.root, "--input", inputFile], {
    cwd: pluginRoot,
    env: { ...baseEnvironment, HEAD_AGENT_COORDINATION_BINDING_TOKEN: developer.bindingToken },
    encoding: "utf8",
  });
  assert.equal(send.status, 0, send.stderr || send.stdout);
  const sent = JSON.parse(send.stdout);
  assert.equal(sent.message.fromRole, "developer");
  const receive = spawnSync(process.execPath, [path.join(pluginRoot, "scripts", "head.mjs"), "coordination-inbox", fx.root], {
    cwd: pluginRoot,
    env: { ...baseEnvironment, HEAD_AGENT_COORDINATION_BINDING_TOKEN: reviewer.bindingToken },
    encoding: "utf8",
  });
  assert.equal(receive.status, 0, receive.stderr || receive.stdout);
  const inbox = JSON.parse(receive.stdout);
  assert.equal(inbox.messages[0].messageId, sent.message.messageId);
  assert.equal(hasOwnKeyDeep(inbox, "providerSessionId"), false);
  assert.equal(inbox.messages[0].providerSessionIdentityPersisted, false);
  assert.deepEqual(treeBytes(path.join(fx.root, ".head")), projectBefore);
});
