# External runtime state evidence

Read [`ULTIMATE_GOAL.md`](ULTIMATE_GOAL.md) before changing this boundary.

## Scope and authority

`RuntimeStateAdapter` version `0.1.0` imports a point-in-time host observation into the Repository World Model. It is a read-only evidence adapter, not an `AgentRuntimeAdapter`, process controller, session restorer, or authority source.

Every adapter must declare:

- `authority: derived-evidence-only`;
- `rebuildable: true`;
- `uniqueAuthority: false`;
- `readOnly: true`.

Observed capabilities describe what a host reported. They never authorize HEAD or an executor to start, resume, interrupt, message, fence, or close anything. HEAD Session and Run identities remain canonical and distinct from provider session identifiers.

## Host export contract

The active adapter reads a regular non-symlink JSON file no larger than 1 MiB with at most 1,000 observations:

```json
{
  "schemaVersion": 1,
  "kind": "HeadRuntimeStateExport",
  "observedAt": "2026-08-18T12:00:00Z",
  "observations": [
    {
      "runtime": "codex",
      "kind": "session",
      "state": "active",
      "externalId": "provider-session-id",
      "workspaceRoot": "C:\\path\\to\\project",
      "pid": 1234,
      "parentPid": 1000,
      "providerVersion": "example-version",
      "commandDigest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "endpointDigest": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "capabilities": ["inspect", "resume"]
    }
  ]
}
```

Start from [`../assets/runtime-state-export.example.json`](../assets/runtime-state-export.example.json) and replace only the allowlisted observation fields.

Allowed kinds are `workspace`, `session`, `run`, `worker`, `process`, and `service`. Allowed states are `unknown`, `discovered`, `ready`, `active`, `idle`, `blocked`, `completed`, `failed`, and `stopped`.

The schema intentionally rejects arbitrary fields. Raw commands, endpoints, environment variables, prompts, transcripts, tokens, credentials, and free-form metadata must not enter the World Model. `externalId` is converted to a SHA-256 digest. A non-project workspace is represented only by a digest; the canonical project root is represented as `project-root`.

## Commands

Place the host-produced file outside the repository or under the excluded derived-input directory `.head/world-model/inputs/`, then build and query:

```text
node scripts/head.mjs world-index <project> --runtime-state <host-exported-json-file>
node scripts/head.mjs world-status <project>
node scripts/head.mjs world-runtime <project> --runtime codex --state active --kind session --limit 20
```

The read-only MCP tool is `head_runtime_state`.

The physical source path and adapter descriptor are recorded only in the mutable World Model pointer so the source can be re-read for freshness checks. They are excluded from the semantic snapshot hash. The normalized observations, timestamp, coverage, and protocol versions determine the content-derived `runtimeStateId` and World Model ID.

Changing the export makes the World Model stale. Runtime queries and Context Compiler runtime candidates then fail closed until `world-index` rebuilds the snapshot. A missing or invalid configured export prevents freshness verification and is not silently treated as current.

## Context Compiler behavior

When the World Model is current, task-relevant observations compete under the normal Capsule budget as `RuntimeStateEvidence`. Explicit runtime, kind, and state words narrow the candidate set. Every record carries:

- `instructionAuthority: false`;
- `controlAuthority: false`;
- `trustBoundary: evidence-not-instruction`;
- evidence and content-derived observation digests.

Stale observations and their metadata are excluded. A Capsule can request expansion through `get_runtime_state`, but that remains a read operation.

## Explicitly deferred

- live runtime probing, streaming, and subscription;
- provider-session hydration or restoration;
- process launch, resume, interrupt, close, messaging, or fencing;
- caller identity and child-process ownership enforcement;
- Codex/OpenCode `AgentRuntimeAdapter` implementations.

Those belong to v0.6 runtime adapters and require platform-specific capability and process-ownership QA.
