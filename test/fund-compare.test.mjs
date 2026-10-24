import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fundOverlap, indexWeights } from "../funds.mjs";

test("fund overlap: weights scaled to 100%, matched by symbol / ISIN / name, smaller weight counts", () => {
  const a = [{ symbol: "TCS", weight: 20 }, { isin: "INE009A01021", name: "Infosys Ltd", weight: 20 }, { name: "Trent Limited", weight: 40 }, { name: "Only A", weight: 10 }]; // 90% equity
  const b = [{ symbol: "TCS", weight: 10 }, { isin: "INE009A01021", name: "Infosys", weight: 30 }, { name: "TRENT LTD", weight: 10 }, { name: "Only B", weight: 50 }];
  const o = fundOverlap(a, b);
  // A scaled: TCS 22.2, INFY 22.2, TRENT 44.4, ONLYA 11.1; B: 10, 30, 10, 50 → min: 10 + 22.2 + 10 = 42.2
  assert.equal(o.overlapPct, 42.2);
  assert.equal(o.commonCount, 3); assert.equal(o.commonOfA, 75);
  assert.deepEqual(o.onlyA.map(h => h.name), ["Only A"]); assert.equal(o.onlyBWeight, 50);
  assert.equal(o.common[0].shared, 22.2);
  assert.equal(fundOverlap(a, a).overlapPct, 100);
  assert.equal(fundOverlap(a, [{ name: "X", weight: 5 }]).overlapPct, 0);
});
test("index weights: free-float size; factor indices capped at 5%; fallbacks", () => {
  const rows = [{ ffmc: 50 }, { ffmc: 30 }, ...Array.from({ length: 20 }, () => ({ ffmc: 1 }))];
  const broad = indexWeights("NIFTY MIDCAP 150", rows);
  assert.equal(broad.basis, "free-float market cap (NSE)"); assert.equal(broad.approx, false);
  assert.equal(Math.round(broad.weights[0]), 50);
  const mom = indexWeights("NIFTY200 MOMENTUM 30", rows);
  assert.ok(mom.weights.every(w => w <= 5.0001), JSON.stringify(mom.weights)); assert.ok(Math.abs(mom.weights.reduce((x, y) => x + y, 0) - 100) < 0.2);
  assert.equal(mom.approx, true); assert.match(mom.basis, /capped at 5%/);
  assert.equal(indexWeights("NIFTY 50", [{ marketCap: 10 }, { marketCap: 30 }]).basis, "market cap");
  assert.deepEqual(indexWeights("NIFTY 50", [{}, {}]).weights, [50, 50]);
});

const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
test("server: compare two saved funds (and each one's overlap with your other funds), per account", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ew-cmp-")), port = await freePort();
  const child = spawn(process.execPath, ["server.mjs"], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, SETUP_CODE: "c-code", AUTO_FUNDAMENTALS: "0", KITE_MCP_ENABLED: "0", EOD: "0", BACKUP: "0", ANGEL_STREAM: "0",
    PRICE_SOURCES: "nse,yahoo", NSE_BASE: "http://127.0.0.1:9", YAHOO_CHART_BASE: "http://127.0.0.1:9", YAHOO_QUOTE_BASE: "http://127.0.0.1:9", SCREENER_BASE: "http://127.0.0.1:9", MFDATA_BASE: "http://127.0.0.1:9" }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", d => log += d); child.stderr.on("data", d => log += d);
  const call = async (p, { cookie, body } = {}) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, { method: body ? "POST" : "GET", headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let json = null; try { json = JSON.parse(t); } catch {} return { status: r.status, json, text: t, cookie: (r.headers.get("set-cookie") || "").split(";")[0] }; };
  try {
    for (let i = 0; i < 80 && !log.includes("running at"); i++) await new Promise(r => setTimeout(r, 100));
    const owner = (await call("/api/auth/setup", { body: { code: "c-code", username: "owner", password: "owner-pass-phrase" } })).cookie;
    const save = async (name, hs) => (await call("/api/funds/save", { cookie: owner, body: { name, holdings: hs.map(([symbol, weight]) => ({ name: symbol, symbol, weight, exchange: "NSE" })) } })).json.id;
    const mom = await save("Momentum 30 fund", [["BSE", 6], ["DIXON", 5], ["TRENT", 5], ["BEL", 5], ["HAL", 5]]);
    const mid = await save("Midcap 150 fund", [["DIXON", 2], ["BSE", 2], ["PERSISTENT", 2], ["COFORGE", 2], ["MAXHEALTH", 2]]);
    await save("Flexi cap fund", [["HAL", 10], ["BEL", 10], ["HDFCBANK", 10]]);
    const r = await call(`/api/funds/compare?a=${mom}&b=${mid}`, { cookie: owner });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.overlap.overlapPct, 39.2, "BSE min(23.1, 20) + DIXON min(19.2, 20)");
    assert.equal(r.json.overlap.commonCount, 2);
    assert.equal(r.json.a.withOthers[0].name, "Flexi cap fund");
    assert.ok(r.json.a.withOthers[0].overlapPct > r.json.b.withOthers[0].overlapPct, "the momentum fund repeats the flexi cap more");
    assert.equal((await call(`/api/funds/compare?a=${mom}&b=${mom}`, { cookie: owner })).status, 400);
    // the X-ray library is shared (v5.42): another account can compare these funds, but sees none of this account's money in them
    await call("/api/auth/users", { cookie: owner, body: { username: "other", password: "other-pass-phrase" } });
    const other = (await call("/api/auth/login", { body: { username: "other", password: "other-pass-phrase" } })).cookie;
    if (other) { const o = await call(`/api/funds/compare?a=${mom}&b=${mid}`, { cookie: other }); assert.equal(o.status, 200); assert.equal(o.json.a.held, null); assert.equal(o.json.b.held, null); }
  } finally { child.kill("SIGTERM"); await new Promise(r => child.once("exit", r)); }
});
