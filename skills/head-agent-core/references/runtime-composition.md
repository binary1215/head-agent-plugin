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

The current plugin implements project canon, instruction/config projection, a read-only `RuntimeStateAdapter` for strict point-in-time host exports, and `PlatformAdapter`, `AgentRuntimeAdapter`, and `WorkspaceHostAdapter` boundaries. Codex and OpenCode plus Windows, macOS, Linux, and native-process appear in a deterministic contract matrix. A current-host discovery composition inspects PATH candidates and emits only hashed path identities, launcher facts, and availability. A separate bounded version-evidence composition invokes only the fixed non-session version surface through an exact child process and returns normalized version, output digest/size, and lifecycle facts without raw paths, raw output, project content, or provider sessions. All control methods fail closed. Process-hosting activation remains deferred until project/session binding, caller and process-tree ownership, cleanup/recovery, and runtime-session evidence are proved.
