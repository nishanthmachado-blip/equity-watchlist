// Smart indices: browse the stocks inside any NSE index (Nifty 50, Nifty500 Quality 50, Nifty200 Momentum 30, …) and
// see which are worth adding to the watchlist, with this app's valuation where it has the fundamentals, momentum from the
// index data itself (1-month / 1-year return, distance from the 52-week high) and an explainable "smart score".
// Pure helpers; fetching and caching are in server.mjs.

// Curated list: the NSE index name (as on nseindia.com) plus what the index picks, so the page can explain it.
export const SMART_INDICES = [
  { name: "NIFTY 50", group: "Broad market", blurb: "The 50 largest, most traded companies." },
  { name: "NIFTY NEXT 50", group: "Broad market", blurb: "The next 50 large caps after the Nifty 50: tomorrow's Nifty candidates." },
  { name: "NIFTY 100", group: "Broad market", blurb: "Nifty 50 + Next 50." },
  { name: "NIFTY MIDCAP 150", group: "Broad market", blurb: "Companies ranked 101–250 by size." },
  { name: "NIFTY SMALLCAP 250", group: "Broad market", blurb: "Companies ranked 251–500 by size." },
  { name: "NIFTY 500", group: "Broad market", blurb: "The top 500 companies: about 90% of the market." },
  { name: "NIFTY500 QUALITY 50", group: "Smart beta", factor: "quality", blurb: "50 stocks from the Nifty 500 with the best quality score: high return on equity, low debt, steady earnings (no big swings in EPS)." },
  { name: "NIFTY200 MOMENTUM 30", group: "Smart beta", factor: "momentum", blurb: "30 stocks from the Nifty 200 with the strongest 6- and 12-month price momentum, adjusted for volatility. Rebalanced every 6 months." },
  { name: "NIFTY500 MOMENTUM 50", group: "Smart beta", factor: "momentum", blurb: "50 stocks from the Nifty 500 with the strongest volatility-adjusted 6- and 12-month momentum." },
  { name: "NIFTY100 QUALITY 30", group: "Smart beta", factor: "quality", blurb: "30 large caps with the best ROE, low debt and stable earnings." },
  { name: "NIFTY200 QUALITY 30", group: "Smart beta", factor: "quality", blurb: "30 stocks from the Nifty 200 ranked by ROE, debt and earnings stability." },
  { name: "NIFTY MIDCAP150 QUALITY 50", group: "Smart beta", factor: "quality", blurb: "50 quality mid caps: high ROE, low debt, stable earnings." },
  { name: "NIFTY ALPHA 50", group: "Smart beta", factor: "momentum", blurb: "50 stocks with the highest alpha (return above what their market risk explains) over the last year." },
  { name: "NIFTY500 VALUE 50", group: "Smart beta", factor: "value", blurb: "50 stocks from the Nifty 500 that are cheapest on earnings, book value, sales and dividends." },
  { name: "NIFTY200 VALUE 30", group: "Smart beta", factor: "value", blurb: "30 of the cheapest stocks in the Nifty 200 on P/E, P/B and dividend yield." },
  { name: "NIFTY100 LOW VOLATILITY 30", group: "Smart beta", factor: "lowvol", blurb: "The 30 least volatile large caps: smoother ride, smaller falls." },
  { name: "NIFTY DIVIDEND OPPORTUNITIES 50", group: "Smart beta", factor: "dividend", blurb: "50 high-dividend-yield companies with a steady payout." },
  { name: "NIFTY ALPHA LOW-VOLATILITY 30", group: "Smart beta", factor: "momentum", blurb: "30 stocks combining high alpha with low volatility." }
];
export const normIndex = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const n = v => { if (v === null || v === undefined || v === "" || v === "-") return null; const x = Number(String(v).replace(/,/g, "")); return Number.isFinite(x) ? x : null; };
const r1 = v => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null), r2 = v => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

// NSE /api/allIndices → [{ name, category, last, pChange }]
export function parseAllIndices(json) {
  return (Array.isArray(json?.data) ? json.data : []).map(x => ({ name: String(x.index || x.indexSymbol || "").trim(), category: String(x.key || "").trim() || null, last: n(x.last), pChange: n(x.percentChange ?? x.pChange) })).filter(x => x.name);
}
// NSE /api/equity-stockIndices?index=… → { index: { last, pChange, … }, rows: [...] }
export function parseIndexStocks(json) {
  const arr = Array.isArray(json?.data) ? json.data : [];
  const indexRow = arr.find(x => x.priority === 1 || (json?.name && normIndex(x.symbol) === normIndex(json.name)));
  const rows = arr.filter(x => x !== indexRow && x.symbol && /^[A-Z0-9&-]{1,20}$/.test(String(x.symbol).toUpperCase())).map(x => ({
    symbol: String(x.symbol).toUpperCase(), name: x.meta?.companyName || x.companyName || x.symbol, industry: x.meta?.industry || x.industry || null, isin: x.meta?.isin || null,
    price: n(x.lastPrice), prevClose: n(x.previousClose), pChange: n(x.pChange), ch30d: n(x.perChange30d), ch365d: n(x.perChange365d), high52: n(x.yearHigh), low52: n(x.yearLow), ffmc: n(x.ffmc)
  }));
  const tot = rows.reduce((a, r) => a + (r.ffmc || 0), 0);
  for (const r of rows) r.weight = tot > 0 && r.ffmc ? r2(r.ffmc / tot * 100) : null;
  return { index: indexRow ? { last: n(indexRow.lastPrice), pChange: n(indexRow.pChange), ch30d: n(indexRow.perChange30d), ch365d: n(indexRow.perChange365d), high52: n(indexRow.yearHigh), low52: n(indexRow.yearLow) } : null, rows, at: json?.timestamp || null };
}
// The constituents file from niftyindices.com ("Company Name,Industry,Symbol,Series,ISIN Code")
export function parseIndexCsv(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n").filter(l => l.trim());
  if (!lines.length) return [];
  const split = l => l.split(",").map(c => c.trim().replace(/^"|"$/g, ""));
  const head = split(lines[0]).map(h => h.toLowerCase());
  const col = re => head.findIndex(h => re.test(h));
  const ci = { sym: col(/^symbol$/), name: col(/company/), ind: col(/industry|sector/), isin: col(/isin/), series: col(/series/) };
  if (ci.sym < 0) return [];
  return lines.slice(1).map(split).filter(c => c[ci.sym] && (ci.series < 0 || /^(EQ|BE|BZ)$/i.test(c[ci.series] || "EQ"))).map(c => ({ symbol: c[ci.sym].toUpperCase(), name: ci.name >= 0 ? c[ci.name] : c[ci.sym], industry: ci.ind >= 0 ? c[ci.ind] : null, isin: ci.isin >= 0 ? c[ci.isin] : null, price: null, pChange: null, ch30d: null, ch365d: null, high52: null, low52: null, ffmc: null, weight: null }))
    .filter(r => /^[A-Z0-9&-]{1,20}$/.test(r.symbol));
}
// Fill price-derived fields from daily closes (oldest first) when the source had none (CSV fallback)
export function fillFromBars(row, bars) {
  const c = (bars || []).filter(b => b.c > 0); if (c.length < 2) return row;
  const last = c.at(-1).c, back = k => c[Math.max(0, c.length - 1 - k)]?.c, yr = c.slice(-250);
  return { ...row, price: row.price ?? last, prevClose: row.prevClose ?? c.at(-2).c, pChange: row.pChange ?? r2((last / c.at(-2).c - 1) * 100), ch30d: row.ch30d ?? (c.length > 22 ? r2((last / back(21) - 1) * 100) : null), ch365d: row.ch365d ?? (c.length > 240 ? r2((last / back(Math.min(249, c.length - 1)) - 1) * 100) : null), high52: row.high52 ?? Math.max(...yr.map(b => b.h ?? b.c)), low52: row.low52 ?? Math.min(...yr.map(b => b.l ?? b.c)) };
}

const VAL_SCORE = { Undervalued: 90, Fair: 65, "Fair to rich": 40, Rich: 20, "Very rich": 5 };
const pctRank = (arr, v) => { const s = arr.filter(Number.isFinite); if (!s.length || !Number.isFinite(v)) return null; return s.filter(x => x <= v).length / s.length; };
// rows: constituents; extra: { val: Map(symbol → valuation row), tech: Map(symbol → snapshot), held: Set, watch: Set }
export function smartRows(rows, { val = new Map(), tech = new Map(), held = new Set(), watch = new Set() } = {}) {
  const yr = rows.map(r => r.ch365d), mo = rows.map(r => r.ch30d);
  return rows.map(r => {
    const v = val.get(r.symbol) || null, t = tech.get(r.symbol) || null;
    const fromHigh = r.price && r.high52 ? r1((r.price / r.high52 - 1) * 100) : null, fromLow = r.price && r.low52 ? r1((r.price / r.low52 - 1) * 100) : null;
    const above200 = t?.sma200 && r.price ? r.price > t.sma200 : null;
    // score parts, each 0–100 (null when unknown); the total re-weights over the parts that are known
    const parts = [];
    const vs = v?.view ? VAL_SCORE[v.view] ?? (Number.isFinite(v.ratio) ? Math.max(0, Math.min(100, 100 - (v.ratio - 0.6) * 100)) : null) : null;
    if (vs !== null && vs !== undefined) parts.push(["value", vs, 0.35, `valuation: ${v.view}${Number.isFinite(v.upsideToBase) ? ` (${v.upsideToBase > 0 ? "+" : ""}${Math.round(v.upsideToBase * 100)}% to fair value)` : ""}`]);
    const q = v && (Number.isFinite(v.roce) || Number.isFinite(v.roe)) ? Math.max(0, Math.min(100, ((v.roce ?? v.roe) - 5) * 4)) : null;
    if (q !== null) parts.push(["quality", q, 0.2, `ROCE/ROE ${r1(v.roce ?? v.roe)}%`]);
    const m12 = pctRank(yr, r.ch365d), m1 = pctRank(mo, r.ch30d);
    if (m12 !== null) parts.push(["momentum", Math.round((m12 * 0.7 + (m1 ?? m12) * 0.3) * 100), 0.3, `1-year return ${r1(r.ch365d)}% (better than ${Math.round(m12 * 100)}% of this index)`]);
    if (fromHigh !== null) parts.push(["trend", Math.max(0, Math.min(100, 100 + fromHigh * 3 + (above200 === true ? 10 : above200 === false ? -20 : 0))), 0.15, `${fromHigh}% from the 52-week high${above200 === null ? "" : above200 ? ", above the 200-day average" : ", below the 200-day average"}`]);
    const wsum = parts.reduce((a, p) => a + p[2], 0), score = wsum ? Math.round(parts.reduce((a, p) => a + p[1] * p[2], 0) / wsum) : null;
    const tags = [];
    if (v?.view === "Undervalued") tags.push("undervalued");
    if (m12 !== null && m12 >= 0.8 && fromHigh !== null && fromHigh > -10) tags.push("momentum");
    if (r.ch365d > 0 && fromHigh !== null && fromHigh <= -10 && fromHigh >= -25 && above200 !== false) tags.push("pullback");
    if (fromLow !== null && fromLow < 10 && r.ch365d < -15) tags.push("near-low");
    return { ...r, fromHigh, fromLow, above200, rsi: t?.rsi ?? null, held: held.has(r.symbol), watching: watch.has(r.symbol),
      valuation: v ? { view: v.view, ratio: v.ratio, pe: v.pe, fair: v.fairValue?.base ?? null, upside: Number.isFinite(v.upsideToBase) ? Math.round(v.upsideToBase * 100) : null, zone: v.zoneLow ? [v.zoneLow, v.zoneHigh] : null, verdict: v.verdict?.label || null, roce: v.roce ?? null, roe: v.roe ?? null, confidence: v.confidence || null } : null,
      score, partial: !parts.some(p => p[0] === "value"), why: parts.map(p => p[3]), tags };
  });
}
export function indexSummary(rows) {
  const held = rows.filter(r => r.held), w = rows.filter(r => r.held && r.weight).reduce((a, r) => a + r.weight, 0);
  return { count: rows.length, held: held.length, heldWeight: r1(w), watching: rows.filter(r => r.watching).length, valued: rows.filter(r => r.valuation).length,
    undervalued: rows.filter(r => r.tags.includes("undervalued")).length, momentum: rows.filter(r => r.tags.includes("momentum")).length, pullback: rows.filter(r => r.tags.includes("pullback")).length,
    industries: Object.entries(rows.reduce((m, r) => { const k = r.industry || "Other"; m[k] = (m[k] || 0) + (r.weight ?? 1); return m; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => ({ industry: k, weight: r1(v) })) };
}
