# Codex marketplace distribution

Before changing this distribution plane, read [`architecture.md`](architecture.md)
and verify that installation remains a projection of the same provider-neutral
Core rather than a new identity or authority plane.

## Purpose

The source repository remains a directly runnable plugin root. CI assembles a
separate Git marketplace snapshot only after the integrated contract suite and
all five native build targets pass. This avoids moving or duplicating the
authoritative source layout merely to satisfy a distribution catalog layout.

The generated `codex-marketplace` branch contains exactly:

```text
.agents/plugins/marketplace.json
.gitattributes
.head-agent-marketplace-generated.json
plugins/head-agent-core/<verified distribution files>
```

The plugin directory is built from the same allowlisted file set used by the
immutable user distribution. It excludes `.git`, `test`, `node_modules`, local
developer `dist`, temporary trees, and caches. CI then assembles the five matrix
artifacts into one verified `dist/` bundle. Every target must match the plugin
version and source commit and must pass its worker, supervisor, and read-only
ArcadeDB bridge manifest checks; a missing, extra, mixed-commit, or digest-invalid
target stops publication. `distribution-manifest.json` hashes every source and
native file, and the branch marker binds the marketplace name, plugin
name/version, distribution release ID, source repository, and exact source
commit into a content-derived snapshot ID.

The generated `.gitattributes` contains `* -text`. It is itself part of the
strictly verified tree and prevents Git from rewriting LF/CRLF bytes on a
different operating system, so the distribution manifest remains portable
rather than validating only on the Linux publisher.

The source branch separately enforces `text=auto eol=lf`. This makes a fresh
Windows, macOS, or Linux source checkout feed the same text bytes into direct
installation and marketplace assembly; the generated branch then freezes those
already normalized bytes with `* -text`.

## Installation

```powershell
codex plugin marketplace add binary1215/head-agent-plugin --ref codex-marketplace
codex plugin add head-agent-core@head-agent-plugin
```

Start a new Codex task after installation. Normal use begins through the
bundled `head-agent-onboarding` Skill, which calls the typed `head_core` MCP
operations. Installation alone does not create `.head`, infer or approve
Features, contact GraphDB, or alter project files.

The marketplace snapshot already carries Windows x64, Linux x64/arm64, and
macOS x64/arm64 native packages. Runtime selection uses only the current host's
integrity-verified directory and needs no install-time download. Native
availability does not change authority: production repository scanning remains
on the JavaScript reference path until its native candidate earns activation by
benchmark and conformance evidence.

## Upgrade and removal

Refresh the generated Git snapshot, then reinstall the plugin from the same
marketplace:

```powershell
codex plugin marketplace upgrade head-agent-plugin
codex plugin add head-agent-core@head-agent-plugin
```

Remove the plugin and optionally its marketplace source:

```powershell
codex plugin remove head-agent-core@head-agent-plugin
codex plugin marketplace remove head-agent-plugin
```

Codex plugin removal affects the Codex plugin cache/configuration. It does not
delete project `.head` artifacts, the user-scoped `head-agent` distribution,
Git history, Markdown projections, or GraphDB data.

## Generated-branch ownership

CI refuses to replace an existing `codex-marketplace` branch unless its entire
current snapshot passes the HEAD marketplace verifier. When owned, replacement
uses an exact expected-commit `--force-with-lease`; concurrent or unowned branch
changes fail rather than being overwritten. The generated branch never feeds
plugin identity, Product Canon, GraphSnapshot, Context Capsule, or Execution
Lineage.

Local verification:

```powershell
npm run verify:codex-marketplace
node scripts/build-codex-marketplace.mjs --output C:\temporary\head-agent-marketplace
node scripts/verify-codex-marketplace.mjs --root C:\temporary\head-agent-marketplace
```

CI supplies `--native-root` to the builder and `--require-native` to the
verifier. Local source-only verification intentionally remains available for
development; it must not be used as evidence that a publishable native snapshot
was assembled.

## Public-directory boundary

This Git marketplace is an installable authoring/team distribution source. It
is not a claim that the plugin has passed OpenAI universal plugin-directory
review. Public submission requires publisher identity, listing/support/privacy
materials, policy attestations, and an external review. That consequential
publisher action remains user-owned and is not performed by CI.
