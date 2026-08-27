> 이 문서는 영어 원문 [`change-sets.md`](../change-sets.md)의 한국어 번역입니다.

# 제공자 중립적 ChangeSet 및 검토된 영향

이 계약을 변경하기 전에 [`architecture.md`](architecture.md)와
[`authority-plane-contract.md`](authority-plane-contract.md)를 읽으세요.

## 목적과 권한

ChangeSet protocol `0.1.0`은 Git commit, branch, provider 또는 executor attempt와 독립적으로 검토된 하나의 logical change를 기록합니다. ChangeSet은 다음으로부터만 생성됩니다.

- ExecutionContract ContextCapsule에 고정된 검증된 World Model 및 temporal GraphSnapshot;
- 서로 다른 현재의 post-execution World Model 및 SourceSnapshot;
- 일치하는 ResultPacket;
- 수락된 execution ReviewDecision.

ChangeSet은 추가, 수정 및 제거된 `File`, `Symbol`, `Test` revision을 정확히 기록합니다. 검토된 change-lineage status를 갖지만 instruction authority 또는 promotion authority는 없습니다. operational World Model identity는 선택적 Git, runtime 또는 physical projection input을 포함할 수 있으므로 ChangeSet body에서 제외됩니다. Git과 독립적인 GraphSnapshot, SourceSnapshot, revision, ResultPacket 및 ReviewDecision identity가 semantic record를 구성합니다. Git은 나중에 선택적 `VcsEvidence`를 첨부할 수 있으며, `.git` directory 또는 commit identity는 필요하지 않습니다.

## 2단계 identity 경계

pre-change snapshot과 post-change snapshot은 ChangeSet이 존재하기 전에 고정됩니다. 그런 다음 후속 World Model rebuild가 ChangeSet을 projection합니다. 이는 자기 참조적인 graph identity를 방지합니다. ChangeSet을 추가하면 GraphSnapshot 및 World Model projection은 변경되지만 이미 고정된 observed SourceSnapshot identity는 변경되지 않습니다.

ChangeSet은 정렬된 0개 이상의 `parentChangeSetIds`를 포함합니다. protocol `0.1.0`부터 여러 parent가 유효합니다. automatic merge, ancestry discovery, conflict detection 및 conflict resolution은 계속 유예됩니다.

## 영향 candidate 및 review

plugin은 정확한 before/after revision을 비교하고, 기존에 검토된 `IMPLEMENTS` 및 `VERIFIED_BY` receipt만 따라 Feature 또는 Capability impact를 추론합니다. inference는 불변 `ChangeImpactCandidateSet`을 생성하며, `IMPACTS`를 직접 생성하지 않습니다.

명시적 change-impact ReviewDecision은 다음 중 하나를 수행할 수 있습니다.

- `accept-all`;
- 지정된 candidate ID와 함께 `accept-selection`;
- `reject`.

acceptance는 별도의 불변 `ReviewedImpact` receipt와 검토된 `ChangeSet -[:IMPACTS]-> Feature|Capability` edge를 생성합니다. rejection은 canonical impact edge를 생성하지 않습니다. candidate node는 일반 traversal과 모든 Context Capsule에서 계속 제외됩니다. 명시적 read-only traversal은 이를 포함하도록 선택할 수 있습니다.

변경된 code 또는 test를 Product Canon에 연결하는 검토된 mapping이 없으면 candidate set은 열린 Unknown을 기록하고 `awaiting-evidence` 상태로 유지됩니다.

## 선택적 VCS 증거

VCS evidence protocol `0.1.0`은 명시적으로 선택된 하나 이상의 Git commit observation을 기존 ChangeSet에 첨부합니다. attachment command는 현재 다이제스트가 검증된 `GitDecisionHistory`에 존재하는 commit object ID만 허용합니다. timestamp, message, diff, branch name 또는 executor session에서 equivalence를 추론하지 않습니다.

불변 `VcsEvidence` artifact는 정규화된 `GitCommitObservation` record와 이를 검증한 Git-history identity를 포함합니다. 이를 통해 `.git`, Git executable 또는 원래의 history adapter를 사용할 수 없는 경우에도 나중에 GraphSnapshot을 재구성할 수 있습니다. attachment는 ChangeSet을 편집하지 않으며 그 hash에 Git identity를 추가하지 않습니다. 다음 항목만 projection합니다.

```text
ChangeSet -MATERIALIZED_AS-> VcsEvidence -REFERENCES-> GitCommit
```

이러한 node와 edge는 `instructionAuthority: false`, `promotionAuthority: false`, `evidence-not-instruction`을 갖는 derived evidence입니다. commit은 ChangeSet도 아니며 implementation이 Product Canon을 충족한다는 증거도 아닙니다. missing history, unknown commit ID, source drift, artifact tampering 및 active/pending Run conflict가 있으면 attachment는 fail-closed 방식으로 실패하며, Git과 독립적인 모든 operation은 계속 사용할 수 있습니다.

## 명령

```text
node scripts/head.mjs change-set-record <project> --input <change-set.json>
node scripts/head.mjs change-set-status <project>
node scripts/head.mjs change-set-read <project> --change-set <change-set-id>
node scripts/head.mjs change-impact-candidates <project> --candidate-set <candidate-set-id>
node scripts/head.mjs change-impact-review <project> --input <review.json>
node scripts/head.mjs change-impact-review-read <project> --review <review-decision-id>
node scripts/head.mjs change-set-vcs-attach <project> --input <vcs-evidence.json>
node scripts/head.mjs change-set-vcs-read <project> --vcs-evidence <vcs-evidence-id>
```

최소 recording input:

```json
{
  "resultPacketId": "result-packet-<24-hex>",
  "reviewDecisionId": "review-decision-<24-hex>",
  "parentChangeSetIds": []
}
```

`beforeWorldModelId`는 선택 사항입니다. 생략하면 core가 ExecutionContract ContextCapsule에 고정된 정확한 World Model을 복구합니다. 현재 post-change World Model은 fresh 상태여야 하고 서로 다른 SourceSnapshot을 포함해야 합니다.

review input:

```json
{
  "candidateSetId": "change-impact-candidates-<24-hex>",
  "disposition": "accept-all",
  "acceptedCandidateIds": [],
  "rationale": "Reviewed revision evidence supports the impact."
}
```

VCS evidence attachment input:

```json
{
  "changeSetId": "change-set-<24-hex>",
  "commitIds": ["<40-or-64-hex-git-object-id>"],
  "rationale": "This verified commit observation materializes the reviewed logical change."
}
```

읽기 전용 MCP tool `head_change_set_status`와 `head_vcs_evidence`는 어떤 것도 기록, 검토 또는 promote하지 않고 검증된 state와 attachment를 노출합니다.

## 프로젝트 아티팩트

```text
.head/change-sets/current.json
.head/change-sets/records/change-set-*.json
.head/change-sets/impact-candidate-sets/change-impact-candidates-*.json
.head/change-sets/impact-review-decisions/change-impact-review-decision-*.json
.head/change-sets/vcs-evidence/vcs-evidence-*.json
```

모든 artifact와 pointer는 콘텐츠에서 파생되고 다이제스트로 검증됩니다. source drift, 수락되지 않은 execution review, 일치하지 않는 ResultPacket/ReviewDecision, 누락된 pinned snapshot, stale candidate identity, tampering, active/pending Run conflict 및 빈 revision difference는 fail-closed 방식으로 실패합니다.

## 유예된 경계

CI 또는 filesystem event로부터 ChangeSet 자동 생성, 추론된 commit-to-ChangeSet matching, 일반 execution-lineage graph projection, merge automation, imported ticket/backlog adapter, conformance finding, document review receipt를 이후 graph에 projection하는 작업, Obsidian/Notion projection 및 GraphDB acceleration은 계속 유예됩니다. 명시적 DocumentChangeCandidate review/application은 활성화되어 있지만 ChangeSet을 생성하거나 ChangeSet authority를 변경하지 않습니다.
