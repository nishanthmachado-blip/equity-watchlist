// Focus list: ranks the stocks you hold so you can concentrate on the best 25-30 and see which to trim or exit.
// Score = 65% business quality (returns on capital, growth, balance sheet, cash conversion, promoter, dividend) + 35% valuation,
// minus penalties for a broken thesis or stale / thin data. Actions follow the rank, the price and the position size.
// A rule-based aid on cached fundamentals; it ignores tax, your goals and anything the numbers do not capture. Pure.
import { growthScore } from "./classify.mjs";
const fin = v => Number.isFinite(v);
const clamp01 = x => Math.max(0, Math.min(1, x));
const r0 = v => Math.round(v);
export const FOCUS = { minN: 10, maxN: 40, defaultN: 30, accumulateMinQuality: 55, accumulateMaxRatio: 1.3, maxWeight: 12, concentration: 20, exitQuality: 35 };

export function qualityScore(r) {
  const fin_ = r.profile === "financial", q = fin_ ? r.roe : r.roce, notes = [], flags = [];
  let pts = 0, max = 0;
  const add = (v, w) => { pts += v * w; max += w; };
  if (fin(q)) { add(clamp01((q - 8) / 17), 30); if (q >= 20) notes.push(`${fin_ ? "ROE" : "ROCE"} ${r0(q)}%`); if (q < 10) flags.push(`Low ${fin_ ? "ROE" : "ROCE"} ${r0(q)}%`); }
  const g = [r.salesCagr3, r.profitCagr3].filter(fin);
  if (g.length) { const gm = Math.min(...g); add(clamp01((gm + 5) / 25), 25); if (gm >= 15) notes.push(`${r0(gm)}%+ 3-yr growth`); if (fin(r.profitCagr3) && r.profitCagr3 < 0) flags.push("Profits shrinking"); }
  if (!fin_ && fin(r.borrowings) && fin(r.reserves) && r.reserves > 0) { const lev = r.borrowings / r.reserves; add(clamp01(1 - lev), 15); if (lev < 0.2) notes.push("Low debt"); if (lev > 1) flags.push("Borrowings above reserves"); }
  if (fin(r.cfoToProfit3) || fin(r.fcfNegative)) { add(fin(r.cfoToProfit3) ? clamp01(r.cfoToProfit3 / 1) : 0.5, 10); add(r.fcfNegative === 1 ? 0 : r.fcfNegative === 0 ? 1 : 0.5, 5); if (r.cfoToProfit3 >= 0.9) notes.push("Profits turn into cash"); if (r.cfoToProfit3 < 0.5) flags.push("Weak cash conversion"); if (r.fcfNegative === 1) flags.push("Negative free cash flow"); }
  if (fin(r.promoter)) { add(clamp01(r.promoter / 60) - (r.promoterChange3y < -5 ? 0.4 : 0), 10); if (r.promoterChange3y < -5) flags.push(`Promoters sold ${Math.abs(r0(r.promoterChange3y))} pts in 3 yrs`); }
  if (r.dividend) { add(r.dividend.safety === "Safe" ? 1 : r.dividend.safety === "Watch" ? 0.6 : r.dividend.safety === "At risk" ? 0.2 : 0.4, 5); if (r.dividend.safety === "Safe" && r.dividend.yield >= 2) notes.push(`Safe ${r.dividend.yield}% dividend`); }
  return { score: max ? r0(Math.max(0, pts) / max * 100) : null, notes, flags, growth: growthScore(r) };
}
export function valuationScore(r) {
  if (!fin(r.ratio)) return null;
  const gl = r.growthLens && growthScore(r) ? growthLensScore(r.growthLens.ratio) : null; // fast compounders judged on growth too
  const st = staticScore(r);
  return gl === null ? st : Math.max(st, Math.round(gl * 0.9));
}
function growthLensScore(ratio) { return ratio <= 0.8 ? 100 : ratio <= 1 ? 100 - (ratio - 0.8) / 0.2 * 22 : ratio <= 1.3 ? 78 - (ratio - 1) / 0.3 * 28 : ratio <= 2 ? 50 - (ratio - 1.3) / 0.7 * 50 : 0; }
function staticScore(r) {
  const pts = [[0.8, 100], [1.0, 78], [1.15, 65], [1.3, 50], [1.6, 30], [2.5, 8]];
  let s = 0; if (r.ratio <= 0.8) s = 100; else { for (let i = 1; i < pts.length; i++) if (r.ratio <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; s = y0 + (y1 - y0) * (r.ratio - x0) / (x1 - x0); break; } if (r.ratio > 2.5) s = 0; }
  if ((r.status === "In zone" || r.status === "Below zone") && !r.floored) s += 8;
  return r0(Math.min(100, s));
}

// holdings: [{ symbol, company, value, weightPct, stance?, thesis? }]; rowsBySym: valuation rows (with verdict, dividend);
// candidates: valuation rows not held (for ideas).
export function rankFocus({ holdings, rowsBySym, candidates = [], n = FOCUS.defaultN }) {
  n = Math.max(FOCUS.minN, Math.min(FOCUS.maxN, Math.round(n) || FOCUS.defaultN));
  const total = holdings.reduce((a, h) => a + (h.value || 0), 0);
  const scoreRow = (r, extra = {}) => {
    if (!r || !fin(r.ratio)) return null;
    const q = qualityScore(r), v = valuationScore(r);
    if (q.score === null || v === null) return null;
    let s = 0.65 * q.score + 0.35 * v; const pen = [];
    if (extra.thesis === "Broken") { s -= 15; pen.push("Your thesis is broken"); }
    if (r.stale) { s -= 5; pen.push("Fundamentals over 90 days old"); }
    if (r.confidence === "low") { s -= 10; pen.push("Thin (NSE-only) data"); }
    return { score: r0(Math.max(0, s)), quality: q.score, valuation: v, notes: q.notes, flags: [...q.flags, ...pen] };
  };
  const scored = holdings.map(h => ({ h, r: rowsBySym[h.symbol], s: scoreRow(rowsBySym[h.symbol], { thesis: h.thesis?.status }) }));
  const ranked = scored.filter(x => x.s).sort((a, b) => b.s.score - a.s.score);
  const unvalued = scored.filter(x => !x.s);
  const focusN = Math.min(n, ranked.length);
  // Ideas to round out the focus list when you hold fewer stocks than the list size
  const held = new Set(holdings.map(h => h.symbol));
  const ideas = ranked.length < n ? candidates.filter(r => !held.has(String(r.symbol).toUpperCase()) && r.verdict && ["buy", "wait"].includes(r.verdict.key))
    .map(r => ({ r, s: scoreRow(r) })).filter(x => x.s && x.s.quality >= FOCUS.accumulateMinQuality).sort((a, b) => b.s.score - a.s.score).slice(0, n - ranked.length)
    .map(({ r, s }) => ({ symbol: r.symbol, company: r.company, score: s.score, quality: s.quality, valuation: s.valuation, verdict: r.verdict.label, verdictCls: r.verdict.cls, strengths: s.notes.slice(0, 3) })) : [];
  // Equal weight across the whole focus list (your top holdings plus any ideas that complete it)
  const target = focusN + ideas.length ? 100 / (focusN + ideas.length) : 0;
  const rows = ranked.map((x, i) => {
    const { h, r, s } = x, rank = i + 1, w = h.weightPct ?? (total > 0 ? h.value / total * 100 : 0), rich = r.view === "Rich" || r.view === "Very rich";
    const redFlags = s.flags.length, inFocus = rank <= focusN;
    let action, why;
    if (h.stance?.action === "Review" && /Avoid/.test(h.stance.reasons?.map(z => z.text).join(" ") || "")) { action = "Exit"; why = "You rated it Avoid but still hold it."; }
    else if ((s.quality < FOCUS.exitQuality && (s.valuation < 40 || redFlags >= 2)) || (h.thesis?.status === "Broken" && s.quality < 50)) { action = "Exit"; why = s.quality < FOCUS.exitQuality ? `Weak business quality (${s.quality}/100)${redFlags ? `: ${s.flags.slice(0, 2).join(", ")}` : ""}.` : "Thesis broken and quality is middling."; }
    else if (w >= FOCUS.concentration || (rich && w > Math.max(1.5 * target, 8)) || (!inFocus && w > Math.max(1.5 * target, 6))) { action = "Trim"; why = w >= FOCUS.concentration ? `${r0(w)}% of the portfolio is a lot in one stock.` : rich ? `Priced ${r.view.toLowerCase()} and already ${r0(w)}% of the portfolio.` : `Outside your top ${focusN} but ${r0(w)}% of the portfolio.`; }
    else if (inFocus && s.quality >= FOCUS.accumulateMinQuality && r.ratio < FOCUS.accumulateMaxRatio && w < FOCUS.maxWeight) { action = "Accumulate"; why = (r.status === "In zone" || r.status === "Below zone") && !r.floored ? "Good business and in its buy zone." : "Good business at a reasonable price; add in stages."; }
    else if (inFocus) { action = "Hold"; why = s.quality < FOCUS.accumulateMinQuality ? `In your top group, but quality is only average (${s.quality}/100)${rich ? " and it is expensive" : ""}.` : r.ratio >= FOCUS.accumulateMaxRatio ? "Good business, but expensive now: add only on dips." : "Keep; the position is already large."; }
    else { action = s.quality < 50 ? "Exit" : "Hold"; why = s.quality < 50 ? `Ranks ${rank} of ${ranked.length} with average-to-weak quality: candidate to recycle into your top ${focusN}.` : `Ranks ${rank}: keep, but your new money is better spent on the top ${focusN}.`; }
    // Hold never says "add" (it is a hold); Accumulate never says "reduce". Gaps under half a target weight are left alone.
    let targetW = action === "Accumulate" ? Math.max(w, target) : action === "Hold" ? Math.min(w, Math.max(target, FOCUS.maxWeight)) : action === "Trim" ? Math.min(w, Math.max(target, FOCUS.maxWeight * (w >= FOCUS.concentration ? 1 : 0.67))) : 0;
    if (Math.abs(targetW - w) < target / 2 && action !== "Exit") targetW = w;
    const move = total > 0 ? r0((targetW - w) / 100 * total) : null;
    return { rank, symbol: h.symbol, company: h.company || r.company, action, why, score: s.score, quality: s.quality, valuation: s.valuation, view: r.view, verdict: r.verdict?.label || null, verdictCls: r.verdict?.cls || null, weightPct: Math.round(w * 10) / 10, targetPct: Math.round(targetW * 10) / 10, move, strengths: s.notes.slice(0, 3), concerns: s.flags.slice(0, 3), inFocus };
  });
  for (const x of unvalued) rows.push({ rank: null, symbol: x.h.symbol, company: x.h.company || x.h.symbol, action: "Review", why: "No valuation yet: add it to the watchlist and fetch fundamentals.", score: null, weightPct: x.h.weightPct ?? null, targetPct: null, move: null, strengths: [], concerns: [], inFocus: false });
  const count = a => rows.filter(x => x.action === a).length;
  return { n: focusN, requestedN: n, targetPct: Math.round(target * 10) / 10, total: r0(total), rows, ideas, counts: { Accumulate: count("Accumulate"), Hold: count("Hold"), Trim: count("Trim"), Exit: count("Exit"), Review: count("Review") } };
}
