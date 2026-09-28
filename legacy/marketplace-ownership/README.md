# Historical marketplace ownership proof

This standalone, read-only development tool recognizes exactly two generated
marketplace snapshots from source `e496d9621dc6b39fe05dc454d6258084caeb6a52`.
They contain supervisor manifest schema 1 / version 0.1.0. The current runtime
requires schema 2 / version 0.3.0 and must continue rejecting those old manifests.

The publication workflow first runs current snapshot verification. Only its
**existing-branch ownership** failure path invokes this tool. It checks the exact
expected repository, marketplace, provider and historical branch commit, plus:

- A pinned SHA-256 of the entire snapshot inventory, including empty directories.
- The independently verified Git blob identity and fields of the generated marker.
- The exact historical supervisor schema, manifest ID and hash.
- All five targets' worker, supervisor and bridge manifests and binary hashes.
- Native build commit/version identity.

Inventory entries are sorted by JavaScript string comparison of slash-separated
relative paths. Directories use `{path,type:"directory"}`; files use
`{path,type:"file",bytes,sha256}` in that insertion order. Hash the UTF-8 bytes of
`JSON.stringify(entries)`. Root is excluded. Links and other entry types fail.
This pins every byte of the distribution inventories and catalog too; recomputing
a changed manifest or marker cannot make a tampered snapshot pass.

This is not an installation route, execution permission, generic legacy loader,
or a new source of Product/HEAD authority. No old binary or snapshot script is
executed. No runtime module imports this folder; `legacy/` is excluded from plugin
distributions. Current packaging and runtime APIs are unchanged. CI's existing
expected-remote-SHA publication lease is unchanged.

Do not auto-add pins for an unfamiliar branch or version. New pins require a
separate source audit. Once both old branches have been replaced and independently
verified, this one-time fallback can be retired in a later reviewed change.

Run synthetic counterexamples with:

```sh
node --test legacy/marketplace-ownership/test/ownership.test.mjs
```
