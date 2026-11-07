// Brokers' own tax P&L reports (Zerodha Console "Tax P&L", INDmoney "Consolidated tax report", or a simple sheet of
// sales) → one shape the combined P&L understands. The broker's figures are used as they are: its FIFO, grandfathering
// (FMV on 31 Jan 2018), expenses and categories. PAN and the client's name are never stored: the PAN only becomes a
// one-way key (panKey) so reports of the same person can be grouped; folio numbers are dropped. Pure functions.
import { createHash } from "node:crypto";
import { fyOf } from "./tax.mjs";

// Tax buckets: intraday (speculative, slab rate), eqSt (listed equity / equity funds held ≤ 12 months: 20%), eqLt
// (> 12 months: 12.5% above ₹1.25 L per person), neSt (other assets short term: slab rate, e.g. debt ETFs and funds,
// gold ETFs held ≤ 12 months, US stocks held ≤ 24 months), neLt (other assets long term: 12.5%, no exemption).
export const BUCKETS = Object.freeze(["intraday", "eqSt", "eqLt", "neSt", "neLt"]);

const clean = s => String(s ?? "").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/\s+/g, " ").trim();
const num = v => { const s = clean(v).replace(/[,₹\s]/g, ""); if (!s || s === "-") return null; const x = Number(s); return Number.isFinite(x) ? x : null; };
const r2 = v => Math.round(v * 100) / 100;
// "2026-07-16", "16/07/2026", "16-Jul-2026" or an Excel day number
export function dayOf(v) {
  const s = clean(v); if (!s || s === "-") return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[- ]([A-Za-z]{3})[a-z]*[- ,]+(\d{4})$/); if (m) { const mo = "janfebmaraprmayjunjulaugsepoctnovdec".indexOf(m[2].toLowerCase()) / 3 + 1; if (mo > 0) return `${m[3]}-${String(mo).padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  if (/^\d{5}(\.\d+)?$/.test(s)) return new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 864e5).toISOString().slice(0, 10);
  return null;
}
export const panKey = pan => { const p = clean(pan).toUpperCase(); return /^[A-Z]{5}\d{4}[A-Z]$/.test(p) ? createHash("sha256").update(`ew-pan:${p}`).digest("hex").slice(0, 16) : null; };
const firstName = n => { const w = clean(n).split(" ").filter(Boolean)[0] || ""; return w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : null; };
const isIsin = s => /^IN[EF][A-Z0-9]{8}\d$|^[A-Z]{2}[A-Z0-9]{9}\d$/.test(clean(s));

export function detectTaxReport(tables = []) {
  const names = tables.map(t => clean(t.name).toLowerCase()), text = t => t.rows.slice(0, 12).map(r => r.map(clean).join(" ")).join(" ");
  if (names.some(n => n.startsWith("tradewise exits")) || tables.some(t => /taxpnl statement|tradewise exits from/i.test(text(t)))) return "zerodha";
  if (names.includes("ltcg") && names.includes("stcg") && tables.some(t => /client pan:|tax year:/i.test(text(t)))) return "indmoney";
  if (tables.some(t => /realised profit and loss report/i.test(text(t)) && t.rows.some(r => r.map(clean).includes("Security Name") && r.map(clean).some(c => /^realised p&l$/i.test(c))))) return "dhan";
  return null;
}

// Find "label" rows in the first column(s): { label → value in the next non-empty cell }
const labelled = rows => { const m = new Map(); for (const r of rows) { const c = r.map(clean), i = c.findIndex(Boolean); if (i < 0) continue; const v = c.slice(i + 1).find(x => x !== ""); if (v !== undefined && !m.has(c[i].toLowerCase())) m.set(c[i].toLowerCase(), v); } return m; };
const who = tables => { for (const t of tables) { const L = labelled(t.rows.slice(0, 12)); const pan = L.get("pan") || L.get("client pan:"); if (pan) return { pan, name: L.get("client name") || L.get("client name:") || null, clientId: L.get("client id") || null }; } return {}; };

// ---- Zerodha Console → Reports → Tax P&L (xlsx) ----
const ZERODHA_SECTIONS = [[/^equity - intraday/i, "intraday", "stock"], [/^equity - short term/i, "eqSt", "stock"], [/^equity - long term/i, "eqLt", "stock"], [/^equity - buyback/i, "buyback", "stock"],
  [/^debt etf/i, "neSt", "debt"], [/^non equity short term/i, "neSt", "etf"], [/^non equity long term/i, "neLt", "etf"], [/^mutual funds?$/i, "mf", "mf"]];
export function parseZerodhaTaxPnl(tables) {
  const W = who(tables), tw = tables.find(t => /^tradewise exits/i.test(clean(t.name))) || tables[0];
  const rows = [], skipped = { fno: 0, buyback: 0, other: 0 }; let cat = null, kind = null, H = null, from = null, to = null;
  for (const r of tw.rows) {
    const c = r.map(clean), first = c.find(Boolean) || "";
    const span = first.match(/tradewise exits from (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/i); if (span) { from = span[1]; to = span[2]; continue; }
    if (c.filter(Boolean).length === 1) { const s = ZERODHA_SECTIONS.find(([re]) => re.test(first)); cat = s ? s[1] : /f&o|currency|commodity/i.test(first) ? "fno" : null; kind = s ? s[2] : null; H = null; continue; }
    if (first === "Symbol") { H = Object.fromEntries(c.map((h, i) => [h.toLowerCase(), i]).filter(([h]) => h)); continue; }
    if (!cat || !H) continue;
    if (cat === "fno") { skipped.fno++; continue; }
    const g = k => c[H[k]], sell = num(g("sell value")), buy = num(g("buy value")), profit = num(g("profit")), sellDate = dayOf(g("exit date"));
    if (!sellDate || sell === null) continue;
    if (cat === "buyback") { skipped.buyback++; continue; }
    const days = num(g("period of holding")), taxable = num(g("taxable profit")) ?? profit;
    const chargeCols = ["brokerage", "exchange transaction charges", "ipft", "sebi charges", "cgst", "sgst", "igst", "stamp duty"].map(k => num(g(k)) || 0), stt = num(g("stt")) || 0;
    const bucket = cat === "mf" ? (days > 365 ? "eqLt" : "eqSt") : cat;
    rows.push({ bucket, kind, name: g("symbol"), symbol: kind === "mf" ? null : g("symbol"), isin: isIsin(g("isin")) ? g("isin") : null, buyDate: dayOf(g("entry date")), sellDate, qty: num(g("quantity")),
      buyValue: buy, sellValue: sell, gain: profit ?? (sell - buy), taxable, charges: r2(chargeCols.reduce((a, x) => a + x, 0) + stt), stt: r2(stt), days });
  }
  // other income: dividends, F&O profit (business income), from their own sheets
  const other = { dividends: 0, interest: 0, fno: 0 };
  for (const t of tables) {
    const L = labelled(t.rows), n = clean(t.name).toLowerCase();
    if (/dividend/.test(n)) { other.dividends += num(L.get("total dividend amount")) || 0; other.interest += num(L.get("total interest amount")) || 0; }
    if (/^(f&o|currency|commodity)$/.test(n)) other.fno += (num(L.get("options realized profit")) || 0) + (num(L.get("futures realized profit")) || 0);
  }
  const fy = fyOf(from || rows[0]?.sellDate || "2026-04-01");
  return { broker: "Zerodha", source: "zerodha", clientId: W.clientId ? clean(W.clientId).toUpperCase() : null, holderName: firstName(W.name), panKey: panKey(W.pan), fy: fy.label, from: from || fy.from, to: to || rows.reduce((a, x) => (x.sellDate > a ? x.sellDate : a), fy.from),
    coverage: { stocks: "own", mf: "own" }, rows, other: roundAll(other), skipped };
}

// ---- INDmoney → Reports → Consolidated tax report (xlsx) ----
const IND_TABLES = [[/^indian stocks$/i, "stock"], [/^equity etfs$/i, "etf"], [/^equity mutual funds$/i, "mf"], [/^us stocks$/i, "us"], [/^non - ?equity etfs$/i, "etf"], [/^non - ?equity mutual funds$/i, "mf"], [/^rights entitlements$/i, "rights"]];
export function parseIndmoneyTax(tables) {
  const W = who(tables), rows = [], skipped = { buyback: 0, other: 0 }, coverage = { stocks: "own", mf: "own" };
  let year = null;
  for (const t of tables) { const L = labelled(t.rows.slice(0, 8)); const y = L.get("tax year:"); if (y) { year = y; break; } }
  for (const t of tables) for (const r of t.rows.slice(0, 14)) { const c = r.map(clean).filter(Boolean); if (/^mutual funds$/i.test(c[0] || "") && /all brokers/i.test(c[1] || "")) coverage.mf = "all"; }
  for (const sheet of ["LTCG", "STCG"]) {
    const t = tables.find(x => clean(x.name).toUpperCase() === sheet); if (!t) continue;
    const long = sheet === "LTCG"; let group = null, kind = null, H = null, sub = null;
    for (let i = 0; i < t.rows.length; i++) {
      const c = t.rows[i].map(clean), filled = c.filter(Boolean), first = filled[0] || "";
      if (/^(L|S)TCG - Equity$/i.test(first)) { group = "eq"; continue; }
      if (/^(L|S)TCG - Non - ?Equity$/i.test(first)) { group = "ne"; continue; }
      if (/^(L|S)TCG - Buyback$/i.test(first)) { group = "buyback"; continue; }
      if (/^notes:?$/i.test(first)) { group = null; continue; }
      if (filled.length === 1) { const m = IND_TABLES.find(([re]) => re.test(first)); if (m) { kind = m[1]; H = null; } continue; }
      if (/^name of/i.test(first)) { H = c; sub = (t.rows[i + 1] || []).map(clean); continue; }
      if (!group || !H || /^total$/i.test(first)) continue;
      const col = name => H.findIndex(h => h.toLowerCase().startsWith(name));
      const nameI = col("name of"), sellDate = dayOf(c[col("redemption date")] ?? c[col("sell date")]);
      if (!sellDate || !c[nameI] || c[nameI] === "-") continue;
      if (group === "buyback") { skipped.buyback++; continue; }
      const totalI = col("total"), inrI = col("total (in inr)"), expI = col("expense (in inr)") >= 0 ? col("expense (in inr)") : col("expense");
      const sellValue = num(c[inrI >= 0 ? inrI : totalI]), buyValue = num(c[(inrI >= 0 ? inrI : totalI) + 1]);
      const taxI = H.findIndex(h => /^taxable gains/i.test(h)), taxable = num(c[taxI]), grossI = col("gross gains"), gross = grossI >= 0 ? num(c[grossI]) : null;
      const exp = expI >= 0 ? (num(c[expI]) || 0) + (inrI >= 0 ? (num(c[expI + 1]) || 0) : 0) : 0;
      const mfCat = col("mutual fund category") >= 0 ? c[col("mutual fund category")] : "";
      const bucket = group === "eq" ? (long ? "eqLt" : "eqSt") : (long && !/specified/i.test(mfCat) ? "neLt" : "neSt");
      const isinI = col("isin"), qtyI = H.findIndex(h => /^(units sold|qty sold|qty|units)$/i.test(h));
      rows.push({ bucket, kind, name: c[nameI], symbol: null, isin: isinI >= 0 && isIsin(c[isinI]) ? c[isinI] : null,
        buyDate: dayOf(c[col("purchase date")]), sellDate, qty: num(c[qtyI]), buyValue, sellValue, gain: gross ?? taxable, taxable, charges: r2(exp), stt: null, broker: kind === "us" ? c[col("broker name")] || null : null });
    }
    void sub;
  }
  const other = { dividends: 0, interest: 0, fno: 0, intraday: 0 };
  const sheetL = n => { const t = tables.find(x => clean(x.name).toLowerCase() === n); return t ? labelled(t.rows) : new Map(); };
  other.dividends = num(sheetL("dividend").get("total")) || 0;
  other.interest = num(sheetL("interest").get("total interest received from us stocks")) || 0;
  { const t = tables.find(x => clean(x.name).toLowerCase() === "f&o"); const tot = t?.rows.map(r => r.map(clean).filter(Boolean)).find(c => /^total$/i.test(c[0]) && c.length >= 4); other.fno = tot ? num(tot[3]) || 0 : 0; }
  other.intraday = num(sheetL("intraday").get("taxable gains/losses (a - b)")) || 0;
  const start = Number(String(year || "").match(/(\d{4})/)?.[1]) || Number((rows[0]?.sellDate || "2026-04-01").slice(0, 4)), fy = fyOf(`${start}-06-01`);
  // INDmoney's intraday trades: only a total here (the table rows are per trade without a buy date); kept as one row
  if (other.intraday) rows.push({ bucket: "intraday", kind: "stock", name: "Intraday (INDmoney total)", symbol: null, isin: null, buyDate: null, sellDate: fy.from, qty: null, buyValue: null, sellValue: null, gain: other.intraday, taxable: other.intraday, charges: 0, stt: null, summaryOnly: true });
  const to = rows.reduce((a, x) => (x.sellDate > a ? x.sellDate : a), fy.from);
  return { broker: "INDmoney", source: "indmoney", clientId: null, holderName: firstName(W.name), panKey: panKey(W.pan), fy: fy.label, from: fy.from, to, coverage, rows, other: roundAll({ dividends: other.dividends, interest: other.interest, fno: other.fno }), skipped };
}
// ---- Dhan → Reports → Realised P&L (xls): one line per stock for the chosen period, FIFO, no dates. The charges of the
// whole segment are shared across the stocks by turnover. Without buy dates the term isn't known: the combined view
// works it out from your Dhan trades on file, else counts it as short term (you can mark a stock long term).
export function parseDhanPnl(tables, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const t = tables.find(x => x.rows.some(r => r.map(clean).includes("Security Name"))) || tables[0];
  const rows = [], skipped = { fno: 0, other: 0 }; let seg = null, H = null, generated = null, charges = null, turnover = 0;
  for (const r of t.rows) {
    const c = r.map(clean), filled = c.filter(Boolean), first = filled[0] || "";
    const g = filled.join(" ").match(/generated on (\d{2})-(\d{2})-(\d{4})/i); if (g) generated = `${g[3]}-${g[2]}-${g[1]}`;
    if (/^equity$/i.test(c[0]) && charges === null) { const hi = t.rows.find(x => x.map(clean).includes("Total Charges")); const ci = hi ? hi.map(clean).indexOf("Total Charges") : -1; charges = ci >= 0 ? num(c[ci]) : null; }
    if (filled.length === 1 && /segment$/i.test(first)) { seg = /^equity/i.test(first) ? "eq" : "other"; H = null; continue; }
    if (c.includes("Security Name")) { H = c; continue; }
    if (!H || !seg || !/^\d+$/.test(c[0])) continue;
    if (seg !== "eq") { skipped.fno++; continue; }
    const col = n => H.indexOf(n), buyValue = num(c[col("Buy Value")]), sellValue = num(c[col("Sell Value")]), gain = num(c[col("Realised P&L")]);
    if (sellValue === null || gain === null) continue;
    turnover += (buyValue || 0) + sellValue;
    rows.push({ bucket: "eqSt", kind: "stock", name: c[col("Security Name")], symbol: null, isin: isIsin(c[col("ISIN")]) ? c[col("ISIN")] : null, buyDate: null, sellDate: null, qty: num(c[col("Qty.")]), buyValue, sellValue, gain, taxable: gain, charges: 0, stt: null, termUnknown: true });
  }
  for (const x of rows) x.charges = charges && turnover ? r2(charges * ((x.buyValue || 0) + x.sellValue) / turnover) : 0;
  const to = generated || today, fy = fyOf(to);
  for (const x of rows) x.sellDate = to;
  return { broker: "Dhan", source: "dhan", clientId: null, holderName: null, panKey: null, fy: fy.label, from: fy.from, to, coverage: { stocks: "own", mf: "own" }, rows, other: { dividends: 0, interest: 0, fno: 0 }, skipped, noDates: true };
}
const roundAll = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, r2(v || 0)]));

export function parseTaxReport(tables) {
  const kind = detectTaxReport(tables);
  if (kind === "zerodha") return parseZerodhaTaxPnl(tables);
  if (kind === "indmoney") return parseIndmoneyTax(tables);
  if (kind === "dhan") return parseDhanPnl(tables);
  return null;
}

// The totals a report gives per bucket (for the summary and to check against the broker's own figures)
export function reportTotals(rep) {
  const t = Object.fromEntries(BUCKETS.map(b => [b, 0])); let charges = 0, sales = 0;
  for (const r of rep.rows) { t[r.bucket] = (t[r.bucket] || 0) + (r.taxable ?? r.gain ?? 0); charges += r.charges || 0; if (!r.summaryOnly) sales++; }
  return { ...roundAll(t), charges: r2(charges), sales };
}

// Mutual funds: a report that covers funds held at every broker (INDmoney) replaces another report's rows for the same
// fund sold on the same day, so a redemption isn't counted twice. Returns the rows each report keeps.
export function dedupeReports(reports = []) {
  const allMf = reports.filter(r => r.coverage?.mf === "all"), drop = new Set(); let dropped = 0;
  for (const a of allMf) for (const r of a.rows) if (r.kind === "mf" && r.isin) drop.add(`${a.panKey || ""}|${r.isin}|${r.sellDate}`);
  const keep = reports.map(rep => {
    if (rep.coverage?.mf === "all") return rep.rows;
    return rep.rows.filter(r => { const k = `${rep.panKey || ""}|${r.isin}|${r.sellDate}`; if (r.kind === "mf" && r.isin && drop.has(k)) { dropped++; return false; } return true; });
  });
  return { keep, dropped };
}
