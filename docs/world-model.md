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

GraphDB is not required and no remote database is queried or mutated. A future GraphDB adapter may accelerate traversal, but the local canon must always be sufficient to rebuild it.

## Commands

```text
node scripts/head.mjs world-index <project>
node scripts/head.mjs world-index <project> --git-log <host-exported-log-file>
node scripts/head.mjs world-index <project> --runtime-state <host-exported-json-file>
node scripts/head.mjs world-index <project> --parent-snapshot <source-snapshot-id,source-snapshot-id>
node scripts/head.mjs world-index <project> --revision-parents <logical-entity-to-parent-revisions.json>
node scripts/head.mjs world-status <project>
node scripts/head.mjs world-query <project> --query <symbol-or-path> --depth 1 --limit 100
node scripts/head.mjs world-temporal <project> --query <path-or-symbol> --relations HAS_REVISION,CURRENT_REVISION,DECLARES --depth 2 --limit 100 --edge-limit 200
node scripts/head.mjs world-history <project> --query <decision-terms> --limit 20
node scripts/head.mjs world-runtime <project> --runtime codex --state active --kind session --limit 20
```

`world-index` invokes the validated `repository.scan.v1` operation and materializes a deterministic snapshot. Repeating it without repository changes returns the same World Model ID. `world-status` recomputes the same reference scan and source digests and returns `current` or `stale` plus file-level `active`, `stale`, `removed`, and `unindexed` states.

Repository file changes, current Git refs, semantic HEAD lifecycle state, and indexer protocol versions all participate in the source digest. Volatile timestamps and physical store identity are excluded.

The read-only MCP tool `head_world_model` exposes the same digest and freshness verification. `head_world_query` returns a bounded zero-to-three-hop heuristic semantic neighborhood. `head_temporal_graph` returns a deterministic allowlisted temporal traversal with graph/query/result digests. `head_git_history` performs a bounded query over verified current Git evidence. `head_runtime_state` performs a bounded query over verified point-in-time runtime observations. All reject a stale index.

## Temporal provenance graph

World Model version `0.5.3` includes repository scan protocol `0.2.0`, source-analysis protocol `0.2.0`, semantic graph protocol `0.2.0`, and a separate `GraphSnapshot` built by temporal provenance protocol `0.2.0`. Source analysis now removes duplicate `(line, kind, name)` symbols before applying the per-file bound, preventing large repositories from producing a self-invalid scan. It leaves the heuristic import/call graph intact while adding stable Product/Repository/File/Symbol/Test logical identities, immutable Product/File/Symbol/Test revisions, and explicit zero-or-more SourceSnapshot and Revision parents. Product entities come only from the validated user-owned `.head/context/product-model.json` canon and are projected with `authorityClass: canon-projected`; the graph itself still has no canonical or promotion authority. Every node and edge carries typed provenance, freshness, producer version, evidence identities, and instruction/promotion authority flags. Heuristic Symbol projections use numeric confidence.

The repository scan is the first built-in `ComputeAdapter` operation. Its semantic output contains only normalized relative paths and deterministic source facts. The scan root is operational input and is excluded from the repository-scan result; backend identity, execution mode, timing, and process details remain pointer diagnostics outside World Model identity. A Go implementation now produces byte-equivalent complete responses on the tracked corpus and limit/error fixtures, but release manifests intentionally do not advertise it because measured small and medium scans regress and the large-input gain is marginal. The default adapter therefore probes the verified distribution, discloses `GO_WORKER_OPERATION_NOT_INSTALLED`, and runs the JavaScript reference. The World Model continues to record its separately validated canonical project root.

The temporal graph consumes no Git state. A project without `.git` constructs and queries the same temporal identities from the same project ID, source scan, explicit parent sets, and producer version. Optional Git history remains a separate World Model evidence plane. See [`temporal-provenance.md`](temporal-provenance.md) for identity, ancestry, validation, and bounded traversal contracts.

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
- validated `CONTAINS`, `REALIZES`, and `GOVERNED_BY` product relationships independent from repository directory structure;
- zero-or-more SourceSnapshot and Revision parents with no automatic merge claim;
- provenance-complete `CONTAINS`, `REALIZES`, `GOVERNED_BY`, `HAS_REVISION`, `CURRENT_REVISION`, `PARENT_OF`, `DECLARES`, and `REFERENCES` edges;
- deterministic bounded temporal traversal with kind/relation/authority/freshness allowlists, confidence policy, inclusion/exclusion reasons, and graph/query/result digests;
- file digest and line provenance, heuristic confidence, unresolved counts, and bounded traversal;
- local `.git/HEAD` and in-repository ref resolution without following external gitdir pointers;
- content-addressed all-reachable Git commit-message evidence through replaceable CLI and host-export adapters;
- content-addressed point-in-time external runtime observations through a replaceable read-only host-export adapter;
- semantic HEAD lifecycle state including current plan, active Run/contract, pending review, and required plan action;
- added, changed, and removed path calculation;
- file-level freshness;
- Context Compiler candidates containing path, digest, classification, language, symbols, dependencies, bounded semantic and temporal relationships, bounded ProductContext projections, GraphSnapshot/TraversalQuery/result digests, and World Model ID.

Managed root projections and these directories are excluded: `.head`, `.git`, VCS metadata, dependency/vendor directories, generated build outputs, caches, coverage outputs, and virtual environments. Symlinks and unsupported/binary or oversized files are skipped and counted.

## Context Compiler behavior

- no World Model: Capsule coverage remains `curated-head-canon-only`;
- current World Model: task-relevant repository files, bounded semantic and temporal relationships, history-class-eligible Git evidence, and runtime observations compete within the normal context budget;
- matching Product Canon concepts compete as one bounded `ProductContext` derived projection under the same budget;
- stale World Model: repository candidates are excluded and Capsule coverage explicitly records the stale exclusion;
- every repository candidate, semantic node, and edge remains `evidence-not-instruction`.

This prevents a stale index from silently directing execution while still allowing normal curated-canon compilation.

## Explicitly deferred

- AST-accurate semantic symbols, dynamic dispatch, and complete call resolution;
- structured decision inference, supersession modeling, and authorized promotion from Git evidence;
- live provider/runtime probing and streaming beyond point-in-time host exports;
- generated/vendor source classification beyond the current exclusion rules;
- cross-repository relationships;
- authorized candidate-knowledge promotion;
- ChangeSet, product-to-code, conformance, candidate, lineage, and document-projection graph planes;
- inferred onboarding candidates, batch ReviewDecision promotion, and Product Canon mutation workflows;
- automatic parent inference, merge, and conflict resolution;
- the replaceable `GraphProjectionAdapter` contract;
- the optional GraphDB storage adapter and remote graph expansion.
- production selection or transport amortization for the conformant Go `repository.scan.v1` candidate, plus benchmark-gated migration of graph/traversal/Context operations;
- descendant process-tree supervision beyond the worker manifest's enforced no-descendant contract.

Future stores must implement the versioned adapter contract and preserve the same content-addressed snapshot, digest verification, freshness, coverage, and rebuildability semantics. A remote graph store may accelerate traversal but cannot become the sole authority or alter semantic identity.
