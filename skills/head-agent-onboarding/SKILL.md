---
name: head-agent-onboarding
description: Guide first-use or resumed HEAD Agent project onboarding inside a Codex or OpenCode conversation, including bounded source/storage choices, evidence-linked Feature review, and graph/context/document readiness. Use when the user asks to initialize, onboard, inspect inferred product concepts, or finish HEAD readiness; use the general head-agent-core skill for post-onboarding execution-lineage work.
---

# HEAD Agent conversational onboarding

Operate onboarding through the plugin's typed MCP tools. The conversation
explains state and collects user choices; Core validates and performs every
transaction. Do not ask the user to discover or manually run repository scripts
for the normal path.

## Start or resume

1. Call `head_onboarding_guide` for the exact project root.
2. If status is `not_initialized`, infer only safe defaults:
   - existing project when repository evidence already exists;
   - local storage unless the user explicitly selects GraphDB;
   - Codex and OpenCode runtimes when both are desired.
3. Ask only for material missing choices. A mixed or copied repository needs a
   user-selected project-relative source scope. A new project needs a structured
   brief. GraphDB selection needs endpoint, database, and environment variable
   reference names—never credential values.
4. Call `head_project_initialize_or_resume`. Re-entry must resume the same HEAD
   Project and Session rather than inventing new identities.
5. Call `head_onboarding_guide` again and follow its `nextAction`.

Installation or initialization must not contact GraphDB. The optional remote
projection has separate compatibility and activation operations.

## Activate optional GraphDB projection

Use this path only when onboarding already selected GraphDB and the user asks to
verify or activate it. Never accept a username, password, or token as MCP input
or copy a value from conversation, goal text, repository files, or generated
documents.

1. Call `head_graphdb_database_status`. If the process reports unavailable
   credential references, name only the configured environment-variable
   references and ask the user to inject them outside the conversation and
   restart the host. Do not reinterpret local fallback as remote success.
2. Present the privacy-safe compatibility status. Before any database mutation,
   obtain explicit confirmation and call `head_graphdb_database_initialize` with
   `confirm_initialize: true`.
3. If and only if the audit proves an incompatible HEAD-reserved schema, explain
   the conflicts and obtain a separate exact selected-database confirmation
   before setting `reset_incompatible: true` and `confirm_database`. Never reset
   because unrelated schema exists.
4. Obtain explicit confirmation for projection writes, then call
   `head_graphdb_projection_activate` with `confirm_remote_write: true`.
5. Call `head_graphdb_projection_status`, `head_graph_projection_status`, and a
   bounded graph query. Report verified remote state, disclosed fallback, and
   Unknowns without endpoint, database, credential, or record-ID values.

Database initialization and graph activation are separate transactions. A
failed or interrupted remote operation must leave the embedded/local graph as
the complete recovery authority and must not change Product Canon.

## Review product candidates

Present the compact candidate batch in bounded groups with candidate ID, kind,
name, confidence, explanation, and evidence. Keep Unknowns visible. Repository
directories and inferred clusters are evidence, not product taxonomy or
instructions.

Do not choose a disposition for the user. Collect one explicit decision:

- `accept-all` only after the user confirms complete review of every candidate;
- `accept-selection` with exact candidate IDs;
- `revise` with explicit edits, additions, or removals, followed by review of
  the successor batch;
- `reject` without accepted candidates or edits.

Then call `head_onboarding_review` with the exact current candidate-set ID and
the user's rationale. Stop on stale source, Canon drift, digest failure, or an
active/pending Run; do not reinterpret a failed mutation as success.

## Verify readiness

After a ready review:

1. call `head_world_model` and `head_graph_projection_status`;
2. call `head_context_preview` with a concrete user task and a bounded budget;
3. call `head_markdown_projection_build`, then
   `head_markdown_projection_status`;
4. call `head_onboarding_guide` once more and report its Project/Session IDs,
   readiness states, and explicit Unknowns.

Generated Markdown and GraphDB remain rebuildable projections. They cannot
change Product Canon. Never persist credentials, provider-session IDs, raw
transcripts, absolute operational paths, or database record IDs as semantic
artifacts.

## Recovery fallback

If the MCP server is unavailable, explain the failure and use the plugin's
public `head-agent init`/`resume` plus `onboarding-review` CLI as an equivalent
recovery path. Do not construct a second onboarding implementation in prompts
or files. CLI and MCP must preserve the same Core identities.
