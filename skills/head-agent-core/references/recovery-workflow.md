# Recovery and compaction

Read historical meaning from the exact content-addressed checkpoint alongside
current selected Session/Run facts and `.head/project.json`. Do not require past
execution pointers to equal current ones or replay the historical next action.
`consumerInstruction.historicalCheckpointContext` is historical context; HEAD
judges current action using `currentExecution` and common direction. The legacy
`.head/sessions/current.json` remains the default record. Apply current common
project direction too: an old checkpoint cannot undo a later shared cancellation. Provider resume or live attachment is
optional and occurs only after artifact recovery succeeds.

The presence of a HEAD Project does not imply a current checkpoint. Reuse
sufficient verified current entry context already supplied for the exact Project
and selected logical Session, with current common direction and cancellations.
When needed content is missing, use `head_conversation_enter` as the automatic
read-only entry path; relevant basis changes require only affected current
originals, not a repeated setup/status chain. It performs the same artifact-only
verification as explicit Session restore without consuming a token, attaching a
provider, or writing state, and includes bounded status and Attention facts
without a second status call. Detailed World inspection is explicitly unchecked
on ordinary entry; full status/doctor diagnosis is available when needed. Keep
`head_session_restore` as an advanced diagnostic surface. When recovery needs
attention, fail only the affected recovery operation and assign inspection to
HEAD; never invent missing direction or ask the user to operate the recovery
protocol.

When that recovery state needs a precise explanation, use read-only
`head_checkpoint_diagnose`. It reuses the common project/conversation diagnosis
and reports pointer presence, artifact-restore verification, mechanical sync
availability, and the next HEAD action. Do not call another model merely because
this projection was read, do not treat it as an atomic filesystem snapshot, and
do not infer semantic freshness from matching IDs or hashes. A changed observed
sequence requires another read; integrity failure, a missing pointed artifact,
required-reference drift, and optional ResultPacket loss remain different cases.
This is an exception/diagnostic surface, not a per-turn ritual or a new gate.

When durable recovery direction may have materially changed, HEAD first decides
whether a checkpoint is useful. Relevant boundaries are: a user changes the
current objective or constraint while a checkpoint already exists; a verified
stage completes; work enters a failure or waiting state; the whole task
completes; or a handoff, context-loss, or durable-Run boundary is approaching.
Only when persistence is useful, call read-only `head_checkpoint_basis`. From
that exact returned Project, Session,
lineage, review, and transition basis, freshly derive the bounded recovery
direction in the current provider HEAD, then call `head_checkpoint_sync`. Never
resubmit old direction by replacing only `expected_recovery_basis_id`. Core can
verify identity and concurrency, not whether natural-language reasoning was
fresh. Handle `reused` and `created` silently; on `deferred` recover the named
exact Run/compaction transition first; on `conflict` read a new basis and derive
again. Do not ask the user to save, confirm, or fill this schema. Do not create a
first checkpoint for short Observe work, every turn, or conversation entry, and
do not call sync when the existing direction is already sufficient.
General sync must not carry reviewed-Run integration fields; only the existing
accepted-result integration operation owns that binding.
`head_checkpoint_diagnose` is not a substitute for this fresh basis: even when it
reports that publication is mechanically possible, read a new exact basis before
deriving direction and calling sync.

Compaction is an intentional lossy provider operation. When the Host exposes a
trusted lifecycle event, call `head_compaction_lifecycle_step`: provider HEAD
authors current bounded direction only when an exact current checkpoint cannot
be reused. It may restate only current user direction, existing approved
decisions, and verified P2 lineage; it must not invent an approval. The Host
retains the one-shot token in P5 and reports bounded
`succeeded`, `failed`, or `uncertain` outcome; Core restores P2 before verify or
continue. Do not ask the user for lifecycle event, epoch, turn, or token fields.
If no lifecycle Host is injected, artifact entry recovery remains automatic and
ordinary work remains available; actual provider compaction stays Host-owned.
A provider summary, transcript, graph, Capsule, ResultPacket, or continuity view
must never rewrite purpose, approved decisions, current position, or next
expected result. A newer user turn supersedes continuation, and an uncertain
provider outcome is never replayed automatically. Read
[compaction recovery](../../../docs/compaction-recovery.md) before recovery-sensitive compaction.
