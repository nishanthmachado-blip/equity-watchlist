// Holdings that do not come from an Indian stock broker:
//  * US stocks held through INDmoney (synced) or Vested (statement import / paste), priced live in dollars and shown in
//    rupees at today's USD/INR rate;
//  * mutual funds held outside Zerodha Coin (INDmoney, direct with the AMC like Axis MF), imported from the CAMS /
//    KFintech Consolidated Account Statement (CAS) PDF, a CSV, or added by hand, and valued every day at the official
//    AMFI NAV.
// Pure parsing / valuation helpers; the server does the storage and fetching.

const num = v => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[₹$,\s]|INR|USD|Rs\.?/gi, "").replace(/^\((.*)\)$/, "-$1");
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  const n = Number(s); return Number.isFinite(n) ? n : null;
};
const r2 = v => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const r4 = v => (Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : null);
const txt = (v, n = 120) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
export const cleanUsTicker = s => String(s || "").trim().toUpperCase().replace(/\.US$/, "").replace(/\./g, "-").replace(/[^A-Z0-9-]/g, "").slice(0, 10);

// ---------------------------------------------------------------- US holdings
const HEAD = {
  symbol: /^(symbol|ticker|ticker symbol|stock symbol|stock code|scrip|instrument)$/,
  name: /^(name|company|company name|stock|stock name|security|security name|description|instrument name|asset|asset name)$/,
  qty: /^(qty|quantity|units|shares|no of shares|number of shares|total shares|shares held|holding|holdings qty|quantity held)$/,
  avg: /^(avg|average|avg price|average price|avg buy price|average buy price|avg cost|average cost|buy price|avg cost per share|cost per share|average cost per share|purchase price|avg purchase price)$/,
  invested: /^(invested|investment|invested amount|amount invested|total investment|cost|cost basis|total cost|invested value|cost value|buy value)$/,
  investedInr: /^(invested inr|investment inr|invested amount inr|invested rs|invested in inr)$/,
  price: /^(price|ltp|current price|last price|market price|cmp)$/,
  value: /^(value|current value|market value|present value|total value)$/
};
const normHead = h => String(h || "").toLowerCase().replace(/\((usd|\$|us\$)\)|\b(usd|in usd)\b|\$/g, " ").replace(/\((inr|₹|rs\.?)\)|₹|\brs\.?\b/g, " inr ").replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
function headerMap(row) {
  const m = {};
  row.forEach((c, i) => { const h = normHead(c); for (const [k, re] of Object.entries(HEAD)) if (m[k] === undefined && re.test(h)) { m[k] = i; break; } });
  return m;
}
// tables: [{ rows: string[][] }] (a CSV / Excel statement) or text pasted as "AAPL 10 150.25" lines.
export function parseUsHoldings(tables, text = "") {
  let best = null;
  for (const t of tables || []) {
    const rows = t.rows || [];
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const m = headerMap(rows[i]);
      if (m.qty === undefined || (m.symbol === undefined && m.name === undefined)) continue;
      const out = [];
      for (const r of rows.slice(i + 1)) {
        const qty = num(r[m.qty]); if (!(qty > 0)) continue;
        const symbol = m.symbol !== undefined ? cleanUsTicker(r[m.symbol]) : null, name = m.name !== undefined ? txt(r[m.name], 80) : null;
        if (!symbol && !name) continue;
        if (/^(total|grand total|cash)$/i.test(name || symbol || "")) continue;
        const avg = m.avg !== undefined ? num(r[m.avg]) : null, invested = m.invested !== undefined ? num(r[m.invested]) : null;
        out.push({ symbol: symbol || null, name: name || symbol, qty: r4(qty), avgUsd: avg ?? (invested !== null ? r4(invested / qty) : null), investedUsd: invested ?? (avg !== null ? r2(avg * qty) : null), investedInr: m.investedInr !== undefined ? num(r[m.investedInr]) : null });
      }
      if (out.length && (!best || out.length > best.length)) best = out;
      break;
    }
  }
  if (best) return best;
  // Free text: "AAPL 10 150.25" / "MSFT, 3, 410" / "NVDA 12 @ 95.4"
  const out = [];
  for (const line of String(text || "").split(/\r?\n|;/)) {
    const m = line.trim().match(/^([A-Za-z][A-Za-z.\-]{0,9})[\s,:]+(\d+(?:\.\d+)?)\s*(?:shares?|qty)?[\s,@x×]*\$?\s*(\d+(?:\.\d+)?)?/i);
    if (!m) continue;
    const qty = Number(m[2]), avg = m[3] ? Number(m[3]) : null; if (!(qty > 0)) continue;
    out.push({ symbol: cleanUsTicker(m[1]), name: cleanUsTicker(m[1]), qty, avgUsd: avg, investedUsd: avg ? r2(avg * qty) : null, investedInr: null });
  }
  return out;
}

// items: [{ key, source, account, symbol, name, qty, avgUsd, investedUsd, investedInr, valueInr, syncedAt }]
// prices: { SYM: { price, prevClose?, date, source } } in USD; fx: rupees per dollar (null when unknown).
export function usHoldingsView(items, prices = {}, fx = null) {
  const rows = items.map(it => {
    const p = it.symbol ? prices[it.symbol] : null, price = p?.price > 0 ? p.price : null;
    const valueUsd = price !== null && it.qty > 0 ? it.qty * price : null;
    const investedUsd = Number.isFinite(it.investedUsd) ? it.investedUsd : Number.isFinite(it.avgUsd) && it.qty ? it.avgUsd * it.qty : null;
    const valueInr = valueUsd !== null && fx ? valueUsd * fx : Number.isFinite(it.valueInr) ? it.valueInr : null;
    const investedInr = Number.isFinite(it.investedInr) ? it.investedInr : investedUsd !== null && fx ? investedUsd * fx : null;
    return { ...it, price, priceDate: p?.date || null, priceSource: p?.source || null, dayPct: p?.prevClose > 0 && price ? r2((price / p.prevClose - 1) * 100) : null,
      valueUsd: r2(valueUsd), investedUsd: r2(investedUsd), pnlUsd: valueUsd !== null && investedUsd !== null ? r2(valueUsd - investedUsd) : null, pnlPct: valueUsd !== null && investedUsd ? r2((valueUsd / investedUsd - 1) * 100) : null,
      valueInr: r2(valueInr), investedInr: r2(investedInr), investedInrAtToday: !Number.isFinite(it.investedInr) && investedInr !== null, pnlInr: valueInr !== null && investedInr !== null ? r2(valueInr - investedInr) : null,
      stale: valueUsd === null && Number.isFinite(it.valueInr) };
  });
  const sum = k => r2(rows.reduce((a, r) => a + (Number.isFinite(r[k]) ? r[k] : 0), 0));
  const priced = rows.filter(r => Number.isFinite(r.valueInr) && Number.isFinite(r.investedInr));
  const pricedUsd = rows.filter(r => Number.isFinite(r.valueUsd) && Number.isFinite(r.investedUsd));
  return { rows: rows.sort((a, b) => (b.valueInr ?? 0) - (a.valueInr ?? 0)), fx,
    totals: { valueInr: sum("valueInr"), investedInr: r2(priced.reduce((a, r) => a + r.investedInr, 0)), pnlInr: r2(priced.reduce((a, r) => a + r.pnlInr, 0)), valueUsd: sum("valueUsd"), investedUsd: r2(pricedUsd.reduce((a, r) => a + r.investedUsd, 0)), pnlUsd: r2(pricedUsd.reduce((a, r) => a + r.pnlUsd, 0)), count: rows.length, unpriced: rows.filter(r => r.price === null).map(r => r.symbol || r.name) } };
}

// ---------------------------------------------------------------- Mutual funds
// AMFI's daily NAV file (https://www.amfiindia.com/spages/NAVAll.txt):
// "Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date"
const MONTHS = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
export const isoDay = s => { const m = String(s || "").trim().match(/^(\d{1,2})[-/ ]([A-Za-z]{3})[A-Za-z]*[-/ ](\d{4})$/); return m && MONTHS[m[2].toLowerCase()] ? `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}` : null; };
export function parseAmfiNav(text) {
  const out = {}; let amc = null;
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim(); if (!line) continue;
    if (!line.includes(";")) { if (/mutual fund/i.test(line)) amc = line; continue; }
    const c = line.split(";"); if (c.length < 6 || !/^\d+$/.test(c[0].trim())) continue;
    const nav = Number(c[4]); if (!(nav > 0)) continue;
    const e = [nav, isoDay(c[5]), Number(c[0]), c[3].trim(), amc];
    for (const isin of [c[1], c[2]].map(x => x.trim()).filter(x => /^INF[0-9A-Z]{9}$/.test(x))) out[isin] = e;
  }
  return out; // { ISIN: [nav, date, code, name, amc] }
}
export function searchAmfi(byIsin, q, limit = 12) {
  const words = String(q || "").toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1); if (!words.length) return [];
  const isin = String(q).trim().toUpperCase(); if (byIsin[isin]) return [{ isin, name: byIsin[isin][3], nav: byIsin[isin][0], date: byIsin[isin][1] }];
  const seen = new Set(), out = [];
  for (const [i, e] of Object.entries(byIsin)) {
    const n = e[3].toLowerCase(); if (!words.every(w => n.includes(w))) continue;
    if (seen.has(e[2])) continue; seen.add(e[2]);
    // direct growth plans first (that is what most people hold directly with the AMC)
    out.push({ isin: i, name: e[3], nav: e[0], date: e[1], score: (/direct/i.test(n) ? 2 : 0) + (/growth/i.test(n) ? 1 : 0) - n.length / 1000 });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit).map(({ score, ...x }) => x);
}

// Text lines from a PDF (pdfjs-dist, loaded only when a PDF is imported). The CAS is protected with your PAN in capitals;
// the password is used only for this read and never stored.
export async function pdfLines(buf, password = "") {
  let pdfjs;
  try { pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs"); } catch { throw new Error("PDF reading is not installed on the server (npm install)."); }
  let doc;
  try { doc = await pdfjs.getDocument({ data: new Uint8Array(buf), password: password || undefined, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise; }
  catch (e) {
    if (e?.name === "PasswordException") throw Object.assign(new Error(e.code === 2 ? "Wrong password. For a CAMS / KFintech CAS it is your PAN in capitals (or the password you set when you asked for it)." : "This PDF has a password: enter it (your PAN in capitals for a CAS)."), { needPassword: true });
    throw new Error(`Could not read the PDF: ${e?.message || e}`);
  }
  const lines = [];
  for (let p = 1; p <= Math.min(doc.numPages, 200); p++) {
    const page = await doc.getPage(p), tc = await page.getTextContent(), rows = new Map();
    for (const it of tc.items) { if (!it.str || !it.str.trim()) continue; const y = Math.round(it.transform[5] / 2.5); (rows.get(y) || rows.set(y, []).get(y)).push({ x: it.transform[4], w: it.width || 0, s: it.str }); }
    for (const y of [...rows.keys()].sort((a, b) => b - a)) {
      const parts = rows.get(y).sort((a, b) => a.x - b.x); let line = "", end = null;
      for (const pt of parts) { if (end !== null) line += pt.x - end > 12 ? "   " : pt.x - end > 1.5 ? " " : ""; line += pt.s; end = pt.x + pt.w; }
      lines.push(line.replace(/\s+$/, ""));
    }
    page.cleanup();
  }
  await doc.destroy();
  return lines;
}

// CAMS / KFintech consolidated account statement (detailed or summary) → one entry per scheme and folio.
export function parseCas(lines) {
  const funds = [], L = (lines || []).map(l => String(l || ""));
  let amc = null, folio = null, cur = null;
  const finish = () => { if (cur && cur.units > 0 && cur.nav > 0 && !(Math.abs(cur.units * cur.nav - (cur.value || 0)) <= Math.max(1, cur.units * cur.nav * 0.02))) cur.value = cur.units * cur.nav; // a cut-off or misread value
    if (cur && (cur.units > 0 || cur.value > 0)) { const prev = funds.find(f => f.isin === cur.isin && f.folio === cur.folio); if (prev) Object.assign(prev, cur); else funds.push(cur); } cur = null; };
  let lineNow = "", statementTo = null;
  const amount = re => { const m = lineNow.match(re); return m ? num(m[1]) : null; };
  for (let i = 0; i < L.length; i++) {
    const line = L[i]; lineNow = line;
    const per = line.match(/(\d{1,2}-[A-Za-z]{3}-\d{4})\s+(?:To|to|-)\s+(\d{1,2}-[A-Za-z]{3}-\d{4})/); if (per && !statementTo) statementTo = isoDay(per[2]);
    if (/^\s*[A-Za-z0-9 &.()'-]{3,60}Mutual Fund\s*$/i.test(line) && !/ISIN/i.test(line)) { amc = line.trim(); continue; }
    const f = line.match(/Folio\s*(?:No\.?|Number)?\s*[:.]?\s*([0-9A-Z]+(?:\s*\/\s*[0-9A-Z]+)?)/i);
    if (f && !/ISIN/i.test(line)) { finish(); folio = f[1].replace(/\s+/g, ""); continue; }
    const isin = line.match(/ISIN\s*[:-]?\s*(INF[0-9A-Z]{9})/i);
    if (isin) {
      finish();
      let name = line.slice(0, isin.index).replace(/[-–\s]+$/, "").replace(/^\s*[A-Z0-9]{2,12}-(?=[A-Z])/, "").trim();
      if (name.length < 6 && i > 0) name = `${L[i - 1].trim()} ${name}`.trim(); // the name wrapped onto the line above
      const reg = line.match(/Registrar\s*:?\s*(CAMS|KFINTECH|KARVY|FTAMIL|FRANKLIN)/i);
      cur = { isin: isin[1].toUpperCase(), name: txt(name.replace(/\(Advisor.*$/i, ""), 120), folio, amc, registrar: reg ? reg[1].toUpperCase() : null, units: null, nav: null, navDate: null, cost: null, value: null };
      // summary statements carry the numbers on the same line: cost, units, NAV date, NAV, market value
      const rest = line.slice(isin.index + isin[0].length).replace(/\(Advisor[^)]*\)/i, "");
      const nums = [...rest.matchAll(/(?<![\w-])\d[\d,]*\.\d+(?![\w-])/g)].map(m => num(m[0]));
      if (nums.length >= 3) {
        outer: for (let a = 0; a < nums.length; a++) for (let b = 0; b < nums.length; b++) for (let c = 0; c < nums.length; c++) {
          if (a === b || b === c || a === c) continue;
          if (nums[a] > 0 && nums[b] > 0 && Math.abs(nums[a] * nums[b] - nums[c]) <= Math.max(1, nums[c] * 0.002)) { cur.units = nums[a] < nums[b] && Number.isInteger(nums[b]) ? nums[b] : nums[a]; cur.nav = cur.units === nums[a] ? nums[b] : nums[a]; cur.value = nums[c]; const other = nums.filter((_, k) => k !== a && k !== b && k !== c); cur.cost = other.length ? other[0] : null; break outer; }
        }
        const d = rest.match(/\d{1,2}-[A-Za-z]{3}-\d{4}/); if (d) cur.navDate = isoDay(d[0]);
      }
      continue;
    }
    if (!cur) continue;
    const u = amount(/Closing\s+Unit\s+Balance\s*:?\s*([\d,]+\.?\d*)/i); if (u !== null) cur.units = u;
    const n = line.match(/NAV\s+on\s+(\d{1,2}-[A-Za-z]{3}-\d{4})\s*:?\s*(?:INR|Rs\.?|₹)?\s*([\d,]+\.?\d*)/i); if (n) { cur.navDate = isoDay(n[1]); cur.nav = num(n[2]); }
    const c = amount(/(?:Total\s+)?Cost\s+Value\s*:?\s*(?:INR|Rs\.?|₹)?\s*([\d,]+\.?\d*)/i); if (c !== null) cur.cost = c;
    const v = amount(/(?:Market|Valuation)\s+Value\s+(?:on|as\s+on)\s+\d{1,2}-[A-Za-z]{3}-\d{4}\s*:?\s*(?:INR|Rs\.?|₹)?\s*([\d,]+\.?\d*)/i); if (v !== null) cur.value = v;
  }
  finish();
  return { funds: funds.filter(f => f.units > 0).map(f => ({ ...f, units: r4(f.units), nav: r4(f.nav), cost: r2(f.cost), value: r2(f.value) })), statementTo };
}

// CSV / Excel / pasted rows of funds: name or ISIN, units, invested (folio optional)
const MF_HEAD = { name: /^(scheme|scheme name|fund|fund name|name|mutual fund)$/, isin: /^(isin|isin code)$/, units: /^(units|unit balance|balance units|closing units|qty|quantity)$/, cost: /^(invested|investment|invested amount|cost|cost value|purchase value|amount invested|total investment)$/, folio: /^(folio|folio no|folio number)$/ };
export function parseMfRows(tables, text = "") {
  for (const t of tables || []) {
    const rows = t.rows || [];
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const m = {}; rows[i].forEach((c, k) => { const h = normHead(c); for (const [key, re] of Object.entries(MF_HEAD)) if (m[key] === undefined && re.test(h)) { m[key] = k; break; } });
      if (m.units === undefined || (m.name === undefined && m.isin === undefined)) continue;
      const out = rows.slice(i + 1).map(r => ({ name: m.name !== undefined ? txt(r[m.name]) : null, isin: m.isin !== undefined && /^INF[0-9A-Z]{9}$/i.test(String(r[m.isin]).trim()) ? String(r[m.isin]).trim().toUpperCase() : null, units: num(r[m.units]), cost: m.cost !== undefined ? num(r[m.cost]) : null, folio: m.folio !== undefined ? txt(r[m.folio], 30) || null : null })).filter(x => x.units > 0 && (x.name || x.isin));
      if (out.length) return out;
    }
  }
  const out = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const cells = line.split(/\t|,(?!\d{2,3}\b)|\s{2,}/).map(c => c.trim()).filter(Boolean); if (cells.length < 2) continue;
    const isin = cells.find(c => /^INF[0-9A-Z]{9}$/i.test(c)), nums = cells.map(num).filter(v => v !== null);
    const name = cells.find(c => /[a-z]{3}/i.test(c) && c !== isin);
    if (!nums.length || (!name && !isin)) continue;
    out.push({ name: name ? txt(name) : null, isin: isin ? isin.toUpperCase() : null, units: nums[0], cost: nums[1] ?? null, folio: null });
  }
  return out;
}

// Value a fund at the latest AMFI NAV when it is newer than what the statement / sync carried
export function valueFund(f, amfi) {
  const a = f.isin ? amfi?.[f.isin] : null, units = Number(f.units);
  if (a && units > 0 && (!f.navDate || !a[1] || a[1] >= f.navDate)) return { ...f, nav: a[0], navDate: a[1], value: r2(units * a[0]), navSource: "AMFI", amfiName: a[3], schemeCode: a[2] };
  return { ...f, value: Number.isFinite(f.value) ? f.value : Number.isFinite(f.nav) && units > 0 ? r2(units * f.nav) : null, navSource: f.navSource || "statement" };
}
