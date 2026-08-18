# GraphProjectionAdapter contract

Read [`ULTIMATE_GOAL.md`](ULTIMATE_GOAL.md) before changing this boundary.

## Purpose

`GraphProjectionAdapter` version `0.1.0` separates the semantic temporal `GraphSnapshot` from the backend used to materialize and traverse it. The embedded, digest-verified GraphSnapshot in the World Model remains the recoverable source for rebuilding a projection. Neither the local adapter nor a future GraphDB adapter is canon, instruction authority, promotion authority, or unique authority.

The contract exists alongside `WorldModelStoreAdapter` rather than replacing it:

```text
canon + executable state + verified lineage
  -> RepositoryWorldModel containing recoverable GraphSnapshot
       -> GraphProjectionAdapter
            -> local JSON projection
            -> in-memory conformance projection
            -> future GraphDB projection
```

Backend identity, filesystem locations, remote record IDs, and operational timing are excluded from `GraphSnapshot`, `TraversalQuery`, `TemporalTraversalResult`, Context Capsule, and World Model semantic identities.

## Required interface and authority

Every adapter implements synchronous host-facing methods:

```text
describe
readPointer
readSnapshot
writePointer
writeSnapshot
listSnapshotIds
query
```

The initial synchronous interface is the local conformance baseline. An external GraphDB transport is not implemented yet; it must preserve this semantic behavior or introduce a separately versioned asynchronous host boundary without changing graph/query/result identities.

Every descriptor must declare:

```text
contract: replaceable-rebuildable-derived-graph-projection
authority: derived-evidence-only
rebuildable: true
uniqueAuthority: false
instructionAuthority: false
promotionAuthority: false
remote: boolean
durable: boolean
```

An adapter that claims project canon, instruction, promotion, or unique authority is rejected before materialization.

## Local materialization

The default local adapter stores:

```text
.head/graph-projection/current.json
.head/graph-projection/snapshots/graph-snapshot-*.json
```

The snapshot is immutable and byte-semantically equivalent under canonical JSON to the verified graph embedded in the current World Model. The pointer is content-addressed and records the project, GraphSnapshot, GraphSnapshot hash, and SourceSnapshot identities plus the non-authoritative projection flags.

World Model indexing writes and verifies the immutable World Model snapshot, materializes and re-reads the graph projection, then advances the World Model pointer. A projection failure therefore cannot make an unverified graph current in the World Model. A projection snapshot left behind before a later pointer failure is harmless derived data and is verified again before reuse.

## Query and fallback behavior

Temporal queries first compute the deterministic reference contract from the embedded recoverable GraphSnapshot. A current adapter query must return the exact same canonical `TemporalTraversalResult`, including GraphSnapshot, query, result identities, ordering, bounds, inclusion, and exclusion reasons.

- current adapter: query through the adapter and reject any semantic mismatch;
- no materialized adapter pointer: use the embedded graph and disclose `GRAPH_PROJECTION_NOT_MATERIALIZED`;
- different projected current GraphSnapshot: fail closed with `GRAPH_PROJECTION_STALE`;
- missing, corrupt, tampered, or conflicting snapshot/pointer: fail closed;
- backend absence never removes the embedded graph or changes semantic identity.

The reference comparison intentionally favors correctness over acceleration in this first slice. Future GraphDB or compute-backed traversal may optimize validation only after conformance proves the same deterministic output.

## Active adapters and surfaces

- `LocalJsonGraphProjectionAdapter`: durable dependency-free baseline;
- `InMemoryGraphProjectionAdapter`: non-durable conformance implementation;
- `verifyGraphProjectionAdapterConformance`: content-derived report naming both authority-bounded adapters and proving adapter-neutral semantics over one GraphSnapshot and one-to-64 named bounded query fixtures;
- `world-graph-status`: read and verify projection state;
- `head_graph_projection_status`: read-only MCP equivalent;
- `world-temporal`, MCP temporal traversal, and Context Compiler temporal expansion use the adapter boundary while preserving result identity.
- the separate [`DocumentProjectionAdapter`](document-projection-adapter.md) consumes the verified GraphSnapshot for deterministic Markdown without changing graph identity.

## Deferred

- authenticated GraphDB transport and server-side traversal;
- asynchronous remote adapter lifecycle and retry policy;
- remote pointer compare-and-swap and transaction receipts;
- compute-backed graph construction or traversal;
- GraphDB-specific indexes, migrations, and operational observability;
- Obsidian/Notion document adapters and document-candidate review/application.

No remote endpoint was queried or mutated by this implementation.
