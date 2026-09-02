# Session restore and reviewed-result integration

This contract implements the provider-neutral outcomes of the original HEAD
Session restore and worker-result integration flow without resuming a hidden
provider conversation or embedding Herdr-specific process, pane, CLI, socket, or
TUI behavior.

## Original Feature mapping

The original source numbering is preserved rather than repurposed:

| Original Feature | Original outcome | This plugin's relationship |
|---|---|---|
| HF-007 | continue through context compaction | implemented by the separate provider-neutral compaction recovery contract |
| HF-008 | restore a prior HEAD OpenCode Session | artifact-only restore reproduces the semantic consumer input; provider `ses_*` resume is intentionally not claimed |
| HF-009 | dispatch an independently ownable worker task | belongs to the separate bounded runtime/coordination vertical; this integration transaction is not dispatch |
| HF-010 | integrate a completed worker branch | represented provider-neutrally by accepted ResultPacket review plus explicit HEAD-owned checkpoint integration |

This mapping distinguishes behavioral equivalence from ritual parity. It does not
rename provider-loss continuity as HF-010 or claim that a checkpoint transaction
alone closes the original dispatch/wait lifecycle.

## Authority boundary

| Artifact | Plane | Role |
|---|---|---|
| `WholePlanSnapshot`, `ExecutionContract`, `ContextCapsule`, `Run`, `SessionRunCheckpoint` | P2 | recoverable project execution lineage and exact next direction |
| `ReviewDecision` | P1 | Fresh HEAD's explicit normative judgment |
| `BoundedWorkerDispatch`, `ResultPacket`, `RunResultIntegrationRequest`, `RunResultIntegrationReceipt` | P3 | worker ownership, result, and integration evidence only |
| `SessionRestoreProjection` | P4 | non-persisted, reproducible consumer view |
| `ContinuationOutcome`, `BoundedWorkerWaitOutcome`, execution lease/process | P5 | optional live attachment and operational progress only |
| `BoundedWorkerWave`, seal, abandonment | P3 | same-lineage multi-dispatch grouping and non-success handoff evidence |
| `WorkerWaveStatusProjection`, `WorkerWaveResultProjection` | P4 | non-persisted launch-wave views |
| `BoundedWorkerWaveWaitOutcome` | P5 | bounded sealed-wave observation only |

The planes are not a persistence ranking. A P3 ResultPacket can be absent after
checkpoint creation without changing P2 direction. A P1 ReviewDecision can
accept a result, but it does not replace the P2 Session checkpoint. The
integration operation receives `purpose`, `approvedDecisions`, `currentPosition`,
and `nextExpectedResult` explicitly; neither a worker reply nor ResultPacket is
allowed to author those fields.

## Artifact-only Session restore

`session-restore` starts from the current canonical checkpoint pointer and:

1. digest-verifies the content-addressed `SessionRunCheckpoint`;
2. requires current protocol `0.3.0` and its immutable `sessionPointer`;
3. compares that pointer byte-semantically with `.head/sessions/current.json`;
4. re-verifies the current WholePlan and, when active, exact Run,
   ExecutionContract, and ContextCapsule digest;
5. re-verifies pending review lineage when ResultPacket evidence is present;
6. returns a deterministic, non-persisted `SessionRestoreProjection`.

The read-only project experience may run this exact verification to report
`no-current-checkpoint`, `verified-current-checkpoint`, or
`attention-required`. That readiness view does not return recovery direction,
consume a continuation token, or attach a provider. HEAD reads the full restore
projection only when a verified current checkpoint exists.

The projection carries the checkpoint's exact purpose, position, and next
expected result as the consumer instruction. It does not read or persist a
provider session ID, transcript, or summary and does not enable provider resume
or streaming. Pointer drift, tamper, missing P2 lineage, or a historical
checkpoint fails closed rather than reconstructing plausible state.

`head_conversation_enter` is the automatic conversation-facing composition of
this same read-only restore. The Skill calls it without making the user request
recovery or supply an identity. No current checkpoint means ordinary work
continues; verification failure pauses only recovery-dependent work. Explicit
`session-restore` remains available for diagnostics and adapter integration.

If P3 ResultPacket evidence was deleted after checkpoint creation, restore still
returns the exact P2 direction and marks the evidence `missing-evidence`; it does
not manufacture a Fresh HEAD review context. The caller must recover or reproduce
the required evidence before review.

Protocol `0.1.0` and `0.2.0` checkpoints remain readable through the checkpoint
reader for audit and compaction compatibility. They cannot drive current
artifact-only restore because they predate the immutable Session pointer. The
public `head checkpoint` command now writes only the canonical content-addressed
P2 format. The old direct time-based API is retired and cannot advance
`latestCheckpoint`.

## Bounded reviewed-result integration

The connected flow is:

```text
BoundedWorkerDispatch (P3)
  -> at-most-once lease / supervised provider / bounded wait (P5)
  -> ResultPacket (P3)
  -> deterministic Fresh HEAD review projection
  -> explicit accept ReviewDecision (P1)
  -> explicit integration input owned by HEAD/user direction
  -> SessionRunCheckpoint (P2)
  -> RunResultIntegrationReceipt (P3)
```

`worker-dispatch` binds one registered non-HEAD role to the exact current Run
`ExecutionAuthorization`. The same role may retry idempotently; a competing role
conflicts, and the authorization can be consumed only once. `worker-wait` returns
a non-persisted operational outcome. It cannot mutate the WholePlan, supply
recovery direction, or create a ReviewDecision. `worker-apply` accepts only a
completed actual-provider result with verified native supervision and creates
only the ResultPacket plus Fresh HEAD review context. Explicit review and the
integration transaction below remain separate.

Multiple existing dispatches may be viewed through the provider-neutral wave
contract in [`bounded-worker-wave.md`](bounded-worker-wave.md). Wave seal is
start-evidence aggregation, not result acceptance. Wave `completed` means all
members succeeded operationally; each member still requires its own ResultPacket,
Fresh HEAD ReviewDecision, and explicit HF-010 checkpoint integration.

## P2-first optional live continuation

`session-continue` always calls artifact restore before consulting a provider or
workspace host. A trusted host-injected adapter may then fresh-verify the exact
current HEAD attachment. Its `ContinuationOutcome` is P5 and non-persisted. It
records either `attached` or a disclosed `fresh-logical-head` fallback, keeps the
same checkpoint and restore projection, and never reads provider summary or
transcript. Provider session identifiers are neither canonical nor persisted.
Attach failure therefore changes conversation convenience, not HF-008 semantic
recovery.

`run-integrate-checkpoint` requires the exact reviewed Run and ReviewDecision.
Core re-verifies the Run, ResultPacket, WholePlan, ExecutionContract,
ContextCapsule, Fresh HEAD review identity, current Session state, and `accept`
disposition before writing anything. `revise`, `expand`, `rollback`, and
`escalate` stay on their normal next-plan or user-direction paths and cannot be
mislabeled as result integration.

One ReviewDecision may bind to at most one recovery checkpoint. An identical
retry returns the existing checkpoint and receipt. A retry with a different
purpose, position, decision set, open-review set, or next expected result fails.
After the complete accepted lineage preflight, a create-only P3 integration
request freezes those normalized inputs before any checkpoint write. Concurrent
identical requests converge on that request and a reviewed-time-derived checkpoint
identity; a concurrent different request fails before creating another checkpoint.
The P2 checkpoint binds the request ID and input hash, so direct lower-level
checkpoint construction cannot bypass the transaction or substitute another
recovery direction. The request remains P3 transaction provenance, not recovery
authority: after the checkpoint is verified, deleting the request or ResultPacket
cannot change or block artifact-only restore from the self-contained P2 fields.
If a process stops after the checkpoint write but before receipt creation, a
retry finds the sole verified integration checkpoint and completes only the
missing create-only receipt.

The receipt records that no ReviewDecision was created by integration and that
the ResultPacket is reference evidence only. Deleting that ResultPacket later
does not change the checkpoint or restore projection's next direction.

## Public surfaces

```text
head checkpoint <project> --summary <text> [--next <text>]
head session-restore <project> [--checkpoint <checkpoint-id>]
head session-continue <project> --runtime <codex|opencode> [--checkpoint <checkpoint-id>]
head worker-dispatch <project> --authorization <authorization-id> --role <non-head-role>
head worker-wait <project> --authorization <authorization-id> [--wait-timeout-ms <milliseconds>]
head worker-execute <project> --authorization <authorization-id> --role <non-head-role>
head worker-apply <project> --authorization <authorization-id>
head worker-wave-create <project> --input <wave.json>
head worker-wave-seal <project> --wave <bounded-worker-wave-id>
head worker-wave-status <project> --wave <bounded-worker-wave-id>
head worker-wave-wait <project> --wave <bounded-worker-wave-id>
head worker-wave-abandon <project> --input <abandonment.json>
head run-integrate-checkpoint <project> --input <integration.json>
head run-integration-read <project> --review <review-decision-id>
```

Typed MCP exposes continuation, dispatch/status/wait/apply, restore, and explicit
integration. Restore, status, and wait are read-only. Continuation may refresh
only the injected host-local P5 attachment; dispatch and application are
idempotent project-state writes. None grants review, Canon, publication, or
external-action authority.

Fresh-process tests run restore with distinct Codex and OpenCode provider-session
environment values and require the same projection identity with neither value
present in the result. Counterexamples cover Session pointer drift, missing
ResultPacket evidence, non-accept review, divergent replay, and CLI/MCP parity.

`npm run verify:hostless-session-recovery` adds the resident-consumer proof. One
fresh process integrates, independent Codex/OpenCode-labeled processes restore
the same projection and execute one read-only next move, and injected inbox text
cannot author that move. The verifier also covers request-before-checkpoint and
checkpoint-before-receipt crash recovery, deletion of P3 request and ResultPacket
evidence, concurrent identical and divergent integration, and non-accept review.
It requires no Git repository, GraphDB, WorkspaceHost, Herdr process, or provider
session resume.
