import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { decide, marketMood } from "../nowcall.mjs";

const good = { company: "Good Co", price: 100, ratio: 0.9, zoneLow: 85, zoneHigh: 100, view: "Fair", roce: 28, salesCagr3: 18, profitCagr3: 20, borrowings: 10, reserves: 500, cfoToProfit3: 1, fcfNegative: 0, promoter: 60, promoterChange3y: 0, sector: "IT", fairValue: { base: 115 } };
const rich = { ...good, company: "Rich Co", price: 160, ratio: 1.8, zoneHigh: 110, zoneLow: 90, view: "Expensive" };
const weakBiz = { ...good, company: "Weak Co", roce: 5, salesCagr3: -4, profitCagr3: -10, borrowings: 900, reserves: 300, cfoToProfit3: 0.2, fcfNegative: 1, promoter: 20 };
const snap = (o = {}) => ({ price: 100, sma200: 90, sma200Ago: 88, high52: 120, rs3m: 6, ...o });
const bars = (n, f) => Array.from({ length: n }, (_, i) => ({ c: f(i) }));

test("market mood: healthy, weak and bear from Nifty bars", () => {
  assert.equal(marketMood(bars(260, i => 100 + i * 0.2)).mood, "strong");
  const weak = marketMood(bars(260, i => (i < 200 ? 100 + i * 0.2 : 140 - (i - 200) * 0.3)));
  assert.equal(weak.mood, "weak"); assert.match(weak.text, /3 parts/);
  assert.equal(marketMood(bars(260, i => (i < 200 ? 100 + i * 0.3 : 160 - (i - 200) * 0.8))).mood, "bear");
  assert.equal(marketMood([]).mood, "unknown");
});
test("decide: one lane per stock; Top 5 ranks long-term buys and caps a sector at two", () => {
  const items = [
    { symbol: "GOOD", sources: ["Favourite"], row: good, snap: snap() },
    { symbol: "RICH", sources: ["Holding"], row: rich, snap: snap({ price: 160 }), held: { value: 50000, weightPct: 5 } },
    { symbol: "WEAK", sources: ["Holding"], row: weakBiz, snap: snap(), held: { value: 50000, weightPct: 5 } },
    { symbol: "SWNG", sources: ["Favourite"], row: weakBiz, snap: snap(), swing: { label: "Breakout on volume", score: 70, entry: 100, stop: 94, riskPct: 6, t1: 112, t1Pct: 12 } },
    { symbol: "CUT", sources: ["Holding"], row: good, snap: snap(), held: { value: 9000, weightPct: 1 }, review: { verdict: "Exit", reasons: [{ tone: "against", text: "Too small to matter" }] } },
    { symbol: "BIG", sources: ["Holding"], row: good, snap: snap(), held: { value: 900000, weightPct: 30 } },
    { symbol: "NODATA", sources: ["Theme: Growth"], row: null, snap: null },
    { symbol: "IT2", sources: ["Favourite"], row: { ...good, ratio: 0.95 }, snap: snap() },
    { symbol: "IT3", sources: ["Favourite"], row: { ...good, ratio: 1.0 }, snap: snap() },
    { symbol: "BANK", sources: ["Favourite"], row: { ...good, sector: "Banks" }, snap: snap() }
  ];
  const d = decide(items, { market: { mood: "weak", label: "Weak market", text: "" }, cash: 300000 });
  const lane = s => d.rows.find(r => r.symbol === s).lane;
  assert.equal(lane("GOOD"), "buy"); assert.equal(lane("RICH"), "wait"); assert.equal(lane("WEAK"), "trim"); assert.equal(lane("SWNG"), "swing");
  assert.equal(lane("CUT"), "trim"); assert.equal(lane("BIG"), "hold"); assert.equal(lane("NODATA"), "skip");
  assert.match(d.rows.find(r => r.symbol === "RICH").action, /Wait for ₹110/);
  assert.match(d.rows.find(r => r.symbol === "GOOD").action, /3 parts/);
  assert.ok(!d.top.includes("BIG"), "an overweight holding is not a top buy");
  assert.equal(d.top.filter(s => ["GOOD", "IT2", "IT3"].includes(s)).length, 2, "at most two from one sector");
  assert.ok(d.top.includes("BANK"));
  assert.deepEqual(d.split, { cash: 300000, each: 100000, now: 33333, parts: 3 });
  assert.equal(d.rows[0].symbol, d.top[0], "the Top 5 come first");
  assert.deepEqual(d.next, ["RICH"]);
});

const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
test("server: What to do now is per login", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ew-548-")), port = await freePort();
  const child = spawn(process.execPath, ["server.mjs"], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, SETUP_CODE: "c548", AUTO_FUNDAMENTALS: "0", KITE_MCP_ENABLED: "0", EOD: "0", BACKUP: "0", ANGEL_PRICES: "0", PRICE_SOURCES: "nse", NSE_BASE: "http://127.0.0.1:9", YAHOO_BASE: "http://127.0.0.1:9", MFAPI_BASE: "http://127.0.0.1:9", AMFI_NAV_URL: "http://127.0.0.1:9/nav" }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", d => log += d); child.stderr.on("data", d => log += d);
  const call = async (p, { cookie, body } = {}) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, { method: body ? "POST" : "GET", headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ } return { status: r.status, json, text, cookie: (r.headers.get("set-cookie") || "").split(";")[0] }; };
  try {
    for (let i = 0; i < 80 && !log.includes("running at"); i++) await new Promise(r => setTimeout(r, 100));
    const owner = (await call("/api/auth/setup", { body: { code: "c548", username: "owner", password: "owner-pass-phrase" } })).cookie;
    await call("/api/auth/users", { cookie: owner, body: { username: "friend", password: "friend-pass-phrase" } });
    const friend = (await call("/api/auth/login", { body: { username: "friend", password: "friend-pass-phrase" } })).cookie;
    assert.equal((await call("/api/decide")).status, 401);
    await call("/api/favourites", { cookie: owner, body: { symbol: "TCS", on: true } });
    const a = await call("/api/decide?amount=500000", { cookie: owner });
    assert.equal(a.status, 200); assert.ok(a.json.rows.some(r => r.symbol === "TCS" && r.sources.includes("Favourite")), JSON.stringify(a.json.rows).slice(0, 300));
    const f = await call("/api/decide", { cookie: friend });
    assert.equal(f.json.rows.length, 0, "the other login sees none of it");
  } finally { child.kill("SIGTERM"); await new Promise(r => child.once("exit", r)); await fs.rm(dataDir, { recursive: true, force: true }); }
});
