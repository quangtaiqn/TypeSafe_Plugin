# Rollback runbook

1. Stop or deny the ingress if auth, quota, cost, or data handling is uncertain.
2. Identify the last `COMPLETE` recovery checkpoint with `node scripts/recovery.mjs select --recovery-root .recovery/checkpoints`; ignore WIP or corrupt snapshots.
3. Restore into a new isolated directory with `node scripts/recovery.mjs restore ...`; validate hashes and run `npm run check`/`npm test` there before replacing a deployment artifact.
4. Roll back the container image/config and the plugin/skill ref as one compatible set. Confirm the host refreshes metadata after a schema change.
5. Revoke/rotate any possibly exposed key; never copy secrets from a checkpoint.
6. Record the new checkpoint and evidence. Do not force-push or delete the public history.

The current cloud quota cache is process-local. A production multi-replica rollback must also account for the shared quota store and token/JWKS cache behavior.
