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

The current plugin implements project canon, instruction/config projection, a read-only `RuntimeStateAdapter` for strict point-in-time host exports, and `PlatformAdapter`, `AgentRuntimeAdapter`, and `WorkspaceHostAdapter` boundaries. Codex and OpenCode plus Windows, macOS, Linux, and native-process appear in a deterministic contract matrix. A current-host discovery composition inspects PATH candidates and emits only hashed path identities, launcher facts, and availability. A bounded version-evidence composition invokes only the fixed non-session version surface. A provider-specific protocol composition invokes only fixed help profiles and reduces them to allowlisted capability signals, digests, byte counts, and lifecycle facts. `RuntimeProjectBinding` binds those observations to canonical HEAD project and Session identities while hashing the physical root and passing no project content. Raw paths, raw commands, raw output, credentials, PIDs, and provider sessions remain excluded. All control methods fail closed. Process-hosting activation remains deferred until an accepted ExecutionContract, caller and process-tree ownership, bounded event/result schemas, cleanup/recovery, and actual provider-session evidence are proved.
