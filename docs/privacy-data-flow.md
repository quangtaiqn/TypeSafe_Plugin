# Privacy and data flow

- A tool call sends only the supplied `state` and `questions` to the configured TypeSafe endpoint, plus the server-owned model.
- OAuth bearer tokens are validated against the configured issuer, audience, JWKS, expiry, scope, and subject allowlist. The upstream TypeSafe key is never returned to the client.
- Request bodies, answers, and authorization headers are not written to service logs by default. Logs contain bounded status, principal, route, and error category only.
- The service does not persist conversation state. The current quota/JWKS caches are in-memory and expire by configuration.
- Use synthetic canaries until retention, region, provider terms, and consent for real sensitive data are explicitly approved.
- `.env`, cloud credentials, reviewer accounts, publisher data, raw logs, user data, `node_modules`, and recovery snapshots are excluded from the public artifact.

This document is an implementation statement, not a legal privacy policy or a claim that a cloud provider has been configured.
