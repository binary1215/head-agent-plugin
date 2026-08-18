# ComputeAdapter and WorkerProtocol baseline

Read [`ULTIMATE_GOAL.md`](ULTIMATE_GOAL.md) before changing this plane.

## Purpose and current boundary

`ComputeAdapter` separates deterministic heavy computation from the JavaScript control plane without transferring product authority, runtime authority, or semantic identity to an implementation language. Contract version `0.2.0` and WorkerProtocol version `0.2.0` are active.

The only active backend is `JsReferenceComputeAdapter`. It runs deterministic reference operations in-process and establishes the canonical request, response, error, limit, cancellation, and conformance behavior that a future Go worker must match. `repository.scan.v1` is the first built-in operation. No Go binary is selected or launched in this version. No user project receives native source or binaries.

## Authority boundary

Every adapter descriptor must declare:

- `authority: computation-only`;
- `instructionAuthority: false`;
- `promotionAuthority: false`;
- `controlAuthority: false`;
- `mutatesProject: false`;
- `mutatesCanon: false`;
- `semanticIdentity: backend-neutral-canonical-output`.

Every request and response records `authorityEffect: none`. Result validation recursively rejects any instruction, promotion, control, canonical, or unique-authority flag unless its value is exactly `false`. This is a defense-in-depth boundary; operation-specific validators must still reject output that falls outside the operation schema.

The JavaScript control plane remains responsible for Product Canon writes, ReviewDecision, candidate promotion, Context policy, CLI/MCP integration, backend selection, and eventual worker process supervision.

## Canonical WorkerProtocol

A `ComputeRequest` contains:

```text
schemaVersion, protocol, kind, requestId,
operation, input, inputDigest,
semanticProducer, limits, authorityEffect
```

An operation name is explicitly versioned, for example `repository.scan.v1`. Input must be plain finite JSON. Canonical object-key ordering determines `inputDigest`; protocol version, operation, input digest, semantic producer, and normalized limits determine the content-derived `requestId`.

A `ComputeResponse` echoes the request identity and contains:

```text
status, result, resultDigest,
warnings[], errors[], authorityEffect
```

Successful output must be complete, canonical JSON within `maxOutputBytes`, free of authority escalation, and match its SHA-256 result digest. Failed output has no partial result or digest and requires at least one structured error. Warning and error records are canonically ordered. Request/response mismatch, extra fields, malformed JSON, digest drift, unsupported operations, and partial results fail closed.

## Resource and cancellation contract

Normalized limits record:

- timeout;
- maximum input and output bytes;
- maximum files;
- maximum bytes per file;
- maximum total source bytes.

The control-plane executor applies timeout and external cancellation to an `AbortSignal`, clears timers and listeners in all outcomes, and returns elapsed time only as operational diagnostics outside the protocol response. JavaScript reference handlers must cooperatively observe that signal; therefore untrusted or non-cooperative work is not eligible for the in-process backend. A future native adapter must additionally own and terminate its exact child process tree and bound stdout/stderr before returning.

## Conformance

`verifyComputeAdapterConformance` sends the exact same immutable request to the JavaScript reference adapter and a candidate adapter. The complete canonical protocol responses must match, not only a selected field. Its content-derived report records fixture names, operations, request IDs, statuses, and result digests.

Conformance proves equivalence only for the supplied fixtures. An operation cannot move to Go until its operation-specific schema, deterministic JavaScript implementation, failure fixtures, representative benchmark corpus, and semantic identity checks exist.

## Repository scan v1

`repository.scan.v1` accepts an absolute project root only as an operational input. Its validated semantic result contains normalized relative paths, content digests, sizes, classifications, languages, symbols, dependencies, import bindings, calls, skip counts, and a content-derived `scanId`. It contains no absolute root, backend name, PID, timing, GraphDB identifier, Git requirement, source text, instruction authority, or promotion authority.

The World Model consumes only a successfully validated complete result. JavaScript and future native implementations must use the same source-analysis producer version and canonical ordering. Backend name, execution mode, request ID, result digest, and elapsed time remain pointer or caller diagnostics outside the World Model snapshot identity.

The tracked corpus under `benchmarks/repository-scan-v1/basic` covers file, symbol, dependency, binding, and call extraction. `npm run benchmark:repository-scan` repeats the reference operation, fails on semantic identity drift, and reports timing only as non-semantic diagnostics. The corpus and conformance gate establish migration evidence; they do not claim that native acceleration is already faster.

## Explicitly deferred

- compute-backed graph construction, traversal, or Context selection operations;
- `GoWorkerComputeAdapter` and native WorkerProtocol transport;
- OS/architecture selection and distribution manifest verification;
- process spawn, stdout/stderr limits, exact PID-tree cleanup, and crash recovery;
- automatic JavaScript fallback after a disclosed native failure;
- benchmark-based migration of file scanning, parsing, World Model construction, graph traversal, or Context selection;
- Rust or other native backends.

The automatic Go build workflow remains intentionally no-op until a real conformance-gated Go worker module and command exist.
