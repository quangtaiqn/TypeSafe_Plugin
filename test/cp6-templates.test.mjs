import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { validateSystemOneInput } from "../src/schema.mjs";

const clients = path.resolve("examples/clients");
const serverPath = "<TYPESAFE_MCP_ROOT>\\src\\index.mjs";

test("CP6 JSON host templates are parseable, portable, and key-free", async () => {
  for (const file of ["claude-desktop.json", "claude-code.mcp.json", "opencode.json", "system-one-call.json"]) {
    const value = JSON.parse(await readFile(path.join(clients, file), "utf8"));
    assert.ok(value);
    const raw = JSON.stringify(value);
    assert.doesNotMatch(raw, /sk-[A-Za-z0-9]{12,}/);
    if (file === "system-one-call.json") {
      assert.deepEqual(validateSystemOneInput(value).questions, value.questions);
    } else {
      assert.match(raw, /REPLACE_WITH_TYPESAFE_API_KEY/);
      assert.match(raw, /<TYPESAFE_MCP_ROOT>\\\\src\\\\index\.mjs/);
    }
  }
});

test("CP6 Codex TOML template contains one local MCP server and no secret", async () => {
  const raw = await readFile(path.join(clients, "codex.toml"), "utf8");
  assert.match(raw, /^\[mcp_servers\.typesafe-jev\]$/m);
  assert.match(raw, /command\s*=\s*"node"/);
  assert.match(raw, /args\s*=\s*\["<TYPESAFE_MCP_ROOT>\\\\src\\\\index\.mjs"\]/);
  assert.match(raw, /TYPESAFE_API_KEY\s*=\s*"REPLACE_WITH_TYPESAFE_API_KEY"/);
  assert.doesNotMatch(raw, /sk-[A-Za-z0-9]{12,}/);
});

test("CP6 companion skill is discoverable and states typed fallback behavior", async () => {
  const skill = await readFile(path.resolve("skills/use-jev-via-mcp/SKILL.md"), "utf8");
  assert.match(skill, /^name:\s*use-jev-via-mcp$/m);
  assert.match(skill, /system_one\(state, questions\)/);
  assert.match(skill, /Do not guess a Jev result/);
  assert.match(skill, /TYPESAFE_API_KEY/);
  assert.equal(skill.includes(serverPath), false);
});
