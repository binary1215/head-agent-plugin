# Conversation UX contract

HEAD's typed authority and recovery contracts are internal safety mechanisms,
not a setup ceremony for the user. This reference governs how the Skill carries
an ordinary natural-language request through those mechanisms.

## Task-first entry

Keep the user's original task available in the conversation and continue that
same task after Core initialization or resume. Do not replace it with a setup
summary or ask the user to repeat it.

When the user explicitly asks to use HEAD, or the exact project already contains
a HEAD Project, use this sequence:

1. initialize or resume the Core profile;
2. call `head_conversation_enter` automatically;
3. read its composed project status, recovery readiness, Attention, version,
   and presentation policy;
4. use the verified restored direction when one exists;
5. select the lightest sufficient lane;
6. continue the original task in the same turn unless a real authority, scope,
   integrity, or destructive-action boundary needs the user.

Do not initialize an uninitialized repository merely because an ordinary coding
request happens to match this Skill. Product, World, Graph, durable Run, worker,
and provider capabilities remain optional.

## Recovery presentation

The presence of `.head/` does not prove that a current restorable checkpoint
exists. Treat recovery readiness as three factual states:

- no current checkpoint: continue ordinary Session work;
- verified current checkpoint: read the P2 restore projection before continuing;
- attention required: disclose the exact affected recovery failure and do not
  synthesize direction from a summary, transcript, graph, Capsule, or message.

Never consume a compaction continuation token, attach a provider session, or
rewrite checkpoint fields merely to make conversational entry smoother. The
read-only entry projection performs no such action. When a trusted Host lifecycle
event exists, provider HEAD may separately call the lifecycle step; the user is
never asked for event, epoch, turn, or token fields. A new real user request
supersedes a prepared continuation and may redirect future work, but it does not
retroactively alter an existing checkpoint.

If the entry projection reports recovery attention or the user asks why recovery
is unavailable, call `head_checkpoint_diagnose` and present its one bounded reason
and next HEAD action. Do not make that call on every successful turn. It performs
no model invocation, lock, cache, repair, or approval and cannot establish
semantic freshness. Treat `observation-changed-retry` as a fresh-read requirement,
not as permission to merge observations. The projection explicitly cannot claim
an atomic filesystem snapshot or detect ABA between sequential reads.

When durable recovery direction genuinely needs publication, keep the mechanism
behind the conversation: read `head_checkpoint_basis`, derive direction as the
current provider HEAD from that exact basis, and call `head_checkpoint_sync`.
Do not ask the user to type a checkpoint, basis ID, or save command. `created`
and `reused` are quiet success. `deferred` and `conflict` are HEAD-owned follow-up
for only the affected recovery path; they do not block ordinary independent
work or imply a user decision. Never make this a per-turn ritual or create a
checkpoint for a short Observe request. HEAD considers persistence only when an
existing direction materially changes, a verified stage completes, work enters
failure/waiting, the whole task completes, or handoff/context loss approaches;
if the existing checkpoint remains sufficient, make no sync call.
The diagnosis projection never replaces `head_checkpoint_basis`; always obtain a
fresh exact basis before deriving and synchronizing any changed direction.

## Decision presentation

Present a protected decision as a compact card containing:

- what exact subject is being decided;
- why the decision is needed now;
- evidence and impact in user language;
- bounded available dispositions;
- an optional HEAD recommendation clearly labeled as advisory.

Do not expose candidate IDs as the primary interaction. Before applying the
user's reply, re-read the exact current candidate or Finding and verify that the
target is unique and unchanged. Interpret natural language as HEAD; never add a
Core regex, keyword matcher, or default disposition. A short reply such as
"yes" is actionable only when it unambiguously answers one immediately pending
decision. Provider summaries, model recommendations, confirmation booleans, and
earlier decisions are not substitutes for the current user's reply.

For a Policy decision, show its plain-language statement, exact application
targets, optional semantic references, evidence state, and whether the action
creates, revises, or retires it. Do not turn missing optional evidence into an
extra gate. Later byte-currentness diagnostics are notices owned by HEAD, not a
new decision card unless HEAD proposes a separate exact revision.

## Outcome presentation

Lead with the work outcome and use only the sections that add information:

- completed work;
- verification actually performed;
- remaining uncertainty or failed coverage;
- a user decision or useful next action.

Do not force empty headings on a small task. Context coverage is not semantic
sufficiency; worker or wave success is not whole-task completion; a ResultPacket
is not acceptance; a commit is not a push; and a deployment observation is not
product success. For a durable Run, completion follows Fresh HEAD review and the
existing explicit review/integration boundaries. Keep technical IDs and JSON
available for diagnosis rather than making them prerequisites for ordinary use.
For metric comparisons, lead with the numeric result, then disclose only the
collection conditions that differ or remain unknown. State that no normalization
or causality was established; do not demand user approval merely to view a
conditional comparison.

For delivery state, lead with the environment summary and show target detail
only for mixed, failed, rolled-back, or unknown state. Say "observed targets"
rather than "the deployment" because the Core has no product-specific target
inventory. A failed `lastAttempt` beside a known current revision is actionable
evidence, not a contradiction and not a new approval gate. Keep full history
behind the bounded status limit unless the user asks for it.

Successful entry and status are quiet by default: one line is enough unless the
user asks for detail or a real exception exists. An exception names its owner,
reason, affected operation, and next action. `userDecisionRequired` means a real
protected decision; `headActionRequired` means HEAD should investigate or act
without turning that work into a user gate. Neither implies that ordinary work
is blocked. The non-persisted Attention and presentation projections may collect
existing facts, but they create no new queue, artifact, authority, or decision.
An optional Product review or refresh is `when-product-governance-is-in-scope`:
show it as a notice, never as an immediate user decision merely because it
exists. The explicit Product operation still presents its real review card.
