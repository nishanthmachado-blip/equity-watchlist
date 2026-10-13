// Swing ideas: scans daily price charts for four classic, rule-based swing setups and turns each hit into a trade plan
// (entry, stop-loss, targets, risk:reward, position size). Pure functions; the server supplies bars and storage.
//
//   Pullback      uptrend (50-DMA above 200-DMA, price above 200-DMA) that has dipped back to its 20/50-day average
//                 with RSI cooled to 38–55: buy the dip, stop under the recent swing low / 50-DMA.
//   Breakout      close above the 55-day high on 1.5×+ volume, in an uptrend, not stretched (≤ 8% over the 20-day EMA).
//   Bounce        long-term uptrend (above 200-DMA) but oversold (RSI ≤ 35, 8%+ off the 20-day high): mean reversion
//                 to the 20-DMA.
//   Value turn    the app's valuation says "in the buy zone" and the price has just turned up (back above the 20-day EMA).
//
// Not advice: a screen that finds candidates. Every idea shows why it qualified and where it is wrong (the stop).
const fin = v => Number.isFinite(v);
const r2 = v => (fin(v) ? Math.round(v * 100) / 100 : null);
const r1 = v => (fin(v) ? Math.round(v * 10) / 10 : null);
const sma = (a, n, end = a.length) => (end >= n ? a.slice(end - n, end).reduce((s, x) => s + x, 0) / n : null);
function ema(a, n) { if (a.length < n) return null; let e = sma(a.slice(0, n), n); const k = 2 / (n + 1); for (let i = n; i < a.length; i++) e = a[i] * k + e * (1 - k); return e; }
function emaSeries(a, n) { const out = new Array(a.length).fill(null); if (a.length < n) return out; let e = sma(a.slice(0, n), n); out[n - 1] = e; const k = 2 / (n + 1); for (let i = n; i < a.length; i++) { e = a[i] * k + e * (1 - k); out[i] = e; } return out; }
function rsi(closes, n = 14) {
  if (closes.length < n + 1) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) g += d; else l -= d; }
  g /= n; l /= n;
  for (let i = n + 1; i < closes.length; i++) { const d = closes[i] - closes[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}
function atr(b, n = 14) {
  if (b.length < n + 1) return null;
  const tr = []; for (let i = 1; i < b.length; i++) { const h = b[i].h ?? b[i].c, lo = b[i].l ?? b[i].c, pc = b[i - 1].c; tr.push(Math.max(h - lo, Math.abs(h - pc), Math.abs(lo - pc))); }
  let a = tr.slice(0, n).reduce((s, x) => s + x, 0) / n; for (let i = n; i < tr.length; i++) a = (a * (n - 1) + tr[i]) / n; return a;
}

// One stock's indicator snapshot from ~1 year of daily bars ({ c, h, l, v } oldest first). niftyBars: same for the index.
export function snapshot(bars, niftyBars = null) {
  const b = (bars || []).filter(x => x && fin(x.c) && x.c > 0);
  if (b.length < 60) return null;
  const c = b.map(x => x.c), n = c.length, price = c[n - 1], prev = c[n - 2];
  const hi = (k, skip = 0) => Math.max(...b.slice(Math.max(0, n - k - skip), n - skip).map(x => x.h ?? x.c));
  const lo = (k, skip = 0) => Math.min(...b.slice(Math.max(0, n - k - skip), n - skip).map(x => x.l ?? x.c));
  const vols = b.map(x => x.v).filter(fin), vol20 = vols.length >= 21 ? sma(vols.slice(-21, -1), 20) : null, volToday = b[n - 1].v;
  const e20s = emaSeries(c, 20);
  const s = {
    price: r2(price), prevClose: r2(prev), changePct: r2((price / prev - 1) * 100), bars: n,
    sma20: r2(sma(c, 20)), ema20: r2(e20s[n - 1]), sma50: r2(sma(c, 50)), sma200: r2(sma(c, 200)),
    rsi: r1(rsi(c)), rsiPrev: r1(rsi(c.slice(0, -1))), atr: r2(atr(b)),
    high20: r2(hi(20, 1)), low10: r2(lo(10)), low20: r2(lo(20)), high55: r2(hi(55, 1)), high52: r2(hi(252)), low52: r2(lo(252)),
    vol20: vol20 && Math.round(vol20), volRatio: vol20 && fin(volToday) ? r2(volToday / vol20) : null,
    turnoverCr: vol20 ? r2(vol20 * price / 1e7) : null,
    ret1m: n > 21 ? r1((price / c[n - 22] - 1) * 100) : null, ret3m: n > 63 ? r1((price / c[n - 64] - 1) * 100) : null,
    crossedAboveEma20: e20s.slice(-6).some((e, i, arr) => i > 0 && e && c[n - 6 + i - 1] < arr[i - 1] && c[n - 6 + i] > e) && price > e20s[n - 1]
  };
  s.atrPct = s.atr ? r2(s.atr / price * 100) : null;
  if (niftyBars?.length > 64) { const nc = niftyBars.filter(x => fin(x.c)).map(x => x.c), m = nc.length; s.niftyRet3m = r1((nc[m - 1] / nc[m - 64] - 1) * 100); if (fin(s.ret3m)) s.rs3m = r1(s.ret3m - s.niftyRet3m); }
  return s;
}

const SETUP_INFO = {
  pullback: { label: "Pullback in an uptrend", icon: "↘↗", base: 60 },
  breakout: { label: "Breakout on volume", icon: "🚀", base: 60 },
  bounce: { label: "Oversold bounce", icon: "🪃", base: 48 },
  value: { label: "Value stock turning up", icon: "💎", base: 64 }
};
export { SETUP_INFO };

// Setups that fit a snapshot. verdict: the app's valuation for the stock (optional) → { key, view, fairBase, fairBull, inZone }
export function detectSetups(s, verdict = null) {
  if (!s || !fin(s.price)) return [];
  const p = s.price, A = s.atr || p * 0.02, out = [];
  const up = fin(s.sma50) && fin(s.sma200) && s.sma50 > s.sma200 && p > s.sma200;
  const plan = (setup, stop, t1, t2, why) => {
    stop = Math.min(stop, p - 0.5 * A); stop = Math.max(stop, p * 0.88); // stop at least half an ATR away, risk at most 12%
    const risk = p - stop; if (!(risk > 0)) return;
    t1 = Math.min(t1, p * 1.25); t2 = Math.min(t2, p * 1.4); // swing horizon: weeks, not years
    const rr = (t1 - p) / risk; if (!(rr >= 1.5)) return;
    out.push({ setup, entry: r2(p), entryHigh: r2(p * 1.01), stop: r2(stop), riskPct: r2(risk / p * 100), t1: r2(t1), t2: r2(Math.max(t2, t1 * 1.02)), t1Pct: r2((t1 / p - 1) * 100), t2Pct: r2((Math.max(t2, t1 * 1.02) / p - 1) * 100), rr: r2(rr), why });
  };
  // Pullback to the 20/50-day average in an uptrend
  if (up && fin(s.ema20) && fin(s.rsi) && p <= s.ema20 * 1.02 && p >= s.sma50 * 0.98 && s.rsi >= 38 && s.rsi <= 55 && s.high20 >= p * 1.04) {
    const stop = Math.max(Math.min(s.low10 * 0.995, s.sma50 * 0.97), p - 3 * A);
    plan("pullback", stop, Math.max(s.high20, p + 2 * (p - stop)), Math.max(s.high55, p + 3 * (p - stop)),
      [`Uptrend: 50-DMA ₹${s.sma50} above 200-DMA ₹${s.sma200}`, `Dipped to its 20-day average (₹${s.ema20}) with RSI cooled to ${s.rsi}`, `Prior 20-day high ₹${s.high20} is the first target`]);
  }
  // Breakout above the 55-day high on volume
  if (up && fin(s.high55) && p > s.high55 && s.volRatio >= 1.5 && fin(s.ema20) && p <= s.ema20 * 1.08 && s.rsi >= 55 && s.rsi <= 78) {
    const stop = Math.max(s.high55 * 0.97, p - 2 * A), r = p - Math.min(stop, p - 0.5 * A);
    plan("breakout", stop, p + 2 * r, p + 3.5 * r,
      [`Closed above its 55-day high (₹${s.high55}) on ${s.volRatio}× average volume`, `Uptrend and not stretched: ${r1((p / s.ema20 - 1) * 100)}% above the 20-day average`, "Stop just under the breakout level: if it falls back, the breakout failed"]);
  }
  // Oversold bounce in a long-term uptrend
  if (fin(s.sma200) && p > s.sma200 && fin(s.rsi) && s.rsi <= 35 && fin(s.high20) && p <= s.high20 * 0.92 && fin(s.sma20)) {
    const stop = Math.max(Math.min(s.low10 * 0.99, p - 1.5 * A), p - 2.5 * A);
    plan("bounce", stop, s.sma20, s.high20,
      [`Still above its 200-day average (₹${s.sma200}) but oversold: RSI ${s.rsi}`, `${r1((1 - p / s.high20) * 100)}% below its 20-day high`, `First target: back to the 20-day average ₹${s.sma20}`]);
  }
  // Value stock turning up
  if (verdict?.inZone && verdict.key === "buy" && fin(verdict.fairBase) && verdict.fairBase > p && fin(s.ema20) && (s.crossedAboveEma20 || (s.rsiPrev < 40 && s.rsi > s.rsiPrev && p > s.ema20 * 0.99))) {
    const stop = Math.max(s.low20 * 0.98, p - 2.5 * A);
    plan("value", stop, Math.min(verdict.fairBase, p * 1.25), verdict.fairBull || verdict.fairBase * 1.15,
      [`The app values it in its buy zone (${verdict.label || "value buy"})`, `Price just turned up: ${s.crossedAboveEma20 ? "back above" : "holding"} its 20-day average ₹${s.ema20}`, "First target: the model's fair value"]);
  }
  return out;
}

// Score 0–100: the setup itself, trend, strength vs Nifty, volume, risk:reward, valuation and liquidity.
export function scoreIdea(idea, s, verdict = null) {
  let sc = SETUP_INFO[idea.setup].base; const notes = [];
  if (fin(s.sma50) && fin(s.sma200) && s.sma50 > s.sma200) sc += 5;
  if (fin(s.rs3m)) { const b = Math.max(-10, Math.min(10, s.rs3m / 2)); sc += b; if (s.rs3m >= 5) notes.push(`Stronger than Nifty: +${s.rs3m}% over 3 months`); else if (s.rs3m <= -5) notes.push(`Weaker than Nifty: ${s.rs3m}% over 3 months`); }
  if (s.volRatio >= 1.5 && idea.setup !== "breakout") sc += 3;
  sc += Math.max(0, Math.min(10, (idea.rr - 1.5) * 5));
  if (verdict?.key === "buy") { sc += 8; notes.push("Valuation: in its buy zone"); } else if (verdict?.key === "expensive") { sc -= 10; notes.push("Valuation: expensive"); }
  if (fin(s.turnoverCr) && s.turnoverCr < 5) { sc -= 15; notes.push(`Thinly traded (₹${s.turnoverCr} Cr a day)`); }
  if (s.atrPct > 5) { sc -= 5; notes.push(`Volatile: moves ${s.atrPct}% a day on average`); }
  return { score: Math.round(Math.max(0, Math.min(100, sc))), notes };
}

// Shares to buy: risk at most riskPct of capital on the stop, and no more than perTrade in the position.
export function sizeIdea(idea, { capital = null, riskPct = 1, perTrade = 200000 } = {}) {
  const risk = idea.entry - idea.stop; if (!(risk > 0)) return { qty: 0, amount: 0 };
  const byCash = Math.floor(perTrade / idea.entry), byRisk = fin(capital) && capital > 0 ? Math.floor(capital * riskPct / 100 / risk) : Infinity;
  const qty = Math.max(0, Math.min(byCash, byRisk));
  return { qty, amount: Math.round(qty * idea.entry), riskAmount: Math.round(qty * risk), cappedByRisk: byRisk < byCash };
}

// items: [{ symbol, name, snap, verdict }]; held: Set of symbols in positions; watching: Set in the swing watchlist.
export function rankIdeas(items, { held = new Set(), watching = new Set(), sizing = {}, limit = 30 } = {}) {
  const ideas = [];
  for (const it of items) {
    if (!it.snap || held.has(it.symbol)) continue;
    for (const idea of detectSetups(it.snap, it.verdict)) {
      const { score, notes } = scoreIdea(idea, it.snap, it.verdict);
      ideas.push({ ...idea, ...SETUP_INFO[idea.setup] && { label: SETUP_INFO[idea.setup].label, icon: SETUP_INFO[idea.setup].icon }, symbol: it.symbol, name: it.name, exchange: it.exchange || "NSE", score, notes, watching: watching.has(it.symbol), verdict: it.verdict?.label || null, snap: { rsi: it.snap.rsi, sma50: it.snap.sma50, sma200: it.snap.sma200, ema20: it.snap.ema20, volRatio: it.snap.volRatio, rs3m: it.snap.rs3m, atrPct: it.snap.atrPct, turnoverCr: it.snap.turnoverCr, high52: it.snap.high52, low52: it.snap.low52, changePct: it.snap.changePct }, size: sizeIdea(idea, sizing) });
    }
  }
  // one idea per stock (the best-scoring setup), best first
  const best = new Map(); for (const i of ideas) if (!best.has(i.symbol) || best.get(i.symbol).score < i.score) best.set(i.symbol, i);
  return [...best.values()].sort((a, b) => b.score - a.score || b.rr - a.rr).slice(0, limit);
}

// Trend health of a stock you hold, and a trailing stop (the higher of 2 ATR under the price and the 20-day low).
export function positionHealth(s, avgPrice = null) {
  if (!s) return null;
  const p = s.price, trail = r2(Math.max(p - 2 * (s.atr || p * 0.02), s.low20 || 0));
  let state, note;
  if (fin(s.sma200) && p < s.sma200) { state = "weak"; note = `Below its 200-day average (₹${s.sma200}): long-term trend is down`; }
  else if (fin(s.sma50) && p < s.sma50) { state = "caution"; note = `Below its 50-day average (₹${s.sma50}): momentum fading`; }
  else if (fin(s.ema20) && p < s.ema20) { state = "pause"; note = `Dipped under its 20-day average (₹${s.ema20}) in an uptrend`; }
  else { state = "strong"; note = `Above its 20/50/200-day averages`; }
  return { state, note, trail, trailAboveCost: fin(avgPrice) ? trail > avgPrice : null, rsi: s.rsi, rs3m: s.rs3m ?? null };
}
