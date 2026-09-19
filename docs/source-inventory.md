# Source and public inventory

## Included

- Canonical TypeSafe MCP core: `src/index.mjs`, `src/server.mjs`, `src/schema.mjs`, and `src/typesafe-client.mjs`.
- Existing contract/wire/template tests plus the cloud, HTTP, recovery, secret, and plugin validation tests under `test/`.
- The original local companion skill under `skills/use-jev-via-mcp/` and the public plugin skill under `plugins/typesafe/skills/typesafe-ai/`.
- `package.json`, `package-lock.json`, Docker/CI/deploy templates, docs, bundles, submission draft, and recovery/secret tooling.

## Excluded

- `.env` and all credentials/tokens/private keys, `node_modules`, local logs, raw evidence, recovery snapshots, caches, and user data.
- The separate gateway workspace and its DeepSeek/Anthropic runtime, `.typesafe-prefill-fix`, and the `cp1-spike` prototype. They are not part of the TypeSafe MCP project source allowlist.
- Any real publisher identity, reviewer account, app ID, production domain, or cloud secret not explicitly supplied for this public repository.

## Provenance and license boundary

The current TypeSafe MCP source is treated as the user-controlled project input in this workspace. Its package declares MIT; the target GitHub repository already contained the matching MIT license in commit `b06cd590c3000d1a62264f544098aed67651d6f9`, which is preserved. Runtime dependencies remain under their own licenses and are represented by the lockfile. TypeSafe API/SDK documentation is referenced, not copied as source.

The initial GitHub tree was inspected before publication: public `main`, unprotected, only `README.md` and `LICENSE`, push permission confirmed. Remote history is retained; publication is a descendant commit, not a force-push.
