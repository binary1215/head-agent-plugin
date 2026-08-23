# Original HEAD Core comparison

Reviewed: 2026-08-20

This document compares the extracted `Won6314/head-agent-core` reference with
this provider-neutral plugin. It records design lineage, adopted corrections,
and the remaining limits of a claim that this plugin is preferable for
universal plugin use. It does not claim to be an official upstream release, a
drop-in replacement, or a superset of every upstream host capability.

## Reference basis

The comparison uses the original repository's current shared Core sources:

- `packages/core/head/HEAD_CORE.md` for whole-outcome ownership and decision
  authority;
- `packages/core/docs/FOUNDATIONS.md` for bounded context, canon, delegation,
  evidence, and Core/project boundaries;
- `packages/core/docs/TECHNICAL_ARCHITECTURE.md` for the installed OpenCode,
  Herdr, Session/Run, worker, and role-message architecture;
- `packages/core/theory/04-evolution-evidence-and-limits.md` and the general-rule
  course for proportional machinery and generative rules.

The reference establishes six portable principles that this plugin must retain:

1. HEAD owns the whole outcome while the user owns material direction.
2. One connected primary flow is stronger evidence than disconnected ceremony.
3. Context is the smallest complete authoritative set for one owner and result.
4. Session/Run canon survives lossy conversation and generated summaries.
5. A worker result is evidence, not automatic authority.
6. Structure scales with consequence, coordination, continuity, and evidence.

## Structural comparison

| Concern | Original HEAD Core | This plugin | Universal-plugin consequence |
| --- | --- | --- | --- |
| Runtime composition | A user-scoped OpenCode/Herdr installation with one loopback coordination daemon and exact pane/tab/session evidence | One provider-neutral Core with typed Codex and OpenCode adapters, a portable CLI/MCP surface, runtime-independent HEAD identities, an injected exact-endpoint WorkspaceHost contract, and a production host-export filesystem bridge | Provider replacement does not replace project meaning; the plugin generalizes endpoint identity and external-host delivery without embedding host-specific executable, socket, command, pane, or TUI knowledge, while the original still has the established installed-Herdr provider-client operating path |
| Durable authority | Project-owned Session/Run canon plus host-owned task/message state | Git-independent Project, Session, Run, Product Canon, World Model, Context, Execution Lineage, and recovery artifacts | More semantic and execution state is portable across providers and storage backends |
| Graph role | A retrieval index whose linked source files remain authoritative | An embedded content-addressed GraphSnapshot with local, GraphDB, and document projections that remain rebuildable and non-authoritative | Graph storage is optional and cannot become a hidden orchestrator or source of truth |
| Product model | Product and policy definitions remain project-owned extensions | Strict user-owned Product Canon plus candidate/review boundaries and a Product Operating Loop | Product learning is integrated without allowing inference or outcomes to promote Canon |
| Ordinary work | Direct coherent work is the default; Run, worker, graph, and formal review are conditional | Observe, Session, Run, and Authority lanes select the lightest safe contract; the recommendation itself has no authority | Universal use does not force heavyweight lineage onto read/reason work |
| Continuity | Canonical Session/Run recovery and at most one explicit post-compaction continuation | Canonical Session/Run recovery plus an on-demand, non-persisted continuity view; provider conversations and transcripts remain non-canonical | Cross-provider recovery is semantic rather than a promise to restore a provider session |
| Distribution | Immutable release composition, project initialization, OpenCode integration, host daemon, roles, and procedures | Git-backed Codex marketplace package, OpenCode/Codex runtime paths, optional native workers, and Windows/macOS/Linux installation | The plugin is broader across providers and hosts; universal-directory publication remains publisher-owned and incomplete |

## Strict surfaces narrowed from the earlier plugin design

The original design rejects permanent machinery that has not earned its
coordination, context, or maintenance cost. The alpha.66 implementation applies
that correction at executable boundaries:

- `ProductLearningNote` keeps an observation, hypothesis, or inferred meaning
  ephemeral by default. It has no content identity, graph node, persistence, or
  authority. The Core recommends persistence only for cross-Run recovery,
  rebuttal/audit, product state, or handoff/context-loss needs.
- `recommendOperatingLane` is a pure advisory classifier. Observe adds no
  WholePlan, Capsule, Run, lease, or review. Session covers one bounded
  reversible result. Run is selected for dependency, recovery, or independent
  review needs. Authority is selected only at the affected user-owned boundary.
- Product and continuity reads can reuse a disclosed same-process snapshot or
  content-identity cache. Core writes invalidate it, and `--fresh` forces full
  verification. The cache never grants instruction, promotion, or recovery
  authority.
- An Initiative can begin from explicit inline reasoning without first creating
  Signals or Hypotheses. Feature resolution can be deferred until acceptance,
  so an unreviewed proposal creates no `ProductFeatureCandidate` by default.
- The seven existing Product Operating Loop operations remain available for
  durable work, but they are no longer the mandatory entrance to ordinary
  observation or planning.
- `head help` exposes only the light default surface; `head help-all` retains
  every advanced, compatibility, audit, and recovery command. The lane
  recommendation is explicitly optional and cannot guard another operation.

The universal red lines remain: epistemic classes do not merge; a candidate is
immutable; review is a separate artifact; Product Canon never changes from
model inference; external writes, credentials, material initiative decisions,
and recovery-canon replacement stay user-owned; provider transcripts, Git,
GraphDB, documents, and adapters remain non-authoritative.

## Connected implementation evidence

The default path is now demonstrable end to end:

```text
read or reason
  -> ephemeral typed note
  -> advisory risk lane
  -> direct bounded work when safe
  -> immutable Initiative candidate only when durable product action is needed
  -> separate user ReviewDecision
  -> Feature resolution at acceptance
  -> accepted execution lineage for consequential implementation
```

The integrated tests verify that notes create no project artifacts or graph
nodes, direct reasoning needs no prerequisite Signal/Hypothesis, rejected or
unconfirmed reviews write nothing, accepted review preserves candidate bytes,
Feature candidates appear only at review time, Product Canon remains unchanged,
cache hits are disclosed and invalidated by writes, `--fresh` works, and an
externally tampered cached artifact is rejected when its filesystem identity
changes. The full suite, plugin validator, Skill validator, and syntax checks
are release gates for this change.

## Advantages and remaining gaps

For a provider-neutral, Git-optional, GraphDB-optional plugin, this repository
has stronger portable semantics than the original runtime composition:

- project, product, graph, change, execution, and recovery identities do not
  depend on one provider session or one host daemon;
- three provider adapters share one semantic Core instead of forking authority;
- Windows, macOS, and Linux installation and exact descendant cleanup are part
  of the tested distribution;
- Product Canon, candidate review, temporal provenance, Context compilation,
  execution review, and optional projections form one connected contract;
- the light ordinary path now preserves the original's proportionality rather
  than making those deeper contracts universal overhead.

The original still has capabilities this plugin deliberately has not claimed:
general provider-session resume/stream and an established installed-Herdr
operating path. The plugin now has provider-neutral
host-bound durable project-role messaging, append-only exact endpoint targets,
fresh-snapshot/ack/post-snapshot delivery fencing, deterministic two-fresh-process
Codex/OpenCode generic-host evidence, and a production host-export bridge whose
separate live consumer acknowledges create-only requests. The external host binds
each exported endpoint uniquely to the current coordination binding plus one
per-process proof, so snapshot membership or copied coordinates cannot self-claim
another role's live caller identity. It does not bundle a
Herdr-specific adapter. Actual already-running Codex/OpenCode tool consumption,
P2-first optional exact HEAD attachment, bounded worker dispatch/own/wait/result/
review/integration, and exact-owned one-shot interrupt/close are verified on
Windows through the portable host/runtime contracts. Automatic DAG
merge/conflict resolution, Obsidian/Notion publication, and OpenAI universal
plugin-directory publication also remain incomplete. These are extension gaps,
not reasons to weaken authority separation, but they bound any superiority
claim.

The original author directly audited the earlier caller-fencing and recovery
slices and reported no blocking correction. The later actual provider-client and
hostless recovery evidence closed those prior scenario gaps. Claude Code now has
the same deterministic one-shot authorization, lease, supervisor, result,
compaction, and projection contracts. Its live model-call and already-running
host round trips remain separate opt-in evidence gates. The current portable
continuation, independently ownable worker, and Claude Code adapter slices still
require one new direct audit of the exact pushed source before the three
unconditional final superiority verdicts may be claimed.

## Claim boundary for author review

The proposition to validate is narrow:

> For universal provider-neutral plugin use, this repository now preserves the
> original HEAD philosophy while providing a more portable semantic,
> product-authority, graph, execution-lineage, and distribution foundation.

The proposition is false if any mandatory everyday rule still lacks a protected
outcome, if the new light path can bypass a user-owned authority transition, if
the cache merges independent trust boundaries, or if an original portable Core
responsibility was lost rather than relocated. It does not assert superiority
for host-native coordination until actual Codex/OpenCode provider clients consume
the host-export wake, complete the role-tool round trip, and pass original-author
source audit.

## Original-author review outcome

The text-only file-mail review concluded on 2026-08-20 after the author first
withheld a broad superiority claim, named the missing comparison evidence, and
then reviewed the supplied bilateral module inventory and execution receipts.
The final response was `20260820T091221Z--scoped-foundation-breadth` to request
`20260820T091129Z--bilateral-evidence-verdict`.

The accepted comparison is deliberately scoped:

> Given the cited modules and execution receipt, `head_core_origin/6e66771`
> does not replace the original's OpenCode/Herdr live-coordination advantage,
> but provides a broader shared-Core foundation for provider-neutral runtime
> coverage, fixture-verified provider-replacement semantic recovery, and
> integrated Git-independent product/change/execution evidence.

The author classified this as a **scope-limited comparative advantage for
universal provider-neutral plugin use**. The component verdict was:

- provider coverage: yes;
- provider replacement: partial, limited to the two real adapter/supervisor
  paths exercised with protocol fixtures across a fresh process;
- product/change/temporal implementation integrated into the shared release:
  yes, broader than the original base release;
- cross-platform distribution breadth: yes.

This is not approval of overall superiority, philosophical superiority,
OpenCode/Herdr-native completeness, or live provider-network replacement
completeness. At the time of that verdict, the original remained stronger in
Herdr workspace/pane/session fencing and live coordination delivery. Since then,
the plugin has implemented the provider-neutral exact-endpoint contract and
production host-export bridge described above and explicitly rejected an embedded
Herdr-specific driver. A separate live host consumer passes, but no actual
Codex/OpenCode provider-client coordination or new author verdict has yet replaced
that historical conclusion. Graph non-authority,
whole-outcome ownership,
and candidate/review separation remain inherited standards, not dimensions in
which this plugin claims to have improved the original philosophy.

The receipt supporting the partial replacement verdict is
`scripts/verify-provider-replacement-recovery.mjs`: Codex and OpenCode adapter
and supervisor paths preserved the exact Project and HEAD Session identities
across a fresh process, created a new authorization, recovered the replacement
result from project artifacts, persisted no provider-session identity, and
required neither Git nor GraphDB. It uses isolated protocol fixtures and does
not claim a live provider-network handoff.
