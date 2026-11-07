// Combined P&L across every broker account: realised profit for a financial year per account, per account holder (PAN)
// and per month, with charges and an estimated tax. Two sources per account:
//  - the broker's own tax P&L report (Zerodha Console, INDmoney, …; taxreport.mjs): used as is, up to its last day
//  - trades on file (tradebooks, Dhan's trade history, the daily pick-up) through tax.mjs's FIFO: for accounts without
//    a report, and for sales after a report's last day.
// Tax buckets (taxreport.mjs BUCKETS): intraday, eqSt (20%), eqLt (12.5% above ₹1.25 L), neSt (slab), neLt (12.5%).
// Pure functions.
import { fifo, fyOf, TAX_RULES } from "./tax.mjs";
import { dedupeReports } from "./taxreport.mjs";

const r0 = v => Math.round(v || 0);
const ME = "Me";
// Rough charges for trades that came without them (e.g. Zerodha tradebooks): NSE equity, Zerodha's published rates.
export function estimateCharges(r) {
  const buyV = r.qty * (r.buy || 0), sellV = r.qty * r.sell, turn = buyV + sellV, txn = turn * 0.0000307, sebi = turn * 1e-6;
  if (r.intraday) { const brok = Math.min(20, buyV * 0.0003) + Math.min(20, sellV * 0.0003); return brok + sellV * 0.00025 + buyV * 0.00003 + txn + sebi + 0.18 * (brok + txn + sebi); }
  return turn * 0.001 + buyV * 0.00015 + txn + sebi + 0.18 * (txn + sebi);
}
const bucketOf = r => r.bucket || (r.intraday ? "intraday" : r.long ? "eqLt" : "eqSt");
const blank = () => ({ trades: 0, intraday: 0, stGain: 0, stLoss: 0, ltGain: 0, ltLoss: 0, neSt: 0, neLt: 0, charges: 0, chargesEst: 0, fromReport: 0 });
function add(acc, r) {
  acc.trades++; const b = bucketOf(r), g = r.gain;
  if (b === "intraday") acc.intraday += g; else if (b === "eqLt") g >= 0 ? (acc.ltGain += g) : (acc.ltLoss -= g); else if (b === "eqSt") g >= 0 ? (acc.stGain += g) : (acc.stLoss -= g); else acc[b] += g;
  if (r.fromReport) acc.fromReport++;
  if (r.charges !== null && r.charges !== undefined) acc.charges += r.charges; else { const e = estimateCharges(r); acc.charges += e; acc.chargesEst += e; }
}
const finish = a => {
  const gross = a.intraday + a.stGain - a.stLoss + a.ltGain - a.ltLoss + a.neSt + a.neLt;
  return { trades: a.trades, intraday: r0(a.intraday), stGain: r0(a.stGain), stLoss: r0(a.stLoss), ltGain: r0(a.ltGain), ltLoss: r0(a.ltLoss), netSt: r0(a.stGain - a.stLoss), netLt: r0(a.ltGain - a.ltLoss),
    neSt: r0(a.neSt), neLt: r0(a.neLt), gross: r0(gross), charges: r0(a.charges), chargesEst: r0(a.chargesEst), net: r0(gross - a.charges), fromReport: a.fromReport };
};

// One person's tax for the year, with the set-off rules: a short-term loss (any asset) reduces short-term gains first
// (the slab-rate ones before the 20% ones), then long-term gains; a long-term loss only reduces long-term gains. The
// ₹1.25 L exemption applies to listed-equity long-term gains. Intraday, F&O, dividends and interest are added to your
// income at your slab rate (intraday and F&O losses stay in their own silos).
export function taxAll({ eqSt = 0, neSt = 0, eqLt = 0, neLt = 0, intraday = 0, fno = 0, dividends = 0, interest = 0 }, slabRate = 0.3) {
  let s = { eqSt, neSt }, l = { eqLt, neLt };
  const absorb = (loss, order, pool) => { for (const k of order) { if (loss <= 0) break; const use = Math.min(loss, Math.max(0, pool[k])); pool[k] -= use; loss -= use; } return loss; };
  for (const [k, order] of [["eqSt", ["neSt"]], ["neSt", ["eqSt"]]]) if (s[k] < 0) { const left = absorb(-s[k], order, s); s[k] = 0; const left2 = absorb(left, ["neLt", "eqLt"], l); if (left2 > 0) s[k] = -left2; }
  for (const [k, order] of [["eqLt", ["neLt"]], ["neLt", ["eqLt"]]]) if (l[k] < 0) { const left = absorb(-l[k], order, l); l[k] = left > 0 ? -left : 0; }
  const carry = Math.max(0, -s.eqSt) + Math.max(0, -s.neSt) + Math.max(0, -l.eqLt) + Math.max(0, -l.neLt);
  const eqLtPos = Math.max(0, l.eqLt), exemptUsed = Math.min(eqLtPos, TAX_RULES.ltExemption);
  const capTax = Math.max(0, s.eqSt) * TAX_RULES.stRate + Math.max(0, s.neSt) * slabRate + (eqLtPos - exemptUsed) * TAX_RULES.ltRate + Math.max(0, l.neLt) * TAX_RULES.ltRate;
  const slabIncome = Math.max(0, intraday) + Math.max(0, fno) + dividends + interest;
  return { netSt: r0(Math.max(0, s.eqSt) + Math.max(0, s.neSt)), netLt: r0(eqLtPos + Math.max(0, l.neLt)), after: { eqSt: r0(s.eqSt), neSt: r0(s.neSt), eqLt: r0(l.eqLt), neLt: r0(l.neLt) },
    exemptUsed: r0(exemptUsed), exemptLeft: r0(TAX_RULES.ltExemption - exemptUsed), capitalGainsTax: r0(capTax), slabIncome: r0(slabIncome), slabTax: r0(slabIncome * slabRate),
    tax: r0(capTax + slabIncome * slabRate), carryForward: r0(carry), slabRate, intradayLoss: intraday < 0 ? r0(-intraday) : 0, fnoLoss: fno < 0 ? r0(-fno) : 0 };
}
const TERM = { intraday: "Intraday", eqSt: "STCG", eqLt: "LTCG", neSt: "Other ST", neLt: "Other LT" };

// trades: [{ account, key, symbol, isin, date, side, qty, price, charges? }]; accounts: [{ id, label, broker }];
// holders: { [accountId]: "name" }; unrealised: { [accountId]: ₹ }; names: Map(key → display name);
// reports: [{ id, account, broker, fy, from, to, panKey, holderName, coverage, rows, other, file }]; slabRate: 0–0.42
export function pnlView({ trades = [], accounts = [], holders = {}, unrealised = {}, names = new Map(), reports = [], slabRate = 0.3, fy: fyLabel = null, today }) {
  const { realised } = fifo(trades);
  const fys = [...new Set([fyOf(today).label, ...realised.map(r => fyOf(r.sellDate).label), ...reports.map(r => r.fy)])].sort().reverse();
  const want = fys.includes(fyLabel) ? fyLabel : fys[0], fyStart = Number(want.match(/\d{4}/)[0]), fy = fyOf(`${fyStart}-06-01`);
  const known = new Map(accounts.map(a => [a.id, a])), holderOf = id => String(holders[id] || "").trim() || ME;
  // reports of this year: the broker's figures replace computed ones for that account up to the report's last day
  const reps = reports.filter(r => r.fy === fy.label), { keep, dropped } = dedupeReports(reps), covered = new Map();
  for (const r of reps) covered.set(r.account, r.to > (covered.get(r.account) || "") ? r.to : covered.get(r.account));
  const fromReports = reps.flatMap((rep, i) => keep[i].map(x => ({ key: x.isin || x.name, account: rep.account, symbol: x.symbol || x.name, isin: x.isin, buyDate: x.buyDate, sellDate: x.sellDate, qty: x.qty,
    buy: x.qty && x.buyValue !== null ? x.buyValue / x.qty : null, sell: x.qty && x.sellValue !== null ? x.sellValue / x.qty : null, gain: x.taxable ?? x.gain, bucket: x.bucket, kind: x.kind, charges: x.charges ?? 0, fromReport: rep.broker, summaryOnly: !!x.summaryOnly, intraday: x.bucket === "intraday", long: /Lt$/.test(x.bucket) })));
  const computed = realised.filter(r => r.sellDate >= fy.from && r.sellDate <= fy.to && !(covered.has(r.account || "") && r.sellDate <= covered.get(r.account || "")));
  const inFy = [...computed, ...fromReports];
  const byAcc = new Map(), byMonth = new Map(), total = blank();
  for (const r of inFy) {
    if (r.unmatched) continue;
    const id = r.account || "", a = byAcc.get(id) || byAcc.set(id, blank()).get(id); add(a, r); add(total, r);
    const mk = r.sellDate.slice(0, 7), m = byMonth.get(mk) || byMonth.set(mk, { intraday: 0, st: 0, lt: 0 }).get(mk), b = bucketOf(r);
    if (b === "intraday") m.intraday += r.gain; else if (/Lt$/.test(b)) m.lt += r.gain; else m.st += r.gain;
  }
  const span = new Map(); for (const t of trades) { const id = t.account || "", s = span.get(id) || { from: t.date, to: t.date, n: 0, api: false }; s.from = t.date < s.from ? t.date : s.from; s.to = t.date > s.to ? t.date : s.to; s.n++; s.api ||= t.src === "dhan-api"; span.set(id, s); }
  const repOf = new Map(reps.map(r => [r.account, r]));
  const ids = [...new Set([...accounts.map(a => a.id), ...span.keys(), ...reps.map(r => r.account)])];
  const rows = ids.map(id => {
    const a = known.get(id), s = span.get(id) || null, rep = repOf.get(id) || null;
    return { id, label: a?.label || (rep ? `${rep.broker}${rep.clientId ? ` ${rep.clientId}` : ""}` : id || "Not linked to an account"), broker: a?.broker || rep?.broker || "", holder: id ? holderOf(id) : ME, ...finish(byAcc.get(id) || blank()),
      unrealised: Number.isFinite(unrealised[id]) ? r0(unrealised[id]) : null, tradesOnFile: s?.n || 0, from: s?.from || null, to: s?.to || null, fromApi: !!s?.api,
      report: rep ? { broker: rep.broker, to: rep.to, file: rep.file || null, importedAt: rep.importedAt || null } : null, unmatched: computed.filter(r => r.unmatched && (r.account || "") === id).length };
  }).filter(r => r.tradesOnFile || r.unrealised !== null || r.report);
  // other income from the reports (dividends, interest, F&O), per holder
  const otherBy = new Map(); for (const rep of reps) { const h = holderOf(rep.account), o = otherBy.get(h) || { dividends: 0, interest: 0, fno: 0 }; for (const k of ["dividends", "interest", "fno"]) o[k] += rep.other?.[k] || 0; otherBy.set(h, o); }
  const hs = new Map();
  for (const r of rows) {
    const h = hs.get(r.holder) || hs.set(r.holder, { name: r.holder, accounts: [], ...blank(), unrealised: 0 }).get(r.holder);
    h.accounts.push(r.id); for (const k of ["trades", "intraday", "stGain", "stLoss", "ltGain", "ltLoss", "neSt", "neLt", "charges", "chargesEst"]) h[k] += r[k]; h.unrealised += r.unrealised || 0;
  }
  const holderRows = [...hs.values()].map(h => {
    const f = finish(h), o = otherBy.get(h.name) || { dividends: 0, interest: 0, fno: 0 };
    const tax = taxAll({ eqSt: f.netSt, neSt: f.neSt, eqLt: f.netLt, neLt: f.neLt, intraday: f.intraday, fno: o.fno, dividends: o.dividends, interest: o.interest }, slabRate);
    return { name: h.name, accounts: h.accounts, ...f, unrealised: r0(h.unrealised), other: { dividends: r0(o.dividends), interest: r0(o.interest), fno: r0(o.fno) }, tax,
      intradayNote: f.intraday > 0 ? "Intraday profit is business income: added to your income and taxed at your slab rate." : f.intraday < 0 ? "Intraday loss can only be set off against intraday profit (carried forward 4 years)." : null };
  });
  const label = id => known.get(id)?.label || repOf.get(id)?.broker || id || "—";
  const tradeRows = inFy.filter(r => !r.summaryOnly).sort((a, b) => b.sellDate.localeCompare(a.sellDate)).slice(0, 2500).map(r => ({
    sellDate: r.sellDate, buyDate: r.buyDate, account: r.account || "", accountLabel: label(r.account), symbol: r.symbol || r.isin || r.key, name: names.get(r.key) || names.get(r.symbol) || null, kind: r.kind || "stock",
    qty: r.qty === null || r.qty === undefined ? null : Math.round(r.qty * 1000) / 1000, buy: r.buy === null || r.buy === undefined ? null : Math.round(r.buy * 100) / 100, sell: r.sell === null || r.sell === undefined ? null : Math.round(r.sell * 100) / 100, gain: r.gain === null ? null : r0(r.gain),
    term: r.unmatched ? "No buy found" : TERM[bucketOf(r)], days: r.buyDate ? Math.round((Date.parse(r.sellDate) - Date.parse(r.buyDate)) / 864e5) : null,
    charges: r.unmatched ? null : r0(r.charges ?? estimateCharges(r)), chargesEst: !r.fromReport && (r.charges === null || r.charges === undefined), src: r.fromReport || "trades"
  }));
  const months = [...byMonth.entries()].sort().map(([month, m]) => ({ month, intraday: r0(m.intraday), st: r0(m.st), lt: r0(m.lt), total: r0(m.intraday + m.st + m.lt) }));
  const warnings = [];
  for (const r of rows) {
    if (r.report) continue;
    if (!r.tradesOnFile) warnings.push({ id: r.id, broker: r.broker, text: `${r.label}: nothing on file yet, so its profit is missing from the totals. Import its tax P&L report (or tradebook)${/dhan/i.test(r.broker) ? ", or use ⟳ Get trades from brokers" : ""}.` });
    else if (r.to && r.to < fy.to && r.to < today && Date.parse(today) - Date.parse(r.to) > 20 * 864e5 && !r.fromApi) warnings.push({ id: r.id, text: `${r.label}: trades on file end on ${r.to}. Import a newer tradebook or its tax P&L report if you traded after that.` });
    if (r.unmatched) warnings.push({ id: r.id, text: `${r.label}: ${r.unmatched} sale${r.unmatched === 1 ? "" : "s"} in ${fy.label} had no matching buy (bought before the trades on file start). Import the broker's tax P&L report for this year: it has the buy prices.` });
  }
  const notes = [];
  if (dropped) notes.push(`${dropped} mutual fund sale${dropped === 1 ? "" : "s"} appeared in two reports (INDmoney covers funds at every broker): counted once.`);
  const srcs = reps.map(r => ({ id: r.id, broker: r.broker, account: r.account, accountLabel: label(r.account), from: r.from, to: r.to, file: r.file || null, importedAt: r.importedAt || null, sales: r.rows.filter(x => !x.summaryOnly).length, other: r.other }));
  return { fy, fys, rules: TAX_RULES, slabRate, rows, holders: holderRows, total: { ...finish(total), unrealised: r0(rows.reduce((a, r) => a + (r.unrealised || 0), 0)) }, months, trades: tradeRows, tradeCount: inFy.length, warnings, notes, reports: srcs, today };
}
