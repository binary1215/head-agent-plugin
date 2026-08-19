# GraphProjectionAdapter contract

Read [`ULTIMATE_GOAL.md`](ULTIMATE_GOAL.md) before changing this boundary.

## Purpose

`GraphProjectionAdapter` version `0.1.0` separates the semantic temporal `GraphSnapshot` from the backend used to materialize and traverse it. The embedded, digest-verified GraphSnapshot in the World Model remains the recoverable source for rebuilding a projection. Neither the local adapter nor the ArcadeDB adapter is canon, instruction authority, promotion authority, or unique authority.

The contract exists alongside `WorldModelStoreAdapter` rather than replacing it:

```text
canon + executable state + verified lineage
  -> RepositoryWorldModel containing recoverable GraphSnapshot
       -> GraphProjectionAdapter
            -> local JSON projection
            -> in-memory conformance projection
            -> activated ArcadeDB HTTP projection + local mirror
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

The host-facing contract remains synchronous. `ArcadeDbHttpTransport` uses an exact-child Node bridge for the asynchronous HTTP request and exchanges bounded JSON over standard input/output. Credential values are resolved from the named environment variables only inside that child, never placed in command arguments, request artifacts, activation receipts, descriptors, or semantic identities.

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

The reference comparison intentionally favors correctness over acceleration. `PreparedTraversalRequest` protocol `0.1.0` now binds the already-fixed GraphSnapshot identity, deterministic TraversalQuery, expected result identity, and exact unfiltered bounded node/edge radius. An adapter returns a content-derived verification receipt; it never returns or chooses the authoritative semantic result. The provider-neutral client still returns its deterministic reference result after receipt verification.

## ArcadeDB activation and materialization

Onboarding persists only the ArcadeDB endpoint, database, and environment-style username/password reference names. Selection alone is pending configuration and does not activate remote I/O. With both referenced environment variables available, activation is explicit:

```powershell
node scripts/head.mjs world-graph-remote-activate C:\path\to\project
node scripts/head.mjs world-graph-remote-status C:\path\to\project
```

Activation creates the `HeadAgentGraphSnapshot` and `HeadAgentGraphPointer` document schema, writes and re-reads the current immutable GraphSnapshot, and first proves baseline snapshot-query equivalence against the local reference adapter. It then materializes the snapshot into `HeadAgentGraphNode` vertices and `HeadAgentGraphEdge` edges and writes `HeadAgentGraphTopology` only after the complete node and edge sets can be re-read exactly. A second conformance pass runs the named bounded fixtures through server expansion. Only after both passes succeed are the topology receipt and final content-addressed activation receipt advanced. A failed upgrade therefore cannot activate an unverified traversal mode. The receipts bind the current storage-selection, graph, conformance, node-set, and edge-set identities and explicitly record that credential values and server record identities are not persisted or semantic.

The canonical GraphSnapshot document remains the recoverable remote envelope. Its topology representation is snapshot-scoped: every vertex stores the exact semantic node JSON and every edge stores the exact semantic edge JSON while ArcadeDB record IDs remain operational details. The topology manifest binds the project, GraphSnapshot, SourceSnapshot, sorted node and edge set digests, counts, and non-authority flags to a content-derived identity. Unique indexes bind vertices and edges to `(projectId, graphSnapshotId, semanticId)` without making those database indexes semantic identity.

Activated query mode remains `server-expanded-client-canonicalized`. A newly conformed activation advertises prepared traversal `0.1.0`. Query execution computes the deterministic reference locally from the embedded GraphSnapshot, verifies the current remote pointer and topology manifest, then asks ArcadeDB to expand only the prepared snapshot-scoped radius with breadth-first `TRAVERSE`. It does not reload the full remote snapshot or complete vertex/edge topology. One semantic hop is two physical traversal depths (vertex to edge to vertex), depth remains zero through three, and the response is capped at 8,192 records with one additional record used only to detect overflow.

The server response is evidence, not semantic authority. The client requires the exact prepared radius, verifies every JSON record and physical traversal depth, and rejects stale manifests, missing coverage, duplicates, forged or out-of-radius records, and truncation. It then returns the unchanged deterministic `TemporalTraversalResult`; server ordering, ArcadeDB record IDs, transport metadata, and verification receipts never enter query or result identity. This is query-scoped integrity: status inspection and activation still perform complete remote snapshot/topology verification, so corruption outside the requested radius is detected by those full-audit paths rather than claimed away by a bounded query.

An interrupted topology write with no manifest may resume only when every existing record is an exact subset of the target GraphSnapshot; once a manifest exists, any partial or divergent state is rejected rather than repaired silently.

After activation, the default adapter mirrors every successful remote snapshot and pointer into the local JSON projection. Connection/timeout or missing-environment-reference failure may select the local mirror only before any remote content has been observed or mutated in that operation. Authentication failure, rejected requests, stale pointers, missing records, digest mismatch, content conflict, semantic query divergence, or failure after a remote observation/mutation fail closed. If local progress occurs during a remote outage, a later stale remote pointer also fails closed until explicit activation repairs and re-verifies the projection.

## Active adapters and surfaces

- `LocalJsonGraphProjectionAdapter`: durable dependency-free baseline;
- `InMemoryGraphProjectionAdapter`: non-durable conformance implementation;
- `ArcadeDbGraphProjectionAdapter`: authenticated ArcadeDB HTTP/JSON durable projection with immutable snapshot insertion, snapshot-scoped vertex/edge topology, verified pointer upsert, and optional conformance-gated prepared bounded expansion without full query-time reload;
- `ActivatedArcadeDbGraphProjectionAdapter`: remote-first adapter with a complete local mirror and narrowly classified pre-observation availability fallback;
- `verifyGraphProjectionAdapterConformance`: content-derived report naming both authority-bounded adapters and proving adapter-neutral semantics over one GraphSnapshot and one-to-64 named bounded query fixtures;
- `world-graph-status`: read and verify projection state;
- `world-graph-remote-activate` and `world-graph-remote-status`: explicit activation and read-only remote status;
- `head_graph_projection_status`: read-only MCP equivalent;
- `head_graphdb_projection_status`: read-only MCP remote activation/status equivalent;
- `world-temporal`, MCP temporal traversal, and Context Compiler temporal expansion use the adapter boundary while preserving result identity.
- the separate [`DocumentProjectionAdapter`](document-projection-adapter.md) consumes the verified GraphSnapshot for deterministic Markdown without changing graph identity.

## Deferred

- prepared server-query execution and integrity evidence that avoid full remote snapshot/topology reload while preserving exact local ordering, bounds, inclusion, exclusion, and digests;
- non-ArcadeDB GraphDB transports;
- asynchronous pooled remote transport, retry/backoff, and transport amortization;
- remote pointer compare-and-swap and transaction receipts;
- compute-backed graph construction or traversal;
- topology schema migrations and operational observability;
- Obsidian/Notion document adapters.

Automated tests use an in-memory transport and do not require or mutate a user GraphDB. The activation command is the sole explicit remote mutation surface.
