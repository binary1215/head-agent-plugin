#!/usr/bin/env node
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { coreContract, inspectProject } from "./lib/head-core.mjs";
import { compileContext, readContextCapsule } from "./lib/context-compiler.mjs";
import { readLineageArtifact } from "./lib/execution-lineage.mjs";
import { getPendingReviewContext } from "./lib/run-lineage.mjs";
import { inspectWorldModel, queryWorldHistory, queryWorldModel, queryWorldRuntimeState, queryWorldTemporalGraph } from "./lib/world-model.mjs";

const protocolVersion = "2024-11-05";
export const tools = [
  {
    name: "head_core_contract",
    description: "Read the active HEAD Agent Core roles, runtimes, and capability boundary.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "head_project_status",
    description: "Read canonical HEAD project and Session/Run status without modifying the project.",
    inputSchema: {
      type: "object",
      properties: { project_root: { type: "string", minLength: 1 } },
      required: ["project_root"],
      additionalProperties: false,
    },
  },
  {
    name: "head_context_preview",
    description: "Compile a deterministic minimum-sufficient Context Capsule without writing project state.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", minLength: 1 },
        task: { type: "string", minLength: 1 },
        budget: { type: "integer", minimum: 256, maximum: 50000, default: 4000 }
      },
      required: ["project_root", "task"],
      additionalProperties: false
    }
  },
  {
    name: "head_context_capsule",
    description: "Read and digest-verify one persisted Context Capsule.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", minLength: 1 },
        capsule_id: { type: "string", pattern: "^capsule-[a-f0-9]{24}$" }
      },
      required: ["project_root", "capsule_id"],
      additionalProperties: false
    }
  },
  {
    name: "head_lineage_artifact",
    description: "Read and digest-verify one persisted Whole-plan Execution Lineage artifact.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", minLength: 1 },
        artifact_id: { type: "string", pattern: "^(whole-plan|execution-contract|result-packet|review-decision)-[a-f0-9]{24}$" }
      },
      required: ["project_root", "artifact_id"],
      additionalProperties: false
    }
  },
  {
    name: "head_pending_review",
    description: "Build the deterministic minimum-sufficient Fresh HEAD view for the Result Packet awaiting review.",
    inputSchema: {
      type: "object",
      properties: { project_root: { type: "string", minLength: 1 } },
      required: ["project_root"],
      additionalProperties: false
    }
  },
  {
    name: "head_world_model",
    description: "Read, freshness-check, and digest-verify the current Repository World Model through its replaceable storage adapter.",
    inputSchema: {
      type: "object",
      properties: { project_root: { type: "string", minLength: 1 } },
      required: ["project_root"],
      additionalProperties: false
    }
  },
  {
    name: "head_world_query",
    description: "Traverse a bounded, digest-verified semantic neighborhood in the current Repository World Model as evidence, never instruction authority.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", minLength: 1 },
        query: { type: "string", minLength: 1 },
        depth: { type: "integer", minimum: 0, maximum: 3, default: 1 },
        limit: { type: "integer", minimum: 1, maximum: 500, default: 100 }
      },
      required: ["project_root", "query"],
      additionalProperties: false
    }
  },
  {
    name: "head_git_history",
    description: "Read bounded Git commit-message decision evidence from the current digest-verified World Model without promoting it to project decisions.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", minLength: 1 },
        query: { type: "string", default: "" },
        limit: { type: "integer", minimum: 1, maximum: 500, default: 50 }
      },
      required: ["project_root"],
      additionalProperties: false
    }
  },
  {
    name: "head_temporal_graph",
    description: "Run a deterministic allowlisted traversal over the current rebuildable temporal provenance GraphSnapshot without granting canon or promotion authority.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", minLength: 1 },
        query: { type: "string", minLength: 1 },
        kinds: { type: "array", items: { type: "string" }, uniqueItems: true },
        relation_types: { type: "array", items: { type: "string" }, uniqueItems: true },
        depth: { type: "integer", minimum: 0, maximum: 3, default: 1 },
        node_limit: { type: "integer", minimum: 1, maximum: 500, default: 100 },
        edge_limit: { type: "integer", minimum: 0, maximum: 1000, default: 200 },
        min_confidence: { type: "number", minimum: 0, maximum: 1, default: 0 }
      },
      required: ["project_root", "query"],
      additionalProperties: false
    }
  },
  {
    name: "head_runtime_state",
    description: "Read bounded point-in-time external runtime observations from the current digest-verified World Model as evidence without granting runtime control authority.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", minLength: 1 },
        query: { type: "string", default: "" },
        runtime: { type: "string", default: "" },
        state: { type: "string", default: "" },
        kind: { type: "string", default: "" },
        limit: { type: "integer", minimum: 1, maximum: 500, default: 50 }
      },
      required: ["project_root"],
      additionalProperties: false
    }
  },
];

const success = (id, result) => ({ jsonrpc: "2.0", id, result });
const failure = (id, message) => ({ jsonrpc: "2.0", id, error: { code: -32000, message } });

export async function dispatch(request) {
  const id = request.id ?? null;
  if (request.method === "initialize") {
    return success(id, { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "head-agent-core", version: "0.3.0-alpha.9" } });
  }
  if (request.method === "notifications/initialized") return null;
  if (request.method === "tools/list") return success(id, { tools });
  if (request.method !== "tools/call") return failure(id, "Method not found");
  try {
    const name = request.params?.name;
    const args = request.params?.arguments || {};
    const value = name === "head_core_contract"
      ? coreContract()
      : name === "head_project_status"
        ? inspectProject(args.project_root)
        : name === "head_context_preview"
          ? compileContext({ root: args.project_root, task: args.task, budget: args.budget ?? 4000, persist: false })
          : name === "head_context_capsule"
            ? readContextCapsule({ root: args.project_root, capsuleId: args.capsule_id })
            : name === "head_lineage_artifact"
              ? readLineageArtifact({ root: args.project_root, artifactId: args.artifact_id })
              : name === "head_pending_review"
                ? getPendingReviewContext({ root: args.project_root })
                : name === "head_world_model"
                  ? inspectWorldModel({ root: args.project_root })
                  : name === "head_world_query"
                    ? queryWorldModel({
                      root: args.project_root,
                      query: args.query,
                      depth: args.depth ?? 1,
                      maxResults: args.limit ?? 100,
                    })
                    : name === "head_git_history"
                      ? queryWorldHistory({
                        root: args.project_root,
                        query: args.query || "",
                        limit: args.limit ?? 50,
                      })
                      : name === "head_temporal_graph"
                        ? queryWorldTemporalGraph({
                          root: args.project_root,
                          query: args.query,
                          kinds: args.kinds || null,
                          relations: args.relation_types || null,
                          minConfidence: args.min_confidence ?? 0,
                          depth: args.depth ?? 1,
                          maxNodes: args.node_limit ?? 100,
                          maxEdges: args.edge_limit ?? 200,
                        })
                        : name === "head_runtime_state"
                          ? queryWorldRuntimeState({
                            root: args.project_root,
                            query: args.query || "",
                            runtime: args.runtime || "",
                            state: args.state || "",
                            kind: args.kind || "",
                            limit: args.limit ?? 50,
                          })
                          : (() => { throw new Error(`Unknown tool: ${name}`); })();
    return success(id, { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value });
  } catch (error) {
    return failure(id, error.message);
  }
}

export function serveMcp() {
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on("line", async (line) => {
    if (!line.trim()) return;
    let response;
    try { response = await dispatch(JSON.parse(line)); }
    catch (error) { response = failure(null, `Parse error: ${error.message}`); }
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  });
  return input;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) serveMcp();
