import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { __private } from "../scripts/lib/lsp-host-bridge.mjs";
import {
  LSP_HOST_REAL_LIMITS,
  LspFrameParser,
  admittedRealDocumentFromUri,
  canonicalJson,
  createPendingTable,
  encodeLspMessage,
  sha256,
} from "../scripts/lib/lsp-host-protocol.mjs";
import { resolveVerifiedProcessSupervisor } from "../scripts/lib/runtime-process-supervisor.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const goldenFile = path.join(root, "test", "fixtures", "lsp-real-golden.json");
const goldenBytes = fs.readFileSync(goldenFile);
const golden = JSON.parse(goldenBytes);
const ready = Boolean(process.env.HEAD_LSP_REAL_PROFILE_MANIFEST && process.env.HEAD_LSP_QA_ROOT && process.env.HEAD_LSP_SUPERVISOR_ROOT);
const realTest = ready ? test : test.skip;
const qaRoot = ready ? path.resolve(process.env.HEAD_LSP_QA_ROOT) : null;
const profileManifestFile = ready ? path.resolve(process.env.HEAD_LSP_REAL_PROFILE_MANIFEST) : null;
const supervisorSelection = ready ? resolveVerifiedProcessSupervisor({ pluginRoot: process.env.HEAD_LSP_SUPERVISOR_ROOT }) : null;
const generationDigest = sha256("lsp-real-rq-generation-v1");
const evaluatorVersion = "lsp-real-rq-evaluator-v1";

function relationSet(relations) {
  return new Set(relations.map((relation) => canonicalJson(relation)));
}

function evaluate(observation, fixture, manifestDigest = sha256(goldenBytes)) {
  const actual = relationSet(observation.normalizedRelations || []);
  const expected = relationSet(fixture.expectedPresent);
  const absent = relationSet(fixture.expectedAbsent);
  const optional = relationSet(fixture.rawRelationPolicy.allowedOptionalRelations || []);
  const missing = [...expected].filter((relation) => !actual.has(relation));
  const absentViolated = [...actual].filter((relation) => absent.has(relation));
  const unlisted = [...actual].filter((relation) => !expected.has(relation) && !optional.has(relation));
  const rejectedInvalidCount = observation.rejectedInvalidCount || 0;
  const callerMismatch = (observation.normalizedRelations || []).some((relation) => canonicalJson(relation.from) !== canonicalJson(fixture.prepare.expectedCaller));
  const verdict = observation.status === "completed" && missing.length === 0 && absentViolated.length === 0
    && unlisted.length === 0 && rejectedInvalidCount === 0 && !callerMismatch && observation.cleanup?.verified === true ? "passed" : "failed";
  const reasonCodes = [
    ...(missing.length ? ["expected-relation-missing"] : []),
    ...(absentViolated.length ? ["expected-absent-violated"] : []),
    ...(unlisted.length ? ["unexpected-admitted-relation"] : []),
    ...(rejectedInvalidCount ? ["invalid-relation-rejected"] : []),
    ...(callerMismatch ? ["expected-caller-mismatch"] : []),
    ...(observation.cleanup?.verified !== true ? ["cleanup-unverified"] : []),
    ...(observation.status !== "completed" ? ["observation-not-completed"] : []),
  ];
  const evaluation = {
    goldenManifestDigest: manifestDigest,
    evaluatorVersion,
    expectedPresentMatched: fixture.expectedPresent.length - missing.length,
    expectedPresentMissing: missing.length,
    expectedAbsentViolated: absentViolated.length,
    unlistedAdmittedCount: unlisted.length,
    rejectedInvalidCount,
    callerMismatch,
    verdict,
    reasonCodes,
  };
  return { ...evaluation, evaluationDigest: sha256(canonicalJson({
    normalizedObservationDigest: observation.normalizedObservationDigest,
    snapshotObservationDigest: observation.snapshotObservationDigest,
    ...evaluation,
  })) };
}

function processExists(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === "EPERM"; }
}

async function waitGone(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return true;
  const deadline = Date.now() + 3_000;
  while (processExists(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  return !processExists(pid);
}

async function runFixture(fixture, options = {}) {
  const events = [];
  const result = await __private.collectRealOutgoingCallObservation({
    fixtureId: fixture.fixtureId,
    projectId: "lsp-real-fixture-project",
    generationDigest,
    sources: fixture.exactSources.map(({ path: sourcePath, text }) => ({ path: sourcePath, text })),
    tsconfigText: fixture.exactTsconfig.text,
    prepare: { path: fixture.prepare.path, position: { line: fixture.prepare.line, character: fixture.prepare.character } },
    profileManifestFile,
    supervisorSelection,
    qaRoot,
    onProcessEvent: (event) => events.push(event),
    ...options,
  });
  assert.equal(result.realSupport, false);
  assert.equal(result.generalProjectSupport, false);
  assert.equal(result.e1bEligible, false);
  assert.equal(result.isolationLevel, "observational-synthetic-fixture-only");
  assert.equal(result.authority, "ephemeral-host-evidence-only");
  assert.equal(result.publishedCandidateCount, 0);
  assert.equal(events.filter((event) => event.type === "spawn").length, events.filter((event) => event.type === "exit").length);
  for (const event of events.filter((item) => item.type === "spawn")) assert.equal(await waitGone(event.pid), true, `Owned process ${event.pid} remained alive.`);
  if (result.executionProvenance?.pid) assert.equal(await waitGone(result.executionProvenance.pid), true, `Pinned TLS process ${result.executionProvenance.pid} remained alive.`);
  return { result, events };
}

function verifyRawEvidence(result, expectedCompleteness) {
  const raw = result.rawEvidence;
  assert.equal(raw.kind, "lsp-real-rq-raw-evidence");
  assert.equal(raw.completeness, expectedCompleteness);
  for (const direction of ["outboundWire", "inboundWire"]) {
    const bytes = Buffer.from(raw[direction].body, "base64");
    assert.equal(bytes.length, raw[direction].bytes);
    assert.equal(sha256(bytes), raw[direction].sha256);
  }
  assert.equal(sha256(canonicalJson(raw.transcript.body)), raw.transcript.sha256);
  if (raw.prepareResponse) assert.equal(sha256(canonicalJson(raw.prepareResponse.body)), raw.prepareResponse.sha256);
  if (raw.outgoingOriginalResponse) assert.equal(sha256(canonicalJson(raw.outgoingOriginalResponse.body)), raw.outgoingOriginalResponse.sha256);
  assert.equal(sha256(canonicalJson(raw.outgoingOriginalResult.body)), raw.outgoingOriginalResult.sha256);
  assert.equal(sha256(canonicalJson(raw.outgoingTransformedResult.body)), raw.outgoingTransformedResult.sha256);
  assert.equal(sha256(canonicalJson(raw)), result.rawEvidenceDigest);
}

test("RQ profile absence is blocked and never implies real support", async () => {
  const fixture = golden.fixtures[0];
  const result = await __private.collectRealOutgoingCallObservation({ fixtureId: fixture.fixtureId });
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "no-profile");
  assert.equal(result.realSupport, false);
  assert.equal(result.e1bEligible, false);
});

test("RQ V01-V04 replay validators fail closed without invoking a provider", () => {
  const binding = { collectionId: "rq", admissionManifestDigest: sha256("admission"), profileManifestDigest: sha256("profile") };
  const pending = createPendingTable(binding);
  const id = pending.issue("prepare");
  assert.equal(pending.consume({ jsonrpc: "2.0", id, result: [] }, binding).method, "prepare");
  assert.throws(() => pending.consume({ jsonrpc: "2.0", id, result: null }, binding), { code: "duplicate-response-id" });
  assert.throws(() => pending.consume({ jsonrpc: "2.0", id: 991, result: [] }, binding), { code: "unknown-response-id" });

  const apply = __private.realServerRequestReply({ jsonrpc: "2.0", id: 1, method: "workspace/applyEdit", params: { edit: { changes: {} } } });
  assert.deepEqual(apply, { response: { jsonrpc: "2.0", id: 1, result: { applied: false, failureReason: "HEAD real LSP fixture is read-only" } }, unsupported: false, sideEffect: "denied" });
  for (const method of ["window/showMessageRequest", "head/unknown"]) {
    const reply = __private.realServerRequestReply({ jsonrpc: "2.0", id: 2, method, params: {} });
    assert.equal(reply.unsupported, true);
    assert.equal(reply.sideEffect, "none");
    assert.equal(reply.response.error.code, -32601);
  }

  const pinned = "file:///c%3A/qa/target.ts";
  const nodeClient = "file:///C:/qa/target.ts";
  const admitted = { languageId: "typescript", allowedUris: [pinned, nodeClient] };
  for (const uri of ["file:///d%3A/qa/target.ts", `${pinned}?x=1`, `${pinned}#x`, "file:///c%3A/qa/../target.ts", "https://example.invalid/target.ts"]) {
    assert.throws(() => admittedRealDocumentFromUri(uri, [admitted]), { code: "uri-outside-snapshot" });
  }

  const fatal = Buffer.concat([Buffer.from('{"jsonrpc":"2.0","id":1,"result":"'), Buffer.from([0xff]), Buffer.from('"}')]);
  assert.throws(() => new LspFrameParser(LSP_HOST_REAL_LIMITS).feed(Buffer.concat([Buffer.from(`Content-Length: ${fatal.length}\r\n\r\n`), fatal])), { code: "invalid-json" });
  assert.throws(() => new LspFrameParser(LSP_HOST_REAL_LIMITS).feed(Buffer.from("junk\r\n\r\n{}")), { code: "invalid-framing" });
  assert.throws(() => encodeLspMessage({ jsonrpc: "2.0", id: 1, result: "x".repeat(LSP_HOST_REAL_LIMITS.maxFrameBytes) }, LSP_HOST_REAL_LIMITS), { code: "frame-oversize" });
});

test("RQ real normalizer dedupes only exact ranges within one relation after validation", () => {
  const callerText = "export function caller() { object.target(); helper(); }\n";
  const targetText = "export function target() {}\n";
  const callerUri = "file:///c%3A/qa/caller.ts";
  const targetUri = "file:///c%3A/qa/target.ts";
  const documents = [
    { relativePath: "caller.ts", languageId: "typescript", text: callerText, allowedUris: [callerUri, "file:///C:/qa/caller.ts"] },
    { relativePath: "target.ts", languageId: "typescript", text: targetText, allowedUris: [targetUri, "file:///C:/qa/target.ts"] },
  ];
  const prepared = { name: "caller", kind: 12, uri: callerUri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 53 } }, selectionRange: { start: { line: 0, character: 16 }, end: { line: 0, character: 22 } } };
  const target = { name: "target", kind: 12, uri: targetUri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 27 } }, selectionRange: { start: { line: 0, character: 16 }, end: { line: 0, character: 22 } } };
  const helper = { ...target, name: "helper", uri: callerUri, range: prepared.range, selectionRange: { start: { line: 0, character: 43 }, end: { line: 0, character: 49 } } };
  const a = { start: { line: 0, character: 27 }, end: { line: 0, character: 40 } };
  const b = { start: { line: 0, character: 43 }, end: { line: 0, character: 49 } };
  const overlap = { start: { line: 0, character: 30 }, end: { line: 0, character: 40 } };
  for (const [ranges, expected] of [
    [[a, a], { rawFromRangeCount: 2, uniqueFromRangeCount: 1, duplicateFromRangeCount: 1 }],
    [[a, b], { rawFromRangeCount: 2, uniqueFromRangeCount: 2, duplicateFromRangeCount: 0 }],
    [[a, a, b], { rawFromRangeCount: 3, uniqueFromRangeCount: 2, duplicateFromRangeCount: 1 }],
    [[a, overlap], { rawFromRangeCount: 2, uniqueFromRangeCount: 2, duplicateFromRangeCount: 0 }],
  ]) {
    const raw = [{ to: target, fromRanges: ranges }];
    const before = canonicalJson(raw);
    const result = __private.normalizeRealOutgoing(prepared, raw, documents);
    assert.deepEqual(result.rangeCounts, expected);
    assert.equal(canonicalJson(raw), before);
  }
  const separated = __private.normalizeRealOutgoing(prepared, [{ to: target, fromRanges: [a, a] }, { to: helper, fromRanges: [a, a] }], documents);
  assert.equal(separated.normalizedRelations.length, 2);
  assert.deepEqual(separated.rangeCounts, { rawFromRangeCount: 4, uniqueFromRangeCount: 2, duplicateFromRangeCount: 2 });
  assert.throws(() => __private.normalizeRealOutgoing(prepared, [{ to: target, fromRanges: [{ start: { line: 0, character: 999 }, end: { line: 0, character: 1000 } }] }], documents), { code: "invalid-range" });
  assert.throws(() => __private.normalizeRealOutgoing(prepared, [{ to: target, fromRanges: Array(257).fill(a) }], documents), { code: "invalid-hierarchy-result" });
  assert.throws(() => __private.normalizeRealOutgoing(prepared, [{ to: target, fromRanges: [null] }], documents), { code: "invalid-range" });
});

realTest("RQ U01-U07 fresh A/B, E-GOLDEN, V05, and F01-F04 satisfy the closed real fixture contract", { timeout: 240_000 }, async () => {
  assert.equal(golden.schemaVersion, 1);
  assert.equal(golden.evaluatorVersion, evaluatorVersion);
  assert.equal(sha256(goldenBytes), "4fe3a13b5c9b94d69528675ae61c2840e21d5de227714889d4bc76b487827e85");
  const profile = __private.verifyRealProfileManifest(profileManifestFile);
  const rows = [];
  const byFixture = new Map();
  for (const fixture of golden.fixtures) {
    for (const source of fixture.exactSources) assert.equal(sha256(source.text), source.sha256, `${fixture.fixtureId}:${source.path}`);
    assert.equal(sha256(fixture.exactTsconfig.text), fixture.exactTsconfig.sha256, `${fixture.fixtureId}:tsconfig`);
    const first = await runFixture(fixture);
    const second = await runFixture(fixture);
    const firstEvaluation = evaluate(first.result, fixture);
    const secondEvaluation = evaluate(second.result, fixture);
    verifyRawEvidence(first.result, "complete");
    verifyRawEvidence(second.result, "complete");
    assert.equal(firstEvaluation.verdict, "passed", `${fixture.fixtureId}:A ${canonicalJson(firstEvaluation)}`);
    assert.equal(secondEvaluation.verdict, "passed", `${fixture.fixtureId}:B ${canonicalJson(secondEvaluation)}`);
    assert.deepEqual(first.result.normalizedRelations, second.result.normalizedRelations, `${fixture.fixtureId}:relations`);
    assert.equal(first.result.normalizedObservationDigest, second.result.normalizedObservationDigest, `${fixture.fixtureId}:digest`);
    if (fixture.fixtureId === "U06") {
      assert.deepEqual(first.result.rangeCounts, { rawFromRangeCount: 3, uniqueFromRangeCount: 2, duplicateFromRangeCount: 1 });
      const rawTarget = first.result.rawEvidence.outgoingOriginalResult.body.find((relation) => relation.to.name === "target");
      assert.equal(rawTarget.fromRanges.length, 2);
      assert.deepEqual(rawTarget.fromRanges[0], rawTarget.fromRanges[1]);
    }
    byFixture.set(fixture.fixtureId, first.result);
    rows.push({ id: `${fixture.fixtureId}-A`, kind: "unmodified-real", status: "passed", observation: first.result, evaluation: firstEvaluation, events: first.events });
    rows.push({ id: `${fixture.fixtureId}-B`, kind: "unmodified-real-rerun", status: "passed", observation: second.result, evaluation: secondEvaluation, events: second.events });
  }

  const fixture = golden.fixtures[0];
  const sealed = byFixture.get("U01");
  const sealedBytes = canonicalJson(sealed);
  const capturedResponse = sealed.rawEvidence.outgoingOriginalResponse.body;
  const capturedDigest = sha256(canonicalJson(capturedResponse));

  const v01Transforms = [];
  for (const [transformId, transformedId, expectedCode] of [["null-id", null, "unknown-response-id"], ["empty-id", "", "unknown-response-id"], ["late-id", 999, "unknown-response-id"]]) {
    const pending = createPendingTable({ replay: "V01" });
    pending.issue("outgoing");
    const transformedResponse = { ...capturedResponse, id: transformedId };
    assert.throws(() => pending.consume(transformedResponse, { replay: "V01" }), { code: expectedCode });
    v01Transforms.push({ transformId, transformedDigest: sha256(canonicalJson(transformedResponse)), expectedCode });
  }
  {
    const pending = createPendingTable({ replay: "V01" });
    const id = pending.issue("outgoing");
    const transformedResponse = { ...capturedResponse, id };
    pending.consume(transformedResponse, { replay: "V01" });
    assert.throws(() => pending.consume(transformedResponse, { replay: "V01" }), { code: "duplicate-response-id" });
    v01Transforms.push({ transformId: "duplicate-id", transformedDigest: sha256(canonicalJson(transformedResponse)), expectedCode: "duplicate-response-id" });
  }
  rows.push({ id: "V01", kind: "replay-proxy-injection", status: "passed", originalDigest: capturedDigest, transformVersion: "lsp-real-rq-replay-v1", transforms: v01Transforms });

  const v02Transforms = [];
  for (const method of ["workspace/applyEdit", "window/showMessageRequest", "head/unknown"]) {
    const injected = { jsonrpc: "2.0", id: 91, method, params: method === "workspace/applyEdit" ? { edit: { changes: {} } } : {} };
    const reply = __private.realServerRequestReply(injected);
    if (method === "workspace/applyEdit") { assert.equal(reply.sideEffect, "denied"); assert.equal(reply.response.result.applied, false); }
    else { assert.equal(reply.unsupported, true); assert.equal(reply.response.error.code, -32601); }
    v02Transforms.push({ method, injectedDigest: sha256(canonicalJson(injected)), replyDigest: sha256(canonicalJson(reply)), sideEffect: reply.sideEffect });
  }
  rows.push({ id: "V02", kind: "replay-proxy-injection", status: "passed", originalDigest: sealed.rawTranscriptDigest, transformVersion: "lsp-real-rq-replay-v1", transforms: v02Transforms, fileWrites: 0 });

  const preparedCaptured = sealed.rawEvidence.prepareResponse.body.result[0];
  const rawRelationCaptured = sealed.rawEvidence.outgoingOriginalResult.body[0];
  const pinnedCallerUri = preparedCaptured.uri;
  const pinnedTargetUri = rawRelationCaptured.to.uri;
  const nodeUri = (uri) => uri.replace("file:///c%3A/", "file:///C:/");
  const replayDocuments = fixture.exactSources.map((source) => ({ relativePath: source.path, languageId: source.languageId, text: source.text, allowedUris: [source.path === "caller.ts" ? pinnedCallerUri : source.path === "target.ts" ? pinnedTargetUri : pinnedTargetUri.replace("target.ts", source.path), nodeUri(source.path === "caller.ts" ? pinnedCallerUri : source.path === "target.ts" ? pinnedTargetUri : pinnedTargetUri.replace("target.ts", source.path))] }));
  const v03Transforms = [];
  for (const uri of ["file:///d%3A/outside/target.ts", `${pinnedTargetUri}?query=1`, `${pinnedTargetUri}#fragment`, pinnedTargetUri.replace("/target.ts", "/../target.ts")]) {
    const transformedRelation = { ...rawRelationCaptured, to: { ...rawRelationCaptured.to, uri } };
    assert.throws(() => __private.normalizeRealOutgoing(preparedCaptured, [transformedRelation], replayDocuments), { code: "uri-outside-snapshot" });
    v03Transforms.push({ transformedDigest: sha256(canonicalJson(transformedRelation)), expectedCode: "uri-outside-snapshot" });
  }
  rows.push({ id: "V03", kind: "replay-proxy-injection", status: "passed", originalDigest: sha256(canonicalJson(rawRelationCaptured)), transformVersion: "lsp-real-rq-replay-v1", transforms: v03Transforms });

  const originalFrame = encodeLspMessage(capturedResponse, LSP_HOST_REAL_LIMITS);
  const v04Transforms = [
    { id: "fatal-utf8", bytes: Buffer.concat([Buffer.from("Content-Length: 1\r\n\r\n"), Buffer.from([0xff])]), code: "invalid-json" },
    { id: "junk-header", bytes: Buffer.from("junk\r\n\r\n{}"), code: "invalid-framing" },
    { id: "oversize", bytes: Buffer.from(`Content-Length: ${LSP_HOST_REAL_LIMITS.maxFrameBytes + 1}\r\n\r\n`), code: "frame-oversize" },
  ];
  for (const transformedFrame of v04Transforms) assert.throws(() => new LspFrameParser(LSP_HOST_REAL_LIMITS).feed(transformedFrame.bytes), { code: transformedFrame.code });
  rows.push({ id: "V04", kind: "replay-proxy-injection", status: "passed", originalWireDigest: sha256(originalFrame), transformVersion: "lsp-real-rq-replay-v1", transforms: v04Transforms.map(({ id, bytes, code }) => ({ id, transformedWireDigest: sha256(bytes), expectedCode: code })) });

  const changed = structuredClone(fixture);
  changed.expectedPresent[0].to.name = "intentionally-wrong-target";
  const originalEvaluation = evaluate(sealed, fixture);
  const changedEvaluation = evaluate(sealed, changed);
  assert.equal(originalEvaluation.verdict, "passed");
  assert.equal(changedEvaluation.verdict, "failed");
  assert.ok(changedEvaluation.expectedPresentMissing > 0);
  assert.ok(changedEvaluation.unlistedAdmittedCount > 0);
  assert.equal(canonicalJson(sealed), sealedBytes);
  rows.push({ id: "E-GOLDEN", kind: "evaluator-unit", status: "passed", originalEvaluation, changedEvaluation, observationDigest: sealed.normalizedObservationDigest });

  const transformed = await runFixture(fixture, { replayTransform: "add-admitted-self" });
  const transformedEvaluation = evaluate(transformed.result, fixture);
  verifyRawEvidence(transformed.result, "complete");
  assert.equal(transformed.result.rawEvidence.outgoingTransformedResult.transformId, "add-admitted-self");
  assert.equal(transformed.result.rawEvidence.outgoingTransformedResult.transformVersion, "lsp-real-rq-replay-v1");
  assert.notEqual(transformed.result.rawOutgoingDigest, transformed.result.transformedOutgoingDigest);
  assert.equal(transformed.result.normalizedRelations.length, 2);
  assert.equal(transformedEvaluation.verdict, "failed");
  assert.equal(transformedEvaluation.unlistedAdmittedCount, 1);
  assert.ok(transformedEvaluation.reasonCodes.includes("unexpected-admitted-relation"));
  rows.push({ id: "V05", kind: "replay-proxy-injection", status: "passed", observation: transformed.result, evaluation: transformedEvaluation, events: transformed.events });

  const faultCases = [
    ["F01", { type: "kill-during-prepare" }, ["process-crash"]],
    ["F02", { type: "cancel-during-prepare" }, ["cancelled"]],
    ["F03", { type: "delay-prepare-response" }, ["request-timeout"]],
    ["F04", { type: "delete-before-outgoing", relativePath: "target.ts" }, ["source-drift"]],
  ];
  for (const [id, fault, reasons] of faultCases) {
    const observed = await runFixture(fixture, { fault });
    assert.ok(["failed", "contaminated"].includes(observed.result.status), `${id}:${observed.result.status}`);
    assert.ok(reasons.includes(observed.result.reason), `${id}:${observed.result.reason}`);
    verifyRawEvidence(observed.result, "partial");
    assert.equal(observed.result.publishedCandidateCount, 0);
    assert.equal(observed.result.cleanup.verified, true);
    rows.push({ id, kind: "controlled-real-process-fault", status: "passed", observation: observed.result, events: observed.events });
  }

  const evidence = {
    schemaVersion: 1,
    kind: "lsp-e1arq-real-suite-evidence",
    goldenManifestDigest: sha256(goldenBytes),
    profileManifestDigest: profile.manifestDigest,
    semanticProfileDigest: profile.semanticProfileDigest,
    required: { unmodified: 14, faults: 4, validators: 5, golden: 1 },
    actual: { unmodifiedPassed: 14, faultsPassed: 4, validatorsPassed: 5, goldenPassed: 1 },
    fixtureRelationQuality: "verified",
    realServerConformance: true,
    realSupport: false,
    generalProjectSupport: false,
    e1bEligible: false,
    isolationLevel: "observational-synthetic-fixture-only",
    authority: "ephemeral-host-evidence-only",
    rows,
  };
  if (process.env.HEAD_LSP_REAL_EVIDENCE_FILE) fs.writeFileSync(process.env.HEAD_LSP_REAL_EVIDENCE_FILE, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
});
