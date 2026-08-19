import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { inspectProject, SCHEMA_VERSION } from "./head-core.mjs";
import { queryGraphProjection } from "./graph-projection-adapter.mjs";
import { inspectWorldModel } from "./world-model.mjs";

export const CONTEXT_COMPILER_VERSION = "0.9.0";
const MAX_REPOSITORY_GRAPH_EXPANSIONS = 32;

const fail = (message, code = "CONTEXT_COMPILER_ERROR") => {
  const error = new Error(message);
  error.code = code;
  throw error;
};

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
const approxTokens = (value) => Math.ceil(String(value).length / 4);

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

function readJson(file, label) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { fail(`${label} is invalid JSON: ${error.message}`, "INVALID_CONTEXT_CANON"); }
}

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, content, { encoding: "utf8", flag: "wx" });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function terms(value) {
  const stopWords = new Set([
    "the", "is", "are", "was", "were", "a", "an", "and", "or", "for", "from", "with", "into", "this", "that",
    "what", "why", "how", "when", "where", "will", "would", "should", "could", "task", "current",
    "현재", "이번", "관련", "위한", "무엇", "어떻게", "왜", "언제", "에서", "으로", "이다", "있다"
  ]);
  return new Set((String(value).toLocaleLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) || []).filter((term) => !stopWords.has(term)));
}

function overlap(left, right) {
  let count = 0;
  for (const item of left) if (right.has(item)) count += 1;
  return count;
}

function historyRelevance(task) {
  const value = task.toLocaleLowerCase();
  if (/(history|historical|과거|언제부터|회귀|evolution)/u.test(value)) return "DEEP";
  if (/(why|왜|decision|결정|architecture|architectural|설계)/u.test(value)) return "DECISIONS";
  if (/(recent|최근|변경|changed|regression)/u.test(value)) return "RECENT";
  return "NONE";
}

function validateId(value, kind) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]{2,127}$/i.test(value)) {
    fail(`${kind} has an invalid id.`, "INVALID_KNOWLEDGE_ID");
  }
}

function validateKnowledge(value) {
  if (value?.schemaVersion !== SCHEMA_VERSION) fail("Knowledge canon schema is incompatible.", "INVALID_KNOWLEDGE_SCHEMA");
  for (const key of ["evidence", "claims", "decisions", "unknowns"]) {
    if (!Array.isArray(value[key])) fail(`Knowledge canon ${key} must be an array.`, "INVALID_KNOWLEDGE_SCHEMA");
    for (const item of value[key]) validateId(item?.id, key);
  }
  const ids = new Set();
  for (const key of ["evidence", "claims", "decisions", "unknowns"]) for (const item of value[key]) {
    if (ids.has(item.id)) fail(`Knowledge id is duplicated: ${item.id}`, "DUPLICATE_KNOWLEDGE_ID");
    ids.add(item.id);
  }
  return value;
}

function loadSources(root) {
  const files = {
    project: path.join(root, ".head", "project.json"),
    projectContext: path.join(root, ".head", "instructions", "project.md"),
    knowledge: path.join(root, ".head", "context", "knowledge.json"),
    managedManifest: path.join(root, ".head", "generated", "manifest.json"),
  };
  for (const [name, file] of Object.entries(files)) if (!fs.existsSync(file)) {
    fail(`Context source is missing: ${name}`, "MISSING_CONTEXT_SOURCE");
  }
  const raw = Object.fromEntries(Object.entries(files).map(([name, file]) => [name, fs.readFileSync(file, "utf8")]));
  let worldModel = null;
  try { worldModel = inspectWorldModel({ root }); }
  catch (error) {
    if (error.code !== "WORLD_MODEL_NOT_BUILT") throw error;
  }
  return { files, raw, knowledge: validateKnowledge(JSON.parse(raw.knowledge)), worldModel };
}

function contextSnapshot(inspected, sources) {
  const sourceDigests = Object.fromEntries(Object.entries(sources.raw).map(([name, value]) => [name, digest(value)]));
  if (sources.worldModel) sourceDigests.repositoryWorldModel = sources.worldModel.snapshot.worldModelHash;
  let coverage = "curated-head-canon-only";
  if (sources.worldModel?.status === "stale") coverage = "curated-head-canon+stale-repository-world-model-excluded";
  else if (sources.worldModel?.status === "current") {
    const hasGitHistory = sources.worldModel.snapshot.gitDecisionHistory?.coverage === "all-reachable-commits";
    const layers = ["curated-head-canon", hasGitHistory ? "repository-world-model-semantic" : "repository-world-model-semantic-alpha"];
    if (sources.worldModel.snapshot.temporalProvenanceGraph) layers.push("temporal-provenance-alpha");
    if (sources.worldModel.snapshot.productModel) layers.push("product-canon-projection-alpha");
    if (hasGitHistory) layers.push("git-history-alpha");
    if (sources.worldModel.snapshot.externalRuntimeState?.coverage === "point-in-time-host-export") layers.push("external-runtime-state-alpha");
    coverage = layers.join("+");
  }
  const identity = {
    schemaVersion: SCHEMA_VERSION,
    projectId: inspected.project.projectId,
    projectRoot: inspected.project.projectRoot,
    sourceDigests,
    coverage,
  };
  return {
    kind: "Snapshot",
    ...identity,
    snapshotId: `snapshot-${digest(canonicalJson(identity)).slice(0, 24)}`,
  };
}

export function buildContextSnapshot(root = ".") {
  const inspected = inspectProject(root);
  if (inspected.status !== "ready") fail(`Project must be ready to build a context snapshot; current status: ${inspected.status}.`, "PROJECT_NOT_READY");
  const sources = loadSources(inspected.project.projectRoot);
  return contextSnapshot(inspected, sources);
}

function evidenceIndex(knowledge) {
  return new Map(knowledge.evidence.map((item) => [item.id, {
    kind: "Evidence",
    id: item.id,
    sourceKind: item.sourceKind || "project-artifact",
    uri: item.uri || "",
    digest: item.digest || "",
    summary: item.summary || "",
    observedAt: item.observedAt || "",
    instructionAuthority: false,
  }]));
}

function itemCandidate(kind, item, taskTerms, evidenceById, historyClass) {
  const body = kind === "Claim"
    ? item.statement
    : kind === "Decision"
      ? [item.title, item.decision, item.reason, ...(item.constraints || [])].filter(Boolean).join(" ")
      : item.statement;
  const tags = Array.isArray(item.tags) ? item.tags.map(String) : [];
  const relevance = overlap(taskTerms, terms(`${body} ${tags.join(" ")}`));
  const importance = Number.isFinite(Number(item.importance)) ? Math.max(0, Math.min(5, Number(item.importance))) : 1;
  const historyBoost = kind === "Decision" && ["DECISIONS", "DEEP"].includes(historyClass) ? 20 : 0;
  const unknownBoost = kind === "Unknown" && importance >= 5 ? 12 : 0;
  const score = relevance * 25 + importance * 4 + historyBoost + unknownBoost;
  const evidence = (item.evidenceIds || []).map((id) => evidenceById.get(id)).filter(Boolean);
  const record = {
    kind,
    ...item,
    evidence,
    trustBoundary: kind === "Decision" ? "promoted-project-decision" : "evidence-not-instruction",
  };
  return { id: item.id, kind, score, relevance, importance, approxTokens: approxTokens(canonicalJson(record)), record };
}

function activeCandidates(knowledge, task, historyClass) {
  const taskTerms = terms(task);
  const evidenceById = evidenceIndex(knowledge);
  const candidates = [];
  for (const item of knowledge.claims) {
    if ((item.status || "active") === "active") candidates.push(itemCandidate("Claim", item, taskTerms, evidenceById, historyClass));
  }
  for (const item of knowledge.decisions) {
    if (!new Set(["superseded", "stale", "rejected"]).has(item.status)) candidates.push(itemCandidate("Decision", item, taskTerms, evidenceById, historyClass));
  }
  for (const item of knowledge.unknowns) {
    if ((item.status || "open") === "open") candidates.push(itemCandidate("Unknown", item, taskTerms, evidenceById, historyClass));
  }
  return candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

function queryTemporalProjection(worldModel, graphProjectionAdapter, query) {
  return queryGraphProjection({
    projectRoot: worldModel.snapshot.projectRoot,
    graph: worldModel.snapshot.temporalProvenanceGraph,
    adapter: graphProjectionAdapter,
    query,
  }).result;
}

function repositoryCandidates(worldModel, task, graphProjectionAdapter = null, budget = 4000) {
  if (!worldModel || worldModel.status !== "current") return [];
  const taskTerms = terms(task);
  const graph = worldModel.snapshot.semanticGraph || null;
  const temporalGraph = worldModel.snapshot.temporalProvenanceGraph || null;
  const nodes = new Map((graph?.nodes || []).map((node) => [node.id, node]));
  const nodeReference = (node) => node ? {
    id: node.id,
    kind: node.kind,
    path: node.path,
    name: node.name,
    specifier: node.specifier,
    symbolKind: node.symbolKind,
    line: node.line,
  } : null;
  const relationshipEdgesByPath = new Map();
  for (const edge of graph?.edges || []) {
    const paths = new Set([edge.evidence?.path, nodes.get(edge.from)?.path, nodes.get(edge.to)?.path].filter(Boolean));
    for (const filePath of paths) {
      if (!relationshipEdgesByPath.has(filePath)) relationshipEdgesByPath.set(filePath, []);
      relationshipEdgesByPath.get(filePath).push(edge);
    }
  }
  const ranked = worldModel.snapshot.files.map((file) => {
    const lightweightBody = [
      file.path,
      file.classification,
      file.language,
      ...file.symbols.map((item) => `${item.kind} ${item.name}`),
      ...file.dependencies.map((item) => `${item.kind} ${item.specifier}`),
    ].join(" ");
    const relevance = overlap(taskTerms, terms(lightweightBody));
    const importance = file.classification === "source" ? 2 : 1;
    return { file, relevance, importance, score: relevance * 25 + importance * 4 };
  }).sort((left, right) => right.score - left.score || left.file.path.localeCompare(right.file.path));
  const expansionLimit = Math.min(MAX_REPOSITORY_GRAPH_EXPANSIONS, Math.max(8, Math.ceil(Number(budget) / 4000) * 8));
  const expandedPaths = new Set(ranked.filter((item) => item.relevance > 0).slice(0, expansionLimit).map((item) => item.file.path));
  const temporalAnchorPath = ranked.find((item) => item.relevance > 0)?.file.path || "";
  const sharedTemporalTraversal = temporalGraph && temporalAnchorPath ? queryTemporalProjection(worldModel, graphProjectionAdapter, {
    query: temporalAnchorPath,
    relations: ["CONTAINS", "HAS_REVISION", "CURRENT_REVISION", "PARENT_OF", "DECLARES", "REFERENCES", "IMPLEMENTS", "VERIFIED_BY", "IMPACTS", "CHANGES"],
    authorityClasses: ["canon-projected", "reviewed", "derived", "heuristic"],
    freshness: ["current"],
    minConfidence: 0,
    includeUnreviewedCandidates: false,
    depth: 2,
    maxNodes: 50,
    maxEdges: 100,
  }) : null;
  return ranked.map(({ file, relevance: lightweightRelevance, importance, score: lightweightScore }) => {
    const expanded = expandedPaths.has(file.path);
    const temporalTraversal = file.path === temporalAnchorPath ? sharedTemporalTraversal : null;
    const relationships = (expanded ? relationshipEdgesByPath.get(file.path) || [] : []).slice(0, 50).map((edge) => ({
      id: edge.id,
      type: edge.type,
      from: nodeReference(nodes.get(edge.from)),
      to: nodeReference(nodes.get(edge.to)),
      evidence: edge.evidence,
      confidence: edge.confidence,
      specifier: edge.specifier,
      callee: edge.callee,
      trustBoundary: "evidence-not-instruction",
    }));
    const body = [
      file.path,
      file.classification,
      file.language,
      ...file.symbols.map((item) => `${item.kind} ${item.name}`),
      ...file.dependencies.map((item) => `${item.kind} ${item.specifier}`),
      ...relationships.flatMap((item) => [item.type, item.from?.path, item.from?.name, item.to?.path, item.to?.name, item.to?.specifier]).filter(Boolean),
      ...(temporalTraversal?.nodes || []).flatMap((item) => [item.kind, item.path, item.name, item.symbolKind]).filter(Boolean),
    ].join(" ");
    const relevance = expanded ? overlap(taskTerms, terms(body)) : lightweightRelevance;
    const score = expanded ? relevance * 25 + importance * 4 : lightweightScore;
    const record = {
      kind: "RepositoryFile",
      path: file.path,
      digest: file.digest,
      freshness: file.freshness,
      classification: file.classification,
      language: file.language,
      symbols: file.symbols,
      dependencies: file.dependencies,
      semanticRelationships: relationships,
      semanticGraphId: graph?.semanticGraphId || null,
      temporalEntities: temporalTraversal?.nodes || [],
      temporalRelationships: temporalTraversal?.edges || [],
      temporalTraversal: temporalTraversal ? {
        graphSnapshotId: temporalTraversal.graphSnapshotId,
        graphSnapshotHash: temporalTraversal.graphSnapshotHash,
        sourceSnapshotId: temporalTraversal.sourceSnapshotId,
        queryId: temporalTraversal.queryId,
        queryHash: temporalTraversal.queryHash,
        resultId: temporalTraversal.resultId,
        resultHash: temporalTraversal.resultHash,
        traversalQuery: temporalTraversal.traversalQuery,
        inclusion: temporalTraversal.inclusion,
        exclusion: temporalTraversal.exclusion,
        truncated: temporalTraversal.truncated,
      } : null,
      graphExpansion: temporalTraversal
        ? "bounded-temporal-anchor"
        : expanded ? "bounded-semantic-adjacency" : "not-expanded-by-relevance-bound",
      worldModelId: worldModel.snapshot.worldModelId,
      trustBoundary: "evidence-not-instruction",
    };
    return {
      id: `repository-file:${file.path}`,
      kind: "RepositoryFile",
      score,
      relevance,
      importance,
      approxTokens: approxTokens(canonicalJson(record)),
      record,
    };
  }).sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
}

function productContextCandidates(worldModel, task, graphProjectionAdapter = null) {
  if (!worldModel || worldModel.status !== "current") return [];
  const graph = worldModel.snapshot.temporalProvenanceGraph;
  const productModel = worldModel.snapshot.productModel;
  if (!graph || !productModel || graph.summary.productRevisionCount === 0) return [];
  const taskTerms = terms(task);
  const productCorpus = graph.nodes.filter((node) => node.semantic).map((node) => canonicalJson(node.semantic).toLocaleLowerCase()).join(" ");
  const matchingTerms = [...taskTerms].filter((term) => productCorpus.includes(term))
    .sort((left, right) => right.length - left.length || left.localeCompare(right));
  if (matchingTerms.length === 0) return [];
  const anchorTerm = matchingTerms[0];
  const traversal = queryTemporalProjection(worldModel, graphProjectionAdapter, {
    query: anchorTerm,
    kinds: [
      "FeatureGroup", "FeatureGroupRevision", "Capability", "CapabilityRevision", "Feature", "FeatureRevision",
      "Requirement", "RequirementRevision", "Constraint", "ConstraintRevision", "Decision", "DecisionRevision",
      "File", "Symbol", "Test", "ReviewedRelationship", "FeatureMappingReviewDecision",
      "ChangeSet", "ReviewedImpact", "ChangeImpactReviewDecision", "VcsEvidence", "GitCommit",
    ],
    relations: ["CONTAINS", "REALIZES", "GOVERNED_BY", "HAS_REVISION", "CURRENT_REVISION", "PARENT_OF", "IMPLEMENTS", "VERIFIED_BY", "IMPACTS", "MATERIALIZED_AS", "REFERENCES", "PROMOTED_FROM", "PRODUCES", "REVIEWED_BY"],
    authorityClasses: ["canon-projected", "reviewed", "derived", "heuristic"],
    freshness: ["current"],
    includeUnreviewedCandidates: false,
    depth: 3,
    maxNodes: 100,
    maxEdges: 200,
  });
  if (traversal.traversalQuery.anchorIds.length === 0) return [];
  const body = traversal.nodes.map((node) => canonicalJson(node.semantic || { kind: node.kind, key: node.key })).join(" ");
  const relevance = overlap(taskTerms, terms(body));
  const compactEntities = traversal.nodes.map((node) => ({
    nodeId: node.nodeId,
    kind: node.kind,
    logicalEntityId: node.logicalEntityId || null,
    key: node.key || null,
    path: node.path || null,
    name: node.name || null,
    relationshipType: node.relationshipType || null,
    changeSetId: node.changeSetId || null,
    changeIds: node.changeIds || null,
    targetNodeId: node.targetNodeId || null,
    objectId: node.objectId || null,
    subject: node.subject || null,
    gitHistoryId: node.gitHistoryId || null,
    semantic: node.semantic || null,
    authorityClass: node.authorityClass,
    evidenceIds: node.evidenceIds,
    freshness: node.freshness,
  }));
  const compactRelationships = traversal.edges.map((edge) => ({
    edgeId: edge.edgeId,
    type: edge.type,
    from: edge.from,
    to: edge.to,
    authorityClass: edge.authorityClass,
    evidenceIds: edge.evidenceIds,
  }));
  const record = {
    kind: "ProductContext",
    productModelId: productModel.productModelId,
    productModelHash: productModel.productModelHash,
    source: worldModel.snapshot.productModelSource,
    taskAnchor: { selectedTerm: anchorTerm, matchingTerms },
    entities: compactEntities,
    relationships: compactRelationships,
    temporalTraversal: {
      graphSnapshotId: traversal.graphSnapshotId,
      graphSnapshotHash: traversal.graphSnapshotHash,
      sourceSnapshotId: traversal.sourceSnapshotId,
      queryId: traversal.queryId,
      queryHash: traversal.queryHash,
      resultId: traversal.resultId,
      resultHash: traversal.resultHash,
      traversalQuery: traversal.traversalQuery,
      inclusion: traversal.inclusion,
      exclusion: traversal.exclusion,
      truncated: traversal.truncated,
    },
    worldModelId: worldModel.snapshot.worldModelId,
    instructionAuthority: false,
    promotionAuthority: false,
    trustBoundary: "derived-projection-of-user-owned-product-canon",
  };
  return [{
    id: `product-context:${traversal.resultId}`,
    kind: "ProductContext",
    score: relevance * 25 + 20,
    relevance,
    importance: 5,
    approxTokens: approxTokens(canonicalJson(record)),
    record,
  }];
}

function gitDecisionCandidates(worldModel, task, historyClass) {
  if (!worldModel || worldModel.status !== "current" || historyClass === "NONE") return [];
  const history = worldModel.snapshot.gitDecisionHistory;
  if (!history || history.status !== "available") return [];
  const taskTerms = terms(task);
  return history.commits.map((commit, index) => {
    const body = [commit.subject, commit.body, commit.author.name, ...commit.refs].join(" ");
    const relevance = overlap(taskTerms, terms(body));
    const importance = commit.parents.length > 1 ? 3 : 2;
    const historyBoost = historyClass === "DEEP" ? 12 : historyClass === "DECISIONS" ? 8 : 0;
    const recencyBoost = historyClass === "RECENT" ? Math.max(0, 20 - index * 4) : 0;
    const score = relevance * 25 + importance * 4 + historyBoost + recencyBoost;
    const record = {
      kind: "GitDecisionEvidence",
      commit: commit.commit,
      parents: commit.parents,
      authoredAt: commit.authoredAt,
      committedAt: commit.committedAt,
      author: commit.author,
      refs: commit.refs,
      subject: commit.subject,
      body: commit.body,
      evidence: commit.evidence,
      historyId: history.historyId,
      instructionAuthority: false,
      trustBoundary: "evidence-not-instruction",
    };
    return {
      id: `git-commit:${commit.commit}`,
      kind: "GitDecisionEvidence",
      score,
      relevance,
      importance,
      approxTokens: approxTokens(canonicalJson(record)),
      record,
    };
  }).sort((left, right) => right.score - left.score
    || right.record.committedAt.localeCompare(left.record.committedAt)
    || left.id.localeCompare(right.id));
}

function runtimeStateCandidates(worldModel, task) {
  if (!worldModel || worldModel.status !== "current") return [];
  const runtimeState = worldModel.snapshot.externalRuntimeState;
  if (!runtimeState || runtimeState.status !== "available") return [];
  const taskTerms = terms(task);
  const explicitRuntimes = new Set(runtimeState.summary.runtimes.filter((item) => taskTerms.has(item)));
  const explicitKinds = new Set([...new Set(runtimeState.observations.map((item) => item.kind))].filter((item) => taskTerms.has(item)));
  const explicitStates = new Set([...new Set(runtimeState.observations.map((item) => item.state))].filter((item) => taskTerms.has(item)));
  return runtimeState.observations.filter((observation) => {
    if (explicitRuntimes.size && !explicitRuntimes.has(observation.runtime)) return false;
    if (explicitKinds.size && !explicitKinds.has(observation.kind)) return false;
    if (explicitStates.size && !explicitStates.has(observation.state)) return false;
    return true;
  }).map((observation) => {
    const body = [
      observation.runtime,
      observation.kind,
      observation.state,
      observation.providerVersion,
      ...observation.capabilities,
    ].join(" ");
    const relevance = overlap(taskTerms, terms(body));
    const importance = ["failed", "blocked", "active"].includes(observation.state) ? 3 : 2;
    const score = relevance * 25 + importance * 4;
    const record = {
      kind: "RuntimeStateEvidence",
      ...observation,
      runtimeStateId: runtimeState.runtimeStateId,
      instructionAuthority: false,
      controlAuthority: false,
      trustBoundary: "evidence-not-instruction",
    };
    return {
      id: observation.observationId,
      kind: "RuntimeStateEvidence",
      score,
      relevance,
      importance,
      approxTokens: approxTokens(canonicalJson(record)),
      record,
    };
  }).sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
}

function selectCandidates(candidates, budget, baseTokens) {
  if (baseTokens > budget) fail("Context budget cannot hold the required task, authority, and current-state envelope.", "CONTEXT_BUDGET_TOO_SMALL");
  let used = baseTokens;
  const included = [];
  const excluded = [];
  for (const candidate of candidates) {
    if (candidate.relevance === 0 && candidate.importance < 4 && candidate.score < 20) {
      excluded.push({ id: candidate.id, kind: candidate.kind, reason: "low-relevance", score: candidate.score });
      continue;
    }
    if (used + candidate.approxTokens > budget) {
      excluded.push({ id: candidate.id, kind: candidate.kind, reason: "context-budget", score: candidate.score });
      continue;
    }
    included.push(candidate);
    used += candidate.approxTokens;
  }
  return { included, excluded, used };
}

export function compileContext({ root = ".", task, budget = 4000, persist = false, graphProjectionAdapter = null } = {}) {
  if (typeof task !== "string" || !task.trim()) fail("Context compilation requires a task.", "TASK_REQUIRED");
  const maxApproxTokens = Number(budget);
  if (!Number.isInteger(maxApproxTokens) || maxApproxTokens < 256 || maxApproxTokens > 50_000) {
    fail("Context budget must be an integer from 256 to 50000.", "INVALID_CONTEXT_BUDGET");
  }
  const inspected = inspectProject(root);
  if (inspected.status !== "ready") fail(`Project must be ready to compile context; current status: ${inspected.status}.`, "PROJECT_NOT_READY");
  const projectRoot = inspected.project.projectRoot;
  const sources = loadSources(projectRoot);
  const snapshot = contextSnapshot(inspected, sources);
  const projectContext = sources.raw.projectContext.trim();
  const historyClass = historyRelevance(task);
  const base = {
    objective: task.trim(),
    currentState: projectContext,
    authority: inspected.project.authority,
    coverage: snapshot.coverage,
  };
  const candidates = [
    ...activeCandidates(sources.knowledge, task, historyClass),
    ...productContextCandidates(sources.worldModel, task, graphProjectionAdapter),
    ...repositoryCandidates(sources.worldModel, task, graphProjectionAdapter, maxApproxTokens),
    ...gitDecisionCandidates(sources.worldModel, task, historyClass),
    ...runtimeStateCandidates(sources.worldModel, task),
  ].sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  const selection = selectCandidates(candidates, maxApproxTokens, approxTokens(canonicalJson(base)));
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    kind: "ContextCapsule",
    task: task.trim(),
    snapshot,
    compiler: {
      name: "head-agent-core-context-compiler",
      version: CONTEXT_COMPILER_VERSION,
      strategy: "deterministic-minimum-sufficient-context",
      historyRelevance: historyClass,
    },
    budget: { maxApproxTokens, usedApproxTokens: selection.used },
    authority: inspected.project.authority,
    currentState: projectContext,
    claims: selection.included.filter((item) => item.kind === "Claim").map((item) => item.record),
    decisions: selection.included.filter((item) => item.kind === "Decision").map((item) => item.record),
    unknowns: selection.included.filter((item) => item.kind === "Unknown").map((item) => item.record),
    repositoryContext: selection.included.filter((item) => item.kind === "RepositoryFile").map((item) => item.record),
    productContext: selection.included.filter((item) => item.kind === "ProductContext").map((item) => item.record),
    gitDecisionEvidence: selection.included.filter((item) => item.kind === "GitDecisionEvidence").map((item) => item.record),
    runtimeStateEvidence: selection.included.filter((item) => item.kind === "RuntimeStateEvidence").map((item) => item.record),
    repositoryGraph: sources.worldModel?.status === "current" && sources.worldModel.snapshot.semanticGraph ? {
      semanticGraphId: sources.worldModel.snapshot.semanticGraph.semanticGraphId,
      accuracy: sources.worldModel.snapshot.semanticGraph.accuracy,
      authority: sources.worldModel.snapshot.semanticGraph.authority,
      summary: sources.worldModel.snapshot.semanticGraph.summary,
    } : null,
    repositoryTemporalGraph: sources.worldModel?.status === "current" && sources.worldModel.snapshot.temporalProvenanceGraph ? {
      graphSnapshotId: sources.worldModel.snapshot.temporalProvenanceGraph.graphSnapshotId,
      graphSnapshotHash: sources.worldModel.snapshot.temporalProvenanceGraph.graphSnapshotHash,
      sourceSnapshotId: sources.worldModel.snapshot.temporalProvenanceGraph.sourceSnapshotId,
      parentSourceSnapshotIds: sources.worldModel.snapshot.temporalProvenanceGraph.parentSourceSnapshotIds,
      authority: sources.worldModel.snapshot.temporalProvenanceGraph.authority,
      rebuildable: sources.worldModel.snapshot.temporalProvenanceGraph.rebuildable,
      uniqueAuthority: sources.worldModel.snapshot.temporalProvenanceGraph.uniqueAuthority,
      summary: sources.worldModel.snapshot.temporalProvenanceGraph.summary,
    } : null,
    repositoryHistory: sources.worldModel?.status === "current" && sources.worldModel.snapshot.gitDecisionHistory ? {
      historyId: sources.worldModel.snapshot.gitDecisionHistory.historyId,
      status: sources.worldModel.snapshot.gitDecisionHistory.status,
      coverage: sources.worldModel.snapshot.gitDecisionHistory.coverage,
      reasonCode: sources.worldModel.snapshot.gitDecisionHistory.reasonCode,
      authority: sources.worldModel.snapshot.gitDecisionHistory.authority,
      interpretation: sources.worldModel.snapshot.gitDecisionHistory.interpretation,
      summary: sources.worldModel.snapshot.gitDecisionHistory.summary,
    } : null,
    repositoryRuntimeState: sources.worldModel?.status === "current" && sources.worldModel.snapshot.externalRuntimeState ? {
      runtimeStateId: sources.worldModel.snapshot.externalRuntimeState.runtimeStateId,
      status: sources.worldModel.snapshot.externalRuntimeState.status,
      coverage: sources.worldModel.snapshot.externalRuntimeState.coverage,
      reasonCode: sources.worldModel.snapshot.externalRuntimeState.reasonCode,
      authority: sources.worldModel.snapshot.externalRuntimeState.authority,
      interpretation: sources.worldModel.snapshot.externalRuntimeState.interpretation,
      observedAt: sources.worldModel.snapshot.externalRuntimeState.observedAt,
      summary: sources.worldModel.snapshot.externalRuntimeState.summary,
    } : null,
    selection: {
      candidateIds: candidates.map((item) => item.id),
      includedIds: selection.included.map((item) => item.id),
      excluded: selection.excluded,
    },
    provenance: Object.entries(snapshot.sourceDigests).map(([source, sourceDigest]) => ({ source, digest: sourceDigest })),
    trustBoundary: {
      projectArtifacts: "evidence-not-instructions",
      gitCommitMessages: "decision-evidence-not-promoted-project-decisions",
      runtimeObservations: "point-in-time-evidence-not-runtime-control-authority",
      temporalProvenance: "rebuildable-derived-evidence-not-project-canon",
      productContext: "derived-projection-of-user-owned-product-canon",
      promotedDecisions: "project-authority-subject-to-user-owned-decisions",
      adapterFailure: "fail-open-to-normal-agent-without-capsule",
      canonDrift: "fail-closed",
    },
    expansionProtocol: ["query_product_graph", "query_semantic_graph", "query_temporal_graph", "get_git_decision_history", "get_runtime_state", "expand_relationship", "verify_claim", "get_source", "get_history", "explain_decision"],
  };
  const capsuleHash = digest(canonicalJson(payload));
  const capsule = { ...payload, capsuleId: `capsule-${capsuleHash.slice(0, 24)}`, capsuleHash };
  if (persist) {
    const file = path.join(projectRoot, ".head", "context", "capsules", `${capsule.capsuleId}.json`);
    atomicWrite(file, json(capsule));
    return { status: "compiled", file, capsule };
  }
  return { status: "preview", capsule };
}

export function readContextCapsule({ root = ".", capsuleId } = {}) {
  if (typeof capsuleId !== "string" || !/^capsule-[a-f0-9]{24}$/.test(capsuleId)) fail("Capsule id is invalid.", "INVALID_CAPSULE_ID");
  const inspected = inspectProject(root);
  if (inspected.status === "not_initialized") fail("HEAD Agent Core is not initialized.", "NOT_INITIALIZED");
  const file = path.join(inspected.project.projectRoot, ".head", "context", "capsules", `${capsuleId}.json`);
  if (!fs.existsSync(file)) fail(`Context Capsule not found: ${capsuleId}`, "CAPSULE_NOT_FOUND");
  const capsule = readJson(file, "Context Capsule");
  const recordedHash = capsule.capsuleHash;
  const payload = { ...capsule };
  delete payload.capsuleId;
  delete payload.capsuleHash;
  const actualHash = digest(canonicalJson(payload));
  if (recordedHash !== actualHash || capsuleId !== `capsule-${actualHash.slice(0, 24)}`) fail("Context Capsule digest verification failed.", "CAPSULE_DIGEST_MISMATCH");
  return { status: "verified", file, capsule };
}
