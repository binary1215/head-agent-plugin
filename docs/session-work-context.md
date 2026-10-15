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
| Stock Codex | Bundled read-only SessionStart lookup/context and existing explicit logical arguments | No automatic registration or native-ID-to-MCP propagation |
| Stock Claude Code | Separate read-only SessionStart command; documented child identity stays separate | No automatic registration/resolver injection claimed |
| OpenCode | Core and trusted Host seam | No native Hook integration claimed |

Codex tool Hooks expose the parent's session ID for child agents and cannot
safely register caller selection from that field alone. Codex argument rewriting
also requires an allow decision, so it is not used for routing. No broad Hook
denial, deny/retry normal workflow, permission bypass or global MCP selector is
introduced. Correct explicit requests and independent Project work remain
available after optional binding loss.

Official contracts: [Codex Hooks](https://learn.chatgpt.com/docs/hooks) and
[Claude Code Hooks](https://code.claude.com/docs/en/hooks).
Source/command fixtures prove these local contracts, not installed Hook trust,
actual provider invocation or model understanding. Installing a package does not
prove its Hook ran; real activation and account/model tests are separate.
