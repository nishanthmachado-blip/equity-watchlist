import { etfValuation } from "./etf.mjs";
// Rule-based valuation view + buy zones. Pure functions, no I/O.
// Every threshold lives in MODEL so it is easy to review and tweak. This is a transparent
// heuristic, NOT a forecast or advice: output is only as good as the fundamentals fed in.
//
// Profiles (set automatically from Yahoo's industry, or override with the `profile` field):
//   default   - P/E vs a "fair P/E" built from growth, ROCE, leverage, cash conversion, promoter selling
//   financial - banks / lenders: P/B vs a "fair P/B" from ROE  (P/E and ROCE are misleading for them)
//   cyclical  - like default, but P/E is normalised on 4-year average profit

export const MODEL = {
  growthFloor: 5, growthCap: 25,
  basePE: 10,
  roceAnchor: 15, roceSlope: 0.5, roceMin: -5, roceMax: 10,
  fairPEMin: 10, fairPEMax: 50,
  leveragePenalty: 0.85,                 // borrowings > reserves
  promoterSellPenalty: 0.9,              // promoters sold > 5 pts in 3 yrs
  cashConversionMin: 0.6, cashConversionPenalty: 0.85, // 3-yr operating cash flow / profit
  negativeFcfPenalty: 0.9,               // latest and 3-yr free cash flow both negative
  debtorDaysMax: 120, inventoryDaysMax: 180, workingCapitalPenalty: 0.9,
  sectorBlend: 0.25, sectorPeRange: [10, 45], // fair P/E = 75% own + 25% sector P/E when NSE gives sector P/E
  cyclicalNormRange: [0.5, 3],           // clamp on latest profit / 4-yr average profit
  financial: { costOfEquity: 13, growth: 6, fairPBMin: 0.6, fairPBMax: 6 },
  marginOfSafety: 0.9, zoneDepth: 0.75, undervaluedZone: [0.9, 1.05],
  bands: [[0.7, "Undervalued"], [1.15, "Fair"], [1.6, "Fair to rich"], [2.5, "Rich"], [Infinity, "Very rich"]],
  farAboveZone: 0.4,
  scenarios: { bear: 0.75, base: 1, bull: 1.25 }, // multipliers on the fair multiple
  staleDays: 90,
  // Approximate SEBI/AMFI market-cap classes (₹ crore): large = top 100, mid = 101-250, small = the rest. AMFI republishes the real list
  // every January and July; the cut-offs below move with the market, so update them when it does.
  capBands: { largeMin: 100000, midMin: 33000 }
};

const num = v => (v === null || v === undefined || v === "" ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v, d = 2) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);

export function ageDays(asOf, now = Date.now()) {
  const t = asOf ? new Date(asOf).getTime() : NaN;
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 864e5)) : null;
}

export function capClass(mc) {
  const x = num(mc); if (x === null || x <= 0) return null;
  return x >= MODEL.capBands.largeMin ? "Large" : x >= MODEL.capBands.midMin ? "Mid" : "Small";
}

export function computeValuation(stock, f, now = Date.now()) {
  const base = { id: stock.id, company: stock.company, symbol: stock.marketSymbol || stock.ticker, price: num(stock.price), low: num(stock.low) ?? num(f?.low52), high: num(stock.high) ?? num(f?.high52) };
  if (!f) return { ...base, view: "No fundamentals", status: "Fetch needed", reasons: ["No fundamentals yet. Use \"Fetch from Yahoo\"."] };
  const price = base.price ?? num(f.price);
  const capPrice = num(f.price) ?? price;
  const age = ageDays(f.asOf, now);
  const out = { ...base, price, pe: null, pb: num(f.pb), roce: num(f.roce), roe: num(f.roe), promoter: num(f.promoter), promoterChange3y: num(f.promoterChange3y), sectorPe: num(f.sectorPe), sectorPeSource: f.sectorPe ? (f.sectorPeSource || "NSE") : null, salesCagr3: num(f.salesCagr3), profitCagr3: num(f.profitCagr3), borrowings: num(f.borrowings), reserves: num(f.reserves), cfoToProfit3: num(f.cfoToProfit3), fcfNegative: num(f.fcfNegative), debtorDays: num(f.debtorDays), inventoryDays: num(f.inventoryDays), sector: f.sector || null, industry: f.industry || null, profile: f.profile || "default", flags: f.flags || "", asOf: f.asOf || null, ageDays: age, stale: age !== null && age > MODEL.staleDays, source: f.source || null, reasons: [] };
  { const mc = num(f.marketCap); if (mc !== null && price && capPrice) { out.marketCap = Math.round(mc * price / capPrice); out.cap = capClass(out.marketCap); } }
  if (out.stale) out.reasons.push(`Fundamentals are ${age} days old; refresh before relying on this.`);
  if (!price || !capPrice) return { ...out, view: "Unassessable", status: "Needs price", reasons: [...out.reasons, "No price."] };
  if (out.profile === "etf") return etfValuation(out, f, price, MODEL);

  const profile = out.profile;
  const scale = price / capPrice; // re-scale multiples to the live price (EPS/book value held at capture)
  const pe0 = num(f.pe), pb0 = num(f.pb);
  const pe = pe0 && pe0 > 0 ? pe0 * scale : null;
  const pb = pb0 && pb0 > 0 ? pb0 * scale : null;
  out.pe = round(pe, 1); out.pb = round(pb, 2);

  let multiple, fairMultiple, basis;
  if (profile === "financial" && pb !== null && num(f.roe) !== null) {
    const fm = MODEL.financial;
    fairMultiple = clamp((out.roe - fm.growth) / (fm.costOfEquity - fm.growth), fm.fairPBMin, fm.fairPBMax);
    multiple = pb; basis = "P/B";
    out.reasons.push(`Lender profile: P/B ${out.pb} vs fair ${round(fairMultiple, 2)} (ROE ${out.roe}%).`);
  } else {
    if (profile === "financial") out.reasons.push("Lender profile needs P/B and ROE; fell back to P/E rules.");
    if (pe === null) return { ...out, view: "Unassessable", status: "Needs P/E", reasons: [...out.reasons, "P/E missing or non-positive (loss-making or no data); no earnings-based zone."] };
    multiple = pe; basis = "P/E";
    if (profile === "cyclical") {
      const nl = num(f.niLatest), na = num(f.niAvg4);
      if (nl && na && nl > 0 && na > 0) {
        const k = clamp(nl / na, ...MODEL.cyclicalNormRange);
        multiple = pe * k; out.reasons.push(`Cyclical: P/E normalised on 4-yr average profit (${round(pe, 1)} x ${round(k, 2)} = ${round(multiple, 1)}).`);
      } else out.reasons.push("Cyclical profile but 4-yr profit history missing; used reported P/E.");
    }
    if (num(f.thin) === 1) {
      // NSE-only data: no growth/ROCE. Compare P/E with the sector P/E; low confidence.
      const sp = num(f.sectorPe);
      if (!(sp > 0)) return { ...out, pe: round(pe, 1), view: "Unassessable", status: "Needs more data", confidence: "low", reasons: [...out.reasons, "NSE gave a P/E but no sector P/E or growth data; fetch from Yahoo when it is available."] };
      fairMultiple = clamp(sp, ...MODEL.sectorPeRange);
      out.confidence = "low";
      out.reasons.unshift(`LOW CONFIDENCE: only NSE data. P/E ${round(multiple, 1)} vs sector P/E ${round(sp, 1)}; growth, ROCE and cash flow unknown.`);
    } else {
    const s = num(f.salesCagr3), p = num(f.profitCagr3);
    const growths = [s, p].filter(v => v !== null);
    const rawG = growths.length ? 0.6 * Math.min(...growths) + 0.4 * Math.max(...growths) : 10;
    const g = clamp(rawG, MODEL.growthFloor, MODEL.growthCap);
    if (!growths.length) out.reasons.push("No 3-yr growth on file; assumed 10%.");
    const roce = num(f.roce);
    const qAdj = roce === null ? 0 : clamp((roce - MODEL.roceAnchor) * MODEL.roceSlope, MODEL.roceMin, MODEL.roceMax);
    fairMultiple = clamp(MODEL.basePE + g + qAdj, MODEL.fairPEMin, MODEL.fairPEMax);
    out.reasons.unshift(`P/E ${round(multiple, 1)} vs fair ${round(fairMultiple, 1)} (growth ${round(g, 0)}%, ROCE ${roce ?? "n/a"}%).`);
    const sp = num(f.sectorPe);
    if (sp && sp > 0) { const cl = clamp(sp, ...MODEL.sectorPeRange); fairMultiple = (1 - MODEL.sectorBlend) * fairMultiple + MODEL.sectorBlend * cl; out.reasons.push(`Blended with sector P/E ${round(sp, 1)} (${MODEL.sectorBlend * 100}% weight).`); }
    const pen = (cond, factor, msg) => { if (cond) { fairMultiple *= factor; out.reasons.push(msg); } };
    const b = num(f.borrowings), r = num(f.reserves);
    pen(b !== null && r !== null && r > 0 && b > r, MODEL.leveragePenalty, "Borrowings exceed reserves: fair P/E cut 15%.");
    pen(num(f.promoterChange3y) !== null && f.promoterChange3y < -5, MODEL.promoterSellPenalty, `Promoters sold ${Math.abs(num(f.promoterChange3y))} pts in 3 yrs: fair P/E cut 10%.`);
    pen(num(f.cfoToProfit3) !== null && f.cfoToProfit3 < MODEL.cashConversionMin, MODEL.cashConversionPenalty, `Weak cash conversion (3-yr operating cash flow = ${round(num(f.cfoToProfit3), 2)}x profit): fair P/E cut 15%.`);
    pen(num(f.fcfNegative) === 1, MODEL.negativeFcfPenalty, "Free cash flow negative (latest year and 3-yr total): fair P/E cut 10%.");
    pen((num(f.debtorDays) !== null && f.debtorDays > MODEL.debtorDaysMax) || (num(f.inventoryDays) !== null && f.inventoryDays > MODEL.inventoryDaysMax), MODEL.workingCapitalPenalty, `Heavy working capital (debtors ${num(f.debtorDays) ?? "n/a"}d / inventory ${num(f.inventoryDays) ?? "n/a"}d of sales): fair P/E cut 10%.`);
    }
  }
  if (profile === "financial" && basis === "P/B") {
    const pen = f.promoterChange3y < -5;
    if (pen) { fairMultiple *= MODEL.promoterSellPenalty; out.reasons.push(`Promoters sold ${Math.abs(f.promoterChange3y)} pts in 3 yrs: fair P/B cut 10%.`); }
  }
  out.basis = basis;
  out.multiple = round(multiple, 2);
  out.fairMultiple = round(fairMultiple, 2);
  out.fairPE = basis === "P/E" ? out.fairMultiple : null;
  out.ratio = round(multiple / fairMultiple, 2);
  out.view = MODEL.bands.find(([max]) => out.ratio < max)[1];

  // Fair value range (price at which the current multiple would equal the scenario's fair multiple)
  out.fairValue = Object.fromEntries(Object.entries(MODEL.scenarios).map(([k, m]) => [k, round(price * fairMultiple * m / multiple, price < 100 ? 2 : 0)]));
  out.upsideToBase = round(out.fairValue.base / price - 1, 3);

  const targetM = fairMultiple * MODEL.marginOfSafety;
  const valueTop = price * targetM / multiple, valueLow = valueTop * MODEL.zoneDepth;
  let zl, zh;
  if (valueTop >= price) { [zl, zh] = [price * MODEL.undervaluedZone[0], price * MODEL.undervaluedZone[1]]; } else { zl = valueLow; zh = valueTop; }
  const low52 = out.low;
  if (low52 && zh < low52) { zl = low52 * 0.85; zh = low52 * 1.05; out.floored = true; out.reasons.push("Value is below the 52-week low; zone floored near the low. Treat as 'wait for a major reset', not a real entry."); }
  out.zoneLow = round(zl); out.zoneHigh = round(zh);
  out.gapToZone = round(price / zh - 1, 3);
  out.status = price < zl ? "Below zone" : price <= zh ? "In zone" : (out.gapToZone > MODEL.farAboveZone ? "Wait (far above)" : "Above zone");
  if (out.high && out.low && out.high > out.low) out.rangePos = round((price - out.low) / (out.high - out.low), 2);
  return out;
}

export function computeAll(stocks, fundamentals, now = Date.now()) {
  return stocks.map(s => computeValuation(s, fundamentals[(s.marketSymbol || s.ticker || "").toUpperCase()], now));
}

// ---- Fundamentals input -------------------------------------------------------------
export const FIELDS = ["symbol", "companyName", "priceDate", "sector", "industry", "profile", "high52", "low52", "price", "pe", "pb", "roce", "roe", "promoter", "promoterChange3y", "salesCagr3", "profitCagr3", "borrowings", "reserves", "sectorPe", "cfoToProfit3", "fcfNegative", "debtorDays", "inventoryDays", "niLatest", "niAvg4", "marketCap", "thin", "nseRefreshedAt", "sectorPeSource", "asOf", "source", "flags", "etfType", "etfDevQ", "indexName", "dma50", "dma200", "devNow", "devPctile", "devDays", "cagr1", "cagr3", "cagr5", "histYears", "inav", "premium", "indexPe", "indexPb", "indexDy"];
const NUMERIC = new Set(["high52", "low52", "price", "pe", "pb", "roce", "roe", "promoter", "promoterChange3y", "salesCagr3", "profitCagr3", "borrowings", "reserves", "sectorPe", "cfoToProfit3", "fcfNegative", "debtorDays", "inventoryDays", "niLatest", "niAvg4", "marketCap", "thin", "dma50", "dma200", "devNow", "devPctile", "devDays", "cagr1", "cagr3", "cagr5", "histYears", "inav", "premium", "indexPe", "indexPb", "indexDy"]);
export const PROFILES = ["default", "financial", "cyclical", "etf"];

export function sanitizeEntry(e) {
  const symbol = String(e.symbol || "").trim().toUpperCase();
  if (!/^[A-Z0-9&-]{1,20}$/.test(symbol)) throw new Error(`Invalid symbol: "${e.symbol}"`);
  const out = { symbol };
  for (const k of FIELDS.slice(1)) {
    if (e[k] === undefined || e[k] === "" || e[k] === null) continue;
    if (NUMERIC.has(k)) { const n = Number(e[k]); if (!Number.isFinite(n)) throw new Error(`${symbol}: ${k} must be a number`); out[k] = n; }
    else if (k === "profile") { const v = String(e[k]).toLowerCase(); if (!PROFILES.includes(v)) throw new Error(`${symbol}: profile must be one of ${PROFILES.join(", ")}`); out[k] = v; }
    else out[k] = String(e[k]).slice(0, 300);
  }
  return out;
}

export function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some(x => x.trim())) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some(x => x.trim())) rows.push(row);
  if (rows.length < 2) throw new Error("CSV needs a header row and at least one data row.");
  const head = rows[0].map(h => h.trim());
  if (!head.includes("symbol")) throw new Error('CSV header must include "symbol".');
  const unknown = head.filter(h => !FIELDS.includes(h));
  if (unknown.length) throw new Error(`Unknown column(s): ${unknown.join(", ")}. Allowed: ${FIELDS.join(", ")}`);
  return rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}
