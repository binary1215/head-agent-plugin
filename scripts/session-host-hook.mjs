#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createSessionHostAdapter } from "./lib/session-host-adapter.mjs";

const MAX_CONTEXT_CHARACTERS = 7000;
function startupProjection(entry, root) {
  const logicalSessionId = entry.workContext?.sessionId || entry.restore?.checkpoint?.sessionId || entry.projectStatus?.project?.sessionId || null;
  const views = [entry.restore?.projection, entry.projectStatus, entry].filter(Boolean);
  // Keep content and its stated diagnosis together, including an explicit null.
  // A null/absent metadata field is not itself an availability diagnosis.
  const directionView = views.find((view) => view.currentProjectDirectionAvailability
    && typeof view.currentProjectDirectionAvailability === "object" && !Array.isArray(view.currentProjectDirectionAvailability))
    || views.find((view) => Object.hasOwn(view, "currentProjectDirection"));
  const common = directionView?.currentProjectDirection ?? null;
  const availability = directionView?.currentProjectDirectionAvailability;
  const checkpoint = entry.restore?.checkpoint;
  const work = entry.workContext;
  const context = {
    status: entry.status, projectRoot: path.resolve(root), logicalSessionId,
    sessionPurpose: work?.sessionPurpose ?? null,
    currentProjectDirection: common,
    ...(availability && typeof availability === "object" && !Array.isArray(availability)
      ? { currentProjectDirectionAvailability: { status: availability.status, reasonCode: availability.reasonCode,
        dependentEffectsBlocked: availability.dependentEffectsBlocked } } : {}),
    sessionRecovery: checkpoint ? { checkpointId: checkpoint.checkpointId, purpose: checkpoint.purpose,
      approvedDecisions: checkpoint.approvedDecisions, historicalPosition: checkpoint.currentPosition,
      historicalNextExpectedResult: checkpoint.nextExpectedResult, historicalApprovalGrantsCurrentEffect: false } : null,
    records: [], omittedEvidenceIds: [], omittedEvidenceCount: 0,
    workCoverage: work ? { status: work.status, coverage: work.coverage,
      omissions: work.omissions, nextAfterEvidenceId: work.nextAfterEvidenceId } : null,
    route: logicalSessionId ? { session_id: logicalSessionId } : null,
    scope: "Read-only orientation. Current common constraints/cancellations and exact selected P2 take precedence. P3 records and historical next steps are not permission or replay instructions.",
    hostCapability: "Startup lookup requires a prior verified Host selection. Supported native Codex/Claude transports resolve each request independently; no extra bind/save or repeated Session ID is required. On unsupported Hosts use a verified explicit logical route or caller-scoped resolver. Never select by name, time or default guess.",
    ordinaryWorkBlocked: false, userDecisionRequired: false, persisted: false,
    expansion: "Use head_conversation_enter with project_root:projectRoot and the exact route above for original workContext.sessionPurpose, common direction and checkpoint context. Use head_session_work_read with that same root/route for omitted exact Evidence IDs. Startup is not an atomic snapshot; reread before a current effect. No save/approval/Run is required for ordinary work.",
  };
  const exceedsBound = () => JSON.stringify(context).length > MAX_CONTEXT_CHARACTERS;
  if (exceedsBound() && (common || checkpoint)) {
    context.currentProjectDirection = common ? { directionId: common.directionId, contentIncluded: false } : null;
    context.sessionRecovery = checkpoint ? { checkpointId: checkpoint.checkpointId, contentIncluded: false,
      historicalApprovalGrantsCurrentEffect: false } : null;
    context.requiredSourceExpansion = "Direction exceeds startup output bound. Read the exact original entry before dependent action; no constraint or cancellation is assumed absent.";
  }
  if (exceedsBound()) {
    context.workCoverage = work ? { status: work.status, omitted: true, reason: "startup-output-bound",
      sourceOriginals: work.coverage?.originals, sourceInspected: work.coverage?.inspected, sourceIncluded: work.coverage?.included,
      nextAfterEvidenceId: work.nextAfterEvidenceId } : null;
  }
  if (exceedsBound() && context.sessionPurpose !== null) {
    context.sessionPurpose = null;
    context.sessionPurposeCoverage = { contentIncluded: false, reason: "startup-output-bound", source: "workContext.sessionPurpose" };
  }
  for (const record of work?.records || []) {
    const selected = { evidenceId: record.evidenceId, content: record.content, references: record.references };
    context.records.push(selected);
    if (exceedsBound()) {
      context.records.pop();
      context.omittedEvidenceCount += 1;
      if (context.omittedEvidenceIds.length < 16) context.omittedEvidenceIds.push(record.evidenceId);
    }
  }
  // Omission IDs/counts can themselves use the last available characters.
  // Check the final envelope after all metadata and expansion text are present.
  while (exceedsBound() && context.records.length) {
    const omitted = context.records.pop();
    context.omittedEvidenceCount += 1;
    if (context.omittedEvidenceIds.length < 16) context.omittedEvidenceIds.push(omitted.evidenceId);
  }
  if (exceedsBound()) {
    context.omittedEvidenceIds = [];
    context.workCoverage = { omitted: true, reason: "startup-output-bound", expansionRequired: true };
  }
  // Only a path larger than the remaining minimal envelope reaches this branch.
  // The operational root is unchanged; never render a sliced path as exact.
  if (exceedsBound()) {
    delete context.projectRoot;
    context.projectRootOmitted = true;
    context.projectRootSource = "SessionStart.cwd";
    context.expansion = "Use head_conversation_enter with the original SessionStart.cwd as project_root and the exact route above for original workContext.sessionPurpose, common direction and checkpoint context; head_session_work_read uses that same root/route for omitted evidence. Startup is not an atomic snapshot; reread before a current effect. No save/approval/Run is required for ordinary work.";
  }
  return JSON.stringify(context);
}
// A read-only command Hook. It neither parses transcript bytes nor registers
// bindings. Verified Host selection (explicit API or native init/resume bridge)
// is the only creator of the P5 lookup record.
export function sessionStartContext({ runtime, event, environment = process.env } = {}) {
  if (!["codex", "claude"].includes(runtime) || event?.hook_event_name !== "SessionStart"
    || !["startup", "resume", "clear", "compact", "fork"].includes(event.source)
    || typeof event.cwd !== "string" || typeof event.session_id !== "string") return {};
  if (!fs.existsSync(path.join(event.cwd, ".head", "project.json"))) return {};
  // Codex's per-tool parent ID is ambiguous. Never use an unexpected agent hint
  // to select/write the parent; stock tool hooks are intentionally not wired.
  if (runtime === "codex" && event.agent_id) return {};
  let entry;
  try {
    const adapter = createSessionHostAdapter({ runtime, nativeSessionId: event.session_id,
      agentId: runtime === "claude" ? event.agent_id || null : null, environment });
    entry = adapter.enter({ root: event.cwd });
  } catch (error) {
    return { hookSpecificOutput: { hookEventName: "SessionStart",
      additionalContext: "HEAD optional startup context unavailable (" + (error.code || "HOST_CONTEXT_UNAVAILABLE") + "). Continue independent work; use a previously verified exact logical Session only for dependent work. No state was changed." } };
  }
  return { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: startupProjection(entry, event.cwd) } };
}

async function main() {
  const args = process.argv.slice(2), index = args.indexOf("--runtime");
  let bytes = 0, input = "";
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 64 * 1024) { process.stdout.write("{}\n"); return; }
    input += chunk.toString("utf8");
  }
  try { process.stdout.write(JSON.stringify(sessionStartContext({ runtime: args[index + 1], event: JSON.parse(input) })) + "\n"); }
  catch { process.stdout.write("{}\n"); }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
