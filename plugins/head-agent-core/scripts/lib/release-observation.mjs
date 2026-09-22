import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { inspectProject, SCHEMA_VERSION } from "./head-core.mjs";
import { readChangeSet, readVcsEvidence } from "./change-set.mjs";
import { VCS_EVIDENCE_VERSION, verifyGitCommitObservation } from "./change-set-projection.mjs";
import { withRefreshWriterLease } from "./refresh-writer-lease.mjs";
import { OBSERVATION_PROTOCOL_VERSION } from "./observation-contract.mjs";

export const RELEASE_OBSERVATION_VERSION = "0.1.0";
export const BRANCH_STATE_OBSERVATION_DIRECTORY = ".head/release-observations/branch-states";
export const DEPLOYMENT_RESULT_OBSERVATION_DIRECTORY = ".head/release-observations/deployment-results";
export const RELEASE_OBSERVATION_DIRECTORY = ".head/release-observations/releases";

const DIRECTORIES = Object.freeze({
  branchStates: BRANCH_STATE_OBSERVATION_DIRECTORY,
  deploymentResults: DEPLOYMENT_RESULT_OBSERVATION_DIRECTORY,
  releases: RELEASE_OBSERVATION_DIRECTORY,
});
const LIMITS = Object.freeze({ maxArtifacts: 1024, maxArtifactBytes: 1024 * 1024, maxTotalBytes: 32 * 1024 * 1024 });
const DEPLOYMENT_STATUSES = new Set(["succeeded", "failed", "cancelled"]);
const REF_KINDS = new Set(["branch", "remote", "tag"]);
const fail = (message, code = "RELEASE_OBSERVATION_ERROR") => { const error = new Error(message); error.code = code; throw error; };
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

export function releaseObservationCanonicalJson(value) { return JSON.stringify(canonical(value)); }
export function releaseObservationDigest(value) { return crypto.createHash("sha256").update(value).digest("hex"); }

function exactFields(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`, "INVALID_RELEASE_OBSERVATION_INPUT");
  const expected = [...fields].sort();
  const actual = Object.keys(value).sort();
  if (releaseObservationCanonicalJson(actual) !== releaseObservationCanonicalJson(expected)) fail(`${label} fields are invalid.`, "INVALID_RELEASE_OBSERVATION_INPUT");
}

function requiredText(value, label, max = 512) {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value.trim(), "utf8") > max) fail(`${label} is invalid.`, "INVALID_RELEASE_OBSERVATION_INPUT");
  return value.trim();
}

function stableKey(value, label) {
  const normalized = requiredText(value, label, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(normalized)) fail(`${label} is not a stable key.`, "INVALID_RELEASE_OBSERVATION_INPUT");
  return normalized;
}

function digestValue(value, label, nullable = false) {
  if (nullable && value === null) return null;
  const normalized = String(value || "").toLocaleLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) fail(`${label} must be a SHA-256 digest.`, "INVALID_RELEASE_OBSERVATION_INPUT");
  return normalized;
}

function commitId(value) {
  const normalized = String(value || "").toLocaleLowerCase();
  if (!/^[a-f0-9]{40,64}$/.test(normalized)) fail("Deployment commit is invalid.", "INVALID_RELEASE_OBSERVATION_INPUT");
  return normalized;
}

function identity(payload, prefix, idField, hashField) {
  const hash = releaseObservationDigest(releaseObservationCanonicalJson(payload));
  return { ...payload, [idField]: `${prefix}-${hash.slice(0, 24)}`, [hashField]: hash };
}

function verifyIdentity(document, prefix, idField, hashField, label) {
  const payload = { ...document }; delete payload[idField]; delete payload[hashField];
  const hash = releaseObservationDigest(releaseObservationCanonicalJson(payload));
  if (document[hashField] !== hash || document[idField] !== `${prefix}-${hash.slice(0, 24)}`) fail(`${label} digest verification failed.`, "RELEASE_OBSERVATION_DIGEST_MISMATCH");
}

function authorityValid(document, authority) {
  return document.authority === authority && document.epistemicClass === "observed-fact"
    && document.instructionAuthority === false && document.promotionAuthority === false
    && document.mutatesCanon === false && document.recoveryAuthority === false;
}

export function verifyBranchStateObservation(document, projectId = "") {
  verifyIdentity(document, "branch-state-observation", "branchStateObservationId", "branchStateObservationHash", "BranchStateObservation");
  if (document.schemaVersion !== SCHEMA_VERSION || document.kind !== "BranchStateObservation"
    || document.protocol?.name !== "head-agent-core-release-observation" || document.protocol?.version !== RELEASE_OBSERVATION_VERSION
    || (projectId && document.projectId !== projectId) || document.vcsKind !== "git"
    || !REF_KINDS.has(document.refKind) || typeof document.ref !== "string" || !/^refs\/(?:heads|remotes|tags)\//.test(document.ref)
    || !/^[a-f0-9]{64}$/.test(document.referencesDigest || "")
    || !authorityValid(document, "non-authoritative-branch-state-observation")) fail("BranchStateObservation fields or authority are invalid.", "INVALID_BRANCH_STATE_OBSERVATION");
  verifyGitCommitObservation(document.commitObservation);
  if (document.commit !== document.commitObservation.objectId) fail("BranchStateObservation commit lineage is invalid.", "INVALID_BRANCH_STATE_OBSERVATION");
  return document;
}

export function verifyDeploymentResultObservation(document, projectId = "") {
  verifyIdentity(document, "deployment-result-observation", "deploymentResultObservationId", "deploymentResultObservationHash", "DeploymentResultObservation");
  if (document.schemaVersion !== SCHEMA_VERSION || document.kind !== "DeploymentResultObservation"
    || document.protocol?.name !== "head-agent-core-release-observation" || document.protocol?.version !== RELEASE_OBSERVATION_VERSION
    || (projectId && document.projectId !== projectId) || !DEPLOYMENT_STATUSES.has(document.status)
    || !/^[a-f0-9]{40,64}$/.test(document.commit || "") || typeof document.observedAt !== "string" || Number.isNaN(Date.parse(document.observedAt))
    || stableKey(document.environmentKey, "Deployment environmentKey") !== document.environmentKey
    || !/^[a-f0-9]{64}$/.test(document.sourceEventKeyDigest || "") || !/^[a-f0-9]{64}$/.test(document.deploymentEvidenceDigest || "")
    || typeof document.approved !== "boolean" || (document.approved !== (document.approvalEvidenceDigest !== null))
    || document.approvalEvidenceDigest !== null && !/^[a-f0-9]{64}$/.test(document.approvalEvidenceDigest || "")
    || !authorityValid(document, "non-authoritative-deployment-result-observation")) fail("DeploymentResultObservation fields or authority are invalid.", "INVALID_DEPLOYMENT_RESULT_OBSERVATION");
  return document;
}

export function verifyReleaseObservation(document, projectId = "") {
  verifyIdentity(document, "release-observation", "releaseObservationId", "releaseObservationHash", "ReleaseObservation");
  if (document.schemaVersion !== SCHEMA_VERSION || document.kind !== "ReleaseObservation"
    || document.protocol?.name !== "head-agent-core-release-observation" || document.protocol?.version !== RELEASE_OBSERVATION_VERSION
    || (projectId && document.projectId !== projectId) || !/^deployment-result-observation-[a-f0-9]{24}$/.test(document.deploymentResultObservationId || "")
    || !Array.isArray(document.branchStateObservationIds) || !document.branchStateObservationIds.length
    || releaseObservationCanonicalJson(document.branchStateObservationIds) !== releaseObservationCanonicalJson([...new Set(document.branchStateObservationIds)].sort())
    || document.branchStateObservationIds.some((id) => !/^branch-state-observation-[a-f0-9]{24}$/.test(id))
    || !/^[a-f0-9]{40,64}$/.test(document.commit || "") || stableKey(document.environmentKey, "Release environmentKey") !== document.environmentKey
    || (document.changeSetId === null) !== (document.vcsEvidenceId === null)
    || document.changeSetId !== null && !/^change-set-[a-f0-9]{24}$/.test(document.changeSetId || "")
    || document.vcsEvidenceId !== null && !/^vcs-evidence-[a-f0-9]{24}$/.test(document.vcsEvidenceId || "")
    || !authorityValid(document, "non-authoritative-release-observation")) fail("ReleaseObservation fields or authority are invalid.", "INVALID_RELEASE_OBSERVATION");
  return document;
}

function safeDirectory(projectRoot, relative) {
  const root = path.resolve(projectRoot);
  const directory = path.resolve(root, ...relative.split("/"));
  const fromRoot = path.relative(root, directory);
  if (fromRoot === ".." || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) fail("Release observation path escapes project root.", "RELEASE_OBSERVATION_PATH_ESCAPE");
  let current = root;
  for (const segment of fromRoot.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) fail("Release observation path traverses a symlink.", "RELEASE_OBSERVATION_SYMLINK_PATH");
  }
  return directory;
}

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
  try { fs.writeFileSync(temporary, content, { encoding: "utf8", flag: "wx" }); fs.renameSync(temporary, file); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

function persistImmutable(projectRoot, relative, id, document) {
  const file = path.join(safeDirectory(projectRoot, relative), `${id}.json`);
  if (fs.existsSync(file)) {
    const existing = JSON.parse(fs.readFileSync(file, "utf8"));
    if (releaseObservationCanonicalJson(existing) !== releaseObservationCanonicalJson(document)) fail(`Immutable identity collision: ${id}`, "RELEASE_OBSERVATION_IMMUTABLE_COLLISION");
    return { status: "existing", file };
  }
  atomicWrite(file, json(document));
  return { status: "recorded", file };
}

function readArtifacts(projectRoot, relative, label) {
  const directory = safeDirectory(projectRoot, relative);
  if (!fs.existsSync(directory)) return [];
  let totalBytes = 0;
  const files = fs.readdirSync(directory).filter((name) => name.endsWith(".json")).sort();
  if (files.length > LIMITS.maxArtifacts) fail(`${label} count exceeds the configured limit.`, "RELEASE_OBSERVATION_LIMIT");
  return files.map((name) => {
    const file = path.join(directory, name);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > LIMITS.maxArtifactBytes) fail(`${label} artifact is unsafe or too large.`, "RELEASE_OBSERVATION_LIMIT");
    totalBytes += stat.size;
    if (totalBytes > LIMITS.maxTotalBytes) fail(`${label} total bytes exceed the configured limit.`, "RELEASE_OBSERVATION_LIMIT");
    return JSON.parse(fs.readFileSync(file, "utf8"));
  });
}

function projectionPayload({ projectId, branchStates, deploymentResults, releases }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "ReleaseObservationProjectionInput",
    protocol: { name: "head-agent-core-release-observation-projection", version: RELEASE_OBSERVATION_VERSION },
    projectId,
    commonObservationContract: {
      protocol: { name: "head-agent-core-observation", version: OBSERVATION_PROTOCOL_VERSION },
      role: "domain-specialization-with-exact-git-and-approved-deployment-lineage",
      genericReplacement: false,
      semanticAuthority: false,
    },
    branchStates,
    deploymentResults,
    releases,
    authority: "derived-projection-input-not-release-authority",
    instructionAuthority: false,
    promotionAuthority: false,
  };
}

export function verifyReleaseObservationProjectionInput(projection) {
  if (!projection || projection.kind !== "ReleaseObservationProjectionInput"
    || projection.protocol?.name !== "head-agent-core-release-observation-projection" || projection.protocol?.version !== RELEASE_OBSERVATION_VERSION
    || !Array.isArray(projection.branchStates) || !Array.isArray(projection.deploymentResults) || !Array.isArray(projection.releases)
    || projection.commonObservationContract?.protocol?.name !== "head-agent-core-observation"
    || projection.commonObservationContract?.protocol?.version !== OBSERVATION_PROTOCOL_VERSION
    || projection.commonObservationContract?.role !== "domain-specialization-with-exact-git-and-approved-deployment-lineage"
    || projection.commonObservationContract?.genericReplacement !== false || projection.commonObservationContract?.semanticAuthority !== false
    || projection.authority !== "derived-projection-input-not-release-authority" || projection.instructionAuthority !== false || projection.promotionAuthority !== false) fail("Release observation projection is invalid.", "INVALID_RELEASE_OBSERVATION_PROJECTION");
  const branches = new Map(projection.branchStates.map((item) => [verifyBranchStateObservation(item, projection.projectId).branchStateObservationId, item]));
  if (branches.size !== projection.branchStates.length) fail("Duplicate BranchStateObservation.", "DUPLICATE_BRANCH_STATE_OBSERVATION");
  const deployments = new Map();
  const deploymentKeys = new Map();
  for (const item of projection.deploymentResults) {
    verifyDeploymentResultObservation(item, projection.projectId);
    if (deployments.has(item.deploymentResultObservationId)) fail("Duplicate DeploymentResultObservation.", "DUPLICATE_DEPLOYMENT_RESULT_OBSERVATION");
    const existingKey = deploymentKeys.get(item.sourceEventKeyDigest);
    if (existingKey && existingKey !== item.deploymentResultObservationId) fail("Deployment source event has divergent persisted observations.", "DIVERGENT_DEPLOYMENT_RESULT_REPLAY");
    deployments.set(item.deploymentResultObservationId, item);
    deploymentKeys.set(item.sourceEventKeyDigest, item.deploymentResultObservationId);
  }
  const releaseIds = new Set();
  for (const release of projection.releases) {
    verifyReleaseObservation(release, projection.projectId);
    if (releaseIds.has(release.releaseObservationId)) fail("Duplicate ReleaseObservation.", "DUPLICATE_RELEASE_OBSERVATION");
    releaseIds.add(release.releaseObservationId);
    const deployment = deployments.get(release.deploymentResultObservationId);
    if (!deployment || deployment.status !== "succeeded" || deployment.approved !== true || deployment.commit !== release.commit || deployment.environmentKey !== release.environmentKey) fail("ReleaseObservation deployment lineage is invalid.", "INVALID_RELEASE_OBSERVATION_LINEAGE");
    for (const id of release.branchStateObservationIds) if (branches.get(id)?.commit !== release.commit) fail("ReleaseObservation branch lineage is invalid.", "INVALID_RELEASE_OBSERVATION_LINEAGE");
  }
  const payload = { ...projection }; delete payload.projectionInputId; delete payload.projectionInputHash;
  const hash = releaseObservationDigest(releaseObservationCanonicalJson(payload));
  if (projection.projectionInputHash !== hash || projection.projectionInputId !== `release-observation-projection-${hash.slice(0, 24)}`) fail("Release observation projection digest verification failed.", "RELEASE_OBSERVATION_PROJECTION_DIGEST_MISMATCH");
  return projection;
}

export function loadReleaseObservationProjection({ projectRoot, projectId } = {}) {
  const branchStates = readArtifacts(projectRoot, DIRECTORIES.branchStates, "BranchStateObservation").map((item) => verifyBranchStateObservation(item, projectId)).sort((a, b) => a.branchStateObservationId.localeCompare(b.branchStateObservationId));
  const deploymentResults = readArtifacts(projectRoot, DIRECTORIES.deploymentResults, "DeploymentResultObservation").map((item) => verifyDeploymentResultObservation(item, projectId)).sort((a, b) => a.deploymentResultObservationId.localeCompare(b.deploymentResultObservationId));
  const releases = readArtifacts(projectRoot, DIRECTORIES.releases, "ReleaseObservation").map((item) => verifyReleaseObservation(item, projectId)).sort((a, b) => a.releaseObservationId.localeCompare(b.releaseObservationId));
  const payload = projectionPayload({ projectId, branchStates, deploymentResults, releases });
  const hash = releaseObservationDigest(releaseObservationCanonicalJson(payload));
  return verifyReleaseObservationProjectionInput({ ...payload, projectionInputId: `release-observation-projection-${hash.slice(0, 24)}`, projectionInputHash: hash });
}

function gitCommitObservation(commit) {
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    kind: "GitCommitObservation",
    protocol: { name: "head-agent-core-git-commit-observation", version: VCS_EVIDENCE_VERSION },
    vcsKind: "git",
    objectId: commit.commit,
    parents: [...commit.parents].sort(),
    authoredAt: commit.authoredAt,
    committedAt: commit.committedAt,
    author: { name: commit.author.name },
    authorEmailDigest: commit.authorEmailDigest,
    refs: [...commit.refs].sort(),
    subject: commit.subject,
    body: commit.body,
    evidence: { ...commit.evidence },
    authority: "derived-vcs-observation",
    trustBoundary: "evidence-not-instruction",
    instructionAuthority: false,
    promotionAuthority: false,
  };
  const hash = releaseObservationDigest(releaseObservationCanonicalJson(payload));
  return verifyGitCommitObservation({ ...payload, gitCommitObservationId: `git-commit-observation-${hash.slice(0, 24)}`, gitCommitObservationHash: hash });
}

function branchState(projectId, reference, referencesDigest, commitObservation) {
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    kind: "BranchStateObservation",
    protocol: { name: "head-agent-core-release-observation", version: RELEASE_OBSERVATION_VERSION },
    projectId,
    vcsKind: "git",
    ref: reference.ref,
    refKind: reference.kind,
    commit: commitObservation.objectId,
    referencesDigest,
    commitObservation,
    epistemicClass: "observed-fact",
    authority: "non-authoritative-branch-state-observation",
    instructionAuthority: false,
    promotionAuthority: false,
    mutatesCanon: false,
    recoveryAuthority: false,
  };
  return verifyBranchStateObservation(identity(payload, "branch-state-observation", "branchStateObservationId", "branchStateObservationHash"), projectId);
}

function normalizeDeploymentInput(input) {
  exactFields(input, ["environmentKey", "status", "commit", "observedAt", "sourceEventKeyDigest", "deploymentEvidenceDigest", "approved", "approvalEvidenceDigest", "changeSetId", "vcsEvidenceId"], "Deployment result");
  const status = requiredText(input.status, "Deployment status", 32).toLocaleLowerCase();
  if (!DEPLOYMENT_STATUSES.has(status)) fail("Deployment status is invalid.", "INVALID_RELEASE_OBSERVATION_INPUT");
  const observedAt = requiredText(input.observedAt, "Deployment observedAt", 64);
  if (Number.isNaN(Date.parse(observedAt))) fail("Deployment observedAt is invalid.", "INVALID_RELEASE_OBSERVATION_INPUT");
  if (typeof input.approved !== "boolean") fail("Deployment approved must be boolean.", "INVALID_RELEASE_OBSERVATION_INPUT");
  const approvalEvidenceDigest = digestValue(input.approvalEvidenceDigest, "Deployment approvalEvidenceDigest", true);
  if (input.approved !== (approvalEvidenceDigest !== null)) fail("Deployment approval evidence does not match approved.", "INVALID_RELEASE_OBSERVATION_INPUT");
  const changeSetId = input.changeSetId == null ? null : requiredText(input.changeSetId, "Deployment changeSetId", 96);
  const vcsEvidenceId = input.vcsEvidenceId == null ? null : requiredText(input.vcsEvidenceId, "Deployment vcsEvidenceId", 96);
  if ((changeSetId === null) !== (vcsEvidenceId === null)) fail("ChangeSet and VCS evidence must be supplied together.", "INVALID_RELEASE_OBSERVATION_INPUT");
  return {
    environmentKey: stableKey(input.environmentKey, "Deployment environmentKey"),
    status,
    commit: commitId(input.commit),
    observedAt,
    sourceEventKeyDigest: digestValue(input.sourceEventKeyDigest, "Deployment sourceEventKeyDigest"),
    deploymentEvidenceDigest: digestValue(input.deploymentEvidenceDigest, "Deployment deploymentEvidenceDigest"),
    approved: input.approved,
    approvalEvidenceDigest,
    changeSetId,
    vcsEvidenceId,
  };
}

export class StructuredDeploymentResultAdapter {
  constructor({ input } = {}) { this.adapterVersion = RELEASE_OBSERVATION_VERSION; this.input = input; }
  describe() { return { adapterKind: "structured-deployment-result", adapterVersion: this.adapterVersion, authority: "observed-evidence-only", providerNeutral: true, persistsProviderIdentity: false }; }
  readResult() { return normalizeDeploymentInput(this.input); }
}

export function assertDeploymentResultAdapter(adapter) {
  if (!adapter || typeof adapter !== "object" || adapter.adapterVersion !== RELEASE_OBSERVATION_VERSION || typeof adapter.describe !== "function" || typeof adapter.readResult !== "function") fail("DeploymentResultAdapter is invalid.", "INVALID_DEPLOYMENT_RESULT_ADAPTER");
  const descriptor = adapter.describe();
  if (descriptor.authority !== "observed-evidence-only" || descriptor.providerNeutral !== true || descriptor.persistsProviderIdentity !== false) fail("DeploymentResultAdapter crosses the authority boundary.", "INVALID_DEPLOYMENT_RESULT_ADAPTER_AUTHORITY");
  return adapter;
}

function deploymentResult(projectId, normalized) {
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    kind: "DeploymentResultObservation",
    protocol: { name: "head-agent-core-release-observation", version: RELEASE_OBSERVATION_VERSION },
    projectId,
    ...normalized,
    epistemicClass: "observed-fact",
    authority: "non-authoritative-deployment-result-observation",
    instructionAuthority: false,
    promotionAuthority: false,
    mutatesCanon: false,
    recoveryAuthority: false,
  };
  return verifyDeploymentResultObservation(identity(payload, "deployment-result-observation", "deploymentResultObservationId", "deploymentResultObservationHash"), projectId);
}

function releaseObservation(projectId, deployment, branchStates) {
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    kind: "ReleaseObservation",
    protocol: { name: "head-agent-core-release-observation", version: RELEASE_OBSERVATION_VERSION },
    projectId,
    environmentKey: deployment.environmentKey,
    commit: deployment.commit,
    deploymentResultObservationId: deployment.deploymentResultObservationId,
    branchStateObservationIds: branchStates.map((item) => item.branchStateObservationId).sort(),
    changeSetId: deployment.changeSetId,
    vcsEvidenceId: deployment.vcsEvidenceId,
    epistemicClass: "observed-fact",
    authority: "non-authoritative-release-observation",
    instructionAuthority: false,
    promotionAuthority: false,
    mutatesCanon: false,
    recoveryAuthority: false,
  };
  return verifyReleaseObservation(identity(payload, "release-observation", "releaseObservationId", "releaseObservationHash"), projectId);
}

function readyProject(root) {
  const inspected = inspectProject(root);
  if (inspected.status !== "ready") fail(`Project must be ready for release observation; current status: ${inspected.status}.`, "PROJECT_NOT_READY");
  return inspected;
}

export async function observeReleaseState({ root = ".", input = null, adapter = null } = {}) {
  const inspected = readyProject(root);
  return withRefreshWriterLease({ projectRoot: inspected.project.projectRoot, projectId: inspected.project.projectId }, async (writerLease) => {
  const selected = assertDeploymentResultAdapter(adapter || new StructuredDeploymentResultAdapter({ input }));
  const normalized = await selected.readResult({ projectRoot: inspected.project.projectRoot, projectId: inspected.project.projectId });
  const verifiedInput = normalizeDeploymentInput(normalized);
  const { buildWorldModel } = await import("./world-model.mjs");
  const before = await buildWorldModel({ root: inspected.project.projectRoot, persist: true, writerLease });
  const history = before.snapshot.gitDecisionHistory;
  if (history.status !== "available") fail("Verified Git history is unavailable for release observation.", "RELEASE_GIT_HISTORY_UNAVAILABLE");
  const commit = history.commits.find((item) => item.commit === verifiedInput.commit);
  if (!commit) fail("Deployment commit is absent from verified reachable Git history.", "RELEASE_COMMIT_NOT_FOUND");
  const commitObservation = gitCommitObservation(commit);
  const references = (before.snapshot.git.references || []).filter((item) => item.commit === verifiedInput.commit && REF_KINDS.has(item.kind));
  const branchStates = references.map((reference) => branchState(inspected.project.projectId, reference, before.snapshot.git.referencesDigest, commitObservation));
  for (const branch of branchStates) persistImmutable(inspected.project.projectRoot, DIRECTORIES.branchStates, branch.branchStateObservationId, branch);
  const deployment = deploymentResult(inspected.project.projectId, verifiedInput);
  const currentProjection = loadReleaseObservationProjection({ projectRoot: inspected.project.projectRoot, projectId: inspected.project.projectId });
  const conflicting = currentProjection.deploymentResults.find((item) => item.sourceEventKeyDigest === deployment.sourceEventKeyDigest && item.deploymentResultObservationId !== deployment.deploymentResultObservationId);
  if (conflicting) fail("Deployment source event was replayed with divergent content.", "DIVERGENT_DEPLOYMENT_RESULT_REPLAY");
  persistImmutable(inspected.project.projectRoot, DIRECTORIES.deploymentResults, deployment.deploymentResultObservationId, deployment);
  let release = null;
  let releaseStatus = deployment.status === "succeeded" && deployment.approved ? "awaiting_matching_product_ref" : "not_release_eligible";
  if (deployment.status === "succeeded" && deployment.approved && branchStates.length) {
    if (deployment.changeSetId) {
      const changeSet = readChangeSet({ root: inspected.project.projectRoot, changeSetId: deployment.changeSetId }).changeSet;
      const vcsEvidence = readVcsEvidence({ root: inspected.project.projectRoot, vcsEvidenceId: deployment.vcsEvidenceId }).vcsEvidence;
      if (vcsEvidence.changeSetId !== changeSet.changeSetId || !vcsEvidence.commitObservations.some((item) => item.objectId === deployment.commit)) fail("Release ChangeSet/VCS evidence does not contain the deployed commit.", "RELEASE_VCS_EVIDENCE_MISMATCH");
    }
    release = releaseObservation(inspected.project.projectId, deployment, branchStates);
    persistImmutable(inspected.project.projectRoot, DIRECTORIES.releases, release.releaseObservationId, release);
    releaseStatus = "release_observed";
  }
  const after = await buildWorldModel({ root: inspected.project.projectRoot, persist: true, writerLease });
  return {
    status: releaseStatus,
    branchStates,
    deploymentResult: deployment,
    release,
    adapter: selected.describe(),
    worldModel: { worldModelId: after.snapshot.worldModelId, graphSnapshotId: after.snapshot.temporalProvenanceGraph.graphSnapshotId },
    authority: { observations: "P3-evidence-only", graph: "P4-derived", productCanonMutated: false, reviewDecisionCreated: false, recoveryDirectionMutated: false },
  };
  });
}

export function inspectReleaseObservations({ root = "." } = {}) {
  const inspected = readyProject(root);
  const projection = loadReleaseObservationProjection({ projectRoot: inspected.project.projectRoot, projectId: inspected.project.projectId });
  return {
    status: projection.branchStates.length || projection.deploymentResults.length || projection.releases.length ? "active" : "not_started",
    projectId: inspected.project.projectId,
    sessionId: inspected.state.sessionId,
    projection,
    authority: { observations: "P3-evidence-only", graph: "P4-derived", productCanon: "unchanged", recovery: "unchanged" },
  };
}
