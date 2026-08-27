# HEAD Agent Core documentation

[한국어 문서](ko/README.md)

This index covers the public, current documentation shipped with the plugin.
Historical design records are labeled as such inside their documents. Development-only
work logs are intentionally excluded from the distribution and are not runtime authority.

## Start here

- [Architecture decision](architecture.md)
- [Provider-neutral HEAD constitution](head-constitution.md)
- [Authority planes and the Graph/record boundary](authority-plane-contract.md)
- [Project onboarding](onboarding.md)
- [Product Model canon](product-model.md)
- [Product Operating Loop](product-operating-loop.md)

## Context, world, and retrieval

- [HEAD Context Compiler design](context-compiler.md)
- [Repository World Model semantic alpha](world-model.md)
- [Temporal provenance GraphSnapshot alpha](temporal-provenance.md)
- [Review-gated Feature mapping](feature-mapping.md)
- [Incremental observed-state refresh](incremental-refresh.md)
- [Debounced refresh triggers](refresh-trigger.md)
- [Post-refresh Markdown projection policy](post-refresh-projection.md)

## Execution, recovery, and coordination

- [Execution Lineage contract and Run lifecycle](execution-lineage.md)
- [Provider-neutral ChangeSet and reviewed impact](change-sets.md)
- [Compaction recovery](compaction-recovery.md)
- [Session restore and reviewed-result integration](session-recovery.md)
- [Provider-neutral durable role coordination](role-coordination.md)
- [Provider-neutral bounded worker launch waves](bounded-worker-wave.md)
- [External runtime state evidence](runtime-state.md)

## Adapters and projections

- [Runtime adapter contracts](runtime-adapters.md)
- [ComputeAdapter and WorkerProtocol baseline](compute-adapter.md)
- [GraphProjectionAdapter contract](graph-projection-adapter.md)
- [DocumentProjectionAdapter and deterministic Markdown projection](document-projection-adapter.md)
- [Document change review and application](document-change-review.md)
- [Philosophy-preserving fast path](performance-fast-path-design.md)

## Distribution and verification

- [Codex marketplace distribution](codex-marketplace.md)
- [Claude Code marketplace distribution](claude-marketplace.md)
- [Rule surface audit](rule-surface-audit.md)

## Historical design evidence

These documents explain prior design comparisons or audits. They do not override the
current executable contracts above.

- [Original HEAD Core comparison](original-head-core-comparison.md)
- [HEAD-Agent GraphDB Brief v4 summary and design review](HEAD-Agent_GraphDB_Brief_v4.md)
