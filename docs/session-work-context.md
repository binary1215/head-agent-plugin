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
- `head_session_work_read` expands known exact originals or an explicitly anchored
  ID inspection page. Use it when needed, not as a compulsory tool chain.

Already saved work also appears in existing `head_project_graph` discovery.
Questions, paths, anchors and neighbors can return actual reasons, alternatives,
observed work, pending work and uncertainty across their verified owner Sessions.
Graph discovery is Project-scoped and needs no native binding or Session switch;
it does not replace the selected Session's entry or current P2 direction.

Small fitting `workContent` is usable directly in short results. Single-work
results may include their complete large reason beside navigation nodes, while
large multi-original results disclose omitted content and original text ranges.
Inspect `workContentCoverage.partial` before treating a displayed value as
complete. `originalExpansion` uses the existing exact reader with one actual
owner and the size needed by its enriched record. Verify returned identity and
digest after expansion; changes since graph discovery remain possible. No extra
save, approval, tool chain or user-authored ID is required for this discovery.

Known generated instruction, role and provider-configuration differences remain
visible without blocking intact selected-Session recovery or work-context reads.
Edited or missing projections are never repaired by entry. Their update/mutation
protections remain separate from original identity, digest and lineage checks;
managed original drift, an unclassified managed path, or an unreadable manifest
is not accepted as projection-only drift. No checkpoint is needed for useful
ordinary work context.

An exact healthy by-id Session remains readable when an unrelated default Session
is missing or damaged. Optional Product facts depending on that default are
unavailable, not a prerequisite to continue. Actual default requests, a damaged
selected Session, known duplicate identities or wrong Project ownership still
fail without substituting another Session. Reads do not repair or switch pointers.

### When common direction linkage is unavailable

A missing direction pointer is not an empty direction if an original revision or
recognized interrupted-publication stage remains. Entry labels that common layer
unavailable while retaining independently verified checkpoint and work evidence.
HEAD continues independent work without a save, repair or approval ritual. Current
direction-dependent effects and checkpoint CAS remain strict; historical decisions
and next steps cannot replace the missing current constraints or cancellations.
The existing continuation check runs before consuming its one-shot token.

Empty directories with no recognizable original/stage retain the unused-store
behavior. Neither names, timestamps nor a sole revision select current direction.
Reads write no pointer. Complete removal of all traces cannot be distinguished
from a never-used store without additional evidence. Original integrity/path errors
remain errors, not availability exceptions. Sequential observations are not atomic.

The embedded CLI's `metric-status` uses the same Project-only classification as
its MCP peer even after caller selection loss. Existing readiness checks still
apply; the route neither chooses default nor repairs the Host binding.

Short work creates no additional record. Identical selected input reuses its
original bytes; a genuinely separate repeated observation can carry a HEAD-owned
occurrence distinction. Deduplication does not prove that an effect happened.
Different judgments are retained separately, not overwritten by the last writer.
Retry repairs persistence only, never repeats code, provider or external effects.
Abrupt exit before a supported preservation boundary can still lose unsaved work.

## Bounds, originals and uncertainty

### Linked context and saved activity observations

The same two optional evidence inputs accept `workLink: {root, predecessor}`
and `executionObservation: {state, target?}`. Each selector is exactly
`{evidenceId, evidenceDigest}` from a saved original in the same Project and
selected logical Session. States are `running`, `paused`, `ended` and `unknown`.
HEAD supplies these internally, only when useful at the existing preservation
boundary. No separate start/end/save call, user ID form or approval is required.
An observation alone may be meaningful; a link alone is not selected work content.

The root is a declared first-retained anchor, not proof of the actual beginning
of the work. The predecessor must be that exact root or an existing original
declaring it. A previously linked original can serve as a new anchor without
erasing its earlier provenance or merging the contexts. New writes validate the
exact endpoints; identical retry first reuses its intact original, even after an
endpoint or source disappears. An absent extension leaves legacy normalized
bytes, identity and protocol unchanged. No migration or activity registry exists.

These are observations of saved notes, not execution-attempt identities. Several
states about one exact target coexist as history; time and predecessor select no
current winner or execution conflict. An `ended` observation about E1 cannot close
a later E3, sibling, all executions mentioned in E1, pending issue or required
review. Failure/cancellation is not success. Unscoped observations do not qualify
another note. Current live state, unsaved restarts and native Session termination
remain unobserved. Nothing is deleted, hidden, reconciled or replayed.

For linked default reads, `selectionRole` distinguishes recent, explicitly cited
and declared-root bodies. `savedActivity` preserves incoming historical state
sets, bounded exact qualifier selectors/counts and relation availability. Its
own observation remains in original `content`. The separate `organization`
notice explains historical—not live—scope once. Missing/changed relations affect
only that view; a failure actually detected on selected reread also qualifies
dependent overlays in the same response. Sequential reads do not detect every
later change. Exact-ID/page reads add no hidden ancestors or qualifier search;
uninspected endpoints/qualifiers are not declared absent or terminal.

The default uses recent seeds, one-hop explicit same-Session work-artifact
citations and their declared roots. It interleaves recent → cited → root, keeps
at least half the available slots for recent/fallback selection and deduplicates
original bodies. With one slot only recent work is returned; with two, the cited
body precedes the optional root. This is a bounded display allocation, not a
semantic eligibility test. If a large anchor cannot fit, recent results and
pending work remain eligible. Reference `digest` hashes file bytes and is not
the original's `evidenceDigest`. Citation content is the actual saved judgment,
not a generated summary or a path presented as recovered reasons.

Extra related fresh-load attempts are bounded by `maxRecords`, including failed
or oversized attempts. Proof metadata is retained for deduplication; unselected
oversized bodies are discarded. Selected/related bodies have bounded retention,
not full-history retention. Deferred related expansion and unique budget-omitted
original counts are separate and are not added together. Legacy-only stores keep
their existing newest-first selection. Explicit page/cursor behavior is unchanged.

Work originals live in the selected Session's `work-evidence/` directory.
There is no indispensable index or cache. Default entry/read verifies the matching
originals discovered in the selected Session and considers them newest-recorded
first, with evidence ID breaking equal-time ties. It returns at most eight records
by default, without judging semantic relevance, sufficiency or current authority.
There is no automatic pruning or silent deletion.

Default coverage counts all discovered originals inspected and returns
`nextAfterEvidenceId: null`: no uninspected page remains in that discovery set,
not all bodies were delivered. Default first-to-next ID enumeration is no longer
provided. Known `evidenceIds` still expand exact originals; an explicit non-null
`afterEvidenceId` keeps the earlier lexical ID inspection-page behavior (up to
512), including its continuation cursor and within-page time ordering. This is
not a global time-order cursor or a complete ID-discovery interface. Bounded
omission samples do not expose every omitted ID.

Global recent selection costs one verification of each discovered original,
O(N) filename/order metadata and O(N log N) sorting. Only needed candidates are
reread; reference checks stop after the output is full and skip bodies already
known not to fit. Linked reads also retain compact relation metadata O(N+E) and
bounded selected/related bodies, not all original bodies. Relation processing is
O(N+E); it does not remove the original scan/sort costs. Each generic reference
may still temporarily read up to 16MiB.
Incoming counts/state sets use request-local aggregates; failed qualifier removal
does not walk its full history again. Bounded qualifier-list materialization and
record-array serialization still cost work proportional to the displayed data.
The related fresh-load cap is not a cap on generic reference reads: references
outside that cache can be checked again for different selected records.
Candidate rereads can add up to N original reads. This is a sequential view of
the discovered set, not atomic latest-at-return: records added after enumeration
may be absent. No mandatory index, lock, write or service is added.

The `max_characters` bound is the actual `JSON.stringify(records).length`
after reference enrichment, including its array delimiters. A separate bounded
metadata envelope carries coverage, omissions, original IDs and expansion advice.
It is not included in that record-array budget. The default is 32,768 characters;
this is a serialization bound, not a token estimate or semantic verdict.
Large records are disclosed as omitted and remain available by exact read.

Default unavailable details are sampled up to 32 entries. `coverage.unavailable`
is the total and `omissions.unavailableDetailCount` is that total minus the
displayed sample; `coverage.valid` includes both returned and budget-omitted
valid records. Unique inspected originals are counted once even if reread.
An original changed or lost on reread becomes unavailable, not a mixed old-order/
new-body result. Explicit page and exact-ID reads retain their bounded detail
range. Body and diagnostic omissions are separate; no empty sample proves absence.

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

Startup includes the selected Session's current `sessionPurpose` even without a
checkpoint, separately from historical checkpoint purpose and decisions. It also
retains an explicitly reported current-direction availability diagnosis; an
unavailable direction is not the same as a never-recorded null direction. The
final JSON context, including coverage, omissions and expansion advice, has one
Host-specific delivery budget rather than a second common 7,000-character crop.
Claude uses at most 10,000 UTF-16 code units, conservatively following its
[documented per-string ceiling](https://code.claude.com/docs/en/hooks#add-context-for-claude).
Codex uses at most 32,768 UTF-16 code units for the **complete** output: a finite
local resource policy reusing the default work-reader size, not an optimal value,
Host token/window limit, or proof that P2 inputs are bounded. The packaged Codex
handler uses numeric `additionalContextLimit: 0` alongside that strict emission
guard, following the [documented full-output option](https://learn.chatgpt.com/docs/hooks#large-hook-output).
The old approximate 4,096-token setting could spill even a character-bounded
multilingual result. Installed Host support and actual model receipt remain
separate verification; characters, UTF-8 bytes and model tokens are not equivalent.
Current direction/purpose/checkpoint inputs themselves have no text-length cap;
the existing 32,768-character work read covers only its selected record array.
Exact current common direction, Session purpose and the
latest selected checkpoint's purpose/decisions/position/next-result fields take
priority over optional prose, coverage detail, ID samples and P3 history. The
checkpoint's recorded approvals/next steps still grant no current effect authority.
Only current content that cannot fit its minimal truthful envelope is explicitly
omitted whole, never shortened into different direction. Existing entry/work reads
expand needed originals using the same exact Session route; normal startup does
not require a follow-up read. Only if optional reductions cannot fit an
unusually long root is its rendered path omitted with the original Hook cwd
identified as its source. None of this changes selection, writes a binding or
requires a checkpoint, save, approval or extra routine user step.

For organized history, startup fits the historical-scope notice and first record
together, and always fits each body with its saved-activity overlay. Optional
organization detail cannot leave an old running body presented as live state.
Where existing restore supplies `currentExecution`, a separate small axis keeps
its exact status and canonical active/pending-review/required-plan facts. Incomplete
or conflict stays so; a raw pointer is not verified execution. No checkpoint means
no new execution scan. This axis and all history yield to protected common/P2
direction and purpose within the applicable complete-output ceiling. The minimal
canonical execution status remains visible if its optional details cannot fit.

Transport removes repeated wrappers, not authored meaning. Startup
uses compact truthful guidance before admitting any authored block; longer
optional guidance returns only with spare capacity after original bodies.
Common direction keeps its `directionId`, `directionHash` and exact `input`; recovery retains its
checkpoint digest and open review IDs alongside the four original direction
fields. Work `content`, including reasons, alternatives, references, pending work
and unknowns, stays unchanged, with its evidence ID/digest and observation overlay.
`referenceChecks[].referenceIndex` points to the exact matching path/digest/kind
in that content's references; verification status, actual/null owner and exceptional
diagnostics remain. An unpaired descriptor is retained whole, not guessed.
These hashes select verified originals, not the compact projected JSON. Reference
byte matching does not establish semantic freshness or authority. Unavailable or
changed-basis work retains status/reason and expansion even with zero records.
No original, selection, binding, tool chain or user step is added. A genuinely
oversized source is omitted whole with truthful coverage and dependent-only
expansion; omitted cancellation never means absent cancellation. No local spill
file or automatic follow-up read is created. Actual Host spill/preview behavior
must not be called complete recovery. The guard bounds emitted text, not the
memory required to read already-valid unbounded P2 inputs.

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
