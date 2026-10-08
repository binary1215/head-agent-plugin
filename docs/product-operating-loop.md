# Product Operating Loop

## Neutral evidence references

New ProductHypothesis artifacts alone use protocol 0.5.0 and a required
referenceSemantics value of neutral. Their Signal and Observation links are
REFERENCES, not a mechanical claim that every citation supports the hypothesis.
HEAD explains support, challenges, and uncertainty in the existing rationale;
no evidence-role form is required. Other operating artifacts remain at 0.4.0.
Historical hypotheses retain their bytes, hashes, and SUPPORTED_BY interpretation.
The new reader accepts them without migration. Older readers reject the new
hypothesis version instead of silently assigning old semantics. Mixed-version
writers/readers are not supported for operations that consume these new artifacts;
ordinary independent work is unaffected. Measurement trace follows both relations.

Status: implemented minimal vertical under Product Operating Loop protocol `0.4.0`, with digest-readable `0.1.0`, `0.2.0`, and `0.3.0` compatibility.

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

`ProductSignal → ProductHypothesis → ProductInitiativeCandidate` is a reasoning trail, not an authority chain or a required persistence chain. Everyday observations, hypotheses, and inferred meanings remain plain conversation content with their evidence; they need no formatting API, content identity, or graph rebuild. Persist Signal/Hypothesis artifacts only at cross-Run, rebuttal/audit, product-state, or handoff/context-loss boundaries. A Product Initiative becomes reviewed only through an explicit `ReviewDecision` with `decisionScope: product-initiative`. Product Canon remains `.head/context/product-model.json` and is not mutated by this flow.

A durable `ProductHypothesis` may now cite exact `ObservationRecord` or `DerivedObservationRecord` identities through `observationIds`, with or without a separately persisted `ProductSignal`. This removes manual restatement of already verified evidence without letting an adapter author meaning: HEAD still writes the hypothesis, and the reference grants no review, promotion, success, or recovery authority.

Observation storage remains optional and isolated. Product Operating projection and signal-only flows do not load or validate it unless a durable hypothesis actually cites an exact Observation ID. Once cited, current Observation integrity and receipt lineage fail closed as before.

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

The persisted Signal/Hypothesis path remains available for explicit audit boundaries. The lighter path may create an immutable `ProductInitiativeCandidate` directly from explicit inline reasoning. It may defer Feature resolution until accept review, so no `ProductFeatureCandidate` exists before the user decision. The reviewed Initiative preserves the candidate's title, description, reasoning, and hypothesis references byte-independently while adding exactly one `existing-feature | candidate | gap` resolution in the decision-derived reviewed view.

The current Initiative `ReviewDecision` records the exact candidate and Feature
selection once. The reviewed initiative and Feature candidate are reconstructed
read-only from that record rather than stored as duplicate decisions.
The project-local P5 writer lease serializes competing publication; exact retry
reuses the decision without another write. Historical original outputs remain
readable; an absent deferred legacy selection is never guessed.

These are mutation-integrity checks, not additional user gates. The existing explicit review remains the only authority boundary, ordinary reads and work remain available, and transient writer contention is handled internally without changing Product Canon or P2 recovery direction.

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

`head help` exposes Core work and recovery. Reason about risk directly and keep
ephemeral facts, hypotheses, inferences and their evidence in the conversation.
Use `head help-all` only when durable Signal/Hypothesis, audit or recovery work is
needed. HEAD chooses means and expresses ephemeral learning directly; no Core
lane classifier or note-formatting operation is retained.

```text
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

HEAD works directly by default and uses ordinary Host delegation when useful.
Managed execution is selected only when actual recovery/effect tracking requires
it; worker count is not a risk score. Existing protected transitions verify their
own authority, rather than trusting a lane recommendation.

The optional typed MCP catalog includes:

- `head_product_signal_record`
- `head_product_hypothesis_record`
- `head_product_initiative_propose`
- `head_product_initiative_review`
- `head_product_outcome_observe`
- `head_product_operating_status`
- `head_continuity_snapshot`

The default MCP list focuses on Core and recovery. Find a needed schema through
`head_tools_discover` (exact name or returned prefix) and call its `invokeWith`
route, `head_tools_read` or `head_tools_call`. These stateless routes preserve the
same original dispatch, authority checks and results; no activation, registration
or extra user approval is added. Read-only calls retain a separate read-only route.
Discovery can be skipped when HEAD already knows the contract. Managed mutations
use the explicit managed route when useful for durable work: `head_tools_call`
with `execution_mode: "managed"`, preserving the original checks without user unlock.

Initiative review requires `confirm_user_review: true`. The confirmation records user-owned review authority; MCP availability alone does not grant it.
