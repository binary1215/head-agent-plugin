> 이 문서는 [role-coordination.md](../role-coordination.md)의 한국어판입니다. 코드, 명령, 프로토콜 식별자와 필드 이름은 원문 표기를 유지합니다.

# 공급자 중립적 영속 역할 조정

역할 조정은 정식 HEAD 프로젝트 역할인 `head`, `developer`, `coder`, `reviewer`를 위한
선택적 호스트 로컬 통신 평면입니다. 이는 Herdr, 공급자 세션, 창(pane), TUI를 HEAD 의미
식별자의 일부로 만들지 않으면서 원래 HEAD Core의 영속 받은 편지함, 멱등성, 불변 회신,
세대 차단막, 전달 분리를 채택합니다.

## 권한 경계

조정 메시지나 회신은 역할 사이에서 교환되는 증거입니다. 이는 지시 권한 부여,
`ExecutionAuthorization`, `ExecutionContract`, `ReviewDecision`, Product Canon 전환,
승격 또는 성공 판단이 아닙니다. 모든 메시지와 회신은 이 권한 플래그를 모두 false로
기록합니다. 선택적 레인 레이블은 주변 위험 맥락을 설명할 뿐 어떤 권한도 부여하지 않습니다.

역할 식별자는 `send`, `read-inbox`, `wait-reply`, `reply`에 제공할 수 없습니다. 신뢰할 수
있는 호스트나 관리자가 호스트 로컬 권한 세대를 열고, 검증된 직접 프로젝트 역할 하나에 대해
일회성 원시 `CoordinationRoleBinding` 토큰을 발급합니다. 토큰 해시만 저장됩니다. 각
엔드포인트는 `HEAD_AGENT_COORDINATION_BINDING_TOKEN` 환경 경계를 통해 원시 토큰을
받습니다. 도구 인수에는 `self`, `from_role`, 공급자 세션 식별자 또는 토큰이 들어가지 않습니다.

바인딩의 범위는 다음과 정확히 일치하는 대상으로 제한됩니다.

- 프로젝트 식별자;
- 정식 HEAD Session 식별자;
- 현재 호스트 로컬 조정 권한 세대;
- 직접 `.head/roles/<role>.md` 역할;
- 해당 역할의 현재 바인딩.

역할 바인딩을 교체하면 이전 토큰은 무효가 됩니다. 세대를 순환시키면 이전의 모든 바인딩이
무효가 되고, 호스트 로컬 레코드를 삭제하지 않은 채 이전 세대 받은 편지함을 새 권한 경계에서
숨깁니다.

신뢰할 수 있는 워크스페이스 호스트는 현재 바인딩을 새롭고 고유한 라이브 엔드포인트 하나에
추가로 연결할 수 있습니다. 연결 및 연결 해제는 공개 역할 도구가 아니라 호스트 구성 작업입니다.
연결 증거는 정확한 Project, HEAD Session, 세대, 역할, 현재 바인딩, 호스트 인스턴스,
워크스페이스, 탭, 엔드포인트, 터미널, 프로젝트 내부의 정식 CWD 및 런타임에 결속됩니다. 대상
레코드는 자체적인 추가 전용 해시/순서/이전 레코드 체인을 형성합니다. 바인딩 교체, 세대 순환,
연결 해제, 엔드포인트 유실 또는 대상 포인터 롤백이 발생하면 전달은 사용할 수 없게 되거나
fail-closed로 실패합니다. 이 중 어느 것도 이전 상태를 다시 활성화하지 않습니다.

## 상태 및 지속성

모든 메시지 본문, 역할 바인딩, 받은 편지함, 읽음 표식, 회신, 멱등성 레코드 및 전달 영수증은
런타임 실행 임대에서 사용하는 검증된 외부 운영 상태 루트 아래에 위치합니다.

```text
<operational-root>/role-coordination/v1/
  <project-id>/<head-session-id>/
    current-generation.json
    generations/
    generation-state/<generation-id>/
      bindings/
      requests/
      inboxes/
      reads/
      replies/
      deliveries/
      targets/
```

조정 평면은 `.head`, Product Canon, 실행 계보, GraphDB, Git 또는 공급자 대화 기록에 아무것도
쓰지 않습니다. 같은 호스트에서 프로세스가 재시작되거나 대상이 일시적으로 사용 불가능해져도
지속되지만, 프로젝트 복구 Canon은 아닙니다. 프로젝트를 다른 호스트로 옮기려면 명시적인 새
세대와 새 바인딩이 필요합니다. 토큰이나 공급자 세션 식별자는 의미론적 복구의 일부가 아닙니다.

## 작업

관리 작업은 계속 CLI/호스트 전용이며 `head help-all` 아래에 표시됩니다.

```text
head coordination-open <project>
head coordination-rotate <project>
head coordination-bind <project> --role <role>
head coordination-status <project>
```

bind 명령은 원시 바인딩 토큰을 한 번만 반환합니다. 이 토큰을 JSON 입력, 명령 인수, 프로젝트
파일, 프롬프트 또는 대화 기록에 넣지 말고 엔드포인트 환경에 주입하십시오.

역할용 CLI 작업은 다음과 같습니다.

```text
head coordination-send <project> --input <message.json>
head coordination-inbox <project> [--wait-timeout-ms <0..600000>]
head coordination-wait-reply <project> --message <message-id> [--wait-timeout-ms <0..600000>]
head coordination-reply <project> --input <reply.json>
```

이 작업들은 기본적으로 `HEAD_AGENT_COORDINATION_BINDING_TOKEN`에서, 또는 명시적으로
이름이 지정된 환경 참조에서 토큰을 해석합니다. MCP 표면은 정확히 다음 항목을 노출합니다.

- `head_coordination_send_message`;
- `head_coordination_read_inbox`;
- `head_coordination_wait_reply`;
- `head_coordination_reply_message`.

`send`에는 멱등성 키가 필요합니다. 같은 키와 정확히 같은 정규화된 페이로드를 재실행하면 같은
메시지와 불변 회신이 있으면 그 회신을 반환하며, 충돌하는 재사용은 fail-closed로 실패합니다.
`read-inbox`는 반환된 메시지를 호스트 로컬 상태에서 읽음으로 표시합니다. 받은 편지함과 회신
대기는 모두 최대 600000 ms로 제한되며, 모든 폴링에서 현재 세대와 바인딩을 다시 인증합니다.
`wait-reply`는 전달 확인을 요구하지도 생성하지도 않으며, 그 결과에는
`replyAuthority: coordination-evidence-only`와 `reviewDecisionCreated: false`가 명시적으로
기록됩니다. `reply`는 메시지마다 불변 회신 하나만 허용합니다. 같은 회신은 멱등적이며 다른 회신은
거부됩니다.

## 전달 분리

영속 받은 편지함 쓰기는 선택적 `WorkspaceHostAdapter` 알림보다 먼저 완료됩니다. 전달에는
다음 네 가지 제한된 결과가 있습니다.

- `not_configured`: 라이브 전달 어댑터가 존재하지 않습니다;
- `delivered`: 어댑터가 정확한 완료를 보고했습니다;
- `unavailable`: 현재의 정확한 대상을 사용할 수 없습니다;
- `ambiguous`: 완료 여부를 판단할 수 없습니다.

모호한 결과는 같은 알림을 두 번 주입할 수 있으므로 절대 자동 재시도하지 않습니다. send를
재실행하면 어댑터를 다시 호출하지 않고 영속 메시지와 원래 전달 영수증을 반환합니다. 미래의
라이브 호스트는 명시적이며 대상으로 차단된 재전달 작업을 관리자/어댑터 효과로 제공할 수 있지만,
이는 네 가지 공개 역할 도구의 일부가 아닙니다.

활성 공급자 중립 어댑터는 호스트 구성에서만 호출자 식별자를 받습니다. 표준 전용 stdio
프로세스는 시작 시 해당 식별자를 받을 수 있으며, 공유 호스트는 이에 상응하는 호출자 객체를
MCP 디스패치에 직접 주입할 수 있습니다. 도구 인수는 절대 이를 받지 않습니다. 연결과 모든
send는 새로운 드라이버 스냅샷을 사용합니다. 전달은 효과 직전과 직후에 대상 포인터를 다시
읽습니다. `delivered`가 되려면 정확한 메시지/엔드포인트 확인과 전송 후에도 바뀌지 않은
엔드포인트가 필요합니다. 효과 전에 대상이 없으면 `unavailable`이고, 예외, 부분 전송, 변경된
엔드포인트, 변경된 대상 또는 검증할 수 없는 확인은 `ambiguous`입니다.

플러그인은 의도적으로 공급자 중립적 `WorkspaceHostDriver` 스냅샷/send 계약에서 멈춥니다.
이 계약에는 호스트별 실행 파일, 소켓, 명령, 창 또는 TUI 변환이 들어 있지 않습니다. 별도 소유의
선택적 어댑터는 지원되는 호스트 머신 인터페이스를 정규화된 엔드포인트 스냅샷과 정확한 send
확인으로 변환할 수 있지만, 고유 엔드포인트, 프로젝트 CWD, 바인딩, 대상 또는 전송 후 차단막을
약화할 수 없습니다. 원시 엔드포인트 좌표는 호스트 로컬 운영 상태로 남고, 공급자 세션 식별자는
지속되지 않으며, 연결 식별자만 전달 영수증에 들어갑니다.

번들된 프로덕션 참조 구현은 워크스페이스 관리자 통합이 아니라 공급자 중립적 파일 시스템
편지함인 `host-export`입니다. 신뢰할 수 있는 외부 호스트가 프로젝트 외부에 내용 주소화된 불변
엔드포인트 스냅샷과 현재 포인터를 게시합니다. 각 엔드포인트는 정확한 현재 조정 `bindingId`와
호스트가 발급한 프로세스별 증명의 해시에 고유하게 결속되며, 해당 프로세스에 주입된 원시 증명만
엔드포인트를 호출자로 활성화할 수 있습니다. 스냅샷은 해당 공급자 프로세스가 시작되기 전에 정확한
현재 수신자 바인딩을 등록할 수도 있습니다. 이는 오프라인 도달 가능성만 부여하며, 역할, 지시,
실행, 검토, 결정, 승격, Canon 또는 프로세스 권한은 부여하지 않습니다. 발신자는 자신의 현재
바인딩/증명을 소유해야 하고, 수신자 바인딩은 고유하게 해석되어야 하며, 시작된 수신자는 첫 MCP
호출에서 자신의 서로 다른 원시 증명을 독립적으로 입증해야 합니다. 브리지는 새로운 모든
스냅샷에서 엔드포인트 튜플, 바인딩 소유권 및 증명 보유를 다시 확인합니다. 복사된 좌표, 외부
바인딩, 위조된 증명, 그리고 엔드포인트, 터미널, 바인딩 또는 증명의 중복 소유권은 fail-closed로
실패합니다. 명시적으로 연결 해제된 바인딩은 오프라인 경로를 통해 해석되지 않습니다. 전달은
해시된 엔드포인트 위치 아래에 수신자 바인딩에 결속된 배타적 요청 하나를 생성합니다. 호스트는
효과 발생 전 배타적 클레임 하나를 획득한 다음, 제한된 대기 시간 안에 요청 해시에 결속된 배타적
확인 하나를 반환해야 합니다. 클레임 획득 시 요청의 호스트, 스냅샷, 워크스페이스, 탭,
엔드포인트, 터미널, 정식 CWD, 런타임 및 수신자 바인딩을 현재 export와 대조하여 다시 검증합니다.
기존의 미확인 클레임은 모호한 상태이며 절대 자동으로 다시 처리되지 않습니다. 공급자를 깨우는
방법은 호스트가 결정합니다. Core는 바이너리, 소켓, CLI 명령, 창, TUI, 공급자 세션 또는 자격
증명을 절대 보지 않습니다. `scripts/workspace-host-export-mcp.mjs`는 호스트가 주입한 환경
참조에서 이 어댑터를 구성하며, 요청된 프로젝트가 주입된 정식 프로젝트 루트와 다르면 거부합니다.

호스트는 export 루트를 미리 만들고 `HEAD_AGENT_HOST_PROJECT_ROOT`,
`HEAD_AGENT_WORKSPACE_HOST_EXPORT_ROOT`, `HEAD_AGENT_HOST_WORKSPACE_ID`,
`HEAD_AGENT_HOST_TAB_ID`, `HEAD_AGENT_HOST_ENDPOINT_ID`,
`HEAD_AGENT_HOST_PROCESS_PROOF` 및 기존 역할 바인딩 토큰을 주입해야 합니다. 느린 실제 공급자
wake를 위해 제한된 운영 값 `HEAD_AGENT_WORKSPACE_HOST_ACK_TIMEOUT_MS`를 10에서 600000
사이로 추가 설정할 수 있습니다. 이 값은 지속되지 않으며 의미 식별자에 사용되지 않습니다. 원시
프로세스 증명은 호스트 전용 bearer capability이며, 도메인으로 분리된 해시만 프로젝트 외부
스냅샷에 존재합니다. 이는 프로세스 구성 입력이지 역할 도구 인수나 프로젝트 아티팩트가 아닙니다.
메모리 내 `fixture-host` 드라이버는 결정론적 Core 테스트 더블일 뿐입니다. 프로덕션 MCP
엔트리포인트는 바인딩, 엔드포인트 튜플, 프로세스 증명을 함께 요구하며, 증명 없는 fixture나 전달
fallback은 없습니다.

옵트인 라이브 검증기는 실제 모델 호출을 수행하므로 일반 테스트 스위트의 일부로 실행되지 않습니다.

```powershell
$env:HEAD_AGENT_LIVE_COORDINATION_E2E = "1"
$env:HEAD_AGENT_LIVE_COORDINATION_OPENCODE_MODEL = "provider/model"
npm run verify:live-coordination
```

이 검증기는 설치된 Codex/OpenCode 실행 파일을 발견하고 프로덕션 host-export MCP 구성만
사용하며, 공급자 출력을 메모리에 캡처하고, 프라이버시가 축소된 해시/도구/정리 요약을 내보내며,
성공과 실패 모두에서 격리된 프로젝트, 운영, export 및 프로세스 제어 루트를 제거합니다.

## 현재 주장 경계

Core, CLI 및 역할에 결속된 MCP 계약은 로컬 지속성, 역할 도출, Project/Session/세대 차단막,
바인딩 교체, 세대 순환, 교차 프로젝트 거부, 멱등성 충돌, 읽음 표식, 불변 회신, 전달 모호성,
토큰 비지속성 및 프로젝트 Canon 변경 없음에 대해 구현되고 테스트되었습니다. 활성 WorkspaceHost
경계에는 연결, 전달, 오래되거나 교체되거나 연결 해제된 대상, 대상 체인 롤백, 대상 TOCTOU,
전송 후 토폴로지 변경, 부분 전송 모호성, 정확한 확인, 프로젝트 CWD 차단 및 공급자 세션 부재에
대한 결정론적인 두 개의 새 프로세스 Codex/OpenCode 엔드포인트 증거가 추가로 있습니다.

host-export 프로덕션 경로에는 이미 실행 중인 실제 공급자 클라이언트 왕복도 있습니다. Codex
HEAD가 먼저 시작하여 자신의 서로 다른 프로세스 바인딩을 입증하고, 현재 대체 엔드포인트에
연결한 뒤 영속 받은 편지함에서 기다립니다. 그다음 OpenCode가 자신의 증명으로 시작하여 권한
질문을 보내고, 제한된 시간 동안 불변 답변을 기다립니다. 호스트는 공급자를 생성하지 않고 정확한
현재 엔드포인트를 클레임하고 확인하며, 이전의 오래된 엔드포인트는 요청을 하나도 받지 않습니다.
HEAD 회신은 조정 증거로 남고 `ReviewDecision`을 생성하지 않습니다. 두 일반 클라이언트는 검증된
프로세스 트리 소유권 아래에서 종료됩니다. 별도의 실제 Codex/OpenCode 클라이언트는 일회성
`interrupt` 및 `close` 정리를 입증하는 반면, `resume`과 `stream`은 계속 비활성화됩니다.
`.head`는 바이트 단위로 동일하며, 원시 증명, 바인딩 토큰, 제어 토큰 및 실제 공급자 세션 참조는
지속되지 않습니다. Project/export 중첩, 호스트-프로젝트 불일치, 명시적 연결 해제, ack timeout,
오래되거나 외부인 바인딩, 누락되거나 오래된 증명 및 포인터 변조는 fail-closed로 실패합니다.
공유 호스트 서비스 설치, 공급자 세션 resume/stream 및 더 폭넓은 프로세스 호스트 제어는 아직
구현되지 않았습니다. 원저자가 정확한 소스와 증거를 직접 감사하기 전까지 이 부분은 비교 우위를
주장하지 않습니다.
