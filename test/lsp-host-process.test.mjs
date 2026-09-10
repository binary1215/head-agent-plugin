import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { collectOutgoingCallEvidence } from "../scripts/lib/lsp-host-bridge.mjs";
import { sha256 } from "../scripts/lib/lsp-host-protocol.mjs";
import { resolveVerifiedProcessSupervisor } from "../scripts/lib/runtime-process-supervisor.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fakeServer = path.join(root, "test", "fixtures", "lsp-host-fake-server.mjs");
const qaRoot = path.resolve(process.env.HEAD_LSP_QA_ROOT || "");
const supervisorRoot = path.resolve(process.env.HEAD_LSP_SUPERVISOR_ROOT || "");
if (!process.env.HEAD_LSP_QA_ROOT || !process.env.HEAD_LSP_SUPERVISOR_ROOT) throw new Error("Ready fake process tests require HEAD_LSP_QA_ROOT and HEAD_LSP_SUPERVISOR_ROOT.");
const selection = resolveVerifiedProcessSupervisor({ pluginRoot: supervisorRoot });
const generationDigest = sha256("lsp-host-generation-v1");

const baseSources = Object.freeze([
  Object.freeze({ path: "target.ts", text: "export function target() {}" }),
  Object.freeze({ path: "barrel.ts", text: "export { target } from \"./target\";" }),
  Object.freeze({ path: "caller.ts", text: "import { target } from \"./barrel\";\nexport function caller(){ target(); }" }),
]);

function profile(scenario) {
  return { kind: "head-lsp-fake-v1", scenario, serverFile: fakeServer, serverDigest: sha256(fs.readFileSync(fakeServer)) };
}

async function run(scenario, sources = baseSources, options = {}) {
  const events = [];
  const result = await collectOutgoingCallEvidence({
    projectId: "fixture-project",
    generationDigest,
    sources,
    profile: profile(scenario),
    supervisorSelection: selection,
    qaRoot,
    onProcessEvent: (event) => events.push(event),
    ...options,
  });
  assert.equal(result.realSupport, false);
  assert.equal(result.relationQuality, "unknown");
  assert.deepEqual(result.realGate, { id: "A03", status: "not-run", reason: "no-reviewed-pinned-real-profile-and-isolation" });
  assert.equal(result.e1bEligible, false);
  assert.equal(result.authority, "ephemeral-host-evidence-only");
  if (result.transport) {
    assert.equal(result.transport.ownershipEstablished, true);
    assert.equal(result.transport.treeCleanupVerified, true);
  }
  assert.equal(events.filter((event) => event.type === "spawn").length, events.filter((event) => event.type === "exit").length);
  return result;
}

function processExists(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; }
}

async function waitGone(pid) {
  const deadline = Date.now() + 2_000;
  while (processExists(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  return !processExists(pid);
}

test("P01/P02 ready fake derives barrel and direct outgoing relations from didOpen", async () => {
  const barrel = await run("barrel");
  assert.equal(barrel.status, "completed");
  assert.equal(barrel.reason, "candidates");
  assert.equal(barrel.candidates.length, 1);
  assert.equal(barrel.candidates[0].caller.path, "caller.ts");
  assert.equal(barrel.candidates[0].target.path, "target.ts");
  const direct = await run("direct", baseSources.map((item) => item.path === "caller.ts" ? { ...item, text: item.text.replace("./barrel", "./target") } : item));
  assert.equal(direct.status, "completed");
  assert.equal(direct.candidates.length, 1);
});

test("P03/P04 semantic negatives and empty completion remain candidate-free", async () => {
  const falsePositiveSources = baseSources.map((item) => item.path === "caller.ts" ? { ...item, text: "import { target } from \"./barrel\";\nexport function caller(){ const text = \"target()\"; const ref = target; return [text, ref]; }" } : item);
  const falsePositive = await run("false-positive", falsePositiveSources);
  assert.equal(falsePositive.status, "completed");
  assert.equal(falsePositive.provenance.publishedCandidateCount, 0);
  for (const [scenario, reason] of [["prepare-null", "no-prepared-item"], ["prepare-empty", "no-prepared-item"], ["hierarchy-null", "empty"], ["hierarchy-empty", "empty"], ["wrong-position", "no-prepared-item"]]) {
    const result = await run(scenario);
    assert.equal(result.status, "completed");
    assert.equal(result.reason, reason);
    assert.equal(result.candidates.length, 0);
  }
});

test("P05/P06 allowed notifications and server requests do not create authority or side effects", async () => {
  for (const scenario of ["notifications", "server-requests", "fragmented"]) {
    const result = await run(scenario);
    assert.equal(result.status, "completed");
    assert.equal(result.candidates.length, 1);
  }
  for (const [scenario, reason] of [["notification-flood", "notification-limit"], ["unknown-notification", "unsupported-server-notification"], ["unknown-server-request", "unsupported-server-request"], ["frame-oversize", "frame-oversize"]]) {
    const result = await run(scenario);
    assert.equal(result.status, "failed");
    assert.equal(result.reason, reason);
    assert.equal(result.candidates.length, 0);
  }
  assert.equal(fs.existsSync(path.join(root, ".head")), false);
});

test("P07/P09 protocol corruption, ambiguity, timeout, cancellation, and crash fail closed", async () => {
  for (const [scenario, reason] of [
    ["bad-header", "invalid-framing"], ["invalid-json", "invalid-json"], ["unknown-id", "unknown-response-id"],
    ["duplicate-id", "duplicate-response-id"], ["late-response", "duplicate-response-id"],
    ["ambiguous", "ambiguous-prepared-item"], ["timeout", "request-timeout"], ["cancel", "cancelled"], ["crash", "process-crash"],
  ]) {
    const result = await run(scenario);
    assert.equal(result.status, "failed", scenario);
    assert.equal(result.reason, reason, scenario);
    assert.equal(result.candidates.length, 0, scenario);
    assert.ok(result.failureStage, scenario);
  }
});

test("P08/P11 ownership and endpoint contamination never publish candidates", async () => {
  for (const [scenario, reason] of [["external-uri", "uri-outside-snapshot"], ["invalid-range", "invalid-range"]]) {
    const result = await run(scenario);
    assert.equal(result.status, "contaminated");
    assert.equal(result.reason, reason);
    assert.equal(result.candidates.length, 0);
  }
  const stale = profile("barrel");
  stale.serverDigest = sha256("stale");
  const result = await collectOutgoingCallEvidence({ projectId: "fixture-project", generationDigest, sources: baseSources, profile: stale, supervisorSelection: selection, qaRoot });
  assert.equal(result.status, "contaminated");
  assert.equal(result.reason, "profile-drift");
});

test("P10 repeated and reordered execution preserves semantic digest", async () => {
  const first = await run("barrel");
  const second = await run("barrel");
  const reordered = await run("reordered");
  assert.equal(first.candidates[0].semanticDigest, second.candidates[0].semanticDigest);
  assert.equal(first.candidates[0].semanticDigest, reordered.candidates[0].semanticDigest);
});

test("P13/P17 ready profile exercises owned bridge, fake server, and intentional grandchild cleanup", async () => {
  const result = await run("grandchild");
  assert.equal(result.status, "completed");
  assert.equal(result.candidates.length, 1);
  const pids = result.fixtureTransport?.testOwnedPids || result.fixtureTransport?.ownedPids || [];
  assert.equal(pids.length, 1);
  assert.equal(await waitGone(pids[0]), true, `Owned grandchild ${pids[0]} remained alive.`);
  const negative = await run("false-positive");
  assert.equal(negative.provenance.publishedCandidateCount, 0);
});

test("P15/P16 absent profile and public integration remain explicit", async () => {
  const result = await collectOutgoingCallEvidence({ projectId: "fixture-project", generationDigest, sources: baseSources, profile: null });
  assert.equal(result.status, "not-configured");
  assert.equal(result.reason, "no-profile");
  assert.equal(result.provenance.producerDigest, null);
  assert.equal(result.realSupport, false);
});
