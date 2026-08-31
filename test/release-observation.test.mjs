import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { initializeProject } from "../scripts/lib/head-core.mjs";
import { inspectReleaseObservations, observeReleaseState } from "../scripts/lib/release-observation.mjs";
import { buildWorldModel, inspectWorldModel } from "../scripts/lib/world-model.mjs";
import { dispatch as dispatchMcp } from "../scripts/mcp-server.mjs";
import { runCommand } from "../scripts/head.mjs";
import { verifyTemporalProvenanceGraph } from "../scripts/lib/temporal-provenance.mjs";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testParent = process.env.HEAD_AGENT_TEST_TMP || os.tmpdir();
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;

function reidentifyGraph(graph) {
  const payload = { ...graph }; delete payload.graphSnapshotId; delete payload.graphSnapshotHash;
  const hash = sha(JSON.stringify(canonical(payload)));
  return { ...payload, graphSnapshotId: `graph-snapshot-${hash.slice(0, 24)}`, graphSnapshotHash: hash };
}

function git(root, args) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

function fixture() {
  fs.mkdirSync(testParent, { recursive: true });
  const root = fs.mkdtempSync(path.join(testParent, "head-agent-release-observation-"));
  initializeProject({ root, pluginRoot, runtimes: ["codex"] });
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "feature.mjs"), "export const releaseObservation = true;\n");
  git(root, ["init"]);
  git(root, ["config", "user.name", "HEAD Test"]);
  git(root, ["config", "user.email", "head@example.invalid"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "initial release observation fixture"]);
  return root;
}

function deployment(commit, suffix, overrides = {}) {
  return {
    environmentKey: "production",
    status: "succeeded",
    commit,
    observedAt: "2026-09-01T00:00:00.000Z",
    sourceEventKeyDigest: sha(`event:${suffix}`),
    deploymentEvidenceDigest: sha(`deployment:${suffix}`),
    approved: true,
    approvalEvidenceDigest: sha(`approval:${suffix}`),
    changeSetId: null,
    vcsEvidenceId: null,
    ...overrides,
  };
}

test("records Git refs and an approved successful deployment as P3 release evidence without authority amplification", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const commit = git(root, ["rev-parse", "HEAD"]);
  const productCanonFile = path.join(root, ".head", "context", "product-model.json");
  const sessionPointerFile = path.join(root, ".head", "sessions", "current.json");
  const canonBefore = fs.readFileSync(productCanonFile, "utf8");
  const sessionBefore = fs.readFileSync(sessionPointerFile, "utf8");

  const observed = await observeReleaseState({ root, input: deployment(commit, "success") });
  assert.equal(observed.status, "release_observed");
  assert.equal(observed.release.commit, commit);
  assert.equal(observed.branchStates.some((item) => item.ref.startsWith("refs/heads/")), true);
  assert.equal(observed.authority.productCanonMutated, false);
  assert.equal(fs.readFileSync(productCanonFile, "utf8"), canonBefore);
  assert.equal(fs.readFileSync(sessionPointerFile, "utf8"), sessionBefore);

  const projection = inspectReleaseObservations({ root }).projection;
  assert.equal(projection.releases.length, 1);
  assert.equal(projection.deploymentResults.length, 1);
  const graph = inspectWorldModel({ root }).snapshot.temporalProvenanceGraph;
  assert.equal(graph.nodes.some((node) => node.kind === "ReleaseObservation" && node.nodeId === observed.release.releaseObservationId), true);
  assert.equal(graph.edges.some((edge) => edge.type === "EVIDENCED_BY" && edge.from === observed.release.releaseObservationId), true);
  assert.equal(graph.edges.some((edge) => edge.type === "AT_REVISION" && edge.from === observed.release.releaseObservationId), true);
  assert.equal(graph.edges.some((edge) => edge.type === "OBSERVED_ON" && edge.from === observed.release.releaseObservationId), true);
  const tamperedGraph = structuredClone(graph);
  tamperedGraph.nodes.find((node) => node.kind === "DeploymentResultObservation").status = "failed";
  assert.throws(() => verifyTemporalProvenanceGraph(reidentifyGraph(tamperedGraph)), (error) => error.code === "RELEASE_OBSERVATION_TEMPORAL_RELATION_MISSING");

  const replay = await observeReleaseState({ root, input: deployment(commit, "success") });
  assert.equal(replay.release.releaseObservationId, observed.release.releaseObservationId);
  assert.equal(inspectReleaseObservations({ root }).projection.releases.length, 1);
  assert.equal(runCommand(["release-status", root]).projection.releases.length, 1);
});

test("fails closed for unapproved, failed, stale-ref, and divergent deployment results", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const firstCommit = git(root, ["rev-parse", "HEAD"]);
  fs.appendFileSync(path.join(root, "src", "feature.mjs"), "export const second = true;\n");
  git(root, ["add", "src/feature.mjs"]);
  git(root, ["commit", "-m", "advance product branch"]);
  const headCommit = git(root, ["rev-parse", "HEAD"]);
  await buildWorldModel({ root, persist: true });

  const stale = await observeReleaseState({ root, input: deployment(firstCommit, "stale") });
  assert.equal(stale.status, "awaiting_matching_product_ref");
  assert.equal(stale.release, null);
  const failed = await observeReleaseState({ root, input: deployment(headCommit, "failed", { status: "failed" }) });
  assert.equal(failed.status, "not_release_eligible");
  assert.equal(failed.release, null);
  const unapproved = await observeReleaseState({ root, input: deployment(headCommit, "unapproved", { approved: false, approvalEvidenceDigest: null }) });
  assert.equal(unapproved.status, "not_release_eligible");
  assert.equal(unapproved.release, null);

  await assert.rejects(() => observeReleaseState({ root, input: deployment(headCommit, "failed", { status: "cancelled" }) }), (error) => error.code === "DIVERGENT_DEPLOYMENT_RESULT_REPLAY");
  assert.equal(inspectReleaseObservations({ root }).projection.releases.length, 0);
});

test("keeps host provenance at the adapter boundary and requires explicit MCP observation confirmation", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const commit = git(root, ["rev-parse", "HEAD"]);
  const input = deployment(commit, "mcp");
  const denied = await dispatchMcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "head_release_observe", arguments: {
    project_root: root, environment_key: input.environmentKey, status: input.status, commit: input.commit, observed_at: input.observedAt,
    source_event_key_digest: input.sourceEventKeyDigest, deployment_evidence_digest: input.deploymentEvidenceDigest, approved: input.approved,
    approval_evidence_digest: input.approvalEvidenceDigest, change_set_id: null, vcs_evidence_id: null, confirm_host_observation: false,
  } } });
  assert.match(denied.error.message, /host deployment observer/);
  assert.equal(inspectReleaseObservations({ root }).projection.deploymentResults.length, 0);
});
