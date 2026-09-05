# Authority planes and the Graph/record boundary

Read [`architecture.md`](architecture.md) before changing this contract. Runtime
direction comes from user-owned project authority, not repository-development
history or validation fixtures.

Status: active, executable contract

Protocol version: `0.6.0`

Digest-valid `0.1.0`, `0.2.0`, `0.3.0`, `0.4.0`, and `0.5.0` embedded boundaries remain readable for upgrade continuity;
new builders emit `0.6.0`. The only legacy classification retained by the reader
is the former generic Feature/Policy naming, never used to promote a new artifact.

## Why this boundary exists

HEAD Agent Core coordinates meaning, recovery, evidence, derived retrieval, and
live effects without allowing one representation to inherit another's authority.
The five planes below classify semantic artifacts. `Distribution` and `Host` are
separate architectural planes: they package or execute these contracts but never
become an additional source of product meaning or recovery direction.

| Plane | Ownership | Representative artifacts | Forbidden inference |
|---|---|---|---|
| P1 Normative Authority | approved product meaning, policy, and explicit decisions | Product Canon, ProductModelRevision, ProductCanonFeature/ReviewedFeature, PolicyCanon/ReviewedPolicy, ReviewDecision | existence in a graph, message, result, or host cannot create approval |
| P2 Canonical Recovery/Lineage Record | provider-independent recovery of Project, Session, Run, plan, context, contract, and next direction | Project, HeadSession, Run, WholePlanSnapshot, ContextCapsule, ExecutionContract, SessionRunCheckpoint | evidence deletion or provider summary cannot rewrite checkpoint fields |
| P3 Evidence Record | reviewable results, observations, candidates, claims, ownership records, and audit receipts | ResultPacket, WorkerReport, BoundedWorkerDispatch, BoundedWorkerWave/Seal/Abandonment, CandidateSet, FeatureCandidate/ProductFeatureCandidate, PolicyCandidate, Evidence, ObservationTypeDescriptor/ObservationRecord/DerivedObservationRecord/ObservationCollectionReceipt, ConformanceFindingCandidate/DispositionReceipt/ResolutionCandidate, BranchStateObservation, DeploymentResultObservation, ReleaseObservation, DocumentCanonApplicationReceipt, RunResultIntegrationRequest/Receipt | evidence cannot promote itself or become recovery canon |
| P4 Derived Relation/View | reproducible retrieval and human-facing views | GraphSnapshot, GraphDB projection, TraversalResult, GraphLineageStatusProjection/TraceProjection/DiffProjection, Markdown/Document projection, HEADContinuitySnapshot, SessionRestoreProjection, WorkerWaveStatusProjection/ResultProjection, ObservationStatusProjection, ObservationSourceDiscoveryProjection, ObservationPreparationProjection, ConformancePreparationProjection/QueueProjection/FindingGraphProjection/TriggerBatchProjection | a projection cannot mutate Canon, grant instruction authority, or be the only recovery source |
| P5 Operational Effect | host-local process, continuation, wait, and delivery effects | PID, token, proof, lease, endpoint, inbox, delivery receipt, ContinuationOutcome, BoundedWorkerWaitOutcome, BoundedWorkerWaveWaitOutcome, ObservationSourceBinding, ConformanceTriggerBinding, provider-session reference | successful continuation, waiting, delivery, or process control cannot authorize execution, review, promotion, or recovery |

`scripts/lib/authority-plane-contract.mjs` emits one content-derived
`AuthorityPlaneContract`, assigns the implemented artifacts above to exact planes,
and verifies embedded artifact boundaries. These are semantic classes rather than
a persistence hierarchy: P2 is authoritative for recovery but does not own P1
product meaning; P1 review does not replace P2 checkpoint state.

The boundary object's false instruction/promotion flags mean that classification
alone grants no action. A specific P1 ReviewDecision may separately carry an
exact, digest-bound scoped authorization; no other plane gains that authorization
merely by referencing or storing the decision.

## Non-amplification

The approval boundary trusts the local caller to convey an actual user decision.
Core verifies the exact target, disposition, digests, and permitted transition;
it does not authenticate a human merely because a request names the user or sets
a confirmation flag. The Host and provider HEAD must connect the user's current
decision to the unchanged candidate before calling the protected mutation.
Tool annotations describe effects, not approval. A Host that needs stronger
authentication can check its own user-action receipt before calling Core; such
receipts and provider identities stay at the Host boundary. Ordinary work does
not acquire an additional approval step.

Authority may not move upward merely because one plane points at another. A
P3 candidate may affect P1 only through an explicit, verified ReviewDecision and
the exact reviewed mutation operation. A P4 graph write is fenced by exact Product
Canon bytes; if an adapter changes or deletes those bytes, Core restores them and
fails with `GRAPH_PROJECTION_AUTHORITY_AMPLIFICATION` before advancing the World
Model pointer.

Candidate and reviewed product concepts have distinct names and planes. A generic
or unreviewed Feature/Policy is never classified as P1 merely because a graph node
uses that label. Only a Product Canon or separately reviewed Feature/Policy is P1;
FeatureCandidate, ProductFeatureCandidate, and PolicyCandidate remain P3.

P3 evidence, P4 derived views, and P5 operational effects cannot be promoted into
P2 recovery authority at all. A checkpoint may reference evidence for audit, but
its recovery fields come only from explicit HEAD/user direction and verified P2
lineage. ResultPacket, GraphSnapshot, continuity, inbox, or provider-session state
cannot supply or rewrite those fields.

The same rule applies in context and coordination:

- a provider HEAD semantic product proposal is P3 evidence; Core may verify and
  normalize it into an immutable candidate set, but it cannot create Product
  Canon or a ReviewDecision;
- a Capsule may include a bounded graph traversal only with false instruction and
  promotion authority;
- the non-persisted ContextWorkflowProjection is advisory UX over one Capsule
  preview rather than a new semantic artifact; it follows P4 non-amplification
  constraints and may repeat the same read-only compile at the next fixed tier
  only for proven `context-budget` exclusion, but cannot select EvidenceNeeds,
  exceed 512K, invoke a provider, mutate state, assess semantic sufficiency,
  grant authorization, or write recovery direction;
- the non-persisted ContextPreparationProjection is P4 candidate visibility,
  not semantic inference: it accepts task text only, exposes bounded current
  identities and lexical discovery material, and lets provider HEAD author the
  structured proposal without requiring user JSON. It cannot choose
  EvidenceNeeds or graph anchors, persist provider/session identity, or write
  P2 direction. Any later preview revalidates Project/World/Graph drift;
- unreviewed candidates remain excluded from default traversal and compilation;
- provider summaries, continuity views, inbox messages, and replies cannot change
  checkpoint fields or create a ReviewDecision;
- a remote GraphDB can accelerate a verified query but cannot reconstruct Product
  Canon after the local normative and recovery records are lost.

Common observations preserve the same split. `ObservationTypeDescriptor`, `ObservationRecord`, `DerivedObservationRecord`, and `ObservationCollectionReceipt` are P3 evidence artifacts; `ObservationStatusProjection`, `ObservationSourceDiscoveryProjection`, and `ObservationPreparationProjection` are P4; `ObservationSourceBinding` is P5. Descriptor registration, collection, derivation, source discovery, reuse-first preparation, exact-ID Capsule inclusion, or a hypothesis reference cannot create P1 meaning or P2 direction. See [`observation-adapters.md`](observation-adapters.md).

Conformance reconciliation also preserves the split. Finding and resolution candidates plus exact-Finding disposition receipts are P3; preparation, queue, audit graph, and trigger-batch projections are P4; optional process-local trigger bindings are P5. Missing Graph, partial coverage, advisory risk, optional adapter loss, open Findings, and queue length cannot block ordinary work. Only cross-Project evidence, tampering, stale mutation input, path escape, divergent replay, or authority amplification fails the affected operation. A request to fix code still needs the ordinary execution lane, and a request to revise Canon still needs the existing exact user `ReviewDecision`. See [`conformance-reconciliation.md`](conformance-reconciliation.md).

## Graph versus record

Product semantic Canon remains P1. Core temporal `GraphSnapshot` is P4: a
content-derived, rebuildable relation and retrieval index over verified Canon and
records. Its `productModelId` and hash bind the source it projects; they do not
transfer Product Canon authority into the graph. GraphDB is only a replaceable
materialization of that exact snapshot. Deleting GraphDB and generated Markdown
must leave Product Canon, Session/Run recovery, and ReviewDecision lineage intact.

This distinction preserves the original Product Graph insight without conflating
two products: a product-knowledge model can contain semantic Canon, while HEAD
Core's temporal graph is the derived index over the Canon and execution records.
Only the former owns meaning; the latter owns navigation.

## Result and checkpoint boundary

`ResultPacket` and `WorkerReport` are P3 evidence. They can be reviewed, attached,
or deleted without changing the exact `nextExpectedResult` already frozen in a P2
`SessionRunCheckpoint`. `ReviewDecision` is P1 normative record. The checkpoint is
the recovery record. Neither substitutes for the other.

An accepted reviewed result may be connected to recovery only by the explicit
one-shot integration operation. Its caller supplies the checkpoint recovery
fields; ResultPacket and ReviewDecision are verified references, never implicit
field sources. A create-only P3 request freezes those caller-supplied fields and
the P2 checkpoint binds its ID and input hash; direct checkpoint construction
cannot bypass or diverge from that transaction. The request remains P3 provenance
and is not required to restore the resulting self-contained P2 checkpoint. The
resulting receipt remains P3, while artifact-only Session
restore is a non-persisted P4 projection of the exact P2 checkpoint and current
verified lineage.

Optional live continuation follows the same boundary. Core restores the exact P2
checkpoint first, then a P5 WorkspaceHost adapter may fresh-verify one already-
running endpoint. The non-persisted `ContinuationOutcome` reports `attached` or a
disclosed fresh logical HEAD fallback; it cannot change the SessionRestoreProjection,
persist provider identity, or claim recovery authority.

Independently ownable worker execution records one P3 `BoundedWorkerDispatch` over
the exact Run `ExecutionAuthorization`. P5 lease/process/wait state enforces
at-most-once use and reports progress, but neither dispatch nor wait can alter the
WholePlan or create a ReviewDecision. Only the resulting P3 ResultPacket reaches
Fresh HEAD; explicit P1 review and the existing reviewed-result integration are
still required before a new P2 checkpoint is written.

`BoundedWorkerWave` may group multiple such dispatches only when their exact
Project, HEAD Session, active Run, WholePlan, ExecutionContract, and Capsule
lineage is identical. It grants no authorization and each lease remains
independent. A P3 seal requires verified consumption for every member; P4 status
cannot create that seal. Wave failure, completion, abandonment, result projection,
and P5 wait cannot create P1 review or P2 recovery direction.

The executable recovery test creates a ResultPacket, prepares a checkpoint,
deletes the ResultPacket file, and verifies that the checkpoint still reproduces
the exact next expected result. This is the deletion test for the evidence/recovery
boundary, not permission to discard evidence in normal operation.

## Causal projection and no self-reference

A receipt cannot be part of the GraphSnapshot that the receipt itself names.
Document Canon application therefore uses this causal order:

```text
verified ReviewDecision
  -> exact reviewed Product Canon mutation
  -> named child World Model / GraphSnapshot
  -> immutable application receipt naming that snapshot
  -> later audit child GraphSnapshot that may project the receipt
```

Core verifies both halves: the named graph excludes the new receipt, and the
later graph has a different identity, names the earlier SourceSnapshot as a
parent, and includes the receipt. Same-snapshot inclusion fails with
`GRAPH_SNAPSHOT_RECEIPT_SELF_REFERENCE`.

## Executable acceptance criteria

- every current lineage, checkpoint, GraphSnapshot, and application-receipt
  builder emits its exact plane boundary and current readers verify it;
- P4-to-P1 promotion without an explicit ReviewDecision fails;
- a graph adapter that changes Product Canon bytes fails and Canon bytes are
  restored exactly;
- deleting ResultPacket evidence after checkpoint creation does not alter or
  prevent recovery of `nextExpectedResult`;
- the receipt is absent from its named graph and present only in a later child;
- local, in-memory, and activated GraphDB backends preserve the same semantic
  GraphSnapshot and TraversalResult identities;
- a reply creates zero ReviewDecisions, and a provider summary cannot change a
  checkpoint digest or field.
