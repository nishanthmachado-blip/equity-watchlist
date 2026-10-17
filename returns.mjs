// True returns: XIRR (annualised, money-weighted) from dated buys, sells and dividends, and the same cash flows put
// into an index instead ("what if every rupee had gone into the Nifty"). Plus dividends actually received and a
// 12-month forward dividend calendar. Pure functions.
const DAY = 864e5;
const t = d => Date.parse(`${String(d).slice(0, 10)}T00:00:00Z`);
const r1 = v => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const R = v => Math.round(v);

// XIRR: the yearly rate r where Σ amount / (1+r)^(years from the first flow) = 0. Newton with a bisection fallback.
export function xirr(flows) {
  const f = flows.filter(x => Number.isFinite(x.amount) && x.amount !== 0 && x.date).map(x => ({ y: t(x.date), a: x.amount })).sort((a, b) => a.y - b.y);
  if (f.length < 2 || !f.some(x => x.a > 0) || !f.some(x => x.a < 0)) return null;
  const y0 = f[0].y, yrs = f.map(x => (x.y - y0) / (365 * DAY));
  if (yrs.at(-1) < 1 / 365) return null;
  const npv = r => f.reduce((s, x, i) => s + x.a / Math.pow(1 + r, yrs[i]), 0);
  const d = r => f.reduce((s, x, i) => s - yrs[i] * x.a / Math.pow(1 + r, yrs[i] + 1), 0);
  let r = 0.1;
  for (let i = 0; i < 60; i++) { const v = npv(r), dv = d(r); if (!Number.isFinite(v) || !Number.isFinite(dv) || dv === 0) break; const n = r - v / dv; if (!Number.isFinite(n) || n <= -0.9999) break; if (Math.abs(n - r) < 1e-7) return n; r = n; }
  let lo = -0.9999, hi = 10, vlo = npv(lo), vhi = npv(hi); if (vlo * vhi > 0) return null;
  for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2, vm = npv(m); if (Math.abs(vm) < 1e-6) return m; if (vlo * vm < 0) { hi = m; vhi = vm; } else { lo = m; vlo = vm; } }
  return (lo + hi) / 2;
}
// Last close on or before a day from [{t (unix s), c}] (oldest first)
export function closeOn(bars, day) {
  const ts = t(day) / 1000 + 86399; let lo = 0, hi = bars.length - 1, ans = null;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (bars[m].t <= ts) { ans = bars[m]; lo = m + 1; } else hi = m - 1; }
  return ans?.c ?? null;
}
// Same flows into the index: buys buy index units, sells and dividends take rupees out; today the units are worth units × index.
export function indexTwin(flows, bars, today) {
  if (!bars?.length) return null;
  const first = flows.reduce((m, x) => (x.date < m ? x.date : m), "9999");
  if (closeOn(bars, first) === null) return { tooShort: true, from: new Date(bars[0].t * 1000).toISOString().slice(0, 10) };
  let units = 0; const out = [];
  for (const x of [...flows].sort((a, b) => a.date.localeCompare(b.date))) {
    if (x.terminal) continue;
    const c = closeOn(bars, x.date); if (!c) continue;
    units += -x.amount / c; out.push({ date: x.date, amount: x.amount });
  }
  const last = closeOn(bars, today); if (!last) return null;
  const value = units * last; out.push({ date: today, amount: value, terminal: true });
  const rate = xirr(out);
  return { xirr: rate === null ? null : r1(rate * 100), value: R(value) };
}
// Shares held at the end of the day before `day` (who gets a dividend with ex-date `day`)
export function qtyHeldBefore(trades, day) { let q = 0; for (const x of trades) if (x.date < day) q += x.side === "buy" ? x.qty : -x.qty; return Math.max(0, q); }

// Returns for each stock and in total. trades: [{symbol, date, side, qty, price}], holdings: [{symbol, qty, price}],
// dividends: [{symbol, exDate, amount}], benchmarks: { NIFTY50: bars, … }.
export function returnsView({ trades = [], holdings = [], dividends = [], benchmarks = {}, today, label = "All accounts" }) {
  const bySym = new Map();
  for (const x of trades) { if (!x.symbol || !(x.qty > 0) || !(x.price > 0) || !x.date) continue; (bySym.get(x.symbol) || bySym.set(x.symbol, []).get(x.symbol)).push(x); }
  for (const l of bySym.values()) l.sort((a, b) => a.date.localeCompare(b.date));
  const hold = new Map(holdings.filter(h => h.symbol && h.qty > 0).map(h => [h.symbol, h]));
  const rows = [], all = [], missing = [];
  for (const [sym, tr] of bySym) {
    const flows = tr.map(x => ({ date: x.date, amount: (x.side === "buy" ? -1 : 1) * x.qty * x.price }));
    let divIncome = 0;
    for (const d of dividends) if (d.symbol === sym && d.exDate <= today && d.exDate > tr[0].date && d.amount > 0) { const q = qtyHeldBefore(tr, d.exDate); if (q > 0) { flows.push({ date: d.exDate, amount: q * d.amount, dividend: true }); divIncome += q * d.amount; } }
    const qtyNow = qtyHeldBefore(tr, "9999-12-31"), h = hold.get(sym), price = h?.price ?? null;
    if (qtyNow > 0 && !(price > 0)) { missing.push(sym); continue; }
    const value = qtyNow > 0 ? qtyNow * price : 0;
    if (value > 0) flows.push({ date: today, amount: value, terminal: true });
    const invested = tr.filter(x => x.side === "buy").reduce((s, x) => s + x.qty * x.price, 0), soldFor = tr.filter(x => x.side === "sell").reduce((s, x) => s + x.qty * x.price, 0);
    const gain = value + soldFor + divIncome - invested, rate = xirr(flows);
    const bench = Object.fromEntries(Object.entries(benchmarks).map(([k, bars]) => [k, indexTwin(flows, bars, today)]));
    rows.push({ symbol: sym, name: h?.name || sym, open: qtyNow > 0, qty: qtyNow, firstBuy: tr[0].date, invested: R(invested), value: R(value), soldFor: R(soldFor), dividends: R(divIncome), gain: R(gain), xirr: rate === null ? null : r1(rate * 100), bench });
    all.push(...flows);
  }
  const total = (() => {
    const rate = xirr(all), sum = k => rows.reduce((s, r) => s + r[k], 0);
    return { label, xirr: rate === null ? null : r1(rate * 100), invested: R(sum("invested")), value: R(sum("value")), soldFor: R(sum("soldFor")), dividends: R(sum("dividends")), gain: R(sum("gain")), from: rows.length ? rows.map(r => r.firstBuy).sort()[0] : null, bench: Object.fromEntries(Object.entries(benchmarks).map(([k, bars]) => [k, indexTwin(all, bars, today)])) };
  })();
  // Holdings with no dated buys in the tradebook: only a simple return is possible
  const undated = [...hold.values()].filter(h => !bySym.has(h.symbol) && h.avgPrice > 0).map(h => ({ symbol: h.symbol, name: h.name || h.symbol, qty: h.qty, invested: R(h.qty * h.avgPrice), value: R(h.qty * h.price), gainPct: r1((h.price / h.avgPrice - 1) * 100) }));
  return { total, rows: rows.sort((a, b) => b.value - a.value || b.invested - a.invested), undated, missingPrice: missing };
}

// Dividends paid on what you held: [{symbol, exDate, amount, qty, income, approx}] between from and to.
// With a tradebook the quantity is what you held the day before the ex-date; without, today's quantity (marked approx).
export function dividendsReceived({ trades = [], holdings = [], dividends = [], from, to }) {
  const bySym = new Map(); for (const x of trades) (bySym.get(x.symbol) || bySym.set(x.symbol, []).get(x.symbol)).push(x);
  const nowQty = new Map(holdings.map(h => [h.symbol, h.qty]));
  const out = [];
  for (const d of dividends) {
    if (!(d.amount > 0) || d.exDate < from || d.exDate > to) continue;
    const tr = bySym.get(d.symbol); let qty, approx = false;
    if (tr?.length) qty = qtyHeldBefore(tr.sort((a, b) => a.date.localeCompare(b.date)), d.exDate);
    else { qty = nowQty.get(d.symbol) || 0; approx = true; }
    if (qty > 0) out.push({ symbol: d.symbol, exDate: d.exDate, amount: d.amount, qty, income: R(qty * d.amount), approx });
  }
  return out.sort((a, b) => b.exDate.localeCompare(a.exDate));
}
// Next 12 months: announced dividends exactly, otherwise last year's dividends repeated in the same month, × shares held now.
export function forwardDividends({ holdings = [], dividends = [], today }) {
  const in12 = new Date(t(today) + 365 * DAY).toISOString().slice(0, 10), lastYear = new Date(t(today) - 365 * DAY).toISOString().slice(0, 10);
  const months = new Map(), rows = [];
  for (const h of holdings) {
    if (!(h.qty > 0)) continue;
    const ds = dividends.filter(d => d.symbol === h.symbol && d.amount > 0);
    const announced = ds.filter(d => d.exDate > today && d.exDate <= in12);
    const past = ds.filter(d => d.exDate > lastYear && d.exDate <= today);
    const items = [...announced.map(d => ({ month: d.exDate.slice(0, 7), amount: d.amount, sure: true, exDate: d.exDate })),
      ...past.filter(p => !announced.some(a => a.exDate.slice(5, 7) === p.exDate.slice(5, 7))).map(d => { const y = Number(d.exDate.slice(0, 4)) + 1; return { month: `${y}${d.exDate.slice(4, 7)}`, amount: d.amount, sure: false }; })];
    for (const it of items) { const inc = it.amount * h.qty; const m = months.get(it.month) || { month: it.month, income: 0, sure: 0, items: [] }; m.income += inc; if (it.sure) m.sure += inc; m.items.push({ symbol: h.symbol, perShare: it.amount, income: R(inc), sure: it.sure, exDate: it.exDate || null }); months.set(it.month, m); }
    const yearly = items.reduce((s, x) => s + x.amount, 0) * h.qty; if (yearly > 0) rows.push({ symbol: h.symbol, qty: h.qty, perShareYear: Math.round(items.reduce((s, x) => s + x.amount, 0) * 100) / 100, income: R(yearly), yieldPct: h.price > 0 ? r1(items.reduce((s, x) => s + x.amount, 0) / h.price * 100) : null });
  }
  const list = [...months.values()].map(m => ({ ...m, income: R(m.income), sure: R(m.sure) })).sort((a, b) => a.month.localeCompare(b.month));
  return { months: list, total: R(list.reduce((s, m) => s + m.income, 0)), rows: rows.sort((a, b) => b.income - a.income) };
}
// FIFO trades of one swing book (open lots + closed trades) as cash flows
export function swingFlows(swing, prices, today) {
  const flows = [];
  for (const c of swing.closed || []) { for (const l of (c.lots?.length ? c.lots : [{ qty: c.qty, price: c.buyAvg, at: c.openedAt || c.closedAt }])) flows.push({ date: String(l.at).slice(0, 10), amount: -l.qty * l.price }); flows.push({ date: String(c.closedAt).slice(0, 10), amount: c.qty * c.sellPrice }); }
  let value = 0;
  for (const p of swing.positions || []) { for (const l of (p.lots?.length ? p.lots : [{ qty: p.qty, price: p.avgPrice, at: p.openedAt || today }])) flows.push({ date: String(l.at).slice(0, 10), amount: -l.qty * l.price }); const pr = prices.get(p.symbol)?.price; if (pr > 0) value += p.qty * pr; }
  if (value > 0) flows.push({ date: today, amount: value, terminal: true });
  const rate = xirr(flows);
  return { flows, xirr: rate === null ? null : r1(rate * 100), value: R(value) };
}
