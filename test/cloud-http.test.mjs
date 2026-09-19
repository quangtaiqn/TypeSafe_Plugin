import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { createServiceApp } from "../service/src/http-app.mjs";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256", use: "sig" };
const issuer = "https://issuer.test";
const jwksUrl = `${issuer}/.well-known/jwks.json`;

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function token({ sub = "quang", scope = "typesafe:invoke", iss = issuer, exp = Math.floor(Date.now() / 1000) + 300 } = {}) {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "test-key" }));
  const payload = base64url(JSON.stringify({ sub, scope, iss, aud: "typesafe-mcp", exp }));
  const signingInput = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(privateKey).toString("base64url");
  return `${signingInput}.${signature}`;
}

const evaluation = {
  state: "A duplicate payment needs review.",
  questions: {
    decision: {
      type: "choice",
      instructions: "Should this be approved?",
      criteria: { approve: "Approve", reject: "Reject" },
    },
  },
};

function modern(method, id, params = {}) {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params: { ...params, _meta: {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": { name: "cloud-http-test", version: "1.0.0" },
      "io.modelcontextprotocol/clientCapabilities": {},
    } },
  };
}

function createTestApp(overrides = {}) {
  const calls = [];
  const environment = {
    NODE_ENV: "test",
    TYPESAFE_API_KEY: "fake-typesafe-key",
    TYPESAFE_BASE_URL: "https://api.typesafe.ai",
    TYPESAFE_TIMEOUT_MS: "1000",
    AUTH_ISSUER: issuer,
    AUTH_AUDIENCE: "typesafe-mcp",
    AUTH_JWKS_URL: jwksUrl,
    AUTH_ALLOWED_SUBJECTS: "quang",
    MCP_SCOPE: "typesafe:invoke",
    MCP_MAX_REQUESTS_PER_WINDOW: "20",
    MCP_WINDOW_MS: "60000",
    ...overrides,
  };
  const fetchImplementation = async (url, options = {}) => {
    if (String(url) === jwksUrl) return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200, headers: { "content-type": "application/json" } });
    calls.push({ url: String(url), options, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({
      model: "jev-test",
      answers: { decision: { type: "choice", choice: "approve", probabilities: { approve: 0.9, reject: 0.1 }, confidence: 0.8 } },
      usage: { input_tokens: 12, output_tokens: 4 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const app = createServiceApp({ environment, fetchImplementation });
  return { app, calls };
}

async function request(app, body, jwt = token(), path = "/mcp") {
  return app.fetch(new Request(`https://cloud.test${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${jwt}`,
      "content-type": "application/json",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": body.method,
      ...(body.params?.name ? { "mcp-name": body.params.name } : {}),
    },
    body: JSON.stringify(body),
  }));
}

test("cloud handler exposes free health/readiness and rejects unauthenticated MCP traffic", async (t) => {
  const { app, calls } = createTestApp();
  t.after(() => app.close());
  const health = await app.fetch(new Request("https://cloud.test/healthz"));
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok", service: "typesafe-mcp" });
  const ready = await app.fetch(new Request("https://cloud.test/readyz"));
  assert.equal(ready.status, 200);
  const denied = await app.fetch(new Request("https://cloud.test/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", "mcp-protocol-version": "2026-07-28" },
    body: JSON.stringify(modern("server/discover", 1)),
  }));
  assert.equal(denied.status, 401);
  assert.equal(calls.length, 0);
});

test("authorized cloud MCP keeps the tool contract and pins upstream model/key server-side", async (t) => {
  const { app, calls } = createTestApp();
  t.after(() => app.close());
  const discovered = await request(app, modern("server/discover", 1));
  assert.equal(discovered.status, 200);
  assert.equal((await discovered.json()).result.resultType, "complete");
  const listed = await request(app, modern("tools/list", 2));
  assert.equal(listed.status, 200);
  assert.deepEqual((await listed.json()).result.tools.map((tool) => tool.name), ["system_one"]);
  const called = await request(app, modern("tools/call", 3, { name: "system_one", arguments: evaluation }));
  assert.equal(called.status, 200);
  const calledBody = await called.json();
  assert.equal(calledBody.result.structuredContent.answers.decision.choice, "approve");
  const extraArgument = await request(app, modern("tools/call", 4, { name: "system_one", arguments: { ...evaluation, model: "attacker-model" } }));
  assert.equal(extraArgument.status, 200);
  assert.equal((await extraArgument.json()).result.isError, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, { ...evaluation, model: "jev-latest" });
  assert.equal(calls[0].options.headers.authorization, "Bearer fake-typesafe-key");
});

test("cloud auth enforces issuer, subject, scope and expiry without calling upstream", async (t) => {
  const { app, calls } = createTestApp();
  t.after(() => app.close());
  for (const jwt of [
    token({ iss: "https://other.test" }),
    token({ sub: "other-user" }),
    token({ scope: "profile:read" }),
    token({ exp: Math.floor(Date.now() / 1000) - 300 }),
  ]) {
    const response = await request(app, modern("server/discover", 1), jwt);
    assert.ok(response.status === 401 || response.status === 403);
  }
  assert.equal(calls.length, 0);
});

test("cloud quota and request-size limits fail before the TypeSafe call", async (t) => {
  const quota = createTestApp({ MCP_MAX_REQUESTS_PER_WINDOW: "1" });
  const sized = createTestApp({ MCP_MAX_REQUEST_BYTES: "32" });
  t.after(async () => { await quota.app.close(); await sized.app.close(); });
  assert.equal((await request(quota.app, modern("server/discover", 1))).status, 200);
  const limited = await request(quota.app, modern("server/discover", 2));
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error.code, "quota_exceeded");
  assert.equal(quota.calls.length, 0);

  const oversized = await request(sized.app, modern("server/discover", 1));
  assert.equal(oversized.status, 413);
  assert.equal(sized.calls.length, 0);
});
