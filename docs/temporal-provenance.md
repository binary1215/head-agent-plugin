# Temporal provenance GraphSnapshot alpha

Read [`ULTIMATE_GOAL.md`](ULTIMATE_GOAL.md) before changing this plane.

## Purpose and authority

The temporal provenance graph connects observed repository state across time without making Git or GraphDB a product prerequisite. It is a deterministic, rebuildable `GraphSnapshot` derived from the current supported source scan plus explicit parent identities. It is evidence for Context Compiler traversal, not project canon, instruction authority, or promotion authority.

The graph builder consumes only provider-neutral inputs:

- project identity;
- normalized file paths, SHA-256 content digests, classifications, languages, and extracted symbols;
- zero-or-more explicit parent `SourceSnapshot` identities;
- optional zero-or-more parent Revision identities keyed by stable logical entity identity.

Git commits, branches, tags, GraphDB record IDs, provider session IDs, document-provider page IDs, observation timestamps, and line locations used only as Evidence are excluded from logical entity identity. The enclosing World Model may separately contain optional Git evidence, but the temporal GraphSnapshot does not consume it.

## Logical entities and immutable revisions

The active alpha slice materializes:

- stable logical entities: `Repository`, `File`, `Symbol`, and `Test`;
- immutable states: `FileRevision`, `SymbolRevision`, and `TestRevision`;
- temporal roots and external ancestry references: `SourceSnapshot`, `SourceSnapshotReference`, and `RevisionReference`.

`File` identity derives from project identity and normalized path. `Symbol` identity derives from its File identity, kind, name, and deterministic same-name occurrence rather than its line number. `Test` identity derives from project identity and path. Revision identities derive from the logical identity, semantic state, and sorted parent Revision identities. A line move therefore preserves the Symbol logical identity while changing its SymbolRevision.

The `SourceSnapshot` identity includes the project, complete sorted current Revision sets, an ancestry-independent state digest, the producer version, and sorted zero-or-more parent SourceSnapshots. Multiple parents are supported from the first schema version. This records a DAG shape only; automatic merge, conflict detection, conflict resolution, and ancestry fetching remain deferred.

## Provenance-complete projection

Every projected node records `nodeId`, `kind`, `authorityClass`, `origin`, sorted `evidenceIds`, `freshness`, producer identity and version, and boolean instruction/promotion authority flags. Snapshot-scoped nodes also record `sourceSnapshotId`; Revision nodes record their logical entity and sorted parent identities.

Every edge records the same authority and provenance surface plus `edgeId`, typed endpoints, and `sourceSnapshotId`. Heuristic Symbol nodes and relations carry numeric confidence. The current implemented relation subset is:

- `CONTAINS`;
- `HAS_REVISION`;
- `CURRENT_REVISION`;
- `PARENT_OF`;
- `DECLARES`;
- `REFERENCES`.

The verifier rejects digest mismatch, unsupported node or relation types, duplicate identities, nondeterministic ordering, dangling or invalid endpoint kinds, missing provenance, invalid authority flags, invalid confidence, scope mismatch, and direct self-parent cycles.

## Deterministic bounded traversal

`queryTemporalProvenanceGraph` first verifies the complete GraphSnapshot, then constructs a normalized `TraversalQuery`. The query records:

- node-kind, relation, authority-class, and freshness allowlists;
- minimum confidence;
- the fixed exclusion of unreviewed candidates in this alpha;
- maximum depth, node count, and edge count;
- anchor identities and deterministic ordering.

The result records graph, query, and result IDs and hashes; selected nodes and edges; inclusion reasons; exclusion counts; and truncation. A backend may accelerate this algorithm later but may not widen the allowlists, reorder semantic results, admit stale evidence, or alter the digest.

## CLI and MCP

```text
node scripts/head.mjs world-index <project> --parent-snapshot <id,id>
node scripts/head.mjs world-index <project> --revision-parents <json-file>
node scripts/head.mjs world-temporal <project> --query <text> --kind File,FileRevision --relations HAS_REVISION,CURRENT_REVISION --depth 1 --limit 100 --edge-limit 200
```

`--revision-parents` reads a JSON object whose keys are current logical entity IDs and whose values are arrays of parent Revision IDs. The read-only MCP tool `head_temporal_graph` exposes the same bounded traversal. Both reject a stale World Model.

The Context Compiler performs a bounded per-file temporal expansion and records the GraphSnapshot, SourceSnapshot, TraversalQuery, and traversal result digests in included repository candidates. Stale temporal evidence is excluded with the rest of the stale World Model.

## Deferred boundaries

This alpha does not yet implement FeatureGroup, Capability, Feature, Requirement, Constraint, Decision, ChangeSet, VcsEvidence, execution-lineage, conformance, candidate-promotion, or document-projection nodes and relations. It does not implement a `GraphProjectionAdapter` or GraphDB backend. It also does not infer parent revisions, perform merges, promote heuristic mappings, or treat current-state pointers as canon.
