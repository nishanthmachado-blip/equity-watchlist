// Buying-plan maths: dip ladders, next-tranche triggers, valuation gate, sector exposure, stress cash.
// Pure functions. Positions are stored in data/positions.json (written by the server).
export const LADDERS = { standard: [0.15, 0.25, 0.35, 0.45], smaller: [0.25, 0.40], none: [] };
export const DEFAULT_SETTINGS = { trancheSize: 20000, cashReserve: 0 };
const GATE_OK = new Set(["Undervalued", "Fair", "Fair to rich"]);
const r2 = v => (Number.isFinite(v) ? Number(v.toFixed(2)) : null);

export function sanitizeBuy(b) {
  const price = Number(b.price), amount = Number(b.amount);
  if (!Number.isFinite(price) || price <= 0) throw new Error("price must be a positive number");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("amount must be a positive number");
  const date = b.date ? String(b.date).slice(0, 10) : new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("date must be YYYY-MM-DD");
  return { date, price: r2(price), amount: Math.round(amount) };
}

// Valuation gate: add on dips only when the thesis still looks intact.
export function gate(v) {
  if (!v || v.view === "No fundamentals" || v.view === "Unassessable") return { ok: null, label: "Unchecked", why: "No usable fundamentals." };
  if (/CHECK:/.test(v.flags || "")) return { ok: false, label: "Hold", why: "Data check flag on this stock (see Valuation tab)." };
  if (!GATE_OK.has(v.view)) return { ok: false, label: "Hold", why: `Valuation is ${v.view}.` };
  return { ok: true, label: "OK", why: `Valuation ${v.view}.` };
}

export function positionRow(sym, pos, price, v, settings = DEFAULT_SETTINGS) {
  const ladder = LADDERS[pos.ladder] ? pos.ladder : "standard";
  const dips = LADDERS[ladder], tranche = pos.trancheSize || settings.trancheSize;
  const buys = pos.buys || [];
  const invested = buys.reduce((a, b) => a + b.amount, 0);
  const shares = buys.reduce((a, b) => a + b.amount / b.price, 0);
  const avgPrice = shares ? invested / shares : null;
  const first = buys.length ? buys[0].price : null;
  const levels = first ? dips.map((d, i) => ({ n: i + 1, dip: d, trigger: r2(first * (1 - d)), done: buys.length > i + 1 })) : [];
  const next = levels.find(l => !l.done) || null;
  const g = gate(v);
  const maxAmount = tranche * (1 + dips.length);
  let action, detail = "";
  if (!buys.length) {
    if (ladder === "none") { action = "No ladder"; }
    else if (v?.status === "In zone" || v?.status === "Below zone") { action = `START ${tranche}`; detail = "Price is inside the valuation buy zone."; }
    else { action = "Wait for zone"; detail = v?.zoneHigh ? `Zone tops out at ${v.zoneHigh}` : "No zone yet (fetch fundamentals)."; }
  } else if (!next) action = "Ladder complete";
  else if (price <= next.trigger) {
    if (g.ok === false) { action = "Trigger hit - HOLD"; detail = g.why; }
    else { action = `ADD ${tranche}`; detail = g.ok === null ? "Fundamentals unchecked: verify before adding." : `Tranche ${next.n} (-${Math.round(next.dip * 100)}% from first buy).`; }
  } else { action = "Wait"; detail = `${r2((price / next.trigger - 1) * 100)}% above next trigger ${next.trigger}`; }
  return { symbol: sym, ladder, trancheSize: tranche, price, invested, shares: r2(shares), avgPrice: r2(avgPrice), value: r2(shares * price), pnlPct: invested ? r2((shares * price / invested - 1) * 100) : null, firstBuy: first, levels, next, maxAmount, remaining: Math.max(0, maxAmount - invested), gate: g, action, detail, buys };
}

// Cash needed if every held stock fell by d% from today: all pending tranches whose trigger would be hit (gate ignored: worst case).
export function stress(rows, drops = [10, 20, 30, 40]) {
  return drops.map(d => {
    let cash = 0, hits = 0;
    for (const r of rows) {
      if (!r.firstBuy || !r.price) continue;
      const shocked = r.price * (1 - d / 100);
      for (const l of r.levels) if (!l.done && shocked <= l.trigger) { cash += r.trancheSize; hits++; }
    }
    return { drop: d, cash, tranches: hits };
  });
}

export function exposure(rows, sectorOf) {
  const m = new Map();
  for (const r of rows) {
    const s = sectorOf(r.symbol) || "Unclassified";
    const e = m.get(s) || { sector: s, stocks: 0, invested: 0, maxPlanned: 0 };
    e.stocks++; e.invested += r.invested; e.maxPlanned += r.maxAmount; m.set(s, e);
  }
  const totalMax = [...m.values()].reduce((a, e) => a + e.maxPlanned, 0), totalInv = [...m.values()].reduce((a, e) => a + e.invested, 0);
  return [...m.values()].map(e => ({ ...e, shareOfPlanned: totalMax ? r2(e.maxPlanned / totalMax * 100) : 0, shareOfInvested: totalInv ? r2(e.invested / totalInv * 100) : 0, concentrated: totalMax > 0 && e.maxPlanned / totalMax > 0.25 && e.stocks > 1 })).sort((a, b) => b.maxPlanned - a.maxPlanned);
}
