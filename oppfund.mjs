// Opportunity fund: money kept aside (in an arbitrage / liquid fund) to buy when the market falls, by rule instead of by
// mood. Nifty's distance from its 1-year high decides when: e.g. a third at −10%, a third at −15%, the rest at −20%.
// Each step says how much to put in and where (your core fund, and the best long-term buys from "What to do now").
// A cycle ends when Nifty is back within 3% of its high: the steps reset for the next fall. Pure functions.
const fin = v => Number.isFinite(v);
const r0 = v => Math.round(v || 0), r1 = v => Math.round(v * 10) / 10;
const txt = (v, n) => String(v ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, n);
const money = v => { if (v === null || v === undefined || String(v).trim() === "") return null; const x = Number(String(v).replace(/[,₹\s]/g, "")); return fin(x) ? x : NaN; };
export const OPP_DEFAULTS = Object.freeze({ pot: null, tiers: [{ off: 10, share: 33 }, { off: 15, share: 33 }, { off: 20, share: 34 }], core: 50, coreName: "Parag Parikh Flexi Cap", picks: 5, alerts: true, resetWithin: 3 });

export function sanitizeOppPlan(b = {}, prev = {}) {
  const p = { ...OPP_DEFAULTS, ...prev };
  if ("pot" in b) { const v = money(b.pot); if (Number.isNaN(v) || (v !== null && (v < 0 || v > 1e10))) throw new Error("Enter the amount kept for dips."); p.pot = v === null ? null : Math.round(v); }
  if (Array.isArray(b.tiers)) {
    const t = b.tiers.map(x => ({ off: Number(x.off), share: Number(x.share) })).filter(x => fin(x.off) && fin(x.share) && x.share > 0);
    if (!t.length || t.length > 6) throw new Error("Use 1 to 6 steps.");
    if (t.some(x => x.off < 2 || x.off > 60)) throw new Error("Each step's fall should be between 2% and 60%.");
    const sum = t.reduce((a, x) => a + x.share, 0); if (Math.abs(sum - 100) > 1) throw new Error(`The steps' shares add up to ${r1(sum)}%: make them 100%.`);
    p.tiers = t.sort((a, z) => a.off - z.off).map(x => ({ off: r1(x.off), share: r1(x.share) }));
  }
  if ("core" in b) { const c = Number(b.core); if (!(c >= 0 && c <= 100)) throw new Error("Core fund share should be 0–100%."); p.core = Math.round(c); }
  if ("coreName" in b) p.coreName = txt(b.coreName, 60) || OPP_DEFAULTS.coreName;
  if ("picks" in b) p.picks = Math.max(0, Math.min(10, Math.round(Number(b.picks) || 0)));
  if ("alerts" in b) p.alerts = !!b.alerts;
  return p;
}
export function sanitizeDeployment(b = {}, today) {
  const amount = money(b.amount); if (!(amount > 0) || amount > 1e10) throw new Error("Enter the amount you invested.");
  const date = String(b.date || today).slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) throw new Error("Pick the date you invested.");
  return { id: `od${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, date, amount: Math.round(amount), where: txt(b.where, 80) || "—", note: txt(b.note, 120) || null };
}

// bars: Nifty (NIFTYBEES) daily closes oldest first; live: today's price if known
export function niftyState(bars = [], live = null) {
  const c = bars.map(b => b?.c).filter(v => fin(v) && v > 0); if (fin(live) && live > 0) c.push(live);
  if (c.length < 60) return null;
  const price = c[c.length - 1], high = Math.max(...c.slice(-253)), off = r1(Math.max(0, (1 - price / high) * 100));
  return { price, high, off, live: fin(live) && live > 0 };
}

// state: { cycleStart, fired: { [off]: day } , deployments }; picks: [{ symbol, name, price, zoneHigh, action }]
export function oppView({ plan = OPP_DEFAULTS, state = {}, nifty = null, picks = [], today } = {}) {
  const P = { ...OPP_DEFAULTS, ...plan }, deps = state.deployments || [], cycleStart = state.cycleStart || null;
  const inCycle = deps.filter(d => !cycleStart || d.date >= cycleStart), deployed = inCycle.reduce((a, d) => a + d.amount, 0);
  const pot = fin(P.pot) ? P.pot : null, left = pot !== null ? Math.max(0, pot - deployed) : null;
  let acc = 0;
  const tiers = P.tiers.map(t => {
    const amount = pot !== null ? r0(pot * t.share / 100) : null, reached = !!nifty && nifty.off >= t.off;
    acc += amount || 0;
    return { ...t, amount, cumulative: pot !== null ? r0(acc) : null, reached, level: nifty ? r0(nifty.high * (1 - t.off / 100)) : null, away: nifty && !reached ? r1(t.off - nifty.off) : 0, firedOn: state.fired?.[t.off] || null };
  });
  const dueTotal = tiers.filter(t => t.reached).reduce((a, t) => a + (t.amount || 0), 0), due = pot !== null ? Math.max(0, Math.min(left, dueTotal - deployed)) : 0;
  const next = tiers.find(t => !t.reached) || null;
  // where today's amount goes: the core fund, and the best long-term buys split equally
  const top = picks.slice(0, P.picks);
  const split = amt => { const coreAmt = top.length ? r0(amt * P.core / 100) : amt, each = top.length ? r0((amt - coreAmt) / top.length) : 0;
    return [{ where: P.coreName, amount: coreAmt, why: "Core fund: the simplest way to buy the whole market lower" }, ...top.map(p => ({ where: p.name, symbol: p.symbol, amount: each, price: p.price, zoneHigh: p.zoneHigh, why: p.action }))]; };
  const plan2 = due > 0 ? split(due).filter(x => x.amount > 0) : [];
  // shopping list kept ready for the next step, so you know what you'll buy before the fall comes
  const nxt = tiers.find(t => !t.reached) || null;
  const ready = !plan2.length && nxt ? { off: nxt.off, level: nxt.level, amount: nxt.amount, away: nxt.away, list: (nxt.amount !== null ? split(nxt.amount) : split(0)).map(x => ({ ...x, amount: nxt.amount !== null ? x.amount : null, sharePct: x.symbol ? (top.length ? r1((100 - P.core) / top.length) : 0) : (top.length ? P.core : 100) })) } : null;
  const tips = [];
  if (pot === null) tips.push({ tone: "info", text: "Set how much you keep aside for market falls. A common size is 10–15% of your equity, or 6–12 months of your SIPs, kept in an arbitrage or liquid fund." });
  if (!nifty) tips.push({ tone: "warn", text: "Nifty history isn't there yet: it comes with the daily swing scan (Swing → Scan)." });
  if (nifty && nifty.off < (P.tiers[0]?.off || 10) && pot !== null) tips.push({ tone: "ok", text: `Nothing to do: Nifty is ${nifty.off}% below its 1-year high, the first step is at −${P.tiers[0].off}% (Nifty about ${tiers[0].level?.toLocaleString("en-IN")} on NIFTYBEES). Keep your SIPs going; this money waits in arbitrage.` });
  if (due > 0) tips.push({ tone: "warn", text: `Nifty is ${nifty.off}% below its high: put ₹${due.toLocaleString("en-IN")} to work now. Spread it over 2–3 days if you like; don't wait for a lower price than the next step.` });
  if (pot !== null && left === 0) tips.push({ tone: "info", text: "The fund is fully invested for this fall. Refill it from swing profits or part of each month's surplus, so it's ready for the next one." });
  return { plan: P, nifty, tiers, next, pot, deployed, left, due, deploy: plan2, ready, picksCount: top.length, deployments: [...deps].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 50), cycleStart, tips, today };
}

// what changed since the last check: new steps reached (alerts) and a finished cycle (reset)
export function oppTick(state = {}, view, { today, resetWithin = OPP_DEFAULTS.resetWithin } = {}) {
  const fired = { ...(state.fired || {}) }, fresh = []; let cycleStart = state.cycleStart || today;
  if (view.nifty && view.nifty.off <= resetWithin && Object.keys(fired).length) return { state: { ...state, fired: {}, cycleStart: today }, fresh, reset: true };
  for (const t of view.tiers) if (t.reached && !fired[t.off]) {
    fired[t.off] = today;
    fresh.push({ key: `opp-${t.off}-${today}`, type: "opportunity", at: new Date().toISOString(), read: false,
      title: `📉 Nifty ${view.nifty.off}% below its high: opportunity step −${t.off}% reached`,
      detail: view.pot !== null ? `Put about ₹${(t.amount || 0).toLocaleString("en-IN")} to work from your opportunity fund (${view.deploy.map(d => d.where).slice(0, 3).join(", ")}…). Open Opportunity fund for the split.` : "Set the size of your opportunity fund to see how much to invest." });
  }
  return { state: { ...state, fired, cycleStart }, fresh, reset: false };
}
