// Model portfolio: an asset mix for the investor's risk profile and time horizon, and an equity basket picked from the
// stocks this app has valued, scored for the chosen style (dividend / growth / value / blend). Pure functions.
import { qualityScore, valuationScore } from "./focus.mjs";

export const PROFILES = {
  conservative: { label: "Conservative", mix: { equity: 40, debt: 50, gold: 10 }, maxWeight: 8, sectorCap: 20, minLargePct: 70, allowSmall: false, minQuality: 60, maxLeverage: 0.5, maxRatio: 1.3, n: 15, expected: 9 },
  balanced: { label: "Balanced", mix: { equity: 60, debt: 30, gold: 10 }, maxWeight: 9, sectorCap: 25, minLargePct: 50, allowSmall: true, maxSmallPct: 15, minQuality: 50, maxLeverage: 1, maxRatio: 1.6, n: 20, expected: 10.5 },
  aggressive: { label: "Aggressive", mix: { equity: 80, debt: 10, gold: 10 }, maxWeight: 10, sectorCap: 30, minLargePct: 25, allowSmall: true, maxSmallPct: 40, minQuality: 40, maxLeverage: 1.5, maxRatio: 2.2, n: 25, expected: 12 }
};
export const STYLES = {
  dividend: { label: "Dividend income", blurb: "Steady, well-covered dividends from profitable, low-debt companies." },
  growth: { label: "Growth", blurb: "Fast, durable earnings growth with high returns on capital; pays up for quality." },
  value: { label: "Value", blurb: "Good businesses priced below the model's fair value, avoiding value traps." },
  blend: { label: "All-weather blend", blurb: "Quality first, then valuation: a core portfolio across styles." }
};
const fin = v => Number.isFinite(v);
const clamp01 = v => Math.max(0, Math.min(1, v));
const r1 = v => Math.round(v * 10) / 10;

// Time horizon tempers the mix: under 3 years equity is mostly replaced by debt; 3–5 years trims it.
export function assetMix(profile, years) {
  const p = PROFILES[profile] || PROFILES.balanced, mix = { ...p.mix }, notes = [];
  if (fin(years) && years < 3) { const cut = Math.max(0, mix.equity - 20); mix.debt += mix.equity - cut; mix.equity = cut; notes.push("Goal is under 3 years away: money needed that soon should mostly sit in debt (FDs, short-duration or liquid funds), not stocks."); }
  else if (fin(years) && years < 5) { const cut = Math.max(0, mix.equity - 15); mix.debt += 15; mix.equity = cut; notes.push("Goal is 3–5 years away: equity trimmed by 15 points to limit the damage of a bad year near the finish."); }
  else if (fin(years) && years >= 10 && profile !== "conservative") notes.push("10+ year horizon: equity has time to recover from downturns.");
  return { ...mix, notes };
}

// Style score 0–100 for one valuation row.
export function styleScore(r, style) {
  const q = qualityScore(r).score ?? 0, v = valuationScore(r) ?? 0;
  const why = [];
  if (style === "dividend") {
    const d = r.dividend; if (!d || !(d.yield > 0)) return { score: null, why: ["No dividend history"] };
    const y = clamp01(d.yield / 5), safe = d.safety === "Safe" ? 1 : d.safety === "Watch" ? 0.55 : d.safety === "At risk" ? 0.1 : 0.4;
    const streak = clamp01((d.streakYears || 0) / 10), grow = fin(d.cagr5) ? clamp01((d.cagr5 + 5) / 20) : 0.4;
    if (d.yield >= 2) why.push(`${r1(d.yield)}% yield`); if (d.safety === "Safe") why.push("well-covered dividend"); if ((d.streakYears || 0) >= 5) why.push(`${d.streakYears}-yr payout streak`); if (d.cagr5 >= 8) why.push(`dividend growing ${r1(d.cagr5)}%/yr`);
    return { score: Math.round(y * 30 + safe * 25 + streak * 10 + grow * 10 + q * 0.15 + v * 0.1), why };
  }
  if (style === "growth") {
    const g = [r.salesCagr3, r.profitCagr3].filter(fin); if (!g.length) return { score: null, why: ["No growth history"] };
    const gm = Math.min(...g), ret = r.profile === "financial" ? r.roe : r.roce;
    const gs = clamp01(gm / 30), rs = fin(ret) ? clamp01((ret - 10) / 25) : 0.3, er = r.growthLens?.expectedReturn;
    const ers = fin(er) ? clamp01((er - 6) / 14) : v / 100;
    if (gm >= 15) why.push(`${Math.round(gm)}%+ 3-yr growth`); if (ret >= 20) why.push(`${r.profile === "financial" ? "ROE" : "ROCE"} ${Math.round(ret)}%`); if (fin(er) && er >= 12) why.push(`~${r1(er)}%/yr expected return`);
    return { score: Math.round(gs * 35 + rs * 25 + ers * 25 + q * 0.15), why };
  }
  if (style === "value") {
    if (!fin(r.ratio)) return { score: null, why: ["Not valued"] };
    const trap = fin(r.profitCagr3) && r.profitCagr3 < 0;
    if (r.ratio <= 1) why.push(`${Math.round((1 - r.ratio) * 100)}% below fair multiple`); if (r.status === "In zone" || r.status === "Below zone") why.push("in buy zone"); if (trap) why.push("profits shrinking: possible value trap");
    return { score: Math.round(v * 0.6 + q * 0.4 - (trap ? 20 : 0)), why };
  }
  const n = qualityScore(r).notes.slice(0, 2); why.push(...n); if (r.status === "In zone") why.push("in buy zone");
  return { score: Math.round(q * 0.6 + v * 0.4), why };
}

// rows: valuation rows; held: Set of symbols you own. Returns picks with weights that respect the profile's caps.
export function buildModel({ rows = [], profile = "balanced", style = "blend", amount = 0, n = null, years = null, held = new Set() } = {}) {
  const P = PROFILES[profile] || PROFILES.balanced; n = Math.max(8, Math.min(30, Math.round(n || P.n)));
  const lev = r => (r.profile !== "financial" && fin(r.borrowings) && fin(r.reserves) && r.reserves > 0 ? r.borrowings / r.reserves : null);
  const excluded = { quality: 0, debt: 0, size: 0, price: 0, data: 0 };
  const pool = [];
  for (const r of rows) {
    if (!fin(r.ratio) || !fin(r.price) || r.price <= 0) { excluded.data++; continue; }
    const q = qualityScore(r);
    if ((q.score ?? 0) < P.minQuality) { excluded.quality++; continue; }
    const L = lev(r); if (L !== null && L > P.maxLeverage) { excluded.debt++; continue; }
    if (!P.allowSmall && r.cap === "Small") { excluded.size++; continue; }
    if (r.ratio > P.maxRatio && !(style === "growth" && r.verdict?.growthJustified)) { excluded.price++; continue; }
    const s = styleScore(r, style); if (s.score === null) { excluded.data++; continue; }
    pool.push({ r, q: q.score, s: s.score, why: s.why, flags: q.flags });
  }
  pool.sort((a, b) => b.s - a.s || b.q - a.q);
  // Greedy pick with sector and size limits.
  const picks = [], sectorN = new Map(), maxPerSector = Math.max(1, Math.floor(n * P.sectorCap / 100)), maxSmall = P.allowSmall ? Math.floor(n * (P.maxSmallPct || 0) / 100) : 0;
  let small = 0;
  for (const p of pool) {
    if (picks.length >= n) break;
    const sec = p.r.sector || "Other";
    if ((sectorN.get(sec) || 0) >= maxPerSector) continue;
    if (p.r.cap === "Small" && small >= maxSmall) continue;
    picks.push(p); sectorN.set(sec, (sectorN.get(sec) || 0) + 1); if (p.r.cap === "Small") small++;
  }
  // Weights: proportional to score (floor 50 so the tail still matters), capped per stock, then per sector; re-normalised.
  let w = picks.map(p => Math.max(50, p.s));
  const norm = () => { const t = w.reduce((a, b) => a + b, 0) || 1; w = w.map(x => x / t * 100); };
  norm();
  for (let k = 0; k < 60; k++) {
    let changed = false;
    w = w.map(x => (x > P.maxWeight + 1e-9 ? ((changed = true), P.maxWeight) : x));
    const bySec = new Map(); picks.forEach((p, i) => bySec.set(p.r.sector || "Other", (bySec.get(p.r.sector || "Other") || 0) + w[i]));
    picks.forEach((p, i) => { const t = bySec.get(p.r.sector || "Other"); if (t > P.sectorCap + 1e-9) { w[i] *= P.sectorCap / t; changed = true; } });
    if (P.allowSmall && P.maxSmallPct) { const sm = picks.reduce((a, p, i) => a + (p.r.cap === "Small" ? w[i] : 0), 0); if (sm > P.maxSmallPct + 1e-9) { picks.forEach((p, i) => { if (p.r.cap === "Small") w[i] *= P.maxSmallPct / sm; }); changed = true; } }
    const total = w.reduce((a, b) => a + b, 0); if (total < 99.999) { const secW = new Map(); picks.forEach((p, i) => secW.set(p.r.sector || "Other", (secW.get(p.r.sector || "Other") || 0) + w[i])); const smW = picks.reduce((a, p, i) => a + (p.r.cap === "Small" ? w[i] : 0), 0);
      const free = picks.map((p, i) => i).filter(i => w[i] < P.maxWeight - 1e-6 && secW.get(picks[i].r.sector || "Other") < P.sectorCap - 1e-6 && !(picks[i].r.cap === "Small" && smW >= (P.maxSmallPct || 0) - 1e-6)); const room = free.reduce((a, i) => a + w[i], 0); if (room > 0 && free.length) { free.forEach(i => { w[i] += (100 - total) * w[i] / room; }); changed = true; } }
    if (!changed) break;
  }
  const equityAmount = amount > 0 ? amount * (assetMix(profile, years).equity / 100) : 0;
  const rowsOut = picks.map((p, i) => {
    const r = p.r, weight = r1(w[i]), amt = equityAmount ? Math.round(equityAmount * w[i] / 100) : null;
    const zone = r.status === "In zone" || r.status === "Below zone";
    const how = zone ? "Buy now" : r.ratio <= 1.15 ? "Buy in 2–3 parts" : "Start small, add on dips";
    return { symbol: r.symbol, company: r.company, sector: r.sector || "Other", cap: r.cap || null, price: r.price, weight, amount: amt, shares: amt && r.price ? Math.floor(amt / r.price) : null,
      score: p.s, quality: p.q, verdict: r.verdict?.label || null, verdictCls: r.verdict?.cls || null, status: r.status || null, zoneLow: r.zoneLow ?? null, zoneHigh: r.zoneHigh ?? null,
      pe: r.pe ?? null, yield: r.dividend?.yield ?? null, growth: (g => (g.length ? Math.min(...g) : null))([r.salesCagr3, r.profitCagr3].filter(fin)), why: p.why.slice(0, 3), flags: p.flags.slice(0, 2), how, held: held.has(String(r.symbol).toUpperCase()) };
  });
  const sum = f => r1(rowsOut.reduce((a, x) => a + (f(x) || 0), 0));
  const sectors = [...rowsOut.reduce((m, x) => m.set(x.sector, (m.get(x.sector) || 0) + x.weight), new Map())].map(([s, v]) => ({ sector: s, weight: r1(v) })).sort((a, b) => b.weight - a.weight);
  const capMix = ["Large", "Mid", "Small"].map(c => ({ cap: c, weight: sum(x => (x.cap === c ? x.weight : 0)) })).concat([{ cap: "Unknown", weight: sum(x => (!x.cap ? x.weight : 0)) }]).filter(c => c.weight > 0);
  const wavg = f => { const xs = rowsOut.filter(x => fin(f(x)) && f(x) > 0); const t = xs.reduce((a, x) => a + x.weight, 0); return t ? r1(xs.reduce((a, x) => a + f(x) * x.weight, 0) / t) : null; };
  const harmPE = (() => { const xs = rowsOut.filter(x => x.pe > 0); const t = xs.reduce((a, x) => a + x.weight, 0); return t ? r1(t / xs.reduce((a, x) => a + x.weight / x.pe, 0)) : null; })();
  const warnings = [];
  if (rowsOut.length < n) warnings.push(`Only ${rowsOut.length} of ${n} stocks passed the ${P.label.toLowerCase()} filters. Value more stocks (add them on Value a stock or load a fund's holdings in Mutual fund X-ray) to widen the choice.`);
  const largePct = capMix.find(c => c.cap === "Large")?.weight || 0;
  if (largePct < P.minLargePct && rowsOut.length) warnings.push(`Large caps are ${largePct}% of the basket, below the ${P.minLargePct}% this profile prefers: consider a Nifty 50 index fund for part of the equity.`);
  const mix = assetMix(profile, years);
  return {
    profile, style, profileLabel: P.label, styleLabel: STYLES[style]?.label || style, n, amount, years, mix,
    split: amount > 0 ? { equity: Math.round(amount * mix.equity / 100), debt: Math.round(amount * mix.debt / 100), gold: Math.round(amount * mix.gold / 100) } : null,
    rules: { maxWeight: P.maxWeight, sectorCap: P.sectorCap, minQuality: P.minQuality, maxLeverage: P.maxLeverage, smallCaps: P.allowSmall ? `up to ${P.maxSmallPct}%` : "none", expectedReturn: P.expected },
    rows: rowsOut, sectors, capMix,
    stats: { count: rowsOut.length, avgQuality: wavg(x => x.quality), pe: harmPE, yield: wavg(x => x.yield), growth: wavg(x => x.growth), inZone: rowsOut.filter(x => x.how === "Buy now").length, alreadyHeld: rowsOut.filter(x => x.held).length },
    screened: { candidates: rows.length, passed: pool.length, excluded },
    warnings
  };
}
