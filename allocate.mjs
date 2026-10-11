// "Where do I put ₹X?": splits an amount across stocks that are in their buy zone, weighted by quality and upside, and capped
// per stock and per sector against the portfolio you would have afterwards. A planning aid, not advice. Pure.
const fin = v => Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function allocate({ amount, rows, held = {}, maxPerStockPct = 15, maxPerSectorPct = 30, minTicket = 1000, maxPerStockAmount = null, tag = null }) {
  amount = Number(amount);
  if (!(amount > 0)) throw new Error("Enter an amount above zero.");
  const heldValue = sym => held[sym] || 0;
  const currentTotal = Object.values(held).reduce((s, v) => s + v, 0);
  const total = currentTotal + amount;
  const sectorHeld = {};
  for (const r of rows) { const k = r.sector || "Unknown"; sectorHeld[k] = (sectorHeld[k] || 0) + heldValue(String(r.symbol).toUpperCase()); }
  const cands = rows.filter(r => r.verdict?.key === "buy" && fin(r.price) && r.price > 0 && (!tag || r.verdict.tags.includes(tag))).map(r => {
    const sym = String(r.symbol).toUpperCase(), g = r.verdict.growthScore;
    const upside = clamp(r.upsideToBase ?? 0, 0, 0.5) / 0.5;
    const score = 0.1 + 0.4 * ((g ?? 50) / 100) + 0.4 * upside + (r.ratio < 0.9 ? 0.2 : r.ratio < 1.05 ? 0.1 : 0) + (r.verdict.tags.includes("Dividend") ? 0.05 : 0);
    return { r, sym, score, put: 0, sector: r.sector || "Unknown" };
  });
  if (!cands.length) return { allocations: [], leftover: amount, candidates: 0, notes: ["No stock is in its buy zone right now (with a trustworthy zone). Holding the cash is a valid answer."] };
  const roomStock = c => Math.min(maxPerStockPct / 100 * total - heldValue(c.sym), maxPerStockAmount ?? Infinity) - c.put;
  const roomSector = c => maxPerSectorPct / 100 * total - sectorHeld[c.sector] - cands.filter(x => x.sector === c.sector).reduce((s, x) => s + x.put, 0);
  let left = amount;
  for (let round = 0; round < 8 && left > 1; round++) {
    const open = cands.filter(c => Math.min(roomStock(c), roomSector(c)) > 1);
    if (!open.length) break;
    const sum = open.reduce((s, c) => s + c.score, 0);
    let spent = 0;
    for (const c of open) { const give = Math.min(left * c.score / sum, roomStock(c), roomSector(c)); if (give > 0) { c.put += give; spent += give; } }
    left -= spent; if (spent < 1) break;
  }
  const notes = [];
  const allocations = cands.map(c => {
    const shares = Math.floor(c.put / c.r.price), amt = shares * c.r.price;
    return { symbol: c.sym, company: c.r.company, sector: c.sector, verdict: c.r.verdict.label, price: c.r.price, shares, amount: Math.round(amt), weightAfter: Math.round(((heldValue(c.sym) + amt) / total) * 1000) / 10, upsideToBase: c.r.upsideToBase ?? null, score: Math.round(c.score * 100) };
  }).filter(a => a.shares > 0 && a.amount >= minTicket).sort((a, b) => b.amount - a.amount);
  const used = allocations.reduce((s, a) => s + a.amount, 0);
  if (cands.length > allocations.length) notes.push(`${cands.length - allocations.length} buy-zone stock(s) got nothing: their share was under ₹${minTicket} or hit a cap.`);
  if (amount - used >= minTicket) notes.push(`₹${Math.round(amount - used).toLocaleString("en-IN")} is left over because of the per-stock (${maxPerStockPct}%) and per-sector (${maxPerSectorPct}%) caps, share rounding or too few candidates.`);
  return { allocations, leftover: Math.round(amount - used), candidates: cands.length, notes };
}
