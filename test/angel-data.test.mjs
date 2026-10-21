import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseAngelScripMaster, normalizeAngelQuotes, normalizeAngelCandles } from "../brokers.mjs";

const SCRIP = [
  { token: "11536", symbol: "TCS-EQ", name: "TCS", exch_seg: "NSE", instrumenttype: "" },
  { token: "1594", symbol: "INFY-EQ", name: "INFY", exch_seg: "NSE", instrumenttype: "" },
  { token: "99999", symbol: "INFY-BL", name: "INFY", exch_seg: "NSE", instrumenttype: "" },
  { token: "35003", symbol: "NIFTY28OCT26FUT", name: "NIFTY", exch_seg: "NFO", instrumenttype: "FUTIDX" },
  { token: "532540", symbol: "TCS", name: "TCS", exch_seg: "BSE", instrumenttype: "" },
  ...Array.from({ length: 600 }, (_, i) => ({ token: String(50000 + i), symbol: `FILL${i}-EQ`, name: `FILL${i}`, exch_seg: "NSE", instrumenttype: "" }))
];
test("Angel instrument list, quotes and candles are read correctly", () => {
  const m = parseAngelScripMaster(SCRIP);
  assert.deepEqual([m["NSE:TCS"], m["NSE:INFY"], m["BSE:TCS"], m["NFO:NIFTY"]], ["11536", "1594", "532540", undefined]);
  const q = normalizeAngelQuotes({ status: true, data: { fetched: [{ exchange: "NSE", tradingSymbol: "TCS-EQ", symbolToken: "11536", ltp: 3050.5, close: 3020, "52WeekHigh": 4200, "52WeekLow": 2900, exchFeedTime: "21-Oct-2026 15:29:59" }], unfetched: [] } }).get("11536");
  assert.deepEqual([q.price, q.prevClose, q.high52, q.low52, q.asOf], [3050.5, 3020, 4200, 2900, "2026-10-21T09:59:59.000Z"]);
  const c = normalizeAngelCandles({ status: true, data: [["2026-10-21T00:00:00+05:30", 3000, 3060, 2990, 3050.5, 123456], ["2026-10-20T00:00:00+05:30", 2990, 3010, 2980, 3000, 100000]] });
  assert.deepEqual(c.map(b => b.c), [3000, 3050.5]);
});

const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
test("⟳ gets the price from your Angel One account (logs in by itself), even when every public site refuses", async () => {
  const seen = [];
  const fake = http.createServer(async (req, res) => {
    let body = ""; for await (const ch of req) body += ch;
    seen.push(`${req.method} ${req.url}`);
    const send = o => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
    if (req.url === "/scrip") return send(SCRIP);
    if (req.url.endsWith("/loginByPassword")) { const b = JSON.parse(body); assert.match(b.totp, /^\d{6}$/); return send({ status: true, data: { jwtToken: "JWT1", refreshToken: "R" } }); }
    if (req.headers.authorization !== "Bearer JWT1") { res.writeHead(401); return res.end(JSON.stringify({ status: false, message: "Invalid Token", errorcode: "AG8001" })); }
    if (req.url.endsWith("/getProfile")) return send({ status: true, data: { clientcode: "A1", name: "Test" } });
    if (req.url.endsWith("/market/v1/quote/")) { const b = JSON.parse(body); return send({ status: true, data: { fetched: (b.exchangeTokens.NSE || []).filter(t => t === "11536").map(t => ({ symbolToken: t, ltp: 3050.5, close: 3020, "52WeekHigh": 4200, "52WeekLow": 2900, exchFeedTime: "21-Oct-2026 15:29:59" })), unfetched: [] } }); }
    res.writeHead(404); res.end("{}");
  });
  const fport = await freePort(); await new Promise(r => fake.listen(fport, "127.0.0.1", r));
  const F = `http://127.0.0.1:${fport}`, dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ew-ang-")), port = await freePort();
  const child = spawn(process.execPath, ["server.mjs"], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, SETUP_CODE: "ang-code", AUTO_FUNDAMENTALS: "0", KITE_MCP_ENABLED: "0", EOD: "0", BACKUP: "0",
    PRICE_SOURCES: "nse,yahoo,screener", NSE_BASE: "http://127.0.0.1:9", YAHOO_CHART_BASE: "http://127.0.0.1:9", SCREENER_BASE: "http://127.0.0.1:9",
    ANGEL_API_ROOT: F, ANGEL_SCRIP_URL: `${F}/scrip`, ANGEL_API_KEY: "key", ANGEL_CLIENT_CODE: "A1", ANGEL_PIN: "1234", ANGEL_TOTP_SECRET: "JBSWY3DPEHPK3PXP" }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", d => log += d); child.stderr.on("data", d => log += d);
  const call = async (p, { cookie, body } = {}) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, { method: body ? "POST" : "GET", headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let json = null; try { json = JSON.parse(t); } catch {} return { status: r.status, json, text: t, cookie: (r.headers.get("set-cookie") || "").split(";")[0] }; };
  try {
    for (let i = 0; i < 80 && !log.includes("running at"); i++) await new Promise(r => setTimeout(r, 100));
    const owner = (await call("/api/auth/setup", { body: { code: "ang-code", username: "owner", password: "owner-pass-phrase" } })).cookie;
    const r = await call("/api/prices/now", { cookie: owner, body: { symbol: "TCS" } });
    assert.equal(r.status, 200, r.text + log.slice(-800));
    assert.deepEqual([r.json.price, r.json.source], [3050.5, "Angel One"]);
    assert.ok(seen.some(x => x.endsWith("/loginByPassword")), "logged in by itself with PIN + TOTP");
    assert.ok(seen.every(x => !/order|place|modify|cancel/i.test(x)), "only read-only endpoints");
  } finally { child.kill("SIGTERM"); await new Promise(r => child.once("exit", r)); fake.close(); }
});
