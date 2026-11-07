// Swing journal ↔ broker: every sale you typed into the journal checked against what the broker says you sold (tax P&L
// reports and trades on file, through the combined P&L). Matched sales show any difference in quantity, prices or date;
// sales only in the journal are flagged; short-term sales only at the broker are offered to add. The broker is the
// record: fixes move the journal to the broker's numbers. Pure functions.
import { fyOf } from "./tax.mjs";

const r2 = v => Math.round(v * 100) / 100, r0 = v => Math.round(v || 0);
const istDay = v => { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t + 5.5 * 36e5).toISOString().slice(0, 10) : String(v || "").slice(0, 10); };
const days = (a, b) => Math.round(Math.abs(Date.parse(a) - Date.parse(b)) / 864e5);
const rel = (a, b) => (a && b ? Math.abs(a / b - 1) : 0);
const PRICE_TOL = 0.003, DATE_TOL = 3;

// closed: the journal's closed trades; brokerRows: pnlView().trades (sales at the broker); isinOf(symbol) → ISIN
// isinOf(symbol) → ISIN and symbolOf(ISIN) → NSE symbol (from the scrip master), so a journal "INFY" meets a broker's
// "Infosys / INE009A01021"; a stock matches on either
export function reconcileSwing({ closed = [], brokerRows = [], fy, isinOf = () => null, symbolOf = () => null, ignore = [] } = {}) {
  const F = typeof fy === "string" ? fyOf(`${fy.match(/\d{4}/)[0]}-06-01`) : fy;
  const ign = new Set(ignore);
  // the journal, one entry per stock per sale day
  const J = new Map();
  for (const t of closed) {
    const day = istDay(t.closedAt); if (day < F.from || day > F.to) continue;
    const sym = String(t.symbol || "").toUpperCase(), key = sym, k = `${key}|${day}`, lots = Array.isArray(t.lots) && t.lots.length ? t.lots : [{ qty: t.qty, price: t.buyAvg, at: t.openedAt }];
    const g = J.get(k) || J.set(k, { key, isin: isinOf(sym) || null, symbol: t.symbol, name: t.name, day, ids: [], qty: 0, buyValue: 0, sellValue: 0, pnl: 0, buyDay: null }).get(k);
    g.ids.push(t.id); g.qty += t.qty; g.sellValue += t.qty * t.sellPrice; g.pnl += Number(t.pnl) || 0;
    for (const l of lots) { g.buyValue += l.qty * l.price; const bd = String(l.at || "").slice(0, 10); if (bd && (!g.buyDay || bd < g.buyDay)) g.buyDay = bd; }
  }
  // the broker, one entry per account, stock and sale day (or per stock for the period, for reports without dates)
  const B = new Map();
  for (const r of brokerRows) {
    if (["mf", "us"].includes(r.kind) || r.term === "No buy found" || !(r.qty > 0)) continue;
    // the long-term shares of a sale are investments, not swing: a sale is split into its short- and long-term parts;
    // debt ETFs (liquid / cash parking) count as investments too
    const lt = r.term === "LTCG" || r.term === "Other LT" || r.kind === "debt";
    const isin = r.isin || isinOf(r.symbol) || null, sym = (isin && symbolOf(isin)) || (/^[A-Z0-9&-]{1,20}$/.test(r.symbol || "") ? r.symbol : null);
    const key = isin || r.symbol, day = r.noDates ? "period" : r.sellDate, k = `${r.account}|${key}|${day}|${lt ? "lt" : "st"}`;
    const g = B.get(k) || B.set(k, { k, key, isin, nse: sym, account: r.account, accountLabel: r.accountLabel, symbol: r.symbol, name: r.name, day, noDates: !!r.noDates, to: r.sellDate, qty: 0, buyValue: 0, sellValue: 0, gain: 0, buyDay: null, terms: new Set(), src: r.src, lt }).get(k);
    g.qty += r.qty; g.buyValue += r.qty * (r.buy || 0); g.sellValue += r.qty * (r.sell || 0); g.gain += r.gain || 0; g.terms.add(r.term);
    if (r.buyDate && (!g.buyDay || r.buyDate < g.buyDay)) g.buyDay = r.buyDate;
  }
  const used = new Set(), matched = [], journalOnly = [];
  const same = (j, b) => j.key === b.nse || j.key === b.key || (j.isin && j.isin === b.isin);
  const brokerOf = j => [...B.values()].filter(b => same(j, b) && !used.has(b.k) && !b.lt);
  const jl = [...J.values()].sort((a, b) => a.day.localeCompare(b.day));
  const rest = [];
  for (const j of jl) {
    const c = brokerOf(j).filter(b => !b.noDates && days(b.day, j.day) <= DATE_TOL).sort((a, b) => (Math.abs(a.qty - j.qty) < 1e-6 ? 0 : 1) - (Math.abs(b.qty - j.qty) < 1e-6 ? 0 : 1) || days(a.day, j.day) - days(b.day, j.day));
    if (c.length) { used.add(c[0].k); matched.push(pair([j], c[0])); } else rest.push(j);
  }
  // reports without dates (Dhan): all journal sales of that stock in the year against the broker's total for it
  const byKey = new Map(); for (const j of rest) (byKey.get(j.key) || byKey.set(j.key, []).get(j.key)).push(j);
  for (const [key, js] of byKey) {
    const b = brokerOf(js[0]).find(x => x.noDates);
    if (b) { used.add(b.k); matched.push(pair(js, b)); } else journalOnly.push(...js.map(j => ({ ...j, pnl: r0(j.pnl), buyAvg: j.qty ? r2(j.buyValue / j.qty) : null, sellAvg: j.qty ? r2(j.sellValue / j.qty) : null })));
  }
  const brokerOnly = [], investments = [];
  for (const b of B.values()) {
    if (used.has(b.k)) continue;
    if (ign.has(b.k)) continue;
    (b.lt ? investments : brokerOnly).push(fmtB(b));
  }
  brokerOnly.sort((a, b) => String(b.day).localeCompare(String(a.day)));
  const sameN = matched.filter(m => m.status === "same").length;
  const totals = {
    journal: r0(jl.reduce((a, j) => a + j.pnl, 0)), brokerMatched: r0(matched.reduce((a, m) => a + m.broker.gain, 0)), journalMatched: r0(matched.reduce((a, m) => a + m.journal.pnl, 0)),
    brokerOnly: r0(brokerOnly.reduce((a, b) => a + b.gain, 0)), journalOnly: r0(journalOnly.reduce((a, j) => a + j.pnl, 0))
  };
  totals.swingAtBroker = totals.brokerMatched + totals.brokerOnly;
  return { fy: F.label, matched: matched.sort((a, b) => (a.status === "same") - (b.status === "same") || String(b.journal.day).localeCompare(String(a.journal.day))), journalOnly, brokerOnly, investments: investments.length, investmentsPnl: r0(investments.reduce((a, b) => a + b.gain, 0)),
    counts: { journal: jl.length, matched: matched.length, same: sameN, differ: matched.length - sameN, journalOnly: journalOnly.length, brokerOnly: brokerOnly.length }, totals, ignored: ign.size };
}
function fmtB(b) {
  return { k: b.k, key: b.key, isin: b.isin, nse: b.nse, account: b.account, accountLabel: b.accountLabel, symbol: b.symbol, name: b.name, day: b.noDates ? null : b.day, noDates: b.noDates, to: b.to, qty: Math.round(b.qty * 1000) / 1000,
    buyAvg: b.qty ? r2(b.buyValue / b.qty) : null, sellAvg: b.qty ? r2(b.sellValue / b.qty) : null, buyDay: b.buyDay, gain: r0(b.gain), terms: [...b.terms], src: b.src };
}
function pair(js, b) {
  const j = js.reduce((a, x) => ({ ...a, ids: [...a.ids, ...x.ids], qty: a.qty + x.qty, buyValue: a.buyValue + x.buyValue, sellValue: a.sellValue + x.sellValue, pnl: a.pnl + x.pnl, day: a.day || x.day, days: [...a.days, x.day] }), { ...js[0], ids: [], qty: 0, buyValue: 0, sellValue: 0, pnl: 0, day: null, days: [] });
  const jb = j.qty ? j.buyValue / j.qty : null, jsell = j.qty ? j.sellValue / j.qty : null, br = fmtB(b);
  const diffs = [];
  if (Math.abs(j.qty - b.qty) > 1e-3) diffs.push({ field: "qty", journal: j.qty, broker: br.qty });
  if (rel(jb, br.buyAvg) > PRICE_TOL) diffs.push({ field: "buy", journal: r2(jb), broker: br.buyAvg });
  if (rel(jsell, br.sellAvg) > PRICE_TOL) diffs.push({ field: "sell", journal: r2(jsell), broker: br.sellAvg });
  if (!b.noDates && j.day !== b.day) diffs.push({ field: "date", journal: j.day, broker: b.day });
  // the journal can be moved to the broker's numbers when the quantity agrees and the dates are known
  const fixable = diffs.length > 0 && !diffs.some(d => d.field === "qty") && !b.noDates;
  return { journal: { ids: j.ids, symbol: j.symbol, name: j.name, day: j.day, days: j.days, qty: j.qty, buyAvg: jb ? r2(jb) : null, sellAvg: jsell ? r2(jsell) : null, pnl: r0(j.pnl) }, broker: br, diffs, status: diffs.length ? "differs" : "same", fixable, pnlGap: r0(br.gain - j.pnl) };
}

// Move journal trades to the broker's average prices (and sale date). Returns the new list and the cash change.
export function applyBrokerFix(closed = [], ids = [], { buyAvg, sellAvg, day = null }, tradeDate = d => `${d}T03:45:00.000Z`) {
  const set = new Set(ids); let cash = 0, touched = 0;
  const out = closed.map(t => {
    if (!set.has(t.id)) return t;
    const lots = (Array.isArray(t.lots) && t.lots.length ? t.lots : [{ qty: t.qty, price: t.buyAvg, at: t.openedAt || t.closedAt }]).map(l => ({ ...l, price: r2(buyAvg) }));
    const oldCost = (t.lots?.length ? t.lots : [{ qty: t.qty, price: t.buyAvg }]).reduce((a, l) => a + l.qty * l.price, 0), newCost = lots.reduce((a, l) => a + l.qty * l.price, 0);
    cash += (sellAvg - t.sellPrice) * t.qty - (newCost - oldCost); touched++;
    const closedAt = day && istDay(t.closedAt) !== day ? tradeDate(day) : t.closedAt;
    return { ...t, lots, buyAvg: r2(buyAvg), sellPrice: r2(sellAvg), closedAt, pnl: r2((sellAvg - buyAvg) * t.qty), pnlPct: r2((sellAvg / buyAvg - 1) * 100), fixedFromBroker: true, editedAt: new Date().toISOString() };
  });
  return { closed: out, cashChange: r2(cash), touched };
}
// A sale the broker has but the journal doesn't, as a closed journal trade
export function tradeFromBroker(b, { symbol, name, id, tradeDate = d => `${d}T03:45:00.000Z` }) {
  if (b.noDates || !b.day) throw new Error("This broker report has no dates for the sale: add it to the journal by hand.");
  const buyAt = tradeDate(b.buyDay || b.day), sell = r2(b.sellAvg), buy = r2(b.buyAvg);
  return { id, symbol, name: name || symbol, qty: b.qty, buyAvg: buy, sellPrice: sell, pnl: r2((sell - buy) * b.qty), pnlPct: buy ? r2((sell / buy - 1) * 100) : null, openedAt: buyAt, closedAt: tradeDate(b.day), lots: [{ qty: b.qty, price: buy, at: buyAt }], atTarget: false, setup: null, reason: null, fromBroker: b.accountLabel || true };
}
