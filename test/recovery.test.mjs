import assert from "node:assert/strict";
import { access, mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const projectRoot = path.resolve(".");
const recoveryScript = path.join(projectRoot, "scripts", "recovery.mjs");

function run(args) {
  const result = spawnSync(process.execPath, [recoveryScript, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return result;
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "typesafe-recovery-"));
  const source = path.join(root, "source");
  const recovery = path.join(root, "recovery");
  await mkdir(path.join(source, "src"), { recursive: true });
  await writeFile(path.join(source, "package.json"), '{"name":"fixture"}\n');
  await writeFile(path.join(source, "src", "main.mjs"), "export const answer = 42;\n");
  await writeFile(path.join(source, ".env"), "TYPESAFE_API_KEY" + "=must-not-be-copied\n");
  await mkdir(path.join(source, "node_modules"), { recursive: true });
  await writeFile(path.join(source, "node_modules", "ignored.txt"), "ignored\n");
  return { root, source, recovery };
}

test("recovery creates an immutable COMPLETE checkpoint without secrets", async () => {
  const { root, source, recovery } = await fixture();
  const created = run(["create", "--id", "CP01-fixture", "--sequence", "1", "--status", "COMPLETE", "--source", source, "--recovery-root", recovery]);
  assert.equal(created.status, 0, created.stderr);
  const checkpoint = path.join(recovery, "CP01-fixture");
  const manifest = JSON.parse(await readFile(path.join(checkpoint, "manifest.json"), "utf8"));
  assert.equal(manifest.status, "COMPLETE");
  assert.deepEqual(manifest.files.map((file) => file.path), ["package.json", "src/main.mjs"]);
  assert.equal(run(["validate", checkpoint]).status, 0);
  assert.equal(run(["create", "--id", "CP01-fixture", "--sequence", "1", "--status", "COMPLETE", "--source", source, "--recovery-root", recovery]).status, 1);
  assert.equal((await readFile(path.join(checkpoint, "package.json"), "utf8")).includes("fixture"), true);
  await assert.rejects(access(path.join(checkpoint, ".env")));
  assert.ok(root);
});

test("selector ignores WIP and corrupt checkpoints and restores the last valid COMPLETE", async () => {
  const { root, source, recovery } = await fixture();
  assert.equal(run(["create", "--id", "CP01-fixture", "--sequence", "1", "--status", "COMPLETE", "--source", source, "--recovery-root", recovery]).status, 0);
  assert.equal(run(["create", "--id", "CP02-wip", "--sequence", "2", "--status", "WIP", "--source", source, "--recovery-root", recovery]).status, 0);
  assert.equal(run(["create", "--id", "CP03-corrupt", "--sequence", "3", "--status", "COMPLETE", "--source", source, "--recovery-root", recovery]).status, 0);
  await writeFile(path.join(recovery, "CP03-corrupt", "src", "main.mjs"), "tampered\n");
  const selected = run(["select", "--recovery-root", recovery]);
  assert.equal(selected.status, 0, selected.stderr);
  assert.equal(JSON.parse(selected.stdout).checkpointId, "CP01-fixture");

  const destination = path.join(root, "restore");
  const dryRun = run(["restore", "--checkpoint", path.join(recovery, "CP01-fixture"), "--destination", destination, "--dry-run"]);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  await assert.rejects(access(destination));
  const restored = run(["restore", "--checkpoint", path.join(recovery, "CP01-fixture"), "--destination", destination]);
  assert.equal(restored.status, 0, restored.stderr);
  assert.equal(await readFile(path.join(destination, "src", "main.mjs"), "utf8"), "export const answer = 42;\n");
});

test("recovery fails closed for unallowlisted files and secret-like source content", async () => {
  const unallowlisted = await fixture();
  await writeFile(path.join(unallowlisted.source, "notes.txt"), "private notes\n");
  const rejectedPath = run(["create", "--id", "CP04-unallowlisted", "--sequence", "4", "--status", "COMPLETE", "--source", unallowlisted.source, "--recovery-root", unallowlisted.recovery]);
  assert.equal(rejectedPath.status, 1);
  assert.match(rejectedPath.stderr, /not allowlisted/i);

  const secretContent = await fixture();
  await writeFile(path.join(secretContent.source, "src", "leak.mjs"), ["Authorization: Bearer ", "a".repeat(25), "\n"].join(""));
  const rejectedContent = run(["create", "--id", "CP05-secret-content", "--sequence", "5", "--status", "COMPLETE", "--source", secretContent.source, "--recovery-root", secretContent.recovery]);
  assert.equal(rejectedContent.status, 1);
  assert.match(rejectedContent.stderr, /secret-like content/i);
});

test("progress journal is written atomically and excludes secret-like values", async () => {
  const { root } = await fixture();
  const journal = path.join(root, "progress.json");
  const written = run(["progress", "--file", journal, "--run-id", "run-1", "--phase", "R0", "--task", "recovery", "--next", "validate", "--checkpoint", "R0-20260920-source"]);
  assert.equal(written.status, 0, written.stderr);
  const value = JSON.parse(await readFile(journal, "utf8"));
  assert.equal(value.runId, "run-1");
  assert.equal(value.phase, "R0");
  assert.equal(value.lastGoodCheckpoint, "R0-20260920-source");
  assert.equal(run(["progress", "--file", journal, "--run-id", "run-2", "--phase", "R0", "--task", "x", "--next", "Bearer secret-token"]).status, 1);
});
