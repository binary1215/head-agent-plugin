# Claude Code marketplace distribution

Before changing this distribution plane, read [`architecture.md`](architecture.md)
and [`authority-plane-contract.md`](authority-plane-contract.md). Claude Code
packaging is a projection of the provider-neutral Core, not a new semantic or
authority plane.

## Purpose

CI creates a separate generated `claude-marketplace` branch after the integrated
contract suite and native build matrix pass. The source repository remains the
directly runnable Core; Claude-specific catalog and cache-path details do not
enter `.head/`, Product Canon, Session/Run lineage, or runtime authorization.

The generated branch contains exactly:

```text
.claude-plugin/marketplace.json
.gitattributes
.head-agent-claude-marketplace-generated.json
plugins/head-agent-core/.claude-plugin/plugin.json
plugins/head-agent-core/.head-source-distribution-manifest.json
plugins/head-agent-core/<allowlisted distribution files>
```

The builder first stages and verifies the same immutable user-distribution
allowlist used by the Codex marketplace. It excludes Git metadata, tests,
development-only goals and fixtures, local build output, temporary trees,
caches, and credentials. The original verified manifest is retained as
`.head-source-distribution-manifest.json` to bind source release lineage.

Claude Code copies installed plugins to a versioned cache, so relative process
paths would resolve against the caller rather than the plugin. Only in the
generated Claude snapshot, `.mcp.json` is projected to:

```json
{
  "mcpServers": {
    "head_core": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/mcp-server.mjs"],
      "cwd": "${CLAUDE_PLUGIN_ROOT}"
    }
  }
}
```

All unprojected files must remain byte-identical to the verified source
distribution. The generated marker binds the marketplace and plugin identities,
source release, repository, exact source commit, and a digest over every final
projected byte. The verifier rejects extra files or directories, symlinks, path
escape, source-file drift, projection drift, and identity mismatch.

## Installation

Requirements: Claude Code and a current Node.js LTS release.

```powershell
claude plugin marketplace add binary1215/head-agent-plugin@claude-marketplace
claude plugin install head-agent-core@head-agent-plugin
```

Start a new Claude Code session after installation. Normal use begins through
the bundled `head-agent-onboarding` Skill and typed `head_core` MCP operations.
Installation alone does not create `.head/`, modify a project, contact GraphDB,
choose a provider/model, approve Product Canon, or create a ReviewDecision.

## Upgrade and removal

```powershell
claude plugin marketplace update head-agent-plugin
claude plugin update head-agent-core@head-agent-plugin
```

```powershell
claude plugin uninstall head-agent-core@head-agent-plugin
claude plugin marketplace remove head-agent-plugin
```

Removing the plugin does not delete project-owned or HEAD-managed project state.
Project `.head/` removal remains a separate explicit user action.

## Publication ownership

CI verifies an existing `claude-marketplace` branch before replacing it. A
verified branch is published from an orphan commit using force-with-lease against
the exact prior tip. Missing ownership evidence, concurrent branch movement, or
any invalid prior snapshot stops publication.

The generated `.gitattributes` is exactly `* -text`, preventing checkout-time
newline rewriting from invalidating byte identities across operating systems.

## Verification

```powershell
npm run verify:distribution
npm run verify:claude-marketplace
node scripts/build-claude-marketplace.mjs --output C:\temporary\head-agent-claude-marketplace
claude plugin validate C:\temporary\head-agent-claude-marketplace
```

For an isolated install test, set `CLAUDE_CONFIG_DIR` to a new temporary
directory before adding the local generated marketplace. This keeps marketplace,
cache, and plugin state outside the user's normal Claude configuration.

This repository is not an official Anthropic marketplace. It is a Git-hosted
third-party Claude Code marketplace, and the plugin remains `UNLICENSED` until an
explicit distribution license is selected.
