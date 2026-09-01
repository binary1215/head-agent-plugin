# HEAD Context Compiler design

Before changing this plane, read [`architecture.md`](architecture.md) and verify
that compilation still serves the Whole-plan HEAD and Execution Lineage rather
than becoming an independent authority.

## Design objective

The compiler answers: “Which bounded evidence did HEAD request for this task, what was actually included, and why?” It produces reproducible task context rather than claiming that a mechanical ranker can decide semantic sufficiency.

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
  -> HEAD semantic analysis + exact EvidenceNeeds
  -> Claim/Decision/Unknown candidates
  -> evidence attachment
  -> verified need coverage + fallback lexical ranking
  -> context budget and anti-context exclusions
  -> ContextCapsule + digest
```

Context Compiler protocol `0.15.0` keeps deterministic packaging separate from semantic judgment. The provider HEAD performs task analysis and may name exact normalized repository `paths`, exact Product Canon `entityKeys`, or a current-bound `graphAnchor` in `EvidenceNeed[]`; Core verifies those selectors against the current Project, World Model, and GraphSnapshot and proves actual inclusion. Lexical normalization and overlap remain bounded discovery/ranking signals for unanchored evidence only. Zero lexical overlap never makes a current candidate ineligible, and lexical score never means semantic acceptance. Repository retrieval may expand bounded structural adjacency, but it no longer chooses a temporal anchor from the first token-matching file.

The explicit budget is a hard upper bound, not a claim of sufficiency. HEAD may provide a task-local `EvidenceNeed[]` contract naming exact project-relative paths, exact Product Canon entity keys, evidence kinds, optional lexical facets, relation types, and minimum item counts needed for the current task. A `temporal-relation` need may instead carry `graphAnchor: { projectId, worldModelId, graphSnapshotId, nodeIds, depth, maxNodes, maxEdges }`. Such anchors must name current eligible nodes, a non-empty relation allowlist, and exact traversal bounds; facets are forbidden on this exact mode. Each matching relation or Product entity key contributes one distinct mechanical evidence item. The Compiler never invents those needs from candidate availability and never imposes a universal source, test, ProductContext, or graph-neighborhood requirement. It only reserves budget for the supplied needs and proves whether matching evidence is actually present in the selected Capsule.

`head_context_prepare` and CLI `context-prepare` remove the need for the user to
write that structure. The task-only call returns a bounded, non-persisted
`ContextPreparationProjection` with current Project/World/Graph identities,
lexical baseline candidates, and exact node IDs. Provider HEAD uses semantic
reasoning plus ordinary repository inspection to author `EvidenceNeed[]`; Core
does not infer it. The later `head_context_preview` call verifies the proposal
against current state. Preparation is therefore conversational UX, not an LLM
inside Core and not a new authority plane.

Context Preparation protocol `0.2.0` distinguishes unavailable optional World
evidence from a semantic requirement to activate it.

The readiness/status surface distinguishes four Context states without changing
project state: `blocked`, `curated-only`, `repository-ready`, and
`world-refresh-required`. `curated-only` is the honest Core-only state. If the
World has not been built, preparation returns `curated_only` and keeps direct
work or ordinary repository inspection primary. It discloses that reproducible
repository, Product, and graph evidence cannot enter a Capsule yet. The exact
Product-profile entrypoint remains an optional escalation selected only after
HEAD or the user determines that the task needs that evidence; Core does not
make that semantic choice or perform activation. A stale World is excluded and
returns an explicit refresh entrypoint instead of being reused.

When HEAD supplies EvidenceNeeds, packing stops after their requested mechanical
coverage is satisfied. Unrelated candidates are recorded as
`outside-head-evidence-contract`, and redundant matching candidates as
`evidence-coverage-satisfied`; the Compiler does not fill the remaining budget
with lexical material merely because space remains. Without EvidenceNeeds, the
lexical path remains a bounded discovery baseline. This distinction makes
exact HEAD guidance capable of improving both recall and noise without allowing
Core to decide semantic relevance.

Budget protocol `1.0.0` accepts only `32768` (32K), `65536` (64K), `131072` (128K), `262144` (256K), or `524288` (512K) approximate tokens. The 32K tier is the default and 512K is the hard maximum, not a target. Every Compiler call receives one explicit tier that participates in Capsule identity; the Compiler does not change it. The non-persisted preview wrapper may deterministically retry the next fixed tier when an unmet HEAD-owned need has matching evidence excluded specifically by `context-budget`. Each attempt has its own Capsule identity and coverage proof. The current approximation is `ceil(UTF-16 code units / 4)`, so Capsule metadata labels it as inexact and requires the runtime adapter to validate actual provider-token fit and output reserve before invocation.

The content-addressed `evidenceNeedContract` and `coverageAssessment` bind that proof into Capsule identity. `coverageAssessment.status` is `not-requested`, `coverage-complete`, or `coverage-incomplete`; every proof names its included evidence carrier, evidence digest, available-match count, and exclusion reason. This is a mechanical inclusion result, not semantic acceptance. HEAD still decides whether the evidence kinds and their contents are adequate before creating an ExecutionContract. An incomplete Capsule remains auditable but cannot bind consequential execution; preview may expand only for `context-budget`, while missing evidence, stale World, and the 512K ceiling return to HEAD. The legacy `sufficiency` field remains only as a deprecated compatibility projection and must not be read as Compiler-owned judgment.

Example HEAD-owned input:

```json
[
  {
    "id": "implementation",
    "kind": "repository-source",
    "paths": ["scripts/lib/context-compiler.mjs"],
    "minimumItems": 1,
    "rationale": "The implementation changed by this task must be present."
  },
  {
    "id": "call-boundary",
    "kind": "temporal-relation",
    "relationTypes": ["DECLARES", "REFERENCES"],
    "graphAnchor": {
      "projectId": "project-example",
      "worldModelId": "world-model-000000000000000000000000",
      "graphSnapshotId": "graph-snapshot-000000000000000000000000",
      "nodeIds": ["file-example-node"],
      "depth": 1,
      "maxNodes": 32,
      "maxEdges": 64
    },
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

Without an index, compilation remains limited to curated `.head/` sources. When the Repository World Model is current, every current repository file remains eligible; HEAD-anchored paths are selected for need coverage before fallback-ranked evidence. A bounded derived `ProductContext`, symbols, dependencies, pre-indexed structural adjacency, exact HEAD-anchored `GraphTraversalEvidence`, history-class-eligible Git commit evidence, and point-in-time runtime observations compete under the same Capsule budget. Exact temporal expansion runs through `GraphProjectionAdapter`; local JSON, in-memory conformance, explicitly activated ArcadeDB prepared expansion, and disclosed embedded-graph fallback must return the identical traversal. Each proposal is bound to the current Project, World Model, GraphSnapshot, exact nodes, relation allowlist, depth, node limit, and edge limit; stale, tampered, cross-project, candidate-hidden, or enlarged requests fail closed. Provider wording, adapter identity, prepared verification receipts, and diagnostics never enter authority or Capsule direction. ProductContext is selected by exact HEAD-authored Product Canon entity keys or, for unanchored fallback only, task terms matching validated Product Canon semantics. Budget overflow is the only candidate-selection exclusion reason. When the index is stale, anchored graph compilation fails closed and ordinary World-derived candidates are excluded.

The bounded retrieval strategy changes cost, not authority. Retrieval-quality conformance additionally requires that identifier normalization, HEAD-defined EvidenceNeed coverage, and coverage-incomplete behavior remain stable; a latency improvement is not semantics-preserving when it removes required evidence. A historical pre-`1.0.0` budget benchmark compiled the same 4,000-token task Capsule twice in 6.5–7.2 seconds on an isolated 291-file fixture, while the previous per-file traversal path did not finish in roughly three minutes. The current Compiler rejects arbitrary 4,000-token input and accepts only the fixed 32K–512K tiers described above. The historical fixture identity and latency remain operational development evidence outside Capsule identity and are never target-project context or a current acceptance command.

Runtime observations have neither instruction nor control authority and do not hydrate a provider session. Temporal graph nodes and edges remain rebuildable evidence without canon, instruction, promotion, review, or recovery authority. The semantic graph keeps heuristic source analysis as the default fallback and may accept a provider-neutral `SourceRelationEvidenceAdapter` result whose exact current file manifest, language AST analyzer, endpoints, evidence line, and digest are verified. AST-derived `CALLS`/`IMPORTS` edges are source-separated from heuristic edges and cannot replace HEAD semantic judgment. `ProductContext` remains a derived projection of user-owned Product Canon. Normal Context compilation never opts into hidden candidate, benchmark, or latency surfaces. Prepared traversal cost evidence and timing diagnostics cannot enter Capsule identity or selection. Deterministic Markdown is not re-ingested as Context evidence. Inferred commit matching, general candidate promotion, structured decision inference and supersession from Git evidence, live runtime probing/control, cross-repository resolution, and additional graph/document transports remain explicit Unknowns.
