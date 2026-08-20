# Repository World Model semantic alpha

Read [`ULTIMATE_GOAL.md`](ULTIMATE_GOAL.md) before changing this plane.

## Authority and storage contract

The Repository World Model is a rebuildable materialized view. It is evidence for the Context Compiler, not project canon and not instruction authority.

Version 0.2 separates the content-addressed semantic snapshot from physical storage through `WorldModelStoreAdapter` version `0.1.0`. Every adapter must declare:

- `authority: derived-evidence-only`;
- `rebuildable: true`;
- `uniqueAuthority: false`;
- version-compatible pointer, immutable snapshot, and listing operations.

The interface methods are `describe`, `readPointer`, `readSnapshot`, `writePointer`, `writeSnapshot`, and `listSnapshotIds`. Core code performs semantic digest verification; adapters only persist and retrieve documents. This prevents a backend from weakening identity checks.

The active dependency-free local JSON adapter stores:

```text
.head/world-model/current.json                    Warm pointer and change summary
.head/world-model/snapshots/world-model-*.json   Hot current / Cold prior snapshots
```

`current.json` points to the Hot snapshot, records the physical adapter descriptor, and records added, changed, and removed paths as the Warm tier. Previous content-addressed snapshots form the Cold tier. The physical adapter descriptor is not part of the semantic snapshot hash, so the same canonical inputs produce the same World Model ID through a conforming local, memory, or future GraphDB adapter.

GraphDB is not required and no remote database is queried or mutated. Graph traversal now uses a separate `GraphProjectionAdapter`; the World Model store continues to preserve the complete recoverable snapshot independently of the graph backend. A separate `DocumentProjectionAdapter` explicitly renders the current verified GraphSnapshot as deterministic Markdown without placing document adapter or filesystem identity in the World Model. See [`graph-projection-adapter.md`](graph-projection-adapter.md) and [`document-projection-adapter.md`](document-projection-adapter.md).

## Commands

```text
node scripts/head.mjs world-index <project>
node scripts/head.mjs source-scope-set <project> --input <source-scope.json>
node scripts/head.mjs source-scope-status <project>
node scripts/head.mjs world-index <project> --git-log <host-exported-log-file>
node scripts/head.mjs world-index <project> --runtime-state <host-exported-json-file>
node scripts/head.mjs world-index <project> --parent-snapshot <source-snapshot-id,source-snapshot-id>
node scripts/head.mjs world-index <project> --revision-parents <logical-entity-to-parent-revisions.json>
node scripts/head.mjs world-refresh <project>
node scripts/head.mjs world-refresh <project> --expect-changed <path,path>
node scripts/head.mjs world-refresh-status <project>
node scripts/head.mjs world-refresh-read <project> --receipt <incremental-refresh-receipt-id>
node scripts/head.mjs world-refresh-events <project> --input <refresh-events.json>
node scripts/head.mjs world-refresh-watch <project> --debounce-ms 350 --max-events 1024
node scripts/head.mjs world-refresh-trigger-status <project>
node scripts/head.mjs world-refresh-trigger-read <project> --delivery <refresh-trigger-delivery-id>
node scripts/head.mjs world-status <project>
node scripts/head.mjs world-graph-status <project>
node scripts/head.mjs world-docs-build <project>
node scripts/head.mjs world-docs-status <project>
node scripts/head.mjs world-docs-capture <project>
node scripts/head.mjs world-docs-candidates <project> --candidate-set <document-change-candidate-set-id>
node scripts/head.mjs world-docs-policy-set <project> --input <policy.json>
node scripts/head.mjs world-docs-policy-status <project>
node scripts/head.mjs world-docs-refresh-status <project>
node scripts/head.mjs world-docs-refresh-read <project> --receipt <post-refresh-projection-receipt-id>
node scripts/head.mjs world-query <project> --query <symbol-or-path> --depth 1 --limit 100
node scripts/head.mjs world-temporal <project> --query <path-or-symbol> --relations HAS_REVISION,CURRENT_REVISION,DECLARES --depth 2 --limit 100 --edge-limit 200
node scripts/head.mjs world-temporal <project> --query <candidate-id> --include-candidates true --depth 1 --limit 100 --edge-limit 200
node scripts/head.mjs world-history <project> --query <decision-terms> --limit 20
node scripts/head.mjs world-runtime <project> --runtime codex --state active --kind session --limit 20
node scripts/head.mjs change-set-status <project>
```

`world-index` invokes the validated `repository.scan.v1` operation and materializes a deterministic snapshot. Repeating it without repository changes returns the same World Model ID. The optional `.head/context/repository-source-scope.json` selection supplies normalized include/exclude roots, remains evidence-only, and participates in scan and World Model identity. `world-status` first performs complete eligible-file discovery and byte hashing. When path, digest, byte length, classification, language, and scope match the verified snapshot, it reuses stored semantic analysis and does not rebuild the temporal graph merely to prove freshness; a changed inventory falls back to the complete reference scan before reporting exact stale details.

`world-refresh` is the explicit incremental path after a verified base index. It still rediscovers and raw-byte-hashes every eligible file, but reuses symbol/dependency/semantic analysis for a file only when its path, digest, byte length, classification, language, and analysis protocol match the verified prior snapshot. The resulting `RepositoryScanResult` remains identical to a complete reference scan. No-change refresh keeps the current snapshot identity; a changed refresh automatically links the prior SourceSnapshot, reuses unchanged revision identities, parents changed revisions to their prior revisions, verifies graph materialization, and records immutable request/receipt evidence. An exact `--expect-changed` set fails before pointer advancement when observed paths differ. See [`incremental-refresh.md`](incremental-refresh.md).

`world-refresh-events` ingests one strict CI batch; `world-refresh-watch` is the only filesystem CLI adapter and runs recursively in the foreground until `SIGINT` or `SIGTERM`. Both use a bounded deterministic debounce/coalescing contract and a project-scoped exclusive writer lease. Event paths do not limit the scan and may disagree with the actual changed files; complete discovery and hashing remain authoritative for observed implementation. Read-only trigger status and delivery inspection verify the linked incremental request/receipt without starting a watcher. See [`refresh-trigger.md`](refresh-trigger.md).

Repository file changes, current Git refs, semantic HEAD lifecycle state, and indexer protocol versions all participate in the source digest. Volatile timestamps and physical store identity are excluded.

The read-only MCP tools `head_world_model` and `head_graph_projection_status` expose World Model and graph-projection verification. `head_incremental_refresh_status` and `head_incremental_refresh_receipt` expose refresh freshness, ancestry, changes, and active-execution drift without mutation authority. `head_refresh_trigger_status` and `head_refresh_trigger_delivery` verify event batches, serialized delivery, and linked refresh evidence but cannot ingest events or start a watcher. `head_post_refresh_projection_status` and `head_post_refresh_projection_receipt` verify the effective policy and exact document outcome without changing either. `head_world_query` returns a bounded zero-to-three-hop heuristic semantic neighborhood. `head_temporal_graph` returns a deterministic allowlisted temporal traversal with graph/query/result digests through the current projection adapter, or a disclosed embedded-graph fallback when no projection exists. `head_git_history` performs a bounded query over verified current Git evidence. `head_runtime_state` performs a bounded query over verified point-in-time runtime observations. All semantic queries reject a stale index.

## Temporal provenance graph

World Model version `0.11.0` includes repository scan protocol `0.3.0`, repository source-scope protocol `0.1.0`, source-analysis protocol `0.2.0`, semantic graph protocol `0.2.0`, onboarding projection protocol `0.1.0`, Feature mapping protocol `0.1.0`, ChangeSet protocol `0.1.0`, ChangeSet projection protocol `0.2.0`, document-change graph projection protocol `0.1.0`, Product Operating Loop protocol `0.2.0` with `0.1.0` artifact read compatibility, VCS evidence protocol `0.1.0`, GraphProjectionAdapter `0.1.0`, incremental refresh protocol `0.2.0`, refresh-trigger protocol `0.2.0`, and a separate `GraphSnapshot` built by temporal provenance protocol `0.8.0`. Legacy repository scan `0.2.0` snapshots remain digest-verifiable and become stale until rebuilt under the new indexer contract. The temporal graph adds immutable onboarding history, Feature/code/test mapping candidates, reviewed provider-neutral ChangeSets, exact revision deltas, review-gated Feature/Capability impact, optional ChangeSet-to-Git evidence, document review/application audit lineage, and epistemically typed product-operating evidence. Non-persisted product notes never enter the World Model. A v0.2 Initiative candidate may use inline reasoning and defer Feature resolution until its explicit review; the separate reviewed Initiative carries the exact resolution. Candidate surfaces remain hidden by default; only scoped explicit ReviewDecisions create reviewed receipts or canonical relations. Document review and application artifacts remain authoritative immutable records while their graph nodes are derived evidence only. Incremental refresh and trigger ingestion change no snapshot schema; batching, timing, writer ownership, reuse, and adapter diagnostics stay outside World Model and GraphSnapshot semantic identity. Legacy refresh `0.1.0` artifacts remain readable.

The repository scan is the first built-in `ComputeAdapter` operation. Its semantic output contains only normalized relative paths and deterministic source facts. The scan root is operational input and is excluded from the repository-scan result; backend identity, execution mode, timing, and process details remain pointer diagnostics outside World Model identity. A Go implementation now produces byte-equivalent complete responses on the tracked corpus and limit/error fixtures, but release manifests intentionally do not advertise it because measured small and medium scans regress and the large-input gain is marginal. The default adapter therefore probes the verified distribution, discloses `GO_WORKER_OPERATION_NOT_INSTALLED`, and runs the JavaScript reference. The World Model continues to record its separately validated canonical project root.

The temporal graph never reads live Git state. A project without `.git` constructs and queries the same required temporal identities from the same project ID, source scan, explicit parent sets, and producer version. When an operator explicitly attaches commits already present in verified Git history, the graph consumes only the resulting immutable `VcsEvidence` artifact and embedded commit observations. The same optional evidence plane therefore rebuilds after Git disappears. See [`temporal-provenance.md`](temporal-provenance.md) for identity, ancestry, validation, and bounded traversal contracts.

## Git decision evidence

`GitHistoryAdapter` version `0.1.0` is a provider-neutral, derived-evidence-only boundary. A conforming adapter must declare `rebuildable: true` and `uniqueAuthority: false`; its physical identity is excluded from the content-derived Git history ID and World Model ID.

The default `git-cli` adapter asynchronously reads all reachable commits. It records commit and parent identities, authored/committed timestamps, a digest of author email, refs, subject, body, and `git:<sha>` evidence provenance. Current local branches, remote refs, and tags are independently read from `.git` and used to validate and prune the adapter result to the exact parent-reachable set. A ref change therefore makes the World Model stale even when files have not changed.

Some constrained hosts forbid a Node process from launching Git. This is an adapter-level fail-open condition: indexing continues with `gitHistory: none` and a stable reason code. A host can instead produce a byte-preserving log file with this exact command and provide it explicitly:

```text
git -C <project> --no-pager log --all --topo-order --date-order --no-show-signature --format=%H%x00%P%x00%aI%x00%cI%x00%an%x00%ae%x00%D%x00%B%x00
node scripts/head.mjs world-index <project> --git-log <host-exported-log-file>
```

The log file adapter rejects missing files, symlinks, non-files, and oversized inputs. The core still validates the exported commits against current refs. Commit messages are historical decision evidence only: every record has `instructionAuthority: false` and `evidence-not-instruction`; the index never turns a message into an authorized project `Decision`.

## External runtime state

`RuntimeStateAdapter` version `0.1.0` imports strict point-in-time host exports as rebuildable evidence. It is read-only and separate from the future `AgentRuntimeAdapter` control boundary. Raw provider IDs are hashed; non-project workspace paths are hashed; raw commands, endpoints, environment, prompts, transcripts, credentials, and arbitrary metadata are rejected. Advertised capabilities never grant control authority.

The adapter descriptor and physical source path live only in the World Model pointer so freshness checks can re-read the export without changing semantic identity. Normalized observation content determines `runtimeStateId`. A changed export makes the World Model stale and excludes runtime candidates until rebuild. See [`runtime-state.md`](runtime-state.md) for the schema and exact boundary.

## Active coverage

- supported text files up to 512 KiB;
- deterministic path and content digests;
- validated `repository.scan.v1` output with maximum file, per-file byte, total-byte, input, output, and timeout bounds;
- source, test, documentation, and configuration classification;
- heuristic JavaScript/TypeScript, Python, and Markdown symbols;
- JavaScript/TypeScript/Python module references, local module resolution, and package manifest dependencies;
- content-derived File, Symbol, and ExternalDependency nodes;
- evidence-linked `DECLARES`, `IMPORTS`, and resolvable `CALLS` edges;
- stable temporal Repository/File/Symbol/Test logical entities and immutable File/Symbol/Test revisions;
- stable FeatureGroup, Capability, Feature, Requirement, Constraint, and Decision logical entities with immutable canon-projected revisions;
- onboarding-triggered explicit indexing before candidate inference and a verified child SourceSnapshot/GraphSnapshot rebuild after ReviewDecision-gated Product Canon promotion;
- digest-verified onboarding CandidateSet, Evidence, Unknown, ReviewDecision, and ProductModelRevision receipt projection with candidate-to-evidence, review, disposition, and promotion lineage;
- bounded Feature/Capability-to-File/Symbol/Test mapping candidates, explicit accept/reject ReviewDecisions, separate reviewed relationship receipts, and canonical-direction `IMPLEMENTS`/`VERIFIED_BY` edges;
- accepted-execution ChangeSets with exact before/after SourceSnapshot and File/Symbol/Test revision differences, sorted zero-or-more ChangeSet parents, and Git-independent identity;
- immutable Change-impact candidates derived only through reviewed mappings, explicit accept/reject ReviewDecisions, separate ReviewedImpact receipts, and canonical `IMPACTS` edges;
- optional immutable VCS evidence attachments with explicit commit selection, embedded Git commit observations, unchanged ChangeSet identity, and `MATERIALIZED_AS` / `REFERENCES` graph relations;
- validated `CONTAINS`, `REALIZES`, and `GOVERNED_BY` product relationships independent from repository directory structure;
- zero-or-more SourceSnapshot and Revision parents with no automatic merge claim;
- provenance-complete product/repository edges plus `PROPOSES_FROM`, `PROPOSES_TO`, `SUPPORTED_BY`, `REVIEWED_BY`, `ACCEPTED_BY`, `REJECTED_BY`, `PRODUCES`, and `PROMOTED_FROM` onboarding edges;
- deterministic bounded temporal traversal with kind/relation/authority/freshness allowlists, confidence policy, inclusion/exclusion reasons, and graph/query/result digests;
- local JSON and in-memory graph projection adapters with identical GraphSnapshot and traversal identities, verified pointer/snapshot materialization, embedded-graph fallback disclosure, and stale/tamper/authority rejection;
- activated ArcadeDB projection with snapshot-scoped semantic vertices and edges, content-derived node/edge set receipts, exact partial-write resume, complete status-time remote re-verification, and prepared bounded server expansion that verifies the exact query radius without reloading the full remote snapshot/topology;
- file digest and line provenance, heuristic confidence, unresolved counts, and bounded traversal;
- local `.git/HEAD` and in-repository ref resolution without following external gitdir pointers;
- content-addressed all-reachable Git commit-message evidence through replaceable CLI and host-export adapters;
- content-addressed point-in-time external runtime observations through a replaceable read-only host-export adapter;
- semantic HEAD lifecycle state including current plan, active Run/contract, pending review, and required plan action;
- added, changed, and removed path calculation;
- file-level freshness;
- Context Compiler candidates containing path, digest, classification, language, symbols, dependencies, pre-indexed semantic adjacency, one deterministic task-relevant temporal anchor, bounded ProductContext projections, GraphSnapshot/TraversalQuery/result digests, and World Model ID.

Managed root projections and these directories are excluded: `.head`, `.git`, VCS metadata, dependency/vendor directories, generated build outputs, caches, coverage outputs, and virtual environments. Symlinks and unsupported/binary or oversized files are skipped and counted. A user-selected source scope may additionally include or exclude normalized project-relative roots without changing Product Canon.

## Context Compiler behavior

- no World Model: Capsule coverage remains `curated-head-canon-only`;
- current World Model: task-relevant repository files, bounded semantic and temporal relationships, history-class-eligible Git evidence, and runtime observations compete within the normal context budget;
- matching Product Canon concepts compete as one bounded `ProductContext` derived projection under the same budget;
- stale World Model: repository candidates are excluded and Capsule coverage explicitly records the stale exclusion;
- every repository candidate, semantic node, and edge remains `evidence-not-instruction`.
- unreviewed onboarding, Feature mapping, and Change-impact candidate-space nodes are excluded by default and require explicit CLI/MCP opt-in; Context Capsules never opt in and consume only reviewed mappings and impacts.

This prevents a stale index from silently directing execution while still allowing normal curated-canon compilation.

## Explicitly deferred

Debounced filesystem and CI trigger ingestion plus single-writer event coalescing are active and both terminate in the same incremental refresh mutation path. Explicitly enabled automatic Markdown regeneration is active through the separate safe post-refresh policy. Explicit DocumentChangeCandidate review/application and its temporal audit projection are also active. Background service installation, provider-specific CI webhook adapters, automatic GraphDB refresh, and automatic Obsidian/Notion publication remain deferred.

- AST-accurate semantic symbols, dynamic dispatch, and complete call resolution;
- structured decision inference, supersession modeling, and authorized promotion from Git evidence;
- live provider/runtime probing and streaming beyond point-in-time host exports;
- generated/vendor source classification beyond the current exclusion rules;
- cross-repository relationships;
- authorized candidate-knowledge promotion;
- inferred commit-to-ChangeSet matching, conformance, complete execution-lineage, and projection of document artifacts/review receipts back into later graph snapshots;
- Obsidian and Notion projection adapters;
- dedicated imported-backlog adapters beyond the active structured brief input;
- automatic parent inference, merge, and conflict resolution;
- an executed live prepared-query evaluation, compare-and-swap publication, and non-ArcadeDB transports;
- production selection or transport amortization for the conformant Go `repository.scan.v1` candidate, plus benchmark-gated migration of graph/traversal/Context operations;
- descendant process-tree supervision beyond the worker manifest's enforced no-descendant contract.

Future stores must implement the versioned adapter contract and preserve the same content-addressed snapshot, digest verification, freshness, coverage, and rebuildability semantics. A remote graph store may accelerate traversal but cannot become the sole authority or alter semantic identity.
