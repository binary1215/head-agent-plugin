# Runtime adapter contracts

Runtime-adapter contract `0.1.0` establishes the v0.6 provider-neutral boundary. Runtime-machine-discovery protocol `0.1.0` adds current-host read-only executable discovery, runtime-version-evidence protocol `0.1.0` adds a bounded non-session direct version invocation, runtime-protocol-evidence protocol `0.1.0` observes fixed provider-specific help surfaces, and runtime-project-binding protocol `0.1.0` binds those observations to canonical HEAD project and Session identities. Runtime-invocation authorization, event-envelope, lifecycle-receipt, and ResultPacket-draft protocols `0.1.0` now add the contract and conformance boundary immediately before provider control. None of these layers enables an actual provider session or runtime control.

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

The protocol-evidence composition runs only three fixed help profiles per selected runtime through the same direct-child, no-shell, ignored-stdin, minimal-environment boundary. Codex is checked for non-interactive execution, JSON events, output schema, ephemeral execution, resume surface, stdio app-server transport, and protocol schema generation. OpenCode is checked for non-interactive `run`, JSON event format, resume/continue surface, ACP, project-directory binding, and headless server discovery. Parser output is reduced to allowlisted signal names, support status, output digests and sizes, and exact-child lifecycle facts. Raw arguments, raw help text, paths, environment, provider session IDs, and PIDs are not returned.

The current Windows execution observes the required non-interactive and machine-protocol surfaces for both Codex and OpenCode. This records `actualProviderProtocolObservationValidated: true`, but `actualProviderSessionControlValidated`, provider-session creation, and runtime control remain false.

`RuntimeProjectBinding` then binds the version and protocol evidence identities to the canonical `.head/project.json` project ID and `.head/sessions/current.json` HEAD Session ID. The physical project root is reduced to a digest and no project content is sent to either runtime. This is a capability-reference binding only: it proves which HEAD project and Session inspected the installed interfaces, not that a provider session was created or attached to that project.

## Contract-bound invocation authorization

`runtime-invocation-authorize` may run only while the exact Run in `.head/sessions/current.json` is active and still matches its digest-verified `WholePlanSnapshot`, `ExecutionContract`, and persisted `ContextCapsule`. The ExecutionContract must explicitly include `runtime.invoke` and either `project.read` or `project.write`; a read-only contract cannot produce a workspace-write authorization. The selected runtime must belong to the project and have an observed protocol binding on the current host.

The resulting immutable `RuntimeInvocationAuthorization` records only canonical HEAD identities, the runtime, workspace mode, exact allowed-action requirements, project-root digest, capability evidence identities, execution-input digest/byte count, and bounded time/input/output/event limits. The actual execution input is deterministically reconstructed from the verified plan, contract, and Capsule and is never stored in the authorization. Authorization requires a future single-use execution lease and does not itself start a provider.

Provider-neutral `RuntimeEventEnvelope` records one JSONL event as its type, class, payload digest, byte count, and hashed operational provider-session references. Raw payloads and transcripts are not persisted. `RuntimeInvocationLifecycleReceipt` binds those envelopes to exact project, Session, Run, contract, caller-fence digest, child-fence digest, exit, timeout/cancellation, and cleanup facts without recording a PID or raw command. `RuntimeResultPacketDraft` converts the receipt to the existing structured return shape but cannot finish the Run or become a reviewed `ResultPacket` by itself.

The tracked lifecycle verifier uses a fixed no-descendant Node fixture, not Codex or OpenCode model execution. It proves bounded stdin input, input-digest observation, JSONL validation, exact-child exit, timeout termination, read-only action enforcement, and transcript-free ResultPacket drafts for both runtime identities. This proves the provider-neutral boundary while honestly leaving live provider process-tree ownership, execution leases, provider event normalization, provider-session attachment, and runtime control disabled.

## Authority and identity boundary

Runtime capability never grants authorization. A future control operation must still be bounded by an accepted `ExecutionContract`, exact project binding, caller identity, owned-process evidence, resource limits, cleanup, and ResultPacket/ReviewDecision lineage.

HEAD Session and Run IDs remain canonical project identities. Provider session IDs may later be attached only as operational references and never replace HEAD identities or enter core semantic identity. The current probe artifacts contain no provider session ID, raw command, endpoint, prompt, transcript, credential, raw output, path, or live process identity.

All descriptors and probes require:

- `instructionAuthority: false`;
- `promotionAuthority: false`;
- `controlAuthority: false`;
- `mutatesCanon: false`;
- `tuiScraping: false` for runtime adapters.

The static contract descriptors additionally require `capabilityAuthority: none`; the operational discovery, version, and protocol-evidence compositions instead declare `authority: operational-observation-only` and `capabilityDoesNotGrantAuthorization: true`. The project binding combines canonical HEAD references with operational evidence but has no instruction, promotion, control, or canon-mutation authority.

An adapter that advertises control, mutation, TUI scraping, or a different session-identity rule fails validation instead of being treated as available.

## Inspect the boundary

The CLI command is read-only:

```text
node scripts/head.mjs runtime-adapters <project>
```

The read-only MCP tool is `head_runtime_adapters`. Both use the runtimes selected in `.head/project.json`, return the deterministic three-platform/two-runtime contract matrix, current-host privacy-bounded discovery, bounded version and protocol evidence, and the canonical HEAD project/Session capability binding. They may start only the exact short-lived version and fixed-help children described above; they never create, resume, message, interrupt, or close a provider session.

After an active Run has an explicitly compatible ExecutionContract, the mutation CLI may prepare—but not execute—an authorization:

```text
node scripts/head.mjs runtime-invocation-authorize <project> --input <authorization.json>
node scripts/head.mjs runtime-invocation-read <project> --authorization <runtime-invocation-authorization-id>
```

The input contains only `runtime`, `workspaceMode`, and optional `limits`. The read-only MCP tool `head_runtime_invocation_authorization` verifies one persisted authorization. No MCP tool creates or consumes an authorization.

The tracked verifier is:

```text
npm run verify:runtime-adapters
npm run verify:runtime-lifecycle
```

The adapter verifier proves deterministic contract identities, Codex/OpenCode coverage, the Windows/macOS/Linux matrix, current-host discovery, version and protocol-evidence schemas, canonical project/Session capability binding, disabled control methods, authority-escalation rejection, tamper rejection, and privacy boundaries. The lifecycle verifier proves the active Run/contract/Capsule authorization chain, both runtime identities, bounded events, exact no-descendant child cleanup, timeout, write rejection, and ResultPacket drafting without a live provider. A sandbox that denies child creation yields explicit operational failure rather than being mistaken for runtime absence or successful execution.

## Next activation gate

Read-only path discovery, bounded non-session version invocation, provider-specific protocol/capability observation, and canonical HEAD project/Session capability binding are active. Before any `start`, `resume`, `stream`, `interrupt`, `close`, attach, messaging, or process-host control becomes active, the platform/runtime/host composition must still verify:

1. consume the prepared authorization through a durable single-use execution lease;
2. apply the conformed caller, child-process, and project-root fences to the actual Codex/OpenCode child and its descendants;
3. validate actual provider input, structured events, ResultPacket evidence, and provider-specific errors through the provider-neutral schemas;
4. prove actual provider cancellation, timeout, interrupt, close, and descendant cleanup;
5. actual provider-session binding remaining operational-only;
6. no canon, ReviewDecision, instruction, or promotion authority;
7. failure behavior that preserves the WholePlan, accepted Capsule, ExecutionContract, and evidence lineage.

Point-in-time `RuntimeStateAdapter` exports remain a separate evidence-only facility. They do not satisfy this control activation gate.
