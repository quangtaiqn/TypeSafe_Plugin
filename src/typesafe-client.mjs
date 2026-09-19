import { TextDecoder } from "node:util";
import {
  MAX_REQUEST_BYTES,
  MAX_RESPONSE_BYTES,
  TypeSafeInputError,
  TypeSafeResponseError,
  validateSystemOneInput,
  validateSystemOneResult,
} from "./schema.mjs";

const DEFAULT_BASE_URL = "https://api.typesafe.ai";
const DEFAULT_MODEL = "jev-latest";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_CONCURRENT = 2;

function isLoopback(hostname) {
  const value = hostname.toLowerCase();
  return value === "localhost" || value === "127.0.0.1" || value === "::1" || value === "[::1]";
}

function isPlaceholderSecret(value) {
  return /^(?:replace[-_]?with|your[-_]?|<[^>]+>|example[-_]?|change[-_]?me)/i.test(value);
}

function parseBaseUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("TYPESAFE_BASE_URL must be an absolute URL");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) {
    throw new Error("TYPESAFE_BASE_URL must use HTTPS; HTTP is allowed only for loopback tests");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("TYPESAFE_BASE_URL must be an API root without path, query or credentials");
  }
  return url;
}

function parseInteger(environment, name, fallback, minimum, maximum) {
  const value = Number(environment[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

export class TypeSafeClientError extends Error {
  constructor(message, { code = "client_error", status, retryAfter, retryAfterSeconds, retryable = false } = {}) {
    super(message);
    this.name = "TypeSafeClientError";
    this.code = code;
    this.retryable = retryable;
    if (status !== undefined) this.status = status;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function getTypeSafeConfiguration(environment = process.env) {
  const apiKey = typeof environment.TYPESAFE_API_KEY === "string" ? environment.TYPESAFE_API_KEY.trim() : "";
  if (!apiKey) throw new Error("TYPESAFE_API_KEY must be configured");
  if (isPlaceholderSecret(apiKey)) throw new Error("TYPESAFE_API_KEY must be replaced with a local secret");
  const baseUrl = parseBaseUrl(environment.TYPESAFE_BASE_URL ?? DEFAULT_BASE_URL);
  const model = typeof environment.TYPESAFE_MODEL === "string" && environment.TYPESAFE_MODEL.trim()
    ? environment.TYPESAFE_MODEL.trim()
    : DEFAULT_MODEL;
  return {
    apiKey,
    baseUrl,
    model,
    timeoutMs: parseInteger(environment, "TYPESAFE_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, 1, 300_000),
    maxRequestBytes: parseInteger(environment, "TYPESAFE_MAX_REQUEST_BYTES", MAX_REQUEST_BYTES, 1, 16 * 1024 * 1024),
    maxResponseBytes: parseInteger(environment, "TYPESAFE_MAX_RESPONSE_BYTES", MAX_RESPONSE_BYTES, 1, 16 * 1024 * 1024),
    maxConcurrent: parseInteger(environment, "TYPESAFE_MAX_CONCURRENT", DEFAULT_MAX_CONCURRENT, 1, 32),
  };
}

async function cancelBody(response) {
  try { await response.body?.cancel?.(); } catch { /* response is already being discarded */ }
}

function asBytes(chunk) {
  if (typeof chunk === "string") return Buffer.from(chunk);
  if (chunk instanceof Uint8Array) return chunk;
  return new Uint8Array(chunk);
}

async function readResponseJson(response, maxBytes) {
  let raw = "";
  let byteCount = 0;
  if (response.body && typeof response.body[Symbol.asyncIterator] === "function") {
    const decoder = new TextDecoder("utf-8");
    for await (const chunk of response.body) {
      const bytes = asBytes(chunk);
      byteCount += bytes.byteLength;
      if (byteCount > maxBytes) {
        await cancelBody(response);
        throw new TypeSafeResponseError(`TypeSafe response exceeds ${maxBytes} bytes`);
      }
      raw += decoder.decode(bytes, { stream: true });
    }
    raw += decoder.decode();
  } else {
    raw = await response.text();
    byteCount = Buffer.byteLength(raw, "utf8");
    if (byteCount > maxBytes) throw new TypeSafeResponseError(`TypeSafe response exceeds ${maxBytes} bytes`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new TypeSafeResponseError("TypeSafe response is not valid JSON");
  }
}

function retryAfterValue(response) {
  const value = response.headers?.get?.("retry-after");
  return typeof value === "string" && /^[0-9]+$/.test(value) ? value : undefined;
}

function retryAfterSeconds(value) {
  return value === undefined ? undefined : Number(value);
}

function isRetryableStatus(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function composeAbortSignal(parentSignal, controller) {
  if (!parentSignal) return () => {};
  const abort = () => controller.abort(parentSignal.reason);
  if (parentSignal.aborted) abort();
  else parentSignal.addEventListener("abort", abort, { once: true });
  return () => parentSignal.removeEventListener("abort", abort);
}

export async function callSystemOne(input, options = {}) {
  const environment = options.environment ?? process.env;
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const configuration = options.configuration ?? getTypeSafeConfiguration(environment);
  let validatedInput;
  try {
    validatedInput = validateSystemOneInput(input, configuration.maxRequestBytes);
  } catch (error) {
    if (error instanceof TypeSafeInputError) throw error;
    throw new TypeSafeInputError("system_one input is invalid");
  }
  const endpoint = new URL("/v1/systemone", configuration.baseUrl);
  const controller = new AbortController();
  let timedOut = false;
  let cancelledByCaller = false;
  const removeParentAbort = composeAbortSignal(options.signal, controller);
  const onCallerAbort = () => { cancelledByCaller = true; };
  if (options.signal) options.signal.addEventListener("abort", onCallerAbort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, configuration.timeoutMs);
  try {
    let response;
    try {
      response = await fetchImplementation(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${configuration.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ...validatedInput, model: configuration.model }),
        signal: controller.signal,
        redirect: "error",
      });
    } catch (error) {
      if (timedOut) throw new TypeSafeClientError("TypeSafe request timed out", { code: "timeout", retryable: true });
      if (cancelledByCaller || controller.signal.aborted) throw new TypeSafeClientError("TypeSafe request was cancelled", { code: "cancelled", retryable: false });
      throw new TypeSafeClientError("TypeSafe API is unavailable", { code: "unavailable", retryable: true });
    }
    if (!response.ok) {
      const retryAfter = retryAfterValue(response);
      await cancelBody(response);
      throw new TypeSafeClientError(`TypeSafe API returned HTTP ${response.status}`, {
        code: "http_error",
        status: response.status,
        retryAfter,
        retryAfterSeconds: retryAfterSeconds(retryAfter),
        retryable: isRetryableStatus(response.status),
      });
    }
    const result = await readResponseJson(response, configuration.maxResponseBytes);
    try {
      return validateSystemOneResult(result, validatedInput.questions);
    } catch (error) {
      if (error instanceof TypeSafeResponseError) throw error;
      throw new TypeSafeResponseError("TypeSafe response is invalid");
    }
  } finally {
    clearTimeout(timer);
    removeParentAbort();
    if (options.signal) options.signal.removeEventListener("abort", onCallerAbort);
  }
}

export { readResponseJson, isRetryableStatus };
