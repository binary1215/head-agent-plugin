# Graph-first discovery and independent Sessions

## Ordinary use

Tell HEAD the task once. HEAD restores the relevant logical Session and current
common direction, then queries nearby project relations before seeking new
information. Reuse sufficient same-basis results. Missing or failed graph layers
lead to original files and records. No full World refresh, Product approval,
Run/Capsule, completed index or database is required to begin ordinary exploration.

The work view connects Sessions, changes, results, review and recovery records.
The Product view connects product goals, requirements, decisions and source
evidence. Both reference common originals instead of storing the same decision
twice. Current and historical revisions, unapproved candidates and rejected
records keep their own identities and states through expansion. Graph paths
explain provenance and sequence; they do not by themselves establish cause.

## Query and fallback

The default typed MCP entry is `head_project_graph`. HEAD supplies `project_root`
and `query` from the task, with optional `anchor_ids`, `paths`, `depth`,
`max_nodes`, `max_edges`, `view` (`all`, `work`, `product`),
`world_model_id`, `previous_result`, `include_candidates` and `session_id`.
Bounds limit transport; they are not a task-sufficiency decision or a user form.
Inclusive integer bounds are depth 0–8, nodes 1–500 and edges 0–1000. Zero edges
is a supported nodes-only query in Core, CLI and MCP; it does not mean zero nodes.
Out-of-range values and non-integer typed inputs are rejected rather than coerced.

The default compact result selects 8 nodes and 12 edges, retaining identity,
revision/state, provenance and coverage while omitting rich repeated payload.
Use `details: true` with returned anchors for original bounded detail and
relations; detailed defaults are 60 nodes and 120 edges. Explicit bounds can
expand either view. A short result never proves task sufficiency.

Natural-language questions match bounded display/domain values, excluding
authority flags and revision/provenance boilerplate. Rare matching terms help
order results before the transport bound. This is deterministic lexical
navigation, not semantic inference: HEAD judges relevance and missing context.
Punctuation, identifier parts and Korean particle aliases aid lookup without
replacing the original term. Exact paths/anchors remain available; HEAD supplies
them when useful, rather than asking the user to write a query or scoring form.

```text
head-agent graph-query <project> --query "<task>"
head-agent graph-index <project>
head-agent session-list <project>
head-agent session-create <project> --purpose "<independent work>"
head-agent graph-query <project> --session <logical-session> --query "<task>"
```

`head_project_graph_index` / `graph-index` explicitly updates the replaceable
existing-observation index. Core initialize/resume and source/observation
persistence also update it where useful. Unchanged input is reused. Queries do
not create per-read receipts, candidates, approvals or checkpoints.

Read basis/revision, integrity, freshness, coverage, original state and provenance
with the result. Intact historical inputs may be useful evidence even when they
cannot authorize a present effect. A damaged or cross-Project layer is excluded;
unrelated valid layers remain usable. Empty/partial results do not prove that
facts do not exist. Use the returned original-source fallback and widen only the
missing context. A sufficient previous result or known same-basis adapter failure
may be reused without another adapter request. Requery when its relevant basis
changes. Current-effect checks remain independent.

### Scoped repeat reads

For an exact local anchor with no text/path search and no World/custom store or
adapter, Core may reuse a process-local discovery after checking Project and
index bytes, directory names/types, selected originals, relation producers and
boundary endpoints, selected source bytes, and hidden review/lineage/Session/Run
dependencies. All typed records except unrelated additional Session current-state
bodies remain in the byte proof. Missing/stale index, membership change or proof
failure silently uses the existing original-backed discovery, not a new gate.

This narrower result has its own identity and `scoped-originals-reused` status.
`verifiedLayers` is empty; `retainedVerifiedLayers` describes the earlier typed
discovery and `verifiedRecordPaths` lists up to 256 current byte-proof paths;
`verifiedRecordCount` and `omittedVerifiedRecordPathCount` disclose the remainder. Basis digests
for the inventory/relations remain a retained discovery basis, not whole-project
currentness. Coverage says unrelated record bytes were not reverified and current
membership means names/types only. Sources outside selected/boundary nodes and
new relations introduced by edits to unread Session bodies remain unverified;
original-source fallback stays available and needed. Before effects, read the
affected originals and use the independent current-effect checks. New anchors
and broad queries can rediscover external changes without extra user approval.

Cold reads, ranked/path searches, source-collection-failure anchors, retained World and optional/custom adapter
queries still use the full existing path. Membership and index bytes grow with
the record set; cold preparation adds proof/index/membership work. Fewer warm
file reads is not a constant-byte or latency claim, and small projects can read
more bytes due to the index. No query writes a record or installs a watcher.

### Installed package versus active connection

Installed-file integrity and the current conversation's MCP schema/runtime are
separate checks. Use that conversation's existing read-only entry and graph
tools on the intended root; do not initialize an arbitrary Project or treat a
different chat's successful call as proof that this chat reloaded. A zero-edge
bound rejection is not an import/installation failure. A fresh CLI or a separately
launched app-server also does not verify the desktop conversation's connection.

The [official app-server documentation](https://learn.chatgpt.com/docs/app-server)
describes `config/mcpServer/reload` as reloading disk configuration and queuing
refresh for loaded threads. Use a supported Host reload only where that operation
is actually exposed and authorized, then check the target conversation again.
This plugin does not provide that desktop Host operation. If unavailable, report
the active connection as unverified rather than killing shared MCP processes,
editing caches or claiming automatic repair.

Optional ArcadeDB preserves activated temporal-query verification and embedded
fallback. Combined original-record traversal remains Core/local; this path does
not claim combined acceleration. Existing prepared-traversal acceleration follows
its separate adapter contract. Local index and original-source fallback remain usable.
This implementation's source/fixture tests do not establish new live ArcadeDB,
Host lifecycle or model behavior evidence. Speed, token savings and quality
improvements remain hypotheses until measured.

Paths-only requests bind logical File anchors from the verified retained World
to its exact snapshot for optional temporal adapter verification. With no usable
temporal selector, browsing and Work-only anchors remain `not-used` combined-local
navigation, not adapter failure. A genuine adapter failure retains its reason and
same-basis fallback reuse. Neither path claims combined traversal acceleration.

## Code impact versus record navigation

General `CONTAINS`, `HAS_REVISION` and `DECLARES` paths connect records and
versions; expanding them is not code-impact analysis. For a symbol's import/call
neighbors use existing `head_world_query` or:

```text
head-agent world-query <project> --query "<symbol>" --depth 3 --limit 20
```

This bounded `IMPORTS`/`CALLS` lookup uses the World capability when available.
HEAD accesses the optional MCP tool through its existing discover/invoke route;
no new user setup is required. If World is absent or its relevant source is stale,
read the affected current imports/calls directly. Retained links may guide that
inspection but do not prove current impact. Do not make whole-World refresh,
new Run, Product review or database activation an investigation gate.

## Maintain evidence after integrated changes

At the end of a meaningful code-change or feature-addition segment, HEAD checks
the integrated result for needed graph maintenance. Include added, changed,
deleted or renamed code and affected references/imports/calls, not only edited
files. Workers return their changes, original evidence and unknowns; HEAD
reconciles the combined checkout and owns its update and verification. Workers
do not each perform an uncoordinated global refresh.

| Existing surface | What it does | What it does not do |
| --- | --- | --- |
| `head_project_graph_index` / `graph-index` | Refreshes the replaceable inventory of existing verified records and observations; reuses identical input | Does not extract new repository code relations or infer a feature |
| `world-refresh` | Refreshes an already active World, including its supported code relations and revision evidence | Does not activate missing Product/World capability or grant approval |
| `head_world_model`, `head_incremental_refresh_status`, `head_world_query` / `world-query` | Reads freshness/refresh evidence or bounded affected relations | Does not trigger a World refresh |

Core initialization/resume and supported source/observation persistence already
update the observation inventory. Reuse their sufficiently current results;
an explicit index is useful for relevant new/missing records or reconciliation,
not a ritual after every save. When follow-up work needs existing World relations,
the current refresh discovers and reads/hashes **all eligible files** under the
configured source scope, reuses unchanged semantic analysis, and recomputes
supported links against the current file set. It is not a changed-files-only
reader. Unchanged callers may gain or lose resolved targets. Preserve excluded
scope, analyzer support/confidence, unresolved imports/calls and other unknowns.
A rename may be observed as remove/add; a name match alone cannot establish
semantic identity or verified rename lineage.

HEAD connects a feature's purpose/requirements to its implementation and actual
verification through existing source documents, user direction, code references
and applicable observation/result/candidate records. Keep original paths,
digests/revisions and approval state. A test's presence is not a PASS: execution
needs the actual command, tested basis, result and uncertainty. Indexing plain
documents, general conversation or successful execution does not automatically
create Product Canon or approval; existing exact user review remains unchanged.
Reference current user direction; do not write P2 direction just to store a
feature explanation.
Existing graph schemas project supported references; they do not automatically
turn arbitrary prose into typed feature-to-code-to-test edges. Keep unsupported
links in the originals and disclose what is still unprojected. Durable evidence
is retained when later work needs it, without a new compulsory form, Run or record
for every edit. Existing active/unknown execution contracts still apply; refreshing
the graph does not rewrite their digest-bound inputs or authorize another effect.

```text
head-agent graph-index <project>
head-agent world-refresh <project>
head-agent world-query <project> --query "<affected symbol>" --depth 3 --limit 20
```

Use only the relevant path. No World/DB activation, full reindex, Run/Capsule,
watcher installation or routine user approval is required for ordinary work.
If maintenance fails, retain affected unreflected paths/records and uncertainty;
verify current originals and continue independent work. A retained old graph is
historical evidence, not proof that the new code is reflected. This completion
guidance uses existing capabilities; it is not a new automatic Host lifecycle hook.

Representative checks, selected according to the task rather than required as
one universal checklist: an edit changes current source evidence and supported
neighbors; a new feature keeps purpose/implementation/test references while test
execution remains separate; deletion/rename removes obsolete current relations
without erasing history; parallel integration updates the combined basis; and
refresh failure leaves a disclosed gap with usable original-source fallback.

## Route independent progress

One canonical Project holds common user direction. The original Session record
`.head/sessions/current.json` remains the default. Additional logical Sessions
use `.head/sessions/by-id/<session-id>/current.json`. Request-local `session_id`
(MCP) or `--session` (CLI) selects a Session without switching/overwriting the
default. `head_session_list` lists logical Sessions; `head_session_create`
accepts optional `new_session_id` and `purpose`. An existing ID is not rebound
to another purpose. These identities are independent of provider sessions.

Each Session retains local purpose, progress, active/unknown work, approvals and
checkpoints. One Session's investigation scope does not redirect another's task.
Existing records remain in place; routing does not require re-onboarding.

## Current common direction

`head_project_direction_read` / `project-direction-read` returns the current
`ProjectDirection` or no record. Its `input` holds `goal`, `constraints`,
`decisions` and `cancelledActions`. It is P2 current user direction and grants
no execution authorization. Publish actual current user direction with
`head_project_direction_update` using the read `expected_direction_id` (null
for first publication) and `direction` object. CLI uses
`project-direction-update --input <direction.json> --expected-direction <id>`.
HEAD supplies the typed input from the conversation; users do not fill a form.

The pointer `.head/project-direction/current.json` references immutable revisions.
Exact-basis comparison reconciles competing updates; timestamp and last write do
not resolve semantic conflicts. Identical updates reuse existing direction.

Graph direction nodes expose bounded `directionEvidence` for all four input
fields and `directionContentCoverage` for omitted/truncated content. Their summary
retains original path, revision and current/historical state. Read full direction
from its original when needed; a partial graph excerpt is neither the complete
direction nor P2 recovery authority. Old constraints remain historical evidence,
not the current common instruction.

Restore returns `currentProjectDirection` beside the exact historical checkpoint
fields. Suppose a Session was preparing a deployment and the user later cancelled
deployment for the whole Project: restoring that Session keeps its historical
position but applies the current cancellation before any effect. It neither
rewrites the old checkpoint nor revives its old permission. A graph copy of an
accepted decision remains evidence; execution rechecks current authority and
affected original sources.

## Counterexamples to preserve

- An unapproved/rejected neighbor never becomes approved through an edge or summary.
- A valid old revision is historical, not damaged; a wrong-Project or tampered
  artifact is excluded rather than labelled merely stale.
- A failed database query never requires Product approval to read original code.
- Concurrent Session updates never select a new global current Session.
- A common cancellation survives restoring an older deployment checkpoint.
- Read-only discovery and entry never publish direction, approval or recovery.
- One worker's uncertain effect needs reconciliation without blocking independent work.

See [authority planes](authority-plane-contract.md),
[Session recovery](session-recovery.md) and
[runtime composition](../skills/head-agent-core/references/runtime-composition.md).
