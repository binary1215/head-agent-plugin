import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { atomicCreateArtifact } from "./artifact-storage.mjs";
import { artifactAuthorityBoundary, verifyArtifactAuthorityBoundary } from "./authority-plane-contract.mjs";
import { withProjectMutation } from "./project-mutation-lock.mjs";
import { safeSessionPath, sessionStatePath, sessionDataPath } from "./session-routing.mjs";

// Selected HEAD-authored P3 evidence, not a transcript, direction store, or
// inference engine. Entry never repairs or writes these originals.
export const SESSION_WORK_CONTEXT_VERSION = "0.1.0";
const PROTOCOL = { name: "head-agent-core-session-work-evidence", version: SESSION_WORK_CONTEXT_VERSION };
const MAX_RECORD_BYTES = 64 * 1024;
const MAX_REFERENCE_BYTES = 16 * 1024 * 1024;
const DEFAULT_SCAN = 512;
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const encoded = (value) => JSON.stringify(canonical(value));
function fail(message, code = "INVALID_SESSION_WORK_EVIDENCE") { throw Object.assign(new Error(message), { code }); }
function object(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !allowed.includes(key))) fail(`Invalid ${label} fields.`);
}
function text(value, label) {
  if (typeof value !== "string" || !value.trim()) fail(`${label} must be non-empty text.`);
  return value.trim();
}
function list(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(`${label} must be an array.`);
  return value.map((item) => text(item, label));
}
function relative(value) {
  const name = text(value, "Reference path").replaceAll("\\", "/");
  if (path.isAbsolute(name) || /^[A-Za-z]:/.test(name) || name.split("/").some((part) => !part || part === "." || part === "..")) {
    fail("Reference path must stay inside the exact Project.", "SESSION_WORK_REFERENCE_ESCAPE");
  }
  return name;
}
export function normalizeSessionWorkEvidence(input) {
  object(input, ["summary", "judgments", "observedWork", "pending", "unknowns", "suggestedFollowUp", "references", "occurrenceKey"], "work evidence");
  if (input.judgments !== undefined && !Array.isArray(input.judgments)) fail("Judgments must be an array.");
  if (input.references !== undefined && !Array.isArray(input.references)) fail("References must be an array.");
  const content = {
    summary: input.summary === undefined ? null : text(input.summary, "Summary"),
    judgments: (input.judgments || []).map((item) => {
      object(item, ["assessment", "reason", "alternatives"], "judgment");
      return { assessment: text(item.assessment, "Assessment"), reason: text(item.reason, "Reason"), alternatives: list(item.alternatives, "Alternatives") };
    }),
    observedWork: list(input.observedWork, "Observed work"),
    pending: list(input.pending, "Pending work"),
    unknowns: list(input.unknowns, "Unknowns"),
    suggestedFollowUp: list(input.suggestedFollowUp, "Suggested follow-up"),
    references: (input.references || []).map((item) => {
      object(item, ["path", "digest", "kind"], "reference");
      if (!/^[a-f0-9]{64}$/.test(item.digest || "") || !["source", "artifact"].includes(item.kind)) fail("Reference needs exact SHA-256 and source/artifact kind.");
      return { path: relative(item.path), digest: item.digest, kind: item.kind };
    }),
    // Optional HEAD-owned event distinction. Reusing text is not proof that a
    // new observation happened. No user ID or timestamp form is required.
    occurrenceKey: input.occurrenceKey === undefined ? null : text(input.occurrenceKey, "Occurrence key"),
  };
  if (!content.summary && !content.judgments.length && !content.observedWork.length && !content.pending.length
    && !content.unknowns.length && !content.suggestedFollowUp.length && !content.references.length) fail("Select some meaningful work evidence.");
  if (Buffer.byteLength(encoded(content)) > MAX_RECORD_BYTES - 4096) fail("Selected work evidence exceeds the record bound; retain exact references or separate meaningful segments.", "SESSION_WORK_EVIDENCE_TOO_LARGE");
  return content;
}
function identity(root) {
  const base = fs.realpathSync(path.resolve(root));
  const projectBytes = fs.readFileSync(safeSessionPath(base, ".head", "project.json"));
  const stateBytes = fs.readFileSync(sessionStatePath(base));
  const project = JSON.parse(projectBytes), state = JSON.parse(stateBytes);
  if (project.schemaVersion !== 1 || project.projectRoot !== base || typeof project.projectId !== "string"
    || !/^session-[a-fA-F0-9-]{36}$/.test(state.sessionId || "") || state.projectId && state.projectId !== project.projectId) {
    fail("Work evidence Project/Session identity differs.", "HEAD_SESSION_IDENTITY_MISMATCH");
  }
  return { root: base, projectId: project.projectId, sessionId: state.sessionId, state,
    basis: sha(Buffer.concat([projectBytes, stateBytes])) };
}
function directory(root) { return sessionDataPath(root, "work-evidence"); }
function fileFor(root, evidenceId) {
  if (!/^work-evidence-[a-f0-9]{24}$/.test(evidenceId || "")) fail("Invalid work evidence identity.");
  return safeSessionPath(root, path.relative(root, path.join(directory(root), `${evidenceId}.json`)));
}
function inputIdentity(owner, content) { return sha(encoded({ projectId: owner.projectId, sessionId: owner.sessionId, content })); }
function readOriginal(owner, evidenceId) {
  const file = fileFor(owner.root, evidenceId);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_RECORD_BYTES) fail("Unsafe or oversized work evidence.");
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  object(record, ["schemaVersion", "kind", "subtype", "protocol", "projectId", "sessionId", "content", "recordedAt", "authorityBoundary", "evidenceId", "evidenceDigest"], "work original");
  const { evidenceDigest, ...payload } = record;
  const content = normalizeSessionWorkEvidence(Object.fromEntries(Object.entries(record.content || {}).filter(([, value]) => value !== null)));
  if (record.schemaVersion !== 1 || record.kind !== "Evidence" || record.subtype !== "SessionWorkEvidence"
    || encoded(record.protocol) !== encoded(PROTOCOL) || encoded(content) !== encoded(record.content)
    || record.projectId !== owner.projectId || record.sessionId !== owner.sessionId
    || record.evidenceId !== evidenceId || evidenceId !== `work-evidence-${inputIdentity(owner, content).slice(0, 24)}`
    || evidenceDigest !== sha(encoded(payload)) || !Number.isFinite(Date.parse(record.recordedAt))) {
    fail("Work evidence integrity or owner mismatch.", "SESSION_WORK_EVIDENCE_INTEGRITY");
  }
  verifyArtifactAuthorityBoundary("Evidence", record.authorityBoundary);
  return record;
}
function reference(owner, ref, { saving = false, excerptCharacters = 0 } = {}) {
  try {
    const file = safeSessionPath(owner.root, ref.path);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_REFERENCE_BYTES) fail("Reference bytes unavailable within bounds.", "SESSION_WORK_REFERENCE_UNAVAILABLE");
    const bytes = fs.readFileSync(file);
    if (sha(bytes) !== ref.digest) fail("Reference bytes changed.", "SESSION_WORK_REFERENCE_CHANGED");
    let originalOwner = null;
    if (ref.kind === "artifact") {
      const artifact = JSON.parse(bytes.toString("utf8"));
      if (artifact.projectId !== owner.projectId) fail("Referenced artifact belongs to another Project.", "SESSION_WORK_REFERENCE_PROJECT_MISMATCH");
      originalOwner = { projectId: artifact.projectId, sessionId: artifact.sessionId || null };
    }
    const body = excerptCharacters ? bytes.toString("utf8") : "";
    return { ...ref, status: ref.kind === "artifact" ? "intact-retained-original" : "matching-current-bytes",
      originalOwner, ...(excerptCharacters ? { excerpt: body.slice(0, excerptCharacters), omittedCharacters: Math.max(0, body.length - excerptCharacters) } : {}),
      semanticFreshness: "not-inferred", instructionAuthority: false, recoveryAuthority: false };
  } catch (error) {
    if (saving) throw error;
    return { ...ref, status: "unavailable", reasonCode: error.code || "INVALID_REFERENCE", contentReconstructed: false };
  }
}
export function recordSessionWorkEvidence({ root = ".", input } = {}) {
  const content = normalizeSessionWorkEvidence(input);
  return withProjectMutation({ root, scope: "session-recovery" }, () => {
    const owner = identity(root);
    const evidenceId = `work-evidence-${inputIdentity(owner, content).slice(0, 24)}`;
    const file = fileFor(owner.root, evidenceId);
    // A retry reuses intact originals even if their source has since changed.
    // Revalidation cannot force the caller to redo an already completed effect.
    if (fs.existsSync(file)) {
      const evidence = readOriginal(owner, evidenceId);
      if (encoded(evidence.content) !== encoded(content)) fail("Work evidence identity collision.", "SESSION_WORK_EVIDENCE_CONFLICT");
      return { status: "session_work_evidence_reused", evidence, file, persisted: false, writes: 0, authorityChanged: false, executionReplayAllowed: false };
    }
    content.references.forEach((ref) => reference(owner, ref, { saving: true }));
    if (identity(owner.root).basis !== owner.basis) fail("Session changed before work evidence publication.", "SESSION_WORK_OBSERVATION_CHANGED");
    const payload = { schemaVersion: 1, kind: "Evidence", subtype: "SessionWorkEvidence", protocol: PROTOCOL,
      projectId: owner.projectId, sessionId: owner.sessionId, content, recordedAt: new Date().toISOString(),
      authorityBoundary: artifactAuthorityBoundary("Evidence"), evidenceId };
    const evidence = { ...payload, evidenceDigest: sha(encoded(payload)) };
    fs.mkdirSync(directory(owner.root), { recursive: true });
    fileFor(owner.root, evidenceId); // revalidate new ancestors before publication
    atomicCreateArtifact(file, `${JSON.stringify(evidence, null, 2)}\n`);
    return { status: "session_work_evidence_recorded", evidence, file, persisted: true, writes: 1, authorityChanged: false, executionReplayAllowed: false };
  });
}

// No secondary ledger or index is required for recovery. Default selection
// verifies discovered originals sequentially, retaining only ordering metadata
// and bounded output bodies. Names/metadata remain O(N), not constant memory.
export function readSessionWorkContext({ root = ".", evidenceIds = null, maxRecords = 8, maxCharacters = 32768,
  afterEvidenceId = null, expectedSessionId = null, expectedCheckpointId = undefined } = {}) {
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > DEFAULT_SCAN
    || !Number.isSafeInteger(maxCharacters) || maxCharacters < 2 || maxCharacters > 512 * 1024
    || evidenceIds !== null && (!Array.isArray(evidenceIds) || evidenceIds.length > DEFAULT_SCAN)
    || afterEvidenceId !== null && (!/^work-evidence-[a-f0-9]{24}$/.test(afterEvidenceId) || evidenceIds !== null)) fail("Invalid work context read bounds.");
  const owner = identity(root);
  const shell = { kind: "SessionWorkContextProjection", authorityPlane: "P4", projectId: owner.projectId, sessionId: owner.sessionId,
    sessionPurpose: owner.state.purpose || null, basis: owner.basis, latestCheckpointId: owner.state.latestCheckpoint || null,
    persisted: false, recoveryAuthority: false, instructionAuthority: false, promotionAuthority: false,
    executionReplayAllowed: false, ordinaryWorkBlocked: false,
    interpretation: "P3 HEAD-authored historical evidence, not current direction, approval, or proof of an external effect. Current Project constraints and selected Session P2 take precedence." };
  if (expectedSessionId && owner.sessionId !== expectedSessionId
    || expectedCheckpointId !== undefined && (owner.state.latestCheckpoint || null) !== expectedCheckpointId) {
    return { ...shell, status: "work_context_basis_changed", records: [], omissions: { basisChanged: true } };
  }
  const directoryPath = directory(owner.root);
  const names = fs.existsSync(directoryPath) ? fs.readdirSync(directoryPath).filter((name) => /^work-evidence-[a-f0-9]{24}\.json$/.test(name)).sort() : [];
  const globalRecent = evidenceIds === null && afterEvidenceId === null;
  const remainingNames = afterEvidenceId === null ? names : names.filter((name) => name > afterEvidenceId + ".json");
  const ids = evidenceIds === null ? (globalRecent ? remainingNames : remainingNames.slice(0, DEFAULT_SCAN)).map((name) => name.slice(0, -5)) : [...new Set(evidenceIds)];
  const originals = [], unavailable = [];
  let unavailableCount = 0;
  const markUnavailable = (id, error) => {
    unavailableCount += 1;
    if (unavailable.length < (globalRecent ? 32 : DEFAULT_SCAN)) {
      unavailable.push({ evidenceId: id, reasonCode: error.code || "INVALID_SESSION_WORK_EVIDENCE" });
    }
  };
  for (const id of ids) {
    try {
      const original = readOriginal(owner, id);
      originals.push(globalRecent ? { evidenceId: id, recordedAt: original.recordedAt, evidenceDigest: original.evidenceDigest } : original);
    } catch (error) { markUnavailable(id, error); }
  }
  originals.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) || a.evidenceId.localeCompare(b.evidenceId));
  const records = [];
  let used = 2, omittedByBudget = 0, valid = originals.length;
  const omittedEvidenceIds = [];
  const omit = (id) => {
    omittedByBudget += 1;
    if (omittedEvidenceIds.length < 32) omittedEvidenceIds.push(id);
  };
  for (const candidate of originals) {
    if (records.length >= maxRecords) {
      omit(candidate.evidenceId);
      continue;
    }
    let original = candidate;
    if (globalRecent) {
      try {
        original = readOriginal(owner, candidate.evidenceId);
        if (original.recordedAt !== candidate.recordedAt || original.evidenceDigest !== candidate.evidenceDigest) {
          fail("Work evidence changed during selection.", "SESSION_WORK_OBSERVATION_CHANGED");
        }
      } catch (error) {
        valid -= 1;
        markUnavailable(candidate.evidenceId, error);
        continue;
      }
    }
    // Even an empty enrichment array cannot fit: do not read its references.
    // An oversized recent record must not hide an older, smaller fitting one.
    if (JSON.stringify([...records, { ...original, references: [] }]).length > maxCharacters) {
      omit(original.evidenceId);
      continue;
    }
    const selected = { ...original, references: original.content.references.map((ref) => reference(owner, ref)) };
    // Budget the actual enriched record array sent to consumers, not the smaller
    // on-disk originals. The separately disclosed metadata envelope is excluded.
    const nextSize = JSON.stringify([...records, selected]).length;
    if (nextSize > maxCharacters) {
      omit(original.evidenceId);
      continue;
    }
    used = nextSize;
    records.push(selected);
  }
  if (identity(owner.root).basis !== owner.basis) return { ...shell, status: "work_context_basis_changed", records: [], omissions: { basisChanged: true } };
  return { ...shell, status: unavailableCount || evidenceIds === null && remainingNames.length > ids.length || omittedByBudget ? "work_context_partial" : records.length ? "work_context_available" : "work_context_not_recorded",
    records, unavailable,
    coverage: { originals: names.length, inspected: ids.length, valid, unavailable: unavailableCount, included: records.length, maxRecords, maxCharacters, usedCharacters: used,
      characterBudgetScope: "JSON.stringify(records).length; separate bounded metadata envelope excluded",
      selection: globalRecent
        ? "newest-recorded-first-among-all-discovered-verified-originals; sequential observation, not an atomic latest-at-return snapshot or semantic sufficiency judgment"
        : "newest-recorded-first-within-inspected-original-page; no semantic relevance or sufficient-context judgment" },
    omissions: { uninspected: evidenceIds === null ? Math.max(0, remainingNames.length - ids.length) : null, byBudget: omittedByBudget,
      evidenceIds: omittedEvidenceIds, omittedIdCount: omittedByBudget - omittedEvidenceIds.length,
      unavailableDetailCount: unavailableCount - unavailable.length },
    nextAfterEvidenceId: evidenceIds === null && remainingNames.length > ids.length ? ids.at(-1) : null,
    expansion: "Read exact evidenceIds with larger useful bounds or read the named original. A digest/path is not recovered contents. No evidence is deleted or silently considered irrelevant." };
}
