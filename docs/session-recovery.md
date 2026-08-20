# Session restore and reviewed-result integration

This contract implements the provider-neutral outcomes of the original HEAD
Session restore and worker-result integration flow without resuming a hidden
provider conversation or embedding Herdr-specific process, pane, CLI, socket, or
TUI behavior.

## Authority boundary

| Artifact | Plane | Role |
|---|---|---|
| `WholePlanSnapshot`, `ExecutionContract`, `ContextCapsule`, `Run`, `SessionRunCheckpoint` | P2 | recoverable project execution lineage and exact next direction |
| `ReviewDecision` | P1 | Fresh HEAD's explicit normative judgment |
| `ResultPacket`, `RunResultIntegrationRequest`, `RunResultIntegrationReceipt` | P3 | result and integration evidence only |
| `SessionRestoreProjection` | P4 | non-persisted, reproducible consumer view |

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

The projection carries the checkpoint's exact purpose, position, and next
expected result as the consumer instruction. It does not read or persist a
provider session ID, transcript, or summary and does not enable provider resume
or streaming. Pointer drift, tamper, missing P2 lineage, or a historical
checkpoint fails closed rather than reconstructing plausible state.

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
bounded worker/provider execution
  -> ResultPacket (P3)
  -> deterministic Fresh HEAD review projection
  -> explicit accept ReviewDecision (P1)
  -> explicit integration input owned by HEAD/user direction
  -> SessionRunCheckpoint (P2)
  -> RunResultIntegrationReceipt (P3)
```

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
head run-integrate-checkpoint <project> --input <integration.json>
head run-integration-read <project> --review <review-decision-id>
```

Typed MCP exposes the same Core behavior as `head_session_restore`,
`head_run_integrate_checkpoint`, and `head_run_integration`. The restore tool is
read-only. Integration is idempotent but state-writing and does not grant review,
Canon, publication, or external-action authority.

Fresh-process tests run restore with distinct Codex and OpenCode provider-session
environment values and require the same projection identity with neither value
present in the result. Counterexamples cover Session pointer drift, missing
ResultPacket evidence, non-accept review, divergent replay, and CLI/MCP parity.
