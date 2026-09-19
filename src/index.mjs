import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createServer } from "./server.mjs";

export { createServer };

const isMainModule = process.argv[1]
  && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isMainModule) {
  serveStdio(createServer, {
    legacy: "serve",
    onerror: (error) => {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      process.stderr.write(`${message}\n`);
    },
  });
}

