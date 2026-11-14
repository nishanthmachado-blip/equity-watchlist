import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { marketRegime, openRisk, checkTrade, edgeReport, tradeStats, sanitizeDesk, DESK_DEFAULTS } from "../tradedesk.mjs";
import { snapshot, detectSetups } from "../swingideas.mjs";
import { backtestBars, backtestAll, compareSetups, afterTaxPer100k, indexUpDays, entryTags, BACKTEST_SETUPS } from "../backtest.mjs";

const line = (n, from, step) => Array.from({ length: n }, (_, i) => from * (1 + step) ** i);
const snapOf = (price, sma50, sma200, high52 = price * 1.2, low52 = price * 0.6) => ({ price, sma50, sma200, high52, low52 });

test("market regime: full size in a broad uptrend, half when mixed, defensive in a downtrend, unknown without data", () => {
  const up = marketRegime({ nifty: line(260, 100, 0.001), snaps: Array.from({ length: 30 }, (_, i) => snapOf(100, i < 24 ? 90 : 110, i < 26 ? 80 : 120, i < 10 ? 101 : 130)) });
  assert.equal(up.mode.key, "full"); assert.equal(up.mode.sizeFactor, 1); assert.equal(up.index.above200, true); assert.equal(up.index.rising200, true);
  assert.equal(up.breadth.above50, 80); assert.equal(up.breadth.above200, 87); assert.equal(up.breadth.nearHigh, 10); assert.equal(up.score, up.max); assert.equal(up.max, 8);
  // index up but only half the stocks above their averages
  const mixed = marketRegime({ nifty: line(260, 100, 0.001), snaps: Array.from({ length: 40 }, (_, i) => snapOf(100, i < 18 ? 90 : 110, i < 16 ? 80 : 120, 140, i < 12 ? 99 : 50)) });
  assert.equal(mixed.mode.key, "half"); assert.equal(mixed.mode.sizeFactor, 0.5); assert.equal(mixed.checks.find(c => /50-day/.test(c.label) && /Most/.test(c.label)).half, true);
  const down = marketRegime({ nifty: line(260, 100, -0.001), snaps: Array.from({ length: 30 }, () => snapOf(100, 120, 130, 160, 98)) });
  assert.equal(down.mode.key, "defensive"); assert.equal(down.mode.sizeFactor, 0.25); assert.equal(down.score, 0);
  const none = marketRegime({ nifty: line(50, 100, 0.001), snaps: [snapOf(1, 1, 1)] });
  assert.equal(none.mode.key, "unknown"); assert.equal(none.index, null); assert.equal(none.breadth, null); assert.equal(none.mode.sizeFactor, 1);
});

test("desk settings: amounts like 15L, limits kept in range", () => {
  const s = sanitizeDesk({ capital: "15L", riskPct: "0.5%", maxHeatPct: 5, target: "1.5L", useRegime: false });
  assert.equal(s.capital, 1500000); assert.equal(s.riskPct, 0.5); assert.equal(s.maxHeatPct, 5); assert.equal(s.target, 150000); assert.equal(s.useRegime, false); assert.equal(s.maxPosPct, DESK_DEFAULTS.maxPosPct);
  assert.equal(sanitizeDesk({ capital: "" }, s).capital, null);
  assert.throws(() => sanitizeDesk({ riskPct: 9 }), /Risk per trade/); assert.throws(() => sanitizeDesk({ capital: "lots" }), /Swing capital/); assert.throws(() => sanitizeDesk({ maxHeatPct: 0 }), /open risk/);
});

const POS = [{ symbol: "AAA", qty: 100, avg: 100, price: 110, stop: 104 }, { symbol: "BBB", qty: 50, avg: 400, price: 380, stop: null }, { symbol: "CCC", qty: 10, avg: 1000, price: 950, stop: 960 }, { symbol: "DDD", qty: 200, avg: 500, price: 520, stop: 500 }];
test("open risk: stops, positions without one, heat against the limit, concentration", () => {
  const sectorOf = s => ({ AAA: "IT", DDD: "IT", BBB: "Banks" }[s] || null);
  const r = openRisk({ positions: POS, settings: { capital: 1000000 }, sectorOf });
  const by = Object.fromEntries(r.rows.map(x => [x.symbol, x]));
  assert.equal(by.AAA.risk, 600); assert.equal(by.AAA.locked, true); assert.equal(by.AAA.stopPct, 5.5);
  assert.equal(by.BBB.stopState, "none"); assert.equal(by.BBB.risk, 1900, "10% of ₹19,000 assumed");
  assert.equal(by.CCC.stopState, "hit"); assert.equal(by.CCC.risk, 0);
  assert.equal(by.DDD.risk, 4000); assert.equal(by.DDD.riskPct, 0.4);
  assert.equal(r.totals.risk, 6500); assert.equal(r.totals.heatPct, 0.7); assert.equal(r.totals.heatRoom, 53500); assert.equal(r.totals.noStop, 1); assert.equal(r.capital, 1000000);
  assert.deepEqual(r.sectors.map(s => [s.sector, s.value]), [["IT", 115000], ["Banks", 19000], ["Unknown", 9500]]);
  assert.ok(r.warnings.some(w => /CCC: the price is at or below your stop-loss/.test(w.text))); assert.ok(r.warnings.some(w => /1 position has no stop-loss \(BBB\)/.test(w.text)));
  // a small account: the same positions break the heat, position and sector limits
  const small = openRisk({ positions: POS, settings: { capital: 150000, maxHeatPct: 3 }, sectorOf });
  assert.equal(small.totals.heatPct, 4.3); assert.ok(small.warnings.some(w => /Open risk is 4.3%.*above your 3% limit/.test(w.text)));
  assert.ok(small.warnings.some(w => /DDD is 69.3% of your swing capital/.test(w.text))); assert.ok(small.warnings.some(w => /IT: 76.7%.*one sector/.test(w.text))); assert.ok(small.warnings.some(w => /DDD: ₹4,000 at risk \(2.7% of capital\)/.test(w.text)));
  // no capital set: positions plus swing cash
  const auto = openRisk({ positions: POS, cash: 56500 }); assert.equal(auto.capital, 143500 + 56500); assert.equal(auto.capitalSet, false);
  assert.equal(openRisk({}).totals.positions, 0);
});

test("size check: 1% risk, cut by the market, the heat limit, position and sector caps; reward against risk", () => {
  const risk = openRisk({ positions: POS, settings: { capital: 1000000 }, sectorOf: s => (s === "AAA" ? "IT" : null) }), S = { capital: 1000000 };
  const full = { mode: { key: "full", label: "Market is helping: full size", sizeFactor: 1 } }, half = { mode: { key: "half", label: "Mixed market: half size", sizeFactor: 0.5 } };
  const a = checkTrade({ symbol: "nse:zzz", entry: "500", stop: "480", target: "560" }, { settings: S, risk, regime: full });
  assert.equal(a.symbol, "ZZZ"); assert.equal(a.qty, 500, "₹10,000 risk ÷ ₹20 a share"); assert.equal(a.amount, 250000); assert.equal(a.riskAmount, 10000); assert.equal(a.riskPct, 1); assert.equal(a.rr, 3); assert.equal(a.reward, 30000);
  assert.equal(a.limitedBy, "risk"); assert.equal(a.verdict, "ok"); assert.match(a.summary, /Buy up to 500 shares \(₹2,50,000\).*lose ₹10,000, 1% of your swing capital/);
  const b = checkTrade({ entry: 500, stop: 480, target: 560 }, { settings: S, risk, regime: half });
  assert.equal(b.qty, 250); assert.equal(b.regimeFactor, 0.5); assert.equal(b.verdict, "careful"); assert.ok(b.checks.some(c => c.label === "Market" && !c.ok));
  assert.equal(checkTrade({ entry: 500, stop: 480, target: 560 }, { settings: { ...S, useRegime: false }, risk, regime: half }).qty, 500, "the regime cut can be switched off");
  // position cap: 25% of ₹10 L = ₹2.5 L → a tight stop cannot buy more than that
  const c = checkTrade({ entry: 1000, stop: 990, target: 1050 }, { settings: S, risk, regime: full });
  assert.equal(c.qty, 250); assert.equal(c.limitedBy, "position"); assert.equal(c.qtyByRisk, 1000); assert.ok(c.checks.some(x => x.label === "Stop distance" && x.ok)); assert.equal(c.verdict, "careful");
  // heat: ₹6,500 already at risk of a ₹8,000 limit → ₹1,500 left
  const d = checkTrade({ entry: 500, stop: 480, target: 560 }, { settings: { ...S, maxHeatPct: 0.8 }, risk: openRisk({ positions: POS, settings: { capital: 1000000, maxHeatPct: 0.8 } }), regime: full });
  assert.equal(d.qty, 75); assert.equal(d.limitedBy, "heat");
  const none = checkTrade({ entry: 500, stop: 480, target: 560 }, { settings: { ...S, maxHeatPct: 0.5 }, risk: openRisk({ positions: POS, settings: { capital: 1000000, maxHeatPct: 0.5 } }), regime: full });
  assert.equal(none.qty, 0); assert.equal(none.verdict, "skip"); assert.match(none.summary, /No room/);
  // sector cap and adding to a stock already held
  const e = checkTrade({ symbol: "AAA", entry: 110, stop: 105, target: 125 }, { settings: { ...S, maxSectorPct: 5 }, risk, regime: full, sector: "IT" });
  assert.equal(e.limitedBy, "sector"); assert.equal(e.qty, Math.floor((50000 - 11000) / 110)); assert.ok(e.checks.some(x => x.label === "Already held"));
  // poor reward, wide stop, downtrend, event
  const f = checkTrade({ symbol: "QQQ", entry: 100, stop: 85, target: 110 }, { settings: S, risk, regime: full, snap: { atr: 3, sma200: 120 }, eventSoon: "Results in 2 days" });
  assert.equal(f.verdict, "skip"); assert.equal(f.rr, 0.67); assert.ok(f.checks.find(x => x.label === "Stop distance" && !x.ok)); assert.ok(f.checks.find(x => x.label === "Long-term trend" && !x.ok)); assert.ok(f.checks.find(x => x.label === "Event ahead"));
  assert.throws(() => checkTrade({ entry: 100, stop: 100 }, { settings: S, risk }), /below the buy price/); assert.throws(() => checkTrade({ entry: 100 }, { settings: S, risk }), /stop-loss/); assert.throws(() => checkTrade({ entry: 100, stop: 90, target: 95 }, { settings: S, risk }), /target must be above/);
  assert.throws(() => checkTrade({ entry: 100, stop: 90 }, { settings: {}, risk: openRisk({}) }), /swing capital/);
});

const T = (symbol, sellDay, days, invested, gain, extra = {}) => ({ k: `${symbol}|${sellDay}`, symbol, sellDay, buyDay: sellDay ? "2026-01-01" : null, days, intraday: days === 0, invested, gain, pct: invested ? Math.round(gain / invested * 10000) / 100 : null, ...extra });
test("edge report: expectancy, break-even win rate, where the money came from, and what the monthly target needs", () => {
  const closed = [T("AAA", "2026-06-10", 3, 50000, 4000), T("AAA", "2026-07-10", 4, 50000, 6000), T("BBB", "2026-07-20", 30, 150000, -9000), T("BBB", "2026-08-05", 40, 150000, -3000), T("CCC", "2026-08-20", 10, 20000, 2000),
    T("DDD", "2026-09-01", 0, 20000, -500), T("EEE", "2026-09-15", 70, 250000, 20000), T("FFF", "2026-10-01", 12, 20000, 1500), T("GGG", null, null, 60000, 5000, { noDates: true })];
  const e = edgeReport(closed, { today: "2026-11-01", target: 100000 });
  assert.equal(e.trades, 9); assert.equal(e.dated, 8); assert.deepEqual(e.undated, { trades: 1, gain: 5000 });
  const o = e.overall; assert.equal(o.wins, 6); assert.equal(o.winRate, 67); assert.equal(o.total, 26000); assert.equal(o.avgWin, 6417); assert.equal(o.avgLoss, 4167); assert.equal(o.payoff, 1.54); assert.equal(o.expectancy, 2889); assert.equal(o.breakEvenWinRate, 39); assert.equal(o.profitFactor, 3.08);
  assert.deepEqual(e.byHold.map(g => [g.label, g.trades, g.expectancy]), [["Intraday (same day)", 1, -500], ["1–5 days", 2, 5000], ["6–20 days", 2, 1750], ["21–60 days", 2, -6000], ["Over 60 days", 1, 20000]]);
  assert.deepEqual(e.bySize.map(g => [g.label, g.trades]), [["Under ₹25,000", 3], ["₹25,000 – ₹1 L", 3], ["₹1 L – ₹2 L", 2], ["Over ₹2 L", 1]]);
  assert.equal(e.best[0].symbol, "EEE"); assert.deepEqual(e.worst.map(s => [s.symbol, s.total, s.trades]), [["BBB", -12000, 2], ["DDD", -500, 1]]);
  // the last 12 months: ₹21,000 from 8 dated trades over 5 months
  assert.equal(e.plan.months, 5); assert.equal(e.plan.perMonth, 4200); assert.equal(e.plan.tradesPerMonth, 1.6); assert.equal(e.plan.preTax, 126263); assert.equal(e.plan.expectancy, 2625); assert.equal(e.plan.tradesNeeded, 49); assert.equal(e.plan.sizeMultiple, 30.1);
  assert.match(e.findings[0].text, /Only 9 closed trades/); assert.match(e.findings[1].text, /You win 67% of trades.*only need 39% wins/); assert.equal(e.findings[1].tone, "ok");
  assert.ok(!e.findings.some(f => /Holding period/.test(f.text)), "a bucket needs 3 trades before it is compared");
  const hp = edgeReport([T("A", "2026-09-01", 3, 5e4, 4000), T("B", "2026-09-02", 4, 5e4, 6000), T("C", "2026-09-03", 2, 5e4, 5000), T("D", "2026-09-04", 30, 5e4, -9000), T("E", "2026-09-05", 40, 5e4, -3000), T("F", "2026-09-06", 50, 5e4, -6000)], { today: "2026-11-01" });
  assert.ok(hp.findings.some(f => /Holding period: "1–5 days" trades made ₹5,000 each \(100% won\); "21–60 days" lost ₹6,000 each/.test(f.text)));
  // losing system: the finding says so, and no number of trades reaches the target
  const bad = edgeReport([T("A", "2026-09-01", 5, 1e5, 2000), T("B", "2026-09-02", 5, 1e5, -9000), T("C", "2026-09-03", 5, 1e5, -8000), T("D", "2026-09-04", 5, 1e5, 1000), T("E", "2026-09-05", 5, 1e5, -7000), T("G", "2026-09-06", 5, 1e5, -500)], { today: "2026-11-01" });
  assert.equal(bad.findings[1].tone, "bad"); assert.match(bad.findings[1].text, /need \d+% wins just to break even/); assert.equal(bad.plan.tradesNeeded, null); assert.ok(bad.findings.some(f => /3 biggest losses \(B ₹9,000, C ₹8,000, E ₹7,000\) are 98% of all your losses/.test(f.text)));
  // tags from the setup check
  const tags = Object.fromEntries(closed.filter(c => c.sellDay).map((c, i) => [c.k, { setup: i < 3 ? "cup" : null, setupLabel: i < 3 ? "Cup and handle" : null, trendUp: i % 2 === 0, niftyUp: i < 6 }]));
  const g = edgeReport(closed, { today: "2026-11-01", tags });
  assert.equal(g.tagged, 8); assert.deepEqual(g.bySetup.map(x => [x.label, x.trades]), [["Cup and handle", 3], ["No scanner setup at entry", 5]]); assert.deepEqual(g.byTrend.map(x => x.trades), [4, 4]); assert.deepEqual(g.byMarket.map(x => x.trades), [6, 2]);
  assert.ok(g.findings.some(f => /Trend at entry: 4 trades bought above the 200-day average/.test(f.text)));
  const empty = edgeReport([]); assert.equal(empty.trades, 0); assert.match(empty.note, /Import/); assert.equal(tradeStats([]).trades, 0);
});

// a long slide, then a steady climb with pullbacks: the 50-day average crosses above the 200-day
function crossBars(n = 520) { let p = 100; const out = []; for (let i = 0; i < n; i++) { const o = p; p *= i < 300 ? 0.9992 : i % 3 === 2 ? 0.994 : 1.009; out.push({ t: 1.6e9 + i * 86400, o, h: Math.max(o, p) * 1.003, l: Math.min(o, p) * 0.997, c: p, v: 1e5 }); } return out; }
test("golden cross: found within days of the 50-DMA moving above the 200-DMA, and offered as a setup", () => {
  const b = crossBars(); let first = null, idea = null;
  for (let i = 320; i < b.length; i++) { const s = snapshot(b.slice(0, i + 1)); if (first === null && s.goldenDays === 0) first = i; if (first !== null && !idea) idea = detectSetups(s).find(x => x.setup === "golden") || null; if (first !== null && i > first + 16) { assert.equal(s.goldenDays, undefined, "only the first 15 days after the cross"); break; } }
  assert.ok(first > 320, "a cross happens during the climb"); assert.ok(idea, "golden setup offered"); assert.ok(idea.stop < idea.entry && idea.rr >= 1.5); assert.match(idea.why[0], /Golden cross/);
  assert.equal(snapshot(b.slice(0, 300)).goldenDays, undefined, "no cross during the slide"); assert.ok(BACKTEST_SETUPS.golden);
});

function bars(n = 1400, seed = 7) { let p = 100, s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647, out = []; for (let i = 0; i < n; i++) { const o = p; p *= 1 + 0.0008 + Math.sin(i / 90) * 0.002 + (rnd() - 0.5) * 0.03; out.push({ t: 1.5e9 + i * 86400, o, h: Math.max(o, p) * (1 + rnd() * 0.01), l: Math.min(o, p) * (1 - rnd() * 0.01), c: p, v: 1e5 * (0.6 + rnd() * 1.2) * (rnd() < 0.1 ? 2 : 1) }); } return out; }
test("all setups in one pass give the same trades as one setup at a time; comparison rows, tax, market split, entry tags", () => {
  const b = bars(), all = backtestAll(b, { exit: "t1", maxDays: 30 });
  assert.deepEqual(Object.keys(all), Object.keys(BACKTEST_SETUPS));
  for (const k of ["high52", "pullback", "breakout", "bounce", "golden"]) assert.deepEqual(all[k].trades, backtestBars(b, { setup: k, exit: "t1", maxDays: 30 }).trades, k);
  assert.ok(all.high52.trades.length >= 5);
  const up = indexUpDays(b); assert.ok(up.size === b.length - 199); assert.equal(typeof up.get(all.high52.trades[0].entryDay), "boolean");
  const rows = compareSetups(Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.trades.map(t => ({ ...t, symbol: "SYN" }))])), { upDays: up });
  assert.equal(rows.length, 7); for (let i = 1; i < rows.length; i++) assert.ok((rows[i - 1].avgPct ?? -99) >= (rows[i].avgPct ?? -99), "best first");
  const h = rows.find(r => r.setup === "high52"); assert.equal(h.trades, all.high52.trades.length); assert.equal(h.marketUp.trades + h.marketDown.trades, h.trades); assert.ok(["good", "thin", "bad", "few"].includes(h.verdict));
  assert.equal(h.afterTaxPer100k, afterTaxPer100k(all.high52.trades)); assert.ok(h.per100k <= 0 || h.afterTaxPer100k < h.per100k, "tax takes some of the profit");
  assert.equal(rows.find(r => !r.trades)?.verdict ?? "none", "none");
  // tax: a profitable financial year pays 20.8%, a losing one pays nothing
  assert.equal(afterTaxPer100k([{ exitDay: "2025-05-01", pct: 10 }, { exitDay: "2026-03-31", pct: 5 }, { exitDay: "2026-04-01", pct: -4 }]), Math.round(15000 * 0.792 - 4000));
  // momentum needs the index: with it the setup can fire
  const flat = b.map(x => ({ ...x, o: 100, h: 100, l: 100, c: 100 }));
  assert.ok(backtestAll(b, {}, flat).momentum.signals >= backtestAll(b, {}).momentum.signals);
  // what was on when you bought: the day after a 52-week-high signal is tagged with it
  const t0 = all.high52.trades[0], tags = entryTags([{ k: "x", buyDay: t0.entryDay }, { k: "early", buyDay: "2017-08-01" }, { k: "nodate", buyDay: null }], b, up);
  assert.equal(tags.x.setupLabel !== null, true); assert.equal(typeof tags.x.trendUp, "boolean"); assert.equal(typeof tags.x.niftyUp, "boolean"); assert.equal(tags.early, undefined); assert.equal(tags.nodate, undefined);
});

const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
test("server: the Trade desk answers from saved data, keeps limits per login, sizes a trade and runs the setup test", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ew-576-")), port = await freePort(), dead = "http://127.0.0.1:9";
  const child = spawn(process.execPath, ["server.mjs"], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, SETUP_CODE: "c576", AUTO_FUNDAMENTALS: "0", KITE_MCP_ENABLED: "0", EOD: "0", BACKUP: "0", ANGEL_PRICES: "0", BACKTEST_GAP_MS: "0", PRICE_SOURCES: "nse", NSE_BASE: dead, SCREENER_BASE: dead, YAHOO_BASE: dead, YAHOO_CHART_BASE: dead, STOOQ_BASE: dead }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", d => log += d); child.stderr.on("data", d => log += d);
  const call = async (p, { cookie, body } = {}) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, { method: body ? "POST" : "GET", headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let json = null; try { json = JSON.parse(t); } catch { /* text */ } return { status: r.status, json, cookie: (r.headers.get("set-cookie") || "").split(";")[0] }; };
  try {
    for (let i = 0; i < 100 && !log.includes("running at"); i++) await new Promise(r => setTimeout(r, 100));
    const me = (await call("/api/auth/setup", { body: { code: "c576", username: "owner", password: "owner-pass-phrase" } })).cookie;
    assert.equal((await call("/api/desk")).status, 401);
    const d0 = await call("/api/desk", { cookie: me }); assert.equal(d0.status, 200, JSON.stringify(d0.json));
    assert.equal(d0.json.regime.mode.key, "unknown"); assert.equal(d0.json.edge.trades, 0); assert.equal(d0.json.risk.totals.positions, 0); assert.equal(d0.json.settings.riskPct, 1); assert.equal(d0.json.compare.last, null);
    assert.equal((await call("/api/desk/check", { cookie: me, body: { entry: 100, stop: 95 } })).status, 400, "no capital yet");
    assert.equal((await call("/api/desk/settings", { cookie: me, body: { riskPct: 50 } })).status, 400);
    const s = await call("/api/desk/settings", { cookie: me, body: { capital: "10L", riskPct: "1", maxHeatPct: "6", maxPosPct: "25", maxSectorPct: "35", noStopPct: "10", target: "1L", useRegime: true } });
    assert.equal(s.status, 200, JSON.stringify(s.json)); assert.equal(s.json.settings.capital, 1000000); assert.equal(s.json.risk.capital, 1000000);
    await call("/api/swing/position", { cookie: me, body: { symbol: "ABC", name: "ABC Ltd", qty: 100, avgPrice: 500, stopLoss: 470 } });
    await call("/api/swing/position", { cookie: me, body: { symbol: "XYZ", name: "XYZ Ltd", qty: 10, avgPrice: 2000 } });
    const d1 = (await call("/api/desk", { cookie: me })).json;
    assert.equal(d1.risk.source, "journal"); assert.deepEqual(d1.risk.rows.map(r => [r.symbol, r.stopState, r.risk]), [["ABC", "set", 3000], ["XYZ", "none", 2000]]); assert.equal(d1.risk.totals.heatPct, 0.5); assert.ok(d1.risk.warnings.some(w => /XYZ/.test(w.text)));
    const c = await call("/api/desk/check", { cookie: me, body: { symbol: "NEW", entry: "250", stop: "240", target: "280" } });
    assert.equal(c.status, 200, JSON.stringify(c.json)); assert.equal(c.json.qty, 1000); assert.equal(c.json.riskAmount, 10000); assert.equal(c.json.limitedBy, "risk"); assert.equal(c.json.rr, 3); assert.equal(c.json.hasChart, false);
    assert.equal((await call("/api/desk/check", { cookie: me, body: { entry: 250, stop: 260 } })).status, 400);
    const run = await call("/api/desk/compare", { cookie: me, body: { exit: "trail", maxDays: 45 } }); assert.equal(run.status, 200); assert.equal(run.json.compare.job.params.exit, "trail");
    let last = null; for (let i = 0; i < 80; i++) { const g = await call("/api/desk", { cookie: me }); if (g.json.compare.last && !g.json.compare.job.running) { last = g.json.compare.last; break; } await new Promise(r => setTimeout(r, 100)); }
    assert.ok(last, "the setup test finished"); assert.equal(last.params.maxDays, 45); assert.equal(last.rows.length, 7); assert.equal(last.tested, 0); assert.deepEqual(last.skipped.map(x => x.symbol).sort(), ["ABC", "XYZ"]); assert.equal(last.tags, undefined);
    // another login has its own limits
    await call("/api/auth/users", { cookie: me, body: { username: "friend", password: "friend-pass-phrase", name: "F" } });
    const fr = (await call("/api/auth/login", { body: { username: "friend", password: "friend-pass-phrase" } })).cookie;
    const d2 = (await call("/api/desk", { cookie: fr })).json; assert.equal(d2.settings.capital, null); assert.equal(d2.risk.totals.positions, 0); assert.equal(d2.compare.last, null);
  } finally { child.kill("SIGTERM"); await new Promise(r => child.once("exit", r)); await fs.rm(dataDir, { recursive: true, force: true }); }
});
