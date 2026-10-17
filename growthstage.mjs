// Growth-stage lens: valuing companies that do not make a profit yet (Ather, Swiggy, Meesho, Zomato before profits…).
// There is no P/E, so the question becomes: "what does today's price assume, and is that more or less than the business
// has been delivering?" Steps:
//   1. Price-to-sales now (market cap / last 12 months' sales).
//   2. A path to profit: sales grow at the recent rate, fading to 12% over 10 years; by year 10 the company earns a
//      mature net margin for its kind of business; that profit is worth a mature P/E (the sector's, capped). Discount that
//      year-10 value back to today at the return you want (14% a year) and add half of the net cash (the rest pays for
//      losses on the way). That is the fair market cap; bear / bull change the growth and the margin.
//   3. Implied growth: the sales growth the current price needs under the same margin and P/E. If it is far above what
//      the company has been doing, you are paying a premium; if below, the market is pricing in less than its record.
// Low confidence by nature: every number is an assumption, shown so you can disagree with it. Pure functions.
export const GS = { years: 10, fadeTo: 12, maxGrowth: 60, discount: 14, peRange: [15, 35], defaultPe: 25, cashShare: 0.5,
  margins: [[/software|it services|saas|internet software|platform|fintech|insurance broking|exchange|depositor/i, 15, "software / platform"], [/e-?commerce|internet|retail|quick commerce|food delivery|online|marketplace|consumer services|diversified commercial/i, 7, "consumer internet / e-commerce"], [/automobile|wheeler|two wheel|auto|electric vehicle|ev\b|battery/i, 8, "automobiles / EV"], [/pharma|health|hospital|diagnostic/i, 12, "healthcare"], [/power|energy|solar|renewable|utilit/i, 12, "energy / utilities"], [/fmcg|food|beverage|personal care/i, 10, "consumer brands"]],
  defaultMargin: [8, "a typical business"] };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v, d = 2) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);
const num = v => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
export function matureMargin(sector, industry) {
  const s = `${industry || ""} ${sector || ""}`;
  for (const [re, m, label] of GS.margins) if (re.test(s)) return { margin: m, label };
  return { margin: GS.defaultMargin[0], label: GS.defaultMargin[1] };
}
// Year-by-year growth: starts at g0 and fades linearly to min(g0, fadeTo) by the last year
const path = (g0, years = GS.years) => { const end = Math.min(g0, GS.fadeTo / 100); return Array.from({ length: years }, (_, i) => g0 + (end - g0) * (years > 1 ? i / (years - 1) : 1)); };
export function fairMcap({ sales, g0, margin, pe, cash = 0, r = GS.discount / 100, years = GS.years }) {
  const s5 = path(g0, years).reduce((s, g) => s * (1 + g), sales);
  return (s5 * margin / 100 * pe) / Math.pow(1 + r, years) + Math.max(0, cash) * GS.cashShare;
}
// Sales growth (first-year rate) the market cap implies, by bisection
export function impliedGrowth({ mcap, sales, margin, pe, cash = 0 }) {
  let lo = -0.3, hi = 3; const f = g => fairMcap({ sales, g0: g, margin, pe, cash }) - mcap;
  if (f(lo) > 0) return lo; if (f(hi) < 0) return null;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (f(m) > 0) hi = m; else lo = m; }
  return (lo + hi) / 2;
}
// out: the partly built valuation row (price, marketCap, sector…), f: the fundamentals entry. Returns the finished row or null.
export function growthStageValuation(out, f, price, MODEL) {
  const sales = num(f.salesTtm), mcap = num(out.marketCap);
  if (!(sales > 0) || !(mcap > 0) || out.profile === "financial") return null;
  const hist = num(f.salesGrowth) ?? num(f.salesCagr3);
  if (hist === null) return null;
  const g0 = clamp(hist, 0, GS.maxGrowth) / 100;
  const { margin, label } = matureMargin(out.sector, out.industry);
  const pe = clamp(num(f.sectorPe) > 0 ? num(f.sectorPe) : GS.defaultPe, ...GS.peRange);
  const cash = Math.max(0, (num(f.investments) || 0) - (num(f.borrowings) || 0));
  const ps = mcap / sales, k = price / mcap;
  const sc = { bear: { g: g0 * 0.6, m: margin * 0.7 }, base: { g: g0, m: margin }, bull: { g: Math.min(GS.maxGrowth / 100 * 1.2, g0 * 1.25), m: margin * 1.3 } };
  const fair = Object.fromEntries(Object.entries(sc).map(([key, v]) => [key, fairMcap({ sales, g0: v.g, margin: v.m, pe, cash })]));
  const ig = impliedGrowth({ mcap, sales, margin, pe, cash });
  out.pe = null; out.basis = "P/S"; out.multiple = round(ps, 2); out.fairMultiple = round(fair.base / sales, 2);
  out.ratio = round(mcap / fair.base, 2);
  out.view = MODEL.bands.find(([max]) => out.ratio < max)[1];
  out.fairValue = Object.fromEntries(Object.entries(fair).map(([key, v]) => [key, round(v * k, price < 100 ? 2 : 0)]));
  out.upsideToBase = round(out.fairValue.base / price - 1, 3);
  const zh = Math.min(out.fairValue.base * MODEL.marginOfSafety, Math.max(out.fairValue.bear, out.fairValue.base * 0.75)), zl = Math.min(out.fairValue.bear, zh * MODEL.zoneDepth);
  out.zoneLow = round(zl); out.zoneHigh = round(zh); out.gapToZone = round(price / zh - 1, 3);
  out.status = price < zl ? "Below zone" : price <= zh ? "In zone" : out.gapToZone > MODEL.farAboveZone ? "Wait (far above)" : "Above zone";
  if (out.high && out.low && out.high > out.low) out.rangePos = round((price - out.low) / (out.high - out.low), 2);
  out.confidence = "low";
  const opm = num(f.opmLatest), opmPrev = num(f.opmPrev), ni = num(f.niTtm), runway = ni < 0 && cash > 0 ? cash / -ni : null;
  out.growthStage = { ps: round(ps, 2), salesTtm: round(sales, 0), growth: round(hist, 1), growthYears: num(f.salesGrowthYears), startGrowth: round(g0 * 100, 1), margin, marginLabel: label, pe: round(pe, 1), peSource: num(f.sectorPe) > 0 ? "sector P/E (capped 15–35)" : "assumed 25", discount: GS.discount, years: GS.years,
    fadeTo: GS.fadeTo, impliedGrowth: ig === null ? null : round(ig * 100, 1), premium: ig === null ? null : round(ig * 100 - hist, 1), opm, opmPrev, niTtm: ni, cash: round(cash, 0), runwayYears: round(runway, 1),
    fairMcap: Object.fromEntries(Object.entries(fair).map(([key, v]) => [key, round(v, 0)])) };
  const gs = out.growthStage, reasons = [];
  reasons.push(`Not profitable yet, so valued on sales and a path to profit: price-to-sales ${gs.ps}× on ₹${gs.salesTtm.toLocaleString("en-IN")} Cr of sales (last 12 months).`);
  reasons.push(`Base case: sales grow ${gs.startGrowth}% a year (its recent rate${gs.growthYears ? `, ${gs.growthYears}-yr` : ""}), slowing to ${Math.min(gs.startGrowth, GS.fadeTo)}% by year ${GS.years}; then a ${margin}% net margin (${label}) on a P/E of ${gs.pe} (${gs.peSource}), discounted back at ${GS.discount}% a year${cash > 0 ? `, plus half the net cash (₹${gs.cash.toLocaleString("en-IN")} Cr)` : ""}.`);
  if (gs.impliedGrowth !== null) reasons.push(gs.premium > 5 ? `Today's price needs sales to grow about ${gs.impliedGrowth}% a year (fading over ${GS.years} years) at that margin: ${gs.premium} points more than its record of ${gs.growth}%. You are paying for growth it has not shown yet.` : gs.premium < -5 ? `Today's price needs only about ${gs.impliedGrowth}% a year sales growth: ${-gs.premium} points less than its record of ${gs.growth}%. The market is pricing in a slowdown.` : `Today's price assumes about ${gs.impliedGrowth}% a year sales growth, close to its record of ${gs.growth}%.`);
  if (opm !== null) reasons.push(opmPrev !== null ? `Operating margin ${opm}% (was ${opmPrev}%): ${opm > opmPrev + 1 ? "improving towards profit" : opm < opmPrev - 1 ? "getting worse" : "flat"}.` : `Operating margin ${opm}%.`);
  if (runway !== null) reasons.push(runway < 2 ? `Net cash covers about ${gs.runwayYears} years of the current loss: may need to raise money (dilution risk).` : `Net cash covers about ${gs.runwayYears} years of the current loss.`);
  reasons.push("LOW CONFIDENCE: every input above is an assumption (growth, margin, P/E); treat the zone as a guide to how much optimism is in the price.");
  out.reasons = [...reasons, ...out.reasons];
  return out;
}
