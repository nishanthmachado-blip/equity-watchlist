// Growth lens: values a stock on where its earnings could be in 5-10 years, not just on today's P/E.
//   fair value = EPS × (1+g)^5 × (1+g2)^(N-5) × exit P/E ÷ (1+required return)^N      (two-stage growth, then a normal P/E)
//   implied growth = the single yearly growth today's price already assumes over N years (reverse DCF on earnings)
//   expected return = yearly return if that growth happens and the P/E settles at the exit P/E (excludes dividends)
// Default growth comes from the 3-yr history (conservative blend, capped); the person can set their own per stock.
const fin = v => Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r1 = v => Math.round(v * 10) / 10;
export const GL = { years: 10, stage1: 5, exitPE: 20, required: 12, cap: 25 };

export function defaultGrowth(r) {
  const g = [r.salesCagr3, r.profitCagr3].filter(fin);
  if (!g.length) return null;
  const blend = g.length === 2 ? 0.6 * Math.min(...g) + 0.4 * Math.max(...g) : g[0];
  return r1(clamp(blend, 0, GL.cap));
}

// Where the P/E settles once growth slows: better businesses keep a higher multiple.
export function defaultExitPE(r) { const q = r.profile === "financial" ? r.roe : r.roce; return !fin(q) ? GL.exitPE : q >= 25 ? 25 : q >= 15 ? 20 : 15; }
export function growthLens(r, ov = {}) {
  const pe = r.pe, price = r.price;
  if (!(pe > 0) || !(price > 0)) return null;
  const g1 = fin(ov.growth) ? clamp(ov.growth, -10, 60) : defaultGrowth(r);
  if (g1 === null) return null;
  const years = fin(ov.years) ? clamp(Math.round(ov.years), 3, 20) : GL.years, s1 = Math.min(GL.stage1, years);
  const g2 = fin(ov.growth2) ? ov.growth2 : Math.max(6, g1 / 2);
  const exitPE = fin(ov.exitPE) ? clamp(ov.exitPE, 5, 80) : defaultExitPE(r), req = fin(ov.required) ? clamp(ov.required, 4, 30) : GL.required;
  const eps = price / pe;
  const epsAt = (a, b) => eps * Math.pow(1 + a / 100, s1) * Math.pow(1 + b / 100, years - s1);
  const disc = Math.pow(1 + req / 100, years);
  const value = (a, b, x) => epsAt(a, b) * x / disc;
  const base = value(g1, g2, exitPE), bear = value(g1 * 0.7, g2 * 0.8, exitPE * 0.85), bull = value(g1 * 1.2, g2 * 1.1, exitPE * 1.1);
  const implied = (Math.pow(pe * disc / exitPE, 1 / years) - 1) * 100;
  const expectedReturn = (Math.pow(epsAt(g1, g2) * exitPE / price, 1 / years) - 1) * 100;
  const ratio = price / base;
  const verdict = ratio <= 0.9 ? "Undervalued for its growth" : ratio <= 1.1 ? "Fairly priced for its growth" : ratio <= 1.4 ? "Pricey even with growth" : "Price needs more growth than likely";
  const dp = price < 100 ? 2 : 0, rnd = v => Number(v.toFixed(dp));
  return { growth: g1, growth2: r1(g2), years, exitPE, required: req, custom: Object.keys(ov).some(k => fin(ov[k])), fair: { bear: rnd(bear), base: rnd(base), bull: rnd(bull) }, ratio: Math.round(ratio * 100) / 100, impliedGrowth: r1(implied), expectedReturn: r1(expectedReturn), peg: g1 > 0 ? Math.round(pe / g1 * 100) / 100 : null, verdict, key: ratio <= 0.9 ? "under" : ratio <= 1.1 ? "fair" : ratio <= 1.4 ? "pricey" : "rich" };
}
