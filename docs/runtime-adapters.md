# Runtime adapter contracts

Runtime-adapter contract `0.1.0` establishes the v0.6 provider-neutral boundary. Runtime-machine-discovery protocol `0.1.0` adds current-host read-only executable discovery, and runtime-version-evidence protocol `0.1.0` adds a bounded non-session direct version invocation. None of these layers enables provider-session or runtime control.

```text
HEAD Core
  -> AgentRuntimeAdapter
       -> Codex projection-only reference
       -> OpenCode projection-only reference
  -> PlatformAdapter
       -> Windows contract reference
       -> macOS contract reference
       -> Linux contract reference
  -> WorkspaceHostAdapter
       -> native-process contract reference
```

`AgentRuntimeAdapter` fixes the method surface `probe`, `start`, `resume`, `stream`, `interrupt`, and `close`. `PlatformAdapter` fixes platform-owned executable discovery, owned-process start/inspection/termination, paths, permissions, IPC, atomic file operations, and service lifecycle. `WorkspaceHostAdapter` fixes host attachment, messaging, receipt, and detachment.

The reference contract adapters support only static `probe`. Every control method fails with `RUNTIME_ADAPTER_CONTROL_NOT_ENABLED`. The contract matrix covers Codex and OpenCode across Windows, macOS, and Linux, but explicitly records:

- `actualPlatformExecutionValidated: false`;
- `actualRuntimeControlValidated: false`;
- `machineInterfacesVerified: false`;
- `runtimeControlEnabled: false`.

The matrix proves deterministic contract shape and authority boundaries. It does not claim that Codex or OpenCode is installed, reachable, resumable, or controllable on any listed operating system.

The separate current-host discovery composition uses a read-only `PlatformAdapter` to inspect absolute PATH entries for regular Codex and OpenCode launcher candidates. It records only runtime name, availability, launcher kind, byte length, symlink/direct-spawn safety, and SHA-256 identities of the discovered and canonical paths. It never returns a raw path, environment value, command, argument, provider session, prompt, transcript, endpoint, credential, or process identity. A read-only `AgentRuntimeAdapter` binds each observation to Codex or OpenCode, while the native-process `WorkspaceHostAdapter` reports only that its discovery boundary is present.

On the current Windows host both Codex and OpenCode candidates are discovered through this boundary. The discovery composition still records:

- `machineInterfaceDiscoveryValidated: true`;
- `actualPlatformExecutionValidated: false`;
- `actualRuntimeControlValidated: false`;
- `runtimeControlEnabled: false`.

The separate version-evidence composition may directly invoke only a discovered native, non-symlink executable with the fixed `--version` argument. The workspace-host boundary uses one exact child process, `shell: false`, ignored stdin, a five-second timeout, 16 KiB stdout/stderr limits, and an OS-minimal environment that does not forward project or GraphDB credentials. It creates no provider session, passes no project content, and stores only a normalized semantic version, output digest, byte counts, exit state, and cleanup facts. Raw paths and raw output are never returned.

The current Windows execution verified the installed Codex and OpenCode version surfaces. Runtime-version evidence records `actualPlatformExecutionValidated: true` only when every selected runtime completes this exact non-session probe. It continues to record:

- `actualRuntimeControlValidated: false`;
- `runtimeControlEnabled: false`;
- `providerSessionCreated: false`;
- `capabilityDoesNotGrantAuthorization: true`.

## Authority and identity boundary

Runtime capability never grants authorization. A future control operation must still be bounded by an accepted `ExecutionContract`, exact project binding, caller identity, owned-process evidence, resource limits, cleanup, and ResultPacket/ReviewDecision lineage.

HEAD Session and Run IDs remain canonical project identities. Provider session IDs may later be attached only as operational references and never replace HEAD identities or enter core semantic identity. The current probe artifacts contain no provider session ID, command, endpoint, prompt, transcript, credential, or live process identity.

All descriptors and probes require:

- `instructionAuthority: false`;
- `promotionAuthority: false`;
- `controlAuthority: false`;
- `mutatesCanon: false`;
- `tuiScraping: false` for runtime adapters.

The static contract descriptors additionally require `capabilityAuthority: none`; the operational discovery and version-evidence compositions instead declare `authority: operational-observation-only` and `capabilityDoesNotGrantAuthorization: true`.

An adapter that advertises control, mutation, TUI scraping, or a different session-identity rule fails validation instead of being treated as available.

## Inspect the boundary

The CLI command is read-only:

```text
node scripts/head.mjs runtime-adapters <project>
```

The read-only MCP tool is `head_runtime_adapters`. Both use the runtimes selected in `.head/project.json`, return the deterministic three-platform/two-runtime contract matrix, the current-host privacy-bounded machine-discovery composition, and bounded version evidence. They may start only the exact short-lived version child described above; they never create, resume, message, interrupt, or close a provider session.

The tracked verifier is:

```text
npm run verify:runtime-adapters
```

It proves deterministic contract identities, Codex/OpenCode coverage, the Windows/macOS/Linux matrix, current-host discovery and version-evidence schemas, bounded child lifecycle, disabled control methods, authority-escalation rejection, tamper rejection, and absence of raw paths, raw output, or provider-session identity from returned artifacts. A sandbox that denies child creation yields explicit `spawn-failed` operational evidence rather than being mistaken for runtime absence or successful execution.

## Next activation gate

Read-only path discovery and bounded non-session version invocation are active. Before any `start`, `resume`, `stream`, `interrupt`, `close`, attach, messaging, or process-host control becomes active, the platform/runtime/host composition must verify:

1. provider-specific non-interactive protocol negotiation beyond the completed fixed version probe, without a shell or TUI scraping;
2. canonical project and HEAD Session binding;
3. exact caller and child-process ownership;
4. bounded input/output and event schemas;
5. cancellation, timeout, interrupt, close, and descendant cleanup;
6. provider-session references remaining operational-only;
7. no canon, ReviewDecision, instruction, or promotion authority;
8. failure behavior that preserves the WholePlan, accepted Capsule, ExecutionContract, and evidence lineage.

Point-in-time `RuntimeStateAdapter` exports remain a separate evidence-only facility. They do not satisfy this control activation gate.
