import test from "node:test";
import assert from "node:assert/strict";
import { classify, growthScore } from "../classify.mjs";
import { computeDividends, parseYahooDividends } from "../dividends.mjs";
import { computeTechnicals, rsi14, parseYahooBars } from "../technicals.mjs";
import { peerCompare } from "../peers.mjs";
import { diffAlerts, mergeEvents } from "../alerts.mjs";
import { allocate } from "../allocate.mjs";
import { portfolioHealth } from "../health.mjs";

const strong = { view: "Fair", status: "In zone", ratio: 0.95, salesCagr3: 20, profitCagr3: 25, roce: 24, borrowings: 10, reserves: 100, cfoToProfit3: 0.9, fcfNegative: 0, promoter: 55, promoterChange3y: 0 };

test("classify: growth + value buy, floored zone is not a buy, rich is expensive", () => {
  assert.equal(classify(strong).label, "Growth + Value buy");
  assert.equal(classify({ ...strong, floored: true }).key, "wait");
  assert.equal(classify({ view: "Very rich", status: "Wait (far above)", ratio: 2 }).key, "expensive");
  assert.equal(classify({ view: "No fundamentals" }).key, "none");
  assert.equal(growthScore({ ...strong, borrowings: 500 }), null); // levered
});
test("classify: dividend tag needs Safe and yield >= 2", () => {
  assert.ok(classify({ ...strong, dividend: { safety: "Safe", yield: 3 } }).tags.includes("Dividend"));
  assert.ok(!classify({ ...strong, dividend: { safety: "Safe", yield: 1 } }).tags.includes("Dividend"));
  assert.ok(!classify({ ...strong, dividend: { safety: "At risk", yield: 5 } }).tags.includes("Dividend"));
});

const NOW = new Date("2026-10-08T00:00:00Z");
const ev = (y, a, m = "06") => ({ d: `${y}-${m}-15`, a });
test("dividends: safe payer with growth", () => {
  const events = [2020, 2021, 2022, 2023, 2024, 2025].map((y, i) => ev(y, 10 + i * 2)).concat([ev(2026, 22)]);
  const d = computeDividends(events, { price: 1000, pe: 20, profitCagr3: 12, now: NOW });
  assert.equal(d.safety, "Safe"); assert.equal(d.ttm, 22); assert.equal(d.yield, 2.2); assert.equal(d.payout, 44); assert.ok(d.cagr5 > 10);
});
test("dividends: cut, high payout and none", () => {
  assert.equal(computeDividends([ev(2023, 20), ev(2024, 10), ev(2025, 10), ev(2026, 10)], { price: 500, pe: 20, now: NOW }).safety, "At risk");
  assert.equal(computeDividends([ev(2024, 10), ev(2025, 10), ev(2026, 30)], { price: 500, pe: 30, now: NOW }).safety, "At risk"); // payout 180%
  assert.equal(computeDividends([], { price: 100, now: NOW }).safety, "None");
  assert.equal(computeDividends([ev(2025, 5)], { price: 100, pe: 20, now: NOW }).safety, "None"); // nothing in last 12 months (Oct 2025 -> Oct 2026 window starts after Jun 2025)
});
test("dividends: parses Yahoo payload", () => {
  const out = parseYahooDividends({ chart: { result: [{ events: { dividends: { 1: { date: 1717200000, amount: 5 }, 2: { date: 1685577600, amount: 4 } } } }] } });
  assert.deepEqual(out.map(e => e.a), [4, 5]);
});

const bars = (n, f) => Array.from({ length: n }, (_, i) => { const c = f(i); return { c, h: c * 1.01, l: c * 0.99, v: 1000 }; });
test("technicals: steady uptrend is a swing setup; downtrend is weak; RSI bounds", () => {
  const up = computeTechnicals(bars(260, i => 100 + i));
  assert.equal(up.goldenCross, true); assert.ok(up.rsi > 50); assert.ok(["Swing setup", "Breakout"].includes(up.setup));
  const down = computeTechnicals(bars(260, i => 400 - i));
  assert.equal(down.setup, "Weak trend"); assert.ok(down.rsi < 50);
  assert.equal(rsi14(Array.from({ length: 30 }, (_, i) => i + 1)), 100);
  assert.equal(computeTechnicals(bars(10, i => i)).setup, "No data");
});
test("technicals: volume breakout detected", () => {
  const b = bars(260, i => 100 + (i % 5)); b.push({ c: 140, h: 141, l: 120, v: 5000 });
  const t = computeTechnicals(b); assert.equal(t.breakout20, true);
  assert.equal(parseYahooBars({ chart: { result: [{ timestamp: [1, 2], indicators: { quote: [{ close: [1, null], high: [1, 1], low: [1, 1], volume: [1, 1] }] } }] } }).length, 1);
});

const row = (symbol, o = {}) => ({ symbol, company: symbol, sector: "Tech", ratio: 1, pe: 20, roce: 20, salesCagr3: 15, profitCagr3: 15, price: 100, ...o });
test("peers: needs 2+ peers, ranks cheaper stock", () => {
  assert.equal(peerCompare("A", [row("A"), row("B")]).available, false);
  const out = peerCompare("A", [row("A", { ratio: 0.6, pe: 12 }), row("B", { ratio: 1.2, pe: 28 }), row("C", { ratio: 1.1, pe: 25 }), row("D", { ratio: 1.0, pe: 22, sector: "Other" })]);
  assert.equal(out.available, true); assert.equal(out.count, 2); assert.equal(out.verdict, "Cheaper than most peers"); assert.equal(out.rank.cheaperPE, 2);
});

test("alerts: first run seeds, then buy-zone entry and verdict change fire once", () => {
  const mk = (key, label, inZone) => [{ symbol: "X", company: "X Ltd", price: 90, zoneLow: 80, zoneHigh: 95, verdict: { key, label, inZone } }];
  const first = diffAlerts({}, mk("wait", "Value: near its zone, watch", false));
  assert.equal(first.fresh.length, 0);
  const second = diffAlerts(first.nextState, mk("buy", "Value buy", true));
  assert.deepEqual(second.fresh.map(e => e.type).sort(), ["buy-zone", "verdict"]);
  const events = mergeEvents([], second.fresh);
  const third = diffAlerts(first.nextState, mk("buy", "Value buy", true), { events }); // same transition again within 24h
  assert.equal(third.fresh.length, 0);
  assert.equal(diffAlerts(first.nextState, [{ symbol: "X", company: "X", verdict: { key: "none", label: "n", inZone: false } }]).fresh.length, 0);
});

const buyRow = (symbol, o = {}) => ({ symbol, company: symbol, sector: o.sector || "Tech", price: 100, upsideToBase: 0.2, ratio: 0.9, verdict: { key: "buy", label: "Value buy", tags: ["Value"], growthScore: 60 }, ...o });
test("allocate: respects per-stock cap, rounds to shares, reports leftover", () => {
  const out = allocate({ amount: 100000, rows: [buyRow("A"), buyRow("B"), buyRow("C", { sector: "Bank" })], held: { Z: 100000 }, maxPerStockPct: 15, maxPerSectorPct: 100 });
  const total = 200000;
  for (const a of out.allocations) { assert.ok(a.weightAfter <= 15.01, `${a.symbol} ${a.weightAfter}`); assert.equal(a.amount % 100, 0); }
  assert.ok(out.allocations.reduce((s, a) => s + a.amount, 0) <= 100000);
  assert.ok(out.leftover > 0); assert.ok(out.notes.length);
});
test("allocate: no candidates holds cash; bad amount throws; sector cap binds", () => {
  assert.equal(allocate({ amount: 5000, rows: [{ symbol: "A", price: 10, verdict: { key: "wait", tags: [] } }] }).candidates, 0);
  assert.throws(() => allocate({ amount: 0, rows: [] }));
  const out = allocate({ amount: 100000, rows: [buyRow("A"), buyRow("B")], maxPerStockPct: 100, maxPerSectorPct: 30 });
  assert.ok(out.allocations.reduce((s, a) => s + a.amount, 0) <= 30000);
});

test("health: flags concentration and expensive share", () => {
  const holdings = [{ symbol: "A", value: 70000 }, { symbol: "B", value: 20000 }, { symbol: "C", value: 10000 }];
  const rows = { A: { sector: "Tech", cap: "Large", verdict: { key: "expensive", tags: [] } }, B: { sector: "Tech", cap: "Small", verdict: { key: "buy", tags: ["Value", "Dividend"] } }, C: { sector: "Bank", cap: "Mid", verdict: { key: "none", tags: [] } } };
  const h = portfolioHealth(holdings, rows);
  assert.equal(h.total, 100000); assert.equal(h.bySector[0].pct, 90); assert.equal(h.tilt.value, 20); assert.equal(h.tilt.dividend, 20);
  assert.ok(h.flags.some(f => /A is 70%/.test(f.text))); assert.ok(h.flags.some(f => /expensive/.test(f.text)));
  assert.equal(portfolioHealth([], {}).empty, true);
});

import { ensureLists, createList, renameList, deleteList, setMembers, prune } from "../lists.mjs";
test("lists: default seeded from pool, create/rename/members/delete rules, prune", () => {
  let st = ensureLists({}, ["TCS", "itc"]);
  assert.equal(st.lists[0].id, "default"); assert.deepEqual(st.lists[0].symbols, ["TCS", "ITC"]);
  assert.deepEqual(ensureLists(st, ["ZZZ"]).lists[0].symbols, ["TCS", "ITC"]); // existing default is never re-seeded
  const r = createList(st, { name: "  Dividend   picks ", symbols: ["itc", "bad sym!", "ITC"] });
  st = r.store; assert.equal(r.list.name, "Dividend picks"); assert.deepEqual(r.list.symbols, ["ITC"]);
  assert.throws(() => createList(st, { name: "dividend picks" }), /already/); assert.throws(() => createList(st, { name: "  " }), /name/);
  st = setMembers(st, r.list.id, { add: ["tcs", "infy"], remove: ["itc"] }); assert.deepEqual(st.lists[1].symbols, ["TCS", "INFY"]);
  st = renameList(st, r.list.id, "Income"); assert.equal(st.lists[1].name, "Income");
  assert.throws(() => renameList(st, r.list.id, "my watchlist"), /already/);
  assert.throws(() => deleteList(st, "default"), /cannot be deleted/);
  assert.deepEqual(prune(st, ["TCS"]).lists[1].symbols, ["TCS"]);
  assert.equal(deleteList(st, r.list.id).lists.length, 1);
});

import { parsePeersPe, parseWarehouseId } from "../screener.mjs";
test("screener peers: median P/E from peer table, skips median row", () => {
  const html = `<table><tr><th>S.No.</th><th>Name</th><th>CMP Rs.</th><th>P/E</th><th>Mar Cap Rs.Cr.</th></tr>
    <tr><td>1.</td><td><a>A</a></td><td>100</td><td>20.5</td><td>1000</td></tr>
    <tr><td>2.</td><td>B</td><td>50</td><td>30</td><td>900</td></tr>
    <tr><td>3.</td><td>C</td><td>10</td><td>-4</td><td>800</td></tr>
    <tr><td>4.</td><td>D</td><td>10</td><td>40</td><td>700</td></tr>
    <tr><td></td><td>Median: 4 Co.</td><td>30</td><td>25.25</td><td>850</td></tr></table>`;
  assert.deepEqual(parsePeersPe(html), { sectorPe: 30, count: 3 });
  assert.equal(parsePeersPe("<table><tr><th>Name</th></tr></table>"), null);
  assert.equal(parseWarehouseId('<div id="company-info" data-company-id="1" data-warehouse-id="6596449">'), "6596449");
});

import { mergeSuggestions } from "../search.mjs";
test("search: tracked first with numbers, NSE preferred over BSE duplicate, BSE-only kept", () => {
  const rows = [{ symbol: "TITAN", company: "Titan Company", price: 3400, pe: 80, view: "Very rich", verdict: { label: "Expensive", cls: "v-rich" } }, { symbol: "TATAMOTORS", company: "Tata Motors", pe: 9 }];
  const yahoo = [
    { symbol: "TITAN.BO", longname: "Titan Company Limited", quoteType: "EQUITY" },
    { symbol: "TITANBIO.NS", longname: "Titan Biotech Limited", quoteType: "EQUITY" },
    { symbol: "TITANBIO.BO", longname: "Titan Biotech Limited", quoteType: "EQUITY" },
    { symbol: "544999.BO", longname: "Titanium Newco Limited", quoteType: "EQUITY" },
    { symbol: "TITAN-F.NS", longname: "x", quoteType: "FUTURE" }];
  const out = mergeSuggestions("tit", rows, yahoo, [{ id: "default", symbols: ["TITAN"] }]);
  assert.deepEqual(out.map(x => `${x.symbol}:${x.exchange}`), ["TITAN:NSE", "TITANBIO:NSE", "544999:BSE"]);
  assert.equal(out[0].tracked, true); assert.equal(out[0].pe, 80); assert.deepEqual(out[0].lists, ["default"]);
  assert.equal(mergeSuggestions("", rows).length, 0);
  assert.equal(mergeSuggestions("tata", rows)[0].symbol, "TATAMOTORS");
});

import { sanitizePlan, buildPlan, projectIncome } from "../divplan.mjs";
test("dividends: payment-month calendar from last 3 full years", () => {
  const evs = [2023, 2024, 2025].flatMap(y => [{ d: `${y}-03-10`, a: 4 }, { d: `${y}-09-10`, a: 6 }]).concat([{ d: "2026-03-10", a: 5 }]);
  const d = computeDividends(evs, { price: 200, now: NOW });
  assert.equal(d.calendar[2], 4); assert.equal(d.calendar[8], 6); assert.equal(d.calendar[0], 0);
});
test("dividend plan: sanitize, income, calendar weighting, override, projection", () => {
  const plan = sanitizePlan({ settings: { targetMonthly: 1000, monthlyContribution: 0, dividendGrowth: 0, newMoneyYield: 4, reinvest: false }, rows: [{ symbol: "itc", shares: 100 }, { symbol: "ITC", shares: 5 }, { symbol: "TCS", shares: 10, dpsOverride: 120 }, { symbol: "bad sym", shares: 1 }] });
  assert.deepEqual(plan.rows.map(r => r.symbol), ["ITC", "TCS"]);
  const cal = Array(12).fill(0); cal[5] = 15;
  const out = buildPlan(plan, { ITC: { company: "ITC", price: 400, dividend: { ttm: 15, calendar: cal, safety: "Safe", streakYears: 10 } }, TCS: { company: "TCS", price: 3000, dividend: null } });
  assert.equal(out.rows[0].annual, 1500); assert.equal(out.rows[0].yield, 3.8); assert.deepEqual(out.rows[0].payMonths, ["Jun"]);
  assert.equal(out.rows[1].annual, 1200); assert.equal(out.rows[1].dpsSource, "yours");
  assert.equal(out.calendar[5].amount, 1500 + 100); // ITC all in June + TCS spread evenly (1200/12)
  assert.equal(out.totals.annualIncome, 2700);
  const p = projectIncome({ annualIncome: 6000, settings: { targetMonthly: 1000, monthlyContribution: 1000, dividendGrowth: 0, newMoneyYield: 10, reinvest: false } });
  assert.equal(p.years[0].annualIncome, 7200); assert.equal(p.reachedInYears, 5); assert.equal(p.corpusNeeded, 120000);
  assert.equal(projectIncome({ annualIncome: 20000, settings: plan.settings }).reachedInYears, 0);
});

import { sanitizeGoal, goalPlan, GOAL_SEED } from "../divplan.mjs";
test("goal planner: same maths as the original page for all three methods, max 15 selected", () => {
  const cands = [{ symbol: "A", price: 100, div: 10, sel: true }, { symbol: "B", price: 200, div: 10, sel: true }, { symbol: "C", price: 50, div: 1, sel: false }];
  const eq = goalPlan({ monthlyGoal: 1000, method: "equalDiv", candidates: cands }); // 12000/2 = 6000 per stock
  assert.deepEqual(eq.rows.map(r => [r.symbol, r.shares]).sort(), [["A", 600], ["B", 600]]); assert.equal(eq.totalDiv, 12000); assert.equal(eq.totalCap, 180000);
  const ec = goalPlan({ monthlyGoal: 1000, method: "equalCap", candidates: cands }); // sumYield .15 -> 80000 in each stock
  assert.deepEqual(ec.rows.map(r => [r.symbol, r.shares]).sort(), [["A", 800], ["B", 400]]);
  for (const m of ["equalDiv", "equalCap", "yieldWeighted"]) { const out = goalPlan({ monthlyGoal: 1000, method: m, candidates: cands }); assert.ok(Math.abs(out.totalDiv - 12000) / 12000 < 0.02, `${m} plans ${out.totalDiv} of 12000`); }
  const yw = goalPlan({ monthlyGoal: 1000, method: "yieldWeighted", candidates: cands });
  assert.ok(yw.rows.find(r => r.symbol === "A").capital > yw.rows.find(r => r.symbol === "B").capital);
  const many = sanitizeGoal({ candidates: Array.from({ length: 20 }, (_, i) => ({ symbol: `S${i}`, price: 10, div: 1, sel: true })) });
  assert.equal(many.candidates.filter(c => c.sel).length, 15);
  const seeded = sanitizeGoal({}); assert.equal(seeded.candidates.length, GOAL_SEED.length); assert.equal(seeded.monthlyGoal, 100000); assert.equal(seeded.method, "equalDiv");
  assert.equal(goalPlan({ monthlyGoal: 1000, method: "equalDiv", candidates: [] }).count, 0);
});

import { createBrokerClients, normalizeIndmoneyHoldings, READ_ONLY_ROUTES } from "../brokers.mjs";
import os from "node:os"; import fsp from "node:fs/promises"; import pth from "node:path";
test("INDmoney: holdings parsed, token validated against /user/profile, only read-only routes", async () => {
  const hs = normalizeIndmoneyHoldings({ status: "success", data: [{ security_id: "18520", symbol: "CUPID", isin: "INE509F01029", total_qty: 3, used_qty: 0, avg_price: 217.3 }, { symbol: "ZERO", total_qty: 0, avg_price: 1 }] });
  assert.equal(hs.length, 1); assert.equal(hs[0].symbol, "CUPID"); assert.equal(hs[0].qty, 3); assert.equal(hs[0].invested, 651.9); assert.equal(hs[0].lastPrice, null);
  assert.deepEqual([...READ_ONLY_ROUTES.indmoney], ["GET /user/profile", "GET /portfolio/holdings"]);
  const dir = await fsp.mkdtemp(pth.join(os.tmpdir(), "ind-"));
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push([opts.method, new URL(url).pathname, opts.headers.Authorization]);
    const body = url.endsWith("/user/profile") ? { status: "success", data: { user_id: "U42", first_name: "Nishanth", last_name: "M" } } : { status: "success", data: [{ symbol: "ITC", total_qty: 10, avg_price: 400 }] };
    return { status: 200, ok: true, text: async () => JSON.stringify(body) }; };
  const b = createBrokerClients({ env: {}, fetchImpl, sessionFile: pth.join(dir, "s.json"), credentialsFile: pth.join(dir, "c.json") });
  await assert.rejects(() => b.indmoney.login({ mode: "token", accessToken: "short" }), /full INDmoney access token/);
  const out = await b.indmoney.login({ mode: "token", accessToken: "x".repeat(40) });
  assert.equal(out.profile.userId, "U42"); assert.equal(out.profile.name, "Nishanth M");
  const h = await b.indmoney.holdings(); assert.equal(h.holdings[0].symbol, "ITC"); assert.ok(h.priceNote);
  assert.ok(calls.every(([m, p, auth]) => m === "GET" && auth === "x".repeat(40) && ["/user/profile", "/portfolio/holdings"].includes(p)));
});

import { rankFocus, qualityScore, valuationScore } from "../focus.mjs";
test("focus list: ranks by quality+valuation, sorts into Accumulate / Trim / Exit / Review", () => {
  const good = { view: "Fair", status: "In zone", ratio: 0.95, roce: 26, salesCagr3: 18, profitCagr3: 20, borrowings: 5, reserves: 100, cfoToProfit3: 1, fcfNegative: 0, promoter: 55, promoterChange3y: 0, verdict: { key: "buy", label: "Value buy", cls: "v-under" } };
  const pricey = { ...good, view: "Very rich", status: "Wait (far above)", ratio: 2.2 };
  const weak = { view: "Fair to rich", status: "Above zone", ratio: 1.4, roce: 6, salesCagr3: 2, profitCagr3: -8, borrowings: 200, reserves: 100, cfoToProfit3: 0.3, fcfNegative: 1, promoter: 20, promoterChange3y: -9 };
  assert.ok(qualityScore(good).score > 80); assert.ok(qualityScore(weak).score < 30); assert.equal(valuationScore({ ratio: 0.7 }), 100); assert.equal(valuationScore({ ratio: 3 }), 0);
  const rowsBySym = { G: { ...good, symbol: "G", company: "Good" }, P: { ...pricey, symbol: "P", company: "Pricey" }, W: { ...weak, symbol: "W", company: "Weak" } };
  const out = rankFocus({ holdings: [{ symbol: "G", value: 10000, weightPct: 10 }, { symbol: "P", value: 60000, weightPct: 60 }, { symbol: "W", value: 25000, weightPct: 25 }, { symbol: "U", value: 5000, weightPct: 5 }], rowsBySym, n: 30 });
  const by = Object.fromEntries(out.rows.map(r => [r.symbol, r]));
  assert.equal(by.G.rank, 1); assert.equal(by.G.action, "Accumulate");
  assert.equal(by.P.action, "Trim"); assert.ok(by.P.move < 0);
  assert.equal(by.W.action, "Exit"); assert.equal(by.U.action, "Review"); assert.equal(by.U.rank, null);
  assert.equal(out.n, 3); assert.equal(out.counts.Accumulate, 1);
  const ideas = rankFocus({ holdings: [{ symbol: "G", value: 1, weightPct: 100 }], rowsBySym, candidates: [{ ...good, symbol: "NEW", company: "New" }, { ...weak, symbol: "BAD", verdict: { key: "wait" } }], n: 10 });
  assert.deepEqual(ideas.ideas.map(i => i.symbol), ["NEW"]);
});

import { parseNseList, rankFromQuotes } from "../market.mjs";
test("market lists: NSE shapes parsed; Yahoo fallback ranks 52w highs/lows, volume, value, volume gainers", () => {
  const nse = parseNseList("volume", { data: [{ symbol: "IDEA", series: "EQ", lastPrice: 7.5, pChange: 3.2, totalTradedVolume: 900000000, totalTradedValue: 675000000 }, { symbol: "NIFTYBEES", series: "ETF", lastPrice: 1 }] });
  assert.equal(nse.length, 1); assert.equal(nse[0].symbol, "IDEA"); assert.equal(nse[0].volume, 9e8); assert.equal(nse[0].value, 6.75e8);
  const hi = parseNseList("52high", { data: [{ symbol: "HAL", ltp: "4,500", new52WHL: 4510, prev52WHL: 4400, pChange: 2 }] });
  assert.equal(hi[0].ltp, 4500); assert.equal(hi[0].high52, 4510); assert.equal(hi[0].prev52, 4400);
  const lo = parseNseList("52low", { data: [{ symbol: "X", ltp: 10, new52WHL: 9.8 }] }); assert.equal(lo[0].low52, 9.8);
  const qs = [{ symbol: "A", price: 99.5, high52: 100, low52: 50, volume: 1000, avgVolume: 200 }, { symbol: "B", price: 50.2, high52: 120, low52: 50, volume: 5000, avgVolume: 4000 }, { symbol: "C", price: 70, high52: 90, low52: 40, volume: 10, avgVolume: 10 }];
  assert.deepEqual(rankFromQuotes("52high", qs).map(r => r.symbol), ["A"]);
  assert.deepEqual(rankFromQuotes("52low", qs).map(r => r.symbol), ["B"]);
  assert.deepEqual(rankFromQuotes("volume", qs).map(r => r.symbol), ["B", "A", "C"]);
  assert.deepEqual(rankFromQuotes("value", qs).map(r => r.symbol), ["B", "A", "C"]);
  assert.deepEqual(rankFromQuotes("volgainers", qs).map(r => r.symbol), ["A"]);
});

import { parseScreenerExtra, parsePeersTable, parseScreenerChart } from "../screener.mjs";
import { dividendsFromAnnual } from "../dividends.mjs";
test("screener extras: ids, yearly dividend per share, peer table, chart; yearly dividend lens", () => {
  const html = `<div id="company-info" data-company-id="1234" data-warehouse-id="5678"></div>
    <ul id="top-ratios"><li><span class="name">Current Price</span><span class="number">400</span></li><li><span class="name">Dividend Yield</span><span class="number">3.2</span> %</li></ul>
    <section id="profit-loss"><table><thead><tr><th></th><th>Mar 2021</th><th>Mar 2022</th><th>Mar 2023</th><th>Mar 2024</th><th>Mar 2025</th><th>Mar 2026</th><th>TTM</th></tr></thead><tbody>
    <tr><td>EPS in Rs</td><td>10</td><td>11</td><td>12</td><td>13</td><td>14</td><td>15</td><td>16</td></tr>
    <tr><td>Dividend Payout %</td><td>40%</td><td>40%</td><td>40%</td><td>40%</td><td>40%</td><td>50%</td><td></td></tr></tbody></table></section>`;
  const x = parseScreenerExtra(html);
  assert.equal(x.companyId, "1234"); assert.equal(x.warehouseId, "5678"); assert.equal(x.dividendYield, 3.2);
  assert.deepEqual(x.divAnnual.map(d => d.dps), [4, 4.4, 4.8, 5.2, 5.6, 7.5]);
  const d = dividendsFromAnnual(x.divAnnual, { price: 400, dividendYield: x.dividendYield, profitCagr3: 8 });
  assert.equal(d.safety, "Safe"); assert.equal(d.ttm, 7.5); assert.equal(d.yield, 3.2); assert.equal(d.streakYears, 6); assert.equal(d.calendar, null); assert.ok(d.cagr5 > 12);
  assert.equal(dividendsFromAnnual([{ year: 2025, dps: 5 }, { year: 2026, dps: 2 }], { price: 100 }).safety, "At risk");
  const pt = parsePeersTable(`<table><tr><th>S.No.</th><th>Name</th><th>CMP Rs.</th><th>P/E</th></tr><tr><td>1.</td><td><a href="/company/HDFCBANK/consolidated/">HDFC Bank</a></td><td>1700</td><td>19</td></tr><tr><td></td><td>Median: 9 Co.</td><td>900</td><td>14</td></tr></table>`);
  assert.equal(pt.rows[0].symbol, "HDFCBANK"); assert.deepEqual(pt.rows[0].cells, ["1.", "HDFC Bank", "1700", "19"]); assert.equal(pt.median[1], "Median: 9 Co.");
  const bars = parseScreenerChart({ datasets: [{ metric: "Price", values: [["2026-01-01", "100"], ["2026-01-02", "101.5"]] }, { metric: "Volume", values: [["2026-01-01", 5000, { delivery: 40 }], ["2026-01-02", 7000]] }] });
  assert.deepEqual(bars.map(b => [b.c, b.v]), [[100, 5000], [101.5, 7000]]);
  assert.equal(parseScreenerChart({}), null);
});

import { normalizeQuotes } from "../kite-mcp.mjs";
test("Kite quotes → today's movers: gainers, losers, value uses average price", () => {
  const q = normalizeQuotes({ "NSE:ITC": { last_price: 410, volume: 1000, average_price: 405, ohlc: { open: 400, high: 412, low: 399, close: 400 } }, "NSE:TCS": { last_price: 3000, volume: 50, ohlc: { close: 3100 } }, "NSE:BAD": { last_price: 0 } });
  assert.equal(q.size, 2); assert.equal(q.get("ITC").pChange, 2.5); assert.equal(q.get("TCS").pChange, -3.23);
  const rows = [...q.values()];
  assert.deepEqual(rankFromQuotes("gainers", rows).map(r => r.symbol), ["ITC"]);
  assert.deepEqual(rankFromQuotes("losers", rows).map(r => r.symbol), ["TCS"]);
  assert.equal(rankFromQuotes("value", rows)[0].value, 405000);
});

import { growthLens, defaultGrowth } from "../growthlens.mjs";
test("growth lens: high-P/E compounder can be fairly priced; implied growth and expected return; classify override needs gates", () => {
  const r = { price: 1000, pe: 60, salesCagr3: 28, profitCagr3: 32 };
  assert.equal(defaultGrowth(r), 25); // 0.6*28 + 0.4*32 = 29.6, capped at 25
  const gl = growthLens(r, { growth: 28 });
  // EPS 16.67 × 1.28^5 × 1.14^5 × 20 ÷ 1.12^10
  const expect = 1000 / 60 * Math.pow(1.28, 5) * Math.pow(1.14, 5) * 20 / Math.pow(1.12, 10);
  assert.ok(Math.abs(gl.fair.base - Math.round(expect)) <= 1);
  assert.ok(gl.impliedGrowth > 20 && gl.impliedGrowth < 30); assert.equal(gl.custom, true);
  assert.ok(gl.fair.bear < gl.fair.base && gl.fair.base < gl.fair.bull);
  assert.equal(growthLens({ price: 100, pe: -5, salesCagr3: 10 }), null);
  // A Very-rich-by-P/E stock that passes the growth gates and is fair for its growth is not "avoid"
  const row = { view: "Very rich", status: "Wait (far above)", ratio: 2.4, salesCagr3: 28, profitCagr3: 32, roce: 30, borrowings: 5, reserves: 100, cfoToProfit3: 0.9, fcfNegative: 0, promoter: 55, promoterChange3y: 0, price: 1000, pe: 45 };
  row.growthLens = growthLens(row, { growth: 30 });
  const v = classify(row);
  assert.ok(row.growthLens.ratio <= 1.1, `ratio ${row.growthLens.ratio}`); assert.ok(v.growthJustified); assert.ok(["buy", "wait"].includes(v.key)); assert.ok(v.tags.includes("Growth-justified"));
  // Without the growth gates (e.g. heavy debt) it stays expensive
  const levered = { ...row, borrowings: 500 }; levered.growthLens = row.growthLens;
  assert.equal(classify(levered).key, "expensive");
});

import { readXlsx, parseDelimited, extractHoldings, fundSummary } from "../funds.mjs";
import { parseScreenerSearch } from "../screener.mjs";
import zlibT from "node:zlib";
function makeZip(files) { // tiny zip writer for the test (deflate), enough for readXlsx
  const locals = [], centrals = []; let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const nb = Buffer.from(name), data = zlibT.deflateRawSync(Buffer.from(text));
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt16LE(nb.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, nb, data); centrals.push(ch, nb); off += 30 + nb.length + data.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}
test("fund X-ray: reads AMC Excel, keeps equity rows, pasted tables, summary with weighted P/E and overlap", () => {
  const ss = ["Helios Flexi Cap Fund", "Name of the Instrument", "ISIN", "Industry", "% to Net Assets", "HDFC Bank Limited", "INE040A01034", "Banks", "TREPS", "Infosys Limited", "INE009A01021", "IT", "7.25% GOI 2034", "IN0020240019"];
  const si = s => ss.indexOf(s);
  const c = (ref, s) => `<c r="${ref}" t="s"><v>${si(s)}</v></c>`, n = (ref, v) => `<c r="${ref}"><v>${v}</v></c>`;
  const sheet = `<worksheet><sheetData><row r="1">${c("A1", "Helios Flexi Cap Fund")}</row><row r="3">${c("A3", "Name of the Instrument")}${c("B3", "ISIN")}${c("C3", "Industry")}${c("D3", "% to Net Assets")}</row>
    <row r="4">${c("A4", "HDFC Bank Limited")}${c("B4", "INE040A01034")}${c("C4", "Banks")}${n("D4", "0.0812")}</row><row r="5">${c("A5", "TREPS")}${n("D5", "0.05")}</row>
    <row r="6">${c("A6", "Infosys Limited")}${c("B6", "INE009A01021")}${c("C6", "IT")}${n("D6", "0.061")}</row><row r="7">${c("A7", "7.25% GOI 2034")}${c("B7", "IN0020240019")}${n("D7", "0.02")}</row></sheetData></worksheet>`;
  const buf = makeZip({ "xl/workbook.xml": '<workbook><sheets><sheet name="HFCF" sheetId="1" r:id="rId1"/></sheets></workbook>', "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>', "xl/sharedStrings.xml": `<sst>${ss.map(s => `<si><t>${s}</t></si>`).join("")}</sst>`, "xl/worksheets/sheet1.xml": sheet });
  const t = readXlsx(buf); assert.equal(t[0].name, "HFCF");
  const x = extractHoldings(t[0].rows);
  assert.deepEqual(x.holdings.map(h => [h.name, h.weight]), [["HDFC Bank Limited", 8.12], ["Infosys Limited", 6.1]]); // fractions -> %, TREPS and GOI bond dropped
  const pasted = extractHoldings(parseDelimited("Company\tSector\t% of Assets\nHDFC Bank Ltd.\tBanks\t8.12%\nCash & Equivalents\t-\t4.0%\nInfosys Ltd.\tIT\t6.10%"));
  assert.deepEqual(pasted.holdings.map(h => h.name), ["HDFC Bank Ltd.", "Infosys Ltd."]);
  const s = fundSummary([{ name: "A", symbol: "A", weight: 60 }, { name: "B", symbol: "B", weight: 40 }, { name: "C", symbol: null, weight: 0 }], { A: { ratio: 1, pe: 20, verdict: { key: "buy" } }, B: { ratio: 2, pe: 40, verdict: { key: "expensive" } } }, new Map([["A", 10]]));
  assert.equal(s.weightedPE, 25); assert.equal(s.mix.buy, 60); assert.equal(s.mix.expensive, 40); assert.equal(s.overlapWithYou, 10); assert.equal(s.sharedStocks, 1);
  assert.deepEqual(parseScreenerSearch([{ name: "Infosys Ltd", url: "/company/INFY/consolidated/" }, { name: "New Co", url: "/company/544252/" }]).map(r => `${r.symbol}:${r.exchange}`), ["INFY:NSE", "544252:BSE"]);
});

// ---- v2.9: net worth, Kite mutual funds, look-through ----
import { sanitizeItem, buildNetworth, addSnapshot, changeSince, matchFund, lookThrough } from "../networth.mjs";
import { normalizeMfHoldings, READ_ONLY_TOOLS as KITE_TOOLS } from "../kite-mcp.mjs";
test("Kite mutual fund holdings are normalised and the tool is on the read-only list", () => {
  assert.ok(KITE_TOOLS.includes("get_mf_holdings"));
  const out = normalizeMfHoldings({ data: [{ folio: "123/45", fund: "HELIOS FLEXI CAP FUND - DIRECT PLAN", tradingsymbol: "INF0R8F01034", quantity: 1000.5, average_price: 10, last_price: 12.5, last_price_date: "2026-10-08", pnl: 2501.25 }, { tradingsymbol: "INF000000000", quantity: 0 }] });
  assert.equal(out.length, 1);
  assert.deepEqual({ isin: out[0].isin, units: out[0].units, value: out[0].value, invested: out[0].invested, folio: out[0].folio }, { isin: "INF0R8F01034", units: 1000.5, value: 12506.25, invested: 10005, folio: "123/45" });
});
test("net worth: manual entries are validated, totals and mix add up, liabilities subtract", () => {
  assert.throws(() => sanitizeItem({ category: "stocks", value: 1 }), /category/);
  assert.throws(() => sanitizeItem({ category: "ppf", value: "abc" }), /value/);
  const ppf = sanitizeItem({ category: "ppf", name: "SBI PPF", value: "₹4,00,000", invested: "300000" });
  assert.equal(ppf.value, 400000); assert.equal(ppf.kind, "asset");
  const loan = sanitizeItem({ category: "homeloan", value: 2500000, invested: 99 });
  assert.equal(loan.kind, "liability"); assert.equal(loan.invested, null);
  const gold = sanitizeItem({ category: "gold", value: 600000 }), house = sanitizeItem({ category: "realestate", value: 8000000 });
  const nw = buildNetworth({ stocks: [{ account: "AB1", label: "Zerodha · Me", value: 1000000, invested: 800000 }], mf: [{ key: "AB1:INF1:", name: "Helios", value: 500000, invested: 400000 }], items: [ppf, loan, gold, house] });
  assert.equal(nw.totals.assets, 1000000 + 500000 + 400000 + 600000 + 8000000);
  assert.equal(nw.totals.liabilities, 2500000);
  assert.equal(nw.totals.net, nw.totals.assets - 2500000);
  assert.equal(nw.totals.gainOnInvested, (1000000 - 800000) + (500000 - 400000) + (400000 - 300000));
  const mix = Object.fromEntries(nw.classes.map(c => [c.id, c.pct]));
  assert.equal(Math.round(Object.values(mix).reduce((a, b) => a + b, 0)), 100);
  assert.equal(mix.realestate, Math.round(8000000 / nw.totals.assets * 1000) / 10);
  assert.equal(nw.categories.find(c => c.id === "homeloan").value, 2500000);
});
test("net worth history keeps one snapshot a day and reports change", () => {
  let h = [];
  h = addSnapshot(h, "2026-09-01", { net: 100, assets: 100, liabilities: 0 });
  h = addSnapshot(h, "2026-10-09", { net: 90, assets: 100, liabilities: 10 });
  h = addSnapshot(h, "2026-10-09", { net: 120, assets: 130, liabilities: 10 });
  assert.equal(h.length, 2);
  assert.deepEqual(changeSince(h, "2026-10-09", 30), { from: "2026-09-01", abs: 20, pct: 20 });
  assert.equal(changeSince(h, "2026-10-09", 365), null);
});
test("fund names match X-ray portfolios only when clearly the same scheme", () => {
  const xr = [{ id: "a", name: "Helios Flexi Cap" }, { id: "b", name: "Trust MF Small Cap" }];
  assert.equal(matchFund("HELIOS FLEXI CAP FUND - DIRECT PLAN - GROWTH", xr)?.id, "a");
  assert.equal(matchFund("TRUSTMF SMALL CAP FUND DIRECT GROWTH", xr)?.id, "b");
  assert.equal(matchFund("HDFC Flexi Cap Fund Direct Growth", xr), null);
  assert.equal(matchFund("Axis Small Cap Fund", xr), null);
});
test("look-through adds direct and in-fund exposure per stock", () => {
  const xray = new Map([["a", { name: "Helios", holdings: [{ symbol: "HDFCBANK", name: "HDFC Bank", weight: 10 }, { symbol: "POLYCAB", name: "Polycab", weight: 5 }] }]]);
  const L = lookThrough({ direct: [{ symbol: "POLYCAB", name: "Polycab", value: 100000 }], funds: [{ key: "k1", name: "Helios Flexi Cap", value: 1000000, fundId: "a" }, { key: "k2", name: "Unknown fund", value: 200000, fundId: null }], xray });
  const poly = L.rows.find(r => r.symbol === "POLYCAB"), hdfc = L.rows.find(r => r.symbol === "HDFCBANK");
  assert.equal(poly.direct, 100000); assert.equal(poly.viaFunds, 50000); assert.equal(poly.total, 150000); assert.ok(poly.both);
  assert.equal(hdfc.viaFunds, 100000); assert.equal(L.rows[0].symbol, "POLYCAB");
  assert.equal(L.totals.uncoveredFunds, 200000); assert.equal(L.totals.doubledUp, 1);
  assert.equal(L.perFund.find(f => f.key === "k1").overlapPct, 5);
});

// ---- v3.0: tax view, goals ----
import { parseTradebook, mergeTrades, fifo, taxFor, taxView, ltDate, fyOf } from "../tax.mjs";
import { sanitizeGoal as sanitizeNwGoal, requiredReturn, futureValue, goalStatus, actualGrowth } from "../networth.mjs";
test("tradebook parsing (Zerodha Console format), FIFO lots and long-term dates", () => {
  const rows = [["symbol", "isin", "trade_date", "exchange", "segment", "series", "trade_type", "auction", "quantity", "price", "trade_id"],
    ["POLYCAB", "INE455K01017", "2024-06-10", "NSE", "EQ", "EQ", "buy", "false", "10", "6000", "1"],
    ["POLYCAB", "INE455K01017", "2025-09-01", "NSE", "EQ", "EQ", "buy", "false", "5", "7000", "2"],
    ["POLYCAB", "INE455K01017", "2026-05-02", "NSE", "EQ", "EQ", "sell", "false", "4", "7500", "3"],
    ["NIFTY25OCTFUT", "", "2026-05-02", "NFO", "FO", "", "buy", "false", "50", "1", "4"]];
  const { trades, skipped } = parseTradebook(rows);
  assert.equal(trades.length, 4 - 1); assert.equal(skipped.fno, 1);
  assert.equal(mergeTrades(trades, trades).length, 3, "re-importing the same file adds nothing");
  const { lots, realised } = fifo(trades);
  assert.deepEqual(lots.get("INE455K01017").map(l => l.qty), [6, 5]);
  assert.equal(realised[0].long, true); assert.equal(realised[0].gain, 4 * 1500);
  assert.equal(ltDate("2025-03-10"), "2026-03-11");
  assert.deepEqual(fyOf("2026-03-31"), { label: "FY 2025-26", from: "2025-04-01", to: "2026-03-31" });
});
test("tax set-off: short-term loss offsets long-term gain, then the ₹1.25 L exemption", () => {
  assert.deepEqual(taxFor({ stGain: 0, stLoss: 50000, ltGain: 300000, ltLoss: 0 }), { netSt: 0, netLt: 250000, exemptUsed: 125000, exemptLeft: 0, tax: Math.round(125000 * 0.125) });
  assert.equal(taxFor({ stGain: 100000, ltGain: 0, ltLoss: 40000 }).tax, 20000, "long-term loss cannot offset short-term gain");
});
test("tax view: lots split long/short, harvest within the exemption, wait-to-sell and mismatches", () => {
  const trades = [
    { key: "INE1", symbol: "AAA", isin: "INE1", date: "2024-01-15", side: "buy", qty: 100, price: 1000 },
    { key: "INE1", symbol: "AAA", isin: "INE1", date: "2026-09-01", side: "buy", qty: 10, price: 1400 },
    { key: "INE2", symbol: "BBB", isin: "INE2", date: "2025-11-20", side: "buy", qty: 50, price: 500 }];
  const v = taxView({ trades, today: "2026-10-10", holdings: [
    { key: "AAA", symbol: "AAA", name: "Aaa", qty: 110, price: 2000, avgPrice: 1036, kind: "stock" },
    { key: "BBB", symbol: "BBB", name: "Bbb", qty: 60, price: 450, avgPrice: 500, kind: "stock" }] });
  const a = v.rows.find(r => r.symbol === "AAA"), b = v.rows.find(r => r.symbol === "BBB");
  assert.equal(a.ltGain, 100 * 1000); assert.equal(a.stGain, 10 * 600);
  assert.equal(b.mismatch.includes("more shares"), true); assert.equal(b.lots.at(-1).unknown, true);
  // exemption 1.25 L, AAA long-term gain is ₹1,000 a share → harvest 125 shares max, but only 100 are long term
  assert.equal(v.ideas.harvestGains[0].qty, 100); assert.equal(v.ideas.harvestGainsTotal, 100000);
  assert.ok(!v.ideas.harvestLosses.some(l => l.symbol === "BBB"), "holdings with unknown-date shares are left out of ideas");
  assert.equal(v.ideas.waitToSell.length, 0, "AAA's short-term lot turns long term in 2027, outside 60 days");
  // FIFO: a recent lot at a loss behind an older profitable lot is NOT a loss you can book
  const w = taxView({ today: "2026-10-10", trades: [
    { key: "C", symbol: "CCC", date: "2023-01-01", side: "buy", qty: 5, price: 100 }, { key: "C", symbol: "CCC", date: "2026-09-20", side: "buy", qty: 5, price: 300 }],
    holdings: [{ key: "CCC", symbol: "CCC", name: "Ccc", qty: 10, price: 250, kind: "stock" }] });
  assert.equal(w.ideas.harvestLosses.length, 0);
  assert.equal(w.ideas.harvestGains[0].qty, 5);
});
test("net worth goals: required return, projection and status", () => {
  assert.equal(requiredReturn(1e7, 0, 2e7, 120), 7.2);
  assert.ok(Math.abs(futureValue(0, 10000, 0, 12) - 120000) < 1);
  assert.throws(() => sanitizeNwGoal({ target: 1e7, by: "2020-01" }, null, "2026-10-10"), /future/);
  const g = sanitizeNwGoal({ name: "Freedom", target: "5,00,00,000", by: "2036-10", monthly: 100000, expectedReturn: 12 }, null, "2026-10-10");
  const s = goalStatus(g, { net: 1e7, investable: 6e6, today: "2026-10-10", history: [] });
  assert.equal(s.months, 120); assert.ok(["on-track", "stretch", "behind"].includes(s.state));
  assert.equal(actualGrowth([{ day: "2026-01-01", net: 100 }, { day: "2027-01-01", net: 110 }]), 10);
});

// ---- v3.2: model portfolio, US stocks ----
import { buildModel, assetMix, styleScore, PROFILES } from "../model.mjs";
import { parseSecTickers, searchTickers, seriesFromFacts, usValuation, parseStooq, dcfPerShare, impliedGrowth, cleanUsSymbol } from "../us.mjs";
import fsSync from "node:fs";
const mkRow = (i, o = {}) => ({ symbol: `S${i}`, company: `Stock ${i}`, sector: `Sector ${i % 6}`, cap: i % 5 === 0 ? "Small" : i % 3 === 0 ? "Mid" : "Large", price: 100 + i, ratio: 0.7 + (i % 10) * 0.1, roce: 15 + (i % 15), salesCagr3: 8 + (i % 20), profitCagr3: 10 + (i % 18), borrowings: 10, reserves: 100, cfoToProfit3: 0.9, fcfNegative: 0, promoter: 50, status: i % 4 === 0 ? "In zone" : "Above zone", pe: 20 + i % 30, dividend: { yield: (i % 7) * 0.6, safety: i % 2 ? "Safe" : "Watch", streakYears: i % 12, cagr5: i % 10 }, verdict: { label: "x", cls: "v-buy" }, ...o });
test("asset mix follows the profile and shrinks equity for short horizons", () => {
  assert.deepEqual((({ equity, debt, gold }) => ({ equity, debt, gold }))(assetMix("aggressive", 15)), { equity: 80, debt: 10, gold: 10 });
  const short = assetMix("aggressive", 2); assert.equal(short.equity, 60); assert.equal(short.equity + short.debt + short.gold, 100); assert.ok(short.notes.length);
  assert.equal(assetMix("conservative", 4).equity, 25);
});
test("model portfolio respects quality, size, per-stock and per-sector caps; weights add to 100", () => {
  const rows = Array.from({ length: 60 }, (_, i) => mkRow(i + 1));
  rows.push(mkRow(99, { roce: 4, salesCagr3: -5, profitCagr3: -10 })); // junk: must be filtered
  for (const profile of Object.keys(PROFILES)) for (const style of ["dividend", "growth", "value", "blend"]) {
    const m = buildModel({ rows, profile, style, amount: 1000000, years: 12 });
    const P = PROFILES[profile];
    assert.ok(m.rows.length > 0, `${profile}/${style} empty`);
    assert.ok(Math.abs(m.rows.reduce((a, r) => a + r.weight, 0) - 100) < 0.6, `${profile}/${style} weights ${m.rows.reduce((a, r) => a + r.weight, 0)}`);
    assert.ok(m.rows.every(r => r.weight <= P.maxWeight + 0.05), `${profile}/${style} max weight`);
    for (const s of m.sectors) assert.ok(s.weight <= P.sectorCap + 0.6, `${profile}/${style} sector ${s.sector} ${s.weight}`);
    assert.ok(!m.rows.some(r => r.symbol === "S99"));
    if (!P.allowSmall) assert.ok(!m.rows.some(r => r.cap === "Small"));
    else assert.ok((m.capMix.find(c => c.cap === "Small")?.weight ?? 0) <= P.maxSmallPct + 0.6, `${profile}/${style} small caps`);
    assert.equal(m.split.equity + m.split.debt + m.split.gold, 1000000);
    assert.ok(Math.abs(m.rows.reduce((a, r) => a + r.amount, 0) - m.split.equity) < 50);
  }
  assert.equal(styleScore(mkRow(7, { dividend: null }), "dividend").score, null);
});
test("US: SEC ticker search, company facts → annual series (10-K only, multi-concept), valuation, Stooq prices", () => {
  const tick = parseSecTickers({ 0: { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." }, 1: { cik_str: 1067983, ticker: "BRK.B", title: "BERKSHIRE HATHAWAY INC" }, 2: { cik_str: 909832, ticker: "COST", title: "COSTCO WHOLESALE CORP /NEW" } });
  assert.equal(tick[1].symbol, "BRK-B"); assert.equal(cleanUsSymbol("brk.b"), "BRK-B");
  assert.equal(searchTickers(tick, "aap")[0].symbol, "AAPL"); assert.equal(searchTickers(tick, "costco")[0].symbol, "COST");
  const s = seriesFromFacts(JSON.parse(fsSync.readFileSync(new URL("./fixtures/sec-companyfacts-sample.json", import.meta.url))));
  assert.deepEqual(s.years.map(y => y.fy), [2019, 2020, 2021, 2022, 2023, 2024], "older 'Revenues' years merged with newer concept");
  assert.equal(s.years.at(-1).revenue, 391e9, "annual value, not the quarterly one"); assert.equal(s.years.at(-1).debt, 96.7e9);
  const v = usValuation(s, 227);
  assert.equal(v.asOfFy, 2024); assert.equal(v.eps, 6.08); assert.equal(v.pe, 37.3);
  assert.ok(v.fairValue > 50 && v.fairValue < 200); assert.equal(v.verdict.key, "expensive"); assert.ok(v.impliedGrowth > v.growthUsed);
  const hi = usValuation(s, 227, { growth: 25 }); assert.ok(hi.fairValue > v.fairValue); assert.equal(hi.growthOverride, 25);
  assert.ok(Math.abs(dcfPerShare(5, 10) - dcfPerShare(5, 10)) < 1e-9 && dcfPerShare(5, 15) > dcfPerShare(5, 5));
  assert.ok(Math.abs(dcfPerShare(5, impliedGrowth(150, 5)) - 150) < 1);
  const p = parseStooq("Symbol,Date,Time,Open,High,Low,Close,Volume\nAAPL.US,2026-10-09,22:00:19,226,229,225,227.5,50000000\nXYZ.US,N/D,N/D,N/D,N/D,N/D,N/D,N/D");
  assert.equal(p.get("AAPL").price, 227.5); assert.ok(!p.has("XYZ"));
  assert.ok(usValuation({ years: [] }, 10).error);
});

// ---- v3.3: offline company list for search ----
import { SEED, parseKiteInstruments, parseNseEquityList, mergeMaster, searchMaster } from "../scripmaster.mjs";
test("search works offline: built-in list finds IOC / ONGC by symbol and name; Kite and NSE lists parse", () => {
  assert.equal(searchMaster(SEED, "IOC")[0].symbol, "IOC");
  assert.equal(searchMaster(SEED, "ongc")[0].symbol, "ONGC");
  assert.equal(searchMaster(SEED, "indian oil")[0].symbol, "IOC");
  assert.ok(searchMaster(SEED, "oil nat").some(x => x.symbol === "ONGC"));
  assert.equal(new Set(SEED.map(x => x.symbol)).size, SEED.length, "no duplicate symbols in the built-in list");
  const kite = parseKiteInstruments('instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange\n1,2,IOC,"INDIAN OIL CORP",0,,0,0.05,1,EQ,NSE,NSE\n3,4,SGBMAR29-GB,SGB,0,,0,0.01,1,EQ,NSE,NSE\n5,6,NIFTY25OCTFUT,NIFTY,0,2025-10-30,0,0.05,75,FUT,NFO-FUT,NFO\n7,8,530001,"GUJARAT INDUSTRIES",0,,0,0.05,1,EQ,BSE,BSE\n9,10,IOC,"INDIAN OIL CORP",0,,0,0.05,1,EQ,BSE,BSE');
  assert.deepEqual(kite.map(x => `${x.exchange}:${x.symbol}`), ["NSE:IOC", "BSE:530001", "BSE:IOC"]);
  assert.equal(kite[0].name, "Indian Oil Corp");
  const merged = mergeMaster(kite, SEED);
  assert.ok(!merged.some(x => x.exchange === "BSE" && x.symbol === "IOC"), "a company on both exchanges appears once, as NSE");
  assert.ok(merged.some(x => x.symbol === "530001"), "BSE-only companies are kept");
  const nse = parseNseEquityList("SYMBOL,NAME OF COMPANY, SERIES, DATE OF LISTING, PAID UP VALUE, MARKET LOT, ISIN NUMBER, FACE VALUE\nONGC,Oil & Natural Gas Corporation Limited,EQ,19-JUL-1995,10,1,INE213A01029,5");
  assert.deepEqual(nse[0], { symbol: "ONGC", name: "Oil & Natural Gas Corporation Limited", exchange: "NSE", isin: "INE213A01029" });
});

// ---- v4.1: swing trading ----
import { parseAmount, parsePrice, parseSheet, sanitizePosition, sanitizeWatch, evaluateSwing, diffSwingAlerts, applyBuy, applySell, reopenTrade, parseTargets, parseBookPlan, planShares, lotsOf, moveCash, scorecard, swingTaxRows } from "../swing.mjs";
import { buildXlsx } from "../xlsx.mjs";
import { pushAlerts, findChat, formatAlert, validToken } from "../notify.mjs";
test("swing: amounts and prices in Indian shorthand", () => {
  assert.equal(parseAmount("2L"), 200000); assert.equal(parseAmount("10 L"), 1000000); assert.equal(parseAmount("1.5Cr"), 15000000); assert.equal(parseAmount("50k"), 50000); assert.equal(parseAmount("abc"), null);
  assert.equal(parsePrice("4.7k"), 4700); assert.equal(parsePrice("2,834.5"), 2834.5);
});
test("swing: pasting the sheet gives positions with limits and add plans, and watchlist rows", () => {
  const rows = parseSheet("12-10-2026\tStock\tQTY\tPurchase pirce\tPurchase Value\tLTP\tCurrent Holdings Value\tprofit/Loss\tLIMIT\n\tHero Motocorp\t21\t4936.88\t103674\t4917.5\t103267.5\t\t3L\tAdd 2L below 4.7k\n\t\t\tTotal\t307665\t\t306556.1\t-1109\n\tPB Fintech\t\t\t\t\t\t\t\tAdd 3L below 980\n\tTips Music\t\t\t\t\t\t\t\tAdd 3L below");
  assert.deepEqual(rows.map(r => [r.name, r.kind, r.qty, r.avgPrice, r.limit, r.addAmount, r.addBelow]), [["Hero Motocorp", "position", 21, 4936.88, 300000, 200000, 4700], ["PB Fintech", "watch", null, null, null, 300000, 980], ["Tips Music", "watch", null, null, null, 300000, null]]);
});
test("swing: take-profit at +10%, deploy at the add level within the limit, near signals, alerts once", () => {
  const hero = sanitizePosition({ symbol: "HEROMOTOCO", name: "Hero Motocorp", qty: 21, avgPrice: 4936.88, limit: "3L", addAmount: "2L", addBelow: "4.7k" });
  const infy = sanitizePosition({ symbol: "INFY", qty: 100, avgPrice: 1000, limit: "1L", addAmount: "2L", addBelow: 990 });
  const tcs = sanitizePosition({ symbol: "TCS", qty: 10, avgPrice: 3000 });
  const pb = sanitizeWatch({ symbol: "POLICYBZR", name: "PB Fintech", buyBelow: 980, amount: "3L" });
  const prices = new Map([["HEROMOTOCO", { price: 4650, prevClose: 4700 }], ["INFY", { price: 985 }], ["TCS", { price: 3310 }], ["POLICYBZR", { price: 1000 }]]);
  const v = evaluateSwing({ positions: [hero, infy, tcs], watch: [pb], prices });
  const by = s => v.positions.find(p => p.symbol === s);
  assert.equal(by("HEROMOTOCO").status, "deploy"); assert.equal(by("HEROMOTOCO").deployAmount, 196325.52, "2L planned, but only ₹1.96L left in the 3L limit (₹1.04L used)");
  assert.equal(by("INFY").status, "deploy-limit", "limit of 1L already used");
  assert.equal(by("TCS").status, "take-profit"); assert.equal(by("TCS").pnl, 3100); assert.equal(by("TCS").pnlPct, 10.33);
  assert.equal(v.watch[0].status, "near-deploy"); assert.equal(v.watch[0].distance, 2.04);
  assert.equal(v.totals.takeProfit, 1); assert.equal(v.totals.deploy, 1);
  const a1 = diffSwingAlerts({}, v); assert.deepEqual(a1.fresh.map(e => e.type).sort(), ["swing-deploy", "swing-profit"]);
  const a2 = diffSwingAlerts(a1.next, v, { events: a1.fresh }); assert.equal(a2.fresh.length, 0, "no repeat while the signal holds");
  // buy more / sell
  const more = applyBuy(tcs, 10, 3200); assert.equal(more.qty, 20); assert.equal(more.avgPrice, 3100);
  const s = applySell(tcs, 4, 3300); assert.equal(s.position.qty, 6); assert.equal(s.trade.pnl, 1200);
  assert.throws(() => applySell(tcs, 11, 3300));
});

test("swing: T1/T2/T3 target prices, a fresh alert at each higher target, custom targets", () => {
  assert.deepEqual(parseTargets("10, 20, 40"), [10, 20, 40]); assert.deepEqual(parseTargets("15"), [15, 20, 40]); assert.deepEqual(parseTargets(25), [25, 40]);
  assert.equal(parseTargets(""), null); assert.throws(() => parseTargets("20,10")); assert.throws(() => parseTargets("10,20,30,40"));
  const p = sanitizePosition({ symbol: "TCS", qty: 10, avgPrice: 3000 });
  const at = price => evaluateSwing({ positions: [p], prices: new Map([["TCS", { price }]]) });
  const v0 = at(3050).positions[0];
  assert.deepEqual(v0.targets.map(t => [t.n, t.pct, t.price, t.hit]), [[1, 10, 3300, false], [2, 20, 3600, false], [3, 40, 4200, false]]);
  assert.equal(v0.targets[1].profit, 2400, "4 of 10 shares planned at T2 (a third each), ₹600 each"); assert.equal(v0.status, "hold");
  assert.equal(at(3240).positions[0].status, "near-profit");
  const v1 = at(3310), v2 = at(3620), v3 = at(4300);
  assert.equal(v1.positions[0].hitLevel, 1); assert.equal(v1.positions[0].nextTarget.price, 3600); assert.match(v1.positions[0].note, /T1 hit.*Next T2: ₹3,600/);
  assert.equal(v2.positions[0].hitLevel, 2); assert.equal(v3.positions[0].hitLevel, 3); assert.match(v3.positions[0].note, /All targets hit/);
  const a1 = diffSwingAlerts({}, v1); assert.equal(a1.fresh.length, 1); assert.match(a1.fresh[0].title, /hit T1 \(\+10%, ₹3300\)/);
  const a2 = diffSwingAlerts(a1.next, v2, { events: a1.fresh }); assert.equal(a2.fresh.length, 1, "T2 alerts again"); assert.match(a2.fresh[0].title, /T2/);
  const back = diffSwingAlerts(a2.next, v1, { events: [...a1.fresh, ...a2.fresh] }); assert.equal(back.fresh.length, 0, "falling back to T1 is not a new alert");
  assert.equal(diffSwingAlerts({ "position:x": "take-profit" }, v1).fresh.length, 1, "state saved before v4.2 still works");
  const own = sanitizePosition({ symbol: "TCS", qty: 10, avgPrice: 3000, targets: "5/15/30" });
  assert.deepEqual(own.targets, [5, 15, 30]);
  const set = evaluateSwing({ positions: [p], prices: new Map(), settings: { targetPct: 12 } });
  assert.deepEqual(set.settings.targets, [12, 20, 40], "older single-target setting carries over as T1");
});

test("swing: reopening an accidental sale restores the shares, the average and the plan", () => {
  const p = sanitizePosition({ symbol: "INFY", name: "Infosys", qty: 100, avgPrice: 1000, limit: "3L", addAmount: "2L", addBelow: 990, targets: "8,16,30" });
  const part = applySell(p, 40, 1100), all = applySell(p, 100, 1100);
  const back1 = reopenTrade([part.position], part.trade); assert.equal(back1.length, 1); assert.equal(back1[0].qty, 100); assert.equal(back1[0].avgPrice, 1000);
  const back2 = reopenTrade([], all.trade)[0];
  assert.deepEqual([back2.qty, back2.avgPrice, back2.limit, back2.addAmount, back2.addBelow, back2.targets, back2.name], [100, 1000, 300000, 200000, 990, [8, 16, 30], "Infosys"]);
  const moved = applyBuy(part.position, 10, 1200); const back3 = reopenTrade([moved], part.trade)[0];
  assert.equal(back3.qty, 110); assert.equal(back3.avgPrice, Math.round((70 * moved.avgPrice + 40 * 1000) / 110 * 100) / 100, "merged with what is held now");
  assert.equal(reopenTrade([], { symbol: "X", qty: 5, buyAvg: 10 })[0].exchange, "NSE", "older trades without a saved plan still reopen");
});

test("swing booking plan: shares to sell at each target, 'riding' after booking, next alert at T2", () => {
  assert.deepEqual(parseBookPlan("33, 33, 34"), [33, 33, 34]); assert.deepEqual(parseBookPlan("50/50"), [50, 50]); assert.equal(parseBookPlan(""), null);
  assert.throws(() => parseBookPlan("60, 60")); assert.throws(() => parseBookPlan("10,10,10,10"));
  assert.deepEqual(planShares(21, [33, 33, 34], 3), [7, 14, 21]); assert.deepEqual(planShares(21, [25, 25], 3), [5, 11, 11], "a runner is kept");
  const p = sanitizePosition({ symbol: "HERO", qty: 21, avgPrice: 1000 });
  const at = (pos, price) => evaluateSwing({ positions: [pos], prices: new Map([["HERO", { price }]]) }).positions[0];
  const a = at(p, 1110);
  assert.equal(a.status, "take-profit"); assert.equal(a.sellNow, 7); assert.deepEqual(a.targets.map(t => t.sellQty), [7, 7, 7]); assert.match(a.note, /sell 7 of 21/);
  const s1 = applySell(p, 7, 1110, undefined, { atTarget: true }).position;
  assert.equal(s1.soldAtTargets, 7);
  const b = at(s1, 1120); assert.equal(b.status, "riding"); assert.equal(b.sellNow, 0); assert.ok(b.targets[0].done); assert.match(b.note, /Next T2: ₹1,200.*sell 7/);
  const c = at(s1, 1205); assert.equal(c.status, "take-profit"); assert.equal(c.sellNow, 7);
  const skipped = at(p, 1210); assert.equal(skipped.sellNow, 14, "T1 not booked: catch up at T2");
  const alerts1 = diffSwingAlerts({}, evaluateSwing({ positions: [s1], prices: new Map([["HERO", { price: 1120 }]]) }));
  assert.equal(alerts1.fresh.length, 0, "already booked T1: riding is not an alert");
  const alerts2 = diffSwingAlerts(alerts1.next, evaluateSwing({ positions: [s1], prices: new Map([["HERO", { price: 1205 }]]) }));
  assert.equal(alerts2.fresh.length, 1); assert.match(alerts2.fresh[0].title, /T2.*sell 7/);
  const more = applyBuy(s1, 6, 1100); assert.equal(more.soldAtTargets, 0, "buying more starts a new cycle");
  const own = sanitizePosition({ symbol: "HERO", qty: 20, avgPrice: 1000, bookPlan: "50,50" }); assert.equal(at(own, 1110).sellNow, 10);
});

test("swing lots: FIFO sale keeps buy dates, reopen puts them back, bought-on date sets the lot", () => {
  const p = sanitizePosition({ symbol: "INFY", qty: 10, avgPrice: 1000, boughtOn: "2025-01-10" });
  assert.equal(p.lots[0].at.slice(0, 10), "2025-01-10");
  assert.throws(() => sanitizePosition({ symbol: "INFY", qty: 10, avgPrice: 1000, boughtOn: "2999-01-01" }));
  const p2 = applyBuy(p, 10, 1200, "2026-06-01T10:00:00.000Z");
  assert.deepEqual(lotsOf(p2).map(l => [l.qty, l.price]), [[10, 1000], [10, 1200]]);
  const s = applySell(p2, 15, 1300, "2026-07-01T10:00:00.000Z");
  assert.deepEqual(s.trade.lots.map(l => [l.qty, l.price, l.at.slice(0, 10)]), [[10, 1000, "2025-01-10"], [5, 1200, "2026-06-01"]]);
  assert.deepEqual(lotsOf(s.position).map(l => [l.qty, l.price]), [[5, 1200]]);
  const back = reopenTrade([s.position], s.trade)[0];
  assert.deepEqual(lotsOf(back).map(l => [l.qty, l.price]), [[10, 1000], [5, 1200], [5, 1200]]); assert.equal(back.qty, 20);
  const tx = swingTaxRows([s.trade]);
  assert.deepEqual(tx.rows.map(r => [r.qty, r.term, r.gain, r.fy]), [[10, "LTCG", 3000, "FY 2026-27"], [5, "STCG", 500, "FY 2026-27"]]);
  assert.deepEqual([tx.years[0].ltGain, tx.years[0].stGain, tx.years[0].tax], [3000, 500, 100], "LTCG under the ₹1.25L exemption; 20% STCG on ₹500");
  const same = sanitizePosition({ symbol: "INFY", qty: 20, avgPrice: p2.avgPrice }, p2); assert.equal(same.lots.length, 2, "editing other fields keeps the lots");
});

test("swing cash pool and scorecard", () => {
  const st = { cash: { balance: 500000, log: [] } };
  moveCash(st, -210000, "Bought"); moveCash(st, 120000, "Sold"); assert.equal(st.cash.balance, 410000); assert.equal(st.cash.log.length, 2);
  const none = {}; moveCash(none, 1000, "x"); assert.equal(none.cash, undefined, "not tracked: nothing happens");
  const p = sanitizePosition({ symbol: "A", qty: 10, avgPrice: 100, addBelow: 95, addAmount: "1L" });
  const v = evaluateSwing({ positions: [p], prices: new Map([["A", { price: 90 }]]), cash: 40000 });
  assert.equal(v.totals.cash, 40000); assert.equal(v.totals.deployNow, 100000); assert.equal(v.totals.cashShort, 60000, "₹1L signal, ₹40k cash");
  const mk = (pnl, pnlPct, days, atTarget = false) => ({ symbol: "X" + pnl, name: "X", qty: 1, pnl, pnlPct, atTarget, openedAt: new Date(Date.parse("2026-09-01") - days * 864e5).toISOString(), closedAt: "2026-09-01T10:00:00.000Z" });
  const sc = scorecard([mk(3000, 10, 20, true), mk(1000, 5, 10), mk(-1000, -4, 30)]);
  assert.deepEqual([sc.trades, sc.wins, sc.losses, sc.winRate, sc.avgWin, sc.avgLoss, sc.profitFactor, sc.avgHoldDays, sc.atTargets, sc.total], [3, 2, 1, 66.67, 2000, -1000, 4, 20, 1, 3000]);
  assert.equal(sc.best.pnl, 3000); assert.equal(sc.worst.pnl, -1000);
  assert.equal(scorecard([]).trades, 0);
});

test("xlsx export is a valid zip with the sheets", () => {
  const buf = buildXlsx([{ name: "Trades", columns: [{ header: "Stock", key: "s" }, { header: "Gain", key: "g", type: "money" }, { header: "Date", key: "d", type: "date" }], rows: [{ s: "M&M <x>", g: 1234.5, d: "2026-10-01" }], totals: { s: "Total", g: 1234.5 } }, { name: "Two", columns: [{ header: "A", key: "a" }], rows: [] }]);
  assert.equal(buf.readUInt32LE(0), 0x04034b50); assert.equal(buf.readUInt32LE(buf.length - 22), 0x06054b50); assert.equal(buf.readUInt16LE(buf.length - 12), 7, "7 parts");
});

test("telegram: finds the chat, formats and sends only wanted alerts", async () => {
  const calls = [], token = "123456789:AAH" + "x".repeat(32);
  const fake = async (url, opt) => { calls.push([url.split("/").pop(), JSON.parse(opt.body)]); const m = url.split("/").pop(); return { status: 200, json: async () => (m === "getUpdates" ? { ok: true, result: [{ message: { chat: { id: 42, first_name: "Nishanth" } } }] } : { ok: true, result: {} }) }; };
  assert.ok(validToken(token)); assert.ok(!validToken("nope"));
  assert.deepEqual(await findChat(token, fake), { chatId: "42", label: "Nishanth" });
  const ev = [{ type: "swing-profit", title: "🎯 M&M hit T1 <b>", detail: "Plan: sell 7" }, { type: "buy-zone", title: "TCS in buy zone", detail: "" }];
  assert.equal(await pushAlerts({ telegram: { token, chatId: "42", enabled: true, scope: "swing" } }, ev, { fetchImpl: fake }), 1);
  assert.equal(calls.at(-1)[1].chat_id, "42"); assert.match(calls.at(-1)[1].text, /&lt;b&gt;/, "titles are escaped");
  assert.equal(await pushAlerts({ telegram: { token, chatId: "42", enabled: false } }, ev, { fetchImpl: fake }), 0);
  assert.match(formatAlert(ev[0], "https://x.example"), /#swing/);
});
