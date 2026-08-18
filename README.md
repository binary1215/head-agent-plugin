# HEAD Agent Core plugin

This is a plugin-native reworking of the HEAD Agent Core design. It follows the packaging lesson from `oh-my-openagent`: one plugin namespace, a thin harness-facing surface, an isolated provider-neutral core, generated projections, and explicit capability gates. Version `0.3.0-alpha.9` adds a Git-independent temporal provenance GraphSnapshot with immutable File, Symbol, and Test revisions on top of the evidence-linked Execution Lineage, Repository World Model, and deterministic Context Compiler.

Read [`docs/ULTIMATE_GOAL.md`](docs/ULTIMATE_GOAL.md) before planning a material change, starting a milestone, or declaring one complete. It consolidates the user conversations, design references, fixed decisions, capability boundaries, roadmap, and direction-check questions.

## What works

- Valid Codex plugin manifest and discoverable `head-agent-core` skill.
- Dependency-free Node CLI for project initialization, status, checkpoints, and Run lifecycle.
- Safe Codex and OpenCode projections that preserve existing `AGENTS.md` and `opencode.json` files.
- `.head/` project, Session, Run, and managed-file canon with digest drift detection.
- Six Context Compiler types: Snapshot, Evidence, Claim, Decision, Unknown, and ContextCapsule.
- Budgeted minimum-sufficient Context Capsule compilation with explicit exclusions and Unknowns.
- Read-only MCP tools for core status, project status, Capsule preview, and persisted Capsule verification.
- Content-derived `WholePlanSnapshot`, `ExecutionContract`, `ResultPacket`, `ReviewDecision`, and `LineageLink` contract artifacts.
- Contract-bound Runs that produce Result Packets and require a HEAD ReviewDecision before the next Run.
- Deterministic Fresh HEAD review projections that omit executor transcripts and provider session state.
- ReviewDecision-linked plan generations and non-authoritative knowledge-promotion proposals.
- Incremental Repository World Model with digest verification, file-level freshness, a heuristic evidence-linked file/symbol/import/call graph, and Context Compiler integration.
- Content-addressed temporal provenance GraphSnapshot with stable Repository/File/Symbol/Test identities, immutable revisions, zero-or-more SourceSnapshot and Revision parents, and provenance-complete typed edges.
- Deterministic `TraversalQuery` results with relation/kind/authority/freshness allowlists, confidence policy, bounded depth and size, inclusion/exclusion reasons, and graph/query/result digests.
- Versioned `WorldModelStoreAdapter` contract whose storage identity is excluded from content-derived World Model identity; local JSON is the active adapter.
- Versioned `GitHistoryAdapter` contract with content-addressed, all-reachable Git commit evidence. Commit messages remain non-authoritative evidence and are never promoted into canonical `Decision` records.
- Default asynchronous Git CLI collection plus a byte-preserving host-export adapter for constrained runtimes where child-process Git is unavailable.
- Bounded CLI/MCP semantic graph traversal that fails closed when the index is stale.
- Bounded CLI/MCP temporal traversal that works without `.git` and keeps GraphDB, VCS objects, provider sessions, line locations, and document-provider IDs outside core logical identity.
- Bounded CLI/MCP Git history queries and history-aware Context Capsules.
- Versioned read-only `RuntimeStateAdapter` with strict point-in-time host exports, content-addressed observations, source freshness, and no runtime control authority.
- Bounded CLI/MCP runtime-state queries and task-specific runtime evidence in Context Capsules.
- Windows, macOS, and Linux-compatible filesystem code using Node standard libraries.

## What is intentionally deferred

Feature/Capability/ChangeSet graph projection, automatic merge and conflict resolution, candidate promotion, Markdown/Obsidian/Notion projection adapters, AST-accurate semantic analysis, structured/promoted decision extraction from Git evidence, live runtime probing/streaming, the optional GraphDB adapter, automatic provider runtime hydration, and authorized candidate-knowledge promotion are not active yet. Worker process launch, live caller fencing, role messaging, service installation, and Herdr integration also remain deferred. Those features require their explicit contracts and verification; the original OpenCode/Herdr implementation cannot safely be relabeled as cross-platform.

## Use from source

```powershell
node .\scripts\head.mjs init C:\path\to\project --runtime codex,opencode
node .\scripts\head.mjs status C:\path\to\project
node .\scripts\head.mjs world-index C:\path\to\project
node .\scripts\head.mjs world-status C:\path\to\project
node .\scripts\head.mjs world-query C:\path\to\project --query "symbol or path" --depth 1 --limit 100
node .\scripts\head.mjs world-temporal C:\path\to\project --query "file or symbol" --relations HAS_REVISION,CURRENT_REVISION,DECLARES --depth 2 --limit 100 --edge-limit 200
node .\scripts\head.mjs world-history C:\path\to\project --query "decision terms" --limit 20
node .\scripts\head.mjs world-index C:\path\to\project --runtime-state C:\path\to\runtime-state.json
node .\scripts\head.mjs world-runtime C:\path\to\project --runtime codex --state active --kind session --limit 20
node .\scripts\head.mjs context-compile C:\path\to\project --task "Fix the accepted issue" --budget 4000
node .\scripts\head.mjs lineage-plan C:\path\to\project --input .\whole-plan.json
node .\scripts\head.mjs lineage-next-plan C:\path\to\project --input .\next-whole-plan.json
node .\scripts\head.mjs lineage-contract C:\path\to\project --input .\execution-contract.json
node .\scripts\head.mjs run-start C:\path\to\project --contract execution-contract-<24-hex>
node .\scripts\head.mjs checkpoint C:\path\to\project --summary "Current verified state" --next "Next action"
node .\scripts\head.mjs run-finish C:\path\to\project --input .\result.json
node .\scripts\head.mjs run-review-context C:\path\to\project
node .\scripts\head.mjs run-review C:\path\to\project --input .\review.json
```

`world-index` uses the local Git CLI by default and fails open with an explicit coverage reason if the host forbids child processes. In that environment, export Git log bytes with the exact format in [`docs/world-model.md`](docs/world-model.md), then pass the file with `world-index <project> --git-log <file>`.

See [`docs/execution-lineage.md`](docs/execution-lineage.md) for the JSON contracts and state machine, [`docs/world-model.md`](docs/world-model.md) for indexing coverage and freshness behavior, [`docs/temporal-provenance.md`](docs/temporal-provenance.md) for identity and bounded traversal contracts, and [`docs/runtime-state.md`](docs/runtime-state.md) for the strict host-export and privacy boundary.

## Provenance boundary

The design was informed by the user-provided `head-agent-core-main` snapshot and by `oh-my-openagent-dev` as a structural example. This implementation is a fresh adapter/core split and does not copy the original host daemon or worker runtime. The provided HEAD snapshot did not expose a repository license in its root, so this plugin remains `UNLICENSED` pending an explicit distribution decision.

The supplied graph database was not queried or modified. Database-governed onboarding is a separate authority and release concern, not a prerequisite for this local plugin foundation.
