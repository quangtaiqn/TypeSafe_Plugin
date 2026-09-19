# Install and operate

## Local stdio test

1. Copy `.env.example` to a local `.env` and set a real provider key outside Git.
2. Run `npm ci --ignore-scripts --no-audit --no-fund` and `npm test`.
3. Start `npm start` only for a host that explicitly supports local stdio.

## Cloud service

Build from the repository root with `docker build -f service/Dockerfile .`. Put all `TYPESAFE_*` and `AUTH_*` values in the platform secret manager. Configure a real HTTPS origin, JWKS issuer, subject allowlist, scope, quota, and upstream cost ceiling before exposing `/mcp`.

## Codex plugin

The repo-local catalog is `.agents/plugins/marketplace.json`, and the plugin is `plugins/typesafe`. Its `.mcp.json` is a non-routable template until a verified deployment URL replaces `mcp.example.invalid`. Pin a reviewed Git ref when installing; a GitHub source upload is not a live endpoint.

## Uninstall/rollback

Remove the plugin from the host profile, revoke its OAuth grant, and rotate the provider key if it could have been exposed. Use `docs/rollback.md` and the recovery selector for source rollback; never restore a key from a snapshot.
