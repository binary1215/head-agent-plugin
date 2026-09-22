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

## Optional product evidence

Read only the part needed for the current outcome. These are optional paths,
not a sequence to perform for every task.

Use the common Observation surface only when a current task actually needs a
durable cross-Run, rebuttal/audit, handoff, or context-loss record of structured
external facts. The mere existence of build, delivery, analytics, support, or
runtime data does not justify ingestion; keep ordinary inspection ephemeral.
After HEAD determines one exact task-required Observation `typeKey`, call
`head_observation_prepare` first. It returns bounded current exact IDs before
matching configured Host sources without judging sufficiency, selecting a source,
or collecting. Inspect a returned existing record with `head_observation_read` and
reuse it when HEAD determines that its time scope and content are semantically
sufficient. Use `head_observation_query` for additional exact-ID paging and
`head_observation_sources` only for configured-source paging, filtering, or
adapter diagnosis. Follow a stale source cursor's disclosed first-page
resynchronization automatically; do not turn it into a user decision. A real Host
adapter owns source access, binding, digests, coverage, and the Host provenance
confirmation; do not ask the user to compose those fields or to attest to a
machine observation. `head_observation_ingest` is the advanced Host/CI boundary
for an already constructed bounded input, while `head_observation_collect`
remains the adapter-facing compatibility alias. Descriptors define a closed data
shape, not Feature meaning, success, causality, policy, or tool routing. Read
`head_observation_status` only as a bounded P4 summary. To use one of these
records in task context, HEAD must add an EvidenceNeed of kind `observation` with
exact current `observationIds`; lexical overlap never makes an Observation
eligible. If product interpretation should persist, author a non-authoritative
ProductHypothesis that cites the exact Observation IDs. Never auto-create a
ProductSignal, candidate, ReviewDecision, Canon mutation, or P2 recovery
direction from an adapter payload. Read `../../../docs/observation-adapters.md`
before adding an Observation adapter.

Source-specific collection belongs behind a process-local Host adapter registry;
authentication, pagination, rate limits, webhook acknowledgement, cursors, and
provider identity stay outside the project. The generic
`observation-file-ingest` CLI is a one-shot Host/CI reference for an already
prepared bounded JSON event. Do not route its file path through MCP or ask the
user to author its source configuration. It does not replace a configured Host
integration, scheduler, or remote connector.

When `head_observation_prepare` shows no semantically sufficient current record,
select a configured source only if the current task requires a durable current
Observation. Prefer a `ready` Host availability hint but treat it only as P5
operational evidence, not semantic relevance or freshness proof. Then call
`head_observation_collect_source` with the opaque Project-bound source ID. Do not
ask the user for a path, binding, descriptor, digest, coverage claim, credential
reference, provider identity, or source alias. If no configured source is
available, disclose the optional adapter gap and continue without Observation
persistence unless that exact evidence is required.

When the user wants to add, revise, or retire a product Policy, reason about its
meaning in the provider HEAD and call `head_product_policy_propose` with exact
Feature or FeatureGroup applications plus optional exact Requirement,
Constraint, or Decision references. Do not infer those references from group
membership, source names, or graph proximity, and do not ask the user to write
proposal JSON. The candidate is non-blocking P3 evidence. Present one compact
decision card and call `head_product_policy_review` only after the current user
unambiguously accepts or rejects that exact candidate. A missing optional
reference or evidence anchor is a disclosure, not a reason to manufacture one
or block ordinary work. On later inspection, summarize the shared read-only
evidence-currentness result; `changed` or `missing` can motivate a new proposal
but does not automatically invalidate Canon or require another review.

For before/after measurement, reuse existing exact observations or a configured
Host source before asking for any new input. The provider HEAD may call the
typed metric operations, but the user should speak in ordinary task language
rather than supplying digests, coverage structures, adapter identities, or
metric JSON. A numeric comparison remains available when collection conditions
differ, while adapter key/version/descriptor, source scope, form, duration,
sample size, and coverage remain visibly `same`, `different`, or `unknown`.
Never convert that comparison into semantic equivalence or causality. Assessment
is only a P3 ProductHypothesis; a follow-up remains an initiative candidate and
uses the existing explicit Product review only if the user chooses to promote it.

When the task asks what is currently deployed or delivered to named targets,
use `head_delivery_status` and summarize observed `uniform`, `mixed`, or
`unknown` state without asking the user for event JSON. A trusted Host adapter
may call `head_delivery_observe`; neither the Host nor user needs an additional
approval step because the record is P3 evidence and performs no deployment.
Never choose current state by receipt time, let a failed attempt erase the last
applied revision, infer success for an unobserved target, or call the projection
a complete deployment inventory. A declared revision remains unverified. Only
an exact retained World `FileRevision` binding may receive an `AT_REVISION`
edge. Because that label is a Core proof, never route `delivery.state` through
generic Observation ingestion; use the dedicated typed delivery call, which
revalidates the exact same-Project World binding without adding user approval.
Ordering conflicts are a disclosed `unknown` for that target, not a block
on ordinary work or a request for a Product review.

When approved Product Canon may have drifted from code or external evidence,
keep Conformance reconciliation non-blocking. Call `head_conformance_prepare`
without asking the user for Canon keys, graph IDs, digests, or JSON. Provider
HEAD performs the semantic comparison and cites one or more exact current
source, ChangeSet, Observation, or optional Graph anchors; Core only verifies
those anchors through `head_conformance_propose`. Lexical overlap, test or
document presence, Graph availability, connector availability, coverage class,
risk hint, and queue length never determine candidate eligibility or ordinary-
work blocking. Missing optional evidence is a disclosure.

Read `head_conformance_queue` in bounded pages and summarize Findings at natural
work boundaries instead of interrupting every change. A Finding is P3 candidate
evidence. HEAD may acknowledge or defer it with `actor: "head"` and no user
confirmation; do not impersonate a user or supersede any user disposition.
Keep maintained Findings discoverable. This neither resolves them nor requires
a user response. A Finding remains
evidence, not a violation or decision. Source or Canon drift means
`needs-recheck`, never automatic resolution. Provider HEAD may submit a fresh
`head_conformance_resolution_propose`, but close or dismiss an exact Finding
only after the user's natural-language disposition by calling
`head_conformance_disposition` with explicit confirmation. Requests for a code
fix still enter the normal execution lane; requests for Canon revision still
enter the existing exact candidate and user ReviewDecision path.

Optional Host triggers remain process-local P5. Default opportunistic use runs
at a conversational boundary and invokes no background provider. Monitor mode
and provider assessment require explicit user opt-in. Duplicate triggers
converge, refresh triggers coalesce with disclosed coverage, and an uncertain
provider outcome must not auto-replay. Missing Host composition never blocks
ordinary HEAD work. Read `../../../docs/conformance-reconciliation.md` before
changing this subsystem.

For Product-to-code or Product-to-test mapping, inspect the current World and
Graph, then use `head_feature_mapping_propose` with exact current Product and
source/test node identities. Do not derive mappings from names or token overlap.
Inspect and batch unreviewed candidates without interrupting ordinary work.
To replace an obsolete pending unreviewed batch, call the same proposal tool
with its exact `expected_candidate_set_id` and a fresh semantic proposal.
This preserves historical evidence and cannot bypass an already saved decision.
Present the relevant batch when reviewed relationship promotion is needed.
Only after an explicit user disposition,
call `head_feature_mapping_review` with the exact candidate-set ID and
`confirm_user_review: true`; proposal, model agreement, or tool success alone
never creates a reviewed relationship or changes Product Canon.
