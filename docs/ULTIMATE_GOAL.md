# HEAD Agent Core ultimate goal and design context

Status: active direction authority

Current milestone: v0.6 provider-neutral Runtime Adapter contracts

Immediate next slice: obtain user review of the exact NeoPick `revise` proposal, create and re-review its successor candidate set without `accept-all`, then run the privacy-safe database compatibility audit and activate the derived graph against the explicitly selected `neopick` database. Onboarding inference `0.3.0` now clusters related symbols, filters generic lifecycle/UI/operational helpers, separates broad Capability candidates from representative concrete Features, and never auto-attaches a documentation-derived FeatureGroup. The exact 291-file isolated run reduced the batch from 49 to 23 candidates; `docs/neopick-onboarding-review-proposal.md` records evidence-bound grouping and naming edits for the retained isolated HEAD Session. ArcadeDB database-lifecycle protocol `0.1.0` creates a missing selected database explicitly, preserves unrelated existing schema, and permits a whole-database reset only after a conflicting `HeadAgentGraph*` reserved type is proven and the exact selected target is confirmed. Credentials and target values remain absent from audits and lifecycle receipts. Context Compiler `0.9.0` reproduced the same 4,000-token Capsule in 6.629 and 6.420 seconds. No Product Canon promotion, live remote write, or database initialization has occurred because process-local credential references remain unavailable. The actual Codex Run remains live-conformant end to end with native descendant cleanup, canonical ResultPacket application, Fresh HEAD review, and no transcript or Product Canon mutation. Provider-session resume, general stream/interrupt/close, messaging, shell interpretation, and TUI scraping remain disabled.

Last reviewed: 2026-08-19

## Mandatory direction check

Use progressive direction loading instead of treating this entire history as one global checklist. Before a material change, read the ultimate objective, the universal invariants, the current milestone, and only the subsystem contracts touched by the change. Read the complete decision history when changing product direction, resolving a conflict, or declaring a milestone complete. At each checkpoint, state whether the work still preserves the applicable objective and invariants. If it does not, stop and resolve the conflict instead of silently changing direction.

This document records design direction. It does not override the user, system instructions, repository-specific authority, or verified project canon. Material changes to product direction remain user-owned.

## Ultimate objective

Complete the design philosophy of `head-agent-core` as a provider-neutral plugin that works across Codex, OpenCode, and future agent runtimes.

The plugin must preserve the user's objective and project canon as the highest project authority; maintain a Whole-plan HEAD that owns strategy, integration, and completion judgment; select the lightest safe execution lane; compile deterministic minimum-sufficient context when persistent handoff or consequential execution requires it; return evidence-linked execution results; and preserve a reproducible, auditable lineage for work whose risk, duration, authority effect, or coordination needs justify that lineage.

Runtime failure, context pollution, or provider-session loss must not erase the whole intent or sever the evidence chain. The same canonical inputs, compiler version, and budget must reproduce the same Context Capsule and lineage identities.

Source-control availability is not a product prerequisite. The core must initialize, preserve change lineage, build its World Model, compile context, review execution, and regenerate projections without Git. Git may enrich evidence through an optional adapter and is used to publish this plugin's development progress, but no core semantic identity, authority decision, or recovery path may depend on a Git commit, branch, tag, repository, or hosting service.

## Product identity

HEAD Agent Core is not primarily a memory product, prompt bundle, graph database, or worker launcher. It is an authority-preserving execution-lineage runtime.

```text
User objective and project canon
  ├─ Observe -> bounded read-only evidence -> HEAD
  ├─ Session -> bounded reversible execution -> evidence-linked result -> HEAD
  └─ Run / Authority
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
- <https://webgraphdb.binaryexp.com/>: the user-designated optional graph backend. The current explicit E2E target is the `neopick` database; it may be initialized only when incompatible existing data prevents conformance. Credentials are resolved only at runtime and are intentionally not recorded in this repository, project artifacts, generated documents, or benchmark reports.
- <https://github.com/binary1215/head-agent-plugin>: the user-designated progress repository. Verified implementation slices are committed here to record plugin development; this publication workflow must not make the plugin itself Git-dependent or treat Git history as product authority.

The original HEAD runtime is a Node distribution and coordination system, not merely a prompt bundle. Cross-runtime support must therefore use a single provider-neutral core plus explicit platform, runtime, and workspace-host adapters. HEAD Session and Run identities remain distinct from Codex, OpenCode, or other provider session identifiers.

## Lessons adopted from the reference HEAD Core

The reference runtime is an operational behavior oracle, not a package tree to copy. The provider-neutral plugin should adopt these proven behaviors:

1. **One public composition path with recoverable phases.** Public initialization should compose host convergence, project initialization/registration, and onboarding start/resume while retaining each phase as a transaction and recovery boundary.
2. **Exact project and caller binding.** One project ID maps to one canonical root, live control derives its project/caller/state authority from trusted host evidence, and requests cannot choose their own authority generation or operational state path.
3. **Complete worker lifecycle ownership.** A real execution reserves state, launches one owned worker, captures machine-session evidence, waits, validates the handoff, delivers once, and cleans up only proven owned processes or workspace resources. Cleanup failure remains an explicit failed outcome.
4. **Canon-based recovery.** Session/Run canon, checkpoints, and bounded current-result references recover work after compaction or provider-session loss; logs and summaries orient retrieval but never replace the agreement.
5. **Durable scoped coordination.** Role messaging, when implemented, remains project-scoped, idempotent, authority-generation fenced, and durable across temporary delivery failure.
6. **Immutable distribution with rollback.** Plugin/native releases should be content-identified and replaceable as units; a failed installation or activation restores the prior working reference rather than editing installed source in place.
7. **Separate durable meaning from ephemeral operation.** Content-derived authorizations, consumption/release receipts, Results, and Reviews belong in project lineage. PID, token, socket, service, and short-lived owner-lock state belongs in a user-scoped operational state root outside project canon.

The plugin must not inherit the reference runtime's OpenCode-only, Herdr-only, `.claude`-path, POSIX-service, shell-wrapper, tab/pane, or provider-session coupling as core identity. Herdr or another workspace manager may later implement `WorkspaceHostAdapter`; it remains optional and cannot define HEAD Session, Run, project, or semantic graph identity.

The adoption target is operational completeness through smaller provider-neutral contracts:

| Reference behavior | Current plugin position | Adoption target |
| --- | --- | --- |
| initialization and resumable phases | onboarding state, project identity, and recovery artifacts exist | expose one public composition path while retaining transactional phase recovery |
| exact project/caller fencing | project, Session, authorization, lease, operational-root boundaries, live Session, and consequential live Run passed | extend the same fence to OpenCode execution |
| launch/wait/result/delivery/cleanup | native descendant-tree ownership and transcript-free result evidence exist | complete live Codex conformance, then reuse the contract for OpenCode |
| canon/checkpoint recovery | content-derived canon, snapshots, Capsules, Results, and Reviews exist | prove recovery after provider-session loss without treating provider state as canon |
| durable role coordination | authority-generation and idempotency rules are designed but messaging is deferred | add only after the single-provider vertical works; keep it optional and project-scoped |
| immutable release and rollback | native/plugin files are manifested and content-verified | add atomic install/activation rollback without in-place cache edits |
| durable/ephemeral state separation | project lineage and host-local operational state are separated | preserve this boundary for every future service or workspace-host adapter |

## Reference convergence without ritual parity goal

The convergence target is behavioral completeness, not package-tree, artifact-count, or ritual parity with the reference runtime. A supported provider path should recover the same user outcome under failure while the provider-neutral core requires fewer globally loaded rules.

| Reference capability | Adopt, adapt, or defer | Proportional constraint |
| --- | --- | --- |
| public initialization with resumable phases | adopt as one provider-neutral initialize/resume composition | transaction and rollback evidence is required only for phases that mutate host or project state; read-only observation does not manufacture it |
| exact project, caller, and authority fencing | adopt for every executing or mutating path | canonical read-only inspection may use a verified project root without requiring a live provider caller or Run lineage |
| launch, wait, result, delivery, and owned cleanup | adopt as one common lifecycle safety core for Session and Run | Session returns bounded evidence; only consequential Run and Authority work pays the full WholePlan/ResultPacket/Review cost |
| canon and checkpoint recovery | adopt and extend through Capsules, Results, Reviews, and graph-backed retrieval | durable handoff artifacts are created when risk, duration, delegation, or context-loss exposure justifies them, not for every local interaction |
| durable role messaging | defer until the single-provider Session/Run vertical is complete | messaging remains optional, project-scoped, and unable to create a new authority identity |
| immutable distribution and rollback | adopt at release installation and activation boundaries | release safeguards do not become per-command execution gates |
| Herdr panes/tabs, `.claude` paths, OpenCode-only sessions, POSIX services, and shell wrappers | reject as core identity; permit only through optional adapters | an adapter may add host evidence but cannot redefine HEAD project, Session, Run, canon, or semantic graph identity |

This goal is complete when:

1. one public initialize/resume path can recover a partially completed installation or onboarding without duplicating project authority;
2. Codex Session and Run complete through one shared lifecycle safety core, after which OpenCode conforms by adapter substitution rather than new core identities;
3. provider-session loss can be recovered from canon and verified lineage without TUI scraping, hidden conversation history, or a mandatory GraphDB/Git dependency;
4. installation or activation failure can restore the last verified plugin/native release without editing an installed cache in place;
5. every remaining reference-specific behavior is either an explicitly optional adapter responsibility or a documented non-goal.

## Core and subsystem design decisions

These decisions are not one global ritual. Authority, canon/evidence separation, credential safety, path/process ownership, honest capability disclosure, and optional-adapter recovery are universal invariants. Execution-lineage rules apply to Run and Authority work; graph/canon/document rules apply when those surfaces are read or changed; compute rules apply to native operations; and remote-write rules apply only to external activation. Observe or Session work must not be escalated merely to satisfy an unrelated subsystem contract.

1. **Authority before automation.** User-owned direction and canonical project state outrank summaries, generated context, model output, and graph projections.
2. **Minimum sufficient context.** The compiler selects what this task needs and records why it was included or excluded. It does not maximize retrieval.
3. **Evidence is not instruction.** Repository text and external content remain evidence unless explicitly promoted through an authorized knowledge process.
4. **Logical Fresh HEAD.** Whole-plan review is reconstructed from immutable artifacts rather than depending on a long, polluted chat context.
5. **Explicit execution boundary.** Every consequential executor run must have an accepted `ExecutionContract` and a bounded authority surface.
6. **Structured return path proportional to the lane.** Session work returns bounded evidence and explicit Unknowns; Run and Authority executors return a full `ResultPacket`. Neither lane treats an unreviewed transcript or free-form success claim as proof.
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
29. **Integrated implementation before exhaustive per-feature validation.** Build coherent provider-neutral vertical flows before expanding exhaustive tests for each small capability. During implementation, retain syntax checks and the minimum fail-closed contract, authority, credential, and process-safety checks needed to prevent invalid state. Concentrate broad behavioral, recovery, cross-runtime, and external-system validation in integrated E2E milestones after the connected implementation exists.
30. **Remote GraphDB writes are explicit-target confined.** External GraphDB activation and E2E writes use only the exact database selected by the user for the current validation; the active target is `neopick`. Database initialization requires the user's explicit authority and is permitted only when incompatible existing data prevents conformance. Credential values remain process-local, never become semantic identity or persisted project state, and reports disclose behavior without endpoints, usernames, passwords, or database-internal record identities.

## Risk-proportional governance goal

The system must preserve safety properties without forcing every task through the most expensive lineage path. HEAD selects an execution lane from observable risk rather than from tool availability:

| Lane | Intended work | Required control and evidence |
| --- | --- | --- |
| `Observe` | read-only inspection, search, status, comparison, and diagnosis | bounded inputs/outputs, freshness and authority disclosure; no persisted plan, Capsule, or review artifact by default |
| `Session` | direct or one-shot, local, reversible work with no product-canon or consequential external authority effect | exact project/caller fence, scoped allowed actions, workspace mode, resource limits, optional Capsule when context complexity justifies it, at-most-once execution lease for provider invocation, and an evidence-linked bounded result |
| `Run` | durable, multi-step, delegated, cross-module, or materially consequential implementation | persisted WholePlanSnapshot, ContextCapsule, ExecutionContract, ResultPacket, Fresh HEAD projection, and ReviewDecision |
| `Authority` | Product Canon promotion, architecture/policy choice, irreversible mutation, deployment/publication, credentials/access, material cost, or consequential external action | Run controls plus the explicit user-owned decision or approval required by the affected authority boundary |

If classification is uncertain, HEAD may choose the safer lane but must record the concrete risk that justified escalation. It must not choose a heavier lane simply because its artifacts already exist.

Runtime execution should converge on one versioned `ExecutionAuthorization` envelope with `scope.kind: session | run`:

- the Session scope binds the project, HEAD Session, user-request digest, optional ContextCapsule, allowed actions, workspace mode, caller/process fences, and resource limits;
- the Run scope additionally binds the active Run, WholePlanSnapshot, ExecutionContract, and required ContextCapsule;
- both scopes use the same pre-start consumption, non-replayable at-most-once lease, event normalization, cancellation, descendant cleanup, and privacy boundary;
- a Session result does not block later work behind Fresh HEAD review unless it discovers a material decision, canon change, irreversible effect, or whole-plan consequence that requires promotion to Run or Authority;
- accepted Run inputs remain frozen and retain the existing drift and ReviewDecision gates.

ContextCapsule persistence is mandatory for Run and Authority execution. It is optional for Observe and Session work unless the task is delegated, spans context loss, uses broad repository retrieval, or otherwise needs a reproducible handoff. Compiler unavailability may degrade a Session with disclosure; it cannot silently weaken an accepted Run.

Canon review should accept a digest-bound scoped patch as well as a complete replacement document. The system must compute and present the complete resulting Product Model before approval, validate it against the exact base canon digest, and record the reviewed before/after identities. This keeps document edits as proposals without forcing the user to resubmit unrelated canon content.

Completion criteria for this governance goal are:

1. documentation and Skill routing apply universal rules plus only the relevant lane/subsystem checks;
2. one actual provider supports bounded Session invocation without creating a WholePlan or blocking on ReviewDecision;
3. the same provider supports a consequential Run invocation through the complete existing lineage;
4. Session and Run share authorization, process ownership, event, lease, cancellation, cleanup, and Result evidence semantics where their risk boundaries overlap;
5. ephemeral PID/token/socket/lock state is separated from durable project lineage before service-host or general runtime control activation;
6. integrated tests prove lane selection, escalation, non-replay, cleanup, and that Session work cannot mutate Product Canon or perform Authority actions without promotion.

## Rule-complexity budget goal

The plugin must become operationally complete without turning every prior failure or subsystem concern into a globally loaded rule. Rules are product mechanisms with maintenance cost, not accumulated documentation trophies.

A new mandatory rule is justified only when it protects a universal invariant, closes a reproduced or credible high-impact failure mode, or defines a provider-neutral interoperability boundary. It must declare its scope, enforcement point, observable failure, and the condition under which it can be narrowed or removed. Provider quirks belong in adapters; operational details belong in host-local state; recommendations and unimplemented ideas remain non-binding guidance.

Complexity is reduced in this order:

1. reuse or narrow an existing semantic contract before creating another artifact, state machine, gate, or authority class;
2. load universal invariants first, then only the selected execution lane and touched subsystem contracts;
3. keep `Observe` and reversible `Session` work free of WholePlan, persistent Capsule, ResultPacket, and ReviewDecision requirements unless a concrete risk requires promotion;
4. keep full lineage for consequential `Run` work and add user approval only at a real `Authority` boundary;
5. express Codex, OpenCode, operating-system, GraphDB, Git, document, and workspace-host differences behind adapters rather than branching core identity;
6. prefer one integrated vertical proof over repeated per-feature validation once minimum fail-closed authority, credential, identity, and process checks pass;
7. delete or demote duplicate rules, unreachable states, speculative gates, and validations that do not change an observable failure outcome.

Every active rule is classified as `universal`, `lane-scoped`, `subsystem-scoped`, `adapter-scoped`, or `advisory`, with the narrowest valid scope as the default. Promotion to a wider scope requires concrete cross-lane evidence. A rule is narrowed, demoted, or removed when its failure mode is eliminated, its check is absorbed by a canonical boundary, or its enforcement no longer changes an observable outcome. This classification is a design/release review aid, not a new runtime artifact or gate.

Relaxation never removes the minimum safety floor: user and canon authority, exact identity and action scope, credential isolation, owned-process cleanup, truthful capability disclosure, and explicit user control at Authority boundaries. Everything beyond that floor must justify its cost against the selected lane and touched subsystem.

Completion criteria for this rule-complexity goal are:

1. each mandatory rule maps to one universal invariant, selected lane, or touched subsystem and has one canonical enforcement location;
2. a bounded Session can complete through the public plugin path without manufacturing Run/Review lineage;
3. a consequential Run can complete through the same lifecycle safety core with only its additional lineage contracts;
4. adding a provider or host requires an adapter and conformance evidence, not new core authority identities;
5. milestone review includes a rule-deletion pass and reports retained, narrowed, deferred, and removed constraints;
6. rule count, artifact count, and test count are not treated as progress metrics; a connected recoverable user outcome is.

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

Graph traversal uses a separate replaceable `GraphProjectionAdapter`. Its local/in-memory reference implementations and the activated ArcadeDB implementation must produce and verify the same semantic node, edge, snapshot, query, and result identities from the same canonical inputs. GraphDB can perform the primary physical expansion but cannot become the only recoverable copy of canon or lineage, choose semantic policy, or canonicalize authority-bearing results.

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

### Implementation and E2E sequencing contract

Implementation proceeds by complete vertical capability rather than one exhaustive test suite per micro-feature:

```text
contract and authority boundary
  -> connected provider-neutral implementation
  -> Codex/OpenCode and platform integration
  -> integrated E2E scenario and recovery validation
  -> milestone commit
```

Intermediate code must still parse, preserve content-derived identity, keep secrets out of artifacts, fail closed on authority or digest drift, and clean up owned processes. Those are implementation invariants, not optional late-stage tests. Extensive fixture multiplication, performance matrices, provider permutations, and recovery campaigns are deferred until the full connected flow can be exercised end to end. A milestone commit records a coherent verified slice; Git history is not used as a substitute for product lineage or as a requirement of the plugin.

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

The staged automatic-refresh order is explicit index -> incremental changed-file rebuild -> debounced filesystem/CI event ingestion -> optional GraphDB projection refresh -> deterministic Markdown/Obsidian/Notion regeneration. A manually invoked deterministic Markdown reference renderer may be established earlier as the projection-conformance baseline, but it must remain detached from automatic refresh until the preceding refresh stages are verified. Automatic semantic promotion, automatic merge, and bidirectional document synchronization remain deferred.

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
- Context Compiler selects a deterministic bounded `ProductContext` from current canon-projected product nodes plus explicitly reviewed Feature mappings, records Product Model, GraphSnapshot, query, and result identities, and never opts into unreviewed candidates;
- `ComputeAdapter` contract `0.3.0` and WorkerProtocol `0.2.0` now enforce canonical request/input/result identities, bounded file/input/output/total-byte resources, timeout and cancellation, structured all-or-nothing errors, recursive rejection of compute-result authority escalation, and operational-only backend diagnostics;
- `repository.scan.v1` is the first active built-in compute operation: its strict relative-path-only result carries content digests and deterministic source facts, while root paths, backend identity, execution mode, timing, and process details stay outside semantic output;
- `JsReferenceComputeAdapter` remains the semantic oracle; a tracked repository corpus, limit and tamper failures, repeated-identity benchmark, and complete-response candidate conformance define the evidence gate each native operation must pass;
- a bundled Go worker source tree and `GoWorkerComputeAdapter` now establish strict single-request/single-response stdio transport without shell interpretation, project writes, network access, descendants, or authority effects;
- per-platform manifests bind the WorkerProtocol, target, plugin-confined executable path, byte size, SHA-256 digest, advertised operations, process restrictions, and authority flags to a content-derived identity;
- the adapter selects Windows x64, Linux x64/arm64, and macOS x64/arm64 distributions, rejects symlinks/path escape/integrity drift, bounds stdout/stderr and runtime, and waits for exact child-PID exit after completion, timeout, or cancellation;
- `worker.health.v1` produces a byte-equivalent canonical JavaScript/Go response, while a test-only lifecycle operation verifies timeout cancellation and PID cleanup;
- missing, incompatible, corrupt, unsupported, spawn-failed, and crashed native paths disclose a bounded reason and fall back to JavaScript; malformed native responses, output-limit violations, timeout, and caller cancellation fail closed;
- source-analysis `0.2.0` removes duplicate `(line, kind, name)` symbols before applying the per-file cap, fixing a large-repository case in which the JavaScript reference generated a result rejected by its own validator; World Model `0.5.3` and repository-scan producer `0.2.0` make that semantic change explicit;
- a Go `repository.scan.v1` candidate now implements bounded file traversal, raw-byte hashing, classification, heuristic symbols, dependencies, import bindings, calls, summaries, and content-derived identities with JavaScript-compatible UTF-16 canonical ordering;
- seven complete success/failure fixtures cover multilingual and Unicode evidence, built-in exclusions, explicit repository source scope, managed projections, invalid roots, file/byte limits, native PID cleanup, and identical JavaScript/Go request, result, response, and scan identities;
- comparative Windows benchmarks record small `0.15x`, current-plugin `0.93x`, and large-reference `1.07x` Go/JavaScript ratios; because improvement is not material across sizes, packaged release manifests intentionally do not advertise `repository.scan.v1` and production scan semantics still execute through JavaScript;
- the GitHub workflow tests and vets Go, verifies live native conformance and lifecycle cleanup, cross-compiles content-addressed platform packages, and publishes only for an explicit semantic-version tag;
- World Model `0.5.3` validates repository scan results before semantic/temporal graph construction, and changing only a conforming compute adapter leaves repository scan, semantic graph, and World Model identities unchanged;
- initialization now creates an immutable project-scoped HEAD Session record, a digest-verified onboarding state pointer, and a local-default storage selection; older initialized projects expose a read-only deterministic migration preview and preserve their existing Session and Product Model identities when the first mutating onboarding command creates the missing artifacts;
- privacy-safe storage selection accepts local operation or a pending GraphDB endpoint/database plus environment-style username/password secret-reference names, rejects embedded or inline credential values, and keeps the verified local path complete until a separate adapter-neutral activation receipt proves remote materialization;
- explicit onboarding indexing creates immutable bounded candidate sets from a verified current repository World Model or structured user-owned new-project brief; code/test symbols and documentation headings remain evidence-linked heuristics, directory structure never becomes FeatureGroup taxonomy, and insufficient evidence remains explicit Unknowns;
- onboarding-scoped `ReviewDecision` artifacts support `accept-all`, dependency-complete `accept-selection`, `revise`, and `reject`; candidates remain immutable and non-authoritative, revisions create successor candidate sets, and additions/removals require a second review rather than same-decision promotion;
- acceptance records accepted/rejected candidate identities, normalized user edits, previous/resulting Product Model hashes, immutable Product Model revision documents, and an explicit user authority transition; stale source, Product Canon drift, reference conflicts, digest tampering, and active/pending Runs fail closed;
- Product Canon promotion rebuilds a child SourceSnapshot and temporal GraphSnapshot and advances onboarding to ready only after the resulting Product Model identity is current and verified; a failed promotion restores the prior canon and World Model pointer, while later repository drift preserves the historical onboarding decision and is disclosed as `ready_world_changed`;
- onboarding projection protocol `0.1.0`, temporal provenance `0.3.0`, and World Model `0.5.4` now load bounded immutable CandidateSet, Evidence, Unknown, ReviewDecision, and ProductModelRevision artifacts, validate nested content identities, and project review/promotion lineage through typed `PROPOSES_*`, `SUPPORTED_BY`, `REVIEWED_BY`, disposition, `PRODUCES`, and `PROMOTED_FROM` edges;
- candidate-space nodes are excluded from normal CLI/MCP traversal and all Context Capsules unless a read-only query explicitly opts in; reviewed ReviewDecision and ProductModelRevision receipts remain normally queryable, and every graph node/edge retains false instruction and promotion authority even when its source ReviewDecision records the user authority transition;
- CLI exposes onboarding start/status/review/artifact commands, read-only MCP exposes verified onboarding status without mutation authority, and a dependency-free verifier covers existing/new/pre-canon/empty/revise/reject/selection/projection/traversal-exclusion/tamper/secret/migration/Git-absent/GraphDB-absent/Go-binary-absent scenarios in CI;
- Feature mapping protocol `0.1.0`, temporal provenance `0.4.0`, and World Model `0.6.0` now infer bounded many-to-many Feature/Capability-to-File/Symbol/Test candidates with exact revision and Evidence identities, keep them immutable and hidden by default, and fail closed on source/Product Canon drift, digest tampering, stale candidate identity, or active/pending Run conflict;
- an explicit mapping-scoped ReviewDecision may accept all, accept a named selection, or reject; acceptance creates a separate `ReviewedRelationship` receipt linked by `PROMOTED_FROM` and `PRODUCES` plus canonical-direction `File|Symbol -[:IMPLEMENTS]-> Feature|Capability` or `Feature|Capability -[:VERIFIED_BY]-> Test` edges, while rejection creates no canonical mapping edge;
- Context Compiler can traverse current reviewed mappings as evidence while unreviewed mapping CandidateSet, Candidate, Evidence, Unknown, and endpoint-reference nodes remain excluded; read-only MCP exposes mapping status but cannot infer, review, or promote;
- ChangeSet protocol `0.1.0`, temporal provenance `0.6.0`, and World Model `0.8.0` now record one Git-independent logical ChangeSet only from a ContextCapsule-pinned before snapshot, a different verified current after snapshot, the matching ResultPacket, and an accepted execution ReviewDecision; exact added/modified/removed File, Symbol, and Test revisions are content-derived, and sorted zero-or-more ChangeSet parents permit multiple-parent DAG shape without claiming automatic merge;
- Change-impact inference follows only reviewed `IMPLEMENTS` and `VERIFIED_BY` receipts and creates immutable hidden candidates or an explicit Unknown; a separate explicit impact ReviewDecision creates `ReviewedImpact` receipts and canonical reviewed `ChangeSet -[:IMPACTS]-> Feature|Capability` edges, while rejection creates no impact edge;
- CLI exposes ChangeSet record/status/artifact and impact review commands, read-only MCP exposes verified ChangeSet status without mutation authority, Context Compiler consumes only reviewed current `IMPACTS`, and tests cover Git absence, pinned-snapshot recovery, exact revision differences, multiple-parent schema shape, unaccepted execution rejection, candidate exclusion, review promotion, and contextual retrieval;
- VCS evidence protocol `0.1.0` now attaches explicitly selected commits only after validating them against current digest-verified Git history, embeds immutable GitCommit observations for later Git-absent reconstruction, preserves the exact ChangeSet identity, and projects derived `ChangeSet -[:MATERIALIZED_AS]-> VcsEvidence -[:REFERENCES]-> GitCommit` evidence without instruction or promotion authority;
- CLI exposes explicit VCS attachment and artifact reads, read-only MCP exposes one verified VCS artifact, bounded temporal traversal and ProductContext may consume current attachments, and tests cover unknown commits, tamper rejection, no-`.git` imported-history attachment, post-attachment Git-absent GraphSnapshot identity, ChangeSet identity invariance, and unavailable-history rejection;
- `GraphProjectionAdapter` contract `0.1.0` now separates recoverable temporal graph semantics from physical materialization and traversal, rejects adapters that claim canon/instruction/promotion/unique authority, and keeps backend identity outside World Model, GraphSnapshot, TraversalResult, and Context Capsule semantic identity;
- local JSON projection persists a content-addressed current pointer and immutable GraphSnapshots under `.head/graph-projection`, while an in-memory implementation and content-derived conformance report prove adapter-neutral snapshot and bounded-query identity; World Model indexing verifies projection materialization before advancing its pointer;
- ArcadeDB database-lifecycle protocol `0.1.0` performs a read-only existence and reserved-schema compatibility audit before activation, creates a missing exact selected database only through an explicit command, treats unrelated types as compatible shared schema, and permits reset only for a proven reserved-name kind/property conflict with an exact target-name confirmation; lifecycle audits and receipts are content-derived, exclude endpoint/database/credential values, invalidate only mutable remote-activation pointers after replacement, and leave immutable receipts plus the complete local graph mirror recoverable;
- ArcadeDB projection protocol `0.1.0` now resolves credentials only from environment reference names inside a bounded exact-child HTTP bridge, creates database-local snapshot/pointer plus snapshot-scoped vertex/edge topology schemas, inserts and re-reads immutable canonical GraphSnapshots, and requires baseline plus server-expansion conformance before persisting a content-addressed activation receipt; topology protocol `0.1.0` binds exact semantic node and edge sets to a separate content-derived receipt while excluding ArcadeDB RIDs from identity, resumes only manifest-free exact-subset partial writes, and rejects missing, extra, duplicated, tampered, or conflicting records; server traversal protocol `0.1.0` executes snapshot-scoped breadth-first bounded expansion; prepared traversal protocol `0.1.0` binds the fixed GraphSnapshot, query, result, exact bounded radius, and content-derived verification receipt so a newly conformed activation reads only the pointer, topology manifest, and requested records at query time, while complete remote snapshot/topology verification remains a separate status/activation audit; the client owns anchors, policy, bounds, canonical ordering, and result digests and rejects incomplete, forged, duplicate, out-of-radius, stale, or truncated responses; successful remote writes maintain a complete local mirror, availability-only failure before remote observation may fall back with disclosure, and authentication, request rejection, stale/tampered/conflicting/partial state, or semantic divergence fail closed;
- CLI, read-only MCP, and Context Compiler temporal expansion query through the adapter boundary, disclose deterministic embedded-GraphSnapshot fallback when no projection exists, and fail closed on stale, missing, tampered, conflicting, or semantically divergent adapter results;
- `DocumentProjectionAdapter` contract `0.1.0` now separates deterministic human-facing Markdown from graph semantics and physical publication, rejects canon/instruction/promotion/unique-authority claims, and keeps adapter kind and filesystem locations outside content-derived DocumentProjection identity;
- the Markdown reference renderer verifies one GraphSnapshot and emits bounded, canonically ordered index, node-kind, and canonical-relation pages with exact content digests and cross-links; local and in-memory adapters preserve the same DocumentProjection identity and published content through a conformance report;
- explicit CLI generation and read-only CLI/MCP status expose graph/source freshness and published-view drift without making document generation a World Model indexing prerequisite; modified generated pages are never overwritten and may be captured as immutable, content-derived `DocumentChangeCandidateSet` evidence with no instruction or promotion authority;
- incremental refresh protocol `0.2.0` now binds a verified base World Model and SourceSnapshot to immutable request/receipt evidence, rediscovers and byte-hashes the complete eligible file set, reuses semantic analysis only for digest-identical verified files, preserves the exact complete `repository.scan.v1` result semantics, and keeps document publication in a separately verified post-refresh stage while retaining read compatibility with `0.1.0` artifacts;
- an actual refresh automatically parents the new SourceSnapshot to the verified current snapshot, preserves unchanged revision identities and parent sets, parents changed revisions to their previous current revisions, validates the graph and preview identity before pointer advancement, and records exact added/changed/removed paths without requiring Git or GraphDB;
- active Runs retain their accepted WholePlanSnapshot, ExecutionContract, and ContextCapsule; refresh records the pinned and refreshed SourceSnapshot identities plus a required explicit HEAD continue/recompile/revise/cancel choice, while document publication remains a downstream non-authoritative projection decision;
- refresh-trigger protocol `0.2.0` now normalizes foreground filesystem and structured CI observations into bounded content-derived batches, canonically coalesces duplicates, records excluded and overflow evidence, treats every event path only as a reason to run the complete verified scan, links exact post-refresh document outcomes, and retains read compatibility with `0.1.0` artifacts;
- a project-scoped exclusive World Model writer lease serializes every persistent index or refresh pointer transition, safely recovers only a proven-dead exact owner without terminating another process, and combines with the refresh expected-pointer check; immutable delivery receipts bind trigger batches to incremental requests, receipts, and before/after World/Source/Graph identities, while writer-busy batches alone are boundedly requeued;
- CLI exposes structured CI ingestion, a foreground debounced filesystem watcher, trigger status, and delivery reads; MCP remains read-only, `.head` feedback does not self-trigger, watcher summaries are bounded, and active Run inputs stay frozen;
- post-refresh projection protocol `0.1.0` now records a content-derived manual-or-automatic operational policy and immutable receipt linking the exact refresh, before/after World/Source/Graph identities, policy, resulting Markdown projection, and optional document-change candidate set;
- the safe default is manual; explicit automatic mode regenerates only a clean deterministic Markdown view, captures current edits against their exact base GraphSnapshot before refresh, preserves edited, stale-edited, and unmanaged views, and isolates invalid policy or adapter failures without rolling back observed state or changing Product Canon;
- CLI can set/read policy and read outcomes while MCP remains read-only; Git and GraphDB are not consulted, post-refresh artifacts are excluded from Context Capsules, and legacy refresh artifacts remain verifiable;
- document-change review protocol `0.1.0` now records a content-derived scoped ReviewDecision over an exact `DocumentChangeCandidateSet`; acceptance requires a complete user-supplied Product Model and rejection forbids canon content, so Markdown prose is never automatically inferred into product authority;
- application verifies the candidate's exact published bytes, reviewed Product Canon, current World Model, and inactive Run boundary; accepted review writes the exact reviewed Canon, rebuilds a child SourceSnapshot and GraphSnapshot, verifies the resulting product projection, and reconciles Markdown, while rejection reconciles Markdown without Canon mutation;
- immutable ProductModelRevision, ReviewDecision, and DocumentChangeApplicationReceipt artifacts bind before/after Product/World/Source/Graph/DocumentProjection identities; CLI performs explicit review/application, MCP remains read-only, and neither Git nor GraphDB is consulted;
- temporal provenance `0.7.0` and World Model `0.10.0` project immutable document candidate sets, explicit reviews, reviewed Product Model revision receipts, and application receipts into later audit GraphSnapshots; candidate nodes remain opt-in and all graph records retain false instruction/promotion authority, while the application receipt binds the pre-audit result to avoid a content-hash cycle;
- inferred commit-to-ChangeSet matching, dedicated imported-backlog adapters, conformance, general candidate-promotion beyond implemented review scopes, complete execution-lineage graph projection, an executed live prepared-query evaluation, compare-and-swap remote publication, non-ArcadeDB transports, Obsidian/Notion adapters, automatic Obsidian/Notion publication, background watcher service installation, provider-specific CI webhook adapters, compute-backed graph/traversal/Context operations, production selection or transport amortization for the conformant Go `repository.scan.v1` candidate, AST-accurate/dynamic call resolution, provider-session project binding/control, and authorized general knowledge promotion remain explicitly deferred.

Current v0.6 alpha progress, verified on 2026-08-19; milestone remains active:

- runtime-adapter contract `0.1.0` defines separate `PlatformAdapter`, `AgentRuntimeAdapter`, and `WorkspaceHostAdapter` method and authority surfaces without importing provider-specific behavior into the core;
- projection-only Codex and OpenCode reference adapters expose deterministic descriptors and static contract probes while excluding provider session IDs, commands, prompts, transcripts, endpoints, credentials, and live process identities;
- contract-only Windows, macOS, and Linux PlatformAdapter references plus the native-process WorkspaceHostAdapter form a deterministic three-platform/two-runtime composition matrix whose identity is independent of the current host;
- the matrix explicitly records `actualPlatformExecutionValidated: false`, `actualRuntimeControlValidated: false`, `machineInterfacesVerified: false`, and `runtimeControlEnabled: false`, so contract coverage cannot be mistaken for an installed or controllable runtime;
- every runtime start/resume/stream/interrupt/close, executable resolution, process spawn/inspection/termination, host attach/send/receive/detach method fails closed with `RUNTIME_ADAPTER_CONTROL_NOT_ENABLED`;
- descriptors and probes reject canon mutation, instruction, promotion, control authority, TUI scraping, divergent describe/probe identity, unsupported platform/runtime values, explicit empty runtime sets, digest tampering, and capability-derived authorization;
- HEAD Session and Run identities remain canonical project artifacts while provider sessions remain future operational references only; an accepted ExecutionContract is still required before any consequential control capability may be activated;
- read-only CLI and MCP inspection expose the current project composition, complete contract matrix, machine discovery, bounded version and fixed-help protocol evidence, and canonical HEAD project/Session capability binding without creating or controlling a provider session;
- runtime-machine-discovery protocol `0.1.0` now inspects only absolute PATH entries and regular Codex/OpenCode executable candidates on the current host, emits content-derived discovered/canonical path identities instead of raw paths, and records launcher kind, byte size, symlink state, and direct-spawn safety without executing a provider;
- the current Windows observation discovers both Codex and OpenCode candidates, sets `machineInterfaceDiscoveryValidated: true`, and still sets actual platform execution, runtime control, process ownership, caller fencing, and provider session validation to false;
- runtime-version-evidence protocol `0.1.0` now invokes only the fixed non-session `--version` surface of native, non-symlink candidates through the PlatformAdapter and native-process WorkspaceHostAdapter boundaries with no shell, ignored stdin, a minimal allowlisted environment, bounded output and timeout, and exact-child exit evidence;
- the current Windows execution verifies both Codex and OpenCode while exposing only normalized versions, output digests and sizes, executable path digests, and lifecycle facts; raw paths, raw stdout/stderr, project content, credentials, provider session IDs, and child PIDs remain outside the evidence artifact;
- runtime-protocol-evidence protocol `0.2.0` now invokes three fixed help profiles per runtime through direct exact children, normalizes Codex non-interactive/JSON/app-server plus its complete fixed one-shot option surface and OpenCode run/JSON/ACP signals, and exposes only allowlisted signal names, digests, byte counts, and cleanup facts while rejecting raw paths, raw commands, raw output, project content, credentials, provider sessions, and PIDs;
- the current Windows execution observes every required Codex and OpenCode non-interactive and machine-protocol signal while keeping `actualProviderSessionControlValidated: false`, `runtimeControlEnabled: false`, and `providerSessionCreated: false`;
- runtime-project-binding protocol `0.1.0` binds version and protocol evidence to canonical HEAD project and Session identities, reduces the physical root to a digest, passes no project content, and explicitly records that actual provider-session binding is not validated;
- execution-authorization protocol `0.2.0` now provides one immutable envelope with `scope.kind: session | run`: Session binds an idle HEAD Session, user-request digest, optional ContextCapsule, local reversible action set, project/Session capability binding, project-root digest, and bounded resources without WholePlan or Fresh HEAD review; Run adds the exact active Run, verified ExecutionContract/WholePlan/required ContextCapsule, and contract-authorized workspace action;
- runtime-event-envelope protocol `0.1.0` plus lifecycle-receipt and ResultPacket-draft protocols `0.3.0` carry the scope through typed/digested JSONL evidence, hashed operational session references, lease/process-fence/cleanup facts, and transcript-free drafts; Run results require Fresh HEAD review while Session results do not create that gate;
- deterministic capability fixtures plus a fixed no-descendant execution child prove both Session and Run paths for Codex/OpenCode identities, Session-request digest drift rejection, exact-child exit, input-digest observation, timeout and caller-cancellation termination, scope-correct workspace action fencing, and cleanup without invoking either provider or enabling control;
- execution-lease protocol `0.3.0` externalizes authorization-specific PID/token/owner-lock state to a dedicated host-local operational root selected by process configuration, rejects relative/root/project-local/project-containing/symlinked/escaping paths, and exposes neither path nor live owner secrets through project lineage, CLI, or MCP;
- immutable project-lineage pre-start consumption and post-cleanup release receipts retain the honest shared at-most-once boundary; sequential and in-flight replay, receipt tamper, Run workspace-authority widening, Session/Run state drift, unsafe operational roots, and unknown-owner cleanup fail closed, while completion, timeout, and caller cancellation preserve non-replayable evidence and remove only exactly owned operational state;
- structured-result protocol `0.1.0`, lifecycle-receipt `0.6.0`, and ResultPacket-draft `0.5.0` now add one common bounded outcome/evidence/plan-delta/impact/verification/Unknown contract; Session results forbid plan delta and impact radius, raw JSONL and raw provider errors remain ephemeral, fixed sorted provider diagnostic codes are evidence-only Unknowns, and immutable transcript-free event/receipt/draft records are recoverable through CLI and read-only MCP;
- a Codex one-shot composition now revalidates the exact authorized executable/protocol/project binding and requires protocol evidence for every fixed invocation option before consuming the at-most-once lease, then invokes only the fixed `exec --json --ephemeral` surface with no shell, passes the exact authorized input over stdin, uses a host-local portable-subset output schema, hashes operational thread references, and persists no prompt, transcript, PID, raw command, absolute project root, or operational path; its protocol fixture is verified for both the lightweight Session result boundary and common lease/cleanup semantics, an incomplete option surface is rejected before consumption, and provider-neutral post-decode validation retains semantic byte/item/scope limits;
- cross-platform process-tree supervision is now implemented as a separate integrity-verified native helper. Windows uses a Job Object with kill-on-close and POSIX uses an isolated process group; operational control files and PIDs stay outside project canon, while durable receipts retain only the helper-manifest digest and bounded ownership/cleanup facts. Windows normal-exit/cancellation fixtures and the live Codex Run prove descendant cleanup. The fail-closed, idempotent application bridge now maps only a completed actual-provider Run draft into canonical ResultPacket and Fresh HEAD state, mirroring Execution Lineage text normalization before exact comparison. The live Session and consequential Run both conform; the Run performed the exact isolated write, canonical application, and Fresh HEAD review. Lifecycle receipt `0.6.0` and draft `0.5.0` preserve only privacy-reduced diagnostic codes. A 160 KiB JSONL tool-event fixture retains the former 128 KiB failure shape and completes under the enlarged transport default without persisting raw payload. The live verifier defaults to `run-only`, keeps `session-and-run` as optional broader coverage, requires deliberate live opt-in, and imposes no product-level model-call quota. Total stdout and one JSONL event remain bounded at 8 MiB and 2 MiB respectively, while the semantic structured result remains bounded at 128 KiB. OpenCode invocation, provider resume/attachment, messaging, and general runtime controls remain deferred.

## Roadmap

### v0.3 — Execution Lineage Contract — verified alpha foundation

Freeze and validate content-derived `WholePlanSnapshot`, `ExecutionContract`, `ResultPacket`, `ReviewDecision`, and `LineageLink` artifacts. Connect them to Run and Capsule identities without breaking current Session/Run behavior.

### v0.4 — Fresh HEAD planning and review — verified alpha foundation

Implement planning generations `a -> plan1 -> a1 -> plan2 -> a2`, bounded result compilation, review dispositions, knowledge-promotion proposals, and explicit next-plan creation. Prior planning transcripts remain retrievable evidence but are not automatically injected.

### v0.5 — Repository World Model

Add a provider-neutral `ComputeAdapter` before new heavy analysis paths, preserve current JavaScript behavior as the semantic reference, and introduce a bundled Go worker only through canonical-output conformance and benchmark gates. Move file scan/parse, World Model construction, temporal graph construction, and bounded traversal incrementally while keeping authority, Product Canon, ReviewDecision, Context policy, CLI, and MCP in the JavaScript control plane. Add an initial onboarding state machine that can index existing projects or bootstrap new-project briefs, infer evidence-linked product candidates, and promote a batch only through an onboarding-scoped ReviewDecision. Add incremental file, symbol, dependency, Feature/Capability, provider-neutral ChangeSet/revision, optional VCS evidence, and runtime-state indexing with claim-level freshness and Hot/Warm/Cold history. Introduce a multiple-parent temporal provenance DAG, a replaceable `GraphProjectionAdapter`, typed and provenance-complete relationship allowlists, immutable mapping candidates with ReviewDecision-gated promotion, deterministic bounded traversal, and Markdown-first knowledge projections. Explicit indexing, changed-file rebuild, bounded debounced filesystem/CI ingestion, and safe opt-in automatic Markdown regeneration now create or project immutable verified artifacts without changing Canon or active execution inputs. GraphDB, Git, and native acceleration remain replaceable implementation choices; none may become the unique authority or a prerequisite for core semantic recovery.

### v0.6 — Runtime adapters

The contract foundation defines and tests `PlatformAdapter`, `AgentRuntimeAdapter`, and `WorkspaceHostAdapter` references for Codex and OpenCode across Windows, macOS, Linux, and the native-process host. Privacy-preserving current-host discovery, bounded non-session version/help evidence, and canonical HEAD project/Session capability binding are active. One `ExecutionAuthorization` envelope expresses lightweight Session and full Run scopes; a common immutable pre-start consumption and post-cleanup release chain enforces at-most-once use, while provider-neutral event, lifecycle-receipt, structured-result, and scope-correct result-draft schemas prove request/input drift rejection, exact-child success, timeout, caller-cancellation cleanup, replay rejection, and privacy-reduced provider diagnostics. Ephemeral PID/token/owner-lock/schema/control-file state is externalized while durable transcript-free evidence remains project lineage. The first Codex exec adapter is connected, native-supervised, protocol-fixture verified, and live-conformed for both Session and Run. Invocation-record persistence/recovery and exact Run-result application are provider-neutral cores that derive runtime evidence from the verified authorization and bind an eligible draft to its canonical ResultPacket and Fresh HEAD review without granting Product Canon or promotion authority. NeoPick source scope, behavior-clustered onboarding inference, and bounded Context latency now conform locally; next review the exact `revise` proposal, validate `neopick` remote activation, and add OpenCode launch/event extraction through the same core contract. Capability discovery never grants authorization, and provider sessions never replace HEAD Session or Run identities.

### v0.6 exit goal — Risk-proportional actual-provider vertical

Before adding general provider controls, apply the reference HEAD Core's complete launch/wait/result/delivery/cleanup behavior through provider-neutral adapters. The common `ExecutionAuthorization`, external operational-state boundary, and native descendant-tree supervisor are now established; next prove both a bounded Session invocation and a full Run invocation against Codex. Session mode must remain useful for reversible one-shot work without manufacturing WholePlan, persistent Capsule, or ReviewDecision artifacts; Run mode retains the complete auditable lineage. After Codex passes live caller, event normalization, timeout/cancellation, cleanup, and result-evidence conformance, add OpenCode through the same core contract. Role messaging, daemon/service installation, provider resume, and Herdr integration remain later optional adapter work.

### Cross-cutting exit goal — Operational completeness with a smaller rule surface

Before v1.0, demonstrate the adopted reference behaviors through the public plugin path and perform a rule-deletion review. The milestone report must distinguish retained universal invariants, lane- or subsystem-scoped constraints, adapter-local quirks, deferred optional capabilities, and removed duplicate or outcome-neutral gates. Success is measured by recoverable user outcomes across initialization, Session, Run, failure, and provider replacement—not by the number of schemas, checks, tests, or policy statements retained.

### v1.0 — Auditable provider-neutral HEAD runtime

Demonstrate reproducible lineage and recovery across supported runtimes, verify authority and failure boundaries, and prove that a provider session can be replaced without losing the whole objective or evidence chain.

## Direction-check questions

Every material change answers these six universal questions:

1. Which objective does the change advance, and is Observe, Session, Run, or Authority the lightest safe lane?
2. Who owns the relevant decision, what is canon for this question, and is any evidence or projection being mistaken for authority?
3. Are credentials, paths, process ownership, external effects, and irreversible actions bounded at the level required by the selected lane?
4. Can the result return as direct evidence, difference, impact, verification, and explicit Unknowns rather than raw context or an unsupported success claim?
5. Are incomplete capabilities and optional Git, GraphDB, native, document, host, or provider dependencies disclosed honestly with a safe recovery or fallback boundary?
6. Does the change preserve provider-neutral HEAD project/Session identity, avoid unrelated procedural gates, and replace or narrow an existing rule instead of duplicating it where possible?

Then load only the relevant subsystem questions:

### Run and Authority changes

- Is the consequential execution bounded by an accepted ExecutionContract and reproducible ContextCapsule?
- Can a Fresh HEAD understand the whole plan, ResultPacket, impact, and Unknowns without executor transcript or provider-session state?
- Are accepted inputs frozen, artifact identities/parents digest-verifiable, and drift resolved by an explicit continue, recompile, revise, cancel, rollback, or escalate decision?
- Do failure and cancellation preserve lineage and cleanup evidence without advancing the plan or canon?

### Graph, canon, onboarding, refresh, and document changes

- Is GraphDB optional and reconstructable, and do core semantic identities remain valid without Git?
- Are inferred mappings and document edits immutable candidates until scoped review creates a separate reviewed relation or canon revision?
- Does the revision model accept multiple parents without claiming automatic merge, and does every current node/edge carry the applicable provenance, freshness, evidence, producer, and authority metadata?
- Is traversal bounded by relation/authority/freshness/confidence/depth/size policy, and are candidates excluded unless explicitly requested?
- Does refresh validate a new immutable snapshot before pointer advancement without changing accepted execution inputs or promoting meaning automatically?
- Can onboarding distinguish existing-code evidence, a new-project brief, and pre-existing canon while supporting bounded batch review?
- Can a canon change be reviewed as an exact digest-bound patch with a complete resulting-model preview rather than forcing unrelated content resubmission?

### Native compute changes

- Does switching backend preserve canonical output and every semantic identity for the same accepted input and protocol version?
- Is the worker plugin-owned, bounded, integrity-checked, shell-free, authority-free, and recoverable through the JavaScript reference path where fallback is safe?
- Are timeout, cancellation, output/protocol failure, PID/descendant cleanup, canonical ordering, and benchmark justification proved for the migrated operation?

### Runtime and workspace-host changes

- Does the adapter use a supported machine interface rather than TUI scraping, hidden-session dependence, or provider-session identity as core state?
- Does evidence distinguish static contract coverage, actual platform execution, provider-session attachment, and live runtime-control validation?
- Does capability remain separate from authorization, with exact project/caller/process ownership and lane-appropriate permissions?
- Do Session and Run share lifecycle safety while avoiding WholePlan/Review gates for reversible Session work?
- Is ephemeral operational state outside project canon while durable authorization and result evidence remains recoverable?

### Remote GraphDB development changes

- Are writes confined to the exact user-selected database after explicit approval, is initialization limited to a proven incompatible-state blocker, and are credentials and backend record identities absent from semantic artifacts, logs, and reports?

If an applicable answer is “no” or “unknown,” record the gap before proceeding. Unrelated subsystem questions are not blockers.

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
- 2026-08-19: activated `repository.scan.v1` as the first ComputeAdapter operation with a strict backend-neutral result schema, shared deterministic source analysis, fixed corpus, failure and tamper validation, repeatable benchmark harness, and World Model conformance proof. The Go binary remains deferred until it can match this canonical contract and demonstrate a measured benefit.
- 2026-08-19: activated the first verified Go worker transport slice without migrating repository semantics: content-addressed per-platform manifests, plugin-root path confinement, SHA-256 and size checks, direct bounded stdio, exact child-PID cleanup, authority-free health conformance, and disclosed JavaScript fallback are active. Availability and crash failures may fall back; timeout, cancellation, output-bound violations, and invalid native protocol/digest output fail closed after cleanup. `repository.scan.v1` remains on the JavaScript semantic oracle until native conformance and benchmark evidence exist.
- 2026-08-19: completed a Go `repository.scan.v1` candidate and proved six complete JavaScript/Go success-and-failure responses plus fixed and large corpus identities. The work also corrected duplicate-symbol self-invalidity in source-analysis `0.2.0` and expanded the tracked multilingual/Unicode corpus. Benchmarks showed substantial small-input regression, slight medium regression, and only about 1.07x large-input improvement, so the release manifest does not advertise the operation. Production activation remains deferred until size-aware selection, persistent transport, or another measured design produces repeatable material benefit without semantic drift.
- 2026-08-19: completed the initial onboarding authority slice: initialization and deterministic legacy migration now establish project-scoped Session and onboarding state, local operation remains complete while privacy-safe GraphDB selection is pending, verified repository evidence or a structured brief creates immutable bounded product candidates, and only an explicit onboarding-scoped ReviewDecision may create Product Canon. Acceptance records immutable previous/next Product Model evidence and verifies a child temporal GraphSnapshot before ready; stale/tampered/secret-bearing inputs fail closed. v0.5 remains active for imported-backlog adapters, candidate and promotion-receipt graph projection, Feature/code/test mappings, ChangeSet/conformance, document projection, replaceable GraphProjectionAdapter/GraphDB, and observed-state refresh.
- 2026-08-19: completed the onboarding temporal-projection slice: immutable CandidateSets, nested Evidence and Unknowns, every historical ReviewDecision, and previous/resulting ProductModelRevision receipts are digest-verified and projected into World Model `0.5.4` / temporal provenance `0.3.0`. Candidate identity no longer depends on a derived World Model pointer, allowing deterministic restart and multiple historical reviews. Candidate-space traversal is explicit opt-in and Context compilation remains Product-Canon-only, so graph auditability expands without transferring authority to the graph. v0.5 remains active for Feature/code/test mapping candidates, ChangeSet/conformance, document projection, imported-backlog adapters, and replaceable GraphProjectionAdapter/GraphDB work.
- 2026-08-19: completed the first Feature/code/test mapping authority slice: bounded immutable `FeatureMappingCandidateSet` artifacts record exact current endpoints, revisions, Evidence, producer, confidence, Product Model, GraphSnapshot, and SourceSnapshot identities; explicit accept/reject ReviewDecisions create separate reviewed relationship receipts and canonical-direction `IMPLEMENTS`/`VERIFIED_BY` edges without mutating Product Canon. Normal traversal and Context compilation exclude unreviewed mapping surfaces, while ProductContext may consume current reviewed mappings. Drift, tamper, stale identity, and active/pending Run conflicts fail closed; Git, GraphDB, and native compute remain optional. v0.5 remains active for ChangeSet/conformance, document projection, imported-backlog adapters, and replaceable GraphProjectionAdapter/GraphDB work.
- 2026-08-19: completed the first provider-neutral ChangeSet and impact-authority slice: accepted execution lineage binds exact pre/post SourceSnapshots and File/Symbol/Test revision differences into Git-independent immutable ChangeSets with multiple-parent DAG schema support. Reviewed Feature mappings may propose bounded impact candidates, but only a separate explicit ReviewDecision creates ReviewedImpact receipts and canonical `IMPACTS` edges. Normal traversal and Context compilation exclude impact candidates and consume reviewed impacts only. v0.5 remains active for optional VcsEvidence attachment, conformance, document projection, imported-backlog adapters, replaceable GraphProjectionAdapter/GraphDB, and observed-state refresh.
- 2026-08-19: completed the optional VCS evidence slice without changing ChangeSet authority or identity: explicit commit selection is validated against verified Git history, immutable embedded observations survive later Git absence, and the temporal graph projects `MATERIALIZED_AS` / `REFERENCES` as evidence-only relations. Automatic commit matching remains deferred; v0.5 remains active for conformance, document projection, imported-backlog adapters, replaceable GraphProjectionAdapter/GraphDB, and observed-state refresh.
- 2026-08-19: completed the first replaceable GraphProjectionAdapter slice: the embedded World Model GraphSnapshot remains the recoverable source, local JSON and in-memory adapters preserve identical content-derived graph and traversal results, materialization and pointers are digest-verified, Context Compiler traversal is adapter-neutral, missing projection falls back with disclosure, and stale/tampered/authority-claiming/divergent adapters fail closed. The remote GraphDB adapter remains deferred, so v0.5 stays active for GraphDB transport, deterministic document projections, imported-backlog adapters, conformance, and observed-state refresh.
- 2026-08-19: completed the first deterministic Markdown projection slice: a provider-neutral DocumentProjectionAdapter renders verified GraphSnapshots into bounded content-addressed index, node-kind, and canonical-relation pages; local and in-memory adapters preserve identical projection identity and published content. Generation is explicit, stale/tampered/authority-claiming/divergent outputs fail closed, edited published pages are never overwritten, and explicit capture creates immutable non-authoritative DocumentChangeCandidateSets requiring a future scoped ReviewDecision. v0.5 remains active for document-candidate review/application, Obsidian/Notion adapters, automatic projection refresh, remote GraphDB transport, imported-backlog adapters, conformance, and observed-state refresh.
- 2026-08-19: clarified the projection/refresh sequencing gap without changing authority or scope: the explicit Markdown reference renderer is an early conformance baseline, while automatic document regeneration remains ordered after incremental and debounced refresh validation and is still deferred.
- 2026-08-19: completed the explicit incremental observed-state refresh slice: immutable content-derived requests and receipts bind the verified base and resulting World Model/SourceSnapshot/GraphSnapshot identities; complete discovery and byte hashing reuse only digest-identical file analysis while preserving full reference-scan output; actual changes automatically create parented SourceSnapshot and revision DAG transitions; active Runs keep frozen Capsules and receive explicit drift evidence. Debounced filesystem/CI ingestion, automatic document regeneration, and remote GraphDB refresh remain deferred.
- 2026-08-19: completed the bounded debounced refresh-trigger slice: foreground filesystem watching and strict CI event files produce deterministic immutable trigger batches and delivery receipts, event paths remain non-authoritative hints to a complete rescan, duplicate/excluded/overflow observations are recorded, and every persistent World Model pointer writer shares an exclusive project lease with safe proven-dead recovery. Read-only MCP cannot start ingestion; active Run inputs, Product Canon, documents, Git independence, and GraphDB optionality remain unchanged. Background services, provider-specific CI webhooks, automatic document regeneration, and remote GraphDB refresh remain deferred.
- 2026-08-19: completed the first safe post-refresh Markdown projection slice: a content-derived operational policy defaults to manual and requires explicit user selection for automatic mode; clean views regenerate only after verified refresh, current edits are captured against their exact base GraphSnapshot and preserved, invalid policies or projection failures cannot roll back observed state, and immutable receipts link refresh, policy, graph, projection, and candidate evidence without entering Product Canon or active execution inputs. Document candidate review/application, Obsidian/Notion publication, and remote GraphDB transport remain deferred.
- 2026-08-19: completed explicit DocumentChangeCandidate review/application: Markdown edits remain immutable proposals; acceptance requires a complete user-authored Product Model, exact candidate and Canon freshness, inactive Run state, a verified child SourceSnapshot/GraphSnapshot, and deterministic Markdown reconciliation; rejection leaves Canon and graph unchanged while restoring the verified projection. Immutable review, ProductModelRevision, and application receipts are active through mutating CLI and read-only MCP surfaces without Git or GraphDB. Temporal projection of those review receipts, Obsidian/Notion backends, and bidirectional synchronization remain deferred.
- 2026-08-19: completed the document-review temporal audit slice: immutable document candidate sets, explicit review decisions, Product Model revision receipts, application receipts, and pre-audit DocumentProjection references are projected into later temporal GraphSnapshots; candidate surfaces remain explicit opt-in and application identity binds the pre-audit result to avoid a content-hash cycle. Obsidian/Notion backends and bidirectional synchronization remain deferred.
- 2026-08-19: completed the first conformance-gated ArcadeDB projection slice: onboarding still stores only endpoint/database and environment reference names, explicit activation creates and verifies immutable remote snapshot/pointer documents, local and remote bounded traversal identities must match before an activation receipt becomes current, and every successful remote write maintains a recoverable local mirror. Availability before remote observation may fall back with disclosure; authentication, stale/tampered/conflicting/partial remote state and semantic divergence fail closed. Server-side vertex/edge traversal, compare-and-swap transactions, pooling/retry, and non-ArcadeDB transports remain deferred.
- 2026-08-19: completed the first native ArcadeDB topology slice: explicit activation now materializes every semantic node and edge under its immutable GraphSnapshot, binds exact sorted sets and counts to a content-derived topology receipt, excludes ArcadeDB record IDs from semantic identity, resumes only exact manifest-free partial writes, and re-verifies the complete topology before query or status succeeds. Traversal consumes the verified remote topology but still runs the deterministic client reference algorithm; server-side bounded traversal, compare-and-swap transactions, pooling/retry, and non-ArcadeDB transports remain deferred.
- 2026-08-19: completed the first conformance-gated ArcadeDB server-expansion slice: activation now runs baseline snapshot conformance, materializes and verifies topology, then proves two named queries through snapshot-scoped breadth-first `TRAVERSE` before advancing topology and activation receipts. The client fixes anchors and all semantic policy, requires the exact unfiltered bounded radius, caps responses at 8,192 records, rejects missing/forged/duplicate/out-of-radius/stale/truncated evidence, and returns the unchanged deterministic reference identity. This activates server graph expansion without transferring authority or claiming end-to-end acceleration; prepared query execution that avoids full remote reload remains the next slice.
- 2026-08-19: completed the provider-neutral prepared-traversal slice: content-derived requests bind the embedded GraphSnapshot, deterministic query/result identities, and exact bounded expansion; adapters return verification receipts rather than semantic results. Newly re-conformed ArcadeDB activations verify the current pointer and topology manifest and fetch only bounded traversal records, with tests proving zero full snapshot/topology query reads and fail-closed manifest, coverage, forgery, and truncation handling. Legacy activations retain their prior full verification path, local/in-memory implementations preserve identical results, and complete remote status remains the full-audit boundary. Live transport-cost and latency evidence is the next slice.
- 2026-08-19: completed deterministic prepared-traversal cost evidence and the safe live benchmark boundary: protocol `0.1.0` binds canonical payload-component counts to exact graph/request/query/result identities while excluding latency and transport diagnostics from semantic identity. The reviewed 64-file fixture proves 20,478 prepared bytes versus an 833,590-byte conservative full-reload baseline (813,112 bytes and 9,754 basis points saved), with zero query-phase writes and zero full snapshot/topology reads. The optional live path requires an already verified prepared activation, resolves credentials only through stored environment reference names, accepts no credential flags, rejects fallback or identity drift, guards every write method, and omits endpoints, database names, paths, and secrets from reports. An ignored local sandbox fixture now proves the selection and local onboarding path, but the external activation did not start because transmitting derived graph payloads and performing remote writes requires explicit risk-informed reapproval; an executed live result remains a gap rather than a claimed completion.
- 2026-08-19: moved the active implementation milestone to the required v0.6 runtime-adapter boundary while retaining the unavailable live ArcadeDB run as an explicit v0.5 evidence gap. Runtime-adapter contract `0.1.0` now proves deterministic provider/platform/host contract composition for Codex and OpenCode across Windows, macOS, Linux, and native-process without claiming live availability: every machine-interface and control capability remains disabled, provider sessions remain external operational references, capability grants no authorization, and the CLI/MCP surfaces are static read-only inspection only.
- 2026-08-19: adopted implementation-first validation sequencing by user direction: build the connected provider-neutral plugin and runtime verticals before expanding exhaustive tests for each small feature, retain mandatory fail-closed authority/credential/identity/process checks during construction, then concentrate cross-runtime, recovery, GraphDB sandbox, and full-lineage proof in integrated E2E milestones.
- 2026-08-19: designated the remote ArcadeDB `sandbox` database as the only external write target for plugin development E2E. Credentials remain runtime-only and unpersisted; the remote graph stays a replaceable derived projection and cannot become Product Canon, unique lineage storage, or a plugin prerequisite.
- 2026-08-19: completed the first read-only runtime machine-discovery implementation beyond the static contract matrix. The current host discovers Codex and OpenCode through absolute PATH inspection and emits only hashed path identities plus launcher safety facts; no executable is invoked, no provider session is opened, all controls remain disabled, and actual platform execution remains the next gate.
- 2026-08-19: completed the bounded non-session runtime version-evidence slice. The PlatformAdapter resolves only native non-symlink candidates, the native-process WorkspaceHostAdapter directly executes a fixed version flag with no shell or stdin under strict timeout/output/environment limits, and the AgentRuntimeAdapter returns normalized version and digest/lifecycle evidence without raw paths, raw output, credentials, project content, provider sessions, or PID identity. The current Windows host verifies Codex and OpenCode; capability still grants no authorization and all provider-session/runtime control remains disabled.
- 2026-08-19: completed the bounded provider protocol and HEAD project/Session capability-binding slice. Three fixed help profiles per runtime now prove Codex non-interactive JSON/app-server and OpenCode non-interactive JSON/ACP surfaces through exact direct children; artifacts retain only allowlisted capability signals, digests, sizes, and cleanup facts. A separate content-derived binding connects those observations to canonical HEAD project and Session identities while hashing the physical root and passing no project content. Actual provider-session binding, ExecutionContract-bound invocation, caller/child fencing, structured event/ResultPacket handling, and all runtime controls remain disabled and deferred.
- 2026-08-19: completed the ExecutionContract-bound runtime invocation authorization and lifecycle-schema conformance slice. An exact active Run with explicit runtime/workspace actions now produces an immutable non-executing authorization bound to the WholePlan, ContextCapsule, project/Session capability evidence, project-root digest, input digest/size, and resource limits. Provider-neutral JSONL event envelopes, lifecycle receipts, and transcript-free ResultPacket drafts are active; a fixed no-descendant child proves Codex/OpenCode success, timeout and caller-cancellation termination, exact-child cleanup, input observation, and write rejection without invoking either provider. Durable single-use execution leases, actual provider-session attachment, live caller/descendant fencing, actual provider event normalization, and every runtime control operation remain deferred.
- 2026-08-19: completed the durable runtime execution lease slice with an honest at-most-once guarantee. An authorization-specific owner lock serializes a single caller, immutable consumption is recorded before child start, release is recorded only after exact owner-lock removal, and a consumed authorization remains non-replayable across success, timeout, cancellation, concurrent calls, or caller failure. Lifecycle receipts and ResultPacket drafts bind the lease chain; CLI and MCP inspect it without mutation. Actual Codex/OpenCode model invocation, live descendant ownership, provider event normalization, provider-session attachment, and general runtime controls remain deferred.
- 2026-08-19: compared the reference HEAD Core's complete initialization, caller fencing, worker lifecycle, canon recovery, durable coordination, and rollback behavior with the plugin's richer provider-neutral authority/graph/lineage control plane. Adopted those operational behaviors as adapter-level targets without inheriting OpenCode, Herdr, `.claude`, POSIX service, shell, pane/tab, or provider-session coupling. Also replaced globally cumulative governance with progressive rule loading and risk-proportional Observe, Session, Run, and Authority lanes: reversible Session work must not manufacture WholePlan/Review artifacts, while consequential Run and Authority work retains the complete lineage, user-owned decision, and fail-closed safety boundaries.
- 2026-08-19: completed the external operational-state boundary required before actual-provider execution. Execution-lease protocol `0.3.0` keeps immutable authorization consumption/release evidence in project lineage while moving PID, token, and owner-lock state to a validated host-local root; unsafe roots and legacy project-local locks fail closed, CLI/MCP disclose no path or owner secrets, and exact-owner cleanup is verified across completion, timeout, cancellation, spawn failure, replay, and concurrent contention. The next milestone is now one actual provider through both bounded Session and consequential Run lanes.
- 2026-08-19: connected the first Codex one-shot provider composition without claiming live completion. The implementation revalidates exact executable/protocol/project binding, consumes one Session- or Run-scoped authorization, invokes the official non-interactive JSONL/ephemeral surface through direct spawn, extracts a bounded `RuntimeStructuredResult`, and stores only digest-verifiable transcript-free events, lifecycle receipt, and ResultPacket draft for CLI/read-only MCP recovery. A Codex protocol fixture proves thread reference hashing, structured result extraction, Session scope, durable recording, and exact fixture-child cleanup. A live model call, descendant-tree ownership, and canonical Run ResultPacket conversion remain explicit gates; until then actual receipts fail verification rather than overstating control conformance.
- 2026-08-19: completed the cross-platform runtime descendant-tree supervision slice without widening provider authority. A separately manifested Go helper owns the provider subtree through Windows Job Object kill-on-close or an isolated POSIX process group, receives its bounded request over stdin, writes operational-only control evidence to the external state root, and leaves only manifest/ownership/cleanup digests in project lineage. Windows normal completion and cancellation remove a real lingering grandchild; the Codex JSONL protocol fixture now runs through this supervisor and produces a verification-passed tree boundary. No live model call, canonical Run ResultPacket conversion, OpenCode execution, resume/attachment, or general control is claimed; bounded live Codex Session then Run conformance is the next gate.
- 2026-08-19: converted the HEAD Core comparison and governance-relaxation decision into explicit adoption, convergence, and rule-complexity goals. Operationally complete initialization, fencing, lifecycle, recovery, scoped coordination, rollback, and state separation are adopted through provider-neutral contracts; provider/host coupling is not. Reference parity now means recoverable behavioral outcomes rather than package-tree or ritual parity. Every active rule receives the narrowest universal/lane/subsystem/adapter/advisory scope, every new mandatory rule needs an enforcement point, observable failure, and narrowing/removal condition, and milestone review includes a rule-deletion pass rather than treating accumulated gates or tests as progress.
- 2026-08-19: implemented the deterministic Codex Run-result application bridge without overstating live conformance. Only a completed exit-zero actual-provider Run with verified structured output, exact project/input fences, and native descendant-tree ownership may create the canonical ResultPacket and Fresh HEAD review; an immutable content-derived receipt makes the transition recoverable and idempotent, while Session results, divergent recovery, raw transcripts, provider identities, promotion, and Product Canon mutation fail closed. The explicit live verifier remains opt-in because it performs two real Codex model calls and an isolated workspace write.
- 2026-08-19: extracted invocation-record persistence/recovery and Run-result application from the Codex executor into provider-neutral cores. Recovery now verifies authorization, runtime, project, HEAD Session, scope, receipt, events, and draft as one lineage; ResultPacket runtime evidence derives from the authorization; and lifecycle provider modes derive from the selected runtime, with OpenCode protocol-fixture validation active. Codex retains only its launch, schema, and event-extraction adapter responsibilities. This narrows provider coupling without claiming OpenCode execution or live-provider conformance.
- 2026-08-19: hardened the Codex live boundary after an approved Session attempt reached the actual provider process but exited unsuccessfully and an earlier unsupported option exposed CLI drift. Runtime protocol evidence `0.2.0` now records the complete fixed Codex one-shot option surface, and the Codex adapter rejects a missing option before owner-lock claim, immutable lease consumption, schema creation, supervisor resolution, or provider start. A deterministic drift fixture removes one option while preserving generic protocol negotiation and proves `CODEX_EXEC_INVOCATION_SURFACE_NOT_VERIFIED` with the authorization still available; this is one adapter-scoped enforcement point rather than a new core authority rule. Successful live Session and Run conformance still require separate explicit model-call approval.
- 2026-08-19: executed a second approved live Session attempt through the fixed native-supervised boundary. It created a provider thread and turn, then emitted `error` and `turn.failed`, exited 1, returned no structured result, and verified descendant-tree ownership/cleanup; the sequential verifier correctly did not start Run. Hardened the Codex adapter wire schema to a portable Structured Outputs subset by removing the dialect declaration and type-specific length/item constraints while keeping all semantic byte, list-count, scope, and total-size checks in the provider-neutral validator. Deterministic lifecycle verification proves both the portable wire shape and retained semantic rejection. A post-hardening live retry was not executed because it requires a new risk-informed approval after the failed call; no successful live conformance is claimed.
- 2026-08-19: executed the separately approved post-hardening sequence. The real Codex Session completed with structured output, preserved its read-only fixture, and proved native descendant ownership/cleanup, establishing the first live Session conformance. The following real Run observed structured output but stopped as `invalid-event` before `turn.completed`, so the verifier did not validate the isolated file write, canonical ResultPacket application, or Fresh HEAD transition. The exact historical cause is not retroactively asserted. Lifecycle receipt `0.6.0` and ResultPacket draft `0.5.0` now retain only fixed sorted provider and internal-boundary diagnostic codes, surface them as evidence-only Unknowns, and keep raw error text, paths, payloads, and transcripts ephemeral. A further model call requires separate approval.
- 2026-08-19: diagnosed the live Run failure shape without another model call. The failed Run emitted 166,818 stdout bytes while its omitted `maxEventBytes` field inherited the former 128 KiB default. A supervised deterministic fixture now emits a valid structured result followed by one 160 KiB `item.completed` tool record: the former explicit bound reproduces `structuredResultObserved: true`, `invalid-event`, `codex.event-byte-limit`, and absent `turn.completed`; the enlarged default completes the identical sequence. Total stdout and per-event transport limits are now 8 MiB and 2 MiB, a smaller selected total limit still caps the event limit, the independent 128 KiB structured-result contract is unchanged, and accepted or rejected raw event payloads remain unpersisted. Because the historical raw JSONL was intentionally ephemeral, this is strong causal reproduction rather than a retroactive exact-event claim; a live Run remains the conformance gate.
- 2026-08-19: removed the temporary exact model-call budget after agreeing that call count is not a product success criterion. `run-only` remains the default efficient coverage path and `session-and-run` remains optional broader regression, but evidence-led retries are allowed under deliberate live opt-in. The acceptance target moved to the real NeoPick path: isolated onboarding, inferred Feature/code/change model, graph projection, Context and Execution Lineage, and Fresh HEAD behavior, with remote publication following local evidence and explicit target selection.
- 2026-08-19: doubled the operational Codex output envelope to 8 MiB total stdout and 2 MiB per JSONL event while retaining the independent 128 KiB semantic structured-result contract. The first real `run-only` attempt completed provider execution and native cleanup but exposed a canonical ResultPacket comparison mismatch. The application bridge now mirrors Execution Lineage trimming for outcome, plan delta, impact radius, and Unknowns and reports only mismatched field names on conflict. The following actual Run passed the exact isolated file write, protected-fixture check, canonical ResultPacket application, Fresh HEAD review, descendant cleanup, transcript-free evidence, and no-Product-Canon-mutation assertions.
- 2026-08-19: validated NeoPick onboarding against an isolated projection of the exact 870 files accepted by the repository scanner; the 12.8 GB source was not mutated and its `.venv`, binary captures, unsupported files, and symlink were not copied. The local path produced 5,299 symbols, 44,476 call observations, 49 onboarding candidates, and a current 12,643-node/19,907-edge graph. Candidate traversal was available only through explicit unreviewed opt-in and normal traversal hid the batch. The candidate mix nevertheless included `.omo` drafts, bundled model internals, and test doubles, so no promotion occurred. A realistic Context preview remained unfinished after roughly three minutes and was cancelled with no residual process. The user selected the `neopick` database directly rather than `sandbox` and authorized target initialization only if existing data interferes, but remote activation/initialization is deferred until project source scoping improves, candidates are reviewed, and credential references are safely available to the process; no credential value or remote write was persisted.
- 2026-08-19: completed the NeoPick source-scope and bounded Context slice without authority escalation. Repository source-scope `0.1.0`, repository scan `0.3.0`, and World Model `0.10.1` bind normalized user-selected include/exclude roots to scan identity while keeping them outside Product Canon. The isolated projection retained 291 of 870 eligible files after excluding `.omo`, the separate pytest copy, IDE/cache/debug roots, and bundled model implementations; behavior-ranked onboarding inference replaced alphabetical symbol selection, and all 49 candidates remain unreviewed. Context Compiler `0.9.0` reuses verified current analysis, pre-indexes semantic adjacency, and performs one temporal anchor instead of one traversal per file; identical 4,000-token Capsules completed in 6.5 and 7.2 seconds rather than exceeding roughly three minutes. The pending storage selection names `neopick` through secret references only, but no remote write or database initialization occurred.
- 2026-08-19: added the explicit ArcadeDB database lifecycle boundary required before live `neopick` activation. The HTTP bridge exposes only fixed ready/exists/create/drop database operations, not arbitrary server commands; a content-derived audit compares only five HEAD-reserved type names and expected kind/property types, preserves unrelated schema, and classifies missing, compatible-empty, compatible-partial, compatible-complete, or incompatible state without persisting endpoint, database, credential, or record identities. Explicit initialization creates a missing database, reuses a compatible database, or resets only a proven incompatible database after exact target confirmation; replacement invalidates mutable remote activation pointers while immutable receipts and the local graph mirror remain recoverable. Isolated lifecycle and the existing 28-scenario integrated suite pass, but no live remote operation is claimed because credential references are not present in the Codex process.
- 2026-08-19: replaced one-symbol/one-concept NeoPick onboarding inference with bounded behavior clustering. Inference `0.3.0` filters generic close/click/create/logging/serialization helpers, clusters up to 24 ranked symbols into at most 16 behavior concepts, emits one broad Capability plus one representative Feature per cluster, excludes instruction documents from FeatureGroup evidence, and never auto-attaches an inferred group. The same isolated 291-file NeoPick source now yields 23 unreviewed candidates instead of 49, including Calibration, Image Acquisition, Inference, Picking Control, PLC Communication, Point Cloud Processing, Sensor Alignment, and Shared State Transport. `docs/neopick-onboarding-review-proposal.md` records an exact `revise` proposal; no Product Canon or remote graph was changed.
