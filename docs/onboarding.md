# Project onboarding

Read [`ULTIMATE_GOAL.md`](ULTIMATE_GOAL.md) before changing this contract. Onboarding bootstraps product authority; it does not grant authority to repository structure, model inference, Git, GraphDB, or a provider conversation.

## State and authority

Initialization now creates:

- an immutable project-scoped `HeadSession` record under `.head/sessions/records/`;
- a digest-verified `.head/onboarding/current.json` state pointer;
- an immutable local-default `OnboardingStorageSelection`;
- the empty user-owned `.head/context/product-model.json` canon.

The HEAD Session identity is independent from Codex, OpenCode, and other provider conversation IDs. Older initialized projects report `migration_required` through read-only inspection. The next mutating onboarding command creates the missing Session record, local storage selection, and state pointer while preserving the existing Session ID and Product Model identity.

The state machine is:

```text
initialized
  -> explicit World Model index
  -> awaiting-review | awaiting-evidence | ready(existing canon)
  -> revise -> successor immutable candidate set -> awaiting-review
  -> reject -> rejected
  -> accept-all | accept-selection
       -> new Product Model revision
       -> new child SourceSnapshot and verified GraphSnapshot
       -> ready
```

Repository and brief analysis creates `OnboardingCandidateSet` evidence with `instructionAuthority: false` and `promotionAuthority: false`. Only an explicit `ReviewDecision` with `decisionScope: "product-canon-bootstrap"` may write Product Canon. A candidate is never mutated or relabeled: revision creates a successor candidate with a new identity, and acceptance creates separate canon plus an immutable decision receipt.

Candidate protocol `0.2.0` derives candidate-set identity from project, Session, mode, exact SourceSnapshot, Product Model input, candidates, Evidence, Unknowns, ancestry, and producer policy. It deliberately excludes the derived World Model ID so rebuilding the same evidence after rejection produces the same candidate identity instead of coupling authority review to a materialized-view pointer.

## Starting onboarding

Existing projects can use local storage without an input file:

```powershell
node scripts/head.mjs onboarding-start C:\path\to\project
node scripts/head.mjs onboarding-status C:\path\to\project
```

An existing project indexes code and documentation first. Inference `0.3.0` ranks at most 24 unique supported source/test symbols and clusters them into at most 16 bounded behavior concepts; the complete candidate set remains capped at 200 candidates, 250 evidence records, and 100 Unknowns. Public source functions and action-oriented names rank ahead of test doubles, fixtures, serialization helpers, generic lifecycle methods, logging setup, UI close/click handlers, and alphabetical accidents. Related symbols share one Capability candidate and one representative concrete Feature candidate instead of producing a duplicate Capability/Feature pair for every function. This clustering improves the review batch but does not turn inference into Product Canon. A README or product-doc heading may propose a FeatureGroup, but instruction files and directory names cannot define taxonomy, and an inferred group is not automatically attached to Features. Missing, excluded, or insufficient evidence remains an explicit Unknown.

### Repository source scope

Before indexing, the user may persist a project-relative observation boundary. Empty `includeRoots` means the whole eligible repository; `excludeRoots` always wins. Roots are normalized paths, not globs, and the selection is content-derived evidence with no instruction or promotion authority.

```json
{
  "includeRoots": [],
  "excludeRoots": [".omo", "bundled-third-party", "generated-copy"]
}
```

```powershell
node scripts/head.mjs source-scope-set C:\path\to\project --input .\source-scope.json
node scripts/head.mjs source-scope-status C:\path\to\project
node scripts/head.mjs onboarding-start C:\path\to\project
```

The same object may be supplied as `sourceScope` inside `onboarding-start` input. The exact scope identity is embedded in `RepositoryScanResult` and the World Model source digest. A later scope change makes the existing index stale; it never edits Product Canon or an accepted Capsule.

A new-project brief uses the Product Model entity schema while remaining a candidate until review:

```json
{
  "mode": "new",
  "brief": {
    "schemaVersion": 1,
    "name": "Message service",
    "summary": "Deliver messages with explicit verification.",
    "featureGroups": [
      {
        "key": "group:communication",
        "name": "Communication",
        "description": "User-facing communication.",
        "parentFeatureGroupKeys": []
      }
    ],
    "capabilities": [
      {
        "key": "capability:delivery",
        "name": "Delivery",
        "description": "Deliver one accepted message."
      }
    ],
    "features": [
      {
        "key": "feature:direct-message",
        "name": "Direct message",
        "description": "Send one message to one recipient.",
        "featureGroupKeys": ["group:communication"],
        "capabilityKeys": ["capability:delivery"],
        "governedBy": []
      }
    ],
    "requirements": [],
    "constraints": [],
    "decisions": []
  }
}
```

```powershell
node scripts/head.mjs onboarding-start C:\path\to\project --input .\onboarding-start.json
```

A project whose Product Canon already contains approved entities skips candidate bootstrap, still indexes implementation evidence, verifies the Product Model projection, and enters `ready`.

## Storage selection

Local materialization is complete and is the default. ArcadeDB can be selected without making it a prerequisite:

```json
{
  "mode": "existing",
  "storage": {
    "mode": "graphdb",
    "endpoint": "https://graph.example.test",
    "database": "head",
    "secretReferenceNames": {
      "username": "HEAD_GRAPHDB_USERNAME",
      "password": "HEAD_GRAPHDB_PASSWORD"
    }
  }
}
```

Only endpoint, database, and environment-style secret-reference names are persisted. Embedded URL credentials, password/token fields, and credential values are rejected. The immutable selection records its status at selection time as `pending-unverified-adapter`, and onboarding continues through local JSON with explicit disclosure.

After the first current GraphSnapshot exists, export both referenced environment variables, run `world-graph-remote-database-status`, initialize a missing database with `world-graph-remote-database-initialize`, and then explicitly activate the remote projection with `world-graph-remote-activate`. Unrelated existing schema is compatible and preserved. Reset is available only for a proven conflict with a HEAD-reserved type and requires `--reset-incompatible true --confirm-database <exact-selected-name>`. Activation writes and re-reads the snapshot, proves bounded traversal equality against the local adapter, and persists a separate content-addressed activation receipt. `world-graph-remote-status`, `head_graphdb_projection_status`, and `head_graphdb_database_status` report operational state without exposing credential or target values. A failed initialization or activation leaves the complete local graph mirror as the recovery path and cannot promote Product Canon.

## Batch review

Read the current candidate set with `onboarding-status` or `onboarding-candidates`. Review input must name the exact current `candidateSetId`; stale source, Product Canon drift, candidate tampering, or a different set fails closed.

Accept all candidates:

```json
{
  "candidateSetId": "onboarding-candidates-<24-hex>",
  "disposition": "accept-all",
  "rationale": "Adopt the reviewed bootstrap batch."
}
```

Accept a dependency-complete selection:

```json
{
  "candidateSetId": "onboarding-candidates-<24-hex>",
  "disposition": "accept-selection",
  "acceptedCandidateIds": ["onboarding-candidate-<24-hex>"],
  "rationale": "Adopt only the reviewed capability."
}
```

Revise candidates without changing canon:

```json
{
  "candidateSetId": "onboarding-candidates-<24-hex>",
  "disposition": "revise",
  "userEdits": [
    {
      "candidateId": "onboarding-candidate-<24-hex>",
      "entity": {
        "key": "capability:delivery",
        "name": "Verified delivery",
        "description": "Deliver and verify one accepted message."
      }
    }
  ],
  "addedEntities": [],
  "removedCandidateIds": [],
  "rationale": "Use reviewed product language before promotion."
}
```

`revise` produces a new immutable candidate set linked to the prior set and ReviewDecision. Additions and removals require this two-review path; they cannot be introduced and promoted in the same decision. `reject` records all candidates as rejected and leaves Product Canon unchanged.

```powershell
node scripts/head.mjs onboarding-review C:\path\to\project --input .\onboarding-review.json
node scripts/head.mjs onboarding-review-read C:\path\to\project --review onboarding-review-decision-<24-hex>
```

## Promotion and recovery

Acceptance validates stable keys and references, rejects conflicts, records previous and resulting Product Model hashes, writes immutable Product Model revisions, and rebuilds the World Model with the reviewed source snapshot as an explicit parent. Onboarding becomes `ready` only when the resulting Product Canon identity appears in a current digest-verified temporal GraphSnapshot. A failed rebuild restores the previous Product Canon and World Model pointer; any partial snapshot remains non-current derived evidence.

Later source changes do not erase the historical onboarding decision. Read-only status reports `ready_world_changed` when the current World Model is stale or has advanced beyond the snapshot that completed onboarding; normal World Model refresh and HEAD drift handling must then decide how execution context advances.

The read-only MCP tool `head_onboarding_status` verifies the state pointer, Session record, storage selection, current candidate set, linked ReviewDecision, Product Model revisions, Product Canon identity, and World Model freshness. It cannot review or promote candidates.

## Temporal graph projection

World Model `0.10.0` continues to load bounded immutable onboarding artifacts and verify every nested content identity before projecting them through onboarding projection protocol `0.1.0` into temporal provenance protocol `0.7.0`. Candidate sets connect to exact source evidence, candidates connect to Evidence and separate proposed product-concept references, and ReviewDecisions preserve accepted, rejected, revised, and promotion outcomes. Accepted decisions connect to immutable previous/resulting ProductModelRevision receipts; the resulting receipt links back to the promoted candidate identities.

This graph is an audit and traversal projection, not the decision source. All projected node and edge instruction/promotion flags are false, even when the source ReviewDecision records the user's promotion authority. Normal traversal hides CandidateSet, candidate, Evidence, Unknown, and proposed-concept nodes. A user can explicitly inspect them with `world-temporal --include-candidates true` or MCP `include_unreviewed_candidates: true`; the Context Compiler never enables that option. Reviewed decision and ProductModelRevision receipts remain available in normal reviewed traversal.

Run the dependency-free verifier with:

```powershell
npm run verify:onboarding
```

It covers existing code, a new-project brief, empty evidence, revision, rejection, selection, deterministic restart, candidate/review/promotion graph projection, default candidate exclusion, explicit candidate traversal, graph and artifact tampering, pre-existing canon, stale source, secret rejection, legacy migration, read-only MCP, and operation without Git, GraphDB, or a Go binary.

## Explicitly deferred

- an executed live prepared-query evaluation, compare-and-swap publication, and non-ArcadeDB transports;
- dedicated imported-backlog connectors beyond an explicit structured brief;
- general relationship promotion beyond the separate Feature/code/test mapping review scope;
- automatic semantic promotion, document synchronization, and merge/conflict resolution.
