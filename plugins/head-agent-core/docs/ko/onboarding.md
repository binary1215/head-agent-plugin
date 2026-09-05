# 프로젝트 온보딩

[영어 원문](../onboarding.md)

이 계약을 변경하기 전에 [`architecture.md`](architecture.md)와
[`authority-plane-contract.md`](authority-plane-contract.md)를 읽으세요.
온보딩은 제품 권한을 부트스트랩할 뿐이며, 저장소 구조, 모델 추론, Git,
GraphDB, 검증 fixture 또는 provider 대화에 권한을 부여하지 않습니다.

## 상태와 권한

이제 초기화는 다음을 생성합니다.

- `.head/sessions/records/` 아래의 변경 불가능한 프로젝트 범위 `HeadSession` 레코드
- digest가 검증된 `.head/onboarding/current.json` 상태 포인터
- 변경 불가능한 로컬 기본값 `OnboardingStorageSelection`
- 비어 있으며 사용자가 소유하는 `.head/context/product-model.json` Canon

HEAD Session identity는 Claude Code, Codex, OpenCode 및 다른 모든 provider 대화 ID와
독립적입니다. 이전에 초기화된 프로젝트는 읽기 전용 검사에서 `migration_required`를
보고합니다. 다음 변경형 온보딩 명령은 기존 Session ID와 Product Model identity를
보존하면서 누락된 Session 레코드, 로컬 저장소 선택 및 상태 포인터를 생성합니다.

상태 포인터 protocol `0.2.0`은 가장 최근 결정을
`latestReviewDecisionId`로 명명합니다. 호환성 필드가 `reviewDecisionId`인
digest 유효 `0.1.0` 포인터는 계속 읽을 수 있으며, 이후의 명시적 상태 전이가 있을
때만 다시 작성됩니다. 후속 candidate는 자신을 생성한 `revise` 결정을 별도로
`producerReviewDecisionId`로 명명합니다. 그 후속 candidate가 수락되거나 거부된
뒤에는 producer와 latest review가 의도적으로 서로 다릅니다.

상태 머신은 다음과 같습니다.

```text
initialized
  -> explicit World Model index
  -> awaiting-review | awaiting-evidence | ready(existing canon)
  -> revise -> successor immutable candidate set -> awaiting-review
  -> reject -> rejected
  -> accept-all | accept-selection
       -> new Product Model revision
       -> new child SourceSnapshot and verified GraphSnapshot
       -> ready
```

Fresh HEAD semantic proposal과 user-owned brief는 `instructionAuthority: false`와
`promotionAuthority: false`를 지닌 `OnboardingCandidateSet` evidence를
생성합니다. Core는 symbol name, repository path, README heading 또는 lexical rule에서
product meaning을 추론하지 않습니다. 제안된 source path, digest, line, optional symbol,
Product Model reference와 resource bound를 현재 World Model에 대조해 검증합니다.
`decisionScope: "product-canon-bootstrap"`인 명시적
`ReviewDecision`만 Product Canon을 작성할 수 있습니다. candidate는 절대 변경되거나
라벨이 바뀌지 않습니다. revision은 새로운 identity를 가진 후속 candidate를 생성하며,
수락은 별도의 Canon과 변경 불가능한 decision receipt를 생성합니다.

Candidate protocol `0.4.0`은 project, Session, mode, 정확한 SourceSnapshot,
Product Model input, bounded semantic proposal, 검증된 Evidence, Unknowns, ancestry,
producer ReviewDecision 및 producer policy로부터 candidate-set identity를 도출합니다.
파생 World Model ID는 materialized-view pointer에 authority review를 결합하지 않도록
제외합니다. 폐기된 lexical-inference protocol의 candidate set은 거부하며,
현재 SourceSnapshot에 결속된 fresh HEAD semantic proposal로 다시 만들어야 합니다.

## 공개 initialize 및 resume 경로

권장되는 사용자 대면 경로는 Codex 또는 OpenCode 대화 안에 번들된
`head-agent-onboarding` Skill입니다. 먼저 읽기 전용 `head_onboarding_guide`
tool을 호출하고, 해결되지 않은 중요한 선택지만 질문한 다음, typed MCP operation을
통해 동일한 Core를 호출합니다.

- idempotent project 및 HEAD Session 구성을 위한 `head_project_initialize_or_resume`
- 명시적이며 evidence-linked candidate 결정을 위한 `head_onboarding_review`
- 파생되고 복구 가능한 문서 view를 위한 `head_markdown_projection_build`

Skill은 두 번째 온보딩 protocol을 만들지 않습니다. provider HEAD는 현재 repository
evidence를 검사하고 typed `semantic_proposal`을 작성할 수 있지만, Core가 이를 검증하고
gate하며 사용자가 여전히 ReviewDecision을 소유합니다. Skill은 사용자 ReviewDecision을 추론하거나,
source scope를 넓히거나, GraphDB credential을 저장할 수 없습니다. MCP를 사용할 수
없다면 아래 CLI가 동등한 복구 및 자동화 surface입니다.

주요 공개 명령은 프로젝트 생성 또는 검증, 설치 projection convergence,
온보딩 시작 또는 재개를 구성합니다.

```powershell
node scripts/head.mjs init C:\path\to\project --runtime claude,codex,opencode --input .\onboarding.json
node scripts/head.mjs resume C:\path\to\project --runtime claude,codex,opencode
```

첫 번째 명령은 프로젝트 범위 HEAD Session을 정확히 하나 생성하고 온보딩을
시작합니다. 반복 실행은 기존 project/runtime binding을 검증합니다. 대기 중인
candidate review 또는 준비된 Product Canon은 온보딩 포인터를 다시 쓰거나 중복된
authority artifact를 만들지 않고 반환됩니다. plugin upgrade 후에는 drift가 없는
관리형 OpenCode configuration만 검증된 새 release path로 converge합니다. 사용자가
수정했거나 소유권이 없는 configuration은 fail-closed 방식으로 실패합니다.

설치 중에도 같은 경로를 호출할 수 있습니다.

```powershell
.\scripts\install.ps1 --project C:\path\to\project --runtime claude,codex,opencode --onboarding-input .\onboarding.json
```

## 저수준 온보딩 재시작

이미 초기화된 프로젝트는 다음 저수준 명령으로 `initialized`,
`awaiting-evidence` 또는 `rejected` 온보딩 단계를 명시적으로 다시 시작할 수 있습니다.

```powershell
node scripts/head.mjs onboarding-start C:\path\to\project
node scripts/head.mjs onboarding-status C:\path\to\project
```

기존 프로젝트는 코드와 문서를 먼저 index합니다. user brief나 fresh HEAD semantic
proposal이 없으면 온보딩은 명시적 Unknown과 함께 `awaiting-evidence`에서 멈추며,
코드 어휘로 product concept를 만들어 내지 않습니다. proposal은 최대 200개의
candidate를 담고 candidate마다 현재 source citation 1~8개를 가져야 하며, 전체 set은
evidence record 250개와 Unknown 100개로 제한됩니다. citation은 정확한 project-relative
path와 유효한 line을 명시하고, 정확한 indexed symbol 및 optimistic freshness guard인 digest를 선택적으로 추가할 수 있습니다. Core는 항상 검증된 현재 World digest를 직접 결속합니다.
stale, hallucinated, scope 밖, 과대 또는 구조적으로 잘못된 proposal은 fail closed됩니다.
유효한 proposal도 명시적인 user review 전까지 P3 candidate evidence입니다.

### 저장소 source scope

indexing 전에 사용자는 프로젝트 상대적인 observation boundary를 저장할 수 있습니다.
비어 있는 `includeRoots`는 적격 저장소 전체를 의미하며, `excludeRoots`가 항상 우선합니다.
Root는 glob이 아니라 정규화된 path이며, 선택은 instruction 또는 promotion authority가
없는 content-derived evidence입니다.

```json
{
  "includeRoots": [],
  "excludeRoots": [".omo", "bundled-third-party", "generated-copy"]
}
```

첫 index 전에 boundary가 존재하도록 이 object를 공개 `init --input` document 안의
`sourceScope`로 제공하세요. 저수준 `source-scope-set` command는 초기화된 project에서
명시적 `onboarding-start` 전에, 또는 이후 검토를 거친 rescan에 계속 사용할 수 있습니다.
정확한 scope identity는 `RepositoryScanResult` 및 World Model source digest에
포함됩니다. 이후 scope 변경은 기존 index를 stale 상태로 만들며, Product Canon 또는
수락된 Capsule을 절대 수정하지 않습니다.

새 프로젝트 brief는 review 전까지 candidate로 남으면서 Product Model entity schema를 사용합니다.

```json
{
  "mode": "new",
  "brief": {
    "schemaVersion": 1,
    "name": "Message service",
    "summary": "Deliver messages with explicit verification.",
    "featureGroups": [
      {
        "key": "group:communication",
        "name": "Communication",
        "description": "User-facing communication.",
        "parentFeatureGroupKeys": []
      }
    ],
    "capabilities": [
      {
        "key": "capability:delivery",
        "name": "Delivery",
        "description": "Deliver one accepted message."
      }
    ],
    "features": [
      {
        "key": "feature:direct-message",
        "name": "Direct message",
        "description": "Send one message to one recipient.",
        "featureGroupKeys": ["group:communication"],
        "capabilityKeys": ["capability:delivery"],
        "governedBy": []
      }
    ],
    "requirements": [],
    "constraints": [],
    "decisions": []
  }
}
```

```powershell
node scripts/head.mjs init C:\path\to\project --input .\onboarding-start.json
```

Product Canon에 이미 승인된 entity가 있는 프로젝트는 candidate bootstrap을 건너뛰지만,
계속해서 implementation evidence를 index하고 Product Model projection을 검증한 뒤
`ready`에 진입합니다.

## 저장소 선택

로컬 materialization은 완전하며 기본값입니다. ArcadeDB는 필수 전제 조건으로 만들지 않고 선택할 수 있습니다.

```json
{
  "mode": "existing",
  "storage": {
    "mode": "graphdb",
    "endpoint": "https://graph.example.test",
    "database": "head",
    "secretReferenceNames": {
      "username": "HEAD_GRAPHDB_USERNAME",
      "password": "HEAD_GRAPHDB_PASSWORD"
    }
  }
}
```

endpoint, database 및 environment-style secret-reference name만 저장됩니다. 내장 URL
credential, password/token field 및 credential value는 거부됩니다. 변경 불가능한
selection은 선택 시점의 상태를 `pending-unverified-adapter`로 기록하며, 온보딩은 이를
명시적으로 공개하면서 로컬 JSON을 통해 계속됩니다.

첫 current GraphSnapshot이 생긴 뒤, 대화 밖에서 참조된 두 environment variable을
주입하고 host를 재시작하여 plugin process가 이를 상속하게 하세요. 정상 대화 경로는
먼저 `head_graphdb_connection_preflight`를 호출합니다. 이 exact-child check는 network
request를 수행하지 않으며, 구성된 reference name과 각각의 존재 여부 boolean만
반환합니다. credential, endpoint 또는 database value는 절대 반환하지 않습니다. 두
reference가 모두 있으면 Skill은 `head_graphdb_database_status`를 호출하고, 명시적 사용자
확인을 받은 다음 `head_graphdb_database_initialize`를 호출하며, 별도의 remote-write
확인을 받고 `head_graphdb_projection_activate`를 호출합니다. 이러한 typed MCP operation은
confirmation과 exact-target reset evidence는 받지만 credential value는 절대 받지
않습니다. 동등한 recovery/automation CLI는 `world-graph-remote-database-status`,
`world-graph-remote-database-initialize`, `world-graph-remote-activate`입니다.

관련 없는 기존 schema는 compatible하며 보존됩니다. Reset은 HEAD-reserved type과의
충돌이 입증된 경우에만 사용할 수 있고, MCP를 통해 `reset_incompatible: true`와 정확히
선택된 database가 필요하거나 CLI를 통해
`--reset-incompatible true --confirm-database <exact-selected-name>`이 필요합니다.
Activation은 검증되고 재개 가능한 GraphSnapshot delta를 upload하고, local adapter와
비교하여 완전한 reconstruction 및 bounded traversal equality를 입증한 다음,
exact-predecessor compare-and-swap으로 remote pointer를 전진시키고 별도의
content-addressed activation 및 sync receipt를 저장합니다. `world-graph-remote-status`,
`head_graphdb_projection_status`, `head_graphdb_database_status`는 credential 또는
target value를 노출하지 않고 operational state를 보고합니다. initialization 또는
activation 실패 시 완전한 local graph mirror가 recovery path로 남으며 Product Canon을
승격할 수 없습니다.

## 일괄 review

`onboarding-status` 또는 `onboarding-candidates`로 current candidate set을 읽으세요.
Review input은 정확한 current `candidateSetId`를 명시해야 합니다. stale source,
Product Canon drift, candidate tampering 또는 다른 set이면 fail-closed 방식으로
실패합니다.

모든 candidate를 수락합니다.

```json
{
  "candidateSetId": "onboarding-candidates-<24-hex>",
  "disposition": "accept-all",
  "rationale": "Adopt the reviewed bootstrap batch."
}
```

dependency-complete selection을 수락합니다.

```json
{
  "candidateSetId": "onboarding-candidates-<24-hex>",
  "disposition": "accept-selection",
  "acceptedCandidateIds": ["onboarding-candidate-<24-hex>"],
  "rationale": "Adopt only the reviewed capability."
}
```

Canon을 변경하지 않고 candidate를 수정합니다.

```json
{
  "candidateSetId": "onboarding-candidates-<24-hex>",
  "disposition": "revise",
  "userEdits": [
    {
      "candidateId": "onboarding-candidate-<24-hex>",
      "entity": {
        "key": "capability:delivery",
        "name": "Verified delivery",
        "description": "Deliver and verify one accepted message."
      }
    }
  ],
  "addedEntities": [],
  "removedCandidateIds": [],
  "rationale": "Use reviewed product language before promotion."
}
```

`revise`는 이전 set 및 그 producer ReviewDecision에 연결된 새로운 변경 불가능한
candidate set을 생성합니다. 이후의 수락 또는 거부는 그 후속 candidate에 대해 별도의
latest ReviewDecision을 기록하며, 두 identity가 일치할 필요는 없습니다. 추가와 제거에는
이 두 단계 review 경로가 필요합니다. 같은 결정에서 항목을 도입하고 승격할 수는 없습니다.
`reject`는 모든 candidate를 rejected로 기록하고 Product Canon을 변경하지 않습니다.

```powershell
node scripts/head.mjs onboarding-review C:\path\to\project --input .\onboarding-review.json
node scripts/head.mjs onboarding-review-read C:\path\to\project --review onboarding-review-decision-<24-hex>
```

## 승격과 복구

수락은 stable key와 reference를 검증하고 충돌을 거부한 뒤, 명시적 P1 ReviewDecision,
이전·결과 Product Model의 변경 불가능한 revision 순으로 기록합니다. 그 다음 Canon과
온보딩 pointer를 게시합니다. Graph 재구축은 이후에 수행하며 승인을 만들거나 취소할
수 없습니다. 공개 준비도는 승인된 identity의 current digest-verified projection이
있어야만 `ready`가 됩니다.

게시 중 중단되면 읽기 전용 status는 상태를 복구하거나 일반 Core 작업을 막지 않고
`promotion_recovery_pending`을 표시합니다. Product resume 또는 정확히 같은 재시도는
검증된 ReviewDecision과 revision으로 이미 승인된 전이를 완료합니다. 누락된 revision은
정확히 승인된 candidate·edit와 검증된 이전 Canon으로만 재구축하고 결과 hash가
해당 결정과 일치하는지 확인합니다. 사용자에게 중복
검토를 요구하지 않습니다. 다른 내용의 재시도, 변조된 revision, 무관한 현재 Canon은
승인된 결정이나 더 새로운 상태를 덮어쓸 수 없습니다. Graph 재구축만 실패하면
`onboarding_approved_projection_pending`으로 승인을 보존하고 남은 projection 작업을
알립니다. 부분 graph는 파생 증거이며 복구 권한이 아닙니다. 재시도마다 별도의
transaction artifact를 만들지 않습니다.

이후 source 변경은 과거 온보딩 결정을 지우지 않습니다. current World Model이 stale이거나
온보딩을 완료한 snapshot보다 앞서 나간 경우, 읽기 전용 status는 `ready_world_changed`를
보고합니다. 그러면 정상 World Model refresh 및 HEAD drift handling이 execution context가
어떻게 전진할지 결정해야 합니다.

읽기 전용 MCP tool `head_onboarding_status`는 state pointer, Session record, storage
selection, current candidate set, successor-producing ReviewDecision, 최신 phase-appropriate
ReviewDecision, Product Model revision, Product Canon identity 및 World Model freshness를
검증합니다. review 대기 중인 후속 candidate에서는 producer도 latest decision입니다.
`ready` 또는 `rejected`에서는 latest decision이 current successor를 직접 review하고
일치하는 acceptance 또는 rejection disposition을 가져야 합니다. 별도의
`head_onboarding_review` transaction은 정확한 current candidate-set identity에 대한
사용자 작성의 명시적 disposition만 수락하고, 모든 promotion check를 Core에 위임합니다.

## Temporal graph projection

World Model `0.14.0`은 bounded immutable onboarding artifact를 계속 load하고, 모든
nested content identity를 검증한 뒤, onboarding projection protocol `0.1.0`을 거쳐
P4 temporal provenance protocol `0.11.0`으로 project합니다. Candidate set은 정확한
source evidence와 연결되고, candidate는 Evidence 및 별도의 proposed product-concept
reference와 연결되며, ReviewDecision은 accepted, rejected, revised 및 promotion outcome을
보존합니다. revise decision에는 후속 candidate set으로 향하는 명시적 `PRODUCES` edge가
있습니다. 이후 accepted decision은 변경 불가능한 previous/resulting ProductModelRevision
receipt에 별도로 연결되고, resulting receipt는 promoted candidate identity로 다시
연결됩니다.

이 graph는 audit 및 traversal projection이지 decision source가 아닙니다. source
ReviewDecision이 사용자의 promotion authority를 기록하더라도 project된 모든 node와 edge의
instruction/promotion flag는 false입니다. 정상 traversal은 CandidateSet, candidate,
Evidence, Unknown 및 proposed-concept node를 숨깁니다. 사용자는
`world-temporal --include-candidates true` 또는 MCP
`include_unreviewed_candidates: true`로 이를 명시적으로 검사할 수 있습니다. Context
Compiler는 이 option을 절대 활성화하지 않습니다. review된 decision 및
ProductModelRevision receipt는 정상 reviewed traversal에서 계속 사용할 수 있습니다.

다음 명령으로 dependency-free verifier를 실행하세요.

```powershell
npm run verify:onboarding
```

이 verifier는 기존 코드, 새 프로젝트 brief, 빈 evidence, revision 후 acceptance,
selection 또는 rejection, phase-aware producer/latest review lineage, deterministic restart,
candidate/review/promotion graph projection, 기본 candidate exclusion, 명시적 candidate
traversal, graph 및 artifact tampering, pre-existing canon, stale source, secret rejection,
legacy migration, 읽기 전용 status MCP, 그리고 Git, GraphDB 또는 Go binary 없이 작동하는
경우를 다룹니다. `npm run verify:conversational-onboarding`은 typed conversation-native
`revise -> guide -> accept -> guide` vertical을 별도로 입증합니다.

## 명시적으로 연기됨

- 실행된 live prepared-query evaluation, compare-and-swap publication 및 non-ArcadeDB transport
- 명시적 structured brief 범위를 넘어서는 dedicated imported-backlog connector
- 별도의 Feature/code/test mapping review scope를 넘어서는 general relationship promotion
- automatic semantic promotion, document synchronization 및 merge/conflict resolution
