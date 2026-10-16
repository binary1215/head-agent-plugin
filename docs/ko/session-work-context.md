# Session 작업 맥락과 Host 연속성

> [영문 원문](../session-work-context.md)

[한국어](session-work-context.md)

일반 조사와 직접 수정에는 Run이나 저장 의식이 필요하지 않습니다. HEAD는
의미 있는 인계·맥락 유실 경계에서 필요한 내용을 보존하고, 같은 논리 Session의
진입에서 선택된 원본을 다시 구성합니다. 전체 대화 복구나 저장하지 않은 내용의
무손실 보존을 보장하는 기능은 아닙니다.

## 무엇을 누가 보존하나요?

현재 공통 방향은 ProjectDirection이 소유합니다. Session 한정 목적·제약·취소는
기존 Session 목적과 최신 checkpoint의 명시적인 P2 방향에 남깁니다. 공유
Project 갱신이나 P3 메모로 대신하지 않습니다. 예를 들어 “로컬 조사만, 네트워크
금지”를 목적·명시 결정에 보존하고, 이후 checkpoint에서 이전 재작성 제안을
“재작성 취소, 설명만”으로 바꿀 수 있습니다. 다른 Session은 변하지 않습니다.
이 텍스트의 작성·해석은 HEAD의 몫이며 Core는 단어에서 승인을 추출하지 않습니다.
과거 결정이나 다음 단계는 현재 실행 권한이 아닙니다.

먼저 기존 checkpoint·결과·검토·소스 원본을 재사용합니다. 거기에 없는 판단 이유,
기각한 대안, 선택된 관찰, 미완료와 불확실성만 작은 Session 소유 P3 Evidence로
보완합니다. 과거 제안으로 복구 필드를 채우거나 작업을 승인할 수 없습니다.
기존 Evidence 평면의 하위 유형이지, 두 번째 방향 저장소·이력 문서·전역 기억 DB나
상주 서비스가 아닙니다.

## 가벼운 보존 경로

- checkpoint 동기화가 이미 유용한 경우 HEAD는 기존 `head_checkpoint_sync`
  요청에 선택적인 `work_evidence`를 함께 넣습니다. P2와 P3 결과는 별개입니다.
  stale·deferred checkpoint 때문에 근거가 방향으로 승격되지 않으며, 선택적
  근거 저장 실패가 유효한 명시적 P2 게시를 막지도 않습니다.
- checkpoint가 불필요한 의미 있는 작업에는 선택적 `head_session_work_record`
  한 번으로 Run 없는 맥락을 보존합니다. HEAD가 대화에서 필요한 항목만 작성합니다.
  사용자는 JSON·ID·저장 승인·Run·Capsule을 준비하지 않습니다.
- `head_conversation_enter`는 선택된 Session의 원본과 P2 방향을 현재 공통
  제약·취소와 함께 읽습니다. 쓰기는 없으며 선택적 근거의 누락·손상은 해당 계층만
  제한합니다.
- `head_session_work_read`로 정확한 원본, 생략된 기록이나 다음 조회 페이지를
  펼칩니다. 필요에 따른 확대이지 의무적인 도구 호출 순서는 아닙니다.

짧은 작업은 추가 기록을 만들지 않습니다. 동일한 선택 입력은 원본 바이트를
재사용하고, 정말 다른 반복 관찰은 HEAD가 사건 구분을 붙일 수 있습니다.
중복 제거는 효과 발생의 증명이 아닙니다. 다른 판단은 마지막 작성자로 덮지 않고
별도 근거로 남깁니다. 재시도는 저장만 보완하며 코드·provider·외부 효과를 반복하지
않습니다. 지원되는 보존 경계 전에 갑자기 종료되면 미저장 내용은 유실될 수 있습니다.

## 범위, 원본과 불확실성

작업 원본은 선택된 Session의 `work-evidence/` 디렉터리에 있습니다. 필수 index나
cache는 없습니다. 진입은 제한된 페이지를 읽고 그 안에서 기록 시각으로 정렬할 뿐
의미적 관련성이나 충분성을 판정하지 않습니다. 최초 선택은 최대 여덟 기록이며
뒤의 원본도 조회할 수 있습니다. 자동 정리·조용한 삭제·필수 전체 이력 스캔은 없습니다.

`max_characters`는 참조 상태를 추가한 뒤 실제 `JSON.stringify(records).length`를
계산하며 배열 구분자도 포함합니다. 별도의 제한된 메타데이터 봉투에 coverage·생략·
원본 ID·확대 안내를 담으며, 이 봉투는 기록 배열 예산에 포함하지 않습니다. 기본값은
32,768문자입니다. 직렬화 제한이지 토큰 추정이나 의미적 판정이 아닙니다. 큰 기록은
생략 사실을 공개하고 정확한 원본 조회로 계속 읽을 수 있습니다.

참조는 정확한 경로·바이트 digest·소스/아티팩트 구분을 보존합니다. 바이트 일치는
의미적 최신성이 아니며 다른 Session의 아티팩트는 근거일 뿐 목적이나 승인을
가져오지 않습니다. 변경·누락을 표시하고 경로·digest만으로 내용을 복구했다고 하지
않습니다. 손상된 원본 하나는 해당 항목만 제외하며 유효한 근거·P2 복구·독립 작업을
막지 않습니다. 진입 중 P2나 공통 방향의 변경을 감지하면 섞인 맥락을 폐기하고
HEAD가 의존하는 조회만 다시 하도록 합니다. 순차 읽기는 원자적 snapshot이 아니므로
모든 ABA 변경을 감지할 수는 없습니다.

## 식별자 추정 없는 Host 지원

`createSessionHostAdapter`는 신뢰된 embedding Host API입니다. Host가 실제 native
caller와 child의 검증된 별도 agent identity를 얻습니다. 명시적인 `select`는 정확한
논리 Session과 compare-and-swap revision을 검증한 뒤 Project Canon 밖에 P5 연결만
등록합니다. 중단된 pending 선택은 이전/default route가 아니라 미해결 상태로 남습니다.
재시작 후 public adapter가 연결을 읽고 `resolveSessionContext`가 기존 요청별 MCP
resolver에 전달합니다. native ID는 조회용 hash가 되며 canonical Session identity가
되지 않습니다. 읽기 호출에는 claim·receipt가 없습니다. 명시 공유·default 선택은
선택이지 최신 시각·이름·유일 후보 추정이 아닙니다.

선택 저장 실패는 현재 명시 요청의 성공을 취소하지 않습니다. 정확한 논리 route로
그 결과를 계속 쓰되 후속 연결은 미확인으로 표시합니다. 연결만 복구합니다.
어떤 intent도 저장되기 전에 저장소가 실패했다면 재시작으로 유실된 시도 자체를
발견할 수 없으므로, 기록되지 않은 상태에서 무손실 연속성을 주장하면 안 됩니다.

동봉된 `scripts/session-host-hook.mjs`는 SessionStart만 처리합니다. 신뢰된 Host API로
미리 등록된 연결을 조회하고 MCP 준비 전에도 제한된 읽기 전용 맥락을 반환합니다.
연결 생성·transcript 해석·메모 저장·방향 추론은 하지 않습니다. 시작 방향이 크면
조용히 잘라 쓰지 않고 원본을 펼쳐 읽어야 한다고 표시합니다.

| 경로 | 구현된 지원 | 중요한 한계 |
| --- | --- | --- |
| Core CLI/MCP | 정확한 논리 Session 기록 → 같은 Session 진입, 선택적 typed 확대 | native caller identity를 추론하지 않음 |
| 신뢰된 embedding Host | public 선택·등록 → 재시작 조회 → 요청별 resolver → 같은 Session | 실제 요청별 caller를 구분해 얻는 것은 Host의 책임 |
| Codex native MCP transport | 실제 요청의 `params._meta.threadId` → 기존 초기화·재개 선택 → P5 연결 → 요청별 resolver; 읽기 전용 SessionStart 조회 | 설치 엔진 `0.162.0-alpha.17.2` transport 확인; GUI 모델·fork/child·실제 재시작/압축은 별도 검증 필요 |
| stock Claude Code | 같은 서버의 PreToolUse 연결 → 기존 초기화·재개 선택 → P5 연결 → 후속 direct/router 요청 해석; 읽기 전용 SessionStart·재개 | 설치 CLI `2.1.289`와 합성 로컬 프로토콜로 부모·자식 분리 및 새 프로세스 재개 확인; 실제 모델·계정·압축은 별도 검증 |
| OpenCode | Core와 신뢰된 Host 연결 지점 | native Hook 통합은 주장하지 않음 |

Codex tool Hook는 child에도 부모 session ID를 제공하므로 그 필드만으로 caller 선택을
안전하게 등록할 수 없습니다. Codex 인자 수정에는 allow 결정도 필요해 routing에
사용하지 않습니다. 일괄 Hook 거절, 정상 경로의 거절·재시도, 승인 우회나 전역 MCP
selector를 넣지 않습니다. 선택적 연결 유실 후에도 정확한 명시 요청과 독립 Project
작업은 가능합니다.

### 어떤 작업이 선택을 유지하나?

기존 `head_project_initialize_or_resume`의 성공한 선택만 보존합니다. 첫 초기화는
검증된 default를 유지하며 명시 재개로 기존 Session을 공유·분리할 수 있습니다.
동일 선택 반복에는 쓰기가 없습니다. 별도 select/bind 도구, 사용자 ID 입력,
save 절차나 승인 결정을 추가하지 않습니다. Session 생성만 하거나 일회성으로
읽기·다른 Session에 증거/checkpoint 기록·worker 통합을 해도 채팅 선택은 바뀌지 않습니다.

기존 bootstrap 입력·identity 검증 뒤 선택적 P5 준비를 합니다. 실행 요청은 자신의
pending 상태에도 이미 검증한 route를 유지합니다. 짧은 CAS 구간이 전체 실행을
잠그지 않으며 앞선 완료가 새 intent를 덮어쓰지 않습니다. 검증된 pre-effect 실패만
이전 선택으로 정산할 수 있고 일반 오류·취소·timeout으로 효과 부재를 추정하지 않습니다.
unknown이나 재시작 후 live ticket 부재에서는 pending 불확실성이 남습니다. Host 저장
실패는 원래 Core 결과를 바꾸거나 효과를 재실행하지 않습니다. caller와 연결은 P5이지
P2 방향이 아닙니다.

같은 MCP process의 여러 caller도 각각 outer transport metadata로 라우팅합니다.
last-caller selector나 도구 인자의 `_meta`는 쓰지 않으며 embedding Host resolver가
우선합니다. 처음 연결하는 caller는 기존 default 의미를 유지하되 읽기에서 저장하지
않습니다. known lost/pending/corrupt 및 기존 namespace의 binding 유실은 default로
바꾸지 않습니다. namespace까지 완전히 삭제되면 그 과거 이력을 증명할 수 없습니다.
native metadata가 없는 legacy 경로는 자동 지속성을 주장하지 않습니다. native 전달을
관측한 뒤 그 값이 유실되면 관련 dependent 호출만 미확인이며 valid explicit 요청과
독립 Project 작업은 계속 가능합니다.

### 추가 승인 게이트 없는 Claude 요청 연결

동봉된 PreToolUse Hook는 이 플러그인의 Session 의존 도구와 범용 router만 대상으로
local 또는 plugin-scoped의 정확히 같은 MCP 서버를 호출합니다. 실제 `session_id`,
자식의 별도 `agent_id`, `tool_use_id`, outer 도구명과 원래 outer 인자를 전달합니다.
실제 일반 MCP 요청의 outer `claudecode/toolUseId`로 메모리 registry를 조회하고
인자의 정확한 digest를 검증한 뒤 router를 펼쳐 해당 caller만 해석합니다.
관측된 stock transport에서 모델 직접 호출·helper router 호출·중첩된 가짜 metadata·
치환되지 않은 template은 연결을 만들 수 없습니다. 이는 확인된 stock transport
연결 지점이지 임의 client를 인증하는 보안 수단은 아닙니다.

helper는 `{}`만 반환하며 `permissionDecision`, `updatedInput`, 논리 Session,
승인 또는 P2 방향을 전달하지 않습니다. 도구 권한은 기존 Host가 관리합니다.
독립 direct 도구의 추가 RPC는 0회입니다. 범용 router는 독립 inner 작업에도 내부
Hook RPC 1회를 추가하지만 곧바로 no-op입니다(registry·Session/P5 읽기·graph scan·
원본 쓰기 없음). 사용자 질문·binding 양식·Run·Capsule·저장 receipt·daemon은 없습니다.

대기 연결은 10분 후 만료되고 최대 1,024개이며 실행 중인 연결은 밀어내지 않습니다.
정확한 대기 재시도는 수명을 연장하지 않고 수렴하며 충돌·실행 중 재사용은 다른
caller를 대체하지 못합니다. claim은 `finally`에서 해제하고 transport 종료 시 cache를
비웁니다. 거절된 호출은 sweep·종료까지 메모리에 남을 수 있지만 호출별 영구 artifact는
아닙니다. bounded spent cache는 영구 replay 방지나 실행 lease가 아닙니다.
처음 온 Claude 요청도 일치하는 Hook가 없으면 의존 자동 route만 미확인으로 두고
default를 추정하지 않습니다. 정확한 명시 route와 독립 작업은 계속 가능합니다.
새 Project 초기화는 native 연결 성공을 주장하지 않고도 가능합니다. Hook 미활성화·
만료·선택적 저장 실패는 진단 공백이지 완료된 효과를 다시 실행할 이유가 아닙니다.
재개에는 같은 native chat·Project·operational binding 저장소가 필요하며 다른 PC로의
지속 연결을 의미하지 않습니다.

공식 계약: [Codex Hooks](https://learn.chatgpt.com/docs/hooks)와
[Claude Code Hooks](https://code.claude.com/docs/en/hooks).
소스·command fixture는 로컬 계약을 입증할 뿐 설치 Hook 신뢰·실제 provider 호출·모델
이해를 입증하지 않습니다. 패키지 설치만으로 Hook 실행이 증명되지는 않으며 실제
활성화와 계정·모델 시험은 별도입니다.
