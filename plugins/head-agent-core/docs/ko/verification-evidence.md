> 이 문서는 [verification-evidence.md](../verification-evidence.md)의 한국어판입니다.

# 검증이 증명하는 범위

Core 테스트는 정확한 식별자, 현재 상태 검증, 허용된 전이, 재시도, 무관한 작업의
격리를 검사합니다. 기존 검사의 통과로 미검증 반례를 부정할 수는 없습니다.
재현된 결함마다 행동 회귀 검사가 필요하며, 권위 게시와 일회성 소비 경계에서는
프로세스 경쟁과 중단된 쓰기도 검사합니다.

정답 주석이 있는 Context 테스트는 알려진 graph anchor를 입력합니다. 이는
전달받은 증거의 보존과 무관한 carrier 제외를 측정합니다. provider HEAD가
anchor를 발견했는지, 본문을 읽었는지, 작업을 정확히 구현했는지는 측정하지
않습니다. 신규 사용자 및 대화형 검증기는 fixture로 공개 CLI/MCP를 호출하므로
자연어 대화에서의 실제 작업 성공을 입증하지 않습니다.

## 로컬 진단

소스 체크아웃에서 선택적으로 진단을 실행합니다.

```powershell
npm run measure:context-diagnostics
npm run measure:context-diagnostics -- --project C:\path\to\project --task "Inspect the requested change" --iterations 5
```

보고서는 읽기 전용, 변경, 누락된 hint를 구분합니다. catalog 크기는 UTF-8
직렬화 바이트이며 모델 token 비용이 아닙니다. 정적 import 순환은 결합도를
보여주지만 관측된 런타임 실패는 아닙니다.

프로젝트와 작업이 있으면 한 프로세스에서 첫 preview와 반복 preview를
측정합니다. OS 캐시를 비우지 않으므로 첫 호출은 OS cold-cache 측정이 아닙니다.
파일시스템 API로 읽은 바이트도 실제 디스크 I/O와 다릅니다. 측정치는 Capsule
identity, 증거 선택, 승인, 복구에 영향을 주지 않습니다. 명령은 프로젝트 초기화,
World 갱신, Capsule 저장, provider 호출을 하지 않습니다. 작업 원문, 소스 본문,
Observation payload도 출력하지 않습니다.

## 실제 작업 평가

기대 증거와 수락 기준을 숨긴 별도 작업을 사용합니다. 일반 agent와 HEAD를 같은
provider/model, 저장소 revision, 작업, 권한, 외부 의존성 조건에서 비교하고,
정답 anchor를 주지 않습니다. 작업 해석, 증거 발견, 파일 읽기, 구현, 검증까지
평가하며 통제된 compaction 또는 provider 교체 사례도 포함합니다.

작업 성공, 필수 증거 누락, 잘못된 수정, 불필요한 질문과 승인, 경과 시간,
실제 provider token, 복구 후 사용자 제약 유지율을 기록합니다. 반복 실행하며
환경 실패를 구분합니다. 기계적 coverage, 패키지 설치, 도구 호출 성공만으로
이 결과를 입증할 수는 없습니다. 현재 fixture는 일반적인 우월성이나 실제 작업
성공을 증명하지 않습니다.

## CI와 게시

디렉터리 단위 trigger는 소스, 테스트, native 코드, 문서, 배포 입력을 포함합니다.
전체 JavaScript suite는 release와 두 marketplace의 독립적인 선행 조건입니다.
Cross-build는 대상 실행 파일을 준비하며, Windows와 macOS 작업은 별도로 설치,
native health, 소유 프로세스 정리, rollback과 uninstall smoke를 실행합니다.

CI 결과, 로컬 Windows 결과, cross-build, 실제 marketplace 설치, live provider
동작은 각각 별도의 증거입니다. 작업 구성이 존재한다는 것만으로 통과한 실행이
되지는 않습니다. 선택적인 native 또는 live-provider 경로에 fixture나 opt-in이
없으면 이를 공개하고 통과로 집계하지 않습니다.
