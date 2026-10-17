// Fetches fundamentals for one NSE stock from Yahoo Finance's unofficial endpoints (free, no API key)
// and derives the inputs the valuation model needs. Unofficial = can change or rate-limit without
// notice; every field that cannot be found is left out and the stock shows what is missing.
//   quoteSummary  -> price, P/E, P/B, ROE, 52W range, insider holding (proxy for promoter %)
//   timeseries    -> 4+ years of annual revenue / net income / EBIT / assets / debt / equity,
//                    from which we compute 3-yr CAGRs, ROCE and debt-vs-equity ourselves.
import { sanitizeEntry } from "./valuation.mjs";

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const CR = 1e7; // rupees -> crore
const TYPES = ["annualTotalRevenue", "annualNetIncome", "annualEBIT", "annualTotalAssets", "annualCurrentLiabilities", "annualTotalDebt", "annualStockholdersEquity", "annualOperatingCashFlow", "annualFreeCashFlow", "annualInventory", "annualAccountsReceivable"];
const raw = v => (v && typeof v === "object" ? v.raw : v);
const fin = v => { const x = Number(raw(v)); return Number.isFinite(x) ? x : null; };

// ---- Session (cookie + crumb), rate-limit cooldown ---------------------------------------------
// Yahoo throttles by IP. Hammering it after a 429 only extends the block, so after a throttle we
// stop calling Yahoo entirely for a cooldown period and fail fast with a clear message.
export const config = { strategyDelayMs: 1000, cooldownMs: 10 * 60 * 1000, maxCooldownMs: 30 * 60 * 1000 };
export class YahooRateLimit extends Error {
  constructor(until) { super(`Yahoo is rate-limiting this connection. Pausing Yahoo requests until ${new Date(until).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })} IST; stocks already fetched are kept. Try again then.`); this.rateLimited = true; this.until = until; }
}
let session = null; // { cookie, crumb, at }
let cooldownUntil = 0;
export function resetSession() { session = null; cooldownUntil = 0; }
export function yahooCooldown(now = Date.now()) { return cooldownUntil > now ? cooldownUntil : 0; }
function startCooldown(ms) { cooldownUntil = Date.now() + Math.min(Math.max(ms || 0, config.cooldownMs), config.maxCooldownMs); session = null; return new YahooRateLimit(cooldownUntil); }
const sleep = ms => (ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve());
const HEADERS = { "User-Agent": UA, Accept: "*/*", "Accept-Language": "en-US,en;q=0.9" };
const retryAfterMs = res => { const v = Number(res?.headers?.get?.("retry-after")); return Number.isFinite(v) && v > 0 ? v * 1000 : 0; };

// Several ways to obtain a crumb; Yahoo throttles them independently, so try the next if one is throttled.
const STRATEGIES = [
  { cookieUrl: "https://fc.yahoo.com", crumbUrl: "https://query1.finance.yahoo.com/v1/test/getcrumb" },
  { cookieUrl: "https://fc.yahoo.com", crumbUrl: "https://query2.finance.yahoo.com/v1/test/getcrumb" },
  { cookieUrl: "https://finance.yahoo.com/", crumbUrl: "https://query2.finance.yahoo.com/v1/test/getcrumb" }
];
async function getSession(f) {
  const cd = yahooCooldown(); if (cd) throw new YahooRateLimit(cd);
  if (session && Date.now() - session.at < 30 * 60 * 1000) return session;
  let throttled = 0, wait = 0, lastError = "no session cookie";
  for (let i = 0; i < STRATEGIES.length; i++) {
    if (i > 0) await sleep(config.strategyDelayMs);
    const st = STRATEGIES[i];
    try {
      const r1 = await f(st.cookieUrl, { redirect: "manual", headers: HEADERS });
      if (r1.status === 429) { throttled++; wait = Math.max(wait, retryAfterMs(r1)); continue; }
      const cookie = (r1.headers?.getSetCookie?.() || []).map(c => c.split(";")[0]).join("; ");
      if (!cookie) { lastError = "Yahoo did not issue a session cookie"; continue; }
      const r2 = await f(st.crumbUrl, { headers: { ...HEADERS, cookie } });
      if (r2.status === 429) { throttled++; wait = Math.max(wait, retryAfterMs(r2)); continue; }
      const crumb = (await r2.text()).trim();
      if (!r2.ok || !crumb || crumb.length > 40 || /[<\s]/.test(crumb)) { lastError = `crumb request failed (HTTP ${r2.status})`; continue; }
      return (session = { cookie, crumb, at: Date.now() });
    } catch (error) { lastError = error.message; }
  }
  if (throttled > 0) throw startCooldown(wait);
  throw new Error(`Could not start a Yahoo session (${lastError}).`);
}
async function yget(f, url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const s = await getSession(f);
    const res = await f(`${url}${url.includes("?") ? "&" : "?"}crumb=${encodeURIComponent(s.crumb)}`, { headers: { ...HEADERS, cookie: s.cookie } });
    if (res.status === 401 || res.status === 403) { session = null; continue; }
    if (res.status === 404) throw new Error("Symbol not found on Yahoo (check the NSE symbol).");
    if (res.status === 429) throw startCooldown(retryAfterMs(res));
    if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
    return res.json();
  }
  throw new Error("Yahoo rejected the session twice (blocked?).");
}

function series(result, type) {
  const block = (result || []).find(r => r.meta?.type?.[0] === type);
  return (block?.[type] || []).filter(p => p && fin(p.reportedValue) !== null).map(p => ({ date: p.asOfDate, v: fin(p.reportedValue) })).sort((a, b) => a.date.localeCompare(b.date));
}
const latest = s => (s.length ? s.at(-1).v : null);
function cagr3(s) {
  if (s.length < 4) return null;
  const a = s.at(-4).v, b = s.at(-1).v;
  return a > 0 && b > 0 ? Number(((Math.pow(b / a, 1 / 3) - 1) * 100).toFixed(1)) : null;
}
export function detectProfile(sector, industry) {
  const ind = String(industry || ""), sec = String(sector || "");
  if (/^Banks|Credit Services|Mortgage Finance/i.test(ind)) return "financial";
  if (/Basic Materials|Energy/i.test(sec) || /Steel|Copper|Aluminum|Coal|Oil & Gas|Gold|Mining|Shipping|Marine|Airlines|Communication Equipment|Semiconductor|Metal|Chemicals/i.test(ind)) return "cyclical";
  return "default";
}
const tokens = s => String(s || "").toLowerCase().replace(/\b(ltd|limited|india|the|and|technologies|technology|industries|company|corp|enterprise|enterprises)\b/g, " ").split(/[^a-z0-9]+/).filter(t => t.length > 2);

// Pure: turns the two Yahoo payloads into a fundamentals entry + warnings. Exported for tests.
export function buildEntry(stock, summary, timeseriesResult) {
  const warnings = [];
  const sd = summary?.summaryDetail || {}, ks = summary?.defaultKeyStatistics || {}, fd = summary?.financialData || {}, pr = summary?.price || {};
  const price = fin(pr.regularMarketPrice) ?? fin(sd.previousClose);
  if (!price) throw new Error("Yahoo returned no price for this symbol.");
  let pe = fin(sd.trailingPE);
  const eps = fin(ks.trailingEps);
  if (pe === null && eps !== null && eps > 0) pe = Number((price / eps).toFixed(2));
  if (pe === null) warnings.push(eps !== null && eps <= 0 ? "Loss-making (negative EPS): no P/E" : "P/E unavailable on Yahoo");

  const rev = series(timeseriesResult, "annualTotalRevenue"), ni = series(timeseriesResult, "annualNetIncome"), ebit = series(timeseriesResult, "annualEBIT");
  const assets = series(timeseriesResult, "annualTotalAssets"), cl = series(timeseriesResult, "annualCurrentLiabilities");
  const debt = series(timeseriesResult, "annualTotalDebt"), eq = series(timeseriesResult, "annualStockholdersEquity");
  const salesCagr3 = cagr3(rev), profitCagr3 = cagr3(ni);
  if (salesCagr3 === null) warnings.push("3-yr sales CAGR unavailable (fewer than 4 years or non-positive base)");
  if (profitCagr3 === null) warnings.push("3-yr profit CAGR unavailable (fewer than 4 years or non-positive base/latest)");
  let roce = null;
  const e = latest(ebit), ta = latest(assets), c = latest(cl);
  if (e !== null && ta !== null && c !== null && ta - c > 0) roce = Number(((e / (ta - c)) * 100).toFixed(1)); else warnings.push("ROCE could not be derived (EBIT/assets/current liabilities missing)");
  const borrowings = latest(debt) !== null ? Number((latest(debt) / CR).toFixed(0)) : null, reserves = latest(eq) !== null ? Number((latest(eq) / CR).toFixed(0)) : null;
  const roeRaw = fin(fd.returnOnEquity), insiders = fin(ks.heldPercentInsiders);

  // Cash-flow / working-capital / stability extras (all optional)
  const cfo = series(timeseriesResult, "annualOperatingCashFlow"), fcf = series(timeseriesResult, "annualFreeCashFlow");
  const inv = series(timeseriesResult, "annualInventory"), ar = series(timeseriesResult, "annualAccountsReceivable");
  const sum = (a, n) => a.slice(-n).reduce((x, y) => x + y.v, 0);
  const niSum3 = ni.length >= 3 ? sum(ni, 3) : null;
  const cfoToProfit3 = cfo.length >= 3 && niSum3 && niSum3 > 0 ? Number((sum(cfo, 3) / niSum3).toFixed(2)) : null;
  const fcfNegative = fcf.length >= 3 ? (latest(fcf) < 0 && sum(fcf, 3) < 0 ? 1 : 0) : null;
  const salesNow = latest(rev);
  const debtorDays = salesNow && salesNow > 0 && latest(ar) !== null ? Math.round((latest(ar) / salesNow) * 365) : null;
  const inventoryDays = salesNow && salesNow > 0 && latest(inv) !== null ? Math.round((latest(inv) / salesNow) * 365) : null;
  const niLatest = latest(ni) !== null ? Number((latest(ni) / CR).toFixed(0)) : null;
  const niAvg4 = ni.length >= 4 ? Number((ni.slice(-4).reduce((x, y) => x + y.v, 0) / 4 / CR).toFixed(0)) : null;
  const ap = summary?.assetProfile || {};
  const profile = detectProfile(ap.sector, ap.industry);

  const have = [pe !== null, salesCagr3 !== null || profitCagr3 !== null, roce !== null, reserves !== null].filter(Boolean).length;
  if (have < 2) throw new Error(`Yahoo returned too little data (${warnings.join("; ") || "no fundamentals"})`);
  const want = tokens(stock.company), got = new Set(tokens(pr.longName || pr.shortName));
  if (want.length && got.size && !want.some(t => got.has(t) || [...got].some(g => g.startsWith(t) || t.startsWith(g)))) warnings.push(`Yahoo lists this symbol as "${pr.longName || pr.shortName}", not "${stock.company}" - wrong ticker mapping?`);
  if (Number.isFinite(stock.price) && stock.price > 0 && Math.abs(price / stock.price - 1) > 0.2) warnings.push(`Yahoo price ${price} differs >20% from watchlist price ${stock.price}`);
  const entry = {
    sector: ap.sector || undefined, industry: ap.industry || undefined, profile, cfoToProfit3: cfoToProfit3 ?? undefined, fcfNegative: fcfNegative ?? undefined, debtorDays: debtorDays ?? undefined, inventoryDays: inventoryDays ?? undefined, niLatest: niLatest ?? undefined, niAvg4: niAvg4 ?? undefined,
    marketCap: fin(pr.marketCap) ? Math.round(fin(pr.marketCap) / 1e7) : undefined,
    symbol: (stock.marketSymbol || stock.ticker || "").toUpperCase(), companyName: pr.longName || pr.shortName || undefined, price,
    priceDate: new Date().toISOString().slice(0, 10), high52: fin(sd.fiftyTwoWeekHigh) ?? undefined, low52: fin(sd.fiftyTwoWeekLow) ?? undefined,
    pe: pe ?? undefined, pb: fin(ks.priceToBook) ?? undefined, roce: roce ?? undefined, roe: roeRaw !== null ? Number((roeRaw * 100).toFixed(1)) : undefined,
    promoter: insiders !== null ? Number((insiders * 100).toFixed(1)) : undefined, salesCagr3: salesCagr3 ?? undefined, profitCagr3: profitCagr3 ?? undefined,
    borrowings: borrowings ?? undefined, reserves: reserves ?? undefined,
    flags: [...warnings.map(w => (/ticker|differs|Loss-making/.test(w) ? `CHECK: ${w}` : w)), ...(insiders !== null ? ["Promoter % = Yahoo insider holding (approx)"] : [])].join(" | ").slice(0, 300),
    source: "Yahoo Finance (unofficial API); ROCE/CAGRs derived from annual statements", asOf: new Date().toISOString().slice(0, 10)
  };
  return { entry: sanitizeEntry(Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== undefined))), warnings, completeness: `${have}/4` };
}

export async function fetchFundamentalsForStock(stock, { fetchImpl = fetch } = {}) {
  const symbol = (stock.marketSymbol || stock.ticker || "").toUpperCase();
  if (!/^[A-Z0-9&-]+$/.test(symbol)) throw new Error("No confirmed NSE symbol for this stock.");
  const ysym = encodeURIComponent(`${symbol}.${stock.exchange === "BSE" ? "BO" : "NS"}`);
  const modules = "price,summaryDetail,defaultKeyStatistics,financialData,assetProfile";
  const summaryJson = await yget(fetchImpl, `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ysym}?modules=${modules}`);
  const summary = summaryJson?.quoteSummary?.result?.[0];
  if (!summary) throw new Error(summaryJson?.quoteSummary?.error?.description || "Yahoo returned no data for this symbol.");
  const p2 = Math.floor(Date.now() / 1000), p1 = p2 - 6 * 365 * 86400;
  let ts = [];
  try {
    const tj = await yget(fetchImpl, `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${ysym}?type=${TYPES.join(",")}&merge=false&padTimeSeries=false&period1=${p1}&period2=${p2}`);
    ts = tj?.timeseries?.result || [];
  } catch (error) { if (error.rateLimited) throw error; }
  if (process.env.YAHOO_DEBUG) console.log(`[yahoo] ${symbol}: summary modules=${Object.keys(summary).join(",")}; timeseries types=${ts.map(r => r.meta?.type?.[0]).join(",")}`);
  return buildEntry(stock, summary, ts);
}

// Batch quotes (price, day change, volume, average volume, 52-week range) for many symbols at once, via the same session and
// cooldown as the fundamentals calls. items: [{ symbol, exchange }]. Returns Map(symbol -> quote).
export async function yahooQuotes(items, { fetchImpl = fetch } = {}) {
  const out = new Map(), list = items.filter(i => /^[A-Z0-9&-]{1,20}$/.test(i.symbol));
  for (let i = 0; i < list.length; i += 40) {
    const batch = list.slice(i, i + 40), ys = batch.map(b => `${b.symbol}.${b.exchange === "BSE" ? "BO" : "NS"}`);
    const j = await yget(fetchImpl, `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ys.join(","))}`);
    for (const q of j?.quoteResponse?.result || []) {
      const sym = String(q.symbol || "").replace(/\.(NS|BO)$/, "");
      out.set(sym, { symbol: sym, name: q.longName || q.shortName || sym, price: fin(q.regularMarketPrice), pChange: fin(q.regularMarketChangePercent), volume: fin(q.regularMarketVolume), avgVolume: fin(q.averageDailyVolume10Day) ?? fin(q.averageDailyVolume3Month), high52: fin(q.fiftyTwoWeekHigh), low52: fin(q.fiftyTwoWeekLow), time: q.regularMarketTime ? new Date(q.regularMarketTime * 1000).toISOString() : null });
    }
  }
  return out;
}

// quoteSummary modules for one stock (calendar events: results date, ex-dividend date)
export async function yahooSummary(symbol, modules, { exchange = "NSE", fetchImpl = fetch } = {}) {
  const ysym = `${symbol}${exchange === "BSE" ? ".BO" : ".NS"}`;
  return yget(fetchImpl, `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ysym)}?modules=${modules.join(",")}`);
}
