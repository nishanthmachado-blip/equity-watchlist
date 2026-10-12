// US stocks: fundamentals from SEC EDGAR (official XBRL "company facts", free, no key), prices from Stooq with a
// Yahoo chart fallback, and a valuation built the same way as the Indian one: fair P/E from growth and quality, a
// two-stage free-cash-flow DCF, the growth the price already implies, and Value / Growth / Dividend / Quality tags.
const SEC_UA = () => process.env.SEC_USER_AGENT || "EquityWatchlist/3.2 (personal research app; set SEC_USER_AGENT to 'Name email')";
const fin = v => Number.isFinite(v);
const r1 = v => (fin(v) ? Math.round(v * 10) / 10 : null), r2 = v => (fin(v) ? Math.round(v * 100) / 100 : null);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const US_MODEL = { discount: 9, terminalGrowth: 3, years: 10, taxRate: 21, basePE: 10, pePerGrowth: 1.1, minPE: 8, maxPE: 35 };
// A starter universe: widely held US large caps across sectors.
export const US_POPULAR = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "AVGO", "TSLA", "JPM", "V", "MA", "UNH", "LLY", "JNJ", "PG", "KO", "PEP", "COST", "WMT", "HD", "XOM", "CVX", "ABBV", "MRK", "ORCL", "ADBE", "CRM", "NFLX", "AMD", "CSCO", "TXN", "QCOM", "MCD", "NKE", "DIS", "BAC", "PFE", "TMO", "INTU", "BRK-B"];
export const cleanUsSymbol = s => String(s || "").trim().toUpperCase().replace(/\./g, "-").replace(/[^A-Z0-9-]/g, "").slice(0, 10);

// ---- SEC ticker list: { "0": { cik_str, ticker, title } } ----
export function parseSecTickers(json) {
  return Object.values(json || {}).map(x => ({ symbol: cleanUsSymbol(x.ticker), cik: Number(x.cik_str), name: String(x.title || "") })).filter(x => x.symbol && x.cik);
}
export function searchTickers(list, q, limit = 10) {
  q = String(q || "").trim().toUpperCase(); if (!q) return [];
  const sym = cleanUsSymbol(q), out = [];
  for (const t of list) { const score = t.symbol === sym ? 0 : t.symbol.startsWith(sym) ? 1 : t.name.toUpperCase().startsWith(q) ? 2 : t.name.toUpperCase().includes(q) ? 3 : 9; if (score < 9) out.push([score, t]); }
  return out.sort((a, b) => a[0] - b[0] || a[1].symbol.length - b[1].symbol.length).slice(0, limit).map(x => x[1]);
}

// ---- SEC company facts → annual series ----
const CONCEPTS = {
  revenue: ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax", "RevenuesNetOfInterestExpense"],
  netIncome: ["NetIncomeLoss", "NetIncomeLossAvailableToCommonStockholdersBasic", "ProfitLoss"],
  eps: ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted", "EarningsPerShareBasic"],
  opIncome: ["OperatingIncomeLoss"],
  cfo: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"],
  capex: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
  dps: ["CommonStockDividendsPerShareDeclared", "CommonStockDividendsPerShareCashPaid"],
  dividendsPaid: ["PaymentsOfDividendsCommonStock", "PaymentsOfDividends"],
  equity: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
  debtLong: ["LongTermDebtNoncurrent", "LongTermDebt", "LongTermDebtAndCapitalLeaseObligations"],
  debtCurrent: ["LongTermDebtCurrent", "DebtCurrent"],
  cash: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"],
  dilutedShares: ["WeightedAverageNumberOfDilutedSharesOutstanding"]
};
const INSTANT = new Set(["equity", "debtLong", "debtCurrent", "cash"]);
const days = (a, b) => (new Date(b) - new Date(a)) / 864e5;
// Annual values per fiscal-year end from 10-K filings; for each year the earliest-priority concept that has it wins,
// and within a concept the latest filing wins (restatements).
function annual(facts, key) {
  const gaap = facts?.facts?.["us-gaap"] || {}, byEnd = new Map();
  for (const c of CONCEPTS[key]) {
    const units = gaap[c]?.units; if (!units) continue;
    const list = units.USD || units["USD/shares"] || units.shares || Object.values(units)[0] || [];
    const seen = new Map();
    for (const e of list) {
      if (!/^10-K/.test(e.form || "") || !fin(e.val) || !e.end) continue;
      if (!INSTANT.has(key)) { if (!e.start) continue; const d = days(e.start, e.end); if (d < 340 || d > 390) continue; }
      const prev = seen.get(e.end); if (!prev || String(e.filed) > String(prev.filed)) seen.set(e.end, e);
    }
    for (const [end, e] of seen) if (!byEnd.has(end)) byEnd.set(end, { end, fy: Number(end.slice(0, 4)), val: e.val, concept: c });
  }
  // Keep only fiscal-year ends (an instant fact can appear for many dates; flows already are annual).
  return [...byEnd.values()].sort((a, b) => a.end.localeCompare(b.end));
}
export function seriesFromFacts(facts) {
  const s = Object.fromEntries(Object.keys(CONCEPTS).map(k => [k, annual(facts, k)]));
  // Year ends = the fiscal years that have revenue or net income.
  const ends = [...new Set([...s.revenue, ...s.netIncome].map(x => x.end))].sort().slice(-8);
  const at = (k, end) => s[k].find(x => x.end === end)?.val ?? null;
  const near = (k, end) => { const x = s[k].filter(v => Math.abs(days(v.end, end)) <= 10).at(-1); return x ? x.val : null; };
  const years = ends.map(end => {
    const debt = (near("debtLong", end) || 0) + (near("debtCurrent", end) || 0);
    return { end, fy: Number(end.slice(0, 4)), revenue: at("revenue", end), netIncome: at("netIncome", end), eps: at("eps", end), opIncome: at("opIncome", end), cfo: at("cfo", end), capex: at("capex", end), dps: at("dps", end), dividendsPaid: at("dividendsPaid", end), equity: near("equity", end), debt: debt || null, cash: near("cash", end), dilutedShares: at("dilutedShares", end) };
  });
  const dei = facts?.facts?.dei || {};
  const so = (dei.EntityCommonStockSharesOutstanding?.units?.shares || []).filter(e => fin(e.val)).sort((a, b) => String(a.end).localeCompare(String(b.end)));
  // Several share classes report separate counts on the same date (e.g. GOOGL): add them up.
  const lastDate = so.at(-1)?.end, sharesOut = lastDate ? so.filter(e => e.end === lastDate).reduce((a, e) => a + e.val, 0) : null;
  return { name: facts?.entityName || null, cik: facts?.cik || null, years, sharesOutstanding: sharesOut || years.at(-1)?.dilutedShares || null };
}

const cagr = (a, b, n) => (fin(a) && fin(b) && a > 0 && b > 0 && n > 0 ? (Math.pow(b / a, 1 / n) - 1) * 100 : null);
// Present value per share of free cash flow: `g` for 5 years, fading to terminal growth by year 10, then a terminal value.
export function dcfPerShare(fcfPerShare, g, { discount = US_MODEL.discount, terminal = US_MODEL.terminalGrowth, years = US_MODEL.years } = {}) {
  if (!fin(fcfPerShare) || fcfPerShare <= 0) return null;
  const d = discount / 100, t = terminal / 100; let cf = fcfPerShare, pv = 0;
  for (let y = 1; y <= years; y++) { const gy = y <= 5 ? g / 100 : (g / 100) + ((t - g / 100) * (y - 5) / (years - 5)); cf *= 1 + gy; pv += cf / Math.pow(1 + d, y); }
  pv += cf * (1 + t) / (d - t) / Math.pow(1 + d, years);
  return pv;
}
export function impliedGrowth(price, fcfPerShare, opts) {
  if (!fin(price) || !fin(fcfPerShare) || fcfPerShare <= 0) return null;
  let lo = -20, hi = 60; if (dcfPerShare(fcfPerShare, hi, opts) < price) return null; if (dcfPerShare(fcfPerShare, lo, opts) > price) return lo;
  for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (dcfPerShare(fcfPerShare, m, opts) >= price) hi = m; else lo = m; }
  return r1(hi);
}

export function usValuation(series, price, { growth: growthOverride = null } = {}) {
  const ys = series.years.filter(y => fin(y.revenue) || fin(y.netIncome)); const L = ys.at(-1);
  if (!L) return { error: "No annual (10-K) figures in SEC filings. Foreign companies filing 20-F are not covered." };
  const n = Math.min(3, ys.length - 1), B = ys[ys.length - 1 - n];
  const shares = series.sharesOutstanding || L.dilutedShares;
  const eps = fin(L.eps) ? L.eps : fin(L.netIncome) && shares ? L.netIncome / shares : null;
  const revG = n > 0 ? cagr(B.revenue, L.revenue, n) : null, epsG = n > 0 ? cagr(B.eps ?? (B.netIncome / (B.dilutedShares || shares)), eps, n) : null;
  const fcf = fin(L.cfo) ? L.cfo - (L.capex || 0) : null, fcfPs = fin(fcf) && shares ? fcf / shares : null;
  const avgEq = fin(L.equity) ? (fin(ys.at(-2)?.equity) ? (L.equity + ys.at(-2).equity) / 2 : L.equity) : null;
  const roe = fin(L.netIncome) && avgEq > 0 ? L.netIncome / avgEq * 100 : null;
  const invested = (L.equity || 0) + (L.debt || 0) - (L.cash || 0);
  const roic = fin(L.opIncome) && invested > 0 ? L.opIncome * (1 - US_MODEL.taxRate / 100) / invested * 100 : null;
  const netMargin = fin(L.netIncome) && L.revenue > 0 ? L.netIncome / L.revenue * 100 : null, opMargin = fin(L.opIncome) && L.revenue > 0 ? L.opIncome / L.revenue * 100 : null;
  const de = fin(L.debt) && L.equity > 0 ? L.debt / L.equity : null;
  const fcfConv = fin(fcf) && L.netIncome > 0 ? fcf / L.netIncome : null;
  const dps = fin(L.dps) ? L.dps : fin(L.dividendsPaid) && shares ? L.dividendsPaid / shares : null;
  const divYield = fin(dps) && price > 0 ? dps / price * 100 : null, payout = fin(dps) && eps > 0 ? dps / eps * 100 : null;
  const revDown = ys.slice(-5).reduce((a, y, i, arr) => a + (i && fin(y.revenue) && fin(arr[i - 1].revenue) && y.revenue < arr[i - 1].revenue ? 1 : 0), 0);
  // Growth used for valuation: the lower of revenue and EPS growth (EPS alone is noisy), held between -5% and 25%.
  const gs = [revG, epsG].filter(fin), gModel = gs.length ? clamp(Math.min(...gs) * 0.7 + Math.max(...gs) * 0.3, -5, 25) : null;
  const g = fin(growthOverride) ? clamp(growthOverride, -10, 40) : gModel;
  const financial = !fin(L.opIncome) && !fin(L.capex); // banks / insurers: no operating income or capex lines, cash-flow DCF is meaningless
  // Quality 0–100: returns, margins, cash conversion, balance sheet, consistency.
  let qp = 0, qm = 0; const add = (v, w) => { qp += clamp(v, 0, 1) * w; qm += w; };
  if (fin(roic)) add((roic - 5) / 25, 30); else if (fin(roe)) add((roe - 8) / 25, 30);
  if (fin(opMargin)) add(opMargin / 30, 20);
  if (fin(fcfConv)) add(fcfConv, 15);
  if (fin(de)) add(1 - de / 2, 15);
  add(1 - revDown / 3, 10);
  if (fin(g)) add((g + 5) / 20, 10);
  const quality = qm ? Math.round(qp / qm * 100) : null;
  const qFactor = quality === null ? 1 : 0.85 + 0.3 * quality / 100;
  const fairPE = fin(g) ? r1(clamp((US_MODEL.basePE + US_MODEL.pePerGrowth * Math.max(0, g)) * qFactor, US_MODEL.minPE, US_MODEL.maxPE)) : null;
  const byPE = fairPE && eps > 0 ? fairPE * eps : null;
  const byDcf = !financial && fin(g) && fcfPs > 0 ? dcfPerShare(fcfPs, g) : null;
  const parts = [byPE, byDcf].filter(v => fin(v) && v > 0);
  const fair = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null;
  const pe = eps > 0 && price > 0 ? price / eps : null;
  const ratio = fair && price > 0 ? price / fair : null;
  const verdict = !(eps > 0) ? { key: "loss", label: "Loss-making: not valued", cls: "v-none" } : ratio === null ? { key: "none", label: "Not enough data", cls: "v-none" }
    : ratio <= 0.8 ? { key: "under", label: "Undervalued", cls: "v-under" } : ratio <= 1.05 ? { key: "fair", label: "Fairly valued", cls: "v-fair" } : ratio <= 1.3 ? { key: "rich", label: "Slightly expensive", cls: "v-rich1" } : { key: "expensive", label: "Expensive", cls: "v-rich" };
  const tags = [];
  if (quality >= 70) tags.push("Quality");
  if (fin(g) && g >= 15 && (roic ?? roe ?? 0) >= 15) tags.push("Growth");
  if (pe && pe < 16 && ratio !== null && ratio < 0.95 && !(fin(epsG) && epsG < 0)) tags.push("Value");
  if (divYield >= 2 && payout !== null && payout < 75) tags.push("Dividend");
  const why = [];
  if (fin(g)) why.push(fin(growthOverride) ? `Growth used: your ${r1(g)}%/yr (history: revenue ${r1(revG) ?? "—"}%, EPS ${r1(epsG) ?? "—"}%)` : `Growth used: ${r1(g)}%/yr (revenue ${r1(revG) ?? "—"}%, EPS ${r1(epsG) ?? "—"}% over ${n} yrs)`);
  if (financial) why.push("Financial company: valued on earnings only (no cash-flow DCF)");
  if (fairPE) why.push(`Fair P/E ${fairPE} for that growth and quality ${quality}/100 → $${r2(byPE)}`);
  if (byDcf) why.push(`Cash-flow value (DCF at ${US_MODEL.discount}%): $${r2(byDcf)}`);
  const implied = financial ? null : impliedGrowth(price, fcfPs);
  if (fin(implied)) why.push(`Today's price assumes ~${implied}%/yr cash-flow growth for 5 years`);
  return {
    asOfFy: L.fy, fyEnd: L.end, eps: r2(eps), pe: r1(pe), ps: L.revenue > 0 && shares && price ? r1(price * shares / L.revenue) : null, pb: L.equity > 0 && shares && price ? r1(price * shares / L.equity) : null,
    fcfYield: fcfPs && price ? r1(fcfPs / price * 100) : null, marketCap: shares && price ? Math.round(price * shares) : null,
    revenue: L.revenue, netIncome: L.netIncome, revG: r1(revG), epsG: r1(epsG), growthUsed: r1(g), growthModel: r1(gModel), growthOverride: fin(growthOverride) ? growthOverride : null, financial, roe: r1(roe), roic: r1(roic), netMargin: r1(netMargin), opMargin: r1(opMargin), de: r2(de), fcfConv: r2(fcfConv),
    divYield: r2(divYield), payout: r1(payout), quality, fairPE, fairValue: r2(fair), bear: r2(fair ? fair * 0.8 : null), bull: r2(fair ? fair * 1.2 : null), byPE: r2(byPE), byDcf: r2(byDcf),
    upside: fair && price ? r1((fair / price - 1) * 100) : null, ratio: r2(ratio), impliedGrowth: implied, verdict, tags, why
  };
}

// ---- Prices ----
// Stooq light quotes CSV: Symbol,Date,Time,Open,High,Low,Close,Volume (one row per symbol; "N/D" when unknown)
export function parseStooq(csv) {
  const out = new Map(), lines = String(csv || "").trim().split(/\r?\n/);
  const head = (lines.shift() || "").toLowerCase().split(","), ix = k => head.indexOf(k);
  for (const l of lines) {
    const c = l.split(","), sym = String(c[ix("symbol")] || "").toUpperCase().replace(/\.US$/, ""), close = Number(c[ix("close")]);
    if (sym && fin(close) && close > 0) out.set(sym, { price: close, date: c[ix("date")] || null, open: Number(c[ix("open")]) || null, high: Number(c[ix("high")]) || null, low: Number(c[ix("low")]) || null, volume: Number(c[ix("volume")]) || null, source: "Stooq" });
  }
  return out;
}
export async function fetchUsPrices(symbols, { fetchImpl = fetch } = {}) {
  const out = new Map(), want = [...new Set(symbols.map(cleanUsSymbol))].filter(Boolean), errors = [];
  for (let i = 0; i < want.length; i += 20) {
    const chunk = want.slice(i, i + 20);
    try {
      const r = await fetchImpl(`https://stooq.com/q/l/?s=${chunk.map(s => `${s.toLowerCase()}.us`).join("+")}&f=sd2t2ohlcv&h&e=csv`, { signal: AbortSignal.timeout(15000), headers: { "User-Agent": "Mozilla/5.0" } });
      if (r.ok) for (const [k, v] of parseStooq(await r.text())) out.set(k, v); else errors.push(`Stooq HTTP ${r.status}`);
    } catch (e) { errors.push(`Stooq: ${e.message}`); }
  }
  for (const s of want.filter(x => !out.has(x))) {
    try {
      const r = await fetchImpl(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=5d&interval=1d`, { signal: AbortSignal.timeout(12000), headers: { "User-Agent": "Mozilla/5.0" } });
      const m = r.ok ? (await r.json())?.chart?.result?.[0]?.meta : null;
      if (m?.regularMarketPrice > 0) out.set(s, { price: m.regularMarketPrice, date: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString().slice(0, 10) : null, high52: m.fiftyTwoWeekHigh || null, low52: m.fiftyTwoWeekLow || null, source: "Yahoo" });
      else if (!r.ok) errors.push(`Yahoo ${s}: HTTP ${r.status}`);
    } catch (e) { errors.push(`Yahoo ${s}: ${e.message}`); }
  }
  return { prices: out, errors };
}
export async function fetchSecJson(url, { fetchImpl = fetch } = {}) {
  const r = await fetchImpl(url, { headers: { "User-Agent": SEC_UA(), Accept: "application/json" }, signal: AbortSignal.timeout(40000) });
  if (r.status === 404) throw Object.assign(new Error("Not found in SEC EDGAR (non-US company or new listing?)"), { notFound: true });
  if (r.status === 403 || r.status === 429) throw Object.assign(new Error(`SEC refused the request (HTTP ${r.status}). Set SEC_USER_AGENT to "Your Name your@email.com" and try again later.`), { rateLimited: true });
  if (!r.ok) throw new Error(`SEC HTTP ${r.status}`);
  return r.json();
}
export const companyFactsUrl = cik => `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`;
export const SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
