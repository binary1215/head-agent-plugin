import crypto from "node:crypto";
import path from "node:path";

export const SEMANTIC_GRAPH_VERSION = "0.1.0";

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

function identity(prefix, value) {
  return `${prefix}-${digest(canonicalJson(value)).slice(0, 24)}`;
}

function lineAt(text, index) {
  let line = 1;
  for (let position = 0; position < index; position += 1) if (text.charCodeAt(position) === 10) line += 1;
  return line;
}

function repositoryModule(filesByPath, fromPath, specifier, language) {
  if (language === "python" && !specifier.startsWith(".")) {
    const pythonBase = specifier.replaceAll(".", "/");
    for (const candidate of [`${pythonBase}.py`, `${pythonBase}/__init__.py`]) if (filesByPath.has(candidate)) return candidate;
    return null;
  }
  if (!specifier.startsWith(".")) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), specifier));
  const candidates = path.posix.extname(base)
    ? [base]
    : [base, ...[".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx", ".py"].map((extension) => `${base}${extension}`),
      ...["index.js", "index.jsx", "index.mjs", "index.mts", "index.ts", "index.tsx", "__init__.py"].map((name) => `${base}/${name}`)];
  return candidates.find((candidate) => filesByPath.has(candidate)) || null;
}

function importBindings(text, language) {
  const bindings = [];
  const add = (local, imported, specifier, namespace = false) => {
    if (local && specifier) bindings.push({ local, imported, specifier, namespace });
  };
  if (["javascript", "typescript"].includes(language)) {
    for (const match of text.matchAll(/\bimport\s+([^;\n]+?)\s+from\s+["']([^"']+)["']/g)) {
      const clause = match[1].trim();
      const specifier = match[2];
      const namespace = clause.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (namespace) add(namespace[1], "*", specifier, true);
      const named = clause.match(/\{([^}]+)\}/);
      if (named) for (const item of named[1].split(",")) {
        const parts = item.trim().split(/\s+as\s+/);
        if (parts[0]) add(parts[1] || parts[0], parts[0], specifier);
      }
      const defaultBinding = clause.split(",")[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(defaultBinding)) add(defaultBinding, "default", specifier);
    }
    for (const match of text.matchAll(/\b(?:const|let|var)\s+\{([^}]+)\}\s*=\s*require\s*\(\s*["']([^"']+)["']\s*\)/g)) {
      for (const item of match[1].split(",")) {
        const parts = item.trim().split(/\s*:\s*/);
        if (parts[0]) add(parts[1] || parts[0], parts[0], match[2]);
      }
    }
    for (const match of text.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*["']([^"']+)["']\s*\)/g)) {
      add(match[1], "*", match[2], true);
    }
  } else if (language === "python") {
    for (const match of text.matchAll(/^\s*from\s+([.A-Za-z_][\w.]*)\s+import\s+([^#\n]+)/gm)) {
      for (const item of match[2].split(",")) {
        const parts = item.trim().split(/\s+as\s+/);
        if (parts[0]) add(parts[1] || parts[0], parts[0], match[1]);
      }
    }
    for (const match of text.matchAll(/^\s*import\s+([A-Za-z_][\w.]*)(?:\s+as\s+([A-Za-z_][\w]*))?/gm)) {
      add(match[2] || match[1].split(".")[0], "*", match[1], true);
    }
  }
  return bindings.sort((left, right) => left.local.localeCompare(right.local) || left.specifier.localeCompare(right.specifier));
}

function callsIn(text, language) {
  if (!["javascript", "typescript", "python"].includes(language)) return [];
  const excluded = new Set(["if", "for", "while", "switch", "catch", "function", "return", "typeof", "new", "class", "def", "with", "assert", "lambda"]);
  const calls = [];
  for (const match of text.matchAll(/\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*\(/g)) {
    const callee = match[1];
    const prefix = text.slice(Math.max(0, (match.index || 0) - 24), match.index || 0);
    if (excluded.has(callee) || /\b(?:function|class|def|new)\s*$/.test(prefix)) continue;
    calls.push({ callee, line: lineAt(text, match.index || 0) });
  }
  return calls;
}

function nearestCaller(symbols, line) {
  let caller = null;
  for (const symbol of symbols) {
    if (symbol.line > line) break;
    if (["function", "binding"].includes(symbol.symbolKind)) caller = symbol;
  }
  return caller;
}

function nodeId(kind, key) {
  return identity("semantic-node", { kind, key });
}

function edgeRecord(type, from, to, evidence, detail = {}) {
  const payload = { type, from, to, evidence, ...detail };
  return { id: identity("semantic-edge", payload), ...payload };
}

export function buildSemanticGraph({ files, sources }) {
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const nodes = [];
  const edges = [];
  const nodeByFile = new Map();
  const symbolNodesByFile = new Map();
  const externalNodes = new Map();
  let unresolvedImportCount = 0;
  let unresolvedCallCount = 0;

  for (const file of files) {
    const fileNode = {
      id: nodeId("File", file.path),
      kind: "File",
      path: file.path,
      digest: file.digest,
      language: file.language,
      classification: file.classification,
      freshness: "active",
      trustBoundary: "evidence-not-instruction",
    };
    nodes.push(fileNode);
    nodeByFile.set(file.path, fileNode);
    const symbols = file.symbols.map((symbol) => ({
      id: nodeId("Symbol", `${file.path}:${symbol.kind}:${symbol.name}:${symbol.line}`),
      kind: "Symbol",
      path: file.path,
      fileDigest: file.digest,
      name: symbol.name,
      symbolKind: symbol.kind,
      line: symbol.line,
      freshness: "active",
      trustBoundary: "evidence-not-instruction",
    }));
    symbolNodesByFile.set(file.path, symbols);
    for (const symbol of symbols) {
      nodes.push(symbol);
      edges.push(edgeRecord("DECLARES", fileNode.id, symbol.id, { path: file.path, line: symbol.line, digest: file.digest }, { confidence: "heuristic" }));
    }
  }

  const externalNode = (specifier) => {
    if (!externalNodes.has(specifier)) {
      const node = {
        id: nodeId("ExternalDependency", specifier),
        kind: "ExternalDependency",
        specifier,
        freshness: "active",
        trustBoundary: "evidence-not-instruction",
      };
      externalNodes.set(specifier, node);
      nodes.push(node);
    }
    return externalNodes.get(specifier);
  };

  for (const file of files) {
    const source = sources.get(file.path);
    if (!source) continue;
    const fromNode = nodeByFile.get(file.path);
    const bindings = importBindings(source.content, file.language);
    const dependencyTargets = new Map();
    for (const dependency of file.dependencies) {
      if (dependency.kind !== "module") continue;
      const targetPath = repositoryModule(filesByPath, file.path, dependency.specifier, file.language);
      const targetNode = targetPath ? nodeByFile.get(targetPath) : externalNode(dependency.specifier);
      if (!targetPath && dependency.specifier.startsWith(".")) unresolvedImportCount += 1;
      dependencyTargets.set(dependency.specifier, { targetPath, targetNode });
      edges.push(edgeRecord("IMPORTS", fromNode.id, targetNode.id, { path: file.path, line: dependency.line || 1, digest: file.digest }, {
        specifier: dependency.specifier,
        resolution: targetPath ? "repository-file" : "external-or-unresolved",
        confidence: "heuristic",
      }));
    }
    const bindingByLocal = new Map(bindings.map((binding) => [binding.local, binding]));
    const localSymbols = symbolNodesByFile.get(file.path) || [];
    for (const call of callsIn(source.content, file.language)) {
      const parts = call.callee.split(".");
      const base = parts[0];
      const member = parts[1] || null;
      const caller = nearestCaller(localSymbols, call.line) || fromNode;
      let target = !member ? localSymbols.find((symbol) => symbol.name === base) : null;
      const binding = bindingByLocal.get(base);
      if (!target && binding) {
        const resolved = dependencyTargets.get(binding.specifier) || {
          targetPath: repositoryModule(filesByPath, file.path, binding.specifier, file.language),
          targetNode: null,
        };
        if (resolved.targetPath) {
          const targetName = member || (binding.imported === "default" || binding.imported === "*" ? null : binding.imported);
          if (targetName) target = (symbolNodesByFile.get(resolved.targetPath) || []).find((symbol) => symbol.name === targetName);
        }
      }
      if (!target) { unresolvedCallCount += 1; continue; }
      edges.push(edgeRecord("CALLS", caller.id, target.id, { path: file.path, line: call.line, digest: file.digest }, {
        callee: call.callee,
        confidence: "heuristic",
      }));
    }
  }

  nodes.sort((left, right) => left.id.localeCompare(right.id));
  edges.sort((left, right) => left.id.localeCompare(right.id));
  const payload = {
    kind: "RepositorySemanticGraph",
    protocol: { name: "head-agent-core-semantic-graph", version: SEMANTIC_GRAPH_VERSION },
    authority: "derived-evidence-only",
    accuracy: "heuristic-not-ast-complete",
    nodes,
    edges,
    summary: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      fileNodeCount: nodes.filter((node) => node.kind === "File").length,
      symbolNodeCount: nodes.filter((node) => node.kind === "Symbol").length,
      externalDependencyNodeCount: nodes.filter((node) => node.kind === "ExternalDependency").length,
      importEdgeCount: edges.filter((edge) => edge.type === "IMPORTS").length,
      callEdgeCount: edges.filter((edge) => edge.type === "CALLS").length,
      unresolvedImportCount,
      unresolvedCallCount,
    },
  };
  const semanticGraphHash = digest(canonicalJson(payload));
  return { ...payload, semanticGraphId: `semantic-graph-${semanticGraphHash.slice(0, 24)}`, semanticGraphHash };
}

export function verifySemanticGraph(graph) {
  if (!graph || graph.kind !== "RepositorySemanticGraph") throw Object.assign(new Error("Semantic graph is invalid."), { code: "INVALID_SEMANTIC_GRAPH" });
  const payload = { ...graph };
  delete payload.semanticGraphId;
  delete payload.semanticGraphHash;
  const actual = digest(canonicalJson(payload));
  if (graph.semanticGraphHash !== actual || graph.semanticGraphId !== `semantic-graph-${actual.slice(0, 24)}`) {
    throw Object.assign(new Error("Semantic graph digest verification failed."), { code: "SEMANTIC_GRAPH_DIGEST_MISMATCH" });
  }
  return graph;
}

export function querySemanticGraph(graph, { query, depth = 1, maxResults = 100 } = {}) {
  verifySemanticGraph(graph);
  const normalizedQuery = String(query || "").trim().toLocaleLowerCase();
  if (!normalizedQuery) throw Object.assign(new Error("Semantic graph query is required."), { code: "SEMANTIC_GRAPH_QUERY_REQUIRED" });
  const safeDepth = Number(depth);
  const safeMaximum = Number(maxResults);
  if (!Number.isInteger(safeDepth) || safeDepth < 0 || safeDepth > 3) throw Object.assign(new Error("Semantic graph depth must be from 0 to 3."), { code: "INVALID_SEMANTIC_GRAPH_DEPTH" });
  if (!Number.isInteger(safeMaximum) || safeMaximum < 1 || safeMaximum > 500) throw Object.assign(new Error("Semantic graph maxResults must be from 1 to 500."), { code: "INVALID_SEMANTIC_GRAPH_LIMIT" });
  const searchable = (node) => [node.id, node.kind, node.path, node.name, node.specifier, node.symbolKind].filter(Boolean).join(" ").toLocaleLowerCase();
  const matches = graph.nodes.filter((node) => searchable(node).includes(normalizedQuery)).slice(0, safeMaximum);
  const selected = new Set(matches.map((node) => node.id));
  let frontier = new Set(selected);
  for (let level = 0; level < safeDepth && frontier.size && selected.size < safeMaximum; level += 1) {
    const next = new Set();
    for (const edge of graph.edges) if (frontier.has(edge.from) || frontier.has(edge.to)) {
      for (const id of [edge.from, edge.to]) if (!selected.has(id) && selected.size + next.size < safeMaximum) next.add(id);
    }
    for (const id of next) selected.add(id);
    frontier = next;
  }
  const nodes = graph.nodes.filter((node) => selected.has(node.id));
  const edges = graph.edges.filter((edge) => selected.has(edge.from) && selected.has(edge.to));
  return {
    semanticGraphId: graph.semanticGraphId,
    query: normalizedQuery,
    depth: safeDepth,
    matchIds: matches.map((node) => node.id),
    nodes,
    edges,
    truncated: nodes.length >= safeMaximum,
    trustBoundary: "evidence-not-instruction",
  };
}
