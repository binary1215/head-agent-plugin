# Worker context and HEAD integration

Use this guide when preparing a bounded worker or combining multiple results. It clarifies existing contracts; it adds no execution capability, required template or ordinary Session gate.

## Fresh context is the supported default

The plugin currently executes fresh one-shot provider requests. Native conversation fork is **not supported** by its worker path. An app's fork command is not evidence of a bounded HEAD Host integration and is not a substitute launch route. Conversation-history copying and checkout isolation are separate concerns. This guide claims no speed or cost advantage.

Compose only the context the outcome needs: purpose, expected result, non-HEAD role, owned files/actions, exclusions, selected evidence, verification expectations and unresolved questions. These are useful brief contents, not mandatory fields or a user-authored form. For implementation that depends on prior reasoning, select relevant design background. For independent review or counterexample search, prefer fresh context grounded in the contract and raw evidence rather than the parent's conclusion. Do not automatically transmit raw history or secrets to another provider; preserve existing destination and permission boundaries.

Define the actual execution input **before authorization**:
- Session: include the needed brief in `sessionRequest` before creating its authorization; supply the exact authorized bytes at execution.
- Run: establish the accepted plan, contract and Capsule before authorization. Members of one wave share the exact Run lineage; the runtime does not automatically narrow that contract for each worker or inject a role file.
- `workerRole` is dispatch ownership metadata, not automatic runtime instruction injection or a file-access sandbox. Put required boundaries in the authorized input; a prompt alone is not isolation. If a needed instruction is absent, resolve it through the existing contract/authorization path before execution. Do not append instructions/history to digest-bound input or reuse a consumed authorization.

Bind execution to the exact canonical project root. Do not reuse an authorization in a different worktree merely because the files look identical. Within the supported root, separate file ownership when helpful or serialize conflicting edits; leases do not detect every file conflict or stale source basis. Read-only work does not require a new worktree.

## Gather while the Run is still valid

Collect wave status and individual invocation evidence before finishing the Run. Wave operations revalidate current Session/Run/plan/contract/Capsule lineage; do not expect the old wave aggregate to remain readable after a transition. Preserve returned exact references through existing stores and [artifact storage conventions](artifact-storage.md), not a new manifest.

For an unsealed partial launch, use existing individual worker wait/result surfaces and wave status/abandonment; do not force a seal or treat it as success. A `failed` wave may still have running members. Check individual execution/lease state and the existing Host-owned cancellation/cleanup path. Abandonment is evidence, not process termination. For uncertain execution, inspect existing records and ownership before any retry; a fresh fallback must not duplicate a possibly running or already consumed execution.

The coordinating HEAD is a logical role, not a conversation process that must stay alive. After compaction/provider loss, restore verified P2 direction through the existing recovery path before continuing coordination. If a stale wave or Session pointer is rejected, revalidate current lineage and individual durable records; a provider summary cannot bypass that rejection or invent recovery direction.

## One whole Run result, not repeated fragment application

A Run has one ResultPacket. Sequentially applying fragments with `worker-apply` or separate `run-finish` calls is not merging: a different second finish conflicts with the first. Wave completion is operational evidence, not whole-task acceptance.

Example: worker A reports a parser change and worker B reports an independent diagnostic change. While the exact Run remains valid, HEAD reads both individual results and checks their source basis, missing or duplicated work, conflicting edits, failures and unresolved questions. Verify dependent behavior in the combined working state; two isolated passes do not prove the integrated result. Resolve the actual mismatch or report it honestly rather than manufacturing a pass.

HEAD then prepares **one** existing finish input with the whole outcome, both actual evidence references, combined verification and remaining unknowns, and finishes once:

```text
head run-finish <project> --input <combined-result.json>
```

This is the existing CLI input, prepared by HEAD rather than a new user form. It does not automatically merge files, derive truthful verification, or import all invocation lineage. Preserve relevant exact invocation/result references as evidence. Finish moves the Run into pending review; collect necessary active-Run evidence first.

The combined ResultPacket still follows existing Fresh HEAD review, exact ReviewDecision and explicit P2 checkpoint integration. Fresh HEAD is currently a review projection built from verified artifacts, not a guarantee of an independent model or conversation. A successful worker or aggregate cannot approve itself or author checkpoint direction.

Keep the separate single-result route: when one verified provider Run draft satisfies the entire contract, existing `worker-apply` may apply that one result, followed by the same review/integration boundary. It is not a fragment accumulator. Ordinary Session worker results remain evidence consumed by HEAD; do not impose Run review or P2 integration on them.

## Future fork is a separate Host proposal

Before claiming native fork support, a Host implementation would need evidence of selected-history/privacy boundaries and copy timing, pre-execution role/tool/root/authorization/lease binding, start and uncertain-outcome observability, at-most-once behavior, partial-launch cancellation/cleanup and P2-first recovery. These are future engineering acceptance conditions, not a checklist imposed on ordinary users. No real Host fork or live-model integration is demonstrated by synthetic artifact tests.

See [wave operations](bounded-worker-wave.md), [execution lineage](execution-lineage.md) and [Session recovery](session-recovery.md) for the existing contracts.
