import assert from "node:assert/strict";
import test from "node:test";
import {
  getTypeSafeConfiguration,
  callSystemOne,
  readResponseJson,
} from "../src/typesafe-client.mjs";
import {
  systemOneInput,
  validateSystemOneInput,
  validateSystemOneResult,
  MAX_REQUEST_BYTES,
  MAX_RESPONSE_BYTES,
} from "../src/schema.mjs";

const evaluation = {
  state: { ticket: "Duplicate charge", messages: [{ text: "Please refund" }] },
  questions: {
    department: {
      type: "choice",
      instructions: { task: "Choose one team", focus: ["refund"] },
      criteria: { billing: "Payments and refunds", other: null },
    },
    urgency: {
      type: "score",
      instructions: "How urgent is this?",
      criteria: ["Routine", { summary: "Urgent" }],
    },
    refund_requested: {
      type: "noul",
      instructions: "Does the customer request a refund?",
      criteria: { true: "Explicit refund request", false: "No refund request" },
    },
  },
};

const result = {
  model: "jev-latest",
  answers: {
    department: {
      type: "choice",
      choice: "billing",
      probabilities: { billing: 0.9, other: 0.1 },
      confidence: 0.8,
    },
    urgency: {
      type: "score",
      score: 0.9,
      legend: { "0": "Routine", "1": { summary: "Urgent" } },
      probabilities: { "0": 0.1, "1": 0.9 },
      confidence: 0.8,
    },
    refund_requested: { type: "noul", noul: 0.99 },
  },
  usage: { input_tokens: 30, output_tokens: 12 },
};

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("CP5 schema accepts mixed structured questions and preserves the typed payload", () => {
  const parsed = validateSystemOneInput(structuredClone(evaluation));
  assert.deepEqual(parsed, evaluation);
  assert.equal(systemOneInput.safeParse(evaluation).success, true);
});

test("CP5 schema rejects invalid state, question boundaries and unknown keys before fetch", async () => {
  const invalid = [
    { questions: evaluation.questions },
    { state: true, questions: evaluation.questions },
    { state: null, questions: evaluation.questions },
    { state: "x", questions: {} },
    { state: "x", questions: { q: { type: "text", instructions: "x" } } },
    { state: "x", questions: { q: { type: "noul", instructions: "x", extra: true } } },
    { state: "x", questions: { q: { type: "choice", instructions: "x", criteria: {} } } },
    { state: "x", questions: { q: { type: "choice", instructions: "x", criteria: [] } } },
    { state: "x", questions: { q: { type: "score", instructions: "x", criteria: ["only one"] } } },
    { state: "x", questions: { q: { type: "noul", instructions: "x", criteria: { maybe: "yes" } } } },
    { state: "x", questions: { q: { type: "choice", instructions: "x", criteria: { a: undefined } } } },
  ];
  let fetchCalls = 0;
  for (const value of invalid) {
    assert.throws(() => validateSystemOneInput(value));
    await assert.rejects(
      callSystemOne(value, {
        environment: { TYPESAFE_API_KEY: "fake-key", TYPESAFE_BASE_URL: "http://127.0.0.1:1" },
        fetchImplementation: async () => { fetchCalls += 1; throw new Error("must not fetch"); },
      }),
    );
  }
  assert.equal(fetchCalls, 0);
});

test("CP5 client sends only the server-owned model and validates all answer types", async () => {
  const calls = [];
  const response = await callSystemOne(evaluation, {
    environment: {
      TYPESAFE_API_KEY: "fake-key",
      TYPESAFE_BASE_URL: "https://api.typesafe.ai/",
      TYPESAFE_MODEL: "jev-latest",
    },
    fetchImplementation: async (url, options) => {
      calls.push({ url: String(url), options, body: JSON.parse(options.body) });
      return jsonResponse(result);
    },
  });
  assert.deepEqual(response, result);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(calls[0].options.headers.authorization, "Bearer fake-key");
  assert.deepEqual(calls[0].body, { ...evaluation, model: "jev-latest" });
  assert.equal(Object.hasOwn(calls[0].body, "apiKey"), false);
});

test("CP5 response validation rejects missing, mismatched, out-of-range and malformed answers", () => {
  const invalidResults = [
    { ...result, answers: { ...result.answers, urgency: undefined } },
    { ...result, answers: { ...result.answers, department: { ...result.answers.department, type: "noul" } } },
    { ...result, answers: { ...result.answers, department: { ...result.answers.department, choice: "missing" } } },
    { ...result, answers: { ...result.answers, refund_requested: { type: "noul", noul: 1.2 } } },
    { ...result, answers: { ...result.answers, urgency: { ...result.answers.urgency, score: 4 } } },
    { ...result, answers: { ...result.answers, department: { ...result.answers.department, probabilities: { billing: 1 } } } },
    { ...result, usage: { input_tokens: -1, output_tokens: 1 } },
  ];
  for (const invalidResult of invalidResults) assert.throws(() => validateSystemOneResult(invalidResult, evaluation.questions));
  const noul = structuredClone(result.answers.refund_requested);
  assert.equal(Object.hasOwn(noul, "confidence"), false);
});

test("CP5 HTTP errors are redacted, Retry-After is retained as metadata, and no retry occurs", async () => {
  let calls = 0;
  await assert.rejects(
    callSystemOne(evaluation, {
      environment: { TYPESAFE_API_KEY: "secret-key", TYPESAFE_BASE_URL: "https://api.typesafe.ai" },
      fetchImplementation: async () => {
        calls += 1;
        return new Response("secret-key upstream-private", { status: 429, headers: { "retry-after": "9" } });
      },
    }),
    (error) => error.status === 429 && error.retryAfter === "9"
      && error.retryAfterSeconds === 9 && error.retryable === true
      && !error.message.includes("secret-key") && !error.message.includes("upstream-private"),
  );
  assert.equal(calls, 1);
});

test("CP5 timeout and caller cancellation abort the upstream request", async () => {
  let aborted = 0;
  const fetchImplementation = async (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener("abort", () => { aborted += 1; reject(Object.assign(new Error("aborted"), { name: "AbortError" })); }, { once: true });
  });
  await assert.rejects(callSystemOne(evaluation, {
    environment: { TYPESAFE_API_KEY: "fake-key", TYPESAFE_BASE_URL: "https://api.typesafe.ai", TYPESAFE_TIMEOUT_MS: "20" },
    fetchImplementation,
  }), /timed out|timeout/i);
  const controller = new AbortController();
  const pending = callSystemOne(evaluation, {
    environment: { TYPESAFE_API_KEY: "fake-key", TYPESAFE_BASE_URL: "https://api.typesafe.ai", TYPESAFE_TIMEOUT_MS: "1000" },
    fetchImplementation,
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(pending, /abort|cancel/i);
  assert.equal(aborted >= 2, true);
});

test("CP5 rejects an oversized response and keeps concurrent calls isolated", async () => {
  let calls = 0;
  await assert.rejects(callSystemOne(evaluation, {
    environment: { TYPESAFE_API_KEY: "fake-key", TYPESAFE_BASE_URL: "https://api.typesafe.ai", TYPESAFE_MAX_RESPONSE_BYTES: "64" },
    fetchImplementation: async () => { calls += 1; return new Response(JSON.stringify({ oversized: "x".repeat(1000) })); },
  }), /large|size|response/i);
  assert.equal(calls, 1);

  const fetchImplementation = async (url, options) => {
    const body = JSON.parse(options.body);
    const next = structuredClone(result);
    next.model = body.state;
    return jsonResponse(next);
  };
  const [first, second] = await Promise.all([
    callSystemOne({ state: "first", questions: evaluation.questions }, { environment: { TYPESAFE_API_KEY: "fake-key" }, fetchImplementation }),
    callSystemOne({ state: "second", questions: evaluation.questions }, { environment: { TYPESAFE_API_KEY: "fake-key" }, fetchImplementation }),
  ]);
  assert.equal(first.model, "first");
  assert.equal(second.model, "second");
});

test("CP5 configuration rejects unsafe roots, missing keys and invalid limits", () => {
  assert.throws(() => getTypeSafeConfiguration({ TYPESAFE_BASE_URL: "https://api.typesafe.ai" }), /API_KEY/);
  assert.throws(() => getTypeSafeConfiguration({ TYPESAFE_API_KEY: "replace-with-your-typesafe-api-key" }), /replaced/i);
  assert.throws(() => getTypeSafeConfiguration({ TYPESAFE_API_KEY: "x", TYPESAFE_BASE_URL: "http://provider.example" }), /HTTPS|loopback/);
  assert.throws(() => getTypeSafeConfiguration({ TYPESAFE_API_KEY: "x", TYPESAFE_BASE_URL: "https://api.typesafe.ai/v1" }), /root|API root|path/i);
  assert.throws(() => getTypeSafeConfiguration({ TYPESAFE_API_KEY: "x", TYPESAFE_TIMEOUT_MS: "0" }), /between|limit|timeout/i);
});



test("CP5 uses bounded request/response/concurrency defaults and supports safe overrides", () => {
  const defaults = getTypeSafeConfiguration({ TYPESAFE_API_KEY: "fake-key" });
  assert.equal(defaults.maxRequestBytes, MAX_REQUEST_BYTES);
  assert.equal(defaults.maxResponseBytes, MAX_RESPONSE_BYTES);
  assert.equal(defaults.maxResponseBytes, 4 * 1024 * 1024);
  assert.equal(defaults.maxConcurrent, 2);
  const configured = getTypeSafeConfiguration({
    TYPESAFE_API_KEY: "fake-key",
    TYPESAFE_MAX_REQUEST_BYTES: "2048",
    TYPESAFE_MAX_RESPONSE_BYTES: "4096",
    TYPESAFE_MAX_CONCURRENT: "3",
  });
  assert.deepEqual(
    { maxRequestBytes: configured.maxRequestBytes, maxResponseBytes: configured.maxResponseBytes, maxConcurrent: configured.maxConcurrent },
    { maxRequestBytes: 2048, maxResponseBytes: 4096, maxConcurrent: 3 },
  );
  for (const [name, value] of [["TYPESAFE_MAX_REQUEST_BYTES", "0"], ["TYPESAFE_MAX_RESPONSE_BYTES", "0"], ["TYPESAFE_MAX_CONCURRENT", "0"]]) {
    assert.throws(() => getTypeSafeConfiguration({ TYPESAFE_API_KEY: "fake-key", [name]: value }), /integer between/i);
  }
});

test("CP5 decodes a multibyte UTF-8 response split across chunks without corruption", async () => {
  const payload = JSON.stringify({ answer: "Xin chào, Jev 🌟" });
  const encoded = new TextEncoder().encode(payload);
  let split = 1;
  while (split < encoded.length && encoded[split - 1] < 0x80) split += 1;
  assert.ok(split < encoded.length);
  const response = {
    body: {
      async *[Symbol.asyncIterator]() {
        yield encoded.slice(0, split);
        yield encoded.slice(split);
      },
      cancel() {},
    },
    text: async () => payload,
  };
  const decoded = await readResponseJson(response, 1024);
  assert.deepEqual(decoded, { answer: "Xin chào, Jev 🌟" });
});
