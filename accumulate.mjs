// Accumulation tracker for a long-term basket (for example 20 small caps: start with ₹20k each, add on dips up to ₹1 lakh
// each). Shows how far each stock is towards its target, the next add level, and a "buy these with ₹X this month" list.
// Pure functions.
const r0 = v => Math.round(v), r2 = v => Math.round(v * 100) / 100;
export const DEFAULT_BASKET = { name: "Small-cap basket", initial: 20000, target: 100000, dips: [10, 20, 30, 40], monthly: 50000, account: "all", symbols: [] };
export function sanitizeBasket(b = {}, prev = null) {
  const num = (v, d) => { const x = Number(String(v ?? "").replace(/[,₹\s]/g, "")); return Number.isFinite(x) && x > 0 ? x : d; };
  const symbols = [...new Set((Array.isArray(b.symbols) ? b.symbols : String(b.symbols || "").split(/[\s,]+/)).map(s => String(s).toUpperCase().replace(/[^A-Z0-9&-]/g, "")).filter(Boolean))].slice(0, 60);
  const dips = (Array.isArray(b.dips) ? b.dips : String(b.dips ?? "").split(/[\s,/]+/)).map(Number).filter(x => x > 0 && x < 90).sort((a, z) => a - z).slice(0, 8);
  const initial = num(b.initial, prev?.initial ?? DEFAULT_BASKET.initial), target = Math.max(initial, num(b.target, prev?.target ?? DEFAULT_BASKET.target));
  return { id: prev?.id || `b${Date.now().toString(36)}`, name: String(b.name || prev?.name || DEFAULT_BASKET.name).slice(0, 60), initial, target, dips: dips.length ? dips : prev?.dips || DEFAULT_BASKET.dips, monthly: num(b.monthly, prev?.monthly ?? DEFAULT_BASKET.monthly), account: String(b.account || prev?.account || "all").slice(0, 40), listId: b.listId ?? prev?.listId ?? null, symbols, perStock: b.perStock && typeof b.perStock === "object" ? Object.fromEntries(Object.entries(b.perStock).slice(0, 60).map(([k, v]) => [k.toUpperCase(), { target: num(v?.target, null) }]).filter(([, v]) => v.target)) : prev?.perStock || {} };
}
// held: Map symbol -> { qty, avgPrice }, quotes: Map symbol -> { price, name, inZone, zoneHigh, verdict }
export function basketView(basket, held, quotes) {
  const rows = basket.symbols.map(sym => {
    const h = held.get(sym) || { qty: 0, avgPrice: null }, q = quotes.get(sym) || {};
    const target = basket.perStock?.[sym]?.target || basket.target, invested = h.qty > 0 && h.avgPrice > 0 ? h.qty * h.avgPrice : 0;
    const tranche = basket.dips.length ? (target - basket.initial) / basket.dips.length : target - basket.initial;
    const addsDone = invested <= basket.initial * 1.05 ? 0 : Math.min(basket.dips.length, Math.round((invested - basket.initial) / Math.max(1, tranche)));
    const nextDip = invested > 0 && addsDone < basket.dips.length ? basket.dips[addsDone] : null;
    const nextLevel = nextDip !== null && h.avgPrice > 0 ? r2(h.avgPrice * (1 - nextDip / 100)) : null;
    const price = q.price ?? null, value = price && h.qty ? h.qty * price : 0;
    let state, action = null, amount = 0;
    if (invested >= target * 0.98) { state = "full"; }
    else if (!invested) { state = "start"; amount = basket.initial; action = q.inZone ? "Start: in its buy zone now" : "Start with the first tranche"; }
    else if (nextLevel && price && price <= nextLevel) { state = "add"; amount = Math.min(tranche, target - invested); action = `At your add level (${nextDip}% under your average)`; }
    else { state = "wait"; amount = Math.min(tranche, target - invested); }
    return { symbol: sym, name: q.name || sym, qty: h.qty, avgPrice: h.avgPrice ? r2(h.avgPrice) : null, price, invested: r0(invested), value: r0(value), gainPct: invested && value ? r2((value / invested - 1) * 100) : null, target, progress: Math.min(100, r2(invested / target * 100)), addsDone, addsTotal: basket.dips.length, nextDip, nextLevel, distance: nextLevel && price ? r2((price / nextLevel - 1) * 100) : null, tranche: r0(tranche), state, action, amount: r0(amount), inZone: !!q.inZone, verdict: q.verdict || null };
  });
  const invested = rows.reduce((s, r) => s + r.invested, 0), target = rows.reduce((s, r) => s + r.target, 0), value = rows.reduce((s, r) => s + r.value, 0);
  return { basket, rows, totals: { invested: r0(invested), target: r0(target), value: r0(value), progress: target ? r2(invested / target * 100) : 0, full: rows.filter(r => r.state === "full").length, notStarted: rows.filter(r => r.state === "start").length, atAddLevel: rows.filter(r => r.state === "add").length }, plan: monthlyPlan(rows, basket.monthly) };
}
// This month's buys with the monthly budget: stocks at their add level first (deepest first), then new starts that are in
// their buy zone, then the rest of the new starts, then stocks in their buy zone furthest from target.
export function monthlyPlan(rows, budget) {
  const pick = [], used = new Set(); let left = budget;
  const take = (r, why) => { if (left < 1000 || used.has(r.symbol) || !(r.price > 0)) return; const amt = Math.min(left, r.amount || r.tranche); if (amt < Math.min(1000, r.price)) return; const qty = Math.floor(amt / r.price); if (qty < 1) return; pick.push({ symbol: r.symbol, name: r.name, amount: r0(qty * r.price), qty, price: r.price, why }); left -= qty * r.price; used.add(r.symbol); };
  rows.filter(r => r.state === "add").sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0)).forEach(r => take(r, `${r.nextDip}% dip level reached`));
  rows.filter(r => r.state === "start" && r.inZone).forEach(r => take(r, "first tranche, in its buy zone"));
  rows.filter(r => r.state === "start" && !r.inZone).forEach(r => take(r, "first tranche"));
  rows.filter(r => r.state === "wait" && r.inZone).sort((a, b) => a.progress - b.progress).forEach(r => take(r, "in its buy zone, furthest from target"));
  return { budget, buys: pick, spend: r0(budget - left), leftover: r0(left) };
}
