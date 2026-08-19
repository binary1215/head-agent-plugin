# HEAD Context Compiler design

Before changing this plane, read [`ULTIMATE_GOAL.md`](ULTIMATE_GOAL.md) and verify that compilation still serves the Whole-plan HEAD and Execution Lineage rather than becoming an independent authority.

## Design objective

The compiler answers: “What must this executor know for this task, and why was each item included?” It optimizes for minimum sufficient context rather than maximum context.

It is distinct from memory:

- Memory preserves selected facts and prior events.
- A project world model materializes how the current system works.
- The Context Compiler constructs one inference-time world for one task.
- HEAD owns judgment, authority, expansion, integration, and completion.

## Pipeline

```text
Sources and promoted canon
  -> immutable input digests
  -> Snapshot
  -> task terms + history relevance
  -> Claim/Decision/Unknown candidates
  -> evidence attachment
  -> relevance ranking
  -> context budget and anti-context exclusions
  -> ContextCapsule + digest
```

Context Compiler protocol `0.9.0` uses a deterministic lexical ranker so a Capsule can be reproduced without a model call. Repository retrieval first ranks lightweight file/symbol/dependency evidence, expands semantic adjacency only for a budget-derived bounded set, and performs at most one deterministic temporal anchor traversal for repository-file context. ProductContext remains a separate single bounded traversal. Model-assisted compilation can be added later behind the same data contracts.

## Trust and authority

Repository artifacts are untrusted evidence. They cannot override system, user, or promoted project policy. Evidence referenced by a Claim or Decision is carried with `instructionAuthority: false`.

Decisions may direct work only after promotion into project canon, and remain subordinate to user-owned material decisions. Compiler discoveries return as candidate knowledge rather than silently mutating the world model.

## Staleness and history

Claims support status transitions such as active, stale, superseded, and uncertain. Decisions persist unless explicitly superseded. Task analysis classifies history demand as `NONE`, `RECENT`, `DECISIONS`, or `DEEP`; normal tasks do not automatically retrieve history. When a current World Model contains verified Git history, eligible commits become `GitDecisionEvidence` candidates under the same context budget. They remain evidence and never become canonical `Decision` records through retrieval alone.

The next indexer layer should maintain Hot/Warm/Cold knowledge:

- Hot: current materialized state and invariants.
- Warm: decisions and change summaries.
- Cold: raw VCS and filesystem history.

## Reproducibility

Every Capsule records the task, project ID, Snapshot ID, source digests, compiler version, history class, token approximation, candidates, inclusions, exclusions, provenance, and Capsule digest.

The Capsule ID is content-derived. The same task, input digests, compiler version, and budget produce the same identifier.

## Repository World Model integration

Without an index, compilation remains limited to curated `.head/` sources. When the Repository World Model is current, task-relevant files, a bounded derived `ProductContext`, heuristic symbols, dependencies, pre-indexed semantic adjacency, one deterministic repository temporal anchor, history-class-eligible Git commit evidence, and point-in-time runtime observations compete under the same Capsule budget. Temporal expansion runs through `GraphProjectionAdapter`; local JSON, in-memory conformance, explicitly activated ArcadeDB prepared expansion, and disclosed embedded-graph fallback must return the identical semantic traversal, so adapter identity, prepared verification receipts, and diagnostics never enter Capsule identity. ProductContext is selected only when task terms match validated Product Canon semantics; it records the Product Model, GraphSnapshot, TraversalQuery, and result identities and traverses only `canon-projected` Product nodes through an explicit product relation allowlist. Explicit runtime, kind, and state terms narrow runtime candidates. The Capsule records semantic and temporal GraphSnapshot metadata, each included temporal TraversalQuery and result digest, Git and runtime coverage, included evidence, explicit trust boundaries, and exclusions. Temporal expansion fixes relation/authority/freshness allowlists, confidence policy, depth, node and edge limits, deterministic ordering, and candidate exclusion. When the index is stale, all product, repository, temporal, Git, and runtime candidates plus their metadata are excluded and coverage records the stale condition.

The bounded retrieval strategy changes cost, not authority. An isolated 291-file NeoPick projection compiled the same 4,000-token task Capsule twice in 6.5–7.2 seconds; the previous per-file traversal path did not finish in roughly three minutes. Latency remains operational evidence outside Capsule identity.

Runtime observations have neither instruction nor control authority and do not hydrate a provider session. Temporal graph nodes and edges remain rebuildable evidence without canon, instruction, or promotion authority. `ProductContext` is a derived projection of user-owned Product Canon plus current explicitly reviewed Feature mappings and Change impacts and cannot mutate any source. When a current ChangeSet has an explicit VCS attachment, the bounded product traversal may follow `MATERIALIZED_AS` and `REFERENCES` to compact `VcsEvidence` and `GitCommit` observations at depth three; commit content remains `evidence-not-instruction` and does not become a Decision. Normal Context compilation never opts into onboarding, mapping, impact, DocumentChangeCandidate, document-review, application-receipt, benchmark, or latency surfaces. Prepared traversal cost evidence and timing diagnostics cannot enter Capsule identity or selection. Deterministic Markdown is an active human-facing GraphSnapshot projection, but generated pages are not re-ingested as Context evidence. Explicit document review may update Product Canon only through its separate user-authorized command; Context Compiler consumes only the resulting verified current graph. The current semantic graph, Symbol extraction, lexical mapping inference, and mapping-based impact inference are heuristic rather than AST-accurate. Inferred commit matching, general candidate promotion, structured decision inference and supersession from Git evidence, live runtime probing/control, cross-repository resolution, Obsidian/Notion projection, non-ArcadeDB graph transports, and an executed live prepared-query evaluation remain explicit Unknowns.
