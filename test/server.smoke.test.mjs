import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import os from "node:os";

// Boots the real server and calls the read-only endpoints, so a missing function or bad import (ReferenceError) fails here.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });

test("server boots and read-only endpoints answer without errors", async () => {
  const port = await freePort(), dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ew-smoke-"));
  const child = spawn(process.execPath, ["server.mjs"], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, SETUP_CODE: "smoke-test-code", AUTO_FUNDAMENTALS: "0", KITE_MCP_ENABLED: "0" }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", d => log += d); child.stderr.on("data", d => log += d);
  try {
    for (let i = 0; i < 50 && !log.includes("running at"); i++) await new Promise(r => setTimeout(r, 100));
    assert.ok(log.includes("running at"), `server did not start: ${log}`);
    const setup = await fetch(`http://127.0.0.1:${port}/api/auth/setup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: "smoke-test-code", username: "owner", password: "smoke-test-pass" }) });
    assert.equal(setup.status, 200, await setup.clone().text());
    const Cookie = setup.headers.get("set-cookie").split(";")[0];
    for (const p of ["/api/health", "/api/stocks", "/api/valuation", "/api/thesis", "/api/kite/status", "/api/kite/holdings", "/api/holdings", "/api/brokers/status", "/api/plan", "/"]) {
      const r = await fetch(`http://127.0.0.1:${port}${p}`, { headers: { Cookie } }); const body = await r.text();
      assert.equal(r.status, 200, `${p} -> ${r.status}: ${body.slice(0, 200)}`);
    }
    // Data-changing requests from another website are refused; the app's own page (same origin) is allowed.
    const evil = await fetch(`http://127.0.0.1:${port}/api/brokers/dhan/mcp/config`, { method: "POST", headers: { Cookie, Origin: "https://evil.example", "Content-Type": "text/plain" }, body: JSON.stringify({ url: "https://evil.example/mcp" }) });
    assert.equal(evil.status, 403);
    const own = await fetch(`http://127.0.0.1:${port}/api/brokers/dhan/mcp/status`, { headers: { Cookie } }); assert.equal(own.status, 200);
  } finally { child.kill(); await fs.rm(dataDir, { recursive: true, force: true }); }
});
