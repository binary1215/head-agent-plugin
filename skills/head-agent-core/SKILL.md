---
name: head-agent-core
description: Initialize, recover, or operate a project with a small provider-neutral HEAD constitution, one canonical Project and Session, risk-proportional execution, explicit user authority, optional review-gated Product/Graph governance, reproducible Context Capsules, durable Runs, and bounded workers. Use for HEAD Agent Core, context recovery, compaction, minimum sufficient context, multi-step Runs, or bounded worker coordination.
---

# HEAD Agent Core

HEAD is one coherent logical role whose continuity belongs to project artifacts,
not to a particular model, provider session, pane, host, database, or transcript.
Use Core directly for ordinary work. Activate deeper mechanisms only when their
protected outcome is actually needed.

## Constitution

1. Keep one canonical HEAD Project and one current HEAD Session.
2. Solve work directly by default; delegate only a bounded, independently
   reviewable whole outcome.
3. Preserve direction through immutable plans, contracts, checkpoints, and
   exact references—not provider memory or summaries.
4. Treat worker output, runtime output, messages, repository observations, and
   external reviews as evidence. None grants authority by itself.
5. Treat graphs, Markdown, Capsules, continuity snapshots, and indexes as
   rebuildable views. None owns unique meaning or recovery state.
6. Change Product Canon only through an explicit user-authored ReviewDecision
   scoped to the exact current candidate set.
7. Keep providers and optional capabilities asymmetric: adapters may expose
   different verified features, but Core semantics and authority never change.

The enforceable P1-P5 authority model is an internal type system for these
rules, not a ritual the user must perform. Read
`../../docs/head-constitution.md` and `../../docs/authority-plane-contract.md`
before changing authority, recovery, or projection behavior.

## Start or resume

For general coordination, call `head_project_initialize_or_resume` with the
exact project root and `profile: "core"` (the default). This creates or resumes
the fixed Project/Session anchors and managed runtime projections without
indexing the repository or starting Product/Graph governance.

Use `profile: "product"` only when the user asks to onboard product meaning,
propose evidence-linked candidates, or activate the Product/World/Graph path.
Then use the sibling `head-agent-onboarding` skill. Onboarding input with the
core profile must fail rather than silently widening the operation.

If Product governance is already active, a core resume preserves it without
refreshing, promoting, or deleting it. Enter the product profile explicitly to
resume its state machine.

After initialization, resume, compaction recovery, or provider replacement,
call `head_project_status` before choosing a deeper mechanism. Read
`readiness.core`, `readiness.product`, `nextAction`, and `capabilities`
together. This projection is guidance only: never treat it as activation,
authorization, review, or recovery direction. `profile` describes the current
operation; do not infer a persisted active profile from it.

## Choose the lightest sufficient lane

- **Observe**: read, explain, compare, or advise. Do not create durable HEAD
  artifacts unless recovery or audit requires them.
- **Session**: continue coherent direct work under the current Project/Session.
- **Run**: use a WholePlan, ContextCapsule, ExecutionContract, ResultPacket, and
  Fresh HEAD review for durable or risky execution.
- **Authority**: require the exact scoped ReviewDecision for Canon or another
  protected state transition.

`head_operating_lane_recommend` is advisory. Risk and reversibility decide the
lane; tool availability does not.

## Context and execution

For context-sensitive work, call live `head_context_preview` first with the
task text held byte-identical. Verify identity, freshness, evidence coverage,
and semantic sufficiency separately. Persist a Capsule only when the Run or
recovery boundary needs it.

Read the returned `workflow` before consuming the Capsule. HEAD—not the tool—
performs semantic task analysis and chooses task-required EvidenceNeeds,
including exact repository paths and Product Canon entity keys when known. Lexical overlap is fallback ranking
only and never candidate eligibility. The read-only preview automatically retries
the same task and EvidenceNeeds at the next fixed tier only when matching
evidence was excluded by `context-budget`; inspect `attemptedTiers`, Capsule IDs,
and coverage-proof digests. It stops on missing or stale World, genuinely missing
evidence, coverage completion, or the 512K hard maximum. A
`ready_for_head_semantic_assessment` result means mechanical inclusion is
complete; make and state the separate HEAD-owned semantic judgment. The
workflow is non-persisted advice and cannot activate Product, mutate World,
persist a Capsule, authorize execution, review a result, or write recovery
direction.

For Product-to-code or Product-to-test mapping, inspect the current World and
Graph, then use `head_feature_mapping_propose` with exact current Product and
source/test node identities. Do not derive mappings from names or token overlap.
Present every candidate to the user. Only after an explicit user disposition,
call `head_feature_mapping_review` with the exact candidate-set ID and
`confirm_user_review: true`; proposal, model agreement, or tool success alone
never creates a reviewed relationship or changes Product Canon.

For a durable Run, preserve this sequence:

```text
WholePlanSnapshot -> ExecutionContract + ContextCapsule -> ResultPacket
                  -> Fresh HEAD review -> ReviewDecision -> next generation
```

A worker or provider may execute only the accepted contract. It cannot widen
scope, approve its own result, update Canon, or author the next recovery
direction. Read `references/authority-and-roles.md` for role rules and
`../../docs/execution-lineage.md` before changing Run lineage.

## Recovery and compaction

Restore P2 first from `.head/project.json`, `.head/sessions/current.json`, and
the exact content-addressed checkpoint. Provider resume or live attachment is
optional and occurs only after artifact recovery succeeds.

Compaction is an intentional lossy provider operation. Prepare an immutable
checkpoint, compact outside Core, verify against trusted real-user-turn
evidence, then consume the one-shot continuation token. A provider summary,
transcript, graph, Capsule, ResultPacket, or continuity view must never rewrite
purpose, approved decisions, current position, or next expected result. A newer
user turn supersedes continuation. Read `../../docs/compaction-recovery.md`
before any recovery-sensitive compaction.

## Progressive routing

Load only the reference needed for the current outcome:

- Product onboarding, Product Canon, World Model, GraphDB, Markdown, or source
  scope: use `head-agent-onboarding`, then read the linked subsystem document.
- Context compilation: read `references/context-compiler.md`.
- Roles, worker boundaries, review, and authority: read
  `references/authority-and-roles.md`.
- Provider/runtime/host composition: read `references/runtime-composition.md`.
- Session restore: read `../../docs/session-recovery.md`.
- Bounded workers or waves: read `../../docs/bounded-worker-wave.md`.
- Role messaging: read `../../docs/role-coordination.md`.
- Full CLI discovery: run `node <plugin-root>/scripts/head.mjs help-all`.

Never substitute Herdr-specific panes, services, or session identity for these
contracts. Host-specific outcomes belong behind optional provider-neutral
adapters with the same identity, authority, cleanup, and evidence fences.

## Essential commands

Resolve this skill directory and invoke `../../scripts/head.mjs` with Node:

```text
node <plugin-root>/scripts/head.mjs init <project> --runtime claude,codex,opencode
node <plugin-root>/scripts/head.mjs resume <project> --runtime claude,codex,opencode
node <plugin-root>/scripts/head.mjs init <project> --profile product --input <onboarding.json>
node <plugin-root>/scripts/head.mjs status <project>
node <plugin-root>/scripts/head.mjs help-all
```

Initialization writes only absent managed files. Preserve existing root
instructions and report generated alternatives under `.head/generated/` for
manual integration.
