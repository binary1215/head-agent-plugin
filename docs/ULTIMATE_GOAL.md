# HEAD Agent Core ultimate goal and design context

Status: active direction authority

Current milestone: v0.5 Temporal Repository World Model and knowledge projections

Last reviewed: 2026-08-18

## Mandatory direction check

Read this document before planning a material change, starting an implementation milestone, or declaring a milestone complete. At each checkpoint, state whether the work still preserves the objective and invariants below. If it does not, stop and resolve the conflict instead of silently changing direction.

This document records design direction. It does not override the user, system instructions, repository-specific authority, or verified project canon. Material changes to product direction remain user-owned.

## Ultimate objective

Complete the design philosophy of `head-agent-core` as a provider-neutral plugin that works across Codex, OpenCode, and future agent runtimes.

The plugin must preserve the user's objective and project canon as the highest project authority; maintain a Whole-plan HEAD that owns strategy, integration, and completion judgment; compile deterministic minimum-sufficient context for bounded execution; return evidence-linked execution results to a fresh review context; and preserve a reproducible, auditable lineage from objective to plan, contract, execution, result, review, and next plan.

Runtime failure, context pollution, or provider-session loss must not erase the whole intent or sever the evidence chain. The same canonical inputs, compiler version, and budget must reproduce the same Context Capsule and lineage identities.

Source-control availability is not a product prerequisite. The core must initialize, preserve change lineage, build its World Model, compile context, review execution, and regenerate projections without Git. Git may enrich evidence through an optional adapter and is used to publish this plugin's development progress, but no core semantic identity, authority decision, or recovery path may depend on a Git commit, branch, tag, repository, or hosting service.

## Product identity

HEAD Agent Core is not primarily a memory product, prompt bundle, graph database, or worker launcher. It is an authority-preserving execution-lineage runtime.

```text
User objective and project canon
  -> WholePlanSnapshot A
  -> Context Compiler
  -> ExecutionContract + ContextCapsule
  -> Executor B
  -> ResultPacket
  -> Fresh Review HEAD
  -> ReviewDecision
  -> accepted result or refined WholePlanSnapshot A(n+1)
```

HEAD owns the whole-outcome judgment. Executors may accumulate detailed investigation, code, failures, fixes, and verification, but they do not silently redefine the whole plan. Only the result, evidence, plan delta, impact radius, verification, and explicit unknowns return to HEAD by default.

“Fresh HEAD” means a new logical review context hydrated from immutable project artifacts. It does not require resuming a hidden provider conversation or scraping a TUI session.

## Consolidated background

The direction comes from the following inputs:

- `C:\Users\ccolt\Downloads\oh-my-openagent-dev`: structural reference for packaging, Codex/OpenCode integration, and plugin ergonomics. It is a reference, not the product philosophy and not a source to copy blindly.
- `C:\Users\ccolt\Downloads\head-agent-core-main`: design-philosophy reference for HEAD ownership, protected project identity, sessions, runs, checkpoints, and coordination.
- Codex tasks `019ff0de-e8fb-72e3-a026-b8fae078a5aa` and `019ff0f2-ed30-7f03-8757-400e86bdee2d`: prior architecture and implementation context.
- Shared Context Compiler discussion: <https://chatgpt.com/share/6a84529c-d400-83e8-aa76-08c77d12c19e>.
- `C:\Users\ccolt\Documents\카카오톡 받은 파일\context-lineage-explainer.html`: the Whole-plan HEAD / Executor / Result Packet / Fresh HEAD lineage model.
- <https://webgraphdb.binaryexp.com/>: an optional future graph backend. Credentials are intentionally not recorded in this repository.
- <https://github.com/binary1215/head-agent-plugin>: the user-designated progress repository. Verified implementation slices are committed here to record plugin development; this publication workflow must not make the plugin itself Git-dependent or treat Git history as product authority.

The original HEAD runtime is a Node distribution and coordination system, not merely a prompt bundle. Cross-runtime support must therefore use a single provider-neutral core plus explicit platform, runtime, and workspace-host adapters. HEAD Session and Run identities remain distinct from Codex, OpenCode, or other provider session identifiers.

## Fixed design decisions

1. **Authority before automation.** User-owned direction and canonical project state outrank summaries, generated context, model output, and graph projections.
2. **Minimum sufficient context.** The compiler selects what this task needs and records why it was included or excluded. It does not maximize retrieval.
3. **Evidence is not instruction.** Repository text and external content remain evidence unless explicitly promoted through an authorized knowledge process.
4. **Logical Fresh HEAD.** Whole-plan review is reconstructed from immutable artifacts rather than depending on a long, polluted chat context.
5. **Explicit execution boundary.** Every consequential executor run must have an accepted `ExecutionContract` and a bounded authority surface.
6. **Structured return path.** Executors return a `ResultPacket`, not an unreviewed transcript or free-form success claim.
7. **Review controls progression.** HEAD records `accept`, `revise`, `expand`, `rollback`, or `escalate` as a `ReviewDecision` before the whole plan advances.
8. **Content-derived lineage.** Plans, contracts, capsules, results, and reviews use verifiable content hashes and explicit parent relationships.
9. **Graph storage is replaceable.** A World Model or GraphDB is a rebuildable materialized view over canon and events, never the unique authority.
10. **Honest capability boundaries.** Adapter/compiler unavailability may fail open with disclosure; identity drift, canon drift, invalid promoted knowledge, and digest mismatch fail closed.
11. **Verified progress history.** Commit tested milestone slices to the designated repository. Git history records implementation progress but does not override user direction, this direction document, or project canon.
12. **Domain-scoped sources of truth.** User-owned canon is authoritative for intent; executable code and configuration are authoritative for observed implementation; verified Results and Reviews are authoritative for recorded execution outcome. A graph records alignment, drift, and Unknowns instead of silently resolving conflicts between those domains.
13. **Git is optional evidence.** Change lineage and graph identity derive from HEAD artifacts, content-addressed source snapshots, and ChangeSets. Git is an optional VCS evidence/import-export adapter, and Git object identities never become required core identities.
14. **Temporal provenance is a DAG.** Source and entity revisions are immutable and content-addressed. Every revision accepts zero or more parents from the first schema version. Multiple-parent DAGs are supported; automatic merge and conflict resolution remain deferred.
15. **Graph before documents, never above canon.** Canon, executable project state, and verified lineage rebuild a typed temporal graph. Markdown, Obsidian, and Notion are deterministic human-facing projections of that graph and do not become independent authority.
16. **Document edits are proposals.** Generated-document changes enter as `DocumentChangeCandidate` evidence. Only an authorized ReviewDecision may change project canon, after which the graph and documents are regenerated.

## Semantic contracts

The Context Compiler boundary remains:

- `Snapshot`
- `Evidence`
- `Claim`
- `Decision`
- `Unknown`
- `ContextCapsule`

The Execution Lineage boundary is:

- `WholePlanSnapshot`: original objective, current approved whole plan, invariants, and source references.
- `ExecutionContract`: exact scope, acceptance criteria, constraints, allowed actions, and input Capsule.
- `ResultPacket`: observed outcome, evidence, plan delta, impact radius, verification, and unknowns.
- `ReviewDecision`: HEAD disposition and rationale against a WholePlanSnapshot.
- `LineageLink`: typed parent relationship connecting artifacts without relying on provider session state.

The Repository World Model storage boundary is `WorldModelStoreAdapter`: a versioned interface for pointer reads/writes, immutable snapshot reads/writes, and snapshot listing. Every implementation must declare derived-evidence-only authority, rebuildability, and that it is not unique authority. Physical adapter identity must not change the content-derived semantic snapshot identity.

The temporal provenance boundary adds these semantic entities:

- product intent: `FeatureGroup`, `Capability`, `Feature`, `Requirement`, and `Constraint`;
- implementation: `Repository`, `Component`, `File`, `Symbol`, `Test`, and their immutable revisions;
- change history: `SourceSnapshot`, `ChangeSet`, `RevisionLink`, and optional `VcsEvidence`;
- conformance: evidence-linked mappings and findings such as `IMPLEMENTS`, `VERIFIED_BY`, `IMPACTS`, `SUPERSEDES`, `ALIGNED_WITH`, and `DRIFTS_FROM`;
- knowledge projection: `GraphSnapshot`, `DocumentProjection`, and `DocumentChangeCandidate`.

The product and implementation concepts have distinct meanings:

- `FeatureGroup` is a human-owned product taxonomy and navigation group. It is independent of repository directories and must never be inferred from directory structure as an authoritative mapping;
- `Capability` is a stable user-visible ability or behavior;
- `Feature` is a concrete product unit that realizes one or more Capabilities;
- `Component` is an implementation-structure unit that contains or coordinates code artifacts;
- `ChangeSet` is one logical provider-neutral change, independent of how many VCS commits or executor attempts materialize it;
- `Revision` is one immutable content-derived state of a logical entity;
- `SourceSnapshot` is one immutable content-derived view of the relevant executable project state;
- `VcsEvidence` is optional external evidence about a ChangeSet and is never required to construct or verify it.

Product-to-implementation and change-impact mappings are many-to-many. A Feature may be implemented by many Files or Symbols; one File or Symbol may implement many Features; a Feature may be verified by many Tests; and one ChangeSet may change many revisions and affect many Features or Capabilities. The schema must not collapse these mappings into a directory tree or a single-owner relation.

Stable logical entities and immutable revisions are separate. A `Feature` or `File` keeps a stable project identity while `FeatureRevision`, `FileRevision`, and `SymbolRevision` use content-derived identities. Current-state pointers are replaceable projections; revision nodes and their zero-or-more parent links are immutable.

`ChangeSet` is the provider-neutral logical change unit. It connects before/after `SourceSnapshot` nodes, changed revisions, affected Features, ResultPacket evidence, and ReviewDecision disposition. When VCS data exists, `ChangeSet -MATERIALIZED_AS-> VcsEvidence -REFERENCES-> GitCommit` may be projected. Both edges and the GitCommit node are omitted without weakening the ChangeSet when Git is unavailable; a commit is neither required nor identical to a ChangeSet.

Graph traversal uses a separate replaceable `GraphProjectionAdapter`. Its local/in-memory conformance implementation and a future GraphDB implementation must produce and verify the same semantic node, edge, and snapshot identities from the same canonical inputs. GraphDB can be the primary traversal implementation but cannot become the only recoverable copy of canon or lineage.

### Graph semantic contract

The graph itself is always derived. It may contain `canon-projected`, `reviewed`, `derived`, `heuristic`, and `runtime-observed` entities and relations, but no node or edge becomes canon merely because it is stored in GraphDB. The initial relation vocabulary is typed and allowlisted:

- product: `CONTAINS`, `REALIZES`, and `GOVERNED_BY`;
- implementation: `DECLARES`, `IMPORTS`, `CALLS`, and `DEPENDS_ON`;
- conformance: `IMPLEMENTS`, `VERIFIED_BY`, `ALIGNED_WITH`, and `DRIFTS_FROM`;
- change: `CHANGES`, `IMPACTS`, `SUPERSEDES`, `MATERIALIZED_AS`, and `REFERENCES`;
- candidate, evidence, and review: `PROPOSES_FROM`, `PROPOSES_TO`, `SUPPORTED_BY`, `EVIDENCED_BY`, `REVIEWED_BY`, `ACCEPTED_BY`, `REJECTED_BY`, and `PROMOTED_FROM`.

Every projected edge must include:

```text
edgeId, type, from, to,
authorityClass, origin, evidenceIds,
freshness, sourceSnapshotId,
producer, producerVersion,
instructionAuthority, promotionAuthority
```

Heuristic or inferred edges also require a `confidence` value from zero through one. The content-derived edge identity includes the typed endpoints, authority class, origin, sorted evidence identities, source snapshot identity, producer and producer version, authority flags, and confidence when present. Volatile observation time, GraphDB record IDs, filesystem cache paths, provider session IDs, and document-provider page IDs are excluded from semantic identity. A GraphProjectionAdapter must reject unsupported relation types, dangling endpoints, missing provenance, invalid authority flags, digest mismatch, and attempts to return stale relations as current.

### Candidate promotion contract

Automatic analysis never creates an approved `IMPLEMENTS`, `VERIFIED_BY`, `IMPACTS`, or other authority-bearing mapping directly. It creates an immutable `FeatureMappingCandidate` or `RelationshipCandidate` with `instructionAuthority: false`, `promotionAuthority: false`, producer identity and version, confidence, Evidence links, and the source GraphSnapshot.

Candidate relations use `PROPOSES_FROM`, `PROPOSES_TO`, `SUPPORTED_BY`, and `REVIEWED_BY`. An accepting ReviewDecision does not mutate or relabel the candidate. It creates a separate reviewed relation linked back with `PROMOTED_FROM`; rejection remains separately linked with `REJECTED_BY`. This preserves the proposal, evidence, reviewer disposition, and accepted projection as distinct immutable facts. Unreviewed candidates are excluded from normal canonical and execution context unless the task explicitly asks to inspect candidates.

### Bounded traversal contract

Every Context Compiler graph expansion must use a deterministic `TraversalQuery` that records:

- an allowlist of relation types and authority classes;
- maximum depth and maximum node/edge counts;
- accepted freshness states and minimum confidence where applicable;
- whether unreviewed candidates are eligible;
- anchor identities, task relevance inputs, and deterministic ordering;
- inclusion and exclusion reasons;
- the GraphSnapshot, query, and result digests included in Capsule provenance.

The compiler must reject or exclude stale graph evidence, deny unsupported relations, and avoid candidate traversal by default. A graph backend may accelerate the query but cannot widen its scope, change ordering, silently promote evidence, or alter the resulting semantic digest.

Human-facing knowledge uses a replaceable projection plane in this order:

1. `MarkdownProjectionAdapter` is the deterministic baseline;
2. `ObsidianVaultProjectionAdapter` adds vault paths and backlinks without changing semantic identity;
3. `NotionProjectionAdapter` maps the same projections to remote pages while keeping provider page IDs outside core identity.

The initial projection flow is one-way: canon and executable state -> verified lineage -> GraphSnapshot -> documents. Inbound edits create candidates for review; automatic bidirectional synchronization and conflict resolution remain deferred.

## Agreed authority and derivation model

There is no single source that outranks every other source for every question. Authority is scoped by the kind of truth being requested:

| Question | Authoritative source |
| --- | --- |
| What should be built? | user objective and approved Feature, Decision, Requirement, and Constraint canon |
| What is currently implemented? | current code, configuration, and content-addressed source snapshot |
| What was verified? | verification evidence and accepted ResultPacket |
| Why and under what authority did it change? | ExecutionContract, ChangeSet, ReviewDecision, and lineage links |
| How are intent, implementation, change, and evidence connected? | rebuildable GraphSnapshot |
| How do people browse and understand it? | Markdown, Obsidian, and Notion document projections |

The derivation flow is:

```text
User objective and approved project canon ----+
Executable code, tests, and configuration -----+-> typed temporal GraphSnapshot
Execution Lineage and ChangeSet DAG -----------+              |
                                                              +-> Markdown
                                                              +-> Obsidian
                                                              +-> Notion
```

When approved intent and observed code disagree, the graph must preserve both statements and emit an evidence-linked conformance finding. It must not promote observed implementation into intended behavior or overwrite code evidence with documentation.

The first implementation slice for this direction will stop at `File`, `Symbol`, and `Test` revisions. Line and diff-hunk detail remains Evidence location metadata rather than first-class graph nodes until scale and query needs justify promotion.

## Current verified baseline

Version 0.2 established:

- project initialization and protected `.head/` canon;
- Codex and OpenCode projections;
- Session, Run, and checkpoint state;
- deterministic Context Capsule compilation over curated HEAD knowledge;
- evidence/authority separation, explicit Unknowns, context budgeting, history classes, provenance, and digest verification;
- read-only MCP inspection.

Known limitations at the start of v0.3:

- Run state is not yet connected to a WholePlanSnapshot or Context Capsule;
- Run completion is still a free-form outcome rather than a ResultPacket;
- no ReviewDecision advances or revises a whole plan;
- no repository symbol/dependency index exists;
- worker launch, fencing, messaging, and full runtime adapters remain deferred;
- no GraphDB adapter is active.

Current v0.3 alpha progress, verified on 2026-08-18:

- content-derived builders exist for all five Execution Lineage contract types;
- contracts verify referenced WholePlanSnapshot and persisted Context Capsule identities;
- ResultPacket evidence is forced across the evidence-not-instruction boundary;
- typed parent links and artifact digests are verified on read;
- CLI and read-only MCP can inspect and verify persisted lineage artifacts;
- Run start requires a verified ExecutionContract and re-verifies its WholePlanSnapshot and ContextCapsule;
- Run completion requires evidence and verification, creates a ResultPacket, and enters Review mode;
- another Run is rejected until HEAD records a ReviewDecision;
- explicit JSON input commands cover plan, contract, result, and review mutations without flattening them into shell text;
- the test suite covers deterministic identity, the complete contract/Run/review chain, cross-plan conflicts, missing proof, and tamper rejection;
- executor launch, automatic Fresh HEAD runtime hydration, and review-driven plan advancement remain explicitly deferred.

Current v0.4 alpha progress, verified on 2026-08-18:

- pending review deterministically projects the verified WholePlanSnapshot, ExecutionContract, ResultPacket, and ContextCapsule reference;
- executor transcript, raw failure logs, provider session state, and unpromoted repository instructions are explicitly excluded from the Fresh HEAD view;
- ReviewDecision requires the exact content-derived Fresh HEAD `reviewContextId`, rejecting stale or different review input;
- `revise` and `expand` require a new WholePlanSnapshot generation linked to the prior plan and ReviewDecision before another Run;
- `rollback` and `escalate` block further Runs until explicit user-owned direction exists;
- ResultPacket knowledge candidates and HEAD recommendations remain authority-free and do not mutate project knowledge canon;
- CLI and read-only MCP expose the review projection, and tests cover complete command flow, plan generations, user-direction gates, context exclusion, and knowledge authority boundaries;
- provider runtime hydration and authorized knowledge promotion remain explicitly deferred.

Current v0.5 alpha progress, verified on 2026-08-18; milestone remains active:

- a versioned `WorldModelStoreAdapter` contract separates semantic snapshot identity from physical persistence, and rejects adapters that claim canonical or unique authority;
- a dependency-free local JSON adapter stores content-addressed current and prior snapshots as rebuildable evidence;
- an in-memory conformance adapter produces the same World Model ID from the same canonical inputs, proving that physical storage identity is excluded from semantic identity;
- Hot is the current snapshot, Warm is the added/changed/removed and state-change summary, and Cold is the retained prior snapshot set;
- supported text files are classified and indexed with content digests, heuristic symbols, module/package dependencies, and import-line evidence;
- a content-derived semantic graph materializes File, Symbol, and ExternalDependency nodes plus `DECLARES`, `IMPORTS`, and resolvable `CALLS` edges;
- semantic nodes and edges record file digest/line provenance, heuristic confidence, freshness, and `evidence-not-instruction` trust boundaries;
- bounded zero-to-three-hop semantic queries are exposed through CLI and read-only MCP and fail closed when the index is stale;
- managed projections, `.head`, `.git`, vendor/dependency directories, generated outputs, caches, symlinks, unsupported files, and oversized files are excluded or counted;
- current Git HEAD/ref, canonical HEAD lifecycle state, and indexer protocol versions participate in the deterministic source digest without volatile timestamps or physical adapter identity;
- file-level freshness reports active, stale, removed, and unindexed evidence;
- Context Compiler selects task-relevant repository evidence and bounded semantic relationships only when the World Model is current and explicitly excludes stale candidates and graph metadata;
- local CLI and read-only MCP expose index build, status, digest verification, freshness, and bounded semantic traversal;
- a versioned `GitHistoryAdapter` contract keeps commit ingestion provider-neutral, rebuildable, and non-authoritative;
- default asynchronous Git CLI collection and a byte-preserving host-export adapter produce the same content-derived Git decision-history records without embedding physical adapter identity;
- current local/remote refs and tags validate exact parent reachability, while ref digests make stale history fail closed at consumption time;
- all-reachable commit messages are exposed as bounded `GitDecisionEvidence` through CLI, read-only MCP, and history-class-aware Context Capsules, never as promoted project Decisions;
- a versioned read-only `RuntimeStateAdapter` imports strict host-exported observations without granting instruction or control authority;
- normalized runtime observations are content-addressed, adapter-neutral, and freshness-gated; raw provider IDs and non-project workspace paths are reduced to digests, while raw commands, endpoints, environment, prompts, transcripts, and credentials are rejected;
- CLI, read-only MCP, and task-specific Context Capsules expose bounded runtime evidence, and source changes make the entire repository evidence layer stale until rebuild;
- the existing Git history capability is optional evidence and already fails open when Git is unavailable; it is not the future change-lineage authority;
- temporal Feature/Capability/ChangeSet revision graphs, multiple-parent source DAGs, GraphProjectionAdapter, typed relationship allowlists, candidate promotion, deterministic bounded traversal, deterministic document projections, AST-accurate/dynamic call resolution, live runtime probing/control, and authorized knowledge promotion remain explicitly deferred.

## Roadmap

### v0.3 — Execution Lineage Contract — verified alpha foundation

Freeze and validate content-derived `WholePlanSnapshot`, `ExecutionContract`, `ResultPacket`, `ReviewDecision`, and `LineageLink` artifacts. Connect them to Run and Capsule identities without breaking current Session/Run behavior.

### v0.4 — Fresh HEAD planning and review — verified alpha foundation

Implement planning generations `a -> plan1 -> a1 -> plan2 -> a2`, bounded result compilation, review dispositions, knowledge-promotion proposals, and explicit next-plan creation. Prior planning transcripts remain retrievable evidence but are not automatically injected.

### v0.5 — Repository World Model

Add incremental file, symbol, dependency, Feature/Capability, provider-neutral ChangeSet/revision, optional VCS evidence, and runtime-state indexing with claim-level freshness and Hot/Warm/Cold history. Introduce a multiple-parent temporal provenance DAG, a replaceable `GraphProjectionAdapter`, typed and provenance-complete relationship allowlists, immutable mapping candidates with ReviewDecision-gated promotion, deterministic bounded traversal, and Markdown-first knowledge projections. GraphDB and Git remain optional adapters; neither may become the unique authority or a prerequisite for core operation.

### v0.6 — Runtime adapters

Implement and test `PlatformAdapter`, `AgentRuntimeAdapter`, and `WorkspaceHostAdapter` contracts for Codex and OpenCode before enabling worker launch, resume, interrupt, messaging, or fencing.

### v1.0 — Auditable provider-neutral HEAD runtime

Demonstrate reproducible lineage and recovery across supported runtimes, verify authority and failure boundaries, and prove that a provider session can be replaced without losing the whole objective or evidence chain.

## Direction-check questions

Before every material milestone, answer all of these:

1. Which part of the ultimate objective does this change advance?
2. What is the authoritative source, and is any derived artifact being mistaken for canon?
3. Does the change preserve user-owned material decisions?
4. Is execution bounded by an explicit contract?
5. Can the result return as evidence, difference, impact, verification, and Unknowns rather than raw context?
6. Can a Fresh HEAD understand the current whole plan without the executor transcript?
7. Are artifact identities and parent relationships reproducible and digest-verifiable?
8. Does the design remain provider-neutral and avoid TUI scraping or hidden-session dependence?
9. Is GraphDB optional and reconstructable?
10. Are incomplete capabilities still described as deferred?
11. Would the same core lineage and semantic identities be available in a project with no `.git` directory?
12. Are generated Markdown, Obsidian, or Notion pages still projections, with inbound edits treated as reviewable candidates?
13. Does the revision model accept multiple parents without pretending automatic merge is implemented?
14. Does every graph edge carry typed provenance, freshness, producer, evidence, and authority metadata without volatile provider identity?
15. Are inferred mappings still immutable candidates until an authorized ReviewDecision creates a separate reviewed relation?
16. Is every graph expansion bounded by an explicit relation allowlist, freshness and confidence policy, depth, size, ordering, and recorded inclusion/exclusion rationale?

If any answer is “no” or “unknown,” record the gap before proceeding.

## Decision history

- 2026-08-18: selected authority-preserving Execution Lineage as the product direction.
- 2026-08-18: placed Execution Lineage Contract before Repository World Model and GraphDB work.
- 2026-08-18: defined Fresh HEAD as artifact-based logical reconstruction rather than provider-session restoration.
- 2026-08-18: made this document a mandatory planning, implementation, and milestone-review gate.
- 2026-08-18: completed the first v0.3 alpha contract slice and confirmed that it advances lineage before graph storage without changing authority boundaries.
- 2026-08-18: bound Runs to verified contracts, required ResultPacket proof and HEAD review, and moved the active milestone to v0.4 Fresh HEAD planning and review.
- 2026-08-18: completed the v0.4 alpha foundation with deterministic Fresh HEAD review projection, review-linked plan generations, user-direction gates, and authority-free knowledge proposals; moved the active milestone to v0.5 Repository World Model.
- 2026-08-18: completed the first v0.5 local World Model slice with Hot/Warm/Cold snapshots, file-level freshness, current Git HEAD and HEAD lifecycle inputs, and freshness-gated Context Compiler retrieval; kept v0.5 active for semantic history and replaceable graph storage work.
- 2026-08-18: added a versioned replaceable World Model store contract, proved storage-independent semantic identity with local JSON and memory adapters, added evidence-linked heuristic import/call graphs and bounded stale-safe CLI/MCP traversal, and kept v0.5 active for Git decision history, external runtime state, AST-accurate analysis, and the optional GraphDB adapter.
- 2026-08-18: added a versioned Git history source contract, all-reachable content-addressed commit evidence, current-ref validation, host-export fallback, bounded CLI/MCP queries, and history-aware Context Capsules; kept v0.5 active for external runtime state, AST-accurate analysis, structured decision inference, and the optional GraphDB adapter.
- 2026-08-18: added a versioned read-only RuntimeStateAdapter, strict privacy-bounded host exports, content-addressed point-in-time observations, freshness-gated CLI/MCP/Context retrieval, and explicit separation from v0.6 runtime control; kept v0.5 active for AST-accurate analysis, structured decision inference, and the optional GraphDB adapter.
- 2026-08-18: designated `binary1215/head-agent-plugin` as the progress repository and required verified implementation slices to be committed without promoting remote Git history above user direction or project canon.
- 2026-08-18: clarified that Git records plugin development and may contribute optional VCS evidence, but the plugin must preserve ChangeSets, snapshots, lineage, graph identity, and recovery without Git.
- 2026-08-18: adopted a provider-neutral temporal provenance graph connecting FeatureGroup, Capability, Feature, code and test revisions, ChangeSets, execution lineage, evidence, conformance, and explicit Unknowns.
- 2026-08-18: required revision schemas to support zero-or-more parents from the start, while deferring automatic merge and conflict resolution.
- 2026-08-18: adopted deterministic Graph-to-Markdown, Obsidian, and Notion knowledge projections; documents remain derived views and inbound edits become candidates requiring authorized review.
- 2026-08-18: defined FeatureGroup taxonomy as independent from code directories, required many-to-many Feature/Capability/code/test/change mappings, and separated logical entities from immutable revisions.
- 2026-08-18: adopted typed provenance-complete graph edges, immutable mapping candidates, ReviewDecision-created promoted relations, and deterministic allowlisted Context Compiler traversal as semantic contracts.
