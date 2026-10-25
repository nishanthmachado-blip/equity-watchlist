// "What do I do now?" — one call per stock across your holdings, favourites and long-term theme stocks, so you are
// not juggling the Focus list, Holdings clean-up, Swing and Themes screens to decide.
// Each stock gets ONE lane:
//   buy     Long-term: buy now        good business (quality ≥ 55) at a fair or cheap price (in / near its buy zone)
//   wait    Long-term: wait for price  good business, but priced above its buy zone; shows the price to wait for
//   swing   Swing trade                a chart setup today (entry / stop / target); the business need not be a keeper
//   hold    Hold, don't add            you own it, it is fine, nothing to do
//   trim    Trim / exit                the clean-up review says Trim or Exit, or the business is weak
//   skip    Skip                       not owned and not good enough (or not enough data to judge)
// Plus a "Top 5 now": the best long-term buys for the market you are in. In a weak market (Nifty below its 200-day
// average or 10%+ off its high) the ranking leans to quality and to stocks holding up better than the index, and
// buys are split into parts. Pure functions: the server passes saved data only (no outside site).
import { qualityScore, valuationScore } from "./focus.mjs";
const fin = v => Number.isFinite(v);
const r1 = v => Math.round(v * 10) / 10;
export const DECIDE = { goodQuality: 55, weakQuality: 35, fairValue: 50, nearZonePct: 5, maxWeight: 12, top: 5, maxPerSector: 2 };

// Nifty (NIFTYBEES bars) → the market you are in
export function marketMood(bars = []) {
  const c = bars.map(b => b?.c).filter(v => fin(v) && v > 0), n = c.length;
  if (n < 60) return { mood: "unknown", label: "Market trend unknown", text: "No Nifty history yet: it arrives with the next swing scan." };
  const price = c[n - 1], sma = (k, end = n) => { const s = c.slice(Math.max(0, end - k), end); return s.reduce((a, v) => a + v, 0) / s.length; };
  const sma200 = n >= 200 ? sma(200) : null, high = Math.max(...c.slice(-252)), off = r1((1 - price / high) * 100), ret3m = n > 63 ? r1((price / c[n - 64] - 1) * 100) : null;
  const below = sma200 !== null && price < sma200;
  const mood = off >= 20 ? "bear" : off >= 10 || below ? "weak" : off >= 5 ? "dip" : "strong";
  const label = { bear: "Bear market", weak: "Weak market", dip: "Mild dip", strong: "Healthy market" }[mood];
  const text = mood === "strong" ? `Nifty is ${off}% off its high and above its 200-day average. Buy good businesses at fair prices; don't chase.`
    : mood === "dip" ? `Nifty is ${off}% off its high. A normal pullback: a good time to add to quality names already in their buy zone.`
    : `Nifty is ${off}% off its 1-year high${below ? " and below its 200-day average" : ""}. Weak markets reward patience: buy only the best businesses, in 3 parts (now, −5%, −10%), keep your reserve untouched, and keep swing positions small.`;
  return { mood, label, text, offHigh: off, belowSma200: below, ret3m };
}

// items: [{ symbol, name, sources:[...], row (valuation row) | null, snap | null, held: { value, weightPct, pnlPct } | null, review: { verdict, reasons } | null, swing: idea | null }]
export function decide(items = [], { market = marketMood([]), cash = null } = {}) {
  const weak = market.mood === "weak" || market.mood === "bear";
  const rows = items.map(it => {
    const r = it.row, q = r ? qualityScore(r) : null, quality = q?.score ?? null, value = r ? valuationScore(r) : null, s = it.snap;
    const price = r?.price ?? s?.price ?? null, zoneHigh = r?.zoneHigh ?? null, zoneLow = r?.zoneLow ?? null;
    const awayPct = fin(price) && fin(zoneHigh) && zoneHigh > 0 ? r1((price / zoneHigh - 1) * 100) : null; // + = above the buy zone
    const trend = s?.sma200 ? (s.price >= s.sma200 ? (s.sma200Ago && s.sma200 >= s.sma200Ago ? "up" : "flat") : "down") : null;
    const offHigh = s?.high52 ? r1((1 - s.price / s.high52) * 100) : null, rs = fin(s?.rs3m) ? s.rs3m : null;
    // holding up vs Nifty, above the 200-DMA, not in free fall: 0–100
    const resilience = s ? Math.round(Math.max(0, Math.min(100, 50 + (rs ?? 0) * 2.5 + (trend === "up" ? 20 : trend === "down" ? -20 : 0) - Math.max(0, (offHigh ?? 0) - 30)))) : null;
    const why = [], against = [];
    if (q) { why.push(...q.notes.slice(0, 3)); against.push(...q.flags.slice(0, 2)); }
    let lane, action;
    const good = quality !== null && quality >= DECIDE.goodQuality, poor = quality !== null && quality < DECIDE.weakQuality;
    const priced = value !== null && (value >= DECIDE.fairValue || (awayPct !== null && awayPct <= DECIDE.nearZonePct));
    const over = it.held?.weightPct > DECIDE.maxWeight;
    if (it.review && (it.review.verdict === "Exit" || it.review.verdict === "Trim")) { lane = "trim"; action = it.review.verdict === "Exit" ? "Exit (see Holdings clean-up for tax timing)" : "Trim to a normal size"; against.push(...(it.review.reasons || []).filter(x => x.tone === "against").map(x => x.text).slice(0, 2)); }
    else if (it.held && poor) { lane = "trim"; action = "Weak business: don't add; plan an exit"; }
    else if (good && priced && !over) { lane = "buy"; action = weak ? "Buy in 3 parts: now, at −5%, at −10%" : awayPct !== null && awayPct > 0 ? `Buy in parts; ideal below ₹${Math.round(zoneHigh).toLocaleString("en-IN")}` : "Buy / add now"; }
    else if (good && !priced) { lane = "wait"; action = fin(zoneHigh) ? `Wait for ₹${Math.round(zoneHigh).toLocaleString("en-IN")} or lower${awayPct !== null ? ` (${awayPct}% away)` : ""}` : "Wait for a better price"; }
    else if (it.swing && it.swing.score >= 50) { lane = "swing"; action = `${it.swing.label}: entry ₹${it.swing.entry}, stop ₹${it.swing.stop} (−${it.swing.riskPct}%), target ₹${it.swing.t1} (+${it.swing.t1Pct}%)`; }
    else if (it.held) { lane = "hold"; action = over ? `Hold; already ${r1(it.held.weightPct)}% of your stocks, don't add` : "Hold; nothing to do"; }
    else { lane = "skip"; action = quality === null ? "Not enough data to judge (fundamentals not fetched yet)" : "Not a long-term keeper at these numbers"; }
    if (good && it.swing?.score >= 50 && lane !== "swing") why.push(`Also a swing setup: ${it.swing.label}`);
    if (trend === "down") against.push("Below its 200-day average");
    if (rs !== null && rs >= 5) why.push(`Beat Nifty by ${rs} pts in 3 months`); else if (rs !== null && rs <= -10) against.push(`Lagged Nifty by ${-rs} pts in 3 months`);
    if (over) against.push(`Already ${r1(it.held.weightPct)}% of your stocks`);
    // ranking for the Top 5: quality first; value; in weak markets also how well it is holding up
    const rank = lane === "buy" ? (quality * (weak ? 0.5 : 0.45) + value * (weak ? 0.25 : 0.4) + (resilience ?? 50) * (weak ? 0.25 : 0.15)) : null;
    return { symbol: it.symbol, name: it.name || r?.company || it.symbol, sources: it.sources || [], sector: r?.sector || r?.industry || null, price, quality, value, view: r?.view || null, verdict: r?.verdict?.label || null,
      zoneLow, zoneHigh, awayPct, fair: r?.fairValue?.base ?? null, trend, offHigh, rs3m: rs, resilience, held: it.held || null, lane, action, why: [...new Set(why)].slice(0, 4), against: [...new Set(against)].slice(0, 3),
      swing: it.swing ? { label: it.swing.label, score: it.swing.score, entry: it.swing.entry, stop: it.swing.stop, t1: it.swing.t1, riskPct: it.swing.riskPct, t1Pct: it.swing.t1Pct } : null, rank: rank === null ? null : Math.round(rank) };
  });
  // Top 5: best long-term buys, at most 2 per sector so one sector's fall can't sink all five
  const top = [], perSector = new Map();
  for (const r of rows.filter(x => x.lane === "buy").sort((a, b) => b.rank - a.rank)) {
    const k = r.sector || r.symbol; if ((perSector.get(k) || 0) >= DECIDE.maxPerSector) continue;
    perSector.set(k, (perSector.get(k) || 0) + 1); top.push(r.symbol); if (top.length >= DECIDE.top) break;
  }
  // nearly there: good businesses closest to their buy zone (the next ones to watch)
  const next = rows.filter(r => r.lane === "wait" && r.awayPct !== null).sort((a, b) => a.awayPct - b.awayPct).slice(0, 5).map(r => r.symbol);
  const LANES = ["buy", "swing", "wait", "hold", "trim", "skip"];
  const order = r => (top.includes(r.symbol) ? -1 : LANES.indexOf(r.lane));
  rows.sort((a, b) => order(a) - order(b) || (b.rank ?? -1) - (a.rank ?? -1) || (a.awayPct ?? 999) - (b.awayPct ?? 999) || (b.swing?.score ?? 0) - (a.swing?.score ?? 0) || (b.quality ?? -1) - (a.quality ?? -1));
  const counts = Object.fromEntries(LANES.map(l => [l, rows.filter(r => r.lane === l).length]));
  // a sensible split of new money across the Top 5 (equal parts; in weak markets a third now)
  let split = null;
  if (fin(cash) && cash > 0 && top.length) { const each = cash / top.length, nowShare = weak ? 1 / 3 : 1; split = { cash: Math.round(cash), each: Math.round(each), now: Math.round(each * nowShare), parts: weak ? 3 : 1 }; }
  const tips = [];
  if (!top.length) tips.push(counts.wait ? `None of your good businesses is at a fair price right now. ${next.length ? `Closest: ${next.slice(0, 3).join(", ")}.` : ""} Waiting is a valid decision: keep new money in your arbitrage fund until one gets there.` : "No long-term buys in your list: add stocks you like to Favourites or a Theme and refresh their fundamentals.");
  if (counts.trim) tips.push(`${counts.trim} stock${counts.trim === 1 ? "" : "s"} to trim or exit: freeing that money for the Top 5 is often better than new money.`);
  if (weak && counts.swing) tips.push("Swing trades in a weak market fail more often: keep position sizes small and respect the stop.");
  if (rows.filter(r => r.quality === null).length > rows.length / 3) tips.push("Many stocks have no fundamentals yet, so they can't be judged: open them once (or refresh the watchlist) to fetch the numbers.");
  return { market, rows, top, next, counts, split, tips, rules: DECIDE };
}
