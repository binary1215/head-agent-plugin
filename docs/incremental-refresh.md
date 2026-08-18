# Incremental observed-state refresh

Status: explicit manual refresh contract active; event ingestion deferred

Protocol version: `0.1.0`

## Purpose

Incremental refresh reconstructs observed project state without granting a watcher, compute backend, graph, or document authority over Product Canon. It is the verified bridge between explicit full indexing and future debounced filesystem or CI ingestion.

The active pipeline is:

```text
verified current World Model
  -> content-derived IncrementalRefreshRequest
  -> rediscover and byte-hash every eligible file
  -> reuse analysis only for digest-identical verified files
  -> validate one complete RepositoryScanResult
  -> preview a child SourceSnapshot and GraphSnapshot
  -> persist and verify graph materialization
  -> atomically advance the World Model pointer
  -> persist an immutable IncrementalRefreshReceipt
  -> advance the refresh receipt pointer
```

Filesystem watchers, CI event adapters, GraphDB event projection, and automatic document regeneration are not active in this slice.

## Authority boundary

Refresh may update observed facts:

- file content digests and classification;
- heuristic symbols, imports, dependencies, bindings, and calls;
- immutable File, Symbol, and Test revisions;
- SourceSnapshot, GraphSnapshot, and World Model materializations;
- read-only runtime observations supplied through an already validated adapter.

Refresh cannot:

- mutate Feature, Capability, Requirement, Constraint, Decision, or other Product Canon;
- accept Feature mappings, Change impacts, onboarding candidates, or document changes;
- grant instruction, promotion, canon-mutation, or control authority;
- rewrite an existing World Model, SourceSnapshot, revision, Capsule, contract, Run, or ResultPacket;
- replace the ContextCapsule pinned to an active Run;
- regenerate Markdown, Obsidian, or Notion automatically.

The graph remains a rebuildable projection. Git and GraphDB are optional and are not needed for refresh identity, ancestry, or recovery.

## Changed-file reuse boundary

Incremental means semantic analysis reuse, not trusting timestamps or watcher hints. Every eligible path is rediscovered, every eligible file is read, and its raw bytes are SHA-256 hashed under the same limits as `repository.scan.v1`.

Prior analysis is reused only when all of these match the digest-verified previous scan:

- normalized relative path;
- raw-byte digest;
- byte length;
- classification;
- language;
- repository-scan and source-analysis protocol versions.

Changed and added files are analyzed with the JavaScript reference semantics. Removed paths are detected from the complete before/after path sets. The final `RepositoryScanResult` uses the existing `repository.scan.v1` schema and identity, so a conforming full scan and incremental scan produce the same result, result digest, semantic graph, and World Model inputs.

Reuse counts, analyzed paths, backend name, and execution mode are operational diagnostics. They do not participate in repository-scan, World Model, SourceSnapshot, GraphSnapshot, ContextCapsule, request, or receipt semantic identity.

## Request contract

`IncrementalRefreshRequest` binds:

- project identity;
- exact base World Model and SourceSnapshot identities;
- trigger kind and sorted evidence identities;
- either discovered changes or an exact sorted changed-path expectation;
- optional explicit additional SourceSnapshot parents;
- false instruction, promotion, and canon-mutation authority.

The active CLI emits `trigger.kind: manual`. The protocol reserves `filesystem`, `ci`, `change-set`, and `runtime-observation` for later verified trigger adapters. Reserving a kind does not claim that its adapter exists.

An exact changed-path expectation fails before any World Model pointer mutation when the observed added, changed, and removed path union differs.

## Snapshot and revision ancestry

When no observed or canonical input changed and no new explicit parent was supplied, refresh records an `unchanged` receipt and keeps the current World Model and SourceSnapshot identities.

When a refresh is required:

- the verified current SourceSnapshot becomes a parent automatically;
- optional explicit additional parents are sorted and deduplicated;
- unchanged logical entities keep their existing revision identity and parent set;
- changed logical entities create a new revision whose parent is the previous current revision;
- new entities start with no revision parent;
- removed entities are absent from the next current projection but remain addressable in prior immutable snapshots.

This supports multiple-parent DAG shape without implementing automatic merge or conflict resolution.

## Active execution drift

An active Run is not stopped or mutated by refresh. Its Run record, ExecutionContract, WholePlanSnapshot, and ContextCapsule remain fixed. The receipt records:

- Run, plan, contract, and Capsule identities;
- the Capsule-pinned SourceSnapshot when present;
- the refreshed SourceSnapshot;
- whether drift exists;
- the required HEAD choice: continue with pinned inputs, recompile, revise, or cancel.

A pending ResultPacket likewise remains frozen for Fresh HEAD review. Refresh evidence may inform review, but cannot rewrite the result or its accepted execution inputs.

## Immutable artifacts

The local reference implementation stores:

```text
.head/refresh/requests/incremental-refresh-request-*.json
.head/refresh/receipts/incremental-refresh-receipt-*.json
.head/refresh/current.json
```

Requests and receipts are content-derived immutable artifacts. The current file is a digest-verified replaceable pointer. A later full index or refresh can make the latest receipt stale without invalidating its historical evidence.

## CLI and MCP

```powershell
node scripts/head.mjs world-refresh <project>
node scripts/head.mjs world-refresh <project> --expect-changed src/a.mjs,src/b.mjs
node scripts/head.mjs world-refresh-status <project>
node scripts/head.mjs world-refresh-read <project> --receipt incremental-refresh-receipt-<24-hex>
```

`--trigger-evidence` adds sorted evidence identities. `--parent-snapshot` declares additional SourceSnapshot parents; it does not request or perform a merge.

Read-only MCP exposes:

- `head_incremental_refresh_status`;
- `head_incremental_refresh_receipt`.

MCP does not expose refresh mutation.

## Failure policy

Refresh fails closed on:

- missing, stale, tampered, or mismatched base artifacts;
- repository-scan request, response, result, or digest mismatch;
- exact changed-path expectation mismatch;
- invalid path or parent identities;
- World Model preview drift or concurrent pointer conflict;
- graph projection failure or semantic divergence;
- request, receipt, or pointer digest mismatch;
- active Run state that disagrees with its Run or Capsule artifacts.

The existing verified World Model pointer remains authoritative for current derived state when validation fails before pointer advancement.

## Deferred next stage

The next stage is a provider-neutral debounced trigger queue. It must coalesce bounded filesystem or CI events into this same request contract, rescan rather than trust event payloads, enforce single-writer pointer transitions, record dropped/coalesced trigger evidence, and never regenerate documents until refresh succeeds. Automatic document regeneration, remote GraphDB refresh, and bidirectional document synchronization remain later stages.
