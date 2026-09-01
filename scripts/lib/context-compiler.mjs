import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { inspectProject, SCHEMA_VERSION } from "./head-core.mjs";
import { queryGraphProjection } from "./graph-projection-adapter.mjs";
import { inspectWorldModel } from "./world-model.mjs";

export const CONTEXT_COMPILER_VERSION = "0.15.0";
export const CONTEXT_COVERAGE_VERSION = "1.0.0";
export const CONTEXT_BUDGET_PROTOCOL_VERSION = "1.0.0";
export const CONTEXT_BUDGET_TIERS = Object.freeze([32_768, 65_536, 131_072, 262_144, 524_288]);
export const DEFAULT_CONTEXT_BUDGET = CONTEXT_BUDGET_TIERS[0];
export const EVIDENCE_NEED_KINDS = Object.freeze([
  "claim",
  "decision",
  "git-decision",
  "product-context",
  "repository-file",
  "repository-source",
  "repository-test",
  "runtime-state",
  "semantic-relation",
  "temporal-relation",
  "unknown",
]);
const MAX_REPOSITORY_GRAPH_EXPANSIONS = 32;
const MAX_CONTEXT_SYMBOLS_PER_FILE = 12;
const MAX_CONTEXT_DEPENDENCIES_PER_FILE = 12;
const MAX_CONTEXT_RELATIONSHIPS_PER_FILE = 4;
const MAX_PRODUCT_CONTEXT_ENTITIES = 24;
const MAX_PRODUCT_CONTEXT_RELATIONSHIPS = 48;

const STOP_WORDS = new Set([
  "the", "is", "are", "was", "were", "a", "an", "and", "or", "for", "from", "with", "into", "this", "that",
  "what", "why", "how", "when", "where", "will", "would", "should", "could", "task", "current",
  "현재", "이번", "관련", "위한", "무엇", "어떻게", "왜", "언제", "에서", "으로", "이다", "있다",
]);
const KOREAN_PARTICLES = ["으로", "에서", "에게", "까지", "부터", "처럼", "하고", "하며", "하면", "한다", "하고자", "만들고자", "을", "를", "은", "는", "이", "가", "과", "와", "의", "로", "도", "만"];

const fail = (message, code = "CONTEXT_COMPILER_ERROR") => {
  const error = new Error(message);
  error.code = code;
  throw error;
};

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
const approxTokens = (value) => Math.ceil(String(value).length / 4);

function normalizeContextBudget(value) {
  const maxApproxTokens = Number(value);
  if (!Number.isInteger(maxApproxTokens) || !CONTEXT_BUDGET_TIERS.includes(maxApproxTokens)) {
    fail(`Context budget must be one of: ${CONTEXT_BUDGET_TIERS.join(", ")}.`, "INVALID_CONTEXT_BUDGET");
  }
  return {
    maxApproxTokens,
    tier: `approx-${maxApproxTokens / 1024}k`,
  };
}

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

function normalizedLexicalText(value) {
  return String(value)
    .normalize("NFKC")
    .replace(/https?:\/\/[^\s)>\]}]+/giu, " ")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([\p{Ll}\p{N}])([\p{Lu}])/gu, "$1 $2")
    .replace(/[_./\\:@-]+/g, " ")
    .toLocaleLowerCase();
}

function terms(value) {
  const result = new Set();
  for (const token of normalizedLexicalText(value).match(/[\p{L}\p{N}]{2,}/gu) || []) {
    if (!STOP_WORDS.has(token)) result.add(token);
    if (!/[\p{Script=Hangul}]/u.test(token)) continue;
    for (const particle of KOREAN_PARTICLES) {
      if (token.length > particle.length + 1 && token.endsWith(particle)) {
        const stem = token.slice(0, -particle.length);
        if (!STOP_WORDS.has(stem)) result.add(stem);
        break;
      }
    }
  }
  return result;
}

function overlap(left, right) {
  let count = 0;
  for (const item of left) if (right.has(item)) count += 1;
  return count;
}

function matchedTerms(left, right) {
  return [...left].filter((item) => right.has(item)).sort();
}

function rankBounded(items, taskTerms, body, limit) {
  return items.map((item, index) => ({
    item,
    index,
    relevance: overlap(taskTerms, terms(body(item))),
  })).sort((left, right) => right.relevance - left.relevance || left.index - right.index)
    .slice(0, limit)
    .map(({ item }) => item);
}

function compactList(values, limit = 12) {
  const items = Array.isArray(values) ? values : [];
  return {
    count: items.length,
    sample: items.slice(0, limit),
    omitted: Math.max(0, items.length - limit),
    digest: digest(canonicalJson(items)),
  };
}

function compactTraversalMetadata(traversal) {
  if (!traversal) return null;
  const query = traversal.traversalQuery || {};
  const inclusion = Array.isArray(traversal.inclusion) ? traversal.inclusion : [];
  const inclusionReasons = {};
  for (const item of inclusion) inclusionReasons[item.reason || "included"] = (inclusionReasons[item.reason || "included"] || 0) + 1;
  return {
    graphSnapshotId: traversal.graphSnapshotId,
    graphSnapshotHash: traversal.graphSnapshotHash,
    sourceSnapshotId: traversal.sourceSnapshotId,
    queryId: traversal.queryId,
    queryHash: traversal.queryHash,
    resultId: traversal.resultId,
    resultHash: traversal.resultHash,
    traversalQuerySummary: {
      anchorMode: query.anchorMode,
      normalizedQuery: query.normalizedQuery,
      anchorIds: compactList(query.anchorIds),
      expectedGraphSnapshotId: query.expectedGraphSnapshotId,
      allowedKinds: compactList(query.allowedKinds),
      allowedRelations: query.allowedRelations || [],
      allowedAuthorityClasses: query.allowedAuthorityClasses || [],
      allowedFreshness: query.allowedFreshness || [],
      minConfidence: query.minConfidence,
      includeUnreviewedCandidates: query.includeUnreviewedCandidates,
      maxDepth: query.maxDepth,
      maxNodes: query.maxNodes,
      maxEdges: query.maxEdges,
      ordering: query.ordering,
    },
    inclusionSummary: {
      count: inclusion.length,
      reasons: Object.fromEntries(Object.entries(inclusionReasons).sort()),
      sample: inclusion.slice(0, 8),
      digest: digest(canonicalJson(inclusion)),
    },
    exclusion: traversal.exclusion,
    truncated: traversal.truncated,
  };
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
  const candidateTerms = terms(`${body} ${tags.join(" ")}`);
  const matches = matchedTerms(taskTerms, candidateTerms);
  const relevance = matches.length;
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
  return { id: item.id, kind, score, relevance, matchedTerms: matches, importance, approxTokens: approxTokens(canonicalJson(record)), record };
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

function repositoryCandidates(worldModel, task, budget = DEFAULT_CONTEXT_BUDGET) {
  if (!worldModel || worldModel.status !== "current") return [];
  const taskTerms = terms(task);
  const graph = worldModel.snapshot.semanticGraph || null;
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
    const matches = matchedTerms(taskTerms, terms(lightweightBody));
    const pathMatches = matchedTerms(taskTerms, terms(file.path));
    const relevance = matches.length;
    const importance = ["source", "test"].includes(file.classification) ? 3 : 1;
    return {
      file,
      relevance,
      matchedTerms: matches,
      pathMatchedTerms: pathMatches,
      importance,
      score: relevance * 25 + pathMatches.length * 10 + importance * 4,
    };
  }).sort((left, right) => right.score - left.score || left.file.path.localeCompare(right.file.path));
  const expansionLimit = Math.min(MAX_REPOSITORY_GRAPH_EXPANSIONS, Math.max(8, Math.ceil(Number(budget) / 4000) * 8));
  const relevantRanked = ranked.filter((item) => item.relevance > 0);
  const seedLimit = Math.max(4, Math.ceil(expansionLimit / 2));
  const expandedPaths = new Set(relevantRanked.slice(0, seedLimit).map((item) => item.file.path));
  for (const seed of relevantRanked.slice(0, seedLimit)) {
    if (expandedPaths.size >= expansionLimit) break;
    const neighbors = (relationshipEdgesByPath.get(seed.file.path) || []).flatMap((edge) => [nodes.get(edge.from)?.path, nodes.get(edge.to)?.path])
      .filter((filePath) => filePath && filePath !== seed.file.path)
      .sort();
    for (const filePath of neighbors) {
      expandedPaths.add(filePath);
      if (expandedPaths.size >= expansionLimit) break;
    }
  }
  for (const item of relevantRanked) {
    if (expandedPaths.size >= expansionLimit) break;
    expandedPaths.add(item.file.path);
  }
  return ranked.map(({ file, relevance: lightweightRelevance, matchedTerms: lightweightMatches, pathMatchedTerms, importance, score: lightweightScore }) => {
    const expanded = expandedPaths.has(file.path);
    const allRelationships = (expanded ? relationshipEdgesByPath.get(file.path) || [] : []).map((edge) => ({
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
    const relationships = rankBounded(allRelationships, taskTerms, (item) => [
      item.type,
      item.from?.path,
      item.from?.name,
      item.to?.path,
      item.to?.name,
      item.to?.specifier,
    ].filter(Boolean).join(" "), MAX_CONTEXT_RELATIONSHIPS_PER_FILE);
    const body = [
      file.path,
      file.classification,
      file.language,
      ...file.symbols.map((item) => `${item.kind} ${item.name}`),
      ...file.dependencies.map((item) => `${item.kind} ${item.specifier}`),
      ...relationships.flatMap((item) => [item.type, item.from?.path, item.from?.name, item.to?.path, item.to?.name, item.to?.specifier]).filter(Boolean),
    ].join(" ");
    const matches = expanded ? matchedTerms(taskTerms, terms(body)) : lightweightMatches;
    const relevance = matches.length;
    const score = expanded ? relevance * 25 + pathMatchedTerms.length * 10 + importance * 4 : lightweightScore;
    const symbols = rankBounded(file.symbols, taskTerms, (item) => `${item.kind} ${item.name}`, MAX_CONTEXT_SYMBOLS_PER_FILE);
    const dependencies = rankBounded(file.dependencies, taskTerms, (item) => `${item.kind} ${item.specifier}`, MAX_CONTEXT_DEPENDENCIES_PER_FILE);
    const record = {
      kind: "RepositoryFile",
      path: file.path,
      digest: file.digest,
      freshness: file.freshness,
      classification: file.classification,
      language: file.language,
      symbols,
      dependencies,
      semanticRelationships: relationships,
      evidenceOmissions: {
        symbols: Math.max(0, file.symbols.length - symbols.length),
        dependencies: Math.max(0, file.dependencies.length - dependencies.length),
        semanticRelationships: Math.max(0, allRelationships.length - relationships.length),
      },
      semanticGraphId: graph?.semanticGraphId || null,
      graphExpansion: expanded ? "bounded-semantic-adjacency" : "not-expanded-by-relevance-bound",
      worldModelId: worldModel.snapshot.worldModelId,
      trustBoundary: "evidence-not-instruction",
    };
    return {
      id: `repository-file:${file.path}`,
      kind: "RepositoryFile",
      score,
      relevance,
      matchedTerms: matches,
      directMatchedTerms: lightweightMatches,
      pathMatchedTerms,
      importance,
      approxTokens: approxTokens(canonicalJson(record)),
      record,
    };
  }).sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
}

function productContextCandidateForAnchor(worldModel, task, graphProjectionAdapter, anchorTerm, matchingTerms, selectedEntityKey = null) {
  const graph = worldModel.snapshot.temporalProvenanceGraph;
  const productModel = worldModel.snapshot.productModel;
  const taskTerms = terms(task);
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
  const matches = matchedTerms(taskTerms, terms(body));
  const relevance = matches.length;
  const compactEntities = rankBounded(traversal.nodes, taskTerms, (node) => canonicalJson(node.semantic || {
    kind: node.kind,
    key: node.key,
    path: node.path,
    name: node.name,
  }), MAX_PRODUCT_CONTEXT_ENTITIES).map((node) => ({
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
  const selectedProductNodeIds = new Set(compactEntities.map((item) => item.nodeId));
  const compactRelationships = traversal.edges.filter((edge) => selectedProductNodeIds.has(edge.from) || selectedProductNodeIds.has(edge.to))
    .slice(0, MAX_PRODUCT_CONTEXT_RELATIONSHIPS).map((edge) => ({
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
    taskAnchor: { selectedTerm: anchorTerm, selectedEntityKey, matchingTerms },
    entities: compactEntities,
    relationships: compactRelationships,
    projectionOmissions: {
      entities: Math.max(0, traversal.nodes.length - compactEntities.length),
      relationships: Math.max(0, traversal.edges.length - compactRelationships.length),
    },
    temporalTraversal: compactTraversalMetadata(traversal),
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
    matchedTerms: matches,
    importance: 5,
    approxTokens: approxTokens(canonicalJson(record)),
    record,
  }];
}

function productContextCandidates(worldModel, task, graphProjectionAdapter = null, evidenceNeeds = []) {
  if (!worldModel || worldModel.status !== "current") return [];
  const graph = worldModel.snapshot.temporalProvenanceGraph;
  const productModel = worldModel.snapshot.productModel;
  if (!graph || !productModel || graph.summary.productRevisionCount === 0) return [];
  const taskTerms = terms(task);
  const productCorpus = graph.nodes.filter((node) => node.semantic).map((node) => canonicalJson(node.semantic).toLocaleLowerCase()).join(" ");
  const matchingTerms = [...taskTerms].filter((term) => productCorpus.includes(term))
    .sort((left, right) => right.length - left.length || left.localeCompare(right));
  const entityKeys = [...new Set(evidenceNeeds.filter((need) => need.kind === "product-context").flatMap((need) => need.entityKeys || []))].sort();
  const anchors = entityKeys.length
    ? entityKeys.map((key) => ({ anchorTerm: key, matchingTerms: [], selectedEntityKey: key }))
    : matchingTerms.length ? [{ anchorTerm: matchingTerms[0], matchingTerms, selectedEntityKey: null }] : [];
  const candidates = anchors.flatMap(({ anchorTerm, matchingTerms: anchorMatches, selectedEntityKey }) => (
    productContextCandidateForAnchor(worldModel, task, graphProjectionAdapter, anchorTerm, anchorMatches, selectedEntityKey)
  ));
  return [...new Map(candidates.map((candidate) => [candidate.id, candidate])).values()]
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
}

function graphTraversalCandidates(worldModel, evidenceNeeds, graphProjectionAdapter = null) {
  const anchoredNeeds = evidenceNeeds.filter((need) => need.kind === "temporal-relation" && need.graphAnchor);
  if (!anchoredNeeds.length) return [];
  if (!worldModel || worldModel.status !== "current") {
    fail("HEAD graph anchors require a current digest-verified World Model.", "GRAPH_ANCHOR_WORLD_MODEL_STALE");
  }
  const snapshot = worldModel.snapshot;
  const graph = snapshot.temporalProvenanceGraph;
  if (!graph) fail("HEAD graph anchors require a current temporal GraphSnapshot.", "GRAPH_ANCHOR_GRAPH_NOT_BUILT");
  return anchoredNeeds.map((need) => {
    const proposal = need.graphAnchor;
    if (proposal.projectId !== snapshot.projectId) fail(`Evidence need ${need.id} graphAnchor belongs to another Project.`, "GRAPH_ANCHOR_PROJECT_MISMATCH");
    if (proposal.worldModelId !== snapshot.worldModelId) fail(`Evidence need ${need.id} graphAnchor is stale for the current World Model.`, "GRAPH_ANCHOR_WORLD_MODEL_MISMATCH");
    if (proposal.graphSnapshotId !== graph.graphSnapshotId) fail(`Evidence need ${need.id} graphAnchor is stale for the current GraphSnapshot.`, "GRAPH_ANCHOR_GRAPH_SNAPSHOT_MISMATCH");
    const traversal = queryTemporalProjection(worldModel, graphProjectionAdapter, {
      anchorIds: proposal.nodeIds,
      expectedGraphSnapshotId: proposal.graphSnapshotId,
      relations: need.relationTypes,
      authorityClasses: ["canon-projected", "reviewed", "derived", "heuristic", "runtime-observed"],
      freshness: ["current"],
      minConfidence: 0,
      includeUnreviewedCandidates: false,
      depth: proposal.depth,
      maxNodes: proposal.maxNodes,
      maxEdges: proposal.maxEdges,
    });
    const nodePaths = new Map(traversal.nodes.map((node) => [node.nodeId, node.path || null]));
    const relationships = traversal.edges.map((edge) => ({
      ...edge,
      endpointPaths: [...new Set([nodePaths.get(edge.from), nodePaths.get(edge.to)].filter(Boolean))].sort(),
    }));
    const record = {
      kind: "GraphTraversalEvidence",
      evidenceNeedId: need.id,
      graphAnchorProposal: proposal,
      projectId: snapshot.projectId,
      worldModelId: snapshot.worldModelId,
      graphSnapshotId: graph.graphSnapshotId,
      nodes: traversal.nodes,
      relationships,
      temporalTraversal: compactTraversalMetadata(traversal),
      authority: "derived-evidence-only",
      instructionAuthority: false,
      promotionAuthority: false,
      recoveryAuthority: false,
      semanticAcceptance: "HEAD-only",
      trustBoundary: "provider-proposal-validated-as-current-bounded-evidence-not-instruction",
    };
    return {
      id: `graph-traversal-evidence:${need.id}:${traversal.resultId}`,
      kind: "GraphTraversalEvidence",
      score: 100,
      relevance: 0,
      matchedTerms: [],
      importance: 5,
      approxTokens: approxTokens(canonicalJson(record)),
      record,
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
}

function gitDecisionCandidates(worldModel, task, historyClass) {
  if (!worldModel || worldModel.status !== "current" || historyClass === "NONE") return [];
  const history = worldModel.snapshot.gitDecisionHistory;
  if (!history || history.status !== "available") return [];
  const taskTerms = terms(task);
  return history.commits.map((commit, index) => {
    const body = [commit.subject, commit.body, commit.author.name, ...commit.refs].join(" ");
    const matches = matchedTerms(taskTerms, terms(body));
    const relevance = matches.length;
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
      matchedTerms: matches,
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
    const matches = matchedTerms(taskTerms, terms(body));
    const relevance = matches.length;
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
      matchedTerms: matches,
      importance,
      approxTokens: approxTokens(canonicalJson(record)),
      record,
    };
  }).sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
}

function normalizeEvidenceNeeds(evidenceNeeds) {
  if (evidenceNeeds == null) return [];
  if (!Array.isArray(evidenceNeeds)) fail("HEAD evidence needs must be an array.", "INVALID_EVIDENCE_NEEDS");
  if (evidenceNeeds.length > 32) fail("HEAD evidence needs may contain at most 32 items.", "INVALID_EVIDENCE_NEEDS");
  const allowedKeys = new Set(["id", "kind", "paths", "entityKeys", "facets", "relationTypes", "graphAnchor", "minimumItems", "rationale"]);
  const knownKinds = new Set(EVIDENCE_NEED_KINDS);
  const seen = new Set();
  const normalized = evidenceNeeds.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(`Evidence need ${index} must be an object.`, "INVALID_EVIDENCE_NEEDS");
    const unknownKeys = Object.keys(value).filter((key) => !allowedKeys.has(key));
    if (unknownKeys.length) fail(`Evidence need ${index} has unsupported fields: ${unknownKeys.sort().join(", ")}.`, "INVALID_EVIDENCE_NEEDS");
    const id = String(value.id || "").trim().toLocaleLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id)) fail(`Evidence need ${index} has an invalid id.`, "INVALID_EVIDENCE_NEEDS");
    if (seen.has(id)) fail(`Evidence need id is duplicated: ${id}.`, "INVALID_EVIDENCE_NEEDS");
    seen.add(id);
    const kind = String(value.kind || "").trim().toLocaleLowerCase();
    if (!knownKinds.has(kind)) fail(`Evidence need ${id} has an unsupported kind: ${kind || "(empty)"}.`, "INVALID_EVIDENCE_NEEDS");
    const rawPaths = value.paths == null ? [] : value.paths;
    if (!Array.isArray(rawPaths) || rawPaths.length > 32 || rawPaths.some((item) => typeof item !== "string" || !item.trim())) {
      fail(`Evidence need ${id} paths must be an array of at most 32 non-empty project-relative paths.`, "INVALID_EVIDENCE_NEEDS");
    }
    const paths = [...new Set(rawPaths.map((item) => item.trim().replace(/\\/g, "/")))].sort();
    if (paths.some((item) => path.posix.isAbsolute(item) || item.split("/").some((part) => !part || part === "." || part === ".."))) {
      fail(`Evidence need ${id} contains a non-normalized project-relative path.`, "INVALID_EVIDENCE_NEEDS");
    }
    if (paths.length && !kind.startsWith("repository-") && !["semantic-relation", "temporal-relation"].includes(kind)) {
      fail(`Evidence need ${id} may use paths only with repository or relation evidence.`, "INVALID_EVIDENCE_NEEDS");
    }
    const rawEntityKeys = value.entityKeys == null ? [] : value.entityKeys;
    if (!Array.isArray(rawEntityKeys) || rawEntityKeys.length > 32 || rawEntityKeys.some((item) => typeof item !== "string" || !item.trim())) {
      fail(`Evidence need ${id} entityKeys must be an array of at most 32 non-empty Product keys.`, "INVALID_EVIDENCE_NEEDS");
    }
    const entityKeys = [...new Set(rawEntityKeys.map((item) => item.trim()))].sort();
    if (entityKeys.some((item) => !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(item))) fail(`Evidence need ${id} contains an invalid Product key.`, "INVALID_EVIDENCE_NEEDS");
    if (entityKeys.length && kind !== "product-context") {
      fail(`Evidence need ${id} may use entityKeys only with product-context evidence.`, "INVALID_EVIDENCE_NEEDS");
    }
    const rawFacets = value.facets == null ? [] : value.facets;
    if (!Array.isArray(rawFacets) || rawFacets.length > 16 || rawFacets.some((item) => typeof item !== "string" || !item.trim())) {
      fail(`Evidence need ${id} facets must be an array of at most 16 non-empty strings.`, "INVALID_EVIDENCE_NEEDS");
    }
    const facets = [...new Set(rawFacets.flatMap((item) => [...terms(item)]))].sort();
    const rawRelations = value.relationTypes == null ? [] : value.relationTypes;
    if (!Array.isArray(rawRelations) || rawRelations.length > 16) fail(`Evidence need ${id} relationTypes must be an array of at most 16 values.`, "INVALID_EVIDENCE_NEEDS");
    const relationTypes = [...new Set(rawRelations.map((item) => String(item).trim().toUpperCase()))].sort();
    if (relationTypes.some((item) => !/^[A-Z][A-Z0-9_]{0,63}$/.test(item))) fail(`Evidence need ${id} has an invalid relation type.`, "INVALID_EVIDENCE_NEEDS");
    if (relationTypes.length && !["semantic-relation", "temporal-relation"].includes(kind)) {
      fail(`Evidence need ${id} may use relationTypes only with a relation kind.`, "INVALID_EVIDENCE_NEEDS");
    }
    let graphAnchor = null;
    if (value.graphAnchor != null) {
      if (kind !== "temporal-relation" || !value.graphAnchor || typeof value.graphAnchor !== "object" || Array.isArray(value.graphAnchor)) {
        fail(`Evidence need ${id} may use graphAnchor only with temporal-relation evidence.`, "INVALID_EVIDENCE_NEEDS");
      }
      const graphAnchorKeys = new Set(["projectId", "worldModelId", "graphSnapshotId", "nodeIds", "depth", "maxNodes", "maxEdges"]);
      const unsupported = Object.keys(value.graphAnchor).filter((key) => !graphAnchorKeys.has(key));
      if (unsupported.length) fail(`Evidence need ${id} graphAnchor has unsupported fields: ${unsupported.sort().join(", ")}.`, "INVALID_EVIDENCE_NEEDS");
      const projectId = String(value.graphAnchor.projectId || "").trim();
      const worldModelId = String(value.graphAnchor.worldModelId || "").trim();
      const graphSnapshotId = String(value.graphAnchor.graphSnapshotId || "").trim();
      const rawNodeIds = value.graphAnchor.nodeIds;
      const nodeIds = Array.isArray(rawNodeIds) ? rawNodeIds.map((nodeId) => typeof nodeId === "string" ? nodeId.trim() : nodeId) : rawNodeIds;
      const depth = Number(value.graphAnchor.depth);
      const maxNodes = Number(value.graphAnchor.maxNodes);
      const maxEdges = Number(value.graphAnchor.maxEdges);
      if (!projectId || projectId.length > 256
        || !/^world-model-[a-f0-9]{24}$/.test(worldModelId)
        || !/^graph-snapshot-[a-f0-9]{24}$/.test(graphSnapshotId)
        || !Array.isArray(nodeIds) || nodeIds.length < 1 || nodeIds.length > 32
        || nodeIds.some((nodeId) => typeof nodeId !== "string" || !nodeId.trim() || nodeId.length > 256)
        || new Set(nodeIds).size !== nodeIds.length
        || !Number.isInteger(depth) || depth < 1 || depth > 3
        || !Number.isInteger(maxNodes) || maxNodes < nodeIds.length || maxNodes > 500
        || !Number.isInteger(maxEdges) || maxEdges < 1 || maxEdges > 1000
        || relationTypes.length < 1 || facets.length > 0) {
        fail(`Evidence need ${id} graphAnchor must be exact, current-bindable, relation-bounded, and within traversal limits.`, "INVALID_EVIDENCE_NEEDS");
      }
      const proposal = { projectId, worldModelId, graphSnapshotId, nodeIds: [...nodeIds].sort(), depth, maxNodes, maxEdges };
      graphAnchor = { ...proposal, proposalDigest: digest(canonicalJson(proposal)) };
    }
    const minimumItems = value.minimumItems == null ? 1 : Number(value.minimumItems);
    if (!Number.isInteger(minimumItems) || minimumItems < 1 || minimumItems > 20) fail(`Evidence need ${id} minimumItems must be an integer from 1 to 20.`, "INVALID_EVIDENCE_NEEDS");
    const rationale = value.rationale == null ? "" : String(value.rationale).trim();
    if (rationale.length > 500) fail(`Evidence need ${id} rationale must be at most 500 characters.`, "INVALID_EVIDENCE_NEEDS");
    return { id, kind, paths, entityKeys, facets, relationTypes, graphAnchor, minimumItems, rationale };
  });
  return normalized.sort((left, right) => left.id.localeCompare(right.id));
}

function evidenceNeedContract(task, evidenceNeeds) {
  const needs = normalizeEvidenceNeeds(evidenceNeeds);
  const contract = {
    owner: "HEAD",
    scope: "task-local-context-compilation",
    taskDigest: digest(task.trim()),
    needs,
    productCanonAuthority: false,
    instructionAuthority: false,
    reviewAuthority: false,
    recoveryAuthority: false,
  };
  return {
    ...contract,
    evidenceNeedSetDigest: digest(canonicalJson(contract)),
  };
}

function facetMatch(value, facets) {
  if (!facets.length) return true;
  const available = terms(value);
  return facets.every((facet) => available.has(facet));
}

function evidenceItem(candidate, { id = candidate.id, kind, path = null, relationType = null, value = candidate.record } = {}) {
  return {
    id,
    carrierCandidateId: candidate.id,
    kind,
    path,
    relationType,
    digest: digest(canonicalJson(value)),
  };
}

function candidateEvidenceMatches(candidate, need) {
  const record = candidate.record;
  const candidateBody = canonicalJson(record);
  if (need.paths.length && candidate.kind !== "GraphTraversalEvidence" && (!record.path || !need.paths.includes(record.path))) return [];
  if (candidate.kind === "GraphTraversalEvidence" && record.evidenceNeedId !== need.id) return [];
  let matchedEntityKeys = [];
  if (need.entityKeys.length) {
    if (candidate.kind !== "ProductContext") return [];
    const presentKeys = new Set((record.entities || []).flatMap((item) => [item.key, item.semantic?.key]).filter(Boolean));
    matchedEntityKeys = need.entityKeys.filter((key) => presentKeys.has(key));
    if (!matchedEntityKeys.length) return [];
  }
  if (!["semantic-relation", "temporal-relation"].includes(need.kind) && !facetMatch(candidateBody, need.facets)) return [];
  const simpleKinds = {
    claim: "Claim",
    decision: "Decision",
    "git-decision": "GitDecisionEvidence",
    "product-context": "ProductContext",
    "runtime-state": "RuntimeStateEvidence",
    unknown: "Unknown",
  };
  if (simpleKinds[need.kind]) {
    if (need.kind === "product-context" && matchedEntityKeys.length) {
      return matchedEntityKeys.map((entityKey) => evidenceItem(candidate, {
        id: `${candidate.id}:product-entity:${entityKey}`,
        kind: need.kind,
        value: { carrierCandidateId: candidate.id, entityKey },
      }));
    }
    return candidate.kind === simpleKinds[need.kind]
      ? [evidenceItem(candidate, { kind: need.kind, path: record.path || null })]
      : [];
  }
  if (need.kind.startsWith("repository-")) {
    if (candidate.kind !== "RepositoryFile") return [];
    if (need.kind === "repository-source" && record.classification !== "source") return [];
    if (need.kind === "repository-test" && record.classification !== "test") return [];
    return [evidenceItem(candidate, { kind: need.kind, path: record.path })];
  }
  const relationValues = need.kind === "semantic-relation"
    ? (candidate.kind === "RepositoryFile" ? record.semanticRelationships || [] : [])
    : candidate.kind === "RepositoryFile"
      ? record.temporalRelationships || []
      : ["ProductContext", "GraphTraversalEvidence"].includes(candidate.kind) ? record.relationships || [] : [];
  return relationValues.filter((relation) => {
    const relationType = String(relation.type || "").toUpperCase();
    if (need.relationTypes.length && !need.relationTypes.includes(relationType)) return false;
    if (need.paths.length && !(relation.endpointPaths || []).some((item) => need.paths.includes(item))) return false;
    return facetMatch(`${record.path || ""} ${canonicalJson(relation)}`, need.facets);
  }).map((relation, index) => {
    const relationType = String(relation.type || "").toUpperCase();
    const relationId = relation.id || relation.edgeId || `${candidate.id}:${relationType}:${index}`;
    return evidenceItem(candidate, {
      id: relationId,
      kind: need.kind,
      path: record.path || null,
      relationType,
      value: relation,
    });
  });
}

function bindEvidenceNeeds(candidates, needs) {
  for (const candidate of candidates) {
    candidate.evidenceNeedMatches = Object.fromEntries(needs.map((need) => [need.id, candidateEvidenceMatches(candidate, need)]));
  }
}

function uniqueEvidence(items) {
  const byId = new Map();
  for (const item of items) if (!byId.has(item.id)) byId.set(item.id, item);
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function selectedEvidenceCount(selected, needId) {
  return uniqueEvidence(selected.flatMap((candidate) => candidate.evidenceNeedMatches[needId] || [])).length;
}

function coverageGain(candidate, selected, needs) {
  return needs.reduce((gain, need) => {
    const remaining = Math.max(0, need.minimumItems - selectedEvidenceCount(selected, need.id));
    if (!remaining) return gain;
    return gain + Math.min(remaining, (candidate.evidenceNeedMatches[need.id] || []).length);
  }, 0);
}

function selectCandidates(candidates, budget, baseTokens, needs) {
  if (baseTokens > budget) fail("Context budget cannot hold the required task, authority, and current-state envelope.", "CONTEXT_BUDGET_TOO_SMALL");
  let used = baseTokens;
  const included = [];
  const includedIds = new Set();
  const eligible = candidates;
  while (needs.some((need) => selectedEvidenceCount(included, need.id) < need.minimumItems)) {
    const fitting = eligible.filter((candidate) => !includedIds.has(candidate.id) && used + candidate.approxTokens <= budget)
      .map((candidate) => ({ candidate, gain: coverageGain(candidate, included, needs) }))
      .filter((item) => item.gain > 0)
      .sort((left, right) => right.gain - left.gain
        || right.candidate.score - left.candidate.score
        || left.candidate.approxTokens - right.candidate.approxTokens
        || left.candidate.id.localeCompare(right.candidate.id));
    if (!fitting.length) break;
    const selected = fitting[0].candidate;
    included.push(selected);
    includedIds.add(selected.id);
    used += selected.approxTokens;
  }
  if (!needs.length) {
    for (const candidate of eligible) {
      if (includedIds.has(candidate.id) || used + candidate.approxTokens > budget) continue;
      included.push(candidate);
      includedIds.add(candidate.id);
      used += candidate.approxTokens;
    }
  }
  const excluded = candidates.filter((candidate) => !includedIds.has(candidate.id)).map((candidate) => {
    const evidenceNeedIds = Object.entries(candidate.evidenceNeedMatches).filter(([, items]) => items.length).map(([needId]) => needId).sort();
    const stillNeeded = needs.some((need) => evidenceNeedIds.includes(need.id) && selectedEvidenceCount(included, need.id) < need.minimumItems);
    const reason = !needs.length || stillNeeded
      ? "context-budget"
      : evidenceNeedIds.length
        ? "evidence-coverage-satisfied"
        : "outside-head-evidence-contract";
    return {
      id: candidate.id,
      kind: candidate.kind,
      reason,
      score: candidate.score,
      classification: candidate.record.classification || null,
      recordDigest: digest(canonicalJson(candidate.record)),
      freshness: candidate.record.freshness || null,
      trustBoundary: candidate.record.trustBoundary || null,
      evidenceNeedIds,
      expansionPath: reason === "context-budget"
        ? "recompile-with-an-explicit-budget-or-use-bounded-expansion"
        : reason === "evidence-coverage-satisfied"
          ? "increase-the-head-defined-minimum-only-if-semantic-assessment-requires-more"
          : "add-or-revise-a-head-owned-evidence-need-only-after-semantic-analysis",
    };
  });
  return { included, excluded, used };
}

function evaluateCoverage(candidates, contract, selection, budget) {
  const needs = contract.needs;
  const excludedReasonById = new Map(selection.excluded.map((item) => [item.id, item.reason]));
  const proofs = needs.map((need) => {
    const includedEvidence = uniqueEvidence(selection.included.flatMap((candidate) => candidate.evidenceNeedMatches[need.id] || []));
    const availableEvidence = uniqueEvidence(candidates.flatMap((candidate) => candidate.evidenceNeedMatches[need.id] || []));
    const availableCandidateIds = [...new Set(availableEvidence.map((item) => item.carrierCandidateId))].sort();
    return {
      evidenceNeedId: need.id,
      requiredMinimumItems: need.minimumItems,
      includedMatchCount: includedEvidence.length,
      availableMatchCount: availableEvidence.length,
      covered: includedEvidence.length >= need.minimumItems,
      includedEvidence,
      availableCandidateIds,
      exclusionReasons: [...new Set(availableCandidateIds.map((id) => excludedReasonById.get(id)).filter(Boolean))].sort(),
    };
  });
  const unmet = proofs.filter((proof) => !proof.covered);
  const additionalSelected = [];
  let minimumAdditionalApproxTokens = 0;
  while (needs.some((need) => selectedEvidenceCount([...selection.included, ...additionalSelected], need.id) < need.minimumItems)) {
    const options = candidates.filter((candidate) => !selection.included.includes(candidate) && !additionalSelected.includes(candidate))
      .map((candidate) => ({
        candidate,
        gain: coverageGain(candidate, [...selection.included, ...additionalSelected], needs),
      }))
      .filter((item) => item.gain > 0)
      .sort((left, right) => right.gain - left.gain
        || right.candidate.score - left.candidate.score
        || left.candidate.approxTokens - right.candidate.approxTokens
        || left.candidate.id.localeCompare(right.candidate.id));
    if (!options.length) break;
    const selected = options[0].candidate;
    additionalSelected.push(selected);
    minimumAdditionalApproxTokens += selected.approxTokens;
  }
  const canCoverAfterExpansion = needs.every((need) => selectedEvidenceCount([...selection.included, ...additionalSelected], need.id) >= need.minimumItems);
  const recommendedMinimum = unmet.length && canCoverAfterExpansion
    ? selection.used + minimumAdditionalApproxTokens
    : null;
  const status = !needs.length ? "not-requested" : unmet.length ? "coverage-incomplete" : "coverage-complete";
  const result = {
    protocol: { name: "head-agent-core-context-coverage", version: CONTEXT_COVERAGE_VERSION },
    status,
    mechanicalCoverageSatisfied: unmet.length === 0,
    evidenceNeedsSpecified: needs.length > 0,
    evidenceNeedSetDigest: contract.evidenceNeedSetDigest,
    bounded: true,
    hardLimitApproxTokens: budget,
    proofs,
    satisfiedEvidenceNeedIds: proofs.filter((proof) => proof.covered).map((proof) => proof.evidenceNeedId),
    unmetEvidenceNeeds: unmet.map((proof) => ({
      evidenceNeed: needs.find((need) => need.id === proof.evidenceNeedId),
      includedMatchCount: proof.includedMatchCount,
      availableMatchCount: proof.availableMatchCount,
      shortfall: proof.requiredMinimumItems - proof.includedMatchCount,
      availableCandidateIds: proof.availableCandidateIds,
      exclusionReasons: proof.exclusionReasons,
    })),
    recommendedMinimumApproxTokens: recommendedMinimum == null || recommendedMinimum > CONTEXT_BUDGET_TIERS.at(-1) ? null : recommendedMinimum,
    nextAction: !needs.length
      ? "HEAD-may-define-task-evidence-needs-before-consequential-execution"
      : unmet.length ? "expand-query-or-recompile-with-a-larger-explicit-budget" : "HEAD-evaluates-semantic-sufficiency",
    semanticAcceptance: "not-assessed-HEAD-owned",
    authorityEffect: "none",
  };
  return {
    ...result,
    proofDigest: digest(canonicalJson({
      evidenceNeedSetDigest: result.evidenceNeedSetDigest,
      includedCandidateIds: selection.included.map((candidate) => candidate.id),
      proofs: result.proofs,
    })),
  };
}

function compatibilitySufficiency(coverageAssessment) {
  return {
    deprecated: true,
    replacedBy: "coverageAssessment",
    status: coverageAssessment.status === "not-requested" ? "unassessed" : coverageAssessment.status,
    executionEligible: coverageAssessment.mechanicalCoverageSatisfied,
    semanticAcceptance: coverageAssessment.semanticAcceptance,
    authorityEffect: "none",
  };
}

export function compileContext({ root = ".", task, budget = DEFAULT_CONTEXT_BUDGET, evidenceNeeds = [], persist = false, graphProjectionAdapter = null } = {}) {
  if (typeof task !== "string" || !task.trim()) fail("Context compilation requires a task.", "TASK_REQUIRED");
  const normalizedBudget = normalizeContextBudget(budget);
  const { maxApproxTokens } = normalizedBudget;
  const inspected = inspectProject(root);
  if (inspected.status !== "ready") fail(`Project must be ready to compile context; current status: ${inspected.status}.`, "PROJECT_NOT_READY");
  const projectRoot = inspected.project.projectRoot;
  const sources = loadSources(projectRoot);
  const snapshot = contextSnapshot(inspected, sources);
  const projectContext = sources.raw.projectContext.trim();
  const historyClass = historyRelevance(task);
  const needContract = evidenceNeedContract(task, evidenceNeeds);
  const base = {
    objective: task.trim(),
    currentState: projectContext,
    authority: inspected.project.authority,
    coverage: snapshot.coverage,
    evidenceNeedContract: needContract,
  };
  const candidates = [
    ...activeCandidates(sources.knowledge, task, historyClass),
    ...productContextCandidates(sources.worldModel, task, graphProjectionAdapter, needContract.needs),
    ...graphTraversalCandidates(sources.worldModel, needContract.needs, graphProjectionAdapter),
    ...repositoryCandidates(sources.worldModel, task, maxApproxTokens),
    ...gitDecisionCandidates(sources.worldModel, task, historyClass),
    ...runtimeStateCandidates(sources.worldModel, task),
  ].sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  bindEvidenceNeeds(candidates, needContract.needs);
  const selection = selectCandidates(candidates, maxApproxTokens, approxTokens(canonicalJson(base)), needContract.needs);
  const coverageAssessment = evaluateCoverage(candidates, needContract, selection, maxApproxTokens);
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    kind: "ContextCapsule",
    task: task.trim(),
    snapshot,
    compiler: {
      name: "head-agent-core-context-compiler",
      version: CONTEXT_COMPILER_VERSION,
      strategy: "deterministic-head-guided-context-packaging",
      historyRelevance: historyClass,
      lexicalNormalization: "nfkc+url-elision+camel-snake-path+bounded-korean-particle-variants",
      lexicalRole: "fallback-ranking-only-never-candidate-eligibility-or-semantic-acceptance",
    },
    budget: {
      protocol: { name: "head-agent-core-context-budget-tiers", version: CONTEXT_BUDGET_PROTOCOL_VERSION },
      tier: normalizedBudget.tier,
      maxApproxTokens,
      usedApproxTokens: selection.used,
      metric: {
        name: "utf16-code-units-divided-by-4-ceil",
        version: "1.0.0",
        exact: false,
        providerFit: "must-be-validated-at-runtime-adapter-boundary",
      },
    },
    evidenceNeedContract: needContract,
    coverageAssessment,
    sufficiency: compatibilitySufficiency(coverageAssessment),
    authority: inspected.project.authority,
    currentState: projectContext,
    claims: selection.included.filter((item) => item.kind === "Claim").map((item) => item.record),
    decisions: selection.included.filter((item) => item.kind === "Decision").map((item) => item.record),
    unknowns: selection.included.filter((item) => item.kind === "Unknown").map((item) => item.record),
    repositoryContext: selection.included.filter((item) => item.kind === "RepositoryFile").map((item) => item.record),
    productContext: selection.included.filter((item) => item.kind === "ProductContext").map((item) => item.record),
    gitDecisionEvidence: selection.included.filter((item) => item.kind === "GitDecisionEvidence").map((item) => item.record),
    runtimeStateEvidence: selection.included.filter((item) => item.kind === "RuntimeStateEvidence").map((item) => item.record),
    graphTraversalEvidence: selection.included.filter((item) => item.kind === "GraphTraversalEvidence").map((item) => item.record),
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

export function requireCoveredContextCapsule({ root = ".", capsuleId } = {}) {
  const verified = readContextCapsule({ root, capsuleId });
  const coverage = verified.capsule.coverageAssessment;
  if (coverage?.mechanicalCoverageSatisfied === false) {
    const missing = coverage.unmetEvidenceNeeds.map((item) => item.evidenceNeed.id);
    const error = new Error(`Context Capsule does not cover the HEAD-defined evidence needs: ${missing.join(", ")}`);
    error.code = "CONTEXT_CAPSULE_COVERAGE_INCOMPLETE";
    error.coverageAssessment = coverage;
    throw error;
  }
  if (!coverage && verified.capsule.sufficiency?.executionEligible === false) {
    const error = new Error("Legacy Context Capsule is not eligible for execution.");
    error.code = "CONTEXT_CAPSULE_INSUFFICIENT";
    error.sufficiency = verified.capsule.sufficiency;
    throw error;
  }
  return verified;
}

// Compatibility export. The Compiler now verifies mechanical coverage only;
// semantic sufficiency remains a HEAD judgment at the ExecutionContract boundary.
export const requireSufficientContextCapsule = requireCoveredContextCapsule;
