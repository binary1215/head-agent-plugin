# Review-gated Feature mapping

Read [`architecture.md`](architecture.md) and
[`authority-plane-contract.md`](authority-plane-contract.md) before changing
this authority boundary.

## Contract

Feature mapping protocol `0.1.0` connects authoritative `Feature` and `Capability` concepts to observed `File`, `Symbol`, and `Test` entities without allowing code analysis to invent an approved product relationship.

The canonical directions are:

```text
File or Symbol -[:IMPLEMENTS]-> Feature or Capability
Feature or Capability -[:VERIFIED_BY]-> Test
```

Automatic inference creates only an immutable `FeatureMappingCandidateSet`. Every `FeatureMappingCandidate` records the exact proposed endpoints and revisions, source `GraphSnapshot`/`SourceSnapshot`, producer and version, bounded confidence, explanation, and content-addressed Evidence. Candidate and Evidence records have false instruction and promotion authority.

An explicit user-authored mapping `ReviewDecision` may accept all candidates, accept a named selection, or reject the batch. Acceptance does not mutate a candidate. It creates a separate `ReviewedRelationship` receipt linked to the candidate by `PROMOTED_FROM` and to the decision by `PRODUCES`, then materializes the reviewed canonical `IMPLEMENTS` or `VERIFIED_BY` edge. Rejection records `REJECTED_BY` and creates no canonical mapping edge.

Product Canon is not modified by mapping review. Review is rejected if repository evidence, Product Canon, the current candidate set, or any content digest drifted after inference, or while a Run is active or awaiting review.

## Commands

```text
node scripts/head.mjs feature-mapping-start <project>
node scripts/head.mjs feature-mapping-status <project>
node scripts/head.mjs feature-mapping-candidates <project> --candidate-set <feature-mapping-candidates-id>
node scripts/head.mjs feature-mapping-review <project> --input <mapping-review.json>
node scripts/head.mjs feature-mapping-review-read <project> --review <feature-mapping-review-decision-id>
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

`accept-all` ignores `acceptedCandidateIds`; `reject` accepts none. The CLI is the mutation surface. MCP exposes only `head_feature_mapping_status`, and normal temporal traversal excludes the unreviewed candidate surface unless `include_unreviewed_candidates` is explicitly enabled.

## Storage and projection

The local conformance path stores:

```text
.head/feature-mappings/current.json
.head/feature-mappings/candidate-sets/feature-mapping-candidates-*.json
.head/feature-mappings/review-decisions/feature-mapping-review-decision-*.json
```

Candidate sets and ReviewDecisions are immutable, digest-verified artifacts. `current.json` is only a digest-verified workflow pointer. The temporal graph and World Model remain rebuildable projections; Git and GraphDB are optional and do not participate in mapping authority.

If a previously reviewed endpoint disappears, the historical receipt remains with stale freshness and the current canonical edge is omitted. A later inference and explicit review is required to establish a new current mapping.

## Inference boundary

The initial inference is deliberately conservative and bounded. It compares normalized terms from authoritative Feature/Capability keys, names, and descriptions with current repository paths and observed symbol names. It emits a maximum bounded set and explicit Unknowns when no match exists. Lexical overlap is evidence, never proof.

AST-accurate semantic mapping, change-impact candidates, bulk user edits/revision batches, automatic mapping refresh, and general relationship-promotion policy remain deferred.
