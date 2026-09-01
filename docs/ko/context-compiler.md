> 이 문서는 [context-compiler.md](../context-compiler.md)의 한국어판입니다. 코드, 명령, 프로토콜 식별자와 필드 이름은 원문 표기를 유지합니다.

# HEAD Context Compiler 설계

이 평면을 변경하기 전에 [`architecture.md`](architecture.md)를 읽고, compilation이 독립적인 권한이 되지 않고 Whole-plan HEAD와 Execution Lineage를 계속 지원하는지 확인하세요.

## 설계 목표

Compiler는 “HEAD가 이 작업에 어떤 bounded evidence를 요구했고, 실제로 무엇이 포함됐으며, 그 이유는 무엇인가?”라는 질문에 답합니다. 기계적 ranker가 semantic sufficiency를 판정한다고 주장하지 않고 재현 가능한 task context를 만듭니다.

이는 memory와 구별됩니다.

- Memory는 선택된 사실과 이전 event를 보존합니다.
- 프로젝트 world model은 현재 system의 작동 방식을 구체화합니다.
- Context Compiler는 하나의 작업을 위한 하나의 inference-time world를 구성합니다.
- HEAD는 판단, 권한, 확장, 통합, 완료를 소유합니다.

## Pipeline

```text
Sources and promoted canon
  -> immutable input digests
  -> Snapshot
  -> HEAD semantic analysis + exact EvidenceNeeds
  -> Claim/Decision/Unknown candidates
  -> evidence attachment
  -> verified need coverage + fallback lexical ranking
  -> context budget and anti-context exclusions
  -> ContextCapsule + digest
```

Context Compiler protocol `0.16.0`은 결정적 packaging과 semantic judgment를 분리합니다. provider HEAD가 task analysis를 수행하고 `EvidenceNeed[]`에 정확한 repository `paths`, Product Canon `entityKeys`, 현재 상태에 결속된 `graphAnchor` 또는 immutable `observationIds`를 지정할 수 있습니다. Core는 이를 현재 Project·World Model·GraphSnapshot·common Observation projection에 대조하고 실제 포함만 증명합니다. lexical normalization과 overlap은 anchor가 없는 evidence의 공개된 discovery/ranking fallback일 뿐입니다. repository retrieval은 더 이상 첫 token-matching file을 temporal anchor로 선택하지 않습니다.

명시적 budget은 엄격한 상한이며 충분하다는 주장이 아닙니다. 이 `EvidenceNeed[]` 계약에서 `temporal-relation` need는 `graphAnchor: { projectId, worldModelId, graphSnapshotId, nodeIds, depth, maxNodes, maxEdges }`를 가질 수 있습니다. exact anchor에는 현재 적격 node, 비어 있지 않은 relation allowlist와 정확한 traversal bound가 필요하며 facet을 함께 쓸 수 없습니다. 일치하는 relation 또는 Product entity key마다 독립된 기계적 evidence item이 됩니다. Compiler는 이러한 need를 스스로 만들지 않고 실제 포함만 입증합니다.

`head_context_prepare`와 CLI `context-prepare`는 사용자가 이 구조를 직접 작성하지 않게 합니다. task-only 호출은 현재 Project/World/Graph identity, lexical baseline candidate와 exact node ID를 포함한 제한적이고 비영속적인 `ContextPreparationProjection`을 반환합니다. provider HEAD가 semantic reasoning과 일반 repository inspection으로 `EvidenceNeed[]`를 작성하며 Core는 이를 추론하지 않습니다. 이어지는 `head_context_preview`가 현재 상태에 대해 proposal을 검증합니다. 따라서 preparation은 Core 내부 LLM이나 새 authority plane이 아니라 대화형 UX입니다.

일반적인 대화 흐름은 user intent에서 HEAD action으로 한 번에 이어집니다. 사용자는
task를 한 번만 말하고, Skill이 status와 preparation을 수행하며, HEAD가 repository를
검사해 필요한 proposal을 작성한 뒤, preview가 같은 task를 유지하면서 근거가 있을
때에만 고정 budget tier를 자동 확장합니다. 이 내부 절차를 연속적인 설정 질문으로
바꾸지 않습니다. 선택적인 World evidence가 없거나 오래돼도 직접 작업은 중단하지
않습니다. 해당 task에 governed·reproducible Capsule evidence가 실제로 필요할 때만
Product/World를 안내합니다. CLI와 MCP는 자동화·감사를 위한 전체 structured output을
계속 제공하고, 기본 text는 짧은 결과와 다음 행동만 보여줍니다.

Context Preparation protocol `0.2.0`은 선택적인 World evidence를 사용할 수 없는
상태와 그것을 활성화해야 한다는 의미 판단을 구분합니다.

readiness/status 표면은 프로젝트 상태를 바꾸지 않고 Context를 `blocked`,
`curated-only`, `repository-ready`, `world-refresh-required` 네 상태로 구분합니다.
`curated-only`는 정직한 Core-only 상태입니다. World가 아직 없다면 preparation은
`curated_only`를 반환하고 직접 작업 또는 일반 repository inspection을 기본으로
유지합니다. 재현 가능한 repository·Product·graph evidence를 Capsule에 아직 넣을
수 없다는 점은 공개합니다. 정확한 Product profile 진입점은 HEAD 또는 사용자가
task에 해당 evidence가 필요하다고 판단한 뒤에만 선택하는 확장 경로이며, Core가
그 의미 판단이나 활성화를 수행하지 않습니다. 오래된 World는 재사용하지 않고
제외하며, 명시적인 refresh 진입점을 반환합니다.

HEAD가 EvidenceNeeds를 제공한 경우 packing은 요구된 mechanical coverage가 충족되면 멈춥니다. 무관한 candidate는 `outside-head-evidence-contract`, 이미 충분한 중복 candidate는 `evidence-coverage-satisfied`로 기록되며, 남은 공간이 있다는 이유로 lexical material로 budget을 채우지 않습니다. EvidenceNeeds가 없을 때 lexical path는 제한된 discovery baseline으로 남습니다. 이 구분 덕분에 Core가 semantic relevance를 결정하지 않으면서도 exact HEAD guidance가 recall과 noise를 모두 개선할 수 있습니다.

Budget protocol `1.0.0`은 대략적인 token 수로 `32768`(32K), `65536`(64K), `131072`(128K), `262144`(256K), `524288`(512K)만 받습니다. 32K tier가 기본값이고 512K는 목표가 아니라 엄격한 최대값입니다. 모든 Compiler call은 Capsule identity에 참여하는 명시적 tier 하나를 받으며, Compiler는 이를 변경하지 않습니다. HEAD가 소유한 충족되지 않은 need에 대해 일치하는 증거가 명확히 `context-budget` 때문에 제외된 경우에만, 지속되지 않는 preview wrapper가 다음 고정 tier를 결정적으로 다시 시도할 수 있습니다. 각 시도에는 자체 Capsule identity와 coverage proof가 있습니다. 현재 근삿값은 `ceil(UTF-16 code units / 4)`이므로 Capsule metadata는 이를 부정확하다고 표시하며, 호출 전에 runtime adapter가 실제 provider-token 적합성과 output reserve를 검증해야 합니다.

내용 기반 주소를 갖는 `evidenceNeedContract`와 `coverageAssessment`는 그 증명을 Capsule identity에 결속합니다. `coverageAssessment.status`는 `not-requested`, `coverage-complete`, `coverage-incomplete` 중 하나입니다. 모든 proof는 포함된 evidence carrier, evidence digest, available-match count와 exclusion reason을 명시합니다. 이는 기계적 포함 결과이지 의미적 수락이 아닙니다. ExecutionContract를 만들기 전에 evidence kind와 그 내용이 충분한지는 여전히 HEAD가 결정합니다. 불완전한 Capsule도 감사할 수는 있지만 중대한 실행에 결속할 수 없습니다. preview는 `context-budget`에 대해서만 확장할 수 있으며, 누락된 증거, 오래된 World와 512K 상한은 HEAD에 반환됩니다. 레거시 `sufficiency` field는 사용 중단된 compatibility projection으로만 남으며 Compiler가 소유한 판단으로 읽어서는 안 됩니다.

HEAD가 소유한 input 예시:

```json
[
  {
    "id": "implementation",
    "kind": "repository-source",
    "paths": ["scripts/lib/context-compiler.mjs"],
    "minimumItems": 1,
    "rationale": "The implementation changed by this task must be present."
  },
  {
    "id": "call-boundary",
    "kind": "temporal-relation",
    "relationTypes": ["DECLARES", "REFERENCES"],
    "graphAnchor": {
      "projectId": "project-example",
      "worldModelId": "world-model-000000000000000000000000",
      "graphSnapshotId": "graph-snapshot-000000000000000000000000",
      "nodeIds": ["file-example-node"],
      "depth": 1,
      "maxNodes": 32,
      "maxEdges": 64
    },
    "minimumItems": 1
  }
]
```

HEAD가 해당 작업에 `repository-test` need를 추가할 때만 test를 요청합니다. document는 `repository-source` need를 충족할 수 없고, relationship need는 포함된 carrier candidate를 통해 실제로 포함된 relationship record로만 충족됩니다.

Common Observation record는 lexical candidate가 되지 않습니다. HEAD는 kind `observation`과 정확한 `observationIds`를 사용해야 하며, Core는 해당 current immutable record만 `ObservationEvidence`로 포함합니다. descriptor, payload, coverage와 P4 projection은 evidence로 남고 product meaning, semantic sufficiency, instruction authority 또는 recovery direction을 제공할 수 없습니다. [`observation-adapters.md`](observation-adapters.md)를 참고하세요.

## 신뢰와 권한

저장소 artifact는 신뢰되지 않은 증거입니다. system, user 또는 승격된 project policy를 재정의할 수 없습니다. Claim 또는 Decision이 참조하는 증거에는 `instructionAuthority: false`가 설정됩니다.

Decision은 project canon으로 승격된 뒤에만 작업 방향을 지시할 수 있으며, 사용자가 소유한 중대한 결정에 계속 종속됩니다. Compiler가 발견한 내용은 world model을 조용히 변경하는 대신 candidate knowledge로 반환됩니다.

## Staleness와 history

Claim은 active, stale, superseded, uncertain 같은 상태 전이를 지원합니다. Decision은 명시적으로 superseded되지 않는 한 지속됩니다. 작업 분석은 history demand를 `NONE`, `RECENT`, `DECISIONS`, `DEEP` 중 하나로 분류합니다. 일반 작업은 history를 자동으로 검색하지 않습니다. 현재 World Model에 검증된 Git history가 있으면 적격 commit은 동일한 context budget 아래 `GitDecisionEvidence` 후보가 됩니다. 이들은 계속 증거이며, 검색만으로 canonical `Decision` record가 되는 일은 없습니다.

다음 indexer layer는 Hot/Warm/Cold knowledge를 유지해야 합니다.

- Hot: 현재 구체화된 상태와 invariant.
- Warm: decision과 change summary.
- Cold: 원시 VCS와 filesystem history.

## 재현성

모든 Capsule은 task, project ID, Snapshot ID, source digest, compiler version, history class, token approximation, candidate, inclusion, exclusion, provenance와 Capsule digest를 기록합니다.

Capsule ID는 내용에서 파생됩니다. 동일한 task, input digest, compiler version과 budget은 동일한 identifier를 생성합니다.

## Repository World Model 통합

index가 없으면 compilation은 선별된 `.head/` source로 제한됩니다. World Model이 최신이면 모든 현재 repository file, 제한된 `ProductContext`, symbol, dependency, structural adjacency, HEAD가 exact anchor로 지정한 `GraphTraversalEvidence`, Git evidence와 runtime observation이 동일한 Capsule budget 안에서 경쟁합니다. `ProductContext`는 계속 사용자가 소유한 Product Canon의 파생 뷰입니다. exact temporal expansion은 `GraphProjectionAdapter`를 사용하며 Project·World Model·GraphSnapshot·node·relation allowlist·depth·node/edge limit에 결속됩니다. stale, tampered, cross-project, candidate-hidden 또는 확대된 요청은 fail closed됩니다. provider 문구와 adapter diagnostic은 권한이나 복구 방향이 되지 않습니다. index가 오래됐는데 exact graph anchor가 있으면 compilation은 fail closed됩니다.

제한된 검색 전략은 비용을 바꾸지 권한을 바꾸지 않습니다. 검색 품질 conformance는 identifier normalization, HEAD가 정의한 EvidenceNeed coverage와 coverage-incomplete 동작이 안정적으로 유지될 것도 요구합니다. 필요한 증거를 제거한다면 latency 개선은 의미를 보존하지 않은 것입니다. 과거 `1.0.0` 이전 budget benchmark는 격리된 291-file fixture에서 동일한 4,000-token task Capsule을 두 번 6.5–7.2초 만에 compile했지만, 이전의 file별 traversal path는 약 3분 안에 끝나지 않았습니다. 현재 Compiler는 임의의 4,000-token input을 거부하고 위에서 설명한 고정 32K–512K tier만 받습니다. 과거 fixture identity와 latency는 Capsule identity 외부의 운영 개발 증거로 남으며, target-project context나 현재 acceptance command가 되는 일은 없습니다.

Runtime observation에는 지시 권한도 제어 권한도 없습니다. Temporal graph는 canon, 지시, 승격, 검토 또는 복구 권한이 없는 재구축 가능 증거입니다. semantic graph는 heuristic source analysis를 기본 fallback으로 유지하고, 선택적인 provider-neutral `SourceRelationEvidenceAdapter`가 현재 file manifest·언어 AST analyzer·endpoint·line·digest에 결속된 증거를 제공할 수 있습니다. AST 기반 `CALLS`/`IMPORTS` edge는 heuristic edge와 출처 및 신뢰도가 분리되며 HEAD의 의미 판단을 대신하지 않습니다. 숨겨진 candidate, benchmark, latency surface는 일반 compilation에 들어오지 않습니다.
