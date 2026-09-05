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

## Host adapter SDK와 reference file adapter

`ObservationAdapterRegistry`는 process-local P5 Host registry입니다. adapter instance를 하나의 정확한 ready HEAD Project, `ObservationSourceBinding` 및 `ObservationTypeDescriptor`에 binding한 다음 structured Host input과 같은 Core verifier를 통해 collection을 위임합니다. 서로 다른 Project에서는 같은 source alias를 독립적으로 사용할 수 있지만 opaque source ID와 collection은 Project-bound입니다. registration에는 임의의 Core source-count gate가 없습니다. 비지속 P4 discovery view는 page당 최대 64개 source를 반환하며 exact type/adapter/availability filter와 현재 filtered registry projection에 binding된 opaque cursor를 제공합니다. source discovery에는 authority나 mutation effect가 없으므로 stale cursor는 명시적 resynchronization metadata와 함께 첫 page로 다시 시작하며 collection은 정확한 현재 Project와 source ID를 계속 재검증합니다. registry, source alias, source path, credential, cursor, provider identity와 polling state는 프로젝트에 기록되지 않습니다. Core는 project adapter code를 discover하거나 dynamically load하지 않으며, trusted Host composition만 adapter instance를 register할 수 있습니다.

각 source projection은 bounded descriptor shape summary를 포함합니다. type/version, form, 최대 16개의 field key/type/required 조합과 omission count만 노출합니다. Host는 bounded operational availability state(`unknown`, `ready`, `auth-missing`, `rate-limited`, `unavailable`), timestamp, retry timestamp, stable reason code만 붙일 수 있습니다. 이 hint는 semantic authority가 false인 P5 operational evidence이며 product relevance ranking, freshness sufficiency 또는 instruction이 될 수 없습니다.

제품별 adapter는 authentication, API query, pagination, rate limit, webhook acknowledgement와 cursor storage를 Core 외부에서 소유합니다. 하나의 bounded result를 공통 계약으로 normalize하고, Core는 검증된 P3 record와 receipt만 persist합니다. optional adapter가 없어도 HEAD는 막히지 않으며 adapter output은 제품 의미를 부여할 수 없습니다.

`JsonEventFileObservationAdapter`는 CI 또는 webhook spool integration을 위한 provider-neutral reference입니다. absolute Host path의 regular non-symlink JSON file 하나를 open하고, 열린 file identity를 검증하며, 512 KiB read bound를 적용한 뒤 collection 전에 raw event key와 전체 evidence를 hash합니다. source path, raw event key, source alias와 credential reference name은 persist되지 않습니다. event file에는 product-shaped event만 들어갑니다.

```json
{
  "schemaVersion": 1,
  "eventKey": "build-42",
  "subject": { "type": "example.ci.target", "key": "app" },
  "form": "event",
  "temporalScope": {
    "observedAt": "2026-09-01T01:00:00.000Z",
    "start": null,
    "end": null
  },
  "coverage": {
    "state": "complete",
    "basis": "enumerated-bounded-query",
    "queryDigest": "<sha256>",
    "examinedCount": 1,
    "sourceReportedTotal": 1,
    "omittedCount": 0,
    "cursorStartDigest": null,
    "cursorEndDigest": null
  },
  "payload": { "succeeded": true }
}
```

고급 one-shot Host configuration은 binding, descriptor와 absolute event path를 제공합니다. `sourceKey`는 optional이며 생략하면 정확한 binding과 descriptor에서 derive됩니다.

```json
{
  "binding": {
    "adapterKey": "head.json-event-file-observation",
    "adapterVersion": "0.1.0",
    "sourceScopeDigest": "<sha256>",
    "credentialReferenceNames": []
  },
  "descriptor": {
    "typeKey": "example.ci.build-result",
    "typeVersion": "1.0.0",
    "forms": ["event"],
    "payloadSchema": {
      "fields": [{ "key": "succeeded", "type": "boolean", "required": true }],
      "additionalFields": false
    }
  },
  "eventFile": "<absolute-host-path>"
}
```

`observation-file-ingest`는 trusted Host/CI integration에서만 실행합니다. 의도적으로 MCP file-path surface를 제공하지 않습니다. 일반 대화형 사용에서는 model이나 user에게 path와 provenance JSON을 작성하게 하지 말고 configured Host integration을 호출해야 합니다. reference adapter는 one-shot이며 daemon, scheduler, remote connector 또는 자동 product interpretation을 제공하지 않습니다.

## 대화형 configured-source 흐름

trusted Host composition은 Project-bound registry를 `serveMcp`에 전달합니다. provider HEAD가 필요한 exact `typeKey` 하나를 선택한 뒤 `head_observation_prepare`가 read-only reuse-first flow를 수행합니다. 현재 exact Observation ID를 먼저 query하고 source를 선택하거나 collect하지 않은 채 일치하는 configured source ID를 반환합니다. 기존 evidence가 의미적으로 충분하지 않고 durable current evidence가 실제로 필요할 때만 HEAD가 필요에 따라 `head_observation_sources`를 page/filter하고 선택한 ID로 `head_observation_collect_source`를 호출합니다.

```text
trusted Host configuration
  -> head_observation_prepare(exact HEAD-selected typeKey)
  -> existing exact Observation IDs first
  -> head_observation_sources only for paging or diagnosis
  -> opaque Project-bound sourceId
  -> head_observation_collect_source
  -> verified P3 ObservationRecord + ObservationCollectionReceipt
```

preparation projection은 semantic sufficiency를 판단하거나 lexical overlap으로 relevance를 추론하거나 source를 선택하거나 어떤 것도 persist하지 않습니다. provider HEAD가 conversation 안에서 그 판단을 수행합니다. 이 경로에서 model과 user는 file path, credential reference, binding, descriptor, digest, coverage claim, provider identity 또는 source alias를 제공하지 않습니다. Core는 adapter가 source에 접근하기 전에 Project readiness를 검증합니다. Host composition이 없으면 optional adapter unavailable 상태를 명시하며 user-authored provenance로 fallback하거나 공통 계약을 약화하지 않습니다. embedding Host는 고급 CLI composition에서도 같은 injected registry를 사용할 수 있지만 일반 standalone CLI는 adapter code나 configuration을 dynamically load하지 않습니다.

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
- Host registry는 non-persisted P5 configuration으로 남고 검증된 result는 같은 P3 identity와 replay contract를 사용합니다.
- source registration은 bounded status projection 때문에 차단되지 않고 생략된 status entry가 명시됩니다.
- exact source filter와 opaque pagination으로 unbounded output 없이 모든 registered source를 discover할 수 있습니다.
- stale source cursor는 사용자에게 recovery ritual을 요구하지 않고 non-authoritative resynchronization을 명시하며 다시 시작합니다.
- source shape 및 availability summary는 bounded, non-semantic, non-instructional, non-persisted입니다.
- reuse-first preparation은 matching configured source보다 기존 exact Observation ID를 먼저 반환하며 sufficiency를 판단하거나 자동 collect하지 않습니다.
- 등록된 모든 source ID는 하나의 정확한 HEAD Project에 binding되며 다른 Project로 collect할 수 없습니다.
- external adapter collection 전에 Project readiness를 검증합니다.
- conversational source flow는 opaque configured source ID만 받고 user에게 provenance structure를 요구하지 않습니다.
- reference event-file adapter는 Host path, raw event key, source alias 또는 credential reference를 persist하지 않으면서 서로 무관한 product schema를 받아들입니다.
- reference file path는 MCP 밖에 남고 malformed, oversized, relative-path 또는 divergent event는 fail closed합니다.
