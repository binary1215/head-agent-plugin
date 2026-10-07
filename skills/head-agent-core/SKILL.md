---
name: head-agent-core
description: Initialize, recover, or operate a provider-neutral HEAD Project with common user direction and independently routed logical Sessions, graph-first discovery, direct work, optional bounded delegation, and durable recovery. Use for HEAD Agent Core, context recovery, compaction, selected context handoff, multi-step Runs, or worker coordination.
---

# HEAD Agent Core

HEAD keeps the user's objective, constraints and acceptance criteria connected
to execution and completion. Continuity belongs to canonical project records,
rather than a model, provider conversation, host, database or transcript.
Understand the request, find needed context, work directly or delegate useful
outcomes, integrate results, and preserve important changes.

## Constitution

1. Keep one canonical Project with common user direction and independently
   routed logical HEAD Sessions. Each owns its purpose, progress and recovery.
2. Apply current common constraints across Sessions. Restoring an earlier
   Session cannot undo a later common deployment cancellation.
3. Find new project information through bounded graph discovery first, or reuse
   sufficient same-basis results. Continue from original records when needed.
4. Treat results, observations, messages and external reviews as evidence.
   Historical approval does not grant current effect authorization.
5. Keep graphs, indexes, Markdown and continuity views replaceable. Important
   decisions and recovery direction remain in their original records.
6. Change Product Canon through the explicit user ReviewDecision for its exact
   current candidate. Ordinary authorized fixes need no extra review ceremony.
7. Keep provider capability behind adapters with the same authority semantics.
   Fork, availability and operational success create no authority.

P1-P5 is internal enforcement, not a user form. Before changing authority or
recovery, read [the constitution](../../docs/head-constitution.md) and
[authority planes](../../docs/authority-plane-contract.md).

## Enter and keep working

When the user invokes HEAD or the exact project already has a HEAD Project,
initialize/resume with `head_project_initialize_or_resume`, exact root and
default `profile: "core"`, then call read-only `head_conversation_enter`.
Continue the original task in the same turn. Carry the task once; do not ask
for a repeat request, profile choice, JSON or recovery ritual.

Core preserves identities and indexes eligible existing observations where
available, without inferring Product meaning. Use `profile: "product"` and the
sibling onboarding Skill for an actual Product/World governance outcome.
Do not initialize an unrelated repository merely because a coding request
matched this Skill.

Entry includes recovery, common direction, status, Attention, version and
presentation. Reuse it without another status call unless the basis changes or
diagnosis needs one. No checkpoint means ordinary work continues. Recovery
attention pauses only dependent work and assigns investigation to HEAD.
After compaction/provider replacement, restore the selected Session automatically
and apply current common constraints. Never invent direction from a transcript.

Use optional `session_id` on typed calls or `--session` on CLI for request-local
routing. `head_session_list` and `head_session_create` support independent
progress when needed; these are logical identities, not provider session IDs.
The legacy `.head/sessions/current.json` remains the default record.
Read shared goal/constraints/decisions/cancelled actions through
`head_project_direction_read`; publish current user direction through
`head_project_direction_update` with its exact basis. Reconcile competing
updates rather than last-writer overwrite. A Session's local investigation
change does not automatically change another Session's goal.

## Find context through the graph

For new project information, call `head_project_graph` with task/query and only
useful anchors/filters, or reuse sufficient same-basis results. Read nearby
relations first and widen when needed. Avoid whole-graph prompt injection and
per-turn full rescans. HEAD interprets relevance; lexical overlap is a hint.

Natural questions search bounded display/domain evidence, not metadata keys.
Exact names, paths or anchors help narrow a partial result; HEAD supplies them
without asking the user to rewrite the task. Common direction excerpts include
constraints, decisions and cancellations with current/historical revision labels.
Read the original direction when the excerpt is partial or before relying on it
for a current effect; its graph copy grants no permission.

For code impact, use existing `head_world_query` / CLI `world-query` for bounded
`IMPORTS`/`CALLS` neighbors, not general `CONTAINS`/`HAS_REVISION`/`DECLARES`
expansion. With absent or stale World evidence, inspect affected current source
imports/calls directly. Do not require a whole World refresh, new Run or approval
just to investigate; retained links are hints to verify, not current impact proof.

Read basis/revision, integrity, freshness, coverage, original state and provenance
together. Work and Product are linked logical views of common original records.
Different revisions of the same path remain distinct. Intact historical evidence
stays readable and labelled, including unapproved/rejected state through relation
expansion. Reference or sequence does not prove cause.

Empty/partial coverage does not prove absence. Use disclosed original-source
fallback on absence or failure. Reuse known same-basis adapter failures without
repeated requests; retry when that basis changes. Exclude the damaged or
cross-Project layer while using remaining valid evidence. Full World currentness,
Product approval, Run, Capsule, indexing completion and ArcadeDB connectivity
are not general exploration gates. Before changes, recheck affected current
sources and effect authority.
Read [project discovery](references/project-discovery.md) for implementation.

## Choose execution and preserve judgment

Work directly for small tasks. Delegate independently reviewable outcomes when
parallel work helps or long sequential execution/review could crowd out the
context needed to judge the whole objective. Brief each worker with outcome,
allowed context, file ownership, constraints and useful completion evidence.
Reconcile overlapping writes and preserve other workers' and user changes.

Use ordinary Host delegation when sufficient. Use managed execution when durable
ownership, interruption recovery, uncertain effects or duplicate integration
prevention need tracking. File edits, worker count and ordinary failure alone
do not force managed execution. A new managed wave may serve a useful durable
outcome; existing managed work and unknown effects retain their contracts.
Read [runtime composition](references/runtime-composition.md) for exact entries.

Fork/fresh is a separate context choice: supported in-scope fork can preserve
prior design reasons; selected fresh context can support narrow work or independent
review. Neither grants approval, Canon/P2 authority, file isolation, cache reuse
or lower cost. Preserve semantically sufficient context.

HEAD checks objective achievement, new facts, uncertainty and supporting evidence.
Keep completed contributions and continue independent unfinished work. Before
replacing unknown work, inspect its exact effects. A cancel request does not
prove exit. Wait for/cancel owned work and verify cleanup. Do not replay uncertain
external effects blindly. For durable Runs, retain accepted lineage, ResultPacket,
Fresh HEAD review, explicit ReviewDecision and checkpoint integration.
Wave success is operational evidence, not approval or P2 direction.

## Keep conversation light

Lead with the outcome. Successful entry, reuse and sync are quiet; explain
exceptions by affected operation, actor and next action. Bind natural-language
protected decisions to the unique unchanged target. IDs, token tiers, digests
and schemas are diagnostic detail, not user prerequisites.

Preserve important changes, judgments, results and uncertainty when continuity
needs them. Do not create checkpoints, receipts, candidates, structured notes or
transcript copies for every read/turn. Capsules and fixed budget tiers serve
optional reproducible handoff/recovery, not ordinary exploration.

## Progressive references and tools

Load only what the current outcome needs:

- Graph discovery, logical Sessions and common direction:
  [project discovery](references/project-discovery.md).
- Reproducible Context: [context workflow](references/context-workflow.md) and
  [compiler](references/context-compiler.md).
- Checkpoint sync and compaction: [recovery workflow](references/recovery-workflow.md)
  and [Session recovery](../../docs/session-recovery.md).
- Delegation and fork/fresh: [runtime composition](references/runtime-composition.md)
  and [follow-up handoffs](references/runtime-composition.md#follow-up-handoffs).
- Roles and authority: [authority and roles](references/authority-and-roles.md).
- Decisions, waiting, results and optional Product evidence:
  [conversation UX](references/conversation-ux.md).
- Product governance: sibling `head-agent-onboarding`, then its subsystem docs.

Default MCP includes graph discovery and ordinary Core entry/recovery.
For optional tools use `head_tools_discover` by name/prefix and its `invokeWith`
route with the unchanged schema. Known tools need no prior discovery. HEAD supplies
arguments without user unlock/forms. For useful managed execution,
`head_tools_call` accepts `execution_mode: "managed"`; routing preserves original
authority/lease/effect checks. Read/status/wait and exact owned cancellation remain
ordinary diagnostics.

```text
node <plugin-root>/scripts/head.mjs init <project> --runtime claude,codex,opencode
node <plugin-root>/scripts/head.mjs resume <project> --session <logical-session>
node <plugin-root>/scripts/head.mjs graph-query <project> --query "<task>"
node <plugin-root>/scripts/head.mjs session-list <project>
node <plugin-root>/scripts/head.mjs managed <command> <project> <arguments>
node <plugin-root>/scripts/head.mjs help-all
```

Initialization preserves existing root instructions and reports generated
alternatives under `.head/generated/` for manual integration.
