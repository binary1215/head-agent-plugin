# Session work context and Host continuity

[한국어](ko/session-work-context.md)

Ordinary investigation and direct edits need neither a Run nor a save ritual.
HEAD preserves useful context at a meaningful handoff or context-loss boundary,
then the same logical Session's entry reconstructs selected original records.
This is not transcript recovery or a guarantee that unsaved conversation survives.

## What is preserved, and by whom?

Current common direction belongs to ProjectDirection. Session-local purpose,
constraints and cancellations stay in explicit Session P2 direction: the existing
Session purpose and latest checkpoint, not a shared Project update or P3 memory.
For example, a Session can retain “investigate locally, no network” in its purpose
and explicit decisions, then replace an earlier rewrite proposal with “rewrite
cancelled; explain only” in its current checkpoint. A sibling Session is unchanged.
HEAD authors and interprets this text; Core does not extract approval from words.
Historical decisions and next steps never grant current execution permission.

Reuse existing checkpoint, result, review and source originals first. Only
otherwise unrepresented reasons, rejected alternatives, selected observations,
pending work and uncertainty need a small Session-owned P3 Evidence original.
Its historical suggestions cannot populate recovery fields or approve work.
The new record has a distinct subtype under the existing Evidence plane, not a
second direction store, history document, global memory database or daemon.

## A light preservation path

- When checkpoint synchronization is already useful, HEAD includes optional
  `work_evidence` in the existing `head_checkpoint_sync` request. P2 and P3
  have separate outcomes. A stale/deferred checkpoint does not promote its
  retained work evidence; an optional evidence-storage failure does not block
  an otherwise valid explicit P2 publication.
- Without a useful checkpoint boundary, one optional `head_session_work_record`
  preserves selected Run-free context. HEAD supplies sparse input from the
  conversation. The user need not author JSON, choose an ID, approve saving,
  create a Run or compile a Capsule.
- `head_conversation_enter` reads selected Session originals and existing P2
  direction, together with current common constraints/cancellations. It writes
  nothing. Missing or damaged optional evidence affects only that layer.
- `head_session_work_read` expands exact originals, omitted records or the next
  inspection page. This is useful expansion, not a compulsory tool chain.

Short work creates no additional record. Identical selected input reuses its
original bytes; a genuinely separate repeated observation can carry a HEAD-owned
occurrence distinction. Deduplication does not prove that an effect happened.
Different judgments are retained separately, not overwritten by the last writer.
Retry repairs persistence only, never repeats code, provider or external effects.
Abrupt exit before a supported preservation boundary can still lose unsaved work.

## Bounds, originals and uncertainty

Work originals live in the selected Session's `work-evidence/` directory.
There is no indispensable index or cache. Entry reads a bounded page, ordered by
recording time within that page, without choosing semantic relevance or sufficiency.
The initial selection is at most eight records; further originals are reachable.
There is no automatic pruning, silent deletion or mandatory full-history scan.

The `max_characters` bound is the actual `JSON.stringify(records).length`
after reference enrichment, including its array delimiters. A separate bounded
metadata envelope carries coverage, omissions, original IDs and expansion advice.
It is not included in that record-array budget. The default is 32,768 characters;
this is a serialization bound, not a token estimate or semantic verdict.
Large records are disclosed as omitted and remain available by exact read.

References preserve exact path, byte digest and source/artifact kind. Matching
bytes are not semantic freshness; another Session's artifact is evidence, never
an imported goal or approval. Changed/missing sources are disclosed, and a
path/digest alone is not recovered content. One corrupt original is excluded
without blocking valid records, P2 recovery or independent work. A detected P2
or common-direction change during entry discards that mixed context and asks
HEAD to reread only the dependent observation. Sequential reads are not an
atomic snapshot and cannot detect every ABA change.

## Host support without identity guesses

`createSessionHostAdapter` is a trusted embedding-Host API. The Host obtains
the real native caller and, for children, a verified distinct agent identity.
Its declared `select` operation validates an exact logical Session and
compare-and-swap revision, then registers only P5 linkage outside project Canon.
A pending selection survives interruption as unresolved, not the old/default
route. After restart the public adapter reads this linkage; its
`resolveSessionContext` supplies the existing per-request MCP resolver.
Native IDs are hashed for lookup and never become canonical Session identity.
Read-only calls produce no claim or receipt. Explicit sharing and default
selection are choices, not latest-time/name/sole-candidate guesses.

Selection persistence failure does not undo a successful current explicit request.
The result remains usable with its exact logical route, while future linkage is
unconfirmed. Repair only that linkage. If storage fails before any intent is
durable, a restart cannot discover the lost attempt: the Host must not claim
lossless continuity from unwritten state.

The bundled `scripts/session-host-hook.mjs` handles SessionStart only. It looks
up a binding previously registered through the trusted Host API and returns
bounded read-only context before MCP needs to be ready. It never creates that
binding, parses a transcript, saves a note or infers direction. Large startup
direction is explicitly marked for original expansion, not silently cut.

| Path | Implemented support | Important limit |
| --- | --- | --- |
| Core CLI/MCP | Exact logical Session record → same Session entry; optional typed expansion | No native caller identity inferred |
| Trusted embedding Host | Public select/register → restart lookup → request-local resolver → same Session | Host must actually acquire distinct per-request callers |
| Codex native MCP transport | Actual request `params._meta.threadId` → existing init/resume selection → P5 link → request-local resolver; read-only SessionStart lookup | Installed engine `0.162.0-alpha.17.2` transport observed; GUI model, fork/child and actual restart/compaction require separate verification |
| Stock Claude Code | Same-instance PreToolUse correlation → existing init/resume selection → P5 link → subsequent direct/router resolution; read-only SessionStart/resume | Installed CLI `2.1.289` with synthetic local protocol tested root/child separation and fresh-process resume; real model/account and actual compaction are separate |
| OpenCode | Core and trusted Host seam | No native Hook integration claimed |

Codex tool Hooks expose the parent's session ID for child agents and cannot
safely register caller selection from that field alone. Codex argument rewriting
also requires an allow decision, so it is not used for routing. No broad Hook
denial, deny/retry normal workflow, permission bypass or global MCP selector is
introduced. Correct explicit requests and independent Project work remain
available after optional binding loss.

### Which operations retain a selection?

Only the existing successful `head_project_initialize_or_resume` selection is
retained. Initial setup keeps the verified default; explicit resume can share or
separate existing Sessions. Repeating an unchanged choice writes nothing. There
is no extra select/bind tool, user ID form, save ritual or permission decision.
Creating a Session alone, an explicit read, writing evidence/checkpoints for a
different Session, and worker integration do not silently select it for the chat.

Pure bootstrap validation and identity checks precede optional P5 preparation.
The executing request keeps its already verified route while its selection is
pending. Short CAS sections do not lock the whole operation. Settlement cannot
overwrite a newer intent. A proven pre-effect failure may restore the verified
prior choice; generic error, cancellation or timeout does not prove no effect.
Unknown outcomes and restart without a live ownership ticket retain pending
uncertainty. Host persistence failure never changes the original Core outcome or
replays its effect. Bindings and caller metadata remain P5, not P2 direction.

One MCP process may receive multiple callers: every request uses its own outer
transport metadata, not a last-caller selector or arguments named `_meta`.
Embedding Host resolvers retain precedence. A never-bound caller keeps existing
default semantics without read-side writes. Known lost/pending/corrupt linkage,
including a missing binding in an existing namespace, never substitutes default.
Complete deletion of that namespace cannot prove its unwritten/deleted history.
Legacy transport without caller metadata does not claim automatic continuity;
once native metadata is observed, its loss affects only dependent calls. Valid
explicit requests and independent Project work remain usable.

### Claude request correlation, without another permission gate

Bundled PreToolUse Hooks target only this plugin's Session-dependent tools and
generic routers, on their exact local or plugin-scoped MCP server. The Hook
sends the real `session_id`, distinct child `agent_id`, `tool_use_id`, outer tool
name and original outer arguments to that same server. The actual ordinary MCP
call supplies outer `claudecode/toolUseId`; the in-memory registry verifies its
exact argument digest before unwrapping a router and resolves that caller only.
Normal model calls, router calls to the helper, nested fake metadata and
unexpanded templates cannot prepare this linkage on the observed stock transport.
This is a verified stock-transport seam, not arbitrary-client authentication.

The helper returns `{}` and never supplies `permissionDecision`, `updatedInput`,
logical Session, approval or P2 direction. Native permission remains Host-owned.
Direct independent tools add zero RPCs; a generic router adds one internal Hook
RPC even for an independent inner operation, where preparation immediately does
nothing (no registry, Session/P5 read, graph scan or original write). No new user
question, binding form, Run, Capsule, save receipt or daemon is required.

Pending correlations expire after ten minutes and are capped at 1,024 entries;
active entries cannot be evicted. Exact pending retry converges without extending
its lifetime; conflicting/active reuse cannot replace another caller. Claim release
is in `finally`, and transport close clears the cache. Denied calls may leave a
pending memory entry until sweep/close, not a durable per-call artifact. The
bounded spent cache is not durable replay protection or an execution lease.
Cold Claude metadata without a matching Hook fails only dependent automatic
routing, never guesses default. Valid explicit routes and independent work remain
usable; a new Project may initialize without claiming native linkage. Missing
Hook activation, expiry and optional storage loss are diagnostic gaps, not a
reason to repeat completed effects. Resume needs the same native chat, project
and operational binding storage; cross-machine continuity is not implied.

Official contracts: [Codex Hooks](https://learn.chatgpt.com/docs/hooks) and
[Claude Code Hooks](https://code.claude.com/docs/en/hooks).
Source/command fixtures prove these local contracts, not installed Hook trust,
actual provider invocation or model understanding. Installing a package does not
prove its Hook ran; real activation and account/model tests are separate.
