// NSE end-of-day data: the official daily price file ("bhavcopy", every listed stock's open/high/low/close/volume) and
// the daily index closes (Nifty 50, Smallcap 250… with their P/E). Both are plain CSV files on NSE's archive server,
// published around 18:00 IST, and far less rate-limited than any live quote API. Pure parsers + small fetch helpers.
import { NSE_ARCHIVE_BASE } from "./nse.mjs";

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MON = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
const num = v => { const x = Number(String(v ?? "").replace(/[,\s]/g, "")); return Number.isFinite(x) && String(v ?? "").trim() !== "" && String(v).trim() !== "-" ? x : null; };
const dd = n => String(n).padStart(2, "0");
// "16-Oct-2026" or "16-10-2026" or "2026-10-16" → "2026-10-16"
export function eodDay(s) {
  const t = String(s || "").trim(); let m;
  if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = t.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})/)) && m[2].toUpperCase() in MON) return `${m[3]}-${dd(MON[m[2].toUpperCase()] + 1)}-${dd(m[1])}`;
  if ((m = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/))) return `${m[3]}-${dd(m[2])}-${dd(m[1])}`;
  return null;
}
export const dayToT = day => Math.floor(Date.parse(`${day}T10:00:00Z`) / 1000); // 15:30 IST ≈ 10:00 UTC
function csvRows(text) { return String(text || "").replace(/\r/g, "").split("\n").filter(l => l.trim()).map(l => { const out = []; let cur = "", q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === "," && !q) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out.map(x => x.trim()); }); }

// sec_bhavdata_full_DDMMYYYY.csv: SYMBOL, SERIES, DATE1, PREV_CLOSE, OPEN_PRICE, HIGH_PRICE, LOW_PRICE, LAST_PRICE, CLOSE_PRICE, …, TTL_TRD_QNTY, …, DELIV_PER
// Also accepts the newer UDiFF layout (TckrSymb, SctySrs, TradDt, ClsPric, HghPric, LwPric, PrvsClsgPric, TtlTradgVol).
export function parseBhavcopy(text) {
  const rows = csvRows(text); if (!rows.length) return { day: null, rows: [] };
  const h = rows[0].map(x => x.toUpperCase()), col = (...names) => names.map(n => h.indexOf(n)).find(i => i >= 0) ?? -1;
  const c = { sym: col("SYMBOL", "TCKRSYMB"), ser: col("SERIES", "SCTYSRS"), date: col("DATE1", "TRADDT", "TIMESTAMP"), prev: col("PREV_CLOSE", "PRVSCLSGPRIC", "PREVCLOSE"), open: col("OPEN_PRICE", "OPNPRIC", "OPEN"), high: col("HIGH_PRICE", "HGHPRIC", "HIGH"), low: col("LOW_PRICE", "LWPRIC", "LOW"), close: col("CLOSE_PRICE", "CLSPRIC", "CLOSE"), vol: col("TTL_TRD_QNTY", "TTLTRADGVOL", "TOTTRDQTY"), deliv: col("DELIV_PER") };
  if (c.sym < 0 || c.close < 0) throw new Error("not a bhavcopy file (no SYMBOL / CLOSE_PRICE columns)");
  const out = []; let day = null;
  for (const r of rows.slice(1)) {
    const series = c.ser >= 0 ? r[c.ser].toUpperCase() : "EQ";
    if (!["EQ", "BE", "BZ", "SM", "ST"].includes(series)) continue; // equity series only (ETFs trade as EQ)
    const close = num(r[c.close]); if (!(close > 0)) continue;
    const d = c.date >= 0 ? eodDay(r[c.date]) : null; if (d) day = day || d;
    out.push({ symbol: r[c.sym].toUpperCase(), series, close, prev: num(r[c.prev]), open: num(r[c.open]), high: num(r[c.high]), low: num(r[c.low]), volume: num(r[c.vol]), delivPct: c.deliv >= 0 ? num(r[c.deliv]) : null });
  }
  return { day, rows: out };
}
// ind_close_all_DDMMYYYY.csv: Index Name, Index Date, Open/High/Low/Closing Index Value, …, P/E, P/B, Div Yield
export function parseIndexCloses(text) {
  const rows = csvRows(text); if (!rows.length) return { day: null, rows: [] };
  const h = rows[0].map(x => x.toLowerCase()), f = re => h.findIndex(x => re.test(x));
  const c = { name: f(/^index name/), date: f(/^index date/), close: f(/^closing/), pe: f(/^p\/e/), pb: f(/^p\/b/), dy: f(/^div/) };
  if (c.name < 0 || c.close < 0) throw new Error("not an index-close file");
  const out = []; let day = null;
  for (const r of rows.slice(1)) { const close = num(r[c.close]); if (!(close > 0)) continue; const d = eodDay(r[c.date]); day = day || d; out.push({ name: r[c.name], close, pe: num(r[c.pe]), pb: num(r[c.pb]), dy: num(r[c.dy]) }); }
  return { day, rows: out };
}
const ddmmyyyy = day => { const [y, m, d] = day.split("-"); return `${d}${m}${y}`; };
async function getText(url, fetchImpl) {
  const r = await fetchImpl(url, { headers: { "User-Agent": UA, Accept: "text/csv,*/*", Referer: "https://www.nseindia.com/" }, signal: AbortSignal.timeout(30000) });
  if (r.status === 404) return null; // not published (holiday / not yet)
  if (r.status === 403 || r.status === 429) { const e = new Error(`NSE archives HTTP ${r.status}`); e.rateLimited = true; throw e; }
  if (!r.ok) throw new Error(`NSE archives HTTP ${r.status}`);
  const t = await r.text(); return /<html/i.test(t.slice(0, 200)) ? null : t;
}
export async function fetchBhavcopy(day, { fetchImpl = fetch } = {}) { const t = await getText(`${NSE_ARCHIVE_BASE()}/products/content/sec_bhavdata_full_${ddmmyyyy(day)}.csv`, fetchImpl); return t ? parseBhavcopy(t) : null; }
export async function fetchIndexCloses(day, { fetchImpl = fetch } = {}) { const t = await getText(`${NSE_ARCHIVE_BASE()}/content/indices/ind_close_all_${ddmmyyyy(day)}.csv`, fetchImpl); return t ? parseIndexCloses(t) : null; }

// Merge bars (oldest first, one per day), newest wins on the same day; keep at most `keep` bars.
export function mergeBars(old = [], add = [], keep = 1400) {
  const m = new Map(); for (const b of old) if (b?.t && b.c > 0) m.set(b.t, b); for (const b of add) if (b?.t && b.c > 0) m.set(b.t, b);
  return [...m.values()].sort((a, b) => a.t - b.t).slice(-keep);
}
// Weekdays going back from a day (NSE holidays simply return no file)
export function weekdaysBack(fromDay, n) { const out = []; const d = new Date(`${fromDay}T12:00:00Z`); while (out.length < n) { const w = d.getUTCDay(); if (w !== 0 && w !== 6) out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() - 1); } return out; }
export const INDEX_KEYS = { "NIFTY 50": "NIFTY50", "NIFTY SMALLCAP 250": "SMALLCAP250", "NIFTY MIDCAP 150": "MIDCAP150", "NIFTY 500": "NIFTY500", "NIFTY NEXT 50": "NEXT50", "NIFTY BANK": "BANKNIFTY", "NIFTY IT": "NIFTYIT" };
