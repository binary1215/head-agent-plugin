> 이 문서는 [compaction-recovery.md](../compaction-recovery.md)의 한국어판입니다. 코드, 명령, 프로토콜 식별자와 필드 이름은 원문 표기를 유지합니다.

# Compaction 복구

Compaction은 손실을 수반하는 provider 작업입니다. 복구 권한은 canonical Session/Run checkpoint에 그대로 남으며, provider transcript, compaction summary, provider-session identity와 `HEADContinuitySnapshot`은 방향 파악용 또는 파생 view일 뿐입니다.

Protocol `0.3.0`은 [`authority-plane-contract.md`](authority-plane-contract.md)의 P2 recovery/lineage boundary를 내장합니다. ResultPacket이나 Worker Report는 P3 증거이며 checkpoint의 purpose, approved decision, current position 또는 정확한 next expected result를 읽기 위한 선행 조건이 아닙니다. checkpoint 생성 후 ResultPacket 증거를 삭제하는 상황은 실행 가능한 복구 test로 다룹니다. 그렇다고 summary, graph, inbox 또는 provider session이 복구 권한으로 바뀔 수는 없습니다.

Checkpoint authority metadata는 복구 field가 명시적인 HEAD/사용자 방향과 검증된 P2 lineage에서만 온다고 명시합니다. P3 증거는 감사를 위해 참조될 수 있지만 복구 field의 출처가 되는 일은 절대 없습니다. 일반 비증폭 test는 P3, P4, P5가 P2가 되려는 시도를 거부합니다.

## 상태 전이

```text
idle -> prepared -> provider_compacted -> verified -> continued
                                      \-> superseded
                                      \-> aborted
```

`compact-prepare`는 다음 내용을 갖는 content-addressed `SessionRunCheckpoint`를 만듭니다.

- `purpose`
- `approvedDecisions[]`
- `currentPosition`
- `nextExpectedResult`
- 현재 Session mode, Run/review pointer, 마지막 result/review reference와 필수 next-plan action을 포괄하는 immutable `sessionPointer`
- Run이 active일 때 검증된 active-Run pointer
- 선택 사항인 검증된 accepted-Run integration reference
- open review reference

active-Run pointer는 정확한 Run, WholePlanSnapshot, ExecutionContract와 ContextCapsule digest를 결속합니다. 복구 방향은 Capsule이 아니라 checkpoint가 소유합니다.

immutable Session pointer는 provider 독립적인 artifact restore를 반증 가능하게 만듭니다. 현재 Session canon은 여전히 checkpoint와 정확히 일치해야 합니다. Protocol `0.1.0`과 `0.2.0` checkpoint는 감사를 위해 계속 digest-readable하지만, 현재 artifact-only restore에 필요한 완전한 pointer는 포함하지 않습니다. [Session restore and reviewed-result integration](session-recovery.md)을 참조하세요.

같은 작업은 하나의 `CompactionEpoch`도 만듭니다. epoch에는 checkpoint identity, 준비 시점의 real-user-turn sequence, state와 추측 불가능한 continuation token에 결속된 hash가 담깁니다. raw token은 한 번만 반환되며 지속되지 않습니다. provider-session identity는 저장되지 않습니다.

`compact-verify`는 명시적인 provider-success 증거와 현재의 신뢰된 real-user-turn sequence를 받습니다. checkpoint와 현재 Session/Run pointer를 다시 읽어 digest를 검증합니다. 더 새로운 실제 사용자 turn이 있으면 continuation은 superseded됩니다. Provider failure, checkpoint tamper, state drift 또는 non-canonical recovery source가 있으면 복구를 abort하거나 거부합니다. Core는 누락된 방향을 summary에서 채우지 않습니다.

`compact-continue`는 atomic create를 통해 checkpoint에 결속된 token을 소비하고 정확한 checkpoint와 제한된 continuation instruction을 반환합니다. 두 번째 소비는 실패합니다. 반환되는 `CompactionRecoveryReceipt`는 instruction, recovery, objective-rewrite, Product Canon 또는 review authority가 없는 파생 증거입니다.

## 명시적 provider 경계

Core는 provider compaction을 호출하지 않습니다. native compaction hook이 없는 Codex 또는 다른 runtime에서는 prepare와 verify 사이에 provider UI 또는 신뢰할 수 있는 adapter를 사용하세요. adapter는 단조 증가하는 real-user-turn 증거를 제공하며, 합성 continuation은 그 sequence를 전진시키지 않습니다.

```text
head compact-prepare <project> --input <recovery.json>
head compact-verify <project> --input <verification.json>
head compact-continue <project> --input <continuation.json>
head compact-status <project>
head compact-abort <project> --input <abort.json>
```

이들은 가벼운 기본 surface의 일부가 아니라 고급 `help-all` command입니다. Observe와 일반 Session 작업은 기본적으로 epoch를 만들지 않습니다. active Run은 provider compaction 전에 자연스러운 idle boundary에서 prepare해야 합니다. Compaction은 open review를 승인하거나, Product Canon 또는 candidate 바이트를 변경하거나, 외부 write를 수행하거나, 복구 checkpoint를 대체하지 않습니다.

prepare input 예시:

```json
{
  "runtime": "codex",
  "userTurnIdAtPrepare": 42,
  "purpose": "Preserve the accepted whole outcome",
  "approvedDecisions": ["The provider summary is not recovery canon"],
  "currentPosition": "Implementation is complete; integrated verification remains",
  "nextExpectedResult": "A verified integrated test result",
  "openReviewIds": []
}
```

Verification에는 `epochId`, `checkpointDigest`, `currentUserTurnId`, `providerCompacted: true`가 필요합니다. Continuation에는 `epochId`, 일회용 `continuationToken`, `currentUserTurnId`가 필요합니다.
