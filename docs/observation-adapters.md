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

## Host adapter SDK and reference file adapter

`ObservationAdapterRegistry` is a process-local P5 Host registry. It binds an adapter instance to one exact ready HEAD Project, `ObservationSourceBinding`, and `ObservationTypeDescriptor`, then delegates collection through the same Core verifier used by structured Host input. The same source alias may be used independently in different Projects, but its opaque source ID and collection remain Project-bound. Registration has no arbitrary Core source-count gate. Its non-persisted P4 discovery view returns at most 64 sources per page, supports exact type/adapter/availability filters, and exposes an opaque cursor bound to the current filtered registry projection. A stale cursor restarts at the first page with explicit resynchronization metadata because source discovery has no authority or mutation effect; collection still revalidates the exact current Project and source ID. The registry, source aliases, source paths, credentials, cursors, provider identities, and polling state are never written into the project. Core never discovers or dynamically loads project adapter code; only a trusted Host composition may register an adapter instance.

Each source projection includes a bounded descriptor-shape summary: type/version, forms, and at most 16 field key/type/required triples with an omission count. A Host may attach only a bounded operational availability state (`unknown`, `ready`, `auth-missing`, `rate-limited`, or `unavailable`), timestamp, retry timestamp, and stable reason code. These hints are P5 operational evidence with false semantic authority. They cannot rank product relevance, establish freshness sufficiency, or become instructions.

Product-specific adapters own authentication, API queries, pagination, rate limits, webhook acknowledgement, and cursor storage outside Core. They normalize one bounded result into the common contract; Core persists only the verified P3 record and receipt. Missing optional adapters do not block HEAD, and adapter output cannot assign product meaning.

`JsonEventFileObservationAdapter` is the provider-neutral reference for CI or webhook spool integration. It opens one regular, non-symlink JSON file from an absolute Host path, verifies the opened file identity, enforces a 512 KiB read bound, and hashes the raw event key and full evidence before collection. The source path, raw event key, source alias, and credential reference names are not persisted. The event file contains only the product-shaped event:

```json
{
  "schemaVersion": 1,
  "eventKey": "build-42",
  "subject": { "type": "example.ci.target", "key": "app" },
  "form": "event",
  "temporalScope": {
    "observedAt": "2026-09-01T01:00:00.000Z",
    "start": null,
    "end": null
  },
  "coverage": {
    "state": "complete",
    "basis": "enumerated-bounded-query",
    "queryDigest": "<sha256>",
    "examinedCount": 1,
    "sourceReportedTotal": 1,
    "omittedCount": 0,
    "cursorStartDigest": null,
    "cursorEndDigest": null
  },
  "payload": { "succeeded": true }
}
```

The advanced one-shot Host configuration supplies the binding, descriptor, and absolute event path. `sourceKey` is optional and is derived from the exact binding and descriptor when omitted:

```json
{
  "binding": {
    "adapterKey": "head.json-event-file-observation",
    "adapterVersion": "0.1.0",
    "sourceScopeDigest": "<sha256>",
    "credentialReferenceNames": []
  },
  "descriptor": {
    "typeKey": "example.ci.build-result",
    "typeVersion": "1.0.0",
    "forms": ["event"],
    "payloadSchema": {
      "fields": [{ "key": "succeeded", "type": "boolean", "required": true }],
      "additionalFields": false
    }
  },
  "eventFile": "<absolute-host-path>"
}
```

Run `observation-file-ingest` only from a trusted Host/CI integration. It intentionally has no MCP file-path surface: normal conversational use should call a configured Host integration rather than ask the model or user to compose paths and provenance JSON. The reference adapter is one-shot and does not provide a daemon, scheduler, remote connector, or automatic product interpretation.

## Conversational configured-source flow

A trusted Host composition passes its Project-bound registry to `serveMcp`. After provider HEAD selects one exact required `typeKey`, `head_observation_prepare` performs the read-only reuse-first flow: it queries current exact Observation IDs, then returns matching configured source IDs without selecting or collecting one. When existing evidence is not semantically sufficient and durable current evidence is actually needed, HEAD pages or filters `head_observation_sources` as necessary and calls `head_observation_collect_source` with one selected ID:

```text
trusted Host configuration
  -> head_observation_prepare(exact HEAD-selected typeKey)
  -> existing exact Observation IDs first
  -> head_observation_sources only for paging or diagnosis
  -> opaque Project-bound sourceId
  -> head_observation_collect_source
  -> verified P3 ObservationRecord + ObservationCollectionReceipt
```

The preparation projection does not judge semantic sufficiency, infer relevance from lexical overlap, select a source, or persist anything. Provider HEAD performs that judgment in the conversation. The model and user provide no file path, credential reference, binding, descriptor, digest, coverage claim, provider identity, or source alias on this path. Core verifies Project readiness before the adapter may access its source. Missing Host composition is disclosed as optional adapter unavailability; it does not fall back to user-authored provenance or weaken the common contract. An embedding Host may use the same injected registry with the advanced CLI composition, but the ordinary standalone CLI does not load adapter code or configuration dynamically.

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
- the Host registry remains non-persisted P5 configuration, while its verified result uses the same P3 identity and replay contract;
- source registration is not blocked by the bounded status projection, and omitted status entries are disclosed;
- exact source filters and opaque pagination make every registered source discoverable without unbounded output;
- stale source cursors restart with explicit non-authoritative resynchronization rather than creating a user-visible recovery ritual;
- source shape and availability summaries stay bounded, non-semantic, non-instructional, and non-persisted;
- reuse-first preparation returns existing exact Observation IDs before matching configured sources and never judges sufficiency or collects automatically;
- every registered source ID is bound to one exact HEAD Project and cannot be collected into another Project;
- Project readiness is verified before external adapter collection;
- the conversational source flow accepts only an opaque configured source ID and never asks the user for provenance structure;
- the reference event-file adapter accepts unrelated product schemas without persisting Host paths, raw event keys, source aliases, or credential references;
- the reference file path stays outside MCP, and malformed, oversized, relative-path, or divergent events fail closed.
