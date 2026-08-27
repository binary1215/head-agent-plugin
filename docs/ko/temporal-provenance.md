[영어 원문](../temporal-provenance.md)

# Temporal provenance GraphSnapshot alpha

이 plane을 변경하기 전에 [`architecture.md`](architecture.md)와 [`authority-plane-contract.md`](authority-plane-contract.md)를 읽으세요.

## 목적과 권한

temporal provenance graph는 Git이나 GraphDB를 제품의 필수 조건으로 만들지 않으면서, 시간에 따라 사용자 소유 제품 의도, 불변 onboarding review 이력 및 관찰된 저장소 상태를 연결합니다. 이는 검증된 Product Canon, 불변 onboarding 아티팩트, 현재 지원되는 소스 스캔 및 명시적 parent ID에서 파생되는 결정론적이고 재구축 가능한 `GraphSnapshot`입니다. 이는 Context Compiler 순회를 위한 증거입니다. 그래프에 Canon, candidate 또는 review projection을 저장하더라도 그래프가 project canon, instruction authority 또는 promotion authority가 되지는 않습니다.

graph builder는 다음과 같은 제공자 중립적 입력만 사용합니다.

- 프로젝트 ID
- 정규화된 `.head/context/product-model.json` 콘텐츠와 그 evidence ID
- digest 검증을 거친 onboarding 아티팩트, FeatureMappingCandidateSets와 mapping ReviewDecisions, change-impact review 아티팩트를 갖춘 제공자 중립적 ChangeSets, Product Operating Loop 아티팩트 및 선택적 불변 VCS evidence attachment
- 정규화된 파일 경로, SHA-256 콘텐츠 digest, classification, language 및 추출된 symbol
- 0개 이상의 명시적 parent `SourceSnapshot` ID
- 안정적인 logical entity ID를 키로 하는 선택적 parent Revision ID 0개 이상

Evidence로만 사용되는 Git commit, branch, tag, GraphDB record ID, provider session ID, document-provider page ID, observation timestamp 및 line location은 필수 logical entity 및 ChangeSet ID에서 제외됩니다. 이를 포함하는 World Model에는 선택적으로 Git history가 별도로 들어갈 수 있습니다. temporal GraphSnapshot은 live Git state를 사용하지 않으며, 별도로 영속화되고 digest 검증을 거친 `VcsEvidence` attachment가 있을 때만 이를 사용합니다.

## Logical entity와 불변 revision

Temporal provenance protocol `0.10.0`은 [`AuthorityPlaneContract`](authority-plane-contract.md) 아래에 P4 재구축 가능 relation 및 retrieval index를 구체화합니다. digest가 유효한 `0.9.0` graph는 계속 읽을 수 있습니다. 새 graph는 successor creator property의 이름을 `producerReviewDecisionId`로 바꾸고 creator를 명시적 relation으로 projection합니다.

- 안정적인 product logical entity: `FeatureGroup`, `Capability`, `Feature`, `Requirement`, `Constraint`, `Decision`
- 불변 product state: 이에 대응하는 `*Revision` kind
- 안정적인 implementation logical entity: `Repository`, `File`, `Symbol`, `Test`
- 불변 implementation state: `FileRevision`, `SymbolRevision`, `TestRevision`
- temporal root 및 외부 ancestry reference: `SourceSnapshot`, `SourceSnapshotReference`, `RevisionReference`
- onboarding evidence 및 review history: `OnboardingCandidateSet`, `OnboardingProductCandidate`, `OnboardingEvidence`, `OnboardingUnknown`, `OnboardingReviewDecision`, `ProductConceptReference`, `ProductModelRevision`
- mapping review history: `FeatureMappingCandidateSet`, `FeatureMappingCandidate`, `FeatureMappingEvidence`, `FeatureMappingUnknown`, `FeatureMappingReviewDecision`, `ReviewedRelationship`, 과거의 `MappingEndpointReference`
- change lineage: `ChangeSet`, `ChangeRevisionReference`, execution-lineage reference, `ChangeImpactCandidateSet`, `ChangeImpactCandidate`, `ChangeImpactUnknown`, `ChangeImpactReviewDecision`, `ReviewedImpact`, 과거의 product reference
- 선택적 외부 change evidence: `VcsEvidence` 및 불변 `GitCommit` observation node. attachment가 없을 때는 이러한 node가 생략되며 ChangeSet을 절대 대체하지 않습니다.
- document review lineage: 숨겨진 `DocumentChangeCandidateSet` 및 `DocumentChangeCandidate` node와 일반적으로 표시되는 `DocumentChangeReviewDecision`, `DocumentProductModelRevision`, `DocumentChangeApplication` 및 과거 `DocumentProjectionReference` evidence
- product operating evidence: `ProductSignal`, `ProductHypothesis`, 숨겨진 `ProductInitiativeCandidate` 및 `ProductFeatureCandidate`, 과거의 `ProductFeatureReference`, 명시적인 `ProductInitiativeReviewDecision`, 별도의 `ReviewedProductInitiative` 및 execution-bound `OutcomeObservation` node

비영속적 `ProductLearningNote` 값은 절대 GraphSnapshot에 들어가지 않습니다. v0.2 Initiative candidate는 inline reasoning을 포함하면서 Feature resolution은 없을 수 있습니다. review 전까지는 `PROPOSES_TO` edge가 없고, 영속화된 hypothesis reference가 없으면 `PROPOSES_FROM` edge도 없습니다. 명시적 accept review는 별도의 reviewed Initiative에서 기존 Feature, Feature candidate 또는 정직하게 기록된 gap 중 정확히 하나를 해석합니다. candidate byte는 변경되지 않습니다.

Product logical ID는 project ID, entity kind 및 안정적인 user-owned key에서 파생됩니다. Feature의 이름을 바꿔도 logical ID는 보존되지만, 의미론적 편집은 새로운 FeatureRevision을 만듭니다. `File` ID는 project ID와 정규화된 path에서 파생됩니다. `Symbol` ID는 line number가 아니라 File ID, kind, name 및 결정론적인 same-name occurrence에서 파생됩니다. `Test` ID는 project ID와 path에서 파생됩니다. Revision ID는 logical ID, semantic state 및 정렬된 parent Revision ID에서 파생됩니다. 따라서 line을 이동해도 Symbol logical ID는 보존되지만 SymbolRevision은 변경됩니다.

`SourceSnapshot` ID에는 project, 완전하게 정렬된 현재 Revision set, ancestry-independent state digest, producer version 및 정렬된 0개 이상의 parent SourceSnapshots가 포함됩니다. 첫 번째 schema version부터 multiple parent가 지원됩니다. 이는 DAG shape만 기록하며, automatic merge, conflict detection, conflict resolution 및 ancestry fetching은 계속 유보됩니다.

## Provenance-complete projection

projection된 모든 node는 `nodeId`, `kind`, `authorityClass`, `origin`, 정렬된 `evidenceIds`, `freshness`, producer ID와 version 및 instruction/promotion authority boolean flag를 기록합니다. Snapshot-scoped node는 `sourceSnapshotId`도 기록하고, Revision node는 logical entity와 정렬된 parent ID를 기록합니다.

모든 edge는 `edgeId`, typed endpoint 및 `sourceSnapshotId`와 함께 동일한 authority 및 provenance surface를 기록합니다. Heuristic Symbol node와 relation은 numeric confidence를 포함합니다. 현재 구현된 relation subset은 다음과 같습니다.

- `CONTAINS`
- `REALIZES`
- `GOVERNED_BY`
- `HAS_REVISION`
- `CURRENT_REVISION`
- `PARENT_OF`
- `DECLARES`
- `REFERENCES`
- `PROPOSES_FROM`, `PROPOSES_TO`, `SUPPORTED_BY`
- `REVIEWED_BY`, `ACCEPTED_BY`, `REJECTED_BY`
- `PRODUCES` 및 `PROMOTED_FROM`. onboarding에서 `revise ReviewDecision -[:PRODUCES]-> successor CandidateSet`은 `accept ReviewDecision -[:PRODUCES]-> ProductModelRevision`과 구별됩니다.
- review를 거친 canonical `IMPLEMENTS` 및 `VERIFIED_BY` edge
- 제공자 중립적 `CHANGES` 및 `SUPERSEDES` lineage와 명시적으로 review를 거친 `IMPACTS` edge
- 선택적 `ChangeSet -[:MATERIALIZED_AS]-> VcsEvidence -[:REFERENCES]-> GitCommit` evidence link
- `SUPPORTED_BY`, `PROPOSES_FROM`, `PROPOSES_TO`, review/promotion relation 및 `OutcomeObservation -[:OBSERVES]-> ChangeSet|ReviewedProductInitiative`를 통한 product learning 및 observation

verifier는 digest mismatch, 지원되지 않는 node 또는 relation type, 중복 ID, 비결정적 순서, dangling 또는 invalid endpoint kind, 누락된 provenance, invalid authority flag, invalid confidence, scope mismatch 및 직접적인 self-parent cycle을 거부합니다.

## 결정론적 제한 순회

`queryTemporalProvenanceGraph`는 먼저 전체 GraphSnapshot을 검증한 다음 정규화된 `TraversalQuery`를 구성합니다. query는 다음을 기록합니다.

- node-kind, relation, authority-class 및 freshness allowlist
- minimum confidence
- CandidateSet, candidate, Evidence, Unknown, ProductConceptReference, ProductInitiativeCandidate 및 ProductFeatureCandidate node를 기본적으로 제외하고 명시적 `includeUnreviewedCandidates` opt-in 제공
- maximum depth, node count 및 edge count
- anchor ID 및 결정론적 순서

result는 graph, query 및 result ID와 hash, 선택된 node와 edge, inclusion reason, exclusion count 및 truncation을 기록합니다. 이후 backend가 이 algorithm을 가속할 수 있지만 allowlist를 넓히거나, semantic result의 순서를 바꾸거나, stale evidence를 허용하거나, digest를 변경해서는 안 됩니다.

## CLI 및 MCP

```text
node scripts/head.mjs world-index <project> --parent-snapshot <id,id>
node scripts/head.mjs world-index <project> --revision-parents <json-file>
node scripts/head.mjs world-temporal <project> --query <text> --kind File,FileRevision --relations HAS_REVISION,CURRENT_REVISION --depth 1 --limit 100 --edge-limit 200
node scripts/head.mjs world-temporal <project> --query <candidate-id> --kind FeatureMappingCandidate,FeatureMappingEvidence --include-candidates true --depth 1 --limit 100 --edge-limit 200
node scripts/head.mjs world-temporal <project> --query <change-set-id> --relations CHANGES,IMPACTS,SUPERSEDES --depth 3 --limit 200 --edge-limit 400
node scripts/head.mjs world-temporal <project> --query <change-set-id> --relations MATERIALIZED_AS,REFERENCES --depth 2 --limit 200 --edge-limit 400
```

`--revision-parents`는 key가 현재 logical entity ID이고 value가 parent Revision ID array인 JSON object를 읽습니다. read-only MCP tool `head_temporal_graph`는 `include_unreviewed_candidates`를 통해 동일한 제한 순회를 노출합니다. 둘 다 stale World Model을 거부합니다. ReviewDecision 및 ProductModelRevision receipt는 일반적인 reviewed traversal에서 계속 표시됩니다. unreviewed candidate surface에는 명시적 opt-in이 필요하며, opt-in하더라도 권한에는 영향을 주지 않습니다.

Context Compiler는 `GraphProjectionAdapter`를 통해 제한된 per-file temporal expansion을 수행하고 포함된 repository candidate에 GraphSnapshot, SourceSnapshot, TraversalQuery 및 traversal result digest를 기록합니다. Local JSON 및 in-memory adapter는 정확한 reference result를 반환해야 합니다. 결과가 없으면 이를 공개한 상태로 내장된 recoverable graph를 fallback으로 사용하지만, stale하거나 충돌하는 projection은 fail closed 처리됩니다. Adapter identity는 Capsule identity 바깥에 유지됩니다. [`graph-projection-adapter.md`](graph-projection-adapter.md)를 참조하세요.

active deterministic Markdown renderer는 indexing 후 `DocumentProjectionAdapter`를 통해 검증된 이 graph를 사용합니다. canonical edge direction을 보존하고, relation endpoint를 node page에 연결하며, 정확한 GraphSnapshot 및 SourceSnapshot ID를 기록합니다. 생성된 page는 human view일 뿐이며, 절대 Context Compiler input으로 다시 순회되지 않습니다. 편집된 page는 비권위적 `DocumentChangeCandidateSet` evidence가 됩니다. 명시적 review는 이후 child graph로 projection되며, application receipt가 실제 application outcome을 결합한 다음 그다음 audit child graph가 해당 receipt를 projection합니다. 이 two-stage boundary는 동일한 GraphSnapshot의 이름을 가진 receipt에 GraphSnapshot hash가 종속되는 문제를 방지합니다. Context Compiler는 document candidate surface를 opt-in하지 않습니다. [`document-projection-adapter.md`](document-projection-adapter.md) 및 [`document-change-review.md`](document-change-review.md)를 참조하세요.

## 유보된 경계

이 alpha는 아직 commit-to-ChangeSet matching, 프로젝트 전체 execution lineage 또는 model conformance를 추론하지 않으며, 구현된 review scope를 넘어 general candidate를 승격하지도 않습니다. Local/in-memory GraphProjectionAdapter 및 DocumentProjectionAdapter conformance boundary는 구현하지만 remote GraphDB, Obsidian 또는 Notion backend는 구현하지 않습니다. 명시적인 document-candidate review/application 및 이후 audit projection은 활성화되어 있지만 prose에서 product meaning을 절대 추론하지 않습니다. 또한 이 시스템은 여전히 parent revision이나 ChangeSet ancestry를 추론하거나, merge를 수행하거나, candidate를 자동으로 승격하거나, current-state pointer를 Canon으로 취급하지 않습니다.
