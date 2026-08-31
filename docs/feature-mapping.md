# Review-gated Feature mapping

Read [`architecture.md`](architecture.md) and
[`authority-plane-contract.md`](authority-plane-contract.md) before changing
this authority boundary.

## Contract

Feature mapping protocol `0.2.0` connects authoritative `Feature` and `Capability` concepts to observed `File`, `Symbol`, and `Test` entities without allowing Core code analysis to invent either relevance or an approved product relationship.

The canonical directions are:

```text
File or Symbol -[:IMPLEMENTS]-> Feature or Capability
Feature or Capability -[:VERIFIED_BY]-> Test
```

A provider HEAD may propose mappings after reading current project evidence. Core then verifies the proposal schema, exact current endpoint identities and revisions, relationship direction, source and product snapshot bindings, bounded confidence, explanation, and content-addressed Evidence before creating an immutable `FeatureMappingCandidateSet`. Candidate and Evidence records have false instruction and promotion authority. With no semantic proposal, Core records an explicit Unknown and creates no candidates.

An explicit user-authored mapping `ReviewDecision` may accept all candidates, accept a named selection, or reject the batch. Acceptance does not mutate a candidate. It creates a separate `ReviewedRelationship` receipt linked to the candidate by `PROMOTED_FROM` and to the decision by `PRODUCES`, then materializes the reviewed canonical `IMPLEMENTS` or `VERIFIED_BY` edge. Rejection records `REJECTED_BY` and creates no canonical mapping edge.

Product Canon is not modified by mapping review. Review is rejected if repository evidence, Product Canon, the current candidate set, or any content digest drifted after proposal verification, or while a Run is active or awaiting review.

## Commands

```text
node scripts/head.mjs feature-mapping-start <project> --input <semantic-mapping-proposal.json>
node scripts/head.mjs feature-mapping-status <project>
node scripts/head.mjs feature-mapping-candidates <project> --candidate-set <feature-mapping-candidates-id>
node scripts/head.mjs feature-mapping-review <project> --input <mapping-review.json>
node scripts/head.mjs feature-mapping-review-read <project> --review <feature-mapping-review-decision-id>
```

Example semantic proposal input:

```json
{
  "schemaVersion": 1,
  "sourceSnapshotId": "source-snapshot-<24-hex>",
  "productModelId": "product-model-<24-hex>",
  "candidates": [
    {
      "relationshipType": "IMPLEMENTS",
      "sourceNodeId": "symbol-<24-hex>",
      "productNodeId": "feature-<24-hex>",
      "explanation": "The implementation behavior and the approved Feature contract match.",
      "confidence": 0.9
    }
  ]
}
```

Example acceptance input:

```json
{
  "candidateSetId": "feature-mapping-candidates-<24-hex>",
  "disposition": "accept-selection",
  "acceptedCandidateIds": ["feature-mapping-candidate-<24-hex>"],
  "rationale": "Reviewed repository and test evidence supports this product relationship."
}
```

`accept-all` ignores `acceptedCandidateIds`; `reject` accepts none. CLI review and typed MCP `head_feature_mapping_review` call the same Core mutation; MCP additionally requires `confirm_user_review: true`. MCP also exposes `head_feature_mapping_propose` and read-only `head_feature_mapping_status`. Normal temporal traversal excludes the unreviewed candidate surface unless `include_unreviewed_candidates` is explicitly enabled.

## Storage and projection

The local conformance path stores:

```text
.head/feature-mappings/current.json
.head/feature-mappings/candidate-sets/feature-mapping-candidates-*.json
.head/feature-mappings/review-decisions/feature-mapping-review-decision-*.json
```

Candidate sets and ReviewDecisions are immutable, digest-verified artifacts. `current.json` is only a digest-verified workflow pointer. The temporal graph and World Model remain rebuildable projections; Git and GraphDB are optional and do not participate in mapping authority.

If a previously reviewed endpoint disappears, the historical receipt remains with stale freshness and the current canonical edge is omitted. A later semantic proposal and explicit review are required to establish a new current mapping.

## Semantic proposal boundary

Core does not infer product meaning from names, paths, token overlap, or a repository-specific vocabulary. The provider HEAD owns semantic reading and proposes only bounded relationships; Core owns current-evidence verification, deterministic normalization, immutable storage, drift checks, and review gating. An invalid or stale proposal fails closed. There is no lexical fallback.

Provider-neutral live proposal orchestration, change-impact candidates, bulk user edits/revision batches, automatic mapping refresh, and general relationship-promotion policy remain deferred.
