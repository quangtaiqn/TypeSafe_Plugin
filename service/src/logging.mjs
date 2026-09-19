const SENSITIVE_HEADERS = new Set(["authorization", "cookie", "set-cookie", "proxy-authorization"]);

export function redactHeaders(headers) {
  const result = {};
  for (const [name, value] of headers) result[name.toLowerCase()] = SENSITIVE_HEADERS.has(name.toLowerCase()) ? "[REDACTED]" : value;
  return result;
}

export function logEvent(event, writer = (line) => process.stderr.write(`${line}\n`)) {
  const safe = {
    time: new Date().toISOString(),
    service: "typesafe-mcp",
    ...event,
  };
  delete safe.body;
  delete safe.token;
  delete safe.apiKey;
  writer(JSON.stringify(safe));
}
