import assert from "node:assert/strict";
import test from "node:test";
import { formatCliResult, formatMcpToolContent } from "../scripts/lib/cli-presentation.mjs";

test("Session hints expose recorded work pointers and update only; preserve every Session and raw field", () => {
  const value = { projectId: "synthetic-project", defaultSessionId: "chosen", sessions: [
    { sessionId: "chosen", purpose: "Current explicit work", default: true, state: {
      activeRunId: "run-1", pendingReview: { reviewId: "review-1" }, requiredPlanAction: { action: "revise" },
      updatedAt: "2000-01-01T00:00:00Z", custom: "retain original" } },
    { sessionId: "other", purpose: "Independent work", default: false, state: {
      activeRunId: null, pendingReview: null, requiredPlanAction: null, latestCheckpoint: "checkpoint-2" } },
  ] };
  const before = structuredClone(value), cli = formatCliResult("session-list", value);
  assert.equal(cli, formatMcpToolContent("head_session_list", value));
  assert.deepEqual(value, before);
  assert.match(cli, /Stored work hints: Run pointer, pending review pointer, plan-action pointer/);
  assert.match(cli, /Last recorded state update \(not live activity\): "2000-01-01T00:00:00Z"/);
  assert.match(cli, /no pending\/work pointer recorded; not a completion claim/);
  assert.match(cli, /Last recorded state update: unavailable; activity is unknown/);
  for (const text of ["chosen", "other", "Current explicit work", "Independent work", "run-1", "review-1", "checkpoint-2", "retain original"])
    assert.ok(cli.includes(text), text);
  assert.doesNotMatch(cli, /auto.?archive|inactive|completed successfully|live running/i);
});

test("Session hints do not manufacture state, sort, or hide malformed and empty entries", () => {
  const value = { sessions: [null, { sessionId: "missing-state" }, { sessionId: "empty", state: {} }] };
  const before = structuredClone(value), text = formatCliResult("session-list", value);
  assert.deepEqual(value, before);
  assert.equal((text.match(/Session\[/g) || []).length, 3);
  assert.ok(text.indexOf("missing-state") < text.indexOf('"empty"'));
  assert.equal((text.match(/Stored work hints:/g) || []).length, 1);
});
