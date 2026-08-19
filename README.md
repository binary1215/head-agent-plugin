# HEAD Agent Core plugin

This is a plugin-native reworking of the HEAD Agent Core design. It follows the packaging lesson from `oh-my-openagent`: one plugin namespace, a thin harness-facing surface, an isolated provider-neutral core, generated projections, and explicit capability gates. Version `0.3.0-alpha.37` establishes `PlatformAdapter`, `AgentRuntimeAdapter`, and `WorkspaceHostAdapter` boundaries for Codex and OpenCode, verifies current-host non-session interfaces, and binds a content-derived runtime-invocation authorization to the exact HEAD Project, Session, active Run, ExecutionContract, WholePlan, ContextCapsule, workspace mode, and resource limits. A host-local owner lock plus immutable project-lineage consumption and release receipts consume each authorization before child start and prevent sequential or concurrent replay with an honest at-most-once guarantee. The Codex one-shot path composes the stable `codex exec --json --ephemeral` surface, exact authorized stdin, a host-local output schema, privacy-reduced JSONL envelopes, bounded structured results, durable transcript-free invocation records, CLI execution/read, and read-only MCP retrieval through an integrity-verified native process supervisor. A completed native-supervised actual-provider Run draft can now be applied exactly once to the canonical ResultPacket and Fresh HEAD review boundary with a content-derived recovery receipt. Windows Job Objects and POSIX process groups provide the same descendant-tree cleanup contract; Windows normal-exit/cancellation and the supervised Codex protocol fixture are verified. No live model call has been claimed, so live Session/Run result conformance and an accepted live application remain the next gate. OpenCode actual invocation, provider resume/attachment, and general start/stream/interrupt/close control remain disabled.

Read [`docs/ULTIMATE_GOAL.md`](docs/ULTIMATE_GOAL.md) before planning a material change, starting a milestone, or declaring one complete. It consolidates the user conversations, design references, fixed decisions, capability boundaries, roadmap, and direction-check questions.

## What works

- Valid Codex plugin manifest and discoverable `head-agent-core` skill.
- Dependency-free Node CLI for project initialization, status, checkpoints, and Run lifecycle.
- Safe Codex and OpenCode projections that preserve existing `AGENTS.md` and `opencode.json` files.
- `.head/` project, Session, Run, and managed-file canon with digest drift detection.
- Immutable project-scoped HEAD Session records and a digest-verified onboarding state pointer with deterministic migration for older initialized projects.
- Local-default, privacy-safe onboarding storage selection; GraphDB configuration stores only endpoint, database, and secret-reference names and continues locally until explicit conformance-gated activation.
- Bounded evidence-linked FeatureGroup, Capability, and Feature candidate inference from repository evidence or a structured new-project brief.
- Batch onboarding ReviewDecisions for accept-all, dependency-complete selection, revision, or rejection; candidates remain immutable and non-authoritative.
- Review-gated Product Canon revisions with previous/next hashes, stale-source rejection, rollback on failed promotion, and a verified child GraphSnapshot before onboarding becomes ready.
- Content-addressed onboarding CandidateSet, Evidence, Unknown, ReviewDecision, and ProductModelRevision receipt projection with `PROPOSES_*`, `SUPPORTED_BY`, `REVIEWED_BY`, `ACCEPTED_BY`, `REJECTED_BY`, `PRODUCES`, and `PROMOTED_FROM` lineage.
- Bounded many-to-many Feature/Capability-to-File/Symbol/Test mapping candidates with immutable evidence, stale-source rejection, explicit accept/reject review, separate `ReviewedRelationship` receipts, and canonical-direction `IMPLEMENTS`/`VERIFIED_BY` edges.
- Provider-neutral ChangeSets bound to exact pre/post SourceSnapshots, File/Symbol/Test revision differences, accepted ResultPackets and execution ReviewDecisions, with sorted zero-or-more ChangeSet parents and no Git prerequisite.
- Immutable mapping-derived Change-impact candidates, explicit accept/reject review, separate `ReviewedImpact` receipts, and reviewed canonical `IMPACTS` edges consumed by bounded ProductContext traversal.
- Six Context Compiler types: Snapshot, Evidence, Claim, Decision, Unknown, and ContextCapsule.
- Budgeted minimum-sufficient Context Capsule compilation with explicit exclusions and Unknowns.
- Read-only MCP tools for core status, project status, Capsule preview, and persisted Capsule verification.
- Content-derived `WholePlanSnapshot`, `ExecutionContract`, `ResultPacket`, `ReviewDecision`, and `LineageLink` contract artifacts.
- Contract-bound Runs that produce Result Packets and require a HEAD ReviewDecision before the next Run.
- Deterministic Fresh HEAD review projections that omit executor transcripts and provider session state.
- ReviewDecision-linked plan generations and non-authoritative knowledge-promotion proposals.
- Incremental Repository World Model with digest verification, file-level freshness, a heuristic evidence-linked file/symbol/import/call graph, and Context Compiler integration.
- Explicit incremental observed-state refresh with digest-gated unchanged-file analysis reuse, full-scan semantic equivalence, immutable request/receipt artifacts, automatic SourceSnapshot ancestry, and active-Run drift disclosure.
- Debounced foreground filesystem watching and structured CI event ingestion with deterministic coalescing, bounded overflow, immutable trigger/delivery receipts, `.head` feedback-loop suppression, and single-writer refresh serialization.
- Versioned `repository.scan.v1` operation with relative-path-only semantic output, strict limits and result validation, a JavaScript reference implementation, conformance coverage, and a repeatable benchmark corpus.
- Content-addressed temporal provenance GraphSnapshot with stable Product/Repository/File/Symbol/Test identities, onboarding review receipts, immutable revisions, zero-or-more SourceSnapshot and Revision parents, and provenance-complete typed edges.
- Explicit `.head/context/product-model.json` canon with stable product keys and validated FeatureGroup, Capability, Feature, Requirement, Constraint, and Decision relationships.
- Canon-projected immutable product revisions and bounded Product Context retrieval without granting the derived graph instruction or promotion authority.
- Versioned `ComputeAdapter` and WorkerProtocol contracts with canonical request/response validation, structured errors, resource bounds, timeout/cancellation, and no authority effect.
- `JsReferenceComputeAdapter` as the deterministic semantic baseline plus fixture-driven backend conformance verification.
- `GoWorkerComputeAdapter` with OS/architecture selection, plugin-root path confinement, SHA-256/size verification, bounded stdio, timeout/cancellation, exact child-PID cleanup, and operational-only diagnostics.
- Cross-platform Go source and a release workflow that tests conformance before packaging per-platform worker manifests and binaries.
- Conformance-ready Go `repository.scan.v1` covering bounded file discovery, hashing, classification, heuristic symbols, dependencies, import bindings, and calls without changing canonical scan identity.
- Deterministic `TraversalQuery` results with relation/kind/authority/freshness allowlists, confidence policy, bounded depth and size, inclusion/exclusion reasons, and graph/query/result digests.
- Versioned `WorldModelStoreAdapter` contract whose storage identity is excluded from content-derived World Model identity; local JSON is the active adapter.
- Versioned `GraphProjectionAdapter` contract with local JSON, in-memory, and activated ArcadeDB HTTP implementations; prepared traversal binds the embedded GraphSnapshot and deterministic result to exact bounded expansion evidence, every successful remote write is locally mirrored, availability fallback is disclosed, and stale/tamper/auth/authority/divergence failures close the operation.
- Content-derived prepared-traversal cost evidence separates canonical normalized payload size from operational latency, with a reviewed fixture and an optional no-write live ArcadeDB benchmark.
- Versioned `DocumentProjectionAdapter` contract with deterministic graph-to-Markdown rendering, content-derived projection identity, local/in-memory conformance, explicit generation, and stale/tamper/authority rejection.
- Published Markdown drift protection that never overwrites user edits and captures added/modified/removed pages as immutable, non-authoritative `DocumentChangeCandidateSet` evidence.
- Explicit document-change ReviewDecisions that never infer canon from prose, plus review-gated acceptance of a complete structured Product Model, verified child GraphSnapshot rebuild, deterministic Markdown reconciliation, and immutable application receipts.
- Content-derived `PostRefreshProjectionPolicy` and receipt artifacts with a manual safe default and explicit opt-in automatic Markdown regeneration after verified refresh; edited or unmanaged views are preserved rather than overwritten.
- Versioned `GitHistoryAdapter` contract with content-addressed, all-reachable Git commit evidence. Commit messages remain non-authoritative evidence and are never promoted into canonical `Decision` records.
- Default asynchronous Git CLI collection plus a byte-preserving host-export adapter for constrained runtimes where child-process Git is unavailable.
- Bounded CLI/MCP semantic graph traversal that fails closed when the index is stale.
- Bounded CLI/MCP temporal traversal that works without `.git` and keeps GraphDB, VCS objects, provider sessions, line locations, and document-provider IDs outside core logical identity.
- Bounded CLI/MCP Git history queries and history-aware Context Capsules.
- Versioned read-only `RuntimeStateAdapter` with strict point-in-time host exports, content-addressed observations, source freshness, and no runtime control authority.
- Versioned runtime composition with projection-only Codex/OpenCode contract references, Windows/macOS/Linux PlatformAdapter references, a native-process WorkspaceHostAdapter reference, deterministic probe identities, current-host privacy-preserving CLI discovery, bounded direct version and fixed-help protocol evidence, canonical HEAD project/Session capability binding, and fail-closed disabled control methods.
- Immutable runtime-invocation authorizations derived only from an exact active contract-bound Run with explicit `runtime.invoke` plus `project.read` or `project.write` allowed actions; raw execution input is represented only by digest and byte count.
- Provider-neutral JSONL event envelopes, lifecycle receipts, `RuntimeStructuredResult`, and ResultPacket drafts that omit raw transcripts, commands, provider-session identifiers, and PIDs; a fixed fixture proves Codex/OpenCode lifecycle behavior, while an integrity-verified native supervisor uses Windows Job Objects or POSIX process groups and carries the Codex exec protocol fixture through structured JSONL extraction, descendant cleanup, and durable CLI/MCP retrieval without claiming a live model call.
- Bounded CLI/MCP runtime-state queries and task-specific runtime evidence in Context Capsules.
- Windows, macOS, and Linux-compatible filesystem code using Node standard libraries.

## What is intentionally deferred

Dedicated imported-backlog connectors, inferred commit-to-ChangeSet matching, conformance projection, general relationship promotion beyond Feature mapping and Change impact, automatic ChangeSet ancestry inference, automatic merge and conflict resolution, background watcher service installation, provider-specific CI webhooks, Obsidian/Notion projection adapters, compute-backed graph construction/traversal, production selection of native `repository.scan.v1`, AST-accurate semantic analysis, structured/promoted decision extraction from Git evidence, OpenCode actual invocation, provider resume or durable attachment, general runtime start/resume/stream/interrupt/close, an executed live Codex Session/Run conformance scenario, an executed live prepared-query evaluation, compare-and-swap remote publication, non-ArcadeDB transports, automatic provider runtime hydration, and general authorized candidate-knowledge promotion are not active yet. Live Codex event/error/cancellation conformance, live acceptance of the implemented draft-to-canonical-ResultPacket application, role messaging, service installation, Rust backends, and Herdr integration also remain deferred. Those features require their explicit contracts and verification; the original OpenCode/Herdr implementation cannot safely be relabeled as cross-platform.

## Use from source

```powershell
node .\scripts\head.mjs init C:\path\to\project --runtime codex,opencode
node .\scripts\head.mjs status C:\path\to\project
node .\scripts\head.mjs onboarding-start C:\path\to\project
node .\scripts\head.mjs onboarding-status C:\path\to\project
node .\scripts\head.mjs onboarding-review C:\path\to\project --input .\onboarding-review.json
node .\scripts\head.mjs feature-mapping-start C:\path\to\project
node .\scripts\head.mjs feature-mapping-status C:\path\to\project
node .\scripts\head.mjs feature-mapping-review C:\path\to\project --input .\feature-mapping-review.json
node .\scripts\head.mjs change-set-record C:\path\to\project --input .\change-set.json
node .\scripts\head.mjs change-set-status C:\path\to\project
node .\scripts\head.mjs change-impact-review C:\path\to\project --input .\change-impact-review.json
node .\scripts\head.mjs world-index C:\path\to\project
node .\scripts\head.mjs world-status C:\path\to\project
node .\scripts\head.mjs world-refresh C:\path\to\project
node .\scripts\head.mjs world-refresh C:\path\to\project --expect-changed src/service.mjs
node .\scripts\head.mjs world-refresh-status C:\path\to\project
node .\scripts\head.mjs world-refresh-read C:\path\to\project --receipt incremental-refresh-receipt-<24-hex>
node .\scripts\head.mjs world-refresh-events C:\path\to\project --input .\refresh-events.json
node .\scripts\head.mjs world-refresh-watch C:\path\to\project --debounce-ms 350 --max-events 1024
node .\scripts\head.mjs world-refresh-trigger-status C:\path\to\project
node .\scripts\head.mjs world-refresh-trigger-read C:\path\to\project --delivery refresh-trigger-delivery-<24-hex>
node .\scripts\head.mjs world-graph-status C:\path\to\project
node .\scripts\head.mjs world-graph-remote-activate C:\path\to\project
node .\scripts\head.mjs world-graph-remote-status C:\path\to\project
node .\scripts\head.mjs world-docs-build C:\path\to\project
node .\scripts\head.mjs world-docs-status C:\path\to\project
node .\scripts\head.mjs world-docs-capture C:\path\to\project
node .\scripts\head.mjs world-docs-candidates C:\path\to\project --candidate-set document-change-candidate-set-<24-hex>
node .\scripts\head.mjs world-docs-review C:\path\to\project --input .\document-change-review.json
node .\scripts\head.mjs world-docs-apply C:\path\to\project --review document-change-review-decision-<24-hex>
node .\scripts\head.mjs world-docs-review-status C:\path\to\project --candidate-set document-change-candidate-set-<24-hex>
node .\scripts\head.mjs world-docs-review-read C:\path\to\project --review document-change-review-decision-<24-hex>
node .\scripts\head.mjs world-docs-application-read C:\path\to\project --application document-change-application-<24-hex>
node .\scripts\head.mjs world-docs-policy-set C:\path\to\project --input .\post-refresh-policy.json
node .\scripts\head.mjs world-docs-policy-status C:\path\to\project
node .\scripts\head.mjs world-docs-refresh-status C:\path\to\project
node .\scripts\head.mjs world-docs-refresh-read C:\path\to\project --receipt post-refresh-projection-receipt-<24-hex>
node .\scripts\head.mjs world-query C:\path\to\project --query "symbol or path" --depth 1 --limit 100
node .\scripts\head.mjs world-temporal C:\path\to\project --query "file or symbol" --relations HAS_REVISION,CURRENT_REVISION,DECLARES --depth 2 --limit 100 --edge-limit 200
node .\scripts\head.mjs world-temporal C:\path\to\project --query "Message delivery" --kind Feature,FeatureRevision,Capability --relations REALIZES,HAS_REVISION,CURRENT_REVISION --depth 2 --limit 100 --edge-limit 200
node .\scripts\head.mjs world-temporal C:\path\to\project --query "onboarding-candidate-..." --kind OnboardingProductCandidate,OnboardingEvidence --include-candidates true --depth 1 --limit 100 --edge-limit 200
node .\scripts\head.mjs world-history C:\path\to\project --query "decision terms" --limit 20
node .\scripts\head.mjs world-index C:\path\to\project --runtime-state C:\path\to\runtime-state.json
node .\scripts\head.mjs world-runtime C:\path\to\project --runtime codex --state active --kind session --limit 20
node .\scripts\head.mjs context-compile C:\path\to\project --task "Fix the accepted issue" --budget 4000
node .\scripts\head.mjs lineage-plan C:\path\to\project --input .\whole-plan.json
node .\scripts\head.mjs lineage-next-plan C:\path\to\project --input .\next-whole-plan.json
node .\scripts\head.mjs lineage-contract C:\path\to\project --input .\execution-contract.json
node .\scripts\head.mjs run-start C:\path\to\project --contract execution-contract-<24-hex>
node .\scripts\head.mjs runtime-invocation-authorize C:\path\to\project --input .\runtime-invocation.json
node .\scripts\head.mjs runtime-invocation-read C:\path\to\project --authorization execution-authorization-<24-hex>
node .\scripts\head.mjs runtime-invocation-execute C:\path\to\project --authorization execution-authorization-<24-hex> --input .\runtime-execution.json
node .\scripts\head.mjs runtime-invocation-result C:\path\to\project --authorization execution-authorization-<24-hex>
node .\scripts\head.mjs runtime-invocation-apply-run-result C:\path\to\project --authorization execution-authorization-<24-hex>
node .\scripts\head.mjs checkpoint C:\path\to\project --summary "Current verified state" --next "Next action"
node .\scripts\head.mjs run-finish C:\path\to\project --input .\result.json
node .\scripts\head.mjs run-review-context C:\path\to\project
node .\scripts\head.mjs run-review C:\path\to\project --input .\review.json
```

`world-index` uses the local Git CLI by default and fails open with an explicit coverage reason if the host forbids child processes. In that environment, export Git log bytes with the exact format in [`docs/world-model.md`](docs/world-model.md), then pass the file with `world-index <project> --git-log <file>`.

`init` creates an empty `.head/context/product-model.json`, an immutable project-scoped HEAD Session record, a local storage-selection record, and an explicit onboarding pointer. Product Model content remains user-owned mutable canon, not generated graph output. Existing initialized projects receive these onboarding artifacts only through the deterministic missing-state migration path.

Runtime execution keeps immutable authorization, consumption, and release evidence under `.head`, but stores ephemeral PID, token, and `owner.lock` state in the host-local operational root outside the project. Windows uses `%LOCALAPPDATA%\head-agent-core\operational-state`; Unix-like hosts use `$XDG_STATE_HOME/head-agent-core` or `~/.local/state/head-agent-core`. Isolated hosts and tests may configure an absolute `HEAD_AGENT_OPERATIONAL_STATE_ROOT`; project files and execution requests cannot select or discover that path.

See [`docs/onboarding.md`](docs/onboarding.md) for the bootstrap state machine, [`docs/feature-mapping.md`](docs/feature-mapping.md) for mapping candidate and review contracts, [`docs/change-sets.md`](docs/change-sets.md) for provider-neutral change and reviewed-impact contracts, [`docs/execution-lineage.md`](docs/execution-lineage.md) for the Run contracts and state machine, [`docs/product-model.md`](docs/product-model.md) for Product Model authority and schema, [`docs/world-model.md`](docs/world-model.md) for indexing coverage and freshness behavior, [`docs/incremental-refresh.md`](docs/incremental-refresh.md) and [`docs/refresh-trigger.md`](docs/refresh-trigger.md) for refresh and event-ingestion contracts, [`docs/temporal-provenance.md`](docs/temporal-provenance.md) for identity and bounded traversal contracts, [`docs/graph-projection-adapter.md`](docs/graph-projection-adapter.md) for replaceable graph materialization and query semantics, [`docs/document-projection-adapter.md`](docs/document-projection-adapter.md) for deterministic Markdown and inbound-edit candidate semantics, [`docs/document-change-review.md`](docs/document-change-review.md) for explicit candidate review and exact Product Canon application, [`docs/compute-adapter.md`](docs/compute-adapter.md) for the native-compute semantic boundary, [`docs/runtime-state.md`](docs/runtime-state.md) for the strict host-export boundary, and [`docs/runtime-adapters.md`](docs/runtime-adapters.md) for provider/platform/host discovery and control gates.

## Provenance boundary

The design was informed by the user-provided `head-agent-core-main` snapshot and by `oh-my-openagent-dev` as a structural example. This implementation is a fresh adapter/core split and does not copy the original host daemon or worker runtime. The provided HEAD snapshot did not expose a repository license in its root, so this plugin remains `UNLICENSED` pending an explicit distribution decision.

The designated ArcadeDB sandbox readiness endpoint has been observed, but this milestone does not claim a completed credentialed activation or remote write. Onboarding can record a privacy-safe pending GraphDB selection, while the verified local path remains complete and no remote database becomes canon or a prerequisite.
