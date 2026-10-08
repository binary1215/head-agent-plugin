# HEAD Context Compiler design

The Compiler packages selected evidence; HEAD decides relevance, sufficiency,
expansion and completion. Ordinary reading, fixes and Host delegation do not
require a Capsule, a Run, an inclusion proof or another approval.

## Selected context

`head_context_prepare` returns source-linked context for the exact user task.
`head_context_preview` accepts optional HEAD-authored `EvidenceNeed[]` guidance.
Users do not write JSON or choose anchors. Both calls are read-only and return
`ready_for_head_semantic_assessment`, which is advice to HEAD, not a proof of
sufficiency or an execution gate.

```text
Current originals -> bounded selection -> context + sources + omissions
                                                    -> HEAD assessment
```

The returned Capsule includes its exact task and Project, current shared direction,
selected records, original sources, digests, provenance and approximate budget.
`evidenceGaps`, `omissions` and `uncertainty` disclose missing requested evidence,
excluded material and limitations. No coverage-proof state machine is produced.
A metadata carrier is not proof that its source body was included or read.
HEAD inspects original bodies when the judgment depends on them.

## Guidance and expansion

Optional needs can name exact repository `paths`, Product Canon `entityKeys`,
immutable `observationIds`, or an exact current `graphAnchor`.
Core checks Project and source binding; it does not infer product meaning,
choose a semantic anchor or impose a universal code/test/document rule.
Lexical matching is fallback navigation, never evidence eligibility or semantic
acceptance. Zero overlap does not remove a current source candidate.

Exact guidance prioritizes selected evidence while preserving unmet requests.
A small result can still be inadequate. HEAD may inspect originals, expand useful
relations or choose a larger budget without manufacturing another approval.
An absent or stale World is disclosed and excluded; current local source inspection
and selected source observations remain available without Product activation.
A stale exact graph anchor fails only that dependent request.

For graph discovery, the default is a short core response. Request `details: true`
with returned anchors when original payloads or nearby relations are useful.
Current/historical revisions, candidates, rejection state and coverage remain
distinct. See [graph discovery](graph-discovery.md).

## Budget

Budget protocol `2.0.0` accepts any positive safe integer. The default is
`32768` approximate tokens, not a prescribed tier or minimum task size.
There are no fixed five tiers, automatic tier retry chain or 512K policy ceiling.
The estimate is `ceil(UTF-16 code units / 4)`; it is not provider-token fit.
The runtime still respects the actual provider context window and output reserve.

One preview performs one selection. The limit, inputs and compiler version
participate in reproducible Capsule identity. Deliberate persistence is available
for a durable handoff or managed Run; ordinary preparation writes nothing.

## Authority and recovery

Selected source, Observation, ProductContext and graph relations are evidence,
not permission or recovery direction. Repository text cannot override current
user direction. Product candidates cannot become Canon through compilation.
ExecutionContract creation records HEAD's separate acceptance; it does not
require a mechanical inclusion certificate.

The current Capsule reader verifies content identity and the logical Project.
Historical records retain their original fields and identity through the narrow
read path; old proof fields are not recreated or an execution prerequisite.
Current cancellation and affected source conflicts remain separate checks.
An intact historical Capsule is not automatic authorization for a current effect.
See [authority planes](authority-plane-contract.md).

## Source and World coverage

Current World evidence can provide bounded symbols, dependencies, ProductContext,
Git history, runtime observations and exact graph traversals. All source revisions
and omissions remain explicit. Neither heuristic nor static AST relations prove
runtime truth. Missing/stale indexes do not block direct work.

`head_source_context` supports task-scoped current source and Python static
declaration/call observations without a full scan. Retention is optional;
raw source is not a Product concept. For collector scope, unresolved calls,
parser failures and original-source retention, see
[Observation adapters](observation-adapters.md).

The implementation and local fixtures establish packaging, identity, omission
and read-only behavior. They do not establish model quality, provider-token
savings, live database behavior or real-provider speed.
