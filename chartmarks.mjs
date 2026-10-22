// What the price chart marks on the candles and the lines you draw on it. Pure functions; the server reads the files.
//  - chartEvents: results dates, dividends, bonuses / splits, order-win announcements and your own swing buys and sells
//  - sanitizeDrawing / applyDrawingOp: your own lines (horizontal at a price, or a trend line between two points), saved per stock
import { eventsFor } from "./events.mjs";

const fin = v => Number.isFinite(v);
const r2 = v => Math.round(v * 100) / 100;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const inr = v => `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const crore = v => (v >= 1000 ? `₹${Math.round(v).toLocaleString("en-IN")} Cr` : `₹${v >= 100 ? Math.round(v) : r2(v)} Cr`);

// corp = { events, actions } (the app's corporate events file); divs = [{ d, a }] (dividend history);
// orders = order-win announcements [{ symbol, day, valueCr, text }]; ledger = swing ledger entries (buildLedger().entries)
export function chartEvents(symbol, { today, corp = {}, divs = [], orders = [], ledger = [] } = {}) {
  const out = [], seen = new Set();
  const add = e => { const k = `${e.kind}|${e.date}|${e.at || ""}|${e.label}`; if (!DAY.test(e.date) || seen.has(k)) return; seen.add(k); out.push(e); };
  const divDays = new Set();
  for (const e of eventsFor(symbol, { events: corp.events || [], actions: corp.actions || [], today, pastDays: 4000, aheadDays: 120 })) {
    const kind = e.kind === "results" ? "results" : e.kind === "dividend" ? "dividend" : e.kind === "bonus" ? "bonus" : e.kind === "split" ? "split" : null;
    if (!kind) continue;
    if (kind === "dividend") divDays.add(e.date);
    add({ kind, date: e.date, label: kind === "results" ? (e.estimate ? "Results (expected)" : "Results") : kind === "dividend" ? `Dividend${fin(e.amount) ? ` ${inr(e.amount)}` : ""} (ex-date)` : e.label || (kind === "bonus" ? "Bonus" : "Split"), detail: e.detail || e.subject || null, upcoming: e.date > today });
  }
  for (const d of divs || []) if (DAY.test(d?.d) && !divDays.has(d.d) && fin(d.a)) { divDays.add(d.d); add({ kind: "dividend", date: d.d, label: `Dividend ${inr(d.a)} (ex-date)`, detail: null, upcoming: d.d > today }); }
  for (const o of orders || []) if (o.symbol === symbol && DAY.test(o.day)) add({ kind: "order", date: o.day, label: `Order win${fin(o.valueCr) ? ` ${crore(o.valueCr)}` : ""}`, detail: String(o.text || "").slice(0, 200) || null, upcoming: false });
  for (const t of ledger || []) if (t.symbol === symbol && DAY.test(t.date)) {
    const buy = t.type === "BUY";
    add({ kind: buy ? "buy" : "sell", date: t.date, at: t.at || null, label: `${buy ? "Bought" : "Sold"} ${t.qty} @ ${inr(t.price)}`, detail: buy ? null : fin(t.pnl) ? `P/L ${t.pnl >= 0 ? "+" : "−"}${inr(Math.abs(t.pnl))}${fin(t.pnlPct) ? ` (${t.pnlPct}%)` : ""}` : null, qty: t.qty, price: t.price, upcoming: false });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || String(a.at || "").localeCompare(String(b.at || "")));
}

// ---- Your lines --------------------------------------------------------------------------------------------------
export const MAX_LINES_PER_STOCK = 40;
const COLOURS = ["#2563eb", "#f59e0b", "#a855f7", "#0ea5e9", "#ef4444", "#16a34a", "#64748b"];
const price = v => { const n = Number(String(v ?? "").replace(/[₹,\s]/g, "")); if (!(n > 0 && n < 1e7)) throw new Error("Pick a price on the chart."); return r2(n); };
const time = v => { const n = Number(v); if (!(n > 0 && n < 4e9)) throw new Error("Pick two points on the chart."); return Math.round(n); };
const text = (v, n) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, n);
export function sanitizeDrawing(d = {}) {
  const id = /^[a-z0-9]{4,24}$/i.test(d.id || "") ? d.id : `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const color = COLOURS.includes(d.color) ? d.color : COLOURS[0], note = text(d.note, 40) || null;
  if (d.kind === "trend") {
    let a = { t: time(d.t1), p: price(d.p1) }, b = { t: time(d.t2), p: price(d.p2) };
    if (a.t === b.t) throw new Error("Pick two different days / times for a trend line.");
    if (a.t > b.t) [a, b] = [b, a];
    return { id, kind: "trend", t1: a.t, p1: a.p, t2: b.t, p2: b.p, color, note, at: new Date().toISOString() };
  }
  return { id, kind: "h", price: price(d.price), color, note, at: new Date().toISOString() };
}
// store = { [SYMBOL]: [drawing, ...] }; op: add | delete | clear
export function applyDrawingOp(store, symbol, op, body = {}) {
  const s = { ...(store || {}) }, list = [...(s[symbol] || [])];
  if (op === "add") { if (list.length >= MAX_LINES_PER_STOCK) throw new Error(`At most ${MAX_LINES_PER_STOCK} lines per stock: delete some first.`); list.push(sanitizeDrawing(body)); }
  else if (op === "delete") { const i = list.findIndex(x => x.id === body.id); if (i < 0) throw new Error("That line no longer exists."); list.splice(i, 1); }
  else if (op === "clear") list.length = 0;
  else throw new Error("Unknown operation.");
  if (list.length) s[symbol] = list; else delete s[symbol];
  if (Object.keys(s).length > 300) throw new Error("Lines are saved for at most 300 stocks: clear some first.");
  return s;
}
