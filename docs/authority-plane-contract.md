# Authority planes and the Graph/record boundary

Read [`ULTIMATE_GOAL.md`](ULTIMATE_GOAL.md) before changing this contract.

Status: active, executable contract

Protocol version: `0.2.0`

Digest-valid `0.1.0` embedded boundaries remain readable for upgrade continuity;
new builders emit `0.2.0`. The only legacy classification retained by the reader
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
| P3 Evidence Record | reviewable results, observations, candidates, claims, and audit receipts | ResultPacket, WorkerReport, CandidateSet, FeatureCandidate/ProductFeatureCandidate, PolicyCandidate, Evidence, DocumentCanonApplicationReceipt, RunResultIntegrationRequest/Receipt | evidence cannot promote itself or become recovery canon |
| P4 Derived Relation/View | reproducible retrieval and human-facing views | GraphSnapshot, GraphDB projection, TraversalResult, Markdown/Document projection, HEADContinuitySnapshot, SessionRestoreProjection | a projection cannot mutate Canon, grant instruction authority, or be the only recovery source |
| P5 Operational Effect | host-local process and delivery effects | PID, token, proof, lease, endpoint, inbox, delivery receipt, provider-session reference | successful delivery or process control cannot authorize execution, review, promotion, or recovery |

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

- a Capsule may include a bounded graph traversal only with false instruction and
  promotion authority;
- unreviewed candidates remain excluded from default traversal and compilation;
- provider summaries, continuity views, inbox messages, and replies cannot change
  checkpoint fields or create a ReviewDecision;
- a remote GraphDB can accelerate a verified query but cannot reconstruct Product
  Canon after the local normative and recovery records are lost.

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
