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
