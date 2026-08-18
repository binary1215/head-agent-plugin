# HEAD Agent Core ultimate goal and design context

Status: active direction authority

Current milestone: v0.5 Temporal Repository World Model and knowledge projections

Last reviewed: 2026-08-19

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
- `C:\Users\ccolt\Documents\카카오톡 받은 파일\HEAD-Agent_GraphDB_Brief_v4.pdf` and `.pptx`: an operating-case reference for High/Mid/Low separation, Session-scoped retrieval, evidence-gated review, and Feature-to-code-to-change-reason graph traversal. Its example schemas and queries are evidence, not binding implementation instructions; canonical relation directions and authority boundaries remain defined here.
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
17. **Refresh creates snapshots, not mutations.** Explicit indexing and future event-driven refresh create new immutable `SourceSnapshot`, revision, and `GraphSnapshot` artifacts. A validated current pointer may advance atomically, but an existing snapshot, revision, Capsule, or execution artifact is never rewritten in place.
18. **Observation may refresh automatically; meaning may not.** Deterministic source digests, code structure, runtime observations, and execution evidence may be refreshed automatically. Feature mappings, authority-bearing relationships, product canon, Decisions, and document-originated changes remain candidates until an authorized ReviewDecision promotes them.
19. **Accepted execution inputs stay frozen.** An accepted `ContextCapsule` and `ExecutionContract` remain pinned to their recorded source and graph identities. A newer snapshot creates an explicit drift condition; HEAD must choose to continue with the pinned inputs or issue a new Capsule and Contract. Refresh never silently changes an active Run.
20. **Onboarding bootstraps authority without inventing it.** Existing code, tests, documents, imported backlogs, and a new-project brief may produce product-model candidates. They do not become Feature, Capability, FeatureGroup, Requirement, Constraint, or Decision canon until an authorized onboarding ReviewDecision adopts them.
21. **Batch review is the normal bootstrap path.** Users do not need to register every inferred Feature manually. Onboarding presents an evidence-linked candidate set that may be accepted, rejected, renamed, merged, split, or selected in one bounded review; the recorded ReviewDecision is the authority transition.
22. **Project sessions are core identities, provider sessions are references.** Initialization creates a project-scoped HEAD Session directory and explicit onboarding state. Codex, OpenCode, or other provider conversation identifiers may be attached as optional evidence but never define the HEAD Session or recovery identity.
23. **Graph connection is optional operational configuration.** Onboarding may ask whether to use local materialization or an external GraphDB adapter. Endpoint/database selection and secret-reference names are operational configuration; credentials are never written into project canon, candidate artifacts, GraphSnapshots, or generated documents. Local operation remains complete without GraphDB.
24. **Control plane and compute plane are separate.** JavaScript modules own plugin orchestration, Codex/OpenCode/MCP/CLI integration, prompts, authority decisions, canon mutation, ReviewDecision, adapter selection, and process supervision. Heavy deterministic computation may be delegated through a versioned `ComputeAdapter` to a bundled native worker.
25. **Native acceleration must not change semantics.** Compute backend selection must not change `SourceSnapshot`, entity revision, `GraphSnapshot`, candidate-set, traversal-result, or `ContextCapsule` semantic identities. A JavaScript reference implementation and accelerated implementations must produce canonically equivalent output from the same accepted inputs and semantic protocol version.
26. **Go accelerates the plugin, not the user project.** The first native backend is a bundled Go worker that analyzes projects written in any supported language. It does not translate user code into Go, require the user's project to use Go, or copy Go source and binaries into the user's project state.
27. **Authority stays outside the compute worker.** A native worker may produce observations, evidence, digests, graph materializations, traversal results, and product candidates. It cannot approve candidates, create an authoritative ReviewDecision, mutate Product Canon, widen an ExecutionContract, or grant itself instruction or promotion authority.
28. **Native migration is evidence-gated and incremental.** `ComputeAdapter` boundaries are planned before heavy features, but an operation moves to Go only after its semantic contract, deterministic JavaScript reference behavior, conformance fixtures, and benchmark corpus exist. Rust remains a future backend option only when profiling shows a material bottleneck that the Go backend cannot satisfy economically.

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

- product intent: `FeatureGroup`, `Capability`, `Feature`, `Requirement`, `Constraint`, and `Decision`;
- implementation: `Repository`, `Component`, `File`, `Symbol`, `Test`, and their immutable revisions;
- change history: `SourceSnapshot`, `ChangeSet`, `RevisionLink`, and optional `VcsEvidence` and `GitCommit` observations;
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
- revision and time: `HAS_REVISION`, `CURRENT_REVISION`, and `PARENT_OF`;
- implementation: `DECLARES`, `IMPORTS`, `CALLS`, and `DEPENDS_ON`;
- conformance: `IMPLEMENTS`, `VERIFIED_BY`, `ALIGNED_WITH`, and `DRIFTS_FROM`;
- change: `CHANGES`, `IMPACTS`, `SUPERSEDES`, `MATERIALIZED_AS`, and `REFERENCES`;
- execution lineage: `ISSUES`, `EXECUTED_AS`, and `PRODUCES`;
- candidate, evidence, and review: `PROPOSES_FROM`, `PROPOSES_TO`, `SUPPORTED_BY`, `EVIDENCED_BY`, `REVIEWED_BY`, `ACCEPTED_BY`, `REJECTED_BY`, and `PROMOTED_FROM`.

Relation direction and naming are canonical rather than interchangeable aliases. In particular, an implementation entity `IMPLEMENTS` a product entity; storage must not also emit the inverse alias `IMPLEMENTED_BY`. A `WholePlanSnapshot` `ISSUES` an `ExecutionContract`, the contract is `EXECUTED_AS` a `Run`, the Run `PRODUCES` a `ResultPacket`, and the packet is `REVIEWED_BY` a `ReviewDecision`. Query and document adapters may render inverse-language labels for people, but those labels do not create additional semantic edges or identities.

Every projected node must include:

```text
nodeId, kind,
authorityClass, origin, evidenceIds,
freshness, producer, producerVersion,
instructionAuthority, promotionAuthority
```

Snapshot-scoped nodes also carry `sourceSnapshotId`. Revision nodes additionally carry `logicalEntityId`, a content digest, and sorted zero-or-more parent revision identities. A root `SourceSnapshot` records its own sorted parent snapshot identities instead of self-referencing through `sourceSnapshotId`. Logical entity identities remain stable across revisions; revision identities change only when their semantic content or parent set changes. Observation timestamps, line numbers used only as Evidence locations, GraphDB record IDs, provider session IDs, document page IDs, and optional VCS object IDs are excluded from logical entity identity.

Every projected edge must include:

```text
edgeId, type, from, to,
authorityClass, origin, evidenceIds,
freshness, sourceSnapshotId,
producer, producerVersion,
instructionAuthority, promotionAuthority
```

Heuristic or inferred nodes and edges also require a `confidence` value from zero through one. The content-derived edge identity includes the typed endpoints, authority class, origin, sorted evidence identities, source snapshot identity, producer and producer version, authority flags, and confidence when present. Volatile observation time, GraphDB record IDs, filesystem cache paths, provider session IDs, document-provider page IDs, and optional VCS object IDs are excluded from semantic identity. A GraphProjectionAdapter must reject unsupported entity or relation types, dangling endpoints, missing node or edge provenance, invalid authority flags, digest mismatch, and attempts to return stale entities or relations as current.

### Candidate promotion contract

Automatic analysis never creates an approved `IMPLEMENTS`, `VERIFIED_BY`, `IMPACTS`, or other authority-bearing mapping directly. It creates an immutable `FeatureMappingCandidate` or `RelationshipCandidate` with `instructionAuthority: false`, `promotionAuthority: false`, producer identity and version, confidence, Evidence links, and the source GraphSnapshot.

Candidate relations use `PROPOSES_FROM`, `PROPOSES_TO`, `SUPPORTED_BY`, and `REVIEWED_BY`. An accepting ReviewDecision does not mutate or relabel the candidate. It creates a separate reviewed relation linked back with `PROMOTED_FROM`; rejection remains separately linked with `REJECTED_BY`. This preserves the proposal, evidence, reviewer disposition, and accepted projection as distinct immutable facts. Unreviewed candidates are excluded from normal canonical and execution context unless the task explicitly asks to inspect candidates.

### Initial onboarding contract

The same provider-neutral onboarding state machine serves both an existing project and a newly created project. The difference is the evidence source, not the authority model:

- an existing project is explicitly indexed first and may infer candidates from observed code, tests, configuration, product documents, and imported backlog evidence;
- a new project may infer candidates from a user-owned product brief, requirements, constraints, and design inputs before implementation exists;
- a project with an already approved product model imports or reads that model as canon and may skip product bootstrap while still indexing implementation evidence.

The initial flow is:

```text
initialize HEAD project and project-scoped Session
  -> record privacy-safe storage selection (local by default, GraphDB optional)
  -> index observed project inputs into an immutable World Model snapshot
  -> derive an immutable OnboardingCandidateSet with evidence and confidence
  -> present bounded batch review (accept all, accept selection, revise, or reject)
  -> persist an onboarding-scoped ReviewDecision
  -> create the next Product Canon revision from accepted candidates
  -> rebuild and verify the GraphSnapshot before onboarding becomes ready
```

Onboarding candidates use stable content-derived identities and record producer/version, source snapshot, evidence links, confidence, and `instructionAuthority: false` / `promotionAuthority: false`. Directory structure may inform implementation Components but must not be converted into an authoritative FeatureGroup taxonomy. Candidate inference must explain its evidence and confidence and preserve explicit Unknowns when the repository does not justify a product concept.

An onboarding ReviewDecision is a typed `ReviewDecision` with `decisionScope: product-canon-bootstrap`. It records the reviewed candidate-set identity, accepted/rejected candidate identities, user edits, rationale, previous Product Model identity, and resulting Product Model identity. The candidate is not mutated or relabeled after review. Promotion creates new canon content and a separate immutable decision receipt so that the authority transition can be audited and replayed.

GraphDB configuration is never a prerequisite for this flow. The local World Model and graph projection provide the conformance baseline. If an external adapter is selected before that adapter is available or verified, onboarding records the capability as pending and continues locally with explicit disclosure; it must not pretend the remote projection succeeded.

### Native compute acceleration contract

`ComputeAdapter` is a versioned, provider-neutral boundary between the JavaScript control plane and replaceable computation backends:

```text
Codex / OpenCode / future runtime
  -> JavaScript control plane
       -> JsReferenceComputeAdapter
       -> GoWorkerComputeAdapter
       -> future profiled backend such as Rust
```

The JavaScript reference adapter is the semantic conformance baseline and local fallback. The Go worker is the first production acceleration backend. Backend selection, executable path, process ID, elapsed time, and performance counters are operational diagnostics outside content-derived semantic identity. `producer` and `producerVersion` inside semantic artifacts identify the shared algorithm/protocol version rather than the implementation language, so conforming JavaScript and Go implementations generate the same semantic identities.

The worker protocol uses bounded standard input/output and records at least `schemaVersion`, `requestId`, operation, input digest, semantic producer version, resource limits, result digest, structured warnings, and structured errors. Every operation must define deterministic ordering, canonical serialization, maximum files/bytes/output, timeout, cancellation, and all-or-nothing result validation. Partial or digest-invalid output cannot advance a World Model or graph pointer.

The JavaScript control plane resolves only a verified bundled executable beneath the plugin distribution root and invokes it directly without a shell. It passes structured data rather than executable text, bounds standard output and error output, records process ownership, terminates owned child processes on success/failure/cancellation, and verifies OS/architecture-specific distribution hashes. Project content, prompts, endpoints, credentials, environment values, and GraphDB data must never be interpreted as commands.

The intended distribution shape is plugin-owned rather than project-owned:

```text
dist/
  windows-x64/head-agent-worker.exe
  linux-x64/head-agent-worker
  linux-arm64/head-agent-worker
  darwin-arm64/head-agent-worker
```

Initial Go migration priority is file discovery/read/hash and source parsing, followed by World Model construction, temporal graph construction, and bounded traversal. Feature inference may use the worker only to create evidence-linked candidates. Context Compiler policy, authority resolution, ReviewDecision, Product Canon mutation, CLI/MCP/runtime integration, and promotion remain in the JavaScript control plane. Context-selection computation moves only if profiling demonstrates a material benefit without weakening minimum-sufficient-context explanations.

### Active v0.5 onboarding and compute implementation plan

1. Define `ComputeAdapter` and a versioned stdio `WorkerProtocol`, including digest, error, cancellation, resource-limit, and backend-neutral semantic identity rules.
2. Wrap current JavaScript behavior in `JsReferenceComputeAdapter` and establish deterministic conformance fixtures before moving any operation.
3. Add the Go worker skeleton, OS/architecture selection, bundled-binary integrity verification, owned-process cleanup, and disclosed JavaScript fallback without enabling unverified semantic substitution.
4. Move file discovery/read/hash and parsing first; require JavaScript/Go canonical-output and semantic-identity equivalence plus repeatable benchmark evidence.
5. Move World Model and temporal graph build/query operations incrementally with the same conformance gate; decide Context Compiler acceleration only after profiling.
6. Extend initialization with a project-scoped Session record and an explicit onboarding state pointer while preserving existing initialized projects through a deterministic missing-state migration path.
7. Add a privacy-safe storage-selection descriptor that defaults to local materialization and accepts only GraphDB endpoint/database plus secret-reference names, never credential values.
8. Build deterministic FeatureGroup, Capability, and Feature candidates from the current verified World Model or an explicit new-project brief; store them as immutable evidence-linked candidate sets.
9. Add bounded batch review and a content-derived onboarding ReviewDecision; require an explicit acceptance disposition before writing Product Canon.
10. Merge accepted entities into Product Canon with stable keys, reference validation, conflict rejection, previous/next model hashes, and atomic pointer advancement.
11. Re-index and verify the resulting Product Canon projection in the temporal GraphSnapshot; expose onboarding status and evidence through CLI and read-only MCP.
12. Verify existing-project, new-project, empty-evidence, rejection, tamper, secret-rejection, deterministic identity, JS/Go conformance, worker failure/cancellation, Git-absent, GraphDB-absent, and Go-binary-absent scenarios before declaring the slice complete.

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

### Incremental observed-state refresh contract

“Real-time refresh” means event-driven or scheduled near-real-time reconstruction of observed project state. It does not mean mutating the graph on every keystroke, granting a watcher authority over canon, or injecting changing context into an active Run.

Refresh may be triggered by an explicit index command, a debounced filesystem event, a verified build or CI event, an accepted ChangeSet, or a new read-only runtime/operational observation. All triggers enter the same deterministic pipeline:

```text
verified trigger
  -> capture relevant source and evidence inputs
  -> create immutable SourceSnapshot and entity revisions
  -> derive and validate a new GraphSnapshot
  -> atomically advance the replaceable current pointer
  -> optionally regenerate document projections
```

The pipeline must preserve these boundaries:

- source-derived facts such as content digests, declarations, imports, references, and test execution evidence may be recomputed automatically;
- heuristic Feature/code, change-impact, and conformance analysis creates immutable candidates rather than reviewed relations;
- product canon, Requirements, Decisions, and authority-bearing mappings change only through authorized review;
- a failed or partial refresh cannot replace the last verified current pointer;
- prior snapshots and their multiple-parent ancestry remain addressable and digest-verifiable;
- refresh events are debounced or coalesced so intermediate editor states do not create an unbounded snapshot stream;
- a `ContextCapsule` records the exact GraphSnapshot and traversal result it used and is never retroactively updated;
- when a newer snapshot invalidates active execution assumptions, HEAD records drift and explicitly continues, recompiles, revises, or cancels rather than silently substituting context;
- local and future GraphDB adapters must expose the same verified semantic identity and pointer transition; backend-specific streams or record IDs cannot become core identity.

The staged implementation order is explicit index -> incremental changed-file rebuild -> debounced filesystem/CI event ingestion -> optional GraphDB projection refresh -> deterministic Markdown/Obsidian/Notion regeneration. Automatic semantic promotion, automatic merge, and bidirectional document synchronization remain deferred.

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

Current v0.5 alpha progress, verified through 2026-08-19; milestone remains active:

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
- `.head/context/product-model.json` is a strict user-owned Product Canon contract for stable FeatureGroup, Capability, Feature, Requirement, Constraint, and Decision keys; missing canon in an older initialized project is the deterministic empty model rather than inferred meaning;
- a separate temporal provenance `GraphSnapshot` now preserves stable Product/Repository/File/Symbol/Test logical identities and immutable Product/File/Symbol/Test revisions without redefining the existing heuristic semantic graph;
- Product logical and revision nodes plus `CONTAINS`, `REALIZES`, and `GOVERNED_BY` edges are projected as `canon-projected` derived evidence with no instruction or promotion authority;
- SourceSnapshot and Revision schemas accept sorted zero-or-more explicit parents, support multiple-parent DAG shape, reject direct self-parent cycles, and make no automatic merge or conflict-resolution claim;
- every temporal node and edge carries typed provenance, freshness, producer version, evidence identities, and instruction/promotion authority flags; heuristic Symbol projections carry numeric confidence;
- deterministic temporal traversal records kind/relation/authority/freshness allowlists, confidence policy, depth and size bounds, ordering, inclusion/exclusion reasons, and GraphSnapshot/query/result digests;
- the temporal graph is constructed and queried in projects with no `.git`; optional Git history remains a separate evidence plane and does not participate in temporal logical or revision identities;
- World Model, Context Compiler, CLI, and read-only MCP expose the verified temporal slice and reject stale or digest-invalid materializations;
- Context Compiler `0.5.1` selects a deterministic bounded `ProductContext` only from current canon-projected product nodes and records Product Model, GraphSnapshot, query, and result identities without promoting graph evidence;
- `ComputeAdapter` contract `0.1.0` and WorkerProtocol `0.1.0` now enforce canonical request/input/result identities, bounded resources, timeout and cancellation, structured all-or-nothing errors, and recursive rejection of compute-result authority escalation;
- `JsReferenceComputeAdapter` is the only active compute backend and fixture-driven conformance compares complete canonical responses while keeping backend and timing diagnostics outside semantic output;
- ChangeSet and product-to-code mappings, onboarding candidate inference and batch promotion, conformance, candidate-promotion, execution-lineage graph projection, the replaceable GraphProjectionAdapter, deterministic document projections, debounced filesystem/CI refresh, built-in repository compute operations, the Go worker backend and native process/integrity/fallback plane, AST-accurate/dynamic call resolution, live runtime probing/control, and authorized knowledge promotion remain explicitly deferred.

## Roadmap

### v0.3 — Execution Lineage Contract — verified alpha foundation

Freeze and validate content-derived `WholePlanSnapshot`, `ExecutionContract`, `ResultPacket`, `ReviewDecision`, and `LineageLink` artifacts. Connect them to Run and Capsule identities without breaking current Session/Run behavior.

### v0.4 — Fresh HEAD planning and review — verified alpha foundation

Implement planning generations `a -> plan1 -> a1 -> plan2 -> a2`, bounded result compilation, review dispositions, knowledge-promotion proposals, and explicit next-plan creation. Prior planning transcripts remain retrievable evidence but are not automatically injected.

### v0.5 — Repository World Model

Add a provider-neutral `ComputeAdapter` before new heavy analysis paths, preserve current JavaScript behavior as the semantic reference, and introduce a bundled Go worker only through canonical-output conformance and benchmark gates. Move file scan/parse, World Model construction, temporal graph construction, and bounded traversal incrementally while keeping authority, Product Canon, ReviewDecision, Context policy, CLI, and MCP in the JavaScript control plane. Add an initial onboarding state machine that can index existing projects or bootstrap new-project briefs, infer evidence-linked product candidates, and promote a batch only through an onboarding-scoped ReviewDecision. Add incremental file, symbol, dependency, Feature/Capability, provider-neutral ChangeSet/revision, optional VCS evidence, and runtime-state indexing with claim-level freshness and Hot/Warm/Cold history. Introduce a multiple-parent temporal provenance DAG, a replaceable `GraphProjectionAdapter`, typed and provenance-complete relationship allowlists, immutable mapping candidates with ReviewDecision-gated promotion, deterministic bounded traversal, and Markdown-first knowledge projections. After explicit indexing and snapshot conformance are verified, add debounced filesystem/CI event ingestion that creates new immutable snapshots and advances the current pointer only after validation. GraphDB, Git, and native acceleration remain replaceable implementation choices; none may become the unique authority or a prerequisite for core semantic recovery.

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
14. Does every graph node and edge carry typed provenance, freshness, producer, evidence, and authority metadata without volatile provider identity?
15. Are inferred mappings still immutable candidates until an authorized ReviewDecision creates a separate reviewed relation?
16. Is every graph expansion bounded by an explicit relation allowlist, freshness and confidence policy, depth, size, ordering, and recorded inclusion/exclusion rationale?
17. Does every refresh create and validate a new immutable snapshot before advancing a current pointer, without rewriting prior artifacts?
18. Can automatic refresh update observed facts without promoting semantic candidates, changing canon, or mutating an accepted Capsule or active Run?
19. When a newer snapshot creates drift, does HEAD make an explicit continue, recompile, revise, or cancel decision with preserved lineage?
20. Does onboarding keep inferred product meaning as a candidate until a recorded user review adopts it, while allowing a bounded batch decision instead of forcing one-by-one entry?
21. Can the same onboarding flow work for existing code, a new-project brief, and a project with pre-existing canon without confusing their evidence sources?
22. Are GraphDB credentials absent from project artifacts, and can onboarding finish locally when Git and GraphDB are unavailable?
23. Does changing from the JavaScript reference adapter to the Go worker preserve canonical output and every semantic identity for the same inputs and protocol version?
24. Is the Go worker limited to plugin-owned computation without rewriting user code, copying native artifacts into project state, or acquiring canon/review/promotion authority?
25. Can the core disclose and recover through the JavaScript reference path when the Go binary is absent, incompatible, corrupt, timed out, or cancelled?
26. Are worker invocation, input/output, resource limits, PID ownership, cancellation, and binary integrity bounded and verifiable without shell interpretation of project-controlled data?
27. Is every native migration justified by repeatable benchmark and profiling evidence while concurrent results remain canonically ordered and digest-reproducible?

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
- 2026-08-19: incorporated the detailed temporal-graph proposal by adding provenance-complete node contracts, explicit revision/time and execution-lineage relations, and canonical relation directions; retained the provider-neutral `ChangeSet -> VcsEvidence -> GitCommit` boundary instead of making commits part of the required logical change model.
- 2026-08-19: implemented the first Git-independent temporal provenance slice with stable File/Symbol/Test entities, immutable revisions, explicit multiple-parent SourceSnapshot and Revision DAGs, provenance-complete typed relations, deterministic bounded traversal, and World Model/Context/CLI/MCP integration; kept Feature/Capability/ChangeSet, promotion, document projection, GraphProjectionAdapter, GraphDB, and automatic merge work deferred.
- 2026-08-19: adopted near-real-time observed-state refresh as a future event-ingestion capability: refresh creates immutable SourceSnapshot/revision/GraphSnapshot artifacts, advances the current pointer only after validation, never promotes semantic candidates or canon automatically, and never mutates an accepted ContextCapsule, ExecutionContract, or active Run; drift requires an explicit HEAD decision.
- 2026-08-19: adopted a provider-neutral initial onboarding state machine for existing and new projects: observed inputs create immutable product candidates, a bounded batch ReviewDecision is the sole authority transition into Product Canon, project-scoped HEAD Sessions remain distinct from provider conversations, and GraphDB selection is optional privacy-safe operational configuration with a complete local fallback.
- 2026-08-19: adopted a hybrid plugin architecture with a JavaScript control plane and a replaceable native compute plane. Go is the first acceleration backend for measured heavy operations, JavaScript remains the semantic reference and fallback, conforming backends must preserve canonical output and semantic identities, and native workers cannot own ReviewDecision, Product Canon mutation, promotion, runtime authorization, or the user's project implementation language. Rust remains optional until profiling demonstrates an unmet bottleneck.
- 2026-08-19: completed and regression-tested the first Product Canon vertical slice: strict user-owned Product Model validation, stable product identities, immutable canon-projected temporal revisions and relations, Git-independent World Model integration, and bounded task-relevant ProductContext compilation. Inferred onboarding candidates, product-to-code mappings, and promotion remain deferred so observed code cannot silently invent product authority.
- 2026-08-19: completed the first ComputeAdapter foundation with a strict backend-neutral WorkerProtocol, deterministic JavaScript reference backend, resource/cancellation/error bounds, authority-escalation rejection, and complete-response conformance reports. No repository operation or Go binary was activated; native migration remains gated on operation schemas, fixtures, failure cases, and benchmark evidence.
