# What verification proves

Core tests check exact identities, current-state validation, permitted transitions,
replay, and isolation of unrelated work. Passing tests do not disprove an untested
counterexample. Reproduced failures need behavioral regressions, including
competing processes and interrupted writes at authority and consumption boundaries.

The annotated Context test supplies a known graph anchor. It measures preservation
of supplied evidence and exclusion of unrelated carriers. It does not measure
whether provider HEAD discovers that anchor, reads the source body, or correctly
implements the task. Newcomer and conversational verifiers drive public CLI/MCP
operations with fixtures; they do not establish natural-language task success.

## Local diagnostics

Run the optional diagnostic from the source checkout:

```powershell
npm run measure:context-diagnostics
npm run measure:context-diagnostics -- --project C:\path\to\project --task "Inspect the requested change" --iterations 5
```

The report separates read-only, mutation, and missing hints. Catalog size is UTF-8
serialized bytes, not model token cost. Static import cycles indicate coupling,
not an observed runtime failure.

With a project and task, it measures the first preview and repeated previews in
one process. It does not flush OS caches, so the first call is not an OS cold-cache
measurement. Filesystem API read bytes are not physical disk I/O. Measurements
never enter Capsule identity, evidence selection, approval, or recovery. The
command does not initialize a project, refresh World, save a Capsule, or call a
provider. It does not print task text, source bodies, or Observation payloads.

## Live task evaluation

Use held-out tasks with hidden expected evidence and acceptance criteria. Compare
ordinary agent use and HEAD with the same provider/model, repository revision,
task, permissions, and external dependencies. Do not supply expected anchors.
Evaluate task interpretation, evidence discovery, file reading, implementation,
and verification, including a controlled compaction or provider replacement case.

Record task success, missed required evidence, incorrect edits, unnecessary
questions and approvals, elapsed time, actual provider tokens, and retention of
user constraints after recovery. Repeat runs and separate environmental failures.
Mechanical coverage, package installation, and tool-call success cannot establish
these outcomes. Current fixtures do not prove general superiority or task success.

## CI and publication

Directory-level triggers cover source, tests, native code, docs, and distribution
inputs. The complete JavaScript suite is an independent prerequisite for release
and both marketplaces. Cross-builds prepare target bytes; Windows and macOS jobs
separately execute installation, native health, owned-process cleanup, rollback,
and uninstall smoke.

CI results, local Windows results, cross-builds, actual marketplace installation,
and live provider behavior are separate evidence. A configured job is not a
passed run. Missing fixtures or opt-in requirements in optional native or
live-provider lanes must be disclosed, not counted as passed.
