import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { __private } from "../scripts/lib/lsp-host-bridge.mjs";
import {
  LSP_HOST_REAL_LIMITS,
  LSP_HOST_REFERENCE_WITNESS_PROFILE_KIND,
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
const rwReady = ready && Boolean(process.env.HEAD_LSP_RW_PROFILE_MANIFEST && process.env.HEAD_LSP_RW_SOURCE_ROOT
  && process.env.HEAD_LSP_RW_GOLDEN_FILE && process.env.HEAD_LSP_RW_HEURISTIC_RESULTS && process.env.HEAD_LSP_RW_EVIDENCE_FILE);
const rwTest = rwReady ? test : test.skip;
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

async function runFixture(fixture, options = {}, capture = null) {
  const { wrapperAssertionFailure = false, ...collectorOptions } = options;
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
    ...collectorOptions,
  });
  capture?.({ result, events });
  if (wrapperAssertionFailure) assert.fail("controlled post-collection wrapper assertion failure");
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
  assert.equal(raw.kind, result.profileKind === LSP_HOST_REFERENCE_WITNESS_PROFILE_KIND ? "lsp-real-rw-o-raw-evidence" : "lsp-real-rq-raw-evidence");
  assert.equal(raw.completeness, expectedCompleteness);
  for (const direction of ["outboundWire", "inboundWire", "serverOutboundWire"]) {
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

function decodeWire(record) {
  return new LspFrameParser(LSP_HOST_REAL_LIMITS).feed(Buffer.from(record.body, "base64"));
}

function createEvidenceRecorder(file) {
  if (!file) return { record() {}, finalize() {} };
  const target = path.resolve(file);
  const partsRoot = `${target}.parts`;
  fs.mkdirSync(partsRoot, { recursive: false });
  let sequence = 0;
  let finalized = false;
  return {
    record(label, payload) {
      const safe = String(label).replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 80);
      const part = path.join(partsRoot, `${String(++sequence).padStart(3, "0")}--${safe}.json`);
      fs.writeFileSync(part, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    },
    finalize(payload) {
      if (finalized) throw new Error("Evidence recorder was finalized twice.");
      fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      finalized = true;
    },
  };
}

async function runReferenceWitness({ fixtureId, sources, configText, prepare, profileManifestFile: rwProfile, fault = null, referenceWitnessControl = null, capture = null }) {
  const events = [];
  const result = await __private.collectRealOutgoingCallObservation({
    fixtureId,
    projectId: "lsp-rw-o-witness-project",
    generationDigest: sha256("lsp-rw-o-generation-v1"),
    sources,
    tsconfigText: configText,
    prepare: { path: prepare.path, position: { line: prepare.line, character: prepare.character } },
    profileManifestFile: rwProfile,
    supervisorSelection,
    qaRoot,
    fault,
    referenceWitnessControl,
    onProcessEvent: (event) => events.push(event),
  });
  capture?.({ result, events });
  assert.equal(result.profileKind, LSP_HOST_REFERENCE_WITNESS_PROFILE_KIND);
  assert.equal(result.realSupport, false);
  assert.equal(result.generalProjectSupport, false);
  assert.equal(result.e1bEligible, false);
  assert.equal(result.authority, "ephemeral-host-evidence-only");
  assert.equal(result.copiedInputCoverage, "exact-four-files");
  assert.equal(result.actualTlsProgramCoverage, "not-observable-through-standard-lsp");
  assert.equal(result.actualTlsConfigSelection, "bounded-profile-requested-not-mechanically-proven");
  assert.equal(result.resolutionMetadataCoverage, "compiler-api-probe-only");
  assert.equal(result.dependencyCoverage, "partial-unresolved-external-imports");
  assert.equal(result.filesystemReadIsolation, "not-enforced-unknown");
  assert.equal(result.provenanceClass, "local-download-unverified");
  assert.equal(events.filter((event) => event.type === "spawn").length, events.filter((event) => event.type === "exit").length);
  for (const event of events.filter((item) => item.type === "spawn")) assert.equal(await waitGone(event.pid), true, `Owned RW process ${event.pid} remained alive.`);
  if (result.executionProvenance?.pid) assert.equal(await waitGone(result.executionProvenance.pid), true, `Pinned RW TLS process ${result.executionProvenance.pid} remained alive.`);
  return { result, events };
}

async function compilerApiBoundaryProbe(profile, sources) {
  const typescriptModule = await import(pathToFileURL(path.join(profile.typescript.root, "lib", "typescript.js")).href);
  const ts = typescriptModule.default || typescriptModule;
  const root = "C:/head-rw-o-virtual";
  const sourceMap = new Map(sources.map((source) => [`${root}/${source.path}`, source.text]));
  const options = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    noLib: true,
    noResolve: true,
    types: [],
    plugins: [],
    allowJs: false,
    skipLibCheck: true,
  };
  const observed = [];
  const makeHost = (map) => ({
    getSourceFile(fileName, languageVersion) {
      observed.push({ api: "getSourceFile", fileName, admitted: map.has(fileName) });
      const text = map.get(fileName);
      return text === undefined ? undefined : ts.createSourceFile(fileName, text, languageVersion, true);
    },
    getDefaultLibFileName: () => `${root}/lib.d.ts`,
    writeFile: () => { throw new Error("compiler probe attempted a write"); },
    getCurrentDirectory: () => root,
    getDirectories: () => [],
    fileExists(fileName) { observed.push({ api: "fileExists", fileName, admitted: map.has(fileName) }); return map.has(fileName); },
    readFile(fileName) { observed.push({ api: "readFile", fileName, admitted: map.has(fileName) }); return map.get(fileName); },
    directoryExists: (directory) => directory === root || directory.startsWith(`${root}/`),
    getCanonicalFileName: (fileName) => fileName.toLowerCase(),
    useCaseSensitiveFileNames: () => false,
    getNewLine: () => "\n",
    realpath: (fileName) => fileName,
  });
  const rootNames = [...sourceMap.keys()];
  const program = ts.createProgram({ rootNames, options, host: makeHost(sourceMap) });
  const exact = program.getSourceFiles().map((source) => source.fileName).sort();
  const ambientMap = new Map(sourceMap).set(`${root}/ambient.ts`, "export const ambient = true;\n");
  const ambientProgram = ts.createProgram({ rootNames: [...ambientMap.keys()], options, host: makeHost(ambientMap) });
  const withAmbient = ambientProgram.getSourceFiles().map((source) => source.fileName).sort();
  return {
    kind: "rw-o-compiler-api-boundary-probe",
    options: { ...options, target: "ES2022", module: "ESNext", moduleResolution: "Bundler" },
    exactGetSourceFiles: exact,
    exactCount: exact.length,
    ambientContrastGetSourceFiles: withAmbient,
    ambientContrastCount: withAmbient.length,
    recordedApis: observed,
    actualTlsProgramCoverage: "not-observable-through-standard-lsp",
    actualTlsConfigSelection: "bounded-profile-requested-not-mechanically-proven",
    filesystemReadIsolation: "not-enforced-unknown",
  };
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
  const formatting = __private.realServerRequestReply({ jsonrpc: "2.0", id: 3, method: "workspace/configuration", params: { items: [{ section: "formattingOptions" }, { section: "typescript" }] } });
  assert.deepEqual(formatting.response.result, [{ tabSize: 4, insertSpaces: true }, null]);
  assert.equal(formatting.sideEffect, "none");
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

realTest("RQ fixed publisher trust and admission handles fail closed before launch", async () => {
  const fixture = golden.fixtures[0];
  const valid = JSON.parse(fs.readFileSync(profileManifestFile, "utf8"));
  const alteredRoot = fs.mkdtempSync(path.join(qaRoot, "r1-altered-profile-"));
  try {
    const copiedTls = path.join(alteredRoot, "tls");
    fs.cpSync(valid.packages["typescript-language-server"].root, copiedTls, { recursive: true, force: false, errorOnExist: true });
    const cli = path.join(copiedTls, "lib", "cli.mjs");
    const bytes = fs.readFileSync(cli);
    const altered = Buffer.from(bytes);
    const position = altered.indexOf(0x20);
    assert.ok(position > 0 && position < 40);
    altered[position] = 0x09;
    fs.writeFileSync(cli, altered);
    const forged = structuredClone(valid);
    const tls = forged.packages["typescript-language-server"];
    const cliRecord = tls.files.find((entry) => entry.path === "lib/cli.mjs");
    cliRecord.sha256 = sha256(altered);
    tls.treeDigest = sha256(JSON.stringify(tls.files));
    tls.root = copiedTls;
    forged.entrypoints.tlsCli = { path: cli, sha256: cliRecord.sha256 };
    const forgedFile = path.join(alteredRoot, "profile-manifest.json");
    fs.writeFileSync(forgedFile, `${JSON.stringify(forged, null, 2)}\n`, { flag: "wx" });
    assert.throws(() => __private.verifyRealProfileManifest(forgedFile), { code: "unsupported-profile" });
    const events = [];
    const rejected = await __private.collectRealOutgoingCallObservation({
      fixtureId: fixture.fixtureId,
      projectId: "lsp-real-fixture-project",
      generationDigest,
      sources: fixture.exactSources.map(({ path: sourcePath, text }) => ({ path: sourcePath, text })),
      tsconfigText: fixture.exactTsconfig.text,
      prepare: { path: fixture.prepare.path, position: { line: fixture.prepare.line, character: fixture.prepare.character } },
      profileManifestFile: forgedFile,
      supervisorSelection,
      qaRoot,
      onProcessEvent: (event) => events.push(event),
    });
    assert.equal(rejected.status, "blocked");
    assert.equal(rejected.reason, "unsupported-profile");
    assert.equal(events.length, 0);
  } finally {
    fs.rmSync(alteredRoot, { recursive: true, force: true });
  }

  const unsupportedRoot = fs.mkdtempSync(path.join(qaRoot, "unsupported path-"));
  const opened = new Map();
  const actualOpen = fs.openSync;
  const actualClose = fs.closeSync;
  const events = [];
  fs.openSync = function trackedOpen(file, ...args) {
    const fd = actualOpen.call(fs, file, ...args);
    if (typeof file === "string" && file.startsWith(`${unsupportedRoot}${path.sep}`)) opened.set(fd, file);
    return fd;
  };
  fs.closeSync = function trackedClose(fd) {
    const value = actualClose.call(fs, fd);
    opened.delete(fd);
    return value;
  };
  try {
    const rejected = await __private.collectRealOutgoingCallObservation({
      fixtureId: fixture.fixtureId,
      projectId: "lsp-real-fixture-project",
      generationDigest,
      sources: fixture.exactSources.map(({ path: sourcePath, text }) => ({ path: sourcePath, text })),
      tsconfigText: fixture.exactTsconfig.text,
      prepare: { path: fixture.prepare.path, position: { line: fixture.prepare.line, character: fixture.prepare.character } },
      profileManifestFile,
      supervisorSelection,
      qaRoot: unsupportedRoot,
      onProcessEvent: (event) => events.push(event),
    });
    assert.equal(rejected.reason, "unsupported-profile");
    assert.equal(events.length, 0);
    assert.equal(opened.size, 0);
  } finally {
    fs.openSync = actualOpen;
    fs.closeSync = actualClose;
    for (const fd of opened.keys()) { try { actualClose.call(fs, fd); } catch {} }
    fs.rmSync(unsupportedRoot, { recursive: true, force: true });
  }
});

realTest("RQ create-only evidence retains actual A/B raw data across a B wrapper assertion failure", { timeout: 60_000 }, async () => {
  const owned = fs.mkdtempSync(path.join(qaRoot, "evidence-failure-"));
  try {
    const file = path.join(owned, "failure-evidence.json");
    const recorder = createEvidenceRecorder(file);
    const fixture = golden.fixtures[0];
    const rows = [];
    let firstRow = null;
    await runFixture(fixture, {}, ({ result, events }) => {
      firstRow = { id: `${fixture.fixtureId}-A`, kind: "actual-real-collection-before-wrapper-validation", status: "collected-unverified", observation: result, events };
      rows.push(firstRow);
      recorder.record(`${fixture.fixtureId}-A-collected`, firstRow);
    });
    const firstEvaluation = evaluate(firstRow.observation, fixture);
    assert.equal(firstEvaluation.verdict, "passed");
    Object.assign(firstRow, { status: "passed", evaluation: firstEvaluation });

    let secondRow = null;
    let observed = null;
    try {
      await runFixture(fixture, { wrapperAssertionFailure: true }, ({ result, events }) => {
        secondRow = { id: `${fixture.fixtureId}-B`, kind: "actual-real-collection-before-wrapper-validation", status: "collected-unverified", observation: result, events };
        rows.push(secondRow);
        recorder.record(`${fixture.fixtureId}-B-collected`, secondRow);
      });
    } catch (error) {
      observed = { name: error.name, code: error.code || null, message: error.message };
    }
    recorder.finalize({ status: "unexpected-failure", unexpectedFailure: observed, rows });
    const artifact = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(artifact.status, "unexpected-failure");
    assert.equal(artifact.unexpectedFailure.message, "controlled post-collection wrapper assertion failure");
    assert.equal(artifact.rows.length, 2);
    assert.equal(fs.readdirSync(`${file}.parts`).length, 2);
    assert.equal(artifact.rows[0].status, "passed");
    assert.equal(artifact.rows[1].status, "collected-unverified");
    for (const row of artifact.rows) {
      assert.equal(row.observation.status, "completed");
      verifyRawEvidence(row.observation, "complete");
    }
  } finally {
    fs.rmSync(owned, { recursive: true, force: true });
  }
});

rwTest("RW-O exact OMO source4 outgoing witness preserves UNKNOWN boundaries and raw controls", { timeout: 120_000 }, async () => {
  const rwProfileFile = path.resolve(process.env.HEAD_LSP_RW_PROFILE_MANIFEST);
  const sourceRoot = path.resolve(process.env.HEAD_LSP_RW_SOURCE_ROOT);
  const rwGoldenFile = path.resolve(process.env.HEAD_LSP_RW_GOLDEN_FILE);
  const heuristicFile = path.resolve(process.env.HEAD_LSP_RW_HEURISTIC_RESULTS);
  const recorder = createEvidenceRecorder(path.resolve(process.env.HEAD_LSP_RW_EVIDENCE_FILE));
  const rows = [];
  let evidence = null;
  let unexpectedFailure = null;
  try {
    const goldenBytes = fs.readFileSync(rwGoldenFile);
    const rwGolden = JSON.parse(goldenBytes);
    const heuristicBytes = fs.readFileSync(heuristicFile);
    const heuristic = JSON.parse(heuristicBytes);
    assert.equal(rwGolden.kind, "head.lsp.reference-witness.omo-lsp-core-outgoing-golden");
    assert.equal(rwGolden.profileVersion, "rw-o-1");
    assert.equal(rwGolden.normalizerVersion, "0.3.0");
    assert.equal(rwGolden.direction, "outgoing");
    assert.equal(rwGolden.sourcePaths.length, 4);
    assert.equal(rwGolden.expectedRelations.length, 2);
    assert.equal(JSON.parse(rwGolden.configText).compilerOptions.noResolve, true);
    const sources = rwGolden.sourcePaths.map((relativePath) => {
      const file = path.join(sourceRoot, ...relativePath.split("/"));
      const text = fs.readFileSync(file, "utf8");
      return { path: relativePath, text, file, bytes: Buffer.byteLength(text), sha256: sha256(Buffer.from(text)) };
    });
    const sourceBefore = sources.map(({ path: relativePath, file, bytes, sha256: digest }) => ({ path: relativePath, file, bytes, sha256: digest }));
    assert.deepEqual(heuristic.sourceManifest.map(({ path: relativePath, bytes, sha256: digest }) => ({ path: relativePath, bytes, sha256: digest })), sourceBefore.map(({ path: relativePath, bytes, sha256: digest }) => ({ path: relativePath, bytes, sha256: digest })));
    const profile = __private.verifyRealProfileManifest(rwProfileFile);
    assert.equal(profile.kind, LSP_HOST_REFERENCE_WITNESS_PROFILE_KIND);
    assert.equal(profile.profileVersion, "rw-o-1");
    assert.equal(profile.direction, "outgoing");
    assert.equal(profile.normalizerVersion, "0.3.0");

    const compilerProbe = await compilerApiBoundaryProbe(profile, sources);
    assert.equal(compilerProbe.exactCount, 4);
    assert.equal(compilerProbe.ambientContrastCount, 5);
    assert.deepEqual(compilerProbe.exactGetSourceFiles.map((file) => file.slice("C:/head-rw-o-virtual/".length)), [...rwGolden.sourcePaths].sort());
    assert.ok(compilerProbe.ambientContrastGetSourceFiles.some((file) => file.endsWith("/ambient.ts")));
    const heuristicCases = Object.fromEntries(heuristic.cases.map((item) => [item.id, item.counts]));
    assert.deepEqual(heuristicCases["unmodified-four-files"], { executeLspTool: 0, coerceToolArguments: 0 });
    assert.deepEqual(heuristicCases["direct-execute-runtime-ts"], { executeLspTool: 1, coerceToolArguments: 0 });
    assert.deepEqual(heuristicCases["direct-both-runtime-ts"], { executeLspTool: 1, coerceToolArguments: 1 });

    const collectorBase = {
      projectId: "lsp-rw-o-witness-project",
      generationDigest: sha256("lsp-rw-o-generation-v1"),
      tsconfigText: rwGolden.configText,
      prepare: { path: rwGolden.prepare.path, position: { line: rwGolden.prepare.line, character: rwGolden.prepare.character } },
      profileManifestFile: rwProfileFile,
      supervisorSelection,
      qaRoot,
    };
    const invalidCountEvents = [];
    const invalidCount = await __private.collectRealOutgoingCallObservation({
      ...collectorBase,
      fixtureId: "RW-O-A",
      sources: sources.slice(0, 3),
      onProcessEvent: (event) => invalidCountEvents.push(event),
      maxDocuments: 99,
    });
    assert.equal(invalidCount.status, "blocked");
    assert.equal(invalidCount.reason, "invalid-input");
    assert.equal(invalidCountEvents.length, 0);
    const invalidPathEvents = [];
    const invalidPath = await __private.collectRealOutgoingCallObservation({
      ...collectorBase,
      fixtureId: "RW-O-A",
      sources: sources.map(({ path: relativePath, text }, index) => ({ path: index === 3 ? "packages/lsp-core/src/tools/other.ts" : relativePath, text })),
      onProcessEvent: (event) => invalidPathEvents.push(event),
    });
    assert.equal(invalidPath.status, "blocked");
    assert.equal(invalidPath.reason, "invalid-input");
    assert.equal(invalidPathEvents.length, 0);
    const sourceDriftEvents = [];
    const sourceDrift = await __private.collectRealOutgoingCallObservation({
      ...collectorBase,
      fixtureId: "RW-O-A",
      sources: sources.map(({ path: relativePath, text }, index) => ({ path: relativePath, text: index === 0 ? `${text}\n` : text })),
      onProcessEvent: (event) => sourceDriftEvents.push(event),
    });
    assert.equal(sourceDrift.status, "contaminated");
    assert.equal(sourceDrift.reason, "source-drift");
    assert.equal(sourceDriftEvents.length, 0);
    const configDriftEvents = [];
    const configDrift = await __private.collectRealOutgoingCallObservation({
      ...collectorBase,
      fixtureId: "RW-O-A",
      sources,
      tsconfigText: `${rwGolden.configText}\n`,
      onProcessEvent: (event) => configDriftEvents.push(event),
    });
    assert.equal(configDrift.status, "contaminated");
    assert.equal(configDrift.reason, "config-drift");
    assert.equal(configDriftEvents.length, 0);
    const forgedProfileFile = path.join(qaRoot, `rw-forged-${process.pid}-${crypto.randomUUID()}.json`);
    const forgedProfile = { ...JSON.parse(fs.readFileSync(rwProfileFile, "utf8")), kind: "head.lsp.reference-witness.unreviewed" };
    fs.writeFileSync(forgedProfileFile, `${JSON.stringify(forgedProfile)}\n`, { flag: "wx" });
    try {
      const forgedEvents = [];
      const forged = await __private.collectRealOutgoingCallObservation({ ...collectorBase, fixtureId: "RW-O-A", sources, profileManifestFile: forgedProfileFile, onProcessEvent: (event) => forgedEvents.push(event) });
      assert.equal(forged.status, "blocked");
      assert.equal(forged.reason, "unsupported-profile");
      assert.equal(forgedEvents.length, 0);
    } finally { fs.rmSync(forgedProfileFile, { force: false }); }
    for (const [label, mutate] of [
      ["source", (value) => ({ ...value, sourceManifest: value.sourceManifest.map((record, index) => index === 0 ? { ...record, sha256: sha256("caller-selected-source") } : record) })],
      ["config", (value) => ({ ...value, configDigest: sha256("caller-selected-config") })],
    ]) {
      const file = path.join(qaRoot, `rw-forged-${label}-${process.pid}-${crypto.randomUUID()}.json`);
      fs.writeFileSync(file, `${JSON.stringify(mutate(JSON.parse(fs.readFileSync(rwProfileFile, "utf8"))))}\n`, { flag: "wx" });
      try {
        const events = [];
        const forged = await __private.collectRealOutgoingCallObservation({ ...collectorBase, fixtureId: "RW-O-A", sources, profileManifestFile: file, onProcessEvent: (event) => events.push(event) });
        assert.equal(forged.status, "blocked");
        assert.equal(forged.reason, "unsupported-profile");
        assert.equal(events.length, 0);
      } finally { fs.rmSync(file, { force: false }); }
    }

    const runInput = { sources: sources.map(({ path: relativePath, text }) => ({ path: relativePath, text })), configText: rwGolden.configText, prepare: rwGolden.prepare, profileManifestFile: rwProfileFile };
    let firstRow = null;
    const first = await runReferenceWitness({ ...runInput, fixtureId: "RW-O-A", capture: ({ result, events }) => {
      firstRow = { id: "unmodifiedRealA", status: "collected-unverified", observation: result, events };
      rows.push(firstRow); recorder.record("RW-O-A-collected", firstRow);
    } });
    let secondRow = null;
    const second = await runReferenceWitness({ ...runInput, fixtureId: "RW-O-B", capture: ({ result, events }) => {
      secondRow = { id: "unmodifiedRealB", status: "collected-unverified", observation: result, events };
      rows.push(secondRow); recorder.record("RW-O-B-collected", secondRow);
    } });
    for (const observed of [first.result, second.result]) {
      assert.equal(observed.status, "completed");
      assert.equal(observed.reason, "observed");
      assert.equal(observed.normalizedRelations.length, 2);
      assert.deepEqual(observed.normalizedRelations, rwGolden.expectedRelations);
      assert.equal(observed.rawOutgoingCount, 2);
      verifyRawEvidence(observed, "complete");
      const prepareData = observed.rawEvidence.prepareResponse.body.result[0].data;
      const outgoingRequest = observed.rawEvidence.transcript.body.find((item) => item.direction === "out" && item.message.method === "callHierarchy/outgoingCalls");
      assert.ok(outgoingRequest);
      assert.deepEqual(outgoingRequest.message.params.item.data, prepareData);
      assert.equal(observed.executionProvenance.referenceWitnessControl, null);
    }
    assert.equal(first.result.normalizedObservationDigest, second.result.normalizedObservationDigest);
    Object.assign(firstRow, { status: "passed" });
    Object.assign(secondRow, { status: "passed" });

    let controlRow = null;
    const control = await runReferenceWitness({ ...runInput, fixtureId: "RW-O-CONTROL", referenceWitnessControl: "break-tools-barrel-v1", capture: ({ result, events }) => {
      controlRow = { id: "controlledBrokenBarrel", status: "collected-unverified", observation: result, events, changedCopyOnly: "packages/lsp-core/src/tools.ts" };
      rows.push(controlRow); recorder.record("RW-O-CONTROL-collected", controlRow);
    } });
    assert.equal(control.result.status, "completed");
    assert.equal(control.result.reason, "empty");
    assert.equal(control.result.rawOutgoingCount, 0);
    assert.deepEqual(control.result.normalizedRelations, []);
    assert.equal(control.result.executionProvenance.referenceWitnessControl, "break-tools-barrel-v1");
    verifyRawEvidence(control.result, "complete");
    controlRow.status = "passed";

    let failureRow = null;
    const failure = await runReferenceWitness({ ...runInput, fixtureId: "RW-O-FAILURE", fault: { type: "delete-before-outgoing", relativePath: "packages/lsp-core/src/tools/runtime.ts" }, capture: ({ result, events }) => {
      failureRow = { id: "rawFailurePreservation", status: "collected-unverified", observation: result, events };
      rows.push(failureRow); recorder.record("RW-O-FAILURE-collected", failureRow);
    } });
    assert.equal(failure.result.status, "contaminated");
    assert.equal(failure.result.reason, "source-drift");
    assert.equal(failure.result.publishedCandidateCount, 0);
    verifyRawEvidence(failure.result, "partial");
    failureRow.status = "passed";

    const sourceAfter = sources.map(({ path: relativePath, file }) => {
      const bytes = fs.readFileSync(file);
      return { path: relativePath, file, bytes: bytes.length, sha256: sha256(bytes) };
    });
    assert.deepEqual(sourceAfter, sourceBefore);
    const checks = {
      sourcePreflight: "passed",
      packageProfile: "passed",
      compilerApiBoundaryProbe: "passed",
      heuristicBaseline: "passed",
      unmodifiedRealA: "passed",
      unmodifiedRealB: "passed",
      exactGoldenClosure: "passed",
      rawPreservation: "passed",
      controlledBrokenBarrel: "passed",
      validatorRegression: "passed",
      processCleanup: "passed",
      sourcePreservation: "passed",
      productGitPreservation: "pending-final-qa",
    };
    evidence = {
      schemaVersion: 1,
      kind: "lsp-e1arw-o-runtime-evidence",
      profileManifestDigest: profile.manifestDigest,
      semanticProfileDigest: profile.semanticProfileDigest,
      goldenDigest: sha256(goldenBytes),
      heuristicEvidenceDigest: sha256(heuristicBytes),
      compilerProbe,
      sourceBefore,
      sourceAfter,
      checks,
      finalWitnessVerified: false,
      heuristicGapConfirmed: false,
      pending: ["productGitPreservation", "independent-review"],
      realSupport: false,
      generalProjectSupport: false,
      e1bEligible: false,
      authority: "ephemeral-host-evidence-only",
      rows,
    };
  } catch (error) {
    unexpectedFailure = { name: error.name, code: error.code || null, message: error.message };
    throw error;
  } finally {
    recorder.finalize(evidence || {
      schemaVersion: 1,
      kind: "lsp-e1arw-o-runtime-evidence",
      status: "unexpected-failure",
      finalWitnessVerified: false,
      heuristicGapConfirmed: false,
      realSupport: false,
      generalProjectSupport: false,
      e1bEligible: false,
      authority: "ephemeral-host-evidence-only",
      unexpectedFailure,
      rows,
    });
  }
});

realTest("RQ U01-U07 fresh A/B, E-GOLDEN, V05, and F01-F04 satisfy the closed real fixture contract", { timeout: 240_000 }, async () => {
  const rows = [];
  const byFixture = new Map();
  const recorder = createEvidenceRecorder(process.env.HEAD_LSP_REAL_EVIDENCE_FILE);
  let profile = null;
  let evidence = null;
  let unexpectedFailure = null;
  try {
    assert.equal(golden.schemaVersion, 1);
    assert.equal(golden.evaluatorVersion, evaluatorVersion);
    assert.equal(sha256(goldenBytes), "4fe3a13b5c9b94d69528675ae61c2840e21d5de227714889d4bc76b487827e85");
    profile = __private.verifyRealProfileManifest(profileManifestFile);
    for (const fixture of golden.fixtures) {
      for (const source of fixture.exactSources) assert.equal(sha256(source.text), source.sha256, `${fixture.fixtureId}:${source.path}`);
      assert.equal(sha256(fixture.exactTsconfig.text), fixture.exactTsconfig.sha256, `${fixture.fixtureId}:tsconfig`);
      let firstRow = null;
      const first = await runFixture(fixture, {}, ({ result, events }) => {
        firstRow = { id: `${fixture.fixtureId}-A`, kind: "unmodified-real", status: "collected-unverified", observation: result, events };
        rows.push(firstRow);
        recorder.record(`${fixture.fixtureId}-A-collected`, firstRow);
      });
      let secondRow = null;
      const second = await runFixture(fixture, {}, ({ result, events }) => {
        secondRow = { id: `${fixture.fixtureId}-B`, kind: "unmodified-real-rerun", status: "collected-unverified", observation: result, events };
        rows.push(secondRow);
        recorder.record(`${fixture.fixtureId}-B-collected`, secondRow);
      });
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
      Object.assign(firstRow, { status: "passed", evaluation: firstEvaluation });
      Object.assign(secondRow, { status: "passed", evaluation: secondEvaluation });
      byFixture.set(fixture.fixtureId, first.result);
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
      const record = { transformId, originalBody: capturedResponse, originalDigest: capturedDigest, transformedBody: transformedResponse, transformedDigest: sha256(canonicalJson(transformedResponse)), expectedCode, completeness: "complete" };
      v01Transforms.push(record);
      recorder.record(`V01-${transformId}`, record);
      assert.throws(() => pending.consume(transformedResponse, { replay: "V01" }), { code: expectedCode });
    }
    {
      const pending = createPendingTable({ replay: "V01" });
      const id = pending.issue("outgoing");
      const transformedResponse = { ...capturedResponse, id };
      const record = { transformId: "duplicate-id", originalBody: capturedResponse, originalDigest: capturedDigest, transformedBody: transformedResponse, transformedDigest: sha256(canonicalJson(transformedResponse)), expectedCode: "duplicate-response-id", completeness: "complete" };
      v01Transforms.push(record);
      recorder.record("V01-duplicate-id", record);
      pending.consume(transformedResponse, { replay: "V01" });
      assert.throws(() => pending.consume(transformedResponse, { replay: "V01" }), { code: "duplicate-response-id" });
    }
    rows.push({ id: "V01", kind: "pure-validator-helper-replay", status: "passed", provenance: { actualTransport: false, helper: "createPendingTable" }, transformVersion: "lsp-real-rq-replay-v1", transforms: v01Transforms });

    const v02Transforms = [];
    for (const method of ["workspace/applyEdit", "window/showMessageRequest", "head/unknown"]) {
      const injected = { jsonrpc: "2.0", id: 91, method, params: method === "workspace/applyEdit" ? { edit: { changes: {} } } : {} };
      const reply = __private.realServerRequestReply(injected);
      const record = { method, injectedBody: injected, injectedDigest: sha256(canonicalJson(injected)), replyBody: reply, replyDigest: sha256(canonicalJson(reply)), sideEffect: reply.sideEffect, completeness: "complete" };
      v02Transforms.push(record);
      recorder.record(`V02-${method}`, record);
      if (method === "workspace/applyEdit") { assert.equal(reply.sideEffect, "denied"); assert.equal(reply.response.result.applied, false); }
      else { assert.equal(reply.unsupported, true); assert.equal(reply.response.error.code, -32601); }
    }
    rows.push({ id: "V02", kind: "pure-validator-helper-replay", status: "passed", provenance: { actualTransport: false, helper: "realServerRequestReply", fileSystemObserved: false, fileWriteClaim: null }, transformVersion: "lsp-real-rq-replay-v1", transforms: v02Transforms });

    const preparedCaptured = sealed.rawEvidence.prepareResponse.body.result[0];
    const rawRelationCaptured = sealed.rawEvidence.outgoingOriginalResult.body[0];
    const pinnedCallerUri = preparedCaptured.uri;
    const pinnedTargetUri = rawRelationCaptured.to.uri;
    const nodeUri = (uri) => uri.replace("file:///c%3A/", "file:///C:/");
    const replayDocuments = fixture.exactSources.map((source) => ({ relativePath: source.path, languageId: source.languageId, text: source.text, allowedUris: [source.path === "caller.ts" ? pinnedCallerUri : source.path === "target.ts" ? pinnedTargetUri : pinnedTargetUri.replace("target.ts", source.path), nodeUri(source.path === "caller.ts" ? pinnedCallerUri : source.path === "target.ts" ? pinnedTargetUri : pinnedTargetUri.replace("target.ts", source.path))] }));
    const v03Transforms = [];
    for (const uri of ["file:///d%3A/outside/target.ts", `${pinnedTargetUri}?query=1`, `${pinnedTargetUri}#fragment`, pinnedTargetUri.replace("/target.ts", "/../target.ts")]) {
      const transformedRelation = { ...rawRelationCaptured, to: { ...rawRelationCaptured.to, uri } };
      const record = { originalBody: rawRelationCaptured, originalDigest: sha256(canonicalJson(rawRelationCaptured)), transformedBody: transformedRelation, transformedDigest: sha256(canonicalJson(transformedRelation)), expectedCode: "uri-outside-snapshot", completeness: "complete" };
      v03Transforms.push(record);
      recorder.record("V03-uri-alias", record);
      assert.throws(() => __private.normalizeRealOutgoing(preparedCaptured, [transformedRelation], replayDocuments), { code: "uri-outside-snapshot" });
    }
    rows.push({ id: "V03", kind: "pure-validator-helper-replay", status: "passed", provenance: { actualTransport: false, helper: "normalizeRealOutgoing" }, transformVersion: "lsp-real-rq-replay-v1", transforms: v03Transforms });

    const originalFrame = encodeLspMessage(capturedResponse, LSP_HOST_REAL_LIMITS);
    const v04Transforms = [
      { id: "fatal-utf8", bytes: Buffer.concat([Buffer.from("Content-Length: 1\r\n\r\n"), Buffer.from([0xff])]), code: "invalid-json" },
      { id: "junk-header", bytes: Buffer.from("junk\r\n\r\n{}"), code: "invalid-framing" },
      { id: "oversize", bytes: Buffer.from(`Content-Length: ${LSP_HOST_REAL_LIMITS.maxFrameBytes + 1}\r\n\r\n`), code: "frame-oversize" },
    ];
    const v04Records = v04Transforms.map(({ id, bytes, code }) => ({ id, originalWire: { encoding: "base64", bytes: originalFrame.length, sha256: sha256(originalFrame), body: originalFrame.toString("base64") }, transformedWire: { encoding: "base64", bytes: bytes.length, sha256: sha256(bytes), body: bytes.toString("base64") }, expectedCode: code, completeness: "complete" }));
    for (let index = 0; index < v04Transforms.length; index++) {
      recorder.record(`V04-${v04Transforms[index].id}`, v04Records[index]);
      assert.throws(() => new LspFrameParser(LSP_HOST_REAL_LIMITS).feed(v04Transforms[index].bytes), { code: v04Transforms[index].code });
    }
    rows.push({ id: "V04", kind: "pure-validator-helper-replay", status: "passed", provenance: { actualTransport: false, helper: "LspFrameParser" }, transformVersion: "lsp-real-rq-replay-v1", transforms: v04Records });

    const changedGolden = structuredClone(golden);
    const changed = changedGolden.fixtures[0];
    changed.expectedPresent[0].to.name = "intentionally-wrong-target";
    const changedGoldenBytes = Buffer.from(`${JSON.stringify(changedGolden, null, 2)}\n`, "utf8");
    const changedGoldenDigest = sha256(changedGoldenBytes);
    const originalEvaluation = evaluate(sealed, fixture, sha256(goldenBytes));
    const changedEvaluation = evaluate(sealed, changed, changedGoldenDigest);
    const goldenRow = { id: "E-GOLDEN", kind: "evaluator-unit", status: "collected-unverified", originalGolden: { encoding: "base64", bytes: goldenBytes.length, sha256: sha256(goldenBytes), body: goldenBytes.toString("base64") }, changedGolden: { encoding: "base64", bytes: changedGoldenBytes.length, sha256: changedGoldenDigest, body: changedGoldenBytes.toString("base64") }, originalEvaluation, changedEvaluation, observationDigest: sealed.normalizedObservationDigest };
    rows.push(goldenRow);
    recorder.record("E-GOLDEN-before-assertion", goldenRow);
    assert.notEqual(originalEvaluation.goldenManifestDigest, changedEvaluation.goldenManifestDigest);
    assert.equal(originalEvaluation.verdict, "passed");
    assert.equal(changedEvaluation.verdict, "failed");
    assert.ok(changedEvaluation.expectedPresentMissing > 0);
    assert.ok(changedEvaluation.unlistedAdmittedCount > 0);
    assert.equal(canonicalJson(sealed), sealedBytes);
    goldenRow.status = "passed";

    let transformedRow = null;
    const transformed = await runFixture(fixture, { replayTransform: "add-admitted-self" }, ({ result, events }) => {
      transformedRow = { id: "V05", kind: "actual-bridge-replay-transform", status: "collected-unverified", observation: result, events };
      rows.push(transformedRow);
      recorder.record("V05-collected", transformedRow);
    });
    const transformedEvaluation = evaluate(transformed.result, fixture);
    verifyRawEvidence(transformed.result, "complete");
    assert.equal(transformed.result.rawEvidence.outgoingTransformedResult.transformId, "add-admitted-self");
    assert.equal(transformed.result.rawEvidence.outgoingTransformedResult.transformVersion, "lsp-real-rq-replay-v1");
    assert.notEqual(transformed.result.rawOutgoingDigest, transformed.result.transformedOutgoingDigest);
    assert.equal(transformed.result.normalizedRelations.length, 2);
    assert.equal(transformedEvaluation.verdict, "failed");
    assert.equal(transformedEvaluation.unlistedAdmittedCount, 1);
    assert.ok(transformedEvaluation.reasonCodes.includes("unexpected-admitted-relation"));
    Object.assign(transformedRow, { status: "passed", evaluation: transformedEvaluation });

    const faultCases = [
      ["F01", { type: "kill-during-prepare" }, ["process-crash"]],
      ["F02", { type: "cancel-during-prepare" }, ["cancelled"]],
      ["F03", { type: "delay-prepare-response" }, ["request-timeout"]],
      ["F04", { type: "delete-before-outgoing", relativePath: "target.ts" }, ["source-drift"]],
    ];
    for (const [id, fault, reasons] of faultCases) {
      let row = null;
      const observed = await runFixture(fixture, { fault }, ({ result, events }) => {
        row = { id, kind: "controlled-real-process-fault", status: "collected-unverified", observation: result, events };
        rows.push(row);
        recorder.record(`${id}-collected`, row);
      });
      assert.ok(["failed", "contaminated"].includes(observed.result.status), `${id}:${observed.result.status}`);
      assert.ok(reasons.includes(observed.result.reason), `${id}:${observed.result.reason}`);
      verifyRawEvidence(observed.result, "partial");
      assert.equal(observed.result.publishedCandidateCount, 0);
      assert.equal(observed.result.cleanup.verified, true);
      if (id === "F03") {
        const raw = observed.result.rawEvidence;
        const prepareId = raw.prepareResponse.body.id;
        assert.equal(decodeWire(raw.serverOutboundWire).some((message) => message.id === prepareId && Object.hasOwn(message, "result")), true);
        assert.equal(decodeWire(raw.inboundWire).some((message) => message.id === prepareId && Object.hasOwn(message, "result")), false);
        assert.ok(raw.transportProxy.events.some((event) => event.type === "proxy-held" && event.requestId === prepareId));
        assert.ok(raw.transportProxy.events.some((event) => event.type === "proxy-dropped" && event.requestId === prepareId));
        assert.ok(decodeWire(raw.outboundWire).some((message) => message.method === "$/cancelRequest" && message.params.id === prepareId));
      }
      if (id === "F02") {
        assert.equal(observed.result.transport.externalCancellationHostEvidence.kind, "external-host-cancellation-signal");
        assert.ok(observed.result.rawEvidence.transportProxy.events.some((event) => event.type === "external-cancel-observed"));
        const cancelEvent = observed.result.rawEvidence.transportProxy.events.find((event) => event.type === "external-cancel-observed");
        assert.ok(decodeWire(observed.result.rawEvidence.outboundWire).some((message) => message.method === "$/cancelRequest" && message.params.id === cancelEvent.requestId));
      }
      row.status = "passed";
    }

    evidence = {
      schemaVersion: 2,
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
  } catch (error) {
    unexpectedFailure = { name: error.name, code: error.code || null, message: error.message };
    throw error;
  } finally {
    recorder.finalize(evidence || {
      schemaVersion: 2,
      kind: "lsp-e1arq-real-suite-evidence",
      status: "unexpected-failure",
      goldenManifestDigest: sha256(goldenBytes),
      profileManifestDigest: profile?.manifestDigest || null,
      semanticProfileDigest: profile?.semanticProfileDigest || null,
      realSupport: false,
      generalProjectSupport: false,
      e1bEligible: false,
      isolationLevel: "observational-synthetic-fixture-only",
      authority: "ephemeral-host-evidence-only",
      unexpectedFailure,
      rows,
    });
  }
});
