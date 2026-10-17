import fs from "node:fs";
import path from "node:path";
import { atomicCreateArtifact } from "./artifact-storage.mjs";
import { artifactAuthorityBoundary } from "./authority-plane-contract.mjs";
import { withProjectMutation } from "./project-mutation-lock.mjs";
import { safeSessionPath, sessionStatePath, sessionDataPath, withSessionRoute } from "./session-routing.mjs";

// Selected HEAD-authored P3 evidence, not a transcript, direction store, or
// inference engine. Entry never repairs or writes these originals.
import { SESSION_WORK_CONTEXT_VERSION, PROTOCOL, DEFAULT_SCAN, sha, encoded, fail, sameEvidence,
  normalizeSessionWorkEvidence, inputIdentity, verifySessionWorkEvidenceOwner,
  readSessionWorkEvidenceOriginalFile, inspectSessionWorkReference,
  SESSION_WORK_DEFAULT_CHARACTERS, SESSION_WORK_MAX_CHARACTERS } from "./session-work-evidence-original.mjs";
import { noteProjectGraphChange } from "./discovery-index.mjs";
export { SESSION_WORK_CONTEXT_VERSION, normalizeSessionWorkEvidence };
function identity(root) {
  const base = fs.realpathSync(path.resolve(root));
  const projectBytes = fs.readFileSync(safeSessionPath(base, ".head", "project.json"));
  const stateBytes = fs.readFileSync(sessionStatePath(base));
  return { ...verifySessionWorkEvidenceOwner({ root: base, projectBytes, stateBytes }),
    statePath: path.relative(base, sessionStatePath(base)).replaceAll("\\", "/"),
    workDirectory: path.relative(base, sessionDataPath(base, "work-evidence")).replaceAll("\\", "/") };
}
function directory(root) { return sessionDataPath(root, "work-evidence"); }
function fileFor(root, evidenceId) {
  if (!/^work-evidence-[a-f0-9]{24}$/.test(evidenceId || "")) fail("Invalid work evidence identity.");
  return safeSessionPath(root, path.relative(root, path.join(directory(root), `${evidenceId}.json`)));
}
function readOriginalFile(owner, evidenceId) { return readSessionWorkEvidenceOriginalFile(owner, evidenceId); }
function readOriginal(owner, evidenceId) { return readOriginalFile(owner, evidenceId).record; }
const reference = inspectSessionWorkReference;
// Internal graph reader: explicit real owner, without Host selection persistence.
export function readSessionWorkEvidenceOwner({ root, sessionId }) {
  if (!sessionId) fail("An exact logical owner is required.", "HEAD_SESSION_IDENTITY_MISMATCH");
  return withSessionRoute(root, sessionId, () => identity(root));
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
    const endpoints = new Map();
    const endpoint = (selector) => {
      if (!endpoints.has(selector.evidenceId)) endpoints.set(selector.evidenceId, readOriginal(owner, selector.evidenceId));
      const original = endpoints.get(selector.evidenceId);
      if (!sameEvidence(original, selector)) fail("Work link endpoint differs from its exact original.", "SESSION_WORK_LINK_MISMATCH");
      return original;
    };
    if (content.workLink) {
      endpoint(content.workLink.root);
      const predecessor = endpoint(content.workLink.predecessor);
      if (!sameEvidence(predecessor, content.workLink.root) && !sameEvidence(predecessor.content.workLink?.root, content.workLink.root)) {
        fail("Work predecessor does not declare this exact root.", "SESSION_WORK_LINK_MISMATCH");
      }
    }
    if (content.executionObservation?.target) endpoint(content.executionObservation.target);
    content.references.forEach((ref) => reference(owner, ref, { saving: true }));
    if (identity(owner.root).basis !== owner.basis) fail("Session changed before work evidence publication.", "SESSION_WORK_OBSERVATION_CHANGED");
    const payload = { schemaVersion: 1, kind: "Evidence", subtype: "SessionWorkEvidence", protocol: PROTOCOL,
      projectId: owner.projectId, sessionId: owner.sessionId, content, recordedAt: new Date().toISOString(),
      authorityBoundary: artifactAuthorityBoundary("Evidence"), evidenceId };
    const evidence = { ...payload, evidenceDigest: sha(encoded(payload)) };
    fs.mkdirSync(directory(owner.root), { recursive: true });
    fileFor(owner.root, evidenceId); // revalidate new ancestors before publication
    atomicCreateArtifact(file, `${JSON.stringify(evidence, null, 2)}\n`);
    const derived = noteProjectGraphChange(owner.root, [path.relative(owner.root, file).replaceAll("\\", "/")]);
    const graphIndex = derived.status === "unavailable" ? { status: "deferred", reasonCode: derived.reasonCode, ordinaryWorkBlocked: false } : derived;
    return { status: "session_work_evidence_recorded", evidence, file, persisted: true, writes: 1, authorityChanged: false, executionReplayAllowed: false, graphIndex };
  });
}

function workMetadata(original) {
  return { evidenceId: original.evidenceId, evidenceDigest: original.evidenceDigest, recordedAt: original.recordedAt,
    ...(original.content.workLink ? { workLink: original.content.workLink } : {}),
    ...(original.content.executionObservation ? { executionObservation: original.content.executionObservation } : {}) };
}
// One compact relation pass over the already verified selected-Session scan.
// No body/ancestor lookup, clock winner, execution epoch or state transition.
function workOrganization(metadata, unavailableIds, globalRecent, maxRecords) {
  const byId = new Map(metadata.map((m) => [m.evidenceId, m]));
  const incoming = new Map(), qualifierNodes = new Map(), children = new Map(), roots = new Set();
  const cycles = new Set(), colors = new Map();
  for (const m of metadata) {
    if (m.workLink) {
      roots.add(encoded(m.workLink.root));
      const key = encoded(m.workLink.predecessor);
      children.set(key, (children.get(key) || 0) + 1);
    }
    const target = m.executionObservation?.target;
    if (target && sameEvidence(byId.get(target.evidenceId), target)) {
      if (!incoming.has(target.evidenceId)) incoming.set(target.evidenceId, { head: null, tail: null, count: 0, unavailable: 0, states: new Map(), version: 0, cached: null });
      const group = incoming.get(target.evidenceId), node = { metadata: m, group, previous: group.tail, next: null };
      if (group.tail) group.tail.next = node; else group.head = node;
      group.tail = node; group.count++;
      group.states.set(m.executionObservation.state, (group.states.get(m.executionObservation.state) || 0) + 1);
      qualifierNodes.set(m.evidenceId, node);
    }
  }
  for (const m of metadata) {
    const trail = []; let id = m.evidenceId;
    while (byId.has(id) && !colors.has(id)) {
      colors.set(id, 1); trail.push(id);
      const pred = byId.get(id).workLink?.predecessor;
      id = pred && sameEvidence(byId.get(pred.evidenceId), pred) ? pred.evidenceId : null;
    }
    if (colors.get(id) === 1) {
      for (let i = trail.length - 1; i >= 0; i--) { cycles.add(trail[i]); if (trail[i] === id) break; }
    }
    for (const visited of trail) colors.set(visited, 2);
  }
  const endpointStatus = (selector) => {
    if (unavailableIds.has(selector.evidenceId)) return "unavailable";
    const target = byId.get(selector.evidenceId);
    return target ? sameEvidence(target, selector) ? "verified" : "unavailable" : globalRecent ? "unavailable" : "not-inspected";
  };
  const relations = (m) => {
    const rows = [];
    for (const [role, selector] of [["root", m.workLink?.root], ["predecessor", m.workLink?.predecessor], ["target", m.executionObservation?.target]]) {
      if (!selector) continue;
      let status = endpointStatus(selector);
      if (role === "predecessor" && status === "verified") {
        const pred = byId.get(selector.evidenceId);
        if (cycles.has(m.evidenceId) || !sameEvidence(pred, m.workLink.root) && !sameEvidence(pred.workLink?.root, m.workLink.root)) status = "unavailable";
      }
      rows.push({ role, status, ...(status === "unavailable" ? { reasonCode: "SESSION_WORK_LINK_UNAVAILABLE" } : {}) });
    }
    return rows;
  };
  return {
    byId, incoming,
    invalidate(id) {
      const node = qualifierNodes.get(id);
      if (!node) return;
      const group = node.group;
      if (node.previous) node.previous.next = node.next; else group.head = node.next;
      if (node.next) node.next.previous = node.previous; else group.tail = node.previous;
      group.count--; group.unavailable++; group.version++;
      const state = node.metadata.executionObservation.state;
      group.states.set(state, group.states.get(state) - 1);
      qualifierNodes.delete(id);
    },
    overlay(id) {
      const m = byId.get(id), group = incoming.get(id), rows = relations(m);
      if (!m.workLink && !m.executionObservation && !group) return null;
      if (group && group.cached?.version !== group.version) {
        const qualifiers = [];
        for (let node = group.head; node && qualifiers.length < maxRecords; node = node.next) {
          const q = node.metadata;
          qualifiers.push({ evidenceId: q.evidenceId, evidenceDigest: q.evidenceDigest, state: q.executionObservation.state });
        }
        group.cached = { version: group.version, qualifiers };
      }
      const qualifiers = group?.cached.qualifiers || [], count = group?.count || 0, unavailableCount = group?.unavailable || 0;
      return { states: ["running", "paused", "ended", "unknown"].filter((s) => group?.states.get(s) > 0), qualifierCount: count, qualifiers,
        omittedQualifierCount: count - qualifiers.length, unavailableQualifierCount: unavailableCount,
        coverage: unavailableCount || rows.some((r) => r.status === "unavailable") ? "partial" : globalRecent ? "verified-scan" : "not-inspected",
        relations: rows };
    },
    summary() {
      let unavailableRelations = 0, uninspectedRelations = 0;
      for (const m of metadata) for (const row of relations(m)) {
        if (row.status === "unavailable") unavailableRelations++;
        if (row.status === "not-inspected") uninspectedRelations++;
      }
      return { interpretation: "Saved historical observations coexist; neither their state, time nor predecessor establishes current live state, success or authority.",
        liveState: "not-observed", scope: globalRecent ? "discovered-selected-session" : "inspected-originals-only",
        roots: roots.size, branchingPredecessors: [...children.values()].filter((n) => n > 1).length,
        unavailableRelations, uninspectedRelations };
    },
  };
}

// Internal pure single-original projection, shared by exact expansion sizing.
export function projectExactSessionWorkRecord(original, references) {
  const organized = Boolean(original.content.workLink || original.content.executionObservation);
  const organization = organized ? workOrganization([workMetadata(original)], new Set(), false, 1) : null;
  const overlay = organization?.overlay(original.evidenceId);
  return { ...original, ...(organization ? { selectionRole: "recent", ...(overlay ? { savedActivity: overlay } : {}) } : {}), references };
}

// No secondary ledger or index is required for recovery. Default selection
// verifies discovered originals sequentially, retaining only ordering metadata
// and bounded output bodies. Names/metadata remain O(N), not constant memory.
export function readSessionWorkContext({ root = ".", evidenceIds = null, maxRecords = 8, maxCharacters = SESSION_WORK_DEFAULT_CHARACTERS,
  afterEvidenceId = null, expectedSessionId = null, expectedCheckpointId = undefined } = {}) {
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > DEFAULT_SCAN
    || !Number.isSafeInteger(maxCharacters) || maxCharacters < 2 || maxCharacters > SESSION_WORK_MAX_CHARACTERS
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
  const originals = [], unavailable = [], unavailableIds = new Set();
  let unavailableCount = 0;
  const markUnavailable = (id, error) => {
    if (unavailableIds.has(id)) return;
    unavailableIds.add(id);
    unavailableCount += 1;
    if (unavailable.length < (globalRecent ? 32 : DEFAULT_SCAN)) {
      unavailable.push({ evidenceId: id, reasonCode: error.code || "INVALID_SESSION_WORK_EVIDENCE" });
    }
  };
  for (const id of ids) {
    try {
      const original = readOriginal(owner, id);
      originals.push(globalRecent ? workMetadata(original) : original);
    } catch (error) { markUnavailable(id, error); }
  }
  originals.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) || a.evidenceId.localeCompare(b.evidenceId));
  const metadata = globalRecent ? originals : originals.map(workMetadata);
  const organized = metadata.some((m) => m.workLink || m.executionObservation);
  const organization = organized ? workOrganization(metadata, unavailableIds, globalRecent, maxRecords) : null;
  const records = [];
  let used = 2, omittedByBudget = 0, valid = originals.length;
  const omittedEvidenceIds = [];
  const omit = (id) => {
    omittedByBudget += 1;
    if (omittedEvidenceIds.length < 32) omittedEvidenceIds.push(id);
  };
  const roles = new Map();
  const decorate = (original, role) => {
    const overlay = organization?.overlay(original.evidenceId);
    return { ...original, ...(organization ? { selectionRole: role, ...(overlay ? { savedActivity: overlay } : {}) } : {}) };
  };
  // This request-local cache holds only selected/related bodies, not the full
  // scan. Rejected bodies are discarded but their fresh-read proof remains.
  const fresh = new Map(), deferred = new Set(); let relatedReads = 0;
  const load = (id, related = false) => {
    if (fresh.has(id)) return fresh.get(id);
    if (related && relatedReads >= maxRecords) { deferred.add(id); return null; }
    if (related) relatedReads++;
    const proof = {};
    try {
      const { record, bytes } = readOriginalFile(owner, id), observed = organization.byId.get(id);
      if (!observed || record.recordedAt !== observed.recordedAt || record.evidenceDigest !== observed.evidenceDigest) fail("Work evidence changed during selection.", "SESSION_WORK_OBSERVATION_CHANGED");
      proof.record = record; proof.byteDigest = sha(bytes);
    } catch (error) {
      proof.error = error;
      // A missing related endpoint outside this scan is a relation gap, not an
      // extra inspected original. Keep the two accounting domains separate.
      if (organization.byId.has(id)) {
        if (!unavailableIds.has(id)) valid--;
        markUnavailable(id, error);
        organization.invalidate(id);
      }
    }
    fresh.set(id, proof); return proof;
  };
  const workPrefix = path.relative(owner.root, directory(owner.root)).replaceAll("\\", "/") + "/";
  const citedId = (ref) => ref.kind === "artifact" && ref.path.startsWith(workPrefix)
    && /^work-evidence-[a-f0-9]{24}\.json$/.test(ref.path.slice(workPrefix.length)) ? ref.path.slice(workPrefix.length, -5) : null;
  const append = (proof, role) => {
    if (!proof?.record || records.length >= maxRecords || roles.has(proof.record.evidenceId)) return false;
    const original = proof.record, decorated = decorate(original, role);
    if (JSON.stringify([...records, { ...decorated, references: [] }]).length > maxCharacters) { delete proof.record; return false; }
    const selected = { ...decorated, references: original.content.references.map((ref) => reference(owner, ref, { proof: fresh.get(citedId(ref)) })) };
    if (JSON.stringify([...records, selected]).length > maxCharacters) { delete proof.record; return false; }
    records.push(selected); roles.set(original.evidenceId, role); return true;
  };
  if (organization && globalRecent) {
    let seedCount = 0, relatedSlots = 0;
    for (const candidate of originals) {
      if (seedCount >= Math.ceil(maxRecords / 2) || records.length >= maxRecords) break;
      if (roles.has(candidate.evidenceId)) continue;
      const proof = load(candidate.evidenceId);
      if (!proof?.record) continue;
      // Do not open references for a body that cannot fit even bare.
      if (JSON.stringify([...records, { ...decorate(proof.record, "recent"), references: [] }]).length > maxCharacters) { delete proof.record; continue; }
      const original = proof.record;
      const citations = original.content.references.map((ref) => ({ id: citedId(ref), ref })).filter((c) => c.id);
      const rootSelector = original.content.workLink?.root;
      // Prefetch only a bounded one-hop related queue. Its file-byte hash also
      // validates the same citation, without a second selected-body read.
      const queue = [...citations.slice(0, 1), ...(rootSelector ? [{ id: rootSelector.evidenceId, selector: rootSelector }] : []), ...citations.slice(1)];
      for (const item of queue) {
        if (roles.has(item.id)) continue;
        const related = load(item.id, true);
        if (related?.record && JSON.stringify([{ ...decorate(related.record, "cited"), references: [] }]).length > maxCharacters) delete related.record;
      }
      if (!append(proof, "recent")) continue;
      seedCount++;
      for (const kind of ["cited", "root"]) {
        if (relatedSlots >= Math.floor(maxRecords / 2) || records.length >= maxRecords) break;
        const candidates = kind === "cited" ? citations : rootSelector ? [{ id: rootSelector.evidenceId, selector: rootSelector }] : [];
        for (const item of candidates) {
          const related = fresh.get(item.id);
          if (!related?.record || roles.has(item.id) || item.ref && related.byteDigest !== item.ref.digest
            || item.selector && !sameEvidence(related.record, item.selector)) continue;
          if (append(related, kind)) { relatedSlots++; break; }
        }
      }
    }
    // Related expansion never makes the remaining recent fallback ineligible.
    for (const candidate of originals) {
      if (records.length >= maxRecords) break;
      if (!roles.has(candidate.evidenceId)) append(load(candidate.evidenceId), "recent");
    }
    // A later actual reread failure invalidates dependent derived overlays in
    // this response too. No extra original scan or blanket freshness claim.
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      records[i] = { ...decorate(record, roles.get(record.evidenceId)), references: record.content.references.map((ref, j) => {
        const proof = fresh.get(citedId(ref));
        return proof?.error ? reference(owner, ref, { proof }) : record.references[j];
      }) };
    }
    while (records.length && JSON.stringify(records).length > maxCharacters) records.pop();
    const included = new Set(records.map((r) => r.evidenceId));
    for (const candidate of originals) if (!included.has(candidate.evidenceId) && !unavailableIds.has(candidate.evidenceId)) omit(candidate.evidenceId);
    used = JSON.stringify(records).length;
  } else for (const candidate of originals) {
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
    const references = original.content.references.map((ref) => reference(owner, ref));
    const selected = evidenceIds?.length === 1 && maxRecords === 1 ? projectExactSessionWorkRecord(original, references)
      : { ...decorate(original, "recent"), references };
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
  const organizationSummary = organization?.summary();
  return { ...shell, status: unavailableCount || evidenceIds === null && remainingNames.length > ids.length || omittedByBudget
      || organizationSummary?.unavailableRelations || organizationSummary?.uninspectedRelations ? "work_context_partial" : records.length ? "work_context_available" : "work_context_not_recorded",
    records, unavailable,
    ...(organization ? { organization: { ...organizationSummary, relatedReadAttempts: relatedReads, relatedExpansionDeferred: deferred.size } } : {}),
    coverage: { originals: names.length, inspected: ids.length, valid, unavailable: unavailableCount, included: records.length, maxRecords, maxCharacters, usedCharacters: used,
      characterBudgetScope: "JSON.stringify(records).length; separate bounded metadata envelope excluded",
      selection: organization && globalRecent ? "recent-results-with-bounded-explicit-citations-and-declared-roots; saved observations only, not semantic sufficiency or live execution state" : globalRecent
        ? "newest-recorded-first-among-all-discovered-verified-originals; sequential observation, not an atomic latest-at-return snapshot or semantic sufficiency judgment"
        : "newest-recorded-first-within-inspected-original-page; no semantic relevance or sufficient-context judgment" },
    omissions: { uninspected: evidenceIds === null ? Math.max(0, remainingNames.length - ids.length) : null, byBudget: omittedByBudget,
      evidenceIds: omittedEvidenceIds, omittedIdCount: omittedByBudget - omittedEvidenceIds.length,
      unavailableDetailCount: unavailableCount - unavailable.length },
    nextAfterEvidenceId: evidenceIds === null && remainingNames.length > ids.length ? ids.at(-1) : null,
    expansion: "Read exact evidenceIds with larger useful bounds or read the named original. A digest/path is not recovered contents. No evidence is deleted or silently considered irrelevant." };
}
