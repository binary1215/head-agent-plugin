#!/usr/bin/env node
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { coreContract, inspectProject, inspectRuntimeAdapters } from "./lib/head-core.mjs";
import { compileContext, readContextCapsule } from "./lib/context-compiler.mjs";
import { readLineageArtifact } from "./lib/execution-lineage.mjs";
import { getPendingReviewContext } from "./lib/run-lineage.mjs";
import { inspectWorldGraphProjection, inspectWorldMarkdownProjection, inspectWorldModel, queryWorldHistory, queryWorldModel, queryWorldRuntimeState, queryWorldTemporalGraph, readWorldDocumentChangeCandidateSet } from "./lib/world-model.mjs";
import { inspectOnboarding } from "./lib/onboarding.mjs";
import { inspectFeatureMapping } from "./lib/feature-mapping.mjs";
import { inspectChangeSets, readVcsEvidence } from "./lib/change-set.mjs";
import { inspectIncrementalRefresh, inspectPostRefreshProjectionStatus, readIncrementalRefreshReceipt, readPostRefreshProjectionReceipt } from "./lib/incremental-refresh.mjs";
import { inspectRefreshTriggers, readRefreshTriggerDelivery } from "./lib/refresh-trigger.mjs";
import { inspectDocumentChangeReviewStatus, readDocumentChangeApplicationReceipt, readDocumentChangeReviewDecision } from "./lib/document-change-review.mjs";
import { inspectArcadeDbGraphProjectionStatus } from "./lib/graphdb-projection-activation.mjs";
import { inspectRuntimeInvocationExecutionLease, readRuntimeInvocationAuthorization } from "./lib/runtime-invocation-lifecycle.mjs";
import { readRuntimeInvocationResult } from "./lib/runtime-run-result-application.mjs";

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
    name: "head_runtime_adapters",
    description: "Inspect provider-neutral runtime contracts, privacy-bounded executable discovery, fixed non-session version and protocol/capability evidence, and HEAD project/session capability binding without creating or controlling a provider session.",
    inputSchema: {
      type: "object",
      properties: { project_root: { type: "string", minLength: 1 } },
      required: ["project_root"],
      additionalProperties: false,
    },
  },
  {
    name: "head_runtime_invocation_authorization",
    description: "Read and digest-verify one Session- or Run-scoped ExecutionAuthorization without invoking or controlling a provider.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", minLength: 1 },
        authorization_id: { type: "string", pattern: "^execution-authorization-[a-f0-9]{24}$" },
      },
      required: ["project_root", "authorization_id"],
      additionalProperties: false,
    },
  },
  {
    name: "head_runtime_invocation_lease_status",
    description: "Read the durable at-most-once consumption and exact-owner release status for one runtime invocation authorization without claiming, replaying, or controlling a provider.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", minLength: 1 },
        authorization_id: { type: "string", pattern: "^execution-authorization-[a-f0-9]{24}$" },
      },
      required: ["project_root", "authorization_id"],
      additionalProperties: false,
    },
  },
  {
    name: "head_runtime_invocation_result",
    description: "Read and digest-verify one provider-neutral recorded invocation receipt, structured result draft, optional Run application, and transcript-free event envelopes without invoking or controlling a provider.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", minLength: 1 },
        authorization_id: { type: "string", pattern: "^execution-authorization-[a-f0-9]{24}$" },
      },
      required: ["project_root", "authorization_id"],
      additionalProperties: false,
    },
  },
  {
    name: "head_onboarding_status",
    description: "Read and digest-verify the project-scoped onboarding state, current candidate batch, storage selection, Product Canon identity, and local World Model status without promoting candidates or mutating project state.",
    inputSchema: {
      type: "object",
      properties: { project_root: { type: "string", minLength: 1 } },
      required: ["project_root"],
      additionalProperties: false,
    },
  },
  {
    name: "head_feature_mapping_status",
    description: "Read and digest-verify the current Feature mapping candidate batch or explicit reviewed relationship decision without creating or promoting mappings.",
    inputSchema: {
      type: "object",
      properties: { project_root: { type: "string", minLength: 1 } },
      required: ["project_root"],
      additionalProperties: false,
    },
  },
  {
    name: "head_change_set_status",
    description: "Read and digest-verify the current provider-neutral ChangeSet, Feature impact state, and optional VCS evidence without mutating project state.",
    inputSchema: {
      type: "object",
      properties: { project_root: { type: "string", minLength: 1 } },
      required: ["project_root"],
      additionalProperties: false,
    },
  },
  {
    name: "head_vcs_evidence",
    description: "Read and digest-verify one optional VCS evidence attachment and its immutable Git commit observations without treating commits as ChangeSet or project authority.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", minLength: 1 },
        vcs_evidence_id: { type: "string", pattern: "^vcs-evidence-[a-f0-9]{24}$" },
      },
      required: ["project_root", "vcs_evidence_id"],
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
    name: "head_incremental_refresh_status",
    description: "Read and digest-verify the latest explicit incremental refresh receipt, World Model binding, freshness, and active-execution drift without triggering refresh or changing authority.",
    inputSchema: {
      type: "object",
      properties: { project_root: { type: "string", minLength: 1 } },
      required: ["project_root"],
      additionalProperties: false
    }
  },
  {
    name: "head_incremental_refresh_receipt",
    description: "Read and digest-verify one immutable incremental observed-state refresh receipt without advancing a pointer or changing Product Canon.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", minLength: 1 },
        refresh_receipt_id: { type: "string", pattern: "^incremental-refresh-receipt-[a-f0-9]{24}$" }
      },
      required: ["project_root", "refresh_receipt_id"],
      additionalProperties: false
    }
  },
  {
    name: "head_refresh_trigger_status",
    description: "Read and digest-verify the latest debounced filesystem or CI trigger batch, serialized delivery receipt, World Model binding, and writer state without starting a watcher or triggering refresh.",
    inputSchema: {
      type: "object",
      properties: { project_root: { type: "string", minLength: 1 } },
      required: ["project_root"],
      additionalProperties: false
    }
  },
  {
    name: "head_refresh_trigger_delivery",
    description: "Read and digest-verify one immutable refresh trigger delivery and its linked incremental refresh evidence without mutating observed state or Product Canon.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", minLength: 1 },
        trigger_delivery_id: { type: "string", pattern: "^refresh-trigger-delivery-[a-f0-9]{24}$" }
      },
      required: ["project_root", "trigger_delivery_id"],
      additionalProperties: false
    }
  },
  {
    name: "head_graph_projection_status",
    description: "Read and verify the current replaceable graph projection adapter state without treating the graph backend as canon or unique authority.",
    inputSchema: {
      type: "object",
      properties: { project_root: { type: "string", minLength: 1 } },
      required: ["project_root"],
      additionalProperties: false
    }
  },
  {
    name: "head_graphdb_projection_status",
    description: "Read the privacy-safe ArcadeDB projection activation, current semantic binding, and disclosed local fallback state without exposing credentials or granting the remote backend authority.",
    inputSchema: {
      type: "object",
      properties: { project_root: { type: "string", minLength: 1 } },
      required: ["project_root"],
      additionalProperties: false
    }
  },
  {
    name: "head_markdown_projection_status",
    description: "Read and verify the deterministic Markdown projection, published-view drift, and current GraphSnapshot binding without treating generated documents as canon.",
    inputSchema: {
      type: "object",
      properties: { project_root: { type: "string", minLength: 1 } },
      required: ["project_root"],
      additionalProperties: false
    }
  },
  {
    name: "head_post_refresh_projection_status",
    description: "Read the effective manual-or-automatic Markdown projection policy and verify the latest post-refresh outcome without changing policy, documents, Product Canon, or active Run inputs.",
    inputSchema: {
      type: "object",
      properties: { project_root: { type: "string", minLength: 1 } },
      required: ["project_root"],
      additionalProperties: false
    }
  },
  {
    name: "head_post_refresh_projection_receipt",
    description: "Read and digest-verify one immutable post-refresh projection receipt with its linked incremental refresh, policy, DocumentProjection, or document-change candidate evidence.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", minLength: 1 },
        post_refresh_projection_receipt_id: { type: "string", pattern: "^post-refresh-projection-receipt-[a-f0-9]{24}$" }
      },
      required: ["project_root", "post_refresh_projection_receipt_id"],
      additionalProperties: false
    }
  },
  {
    name: "head_document_change_candidates",
    description: "Read and digest-verify one immutable DocumentChangeCandidateSet without accepting it or changing Product Canon.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", minLength: 1 },
        candidate_set_id: { type: "string", pattern: "^document-change-candidate-set-[a-f0-9]{24}$" }
      },
      required: ["project_root", "candidate_set_id"],
      additionalProperties: false
    }
  },
  {
    name: "head_document_change_review_status",
    description: "Read the explicit review and application status for one immutable DocumentChangeCandidateSet without accepting, applying, or mutating Product Canon.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", minLength: 1 },
        candidate_set_id: { type: "string", pattern: "^document-change-candidate-set-[a-f0-9]{24}$" }
      },
      required: ["project_root", "candidate_set_id"],
      additionalProperties: false
    }
  },
  {
    name: "head_document_change_review",
    description: "Read and digest-verify one explicit document-to-Product-Canon ReviewDecision and its exact candidate and resulting Product Model revision bindings.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", minLength: 1 },
        review_decision_id: { type: "string", pattern: "^document-change-review-decision-[a-f0-9]{24}$" }
      },
      required: ["project_root", "review_decision_id"],
      additionalProperties: false
    }
  },
  {
    name: "head_document_change_application",
    description: "Read and digest-verify one document-change application receipt linking the user ReviewDecision to exact before/after World, Graph, Canon, and Markdown projection identities.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", minLength: 1 },
        application_receipt_id: { type: "string", pattern: "^document-change-application-[a-f0-9]{24}$" }
      },
      required: ["project_root", "application_receipt_id"],
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
    description: "Run a deterministic allowlisted traversal over the current rebuildable temporal provenance GraphSnapshot, including Product Canon projections, without granting the graph canon or promotion authority.",
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
        min_confidence: { type: "number", minimum: 0, maximum: 1, default: 0 },
        include_unreviewed_candidates: { type: "boolean", default: false }
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
      return success(id, { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "head-agent-core", version: "0.3.0-alpha.38" } });
  }
  if (request.method === "notifications/initialized") return null;
  if (request.method === "tools/list") return success(id, { tools });
  if (request.method !== "tools/call") return failure(id, "Method not found");
  try {
    const name = request.params?.name;
    const args = request.params?.arguments || {};
    const value = await (name === "head_core_contract"
      ? coreContract()
      : name === "head_project_status"
        ? inspectProject(args.project_root)
        : name === "head_runtime_adapters"
          ? inspectRuntimeAdapters(args.project_root)
        : name === "head_runtime_invocation_authorization"
          ? readRuntimeInvocationAuthorization({ root: args.project_root, authorizationId: args.authorization_id })
        : name === "head_runtime_invocation_lease_status"
          ? inspectRuntimeInvocationExecutionLease({ root: args.project_root, authorizationId: args.authorization_id })
        : name === "head_runtime_invocation_result"
          ? readRuntimeInvocationResult({ root: args.project_root, authorizationId: args.authorization_id })
        : name === "head_onboarding_status"
          ? inspectOnboarding({ root: args.project_root })
        : name === "head_feature_mapping_status"
          ? inspectFeatureMapping({ root: args.project_root })
        : name === "head_change_set_status"
          ? inspectChangeSets({ root: args.project_root })
        : name === "head_vcs_evidence"
          ? readVcsEvidence({ root: args.project_root, vcsEvidenceId: args.vcs_evidence_id })
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
                  : name === "head_incremental_refresh_status"
                    ? inspectIncrementalRefresh({ root: args.project_root })
                    : name === "head_incremental_refresh_receipt"
                      ? readIncrementalRefreshReceipt({ root: args.project_root, refreshReceiptId: args.refresh_receipt_id })
                    : name === "head_refresh_trigger_status"
                      ? inspectRefreshTriggers({ root: args.project_root })
                    : name === "head_refresh_trigger_delivery"
                      ? readRefreshTriggerDelivery({ root: args.project_root, triggerDeliveryId: args.trigger_delivery_id })
                  : name === "head_graph_projection_status"
                    ? inspectWorldGraphProjection({ root: args.project_root })
                  : name === "head_graphdb_projection_status"
                    ? inspectArcadeDbGraphProjectionStatus({ root: args.project_root })
                  : name === "head_markdown_projection_status"
                    ? inspectWorldMarkdownProjection({ root: args.project_root })
                  : name === "head_post_refresh_projection_status"
                    ? inspectPostRefreshProjectionStatus({ root: args.project_root })
                  : name === "head_post_refresh_projection_receipt"
                    ? readPostRefreshProjectionReceipt({ root: args.project_root, postRefreshProjectionReceiptId: args.post_refresh_projection_receipt_id })
                  : name === "head_document_change_candidates"
                    ? readWorldDocumentChangeCandidateSet({ root: args.project_root, candidateSetId: args.candidate_set_id })
                  : name === "head_document_change_review_status"
                    ? inspectDocumentChangeReviewStatus({ root: args.project_root, candidateSetId: args.candidate_set_id })
                  : name === "head_document_change_review"
                    ? readDocumentChangeReviewDecision({ root: args.project_root, reviewDecisionId: args.review_decision_id })
                  : name === "head_document_change_application"
                    ? readDocumentChangeApplicationReceipt({ root: args.project_root, applicationReceiptId: args.application_receipt_id })
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
                          includeUnreviewedCandidates: args.include_unreviewed_candidates ?? false,
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
                          : (() => { throw new Error(`Unknown tool: ${name}`); })());
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
