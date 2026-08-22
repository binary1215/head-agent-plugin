# Compaction recovery

Compaction is a lossy provider operation. Recovery authority remains the canonical Session/Run checkpoint; provider transcripts, compaction summaries, provider-session identities, and `HEADContinuitySnapshot` are orientation or derived views only.

Protocol `0.3.0` embeds the P2 recovery/lineage boundary from
[`authority-plane-contract.md`](authority-plane-contract.md). A ResultPacket or
Worker Report is P3 evidence, not a prerequisite for reading the checkpoint's
purpose, approved decisions, current position, or exact next expected result.
Deleting ResultPacket evidence after checkpoint creation is covered by an
executable recovery test; it cannot turn a summary, graph, inbox, or provider
session into recovery authority.

Checkpoint authority metadata states that recovery fields come only from explicit
HEAD/user direction plus verified P2 lineage. P3 evidence may be referenced for
audit but is never a recovery-field source; general non-amplification tests reject
P3, P4, and P5 attempts to become P2.

## State transition

```text
idle -> prepared -> provider_compacted -> verified -> continued
                                      \-> superseded
                                      \-> aborted
```

`compact-prepare` creates a content-addressed `SessionRunCheckpoint` with:

- `purpose`
- `approvedDecisions[]`
- `currentPosition`
- `nextExpectedResult`
- an immutable `sessionPointer` over the current Session mode, Run/review pointers,
  last result/review references, and required next-plan action
- a verified active-Run pointer, when a Run is active
- an optional verified accepted-Run integration reference
- open review references

An active-Run pointer binds the exact Run, WholePlanSnapshot, ExecutionContract, and ContextCapsule digest. The checkpoint—not the Capsule—owns recovery direction.

The immutable Session pointer makes provider-independent artifact restore
falsifiable: the current Session canon must still match the checkpoint exactly.
Protocol `0.1.0` and `0.2.0` checkpoints remain digest-readable for audit, but
they do not contain the complete pointer required by current artifact-only
restore. See [Session restore and reviewed-result integration](session-recovery.md).

The same operation creates one `CompactionEpoch`. The epoch contains the checkpoint identity, the real-user-turn sequence at preparation, state, and a hash bound to an unguessable continuation token. The raw token is returned once and is not persisted. No provider-session identity is stored.

`compact-verify` accepts explicit provider-success evidence and the current trusted real-user-turn sequence. It re-reads and digest-verifies the checkpoint and current Session/Run pointers. A newer real user turn supersedes the continuation. Provider failure, checkpoint tamper, state drift, or a non-canonical recovery source aborts or rejects recovery; the Core never fills missing direction from a summary.

`compact-continue` consumes the checkpoint-bound token through an atomic create and returns the exact checkpoint plus a bounded continuation instruction. A second consumption fails. The returned `CompactionRecoveryReceipt` is derived evidence with no instruction, recovery, objective-rewrite, Product Canon, or review authority.

## Explicit provider boundary

The Core does not invoke provider compaction. With Codex or another runtime that lacks a native compaction hook, use the provider UI or a trusted adapter between prepare and verify. The adapter supplies monotonic real-user-turn evidence; synthetic continuation does not advance that sequence.

```text
head compact-prepare <project> --input <recovery.json>
head compact-verify <project> --input <verification.json>
head compact-continue <project> --input <continuation.json>
head compact-status <project>
head compact-abort <project> --input <abort.json>
```

These are advanced `help-all` commands, not part of the light default surface. Observe and ordinary Session work create no epoch by default. An active Run should prepare at a natural idle boundary before provider compaction. Compaction never approves an open review, changes Product Canon or candidate bytes, performs an external write, or replaces a recovery checkpoint.

Example prepare input:

```json
{
  "runtime": "codex",
  "userTurnIdAtPrepare": 42,
  "purpose": "Preserve the accepted whole outcome",
  "approvedDecisions": ["The provider summary is not recovery canon"],
  "currentPosition": "Implementation is complete; integrated verification remains",
  "nextExpectedResult": "A verified integrated test result",
  "openReviewIds": []
}
```

Verification requires `epochId`, `checkpointDigest`, `currentUserTurnId`, and `providerCompacted: true`. Continuation requires `epochId`, the one-time `continuationToken`, and `currentUserTurnId`.
