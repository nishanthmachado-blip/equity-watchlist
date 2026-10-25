// Invest plan: where the salary goes after spending. Income minus your real monthly spending (tracked average) is the
// money to invest; fixed lines (PPF, a yearly-expenses fund, crypto…) come off first, the rest is split by weight
// (core fund, momentum, kids' goal, direct stocks, US). Compared with what your budget invests today, and written into
// the budget on request so Bucket strategy and the FIRE planner use it. Editable; private to your login. Pure.
const fin = v => Number.isFinite(v);
const r500 = v => Math.round((v || 0) / 500) * 500;
const txt = (v, n) => String(v ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, n);
export const PLAN_KINDS = { fixed: "Fixed ₹", share: "Share of the rest" };
export const DEFAULT_INVEST_PLAN = Object.freeze({
  lines: [
    { name: "Yearly expenses (liquid fund)", kind: "fixed", amount: 15000, why: "School fees, insurance premiums, travel, festivals: paid from here, never by selling investments", group: "safety" },
    { name: "PPF", kind: "fixed", amount: 12500, why: "Tax-free 7.1% until maturity; house / backstop money. ₹1.5 L a year at most", group: "safe" },
    { name: "Parag Parikh Flexi Cap", kind: "share", weight: 30, why: "Core: diversified, some global stocks", group: "equity" },
    { name: "UTI Nifty200 Momentum 30", kind: "share", weight: 10, why: "The one momentum fund, as a satellite", group: "equity" },
    { name: "Kids education (Nifty 50 index)", kind: "share", weight: 10, why: "Low-cost large-cap anchor, tagged to the goal", group: "equity" },
    { name: "IND Stocks", kind: "share", weight: 15, why: "Direct stocks only in their buy zone; otherwise waits in arbitrage as opportunity money", group: "equity" },
    { name: "US Stocks (VOO / QQQ)", kind: "share", weight: 15, why: "ETFs over single stocks; growth over dividends for your tax slab", group: "equity" },
    { name: "Crypto", kind: "fixed", amount: 2000, why: "Kept small: 30% tax, 1% TDS, no loss set-off", group: "equity" }
  ],
  buffer: 0
});
export function sanitizeInvestPlan(b = {}) {
  const lines = (Array.isArray(b.lines) ? b.lines : []).slice(0, 20).map(l => {
    const name = txt(l.name, 50); if (!name) return null;
    const kind = l.kind === "share" ? "share" : "fixed", n = Number(String(kind === "share" ? l.weight : l.amount ?? "").replace(/[,₹%\s]/g, ""));
    if (!(n >= 0) || n > (kind === "share" ? 1000 : 1e8)) throw new Error(`${name}: ${kind === "share" ? "enter a share" : "enter an amount"}.`);
    return { name, kind, ...(kind === "share" ? { weight: n } : { amount: Math.round(n) }), why: txt(l.why, 160) || null, group: ["safety", "safe", "equity", "other"].includes(l.group) ? l.group : "equity" };
  }).filter(Boolean);
  if (!lines.length) throw new Error("Add at least one line.");
  const buffer = Math.max(0, Math.min(1e7, Math.round(Number(String(b.buffer ?? 0).replace(/[,₹\s]/g, "")) || 0)));
  return { lines, buffer, savedAt: new Date().toISOString() };
}
const norm = s => String(s || "").toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
// income, spend: ₹ a month; current: this month's investment lines [{ name, amount }]
export function buildSplit({ income = 0, spend = 0, current = [], plan = DEFAULT_INVEST_PLAN, spendMonths = 0 } = {}) {
  const available = Math.max(0, (income || 0) - (spend || 0) - (plan.buffer || 0));
  const fixed = plan.lines.filter(l => l.kind === "fixed"), share = plan.lines.filter(l => l.kind === "share");
  const fixedWant = fixed.reduce((a, l) => a + l.amount, 0), scale = fixedWant > available && fixedWant > 0 ? available / fixedWant : 1;
  const rest = Math.max(0, available - fixedWant * scale), wsum = share.reduce((a, l) => a + l.weight, 0);
  const used = new Set();
  const curOf = name => { const k = norm(name), first = k.split(" ")[0]; const hit = current.find((c, i) => !used.has(i) && (norm(c.name) === k || (first.length >= 2 && norm(c.name).split(" ")[0] === first))); if (!hit) return null; used.add(current.indexOf(hit)); return hit.amount || 0; };
  const lines = plan.lines.map(l => {
    const amount = r500(l.kind === "fixed" ? l.amount * scale : wsum > 0 ? rest * l.weight / wsum : 0);
    return { ...l, amount, pct: available > 0 ? Math.round(amount / available * 1000) / 10 : 0, current: curOf(l.name) };
  });
  const other = current.filter((c, i) => !used.has(i) && c.amount > 0).map(c => ({ name: c.name, current: c.amount }));
  const total = lines.reduce((a, l) => a + l.amount, 0), nowTotal = current.reduce((a, c) => a + (c.amount || 0), 0);
  const equity = lines.filter(l => l.group === "equity").reduce((a, l) => a + l.amount, 0);
  const notes = [];
  if (!income) notes.push({ tone: "warn", text: "No income in this month's budget: add your salary (and other income) in Budget → Edit." });
  if (scale < 1) notes.push({ tone: "warn", text: "Fixed lines are more than what's left after spending: they were scaled down. Lower a fixed amount or the spending." });
  if (available > 0 && nowTotal < available * 0.8) notes.push({ tone: "info", text: `Today your budget invests ₹${Math.round(nowTotal).toLocaleString("en-IN")} of the ₹${Math.round(available).toLocaleString("en-IN")} left after spending: ₹${Math.round(available - nowTotal).toLocaleString("en-IN")} a month has no job yet.` });
  if (spendMonths && spendMonths < 3) notes.push({ tone: "info", text: `Spending is the average of only ${spendMonths} month${spendMonths === 1 ? "" : "s"}: the split gets steadier as you log more months.` });
  return { income: Math.round(income), spend: Math.round(spend), buffer: plan.buffer || 0, available: Math.round(available), lines, other, total, unallocated: Math.round(available - total), nowTotal: Math.round(nowTotal), equity, equityPct: available > 0 ? Math.round(equity / available * 100) : 0, notes, spendMonths };
}
