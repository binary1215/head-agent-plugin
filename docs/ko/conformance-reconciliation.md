# 비차단 Conformance 재정

[English source](../conformance-reconciliation.md)

이 계약을 변경하기 전에 [아키텍처](architecture.md), [권위 평면](authority-plane-contract.md), [ChangeSet](change-sets.md), [Observation 어댑터](observation-adapters.md)를 읽습니다.

상태: 공급자 중립 P3 후보 증거, P4 큐와 감사 뷰, 선택적 P5 Host trigger 구성이 구현되었습니다.

## 경계

Conformance 재정은 Core를 의미적 정책 엔진으로 바꾸지 않으면서 승인된 Product Canon을 정확한 현재 source, ChangeSet, Observation 또는 선택적 Graph 증거와 비교합니다. 공급자 HEAD가 `ConformanceFindingCandidate`를 제안하고, Core는 정확한 현재 anchor, digest, Project, baseline, bound, replay identity와 비권위 필드를 검증합니다. Core는 위반, 의미적 관련성, 충분성, 심각도, 해결 또는 제품 의미를 추론하지 않습니다.

Graph 부재, partial 또는 unknown Observation coverage, 사용할 수 없는 선택적 source, advisory risk hint는 일반 작업 gate가 아니라 disclosure입니다. 교차 Project 증거, path escape, tampering, divergent replay, authority amplification, stale mutation input은 영향받는 Conformance 동작만 실패시킵니다. stale read-only cursor는 첫 페이지로 재동기화하고, stale proposal은 HEAD에게 preparation을 다시 수행하도록 합니다. 어느 조건도 사용자에게 ID를 요구하거나 관련 없는 작업을 막지 않습니다.

## Artifact와 평면

| Artifact | Plane | Effect |
| --- | --- | --- |
| `ConformanceFindingCandidate` | P3 | 정확한 증거를 가진 불변 공급자 HEAD 의미 후보 |
| `ConformanceDispositionReceipt` | P3 | 정확한 Finding 하나에 한정된 명시적 사용자 disposition |
| `ConformanceResolutionCandidate` | P3 | Finding을 닫을 수 없는 fresh 공급자 HEAD 재평가 |
| `ConformancePreparationProjection` | P4 | HEAD를 위한 bounded 현재 Canon과 선택적 World baseline |
| `ConformanceQueueProjection` | P4 | 재구축 가능하고 페이지가 구분된 queue 상태 |
| `ConformanceFindingGraphProjection` | P4 | verdict relation이 없고 candidate가 숨겨진 감사 graph |
| `ConformanceTriggerBatchProjection` | P4 | 지속되지 않는 bounded Host-trigger preparation |
| `ConformanceTriggerBinding` | P5 | process-local 선택적 Host configuration과 delivery state |

Conformance artifact는 어느 것도 P1이나 P2가 아닙니다. 코드 수정 요청은 여전히 일반 Observe, Session 또는 Run lane으로 진입합니다. Canon 개정 요청도 기존 exact candidate와 명시적 사용자 `ReviewDecision` 경로로 진입합니다. disposition은 execution authorization이나 recovery direction을 부여하지 않습니다.

## 대화형 흐름

사용자는 작업을 한 번 설명합니다. HEAD가 내부적으로 구조를 처리합니다.

```text
head_conformance_prepare
  -> provider HEAD semantic comparison
  -> head_conformance_propose
  -> head_conformance_queue
  -> natural-language batch disposition when useful
```

`head_conformance_prepare`는 현재 Product Canon entity를 paging하고 현재 Product Model과 선택적인 현재 World/Source/Graph baseline을 반환합니다. Graph는 절대 필수가 아닙니다. 정확하고 제한된 project-relative source digest, 검토된 ChangeSet change 하나 또는 불변 Observation 하나면 기계적 증거로 충분합니다. HEAD는 검토 가능성을 높일 때 여러 anchor kind를 사용할 수 있습니다.

Core가 disclosure를 계산합니다. 공급자와 사용자는 connector가 완전하다거나 Graph가 current라거나 Observation이 포괄적이라고 주장하지 않습니다. Finding fingerprint는 설명 문구를 제외하며 HEAD가 설명을 다르게 표현해도 동일한 Project, baseline, Canon anchor, evidence anchor, claim kind는 수렴합니다.

직접 source hashing은 하나의 diagnostic request가 MCP process를 독점하지 않도록 64 MiB로 제한합니다. 이는 해당 anchor 형식만 제한합니다. 더 큰 파일은 exact current World 또는 ChangeSet anchor를 사용할 수 있고 일반 작업은 계속됩니다.

## Disposition과 resolution

지원하는 exact-Finding disposition은 `acknowledge`, `defer`, `dismiss`, `request-code-fix`, `request-canon-revision`, `accept-resolution`입니다. 이들은 create-only linked chain을 형성합니다. 정확히 같은 최신 disposition의 반복은 수렴하고, branch 또는 tampering은 fail-closed합니다.

Source 또는 Canon drift는 열린 row를 `needs-recheck`로 바꾸며 resolution을 증명하지 않습니다. 공급자 HEAD는 `appears-resolved`, `still-present`, `uncertain` 중 하나인 정확하고 fresh한 `ConformanceResolutionCandidate`를 제출할 수 있습니다. 현재 `appears-resolved` 후보 하나에 대한 명시적 사용자 확인 `accept-resolution`만 그 정확한 Finding을 닫습니다. 이 closure는 queue 상태이지 Product Canon이나 일반 suppression rule이 아닙니다.

P4 감사 graph는 `CHECKS_AGAINST`, `EVIDENCED_BY`, `DISPOSITIONED_BY`, `REASSESSED_BY`만 사용합니다. `VIOLATES`, `CONFORMS_TO`, `SATISFIES`, `RESOLVED`를 자동으로 내보내지 않으며 candidate node는 기본 product traversal에서 숨겨집니다.

## 선택적 Host trigger

`ConformanceTriggerRegistry`는 검증된 `change-set`, `observation`, `release-observation`, `refresh-receipt` identity 위의 process-local 공급자 중립 구성입니다. project code를 로드하지 않고 source alias, project path, credential, provider identity, process identity, cursor를 Project에 지속하지 않습니다.

기본 mode는 `opportunistic`입니다. Host는 background provider execution 없이 자연스러운 대화 경계에서 queued evidence를 준비합니다. `monitor`와 자동 provider assessment에는 명시적 사용자 opt-in이 필요합니다. Host trigger delivery 자체는 Finding을 만들지 않습니다. 공급자 HEAD가 여전히 의미 평가를 수행하고 Core가 여전히 proposal을 검증합니다.

중복 trigger는 queued evidence와 pending evidence 전체에서 수렴합니다. 빈 queue는 pending batch를 만들지 않고 idle을 반환합니다. Refresh receipt는 omission count와 함께 queued verified receipt 중 최신 항목으로 coalesce됩니다. 준비된 batch는 Host가 complete로 표시할 때까지 안정적입니다. delivery 또는 provider outcome이 uncertain이면 automatic replay와 completion이 중단되며, 명시적 사용자 retry decision만 uncertain state를 지울 수 있습니다. Host adapter 하나를 사용할 수 없어도 optional-capability disclosure를 반환하고 일반 HEAD 작업은 계속됩니다.

## CLI와 typed MCP

일반 대화는 typed MCP를 사용합니다. CLI는 신뢰된 자동화와 진단에 계속 사용할 수 있습니다.

```text
head conformance-prepare <project>
head conformance-propose <project> --input <provider-head-proposal.json>
head conformance-queue <project>
head conformance-read <project> --finding <conformance-finding-id>
head conformance-disposition <project> --input <user-confirmed-disposition.json>
head conformance-resolution-propose <project> --input <provider-head-resolution.json>
```

페이지에는 최대 64개 entity 또는 Finding이 포함됩니다. 이는 output bound이며 eligibility, registration, persistence gate가 아닙니다. opaque cursor로 65번째 이후 항목도 노출합니다.

## Acceptance property

- lexical overlap, file name, test presence, document class, Graph availability, connector availability, coverage class, risk hint, queue length은 candidate eligibility나 일반 작업 차단을 결정하지 않습니다.
- Core는 exact source, ChangeSet, Observation, Graph anchor를 독립적으로 또는 함께 수용합니다.
- candidate 생성, status, disposition, resolution, Host trigger 동작은 Product Canon, `ReviewDecision`, Session pointer, checkpoint, execution authorization을 변경하지 않습니다.
- stale baseline은 mutation만 거부하고 HEAD에게 read-only preparation을 반복하라고 안내합니다.
- stale read-only cursor는 사용자 절차 없이 재동기화합니다.
- wording만 다른 중복 claim은 exact semantic anchor fingerprint로 수렴합니다.
- source drift는 `needs-recheck`를 만들며 자동 resolution을 만들지 않습니다.
- resolution은 fresh exact evidence가 필요하며 Finding 하나를 닫으려면 명시적 사용자 확인이 필요합니다.
- Host monitor execution은 opt-in이고, duplicate delivery는 수렴하며, uncertain outcome은 auto-replay되지 않고, Host state는 Project 밖에 남습니다.
- CLI와 MCP는 같은 Core identity를 반환하며 65번째 항목도 접근할 수 있습니다.
