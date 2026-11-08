// Diwali Muhurat picks: stocks bought each year in the Muhurat session to hold for 10–20 years, tracked year by year at
// today's price: value, gain, CAGR (once a pick is a year old), how each year's batch compares with Nifty from the same
// day, and the XIRR of all years together. Entries are made by hand; nothing is ever sold here. Pure functions.
import { xirr } from "./returns.mjs";

// Muhurat session dates (NSE). Used as the default buy date of a year; any year's date can be changed.
export const MUHURAT_DATES = Object.freeze({ 2016: "2016-10-30", 2017: "2017-10-19", 2018: "2018-11-07", 2019: "2019-10-27", 2020: "2020-11-14", 2021: "2021-11-04", 2022: "2022-10-24", 2023: "2023-11-12", 2024: "2024-11-01", 2025: "2025-10-21", 2026: "2026-11-08" });
const fin = v => Number.isFinite(v), r0 = v => Math.round(v || 0), r2 = v => Math.round(v * 100) / 100, r1 = v => Math.round(v * 10) / 10;
const DAY = 864e5, yearsBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / (365.25 * DAY);
// CAGR only once something has been held a year: annualising a few weeks' move gives silly numbers
export const cagr = (start, end, years) => (start > 0 && end > 0 && years >= 1 ? r2((Math.pow(end / start, 1 / years) - 1) * 100) : null);
const doubling = c => (fin(c) && c > 0 ? r1(Math.log(2) / Math.log(1 + c / 100)) : null);
const plusYear = d => { const x = new Date(`${d}T00:00:00Z`); x.setUTCFullYear(x.getUTCFullYear() + 1); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };

export function sanitizePick(b = {}, { today, years = {} } = {}) {
  const year = Math.round(Number(b.year)); if (!(year >= 1990 && year <= Number(today.slice(0, 4)))) throw new Error("Pick the Muhurat year.");
  const symbol = String(b.symbol || "").trim().toUpperCase().replace(/^(NSE|BSE):/, ""); if (!/^[A-Z0-9&-]{1,20}$/.test(symbol)) throw new Error("Enter the NSE symbol, e.g. INFY.");
  const qty = Number(String(b.qty ?? "").replace(/,/g, "")), price = Number(String(b.price ?? "").replace(/[,₹\s]/g, ""));
  if (!(qty > 0 && qty <= 1e7)) throw new Error("Enter the quantity."); if (!(price > 0 && price <= 1e7)) throw new Error("Enter the buy price.");
  const date = String(b.date || years[year]?.date || MUHURAT_DATES[year] || `${year}-11-01`).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) throw new Error("Pick the buy date (not in the future).");
  const note = String(b.note || "").replace(/[<>]/g, "").trim().slice(0, 140) || null;
  return { id: String(b.id || `mh${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`).slice(0, 40), year, symbol, qty, price, date, note };
}
export function sanitizeYear(b = {}, today) {
  const year = Math.round(Number(b.year)); if (!(year >= 1990 && year <= Number(today.slice(0, 4)))) throw new Error("Pick the year.");
  const out = {};
  if (b.date !== undefined && b.date !== "") { const d = String(b.date).slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d > today) throw new Error("Pick the Muhurat date."); out.date = d; }
  if (b.niftyThen !== undefined && b.niftyThen !== "") { const n = Number(String(b.niftyThen).replace(/[,₹\s]/g, "")); if (!(n > 0)) throw new Error("Enter NIFTYBEES's price on that day."); out.niftyThen = n; }
  if (b.budget !== undefined && b.budget !== "") { const n = Number(String(b.budget).replace(/[,₹\s]/g, "")); if (!(n >= 0)) throw new Error("Enter the amount."); out.budget = Math.round(n); }
  return { year, ...out };
}

// picks: saved entries; years: { [year]: { date, niftyThen, budget } }; price(symbol) → { price, asOf } | null;
// niftyNow: NIFTYBEES today; niftyOn(day) → NIFTYBEES close on that day (from saved history) | null; names: symbol → name
export function muhuratView({ picks = [], years = {}, price = () => null, niftyNow = null, niftyOn = () => null, names = new Map(), today } = {}) {
  const ys = [...new Set([...picks.map(p => p.year), ...Object.keys(years).map(Number)])].sort((a, b) => b - a);
  const flows = [], allRows = [];
  const yearRows = ys.map(year => {
    const cfg = years[year] || {}, date = cfg.date || MUHURAT_DATES[year] || null;
    const rows = picks.filter(p => p.year === year).map(p => {
      const q = price(p.symbol), now = fin(q?.price) ? q.price : null, invested = p.qty * p.price, value = now !== null ? p.qty * now : null, yrs = yearsBetween(p.date, today);
      const row = { ...p, name: names.get(p.symbol) || null, invested: r0(invested), now, asOf: q?.asOf || null, value: value === null ? null : r0(value), gain: value === null ? null : r0(value - invested),
        absPct: value === null ? null : r2((value / invested - 1) * 100), heldYears: r1(Math.max(0, yrs)), cagr: value === null ? null : cagr(invested, value, yrs), longFrom: plusYear(p.date) };
      row.doubleIn = doubling(row.cagr);
      flows.push({ date: p.date, amount: -invested }); allRows.push(row);
      return row;
    }).sort((a, b) => (b.value ?? b.invested) - (a.value ?? a.invested));
    const invested = rows.reduce((a, r) => a + r.invested, 0), priced = rows.filter(r => r.value !== null), value = priced.length === rows.length ? rows.reduce((a, r) => a + r.value, 0) : null;
    const start = rows.length ? rows.reduce((a, r) => (r.date < a ? r.date : a), rows[0].date) : date, yrs = start ? yearsBetween(start, today) : 0;
    // the same money in Nifty (NIFTYBEES) from the same day
    const nThen = cfg.niftyThen || (date ? niftyOn(date) : null), nAbs = nThen && niftyNow ? r2((niftyNow / nThen - 1) * 100) : null, nCagr = nThen && niftyNow ? cagr(nThen, niftyNow, yrs) : null;
    const yCagr = value !== null ? cagr(invested, value, yrs) : null;
    return { year, date, budget: cfg.budget ?? null, picks: rows, invested: r0(invested), value: value === null ? null : r0(value), gain: value === null ? null : r0(value - invested), absPct: value === null || !invested ? null : r2((value / invested - 1) * 100),
      cagr: yCagr, heldYears: r1(Math.max(0, yrs)), doubleIn: doubling(yCagr), unpriced: rows.length - priced.length,
      nifty: { then: nThen ? r2(nThen) : null, thenFrom: cfg.niftyThen ? "you" : nThen ? "history" : null, now: niftyNow ? r2(niftyNow) : null, absPct: nAbs, cagr: nCagr, ifInvested: nThen && niftyNow && invested ? r0(invested * niftyNow / nThen) : null },
      vsNifty: yCagr !== null && nCagr !== null ? r2(yCagr - nCagr) : value !== null && nAbs !== null && invested ? r2((value / invested - 1) * 100 - nAbs) : null };
  });
  const invested = allRows.reduce((a, r) => a + r.invested, 0), allPriced = allRows.every(r => r.value !== null), value = allPriced ? allRows.reduce((a, r) => a + r.value, 0) : null;
  const firstDay = allRows.length ? allRows.reduce((a, r) => (r.date < a ? r.date : a), allRows[0].date) : null;
  const x = value !== null && allRows.length ? xirr([...flows, { date: today, amount: value }]) : null;
  const xr = x !== null && firstDay && yearsBetween(firstDay, today) >= 1 ? r2(x * 100) : null;
  const best = allRows.filter(r => r.cagr !== null).sort((a, b) => b.cagr - a.cagr)[0] || null;
  const winners = allRows.filter(r => r.gain > 0).length;
  return { today, years: yearRows, all: { invested: r0(invested), value: value === null ? null : r0(value), gain: value === null ? null : r0(value - invested), absPct: value === null || !invested ? null : r2((value / invested - 1) * 100),
    xirr: xr, doubleIn: doubling(xr), picks: allRows.length, winners, years: yearRows.filter(y => y.picks.length).length, firstDay,
    best: best ? { symbol: best.symbol, year: best.year, cagr: best.cagr } : null, unpriced: allRows.filter(r => r.value === null).length },
    suggestYear: Number(today.slice(0, 4)), muhuratToday: Object.values(MUHURAT_DATES).includes(today) };
}

// ---- Muhurat watchlist: stocks you're considering for the next Diwali ----
export function sanitizeWatch(b = {}, { today, price = null } = {}) {
  const symbol = String(b.symbol || "").trim().toUpperCase().replace(/^(NSE|BSE):/, ""); if (!/^[A-Z0-9&-]{1,20}$/.test(symbol)) throw new Error("Enter the NSE symbol, e.g. INFY.");
  const num = (v, what) => { if (v === undefined || v === null || String(v).trim() === "") return null; const n = Number(String(v).replace(/[,₹\s]/g, "")); if (!(n > 0 && n <= 1e10)) throw new Error(`Enter a valid ${what}.`); return n; };
  return { id: String(b.id || `mw${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`).slice(0, 40), symbol, target: num(b.target, "buy-below price"), amount: num(b.amount, "planned amount"),
    note: String(b.note || "").replace(/[<>]/g, "").trim().slice(0, 140) || null, addedOn: String(b.addedOn || today).slice(0, 10), addedPrice: Number.isFinite(b.addedPrice) ? b.addedPrice : price };
}
// watch: saved entries; price(symbol) → { price } | null; range(symbol) → { high52, low52 } | null; verdict(symbol) →
// { status, zoneLow, zoneHigh } from the main watchlist's valuation | null; names: symbol → name; nextDate: next Muhurat
export function muhuratWatchView({ watch = [], price = () => null, range = () => null, verdict = () => null, names = new Map(), nextDate = null, today } = {}) {
  const rows = watch.map(w => {
    const now = price(w.symbol)?.price ?? null, R = range(w.symbol) || {}, V = verdict(w.symbol);
    const toTarget = w.target && now ? r2((now / w.target - 1) * 100) : null;
    return { ...w, name: names.get(w.symbol) || null, now, sinceAdded: w.addedPrice && now ? r2((now / w.addedPrice - 1) * 100) : null, toTarget, atTarget: w.target && now ? now <= w.target : false,
      offHigh: R.high52 && now ? r2((1 - now / R.high52) * 100) : null, high52: R.high52 ?? null, low52: R.low52 ?? null,
      qtyAtNow: w.amount && now ? Math.floor(w.amount / now) : null, verdict: V ? { status: V.status || null, zoneLow: V.zoneLow ?? null, zoneHigh: V.zoneHigh ?? null, inZone: now && V.zoneHigh ? now <= V.zoneHigh : null } : null };
  }).sort((a, b) => (b.atTarget - a.atTarget) || ((a.toTarget ?? 999) - (b.toTarget ?? 999)) || a.symbol.localeCompare(b.symbol));
  const planned = rows.reduce((a, r) => a + (r.amount || 0), 0);
  return { rows, planned: r0(planned), atTarget: rows.filter(r => r.atTarget).length, nextDate, daysToNext: nextDate ? Math.max(0, Math.round((Date.parse(nextDate) - Date.parse(today)) / DAY)) : null };
}
