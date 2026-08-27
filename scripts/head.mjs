#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectProject, inspectRuntimeAdapters } from "./lib/head-core.mjs";
import { compileContext, DEFAULT_CONTEXT_BUDGET, readContextCapsule } from "./lib/context-compiler.mjs";
import { previewContextWorkflow } from "./lib/context-workflow.mjs";
import { createExecutionContract, createNextWholePlanSnapshot, createWholePlanSnapshot, readLineageArtifact } from "./lib/execution-lineage.mjs";
import { GitLogFileHistoryAdapter } from "./lib/git-history.mjs";
import { RuntimeStateFileAdapter } from "./lib/runtime-state.mjs";
import { finishRun, getPendingReviewContext, reviewRun, startRun } from "./lib/run-lineage.mjs";
import { buildWorldModel, captureWorldMarkdownChanges, inspectWorldGraphProjection, inspectWorldMarkdownProjection, inspectWorldModel, materializeWorldMarkdownProjection, queryWorldHistory, queryWorldModel, queryWorldRuntimeState, queryWorldTemporalGraph, readWorldDocumentChangeCandidateSet } from "./lib/world-model.mjs";
import { inspectOnboarding, readOnboardingCandidateSet, readOnboardingReviewDecision, reviewOnboarding, startOnboarding } from "./lib/onboarding.mjs";
import { inspectFeatureMapping, readFeatureMappingCandidateSet, readFeatureMappingReviewDecision, reviewFeatureMapping, startFeatureMapping } from "./lib/feature-mapping.mjs";
import { attachVcsEvidence, inspectChangeSets, readChangeImpactCandidateSet, readChangeImpactReviewDecision, readChangeSet, readVcsEvidence, recordChangeSet, reviewChangeImpact } from "./lib/change-set.mjs";
import { inspectIncrementalRefresh, inspectPostRefreshProjectionStatus, readIncrementalRefreshReceipt, readPostRefreshProjectionReceipt, refreshWorldModel } from "./lib/incremental-refresh.mjs";
import { inspectRefreshTriggers, processRefreshTriggerBatch, readRefreshTriggerDelivery, runFileSystemRefreshWatcher } from "./lib/refresh-trigger.mjs";
import { inspectPostRefreshProjectionPolicy, setPostRefreshProjectionPolicy } from "./lib/post-refresh-projection.mjs";
import { applyDocumentChangeReview, inspectDocumentChangeReviewStatus, readDocumentChangeApplicationReceipt, readDocumentChangeReviewDecision, reviewDocumentChanges } from "./lib/document-change-review.mjs";
import { activateArcadeDbGraphProjection, inspectArcadeDbGraphProjectionStatus } from "./lib/graphdb-projection-activation.mjs";
import { initializeArcadeDbDatabase, inspectArcadeDbDatabaseCompatibility } from "./lib/arcadedb-database-lifecycle.mjs";
import {
  buildRuntimeInvocationAuthorization,
  inspectRuntimeInvocationExecutionLease,
  readRuntimeInvocationAuthorization,
} from "./lib/runtime-invocation-lifecycle.mjs";
import { executeRuntimeInvocation } from "./lib/runtime-one-shot-exec.mjs";
import { applyRuntimeRunResult, readRuntimeInvocationResult } from "./lib/runtime-run-result-application.mjs";
import { readRepositorySourceScope, writeRepositorySourceScope } from "./lib/repository-source-scope.mjs";
import { initializeOrResumeProject, inspectProjectExperience } from "./lib/project-bootstrap.mjs";
import { buildHeadContinuitySnapshot, inspectProductOperatingLoop, observeProductOutcome, prepareProductLearningNote, proposeProductInitiative, recordProductHypothesis, recordProductSignal, reviewProductInitiative } from "./lib/product-operating-loop.mjs";
import { recommendOperatingLane } from "./lib/operating-lane.mjs";
import { abortCompaction, continueCompaction, createRecoveryCheckpoint, inspectCompaction, prepareCompaction, verifyCompaction } from "./lib/compaction-recovery.mjs";
import { integrateReviewedRunCheckpoint, readRunResultIntegration, restoreSessionFromArtifacts } from "./lib/session-recovery.mjs";
import { COORDINATION_BINDING_ENV, inspectRoleCoordination, issueCoordinationRoleBinding, openCoordinationGeneration, replyCoordinationMessage, sendCoordinationMessage, waitForCoordinationInbox, waitForCoordinationReply } from "./lib/role-coordination.mjs";
import { continueSessionFromArtifacts } from "./lib/runtime-session-continuation.mjs";
import {
  applyBoundedWorkerDispatchResult,
  createBoundedWorkerDispatch,
  executeBoundedWorkerDispatch,
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

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageMetadata = JSON.parse(fs.readFileSync(path.join(pluginRoot, "package.json"), "utf8"));

export function parse(argv) {
  const [command = "help", root = ".", ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index];
    if (!item.startsWith("--")) throw new Error(`Unexpected argument: ${item}`);
    const key = item.slice(2);
    if (key === "fresh") {
      options[key] = true;
      continue;
    }
    const value = rest[++index];
    if (!value || value.startsWith("--")) throw new Error(`A value is required for ${item}.`);
    options[key] = value;
  }
  return { command, root, options };
}

export function usage({ all = false } = {}) {
  const allCommands = [
      "head init <project> [--runtime claude,codex,opencode] [--profile core|product] [--input <onboarding.json>]",
      "head resume <project> [--runtime claude,codex,opencode] [--profile core|product] [--input <onboarding.json>]",
      "head --version",
      "head status <project>",
      "head doctor <project>",
      "head runtime-adapters <project>",
      "head runtime-invocation-authorize <project> --input <authorization.json>",
      "head runtime-invocation-read <project> --authorization <execution-authorization-id>",
      "head runtime-invocation-lease-status <project> --authorization <execution-authorization-id>",
      "head runtime-invocation-execute <project> --authorization <execution-authorization-id> [--input <execution.json>]",
      "head runtime-invocation-result <project> --authorization <execution-authorization-id>",
      "head runtime-invocation-apply-run-result <project> --authorization <execution-authorization-id>",
      "head worker-dispatch <project> --authorization <execution-authorization-id> --role <developer|coder|reviewer>",
      "head worker-read <project> --authorization <execution-authorization-id>",
      "head worker-wait <project> --authorization <execution-authorization-id> [--wait-timeout-ms <0..600000>]",
      "head worker-execute <project> --authorization <execution-authorization-id> --role <developer|coder|reviewer>",
      "head worker-apply <project> --authorization <execution-authorization-id>",
      "head worker-wave-create <project> --input <wave.json>",
      "head worker-wave-read <project> --wave <bounded-worker-wave-id>",
      "head worker-wave-seal <project> --wave <bounded-worker-wave-id>",
      "head worker-wave-status <project> --wave <bounded-worker-wave-id>",
      "head worker-wave-results <project> --wave <bounded-worker-wave-id>",
      "head worker-wave-wait <project> --wave <bounded-worker-wave-id> [--wait-timeout-ms <0..600000>]",
      "head worker-wave-abandon <project> --input <abandonment.json>",
      "head onboarding-start <project> [--input <onboarding.json>]",
      "head onboarding-status <project>",
      "head onboarding-review <project> --input <review.json>",
      "head onboarding-candidates <project> --candidate-set <onboarding-candidate-set-id>",
      "head onboarding-review-read <project> --review <onboarding-review-decision-id>",
      "head source-scope-set <project> --input <source-scope.json>",
      "head source-scope-status <project>",
      "head feature-mapping-start <project>",
      "head feature-mapping-status <project>",
      "head feature-mapping-review <project> --input <review.json>",
      "head feature-mapping-candidates <project> --candidate-set <feature-mapping-candidate-set-id>",
      "head feature-mapping-review-read <project> --review <feature-mapping-review-decision-id>",
      "head change-set-record <project> --input <change-set.json>",
      "head change-set-status <project>",
      "head change-set-read <project> --change-set <change-set-id>",
      "head change-impact-candidates <project> --candidate-set <change-impact-candidate-set-id>",
      "head change-impact-review <project> --input <review.json>",
      "head change-impact-review-read <project> --review <change-impact-review-decision-id>",
      "head change-set-vcs-attach <project> --input <vcs-evidence.json>",
      "head change-set-vcs-read <project> --vcs-evidence <vcs-evidence-id>",
      "head operating-lane-recommend <project> --input <risk.json>",
      "head product-note <project> --input <note.json>",
      "head product-signal-record <project> --input <signal.json>",
      "head product-hypothesis-record <project> --input <hypothesis.json>",
      "head product-initiative-propose <project> --input <initiative.json>",
      "head product-initiative-review <project> --input <review.json>",
      "head product-outcome-observe <project> --input <outcome.json>",
      "head product-operating-status <project> [--fresh]",
      "head head-continuity <project> [--fresh]",
      "head world-index <project> [--git-log <host-exported-log-file>] [--runtime-state <host-exported-json-file>] [--parent-snapshot <id,id>] [--revision-parents <json-file>]",
      "head world-status <project>",
      "head world-refresh <project> [--expect-changed <path,path>] [--trigger-evidence <id,id>] [--parent-snapshot <id,id>]",
      "head world-refresh-status <project>",
      "head world-refresh-read <project> --receipt <incremental-refresh-receipt-id>",
      "head world-refresh-events <project> --input <refresh-events.json>",
      "head world-refresh-watch <project> [--debounce-ms <25-60000>] [--max-events <1-4096>]",
      "head world-refresh-trigger-status <project>",
      "head world-refresh-trigger-read <project> --delivery <refresh-trigger-delivery-id>",
      "head world-graph-status <project>",
      "head world-graph-remote-database-status <project>",
      "head world-graph-remote-database-initialize <project> [--reset-incompatible true --confirm-database <exact-name>]",
      "head world-graph-remote-activate <project>",
      "head world-graph-remote-status <project>",
      "head world-docs-build <project>",
      "head world-docs-status <project>",
      "head world-docs-capture <project>",
      "head world-docs-candidates <project> --candidate-set <document-change-candidate-set-id>",
      "head world-docs-review <project> --input <review.json>",
      "head world-docs-apply <project> --review <document-change-review-decision-id>",
      "head world-docs-review-status <project> --candidate-set <document-change-candidate-set-id>",
      "head world-docs-review-read <project> --review <document-change-review-decision-id>",
      "head world-docs-application-read <project> --application <document-change-application-id>",
      "head world-docs-policy-set <project> --input <policy.json>",
      "head world-docs-policy-status <project>",
      "head world-docs-refresh-status <project>",
      "head world-docs-refresh-read <project> --receipt <post-refresh-projection-receipt-id>",
      "head world-query <project> --query <text> [--depth <0-3>] [--limit <1-500>]",
      "head world-temporal <project> --query <text> [--kind <kind,kind>] [--relations <type,type>] [--include-candidates <true|false>] [--depth <0-3>] [--limit <1-500>] [--edge-limit <0-1000>] [--min-confidence <0-1>]",
      "head world-history <project> [--query <text>] [--limit <1-500>]",
      "head world-runtime <project> [--query <text>] [--runtime <name>] [--state <state>] [--kind <kind>] [--limit <1-500>]",
      "head checkpoint <project> --summary <text> [--next <text>]",
      "head session-restore <project> [--checkpoint <session-run-checkpoint-id>]",
      "head session-continue <project> --runtime <claude|codex|opencode> [--checkpoint <session-run-checkpoint-id>] [--binding-env <environment-name>]",
      "head compact-prepare <project> --input <recovery.json>",
      "head compact-verify <project> --input <verification.json>",
      "head compact-continue <project> --input <continuation.json>",
      "head compact-status <project>",
      "head compact-abort <project> --input <abort.json>",
      "head coordination-open <project>",
      "head coordination-rotate <project>",
      "head coordination-bind <project> --role <head|developer|coder|reviewer>",
      "head coordination-status <project>",
      "head coordination-send <project> --input <message.json> [--binding-env <environment-name>]",
      "head coordination-inbox <project> [--unread-only <true|false>] [--wait-timeout-ms <0..600000>] [--binding-env <environment-name>]",
      "head coordination-wait-reply <project> --message <coordination-message-id> [--wait-timeout-ms <0..600000>] [--binding-env <environment-name>]",
      "head coordination-reply <project> --input <reply.json> [--binding-env <environment-name>]",
      "head lineage-plan <project> --input <whole-plan.json>",
      "head lineage-next-plan <project> --input <next-whole-plan.json>",
      "head lineage-contract <project> --input <execution-contract.json>",
      "head run-start <project> --contract <execution-contract-id>",
      "head run-finish <project> --input <result.json>",
      "head run-review-context <project>",
      "head run-review <project> --input <review.json>",
      "head run-integrate-checkpoint <project> --input <integration.json>",
      "head run-integration-read <project> --review <review-decision-id>",
      "head context-preview <project> --task <text> [--budget <tokens>] [--evidence-needs <json-file>]",
      "head context-compile <project> --task <text> [--budget <tokens>] [--evidence-needs <json-file>]",
      "head context-read <project> --capsule <capsule-id>",
      "head lineage-read <project> --artifact <lineage-artifact-id>",
    ];
  const defaultCommands = [
    "head init <project> [--runtime claude,codex,opencode] [--profile core|product]  # core is the default",
    "head resume <project> [--runtime claude,codex,opencode] [--profile core|product]  # product is explicit",
    "head status <project>",
    "head product-note <project> --input <note.json>",
    "head operating-lane-recommend <project> --input <risk.json>  # optional advisory",
    "head product-operating-status <project> [--fresh]",
    "head product-initiative-propose <project> --input <initiative.json>  # durable product action only",
    "head product-initiative-review <project> --input <review.json>  # explicit user decision",
    "head help-all  # advanced, compatibility, audit, and recovery commands",
  ];
  return {
    surface: all ? "complete-compatibility" : "light-default",
    commands: all ? allCommands : defaultCommands,
    laneRecommendationRequired: false,
    durableProductRecordCommandsAreDefault: false,
    advancedCompatibilityCommand: all ? null : "head help-all",
  };
}

function inputJson(options, label) {
  if (!options.input) throw new Error(`${label} requires --input <json-file>.`);
  const file = path.resolve(options.input);
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { throw new Error(`${label} input is invalid JSON: ${error.message}`); }
}

function optionalInputJson(options, label) {
  return options.input ? inputJson(options, label) : {};
}

function coordinationBindingToken(options, { required = true } = {}) {
  const name = String(options["binding-env"] || COORDINATION_BINDING_ENV).trim();
  if (!/^[A-Z][A-Z0-9_]{2,127}$/u.test(name)) throw new Error("Coordination binding environment name is invalid.");
  const token = String(process.env[name] || "").trim();
  if (!token && !required) return null;
  if (!token) {
    const error = new Error(`Coordination binding token is unavailable through environment reference ${name}.`);
    error.code = "COORDINATION_BINDING_REQUIRED";
    throw error;
  }
  return token;
}

function readJsonFile(file, label) {
  try { return JSON.parse(fs.readFileSync(path.resolve(file), "utf8")); }
  catch (error) { throw new Error(`${label} is invalid JSON: ${error.message}`); }
}

function evidenceNeedsInput(options) {
  if (!options["evidence-needs"]) return [];
  const value = readJsonFile(options["evidence-needs"], "HEAD evidence needs");
  return Array.isArray(value) ? value : value?.evidenceNeeds ?? value;
}

export function runCommand(argv = process.argv.slice(2)) {
  const { command, root, options } = parse(argv);
  if (command === "help" || command === "--help" || command === "-h") return usage();
  if (command === "help-all") return usage({ all: true });
  if (command === "--version" || command === "version") return { name: "head-agent-core", version: packageMetadata.version };
  if (command === "init" || command === "resume") return initializeOrResumeProject({
    root,
    pluginRoot,
    runtimes: options.runtime?.split(","),
    profile: options.profile || "core",
    onboarding: options.input ? inputJson(options, "Project onboarding") : null,
  });
  if (command === "status" || command === "doctor") return inspectProjectExperience({ root });
  if (command === "runtime-adapters") return inspectRuntimeAdapters(root);
  if (command === "runtime-invocation-authorize") {
    const input = inputJson(options, "Runtime invocation authorization");
    const allowed = new Set(["runtime", "scope", "workspaceMode", "runtimeSelection", "limits"]);
    const unexpected = Object.keys(input).filter((key) => !allowed.has(key));
    if (unexpected.length) throw new Error(`Runtime invocation authorization contains unsupported fields: ${unexpected.sort().join(", ")}`);
    return inspectRuntimeAdapters(root).then((runtimeStatus) => buildRuntimeInvocationAuthorization({
      ...input,
      root,
      protocolEvidence: runtimeStatus.protocolEvidence,
      projectBinding: runtimeStatus.projectBinding,
      persist: true,
    }));
  }
  if (command === "runtime-invocation-read") return readRuntimeInvocationAuthorization({ root, authorizationId: options.authorization });
  if (command === "runtime-invocation-lease-status") return inspectRuntimeInvocationExecutionLease({ root, authorizationId: options.authorization });
  if (command === "runtime-invocation-execute") {
    const authorization = readRuntimeInvocationAuthorization({ root, authorizationId: options.authorization }).authorization;
    const input = optionalInputJson(options, "Runtime invocation execution");
    const unexpected = Object.keys(input).filter((key) => key !== "sessionRequest");
    if (unexpected.length) throw new Error(`Runtime invocation execution contains unsupported fields: ${unexpected.sort().join(", ")}`);
    return inspectRuntimeAdapters(root).then((runtimeStatus) => executeRuntimeInvocation({
      root,
      authorization,
      sessionRequest: input.sessionRequest || "",
      protocolEvidence: runtimeStatus.protocolEvidence,
      projectBinding: runtimeStatus.projectBinding,
      persist: true,
    }));
  }
  if (command === "runtime-invocation-result") return readRuntimeInvocationResult({ root, authorizationId: options.authorization });
  if (command === "runtime-invocation-apply-run-result") return applyRuntimeRunResult({ root, authorizationId: options.authorization });
  if (command === "worker-dispatch") return createBoundedWorkerDispatch({ root, authorizationId: options.authorization, role: options.role });
  if (command === "worker-read") return readBoundedWorkerDispatch({ root, authorizationId: options.authorization });
  if (command === "worker-wait") return waitForBoundedWorkerDispatch({
    root,
    authorizationId: options.authorization,
    timeoutMs: options["wait-timeout-ms"] == null ? 0 : Number(options["wait-timeout-ms"]),
  });
  if (command === "worker-execute") {
    return inspectRuntimeAdapters(root).then((runtimeStatus) => executeBoundedWorkerDispatch({
      root,
      authorizationId: options.authorization,
      role: options.role,
      execution: {
        protocolEvidence: runtimeStatus.protocolEvidence,
        projectBinding: runtimeStatus.projectBinding,
      },
    }));
  }
  if (command === "worker-apply") return applyBoundedWorkerDispatchResult({ root, authorizationId: options.authorization });
  if (command === "worker-wave-create") {
    const input = inputJson(options, "Bounded worker wave");
    const unexpected = Object.keys(input).filter((key) => key !== "authorizationIds");
    if (unexpected.length) throw new Error(`Bounded worker wave contains unsupported fields: ${unexpected.sort().join(", ")}`);
    return createBoundedWorkerWave({ root, authorizationIds: input.authorizationIds });
  }
  if (command === "worker-wave-read") return readBoundedWorkerWave({ root, waveId: options.wave });
  if (command === "worker-wave-seal") return sealBoundedWorkerWave({ root, waveId: options.wave });
  if (command === "worker-wave-status") return readBoundedWorkerWaveStatus({ root, waveId: options.wave });
  if (command === "worker-wave-results") return readBoundedWorkerWaveResults({ root, waveId: options.wave });
  if (command === "worker-wave-wait") return waitForBoundedWorkerWave({
    root,
    waveId: options.wave,
    timeoutMs: options["wait-timeout-ms"] == null ? 0 : Number(options["wait-timeout-ms"]),
  });
  if (command === "worker-wave-abandon") {
    const input = inputJson(options, "Bounded worker wave abandonment");
    const allowed = new Set(["waveId", "reasonCode", "reasonSummary"]);
    const unexpected = Object.keys(input).filter((key) => !allowed.has(key));
    if (unexpected.length) throw new Error(`Bounded worker wave abandonment contains unsupported fields: ${unexpected.sort().join(", ")}`);
    return abandonBoundedWorkerWave({ root, waveId: input.waveId, reasonCode: input.reasonCode, reasonSummary: input.reasonSummary || "" });
  }
  if (command === "onboarding-start") return startOnboarding({ ...optionalInputJson(options, "Onboarding start"), root });
  if (command === "onboarding-status") return inspectOnboarding({ root });
  if (command === "onboarding-review") return reviewOnboarding({ ...inputJson(options, "Onboarding ReviewDecision"), root });
  if (command === "onboarding-candidates") return readOnboardingCandidateSet({ root, candidateSetId: options["candidate-set"] });
  if (command === "onboarding-review-read") return readOnboardingReviewDecision({ root, reviewDecisionId: options.review });
  if (command === "source-scope-set") {
    const inspected = inspectProject(root);
    if (inspected.status !== "ready") throw new Error(`Project must be ready to configure source scope; current status: ${inspected.status}.`);
    return writeRepositorySourceScope({ projectRoot: inspected.project.projectRoot, selection: inputJson(options, "Repository source scope") });
  }
  if (command === "source-scope-status") {
    const inspected = inspectProject(root);
    if (inspected.status === "not_initialized") throw new Error("HEAD Agent Core is not initialized.");
    return readRepositorySourceScope({ projectRoot: inspected.project.projectRoot });
  }
  if (command === "feature-mapping-start") return startFeatureMapping({ root });
  if (command === "feature-mapping-status") return inspectFeatureMapping({ root });
  if (command === "feature-mapping-review") return reviewFeatureMapping({ ...inputJson(options, "Feature mapping ReviewDecision"), root });
  if (command === "feature-mapping-candidates") return readFeatureMappingCandidateSet({ root, candidateSetId: options["candidate-set"] });
  if (command === "feature-mapping-review-read") return readFeatureMappingReviewDecision({ root, reviewDecisionId: options.review });
  if (command === "change-set-record") return recordChangeSet({ ...inputJson(options, "ChangeSet"), root });
  if (command === "change-set-status") return inspectChangeSets({ root });
  if (command === "change-set-read") return readChangeSet({ root, changeSetId: options["change-set"] });
  if (command === "change-impact-candidates") return readChangeImpactCandidateSet({ root, candidateSetId: options["candidate-set"] });
  if (command === "change-impact-review") return reviewChangeImpact({ ...inputJson(options, "Change impact ReviewDecision"), root });
  if (command === "change-impact-review-read") return readChangeImpactReviewDecision({ root, reviewDecisionId: options.review });
  if (command === "change-set-vcs-attach") return attachVcsEvidence({ ...inputJson(options, "VCS evidence attachment"), root });
  if (command === "change-set-vcs-read") return readVcsEvidence({ root, vcsEvidenceId: options["vcs-evidence"] });
  if (command === "operating-lane-recommend") return recommendOperatingLane({ ...inputJson(options, "Operating lane risk input"), root });
  if (command === "product-note") return prepareProductLearningNote({ ...inputJson(options, "Product learning note"), root });
  if (command === "product-signal-record") return recordProductSignal({ ...inputJson(options, "ProductSignal"), root });
  if (command === "product-hypothesis-record") return recordProductHypothesis({ ...inputJson(options, "ProductHypothesis"), root });
  if (command === "product-initiative-propose") return proposeProductInitiative({ ...inputJson(options, "ProductInitiativeCandidate"), root });
  if (command === "product-initiative-review") return reviewProductInitiative({ ...inputJson(options, "Product Initiative ReviewDecision"), root });
  if (command === "product-outcome-observe") return observeProductOutcome({ ...inputJson(options, "OutcomeObservation"), root });
  if (command === "product-operating-status") return inspectProductOperatingLoop({ root, fresh: options.fresh === true });
  if (command === "head-continuity") return buildHeadContinuitySnapshot({ root, fresh: options.fresh === true });
  if (command === "world-index") return buildWorldModel({
    root,
    persist: true,
    gitHistoryAdapter: options["git-log"] ? new GitLogFileHistoryAdapter({ file: options["git-log"] }) : null,
    runtimeStateAdapter: options["runtime-state"] ? new RuntimeStateFileAdapter({ file: options["runtime-state"] }) : null,
    parentSourceSnapshotIds: options["parent-snapshot"] ? options["parent-snapshot"].split(",").map((item) => item.trim()).filter(Boolean) : [],
    revisionParentIds: options["revision-parents"] ? readJsonFile(options["revision-parents"], "Revision parent map") : {},
  });
  if (command === "world-status") return inspectWorldModel({ root });
  if (command === "world-refresh") return refreshWorldModel({
    root,
    triggerKind: "manual",
    triggerEvidenceIds: options["trigger-evidence"] ? options["trigger-evidence"].split(",").map((item) => item.trim()).filter(Boolean) : [],
    expectedChangedPaths: options["expect-changed"] == null ? null : options["expect-changed"].split(",").map((item) => item.trim()).filter(Boolean),
    additionalParentSourceSnapshotIds: options["parent-snapshot"] ? options["parent-snapshot"].split(",").map((item) => item.trim()).filter(Boolean) : [],
  });
  if (command === "world-refresh-status") return inspectIncrementalRefresh({ root });
  if (command === "world-refresh-read") return readIncrementalRefreshReceipt({ root, refreshReceiptId: options.receipt });
  if (command === "world-refresh-events") {
    const input = inputJson(options, "Refresh trigger event ingestion");
    const unexpected = Object.keys(input).filter((key) => !["sourceKind", "events", "maxEvents"].includes(key));
    if (unexpected.length) throw new Error(`Refresh trigger event ingestion contains unsupported fields: ${unexpected.sort().join(", ")}`);
    if (input.sourceKind !== "ci") throw new Error("world-refresh-events accepts only sourceKind ci; use world-refresh-watch for filesystem events.");
    return processRefreshTriggerBatch({ root, ...input });
  }
  if (command === "world-refresh-watch") return runFileSystemRefreshWatcher({
    root,
    debounceMs: options["debounce-ms"] == null ? undefined : Number(options["debounce-ms"]),
    maxEvents: options["max-events"] == null ? undefined : Number(options["max-events"]),
  });
  if (command === "world-refresh-trigger-status") return inspectRefreshTriggers({ root });
  if (command === "world-refresh-trigger-read") return readRefreshTriggerDelivery({ root, triggerDeliveryId: options.delivery });
  if (command === "world-graph-status") return inspectWorldGraphProjection({ root });
  if (command === "world-graph-remote-database-status") return inspectArcadeDbDatabaseCompatibility({ root });
  if (command === "world-graph-remote-database-initialize") return initializeArcadeDbDatabase({
    root,
    resetIncompatible: options["reset-incompatible"] === "true",
    confirmDatabase: options["confirm-database"] || "",
  });
  if (command === "world-graph-remote-activate") return activateArcadeDbGraphProjection({ root });
  if (command === "world-graph-remote-status") return inspectArcadeDbGraphProjectionStatus({ root });
  if (command === "world-docs-build") return materializeWorldMarkdownProjection({ root });
  if (command === "world-docs-status") return inspectWorldMarkdownProjection({ root });
  if (command === "world-docs-capture") return captureWorldMarkdownChanges({ root, persist: true });
  if (command === "world-docs-candidates") return readWorldDocumentChangeCandidateSet({ root, candidateSetId: options["candidate-set"] });
  if (command === "world-docs-review") {
    const input = inputJson(options, "Document-change ReviewDecision");
    const allowed = new Set(["candidateSetId", "disposition", "acceptedCandidateIds", "resultingProductModel", "rationale", "apply"]);
    const unexpected = Object.keys(input).filter((key) => !allowed.has(key));
    if (unexpected.length) throw new Error(`Document-change ReviewDecision contains unsupported fields: ${unexpected.sort().join(", ")}`);
    return reviewDocumentChanges({ ...input, root });
  }
  if (command === "world-docs-apply") return applyDocumentChangeReview({ root, reviewDecisionId: options.review });
  if (command === "world-docs-review-status") return inspectDocumentChangeReviewStatus({ root, candidateSetId: options["candidate-set"] });
  if (command === "world-docs-review-read") return readDocumentChangeReviewDecision({ root, reviewDecisionId: options.review });
  if (command === "world-docs-application-read") return readDocumentChangeApplicationReceipt({ root, applicationReceiptId: options.application });
  if (command === "world-docs-policy-set") {
    const input = inputJson(options, "Post-refresh document projection policy");
    const unexpected = Object.keys(input).filter((key) => key !== "mode");
    if (unexpected.length) throw new Error(`Post-refresh document projection policy contains unsupported fields: ${unexpected.sort().join(", ")}`);
    return setPostRefreshProjectionPolicy({ root, mode: input.mode });
  }
  if (command === "world-docs-policy-status") return inspectPostRefreshProjectionPolicy({ root });
  if (command === "world-docs-refresh-status") return inspectPostRefreshProjectionStatus({ root });
  if (command === "world-docs-refresh-read") return readPostRefreshProjectionReceipt({ root, postRefreshProjectionReceiptId: options.receipt });
  if (command === "world-query") return queryWorldModel({
    root,
    query: options.query,
    depth: options.depth == null ? 1 : Number(options.depth),
    maxResults: options.limit == null ? 100 : Number(options.limit),
  });
  if (command === "world-temporal") return queryWorldTemporalGraph({
    root,
    query: options.query,
    kinds: options.kind ? options.kind.split(",").map((item) => item.trim()).filter(Boolean) : null,
    relations: options.relations ? options.relations.split(",").map((item) => item.trim()).filter(Boolean) : null,
    includeUnreviewedCandidates: options["include-candidates"] === "true",
    minConfidence: options["min-confidence"] == null ? 0 : Number(options["min-confidence"]),
    depth: options.depth == null ? 1 : Number(options.depth),
    maxNodes: options.limit == null ? 100 : Number(options.limit),
    maxEdges: options["edge-limit"] == null ? 200 : Number(options["edge-limit"]),
  });
  if (command === "world-history") return queryWorldHistory({
    root,
    query: options.query || "",
    limit: options.limit == null ? 50 : Number(options.limit),
  });
  if (command === "world-runtime") return queryWorldRuntimeState({
    root,
    query: options.query || "",
    runtime: options.runtime || "",
    state: options.state || "",
    kind: options.kind || "",
    limit: options.limit == null ? 50 : Number(options.limit),
  });
  if (command === "checkpoint") return createRecoveryCheckpoint({
    root,
    purpose: options.summary,
    currentPosition: options.summary,
    nextExpectedResult: options.next || options.summary,
    approvedDecisions: [],
    openReviewIds: [],
  });
  if (command === "session-restore") return restoreSessionFromArtifacts({ root, checkpointId: options.checkpoint || null });
  if (command === "session-continue") {
    return continueSessionFromArtifacts({
      root,
      checkpointId: options.checkpoint || null,
      runtime: options.runtime,
      bindingToken: coordinationBindingToken(options, { required: false }),
    });
  }
  if (command === "compact-prepare") return prepareCompaction({ ...inputJson(options, "Compaction prepare"), root });
  if (command === "compact-verify") return verifyCompaction({ ...inputJson(options, "Compaction verification"), root });
  if (command === "compact-continue") return continueCompaction({ ...inputJson(options, "Compaction continuation"), root });
  if (command === "compact-status") return inspectCompaction({ root });
  if (command === "compact-abort") return abortCompaction({ ...inputJson(options, "Compaction abort"), root });
  if (command === "coordination-open") return openCoordinationGeneration({ root });
  if (command === "coordination-rotate") return openCoordinationGeneration({ root, rotate: true });
  if (command === "coordination-bind") return issueCoordinationRoleBinding({ root, role: options.role });
  if (command === "coordination-status") return inspectRoleCoordination({ root });
  if (command === "coordination-send") {
    const input = inputJson(options, "Coordination message");
    const unexpected = Object.keys(input).filter((key) => !new Set(["toRole", "content", "evidenceIds", "idempotencyKey", "lane"]).has(key));
    if (unexpected.length) throw new Error(`Coordination message contains unsupported fields: ${unexpected.sort().join(", ")}`);
    return sendCoordinationMessage({ ...input, root, bindingToken: coordinationBindingToken(options) });
  }
  if (command === "coordination-inbox") return waitForCoordinationInbox({
    root,
    bindingToken: coordinationBindingToken(options),
    unreadOnly: options["unread-only"] == null ? true : options["unread-only"] === "true",
    timeoutMs: options["wait-timeout-ms"] == null ? 0 : Number(options["wait-timeout-ms"]),
  });
  if (command === "coordination-wait-reply") return waitForCoordinationReply({
    root,
    bindingToken: coordinationBindingToken(options),
    messageId: options.message,
    timeoutMs: options["wait-timeout-ms"] == null ? 0 : Number(options["wait-timeout-ms"]),
  });
  if (command === "coordination-reply") {
    const input = inputJson(options, "Coordination reply");
    const unexpected = Object.keys(input).filter((key) => !new Set(["inReplyTo", "content"]).has(key));
    if (unexpected.length) throw new Error(`Coordination reply contains unsupported fields: ${unexpected.sort().join(", ")}`);
    return replyCoordinationMessage({ ...input, root, bindingToken: coordinationBindingToken(options) });
  }
  if (command === "lineage-plan") return createWholePlanSnapshot({ ...inputJson(options, "Whole plan"), root, persist: true });
  if (command === "lineage-next-plan") return createNextWholePlanSnapshot({ ...inputJson(options, "Next whole plan"), root, persist: true });
  if (command === "lineage-contract") return createExecutionContract({ ...inputJson(options, "Execution Contract"), root, persist: true });
  if (command === "run-start") return startRun({ root, executionContractId: options.contract });
  if (command === "run-finish") return finishRun({ ...inputJson(options, "Result Packet"), root });
  if (command === "run-review-context") return getPendingReviewContext({ root });
  if (command === "run-review") return reviewRun({ ...inputJson(options, "ReviewDecision"), root });
  if (command === "run-integrate-checkpoint") return integrateReviewedRunCheckpoint({ ...inputJson(options, "Run result integration"), root });
  if (command === "run-integration-read") return readRunResultIntegration({ root, reviewDecisionId: options.review });
  if (command === "context-preview") return previewContextWorkflow({ root, task: options.task, budget: options.budget == null ? DEFAULT_CONTEXT_BUDGET : Number(options.budget), evidenceNeeds: evidenceNeedsInput(options) });
  if (command === "context-compile") return compileContext({ root, task: options.task, budget: options.budget == null ? DEFAULT_CONTEXT_BUDGET : Number(options.budget), evidenceNeeds: evidenceNeedsInput(options), persist: true });
  if (command === "context-read") return readContextCapsule({ root, capsuleId: options.capsule });
  if (command === "lineage-read") return readLineageArtifact({ root, artifactId: options.artifact });
  throw new Error(`Unknown command: ${command}`);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  Promise.resolve().then(() => runCommand()).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stdout.write(`${JSON.stringify({ status: "failed", code: error.code || "HEAD_CLI_ERROR", error: error.message }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
