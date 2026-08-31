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

Context Compiler protocol `0.13.0`은 결정적 packaging과 semantic judgment를 분리합니다. provider HEAD가 task analysis를 수행하고 `EvidenceNeed[]`에 정확히 정규화된 repository `paths` 또는 정확한 Product Canon `entityKeys`를 지정할 수 있으며, Core는 이를 현재 World Model에 대조하고 실제 포함만 증명합니다. lexical normalization과 overlap은 anchor가 없는 evidence를 위한 bounded fallback ranking signal로만 남습니다. lexical overlap이 0이어도 현재 candidate는 탈락하지 않으며 lexical score는 semantic acceptance가 아닙니다.

명시적 budget은 엄격한 상한이며 충분하다는 주장이 아닙니다. HEAD는 정확한 project-relative path, Product Canon entity keys, evidence kind, optional lexical facet, relation type과 최소 item 수를 명명하는 작업 로컬 `EvidenceNeed[]` contract를 제공할 수 있습니다. 일치하는 Product entity key 하나마다 독립된 기계적 evidence item 하나가 되므로, 명명한 anchor가 모두 필요하면 HEAD가 `minimumItems`로 그 요구를 표현할 수 있습니다. exact selector는 HEAD가 작성하며 facet은 공개된 lexical filter일 뿐 semantic analysis를 대신하지 않습니다. Compiler는 후보가 있다는 이유로 이러한 need를 만들어 내지 않으며, 제공된 need와 일치하는 증거가 선택된 Capsule에 실제로 존재하는지만 입증합니다.

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
    "kind": "semantic-relation",
    "relationTypes": ["CALLS", "IMPORTS"],
    "minimumItems": 1
  }
]
```

HEAD가 해당 작업에 `repository-test` need를 추가할 때만 test를 요청합니다. document는 `repository-source` need를 충족할 수 없고, relationship need는 포함된 carrier candidate를 통해 실제로 포함된 relationship record로만 충족됩니다.

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

index가 없으면 compilation은 선별된 `.head/` source로 제한됩니다. Repository World Model이 최신이면 모든 현재 repository file, 제한된 파생 `ProductContext`, heuristic symbol, dependency, 사전 index된 semantic adjacency, 결정적 repository temporal anchor 하나, history class상 적격인 Git commit 증거와 특정 시점의 runtime observation이 동일한 Capsule budget 안에서 경쟁합니다. Temporal expansion은 `GraphProjectionAdapter`를 통해 실행됩니다. local JSON, in-memory conformance, 명시적으로 활성화된 ArcadeDB prepared expansion과 공개된 embedded-graph fallback은 동일한 semantic traversal을 반환해야 하므로 adapter identity, prepared verification receipt와 diagnostic은 Capsule identity에 들어가지 않습니다. ProductContext는 HEAD가 작성한 정확한 Product Canon entity key로 선택되거나, anchor가 없는 fallback에서만 task term과 검증된 Product Canon 의미의 일치로 선택됩니다. 이는 Product Model, GraphSnapshot, TraversalQuery와 result identity를 기록하고 명시적 product relation allowlist를 통해 `canon-projected` Product node만 순회합니다. 명시적인 runtime, kind와 state term은 runtime candidate 범위를 좁힙니다. Capsule은 semantic 및 temporal GraphSnapshot metadata, 포함된 각 temporal TraversalQuery와 result digest, Git 및 runtime coverage, 포함된 증거, 명시적 trust boundary와 exclusion을 기록합니다. Temporal expansion은 relation/authority/freshness allowlist, confidence policy, depth, node 및 edge limit, deterministic ordering과 candidate exclusion을 고정합니다. index가 오래되면 모든 product, repository, temporal, Git, runtime candidate와 그 metadata가 제외되고 coverage에 stale 상태가 기록됩니다.

제한된 검색 전략은 비용을 바꾸지 권한을 바꾸지 않습니다. 검색 품질 conformance는 identifier normalization, HEAD가 정의한 EvidenceNeed coverage와 coverage-incomplete 동작이 안정적으로 유지될 것도 요구합니다. 필요한 증거를 제거한다면 latency 개선은 의미를 보존하지 않은 것입니다. 과거 `1.0.0` 이전 budget benchmark는 격리된 291-file fixture에서 동일한 4,000-token task Capsule을 두 번 6.5–7.2초 만에 compile했지만, 이전의 file별 traversal path는 약 3분 안에 끝나지 않았습니다. 현재 Compiler는 임의의 4,000-token input을 거부하고 위에서 설명한 고정 32K–512K tier만 받습니다. 과거 fixture identity와 latency는 Capsule identity 외부의 운영 개발 증거로 남으며, target-project context나 현재 acceptance command가 되는 일은 없습니다.

Runtime observation에는 지시 권한도 제어 권한도 없으며 provider session을 hydrate하지 않습니다. Temporal graph node와 edge는 canon, 지시 또는 승격 권한이 없는 재구축 가능 증거로 남습니다. `ProductContext`는 사용자가 소유한 Product Canon과 현재 명시적으로 검토된 Feature mapping 및 Change impact의 파생 projection이며, 어떤 source도 변경할 수 없습니다. 현재 ChangeSet에 명시적 VCS attachment가 있으면 bounded product traversal은 depth 3에서 `MATERIALIZED_AS`와 `REFERENCES`를 따라 간결한 `VcsEvidence`와 `GitCommit` observation에 도달할 수 있습니다. commit content는 계속 `evidence-not-instruction`이며 Decision이 되지 않습니다. 일반 Context compilation은 onboarding, mapping, impact, DocumentChangeCandidate, document-review, application-receipt, benchmark 또는 latency surface를 절대 opt-in하지 않습니다. Prepared traversal cost 증거와 timing diagnostic은 Capsule identity나 selection에 들어갈 수 없습니다. Deterministic Markdown은 사람 대상의 활성 GraphSnapshot projection이지만 생성된 page는 Context 증거로 다시 ingest되지 않습니다. 명시적 document review는 별도의 user-authorized command를 통해서만 Product Canon을 갱신할 수 있으며, Context Compiler는 그 결과인 검증된 현재 그래프만 사용합니다. 현재 semantic graph, Symbol extraction과 mapping 기반 impact inference는 AST 수준으로 정확하지 않은 heuristic입니다. Feature mapping 의미는 범위가 제한된 provider HEAD 제안에서만 오며, Core는 그 판단을 어휘 중복으로 대체하지 않습니다. 추론된 commit matching, 일반 candidate promotion, Git evidence에서의 structured decision inference 및 supersession, live runtime probing/control, cross-repository resolution, Obsidian/Notion projection, ArcadeDB 이외의 graph transport와 실행된 live prepared-query evaluation은 명시적 Unknown으로 남습니다.
