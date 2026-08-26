# Provider-neutral bounded worker launch waves

`BoundedWorkerWave` adds one concise launch-wave view without turning HEAD Core
into a worker launcher, provider-session registry, or Herdr adapter. It groups
already-created and already-verified `BoundedWorkerDispatch` records beneath one
exact active Run lineage.

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

Every create, read, seal, status, result-read, wait, and abandon operation
re-verifies the exact current Project, HEAD Session pointer, active Run,
`WholePlanSnapshot`, `ExecutionContract`, `ContextCapsule`, member dispatch, and
member authorization hashes. Drift or tamper fails closed.

## Lifecycle

```text
existing BoundedWorkerDispatch[]
  -> BoundedWorkerWave(open)
  -> independent worker execution and authorization consumption
  -> explicit BoundedWorkerWaveSeal
  -> WorkerWaveStatusProjection(sealed | completed | failed)
  -> optional BoundedWorkerWaveWaitOutcome
  -> each result follows ResultPacket -> Fresh HEAD -> ReviewDecision -> P2 integration
```

The read-only status projection never creates a seal. Seal requires verified
lease consumption for every member; dispatch existence or caller assertion is
not start evidence. Aggregate result read and wave wait fail closed before seal.
`completed` means every member returned a successful terminal runtime result.
One fast terminal failure makes the sealed wave `failed`, never `completed`.

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
result integration path for each result.

## CLI and typed MCP

```text
head worker-wave-create <project> --input <wave.json>
head worker-wave-read <project> --wave <bounded-worker-wave-id>
head worker-wave-seal <project> --wave <bounded-worker-wave-id>
head worker-wave-status <project> --wave <bounded-worker-wave-id>
head worker-wave-results <project> --wave <bounded-worker-wave-id>
head worker-wave-wait <project> --wave <bounded-worker-wave-id> [--wait-timeout-ms <0..600000>]
head worker-wave-abandon <project> --input <abandonment.json>
```

Typed MCP exposes equivalent `head_bounded_worker_wave_*` tools over the same
Core functions and identities. A safe Skill flow creates individual dispatches,
creates the wave, launches each member through its existing execution path,
seals only after verified start evidence, and then uses status or bounded wait.
