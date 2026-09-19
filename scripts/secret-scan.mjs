import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const excludedDirectories = new Set([".git", ".recovery", ".checkpoints", "node_modules", "coverage", "dist"]);
const findingPatterns = [
  { category: "bearer-token", pattern: /Authorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]{16,}/i },
  { category: "provider-token", pattern: /(?:ghp_|github_pat_|xox[baprs]-|sk-)[A-Za-z0-9_-]{12,}/ },
  { category: "private-key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { category: "api-key-assignment", pattern: /(?<!process\.env\.)\bTYPESAFE_API_KEY\s*=(?!=)\s*["']?(?!replace[-_]?with|replace[-_]?in|your[-_]?|fake[-_]?|test[-_]?|secret[-_]?|example[-_]?|<|REPLACE_WITH|YOUR_|\$\{)[^\s"']+/i },
  { category: "generic-secret-assignment", pattern: /(?:secret|access[_-]?token|client[_-]?secret)\s*=(?!=)\s*["']?(?!replace[-_]?with|replace[-_]?in|your[-_]?|fake[-_]?|test[-_]?|secret[-_]?|example[-_]?|<|REPLACE_WITH|YOUR_|\$\{)[A-Za-z0-9._~+/=-]{12,}/i },
];

function relative(root, value) {
  return path.relative(root, value).replaceAll("\\", "/") || ".";
}

function excludedFile(name) {
  const lower = name.toLowerCase();
  return lower === ".env" || (lower.startsWith(".env.") && lower !== ".env.example") || lower === ".npmrc" || lower.endsWith(".log") || lower.endsWith(".pem") || lower.endsWith(".key");
}

async function readText(filePath) {
  const chunks = [];
  for await (const chunk of createReadStream(filePath)) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);
  if (buffer.includes(0)) return null;
  return buffer.toString("utf8");
}

export async function scanTree(rootPath) {
  const root = path.resolve(rootPath);
  if (!(await stat(root)).isDirectory()) throw new Error("scan root must be a directory");
  const findings = [];
  const excluded = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      const relativePath = relative(root, fullPath);
      if (entry.isDirectory() && excludedDirectories.has(entry.name.toLowerCase())) {
        excluded.push({ path: relativePath, reason: "local-or-generated-directory" });
        continue;
      }
      if (entry.isDirectory()) {
        await visit(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (excludedFile(entry.name)) {
        excluded.push({ path: relativePath, reason: "local-secret-or-log-file" });
        continue;
      }
      const text = await readText(fullPath);
      if (text === null) continue;
      const lines = text.split(/\r?\n/);
      lines.forEach((line, index) => {
        for (const candidate of findingPatterns) {
          if (candidate.pattern.test(line)) {
            findings.push({ path: relativePath, line: index + 1, category: candidate.category });
            break;
          }
        }
      });
    }
  }

  await visit(root);
  findings.sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line || left.category.localeCompare(right.category));
  excluded.sort((left, right) => left.path.localeCompare(right.path));
  return { clean: findings.length === 0, findings, excluded };
}

async function main() {
  const argv = process.argv.slice(2);
  const rootIndex = argv.indexOf("--root");
  const root = rootIndex >= 0 ? argv[rootIndex + 1] : ".";
  if (!root || root.startsWith("--")) throw new Error("--root requires a directory");
  const result = await scanTree(root);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.clean) process.exitCode = 1;
}

const isMainModule = process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMainModule) {
  try { await main(); }
  catch (error) {
    process.stderr.write(`secret scan error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
