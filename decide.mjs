// "Hold or sell?" for one swing position: what you keep if you sell now, if you hold to the ex-dividend date (or the next
// few days), and if you book part and protect the rest with a stop, with the downside a normal and a bad week could
// bring, from the stock's own volatility. A dividend is shown for what it is: the price drops by about the same amount
// on the ex-date and it is taxed at your slab. Rule-based, not advice. Pure functions.
import { sellTaxEstimate } from "./swing.mjs";
import { TAX_RULES } from "./tax.mjs";

const R = v => Math.round(v), r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
const fin = Number.isFinite;
// Daily volatility (standard deviation of daily % moves) from closes, oldest first
export function dailyVol(closes) {
  const c = (closes || []).filter(x => x > 0).slice(-61); if (c.length < 21) return null;
  const r = []; for (let i = 1; i < c.length; i++) r.push(Math.log(c[i] / c[i - 1]));
  const m = r.reduce((a, b) => a + b, 0) / r.length, v = r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1);
  return Math.sqrt(v);
}
const tradingDays = days => Math.max(1, Math.round(days * 5 / 7));
const addDays = (day, n) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// FIFO split of lots: the first `qty` shares and the rest
function splitLots(lots, qty) { const a = [], b = []; let left = qty; for (const l of [...lots].sort((x, y) => String(x.at).localeCompare(String(y.at)))) { if (left <= 0) { b.push({ ...l }); continue; } const n = Math.min(l.qty, left); a.push({ ...l, qty: n }); if (l.qty > n) b.push({ ...l, qty: l.qty - n }); left -= n; } return [a, b]; }

export function decideHoldSell(p) {
  const { qty, avgPrice, price, lots, today, dividend = null, results = null, vol = null, health = null, targets = [], planQty = null, slabPct = 30, exemptLeft = TAX_RULES.ltExemption, charges = {}, cessPct = 4 } = p;
  if (!(qty > 0) || !(price > 0)) return null;
  const L = lots?.length ? lots : [{ qty, price: avgPrice, at: today }];
  const tax = (ls, px, day) => sellTaxEstimate({ lots: ls, sellPrice: px, sellDate: day, ltExemptLeft: exemptLeft, charges });
  const now = tax(L, price, today), gainNow = now.gross;
  // How long the decision is about: until the ex-date (sell the day after), else results, else two weeks
  const until = dividend && dividend.days >= 0 ? dividend.days + 1 : results && results.days >= 0 ? results.days + 1 : 14;
  const td = tradingDays(until), sig = (vol ?? 0.018) * Math.sqrt(td); // fraction
  const sellDay = addDays(today, until);
  const divPer = dividend?.amount > 0 && dividend.days >= 0 ? dividend.amount : 0;
  const divNetPer = divPer * (1 - slabPct / 100 * (1 + cessPct / 100));
  const holdAt = px => { const e = tax(L, Math.max(0.01, px - divPer), sellDay); return R(e.net + divNetPer * qty); };
  // A. sell everything now
  const A = { key: "sell", title: "Sell all now", keep: R(now.net), worst: R(now.net), typical: R(now.net), best: R(now.net), notes: [`Locks ${now.net >= 0 ? "₹" + R(now.net).toLocaleString("en-IN") : "a loss"} after STT, charges and tax.`] };
  // B. hold everything until the ex-date / the next few days
  const B = { key: "hold", title: divPer ? `Hold all until the ex-date (${dividend.date}) and sell after` : `Hold all for ${until} more days`, typical: holdAt(price), worst: holdAt(price * (1 - 2 * sig)), bad: holdAt(price * (1 - sig)), best: holdAt(price * (1 + sig)), notes: [] };
  if (divPer) {
    const extraTax = divPer * qty * ((slabPct - TAX_RULES.stRate * 100) / 100) * (1 + cessPct / 100);
    B.notes.push(`Dividend ₹${divPer} × ${qty} = ₹${R(divPer * qty).toLocaleString("en-IN")}, but the price drops by about that on ${dividend.date}: it moves money from your gain into your hands, it doesn't add to it.`);
    if (extraTax > 50) B.notes.push(`Taxed at your ${slabPct}% slab instead of ${TAX_RULES.stRate * 100}% short-term gains tax: about ₹${R(extraTax).toLocaleString("en-IN")} more tax than selling now.`);
  }
  B.notes.push(`${td} trading days at this stock's usual swings (${r1((vol ?? 0.018) * 100)}% a day): a normal move is ±${r1(sig * 100)}% (₹${R(price * sig * qty).toLocaleString("en-IN")}); a bad week (about 1 in 20) is −${r1(2 * sig * 100)}%.`);
  // C. book part now, protect the rest with a stop
  const t1 = targets[0]?.price, partQty = Math.min(qty - 1, Math.max(1, planQty || Math.round(qty / 3)));
  let stop = null, stopWhy = "";
  if (health?.trail > avgPrice && health.trail < price) { stop = health.trail; stopWhy = "trailing stop (2 ATR under the price or the 20-day low)"; }
  else if (t1 && price > t1 * 1.01) { stop = r2(t1); stopWhy = "target 1 (you keep at least the T1 profit)"; }
  else if (price > avgPrice * 1.03) { stop = r2(Math.max(avgPrice * 1.01, price * (1 - 1.5 * sig))); stopWhy = "a little above your buy price"; }
  let C = null;
  if (qty > 1 && stop && stop < price) {
    const [partLots, restLots] = splitLots(L, partQty), part = tax(partLots, price, today), restQty = qty - partQty;
    const restAt = px => { const e = tax(restLots, Math.max(0.01, px - divPer), sellDay); return e.net + divNetPer * restQty; };
    const worst = R(part.net + tax(restLots, stop, today).net); // stopped out before the ex-date: no dividend
    C = { key: "split", title: `Sell ${partQty} now, keep ${restQty} with a stop at ₹${stop.toLocaleString("en-IN")}`, partQty, restQty, stop, stopWhy, keepNow: R(part.net), worst, typical: R(part.net + restAt(price)), best: R(part.net + restAt(price * (1 + sig))),
      notes: [`Books ₹${R(part.net).toLocaleString("en-IN")} today. If the price falls to ₹${stop.toLocaleString("en-IN")} the rest is sold there: you still keep about ₹${worst.toLocaleString("en-IN")} in all.`, `Stop at ${stopWhy}.`, ...(divPer ? [`The ${restQty} shares you keep still get the dividend if the stop is not hit before ${dividend.date}.`] : [])] };
  }
  // D. a long-term date close by (tax drops from 20% to 12.5%)
  let D = null;
  const nextLt = L.map(l => { const d = new Date(`${String(l.at).slice(0, 10)}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 12); d.setUTCDate(d.getUTCDate() + 1); return { day: d.toISOString().slice(0, 10), qty: l.qty }; }).filter(x => x.day > today).sort((a, b) => a.day.localeCompare(b.day))[0];
  if (nextLt) { const days = Math.round((Date.parse(nextLt.day) - Date.parse(today)) / 864e5); if (days <= 45 && gainNow > 0) { const later = tax(L, price, nextLt.day); const saved = R(later.net - now.net); if (saved > 500) D = { key: "lt", title: `Wait ${days} days for long-term rates (${nextLt.day})`, saved, days, notes: [`${nextLt.qty} shares turn long term on ${nextLt.day}: at today's price that saves about ₹${saved.toLocaleString("en-IN")} of tax (12.5% instead of 20%, ₹1.25 L a year exempt). Worth it only if the price doesn't fall more than that.`] }; } }
  // Lean: rule-based, explained
  const why = [];
  let lean;
  const weak = health && (health.state === "weak" || health.state === "caution"), strong = health?.state === "strong";
  const divYield = divPer ? divPer / price : 0;
  if (gainNow <= 0) { lean = "hold"; why.push("You are not in profit: this is a stop-loss decision, not a profit-booking one."); }
  else if (weak) { lean = "sell"; why.push(`The trend is ${health.state === "weak" ? "down (below the 200-day average)" : "fading (below the 50-day average)"}: gains tend to leak away.`); }
  else if (C && (strong || (t1 && price >= t1))) { lean = "split"; why.push(strong ? "The trend is still up, so selling everything can leave money on the table." : "You are at or past target 1: the plan says book part."); why.push(`Booking part and stopping the rest keeps at least ₹${C.worst.toLocaleString("en-IN")} (${R(C.worst / Math.max(1, now.net) * 100)}% of selling everything now) with the upside still open.`); }
  else if (C) { lean = "split"; why.push("Middle ground: book part, protect the rest."); }
  else { lean = "sell"; why.push("No sensible stop above your buy price yet: selling now is the way to lock the gain."); }
  if (divPer) { if (divYield < sig) why.push(`The dividend (${r1(divYield * 100)}% of the price) is smaller than a normal ${td}-day move (±${r1(sig * 100)}%): don't hold just for it.`); else why.push(`The dividend (${r1(divYield * 100)}%) is large next to a normal move, but the price still drops by it on the ex-date.`); }
  if (results && results.days >= 0 && results.days <= until) { why.push(`Results on ${results.date} fall inside this window: moves of 5–10% are common that day.`); if (lean === "hold") lean = "split"; }
  if (D) why.push(`Long-term rates start on ${D.days <= 1 ? "tomorrow" : `in ${D.days} days`}: about ₹${D.saved.toLocaleString("en-IN")} less tax if you can wait.`);
  const headline = { sell: "Lean: book the profit now", split: `Lean: sell ${C?.partQty ?? "part"} now and protect the rest with a stop`, hold: "Lean: hold (manage it with your stop-loss)" }[lean];
  return { headline, lean, why, scenarios: [A, B, C, D].filter(Boolean), facts: { price, qty, avgPrice, gainNow: R(gainNow), netNow: R(now.net), volPct: r1((vol ?? 0.018) * 100), volEstimated: vol === null, days: until, tradingDays: td, movePct: r1(sig * 100), moveRs: R(price * sig * qty), dividend: divPer ? { per: divPer, total: R(divPer * qty), net: R(divNetPer * qty), date: dividend.date } : null, slabPct } };
}
