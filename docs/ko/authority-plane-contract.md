> 이 문서는 [authority-plane-contract.md](../authority-plane-contract.md)의 한국어판입니다. 코드, 명령, 프로토콜 식별자와 필드 이름은 원문 표기를 유지합니다.

# 권한 평면과 그래프/레코드 경계

이 계약을 변경하기 전에 [`architecture.md`](architecture.md)를 읽으세요. 런타임 방향은 저장소 개발 이력이나 검증 fixture가 아니라 사용자가 소유한 프로젝트 권한에서 나옵니다.

상태: 활성 실행 가능 계약

프로토콜 버전: `0.4.0`

다이제스트가 유효한 `0.1.0`, `0.2.0`, `0.3.0` 내장 경계는 업그레이드 연속성을 위해 계속 읽을 수 있으며, 새 builder는 `0.4.0`을 내보냅니다. reader가 유지하는 유일한 레거시 분류는 과거의 일반 Feature/Policy 명명이며, 새 artifact를 승격하는 데는 절대 사용되지 않습니다.

## 이 경계가 존재하는 이유

HEAD Agent Core는 한 표현이 다른 표현의 권한을 물려받게 하지 않으면서 의미, 복구, 증거, 파생 검색, 실시간 효과를 조정합니다. 아래 다섯 평면은 의미 artifact를 분류합니다. `Distribution`과 `Host`는 별도의 아키텍처 평면입니다. 이들은 이러한 계약을 패키징하거나 실행하지만 제품 의미나 복구 방향의 추가 출처가 되지는 않습니다.

| 평면 | 소유 범위 | 대표 artifact | 금지된 추론 |
|---|---|---|---|
| P1 Normative Authority | 승인된 제품 의미, 정책, 명시적 결정 | Product Canon, ProductModelRevision, ProductCanonFeature/ReviewedFeature, PolicyCanon/ReviewedPolicy, ReviewDecision | 그래프, 메시지, 결과 또는 host에 존재한다는 사실만으로 승인을 만들 수 없음 |
| P2 Canonical Recovery/Lineage Record | Project, Session, Run, 계획, context, contract와 다음 방향의 provider 독립적 복구 | Project, HeadSession, Run, WholePlanSnapshot, ContextCapsule, ExecutionContract, SessionRunCheckpoint | 증거 삭제나 provider 요약이 checkpoint 필드를 다시 쓸 수 없음 |
| P3 Evidence Record | 검토 가능한 결과, 관찰, 후보, claim, 소유권 레코드와 감사 receipt | ResultPacket, WorkerReport, BoundedWorkerDispatch, BoundedWorkerWave/Seal/Abandonment, CandidateSet, FeatureCandidate/ProductFeatureCandidate, PolicyCandidate, Evidence, BranchStateObservation, DeploymentResultObservation, ReleaseObservation, DocumentCanonApplicationReceipt, RunResultIntegrationRequest/Receipt | 증거가 스스로 승격되거나 복구 Canon이 될 수 없음 |
| P4 Derived Relation/View | 재현 가능한 검색과 사람 대상 view | GraphSnapshot, GraphDB projection, TraversalResult, Markdown/Document projection, HEADContinuitySnapshot, SessionRestoreProjection, WorkerWaveStatusProjection/ResultProjection | projection이 Canon을 변경하거나 지시 권한을 부여하거나 유일한 복구 출처가 될 수 없음 |
| P5 Operational Effect | host 로컬 process, continuation, wait와 delivery 효과 | PID, token, proof, lease, endpoint, inbox, delivery receipt, ContinuationOutcome, BoundedWorkerWaitOutcome, BoundedWorkerWaveWaitOutcome, provider-session reference | continuation, wait, delivery 또는 process 제어의 성공이 실행, 검토, 승격 또는 복구를 승인할 수 없음 |

`scripts/lib/authority-plane-contract.mjs`는 내용에서 파생된 하나의 `AuthorityPlaneContract`를 내보내고, 위에서 구현된 artifact를 정확한 평면에 할당하며, 내장된 artifact 경계를 검증합니다. 이 평면들은 지속성 계층이 아니라 의미 클래스입니다. P2는 복구에 대한 권한을 갖지만 P1의 제품 의미를 소유하지 않으며, P1 검토는 P2 checkpoint 상태를 대체하지 않습니다.

경계 객체의 false 지시/승격 flag는 분류만으로는 어떤 행동 권한도 부여되지 않음을 뜻합니다. 특정 P1 ReviewDecision은 정확하고 다이제스트에 결속된 범위 한정 승인을 별도로 담을 수 있습니다. 다른 평면은 그 결정을 참조하거나 저장했다는 이유만으로 그 승인을 얻지 못합니다.

## 비증폭

한 평면이 다른 평면을 가리킨다는 이유만으로 권한이 위로 이동할 수 없습니다. P3 후보는 명시적으로 검증된 ReviewDecision과 정확히 검토된 변경 작업을 통해서만 P1에 영향을 줄 수 있습니다. P4 그래프 쓰기는 정확한 Product Canon 바이트로 차단됩니다. adapter가 해당 바이트를 변경하거나 삭제하면 Core는 그 바이트를 복원하고 World Model pointer를 전진시키기 전에 `GRAPH_PROJECTION_AUTHORITY_AMPLIFICATION`으로 실패합니다.

후보 제품 개념과 검토된 제품 개념은 이름과 평면이 서로 다릅니다. 그래프 node가 일반 또는 미검토 Feature/Policy label을 사용한다는 이유만으로 해당 개념이 P1로 분류되는 일은 없습니다. Product Canon 또는 별도로 검토된 Feature/Policy만 P1이며, FeatureCandidate, ProductFeatureCandidate, PolicyCandidate는 P3에 남습니다.

P3 증거, P4 파생 view, P5 운영 효과는 어떤 경우에도 P2 복구 권한으로 승격될 수 없습니다. checkpoint가 감사를 위해 증거를 참조할 수는 있지만, 그 복구 필드는 명시적인 HEAD/사용자 방향과 검증된 P2 lineage에서만 옵니다. ResultPacket, GraphSnapshot, continuity, inbox 또는 provider-session 상태는 그 필드를 제공하거나 다시 쓸 수 없습니다.

context와 조정에도 같은 규칙이 적용됩니다.

- provider HEAD semantic product proposal은 P3 evidence입니다. Core는 이를 검증하고
  immutable candidate set으로 정규화할 수 있지만 Product Canon이나 ReviewDecision을
  생성할 수 없습니다.
- Capsule은 지시 및 승격 권한이 false인 제한된 그래프 순회만 포함할 수 있습니다.
- 지속되지 않는 ContextWorkflowProjection은 새로운 의미 artifact가 아니라 하나의 Capsule preview에 관한 조언용 UX입니다. 이는 P4 비증폭 제약을 따르며, 입증된 `context-budget` 제외에 대해서만 다음 고정 tier에서 동일한 읽기 전용 compile을 반복할 수 있습니다. 그러나 EvidenceNeeds를 선택하거나, 512K를 초과하거나, provider를 호출하거나, 상태를 변경하거나, 의미적 충분성을 평가하거나, 승인을 부여하거나, 복구 방향을 쓸 수는 없습니다.
- 검토되지 않은 후보는 기본 traversal과 compilation에서 제외된 상태로 유지됩니다.
- provider 요약, continuity view, inbox message와 reply는 checkpoint 필드를 변경하거나 ReviewDecision을 만들 수 없습니다.
- 원격 GraphDB는 검증된 query를 가속할 수 있지만, 로컬 규범 레코드와 복구 레코드가 손실된 뒤 Product Canon을 재구성할 수는 없습니다.

## 그래프와 레코드의 차이

제품의 의미 Canon은 P1에 남습니다. Core의 시간적 `GraphSnapshot`은 P4입니다. 이는 검증된 Canon과 레코드 위에 구축된, 내용에서 파생되고 재구축 가능한 관계 및 검색 index입니다. `productModelId`와 hash는 projection의 출처를 결속할 뿐, Product Canon 권한을 그래프로 이전하지 않습니다. GraphDB는 그 정확한 snapshot을 대체 가능하게 구체화한 것일 뿐입니다. GraphDB와 생성된 Markdown을 삭제해도 Product Canon, Session/Run 복구, ReviewDecision lineage가 온전해야 합니다.

이 구분은 두 제품을 혼동하지 않으면서 원래 Product Graph의 통찰을 보존합니다. 제품 지식 model은 의미 Canon을 담을 수 있지만, HEAD Core의 시간적 그래프는 Canon과 실행 레코드 위에 구축된 파생 index입니다. 전자만 의미를 소유하고, 후자는 탐색을 담당합니다.

## 결과와 checkpoint 경계

`ResultPacket`과 `WorkerReport`는 P3 증거입니다. P2 `SessionRunCheckpoint`에 이미 고정된 정확한 `nextExpectedResult`를 변경하지 않고도 이를 검토하거나 첨부하거나 삭제할 수 있습니다. `ReviewDecision`은 P1 규범 레코드이고, checkpoint는 복구 레코드입니다. 어느 것도 다른 하나를 대신하지 않습니다.

수락된 검토 결과는 명시적인 일회성 통합 작업으로만 복구에 연결될 수 있습니다. 호출자가 checkpoint 복구 필드를 제공하며, ResultPacket과 ReviewDecision은 검증된 참조일 뿐 암묵적인 필드 출처가 아닙니다. create-only P3 요청은 호출자가 제공한 해당 필드를 고정하고 P2 checkpoint는 요청의 ID와 input hash를 결속합니다. checkpoint를 직접 구성하여 이 transaction을 우회하거나 그와 다르게 만들 수 없습니다. 요청은 P3 provenance로 남으며, 그 결과 생기는 자체 완결적 P2 checkpoint를 복원하는 데 필요하지 않습니다. 결과 receipt는 P3로 남고, artifact-only Session restore는 정확한 P2 checkpoint와 현재 검증된 lineage에 대한 비지속적 P4 projection입니다.

선택적 live continuation도 같은 경계를 따릅니다. Core가 먼저 정확한 P2 checkpoint를 복원한 뒤, P5 WorkspaceHost adapter가 이미 실행 중인 endpoint 하나를 fresh-verify할 수 있습니다. 지속되지 않는 `ContinuationOutcome`은 `attached` 또는 공개된 새 논리 HEAD fallback을 보고합니다. 이는 SessionRestoreProjection을 변경하거나, provider identity를 지속하거나, 복구 권한을 주장할 수 없습니다.

독립적으로 소유 가능한 worker 실행은 정확한 Run `ExecutionAuthorization` 위에 하나의 P3 `BoundedWorkerDispatch`를 기록합니다. P5 lease/process/wait 상태는 at-most-once 사용을 강제하고 진행 상황을 보고하지만, dispatch도 wait도 WholePlan을 변경하거나 ReviewDecision을 만들 수 없습니다. 그 결과인 P3 ResultPacket만 Fresh HEAD에 도달합니다. 새 P2 checkpoint를 쓰기 전에 명시적 P1 검토와 기존의 reviewed-result integration이 여전히 필요합니다.

`BoundedWorkerWave`는 정확한 Project, HEAD Session, active Run, WholePlan, ExecutionContract, Capsule lineage가 모두 동일할 때만 여러 dispatch를 묶을 수 있습니다. 이는 어떤 승인도 부여하지 않으며 각 lease는 독립적으로 유지됩니다. P3 seal에는 모든 member에 대한 검증된 소비가 필요하고, P4 status는 그 seal을 만들 수 없습니다. Wave의 실패, 완료, abandonment, result projection과 P5 wait는 P1 review나 P2 recovery direction을 만들 수 없습니다.

실행 가능한 복구 test는 ResultPacket을 만들고 checkpoint를 준비한 다음 ResultPacket 파일을 삭제하고도 checkpoint가 정확한 다음 예상 결과를 계속 재현하는지 검증합니다. 이는 증거/복구 경계에 대한 삭제 test이지, 정상 운영에서 증거를 폐기해도 된다는 허가가 아닙니다.

## 인과적 projection과 자기 참조 금지

receipt는 자신이 이름으로 지정한 GraphSnapshot의 일부일 수 없습니다. 따라서 Document Canon application은 다음과 같은 인과 순서를 사용합니다.

```text
verified ReviewDecision
  -> exact reviewed Product Canon mutation
  -> named child World Model / GraphSnapshot
  -> immutable application receipt naming that snapshot
  -> later audit child GraphSnapshot that may project the receipt
```

Core는 양쪽을 모두 검증합니다. 이름으로 지정된 그래프에는 새 receipt가 없고, 후속 그래프는 다른 identity를 가지며 이전 SourceSnapshot을 parent로 지정하고 receipt를 포함해야 합니다. 같은 snapshot에 포함하면 `GRAPH_SNAPSHOT_RECEIPT_SELF_REFERENCE`로 실패합니다.

## 실행 가능한 수락 기준

- 현재의 모든 lineage, checkpoint, GraphSnapshot과 application-receipt builder는 자신의 정확한 평면 경계를 내보내고, 현재 reader는 이를 검증합니다.
- 명시적 ReviewDecision 없는 P4-to-P1 승격은 실패합니다.
- Product Canon 바이트를 변경하는 그래프 adapter는 실패하고 Canon 바이트는 정확히 복원됩니다.
- checkpoint 생성 후 ResultPacket 증거를 삭제해도 `nextExpectedResult` 복구가 달라지거나 막히지 않습니다.
- receipt는 자신이 이름으로 지정한 그래프에는 없고 이후 child에만 나타납니다.
- 로컬, in-memory, 활성화된 GraphDB backend는 동일한 의미 GraphSnapshot과 TraversalResult identity를 보존합니다.
- reply는 ReviewDecision을 하나도 만들지 않으며, provider 요약은 checkpoint digest나 field를 변경할 수 없습니다.
