// Dividend income planner: the person's dividend stocks, the income they pay, a month-by-month calendar and a projection to a
// monthly-income target. Pure; the server supplies prices / dividend data and stores the plan in data/dividend-plan.json.
const fin = v => Number.isFinite(v);
const r0 = v => Math.round(v);
export const DEFAULT_SETTINGS = { targetMonthly: 50000, monthlyContribution: 25000, dividendGrowth: 6, newMoneyYield: 3.5, reinvest: true };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function sanitizePlan(body) {
  const s = { ...DEFAULT_SETTINGS, ...(body?.settings || {}) };
  const clamp = (v, lo, hi, d) => (fin(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);
  const settings = { targetMonthly: clamp(s.targetMonthly, 0, 1e8, DEFAULT_SETTINGS.targetMonthly), monthlyContribution: clamp(s.monthlyContribution, 0, 1e8, DEFAULT_SETTINGS.monthlyContribution), dividendGrowth: clamp(s.dividendGrowth, 0, 30, DEFAULT_SETTINGS.dividendGrowth), newMoneyYield: clamp(s.newMoneyYield, 0.1, 20, DEFAULT_SETTINGS.newMoneyYield), reinvest: s.reinvest !== false };
  const seen = new Set();
  const rows = (Array.isArray(body?.rows) ? body.rows : []).map(r => ({ symbol: String(r.symbol || "").trim().toUpperCase(), exchange: r.exchange === "BSE" ? "BSE" : "NSE", shares: clamp(r.shares, 0, 1e9, 0), dpsOverride: r.dpsOverride === null || r.dpsOverride === "" || r.dpsOverride === undefined ? null : clamp(r.dpsOverride, 0, 1e6, null) }))
    .filter(r => /^[A-Z0-9&-]{1,20}$/.test(r.symbol) && !seen.has(r.symbol) && seen.add(r.symbol)).slice(0, 200);
  return { settings, rows };
}

// Years until monthly income reaches the target. Each year: existing income grows by the dividend growth rate, and new money
// (contributions, plus last year's dividends when reinvesting) buys more income at the new-money yield.
export function projectIncome({ annualIncome, settings, maxYears = 30 }) {
  const g = settings.dividendGrowth / 100, y = settings.newMoneyYield / 100, target = settings.targetMonthly * 12;
  const years = []; let income = annualIncome, invested = 0, reached = annualIncome >= target && target > 0 ? 0 : null;
  for (let t = 1; t <= maxYears; t++) {
    const newMoney = settings.monthlyContribution * 12 + (settings.reinvest ? income : 0);
    invested += settings.monthlyContribution * 12;
    income = income * (1 + g) + newMoney * y;
    years.push({ year: t, annualIncome: r0(income), monthly: r0(income / 12), contributed: r0(invested) });
    if (reached === null && target > 0 && income >= target) reached = t;
  }
  const corpusNeeded = settings.newMoneyYield > 0 ? r0(target / y) : null;
  return { years, reachedInYears: reached, corpusNeeded };
}

// rowsInfo: symbol -> { company, price, dividend (dividends.computeDividends), held }
export function buildPlan(plan, rowsInfo) {
  const calendar = Array(12).fill(0);
  const rows = plan.rows.map(r => {
    const info = rowsInfo[r.symbol] || {}, d = info.dividend || null;
    const dps = r.dpsOverride ?? (d ? d.ttm || 0 : null);
    const annual = fin(dps) ? dps * r.shares : null;
    const price = fin(info.price) ? info.price : null;
    const cal = d?.calendar && d.calendar.some(v => v > 0) ? d.calendar : null;
    if (annual && cal) { const tot = cal.reduce((a, b) => a + b, 0); cal.forEach((v, i) => { calendar[i] += annual * v / tot; }); }
    else if (annual) for (let i = 0; i < 12; i++) calendar[i] += annual / 12; // unknown timing: spread evenly
    return { ...r, company: info.company || r.symbol, price, dps, dpsSource: r.dpsOverride !== null ? "yours" : d ? "last 12 months" : info.dataError ? "history unavailable" : "no data yet", yield: price && fin(dps) ? Math.round(dps / price * 1000) / 10 : null, annual: fin(annual) ? r0(annual) : null, monthly: fin(annual) ? r0(annual / 12) : null, value: price ? r0(price * r.shares) : null, safety: d?.safety || null, streakYears: d?.streakYears ?? null, cagr5: d?.cagr5 ?? null, note: d?.note || null, payMonths: cal ? cal.map((v, i) => (v > 0 ? MONTHS[i] : null)).filter(Boolean) : [], held: info.held ?? null, pending: !d && r.dpsOverride === null && !info.dataError, dataError: info.dataError || null };
  });
  const annualIncome = rows.reduce((a, r) => a + (r.annual || 0), 0), value = rows.reduce((a, r) => a + (r.value || 0), 0);
  const proj = projectIncome({ annualIncome, settings: plan.settings });
  return {
    settings: plan.settings, rows,
    totals: { annualIncome: r0(annualIncome), monthlyAvg: r0(annualIncome / 12), value: r0(value), yield: value > 0 ? Math.round(annualIncome / value * 1000) / 10 : null, payers: rows.filter(r => r.annual > 0).length, progress: plan.settings.targetMonthly > 0 ? Math.min(1, annualIncome / 12 / plan.settings.targetMonthly) : null },
    calendar: calendar.map((v, i) => ({ month: MONTHS[i], amount: r0(v) })), projection: proj
  };
}

// ---- Goal planner (from the "Dividend Income Planner" page): pick up to 15 dividend stocks, get the capital needed for a
// monthly income goal under one of three allocation methods. Same maths as that page.
export const GOAL_MAX = 15, GOAL_METHODS = ["equalDiv", "equalCap", "yieldWeighted"];
export const GOAL_SEED = [
  ["VEDL", "Vedanta", 268, 34.0, true], ["COALINDIA", "Coal India", 426, 26.5, true], ["RECLTD", "REC Limited", 313, 18.56, true], ["PFC", "Power Finance Corp", 338, 18.75, true],
  ["IOC", "Indian Oil Corp", 136, 8.27, true], ["ONGC", "ONGC", 238, 12.25, true], ["GAIL", "GAIL India", 174, 7.5, true], ["TCS", "TCS", 2082, 109.0, true], ["IGL", "Indraprastha Gas", 208, 9.0, true],
  ["CASTROLIND", "Castrol India", 205, 10.52, true], ["ITC", "ITC Limited", 264, 14.5, false], ["HEROMOTOCO", "Hero MotoCorp", 5180, 185, false], ["INFY", "Infosys", 1130, 48, false],
  ["BAJAJ-AUTO", "Bajaj Auto", 11600, 150, false], ["MARUTI", "Maruti Suzuki", 13800, 140, false], ["GULFOILLUB", "Gulf Oil Lubricants", 1010, 49, false], ["HINDZINC", "Hindustan Zinc", 450, 38.0, false],
  ["HCLTECH", "HCL Technologies", 1650, 60.0, false], ["BPCL", "Bharat Petroleum", 330, 12.5, false]
].map(([symbol, name, price, div, sel]) => ({ symbol, name, price, div, sel, priceManual: false, divManual: false }));

export function sanitizeGoal(g) {
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
  const seen = new Set(); let selected = 0;
  const candidates = (Array.isArray(g?.candidates) ? g.candidates : GOAL_SEED).map(c => ({ symbol: String(c.symbol || "").trim().toUpperCase(), name: String(c.name || c.symbol || "").slice(0, 60), price: num(c.price, 0), div: num(c.div, 0), sel: !!c.sel, priceManual: !!c.priceManual, divManual: !!c.divManual }))
    .filter(c => /^[A-Z0-9&-]{1,20}$/.test(c.symbol) && !seen.has(c.symbol) && seen.add(c.symbol)).slice(0, 60)
    .map(c => { if (c.sel && selected >= GOAL_MAX) c.sel = false; if (c.sel) selected++; return c; });
  return { monthlyGoal: num(g?.monthlyGoal, 100000), method: GOAL_METHODS.includes(g?.method) ? g.method : "equalDiv", candidates };
}

export function goalPlan({ monthlyGoal, method, candidates }) {
  const annual = monthlyGoal * 12, sel = candidates.filter(c => c.sel && c.price > 0);
  const n = sel.length; let rows = [];
  if (n) {
    if (method === "equalCap") {
      // Same capital C in every stock: income = C × Σ yield, so C = goal ÷ Σ yield. (The original page also divided by the
      // number of stocks, which planned only 1/n of the goal.)
      const sumYield = sel.reduce((a, s) => a + s.div / s.price, 0), capPer = sumYield > 0 ? annual / sumYield : 0;
      rows = sel.map(s => { const shares = Math.round(capPer / s.price); return { ...s, shares }; });
    } else if (method === "yieldWeighted") {
      const ys = sel.map(s => s.div / s.price), sumY = ys.reduce((a, b) => a + b, 0), sumY2 = ys.reduce((a, b) => a + b * b, 0);
      const total = sumY2 > 0 ? annual * sumY / sumY2 : 0;
      rows = sel.map((s, i) => { const w = sumY > 0 ? ys[i] / sumY : 0; return { ...s, shares: Math.round(total * w / s.price) }; });
    } else {
      const contribution = annual / n;
      rows = sel.map(s => ({ ...s, shares: s.div > 0 ? Math.ceil(contribution / s.div) : 0 }));
    }
    rows = rows.map(r => ({ symbol: r.symbol, name: r.name, price: r.price, div: r.div, shares: r.shares, capital: Math.round(r.shares * r.price), annualDiv: Math.round(r.shares * r.div), monthly: Math.round(r.shares * r.div / 12) })).sort((a, b) => b.capital - a.capital);
  }
  const totalCap = rows.reduce((a, r) => a + r.capital, 0), totalDiv = rows.reduce((a, r) => a + r.annualDiv, 0);
  return { annualGoal: Math.round(annual), totalCap, totalDiv, blendedYield: totalCap ? Math.round(totalDiv / totalCap * 10000) / 100 : 0, count: n, max: GOAL_MAX, rows };
}
