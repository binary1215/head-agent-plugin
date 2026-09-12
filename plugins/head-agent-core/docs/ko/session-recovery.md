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

`head_conversation_enter`는 같은 읽기 전용 restore와 기존의 범위 제한 프로젝트 상태
사실을 대화용으로 자동 구성합니다. Skill은 사용자가 recovery를 요청하거나 identity를
입력하거나 두 번째 status 호출을 수행하게 하지 않습니다. 현재 checkpoint가 없으면
일반 작업을 계속하고, 검증 실패는 HEAD에 배정되어 recovery 의존 작업만 멈춥니다.
명시적 `session-restore`는 진단 및 adapter 통합용으로 계속 제공됩니다.

checkpoint 생성 후 P3 ResultPacket 증거가 삭제되었더라도 restore는 정확한 P2 방향을
반환하고 증거를 `missing-evidence`로 표시합니다. Fresh HEAD review context를 만들어내지
않습니다. caller는 review 전에 필요한 증거를 복구하거나 재현해야 합니다.

## 읽기 전용 checkpoint 진단

`head_checkpoint_diagnose`는 현재 pointer가 있을 때 프로젝트 준비도와 대화 진입이
공통으로 사용하고 typed MCP와 고급 CLI가 노출하는 읽기 전용 P4 진단입니다. 현재
checkpoint pointer 또는 그 부재,
artifact-only restore 검증, 기계적인 checkpoint-sync 가능 여부와 범위가 한정된 다음
HEAD 동작 하나를 보고합니다. lock, cache, checkpoint, Session pointer, 승인 또는 Canon을
쓰지 않습니다. 이를 읽는 것만으로 다른 provider HEAD나 model 평가를 호출하지 않습니다.

현재 pointer가 있으면 진단은 `basis B0 -> artifact restore -> basis B1` 순서를 수행합니다.
정상 결과에는 동일한 basis identity와 Session hash, 그리고 restore tuple의 정확한 Project,
Session, checkpoint ID와 checkpoint digest 일치가 필요합니다. 관찰이 바뀌면 결과는
`observation-changed-retry`이며 두 읽기를 정상 상태로 합치지 않습니다. 이는 순차적인
filesystem 관찰이지 원자적 snapshot이 아닙니다. 읽기 사이의 변경 후 복원 ABA를 감지할
수 없다는 사실도 projection에 명시합니다.

projection은 다음 사례를 구별합니다.

- 현재 pointer 없음
- pointer가 가리키는 checkpoint ledger 파일 누락
- checkpoint 또는 필수 lineage의 구조/digest 실패
- 필수 Session, Run, lineage 또는 Capsule artifact 누락
- Session이나 필수 lineage가 drift한 검증된 checkpoint
- 선택적 P3 ResultPacket 증거가 누락됐지만 P2 복구는 검증된 상태
- 읽기 순서 중 state 변경

선택적 ResultPacket 누락은 자체 완결적인 P2 방향을 무효화하지 않지만, review 의존 작업에는
그 증거가 필요합니다. 필수 artifact 누락이나 integrity 실패를 선택적 누락, staleness 또는
부재로 낮추지 않습니다. artifact 복구와 sync 가능 여부는 별도 축입니다. 안정적으로 관찰된
pointer drift 때문에 기존 checkpoint를 복원할 수 없어도 새 HEAD-authored 방향은 기계적으로
게시 가능할 수 있습니다. 어느 사실도 의미적 최신성을 증명하지 않습니다. ID, hash 또는
basis byte가 같아도 자연어 방향이 최신 사용자 의도를 여전히 나타내는지는 알 수 없으며,
checkpoint 작업이 실질적으로 필요할 때만 현재 provider HEAD가 이를 평가합니다.

## 최신성 gate를 적용한 checkpoint 동기화

일반 provider HEAD 작업은 Session checkpoint를 무조건 다시 쓰지 않고 다음
read-derive-sync 순서를 사용합니다.

```text
head_checkpoint_basis (read-only P4 comparison)
  -> current provider HEAD derives direction from that exact basis
  -> head_checkpoint_sync (locked P2 publish or exact reuse)
```

비지속 basis는 정확한 Project와 Session, 현재 checkpoint, Session record hash,
Run/WholePlan/ExecutionContract/Capsule 및 review reference, Run 게시 전이와 현재
compaction epoch를 결속합니다. Core는 게시 직전에 기존 Session-recovery mutation
lock 안에서 이 basis를 다시 구축합니다. basis는 동시성 증거이지 복구 방향이나 승인이
아닙니다.

동기화 결과는 네 가지입니다.

- `created`: 새 content-addressed checkpoint 하나를 게시하고 Session pointer를
  전진시켰습니다.
- `reused`: 현재 checkpoint가 같은 정규화된 방향과 정확한 현재 lineage를 이미
  가지므로 ledger와 Session pointer를 모두 쓰지 않았습니다.
- `deferred`: 미완료된 정확한 Run 전이 또는 open compaction epoch 중 바뀐 checkpoint를
  먼저 처리해야 합니다. 독립적인 일반 작업은 계속할 수 있습니다.
- `conflict`: 전달된 basis가 오래됐거나 기록된 Run 전이가 현재 Session state와
  충돌하므로 복구 byte를 쓰지 않았습니다.

변하지 않은 basis와 방향에 대한 checkpoint identity는 결정론적입니다. ledger 게시
전, ledger 게시 후 Session pointer 게시 전, pointer 게시 후의 재시도는 두 번째 ledger
entry 없이 수렴합니다. 동시에 들어온 동일 호출은 `created`와 `reused`로 수렴하고,
동시에 들어온 다른 방향은 먼저 게시된 방향을 덮어쓸 수 없습니다.

Core는 identity, lineage, transition state와 byte 동등성만 증명할 수 있습니다. 모델이
실제로 자연어 방향을 다시 검토했는지는 증명할 수 없습니다. Provider HEAD는 반환된
basis를 읽은 *뒤* 방향을 도출해야 하며, 이전 방향에서 `expectedRecoveryBasisId`만
바꾸는 것은 caller 계약 위반입니다. 이 계약은 사용자 확인 단계를 만들지 않습니다.

안정된 pending review는 유효한 checkpoint boundary입니다. 완료되지 않은 finish 또는
review 게시에서는 그렇지 않습니다. sync는 정확한 기존 Run 작업이 누락된 Session write를
완료할 때까지 `deferred`를 반환합니다. 일반 sync는 `reviewedRunIntegration`을 받거나
만들지 않습니다. 정확히 현재 상태인 integrated checkpoint는 재사용할 수 있지만, 바뀐
방향이나 lineage는 binding 없는 checkpoint를 만듭니다. accepted-result binding은 계속
`run-integrate-checkpoint`만 소유합니다.

짧은 Observe 작업, conversation entry, status read와 Host hook 부재는 첫 checkpoint를
만들지 않습니다. 신뢰할 수 있는 Host는 자연스러운 context-loss, handoff 또는 durable-Run
boundary에서 이 순서를 호출할 수 있습니다. 기존 checkpoint에 사용자 objective/constraint
변경, 검증된 단계 완료, failure/wait 전환 또는 전체 task 완료를 반영해야 할 때도 provider
HEAD가 사용할 수 있습니다. 먼저 durable recovery direction을 실제로 게시할 필요가 있는지
판단하므로 매 turn의 필수 호출이 아닙니다. daemon, timer, turn마다 추가되는 model call 또는
provider-session identity도 필요하지 않습니다.

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
head checkpoint-basis <project>
head checkpoint-diagnose <project>
head checkpoint-sync <project> --input <head-direction.json>
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

Typed MCP는 `head_checkpoint_basis`, `head_checkpoint_diagnose`,
`head_checkpoint_sync`, continuation,
dispatch/status/wait/apply, restore 및 명시적 integration을 노출합니다. basis, restore,
diagnosis, status 및 wait는 read-only입니다. checkpoint sync는 멱등적이며 공통 mutation lock 안에서
정확한 basis를 다시 검증합니다. continuation은 주입된 host-local
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
