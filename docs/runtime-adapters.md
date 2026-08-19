# Runtime adapter contracts

Runtime-adapter contract `0.1.0` establishes the v0.6 provider-neutral boundary. Runtime-machine-discovery protocol `0.1.0` adds current-host read-only executable discovery, runtime-version-evidence protocol `0.1.0` adds a bounded non-session direct version invocation, runtime-protocol-evidence protocol `0.2.0` observes fixed provider-specific help surfaces and the exact Codex one-shot option set, and runtime-project-binding protocol `0.1.0` binds those observations to canonical HEAD project and Session identities. Execution-authorization protocol `0.2.0` adds one envelope with `scope.kind: session | run`; execution-lease protocol `0.3.0` separates durable consumption/release evidence from operational owner state; process-supervisor protocol/manifest `0.1.0`, event-envelope `0.1.0`, structured-result `0.1.0`, lifecycle-receipt `0.6.0`, and ResultPacket-draft `0.5.0` carry scope through the common lifecycle boundary. A bounded Codex one-shot composition and its native descendant-tree supervisor are implemented. Live Session and consequential Run conformance have passed, including isolated write, canonical ResultPacket application, and Fresh HEAD review; general runtime controls and OpenCode execution remain disabled.

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

The protocol-evidence composition runs only three fixed help profiles per selected runtime through the same direct-child, no-shell, ignored-stdin, minimal-environment boundary. Codex is checked for non-interactive execution, JSON events, output schema, color control, sandbox selection, Git-check bypass, working-directory binding, ephemeral execution, resume surface, stdio app-server transport, and protocol schema generation. OpenCode is checked for non-interactive `run`, JSON event format, resume/continue surface, ACP, project-directory binding, and headless server discovery. Parser output is reduced to allowlisted signal names, support status, output digests and sizes, and exact-child lifecycle facts. Raw arguments, raw help text, paths, environment, provider session IDs, and PIDs are not returned.

The current Windows execution observes the required non-interactive and machine-protocol surfaces for both Codex and OpenCode. This records `actualProviderProtocolObservationValidated: true`, but `actualProviderSessionControlValidated`, provider-session creation, and runtime control remain false.

`RuntimeProjectBinding` then binds the version and protocol evidence identities to the canonical `.head/project.json` project ID and `.head/sessions/current.json` HEAD Session ID. The physical project root is reduced to a digest and no project content is sent to either runtime. This is a capability-reference binding only: it proves which HEAD project and Session inspected the installed interfaces, not that a provider session was created or attached to that project.

## Risk-proportional execution authorization

`runtime-invocation-authorize` produces one immutable `ExecutionAuthorization` envelope. A `session` scope requires an idle HEAD Session, records the user-request digest and byte count, permits only local reversible `project.read` or `project.write`, forbids canon mutation and external effects, and may reference a ContextCapsule. It does not require WholePlan, ExecutionContract, Run, or Fresh HEAD review. A `run` scope requires the exact active Run and its digest-verified `WholePlanSnapshot`, `ExecutionContract`, and persisted `ContextCapsule`; the contract must explicitly include `runtime.invoke` and the selected workspace permission. Both scopes require an enabled runtime and an observed current-host protocol binding.

The envelope records only canonical HEAD identities, the selected scope, runtime, workspace mode, exact allowed-action requirements, project-root digest, capability-evidence identities, execution-input digest/byte count, and bounded time/input/output/event limits. Raw Session requests and reconstructed Run input are not stored. Authorization does not itself start a provider.

## Durable at-most-once execution lease

The execution path first requires the exact digest-verified persisted authorization, then claims an authorization-specific `owner.lock` with an exact PID/token owner only for operational serialization. PID, token, and the owner lock live under a dedicated host-local operational root, never below the project tree. Windows defaults to `%LOCALAPPDATA%\head-agent-core\operational-state`; Unix-like hosts use `$XDG_STATE_HOME/head-agent-core` or `~/.local/state/head-agent-core`. A host may set the absolute `HEAD_AGENT_OPERATIONAL_STATE_ROOT` process configuration for isolated installations and tests, but execution requests and project files cannot select it. Root, project-local, project-containing, relative, symlinked, and escaping operational paths fail closed.

Before any child starts, the plugin atomically creates an immutable `RuntimeExecutionLeaseConsumption` receipt below project lineage. That receipt binds the authorization hash, project, HEAD Session, scope kind, optional Run/ExecutionContract, runtime, caller-fence digest, claim/consumption deadline, and the explicit boundary `atMostOnce: true` / `replayAllowed: false`. A crash after consumption never makes the authorization reusable; recovery requires a new HEAD decision rather than silent replay.

After the exact child exits—or the operation throws—the owner lock and empty authorization/project operational directories are removed, while the shared host-local root remains. An immutable project-lineage `RuntimeExecutionLeaseRelease` records the operation status, optional lifecycle-receipt identity, and exact-owner cleanup. A pre-consumption dead owner can be recovered only when its PID is proven absent. A live or ambiguous owner remains busy even after its hold deadline; the plugin never kills an unknown process. PID, token, and the operational path are excluded from consumption, release, lifecycle, ResultPacket-draft, CLI, and MCP artifacts. Lease inspection discloses only `location: host-local-outside-project` plus boolean privacy facts.

Provider-neutral `RuntimeEventEnvelope` records one JSONL event as its type, class, payload digest, byte count, and hashed operational provider-session references. Raw payloads and transcripts are not persisted. `RuntimeInvocationLifecycleReceipt` binds those envelopes and the consumption receipt to exact project, Session, scope, optional Run/contract, caller-fence digest, child-fence digest, exit, timeout/cancellation, and cleanup facts without recording a PID or raw command. Receipt `0.6.0` adds only sorted allowlisted diagnostic codes for provider errors and internal event/supervisor boundaries; raw error text remains ephemeral. `RuntimeResultPacketDraft` `0.5.0` carries those codes as evidence-only Unknowns. Run results still require Fresh HEAD review; Session results explicitly do not, unless a later risk transition escalates the work into a Run.

`RuntimeRunResultApplication` protocol `0.1.0` is the narrow bridge from a verified Codex Run draft into canonical Execution Lineage. It accepts only a completed exit-zero actual-provider Run whose structured result, exact input, project fence, and native descendant-tree ownership all passed. The bridge maps the bounded provider result into one canonical `ResultPacket`, transitions the exact Run to `awaiting_review`, builds the deterministic Fresh HEAD context, and writes a content-derived application receipt beside the invocation record. It is idempotent and can recover only the same ResultPacket after an interrupted receipt write; a divergent or Session-scoped result fails closed. The receipt carries no transcript, provider session identity, PID, path, instruction authority, promotion authority, or Product Canon mutation.

## Bounded Codex exec composition

`runtime-invocation-execute` currently accepts only a persisted Codex `ExecutionAuthorization`. It verifies that the authorization-bound protocol observation proves every fixed option used by the adapter and rejects an incomplete invocation surface, capability drift, or project-binding drift before lease consumption. It then invokes the absolute native executable directly with no shell. The fixed non-interactive surface is `codex exec` with JSONL output, ephemeral provider storage, the authorization's exact read-only or workspace-write sandbox, Git-repository independence, project-directory binding, deterministic color control, a host-local JSON Schema, and the exact authorized execution input over stdin. This follows the stable non-interactive flags documented in the [official Codex developer command reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli).

The common `RuntimeStructuredResult` carries bounded `outcome`, evidence statements, `planDelta`, `impactRadius`, verification statements, and explicit Unknowns. The Codex wire schema intentionally uses only the portable root-object, required-property, closed-object, scalar, enum, array, and item subset needed to shape the response; it omits a dialect declaration and type-specific length/item constraints. This keeps provider compatibility separate from product semantics. After decoding, the provider-neutral validator still enforces non-empty fields, 64-item list limits, per-field byte limits, the 128 KiB total result limit, and the Session rule that plan delta and impact radius remain empty. A separate per-JSONL-event limit defaults to 2 MiB, is capped by a smaller caller-selected total stdout limit, and remains independently bounded by the 8 MiB default total stdout budget. Raw JSONL and provider messages stay ephemeral; the provider-neutral invocation-record core stores only content-derived event envelopes, the lifecycle receipt, and a structured ResultPacket draft under the authorization-specific record. Recovery verifies the persisted authorization, runtime, project, HEAD Session, scope, receipt, event set, and draft as one lineage before returning it. The draft, receipt, and optional verified Run application are available through `runtime-invocation-result` and the read-only `head_runtime_invocation_result` MCP tool. `runtime-invocation-apply-run-result` is the only mutating bridge into canonical Run lineage; it derives ResultPacket runtime evidence from the verified authorization and is reusable by a conforming runtime adapter. Absolute project or operational roots in the structured result fail the invocation boundary.

This is a partial activation, not the v0.6 exit claim. The deterministic lifecycle verifier proves that removing one required Codex option from otherwise negotiated help evidence fails with `CODEX_EXEC_INVOCATION_SURFACE_NOT_VERIFIED` while the authorization remains unconsumed and replayable. It also proves that the portable wire schema contains no dialect or type-specific constraint keywords while the provider-neutral validator still rejects an over-bound structured result, and that raw provider failures reduce to fixed sorted diagnostic codes. The Codex protocol fixture proves fixed arguments, authorized stdin, `thread.started` reference hashing, `item.completed` structured-result extraction, `turn.completed`, immutable recording, CLI/MCP reads, and OS-enforced process-tree cleanup. The separate integrity-verified `head-agent-supervisor` assigns its provider subtree to a Windows Job Object with kill-on-close or to an isolated POSIX process group; only the native helper manifest digest and bounded cleanup facts enter durable evidence. Windows normal-exit and cancellation fixtures prove that a lingering grandchild is removed, and the Codex protocol fixture passes through the same supervisor. One live Session completed with structured output, read-only fixture integrity, and verified descendant cleanup. A later live Run invoked Codex and observed a structured result but exposed the former event boundary and then a canonical text-normalization mismatch. The enlarged bounded transport and an application-side normalization aligned with Execution Lineage resolved both issues. A succeeding actual Run created and reread the exact isolated file, preserved the protected fixture, verified native descendant cleanup, applied one canonical ResultPacket, and completed Fresh HEAD review. No raw transcript or provider identity became canonical and Product Canon remained unchanged. Resume, durable provider-session attachment, general stream/interrupt/close, messaging, and TUI scraping remain unavailable.

The tracked lifecycle verifier uses deterministic capability fixtures and a fixed no-descendant Node execution fixture, not Codex or OpenCode model execution. It proves Session and Run scopes for both runtime identities, provider-specific fixture-mode derivation from the authorization runtime, Session-request drift rejection, local reversible workspace-write authorization, pre-start consumption, sequential and in-flight replay rejection, tamper detection, release inspection, bounded stdin, JSONL validation, exact-child exit, timeout/caller-cancellation termination, Run contract action enforcement, and scope-correct review requirements. Its Codex protocol branch additionally proves the native supervisor manifest, provider-child handoff, structured result, tree cleanup, and transcript-free durable record. Provider-session attachment and general runtime control remain disabled.

## Authority and identity boundary

Runtime capability never grants authorization. A future control operation must still be bounded by a valid Session or Run `ExecutionAuthorization`, exact project binding, caller identity, owned-process evidence, resource limits, and cleanup. Only Run scope requires accepted ExecutionContract and ResultPacket/ReviewDecision lineage.

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

The mutation CLI may prepare—but not execute—an authorization for either an idle Session or an active contract-bound Run:

```text
node scripts/head.mjs runtime-invocation-authorize <project> --input <authorization.json>
node scripts/head.mjs runtime-invocation-read <project> --authorization <execution-authorization-id>
node scripts/head.mjs runtime-invocation-lease-status <project> --authorization <execution-authorization-id>
node scripts/head.mjs runtime-invocation-execute <project> --authorization <execution-authorization-id> --input <execution.json>
node scripts/head.mjs runtime-invocation-result <project> --authorization <execution-authorization-id>
node scripts/head.mjs runtime-invocation-apply-run-result <project> --authorization <execution-authorization-id>
```

The input contains `runtime`, `scope`, `workspaceMode`, and optional `limits`. Run scope is `{ "kind": "run" }`. Session scope is `{ "kind": "session", "request": "...", "contextCapsuleId": null }`; the request is used only to derive and later reconstruct the bounded stdin payload. The read-only MCP tools `head_runtime_invocation_authorization` and `head_runtime_invocation_lease_status` verify one persisted authorization and its available/claimed/consumed/released state. No MCP tool creates, claims, consumes, releases, or replays an authorization.

The tracked verifier is:

```text
npm run verify:runtime-adapters
npm run verify:runtime-lifecycle
```

The explicit live verifier is intentionally separate from normal regression because it performs real Codex model calls and one isolated workspace write. It requires a built, integrity-verified native supervisor and deliberate opt-in. It defaults to `run-only`, which skips the already conformed Session; `session-and-run` retains the fuller regression path. The mode selects coverage rather than imposing a product-level model-call quota:

```text
HEAD_AGENT_LIVE_CODEX_E2E=1 HEAD_AGENT_LIVE_CODEX_E2E_MODE=run-only npm run verify:live-codex
HEAD_AGENT_LIVE_CODEX_E2E=1 HEAD_AGENT_LIVE_CODEX_E2E_MODE=session-and-run npm run verify:live-codex
```

Without the environment opt-in it fails before creating a provider invocation. An unsupported optional mode also fails closed. Passing deterministic fixtures or implementing the application bridge does not count as live provider conformance.

The adapter verifier proves deterministic contract identities, Codex/OpenCode coverage, the Windows/macOS/Linux matrix, current-host discovery, version and protocol-evidence schemas, canonical project/Session capability binding, disabled control methods, authority-escalation rejection, tamper rejection, and privacy boundaries. The supervisor verifier proves Windows Job Object normal-exit and cancellation cleanup against a real provider fixture with a lingering grandchild; CI compiles and runs the POSIX process-group implementation on Linux and cross-builds every release target. The lifecycle verifier proves both authorization scopes, Session-request binding, Run/contract/Capsule binding, durable single consumption and release, sequential/concurrent replay rejection, bounded events, provider-neutral record recovery, OpenCode protocol-fixture mode validation, native-supervised Codex protocol extraction, timeout, caller cancellation, scope-correct write policy, and transcript-free result drafting without a live provider. A sandbox that denies child creation yields explicit operational failure rather than being mistaken for runtime absence or successful execution.

## Next activation gate

Read-only path discovery, bounded non-session version invocation, provider-specific protocol/capability observation, and canonical HEAD project/Session capability binding are active. Before any `start`, `resume`, `stream`, `interrupt`, `close`, attach, messaging, or process-host control becomes active, the platform/runtime/host composition must still verify:

1. preserve the completed live Codex Session conformance evidence through the externalized operational-state root, exact authorization/lease/caller/project fences, and verified native descendant supervisor;
2. validate the diagnosed large-event fix against evidence-led consequential live Codex Runs, including actual provider input, structured events, isolated file write, ResultPacket evidence, and provider-specific errors through the provider-neutral schemas;
3. prove live provider cancellation and timeout through the supervisor before considering interrupt/close or resume controls;
4. actual provider-session binding remaining operational-only;
5. no canon, ReviewDecision, instruction, or promotion authority;
6. failure behavior that preserves Session request identity or Run WholePlan/Capsule/ExecutionContract identity plus evidence lineage.

Point-in-time `RuntimeStateAdapter` exports remain a separate evidence-only facility. They do not satisfy this control activation gate.
