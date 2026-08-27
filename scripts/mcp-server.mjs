#!/usr/bin/env node
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { coreContract, inspectRuntimeAdapters } from "./lib/head-core.mjs";
import { CONTEXT_BUDGET_TIERS, DEFAULT_CONTEXT_BUDGET, readContextCapsule } from "./lib/context-compiler.mjs";
import { previewContextWorkflow } from "./lib/context-workflow.mjs";
import { readLineageArtifact } from "./lib/execution-lineage.mjs";
import { getPendingReviewContext } from "./lib/run-lineage.mjs";
import { inspectWorldGraphProjection, inspectWorldMarkdownProjection, inspectWorldModelStatus, materializeWorldMarkdownProjection, queryWorldHistory, queryWorldModel, queryWorldRuntimeState, queryWorldTemporalGraph, readWorldDocumentChangeCandidateSet } from "./lib/world-model.mjs";
import { inspectOnboarding, reviewOnboarding } from "./lib/onboarding.mjs";
import { inspectConversationalOnboarding } from "./lib/onboarding-conversation.mjs";
import { initializeOrResumeProject, inspectProjectExperience } from "./lib/project-bootstrap.mjs";
import { inspectFeatureMapping } from "./lib/feature-mapping.mjs";
import { inspectChangeSets, readVcsEvidence } from "./lib/change-set.mjs";
import { inspectIncrementalRefresh, inspectPostRefreshProjectionStatus, readIncrementalRefreshReceipt, readPostRefreshProjectionReceipt } from "./lib/incremental-refresh.mjs";
import { inspectRefreshTriggers, readRefreshTriggerDelivery } from "./lib/refresh-trigger.mjs";
import { inspectDocumentChangeReviewStatus, readDocumentChangeApplicationReceipt, readDocumentChangeReviewDecision } from "./lib/document-change-review.mjs";
import { activateArcadeDbGraphProjection, inspectArcadeDbCredentialPreflight, inspectArcadeDbGraphProjectionStatus } from "./lib/graphdb-projection-activation.mjs";
import { initializeArcadeDbDatabase, inspectArcadeDbDatabaseCompatibility } from "./lib/arcadedb-database-lifecycle.mjs";
import { inspectRuntimeInvocationExecutionLease, readRuntimeInvocationAuthorization } from "./lib/runtime-invocation-lifecycle.mjs";
import { readRuntimeInvocationResult } from "./lib/runtime-run-result-application.mjs";
import { buildHeadContinuitySnapshot, inspectProductOperatingLoop, observeProductOutcome, prepareProductLearningNote, proposeProductInitiative, recordProductHypothesis, recordProductSignal, reviewProductInitiative } from "./lib/product-operating-loop.mjs";
import { recommendOperatingLane } from "./lib/operating-lane.mjs";
import { abortCompaction, continueCompaction, inspectCompaction, prepareCompaction, verifyCompaction } from "./lib/compaction-recovery.mjs";
import { integrateReviewedRunCheckpoint, readRunResultIntegration, restoreSessionFromArtifacts } from "./lib/session-recovery.mjs";
import { attachCoordinationWorkspaceHost, COORDINATION_BINDING_ENV, createCoordinationWorkspaceHostDeliveryAdapter, replyCoordinationMessage, sendCoordinationMessage, waitForCoordinationInbox, waitForCoordinationReply } from "./lib/role-coordination.mjs";
import { continueSessionFromArtifacts } from "./lib/runtime-session-continuation.mjs";
import {
  applyBoundedWorkerDispatchResult,
  createBoundedWorkerDispatch,
  readBoundedWorkerDispatch,
  waitForBoundedWorkerDispatch,
} from "./lib/bounded-worker-dispatch.mjs";
import {
  abandonBoundedWorkerWave,
  createBoundedWorkerWave,
  readBoundedWorkerWave,
  readBoundedWorkerWaveResults,
  readBoundedWorkerWaveStatus,
  sealBoundedWorkerWave,
  waitForBoundedWorkerWave,
} from "./lib/bounded-worker-wave.mjs";
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
    description: "Read a bounded Core/Product readiness, next-action, capability, and Session/Run projection without modifying the project or activating any capability.",
    inputSchema: {
      type: "object",
      properties: { project_root: { type: "string", minLength: 1 } },
      required: ["project_root"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
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
    description: "Initialize or resume exactly one HEAD project and project-scoped Session, converge managed plugin projections, and optionally activate evidence-linked Product onboarding only through the explicit product profile. Core is the default. This writes only the selected project and never contacts GraphDB.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", minLength: 1 },
        profile: { type: "string", enum: ["core", "product"], default: "core" },
        runtimes: {
          type: "array", minItems: 1, maxItems: 3, uniqueItems: true,
          items: { type: "string", enum: ["claude", "codex", "opencode"] },
        },
        mode: { type: "string", enum: ["existing", "new"] },
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
    description: "Preview a deterministic Context Capsule plus a read-only World→EvidenceNeed→coverage→budget→HEAD-assessment workflow. It automatically retries fixed tiers up to 512K only for proven context-budget exclusion; it writes nothing, never invents EvidenceNeeds, and never judges semantic sufficiency.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", minLength: 1 },
        task: { type: "string", minLength: 1 },
        budget: { type: "integer", enum: CONTEXT_BUDGET_TIERS, default: DEFAULT_CONTEXT_BUDGET, description: "Starting approximate-token tier for read-only preview. Matching evidence excluded by context-budget triggers deterministic retries through fixed tiers up to the 524288 hard maximum." },
        evidence_needs: {
          type: "array",
          maxItems: 32,
          description: "Task-local evidence requirements chosen by HEAD. The Compiler checks actual inclusion only; it does not infer requirements or judge semantic sufficiency.",
          items: {
            type: "object",
            properties: {
              id: { type: "string", pattern: "^[a-z0-9][a-z0-9._-]{0,63}$" },
              kind: { type: "string", enum: ["claim", "decision", "git-decision", "product-context", "repository-file", "repository-source", "repository-test", "runtime-state", "semantic-relation", "temporal-relation", "unknown"] },
              facets: { type: "array", maxItems: 16, items: { type: "string", minLength: 1 } },
              relationTypes: { type: "array", maxItems: 16, items: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_]{0,63}$" } },
              minimumItems: { type: "integer", minimum: 1, maximum: 20, default: 1 },
              rationale: { type: "string", maxLength: 500 }
            },
            required: ["id", "kind"],
            additionalProperties: false
          }
        }
      },
      required: ["project_root", "task"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
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
    name: "head_session_restore",
    description: "Reconstruct the exact current Project/Session/Run consumer input from the canonical SessionRunCheckpoint and verified artifacts. This derived view never resumes or depends on a provider session.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", minLength: 1 },
        checkpoint_id: { type: "string", pattern: "^checkpoint-[a-f0-9]{24}$" },
      },
      required: ["project_root"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "head_session_continue",
    description: "Restore the canonical P2 SessionRunCheckpoint first, then optionally verify the exact current live HEAD attachment through the host-injected P5 adapter. Failure falls back to a disclosed fresh logical HEAD and never imports provider session identity.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", minLength: 1 },
        runtime: { type: "string", enum: ["claude", "codex", "opencode"] },
        checkpoint_id: { type: "string", pattern: "^checkpoint-[a-f0-9]{24}$" },
      },
      required: ["project_root", "runtime"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "head_bounded_worker_dispatch",
    description: "Create or verify one P3 non-HEAD worker ownership record bound to an exact current Run ExecutionAuthorization. This cannot change WholePlan, recovery direction, or review state.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", minLength: 1 },
        authorization_id: { type: "string", pattern: "^execution-authorization-[a-f0-9]{24}$" },
        role: { type: "string", enum: ["developer", "coder", "reviewer"] },
      },
      required: ["project_root", "authorization_id", "role"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "head_bounded_worker_status",
    description: "Read and verify one P3 bounded worker dispatch without consuming its authorization.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", minLength: 1 },
        authorization_id: { type: "string", pattern: "^execution-authorization-[a-f0-9]{24}$" },
      },
      required: ["project_root", "authorization_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "head_bounded_worker_wait",
    description: "Boundedly observe one worker's operational P5 lease/result state. The returned cursor is non-persisted and cannot create a ReviewDecision or recovery direction.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", minLength: 1 },
        authorization_id: { type: "string", pattern: "^execution-authorization-[a-f0-9]{24}$" },
        wait_timeout_ms: { type: "integer", minimum: 0, maximum: 600000, default: 0 },
      },
      required: ["project_root", "authorization_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "head_bounded_worker_apply_result",
    description: "Map one completed, actual-provider, native-supervised bounded-worker draft into the canonical ResultPacket and Fresh HEAD review context. This does not create a ReviewDecision or integrate checkpoint direction.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", minLength: 1 },
        authorization_id: { type: "string", pattern: "^execution-authorization-[a-f0-9]{24}$" },
      },
      required: ["project_root", "authorization_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "head_bounded_worker_wave_create",
    description: "Create one P3 grouping over 2-64 already-created bounded worker dispatches sharing the exact current Project/HEAD Session/Run/WholePlan/ExecutionContract/ContextCapsule lineage. It creates no authorization and widens no member scope.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", minLength: 1 },
        authorization_ids: { type: "array", minItems: 2, maxItems: 64, uniqueItems: true, items: { type: "string", pattern: "^execution-authorization-[a-f0-9]{24}$" } },
      },
      required: ["project_root", "authorization_ids"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "head_bounded_worker_wave_read",
    description: "Read and reverify one P3 worker wave, every member dispatch, current P2 lineage, and any create-only seal or abandonment evidence. This read cannot seal the wave.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", minLength: 1 },
        wave_id: { type: "string", pattern: "^bounded-worker-wave-[a-f0-9]{24}$" },
      },
      required: ["project_root", "wave_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "head_bounded_worker_wave_seal",
    description: "Create one P3 wave seal only after every independent member authorization has verified at-most-once lease consumption. A seal is not completion, review, or checkpoint integration.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", minLength: 1 },
        wave_id: { type: "string", pattern: "^bounded-worker-wave-[a-f0-9]{24}$" },
      },
      required: ["project_root", "wave_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "head_bounded_worker_wave_status",
    description: "Return one non-persisted P4 requested/started/returned/waiting/succeeded/failed projection. Status is observational and cannot create a seal, ReviewDecision, or recovery direction.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", minLength: 1 },
        wave_id: { type: "string", pattern: "^bounded-worker-wave-[a-f0-9]{24}$" },
      },
      required: ["project_root", "wave_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "head_bounded_worker_wave_results",
    description: "Read one non-persisted P4 aggregate of member result references after an explicit verified wave seal. It never applies ResultPackets or creates Fresh HEAD review.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", minLength: 1 },
        wave_id: { type: "string", pattern: "^bounded-worker-wave-[a-f0-9]{24}$" },
      },
      required: ["project_root", "wave_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "head_bounded_worker_wave_wait",
    description: "Boundedly observe one sealed wave as a non-persisted P5 outcome. Open or abandoned waves fail closed, and completion requires every member to succeed.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", minLength: 1 },
        wave_id: { type: "string", pattern: "^bounded-worker-wave-[a-f0-9]{24}$" },
        wait_timeout_ms: { type: "integer", minimum: 0, maximum: 600000, default: 0 },
      },
      required: ["project_root", "wave_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "head_bounded_worker_wave_abandon",
    description: "Create one P3 non-success abandoned handoff for an unsealed wave using a bounded reason code and non-authoritative sanitized summary. This cannot create review or recovery direction.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", minLength: 1 },
        wave_id: { type: "string", pattern: "^bounded-worker-wave-[a-f0-9]{24}$" },
        reason_code: { type: "string", enum: ["partial-launch", "lineage-drift", "operator-stop", "unrecoverable-member", "other"] },
        reason_summary: { type: "string", maxLength: 256, default: "" },
      },
      required: ["project_root", "wave_id", "reason_code"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "head_run_integrate_checkpoint",
    description: "After an exact accepted Fresh HEAD ReviewDecision, bind one reviewed Run result to one canonical recovery checkpoint. ResultPacket evidence cannot author checkpoint direction and no ReviewDecision is created here.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", minLength: 1 },
        run_id: { type: "string", pattern: "^run-[0-9]+-[a-f0-9]{6}$" },
        review_decision_id: { type: "string", pattern: "^review-decision-[a-f0-9]{24}$" },
        purpose: { type: "string", minLength: 1 },
        approved_decisions: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } },
        current_position: { type: "string", minLength: 1 },
        next_expected_result: { type: "string", minLength: 1 },
        open_review_ids: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } },
      },
      required: ["project_root", "run_id", "review_decision_id", "purpose", "approved_decisions", "current_position", "next_expected_result"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "head_run_integration",
    description: "Read and digest-verify the one-shot Run result integration receipt and its canonical recovery checkpoint.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", minLength: 1 },
        review_decision_id: { type: "string", pattern: "^review-decision-[a-f0-9]{24}$" },
      },
      required: ["project_root", "review_decision_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "head_world_model",
    description: "Completely freshness-check and digest-verify the current Repository World Model, then return a bounded read-only status projection with identities, counts, samples, and omission metadata.",
    inputSchema: {
      type: "object",
      properties: { project_root: { type: "string", minLength: 1 } },
      required: ["project_root"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
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
    name: "head_operating_lane_recommend",
    description: "Recommend the lightest safe Observe, Session, Run, or Authority lane without creating authority or project artifacts.",
    inputSchema: { type: "object", properties: {
      project_root: { type: "string", minLength: 1 }, intent: { type: "string", enum: ["observe", "execute"], default: "observe" }, workspace_effect: { type: "string", enum: ["none", "reversible", "consequential"], default: "none" }, dependency_count: { type: "integer", minimum: 0, maximum: 32, default: 0 },
      provider_invocation: { type: "boolean", default: false }, handoff: { type: "boolean", default: false }, context_replacement: { type: "boolean", default: false }, independent_review: { type: "boolean", default: false }, failure_branches: { type: "boolean", default: false }, human_decision_during_execution: { type: "boolean", default: false }, irreversible: { type: "boolean", default: false }, external_write: { type: "boolean", default: false }, uses_credentials: { type: "boolean", default: false }, product_canon_mutation: { type: "boolean", default: false }, product_initiative_decision: { type: "boolean", default: false }, recovery_checkpoint_replacement: { type: "boolean", default: false },
    }, required: ["project_root"], additionalProperties: false },
  },
  {
    name: "head_coordination_send_message",
    description: "Send one durable project/HEAD-Session/generation-fenced role message. Sender role is derived only from the host-injected endpoint binding; the message has no instruction, decision, review, execution-authorization, promotion, or Canon authority.",
    inputSchema: { type: "object", properties: {
      project_root: { type: "string", minLength: 1 }, to_role: { type: "string", pattern: "^[a-z][a-z0-9-]{0,63}$" }, content: { type: "string", minLength: 1, maxLength: 32768 }, evidence_ids: { type: "array", maxItems: 64, uniqueItems: true, items: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" } }, idempotency_key: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" }, lane: { type: "string", enum: ["observe", "session", "run", "authority"], default: "session" },
    }, required: ["project_root", "to_role", "content", "idempotency_key"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "head_coordination_read_inbox",
    description: "Read or boundedly wait for the inbox of the host-bound role and record host-local read markers. Caller role cannot be supplied by tool arguments.",
    inputSchema: { type: "object", properties: { project_root: { type: "string", minLength: 1 }, unread_only: { type: "boolean", default: true }, wait_timeout_ms: { type: "integer", minimum: 0, maximum: 600000, default: 0 } }, required: ["project_root"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "head_coordination_wait_reply",
    description: "Boundedly read an immutable reply to one message sent by the host-bound role. Reply observation is separate from delivery acknowledgement and grants no authority.",
    inputSchema: { type: "object", properties: { project_root: { type: "string", minLength: 1 }, message_id: { type: "string", pattern: "^coord-message-[a-f0-9]{32}$" }, wait_timeout_ms: { type: "integer", minimum: 0, maximum: 600000, default: 0 } }, required: ["project_root", "message_id"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "head_coordination_reply_message",
    description: "Write one immutable reply as the host-bound role. The reply is coordination evidence only and cannot approve a ReviewDecision, ExecutionContract, or Product Canon change.",
    inputSchema: { type: "object", properties: { project_root: { type: "string", minLength: 1 }, in_reply_to: { type: "string", pattern: "^coord-message-[a-f0-9]{32}$" }, content: { type: "string", minLength: 1, maxLength: 32768 } }, required: ["project_root", "in_reply_to", "content"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "head_compact_prepare",
    description: "Create the canonical Session/Run recovery checkpoint and one bounded compaction epoch. This does not invoke a provider or treat a provider summary as recovery authority.",
    inputSchema: { type: "object", properties: {
      project_root: { type: "string", minLength: 1 }, runtime: { type: "string", enum: ["manual", "claude", "codex", "opencode"], default: "manual" }, user_turn_id_at_prepare: { type: "integer", minimum: 0 }, purpose: { type: "string", minLength: 1 }, approved_decisions: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } }, current_position: { type: "string", minLength: 1 }, next_expected_result: { type: "string", minLength: 1 }, open_review_ids: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } },
    }, required: ["project_root", "user_turn_id_at_prepare", "purpose", "approved_decisions", "current_position", "next_expected_result"], additionalProperties: false },
  },
  {
    name: "head_compact_verify",
    description: "Verify provider compaction against the exact canonical checkpoint. Provider transcripts, summaries, session identities, and HEADContinuitySnapshot are rejected as recovery sources.",
    inputSchema: { type: "object", properties: { project_root: { type: "string", minLength: 1 }, epoch_id: { type: "string", pattern: "^compaction-epoch-[a-f0-9-]{36}$" }, checkpoint_digest: { type: "string", pattern: "^[a-f0-9]{64}$" }, current_user_turn_id: { type: "integer", minimum: 0 }, provider_compacted: { type: "boolean" }, recovery_source: { type: "string", enum: ["canonical-checkpoint"] } }, required: ["project_root", "epoch_id", "checkpoint_digest", "current_user_turn_id", "provider_compacted"], additionalProperties: false },
  },
  {
    name: "head_compact_continue",
    description: "Consume a verified compaction continuation token at most once and return the checkpoint-bound continuation instruction. A newer real user turn supersedes it.",
    inputSchema: { type: "object", properties: { project_root: { type: "string", minLength: 1 }, epoch_id: { type: "string", pattern: "^compaction-epoch-[a-f0-9-]{36}$" }, continuation_token: { type: "string", minLength: 32 }, current_user_turn_id: { type: "integer", minimum: 0 } }, required: ["project_root", "epoch_id", "continuation_token", "current_user_turn_id"], additionalProperties: false },
  },
  {
    name: "head_compact_status",
    description: "Read the current compaction epoch and digest-verified Session/Run checkpoint without disclosing the continuation token.",
    inputSchema: { type: "object", properties: { project_root: { type: "string", minLength: 1 } }, required: ["project_root"], additionalProperties: false },
  },
  {
    name: "head_compact_abort",
    description: "Abort one open compaction epoch without changing its canonical Session/Run checkpoint or Product Canon.",
    inputSchema: { type: "object", properties: { project_root: { type: "string", minLength: 1 }, epoch_id: { type: "string", pattern: "^compaction-epoch-[a-f0-9-]{36}$" }, reason: { type: "string", minLength: 1 } }, required: ["project_root", "epoch_id", "reason"], additionalProperties: false },
  },
  {
    name: "head_product_note",
    description: "Prepare a non-persisted epistemically typed product-learning note. It receives no content identity and does not rebuild the World Model.",
    inputSchema: { type: "object", properties: { project_root: { type: "string", minLength: 1 }, statement: { type: "string", minLength: 1 }, epistemic_class: { type: "string", enum: ["observed-fact", "hypothesis", "inferred-meaning"] }, source: { type: "string" }, rationale: { type: "string" }, evidence_ids: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } }, referenced_by_another_run: { type: "boolean", default: false }, needs_rebuttal: { type: "boolean", default: false }, affects_product_state: { type: "boolean", default: false }, handoff: { type: "boolean", default: false } }, required: ["project_root", "statement", "epistemic_class"], additionalProperties: false },
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
    description: "Propose a Product Initiative from persisted hypotheses or inline reasoning. Feature resolution may be deferred to explicit review; proposal never approves the initiative or mutates Product Canon.",
    inputSchema: { type: "object", properties: { project_root: { type: "string", minLength: 1 }, title: { type: "string", minLength: 1 }, description: { type: "string" }, reasoning: { type: "string" }, hypothesis_ids: { type: "array", uniqueItems: true, items: { type: "string", pattern: "^product-hypothesis-[a-f0-9]{24}$" } }, feature_resolution: { oneOf: [
      { type: "object", properties: { kind: { const: "existing-feature" }, feature_key: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" } }, required: ["kind", "feature_key"], additionalProperties: false },
      { type: "object", properties: { kind: { const: "candidate" }, feature: { type: "object", properties: { key: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" }, name: { type: "string", minLength: 1 }, description: { type: "string" }, capability_keys: { type: "array", uniqueItems: true, items: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" } } }, required: ["key", "name"], additionalProperties: false } }, required: ["kind", "feature"], additionalProperties: false },
      { type: "object", properties: { kind: { const: "gap" }, reason: { type: "string", minLength: 1 } }, required: ["kind", "reason"], additionalProperties: false },
    ] } }, required: ["project_root", "title"], additionalProperties: false },
  },
  {
    name: "head_product_initiative_review",
    description: "Record the user's explicit accept/reject ReviewDecision for one Product Initiative candidate. Acceptance resolves any deferred Feature mapping, creates a separate reviewed Initiative, and never mutates Product Canon.",
    inputSchema: { type: "object", properties: { project_root: { type: "string", minLength: 1 }, initiative_candidate_id: { type: "string", pattern: "^product-initiative-candidate-[a-f0-9]{24}$" }, disposition: { type: "string", enum: ["accept", "reject"] }, rationale: { type: "string", minLength: 1 }, confirm_user_review: { type: "boolean" }, feature_resolution: { oneOf: [
      { type: "object", properties: { kind: { const: "existing-feature" }, feature_key: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" } }, required: ["kind", "feature_key"], additionalProperties: false },
      { type: "object", properties: { kind: { const: "candidate" }, feature: { type: "object", properties: { key: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" }, name: { type: "string", minLength: 1 }, description: { type: "string" }, capability_keys: { type: "array", uniqueItems: true, items: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" } } }, required: ["key", "name"], additionalProperties: false } }, required: ["kind", "feature"], additionalProperties: false },
      { type: "object", properties: { kind: { const: "gap" }, reason: { type: "string", minLength: 1 } }, required: ["kind", "reason"], additionalProperties: false },
    ] } }, required: ["project_root", "initiative_candidate_id", "disposition", "rationale", "confirm_user_review"], additionalProperties: false },
  },
  {
    name: "head_product_outcome_observe",
    description: "Record observed or derived outcome evidence bound to an accepted ChangeSet, ResultPacket, and execution ReviewDecision without judging success or changing Feature status.",
    inputSchema: { type: "object", properties: { project_root: { type: "string", minLength: 1 }, change_set_id: { type: "string", pattern: "^change-set-[a-f0-9]{24}$" }, initiative_id: { type: "string", pattern: "^reviewed-product-initiative-[a-f0-9]{24}$" }, statement: { type: "string", minLength: 1 }, epistemic_class: { type: "string", enum: ["observed-fact", "derived-projection"] }, evidence_ids: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } } }, required: ["project_root", "change_set_id", "statement"], additionalProperties: false },
  },
  {
    name: "head_product_operating_status",
    description: "Read Product Operating Loop artifacts and authority classes, reusing a disclosed write-invalidated verified-snapshot cache unless fresh verification is requested.",
    inputSchema: { type: "object", properties: { project_root: { type: "string", minLength: 1 }, fresh: { type: "boolean", default: false } }, required: ["project_root"], additionalProperties: false },
  },
  {
    name: "head_continuity_snapshot",
    description: "Build an on-demand non-persisted derived reference view over exact Session, Run, lineage, product, and graph identities, with optional forced fresh verification. It is not recovery canon or HEAD judgment authority.",
    inputSchema: { type: "object", properties: { project_root: { type: "string", minLength: 1 }, fresh: { type: "boolean", default: false } }, required: ["project_root"], additionalProperties: false },
  },
];

const success = (id, result) => ({ jsonrpc: "2.0", id, result });
const failure = (id, message) => ({ jsonrpc: "2.0", id, error: { code: -32000, message } });
export const WORLD_MODEL_STATUS_MCP_MAX_BYTES = 4 * 1024 * 1024;

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
  const latestReviewDecisionId = result.state.latestReviewDecisionId ?? result.state.reviewDecisionId ?? null;
  return {
    status: result.status,
    state: {
      phase: result.state.phase,
      stateRevision: result.state.stateRevision,
      candidateSetId: result.state.candidateSetId,
      latestReviewDecisionId,
      reviewDecisionId: latestReviewDecisionId,
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
    publishedPageCount: result.projection?.projection?.documents?.length || 0,
    authority: result.authority,
  };
}

function requireMcpConfirmation(value, message, code) {
  if (value === true) return;
  const error = new Error(message);
  error.code = code;
  throw error;
}

function mcpCoordinationBindingToken() {
  const token = String(process.env[COORDINATION_BINDING_ENV] || "").trim();
  if (token) return token;
  const error = new Error(`Role coordination requires a trusted host-injected ${COORDINATION_BINDING_ENV} endpoint binding.`);
  error.code = "COORDINATION_BINDING_REQUIRED";
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

function coordinationHostCall({ root, bindingToken, coordinationWorkspaceHost }) {
  if (!coordinationWorkspaceHost) return null;
  if (coordinationWorkspaceHost.projectRoot) {
    const requested = fs.realpathSync(path.resolve(root));
    const injected = fs.realpathSync(path.resolve(coordinationWorkspaceHost.projectRoot));
    if (requested !== injected) {
      const error = new Error("The host-injected coordination project does not match the requested project.");
      error.code = "COORDINATION_HOST_PROJECT_MISMATCH";
      throw error;
    }
  }
  attachCoordinationWorkspaceHost({
    root,
    bindingToken,
    workspaceHostAdapter: coordinationWorkspaceHost.adapter,
    caller: coordinationWorkspaceHost.caller,
  });
  return createCoordinationWorkspaceHostDeliveryAdapter({
    root,
    workspaceHostAdapter: coordinationWorkspaceHost.adapter,
  });
}

function continueSessionFromMcp(args, coordinationWorkspaceHost) {
  const bindingToken = String(process.env[COORDINATION_BINDING_ENV] || "").trim() || null;
  if (bindingToken && coordinationWorkspaceHost) {
    coordinationHostCall({ root: args.project_root, bindingToken, coordinationWorkspaceHost });
  }
  return continueSessionFromArtifacts({
    root: args.project_root,
    checkpointId: args.checkpoint_id || null,
    runtime: args.runtime,
    bindingToken,
    workspaceHostAdapter: bindingToken && coordinationWorkspaceHost ? coordinationWorkspaceHost.adapter : null,
  });
}

export async function dispatch(request, { graphDbTransport = null, coordinationWorkspaceHost = null } = {}) {
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
        ? inspectProjectExperience({ root: args.project_root })
      : name === "head_onboarding_guide"
        ? inspectConversationalOnboarding({ root: args.project_root, candidateLimit: args.candidate_limit ?? 25 })
      : name === "head_project_initialize_or_resume"
        ? initializeOrResumeProject({
          root: args.project_root,
          pluginRoot,
          runtimes: args.runtimes || null,
          profile: args.profile || "core",
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
          ? previewContextWorkflow({ root: args.project_root, task: args.task, budget: args.budget ?? DEFAULT_CONTEXT_BUDGET, evidenceNeeds: args.evidence_needs || [] })
          : name === "head_context_capsule"
            ? readContextCapsule({ root: args.project_root, capsuleId: args.capsule_id })
            : name === "head_lineage_artifact"
              ? readLineageArtifact({ root: args.project_root, artifactId: args.artifact_id })
              : name === "head_pending_review"
                ? getPendingReviewContext({ root: args.project_root })
                : name === "head_session_restore"
                  ? restoreSessionFromArtifacts({ root: args.project_root, checkpointId: args.checkpoint_id || null })
                  : name === "head_session_continue"
                    ? continueSessionFromMcp(args, coordinationWorkspaceHost)
                  : name === "head_bounded_worker_dispatch"
                    ? createBoundedWorkerDispatch({ root: args.project_root, authorizationId: args.authorization_id, role: args.role })
                  : name === "head_bounded_worker_status"
                    ? readBoundedWorkerDispatch({ root: args.project_root, authorizationId: args.authorization_id })
                  : name === "head_bounded_worker_wait"
                    ? await waitForBoundedWorkerDispatch({ root: args.project_root, authorizationId: args.authorization_id, timeoutMs: args.wait_timeout_ms ?? 0 })
                  : name === "head_bounded_worker_apply_result"
                    ? applyBoundedWorkerDispatchResult({ root: args.project_root, authorizationId: args.authorization_id })
                  : name === "head_bounded_worker_wave_create"
                    ? createBoundedWorkerWave({ root: args.project_root, authorizationIds: args.authorization_ids })
                  : name === "head_bounded_worker_wave_read"
                    ? readBoundedWorkerWave({ root: args.project_root, waveId: args.wave_id })
                  : name === "head_bounded_worker_wave_seal"
                    ? sealBoundedWorkerWave({ root: args.project_root, waveId: args.wave_id })
                  : name === "head_bounded_worker_wave_status"
                    ? readBoundedWorkerWaveStatus({ root: args.project_root, waveId: args.wave_id })
                  : name === "head_bounded_worker_wave_results"
                    ? readBoundedWorkerWaveResults({ root: args.project_root, waveId: args.wave_id })
                  : name === "head_bounded_worker_wave_wait"
                    ? await waitForBoundedWorkerWave({ root: args.project_root, waveId: args.wave_id, timeoutMs: args.wait_timeout_ms ?? 0 })
                  : name === "head_bounded_worker_wave_abandon"
                    ? abandonBoundedWorkerWave({ root: args.project_root, waveId: args.wave_id, reasonCode: args.reason_code, reasonSummary: args.reason_summary || "" })
                  : name === "head_run_integrate_checkpoint"
                    ? integrateReviewedRunCheckpoint({
                        root: args.project_root,
                        runId: args.run_id,
                        reviewDecisionId: args.review_decision_id,
                        purpose: args.purpose,
                        approvedDecisions: args.approved_decisions,
                        currentPosition: args.current_position,
                        nextExpectedResult: args.next_expected_result,
                        openReviewIds: args.open_review_ids || [],
                      })
                    : name === "head_run_integration"
                      ? readRunResultIntegration({ root: args.project_root, reviewDecisionId: args.review_decision_id })
                : name === "head_world_model"
                  ? inspectWorldModelStatus({ root: args.project_root })
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
                          : name === "head_operating_lane_recommend"
                            ? recommendOperatingLane({ root: args.project_root, intent: args.intent, workspaceEffect: args.workspace_effect, dependencyCount: args.dependency_count, providerInvocation: args.provider_invocation, handoff: args.handoff, contextReplacement: args.context_replacement, independentReview: args.independent_review, failureBranches: args.failure_branches, humanDecisionDuringExecution: args.human_decision_during_execution, irreversible: args.irreversible, externalWrite: args.external_write, usesCredentials: args.uses_credentials, productCanonMutation: args.product_canon_mutation, productInitiativeDecision: args.product_initiative_decision, recoveryCheckpointReplacement: args.recovery_checkpoint_replacement })
                          : name === "head_coordination_send_message"
                            ? (() => { const bindingToken = mcpCoordinationBindingToken(); return sendCoordinationMessage({ root: args.project_root, bindingToken, toRole: args.to_role, content: args.content, evidenceIds: args.evidence_ids || [], idempotencyKey: args.idempotency_key, lane: args.lane || "session", deliveryAdapter: coordinationHostCall({ root: args.project_root, bindingToken, coordinationWorkspaceHost }) }); })()
                          : name === "head_coordination_read_inbox"
                            ? (() => { const bindingToken = mcpCoordinationBindingToken(); coordinationHostCall({ root: args.project_root, bindingToken, coordinationWorkspaceHost }); return waitForCoordinationInbox({ root: args.project_root, bindingToken, unreadOnly: args.unread_only ?? true, timeoutMs: args.wait_timeout_ms ?? 0 }); })()
                          : name === "head_coordination_wait_reply"
                            ? (() => { const bindingToken = mcpCoordinationBindingToken(); coordinationHostCall({ root: args.project_root, bindingToken, coordinationWorkspaceHost }); return waitForCoordinationReply({ root: args.project_root, bindingToken, messageId: args.message_id, timeoutMs: args.wait_timeout_ms ?? 0 }); })()
                          : name === "head_coordination_reply_message"
                            ? (() => { const bindingToken = mcpCoordinationBindingToken(); coordinationHostCall({ root: args.project_root, bindingToken, coordinationWorkspaceHost }); return replyCoordinationMessage({ root: args.project_root, bindingToken, inReplyTo: args.in_reply_to, content: args.content }); })()
                          : name === "head_compact_prepare"
                            ? prepareCompaction({ root: args.project_root, runtime: args.runtime || "manual", userTurnIdAtPrepare: args.user_turn_id_at_prepare, purpose: args.purpose, approvedDecisions: args.approved_decisions, currentPosition: args.current_position, nextExpectedResult: args.next_expected_result, openReviewIds: args.open_review_ids || [] })
                          : name === "head_compact_verify"
                            ? verifyCompaction({ root: args.project_root, epochId: args.epoch_id, checkpointDigest: args.checkpoint_digest, currentUserTurnId: args.current_user_turn_id, providerCompacted: args.provider_compacted, recoverySource: args.recovery_source || "canonical-checkpoint" })
                          : name === "head_compact_continue"
                            ? continueCompaction({ root: args.project_root, epochId: args.epoch_id, continuationToken: args.continuation_token, currentUserTurnId: args.current_user_turn_id })
                          : name === "head_compact_status"
                            ? inspectCompaction({ root: args.project_root })
                          : name === "head_compact_abort"
                            ? abortCompaction({ root: args.project_root, epochId: args.epoch_id, reason: args.reason })
                          : name === "head_product_note"
                            ? prepareProductLearningNote({ root: args.project_root, statement: args.statement, epistemicClass: args.epistemic_class, source: args.source || "", rationale: args.rationale || "", evidenceIds: args.evidence_ids || [], referencedByAnotherRun: args.referenced_by_another_run ?? false, needsRebuttal: args.needs_rebuttal ?? false, affectsProductState: args.affects_product_state ?? false, handoff: args.handoff ?? false })
                          : name === "head_product_signal_record"
                            ? recordProductSignal({ root: args.project_root, statement: args.statement, observedAt: args.observed_at, source: args.source || "", evidenceIds: args.evidence_ids || [] })
                          : name === "head_product_hypothesis_record"
                            ? recordProductHypothesis({ root: args.project_root, statement: args.statement, rationale: args.rationale || "", signalIds: args.signal_ids })
                          : name === "head_product_initiative_propose"
                            ? proposeProductInitiative({ root: args.project_root, title: args.title, description: args.description || "", reasoning: args.reasoning || "", hypothesisIds: args.hypothesis_ids || [], featureResolution: args.feature_resolution == null ? null : productFeatureResolutionFromMcp(args.feature_resolution) })
                          : name === "head_product_initiative_review"
                            ? (requireMcpConfirmation(args.confirm_user_review, "Product Initiative review requires explicit user confirmation.", "PRODUCT_INITIATIVE_REVIEW_CONFIRMATION_REQUIRED"), reviewProductInitiative({ root: args.project_root, initiativeCandidateId: args.initiative_candidate_id, disposition: args.disposition, rationale: args.rationale, featureResolution: args.feature_resolution == null ? null : productFeatureResolutionFromMcp(args.feature_resolution) }))
                          : name === "head_product_outcome_observe"
                            ? observeProductOutcome({ root: args.project_root, changeSetId: args.change_set_id, initiativeId: args.initiative_id || "", statement: args.statement, epistemicClass: args.epistemic_class || "observed-fact", evidenceIds: args.evidence_ids || [] })
                          : name === "head_product_operating_status"
                            ? inspectProductOperatingLoop({ root: args.project_root, fresh: args.fresh ?? false })
                          : name === "head_continuity_snapshot"
                            ? buildHeadContinuitySnapshot({ root: args.project_root, fresh: args.fresh ?? false })
                          : (() => { throw new Error(`Unknown tool: ${name}`); })());
    const response = success(id, { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value });
    if (name === "head_world_model" && Buffer.byteLength(JSON.stringify(response), "utf8") > WORLD_MODEL_STATUS_MCP_MAX_BYTES) {
      throw new Error(`head_world_model response exceeds ${WORLD_MODEL_STATUS_MCP_MAX_BYTES} bytes.`);
    }
    return response;
  } catch (error) {
    return failure(id, error.message);
  }
}

export function serveMcp({ coordinationWorkspaceHost = null } = {}) {
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on("line", async (line) => {
    if (!line.trim()) return;
    let response;
    try { response = await dispatch(JSON.parse(line), { coordinationWorkspaceHost }); }
    catch (error) { response = failure(null, `Parse error: ${error.message}`); }
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  });
  return input;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) serveMcp();
