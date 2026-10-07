import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { initializeProject, inspectProject } from "../scripts/lib/head-core.mjs";
import { createWholePlanSnapshot, createExecutionContract, createResultPacket, createReviewDecision, buildFreshHeadReview } from "../scripts/lib/execution-lineage.mjs";
import { compileContext } from "../scripts/lib/context-compiler.mjs";
import { proposeProductPolicy, reviewProductPolicy } from "../scripts/lib/product-policy.mjs";
import { prepareSourceContext } from "../scripts/lib/source-context-workflow.mjs";
import { readSourceObservation } from "../scripts/lib/source-observation.mjs";
import { buildWorldModel } from "../scripts/lib/world-model.mjs";
import { InMemoryGraphProjectionAdapter, materializeGraphProjection } from "../scripts/lib/graph-projection-adapter.mjs";
import { PROJECT_GRAPH_INDEX_PATH, projectGraphDigest } from "../scripts/lib/discovery-index.mjs";
import { indexProjectGraph, queryProjectGraph } from "../scripts/lib/project-graph.mjs";
import { startOnboarding, reviewOnboarding } from "../scripts/lib/onboarding.mjs";
import { historicalIntegrityBasis } from "../scripts/lib/historical-artifact-boundary-store.mjs";
import { publishHistoricalContinuityReceipt } from "../scripts/lib/historical-continuity.mjs";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function fixture(t, initialized = true) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "head-project-graph-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  if (initialized) initializeProject({ root, pluginRoot, runtimes: ["codex"] });
  fs.writeFileSync(path.join(root, "module.mjs"), "export const answer = 42;\n");
  return root;
}
function headFiles(root) {
  const result = {};
  const walk = (relative) => {
    const directory = path.join(root, relative);
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const next = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else result[next] = projectGraphDigest(fs.readFileSync(path.join(root, next)));
    }
  };
  walk(".head"); return result;
}
async function observed(root) {
  await prepareSourceContext({ root, task: "Inspect the exact answer source", needs: [{ kind: "source", path: "module.mjs" }], retain: true });
  return JSON.parse(fs.readFileSync(path.join(root, ".head", "graph-discovery", "index.json"), "utf8"));
}
function noAuthority(result) {
  for (const field of ["instructionAuthority", "promotionAuthority", "recoveryAuthority", "executionAuthority", "ordinaryWorkBlocked"]) assert.equal(result.authority[field], false);
  for (const node of result.nodes) for (const field of ["instructionAuthority", "promotionAuthority", "recoveryAuthority", "executionAuthority"]) assert.equal(node[field], false);
  for (const edge of result.edges) for (const field of ["instructionAuthority", "promotionAuthority", "recoveryAuthority", "executionAuthority"]) assert.equal(edge[field], false);
}

test("observed ingestion shares one replaceable inventory; core-only graph reads reuse exact originals", async t => {
  const root = fixture(t), index = await observed(root);
  assert(index.entries.some(entry => entry.path.includes("source-bundles")));
  assert(index.entries.some(entry => entry.path.includes("records/by-source-key")));
  assert(index.entries.every(entry => Object.keys(entry).sort().join(",") === "bytes,path,sha256"));
  assert.equal(indexProjectGraph({ root }).status, "reused");
  const before = headFiles(root), first = await queryProjectGraph({ root, query: "module.mjs", depth: 2 });
  const observation = first.nodes.find(node => node.kind === "ObservationRecord");
  assert(observation);
  assert(first.nodes.some(node => node.kind === "FileRevisionReference" && node.path === "module.mjs"));
  assert(first.edges.some(edge => edge.type === "OBSERVES_EXACT_REVISION"));
  assert.equal(first.coverage.emptyResultProvesAbsence, false);
  assert.equal(first.freshness.wholeWorldCurrentRequired, false);
  const second = await queryProjectGraph({ root, query: "module.mjs", depth: 2, previousResult: first });
  assert.equal(first.resultId, second.resultId);
  assert.equal(second.reuse.status, "same-basis-result-reused");
  const work = await queryProjectGraph({ root, anchorIds: [observation.nodeId], view: "work" });
  const product = await queryProjectGraph({ root, anchorIds: [observation.nodeId], view: "product" });
  assert.equal(work.nodes[0].nodeId, product.nodes[0].nodeId);
  assert.deepEqual(headFiles(root), before);
  assert(!fs.existsSync(path.join(root, ".head/world-model/current.json")));
  noAuthority(first);
});

test("retained source revisions survive changes and disappearances; current effects still reject drift", async t => {
  const root = fixture(t), index = await observed(root);
  const bundlePath = index.entries.find(entry => entry.path.includes("source-bundles")).path;
  const key = path.basename(bundlePath, ".json"), projectId = inspectProject(root).project.projectId;
  const first = await queryProjectGraph({ root, query: "module.mjs" });
  fs.writeFileSync(path.join(root, "module.mjs"), "export const answer = 99;\n");
  const before = headFiles(root), second = await queryProjectGraph({ root, query: "module.mjs", previousResult: first });
  assert.notEqual(second.basis.sourceCurrentnessDigest, first.basis.sourceCurrentnessDigest);
  assert(second.nodes.some(node => node.freshness === "historical-source-bytes"));
  assert.throws(() => readSourceObservation(root, projectId, key), { code: "SOURCE_DRIFT" });
  assert(readSourceObservation(root, projectId, key, { requireCurrent: false }));
  fs.unlinkSync(path.join(root, "module.mjs"));
  const third = await queryProjectGraph({ root, query: "module.mjs" });
  assert(third.nodes.some(node => node.freshness === "unavailable"));
  assert.equal(third.authority.ordinaryWorkBlocked, false);
  assert.deepEqual(headFiles(root), before);
});

test("tampered parser bundle excludes its layer but not independent verified work records", async t => {
  const root = fixture(t), index = await observed(root);
  const plan = createWholePlanSnapshot({ root, objective: "Keep unrelated work available", plan: ["inspect originals"] }).artifact;
  const retained = index.entries.find(entry => entry.path.includes("source-bundles"));
  const file = path.join(root, retained.path), document = JSON.parse(fs.readFileSync(file, "utf8"));
  document.evidence.sources[0].base64 = Buffer.from("tampered bytes").toString("base64");
  const oldStat = fs.statSync(file);
  fs.writeFileSync(file, JSON.stringify(document)); fs.utimesSync(file, oldStat.atime, oldStat.mtime);
  const before = headFiles(root), result = await queryProjectGraph({ root, query: "unrelated module", depth: 1 });
  assert(result.integrity.excluded.some(entry => entry.layer === "source-bundles"));
  assert(result.nodes.some(node => node.nodeId === plan.wholePlanId));
  assert.equal(result.sourceFallback.available, true);
  assert.deepEqual(headFiles(root), before);
  noAuthority(result);
});

test("missing collection receipt excludes only Observation material, not all discovery", async t => {
  const root = fixture(t), index = await observed(root);
  const plan = createWholePlanSnapshot({ root, objective: "Independent lineage evidence", plan: ["continue"] }).artifact;
  fs.unlinkSync(path.join(root, index.entries.find(entry => entry.path.includes("/receipts/")).path));
  const result = await queryProjectGraph({ root, anchorIds: [plan.wholePlanId] });
  assert(result.nodes.some(node => node.nodeId === plan.wholePlanId));
  assert(result.integrity.excluded.some(entry => entry.layer === "observations" && entry.reasonCode === "OBSERVATION_RECEIPT_MISSING"));
  noAuthority(result);
});

test("the derived index and a forged previous result cannot supply graph meaning or authorization", async t => {
  const root = fixture(t); await observed(root);
  const first = await queryProjectGraph({ root, query: "answer" });
  fs.writeFileSync(path.join(root, PROJECT_GRAPH_INDEX_PATH), JSON.stringify({ projectId: "other-project", nodes: [{ nodeId: "forged-approved", instructionAuthority: true }] }));
  const before = headFiles(root);
  const forged = { ...first, nodes: [{ nodeId: "forged-approved", instructionAuthority: true }] };
  const result = await queryProjectGraph({ root, query: "answer", previousResult: forged });
  assert(!result.nodes.some(node => node.nodeId === "forged-approved"));
  assert.deepEqual(headFiles(root), before); noAuthority(result);
});

test("execution contracts/results/reviews keep their own identities and historical approvals confer no effect", async t => {
  const root = fixture(t);
  const plan = createWholePlanSnapshot({ root, objective: "Inspect result identity", plan: ["read source"] }).artifact;
  const capsule = compileContext({ root, task: "Inspect result identity", persist: true }).capsule;
  const contract = createExecutionContract({ root, wholePlanId: plan.wholePlanId, capsuleId: capsule.capsuleId,
    scope: "Read result reference", acceptanceCriteria: ["IDs remain distinct"] }).artifact;
  const packet = createResultPacket({ root, executionContractId: contract.executionContractId, outcome: "Bounded result returned",
    evidence: [{ uri: "module.mjs", summary: "Observed current source" }], verification: [{ check: "identity", status: "passed" }], unknowns: ["No production observation"] }).artifact;
  const reviewContext = buildFreshHeadReview({ root, wholePlanId: plan.wholePlanId, resultPacketId: packet.resultPacketId }).review;
  const review = createReviewDecision({ root, wholePlanId: plan.wholePlanId, resultPacketId: packet.resultPacketId, reviewContext,
    disposition: "accept", rationale: "Accept this exact bounded result." }).artifact;
  const before = headFiles(root), result = await queryProjectGraph({ root, anchorIds: [review.reviewDecisionId], depth: 3 });
  for (const artifactId of [review.reviewDecisionId, packet.resultPacketId, contract.executionContractId, plan.wholePlanId]) assert(result.nodes.some(node => node.nodeId === artifactId));
  assert.equal(result.nodes.find(node => node.nodeId === review.reviewDecisionId).reviewState, "historical-accept");
  assert.equal(result.nodes.find(node => node.nodeId === packet.resultPacketId).outcome, packet.outcome);
  noAuthority(result); assert.deepEqual(headFiles(root), before);
});

test("exact rejected Policy remains visible as rejected even without World or ready generated installation", async t => {
  const root = fixture(t);
  const proposed = await proposeProductPolicy({ root, operation: "create", key: "quartz-review-rule", name: "QuartzNebulaPolicy", statement: "QuartzNebulaClause forbids unattended deployment." });
  const candidate = proposed.candidate;
  for (const query of [candidate.policyKey, candidate.proposedPolicy.name, "QuartzNebulaClause"]) {
    const pending = await queryProjectGraph({ root, query, depth: 0 });
    assert.equal(pending.nodes.find(node => node.nodeId === candidate.candidateId).reviewState, "candidate");
    noAuthority(pending);
  }
  await reviewProductPolicy({ root, candidateId: proposed.candidate.candidateId, disposition: "reject", rationale: "Do not adopt this policy." });
  fs.appendFileSync(path.join(root, ".head/generated/head-instructions.md"), "\nlocal change\n");
  const before = headFiles(root), result = await queryProjectGraph({ root, anchorIds: [proposed.candidate.candidateId], depth: 1 });
  assert.equal(result.nodes.find(node => node.nodeId === proposed.candidate.candidateId).reviewState, "rejected");
  assert(result.summary.reviewStates.rejected > 0);
  assert(result.edges.some(edge => edge.endpointStates.some(endpoint => endpoint.reviewState === "rejected")));
  const node = result.nodes.find(node => node.nodeId === candidate.candidateId);
  assert.deepEqual(node.proposedPolicy, Object.fromEntries(["key", "name", "statement", "description"].filter(key => typeof candidate.proposedPolicy[key] === "string").map(key => [key, candidate.proposedPolicy[key]])));
  for (const field of ["policyKey", "baseProductModelId", "resultingProductModelId"]) assert.equal(node[field], candidate[field]);
  assert.equal(node.revisionId, candidate.candidateId);
  const endpoint = result.edges.flatMap(edge => edge.endpointStates).find(state => state.nodeId === candidate.candidateId);
  assert.equal(endpoint.baseProductModelId, candidate.baseProductModelId);
  assert.equal(endpoint.resultingProductModelId, candidate.resultingProductModelId);
  assert.equal(endpoint.proposedPolicy.statement, candidate.proposedPolicy.statement);
  const summarized = result.summary.policyReferences.find(state => state.nodeId === candidate.candidateId);
  assert.deepEqual(summarized, endpoint);
  for (const query of [candidate.policyKey, candidate.proposedPolicy.name, "QuartzNebulaClause"]) {
    const searched = await queryProjectGraph({ root, query, depth: 1 });
    assert.equal(searched.nodes.find(node => node.nodeId === candidate.candidateId).reviewState, "rejected");
    noAuthority(searched);
  }
  assert.equal(result.coverage.layers.find(layer => layer.layer === "world").status, "absent");
  noAuthority(result); assert.deepEqual(headFiles(root), before);
});

async function onboardingFixture(t) {
  const root = fixture(t);
  const started = await startOnboarding({ root, mode: "new", brief: { schemaVersion: 1, name: "Synthetic service",
    summary: "Deliver one reviewed message.", capabilities: [{ key: "delivery", name: "Delivery", description: "Deliver a message." }] } });
  const reviewed = await reviewOnboarding({ root, candidateSetId: started.candidateSet.candidateSetId,
    disposition: "accept-all", rationale: "Synthetic acceptance." });
  return { root, started, reviewed };
}
async function assertWarmCold(root, options, previous) {
  const warm = await queryProjectGraph({ root, ...options, previousResult: previous });
  const coldModule = await import(`../scripts/lib/project-graph.mjs?dependency-test=${Math.random()}`);
  const cold = await coldModule.queryProjectGraph({ root, ...options });
  assert.deepEqual(warm.integrity, cold.integrity);
  assert.deepEqual(warm.coverage, cold.coverage);
  assert.equal(warm.resultId, cold.resultId, JSON.stringify(Object.keys(warm).filter(key => JSON.stringify(warm[key]) !== JSON.stringify(cold[key])).map(key => [key, warm[key], cold[key]])));
  noAuthority(warm); return warm;
}

test("historical dependency add/change/remove and unexpected directory entries invalidate warm discovery only in onboarding", async t => {
  const { root, started } = await onboardingFixture(t);
  const plan = createWholePlanSnapshot({ root, objective: "Independent original work", plan: ["read source"] }).artifact;
  const options = { anchorIds: [started.candidateSet.candidateSetId, plan.wholePlanId], depth: 1 };
  const original = await queryProjectGraph({ root, ...options });
  const boundaryDirectory = path.join(root, ".head/onboarding/historical-boundaries/historical-boundary-aaaaaaaaaaaaaaaaaaaaaaaa");
  fs.mkdirSync(boundaryDirectory, { recursive: true });
  const file = path.join(boundaryDirectory, "boundary.json"); fs.writeFileSync(file, "{broken");
  const before = headFiles(root), broken = await assertWarmCold(root, options, original);
  assert.notEqual(broken.resultId, original.resultId);
  assert(broken.integrity.excluded.some(item => item.layer === "onboarding" && item.reasonCode === "INVALID_HISTORICAL_BOUNDARY_JSON"));
  assert(broken.nodes.some(node => node.nodeId === plan.wholePlanId));
  assert.equal(broken.sourceFallback.available, true); assert.deepEqual(headFiles(root), before);
  fs.writeFileSync(file, "{}");
  const changed = await assertWarmCold(root, options, broken);
  assert(changed.integrity.excluded.some(item => item.layer === "onboarding" && item.reasonCode === "INVALID_HISTORICAL_BOUNDARY"));
  fs.unlinkSync(file);
  const missing = await assertWarmCold(root, options, changed);
  assert(missing.integrity.excluded.some(item => item.layer === "onboarding"));
  fs.rmdirSync(boundaryDirectory);
  const restored = await assertWarmCold(root, options, missing);
  assert(!restored.integrity.excluded.some(item => item.layer === "onboarding"));
  fs.writeFileSync(path.join(root, ".head/onboarding/historical-boundaries/unexpected.txt"), "unexpected");
  const nonJson = await assertWarmCold(root, options, restored);
  assert(nonJson.integrity.excluded.some(item => item.layer === "onboarding" && item.reasonCode === "INVALID_HISTORICAL_BOUNDARY_PATH"));
});

function fixtureIdentity(payload, idField, hashField, prefix) {
  const digest = projectGraphDigest(payload);
  return { ...payload, [idField]: `${prefix}-${digest.slice(0, 24)}`, [hashField]: digest };
}
function committedHistoricalFixture(root, candidateSet) {
  const originals = headFiles(root), projectId = inspectProject(root).project.projectId;
  const entries = Object.keys(originals).filter(file => file === `.head/onboarding/candidate-sets/${candidateSet.candidateSetId}.json`
    || file.startsWith(".head/onboarding/review-decisions/") || file === `.head/onboarding/product-model-revisions/${candidateSet.productModelId}.json`
    || file.startsWith(".head/world-model/snapshots/")).map(file => {
    const bytes = fs.readFileSync(path.join(root, file)), document = JSON.parse(bytes);
    const role = file.includes("/candidate-sets/") ? "historical-candidate-set" : file.includes("/review-decisions/") ? "historical-review"
      : file.includes("/product-model-revisions/") ? "historical-product-revision" : "legacy-world-embedding-reference";
    return { path: file, role, artifactId: role === "historical-candidate-set" ? document.candidateSetId : role === "historical-review" ? document.reviewDecisionId
      : role === "historical-product-revision" ? document.productModelId : document.worldModelId,
      protocolFamily: document.protocol?.name || document.kind, protocolVersion: document.protocol?.version || String(document.schemaVersion),
      byteLength: bytes.length, sha256: projectGraphDigest(bytes), interpretationMode: role === "historical-product-revision" ? "current-typed-with-historical-provenance" : "opaque-historical" };
  }).sort((a, b) => a.path.localeCompare(b.path, "en"));
  const reviewPath = Object.keys(originals).find(file => file.startsWith(".head/onboarding/review-decisions/"));
  const review = JSON.parse(fs.readFileSync(path.join(root, reviewPath)));
  // Both base and accepted result revisions remain typed original evidence.
  const resultPath = `.head/onboarding/product-model-revisions/${review.resultingProductModelId}.json`;
  if (!entries.some(entry => entry.path === resultPath)) {
    const bytes = fs.readFileSync(path.join(root, resultPath)), doc = JSON.parse(bytes);
    entries.push({ path: resultPath, role: "historical-product-revision", artifactId: doc.productModelId, protocolFamily: doc.protocol?.name || doc.kind,
      protocolVersion: doc.protocol?.version || String(doc.schemaVersion), byteLength: bytes.length, sha256: projectGraphDigest(bytes), interpretationMode: "current-typed-with-historical-provenance" });
    entries.sort((a, b) => a.path.localeCompare(b.path, "en"));
  }
  const inventoryHash = projectGraphDigest({ projectId, entries });
  const payload = { schemaVersion: 1, kind: "HistoricalArtifactBoundary", protocol: { name: "head-agent-core-historical-artifact-boundary", version: "0.1.0" }, projectId, inventoryHash, entries,
    validatedHistoricalApproval: { candidateSetId: candidateSet.candidateSetId, reviewDecisionId: review.reviewDecisionId, resultingProductModelId: review.resultingProductModelId },
    appliedAtBasis: { fixture: true }, authorityClass: "evidence", instructionAuthority: false, promotionAuthority: false };
  const boundary = { ...payload, boundaryId: `historical-boundary-${inventoryHash.slice(0, 24)}`, boundaryHash: projectGraphDigest(payload) };
  const receipt = fixtureIdentity({ schemaVersion: 1, kind: "HistoricalBoundaryApplicationReceipt", protocol: { name: "head-agent-core-historical-boundary-application", version: "0.1.0" },
    projectId, boundaryId: boundary.boundaryId, boundaryHash: boundary.boundaryHash, inventoryHash,
    appliedAtBasisHash: projectGraphDigest(boundary.appliedAtBasis), authorityClass: "evidence", instructionAuthority: false, promotionAuthority: false }, "receiptId", "receiptHash", "historical-boundary-receipt");
  const commit = fixtureIdentity({ schemaVersion: 1, kind: "HistoricalBoundaryCommitMarker", protocol: { name: "head-agent-core-historical-boundary-commit", version: "0.1.0" },
    projectId, boundaryId: boundary.boundaryId, boundaryHash: boundary.boundaryHash, receiptId: receipt.receiptId, receiptHash: receipt.receiptHash, inventoryHash,
    historicalIntegrityBasisHash: projectGraphDigest(historicalIntegrityBasis(boundary, receipt)), authorityClass: "evidence", instructionAuthority: false, promotionAuthority: false }, "commitId", "commitHash", "historical-boundary-commit");
  const directory = path.join(root, ".head/onboarding/historical-boundaries", boundary.boundaryId); fs.mkdirSync(directory, { recursive: true });
  for (const [name, doc] of Object.entries({ boundary, receipt, commit })) fs.writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(doc));
  const nextPayload = { ...candidateSet, unknowns: [...candidateSet.unknowns,
    { unknownId: "onboarding-unknown-aaaaaaaaaaaaaaaaaaaaaaaa", statement: "Synthetic continuity uncertainty", evidenceIds: [], status: "open" }].sort((a, b) => a.unknownId.localeCompare(b.unknownId)) };
  delete nextPayload.candidateSetId; delete nextPayload.candidateSetHash;
  const current = fixtureIdentity(nextPayload, "candidateSetId", "candidateSetHash", "onboarding-candidates");
  fs.writeFileSync(path.join(root, ".head/onboarding/candidate-sets", `${current.candidateSetId}.json`), JSON.stringify(current));
  return { boundary, receipt: publishHistoricalContinuityReceipt({ root, currentCandidateSet: current }), current };
}

test("committed continuity and exact retained World dependencies agree warm/cold through tamper, deletion, restoration and addition", async t => {
  const { root, started } = await onboardingFixture(t);
  const retained = committedHistoricalFixture(root, started.candidateSet);
  const plan = createWholePlanSnapshot({ root, objective: "Preserve independent work", plan: ["continue"] }).artifact;
  const options = { anchorIds: [retained.current.candidateSetId, plan.wholePlanId], depth: 0 };
  let previous = await assertWarmCold(root, options);
  assert(previous.coverage.layers.some(layer => layer.layer === "onboarding" && layer.status === "verified"), JSON.stringify(previous.integrity.excluded));
  const continuity = path.join(root, ".head/onboarding/historical-continuity", `${retained.receipt.receiptId}.json`);
  const original = fs.readFileSync(continuity);
  for (const content of [Buffer.from(JSON.stringify({ ...retained.receipt, relation: "PROMOTES" })), Buffer.from("{broken")]) {
    fs.writeFileSync(continuity, content); previous = await assertWarmCold(root, options, previous);
    assert(previous.integrity.excluded.some(item => item.layer === "onboarding"));
    assert(previous.nodes.some(node => node.nodeId === plan.wholePlanId));
  }
  fs.writeFileSync(continuity, original); previous = await assertWarmCold(root, options, previous);
  assert(!previous.integrity.excluded.some(item => item.layer === "onboarding"));
  fs.unlinkSync(continuity); previous = await assertWarmCold(root, options, previous);
  assert(!previous.integrity.excluded.some(item => item.layer === "onboarding"));
  fs.writeFileSync(continuity, original); previous = await assertWarmCold(root, options, previous);
  fs.writeFileSync(path.join(path.dirname(continuity), "extra.txt"), "invalid extra entry");
  previous = await assertWarmCold(root, options, previous);
  assert(previous.integrity.excluded.some(item => item.reasonCode === "INVALID_HISTORICAL_CONTINUITY_PATH"));
  fs.unlinkSync(path.join(path.dirname(continuity), "extra.txt"));
  previous = await assertWarmCold(root, options, previous);
  const worldReference = retained.boundary.entries.find(entry => entry.role === "legacy-world-embedding-reference");
  const worldFile = path.join(root, worldReference.path), worldBytes = fs.readFileSync(worldFile);
  fs.writeFileSync(worldFile, "{}"); previous = await assertWarmCold(root, options, previous);
  assert(previous.integrity.excluded.some(item => item.layer === "onboarding" && item.reasonCode === "HISTORICAL_BOUNDARY_INTEGRITY_DRIFT"));
  assert(previous.nodes.some(node => node.nodeId === plan.wholePlanId));
  fs.writeFileSync(worldFile, worldBytes); previous = await assertWarmCold(root, options, previous);
  assert(!previous.integrity.excluded.some(item => item.layer === "onboarding"));
});

test("optional adapter failures coalesce per basis and fall back to verified embedded graph", async t => {
  const root = fixture(t), world = await buildWorldModel({ root });
  let calls = 0;
  class BrokenAdapter extends InMemoryGraphProjectionAdapter {
    readPointer() { calls += 1; throw Object.assign(new Error("offline"), { code: "ARCADEDB_UNAVAILABLE" }); }
  }
  const adapter = new BrokenAdapter();
  const before = headFiles(root);
  const first = await queryProjectGraph({ root, query: "module.mjs", graphProjectionAdapter: adapter });
  assert(first.nodes.length);
  assert.equal(first.adapter.status, "unavailable");
  assert.equal(first.adapter.fallbackReasonCode, "ARCADEDB_UNAVAILABLE");
  assert.equal(first.adapter.acceleratesCombinedTraversal, false);
  assert.equal(calls, 1);
  const second = await queryProjectGraph({ root, query: "module.mjs", graphProjectionAdapter: adapter });
  assert.equal(second.resultId, first.resultId); assert.equal(calls, 1);
  assert.equal(second.basis.worldModelId, world.snapshot.worldModelId);
  assert.deepEqual(headFiles(root), before); noAuthority(second);
});

test("verified optional adapter retains exact query semantics without claiming whole retrieval acceleration", async t => {
  const root = fixture(t), world = await buildWorldModel({ root });
  const adapter = new InMemoryGraphProjectionAdapter();
  materializeGraphProjection({ projectRoot: root, graph: world.snapshot.temporalProvenanceGraph, adapter });
  const result = await queryProjectGraph({ root, query: "answer", graphProjectionAdapter: adapter });
  assert.equal(result.adapter.status, "verified");
  assert.equal(result.adapter.scope, "temporal-query-verification");
  assert.equal(result.adapter.fallbackUsed, false);
  assert.equal(result.adapter.acceleratesCombinedTraversal, false);
  noAuthority(result);
});

test("same path in retained World revisions remains separate; generated installation drift is no discovery gate", async t => {
  const root = fixture(t), first = await buildWorldModel({ root });
  fs.writeFileSync(path.join(root, "module.mjs"), "export const answer = 64;\n");
  const second = await buildWorldModel({ root });
  fs.appendFileSync(path.join(root, ".head/generated/head-instructions.md"), "\nlocal generated drift\n");
  assert.equal(inspectProject(root).status, "drifted");
  const a = await queryProjectGraph({ root, worldModelId: first.snapshot.worldModelId, query: "module.mjs" });
  const b = await queryProjectGraph({ root, worldModelId: second.snapshot.worldModelId, query: "module.mjs" });
  const revisionA = a.nodes.find(node => node.kind === "FileRevision" && node.path === "module.mjs");
  const revisionB = b.nodes.find(node => node.kind === "FileRevision" && node.path === "module.mjs");
  assert(revisionA); assert(revisionB); assert.notEqual(revisionA.nodeId, revisionB.nodeId);
  assert.equal(revisionA.snapshotState, "historical");
  assert.equal(revisionA.freshness, "historical-source-bytes");
  assert.equal(revisionB.freshness, "current-source-bytes");
  assert.equal(b.authority.ordinaryWorkBlocked, false);
});

test("source fallback and bounded expansion disclose incompleteness, not a readiness failure", async t => {
  const root = fixture(t, false), before = headFiles(root);
  const missing = await queryProjectGraph({ root, query: "anything" });
  assert.equal(missing.status, "source-fallback"); assert.equal(missing.coverage.emptyResultProvesAbsence, false);
  assert.deepEqual(headFiles(root), before);
  const initialized = fixture(t); await observed(initialized);
  const bounded = await queryProjectGraph({ root: initialized, query: "", depth: 2, maxNodes: 1, maxEdges: 1 });
  assert.equal(bounded.truncated, true); assert.equal(bounded.sourceFallback.needed, true); noAuthority(bounded);
});
