// Combined P&L across every broker account: realised profit for a financial year split into intraday, short term and
// long term, per account and per account holder (PAN), with charges and an estimated tax. Built from the trades on file
// (Zerodha Console tradebooks, Dhan's trade history, any broker's CSV) with tax.mjs's FIFO: each demat account sells
// its own oldest shares first. Pure functions.
import { fifo, fyOf, taxFor, TAX_RULES } from "./tax.mjs";

const r0 = v => Math.round(v || 0);
const ME = "Me";
// Rough charges for trades that came without them (e.g. Zerodha tradebooks): NSE equity, Zerodha's published rates.
// Delivery: STT 0.1% each side, stamp 0.015% on the buy, exchange 0.00307%, SEBI ₹10/crore, GST 18% on those two, DP
// ₹15.34 per stock per selling day. Intraday: brokerage 0.03% (max ₹20) per side, STT 0.025% on the sell, stamp 0.003%.
export function estimateCharges(r) {
  const buyV = r.qty * (r.buy || 0), sellV = r.qty * r.sell, turn = buyV + sellV, txn = turn * 0.0000307, sebi = turn * 1e-6;
  if (r.intraday) { const brok = Math.min(20, buyV * 0.0003) + Math.min(20, sellV * 0.0003); return brok + sellV * 0.00025 + buyV * 0.00003 + txn + sebi + 0.18 * (brok + txn + sebi); }
  return turn * 0.001 + buyV * 0.00015 + txn + sebi + 0.18 * (txn + sebi);
}
const blank = () => ({ trades: 0, intraday: 0, stGain: 0, stLoss: 0, ltGain: 0, ltLoss: 0, charges: 0, chargesEst: 0 });
function add(acc, r) {
  acc.trades++;
  if (r.intraday) acc.intraday += r.gain; else if (r.long) r.gain >= 0 ? (acc.ltGain += r.gain) : (acc.ltLoss -= r.gain); else r.gain >= 0 ? (acc.stGain += r.gain) : (acc.stLoss -= r.gain);
  if (r.charges !== null && r.charges !== undefined) acc.charges += r.charges; else { const e = estimateCharges(r); acc.charges += e; acc.chargesEst += e; }
}
const finish = a => {
  const gross = a.intraday + a.stGain - a.stLoss + a.ltGain - a.ltLoss;
  return { trades: a.trades, intraday: r0(a.intraday), stGain: r0(a.stGain), stLoss: r0(a.stLoss), ltGain: r0(a.ltGain), ltLoss: r0(a.ltLoss), netSt: r0(a.stGain - a.stLoss), netLt: r0(a.ltGain - a.ltLoss), gross: r0(gross), charges: r0(a.charges), chargesEst: r0(a.chargesEst), net: r0(gross - a.charges) };
};

// trades: [{ account, key, symbol, isin, date, side, qty, price, charges? }]; accounts: [{ id, label, broker }];
// holders: { [accountId]: "name" }; unrealised: { [accountId]: ₹ }; names: Map(key → display name)
export function pnlView({ trades = [], accounts = [], holders = {}, unrealised = {}, names = new Map(), fy: fyLabel = null, today }) {
  const { realised } = fifo(trades);
  const fys = [...new Set([fyOf(today).label, ...realised.map(r => fyOf(r.sellDate).label)])].sort().reverse();
  const want = fys.includes(fyLabel) ? fyLabel : fys[0], fyStart = Number(want.match(/\d{4}/)[0]), fy = fyOf(`${fyStart}-06-01`);
  const known = new Map(accounts.map(a => [a.id, a])), holderOf = id => String(holders[id] || "").trim() || ME;
  const inFy = realised.filter(r => r.sellDate >= fy.from && r.sellDate <= fy.to);
  const byAcc = new Map(), byMonth = new Map(), total = blank();
  for (const r of inFy) {
    if (r.unmatched) continue;
    const id = r.account || "", a = byAcc.get(id) || byAcc.set(id, blank()).get(id); add(a, r); add(total, r);
    const m = byMonth.get(r.sellDate.slice(0, 7)) || byMonth.set(r.sellDate.slice(0, 7), { intraday: 0, st: 0, lt: 0 }).get(r.sellDate.slice(0, 7));
    if (r.intraday) m.intraday += r.gain; else if (r.long) m.lt += r.gain; else m.st += r.gain;
  }
  // every account with trades or holdings gets a row, so a broker with nothing imported is easy to spot
  const span = new Map(); for (const t of trades) { const id = t.account || "", s = span.get(id) || { from: t.date, to: t.date, n: 0, api: false }; s.from = t.date < s.from ? t.date : s.from; s.to = t.date > s.to ? t.date : s.to; s.n++; s.api ||= t.src === "dhan-api"; span.set(id, s); }
  const ids = [...new Set([...accounts.map(a => a.id), ...span.keys()])];
  const rows = ids.map(id => {
    const a = known.get(id), s = span.get(id) || null;
    return { id, label: a?.label || (id ? id : "Not linked to an account"), broker: a?.broker || "", holder: id ? holderOf(id) : ME, ...finish(byAcc.get(id) || blank()),
      unrealised: Number.isFinite(unrealised[id]) ? r0(unrealised[id]) : null, tradesOnFile: s?.n || 0, from: s?.from || null, to: s?.to || null, fromApi: !!s?.api, unmatched: inFy.filter(r => r.unmatched && (r.account || "") === id).length };
  }).filter(r => r.tradesOnFile || r.unrealised !== null);
  // per holder (PAN): set-off and the ₹1.25 L long-term exemption apply once across all their brokers
  const hs = new Map();
  for (const r of rows) {
    const h = hs.get(r.holder) || hs.set(r.holder, { name: r.holder, accounts: [], ...blank(), unrealised: 0 }).get(r.holder);
    h.accounts.push(r.id); for (const k of ["trades", "intraday", "stGain", "stLoss", "ltGain", "ltLoss", "charges", "chargesEst"]) h[k] += r[k]; h.unrealised += r.unrealised || 0;
  }
  const holderRows = [...hs.values()].map(h => { const f = finish(h); return { name: h.name, accounts: h.accounts, ...f, unrealised: r0(h.unrealised), tax: taxFor(h), intradayNote: f.intraday > 0 ? "Intraday profit is business income: added to your income and taxed at your slab rate." : f.intraday < 0 ? "Intraday loss can only be set off against intraday profit (carried forward 4 years)." : null }; });
  const label = id => known.get(id)?.label || id || "—";
  const tradeRows = inFy.sort((a, b) => b.sellDate.localeCompare(a.sellDate)).slice(0, 1500).map(r => ({
    sellDate: r.sellDate, buyDate: r.buyDate, account: r.account || "", accountLabel: label(r.account), symbol: r.symbol || r.isin || r.key, name: names.get(r.key) || names.get(r.symbol) || null,
    qty: Math.round(r.qty * 1000) / 1000, buy: r.buy === null ? null : Math.round(r.buy * 100) / 100, sell: Math.round(r.sell * 100) / 100, gain: r.gain === null ? null : r0(r.gain),
    term: r.unmatched ? "No buy found" : r.intraday ? "Intraday" : r.long ? "LTCG" : "STCG", days: r.buyDate ? Math.round((Date.parse(r.sellDate) - Date.parse(r.buyDate)) / 864e5) : null,
    charges: r.unmatched ? null : r0(r.charges ?? estimateCharges(r)), chargesEst: r.charges === null || r.charges === undefined
  }));
  const months = [...byMonth.entries()].sort().map(([month, m]) => ({ month, intraday: r0(m.intraday), st: r0(m.st), lt: r0(m.lt), total: r0(m.intraday + m.st + m.lt) }));
  const warnings = [];
  for (const r of rows) {
    if (!r.tradesOnFile) warnings.push({ id: r.id, broker: r.broker, text: `${r.label}: no trades on file yet, so its profit is missing from the totals.${/dhan/i.test(r.broker) ? " Use ⟳ Get Dhan trades." : /zerodha|kite/i.test(r.broker) || /^kite|zerodha/i.test(r.id) ? " Import its Console tradebook." : " Import its tradebook CSV."}` });
    else if (r.to && r.to < fy.to && r.to < today && Date.parse(today) - Date.parse(r.to) > 20 * 864e5 && !r.fromApi) warnings.push({ id: r.id, text: `${r.label}: trades on file end on ${r.to}. Import a newer tradebook if you traded after that.` });
    if (r.unmatched) warnings.push({ id: r.id, text: `${r.label}: ${r.unmatched} sale${r.unmatched === 1 ? "" : "s"} in ${fy.label} had no matching buy (bought in an earlier year that isn't imported, or moved in from another demat). Import older tradebooks so their gains count.` });
  }
  return { fy, fys, rules: TAX_RULES, rows, holders: holderRows, total: { ...finish(total), unrealised: r0(rows.reduce((a, r) => a + (r.unrealised || 0), 0)) }, months, trades: tradeRows, tradeCount: inFy.length, warnings, today };
}
