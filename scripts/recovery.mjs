import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { scanTree } from "./secret-scan.mjs";

const COMPLETE_MARKER = "COMPLETE";
const MANIFEST = "manifest.json";
const SECRET_VALUE = /(?:bearer\s+|sk-[a-z0-9_-]{8,}|typesafe_api_key\s*=|api[_-]?key\s*[:=]|secret[_-]?key\s*[:=]|token\s*[:=])/i;
const ALLOWED_ROOT_FILES = new Set([".dockerignore", ".env.example", ".gitignore", "LICENSE", "README.md", "package.json", "package-lock.json"]);
const ALLOWED_TOP_LEVEL_DIRECTORIES = new Set([".agents", ".github", "bundles", "deploy", "docs", "evidence", "examples", "plugins", "scripts", "service", "skills", "src", "submission", "test"]);
const ALLOWED_EXTENSIONS = new Set([".example", ".json", ".lock", ".md", ".mjs", ".toml", ".yaml", ".yml"]);

function parseArgs(argv) {
  const values = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      values._.push(token);
      continue;
    }
    const name = token.slice(2);
    if (name === "dry-run") {
      values[name] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for --${name}`);
    values[name] = value;
    index += 1;
  }
  return values;
}

function required(args, name) {
  const value = args[name];
  if (typeof value !== "string" || !value.trim()) throw new Error(`--${name} is required`);
  return value.trim();
}

function absolute(value) {
  return path.resolve(value);
}

function safeId(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new Error("checkpoint id contains unsupported characters");
  return value;
}

function safeRelative(value) {
  const normalized = value.replaceAll("\\", "/");
  return normalized && normalized !== "." && !normalized.startsWith("/") && !normalized.split("/").includes("..")
    ? normalized
    : null;
}

function secretPath(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");
  const basename = path.posix.basename(normalized).toLowerCase();
  if (basename === ".env" || (basename.startsWith(".env.") && basename !== ".env.example")) return true;
  if (basename === ".npmrc" || basename.endsWith(".pem") || basename.endsWith(".key") || basename.endsWith(".p12") || basename.endsWith(".pfx")) return true;
  return normalized.split("/").some((part) => [".git", "node_modules", ".recovery", ".checkpoints", "credentials", "secrets"].includes(part.toLowerCase()));
}

function ignoredPath(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");
  return secretPath(normalized) || normalized.endsWith(".log") || normalized.endsWith(".tmp") || normalized.endsWith(".bak");
}

function allowlistedPath(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");
  if (ALLOWED_ROOT_FILES.has(normalized)) return true;
  const parts = normalized.split("/");
  if (!ALLOWED_TOP_LEVEL_DIRECTORIES.has(parts[0])) return false;
  const basename = parts.at(-1).toLowerCase();
  if ([".dockerignore", ".gitignore", "dockerfile"].includes(basename)) return true;
  const extension = path.posix.extname(basename);
  return ALLOWED_EXTENSIONS.has(extension) || basename.endsWith(".example");
}

function allowlistedDirectory(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");
  return ALLOWED_TOP_LEVEL_DIRECTORIES.has(normalized.split("/")[0]);
}

async function walk(root, current = root, result = []) {
  const entries = await readdir(current, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const fullPath = path.join(current, entry.name);
    const relativePath = path.relative(root, fullPath).replaceAll("\\", "/");
    if (ignoredPath(relativePath)) continue;
    if (entry.isDirectory()) {
      if (!allowlistedDirectory(relativePath)) throw new Error(`source directory is not allowlisted: ${relativePath}`);
      await walk(root, fullPath, result);
    } else if (entry.isFile()) {
      if (!allowlistedPath(relativePath)) throw new Error(`source file is not allowlisted: ${relativePath}`);
      result.push({ fullPath, relativePath });
    } else {
      throw new Error(`unsupported source entry: ${relativePath}`);
    }
  }
  return result;
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  hash.update(await readFile(filePath));
  return hash.digest("hex");
}

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function relativeWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

async function createCheckpoint(args) {
  const checkpointId = safeId(required(args, "id"));
  const sequence = Number(required(args, "sequence"));
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error("--sequence must be a non-negative integer");
  const status = required(args, "status");
  if (!["WIP", "COMPLETE"].includes(status)) throw new Error("--status must be WIP or COMPLETE");
  const sourceRoot = absolute(required(args, "source"));
  const recoveryRoot = absolute(required(args, "recovery-root"));
  if (!(await pathExists(sourceRoot)) || !(await stat(sourceRoot)).isDirectory()) throw new Error("source must be an existing directory");
  const secretScan = await scanTree(sourceRoot);
  if (!secretScan.clean) {
    const locations = secretScan.findings.map((finding) => `${finding.path}:${finding.line}`).join(", ");
    throw new Error(`source contains secret-like content: ${locations}`);
  }
  await mkdir(recoveryRoot, { recursive: true });
  const destination = path.join(recoveryRoot, checkpointId);
  if (await pathExists(destination)) throw new Error(`checkpoint already exists: ${checkpointId}`);
  const staging = path.join(recoveryRoot, `.${checkpointId}.tmp-${process.pid}-${Date.now()}`);
  await mkdir(staging, { recursive: true });
  try {
    const files = await walk(sourceRoot);
    const manifestFiles = [];
    for (const file of files) {
      const target = path.join(staging, file.relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(file.fullPath, target);
      manifestFiles.push({
        path: file.relativePath,
        size: (await stat(file.fullPath)).size,
        sha256: await sha256(file.fullPath),
      });
    }
    const manifest = {
      checkpointId,
      sequence,
      status,
      createdAt: new Date().toISOString(),
      sourceLabel: path.basename(sourceRoot),
      exclusions: [".env", ".env.* except .env.example", "node_modules", ".git", "logs", "credentials", "secrets"],
      files: manifestFiles.sort((left, right) => left.path.localeCompare(right.path)),
    };
    await writeFile(path.join(staging, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    if (status === "COMPLETE") await writeFile(path.join(staging, COMPLETE_MARKER), `${checkpointId}\n`, "utf8");
    await rename(staging, destination);
    process.stdout.write(`${JSON.stringify({ checkpointId, sequence, status, path: destination, files: manifestFiles.length })}\n`);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function readManifest(checkpointPath) {
  const root = absolute(checkpointPath);
  const value = JSON.parse(await readFile(path.join(root, MANIFEST), "utf8"));
  if (value.checkpointId !== path.basename(root)) throw new Error("manifest checkpointId does not match its directory");
  if (!Number.isSafeInteger(value.sequence) || value.sequence < 0) throw new Error("manifest sequence is invalid");
  if (!["WIP", "COMPLETE"].includes(value.status)) throw new Error("manifest status is invalid");
  if (!Array.isArray(value.files) || value.files.length === 0) throw new Error("manifest files are missing");
  for (const file of value.files) {
    if (!safeRelative(file.path) || !allowlistedPath(file.path) || !Number.isSafeInteger(file.size) || file.size < 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) {
      throw new Error(`manifest file entry is invalid: ${file.path}`);
    }
    const filePath = path.join(root, file.path);
    if (!relativeWithin(root, filePath) || !(await pathExists(filePath))) throw new Error(`checkpoint file is missing: ${file.path}`);
    const actual = await stat(filePath);
    if (!actual.isFile() || actual.size !== file.size || (await sha256(filePath)) !== file.sha256) {
      throw new Error(`checkpoint file hash mismatch: ${file.path}`);
    }
  }
  if (value.status === "COMPLETE" && !(await pathExists(path.join(root, COMPLETE_MARKER)))) throw new Error("COMPLETE marker is missing");
  return { ...value, path: root };
}

async function validateCheckpoint(args) {
  const manifest = await readManifest(required(args, "checkpoint"));
  process.stdout.write(`${JSON.stringify({ checkpointId: manifest.checkpointId, sequence: manifest.sequence, status: manifest.status, valid: true, path: manifest.path, files: manifest.files.length })}\n`);
}

async function selectCheckpoint(args) {
  const recoveryRoot = absolute(required(args, "recovery-root"));
  const entries = await readdir(recoveryRoot, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    try {
      const manifest = await readManifest(path.join(recoveryRoot, entry.name));
      if (manifest.status === "COMPLETE") candidates.push(manifest);
    } catch {
      // Invalid, WIP, and interrupted snapshots are deliberately ignored.
    }
  }
  candidates.sort((left, right) => right.sequence - left.sequence || right.createdAt.localeCompare(left.createdAt));
  if (!candidates[0]) throw new Error("no valid COMPLETE checkpoint found");
  const selected = candidates[0];
  process.stdout.write(`${JSON.stringify({ checkpointId: selected.checkpointId, sequence: selected.sequence, status: selected.status, path: selected.path, files: selected.files.length })}\n`);
}

async function restoreCheckpoint(args) {
  const manifest = await readManifest(required(args, "checkpoint"));
  const destination = absolute(required(args, "destination"));
  if (relativeWithin(manifest.path, destination) || relativeWithin(destination, manifest.path)) throw new Error("restore destination must be isolated from checkpoint storage");
  if (await pathExists(destination)) throw new Error("restore destination already exists; choose a new isolated directory");
  if (args["dry-run"]) {
    process.stdout.write(`${JSON.stringify({ checkpointId: manifest.checkpointId, destination, dryRun: true, files: manifest.files.map((file) => file.path) })}\n`);
    return;
  }
  await mkdir(destination, { recursive: true });
  for (const file of manifest.files) {
    const target = path.join(destination, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(manifest.path, file.path), target);
  }
  process.stdout.write(`${JSON.stringify({ checkpointId: manifest.checkpointId, destination, restored: true, files: manifest.files.length })}\n`);
}

function rejectSecret(value, name) {
  if (SECRET_VALUE.test(value)) throw new Error(`--${name} contains a secret-like value`);
}

async function writeProgress(args) {
  const filePath = absolute(required(args, "file"));
  const values = {
    runId: required(args, "run-id"),
    phase: required(args, "phase"),
    task: required(args, "task"),
    nextStep: required(args, "next"),
    lastGoodCheckpoint: args.checkpoint ? String(args.checkpoint) : null,
  };
  for (const [name, value] of Object.entries(values)) if (typeof value === "string") rejectSecret(value, name);
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const previous = `${filePath}.bak`;
  if (await pathExists(filePath)) await copyFile(filePath, previous);
  await writeFile(temporary, `${JSON.stringify({ ...values, status: "IN_PROGRESS", blocker: null, externalOperations: [], updatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
  process.stdout.write(`${JSON.stringify({ file: filePath, updated: true, backup: (await pathExists(previous)) ? previous : null })}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (command === "create") return createCheckpoint(args);
  if (command === "validate") return validateCheckpoint({ ...args, checkpoint: args.checkpoint ?? args._[1] });
  if (command === "select") return selectCheckpoint(args);
  if (command === "restore") return restoreCheckpoint(args);
  if (command === "progress") return writeProgress(args);
  throw new Error("usage: recovery.mjs <create|validate|select|restore|progress> [options]");
}

try {
  await main();
} catch (error) {
  process.stderr.write(`recovery error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
