# Recovery meaning, current facts and scoped World freshness

Ordinary recovery reads historical checkpoint meaning alongside current selected
Session/Run/review facts and common ProjectDirection. Those current pointers need
not equal the checkpoint's past pointers. `SessionRestoreProjection` 0.2 preserves
checkpoint bytes and exposes `currentExecution`. Old position/next result lives
under `consumerInstruction.historicalCheckpointContext`, not a new instruction.
HEAD judges the next action; historical approval is not current effect authority.
The P4 projection's version does not change immutable P3 integration protocols:
existing 0.1 integration requests/receipts keep their original validation and bytes.
Entry is read-only; absent checkpoints do not gate ordinary work. The existing
optional basis/sync publishes useful new HEAD-authored meaning, not a repair
ritual after every Run. One-shot compaction still requires the exact epoch,
checkpoint, Run/Session target, trusted user turn and unconsumed token.

## Storage is not execution replay

`run-start --contract <id> [--start-request <key>]` and typed MCP
`head_run_start` share the Core transaction. HEAD/Host supplies the optional Core
request key once and retains it for retries; users need no key form or prepare
call. Identity is stored inside the existing Run, not a global ledger. Same
key/different input conflicts; same contract/different key is a new request.
Key-less normal starts remain valid; uncertain key-less delivery cannot be
guessed from the newest Run or contract.

Run/Result/Decision/Session publication is recoverable multi-file storage, not
power-loss atomicity. Existing exact artifacts/preimages can complete missing
Session writes inside the related mutation. Missing evidence is never invented;
read-only diagnosis never repairs. Historical start acknowledgment is
`run_start_already_committed`, `executionReplayAllowed: false`: it does not
reactivate the Run or launch a worker/provider. Current lease/action checks
remain required for execution. `canonicalCommit: committed` reports storage,
not work success/review accept. `projectionUpdate` discloses index loss without
making the original transition a retry target. Unknown external effects remain
non-replayable pending their existing ownership/lease evidence.

## Logical Session selection

Explicit `session_id`/`--session`, deliberate sharing and legacy default remain.
An embedding Host may inject branded `createSessionCallContext` per caller, or
resolve one per request. This is P5, not provider identity in Canon or one
shared-process selector. Known loss makes selected-Session reads/mutations
unresolved while common direction and independent graph/code discovery continue.
Explicit verified selection can restore only that caller's binding.
If an optional Host resolver fails, a verified explicit Session still routes the
current request. MCP `_meta.headSessionBinding` discloses unavailable persistence;
it does not claim binding for later requests. Without explicit selection or a
verified binding, dependent calls remain unresolved. CLI information and audited
Project-only evidence calls share MCP's independence boundary. Views that expose
the selected Session (including Product operating status) still require binding.

Packaged Codex/Claude/OpenCode stdio configurations do not currently supply
trusted persistent caller context. Their explicit/default behavior remains;
injected-context fixtures are local Host evidence, not proof of automatic
selection restoration after compaction on all three products.

## World domains

Full World digests still include runtime. World 0.19 stores analysis/domain bases
inside the existing snapshot; history remains digest-readable without migration.
Freshness distinguishes code/Product/Git/observations/captured runtime. Captured
runtime keeps its original Session owner; selected Session facts are separate.
Code queries validate the source path/digest set, scope and analysis basis without
first loading unrelated current Product/runtime readers. Runtime/checkpoint
changes do not invalidate verified IMPORTS/CALLS; real code/scope/analyzer changes
do. Missing legacy analysis basis is unknown with original-source fallback,
not a mandatory refresh/upgrade gate.

Mixed traversal filters domain-ineligible nodes/edges before expansion, preserving
GraphSnapshot ID/hash and disclosed omissions. Unsupported adapter masking uses
embedded traversal, not remote writes. Context includes verified domains instead
of dropping all code when aggregate World is stale. A useful existing refresh
is authorized HEAD maintenance, not a user form or per-turn full refresh duty.
Deterministic traces verify calls/storage/instructions/fallback, not actual model
questions, cognition, latency, token or cost improvements.
