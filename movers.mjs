// "This week" on Market today: key indices with day / week / month change, and the top gainers and losers over a day, a
// week or a month, from NSE's own daily files (every listed stock's close). Pure helpers; storage is in server.mjs.

// store: { days: ["2026-10-09", …] ascending, closes: { day: { SYM: [close, tradedValueRs] } } }
export function addMarketDay(store, day, rows, keep = 26) {
  const s = { days: [...(store?.days || [])], closes: { ...(store?.closes || {}) } };
  s.closes[day] = Object.fromEntries(rows.filter(r => r.symbol && r.close > 0).map(r => [r.symbol, [r.close, r.volume && r.close ? Math.round(r.close * r.volume) : null]]));
  if (!s.days.includes(day)) s.days.push(day);
  s.days.sort(); while (s.days.length > keep) delete s.closes[s.days.shift()];
  return s;
}
const r2 = v => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
export const PERIODS = { day: { n: 1, label: "today" }, week: { n: 5, label: "this week" }, month: { n: 21, label: "this month" } };
// universe: Set of symbols (e.g. the Nifty 500) or null = every stock that traded at least minValueCr crore on the last day
export function movers(store, { period = "week", universe = null, minValueCr = 5, minPrice = 10, limit = 10, names = new Map() } = {}) {
  const days = store?.days || [], n = PERIODS[period]?.n ?? 5;
  if (days.length < 2) return { ready: false, have: days.length, need: n + 1 };
  const last = days.at(-1), from = days[Math.max(0, days.length - 1 - n)], L = store.closes[last] || {}, F = store.closes[from] || {};
  const rows = [];
  for (const [sym, [c, val]] of Object.entries(L)) {
    if (universe ? !universe.has(sym) : !(val >= minValueCr * 1e7)) continue;
    const f = F[sym]?.[0]; if (!(f > 0) || !(c >= minPrice)) continue;
    rows.push({ symbol: sym, name: names.get(sym) || sym, price: c, from: f, change: r2((c / f - 1) * 100) });
  }
  rows.sort((a, b) => b.change - a.change);
  return { ready: true, period, asOf: last, from, partial: days.length - 1 < n, count: rows.length, gainers: rows.slice(0, limit), losers: rows.slice(-limit).reverse(), breadth: { up: rows.filter(r => r.change > 0).length, down: rows.filter(r => r.change < 0).length } };
}
// bars: daily closes oldest first ({ t, c }); live: { last, pChange } for intraday. Returns level and % changes.
export function indexChanges(bars, live = null) {
  const c = (bars || []).filter(b => b.c > 0).map(b => b.c);
  const last = live?.last > 0 ? live.last : c.at(-1); if (!(last > 0)) return null;
  const base = live?.last > 0 ? c : c.slice(0, -1); // with a live level every saved close is "before today"
  const back = k => (base.length >= k ? base[base.length - k] : null);
  const pct = v => (v > 0 ? r2((last / v - 1) * 100) : null);
  return { last: r2(last), day: live?.pChange ?? pct(back(1)), week: pct(back(5)), month: pct(back(21)), year: pct(back(250)), asOf: bars?.length ? new Date(bars.at(-1).t * 1000).toISOString().slice(0, 10) : null };
}
