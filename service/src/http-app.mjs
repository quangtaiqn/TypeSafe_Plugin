import { createMcpHandler } from "@modelcontextprotocol/server";
import { createServer, createConcurrencyGate } from "../../src/server.mjs";
import { getTypeSafeConfiguration } from "../../src/typesafe-client.mjs";
import { createAuthVerifier, AuthenticationError } from "./auth.mjs";
import { getLimitConfiguration, createRateLimiter, LimitError } from "./limits.mjs";
import { logEvent } from "./logging.mjs";

class RequestSizeError extends Error {
  constructor(message) {
    super(message);
    this.name = "RequestSizeError";
    this.status = 413;
    this.code = "request_too_large";
  }
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers },
  });
}

function parseList(value) {
  return typeof value === "string" ? value.split(",").map((item) => item.trim()).filter(Boolean) : [];
}

function validateRequestOrigin(request, environment) {
  const origin = request.headers.get("origin");
  const allowedOrigins = parseList(environment.MCP_ALLOWED_ORIGINS);
  if (origin && allowedOrigins.length > 0 && !allowedOrigins.includes(origin)) throw new AuthenticationError("request origin is not allowed", { status: 403, code: "forbidden" });
  const host = request.headers.get("host");
  const allowedHosts = parseList(environment.MCP_ALLOWED_HOSTS);
  if (host && allowedHosts.length > 0 && !allowedHosts.includes(host)) throw new AuthenticationError("request host is not allowed", { status: 403, code: "forbidden" });
}

async function boundedRequest(request, maxBytes) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number.isSafeInteger(Number(contentLength)) && Number(contentLength) > maxBytes) throw new RequestSizeError(`MCP request exceeds ${maxBytes} bytes`);
  if (["GET", "HEAD", "DELETE"].includes(request.method) || !request.body) return request;
  const reader = request.clone().body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > maxBytes) {
      reader.cancel().catch(() => {});
      throw new RequestSizeError(`MCP request exceeds ${maxBytes} bytes`);
    }
    chunks.push(next.value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return new Request(request.url, { method: request.method, headers, body, signal: request.signal });
}

function errorResponse(error) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  const code = error?.code ?? "internal_error";
  const message = status >= 500 ? "MCP service request failed" : (error instanceof Error ? error.message : "MCP request rejected");
  const headers = Number.isInteger(error?.retryAfterSeconds) ? { "retry-after": String(error.retryAfterSeconds) } : {};
  if (status === 401) headers["www-authenticate"] = 'Bearer realm="typesafe-mcp"';
  return jsonResponse({ error: { code, message, retryable: status >= 500 || status === 429, ...(Number.isInteger(error?.retryAfterSeconds) ? { retryAfterSeconds: error.retryAfterSeconds } : {}) } }, status, headers);
}

function decorateResponse(response) {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function createServiceApp({ environment = process.env, fetchImplementation = fetch, createServerImplementation = createServer, now = () => Date.now(), logger = logEvent } = {}) {
  const configuration = getTypeSafeConfiguration(environment);
  const auth = createAuthVerifier({ environment, fetchImplementation, now });
  const limitsConfiguration = getLimitConfiguration(environment);
  const limits = createRateLimiter(limitsConfiguration, now);
  const concurrencyGate = createConcurrencyGate(configuration.maxConcurrent);
  const mcp = createMcpHandler(
    () => createServerImplementation({ configuration, concurrencyGate, fetchImplementation }),
    {
      legacy: "stateless",
      responseMode: "json",
      onerror: (error) => logger({ event: "mcp_error", code: "mcp_error", message: error instanceof Error ? error.message : "unknown" }),
    },
  );

  async function fetchHandler(request) {
    const url = new URL(request.url);
    if (url.pathname === "/healthz" || url.pathname === "/readyz") {
      if (request.method !== "GET") return jsonResponse({ error: { code: "method_not_allowed", message: "GET is required", retryable: false } }, 405, { allow: "GET" });
      return jsonResponse({ status: "ok", service: "typesafe-mcp" });
    }
    if (url.pathname !== "/mcp") return jsonResponse({ error: { code: "not_found", message: "Not found", retryable: false } }, 404);
    try {
      validateRequestOrigin(request, environment);
      const identity = await auth.authenticate(request);
      limits.take(identity.principal);
      const requestWithLimit = await boundedRequest(request, limitsConfiguration.maxRequestBytes);
      const response = await mcp.fetch(requestWithLimit, { authInfo: identity.authInfo });
      logger({ event: "mcp_request", status: response.status, principal: identity.principal, method: request.method, path: url.pathname });
      return decorateResponse(response);
    } catch (error) {
      logger({ event: "mcp_rejected", status: error?.status ?? 500, code: error?.code ?? "internal_error" });
      return errorResponse(error);
    }
  }

  return {
    configuration,
    auth,
    limits,
    fetch: fetchHandler,
    close: () => mcp.close(),
  };
}
