# Graph Explorer

Graph Explorer makes a local, read-only picture of existing Lode evidence. Use it
to follow a purpose or recorded judgment to sources, relationships, results and
remaining questions. It is optional: ordinary work and recovery do not depend on it.

## Open a snapshot

Ask Lode: “Create a local graph snapshot for this project.” In a distribution
containing the exporter, the agent can run this from the plugin directory:

```powershell
node scripts/lode.mjs graph-explorer "<project-directory>"
node scripts/lode.mjs graph-explorer "<project-directory>" --query relay --history
node scripts/lode.mjs graph-explorer "<project-directory>" --share
```

Open the returned HTML file in a browser. No server, account, database setup or
Session binding is required. The default output is a newly created operating-system
temporary directory. An optional `--output` selects a new report file; existing
files and canonical/runtime directories cannot be overwritten. Each explicit
generation makes one report, not an automatic stream of artifacts.

The executable belongs to the plugin, but `<project-directory>` is the project
you are working on. Always pass it explicitly. Missing Project, World or source
evidence is disclosed; the exporter does not substitute Lode's code or a demo.

## Explore the evidence

The Project layer shows recorded purposes, decisions, work and retained lineage.
The Source layer shows the existing code graph’s imports and calls. They retain
their separate original identifiers and basis; matching paths do not create new
relationships. Product and Work are filters over shared evidence, not two databases.

Start with records from search, the map or the list. Click or Enter adds a record
to the selection and changes reading focus; it does not move the camera or unfold
neighbors. Ctrl/Cmd-click, a checkbox or Space toggles membership. Use Clear
selection or Select only focus explicitly. Shift-drag the map background, or turn
on Rectangle select, to add visible records; the list and keyboard can select the
same set. Escape cancels a gesture/calculation without clearing prior selection.

Expand next boundary adds the next unseen layer from the selected set. Repeating
it advances through the already exposed boundary, rather than repeatedly opening
the same one-hop neighborhood. Optional relationship/kind filters disclose the
scope. New records get positions without moving earlier records, pins, camera or
map mode. Off-screen additions stay accessible through the lists and explicit
center/fit controls. Fold last addition removes only that operation's contribution;
shared, selected, pinned and pre-existing records remain. Back/forward restores
recorded selection, scope, mode and camera stages instead of visiting and expanding
an ID again. Manual pin positions stay stable.

Code neighbors expand horizontally; purpose, product and operational records expand vertically.
These axes are layout guidance, not a new hierarchy or invented relationship.
Previously explored nodes
keep their positions. Drag a node to pin its screen position, or use `Shift` and
arrow keys on a focused node. Back, forward and the exploration path return to
earlier view stages. These are temporary display choices, not saved product knowledge.
New automatic placements reserve room for the node and its label rows, including
when starting from a disconnected record. Manual dragging can intentionally place
nodes together; expanding another node does not undo your positioning.
The initial record and a starting neighborhood open automatically. Focus selection
explicitly centers the reading focus; off-screen connections remain in the complete
paged list. Explored map explicitly fits exposed records. All evidence shows
the whole exported inventory in a Canvas overview, without creating an SVG
element for every record. Select a point or search any exact ID to focus it.
Search covers every exported record; list and connection pages are display
batches, not export limits. Filtered neighbors, off-screen neighbors and missing
endpoints have separate counts. Start here clears only the temporary journey.
Search highlights matches and narrows the result list; hiding nonmatches is a
separate checkbox. Explicit history, axis and view filters still apply; an
out-of-scope selection is retained and labelled. Show selected scope is an explicit
way back, not a silent opt-in to historical evidence. SVG and Canvas share the same
camera transform for drawing, pointer hits and rectangle selection, including
resized viewports; choosing a Canvas point does not exit the overview.
Node distance is not a relevance score.

Current evidence is the default. Include historical / non-current evidence
reveals retained records and exact relationships with their original state.
This switch cannot make them current or authorize an effect.

Selected records stay together in reading cards. Reading another card does not
replace the others. Widen reading area opens a broader reading flow; narrow screens
stack it vertically. Card/record/reference pages are display batches, never a
selection or evidence cap. Read actual directed relationships in each card or the
focused connection list. Exact originals, unknown fields and IDs remain optional
details. Shared cautions are collected in a legend; partial/missing/cancelled and
unreviewed conditions remain close to their item. Selecting a historical
Session changes this picture only; the exporter does not infer a native Host
selection or change the Session used for work.

Show selected connections searches the current export/layer and explicit filters
using bidirectional adjacency. In each connected component it fixes one selected
reference: the current selected focus in that component, otherwise its first
selected record. It shows the union of shortest connection branches from that
reference to every other selected record in the component, retaining all equal
predecessors and the original edge directions/types. It does not enumerate every
path, find a globally minimal network, or prove cause, directed execution, approval
or completion. Disconnected components remain separate. Longer branches remain
available through normal expansion. Reading focus alone cannot recompute the
reference/result; changed selection or filters label the previous result until
an explicit new calculation. Large calculations yield and can be cancelled; an
unfinished calculation is not a completed result.

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

There is no fixed node/edge count cutoff or arbitrary HTML-size cutoff for the
viewer inventory. The same typed readers verify the available layers; damaged
layers or source-reader resource bounds remain disclosed as incomplete coverage.
Ordinary conversational graph queries keep their existing limits.

The offline HTML stores repeated metadata in a lossless table encoding and
reconstructs the same JSON records when opened. This changes transport size,
not evidence identity, fields, multiplicity or authority. Large reports still
need memory to reconstruct their inventory; an export is not a browser-speed guarantee.
The HTML and export result disclose the exact UTF-8 file size with a nonblocking
resource notice. This warning does not trim records or impose a size gate.

Exact original text remains bounded to 64 KiB per file and 256 KiB in total.
The exporter includes a focused detail bundle for its query, not all original
bodies or every historical comparison. A metadata-only selection says so nearby
and provides a safely quoted command for another create-only report. Missing
detail does not mean no change. Show recorded code changes opens the existing
exact comparison, with added/removed excerpt lines and optional before/after
text. Partial excerpts and recorded-after versus current remain distinct; this
is not a complete file diff or a semantic verdict. Query, original-read and
rendering costs are separate measurements.

Selected changes and their files can be read together. Only existing, exact-linked
comparison pairs are displayed: recorded snapshot before/after, cited A/B, or a
cited revision versus export-observed current. Selection/click order, matching
paths and timestamps do not create a pair or a request boundary. Each comparison
retains its version/provenance and missing-time, partial or unavailable conditions.
Files without comparisons remain visible. Previous/next file and changed-region
controls move among open comparisons without closing the others or inventing
missing regions. No live file/Git/network reads are made by the HTML.

## Local data and authority

The HTML contains real source snippets and recorded decisions. Treat it like
repository data when sharing it. It uses no runtime fetch, CDN, telemetry, external
image or local server. Untrusted repository text is displayed as text under a
restrictive content security policy. Explicit local read-only adapters avoid a
configured remote graph store.

`--share` omits generated `project.root`, local regeneration executable/Project
arguments, and generated original-expansion `project_root` hints. Exact IDs,
digests, original bodies, historical references and evidence are not redacted.
Those originals may themselves contain absolute paths or confidential content:
review the report before sharing. This option is not anonymization. The ordinary
export retains local metadata and its safely quoted regeneration command.

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
