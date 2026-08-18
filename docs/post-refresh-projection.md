# Post-refresh Markdown projection policy

Status: active alpha contract

Protocol version: `0.1.0`

Related protocols:

- incremental refresh: `0.2.0` (`0.1.0` receipts remain readable);
- refresh trigger: `0.2.0` (`0.1.0` batches and deliveries remain readable);
- `DocumentProjectionAdapter`: `0.1.0`.

## Purpose

`PostRefreshProjectionPolicy` controls one operational choice: whether a verified observed-state refresh may regenerate the deterministic Markdown projection after the new World Model and GraphSnapshot have been committed. It is not Product Canon, a graph fact, an instruction source, or promotion authority.

The effective default is `manual`. Automatic generation begins only after an explicit user command records an immutable `automatic` policy and advances the policy pointer:

```json
{
  "mode": "automatic"
}
```

Policy artifacts are content-derived. Re-selecting the same mode produces the same policy identity. The mutable pointer selects the current operational policy but never changes the identity of a World Model, GraphSnapshot, DocumentProjection, ContextCapsule, ChangeSet, or execution-lineage artifact.

## Ordered refresh boundary

The automatic path remains downstream from verified observed-state reconstruction:

```text
exclusive project World Model writer lease
  -> read effective post-refresh policy
  -> inspect the published Markdown view against the base GraphSnapshot
  -> capture edited pages as immutable candidates when safe
  -> execute and verify incremental refresh
  -> atomically advance the World Model and graph projection pointers
  -> apply or defer the Markdown projection policy
  -> persist PostRefreshProjectionReceipt
```

The incremental refresh receipt records that its core does not regenerate documents. The separate post-refresh receipt links the exact refresh request and receipt, policy, before/after World Model, SourceSnapshot and GraphSnapshot identities, resulting DocumentProjection, and optional `DocumentChangeCandidateSet`.

## Safety dispositions

The policy produces one of these bounded outcomes:

- `manual-deferred`: the safe default; no document inspection or publication occurs;
- `projected`: a new deterministic projection was published;
- `unchanged`: the current deterministic projection already matches the target graph;
- `blocked-edited-view`: edits were captured against the current base graph and the published view was preserved;
- `blocked-stale-edited-view`: the edited view is already based on an older graph and is preserved for explicit resolution;
- `blocked-unmanaged-view`: Markdown exists without a verified base projection and is preserved;
- `failed`: policy, adapter, projection, or persistence verification failed without changing Product Canon or active execution inputs.

Automatic mode never overwrites edited or unmanaged Markdown. A current edited view is captured before source refresh so its candidate evidence stays anchored to the exact GraphSnapshot that produced the base content. Candidate review and application remain deferred; capture alone grants no authority.

If the policy is digest-invalid, observed-state refresh still proceeds and the post-refresh outcome is `failed`. The invalid policy cannot acquire authority by preventing or altering the verified World Model transition. A projection failure also does not roll the World Model pointer back; it leaves the generated view absent, stale, or modified and records the failure reason.

## Persistence

```text
.head/document-projection/post-refresh/current-policy.json
.head/document-projection/post-refresh/policies/post-refresh-projection-policy-<digest>.json
.head/document-projection/post-refresh/current.json
.head/document-projection/post-refresh/receipts/post-refresh-projection-receipt-<digest>.json
```

No timestamp, PID, adapter path, provider session, Git object, GraphDB record, or document-provider page ID participates in policy or receipt identity.

## CLI

```text
node scripts/head.mjs world-docs-policy-set <project> --input <policy.json>
node scripts/head.mjs world-docs-policy-status <project>
node scripts/head.mjs world-docs-refresh-status <project>
node scripts/head.mjs world-docs-refresh-read <project> --receipt <post-refresh-projection-receipt-id>
```

The setting command accepts only `mode: manual|automatic`. Status and receipt commands are read-only. The existing explicit `world-docs-build`, `world-docs-status`, `world-docs-capture`, and candidate-read commands remain available.

Read-only MCP exposes:

- `head_post_refresh_projection_status`;
- `head_post_refresh_projection_receipt`.

MCP cannot change the policy, trigger refresh, regenerate documents, review candidates, or mutate Canon.

## Authority and optional infrastructure

Every policy and receipt declares false instruction and promotion authority, `canonMutation: none`, and no active-Run mutation. Accepted ContextCapsules and ExecutionContracts remain pinned to their recorded graph identities.

Git and GraphDB are not consulted by this protocol. The local Markdown adapter is the conformance path. A future GraphDB projection refresh may occur before this stage, and future Obsidian or Notion adapters may publish the same semantic projection, but neither is required for local completion.

## Deferred

- `DocumentChangeCandidate` ReviewDecision and application;
- projection of document-review receipts into later GraphSnapshots;
- automatic Obsidian or Notion publication;
- bidirectional document synchronization and conflict resolution;
- background watcher service installation and provider-specific CI webhooks;
- remote GraphDB projection transport.
