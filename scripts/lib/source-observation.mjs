import fs from "node:fs";
import path from "node:path";
import { createObservationTypeDescriptor, createObservationRecord, verifyObservationRecord, observationDigest } from "./observation-contract.mjs";
import { recordCollectedObservation } from "./observation-store.mjs";
import { artifactAuthorityBoundary, verifyArtifactAuthorityBoundary } from "./authority-plane-contract.mjs";
import { sourceDigest, sourceObjectDigest, readSourceBytes, sourceCurrent, sourceError, preparePythonObservation } from "./python-source-collector.mjs";

const DIRECTORY = ".head/observations/source-bundles";
export const SOURCE_OBSERVATION_TYPE = "source.structural-context";
const adapterDescriptor = Object.freeze({ adapterKey: "python-stdlib-ast", adapterVersion: "1" });
const observationDataErrors = new Set(["INVALID_OBSERVATION_ARTIFACT", "INVALID_OBSERVATION_COVERAGE", "INVALID_OBSERVATION_DESCRIPTOR", "INVALID_OBSERVATION_INPUT", "INVALID_OBSERVATION_PAYLOAD", "INVALID_OBSERVATION_RECORD", "OBSERVATION_CONTRACT_ERROR", "OBSERVATION_DIGEST_MISMATCH", "UNPROVEN_COMPLETE_OBSERVATION_COVERAGE",
  "UNKNOWN_OBSERVATION_DESCRIPTOR", "INVALID_DERIVED_OBSERVATION", "DERIVED_OBSERVATION_INPUT_MISMATCH", "INVALID_OBSERVATION_RECEIPT", "INVALID_OBSERVATION_RECEIPT_LINEAGE", "OBSERVATION_RECEIPT_MISSING", "DUPLICATE_OBSERVATION_DESCRIPTOR", "DUPLICATE_OBSERVATION_RECORD", "DUPLICATE_OBSERVATION_RECEIPT", "DIVERGENT_OBSERVATION_REPLAY"]);
export function classifySourceStorageError(error) {
  if (observationDataErrors.has(error.code) || ["SOURCE_BUNDLE_JSON_INVALID", "SOURCE_OBSERVATION_INVALID", "SOURCE_RESPONSE_INVALID", "SOURCE_STORAGE_CONFLICT", "OBSERVATION_IMMUTABLE_COLLISION"].includes(error.code)) return "invalid";
  if (["ENOENT", "EACCES", "EPERM", "ENOTDIR", "EISDIR", "ENOSPC", "EROFS", "SOURCE_DRIFT", "SOURCE_BYTE_LIMIT", "SOURCE_STORAGE_UNSAFE", "SOURCE_SYMLINK_UNSUPPORTED", "SOURCE_NOT_REGULAR_FILE", "OBSERVATION_STORE_LIMIT", "OBSERVATION_SYMLINK_PATH", "OBSERVATION_PATH_ESCAPE"].includes(error.code)) return "unavailable";
  return null;
}
function parseStoredJson(bytes) {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch (error) {
    if (error instanceof SyntaxError || error.code === "ERR_ENCODING_INVALID_ENCODED_DATA") throw sourceError("SOURCE_BUNDLE_JSON_INVALID");
    throw error;
  }
}
const recordShape = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
export const sourceObservationDescriptor = createObservationTypeDescriptor({
  typeKey: SOURCE_OBSERVATION_TYPE, typeVersion: "1", forms: ["snapshot"],
  payloadSchema: { additionalFields: false, fields: [
    { key: "bundleKey", type: "sha256", required: true },
    { key: "evidenceKind", type: "enum", enum: ["source", "outgoing-calls"], required: true },
    { key: "path", type: "string", max: 512, required: true },
    { key: "symbol", type: "string", max: 512, required: true },
    { key: "details", type: "string", max: 65536, required: true },
    { key: "sourceDigest", type: "sha256", required: true },
    { key: "unresolvedCount", type: "nonnegative-integer", required: true },
    { key: "omittedSourceBytes", type: "nonnegative-integer", required: true },
  ] },
});

export function sourceBundleKey(evidence) { return sourceObjectDigest(evidence); }

function observationInput(evidence) {
  const file = evidence.sources[0];
  const rawText = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(file.base64, "base64"));
  // End at an actual Unicode boundary, never manufacture a replacement glyph.
  let sourceExcerpt = rawText.slice(0, 60_000);
  while (Buffer.byteLength(sourceExcerpt) > 60_000 || /[\uD800-\uDBFF]$/u.test(sourceExcerpt)) sourceExcerpt = sourceExcerpt.slice(0, -1);
  const result = evidence.response ? JSON.parse(Buffer.from(evidence.response, "base64").toString("utf8")) : null;
  const details = evidence.kind === "outgoing-calls" ? JSON.stringify({
    claimTruth: "unknown", repositoryCompleteness: "not-claimed", profile: evidence.profile.runtime,
    pairs: result.results[0].pairs, unresolved: result.results[0].unresolved,
  }) : sourceExcerpt;
  const queryDigest = sourceObjectDigest(evidence.query);
  const sourceScopeDigest = sourceObjectDigest({ projectId: evidence.projectId, query: evidence.query, sources: evidence.sources.map(({ path, digest }) => ({ path, digest })), profile: evidence.profile });
  const bundleKey = sourceBundleKey(evidence);
  return { sourceScopeDigest, input: {
    subject: { type: "source-scope", key: `scope-${sourceScopeDigest.slice(0, 24)}` }, form: "snapshot",
    temporalScope: { observedAt: evidence.observedAt, start: null, end: null },
    coverage: { state: "partial", basis: "bounded-source-syntax-observation", queryDigest,
      examinedCount: evidence.kind === "outgoing-calls" ? result.results[0].pairs.length : 1, sourceReportedTotal: null, omittedCount: null, cursorStartDigest: null, cursorEndDigest: null },
    sourceEventKeyDigest: bundleKey, sourceEvidenceDigest: bundleKey,
    payload: { bundleKey, evidenceKind: evidence.kind, path: file.path, symbol: evidence.query[0].symbol ?? "",
      details, sourceDigest: file.digest, unresolvedCount: result?.results?.[0]?.unresolved?.length ?? 0,
      omittedSourceBytes: evidence.kind === "source" ? Math.max(0, Buffer.byteLength(rawText) - Buffer.byteLength(sourceExcerpt)) : 0 },
  } };
}

export function createSourceObservation(evidence) {
  const { sourceScopeDigest, input } = observationInput(evidence);
  const observation = createObservationRecord({ projectId: evidence.projectId, descriptor: sourceObservationDescriptor,
    ...input, source: { ...adapterDescriptor, sourceScopeDigest, sourceEventKeyDigest: input.sourceEventKeyDigest, sourceEvidenceDigest: input.sourceEvidenceDigest } });
  return { evidence, descriptor: sourceObservationDescriptor, observation };
}

// This verifies both content and current source bytes for persisted AND ephemeral
// Context consumption. A hash alone is never treated as currentness or truth.
export function verifySourceObservation(root, projectId, bundle, { requireCurrent = true } = {}) {
  if (!recordShape(bundle) || !recordShape(bundle.evidence) || !recordShape(bundle.descriptor) || !recordShape(bundle.observation)) throw sourceError("SOURCE_OBSERVATION_INVALID");
  const { evidence, descriptor, observation } = bundle;
  if (descriptor.descriptorId !== sourceObservationDescriptor.descriptorId || evidence.projectId !== projectId
    || !["source", "outgoing-calls"].includes(evidence.kind) || evidence.version !== 1
    || !Array.isArray(evidence.sources) || evidence.sources.length !== 1 || !Array.isArray(evidence.query) || evidence.query.length !== 1
    || !recordShape(evidence.profile) || !recordShape(evidence.query[0]) || typeof evidence.query[0].path !== "string"
    || typeof evidence.query[0].symbol !== "string") throw sourceError("SOURCE_OBSERVATION_INVALID");
  verifyObservationRecord(observation, descriptor, projectId);
  for (const source of evidence.sources) {
    if (!recordShape(source) || typeof source.path !== "string" || typeof source.base64 !== "string" || !/^[a-f0-9]{64}$/.test(source.digest ?? "")) throw sourceError("SOURCE_OBSERVATION_INVALID");
    if (sourceDigest(Buffer.from(source.base64, "base64")) !== source.digest || source.path !== evidence.query[0].path) throw sourceError("SOURCE_OBSERVATION_INVALID");
    try { new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(source.base64, "base64")); }
    catch (error) { if (error.code === "ERR_ENCODING_INVALID_ENCODED_DATA") throw sourceError("SOURCE_OBSERVATION_INVALID"); throw error; }
  }
  if (evidence.kind === "outgoing-calls") {
    if (typeof evidence.response !== "string" || !recordShape(evidence.profile.runtime) || !recordShape(evidence.profile.implementation)) throw sourceError("SOURCE_OBSERVATION_INVALID");
    const raw = Buffer.from(evidence.response, "base64");
    const result = parseStoredJson(raw);
    const prepared = preparePythonObservation({ projectId, query: evidence.query, sources: evidence.sources, response: { raw, result }, profile: evidence.profile });
    if (prepared.status !== "ready" || prepared.envelope.envelopeHash !== evidence.envelopeHash) throw sourceError("SOURCE_OBSERVATION_INVALID");
  }
  const expected = createSourceObservation(evidence);
  if (expected.observation.observationHash !== observation.observationHash) throw sourceError("SOURCE_OBSERVATION_INVALID");
  if (requireCurrent && !sourceCurrent(root, evidence.sources)) throw sourceError("SOURCE_DRIFT");
  return observation;
}

function directory(root) {
  let current = fs.realpathSync(root);
  for (const segment of DIRECTORY.split("/")) {
    current = path.join(current, segment);
    try { fs.mkdirSync(current); } catch (error) { if (error.code !== "EEXIST") throw error; }
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw sourceError("SOURCE_STORAGE_UNSAFE");
  }
  return current;
}

export function retainSourceObservation(root, bundle) {
  verifySourceObservation(root, bundle.evidence.projectId, bundle);
  const key = sourceBundleKey(bundle.evidence);
  retainBundle(root, key, bundle);
  const { sourceScopeDigest, input } = observationInput(bundle.evidence);
  recordCollectedObservation({ root, descriptor: bundle.descriptor, input, adapterDescriptor, sourceScopeDigest });
  return key;
}

function retainBundle(root, key, bundle) {
  const dir = directory(root);
  const encoded = Buffer.from(JSON.stringify(bundle));
  if (encoded.length > 16 * 1024 * 1024) throw sourceError("SOURCE_BYTE_LIMIT");
  const destination = path.join(dir, `${key}.json`);
  const temporary = path.join(dir, `.pending-${process.pid}-${cryptoRandom()}`);
  try {
    fs.writeFileSync(temporary, encoded, { flag: "wx" });
    try { fs.linkSync(temporary, destination); }
    catch (error) { if (error.code !== "EEXIST") throw error;
      if (!readSourceBytes(root, `${DIRECTORY}/${key}.json`, 16 * 1024 * 1024).equals(encoded)) throw sourceError("SOURCE_STORAGE_CONFLICT"); }
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function cryptoRandom() { return sourceDigest(`${process.hrtime.bigint()}-${Math.random()}`).slice(0, 24); }

export function readSourceObservation(root, projectId, key, options) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw sourceError("SOURCE_BUNDLE_KEY_INVALID");
  const bundle = parseStoredJson(readSourceBytes(root, `${DIRECTORY}/${key}.json`, 16 * 1024 * 1024));
  if (!recordShape(bundle) || !recordShape(bundle.evidence)) throw sourceError("SOURCE_OBSERVATION_INVALID");
  if (sourceBundleKey(bundle.evidence) !== key) throw sourceError("SOURCE_OBSERVATION_INVALID");
  verifySourceObservation(root, projectId, bundle, options);
  return bundle;
}

export function sourceObservationNode(root, projectId, bundle) {
  const record = verifySourceObservation(root, projectId, bundle);
  return { ...record, nodeId: record.observationId, semanticAuthority: false, contextEligibility: "exact-evidence-need-only",
    observationProjectionId: `source-projection-${record.observationHash.slice(0, 24)}`, observationProjectionHash: observationDigest(record) };
}

export function retainSourceFailure(root, input) {
  const failure = { kind: "SourceCollectionFailure", version: 1, ...input,
    authority: "P3-failed-observation-evidence", authorityBoundary: artifactAuthorityBoundary("SourceCollectionFailure"),
    instructionAuthority: false, promotionAuthority: false, recoveryAuthority: false, mutatesCanon: false };
  const key = sourceObjectDigest(failure);
  // Identical source/profile/query/outcome coalesces; polling does not create
  // one artifact per attempt. This is not an execution or retry authorization.
  retainBundle(root, key, { failure });
  return key;
}

export function readSourceFailure(root, projectId, key) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw sourceError("SOURCE_BUNDLE_KEY_INVALID");
  const parsed = parseStoredJson(readSourceBytes(root, `${DIRECTORY}/${key}.json`, 16 * 1024 * 1024));
  if (!recordShape(parsed)) throw sourceError("SOURCE_OBSERVATION_INVALID");
  const { failure } = parsed;
  if (!failure || sourceObjectDigest(failure) !== key || failure.projectId !== projectId
    || failure.kind !== "SourceCollectionFailure" || failure.instructionAuthority !== false
    || failure.promotionAuthority !== false || failure.recoveryAuthority !== false) throw sourceError("SOURCE_OBSERVATION_INVALID");
  verifyArtifactAuthorityBoundary("SourceCollectionFailure", failure.authorityBoundary);
  let sourceState = "not-observed";
  if (failure.sources?.length) {
    try { sourceState = sourceCurrent(root, failure.sources) ? "current-source-bytes" : "stale"; }
    catch { sourceState = "unavailable"; }
  }
  return { failure, sourceState, authority: "historical-failure-evidence-only; never-retry-or-recovery-authority" };
}
