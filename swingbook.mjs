// Swing book: your swing trading built only from what your brokers say. Nothing typed into the old journal is used.
// Closed trades = short-term and intraday sales of stocks and ETFs in the combined P&L (tax P&L reports you import,
// tradebooks, Dhan's history, the daily pick-up and trades you add here). Open swing positions = shares bought in the
// last 12 months that the trades on file show you still hold. Pure functions.
import { TAX_RULES, ltDate } from "./tax.mjs";

const r0 = v => Math.round(v || 0), r2 = v => Math.round(v * 100) / 100;
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

// sales: pnlView().trades; lots: open FIFO lots [{ account, key, symbol, isin, date, qty, price }]; price(symbol) → ₹;
// labels: account id → label; covered: account id → last day its tax report covers
// reportOpen: [{ account, accountLabel, broker, asOf, positions: [{ name, isin, qty, avg, close, unrealised }] }] from a
// report that lists open positions (Dhan's P&L report); used for an account when no buys of it are on file
export function swingBook({ sales = [], lots = [], reportOpen = [], symbolOf = () => null, price = () => null, labels = new Map(), names = new Map(), covered = new Map(), fy, today, slabRate = 0.3 } = {}) {
  const swingSale = r => !["mf", "us", "debt"].includes(r.kind) && ["STCG", "Intraday"].includes(r.term) && r.qty > 0;
  // one row per account, stock, sale day and kind (intraday / short term); reports without dates: one row per stock
  const G = new Map();
  for (const r of sales) {
    if (!swingSale(r)) continue;
    const day = r.noDates ? "period" : r.sellDate, k = `${r.account}|${r.isin || r.symbol}|${day}|${r.term}`;
    const g = G.get(k) || G.set(k, { k, account: r.account, accountLabel: r.accountLabel, symbol: r.symbol, name: r.name, isin: r.isin || null, day, noDates: !!r.noDates, periodTo: r.noDates ? r.sellDate : null, intraday: r.term === "Intraday", qty: 0, buyValue: 0, sellValue: 0, gain: 0, charges: 0, buyDay: null, src: r.src }).get(k);
    g.qty += r.qty; g.buyValue += r.qty * (r.buy || 0); g.sellValue += r.qty * (r.sell || 0); g.gain += r.gain || 0; g.charges += r.charges || 0;
    if (r.buyDate && (!g.buyDay || r.buyDate < g.buyDay)) g.buyDay = r.buyDate;
  }
  const closed = [...G.values()].map(g => ({ k: g.k, account: g.account, accountLabel: g.accountLabel, symbol: g.symbol, name: g.name, isin: g.isin, sellDay: g.noDates ? null : g.day, noDates: g.noDates, periodTo: g.periodTo, intraday: g.intraday,
    buyDay: g.buyDay, days: g.buyDay && !g.noDates ? Math.max(0, daysBetween(g.buyDay, g.day)) : null, qty: Math.round(g.qty * 1000) / 1000, buyAvg: g.qty ? r2(g.buyValue / g.qty) : null, sellAvg: g.qty ? r2(g.sellValue / g.qty) : null,
    invested: r0(g.buyValue), gain: r0(g.gain), pct: g.buyValue ? r2(g.gain / g.buyValue * 100) : null, charges: r0(g.charges), net: r0(g.gain - g.charges), src: g.src }))
    .sort((a, b) => String(b.sellDay || b.periodTo).localeCompare(String(a.sellDay || a.periodTo)) || b.gain - a.gain);
  // the numbers that matter for a swing trader
  const wins = closed.filter(c => c.gain > 0), losses = closed.filter(c => c.gain < 0), sum = a => a.reduce((x, c) => x + c.gain, 0);
  const winSum = sum(wins), lossSum = -sum(losses), dated = closed.filter(c => c.days !== null);
  const st = closed.filter(c => !c.intraday), intra = closed.filter(c => c.intraday), stNet = sum(st), intraNet = sum(intra);
  const stats = { trades: closed.length, wins: wins.length, losses: losses.length, winRate: closed.length ? r0(wins.length / closed.length * 100) : null,
    gain: r0(winSum - lossSum), charges: r0(closed.reduce((a, c) => a + c.charges, 0)), net: r0(winSum - lossSum - closed.reduce((a, c) => a + c.charges, 0)),
    avgWin: wins.length ? r0(winSum / wins.length) : null, avgLoss: losses.length ? r0(lossSum / losses.length) : null, profitFactor: lossSum ? r2(winSum / lossSum) : null,
    avgDays: dated.length ? r0(dated.reduce((a, c) => a + c.days, 0) / dated.length) : null, best: wins.length ? wins.reduce((a, c) => (c.gain > a.gain ? c : a)) : null, worst: losses.length ? losses.reduce((a, c) => (c.gain < a.gain ? c : a)) : null,
    invested: r0(closed.reduce((a, c) => a + c.invested, 0)),
    // tax on these swing trades alone (the Tax view has your full tax, after set-off with everything else)
    tax: { shortTerm: r0(stNet), intraday: r0(intraNet), estimate: r0(Math.max(0, stNet) * TAX_RULES.stRate + Math.max(0, intraNet) * slabRate), slabRate } };
  const byMonth = new Map(); for (const c of closed) { if (!c.sellDay) continue; const m = c.sellDay.slice(0, 7), g = byMonth.get(m) || { month: m, trades: 0, gain: 0, wins: 0 }; g.trades++; g.gain += c.gain; if (c.gain > 0) g.wins++; byMonth.set(m, g); }
  const months = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)).map(m => ({ ...m, gain: r0(m.gain) }));
  const periodTotals = closed.filter(c => c.noDates).reduce((a, c) => a + c.gain, 0);
  const byAcc = new Map(); for (const c of closed) { const g = byAcc.get(c.account) || { account: c.account, label: c.accountLabel, trades: 0, gain: 0, wins: 0 }; g.trades++; g.gain += c.gain; if (c.gain > 0) g.wins++; byAcc.set(c.account, g); }
  const accounts = [...byAcc.values()].map(a => ({ ...a, gain: r0(a.gain), winRate: a.trades ? r0(a.wins / a.trades * 100) : null })).sort((a, b) => b.gain - a.gain);
  // open swing positions: lots bought within 12 months, still held according to the trades on file
  const O = new Map();
  for (const l of lots) {
    if (!(l.qty > 1e-9) || daysBetween(l.date, today) > 365) continue;
    const k = `${l.account}|${l.key || l.isin || l.symbol}`, sym = l.symbol || l.key, o = O.get(k) || O.set(k, { account: l.account, accountLabel: labels.get(l.account) || l.account, symbol: sym, name: names.get(l.key) || names.get(sym) || null, qty: 0, cost: 0, first: l.date, lots: [] }).get(k);
    o.qty += l.qty; o.cost += l.qty * l.price; if (l.date < o.first) o.first = l.date; o.lots.push({ date: l.date, qty: Math.round(l.qty * 1000) / 1000, price: r2(l.price), longFrom: ltDate(l.date) });
  }
  const withLots = new Set(lots.filter(l => l.qty > 1e-9).map(l => l.account));
  for (const R of reportOpen) {
    if (withLots.has(R.account)) continue;
    for (const p of R.positions || []) if (p.qty > 0) O.set(`${R.account}|${p.isin || p.name}`, { account: R.account, accountLabel: R.accountLabel, symbol: (p.isin && symbolOf(p.isin)) || p.name, name: p.name, qty: p.qty, cost: p.qty * p.avg, first: null, lots: [], fromReport: { broker: R.broker, asOf: R.asOf, close: p.close } });
  }
  const open = [...O.values()].map(o => {
    const live = price(o.symbol), p = Number.isFinite(live) ? live : o.fromReport?.close ?? null, value = Number.isFinite(p) ? p * o.qty : null;
    return { ...o, qty: Math.round(o.qty * 1000) / 1000, avg: o.qty ? r2(o.cost / o.qty) : null, cost: r0(o.cost), price: Number.isFinite(p) ? p : null, priceFrom: Number.isFinite(live) ? "live" : o.fromReport ? "report" : null, value: value === null ? null : r0(value), pnl: value === null ? null : r0(value - o.cost), pct: value === null || !o.cost ? null : r2((value / o.cost - 1) * 100),
      days: o.first ? daysBetween(o.first, today) : null, longFrom: o.first ? ltDate(o.first) : null };
  }).sort((a, b) => (b.value ?? b.cost) - (a.value ?? a.cost));
  const openTot = { cost: r0(open.reduce((a, o) => a + o.cost, 0)), value: r0(open.reduce((a, o) => a + (o.value ?? o.cost), 0)) }; openTot.pnl = openTot.value - openTot.cost;
  const notes = [];
  if (periodTotals) notes.push(`₹${r0(periodTotals).toLocaleString("en-IN")} comes from a report without sale dates (Dhan): counted in the totals, not in the months.`);
  for (const [acc, to] of covered) notes.push(`${labels.get(acc) || acc}: its tax P&L report covers sales up to ${to}; trades after that come from trades on file.`);
  return { fy: fy?.label || fy, closed, stats, months, accounts, open, openTotals: openTot, notes, today };
}

// A trade you add by hand (a fill the broker's file doesn't have yet): it goes into the same tradebook the Tax view uses
export function sanitizeManualTrade(b = {}, today) {
  const date = String(b.date || "").slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) throw new Error("Pick the trade date (not in the future).");
  const side = b.side === "sell" ? "sell" : b.side === "buy" ? "buy" : null; if (!side) throw new Error("Buy or sell?");
  const symbol = String(b.symbol || "").trim().toUpperCase().replace(/^NSE:/, ""); if (!/^[A-Z0-9&-]{1,20}$/.test(symbol)) throw new Error("Enter the NSE symbol, e.g. INFY.");
  const qty = Number(String(b.qty ?? "").replace(/,/g, "")), price = Number(String(b.price ?? "").replace(/[,₹\s]/g, ""));
  if (!(qty > 0 && qty <= 1e7)) throw new Error("Enter the quantity."); if (!(price > 0 && price <= 1e7)) throw new Error("Enter the price.");
  const account = String(b.account || "").slice(0, 60); if (!account) throw new Error("Pick the account.");
  return { key: symbol, symbol, isin: null, date, side, qty, price, account, src: "manual", tradeId: `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` };
}
