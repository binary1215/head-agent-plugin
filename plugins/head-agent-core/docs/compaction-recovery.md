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

## Automatic conversation UX

`head_conversation_enter` is the normal read-only entry path. The Skill calls it
on project entry, after compaction, and after provider replacement. It has three
bounded outcomes:

- a current checkpoint verifies and its exact P2 direction is restored;
- no checkpoint exists and ordinary work continues without a recovery gate; or
- checkpoint integrity needs attention, which pauses only checkpoint-dependent
  work and never invents direction.

The same call includes the bounded project-status, Attention, loaded/configured
package-version, and presentation projections, so normal entry does not require
a second status call. Recovery verification failure is `headActionRequired`, not
a user decision. `userDecisionRequired` remains false unless an independent
protected decision is actually pending, and `ordinaryWorkBlocked` remains false.

The user does not provide checkpoint identities, lifecycle events, trusted turn
counters, or continuation tokens. Explicit `session-restore` and `compact-*`
commands remain advanced diagnostic surfaces.

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

`compact-continue` revalidates the current checkpoint, Session, Run, and epoch immediately before consuming the checkpoint-bound token through an atomic create. A newer checkpoint invalidates the old continuation even without a new user turn. A successful consumption returns the exact checkpoint plus a bounded continuation instruction; a second consumption fails. The returned `CompactionRecoveryReceipt` is derived evidence with no instruction, recovery, objective-rewrite, Product Canon, or review authority.

Prepare validates its inputs and any existing open epoch before changing the
current checkpoint. Mutating Session/Run recovery operations share a transient
project-local P5 lock; reads never acquire it. Contention asks the caller to retry
the affected operation, not the user to approve it. An interrupted prepare closes
only its uncertain token epoch on the next mutation, preserving the complete P2
checkpoint that was actually published. This is process-interruption recovery,
not a guarantee of power-loss durability. A dead local owner can be reclaimed;
an unknown or foreign-host owner is not guessed dead. A reused PID can require
Host-side ownership inspection and operational lock cleanup; Core does not steal
a possibly live lock based on age. This does not block read-only or ordinary work.

## Provider-neutral Host lifecycle boundary

The Core does not invoke provider compaction. An injected Host adapter may expose
one journaled `conversation-entry`, `provider-replaced`, `before-compaction`, or
`after-compaction` event at a time. Its descriptor is fixed to P5, carries no
recovery/instruction/promotion authority, and promises not to replay an uncertain
mutation. Events contain the exact Project, HEAD Session, runtime, monotonic
trusted real-user-turn sequence, and only for post-compaction an epoch plus the
bounded outcome `succeeded`, `failed`, or `uncertain`. Provider session IDs,
transcripts, summaries, prompts, credentials, PIDs, sockets, and UI identities
are rejected from this contract.

`head_compaction_lifecycle_step` processes the event without exposing those
operational fields to the user:

1. Before compaction it reuses an exact current checkpoint when possible. If new
   recovery direction is needed, provider HEAD authors it from the current user
   direction, existing approved decisions, and verified P2 lineage only; it may
   not invent an approval, and the user is not asked to fill a schema.
2. The raw token is retained only by the Host adapter and never returned from the
   lifecycle result or persisted in project Canon.
3. After a reported success, Core performs artifact-only P2 restore first, then
   verifies the exact epoch/checkpoint/current turn and consumes at most once.
4. A newer real user turn supersedes the old continuation. An uncertain outcome
   is not verified, continued, or automatically replayed. Provider failure aborts
   only the epoch.
5. If transport continuation is unavailable after successful P2 restore, the
   epoch is closed and HEAD continues as a disclosed fresh logical HEAD from the
   verified artifacts.

With Codex or another runtime that lacks a native compaction hook, automatic
first-turn artifact restore still works. The provider UI or another trusted Host
remains responsible for the actual compaction action; missing hooks do not block
ordinary work.

```text
head compact-prepare <project> --input <recovery.json>
head compact-verify <project> --input <verification.json>
head compact-continue <project> --input <continuation.json>
head compact-status <project>
head compact-abort <project> --input <abort.json>
```

The mutating commands are advanced `help-all` operations; read-only
`compact-status` remains a light diagnostic. Observe and ordinary Session work
create no epoch by default. An active Run should prepare at a natural idle
boundary before provider compaction. Compaction never approves an open review,
changes Product Canon or candidate bytes, or performs an external write. Explicit
prepare may publish HEAD-authored P2 direction as a new checkpoint; provider
compaction and continuation never author or replace that direction.

Host integration additionally uses `head_conversation_enter` and
`head_compaction_lifecycle_step`; they are not a user setup ritual. The lifecycle
step is non-blocking-unavailable when no adapter is injected.

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
