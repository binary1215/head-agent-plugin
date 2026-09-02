import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { initializeProject, inspectProject } from "../scripts/lib/head-core.mjs";
import { buildWorldModel } from "../scripts/lib/world-model.mjs";
import { refreshWorldModel } from "../scripts/lib/incremental-refresh.mjs";
import {
  inspectConformanceQueue,
  prepareConformanceAssessment,
  proposeConformanceFindings,
  proposeConformanceResolution,
  readConformanceFinding,
  recordConformanceDisposition,
} from "../scripts/lib/conformance-reconciliation.mjs";
import { ConformanceTriggerRegistry } from "../scripts/lib/conformance-trigger-adapter.mjs";
import { dispatch as dispatchMcp, tools as mcpTools } from "../scripts/mcp-server.mjs";
import { ingestStructuredObservation } from "../scripts/lib/observation-adapter.mjs";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testParent = process.env.HEAD_AGENT_TEST_TMP || os.tmpdir();
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");

function fixture({ constraints = 1 } = {}) {
  fs.mkdirSync(testParent, { recursive: true });
  const root = fs.mkdtempSync(path.join(testParent, "head-agent-conformance-"));
  initializeProject({ root, pluginRoot, runtimes: ["codex"] });
  const product = {
    schemaVersion: 1,
    featureGroups: [], capabilities: [], features: [], requirements: [], decisions: [],
    constraints: Array.from({ length: constraints }, (_, index) => ({ key: `constraint.${index}`, statement: `Approved constraint ${index}.`, description: "" })),
  };
  fs.writeFileSync(path.join(root, ".head", "context", "product-model.json"), `${JSON.stringify(product, null, 2)}\n`);
  return root;
}

function sourceAnchor(root, relativePath, { startLine = 1, endLine = 1 } = {}) {
  const bytes = fs.readFileSync(path.join(root, ...relativePath.split("/")));
  const lines = bytes.toString("utf8").split(/\r?\n/);
  return {
    kind: "source",
    path: relativePath,
    fileDigest: sha(bytes),
    startLine,
    endLine,
    excerptDigest: sha(Buffer.from(lines.slice(startLine - 1, endLine).join("\n"))),
    revisionId: null,
    symbolId: null,
  };
}

function proposal(root, prepared, relativePath, { constraint = "constraint.0", summary = "Potential mismatch.", riskHint = "medium" } = {}) {
  return {
    root,
    baseline: prepared.baseline,
    findings: [{
      canonAnchor: { entityKind: "Constraint", entityKey: constraint },
      evidenceAnchors: [sourceAnchor(root, relativePath)],
      claim: { kind: "potential-conflict", summary, rationale: "Provider HEAD inferred a possible semantic conflict from the exact cited source.", riskHint },
    }],
  };
}

test("records semantic candidates without Graph, lexical gates, Canon mutation, or ordinary-work blocking", (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "opaque-name.mjs"), "export const value = 1;\n");
  const canonFile = path.join(root, ".head", "context", "product-model.json");
  const sessionFile = path.join(root, ".head", "sessions", "current.json");
  const canonBefore = fs.readFileSync(canonFile, "utf8");
  const sessionBefore = fs.readFileSync(sessionFile, "utf8");

  const prepared = prepareConformanceAssessment({ root });
  assert.equal(prepared.world.status, "unavailable");
  assert.equal(prepared.workflow.graphRequired, false);
  assert.equal(prepared.workflow.userStructuredInputRequired, false);
  const recorded = proposeConformanceFindings(proposal(root, prepared, "src/opaque-name.mjs"));
  assert.equal(recorded.outcome, "accepted-with-disclosure");
  assert.deepEqual(recorded.findings[0].disclosures, ["direct-source-anchor-used", "graph-unavailable"]);
  assert.equal(recorded.ordinaryWorkBlocked, false);
  assert.equal(fs.readFileSync(canonFile, "utf8"), canonBefore);
  assert.equal(fs.readFileSync(sessionFile, "utf8"), sessionBefore);
  assert.equal(inspectProject(root).status, "ready");
  const queue = inspectConformanceQueue({ root });
  assert.equal(queue.findings[0].status, "open");
  assert.equal(queue.ordinaryWorkBlocked, false);
  const exact = readConformanceFinding({ root, findingId: recorded.findings[0].findingId });
  assert.equal(exact.graphProjection.graphPolicy.candidateSpaceHiddenByDefault, true);
  assert.equal(exact.graphProjection.edges.some((edge) => ["VIOLATES", "CONFORMS_TO", "SATISFIES", "RESOLVED"].includes(edge.type)), false);
});

test("converges wording-only duplicates and rejects only stale or unsafe exact evidence", (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "module.mjs"), "export const state = true;\n");
  const prepared = prepareConformanceAssessment({ root });
  const staleProposal = proposal(root, prepared, "src/module.mjs", { summary: "First wording." });
  const first = proposeConformanceFindings(staleProposal);
  const replay = proposeConformanceFindings(proposal(root, prepared, "src/module.mjs", { summary: "Different wording over the same exact claim." }));
  assert.equal(replay.status, "existing");
  assert.equal(replay.findings[0].findingId, first.findings[0].findingId);

  fs.writeFileSync(path.join(root, "src", "module.mjs"), "export const state = false;\n");
  assert.throws(() => proposeConformanceFindings(staleProposal), { code: "CONFORMANCE_SOURCE_DRIFT" });
  const queue = inspectConformanceQueue({ root });
  assert.equal(queue.findings[0].status, "needs-recheck");
  assert.equal(queue.findings[0].currency.reasonCode, "conformance_source_drift");
});

test("converges wording-only duplicate candidates inside one proposal batch", (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "batch.mjs"), "export const state = true;\n");
  const prepared = prepareConformanceAssessment({ root });
  const first = proposal(root, prepared, "src/batch.mjs").findings[0];
  const second = structuredClone(first);
  second.claim.summary = "Different explanatory wording for the same exact semantic anchors.";
  second.claim.rationale = "The provider phrased the same candidate differently in one delivery batch.";
  const recorded = proposeConformanceFindings({ root, baseline: prepared.baseline, findings: [first, second] });
  assert.equal(recorded.status, "recorded");
  assert.equal(recorded.findings.length, 1);
  assert.equal(recorded.convergedInBatchDuplicateCount, 1);
  assert.equal(inspectConformanceQueue({ root }).totalMatches, 1);
  const replay = proposeConformanceFindings({ root, baseline: prepared.baseline, findings: [second, first] });
  assert.equal(replay.status, "existing");
  assert.equal(replay.findings[0].findingId, recorded.findings[0].findingId);
  assert.equal(replay.convergedInBatchDuplicateCount, 1);
});

test("isolates an oversized current source anchor to one needs-recheck queue row", (t) => {
  const root = fixture({ constraints: 2 });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "large.mjs"), "export const large = false;\n");
  fs.writeFileSync(path.join(root, "src", "current.mjs"), "export const current = true;\n");
  const prepared = prepareConformanceAssessment({ root });
  proposeConformanceFindings({
    root,
    baseline: prepared.baseline,
    findings: [
      proposal(root, prepared, "src/large.mjs", { constraint: "constraint.0" }).findings[0],
      proposal(root, prepared, "src/current.mjs", { constraint: "constraint.1" }).findings[0],
    ],
  });
  fs.truncateSync(path.join(root, "src", "large.mjs"), 64 * 1024 * 1024 + 1);
  const queue = inspectConformanceQueue({ root });
  assert.equal(queue.totalMatches, 2);
  const oversized = queue.findings.find((item) => item.canonAnchor.entityKey === "constraint.0");
  const current = queue.findings.find((item) => item.canonAnchor.entityKey === "constraint.1");
  assert.equal(oversized.status, "needs-recheck");
  assert.equal(oversized.currency.reasonCode, "direct-source-anchor-exceeds-current-bound");
  assert.equal(current.currency.state, "current");
});

test("binds optional World source identities to the same exact file", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "first.mjs"), "export const first = true;\n");
  fs.writeFileSync(path.join(root, "src", "second.mjs"), "export const second = true;\n");
  const built = await buildWorldModel({ root });
  const wrongRevision = built.snapshot.temporalProvenanceGraph.nodes.find((node) => node.kind === "FileRevision" && node.path === "src/second.mjs");
  assert.ok(wrongRevision);
  const prepared = prepareConformanceAssessment({ root });
  const attempted = proposal(root, prepared, "src/first.mjs");
  attempted.findings[0].evidenceAnchors[0].revisionId = wrongRevision.nodeId;
  assert.throws(() => proposeConformanceFindings(attempted), { code: "CONFORMANCE_EVIDENCE_NOT_FOUND" });
});

test("keeps dispositions non-authoritative and closes only an explicitly accepted current resolution", (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "policy.mjs"), "export const enabled = false;\n");
  const prepared = prepareConformanceAssessment({ root });
  const recorded = proposeConformanceFindings(proposal(root, prepared, "src/policy.mjs"));
  const findingId = recorded.findings[0].findingId;
  assert.throws(() => recordConformanceDisposition({ root, findingId, disposition: "dismiss", rationale: "No.", confirmUserDisposition: false }), { code: "CONFORMANCE_USER_CONFIRMATION_REQUIRED" });
  assert.throws(() => recordConformanceDisposition({ root, findingId, disposition: "defer", rationale: "Later.", deferUntil: "not-a-date", confirmUserDisposition: true }), { code: "INVALID_CONFORMANCE_DISPOSITION" });
  const requested = recordConformanceDisposition({ root, findingId, disposition: "request-code-fix", rationale: "Prepare a normal bounded fix, without authorizing it.", confirmUserDisposition: true });
  assert.equal(requested.disposition.instructionAuthority, false);
  assert.equal(requested.authority.executionAuthorized, false);
  assert.equal(inspectConformanceQueue({ root }).findings[0].status, "action-requested");

  fs.writeFileSync(path.join(root, "src", "policy.mjs"), "export const enabled = true;\n");
  const fresh = prepareConformanceAssessment({ root });
  const resolutionAnchor = sourceAnchor(root, "src/policy.mjs");
  assert.throws(() => proposeConformanceResolution({ root, findingId, baseline: fresh.baseline, evidenceAnchors: [resolutionAnchor, resolutionAnchor], assessment: "appears-resolved", rationale: "Duplicate evidence must not inflate a reassessment." }), { code: "DUPLICATE_CONFORMANCE_EVIDENCE" });
  const resolution = proposeConformanceResolution({ root, findingId, baseline: fresh.baseline, evidenceAnchors: [resolutionAnchor], assessment: "appears-resolved", rationale: "Provider HEAD reassessed the exact current source." });
  assert.equal(inspectConformanceQueue({ root }).findings[0].status, "needs-recheck");
  const closed = recordConformanceDisposition({ root, findingId, disposition: "accept-resolution", rationale: "Accept this exact resolution candidate.", resolutionId: resolution.resolution.resolutionId, confirmUserDisposition: true });
  assert.equal(closed.disposition.mutatesCanon, false);
  assert.equal(inspectConformanceQueue({ root }).findings[0].status, "closed-resolved");
});

test("pages beyond the sixty-fourth finding and resynchronizes stale read-only cursors", (t) => {
  const root = fixture({ constraints: 65 });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src"));
  for (let index = 0; index < 65; index += 1) fs.writeFileSync(path.join(root, "src", `file-${index}.mjs`), `export const value = ${index};\n`);
  const prepared = prepareConformanceAssessment({ root, limit: 64 });
  assert.equal(prepared.productCanon.entities.length, 64);
  assert.ok(prepared.nextCursor);
  const secondCanonPage = prepareConformanceAssessment({ root, limit: 64, projectionId: prepared.nextCursor.projectionId, cursor: prepared.nextCursor.cursor });
  assert.equal(secondCanonPage.productCanon.entities.length, 1);

  const batch = Array.from({ length: 64 }, (_, index) => proposal(root, prepared, `src/file-${index}.mjs`, { constraint: `constraint.${index}`, summary: `Finding ${index}.` }).findings[0]);
  proposeConformanceFindings({ root, baseline: prepared.baseline, findings: batch });
  proposeConformanceFindings(proposal(root, prepared, "src/file-64.mjs", { constraint: "constraint.64", summary: "Finding 64." }));
  const first = inspectConformanceQueue({ root, limit: 64 });
  assert.equal(first.findings.length, 64);
  assert.ok(first.nextCursor);
  const second = inspectConformanceQueue({ root, limit: 64, projectionId: first.nextCursor.projectionId, cursor: first.nextCursor.cursor });
  assert.equal(second.findings.length, 1);
  recordConformanceDisposition({ root, findingId: first.findings[0].findingId, disposition: "acknowledge", rationale: "Acknowledge one exact item.", confirmUserDisposition: true });
  const resynchronized = inspectConformanceQueue({ root, limit: 64, projectionId: first.nextCursor.projectionId, cursor: first.nextCursor.cursor });
  assert.equal(resynchronized.resynchronization.occurred, true);
  assert.equal(resynchronized.resynchronization.restartedAtFirstPage, true);
});

test("keeps Host triggers optional, coalesced, Project-bound, and uncertain-safe", async (t) => {
  const root = fixture();
  const other = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(other, { recursive: true, force: true }));
  const registry = new ConformanceTriggerRegistry();
  assert.throws(() => registry.register({ root, sourceKey: "monitor", mode: "monitor", providerAssessmentEnabled: true }), { code: "CONFORMANCE_MONITOR_OPT_IN_REQUIRED" });
  const source = registry.register({ root, sourceKey: "interactive", triggerKinds: ["observation"], mode: "opportunistic" });
  assert.equal(source.stateLocation, "host-local-process-memory");
  assert.equal(source.providerIdentityPersisted, false);
  assert.equal(registry.inspect({ root, sourceId: source.sourceId }).nextAction, "continue-ordinary-work");
  assert.equal(registry.prepare({ root, sourceId: source.sourceId }).status, "idle");
  assert.equal(registry.inspect({ root, sourceId: source.sourceId }).source.pendingBatchId, null);
  assert.throws(() => registry.inspect({ root: other, sourceId: source.sourceId }), { code: "CONFORMANCE_TRIGGER_PROJECT_MISMATCH" });
  const observed = await ingestStructuredObservation({
    root,
    binding: { adapterKey: "head.structured-host-observation", adapterVersion: "0.1.0", sourceScopeDigest: sha("trigger-source"), credentialReferenceNames: [] },
    descriptor: { typeKey: "example.trigger", typeVersion: "1.0.0", forms: ["event"], payloadSchema: { fields: [{ key: "changed", type: "boolean", required: true }], additionalFields: false } },
    input: { subject: { type: "example.target", key: "global" }, form: "event", temporalScope: { observedAt: "2026-09-02T00:00:00.000Z", start: null, end: null }, sourceEventKeyDigest: sha("trigger-event"), sourceEvidenceDigest: sha("trigger-evidence"), coverage: { state: "partial", basis: "bounded-event", queryDigest: null, examinedCount: 1, sourceReportedTotal: null, omittedCount: null, cursorStartDigest: null, cursorEndDigest: null }, payload: { changed: true } },
  });
  const trigger = { kind: "observation", artifactId: observed.observation.observationId, artifactHash: observed.observation.observationHash };
  assert.equal(registry.enqueue({ root, sourceId: source.sourceId, trigger }).status, "queued");
  assert.equal(registry.enqueue({ root, sourceId: source.sourceId, trigger }).status, "existing");
  const batch = registry.prepare({ root, sourceId: source.sourceId });
  assert.equal(batch.triggers.length, 1);
  assert.equal(registry.enqueue({ root, sourceId: source.sourceId, trigger }).status, "existing");
  assert.equal(registry.prepare({ root, sourceId: source.sourceId }).batchId, batch.batchId);
  registry.markAssessmentUncertain({ root, sourceId: source.sourceId });
  assert.throws(() => registry.prepare({ root, sourceId: source.sourceId }), { code: "CONFORMANCE_TRIGGER_ASSESSMENT_UNCERTAIN" });
  assert.throws(() => registry.completeAssessment({ root, sourceId: source.sourceId, batchId: batch.batchId }), { code: "CONFORMANCE_TRIGGER_ASSESSMENT_UNCERTAIN" });
  assert.throws(() => registry.clearUncertainAfterUserDecision({ root, sourceId: source.sourceId }), { code: "CONFORMANCE_TRIGGER_RETRY_CONFIRMATION_REQUIRED" });
  registry.clearUncertainAfterUserDecision({ root, sourceId: source.sourceId, confirmUserRetryDecision: true });
  assert.equal(registry.prepare({ root, sourceId: source.sourceId }).batchId, batch.batchId);
  registry.completeAssessment({ root, sourceId: source.sourceId, batchId: batch.batchId });
  assert.equal(registry.inspect({ root, sourceId: source.sourceId }).source.pendingBatchId, null);
});

test("retains queued triggers when preparation fails before batch commit", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const registry = new ConformanceTriggerRegistry();
  const source = registry.register({ root, sourceKey: "atomic-prepare", triggerKinds: ["observation"], mode: "opportunistic" });
  const observed = await ingestStructuredObservation({
    root,
    binding: { adapterKey: "head.structured-host-observation", adapterVersion: "0.1.0", sourceScopeDigest: sha("atomic-trigger-source"), credentialReferenceNames: [] },
    descriptor: { typeKey: "example.atomic-trigger", typeVersion: "1.0.0", forms: ["event"], payloadSchema: { fields: [{ key: "changed", type: "boolean", required: true }], additionalFields: false } },
    input: { subject: { type: "example.target", key: "global" }, form: "event", temporalScope: { observedAt: "2026-09-02T00:00:00.000Z", start: null, end: null }, sourceEventKeyDigest: sha("atomic-trigger-event"), sourceEvidenceDigest: sha("atomic-trigger-evidence"), coverage: { state: "partial", basis: "bounded-event", queryDigest: null, examinedCount: 1, sourceReportedTotal: null, omittedCount: null, cursorStartDigest: null, cursorEndDigest: null }, payload: { changed: true } },
  });
  registry.enqueue({ root, sourceId: source.sourceId, trigger: { kind: "observation", artifactId: observed.observation.observationId, artifactHash: observed.observation.observationHash } });
  const canonFile = path.join(root, ".head", "context", "product-model.json");
  const canonBytes = fs.readFileSync(canonFile);
  fs.writeFileSync(canonFile, "{ invalid json\n");
  assert.throws(() => registry.prepare({ root, sourceId: source.sourceId }), { code: "INVALID_PRODUCT_MODEL_JSON" });
  const afterFailure = registry.inspect({ root, sourceId: source.sourceId }).source;
  assert.equal(afterFailure.queuedTriggerCount, 1);
  assert.equal(afterFailure.pendingBatchId, null);
  fs.writeFileSync(canonFile, canonBytes);
  const batch = registry.prepare({ root, sourceId: source.sourceId });
  assert.equal(batch.triggers.length, 1);
  assert.equal(registry.inspect({ root, sourceId: source.sourceId }).source.queuedTriggerCount, 0);
});

test("reports refresh omission counts only in the batch that owns the coalesced receipt", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src"));
  const sourceFile = path.join(root, "src", "refresh.mjs");
  fs.writeFileSync(sourceFile, "export const revision = 0;\n");
  await buildWorldModel({ root });
  const registry = new ConformanceTriggerRegistry();
  const source = registry.register({ root, sourceKey: "refresh-coalescing", triggerKinds: ["observation", "refresh-receipt"], mode: "opportunistic" });
  const enqueueRefresh = (receipt) => registry.enqueue({ root, sourceId: source.sourceId, trigger: { kind: "refresh-receipt", artifactId: receipt.refreshReceiptId, artifactHash: receipt.refreshReceiptHash } });

  fs.writeFileSync(sourceFile, "export const revision = 1;\n");
  const first = await refreshWorldModel({ root });
  enqueueRefresh(first.receipt);
  fs.writeFileSync(sourceFile, "export const revision = 2;\n");
  const second = await refreshWorldModel({ root });
  enqueueRefresh(second.receipt);
  const observed = await ingestStructuredObservation({
    root,
    binding: { adapterKey: "head.structured-host-observation", adapterVersion: "0.1.0", sourceScopeDigest: sha("coalescing-page-source"), credentialReferenceNames: [] },
    descriptor: { typeKey: "example.coalescing-page", typeVersion: "1.0.0", forms: ["event"], payloadSchema: { fields: [{ key: "changed", type: "boolean", required: true }], additionalFields: false } },
    input: { subject: { type: "example.target", key: "global" }, form: "event", temporalScope: { observedAt: "2026-09-02T00:00:00.000Z", start: null, end: null }, sourceEventKeyDigest: sha("coalescing-page-event"), sourceEvidenceDigest: sha("coalescing-page-evidence"), coverage: { state: "partial", basis: "bounded-event", queryDigest: null, examinedCount: 1, sourceReportedTotal: null, omittedCount: null, cursorStartDigest: null, cursorEndDigest: null }, payload: { changed: true } },
  });
  registry.enqueue({ root, sourceId: source.sourceId, trigger: { kind: "observation", artifactId: observed.observation.observationId, artifactHash: observed.observation.observationHash } });
  assert.equal(registry.inspect({ root, sourceId: source.sourceId }).source.queuedCoalescedRefreshCount, 1);
  const leadingBatch = registry.prepare({ root, sourceId: source.sourceId, limit: 1 });
  assert.equal(leadingBatch.triggers[0].kind, "observation");
  assert.equal(leadingBatch.coalescedRefreshCount, 0);
  assert.equal(registry.inspect({ root, sourceId: source.sourceId }).source.queuedCoalescedRefreshCount, 1);
  registry.completeAssessment({ root, sourceId: source.sourceId, batchId: leadingBatch.batchId });
  const firstBatch = registry.prepare({ root, sourceId: source.sourceId });
  assert.equal(firstBatch.coalescedRefreshCount, 1);
  assert.equal(firstBatch.triggers[0].artifactId, second.receipt.refreshReceiptId);
  registry.completeAssessment({ root, sourceId: source.sourceId, batchId: firstBatch.batchId });

  fs.writeFileSync(sourceFile, "export const revision = 3;\n");
  const third = await refreshWorldModel({ root });
  enqueueRefresh(third.receipt);
  fs.writeFileSync(sourceFile, "export const revision = 4;\n");
  const fourth = await refreshWorldModel({ root });
  enqueueRefresh(fourth.receipt);
  const secondBatch = registry.prepare({ root, sourceId: source.sourceId });
  assert.equal(secondBatch.coalescedRefreshCount, 1);
  assert.equal(secondBatch.triggers[0].artifactId, fourth.receipt.refreshReceiptId);
  registry.markAssessmentUncertain({ root, sourceId: source.sourceId });
  registry.clearUncertainAfterUserDecision({ root, sourceId: source.sourceId, confirmUserRetryDecision: true });
  assert.equal(registry.prepare({ root, sourceId: source.sourceId }).coalescedRefreshCount, 1);
});

test("exposes the same conversational Core flow through typed MCP without Host configuration", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "mcp.mjs"), "export const mcp = true;\n");
  const requiredTools = ["head_conformance_prepare", "head_conformance_propose", "head_conformance_queue", "head_conformance_read", "head_conformance_disposition", "head_conformance_resolution_propose", "head_conformance_trigger_status", "head_conformance_trigger_prepare"];
  assert.equal(requiredTools.every((name) => mcpTools.some((tool) => tool.name === name)), true);
  const preparedResponse = await dispatchMcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "head_conformance_prepare", arguments: { project_root: root } } });
  const prepared = preparedResponse.result.structuredContent;
  const anchor = sourceAnchor(root, "src/mcp.mjs");
  const proposedResponse = await dispatchMcp({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "head_conformance_propose", arguments: {
    project_root: root,
    baseline: { product_model_id: prepared.baseline.productModelId, product_model_hash: prepared.baseline.productModelHash, world_model_id: null, world_model_hash: null, source_snapshot_id: null, graph_snapshot_id: null },
    findings: [{ canon_anchor: { entity_kind: "Constraint", entity_key: "constraint.0" }, evidence_anchors: [{ kind: "source", path: anchor.path, file_digest: anchor.fileDigest, start_line: anchor.startLine, end_line: anchor.endLine, excerpt_digest: anchor.excerptDigest, revision_id: null, symbol_id: null }], claim: { kind: "potential-conflict", summary: "MCP candidate.", rationale: "Provider HEAD cites exact evidence.", risk_hint: "unknown" } }],
  } } });
  assert.equal(proposedResponse.result.structuredContent.ordinaryWorkBlocked, false);
  const unavailable = await dispatchMcp({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "head_conformance_trigger_status", arguments: { project_root: root, source_id: `conformance-trigger-source-${"0".repeat(24)}` } } });
  assert.equal(unavailable.result.structuredContent.status, "optional-host-adapter-unavailable");
  assert.equal(unavailable.result.structuredContent.ordinaryWorkBlocked, false);
});
