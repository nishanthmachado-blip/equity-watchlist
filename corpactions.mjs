// Corporate actions: dividends, bonuses, splits (and rights / buybacks for information). Parses NSE's corporate-action
// rows and Yahoo's split / dividend events, and adjusts swing positions for bonuses and splits on the ex-date, so a 1:1
// bonus does not look like a 50% loss (or trip the stop-loss). Pure functions.
const MON = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
const dd = n => String(n).padStart(2, "0");
export function caDay(s) {
  const t = String(s || "").trim(); let m;
  if (!t || t === "-") return null;
  if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = t.match(/^(\d{1,2})[- ]([A-Za-z]{3})[a-z]*[- ](\d{4})/)) && m[2].toUpperCase() in MON) return `${m[3]}-${dd(MON[m[2].toUpperCase()] + 1)}-${dd(m[1])}`;
  if ((m = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/))) return `${m[3]}-${dd(m[2])}-${dd(m[1])}`;
  return null;
}
const r4 = v => Math.round(v * 1e4) / 1e4;
// "Interim Dividend - Rs 21 Per Share", "Final Dividend - Rs 20 Per Share And Special Dividend - Rs 8 Per Share",
// "Dividend - Re 0.50 Per Share", "Dividend - 250%" (of face value), "Bonus 1:1", "Face Value Split (Sub-Division) -
// From Rs 10/- Per Share To Rs 2/- Per Share", "Rights 1:5 @ Premium Rs 200/-", "Buy Back".
export function parsePurpose(subject, faceValue = null) {
  const s = String(subject || "").replace(/\s+/g, " ").trim(), out = [];
  if (/dividend/i.test(s)) {
    let amount = 0, found = false;
    for (const m of s.matchAll(/(?:rs\.?|re\.?|₹)\s*([\d.]+)\s*\/?-?\s*(?:per\s*(?:equity\s*)?share|ps)?/gi)) { const v = Number(m[1]); if (v > 0 && v < 100000) { amount += v; found = true; } }
    if (!found) { const pct = s.match(/([\d.]+)\s*%/); if (pct && faceValue > 0) { amount = Number(pct[1]) / 100 * faceValue; found = true; } }
    out.push({ kind: "dividend", amount: found ? r4(amount) : null, label: /special/i.test(s) && !/final|interim/i.test(s) ? "Special dividend" : /interim/i.test(s) ? "Interim dividend" : /final/i.test(s) ? "Final dividend" : "Dividend" });
  }
  let m;
  if ((m = s.match(/bonus\s*(\d+)\s*:\s*(\d+)/i))) { const a = Number(m[1]), b = Number(m[2]); if (a > 0 && b > 0) out.push({ kind: "bonus", ratio: `${a}:${b}`, factor: r4((a + b) / b), label: `Bonus ${a}:${b}` }); }
  if (/split|sub-?division/i.test(s)) { const fv = [...s.matchAll(/(?:rs\.?|re\.?|₹)\s*([\d.]+)/gi)].map(x => Number(x[1])).filter(x => x > 0); if (fv.length >= 2 && fv[0] > fv[1]) out.push({ kind: "split", factor: r4(fv[0] / fv[1]), from: fv[0], to: fv[1], label: `Split ₹${fv[0]} → ₹${fv[1]} face value` }); }
  if (/rights/i.test(s)) out.push({ kind: "rights", label: s.slice(0, 80) });
  if (/buy\s*-?back/i.test(s)) out.push({ kind: "buyback", label: "Buyback" });
  if (/demerger|scheme of arrangement/i.test(s)) out.push({ kind: "demerger", label: s.slice(0, 80) });
  return out;
}
// NSE /api/corporates-corporateActions rows → one action per kind
export function parseNseActions(json) {
  const rows = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
  const out = [];
  for (const r of rows) {
    const symbol = String(r.symbol || "").toUpperCase(), exDate = caDay(r.exDate || r.exdate), recordDate = caDay(r.recDate || r.recordDate);
    if (!symbol || !exDate) continue;
    for (const p of parsePurpose(r.subject || r.purpose, Number(r.faceVal) || null)) out.push({ symbol, exDate, recordDate, ...p, subject: String(r.subject || r.purpose || "").slice(0, 160), source: "NSE" });
  }
  return out;
}
// Yahoo chart events → dividends and splits (Yahoo records a bonus as a split)
export function parseYahooEvents(symbol, events) {
  const out = [];
  for (const d of Object.values(events?.dividends || {})) if (d?.amount > 0 && d.date) out.push({ symbol, exDate: new Date(d.date * 1000).toISOString().slice(0, 10), kind: "dividend", amount: r4(d.amount), label: "Dividend", source: "Yahoo" });
  for (const x of Object.values(events?.splits || {})) if (x?.numerator > 0 && x?.denominator > 0 && x.numerator !== x.denominator && x.date) out.push({ symbol, exDate: new Date(x.date * 1000).toISOString().slice(0, 10), kind: "split", factor: r4(x.numerator / x.denominator), label: `Split / bonus ${x.splitRatio || `${x.numerator}:${x.denominator}`}`, source: "Yahoo" });
  return out;
}
export const actionKey = a => `${a.symbol}:${a.kind}:${a.exDate}${a.kind === "dividend" ? `:${a.amount ?? ""}` : ""}`;
// Same action from two sources (NSE + Yahoo) is kept once, NSE preferred
export function mergeActions(...lists) {
  const m = new Map();
  for (const a of lists.flat()) { if (!a?.symbol || !a.exDate) continue; const k = a.kind === "dividend" ? `${a.symbol}:dividend:${a.exDate}` : a.kind === "bonus" || a.kind === "split" ? `${a.symbol}:qty:${a.exDate}` : actionKey(a); const prev = m.get(k); if (!prev || (prev.source !== "NSE" && a.source === "NSE")) m.set(k, a); }
  return [...m.values()].sort((a, b) => a.exDate.localeCompare(b.exDate));
}
const lotDay = l => String(l.at || l.date || "").slice(0, 10);
// Apply bonuses / splits whose ex-date has passed to a swing position. Only shares bought before the ex-date are
// adjusted. Idempotent (each action is recorded on the position). Returns { position, applied: [...] }.
export function adjustPosition(p, actions, today) {
  const done = new Set((p.adjustments || []).map(a => a.key)), applied = [];
  let q = { ...p, lots: Array.isArray(p.lots) ? p.lots.map(l => ({ ...l })) : null };
  for (const a of actions) {
    if (a.symbol !== p.symbol || !(a.kind === "bonus" || a.kind === "split") || !(a.factor > 1) || a.exDate > today) continue;
    const key = actionKey(a); if (done.has(key)) continue;
    const before = { qty: q.qty, avgPrice: q.avgPrice };
    if (q.lots?.length) {
      let changed = false;
      for (const l of q.lots) if (lotDay(l) && lotDay(l) < a.exDate) { l.qty = Math.floor(l.qty * a.factor + 1e-9); l.price = r4(l.price / a.factor); changed = true; }
      if (!changed) { done.add(key); continue; } // all shares bought on/after the ex-date
      q.qty = q.lots.reduce((s, l) => s + l.qty, 0); const cost = q.lots.reduce((s, l) => s + l.qty * l.price, 0); q.avgPrice = r4(cost / q.qty);
    } else {
      const opened = String(q.openedAt || q.boughtOn || q.addedAt || "").slice(0, 10);
      if (opened && opened >= a.exDate) { done.add(key); continue; }
      q.qty = Math.floor(q.qty * a.factor + 1e-9); q.avgPrice = r4(q.avgPrice / a.factor);
    }
    for (const k of ["stopLoss", "addBelow", "highSinceEntry"]) if (q[k] > 0) q[k] = r4(q[k] / a.factor);
    const rec = { key, kind: a.kind, label: a.label, factor: a.factor, exDate: a.exDate, from: before, to: { qty: q.qty, avgPrice: q.avgPrice }, at: new Date().toISOString() };
    q.adjustments = [...(q.adjustments || []), rec]; done.add(key); applied.push(rec);
  }
  return { position: applied.length ? q : p, applied };
}
// Swing watchlist levels move with the share count too
export function adjustWatch(w, actions, today) {
  const done = new Set((w.adjustments || []).map(a => a.key)); let q = w, applied = [];
  const added = String(w.addedAt || w.createdAt || "").slice(0, 10);
  for (const a of actions) {
    if (a.symbol !== w.symbol || !(a.kind === "bonus" || a.kind === "split") || !(a.factor > 1) || a.exDate > today) continue;
    const key = actionKey(a); if (done.has(key) || (added && added >= a.exDate)) continue;
    q = { ...q }; for (const k of ["buyBelow", "level", "stopLoss", "entry", "target"]) if (q[k] > 0) q[k] = r4(q[k] / a.factor);
    if (q.idea) q.idea = Object.fromEntries(Object.entries(q.idea).map(([k, v]) => [k, typeof v === "number" && /entry|stop|t\d|target|high|low/i.test(k) ? r4(v / a.factor) : v]));
    const rec = { key, kind: a.kind, label: a.label, factor: a.factor, exDate: a.exDate, at: new Date().toISOString() };
    q.adjustments = [...(q.adjustments || []), rec]; done.add(key); applied.push(rec);
  }
  return { watch: q, applied };
}
