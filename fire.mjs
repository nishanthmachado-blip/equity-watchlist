// FIRE planner: when does your money reach 1 Cr … 10 Cr … 100 Cr, and when can you stop working?
// Month-by-month simulation of four pots, using the order you asked for:
//   safety   3 years of expenses in arbitrage / liquid funds; topped up first, anything above the reserve moves to
//            equity once a year (the reserve grows with inflation, so it keeps getting topped up).
//   pf       EPF / PPF / NPS: fed by your PF-type monthly contributions until the pot reaches the cap (₹50 L); after
//            that those contributions go to equity (VPF / PPF stops; mandatory EPF can be modelled with pfAfterCap).
//   other    hybrid / debt / bonds / gold you already hold: no new money, grows at its own rate.
//   equity   everything else: stocks, equity funds, US stocks, crypto. All remaining new money goes here.
// Pure functions: amounts in rupees, rates in % a year. Pre-tax: returns are before capital-gains tax.
const fin = v => Number.isFinite(v);
const r0 = v => Math.round(v || 0);
export const MILESTONES = [1e7, 5e7, 1e8, 2.5e8, 5e8, 1e9]; // 1, 5, 10, 25, 50, 100 Cr
export const FIRE_DEFAULTS = Object.freeze({ age: 40, retireAge: null, stepUp: 10, inflation: 6, swr: 3.5, safetyMonths: 36, reserveShare: 100, pfCap: 5e6, pfAfterCap: "equity",
  ret: { safety: 6.5, pf: 8, other: 8, equity: 12 }, goals: [1e8, 1e9], horizon: 45 });

const num = (v, lo, hi, d) => { if (v === undefined || v === null || String(v).trim() === "") return d; const x = Number(String(v).replace(/[,₹\s]/g, "")); return fin(x) && x >= lo && x <= hi ? x : d; };
// what the user typed in the planner (anything left empty comes from their expenses / net worth)
export function sanitizeFirePlan(b = {}, prev = {}) {
  const pick = (k, lo, hi) => (k in b ? num(b[k], lo, hi, null) : prev[k] ?? null);
  const out = { age: pick("age", 18, 90), retireAge: pick("retireAge", 25, 90), spend: pick("spend", 0, 1e8), invest: pick("invest", 0, 1e8), pfMonthly: pick("pfMonthly", 0, 1e7),
    stepUp: pick("stepUp", 0, 50), inflation: pick("inflation", 0, 20), swr: pick("swr", 1, 10), safetyMonths: pick("safetyMonths", 0, 120), reserveShare: pick("reserveShare", 0, 100), pfCap: pick("pfCap", 0, 1e10),
    pfAfterCap: ["equity", "pf"].includes(b.pfAfterCap) ? b.pfAfterCap : prev.pfAfterCap || null, ret: { ...(prev.ret || {}) } };
  for (const k of ["safety", "pf", "other", "equity"]) if (b.ret && k in b.ret) { const v = num(b.ret[k], 0, 40, null); if (v === null) delete out.ret[k]; else out.ret[k] = v; }
  if (Array.isArray(b.goals)) out.goals = [...new Set(b.goals.map(g => num(g, 1e5, 1e11, null)).filter(Boolean))].sort((a, z) => a - z).slice(0, 4);
  else if (prev.goals) out.goals = prev.goals;
  if (out.retireAge !== null && out.age !== null && out.retireAge <= out.age) out.retireAge = null;
  return { ...out, updatedAt: new Date().toISOString() };
}

// The month-by-month run. p: { age, spend, invest, pfMonthly, stepUp, inflation, swr, safetyMonths, pfCap, pfAfterCap, ret, start:{safety,pf,other,equity}, horizon }
export function simulate(p) {
  const mr = r => Math.pow(1 + (r || 0) / 100, 1 / 12) - 1, g = { safety: mr(p.ret.safety), pf: mr(p.ret.pf), other: mr(p.ret.other), equity: mr(p.ret.equity) };
  const pot = { safety: p.start.safety || 0, pf: p.start.pf || 0, other: p.start.other || 0, equity: p.start.equity || 0 };
  const months = Math.round((p.horizon || 45) * 12), years = [], hit = {}, fireAt = { month: null }, share = (p.reserveShare ?? 100) / 100; let reserveFull = null;
  const reserve = m => p.safetyMonths * p.spend * Math.pow(1 + p.inflation / 100, m / 12);
  const rebalance = m => { const over = pot.safety - reserve(m); if (over > 0) { pot.safety -= over; pot.equity += over; } };
  rebalance(0);
  let invested = 0;
  for (let m = 0; m <= months; m++) {
    const total = pot.safety + pot.pf + pot.other + pot.equity, spendNow = p.spend * Math.pow(1 + p.inflation / 100, m / 12), fireNum = spendNow * 12 / (p.swr / 100);
    for (const x of MILESTONES.concat(p.goals || [])) if (hit[x] === undefined && total >= x) hit[x] = m;
    if (reserveFull === null && pot.safety >= reserve(m) * 0.995) reserveFull = m;
    if (fireAt.month === null && p.spend > 0 && total >= fireNum) Object.assign(fireAt, { month: m, number: fireNum });
    if (m % 12 === 0) years.push({ year: m / 12, age: p.age !== null && p.age !== undefined ? p.age + m / 12 : null, total: r0(total), real: r0(total / Math.pow(1 + p.inflation / 100, m / 12)), safety: r0(pot.safety), pf: r0(pot.pf), other: r0(pot.other), equity: r0(pot.equity), monthlyInvest: r0((p.invest + p.pfMonthly) * Math.pow(1 + p.stepUp / 100, m / 12 | 0)), fireNumber: r0(fireNum), invested: r0(invested) });
    if (m === months) break;
    for (const k in pot) pot[k] *= 1 + g[k];
    const step = Math.pow(1 + p.stepUp / 100, Math.floor(m / 12));
    let inv = p.invest * step; const pfc = p.pfMonthly * step; invested += inv + pfc;
    if (pot.pf < p.pfCap || p.pfAfterCap === "pf") pot.pf += pfc; else inv += pfc;
    const need = reserve(m) - pot.safety; if (need > 0) { const t = Math.min(inv * share, need); pot.safety += t; inv -= t; }
    pot.equity += inv;
    if ((m + 1) % 12 === 0) rebalance(m + 1);
  }
  return { years, hit, reserveFull, fire: fireAt.month === null ? null : { month: fireAt.month, number: r0(fireAt.number) } };
}

// Monthly investment (same step-up) needed to reach `goal` within `months`; null when not reachable below ₹1 Cr a month.
export function neededInvest(p, goal, months) {
  const reach = inv => { const s = simulate({ ...p, invest: inv, horizon: Math.ceil(months / 12) + 1 }); return s.hit[goal] !== undefined && s.hit[goal] <= months; };
  if (reach(0)) return 0; if (!reach(1e7)) return null;
  let lo = 0, hi = 1e7; for (let i = 0; i < 40 && hi - lo > 500; i++) { const mid = (lo + hi) / 2; if (reach(mid)) hi = mid; else lo = mid; }
  return Math.ceil(hi / 1000) * 1000;
}

const crore = v => (v >= 1e7 ? `₹${+(v / 1e7).toFixed(v % 1e7 ? 2 : 0)} Cr` : v >= 1e5 ? `₹${+(v / 1e5).toFixed(2)} L` : `₹${r0(v).toLocaleString("en-IN")}`);
const dur = m => (m < 12 ? `${m} months` : `${Math.floor(m / 12)} yr${m % 12 ? ` ${m % 12} mo` : ""}`);
const yrs = m => (m === null || m === undefined ? null : Math.round(m / 12 * 10) / 10);

// Everything the planner page shows. data: { plan (sanitizeFirePlan), tracked: { spend, invest, pfMonthly, income, months, wants:[{key, amount}] }, start: {safety,pf,other,equity}, liabilities }
export function firePlan({ plan = {}, tracked = {}, start = {}, liabilities = 0 } = {}) {
  const D = FIRE_DEFAULTS, pick = (k, d) => plan[k] ?? d;
  const src = {};
  const auto = (k, t, d) => { if (plan[k] !== null && plan[k] !== undefined) { src[k] = "you"; return plan[k]; } if (fin(t) && t > 0) { src[k] = "tracked"; return t; } src[k] = "default"; return d; };
  const p = { age: pick("age", null), retireAge: pick("retireAge", null), spend: auto("spend", tracked.spend, 100000), invest: auto("invest", tracked.invest, 0), pfMonthly: auto("pfMonthly", tracked.pfMonthly, 0),
    stepUp: pick("stepUp", D.stepUp), inflation: pick("inflation", D.inflation), swr: pick("swr", D.swr), safetyMonths: pick("safetyMonths", D.safetyMonths), reserveShare: pick("reserveShare", D.reserveShare), pfCap: pick("pfCap", D.pfCap), pfAfterCap: pick("pfAfterCap", D.pfAfterCap),
    ret: { ...D.ret, ...(plan.ret || {}) }, goals: plan.goals?.length ? plan.goals : D.goals, horizon: D.horizon,
    start: { safety: r0(start.safety), pf: r0(start.pf), other: r0(start.other), equity: r0(start.equity) } };
  const base = simulate(p), corpus = p.start.safety + p.start.pf + p.start.other + p.start.equity;
  const when = (s, x) => (s.hit[x] === undefined ? null : s.hit[x]);
  const ageAt = m => (m === null || p.age === null ? null : Math.round((p.age + m / 12) * 10) / 10);
  const year0 = new Date().getFullYear(), yearAt = m => (m === null ? null : Math.round(year0 + m / 12));
  const milestones = [...new Set([...MILESTONES, ...p.goals])].sort((a, z) => a - z).map(x => { const m = when(base, x); return { amount: x, label: crore(x), month: m, years: yrs(m), age: ageAt(m), year: yearAt(m), reached: corpus >= x, goal: p.goals.includes(x), real: m === null ? null : r0(x / Math.pow(1 + p.inflation / 100, m / 12)) }; });
  // FIRE numbers in today's money and when you get there
  const annual = p.spend * 12, fireToday = annual / (p.swr / 100);
  const fire = { number: r0(fireToday), fat: r0(fireToday * 2), lean: r0(fireToday * 0.7), month: base.fire?.month ?? null, years: yrs(base.fire?.month), age: ageAt(base.fire?.month ?? null), year: yearAt(base.fire?.month ?? null), numberThen: base.fire?.number ?? null, progress: fireToday > 0 ? Math.round(corpus / fireToday * 1000) / 10 : null };
  for (const [k, mult] of [["fatWhen", 2], ["leanWhen", 0.7]]) { const s = simulate({ ...p, spend: p.spend * mult }); fire[k] = { years: yrs(s.fire?.month), age: ageAt(s.fire?.month ?? null) }; }
  // Coast FIRE: enough today that growth alone (no more investing) reaches the FIRE number by the retirement age (60 if not set)
  const coastAge = p.retireAge || 60;
  if (p.age !== null && coastAge > p.age) {
    const n = coastAge - p.age, need = fireToday * Math.pow(1 + p.inflation / 100, n), blend = corpus > 0 ? (p.start.safety * p.ret.safety + p.start.pf * p.ret.pf + p.start.other * p.ret.other + p.start.equity * p.ret.equity) / corpus : p.ret.equity;
    fire.coast = { age: coastAge, needToday: r0(need / Math.pow(1 + p.ret.equity / 100, n)), reached: corpus * Math.pow(1 + Math.max(blend, 0) / 100, n) >= need };
  }
  // retirement age goal: what you'd need to invest to be FIRE by then
  if (p.retireAge && p.age !== null) {
    const months = Math.round((p.retireAge - p.age) * 12), s = simulate({ ...p, horizon: Math.ceil(months / 12) + 1 }), at = s.years.find(y => y.year === Math.round(months / 12));
    const fireThen = fireToday * Math.pow(1 + p.inflation / 100, months / 12);
    let need = null; { const reach = inv => { const z = simulate({ ...p, invest: inv, horizon: Math.ceil(months / 12) + 1 }); return z.fire && z.fire.month <= months; }; if (reach(p.invest)) need = p.invest; else if (reach(1e7)) { let lo = p.invest, hi = 1e7; for (let i = 0; i < 40 && hi - lo > 500; i++) { const mid = (lo + hi) / 2; if (reach(mid)) hi = mid; else lo = mid; } need = Math.ceil(hi / 1000) * 1000; } }
    fire.byAge = { age: p.retireAge, corpusThen: at?.total ?? null, fireThen: r0(fireThen), onTrack: !!(base.fire && base.fire.month <= months), investNeeded: need };
  }
  // goal targets (10 Cr, 100 Cr …): monthly investment needed to get there 3 and 5 years sooner
  const goals = p.goals.map(x => { const m = when(base, x), out = { amount: x, label: crore(x), years: yrs(m), age: ageAt(m), year: yearAt(m) }; if (m !== null && m > 0) out.faster = [36, 60].filter(c => m - c > 12).map(c => ({ sooner: c / 12, invest: neededInvest(p, x, m - c) })); return out; });
  // levers: what moves the goals closest; each one compared with the plan as it is
  const levers = [], gTop = p.goals[p.goals.length - 1], gFirst = p.goals[0];
  const lever = (id, title, how, change) => {
    const s = simulate({ ...p, ...change, ret: { ...p.ret, ...(change.ret || {}) } }), d = x => { const a = when(base, x), b = when(s, x); return a === null && b === null ? null : a === null ? { now: true, months: null } : b === null ? { months: -999 } : { months: a - b }; };
    const f = base.fire && s.fire ? base.fire.month - s.fire.month : null;
    levers.push({ id, title, how, first: d(gFirst), top: d(gTop), fire: f, score: (d(gTop)?.months || 0) + (d(gFirst)?.months || 0) + (f || 0) });
  };
  const extra = Math.max(10000, Math.round((tracked.income || p.invest * 3 || 100000) * 0.1 / 5000) * 5000);
  lever("more", `Invest ${crore(extra)} more a month`, "From a raise, a bonus spread over 12 months, or a cut in spends.", { invest: p.invest + extra });
  lever("stepup", `Raise your SIPs by ${p.stepUp + 5}% a year (now ${p.stepUp}%)`, "Increase them with every hike. Spending stays at today's level plus inflation.", { stepUp: p.stepUp + 5 });
  const cut = Math.round(p.spend * 0.1 / 1000) * 1000;
  if (cut > 0) lever("spend", `Spend ${crore(cut)} less a month (10%) and invest it`, "Lower spends also bring down your FIRE number and the 3-year reserve.", { spend: p.spend - cut, invest: p.invest + cut });
  lever("cost", "Earn 1% more a year on equity", "Use direct plans and index funds instead of regular plans (often a 1%+ saving), and avoid churn and short-term tax.", { ret: { equity: p.ret.equity + 1 } });
  if (base.reserveFull !== 0 && p.reserveShare > 50) lever("share", "Fill the reserve with half your new money", `The other half keeps going to equity while the ${p.safetyMonths}-month reserve fills, so compounding starts sooner; the reserve takes about twice as long to fill.`, { reserveShare: 50 });
  if (p.safetyMonths > 24) lever("reserve", `Keep ${24} months in arbitrage instead of ${p.safetyMonths}`, "Less parked at ~6.5%, more compounding in equity. The trade-off is a smaller cushion in a long job gap.", { safetyMonths: 24 });
  if (p.pfAfterCap === "pf" || p.pfMonthly > 0) lever("pfcap", `Stop PF/PPF top-ups at ${crore(Math.max(p.pfCap / 2, 1e6))}`, "Mandatory EPF continues; this only moves voluntary PF / PPF money to equity sooner.", { pfCap: Math.max(p.pfCap / 2, 1e6) });
  for (const w of (tracked.wants || []).slice(0, 2)) { const half = Math.round(w.amount / 2 / 500) * 500; if (half >= 1000) lever(`want-${w.key}`, `Halve ${w.key.toLowerCase()} (${crore(half)} a month) and invest it`, `You spend about ${crore(w.amount)} a month here on average.`, { spend: p.spend - half, invest: p.invest + half }); }
  levers.sort((a, z) => z.score - a.score);
  // sensitivity: equity return
  const sens = [p.ret.equity - 2, p.ret.equity, p.ret.equity + 2].map(r => { const s = simulate({ ...p, ret: { ...p.ret, equity: r } }); return { equity: r, first: yrs(when(s, gFirst)), top: yrs(when(s, gTop)), fire: yrs(s.fire?.month ?? null) }; });
  // tips in plain words
  const tips = [], reserveNow = p.safetyMonths * p.spend, savingsRate = tracked.income > 0 ? Math.round((p.invest + p.pfMonthly) / tracked.income * 1000) / 10 : null;
  if (p.start.safety > reserveNow * 1.05) tips.push({ tone: "info", text: `Your safety money is ${crore(p.start.safety)}, ${crore(p.start.safety - reserveNow)} above a ${p.safetyMonths}-month reserve (${crore(reserveNow)}). The plan moves the extra to equity. Do it in 3–6 monthly parts if markets are high.` });
  else if (p.start.safety < reserveNow) tips.push({ tone: "warn", text: `The ${p.safetyMonths}-month reserve needs ${crore(reserveNow)} (it grows with inflation); you have ${crore(p.start.safety)}. ${p.reserveShare}% of your new equity money fills it first, which takes ${base.reserveFull === null ? "longer than the plan" : `about ${dur(base.reserveFull)}`}; until then equity gets ${p.reserveShare >= 100 ? "nothing new" : `${100 - p.reserveShare}%`}. A smaller reserve, or filling it with part of your new money, gets compounding going sooner.` });
  if (p.start.pf >= p.pfCap && p.pfCap > 0) tips.push({ tone: "ok", text: `PF/PPF/NPS has reached your ${crore(p.pfCap)} cap: new voluntary PF money goes to equity in this plan.` });
  if (savingsRate !== null) tips.push({ tone: savingsRate >= 40 ? "ok" : savingsRate >= 25 ? "info" : "warn", text: `You invest ${savingsRate}% of your income. ${savingsRate >= 50 ? "That is a fast-FIRE savings rate." : savingsRate >= 40 ? "Good: 40–50% is where FIRE in about 15 years becomes realistic." : "Raising it towards 40% is the biggest lever you control."}` });
  if (liabilities > 0) tips.push({ tone: "info", text: `Loans of ${crore(liabilities)} are not subtracted from these targets; the planner tracks the money that compounds. Prepaying a loan above ~9% interest usually beats arbitrage funds.` });
  if (gTop >= 1e9) { const m10 = when(base, gFirst), m100 = when(base, gTop); if (m10 !== null && m100 !== null) tips.push({ tone: "info", text: `From ${crore(gFirst)} to ${crore(gTop)} takes about ${yrs(m100 - m10)} years in this plan. At that size compounding does most of the work: ${crore(gFirst)} at ${p.ret.equity}% doubles roughly every ${Math.round(72 / p.ret.equity * 10) / 10} years. Your monthly SIP matters most before the first ${crore(gFirst)}.` }); }
  tips.push({ tone: "warn", text: `All-equity means falls of 30–50% will happen (2008, 2020). On ${crore(gFirst)} that is a ${crore(gFirst * 0.4)} paper loss. The ${p.safetyMonths}-month reserve exists so you never have to sell equity in a crash.` });
  return { inputs: { ...p, src }, corpus: r0(corpus), start: p.start, savingsRate, tracked, milestones, fire, goals, levers, sens, tips, years: base.years.filter((y, i) => i <= 40), liabilities: r0(liabilities) };
}
