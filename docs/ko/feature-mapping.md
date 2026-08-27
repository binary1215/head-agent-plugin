> 이 문서는 [feature-mapping.md](../feature-mapping.md)의 한국어판입니다. 코드, 명령, 프로토콜 식별자와 필드 이름은 원문 표기를 유지합니다.

# 검토 게이트가 적용된 Feature 매핑

이 권위 경계를 변경하기 전에 [`architecture.md`](architecture.md)와
[`authority-plane-contract.md`](authority-plane-contract.md)를 읽으세요.

## 계약

Feature 매핑 프로토콜 `0.1.0`은 코드 분석이 승인된 제품 관계를 만들어 내도록 허용하지 않으면서, 권위 있는 `Feature` 및 `Capability` 개념을 관찰된 `File`, `Symbol`, `Test` 엔터티에 연결합니다.

정규 방향은 다음과 같습니다.

```text
File or Symbol -[:IMPLEMENTS]-> Feature or Capability
Feature or Capability -[:VERIFIED_BY]-> Test
```

자동 추론은 불변 `FeatureMappingCandidateSet`만 생성합니다. 모든 `FeatureMappingCandidate`는 제안된 정확한 엔드포인트와 리비전, 원본 `GraphSnapshot`/`SourceSnapshot`, 생성자와 버전, 범위가 제한된 신뢰도, 설명, 콘텐츠 주소 기반 Evidence를 기록합니다. Candidate 및 Evidence 레코드의 지시 권위와 승격 권위는 false입니다.

사용자가 명시적으로 작성한 매핑 `ReviewDecision`은 모든 candidate를 수락하거나, 이름이 지정된 선택 항목을 수락하거나, 배치를 거부할 수 있습니다. 수락은 candidate를 변경하지 않습니다. 대신 candidate에는 `PROMOTED_FROM`으로, decision에는 `PRODUCES`로 연결된 별도의 `ReviewedRelationship` receipt를 생성한 다음, 검토된 정규 `IMPLEMENTS` 또는 `VERIFIED_BY` edge를 구체화합니다. 거부는 `REJECTED_BY`를 기록하며 정규 매핑 edge를 생성하지 않습니다.

매핑 검토는 Product Canon을 수정하지 않습니다. 추론 이후 저장소 evidence, Product Canon, 현재 candidate set 또는 콘텐츠 digest 중 하나라도 변경되었거나, Run이 활성 상태이거나 검토를 기다리는 동안에는 검토가 거부됩니다.

## 명령

```text
node scripts/head.mjs feature-mapping-start <project>
node scripts/head.mjs feature-mapping-status <project>
node scripts/head.mjs feature-mapping-candidates <project> --candidate-set <feature-mapping-candidates-id>
node scripts/head.mjs feature-mapping-review <project> --input <mapping-review.json>
node scripts/head.mjs feature-mapping-review-read <project> --review <feature-mapping-review-decision-id>
```

수락 입력 예시는 다음과 같습니다.

```json
{
  "candidateSetId": "feature-mapping-candidates-<24-hex>",
  "disposition": "accept-selection",
  "acceptedCandidateIds": ["feature-mapping-candidate-<24-hex>"],
  "rationale": "Reviewed repository and test evidence supports this product relationship."
}
```

`accept-all`은 `acceptedCandidateIds`를 무시하고, `reject`는 아무것도 수락하지 않습니다. CLI가 변경 표면입니다. MCP는 `head_feature_mapping_status`만 노출하며, `include_unreviewed_candidates`를 명시적으로 활성화하지 않는 한 일반 temporal traversal은 검토되지 않은 candidate 표면을 제외합니다.

## 저장 및 프로젝션

로컬 적합성 경로는 다음을 저장합니다.

```text
.head/feature-mappings/current.json
.head/feature-mappings/candidate-sets/feature-mapping-candidates-*.json
.head/feature-mappings/review-decisions/feature-mapping-review-decision-*.json
```

Candidate set과 ReviewDecision은 불변이며 digest로 검증되는 artifact입니다. `current.json`은 digest로 검증되는 workflow pointer일 뿐입니다. temporal graph와 World Model은 계속 재구축 가능한 프로젝션이며, Git과 GraphDB는 선택 사항이고 매핑 권위에 관여하지 않습니다.

이전에 검토된 엔드포인트가 사라지면 과거 receipt는 stale freshness 상태로 남고, 현재 정규 edge는 생략됩니다. 새 현재 매핑을 확립하려면 이후의 추론과 명시적 검토가 필요합니다.

## 추론 경계

초기 추론은 의도적으로 보수적이며 범위가 제한됩니다. 권위 있는 Feature/Capability의 key, name, description에서 정규화된 용어를 현재 저장소 path 및 관찰된 symbol name과 비교합니다. 일치 항목이 없으면 최대 개수가 제한된 집합과 명시적인 Unknown을 내보냅니다. 어휘 중복은 evidence이지 결코 증명이 아닙니다.

AST 수준으로 정확한 semantic mapping, change-impact candidate, 대량 사용자 편집/revision batch, 자동 mapping refresh, 일반적인 relationship-promotion 정책은 향후 과제로 남아 있습니다.
