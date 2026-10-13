// ETF lens. An ETF has no earnings of its own, so P/E-based fair value does not apply (and Screener has no ETF pages).
// Instead an ETF is valued against its own price trend: how far it sits above or below its 200-day average today,
// compared with where that gap has been over the last (up to) 5 years. Cheapest 20% of its history = buy zone,
// the median gap = "fair", the dearest 15% = expensive. The 52-week range, drawdown from the high, 1/3/5-year returns,
// the iNAV premium (NSE) and the underlying index P/E (NSE, for index ETFs) are shown alongside.
const fin = v => Number.isFinite(v);
const r2 = v => (fin(v) ? Math.round(v * 100) / 100 : null);
const r4 = v => (fin(v) ? Math.round(v * 1e4) / 1e4 : null);

const KNOWN = new Set(["NIFTYBEES", "JUNIORBEES", "BANKBEES", "GOLDBEES", "SILVERBEES", "LIQUIDBEES", "ITBEES", "PSUBNKBEES", "PHARMABEES", "CPSEETF", "SETFNIF50", "SETFNN50", "SETFNIFBK", "ICICIB22", "MON100", "MAFANG", "MAHKTECH", "MOM100", "MOM50", "HNGSNGBEES", "GOLD1", "SILVER1", "GOLDIETF", "SILVERIETF", "NIF100IETF", "MIDCAPETF", "MID150BEES", "NIFTYIETF", "BANKIETF", "ITIETF", "HDFCNIFTY", "HDFCGOLD", "HDFCSILVER", "UTINIFTETF", "KOTAKNIFTY", "KOTAKGOLD", "AXISGOLD", "SBIETFGOLD", "LIQUIDCASE", "LIQUIDETF", "MOVALUE", "MOQUALITY", "ALPHA", "ALPHAETF", "NV20BEES", "INFRABEES", "CONSUMBEES", "DIVOPPBEES", "SHARIABEES", "MONQ50", "MASPTOP50", "MAKEINDIA", "EVINDIA", "SMALLCAP", "MIDSMALL", "HEALTHIETF", "AUTOBEES", "MOREALTY", "MODEFENCE", "GROWWEV", "NEXT50IETF", "MIDCAPIETF", "BSE500IETF", "MONIFTY500", "TOP100CASE", "MOMENTUM", "LOWVOL", "LOWVOLIETF", "QUAL30IETF", "SENSEXIETF", "SENSEXETF", "BSLNIFTY", "BSLGOLDETF", "LICNETFN50", "LICNETFGSC", "GILT5YBEES", "LTGILTBEES", "EBBETF0430", "EBBETF0433", "BBETF0432"]);
export function isEtf(symbol, name = "") {
  const s = String(symbol || "").toUpperCase(), n = String(name || "");
  return KNOWN.has(s) || /BEES$|IETF$|^SETF|ETF$|^LIQUID/.test(s) || /\bETF\b|\bBeES\b|Exchange Traded/i.test(n);
}
export function etfType(symbol, name = "") {
  const s = `${symbol} ${name}`.toUpperCase();
  if (/LIQUID|OVERNIGHT|MONEY MARKET|GILT|BHARAT BOND|EBBETF|BBETF|\bG-?SEC|LICNETFGSC/.test(s)) return "debt";
  if (/GOLD/.test(s)) return "gold";
  if (/SILVER/.test(s)) return "silver";
  if (/NASDAQ|MON100|MONQ50|MAFANG|FANG|HANG SENG|HNGSNG|MAHKTECH|S&P 500|MASPTOP50|US |INTERNATIONAL/.test(s)) return "international";
  return "equity";
}
// The NSE index an equity ETF tracks (for the index P/E, P/B and dividend yield from NSE's allIndices list).
const INDEX_RULES = [[/JUNIORBEES|NEXT ?50|SETFNN50|NEXT50IETF|NN50/, "NIFTY NEXT 50"], [/PSUBNKBEES|PSU BANK/, "NIFTY PSU BANK"], [/BANKBEES|SETFNIFBK|BANKIETF|NIFTY BANK|BANK BEES/, "NIFTY BANK"], [/ITBEES|ITIETF|NIFTY IT\b/, "NIFTY IT"], [/PHARMABEES|PHARMA/, "NIFTY PHARMA"], [/MID150|MIDCAP ?150|MIDCAPETF|MIDCAPIETF/, "NIFTY MIDCAP 150"], [/NIFTY ?100|NIF100/, "NIFTY 100"], [/CPSE/, "NIFTY CPSE"], [/NV20/, "NIFTY50 VALUE 20"], [/INFRA/, "NIFTY INFRASTRUCTURE"], [/CONSUM/, "NIFTY INDIA CONSUMPTION"], [/AUTOBEES|NIFTY AUTO/, "NIFTY AUTO"], [/NIFTYBEES|SETFNIF50|NIFTYIETF|UTINIFTETF|HDFCNIFTY|KOTAKNIFTY|LICNETFN50|BSLNIFTY|NIFTY ?50\b|NIFTY 50/, "NIFTY 50"]];
export function indexFor(symbol, name = "") { const s = `${symbol} ${name}`.toUpperCase(); return INDEX_RULES.find(([re]) => re.test(s))?.[1] || null; }
export function parseAllIndices(json) {
  const out = {};
  for (const x of json?.data || []) { const k = String(x.index || x.indexSymbol || "").toUpperCase(); if (k) out[k] = { pe: Number(x.pe) || null, pb: Number(x.pb) || null, dy: Number(x.dy) || null, last: Number(x.last) || null }; }
  return out;
}

function quantile(sorted, q) { if (!sorted.length) return null; const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo); }
// Percentile (0–100) of x within the 21 stored quantiles (0%, 5%, …, 100%).
export function pctileFromQ(q, x) {
  if (!Array.isArray(q) || q.length < 2 || !fin(x)) return null;
  if (x <= q[0]) return 0; if (x >= q.at(-1)) return 100;
  for (let i = 1; i < q.length; i++) if (x <= q[i]) { const span = q[i] - q[i - 1]; return r2(((i - 1) + (span > 0 ? (x - q[i - 1]) / span : 0)) * (100 / (q.length - 1))); }
  return 100;
}
export const parseQ = s => (typeof s === "string" ? s.split(",").map(Number).filter(fin) : Array.isArray(s) ? s.map(Number).filter(fin) : []);

// bars: [{ t (unix s), c, h, l }] oldest first (up to 5 years of daily bars).
export function etfLens(bars, { symbol, name = "", inav = null, index = null, indexStats = null, today = new Date().toISOString().slice(0, 10) } = {}) {
  const b = (bars || []).filter(x => x && fin(x.c) && x.c > 0);
  if (b.length < 30) throw new Error(`Not enough price history for ${symbol} (${b.length} days).`);
  const closes = b.map(x => x.c), price = closes.at(-1), n = closes.length;
  const last = b.slice(-252), high52 = Math.max(...last.map(x => x.h ?? x.c)), low52 = Math.min(...last.map(x => x.l ?? x.c));
  const type = etfType(symbol, name);
  const out = { symbol, companyName: name || symbol, price: r2(price), priceDate: today, high52: r2(high52), low52: r2(low52), profile: "etf", etfType: type, asOf: today, source: "ETF lens: Yahoo price history", histYears: r2(n / 252) };
  const ago = d => (n > d ? closes[n - 1 - d] : null);
  for (const [k, d, yrs] of [["cagr1", 252, 1], ["cagr3", 756, 3]]) { const p0 = ago(d); if (p0) out[k] = r2(((price / p0) ** (1 / yrs) - 1) * 100); }
  if (n >= 1200) out.cagr5 = r2(((price / closes[Math.max(0, n - 1261)]) ** (252 / Math.min(n - 1, 1260)) - 1) * 100); // ~5 years (Yahoo's "5y" is a few days short)
  const sma = (end, len) => { let s = 0; for (let i = end - len + 1; i <= end; i++) s += closes[i]; return s / len; };
  if (n >= 50) out.dma50 = r2(sma(n - 1, 50));
  if (n >= 200) {
    // 200-day average and the gap (price / average − 1) for every day that has one
    const devs = []; let run = 0;
    for (let i = 0; i < n; i++) { run += closes[i]; if (i >= 200) run -= closes[i - 200]; if (i >= 199) devs.push(closes[i] / (run / 200) - 1); }
    out.dma200 = r2(run / 200);
    const sorted = [...devs].sort((a, c) => a - c);
    const q = Array.from({ length: 21 }, (_, i) => r4(quantile(sorted, i / 20)));
    out.etfDevQ = q.join(",");
    out.devNow = r4(devs.at(-1)); out.devPctile = pctileFromQ(q, devs.at(-1)); out.devDays = devs.length;
  }
  if (fin(inav) && inav > 0) { out.inav = r2(inav); out.premium = r2((price / inav - 1) * 100); }
  if (index) { out.indexName = index; if (indexStats) { if (indexStats.pe) out.indexPe = r2(indexStats.pe); if (indexStats.pb) out.indexPb = r2(indexStats.pb); if (indexStats.dy) out.indexDy = r2(indexStats.dy); } }
  out.flags = `ETF (${type}): valued on price vs its own 200-day trend over ${out.histYears} yrs of history`;
  return out;
}

// Valuation row fields for an ETF entry (same shape as a stock's, so the rest of the app just works).
export function etfValuation(out, f, price, MODEL) {
  const reasons = [];
  const type = f.etfType || "equity", typeLabel = { equity: "Equity index ETF", gold: "Gold ETF", silver: "Silver ETF", international: "International ETF", debt: "Debt / liquid ETF" }[type] || "ETF";
  out.basis = "ETF trend"; out.etf = { type, typeLabel, dma50: f.dma50 ?? null, dma200: f.dma200 ?? null, cagr1: f.cagr1 ?? null, cagr3: f.cagr3 ?? null, cagr5: f.cagr5 ?? null, histYears: f.histYears ?? null, inav: f.inav ?? null, premium: f.premium ?? null, indexName: f.indexName || null, indexPe: f.indexPe ?? null, indexPb: f.indexPb ?? null, indexDy: f.indexDy ?? null };
  if (out.high && out.low && out.high > out.low) out.rangePos = r2((price - out.low) / (out.high - out.low));
  const ddHigh = out.high ? r2((price / out.high - 1) * 100) : null; out.etf.fromHigh = ddHigh;
  if (type === "debt") {
    return { ...out, view: "Fair", status: "Cash-like", ratio: 1, fairValue: { bear: r2(price), base: r2(price), bull: r2(price) }, upsideToBase: 0, reasons: [...out.reasons, `${typeLabel}: it tracks interest rates, not company earnings, so it has no buy or sell zone. Use it to park cash.`, ...(fin(f.premium) ? [`Price is ${f.premium > 0 ? "+" : ""}${f.premium}% vs its iNAV.`] : [])] };
  }
  const q = parseQ(f.etfDevQ), dma = Number(f.dma200);
  if (!(dma > 0) || q.length < 21) {
    // Under 200 days of history: 52-week range only.
    const pos = out.rangePos;
    out.confidence = "low";
    if (!fin(pos)) return { ...out, view: "Unassessable", status: "Needs history", reasons: [...out.reasons, "ETF with too little price history for a trend reading yet."] };
    out.view = pos <= 0.25 ? "Undervalued" : pos <= 0.6 ? "Fair" : pos <= 0.85 ? "Rich" : "Very rich";
    const zh = out.low + (out.high - out.low) * 0.25, zl = out.low;
    out.zoneLow = r2(zl); out.zoneHigh = r2(zh); out.gapToZone = r2(price / zh - 1);
    out.fairValue = { bear: r2(zh), base: r2(out.low + (out.high - out.low) * 0.5), bull: r2(out.high) }; out.upsideToBase = r2(out.fairValue.base / price - 1); out.ratio = r2(price / out.fairValue.base);
    out.status = price < zl ? "Below zone" : price <= zh ? "In zone" : out.gapToZone > MODEL.farAboveZone ? "Wait (far above)" : "Above zone";
    return { ...out, reasons: [...out.reasons, `LOW CONFIDENCE: under 200 days of history, so only the 52-week range is used (now ${Math.round(pos * 100)}% of the way from low to high).`] };
  }
  const devNow = price / dma - 1, pct = pctileFromQ(q, devNow);
  const at = x => r2(dma * (1 + x));
  out.etf.devNow = r2(devNow * 100); out.etf.pctile = pct; out.etf.devMedian = r2(q[10] * 100); out.etf.devLow = r2(q[1] * 100); out.etf.devHigh = r2(q[19] * 100);
  out.fairValue = { bear: at(q[4]), base: at(q[10]), bull: at(q[16]) };
  out.ratio = r2(price / out.fairValue.base); out.upsideToBase = r2(out.fairValue.base / price - 1);
  out.view = pct <= 20 ? "Undervalued" : pct <= 55 ? "Fair" : pct <= 85 ? "Rich" : "Very rich";
  const zh = at(q[4]), zl = at(q[1]);
  out.zoneLow = r2(Math.min(zl, zh)); out.zoneHigh = r2(zh); out.gapToZone = r2(price / zh - 1);
  out.status = price < out.zoneLow ? "Below zone" : price <= zh ? "In zone" : out.gapToZone > MODEL.farAboveZone ? "Wait (far above)" : "Above zone";
  const pctTxt = v => `${v > 0 ? "+" : ""}${r2(v * 100)}%`;
  reasons.push(`${typeLabel}: no earnings of its own, so it is valued against its own price trend. Now ${pctTxt(devNow)} vs its 200-day average (₹${r2(dma)}); over the last ${f.histYears ?? "few"} years that gap was usually between ${pctTxt(q[1])} and ${pctTxt(q[19])}, median ${pctTxt(q[10])}.`);
  reasons.push(`Today ranks at the ${Math.round(pct)}th percentile of its own history (0 = cheapest). Buy zone = its cheapest 20%: ₹${out.zoneLow}–₹${out.zoneHigh}; typical (median) level ₹${out.fairValue.base}.`);
  if (fin(ddHigh)) reasons.push(`52-week range ₹${out.low}–₹${out.high}; ${ddHigh < 0 ? `${Math.abs(ddHigh)}% below` : "at"} the 52-week high.`);
  const cg = [["1 yr", f.cagr1], ["3 yr", f.cagr3], ["5 yr", f.cagr5]].filter(([, v]) => fin(v)).map(([k, v]) => `${k} ${v > 0 ? "+" : ""}${v}%`);
  if (cg.length) reasons.push(`Returns a year: ${cg.join(", ")}.`);
  if (fin(f.indexPe)) reasons.push(`${f.indexName}: P/E ${f.indexPe}${fin(f.indexPb) ? `, P/B ${f.indexPb}` : ""}${fin(f.indexDy) ? `, dividend yield ${f.indexDy}%` : ""} (NSE). Compare with the index's own history before a lump sum.`);
  if (fin(f.premium)) reasons.push(Math.abs(f.premium) >= 0.5 ? `Price is ${f.premium > 0 ? "+" : ""}${f.premium}% vs its iNAV (₹${f.inav}): ${f.premium > 0 ? "you would pay a premium; use a limit order near iNAV" : "trading at a discount to iNAV"}.` : `Price is within 0.5% of its iNAV (₹${f.inav}).`);
  if (type === "gold" || type === "silver") reasons.push(`${type === "gold" ? "Gold" : "Silver"} follows global prices and the rupee; treat it as a hedge, sized as a share of the portfolio rather than a valuation call.`);
  out.reasons = [...out.reasons, ...reasons];
  return out;
}

export function classifyEtf(r) {
  const t = r.etf?.type;
  const tags = ["ETF"];
  if (t === "debt") return { key: "wait", label: "Liquid / debt ETF: for parking cash", cls: "v-fair", tags, inZone: false };
  if (!r.view || r.view === "Unassessable" || r.view === "No fundamentals") return { key: "none", label: "ETF: not enough history yet", cls: "v-none", tags };
  const inZone = r.status === "In zone" || r.status === "Below zone";
  if (inZone) tags.push("Buy zone");
  let key, label, cls;
  if (inZone) { key = "buy"; label = "ETF: accumulate (cheap vs its trend)"; cls = "v-under"; }
  else if (r.view === "Undervalued" || r.view === "Fair") { key = "wait"; label = "ETF: fair, continue SIPs"; cls = "v-fair"; }
  else if (r.view === "Rich") { key = "wait"; label = "ETF: stretched, go slow on lump sums"; cls = "v-rich1"; }
  else { key = "expensive"; label = "ETF: expensive vs its trend, wait"; cls = "v-rich"; }
  if (r.confidence === "low") label += " (low confidence)";
  return { key, label, cls, tags, inZone, growthScore: null, growthNotes: [], growthJustified: false };
}
