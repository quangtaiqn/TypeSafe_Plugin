import assert from "node:assert/strict";
import test from "node:test";
import { createAuthVerifier } from "../service/src/auth.mjs";

const issuer = "https://issuer.test";

function requestWithToken() {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = [
    encode({ alg: "RS256", kid: "test-key" }),
    encode({ sub: "quang", iss: issuer, aud: "typesafe-mcp", exp: Math.floor(Date.now() / 1000) + 300, scope: "typesafe:invoke" }),
    "invalid-signature",
  ].join(".");
  return new Request("https://cloud.test/mcp", { headers: { authorization: `Bearer ${token}` } });
}

function environment(overrides = {}) {
  return {
    AUTH_ISSUER: issuer,
    AUTH_AUDIENCE: "typesafe-mcp",
    AUTH_JWKS_URL: `${issuer}/.well-known/jwks.json`,
    AUTH_ALLOWED_SUBJECTS: "quang",
    MCP_SCOPE: "typesafe:invoke",
    AUTH_JWKS_MAX_RESPONSE_BYTES: "1024",
    AUTH_JWKS_TIMEOUT_MS: "100",
    ...overrides,
  };
}

test("JWKS response size is bounded before JSON parsing", async () => {
  const verifier = createAuthVerifier({
    environment: environment(),
    fetchImplementation: async () => new Response("x".repeat(2048), { status: 200 }),
  });
  await assert.rejects(verifier.authenticate(requestWithToken()), (error) => error.status === 503 && error.code === "auth_unavailable");
});

test("JWKS fetch timeout rejects a hanging issuer request", async () => {
  const verifier = createAuthVerifier({
    environment: environment(),
    fetchImplementation: () => new Promise(() => {}),
  });
  const started = Date.now();
  await assert.rejects(verifier.authenticate(requestWithToken()), (error) => error.status === 503 && error.code === "auth_unavailable");
  assert.ok(Date.now() - started < 1500);
});
