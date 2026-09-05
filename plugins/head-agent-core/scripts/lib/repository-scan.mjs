import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  buildComputeRequest,
  buildComputeSuccessResponse,
  DEFAULT_COMPUTE_LIMITS,
  executeComputeOperation,
  JsReferenceComputeAdapter,
  normalizeComputeLimits,
  validateComputeRequest,
  validateComputeResponse,
} from "./compute-adapter.mjs";
import {
  classifySourcePath,
  extractSemanticSourceFacts,
  extractSourceDependencies,
  extractSourceSymbols,
  languageForSource,
  SOURCE_ANALYSIS_VERSION,
} from "./source-analysis.mjs";
import { GoWorkerComputeAdapter } from "./go-worker-adapter.mjs";
import {
  buildRepositorySourceScope,
  pathWithinRepositorySourceScope,
  verifyRepositorySourceScope,
} from "./repository-source-scope.mjs";

export const REPOSITORY_SCAN_VERSION = "0.4.0";
export const REPOSITORY_SCAN_OPERATION = "repository.scan.v1";
export const REPOSITORY_SCAN_SEMANTIC_PRODUCER = Object.freeze({
  name: "head-agent-core-repository-scan",
  version: REPOSITORY_SCAN_VERSION,
});
export const REPOSITORY_SCAN_DEFAULTS = Object.freeze({
  maxFiles: DEFAULT_COMPUTE_LIMITS.maxFiles,
  maxFileBytes: DEFAULT_COMPUTE_LIMITS.maxFileBytes,
  maxTotalBytes: DEFAULT_COMPUTE_LIMITS.maxTotalBytes,
  maxSymbolsPerFile: 200,
});

export const REPOSITORY_SCAN_EXCLUDED_DIRECTORIES = Object.freeze([
  ".cache", ".git", ".head", ".hg", ".mypy_cache", ".next", ".nox", ".nuxt",
  ".omo", ".pytest_cache", ".ruff_cache", ".svn", ".tox", ".uv-cache", ".uv-python", ".venv",
  "__pycache__", "build", "coverage", "dist", "node_modules", "out", "target",
  "vendor", "venv",
].sort());
const EXCLUDED_DIRECTORIES = new Set(REPOSITORY_SCAN_EXCLUDED_DIRECTORIES);
const TEXT_EXTENSIONS = new Set([
  ".c", ".cc", ".cpp", ".cs", ".css", ".go", ".h", ".hpp", ".html", ".java",
  ".js", ".jsx", ".json", ".kt", ".kts", ".md", ".mjs", ".mts", ".php", ".ps1",
  ".py", ".rb", ".rs", ".sh", ".sql", ".svelte", ".toml", ".ts", ".tsx", ".txt",
  ".vue", ".xml", ".yaml", ".yml",
]);
const CLASSIFICATIONS = new Set(["configuration", "documentation", "source", "test"]);
const SOURCE_LANGUAGES = new Set([
  "c", "cc", "cpp", "csharp", "css", "dockerfile", "go", "h", "hpp", "html",
  "java", "javascript", "json", "kotlin", "markdown", "php", "powershell", "python",
  "ruby", "rust", "shell", "sql", "svelte", "toml", "txt", "typescript",
  "vue", "xml", "yaml",
]);
const SYMBOL_KINDS = new Set(["binding", "class", "function", "heading"]);
const DEPENDENCY_KINDS = new Set(["dependencies", "devDependencies", "module", "optionalDependencies", "peerDependencies"]);
const LEGACY_SKIPPED_FIELDS = Object.freeze(["excludedDirectory", "managedProjection", "unsupportedType", "tooLarge", "symlink"]);
const SKIPPED_FIELDS = Object.freeze([...LEGACY_SKIPPED_FIELDS, "outsideSourceScope"]);

const fail = (message, code = "REPOSITORY_SCAN_ERROR") => {
  const error = new Error(message);
  error.code = code;
  throw error;
};

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonical(value));
}

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertFields(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`, "INVALID_REPOSITORY_SCAN_SCHEMA");
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length) fail(`${label} contains unsupported fields: ${unexpected.sort().join(", ")}`, "INVALID_REPOSITORY_SCAN_SCHEMA");
}

function relativePath(value, label) {
  if (typeof value !== "string" || !value || value.includes("\0") || value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) fail(`${label} is not a normalized relative path.`, "INVALID_REPOSITORY_SCAN_PATH");
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized === "." || normalized === ".." || normalized.startsWith("../")) fail(`${label} escapes the project root.`, "INVALID_REPOSITORY_SCAN_PATH");
  return value;
}

function normalizeManagedRootFiles(values) {
  if (!Array.isArray(values)) fail("managedRootFiles must be an array.", "INVALID_REPOSITORY_SCAN_INPUT");
  const normalized = values.map((value, index) => relativePath(value, `managedRootFiles[${index}]`));
  if (new Set(normalized).size !== normalized.length) fail("managedRootFiles contains duplicates.", "INVALID_REPOSITORY_SCAN_INPUT");
  return normalized.sort(compareText);
}

export function managedRootFilesForProject(project) {
  const values = [];
  if (project?.integrations?.codex?.status === "managed") values.push("AGENTS.md");
  if (project?.integrations?.opencode?.status === "managed") values.push("opencode.json");
  return values.sort(compareText);
}

export function buildRepositoryScanInput({ projectRoot, managedRootFiles = [], sourceScope = buildRepositorySourceScope() } = {}) {
  if (typeof projectRoot !== "string" || !projectRoot.trim() || projectRoot.includes("\0")) fail("projectRoot is required.", "INVALID_REPOSITORY_SCAN_INPUT");
  return {
    schemaVersion: 1,
    kind: "RepositoryScanInput",
    projectRoot: path.resolve(projectRoot),
    managedRootFiles: normalizeManagedRootFiles(managedRootFiles),
    sourceScope: verifyRepositorySourceScope(sourceScope),
  };
}

export function validateRepositoryScanInput(input) {
  assertFields(input, ["schemaVersion", "kind", "projectRoot", "managedRootFiles", "sourceScope"], "Repository scan input");
  const rebuilt = buildRepositoryScanInput(input);
  if (canonicalJson(rebuilt) !== canonicalJson(input)) fail("Repository scan input is not canonical.", "INVALID_REPOSITORY_SCAN_INPUT");
  return input;
}

function normalizePath(root, file) {
  return path.relative(root, file).replaceAll("\\", "/");
}

function scanPayload(input, limits, { previousResult = null, reuseDiagnostics = null } = {}) {
  validateRepositoryScanInput(input);
  const normalizedLimits = normalizeComputeLimits(limits);
  const root = input.projectRoot;
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) fail("Repository scan root is not a directory.", "REPOSITORY_SCAN_ROOT_INVALID");
  if (previousResult) validateRepositoryScanResult(previousResult);
  const previousFiles = new Map((previousResult?.files || []).map((file) => [file.path, file]));
  const managed = new Set(input.managedRootFiles);
  const files = [];
  const skipped = Object.fromEntries(SKIPPED_FIELDS.map((field) => [field, 0]));
  let totalBytes = 0;
  const stack = [root];
  while (stack.length) {
    const directory = stack.pop();
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = normalizePath(root, absolute);
      if (entry.isSymbolicLink()) { skipped.symlink += 1; continue; }
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRECTORIES.has(entry.name.toLowerCase())) skipped.excludedDirectory += 1;
        else if (!pathWithinRepositorySourceScope(relative, input.sourceScope, { directory: true })) skipped.outsideSourceScope += 1;
        else stack.push(absolute);
        continue;
      }
      if (!entry.isFile()) { skipped.unsupportedType += 1; continue; }
      if (!pathWithinRepositorySourceScope(relative, input.sourceScope)) { skipped.outsideSourceScope += 1; continue; }
      if (managed.has(relative)) { skipped.managedProjection += 1; continue; }
      const base = entry.name;
      const extension = path.extname(base).toLowerCase();
      if (!TEXT_EXTENSIONS.has(extension) && base !== "Dockerfile") { skipped.unsupportedType += 1; continue; }
      const stat = fs.statSync(absolute);
      if (stat.size > normalizedLimits.maxFileBytes) { skipped.tooLarge += 1; continue; }
      const raw = fs.readFileSync(absolute);
      if (raw.length > normalizedLimits.maxFileBytes) { skipped.tooLarge += 1; continue; }
      if (files.length >= normalizedLimits.maxFiles) fail(`Repository scan exceeds ${normalizedLimits.maxFiles} files.`, "REPOSITORY_SCAN_FILE_LIMIT");
      if (totalBytes + raw.length > normalizedLimits.maxTotalBytes) fail(`Repository scan exceeds ${normalizedLimits.maxTotalBytes} total bytes.`, "REPOSITORY_SCAN_TOTAL_BYTES_LIMIT");
      const content = raw.toString("utf8");
      const language = languageForSource(extension, base);
      const classification = classifySourcePath(relative, extension);
      const contentDigest = digest(raw);
      const previous = previousFiles.get(relative);
      const reusable = previous
        && previous.digest === contentDigest
        && previous.bytes === raw.length
        && previous.classification === classification
        && previous.language === language;
      files.push(reusable ? {
        path: relative,
        digest: contentDigest,
        freshness: "active",
        bytes: raw.length,
        classification,
        language,
        symbols: previous.symbols,
        dependencies: previous.dependencies,
        semanticFacts: previous.semanticFacts,
      } : {
        path: relative,
        digest: contentDigest,
        freshness: "active",
        bytes: raw.length,
        classification,
        language,
        symbols: extractSourceSymbols(content, language, { maxSymbols: REPOSITORY_SCAN_DEFAULTS.maxSymbolsPerFile }),
        dependencies: extractSourceDependencies(content, language, base),
        semanticFacts: extractSemanticSourceFacts(content, language),
      });
      if (reuseDiagnostics) (reusable ? reuseDiagnostics.reusedPaths : reuseDiagnostics.analyzedPaths).push(relative);
      totalBytes += raw.length;
    }
  }
  files.sort((left, right) => compareText(left.path, right.path));
  if (reuseDiagnostics) {
    const currentPaths = new Set(files.map((file) => file.path));
    reuseDiagnostics.reusedPaths.sort(compareText);
    reuseDiagnostics.analyzedPaths.sort(compareText);
    reuseDiagnostics.removedPaths.push(...[...previousFiles.keys()].filter((file) => !currentPaths.has(file)).sort(compareText));
  }
  return {
    schemaVersion: 1,
    kind: "RepositoryScanResult",
    protocol: { name: "head-agent-core-repository-scan", version: REPOSITORY_SCAN_VERSION },
    sourceAnalysisVersion: SOURCE_ANALYSIS_VERSION,
    authority: "derived-evidence-only",
    instructionAuthority: false,
    promotionAuthority: false,
    sourceScope: input.sourceScope,
    files,
    skipped,
    summary: {
      fileCount: files.length,
      totalBytes,
      symbolCount: files.reduce((sum, file) => sum + file.symbols.length, 0),
      dependencyCount: files.reduce((sum, file) => sum + file.dependencies.length, 0),
      bindingCount: files.reduce((sum, file) => sum + file.semanticFacts.bindings.length, 0),
      callCount: files.reduce((sum, file) => sum + file.semanticFacts.calls.length, 0),
    },
  };
}

function withIdentity(payload) {
  const scanHash = digest(canonicalJson(payload));
  return { ...payload, scanId: `repository-scan-${scanHash.slice(0, 24)}`, scanHash };
}

export function scanRepositoryReference(input, { limits = DEFAULT_COMPUTE_LIMITS } = {}) {
  const result = withIdentity(scanPayload(input, limits));
  return validateRepositoryScanResult(result);
}

export function inspectRepositoryScanFreshness({ projectRoot, managedRootFiles = [], sourceScope = buildRepositorySourceScope(), storedFiles = [], limits = {} } = {}) {
  const input = buildRepositoryScanInput({ projectRoot, managedRootFiles, sourceScope });
  const normalizedLimits = normalizeComputeLimits(limits);
  if (!Array.isArray(storedFiles)) fail("storedFiles must be an array.", "INVALID_REPOSITORY_SCAN_INPUT");
  const managed = new Set(input.managedRootFiles);
  const files = [];
  let totalBytes = 0;
  const stack = [input.projectRoot];
  while (stack.length) {
    const directory = stack.pop();
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = normalizePath(input.projectRoot, absolute);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name.toLowerCase()) && pathWithinRepositorySourceScope(relative, input.sourceScope, { directory: true })) stack.push(absolute);
        continue;
      }
      if (!entry.isFile() || !pathWithinRepositorySourceScope(relative, input.sourceScope) || managed.has(relative)) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (!TEXT_EXTENSIONS.has(extension) && entry.name !== "Dockerfile") continue;
      const stat = fs.statSync(absolute);
      if (stat.size > normalizedLimits.maxFileBytes) continue;
      const raw = fs.readFileSync(absolute);
      if (raw.length > normalizedLimits.maxFileBytes) continue;
      if (files.length >= normalizedLimits.maxFiles) fail(`Repository scan exceeds ${normalizedLimits.maxFiles} files.`, "REPOSITORY_SCAN_FILE_LIMIT");
      if (totalBytes + raw.length > normalizedLimits.maxTotalBytes) fail(`Repository scan exceeds ${normalizedLimits.maxTotalBytes} total bytes.`, "REPOSITORY_SCAN_TOTAL_BYTES_LIMIT");
      files.push({
        path: relative,
        digest: digest(raw),
        bytes: raw.length,
        classification: classifySourcePath(relative, extension),
        language: languageForSource(extension, entry.name),
      });
      totalBytes += raw.length;
    }
  }
  files.sort((left, right) => compareText(left.path, right.path));
  const before = new Map(storedFiles.map((file) => [file.path, file]));
  const after = new Map(files.map((file) => [file.path, file]));
  const added = [...after.keys()].filter((file) => !before.has(file)).sort(compareText);
  const removed = [...before.keys()].filter((file) => !after.has(file)).sort(compareText);
  const changed = [...after.keys()].filter((file) => {
    const previous = before.get(file);
    const current = after.get(file);
    return previous && ["digest", "bytes", "classification", "language"].some((field) => previous[field] !== current[field]);
  }).sort(compareText);
  return {
    status: added.length || changed.length || removed.length ? "changed" : "unchanged",
    sourceScope: input.sourceScope,
    files,
    changes: { added, changed, removed },
  };
}

function resultFromWorldModelSnapshot(snapshot) {
  return {
    schemaVersion: 1,
    kind: "RepositoryScanResult",
    ...snapshot.repositoryScan,
    files: snapshot.files,
    skipped: snapshot.skipped,
  };
}

function changesBetweenScans(previous, current) {
  const before = new Map(previous.files.map((file) => [file.path, file.digest]));
  const after = new Map(current.files.map((file) => [file.path, file.digest]));
  return {
    added: [...after.keys()].filter((file) => !before.has(file)).sort(compareText),
    changed: [...after.keys()].filter((file) => before.has(file) && before.get(file) !== after.get(file)).sort(compareText),
    removed: [...before.keys()].filter((file) => !after.has(file)).sort(compareText),
  };
}

export function repositoryScanResultFromWorldModel(snapshot) {
  if (!snapshot?.repositoryScan || !Array.isArray(snapshot.files) || !snapshot.skipped) {
    fail("World Model snapshot does not contain a repository scan.", "REPOSITORY_SCAN_SNAPSHOT_MISSING");
  }
  return validateRepositoryScanResult(resultFromWorldModelSnapshot(snapshot));
}

export function validateRepositoryScanExecution(execution, { projectRoot, managedRootFiles = [], sourceScope = buildRepositorySourceScope() } = {}) {
  if (!execution || typeof execution !== "object" || Array.isArray(execution)) fail("Repository scan execution is required.", "INVALID_REPOSITORY_SCAN_EXECUTION");
  const expectedInput = buildRepositoryScanInput({ projectRoot, managedRootFiles, sourceScope });
  validateComputeRequest(execution.request);
  validateComputeResponse(execution.request, execution.response);
  if (execution.request.operation !== REPOSITORY_SCAN_OPERATION
    || canonicalJson(execution.request.semanticProducer) !== canonicalJson(REPOSITORY_SCAN_SEMANTIC_PRODUCER)
    || canonicalJson(execution.request.input) !== canonicalJson(expectedInput)
    || execution.response.status !== "ok"
    || canonicalJson(execution.response.result) !== canonicalJson(execution.result)) {
    fail("Repository scan execution does not match the requested project scan.", "INVALID_REPOSITORY_SCAN_EXECUTION");
  }
  validateRepositoryScanResult(execution.result);
  return execution;
}

export async function executeIncrementalRepositoryScan({ projectRoot, managedRootFiles = [], sourceScope = buildRepositorySourceScope(), previousSnapshot, limits = {} } = {}) {
  const previousResult = repositoryScanResultFromWorldModel(previousSnapshot);
  const input = buildRepositoryScanInput({ projectRoot, managedRootFiles, sourceScope });
  const request = buildComputeRequest({
    operation: REPOSITORY_SCAN_OPERATION,
    input,
    semanticProducer: REPOSITORY_SCAN_SEMANTIC_PRODUCER,
    limits,
  });
  const reuse = { reusedPaths: [], analyzedPaths: [], removedPaths: [] };
  const result = validateRepositoryScanResult(withIdentity(scanPayload(input, request.limits, {
    previousResult,
    reuseDiagnostics: reuse,
  })));
  const response = buildComputeSuccessResponse(request, result);
  validateComputeResponse(request, response);
  const changes = changesBetweenScans(previousResult, result);
  return validateRepositoryScanExecution({
    request,
    response,
    result,
    diagnostics: {
      backend: "javascript-reference",
      adapterName: "repository-scan-incremental-reference",
      executionMode: "in-process-incremental-reuse",
      fallbackUsed: false,
      fallbackReasonCode: "",
      workerRelativePath: "",
      workerSha256: "",
      reusedFileCount: reuse.reusedPaths.length,
      analyzedFileCount: reuse.analyzedPaths.length,
      removedFileCount: reuse.removedPaths.length,
      reusedPaths: reuse.reusedPaths,
      analyzedPaths: reuse.analyzedPaths,
      removedPaths: reuse.removedPaths,
      changes,
    },
  }, { projectRoot, managedRootFiles, sourceScope });
}

function assertOrderedUnique(values, identity, label) {
  const identities = values.map(identity);
  if (new Set(identities).size !== identities.length || canonicalJson([...identities].sort(compareText)) !== canonicalJson(identities)) fail(`${label} is not sorted and unique.`, "INVALID_REPOSITORY_SCAN_RESULT");
}

function assertOrdered(values, comparator, label) {
  for (let index = 1; index < values.length; index += 1) {
    if (comparator(values[index - 1], values[index]) > 0) fail(`${label} is not canonically ordered.`, "INVALID_REPOSITORY_SCAN_RESULT");
  }
}

function validateLineRecord(record, fields, label) {
  assertFields(record, fields, label);
  if (!Number.isInteger(record.line) || record.line < 1) fail(`${label}.line is invalid.`, "INVALID_REPOSITORY_SCAN_RESULT");
}

export function validateRepositoryScanResult(result) {
  const currentProtocol = result?.protocol?.version === REPOSITORY_SCAN_VERSION;
  const scopedProtocol = currentProtocol || result?.protocol?.version === "0.3.0";
  const legacyProtocol = new Set(["0.2.0", "0.3.0"]).has(result?.protocol?.version);
  assertFields(result, ["schemaVersion", "kind", "protocol", "sourceAnalysisVersion", "authority", "instructionAuthority", "promotionAuthority", ...(scopedProtocol ? ["sourceScope"] : []), "files", "skipped", "summary", "scanId", "scanHash"], "Repository scan result");
  if (result.schemaVersion !== 1 || result.kind !== "RepositoryScanResult"
    || result.protocol?.name !== "head-agent-core-repository-scan" || (!currentProtocol && !legacyProtocol)
    || result.sourceAnalysisVersion !== SOURCE_ANALYSIS_VERSION || result.authority !== "derived-evidence-only"
    || result.instructionAuthority !== false || result.promotionAuthority !== false || !Array.isArray(result.files)) {
    fail("Repository scan result contract is invalid.", "INVALID_REPOSITORY_SCAN_RESULT");
  }
  if (scopedProtocol) verifyRepositorySourceScope(result.sourceScope);
  assertOrderedUnique(result.files, (file) => file.path, "Repository scan files");
  for (const [index, file] of result.files.entries()) {
    const label = `files[${index}]`;
    assertFields(file, ["path", "digest", "freshness", "bytes", "classification", "language", "symbols", "dependencies", "semanticFacts"], label);
    relativePath(file.path, `${label}.path`);
    if (!/^[a-f0-9]{64}$/.test(file.digest) || file.freshness !== "active" || !Number.isInteger(file.bytes) || file.bytes < 0
      || !CLASSIFICATIONS.has(file.classification) || !SOURCE_LANGUAGES.has(file.language)) fail(`${label} metadata is invalid.`, "INVALID_REPOSITORY_SCAN_RESULT");
    if (!Array.isArray(file.symbols) || !Array.isArray(file.dependencies)) fail(`${label} analysis arrays are invalid.`, "INVALID_REPOSITORY_SCAN_RESULT");
    for (const [symbolIndex, symbol] of file.symbols.entries()) {
      validateLineRecord(symbol, ["name", "kind", "line"], `${label}.symbols[${symbolIndex}]`);
      if (typeof symbol.name !== "string" || !symbol.name || !SYMBOL_KINDS.has(symbol.kind)) fail(`${label} symbol is invalid.`, "INVALID_REPOSITORY_SCAN_RESULT");
    }
    assertOrdered(file.symbols, (left, right) => left.line - right.line || compareText(left.name, right.name), `${label}.symbols`);
    if (new Set(file.symbols.map((symbol) => `${symbol.line}|${symbol.kind}|${symbol.name}`)).size !== file.symbols.length) fail(`${label}.symbols contains duplicates.`, "INVALID_REPOSITORY_SCAN_RESULT");
    for (const [dependencyIndex, dependency] of file.dependencies.entries()) {
      validateLineRecord(dependency, ["specifier", "kind", "line"], `${label}.dependencies[${dependencyIndex}]`);
      if (typeof dependency.specifier !== "string" || !dependency.specifier || !DEPENDENCY_KINDS.has(dependency.kind)) fail(`${label} dependency is invalid.`, "INVALID_REPOSITORY_SCAN_RESULT");
    }
    assertOrdered(file.dependencies, (left, right) => compareText(left.kind, right.kind) || compareText(left.specifier, right.specifier) || left.line - right.line, `${label}.dependencies`);
    if (new Set(file.dependencies.map((dependency) => `${dependency.kind}|${dependency.specifier}`)).size !== file.dependencies.length) fail(`${label}.dependencies contains duplicates.`, "INVALID_REPOSITORY_SCAN_RESULT");
    assertFields(file.semanticFacts, ["bindings", "calls"], `${label}.semanticFacts`);
    if (!Array.isArray(file.semanticFacts.bindings) || !Array.isArray(file.semanticFacts.calls)) fail(`${label} semantic facts are invalid.`, "INVALID_REPOSITORY_SCAN_RESULT");
    for (const [bindingIndex, binding] of file.semanticFacts.bindings.entries()) {
      assertFields(binding, ["local", "imported", "specifier", "namespace"], `${label}.semanticFacts.bindings[${bindingIndex}]`);
      if (![binding.local, binding.imported, binding.specifier].every((value) => typeof value === "string" && value) || typeof binding.namespace !== "boolean") fail(`${label} binding is invalid.`, "INVALID_REPOSITORY_SCAN_RESULT");
    }
    assertOrdered(file.semanticFacts.bindings, (left, right) => compareText(left.local, right.local) || compareText(left.specifier, right.specifier) || compareText(left.imported, right.imported), `${label}.semanticFacts.bindings`);
    for (const [callIndex, call] of file.semanticFacts.calls.entries()) {
      validateLineRecord(call, ["callee", "line"], `${label}.semanticFacts.calls[${callIndex}]`);
      if (typeof call.callee !== "string" || !call.callee) fail(`${label} call is invalid.`, "INVALID_REPOSITORY_SCAN_RESULT");
    }
    assertOrdered(file.semanticFacts.calls, (left, right) => left.line - right.line || compareText(left.callee, right.callee), `${label}.semanticFacts.calls`);
  }
  const skippedFields = scopedProtocol ? SKIPPED_FIELDS : LEGACY_SKIPPED_FIELDS;
  assertFields(result.skipped, skippedFields, "Repository scan skipped counts");
  if (skippedFields.some((field) => !Number.isInteger(result.skipped[field]) || result.skipped[field] < 0)) fail("Repository scan skipped counts are invalid.", "INVALID_REPOSITORY_SCAN_RESULT");
  assertFields(result.summary, ["fileCount", "totalBytes", "symbolCount", "dependencyCount", "bindingCount", "callCount"], "Repository scan summary");
  const expectedSummary = {
    fileCount: result.files.length,
    totalBytes: result.files.reduce((sum, file) => sum + file.bytes, 0),
    symbolCount: result.files.reduce((sum, file) => sum + file.symbols.length, 0),
    dependencyCount: result.files.reduce((sum, file) => sum + file.dependencies.length, 0),
    bindingCount: result.files.reduce((sum, file) => sum + file.semanticFacts.bindings.length, 0),
    callCount: result.files.reduce((sum, file) => sum + file.semanticFacts.calls.length, 0),
  };
  if (canonicalJson(result.summary) !== canonicalJson(expectedSummary)) fail("Repository scan summary does not match files.", "REPOSITORY_SCAN_SUMMARY_MISMATCH");
  const payload = { ...result };
  delete payload.scanId;
  delete payload.scanHash;
  const scanHash = digest(canonicalJson(payload));
  if (result.scanHash !== scanHash || result.scanId !== `repository-scan-${scanHash.slice(0, 24)}`) fail("Repository scan digest verification failed.", "REPOSITORY_SCAN_DIGEST_MISMATCH");
  return result;
}

export function createRepositoryScanReferenceAdapter() {
  return new JsReferenceComputeAdapter({
    name: "repository-scan-javascript-reference",
    operations: {
      [REPOSITORY_SCAN_OPERATION]: (input, { limits }) => scanRepositoryReference(input, { limits }),
    },
  });
}

export function createRepositoryScanComputeAdapter({ pluginRoot = path.resolve(import.meta.dirname, "../..") } = {}) {
  return new GoWorkerComputeAdapter({
    pluginRoot,
    fallbackAdapter: createRepositoryScanReferenceAdapter(),
  });
}

export async function executeRepositoryScan({ adapter = createRepositoryScanComputeAdapter(), projectRoot, managedRootFiles = [], sourceScope = buildRepositorySourceScope(), limits = {} } = {}) {
  const input = buildRepositoryScanInput({ projectRoot, managedRootFiles, sourceScope });
  const execution = await executeComputeOperation({
    adapter,
    operation: REPOSITORY_SCAN_OPERATION,
    input,
    semanticProducer: REPOSITORY_SCAN_SEMANTIC_PRODUCER,
    limits,
  });
  validateRepositoryScanResult(execution.result);
  return execution;
}
