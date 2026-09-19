# Verification matrix

## Local checks

| Check | Scope | Meaning |
|---|---|---|
| `npm run check` | Node syntax | No syntax errors in core, service, and helper scripts. |
| `npm test` | Contract, wire, cloud, HTTP, recovery, secret, plugin tests | Local behavior only; fake provider/JWKS where used. |
| `npm run secret-scan` | Public working tree | Reports secret-like findings without printing values; ignored local stores are listed only by path. |
| `npm run validate:plugin` | Plugin manifest/MCP/skill | Sanitized plugin structure and companion config. |

## Required before a release claim

- Clean install in a fresh directory and a clean host profile.
- Container build and non-root startup.
- Authorized HTTPS endpoint with real OAuth/JWKS and TypeSafe canary.
- Separate Codex Desktop/CLI, ChatGPT desktop/Web, Codex cloud, iOS, and Android evidence.
- Redacted request trace showing the cloud call, not only assistant text or Inspector output.

Those external checks are not claimed by this repository commit.
