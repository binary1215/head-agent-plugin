# GraphProjectionAdapter contract

Read [`ULTIMATE_GOAL.md`](ULTIMATE_GOAL.md) before changing this boundary.

## Purpose

`GraphProjectionAdapter` version `0.1.0` separates the semantic temporal `GraphSnapshot` from the backend used to materialize and traverse it. Temporal provenance protocol `0.9.0` embeds the P4 boundary from the [`AuthorityPlaneContract`](authority-plane-contract.md). The embedded, digest-verified GraphSnapshot in the World Model remains the recoverable source for rebuilding a projection. Neither the snapshot, local adapter, nor ArcadeDB adapter is Product semantic Canon, instruction authority, promotion authority, or unique authority.

Product semantic Canon remains P1; the Core GraphSnapshot is its P4 relation and retrieval index. The graph's ProductModel identity binds the exact projected source without transferring its normative authority. Distribution and Host are architectural planes, not additional meaning planes. A graph adapter runs behind an exact Product Canon byte fence: mutation or deletion is restored and rejected before the World Model pointer can advance.

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
node scripts/head.mjs world-graph-remote-database-status C:\path\to\project
node scripts/head.mjs world-graph-remote-database-initialize C:\path\to\project
node scripts/head.mjs world-graph-remote-activate C:\path\to\project
node scripts/head.mjs world-graph-remote-status C:\path\to\project
```

Database status is read-only and reports a content-derived compatibility audit without endpoint, database name, credential value, or record identity. Initialization creates a missing selected database. Existing unrelated types do not block activation and are never a reset reason. A whole-database reset is eligible only when the audit proves that one of the nine `HeadAgentGraph*` reserved type names has an incompatible kind or property type, and the operator supplies both `--reset-incompatible true` and an exact `--confirm-database` match. Missing sync types are a compatible partial schema and are added in place. Reset invalidates the projection, topology, and incremental-sync mutable pointers; immutable prior receipts and the complete local graph mirror remain as audit and recovery evidence.

Activation creates the projection, topology, sync-manifest, and sync-checkpoint schema, compares the current remote GraphSnapshot with the target, and writes a content-addressed delta manifest. Default batches contain at most 50 records and the contract rejects batches above 200. Exact records are carried by semantic identity; snapshot-only node changes and relation identities derived from a new SourceSnapshot use compact rebase records, while genuinely added or changed records carry their full canonical JSON. Every batch is idempotent, is re-read against the target content, and receives an immutable remote checkpoint. A retry resumes verified checkpoints and safely reapplies an interrupted uncheckpointed batch.

After all batches are complete, activation writes and verifies the complete topology plus a small topology-backed GraphSnapshot envelope instead of duplicating the full graph JSON remotely. Baseline adapter equivalence and prepared server-traversal conformance use a staged target pointer, so neither pass can make the candidate current. Only after both passes and the local recovery snapshot succeed does a single conditional pointer update advance an existing pointer from the exact observed predecessor; an initial pointer uses the project-unique index as its compare-and-insert fence. The result is re-read, a different predecessor fails closed, and an already installed identical target is accepted idempotently. The local pointer then mirrors it atomically. `.head/graph-projection/arcadedb/sync/receipts` records a content-derived receipt binding manifest, checkpoint set, prior/final pointers, full snapshot/topology verification, local recovery, and the atomic transition. Credential values, endpoints, target names, server record identities, and timing remain excluded.

The local canonical GraphSnapshot remains the independent recovery source. The remote topology-backed envelope reconstructs that exact graph from snapshot-scoped vertices and edges and rejects count, set-digest, topology, byte-length, or full-content mismatch. Every vertex stores the exact semantic node JSON and every edge stores the exact semantic edge JSON while ArcadeDB record IDs remain operational details. The topology manifest binds the project, GraphSnapshot, SourceSnapshot, sorted node and edge set digests, counts, and non-authority flags to a content-derived identity. Unique indexes bind vertices and edges to `(projectId, graphSnapshotId, semanticId)` without making those database indexes semantic identity.

Activated query mode remains `server-expanded-client-canonicalized`. A newly conformed activation advertises prepared traversal `0.1.0`. Query execution computes the deterministic reference locally from the embedded GraphSnapshot, verifies the current remote pointer and topology manifest, then asks ArcadeDB to expand only the prepared snapshot-scoped radius with breadth-first `TRAVERSE`. It does not reload the full remote snapshot or complete vertex/edge topology. One semantic hop is two physical traversal depths (vertex to edge to vertex), depth remains zero through three, and the response is capped at 8,192 records with one additional record used only to detect overflow.

The pointer verified at prepared-query inspection is reused exactly once by the immediately following synchronous query through a non-serializable object token bound to that `ArcadeDbGraphProjectionAdapter` instance. The token is not a credential, cache, receipt, semantic field, or persistent artifact. A missing, foreign, invalid, or already-consumed token performs the normal remote pointer read, and the pointer document is still checked against the complete prepared GraphSnapshot identity. This removes only the duplicate round trip; it does not extend freshness across queries or let callers assert current state.

The server response is evidence, not semantic authority. The client requires the exact prepared radius, verifies every JSON record and physical traversal depth, and rejects stale manifests, missing coverage, duplicates, forged or out-of-radius records, and truncation. It then returns the unchanged deterministic `TemporalTraversalResult`; server ordering, ArcadeDB record IDs, transport metadata, and verification receipts never enter query or result identity. This is query-scoped integrity: status inspection and activation still perform complete remote snapshot/topology verification, so corruption outside the requested radius is detected by those full-audit paths rather than claimed away by a bounded query.

## Prepared traversal performance evidence

`PreparedTraversalCostEvidence` protocol `0.1.0` is content-derived from the exact GraphSnapshot and `PreparedTraversalRequest`. Its payload model counts normalized UTF-8 canonical-JSON response components: the identity envelope, graph manifest, bounded expansion, complete GraphSnapshot, and complete topology records. The prepared total contains only the identity envelope, manifest, and bounded expansion. The conservative full-reload baseline adds one complete snapshot and one complete topology record set. This is reproducible logical transport-cost evidence, not a claim about HTTP framing, compression, database cache state, or wall-clock latency.

The reviewed 64-file fixture under `benchmarks/prepared-traversal-v1` fixes graph, request, result, and cost-evidence identities. With the P1-P5 authority boundary and Product Operating summary fields included in the GraphSnapshot, it records 20,478 prepared bytes versus an 834,638-byte baseline, saving 814,160 bytes or 9,754 basis points. Run it with:

```text
npm run benchmark:prepared-traversal -- --iterations 7
```

Elapsed time and observed transport-call sizes are emitted only under diagnostics and never enter `PreparedTraversalCostEvidence`, graph, query, result, or Capsule identity. The fixture verifies zero full snapshot reads, zero full topology reads, and zero query-phase writes.

An already activated prepared ArcadeDB project can use the same harness in strictly read-only mode:

```text
npm run benchmark:prepared-traversal -- --live-project <project-path> --iterations 7
```

The live path reads the project-scoped activation and environment reference names, accepts no credential values or credential flags, rejects fallback and semantic drift, and replaces every schema/snapshot/topology/pointer write method with a fail-closed guard. Reports exclude endpoint, database, credential values, and project paths. A fixture run proves the contract and deterministic cost identity; only a successful `arcadedb-live-read-only` report proves behavior and latency against a live environment.

The 2026-08-20 privacy-safe live acceptance used an already verified 8,037-node and 12,441-edge project graph. Seven identical prepared traversals processed 220,930 normalized bytes instead of the 23,101,697-byte full-reload baseline, saving 22,880,767 bytes or 9,904 basis points. Every run preserved the exact graph, request, query, and result identities; query-phase writes, full snapshot reads, and full topology reads remained zero. The first run measured 2,942.2 ms end-to-end and 134.7 ms for bounded database expansion. After removing duplicate pointer reads and redundant receipt work, the fresh completion run retained the same semantic and byte identities with a 2,820.4 ms end-to-end median and 137.7 ms database-expansion median; timing remains diagnostic rather than semantic evidence.

The same completion acceptance exercised the new write path against a dedicated project namespace in the selected live database. The 8,037/12,441 production-sized projection passed a zero-batch no-change sync with identical predecessor/target pointers, verified snapshot/topology/local mirror, and an immutable receipt. A separate small fixture passed initial upload, a four-batch delta, interruption after one checkpoint, checkpoint resume, stale-predecessor pointer-conflict rejection, and conflict recovery. It also exposed and fixed three transport defects before acceptance: forced bridge exit after a valid large response, SQLScript use of a server-reserved variable in CAS, and endpoint-based `IF NOT EXISTS` suppression of distinct parallel semantic edges. The acceptance namespace was removed exactly and verified at zero remaining records; the nine reserved types and unrelated records were preserved.

An interrupted sync resumes only from a digest-verified manifest and immutable verified checkpoints. An uncheckpointed batch is safe to replay, but a conflicting manifest, checkpoint, batch record, complete topology, or pointer predecessor fails closed rather than being repaired silently.

After activation, the default adapter mirrors every successful remote snapshot and pointer into the local JSON projection. Connection/timeout or missing-environment-reference failure may select the local mirror only before any remote content has been observed or mutated in that operation. Authentication failure, rejected requests, stale pointers, missing records, digest mismatch, content conflict, semantic query divergence, or failure after a remote observation/mutation fail closed. If local progress occurs during a remote outage, a later stale remote pointer also fails closed until explicit activation repairs and re-verifies the projection.

## Active adapters and surfaces

- `LocalJsonGraphProjectionAdapter`: durable dependency-free baseline;
- `InMemoryGraphProjectionAdapter`: non-durable conformance implementation;
- `ArcadeDbGraphProjectionAdapter`: authenticated ArcadeDB HTTP/JSON durable projection with resumable content-addressed delta batches, immutable checkpoints, snapshot-scoped vertex/edge topology, topology-backed snapshot reconstruction, pointer compare-and-swap, and optional conformance-gated prepared bounded expansion without full query-time reload;
- `ActivatedArcadeDbGraphProjectionAdapter`: remote-first adapter with a complete local mirror and narrowly classified pre-observation availability fallback;
- `verifyGraphProjectionAdapterConformance`: content-derived report naming both authority-bounded adapters and proving adapter-neutral semantics over one GraphSnapshot and one-to-64 named bounded query fixtures;
- `world-graph-status`: read and verify projection state;
- `world-graph-remote-activate` and `world-graph-remote-status`: explicit activation and read-only remote status;
- `world-graph-remote-database-status` and `world-graph-remote-database-initialize`: read-only compatibility audit and explicit exact-target provisioning/reset boundary;
- `head_graph_projection_status`: read-only MCP equivalent;
- `head_graphdb_projection_status` and `head_graphdb_database_status`: read-only MCP activation and compatibility status equivalents;
- `world-temporal`, MCP temporal traversal, and Context Compiler temporal expansion use the adapter boundary while preserving result identity.
- the separate [`DocumentProjectionAdapter`](document-projection-adapter.md) consumes the verified GraphSnapshot for deterministic Markdown without changing graph identity.

## Deferred

- adaptive concurrency and measured batch-size tuning beyond the bounded deterministic default;
- further local canonical-verification amortization only where a new measured bottleneck preserves independent trust-boundary checks;
- non-ArcadeDB GraphDB transports;
- asynchronous pooled remote transport, retry/backoff, and transport amortization;
- compute-backed graph construction or traversal;
- topology schema migrations and operational observability;
- Obsidian/Notion document adapters.

Automated tests use an in-memory transport and do not require or mutate a user GraphDB. Database initialization and graph activation are the only explicit remote mutation surfaces; neither accepts credential values as arguments.
