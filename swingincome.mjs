// Swing income tracker: are your swing trades on course for a monthly income (default ₹1 L a month after tax)?
// From your own closed trades: booked profit by month against the target, how often you hit it, win rate and payoff,
// losing streaks and the worst dip, and from your real return on the money you trade with, the capital it would take.
// Short-term gains tax (20% + 4% cess) is taken off. Pure functions.
const fin = v => Number.isFinite(v);
const r0 = v => Math.round(v || 0), r1 = v => Math.round(v * 10) / 10;
export const INCOME_DEFAULTS = Object.freeze({ target: 100000, taxRate: 0.208, minTrades: 20, minMonths: 6 });
const ym = d => String(d).slice(0, 7);
const addM = (m, n) => { const [y, mo] = m.split("-").map(Number), d = new Date(Date.UTC(y, mo - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const istDay = iso => new Date(new Date(iso).getTime() + 19800e3).toISOString().slice(0, 10);

// closed: [{ pnl, qty, buyAvg, openedAt, closedAt, symbol }]; capital: the money you swing-trade with today
export function swingIncome(closed = [], { target = INCOME_DEFAULTS.target, capital = null, today = istDay(new Date().toISOString()), taxRate = INCOME_DEFAULTS.taxRate } = {}) {
  const trades = closed.filter(t => t.closedAt && fin(Number(t.pnl))).map(t => ({ ...t, pnl: Number(t.pnl), day: istDay(t.closedAt), cost: fin(t.buyAvg) && fin(t.qty) ? t.buyAvg * t.qty : null,
    days: t.openedAt ? Math.max(1, Math.round((new Date(t.closedAt) - new Date(t.openedAt)) / 864e5)) : null })).sort((a, b) => a.day.localeCompare(b.day));
  const preTax = target / (1 - taxRate), now = ym(today);
  // the last 12 months (with empty months shown), oldest first
  const first = trades.length ? ym(trades[0].day) : now, from = first > addM(now, -11) ? first : addM(now, -11);
  const months = []; for (let m = from; m <= now; m = addM(m, 1)) months.push(m);
  const by = new Map(months.map(m => [m, { month: m, pnl: 0, trades: 0, wins: 0 }]));
  for (const t of trades) { const g = by.get(ym(t.day)); if (g) { g.pnl += t.pnl; g.trades++; if (t.pnl > 0) g.wins++; } }
  const series = months.map(m => { const g = by.get(m); return { ...g, pnl: r0(g.pnl), afterTax: r0(g.pnl > 0 ? g.pnl * (1 - taxRate) : g.pnl), hit: g.pnl >= preTax }; });
  const done = series.filter(s => s.month < now), cur = series.find(s => s.month === now) || { pnl: 0, trades: 0 };
  const recent = trades.filter(t => ym(t.day) >= months[0]);
  // per trade
  const wins = recent.filter(t => t.pnl > 0), losses = recent.filter(t => t.pnl <= 0);
  const avgWin = wins.length ? wins.reduce((a, t) => a + t.pnl, 0) / wins.length : 0, avgLoss = losses.length ? -losses.reduce((a, t) => a + t.pnl, 0) / losses.length : 0;
  const winRate = recent.length ? wins.length / recent.length : null, expectancy = recent.length ? recent.reduce((a, t) => a + t.pnl, 0) / recent.length : null;
  let streak = 0, worstStreak = 0, run = 0, peak = 0, dd = 0, eq = 0;
  for (const t of recent) { if (t.pnl <= 0) { run++; worstStreak = Math.max(worstStreak, run); } else run = 0; eq += t.pnl; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  for (let i = recent.length - 1; i >= 0 && recent[i].pnl <= 0; i--) streak++;
  const span = Math.max(1, done.length + (cur.trades ? 1 : 0)), total = recent.reduce((a, t) => a + t.pnl, 0);
  const perMonth = total / span, tradesPerMonth = recent.length / span;
  // money actually at work: each trade's cost × days held, spread over the period
  const periodDays = Math.max(30, span * 30.4), deployed = recent.reduce((a, t) => a + (t.cost && t.days ? t.cost * Math.min(t.days, periodDays) : 0), 0) / periodDays;
  const base = fin(capital) && capital > 0 ? capital : deployed > 0 ? deployed : null;
  const yearly = base ? perMonth * 12 / base : null; // return a year on your swing capital
  const needYear = preTax * 12, capitalNeeded = yearly > 0 ? r0(needYear / yearly) : null;
  const enough = recent.length >= INCOME_DEFAULTS.minTrades && span >= INCOME_DEFAULTS.minMonths;
  const verdict = !recent.length ? { tone: "info", text: "No closed swing trades in the last 12 months yet. Book a few through Swing (Sell) and this tracker fills in by itself." }
    : !enough ? { tone: "info", text: `Too early to judge: ${recent.length} trade${recent.length === 1 ? "" : "s"} over ${span} month${span === 1 ? "" : "s"}. Give it at least ${INCOME_DEFAULTS.minTrades} trades and ${INCOME_DEFAULTS.minMonths} months before you plan around this income.` }
    : perMonth >= preTax ? { tone: "ok", text: `On track: ₹${r0(perMonth).toLocaleString("en-IN")} a month on average, above the ₹${r0(preTax).toLocaleString("en-IN")} needed before tax.` }
    : perMonth > 0 ? { tone: "warn", text: `Profitable but short of the target: ₹${r0(perMonth).toLocaleString("en-IN")} a month against ₹${r0(preTax).toLocaleString("en-IN")} needed before tax.${capitalNeeded ? ` At your ${r1(yearly * 100)}% a year, that takes about ₹${(capitalNeeded / 1e5).toFixed(1)} L of swing capital.` : ""}` }
    : { tone: "warn", text: "Losing money over this period: fix the system (entries, stops, position size) before adding capital. The By setup and By mistake tables show where." };
  return {
    target, preTax: r0(preTax), taxRate, series, current: { month: now, pnl: r0(cur.pnl), trades: cur.trades, pct: preTax > 0 ? Math.max(0, Math.min(100, Math.round(cur.pnl / preTax * 100))) : 0 },
    stats: { trades: recent.length, months: span, total: r0(total), perMonth: r0(perMonth), perMonthAfterTax: r0(perMonth > 0 ? perMonth * (1 - taxRate) : perMonth), hitMonths: done.filter(s => s.hit).length, lossMonths: done.filter(s => s.pnl < 0).length, closedMonths: done.length,
      best: done.length ? Math.max(...done.map(s => s.pnl)) : null, worst: done.length ? Math.min(...done.map(s => s.pnl)) : null,
      winRate: winRate === null ? null : Math.round(winRate * 100), avgWin: r0(avgWin), avgLoss: r0(avgLoss), payoff: avgLoss > 0 ? Math.round(avgWin / avgLoss * 100) / 100 : null, expectancy: r0(expectancy), tradesPerMonth: r1(tradesPerMonth),
      avgDays: recent.filter(t => t.days).length ? Math.round(recent.filter(t => t.days).reduce((a, t) => a + t.days, 0) / recent.filter(t => t.days).length) : null, losingStreak: streak, worstStreak, maxDip: r0(dd) },
    capital: { yours: fin(capital) ? r0(capital) : null, deployed: r0(deployed), base: base ? r0(base) : null, yearlyPct: yearly === null ? null : r1(yearly * 100), needed: capitalNeeded, gap: capitalNeeded && fin(capital) ? Math.max(0, capitalNeeded - r0(capital)) : null },
    enough, verdict
  };
}
