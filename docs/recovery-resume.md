# Recovery and resume

The durable recovery tool is `scripts/recovery.mjs`. It writes an explicit-allowlist, secret-scanned, hashed snapshot into the ignored `.recovery/` directory, writes the `COMPLETE` marker last, validates every file before selection, and restores only into a new isolated destination. The initial source baseline is normalized as `R0-20260920-source` with sequence `0`; `R0-recovery-ready` and later checkpoints use the same manifest schema.

```powershell
node scripts/recovery.mjs progress --file .recovery/progress.json --run-id run-id --phase CP2 --task http --next test
node scripts/recovery.mjs create --id CP02-http --sequence 2 --status WIP --source . --recovery-root .recovery/checkpoints
node scripts/recovery.mjs validate --checkpoint .recovery/checkpoints/CP02-http
node scripts/recovery.mjs select --recovery-root .recovery/checkpoints
node scripts/recovery.mjs restore --checkpoint .recovery/checkpoints/CP01 --destination .recovery/restore-cp01 --dry-run
```

A new session reads this file, `docs/project-state.json`, and the progress journal. It resumes from the highest valid `COMPLETE` checkpoint, not the newest WIP directory. Secrets are obtained again from an authorized secret store.
