import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { inspectProject, SCHEMA_VERSION } from "./head-core.mjs";
import {
  buildGitDecisionHistory,
  GIT_DECISION_HISTORY_VERSION,
  GIT_HISTORY_ADAPTER_VERSION,
  queryGitDecisionHistory,
  verifyGitDecisionHistory,
} from "./git-history.mjs";
import { buildSemanticGraph, querySemanticGraph, SEMANTIC_GRAPH_VERSION, verifySemanticGraph } from "./semantic-graph.mjs";
import {
  buildExternalRuntimeState,
  EXTERNAL_RUNTIME_STATE_VERSION,
  queryExternalRuntimeState,
  RUNTIME_STATE_ADAPTER_VERSION,
  runtimeStateAdapterFromDescriptor,
  verifyExternalRuntimeState,
} from "./runtime-state.mjs";
import {
  createWorldModelStoreAdapter,
  WORLD_MODEL_STORAGE_CONTRACT,
} from "./world-model-store.mjs";

export const WORLD_MODEL_VERSION = "0.4.0";
export const WORLD_MODEL_STORE = WORLD_MODEL_STORAGE_CONTRACT;

const EXCLUDED_DIRECTORIES = new Set([
  ".git", ".head", ".hg", ".svn", ".venv", "venv", "node_modules", "vendor",
  "dist", "build", "coverage", ".next", ".nuxt", ".cache", "target", "out",
]);
const TEXT_EXTENSIONS = new Set([
  ".c", ".cc", ".cpp", ".cs", ".css", ".go", ".h", ".hpp", ".html", ".java",
  ".js", ".jsx", ".json", ".kt", ".kts", ".md", ".mjs", ".mts", ".php", ".ps1",
  ".py", ".rb", ".rs", ".sh", ".sql", ".svelte", ".toml", ".ts", ".tsx", ".txt",
  ".vue", ".xml", ".yaml", ".yml",
]);
const MAX_FILE_BYTES = 512 * 1024;
const MAX_FILES = 20_000;
const MAX_SYMBOLS_PER_FILE = 200;

const fail = (message, code = "WORLD_MODEL_ERROR") => {
  const error = new Error(message);
  error.code = code;
  throw error;
};

const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonical(value));
}

function readyProject(root) {
  const inspected = inspectProject(root);
  if (inspected.status !== "ready") {
    fail(`Project must be ready to build a World Model; current status: ${inspected.status}.`, "PROJECT_NOT_READY");
  }
  return inspected;
}

function normalizedPath(root, file) {
  return path.relative(root, file).replaceAll("\\", "/");
}

function languageFor(extension, base) {
  if (base === "Dockerfile") return "dockerfile";
  const languages = {
    ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".ts": "typescript",
    ".tsx": "typescript", ".mts": "typescript", ".py": "python", ".go": "go", ".rs": "rust",
    ".java": "java", ".kt": "kotlin", ".kts": "kotlin", ".cs": "csharp", ".rb": "ruby",
    ".php": "php", ".md": "markdown", ".json": "json", ".yaml": "yaml", ".yml": "yaml",
    ".toml": "toml", ".html": "html", ".css": "css", ".sql": "sql", ".ps1": "powershell",
    ".sh": "shell", ".vue": "vue", ".svelte": "svelte",
  };
  return languages[extension] || extension.slice(1) || "text";
}

function classificationFor(relative, extension) {
  const segments = relative.toLowerCase().split("/");
  const base = segments.at(-1);
  if (segments.some((item) => item === "test" || item === "tests" || item === "__tests__") || /(?:^|[._-])(test|spec)\./.test(base)) return "test";
  if (extension === ".md" || segments.includes("docs")) return "documentation";
  if ([".json", ".yaml", ".yml", ".toml"].includes(extension) || base.startsWith(".")) return "configuration";
  return "source";
}

function lineAt(text, index) {
  let line = 1;
  for (let position = 0; position < index; position += 1) if (text.charCodeAt(position) === 10) line += 1;
  return line;
}

function regexSymbols(text, expressions) {
  const symbols = [];
  for (const [kind, expression] of expressions) {
    for (const match of text.matchAll(expression)) {
      symbols.push({ name: match[1], kind, line: lineAt(text, match.index || 0) });
      if (symbols.length >= MAX_SYMBOLS_PER_FILE) return symbols;
    }
  }
  return symbols.sort((left, right) => left.line - right.line || left.name.localeCompare(right.name));
}

function symbolsFor(text, language) {
  if (["javascript", "typescript"].includes(language)) {
    return regexSymbols(text, [
      ["function", /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g],
      ["class", /\b(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g],
      ["binding", /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g],
    ]);
  }
  if (language === "python") {
    return regexSymbols(text, [
      ["function", /^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)/gm],
      ["class", /^\s*class\s+([A-Za-z_][\w]*)/gm],
    ]);
  }
  if (language === "markdown") {
    return regexSymbols(text, [["heading", /^#{1,6}\s+(.+?)\s*$/gm]]);
  }
  return [];
}

function dependenciesFor(text, language, base) {
  const dependencies = [];
  const seen = new Set();
  const add = (specifier, kind, line = 1) => {
    if (!specifier || seen.has(`${kind}:${specifier}`)) return;
    seen.add(`${kind}:${specifier}`);
    dependencies.push({ specifier, kind, line });
  };
  if (["javascript", "typescript"].includes(language)) {
    for (const match of text.matchAll(/\b(?:from\s+|import\s*\(|require\s*\()\s*["']([^"']+)["']/g)) add(match[1], "module", lineAt(text, match.index || 0));
  } else if (language === "python") {
    for (const match of text.matchAll(/^\s*(?:from|import)\s+([A-Za-z_][\w.]*)/gm)) add(match[1], "module", lineAt(text, match.index || 0));
  }
  if (base === "package.json") {
    try {
      const parsed = JSON.parse(text);
      for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
        for (const name of Object.keys(parsed[section] || {})) add(name, section, 1);
      }
    } catch {}
  }
  return dependencies.sort((left, right) => left.kind.localeCompare(right.kind) || left.specifier.localeCompare(right.specifier));
}

function managedRootFiles(project) {
  const values = [];
  if (project.integrations?.codex?.status === "managed") values.push("AGENTS.md");
  if (project.integrations?.opencode?.status === "managed") values.push("opencode.json");
  return new Set(values);
}

function gitReferenceState(gitPath) {
  const files = [];
  const references = new Map();
  const tagNames = new Set();
  const add = (file, relative) => {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return;
    const normalized = relative.replaceAll("\\", "/");
    const content = fs.readFileSync(file, "utf8");
    files.push({ path: normalized, digest: digest(content) });
    if (/^refs\/(?:heads|remotes)\//.test(normalized)) {
      const value = content.trim().toLocaleLowerCase();
      if (/^[a-f0-9]{40,64}$/.test(value)) references.set(normalized, value);
    }
    if (normalized.startsWith("refs/tags/")) tagNames.add(normalized.slice("refs/tags/".length));
  };
  add(path.join(gitPath, "HEAD"), "HEAD");
  add(path.join(gitPath, "packed-refs"), "packed-refs");
  const packedRefs = path.join(gitPath, "packed-refs");
  if (fs.existsSync(packedRefs)) for (const line of fs.readFileSync(packedRefs, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([a-f0-9]{40,64})\s+(refs\/(?:heads|remotes)\/[A-Za-z0-9._\/-]+)$/i);
    if (match) references.set(match[2], match[1].toLocaleLowerCase());
    const tag = line.match(/^[a-f0-9]{40,64}\s+refs\/tags\/(.+)$/i);
    if (tag) tagNames.add(tag[1]);
  }
  const refsRoot = path.join(gitPath, "refs");
  const stack = fs.existsSync(refsRoot) ? [refsRoot] : [];
  while (stack.length) {
    const directory = stack.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) stack.push(absolute);
      else if (entry.isFile()) add(absolute, path.relative(gitPath, absolute));
    }
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  return {
    referencesDigest: digest(canonicalJson(files)),
    references: [...references.entries()].map(([ref, commit]) => ({ ref, commit })).sort((left, right) => left.ref.localeCompare(right.ref)),
    tagNames: [...tagNames].sort(),
  };
}

function gitHeadState(root) {
  const gitPath = path.join(root, ".git");
  if (!fs.existsSync(gitPath)) return { status: "not-a-git-repository", ref: "", commit: "", referencesDigest: "" };
  if (!fs.statSync(gitPath).isDirectory()) return { status: "external-gitdir-not-followed", ref: "", commit: "", referencesDigest: "" };
  const referenceState = gitReferenceState(gitPath);
  const { referencesDigest, references, tagNames } = referenceState;
  const referencedCommits = () => [...new Set(references.map((item) => item.commit))].sort();
  const headFile = path.join(gitPath, "HEAD");
  if (!fs.existsSync(headFile)) return { status: "head-missing", ref: "", commit: "", referencesDigest, references, referenceCommits: referencedCommits(), referenceTags: tagNames };
  const head = fs.readFileSync(headFile, "utf8").trim();
  if (!head.startsWith("ref: ")) return {
    status: /^[a-f0-9]{40,64}$/i.test(head) ? "detached-head" : "invalid-head",
    ref: "",
    commit: /^[a-f0-9]{40,64}$/i.test(head) ? head.toLowerCase() : "",
    referencesDigest,
    references,
    referenceCommits: [...new Set([...referencedCommits(), ...(/^[a-f0-9]{40,64}$/i.test(head) ? [head.toLowerCase()] : [])])].sort(),
    referenceTags: tagNames,
  };
  const ref = head.slice(5).trim().replaceAll("\\", "/");
  if (!/^refs\/[A-Za-z0-9._\/-]+$/.test(ref) || ref.includes("../")) return { status: "invalid-ref", ref, commit: "", referencesDigest, references, referenceCommits: referencedCommits(), referenceTags: tagNames };
  const refFile = path.join(gitPath, ...ref.split("/"));
  let commit = "";
  if (fs.existsSync(refFile)) {
    const value = fs.readFileSync(refFile, "utf8").trim();
    if (/^[a-f0-9]{40,64}$/i.test(value)) commit = value.toLowerCase();
  }
  if (!commit) commit = references.find((item) => item.ref === ref)?.commit || "";
  return {
    status: commit ? "head-and-local-refs" : "unresolved-ref",
    ref,
    commit,
    referencesDigest,
    references,
    referenceCommits: [...new Set([...referencedCommits(), ...(commit ? [commit] : [])])].sort(),
    referenceTags: tagNames,
  };
}

function runtimeStateFor(state) {
  return canonical({
    sessionId: state.sessionId || "",
    mode: state.mode || "session",
    currentWholePlanId: state.currentWholePlanId || null,
    activeRunId: state.activeRunId || null,
    activeExecutionContractId: state.activeExecutionContractId || null,
    lastResultPacketId: state.lastResultPacketId || null,
    pendingReview: state.pendingReview || null,
    lastReviewDecisionId: state.lastReviewDecisionId || null,
    requiredPlanAction: state.requiredPlanAction || null,
    latestCheckpoint: state.latestCheckpoint || null,
  });
}

function scanRepository(project) {
  const root = project.projectRoot;
  const managed = managedRootFiles(project);
  const files = [];
  const sources = new Map();
  const skipped = { excludedDirectory: 0, managedProjection: 0, unsupportedType: 0, tooLarge: 0, symlink: 0 };
  const stack = [root];
  while (stack.length) {
    const directory = stack.pop();
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = normalizedPath(root, absolute);
      if (entry.isSymbolicLink()) { skipped.symlink += 1; continue; }
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRECTORIES.has(entry.name.toLowerCase())) skipped.excludedDirectory += 1;
        else stack.push(absolute);
        continue;
      }
      if (!entry.isFile()) { skipped.unsupportedType += 1; continue; }
      if (managed.has(relative)) { skipped.managedProjection += 1; continue; }
      const base = entry.name;
      const extension = path.extname(base).toLowerCase();
      if (!TEXT_EXTENSIONS.has(extension) && base !== "Dockerfile") { skipped.unsupportedType += 1; continue; }
      const stat = fs.statSync(absolute);
      if (stat.size > MAX_FILE_BYTES) { skipped.tooLarge += 1; continue; }
      if (files.length >= MAX_FILES) fail(`Repository index exceeds ${MAX_FILES} files.`, "WORLD_MODEL_FILE_LIMIT");
      const content = fs.readFileSync(absolute, "utf8");
      const language = languageFor(extension, base);
      sources.set(relative, { content, language });
      files.push({
        path: relative,
        digest: digest(content),
        freshness: "active",
        bytes: stat.size,
        classification: classificationFor(relative, extension),
        language,
        symbols: symbolsFor(content, language),
        dependencies: dependenciesFor(content, language, base),
      });
    }
  }
  return { files: files.sort((left, right) => left.path.localeCompare(right.path)), skipped, sources };
}

function verifiedSnapshot(snapshot, expectedId = "") {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) fail("World Model snapshot is invalid.", "INVALID_WORLD_MODEL");
  const recordedHash = snapshot.worldModelHash;
  const recordedId = snapshot.worldModelId;
  const payload = { ...snapshot };
  delete payload.worldModelId;
  delete payload.worldModelHash;
  const actualHash = digest(canonicalJson(payload));
  if (recordedHash !== actualHash || recordedId !== `world-model-${actualHash.slice(0, 24)}` || (expectedId && recordedId !== expectedId)) {
    fail("World Model snapshot digest verification failed.", "WORLD_MODEL_DIGEST_MISMATCH");
  }
  if (snapshot.semanticGraph) verifySemanticGraph(snapshot.semanticGraph);
  if (snapshot.gitDecisionHistory) verifyGitDecisionHistory(snapshot.gitDecisionHistory);
  if (snapshot.externalRuntimeState) verifyExternalRuntimeState(snapshot.externalRuntimeState);
  return snapshot;
}

function changesBetween(previous, current) {
  const before = new Map((previous?.files || []).map((item) => [item.path, item.digest]));
  const after = new Map(current.files.map((item) => [item.path, item.digest]));
  return {
    added: [...after.keys()].filter((file) => !before.has(file)).sort(),
    changed: [...after.keys()].filter((file) => before.has(file) && before.get(file) !== after.get(file)).sort(),
    removed: [...before.keys()].filter((file) => !after.has(file)).sort(),
  };
}

function indexerState() {
  return {
    worldModelVersion: WORLD_MODEL_VERSION,
    semanticGraphVersion: SEMANTIC_GRAPH_VERSION,
    gitDecisionHistoryVersion: GIT_DECISION_HISTORY_VERSION,
    gitHistoryAdapterVersion: GIT_HISTORY_ADAPTER_VERSION,
    externalRuntimeStateVersion: EXTERNAL_RUNTIME_STATE_VERSION,
    runtimeStateAdapterVersion: RUNTIME_STATE_ADAPTER_VERSION,
  };
}

function sourceDigestFor(files, git, runtimeState, externalRuntimeState, indexer) {
  return digest(canonicalJson({
    files: files.map((item) => ({ path: item.path, digest: item.digest })),
    git,
    runtimeState,
    externalRuntimeState: externalRuntimeState.runtimeStateHash,
    indexer,
  }));
}

export function readWorldModel({ root = ".", storeAdapter = null } = {}) {
  const inspected = readyProject(root);
  const projectRoot = inspected.project.projectRoot;
  const adapter = createWorldModelStoreAdapter({ projectRoot, adapter: storeAdapter });
  const pointerEntry = adapter.readPointer();
  if (!pointerEntry) fail("Repository World Model has not been built.", "WORLD_MODEL_NOT_BUILT");
  const pointer = pointerEntry.document;
  if (pointer.projectId !== inspected.project.projectId || typeof pointer.worldModelId !== "string") {
    fail("World Model pointer does not match this project.", "WORLD_MODEL_IDENTITY_MISMATCH");
  }
  const snapshotEntry = adapter.readSnapshot(pointer.worldModelId);
  if (!snapshotEntry) fail("World Model snapshot is missing.", "WORLD_MODEL_SNAPSHOT_MISSING");
  const snapshot = verifiedSnapshot(snapshotEntry.document, pointer.worldModelId);
  if (snapshot.worldModelHash !== pointer.worldModelHash) fail("World Model pointer hash does not match its snapshot.", "WORLD_MODEL_POINTER_MISMATCH");
  return {
    status: "verified",
    pointerFile: pointerEntry.location,
    file: snapshotEntry.location,
    pointer,
    snapshot,
    storeAdapter: adapter.describe(),
  };
}

export function inspectWorldModel({ root = ".", storeAdapter = null, runtimeStateAdapter = null } = {}) {
  const stored = readWorldModel({ root, storeAdapter });
  const inspected = readyProject(root);
  const scan = scanRepository(inspected.project);
  const git = gitHeadState(inspected.project.projectRoot);
  const runtimeState = runtimeStateFor(inspected.state);
  const selectedRuntimeAdapter = runtimeStateAdapter || runtimeStateAdapterFromDescriptor(stored.pointer.sourceAdapters?.runtimeState);
  const externalRuntimeResult = buildExternalRuntimeState({ projectRoot: inspected.project.projectRoot, adapter: selectedRuntimeAdapter });
  const externalRuntimeState = externalRuntimeResult.runtimeState;
  const currentSourceDigest = sourceDigestFor(scan.files, git, runtimeState, externalRuntimeState, indexerState());
  const current = { files: scan.files };
  const currentByPath = new Map(scan.files.map((item) => [item.path, item.digest]));
  const storedByPath = new Map(stored.snapshot.files.map((item) => [item.path, item.digest]));
  const fileFreshness = stored.snapshot.files.map((item) => ({
    path: item.path,
    status: !currentByPath.has(item.path)
      ? "removed"
      : currentByPath.get(item.path) === item.digest
        ? "active"
        : "stale",
  }));
  for (const item of scan.files) if (!storedByPath.has(item.path)) fileFreshness.push({ path: item.path, status: "unindexed" });
  fileFreshness.sort((left, right) => left.path.localeCompare(right.path));
  const fileChanges = changesBetween(stored.snapshot, current);
  return {
    ...stored,
    status: currentSourceDigest === stored.snapshot.sourceDigest ? "current" : "stale",
    currentSourceDigest,
    changes: {
      ...fileChanges,
      gitChanged: canonicalJson(git) !== canonicalJson(stored.snapshot.git),
      gitHistoryChanged: git.referencesDigest !== stored.snapshot.git?.referencesDigest,
      runtimeStateChanged: canonicalJson(runtimeState) !== canonicalJson(stored.snapshot.runtimeState),
      externalRuntimeStateChanged: externalRuntimeState.runtimeStateHash !== stored.snapshot.externalRuntimeState?.runtimeStateHash,
    },
    fileFreshness,
    sourceAdapters: { runtimeState: externalRuntimeResult.adapter },
    sourceDiagnostics: { runtimeState: externalRuntimeResult.diagnostics },
  };
}

export async function buildWorldModel({ root = ".", persist = true, storeAdapter = null, gitHistoryAdapter = null, runtimeStateAdapter = null } = {}) {
  const inspected = readyProject(root);
  const project = inspected.project;
  const scan = scanRepository(project);
  const git = gitHeadState(project.projectRoot);
  const runtimeState = runtimeStateFor(inspected.state);
  const indexer = indexerState();
  const externalRuntimeResult = buildExternalRuntimeState({ projectRoot: project.projectRoot, adapter: runtimeStateAdapter });
  const externalRuntimeState = externalRuntimeResult.runtimeState;
  const sourceDigest = sourceDigestFor(scan.files, git, runtimeState, externalRuntimeState, indexer);
  const semanticGraph = buildSemanticGraph({ files: scan.files, sources: scan.sources });
  const gitHistoryResult = await buildGitDecisionHistory({
    projectRoot: project.projectRoot,
    adapter: gitHistoryAdapter,
    referenceCommits: git.referenceCommits || [],
    referenceTags: git.referenceTags || [],
  });
  const gitDecisionHistory = gitHistoryResult.history;
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    kind: "RepositoryWorldModel",
    protocol: { name: "head-agent-core-world-model", version: WORLD_MODEL_VERSION },
    storageContract: WORLD_MODEL_STORAGE_CONTRACT,
    projectId: project.projectId,
    projectRoot: project.projectRoot,
    sourceDigest,
    indexer,
    rules: {
      maxFileBytes: MAX_FILE_BYTES,
      maxFiles: MAX_FILES,
      excludedDirectories: [...EXCLUDED_DIRECTORIES].sort(),
      managedRootProjectionsExcluded: [...managedRootFiles(project)].sort(),
    },
    coverage: {
      files: "supported-text-files-within-rules",
      symbols: "heuristic-javascript-typescript-python-markdown-with-content-derived-identities",
      dependencies: "heuristic-module-resolution-and-package-manifests",
      semanticGraph: "heuristic-file-symbol-import-call-graph-with-evidence-locations",
      gitHistory: gitDecisionHistory.coverage,
      runtimeState: "canonical-head-lifecycle-state",
      externalRuntimeState: externalRuntimeState.coverage,
    },
    git,
    gitDecisionHistory,
    runtimeState,
    externalRuntimeState,
    files: scan.files,
    semanticGraph,
    skipped: scan.skipped,
    summary: {
      fileCount: scan.files.length,
      symbolCount: scan.files.reduce((count, item) => count + item.symbols.length, 0),
      dependencyCount: scan.files.reduce((count, item) => count + item.dependencies.length, 0),
      semanticNodeCount: semanticGraph.summary.nodeCount,
      semanticEdgeCount: semanticGraph.summary.edgeCount,
      callEdgeCount: semanticGraph.summary.callEdgeCount,
      gitCommitCount: gitDecisionHistory.summary.commitCount,
      runtimeObservationCount: externalRuntimeState.summary.observationCount,
    },
  };
  const worldModelHash = digest(canonicalJson(payload));
  const worldModelId = `world-model-${worldModelHash.slice(0, 24)}`;
  const snapshot = { ...payload, worldModelId, worldModelHash };
  if (!persist) return { status: "preview", snapshot };

  const adapter = createWorldModelStoreAdapter({ projectRoot: project.projectRoot, adapter: storeAdapter });
  let previous = null;
  let previousPointer = null;
  if (adapter.readPointer()) {
    const current = readWorldModel({ root: project.projectRoot, storeAdapter: adapter });
    previous = current.snapshot;
    previousPointer = current.pointer;
  }
  const existingSnapshot = adapter.readSnapshot(worldModelId);
  let snapshotEntry;
  if (existingSnapshot) {
    verifiedSnapshot(existingSnapshot.document, worldModelId);
    snapshotEntry = existingSnapshot;
  } else {
    snapshotEntry = adapter.writeSnapshot(worldModelId, snapshot);
  }
  verifiedSnapshot(snapshotEntry.document, worldModelId);
  const changed = !previous || previous.worldModelId !== worldModelId;
  const fileChanges = changed ? changesBetween(previous, snapshot) : { added: [], changed: [], removed: [] };
  const changes = {
    ...fileChanges,
    gitChanged: changed && canonicalJson(previous?.git || null) !== canonicalJson(snapshot.git),
    gitHistoryChanged: changed && previous?.gitDecisionHistory?.historyHash !== snapshot.gitDecisionHistory.historyHash,
    runtimeStateChanged: changed && canonicalJson(previous?.runtimeState || null) !== canonicalJson(snapshot.runtimeState),
    externalRuntimeStateChanged: changed && previous?.externalRuntimeState?.runtimeStateHash !== snapshot.externalRuntimeState.runtimeStateHash,
  };
  const pointer = {
    schemaVersion: SCHEMA_VERSION,
    kind: "WorldModelPointer",
    projectId: project.projectId,
    storage: adapter.describe(),
    worldModelId,
    worldModelHash,
    previousWorldModelId: changed ? previous?.worldModelId || null : previousPointer?.previousWorldModelId || null,
    sourceAdapters: {
      runtimeState: externalRuntimeResult.adapter,
    },
    tiers: {
      hot: worldModelId,
      warm: changes,
      cold: "adapter-retained-snapshots",
      coldSnapshotCount: adapter.listSnapshotIds().length,
    },
  };
  const pointerEntry = adapter.writePointer(pointer);
  if (canonicalJson(pointerEntry.document) !== canonicalJson(pointer)) {
    fail("World Model store adapter changed the pointer during persistence.", "WORLD_MODEL_STORE_WRITE_MISMATCH");
  }
  return {
    status: changed ? "indexed" : "unchanged",
    pointerFile: pointerEntry.location,
    file: snapshotEntry.location,
    pointer,
    snapshot,
    storeAdapter: adapter.describe(),
    sourceAdapters: { gitHistory: gitHistoryResult.adapter, runtimeState: externalRuntimeResult.adapter },
    sourceDiagnostics: { gitHistory: gitHistoryResult.diagnostics, runtimeState: externalRuntimeResult.diagnostics },
  };
}

export function queryWorldModel({ root = ".", query, depth = 1, maxResults = 100, storeAdapter = null } = {}) {
  const inspected = inspectWorldModel({ root, storeAdapter });
  if (inspected.status !== "current") fail("Repository World Model is stale and cannot answer semantic queries.", "WORLD_MODEL_STALE");
  if (!inspected.snapshot.semanticGraph) fail("Repository World Model has no semantic graph.", "SEMANTIC_GRAPH_NOT_BUILT");
  return {
    status: "current",
    worldModelId: inspected.snapshot.worldModelId,
    ...querySemanticGraph(inspected.snapshot.semanticGraph, { query, depth, maxResults }),
  };
}

export function queryWorldHistory({ root = ".", query = "", limit = 50, storeAdapter = null } = {}) {
  const inspected = inspectWorldModel({ root, storeAdapter });
  if (inspected.status !== "current") fail("Repository World Model is stale and cannot answer Git history queries.", "WORLD_MODEL_STALE");
  if (!inspected.snapshot.gitDecisionHistory) fail("Repository World Model has no Git decision history.", "GIT_DECISION_HISTORY_NOT_BUILT");
  return {
    status: "current",
    worldModelId: inspected.snapshot.worldModelId,
    ...queryGitDecisionHistory(inspected.snapshot.gitDecisionHistory, { query, limit }),
  };
}

export function queryWorldRuntimeState({ root = ".", query = "", runtime = "", state = "", kind = "", limit = 50, storeAdapter = null, runtimeStateAdapter = null } = {}) {
  const inspected = inspectWorldModel({ root, storeAdapter, runtimeStateAdapter });
  if (inspected.status !== "current") fail("Repository World Model is stale and cannot answer runtime state queries.", "WORLD_MODEL_STALE");
  if (!inspected.snapshot.externalRuntimeState) fail("Repository World Model has no external runtime state.", "EXTERNAL_RUNTIME_STATE_NOT_BUILT");
  return {
    status: "current",
    worldModelId: inspected.snapshot.worldModelId,
    ...queryExternalRuntimeState(inspected.snapshot.externalRuntimeState, { query, runtime, state, kind, limit }),
  };
}
