// Net worth: stocks and mutual funds come from synced holdings; everything else (EPF, PPF, NPS, gold, property, FDs,
// loans…) is entered by hand. Pure functions, so the maths is tested without a server.

export const ASSET_CATEGORIES = [
  { id: "stocks", label: "Stocks", icon: "📈", cls: "equity", auto: true },
  { id: "mf", label: "Mutual funds", icon: "🧺", cls: "equity" },
  { id: "epf", label: "EPF / PF", icon: "🏛️", cls: "debt" },
  { id: "ppf", label: "PPF", icon: "🛡️", cls: "debt" },
  { id: "nps", label: "NPS", icon: "🧓", cls: "retire" },
  { id: "gold", label: "Gold", icon: "🪙", cls: "gold", hint: "Jewellery, coins, SGBs, gold ETFs / funds" },
  { id: "realestate", label: "Real estate", icon: "🏠", cls: "realestate", hint: "Home, plot, commercial (today's market value)" },
  { id: "fd", label: "Fixed deposits", icon: "🏦", cls: "debt", hint: "FDs, RDs, post office schemes" },
  { id: "bonds", label: "Bonds / debt", icon: "📜", cls: "debt", hint: "Bonds, debentures, SSY, NSC, KVP" },
  { id: "cash", label: "Bank & cash", icon: "💵", cls: "cash", hint: "Savings, current account, cash" },
  { id: "intl", label: "US / global stocks", icon: "🌍", cls: "equity" },
  { id: "crypto", label: "Crypto", icon: "🪙", cls: "alt" },
  { id: "insurance", label: "Insurance (cash value)", icon: "☂️", cls: "alt", hint: "Surrender value of ULIPs / endowment plans" },
  { id: "other", label: "Other assets", icon: "📦", cls: "alt", hint: "Vehicles, collectibles, loans you gave" }
];
export const LIABILITY_CATEGORIES = [
  { id: "homeloan", label: "Home loan", icon: "🏠" },
  { id: "carloan", label: "Vehicle loan", icon: "🚗" },
  { id: "personalloan", label: "Personal loan", icon: "💳" },
  { id: "eduloan", label: "Education loan", icon: "🎓" },
  { id: "creditcard", label: "Credit card dues", icon: "💳" },
  { id: "otherloan", label: "Other liabilities", icon: "📄" }
];
export const ASSET_CLASSES = { equity: "Equity", debt: "Debt / fixed income", retire: "Retirement (NPS)", gold: "Gold", realestate: "Real estate", cash: "Cash", alt: "Other" };
const CAT = new Map([...ASSET_CATEGORIES.map(c => [c.id, { ...c, kind: "asset" }]), ...LIABILITY_CATEGORIES.map(c => [c.id, { ...c, kind: "liability", cls: "liability" }])]);

const money = v => { const x = Number(String(v ?? "").replace(/[,₹\s]/g, "")); return Number.isFinite(x) ? Math.round(x * 100) / 100 : null; };
const text = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// One manual entry. Throws with a message the UI can show.
export function sanitizeItem(input = {}, prev = null) {
  const cat = CAT.get(input.category);
  if (!cat || cat.auto) throw new Error("Pick a category.");
  const value = money(input.value);
  if (value === null || value < 0) throw new Error(cat.kind === "liability" ? "Enter the amount still outstanding." : "Enter today's value.");
  if (value > 1e12) throw new Error("That value looks too large.");
  const invested = input.invested === "" || input.invested == null ? null : money(input.invested);
  if (invested !== null && invested < 0) throw new Error("Invested amount cannot be negative.");
  const now = new Date().toISOString();
  return {
    id: prev?.id || `nw${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    kind: cat.kind, category: cat.id,
    name: text(input.name, 80) || cat.label,
    value, invested: cat.kind === "asset" ? invested : null,
    owner: text(input.owner, 40) || null,
    note: text(input.note, 200) || null,
    fundId: cat.id === "mf" && input.fundId ? text(input.fundId, 40) : null,
    createdAt: prev?.createdAt || now, updatedAt: now
  };
}

// stocks: [{ account, label, value, invested }]; mf: [{ key, name, value, invested, account, ... }] (synced);
// items: manual entries. Returns totals, categories, asset-class mix and liabilities.
export function buildNetworth({ stocks = [], mf = [], intl = [], items = [] } = {}) {
  const lines = [];
  for (const s of stocks) if (s.value > 0) lines.push({ source: "synced", kind: "asset", category: "stocks", id: `stk:${s.account}`, name: s.label, value: s.value, invested: s.invested ?? null, owner: s.owner || null, syncedAt: s.syncedAt || null });
  for (const f of mf) if (f.value > 0) lines.push({ source: "synced", kind: "asset", category: "mf", id: `mf:${f.key}`, name: f.name, value: f.value, invested: f.invested ?? null, owner: f.owner || null, syncedAt: f.syncedAt || null, fundId: f.fundId || null, isin: f.isin || null });
  for (const u of intl) if (u.value > 0) lines.push({ source: "synced", kind: "asset", category: "intl", id: `intl:${u.key}`, name: u.name, value: u.value, invested: u.invested ?? null, syncedAt: u.syncedAt || null });
  for (const it of items) if (CAT.has(it.category)) lines.push({ source: "manual", ...it });
  const sum = (arr, k = "value") => Math.round(arr.reduce((a, x) => a + (Number(x[k]) || 0), 0));
  const assets = lines.filter(l => l.kind === "asset"), liabilities = lines.filter(l => l.kind === "liability");
  const totalAssets = sum(assets), totalLiabilities = sum(liabilities);
  const pct = v => (totalAssets > 0 ? Math.round(v / totalAssets * 1000) / 10 : 0);
  const categories = [...ASSET_CATEGORIES, ...LIABILITY_CATEGORIES].map(c => {
    const own = lines.filter(l => l.category === c.id), value = sum(own), inv = own.filter(l => Number.isFinite(l.invested));
    const invested = inv.length ? sum(inv, "invested") : null, valueOfInvested = inv.length ? sum(inv) : null;
    return { id: c.id, label: c.label, icon: c.icon, hint: c.hint || null, kind: CAT.get(c.id).kind, cls: CAT.get(c.id).cls, auto: !!c.auto, count: own.length, value, pct: CAT.get(c.id).kind === "asset" ? pct(value) : null, invested, gain: invested !== null ? valueOfInvested - invested : null };
  });
  const classes = Object.entries(ASSET_CLASSES).map(([id, label]) => { const v = sum(assets.filter(l => CAT.get(l.category).cls === id)); return { id, label, value: v, pct: pct(v) }; }).filter(c => c.value > 0).sort((a, b) => b.value - a.value);
  const investedLines = assets.filter(l => Number.isFinite(l.invested) && l.invested > 0);
  return {
    totals: { investable: sum(assets.filter(l => !['realestate', 'other', 'insurance'].includes(l.category))), assets: totalAssets, liabilities: totalLiabilities, net: totalAssets - totalLiabilities, invested: investedLines.length ? sum(investedLines, "invested") : null, gainOnInvested: investedLines.length ? sum(investedLines) - sum(investedLines, "invested") : null, debtToAssets: totalAssets > 0 ? Math.round(totalLiabilities / totalAssets * 1000) / 10 : null },
    categories, classes,
    lines: lines.sort((a, b) => b.value - a.value)
  };
}

// One snapshot per day (the latest wins), oldest dropped after `keep`.
export function addSnapshot(history = [], day, totals, keep = 1500) {
  const snap = { day, net: totals.net, assets: totals.assets, liabilities: totals.liabilities };
  const out = history.filter(h => h.day !== day).concat(snap).sort((a, b) => a.day.localeCompare(b.day));
  return out.slice(-keep);
}
// Change against the closest snapshot on or before `daysAgo` days back.
export function changeSince(history, today, daysAgo) {
  const cut = new Date(new Date(`${today}T00:00:00Z`).getTime() - daysAgo * 864e5).toISOString().slice(0, 10);
  const base = [...history].reverse().find(h => h.day <= cut);
  const now = history.find(h => h.day === today) || history.at(-1);
  if (!base || !now || base.day === now.day) return null;
  return { from: base.day, abs: now.net - base.net, pct: base.net ? Math.round((now.net - base.net) / Math.abs(base.net) * 1000) / 10 : null };
}

// ---- Fund name matching: "Helios Flexi Cap Fund - Direct Plan - Growth" ≈ X-ray "Helios Flexi Cap" ----
const STOP = /\b(fund|direct|regular|plan|growth|option|idcw|dividend|payout|reinvestment|reinvest|the|mutual|mf|scheme|of|series|g|dir|reg|gr)\b/g;
const STOP_WORDS = new Set(["fund", "direct", "regular", "plan", "growth", "option", "idcw", "the", "mf", "of"]);
export const fundTokens = s => String(s || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(STOP, " ").split(/\s+/).map(t => (t.length > 4 && t.endsWith("mf") ? t.slice(0, -2) : t)).filter(t => t && !STOP_WORDS.has(t));
export function matchFund(name, funds) {
  const a = new Set(fundTokens(name)); if (!a.size) return null;
  let best = null;
  for (const f of funds) {
    const b = new Set(fundTokens(f.name)); if (!b.size) continue;
    const common = [...a].filter(t => b.has(t)).length;
    const score = common / Math.max(a.size, b.size);
    // The X-ray name must be fully contained in the scheme name (or nearly so): "Flexi Cap" alone never matches.
    if (common >= 2 && common >= b.size - (b.size > 3 ? 1 : 0) && (!best || score > best.score)) best = { id: f.id, name: f.name, score: Math.round(score * 100) / 100 };
  }
  return best;
}

// ---- Look-through: what you really own in each stock, directly plus through your funds ----
// direct: [{ symbol, name, value }]; funds: [{ key, name, value, fundId }]; xray: Map(fundId -> { name, holdings:[{ symbol, name, weight }] })
export function lookThrough({ direct = [], funds = [], xray = new Map() } = {}) {
  const stocks = new Map();
  const get = (symbol, name) => { const k = symbol || `name:${String(name).toLowerCase()}`; if (!stocks.has(k)) stocks.set(k, { symbol: symbol || null, name: name || symbol, direct: 0, viaFunds: 0, sources: [] }); return stocks.get(k); };
  for (const d of direct) if (d.value > 0) { const s = get(d.symbol, d.name); s.direct += d.value; }
  let covered = 0, uncovered = 0; const perFund = [];
  for (const f of funds) {
    const x = f.fundId ? xray.get(f.fundId) : null;
    if (!x || !(f.value > 0)) { uncovered += f.value > 0 ? f.value : 0; perFund.push({ key: f.key, name: f.name, value: f.value, linked: !!x, xrayName: x?.name || null }); continue; }
    covered += f.value;
    let equityPct = 0, overlap = 0;
    for (const h of x.holdings) {
      const v = f.value * h.weight / 100; equityPct += h.weight;
      const s = get(h.symbol, h.name); s.viaFunds += v; s.sources.push({ fund: f.name, value: Math.round(v), weight: h.weight });
      if (h.symbol && direct.some(d => d.symbol === h.symbol && d.value > 0)) overlap += h.weight;
    }
    perFund.push({ key: f.key, name: f.name, value: f.value, linked: true, xrayName: x.name, equityPct: Math.round(equityPct * 10) / 10, overlapPct: Math.round(overlap * 10) / 10 });
  }
  const directTotal = direct.reduce((a, d) => a + (d.value > 0 ? d.value : 0), 0);
  const rows = [...stocks.values()].map(s => ({ ...s, direct: Math.round(s.direct), viaFunds: Math.round(s.viaFunds), total: Math.round(s.direct + s.viaFunds), sources: s.sources.sort((a, b) => b.value - a.value) }));
  const equityTotal = rows.reduce((a, r) => a + r.total, 0);
  rows.forEach(r => { r.pct = equityTotal > 0 ? Math.round(r.total / equityTotal * 1000) / 10 : 0; r.both = r.direct > 0 && r.viaFunds > 0; });
  rows.sort((a, b) => b.total - a.total);
  return {
    rows, perFund,
    totals: { direct: Math.round(directTotal), viaFunds: Math.round(rows.reduce((a, r) => a + r.viaFunds, 0)), coveredFunds: Math.round(covered), uncoveredFunds: Math.round(uncovered), stocks: rows.length, doubledUp: rows.filter(r => r.both).length },
    top10Pct: Math.round(rows.slice(0, 10).reduce((a, r) => a + r.pct, 0) * 10) / 10
  };
}

// ---- Goals: "₹5 Cr by 2035" — needed growth vs what you are getting ----
export function sanitizeGoal(input = {}, prev = null, today = new Date().toISOString().slice(0, 10)) {
  const name = text(input.name, 60) || "Net worth goal";
  const target = money(input.target);
  if (!(target > 0)) throw new Error("Enter the target amount.");
  const by = String(input.by || "").trim();
  if (!/^\d{4}-\d{2}$/.test(by) || `${by}-01` <= today.slice(0, 7) + "-00") throw new Error("Pick a target month in the future (YYYY-MM).");
  const monthly = input.monthly === "" || input.monthly == null ? 0 : money(input.monthly);
  if (monthly === null || monthly < 0) throw new Error("Monthly investment must be zero or more.");
  const ret = input.expectedReturn === "" || input.expectedReturn == null ? 11 : Number(input.expectedReturn);
  if (!Number.isFinite(ret) || ret < 0 || ret > 30) throw new Error("Expected return should be between 0 and 30% a year.");
  const basis = ["net", "investable"].includes(input.basis) ? input.basis : "net";
  return { id: prev?.id || `g${Date.now().toString(36)}`, name, target, by, monthly, expectedReturn: ret, basis, createdAt: prev?.createdAt || new Date().toISOString() };
}
// Future value of `now` growing at annual rate r, plus `monthly` added at each month end, after `months` months.
export const futureValue = (now, monthly, r, months) => { const m = Math.pow(1 + r, 1 / 12) - 1; const g = Math.pow(1 + m, months); return now * g + (m > 0 ? monthly * (g - 1) / m : monthly * months); };
// Annual return needed to reach the target (bisection); null when impossible within 100% a year.
export function requiredReturn(now, monthly, target, months) {
  if (months <= 0) return null;
  if (futureValue(now, monthly, 0, months) >= target) return 0;
  let lo = 0, hi = 1; if (futureValue(now, monthly, hi, months) < target) return null;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (futureValue(now, monthly, mid, months) >= target) hi = mid; else lo = mid; }
  return Math.round(hi * 1000) / 10;
}
// Actual annualised growth of net worth from the daily history (needs at least ~2 months of data).
export function actualGrowth(history, key = "net") {
  const pts = history.filter(h => Number.isFinite(h[key]) && h[key] > 0); if (pts.length < 2) return null;
  const a = pts[0], b = pts.at(-1), days = (new Date(b.day) - new Date(a.day)) / 864e5;
  if (days < 60) return null;
  return Math.round((Math.pow(b[key] / a[key], 365 / days) - 1) * 1000) / 10;
}
export function goalStatus(goal, { net, investable, history = [], today }) {
  const now = goal.basis === "investable" ? investable : net;
  const [y, m] = goal.by.split("-").map(Number), [ty, tm] = today.split("-").map(Number);
  const months = (y - ty) * 12 + (m - tm);
  const need = requiredReturn(now, goal.monthly, goal.target, months);
  const projected = futureValue(Math.max(0, now), goal.monthly, goal.expectedReturn / 100, months);
  const actual = goal.basis === "net" ? actualGrowth(history) : null;
  const gap = goal.target - projected;
  // Extra monthly amount that closes the gap at the expected return.
  const mr = Math.pow(1 + goal.expectedReturn / 100, 1 / 12) - 1, factor = mr > 0 ? (Math.pow(1 + mr, months) - 1) / mr : months;
  const extraMonthly = gap > 0 && months > 0 ? Math.ceil(gap / factor / 100) * 100 : 0;
  const state = need === null ? "out-of-reach" : need <= goal.expectedReturn ? "on-track" : need <= goal.expectedReturn + 3 ? "stretch" : "behind";
  return { ...goal, now: Math.round(now), months, progressPct: goal.target > 0 ? Math.max(0, Math.min(100, Math.round(now / goal.target * 1000) / 10)) : 0, requiredReturn: need, projected: Math.round(projected), gap: Math.round(gap), extraMonthly, actualGrowth: actual, state };
}
