> 영어 원문: [session-recovery.md](../session-recovery.md)

# Session 복원 및 검토된 result 통합

이 계약은 숨겨진 공급자 대화를 재개하거나 Herdr 전용 process, pane, CLI, socket 또는
TUI 동작을 내장하지 않으면서, 원래 HEAD Session 복원 및 worker-result 통합 흐름의
공급자 중립적 결과를 구현합니다.

## 원래 Feature 매핑

원래 소스 번호는 다른 용도로 바꾸지 않고 그대로 보존합니다.

| Original Feature | 원래 결과 | 이 플러그인과의 관계 |
|---|---|---|
| HF-007 | context compaction을 거쳐 계속 진행 | 별도의 공급자 중립적 compaction recovery 계약으로 구현 |
| HF-008 | 이전 HEAD OpenCode Session 복원 | artifact-only restore가 의미적 consumer input을 재현하며, 공급자 `ses_*` resume은 의도적으로 주장하지 않음 |
| HF-009 | 독립적으로 소유할 수 있는 worker task dispatch | 별도의 bounded runtime/coordination vertical에 속하며, 이 통합 transaction은 dispatch가 아님 |
| HF-010 | 완료된 worker branch 통합 | 수락된 ResultPacket review와 명시적인 HEAD 소유 checkpoint 통합으로 공급자 중립적으로 표현 |

이 매핑은 동작의 동등성과 절차의 동일성을 구분합니다. 공급자 손실 연속성을 HF-010으로
이름 바꾸거나, checkpoint transaction만으로 원래 dispatch/wait lifecycle이 완결된다고
주장하지 않습니다.

## 권위 경계

| 아티팩트 | 평면 | 역할 |
|---|---|---|
| `WholePlanSnapshot`, `ExecutionContract`, `ContextCapsule`, `Run`, `SessionRunCheckpoint` | P2 | 복구 가능한 프로젝트 실행 계보 및 정확한 다음 방향 |
| `ReviewDecision` | P1 | Fresh HEAD의 명시적 규범 판단 |
| `BoundedWorkerDispatch`, `ResultPacket`, `RunResultIntegrationRequest`, `RunResultIntegrationReceipt` | P3 | worker 소유권, result 및 통합 증거일 뿐임 |
| `SessionRestoreProjection` | P4 | 지속되지 않으며 재현 가능한 consumer view |
| `ContinuationOutcome`, `BoundedWorkerWaitOutcome`, execution lease/process | P5 | 선택적인 live attachment 및 운영 진행일 뿐임 |
| `BoundedWorkerWave`, seal, abandonment | P3 | 동일 계보의 multi-dispatch 그룹 및 비성공 handoff 증거 |
| `WorkerWaveStatusProjection`, `WorkerWaveResultProjection` | P4 | 지속되지 않는 launch-wave view |
| `BoundedWorkerWaveWaitOutcome` | P5 | seal된 wave의 제한된 관찰일 뿐임 |

이 평면들은 지속성 순위가 아닙니다. checkpoint 생성 후 P3 ResultPacket이 없어져도 P2
방향은 바뀌지 않습니다. P1 ReviewDecision은 result를 accept할 수 있지만 P2 Session
checkpoint를 대체하지 않습니다. 통합 작업은 `purpose`, `approvedDecisions`,
`currentPosition`, `nextExpectedResult`를 명시적으로 받습니다. worker reply와
ResultPacket 어느 쪽도 이 fields를 작성할 수 없습니다.

## 아티팩트 전용 Session 복원

`session-restore`는 현재 canonical checkpoint pointer에서 시작하여 다음을 수행합니다.

1. content-addressed `SessionRunCheckpoint`를 digest 검증합니다.
2. 현재 protocol `0.3.0`과 그 불변 `sessionPointer`를 요구합니다.
3. 해당 pointer를 `.head/sessions/current.json`과 byte-semantic 기준으로 비교합니다.
4. 현재 WholePlan과, 활성 상태인 경우 정확한 Run, ExecutionContract 및 ContextCapsule
   digest를 다시 검증합니다.
5. ResultPacket 증거가 있으면 보류 중인 review 계보를 다시 검증합니다.
6. 결정적이고 지속되지 않는 `SessionRestoreProjection`을 반환합니다.

읽기 전용 프로젝트 경험은 동일한 검증을 실행해 `no-current-checkpoint`,
`verified-current-checkpoint` 또는 `attention-required`를 보고할 수 있습니다.
이 준비 상태 뷰는 복구 방향을 반환하거나 continuation token을 소비하거나 공급자를
연결하지 않습니다. HEAD는 검증된 현재 체크포인트가 있을 때만 전체 복원 프로젝션을
읽습니다.

projection은 checkpoint의 정확한 purpose, position 및 next expected result를 consumer
instruction으로 전달합니다. 공급자 session ID, transcript 또는 summary를 읽거나
지속하지 않으며 공급자 resume 또는 streaming을 활성화하지도 않습니다. pointer drift,
tamper, 누락된 P2 lineage 또는 historical checkpoint가 있으면 그럴듯한 상태를 재구성하는
대신 fail-closed로 중단됩니다.

checkpoint 생성 후 P3 ResultPacket 증거가 삭제되었더라도 restore는 정확한 P2 방향을
반환하고 증거를 `missing-evidence`로 표시합니다. Fresh HEAD review context를 만들어내지
않습니다. caller는 review 전에 필요한 증거를 복구하거나 재현해야 합니다.

Protocol `0.1.0` 및 `0.2.0` checkpoint는 audit 및 compaction compatibility를 위해
checkpoint reader로 계속 읽을 수 있습니다. 그러나 immutable Session pointer보다 이전
형식이므로 현재 artifact-only restore를 구동할 수 없습니다. 공개 `head checkpoint`
명령은 이제 canonical content-addressed P2 형식만 씁니다. 과거의 직접 time-based API는
폐기되었으며 `latestCheckpoint`를 전진시킬 수 없습니다.

## 제한된 검토 result 통합

연결된 흐름은 다음과 같습니다.

```text
BoundedWorkerDispatch (P3)
  -> at-most-once lease / supervised provider / bounded wait (P5)
  -> ResultPacket (P3)
  -> deterministic Fresh HEAD review projection
  -> explicit accept ReviewDecision (P1)
  -> explicit integration input owned by HEAD/user direction
  -> SessionRunCheckpoint (P2)
  -> RunResultIntegrationReceipt (P3)
```

`worker-dispatch`는 등록된 non-HEAD role 하나를 정확한 현재 Run의
`ExecutionAuthorization`에 바인딩합니다. 같은 role은 멱등적으로 retry할 수 있습니다.
경쟁 role과는 충돌하며, 권한은 한 번만 소비할 수 있습니다. `worker-wait`는 지속되지
않는 운영 outcome을 반환합니다. WholePlan을 변경하거나, recovery direction을
제공하거나, ReviewDecision을 생성할 수 없습니다. `worker-apply`는 검증된 네이티브
supervision을 갖춘 완료된 실제 공급자 result만 받아 ResultPacket과 Fresh HEAD review
context만 생성합니다. 명시적 review와 아래의 통합 transaction은 분리된 상태로 남습니다.

여러 기존 dispatch는 공급자 중립적 wave 계약인
[`bounded-worker-wave.md`](bounded-worker-wave.md)를 통해 볼 수 있습니다. wave seal은
result acceptance가 아니라 start-evidence aggregation입니다. wave `completed`는 모든
구성원이 운영상 성공했다는 뜻입니다. 각 구성원에는 여전히 자체 ResultPacket, Fresh
HEAD ReviewDecision 및 명시적 HF-010 checkpoint 통합이 필요합니다.

## P2 우선의 선택적 live continuation

`session-continue`는 공급자 또는 workspace host를 확인하기 전에 항상 artifact restore를
호출합니다. 신뢰할 수 있는 host-injected adapter는 그 후 정확한 현재 HEAD attachment를
새로 검증할 수 있습니다. 이 adapter의 `ContinuationOutcome`은 P5이며 지속되지 않습니다.
`attached` 또는 공개된 `fresh-logical-head` fallback 중 하나를 기록하고, 동일한 checkpoint와
restore projection을 유지하며, 공급자 summary 또는 transcript를 읽지 않습니다. 공급자
session identifiers는 canonical하지도, 지속되지도 않습니다. 따라서 attach failure는
HF-008 semantic recovery가 아니라 대화 편의성만 바꿉니다.

`run-integrate-checkpoint`는 정확히 검토된 Run과 ReviewDecision을 요구합니다. Core는
무엇이든 쓰기 전에 Run, ResultPacket, WholePlan, ExecutionContract, ContextCapsule,
Fresh HEAD review identity, 현재 Session state 및 `accept` disposition을 다시 검증합니다.
`revise`, `expand`, `rollback`, `escalate`는 정상적인 next-plan 또는 user-direction 경로에
남으며 result integration으로 잘못 표시될 수 없습니다.

ReviewDecision 하나는 최대 하나의 recovery checkpoint에 바인딩될 수 있습니다. 동일한
retry는 기존 checkpoint와 receipt를 반환합니다. purpose, position, decision set,
open-review set 또는 next expected result가 다른 retry는 실패합니다. 수락된 전체 lineage
preflight 후, create-only P3 integration request가 checkpoint write 전에 정규화된 input을
고정합니다. 동시에 들어온 동일한 request는 해당 request와 reviewed-time-derived checkpoint
identity로 수렴합니다. 동시에 들어온 다른 request는 또 다른 checkpoint를 만들기 전에
실패합니다. P2 checkpoint는 request ID와 input hash를 바인딩하므로, 직접적인 lower-level
checkpoint construction으로 transaction을 우회하거나 다른 recovery direction으로 바꿀
수 없습니다. request는 recovery authority가 아니라 P3 transaction provenance로 남습니다.
checkpoint가 검증된 후에는 request 또는 ResultPacket을 삭제해도 self-contained P2 fields의
artifact-only restore를 바꾸거나 막을 수 없습니다. checkpoint write 뒤 receipt 생성 전에
process가 중단되면 retry는 유일하게 검증된 integration checkpoint를 찾아 누락된 create-only
receipt만 완성합니다.

receipt는 통합이 ReviewDecision을 생성하지 않았고 ResultPacket은 참조 증거일 뿐임을
기록합니다. 나중에 해당 ResultPacket을 삭제해도 checkpoint 또는 restore projection의
다음 방향은 바뀌지 않습니다.

## 공개 표면

```text
head checkpoint <project> --summary <text> [--next <text>]
head session-restore <project> [--checkpoint <checkpoint-id>]
head session-continue <project> --runtime <codex|opencode> [--checkpoint <checkpoint-id>]
head worker-dispatch <project> --authorization <authorization-id> --role <non-head-role>
head worker-wait <project> --authorization <authorization-id> [--wait-timeout-ms <milliseconds>]
head worker-execute <project> --authorization <authorization-id> --role <non-head-role>
head worker-apply <project> --authorization <authorization-id>
head worker-wave-create <project> --input <wave.json>
head worker-wave-seal <project> --wave <bounded-worker-wave-id>
head worker-wave-status <project> --wave <bounded-worker-wave-id>
head worker-wave-wait <project> --wave <bounded-worker-wave-id>
head worker-wave-abandon <project> --input <abandonment.json>
head run-integrate-checkpoint <project> --input <integration.json>
head run-integration-read <project> --review <review-decision-id>
```

Typed MCP는 continuation, dispatch/status/wait/apply, restore 및 명시적 integration을
노출합니다. restore, status 및 wait는 read-only입니다. continuation은 주입된 host-local
P5 attachment만 새로 고칠 수 있습니다. dispatch와 application은 멱등적인 project-state
write입니다. 어느 것도 review, Canon, publication 또는 external-action authority를
부여하지 않습니다.

fresh-process test는 서로 다른 Codex 및 OpenCode provider-session 환경 값으로 restore를
실행하고, 어느 값도 result에 들어 있지 않은 동일한 projection identity를 요구합니다.
반례는 Session pointer drift, 누락된 ResultPacket 증거, non-accept review, divergent replay
및 CLI/MCP parity를 다룹니다.

`npm run verify:hostless-session-recovery`는 resident-consumer proof를 추가합니다. 하나의
fresh process가 통합하고, 독립적인 Codex/OpenCode labeled process가 동일한 projection을
복원하여 하나의 read-only next move를 실행하며, 주입된 inbox text는 해당 move를 작성할
수 없습니다. 검증기는 request-before-checkpoint 및 checkpoint-before-receipt crash recovery,
P3 request와 ResultPacket 증거 삭제, 동시 동일·상이 integration 및 non-accept review도
다룹니다. Git repository, GraphDB, WorkspaceHost, Herdr process 또는 provider session
resume은 필요하지 않습니다.
