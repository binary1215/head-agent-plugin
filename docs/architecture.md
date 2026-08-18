# Architecture decision

## Adopted shape

The plugin is organized as a thin Codex distribution around a provider-neutral core:

```text
.codex-plugin/plugin.json
  -> skills/head-agent-core       human/agent operating contract
  -> .mcp.json                    read-only inspection surface
  -> scripts/head.mjs             explicit mutation entrypoint
       -> scripts/lib/head-core   project canon and projections
       -> scripts/lib/context-compiler
                                  versioned task Context Capsules
       -> scripts/lib/execution-lineage
                                  content-derived lineage artifacts
       -> scripts/lib/run-lineage contract-bound Run state transitions
       -> scripts/lib/world-model incremental repository view
            -> scripts/lib/semantic-graph evidence-linked semantic projection
            -> scripts/lib/git-history replaceable Git evidence source
            -> scripts/lib/runtime-state replaceable runtime evidence source
            -> scripts/lib/world-model-store replaceable storage contract
```

Codex and OpenCode are projections of the same `.head/` authority. They do not own separate project truth.

## Why the old runtime is not embedded

The original implementation binds project authority to a live Herdr pane and OpenCode session, installs POSIX services, and uses Unix-oriented paths and process assumptions. Copying that runtime into a Codex plugin would falsely advertise cross-platform support and weaken its cleanup/fencing invariants.

The next runtime layer must introduce explicit `PlatformAdapter`, `AgentRuntimeAdapter`, and `WorkspaceHostAdapter` contracts. Only a tested adapter may activate worker launch or communication.

## File ownership

`.head/` is plugin-managed canon. Root `AGENTS.md` and `opencode.json` are created only when absent. Existing files remain project-owned; their generated alternatives are written under `.head/generated/` and reported as manual integration work.

The managed manifest records SHA-256 digests. Canonical mutation stops when managed drift is detected.

## Context Compiler plane

The Context Compiler sits between canonical project knowledge and HEAD execution. It compiles a bounded, reproducible `ContextCapsule`; it does not become a second authority.

```text
Canonical sources -> Snapshot -> ranking/budget -> ContextCapsule -> HEAD/Executor
       ^                                                        |
       |             verified candidate knowledge               |
       +--------------------------------------------------------+
```

The world model and capsules are materialized views. They must be rebuildable from evidence and project canon. `Snapshot`, `Evidence`, `Claim`, `Decision`, `Unknown`, and `ContextCapsule` are the semantic boundary; storage technology remains replaceable.

Compiler unavailability is an adapter-level fail-open condition. Identity drift, canon drift, invalid knowledge, or Capsule digest mismatch is a core fail-closed condition.

## Execution Lineage plane

Execution Lineage turns a Capsule into an auditable whole-plan loop without relying on a provider conversation as authority.

```text
WholePlanSnapshot
  -> ExecutionContract + ContextCapsule
  -> Executor
  -> ResultPacket
  -> ReviewDecision
  -> accepted result or refined WholePlanSnapshot
```

Each artifact has a content-derived identifier, digest verification, and typed `LineageLink` parents. `ResultPacket` evidence is explicitly non-instructional. A Fresh HEAD reconstructs review context from these verified artifacts rather than resuming a hidden model session.

Version 0.3 alpha binds Runs to verified contracts, converts completion into a ResultPacket, builds a deterministic minimum Fresh HEAD review projection, and requires that exact projection for the manual HEAD ReviewDecision. `revise` and `expand` require a ReviewDecision-linked next WholePlanSnapshot before another Run. Candidate knowledge and HEAD recommendations remain authority-free. Executor launch, provider runtime hydration, and authorized knowledge promotion remain deferred.

## Repository World Model plane

The World Model materializes supported repository files, heuristic symbols, dependencies, imports, and resolvable calls as content-addressed evidence. Hot is the current snapshot, Warm is the pointer's change summary, and Cold is the retained prior snapshot set. File-level freshness is recomputed against the working tree before the Context Compiler consumes candidates or graph queries.

`WorldModelStoreAdapter` separates physical persistence from semantic snapshot identity. The snapshot contains only the invariant rebuildable-storage contract; the pointer records the active adapter descriptor. The local JSON adapter is active, and an in-memory conformance test proves that the same canonical inputs produce the same World Model ID through a different adapter. A future GraphDB adapter must implement the same interface and can accelerate traversal, but cannot own unique authority.

The semantic graph uses content-derived node and edge identities, file digest and line evidence, explicit heuristic confidence, and `evidence-not-instruction` trust boundaries. It currently covers file containment, module imports, and resolvable JavaScript/TypeScript/Python calls.

`GitHistoryAdapter` separately supplies rebuildable, content-addressed commit evidence. The default asynchronous Git CLI adapter may fail open with explicit coverage when process launch is unavailable; a byte-preserving host-export adapter provides the same semantic input in constrained runtimes. Current refs validate reachability, and commit messages remain evidence rather than instructions or promoted decisions.

`RuntimeStateAdapter` supplies strict point-in-time external runtime observations. Its source descriptor is pointer metadata rather than semantic identity; normalized observations are content-addressed and freshness-gated. The adapter is read-only and grants neither instruction nor runtime control authority. Live probing, session hydration, and process control remain behind the future `PlatformAdapter`, `AgentRuntimeAdapter`, and `WorkspaceHostAdapter` boundary. AST-accurate graphs and structured Git decision inference also remain deferred.
