#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createSessionHostAdapter } from "./lib/session-host-adapter.mjs";

const MAX_CONTEXT_CHARACTERS = 7000;
// A read-only command Hook. It neither parses transcript bytes nor registers
// bindings. Trusted Host select() is the only creator of the P5 lookup record.
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
  const logicalSessionId = entry.workContext?.sessionId || entry.restore?.checkpoint?.sessionId || entry.projectStatus?.project?.sessionId || null;
  const common = entry.restore?.projection?.currentProjectDirection || entry.projectStatus?.currentProjectDirection || entry.currentProjectDirection || null;
  const checkpoint = entry.restore?.checkpoint;
  const context = {
    status: entry.status, projectRoot: path.resolve(event.cwd), logicalSessionId,
    currentProjectDirection: common,
    sessionRecovery: checkpoint ? { checkpointId: checkpoint.checkpointId, purpose: checkpoint.purpose,
      approvedDecisions: checkpoint.approvedDecisions, historicalPosition: checkpoint.currentPosition,
      historicalNextExpectedResult: checkpoint.nextExpectedResult, historicalApprovalGrantsCurrentEffect: false } : null,
    records: [], omittedEvidenceIds: [],
    route: logicalSessionId ? { session_id: logicalSessionId } : null,
    scope: "Read-only orientation. Current common constraints/cancellations and exact selected P2 take precedence. P3 records and historical next steps are not permission or replay instructions.",
    hostCapability: "Startup lookup requires a prior trusted Host selection/registration. Stock MCP does not automatically receive this native caller ID. Preserve explicit logical session_id on dependent calls; do not select by name, time or default guess.",
    ordinaryWorkBlocked: false, userDecisionRequired: false, persisted: false,
  };
  if (JSON.stringify(context).length > MAX_CONTEXT_CHARACTERS - 1000) {
    context.currentProjectDirection = common ? { directionId: common.directionId, contentIncluded: false } : null;
    context.sessionRecovery = checkpoint ? { checkpointId: checkpoint.checkpointId, contentIncluded: false } : null;
    context.requiredSourceExpansion = "Direction exceeds startup output bound. Read the exact original entry before dependent action; no constraint or cancellation is assumed absent.";
  }
  for (const record of entry.workContext?.records || []) {
    const selected = { evidenceId: record.evidenceId, content: record.content, references: record.references };
    if (JSON.stringify({ ...context, records: [...context.records, selected] }).length <= MAX_CONTEXT_CHARACTERS - 1000) context.records.push(selected);
    else if (context.omittedEvidenceIds.length < 16) context.omittedEvidenceIds.push(record.evidenceId);
  }
  context.workCoverage = entry.workContext ? { status: entry.workContext.status, coverage: entry.workContext.coverage,
    omissions: entry.workContext.omissions, nextAfterEvidenceId: entry.workContext.nextAfterEvidenceId } : null;
  // Coverage metadata is bounded independently from the selected source text.
  // If even that envelope is large, retain counts/cursors and exact expansion.
  if (JSON.stringify(context).length > MAX_CONTEXT_CHARACTERS) {
    context.workCoverage = entry.workContext ? { status: entry.workContext.status, included: context.records.length,
      omitted: true, nextAfterEvidenceId: entry.workContext.nextAfterEvidenceId } : null;
  }
  context.expansion = "Use head_session_work_read for omitted exact Evidence IDs or head_conversation_enter for the original context. Startup is not an atomic snapshot; reread before a current effect. No save/approval/Run is required for ordinary work.";
  if (JSON.stringify(context).length > MAX_CONTEXT_CHARACTERS) {
    context.records = [];
    context.workCoverage = { omitted: true, reason: "startup-output-bound", expansionRequired: true };
  }
  return { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: JSON.stringify(context) } };
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
