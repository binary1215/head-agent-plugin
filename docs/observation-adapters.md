# Common Observation contract and adapters

Read [Architecture](architecture.md) and [Authority planes](authority-plane-contract.md) before changing this contract. Release-specific evidence remains documented in [Release observation](release-observation.md), while exact task inclusion remains documented in [Context Compiler](context-compiler.md).

Status: implemented provider-neutral P3 evidence grammar and P4 projection.

## Boundary

The common contract standardizes evidence shape, lineage, coverage, replay, and authority without standardizing product vocabulary. An `ObservationTypeDescriptor` declares only a closed bounded payload schema. It cannot declare a Feature, policy, success condition, causal relation, tool route, or product meaning.

An adapter supplies an exact `ObservationSourceBinding` and bounded input. Core creates an immutable `ObservationRecord` plus one `ObservationCollectionReceipt`. Deterministic computation over exact source records creates a separate `DerivedObservationRecord`; it never rewrites an observed fact.

Credentials, provider sessions, process IDs, sockets, and source cursors remain Host-local. Only credential reference names may appear in the binding, and they are not copied into observation records. Replay identity is scoped to the exact adapter key, adapter version, source-scope digest, and source-event-key digest. Identical replay inside that binding converges on the same record, while divergent content fails closed. Independent source bindings may reuse an upstream event key without colliding.

## Coverage and graph

Coverage is explicit: complete, sampled, partial, or unknown. Complete coverage is accepted only when a bounded enumeration supplies a query digest, equal examined and source totals, and zero omissions. An adapter cannot claim completeness from a sample.

The rebuildable `ObservationStatusProjection` creates only `CONFORMS_TO`, `EVIDENCED_BY`, and `DERIVED_FROM`. It does not infer impact, motivation, measurement, ownership, success, or Feature links. Product interpretation belongs to a HEAD-authored `ProductHypothesis` or the existing review-gated candidate flow. `ProductSignal` remains available for lossless human/source statements; it is not manufactured from arbitrary payload fields.

Release evidence is a strict specialization, not a replacement by the generic adapter. `BranchStateObservation`, `DeploymentResultObservation`, and `ReleaseObservation` preserve their exact Git reachability, approval, commit, ref, and lineage checks.

## Context and use

Context compilation excludes common observations by default. HEAD performs semantic analysis and requests exact identities through an EvidenceNeed whose kind is `observation` and whose `observationIds` are immutable current IDs. Core then proves actual inclusion without lexical eligibility, semantic promotion, or sufficiency judgment.

Ordinary inspection remains ephemeral. Persist an Observation only when cross-Run, rebuttal/audit, handoff, or context-loss evidence is required. A Host adapter, not the user, constructs the exact source binding, descriptor, digests, coverage, and provenance confirmation. `observation-ingest` and `head_observation_ingest` are advanced Host/CI surfaces for already bounded input; collect remains the adapter-facing compatibility alias.

`observation-status` and `head_observation_status` return a bounded P4 summary without full payload nodes. `observation-query` and `head_observation_query` filter exact current identities by type, subject, source, time, and observed/derived kind with a maximum page of 100. Cursor continuation is bound to the exact current `ObservationStatusProjection`; drift fails closed. Query results contain payload digests rather than payload bodies. The exact read surface returns the selected record, descriptor, and bounded receipt or derivation lineage. Querying is discovery, not semantic selection, Context eligibility, or sufficiency judgment.

## Acceptance properties

- unrelated product domains use the same contract without domain vocabulary in Core;
- independent source bindings may reuse the same upstream event key, while divergent replay inside one exact binding fails closed;
- observation writes leave Product Canon and Session recovery bytes unchanged;
- Product Signal and other unrelated operating flows do not load or depend on unused Observation storage;
- false completeness, schema drift, authority drift, and divergent replay fail closed;
- status and query output stays bounded and never turns discovery into semantic selection;
- default Capsule compilation includes no common observation, even with lexical overlap;
- an exact HEAD EvidenceNeed includes only the named immutable records;
- derived records and projections cannot add semantic graph relations;
- a hypothesis may reference exact observations while remaining non-authoritative;
- CLI and MCP return the same Core identities.
