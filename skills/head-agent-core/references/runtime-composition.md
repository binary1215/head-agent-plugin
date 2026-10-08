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
- Run a long, sequential verification of an agreed change: delegate that bounded
  execution when its detail may crowd out HEAD's objective and constraints, even
  without parallel speedup. Return the acceptance findings, important new facts,
  remaining uncertainty and links to relevant evidence. HEAD checks any material
  gap against the user's goal; successful test execution alone is not completion.
- Fix a small error message directly; neither a fork nor fresh worker is needed.

These examples do not require a new artifact or selection ceremony. A fork's
history is context, not proof of current authority or workspace isolation.
Preserving judgment context does not make a particular parent conversation the
sole authority or recovery source. A detailed execution or review conversation is
not automatically a preserved copy of that higher-level context. Continue from
existing approved direction and applicable canonical recovery records, and inspect
specific source evidence when a result summary leaves an important question open.
For example, a favorable detailed review that never checked a user-required output
format leaves that criterion unresolved; HEAD assesses it before claiming the goal
is met. This is situational judgment, not a claim that direct detailed work makes
returning to the overall goal impossible or that delegation always performs better.

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

## Explicit managed execution

Choose this path when durable ownership, interruption recovery, unknown effects
or duplicate integration prevention need the managed contracts. It supports useful
new work and retained work. File editing, worker count, duration alone and ordinary
Host failure do not force it; ordinary Host delegation remains available.

Use `node <plugin-root>/scripts/head.mjs managed <command> ...`. In ordinary MCP,
discover the managed tool's unchanged schema and returned `executionMode`, then
call `head_tools_call` with `execution_mode: "managed"`. Known tools can be routed
without prior discovery. HEAD makes this choice internally; there is no user
unlock/launcher form. The original authorization, lease, lineage and effect checks
still run. Raw managed mutation names stay fenced on the ordinary server.
The retained `managed-maintenance` CLI and separate stdio server remain compatible
entries. Reads/status/wait and exact owned cancellation remain ordinary diagnostics.
Do not change a user's installed server automatically.

The following managed API details apply inside the explicit entry.
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

The current plugin keeps provider-neutral Project/Session identity, capability
observation and optional bounded execution separate. Session and Run authorizations
share scope, at-most-once ownership and cleanup; ordinary delegation uses Host
controls without role-token/generation/target-chain machinery. Retained work and
unknown effects preserve their exact records. Optional exact endpoint attachment
restores P2 first and keeps Host identity operational. The portable export bridge
is attachment-only. Static resume/stream and broader Host control remain deferred;
historical live role-message tests are not proof of the simplified path.
