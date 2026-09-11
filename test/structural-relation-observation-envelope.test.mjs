import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import {
  buildStructuralRelationObservationEnvelope,
  verifyStructuralRelationObservationEnvelope,
} from "../scripts/lib/structural-relation-observation-envelope.mjs";

const enc = new TextEncoder();
const digest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const range = (line, start, end) => ({ start: { line, character: start }, end: { line, character: end } });
const ids = (document) => new Map(document.rawRefs.map((entry) => [entry.kind, entry.rawRefId]));

function fixture({ lineEnding = "\n", callerText = null } = {}) {
  const caller = callerText ?? ["export function caller() {", "  target(); target();", "}", ""].join(lineEnding);
  const target = ["export function target() {}", ""].join(lineEnding);
  const sourceBytesByPath = new Map([["src/caller.ts", enc.encode(caller)], ["src/target.ts", enc.encode(target)]]);
  const rawBytesById = new Map([["raw-a", enc.encode('{"method":"callHierarchy/outgoingCalls","result":"A"}')], ["raw-b", enc.encode('{"method":"callHierarchy/outgoingCalls","result":"B"}')]]);
  const callerDigest = digest(sourceBytesByPath.get("src/caller.ts"));
  const targetDigest = digest(sourceBytesByPath.get("src/target.ts"));
  const endpoint = (name, path, sha256, end) => ({ path, digest: sha256, name, symbolKind: "function", declarationRange: { start: { line: 0, character: 0 }, end }, selectionRange: range(0, 16, 16 + name.length) });
  const admittedSources = [{ path: "src/caller.ts", digest: callerDigest }, { path: "src/target.ts", digest: targetDigest }];
  const draft = {
    projectId: "seo-r1-test",
    sourceManifest: [{ path: "src/caller.ts", language: "typescript" }, { path: "src/target.ts", language: "typescript" }],
    producerClaims: [{ producerClaimKey: "producer", name: "fixture-producer", version: "1", executableIdentity: "fixture-executable", profileIdentity: "fixture-profile", reportedTransport: "lsp", reportedMethod: "callHierarchy/outgoingCalls", analysisMethodClaim: { reportedValue: "language-service", reportSource: "observer-recorded", truthStatus: "unknown" }, producerIdentityEvidenceStatus: "partial" }],
    rawRefs: [{ rawRefKey: "raw-a", kind: "accepted-decoded-record-a", mediaType: "application/json" }, { rawRefKey: "raw-b", kind: "accepted-decoded-record-b", mediaType: "application/json" }],
    runs: ["a", "b"].map((suffix) => ({ runKey: `run-${suffix}`, producerClaimKey: "producer", inputBinding: { sourceManifestScope: "full", configDigest: "1".repeat(64), profileDigest: "2".repeat(64), normalizerVersion: "0.3.0", normalizerImplementationDigest: "3".repeat(64) }, coverage: { admittedSources, queriedDirection: "outgoing", queriedSymbols: [{ path: "src/caller.ts", digest: callerDigest, name: "caller", symbolKind: "function", line: 0 }], reportedResponseClosure: "complete-frame-observed", programCoverage: "unknown", repositoryRelationCompleteness: "not-claimed" }, rawRefKeys: [`raw-${suffix}`] })),
    pairs: [{ pairKey: "calls", type: "CALLS", from: endpoint("caller", "src/caller.ts", callerDigest, { line: 2, character: 1 }), to: endpoint("target", "src/target.ts", targetDigest, { line: 0, character: 27 }), language: "typescript", occurrences: [
      { occurrenceKey: "first", evidence: { path: "src/caller.ts", digest: callerDigest, range: range(1, 2, 8) }, supports: [{ runKey: "run-a", rawRefKey: "raw-a" }, { runKey: "run-b", rawRefKey: "raw-b" }] },
      { occurrenceKey: "second", evidence: { path: "src/caller.ts", digest: callerDigest, range: range(1, 12, 18) }, supports: [{ runKey: "run-a", rawRefKey: "raw-a" }, { runKey: "run-b", rawRefKey: "raw-b" }] },
    ] }],
    diagnosticLabels: ["fixture-only"],
  };
  return { draft, sourceBytesByPath, rawBytesById };
}

function build(value = fixture()) { return { value, document: buildStructuralRelationObservationEnvelope(value.draft, { sourceBytesByPath: value.sourceBytesByPath, rawBytesById: value.rawBytesById }) }; }
function verifierRawMap(value, document) { const map = ids(document); return new Map([[map.get("accepted-decoded-record-a"), value.rawBytesById.get("raw-a")], [map.get("accepted-decoded-record-b"), value.rawBytesById.get("raw-b")]]); }
function clone(value) { return structuredClone(value); }

test("SEO01 unknown claim survives strong integrity verification without truth promotion", () => {
  const { value, document } = build();
  const result = verifyStructuralRelationObservationEnvelope(document, { sourceBytesByPath: value.sourceBytesByPath, rawBytesById: verifierRawMap(value, document) });
  assert.equal(result.verificationReport.finalStrongVerification, true);
  assert.equal(result.verificationReport.claimTruthVerification, "not-supported");
  assert.equal(document.producerClaims[0].analysisMethodClaim.truthStatus, "unknown");
  const bad = clone(value.draft); bad.producerClaims[0].analysisMethodClaim.truthStatus = "proven";
  assert.throws(() => buildStructuralRelationObservationEnvelope(bad, { sourceBytesByPath: value.sourceBytesByPath, rawBytesById: value.rawBytesById }), { code: "UNSUPPORTED_STRUCTURAL_RELATION_TRUTH_STATUS" });
});

test("SEO02 unrelated but correct raw stays opaque and semantic support is not evaluated", () => {
  const value = fixture(); value.rawBytesById.set("raw-a", enc.encode("delete everything now"));
  const { document } = build(value); const report = verifyStructuralRelationObservationEnvelope(document, { sourceBytesByPath: value.sourceBytesByPath, rawBytesById: verifierRawMap(value, document) }).verificationReport;
  assert.equal(report.rawByteIntegrity, "passed"); assert.equal(report.rawSemanticSupportVerification, "not-evaluated");
});

test("SEO03 coordinates support LF and CRLF, reject BOM, fatal UTF-8, lone CR, and surrogate splits", () => {
  assert.equal(build(fixture({ lineEnding: "\r\n" })).document.pairs[0].occurrences.length, 2);
  for (const bytes of [new Uint8Array([0xef, 0xbb, 0xbf, 0x61]), new Uint8Array([0xff]), enc.encode("export function caller() {\r  target(); target();\r}\r")]) {
    const value = fixture(); value.sourceBytesByPath.set("src/caller.ts", bytes); assert.throws(() => build(value));
  }
  const value = fixture({ callerText: "export function caller() {\n  😀target(); target();\n}\n" }); value.draft.pairs[0].occurrences[0].evidence.range = range(1, 3, 10); assert.throws(() => build(value), { code: "STRUCTURAL_RELATION_COORDINATE_MISMATCH" });
});

test("SEO04 supports aggregate A/B and reject run sources outside admitted subset", () => {
  const { document } = build(); assert.equal(document.pairs[0].occurrences.flatMap((entry) => entry.supports).length, 4);
  const value = fixture(); value.draft.runs[0].inputBinding.sourceManifestScope = "subset"; value.draft.runs[0].coverage.admittedSources = [value.draft.runs[0].coverage.admittedSources[0]];
  assert.throws(() => build(value), { code: "STRUCTURAL_RELATION_RUN_SOURCE_MISMATCH" });
  const golden = JSON.parse(readFileSync(new URL("./fixtures/structural-relation-observation-envelope/accepted-rw-envelope.golden.json", import.meta.url), "utf8"));
  assert.deepEqual(golden.fixtureProvenance.selectedRows, ["unmodifiedRealA", "unmodifiedRealB"]);
  assert.equal(golden.fixtureProvenance.rawRepresentation, "canonical JSON bytes of accepted decoded rawEvidence record, not original wire stream");
  assert.deepEqual(golden.counts, { sources: 4, producerClaims: 1, rawRefs: 2, runs: 2, pairs: 2, occurrences: 2, supports: 4 });
  assert.equal(golden.envelope.envelopeId, "structural-envelope-c0ae50aacd67101b3bca6dc8");
  assert.equal(golden.envelope.envelopeHash, "c0ae50aacd67101b3bca6dc8900ba4f3774fede8a6d5654570bbe9c2278f520c");
  assert.deepEqual(verifyStructuralRelationObservationEnvelope(golden.envelope).verificationReport, golden.structuralReport);
  assert.equal(golden.strongReport.finalStrongVerification, true);
  assert.equal(golden.realSupport, false);
  assert.equal(golden.generalProjectSupport, false);
  assert.equal(golden.e1bEligible, false);
  assert.equal(golden.authority, "ephemeral-host-evidence-only");
});

test("SEO05 projection and run/raw/support closure fail closed", () => {
  const { value, document } = build(); const omitted = clone(document); omitted.candidateProjection.entries[0].occurrenceIds.pop(); assert.throws(() => verifyStructuralRelationObservationEnvelope(omitted), { code: "NON_CANONICAL_STRUCTURAL_RELATION_OBSERVATION" });
  const orphan = clone(value.draft); const orphanRun = { ...clone(orphan.runs[0]), runKey: "orphan", rawRefKeys: ["raw-a"] }; orphanRun.inputBinding.profileDigest = "4".repeat(64); orphan.runs.push(orphanRun); assert.throws(() => build({ ...value, draft: orphan }), { code: "STRUCTURAL_RELATION_CLOSURE_MISMATCH" });
});

test("SEO06 byte maps distinguish omitted, partial, extra, swapped, length and byte drift", () => {
  const { value, document } = build(); const structural = verifyStructuralRelationObservationEnvelope(document); assert.equal(structural.verificationReport.sourceByteIntegrity, "not-run"); assert.equal(structural.verificationReport.finalStrongVerification, false);
  const raw = verifierRawMap(value, document); assert.equal(verifyStructuralRelationObservationEnvelope(document, { rawBytesById: raw }).verificationReport.sourceCoordinateValidation, "not-run");
  const partial = new Map(raw); partial.delete([...partial.keys()][0]); assert.throws(() => verifyStructuralRelationObservationEnvelope(document, { rawBytesById: partial }), { code: "STRUCTURAL_RELATION_BYTE_MAP_MISMATCH" });
  const extra = new Map(raw); extra.set("extra", enc.encode("x")); assert.throws(() => verifyStructuralRelationObservationEnvelope(document, { rawBytesById: extra }), { code: "STRUCTURAL_RELATION_BYTE_MAP_MISMATCH" });
  const rawIds = [...raw.keys()]; const swapped = new Map([[rawIds[0], raw.get(rawIds[1])], [rawIds[1], raw.get(rawIds[0])]]); assert.throws(() => verifyStructuralRelationObservationEnvelope(document, { rawBytesById: swapped }), { code: "STRUCTURAL_RELATION_BYTE_MAP_MISMATCH" });
  const wrong = new Map(raw); wrong.set([...wrong.keys()][0], enc.encode("x")); assert.throws(() => verifyStructuralRelationObservationEnvelope(document, { rawBytesById: wrong }), { code: "STRUCTURAL_RELATION_BYTE_MAP_MISMATCH" });
  assert.throws(() => verifyStructuralRelationObservationEnvelope(document, { rawBytesById: { ...raw } }), { code: "INVALID_STRUCTURAL_RELATION_BYTE_MAP" });
});

test("SEO07 coverage unknown/not-claimed is preserved and exaggeration is rejected", () => {
  const { document } = build(); assert.ok(document.runs.every((run) => run.coverage.programCoverage === "unknown" && run.coverage.repositoryRelationCompleteness === "not-claimed"));
  const value = fixture(); value.draft.runs[0].coverage.repositoryRelationCompleteness = "complete"; assert.throws(() => build(value), { code: "UNSUPPORTED_STRUCTURAL_RELATION_COVERAGE" });
});

test("SEO08 source path/digest binding has no automatic rebinding", () => {
  const { value, document } = build(); const changed = new Map(value.sourceBytesByPath); changed.set("src/caller.ts", enc.encode("changed")); assert.throws(() => verifyStructuralRelationObservationEnvelope(document, { sourceBytesByPath: changed }), { code: "STRUCTURAL_RELATION_BYTE_MAP_MISMATCH" });
});

test("SEO09 producer transport, method claim, and truth status remain distinct", () => {
  const { document } = build(); const claim = document.producerClaims[0]; assert.equal(claim.reportedTransport, "lsp"); assert.equal(claim.reportedMethod, "callHierarchy/outgoingCalls"); assert.equal(claim.analysisMethodClaim.reportedValue, "language-service"); assert.equal(claim.analysisMethodClaim.truthStatus, "unknown");
});

test("SEO10 authority fields reject while imperative raw remains opaque", () => {
  const { document } = build(); const bad = clone(document); bad.instructionAuthority = true; assert.throws(() => verifyStructuralRelationObservationEnvelope(bad), { code: "UNSUPPORTED_STRUCTURAL_RELATION_AUTHORITY" });
  const value = fixture(); value.draft.instructionAuthority = true; assert.throws(() => build(value), { code: "UNSUPPORTED_STRUCTURAL_RELATION_OBSERVATION_FIELD" });
});

test("SEO11 envelope is isolated and rejects legacy kind", async () => {
  const legacy = await import("../scripts/lib/source-relation-evidence.mjs");
  const analysis = await import("../scripts/lib/source-analysis.mjs");
  const graphApi = await import("../scripts/lib/semantic-graph.mjs");
  const caller = "export function caller() { target(); }\n";
  const target = "export function target() {}\n";
  const files = [["src/caller.ts", caller], ["src/target.ts", target]].map(([path, content]) => ({
    path,
    digest: digest(Buffer.from(content)),
    language: "typescript",
    classification: "source",
    symbols: analysis.extractSourceSymbols(content, "typescript"),
    dependencies: analysis.extractSourceDependencies(content, "typescript", path.split("/").at(-1)),
    semanticFacts: analysis.extractSemanticSourceFacts(content, "typescript"),
  }));
  const manifest = files.map(({ path, digest: sha256, language }) => ({ path, digest: sha256, language }));
  const evidence = legacy.buildSourceRelationEvidenceSet({
    projectId: "legacy-seo-baseline",
    files: manifest,
    analyzer: { name: "legacy-fixture", version: "1", method: "ast" },
    relations: [{
      type: "CALLS",
      from: { kind: "symbol", path: "src/caller.ts", name: "caller", symbolKind: "function", line: 1 },
      to: { kind: "symbol", path: "src/target.ts", name: "target", symbolKind: "function", line: 1 },
      evidence: { path: "src/caller.ts", line: 1, digest: manifest[0].digest },
      language: "typescript",
    }],
  });
  const graph = graphApi.buildSemanticGraph({ files, sourceRelationEvidence: evidence });
  assert.equal(evidence.evidenceSetId, "source-relation-evidence-2a3612e23ebe669d19e70bcd");
  assert.equal(evidence.evidenceSetHash, "2a3612e23ebe669d19e70bcd5b819453a6cd6844c4d16d3a5ca3437d91bbdda2");
  assert.equal(graph.semanticGraphId, "semantic-graph-d4b9ddfb4b6ff9b205818d8f");
  assert.equal(graph.semanticGraphHash, "d4b9ddfb4b6ff9b205818d8fe6df669f7962a0f8d2637bba16c25166143646c1");
  assert.deepEqual(graph.summary, { nodeCount: 4, edgeCount: 3, fileNodeCount: 2, symbolNodeCount: 2, externalDependencyNodeCount: 0, importEdgeCount: 0, callEdgeCount: 1, astEvidenceEdgeCount: 1, unresolvedImportCount: 0, unresolvedCallCount: 1 });
  const { document } = build(); assert.throws(() => legacy.verifySourceRelationEvidenceSet(document));
});

test("SEO12 caps, exact fields, canonical order, cycles, duplicate occurrence and support reject", () => {
  const value = fixture(); value.draft.extra = true; assert.throws(() => build(value), { code: "UNSUPPORTED_STRUCTURAL_RELATION_OBSERVATION_FIELD" });
  const cyclic = fixture(); cyclic.draft.self = cyclic.draft; assert.throws(() => build(cyclic), { code: "STRUCTURAL_RELATION_OBSERVATION_LIMIT" });
  const duplicateOccurrence = fixture(); duplicateOccurrence.draft.pairs[0].occurrences.push(clone(duplicateOccurrence.draft.pairs[0].occurrences[0])); assert.throws(() => build(duplicateOccurrence), { code: "DUPLICATE_STRUCTURAL_RELATION_OBSERVATION_ID" });
  const duplicateSupport = fixture(); duplicateSupport.draft.pairs[0].occurrences[0].supports.push(clone(duplicateSupport.draft.pairs[0].occurrences[0].supports[0])); assert.throws(() => build(duplicateSupport), { code: "DUPLICATE_STRUCTURAL_RELATION_OBSERVATION_ID" });
  const { document } = build(); const reordered = clone(document); reordered.rawRefs.reverse(); assert.throws(() => verifyStructuralRelationObservationEnvelope(reordered), { code: "NON_CANONICAL_STRUCTURAL_RELATION_OBSERVATION" });
  const malformed = clone(document); malformed.pairs = {}; assert.throws(() => verifyStructuralRelationObservationEnvelope(malformed), { code: "STRUCTURAL_RELATION_OBSERVATION_LIMIT" });
  const unsupported = clone(document); unsupported.pairs[0].from.selectionRange = range(3, 0, 1); assert.throws(() => verifyStructuralRelationObservationEnvelope(unsupported), { code: "STRUCTURAL_RELATION_COORDINATE_MISMATCH" });
});

export { fixture, verifierRawMap };
