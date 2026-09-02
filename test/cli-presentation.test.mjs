import assert from "node:assert/strict";
import test from "node:test";
import {
  formatConformanceFinding,
  formatConformanceQueue,
  formatFeatureMappingStatus,
  formatOnboardingGuide,
  formatPendingReview,
  formatProjectBootstrap,
  formatProjectStatus,
  formatReviewOutcome,
  formatSessionRestore,
} from "../scripts/lib/cli-presentation.mjs";

const authority = {
  advisoryOnly: true,
  writesRecoveryDirection: false,
  consumesContinuation: false,
  attachesProvider: false,
};

function projectExperience({ recoveryState = "no-current-checkpoint", recoveryAttention = false } = {}) {
  return {
    status: "core_ready",
    projectAction: "initialized",
    readiness: {
      core: { state: "ready" },
      product: { state: "not_activated" },
      context: { state: "curated-only" },
      recovery: {
        state: recoveryState,
        userActionRequired: recoveryAttention,
        reasonCode: recoveryAttention ? "SESSION_RESTORE_POINTER_DRIFT" : null,
        authority,
      },
    },
    runtime: { activePackageVersion: "fixture-version" },
    drift: [],
    nextAction: {
      id: "work_directly",
      summary: "The constitutional Core is ready.",
      entrypoint: { cli: "head-agent status fixture", mcpTool: "head_project_status" },
    },
  };
}

test("ordinary project status leads with the task and hides implementation details", () => {
  const output = formatProjectStatus(projectExperience());
  assert.match(output, /HEAD is ready — continue the task/u);
  assert.match(output, /no current checkpoint; ordinary Session work is available/u);
  assert.match(output, /Continue the user's original task/u);
  assert.doesNotMatch(output, /fixture-version|Command:|MCP:/u);
  assert.match(output, /grants no authority/u);

  const doctor = formatProjectStatus(projectExperience(), { doctor: true });
  assert.match(doctor, /fixture-version/u);
  assert.match(doctor, /Command:|MCP:/u);
});

test("bootstrap and restore keep the original task and authority boundary visible", () => {
  const bootstrap = formatProjectBootstrap(projectExperience());
  assert.match(bootstrap, /Continue the user's original task in this conversation/u);
  assert.match(bootstrap, /User decision: none/u);

  const restored = formatSessionRestore({
    checkpoint: {
      checkpointId: "checkpoint-secret-id",
      purpose: "Preserve the approved migration direction",
      currentPosition: "Implementation verified",
      nextExpectedResult: "Publish the bounded result",
      openReviewIds: ["review-secret-id"],
    },
  });
  assert.match(restored, /newer real user request takes priority/u);
  assert.match(restored, /this read changed no checkpoint or authority/u);
  assert.doesNotMatch(restored, /checkpoint-secret-id|review-secret-id/u);

  const attention = formatProjectStatus(projectExperience({
    recoveryState: "attention-required",
    recoveryAttention: true,
  }));
  assert.match(attention, /User decision: none for ordinary work/u);
  assert.match(attention, /ordinary work remains available when it does not depend on that checkpoint/u);
  assert.doesNotMatch(attention, /User decision: attention required/u);
});

test("decision cards present bounded choices without mechanically choosing or exposing IDs", () => {
  const onboarding = formatOnboardingGuide({
    status: "awaiting_review",
    review: {
      candidateCount: 2,
      returnedCandidateCount: 1,
      truncated: true,
      unknownCount: 1,
      candidates: [{ key: "candidate-secret-id", name: "Request processing", productKind: "Capability" }],
    },
  });
  assert.match(onboarding, /Options: accept all, accept a selection, revise, or reject/u);
  assert.match(onboarding, /Core supplies no automatic disposition/u);
  assert.match(onboarding, /more candidates require inspection before a complete accept-all review/u);
  assert.doesNotMatch(onboarding, /candidate-secret-id/u);

  const mapping = formatFeatureMappingStatus({
    status: "awaiting_review",
    candidateSet: { candidates: [{ candidateId: "mapping-secret-id" }] },
  });
  assert.match(mapping, /evidence-linked mapping proposal/u);
  assert.match(mapping, /Recommendation: none is generated mechanically/u);
  assert.doesNotMatch(mapping, /mapping-secret-id/u);
});

test("Run and conformance projections never promote evidence into approval or a global gate", () => {
  const pending = formatPendingReview({
    review: {
      wholePlan: { objective: "Complete one bounded migration" },
      resultPacket: { summary: "Worker reported success", evidence: ["fixture"] },
      reviewProtocol: { allowedDispositions: ["accept", "revise"] },
    },
  });
  assert.match(pending, /Worker or ResultPacket completion is not acceptance/u);

  const queue = formatConformanceQueue({
    totalMatches: 1,
    findings: [{ status: "open", claim: { summary: "Possible policy drift" } }],
  });
  assert.match(queue, /Ordinary work is not blocked/u);
  assert.match(queue, /evidence, not a violation or decision/u);

  const finding = formatConformanceFinding({
    finding: { claim: { summary: "Possible policy drift", riskHint: "low" }, evidenceAnchors: ["anchor"] },
    resolutions: [],
  });
  assert.match(finding, /neither blocks ordinary work nor authorizes a fix/u);

  const outcome = formatReviewOutcome({
    reviewDecision: { disposition: "accept-all" },
    authorityEffect: "explicit-product-canon-transition",
  });
  assert.match(outcome, /Product Canon changed: yes, through the scoped ReviewDecision/u);
  assert.match(outcome, /semantic correctness remains subject to the user's decision/u);
});
