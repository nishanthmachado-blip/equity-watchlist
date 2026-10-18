// Auto-fetch a mutual fund's portfolio (its stock holdings) for the X-ray, from:
//  1. a holdings API (mfdata.in by default, MFDATA_BASE to change): its endpoints are discovered from its OpenAPI
//     description when it has one, otherwise the usual paths are tried; any JSON with a list of holdings is understood;
//  2. the fund house's own monthly portfolio: a link to its disclosure page or to the file (Excel / CSV). On a page, the
//     newest "portfolio" file link is followed; in a workbook with one sheet per scheme, the sheet for this fund is used.
// Every attempt is reported so the page can say what worked. Pure apart from the injected fetch.
import { readXlsx, readSheetFile, sheetInfo, parseDelimited, extractHoldings, NOT_EQUITY } from "./funds.mjs";

const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", Accept: "application/json,text/html,*/*" };
const num = v => { if (v === null || v === undefined || v === "") return null; const x = Number(String(v).replace(/[%,₹\s]/g, "")); return Number.isFinite(x) ? x : null; };
export const normFund = s => String(s || "").toLowerCase().replace(/\b(fund|scheme|plan|option|direct|regular|growth|idcw|the|mutual)\b|[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

// ---- any JSON → holdings ----
const NAME_KEYS = /^(company(_?name)?|name|stock(_?name)?|security(_?name)?|instrument(_?name)?|holding(_?name)?|issuer(_?name)?|scrip(_?name)?|asset(_?name)?)$/i;
const WEIGHT_KEYS = /(weight|percent|percentage|pct|allocation|corpus_?per|holding_?per|holdingpercent|perc|share|aum_?per|nav_?per|^%$|portfolio_?per|net_?asset)/i;
export function holdingsFromJson(json) {
  const arrays = [];
  const walk = (x, depth = 0) => { if (depth > 6 || !x || typeof x !== "object") return; if (Array.isArray(x)) { if (x.length && typeof x[0] === "object") arrays.push(x); x.forEach(y => walk(y, depth + 1)); return; } for (const v of Object.values(x)) walk(v, depth + 1); };
  walk(json);
  let best = null;
  for (const arr of arrays) {
    const keys = Object.keys(arr[0] || {}), nk = keys.find(k => NAME_KEYS.test(k)), wk = keys.find(k => k !== nk && WEIGHT_KEYS.test(k) && arr.some(r => num(r[k]) !== null));
    if (!nk || !wk) continue;
    const ik = keys.find(k => /isin/i.test(k)), sk = keys.find(k => /sector|industry/i.test(k)), tk = keys.find(k => /^(type|asset_?(type|class)|nature(_?name)?|instrument_?type|category)$/i.test(k)), symk = keys.find(k => /^(symbol|nse_?symbol|ticker|nse_?code)$/i.test(k));
    const rows = [], seen = new Set();
    for (const r of arr) {
      const name = String(r[nk] ?? "").replace(/\s+/g, " ").trim(), w = num(r[wk]), isin = ik ? String(r[ik] || "").trim().toUpperCase() : "";
      if (!name || !(w > 0) || NOT_EQUITY.test(name)) continue;
      if (tk && r[tk] && !/equity|stock|share/i.test(String(r[tk]))) continue;
      if (isin && !(/^INE[A-Z0-9]{9}$/.test(isin) && isin.slice(7, 9) === "01")) continue;
      const key = isin || name.toLowerCase(); if (seen.has(key)) continue; seen.add(key);
      rows.push({ name, isin: isin || null, weight: w, sector: sk ? String(r[sk] || "").trim() || null : null, symbol: symk && /^[A-Z0-9&-]{1,20}$/.test(String(r[symk]).toUpperCase()) ? String(r[symk]).toUpperCase() : null });
    }
    if (rows.length >= 3 && (!best || rows.length > best.length)) best = rows;
  }
  if (!best) return null;
  const sum = best.reduce((a, h) => a + h.weight, 0);
  if (sum > 0 && sum <= 1.5) best.forEach(h => { h.weight = Math.round(h.weight * 10000) / 100; });
  best.sort((a, b) => b.weight - a.weight);
  const asOf = (() => { let d = null; const look = (x, depth = 0) => { if (d || depth > 3 || !x || typeof x !== "object" || Array.isArray(x)) return; for (const [k, v] of Object.entries(x)) { if (/^(as_?of|portfolio_?date|as_?on|date|month|period)$/i.test(k) && typeof v === "string" && v.length < 30) { d = v; return; } if (v && typeof v === "object" && !Array.isArray(v)) look(v, depth + 1); } }; look(json); return d; })();
  return { holdings: best, asOf };
}

// ---- a holdings API with an OpenAPI description ----
export function holdingPaths(spec) {
  const out = [];
  for (const [p, ops] of Object.entries(spec?.paths || {})) {
    if (!/holding|portfolio/i.test(p) || !ops.get) continue;
    const params = [...(ops.get.parameters || []), ...(ops.parameters || [])].map(x => ({ name: x.name, in: x.in, required: !!x.required }));
    out.push({ path: p, params });
  }
  return out;
}
const fill = (p, ids) => { const v = /isin/i.test(p.name) ? ids.isin : /code|amfi|scheme|fund_?id|^id$/i.test(p.name) ? ids.code ?? ids.isin : /name|q|query|search/i.test(p.name) ? ids.name : null; return v == null ? null : String(v); };
export function apiCandidates(base, ids, spec) {
  const urls = [];
  for (const h of holdingPaths(spec)) {
    let path = h.path, ok = true; const qs = new URLSearchParams();
    for (const p of h.params) { const v = fill(p, ids); if (p.in === "path") { if (v == null) { ok = false; break; } path = path.replace(`{${p.name}}`, encodeURIComponent(v)); } else if (p.in === "query" && v != null) qs.set(p.name, v); else if (p.required) { ok = false; break; } }
    if (ok && !/\{/.test(path)) urls.push(`${base}${path}${[...qs].length ? `?${qs}` : ""}`);
  }
  if (!urls.length) { // no description: the usual shapes
    if (ids.isin) urls.push(`${base}/api/v1/schemes/${ids.isin}/holdings`, `${base}/api/v1/funds/${ids.isin}/holdings`, `${base}/api/v1/holdings/${ids.isin}`, `${base}/api/v1/holdings?isin=${ids.isin}`);
    if (ids.code) urls.push(`${base}/api/v1/schemes/${ids.code}/holdings`, `${base}/api/v1/holdings?scheme_code=${ids.code}`, `${base}/api/holdings/${ids.code}`);
  }
  return [...new Set(urls)].slice(0, 8);
}
let specMem = { base: null, at: 0, spec: null };
export async function fetchFromApi(ids, { base = (process.env.MFDATA_BASE || "https://mfdata.in").replace(/\/+$/, ""), fetchImpl = fetch } = {}) {
  const tried = [];
  if (specMem.base !== base || Date.now() - specMem.at > 24 * 3600e3) {
    specMem = { base, at: Date.now(), spec: null };
    for (const p of ["/openapi.json", "/api/openapi.json", "/docs/openapi.json"]) {
      try { const r = await fetchImpl(`${base}${p}`, { headers: UA, signal: AbortSignal.timeout(8000) }); if (r.ok) { const j = await r.json(); if (j?.paths) { specMem.spec = j; break; } } } catch { /* next */ }
    }
  }
  for (const u of apiCandidates(base, ids, specMem.spec)) {
    try {
      const r = await fetchImpl(u, { headers: UA, signal: AbortSignal.timeout(10000) });
      if (!r.ok) { tried.push(`${u.replace(base, "")}: HTTP ${r.status}`); continue; }
      const got = holdingsFromJson(await r.json());
      if (got?.holdings.length) return { ...got, source: { kind: "api", url: u, label: new URL(base).hostname } , tried };
      tried.push(`${u.replace(base, "")}: no holdings in the answer`);
    } catch (e) { tried.push(`${u.replace(base, "")}: ${e.name === "TimeoutError" ? "no answer" : e.message}`); }
  }
  if (!tried.length) tried.push(`${new URL(base).hostname}: no holdings endpoint found`);
  return { holdings: [], tried };
}

// ---- the fund house's monthly portfolio page / file ----
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
// a rough date from a file name / link text: 2026-09, sept-2026, 30092026, "September 2026"
export function periodOf(s) {
  const t = String(s || "").toLowerCase();
  let m = t.match(/(20\d{2})[-_ .]?(0[1-9]|1[0-2])(?!\d)/); if (m) return Number(m[1]) * 12 + Number(m[2]);
  m = t.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-_ .']*(\d{2,4})/); if (m) { let y = Number(m[2]); if (y < 100) y += 2000; return y * 12 + MONTHS.indexOf(m[1]) + 1; }
  m = t.match(/(?:^|\D)(\d{2})(\d{2})(20\d{2})(?!\d)/); if (m) return Number(m[3]) * 12 + Number(m[2]);
  return 0;
}
export function portfolioLinks(html, pageUrl, fundName = "") {
  const out = [], seen = new Set(), want = normFund(fundName).split(" ").filter(w => w.length > 3);
  for (const m of String(html).matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let href; try { href = new URL(m[1].replace(/&amp;/g, "&"), pageUrl).href; } catch { continue; }
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), both = `${href} ${text}`.toLowerCase();
    if (!/\.(xlsx|xls|csv)(\?|$)/i.test(href) && !/download|portfolio/i.test(href)) continue;
    if (!/portfolio|holding|disclosure/i.test(both) && !/\.(xlsx?|csv)(\?|$)/i.test(href)) continue;
    if (seen.has(href)) continue; seen.add(href);
    const score = periodOf(both) * 10 + (want.filter(w => both.includes(w)).length) + (/\.xlsx?(\?|$)/i.test(href) ? 2 : /\.csv(\?|$)/i.test(href) ? 1 : 0) + (/monthly/.test(both) ? 1 : 0);
    out.push({ href, text: text.slice(0, 100), score });
  }
  return out.sort((a, b) => b.score - a.score);
}
// tables from a downloaded file; the one for this fund (workbooks hold one sheet per scheme)
export function holdingsFromTables(tables, fundName = "") {
  const want = normFund(fundName), words = want.split(" ").filter(w => w.length > 3);
  const found = tables.map(t => { const x = extractHoldings(t.rows), info = sheetInfo(t.rows, t.name), title = info.title; const hay = normFund(`${title} ${t.name}`); return { sheet: t.name, title: String(title).slice(0, 120), holdings: x.holdings, match: words.length ? words.filter(w => hay.includes(w)).length / words.length : 0 }; }).filter(t => t.holdings.length);
  if (!found.length) return null;
  found.sort((a, b) => b.match - a.match || b.holdings.length - a.holdings.length);
  if (found.length > 1 && words.length && found[0].match < 0.6) return { ambiguous: found.map(f => f.title).slice(0, 12) };
  return { holdings: found[0].holdings, title: found[0].title, asOf: sheetInfo(tables.find(t => t.name === found[0].sheet)?.rows || []).asOf };
}
async function tablesFromResponse(r) {
  const buf = Buffer.from(await r.arrayBuffer()), type = r.headers.get("content-type") || "";
  if (buf.length > 20e6) throw new Error("file larger than 20 MB");
  if (buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50) return { tables: readXlsx(buf) };
  if (buf.length > 8 && buf.readUInt32LE(0) === 0xe011cfd0) { try { return { tables: readSheetFile(buf, "file.xls") }; } catch (e) { return { error: `old Excel (.xls) file could not be read: ${e.message}` }; } }
  const text = buf.toString("utf8");
  if (/html/i.test(type) || /^\s*<(!doctype|html)/i.test(text)) return { html: text };
  return { tables: [{ name: "file", rows: parseDelimited(text) }] };
}
export async function fetchFromLink(link, fundName, { fetchImpl = fetch } = {}) {
  const tried = [];
  const get = async u => { const r = await fetchImpl(u, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return tablesFromResponse(r); };
  let first; try { first = await get(link); } catch (e) { return { holdings: [], tried: [`${link}: ${e.message}`] }; }
  const tryTables = (t, url) => { const got = holdingsFromTables(t, fundName); if (got?.ambiguous) { tried.push(`${url}: several schemes in the file (${got.ambiguous.slice(0, 4).join(", ")}…): give the exact fund name`); return null; } if (got?.holdings.length) return { ...got, source: { kind: "link", url, page: url === link ? null : link } }; tried.push(`${url}: no equity holdings table`); return null; };
  if (first.error) return { holdings: [], tried: [`${link}: ${first.error}`] };
  if (first.tables) { const g = tryTables(first.tables, link); return g ? { ...g, tried } : { holdings: [], tried }; }
  const links = portfolioLinks(first.html, link, fundName);
  if (!links.length) return { holdings: [], tried: [`${link}: no portfolio file links on this page`] };
  for (const l of links.slice(0, 4)) {
    try { const x = await get(l.href); if (x.error) { tried.push(`${l.href}: ${x.error}`); continue; } if (!x.tables) { tried.push(`${l.href}: not a file`); continue; } const g = tryTables(x.tables, l.href); if (g) return { ...g, tried }; }
    catch (e) { tried.push(`${l.href}: ${e.message}`); }
  }
  return { holdings: [], tried };
}
