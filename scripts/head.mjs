#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCheckpoint, initializeProject, inspectProject } from "./lib/head-core.mjs";
import { compileContext, readContextCapsule } from "./lib/context-compiler.mjs";
import { createExecutionContract, createNextWholePlanSnapshot, createWholePlanSnapshot, readLineageArtifact } from "./lib/execution-lineage.mjs";
import { GitLogFileHistoryAdapter } from "./lib/git-history.mjs";
import { RuntimeStateFileAdapter } from "./lib/runtime-state.mjs";
import { finishRun, getPendingReviewContext, reviewRun, startRun } from "./lib/run-lineage.mjs";
import { buildWorldModel, inspectWorldModel, queryWorldHistory, queryWorldModel, queryWorldRuntimeState, queryWorldTemporalGraph } from "./lib/world-model.mjs";
import { inspectOnboarding, readOnboardingCandidateSet, readOnboardingReviewDecision, reviewOnboarding, startOnboarding } from "./lib/onboarding.mjs";

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
      "head onboarding-start <project> [--input <onboarding.json>]",
      "head onboarding-status <project>",
      "head onboarding-review <project> --input <review.json>",
      "head onboarding-candidates <project> --candidate-set <onboarding-candidate-set-id>",
      "head onboarding-review-read <project> --review <onboarding-review-decision-id>",
      "head world-index <project> [--git-log <host-exported-log-file>] [--runtime-state <host-exported-json-file>] [--parent-snapshot <id,id>] [--revision-parents <json-file>]",
      "head world-status <project>",
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
  if (command === "onboarding-start") return startOnboarding({ ...optionalInputJson(options, "Onboarding start"), root });
  if (command === "onboarding-status") return inspectOnboarding({ root });
  if (command === "onboarding-review") return reviewOnboarding({ ...inputJson(options, "Onboarding ReviewDecision"), root });
  if (command === "onboarding-candidates") return readOnboardingCandidateSet({ root, candidateSetId: options["candidate-set"] });
  if (command === "onboarding-review-read") return readOnboardingReviewDecision({ root, reviewDecisionId: options.review });
  if (command === "world-index") return buildWorldModel({
    root,
    persist: true,
    gitHistoryAdapter: options["git-log"] ? new GitLogFileHistoryAdapter({ file: options["git-log"] }) : null,
    runtimeStateAdapter: options["runtime-state"] ? new RuntimeStateFileAdapter({ file: options["runtime-state"] }) : null,
    parentSourceSnapshotIds: options["parent-snapshot"] ? options["parent-snapshot"].split(",").map((item) => item.trim()).filter(Boolean) : [],
    revisionParentIds: options["revision-parents"] ? readJsonFile(options["revision-parents"], "Revision parent map") : {},
  });
  if (command === "world-status") return inspectWorldModel({ root });
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
