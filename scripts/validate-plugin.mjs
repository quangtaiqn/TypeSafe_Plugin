import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanTree } from "./secret-scan.mjs";

async function exists(filePath) {
  try { await access(filePath); return true; }
  catch { return false; }
}

function semver(value) {
  return typeof value === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
}

export async function validatePlugin(pluginPath) {
  const root = path.resolve(pluginPath);
  const errors = [];
  const manifestPath = path.join(root, ".codex-plugin", "plugin.json");
  if (!(await exists(manifestPath))) errors.push(".codex-plugin/plugin.json is missing");
  if (errors.length > 0) return { valid: false, errors };
  let manifest;
  try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); }
  catch { return { valid: false, errors: ["plugin.json is not valid JSON"] }; }
  if (manifest.name !== path.basename(root)) errors.push("manifest name must match plugin directory");
  if (!semver(manifest.version)) errors.push("manifest version must be strict semver");
  if (!manifest.description || typeof manifest.description !== "string") errors.push("manifest description is required");
  if (!manifest.author?.name) errors.push("manifest author.name is required");
  for (const field of ["displayName", "shortDescription", "longDescription", "developerName", "category"]) {
    if (!manifest.interface?.[field]) errors.push(`manifest interface.${field} is required`);
  }
  if (manifest.interface?.defaultPrompt && (!Array.isArray(manifest.interface.defaultPrompt) || manifest.interface.defaultPrompt.length > 3)) errors.push("interface.defaultPrompt must contain at most three prompts");
  if (typeof manifest.skills !== "string" || !(await exists(path.join(root, manifest.skills)))) errors.push("manifest skills path is missing");
  if (typeof manifest.mcpServers !== "string") errors.push("manifest mcpServers must point to a companion file");
  const mcpPath = typeof manifest.mcpServers === "string" ? path.join(root, manifest.mcpServers) : "";
  if (mcpPath && !(await exists(mcpPath))) errors.push("manifest mcpServers path is missing");
  if (mcpPath) {
    try {
      const mcp = JSON.parse(await readFile(mcpPath, "utf8"));
      if (!mcp.mcpServers || Object.keys(mcp.mcpServers).length !== 1) errors.push(".mcp.json must expose exactly one server");
    } catch { errors.push(".mcp.json is not valid JSON"); }
  }
  const files = await scanTree(root);
  if (files.findings.length > 0) errors.push("secret-like content found in plugin artifact");
  const rawManifest = JSON.stringify(manifest);
  if (/\[TODO:/i.test(rawManifest)) errors.push("plugin manifest contains a TODO placeholder");
  return {
    valid: errors.length === 0,
    name: manifest.name,
    version: manifest.version,
    endpointTemplate: true,
    errors,
  };
}

const isMainModule = process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMainModule) {
  try {
    const result = await validatePlugin(process.argv[2] ?? "plugins/typesafe");
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.valid) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`plugin validation error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
