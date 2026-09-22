# Worker 컨텍스트와 HEAD 통합

[영어 원문](../worker-context-integration.md)

Bounded worker를 준비하거나 여러 결과를 합칠 때 읽는 가이드입니다. 기존 계약을 설명하며 새 실행 기능, 필수 양식이나 일반 Session 게이트를 추가하지 않습니다.

## 지원되는 기본값은 fresh 컨텍스트

현재 플러그인은 fresh one-shot provider 요청을 실행합니다. Worker 경로의 native 대화 fork는 **미지원**입니다. 앱의 fork 명령은 bounded HEAD Host 통합의 증거가 아니며 대체 실행 경로로 쓰지 않습니다. 대화 이력 복사와 checkout 격리는 별개이며 속도나 비용 우월성을 주장하지 않습니다.

목적, 기대 결과, non-HEAD 역할, 소유 파일·행동, 금지사항, 선택한 근거, 검증 기대와 미해결 문제 중 결과에 필요한 내용만 brief에 담습니다. 유용한 내용 안내이지 필수 필드나 사용자 작성 양식이 아닙니다. 이전 판단에 의존하는 구현에는 관련 설계 배경을 선별합니다. 독립 리뷰·반례 탐색에는 부모의 결론보다 계약과 원자료 중심의 fresh 컨텍스트를 권합니다. 원시 이력이나 비밀값을 다른 provider로 자동 전송하지 않고 기존 목적지·권한 경계를 보존합니다.

실제 실행 입력은 **authorization 이전**에 정합니다.
- Session: 필요한 brief를 `sessionRequest`에 담은 뒤 authorization을 만들고 실행 시 정확히 승인된 바이트를 전달합니다.
- Run: authorization 전에 accepted plan, contract와 Capsule을 정합니다. 같은 wave 멤버는 정확한 Run 계보를 공유하며 runtime이 worker별로 계약을 자동 축소하거나 역할 파일을 주입하지 않습니다.
- `workerRole`은 dispatch 소유 기록이지 runtime 지시 자동 주입이나 파일 접근 sandbox가 아닙니다. 필요한 경계는 승인할 입력에 담으며 prompt만으로 격리를 보장하지 않습니다. 필요한 지시가 없다면 실행 전에 기존 contract/authorization 경로로 해결합니다. Digest-bound 입력에 지시·이력을 덧붙이거나 소비한 authorization을 재사용하지 않습니다.

정확한 canonical project root에 실행을 결속합니다. 파일이 같아 보여도 다른 worktree에서 authorization을 재사용하지 않습니다. 지원되는 root 안에서 필요하면 파일 소유를 나누거나 충돌하는 수정을 직렬화합니다. Lease가 모든 파일 충돌이나 오래된 소스 기저를 검출하는 것은 아닙니다. 읽기 작업에 새 worktree를 강제하지 않습니다.

## Run이 유효할 때 수집

Run을 완료하기 전에 wave 상태와 개별 invocation 근거를 수집합니다. Wave 연산은 현재 Session/Run/plan/contract/Capsule 계보를 다시 검증하므로 전환 뒤에도 과거 wave 집계가 계속 읽힌다고 가정하지 않습니다. 반환된 정확한 참조는 기존 store와 [산출물 저장 관례](artifact-storage.md)로 보존하며 새 manifest를 만들지 않습니다.

Seal되지 않은 부분 실행은 기존 개별 worker wait/result와 wave status/abandonment를 사용하며 강제로 seal하거나 성공으로 바꾸지 않습니다. `failed` wave에도 실행 중인 멤버가 있을 수 있습니다. 개별 실행·lease 상태와 기존 Host 소유 취소·정리 경로를 확인합니다. Abandonment는 근거이지 프로세스 종료가 아닙니다. 실행 여부가 불확실하면 재시도 전에 기존 기록과 소유권을 확인하며, fresh fallback으로 실행 중이거나 이미 소비된 실행을 중복하지 않습니다.

조율 HEAD는 계속 살아 있어야 하는 대화 프로세스가 아니라 논리적 역할입니다. Compaction/provider 손실 후에는 기존 복구 경로로 검증된 P2 방향을 복구한 뒤 조율을 계속합니다. 오래된 wave나 Session 포인터가 거절되면 현재 계보와 개별 durable record를 재검증하며 provider summary로 거절을 우회하거나 복구 방향을 만들지 않습니다.

## Fragment 반복 적용이 아닌 하나의 전체 Run 결과

Run에는 하나의 ResultPacket이 있습니다. Fragment를 `worker-apply`나 별개의 `run-finish` 호출로 순차 적용하는 것은 병합이 아닙니다. 서로 다른 두 번째 finish는 첫 결과와 충돌합니다. Wave 완료는 운영 근거이지 전체 작업의 수용 판정이 아닙니다.

예를 들어 worker A는 parser 변경을, worker B는 독립적인 진단 변경을 보고합니다. 정확한 Run이 유효할 때 HEAD가 두 개별 결과를 읽고 소스 기저, 누락·중복 작업, 수정 충돌, 실패와 미해결 문제를 확인합니다. 의존하는 동작은 합쳐진 작업 상태에서 검증하며 개별 통과 두 개가 통합 결과를 증명하지는 않습니다. 실제 불일치를 해소하거나 정직하게 보고하며 통과를 만들어내지 않습니다.

그 뒤 HEAD가 전체 결과, 양쪽 실제 근거 참조, 통합 검증과 남은 unknown을 **하나의** 기존 finish 입력으로 구성하여 한 번 완료합니다.

```text
head run-finish <project> --input <combined-result.json>
```

이는 HEAD가 준비하는 기존 CLI 입력이지 새 사용자 양식이 아닙니다. 파일 자동 병합, 참인 검증 결과 추론이나 모든 invocation 계보 자동 수입을 수행하지 않습니다. 관련된 정확한 invocation/result 참조를 근거로 남깁니다. Finish 후 Run은 검토 대기로 이동하므로 필요한 active-Run 근거를 먼저 수집합니다.

통합 ResultPacket도 기존 Fresh HEAD review, 정확한 ReviewDecision과 명시적 P2 checkpoint integration을 따릅니다. 현재 Fresh HEAD는 검증된 artifact로 구성한 검토 projection이지 독립 모델이나 대화를 보장하지 않습니다. Worker나 집계 성공이 스스로 승인하거나 checkpoint 방향을 작성할 수 없습니다.

단일 결과 경로는 별도로 유지합니다. 검증된 provider Run draft 하나가 전체 계약을 충족하면 기존 `worker-apply`로 그 결과 하나를 적용한 뒤 같은 review/integration 경계를 따를 수 있습니다. Fragment 누적기가 아닙니다. 일반 Session worker 결과는 HEAD가 소비하는 근거이며 Run review나 P2 integration을 강제하지 않습니다.

## 향후 fork는 별도 Host 제안

Native fork 지원을 주장하려면 Host 구현에서 이력 선택·프라이버시 경계와 복사 시점, 실행 전 역할·도구·root·authorization·lease 결속, 시작·불확실 결과 관찰, at-most-once 동작, 부분 실행 취소·정리와 P2 우선 복구를 입증해야 합니다. 향후 기술 수용 조건이지 일반 사용자의 체크리스트가 아닙니다. 합성 artifact 테스트는 실제 Host fork나 실모델 통합을 입증하지 않습니다.

기존 계약은 [wave 연산](bounded-worker-wave.md), [실행 계보](execution-lineage.md), [Session 복구](session-recovery.md)를 참고합니다.
