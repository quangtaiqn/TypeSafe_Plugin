export class LimitError extends Error {
  constructor(message, { code = "quota_exceeded", retryAfterSeconds = 1, status = 429 } = {}) {
    super(message);
    this.name = "LimitError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function integer(environment, name, fallback, minimum, maximum) {
  const value = Number(environment[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  return value;
}

export function getLimitConfiguration(environment = process.env) {
  return {
    maxRequestBytes: integer(environment, "MCP_MAX_REQUEST_BYTES", 1024 * 1024, 1, 16 * 1024 * 1024),
    windowMs: integer(environment, "MCP_WINDOW_MS", 60_000, 1000, 86_400_000),
    maxRequestsPerWindow: integer(environment, "MCP_MAX_REQUESTS_PER_WINDOW", 60, 1, 1_000_000),
    maxServiceRequestsPerWindow: integer(environment, "MCP_MAX_SERVICE_REQUESTS_PER_WINDOW", 600, 1, 10_000_000),
    authWindowMs: integer(environment, "MCP_AUTH_WINDOW_MS", 60_000, 1000, 86_400_000),
    maxAuthRequestsPerWindow: integer(environment, "MCP_MAX_AUTH_REQUESTS_PER_WINDOW", 120, 1, 1_000_000),
  };
}

export function createRateLimiter(configuration, now = () => Date.now()) {
  const principalWindows = new Map();
  let serviceWindow = { startedAt: now(), count: 0 };

  function currentWindow(window) {
    const current = now();
    if (current - window.startedAt >= configuration.windowMs) return { startedAt: current, count: 0 };
    return window;
  }

  function take(principal) {
    serviceWindow = currentWindow(serviceWindow);
    const currentPrincipal = currentWindow(principalWindows.get(principal) ?? { startedAt: serviceWindow.startedAt, count: 0 });
    if (serviceWindow.count >= configuration.maxServiceRequestsPerWindow || currentPrincipal.count >= configuration.maxRequestsPerWindow) {
      throw new LimitError("MCP quota exceeded", { retryAfterSeconds: Math.max(1, Math.ceil((configuration.windowMs - (now() - serviceWindow.startedAt)) / 1000)) });
    }
    serviceWindow.count += 1;
    currentPrincipal.count += 1;
    principalWindows.set(principal, currentPrincipal);
    for (const [key, value] of principalWindows) if (now() - value.startedAt >= configuration.windowMs) principalWindows.delete(key);
  }

  return { take };
}
