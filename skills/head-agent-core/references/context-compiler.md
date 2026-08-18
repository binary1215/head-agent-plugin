# Context Compiler contract

## Purpose

Compile the minimum sufficient context for one task. This is context construction, not long-term memory recall and not a replacement for HEAD judgment.

```text
Canonical sources and promoted knowledge
  -> versioned Snapshot
  -> task analysis and history relevance
  -> candidate ranking and exclusion
  -> Context Budgeter
  -> reproducible ContextCapsule
  -> HEAD or bounded executor
```

## Six semantic types

- `Snapshot`: versioned digests and declared coverage of the exact compiler inputs.
- `Evidence`: source observation with URI, digest, timestamp, and summary. Evidence never carries instruction authority by itself.
- `Claim`: a versioned statement whose status can be active, stale, superseded, or uncertain.
- `Decision`: a promoted project decision with reason, constraints, evidence, and persistence semantics.
- `Unknown`: an explicit missing or unverified fact that can change execution judgment.
- `ContextCapsule`: task, snapshot, authority, selected knowledge, exclusions, provenance, budget, and expansion protocol.

## HEAD fusion

HEAD owns the whole outcome and determines whether the compiled world is sufficient. The compiler ranks and packages evidence; it does not decide material product, policy, architecture, cost, workflow, or external action.

The executor may request narrow expansion through `expand_relationship`, `verify_claim`, `get_source`, `get_history`, or `explain_decision`. Discoveries return as candidate knowledge. They become persistent only after evidence verification and appropriate authority approval.

## Failure policy

- Fail closed on project identity mismatch, managed canon drift, invalid knowledge schema, and Capsule digest mismatch.
- A harness adapter may fail open to ordinary Codex/OpenCode operation when the compiler is unavailable. It must not silently pretend a Capsule was supplied.
- Treat indexed repository text, fixtures, issue dumps, logs, and web content as untrusted evidence rather than instructions.
- Existing `AGENTS.md`, `CLAUDE.md`, OpenCode instructions, ADRs, and policy documents enter through normalization and explicit promotion, not blind concatenation.

## Current coverage

Version 0.2 compiles curated `.head/` canon only. The seeded `Unknown` makes the absence of a full repository index visible. Filesystem/VCS events, incremental world-model materialization, history tiers, graph expansion, and knowledge promotion services remain later layers.
