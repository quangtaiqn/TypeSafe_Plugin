# Architecture

The canonical `src/` modules own the typed contract and upstream request. The HTTP service wraps the same `createServer` factory with the MCP SDK v2 `createMcpHandler` entry, JWT/JWKS authentication, request-size limits, in-memory per-principal/service quotas, and redacted operational logs.

```text
Codex/Web/mobile host
        │ OAuth bearer token
        ▼
HTTPS /mcp ── auth + origin/host checks + quota ──► MCP SDK v2
                                                    │
                                                    ▼
                                      system_one(state, questions)
                                                    │
                                                    ▼
                                  TypeSafe API /v1/systemone
```

The provider key and model are server-owned. The client cannot provide either in tool arguments. Health/readiness endpoints never call TypeSafe. The current quota store is process-local and safe for a single instance; a multi-replica deployment must replace it with a shared atomic store before claiming a distributed quota guarantee.
