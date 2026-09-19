import { createPublicKey, createVerify } from "node:crypto";

const SUPPORTED_ALGORITHM = "RS256";
const DEFAULT_CLOCK_SKEW_SECONDS = 60;
const DEFAULT_JWKS_CACHE_MS = 5 * 60 * 1000;
const DEFAULT_JWKS_TIMEOUT_MS = 5_000;
const DEFAULT_JWKS_MAX_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_UNKNOWN_KID_REFRESH_MS = 60_000;

export class AuthenticationError extends Error {
  constructor(message, { status = 401, code = "invalid_token" } = {}) {
    super(message);
    this.name = "AuthenticationError";
    this.status = status;
    this.code = code;
  }
}

function parseBoolean(value, fallback) {
  if (value === undefined) return fallback;
  if (["1", "true", "yes"].includes(String(value).toLowerCase())) return true;
  if (["0", "false", "no"].includes(String(value).toLowerCase())) return false;
  throw new Error("boolean configuration value is invalid");
}

function parseInteger(value, fallback, minimum, maximum, name) {
  const result = Number(value ?? fallback);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  return result;
}

function required(environment, name) {
  const value = typeof environment[name] === "string" ? environment[name].trim() : "";
  if (!value) throw new Error(`${name} must be configured when MCP authentication is required`);
  return value;
}

function parseUrl(value, name) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} must be an absolute URL`); }
  const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname.toLowerCase());
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new Error(`${name} must use HTTPS; HTTP is allowed only for loopback tests`);
  if (url.username || url.password || url.hash) throw new Error(`${name} must not contain credentials or a fragment`);
  return url;
}

export function getAuthConfiguration(environment = process.env) {
  const requiredAuth = parseBoolean(environment.MCP_AUTH_REQUIRED, true);
  if (!requiredAuth) return { required: false };
  const allowedSubjects = required(environment, "AUTH_ALLOWED_SUBJECTS")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (allowedSubjects.length === 0) throw new Error("AUTH_ALLOWED_SUBJECTS must contain at least one subject");
  return {
    required: true,
    issuer: required(environment, "AUTH_ISSUER"),
    audience: required(environment, "AUTH_AUDIENCE"),
    jwksUrl: parseUrl(required(environment, "AUTH_JWKS_URL"), "AUTH_JWKS_URL"),
    scope: required(environment, "MCP_SCOPE"),
    allowedSubjects,
    clockSkewSeconds: parseInteger(environment.AUTH_CLOCK_SKEW_SECONDS, DEFAULT_CLOCK_SKEW_SECONDS, 0, 900, "AUTH_CLOCK_SKEW_SECONDS"),
    jwksCacheMs: parseInteger(environment.AUTH_JWKS_CACHE_MS, DEFAULT_JWKS_CACHE_MS, 1000, 86_400_000, "AUTH_JWKS_CACHE_MS"),
    jwksTimeoutMs: parseInteger(environment.AUTH_JWKS_TIMEOUT_MS, DEFAULT_JWKS_TIMEOUT_MS, 100, 30_000, "AUTH_JWKS_TIMEOUT_MS"),
    jwksMaxResponseBytes: parseInteger(environment.AUTH_JWKS_MAX_RESPONSE_BYTES, DEFAULT_JWKS_MAX_RESPONSE_BYTES, 1024, 16 * 1024 * 1024, "AUTH_JWKS_MAX_RESPONSE_BYTES"),
    unknownKidRefreshMs: parseInteger(environment.AUTH_UNKNOWN_KID_REFRESH_MS, DEFAULT_UNKNOWN_KID_REFRESH_MS, 1000, 86_400_000, "AUTH_UNKNOWN_KID_REFRESH_MS"),
  };
}

function decodeJsonSegment(segment, label) {
  try { return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")); }
  catch { throw new AuthenticationError(`token ${label} is malformed`); }
}

function parseBearer(request) {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+([^\s]+)$/i.exec(header);
  if (!match) throw new AuthenticationError("Bearer authentication is required");
  return match[1];
}

function audienceMatches(value, expected) {
  return value === expected || (Array.isArray(value) && value.includes(expected));
}

function scopesFromClaims(claims) {
  if (typeof claims.scope === "string") return claims.scope.split(/\s+/).filter(Boolean);
  if (Array.isArray(claims.scp) && claims.scp.every((value) => typeof value === "string")) return claims.scp;
  return [];
}

function publicKeyFromJwk(jwk) {
  const key = { kty: jwk.kty, n: jwk.n, e: jwk.e };
  return createPublicKey({ key, format: "jwk" });
}

function verifySignature(signingInput, signature, jwk) {
  if (jwk.alg && jwk.alg !== SUPPORTED_ALGORITHM) return false;
  if (jwk.kty !== "RSA" || typeof jwk.n !== "string" || typeof jwk.e !== "string") return false;
  const verifier = createVerify("RSA-SHA256");
  verifier.update(signingInput);
  verifier.end();
  try { return verifier.verify(publicKeyFromJwk(jwk), Buffer.from(signature, "base64url")); }
  catch { return false; }
}

async function readBoundedText(response, maxBytes) {
  if (!response.body || typeof response.body.getReader !== "function") {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) throw new AuthenticationError("authorization key set is too large", { status: 503, code: "auth_unavailable" });
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new AuthenticationError("authorization key set is too large", { status: 503, code: "auth_unavailable" });
      }
      chunks.push(Buffer.from(next.value));
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function createAuthVerifier({ environment = process.env, fetchImplementation = fetch, now = () => Date.now() } = {}) {
  const configuration = getAuthConfiguration(environment);
  let cachedKeys = null;
  let cachedAt = 0;
  let forcedRefreshAt = Number.NEGATIVE_INFINITY;
  let refreshPromise = null;

  async function fetchKeys() {
    const controller = new AbortController();
    let timer;
    let response;
    try {
      const request = fetchImplementation(configuration.jwksUrl, {
        headers: { accept: "application/json" },
        redirect: "error",
        signal: controller.signal,
      });
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("authorization key service timed out"));
        }, configuration.jwksTimeoutMs);
      });
      response = await Promise.race([request, timeout]);
    } catch {
      throw new AuthenticationError("authorization key service is unavailable", { status: 503, code: "auth_unavailable" });
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!response.ok) throw new AuthenticationError("authorization key service rejected the request", { status: 503, code: "auth_unavailable" });
    let payload;
    try { payload = JSON.parse(await readBoundedText(response, configuration.jwksMaxResponseBytes)); }
    catch (error) {
      if (error instanceof AuthenticationError) throw error;
      throw new AuthenticationError("authorization key set is invalid", { status: 503, code: "auth_unavailable" });
    }
    if (!Array.isArray(payload?.keys)) throw new AuthenticationError("authorization key set is invalid", { status: 503, code: "auth_unavailable" });
    cachedKeys = payload.keys.filter((key) => key?.kid && key?.kty === "RSA");
    cachedAt = now();
    return cachedKeys;
  }

  async function loadKeys(force = false) {
    const current = now();
    if (!force && cachedKeys && current - cachedAt < configuration.jwksCacheMs) return cachedKeys;
    if (force && cachedKeys && current - forcedRefreshAt < configuration.unknownKidRefreshMs) return cachedKeys;
    if (refreshPromise) return refreshPromise;
    if (force) forcedRefreshAt = current;
    refreshPromise = fetchKeys();
    try {
      return await refreshPromise;
    } finally {
      refreshPromise = null;
    }
  }

  async function authenticate(request) {
    if (!configuration.required) return { principal: "anonymous", scopes: [], authInfo: { clientId: "anonymous", scopes: [] } };
    const rawToken = parseBearer(request);
    const segments = rawToken.split(".");
    if (segments.length !== 3) throw new AuthenticationError("Bearer token is malformed");
    const header = decodeJsonSegment(segments[0], "header");
    const claims = decodeJsonSegment(segments[1], "payload");
    if (header.alg !== SUPPORTED_ALGORITHM || typeof header.kid !== "string" || !header.kid) throw new AuthenticationError("Bearer token algorithm or key id is unsupported");
    let keys = await loadKeys();
    let jwk = keys.find((key) => key.kid === header.kid);
    if (!jwk) {
      keys = await loadKeys(true);
      jwk = keys.find((key) => key.kid === header.kid);
    }
    if (!jwk || !verifySignature(`${segments[0]}.${segments[1]}`, segments[2], jwk)) throw new AuthenticationError("Bearer token signature is invalid");
    const currentSeconds = Math.floor(now() / 1000);
    if (claims.iss !== configuration.issuer || !audienceMatches(claims.aud, configuration.audience)) throw new AuthenticationError("Bearer token issuer or audience is invalid");
    if (typeof claims.sub !== "string" || !claims.sub || !configuration.allowedSubjects.includes(claims.sub)) throw new AuthenticationError("Bearer token subject is not allowed", { status: 403, code: "forbidden" });
    if (!Number.isFinite(claims.exp) || claims.exp <= currentSeconds - configuration.clockSkewSeconds) throw new AuthenticationError("Bearer token is expired");
    if (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > currentSeconds + configuration.clockSkewSeconds)) throw new AuthenticationError("Bearer token is not active");
    const scopes = scopesFromClaims(claims);
    if (!scopes.includes(configuration.scope)) throw new AuthenticationError("Bearer token lacks the required scope", { status: 403, code: "insufficient_scope" });
    return {
      principal: claims.sub,
      scopes,
      authInfo: {
        clientId: claims.sub,
        scopes,
        extra: { issuer: claims.iss, subject: claims.sub, audience: claims.aud },
      },
    };
  }

  return { configuration, authenticate };
}
