#!/usr/bin/env node
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { coreContract, inspectProject, inspectRuntimeAdapters } from "./lib/head-core.mjs";
import { compileContext, readContextCapsule } from "./lib/context-compiler.mjs";
import { readLineageArtifact } from "./lib/execution-lineage.mjs";
import { getPendingReviewContext } from "./lib/run-lineage.mjs";
import { inspectWorldGraphProjection, inspectWorldMarkdownProjection, inspectWorldModel, materializeWorldMarkdownProjection, queryWorldHistory, queryWorldModel, queryWorldRuntimeState, queryWorldTemporalGraph, readWorldDocumentChangeCandidateSet } from "./lib/world-model.mjs";
import { inspectOnboarding, reviewOnboarding } from "./lib/onboarding.mjs";
import { inspectConversationalOnboarding } from "./lib/onboarding-conversation.mjs";
import { initializeOrResumeProject } from "./lib/project-bootstrap.mjs";
import { inspectFeatureMapping } from "./lib/feature-mapping.mjs";
import { inspectChangeSets, readVcsEvidence } from "./lib/change-set.mjs";
import { inspectIncrementalRefresh, inspectPostRefreshProjectionStatus, readIncrementalRefreshReceipt, readPostRefreshProjectionReceipt } from "./lib/incremental-refresh.mjs";
import { inspectRefreshTriggers, readRefreshTriggerDelivery } from "./lib/refresh-trigger.mjs";
import { inspectDocumentChangeReviewStatus, readDocumentChangeApplicationReceipt, readDocumentChangeReviewDecision } from "./lib/document-change-review.mjs";
import { activateArcadeDbGraphProjection, inspectArcadeDbCredentialPreflight, inspectArcadeDbGraphProjectionStatus } from "./lib/graphdb-projection-activation.mjs";
import { initializeArcadeDbDatabase, inspectArcadeDbDatabaseCompatibility } from "./lib/arcadedb-database-lifecycle.mjs";
import { inspectRuntimeInvocationExecutionLease, readRuntimeInvocationAuthorization } from "./lib/runtime-invocation-lifecycle.mjs";
import { readRuntimeInvocationResult } from "./lib/runtime-run-result-application.mjs";
import { buildHeadContinuitySnapshot, inspectProductOperatingLoop, observeProductOutcome, proposeProductInitiative, recordProductHypothesis, recordProductSignal, reviewProductInitiative } from "./lib/product-operating-loop.mjs";
import fs from "node:fs";

const protocolVersion = "2024-11-05";
const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageVersion = JSON.parse(fs.readFileSync(path.join(pluginRoot, "package.json"), "utf8")).version;
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
    name: "head_onboarding_guide",
    description: "Read a compact conversation-oriented onboarding projection with the next material action, bounded evidence-linked candidates, and World/graph/document readiness. This tool never promotes candidates or mutates project state.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", minLength: 1 },
        candidate_limit: { type: "integer", minimum: 1, maximum: 200, default: 25 },
      },
      required: ["project_root"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "head_project_initialize_or_resume",
    description: "Initialize or resume exactly one HEAD project and project-scoped Session, converge managed plugin projections, and start or resume evidence-linked onboarding through the same Core transaction as the public CLI. This writes only the selected project and never contacts GraphDB.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", minLength: 1 },
        runtimes: {
          type: "array", minItems: 1, maxItems: 2, uniqueItems: true,
          items: { type: "string", enum: ["codex", "opencode"] },
        },
        mode: { type: "string", enum: ["existing", "new"], default: "existing" },
        source_scope: {
          type: "object",
          properties: {
            include_roots: { type: "array", items: { type: "string" }, default: [] },
            exclude_roots: { type: "array", items: { type: "string" }, default: [] },
          },
          additionalProperties: false,
        },
        storage: {
          type: "object",
          properties: {
            mode: { type: "string", enum: ["local", "graphdb"] },
            endpoint: { type: "string" },
            database: { type: "string" },
            username_secret_reference: { type: "string", pattern: "^[A-Z][A-Z0-9_]{2,127}$" },
            password_secret_reference: { type: "string", pattern: "^[A-Z][A-Z0-9_]{2,127}$" },
          },
          required: ["mode"],
          additionalProperties: false,
        },
        brief: {
          type: "object",
          properties: {
            schemaVersion: { type: "integer", const: 1 },
            name: { type: "string" },
            summary: { type: "string" },
            featureGroups: { type: "array", items: { type: "object" } },
            capabilities: { type: "array", items: { type: "object" } },
            features: { type: "array", items: { type: "object" } },
            requirements: { type: "array", items: { type: "object" } },
            constraints: { type: "array", items: { type: "object" } },
            decisions: { type: "array", items: { type: "object" } },
          },
          required: ["schemaVersion"],
          additionalProperties: false,
        },
      },
      required: ["project_root"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "head_onboarding_review",
    description: "Apply one explicit user-authored ReviewDecision to the exact current onboarding candidate set. Accept dispositions may change Product Canon; revise and reject preserve candidate or canon boundaries enforced by Core.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", minLength: 1 },
        candidate_set_id: { type: "string", pattern: "^onboarding-candidates-[a-f0-9]{24}$" },
        disposition: { type: "string", enum: ["accept-all", "accept-selection", "revise", "reject"] },
        accepted_candidate_ids: { type: "array", uniqueItems: true, items: { type: "string", pattern: "^onboarding-candidate-[a-f0-9]{24}$" } },
        removed_candidate_ids: { type: "array", uniqueItems: true, items: { type: "string", pattern: "^onboarding-candidate-[a-f0-9]{24}$" } },
        user_edits: {
          type: "array",
          items: {
            type: "object",
            properties: {
              candidate_id: { type: "string", pattern: "^onboarding-candidate-[a-f0-9]{24}$" },
              entity: { type: "object" },
            },
            required: ["candidate_id", "entity"],
            additionalProperties: false,
          },
        },
        added_entities: {
          type: "array",
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["FeatureGroup", "Capability", "Feature", "Requirement", "Constraint", "Decision"] },
              entity: { type: "object" },
            },
            required: ["kind", "entity"],
            additionalProperties: false,
          },
        },
        rationale: { type: "string", minLength: 1 },
      },
      required: ["project_root", "candidate_set_id", "disposition", "rationale"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "head_markdown_projection_build",
    description: "Build or verify the deterministic local Markdown projection from the current verified GraphSnapshot. The generated view is rebuildable, non-authoritative, and never changes Product Canon.",
    inputSchema: {
      type: "object",
      properties: { project_root: { type: "string", minLength: 1 } },
      required: ["project_root"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
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
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "head_graphdb_database_status",
    description: "Read a privacy-safe compatibility audit for the selected ArcadeDB database and HEAD-reserved schema without exposing the endpoint, database name, credentials, or mutation authority.",
    inputSchema: {
      type: "object",
      properties: { project_root: { type: "string", minLength: 1 } },
      required: ["project_root"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "head_graphdb_connection_preflight",
    description: "Check whether the selected GraphDB credential reference names are visible to the current plugin process without contacting the endpoint or returning credential, endpoint, or database values.",
    inputSchema: {
      type: "object",
      properties: { project_root: { type: "string", minLength: 1 } },
      required: ["project_root"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "head_graphdb_database_initialize",
    description: "After explicit user confirmation, reuse a compatible selected ArcadeDB database or create a missing one. Reset is allowed only for a proven incompatible HEAD-reserved schema and an exact selected-database confirmation. Credential values are never accepted as tool input.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", minLength: 1 },
        confirm_initialize: { type: "boolean", const: true },
        reset_incompatible: { type: "boolean", default: false },
        confirm_database: { type: "string", minLength: 1 },
      },
      required: ["project_root", "confirm_initialize"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "head_graphdb_projection_activate",
    description: "After explicit user confirmation, materialize and verify the current rebuildable GraphSnapshot in the selected compatible ArcadeDB database, then advance its pointer only after complete conformance. Credential values are resolved only from stored environment reference names.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", minLength: 1 },
        confirm_remote_write: { type: "boolean", const: true },
      },
      required: ["project_root", "confirm_remote_write"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
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
  {
    name: "head_product_signal_record",
    description: "Record an immutable observed-fact ProductSignal and rebuild the derived Product Graph without changing Product Canon.",
    inputSchema: { type: "object", properties: { project_root: { type: "string", minLength: 1 }, statement: { type: "string", minLength: 1 }, observed_at: { type: "string", format: "date-time" }, source: { type: "string" }, evidence_ids: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } } }, required: ["project_root", "statement"], additionalProperties: false },
  },
  {
    name: "head_product_hypothesis_record",
    description: "Record an immutable hypothesis linked to ProductSignals; it remains non-authoritative.",
    inputSchema: { type: "object", properties: { project_root: { type: "string", minLength: 1 }, statement: { type: "string", minLength: 1 }, rationale: { type: "string" }, signal_ids: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", pattern: "^product-signal-[a-f0-9]{24}$" } } }, required: ["project_root", "statement", "signal_ids"], additionalProperties: false },
  },
  {
    name: "head_product_initiative_propose",
    description: "Propose a Product Initiative from hypotheses with an explicit existing Feature, Feature candidate, or honest gap. It does not approve the initiative or mutate Product Canon.",
    inputSchema: { type: "object", properties: { project_root: { type: "string", minLength: 1 }, title: { type: "string", minLength: 1 }, description: { type: "string" }, hypothesis_ids: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", pattern: "^product-hypothesis-[a-f0-9]{24}$" } }, feature_resolution: { oneOf: [
      { type: "object", properties: { kind: { const: "existing-feature" }, feature_key: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" } }, required: ["kind", "feature_key"], additionalProperties: false },
      { type: "object", properties: { kind: { const: "candidate" }, feature: { type: "object", properties: { key: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" }, name: { type: "string", minLength: 1 }, description: { type: "string" }, capability_keys: { type: "array", uniqueItems: true, items: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" } } }, required: ["key", "name"], additionalProperties: false } }, required: ["kind", "feature"], additionalProperties: false },
      { type: "object", properties: { kind: { const: "gap" }, reason: { type: "string", minLength: 1 } }, required: ["kind", "reason"], additionalProperties: false },
    ] } }, required: ["project_root", "title", "hypothesis_ids", "feature_resolution"], additionalProperties: false },
  },
  {
    name: "head_product_initiative_review",
    description: "Record the user's explicit accept/reject ReviewDecision for one Product Initiative candidate. Acceptance creates a separate reviewed Initiative and never mutates Product Canon.",
    inputSchema: { type: "object", properties: { project_root: { type: "string", minLength: 1 }, initiative_candidate_id: { type: "string", pattern: "^product-initiative-candidate-[a-f0-9]{24}$" }, disposition: { type: "string", enum: ["accept", "reject"] }, rationale: { type: "string", minLength: 1 }, confirm_user_review: { type: "boolean" } }, required: ["project_root", "initiative_candidate_id", "disposition", "rationale", "confirm_user_review"], additionalProperties: false },
  },
  {
    name: "head_product_outcome_observe",
    description: "Record observed or derived outcome evidence bound to an accepted ChangeSet, ResultPacket, and execution ReviewDecision without judging success or changing Feature status.",
    inputSchema: { type: "object", properties: { project_root: { type: "string", minLength: 1 }, change_set_id: { type: "string", pattern: "^change-set-[a-f0-9]{24}$" }, initiative_id: { type: "string", pattern: "^reviewed-product-initiative-[a-f0-9]{24}$" }, statement: { type: "string", minLength: 1 }, epistemic_class: { type: "string", enum: ["observed-fact", "derived-projection"] }, evidence_ids: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } } }, required: ["project_root", "change_set_id", "statement"], additionalProperties: false },
  },
  {
    name: "head_product_operating_status",
    description: "Read the verified Product Operating Loop artifacts and their explicit authority classes.",
    inputSchema: { type: "object", properties: { project_root: { type: "string", minLength: 1 } }, required: ["project_root"], additionalProperties: false },
  },
  {
    name: "head_continuity_snapshot",
    description: "Build an on-demand non-persisted derived reference view over exact Session, Run, lineage, product, and graph identities. It is not recovery canon or HEAD judgment authority.",
    inputSchema: { type: "object", properties: { project_root: { type: "string", minLength: 1 } }, required: ["project_root"], additionalProperties: false },
  },
];

const success = (id, result) => ({ jsonrpc: "2.0", id, result });
const failure = (id, message) => ({ jsonrpc: "2.0", id, error: { code: -32000, message } });

function onboardingInputFromMcp(args) {
  const onboarding = {};
  if (args.mode != null) onboarding.mode = args.mode;
  if (args.source_scope != null) onboarding.sourceScope = {
    includeRoots: args.source_scope.include_roots || [],
    excludeRoots: args.source_scope.exclude_roots || [],
  };
  if (args.storage != null) onboarding.storage = args.storage.mode === "local" ? { mode: "local" } : {
    mode: "graphdb",
    endpoint: args.storage.endpoint,
    database: args.storage.database,
    secretReferenceNames: {
      username: args.storage.username_secret_reference,
      password: args.storage.password_secret_reference,
    },
  };
  if (args.brief != null) onboarding.brief = args.brief;
  return onboarding;
}

function productFeatureResolutionFromMcp(value) {
  if (value?.kind === "existing-feature") return { kind: value.kind, featureKey: value.feature_key };
  if (value?.kind === "candidate") return { kind: value.kind, feature: { key: value.feature?.key, name: value.feature?.name, description: value.feature?.description || "", capabilityKeys: value.feature?.capability_keys || [] } };
  return { kind: "gap", reason: value?.reason };
}

function compactReviewResult(result) {
  return {
    status: result.status,
    state: {
      phase: result.state.phase,
      stateRevision: result.state.stateRevision,
      candidateSetId: result.state.candidateSetId,
      reviewDecisionId: result.state.reviewDecisionId,
      productModelId: result.state.productModelId,
      worldModelId: result.state.worldModelId,
      sourceSnapshotId: result.state.sourceSnapshotId,
    },
    reviewDecision: result.reviewDecision ? {
      reviewDecisionId: result.reviewDecision.reviewDecisionId,
      disposition: result.reviewDecision.disposition,
      promotionAuthority: result.reviewDecision.promotionAuthority,
      resultingProductModelId: result.reviewDecision.resultingProductModelId || null,
    } : null,
    successorCandidateSet: result.candidateSet ? {
      candidateSetId: result.candidateSet.candidateSetId,
      candidateCount: result.candidateSet.candidates.length,
    } : null,
    productModelId: result.productModel?.productModelId || null,
    worldModel: result.worldModel,
    authorityEffect: result.reviewDecision?.promotionAuthority ? "explicit-product-canon-transition" : "none",
  };
}

function compactMarkdownBuild(result) {
  return {
    status: result.status,
    worldModelStatus: result.worldModelStatus,
    worldModelId: result.worldModelId,
    graphSnapshotId: result.graphSnapshotId,
    documentProjectionId: result.documentProjectionId,
    publishedPageCount: result.projection?.projection?.pages?.length || 0,
    authority: result.authority,
  };
}

function requireMcpConfirmation(value, message, code) {
  if (value === true) return;
  const error = new Error(message);
  error.code = code;
  throw error;
}

function initializeGraphDbFromMcp(args, transport) {
  requireMcpConfirmation(
    args.confirm_initialize,
    "ArcadeDB database initialization requires explicit user confirmation.",
    "ARCADEDB_DATABASE_INITIALIZE_CONFIRMATION_REQUIRED",
  );
  return initializeArcadeDbDatabase({
    root: args.project_root,
    resetIncompatible: args.reset_incompatible === true,
    confirmDatabase: args.confirm_database || "",
    transport,
  });
}

function activateGraphDbFromMcp(args, transport) {
  requireMcpConfirmation(
    args.confirm_remote_write,
    "ArcadeDB graph projection activation requires explicit user confirmation.",
    "ARCADEDB_PROJECTION_ACTIVATION_CONFIRMATION_REQUIRED",
  );
  return activateArcadeDbGraphProjection({ root: args.project_root, transport });
}

export async function dispatch(request, { graphDbTransport = null } = {}) {
  const id = request.id ?? null;
    if (request.method === "initialize") {
      return success(id, { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "head-agent-core", version: packageVersion } });
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
      : name === "head_onboarding_guide"
        ? inspectConversationalOnboarding({ root: args.project_root, candidateLimit: args.candidate_limit ?? 25 })
      : name === "head_project_initialize_or_resume"
        ? initializeOrResumeProject({
          root: args.project_root,
          pluginRoot,
          runtimes: args.runtimes || null,
          onboarding: onboardingInputFromMcp(args),
        })
      : name === "head_onboarding_review"
        ? compactReviewResult(await reviewOnboarding({
          root: args.project_root,
          candidateSetId: args.candidate_set_id,
          disposition: args.disposition,
          acceptedCandidateIds: args.accepted_candidate_ids || [],
          removedCandidateIds: args.removed_candidate_ids || [],
          userEdits: (args.user_edits || []).map((edit) => ({ candidateId: edit.candidate_id, entity: edit.entity })),
          addedEntities: args.added_entities || [],
          rationale: args.rationale,
        }))
      : name === "head_markdown_projection_build"
        ? compactMarkdownBuild(materializeWorldMarkdownProjection({ root: args.project_root }))
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
                  ? inspectArcadeDbGraphProjectionStatus({ root: args.project_root, transport: graphDbTransport })
                : name === "head_graphdb_database_status"
                  ? inspectArcadeDbDatabaseCompatibility({ root: args.project_root, transport: graphDbTransport })
                : name === "head_graphdb_connection_preflight"
                  ? inspectArcadeDbCredentialPreflight({ root: args.project_root, transport: graphDbTransport })
                : name === "head_graphdb_database_initialize"
                  ? initializeGraphDbFromMcp(args, graphDbTransport)
                : name === "head_graphdb_projection_activate"
                  ? activateGraphDbFromMcp(args, graphDbTransport)
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
                          : name === "head_product_signal_record"
                            ? recordProductSignal({ root: args.project_root, statement: args.statement, observedAt: args.observed_at, source: args.source || "", evidenceIds: args.evidence_ids || [] })
                          : name === "head_product_hypothesis_record"
                            ? recordProductHypothesis({ root: args.project_root, statement: args.statement, rationale: args.rationale || "", signalIds: args.signal_ids })
                          : name === "head_product_initiative_propose"
                            ? proposeProductInitiative({ root: args.project_root, title: args.title, description: args.description || "", hypothesisIds: args.hypothesis_ids, featureResolution: productFeatureResolutionFromMcp(args.feature_resolution) })
                          : name === "head_product_initiative_review"
                            ? (requireMcpConfirmation(args.confirm_user_review, "Product Initiative review requires explicit user confirmation.", "PRODUCT_INITIATIVE_REVIEW_CONFIRMATION_REQUIRED"), reviewProductInitiative({ root: args.project_root, initiativeCandidateId: args.initiative_candidate_id, disposition: args.disposition, rationale: args.rationale }))
                          : name === "head_product_outcome_observe"
                            ? observeProductOutcome({ root: args.project_root, changeSetId: args.change_set_id, initiativeId: args.initiative_id || "", statement: args.statement, epistemicClass: args.epistemic_class || "observed-fact", evidenceIds: args.evidence_ids || [] })
                          : name === "head_product_operating_status"
                            ? inspectProductOperatingLoop({ root: args.project_root })
                          : name === "head_continuity_snapshot"
                            ? buildHeadContinuitySnapshot({ root: args.project_root })
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
