# 그래프 우선 탐색과 독립 Session

> 영어 원문: [graph-discovery.md](../graph-discovery.md)

## 일반 사용

사용자는 task를 한 번 말합니다. HEAD는 해당 논리 Session과 현재 공통 방향을
복구하고 새 정보 탐색 전에 가까운 프로젝트 관계를 조회합니다. 충분한 동일
기준 결과는 재사용합니다. 없거나 실패한 그래프 층은 원본 파일과 기록으로
보완합니다. 전체 World 갱신, Product 승인, Run/Capsule, 색인 완료나 DB는 일반
탐색의 시작 조건이 아닙니다.

작업 관점은 Session, 변경, 결과, 검토와 복구 기록을 연결합니다. Product 관점은
제품 목표, 요구사항, 결정과 원본 근거를 연결합니다. 같은 결정을 이중 저장하지
않고 공통 원본을 참조합니다. 현재·과거 리비전과 미승인·거절 자료의 ID와 상태는
관계 확장에도 유지됩니다. 경로는 출처·선후를 설명하며 그 자체로 원인을 증명하지
않습니다.

## 조회와 원본 보완

기본 typed MCP 진입점은 `head_project_graph`입니다. HEAD가 task에서
`project_root`, `query`를 작성하며 필요할 때 `anchor_ids`, `paths`, `depth`,
`max_nodes`, `max_edges`, `view` (`all`, `work`, `product`),
`world_model_id`, `previous_result`, `include_candidates`, `session_id`를
지정합니다. 한도는 전송 크기를 제한하며 의미적 충분성 판정이나 사용자 양식이
아닙니다.

자연어 질문은 권한 플래그나 리비전·출처 메타데이터가 아닌, 한정된 표시·도메인
값을 검색합니다. 일치하는 드문 용어를 우선 정렬하고 전송 한도를 적용합니다.
이는 재현 가능한 어휘 탐색이지 의미 추론이 아닙니다. 관련성과 부족한 맥락은
HEAD가 판단합니다. 구두점, 식별자 구성 단어, 한국어 조사 별칭으로 탐색을 돕되
원래 용어도 보존합니다. 필요한 정확한 경로·anchor는 HEAD가 작성하며 사용자가
질문이나 점수 양식을 다시 작성하지 않습니다.

```text
head-agent graph-query <project> --query "<task>"
head-agent graph-index <project>
head-agent session-list <project>
head-agent session-create <project> --purpose "<independent work>"
head-agent graph-query <project> --session <logical-session> --query "<task>"
```

`head_project_graph_index` / `graph-index`는 교체 가능한 기존 관측 색인을
명시적으로 갱신합니다. Core 초기화·재개와 원본·관측 저장 경로도 필요한 범위에서
갱신합니다. 입력이 같으면 재사용하며 조회마다 receipt, 후보, 승인이나 checkpoint를
만들지 않습니다.

결과의 기준·리비전, 무결성, 최신성, 확인 범위, 원래 상태와 출처를 함께 읽습니다.
온전한 과거 자료는 현재 효과를 승인할 수 없어도 근거로 활용할 수 있습니다.
손상·교차 Project 층만 제외하고 나머지 유효한 층은 계속 사용합니다. 빈 결과나
부분 결과는 사실 부재의 증명이 아닙니다. 반환된 원본 fallback을 사용하고 부족한
맥락만 확대합니다. 충분한 이전 결과나 동일 기준의 알려진 adapter 실패는 재호출
없이 재사용하고 관련 기준이 달라지면 다시 조회합니다. 현재 효과 검사는 별개입니다.

선택적 ArcadeDB는 활성 temporal-query 검증과 embedded fallback을 보존합니다.
공통 원본 조회는 Core/로컬에서 수행하며 전체 조회 가속을 주장하지 않습니다.
기존 prepared-traversal 가속은 별도 adapter 계약을 따릅니다. 로컬 색인과 원본
fallback은 계속 사용할 수 있습니다. 이번 소스·fixture 시험으로 새
실제 ArcadeDB, Host lifecycle이나 모델 행동 검증을 주장하지 않습니다. 속도,
token과 품질 개선은 측정 전까지 가설입니다.

경로만 지정한 요청은 검증된 보존 World의 논리 File anchor와 정확한 snapshot에
결속해 선택적 temporal adapter 검증을 수행합니다. 사용할 temporal 선택자가
없는 전체 둘러보기·Work 전용 anchor는 adapter 실패가 아닌 `not-used` 로컬
탐색입니다. 실제 adapter 실패의 사유와 동일 기준 fallback 재사용은 유지하며
어느 경로도 공통 전체 조회 가속을 주장하지 않습니다.

## 코드 영향과 기록 탐색의 구분

일반 `CONTAINS`, `HAS_REVISION`, `DECLARES` 경로는 기록·버전을 연결합니다.
이를 확대하는 것은 코드 영향 분석이 아닙니다. 심볼의 import·call 이웃은 기존
`head_world_query` 또는 다음 명령으로 조회합니다.

```text
head-agent world-query <project> --query "<symbol>" --depth 3 --limit 20
```

World 기능이 제공될 때 한정된 `IMPORTS`·`CALLS`를 조회합니다. HEAD는 기존
선택적 MCP 검색·호출 경로를 사용하므로 새 사용자 설정은 필요하지 않습니다.
World가 없거나 관련 소스가 stale이면 현재 소스의 import·call을 직접 조사합니다.
보존된 관계는 조사 단서이지 현재 영향의 증명이 아닙니다. 전체 World 갱신,
새 Run, Product 검토나 DB 활성화를 조사 게이트로 만들지 않습니다.

## 독립 진행 라우팅

하나의 정식 Project가 공통 사용자 방향을 보유합니다. 기존
`.head/sessions/current.json`은 기본 Session으로 유지하며 추가 Session은
`.head/sessions/by-id/<session-id>/current.json`에 저장합니다. MCP `session_id`,
CLI `--session`은 요청 대상만 선택하고 기본 Session을 바꾸거나 덮어쓰지 않습니다.
`head_session_list`가 논리 Session을 조회하며 `head_session_create`는 선택적
`new_session_id`와 `purpose`를 받습니다. 기존 ID를 다른 목적으로 다시 결속하지
않습니다. 공급자 session ID와는 별개입니다.

각 Session은 로컬 목적, 진행, 활성·불명 작업, 승인과 checkpoint를 유지합니다.
한 Session의 조사 범위 변경이 다른 task를 자동 변경하지 않습니다. 기존 기록을
제자리에 보존하므로 routing을 위해 다시 온보딩하지 않습니다.

## 현재 공통 방향

`head_project_direction_read` / `project-direction-read`는 현재
`ProjectDirection` 또는 기록 부재를 반환합니다. `input`에 `goal`,
`constraints`, `decisions`, `cancelledActions`를 담습니다. P2 현재 사용자
방향이며 실행 authorization을 주지 않습니다. 현재 실제 사용자 방향을
`head_project_direction_update`의 조회한 `expected_direction_id` (최초 null)와
`direction` 객체로 게시합니다. CLI는
`project-direction-update --input <direction.json> --expected-direction <id>`입니다.
HEAD가 대화에서 typed 입력을 작성하므로 사용자가 양식을 채우지 않습니다.

`.head/project-direction/current.json`은 불변 revision을 참조합니다. 정확한 기준
비교로 경합한 갱신을 조정하고 시각이나 마지막 쓰기로 의미 충돌을 해결하지 않습니다.
동일 갱신은 기존 방향을 재사용합니다.

그래프 방향 노드는 네 입력 필드를 한정된 `directionEvidence`로 표시하고
`directionContentCoverage`에 생략·잘림을 알립니다. 요약에도 원본 경로·리비전과
현재·과거 상태를 보존합니다. 필요하면 원본 전체 방향을 읽습니다. 부분 그래프
사본은 전체 방향이나 P2 복구 권위가 아닙니다. 옛 제약은 과거 근거이지 현재
공통 지시가 아닙니다.

복구는 정확한 과거 checkpoint 필드와 `currentProjectDirection`을 함께 제공합니다.
배포를 준비하던 Session을 복구했더라도 그 사이 사용자가 전체 Project 배포를
취소했다면 과거 위치를 보존하고 현재 취소를 효과 전에 적용합니다. 과거 기록을
고치거나 옛 권한을 되살리지 않습니다. 그래프의 승인된 결정 사본은 근거로 남으며
실행은 현재 권한과 관련 원본을 다시 확인합니다.

## 보존해야 할 반례

- 미승인·거절 이웃을 관계나 요약으로 승인하지 않습니다.
- 온전한 과거 리비전은 과거로 표시하고 손상과 구분합니다. 교차 Project·변조
  artifact는 단지 stale로 표시하지 않고 제외합니다.
- DB 조회 실패가 원본 코드 탐색의 Product 승인 조건이 되지 않습니다.
- Session 경합이 새 전역 current Session을 선택하지 않습니다.
- 공통 배포 취소는 과거 배포 checkpoint 복구 뒤에도 유지됩니다.
- 읽기 전용 탐색·진입은 방향, 승인이나 복구 기록을 게시하지 않습니다.
- worker 하나의 불명 효과는 확인하되 독립 작업을 막지 않습니다.

[권한 평면](authority-plane-contract.md), [Session 복구](session-recovery.md),
[런타임 구성](../../skills/head-agent-core/references/runtime-composition.md)을 참고하세요.
