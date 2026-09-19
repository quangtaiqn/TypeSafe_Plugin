import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { scanTree } from "../scripts/secret-scan.mjs";

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
