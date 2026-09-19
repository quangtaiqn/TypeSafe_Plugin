# Deployment boundary

This directory contains non-secret configuration examples only. Provisioning a cloud account, domain, certificate, OAuth client, secret manager, or paid resource is intentionally outside this task.

Before deployment:

1. Choose a provider and region with Quang's approval.
2. Put `TYPESAFE_API_KEY` and any issuer/secret-manager credentials in runtime secrets, never in GitHub or an image.
3. Set an exact subject allowlist and scope. Keep `MCP_AUTH_REQUIRED=true`.
4. Pin the container base image by digest and lock CI action references.
5. Run an external health/readiness check and one synthetic Choice/Noul/Score canary with a cost stop condition.
6. Record endpoint, config revision, image digest, and redacted trace in `evidence/` without tokens or user data.

`/healthz` and `/readyz` are not proof that the upstream provider is reachable; the live canary is a separate gate.
