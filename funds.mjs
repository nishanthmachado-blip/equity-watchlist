// Mutual fund X-ray: read a fund's portfolio (the AMC's monthly portfolio Excel, a CSV, or a table pasted from Value Research /
// Moneycontrol), keep the equity holdings with their weights, and summarise them with this app's valuations. Pure + a tiny
// dependency-free .xlsx reader (zip + XML).
import zlib from "node:zlib";
import { readXls, isCfb, readXlsText } from "./xls.mjs";

// ---- minimal .xlsx reader ------------------------------------------------------------------------------------------
function unzip(buf) {
  const files = new Map();
  let eocd = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("Not an .xlsx file (zip directory missing).");
  const count = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nlen);
    const lnlen = buf.readUInt16LE(off + 26), lelen = buf.readUInt16LE(off + 28), start = off + 30 + lnlen + lelen;
    const data = buf.subarray(start, start + csize);
    files.set(name, () => (method === 0 ? data : zlib.inflateRawSync(data)).toString("utf8"));
    p += 46 + nlen + elen + clen;
  }
  return files;
}
const xmlText = s => s.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const colIndex = ref => { const m = /^([A-Z]+)/.exec(ref || ""); let n = 0; for (const ch of m ? m[1] : "A") n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
export function readXlsx(buf) {
  const files = unzip(buf);
  const shared = files.has("xl/sharedStrings.xml") ? [...files.get("xl/sharedStrings.xml")().matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => xmlText(m[1])) : [];
  const wb = files.has("xl/workbook.xml") ? files.get("xl/workbook.xml")() : "";
  const rels = files.has("xl/_rels/workbook.xml.rels") ? files.get("xl/_rels/workbook.xml.rels")() : "";
  // attributes come in any order (Excel writes Id first, other tools Target first)
  const relMap = new Map([...rels.matchAll(/<Relationship\b([^>]*)\/?>/g)].map(m => [/\bId="([^"]+)"/.exec(m[1])?.[1], /\bTarget="([^"]+)"/.exec(m[1])?.[1]]).filter(([k, v]) => k && v).map(([k, v]) => [k, v.replace(/^\/?xl\//, "")]));
  let sheets = [...wb.matchAll(/<sheet\b([^>]*)\/?>/g)].map(m => ({ name: xmlText(/\bname="([^"]+)"/.exec(m[1])?.[1] || ""), path: `xl/${relMap.get(/\br:id="([^"]+)"/.exec(m[1])?.[1]) || ""}` })).filter(x => x.name);
  if (!sheets.length) sheets = [...files.keys()].filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).map((path, i) => ({ name: `Sheet${i + 1}`, path }));
  return sheets.filter(s => files.has(s.path)).map(s => {
    const xml = files.get(s.path)(), rows = [];
    for (const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const row = [];
      for (const cm of rm[1].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cm[1], inner = cm[2] || "", ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1], t = /t="([^"]+)"/.exec(attrs)?.[1];
        let v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? null;
        if (t === "s" && v !== null) v = shared[Number(v)] ?? ""; else if (t === "inlineStr") v = xmlText(/<is>([\s\S]*?)<\/is>/.exec(inner)?.[1] || ""); else if (v !== null) v = xmlText(v);
        row[ref ? colIndex(ref) : row.length] = v ?? "";
      }
      rows.push(Array.from(row, x => (x ?? "").toString().trim()));
    }
    return { name: s.name, rows };
  });
}

// Any spreadsheet the user uploads or a fund house links to: .xlsx, old .xls (Excel 97-2003), an HTML / XML table saved
// as .xls, else CSV / tab-separated text.
export function readSheetFile(buf, filename = "") {
  if (buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50) return readXlsx(buf);
  if (isCfb(buf)) return readXls(buf);
  if (/\.xls$/i.test(filename) || /^\s*<(\?xml|html|table|!doctype)/i.test(buf.subarray(0, 200).toString("utf8"))) { const t = readXlsText(buf); if (t?.length) return t; }
  return [{ name: filename || "file", rows: parseDelimited(buf.toString("utf8")) }];
}
// Scheme name and portfolio date from the first rows of an AMC sheet ("SCHEME NAME : Helios Flexi Cap Fund (...)",
// "PORTFOLIO STATEMENT AS ON : 46295" where the date is an Excel day number, or "Portfolio Statement as on September 30,2026").
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function sheetInfo(rows, fallback = "") {
  const top = rows.slice(0, 10), cells = top.flat().map(c => String(c || "").trim()).filter(Boolean);
  let title = null;
  for (const r of top) { const i = r.findIndex(c => /^scheme( name)?\s*:?$/i.test(String(c || "").trim())); if (i >= 0) { title = r.slice(i + 1).find(c => String(c || "").trim()); if (title) break; } }
  title ||= cells.find(c => /fund|scheme/i.test(c) && !/^(.*mutual fund|scheme name\s*:?)$/i.test(c) && !/portfolio statement|name of the instrument/i.test(c)) || cells.find(c => /fund|scheme/i.test(c)) || fallback;
  title = String(title).replace(/^scheme name\s*:?\s*/i, "").trim();
  let asOf = null;
  for (const r of top) {
    const cs = r.map(c => String(c || "").trim()), i = cs.findIndex(c => /as on|as at|period ended/i.test(c)); if (i < 0) continue;
    const after = cs[i].replace(/.*?(as on|as at|period ended)\s*:?\s*/i, "").trim() || cs.slice(i + 1).find(Boolean) || "";
    if (/^\d{5}(\.\d+)?$/.test(after) && +after > 30000 && +after < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(+after) * 864e5); asOf = `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; }
    else if (after) asOf = after.slice(0, 30);
    if (asOf) break;
  }
  return { title: title.slice(0, 120), asOf };
}

// ---- tables ----------------------------------------------------------------------------------------------------------------
export function parseDelimited(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n").filter(l => l.trim());
  const delim = lines.slice(0, 5).some(l => l.includes("\t")) ? "\t" : ",";
  return lines.map(l => { const out = []; let cell = "", q = false; for (let i = 0; i < l.length; i++) { const c = l[i]; if (q) { if (c === '"' && l[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; } else if (c === '"') q = true; else if (c === delim) { out.push(cell.trim()); cell = ""; } else cell += c; } out.push(cell.trim()); return out; });
}
export const NOT_EQUITY = /treps|tri-?party|reverse repo|repo|cash|net (current )?(receivable|assets)|payable|margin|treasury|t-?bill|government|g-?sec|sdl|bond|debenture|ncd|commercial paper|certificate of deposit|\bcp\b|\bcd\b|mutual fund units|\bunits\b|derivative|futures?|options?|total|grand total|sub ?total|equity & equity related|listed \/ awaiting|^nil$/i;
const num = v => { const x = Number(String(v ?? "").replace(/[%,₹\s]/g, "")); return Number.isFinite(x) ? x : null; };
// Finds the holdings table inside rows: a header with a name column and a % weight column; keeps equity rows with weight > 0.
export function extractHoldings(rows) {
  let hi = -1, cols = null;
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const h = rows[i].map(c => String(c || "").toLowerCase());
    const name = h.findIndex(c => /name of (the )?(instrument|security|company|issuer)|company( name)?$|^stock|^name$|instrument|security name|holding/.test(c));
    const weight = h.findIndex(c => /%.*(net asset|nav|aum|portfolio)|(net asset|nav|aum).*%|% to|weight|^%$|% of|holding \(%\)|allocation/.test(c));
    if (name >= 0 && weight >= 0 && name !== weight) { hi = i; cols = { name, weight, isin: h.findIndex(c => /isin/.test(c)), sector: h.findIndex(c => /industry|sector/.test(c)) }; break; }
  }
  if (hi < 0) return { holdings: [], note: "Could not find a table with a company-name column and a % weight column." };
  const holdings = [], seen = new Set();
  for (const r of rows.slice(hi + 1)) {
    const name = String(r[cols.name] || "").replace(/\s+/g, " ").trim(); let w = num(r[cols.weight]);
    const isin = cols.isin >= 0 ? String(r[cols.isin] || "").trim().toUpperCase() : "";
    if (!name || w === null || w <= 0 || NOT_EQUITY.test(name)) continue;
    // Indian equity shares have ISINs like INE + issuer(4) + "01" + serial; INF = fund units, other codes = debt / foreign
    if (isin && !(/^INE[A-Z0-9]{9}$/.test(isin) && isin.slice(7, 9) === "01")) continue;
    const key = isin || name.toLowerCase(); if (seen.has(key)) continue; seen.add(key);
    holdings.push({ name, isin: isin || null, weight: w, sector: cols.sector >= 0 ? String(r[cols.sector] || "").trim() || null : null });
  }
  const sum = holdings.reduce((a, h) => a + h.weight, 0);
  if (sum > 0 && sum <= 1.5) holdings.forEach(h => { h.weight = Math.round(h.weight * 10000) / 100; }); // weights given as fractions
  holdings.sort((a, b) => b.weight - a.weight);
  return { holdings, note: null };
}

// ---- summary -----------------------------------------------------------------------------------------------------------
// holdings: [{ name, symbol, weight }], rowsBySym: valuation rows; mine: Map(symbol -> your portfolio weight %)
export function fundSummary(holdings, rowsBySym, mine = new Map()) {
  const rows = holdings.map(h => ({ ...h, r: h.symbol ? rowsBySym[h.symbol] : null }));
  const total = rows.reduce((a, h) => a + h.weight, 0);
  const valued = rows.filter(h => h.r && Number.isFinite(h.r.ratio));
  const wv = valued.reduce((a, h) => a + h.weight, 0);
  const pes = valued.filter(h => h.r.pe > 0), wpe = pes.reduce((a, h) => a + h.weight, 0);
  const harmonicPE = wpe > 0 ? wpe / pes.reduce((a, h) => a + h.weight / h.r.pe, 0) : null;
  const byKey = k => valued.filter(h => h.r.verdict?.key === k).reduce((a, h) => a + h.weight, 0);
  const gw = valued.filter(h => h.r.growthLens), wg = gw.reduce((a, h) => a + h.weight, 0);
  const overlap = rows.reduce((a, h) => a + (h.symbol && mine.has(h.symbol) ? Math.min(h.weight, mine.get(h.symbol)) : 0), 0);
  const pct = v => (total > 0 ? Math.round(v / total * 1000) / 10 : 0);
  return {
    count: rows.length, totalWeight: Math.round(total * 10) / 10, coverage: pct(wv), weightedPE: harmonicPE ? Math.round(harmonicPE * 10) / 10 : null,
    weightedGrowth: wg > 0 ? Math.round(gw.reduce((a, h) => a + h.weight * h.r.growthLens.growth, 0) / wg * 10) / 10 : null,
    mix: { buy: pct(byKey("buy")), wait: pct(byKey("wait")), expensive: pct(byKey("expensive")), unvalued: Math.round((100 - pct(wv)) * 10) / 10 },
    growthJustified: pct(valued.filter(h => h.r.verdict?.growthJustified).reduce((a, h) => a + h.weight, 0)),
    overlapWithYou: Math.round(overlap * 10) / 10, sharedStocks: rows.filter(h => h.symbol && mine.has(h.symbol)).length
  };
}
