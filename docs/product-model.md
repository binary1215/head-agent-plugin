# Product Model canon

Read [`ULTIMATE_GOAL.md`](ULTIMATE_GOAL.md) before changing this contract. The Product Model records user-owned product intent; it does not infer authority from repository layout, generated graphs, Git history, or model output.

## Authority and lifecycle

`.head/context/product-model.json` is mutable project canon for `FeatureGroup`, `Capability`, `Feature`, `Requirement`, `Constraint`, and `Decision`. New project initialization creates an explicit empty document. An older initialized project without the file is interpreted as the same empty semantic model until an authorized process creates the file, so migration does not invent product meaning.

An empty Product Model means “HEAD has no approved product concepts yet.” Existing source files, tests, README headings, issues, or directory names remain Evidence and do not automatically become Features. The active onboarding flow can derive immutable candidates from bounded repository evidence or a structured new-project brief, but requires an explicit batch ReviewDecision before promotion into this canon. Directory structure is never converted into authoritative FeatureGroup taxonomy.

## Schema

Stable `key` values identify logical product entities across renames and description changes. Names and descriptions are revision content rather than identity. References use keys and are validated before the model can be indexed.

```json
{
  "schemaVersion": 1,
  "featureGroups": [
    {
      "key": "communication",
      "name": "Communication",
      "description": "User-facing communication experiences.",
      "parentFeatureGroupKeys": []
    }
  ],
  "capabilities": [
    {
      "key": "message-delivery",
      "name": "Message delivery",
      "description": "Deliver a message to its intended recipients."
    }
  ],
  "features": [
    {
      "key": "direct-message",
      "name": "Direct message",
      "description": "Send a message to one recipient.",
      "featureGroupKeys": ["communication"],
      "capabilityKeys": ["message-delivery"],
      "governedBy": [
        { "kind": "Requirement", "key": "delivery-confirmation" }
      ]
    }
  ],
  "requirements": [
    {
      "key": "delivery-confirmation",
      "statement": "Accepted messages expose delivery confirmation.",
      "description": ""
    }
  ],
  "constraints": [],
  "decisions": []
}
```

Keys use letters, digits, dot, underscore, colon, or hyphen. Keys must be unique within each entity kind. FeatureGroup parent relations must be acyclic. Feature references to groups, capabilities, requirements, constraints, and decisions must resolve. A Decision has `status: "active"` or `"superseded"`.

## Temporal projection

Indexing normalizes arrays and object fields, derives a `productModelHash`, and projects each logical product entity plus one immutable current Revision into the temporal GraphSnapshot. A logical entity keeps the same project-scoped identity when its name or description changes; its Revision identity changes with semantic content or explicit sorted parents.

Product relations use one canonical direction:

- `FeatureGroup -CONTAINS-> FeatureGroup`;
- `FeatureGroup -CONTAINS-> Feature`;
- `Feature -REALIZES-> Capability`;
- `Feature -GOVERNED_BY-> Requirement|Constraint|Decision`;
- logical entity `-HAS_REVISION->` and `-CURRENT_REVISION->` immutable Revision.

These nodes and relations carry `authorityClass: "canon-projected"` because they are derived views of canon. They still have `instructionAuthority: false` and `promotionAuthority: false`: a GraphSnapshot never becomes canon or an authority mechanism merely because it contains a projection of canon.

Whitespace, object-field ordering, and set-like reference ordering do not change the semantic Product Model identity. A semantic change makes the stored World Model stale until explicit re-indexing creates and verifies a new immutable snapshot.

## Query and Context Compiler behavior

After `world-index`, product concepts can be traversed with the same bounded temporal query contract:

```powershell
node scripts/head.mjs world-temporal <project> --query "Message delivery" --kind Feature,FeatureRevision,Capability --relations REALIZES,HAS_REVISION,CURRENT_REVISION --depth 2 --limit 100 --edge-limit 200
```

The Context Compiler may include a task-relevant bounded Product Context only from a current verified World Model. It records GraphSnapshot, query, and result digests, allows only `canon-projected` product relations, and excludes unreviewed candidates.

## Onboarding promotion

The project-scoped onboarding state machine stores candidate sets and `decisionScope: "product-canon-bootstrap"` ReviewDecisions separately from this file. Candidates have content-derived identities plus evidence, confidence, producer, source snapshot, and explicit false instruction/promotion authority flags. `accept-all` and dependency-complete `accept-selection` create a new normalized Product Model only after stale-source, Product Canon drift, conflict, and reference checks pass. `revise` creates a successor candidate set; `reject` leaves canon unchanged.

Acceptance records previous and resulting Product Model identities and immutable Product Model revision documents. It then rebuilds a child SourceSnapshot and verifies that the new Product Model identity is present in the current temporal GraphSnapshot before onboarding becomes ready. See [`onboarding.md`](onboarding.md) for the complete state and input contracts.

The temporal graph also projects the immutable candidate, Evidence, Unknown, ReviewDecision, and ProductModelRevision receipts needed to explain how a concept reached canon. These receipts do not become Product Model entities. Candidate nodes point to separate `ProductConceptReference` nodes, while only the reviewed resulting `.head/context/product-model.json` content creates `canon-projected` Product entities and revisions.

## Explicitly deferred

This slice does not treat inferred code or documentation meaning as canon without review. Feature-to-code and Feature-to-test mappings now have a separate immutable candidate and explicit ReviewDecision contract, but they do not mutate Product Canon. Dedicated imported-backlog adapters, broader conformance relations, ChangeSets, and document projections remain deferred.
