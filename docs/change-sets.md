# Provider-neutral ChangeSet and reviewed impact

Read [`ULTIMATE_GOAL.md`](ULTIMATE_GOAL.md) before changing this contract.

## Purpose and authority

ChangeSet protocol `0.1.0` records one reviewed logical change independently from Git commits, branches, providers, or executor attempts. A ChangeSet is created only from:

- the verified World Model and temporal GraphSnapshot pinned by an ExecutionContract ContextCapsule;
- a different, current post-execution World Model and SourceSnapshot;
- the matching ResultPacket;
- an accepted execution ReviewDecision.

It records exact added, modified, and removed `File`, `Symbol`, and `Test` revisions. It has reviewed change-lineage status but no instruction or promotion authority. Operational World Model identities are excluded from the ChangeSet body because they may include optional Git, runtime, or physical projection inputs; the Git-independent GraphSnapshot, SourceSnapshot, revision, ResultPacket, and ReviewDecision identities form the semantic record. Git may later attach optional `VcsEvidence`; no `.git` directory or commit identity is required.

## Two-stage identity boundary

The pre-change and post-change snapshots are fixed before the ChangeSet exists. The ChangeSet is then projected by a subsequent World Model rebuild. This avoids a self-referential graph identity: adding a ChangeSet changes the GraphSnapshot and World Model projection, but not the already-fixed observed SourceSnapshot identity.

ChangeSets contain sorted zero-or-more `parentChangeSetIds`. Multiple parents are valid from protocol `0.1.0`; automatic merge, ancestry discovery, conflict detection, and conflict resolution remain deferred.

## Impact candidates and review

The plugin compares exact before/after revisions and follows only existing reviewed `IMPLEMENTS` and `VERIFIED_BY` receipts to infer Feature or Capability impact. Inference creates an immutable `ChangeImpactCandidateSet`. It never creates `IMPACTS` directly.

An explicit change-impact ReviewDecision may:

- `accept-all`;
- `accept-selection` with named candidate IDs;
- `reject`.

Acceptance creates a separate immutable `ReviewedImpact` receipt and a reviewed `ChangeSet -[:IMPACTS]-> Feature|Capability` edge. Rejection creates no canonical impact edge. Candidate nodes remain excluded from normal traversal and every Context Capsule; explicit read-only traversal may opt in.

If no reviewed mapping connects changed code or tests to Product Canon, the candidate set records an open Unknown and remains `awaiting-evidence`.

## Commands

```text
node scripts/head.mjs change-set-record <project> --input <change-set.json>
node scripts/head.mjs change-set-status <project>
node scripts/head.mjs change-set-read <project> --change-set <change-set-id>
node scripts/head.mjs change-impact-candidates <project> --candidate-set <candidate-set-id>
node scripts/head.mjs change-impact-review <project> --input <review.json>
node scripts/head.mjs change-impact-review-read <project> --review <review-decision-id>
```

Minimal recording input:

```json
{
  "resultPacketId": "result-packet-<24-hex>",
  "reviewDecisionId": "review-decision-<24-hex>",
  "parentChangeSetIds": []
}
```

`beforeWorldModelId` is optional. When omitted, the core recovers the exact World Model pinned by the ExecutionContract ContextCapsule. The current post-change World Model must be fresh and must contain a different SourceSnapshot.

Review input:

```json
{
  "candidateSetId": "change-impact-candidates-<24-hex>",
  "disposition": "accept-all",
  "acceptedCandidateIds": [],
  "rationale": "Reviewed revision evidence supports the impact."
}
```

The read-only MCP tool `head_change_set_status` exposes verified state without recording or reviewing anything.

## Project artifacts

```text
.head/change-sets/current.json
.head/change-sets/records/change-set-*.json
.head/change-sets/impact-candidate-sets/change-impact-candidates-*.json
.head/change-sets/impact-review-decisions/change-impact-review-decision-*.json
```

Every artifact and pointer is content-derived and digest-verified. Source drift, unaccepted execution review, mismatched ResultPacket/ReviewDecision, missing pinned snapshots, stale candidate identity, tampering, active/pending Run conflict, and empty revision difference fail closed.

## Deferred boundaries

Optional `VcsEvidence -> GitCommit` attachment, automatic ChangeSet creation from CI or filesystem events, general execution-lineage graph projection, merge automation, imported ticket/backlog adapters, conformance findings, document projection, `GraphProjectionAdapter`, and GraphDB acceleration remain deferred.
