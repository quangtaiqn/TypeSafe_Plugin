import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { scanTree } from "../scripts/secret-scan.mjs";

const execFileAsync = promisify(execFile);

test("secret scanner reports public findings without echoing values and ignores local secret stores", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "typesafe-secret-scan-"));
  await mkdir(path.join(root, "node_modules"), { recursive: true });
  await mkdir(path.join(root, ".recovery"), { recursive: true });
  await writeFile(path.join(root, ".env"), "TYPESAFE_API_KEY" + "=real-secret-value\n");
  await writeFile(path.join(root, ".env.example"), "TYPESAFE_API_KEY=replace-with-your-typesafe-api-key\n");
  const syntheticTokenLine = `Authorization: Bearer ${"a".repeat(25)}\n`;
  await writeFile(path.join(root, "public.txt"), syntheticTokenLine);
  await writeFile(path.join(root, "docs.md"), "Use https://mcp.example.invalid and REPLACE_WITH_TYPESAFE_API_KEY.\n");
  await writeFile(path.join(root, "node_modules", "ignored.txt"), "sk-" + "abcdefghijklmnopqrstuvwxyz\n");
  const result = await scanTree(root);
  assert.equal(result.clean, false);
  assert.deepEqual(result.findings.map((finding) => finding.path), ["public.txt"]);
  assert.equal(result.findings[0].value, undefined);
  assert.deepEqual(result.excluded.map((entry) => entry.path), [".env", ".recovery", "node_modules"]);
});

test("tracked scan rejects sensitive filenames instead of excluding them", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "typesafe-tracked-secret-scan-"));
  await writeFile(path.join(root, ".env"), "placeholder\n");
  await writeFile(path.join(root, ".npmrc"), "registry=https://registry.example.invalid\n");
  await writeFile(path.join(root, "signing.pem"), "placeholder\n");
  await writeFile(path.join(root, "private.key"), "placeholder\n");
  await execFileAsync("git", ["-C", root, "init", "--initial-branch=main"], { encoding: "utf8" });
  await execFileAsync("git", ["-C", root, "add", "."], { encoding: "utf8" });
  const result = await scanTree(root, { trackedOnly: true });
  assert.equal(result.clean, false);
  assert.deepEqual(result.findings.map((finding) => [finding.path, finding.category]), [
    [".env", "tracked-sensitive-file"],
    [".npmrc", "tracked-sensitive-file"],
    ["private.key", "tracked-sensitive-file"],
    ["signing.pem", "tracked-sensitive-file"],
  ]);
  assert.deepEqual(result.excluded, []);
});
