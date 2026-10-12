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
  let openedAt = prev?.openedAt || new Date().toISOString();
  if (b.boughtOn) { const d = String(b.boughtOn).slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d)) || d > new Date().toISOString().slice(0, 10)) throw new Error("Bought-on date must be a past date."); openedAt = `${d}T09:15:00.000Z`; }
  // keep the buy lots when nothing that shapes them changed; otherwise one lot at the (new) average and date
  const same = prev && prev.qty === qty && r2(prev.avgPrice) === r2(avgPrice) && prev.openedAt === openedAt;
  const lots = same ? lotsOf(prev) : [{ qty, price: r2(avgPrice), at: openedAt }];
  return { id: prev?.id || id(), symbol, exchange: b.exchange === "BSE" ? "BSE" : "NSE", name: txt(b.name, 80) || prev?.name || symbol, qty, avgPrice: r2(avgPrice), limit, addAmount, addBelow, targets, bookPlan, soldAtTargets: same ? prev.soldAtTargets || 0 : 0, lots, notes: txt(b.notes, 200) || null, openedAt, updatedAt: new Date().toISOString() };
}
export function sanitizeWatch(b = {}, prev = null) {
  const symbol = txt(b.symbol, 20).toUpperCase();
  if (!/^[A-Z0-9&-]{1,20}$/.test(symbol)) throw new Error("Pick the stock (NSE symbol).");
  const buyBelow = parsePrice(b.buyBelow), amount = parseAmount(b.amount);
  return { id: prev?.id || id(), symbol, exchange: b.exchange === "BSE" ? "BSE" : "NSE", name: txt(b.name, 80) || prev?.name || symbol, buyBelow, amount, notes: txt(b.notes, 200) || null, addedAt: prev?.addedAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
}
// Buy more: new average price. Sell: smaller position plus a closed-trade record.
// Buying more starts a new booking cycle (targets move with the new average).
export function applyBuy(p, qty, price, at = new Date().toISOString()) { const q = p.qty + qty; return { ...p, qty: q, avgPrice: r2((p.qty * p.avgPrice + qty * price) / q), lots: [...lotsOf(p), { qty, price: r2(price), at }], soldAtTargets: 0, updatedAt: at }; }
// atTarget: sold at or above T1 (counts towards the booking plan).
export function applySell(p, qty, price, at = new Date().toISOString(), { atTarget = false } = {}) {
  if (!(qty > 0) || qty > p.qty) throw new Error(`You can sell 1 to ${p.qty} shares.`);
  const lots = lotsOf(p).sort(byAt), used = []; let left = qty;
  while (left > 0 && lots.length) { const l = lots[0], n = Math.min(l.qty, left); used.push({ qty: n, price: l.price, at: l.at }); l.qty -= n; left -= n; if (!l.qty) lots.shift(); }
  const trade = { id: id(), symbol: p.symbol, name: p.name, qty, buyAvg: p.avgPrice, sellPrice: r2(price), pnl: r2((price - p.avgPrice) * qty), pnlPct: r2((price / p.avgPrice - 1) * 100), openedAt: p.openedAt, closedAt: at, lots: used, atTarget: !!atTarget,
    // what the position looked like, so an accidental sale can be undone with its plan intact
    plan: { exchange: p.exchange, limit: p.limit ?? null, addAmount: p.addAmount ?? null, addBelow: p.addBelow ?? null, targets: p.targets ?? null, bookPlan: p.bookPlan ?? null, notes: p.notes ?? null } };
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
    const nextTxt = next ? `Next T${next.n}: ${rs(next.price)} (+${next.pct}%)${next.sellQty ? `, sell ${next.sellQty}` : ""}.` : "All targets hit.";
    if (hit && sellNow > 0) { status = "take-profit"; note = `T${hit.n} hit (+${hit.pct}% = ${rs(hit.price)}). Plan: sell ${sellNow} of ${p.qty} shares now (about ₹${Math.round(sellNow * (price - p.avgPrice)).toLocaleString("en-IN")} profit). ${nextTxt}`; }
    else if (atAdd || dipped) { status = room === 0 ? "deploy-limit" : "deploy"; note = room === 0 ? `At your add level, but the ₹${(p.limit / 1e5).toFixed(1)}L limit is used up.` : `${atAdd ? `At or below your add level ₹${p.addBelow}` : `Down ${Math.abs(r2(pnlPct))}%`}: deploy${deployAmt ? ` up to ₹${Math.round(deployAmt).toLocaleString("en-IN")}` : ""}.`; }
    else if (next && pnlPct !== null && pnlPct >= next.pct - S.nearPct) { status = "near-profit"; note = `${r2(next.pct - pnlPct)}% away from T${next.n} ${rs(next.price)}${next.sellQty ? `: plan to sell ${next.sellQty}` : ""}.`; }
    else if (hit) { status = "riding"; note = `Booked as planned up to T${hit.n}. ${next ? nextTxt : `Holding ${p.qty} share${p.qty === 1 ? "" : "s"} as a runner.`}`; }
    else if (p.addBelow && price !== null && price <= p.addBelow * (1 + S.nearPct / 100)) { status = "near-deploy"; note = `${r2((price / p.addBelow - 1) * 100)}% above your add level ₹${p.addBelow}.`; }
    return { ...p, kind: "position", price, prevClose: q.prevClose ?? null, dayPct: fin(q.prevClose) && price !== null ? r2((price / q.prevClose - 1) * 100) : null, priceSource: q.source || null, priceAt: q.at || null,
      invested: r2(invested), value: r2(value), pnl: r2(pnl), pnlPct: r2(pnlPct), targets, hitLevel, nextTarget: next, sellNow, bookPlan: plan, ownPlan: !!p.bookPlan, soldAtTargets: sold, ownTargets: !!(p.targets || p.targetPct), target: targets[0].pct, targetPrice: targets[0].price, room: r2(room), deployAmount: r2(deployAmt), distanceToAdd: p.addBelow && price !== null ? r2((price / p.addBelow - 1) * 100) : null, status, note };
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
    totals: { cash: fin(cash) ? r2(cash) : null, cashShort: fin(cash) && deployNow > cash ? Math.round(deployNow - cash) : 0, riding: rows.filter(r => r.status === "riding").length, invested: sum(rows, "invested"), value: priced.length === rows.length ? sum(rows, "value") : null, pnl: sum(priced, "pnl"), pnlPct: sum(priced, "invested") ? r2(sum(priced, "pnl") / sum(priced, "invested") * 100) : null, takeProfit: rows.filter(r => r.status === "take-profit").length, deploy: rows.filter(r => r.status === "deploy").length + wrows.filter(w => w.status === "deploy").length, deployNow: Math.round(deployNow), unpriced: rows.length + wrows.length - priced.length - wrows.filter(w => w.price !== null).length }
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
    if (r.status === "deploy" && !recent(`${key}:dp`)) fresh.push({ type: "swing-deploy", swingKey: `${key}:dp`, symbol: r.symbol, company: r.name, price: r.price, at: new Date(now).toISOString(), read: false, title: `💰 ${r.name} at ₹${r.price}: time to deploy`, detail: r.note });
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
