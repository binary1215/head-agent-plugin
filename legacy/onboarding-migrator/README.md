# Legacy onboarding migrator

This is a pinned, one-shot migration package for completed HEAD onboarding
candidate protocols `0.1.0` through `0.3.0`. It is source-controlled beside
HEAD Agent Core but is not part of the current plugin runtime distribution.

`inspect` is read-only. `apply` repeats that inspection in the same process and
publishes only a create-only P3 historical boundary, receipt, and final commit
marker. It never edits historical artifacts, Product Canon, ReviewDecisions,
Session/Run/checkpoint state, World, or Graph.

```powershell
node legacy/onboarding-migrator/bin/head-onboarding-migrate.mjs inspect C:\project
node legacy/onboarding-migrator/bin/head-onboarding-migrate.mjs apply C:\project
```

The first slice accepts only current-readable `ready` state with a complete
historical approval chain and an independently current-readable Canon revision.
All incomplete states require a separately reviewed recovery contract.
