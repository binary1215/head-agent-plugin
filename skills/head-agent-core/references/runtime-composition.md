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
       -> optional Herdr
```

An AgentRuntimeAdapter should eventually expose capability probing, start, resume, event streaming, interrupt, and close through the runtime's supported machine interface. Do not scrape a TUI.

A PlatformAdapter should own paths, process trees, atomic file operations, permissions, IPC, service lifecycle, and executable discovery. Do not carry POSIX-only assumptions into Windows.

The current plugin implements project canon, instruction/config projection, a read-only `RuntimeStateAdapter`, and explicit platform/runtime/host boundaries. Current-host discovery, fixed version/help evidence, and `RuntimeProjectBinding` expose capability without authorization. A separate `RuntimeInvocationAuthorization` now binds the exact active HEAD Run, verified ExecutionContract/WholePlan/ContextCapsule, workspace permission, project-root digest, and resource limits without persisting raw execution input. Provider-neutral event envelopes, lifecycle receipts, and ResultPacket drafts are conformed for both runtime identities through a fixed no-descendant child with timeout cleanup. Raw paths, commands, output, credentials, PIDs, and provider-session identifiers remain excluded. Actual provider invocation, durable single-use execution leases, live process-tree ownership, and all control methods remain disabled.
