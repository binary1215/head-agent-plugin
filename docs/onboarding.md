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

## Starting onboarding

Existing projects can use local storage without an input file:

```powershell
node scripts/head.mjs onboarding-start C:\path\to\project
node scripts/head.mjs onboarding-status C:\path\to\project
```

An existing project indexes code and documentation first. At most 24 unique supported source/test symbols are used by the heuristic pass; the complete candidate set is capped at 200 candidates, 250 evidence records, and 100 Unknowns. Source and test symbols can propose Capability and Feature candidates. A documentation heading may propose a FeatureGroup; directory names never become FeatureGroup taxonomy. Missing, excluded, or insufficient evidence remains an explicit Unknown.

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

Local materialization is complete and is the default. A future GraphDB adapter can be selected without making it a prerequisite:

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

Only endpoint, database, and environment-style secret-reference names are persisted. Embedded URL credentials, password/token fields, and credential values are rejected. Until a GraphDB adapter passes conformance, the selection records `pending-unverified-adapter` and onboarding continues through local JSON with explicit disclosure.

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

Run the dependency-free verifier with:

```powershell
npm run verify:onboarding
```

It covers existing code, a new-project brief, empty evidence, revision, rejection, selection, deterministic restart, pre-existing canon, stale source, tampering, secret rejection, legacy migration, read-only MCP, and operation without Git, GraphDB, or a Go binary.

## Explicitly deferred

- a verified remote GraphDB adapter;
- dedicated imported-backlog connectors beyond an explicit structured brief;
- GraphSnapshot projection of candidate and promotion-receipt nodes and edges;
- Feature-to-code/test mapping candidates and general relationship promotion;
- automatic semantic promotion, document synchronization, and merge/conflict resolution.
