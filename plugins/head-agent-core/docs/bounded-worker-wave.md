# Provider-neutral bounded worker launch waves

`BoundedWorkerWave` adds one concise launch-wave view without turning HEAD Core
into a worker launcher, provider-session registry, or Herdr adapter. It groups
already-created and already-verified `BoundedWorkerDispatch` records beneath one
exact active Run lineage.

This is a retained managed-work contract, not the default parallel-work flow.
Use direct HEAD work or ordinary Host delegation for new work. Wave mutations
are available only through explicit maintenance of existing approved managed
tasks; history/status/wait remain available without activating that path.

## Authority and identity

| Artifact | Plane | Meaning |
|---|---|---|
| `BoundedWorkerWave` | P3 | create-only grouping evidence over existing dispatches |
| `BoundedWorkerWaveSeal` | P3 | create-only proof that every member authorization was actually consumed |
| `BoundedWorkerWaveAbandonment` | P3 | explicit non-success handoff for an unsealed partial launch |
| `WorkerWaveStatusProjection`, `WorkerWaveResultProjection` | P4 | non-persisted aggregate views |
| `BoundedWorkerWaveWaitOutcome` | P5 | bounded operational observation only |

Wave creation accepts only 2-64 existing authorization IDs. It creates no
`ExecutionAuthorization`, chooses no role, runtime, model, workspace mode, or
action, and widens no member scope. Every member retains its independent
at-most-once lease. Caller handles, provider session IDs, panes, sockets, TUI
commands, and Herdr identities are outside Core semantic state.

Read, status, result-read and wait verify the stored Project, Run relationships,
plan, contract, Capsule, dispatch and authorization hashes. They remain usable
after Run completion or Session replacement; historical evidence grants no new
execution or application permission. Create, seal and abandon additionally
require the exact current Session and active execution lineage. An unrelated
Session timestamp/checkpoint update is not execution drift. Tamper still fails
the affected read or mutation.

## Lifecycle

```text
existing BoundedWorkerDispatch[]
  -> BoundedWorkerWave(open)
  -> independent worker execution and authorization consumption
  -> explicit BoundedWorkerWaveSeal
  -> WorkerWaveStatusProjection(sealed | completed | failed)
  -> optional BoundedWorkerWaveWaitOutcome
  -> HEAD gathers individual evidence while the Run is valid
  -> one combined Run ResultPacket -> Fresh HEAD -> ReviewDecision -> P2 integration
```

The read-only status projection never creates a seal. Seal requires verified
lease consumption for every member; dispatch existence or caller assertion is
not start evidence. Aggregate result read and wave wait fail closed before seal.
`completed` means every member returned a successful terminal runtime result.
One fast terminal failure makes the sealed wave `failed`, never `completed`.

Status and wait include non-persisted HEAD guidance: whether aggregate reads are
available, whether all start evidence is present, and which started members lack
lease release evidence. This is not proof of process cleanup. HEAD can read
individual jobs before sealing; aborting wait or abandoning a wave does not
cancel members. Preserve successful results and inspect/cancel owned unfinished
members separately. CLI/MCP cards expose this distinction without a new user form.

An unsealed partial launch may receive one create-only abandonment record.
Reason codes are fixed and the optional UTF-8 summary is normalized and limited
to 256 bytes. The summary has no instruction, review, promotion, success, or
recovery authority. Seal and abandonment are mutually exclusive; identical
retries converge and divergent retries fail. Both compete for the same
create-only terminal slot, so concurrent seal/abandon attempts cannot produce
two terminal truths.

Wave completion does not apply a ResultPacket, build Fresh HEAD review, create a
`ReviewDecision`, or integrate a checkpoint. HF-009 remains independent worker
dispatch and execution ownership. HF-010 remains the later explicit reviewed
result integration path for the Run's single whole result, not each fragment.
For context selection, partial launch and the distinction between single-worker
application and HEAD's combined finish, see
[worker context and integration](worker-context-integration.md).

## CLI and typed MCP

```text
head managed-maintenance worker-wave-create <project> --input <wave.json>
head worker-wave-read <project> --wave <bounded-worker-wave-id>
head managed-maintenance worker-wave-seal <project> --wave <bounded-worker-wave-id>
head worker-wave-status <project> --wave <bounded-worker-wave-id>
head worker-wave-results <project> --wave <bounded-worker-wave-id>
head worker-wave-wait <project> --wave <bounded-worker-wave-id> [--wait-timeout-ms <0..600000>]
head managed-maintenance worker-wave-abandon <project> --input <abandonment.json>
```

Typed MCP uses the same Core functions and identities. Mutation tools are exposed
only by the separate `scripts/mcp-managed-maintenance.mjs` stdio server; ordinary
MCP retains read/status/results/wait. No tool argument unlocks mutations on the
ordinary server. In explicit maintenance, create/launch/seal still require the
original exact authorization, lineage and verified start evidence. Status does
not recommend starting missing members or sealing automatically. Do not replace
the user's installed MCP server or turn Host failure into managed execution.

An embedding Host may optionally pass an opened Worker Admission capability to
wave status. That adds P5 queue/reservation detail only; it never changes the
wave state machine or its `started` evidence. Ordinary CLI/MCP and Core calls
without that capability remain unchanged. See
[worker-admission.md](worker-admission.md).
