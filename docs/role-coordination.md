# Provider-neutral durable role coordination

Role coordination is an optional host-local communication plane for the canonical
HEAD project roles: `head`, `developer`, `coder`, and `reviewer`. It adopts the
original HEAD Core's durable inbox, idempotency, immutable reply, generation
fence, and delivery separation without making Herdr, a provider session, a pane,
or a TUI part of HEAD semantic identity.

## Authority boundary

A coordination message or reply is evidence exchanged between roles. It is not
an instruction grant, `ExecutionAuthorization`, `ExecutionContract`,
`ReviewDecision`, Product Canon transition, promotion, or success judgment. Every
message and reply records all of these authority flags as false. An optional lane
label describes the surrounding risk context but grants no authority.

Role identity cannot be supplied to `send`, `read-inbox`, or `reply`. A trusted
host or administrator opens a host-local authority generation and issues a
one-time raw `CoordinationRoleBinding` token for one verified direct project role.
Only the token hash is stored. Each endpoint receives the raw token through the
`HEAD_AGENT_COORDINATION_BINDING_TOKEN` environment boundary; tool arguments do
not contain `self`, `from_role`, a provider session identifier, or the token.

The binding is scoped to the exact:

- project identity;
- canonical HEAD Session identity;
- current host-local coordination authority generation;
- direct `.head/roles/<role>.md` role;
- current binding for that role.

Replacing a role binding invalidates its previous token. Rotating the generation
invalidates every prior binding and hides prior-generation inboxes from the new
authority boundary without deleting their host-local records.

A trusted workspace host may additionally attach the current binding to one
fresh, unique live endpoint. Attach and detach are host-composition operations,
not public role tools. Attachment evidence is bound to the exact Project, HEAD
Session, generation, role, current binding, host instance, workspace, tab,
endpoint, terminal, canonical project-contained CWD, and runtime. Target records
form their own append-only hash/sequence/previous chain. Replacing a binding,
rotating a generation, detaching, losing an endpoint, or rolling back a target
pointer makes delivery unavailable or fails closed; none reactivates old state.

## State and persistence

All message bodies, role bindings, inboxes, read markers, replies, idempotency
records, and delivery receipts live beneath the validated external operational
state root used by runtime execution leases:

```text
<operational-root>/role-coordination/v1/
  <project-id>/<head-session-id>/
    current-generation.json
    generations/
    generation-state/<generation-id>/
      bindings/
      requests/
      inboxes/
      reads/
      replies/
      deliveries/
      targets/
```

The coordination plane writes nothing into `.head`, Product Canon, execution
lineage, GraphDB, Git, or provider transcripts. It is durable across process
restart and temporary target unavailability on the same host, but it is not
project recovery canon. Moving a project to another host requires an explicit
new generation and new bindings; no token or provider session identity is part
of semantic recovery.

## Operations

Administrative operations remain CLI/host-only and appear under `head help-all`:

```text
head coordination-open <project>
head coordination-rotate <project>
head coordination-bind <project> --role <role>
head coordination-status <project>
```

The bind command returns the raw binding token once. Inject it into the endpoint
environment instead of placing it in a JSON input, command argument, project
file, prompt, or transcript.

The role-facing CLI operations are:

```text
head coordination-send <project> --input <message.json>
head coordination-inbox <project>
head coordination-reply <project> --input <reply.json>
```

They resolve the token from `HEAD_AGENT_COORDINATION_BINDING_TOKEN` by default or
from an explicitly named environment reference. The MCP surface exposes exactly:

- `head_coordination_send_message`;
- `head_coordination_read_inbox`;
- `head_coordination_reply_message`.

`send` requires an idempotency key. Replaying the same key and exact normalized
payload returns the same message and any immutable reply; conflicting reuse fails
closed. `read-inbox` marks returned messages read in host-local state. `reply`
allows one immutable reply per message; the same reply is idempotent and a
different reply is rejected.

## Delivery separation

The durable inbox write completes before any optional `WorkspaceHostAdapter`
notification. Delivery has four bounded outcomes:

- `not_configured`: no live delivery adapter exists;
- `delivered`: the adapter reported exact completion;
- `unavailable`: no current exact target was available;
- `ambiguous`: completion could not be determined.

An ambiguous result is never retried automatically because doing so could inject
the same notification twice. Replaying the send returns the durable message and
the original delivery receipt without invoking the adapter again. A future live
host may offer an explicit, target-fenced redelivery operation as an
administrator/adapter effect; it is not part of the three public role tools.

The active provider-neutral adapter accepts caller identity only from the host
composition. The standard dedicated stdio process can receive that identity at
process start; a shared host may inject the equivalent caller object directly
into MCP dispatch. Tool arguments never accept it. Attach and every send use a
fresh driver snapshot. Delivery rereads the target pointer immediately before
the effect and again afterward. `delivered` requires an exact message/endpoint
acknowledgment plus an unchanged post-send endpoint; absence before the effect is
`unavailable`, while an exception, partial send, changed endpoint, changed target,
or unverifiable acknowledgment is `ambiguous`.

The plugin deliberately stops at a provider-neutral `WorkspaceHostDriver`
snapshot/send contract. It contains no host-specific executable, socket, command,
pane, or TUI translation. A separately owned optional adapter may translate a
supported host machine interface into normalized endpoint snapshots and exact
send acknowledgments, but cannot weaken unique endpoint, project-CWD, binding,
target, or post-send fences. Raw endpoint coordinates remain host-local
operational state, provider session identity is not persisted, and only the
attachment identity enters the delivery receipt.

The bundled production reference is `host-export`, a provider-neutral filesystem
mailbox rather than a workspace-manager integration. A trusted external host
publishes a content-addressed immutable endpoint snapshot and current pointer
outside the project. Each endpoint is uniquely bound to the exact current
coordination `bindingId` and the hash of a host-issued per-process proof; only the
raw proof injected into that process can activate the endpoint as a caller. A
snapshot may also register the exact current recipient binding before that
provider process starts. This grants offline reachability only, not role,
instruction, execution, review, decision, promotion, Canon, or process authority.
The sender must own its own current binding/proof; the recipient binding must
resolve uniquely; and the started recipient must independently prove its distinct
raw proof on its first MCP call. The bridge
rechecks endpoint tuple, binding ownership, and proof possession on every fresh
snapshot. Copied coordinates, foreign bindings, forged proofs, and duplicate
endpoint, terminal, binding, or proof ownership fail closed. Explicitly detached
bindings are not resolved through the offline path. Delivery creates one
exclusive, recipient-binding-bound request beneath the hashed endpoint location.
The host must acquire one exclusive pre-effect claim, then return one exclusive,
request-hash-bound acknowledgment within the bounded wait.
Claim acquisition revalidates the request's host, snapshot, workspace, tab,
endpoint, terminal, canonical CWD, runtime, and recipient binding against the
current export.
An existing unacknowledged claim is ambiguous and is never processed again
automatically. The host decides how to wake its provider;
Core never sees a binary, socket, CLI command, pane, TUI, provider session, or
credential. `scripts/workspace-host-export-mcp.mjs` composes this adapter from
host-injected environment references and rejects a requested project that differs
from the injected canonical project root.

The host must pre-create the export root and inject
`HEAD_AGENT_HOST_PROJECT_ROOT`, `HEAD_AGENT_WORKSPACE_HOST_EXPORT_ROOT`,
`HEAD_AGENT_HOST_WORKSPACE_ID`, `HEAD_AGENT_HOST_TAB_ID`,
`HEAD_AGENT_HOST_ENDPOINT_ID`, `HEAD_AGENT_HOST_PROCESS_PROOF`, and the existing
role binding token. A slow real-provider wake may additionally set the bounded
operational `HEAD_AGENT_WORKSPACE_HOST_ACK_TIMEOUT_MS` value from 10 through
600000; it is not persisted or used in semantic identity. The raw process proof is a host-only bearer capability; only
its domain-separated hash is present in the project-external snapshot. These are
process-composition inputs, never role-tool arguments or project artifacts.
The in-memory `fixture-host` driver is only a deterministic Core test double.
The production MCP entrypoint requires the binding, endpoint tuple, and process
proof together and has no proof-free fixture or delivery fallback.

The opt-in live verifier performs real model calls and therefore never runs as
part of the ordinary test suite:

```powershell
$env:HEAD_AGENT_LIVE_COORDINATION_E2E = "1"
$env:HEAD_AGENT_LIVE_COORDINATION_OPENCODE_MODEL = "provider/model"
npm run verify:live-coordination
```

It discovers the installed Codex/OpenCode executables, uses only the production
host-export MCP composition, captures provider output in memory, emits a
privacy-reduced hash/tool/cleanup summary, and removes its isolated project,
operational, export, and process-control roots on both success and failure.

## Current claim boundary

The Core, CLI, and role-bound MCP contract are implemented and tested for local
durability, role derivation, Project/Session/generation fences, binding
replacement, generation rotation, cross-project rejection, idempotency conflict,
read markers, immutable reply, delivery ambiguity, token non-persistence, and
zero project-canon mutation. The active WorkspaceHost boundary additionally has
deterministic two-fresh-process Codex/OpenCode endpoint evidence for attach,
delivery, stale/replaced/detached targets, target-chain rollback, target TOCTOU,
post-send topology change, partial-send ambiguity, exact acknowledgment,
project-CWD fencing, and provider-session absence.

The host-export production path additionally passes an actual provider-client
round trip: OpenCode calls send, the host claims the create-only binding-scoped
request before starting Codex, Codex calls read-inbox and immutable reply under a
distinct proof, the host verifies the durable reply and writes the exact ack, and
the waiting OpenCode call completes. Both provider trees have verified native
ownership/cleanup; `.head` is byte-identical; raw proofs, binding tokens, and
actual provider session references do not persist. Project/export overlap,
host-project mismatch, explicit detach, ack timeout, stale/foreign binding,
missing/old proof, and pointer tamper fail closed. Shared-host service
installation and general provider start/resume/stream/interrupt/close remain
unimplemented. Until the original author directly audits the exact source and
evidence, this slice does not claim comparative superiority.
