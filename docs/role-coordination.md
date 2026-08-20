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

## Current claim boundary

The Core, CLI, and role-bound MCP contract are implemented and tested for local
durability, role derivation, Project/Session/generation fences, binding
replacement, generation rotation, cross-project rejection, idempotency conflict,
read markers, immutable reply, delivery ambiguity, token non-persistence, and
zero project-canon mutation.

Actual Herdr pane delivery, a Codex/OpenCode multi-endpoint host composition,
service installation, and general provider start/resume/stream/interrupt/close
remain unimplemented. Until equivalent live multi-role E2E evidence exists, this
slice narrows but does not by itself replace the original HEAD Core's live
OpenCode/Herdr coordination advantage.
