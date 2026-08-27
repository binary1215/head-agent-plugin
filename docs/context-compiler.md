# HEAD Context Compiler design

Before changing this plane, read [`architecture.md`](architecture.md) and verify
that compilation still serves the Whole-plan HEAD and Execution Lineage rather
than becoming an independent authority.

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

Context Compiler protocol `0.12.0` uses a deterministic, coverage-aware lexical ranker so a Capsule can be reproduced without a model call. It normalizes Unicode, camelCase, snake_case, repository paths, and a bounded set of Korean particle variants while excluding URL payloads from retrieval terms. Repository retrieval first ranks lightweight file/symbol/dependency evidence, expands semantic adjacency from a budget-derived set of lexical seeds and their direct graph neighbors, and performs at most one deterministic temporal anchor traversal for repository-file context. ProductContext remains a separate single bounded traversal. Model-assisted compilation can be added later behind the same data contracts.

The explicit budget is a hard upper bound, not a claim of sufficiency. HEAD may provide a task-local `EvidenceNeed[]` contract naming the evidence kinds, facets, relation types, and minimum item counts needed for the current task. The Compiler never invents those needs from candidate availability and never imposes a universal source, test, ProductContext, or graph-neighborhood requirement. It only reserves budget for the supplied needs and proves whether matching evidence is actually present in the selected Capsule.

Budget protocol `1.0.0` accepts only `32768`, `65536`, `131072`, `262144`, or `524288` approximate tokens. The 32K tier is the default and 512K is the hard maximum, not a target. Every Compiler call receives one explicit tier that participates in Capsule identity; the Compiler does not change it. The non-persisted preview wrapper may deterministically retry the next fixed tier when an unmet HEAD-owned need has matching evidence excluded specifically by `context-budget`. Each attempt has its own Capsule identity and coverage proof. The current approximation is `ceil(UTF-16 code units / 4)`, so Capsule metadata labels it as inexact and requires the runtime adapter to validate actual provider-token fit and output reserve before invocation.

The content-addressed `evidenceNeedContract` and `coverageAssessment` bind that proof into Capsule identity. `coverageAssessment.status` is `not-requested`, `coverage-complete`, or `coverage-incomplete`; every proof names its included evidence carrier, evidence digest, available-match count, and exclusion reason. This is a mechanical inclusion result, not semantic acceptance. HEAD still decides whether the evidence kinds and their contents are adequate before creating an ExecutionContract. An incomplete Capsule remains auditable but cannot bind consequential execution; preview may expand only for `context-budget`, while missing evidence, stale World, and the 512K ceiling return to HEAD. The legacy `sufficiency` field remains only as a deprecated compatibility projection and must not be read as Compiler-owned judgment.

Example HEAD-owned input:

```json
[
  {
    "id": "implementation",
    "kind": "repository-source",
    "facets": ["context compiler"],
    "minimumItems": 1,
    "rationale": "The implementation changed by this task must be present."
  },
  {
    "id": "call-boundary",
    "kind": "semantic-relation",
    "relationTypes": ["CALLS", "IMPORTS"],
    "minimumItems": 1
  }
]
```

Tests are requested only when HEAD adds a `repository-test` need for the task. A document cannot satisfy a `repository-source` need, and a relationship need is covered only by a relationship record actually included through an included carrier candidate.

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

The bounded retrieval strategy changes cost, not authority. Retrieval-quality conformance additionally requires that identifier normalization, HEAD-defined EvidenceNeed coverage, and coverage-incomplete behavior remain stable; a latency improvement is not semantics-preserving when it removes required evidence. An isolated
291-file large-project validation fixture compiled the same 4,000-token task
Capsule twice in 6.5–7.2 seconds; the previous per-file traversal path did not
finish in roughly three minutes. Fixture identity and latency remain operational
evidence outside Capsule identity and are never target-project context.

Runtime observations have neither instruction nor control authority and do not hydrate a provider session. Temporal graph nodes and edges remain rebuildable evidence without canon, instruction, or promotion authority. `ProductContext` is a derived projection of user-owned Product Canon plus current explicitly reviewed Feature mappings and Change impacts and cannot mutate any source. When a current ChangeSet has an explicit VCS attachment, the bounded product traversal may follow `MATERIALIZED_AS` and `REFERENCES` to compact `VcsEvidence` and `GitCommit` observations at depth three; commit content remains `evidence-not-instruction` and does not become a Decision. Normal Context compilation never opts into onboarding, mapping, impact, DocumentChangeCandidate, document-review, application-receipt, benchmark, or latency surfaces. Prepared traversal cost evidence and timing diagnostics cannot enter Capsule identity or selection. Deterministic Markdown is an active human-facing GraphSnapshot projection, but generated pages are not re-ingested as Context evidence. Explicit document review may update Product Canon only through its separate user-authorized command; Context Compiler consumes only the resulting verified current graph. The current semantic graph, Symbol extraction, lexical mapping inference, and mapping-based impact inference are heuristic rather than AST-accurate. Inferred commit matching, general candidate promotion, structured decision inference and supersession from Git evidence, live runtime probing/control, cross-repository resolution, Obsidian/Notion projection, non-ArcadeDB graph transports, and an executed live prepared-query evaluation remain explicit Unknowns.
