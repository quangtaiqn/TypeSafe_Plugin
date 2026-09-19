import { McpServer } from "@modelcontextprotocol/server";
import { systemOneInput, systemOneOutputSchema } from "./schema.mjs";
import {
  callSystemOne,
  getTypeSafeConfiguration,
  TypeSafeClientError,
} from "./typesafe-client.mjs";

export function createConcurrencyGate(limit) {
  let active = 0;
  return {
    tryAcquire() {
      if (active >= limit) return null;
      active += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active -= 1;
      };
    },
  };
}

function concurrencyLimitError() {
  return new TypeSafeClientError("TypeSafe concurrency limit reached", {
    code: "concurrency_limit",
    retryable: true,
    retryAfterSeconds: 1,
  });
}

function errorDetails(error) {
  return {
    code: typeof error?.code === "string" ? error.code : "client_error",
    message: error instanceof Error ? error.message : "Unknown TypeSafe request failure",
    retryable: Boolean(error?.retryable),
    ...(Number.isInteger(error?.retryAfterSeconds) ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
  };
}

export function createServer({
  configuration = getTypeSafeConfiguration(),
  concurrencyGate = createConcurrencyGate(configuration.maxConcurrent),
  fetchImplementation = fetch,
} = {}) {
  const gate = concurrencyGate;
  const server = new McpServer({
    name: "typesafe-jev-mcp",
    version: "0.1.0",
  });

  server.registerTool(
    "system_one",
    {
      title: "Jev System One",
      description: "Submit structured state and questions to the TypeSafe Jev System One API.",
      inputSchema: systemOneInput,
      outputSchema: systemOneOutputSchema,
    },
    async ({ state, questions }, ctx) => {
      const release = gate.tryAcquire();
      if (!release) {
        const details = errorDetails(concurrencyLimitError());
        return {
          isError: true,
          content: [{ type: "text", text: `system_one failed: ${details.message}` }],
          structuredContent: { error: details },
        };
      }
      try {
        const result = await callSystemOne(
          { state, questions },
          { signal: ctx.signal, configuration, fetchImplementation },
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (error) {
        const details = errorDetails(error);
        return {
          isError: true,
          content: [{ type: "text", text: `system_one failed: ${details.message}` }],
          structuredContent: { error: details },
        };
      } finally {
        release();
      }
    },
  );

  return server;
}
