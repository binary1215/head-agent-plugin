# Temporal provenance GraphSnapshot alpha

Read [`architecture.md`](architecture.md) and
[`authority-plane-contract.md`](authority-plane-contract.md) before changing
this plane.

## Purpose and authority

The temporal provenance graph connects user-owned product intent, immutable onboarding review history, and observed repository state across time without making Git or GraphDB a product prerequisite. It is a deterministic, rebuildable `GraphSnapshot` derived from validated Product Canon, immutable onboarding artifacts, the current supported source scan, and explicit parent identities. It is evidence for Context Compiler traversal; storing canon, candidate, or review projections in the graph does not make the graph project canon, instruction authority, or promotion authority.

The graph builder consumes only provider-neutral inputs:

- project identity;
- normalized `.head/context/product-model.json` content and its evidence identity;
- digest-verified onboarding artifacts, FeatureMappingCandidateSets and mapping ReviewDecisions, provider-neutral ChangeSets with change-impact review artifacts, Product Operating Loop artifacts, and optional immutable VCS evidence attachments;
- normalized file paths, SHA-256 content digests, classifications, languages, and extracted symbols;
- zero-or-more explicit parent `SourceSnapshot` identities;
- optional zero-or-more parent Revision identities keyed by stable logical entity identity.

Git commits, branches, tags, GraphDB record IDs, provider session IDs, document-provider page IDs, observation timestamps, and line locations used only as Evidence are excluded from required logical entity and ChangeSet identity. The enclosing World Model may separately contain optional Git history. The temporal GraphSnapshot consumes no live Git state; it consumes only a separately persisted and digest-verified `VcsEvidence` attachment when one exists.

## Logical entities and immutable revisions

Temporal provenance protocol `0.10.0` materializes a P4 rebuildable relation and retrieval index under the [`AuthorityPlaneContract`](authority-plane-contract.md). Digest-valid `0.9.0` graphs remain readable; new graphs rename the successor creator property to `producerReviewDecisionId` and project the creator as an explicit relation:

- stable product logical entities: `FeatureGroup`, `Capability`, `Feature`, `Requirement`, `Constraint`, and `Decision`;
- immutable product states: the corresponding `*Revision` kinds;
- stable implementation logical entities: `Repository`, `File`, `Symbol`, and `Test`;
- immutable implementation states: `FileRevision`, `SymbolRevision`, and `TestRevision`;
- temporal roots and external ancestry references: `SourceSnapshot`, `SourceSnapshotReference`, and `RevisionReference`.
- onboarding evidence and review history: `OnboardingCandidateSet`, `OnboardingProductCandidate`, `OnboardingEvidence`, `OnboardingUnknown`, `OnboardingReviewDecision`, `ProductConceptReference`, and `ProductModelRevision`.
- mapping review history: `FeatureMappingCandidateSet`, `FeatureMappingCandidate`, `FeatureMappingEvidence`, `FeatureMappingUnknown`, `FeatureMappingReviewDecision`, `ReviewedRelationship`, and historical `MappingEndpointReference`.
- change lineage: `ChangeSet`, `ChangeRevisionReference`, execution-lineage references, `ChangeImpactCandidateSet`, `ChangeImpactCandidate`, `ChangeImpactUnknown`, `ChangeImpactReviewDecision`, `ReviewedImpact`, and historical product references.
- optional external change evidence: `VcsEvidence` and immutable `GitCommit` observation nodes. These nodes are omitted when no attachment exists and never replace the ChangeSet.
- document review lineage: hidden `DocumentChangeCandidateSet` and `DocumentChangeCandidate` nodes plus normally visible `DocumentChangeReviewDecision`, `DocumentProductModelRevision`, `DocumentChangeApplication`, and historical `DocumentProjectionReference` evidence.
- product operating evidence: `ProductSignal`, `ProductHypothesis`, hidden `ProductInitiativeCandidate` and `ProductFeatureCandidate`, historical `ProductFeatureReference`, explicit `ProductInitiativeReviewDecision`, separate `ReviewedProductInitiative`, and execution-bound `OutcomeObservation` nodes.

Non-persisted `ProductLearningNote` values never enter a GraphSnapshot. A v0.2 Initiative candidate may contain inline reasoning and no Feature resolution; it has no `PROPOSES_TO` edge until review and, when it has no persisted hypothesis references, no `PROPOSES_FROM` edge. Explicit accept review resolves exactly one existing Feature, Feature candidate, or honest gap in the separate reviewed Initiative. The candidate bytes remain unchanged.

Product logical identity derives from project identity, entity kind, and stable user-owned key. Renaming a Feature preserves logical identity while semantic edits create a new FeatureRevision. `File` identity derives from project identity and normalized path. `Symbol` identity derives from its File identity, kind, name, and deterministic same-name occurrence rather than its line number. `Test` identity derives from project identity and path. Revision identities derive from the logical identity, semantic state, and sorted parent Revision identities. A line move therefore preserves the Symbol logical identity while changing its SymbolRevision.

The `SourceSnapshot` identity includes the project, complete sorted current Revision sets, an ancestry-independent state digest, the producer version, and sorted zero-or-more parent SourceSnapshots. Multiple parents are supported from the first schema version. This records a DAG shape only; automatic merge, conflict detection, conflict resolution, and ancestry fetching remain deferred.

## Provenance-complete projection

Every projected node records `nodeId`, `kind`, `authorityClass`, `origin`, sorted `evidenceIds`, `freshness`, producer identity and version, and boolean instruction/promotion authority flags. Snapshot-scoped nodes also record `sourceSnapshotId`; Revision nodes record their logical entity and sorted parent identities.

Every edge records the same authority and provenance surface plus `edgeId`, typed endpoints, and `sourceSnapshotId`. Heuristic Symbol nodes and relations carry numeric confidence. The current implemented relation subset is:

- `CONTAINS`;
- `REALIZES`;
- `GOVERNED_BY`;
- `HAS_REVISION`;
- `CURRENT_REVISION`;
- `PARENT_OF`;
- `DECLARES`;
- `REFERENCES`;
- `PROPOSES_FROM`, `PROPOSES_TO`, and `SUPPORTED_BY`;
- `REVIEWED_BY`, `ACCEPTED_BY`, and `REJECTED_BY`;
- `PRODUCES` and `PROMOTED_FROM`. For onboarding, `revise ReviewDecision -[:PRODUCES]-> successor CandidateSet` is distinct from `accept ReviewDecision -[:PRODUCES]-> ProductModelRevision`.
- reviewed canonical `IMPLEMENTS` and `VERIFIED_BY` edges.
- provider-neutral `CHANGES` and `SUPERSEDES` lineage plus explicitly reviewed `IMPACTS` edges.
- optional `ChangeSet -[:MATERIALIZED_AS]-> VcsEvidence -[:REFERENCES]-> GitCommit` evidence links.
- product learning and observation through `SUPPORTED_BY`, `PROPOSES_FROM`, `PROPOSES_TO`, review/promotion relations, and `OutcomeObservation -[:OBSERVES]-> ChangeSet|ReviewedProductInitiative`.

The verifier rejects digest mismatch, unsupported node or relation types, duplicate identities, nondeterministic ordering, dangling or invalid endpoint kinds, missing provenance, invalid authority flags, invalid confidence, scope mismatch, and direct self-parent cycles.

## Deterministic bounded traversal

`queryTemporalProvenanceGraph` first verifies the complete GraphSnapshot, then constructs a normalized `TraversalQuery`. The query records:

- node-kind, relation, authority-class, and freshness allowlists;
- minimum confidence;
- default exclusion of CandidateSet, candidate, Evidence, Unknown, ProductConceptReference, ProductInitiativeCandidate, and ProductFeatureCandidate nodes, with an explicit `includeUnreviewedCandidates` opt-in;
- maximum depth, node count, and edge count;
- anchor identities and deterministic ordering.

The result records graph, query, and result IDs and hashes; selected nodes and edges; inclusion reasons; exclusion counts; and truncation. A backend may accelerate this algorithm later but may not widen the allowlists, reorder semantic results, admit stale evidence, or alter the digest.

## CLI and MCP

```text
node scripts/head.mjs world-index <project> --parent-snapshot <id,id>
node scripts/head.mjs world-index <project> --revision-parents <json-file>
node scripts/head.mjs world-temporal <project> --query <text> --kind File,FileRevision --relations HAS_REVISION,CURRENT_REVISION --depth 1 --limit 100 --edge-limit 200
node scripts/head.mjs world-temporal <project> --query <candidate-id> --kind FeatureMappingCandidate,FeatureMappingEvidence --include-candidates true --depth 1 --limit 100 --edge-limit 200
node scripts/head.mjs world-temporal <project> --query <change-set-id> --relations CHANGES,IMPACTS,SUPERSEDES --depth 3 --limit 200 --edge-limit 400
node scripts/head.mjs world-temporal <project> --query <change-set-id> --relations MATERIALIZED_AS,REFERENCES --depth 2 --limit 200 --edge-limit 400
```

`--revision-parents` reads a JSON object whose keys are current logical entity IDs and whose values are arrays of parent Revision IDs. The read-only MCP tool `head_temporal_graph` exposes the same bounded traversal through `include_unreviewed_candidates`. Both reject a stale World Model. ReviewDecision and ProductModelRevision receipts remain visible under normal reviewed traversal; the unreviewed candidate surface requires explicit opt-in and still has no authority effect.

The Context Compiler performs bounded per-file temporal expansion through `GraphProjectionAdapter` and records the GraphSnapshot, SourceSnapshot, TraversalQuery, and traversal result digests in included repository candidates. Local JSON and in-memory adapters must return the exact reference result; absence falls back to the embedded recoverable graph with disclosure, while stale or conflicting projections fail closed. Adapter identity remains outside Capsule identity. See [`graph-projection-adapter.md`](graph-projection-adapter.md).

The active deterministic Markdown renderer consumes this verified graph through `DocumentProjectionAdapter` after indexing. It preserves canonical edge direction, links relation endpoints to node pages, and records the exact GraphSnapshot and SourceSnapshot identities. Generated pages are human views only and are never traversed back into Context Compiler input. Edited pages become non-authoritative `DocumentChangeCandidateSet` evidence. Explicit reviews are projected into a later child graph; an application receipt binds the actual application outcome, then a subsequent audit child graph projects that receipt. This two-stage boundary avoids a GraphSnapshot hash depending on a receipt that names the same GraphSnapshot. Context Compiler does not opt into the document candidate surface. See [`document-projection-adapter.md`](document-projection-adapter.md) and [`document-change-review.md`](document-change-review.md).

## Deferred boundaries

This alpha does not yet infer commit-to-ChangeSet matching, project complete execution lineage, model conformance, or promote general candidates beyond the implemented review scopes. It implements local/in-memory GraphProjectionAdapter and DocumentProjectionAdapter conformance boundaries but not a remote GraphDB, Obsidian, or Notion backend. Explicit document-candidate review/application and later audit projection are active but never infer product meaning from prose. The system still does not infer parent revisions or ChangeSet ancestry, perform merges, automatically promote candidates, or treat current-state pointers as canon.
