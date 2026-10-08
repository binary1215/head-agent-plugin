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

기본 compact 결과는 node 8개·edge 12개를 선택하고 identity, revision/state,
provenance와 coverage를 보존하면서 반복되는 큰 payload를 생략합니다.
원본 상세와 관계가 필요하면 반환된 anchor에 `details: true`를 지정합니다.
상세 기본값은 node 60개·edge 120개이며 명시적 한도로 양쪽 뷰를 확대할 수 있습니다.
짧은 응답은 task의 충분성을 증명하지 않습니다.

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

## 통합 변경 뒤의 증거 갱신

의미 있는 코드 수정이나 기능 추가 구간이 끝나면 HEAD는 통합 결과의 그래프 갱신
필요를 확인합니다. 수정 파일뿐 아니라 추가·변경·삭제·이름 변경과 관련 참조·import·call도
살핍니다. worker는 변경, 원본 근거와 미확인을 반환하고 HEAD가 최종 checkout을
조정한 뒤 갱신과 검증을 책임집니다. worker마다 무조정 전역 갱신을 수행하지 않습니다.

| 기존 surface | 수행하는 일 | 수행하지 않는 일 |
| --- | --- | --- |
| `head_project_graph_index` / `graph-index` | 기존 검증 기록·관측의 교체 가능한 목록 색인을 갱신하고 동일 입력은 재사용합니다 | 저장소의 새 코드 관계를 추출하거나 기능 의미를 추론하지 않습니다 |
| `world-refresh` | 이미 활성화된 World의 지원 코드 관계와 리비전 근거를 갱신합니다 | 없는 Product/World 기능을 활성화하거나 승인을 만들지 않습니다 |
| `head_world_model`, `head_incremental_refresh_status`, `head_world_query` / `world-query` | 최신성·갱신 근거 또는 제한된 영향 관계를 읽습니다 | World 갱신을 실행하지 않습니다 |

Core 초기화·재개와 지원되는 원본·관측 저장 경로는 이미 관측 색인을 갱신합니다.
충분히 최신인 결과는 재사용합니다. 관련 새 기록·누락 기록이나 통합 조정에 필요하면
명시적 색인을 사용하되 매번 저장 후 수행하는 의식으로 만들지 않습니다. 후속 작업에
기존 World 관계가 필요할 때 현재 갱신은 설정된 소스 범위의 **전체 eligible 파일**을
발견하고 읽어 해시하며, 변경 없는 의미 분석을 재사용한 뒤 현재 파일 집합 기준으로
지원 관계를 재계산합니다. 변경 파일만 읽는 방식이 아닙니다. 수정하지 않은 호출자의
대상도 새로 연결되거나 사라질 수 있습니다. 제외 범위, 분석기 지원·신뢰도, 미해결
import·call과 다른 미확인은 보존합니다. 이름 변경은 삭제·추가로 관측될 수 있으며
이름 일치만으로 의미적 동일성이나 검증된 이름 변경 계보를 만들지 않습니다.

HEAD는 기능 목적·요구사항, 구현과 실제 검증을 기존 소스 문서, 사용자 방향, 코드 참조와
해당 관측·결과·후보 기록으로 연결합니다. 원본 경로, digest·revision과 승인 상태를
유지합니다. 테스트 존재는 PASS가 아닙니다. 실행에는 실제 명령, 검증한 기준, 결과와
불확실성이 필요합니다. 일반 문서, 대화나 실행 성공을 색인한다고 Product Canon이나
승인이 자동 생성되지는 않습니다. 기존의 정확한 사용자 검토 절차는 그대로 유지합니다.
현재 사용자 방향은 참조하며 기능 설명을 저장하려고 P2 방향을 기록하지 않습니다.
기존 그래프 스키마는 지원 참조를 투영하며 임의의 문장을 자동으로
기능→코드→테스트의 타입 관계로 바꾸지 않습니다. 지원하지 않는 연결은 원본에 남기고
미투영 범위를 공개합니다. 후속 작업에 필요한 지속 근거만 보존하며 매 수정마다 새
필수 양식, Run이나 기록을 만들지 않습니다. 기존 활성·불명 실행 계약도 유지됩니다.
그래프 갱신이 digest-bound 입력을 다시 쓰거나 다른 효과를 승인하지 않습니다.

```text
head-agent graph-index <project>
head-agent world-refresh <project>
head-agent world-query <project> --query "<affected symbol>" --depth 3 --limit 20
```

관련된 경로만 사용합니다. World/DB 활성화, 전체 재색인, Run/Capsule, watcher 설치나
일상적인 사용자 승인은 일반 작업의 필수 절차가 아닙니다. 갱신 실패 시 해당 미반영
경로·기록과 불확실성을 남기고 현재 원본을 확인하며 독립 작업을 계속합니다. 보존된
옛 그래프는 과거 근거이지 새 코드가 반영됐다는 증명이 아닙니다. 이 완료 지침은
기존 기능을 활용하는 것이며 새 자동 Host lifecycle hook의 구현이 아닙니다.

대표 확인은 작업에 맞게 선택하며 한 묶음의 필수 체크리스트로 만들지 않습니다.
수정은 현재 원본 근거와 지원 이웃 관계를 바꾸고, 새 기능은 목적·구현·테스트 참조를
연결하되 실제 실행 결과를 별도로 확인합니다. 삭제·이름 변경은 과거 자료를 지우지
않으면서 오래된 현재 관계를 제거하고, 병렬 통합은 최종 기준을 갱신합니다. 갱신
실패는 원본 보완이 가능한 상태에서 미반영 범위로 남깁니다.

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
