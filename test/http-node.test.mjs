import assert from "node:assert/strict";
import test from "node:test";
import { startHttpServer } from "../service/src/main.mjs";

test("node HTTP entrypoint serves health without invoking TypeSafe", async (t) => {
  const server = await startHttpServer({
    environment: {
      NODE_ENV: "test",
      TYPESAFE_API_KEY: "fake-typesafe-key",
      TYPESAFE_BASE_URL: "https://api.typesafe.ai",
      MCP_AUTH_REQUIRED: "false",
    },
    fetchImplementation: async () => { throw new Error("health must not call upstream"); },
    host: "127.0.0.1",
    port: 0,
  });
  t.after(() => server.close());
  const response = await fetch(`${server.url}/healthz`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", service: "typesafe-mcp" });
});
