> 영어 원문: [bounded-worker-wave.md](../bounded-worker-wave.md)

# 공급자 중립적 제한 worker 실행 wave

`BoundedWorkerWave`는 HEAD Core를 worker launcher, 공급자 세션 레지스트리 또는 Herdr
adapter로 만들지 않으면서 하나의 간결한 실행 wave 보기를 추가합니다. 이미 생성되고
검증된 `BoundedWorkerDispatch` 레코드를 정확히 하나의 활성 Run 계보 아래 묶습니다.

이 문서는 보존된 관리형 작업의 계약이며 기본 병렬 작업 흐름이 아닙니다.
새 작업은 HEAD 직접 수행 또는 일반 Host 위임을 사용합니다. Wave 변경은 기존에
승인된 관리형 작업의 명시적 유지관리 진입점에서만 제공하며, 과거 기록·상태·대기는
그 경로를 활성화하지 않고도 조회할 수 있습니다.

## 권위와 정체성

| 아티팩트 | 평면 | 의미 |
|---|---|---|
| `BoundedWorkerWave` | P3 | 기존 dispatch를 묶는 create-only 증거 |
| `BoundedWorkerWaveSeal` | P3 | 모든 구성원의 권한이 실제로 소비되었다는 create-only 증명 |
| `BoundedWorkerWaveAbandonment` | P3 | seal되지 않은 부분 실행의 명시적 비성공 handoff |
| `WorkerWaveStatusProjection`, `WorkerWaveResultProjection` | P4 | 지속되지 않는 집계 보기 |
| `BoundedWorkerWaveWaitOutcome` | P5 | 제한된 운영 관찰만 수행 |

wave 생성은 기존 권한 ID 2~64개만 받습니다. `ExecutionAuthorization`을 생성하지 않고,
role, runtime, model, workspace mode 또는 action을 선택하지 않으며, 어떤 구성원의
범위도 넓히지 않습니다. 모든 구성원은 독립적인 at-most-once lease를 유지합니다.
caller handle, 공급자 세션 ID, pane, socket, TUI 명령 및 Herdr 정체성은 Core 의미
상태 밖에 있습니다.

read, status, result-read, wait는 저장된 Project·Run 관계, plan, contract,
Capsule, dispatch, authorization 해시를 검증합니다. Run 완료나 Session 교체
후에도 읽을 수 있지만 과거 근거가 새 실행·적용 권한을 부여하지는 않습니다.
create, seal, abandon은 현재 Session과 활성 실행 계보도 요구합니다.
무관한 Session 시각·checkpoint 갱신은 실행 drift가 아닙니다. 각 작업의
tamper가 있으면 fail-closed로 중단됩니다.

## 수명주기

```text
existing BoundedWorkerDispatch[]
  -> BoundedWorkerWave(open)
  -> independent worker execution and authorization consumption
  -> explicit BoundedWorkerWaveSeal
  -> WorkerWaveStatusProjection(sealed | completed | failed)
  -> optional BoundedWorkerWaveWaitOutcome
  -> HEAD gathers individual evidence while the Run is valid
  -> one combined Run ResultPacket -> Fresh HEAD -> ReviewDecision -> P2 integration
```

읽기 전용 status 투영은 seal을 생성하지 않습니다. seal하려면 모든 구성원의 lease
소비가 검증되어야 합니다. dispatch가 존재하거나 caller가 주장하는 것만으로는 실행
증거가 되지 않습니다. 집계 result read와 wave wait는 seal 전에 fail-closed로
중단됩니다. `completed`는 모든 구성원이 성공적인 최종 runtime result를 반환했다는
뜻입니다. 하나라도 빠르게 최종 실패하면 seal된 wave는 `failed`가 되며 절대
`completed`가 되지 않습니다.

Status와 wait는 집계 조회 가능 여부, 전체 시작 증거 유무, 시작됐지만 lease 해제
증거가 없는 멤버를 비지속 HEAD 안내로 제공합니다. 프로세스 정리 완료의 증명은
아닙니다. seal 전에도 개별 job을 읽을 수 있으며 wait 중단이나 wave 포기는 멤버를
취소하지 않습니다. 성공한 결과를 보존하고 소유한 미종료 멤버를 별도로 확인·취소합니다.
CLI/MCP 카드가 이를 보여주며 사용자에게 새 양식을 요구하지 않습니다.

seal되지 않은 부분 실행에는 create-only abandonment record 하나를 둘 수 있습니다.
reason code는 고정되어 있고 선택적인 UTF-8 summary는 정규화되어 256바이트로
제한됩니다. summary에는 instruction, review, promotion, success 또는 recovery 권위가
없습니다. seal과 abandonment는 상호 배타적입니다. 동일한 retry는 수렴하고 서로 다른
retry는 실패합니다. 둘은 같은 create-only terminal slot을 두고 경쟁하므로, 동시에
seal/abandon을 시도해도 두 개의 최종 진실을 만들 수 없습니다.

wave 완료는 ResultPacket을 적용하거나, Fresh HEAD review를 만들거나,
`ReviewDecision`을 생성하거나, checkpoint를 통합하지 않습니다. HF-009는 독립 worker
dispatch와 실행 소유권으로 유지됩니다. HF-010은 각 fragment가 아니라 Run의
단일 전체 결과를 명시적으로 검토하여 통합하는 경로입니다.
컨텍스트 선택, 부분 실행, 단일 worker 적용과 HEAD의 통합 finish 구분은
[worker 컨텍스트와 통합](worker-context-integration.md)을 참고합니다.

## CLI와 typed MCP

```text
head managed-maintenance worker-wave-create <project> --input <wave.json>
head worker-wave-read <project> --wave <bounded-worker-wave-id>
head managed-maintenance worker-wave-seal <project> --wave <bounded-worker-wave-id>
head worker-wave-status <project> --wave <bounded-worker-wave-id>
head worker-wave-results <project> --wave <bounded-worker-wave-id>
head worker-wave-wait <project> --wave <bounded-worker-wave-id> [--wait-timeout-ms <0..600000>]
head managed-maintenance worker-wave-abandon <project> --input <abandonment.json>
```

Typed MCP는 동일한 Core 함수와 정체성을 사용합니다. 변경 도구는 별도
`scripts/mcp-managed-maintenance.mjs` stdio 서버에만 있으며 일반 MCP에는
read/status/results/wait가 남습니다. 도구 인자로 일반 서버의 변경 기능을 열 수
없습니다. 명시적 유지관리에서도 create/launch/seal에는 기존의 정확한 권한·계보와
검증된 시작 증거가 필요합니다. Status는 누락 멤버 시작이나 자동 seal을 권하지
않습니다. 사용자의 설치된 MCP 서버를 바꾸거나 Host 실패를 관리형 실행으로
전환하지 않습니다.

Embedding Host는 열린 Worker Admission capability를 wave status에 선택적으로
전달할 수 있습니다. 이 경우 P5 queue/reservation detail만 추가되며 wave
state machine이나 `started` 증거는 바뀌지 않습니다. capability가 없는 일반
CLI/MCP 및 Core 호출은 그대로 유지됩니다. 자세한 내용은
[worker-admission.md](worker-admission.md)를 참조하세요.
