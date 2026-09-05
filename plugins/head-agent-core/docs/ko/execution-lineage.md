# Execution Lineage 계약과 Run 생명주기

[영어 원문](../execution-lineage.md)

이 생명주기를 변경하기 전에 [`architecture.md`](architecture.md)와
[`authority-plane-contract.md`](authority-plane-contract.md)를 읽으십시오.

## 상태 머신

```text
Session
  -> verified ExecutionContract
  -> Run(active)
  -> ResultPacket
  -> Review(awaiting ReviewDecision)
  -> Session
```

Run은 자유 형식 목표에서 시작할 수 없습니다. 영속화되고 다이제스트 검증된 `ExecutionContract`가 필요하며, 이 계약에는 이미 하나의 `WholePlanSnapshot`과 하나의 영속화된 `ContextCapsule`이 바인딩되어 있습니다. 또한 계약은 정확한 EvidenceNeed 집합 다이제스트 및 Compiler 커버리지 증명 다이제스트와 함께 HEAD의 작업 로컬 컨텍스트 수락을 기록합니다. 이것이 의미적 수락 경계입니다. Compiler는 포함 여부를 증명하지만 자신의 컨텍스트를 스스로 수락할 수 없습니다.

Run은 성공 문자열만으로 끝날 수 없습니다. 완료 시 증거와 검증을 포함하는 `ResultPacket`이 생성됩니다. 프로젝트는 Review 모드에 들어가며, HEAD가 `ReviewDecision`을 기록할 때까지 다음 Run을 차단합니다.

활성 계보 프로토콜은 `0.4.0`입니다. 현재의 각 계보 아티팩트에는 검증된 [`AuthorityPlaneContract`](authority-plane-contract.md) 경계가 포함됩니다. WholePlanSnapshot과 ExecutionContract는 P2 복구/계보 레코드이고, ResultPacket은 복구, Canon 변경 및 검토 권한이 거짓으로 설정된 P3 증거이며, ReviewDecision은 P1 규범 레코드입니다. ResultPacket은 의사결정을 뒷받침할 수 있지만, 의사결정을 만들거나 유일한 복구 소스가 될 수 없습니다.

현재 구현은 결정론적 Fresh HEAD 검토 프로젝션을 만들며, 공통 감독 런타임 경로를 통해 권한이 부여된 Codex 또는 OpenCode 일회성 호출을 실행할 수 있습니다. 실패로 폐쇄되는 적용 브리지는 완료되고 검증되었으며 트랜스크립트가 없는 Run 초안만 정규 `ResultPacket`과 Fresh HEAD 프로젝션으로 변환합니다. 공급자 세션 재개 또는 하이드레이션은 의미나 복구에 필요하지 않으며, 어떤 런타임 결과도 `ReviewDecision`을 만들어 내지 않습니다. 호출한 HEAD가 검증된 프로젝션을 소비하고 해당 의사결정을 제공해야 합니다.

## 명시적 변경 명령

변경 명령은 구조화된 권한과 증거가 셸 문자열로 평탄화되지 않도록 JSON 입력 파일을 받습니다.

Whole-plan 스냅샷을 생성합니다.

```text
node scripts/head.mjs lineage-plan <project> --input <whole-plan.json>
```

```json
{
  "objective": "Deliver the accepted whole outcome",
  "plan": [
    { "id": "implementation", "outcome": "Bounded result" },
    { "id": "verification", "outcome": "Direct proof" }
  ],
  "invariants": ["Project canon outranks derived context"],
  "sources": [{ "uri": ".head/instructions/project.md", "role": "verified-project-direction" }]
}
```

작업 Context Capsule을 컴파일하여 영속화한 다음 Execution Contract를 생성합니다.

```text
node scripts/head.mjs context-compile <project> --task "bounded task" --budget 32768
node scripts/head.mjs lineage-contract <project> --input <execution-contract.json>
```

```json
{
  "wholePlanId": "whole-plan-<24 hex>",
  "capsuleId": "capsule-<24 hex>",
  "scope": "Produce one independently reviewable result",
  "acceptanceCriteria": ["Required tests pass", "Direct evidence is attached"],
  "constraints": ["Do not change material product direction"],
  "allowedActions": ["Edit and test local plugin source"],
  "forbiddenActions": ["Deploy or publish"]
}
```

Run을 시작합니다.

```text
node scripts/head.mjs run-start <project> --contract execution-contract-<24 hex>
```

Result Packet을 통해 완료합니다.

```text
node scripts/head.mjs run-finish <project> --input <result.json>
```

```json
{
  "outcome": "Observed bounded result",
  "evidence": [
    { "uri": "test/example.test.mjs", "digest": "sha256-or-evidence-id", "summary": "What this proves" }
  ],
  "planDelta": "No change to the approved whole plan",
  "impactRadius": ["component-a", "contract-b"],
  "verification": [
    { "check": "test command", "status": "passed", "evidence": "output digest or summary" }
  ],
  "unknowns": []
}
```

Fresh HEAD 검토 프로젝션을 생성합니다.

```text
node scripts/head.mjs run-review-context <project>
```

프로젝션은 콘텐츠로부터 파생된 `reviewContextId`를 반환합니다. 여기에는 검증된 WholePlanSnapshot, ExecutionContract, ResultPacket, Capsule 참조, 권한 및 검토 프로토콜이 포함됩니다. 실행자 트랜스크립트, 원시 실패 로그, 공급자 세션 상태 및 승격되지 않은 저장소 지침은 명시적으로 제외됩니다.

정확히 그 프로젝션을 사용해 대기 중인 결과를 검토합니다.

```text
node scripts/head.mjs run-review <project> --input <review.json>
```

```json
{
  "reviewContextId": "fresh-head-review-<24 hex>",
  "disposition": "accept",
  "rationale": "The Result Packet satisfies the Execution Contract and whole-plan invariants.",
  "nextActions": ["Continue with the next accepted contract"]
}
```

허용되는 처리 결과는 `accept`, `revise`, `expand`, `rollback` 및 `escalate`입니다.

`revise`와 `expand`는 다음 계획 게이트를 설정합니다. 해당 ReviewDecision에 연결된 새 세대를 생성합니다.

```text
node scripts/head.mjs lineage-next-plan <project> --input <next-whole-plan.json>
```

```json
{
  "reviewDecisionId": "review-decision-<24 hex>",
  "plan": [{ "id": "revised-step", "outcome": "Evidence-driven next result" }]
}
```

원래 목표는 상속되며 묵시적으로 대체할 수 없습니다. 새 스냅샷은 `generation`, `previousWholePlanId` 및 형식이 지정된 `refines` / `responds-to` 링크를 기록합니다. 다음 Run은 이 새 스냅샷에 바인딩된 계약을 사용해야 합니다. `rollback`과 `escalate`는 명시적인 사용자 소유 지시로 해결될 때까지 차단된 상태로 남습니다.

Result Packets에는 후보 지식이 포함될 수 있습니다.

```json
{
  "knowledgeProposals": [
    { "kind": "Claim", "statement": "Observed candidate fact", "evidenceRefs": ["evidence-id"] }
  ]
}
```

Fresh HEAD는 ReviewDecision 안에 권고를 반환할 수 있습니다.

```json
{
  "knowledgeProposalRecommendations": [
    {
      "proposalId": "knowledge-proposal-<24 hex>",
      "recommendation": "recommend-promotion",
      "rationale": "Direct evidence supports this candidate."
    }
  ]
}
```

허용되는 권고는 `recommend-promotion`, `reject` 및 `defer`입니다. 이 버전에서는 지식 Canon을 변경하거나 지시 권한을 획득하지 않습니다.

## 읽기 및 검증 표면

```text
node scripts/head.mjs lineage-read <project> --artifact <lineage-artifact-id>
```

읽기 전용 MCP 도구 `head_lineage_artifact`는 동일한 다이제스트 검증을 노출합니다. 어느 읽기 표면도 증거를 승격하거나, 권한을 변경하거나, Run을 전진시키지 않습니다.

## 실패 경계

- 누락되거나 유효하지 않은 계약: Run 시작이 실패로 폐쇄됩니다.
- 변조된 계획, Capsule, 계약, 결과 또는 검토: 다이제스트 검증이 실패로 폐쇄됩니다.
- 완료되지 않은 이전 검토: 다음 Run이 거부됩니다.
- 증거 또는 검증이 없는 Result Packet: Run 완료가 거부됩니다.
- 결과와 전체 계획의 불일치: ReviewDecision 생성이 거부됩니다.
- 누락되거나 오래된 Fresh HEAD 검토 컨텍스트 ID: ReviewDecision 생성이 거부됩니다.
- revise/expand 뒤에 이전 계획이나 관련 없는 계획이 이어짐: 다음 Run이 거부됩니다.
- 명시적인 사용자 지시가 없는 rollback/escalate: 다음 Run이 거부됩니다.
- 지식 제안 또는 권고: 권한이 없는 상태로 남으며 Canon을 변경하지 않습니다.
- 공급자 대화 손실: 검증된 프로젝트 아티팩트만으로 논리 상태를 재구성할 수 있습니다.
- 이후 SessionRunCheckpoint 뒤의 ResultPacket 삭제: 삭제된 증거를 참조하지 않고도 정확한 체크포인트 `nextExpectedResult`를 읽을 수 있습니다.
