// Swing trading: your swing positions and swing watchlist, priced live, with "take profit" (up ≥ target %) and "deploy"
// (price at or below your add / buy level) flags and alerts. Pure functions; the server supplies prices and storage.
export const SWING_DEFAULTS = Object.freeze({ targets: Object.freeze([10, 20, 40]), dipPct: 8, nearPct: 2.5 });
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

const id = () => `sw${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export function sanitizePosition(b = {}, prev = null) {
  const symbol = txt(b.symbol, 20).toUpperCase();
  if (!/^[A-Z0-9&-]{1,20}$/.test(symbol)) throw new Error("Pick the stock (NSE symbol).");
  const qty = Number(b.qty), avgPrice = parsePrice(b.avgPrice);
  if (!(qty > 0) || !Number.isInteger(qty)) throw new Error("Quantity must be a whole number of shares.");
  if (!(avgPrice > 0)) throw new Error("Enter your average buy price.");
  const limit = parseAmount(b.limit), addAmount = parseAmount(b.addAmount), addBelow = parsePrice(b.addBelow), targets = parseTargets(b.targets ?? b.targetPct);
  return { id: prev?.id || id(), symbol, exchange: b.exchange === "BSE" ? "BSE" : "NSE", name: txt(b.name, 80) || prev?.name || symbol, qty, avgPrice: r2(avgPrice), limit, addAmount, addBelow, targets, notes: txt(b.notes, 200) || null, openedAt: prev?.openedAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
}
export function sanitizeWatch(b = {}, prev = null) {
  const symbol = txt(b.symbol, 20).toUpperCase();
  if (!/^[A-Z0-9&-]{1,20}$/.test(symbol)) throw new Error("Pick the stock (NSE symbol).");
  const buyBelow = parsePrice(b.buyBelow), amount = parseAmount(b.amount);
  return { id: prev?.id || id(), symbol, exchange: b.exchange === "BSE" ? "BSE" : "NSE", name: txt(b.name, 80) || prev?.name || symbol, buyBelow, amount, notes: txt(b.notes, 200) || null, addedAt: prev?.addedAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
}
// Buy more: new average price. Sell: smaller position plus a closed-trade record.
export function applyBuy(p, qty, price) { const q = p.qty + qty; return { ...p, qty: q, avgPrice: r2((p.qty * p.avgPrice + qty * price) / q), updatedAt: new Date().toISOString() }; }
export function applySell(p, qty, price, at = new Date().toISOString()) {
  if (!(qty > 0) || qty > p.qty) throw new Error(`You can sell 1 to ${p.qty} shares.`);
  const trade = { id: id(), symbol: p.symbol, name: p.name, qty, buyAvg: p.avgPrice, sellPrice: r2(price), pnl: r2((price - p.avgPrice) * qty), pnlPct: r2((price / p.avgPrice - 1) * 100), openedAt: p.openedAt, closedAt: at };
  return { position: qty === p.qty ? null : { ...p, qty: p.qty - qty, updatedAt: at }, trade };
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
export function evaluateSwing({ positions = [], watch = [], prices = new Map(), settings = {} } = {}) {
  const S = { ...SWING_DEFAULTS, ...settings }; S.targets = settingsTargets(settings); delete S.targetPct;
  const rows = positions.map(p => {
    const q = prices.get(p.symbol) || {}, price = fin(q.price) ? q.price : null;
    const invested = p.qty * p.avgPrice, value = price !== null ? p.qty * price : null;
    const pnl = value !== null ? value - invested : null, pnlPct = price !== null ? (price / p.avgPrice - 1) * 100 : null;
    const tPcts = p.targets || (p.targetPct ? parseTargets(p.targetPct) : null) || S.targets, room = p.limit ? Math.max(0, p.limit - invested) : null;
    const targets = tPcts.map((pct, i) => { const tp = r2(p.avgPrice * (1 + pct / 100)); return { n: i + 1, pct, price: tp, hit: price !== null && price >= tp, profit: r2(p.qty * (tp - p.avgPrice)) }; });
    const hitLevel = targets.filter(t => t.hit).length, hit = targets[hitLevel - 1] || null, next = targets[hitLevel] || null;
    const deployAmt = p.addAmount != null ? (room === null ? p.addAmount : Math.min(p.addAmount, room)) : room;
    let status = "hold", note = null;
    const atAdd = p.addBelow && price !== null && price <= p.addBelow, dipped = !p.addBelow && pnlPct !== null && pnlPct <= -S.dipPct;
    const rs = v => `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
    if (hit) { status = "take-profit"; note = `T${hit.n} hit (+${hit.pct}% = ${rs(hit.price)}). Up ${r2(pnlPct)}%: about ₹${Math.round(pnl).toLocaleString("en-IN")} to book. ${next ? `Next T${next.n}: ${rs(next.price)} (+${next.pct}%).` : "All targets hit."}`; }
    else if (atAdd || dipped) { status = room === 0 ? "deploy-limit" : "deploy"; note = room === 0 ? `At your add level, but the ₹${(p.limit / 1e5).toFixed(1)}L limit is used up.` : `${atAdd ? `At or below your add level ₹${p.addBelow}` : `Down ${Math.abs(r2(pnlPct))}%`}: deploy${deployAmt ? ` up to ₹${Math.round(deployAmt).toLocaleString("en-IN")}` : ""}.`; }
    else if (next && pnlPct !== null && pnlPct >= next.pct - S.nearPct) { status = "near-profit"; note = `${r2(next.pct - pnlPct)}% away from T${next.n} ${rs(next.price)}.`; }
    else if (p.addBelow && price !== null && price <= p.addBelow * (1 + S.nearPct / 100)) { status = "near-deploy"; note = `${r2((price / p.addBelow - 1) * 100)}% above your add level ₹${p.addBelow}.`; }
    return { ...p, kind: "position", price, prevClose: q.prevClose ?? null, dayPct: fin(q.prevClose) && price !== null ? r2((price / q.prevClose - 1) * 100) : null, priceSource: q.source || null, priceAt: q.at || null,
      invested: r2(invested), value: r2(value), pnl: r2(pnl), pnlPct: r2(pnlPct), targets, hitLevel, nextTarget: next, ownTargets: !!(p.targets || p.targetPct), target: targets[0].pct, targetPrice: targets[0].price, room: r2(room), deployAmount: r2(deployAmt), distanceToAdd: p.addBelow && price !== null ? r2((price / p.addBelow - 1) * 100) : null, status, note };
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
    totals: { invested: sum(rows, "invested"), value: priced.length === rows.length ? sum(rows, "value") : null, pnl: sum(priced, "pnl"), pnlPct: sum(priced, "invested") ? r2(sum(priced, "pnl") / sum(priced, "invested") * 100) : null, takeProfit: rows.filter(r => r.status === "take-profit").length, deploy: rows.filter(r => r.status === "deploy").length + wrows.filter(w => w.status === "deploy").length, deployNow: Math.round(deployNow), unpriced: rows.length + wrows.length - priced.length - wrows.filter(w => w.price !== null).length }
  };
}

// Alerts when an item becomes "take-profit" or "deploy", and again each time a higher target (T2, T3) is reached
// (not on every check; the same alert repeats only after 24 h).
export function diffSwingAlerts(prev = {}, view, { now = Date.now(), events = [] } = {}) {
  const next = {}, fresh = [];
  const recent = (key) => events.some(e => e.swingKey === key && now - new Date(e.at).getTime() < 24 * 3600e3);
  for (const r of [...view.positions, ...view.watch]) {
    const key = `${r.kind}:${r.id}`, state = r.status === "take-profit" ? `take-profit:${r.hitLevel}` : r.status; next[key] = state;
    if (r.price === null || prev[key] === state) continue;
    const prevLevel = /^take-profit(?::(\d))?$/.test(prev[key] || "") ? Number(prev[key].split(":")[1] || 1) : 0;
    if (r.status === "take-profit" && r.hitLevel > prevLevel && !recent(`${key}:tp${r.hitLevel}`)) { const t = r.targets[r.hitLevel - 1]; fresh.push({ type: "swing-profit", swingKey: `${key}:tp${r.hitLevel}`, symbol: r.symbol, company: r.name, price: r.price, at: new Date(now).toISOString(), read: false, title: `🎯 ${r.name} hit T${t.n} (+${t.pct}%, ₹${t.price}): now ₹${r.price}, book profit?`, detail: r.note }); }
    if (r.status === "deploy" && !recent(`${key}:dp`)) fresh.push({ type: "swing-deploy", swingKey: `${key}:dp`, symbol: r.symbol, company: r.name, price: r.price, at: new Date(now).toISOString(), read: false, title: `💰 ${r.name} at ₹${r.price}: time to deploy`, detail: r.note });
  }
  return { next, fresh };
}
