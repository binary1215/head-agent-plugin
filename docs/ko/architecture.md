# 아키텍처 결정

> 영어 원문: [`../architecture.md`](../architecture.md)

## 채택한 형태

플러그인은 공급자 중립적 Core를 둘러싼 얇은 공급자 배포판으로 구성됩니다.

```text
.codex-plugin/plugin.json
  -> skills/head-agent-core       human/agent operating contract
  -> .mcp.json                    read-only inspection surface
  -> scripts/head.mjs             explicit mutation entrypoint
       -> scripts/lib/head-core   project canon and projections
       -> scripts/lib/context-compiler
                                  versioned task Context Capsules
       -> scripts/lib/execution-lineage
                                  content-derived lineage artifacts
       -> scripts/lib/run-lineage contract-bound Run state transitions
       -> scripts/lib/product-model user-owned product-intent canon contract
        -> scripts/lib/onboarding project-scoped bootstrap, candidate, review, and promotion state machine
             -> scripts/lib/onboarding-contract Session, storage, and state-pointer identity contract
             -> scripts/lib/onboarding-projection immutable onboarding artifact validation and graph input
       -> scripts/lib/compute-adapter backend-neutral compute and WorkerProtocol contract
       -> scripts/lib/world-model incremental repository view
            -> scripts/lib/semantic-graph evidence-linked semantic projection
            -> scripts/lib/temporal-provenance immutable revision DAG and bounded traversal
            -> scripts/lib/git-history replaceable Git evidence source
            -> scripts/lib/runtime-state replaceable runtime evidence source
            -> scripts/lib/world-model-store replaceable storage contract
```

Claude Code, Codex 및 OpenCode는 동일한 `.head/` 권한의 프로젝션입니다. 각각 별도의 프로젝트 진실을 소유하지 않습니다.

소스 트리는 직접 실행 가능한 Core로 유지됩니다. CI는 동일한 허용 목록 배포판에서 콘텐츠가 검증된 독립적인 `codex-marketplace` 및 `claude-marketplace` 브랜치를 만들고, 검증된 빌드 매트릭스에서 조립한 5개 플랫폼용 단일 네이티브 번들을 오버레이합니다. 이 번들은 버전과 커밋에 바인딩됩니다. 런타임 선택은 정확한 호스트 일치와 무결성 검증을 통과해야 하며, 다른 대상은 비활성 배포 바이트로 남습니다. Claude의 생성 브랜치는 Claude Code에 필요한 카탈로그, 플러그인 매니페스트 및 `${CLAUDE_PLUGIN_ROOT}` MCP 캐시 경로 프로젝션만 추가합니다. 배포 메타데이터, 네이티브 바이너리 및 캐시 경로는 Core ID, Product Canon, Session/Run 복구 또는 어떤 authority plane도 변경할 수 없습니다. [`codex-marketplace.md`](codex-marketplace.md)와 [`claude-marketplace.md`](claude-marketplace.md)를 참조하세요.

## 헌법적 Core와 선택적 프로필

안정적인 규범적 기반은 [`head-constitution.md`](head-constitution.md)에 있는 작은 공급자 중립적 HEAD 헌법입니다. P1-P5는 강제 가능한 내부 타입 시스템이지, 사용자가 반드시 거쳐야 하는 의식이 아닙니다. 공개 초기화/재개 트랜잭션은 별도의 프로젝트 ID를 만들지 않고 두 가지 프로필을 노출합니다.

- `core`가 기본값이며 정식 Project, 현재 Session, 관리되는 런타임 프로젝션 및 휴면 상태인 선택적 상태 포인터만 설정합니다.
- `product`는 증거가 연결된 온보딩과 Product/World/Graph 거버넌스 경로를 명시적으로 활성화하거나 재개합니다.

두 프로필은 동일한 Core 트랜잭션, Project ID, Session ID, 관리형 설치 수렴 및 권한 계약을 사용합니다. Core 재개는 이미 활성화된 Product 프로필을 삭제하거나 자동으로 새로 고치지 않습니다. `product`를 명시적으로 선택하지 않으면 온보딩 입력은 거부됩니다. 공급자 어댑터가 서로 다른 선택적 기능을 노출할 수는 있지만, 어느 어댑터도 이러한 의미 체계를 재정의할 수 없습니다.

따라서 `profile`은 영속적인 프로젝트 모드가 아니라 작업 선택입니다. 읽기 전용 `HeadProjectExperienceProjection`은 Core 준비 상태와 Product 준비 상태를 독립적으로 보고하고, 실행 가능한 다음 단계 하나를 선택하며, Context 컴파일, 영속적 Runs, 범위가 한정된 workers, 컴팩션 복구 및 공급자 호출의 전제 조건을 공개합니다. 이 프로젝션은 범위가 한정되고 비영속적이며 권한이 없습니다. 검사는 기능을 활성화하거나, 관리되는 파일을 복구하거나, Run 또는 ReviewDecision을 생성하거나, 임대를 소비하거나, 복구 방향을 기록할 수 없습니다. CLI `status`/`doctor`와 MCP `head_project_status`는 동일한 프로젝션을 반환합니다. 검증된 온보딩 상태는 계속 내장되므로 친절한 안내가 정식 상태 머신을 대체하지 않습니다.

## 온보딩 authority plane

초기화는 공급자 대화와 독립적으로 프로젝트 범위의 HEAD Session 레코드와 휴면 온보딩 포인터를 생성합니다. 명시적인 `product` 프로필만 로컬 World Model을 인덱싱합니다. 구조화된 user brief는 candidate를 직접 seed할 수 있고, 그 외에는 fresh provider HEAD가 현재 evidence에서 bounded semantic proposal을 작성합니다. JavaScript Core는 정확한 SourceSnapshot, path, digest, line, optional symbol, Product Model reference와 bound를 검증한 뒤 하나의 immutable batch를 제시합니다. Core는 lexical product inference를 하지 않으며 proposal에는 지시 또는 승격 권한이 없습니다.

CLI로 제공되고 `decisionScope: product-canon-bootstrap`이 지정된 `ReviewDecision`만 Product Canon revision을 생성할 수 있습니다. 수락 시 이전 및 다음 Product Model 해시를 기록하고, 자식 SourceSnapshot을 재구축하며, 상태 포인터가 준비 상태가 되기 전에 temporal GraphSnapshot을 검증합니다. revision은 후속 후보 집합을 생성하고, 거부 시 Canon은 변경되지 않습니다. 불변 candidate, Evidence, Unknown, ReviewDecision 및 ProductModelRevision 영수증은 감사를 위해 그래프에 프로젝션되지만, 프로젝션 자체는 결정하거나 승격할 수 없습니다. 읽기 전용 MCP는 검증된 상태와 범위가 한정된 그래프 순회를 노출하지만 검토하거나 승격할 수 없습니다.

스토리지 선택의 기본값은 완전한 로컬 경로입니다. GraphDB endpoint, database 및 환경 스타일 secret-reference 이름은 보류 중인 운영 구성으로 기록할 수 있지만, 자격 증명은 거부되며 어댑터가 적합성 검사를 통과하기 전에는 원격 성공을 주장하지 않습니다. [`onboarding.md`](onboarding.md)를 참조하세요.

## 이전 런타임을 내장하지 않는 이유

기존 구현은 프로젝트 권한을 실행 중인 Herdr 창과 OpenCode 세션에 바인딩하고, POSIX 서비스를 설치하며, Unix 중심의 경로와 프로세스 가정을 사용합니다. 그 런타임을 Codex 플러그인에 복사하면 크로스 플랫폼 지원을 거짓으로 내세우고 정리 및 펜싱 불변 조건을 약화하게 됩니다.

런타임 계층은 명시적인 `PlatformAdapter`, `AgentRuntimeAdapter` 및 `WorkspaceHostAdapter` 경계를 정의합니다. Claude Code, Codex, OpenCode와 Windows, macOS, Linux 및 네이티브 프로세스 호스트는 결정론적 계약 아티팩트로 표현됩니다. 현재 호스트의 머신 탐색 구성은 프로그램을 실행하지 않고 절대 PATH 항목과 일반 실행 파일 후보를 검사하며, 범위가 한정된 버전 및 공급자별 도움말 구성은 비세션 인터페이스를 입증합니다. `RuntimeProjectBinding`은 이러한 관찰을 정식 HEAD Project 및 Session ID에 연결합니다. 하나의 불변 `ExecutionAuthorization`은 경량의 유휴 Session 범위와 계약에 바인딩된 완전한 Run 범위를 지원하면서 Project/호출자 펜스, 범위가 한정된 리소스, 시작 전 일회성 소비, 이벤트 정규화, 취소 및 정리를 공유합니다. Session 범위는 WholePlan 또는 Fresh HEAD 검토를 요구하지 않고 사용자 요청 다이제스트와 선택적 Capsule을 바인딩합니다. Run 범위에는 여전히 정확한 Run, ExecutionContract, WholePlan 및 Capsule이 필요합니다. 영속적인 소비/해제 영수증은 프로젝트 리니지에 남지만, PID/token/owner-lock, supervisor 제어 파일, 결과 스키마 상태, 역할 바인딩 및 실행 중인 endpoint 대상은 프로젝트 외부의 전용 호스트 로컬 운영 루트로 한정됩니다. 공급자 중립적 호출 레코드 및 Run 결과 적용 Core는 권한/런타임/범위 리니지를 검증하고 공급자별 ID 없이 정식 ResultPacket 증거를 생성합니다. 공급자 어댑터에는 실행 인수와 이벤트 추출만 남습니다. Windows Job Objects와 POSIX process groups는 네이티브 helper에 권한을 이전하지 않으면서 OS가 강제하는 공급자 하위 프로세스 소유권을 제공합니다. 세 런타임은 모두 이 감독 Core를 통해 결정론적 Session/Run 및 공급자별 프로토콜 픽스처 검증 범위를 공유합니다. Codex와 OpenCode는 완료된 실제 모델 호출 증거도 보유하지만, Claude Code 실제 모델 호출 적합성은 명시적인 옵트인 게이트로 남습니다. OpenCode 공급자 구성은 사용자의 전역 OpenCode 설정 및 인증이 계속 소유하며, Claude Code 인증과 모델 라우팅도 마찬가지로 공급자가 소유합니다. HEAD는 어떤 공급자 프리셋도 추가하지 않습니다. 정확한 endpoint의 WorkspaceHost 역할 전달과 P2-first 선택적 실시간 HEAD 연결은 호스트가 발급한 바인딩 및 최신 스냅샷 펜스 뒤에서 활성화됩니다. 프로덕션 호스트 내보내기 참조는 프로젝트 외부의 콘텐츠 주소 지정 스냅샷, 바인딩 범위의 프로세스별 증명 및 create-only 파일시스템 전달/claim/ack 레코드를 사용합니다. 이미 실행 중인 실제 Codex/OpenCode 도구 소비는 검증되었으며, Claude Code 호스트 왕복 증거는 별도의 실제 게이트가 실행되기 전까지 주장하지 않습니다. 호스트별 실행 파일/socket/CLI/창 변환, 일반 공급자 resume/stream 및 더 광범위한 런타임 제어는 별도로 소유되는 어댑터로 계속 연기됩니다. [`runtime-adapters.md`](runtime-adapters.md)를 참조하세요.

## 파일 소유권

`.head/`는 플러그인이 관리하는 Canon입니다. 루트 `CLAUDE.md`, `.mcp.json`, `AGENTS.md` 및 `opencode.json`은 해당 런타임 프로젝션과 충돌하는 항목이 없을 때만 생성됩니다. 기존 파일은 프로젝트 소유로 유지되며, 생성된 대안은 `.head/generated/` 아래에 기록되고 수동 통합 작업으로 보고됩니다.

관리되는 매니페스트는 SHA-256 다이제스트를 기록합니다. 관리 대상의 드리프트가 감지되면 정식 변경이 중단됩니다.

## Context Compiler plane

Context Compiler는 정식 프로젝트 지식과 HEAD 실행 사이에 위치합니다. 범위가 한정되고 재현 가능한 `ContextCapsule`을 컴파일하며, 두 번째 권한이 되지는 않습니다.

`ContextWorkflowProjection`은 하나의 비영속 미리보기를 대상으로 하는 얇은 P4 스타일의 자문 뷰입니다. 기반 아티팩트를 변경하지 않고 검증된 World 가용성, HEAD가 작성한 EvidenceNeeds, Compiler 포함 증명, 고정된 예산 티어 옵션 및 다음 HEAD 결정을 연결합니다. 입증된 `context-budget` 제외가 있을 때에만 다음 고정 티어에서 동일한 비영속 컴파일을 반복할 수 있으며, 모든 Capsule ID와 증명을 기록합니다. 외부 작업이나 변경 작업을 절대 실행하지 않으며, 커버리지를 의미적 수락으로 승격하지도 않습니다.

그 앞의 `ContextPreparationProjection`도 비영속 P4입니다. 사용자의 task text만 받아 현재 Project/World/Graph binding, 제한된 lexical discovery baseline과 provider HEAD가 검사할 exact node identity를 보여줍니다. EvidenceNeeds를 작성하거나 anchor를 선택하거나 provider를 호출하지 않으며 lexical 후보에 없다는 사실을 무관하다는 뜻으로 해석하지 않습니다. HEAD가 대화 안에서 구조화 proposal을 작성하고 기존 preview verifier에 제출합니다. provider 교체 후 이 projection을 다시 만들 수 있지만 P2 recovery direction을 쓸 수 없고, 오래된 World 또는 Graph binding은 fail closed됩니다.

```text
Canonical sources -> Snapshot -> HEAD EvidenceNeeds -> verified packing/budget -> ContextCapsule -> HEAD/Executor
       ^                                                        |
       |             verified candidate knowledge               |
       +--------------------------------------------------------+
```

World Model과 Capsules는 구체화된 뷰입니다. 증거와 Project Canon으로부터 재구축할 수 있어야 합니다. `Snapshot`, `Evidence`, `Claim`, `Decision`, `Unknown` 및 `ContextCapsule`은 의미 경계이며, 스토리지 기술은 교체 가능한 상태로 유지됩니다.

Compiler를 사용할 수 없는 상황은 어댑터 수준의 fail-open 조건입니다. ID 드리프트, Canon 드리프트, 유효하지 않은 지식 또는 Capsule 다이제스트 불일치는 Core의 fail-closed 조건입니다.

## Execution Lineage plane

Execution Lineage는 공급자 대화를 권한으로 삼지 않고 Capsule을 감사 가능한 전체 계획 루프로 전환합니다.

```text
WholePlanSnapshot
  -> ExecutionContract + ContextCapsule
  -> Executor
  -> ResultPacket
  -> ReviewDecision
  -> accepted result or refined WholePlanSnapshot
```

각 아티팩트에는 콘텐츠에서 파생된 ID, 다이제스트 검증 및 타입이 지정된 `LineageLink` 부모가 있습니다. `ResultPacket` 증거는 명시적으로 지시 권한이 없습니다. Fresh HEAD는 숨겨진 모델 세션을 재개하는 대신 이러한 검증된 아티팩트에서 검토 컨텍스트를 재구성합니다.

이제 아티팩트 전용 Session 복원은 정확한 콘텐츠 주소 지정 `SessionRunCheckpoint`, 불변 Session 포인터 및 검증된 Run/plan/contract/Capsule 리니지로부터 현재 소비자 입력을 재구성합니다. 반환되는 `SessionRestoreProjection`은 비영속 P4이며 공급자 세션 ID, 트랜스크립트, 요약, resume 또는 stream을 사용하지 않습니다. Fresh HEAD ReviewDecision이 수락된 후 별도의 일회성 작업은 검토된 Run을 복구 필드가 명시적인 HEAD/사용자 입력인 P2 체크포인트에 바인딩할 수 있습니다. ResultPacket과 P3 통합 영수증은 그 방향을 작성하거나 대체할 수 없습니다. [`session-recovery.md`](session-recovery.md)를 참조하세요.

공급자 중립적인 실행 wave 가시성은 기존 HF-009 디스패치 위에 구성된 별도의 P3/P4/P5 조합입니다. `BoundedWorkerWave`는 권한 부여를 생성하거나 확대할 수 없습니다. 명시적 seal에는 모든 독립적 임대 소비가 필요합니다. status/results는 P4 뷰로, wait는 P5로 유지됩니다. 각 결과는 여전히 Fresh HEAD 검토와 명시적 HF-010 체크포인트 통합을 독립적으로 거칩니다. [`bounded-worker-wave.md`](bounded-worker-wave.md)를 참조하세요.

버전 0.3 alpha는 Runs를 검증된 계약에 바인딩하고, 완료를 ResultPacket으로 변환하며, 결정론적인 최소 Fresh HEAD 검토 프로젝션을 구성하고, 수동 HEAD ReviewDecision에 그 정확한 프로젝션을 요구합니다. `revise`와 `expand`는 다른 Run에 앞서 ReviewDecision에 연결된 다음 WholePlanSnapshot을 요구합니다. 후보 지식과 HEAD 권고에는 계속 권한이 없습니다. 정확한 선택적 WorkspaceHost 연결은 P2 복원 후에만 활성화됩니다. 일반 공급자 resume/stream, 더 광범위한 런타임 제어 및 권한이 부여된 지식 승격 표면은 계속 연기됩니다.

## Repository World Model plane

World Model은 지원되는 저장소 파일, 휴리스틱 심볼, 종속성, import 및 해석 가능한 호출을 콘텐츠 주소 지정 증거로 구체화합니다. 선택적인 provider-neutral `SourceRelationEvidenceAdapter`는 정확한 현재 file manifest에 결속된 언어 AST `IMPORTS`/`CALLS` 증거를 추가할 수 있습니다. Core는 이를 heuristic fallback과 분리된 analyzer·source·confidence로 보존합니다.

`WorldModelStoreAdapter`는 World Model 영속성을 의미적 스냅샷 ID와 분리합니다. 스냅샷에는 불변의 재구축 가능한 스토리지 계약만 포함되며, 포인터는 활성 어댑터 descriptor를 기록합니다. 로컬 JSON 어댑터가 활성화되어 있고, 메모리 내 적합성 테스트는 동일한 정식 입력이 다른 어댑터를 통해서도 동일한 World Model ID를 생성함을 입증합니다.

`IncrementalRefreshRequest`와 `IncrementalRefreshReceipt`는 명시적 인덱싱 이후의 관찰 상태 새로 고침을 확립합니다. 새로 고침은 대상이 되는 모든 파일을 다시 발견하고 바이트 해시하며, 다이제스트가 동일한 파일에 대해서만 검증된 분석을 재사용하고, 전체 참조 경로와 동일한 `RepositoryScanResult`를 생성해야 합니다. 실제 변경이 있으면 검증된 현재 SourceSnapshot을 자동으로 부모로 삼고, 변경되지 않은 revision ID를 보존하며, 변경된 revision의 부모를 이전의 현재 revision으로 지정하고, 그래프 구체화를 검증한 뒤, 미리보기 ID가 확정된 후에만 World Model 포인터를 전진시킵니다. 활성 Runs는 정확한 Capsule과 계약을 유지합니다. 영수증은 드리프트와 필요한 명시적 HEAD 선택을 기록합니다. Product Canon과 검토된 관계는 변경되지 않습니다. [`incremental-refresh.md`](incremental-refresh.md)를 참조하세요.

`RefreshTriggerBatch`와 `RefreshTriggerDeliveryReceipt`는 다음 수집 계층을 추가합니다. 포그라운드 재귀 파일시스템 watcher와 엄격한 CI event-file 어댑터가 하나의 범위가 한정된 debounce queue에 입력을 제공합니다. 경로는 권한 없는 힌트로 남으며, 모든 전달은 동일한 전체 새로 고침 스캔을 호출합니다. 수락된 이벤트는 정식으로 정렬되고, 중복 및 제외/오버플로 관찰은 집계되며, `.head` 이벤트는 자체 트리거를 일으키지 않습니다. 프로젝트 범위의 배타적 writer lease는 기존 포인터 비교 전에 수동, 파일시스템 및 CI 새로 고침을 직렬화합니다. 트리거 아티팩트에는 지시, 승격 또는 Canon 변경 권한이 없습니다. [`refresh-trigger.md`](refresh-trigger.md)를 참조하세요.

`GraphProjectionAdapter`는 별도의 그래프 구체화 및 순회 경계입니다. 내장 temporal GraphSnapshot은 복구 가능한 소스로 유지됩니다. 로컬 JSON, 메모리 내 및 명시적으로 활성화된 ArcadeDB 어댑터는 동일한 GraphSnapshot 및 TraversalResult ID를 보존하고, 권한 상승과 오래되거나 변조된 프로젝션을 거부하며, 구체화가 없을 때 내장 그래프 fallback을 공개합니다. `PreparedTraversalRequest`는 이미 확정된 쿼리와 결과를 정확하고 범위가 한정된 확장 증거에 바인딩합니다. ArcadeDB는 쿼리 시점에 전체를 다시 로드하지 않고 포인터와 topology manifest에서 해당 반경을 검증할 수 있습니다. topology manifest 및 범위가 한정된 순회 읽기는 독립적인 포인터 검사 후 쿼리 전용의 정확한 자식 배치 하나를 공유합니다. JavaScript bridge는 참조 전송 계층입니다. 네이티브 배포판에 무결성이 검증된 Go bridge가 있으면 이를 선택하지만, 모든 의미 및 권한 검증은 JavaScript에 남습니다. ArcadeDB vertex, edge, 전송 출력 및 영수증은 파생 증거로 유지되며 고유한 권한을 소유할 수 없습니다. [`graph-projection-adapter.md`](graph-projection-adapter.md)를 참조하세요.

준비된 순회의 성능 증거는 두 plane을 분리된 상태로 유지합니다. 정식 UTF-8 payload component 크기는 재현 가능하고 콘텐츠에서 파생된 비용 증거를 구성합니다. 경과 시간, 캐시 상태, 전송 호출 및 정규화된 관찰 응답 크기는 운영 진단일 뿐입니다. 실제 benchmark는 이미 검증된 activation만 사용할 수 있고 변경 메서드를 노출하지 않으므로, GraphDB 측정은 포인터를 전진시키거나 스키마를 생성하거나 권한을 변경할 수 없습니다.

`DocumentProjectionAdapter`는 검증된 그래프 이후의 별도 사람용 뷰 경계입니다. 결정론적 Markdown 참조 renderer는 콘텐츠에서 파생된 `DocumentProjection` 아티팩트와 `.head/generated/knowledge` 아래의 교체 가능한 게시 뷰를 내보냅니다. 로컬 및 메모리 내 어댑터는 동일한 문서 콘텐츠와 프로젝션 ID를 보존해야 합니다. 명시적 생성은 계속 사용할 수 있습니다. 별도의 safe-default-manual `PostRefreshProjectionPolicy`는 검증된 새로 고침 이후 편집되지 않은 뷰에 대해서만 자동 게시를 활성화할 수 있으며, 불변 영수증은 policy, refresh, graph, projection 및 candidate 증거를 바인딩합니다. 게시된 드리프트는 절대 덮어쓰지 않습니다. 현재 편집 내용은 Canon, 지시 또는 승격 권한이 없는 불변 `DocumentChangeCandidateSet`이 됩니다. 범위가 지정된 명시적 검토는 사용자가 제공한 완전한 Product Model이 있을 때만 후보를 수락하고, 검증된 자식 GraphSnapshot을 재구축하여 Markdown을 조정할 수 있으며, 또는 Canon을 변경하지 않고 후보를 거부할 수 있습니다. 후보 집합, 검토, Product Model revisions 및 적용 영수증은 권한을 획득하지 않은 채 이후 감사 GraphSnapshots에 프로젝션됩니다. Obsidian과 Notion은 계속 연기됩니다. [`document-projection-adapter.md`](document-projection-adapter.md), [`document-change-review.md`](document-change-review.md) 및 [`post-refresh-projection.md`](post-refresh-projection.md)를 참조하세요.

semantic graph는 콘텐츠에서 파생된 node 및 edge ID, 파일 다이제스트 및 line 증거, 명시적인 source/confidence label과 `evidence-not-instruction` 신뢰 경계를 사용합니다. 기본 경로는 휴리스틱 file containment, module import와 해석 가능한 JavaScript/TypeScript/Python call입니다. 선택적 AST relation은 엄격한 current-manifest adapter contract를 통해서만 추가되며 의미·지시·승격·검토·복구 권한이 없는 P4 structural evidence입니다.

`.head/context/product-model.json`의 Product Model 소스는 사용자가 소유하는 Canon입니다. 저장소 디렉터리와 독립적으로 안정적인 FeatureGroup, Capability, Feature, Requirement, Constraint 및 Decision 키를 정의합니다. 이전에 초기화된 프로젝트에서 Product Model이 누락된 경우 이는 명시적으로 비어 있는 semantic model입니다. 코드와 문서가 자동으로 채우지 않습니다. [`product-model.md`](product-model.md)를 참조하세요.

temporal provenance graph는 별도의 검증된 프로젝션입니다. traversal protocol은 `lexical-discovery`와 exact HEAD anchor mode를 상호 배타적으로 제공합니다. exact mode는 현재 GraphSnapshot과 1~32개의 node ID에 결속되고 relation·authority·freshness·confidence·depth·node·edge·candidate policy를 확대할 수 없습니다. Context Compiler는 HEAD 소유 EvidenceNeed 안의 exact anchor만 받아 별도 `GraphTraversalEvidence`를 만들며 lexical search를 semantic relevance로 승격하지 않습니다. Product relation은 `canon-projected`이고 candidate-space node는 명시적 opt-in 없이 숨겨지며, local/ArcadeDB projection은 embedded GraphSnapshot을 복구 소스로 보존합니다.

공급자 중립 공통 Observation 경계는 Core에 제품 어휘를 가르치지 않고 domain-shaped data를 기록합니다. `ObservationTypeDescriptor`, `ObservationRecord`, `DerivedObservationRecord`, `ObservationCollectionReceipt`는 P3이고, `ObservationStatusProjection`은 별도의 재구축 가능한 P4 evidence graph이며, `ObservationSourceBinding`은 P5 Host configuration입니다. process-local `ObservationAdapterRegistry`는 source별 optional adapter를 하나의 정확한 ready Project에 binding하면서 path, credential, cursor 또는 provider identity를 persist하지 않습니다. 비지속 discovery view는 registration gate 없이 exact filter, disclosed read-only resynchronization을 포함한 opaque pagination, bounded descriptor shape, Host-local availability hint를 제공합니다. `ObservationPreparationProjection`은 reuse-first UX를 위해 exact existing-evidence query와 matching source discovery를 결합하지만 meaning, sufficiency, source 또는 collection을 선택하지 않습니다. Host-injected MCP composition은 opaque Project-bound source ID로만 collect합니다. `JsonEventFileObservationAdapter`는 MCP file-path surface를 추가하지 않는 bounded one-shot CI reference를 제공합니다. 자동 graph relation은 `CONFORMS_TO`, `EVIDENCED_BY`, `DERIVED_FROM`으로 제한됩니다. Context Compiler는 정확한 HEAD 소유 EvidenceNeed를 통해서만 observation을 포함합니다. observation collection은 Product Canon, product meaning, ReviewDecision 또는 P2 recovery direction을 만들 수 없습니다. [`observation-adapters.md`](observation-adapters.md)를 참고하세요.

`DeploymentResultAdapter`는 별도의 Host observation 경계입니다. Provider run/session/process identity를 저장하지 않고 bounded deployment fact와 evidence digest를 제공합니다. Core는 create-only `BranchStateObservation`, `DeploymentResultObservation`, 조건을 충족한 `ReleaseObservation` P3 evidence를 기록하기 전에 reachable Git history와 현재 product ref를 독립적으로 검증합니다. 해당 P4 graph projection은 배포를 허가하거나, 제품 outcome을 승인하거나, Product Canon을 변경하거나, P2 복구 방향을 쓸 수 없습니다. [`release-observation.md`](release-observation.md)를 참고하세요.

## Native compute plane

`ComputeAdapter` 계약 `0.3.0`과 WorkerProtocol `0.2.0`은 semantic ID를 변경하거나 JavaScript 제어 영역에서 권한을 이전하지 않는 교체 가능한 연산 경계를 정의합니다. 정식 요청은 버전이 지정된 작업, 입력 다이제스트, semantic producer 및 리소스 제한을 바인딩합니다. 정식 응답은 전부 성공하거나 전부 실패하며, 다이제스트가 검증되고, 크기가 제한되고, 구조화되며, `authorityEffect: none`으로 고정됩니다.

`JsReferenceComputeAdapter`는 적합성 기준과 로컬 fallback으로 유지됩니다. `GoWorkerComputeAdapter`는 콘텐츠 주소 지정 platform manifest를 검증하고, 실행 파일을 플러그인 배포 루트로 한정하며, shell 없이 직접 실행하고, stdio와 시간을 제한하며, 정확한 자식 PID 종료를 검증합니다. 누락, 비호환, 손상, 미지원, spawn 실패 또는 crash된 네이티브 경로는 공개된 운영 사유 코드와 함께 JavaScript로 fallback합니다. 유효하지 않은 네이티브 응답, timeout 및 취소 실패는 fail-closed 방식으로 실패합니다. 이제 Go `repository.scan.v1` 후보는 다국어 및 Unicode 증거와 명시적 include/exclude source scope를 포함해 일곱 개의 완전한 성공/실패 응답 및 동일한 corpus ID와 일치합니다. 비교 benchmark 결과 소규모 및 중간 입력에서는 성능이 저하되고 대규모 입력에서는 근소하게 개선될 뿐이므로, release manifest는 여전히 `worker.health.v1`만 알립니다. 프로덕션 World Model scan은 JavaScript에 남습니다. compute 기반 graph 작업과 benchmark로 정당화된 네이티브 선택 정책은 계속 연기됩니다. [`compute-adapter.md`](compute-adapter.md)를 참조하세요.

`GitHistoryAdapter`는 재구축 가능하고 콘텐츠 주소가 지정된 commit 증거를 별도로 제공합니다. 기본 비동기 Git CLI 어댑터는 프로세스를 실행할 수 없을 때 명시적인 coverage 정보와 함께 fail-open할 수 있습니다. byte-preserving host-export 어댑터는 제한된 런타임에서 동일한 semantic input을 제공합니다. 현재 refs는 도달 가능성을 검증하며, commit message는 지시나 승격된 결정이 아니라 증거로 남습니다.

`RuntimeStateAdapter`는 엄격한 특정 시점의 외부 런타임 관찰을 제공합니다. source descriptor는 semantic ID가 아니라 pointer metadata이며, 정규화된 관찰은 콘텐츠 주소가 지정되고 최신성 게이트를 거칩니다. 어댑터는 읽기 전용이며 지시 권한이나 런타임 제어 권한을 부여하지 않습니다. 별도의 `PlatformAdapter`, `AgentRuntimeAdapter` 및 `WorkspaceHostAdapter` 참조가 공급자/플랫폼/호스트 구성을 명시적으로 만듭니다. 현재 호스트 탐색, 범위가 한정된 고정 버전/help 증거 및 `RuntimeProjectBinding`은 권한 부여 없이 capability를 확립합니다. 그 다음 호출 권한 부여 계층은 정확한 활성 HEAD 리니지에서 실행 기능이 없는 단일 호출 경계를 도출합니다. 영속적인 at-most-once lease는 supervisor 시작 전에 이를 소비하고, 완료, timeout, 취소 또는 호출자 실패 후에도 재실행할 수 없게 유지합니다. event/receipt/draft 스키마, 네이티브 Job Object/process-group 픽스처 및 실제 Codex/OpenCode Session/Run 증거는 제어 영역과 프로세스 트리 정리 형태를 입증합니다. 호스트에서 파생된 정확한 endpoint 역할 메시징은 별도의 비권위적 운영 기능이며, 그 대상 chain과 전달 영수증은 결코 복구 Canon이 되지 않습니다. P2-first 방식의 정확한 선택적 연결 및 소유권이 정확한 일회성 interrupt/close가 활성화됩니다. 공급자 hydration, 일반 resume/stream 및 더 광범위한 프로세스 제어는 계속 연기됩니다. AST 수준으로 정확한 그래프와 구조화된 Git 결정 추론도 계속 연기됩니다. [`runtime-state.md`](runtime-state.md)와 [`runtime-adapters.md`](runtime-adapters.md)를 참조하세요.
