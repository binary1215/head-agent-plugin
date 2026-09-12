# Prepared traversal fixture

This is a deterministic transport-contract fixture, not a live database or Go
performance measurement. Run `npm run benchmark:prepared-traversal -- --iterations 3`.
The ordinary JavaScript regression suite also runs the actual benchmark entrypoint
and checks that a different query still fails its exact fixture identity check.

## Reviewed identity update (2026-09-12)

The previous expectation was produced at `4b16fee92bb781b99026575f90261aecbd89006b`.
Rebuilding at `64bc17220365a45dce85662ba16ac60d7f812d7d` produces identical graph,
request, result and cost objects. Two later intentional metadata changes explain
the new expectation:

- `a6d321aae70fd0dc1321c4bb6c24b992785e88a3` changes temporal provenance 0.14 to
  0.15: historical onboarding coverage, two zero summary counts, one available
  node kind and one available relation type are added. Producer versions change
  source/edge identities and their dependent hashes. The canonical graph grows
  by 159 bytes; the topology payload size does not grow.
- `d30edcdef6d68ec4b0a019ccfd0fc1f80cbfe12e` changes the authority contract label
  from 0.6 to 0.7. This changes the graph hash and dependent request/result/cost
  identities, not the nodes, edges, query, expansion or payload lengths.

The 64-file source input is unchanged. The graph still contains 274 nodes and
480 edges; the selected result contains 6 nodes and 7 edges. An audit comparison
of all graph and selected-result records is equal after substituting each exact
source snapshot ID and removing only producer version, derived edge ID and the
SourceSnapshot state digest (which includes producer version). This normalization
is an audit explanation only: runtime and benchmark verification still compare
the complete current identities without ignoring these fields.

The source-version change also reorders hash-sorted edges, so the bounded boundary
sample is not asserted to be byte-identical. It still reports 100 boundary items,
34 omitted items and `complete: false`; it is not promoted to complete coverage.

| Canonical response component | Previous bytes | Current bytes |
| --- | ---: | ---: |
| Identity envelope | 667 | 667 |
| Graph manifest | 282 | 282 |
| Bounded expansion | 20,024 | 20,024 |
| Graph snapshot | 437,643 | 437,802 |
| Full topology records | 430,794 | 430,794 |
| Prepared query total | 20,973 | 20,973 |
| Full-reload baseline | 889,410 | 889,569 |
| Saved bytes | 868,437 | 868,596 |

Reduction remains 9,764 basis points. Three repeated builds at each audited
revision were deterministic; Windows and Ubuntu CI produced the same current
identities. Timing is diagnostic only. No runtime verification, authority check,
CI step, query limit, or receipt-replay rejection was relaxed for this update.
