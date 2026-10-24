import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { reviewHoldings, saleTax, trendOf } from "../cleanup.mjs";
import { sanitizeTrail, applyTrail, trailLevel, trailChanges } from "../trailstop.mjs";
import { backtestBars, summarize, perStock, sanitizeBacktest } from "../backtest.mjs";
import { journalStats, guessSetup, setupFromIdea, diffSwingAlerts, sanitizePosition, SETUPS } from "../swing.mjs";
import { briefSections, morningDigest } from "../digest.mjs";

const H = (symbol, o = {}) => ({ symbol, company: `${symbol} Ltd`, qty: 10, value: 100000, invested: 80000, pnl: 20000, weightPct: 10, stance: { action: "Hold", summary: "Keep it.", reasons: [] }, valuation: { view: "Fair" }, ...o });

test("clean-up review: stance → call, trend holds back adds, rich + falling trend trims, tiny positions, fund overlap", () => {
  const holdings = [
    H("ADDME", { stance: { action: "Accumulate", reasons: [{ tone: "for", text: "Cheap." }] }, valuation: { view: "Cheap" } }),
    H("FALLADD", { stance: { action: "Accumulate", reasons: [] } }),
    H("RICHDOWN", { valuation: { view: "Very rich" } }),
    H("BROKEN", { stance: { action: "Review", reasons: [{ tone: "against", text: "Thesis broken." }] } }),
    H("TINY", { value: 2000, invested: 2500, pnl: -500, qty: 1 }),
    H("FUNDS", { stance: { action: "Accumulate", reasons: [] } })
  ];
  const tech = new Map([
    ["ADDME", { price: 1, sma200: 8000, sma200Ago: 7600 }], ["FALLADD", { price: 1, sma200: 11000, sma200Ago: 11500 }], ["RICHDOWN", { price: 1, sma200: 11000, sma200Ago: 11500 }],
    ["BROKEN", { price: 1, sma200: 11000, sma200Ago: 11100 }], ["FUNDS", { price: 1, sma200: 8000, sma200Ago: 7600 }]
  ]);
  const look = new Map([["FUNDS", { viaFunds: 70000, sources: [{ fund: "Flexi Cap Fund", value: 70000 }] }]]);
  const r = reviewHoldings({ holdings, tech, look, equityTotal: 1e6 }), by = Object.fromEntries(r.rows.map(x => [x.symbol, x]));
  assert.equal(by.ADDME.verdict, "Add");
  assert.equal(by.FALLADD.verdict, "Keep", "below a falling 200-DMA: wait before adding");
  assert.equal(by.RICHDOWN.verdict, "Trim", "rich in a downtrend");
  assert.equal(by.BROKEN.verdict, "Exit");
  assert.equal(by.TINY.verdict, "Exit"); assert.ok(by.TINY.tiny); assert.match(by.TINY.reasons.map(x => x.text).join(" "), /Too small to matter/);
  assert.equal(by.FUNDS.verdict, "Keep", "funds already hold 70% on top"); assert.equal(by.FUNDS.viaFunds, 70000);
  assert.equal(r.rows[0].verdict, "Exit", "exits listed first");
  assert.deepEqual(r.counts, { Exit: 2, Trim: 1, Add: 1, Keep: 2 });
  assert.equal(trendOf({ price: 90, sma200: 100, sma200Ago: 110 }).state, "down");
  assert.equal(trendOf(null), null);
  assert.equal(trendOf({ price: 1, sma200: 100, sma200Ago: 90 }, 120).gapPct, 20, "today's price wins over the snapshot close");
});

test("clean-up review: tax if sold, wait for long-term, losses cancel booked short-term gains", () => {
  const row = { stGain: 30000, ltGain: 0, lots: [{ qty: 5, gain: 30000, long: false, daysToLong: 20, becomesLong: "2026-11-15" }] };
  const t = saleTax(row, { realised: {} });
  assert.equal(t.tax, 6000); assert.equal(t.wait.days, 20); assert.equal(t.wait.saves, Math.round(30000 * 0.075));
  const loss = saleTax({ stGain: -12000, ltGain: 0, lots: [{ qty: 5, gain: -12000, long: false, daysToLong: 200 }] }, { realised: { stGain: 50000, stLoss: 0 } });
  assert.deepEqual(loss.offset, { loss: 12000, against: 50000, saves: 2400 });
  const r = reviewHoldings({ holdings: [H("WAIT", { stance: { action: "Review", reasons: [] } }), H("LOSS", { pnl: -12000, stance: { action: "Review", reasons: [] } })], taxRows: new Map([["WAIT", row], ["LOSS", { stGain: -12000, ltGain: 0, lots: [{ qty: 5, gain: -12000, long: false, daysToLong: 200 }] }]]), realised: { stGain: 50000 } });
  const by = Object.fromEntries(r.rows.map(x => [x.symbol, x]));
  assert.ok(by.WAIT.waitFirst); assert.match(by.WAIT.reasons.map(x => x.text).join(" "), /Wait 20 days/);
  assert.match(by.LOSS.reasons.map(x => x.text).join(" "), /cancels short-term gains/);
  assert.equal(r.taxSavedByLosses, 2400);
});

test("trailing stop: ATR rule raises with the peak and never lowers; low20 rule; never above the price", () => {
  let p = { id: "p1", symbol: "ABC", name: "ABC", qty: 10, avgPrice: 100, stopLoss: 92, trail: sanitizeTrail({ on: true, rule: "atr", mult: 2 }) };
  assert.equal(p.trail.on, true); assert.ok(p.trail.since);
  let r = applyTrail(p, { snap: { atr: 3 }, price: 110 }); // 110 − 6 = 104
  assert.equal(r.position.stopLoss, 104); assert.equal(r.raised.from, 92); p = r.position;
  r = applyTrail(p, { snap: { atr: 3 }, price: 105 }); // peak stays 110: no change, and never lower
  assert.equal(r.raised, null); assert.equal(r.position.stopLoss, 104);
  r = applyTrail(r.position, { snap: { atr: 3 }, price: 120 }); assert.equal(r.position.stopLoss, 114); assert.equal(r.position.trail.history.length, 2);
  // the level would be above the price (stale bars): no raise
  const q = { ...r.position, trail: { ...r.position.trail, peak: 200 } };
  assert.equal(applyTrail(q, { snap: { atr: 3 }, price: 150 }).raised, null);
  // 20-day low
  const l = { stopLoss: null, trail: sanitizeTrail({ on: true, rule: "low20" }) };
  assert.equal(applyTrail(l, { snap: { low20: 97.33 }, price: 105 }).position.stopLoss, 97.3);
  assert.equal(trailLevel({ on: false }, { snap: { atr: 1 }, price: 10 }), null);
  const off = sanitizeTrail({ on: false }, p.trail); assert.equal(off.on, false); assert.equal(off.since, null);
  { const tc = trailChanges([r.position], "2000-01-01"); assert.equal(tc.length, 1); assert.equal(tc[0].from, 92); assert.equal(tc[0].to, 114); assert.equal(tc[0].raises, 2); }
  // the trail survives editing the position
  const edited = sanitizePosition({ symbol: "ABC", qty: 10, avgPrice: 100 }, r.position); assert.equal(edited.trail.on, true);
});

test("near-stop alert fires once and says it is a trailing stop", () => {
  const view = { positions: [{ kind: "position", id: "p1", symbol: "ABC", name: "ABC", status: "near-stop", price: 105, stopLoss: 104, note: "1% above", trail: { on: true } }], watch: [] };
  const a = diffSwingAlerts({}, view);
  assert.equal(a.fresh.length, 1); assert.equal(a.fresh[0].type, "swing-near-stop"); assert.match(a.fresh[0].detail, /trailing stop/);
  assert.equal(diffSwingAlerts(a.next, view).fresh.length, 0);
});

// a steady uptrend with regular volume spikes: plenty of 52-week-high breakouts
function bars(n = 1400, seed = 7) {
  let p = 100, s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647, out = [];
  for (let i = 0; i < n; i++) { const o = p; p *= 1 + 0.0008 + Math.sin(i / 90) * 0.002 + (rnd() - 0.5) * 0.03; out.push({ t: 1.5e9 + i * 86400, o, h: Math.max(o, p) * (1 + rnd() * 0.01), l: Math.min(o, p) * (1 - rnd() * 0.01), c: p, v: 1e5 * (0.6 + rnd() * 1.2) * (rnd() < 0.1 ? 2 : 1) }); }
  return out;
}
test("backtest: signals bought at the next open, exits by stop / target / time, one trade at a time, stats", () => {
  const b = bars(), r = backtestBars(b, { setup: "high52", exit: "t1", maxDays: 30 });
  assert.ok(r.trades.length >= 5, `found ${r.trades.length}`);
  for (const t of r.trades) { assert.ok(["stop", "target", "time", "open"].includes(t.why)); assert.ok(t.days >= 1 && t.days <= 31); assert.ok(t.exitDay >= t.entryDay); }
  for (let i = 1; i < r.trades.length; i++) assert.ok(r.trades[i].entryDay > r.trades[i - 1].exitDay, "no overlapping trades");
  const tr = r.trades.find(t => t.why === "target"); if (tr) assert.ok(Math.abs(tr.exit - Math.max(tr.target, 0)) < tr.target * 0.2);
  const s = summarize(r.trades.map(t => ({ ...t, symbol: "SYN" })));
  assert.equal(s.trades, r.trades.length); assert.ok(s.winRate >= 0 && s.winRate <= 100); assert.ok(Number.isInteger(s.worstStreak)); assert.ok(s.years.length >= 2);
  assert.equal(perStock([{ symbol: "SYN", trades: r.trades }])[0].trades, r.trades.length);
  assert.equal(summarize([]).trades, 0);
  const trail = backtestBars(b, { setup: "high52", exit: "trail" }); assert.ok(trail.trades.every(t => t.target === null));
  assert.deepEqual(sanitizeBacktest({ setup: "value", exit: "x", maxDays: 999 }), { setup: "high52", exit: "t1", maxDays: 30, costPct: 0.25 });
  // stop wins on a day that touches both
  const flat = Array.from({ length: 300 }, (_, i) => ({ t: 1.5e9 + i * 86400, o: 100, h: 100, l: 100, c: 100, v: 1 }));
  assert.equal(backtestBars(flat, { setup: "high52" }).trades.length, 0);
});

test("swing results by setup: ideas tag the setup, older trades are guessed, win / loss / days / profit factor", () => {
  assert.equal(setupFromIdea({ idea: { setup: "high52" } }), "high52"); assert.equal(setupFromIdea({ list: "dip" }), "dip"); assert.equal(setupFromIdea({}), null);
  assert.ok(SETUPS.high52 && SETUPS["order-win"]);
  assert.equal(guessSetup({ plan: { notes: "From swing idea: 52-week high breakout" } }), "high52");
  const closed = [
    { pnl: 1000, pnlPct: 10, setup: "high52", openedAt: "2026-01-01T00:00:00Z", closedAt: "2026-01-11T00:00:00Z" },
    { pnl: -500, pnlPct: -5, setup: "high52", openedAt: "2026-02-01T00:00:00Z", closedAt: "2026-02-05T00:00:00Z" },
    { pnl: 300, pnlPct: 3, plan: { notes: "From swing idea: Pullback in an uptrend" }, openedAt: "2026-03-01T00:00:00Z", closedAt: "2026-03-04T00:00:00Z" }
  ];
  const j = journalStats(closed), h = j.bySetup.find(x => x.key === "high52"), pb = j.bySetup.find(x => x.key === "pullback");
  assert.equal(h.trades, 2); assert.equal(h.winRate, 50); assert.equal(h.avgWinPct, 10); assert.equal(h.avgLossPct, -5); assert.equal(h.avgDays, 7); assert.equal(h.profitFactor, 2);
  assert.equal(pb.trades, 1, "guessed from the idea note");
});

test("morning brief: buy-zone hits, big moves, order wins, trailing stops; Telegram note carries them", () => {
  const extra = {
    zones: [{ symbol: "TCS", company: "TCS", price: 3000, zoneLow: 2900, zoneHigh: 3100, status: "In zone", held: true }, { symbol: "INFY", company: "Infosys", price: 1400, zoneLow: 1450, zoneHigh: 1550, status: "Below zone", held: false }],
    moves: [{ symbol: "HAL", company: "HAL", pct: -6.2 }], orders: [{ symbol: "BEL", name: "BEL", valueCr: 1250, text: "Order from the Army", held: true }], trails: [{ symbol: "ABC", name: "ABC", from: 92, to: 104 }]
  };
  const b = briefSections({ swing: { positions: [], watch: [] }, events: [], rules: 0, ...extra });
  assert.deepEqual(b.sections.map(s => s.key), ["trail", "zoneHeld", "zoneWatch", "moves", "orders"]);
  assert.match(b.sections[1].items[0].text, /in its buy zone ₹2,900–3,100/); assert.match(b.sections[2].items[0].text, /below its buy zone/);
  assert.match(b.sections[4].items[0].text, /₹1,250 Cr \(you hold it\)/);
  assert.equal(briefSections({}).quiet, true);
  const m = morningDigest({ day: "2026-10-26", swing: null, ...extra });
  assert.match(m, /Trailing stops raised/); assert.match(m, /HAL −6\.2%|HAL -6\.2%/); assert.match(m, /Order wins for your stocks/);
});

// ---- server: the new APIs answer from saved data, per user ----
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
test("server: clean-up review, morning brief, trailing stop and backtest APIs", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ew-541-")), port = await freePort();
  const child = spawn(process.execPath, ["server.mjs"], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, SETUP_CODE: "c541", AUTO_FUNDAMENTALS: "0", KITE_MCP_ENABLED: "0", EOD: "0", BACKUP: "0", ANGEL_PRICES: "0", BACKTEST_GAP_MS: "0",
    PRICE_SOURCES: "nse", NSE_BASE: "http://127.0.0.1:9", SCREENER_BASE: "http://127.0.0.1:9", YAHOO_BASE: "http://127.0.0.1:9" }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", d => log += d); child.stderr.on("data", d => log += d);
  const call = async (p, { cookie, body } = {}) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, { method: body ? "POST" : "GET", headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let json = null; try { json = JSON.parse(t); } catch { /* text */ } return { status: r.status, json, cookie: (r.headers.get("set-cookie") || "").split(";")[0] }; };
  try {
    for (let i = 0; i < 80 && !log.includes("running at"); i++) await new Promise(r => setTimeout(r, 100));
    const owner = (await call("/api/auth/setup", { body: { code: "c541", username: "owner", password: "owner-pass-phrase" } })).cookie;
    assert.equal((await call("/api/holdings/review")).status, 401, "needs a login");
    const rv = await call("/api/holdings/review", { cookie: owner }); assert.equal(rv.status, 200); assert.deepEqual(rv.json.rows, []);
    const br = await call("/api/brief", { cookie: owner }); assert.equal(br.status, 200); assert.equal(typeof br.json.quiet, "boolean");
    const pos = await call("/api/swing/position", { cookie: owner, body: { symbol: "ABC", name: "ABC", qty: 10, avgPrice: 100, stopLoss: 92 } }); assert.equal(pos.status, 200);
    const id = pos.json.positions[0].id;
    const tr = await call("/api/swing/trail", { cookie: owner, body: { id, on: true, rule: "atr", mult: 2.5 } });
    assert.equal(tr.status, 200, JSON.stringify(tr.json)); assert.match(tr.json.notice, /trailing stop on/); assert.equal(tr.json.positions[0].trail.mult, 2.5);
    const ed = await call("/api/swing/position", { cookie: owner, body: { id, symbol: "ABC", name: "ABC", qty: 10, avgPrice: 100, stopLoss: 92 } });
    assert.equal(ed.json.positions[0].trail.on, true, "editing keeps the trail");
    const bt = await call("/api/swing/backtest", { cookie: owner, body: { setup: "high52", exit: "t2", maxDays: 20 } }); assert.equal(bt.status, 200);
    let last = null; for (let i = 0; i < 50; i++) { const g = await call("/api/swing/backtest", { cookie: owner }); if (g.json.last) { last = g.json.last; break; } await new Promise(r => setTimeout(r, 100)); }
    assert.ok(last, "backtest finished"); assert.equal(last.params.exit, "t2"); assert.equal(last.params.maxDays, 20); assert.equal(last.stocks, 1); assert.equal(last.skipped[0].symbol, "ABC");
  } finally { child.kill("SIGTERM"); await new Promise(r => child.once("exit", r)); await fs.rm(dataDir, { recursive: true, force: true }); }
});
