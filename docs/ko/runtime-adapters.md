# 런타임 어댑터 계약

[영어 원문](../runtime-adapters.md)

런타임 어댑터 계약 `0.1.0`은 v0.6 공급자 중립 경계를 확립합니다. Runtime-machine-discovery 프로토콜 `0.1.0`은 현재 호스트에서 읽기 전용 실행 파일 탐색을 추가하고, runtime-version-evidence 프로토콜 `0.1.0`은 세션을 만들지 않는 제한된 직접 버전 호출을 추가하며, runtime-protocol-evidence 프로토콜 `0.2.0`은 고정된 공급자별 도움말 표면과 정확한 일회성 옵션 집합을 관찰하고, runtime-project-binding 프로토콜 `0.1.0`은 이러한 관찰 결과를 정식 HEAD 프로젝트 및 Session ID에 결속합니다. Execution-authorization 프로토콜 `0.3.0`은 `scope.kind: session | run`과 선택적인 정확한 `provider/model` 선택을 담는 하나의 봉투를 추가합니다. execution-lease 프로토콜 `0.3.0`은 내구성 있는 소비/해제 증거를 운영 소유자 상태와 분리합니다. process-supervisor 프로토콜/매니페스트 `0.1.0`, event-envelope `0.1.0`, structured-result `0.1.0`, lifecycle-receipt `0.6.0`, ResultPacket-draft `0.5.0`은 공통 수명 주기 경계를 통과해 범위를 전달합니다. Claude Code, Codex, OpenCode 일회성 어댑터는 동일한 네이티브 하위 프로세스 트리 감독자와 호출 기록 코어를 공유합니다. 세 어댑터 모두 결정론적 Session/Run 권한 부여, 수명 주기, 이벤트, 결과 및 공급자별 프로토콜 fixture 적합성을 통과합니다. Codex와 OpenCode는 완료된 실제 Session/Run 증거도 보존합니다. Claude Code 실제 모델 호출 적합성은 동일한 opt-in 검증기를 통해 확인할 수 있지만, 실행되기 전에는 충족되었다고 주장하지 않습니다. 새 프로세스를 통한 Codex에서 OpenCode로의 아티팩트 복구도 통과합니다. HEAD는 정확히 권한이 부여된 모델과 임시 권한/프라이버시 오버레이만 제공합니다. 공급자 인증과 라우팅은 계속 공급자가 소유합니다. HEAD는 공급자 패키지를 합성하지도, 구성된 endpoint를 다시 쓰지도 않습니다. 공급자 중립적인 호스트 로컬 역할 조정과 정확한 endpoint로의 WorkspaceHost 전달은 각각 별도의 신뢰된 binding 및 호스트 호출자 경계를 통해 활성화됩니다. 호스트별 실행, 소켓, CLI 명령, pane, TUI 통합은 의도적으로 이 플러그인의 범위 밖에 있으며, 별도 소유 어댑터만 제공할 수 있습니다. 공급자 resume과 일반 런타임 제어는 계속 비활성화되어 있습니다.

```text
HEAD Core
  -> AgentRuntimeAdapter
       -> Claude Code projection-only reference
       -> Codex projection-only reference
       -> OpenCode projection-only reference
  -> PlatformAdapter
       -> Windows contract reference
       -> macOS contract reference
       -> Linux contract reference
  -> WorkspaceHostAdapter
       -> native-process contract reference
       -> verified exact-endpoint role coordination
            -> injected provider-neutral WorkspaceHostDriver
                 -> host-export filesystem mailbox reference
```

`AgentRuntimeAdapter`는 메서드 표면 `probe`, `start`, `resume`, `stream`, `interrupt`, `close`를 고정합니다. `PlatformAdapter`는 플랫폼이 소유하는 실행 파일 탐색, 소유 프로세스 시작/검사/종료, 경로, 권한, IPC, 원자적 파일 작업 및 서비스 수명 주기를 고정합니다. `WorkspaceHostAdapter`는 호스트 연결, 메시징, receipt 및 연결 해제를 고정합니다.

참조 계약 어댑터는 정적 `probe`만 지원합니다. 모든 제어 메서드는 `RUNTIME_ADAPTER_CONTROL_NOT_ENABLED`로 실패합니다. 별도로 제공된 검증된 역할 조정 호스트는 `attach`, `send`, `receive`, `detach`만 활성화할 수 있습니다. 이는 AgentRuntime 또는 Platform 제어 메서드를 활성화하지 않고 `workspaceHostMessagingEnabled`만 변경합니다. 기본 계약 매트릭스는 Windows, macOS, Linux의 Claude Code, Codex, OpenCode를 포괄하지만 다음을 명시적으로 기록합니다.

- `actualPlatformExecutionValidated: false`;
- `actualRuntimeControlValidated: false`;
- `machineInterfacesVerified: false`;
- `runtimeControlEnabled: false`.

이 매트릭스는 결정론적 계약 형태와 권한 경계를 입증합니다. 열거된 모든 운영 체제에 어떤 런타임이 설치되어 있거나, 도달 가능하거나, 재개 가능하거나, 제어 가능하다고 주장하지 않습니다.

운영 일회성 감독자는 정적 `AgentRuntimeAdapter`보다 제어 표면이 더 좁습니다. `spawnBoundedRuntimeOneShot`은 무작위 호스트 전용 token 하나를 한 번만 반환하고, 정확히 소유한 Claude Code/Codex/OpenCode 공급자 트리에 대한 `interrupt` 또는 `close`만 허용하며, 충돌하는 두 번째 작업은 거부하고 네이티브 정리 후 콘텐츠에서 파생된 `RuntimeOneShotControlReceipt`를 내보냅니다. token, PID, 공급자 session, prompt 및 transcript는 지속되지 않습니다. `resume`과 `stream`은 `RUNTIME_ADAPTER_CONTROL_NOT_ENABLED`로 fail-closed합니다. 결정론적 Windows Job Object fixture와 실제로 이미 실행 중인 Codex/OpenCode 클라이언트가 두 작업과 하위 프로세스 정리를 입증합니다. 이는 내구성 있는 공급자 session 제어를 활성화하거나 `ExecutionAuthorization`을 확장하지 않습니다.

Session continuation의 범위는 이보다 더 좁습니다. Core가 먼저 정확한 P2 `SessionRestoreProjection`을 재구축합니다. 그 이후에만 주입된 WorkspaceHost 어댑터가 이미 실행 중인 HEAD endpoint를 새로 검증할 수 있습니다. 반환된 P5 `ContinuationOutcome`은 지속되지 않으며 projection을 변경할 수 없습니다. attachment가 없거나, stale하거나, 지원되지 않으면 명시적으로 새로운 논리적 HEAD로 fallback합니다. 이는 의미론적 복구에 선택적 대화 연속성을 더한 것이지, 일반적인 공급자 `resume` 또는 `stream`이 아닙니다.

Compaction lifecycle 통합도 선택적 P5 Host 구성입니다.
`CompactionLifecycleHostAdapter`는 정확한 Project, HEAD Session, runtime 및
trusted user-turn sequence에 결속된 journaled conversation-entry,
provider-replacement, pre/post-compaction event를 노출합니다. Raw continuation
token은 project Canon 밖에 보관합니다. Core는 읽기 전용 artifact entry restore를
자동 수행하고, 보고된 성공 compaction을 verify하거나 consume하기 전에 P2를
복원합니다. `failed`는 epoch만 abort하고 `uncertain`은 자동 replay하지 않습니다.
Descriptor는 provider/session/process/UI identity와 모든 P1-P4 authority를
금지합니다. Adapter가 없어도 일반 작업과 첫 turn artifact 복구는 가능하고
provider compaction만 Host 소유로 남습니다.

Run 범위 worker 소유권은 P3 `BoundedWorkerDispatch`로 나타내며, lease/process/wait 상태는 P5에 남습니다. 기존 네이티브 감독자는 정확한 `ExecutionAuthorization` 하나를 여전히 최대 한 번만 소비합니다. 완료된 실제 공급자 draft가 ResultPacket이 되려면 기존 application gate만 통과해야 하고, 이후 Fresh HEAD 검토와 명시적 P2 통합이 필요합니다. Dispatch와 wait는 WholePlan, ReviewDecision 또는 checkpoint direction을 쓸 수 없습니다.

공급자 중립 `BoundedWorkerWave`는 선택적으로 이미 생성된 dispatch 2~64개를 묶어 간결하게 시작 가시성을 제공합니다. 호출자 handle 또는 공급자/Herdr session topology를 저장하지 않고, authorization을 만들지 않으며, lease를 공유하지 않습니다. 명시적 seal에는 모든 독립 authorization의 소비가 검증되어야 합니다. 열린 wave의 aggregate result read와 wait는 fail-closed합니다. P4 status/results 및 P5 wait는 결과를 적용하거나 HF-010 통합을 수행할 수 없습니다. [`bounded-worker-wave.md`](bounded-worker-wave.md)를 참조하세요.

별도의 현재 호스트 탐색 구성은 읽기 전용 `PlatformAdapter`를 사용해 일반 Claude Code, Codex, OpenCode launcher candidate를 찾기 위해 절대 PATH 항목을 검사합니다. 런타임 이름, 가용성, launcher kind, byte length, symlink/direct-spawn safety, 탐색된 경로와 canonical path의 SHA-256 ID만 기록합니다. raw path, environment value, command, argument, 공급자 session, prompt, transcript, endpoint, credential 또는 process identity는 절대 반환하지 않습니다. 읽기 전용 `AgentRuntimeAdapter`는 각 관찰 결과를 선택된 하나의 런타임에 결속하고, native-process `WorkspaceHostAdapter`는 자신의 탐색 경계가 존재한다는 사실만 보고합니다.

현재 Windows 호스트에서 Claude Code, Codex, OpenCode candidate는 이 경계를 통해 탐색됩니다. 탐색 구성은 계속 다음을 기록합니다.

- `machineInterfaceDiscoveryValidated: true`;
- `actualPlatformExecutionValidated: false`;
- `actualRuntimeControlValidated: false`;
- `runtimeControlEnabled: false`.

별도의 버전 증거 구성은 탐색된 네이티브 비 symlink 실행 파일만 고정된 `--version` 인수로 직접 호출할 수 있습니다. workspace-host 경계는 정확히 하나의 자식 프로세스, `shell: false`, 무시되는 stdin, 5초 timeout, 16 KiB stdout/stderr limit, 프로젝트 또는 GraphDB credential을 전달하지 않는 OS 최소 environment를 사용합니다. 공급자 session을 생성하지 않고, 프로젝트 콘텐츠를 전달하지 않으며, 정규화된 semantic version, output digest, byte count, exit state 및 cleanup fact만 저장합니다. raw path와 raw output은 절대 반환되지 않습니다.

현재 Windows 실행은 설치된 Claude Code, Codex, OpenCode의 version surface를 검증했습니다. runtime-version evidence는 선택한 모든 런타임이 정확히 이 비 session probe를 완료한 경우에만 `actualPlatformExecutionValidated: true`를 기록합니다. 계속 다음도 기록합니다.

- `actualRuntimeControlValidated: false`;
- `runtimeControlEnabled: false`;
- `providerSessionCreated: false`;
- `capabilityDoesNotGrantAuthorization: true`.

protocol-evidence 구성은 동일한 direct-child, no-shell, ignored-stdin, minimal-environment 경계를 통해 고정된 help profile을 실행합니다. Claude Code는 non-interactive print mode, stream-json, JSON Schema output, non-persisted session, permission/tool control, disabled skill, bounded setting source, strict MCP isolation, resume/continue discovery를 검사합니다. Codex는 non-interactive execution, JSON event, output schema, color control, sandbox selection, Git-check bypass, working-directory binding, ephemeral execution, resume surface, stdio app-server transport, protocol schema generation을 검사합니다. OpenCode는 non-interactive `run`, JSON event format, resume/continue surface, ACP, project-directory binding, headless server discovery를 검사합니다. Parser output은 allowlist에 포함된 signal name, support status, output digest와 size, exact-child lifecycle fact로 축소됩니다. raw argument, raw help text, path, environment, 공급자 session ID 및 PID는 반환되지 않습니다.

현재 Windows 실행은 Claude Code, Codex, OpenCode에 필요한 non-interactive 및 machine-protocol surface를 관찰합니다. 이는 `actualProviderProtocolObservationValidated: true`를 기록하지만, `actualProviderSessionControlValidated`, provider-session creation 및 runtime control은 계속 false입니다.

그런 다음 `RuntimeProjectBinding`은 version 및 protocol evidence ID를 canonical `.head/project.json` project ID와 `.head/sessions/current.json` HEAD Session ID에 결속합니다. 물리적 project root는 digest로 축소되며 이 probe 동안 어떤 프로젝트 콘텐츠도 전송되지 않습니다. 이는 capability-reference binding일 뿐입니다. 즉, 어떤 HEAD project 및 Session이 설치된 interface를 검사했는지를 입증할 뿐, 공급자 session이 생성되었거나 해당 프로젝트에 연결되었음을 입증하지 않습니다.

## 위험 비례 실행 권한 부여

`runtime-invocation-authorize`는 불변 `ExecutionAuthorization` 봉투 하나를 생성합니다. `session` scope는 유휴 HEAD Session을 요구하고, user-request digest와 byte count를 기록하며, 로컬에서 되돌릴 수 있는 `project.read` 또는 `project.write`만 허용하고, canon mutation 및 external effect를 금지하며, ContextCapsule을 참조할 수 있습니다. WholePlan, ExecutionContract, Run 또는 Fresh HEAD review는 요구하지 않습니다. `run` scope는 정확히 active Run과 digest 검증된 `WholePlanSnapshot`, `ExecutionContract`, persisted `ContextCapsule`을 요구합니다. 계약은 `runtime.invoke`와 선택된 workspace permission을 명시적으로 포함해야 합니다. 두 scope 모두 활성화된 런타임과 관찰된 current-host protocol binding을 요구합니다. 선택적 `runtimeSelection.model`은 제한된 `provider/model` 식별자여야 하며 authorization digest의 일부가 됩니다. 따라서 모델을 바꾸려면 user-global default를 조용히 따르는 대신 새로운 authorization이 필요합니다. 공급자 구현, endpoint 및 credential은 HEAD preset이나 semantic graph data가 아니라 운영 OpenCode 설정으로 남습니다.

봉투는 canonical HEAD identity, 선택된 scope, runtime, optional model selection, workspace mode, 정확한 allowed-action requirement, project-root digest, capability-evidence ID, execution-input digest/byte count, 제한된 time/input/output/event limit만 기록합니다. credential과 endpoint는 운영 environment input으로 남으며 authorization이나 project artifact에 추가되지 않습니다. raw Session request와 reconstructed Run input은 저장되지 않습니다. Authorization 자체는 공급자를 시작하지 않습니다.

## 내구성 있는 최대 1회 실행 lease

실행 경로는 먼저 정확히 digest 검증된 persisted authorization을 요구한 다음, 운영 직렬화를 위해서만 정확한 PID/token owner로 authorization별 `owner.lock`을 claim합니다. PID, token 및 owner lock은 전용 host-local operational root 아래에 있으며 project tree 아래에는 절대 두지 않습니다. Windows 기본값은 `%LOCALAPPDATA%\head-agent-core\operational-state`입니다. Unix 계열 호스트는 `$XDG_STATE_HOME/head-agent-core` 또는 `~/.local/state/head-agent-core`를 사용합니다. 호스트는 격리된 설치 및 테스트를 위해 절대 `HEAD_AGENT_OPERATIONAL_STATE_ROOT` process configuration을 설정할 수 있지만, execution request 및 project file은 이를 선택할 수 없습니다. root, project-local, project-containing, relative, symlinked 및 escaping operational path는 fail-closed합니다.

자식 프로세스가 시작되기 전에 플러그인은 project lineage 아래에 불변 `RuntimeExecutionLeaseConsumption` receipt를 원자적으로 생성합니다. 이 receipt는 authorization hash, project, HEAD Session, scope kind, 선택적 Run/ExecutionContract, runtime, caller-fence digest, claim/consumption deadline 및 명시적 경계 `atMostOnce: true` / `replayAllowed: false`를 결속합니다. 소비 후 crash가 발생해도 authorization은 절대 재사용 가능해지지 않습니다. 복구에는 조용한 replay가 아니라 새로운 HEAD 결정이 필요합니다.

정확한 자식 프로세스가 종료되거나 작업이 예외를 throw한 후에는 owner lock과 빈 authorization/project operational directory가 제거되고, 공유 host-local root는 남습니다. 불변 project-lineage `RuntimeExecutionLeaseRelease`는 operation status, 선택적 lifecycle-receipt ID 및 exact-owner cleanup을 기록합니다. 소비 전 dead owner는 PID가 존재하지 않음이 입증된 경우에만 복구할 수 있습니다. live 또는 ambiguous owner는 hold deadline이 지난 뒤에도 busy 상태로 남습니다. 플러그인은 알 수 없는 프로세스를 절대 종료하지 않습니다. PID, token 및 operational path는 consumption, release, lifecycle, ResultPacket-draft, CLI 및 MCP artifact에서 제외됩니다. Lease inspection은 `location: host-local-outside-project`와 boolean privacy fact만 공개합니다.

공급자 중립 `RuntimeEventEnvelope`는 JSONL event 하나를 type, class, payload digest, byte count 및 hash된 운영 provider-session reference로 기록합니다. raw payload와 transcript는 지속되지 않습니다. `RuntimeInvocationLifecycleReceipt`는 PID 또는 raw command를 기록하지 않고 이 envelope와 consumption receipt를 정확한 project, Session, scope, 선택적 Run/contract, caller-fence digest, child-fence digest, exit, timeout/cancellation 및 cleanup fact에 결속합니다. Receipt `0.6.0`은 공급자 error와 internal event/supervisor boundary를 위해 정렬된 allowlist diagnostic code만 추가합니다. raw error text는 임시 상태로 남습니다. `RuntimeResultPacketDraft` `0.5.0`은 이 code를 evidence-only Unknown으로 전달합니다. Run result에는 여전히 Fresh HEAD review가 필요합니다. Session result에는 이후 risk transition으로 작업이 Run으로 승격되지 않는 한 명시적으로 필요하지 않습니다.

`RuntimeRunResultApplication` 프로토콜 `0.1.0`은 검증된 실제 공급자 Run draft에서 canonical Execution Lineage로 이어지는 좁은 공급자 중립 bridge입니다. structured result, exact input, project fence 및 native descendant-tree ownership 검사를 모두 통과한 완료된 exit-zero 실제 공급자 Run만 허용합니다. 이 bridge는 제한된 공급자 result를 canonical `ResultPacket` 하나에 mapping하고, 정확한 Run을 `awaiting_review`로 전환하며, 결정론적 Fresh HEAD context를 구축하고, invocation record 옆에 콘텐츠에서 파생된 application receipt를 기록합니다. 멱등성을 가지며 receipt write가 중단된 뒤에도 동일한 ResultPacket만 복구할 수 있습니다. 서로 다른 result 또는 Session 범위 result는 fail-closed합니다. receipt에는 transcript, 공급자 session ID, PID, path, instruction authority, promotion authority 또는 Product Canon mutation이 없습니다.

## 제한된 공급자 일회성 구성

`runtime-invocation-execute`는 persisted Claude Code, Codex 또는 OpenCode `ExecutionAuthorization`을 받아 공급자별 launch/event codec만 공유 authorization, lease, native supervisor, invocation-record 및 result-application core 위에서 dispatch합니다. 각 어댑터는 lease consumption 전에 capability 또는 project-binding drift를 거부하고 shell 없이 absolute native executable을 직접 호출합니다. Claude Code는 non-interactive `--print`, stream-json event, JSON Schema output, `--no-session-persistence`, 로드되는 setting source 또는 slash-command skill 없음, strict empty MCP configuration, workspace mode에서 파생된 exact tool allowlist를 사용합니다. Read-only는 `Read`, `Glob`, `Grep`만 허용합니다. workspace-write는 `Edit`와 `Write`를 추가하면서 Bash, web, notebook, task, plugin 및 external effect를 계속 거부합니다. `--dangerously-skip-permissions`는 절대 사용하지 않습니다. Codex는 JSONL output, ephemeral provider storage, authorization의 정확한 read-only 또는 workspace-write sandbox, Git-repository independence, project-directory binding, deterministic color control, host-local JSON Schema, optional authorized model selection 및 stdin을 통한 정확한 authorized execution input과 함께 `codex exec`를 사용합니다. OpenCode는 `opencode run --format json --pure`, 정확한 project-directory binding, optional authorized model selection, workspace mode에서 파생된 permission projection 및 동일한 bounded stdin/result contract를 사용합니다. 공급자 authentication과 endpoint selection은 계속 공급자가 소유합니다. 일회성 실행에서는 project-local setting, external plugin 및 skill이 비활성화되므로 repository content가 execution policy를 대체할 수 없습니다. 공급자별 configuration은 Product Canon 또는 graph identity에 들어가지 않습니다.

공통 `RuntimeStructuredResult`는 제한된 `outcome`, evidence statement, `planDelta`, `impactRadius`, verification statement 및 명시적 Unknown을 전달합니다. Codex wire schema는 response 형태를 만드는 데 필요한 portable root-object, required-property, closed-object, scalar, enum, array 및 item subset만 의도적으로 사용합니다. dialect declaration과 type별 length/item constraint는 생략합니다. 이는 공급자 compatibility를 product semantics와 분리합니다. decoding 후에도 공급자 중립 validator는 non-empty field, 64-item list limit, field별 byte limit, 128 KiB total result limit, plan delta와 impact radius를 비워 두어야 한다는 Session rule을 강제합니다. 별도의 JSONL event별 limit 기본값은 2 MiB이고, 호출자가 선택한 더 작은 total stdout limit으로 상한이 정해지며, 8 MiB default total stdout budget으로부터 독립적으로 제한됩니다. raw JSONL과 공급자 message는 임시 상태로 남습니다. 공급자 중립 invocation-record core는 콘텐츠에서 파생된 event envelope, lifecycle receipt 및 structured ResultPacket draft만 authorization별 record 아래에 저장합니다. Recovery는 persisted authorization, runtime, project, HEAD Session, scope, receipt, event set 및 draft를 하나의 lineage로 검증한 뒤 반환합니다. draft, receipt 및 선택적 verified Run application은 `runtime-invocation-result`와 read-only `head_runtime_invocation_result` MCP tool을 통해 사용할 수 있습니다. `runtime-invocation-apply-run-result`는 canonical Run lineage로 이어지는 유일한 mutating bridge입니다. verified authorization에서 ResultPacket runtime evidence를 파생하며, conforming runtime adapter가 재사용할 수 있습니다. structured result의 absolute project 또는 operational root는 invocation boundary에서 실패합니다.

결정론적 lifecycle verifier는 lease consumption 전 invocation-surface drift rejection, model-selection digest binding, invalid selection rejection, legacy authorization compatibility, portable wire shape, 보존된 semantic bound, privacy-reduced provider diagnostic 및 provider authority 보존을 입증합니다. Claude Code, Codex, OpenCode protocol fixture는 fixed argument, authorized stdin, provider event decoding, immutable recording, CLI/MCP read 및 OS-enforced process-tree cleanup을 입증합니다. 별도의 integrity-verified `head-agent-supervisor`는 공급자 subtree를 kill-on-close가 설정된 Windows Job Object 또는 격리된 POSIX process group에 할당합니다. native helper manifest digest와 bounded cleanup fact만 durable evidence에 들어갑니다. 실제 Codex 및 OpenCode Run은 각각 정확한 격리 파일을 만들고 다시 읽었으며, protected fixture를 보존하고, native descendant cleanup을 검증하고, canonical ResultPacket 하나를 적용하고, Fresh HEAD review를 완료했습니다. Claude Code에는 동일한 live verifier entry point가 있지만 explicit opt-in run이 완료될 때까지 live model-call claim을 하지 않습니다. 별도의 recovery E2E는 Codex를 완료하고, project root와 이전 HEAD authorization ID만으로 새 프로세스를 시작하며, artifact에서 canonical Project/HEAD Session을 재구축하고, Git, GraphDB 또는 persisted provider-session identity 없이 OpenCode fixture invocation을 완료합니다. 일반 공급자 resume, durable hidden-session restoration, stream, provider-session messaging 및 TUI scraping은 계속 사용할 수 없습니다. P2-first optional exact HEAD attachment, exact-owned-tree one-shot interrupt/close 및 authority-free role coordination은 아래의 별도 host boundary를 사용합니다.

추적되는 lifecycle verifier는 provider model execution이 아닌 deterministic capability fixture와 fixed Node execution fixture를 사용합니다. 세 runtime identity 모두의 Session 및 Run scope, authorization runtime에서 공급자별 fixture mode 파생, Session-request drift rejection, model binding, local reversible workspace-write authorization, pre-start consumption, sequential 및 in-flight replay rejection, tamper detection, release inspection, bounded stdin, JSONL validation, exact-child exit, timeout/caller-cancellation termination, Run contract action enforcement 및 scope-correct review requirement를 입증합니다. 별도의 provider-replacement verifier는 새 프로세스를 통한 artifact-only Codex-to-OpenCode recovery proof를 추가합니다. Optional P2-first exact HEAD attachment는 활성 상태입니다. 일반 provider resume/stream 및 더 광범위한 runtime control은 계속 비활성화되어 있습니다.

## 공급자 중립 역할 조정 경계

Role coordination 프로토콜 `0.1.0`은 검증된 external operational root를 재사용하지만 `ExecutionAuthorization` 및 provider-session control과 계속 분리되어 있습니다. 신뢰된 host/admin이 generation을 열고 일회성 raw binding token을 검증된 하나의 direct project role에 발급합니다. public send/read/wait-reply/reply operation은 해당 binding에서 caller role을 파생합니다. role과 token은 MCP argument에 없습니다. Project, HEAD Session, generation, binding replacement 및 cross-project fence는 fail-closed합니다.

내구성 있는 message acceptance가 선택적 notification delivery보다 먼저 이루어집니다. Inbox, idempotency, read, immutable reply 및 delivery record는 host-local이며 `.head` 또는 Product Canon에 들어가지 않고 process restart 후에도 유지됩니다. 모든 message 및 reply authority flag는 false입니다. ambiguous live delivery는 자동으로 재시도되지 않습니다. state, CLI/MCP, failure 및 current-claim boundary는 [`role-coordination.md`](role-coordination.md)를 참조하세요.

활성 `VerifiedWorkspaceHostAdapter`는 caller evidence를 host composition에서만 받으며 role tool argument에서는 절대 받지 않습니다. 새로운 unique endpoint를 append-only host-local target chain의 current role binding에 결속합니다. 모든 delivery는 current recipient binding과 target pointer, 새로운 exact host snapshot, exact message/endpoint acknowledgment, 변경되지 않은 post-delivery endpoint 및 변경되지 않은 target pointer를 검증합니다. missing 또는 stale state는 unavailable입니다. partial effect와 unverifiable change는 ambiguous하며 자동으로 재시도되지 않습니다. delivery receipt는 raw endpoint 또는 provider-session identity가 아니라 binding 및 attachment identity만 노출합니다.

플러그인은 이 계약을 host-specific executable, socket, command, pane 또는 TUI protocol로 변환하지 않습니다. 신뢰된 composition은 normalized snapshot과 exact send acknowledgment를 보고하는 driver를 주입합니다. 어댑터는 외부 호스트가 해당 증거를 얻은 방법을 알지 못한 채 protocol identity, unique endpoint identity, runtime, byte bound 및 project-contained canonical CWD를 검증합니다. Host-specific translation은 별도 소유 optional adapter에 속하며 이러한 검사를 약화할 수 없습니다.

`host-export`는 해당 injection boundary의 production portable reference입니다. root는 canonical이며 non-symlinked이고 project 외부에 있어야 하며 project를 포함해서는 안 됩니다. immutable content-addressed snapshot이 verified current pointer에 정보를 제공합니다. Delivery request, pre-effect claim 및 acknowledgment는 hashed endpoint location 아래의 separate create-only file입니다. claim과 acknowledgment는 exact request hash, host instance, endpoint tuple 및 message에 결속됩니다. 또한 claim은 external host가 effect를 적용하기 전에 current snapshot, canonical CWD 및 runtime을 다시 검사합니다. acknowledgment가 없는 claim은 ambiguous하며 자동으로 다시 소비할 수 없습니다. 제한된 wait 뒤에도 acknowledgment가 없으면 마찬가지로 ambiguous합니다. optional MCP entrypoint는 project/caller/export tuple, raw per-process proof 및 coordination binding을 host process environment에서만 받습니다. exported endpoint는 unique binding ID와 domain-separated proof hash만 포함합니다. 모든 snapshot은 possession과 exact binding ownership을 검증한 뒤 sanitized endpoint를 Core에 노출하며, 다른 project에 대한 tool request는 거부됩니다. In-memory fixture driver는 generic adapter contract만 입증하며 production live-caller claim이 아닙니다. process-proof composition input이 없거나 stale하면 `workspace-host-export-mcp.mjs`는 fail-closed하고 해당 fixture로 fallback할 수 없습니다.

## 권한 및 ID 경계

런타임 capability는 절대 authorization을 부여하지 않습니다. 향후 제어 작업도 유효한 Session 또는 Run `ExecutionAuthorization`, 정확한 project binding, caller identity, owned-process evidence, resource limit 및 cleanup으로 제한되어야 합니다. Run scope만 accepted ExecutionContract와 ResultPacket/ReviewDecision lineage를 요구합니다.

HEAD Session 및 Run ID는 계속 canonical project identity입니다. Provider session ID는 나중에도 operational reference로만 연결할 수 있고, HEAD identity를 대체하거나 core semantic identity에 들어갈 수 없습니다. original provider process와 provider session이 사라진 경우에도 verified HEAD artifact에서 복구할 수 있어야 합니다. 현재 probe 및 invocation artifact에는 provider session ID, raw command, endpoint, prompt, transcript, credential, raw output, path 또는 live process identity가 없습니다.

모든 descriptor 및 probe는 다음을 요구합니다.

- `instructionAuthority: false`;
- `promotionAuthority: false`;
- `controlAuthority: false`;
- `mutatesCanon: false`;
- runtime adapter의 경우 `tuiScraping: false`.

static contract descriptor는 추가로 `capabilityAuthority: none`을 요구합니다. 반면 operational discovery, version 및 protocol-evidence composition은 `authority: operational-observation-only`와 `capabilityDoesNotGrantAuthorization: true`를 선언합니다. project binding은 canonical HEAD reference와 operational evidence를 결합하지만 instruction, promotion, control 또는 canon-mutation authority는 없습니다.

control, mutation, TUI scraping 또는 다른 session-identity rule을 내세우는 어댑터는 사용 가능한 것으로 취급되는 대신 validation에 실패합니다.

## 경계 검사

CLI command는 read-only입니다.

```text
node scripts/head.mjs runtime-adapters <project>
```

read-only MCP tool은 `head_runtime_adapters`입니다. 둘 다 `.head/project.json`에서 선택된 runtime을 사용하며, 결정론적 three-platform/three-runtime contract matrix, current-host privacy-bounded discovery, bounded version 및 protocol evidence, canonical HEAD project/Session capability binding을 반환합니다. 위에서 설명한 정확한 short-lived version 및 fixed-help child만 시작할 수 있습니다. provider session을 생성, resume, message, interrupt 또는 close하지 않습니다.

mutation CLI는 idle Session 또는 active contract-bound Run에 대한 authorization을 준비할 수는 있지만 실행할 수는 없습니다.

```text
node scripts/head.mjs runtime-invocation-authorize <project> --input <authorization.json>
node scripts/head.mjs runtime-invocation-read <project> --authorization <execution-authorization-id>
node scripts/head.mjs runtime-invocation-lease-status <project> --authorization <execution-authorization-id>
node scripts/head.mjs runtime-invocation-execute <project> --authorization <execution-authorization-id> --input <execution.json>
node scripts/head.mjs runtime-invocation-result <project> --authorization <execution-authorization-id>
node scripts/head.mjs runtime-invocation-apply-run-result <project> --authorization <execution-authorization-id>
```

input에는 `runtime`, `scope`, `workspaceMode` 및 optional `limits`가 들어 있습니다. Run scope는 `{ "kind": "run" }`입니다. Session scope는 `{ "kind": "session", "request": "...", "contextCapsuleId": null }`입니다. request는 bounded stdin payload를 파생하고 나중에 재구성하는 데만 사용됩니다. read-only MCP tool `head_runtime_invocation_authorization`과 `head_runtime_invocation_lease_status`는 persisted authorization 하나와 available/claimed/consumed/released state를 검증합니다. 어떤 MCP tool도 authorization을 생성, claim, consume, release 또는 replay하지 않습니다.

추적되는 verifier는 다음과 같습니다.

```text
npm run verify:runtime-adapters
npm run verify:runtime-lifecycle
```

명시적 live verifier는 실제 provider model call과 하나의 isolated workspace write를 수행하므로 normal regression과 의도적으로 분리되어 있습니다. build되고 integrity-verified된 native supervisor와 deliberate opt-in이 필요합니다. 기본값은 이미 적합성을 확인한 Session을 건너뛰는 `run-only`입니다. `session-and-run`은 더 완전한 regression path를 유지합니다. mode는 product-level model-call quota를 부과하는 대신 coverage를 선택합니다. legacy `HEAD_AGENT_LIVE_CODEX_E2E` name은 compatibility를 위해 계속 허용됩니다.

```text
HEAD_AGENT_LIVE_RUNTIME_E2E=1 HEAD_AGENT_LIVE_RUNTIME=codex HEAD_AGENT_LIVE_RUNTIME_E2E_MODE=run-only npm run verify:live-runtime
HEAD_AGENT_LIVE_RUNTIME_E2E=1 HEAD_AGENT_LIVE_RUNTIME=opencode HEAD_AGENT_LIVE_RUNTIME_MODEL=provider/model HEAD_AGENT_LIVE_RUNTIME_E2E_MODE=session-and-run npm run verify:live-runtime
HEAD_AGENT_LIVE_RUNTIME_E2E=1 HEAD_AGENT_LIVE_RUNTIME=claude HEAD_AGENT_LIVE_RUNTIME_MODEL=anthropic/model-name HEAD_AGENT_LIVE_RUNTIME_E2E_MODE=session-and-run npm run verify:live-runtime
```

environment opt-in이 없으면 provider invocation을 만들기 전에 실패합니다. 지원되지 않는 optional mode도 fail-closed합니다. deterministic fixture를 통과하거나 application bridge를 구현한 것은 live provider conformance로 간주되지 않습니다.

adapter verifier는 deterministic contract identity, Claude Code/Codex/OpenCode coverage, Windows/macOS/Linux matrix, current-host discovery, version 및 protocol-evidence schema, canonical project/Session capability binding, disabled static-adapter control method, authority-escalation rejection, tamper rejection 및 privacy boundary를 입증합니다. supervisor verifier는 남아 있는 grandchild가 있는 실제 provider fixture를 대상으로 Windows Job Object normal-exit, cancellation, token-fenced bounded interrupt 및 token-fenced bounded close cleanup을 입증합니다. CI는 Linux에서 POSIX process-group implementation을 compile하고 run하며 모든 release target을 cross-build합니다. lifecycle verifier는 세 runtime 모두에서 두 authorization scope, Session-request 및 model binding, Run/contract/Capsule binding, durable single consumption 및 release, sequential/concurrent replay rejection, bounded event, provider-neutral record recovery, provider-specific protocol-fixture validation, native-supervised protocol extraction, timeout, caller cancellation, scope-correct write policy 및 live provider 없이 transcript-free result drafting을 입증합니다. provider-replacement verifier는 runtime change를 가로지르는 fresh-process artifact recovery를 입증합니다. child creation을 거부하는 sandbox는 runtime absence 또는 successful execution으로 오인되는 대신 명시적 operational failure를 냅니다.

## 다음 활성화 gate

read-only path discovery, bounded non-session version invocation, provider-specific protocol/capability observation, canonical HEAD project/Session capability binding, host-local role coordination, bounded reply waiting, opt-in exact-endpoint WorkspaceHost attachment/delivery 및 exact-owned one-shot `interrupt`/`close`가 활성 상태입니다. host slice에는 deterministic evidence와 production already-running Codex/OpenCode E2E가 있으며, current-endpoint replacement, no spawn-on-claim, worker-question/HEAD-reply waiting 및 별도의 real-provider control cleanup을 입증합니다. original-author source audit는 여전히 acceptance gate입니다. `start`, provider-session `resume`, `stream` 또는 더 광범위한 process-host control을 활성화하기 전에 platform/runtime/host composition은 계속 다음을 검증해야 합니다.

1. externalized operational-state root, 정확한 authorization/lease/caller/project fence 및 verified native descendant supervisor를 통해 완료된 live Codex Session conformance evidence를 보존할 것
2. actual provider input, structured event, isolated file write, ResultPacket evidence 및 provider-neutral schema를 통한 provider-specific error를 포함하여 evidence-led consequential live Codex Run을 대상으로 진단된 large-event fix를 검증할 것
3. process termination을 session control로 재사용하지 않고 별도의 resume/stream protocol을 추가하면서 완료된 live one-shot interrupt/close evidence를 보존할 것
4. actual provider-session binding을 operational-only로 유지할 것
5. canon, ReviewDecision, instruction 또는 promotion authority가 없을 것
6. Session request identity 또는 Run WholePlan/Capsule/ExecutionContract identity와 evidence lineage를 보존하는 failure behavior를 갖출 것

point-in-time `RuntimeStateAdapter` export는 별도의 evidence-only facility로 남습니다. 이들은 이 control activation gate를 충족하지 않습니다.
