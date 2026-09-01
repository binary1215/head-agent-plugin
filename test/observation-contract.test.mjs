import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { initializeProject } from "../scripts/lib/head-core.mjs";
import { compileContext } from "../scripts/lib/context-compiler.mjs";
import { ingestStructuredObservation } from "../scripts/lib/observation-adapter.mjs";
import { createObservationTypeDescriptor } from "../scripts/lib/observation-contract.mjs";
import { inspectObservations, loadObservationProjection, queryObservations } from "../scripts/lib/observation-projection.mjs";
import { recordDerivedObservation } from "../scripts/lib/observation-store.mjs";
import { recordProductHypothesis, recordProductSignal } from "../scripts/lib/product-operating-loop.mjs";
import { buildWorldModel } from "../scripts/lib/world-model.mjs";
import { runCommand } from "../scripts/head.mjs";
import { dispatch as dispatchMcp, tools as mcpTools } from "../scripts/mcp-server.mjs";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testParent = process.env.HEAD_AGENT_TEST_TMP || os.tmpdir();
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");

function fixture() {
  fs.mkdirSync(testParent, { recursive: true });
  const root = fs.mkdtempSync(path.join(testParent, "head-agent-observation-"));
  initializeProject({ root, pluginRoot, runtimes: ["codex"] });
  return root;
}

function descriptor(typeKey, fields, forms = ["event", "snapshot", "aggregate"]) {
  return { typeKey, typeVersion: "1.0.0", forms, payloadSchema: { fields, additionalFields: false } };
}

function coverage(overrides = {}) {
  return {
    state: "complete",
    basis: "enumerated-bounded-query",
    queryDigest: sha("query"),
    examinedCount: 1,
    sourceReportedTotal: 1,
    omittedCount: 0,
    cursorStartDigest: null,
    cursorEndDigest: null,
    ...overrides,
  };
}

function binding() {
  return {
    adapterKey: "head.structured-host-observation",
    adapterVersion: "0.1.0",
    sourceScopeDigest: sha("bounded-source-scope"),
    credentialReferenceNames: ["HEAD_TEST_SOURCE_TOKEN"],
  };
}

function input({ suffix, subjectType, payload, form = "event", coverageValue = coverage() }) {
  return {
    subject: { type: subjectType, key: "global" },
    form,
    temporalScope: { observedAt: "2026-09-01T00:00:00.000Z", start: form === "aggregate" ? "2026-08-31T23:00:00.000Z" : null, end: form === "aggregate" ? "2026-09-01T00:00:00.000Z" : null },
    sourceEventKeyDigest: sha(`event:${suffix}`),
    sourceEvidenceDigest: sha(`evidence:${suffix}`),
    coverage: coverageValue,
    payload,
  };
}

test("uses one evidence-only contract across unrelated typed product observations", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const canonFile = path.join(root, ".head", "context", "product-model.json");
  const sessionFile = path.join(root, ".head", "sessions", "current.json");
  const canonBefore = fs.readFileSync(canonFile, "utf8");
  const sessionBefore = fs.readFileSync(sessionFile, "utf8");

  const cases = [
    { key: "head.build.result", type: "head.build.target", fields: [{ key: "succeeded", type: "boolean", required: true }], payload: { succeeded: true } },
    { key: "example.billing.failure-summary", type: "example.billing.checkout", fields: [{ key: "failureCount", type: "nonnegative-integer", required: true }], payload: { failureCount: 3 } },
    { key: "example.support.ticket-volume", type: "example.support.queue", fields: [{ key: "ticketCount", type: "nonnegative-integer", required: true }], payload: { ticketCount: 7 } },
  ];
  const observations = [];
  for (const [index, value] of cases.entries()) {
    const recorded = await ingestStructuredObservation({ root, binding: binding(), descriptor: descriptor(value.key, value.fields), input: input({ suffix: index, subjectType: value.type, payload: value.payload }) });
    observations.push(recorded.observation);
    assert.equal(recorded.authority.productCanonMutated, false);
    assert.equal(recorded.sourceBinding.credentialsPersisted, false);
  }
  assert.equal(fs.readFileSync(canonFile, "utf8"), canonBefore);
  assert.equal(fs.readFileSync(sessionFile, "utf8"), sessionBefore);
  const project = JSON.parse(fs.readFileSync(path.join(root, ".head", "project.json"), "utf8"));
  const projection = loadObservationProjection({ projectRoot: root, projectId: project.projectId });
  assert.equal(projection.observationIds.length, 3);
  assert.deepEqual(projection.graphPolicy.automaticRelations, ["CONFORMS_TO", "DERIVED_FROM", "EVIDENCED_BY"]);
  assert.equal(projection.graphPolicy.automaticSemanticRelations, false);
  assert.equal(projection.nodes.filter((node) => node.kind === "ObservationRecord").every((node) => node.contextEligibility === "exact-evidence-need-only"), true);
  assert.equal(projection.edges.some((edge) => ["IMPACTS", "MEASURES", "MOTIVATES", "GOVERNS"].includes(edge.type)), false);

  const replay = await ingestStructuredObservation({ root, binding: binding(), descriptor: descriptor(cases[0].key, cases[0].fields), input: input({ suffix: 0, subjectType: cases[0].type, payload: cases[0].payload }) });
  assert.equal(replay.status, "existing");
  assert.equal(replay.observation.observationId, observations[0].observationId);
});

test("fails closed for divergent replay, false completeness, and schema or adapter authority drift", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const build = descriptor("head.build.result", [{ key: "succeeded", type: "boolean", required: true }]);
  await ingestStructuredObservation({ root, binding: binding(), descriptor: build, input: input({ suffix: "same", subjectType: "head.build.target", payload: { succeeded: true } }) });
  await assert.rejects(() => ingestStructuredObservation({ root, binding: binding(), descriptor: build, input: input({ suffix: "same", subjectType: "head.build.target", payload: { succeeded: false } }) }), (error) => error.code === "DIVERGENT_OBSERVATION_REPLAY");
  await assert.rejects(() => ingestStructuredObservation({ root, binding: binding(), descriptor: build, input: input({ suffix: "coverage", subjectType: "head.build.target", payload: { succeeded: true }, coverageValue: coverage({ queryDigest: null }) }) }), (error) => error.code === "UNPROVEN_COMPLETE_OBSERVATION_COVERAGE");
  await assert.rejects(() => ingestStructuredObservation({ root, binding: binding(), descriptor: build, input: input({ suffix: "payload", subjectType: "head.build.target", payload: { succeeded: true, productSuccess: true } }) }), (error) => error.code === "INVALID_OBSERVATION_PAYLOAD");
  await assert.rejects(() => ingestStructuredObservation({ root, binding: { ...binding(), adapterKey: "example.other" }, descriptor: build, input: input({ suffix: "adapter", subjectType: "head.build.target", payload: { succeeded: true } }) }), (error) => error.code === "INVALID_OBSERVATION_ADAPTER_AUTHORITY");
});

test("scopes at-most-once replay to the exact adapter and source binding", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const type = descriptor("example.source.event", [{ key: "value", type: "integer", required: true }]);
  const observed = input({ suffix: "shared-upstream-id", subjectType: "example.source.subject", payload: { value: 1 } });
  const firstBinding = binding();
  const secondBinding = { ...binding(), sourceScopeDigest: sha("independent-source-scope") };
  const first = await ingestStructuredObservation({ root, binding: firstBinding, descriptor: type, input: observed });
  const second = await ingestStructuredObservation({ root, binding: secondBinding, descriptor: type, input: observed });
  assert.notEqual(first.observation.observationId, second.observation.observationId);
  assert.equal(inspectObservations({ root }).projection.counts.observations, 2);
  await assert.rejects(() => ingestStructuredObservation({ root, binding: firstBinding, descriptor: type, input: { ...observed, payload: { value: 2 } } }), (error) => error.code === "DIVERGENT_OBSERVATION_REPLAY");
});

test("records deterministic derivation without promoting causal or product meaning", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceDescriptor = descriptor("example.runtime.error-count", [{ key: "count", type: "nonnegative-integer", required: true }], ["aggregate"]);
  const first = await ingestStructuredObservation({ root, binding: binding(), descriptor: sourceDescriptor, input: input({ suffix: "before", subjectType: "example.runtime.service", payload: { count: 2 }, form: "aggregate" }) });
  const second = await ingestStructuredObservation({ root, binding: binding(), descriptor: sourceDescriptor, input: input({ suffix: "after", subjectType: "example.runtime.service", payload: { count: 5 }, form: "aggregate" }) });
  const comparisonDescriptor = createObservationTypeDescriptor(descriptor("example.runtime.error-count-delta", [{ key: "delta", type: "integer", required: true }], ["aggregate"]));
  const derived = recordDerivedObservation({ root, descriptor: comparisonDescriptor, input: {
    subject: { type: "example.runtime.service", key: "global" },
    temporalScope: { observedAt: "2026-09-01T00:05:00.000Z", start: "2026-08-31T23:00:00.000Z", end: "2026-09-01T00:00:00.000Z" },
    inputObservationIds: [first.observation.observationId, second.observation.observationId],
    algorithm: { key: "example.count-delta", version: "1.0.0", digest: sha("count-delta-v1") },
    coverage: coverage({ examinedCount: 2, sourceReportedTotal: 2 }),
    payload: { delta: 3 },
  } });
  assert.equal(derived.derivedObservation.epistemicClass, "derived-projection");
  const project = JSON.parse(fs.readFileSync(path.join(root, ".head", "project.json"), "utf8"));
  const projection = loadObservationProjection({ projectRoot: root, projectId: project.projectId });
  assert.equal(projection.edges.filter((edge) => edge.type === "DERIVED_FROM").length, 2);
  assert.equal(projection.edges.some((edge) => edge.type === "IMPACTS"), false);
});

test("exposes the same bounded contract through CLI and MCP while requiring Host confirmation", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const type = descriptor("head.test.summary", [{ key: "passed", type: "nonnegative-integer", required: true }]);
  const observed = input({ suffix: "cli", subjectType: "head.test.suite", payload: { passed: 4 } });
  const cliInput = path.join(root, "observation-input.json");
  fs.writeFileSync(cliInput, JSON.stringify({ binding: binding(), descriptor: type, input: observed }));
  const cli = await runCommand(["observation-ingest", root, "--input", cliInput]);
  assert.equal(cli.observation.typeKey, "head.test.summary");
  assert.equal(runCommand(["observation-status", root]).projection.counts.observations, 1);
  assert.equal(runCommand(["observation-sources", root]).dynamicProjectCodeLoading, false);
  const cliQuery = runCommand(["observation-query", root, "--type-key", type.typeKey, "--limit", "1"]);
  assert.equal(cliQuery.results[0].observationId, cli.observation.observationId);
  assert.equal(cliQuery.results[0].payload, undefined);
  const cliRead = runCommand(["observation-read", root, "--observation", cli.observation.observationId]);
  assert.equal(cliRead.descriptor.descriptorId, cli.observation.descriptorId);
  assert.equal(cliRead.lineage.receiptId, cli.receipt.receiptId);

  const mcpArguments = {
    project_root: root,
    binding: { adapter_key: binding().adapterKey, adapter_version: binding().adapterVersion, source_scope_digest: binding().sourceScopeDigest, credential_reference_names: binding().credentialReferenceNames },
    descriptor: { type_key: type.typeKey, type_version: type.typeVersion, forms: type.forms, payload_schema: { additional_fields: false, fields: type.payloadSchema.fields } },
    observation: {
      subject: observed.subject, form: observed.form,
      temporal_scope: { observed_at: observed.temporalScope.observedAt, start: observed.temporalScope.start, end: observed.temporalScope.end },
      source_event_key_digest: observed.sourceEventKeyDigest, source_evidence_digest: observed.sourceEvidenceDigest,
      coverage: { state: observed.coverage.state, basis: observed.coverage.basis, query_digest: observed.coverage.queryDigest, examined_count: observed.coverage.examinedCount, source_reported_total: observed.coverage.sourceReportedTotal, omitted_count: observed.coverage.omittedCount, cursor_start_digest: observed.coverage.cursorStartDigest, cursor_end_digest: observed.coverage.cursorEndDigest },
      payload: observed.payload,
    },
    confirm_host_observation: false,
  };
  const denied = await dispatchMcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "head_observation_ingest", arguments: mcpArguments } });
  assert.match(denied.error.message, /exact Host source binding/);
  const accepted = await dispatchMcp({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "head_observation_ingest", arguments: { ...mcpArguments, confirm_host_observation: true } } });
  assert.equal(accepted.result.structuredContent.observation.observationId, cli.observation.observationId);
  const queried = await dispatchMcp({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "head_observation_query", arguments: { project_root: root, type_key: type.typeKey, limit: 1 } } });
  assert.equal(queried.result.structuredContent.results[0].observationId, cli.observation.observationId);
  const itemsType = mcpTools.find((tool) => tool.name === "head_observation_ingest").inputSchema.properties.descriptor.properties.payload_schema.properties.fields.items.properties.items_type.enum;
  assert.equal(itemsType.includes("enum"), false);
});

test("keeps unrelated ProductSignal flow independent from unused Observation storage", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const recorded = await ingestStructuredObservation({
    root,
    binding: binding(),
    descriptor: descriptor("example.optional.event", [{ key: "value", type: "integer", required: true }]),
    input: input({ suffix: "optional", subjectType: "example.optional.subject", payload: { value: 1 } }),
  });
  fs.unlinkSync(path.join(root, ".head", "observations", "receipts", `${recorded.receipt.receiptId}.json`));
  const signal = await recordProductSignal({ root, statement: "A separate user-authored product fact.", source: "user" });
  assert.equal(signal.signal.kind, "ProductSignal");
  await assert.rejects(() => recordProductHypothesis({ root, statement: "This exact observation may matter.", observationIds: [recorded.observation.observationId] }), (error) => error.code === "OBSERVATION_RECEIPT_MISSING");
});

test("bounds Observation status and cursor query without semantic selection", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const type = descriptor("example.query.event", [{ key: "value", type: "integer", required: true }]);
  for (let index = 0; index < 3; index += 1) await ingestStructuredObservation({
    root,
    binding: binding(),
    descriptor: type,
    input: { ...input({ suffix: `query-${index}`, subjectType: "example.query.subject", payload: { value: index } }), temporalScope: { observedAt: `2026-09-01T00:0${index}:00.000Z`, start: null, end: null } },
  });
  const status = inspectObservations({ root });
  assert.equal(status.projection.counts.observations, 3);
  assert.equal(status.projection.nodes, undefined);
  const first = queryObservations({ root, typeKey: type.typeKey, limit: 2 });
  assert.equal(first.returned, 2);
  assert.equal(first.semanticSelection, false);
  assert.equal(first.nextCursor.projectionId, first.sourceProjectionId);
  const second = queryObservations({ root, typeKey: type.typeKey, limit: 2, projectionId: first.nextCursor.projectionId, cursor: first.nextCursor.observationId });
  assert.equal(second.returned, 1);
  assert.equal(second.nextCursor, null);
  assert.deepEqual(new Set([...first.results, ...second.results].map((item) => item.observationId)).size, 3);
  await ingestStructuredObservation({ root, binding: binding(), descriptor: type, input: input({ suffix: "query-new", subjectType: "example.query.subject", payload: { value: 4 } }) });
  assert.throws(() => queryObservations({ root, typeKey: type.typeKey, limit: 2, projectionId: first.nextCursor.projectionId, cursor: first.nextCursor.observationId }), { code: "STALE_OBSERVATION_QUERY_CURSOR" });
});

test("admits Observation evidence only by exact HEAD need and keeps semantic interpretation in a hypothesis", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "service.mjs"), "export const service = true;\n");
  await buildWorldModel({ root });
  const observed = await ingestStructuredObservation({
    root,
    binding: binding(),
    descriptor: descriptor("example.delivery.latency", [{ key: "milliseconds", type: "nonnegative-integer", required: true }]),
    input: input({ suffix: "latency", subjectType: "example.delivery.endpoint", payload: { milliseconds: 42 } }),
  });
  const task = "Investigate the unrelated onboarding experience";
  const withoutExactNeed = compileContext({ root, task });
  assert.deepEqual(withoutExactNeed.capsule.observationEvidence, []);
  assert.equal(withoutExactNeed.capsule.selection.candidateIds.includes(observed.observation.observationId), false);

  const withExactNeed = compileContext({ root, task, evidenceNeeds: [{
    id: "exact-latency-evidence",
    kind: "observation",
    observationIds: [observed.observation.observationId],
    rationale: "Fresh HEAD selected this immutable observation after semantic task analysis.",
  }] });
  assert.equal(withExactNeed.capsule.coverageAssessment.status, "coverage-complete");
  assert.deepEqual(withExactNeed.capsule.observationEvidence.map((item) => item.nodeId), [observed.observation.observationId]);
  assert.equal(withExactNeed.capsule.observationEvidence[0].semanticAuthority, false);

  const hypothesis = await recordProductHypothesis({
    root,
    statement: "The measured latency may contribute to the reported experience.",
    observationIds: [observed.observation.observationId],
    rationale: "This is HEAD-authored inferred meaning, not a fact copied from the adapter.",
  });
  assert.deepEqual(hypothesis.hypothesis.observationIds, [observed.observation.observationId]);
  assert.deepEqual(hypothesis.hypothesis.signalIds, []);
  assert.equal(hypothesis.hypothesis.epistemicClass, "hypothesis");
  assert.equal(hypothesis.hypothesis.promotionAuthority, false);

  assert.throws(() => compileContext({ root, task, evidenceNeeds: [{ id: "invalid-observation", kind: "observation", observationIds: [] }] }), { code: "INVALID_EVIDENCE_NEEDS" });
  await assert.rejects(() => recordProductHypothesis({ root, statement: "Unsupported", observationIds: ["observation-000000000000000000000000"] }), (error) => error.code === "UNKNOWN_OBSERVATION");
});
