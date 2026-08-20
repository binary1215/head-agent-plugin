# Product Operating Loop

Status: implemented minimal vertical in `0.3.0-alpha.64`.

The Product Operating Loop connects product learning to reviewed execution without turning observations, model inference, GraphDB, or a continuity summary into HEAD or user authority.

## Authority split

The loop uses five epistemic classes:

| Class | Artifact | Authority effect |
| --- | --- | --- |
| observed fact | `ProductSignal` | evidence only |
| hypothesis | `ProductHypothesis` | no decision authority |
| inferred meaning | `ProductInitiativeCandidate`, `ProductFeatureCandidate` | candidate only |
| approved decision | `ReviewedProductInitiative` | explicit reviewed initiative; not Product Canon |
| derived projection | Product Graph and `HEADContinuitySnapshot` | rebuildable reference view only |

`ProductSignal → ProductHypothesis → ProductInitiativeCandidate` is a reasoning trail, not an authority chain. A Product Initiative becomes reviewed only through an explicit `ReviewDecision` with `decisionScope: product-initiative`. Product Canon remains `.head/context/product-model.json` and is not mutated by this flow.

## Minimal connected flow

```text
ProductSignal (observed-fact)
  -> ProductHypothesis (hypothesis)
  -> ProductInitiativeCandidate (inferred-meaning)
  -> explicit user ReviewDecision
  -> ReviewedProductInitiative (approved-decision, not Product Canon)

Feature resolution:
  existing-feature -> exact current Product Canon Feature key
  candidate        -> separate ProductFeatureCandidate
  gap              -> explicit reason; no forced one-to-one mapping

accepted execution ReviewDecision + ResultPacket -> ChangeSet
  -> OutcomeObservation (observed-fact or derived-projection)
  -> HEAD reevaluates product meaning and success
```

An `OutcomeObservation` must reference a ChangeSet whose `ResultPacket` has an accepted execution `ReviewDecision`. It can also reference a reviewed Initiative. It cannot mark a Feature successful, change Feature status, or promote Product Canon.

## Product Graph boundary

The World Model projects the artifacts as `ProductSignal`, `ProductHypothesis`, `ProductInitiativeCandidate`, `ProductInitiativeReviewDecision`, `ReviewedProductInitiative`, `ProductFeatureCandidate`, and `OutcomeObservation` nodes. `SUPPORTED_BY`, `PROPOSES_FROM`, `PROPOSES_TO`, review/promotion relations, and `OBSERVES` keep the path queryable.

This graph is `derived-evidence-only`. Local JSON is sufficient. GraphDB is an optional materialization and cannot own orchestration, tool routing, context selection, ReviewDecision, or product meaning.

## HEAD continuity boundary

`HEADContinuitySnapshot` is built on demand and is never written to project storage. It contains exact references to current Project, Session, Run, WholePlan, ExecutionContract, ResultPacket, ReviewDecision, checkpoint, Product Model, World Model, and product-operating identities when present.

It has all of these fixed properties:

- `persisted: false`
- `recoveryAuthority: false`
- `instructionAuthority: false`
- `promotionAuthority: false`
- `objectiveRewrite: false`

Recovery authority remains `.head/sessions/current.json`, Run canon, and Session/Run checkpoints. The snapshot cannot replace continuous HEAD whole-outcome judgment.

## CLI

```text
head product-signal-record <project> --input <signal.json>
head product-hypothesis-record <project> --input <hypothesis.json>
head product-initiative-propose <project> --input <initiative.json>
head product-initiative-review <project> --input <review.json>
head product-outcome-observe <project> --input <outcome.json>
head product-operating-status <project>
head head-continuity <project>
```

The record/review/observe commands rebuild the local World Model and Product Graph in the same operation. They do not activate a remote GraphDB.

## MCP

The typed MCP surface is:

- `head_product_signal_record`
- `head_product_hypothesis_record`
- `head_product_initiative_propose`
- `head_product_initiative_review`
- `head_product_outcome_observe`
- `head_product_operating_status`
- `head_continuity_snapshot`

Initiative review requires `confirm_user_review: true`. The confirmation records user-owned review authority; MCP availability alone does not grant it.
