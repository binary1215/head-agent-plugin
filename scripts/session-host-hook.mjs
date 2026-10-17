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
    records: [], omittedEvidenceIds: [], omittedEvidenceCount: work?.records?.length || 0,
    workCoverage: work ? { omitted: true } : null,
    route: logicalSessionId ? { session_id: logicalSessionId } : null,
    scope: "Read-only, non-atomic orientation. Current common and selected Session P2 apply; historical approval/next steps and P3 grant no effects. Recheck current authority before an effect.",
    hostCapability: "Use only verified Host/explicit routing; never guess. No extra bind/save or repeated Session ID is required.",
    ordinaryWorkBlocked: false, userDecisionRequired: false, persisted: false,
    expansion: "",
  };
  const normalScope = context.scope, normalHostCapability = context.hostCapability;
  let compactExpansion = false, executionDetailsOmitted = false;
  const serialize = () => {
    const rootSource = context.projectRootOmitted ? "the original SessionStart.cwd" : "projectRoot";
    const omittedWork = context.omittedEvidenceCount || work?.omissions?.byBudget || work?.omissions?.uninspected || work?.unavailable?.length;
    if (compactExpansion) {
      const route = "(project_root:" + rootSource + ", ...route)";
      context.expansion = (context.requiredSourceExpansion ? "When needed: head_conversation_enter" + route : "")
        + (omittedWork ? (context.requiredSourceExpansion ? "; " : "") + "Omitted work: head_session_work_read" + route : "");
    } else {
      context.expansion = "When needed, head_conversation_enter with project_root:" + rootSource
        + " and the exact route above reads selected originals (workContext.sessionPurpose, common direction, checkpoint).";
      if (omittedWork) context.expansion += " For omitted work, use head_session_work_read with the same root/route.";
    }
    return JSON.stringify(context);
  };
  const exceedsBound = () => serialize().length > MAX_CONTEXT_CHARACTERS;
  if (exceedsBound()) {
    context.scope = "Read-only, non-atomic. Current common/selected P2 apply; history/P3 grant no effects. Check current authority for effects.";
    context.hostCapability = "Verified route only; never guess. No extra bind/save/repeated Session ID.";
    compactExpansion = true;
  }
  // All four latest selected checkpoint fields can carry local direction. Keep
  // them with current common direction/purpose before optional work or metadata.
  // Only a true protected-content overflow reaches whole-block omission. Size
  // and the stable tie order below are serialization rules, not semantic ranks.
  const protectedBlocks = ["sessionRecovery", "sessionPurpose", "currentProjectDirection"]
    .filter((key) => context[key] !== null)
    .map((key, order) => ({ key, order, size: JSON.stringify(context[key]).length }))
    .sort((a, b) => b.size - a.size || a.order - b.order);
  for (const { key } of protectedBlocks) {
    if (!exceedsBound()) break;
    if (key === "currentProjectDirection") context[key] = { directionId: common.directionId, contentIncluded: false };
    else if (key === "sessionRecovery") context[key] = { checkpointId: checkpoint.checkpointId, contentIncluded: false,
      historicalApprovalGrantsCurrentEffect: false };
    else {
      context.sessionPurpose = null;
      context.sessionPurposeCoverage = { contentIncluded: false, reason: "startup-output-bound", source: "workContext.sessionPurpose" };
    }
    context.requiredSourceExpansion = "Current content omitted; no constraint or cancellation is assumed absent. Expand only for dependent work.";
  }
  // Only a path larger than the remaining minimal envelope reaches this branch.
  // The operational root is unchanged; never render a sliced path as exact.
  if (exceedsBound()) {
    delete context.projectRoot;
    context.projectRootOmitted = true;
    context.projectRootSource = "SessionStart.cwd";
  }
  // Each optional addition is checked with its final counts and conditional
  // expansion. It can never evict a protected original that already fitted.
  const execution = entry.restore?.projection?.currentExecution, pointer = execution?.sessionPointer;
  if (execution && (execution.status !== "verified" || pointer?.activeRunId || pointer?.pendingReview || pointer?.requiredPlanAction)) {
    context.currentExecution = { status: execution.status,
      sessionPointer: { activeRunId: pointer?.activeRunId ?? null,
        pendingReview: pointer?.pendingReview ? { runId: pointer.pendingReview.runId, wholePlanId: pointer.pendingReview.wholePlanId, resultPacketId: pointer.pendingReview.resultPacketId } : null,
        lastReviewDecisionId: pointer?.lastReviewDecisionId ?? null,
        requiredPlanAction: pointer?.requiredPlanAction ? { kind: pointer.requiredPlanAction.kind, disposition: pointer.requiredPlanAction.disposition,
          wholePlanId: pointer.requiredPlanAction.wholePlanId, reviewDecisionId: pointer.requiredPlanAction.reviewDecisionId } : null } };
    if (exceedsBound()) {
      context.currentExecution = { status: execution.status, contentIncluded: false, source: "restore.projection.currentExecution" };
      if (exceedsBound()) {
        delete context.currentExecution;
        executionDetailsOmitted = true;
        context.scope = "Read-only. Execution details omitted; expand entry. Current common/selected P2 apply; history/P3 grant no effects.";
      }
    }
  }
  for (const record of work?.records || []) {
    const hadNotice = Object.hasOwn(context, "savedObservationScope");
    if (record.selectionRole && !hadNotice) context.savedObservationScope = "Saved historical observations coexist; no current live state, success or authority is inferred.";
    context.records.push({ evidenceId: record.evidenceId, content: record.content, references: record.references,
      ...(record.selectionRole ? { evidenceDigest: record.evidenceDigest, selectionRole: record.selectionRole,
        ...(record.savedActivity ? { savedActivity: record.savedActivity } : {}) } : {}) });
    context.omittedEvidenceCount -= 1;
    if (exceedsBound()) {
      context.records.pop(); context.omittedEvidenceCount += 1;
      if (!hadNotice) delete context.savedObservationScope;
    }
  }
  if (context.savedObservationScope && work?.organization) {
    context.workOrganization = { roots: work.organization.roots, branchingPredecessors: work.organization.branchingPredecessors,
      unavailableRelations: work.organization.unavailableRelations, uninspectedRelations: work.organization.uninspectedRelations,
      relatedExpansionDeferred: work.organization.relatedExpansionDeferred };
    if (exceedsBound()) delete context.workOrganization;
  }
  if (work) {
    const minimumCoverage = context.workCoverage;
    context.workCoverage = { status: work.status, coverage: work.coverage,
      omissions: work.omissions, nextAfterEvidenceId: work.nextAfterEvidenceId };
    if (exceedsBound()) {
      context.workCoverage = { status: work.status, omitted: true, reason: "startup-output-bound",
        sourceOriginals: work.coverage?.originals, sourceInspected: work.coverage?.inspected, sourceIncluded: work.coverage?.included,
        nextAfterEvidenceId: work.nextAfterEvidenceId };
      if (exceedsBound()) context.workCoverage = minimumCoverage;
    }
  }
  context.scope = executionDetailsOmitted ? "Execution details omitted; expand entry. " + normalScope : normalScope;
  if (exceedsBound()) context.scope = executionDetailsOmitted
    ? "Read-only. Execution details omitted; expand entry. Current common/selected P2 apply; history/P3 grant no effects."
    : "Read-only, non-atomic. Current common/selected P2 apply; history/P3 grant no effects. Check current authority for effects.";
  context.hostCapability = normalHostCapability;
  if (exceedsBound()) context.hostCapability = "Verified route only; never guess. No extra bind/save/repeated Session ID.";
  if (compactExpansion) {
    compactExpansion = false;
    if (exceedsBound()) compactExpansion = true;
  }
  const includedIds = new Set(context.records.map((record) => record.evidenceId));
  for (const record of work?.records || []) {
    if (includedIds.has(record.evidenceId) || context.omittedEvidenceIds.length >= 16) continue;
    context.omittedEvidenceIds.push(record.evidenceId);
    if (exceedsBound()) context.omittedEvidenceIds.pop();
  }
  return serialize();
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
