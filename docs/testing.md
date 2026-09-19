# Verification matrix

## Local checks

| Check | Scope | Meaning |
|---|---|---|
| `npm run check` | Node syntax | No syntax errors in core, service, and helper scripts. |
| `npm test` | Contract, wire, cloud, HTTP, recovery, secret, plugin tests | Local behavior only; fake provider/JWKS where used. |
| `npm run secret-scan` | Tracked public tree | Enumerates Git-tracked files, rejects tracked credential filenames, and reports secret-like findings without printing values. |
| `npm run validate:plugin` | Plugin manifest/MCP/skill | Sanitized plugin structure and companion config. |

## Required before a release claim

- Clean install in a fresh directory and a clean host profile.
- Container build and non-root startup.
- Authorized HTTPS endpoint with real OAuth/JWKS and TypeSafe canary.
- Separate Codex Desktop/CLI, ChatGPT desktop/Web, Codex cloud, iOS, and Android evidence.
- Redacted request trace showing the cloud call, not only assistant text or Inspector output.
- JWKS issuer timeout/size limits, unknown-key refresh throttling, and pre-auth attempt limits.

Those external checks are not claimed by this repository commit.
