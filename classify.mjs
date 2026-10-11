// Verdict classification shared by the server (alerts, allocator, portfolio health). Pure functions, no I/O.
// The browser's Growth picks screen uses the same gates (public/app.js growthScore); keep the two in step.
export const DIV_MIN_YIELD = 2; // % trailing yield needed for the "Dividend" tag (and the dividend must be rated Safe)
const clamp01 = x => Math.max(0, Math.min(1, x));
const fin = v => Number.isFinite(v);
const round = v => Math.round(v);

export function growthScore(r) {
  const financial = r.profile === "financial";
  const sales = r.salesCagr3, profit = r.profitCagr3, quality = financial ? r.roe : r.roce;
  if (!fin(r.ratio) || !fin(profit) || !fin(quality) || (!financial && !fin(sales))) return null;
  const g = financial ? profit : Math.min(sales, profit);
  const levered = !financial && fin(r.borrowings) && fin(r.reserves) && r.reserves > 0 && r.borrowings > r.reserves;
  const cfo = r.cfoToProfit3, sold = fin(r.promoterChange3y) && r.promoterChange3y < -5;
  // Lenders' operating cash flow is negative by nature (loans are outflows), so the cash tests apply to non-financials only.
  const cashFail = !financial && (r.fcfNegative === 1 || (fin(cfo) && cfo < 0.6));
  if ((!financial && sales < 12) || profit < 15 || quality < (financial ? 13 : 15) || levered || cashFail || sold) return null;
  const growthPts = 15 + clamp01((g - 12) / 18) * 20;
  const qualityPts = 10 + clamp01((quality - 15) / 15) * 15;
  const cashPts = (financial || !fin(r.borrowings) ? 4 : 8) + (!fin(cfo) ? 3 : cfo >= 0.8 ? 6 : 3) + (r.fcfNegative === 0 ? 6 : 3);
  const promPts = !fin(r.promoter) ? 4 : r.promoter >= 50 ? 10 : r.promoter >= 35 ? 7 : 4;
  const valPts = r.ratio < 0.9 ? 10 : r.ratio < 1.1 ? 8 : r.ratio < 1.3 ? 5 : r.ratio < 1.6 ? 2 : 0;
  const notes = [];
  if (g >= 20) notes.push(`Strong growth (${round(g)}%+ on both sales and profit)`);
  if (quality >= 22) notes.push(`High ${financial ? "ROE" : "ROCE"} ${round(quality)}%`);
  if (cfo >= 0.8) notes.push("Profits convert to cash");
  if (!financial && fin(r.borrowings) && fin(r.reserves) && r.borrowings < r.reserves * 0.3) notes.push("Low debt");
  if (r.promoter >= 50) notes.push("High promoter holding");
  if (r.ratio >= 1.3) notes.push(`Priced at ${r.ratio}× fair multiple: wait for a better entry`);
  if (!fin(cfo)) notes.push("Cash conversion unknown");
  if (r.stale) notes.push("Fundamentals stale");
  return { score: Math.round(growthPts + qualityPts + cashPts + promPts + valPts), notes };
}

// r = a row from valuation.computeValuation (optionally with r.dividend from dividends.mjs).
export function classify(r) {
  if (!r || !r.view || r.view === "No fundamentals") return { key: "none", label: "Not valued yet", cls: "v-none", tags: [] };
  if (!fin(r.ratio)) return { key: "none", label: "Can't value yet", cls: "v-none", tags: [] };
  // A floored zone means the value is below the 52-week low: "wait for a reset", not an entry.
  const inZone = (r.status === "In zone" || r.status === "Below zone") && !r.floored;
  const rich = r.view === "Rich" || r.view === "Very rich";
  const g = growthScore(r);
  const value = r.view === "Undervalued" || r.view === "Fair";
  const div = r.dividend && r.dividend.safety === "Safe" && r.dividend.yield >= DIV_MIN_YIELD;
  const tags = [value && "Value", g && "Growth", div && "Dividend", inZone && "Buy zone"].filter(Boolean);
  // Growth lens: a high P/E can still be a buy when the business compounds fast enough. Only for stocks that pass the growth
  // and durability gates, so a one-off profit spike does not get a free pass.
  const gl = r.growthLens, justified = g && gl && r.profile !== "cyclical" && gl.growth >= 15 && gl.ratio <= 1.1 && !value;
  if (justified) tags.push("Growth-justified");
  let key, label, cls;
  if (justified && gl.ratio <= 0.9) { key = "buy"; label = "Growth buy (growth justifies P/E)"; cls = "v-under"; }
  else if (justified) { key = "wait"; label = "Quality growth: fair for its growth"; cls = "v-fair"; }
  else if (g && value && inZone) { key = "buy"; label = "Growth + Value buy"; cls = "v-under"; }
  else if (value && inZone) { key = "buy"; label = "Value buy"; cls = "v-under"; }
  else if (g && inZone) { key = "buy"; label = "Growth buy"; cls = "v-under"; }
  else if (g && !rich) { key = "wait"; label = "Growth: wait for a dip"; cls = "v-fair"; }
  else if (g) { key = "expensive"; label = "Growth but expensive"; cls = "v-rich"; }
  else if (value) { key = "wait"; label = "Value: near its zone, watch"; cls = "v-fair"; }
  else if (rich) { key = "expensive"; label = "Expensive: avoid for now"; cls = "v-rich"; }
  else { key = "wait"; label = "Fair to rich: hold or watch"; cls = "v-rich1"; }
  if (r.confidence === "low") label += " (low confidence)";
  return { key, label, cls, tags, inZone, growthScore: g ? g.score : null, growthNotes: g ? g.notes : [], growthJustified: !!justified };
}
