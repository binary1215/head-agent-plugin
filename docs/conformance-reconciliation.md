# Non-blocking Conformance reconciliation

Read [Architecture](architecture.md), [Authority planes](authority-plane-contract.md), [ChangeSets](change-sets.md), and [Observation adapters](observation-adapters.md) before changing this contract.

Status: implemented provider-neutral P3 candidate evidence, P4 queue and audit view, and optional P5 Host trigger composition.

## Boundary

Conformance reconciliation compares approved Product Canon with exact current source, ChangeSet, Observation, or optional Graph evidence without turning Core into a semantic policy engine. Provider HEAD proposes `ConformanceFindingCandidate`; Core verifies its exact current anchors, digest, Project, baseline, bounds, replay identity, and non-authority fields. Core does not infer a violation, semantic relevance, sufficiency, severity, resolution, or product meaning.

Missing Graph, partial or unknown Observation coverage, an unavailable optional source, and an advisory risk hint are disclosures rather than ordinary-work gates. Cross-Project evidence, path escape, tampering, divergent replay, authority amplification, and stale mutation input fail only the affected Conformance operation. A stale read-only cursor resynchronizes to its first page, while a stale proposal asks HEAD to prepare again. Neither condition asks the user for IDs or blocks unrelated work.

## Artifacts and planes

| Artifact | Plane | Effect |
| --- | --- | --- |
| `ConformanceFindingCandidate` | P3 | immutable provider-HEAD semantic candidate with exact evidence |
| `ConformanceDispositionReceipt` | P3 | explicit user disposition scoped to one exact Finding |
| `ConformanceResolutionCandidate` | P3 | fresh provider-HEAD reassessment that cannot close a Finding |
| `ConformancePreparationProjection` | P4 | bounded current Canon and optional World baseline for HEAD |
| `ConformanceQueueProjection` | P4 | rebuildable, paginated queue state |
| `ConformanceFindingGraphProjection` | P4 | candidate-hidden audit graph with no verdict relation |
| `ConformanceTriggerBatchProjection` | P4 | non-persisted bounded Host-trigger preparation |
| `ConformanceTriggerBinding` | P5 | process-local optional Host configuration and delivery state |

No Conformance artifact is P1 or P2. A request to fix code still enters the ordinary Observe, Session, or Run lane. A request to revise Canon still enters the existing exact candidate and explicit user `ReviewDecision` path. A disposition grants neither execution authorization nor recovery direction.

## Conversational flow

The user describes the work once. HEAD performs the structure internally:

```text
head_conformance_prepare
  -> provider HEAD semantic comparison
  -> head_conformance_propose
  -> head_conformance_queue
  -> natural-language batch disposition when useful
```

`head_conformance_prepare` pages current Product Canon entities and returns the current Product Model plus an optional current World/Source/Graph baseline. Graph is never required: an exact bounded project-relative source digest, one reviewed ChangeSet change, or one immutable Observation is sufficient mechanical evidence. HEAD may use multiple anchor kinds when that improves reviewability.

Core computes disclosures. The provider and user do not assert that a connector is complete, a Graph is current, or an Observation is comprehensive. Finding fingerprinting excludes explanatory wording and converges the same Project, baseline, Canon anchor, evidence anchors, and claim kind even when HEAD phrases the explanation differently.

Direct source hashing is bounded to 64 MiB so one diagnostic request cannot monopolize the MCP process. This limits only that anchor form: larger files may use an exact current World or ChangeSet anchor, and ordinary work remains available.

## Disposition and resolution

Supported exact-Finding dispositions are `acknowledge`, `defer`, `dismiss`, `request-code-fix`, `request-canon-revision`, and `accept-resolution`. They form a create-only linked chain. Repeating the exact latest disposition converges; branching or tampering fails closed.

Source or Canon drift changes an open row to `needs-recheck`; it never proves resolution. Provider HEAD may submit an exact fresh `ConformanceResolutionCandidate` with `appears-resolved`, `still-present`, or `uncertain`. Only an explicit user-confirmed `accept-resolution` for one current `appears-resolved` candidate closes that exact Finding. This closure is queue state, not Product Canon or a general suppression rule.

The P4 audit graph uses only `CHECKS_AGAINST`, `EVIDENCED_BY`, `DISPOSITIONED_BY`, and `REASSESSED_BY`. It never automatically emits `VIOLATES`, `CONFORMS_TO`, `SATISFIES`, or `RESOLVED`, and candidate nodes stay hidden from default product traversal.

## Optional Host triggers

`ConformanceTriggerRegistry` is a process-local provider-neutral composition over verified `change-set`, `observation`, `release-observation`, and `refresh-receipt` identities. It loads no project code and persists no source alias, project path, credential, provider identity, process identity, or cursor into the Project.

The default mode is `opportunistic`: a Host prepares queued evidence at a natural conversational boundary without background provider execution. `monitor` and automatic provider assessment require explicit user opt-in. Host trigger delivery creates no Finding by itself; provider HEAD still performs semantic assessment and Core still verifies the proposal.

Duplicate triggers converge across both queued and pending evidence. An empty queue returns idle without creating a pending batch. Refresh receipts coalesce to the latest queued verified receipt with an omission count. A prepared batch is stable until the Host marks it complete. If delivery or provider outcome is uncertain, automatic replay and completion stop; only an explicit user retry decision may clear the uncertain state. One unavailable Host adapter returns an optional-capability disclosure and ordinary HEAD work continues.

## CLI and typed MCP

Normal conversation uses typed MCP. CLI remains available for trusted automation and diagnosis:

```text
head conformance-prepare <project>
head conformance-propose <project> --input <provider-head-proposal.json>
head conformance-queue <project>
head conformance-read <project> --finding <conformance-finding-id>
head conformance-disposition <project> --input <user-confirmed-disposition.json>
head conformance-resolution-propose <project> --input <provider-head-resolution.json>
```

Pages contain at most 64 entities or Findings. This is an output bound, not an eligibility, registration, or persistence gate; opaque cursors expose the 65th and later items.

## Acceptance properties

- lexical overlap, file names, test presence, document classes, Graph availability, connector availability, coverage class, risk hint, and queue length never determine candidate eligibility or ordinary-work blocking;
- Core accepts exact source, ChangeSet, Observation, and Graph anchors independently or together;
- candidate creation, status, disposition, resolution, and Host trigger operations leave Product Canon, `ReviewDecision`, Session pointers, checkpoints, and execution authorization unchanged;
- stale baselines reject only a mutation and tell HEAD to repeat read-only preparation;
- stale read-only cursors resynchronize without user ceremony;
- wording-only duplicate claims converge by exact semantic anchor fingerprint;
- source drift creates `needs-recheck`, never automatic resolution;
- resolution requires fresh exact evidence and explicit user confirmation to close one Finding;
- Host monitor execution is opt-in, duplicate delivery converges, uncertain outcomes do not auto-replay, and Host state remains outside the Project;
- CLI and MCP return the same Core identities, and the 65th item remains reachable.
