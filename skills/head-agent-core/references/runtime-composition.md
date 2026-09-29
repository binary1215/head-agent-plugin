# Runtime composition

Use one provider-neutral core and compose it with replaceable boundaries.

## Choose execution means separately from risk

Direct HEAD work is the default. For useful ordinary delegation, use
only tools exposed by the current Host, with a brief, independent ownership and
HEAD integration. This does not require the managed runtime described below.
Observe/Session/Run/Authority describes risk and persistence, not a choice of
launcher. An active Run may consume Host contributions while retaining its own
whole-result/review contract. Host handles remain operational; results do not
become decisions or P2 direction.

For example, ask one worker to investigate the failing parser and another to
inspect its regression tests, then have HEAD combine both into a verified fix.
Give each its needed sources and ownership boundary. A shared writable checkout
is not isolation: overlapping writes require HEAD reconciliation or sequential
work. Preserve user input, account and cost scope when choosing context. If the Host lacks a required control,
disclose that limit. Continue the unfinished part directly or sequentially when
it never started or no effects remain. Preserve completed contributions and
user edits. Inspect unknown outcomes and overlapping effects before replacement;
independent work can continue. A cancellation request does not establish exit.

Apply the Skill's fork/fresh guidance per contribution, for example:

- Continue a design fix whose earlier exceptions and user agreements are hard to
  summarize faithfully: prefer a supported, in-scope fork, and identify the current
  task so inherited but superseded discussion is not treated as current direction.
- Review the parser independently against its current requirements and tests:
  prefer fresh context containing that evidence, without feeding the parent's
  conclusion as the answer. Include relevant constraints, not merely filenames.
- Fix a small error message directly; neither a fork nor fresh worker is needed.

These examples do not require a new artifact or selection ceremony. A fork's
history is context, not proof of current authority or workspace isolation.

## Follow-up handoffs

For a continuing contribution, lead with what changed, what is already usable,
and the remaining question or outcome. Include relevant constraints, ownership
changes and evidence references. Reuse sufficient context already available to
the recipient; do not resend the full history by default. When the recipient is
new, has lost context, or has a materially outdated basis, supply the missing
current requirements and reasoning. Delta-first is not delta-only.

Do not require an acknowledgement handshake, context token or new artifact merely
to send an ordinary brief. A handoff does not grant additional authority or
replace recovery records. After context loss, follow existing artifact-first
recovery where that contract applies before using the handoff as supporting
context. As described in [recovery presentation](conversation-ux.md#recovery-presentation),
a Session with no current checkpoint continues ordinary work with sufficient
current context; this handoff convention requires no new checkpoint, Run or
recovery gate. Do not edit digest-bound managed input through this ordinary
follow-up convention.

## Explicit maintenance of retained managed work

This is a compatibility entry for explicitly maintaining existing approved
managed tasks, not a recommendation for new work or a Host-failure fallback.
Use `node <plugin-root>/scripts/head.mjs managed-maintenance <command> ...`
or the separate `scripts/mcp-managed-maintenance.mjs` stdio server. The ordinary
server and raw CLI calls exclude managed mutations using the same classification.
No request argument unlocks the ordinary MCP server. This routing grants no
permission: every original authorization, lease, lineage and effect check remains.
History/status/wait/result reads and exact owned cancellation stay on the
ordinary surface. Shared non-worker runtime, Core, Context, World and Go compute
remain available. Do not change a user's installed server automatically.

The following preserved API details apply only inside that explicit entry.
For one managed Session result, use the idle Session's exact
ExecutionAuthorization and `head_bounded_worker_dispatch`; `worker-execute`
receives the authorized sessionRequest. Preserve lease, role and scope checks.
`worker-apply` and waves remain Run-only. A wave groups independent
authorizations; it is not a shared permission.

For the built-in managed Codex patch-proposal path, HEAD derives task, exact
model, selected context, source paths and proposal targets, calls
`head_bounded_worker_prepare`, then `head_bounded_worker_start` with the returned
task key. Preparation can inspect the local provider backend but makes no model
turn; it is not account/model readiness proof. Never ask the user for modules,
JSON, IDs or routine approval. `selected-only` must not silently inherit global
instructions; select `host-global` only within approved input scope. A missing
managed backend affects that operation, not ordinary work. Existing unknown
effects, receipt/basis checks, user-edit protection and owned cleanup still apply.

Public preparation defaults to fresh (one turn). Explicit `context_mode:
"native-prefix"` uses selected context in a new durable controlled seed plus a
fork child (two turns); it does not inherit this HEAD conversation. Use it only
within the existing call/input/persistence scope, inspect `executionPlan`, and
do not claim the stronger native code-worker guarantees or cache savings.
When integration or wave status returns `guidance`, HEAD handles the scoped
inspection/reassessment or individual-job cleanup; do not turn that advice into
a new user form, approval step, automatic retry or P2 direction.

## Managed adapter architecture

```text
HEAD Core
  -> Project canon and authority
  -> AgentRuntimeAdapter
       -> Claude Code
       -> Codex
       -> OpenCode
  -> PlatformAdapter
       -> Windows
       -> macOS
       -> Linux
  -> WorkspaceHostAdapter
       -> native process
       -> provider-neutral host export
       -> separately owned optional host adapter
```

An AgentRuntimeAdapter should eventually expose capability probing, start, resume, event streaming, interrupt, and close through the runtime's supported machine interface. The current exact-owned one-shot supervisor activates only token-fenced interrupt and close; resume and stream remain deferred. Do not scrape a TUI or embed host-specific executable, socket, command, or pane behavior in this plugin.

A PlatformAdapter should own paths, process trees, atomic file operations, permissions, IPC, service lifecycle, and executable discovery. Do not carry POSIX-only assumptions into Windows.

The current plugin implements project canon, instruction/config projection, a read-only `RuntimeStateAdapter`, and explicit platform/runtime/host boundaries. Current-host discovery, fixed version/help evidence, and `RuntimeProjectBinding` expose capability without authorization. One `ExecutionAuthorization` envelope supports `scope.kind: session | run`: Session binds an idle HEAD Session, user-request digest, optional Capsule, local reversible actions, project root, and limits without WholePlan or Fresh HEAD review; Run additionally binds the exact active Run, ExecutionContract, WholePlan, and required Capsule. Both scopes share authorization-specific pre-start consumption, at-most-once lease, provider-neutral events, cancellation, cleanup, and transcript-free result evidence. Durable consumption/release and invocation result records remain project lineage while PID/token/owner-lock/schema/control-file state is confined to a host-selected operational root outside the project. Fixed Claude Code, Codex, and OpenCode one-shot compositions run through an integrity-verified native supervisor: Windows Job Objects and POSIX process groups own the provider descendant tree. All three have deterministic Session/Run and protocol-fixture evidence; Codex and OpenCode retain completed live model-call evidence, while Claude Code live model-call conformance is a separate opt-in gate. Fresh-process provider replacement, P2-first optional exact live HEAD attachment, already-running exact-endpoint coordination, worker-question/HEAD-reply waiting, independently owned worker dispatch/review/integration, and real one-shot interrupt/close cleanup are verified within their recorded runtime scope. General provider resume/stream, broader host control, raw transcripts, credentials, PIDs, and provider-session identifiers remain outside active durable capability.
