// Dividends received, month by month: what actually landed in your bank, recorded as it comes (or pasted from your own
// sheet). One grid per year: stocks down the side, months across, totals both ways, who paid each month, and how the
// year compares with the last. Pure functions.
const r0 = v => Math.round(v || 0), r2 = v => Math.round(v * 100) / 100;
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_RE = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;
export const stockKey = s => String(s || "").toLowerCase().replace(/\b(ltd|limited|india|the)\b/g, "").replace(/[^a-z0-9]+/g, "");
const cleanName = s => String(s || "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
const money = v => { const s = String(v ?? "").replace(/[,₹\s]/g, ""); if (!s) return null; const n = Number(s); return Number.isFinite(n) ? n : NaN; };

// one dividend received: a stock, a month (YYYY-MM; a full date is fine) and the amount credited
export function sanitizeEntry(b = {}, today) {
  const stock = cleanName(b.stock); if (!stock) throw new Error("Which stock paid it?");
  const m = String(b.month || b.date || "").match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/); if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new Error("Pick the month it was received.");
  const month = `${m[1]}-${m[2]}`; if (month > today.slice(0, 7)) throw new Error("That month hasn't come yet.");
  const amount = money(b.amount); if (!(amount > 0) || amount > 1e9) throw new Error("Enter the amount received.");
  return { id: String(b.id || `dv${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`).slice(0, 40), stock, month, day: m[3] ? `${m[1]}-${m[2]}-${m[3]}` : null, amount: r2(amount), note: String(b.note || "").replace(/[<>]/g, "").trim().slice(0, 120) || null };
}

// A sheet pasted from Excel / Google Sheets: blocks that start with a header row "<year>  Jan Feb … Dec [Total]", then
// one row per stock with the amount under each month. Total rows, blank rows and the "who paid" lists are skipped.
export function parsePaste(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n").map(l => (l.includes("\t") ? l.split("\t") : l.split(/\s{2,}/)).map(c => c.trim()));
  const entries = [], years = new Set(), skipped = []; let year = null, cols = null;
  for (const c of lines) {
    if (!c.some(Boolean)) continue;
    const y = c[0].match(/^(19|20)\d{2}$/);
    if (y && c.slice(1).some(x => MONTH_RE.test(x))) { // a year's header row: which column is which month
      year = Number(c[0]); years.add(year); cols = new Map();
      c.forEach((x, i) => { const mm = x.match(MONTH_RE); if (i > 0 && mm) cols.set(i, MONTHS.findIndex(n => n.toLowerCase() === mm[1].toLowerCase()) + 1); });
      continue;
    }
    if (!year || !cols) continue;
    const name = c[0];
    if (!name) continue; // the "who paid" lists under the totals start with an empty first cell
    if (/^(total|grand total|sum)$/i.test(name)) continue;
    for (const [i, mo] of cols) {
      const v = money(c[i]); if (v === null || v === 0) continue;
      if (Number.isNaN(v) || v < 0) { skipped.push(`${name} ${MONTHS[mo - 1]} ${year}: "${c[i]}"`); continue; }
      entries.push({ stock: cleanName(name), month: `${year}-${String(mo).padStart(2, "0")}`, amount: r2(v) });
    }
  }
  return { entries, years: [...years].sort(), skipped: skipped.slice(0, 20) };
}

// entries → the grid for one year, and the comparison with the year before
// entries may include auto ones ({ auto: true }); shares(name) → shares held now (from your holdings) or null
export function ledgerView(entries = [], { year = null, today, shares = () => null } = {}) {
  const years = [...new Set(entries.map(e => Number(e.month.slice(0, 4))))].sort((a, b) => b - a);
  const Y = year && Number(year) ? Number(year) : years[0] || Number(today.slice(0, 4));
  // the display name for a stock: the spelling used most recently
  const names = new Map(); for (const e of [...entries].sort((a, b) => a.month.localeCompare(b.month))) names.set(stockKey(e.stock), e.stock);
  const grid = y => {
    const rows = new Map();
    for (const e of entries) {
      if (Number(e.month.slice(0, 4)) !== y) continue;
      const k = stockKey(e.stock), r = rows.get(k) || rows.set(k, { key: k, stock: names.get(k), months: Array.from({ length: 12 }, () => ({ amount: 0, ids: [], auto: 0, autos: [] })), total: 0, first: e.month }).get(k);
      const m = Number(e.month.slice(5, 7)) - 1; r.months[m].amount += e.amount; r.total += e.amount; if (e.month < r.first) r.first = e.month;
      if (e.auto) { r.months[m].auto += e.amount; r.months[m].autos.push({ id: e.id, symbol: e.symbol, amount: e.amount, perShare: e.perShare, qty: e.qty, exDate: e.exDate, approx: e.approx, expected: e.expected }); } else r.months[m].ids.push(e.id);
    }
    return rows;
  };
  const order = new Map(); entries.forEach((e, i) => { const k = stockKey(e.stock); if (!order.has(k)) order.set(k, i); });
  const cur = grid(Y), prev = grid(Y - 1);
  const rows = [...cur.values()].map(r => ({ ...r, total: r2(r.total), months: r.months.map(x => ({ amount: r2(x.amount), ids: x.ids, auto: r2(x.auto), autos: x.autos })), lastYear: prev.has(r.key) ? r2(prev.get(r.key).total) : null, shares: shares(r.stock) }))
    .sort((a, b) => order.get(a.key) - order.get(b.key)); // the order you keep them in (your sheet's order; new stocks at the end)
  // stocks that paid last year but not (yet) this year, so a missing dividend stands out
  const missing = [...prev.values()].filter(r => !cur.has(r.key)).map(r => ({ stock: names.get(r.key), lastYear: r2(r.total), months: r.months.map((x, i) => (x.amount ? MONTHS[i] : null)).filter(Boolean), shares: shares(names.get(r.key)) }));
  const monthTotals = MONTHS.map((_, i) => r2(rows.reduce((a, r) => a + r.months[i].amount, 0)));
  const prevMonthTotals = MONTHS.map((_, i) => r2([...prev.values()].reduce((a, r) => a + r.months[i].amount, 0)));
  const payers = MONTHS.map((_, i) => rows.filter(r => r.months[i].amount > 0).sort((a, b) => b.months[i].amount - a.months[i].amount).map(r => r.stock));
  const total = r2(monthTotals.reduce((a, x) => a + x, 0)), prevTotal = r2(prevMonthTotals.reduce((a, x) => a + x, 0));
  const isCur = Y === Number(today.slice(0, 4)), monthsSoFar = isCur ? Number(today.slice(5, 7)) : 12;
  const prevSamePeriod = r2(prevMonthTotals.slice(0, monthsSoFar).reduce((a, x) => a + x, 0));
  const best = monthTotals.reduce((b, x, i) => (x > b.amount ? { month: MONTHS[i], amount: x } : b), { month: null, amount: 0 });
  const top = [...rows].sort((a, b) => b.total - a.total).slice(0, 5).map(r => ({ stock: r.stock, total: r.total, share: total ? r0(r.total / total * 100) : 0 }));
  const allYears = years.map(y => ({ year: y, total: r2(entries.filter(e => Number(e.month.slice(0, 4)) === y).reduce((a, e) => a + e.amount, 0)) }));
  return { year: Y, years: allYears, rows, monthTotals, prevMonthTotals, payers, total, prevTotal, prevSamePeriod, isCurrent: isCur, monthsSoFar,
    growth: prevTotal && !isCur ? r2((total / prevTotal - 1) * 100) : prevSamePeriod && isCur ? r2((total / prevSamePeriod - 1) * 100) : null,
    perMonth: r0(total / (isCur ? Math.max(1, monthsSoFar) : 12)), best, top, missing, payersCount: rows.length, entries: entries.filter(e => !e.auto && Number(e.month.slice(0, 4)) === Y).length, autoCount: entries.filter(e => e.auto && Number(e.month.slice(0, 4)) === Y).length,
    autoTotal: r2(entries.filter(e => e.auto && Number(e.month.slice(0, 4)) === Y).reduce((a, e) => a + e.amount, 0)) };
}

// ---- Linking the names you write ("Infy", "HUL", "HERO") to your holdings (INFY, HINDUNILVR, HEROMOTOCO) ----
const ALIASES = { hul: "HINDUNILVR", infy: "INFY", ril: "RELIANCE", reliance: "RELIANCE", sbi: "SBIN", lt: "LT", lnt: "LT", mm: "M&M", mahindra: "M&M", airtel: "BHARTIARTL", bharti: "BHARTIARTL", hero: "HEROMOTOCO", hcl: "HCLTECH", bajfinance: "BAJFINANCE", bajajfinance: "BAJFINANCE", vbl: "VBL", ioc: "IOC", indianoil: "IOC", hdfcamc: "HDFCAMC", itc: "ITC", tcs: "TCS" };
// holdings: [{ symbol, name, qty }] → find(name) → that holding or null (exact symbol / name / alias first, then a single
// unambiguous prefix match)
export function holdingMatcher(holdings = []) {
  const H = holdings.filter(h => h.symbol).map(h => ({ ...h, sk: stockKey(h.symbol), nk: stockKey(h.name || "") }));
  return name => {
    const k = stockKey(name); if (!k) return null;
    const a = ALIASES[k]; if (a) { const h = H.find(x => x.symbol === a); if (h) return h; }
    const exact = H.find(x => x.sk === k || x.nk === k); if (exact) return exact;
    if (k.length < 3) return null;
    const pre = H.filter(x => x.sk.startsWith(k) || x.nk.startsWith(k) || (x.sk.length >= 3 && k.startsWith(x.sk)));
    return pre.length === 1 ? pre[0] : null;
  };
}
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const CREDIT_LAG_DAYS = 21; // a dividend usually reaches the bank within ~3 weeks of the record / ex-date

// Dividends your holdings earned (shares held on the ex-date × dividend per share) that aren't in the grid yet, put in
// the month they're likely credited. received: dividendsReceived() rows [{ symbol, exDate, amount, qty, income, approx }];
// entries: what's recorded; rowName(symbol) → the name the grid already uses for that stock (so it lands in that row)
export function autoCredits({ received = [], entries = [], rowName = s => s, from, today, dismissed = [] } = {}) {
  const skip = new Set(dismissed), confirmed = new Set(entries.map(e => e.fromAuto).filter(Boolean)), out = [];
  const curMonth = today.slice(0, 7);
  for (const d of received) {
    if (!(d.income > 0) || d.exDate < from || d.exDate > today) continue;
    const id = `auto:${d.symbol}:${d.exDate}`; if (skip.has(id) || confirmed.has(id)) continue;
    const credit = addDays(d.exDate, CREDIT_LAG_DAYS), month = (credit > today ? today : credit).slice(0, 7);
    const stock = rowName(d.symbol), k = stockKey(stock);
    // already recorded by hand for that stock in that month or the next / previous one: don't add it twice
    const near = entries.some(e => !e.auto && stockKey(e.stock) === k && Math.abs((Number(e.month.slice(0, 4)) * 12 + Number(e.month.slice(5, 7))) - (Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)))) <= 1 && e.month >= d.exDate.slice(0, 7));
    if (near) continue;
    out.push({ id, auto: true, stock, symbol: d.symbol, month: month > curMonth ? curMonth : month, amount: r2(d.income), perShare: d.amount, qty: d.qty, exDate: d.exDate, approx: !!d.approx, expected: credit > today });
  }
  return out;
}

// ---- Dividends for income tax: one financial year (April to March) of the ledger ----
// Dividends are taxed at your slab rate on the gross amount (before TDS). A company deducts 10% TDS when it pays you
// more than the threshold in a year (₹5,000; ₹10,000 from FY 2025-26). What you record is what reached the bank (after
// TDS), so a stock above the threshold is grossed up (credited ÷ 0.9). Auto-added credits are already gross (shares ×
// dividend per share). entries: ledger entries plus auto ones; fy: { label, from: "YYYY-04-01", to: "YYYY-03-31" }
export const DIV_TDS_RATE = 0.1;
export const divTdsThreshold = fyStartYear => (fyStartYear >= 2025 ? 10000 : 5000);
export function fyDividends(entries = [], { fy } = {}) {
  const from = fy.from.slice(0, 7), to = fy.to.slice(0, 7), limit = divTdsThreshold(Number(fy.from.slice(0, 4)));
  const by = new Map();
  for (const e of entries) {
    if (!(e.amount > 0) || e.month < from || e.month > to) continue;
    const k = stockKey(e.stock), g = by.get(k) || by.set(k, { stock: e.stock, credited: 0, autoGross: 0, n: 0, auto: 0, months: new Set() }).get(k);
    if (e.auto) { g.autoGross += e.amount; g.auto++; } else g.credited += e.amount;
    g.n++; g.months.add(e.month);
  }
  const stocks = [...by.values()].map(g => {
    const grossIfTds = g.autoGross + g.credited / (1 - DIV_TDS_RATE), tdsCut = grossIfTds > limit;
    const gross = tdsCut ? grossIfTds : g.autoGross + g.credited;
    return { stock: g.stock, credited: r2(g.credited), estimated: r2(g.autoGross), gross: r2(gross), tds: tdsCut ? r2(gross * DIV_TDS_RATE) : 0, n: g.n, auto: g.auto, months: [...g.months].sort() };
  }).sort((a, b) => b.gross - a.gross);
  const sum = k => r2(stocks.reduce((a, s) => a + s[k], 0));
  return { fy: fy.label, from: fy.from, to: fy.to, stocks, credited: sum("credited"), estimated: sum("estimated"), gross: sum("gross"), tds: sum("tds"), count: stocks.reduce((a, s) => a + s.n, 0), autoCount: stocks.reduce((a, s) => a + s.auto, 0), tdsLimit: limit };
}
