import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chartEvents, applyDrawingOp, sanitizeDrawing } from "../chartmarks.mjs";

test("chart marks: results, dividends, order wins and your trades; upcoming ones flagged", () => {
  const ev = chartEvents("TCS", { today: "2026-10-21",
    corp: { events: [{ symbol: "TCS", date: "2026-07-10", kind: "results", label: "Results" }, { symbol: "TCS", date: "2026-11-05", kind: "results", label: "Results" }, { symbol: "INFY", date: "2026-07-11", kind: "results" }],
      actions: [{ symbol: "TCS", exDate: "2026-07-18", kind: "dividend", amount: 11, label: "Dividend" }] },
    divs: [{ d: "2026-07-18", a: 11 }, { d: "2025-07-18", a: 10 }],
    orders: [{ symbol: "TCS", day: "2026-09-01", valueCr: 1250, text: "Bagging of order" }, { symbol: "INFY", day: "2026-09-02", valueCr: 9 }],
    ledger: [{ type: "BUY", symbol: "TCS", date: "2026-08-03", at: "2026-08-03T05:00:00Z", qty: 5, price: 3000 }, { type: "SELL", symbol: "TCS", date: "2026-09-10", at: "2026-09-10T06:00:00Z", qty: 5, price: 3300, pnl: 1500, pnlPct: 10 }] });
  assert.deepEqual(ev.map(e => [e.kind, e.date]), [["dividend", "2025-07-18"], ["results", "2026-07-10"], ["dividend", "2026-07-18"], ["buy", "2026-08-03"], ["order", "2026-09-01"], ["sell", "2026-09-10"], ["results", "2026-11-05"]]);
  assert.equal(ev.at(-1).upcoming, true);
  assert.match(ev.find(e => e.kind === "order").label, /1,250 Cr/);
  assert.match(ev.find(e => e.kind === "sell").detail, /\+₹1,500 \(10%\)/);
});
test("chart lines: add / delete / clear, with checks", () => {
  let st = applyDrawingOp({}, "TCS", "add", { kind: "h", price: "₹3,050.5" });
  st = applyDrawingOp(st, "TCS", "add", { kind: "trend", t1: 2000, p1: 120, t2: 1000, p2: 100 });
  assert.deepEqual(st.TCS.map(l => l.kind === "h" ? l.price : [l.t1, l.p1, l.t2, l.p2]), [3050.5, [1000, 100, 2000, 120]], "trend points in time order");
  assert.throws(() => sanitizeDrawing({ kind: "h", price: -1 }));
  assert.throws(() => sanitizeDrawing({ kind: "trend", t1: 5, p1: 1, t2: 5, p2: 2 }));
  st = applyDrawingOp(st, "TCS", "delete", { id: st.TCS[0].id }); assert.equal(st.TCS.length, 1);
  st = applyDrawingOp(st, "TCS", "clear"); assert.equal(st.TCS, undefined);
});

const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIP = [{ token: "11536", symbol: "TCS-EQ", name: "TCS", exch_seg: "NSE", instrumenttype: "" },
  ...Array.from({ length: 600 }, (_, i) => ({ token: String(50000 + i), symbol: `FILL${i}-EQ`, name: `FILL${i}`, exch_seg: "NSE", instrumenttype: "" }))];
const istTs = (day, hm) => `${day}T${hm}:00+05:30`;

async function start(env) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ew-chart-")), port = await freePort();
  const child = spawn(process.execPath, ["server.mjs"], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, SETUP_CODE: "ch-code", AUTO_FUNDAMENTALS: "0", KITE_MCP_ENABLED: "0", EOD: "0", BACKUP: "0",
    PRICE_SOURCES: "nse,yahoo,screener", NSE_BASE: "http://127.0.0.1:9", SCREENER_BASE: "http://127.0.0.1:9", ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", d => log += d); child.stderr.on("data", d => log += d);
  const call = async (p, { cookie, body } = {}) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, { method: body ? "POST" : "GET", headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let json = null; try { json = JSON.parse(t); } catch {} return { status: r.status, json, text: t, cookie: (r.headers.get("set-cookie") || "").split(";")[0] }; };
  for (let i = 0; i < 80 && !log.includes("running at"); i++) await new Promise(r => setTimeout(r, 100));
  const owner = (await call("/api/auth/setup", { body: { code: "ch-code", username: "owner", password: "owner-pass-phrase" } })).cookie;
  return { call, owner, log: () => log, stop: async () => { child.kill("SIGTERM"); await new Promise(r => child.once("exit", r)); } };
}

test("chart: candles from Angel One with the right interval per period, your levels, and only read-only calls", async () => {
  const seen = [];
  const fake = http.createServer(async (req, res) => {
    let body = ""; for await (const ch of req) body += ch;
    seen.push(`${req.method} ${req.url} ${body}`);
    const send = o => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
    if (req.url === "/scrip") return send(SCRIP);
    if (req.url.endsWith("/loginByPassword")) return send({ status: true, data: { jwtToken: "JWT1", refreshToken: "R" } });
    if (req.url.endsWith("/getProfile")) return send({ status: true, data: { clientcode: "A1", name: "Test" } });
    if (req.url.endsWith("/market/v1/quote/")) return send({ status: true, data: { fetched: [{ symbolToken: "11536", ltp: 1150, close: 1140, exchFeedTime: "21-Oct-2026 15:29:59" }], unfetched: [] } });
    if (req.url.endsWith("/getCandleData")) {
      const b = JSON.parse(body);
      if (b.interval === "ONE_DAY") { const out = []; const d = new Date(`${b.fromdate.slice(0, 10)}T00:00:00Z`), end = new Date(`${b.todate.slice(0, 10)}T00:00:00Z`); let p = 1000; for (; d <= end; d.setUTCDate(d.getUTCDate() + 1)) { if ([0, 6].includes(d.getUTCDay())) continue; p += 1; out.push([istTs(d.toISOString().slice(0, 10), "00:00"), p - 2, p + 5, p - 5, p, 1000]); } return send({ status: true, data: out }); }
      // intraday: two days of 5-minute bars
      return send({ status: true, data: ["2026-10-20", "2026-10-21"].flatMap(day => ["09:15", "09:20", "09:25"].map((hm, i) => [istTs(day, hm), 3000 + i, 3005 + i, 2995 + i, 3002 + i, 500])) });
    }
    res.writeHead(404); res.end("{}");
  });
  const fport = await freePort(); await new Promise(r => fake.listen(fport, "127.0.0.1", r));
  const F = `http://127.0.0.1:${fport}`;
  const s = await start({ YAHOO_CHART_BASE: "http://127.0.0.1:9", ANGEL_API_ROOT: F, ANGEL_SCRIP_URL: `${F}/scrip`, ANGEL_API_KEY: "key", ANGEL_CLIENT_CODE: "A1", ANGEL_PIN: "1234", ANGEL_TOTP_SECRET: "JBSWY3DPEHPK3PXP", ANGEL_STREAM: "0" });
  try {
    const sp = await s.call("/api/swing/position", { cookie: s.owner, body: { symbol: "TCS", name: "TCS", qty: 10, avgPrice: 1100, stopLoss: 1000 } }); assert.equal(sp.status, 200, sp.text);
    const d = await s.call("/api/chart?symbol=TCS&tf=1Y", { cookie: s.owner });
    assert.equal(d.status, 200, d.text + s.log().slice(-600));
    assert.equal(d.json.source, "Angel One", JSON.stringify(d.json.notes) + s.log().slice(-500));
    assert.equal(d.json.interval, "ONE_DAY");
    assert.ok(d.json.bars.length > 400, "a year plus ~300 days for the 200-day average");
    assert.ok(d.json.bars[0].t < d.json.viewFrom, "view starts after the extra history");
    const kinds = d.json.levels.map(l => l.kind);
    assert.ok(kinds.includes("avg") && kinds.includes("stop") && kinds.includes("target"), JSON.stringify(d.json.levels));
    const i = await s.call("/api/chart?symbol=TCS&tf=1D", { cookie: s.owner });
    assert.equal(i.json.interval, "FIVE_MINUTE");
    assert.equal(i.json.bars.length, 3, "1D keeps only the last trading day");
    assert.equal(new Date((i.json.bars[0].t + 19800) * 1000).toISOString().slice(11, 16), "09:15");
    assert.ok(seen.some(x => /getCandleData .*"interval":"FIFTEEN_MINUTE"|getCandleData .*"interval":"FIVE_MINUTE"/.test(x)));
    assert.ok(d.json.events.some(e => e.kind === "buy" && /Bought 10/.test(e.label)), "your buy is marked");
    assert.equal(d.json.position.stopLoss, 1000);
    // click-to-act: stop-loss, alert, your lines
    assert.equal((await s.call("/api/swing/stop", { cookie: s.owner, body: { id: d.json.position.id, stopLoss: 1050 } })).status, 200);
    assert.equal((await s.call("/api/rules/save", { cookie: s.owner, body: { symbol: "TCS", type: "above", value: 1500 } })).status, 200);
    const ln = await s.call("/api/chart/lines", { cookie: s.owner, body: { symbol: "TCS", op: "add", line: { kind: "h", price: 1234.5 } } });
    assert.equal(ln.status, 200, ln.text); assert.equal(ln.json.lines[0].price, 1234.5);
    const d2 = await s.call("/api/chart?symbol=TCS&tf=1Y", { cookie: s.owner });
    assert.equal(d2.json.position.stopLoss, 1050);
    assert.ok(d2.json.levels.some(l => l.kind === "alert" && l.price === 1500 && l.id), "your alert shows as a line");
    assert.equal(d2.json.lines.length, 1);
    assert.equal((await s.call("/api/chart/lines", { cookie: s.owner, body: { symbol: "TCS", op: "add", line: { kind: "h", price: "x" } } })).status, 400);
    assert.equal((await s.call("/api/chart?symbol=../etc&tf=1D", { cookie: s.owner })).status, 400);
    assert.equal((await s.call("/api/chart?symbol=TCS&tf=1D")).status, 401, "needs a login");
    assert.ok(seen.every(x => !/order|place|modify|cancel/i.test(x.split(" ")[1])), "only read-only endpoints");
  } finally { await s.stop(); fake.closeAllConnections(); fake.close(); }
});

test("chart: without Angel One a daily chart falls back to Yahoo; a hanging site doesn't hold the page", async () => {
  const yahoo = http.createServer((req, res) => {
    const now = Math.floor(Date.now() / 1000), ts = Array.from({ length: 300 }, (_, i) => now - (300 - i) * 86400);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ chart: { result: [{ meta: {}, timestamp: ts, indicators: { quote: [{ open: ts.map((_, i) => 99 + i), high: ts.map((_, i) => 105 + i), low: ts.map((_, i) => 95 + i), close: ts.map((_, i) => 100 + i), volume: ts.map(() => 10) }] } }] } }));
  });
  const yport = await freePort(); await new Promise(r => yahoo.listen(yport, "127.0.0.1", r));
  const hang = http.createServer(() => {}); const hport = await freePort(); await new Promise(r => hang.listen(hport, "127.0.0.1", r));
  try {
  const s = await start({ YAHOO_CHART_BASE: `http://127.0.0.1:${yport}` });
  try {
    const d = await s.call("/api/chart?symbol=TCS&tf=1Y", { cookie: s.owner });
    assert.equal(d.status, 200, d.text);
    assert.equal(d.json.source, "Yahoo");
    assert.equal(d.json.bars[0].o, 99, "keeps Yahoo's open");
    assert.ok(d.json.notes.some(n => /Angel One not connected/.test(n)));
    const i = await s.call("/api/chart?symbol=TCS&tf=1D", { cookie: s.owner });
    assert.deepEqual([i.json.bars.length, i.json.source], [0, null], "no intraday without Angel One");
  } finally { await s.stop(); }
  const s2 = await start({ YAHOO_CHART_BASE: `http://127.0.0.1:${hport}` });
  try {
    const t0 = Date.now(), d = await s2.call("/api/chart?symbol=TCS&tf=6M", { cookie: s2.owner });
    assert.equal(d.status, 200); assert.ok(Date.now() - t0 < 5000, `took ${Date.now() - t0} ms`);
    assert.ok(d.json.notes.some(n => /too long/.test(n)), JSON.stringify(d.json.notes));
  } finally { await s2.stop(); }
  } finally { for (const x of [yahoo, hang]) { x.closeAllConnections(); x.close(); } }
});
