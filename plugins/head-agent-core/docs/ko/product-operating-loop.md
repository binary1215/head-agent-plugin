> 이 문서는 [product-operating-loop.md](../product-operating-loop.md)의 한국어판입니다. 코드, 명령, 프로토콜 식별자와 필드 이름은 원문 표기를 유지합니다.

# Product Operating Loop

상태: Product Operating Loop 프로토콜 `0.3.0`에 따른 최소 수직 경로가 구현되어 있으며, 다이제스트를 읽을 수 있는 `0.1.0` 및 `0.2.0` 호환성을 제공합니다.

Product Operating Loop는 관찰, 모델 추론, GraphDB 또는 연속성 요약을 HEAD나 사용자의 권한으로 만들지 않으면서 제품 학습을 검토된 실행과 연결합니다.

## 개발 척추와 운영 흐름

구현은 경쟁하는 두 권위를 만들지 않으면서 두 가지 의미 방향을 유지합니다. 개발 척추는 `Product Canon`과 명시적 `ReviewDecision` record에서 검토된 제품-코드 관계로 이어지는 하향식 규범 경로입니다. 운영 흐름은 initiative 검토, 실행, `ChangeSet`, `OutcomeObservation`을 지나는 시간 순서 evidence 경로입니다. 두 경로의 교차점은 P4 graph의 정확히 검증된 identity 또는 relation이며, 권위 record의 복사본이 아닙니다. 코드나 runtime 관찰은 P3 evidence와 candidate를 만들 수 있지만 개발 척추를 다시 쓸 수 없습니다.

이제 provider-neutral `BranchStateObservation`, `DeploymentResultObservation`, `ReleaseObservation` ingestion이 bounded P3 evidence로 운영 흐름을 확장합니다. 그 존재나 시각은 제품 승인, Product Canon, 성공 판정 또는 복구 방향을 만들 수 없습니다. `AnalyticsEvent` ingestion은 추론하거나 모사한 loop closure가 아니라 명시된 capability gap으로 남습니다. [Release observation](release-observation.md)을 참고하세요.

## 권한 분리

루프는 다섯 가지 인식론적 클래스를 사용합니다.

| 클래스 | 아티팩트 | 권한 효과 |
| --- | --- | --- |
| 관찰된 사실 | `ProductSignal` | 증거일 뿐 |
| 가설 | `ProductHypothesis` | 결정 권한 없음 |
| 추론된 의미 | `ProductInitiativeCandidate`, `ProductFeatureCandidate` | 후보일 뿐 |
| 승인된 결정 | `ReviewedProductInitiative` | 명시적으로 검토된 이니셔티브이며 Product Canon은 아님 |
| 파생 프로젝션 | Product Graph 및 `HEADContinuitySnapshot` | 재구축 가능한 참조 뷰일 뿐 |

`ProductSignal → ProductHypothesis → ProductInitiativeCandidate`는 추론의 궤적이지 권한 체인이나 필수 영속화 체인이 아닙니다. 일상적인 관찰, 가설 및 추론된 의미는 콘텐츠 식별자와 그래프 재구축이 없는 비영속 `ProductLearningNote`를 기본으로 합니다. Signal/Hypothesis 아티팩트는 Run 간 경계, 반박/감사 경계, 제품 상태 경계 또는 인계/컨텍스트 손실 경계에서만 영속화합니다. Product Initiative는 `decisionScope: product-initiative`인 명시적 `ReviewDecision`을 통해서만 검토된 상태가 됩니다. Product Canon은 `.head/context/product-model.json`에 그대로 있으며 이 흐름에 의해 변경되지 않습니다.

이제 durable `ProductHypothesis`는 별도로 persisted `ProductSignal`이 있거나 없어도 `observationIds`를 통해 정확한 `ObservationRecord` 또는 `DerivedObservationRecord` identity를 인용할 수 있습니다. 이미 검증된 evidence를 사람이 다시 작성할 필요를 없애지만 adapter가 meaning을 작성하지는 않습니다. hypothesis는 여전히 HEAD가 작성하며 reference는 review, promotion, success 또는 recovery authority를 부여하지 않습니다.

Observation storage는 optional이며 격리된 상태를 유지합니다. Product Operating projection과 signal-only flow는 durable hypothesis가 정확한 Observation ID를 실제로 참조하지 않는 한 이를 load하거나 validate하지 않습니다. 일단 참조되면 현재 Observation integrity와 receipt lineage는 이전과 같이 fail closed합니다.

## 연결된 최소 흐름

```text
ProductSignal (observed-fact)
  -> ProductHypothesis (hypothesis)
  -> ProductInitiativeCandidate (inferred-meaning)
  -> explicit user ReviewDecision
  -> ReviewedProductInitiative (approved-decision, not Product Canon)

Feature resolution:
  existing-feature -> exact current Product Canon Feature key
  candidate        -> separate ProductFeatureCandidate
  gap              -> explicit reason; no forced one-to-one mapping

accepted execution ReviewDecision + ResultPacket -> ChangeSet
  -> OutcomeObservation (observed-fact or derived-projection)
  -> HEAD reevaluates product meaning and success
```

영속 Signal/Hypothesis 경로는 명시적 감사 경계를 위해 계속 사용할 수 있습니다. 더 가벼운 경로는 명시적인 인라인 추론에서 불변 `ProductInitiativeCandidate`를 직접 생성할 수 있습니다. 이 경로는 Feature 결정을 수락 검토까지 미룰 수 있으므로 사용자 결정 전에는 `ProductFeatureCandidate`가 존재하지 않습니다. 검토된 Initiative는 후보의 바이트에 의존하지 않고 제목, 설명, 추론 및 가설 참조를 보존하면서, 별도의 검토 아티팩트에 정확히 하나의 `existing-feature | candidate | gap` 결정을 추가합니다.

`OutcomeObservation`은 해당 `ResultPacket`에 수락된 실행 `ReviewDecision`이 있는 ChangeSet을 참조해야 합니다. 또한 검토된 Initiative를 참조할 수 있습니다. Feature의 성공을 표시하거나, Feature 상태를 변경하거나, Product Canon을 승격할 수는 없습니다.

## Product Graph 경계

World Model은 아티팩트를 `ProductSignal`, `ProductHypothesis`, `ProductInitiativeCandidate`, `ProductInitiativeReviewDecision`, `ReviewedProductInitiative`, `ProductFeatureCandidate` 및 `OutcomeObservation` 노드로 프로젝션합니다. `SUPPORTED_BY`, `PROPOSES_FROM`, `PROPOSES_TO`, 검토/승격 관계 및 `OBSERVES`를 통해 이 경로를 질의할 수 있습니다.

이 그래프는 `derived-evidence-only`입니다. 로컬 JSON이면 충분합니다. GraphDB는 선택적 구체화이며 오케스트레이션, 도구 라우팅, 컨텍스트 선택, ReviewDecision 또는 제품 의미를 소유할 수 없습니다.

## HEAD 연속성 경계

`HEADContinuitySnapshot`은 요청 시 빌드되며 프로젝트 저장소에 절대 기록되지 않습니다. 현재 Project, Session, Run, WholePlan, ExecutionContract, ResultPacket, ReviewDecision, checkpoint, Product Model, World Model 및 product-operating 식별자가 존재할 경우 그에 대한 정확한 참조를 포함합니다.

이 스냅샷은 다음과 같은 고정 속성을 모두 갖습니다.

- `persisted: false`
- `recoveryAuthority: false`
- `instructionAuthority: false`
- `promotionAuthority: false`
- `objectiveRewrite: false`

복구 권한은 `.head/sessions/current.json`, Run 정본 및 Session/Run checkpoints에 계속 있습니다. 이 스냅샷은 HEAD의 지속적인 전체 결과 판단을 대체할 수 없습니다.

동일 프로세스에서 반복되는 `product-operating-status` 및 `head-continuity` 읽기는 Product Operating 프로젝션 식별자와 World Model 콘텐츠 식별자를 키로 하는, 공개되고 검증된 스냅샷 캐시를 사용합니다. Core 쓰기는 캐시를 무효화합니다. 전체 아티팩트 및 World Model 검증을 강제하려면 `--fresh` 또는 MCP `fresh: true`를 사용합니다. 캐시 상태는 운영 정보일 뿐이며 권한이나 복구 증거가 될 수 없습니다.

## CLI

`head help`는 아래의 가벼운 기본값을 보여 줍니다. `operating-lane-recommend`는
선택적 자문 도구이며 실행 게이트가 아닙니다. 영속 Signal/Hypothesis, 감사, 호환성 및 복구 표면을 찾으려면 `head help-all`을 사용합니다.

```text
head operating-lane-recommend <project> --input <risk.json>
head product-note <project> --input <note.json>
head product-signal-record <project> --input <signal.json>
head product-hypothesis-record <project> --input <hypothesis.json>
head product-initiative-propose <project> --input <initiative.json>
head product-initiative-review <project> --input <review.json>
head product-outcome-observe <project> --input <outcome.json>
head product-operating-status <project> [--fresh]
head head-continuity <project> [--fresh]
```

record/review/observe 명령은 동일한 작업에서 로컬 World Model과 Product Graph를 다시 빌드합니다. 원격 GraphDB를 활성화하지는 않습니다.

## MCP

타입이 지정된 MCP 표면은 다음과 같습니다.

- `head_operating_lane_recommend`
- `head_product_note`
- `head_product_signal_record`
- `head_product_hypothesis_record`
- `head_product_initiative_propose`
- `head_product_initiative_review`
- `head_product_outcome_observe`
- `head_product_operating_status`
- `head_continuity_snapshot`

기본 대화형 표면은 선택적 `head_operating_lane_recommend`, `head_product_note`, 영속적인 제품 조치가 필요할 때의 Initiative 제안/검토, 그리고 상태입니다. 기존의 일곱 record/observe/read 도구는 의무적인 절차가 아니라 호환성을 갖춘 명시적 표면으로 남습니다.

Initiative 검토에는 `confirm_user_review: true`가 필요합니다. 이 확인은 사용자가 소유한 검토 권한을 기록합니다. MCP를 사용할 수 있다는 사실만으로 그 권한이 부여되지는 않습니다.
