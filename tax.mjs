// Capital-gains view for listed Indian equity shares and equity mutual funds, built from your tradebook (FIFO lots).
// Rules (Finance Act 2024, unchanged by Budget 2026): held > 12 months = long term, taxed 12.5% above ₹1.25 lakh of
// long-term gains per financial year; short term taxed 20%. Short-term losses offset short- and long-term gains;
// long-term losses offset only long-term gains. Not handled: grandfathering of pre-31-Jan-2018 purchases, surcharge
// and cess, debt funds, F&O, intraday (speculative) trades, and corporate actions missing from the tradebook.
export const TAX_RULES = Object.freeze({ ltMonths: 12, ltRate: 0.125, stRate: 0.20, ltExemption: 125000, asOf: "Finance Act 2024 rates (unchanged in Budget 2026)" });

const num = v => { const x = Number(String(v ?? "").replace(/[,₹\s]/g, "")); return Number.isFinite(x) ? x : null; };
const dayOf = v => {
  const s = String(v || "").trim(); let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/))) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};
export function fyOf(day) { const [y, m] = day.split("-").map(Number); const start = m >= 4 ? y : y - 1; return { label: `FY ${start}-${String(start + 1).slice(2)}`, from: `${start}-04-01`, to: `${start + 1}-03-31` }; }
// Long term once held for more than 12 months: bought 2025-03-10 → long term from 2026-03-11.
export function ltDate(buyDay) { const d = new Date(`${buyDay}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + TAX_RULES.ltMonths); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }
const isLong = (buyDay, onDay) => onDay >= ltDate(buyDay);
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 864e5);

// Zerodha Console tradebook (equity or mutual funds) or any CSV with symbol/ISIN, date, buy/sell, quantity, price.
export function parseTradebook(rows) {
  let hi = -1, c = null;
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const h = rows[i].map(x => String(x || "").trim().toLowerCase());
    const f = re => h.findIndex(x => re.test(x));
    const cols = { symbol: f(/^(symbol|tradingsymbol|scrip|stock|instrument|scheme|fund)/), isin: f(/^isin/), date: f(/^(trade_?date|date|order_execution_time|transaction date)/), type: f(/^(trade_?type|type|buy\/sell|side|transaction type|action)/), qty: f(/^(quantity|qty|units)/), price: f(/^(price|trade price|rate|nav)/), segment: f(/^segment/) };
    if ((cols.symbol >= 0 || cols.isin >= 0) && cols.date >= 0 && cols.type >= 0 && cols.qty >= 0 && cols.price >= 0) { hi = i; c = cols; break; }
  }
  if (hi < 0) return { trades: [], note: "No tradebook columns found. Use Zerodha Console → Reports → Tradebook (Equity and Mutual funds) and download CSV." };
  const trades = [], skipped = { fno: 0, bad: 0 };
  for (const r of rows.slice(hi + 1)) {
    const seg = c.segment >= 0 ? String(r[c.segment] || "").toUpperCase() : "";
    if (/FO|CDS|MCX|COM/.test(seg)) { skipped.fno++; continue; }
    const type = String(r[c.type] || "").trim().toLowerCase(), date = dayOf(r[c.date]), qty = num(r[c.qty]), price = num(r[c.price]);
    const side = /^(b|buy|purchase)/.test(type) ? "buy" : /^(s|sell|redemption|redeem)/.test(type) ? "sell" : null;
    const symbol = c.symbol >= 0 ? String(r[c.symbol] || "").trim().toUpperCase().replace(/-(EQ|BE|BZ|SM|ST)$/, "") : "";
    const isin = c.isin >= 0 ? String(r[c.isin] || "").trim().toUpperCase() : "";
    if (!side || !date || !(qty > 0) || !(price >= 0) || (!symbol && !isin)) { if (r.some(x => String(x || "").trim())) skipped.bad++; continue; }
    trades.push({ key: isin || symbol, symbol: symbol || null, isin: isin || null, date, side, qty, price });
  }
  return { trades, skipped, note: null };
}
// Merge new trades into saved ones without double-counting the same row (re-importing the same file is safe).
export function mergeTrades(saved = [], incoming = []) {
  const sig = t => `${t.account || ""}|${t.key}|${t.date}|${t.side}|${t.qty}|${t.price}`; // the same trade in two accounts is two trades
  const counts = new Map(); for (const t of saved) counts.set(sig(t), (counts.get(sig(t)) || 0) + 1);
  const inc = new Map(); for (const t of incoming) inc.set(sig(t), (inc.get(sig(t)) || 0) + 1);
  const out = [...saved];
  for (const [k, n] of inc) { const have = counts.get(k) || 0; const t = incoming.find(x => sig(x) === k); for (let i = have; i < n; i++) out.push(t); }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.side === "buy" ? -1 : 1));
}

// FIFO: open lots per instrument and gains realised by each sell.
export function fifo(trades) {
  const lots = new Map(), realised = [];
  for (const t of [...trades].sort((a, b) => a.date.localeCompare(b.date) || (a.side === "buy" ? -1 : 1))) {
    const q = lots.get(t.key) || []; lots.set(t.key, q);
    if (t.side === "buy") { q.push({ date: t.date, qty: t.qty, price: t.price, symbol: t.symbol, isin: t.isin }); continue; }
    let left = t.qty;
    while (left > 1e-9 && q.length) {
      const lot = q[0], used = Math.min(lot.qty, left);
      realised.push({ key: t.key, symbol: t.symbol || lot.symbol, isin: t.isin || lot.isin, buyDate: lot.date, sellDate: t.date, qty: used, buy: lot.price, sell: t.price, gain: (t.price - lot.price) * used, long: isLong(lot.date, t.date) });
      lot.qty -= used; left -= used; if (lot.qty <= 1e-9) q.shift();
    }
    if (left > 1e-9) realised.push({ key: t.key, symbol: t.symbol, isin: t.isin, buyDate: null, sellDate: t.date, qty: left, buy: null, sell: t.price, gain: null, long: null, unmatched: true });
  }
  return { lots, realised };
}

// Tax on a year's realised gains after set-off and the long-term exemption.
export function taxFor({ stGain = 0, stLoss = 0, ltGain = 0, ltLoss = 0 }) {
  let st = stGain - stLoss, lt = ltGain - ltLoss;
  if (st < 0) { lt += st; st = 0; } // short-term loss left over also offsets long-term gains
  lt = Math.max(0, lt);
  const exemptUsed = Math.min(lt, TAX_RULES.ltExemption), taxableLt = lt - exemptUsed;
  return { netSt: Math.round(st), netLt: Math.round(lt), exemptUsed: Math.round(exemptUsed), exemptLeft: Math.round(TAX_RULES.ltExemption - exemptUsed), tax: Math.round(st * TAX_RULES.stRate + taxableLt * TAX_RULES.ltRate) };
}

// holdings: [{ key, symbol, isin, name, qty, price, avgPrice, kind: "stock"|"mf" }] (current, from broker sync)
export function taxView({ trades = [], holdings = [], today }) {
  const fy = fyOf(today), { lots, realised } = fifo(trades);
  const symToKey = new Map(); for (const t of trades) if (t.symbol && !symToKey.has(t.symbol)) symToKey.set(t.symbol, t.key);
  const thisYear = realised.filter(r => r.sellDate >= fy.from && r.sellDate <= fy.to && !r.unmatched);
  const sumIf = f => thisYear.filter(f).reduce((a, r) => a + r.gain, 0);
  const realisedFy = { stGain: sumIf(r => !r.long && r.gain > 0), stLoss: -sumIf(r => !r.long && r.gain < 0), ltGain: sumIf(r => r.long && r.gain > 0), ltLoss: -sumIf(r => r.long && r.gain < 0) };
  const taxNow = taxFor(realisedFy);
  const rows = [];
  for (const h of holdings) {
    if (!(h.qty > 0) || !(h.price > 0)) continue;
    const open = ((h.isin && lots.get(h.isin)) || lots.get(h.key) || (h.symbol && (lots.get(h.symbol) || lots.get(symToKey.get(h.symbol)))) || []).map(l => ({ ...l }));
    let lotQty = open.reduce((a, l) => a + l.qty, 0);
    // Holdings and tradebook disagree (bonus / split / transfer-in, or a missing year): FIFO-trim or pad with an "unknown date" lot.
    let mismatch = null;
    if (Math.abs(lotQty - h.qty) > 1e-6) {
      mismatch = lotQty > h.qty ? "fewer shares held than the tradebook shows" : open.length ? "more shares held than the tradebook shows (bonus, split or transfer?)" : "not in your tradebook";
      if (lotQty > h.qty) { let extra = lotQty - h.qty; while (extra > 1e-9 && open.length) { const u = Math.min(open[0].qty, extra); open[0].qty -= u; extra -= u; if (open[0].qty <= 1e-9) open.shift(); } }
      else open.push({ date: null, qty: h.qty - lotQty, price: h.avgPrice ?? null, unknown: true });
      lotQty = h.qty;
    }
    const L = open.map(l => {
      const gain = l.price === null ? null : (h.price - l.price) * l.qty;
      const long = l.date ? isLong(l.date, today) : null, becomesLong = l.date && !long ? ltDate(l.date) : null;
      return { date: l.date, qty: Math.round(l.qty * 1000) / 1000, price: l.price, gain: gain === null ? null : Math.round(gain), long, becomesLong, daysToLong: becomesLong ? daysBetween(today, becomesLong) : null, unknown: !!l.unknown };
    });
    const part = f => L.filter(f).reduce((a, l) => a + (l.gain || 0), 0);
    rows.push({ key: h.key, symbol: h.symbol, isin: h.isin, name: h.name, kind: h.kind, qty: h.qty, price: h.price, value: Math.round(h.qty * h.price), lots: L, mismatch,
      ltGain: Math.round(part(l => l.long === true)), stGain: Math.round(part(l => l.long === false)), unknownGain: Math.round(part(l => l.long === null)),
 });
  }
  // Ideas. Indian rules sell your OLDEST shares first (FIFO), so every idea works on lots from the front of the queue.
  const exemptLeft = taxNow.exemptLeft, harvestGains = [], harvestLosses = [], waitToSell = [];
  let room = exemptLeft;
  for (const r of [...rows].sort((a, b) => b.ltGain - a.ltGain)) {
    const lots = r.lots.filter(l => !l.unknown).sort((a, b) => a.date.localeCompare(b.date));
    if (lots.length !== r.lots.length) continue; // unknown-date shares sit somewhere in the queue: skip
    // gains: sell from the front while lots are long term (a long-term loss in between reduces the gain)
    let units = 0, gain = 0;
    for (const l of lots) {
      if (l.long !== true || room - gain <= 500) break;
      const per = (l.gain || 0) / l.qty, maxUnits = per > 0 ? Math.min(l.qty, (room - gain) / per) : l.qty;
      const take = r.kind === "stock" ? Math.floor(maxUnits) : Math.floor(maxUnits * 1000) / 1000; if (take <= 0) break;
      units += take; gain += take * per; if (take < l.qty) break;
    }
    if (units > 0 && gain > 500) { harvestGains.push({ symbol: r.symbol, name: r.name, kind: r.kind, qty: Math.round(units * 1000) / 1000, gain: Math.round(gain), boughtOn: lots[0].date }); room -= gain; }
    // losses: the front lots that are under water
    let lu = 0, loss = 0, lt = true;
    for (const l of lots) { if (!(l.gain < 0)) break; lu += l.qty; loss += -l.gain; lt = lt && l.long; }
    if (lu > 0) harvestLosses.push({ symbol: r.symbol, name: r.name, kind: r.kind, qty: Math.round(lu * 1000) / 1000, loss: Math.round(loss), long: lt, boughtOn: lots[0].date });
    // waiting: the whole position turns long term soon and the short-term part is in profit
    const st = lots.filter(l => l.long === false), stGain = st.reduce((a, l) => a + (l.gain || 0), 0);
    if (st.length && stGain > 0) { const last = st.at(-1); if (last.daysToLong <= 60) waitToSell.push({ symbol: r.symbol, name: r.name, date: last.becomesLong, days: last.daysToLong, gain: Math.round(stGain), taxSaved: Math.round(stGain * (TAX_RULES.stRate - TAX_RULES.ltRate)) }); }
  }
  harvestGains.sort((a, b) => b.gain - a.gain); harvestLosses.sort((a, b) => b.loss - a.loss); waitToSell.sort((a, b) => a.days - b.days);
  const sum = k => rows.reduce((a, r) => a + r[k], 0);
  return {
    rules: TAX_RULES, fy, today, tradeCount: trades.length,
    realised: { ...Object.fromEntries(Object.entries(realisedFy).map(([k, v]) => [k, Math.round(v)])), ...taxNow, trades: thisYear.length, unmatchedSells: realised.filter(r => r.unmatched && r.sellDate >= fy.from).length },
    unrealised: { lt: Math.round(sum("ltGain")), st: Math.round(sum("stGain")), unknown: Math.round(sum("unknownGain")), mismatches: rows.filter(r => r.mismatch).length },
    rows: rows.sort((a, b) => b.value - a.value),
    ideas: { harvestGains, harvestGainsTotal: Math.round(harvestGains.reduce((a, x) => a + x.gain, 0)), taxSavedLater: Math.round(harvestGains.reduce((a, x) => a + x.gain, 0) * TAX_RULES.ltRate), harvestLosses: harvestLosses.slice(0, 15), waitToSell }
  };
}
