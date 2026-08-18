# Temporal provenance GraphSnapshot alpha

Read [`ULTIMATE_GOAL.md`](ULTIMATE_GOAL.md) before changing this plane.

## Purpose and authority

The temporal provenance graph connects user-owned product intent, immutable onboarding review history, and observed repository state across time without making Git or GraphDB a product prerequisite. It is a deterministic, rebuildable `GraphSnapshot` derived from validated Product Canon, immutable onboarding artifacts, the current supported source scan, and explicit parent identities. It is evidence for Context Compiler traversal; storing canon, candidate, or review projections in the graph does not make the graph project canon, instruction authority, or promotion authority.

The graph builder consumes only provider-neutral inputs:

- project identity;
- normalized `.head/context/product-model.json` content and its evidence identity;
- digest-verified onboarding artifacts plus FeatureMappingCandidateSets and mapping ReviewDecisions;
- normalized file paths, SHA-256 content digests, classifications, languages, and extracted symbols;
- zero-or-more explicit parent `SourceSnapshot` identities;
- optional zero-or-more parent Revision identities keyed by stable logical entity identity.

Git commits, branches, tags, GraphDB record IDs, provider session IDs, document-provider page IDs, observation timestamps, and line locations used only as Evidence are excluded from logical entity identity. The enclosing World Model may separately contain optional Git evidence, but the temporal GraphSnapshot does not consume it.

## Logical entities and immutable revisions

Temporal provenance protocol `0.4.0` materializes:

- stable product logical entities: `FeatureGroup`, `Capability`, `Feature`, `Requirement`, `Constraint`, and `Decision`;
- immutable product states: the corresponding `*Revision` kinds;
- stable implementation logical entities: `Repository`, `File`, `Symbol`, and `Test`;
- immutable implementation states: `FileRevision`, `SymbolRevision`, and `TestRevision`;
- temporal roots and external ancestry references: `SourceSnapshot`, `SourceSnapshotReference`, and `RevisionReference`.
- onboarding evidence and review history: `OnboardingCandidateSet`, `OnboardingProductCandidate`, `OnboardingEvidence`, `OnboardingUnknown`, `OnboardingReviewDecision`, `ProductConceptReference`, and `ProductModelRevision`.
- mapping review history: `FeatureMappingCandidateSet`, `FeatureMappingCandidate`, `FeatureMappingEvidence`, `FeatureMappingUnknown`, `FeatureMappingReviewDecision`, `ReviewedRelationship`, and historical `MappingEndpointReference`.

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
- `PRODUCES` and `PROMOTED_FROM`.
- reviewed canonical `IMPLEMENTS` and `VERIFIED_BY` edges.

The verifier rejects digest mismatch, unsupported node or relation types, duplicate identities, nondeterministic ordering, dangling or invalid endpoint kinds, missing provenance, invalid authority flags, invalid confidence, scope mismatch, and direct self-parent cycles.

## Deterministic bounded traversal

`queryTemporalProvenanceGraph` first verifies the complete GraphSnapshot, then constructs a normalized `TraversalQuery`. The query records:

- node-kind, relation, authority-class, and freshness allowlists;
- minimum confidence;
- default exclusion of CandidateSet, candidate, Evidence, Unknown, and ProductConceptReference nodes, with an explicit `includeUnreviewedCandidates` opt-in;
- maximum depth, node count, and edge count;
- anchor identities and deterministic ordering.

The result records graph, query, and result IDs and hashes; selected nodes and edges; inclusion reasons; exclusion counts; and truncation. A backend may accelerate this algorithm later but may not widen the allowlists, reorder semantic results, admit stale evidence, or alter the digest.

## CLI and MCP

```text
node scripts/head.mjs world-index <project> --parent-snapshot <id,id>
node scripts/head.mjs world-index <project> --revision-parents <json-file>
node scripts/head.mjs world-temporal <project> --query <text> --kind File,FileRevision --relations HAS_REVISION,CURRENT_REVISION --depth 1 --limit 100 --edge-limit 200
node scripts/head.mjs world-temporal <project> --query <candidate-id> --kind FeatureMappingCandidate,FeatureMappingEvidence --include-candidates true --depth 1 --limit 100 --edge-limit 200
```

`--revision-parents` reads a JSON object whose keys are current logical entity IDs and whose values are arrays of parent Revision IDs. The read-only MCP tool `head_temporal_graph` exposes the same bounded traversal through `include_unreviewed_candidates`. Both reject a stale World Model. ReviewDecision and ProductModelRevision receipts remain visible under normal reviewed traversal; the unreviewed candidate surface requires explicit opt-in and still has no authority effect.

The Context Compiler performs a bounded per-file temporal expansion and records the GraphSnapshot, SourceSnapshot, TraversalQuery, and traversal result digests in included repository candidates. Stale temporal evidence is excluded with the rest of the stale World Model.

## Deferred boundaries

This alpha does not yet implement ChangeSet, VcsEvidence, execution-lineage, conformance, general candidate-promotion, or document-projection nodes and relations. It does not implement a `GraphProjectionAdapter` or GraphDB backend. It also does not infer parent revisions, perform merges, automatically promote mapping candidates, infer product meaning outside the explicit onboarding ReviewDecision contract, or treat current-state pointers as canon.
