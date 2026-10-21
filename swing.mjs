// Swing trading: your swing positions and swing watchlist, priced live, with "take profit" (up ≥ target %) and "deploy"
// (price at or below your add / buy level) flags and alerts. Pure functions; the server supplies prices and storage.
import { TAX_RULES, ltDate, fyOf, taxFor } from "./tax.mjs";
export const SWING_DEFAULTS = Object.freeze({ targets: Object.freeze([10, 20, 40]), bookPlan: Object.freeze([33, 33, 34]), dipPct: 8, nearPct: 2.5 });
// Booking plan: % of the position to sell at T1, T2, T3 (e.g. "33, 33, 34" = a third each; "50, 50" = half at T1, rest at T2;
// "25, 25" = half in two steps, the other half kept as a runner). Must add up to 100% or less.
export function parseBookPlan(v) {
  if (v === "" || v == null) return null;
  const list = (Array.isArray(v) ? v : typeof v === "number" ? [v] : String(v).split(/[\s,/;|]+/)).filter(x => x !== "" && x != null).map(x => Number(String(x).replace(/%$/, "")));
  if (!list.length) return null;
  if (list.length > 3) throw new Error("Booking plan: up to three steps (T1, T2, T3).");
  if (list.some(x => !(x >= 0 && x <= 100))) throw new Error("Booking plan: each step is 0–100% of the position.");
  if (list.reduce((a, x) => a + x, 0) > 100.01) throw new Error("Booking plan adds up to more than 100%.");
  return list.map(r2);
}
// Shares to have sold by each target: the last step of a plan that adds up to 100% is "the rest".
export function planShares(base, plan, levels) {
  const out = []; let cum = 0;
  for (let i = 0; i < levels; i++) { cum += plan[i] || 0; out.push(i === levels - 1 && cum >= 99.99 ? base : Math.min(base, Math.round(base * cum / 100))); }
  return out; // cumulative
}
// Profit targets T1 < T2 < T3 as % above the average price. Accepts [10,20,40], "10, 20, 40", "10/20/40" or one number
// (older single-target settings: that number becomes T1 and the default levels above it follow).
export function parseTargets(v) {
  if (v === "" || v == null) return null;
  const list = (Array.isArray(v) ? v : typeof v === "number" ? [v] : String(v).split(/[\s,/;|]+/)).filter(x => x !== "" && x != null).map(x => Number(String(x).replace(/%$/, "")));
  if (!list.length) return null;
  if (list.some(x => !(x > 0 && x <= 500))) throw new Error("Targets must be between 0 and 500%.");
  if (list.length > 3) throw new Error("Up to three targets (T1, T2, T3).");
  for (let i = 1; i < list.length; i++) if (!(list[i] > list[i - 1])) throw new Error("Each target must be higher than the one before (e.g. 10, 20, 40).");
  if (list.length === 1) { const extra = SWING_DEFAULTS.targets.filter(x => x > list[0]); return [list[0], ...extra].slice(0, 3); }
  return list.map(r2);
}
const settingsTargets = S => parseTargets(S.targets) || (S.targetPct ? parseTargets(S.targetPct) : null) || [...SWING_DEFAULTS.targets];
const fin = v => Number.isFinite(v);
const r2 = v => (fin(v) ? Math.round(v * 100) / 100 : null);
const txt = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

// "2L" → 200000, "10 lakh" → 1000000, "1.5Cr" → 15000000, "50k" → 50000, "200000" → 200000
export function parseAmount(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return fin(v) && v >= 0 ? v : null;
  const m = String(v).replace(/[₹,\s]/g, "").toLowerCase().match(/^(\d+(?:\.\d+)?)(l|lac|lacs|lakh|lakhs|cr|crore|crores|k|thousand)?$/);
  if (!m) return null;
  const n = Number(m[1]), u = m[2] || "";
  return Math.round(n * (/^l/.test(u) ? 1e5 : /^cr/.test(u) ? 1e7 : /^(k|thousand)/.test(u) ? 1e3 : 1));
}
// "4.7k" → 4700, "2,834.5" → 2834.5
export function parsePrice(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return fin(v) && v > 0 ? v : null;
  const m = String(v).replace(/[₹,\s]/g, "").toLowerCase().match(/^(\d+(?:\.\d+)?)(k)?$/);
  return m ? Number(m[1]) * (m[2] ? 1000 : 1) : null;
}

// Buy-the-dip list typed or pasted in one go: "TCS below 2100, infy below 1000, hcl below 1200 2L, VBL < 400 hdfc 680".
// Returns [{ name, buyBelow, amount }]; names are resolved to NSE symbols by the server (DIP_ALIASES first).
export const DIP_ALIASES = { HDFC: "HDFCBANK", "HDFC BANK": "HDFCBANK", HCL: "HCLTECH", "HCL TECH": "HCLTECH", SBI: "SBIN", ICICI: "ICICIBANK", "ICICI BANK": "ICICIBANK", AXIS: "AXISBANK", "AXIS BANK": "AXISBANK", KOTAK: "KOTAKBANK", "KOTAK BANK": "KOTAKBANK", AIRTEL: "BHARTIARTL", "BHARTI AIRTEL": "BHARTIARTL", RIL: "RELIANCE", "L&T": "LT", LNT: "LT", HUL: "HINDUNILVR", "BAJAJ FINANCE": "BAJFINANCE", "BAJAJ FINSERV": "BAJAJFINSV", "ASIAN PAINTS": "ASIANPAINT", "SUN PHARMA": "SUNPHARMA", "TATA MOTORS": "TATAMOTORS", "TATA STEEL": "TATASTEEL", "TECH MAHINDRA": "TECHM", INFOSYS: "INFY", "VARUN BEVERAGES": "VBL", MAHINDRA: "M&M", "M AND M": "M&M", "DR REDDY": "DRREDDY", "ADANI PORTS": "ADANIPORTS", "ADANI ENT": "ADANIENT", "POWER GRID": "POWERGRID", "COAL INDIA": "COALINDIA", "HERO": "HEROMOTOCO", "EICHER": "EICHERMOT", "PERSISTENT": "PERSISTENT", "LTIM": "LTIM", "MINDTREE": "LTIM", "ZOMATO": "ETERNAL", "PAYTM": "PAYTM", "NYKAA": "NYKAA", "DMART": "DMART", "PIDILITE": "PIDILITIND", "BRITANNIA": "BRITANNIA", "NESTLE": "NESTLEIND", "TITAN": "TITAN", "ULTRATECH": "ULTRACEMCO" };
export function parseDipText(text) {
  const out = [], seen = new Set();
  const src = String(text || "").replace(/\r/g, "").slice(0, 5000);
  const re = /([A-Za-z][A-Za-z0-9&.'\- ]*?)\s*(?:below|under|less than|<=?|@|at|:|=|->|–|-)?\s*(?:rs\.?|₹|inr)?\s*(\d[\d,]*(?:\.\d+)?\s*k?)(?![\d.])(?:\s*(?:for|amt|amount|of|with|,)?\s*(?:rs\.?|₹)?\s*(\d+(?:\.\d+)?\s*(?:l|lac|lacs|lakh|lakhs|cr|crore|k)\b))?/gi;
  for (const m of src.matchAll(re)) {
    let name = m[1].replace(/\s+/g, " ").trim();
    for (let i = 0; i < 4; i++) name = name.replace(/^(and|or|say|e\.?g\.?|etc\.?|buy|then|also|plus|when|if|is|stock)\b\s*/i, "").trim();
    name = name.replace(/\s+(below|under|at|is|for)$/i, "").trim();
    if (!name || /^(etc|and|rs|l|k|cr)$/i.test(name) || name.length > 40) continue;
    const buyBelow = parsePrice(m[2]); if (!buyBelow) continue;
    let amount = m[3] ? parseAmount(m[3].replace(/\s+/g, "")) : null;
    // "2100 2L" read as price 2100 + amount 2L; "2100k"-style typos are left to the preview
    const key = `${name.toUpperCase()}@${buyBelow}`; if (seen.has(key)) continue; seen.add(key);
    out.push({ name, buyBelow, amount });
  }
  return out.slice(0, 60);
}

// Buy lots, oldest first (for FIFO tax on sales). Older positions without lots count as one lot at the average price.
export function lotsOf(p) {
  const l = Array.isArray(p.lots) ? p.lots.filter(x => x.qty > 0) : [];
  return l.length && l.reduce((a, x) => a + x.qty, 0) === p.qty ? l.map(x => ({ ...x })) : [{ qty: p.qty, price: p.avgPrice, at: p.openedAt || new Date().toISOString() }];
}
const byAt = (a, b) => String(a.at).localeCompare(String(b.at));
const id = () => `sw${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export function sanitizePosition(b = {}, prev = null) {
  const symbol = txt(b.symbol, 20).toUpperCase();
  if (!/^[A-Z0-9&-]{1,20}$/.test(symbol)) throw new Error("Pick the stock (NSE symbol).");
  const qty = Number(b.qty), avgPrice = parsePrice(b.avgPrice);
  if (!(qty > 0) || !Number.isInteger(qty)) throw new Error("Quantity must be a whole number of shares.");
  if (!(avgPrice > 0)) throw new Error("Enter your average buy price.");
  const limit = parseAmount(b.limit), addAmount = parseAmount(b.addAmount), addBelow = parsePrice(b.addBelow), targets = parseTargets(b.targets ?? b.targetPct);
  const bookPlan = b.bookPlan === undefined ? prev?.bookPlan ?? null : parseBookPlan(b.bookPlan);
  const stopLoss = b.stopLoss === undefined ? prev?.stopLoss ?? null : parsePrice(b.stopLoss);
  let openedAt = prev?.openedAt || new Date().toISOString();
  if (b.boughtOn && String(b.boughtOn).slice(0, 10) !== String(prev?.openedAt || "").slice(0, 10)) openedAt = tradeDate(b.boughtOn); // only a changed date
  // keep the buy lots when nothing that shapes them changed; otherwise one lot at the (new) average and date
  const same = prev && prev.qty === qty && r2(prev.avgPrice) === r2(avgPrice) && prev.openedAt === openedAt;
  const lots = same ? lotsOf(prev) : [{ qty, price: r2(avgPrice), at: openedAt }];
  return { id: prev?.id || id(), symbol, exchange: b.exchange === "BSE" ? "BSE" : "NSE", name: txt(b.name, 80) || prev?.name || symbol, qty, avgPrice: r2(avgPrice), limit, addAmount, addBelow, targets, bookPlan, stopLoss, soldAtTargets: same ? prev.soldAtTargets || 0 : 0, lots, notes: txt(b.notes, 200) || null, setup: b.setup === undefined ? prev?.setup ?? null : SETUPS[b.setup] ? b.setup : null, reason: b.reason === undefined ? prev?.reason ?? null : txt(b.reason, 300) || null, ...(prev?.adjustments ? { adjustments: prev.adjustments } : {}), openedAt, updatedAt: new Date().toISOString() };
}
export function sanitizeWatch(b = {}, prev = null) {
  const symbol = txt(b.symbol, 20).toUpperCase();
  if (!/^[A-Z0-9&-]{1,20}$/.test(symbol)) throw new Error("Pick the stock (NSE symbol).");
  const buyBelow = parsePrice(b.buyBelow), amount = parseAmount(b.amount), stopLoss = b.stopLoss === undefined ? prev?.stopLoss ?? null : parsePrice(b.stopLoss);
  const idea = b.idea === undefined ? prev?.idea ?? null : (b.idea && typeof b.idea === "object" ? { setup: txt(b.idea.setup, 20), label: txt(b.idea.label, 60), t1: parsePrice(b.idea.t1), t2: parsePrice(b.idea.t2), at: new Date().toISOString() } : null);
  const list = b.list === undefined ? prev?.list ?? null : b.list === "dip" ? "dip" : null;
  if (list === "dip" && !buyBelow) throw new Error(`${symbol}: set the price to buy below.`);
  return { id: prev?.id || id(), symbol, exchange: b.exchange === "BSE" ? "BSE" : "NSE", name: txt(b.name, 80) || prev?.name || symbol, list, buyBelow, amount, stopLoss, idea, notes: txt(b.notes, 200) || null, addedAt: prev?.addedAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
}
// Buy more: new average price. Sell: smaller position plus a closed-trade record.
// Buying more starts a new booking cycle (targets move with the new average).
export function applyBuy(p, qty, price, at = new Date().toISOString()) { const q = p.qty + qty; return { ...p, qty: q, avgPrice: r2((p.qty * p.avgPrice + qty * price) / q), lots: [...lotsOf(p), { qty, price: r2(price), at }], soldAtTargets: 0, updatedAt: at }; }
// atTarget: sold at or above T1 (counts towards the booking plan).
export function applySell(p, qty, price, at = new Date().toISOString(), { atTarget = false } = {}) {
  if (!(qty > 0) || qty > p.qty) throw new Error(`You can sell 1 to ${p.qty} shares.`);
  const lots = lotsOf(p).sort(byAt), used = []; let left = qty;
  while (left > 0 && lots.length) { const l = lots[0], n = Math.min(l.qty, left); used.push({ qty: n, price: l.price, at: l.at }); l.qty -= n; left -= n; if (!l.qty) lots.shift(); }
  const trade = { id: id(), symbol: p.symbol, name: p.name, qty, buyAvg: p.avgPrice, sellPrice: r2(price), pnl: r2((price - p.avgPrice) * qty), pnlPct: r2((price / p.avgPrice - 1) * 100), openedAt: p.openedAt, closedAt: at, lots: used, atTarget: !!atTarget, setup: p.setup ?? null, reason: p.reason ?? null,
    // what the position looked like, so an accidental sale can be undone with its plan intact
    plan: { exchange: p.exchange, limit: p.limit ?? null, addAmount: p.addAmount ?? null, addBelow: p.addBelow ?? null, targets: p.targets ?? null, bookPlan: p.bookPlan ?? null, notes: p.notes ?? null, setup: p.setup ?? null, reason: p.reason ?? null, stopLoss: p.stopLoss ?? null } };
  return { position: qty === p.qty ? null : { ...p, qty: p.qty - qty, lots, soldAtTargets: (p.soldAtTargets || 0) + (atTarget ? qty : 0), updatedAt: at }, trade };
}

// Undo a sale: the shares go back into the position at the price they were bought at (merged with what is still
// held, so the average is exactly what it was before the sale). Returns the new positions list.
export function reopenTrade(positions, t, at = new Date().toISOString()) {
  const cur = positions.find(p => p.symbol === t.symbol);
  const back = Array.isArray(t.lots) && t.lots.length ? t.lots.map(l => ({ ...l })) : [{ qty: t.qty, price: t.buyAvg, at: t.openedAt || at }];
  if (cur) {
    const qty = cur.qty + t.qty, avgPrice = r2((cur.qty * cur.avgPrice + t.qty * t.buyAvg) / qty);
    return positions.map(p => (p === cur ? { ...p, qty, avgPrice, lots: [...back, ...lotsOf(cur)].sort(byAt), soldAtTargets: Math.max(0, (cur.soldAtTargets || 0) - (t.atTarget ? t.qty : 0)), updatedAt: at } : p));
  }
  const pl = t.plan || {};
  return [...positions, { id: id(), symbol: t.symbol, exchange: pl.exchange || "NSE", name: t.name || t.symbol, qty: t.qty, avgPrice: t.buyAvg, limit: pl.limit ?? null, addAmount: pl.addAmount ?? null, addBelow: pl.addBelow ?? null, targets: pl.targets ?? null, bookPlan: pl.bookPlan ?? null, soldAtTargets: 0, lots: back.sort(byAt), notes: pl.notes ?? null, openedAt: t.openedAt || at, updatedAt: at }];
}

// Paste from a spreadsheet: one stock per line; recognises qty + average price (a position) and
// "Add 2L below 4.7k" / limit "3L" (plan). Lines without qty/price become swing-watchlist entries.
export function parseSheet(text) {
  const out = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim(); if (!line) continue;
    if (/\b(qty|ltp)\b/i.test(line) && /purchase|profit|limit|value/i.test(line)) continue; // header row
    const cells = (raw.includes("\t") ? raw.split("\t") : raw.split(/\s{2,}|,(?!\d{3})/)).map(c => c.trim()).filter(Boolean);
    const plan = line.match(/add\s+(?:₹\s*)?([\d.]+\s*(?:l|lac|lakh|lakhs|cr|crore|k)?)\s*(?:below|under|<)\s*(?:₹\s*)?([\d.,]+\s*k?)?/i);
    const nameIdx = cells.findIndex(c => /[a-z]/i.test(c) && !/^(add|total|stock|qty|limit|ltp)\b/i.test(c) && !/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(c) && !/^[\d.]+\s*(l|lac|lakh|cr|k)$/i.test(c));
    if (nameIdx < 0) continue;
    const name = cells[nameIdx];
    if (/^(stock|total|name)$/i.test(name)) continue;
    const after = cells.slice(nameIdx + 1).filter(c => !/^add\b/i.test(c));
    const nums = after.map(c => c.replace(/,/g, "")).filter(c => /^-?\d+(\.\d+)?$/.test(c)).map(Number);
    const limitCell = after.find(c => /^[\d.]+\s*(l|lac|lakh|lakhs|cr|crore)$/i.test(c));
    const qty = nums.length >= 2 && Number.isInteger(nums[0]) && nums[0] > 0 ? nums[0] : null, avgPrice = qty ? nums[1] : null;
    out.push({ name, qty, avgPrice, limit: limitCell ? parseAmount(limitCell) : null, addAmount: plan ? parseAmount(plan[1].replace(/\s+/g, "")) : null, addBelow: plan?.[2] ? parsePrice(plan[2].replace(/\s+/g, "")) : null, kind: qty && avgPrice ? "position" : "watch" });
  }
  return out;
}

// prices: Map(symbol -> { price, prevClose?, source, at })
// cash: the free cash set aside for swing trades (null = not tracked).
export function evaluateSwing({ positions = [], watch = [], prices = new Map(), settings = {}, cash = null } = {}) {
  const S = { ...SWING_DEFAULTS, ...settings }; S.targets = settingsTargets(settings); S.bookPlan = parseBookPlan(settings.bookPlan) || [...SWING_DEFAULTS.bookPlan]; delete S.targetPct;
  const rows = positions.map(p => {
    const q = prices.get(p.symbol) || {}, price = fin(q.price) ? q.price : null;
    const invested = p.qty * p.avgPrice, value = price !== null ? p.qty * price : null;
    const pnl = value !== null ? value - invested : null, pnlPct = price !== null ? (price / p.avgPrice - 1) * 100 : null;
    const tPcts = p.targets || (p.targetPct ? parseTargets(p.targetPct) : null) || S.targets, room = p.limit ? Math.max(0, p.limit - invested) : null;
    const plan = p.bookPlan || S.bookPlan, sold = p.soldAtTargets || 0, base = p.qty + sold, cum = planShares(base, plan, tPcts.length);
    const targets = tPcts.map((pct, i) => { const tp = r2(p.avgPrice * (1 + pct / 100)), sellQty = cum[i] - (i ? cum[i - 1] : 0); return { n: i + 1, pct, price: tp, hit: price !== null && price >= tp, sellQty, planPct: plan[i] || 0, done: sold >= cum[i] && sellQty > 0, profit: r2(sellQty * (tp - p.avgPrice)) }; });
    const hitLevel = targets.filter(t => t.hit).length, hit = targets[hitLevel - 1] || null, next = targets[hitLevel] || null;
    const sellNow = hit ? Math.max(0, Math.min(p.qty, cum[hitLevel - 1] - sold)) : 0;
    const deployAmt = p.addAmount != null ? (room === null ? p.addAmount : Math.min(p.addAmount, room)) : room;
    let status = "hold", note = null;
    const atAdd = p.addBelow && price !== null && price <= p.addBelow, dipped = !p.addBelow && pnlPct !== null && pnlPct <= -S.dipPct;
    const rs = v => `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
    const stopHit = p.stopLoss && price !== null && price <= p.stopLoss, nearStop = p.stopLoss && price !== null && !stopHit && price <= p.stopLoss * (1 + S.nearPct / 100);
    const nextTxt = next ? `Next T${next.n}: ${rs(next.price)} (+${next.pct}%)${next.sellQty ? `, sell ${next.sellQty}` : ""}.` : "All targets hit.";
    if (stopHit) { status = "stop-hit"; note = `At or below your stop-loss ₹${p.stopLoss}: ${p.stopLoss >= p.avgPrice ? "sell to lock in the gain" : `exit to cap the loss (about ₹${Math.round(Math.abs(pnl)).toLocaleString("en-IN")})`}, or move the stop if your plan changed.`; }
    else if (hit && sellNow > 0) { status = "take-profit"; note = `T${hit.n} hit (+${hit.pct}% = ${rs(hit.price)}). Plan: sell ${sellNow} of ${p.qty} shares now (about ₹${Math.round(sellNow * (price - p.avgPrice)).toLocaleString("en-IN")} profit). ${nextTxt}`; }
    else if (atAdd || dipped) { status = room === 0 ? "deploy-limit" : "deploy"; note = room === 0 ? `At your add level, but the ₹${(p.limit / 1e5).toFixed(1)}L limit is used up.` : `${atAdd ? `At or below your add level ₹${p.addBelow}` : `Down ${Math.abs(r2(pnlPct))}%`}: deploy${deployAmt ? ` up to ₹${Math.round(deployAmt).toLocaleString("en-IN")}` : ""}.`; }
    else if (next && pnlPct !== null && pnlPct >= next.pct - S.nearPct) { status = "near-profit"; note = `${r2(next.pct - pnlPct)}% away from T${next.n} ${rs(next.price)}${next.sellQty ? `: plan to sell ${next.sellQty}` : ""}.`; }
    else if (nearStop) { status = "near-stop"; note = `${r2((price / p.stopLoss - 1) * 100)}% above your stop-loss ₹${p.stopLoss}.`; }
    else if (hit) { status = "riding"; note = `Booked as planned up to T${hit.n}. ${next ? nextTxt : `Holding ${p.qty} share${p.qty === 1 ? "" : "s"} as a runner.`}`; }
    else if (p.addBelow && price !== null && price <= p.addBelow * (1 + S.nearPct / 100)) { status = "near-deploy"; note = `${r2((price / p.addBelow - 1) * 100)}% above your add level ₹${p.addBelow}.`; }
    return { ...p, kind: "position", price, prevClose: q.prevClose ?? null, dayPct: fin(q.prevClose) && price !== null ? r2((price / q.prevClose - 1) * 100) : null, priceSource: q.source || null, priceAt: q.at || null,
      invested: r2(invested), value: r2(value), pnl: r2(pnl), pnlPct: r2(pnlPct), lots: lotsOf(p), lotCount: lotsOf(p).length, targets, hitLevel, nextTarget: next, sellNow, bookPlan: plan, ownPlan: !!p.bookPlan, soldAtTargets: sold, ownTargets: !!(p.targets || p.targetPct), target: targets[0].pct, targetPrice: targets[0].price, room: r2(room), deployAmount: r2(deployAmt), distanceToAdd: p.addBelow && price !== null ? r2((price / p.addBelow - 1) * 100) : null, status, note };
  });
  const wrows = watch.map(w => {
    const q = prices.get(w.symbol) || {}, price = fin(q.price) ? q.price : null;
    let status = "watch", note = w.buyBelow ? null : "Set a buy-below price to get a deploy alert.";
    const dist = w.buyBelow && price !== null ? (price / w.buyBelow - 1) * 100 : null;
    if (dist !== null && dist <= 0) { status = "deploy"; note = `At or below ₹${w.buyBelow}: deploy${w.amount ? ` ₹${Math.round(w.amount).toLocaleString("en-IN")}` : ""}.`; }
    else if (dist !== null && dist <= S.nearPct) { status = "near-deploy"; note = `${r2(dist)}% above your buy level.`; }
    return { ...w, kind: "watch", price, prevClose: q.prevClose ?? null, dayPct: fin(q.prevClose) && price !== null ? r2((price / q.prevClose - 1) * 100) : null, priceSource: q.source || null, distance: r2(dist), status, note };
  });
  const sum = (arr, k) => r2(arr.reduce((a, x) => a + (fin(x[k]) ? x[k] : 0), 0));
  const deployNow = [...rows.filter(r => r.status === "deploy"), ...wrows.filter(w => w.status === "deploy")].reduce((a, x) => a + (fin(x.deployAmount) ? x.deployAmount : fin(x.amount) ? x.amount : 0), 0);
  const priced = rows.filter(r => r.price !== null);
  return {
    settings: S, positions: rows, watch: wrows,
    totals: { cash: fin(cash) ? r2(cash) : null, cashShort: fin(cash) && deployNow > cash ? Math.round(deployNow - cash) : 0, riding: rows.filter(r => r.status === "riding").length, invested: sum(rows, "invested"), value: sum(priced, "value"), missing: rows.filter(r => r.price === null).map(r => r.symbol), pnl: sum(priced, "pnl"), pnlPct: sum(priced, "invested") ? r2(sum(priced, "pnl") / sum(priced, "invested") * 100) : null, takeProfit: rows.filter(r => r.status === "take-profit").length, stopHit: rows.filter(r => r.status === "stop-hit").length, deploy: rows.filter(r => r.status === "deploy").length + wrows.filter(w => w.status === "deploy").length, deployNow: Math.round(deployNow), unpriced: rows.length + wrows.length - priced.length - wrows.filter(w => w.price !== null).length }
  };
}

// Alerts when an item becomes "take-profit" or "deploy", and again each time a higher target (T2, T3) is reached
// (not on every check; the same alert repeats only after 24 h).
export function diffSwingAlerts(prev = {}, view, { now = Date.now(), events = [] } = {}) {
  const next = {}, fresh = [];
  const recent = (key) => events.some(e => e.swingKey === key && now - new Date(e.at).getTime() < 24 * 3600e3);
  for (const r of [...view.positions, ...view.watch]) {
    const key = `${r.kind}:${r.id}`, state = r.status === "take-profit" || r.status === "riding" ? `${r.status}:${r.hitLevel}` : r.status; next[key] = state;
    if (r.price === null || prev[key] === state) continue;
    const prevLevel = /^(take-profit|riding)(?::(\d))?$/.test(prev[key] || "") ? Number(prev[key].split(":")[1] || 1) : 0;
    if (r.status === "take-profit" && r.hitLevel > prevLevel && !recent(`${key}:tp${r.hitLevel}`)) { const t = r.targets[r.hitLevel - 1]; fresh.push({ type: "swing-profit", swingKey: `${key}:tp${r.hitLevel}`, symbol: r.symbol, company: r.name, price: r.price, at: new Date(now).toISOString(), read: false, title: `🎯 ${r.name} hit T${t.n} (+${t.pct}%, ₹${t.price}): now ₹${r.price}, sell ${r.sellNow}?`, detail: r.note }); }
    if (r.status === "stop-hit" && !recent(`${key}:sl`)) fresh.push({ type: "swing-stop", swingKey: `${key}:sl`, symbol: r.symbol, company: r.name, price: r.price, at: new Date(now).toISOString(), read: false, title: `🛑 ${r.name} hit your stop-loss ₹${r.stopLoss}: now ₹${r.price}`, detail: r.note });
    if (r.status === "deploy" && !recent(`${key}:dp`)) fresh.push({ type: "swing-deploy", swingKey: `${key}:dp`, symbol: r.symbol, company: r.name, price: r.price, at: new Date(now).toISOString(), read: false, title: r.list === "dip" ? `📉 ${r.name} dipped to ₹${r.price}: at your buy-the-dip level ₹${r.buyBelow}` : `💰 ${r.name} at ₹${r.price}: time to deploy`, detail: r.note });
  }
  return { next, fresh };
}

// Cash set aside for swing trades: buys take from it, sales add to it, undoing a sale reverses it.
export function moveCash(st, amount, why, at = new Date().toISOString()) {
  if (!st.cash || !fin(st.cash.balance) || !fin(amount) || !amount) return st;
  const balance = r2(st.cash.balance + amount);
  st.cash = { ...st.cash, balance, log: [{ at, amount: r2(amount), why, balance }, ...(st.cash.log || [])].slice(0, 60) };
  return st;
}

// How the swing trades have gone: win rate, average win vs loss, holding period, best / worst.
export function scorecard(closed = []) {
  const t = closed.filter(x => fin(x.pnl));
  const wins = t.filter(x => x.pnl > 0), losses = t.filter(x => x.pnl < 0);
  const sum = (a, k) => a.reduce((s, x) => s + x[k], 0), avg = (a, k) => (a.length ? r2(sum(a, k) / a.length) : null);
  const days = x => { const ls = Array.isArray(x.lots) && x.lots.length ? x.lots : [{ qty: x.qty, at: x.openedAt }]; const q = ls.reduce((s, l) => s + l.qty, 0) || 1; return ls.reduce((s, l) => s + l.qty * Math.max(0, (Date.parse(x.closedAt) - Date.parse(l.at || x.closedAt)) / 864e5), 0) / q; };
  const grossWin = sum(wins, "pnl"), grossLoss = Math.abs(sum(losses, "pnl"));
  const best = t.length ? t.reduce((a, x) => (x.pnl > a.pnl ? x : a)) : null, worst = t.length ? t.reduce((a, x) => (x.pnl < a.pnl ? x : a)) : null;
  const pick = x => x && { symbol: x.symbol, name: x.name, pnl: x.pnl, pnlPct: x.pnlPct, closedAt: x.closedAt };
  const byMonth = {}; for (const x of t) { const m = String(x.closedAt).slice(0, 7); byMonth[m] = r2((byMonth[m] || 0) + x.pnl); }
  return {
    trades: t.length, wins: wins.length, losses: losses.length, winRate: t.length ? r2(wins.length / t.length * 100) : null,
    avgWin: avg(wins, "pnl"), avgLoss: avg(losses, "pnl"), avgWinPct: avg(wins, "pnlPct"), avgLossPct: avg(losses, "pnlPct"),
    profitFactor: grossLoss ? r2(grossWin / grossLoss) : null, expectancy: t.length ? r2(sum(t, "pnl") / t.length) : null,
    avgHoldDays: t.length ? Math.round(t.reduce((s, x) => s + days(x), 0) / t.length) : null, atTargets: t.filter(x => x.atTarget).length,
    best: pick(best), worst: pick(worst?.pnl < 0 ? worst : null), total: r2(sum(t, "pnl")),
    months: Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b)).slice(-12).map(([month, pnl]) => ({ month, pnl }))
  };
}

// Tax rows for the export: each sale split into its FIFO buy lots, short or long term (held more than 12 months),
// and a per-financial-year estimate for these swing trades alone.
export function swingTaxRows(closed = []) {
  const rows = [];
  for (const t of closed) {
    const lots = Array.isArray(t.lots) && t.lots.length ? t.lots : [{ qty: t.qty, price: t.buyAvg, at: t.openedAt || t.closedAt }];
    const sellDay = String(t.closedAt).slice(0, 10);
    for (const l of lots) {
      const buyDay = String(l.at || t.closedAt).slice(0, 10), long = sellDay >= ltDate(buyDay);
      rows.push({ fy: fyOf(sellDay).label, symbol: t.symbol, name: t.name, qty: l.qty, buyDay, buyPrice: l.price, sellDay, sellPrice: t.sellPrice, cost: r2(l.qty * l.price), proceeds: r2(l.qty * t.sellPrice), gain: r2(l.qty * (t.sellPrice - l.price)), days: Math.round((Date.parse(sellDay) - Date.parse(buyDay)) / 864e5), term: long ? "LTCG" : "STCG", atTarget: !!t.atTarget, tradeId: t.id });
    }
  }
  rows.sort((a, b) => a.sellDay.localeCompare(b.sellDay) || a.symbol.localeCompare(b.symbol));
  const years = {};
  for (const r of rows) { const y = years[r.fy] ||= { fy: r.fy, stGain: 0, stLoss: 0, ltGain: 0, ltLoss: 0 }; if (r.term === "STCG") r.gain >= 0 ? (y.stGain += r.gain) : (y.stLoss -= r.gain); else r.gain >= 0 ? (y.ltGain += r.gain) : (y.ltLoss -= r.gain); }
  const fys = Object.values(years).sort((a, b) => a.fy.localeCompare(b.fy)).map(y => ({ ...y, stGain: r2(y.stGain), stLoss: r2(y.stLoss), ltGain: r2(y.ltGain), ltLoss: r2(y.ltLoss), ...taxFor(y) }));
  return { rows, years: fys, rules: TAX_RULES };
}

// A trade date from a form ("2026-10-01"), not in the future; time set to market open IST so it sorts within the day.
export function tradeDate(v, now = new Date()) {
  if (v === undefined || v === null || v === "") return now.toISOString();
  const d = String(v).slice(0, 10), today = new Date(now.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) throw new Error("Enter the trade date as a date.");
  if (d > today) throw new Error("The trade date cannot be in the future.");
  if (d < "1995-01-01") throw new Error("That trade date is too old.");
  return d === today ? now.toISOString() : `${d}T03:45:00.000Z`;
}

// Replace a position's buy lots (the dates and prices you actually bought at). Quantity and average follow from the lots.
export function setLots(p, rows, now = new Date()) {
  if (!Array.isArray(rows) || !rows.length) throw new Error("Add at least one buy (date, quantity, price).");
  if (rows.length > 200) throw new Error("At most 200 buys per position.");
  const lots = rows.map((r, i) => {
    const qty = Number(r.qty), price = parsePrice(r.price);
    if (!(qty > 0) || !Number.isInteger(qty)) throw new Error(`Row ${i + 1}: quantity must be a whole number.`);
    if (!(price > 0)) throw new Error(`Row ${i + 1}: enter the buy price.`);
    let at; try { at = tradeDate(r.date || "", now); } catch (e) { throw new Error(`Row ${i + 1}: ${e.message}`); }
    return { qty, price: r2(price), at };
  }).sort(byAt);
  const qty = lots.reduce((a, l) => a + l.qty, 0), avgPrice = r2(lots.reduce((a, l) => a + l.qty * l.price, 0) / qty);
  return { ...p, lots, qty, avgPrice, openedAt: lots[0].at, soldAtTargets: Math.min(p.soldAtTargets || 0, qty), updatedAt: now.toISOString() };
}

// Ledger: every buy (by date and price, with how much of it is still held or was sold) and every sale, newest first.
export function buildLedger(positions = [], closed = []) {
  const buys = new Map(), out = [];
  const add = (sym, name, l, held, sold, soldOn) => {
    const day = String(l.at || "").slice(0, 10), k = `${sym}|${day}|${l.price}`;
    const b = buys.get(k) || { type: "BUY", date: day, at: l.at, symbol: sym, name, qty: 0, price: l.price, held: 0, sold: 0, soldOn: [] };
    b.qty += l.qty; b.held += held; b.sold += sold; if (soldOn) b.soldOn.push(soldOn); buys.set(k, b);
  };
  for (const p of positions) for (const l of lotsOf(p)) add(p.symbol, p.name, l, l.qty, 0, null);
  for (const t of closed) {
    const lots = Array.isArray(t.lots) && t.lots.length ? t.lots : [{ qty: t.qty, price: t.buyAvg, at: t.openedAt || t.closedAt }];
    for (const l of lots) add(t.symbol, t.name, l, 0, l.qty, String(t.closedAt).slice(0, 10));
    out.push({ type: "SELL", date: String(t.closedAt).slice(0, 10), at: t.closedAt, symbol: t.symbol, name: t.name, qty: t.qty, price: t.sellPrice, value: r2(t.qty * t.sellPrice), buyAvg: t.buyAvg, pnl: t.pnl, pnlPct: t.pnlPct, atTarget: !!t.atTarget, tradeId: t.id });
  }
  for (const b of buys.values()) out.push({ ...b, value: r2(b.qty * b.price), soldOn: [...new Set(b.soldOn)].sort() });
  out.sort((a, b) => String(b.at).localeCompare(String(a.at)) || (a.type === "SELL" ? -1 : 1));
  const stocks = {};
  for (const e of out) {
    const s = stocks[e.symbol] ||= { symbol: e.symbol, name: e.name, bought: 0, boughtValue: 0, sold: 0, soldValue: 0, held: 0, realised: 0, first: e.date, last: e.date };
    if (e.type === "BUY") { s.bought += e.qty; s.boughtValue = r2(s.boughtValue + e.value); s.held += e.held; } else { s.sold += e.qty; s.soldValue = r2(s.soldValue + e.value); s.realised = r2(s.realised + (e.pnl || 0)); }
    if (e.date < s.first) s.first = e.date; if (e.date > s.last) s.last = e.date;
  }
  return { entries: out, stocks: Object.values(stocks).sort((a, b) => a.name.localeCompare(b.name)) };
}

// Buying more of a stock you already hold: one position, with the new buy as another dated lot and a new average.
// The existing plan (limit, add level, targets, stop-loss, booking plan) is kept; blanks are filled from the new entry.
export function mergePositions(a, b, now = new Date().toISOString()) {
  const lots = [...lotsOf(a), ...lotsOf(b)].sort(byAt), qty = lots.reduce((s, l) => s + l.qty, 0);
  const pick = k => a[k] ?? b[k] ?? null;
  return {
    ...a, qty, avgPrice: r2(lots.reduce((s, l) => s + l.qty * l.price, 0) / qty), lots, openedAt: lots[0].at,
    limit: a.limit && b.limit ? Math.max(a.limit, b.limit) : pick("limit"), addAmount: pick("addAmount"), addBelow: pick("addBelow"),
    targets: pick("targets"), bookPlan: pick("bookPlan"), stopLoss: pick("stopLoss"), soldAtTargets: 0,
    notes: [...new Set([a.notes, b.notes].filter(Boolean))].join(" · ").slice(0, 200) || null, updatedAt: now
  };
}
// One position per stock: entries for the same symbol (from earlier versions) are merged. Returns { list, merged: [symbols] }.
export function dedupePositions(list = []) {
  const out = [], at = new Map(), merged = new Set();
  for (const p of list) {
    const k = `${p.exchange || "NSE"}:${p.symbol}`;
    if (at.has(k)) { const i = at.get(k); out[i] = mergePositions(out[i], p, out[i].updatedAt); merged.add(p.symbol); }
    else { at.set(k, out.length); out.push(p); }
  }
  return { list: out, merged: [...merged] };
}

// ---- Charges and tax on selling (equity delivery, NSE) ----
// Zerodha's published delivery charges (zerodha.com/charges, Oct 2026): no brokerage; STT 0.1% on buy and on sell;
// NSE transaction charge 0.00307% (BSE 0.00375%); SEBI ₹10 per crore; stamp duty 0.015% on buys; GST 18% on
// (brokerage + SEBI + transaction charges); DP ₹15.34 per scrip per day of selling (incl. GST). Editable in ⚙.
export const CHARGE_DEFAULTS = Object.freeze({ brokeragePct: 0, sttPct: 0.1, txnPctNse: 0.00307, txnPctBse: 0.00375, sebiPerCr: 10, stampPct: 0.015, gstPct: 18, dpPerSale: 15.34, cessPct: 4 });
const oneSide = (value, side, c, ex = "NSE") => {
  const brokerage = value * c.brokeragePct / 100, stt = value * c.sttPct / 100, txn = value * (ex === "BSE" ? c.txnPctBse : c.txnPctNse) / 100;
  const sebi = value * c.sebiPerCr / 1e7, stamp = side === "buy" ? value * c.stampPct / 100 : 0, gst = (brokerage + txn + sebi) * c.gstPct / 100;
  return { brokerage, stt, txn, sebi, stamp, gst };
};
// lots: [{ qty, price, at }] being sold (FIFO), sellPrice, sellDate. ltExemptLeft: ₹ of the ₹1.25L LTCG exemption still
// unused this financial year. Returns gross profit, every charge, taxable gains, tax (with cess) and the net profit.
export function sellTaxEstimate({ lots = [], sellPrice, sellDate = new Date().toISOString(), exchange = "NSE", ltExemptLeft = TAX_RULES.ltExemption, charges = {} }) {
  const c = { ...CHARGE_DEFAULTS, ...charges };
  const day = String(sellDate).slice(0, 10), qty = lots.reduce((s, l) => s + l.qty, 0);
  if (!(qty > 0) || !(sellPrice > 0)) return null;
  const sellValue = qty * sellPrice, buyValue = lots.reduce((s, l) => s + l.qty * l.price, 0);
  const sell = oneSide(sellValue, "sell", c, exchange), buy = oneSide(buyValue, "buy", c, exchange);
  const dp = c.dpPerSale;
  const sellCharges = sell.brokerage + sell.stt + sell.txn + sell.sebi + sell.gst + dp, buyCharges = buy.brokerage + buy.stt + buy.txn + buy.sebi + buy.stamp + buy.gst;
  // Gains per lot (short term: held 12 months or less). Charges other than STT count as cost of buying / selling.
  let st = 0, lt = 0, stQty = 0, ltQty = 0;
  for (const l of lots) {
    const buyDay = String(l.at || day).slice(0, 10), long = day >= ltDate(buyDay);
    const deductible = (buyCharges - buy.stt + sellCharges - sell.stt) * (l.qty * l.price + l.qty * sellPrice) / (buyValue + sellValue || 1);
    const g = l.qty * (sellPrice - l.price) - deductible;
    if (long) { lt += g; ltQty += l.qty; } else { st += g; stQty += l.qty; }
  }
  // Set-off inside this sale: a short-term loss can reduce long-term gains, a long-term loss only long-term gains.
  let netSt = st, netLt = lt; if (netSt < 0) { netLt += netSt; netSt = 0; } netLt = Math.max(0, netLt);
  const exemptUsed = Math.min(netLt, Math.max(0, ltExemptLeft)), taxableLt = netLt - exemptUsed;
  const stTax = netSt * TAX_RULES.stRate, ltTax = taxableLt * TAX_RULES.ltRate, cess = (stTax + ltTax) * c.cessPct / 100, tax = stTax + ltTax + cess;
  const gross = sellValue - buyValue, totalCharges = sellCharges + buyCharges, net = gross - totalCharges - tax;
  const R = v => Math.round(v * 100) / 100;
  return {
    qty, sellValue: R(sellValue), buyValue: R(buyValue), gross: R(gross), grossPct: R(gross / buyValue * 100),
    charges: { stt: R(sell.stt + buy.stt), sttSell: R(sell.stt), sttBuy: R(buy.stt), exchange: R(sell.txn + buy.txn), sebi: R(sell.sebi + buy.sebi), stamp: R(buy.stamp), gst: R(sell.gst + buy.gst), brokerage: R(sell.brokerage + buy.brokerage), dp: R(dp), sellSide: R(sellCharges), buySide: R(buyCharges), total: R(totalCharges) },
    shortTerm: { qty: stQty, gain: R(st), tax: R(stTax) }, longTerm: { qty: ltQty, gain: R(lt), exemptUsed: R(exemptUsed), taxable: R(taxableLt), tax: R(ltTax) },
    cess: R(cess), tax: R(tax), net: R(net), netPct: R(net / buyValue * 100), keepPct: gross > 0 ? R(net / gross * 100) : null,
    rules: { stRate: TAX_RULES.stRate * 100, ltRate: TAX_RULES.ltRate * 100, ltExemption: TAX_RULES.ltExemption, cessPct: c.cessPct, asOf: TAX_RULES.asOf }
  };
}
// FIFO lots that a sale of `qty` shares would use.
export function lotsForSale(p, qty) {
  const out = []; let left = qty;
  for (const l of lotsOf(p).sort(byAt)) { if (left <= 0) break; const n = Math.min(l.qty, left); out.push({ qty: n, price: l.price, at: l.at }); left -= n; }
  return out;
}
// LTCG exemption left this financial year after the long-term gains already booked in swing trades (and any you used elsewhere).
export function ltExemptionLeft(closed = [], usedElsewhere = 0, today = new Date().toISOString().slice(0, 10)) {
  const fy = fyOf(today).label;
  const booked = swingTaxRows(closed).rows.filter(r => r.fy === fy && r.term === "LTCG").reduce((s, r) => s + r.gain, 0);
  return Math.max(0, TAX_RULES.ltExemption - Math.max(0, booked) - Math.max(0, Number(usedElsewhere) || 0));
}

// ---- Trade journal: setup and reason when you buy, a short review when you sell; results by setup and by mistake ----
export const SETUPS = { dip: "Buy the dip (my price)", pullback: "Pullback to support", breakout: "Breakout", bounce: "Oversold bounce", "value-turn": "Value turn", "golden-cross": "Golden cross + RSI", momentum: "Momentum", "results-play": "Results play", dividend: "Dividend play", other: "Other" };
export const MISTAKES = { "sold-early": "Sold too early", "held-long": "Held too long / ignored target", "no-stop": "No stop-loss / ignored it", oversized: "Position too big", chased: "Chased the entry", "off-plan": "Didn't follow my plan", "news-shock": "News / results surprise", none: "No mistake" };
export function sanitizeReview(b = {}) {
  const mistakes = (Array.isArray(b.mistakes) ? b.mistakes : []).filter(m => MISTAKES[m]).slice(0, 5);
  return { mistakes, note: txt(b.note, 400) || null, rating: [1, 2, 3, 4, 5].includes(Number(b.rating)) ? Number(b.rating) : null, at: new Date().toISOString() };
}
export function journalStats(closed = []) {
  const t = closed.filter(x => fin(x.pnl)), group = (keyOf, labels) => {
    const m = new Map();
    for (const x of t) for (const k of keyOf(x)) { const g = m.get(k) || { key: k, label: labels[k] || k, trades: 0, wins: 0, pnl: 0, pct: 0 }; g.trades++; if (x.pnl > 0) g.wins++; g.pnl += x.pnl; g.pct += x.pnlPct || 0; m.set(k, g); }
    return [...m.values()].map(g => ({ ...g, pnl: Math.round(g.pnl), winRate: r2(g.wins / g.trades * 100), avgPct: r2(g.pct / g.trades) })).sort((a, b) => b.pnl - a.pnl);
  };
  const bySetup = group(x => [x.setup || "untagged"], { ...SETUPS, untagged: "Not tagged" });
  // "sold before target 1 while in profit" is detected from the numbers, even without a review
  const auto = x => { const m = [...(x.review?.mistakes || [])]; if (!x.atTarget && x.pnl > 0 && !m.includes("sold-early") && !m.includes("none")) m.push("auto-early"); return m.length ? m : ["unreviewed"]; };
  const byMistake = group(auto, { ...MISTAKES, "auto-early": "Sold in profit before target 1 (detected)", unreviewed: "Not reviewed" }).sort((a, b) => a.pnl - b.pnl);
  // what selling early cost: for trades sold in profit before T1, the gap to T1 on the shares sold
  const early = t.filter(x => !x.atTarget && x.pnl > 0 && x.t1Price > x.sellPrice), missed = Math.round(early.reduce((s, x) => s + (x.t1Price - x.sellPrice) * x.qty, 0));
  return { bySetup, byMistake, reviewed: t.filter(x => x.review).length, total: t.length, earlyExits: { trades: t.filter(x => !x.atTarget && x.pnl > 0).length, missedToT1: early.length ? missed : null } };
}

// ---- Booked profit by month and financial year, and the tax still to pay on it ----
// Month and FY follow the sale date in India (IST). Tax per FY: short-term 20%, long-term 12.5% above the ₹1.25 lakh
// exemption (less any exemption you used outside swing trades, for the current FY), plus cess; losses set off as in
// taxFor. Payments you record (advance tax, self-assessment) are subtracted to give what is still due.
const istDay = iso => new Date(Date.parse(iso) + 5.5 * 3600e3).toISOString().slice(0, 10);
export function bookedSummary(closed = [], { taxPaid = [], ltUsedElsewhere = 0, cessPct = 4, today = istDay(new Date().toISOString()) } = {}) {
  const months = new Map();
  for (const t of closed) {
    if (!t.closedAt || !Number.isFinite(Number(t.pnl))) continue;
    const day = istDay(t.closedAt), m = day.slice(0, 7), g = months.get(m) || { month: m, fy: fyOf(day).label, trades: 0, pnl: 0, wins: 0 };
    g.trades++; g.pnl += Number(t.pnl); if (t.pnl > 0) g.wins++; months.set(m, g);
  }
  const cur = fyOf(today).label, tx = swingTaxRows(closed), paidBy = {};
  for (const p of taxPaid) paidBy[p.fy] = (paidBy[p.fy] || 0) + (Number(p.amount) || 0);
  const fys = new Set([...tx.years.map(y => y.fy), ...Object.keys(paidBy), cur]);
  const years = [...fys].sort((a, b) => b.localeCompare(a)).map(fy => {
    const y = tx.years.find(x => x.fy === fy) || { stGain: 0, stLoss: 0, ltGain: 0, ltLoss: 0 };
    let st = y.stGain - y.stLoss, lt = y.ltGain - y.ltLoss;
    if (st < 0) { lt += st; st = 0; } lt = Math.max(0, lt);
    const exemption = Math.max(0, TAX_RULES.ltExemption - (fy === cur ? Math.max(0, Number(ltUsedElsewhere) || 0) : 0));
    const taxableLt = Math.max(0, lt - exemption), base = st * TAX_RULES.stRate + taxableLt * TAX_RULES.ltRate, tax = Math.round(base * (1 + cessPct / 100));
    const ms = [...months.values()].filter(m => m.fy === fy), paid = Math.round(paidBy[fy] || 0);
    return { fy, current: fy === cur, trades: ms.reduce((a, m) => a + m.trades, 0), pnl: Math.round(ms.reduce((a, m) => a + m.pnl, 0)), netSt: Math.round(st), netLt: Math.round(lt), taxableLt: Math.round(taxableLt), tax, paid, due: Math.max(0, tax - paid), over: Math.max(0, paid - tax) };
  });
  return {
    currentFy: cur,
    months: [...months.values()].sort((a, b) => b.month.localeCompare(a.month)).map(m => ({ ...m, pnl: Math.round(m.pnl) })),
    years,
    payments: [...taxPaid].sort((a, b) => String(b.date).localeCompare(String(a.date))),
    rules: { stRate: TAX_RULES.stRate * 100, ltRate: TAX_RULES.ltRate * 100, ltExemption: TAX_RULES.ltExemption, cessPct }
  };
}
// A tax payment you record: amount, date paid, the FY it counts against, an optional note (e.g. "Advance tax 15 Dec").
export function sanitizeTaxPayment(b = {}, today = istDay(new Date().toISOString())) {
  const amount = parseAmount(b.amount); if (!(amount > 0) || amount > 1e9) throw new Error("Enter the amount you paid, e.g. 12500 or 1.2L.");
  const date = String(b.date || today).slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new Error("Enter the date you paid.");
  if (date > today) throw new Error("The payment date cannot be in the future.");
  const fy = /^FY \d{4}-\d{2}$/.test(String(b.fy || "")) ? b.fy : fyOf(date).label;
  return { id: Math.random().toString(36).slice(2, 10), amount: Math.round(amount), date, fy, note: String(b.note || "").trim().slice(0, 80) || null, at: new Date().toISOString() };
}
