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

Entry includes current direction, useful work context, recovery, status and
Attention. Reuse it quietly unless its basis changes or diagnosis needs more.
No checkpoint means ordinary work continues. After compaction/provider replacement,
read the selected Session automatically with current common constraints; never
invent direction from a transcript. Missing direction is not approved emptiness.
Selection loss pauses only dependent work; use verified explicit/Host selection
there and continue independent work. Partial entry is not recovery success.
Do not add a recovery chain, repeated question, Session list or user ID form.

Use optional `session_id` on typed calls or `--session` on CLI for request-local
routing. `head_session_list` and `head_session_create` support independent
progress when needed; these are logical identities, not provider session IDs.
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

## Agree the work, not the paperwork

Reuse concrete user agreement that remains valid for the current request,
constraints and cancellations. Agree unresolved material user-visible behavior,
scope, conditions and important user-owned architecture choices. Re-agree only
the material delta, impact and options, not routine internal choices. Small exact
fixes proceed directly; analysis/proposal-only stays read-only. Preparation stays
within current authority; reversibility grants none. Only choice-dependent
implementation waits while approved independent work continues.

For nontrivial implementation, clarify purpose, agreed behavior, scope,
acceptance, component responsibilities/connections and important uncertainty in
useful existing work context. No fixed questions, new plan file, save-success
gate or prerequisite reference/tool chain is required. HEAD owns routine internal
design, verification and error handling. Verify the agreed behavior and report
meaningful deviations and unknowns without mandatory report sections.

Summaries, reviewer assent and model inference create no user authority. A short
reply must clearly answer a concrete proposal and scope. Reconcile recovered
agreements with current requests and cancellations; ordinary agreement reuse
cannot replace the current user decision for a new or changed protected target.

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

## Finish changes with usable graph evidence

After a meaningful code-change or feature-addition work segment, HEAD checks
whether the integrated result needs a graph update. Connect affected code and
the purpose, decisions and verification needed by later work to their originals;
reuse updates already made by persistence hooks. Use the existing index or World
refresh when needed, then check supported affected relations and disclose what
remains unverified or unprojected. Test presence is not an executed PASS.
Workers return changes, evidence and unknowns; HEAD owns the integrated update.
Do not require every worker or turn to refresh globally, activate World/DB,
create a Run/Capsule, install a watcher or ask for routine approval. On update
failure, retain the affected gap and continue source fallback and independent work.
Read [project discovery](references/project-discovery.md#after-integrated-changes)
for the distinct existing update paths and their limits.

## Keep conversation light

Lead with the outcome. Successful entry, reuse and sync are quiet; explain
exceptions by affected operation, actor and next action. Bind natural-language
protected decisions to the unique unchanged target. IDs, token tiers, digests
and schemas are diagnostic detail, not user prerequisites.

Reuse existing checkpoint/result/review/source originals. Preserve only useful,
otherwise-unrepresented reasons, alternatives, observations and uncertainty at a
meaningful handoff: optional `work_evidence` with an already useful checkpoint
sync, or `head_session_work_record` for Run-free work. No per-turn record,
transcript copy, save approval, user JSON, compulsory budget tier or Run/Capsule.
Session-local purpose/constraints/cancellation stay in explicit P2 direction;
P3 evidence cannot supply them or change shared ProjectDirection.

A management-record failure limits dependent management work, not independent
work. Preserve primary identity/digest/permission/partial-write failures and
required ReviewDecision; saving grants no execution permission. Repair missing
persistence without replaying completed or uncertain effects.

Entry already supplies bounded `workContext`. Default selection considers recent
verified work across the discovered originals; time order is not semantic
importance or authority. Expand with `head_session_work_read` only when useful.
Preserve uncertainty and disclose missing sources; historical suggestions and
claimed completion are not instructions, approval or effect proof. Repair missing
persistence, never repeat completed or unknown effects. Unsaved conversation can
still be lost on abrupt exit.

At those same useful preservation boundaries, reuse returned exact evidence
selectors for optional `workLink` root/predecessor and exact-target historical
`executionObservation`. Use existing artifact references for an earlier judgment
whose actual reasons matter. Default entry can include that cited body and the
declared anchor alongside recent results/pending work. Do not add start/end saves,
IDs or questions for this. Coexisting saved states are neither a current live
state nor a conflict; a close qualifies its exact old note, not later resumes,
other branches, required review or remaining work. Expand only useful omissions.

Native init/resume can retain verified selection; startup only reads that linkage.
Its loss does not erase Core success or permit replay. Other reads, work recording
and checkpoint sync do not select the chat.
Use a verified explicit route on unsupported Hosts, without bind/save questions
or identity guesses. Host-only helpers are not model tools or permission bypasses.
For relevant routing, bounds or recovery details see
[work context and Host limits](../../docs/session-work-context.md); this is not a
required extra read before ordinary work.

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
