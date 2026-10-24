// Net worth in four buckets — the "bucket strategy":
//   safety      money you can't afford to lose or wait for: bank, FDs, liquid / arbitrage / overnight funds.
//               Sized in months of expenses: at least `minMonths`, at most `maxMonths` (default 12–36 months of ₹1 L).
//   short       next 3–7 years, for named goals: balanced advantage / hybrid / flexi-cap funds, PPF, debt funds
//               (e.g. PPF for the house, a flexi-cap fund for the kids' education).
//   long        growth for 7+ years: stocks, small / mid / large-cap funds, US stocks, crypto, gold.
//   retirement  NPS, EPF / PF.
// Every net worth line gets a bucket from its category and (for funds) the fund's category or name; you can move any
// line to another bucket or leave it out (a home you live in, a car), and tag it with a goal. Pure functions.
const fin = v => Number.isFinite(v);
const r0 = v => Math.round(v || 0), r1 = v => Math.round(v * 10) / 10;
export const BUCKETS = [
  { id: "safety", label: "Safety", icon: "🛟", blurb: "Emergency money and the next few years of expenses: bank, FDs, liquid and arbitrage funds." },
  { id: "short", label: "Short term", icon: "🎯", blurb: "Goals 3–7 years away: balanced advantage / hybrid / flexi-cap funds, PPF, debt funds." },
  { id: "long", label: "Long-term growth", icon: "🚀", blurb: "7+ years: stocks, small / mid / large-cap funds, US stocks, crypto, gold." },
  { id: "retirement", label: "Retirement", icon: "🧓", blurb: "NPS and EPF: locked in until you retire." }
];
export const BUCKET_IDS = new Set([...BUCKETS.map(b => b.id), "none"]);
export const BUCKET_DEFAULTS = Object.freeze({ monthly: 100000, minMonths: 12, maxMonths: 36 });

// Which bucket a line goes to by default. line: { category, name, fundCategory? }
export function defaultBucket(line) {
  const c = line.category, n = `${line.fundCategory || ""} ${line.name || ""}`.toLowerCase();
  if (c === "cash" || c === "fd") return "safety";
  if (c === "epf" || c === "nps") return "retirement";
  if (c === "ppf" || c === "bonds") return "short";
  if (c === "stocks" || c === "intl" || c === "crypto" || c === "gold") return "long";
  if (c === "realestate" || c === "insurance" || c === "other") return "none";
  if (c === "mf") {
    if (/arbitrage|liquid|overnight|money market|ultra short|low duration|savings fund/.test(n)) return "safety";
    if (/retirement|pension/.test(n)) return "retirement";
    if (/balanced advantage|dynamic asset|hybrid|equity savings|multi asset|asset allocation|flexi|short duration|corporate bond|banking (and|&) psu|gilt|medium duration|dynamic bond|credit risk|debt/.test(n)) return "short";
    return "long"; // equity: small / mid / large / focused / value / ELSS / index / sectoral
  }
  return "none";
}
export function sanitizeBucketPlan(b = {}, prev = {}) {
  const num = (v, lo, hi, d) => { if (v === undefined || v === null || String(v).trim() === "") return d; const x = Number(String(v).replace(/[,₹\s]/g, "")); return fin(x) && x >= lo && x <= hi ? x : d; };
  const monthly = num(b.monthly, 1000, 1e8, prev.monthly ?? BUCKET_DEFAULTS.monthly);
  const minMonths = num(b.minMonths, 0, 120, prev.minMonths ?? BUCKET_DEFAULTS.minMonths);
  const maxMonths = Math.max(minMonths, num(b.maxMonths, 1, 240, prev.maxMonths ?? BUCKET_DEFAULTS.maxMonths));
  const assign = { ...(prev.assign || {}) }, goalOf = { ...(prev.goalOf || {}) };
  for (const [k, v] of Object.entries(b.assign || {})) { if (String(k).length > 200) continue; if (v === null || v === "auto") delete assign[k]; else if (BUCKET_IDS.has(v)) assign[k] = v; }
  const goals = (Array.isArray(b.goals) ? b.goals : prev.goals || [{ id: "g-house", name: "House", target: null, year: null }, { id: "g-kids", name: "Kids education", target: null, year: null }]).slice(0, 12).map((g, i) => ({
    id: /^[\w-]{1,24}$/.test(g.id || "") ? g.id : `g${Date.now().toString(36)}${i}`, name: String(g.name || "").replace(/[<>]/g, "").trim().slice(0, 40) || `Goal ${i + 1}`,
    target: num(g.target, 0, 1e11, null), year: num(g.year, 2000, 2100, null) }));
  const ids = new Set(goals.map(g => g.id));
  for (const [k, v] of Object.entries(b.goalOf || {})) { if (String(k).length > 200) continue; if (!v) delete goalOf[k]; else if (ids.has(v)) goalOf[k] = v; }
  for (const k of Object.keys(goalOf)) if (!ids.has(goalOf[k])) delete goalOf[k];
  const targets = {}; for (const bk of ["short", "long", "retirement"]) { const t = (b.targets || prev.targets || {})[bk]; const v = num(t, 0, 100, null); if (v !== null) targets[bk] = v; }
  return { monthly, minMonths, maxMonths, assign, goalOf, goals, targets, updatedAt: new Date().toISOString() };
}

// lines: net worth asset lines [{ id, category, name, value, fundCategory? }]; plan: sanitizeBucketPlan output;
// spend: { avgMonthly, months } from the expense tracker (optional)
export function bucketView(lines = [], plan = sanitizeBucketPlan(), { spend = null, liabilities = 0 } = {}) {
  const rows = lines.filter(l => l.kind !== "liability" && l.value > 0).map(l => {
    const auto = defaultBucket(l), bucket = plan.assign[l.id] || auto;
    return { id: l.id, name: l.name, category: l.category, fundCategory: l.fundCategory || null, value: r0(l.value), bucket, auto, moved: !!plan.assign[l.id] && plan.assign[l.id] !== auto, goal: plan.goalOf[l.id] || null };
  });
  const inBuckets = rows.filter(r => r.bucket !== "none"), total = inBuckets.reduce((a, r) => a + r.value, 0);
  const buckets = BUCKETS.map(b => {
    const own = rows.filter(r => r.bucket === b.id).sort((x, y) => y.value - x.value), value = own.reduce((a, r) => a + r.value, 0);
    return { ...b, value, pct: total > 0 ? r1(value / total * 100) : 0, lines: own, target: plan.targets[b.id] ?? null };
  });
  const S = buckets.find(b => b.id === "safety"), monthly = plan.monthly, lo = monthly * plan.minMonths, hi = monthly * plan.maxMonths;
  S.months = monthly > 0 ? r1(S.value / monthly) : null; S.min = lo; S.max = hi;
  const actions = [];
  if (S.value < lo) { S.status = "low"; actions.push({ bucket: "safety", tone: "warn", text: `Safety holds ${S.months} months of expenses, below your ${plan.minMonths}-month floor: add ₹${r0(lo - S.value).toLocaleString("en-IN")} (liquid / arbitrage fund or FD) before investing more for growth.` }); }
  else if (S.value > hi) { S.status = "high"; actions.push({ bucket: "safety", tone: "info", text: `Safety holds ${S.months} months of expenses, above your ${plan.maxMonths}-month cap: about ₹${r0(S.value - hi).toLocaleString("en-IN")} could move to the short-term or long-term bucket.` }); }
  else { S.status = "ok"; actions.push({ bucket: "safety", tone: "ok", text: `Safety covers ${S.months} months of expenses (your range: ${plan.minMonths}–${plan.maxMonths} months).` }); }
  for (const b of buckets) if (b.target !== null && total > 0 && Math.abs(b.pct - b.target) >= 5) actions.push({ bucket: b.id, tone: b.pct < b.target ? "warn" : "info", text: `${b.label} is ${b.pct}% of your buckets vs your ${b.target}% target: ${b.pct < b.target ? "add" : "slow down adding"} about ₹${r0(Math.abs(b.pct - b.target) / 100 * total).toLocaleString("en-IN")}.` });
  if (spend?.avgMonthly > 0 && Math.abs(spend.avgMonthly - monthly) / monthly > 0.2) actions.push({ bucket: "safety", tone: "info", text: `Your tracked spending averages ₹${r0(spend.avgMonthly).toLocaleString("en-IN")} a month over ${spend.months} month${spend.months === 1 ? "" : "s"} (Monthly expenses), vs the ₹${r0(monthly).toLocaleString("en-IN")} the safety bucket is sized on.` });
  const goals = plan.goals.map(g => { const own = rows.filter(r => r.goal === g.id), value = own.reduce((a, r) => a + r.value, 0); return { ...g, value, lines: own.map(r => r.name), progress: g.target > 0 ? Math.min(100, r1(value / g.target * 100)) : null }; });
  return { buckets, total: r0(total), outside: rows.filter(r => r.bucket === "none").sort((a, b) => b.value - a.value), goals, actions, plan: { monthly: plan.monthly, minMonths: plan.minMonths, maxMonths: plan.maxMonths, targets: plan.targets }, liabilities: r0(liabilities) };
}
