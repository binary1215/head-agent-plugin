# Architecture decision

## Adopted shape

The plugin is organized as thin provider distributions around a provider-neutral core:

```text
.codex-plugin/plugin.json
  -> skills/head-agent-core       human/agent operating contract
  -> .mcp.json                    read-only inspection surface
  -> scripts/head.mjs             explicit mutation entrypoint
       -> scripts/lib/head-core   project canon and projections
       -> scripts/lib/context-compiler
                                  versioned task Context Capsules
       -> scripts/lib/execution-lineage
                                  content-derived lineage artifacts
       -> scripts/lib/run-lineage contract-bound Run state transitions
       -> scripts/lib/product-model user-owned product-intent canon contract
        -> scripts/lib/onboarding project-scoped bootstrap, candidate, review, and promotion state machine
             -> scripts/lib/onboarding-contract Session, storage, and state-pointer identity contract
             -> scripts/lib/onboarding-projection immutable onboarding artifact validation and graph input
       -> scripts/lib/compute-adapter backend-neutral compute and WorkerProtocol contract
       -> scripts/lib/world-model incremental repository view
            -> scripts/lib/semantic-graph evidence-linked semantic projection
            -> scripts/lib/temporal-provenance immutable revision DAG and bounded traversal
            -> scripts/lib/git-history replaceable Git evidence source
            -> scripts/lib/runtime-state replaceable runtime evidence source
            -> scripts/lib/world-model-store replaceable storage contract
```

Claude Code, Codex, and OpenCode are projections of the same `.head/` authority. They do not own separate project truth.

The source tree remains the directly runnable Core. CI creates independent,
content-verified `codex-marketplace` and `claude-marketplace` branches from the
same allowlisted distribution and overlays one five-platform, version- and
commit-bound native bundle assembled from the verified build matrix. Runtime
selection is exact-host and integrity-gated; the other targets remain inert
distribution bytes. Claude's generated branch adds only the catalog, plugin
manifest, and `${CLAUDE_PLUGIN_ROOT}` MCP cache-path projection required by
Claude Code. Distribution metadata, native binaries, and cache paths cannot
alter Core identity, Product Canon, Session/Run recovery, or any authority plane. See
[`codex-marketplace.md`](codex-marketplace.md) and
[`claude-marketplace.md`](claude-marketplace.md).

## Constitutional core and optional profiles

The stable normative root is the small provider-neutral HEAD constitution in
[`head-constitution.md`](head-constitution.md). P1-P5 is its executable internal
type system, not a mandatory user ceremony. The public initialize/resume
transaction exposes two profiles without creating separate project identities:

- `core` is the default and establishes only the canonical Project, current
  Session, managed runtime projections, and dormant optional-state pointers;
- `product` explicitly activates or resumes evidence-linked onboarding and the
  Product/World/Graph governance path.

Both profiles use the same Core transaction, Project identity, Session identity,
managed-install convergence, and authority contracts. Core resume never deletes
or silently refreshes an already active Product profile. Onboarding input is
rejected unless `product` is selected explicitly. Provider adapters may expose
different optional capabilities, but no adapter may redefine these semantics.

`profile` is therefore an operation choice, not persisted project mode. The
read-only `HeadProjectExperienceProjection` reports Core readiness and Product
readiness independently, chooses one actionable next step, and discloses the
preconditions for Context compilation, durable Runs, bounded workers,
compaction recovery, and provider invocation. It is bounded, non-persisted, and
authority-free: inspection cannot activate a capability, repair a managed file,
create a Run or ReviewDecision, consume a lease, or write recovery direction.
CLI `status`/`doctor` and MCP `head_project_status` return the same projection.
The verified onboarding status remains embedded so friendly guidance never
replaces the canonical state machine.

The same projection exposes `readiness.recovery` as factual, read-only guidance.
`no-current-checkpoint` keeps ordinary Session work available,
`verified-current-checkpoint` means artifact-only restore succeeded, and
`attention-required` discloses that only the affected recovery path needs
repair. Reading this field cannot consume compaction continuation, attach a
provider, or write P2 direction.

Conversation entry composes that same verification through read-only
`head_conversation_enter` and returns bounded project-status, unified Attention,
package-version, and presentation projections in the same call. These P4-style
views add no stored queue or gate: `userDecisionRequired` is reserved for a
protected user decision, `headActionRequired` assigns internal follow-up to
HEAD, and each item lists the affected operation while ordinary work remains
available by default. Pending optional Product work is marked
`when-product-governance-is-in-scope`; its existence alone cannot turn entry
into an immediate user decision. A separate optional P5
`CompactionLifecycleHostAdapter` can deliver journaled pre/post-compaction and
provider-replacement events, retain the raw continuation token outside project
Canon, and report only a bounded provider outcome. Core restores P2 before any
verify or continuation action. The adapter cannot carry provider-session
identity or author recovery, instruction, review, promotion, or Product Canon;
its absence is a non-blocking capability gap, not a project-readiness failure.

## Onboarding authority plane

Initialization creates a project-scoped HEAD Session record and a dormant
onboarding pointer independently from provider conversations. Only the explicit
`product` profile indexes the local World Model. A structured user brief may
directly seed candidates; otherwise a fresh provider HEAD authors a bounded
semantic proposal from current evidence. The JavaScript Core validates exact
SourceSnapshot, path, digest, line, optional symbol, Product Model references,
and bounds before presenting one immutable batch. Core performs no lexical
product inference, and the proposal has no instruction or promotion authority.

Only a CLI-supplied `ReviewDecision` with `decisionScope: product-canon-bootstrap` may create a Product Canon revision. Acceptance records previous and next Product Model hashes, rebuilds a child SourceSnapshot, and verifies the temporal GraphSnapshot before the state pointer becomes ready. Revision creates a successor candidate set; rejection leaves canon unchanged. Immutable candidate, Evidence, Unknown, ReviewDecision, and ProductModelRevision receipts are projected into the graph for audit, but the projection cannot decide or promote. Read-only MCP exposes verified state and bounded graph traversal but cannot review or promote.

Storage selection defaults to the complete local path. A GraphDB endpoint, database, and environment-style secret-reference names can be recorded as pending operational configuration, but credentials are rejected and no remote success is claimed before an adapter passes conformance. See [`onboarding.md`](onboarding.md).

## Why the old runtime is not embedded

The original implementation binds project authority to a live Herdr pane and OpenCode session, installs POSIX services, and uses Unix-oriented paths and process assumptions. Copying that runtime into a Codex plugin would falsely advertise cross-platform support and weaken its cleanup/fencing invariants.

The runtime layer defines explicit `PlatformAdapter`, `AgentRuntimeAdapter`, and `WorkspaceHostAdapter` boundaries. Claude Code, Codex, and OpenCode plus Windows, macOS, Linux, and the native-process host are represented by deterministic contract artifacts. A current-host machine-discovery composition inspects absolute PATH entries and regular executable candidates without launching them, while bounded version and provider-specific help compositions prove non-session interfaces. `RuntimeProjectBinding` connects those observations to canonical HEAD project and Session identities. One immutable `ExecutionAuthorization` supports a lightweight idle-Session scope and a full contract-bound Run scope while sharing project/caller fences, bounded resources, pre-start single-use consumption, event normalization, cancellation, and cleanup. Session scope binds a user-request digest and optional Capsule without requiring WholePlan or Fresh HEAD review; Run scope still requires the exact Run, ExecutionContract, WholePlan, and Capsule. Durable consumption/release receipts remain in project lineage, while PID/token/owner-lock, supervisor control files, result-schema state, role bindings, and live endpoint targets are confined to a dedicated host-local operational root outside the project. Provider-neutral invocation-record and Run-result-application cores validate authorization/runtime/scope lineage and create canonical ResultPacket evidence without provider-specific identity; only launch arguments and event extraction remain in provider adapters. Windows Job Objects and POSIX process groups provide OS-enforced provider-descendant ownership without transferring authority to the native helper. All three runtimes share deterministic Session/Run and provider-specific protocol-fixture coverage through this supervised core; Codex and OpenCode additionally retain completed live model-call evidence, while Claude Code live model-call conformance remains an explicit opt-in gate. OpenCode provider configuration remains owned by the user's global OpenCode settings and authentication; Claude Code authentication and model routing likewise remain provider-owned. HEAD adds no provider preset. Exact-endpoint WorkspaceHost role delivery and P2-first optional live HEAD attachment are active behind host-issued binding and fresh-snapshot fences; the production host-export reference uses project-external content-addressed snapshots, binding-scoped per-process proofs, and create-only filesystem delivery/claim/ack records. Actual already-running Codex/OpenCode tool consumption is verified; Claude Code host round-trip evidence is not claimed until that separate live gate runs. Host-specific executable/socket/CLI/pane translation, general provider resume/stream, and broader runtime controls remain deferred to separately owned adapters. See [`runtime-adapters.md`](runtime-adapters.md).

## File ownership

`.head/` is plugin-managed canon. Root `CLAUDE.md`, `.mcp.json`, `AGENTS.md`, and `opencode.json` are created only when the corresponding runtime projection has no collision. Existing files remain project-owned; generated alternatives are written under `.head/generated/` and reported as manual integration work.

The managed manifest records SHA-256 digests. Canonical mutation stops when managed drift is detected.

## Context Compiler plane

The Context Compiler sits between canonical project knowledge and HEAD execution. It compiles a bounded, reproducible `ContextCapsule`; it does not become a second authority.

The `ContextWorkflowProjection` is a thin P4-style advisory view over one
non-persisted preview. It connects verified World availability, HEAD-authored
EvidenceNeeds, Compiler inclusion proof, fixed budget-tier options, and the next
HEAD decision without changing any underlying artifact. It may repeat the same
non-persisted compile at the next fixed tier only for a proven `context-budget`
exclusion, recording every Capsule identity and proof. It never executes an
external or mutating operation and never promotes coverage into semantic
acceptance.

The same workflow includes a non-persisted `ContextExplanationCard` that groups
included evidence by kind, summarizes intentional omissions by the Compiler's
existing reason codes, and states remaining uncertainty. It explains an
existing Capsule result; it neither adds an EvidenceNeed nor changes selection,
budget, semantic-sufficiency ownership, or authority.

The preceding `ContextPreparationProjection` is also non-persisted P4. It takes
only the user's task text and exposes the current Project/World/Graph binding,
a bounded lexical discovery baseline, and exact node identities for provider
HEAD inspection. It does not author EvidenceNeeds, choose an anchor, call a
provider, or interpret lexical absence as irrelevance. HEAD authors the
structured proposal inside the conversation and submits it to the unchanged
preview verifier. A provider replacement may recreate this projection, but it
cannot write P2 recovery direction; stale World or Graph binding fails closed.

```text
Canonical sources -> Snapshot -> HEAD EvidenceNeeds -> verified packing/budget -> ContextCapsule -> HEAD/Executor
       ^                                                        |
       |             verified candidate knowledge               |
       +--------------------------------------------------------+
```

The world model and capsules are materialized views. They must be rebuildable from evidence and project canon. `Snapshot`, `Evidence`, `Claim`, `Decision`, `Unknown`, and `ContextCapsule` are the semantic boundary; storage technology remains replaceable.

Compiler unavailability is an adapter-level fail-open condition. Identity drift, canon drift, invalid knowledge, or Capsule digest mismatch is a core fail-closed condition.

## Execution Lineage plane

Execution Lineage turns a Capsule into an auditable whole-plan loop without relying on a provider conversation as authority.

```text
WholePlanSnapshot
  -> ExecutionContract + ContextCapsule
  -> Executor
  -> ResultPacket
  -> ReviewDecision
  -> accepted result or refined WholePlanSnapshot
```

Each artifact has a content-derived identifier, digest verification, and typed `LineageLink` parents. `ResultPacket` evidence is explicitly non-instructional. A Fresh HEAD reconstructs review context from these verified artifacts rather than resuming a hidden model session.

Artifact-only Session restore now reconstructs the current consumer input from
the exact content-addressed `SessionRunCheckpoint`, immutable Session pointer,
and verified Run/plan/contract/Capsule lineage. The returned
`SessionRestoreProjection` is non-persisted P4 and does not use provider session
identity, transcript, summary, resume, or stream. After an accepted Fresh HEAD
ReviewDecision, a separate one-shot operation may bind the reviewed Run to a P2
checkpoint whose recovery fields are explicit HEAD/user input; ResultPacket and
the P3 integration receipt cannot author or replace that direction. See
[`session-recovery.md`](session-recovery.md).

Provider-neutral launch-wave visibility is a separate P3/P4/P5 composition over
existing HF-009 dispatches. A `BoundedWorkerWave` cannot create or widen an
authorization; an explicit seal requires every independent lease consumption;
status/results remain P4 views and wait remains P5. Each result still crosses
Fresh HEAD review and explicit HF-010 checkpoint integration independently. See
[`bounded-worker-wave.md`](bounded-worker-wave.md).

Version 0.3 alpha binds Runs to verified contracts, converts completion into a ResultPacket, builds a deterministic minimum Fresh HEAD review projection, and requires that exact projection for the manual HEAD ReviewDecision. `revise` and `expand` require a ReviewDecision-linked next WholePlanSnapshot before another Run. Candidate knowledge and HEAD recommendations remain authority-free. Exact optional WorkspaceHost attachment is active only after P2 restore; general provider resume/stream, broader runtime controls, and authorized knowledge-promotion surfaces remain deferred.

## Repository World Model plane

The World Model materializes supported repository files, heuristic symbols, dependencies, imports, and resolvable calls as content-addressed evidence. An optional provider-neutral `SourceRelationEvidenceAdapter` may add language-AST `IMPORTS` and `CALLS` evidence bound to the exact current file manifest; Core preserves its analyzer, source, and confidence separately instead of replacing the heuristic fallback. Hot is the current snapshot, Warm is the pointer's change summary, and Cold is the retained prior snapshot set.

`WorldModelStoreAdapter` separates World Model persistence from semantic snapshot identity. The snapshot contains only the invariant rebuildable-storage contract; the pointer records the active adapter descriptor. The local JSON adapter is active, and an in-memory conformance test proves that the same canonical inputs produce the same World Model ID through a different adapter.

`IncrementalRefreshRequest` and `IncrementalRefreshReceipt` establish observed-state refresh after explicit indexing. Refresh rediscovers and byte-hashes every eligible file, reuses verified analysis only for digest-identical files, and must produce the same `RepositoryScanResult` as the full reference path. An actual change automatically makes the verified current SourceSnapshot a parent, preserves unchanged revision identities, parents changed revisions to their previous current revision, validates graph materialization, and advances the World Model pointer only after the preview identity is fixed. Active Runs retain their exact Capsule and contract; the receipt records drift and the required explicit HEAD choice. Product Canon and reviewed relationships are not mutated. See [`incremental-refresh.md`](incremental-refresh.md).

`RefreshTriggerBatch` and `RefreshTriggerDeliveryReceipt` add the next ingestion layer. A foreground recursive filesystem watcher and a strict CI event-file adapter feed one bounded debounce queue. Paths remain non-authoritative hints: every delivery invokes the same complete refresh scan. Accepted events are canonically sorted, duplicates and excluded/overflow observations are counted, `.head` events do not self-trigger, and a project-scoped exclusive writer lease serializes manual, filesystem, and CI refreshes before the existing pointer comparison. Trigger artifacts have no instruction, promotion, or canon-mutation authority. See [`refresh-trigger.md`](refresh-trigger.md).

`GraphProjectionAdapter` is the separate graph materialization and traversal boundary. The embedded temporal GraphSnapshot remains the recoverable source; local JSON, in-memory, and explicitly activated ArcadeDB adapters preserve identical GraphSnapshot and TraversalResult identities, reject authority escalation and stale/tampered projections, and disclose embedded-graph fallback when no materialization exists. `PreparedTraversalRequest` binds an already-fixed query and result to exact bounded expansion evidence. ArcadeDB can verify that radius from a pointer and topology manifest without full query-time reload. Topology-manifest and bounded-traversal reads share one query-only exact-child batch after independent pointer inspection. The JavaScript bridge is the reference transport; an integrity-verified Go bridge is selected from the native distribution when present, while all semantic and authority verification remains in JavaScript. ArcadeDB vertices, edges, transport output, and receipts remain derived evidence and cannot own unique authority. See [`graph-projection-adapter.md`](graph-projection-adapter.md).

Prepared-traversal performance evidence keeps two planes separate. Canonical UTF-8 payload-component sizes form reproducible, content-derived cost evidence; elapsed time, cache state, transport calls, and normalized observed response sizes are operational diagnostics only. The live benchmark can use only an already verified activation and exposes no mutation method, so measuring GraphDB cannot advance pointers, create schemas, or alter authority.

`DocumentProjectionAdapter` is the separate human-view boundary after the verified graph. The deterministic Markdown reference renderer emits content-derived `DocumentProjection` artifacts and a replaceable published view under `.head/generated/knowledge`; local and in-memory adapters must preserve identical document content and projection identity. Explicit generation remains available. A separate safe-default-manual `PostRefreshProjectionPolicy` may enable automatic publication only for an unedited view after verified refresh, while immutable receipts bind policy, refresh, graph, projection, and candidate evidence. Published drift is never overwritten: current edits become an immutable `DocumentChangeCandidateSet` with no canon, instruction, or promotion authority. A scoped explicit review may accept candidates only with a complete user-supplied Product Model, rebuild a verified child GraphSnapshot, and reconcile Markdown, or reject them without canon mutation. Candidate sets, reviews, Product Model revisions, and application receipts are projected into later audit GraphSnapshots without acquiring authority; Obsidian and Notion remain deferred. See [`document-projection-adapter.md`](document-projection-adapter.md), [`document-change-review.md`](document-change-review.md), and [`post-refresh-projection.md`](post-refresh-projection.md).

The semantic graph uses content-derived node and edge identities, file digest and line evidence, explicit source/confidence labels, and `evidence-not-instruction` trust boundaries. Default coverage remains heuristic file containment, module imports, and resolvable JavaScript/TypeScript/Python calls. Optional AST relations are accepted only through a strict current-manifest adapter contract and remain P4 structural evidence without semantic, instruction, promotion, review, or recovery authority.

The Product Model source at `.head/context/product-model.json` is user-owned canon. It defines stable FeatureGroup, Capability, Feature, Requirement, Constraint, and Decision keys independently from repository directories. A missing Product Model in an older initialized project is the explicit empty semantic model; code and documents do not silently fill it. See [`product-model.md`](product-model.md).

The temporal provenance graph is a separate verified projection so structural evidence identities are not silently redefined. Its traversal protocol has mutually exclusive `lexical-discovery` and exact-HEAD-anchor modes. Exact mode binds current GraphSnapshot plus one to 32 node IDs and cannot widen relation, authority, freshness, confidence, depth, node, edge, or candidate policy. Context Compiler accepts exact anchors only inside HEAD-owned EvidenceNeeds and emits separate `GraphTraversalEvidence`; it never promotes lexical search into semantic relevance. Product nodes and product relations remain `canon-projected`, candidate-space nodes remain hidden without explicit opt-in, and local or activated ArcadeDB projections preserve the embedded GraphSnapshot as the recoverable source.

Graph genealogy reuses retained content-addressed World snapshots instead of creating a second history store. `GraphLineageStatusProjection`, `GraphLineageTraceProjection`, and `GraphLineageDiffProjection` are non-persisted P4 views: they expose bounded Hot/Warm/Cold pages, exact or discovery traces, verified execution-artifact references, and snapshot differences. They cannot write P2 recovery direction or infer semantic continuity. Equal content digests across removed and added paths produce only `exact-content-possible-move` evidence; a semantic identity claim remains a separate HEAD proposal and needs review only if it is promoted.

The provider-neutral common Observation boundary records domain-shaped data without teaching Core product vocabulary. `ObservationTypeDescriptor`, `ObservationRecord`, `DerivedObservationRecord`, and `ObservationCollectionReceipt` are P3; `ObservationStatusProjection` is a separate rebuildable P4 evidence graph and its verified nodes and relations are also projected into the unified temporal GraphSnapshot; `ObservationSourceBinding` is P5 Host configuration. A process-local `ObservationAdapterRegistry` binds optional source-specific adapters to one exact ready Project without persisting their paths, credentials, cursors, or provider identities. Its non-persisted discovery view provides exact filters, opaque pagination with disclosed read-only resynchronization, bounded descriptor shape, and Host-local availability hints without imposing a registration gate. `ObservationPreparationProjection` combines exact existing-evidence query and matching source discovery for reuse-first UX but never chooses meaning, sufficiency, a source, or collection. A Host-injected MCP composition collects only by opaque Project-bound source ID. `JsonEventFileObservationAdapter` provides a bounded one-shot CI reference without adding an MCP file-path surface. Automatic graph relations are limited to `CONFORMS_TO`, `EVIDENCED_BY`, and `DERIVED_FROM`. Context Compiler includes an observation only through an exact HEAD-owned EvidenceNeed; observation collection cannot create Product Canon, product meaning, a ReviewDecision, or P2 recovery direction. Invalid Observation lineage makes only that graph layer unavailable; unrelated World/Product work remains usable. See [`observation-adapters.md`](observation-adapters.md).

Non-blocking Conformance reconciliation lets provider HEAD compare exact approved Canon with current source, ChangeSet, Observation, or optional Graph evidence. Core validates anchors and persists only P3 candidates, resolution candidates, and exact-Finding user dispositions; it performs no lexical or semantic verdict. Its paginated P4 queue and candidate-hidden audit graph cannot block ordinary work, authorize a fix, revise Canon, or write recovery. Missing Graph, partial coverage, optional adapter loss, and advisory risk remain disclosures. A process-local optional P5 trigger registry coalesces verified Host evidence and stops automatic replay after an uncertain provider outcome; default opportunistic use invokes no background provider. See [`conformance-reconciliation.md`](conformance-reconciliation.md).

`DeploymentResultAdapter` is a separate Host observation boundary. It supplies bounded deployment facts and evidence digests without persisting provider run/session/process identities. Core independently verifies reachable Git history and current product refs before recording create-only `BranchStateObservation`, `DeploymentResultObservation`, and eligible `ReleaseObservation` P3 evidence. Their P4 graph projection cannot authorize deployment, approve a product outcome, mutate Product Canon, or write P2 recovery direction. See [`release-observation.md`](release-observation.md).

## Native compute plane

`ComputeAdapter` contract `0.3.0` and WorkerProtocol `0.2.0` define a replaceable computation boundary without changing semantic identities or transferring authority from the JavaScript control plane. Canonical requests bind a versioned operation, input digest, semantic producer, and resource limits. Canonical responses are all-or-nothing, digest-verified, size-bounded, structured, and fixed to `authorityEffect: none`.

`JsReferenceComputeAdapter` remains the conformance oracle and local fallback. `GoWorkerComputeAdapter` verifies a content-addressed platform manifest, confines the executable to the plugin distribution root, launches it directly without a shell, bounds stdio and time, and verifies exact child-PID exit. Missing, incompatible, corrupt, unsupported, spawn-failed, or crashed native paths fall back to JavaScript with disclosed operational reason codes; invalid native responses, timeouts, and cancellation fail closed. A Go `repository.scan.v1` candidate now matches seven complete success/failure responses and identical corpus identities, including multilingual and Unicode evidence plus explicit include/exclude source scope. Comparative benchmarks regress on small and medium inputs and improve only marginally on a large input, so release manifests still advertise only `worker.health.v1`; production World Model scans remain on JavaScript. Compute-backed graph operations and a benchmark-justified native selection policy remain deferred. See [`compute-adapter.md`](compute-adapter.md).

`GitHistoryAdapter` separately supplies rebuildable, content-addressed commit evidence. The default asynchronous Git CLI adapter may fail open with explicit coverage when process launch is unavailable; a byte-preserving host-export adapter provides the same semantic input in constrained runtimes. Current refs validate reachability, and commit messages remain evidence rather than instructions or promoted decisions.

`RuntimeStateAdapter` supplies strict point-in-time external runtime observations. Its source descriptor is pointer metadata rather than semantic identity; normalized observations are content-addressed and freshness-gated. The adapter is read-only and grants neither instruction nor runtime control authority. Separate `PlatformAdapter`, `AgentRuntimeAdapter`, and `WorkspaceHostAdapter` references make provider/platform/host composition explicit. Current-host discovery, bounded fixed version/help evidence, and `RuntimeProjectBinding` establish capability without authorization. The invocation-authorization layer then derives a non-executing single-call boundary from the exact active HEAD lineage; a durable at-most-once lease consumes it before the supervisor starts and keeps it non-replayable after completion, timeout, cancellation, or caller failure. Event/receipt/draft schemas, native Job Object/process-group fixtures, and live Codex/OpenCode Session/Run evidence prove the control-plane and tree-cleanup shape. Host-derived exact-endpoint role messaging is a separate non-authoritative operational capability whose target chain and delivery receipts never become recovery canon. P2-first exact optional attachment and exact-owned one-shot interrupt/close are active. Provider hydration, general resume/stream, and broader process control remain deferred. AST-accurate graphs and structured Git decision inference also remain deferred. See [`runtime-state.md`](runtime-state.md) and [`runtime-adapters.md`](runtime-adapters.md).
