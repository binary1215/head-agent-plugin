# Architecture decision

## Adopted shape

The plugin is organized as a thin Codex distribution around a provider-neutral core:

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

Codex and OpenCode are projections of the same `.head/` authority. They do not own separate project truth.

## Onboarding authority plane

Initialization creates a project-scoped HEAD Session record and an explicit onboarding pointer independently from provider conversations. Onboarding indexes the local World Model, derives bounded evidence-linked candidates from an existing project or structured brief, and presents one immutable batch. Candidate inference stays in the JavaScript control plane and has no instruction or promotion authority.

Only a CLI-supplied `ReviewDecision` with `decisionScope: product-canon-bootstrap` may create a Product Canon revision. Acceptance records previous and next Product Model hashes, rebuilds a child SourceSnapshot, and verifies the temporal GraphSnapshot before the state pointer becomes ready. Revision creates a successor candidate set; rejection leaves canon unchanged. Immutable candidate, Evidence, Unknown, ReviewDecision, and ProductModelRevision receipts are projected into the graph for audit, but the projection cannot decide or promote. Read-only MCP exposes verified state and bounded graph traversal but cannot review or promote.

Storage selection defaults to the complete local path. A GraphDB endpoint, database, and environment-style secret-reference names can be recorded as pending operational configuration, but credentials are rejected and no remote success is claimed before an adapter passes conformance. See [`onboarding.md`](onboarding.md).

## Why the old runtime is not embedded

The original implementation binds project authority to a live Herdr pane and OpenCode session, installs POSIX services, and uses Unix-oriented paths and process assumptions. Copying that runtime into a Codex plugin would falsely advertise cross-platform support and weaken its cleanup/fencing invariants.

The runtime layer defines explicit `PlatformAdapter`, `AgentRuntimeAdapter`, and `WorkspaceHostAdapter` boundaries. Codex and OpenCode plus Windows, macOS, Linux, and the native-process host are represented by deterministic contract artifacts. A current-host machine-discovery composition inspects absolute PATH entries and regular executable candidates without launching them, while bounded version and provider-specific help compositions prove non-session interfaces. `RuntimeProjectBinding` connects those observations to canonical HEAD project and Session identities. One immutable `ExecutionAuthorization` supports a lightweight idle-Session scope and a full contract-bound Run scope while sharing project/caller fences, bounded resources, pre-start single-use consumption, event normalization, cancellation, and cleanup. Session scope binds a user-request digest and optional Capsule without requiring WholePlan or Fresh HEAD review; Run scope still requires the exact Run, ExecutionContract, WholePlan, and Capsule. Durable consumption/release receipts remain in project lineage, while PID/token/owner-lock, supervisor control files, result-schema state, role bindings, and live endpoint targets are confined to a dedicated host-local operational root outside the project. Provider-neutral invocation-record and Run-result-application cores validate authorization/runtime/scope lineage and create canonical ResultPacket evidence without provider-specific identity; only launch arguments and event extraction remain in provider adapters. Windows Job Objects and POSIX process groups provide OS-enforced provider-descendant ownership without transferring authority to the native helper. Codex and OpenCode live Session/Run paths pass through this supervised core, including canonical ResultPacket application and Fresh HEAD review. OpenCode provider configuration remains owned by the user's global OpenCode settings and authentication; HEAD adds no provider preset. Exact-endpoint WorkspaceHost role delivery is active behind host-issued binding and fresh-snapshot fences; the production host-export reference uses project-external content-addressed snapshots and create-only filesystem delivery/ack records. Host-specific executable/socket/CLI/pane translation, actual provider-client wake/tool consumption, provider resume, provider-session attachment, and general runtime controls remain deferred to separately owned adapters. See [`runtime-adapters.md`](runtime-adapters.md).

## File ownership

`.head/` is plugin-managed canon. Root `AGENTS.md` and `opencode.json` are created only when absent. Existing files remain project-owned; their generated alternatives are written under `.head/generated/` and reported as manual integration work.

The managed manifest records SHA-256 digests. Canonical mutation stops when managed drift is detected.

## Context Compiler plane

The Context Compiler sits between canonical project knowledge and HEAD execution. It compiles a bounded, reproducible `ContextCapsule`; it does not become a second authority.

```text
Canonical sources -> Snapshot -> ranking/budget -> ContextCapsule -> HEAD/Executor
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

Version 0.3 alpha binds Runs to verified contracts, converts completion into a ResultPacket, builds a deterministic minimum Fresh HEAD review projection, and requires that exact projection for the manual HEAD ReviewDecision. `revise` and `expand` require a ReviewDecision-linked next WholePlanSnapshot before another Run. Candidate knowledge and HEAD recommendations remain authority-free. Provider-session attachment, general runtime controls, and broader authorized knowledge-promotion surfaces remain deferred.

## Repository World Model plane

The World Model materializes supported repository files, heuristic symbols, dependencies, imports, and resolvable calls as content-addressed evidence. Hot is the current snapshot, Warm is the pointer's change summary, and Cold is the retained prior snapshot set. File-level freshness is recomputed against the working tree before the Context Compiler consumes candidates or graph queries.

`WorldModelStoreAdapter` separates World Model persistence from semantic snapshot identity. The snapshot contains only the invariant rebuildable-storage contract; the pointer records the active adapter descriptor. The local JSON adapter is active, and an in-memory conformance test proves that the same canonical inputs produce the same World Model ID through a different adapter.

`IncrementalRefreshRequest` and `IncrementalRefreshReceipt` establish observed-state refresh after explicit indexing. Refresh rediscovers and byte-hashes every eligible file, reuses verified analysis only for digest-identical files, and must produce the same `RepositoryScanResult` as the full reference path. An actual change automatically makes the verified current SourceSnapshot a parent, preserves unchanged revision identities, parents changed revisions to their previous current revision, validates graph materialization, and advances the World Model pointer only after the preview identity is fixed. Active Runs retain their exact Capsule and contract; the receipt records drift and the required explicit HEAD choice. Product Canon and reviewed relationships are not mutated. See [`incremental-refresh.md`](incremental-refresh.md).

`RefreshTriggerBatch` and `RefreshTriggerDeliveryReceipt` add the next ingestion layer. A foreground recursive filesystem watcher and a strict CI event-file adapter feed one bounded debounce queue. Paths remain non-authoritative hints: every delivery invokes the same complete refresh scan. Accepted events are canonically sorted, duplicates and excluded/overflow observations are counted, `.head` events do not self-trigger, and a project-scoped exclusive writer lease serializes manual, filesystem, and CI refreshes before the existing pointer comparison. Trigger artifacts have no instruction, promotion, or canon-mutation authority. See [`refresh-trigger.md`](refresh-trigger.md).

`GraphProjectionAdapter` is the separate graph materialization and traversal boundary. The embedded temporal GraphSnapshot remains the recoverable source; local JSON, in-memory, and explicitly activated ArcadeDB adapters preserve identical GraphSnapshot and TraversalResult identities, reject authority escalation and stale/tampered projections, and disclose embedded-graph fallback when no materialization exists. `PreparedTraversalRequest` binds an already-fixed query and result to exact bounded expansion evidence. ArcadeDB can verify that radius from a pointer and topology manifest without full query-time reload, but its vertices, edges, and receipt remain derived evidence and cannot own unique authority. See [`graph-projection-adapter.md`](graph-projection-adapter.md).

Prepared-traversal performance evidence keeps two planes separate. Canonical UTF-8 payload-component sizes form reproducible, content-derived cost evidence; elapsed time, cache state, transport calls, and normalized observed response sizes are operational diagnostics only. The live benchmark can use only an already verified activation and exposes no mutation method, so measuring GraphDB cannot advance pointers, create schemas, or alter authority.

`DocumentProjectionAdapter` is the separate human-view boundary after the verified graph. The deterministic Markdown reference renderer emits content-derived `DocumentProjection` artifacts and a replaceable published view under `.head/generated/knowledge`; local and in-memory adapters must preserve identical document content and projection identity. Explicit generation remains available. A separate safe-default-manual `PostRefreshProjectionPolicy` may enable automatic publication only for an unedited view after verified refresh, while immutable receipts bind policy, refresh, graph, projection, and candidate evidence. Published drift is never overwritten: current edits become an immutable `DocumentChangeCandidateSet` with no canon, instruction, or promotion authority. A scoped explicit review may accept candidates only with a complete user-supplied Product Model, rebuild a verified child GraphSnapshot, and reconcile Markdown, or reject them without canon mutation. Candidate sets, reviews, Product Model revisions, and application receipts are projected into later audit GraphSnapshots without acquiring authority; Obsidian and Notion remain deferred. See [`document-projection-adapter.md`](document-projection-adapter.md), [`document-change-review.md`](document-change-review.md), and [`post-refresh-projection.md`](post-refresh-projection.md).

The semantic graph uses content-derived node and edge identities, file digest and line evidence, explicit heuristic confidence, and `evidence-not-instruction` trust boundaries. It currently covers file containment, module imports, and resolvable JavaScript/TypeScript/Python calls.

The Product Model source at `.head/context/product-model.json` is user-owned canon. It defines stable FeatureGroup, Capability, Feature, Requirement, Constraint, and Decision keys independently from repository directories. A missing Product Model in an older initialized project is the explicit empty semantic model; code and documents do not silently fill it. See [`product-model.md`](product-model.md).

The temporal provenance graph is a separate verified projection so existing heuristic semantic identities are not silently redefined. It separates stable Repository/File/Symbol/Test and product logical identities from immutable revisions, supports explicit zero-or-more SourceSnapshot, Revision, and ChangeSet parents, and validates provenance-complete typed edges. Product nodes and product relations are `canon-projected`; onboarding, Feature-mapping, ChangeSet, Change-impact, and document-review artifacts preserve review trails without becoming canon. Candidate-space nodes are excluded from normal traversal unless explicitly requested, while reviewed receipts and current reviewed `IMPLEMENTS`, `VERIFIED_BY`, and `IMPACTS` edges remain queryable. ChangeSets bind exact before/after source evidence to accepted ResultPacket/ReviewDecision lineage without requiring Git. Optional immutable VCS evidence embeds commit observations selected from verified Git history and projects `MATERIALIZED_AS` / `REFERENCES`; it never changes ChangeSet identity and remains reconstructable after live Git disappears. The graph remains derived and cannot mutate canon or promote candidates without the scoped ReviewDecision command. Its bounded `TraversalQuery` fixes relation, kind, authority, freshness, confidence, depth, node, edge, candidate inclusion, and ordering policy and returns graph/query/result digests. Local and activated ArcadeDB projections preserve the embedded GraphSnapshot as the recoverable source. Inferred commit matching, general authorized promotion beyond active scopes, conformance, automatic merge, compare-and-swap remote publication, and Obsidian/Notion projections remain deferred.

## Native compute plane

`ComputeAdapter` contract `0.3.0` and WorkerProtocol `0.2.0` define a replaceable computation boundary without changing semantic identities or transferring authority from the JavaScript control plane. Canonical requests bind a versioned operation, input digest, semantic producer, and resource limits. Canonical responses are all-or-nothing, digest-verified, size-bounded, structured, and fixed to `authorityEffect: none`.

`JsReferenceComputeAdapter` remains the conformance oracle and local fallback. `GoWorkerComputeAdapter` verifies a content-addressed platform manifest, confines the executable to the plugin distribution root, launches it directly without a shell, bounds stdio and time, and verifies exact child-PID exit. Missing, incompatible, corrupt, unsupported, spawn-failed, or crashed native paths fall back to JavaScript with disclosed operational reason codes; invalid native responses, timeouts, and cancellation fail closed. A Go `repository.scan.v1` candidate now matches seven complete success/failure responses and identical corpus identities, including multilingual and Unicode evidence plus explicit include/exclude source scope. Comparative benchmarks regress on small and medium inputs and improve only marginally on a large input, so release manifests still advertise only `worker.health.v1`; production World Model scans remain on JavaScript. Compute-backed graph operations and a benchmark-justified native selection policy remain deferred. See [`compute-adapter.md`](compute-adapter.md).

`GitHistoryAdapter` separately supplies rebuildable, content-addressed commit evidence. The default asynchronous Git CLI adapter may fail open with explicit coverage when process launch is unavailable; a byte-preserving host-export adapter provides the same semantic input in constrained runtimes. Current refs validate reachability, and commit messages remain evidence rather than instructions or promoted decisions.

`RuntimeStateAdapter` supplies strict point-in-time external runtime observations. Its source descriptor is pointer metadata rather than semantic identity; normalized observations are content-addressed and freshness-gated. The adapter is read-only and grants neither instruction nor runtime control authority. Separate `PlatformAdapter`, `AgentRuntimeAdapter`, and `WorkspaceHostAdapter` references make provider/platform/host composition explicit. Current-host discovery, bounded fixed version/help evidence, and `RuntimeProjectBinding` establish capability without authorization. The invocation-authorization layer then derives a non-executing single-call boundary from the exact active HEAD lineage; a durable at-most-once lease consumes it before the supervisor starts and keeps it non-replayable after completion, timeout, cancellation, or caller failure. Event/receipt/draft schemas, native Job Object/process-group fixtures, and live Codex/OpenCode Session/Run evidence prove the control-plane and tree-cleanup shape. Host-derived exact-endpoint role messaging is a separate non-authoritative operational capability whose target chain and delivery receipts never become recovery canon. Provider-session attachment or hydration and resume/stream/interrupt/close remain deferred. AST-accurate graphs and structured Git decision inference also remain deferred. See [`runtime-state.md`](runtime-state.md) and [`runtime-adapters.md`](runtime-adapters.md).
