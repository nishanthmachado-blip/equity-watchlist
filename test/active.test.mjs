import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Stocks tracked only because they sit inside an X-ray fund are not refreshed by the Refresh button (hundreds of them
// got the server blocked), and the refresh never drops them from the watchlist.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
test("Refresh covers the stocks you follow; fund-only stocks are kept as they are", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ew-act-")), port = await freePort(), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server.mjs"], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, AUTO_FUNDAMENTALS: "0", KITE_MCP_ENABLED: "0", SETUP_CODE: "act-code", EOD: "0", BACKUP: "0", PRICE_SOURCES: "nse", NSE_BASE: "http://127.0.0.1:9" }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", d => log += d); child.stderr.on("data", d => log += d);
  const call = async (p, { cookie, body } = {}) => { const r = await fetch(base + p, { method: body ? "POST" : "GET", headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let json = null; try { json = JSON.parse(t); } catch {} return { status: r.status, json, cookie: (r.headers.get("set-cookie") || "").split(";")[0] }; };
  try {
    for (let i = 0; i < 80 && !log.includes("running at"); i++) await new Promise(r => setTimeout(r, 100));
    const owner = (await call("/api/auth/setup", { body: { code: "act-code", username: "owner", password: "owner-pass-phrase" } })).cookie;
    const stocks = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, company: `Co ${i}`, ticker: `FUND${i}`, marketSymbol: `FUND${i}`, exchange: "NSE", price: 100 + i }));
    stocks[0] = { ...stocks[0], ticker: "TCS", marketSymbol: "TCS", company: "TCS" };
    await call("/api/watchlist", { cookie: owner, body: { stocks } });
    await call("/api/lists/members", { cookie: owner, body: { id: "default", remove: stocks.slice(1).map(s => s.marketSymbol) } }); // only TCS is on a watchlist
    const r = await call("/api/refresh", { cookie: owner, body: {} });
    assert.equal(r.status, 200);
    assert.match(log, /Starting 1-stock refresh with news \(24 fund-only stocks left as they are\)/);
    const after = (await call("/api/stocks", { cookie: owner })).json;
    const list = Array.isArray(after) ? after : after.stocks;
    assert.equal(list.length, 25, "no stock dropped");
  } finally { child.kill("SIGTERM"); await new Promise(r => child.once("exit", r)); }
});
