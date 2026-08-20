# Runtime composition

Use one provider-neutral core and compose it with replaceable boundaries.

```text
HEAD Core
  -> Project canon and authority
  -> AgentRuntimeAdapter
       -> Codex
       -> OpenCode
       -> future runtimes
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

The current plugin implements project canon, instruction/config projection, a read-only `RuntimeStateAdapter`, and explicit platform/runtime/host boundaries. Current-host discovery, fixed version/help evidence, and `RuntimeProjectBinding` expose capability without authorization. One `ExecutionAuthorization` envelope supports `scope.kind: session | run`: Session binds an idle HEAD Session, user-request digest, optional Capsule, local reversible actions, project root, and limits without WholePlan or Fresh HEAD review; Run additionally binds the exact active Run, ExecutionContract, WholePlan, and required Capsule. Both scopes share authorization-specific pre-start consumption, at-most-once lease, provider-neutral events, cancellation, cleanup, and transcript-free result evidence. Durable consumption/release and invocation result records remain project lineage while PID/token/owner-lock/schema/control-file state is confined to a host-selected operational root outside the project. Fixed Codex and OpenCode one-shot compositions run through an integrity-verified native supervisor: Windows Job Objects and POSIX process groups own the provider descendant tree. Live Session/Run, fresh-process provider replacement, already-running exact-endpoint coordination, worker-question/HEAD-reply waiting, and real one-shot interrupt/close cleanup are verified. Provider-session resume/attachment, stream, broader host control, raw transcripts, credentials, PIDs, and provider-session identifiers remain outside active durable capability.
