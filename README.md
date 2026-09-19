# TypeSafe Plugin

Cloud-ready TypeSafe Jev System One MCP service plus a Codex plugin surface. The only tool is `system_one(state, questions)`, preserving typed `choice`, `score`, and `noul` judgments.

Current repository status: local implementation and packaging are ready for verification; a public HTTPS endpoint, provider canary, host E2E, and OpenAI submission are intentionally pending. No provider key, OAuth token, cloud credential, or user data belongs in this repository.

## Layout

- `src/` — canonical schema, TypeSafe client, and MCP tool definition; stdio remains useful for local tests.
- `service/` — Streamable HTTP cloud entrypoint, JWT/JWKS authentication, quota, redacted logging, and container files.
- `plugins/typesafe/` — Codex manifest, HTTPS MCP template, and `typesafe-ai` skill.
- `bundles/` — sanitized cloud and mobile-ready metadata generated from the same skill source.
- `submission/` — draft readiness profile and redacted test cases; not submitted automatically.
- `scripts/` — recovery, secret scan, plugin validation, and runbook helpers.
- `docs/` — compatibility, privacy, architecture, rollback, testing, and checkpoint records.

## Local verification

Requirements: Node.js 22.9 or newer and an environment-only `TYPESAFE_API_KEY` for live use. Tests use fake loopback/provider responses and do not require a real key.

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm test
npm run secret-scan
npm run validate:plugin
```

Run the local stdio server with `npm start` or the cloud-shaped HTTP service with `npm run start:cloud`. The HTTP service fails closed unless JWT/JWKS authentication and an allowed subject are configured. `/healthz` and `/readyz` do not call TypeSafe.

## Deployment boundary

Build with `docker build -f service/Dockerfile .` only after choosing a digest-pinned base image and secret manager. Configure `deploy/env.example` in the platform secret store; do not copy `.env` into an image or CI artifact. The service is not live merely because the source is on GitHub.

The plugin MCP URL is deliberately `mcp.example.invalid` until an authorized HTTPS deployment exists. Replace it in a release branch only after auth, quota, cost, and live canary evidence has been verified.

## License and provenance

The project is MIT licensed. See `LICENSE` and `docs/source-inventory.md` for the source allowlist, exclusions, dependency provenance, and the remote GitHub baseline that is preserved when publishing.
