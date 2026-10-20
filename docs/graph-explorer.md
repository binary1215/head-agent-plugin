# Graph Explorer

Graph Explorer makes a local, read-only picture of existing Lode evidence. Use it
to follow a purpose or recorded judgment to sources, relationships, results and
remaining questions. It is optional: ordinary work and recovery do not depend on it.

## Open a snapshot

Ask Lode: “Create a local graph snapshot for this project.” In a distribution
containing the exporter, the agent can run this from the plugin directory:

```powershell
node scripts/graph-explorer.mjs --root "<project-directory>"
node scripts/graph-explorer.mjs --root "<project-directory>" --query relay --history
```

Open the returned HTML file in a browser. No server, account, database setup or
Session binding is required. The default output is a newly created operating-system
temporary directory. An optional `--output` selects a new report file; existing
files and canonical/runtime directories cannot be overwritten. Each explicit
generation makes one report, not an automatic stream of artifacts.

## Explore the evidence

The Project layer shows recorded purposes, decisions, work and retained lineage.
The Source layer shows the existing code graph’s imports and calls. They retain
their separate original identifiers and basis; matching paths do not create new
relationships. Product and Work are filters over shared evidence, not two databases.

Start with a record from search or the list. Selecting it unfolds its existing
one-hop connections; follow another node to continue. Code neighbors expand
horizontally; purpose, product and operational records expand vertically.
These axes are layout guidance, not a new hierarchy or invented relationship.
Previously explored nodes
keep their positions. Drag a node to pin its screen position, or use `Shift` and
arrow keys on a focused node. Back, forward and the exploration path return to
visited records. These are temporary display choices, not saved product knowledge.
New automatic placements reserve room for the node and its label rows, including
when starting from a disconnected record. Manual dragging can intentionally place
nodes together; expanding another node does not undo your positioning.
Search filters only the included records; hidden-by-filter neighbors are distinct
from endpoints that were not exported. Fit map adjusts the viewport; Start here
clears the current map journey. Node distance is not a relevance score.

The detail panel starts with the recorded summary and status. Open Exact original
or Record identity & evidence for the underlying text and IDs. The same records
and relationships are keyboard-accessible in lists. Selecting a historical
Session changes this picture only; the exporter does not infer a native Host
selection or change the Session used for work.

Retained history is different from the temporary exploration path and is optional.
The history view contains a bounded retained page and an
exact snapshot comparison when available. A pair of retained IDs is not evidence
of chronological order or causality. Missing history is shown as unavailable;
opening the view never refreshes or creates it.

## What the picture knows

The generation time, snapshot basis, coverage and omissions remain visible. This
is not a live view. Empty results do not prove that no other evidence exists.
Old revisions are not replaced with current files: if the expected digest differs,
the original panel says that the exact revision is unavailable. Stale code keeps
the original-source fallback while other verified records remain available.

The Project query returns at most 60 nodes and 120 edges; the Source query returns
at most 40 nodes and 120 edges. Original text is bounded to 64 KiB per file and
256 KiB in total; the HTML export is bounded to 8 MiB. These are optional-view
resource bounds, not a judgment about sufficient task context. The existing query
may inspect more inventory than the number of records displayed. Query, original
read and rendering costs must not be confused with the output count.

## Local data and authority

The HTML contains real source snippets and recorded decisions. Treat it like
repository data when sharing it. It uses no runtime fetch, CDN, telemetry, external
image or local server. Untrusted repository text is displayed as text under a
restrictive content security policy. Explicit local read-only adapters avoid a
configured remote graph store.

The picture is a P4 derived view. It cannot approve an action, promote a candidate,
write a checkpoint, restore a Session, replay an effect or change original records.
Recorded completion and historical reviews retain their original meaning.

See [graph-first discovery](graph-discovery.md) and
[temporal provenance](temporal-provenance.md) for the underlying readers.

The [recorded context view](context-lineage.md) also follows selected work records
to cited code/documents and shows bounded exact version comparisons, recorded
reasons and missing evidence. Known original bodies are readable; raw JSON and
unknown fields remain optional diagnostics. This does not make a citation proof
of fulfillment or turn HEAD-authored work into a verbatim user message.
