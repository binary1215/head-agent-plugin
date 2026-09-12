> 영어 원문: [codex-marketplace.md](../codex-marketplace.md)

# Codex 마켓플레이스 배포

이 배포 평면을 변경하기 전에 [`architecture.md`](architecture.md)를 읽고,
설치가 새로운 정체성 또는 권위 평면이 아니라 동일한 공급자 중립적 Core의
투영으로 유지되는지 확인하세요.

## 목적

소스 저장소는 직접 실행할 수 있는 플러그인 루트로 유지됩니다. CI는 통합 계약
제품군과 다섯 개 네이티브 빌드 대상이 모두 통과한 뒤에만 별도의 Git 마켓플레이스
스냅샷을 조립합니다. 이는 단지 배포 카탈로그 레이아웃을 충족하기 위해 권위 있는
소스 레이아웃을 이동하거나 복제하는 일을 방지합니다.

생성된 `codex-marketplace` 브랜치에는 정확히 다음 항목이 포함됩니다.

```text
.agents/plugins/marketplace.json
.gitattributes
.head-agent-marketplace-generated.json
plugins/head-agent-core/<verified distribution files>
```

플러그인 디렉터리는 불변 사용자 배포에 쓰이는 것과 동일한 허용 목록 파일 집합으로
빌드됩니다. `.git`, `test`, `node_modules`, 로컬 개발자 `dist`, 임시 트리와 캐시는
제외됩니다. 그런 다음 CI는 다섯 개 매트릭스 아티팩트를 하나의 검증된 `dist/`
번들로 조립합니다. 모든 대상은 플러그인 버전과 소스 커밋이 일치해야 하며 worker,
supervisor 및 읽기 전용 ArcadeDB bridge 매니페스트 검사를 통과해야 합니다. 누락되거나
불필요한 대상, 서로 다른 커밋이 섞인 대상, 다이제스트가 유효하지 않은 대상이 있으면
게시가 중단됩니다. `distribution-manifest.json`은 모든 소스 및 네이티브 파일을
해시하며, 브랜치 마커는 마켓플레이스 이름, 플러그인 이름/버전, 배포 릴리스 ID,
소스 저장소와 정확한 소스 커밋을 콘텐츠 기반 스냅샷 ID에 바인딩합니다.

생성된 `.gitattributes`에는 `* -text`가 들어 있습니다. 이 파일 자체도 엄격하게
검증된 트리의 일부이며, 다른 운영체제에서 Git이 LF/CRLF 바이트를 다시 쓰지 못하게
합니다. 따라서 배포 매니페스트는 Linux 게시자에서만 유효한 것이 아니라 이식성을
유지합니다.

소스 브랜치는 별도로 `text=auto eol=lf`를 강제합니다. 그러므로 새 Windows,
macOS 또는 Linux 소스 체크아웃은 직접 설치와 마켓플레이스 조립에 동일한 텍스트
바이트를 제공합니다. 생성된 브랜치는 이미 정규화된 이 바이트를 `* -text`로
고정합니다.

## 설치

```powershell
codex plugin marketplace add binary1215/head-agent-plugin --ref codex-marketplace
codex plugin add head-agent-core@head-agent-plugin
```

설치 후 새 Codex 작업을 시작하세요. 일반 사용은 번들 `head-agent-onboarding` Skill을
통해 시작하며, 이 Skill은 typed `head_core` MCP 작업을 호출합니다. 설치만으로 `.head`를 생성하거나,
Features를 추론·승인하거나, GraphDB에 연결하거나, 프로젝트 파일을 변경하지 않습니다.

마켓플레이스 스냅샷에는 Windows x64, Linux x64/arm64 및 macOS x64/arm64 네이티브
패키지가 이미 포함되어 있습니다. 런타임은 현재 호스트의 무결성이 검증된 디렉터리만
선택하며 설치 시 별도의 다운로드가 필요하지 않습니다. 네이티브 가용성은 권위를
변경하지 않습니다. 프로덕션 저장소 스캔은 네이티브 후보가 벤치마크와 적합성 증거로
활성화 자격을 얻기 전까지 JavaScript 참조 경로에 남습니다.

## 업그레이드 및 제거

생성된 Git 스냅샷을 새로 고친 다음 같은 마켓플레이스에서 플러그인을 다시 설치합니다.

```powershell
codex plugin marketplace upgrade head-agent-plugin
codex plugin add head-agent-core@head-agent-plugin
```

플러그인과, 선택적으로 해당 마켓플레이스 소스를 제거합니다.

```powershell
codex plugin remove head-agent-core@head-agent-plugin
codex plugin marketplace remove head-agent-plugin
```

Codex 플러그인 제거는 Codex 플러그인 캐시/구성에 영향을 줍니다. 프로젝트 `.head`
아티팩트, 사용자 범위 `head-agent` 배포, Git 기록, Markdown 투영 또는 GraphDB 데이터는
삭제하지 않습니다.

## 생성 브랜치 소유권

CI는 기존 `codex-marketplace` 브랜치의 현재 스냅샷 전체가 HEAD 마켓플레이스 검증을
통과하지 않으면 이를 교체하지 않습니다. 소유권이 확인되면 정확히 예상한 커밋에 대해
`--force-with-lease`를 사용하여 교체합니다. 동시 변경 또는 소유되지 않은 브랜치 변경은
덮어쓰지 않고 실패합니다. 생성된 브랜치는 플러그인 정체성, Product Canon,
GraphSnapshot, Context Capsule 또는 Execution Lineage의 입력이 되지 않습니다.

로컬 검증:

```powershell
npm run verify:codex-marketplace
node scripts/build-codex-marketplace.mjs --output C:\temporary\head-agent-marketplace
node scripts/verify-codex-marketplace.mjs --root C:\temporary\head-agent-marketplace
```

CI는 빌더에 `--native-root`를, 검증기에 `--require-native`를 제공합니다. 개발을 위해
로컬 소스 전용 검증은 의도적으로 계속 지원되지만, 게시 가능한 네이티브 스냅샷이
조립되었다는 증거로 사용해서는 안 됩니다.

## 공개 디렉터리 경계

이 Git 마켓플레이스는 설치 가능한 제작/팀 배포 소스입니다. 플러그인이 OpenAI 범용
플러그인 디렉터리 심사를 통과했다는 주장은 아닙니다. 공개 제출에는 게시자 신원,
목록/지원/개인정보 보호 자료, 정책 증명 및 외부 검토가 필요합니다. 그와 같은 중대한
게시자 조치는 사용자 소유로 남으며 CI가 수행하지 않습니다.
