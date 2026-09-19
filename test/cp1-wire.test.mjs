import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { once } from "node:events";
import path from "node:path";
import { createServer } from "../src/server.mjs";

const entry = path.resolve(process.cwd(), "src/index.mjs");
const modernMeta = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { name: "cp1-wire-test", version: "1.0.0" },
  "io.modelcontextprotocol/clientCapabilities": {}
};
const evaluation = {
  state: "A duplicate payment needs review.",
  questions: {
    decision: {
      type: "choice",
      instructions: "Should this be approved?",
      criteria: { approve: "Approve", reject: "Reject" }
    }
  }
};

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}


function assertStrictContract(tool) {
  const input = tool.inputSchema;
  assert.equal(input.type, "object");
  assert.equal(input.additionalProperties, false);
  assert.equal(input.properties.state.anyOf.some(branch => branch.type === "null"), false);
  assert.equal(input.properties.questions.minProperties, 1);

  const questionBranches = input.properties.questions.additionalProperties.oneOf;
  const choice = questionBranches.find(branch => branch.properties.type.const === "choice");
  const score = questionBranches.find(branch => branch.properties.type.const === "score");
  const noul = questionBranches.find(branch => branch.properties.type.const === "noul");
  assert.equal(choice.properties.criteria.minProperties, 1);
  assert.equal(choice.properties.criteria.maxProperties, 255);
  assert.equal(score.properties.criteria.minItems, 2);
  assert.equal(score.properties.criteria.maxItems, 10);
  assert.ok(noul.properties.criteria.anyOf.some(branch => branch.required?.includes("true")));
  assert.ok(noul.properties.criteria.anyOf.some(branch => branch.required?.includes("false")));

  const success = tool.outputSchema.anyOf.find(branch => branch.properties?.answers);
  assert.equal(success.properties.answers.minProperties, 1);
  const answerBranches = success.properties.answers.additionalProperties.anyOf;
  assert.deepEqual(answerBranches.map(branch => branch.properties.type.const).sort(), ["choice", "noul", "score"]);
  for (const branch of answerBranches) assert.ok(branch.properties.type.const);
}

async function fakeTypeSafe() {
  const calls = [];
  const server = createHttpServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    calls.push({ url: req.url, headers: req.headers, body: JSON.parse(raw) });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      model: "jev-test",
      answers: {
        decision: {
          type: "choice",
          choice: "approve",
          probabilities: { approve: 0.9, reject: 0.1 },
          confidence: 0.8
        }
      },
      usage: { input_tokens: 12, output_tokens: 4 }
    }));
  });
  const url = await listen(server);
  return { calls, url, close: () => new Promise(resolve => server.close(resolve)) };
}

function childHarness(env) {
  const child = spawn(process.execPath, [entry], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"]
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let buffer = "";
  const pending = new Map();
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  child.stdout.on("data", chunk => {
    buffer += chunk;
    while (buffer.includes("\n")) {
      const index = buffer.indexOf("\n");
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch (error) {
        for (const waiter of pending.values()) waiter.reject(new Error(`non-JSON stdout: ${line}`));
        continue;
      }
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id).resolve(message);
        pending.delete(message.id);
      }
    }
  });
  child.on("exit", (code, signal) => {
    for (const waiter of pending.values()) waiter.reject(new Error(`server exited code=${code} signal=${signal} stderr=${stderr}`));
    pending.clear();
  });
  return {
    request(message, timeoutMs = 3000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(message.id); reject(new Error(`timeout waiting for ${message.id}; stderr=${stderr}`)); }, timeoutMs);
        pending.set(message.id, {
          resolve: value => { clearTimeout(timer); resolve(value); },
          reject: error => { clearTimeout(timer); reject(error); }
        });
        child.stdin.write(`${JSON.stringify(message)}\n`);
      });
    },
    notify(message) { child.stdin.write(`${JSON.stringify(message)}\n`); },
    async close() {
      child.stdin.end();
      await Promise.race([once(child, "exit"), new Promise(resolve => setTimeout(() => { child.kill(); resolve(); }, 1000))]);
    }
  };
}

test("modern stdio discovers one tool and calls TypeSafe with validated structured input", async t => {
  const upstream = await fakeTypeSafe();
  const harness = childHarness({ TYPESAFE_API_KEY: "fake-typesafe-key", TYPESAFE_BASE_URL: upstream.url });
  t.after(async () => { await harness.close(); await upstream.close(); });
  const discovered = await harness.request({ jsonrpc: "2.0", id: 1, method: "server/discover", params: { _meta: modernMeta } });
  assert.equal(discovered.result.resultType, "complete");
  assert.ok(discovered.result.supportedVersions.includes("2026-07-28"));
  const listed = await harness.request({ jsonrpc: "2.0", id: 2, method: "tools/list", params: { _meta: modernMeta } });
  assert.deepEqual(listed.result.tools.map(tool => tool.name), ["system_one"]);
  assert.equal(listed.result.tools[0].inputSchema.additionalProperties, false);
  assert.ok(listed.result.tools[0].outputSchema);
  assertStrictContract(listed.result.tools[0]);
  const called = await harness.request({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "system_one", arguments: evaluation, _meta: modernMeta } });
  assert.equal(called.result.isError ?? false, false);
  assert.deepEqual(called.result.structuredContent.answers.decision.choice, "approve");
  assert.equal(upstream.calls.length, 1);

  const extraArgument = await harness.request({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "system_one",
      arguments: { ...evaluation, model: "attacker-model" },
      _meta: modernMeta,
    },
  });
  assert.ok(extraArgument.error || extraArgument.result?.isError);
  assert.equal(upstream.calls.length, 1);
  assert.deepEqual(upstream.calls[0].body, { ...evaluation, model: "jev-latest" });
});

test("legacy stdio initializes, lists one tool, and calls the same contract", async t => {
  const upstream = await fakeTypeSafe();
  const harness = childHarness({ TYPESAFE_API_KEY: "fake-typesafe-key", TYPESAFE_BASE_URL: upstream.url });
  t.after(async () => { await harness.close(); await upstream.close(); });
  const initialized = await harness.request({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "cp1-legacy-test", version: "1.0.0" } } });
  assert.equal(initialized.result.protocolVersion, "2025-11-25");
  harness.notify({ jsonrpc: "2.0", method: "notifications/initialized" });
  const listed = await harness.request({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  assert.deepEqual(listed.result.tools.map(tool => tool.name), ["system_one"]);
  const called = await harness.request({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "system_one", arguments: evaluation } });
  assert.equal(called.result.isError ?? false, false);
  assert.deepEqual(called.result.structuredContent.answers.decision.choice, "approve");
  assert.equal(upstream.calls.length, 1);
});


test("MCP validates the required TypeSafe key at server construction", () => {
  const originalKey = process.env.TYPESAFE_API_KEY;
  try {
    delete process.env.TYPESAFE_API_KEY;
    assert.throws(() => createServer(), /TYPESAFE_API_KEY.*configured/i);
  } finally {
    if (originalKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = originalKey;
  }
});

test("MCP legacy wire path also exposes the strict input and output contract", async t => {
  const upstream = await fakeTypeSafe();
  const harness = childHarness({ TYPESAFE_API_KEY: "fake-typesafe-key", TYPESAFE_BASE_URL: upstream.url });
  t.after(async () => { await harness.close(); await upstream.close(); });
  const listed = await harness.request({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "cp1-contract-test", version: "1.0.0" } } });
  assert.equal(listed.result.protocolVersion, "2025-11-25");
  harness.notify({ jsonrpc: "2.0", method: "notifications/initialized" });
  const tools = await harness.request({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  assert.equal(tools.result.tools[0].inputSchema.additionalProperties, false);
  assert.ok(tools.result.tools[0].outputSchema);
  assertStrictContract(tools.result.tools[0]);
});


test("MCP wire call rejects over-limit concurrency with structured retry metadata", async t => {
  let calls = 0;
  let releaseUpstream;
  const upstreamGate = new Promise(resolve => { releaseUpstream = resolve; });
  const upstream = createHttpServer(async (req, res) => {
    calls += 1;
    await upstreamGate;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      model: "jev-test",
      answers: { decision: { type: "choice", choice: "approve", probabilities: { approve: 0.9, reject: 0.1 }, confidence: 0.8 } },
      usage: { input_tokens: 12, output_tokens: 4 },
    }));
  });
  const upstreamUrl = await listen(upstream);
  const harness = childHarness({
    TYPESAFE_API_KEY: "fake-typesafe-key",
    TYPESAFE_BASE_URL: upstreamUrl,
    TYPESAFE_MAX_CONCURRENT: "1",
  });
  t.after(async () => {
    releaseUpstream();
    await harness.close();
    await new Promise(resolve => upstream.close(resolve));
  });

  const firstPromise = harness.request({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "system_one", arguments: evaluation, _meta: modernMeta } });
  for (let attempt = 0; attempt < 100 && calls === 0; attempt += 1) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(calls, 1);
  const second = await harness.request({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "system_one", arguments: evaluation, _meta: modernMeta } });
  assert.equal(second.result.isError, true);
  assert.equal(second.result.structuredContent.error.code, "concurrency_limit");
  assert.equal(second.result.structuredContent.error.retryable, true);
  assert.equal(second.result.structuredContent.error.retryAfterSeconds, 1);
  assert.equal(calls, 1);

  releaseUpstream();
  const first = await firstPromise;
  assert.equal(first.result.isError ?? false, false);
});
