#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCheckpoint, initializeProject, inspectProject, inspectRuntimeAdapters } from "./lib/head-core.mjs";
import { compileContext, readContextCapsule } from "./lib/context-compiler.mjs";
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
import {
  buildRuntimeInvocationAuthorization,
  inspectRuntimeInvocationExecutionLease,
  readRuntimeInvocationAuthorization,
} from "./lib/runtime-invocation-lifecycle.mjs";
import { applyCodexRuntimeRunResult, executeCodexRuntimeInvocation, readCodexRuntimeInvocationResult } from "./lib/runtime-codex-exec.mjs";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function parse(argv) {
  const [command = "help", root = ".", ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index];
    if (!item.startsWith("--")) throw new Error(`Unexpected argument: ${item}`);
    const key = item.slice(2);
    const value = rest[++index];
    if (!value || value.startsWith("--")) throw new Error(`A value is required for ${item}.`);
    options[key] = value;
  }
  return { command, root, options };
}

export function usage() {
  return {
    commands: [
      "head init <project> [--runtime codex,opencode]",
      "head status <project>",
      "head doctor <project>",
      "head runtime-adapters <project>",
      "head runtime-invocation-authorize <project> --input <authorization.json>",
      "head runtime-invocation-read <project> --authorization <execution-authorization-id>",
      "head runtime-invocation-lease-status <project> --authorization <execution-authorization-id>",
      "head runtime-invocation-execute <project> --authorization <execution-authorization-id> [--input <execution.json>]",
      "head runtime-invocation-result <project> --authorization <execution-authorization-id>",
      "head runtime-invocation-apply-run-result <project> --authorization <execution-authorization-id>",
      "head onboarding-start <project> [--input <onboarding.json>]",
      "head onboarding-status <project>",
      "head onboarding-review <project> --input <review.json>",
      "head onboarding-candidates <project> --candidate-set <onboarding-candidate-set-id>",
      "head onboarding-review-read <project> --review <onboarding-review-decision-id>",
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
      "head lineage-plan <project> --input <whole-plan.json>",
      "head lineage-next-plan <project> --input <next-whole-plan.json>",
      "head lineage-contract <project> --input <execution-contract.json>",
      "head run-start <project> --contract <execution-contract-id>",
      "head run-finish <project> --input <result.json>",
      "head run-review-context <project>",
      "head run-review <project> --input <review.json>",
      "head context-preview <project> --task <text> [--budget <tokens>]",
      "head context-compile <project> --task <text> [--budget <tokens>]",
      "head context-read <project> --capsule <capsule-id>",
      "head lineage-read <project> --artifact <lineage-artifact-id>",
    ],
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

function readJsonFile(file, label) {
  try { return JSON.parse(fs.readFileSync(path.resolve(file), "utf8")); }
  catch (error) { throw new Error(`${label} is invalid JSON: ${error.message}`); }
}

export function runCommand(argv = process.argv.slice(2)) {
  const { command, root, options } = parse(argv);
  if (command === "help" || command === "--help" || command === "-h") return usage();
  if (command === "init") return initializeProject({ root, pluginRoot, runtimes: options.runtime?.split(",") });
  if (command === "status" || command === "doctor") return inspectProject(root);
  if (command === "runtime-adapters") return inspectRuntimeAdapters(root);
  if (command === "runtime-invocation-authorize") {
    const input = inputJson(options, "Runtime invocation authorization");
    const allowed = new Set(["runtime", "scope", "workspaceMode", "limits"]);
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
    return inspectRuntimeAdapters(root).then((runtimeStatus) => executeCodexRuntimeInvocation({
      root,
      authorization,
      sessionRequest: input.sessionRequest || "",
      protocolEvidence: runtimeStatus.protocolEvidence,
      projectBinding: runtimeStatus.projectBinding,
      persist: true,
    }));
  }
  if (command === "runtime-invocation-result") return readCodexRuntimeInvocationResult({ root, authorizationId: options.authorization });
  if (command === "runtime-invocation-apply-run-result") return applyCodexRuntimeRunResult({ root, authorizationId: options.authorization });
  if (command === "onboarding-start") return startOnboarding({ ...optionalInputJson(options, "Onboarding start"), root });
  if (command === "onboarding-status") return inspectOnboarding({ root });
  if (command === "onboarding-review") return reviewOnboarding({ ...inputJson(options, "Onboarding ReviewDecision"), root });
  if (command === "onboarding-candidates") return readOnboardingCandidateSet({ root, candidateSetId: options["candidate-set"] });
  if (command === "onboarding-review-read") return readOnboardingReviewDecision({ root, reviewDecisionId: options.review });
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
  if (command === "checkpoint") return createCheckpoint({ root, summary: options.summary, next: options.next });
  if (command === "lineage-plan") return createWholePlanSnapshot({ ...inputJson(options, "Whole plan"), root, persist: true });
  if (command === "lineage-next-plan") return createNextWholePlanSnapshot({ ...inputJson(options, "Next whole plan"), root, persist: true });
  if (command === "lineage-contract") return createExecutionContract({ ...inputJson(options, "Execution Contract"), root, persist: true });
  if (command === "run-start") return startRun({ root, executionContractId: options.contract });
  if (command === "run-finish") return finishRun({ ...inputJson(options, "Result Packet"), root });
  if (command === "run-review-context") return getPendingReviewContext({ root });
  if (command === "run-review") return reviewRun({ ...inputJson(options, "ReviewDecision"), root });
  if (command === "context-preview") return compileContext({ root, task: options.task, budget: options.budget == null ? 4000 : Number(options.budget), persist: false });
  if (command === "context-compile") return compileContext({ root, task: options.task, budget: options.budget == null ? 4000 : Number(options.budget), persist: true });
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
