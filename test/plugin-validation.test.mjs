import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("repository plugin validator accepts the sanitized TypeSafe manifest", () => {
  const result = spawnSync(process.execPath, ["scripts/validate-plugin.mjs", "plugins/typesafe"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).valid, true);
});
