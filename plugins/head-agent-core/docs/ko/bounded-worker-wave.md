> 영어 원문: [bounded-worker-wave.md](../bounded-worker-wave.md)

# 공급자 중립적 제한 worker 실행 wave

`BoundedWorkerWave`는 HEAD Core를 worker launcher, 공급자 세션 레지스트리 또는 Herdr
adapter로 만들지 않으면서 하나의 간결한 실행 wave 보기를 추가합니다. 이미 생성되고
검증된 `BoundedWorkerDispatch` 레코드를 정확히 하나의 활성 Run 계보 아래 묶습니다.

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

모든 create, read, seal, status, result-read, wait 및 abandon 작업은 정확한 현재
Project, HEAD Session 포인터, 활성 Run, `WholePlanSnapshot`, `ExecutionContract`,
`ContextCapsule`, 구성원 dispatch 및 구성원 권한 해시를 다시 검증합니다. drift나
tamper가 있으면 fail-closed로 중단됩니다.

## 수명주기

```text
existing BoundedWorkerDispatch[]
  -> BoundedWorkerWave(open)
  -> independent worker execution and authorization consumption
  -> explicit BoundedWorkerWaveSeal
  -> WorkerWaveStatusProjection(sealed | completed | failed)
  -> optional BoundedWorkerWaveWaitOutcome
  -> each result follows ResultPacket -> Fresh HEAD -> ReviewDecision -> P2 integration
```

읽기 전용 status 투영은 seal을 생성하지 않습니다. seal하려면 모든 구성원의 lease
소비가 검증되어야 합니다. dispatch가 존재하거나 caller가 주장하는 것만으로는 실행
증거가 되지 않습니다. 집계 result read와 wave wait는 seal 전에 fail-closed로
중단됩니다. `completed`는 모든 구성원이 성공적인 최종 runtime result를 반환했다는
뜻입니다. 하나라도 빠르게 최종 실패하면 seal된 wave는 `failed`가 되며 절대
`completed`가 되지 않습니다.

seal되지 않은 부분 실행에는 create-only abandonment record 하나를 둘 수 있습니다.
reason code는 고정되어 있고 선택적인 UTF-8 summary는 정규화되어 256바이트로
제한됩니다. summary에는 instruction, review, promotion, success 또는 recovery 권위가
없습니다. seal과 abandonment는 상호 배타적입니다. 동일한 retry는 수렴하고 서로 다른
retry는 실패합니다. 둘은 같은 create-only terminal slot을 두고 경쟁하므로, 동시에
seal/abandon을 시도해도 두 개의 최종 진실을 만들 수 없습니다.

wave 완료는 ResultPacket을 적용하거나, Fresh HEAD review를 만들거나,
`ReviewDecision`을 생성하거나, checkpoint를 통합하지 않습니다. HF-009는 독립 worker
dispatch와 실행 소유권으로 유지됩니다. HF-010은 각 result를 나중에 명시적으로
검토하여 통합하는 경로로 유지됩니다.

## CLI와 typed MCP

```text
head worker-wave-create <project> --input <wave.json>
head worker-wave-read <project> --wave <bounded-worker-wave-id>
head worker-wave-seal <project> --wave <bounded-worker-wave-id>
head worker-wave-status <project> --wave <bounded-worker-wave-id>
head worker-wave-results <project> --wave <bounded-worker-wave-id>
head worker-wave-wait <project> --wave <bounded-worker-wave-id> [--wait-timeout-ms <0..600000>]
head worker-wave-abandon <project> --input <abandonment.json>
```

Typed MCP는 동일한 Core 함수와 정체성을 사용하여 동등한
`head_bounded_worker_wave_*` 도구를 노출합니다. 안전한 Skill 흐름은 개별 dispatch를
만들고 wave를 생성한 뒤, 각 구성원을 기존 실행 경로로 실행합니다. 검증된 실행
증거가 나온 뒤에만 seal하고 status 또는 bounded wait를 사용합니다.
