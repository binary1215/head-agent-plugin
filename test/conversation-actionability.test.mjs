import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeProject } from "../scripts/lib/head-core.mjs";
import { inspectProjectExperience } from "../scripts/lib/project-bootstrap.mjs";
import { createRecoveryCheckpoint } from "../scripts/lib/compaction-recovery.mjs";
import { enterConversationRecovery, processCompactionLifecycle } from "../scripts/lib/compaction-lifecycle.mjs";
import { updateProjectDirection } from "../scripts/lib/project-direction.mjs";
import { startOnboarding } from "../scripts/lib/onboarding.mjs";
import { formatCliResult } from "../scripts/lib/cli-presentation.mjs";
import { runCommand } from "../scripts/head.mjs";
import { dispatch } from "../scripts/mcp-server.mjs";

const pluginRoot = path.resolve(import.meta.dirname, "..");
function fixture(t, { initialized = true } = {}) {
  const parent = process.env.HEAD_AGENT_TEST_TMP || os.tmpdir();
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "head-actionability-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  if (initialized) initializeProject({ root, pluginRoot, runtimes: ["codex"] });
  return root;
}
function checkpoint(root) {
  return createRecoveryCheckpoint({ root,
    purpose: "Investigate a synthetic service without deployment",
    approvedDecisions: ["Historical permission does not authorize current effects"],
    currentPosition: "Read-only conversation entry is under test",
    nextExpectedResult: "Continue the current user task",
  }).checkpoint;
}
function bytes(root) {
  return Object.fromEntries(fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const file = path.join(entry.parentPath, entry.name);
      return [path.relative(root, file).replaceAll("\\", "/"), fs.readFileSync(file, "base64")];
    }).sort(([a], [b]) => a.localeCompare(b)));
}
async function verifySurfaces(root, { headActionRequired, recoveryBlocked = false, recoveryHeadAction = false, presentation = headActionRequired ? "exception" : "quiet" }) {
  const before = bytes(root);
  const status = inspectProjectExperience({ root });
  const entry = enterConversationRecovery({ root });
  const cli = runCommand(["conversation-enter", root]);
  const mcp = await dispatch({ jsonrpc: "2.0", id: "actionability", method: "tools/call",
    params: { name: "head_conversation_enter", arguments: { project_root: root } } });
  assert.equal(mcp.result?.isError, undefined, JSON.stringify(mcp));
  const mcpEntry = mcp.result.structuredContent;
  for (const experience of [status, entry.projectStatus, cli.projectStatus, mcpEntry.projectStatus]) {
    assert.equal(experience.capabilities.find((capability) => capability.id === "direct-work").availability, "available");
    assert.equal(experience.readiness.recovery.headActionRequired, recoveryHeadAction);
    assert.equal(experience.readiness.recovery.recoveryDependentWorkBlocked, recoveryBlocked);
  }
  for (const view of [status, status.attention, status.presentation, entry, entry.attention, entry.presentation,
    cli, cli.attention, cli.presentation, mcpEntry, mcpEntry.attention, mcpEntry.presentation]) {
    assert.equal(view.headActionRequired, headActionRequired, view.kind || view.status);
    assert.equal(view.userDecisionRequired, false);
    assert.equal(view.ordinaryWorkBlocked, false);
  }
  assert.equal(entry.presentation.mode, presentation);
  assert.equal(entry.recoveryDependentWorkBlocked, recoveryBlocked);
  assert.deepEqual(entry.blockedOperations, entry.attention.blockedOperations);
  assert.equal(entry.authorityChanged, false);
  assert.equal(entry.persisted, false);
  assert.equal(entry.projectStatus.authority.grantsAuthorization, false);
  const hostless = processCompactionLifecycle({ root });
  assert.equal(hostless.headActionRequired, entry.headActionRequired);
  assert.equal(hostless.recoveryDependentWorkBlocked, recoveryBlocked);
  assert.equal(hostless.userDecisionRequired, false);
  assert.equal(hostless.ordinaryWorkBlocked, false);
  assert.deepEqual(bytes(root), before, "status, CLI/MCP entry and absent Host must write no authority, repair, lock or queue");
  assert.equal(mcp.result.content[0].text, formatCliResult("conversation-enter", cli));
  return entry;
}

test("uninitialized Core advises initialization without blocking direct work; all entry flags agree", async (t) => {
  const root = fixture(t, { initialized: false });
  const entry = await verifySurfaces(root, { headActionRequired: true });
  assert.equal(entry.status, "conversation_recovery_unavailable");
  assert.equal(entry.projectStatus.nextAction.id, "initialize_core");
  assert.equal(entry.projectStatus.capabilities.filter((capability) => capability.id !== "direct-work")
    .every((capability) => capability.availability === "blocked-until-core-ready"), true);
  assert.deepEqual(entry.blockedOperations, ["head-managed-capabilities"]);
});

test("ready Core without checkpoint has consistent quiet flags and adds no recovery gate", async (t) => {
  const entry = await verifySurfaces(fixture(t), { headActionRequired: false });
  assert.equal(entry.status, "conversation_ready");
  assert.equal(entry.projectStatus.readiness.recovery.state, "no-current-checkpoint");
  assert.deepEqual(entry.blockedOperations, []);
});

test("verified restore preserves exact checkpoint plus newer shared cancellation without rewriting either", async (t) => {
  const root = fixture(t);
  const canonical = checkpoint(root);
  const latest = updateProjectDirection({ root, input: { goal: "Keep investigation local", cancelledActions: ["deploy"] } }).direction;
  const entry = await verifySurfaces(root, { headActionRequired: false });
  assert.equal(entry.status, "conversation_direction_restored");
  assert.equal(entry.restore.checkpoint.checkpointDigest, canonical.checkpointDigest);
  assert.equal(entry.restore.projection.consumerInstruction.currentProjectDirection.directionId, latest.directionId);
  assert.deepEqual(entry.projectStatus.currentProjectDirection.input.cancelledActions, ["deploy"]);
  assert.equal(entry.restore.projection.providerBoundary.providerTranscriptUsed, false);
});

test("corrupt checkpoint blocks only dependent recovery and never promotes injected summary direction", async (t) => {
  const root = fixture(t);
  const canonical = checkpoint(root);
  const file = path.join(root, ".head/sessions/ledger", `${canonical.checkpointId}.json`);
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  value.nextExpectedResult = "untrusted provider summary must never become direction";
  fs.writeFileSync(file, JSON.stringify(value));
  const entry = await verifySurfaces(root, { headActionRequired: true, recoveryHeadAction: true, recoveryBlocked: true });
  assert.equal(entry.status, "recovery_attention_required");
  assert.equal(Object.hasOwn(entry, "restore"), false);
  assert.deepEqual(entry.blockedOperations, ["checkpoint-dependent-work"]);
});

test("Session pointer drift remains fail-closed only for recovery-dependent work", async (t) => {
  const root = fixture(t);
  checkpoint(root);
  const file = path.join(root, ".head/sessions/current.json");
  const state = JSON.parse(fs.readFileSync(file, "utf8"));
  state.activeExecutionContractId = "execution-contract-000000000000000000000000";
  fs.writeFileSync(file, JSON.stringify(state));
  const entry = await verifySurfaces(root, { headActionRequired: true, recoveryHeadAction: true, recoveryBlocked: true });
  assert.equal(entry.reasonCode, "SESSION_RESTORE_POINTER_DRIFT");
  assert.equal(Object.hasOwn(entry, "restore"), false);
});

test("managed projection drift with no checkpoint never invents a checkpoint-dependent gate", async (t) => {
  const root = fixture(t);
  fs.appendFileSync(path.join(root, "AGENTS.md"), "\nlocal project change\n");
  const entry = await verifySurfaces(root, { headActionRequired: true, recoveryHeadAction: true });
  assert.equal(entry.status, "conversation_recovery_unavailable");
  assert.deepEqual(entry.blockedOperations, ["head-managed-mutation"]);
  assert.equal(entry.attention.items.find((item) => item.id === "recovery-verification").blockedOperations.includes("checkpoint-dependent-work"), false);
});

test("optional Product review stays conditional, not an immediate user or HEAD gate", async (t) => {
  const root = fixture(t);
  await startOnboarding({ root, mode: "new", brief: {
    schemaVersion: 1, name: "Synthetic delivery service", summary: "Deliver a message",
    capabilities: [{ key: "delivery", name: "Delivery", description: "Deliver a message" }],
  } });
  const entry = await verifySurfaces(root, { headActionRequired: false, presentation: "notice" });
  assert.equal(entry.projectStatus.readiness.product.state, "review_required");
  assert.equal(entry.attention.counts.availableUserDecision, 1);
  assert.equal(entry.attention.items.find((item) => item.id === "product-canon-review").actionability, "when-product-governance-is-in-scope");
  assert.deepEqual(entry.blockedOperations, ["product-canon-promotion"]);
});

for (const hasCheckpoint of [false, true]) test(`outdated runtime aggregates HEAD follow-up with ${hasCheckpoint ? "restored checkpoint" : "no checkpoint"}, while recovery flags stay scoped`, async (t) => {
  const root = fixture(t);
  if (hasCheckpoint) checkpoint(root);
  const file = path.join(root, ".head/generated/manifest.json");
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  manifest.packageVersion = "0.0.0-fixture-outdated";
  fs.writeFileSync(file, JSON.stringify(manifest));
  const entry = await verifySurfaces(root, { headActionRequired: true });
  assert.equal(entry.runtime.state, "project-integration-outdated");
  assert.equal(entry.runtime.restartRequired, true);
  assert.deepEqual(entry.blockedOperations, ["new-plugin-capabilities"]);
  assert.match(formatCliResult("conversation-enter", entry), /HEAD follow-up: Converge the project integration, then restart the Host/u);
  assert.equal(entry.projectStatus.readiness.recovery.headActionRequired, false);
});
