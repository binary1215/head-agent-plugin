> 이 문서는 [Common Observation contract and adapters](../observation-adapters.md)의 한국어판입니다.

# 공통 Observation 계약과 어댑터

이 계약을 변경하기 전에 [아키텍처](architecture.md)와 [권한 평면](authority-plane-contract.md)을 읽으세요. 릴리스 전용 증거는 [Release observation](release-observation.md)에, 작업별 정확한 포함 방식은 [Context Compiler](context-compiler.md)에 설명되어 있습니다.

상태: 공급자 중립 P3 증거 문법과 P4 프로젝션이 구현되었습니다.

## 경계

공통 계약은 제품 어휘를 통일하지 않고 증거의 형태, 계보, coverage, replay와 권한만 표준화합니다. `ObservationTypeDescriptor`는 닫혀 있고 범위가 제한된 payload schema만 선언합니다. Feature, policy, 성공 조건, 인과 관계, tool route 또는 제품 의미를 선언할 수 없습니다.

adapter는 정확한 `ObservationSourceBinding`과 제한된 input을 제공합니다. Core는 불변 `ObservationRecord`와 하나의 `ObservationCollectionReceipt`를 만듭니다. 정확한 source record에 대한 결정적 계산은 별도의 `DerivedObservationRecord`를 만들며, 관찰된 사실을 다시 쓰지 않습니다.

credential, provider session, process ID, socket과 source cursor는 Host 로컬에 남습니다. binding에는 credential reference name만 나타날 수 있고 observation record에는 복사되지 않습니다. replay identity는 정확한 adapter key, adapter version, source-scope digest, source-event-key digest 범위로 제한됩니다. 해당 binding 안의 동일 replay는 같은 record로 수렴하고 내용이 다르면 fail closed됩니다. 서로 독립적인 source binding은 충돌 없이 같은 upstream event key를 재사용할 수 있습니다.

## Coverage와 graph

Coverage는 complete, sampled, partial, unknown으로 명시됩니다. bounded enumeration이 query digest, 동일한 examined/source total과 omission 0을 제공할 때만 complete coverage를 받아들입니다. adapter가 sample을 complete라고 주장할 수 없습니다.

재구축 가능한 `ObservationStatusProjection`은 `CONFORMS_TO`, `EVIDENCED_BY`, `DERIVED_FROM`만 만듭니다. impact, motivation, measurement, ownership, success 또는 Feature link를 추론하지 않습니다. 제품 해석은 HEAD가 작성한 `ProductHypothesis` 또는 기존 review-gated candidate flow가 담당합니다. `ProductSignal`은 원문 손실이 없는 사람/source 진술을 위해 유지되며 임의 payload field에서 만들어지지 않습니다.

릴리스 증거는 엄격한 specialization이며 generic adapter로 대체되지 않습니다. `BranchStateObservation`, `DeploymentResultObservation`, `ReleaseObservation`은 정확한 Git reachability, approval, commit, ref와 lineage 검사를 유지합니다.

## Context와 사용법

Context compilation은 기본적으로 공통 observation을 제외합니다. HEAD가 semantic analysis를 수행하고 kind가 `observation`이며 `observationIds`에 불변 현재 ID가 들어 있는 EvidenceNeed로 정확한 identity를 요청합니다. Core는 lexical eligibility, semantic promotion 또는 sufficiency judgment 없이 실제 포함만 증명합니다.

일상적인 inspection은 ephemeral하게 유지합니다. cross-Run, rebuttal/audit, handoff, context-loss evidence가 필요할 때만 Observation을 persist합니다. 사용자가 아니라 Host adapter가 정확한 source binding, descriptor, digest, coverage, provenance confirmation을 구성합니다. `observation-ingest`와 `head_observation_ingest`는 이미 bounded된 input을 위한 고급 Host/CI surface이고 collect는 adapter-facing compatibility alias로 유지됩니다.

`observation-status`와 `head_observation_status`는 전체 payload node 없이 bounded P4 summary를 반환합니다. `observation-query`와 `head_observation_query`는 type, subject, source, time, observed/derived kind로 정확한 현재 identity를 필터링하며 최대 page는 100입니다. cursor continuation은 정확한 현재 `ObservationStatusProjection`에 binding되고 drift 시 fail closed합니다. query result에는 payload body 대신 payload digest가 들어갑니다. exact read surface는 선택한 record, descriptor, bounded receipt 또는 derivation lineage를 반환합니다. query는 discovery일 뿐 semantic selection, Context eligibility, sufficiency judgment가 아닙니다.

## 수락 속성

- 서로 다른 제품 domain이 Core의 domain vocabulary 없이 같은 계약을 사용합니다.
- 독립 source binding은 같은 upstream event key를 재사용할 수 있고, 하나의 정확한 binding 안에서 divergent replay는 fail closed합니다.
- observation write는 Product Canon과 Session recovery byte를 변경하지 않습니다.
- Product Signal과 그 밖의 관련 없는 operating flow는 사용하지 않는 Observation storage를 load하거나 의존하지 않습니다.
- false completeness, schema drift, authority drift와 divergent replay는 fail closed됩니다.
- status와 query output은 bounded 상태를 유지하고 discovery를 semantic selection으로 바꾸지 않습니다.
- lexical overlap이 있어도 기본 Capsule compilation에는 common observation이 포함되지 않습니다.
- 정확한 HEAD EvidenceNeed는 이름으로 지정한 immutable record만 포함합니다.
- derived record와 projection은 semantic graph relation을 추가할 수 없습니다.
- hypothesis는 정확한 observation을 참조해도 non-authoritative 상태를 유지합니다.
- CLI와 MCP는 같은 Core identity를 반환합니다.
