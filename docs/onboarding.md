# Project onboarding

Read [`architecture.md`](architecture.md) and
[`authority-plane-contract.md`](authority-plane-contract.md) before changing
this contract. Onboarding bootstraps product authority; it does not grant
authority to repository structure, model inference, Git, GraphDB, a validation
fixture, or a provider conversation.

## State and authority

Initialization now creates:

- an immutable project-scoped `HeadSession` record under `.head/sessions/records/`;
- a digest-verified `.head/onboarding/current.json` state pointer;
- an immutable local-default `OnboardingStorageSelection`;
- the empty user-owned `.head/context/product-model.json` canon.

The HEAD Session identity is independent from Codex, OpenCode, and other provider conversation IDs. Older initialized projects report `migration_required` through read-only inspection. The next mutating onboarding command creates the missing Session record, local storage selection, and state pointer while preserving the existing Session ID and Product Model identity.

State-pointer protocol `0.2.0` names the most recent decision as
`latestReviewDecisionId`. Digest-valid `0.1.0` pointers whose compatibility field
is `reviewDecisionId` remain readable and are rewritten only by a later explicit
state transition. A successor candidate separately names the `revise` decision
that produced it as `producerReviewDecisionId`; the producer and latest review
are intentionally different after that successor is accepted or rejected.

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

Candidate protocol `0.3.0` derives candidate-set identity from project, Session, mode, exact SourceSnapshot, Product Model input, candidates, Evidence, Unknowns, ancestry, producer ReviewDecision, and producer policy. It deliberately excludes the derived World Model ID so rebuilding the same evidence after rejection produces the same candidate identity instead of coupling authority review to a materialized-view pointer. Digest-valid `0.1.0` and `0.2.0` candidate sets remain readable; their legacy `reviewDecisionId` is interpreted only as the successor-producing review, never as the latest review of that successor.

## Public initialize and resume path

The preferred human-facing path is the bundled `head-agent-onboarding` Skill
inside a Codex or OpenCode conversation. It first calls the read-only
`head_onboarding_guide` tool, asks only for unresolved material choices, and
then invokes the same Core through typed MCP operations:

- `head_project_initialize_or_resume` for idempotent project and HEAD Session
  composition;
- `head_onboarding_review` for an explicit evidence-linked candidate decision;
- `head_markdown_projection_build` for a derived, recoverable document view.

The Skill does not create a second onboarding protocol. It cannot infer a user
ReviewDecision, widen source scope, or persist GraphDB credentials. If MCP is
unavailable, the CLI below is the equivalent recovery and automation surface.

The primary public command composes project creation or verification,
installation-projection convergence, and onboarding start or resume:

```powershell
node scripts/head.mjs init C:\path\to\project --runtime claude,codex,opencode --input .\onboarding.json
node scripts/head.mjs resume C:\path\to\project --runtime claude,codex,opencode
```

The first command creates exactly one project-scoped HEAD Session and starts
onboarding. Repetition verifies the existing project/runtime binding. A pending
candidate review or ready Product Canon is returned without rewriting the
onboarding pointer or creating duplicate authority artifacts. After a plugin
upgrade, only drift-free managed OpenCode configuration is converged to the new
verified release path; user-modified or unowned configuration fails closed.

The same path can be invoked during installation:

```powershell
.\scripts\install.ps1 --project C:\path\to\project --runtime claude,codex,opencode --onboarding-input .\onboarding.json
```

## Low-level onboarding restart

Already initialized projects can explicitly restart an `initialized`,
`awaiting-evidence`, or `rejected` onboarding phase with the lower-level command:

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

Supply this object as `sourceScope` inside the public `init --input` document so
the boundary exists before the first index. The low-level `source-scope-set`
command remains available for an initialized project before an explicit
`onboarding-start`, or for a later reviewed rescan. The exact scope identity is
embedded in `RepositoryScanResult` and the World Model source digest. A later
scope change makes the existing index stale; it never edits Product Canon or an
accepted Capsule.

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
node scripts/head.mjs init C:\path\to\project --input .\onboarding-start.json
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

After the first current GraphSnapshot exists, inject both referenced environment variables outside the conversation and restart the host so the plugin process inherits them. The normal conversation path calls `head_graphdb_connection_preflight` first. That exact-child check performs no network request and returns only the configured reference names and their presence booleans; it never returns credential, endpoint, or database values. Once both references are present, the Skill calls `head_graphdb_database_status`, obtains explicit user confirmation, calls `head_graphdb_database_initialize`, obtains a separate remote-write confirmation, and calls `head_graphdb_projection_activate`. These typed MCP operations accept confirmation and exact-target reset evidence but never credential values. The equivalent recovery/automation CLI is `world-graph-remote-database-status`, `world-graph-remote-database-initialize`, and `world-graph-remote-activate`.

Unrelated existing schema is compatible and preserved. Reset is available only for a proven conflict with a HEAD-reserved type and requires `reset_incompatible: true` plus the exact selected database through MCP, or `--reset-incompatible true --confirm-database <exact-selected-name>` through CLI. Activation uploads a verified resumable GraphSnapshot delta, proves complete reconstruction and bounded traversal equality against the local adapter, then advances the remote pointer by exact-predecessor compare-and-swap and persists separate content-addressed activation and sync receipts. `world-graph-remote-status`, `head_graphdb_projection_status`, and `head_graphdb_database_status` report operational state without exposing credential or target values. A failed initialization or activation leaves the complete local graph mirror as the recovery path and cannot promote Product Canon.

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

`revise` produces a new immutable candidate set linked to the prior set and its
producer ReviewDecision. A later acceptance or rejection records a separate
latest ReviewDecision over that successor; the two identities are not required
to match. Additions and removals require this two-review path; they cannot be
introduced and promoted in the same decision. `reject` records all candidates as
rejected and leaves Product Canon unchanged.

```powershell
node scripts/head.mjs onboarding-review C:\path\to\project --input .\onboarding-review.json
node scripts/head.mjs onboarding-review-read C:\path\to\project --review onboarding-review-decision-<24-hex>
```

## Promotion and recovery

Acceptance validates stable keys and references, rejects conflicts, records previous and resulting Product Model hashes, writes immutable Product Model revisions, and rebuilds the World Model with the reviewed source snapshot as an explicit parent. Onboarding becomes `ready` only when the resulting Product Canon identity appears in a current digest-verified temporal GraphSnapshot. A failed rebuild restores the previous Product Canon and World Model pointer; any partial snapshot remains non-current derived evidence.

Later source changes do not erase the historical onboarding decision. Read-only status reports `ready_world_changed` when the current World Model is stale or has advanced beyond the snapshot that completed onboarding; normal World Model refresh and HEAD drift handling must then decide how execution context advances.

The read-only MCP tool `head_onboarding_status` verifies the state pointer, Session record, storage selection, current candidate set, successor-producing ReviewDecision, latest phase-appropriate ReviewDecision, Product Model revisions, Product Canon identity, and World Model freshness. For a review-pending successor the producer is also the latest decision; for `ready` or `rejected`, the latest decision must directly review the current successor and carry the matching acceptance or rejection disposition. The separate `head_onboarding_review` transaction accepts only an explicit user-authored disposition against the exact current candidate-set identity and delegates every promotion check to Core.

## Temporal graph projection

World Model `0.13.0` continues to load bounded immutable onboarding artifacts and verify every nested content identity before projecting them through onboarding projection protocol `0.1.0` into P4 temporal provenance protocol `0.10.0`. Candidate sets connect to exact source evidence, candidates connect to Evidence and separate proposed product-concept references, and ReviewDecisions preserve accepted, rejected, revised, and promotion outcomes. A revise decision has an explicit `PRODUCES` edge to its successor candidate set; a later accepted decision separately connects to immutable previous/resulting ProductModelRevision receipts, and the resulting receipt links back to the promoted candidate identities.

This graph is an audit and traversal projection, not the decision source. All projected node and edge instruction/promotion flags are false, even when the source ReviewDecision records the user's promotion authority. Normal traversal hides CandidateSet, candidate, Evidence, Unknown, and proposed-concept nodes. A user can explicitly inspect them with `world-temporal --include-candidates true` or MCP `include_unreviewed_candidates: true`; the Context Compiler never enables that option. Reviewed decision and ProductModelRevision receipts remain available in normal reviewed traversal.

Run the dependency-free verifier with:

```powershell
npm run verify:onboarding
```

It covers existing code, a new-project brief, empty evidence, revision followed by acceptance, selection, or rejection, phase-aware producer/latest review lineage, deterministic restart, candidate/review/promotion graph projection, default candidate exclusion, explicit candidate traversal, graph and artifact tampering, pre-existing canon, stale source, secret rejection, legacy migration, read-only status MCP, and operation without Git, GraphDB, or a Go binary. `npm run verify:conversational-onboarding` separately proves the typed conversation-native `revise -> guide -> accept -> guide` vertical.

## Explicitly deferred

- an executed live prepared-query evaluation, compare-and-swap publication, and non-ArcadeDB transports;
- dedicated imported-backlog connectors beyond an explicit structured brief;
- general relationship promotion beyond the separate Feature/code/test mapping review scope;
- automatic semantic promotion, document synchronization, and merge/conflict resolution.
