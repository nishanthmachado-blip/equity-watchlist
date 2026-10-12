import test from "node:test";
import assert from "node:assert/strict";
import { parseEnv, loadEnv } from "../env.mjs";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";

test("parses KEY=VALUE, comments, quotes, export prefix, CRLF and trailing comments", () => {
  const e = parseEnv('# c\r\nKITE_MCP_ENABLED=1\r\nexport A="x y"\nB=\'q\'\nC=val # note\n  D = 4  \nbad line\n=nokey\n');
  assert.deepEqual(e, { KITE_MCP_ENABLED: "1", A: "x y", B: "q", C: "val", D: "4" });
});
test("loadEnv sets missing variables, never overrides the shell, skips blanks, tolerates a missing file", () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "env-")), ".env");
  fs.writeFileSync(f, "ZZ_NEW=1\nZZ_KEEP=fromfile\nZZ_EMPTY=\n"); process.env.ZZ_KEEP = "fromshell";
  assert.deepEqual(loadEnv(f), ["ZZ_NEW"]); assert.equal(process.env.ZZ_NEW, "1"); assert.equal(process.env.ZZ_KEEP, "fromshell"); assert.equal(process.env.ZZ_EMPTY, undefined);
  assert.deepEqual(loadEnv(path.join(os.tmpdir(), "does-not-exist", ".env")), []);
});
test("a command line with several quoted parts keeps its quotes", () => {
  const e = parseEnv('ANGEL_MCP_COMMAND="C:\\Program Files\\Python\\python.exe" "-m" angelone_mcp.server\nONE="just one"\nCMD2=python -m pkg # note\n');
  assert.equal(e.ANGEL_MCP_COMMAND, '"C:\\Program Files\\Python\\python.exe" "-m" angelone_mcp.server');
  assert.equal(e.ONE, "just one"); assert.equal(e.CMD2, "python -m pkg");
});
