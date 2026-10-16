import test from "node:test";
import assert from "node:assert/strict";
import { buildEntry, fetchFundamentalsForStock, resetSession, detectProfile, yahooCooldown, config, YahooRateLimit } from "../fundamentals-yahoo.mjs";
config.strategyDelayMs = 0;
import { parseNseQuote, mergeNse, fetchNseQuote, resetNse, refreshFromNse, nseCooldown, NseBlocked } from "../nse.mjs";
import { computeValuation } from "../valuation.mjs";

const R = v => ({ raw: v });
const summary = (o = {}) => ({ price: { regularMarketPrice: R(216.5), longName: "BLS International Services Limited" }, summaryDetail: { trailingPE: R(12.6), fiftyTwoWeekHigh: R(359), fiftyTwoWeekLow: R(212) }, defaultKeyStatistics: { priceToBook: R(3.6), trailingEps: R(17.2), heldPercentInsiders: R(0.704) }, financialData: { returnOnEquity: R(0.321) }, assetProfile: { sector: "Industrials", industry: "Specialty Business Services" }, ...o });
const pts = vals => vals.map((v, i) => ({ asOfDate: `${2022 + i}-03-31`, reportedValue: R(v) }));
const ts = (t, vals) => ({ meta: { type: [t] }, [t]: pts(vals) });
const series = [ts("annualTotalRevenue", [1.0e10, 1.4e10, 1.9e10, 2.5e10]), ts("annualNetIncome", [1.0e9, 2.0e9, 4.0e9, 7.2e9]), ts("annualEBIT", [1.5e9, 3e9, 5e9, 9e9]), ts("annualTotalAssets", [1e10, 1.4e10, 2e10, 3e10]), ts("annualCurrentLiabilities", [3e9, 4e9, 6e9, 9e9]), ts("annualTotalDebt", [1e9, 2e9, 3e9, 4.31e9]), ts("annualStockholdersEquity", [8e9, 1.2e10, 1.8e10, 2.42e10]), ts("annualOperatingCashFlow", [5e8, 1.5e9, 3e9, 5e9]), ts("annualFreeCashFlow", [3e8, 1e9, 2e9, 4e9]), ts("annualInventory", [1e8, 1e8, 1e8, 1e8]), ts("annualAccountsReceivable", [2e9, 3e9, 4e9, 5e9])];
const stock = { id: 92, company: "BLS International", marketSymbol: "BLS", price: 216.5 };

test("buildEntry derives growth, ROCE, leverage and cash-flow fields", () => {
  const { entry, completeness } = buildEntry(stock, summary(), series);
  assert.equal(entry.pe, 12.6); assert.equal(entry.pb, 3.6); assert.equal(entry.roe, 32.1); assert.equal(entry.promoter, 70.4);
  assert.equal(entry.roce, 42.9); assert.equal(entry.salesCagr3, 35.7); assert.equal(entry.borrowings, 431); assert.equal(entry.reserves, 2420);
  assert.equal(entry.cfoToProfit3, 0.72); assert.equal(entry.fcfNegative, 0); assert.equal(entry.debtorDays, 73); assert.equal(entry.profile, "default"); assert.equal(entry.sector, "Industrials");
  assert.equal(entry.niLatest, 720); assert.equal(entry.niAvg4, 355); assert.equal(completeness, "4/4");
});
test("P/E falls back to price/EPS; negative EPS is flagged loss-making", () => {
  assert.equal(buildEntry(stock, summary({ summaryDetail: {} }), series).entry.pe, 12.59);
  const loss = buildEntry(stock, summary({ summaryDetail: {}, defaultKeyStatistics: { trailingEps: R(-3) } }), series);
  assert.equal(loss.entry.pe, undefined); assert.match(loss.entry.flags, /CHECK: Loss-making/);
});
test("too little data is an error; wrong company / price mismatch are flagged", () => {
  assert.throws(() => buildEntry(stock, summary({ summaryDetail: {}, defaultKeyStatistics: {} }), []), /too little data/);
  const w = buildEntry({ ...stock, company: "Apollo", price: 5000 }, summary(), series).warnings.join("|");
  assert.match(w, /wrong ticker mapping/); assert.match(w, /differs >20%/);
});
test("profile detection", () => {
  assert.equal(detectProfile("Financial Services", "Banks - Regional"), "financial");
  assert.equal(detectProfile("Financial Services", "Credit Services"), "financial");
  assert.equal(detectProfile("Financial Services", "Capital Markets"), "default");
  assert.equal(detectProfile("Basic Materials", "Copper"), "cyclical");
  assert.equal(detectProfile("Consumer Cyclical", "Luxury Goods"), "default");
});
test("session: cookie -> crumb, one retry on 401, crumb reused", async () => {
  resetSession(); let first401 = true; const hits = [];
  const f = async (url) => {
    hits.push(url.replace(/\?.*/, ""));
    if (url.startsWith("https://fc.yahoo.com")) return { ok: false, status: 404, headers: { getSetCookie: () => ["A3=abc; Path=/"] } };
    if (url.includes("getcrumb")) return { ok: true, status: 200, text: async () => "CRUMB" };
    if (url.includes("quoteSummary")) { if (first401) { first401 = false; return { ok: false, status: 401 }; } return { ok: true, status: 200, json: async () => ({ quoteSummary: { result: [summary()] } }) }; }
    if (url.includes("timeseries")) return { ok: true, status: 200, json: async () => ({ timeseries: { result: series } }) };
    return { ok: false, status: 500 };
  };
  const r = await fetchFundamentalsForStock(stock, { fetchImpl: f });
  assert.equal(r.entry.symbol, "BLS"); assert.equal(hits.filter(h => h.includes("getcrumb")).length, 2);
});
test("404 and 429 give readable errors", async () => {
  for (const [code, re] of [[404, /not found/], [429, /rate-limiting/]]) {
    resetSession();
    const f = async u => u.startsWith("https://fc") ? { status: 404, headers: { getSetCookie: () => ["A3=a"] } } : u.includes("getcrumb") ? { ok: true, status: 200, text: async () => "C" } : { ok: false, status: code };
    await assert.rejects(fetchFundamentalsForStock(stock, { fetchImpl: f }), re);
  }
});
test("NSE: parse, merge into Yahoo entry, and NSE-only fallback", async () => {
  const q = parseNseQuote({ metadata: { pdSymbolPe: "14.2", pdSectorPe: "22.5", pdSectorInd: "NIFTY PHARMA" }, priceInfo: { lastPrice: 821.3, weekHighLow: { min: 786, max: 1217 } }, industryInfo: { basicIndustry: "Pharmaceuticals" } });
  assert.deepEqual([q.pe, q.sectorPe, q.high52, q.low52], [14.2, 22.5, 1217, 786]);
  const merged = mergeNse({ symbol: "NATCOPHARM", price: 821, flags: "" }, q, { marketSymbol: "NATCOPHARM" });
  assert.equal(merged.sectorPe, 22.5); assert.equal(merged.pe, 14.2); assert.match(merged.flags, /P\/E from NSE/);
  const only = mergeNse(null, q, { marketSymbol: "NATCOPHARM" });
  assert.equal(only.pe, 14.2); assert.match(only.source, /NSE/);
  assert.equal(mergeNse(null, null, {}), null);
  resetNse();
  const f = async u => u === "https://www.nseindia.com" ? { ok: true, headers: { getSetCookie: () => ["nsit=1; Path=/"] } } : { ok: true, status: 200, json: async () => ({ metadata: { pdSectorPe: 30 }, priceInfo: {} }) };
  assert.equal((await fetchNseQuote("X", f)).sectorPe, 30);
  resetNse();
  await assert.rejects(fetchNseQuote("X", async u => u === "https://www.nseindia.com" ? { ok: true, headers: { getSetCookie: () => ["a=1"] } } : { ok: false, status: 403 }), e => e instanceof NseBlocked && /blocking/.test(e.message));
  assert.ok(nseCooldown() > Date.now());
  resetNse(); assert.equal(nseCooldown(), 0);
});

test("refreshFromNse keeps cached statements and refreshes market fields; thin entries valued low-confidence", () => {
  const cached = { symbol: "BLS", price: 100, pe: 20, sectorPe: 18, roce: 25, salesCagr3: 20, profitCagr3: 22, flags: "" };
  const r = refreshFromNse(cached, { price: 120, pe: 24, sectorPe: 30, high52: 150, low52: 90 });
  assert.equal(r.price, 120); assert.equal(r.sectorPe, 30); assert.equal(r.roce, 25); assert.ok(r.nseRefreshedAt); assert.match(r.flags, /NSE/);
  assert.equal(refreshFromNse(null, { price: 1 }), null);
  const thin = mergeNse(null, { price: 100, pe: 20, sectorPe: 25, high52: 130, low52: 80 }, { marketSymbol: "X" });
  assert.equal(thin.thin, 1);
  const v = computeValuation({ company: "X", marketSymbol: "X", price: 100 }, { ...thin, symbol: "X" });
  assert.equal(v.confidence, "low"); assert.ok(v.fairMultiple > 0);
});

test("crumb 429 on every strategy -> cooldown, then later stocks fail fast with no network calls", async () => {
  resetSession(); let calls = 0;
  const throttled = async u => { calls++; return u.includes("getcrumb") ? { ok: false, status: 429, text: async () => "Too Many Requests", headers: { get: () => null } } : { status: 404, headers: { getSetCookie: () => ["A3=a"], get: () => null } }; };
  await assert.rejects(fetchFundamentalsForStock(stock, { fetchImpl: throttled }), e => e instanceof YahooRateLimit && e.rateLimited && /rate-limiting/.test(e.message));
  assert.ok(yahooCooldown() > Date.now()); const used = calls; assert.ok(used >= 3, "tried every crumb strategy");
  await assert.rejects(fetchFundamentalsForStock(stock, { fetchImpl: throttled }), e => e.rateLimited);
  assert.equal(calls, used, "no network calls during cooldown");
  resetSession(); assert.equal(yahooCooldown(), 0);
});
test("falls back to the next crumb strategy when the first is throttled", async () => {
  resetSession(); const crumbHosts = [];
  const f = async (u) => {
    if (u.startsWith("https://fc.yahoo.com") || u.startsWith("https://finance.yahoo.com/")) return { ok: false, status: 404, headers: { getSetCookie: () => ["A3=a"], get: () => null } };
    if (u.includes("getcrumb")) { crumbHosts.push(new URL(u).host); return u.includes("query1") ? { ok: false, status: 429, text: async () => "", headers: { get: () => null } } : { ok: true, status: 200, text: async () => "CRUMB" }; }
    if (u.includes("quoteSummary")) return { ok: true, status: 200, json: async () => ({ quoteSummary: { result: [summary()] } }) };
    return { ok: true, status: 200, json: async () => ({ timeseries: { result: series } }) };
  };
  const r = await fetchFundamentalsForStock(stock, { fetchImpl: f });
  assert.equal(r.entry.symbol, "BLS"); assert.deepEqual(crumbHosts, ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]); assert.equal(yahooCooldown(), 0);
});
test("a 429 on the data request starts a cooldown and honours Retry-After (capped)", async () => {
  resetSession();
  const f = async u => u.startsWith("https://fc") ? { status: 404, headers: { getSetCookie: () => ["A3=a"] } } : u.includes("getcrumb") ? { ok: true, status: 200, text: async () => "C" } : { ok: false, status: 429, headers: { get: () => "1200" } };
  await assert.rejects(fetchFundamentalsForStock(stock, { fetchImpl: f }), e => e.rateLimited);
  const mins = (yahooCooldown() - Date.now()) / 60000; assert.ok(mins > 19 && mins <= 20.1, `cooldown ${mins} min`);
  resetSession();
});

test("NSE that never answers is paused after three silent failures, so prices move on to Yahoo", async () => {
  resetNse();
  const hang = async () => { const e = new Error("The operation was aborted due to timeout"); e.name = "TimeoutError"; throw e; };
  for (let k = 0; k < 2; k++) await assert.rejects(fetchNseQuote("INFY", hang), e => !(e instanceof NseBlocked));
  assert.equal(nseCooldown(), 0, "two failures: not paused yet");
  await assert.rejects(fetchNseQuote("INFY", hang), /pausing NSE requests/);
  assert.ok(nseCooldown() > Date.now(), "third failure pauses NSE");
  await assert.rejects(fetchNseQuote("INFY", hang), e => e instanceof NseBlocked); // no network call while paused
  resetNse();
  // a success in between resets the count
  const okF = async u => u === "https://www.nseindia.com" ? { ok: true, status: 200, headers: { getSetCookie: () => ["a=1"] } } : { ok: true, status: 200, json: async () => ({ priceInfo: { lastPrice: 1110 } }) };
  await assert.rejects(fetchNseQuote("INFY", hang)); await assert.rejects(fetchNseQuote("INFY", hang));
  assert.equal((await fetchNseQuote("INFY", okF)).price, 1110);
  await assert.rejects(fetchNseQuote("INFY", hang)); assert.equal(nseCooldown(), 0);
  resetNse();
});

test("NSE price history: rows parsed oldest first, bad rows dropped", async () => {
  const { parseNseHistory } = await import("../nse.mjs");
  const bars = parseNseHistory({ data: [
    { CH_TIMESTAMP: "2026-10-15", CH_CLOSING_PRICE: 41.2, CH_TRADE_HIGH_PRICE: 41.5, CH_TRADE_LOW_PRICE: 40.1 },
    { CH_TIMESTAMP: "2026-10-14", CH_CLOSING_PRICE: "40.9", CH_TRADE_HIGH_PRICE: 41, CH_TRADE_LOW_PRICE: 40.5 },
    { CH_TIMESTAMP: "bad", CH_CLOSING_PRICE: 1 }, { CH_TIMESTAMP: "2026-10-13", CH_CLOSING_PRICE: null }] });
  assert.equal(bars.length, 2);
  assert.deepEqual(bars.map(b => b.c), [40.9, 41.2]);
  assert.equal(bars[1].h, 41.5);
});
