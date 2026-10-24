// Monthly expense tracker: for each month, your income, the planned budget (needs / wants / investments / unplanned,
// which bank pays it, done or not), and a daily log of what you actually spent (item, amount, how you paid: Pluxee,
// GPay, credit card…, and a category the app guesses from the item and learns from your corrections). The year report
// (April–March) shows where the money went, by category, month and payment method. Private to your login. Pure functions.
const fin = v => Number.isFinite(v);
const r0 = v => Math.round(v || 0);
const txt = (v, n) => String(v ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, n);
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const DEFAULT_MODES = ["Pluxee", "GPay", "Credit card", "Debit card", "Cash", "Other"];
// category → { kind: need | want, budget: the plan line it counts against by default }
export const CATEGORIES = {
  "Groceries": { kind: "need", icon: "🛒", budget: "Grocery" },
  "Milk & dairy": { kind: "need", icon: "🥛", budget: "Milk" },
  "Meat & fish": { kind: "need", icon: "🍗", budget: "Grocery" },
  "Fruits & vegetables": { kind: "need", icon: "🥦", budget: "Grocery" },
  "Food delivery & eating out": { kind: "want", icon: "🍔" },
  "Drinks & treats": { kind: "want", icon: "🍺" },
  "Fuel": { kind: "need", icon: "⛽", budget: "Petrol" },
  "Vehicle": { kind: "need", icon: "🛵" },
  "Bills & recharges": { kind: "need", icon: "📱" },
  "Health": { kind: "need", icon: "💊" },
  "Kids": { kind: "need", icon: "🧒", budget: "Kids Expense" },
  "Home & household": { kind: "need", icon: "🏠" },
  "Shopping": { kind: "want", icon: "🛍️" },
  "Entertainment": { kind: "want", icon: "🎬" },
  "Travel": { kind: "want", icon: "✈️" },
  "Gifts & family": { kind: "want", icon: "🎁" },
  "Personal care": { kind: "want", icon: "💇" },
  "Other": { kind: "want", icon: "📦" }
};
const RULES = [
  [/\bmilk|curd|paneer|dairy|nandini|amul\b/i, "Milk & dairy"],
  [/chicken|mutton|fish|meat|eggs?\b|prawn|licious/i, "Meat & fish"],
  [/fruit|vegetable|veggies|sabzi/i, "Fruits & vegetables"],
  [/grocery|groceries|big ?basket|bg ?basket|dmart|d-mart|more\b|ratnadeep|reliance fresh|zepto|blinkit|instamart|jiomart|stores?\b|kirana|supermarket|mart\b/i, "Groceries"],
  [/swiggy|zomato|restaurant|hotel|cafe|pizza|burger|dine|eat ?out|biryani|starbucks|domino/i, "Food delivery & eating out"],
  [/beer|coke|wine|whisky|liquor|ice ?cream|chocolate|juice|soda/i, "Drinks & treats"],
  [/petrol|diesel|fuel|cng|ev charg/i, "Fuel"],
  [/service|tyre|puncture|car wash|car cleaning|insurance.*(bike|car)|parking|toll|fastag/i, "Vehicle"],
  [/recharge|mobile|internet|broadband|wifi|electricity|bescom|gas\b|cylinder|water bill|dth|jio|airtel|bill\b/i, "Bills & recharges"],
  [/medic|pharma|doctor|hospital|clinic|apollo|1mg|pharmeasy|lab test|dental/i, "Health"],
  [/school|tuition|kids?|toy|drawing|class(es)?\b|books?\b|uniform|stationery|van\b/i, "Kids"],
  [/maid|cleaning|plumber|electrician|repair|furniture|utensil|urban company|laundry|ironing|house/i, "Home & household"],
  [/amazon|flipkart|myntra|ajio|nykaa|meesho|clothes|shoes|shopping|mall/i, "Shopping"],
  [/movie|netflix|prime|hotstar|spotify|pvr|inox|game|bookmyshow/i, "Entertainment"],
  [/uber|ola|rapido|flight|train|irctc|bus\b|trip|travel|hotel booking|makemytrip|goibibo/i, "Travel"],
  [/gift|mom|dad|family|donation|temple|function|wedding/i, "Gifts & family"],
  [/salon|haircut|parlour|spa|grooming/i, "Personal care"]
];
// learned: { "item text (lower)": category } from your own corrections
export function guessCategory(item, learned = {}) {
  const k = txt(item, 80).toLowerCase(); if (learned[k] && CATEGORIES[learned[k]]) return learned[k];
  for (const [re, c] of RULES) if (re.test(k)) return c;
  return "Other";
}
const money = v => { const x = Number(String(v ?? "").replace(/[,₹\s]/g, "")); return fin(x) ? Math.round(x * 100) / 100 : null; };
const id = () => `x${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const PLAN_TYPES = { needs: "Needs", wants: "Wants", invest: "Investment", unplanned: "Unplanned" };

export function sanitizeEntry(b = {}, { month, modes = DEFAULT_MODES, learned = {} } = {}) {
  const amount = money(b.amount); if (!(amount > 0) || amount > 1e8) throw new Error("Enter the amount spent.");
  const date = String(b.date || "").slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (month && date.slice(0, 7) !== month)) throw new Error(`Pick a date in ${month || "the month"}.`);
  const item = txt(b.item, 80); if (!item) throw new Error("What was it for?");
  const mode = txt(b.mode, 30) || modes[0], category = CATEGORIES[b.category] ? b.category : guessCategory(item, learned);
  return { id: /^x[\w]{4,20}$/.test(b.id || "") ? b.id : id(), date, item, amount, mode, category, note: txt(b.note, 120) || null };
}
export function sanitizePlanLine(b = {}) {
  const amount = b.amount === "" || b.amount == null ? null : money(b.amount); if (amount !== null && (amount < 0 || amount > 1e9)) throw new Error("Amount looks wrong.");
  const name = txt(b.name, 50); if (!name) throw new Error("Name the budget line.");
  return { id: /^x[\w]{4,20}$/.test(b.id || "") ? b.id : id(), name, amount, bank: txt(b.bank, 20) || null, type: PLAN_TYPES[b.type] ? b.type : "needs", done: !!b.done };
}
export function sanitizeIncome(b = {}) { const amount = money(b.amount); if (!(amount >= 0)) throw new Error("Enter the amount."); return { id: /^x[\w]{4,20}$/.test(b.id || "") ? b.id : id(), name: txt(b.name, 50) || "Income", amount }; }

// A new month starts from the previous one's plan and income (nothing marked done, no log)
export function newMonth(prev = null) {
  return { income: (prev?.income || []).map(x => ({ ...x, id: id() })), plan: (prev?.plan || []).map(x => ({ ...x, id: id(), done: false })), entries: [] };
}

// Pasted plan rows from a sheet: "Rent  47500  HDFC  Expense  NEEDS  DONE" (tabs or 2+ spaces). Income rows: "Salary in Hand 198000".
export function parsePlanPaste(text) {
  const plan = [], income = [];
  for (const raw of String(text || "").split(/\r?\n/).slice(0, 200)) {
    const cells = raw.split(/\t| {2,}/).map(c => c.trim()).filter(Boolean); if (!cells.length) continue;
    const name = cells[0]; if (/^(total|saved|expense|investments?|unplanned)\b/i.test(name) && cells.length < 3 && !/\d/.test(cells[1] || "")) continue;
    if (/^(total|saved)\b/i.test(name)) continue;
    const amt = cells.slice(1).map(money).find(v => v !== null);
    if (/salary|income|contribution|bonus|rent received|interest/i.test(name) && !cells.some(c => /^(needs|wants|invest|expense)$/i.test(c))) { if (amt !== null) income.push({ name, amount: amt }); continue; }
    const up = cells.map(c => c.toUpperCase());
    const type = up.includes("INVEST") || up.includes("INVESTMENT") ? "invest" : up.includes("WANTS") ? "wants" : up.includes("NEEDS") ? "needs" : /additional|credit card|unplanned/i.test(name) ? "unplanned" : "needs";
    const bank = cells.slice(1).find(c => /^[A-Z]{2,8}$/.test(c) && !/^(NEEDS|WANTS|INVEST|DONE|EXPENSE)$/i.test(c)) || null;
    plan.push({ name, amount: amt, bank, type, done: up.includes("DONE") });
  }
  return { plan, income };
}

// Pasted daily log. Understands the sheet layout with payment methods as column headers ("Pluxee  Gpay  Credit Card …"):
// a date in a row (carried down to the rows under it), item names each followed by an amount; an amount sitting under a
// payment-method column is paid that way. Also plain lines: "02-10-2026 Milk 81 GPay".
export function parseLogPaste(text, { month, modes = DEFAULT_MODES } = {}) {
  const rows = String(text || "").replace(/\r/g, "").split("\n").slice(0, 600).map(l => l.split("\t"));
  const modeOf = s => { const k = String(s || "").trim().toLowerCase(); if (!k) return null; return modes.find(m => m.toLowerCase() === k) || modes.find(m => k.startsWith(m.toLowerCase()) || m.toLowerCase().startsWith(k)) || null; };
  // header: a row whose non-empty cells are (mostly) payment methods
  const cols = new Map(); let start = 0;
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    const cells = rows[i].map(c => c.trim()), hits = cells.map((c, j) => [j, c]).filter(([, c]) => c && !/^[\d,.]+$/.test(c));
    if (hits.length >= 2 && hits.every(([, c]) => modeOf(c) || /^[A-Za-z][\w ]{1,20}$/.test(c)) && !hits.some(([, c]) => dayOf(c, month))) { for (const [j, c] of hits) cols.set(j, modeOf(c) || txt(c, 30)); start = i + 1; break; }
  }
  const out = []; let day = null;
  for (const r of rows.slice(start)) {
    let item = null;
    r.forEach((c0, j) => {
      const c = c0.trim(); if (!c) return;
      const d = dayOf(c, month); if (d) { day = d; return; }
      const v = money(c);
      if (v !== null && /^[₹\d,.\s]+$/.test(c)) {
        if (item && day) out.push({ date: day, item, amount: v, mode: cols.get(j) || null });
        else if (!item && day && out.length && cols.has(j)) out.push({ date: day, item: out.at(-1).item, amount: v, mode: cols.get(j) }); // a second amount for the same item, another method
        return;
      }
      const m = modeOf(c); if (m && out.length && out.at(-1).item === item && !out.at(-1).mode) { out.at(-1).mode = m; return; }
      item = txt(c.replace(/\(.*?\)/g, "").trim() || c, 80);
    });
  }
  return out.filter(e => e.amount > 0);
}
function dayOf(c, month) {
  let m = String(c).match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = String(c).match(/^(\d{4})-(\d{2})-(\d{2})$/); if (m) return c;
  m = String(c).match(/^(\d{1,2})[-/ ]([A-Za-z]{3})/); if (m && month) { const mon = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }[m[2].toLowerCase()]; if (mon) return `${month.slice(0, 4)}-${String(mon).padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  return null;
}

// One month: totals, plan vs actual, by category / method / week
export function monthSummary(m = {}, { budgets = {} } = {}) {
  const income = (m.income || []).reduce((a, x) => a + (x.amount || 0), 0), plan = m.plan || [], entries = m.entries || [];
  const sumType = t => plan.filter(p => p.type === t).reduce((a, p) => a + (p.amount || 0), 0);
  const planned = { needs: sumType("needs"), wants: sumType("wants"), invest: sumType("invest"), unplanned: sumType("unplanned") };
  const plannedTotal = planned.needs + planned.wants + planned.invest + planned.unplanned;
  const spent = entries.reduce((a, e) => a + e.amount, 0);
  const group = key => { const g = new Map(); for (const e of entries) { const k = key(e); g.set(k, (g.get(k) || 0) + e.amount); } return [...g].map(([k, v]) => ({ key: k, amount: r0(v), pct: spent > 0 ? Math.round(v / spent * 1000) / 10 : 0 })).sort((a, b) => b.amount - a.amount); };
  const byCategory = group(e => e.category).map(x => ({ ...x, icon: CATEGORIES[x.key]?.icon || "📦", kind: CATEGORIES[x.key]?.kind || "want" }));
  // daily spending against budget lines: Groceries / Meat & fish → "Grocery", Milk → "Milk", Fuel → "Petrol" (editable)
  const budgetOf = c => budgets[c] ?? CATEGORIES[c]?.budget ?? null;
  const vsBudget = plan.filter(p => p.amount > 0 && p.type !== "invest").map(p => { const cats = Object.keys(CATEGORIES).filter(c => (budgetOf(c) || "").toLowerCase() === p.name.toLowerCase()); if (!cats.length) return null; const used = entries.filter(e => cats.includes(e.category)).reduce((a, e) => a + e.amount, 0); return { name: p.name, budget: p.amount, spent: r0(used), left: r0(p.amount - used), pct: Math.round(used / p.amount * 100), categories: cats }; }).filter(Boolean);
  const wants = entries.filter(e => (CATEGORIES[e.category]?.kind || "want") === "want").reduce((a, e) => a + e.amount, 0);
  return { income: r0(income), planned: Object.fromEntries(Object.entries(planned).map(([k, v]) => [k, r0(v)])), plannedTotal: r0(plannedTotal), saved: r0(income - plannedTotal),
    done: plan.filter(p => p.done).length, pending: plan.filter(p => !p.done && p.amount > 0).map(p => ({ name: p.name, amount: p.amount, bank: p.bank })), spent: r0(spent), entries: entries.length,
    byCategory, byMode: group(e => e.mode || "—"), byWeek: group(e => `Week ${Math.min(5, Math.ceil(Number(e.date.slice(8, 10)) / 7))}`).sort((a, b) => a.key.localeCompare(b.key)),
    wantsPct: spent > 0 ? Math.round(wants / spent * 1000) / 10 : 0, vsBudget, investRate: income > 0 ? Math.round(planned.invest / income * 1000) / 10 : null };
}

// Financial year (April to March) containing `month`: "2026-10" → FY 2026-27 = 2026-04 … 2027-03
export function fyMonths(month) { const [y, m] = month.split("-").map(Number), start = m >= 4 ? y : y - 1; return Array.from({ length: 12 }, (_, i) => { const mm = ((3 + i) % 12) + 1, yy = start + (3 + i >= 12 ? 1 : 0); return `${yy}-${String(mm).padStart(2, "0")}`; }); }
export const fyLabel = month => { const s = fyMonths(month)[0].slice(0, 4); return `FY ${s}-${String(Number(s) + 1).slice(2)}`; };
export function yearReport(months = {}, month, opts = {}) {
  const list = fyMonths(month), rows = list.map(k => ({ month: k, has: !!months[k], ...(months[k] ? monthSummary(months[k], opts) : {}) }));
  const have = rows.filter(r => r.has), cats = new Map(), modes = new Map();
  for (const r of have) { for (const c of r.byCategory) cats.set(c.key, (cats.get(c.key) || 0) + c.amount); for (const x of r.byMode) modes.set(x.key, (modes.get(x.key) || 0) + x.amount); }
  const spent = have.reduce((a, r) => a + r.spent, 0), sum = k => have.reduce((a, r) => a + (r[k] || 0), 0), psum = k => have.reduce((a, r) => a + (r.planned?.[k] || 0), 0);
  const categories = [...cats].map(([k, v]) => ({ key: k, icon: CATEGORIES[k]?.icon || "📦", kind: CATEGORIES[k]?.kind || "want", amount: r0(v), pct: spent > 0 ? Math.round(v / spent * 1000) / 10 : 0, perMonth: list.map(mm => r0(rows.find(r => r.month === mm)?.byCategory?.find(c => c.key === k)?.amount || 0)) })).sort((a, b) => b.amount - a.amount);
  return { fy: fyLabel(month), months: list, rows: rows.map(r => ({ month: r.month, has: r.has, income: r.income || 0, planned: r.planned || null, plannedTotal: r.plannedTotal || 0, saved: r.saved || 0, spent: r.spent || 0, wantsPct: r.wantsPct || 0 })),
    totals: { income: r0(sum("income")), plannedTotal: r0(sum("plannedTotal")), saved: r0(sum("saved")), spent: r0(spent), needs: r0(psum("needs")), wants: r0(psum("wants")), invest: r0(psum("invest")), unplanned: r0(psum("unplanned")), months: have.length },
    avgSpent: have.length ? r0(spent / have.length) : 0, avgPlanned: have.length ? r0(sum("plannedTotal") / have.length) : 0, categories, byMode: [...modes].map(([k, v]) => ({ key: k, amount: r0(v), pct: spent > 0 ? Math.round(v / spent * 1000) / 10 : 0 })).sort((a, b) => b.amount - a.amount) };
}
export function toCsv(months = {}) {
  const q = s => `"${String(s ?? "").replace(/"/g, '""')}"`, out = ["Date,Item,Amount,Paid by,Category,Note"];
  for (const k of Object.keys(months).sort()) for (const e of [...(months[k].entries || [])].sort((a, b) => a.date.localeCompare(b.date))) out.push([e.date, q(e.item), e.amount, q(e.mode), q(e.category), q(e.note)].join(","));
  return out.join("\n");
}
