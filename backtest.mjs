// Backtest a swing setup on past daily bars: "how would the 52-week-high breakout have done on my stocks?"
// Walks each stock's history day by day with exactly the rules the Swing ideas scan uses today (swingideas.mjs:
// snapshot + detectSetups), so a past signal is what the scan would have shown that evening. A signal is bought at the
// next day's open; it is sold at the stop, the target or the trailing stop (whichever is hit first; the stop wins when
// both fall inside one day), or at the close after the maximum number of days. One trade per stock at a time.
// Costs (brokerage, STT, slippage) are taken off each trade as a round-trip percentage. Pure: the server supplies bars.
import { snapshot, detectSetups, SETUP_INFO } from "./swingideas.mjs";

const fin = v => Number.isFinite(v);
const r2 = v => (fin(v) ? Math.round(v * 100) / 100 : null);
const r1 = v => (fin(v) ? Math.round(v * 10) / 10 : null);
export const BACKTEST_SETUPS = Object.fromEntries(Object.entries(SETUP_INFO).filter(([k]) => k !== "value").map(([k, v]) => [k, v.label])); // "value" needs past valuations
export const BACKTEST_EXITS = { t1: "Target 1 or the stop", t2: "Target 2 or the stop", trail: "Trailing stop (2 × ATR) after entry" };
const WINDOW = 300; // bars the scan looks at: 252 for the 52-week high, 200 + 20 for a rising 200-DMA

export function sanitizeBacktest(b = {}) {
  const setup = BACKTEST_SETUPS[b.setup] ? b.setup : "high52", exit = BACKTEST_EXITS[b.exit] ? b.exit : "t1";
  const md = Math.round(Number(b.maxDays)), maxDays = fin(md) && md >= 3 && md <= 120 ? md : 30;
  const c = Number(b.costPct), costPct = fin(c) && c >= 0 && c <= 2 ? c : 0.25;
  return { setup, exit, maxDays, costPct };
}

function atrSeries(b, n = 14) {
  const out = new Array(b.length).fill(null); if (b.length <= n) return out;
  const tr = i => { const h = b[i].h ?? b[i].c, l = b[i].l ?? b[i].c, pc = b[i - 1].c; return Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)); };
  let a = 0; for (let i = 1; i <= n; i++) a += tr(i); a /= n; out[n] = a;
  for (let i = n + 1; i < b.length; i++) { a = (a * (n - 1) + tr(i)) / n; out[i] = a; }
  return out;
}
const dayOf = t => new Date((t + 19800) * 1000).toISOString().slice(0, 10);

// bars: [{ t (unix s), o, h, l, c, v }] oldest first → trades [{ entryDay, entry, exitDay, exit, pct, days, why }]
export function backtestBars(bars, params = {}) {
  const { setup, exit, maxDays, costPct } = sanitizeBacktest(params);
  const b = (bars || []).filter(x => x && fin(x.c) && x.c > 0).map(x => ({ ...x, o: fin(x.o) && x.o > 0 ? x.o : x.c, h: fin(x.h) ? x.h : x.c, l: fin(x.l) ? x.l : x.c }));
  const trades = [], A = atrSeries(b), start = Math.min(260, b.length);
  let signals = 0;
  for (let i = start; i < b.length - 1; i++) {
    const s = snapshot(b.slice(Math.max(0, i - WINDOW + 1), i + 1)); if (!s) continue;
    const idea = detectSetups(s).find(x => x.setup === setup); if (!idea) continue;
    signals++;
    const e = i + 1, entry = b[e].o; let stop = idea.stop;
    if (!(entry > stop)) continue; // gapped below the stop: no trade
    const target = exit === "t2" ? idea.t2 : exit === "t1" ? idea.t1 : null;
    let j = e, out = null, why = null, high = entry;
    for (; j < b.length && j <= e + maxDays; j++) {
      const d = b[j];
      if (d.l <= stop) { out = Math.min(d.o, stop); why = exit === "trail" && stop > idea.stop ? "trailing stop" : "stop"; break; }
      if (target && d.h >= target) { out = Math.max(d.o, target); why = "target"; break; }
      if (j === e + maxDays) { out = d.c; why = "time"; break; }
      if (exit === "trail") { high = Math.max(high, d.c); if (fin(A[j])) stop = Math.max(stop, high - 2 * A[j]); }
    }
    if (out === null) { j = b.length - 1; out = b[j].c; why = "open"; } // still open on the last bar: valued at its close
    const pct = (out / entry - 1) * 100 - costPct;
    trades.push({ entryDay: dayOf(b[e].t), entry: r2(entry), stop: r2(idea.stop), target: r2(target), exitDay: dayOf(b[j].t), exit: r2(out), pct: r2(pct), days: j - e + (why === "open" ? 0 : 1), why });
    i = j; // one trade at a time: the next signal is looked for after this exit
  }
  return { trades, signals, bars: b.length, from: b.length ? dayOf(b[0].t) : null, to: b.length ? dayOf(b.at(-1).t) : null };
}

// Totals over trades from many stocks: [{ ...trade, symbol }]
export function summarize(trades = []) {
  const t = [...trades].filter(x => fin(x.pct)).sort((a, b) => a.exitDay.localeCompare(b.exitDay) || a.entryDay.localeCompare(b.entryDay));
  if (!t.length) return { trades: 0 };
  const wins = t.filter(x => x.pct > 0), losses = t.filter(x => x.pct <= 0), avg = a => (a.length ? a.reduce((s, x) => s + x.pct, 0) / a.length : null);
  let streak = 0, worstStreak = 0, eq = 0, peak = 0, maxDd = 0;
  for (const x of t) {
    streak = x.pct <= 0 ? streak + 1 : 0; worstStreak = Math.max(worstStreak, streak);
    eq += x.pct; peak = Math.max(peak, eq); maxDd = Math.max(maxDd, peak - eq); // ₹ per trade held the same: % points of one position
  }
  const gw = wins.reduce((s, x) => s + x.pct, 0), gl = -losses.reduce((s, x) => s + x.pct, 0);
  const years = new Map(); for (const x of t) { const y = x.exitDay.slice(0, 4), g = years.get(y) || { year: y, trades: 0, wins: 0, sum: 0 }; g.trades++; if (x.pct > 0) g.wins++; g.sum += x.pct; years.set(y, g); }
  const why = {}; for (const x of t) why[x.why] = (why[x.why] || 0) + 1;
  return {
    trades: t.length, wins: wins.length, winRate: r1(wins.length / t.length * 100), avgPct: r2(avg(t)), avgWinPct: r2(avg(wins)), avgLossPct: r2(avg(losses)),
    avgDays: Math.round(t.reduce((s, x) => s + x.days, 0) / t.length), worstStreak, profitFactor: gl > 0 ? r2(gw / gl) : null, best: t.reduce((a, x) => (x.pct > a.pct ? x : a)), worst: t.reduce((a, x) => (x.pct < a.pct ? x : a)),
    per100k: Math.round(t.reduce((s, x) => s + x.pct, 0) * 1000), maxDrawdownPct: r1(maxDd), exits: why,
    years: [...years.values()].map(g => ({ year: g.year, trades: g.trades, winRate: r1(g.wins / g.trades * 100), avgPct: r2(g.sum / g.trades) })).sort((a, b) => a.year.localeCompare(b.year))
  };
}

// Per-stock rows for the table, best first
export function perStock(results = []) {
  return results.filter(r => r.trades.length).map(r => { const s = summarize(r.trades); return { symbol: r.symbol, name: r.name, trades: s.trades, winRate: s.winRate, avgPct: s.avgPct, totalPct: r2(r.trades.reduce((a, x) => a + x.pct, 0)) }; })
    .sort((a, b) => b.totalPct - a.totalPct);
}
