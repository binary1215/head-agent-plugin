# Product Operating Loop

Status: implemented minimal vertical under Product Operating Loop protocol `0.3.0`, with digest-readable `0.1.0` and `0.2.0` compatibility.

The Product Operating Loop connects product learning to reviewed execution without turning observations, model inference, GraphDB, or a continuity summary into HEAD or user authority.

## Development spine and operating flow

The implementation keeps two semantic directions without creating two competing authorities. The development spine is the top-down normative path from `Product Canon` and its explicit `ReviewDecision` records into reviewed product-to-code relations. The operating flow is the time-ordered evidence path through initiative review, execution, `ChangeSet`, and `OutcomeObservation`. Their intersection is an exact verified identity or relation in the P4 graph, never a copied authority record. Code or runtime observations can create P3 evidence and candidates, but cannot rewrite the development spine.

Provider-neutral `BranchStateObservation`, `DeploymentResultObservation`, and `ReleaseObservation` ingestion now extend the operating flow as bounded P3 evidence. Their existence or timing cannot create product approval, Product Canon, success judgment, or recovery direction. `AnalyticsEvent` ingestion remains a disclosed capability gap rather than an inferred or simulated loop closure. See [Release observation](release-observation.md).

## Authority split

The loop uses five epistemic classes:

| Class | Artifact | Authority effect |
| --- | --- | --- |
| observed fact | `ProductSignal` | evidence only |
| hypothesis | `ProductHypothesis` | no decision authority |
| inferred meaning | `ProductInitiativeCandidate`, `ProductFeatureCandidate` | candidate only |
| approved decision | `ReviewedProductInitiative` | explicit reviewed initiative; not Product Canon |
| derived projection | Product Graph and `HEADContinuitySnapshot` | rebuildable reference view only |

`ProductSignal → ProductHypothesis → ProductInitiativeCandidate` is a reasoning trail, not an authority chain or a required persistence chain. Everyday observations, hypotheses, and inferred meanings default to a non-persisted `ProductLearningNote` with no content identity and no graph rebuild. Persist Signal/Hypothesis artifacts only at cross-Run, rebuttal/audit, product-state, or handoff/context-loss boundaries. A Product Initiative becomes reviewed only through an explicit `ReviewDecision` with `decisionScope: product-initiative`. Product Canon remains `.head/context/product-model.json` and is not mutated by this flow.

A durable `ProductHypothesis` may now cite exact `ObservationRecord` or `DerivedObservationRecord` identities through `observationIds`, with or without a separately persisted `ProductSignal`. This removes manual restatement of already verified evidence without letting an adapter author meaning: HEAD still writes the hypothesis, and the reference grants no review, promotion, success, or recovery authority.

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

The persisted Signal/Hypothesis path remains available for explicit audit boundaries. The lighter path may create an immutable `ProductInitiativeCandidate` directly from explicit inline reasoning. It may defer Feature resolution until accept review, so no `ProductFeatureCandidate` exists before the user decision. The reviewed Initiative preserves the candidate's title, description, reasoning, and hypothesis references byte-independently while adding exactly one `existing-feature | candidate | gap` resolution in the separate reviewed artifact.

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

Repeated `product-operating-status` and `head-continuity` reads in the same process use a disclosed verified-snapshot cache keyed by the Product Operating projection identity and World Model content identity. A Core write invalidates the cache. Use `--fresh` or MCP `fresh: true` to force full artifact and World Model verification. Cache state is operational only and is never authority or recovery evidence.

## CLI

`head help` exposes the light default below. `operating-lane-recommend` is an
optional advisory aid, never an execution gate. Use `head help-all` to discover
the durable Signal/Hypothesis, audit, compatibility, and recovery surfaces.

```text
head operating-lane-recommend <project> --input <risk.json>
head product-note <project> --input <note.json>
head product-signal-record <project> --input <signal.json>
head product-hypothesis-record <project> --input <hypothesis.json>
head product-initiative-propose <project> --input <initiative.json>
head product-initiative-review <project> --input <review.json>
head product-outcome-observe <project> --input <outcome.json>
head product-operating-status <project> [--fresh]
head head-continuity <project> [--fresh]
```

The record/review/observe commands rebuild the local World Model and Product Graph in the same operation. They do not activate a remote GraphDB.

## MCP

The typed MCP surface is:

- `head_operating_lane_recommend`
- `head_product_note`
- `head_product_signal_record`
- `head_product_hypothesis_record`
- `head_product_initiative_propose`
- `head_product_initiative_review`
- `head_product_outcome_observe`
- `head_product_operating_status`
- `head_continuity_snapshot`

The default conversational surface is optional `head_operating_lane_recommend`, `head_product_note`, Initiative proposal/review when durable product action is needed, and status. The seven original record/observe/read tools remain compatible explicit surfaces rather than a mandatory ritual.

Initiative review requires `confirm_user_review: true`. The confirmation records user-owned review authority; MCP availability alone does not grant it.
