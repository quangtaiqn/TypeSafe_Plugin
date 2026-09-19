import { createServer as createNodeServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createServiceApp } from "./http-app.mjs";

async function readBody(request, maximumBytes) {
  if (["GET", "HEAD", "DELETE"].includes(request.method)) return undefined;
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.byteLength;
    if (size > maximumBytes) {
      request.resume();
      const error = new Error(`MCP request exceeds ${maximumBytes} bytes`);
      error.status = 413;
      error.code = "request_too_large";
      throw error;
    }
    chunks.push(value);
  }
  return chunks.length === 0 ? undefined : Buffer.concat(chunks);
}

function toRequest(request, body, host, controller) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else if (value !== undefined) headers.set(name, value);
  }
  const protocol = headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim() || "http";
  const url = `${protocol}://${host}${request.url || "/"}`;
  const init = { method: request.method, headers, signal: controller.signal };
  if (body !== undefined) { init.body = body; init.duplex = "half"; }
  return new Request(url, init);
}

async function writeResponse(response, nodeResponse) {
  nodeResponse.statusCode = response.status;
  response.headers.forEach((value, name) => nodeResponse.setHeader(name, value));
  if (!response.body) {
    nodeResponse.end();
    return;
  }
  const reader = response.body.getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      nodeResponse.write(Buffer.from(next.value));
    }
  } finally {
    nodeResponse.end();
  }
}

export async function startHttpServer({ environment = process.env, fetchImplementation = fetch, host = environment.MCP_HOST || "0.0.0.0", port = Number(environment.PORT || 8787), app: providedApp } = {}) {
  const app = providedApp ?? createServiceApp({ environment, fetchImplementation });
  const server = createNodeServer(async (request, response) => {
    const controller = new AbortController();
    request.on("aborted", () => controller.abort());
    response.on("close", () => { if (!response.writableEnded) controller.abort(); });
    try {
      const body = await readBody(request, app.configuration.maxRequestBytes);
      const hostHeader = request.headers.host || "localhost";
      const webRequest = toRequest(request, body, hostHeader, controller);
      const webResponse = await app.fetch(webRequest);
      await writeResponse(webResponse, response);
    } catch (error) {
      if (response.headersSent) { response.destroy(); return; }
      const status = Number.isInteger(error?.status) ? error.status : 500;
      const body = JSON.stringify({ error: { code: error?.code ?? "internal_error", message: status >= 500 ? "MCP service request failed" : error.message, retryable: status >= 500 } });
      response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      response.end(body);
    }
  });
  await new Promise((resolve, reject) => {
    const onError = (error) => { server.off("listening", onListening); reject(error); };
    const onListening = () => { server.off("error", onError); resolve(); };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  return {
    app,
    server,
    host,
    port: actualPort,
    url: `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${actualPort}`,
    close: async () => {
      await app.close();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

const isMainModule = process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMainModule) {
  const running = await startHttpServer();
  process.stderr.write(`typesafe-mcp listening on ${running.url}/mcp\n`);
  const shutdown = async () => {
    await running.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
