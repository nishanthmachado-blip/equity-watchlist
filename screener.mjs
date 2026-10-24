// Screener.in source: reads the public company page (no login) and builds a fundamentals entry.
// Screener already shows Stock P/E, ROCE, ROE, book value, 10 years of sales/profit, borrowings, reserves,
// cash flow, debtor/inventory days and quarterly promoter holding, i.e. everything the valuation model needs.
// Parsing is best-effort against Screener's current HTML; if the layout changes the fetch fails with a clear
// "layout not recognised" message instead of saving wrong numbers.
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
export const screenerConfig = { cooldownMs: 10 * 60 * 1000, maxCooldownMs: 30 * 60 * 1000, timeoutMs: 20000, spacingMs: 2500 };
import { createBackoff, isNetRefusal } from "./backoff.mjs";
const sb = createBackoff({ baseMs: screenerConfig.cooldownMs, maxMs: 60 * 60e3 }); // 10 → 20 → 40 → 60 min while Screener keeps refusing
// every Screener request: a refused / reset connection (how Screener bans an address) counts as a block too
async function sFetch(fetchImpl, url, opts) {
  let r; try { r = await fetchImpl(url, opts); } catch (e) { if (isNetRefusal(e)) { const until = sb.block("connection refused"); throw new ScreenerBlocked(until, `connection refused${e?.cause?.code ? ` ${e.cause.code}` : ""}`); } throw e; }
  if (r.ok) sb.ok(); return r;
}
const SCREENER_BASE = () => (process.env.SCREENER_BASE || "https://www.screener.in").replace(/\/+$/, ""); // only changed for a proxy or tests
export class ScreenerBlocked extends Error {
  constructor(until, detail) { super(`Screener.in is rate-limiting this connection${detail ? ` (${detail})` : ""}; pausing Screener requests until ${new Date(until).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })} IST.`); this.rateLimited = true; this.until = until; }
}
export function screenerCooldown(now = Date.now()) { return sb.until(now); }
export function resetScreener() { sb.reset(); }

const decode = s => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x20B9;|&#8377;/g, "₹");
const text = html => decode(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const num = v => {
  const t = String(v ?? "").replace(/[₹,%\s]/g, "").replace(/Cr\.?$/i, "").replace(/,/g, "");
  if (t === "" || t === "-") return null;
  const x = Number(t); return Number.isFinite(x) ? x : null;
};
const round = (v, d = 1) => v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d;

function section(html, id) {
  const i = html.search(new RegExp(`id=["']${id}["']`));
  if (i < 0) return "";
  const j = html.indexOf("</section>", i);
  return html.slice(i, j < 0 ? undefined : j);
}
const cleanLabel = l => l.replace(/[+\-–]\s*$/, "").replace(/\s+/g, " ").trim();

// Returns { headers: [..period labels..], rows: { label: [numbers|null...] } } for the first data table in an HTML chunk.
export function parseTable(chunk) {
  const t = chunk.match(/<table[\s\S]*?<\/table>/i)?.[0]; if (!t) return null;
  const head = t.match(/<thead[\s\S]*?<\/thead>/i)?.[0] || "";
  const headers = [...head.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map(m => text(m[1])).slice(1);
  const body = t.match(/<tbody[\s\S]*?<\/tbody>/i)?.[0] || t;
  const rows = {};
  for (const tr of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => text(m[1]));
    if (cells.length < 2) continue;
    const label = cleanLabel(cells[0]); if (!label) continue;
    if (!(label in rows)) rows[label] = cells.slice(1).map(num);
  }
  return { headers, rows };
}

// "Name" → value text for the #top-ratios list.
export function parseTopRatios(html) {
  const ul = html.match(/id=["']top-ratios["'][\s\S]*?<\/ul>/i)?.[0] || "";
  const out = {};
  for (const li of ul.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
    const name = li[1].match(/class=["'][^"']*name[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    if (!name) continue;
    const numbers = [...li[1].matchAll(/class=["'][^"']*number[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)].map(m => num(text(m[1])));
    out[text(name[1])] = numbers;
  }
  return out;
}

const cagr = (arr, years) => {
  const v = arr.filter(x => x !== null);
  if (arr.length <= years) return null;
  const a = arr[arr.length - 1 - years], b = arr[arr.length - 1];
  if (!(a > 0) || !(b > 0)) return null;
  return round((Math.pow(b / a, 1 / years) - 1) * 100, 1);
};
const annualIdx = headers => headers.map((h, i) => /^[A-Z][a-z]{2}\s+\d{4}$/.test(h) ? i : -1).filter(i => i >= 0);
const pick = (t, labels) => { if (!t) return null; for (const l of labels) { const k = Object.keys(t.rows).find(r => r.toLowerCase() === l.toLowerCase()); if (k) return t.rows[k]; } return null; };
const onlyAnnual = (t, arr) => arr ? annualIdx(t.headers).map(i => arr[i] ?? null) : null;
const last = a => a && a.length ? a[a.length - 1] : null;
const sum = a => a.reduce((x, y) => x + y, 0);

export function detectScreenerProfile(sector, industry) {
  const s = `${sector || ""} ${industry || ""}`;
  if (/Bank|NBFC|Finance Company|Housing Finance|Financial|Insurance|Asset Management|Broking|Stock Exchange|Capital Markets|Credit/i.test(s)) return "financial";
  if (/Steel|Iron|Metal|Aluminium|Copper|Zinc|Coal|Oil|Gas|Petro|Refiner|Mining|Shipping|Airline|Cement|Chemical|Fertili[sz]er|Sugar|Semiconductor|Gold/i.test(s)) return "cyclical";
  return "default";
}

// Pure: Screener page HTML -> { entry, warnings }. Throws if the essential sections are missing.
export function parseScreener(html, stock, today = new Date().toISOString().slice(0, 10)) {
  const warnings = [];
  const top = parseTopRatios(html);
  const price = top["Current Price"]?.[0] ?? null, pe = top["Stock P/E"]?.[0] ?? null;
  if (!price) { const title = text(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").slice(0, 70); throw new Error(`Screener page layout not recognised (no Current Price; page title "${title}", ${html.length} bytes). It may be a login/captcha/limit page.`); }
  const pl = parseTable(section(html, "profit-loss")), bs = parseTable(section(html, "balance-sheet")), cf = parseTable(section(html, "cash-flow")), rt = parseTable(section(html, "ratios"));
  const missing = [["profit-loss", pl], ["balance-sheet", bs]].filter(([, t]) => !t).map(([n]) => n);
  if (missing.length) throw new Error(`Screener page layout not recognised (missing ${missing.join(", ")}).`);

  const sales = onlyAnnual(pl, pick(pl, ["Sales", "Revenue"])), np = onlyAnnual(pl, pick(pl, ["Net Profit"]));
  const dep = onlyAnnual(pl, pick(pl, ["Depreciation"]));
  const borrow = onlyAnnual(bs, pick(bs, ["Borrowings"])), reserves = onlyAnnual(bs, pick(bs, ["Reserves"]));
  const fixed = onlyAnnual(bs, pick(bs, ["Fixed Assets"])), cwip = onlyAnnual(bs, pick(bs, ["CWIP"]));
  const cfo = cf ? onlyAnnual(cf, pick(cf, ["Cash from Operating Activity"])) : null;
  if (!np || np.length < 2) warnings.push("Net profit history missing.");

  const entry = {
    symbol: (stock.marketSymbol || stock.ticker || "").toUpperCase(),
    companyName: text(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "") || undefined,
    price, priceDate: today,
    pe: pe && pe > 0 ? pe : undefined,
    high52: top["High / Low"]?.[0] ?? undefined, low52: top["High / Low"]?.[1] ?? undefined,
    roce: top["ROCE"]?.[0] ?? undefined, roe: top["ROE"]?.[0] ?? undefined,
    asOf: today, source: "Screener.in", flags: ""
  };
  const mc = top["Market Cap"]?.[0]; if (mc > 0) entry.marketCap = mc;
  const bv = top["Book Value"]?.[0];
  if (bv > 0) entry.pb = round(price / bv, 2);
  if (sales) entry.salesCagr3 = cagr(sales, 3) ?? undefined;
  // For companies without profits (valued on sales): last 12 months' sales and profit from the quarterly table, the recent
  // sales growth (latest 12 months vs the 12 before, blended with the yearly growth over up to 3 years), operating margin
  // now vs earlier, and cash parked in investments.
  const qt = parseTable(section(html, "quarters")), qIdx = qt ? qt.headers.map((h, i) => /^[A-Z][a-z]{2}\s+\d{4}$/.test(h) ? i : -1).filter(i => i >= 0) : [];
  const qSales = qt ? qIdx.map(i => pick(qt, ["Sales", "Revenue"])?.[i] ?? null) : [], qNp = qt ? qIdx.map(i => pick(qt, ["Net Profit"])?.[i] ?? null) : [];
  const l4 = qSales.slice(-4), p4 = qSales.slice(-8, -4);
  if (l4.length === 4 && l4.every(x => x !== null)) entry.salesTtm = round(sum(l4), 0);
  else if (last(sales) > 0) entry.salesTtm = last(sales);
  const n4 = qNp.slice(-4); if (n4.length === 4 && n4.every(x => x !== null)) entry.niTtm = round(sum(n4), 0); else if (np && last(np) !== null) entry.niTtm = last(np);
  const yoy = p4.length === 4 && p4.every(x => x > 0) && l4.every(x => x !== null) ? (sum(l4) / sum(p4) - 1) * 100 : null;
  const yrs = sales ? Math.min(3, sales.filter(x => x !== null).length - 1) : 0, cg = yrs >= 1 ? cagr(sales.filter(x => x !== null), yrs) : null;
  if (yoy !== null || cg !== null) { entry.salesGrowth = round(yoy !== null && cg !== null ? 0.5 * yoy + 0.5 * cg : yoy ?? cg, 1); entry.salesGrowthYears = yoy !== null && cg !== null ? yrs : yoy !== null ? 1 : yrs; }
  const opm = onlyAnnual(pl, pick(pl, ["OPM %", "OPM"])), qOpm = qt ? qIdx.map(i => pick(qt, ["OPM %", "OPM"])?.[i] ?? null) : [];
  const opmNow = last(qOpm.filter(x => x !== null)) ?? last((opm || []).filter(x => x !== null));
  if (opmNow !== null && opmNow !== undefined) entry.opmLatest = opmNow;
  const opmHist = (opm || []).filter(x => x !== null); if (opmHist.length >= 3) entry.opmPrev = opmHist[opmHist.length - 3];
  const inv = onlyAnnual(bs, pick(bs, ["Investments"])); if (inv && last(inv) !== null) entry.investments = last(inv);
  if (np) entry.profitCagr3 = cagr(np, 3) ?? undefined;
  if (last(borrow) !== null && borrow) entry.borrowings = last(borrow);
  if (last(reserves) !== null && reserves) entry.reserves = last(reserves);
  if (np && np.length) {
    entry.niLatest = last(np);
    const l4 = np.slice(-4).filter(x => x !== null); if (l4.length === 4) entry.niAvg4 = round(sum(l4) / 4, 1);
  }
  if (cfo && np && cfo.length >= 3 && np.length >= 3) {
    const c3 = cfo.slice(-3), n3 = np.slice(-3);
    if (c3.every(x => x !== null) && n3.every(x => x !== null) && sum(n3) > 0) entry.cfoToProfit3 = round(sum(c3) / sum(n3), 2);
    // Free cash flow proxy: operating cash flow minus (change in fixed assets + CWIP + depreciation)
    if (fixed && dep && fixed.length >= 4 && c3.every(x => x !== null)) {
      const cw = cwip && cwip.length === fixed.length ? cwip : fixed.map(() => 0);
      const capex = i => (fixed[i] + (cw[i] ?? 0)) - (fixed[i - 1] + (cw[i - 1] ?? 0)) + (dep[i] ?? 0);
      const n = fixed.length, ok = [n - 3, n - 2, n - 1].every(i => [fixed[i], fixed[i - 1], dep[i]].every(x => x !== null));
      if (ok) {
        const f = [n - 3, n - 2, n - 1].map((i, k) => cfo[cfo.length - 3 + k] - capex(i));
        entry.fcfNegative = f[2] < 0 && sum(f) < 0 ? 1 : 0;
      }
    }
  }
  if (rt) {
    const dd = onlyAnnual(rt, pick(rt, ["Debtor Days"])), id = onlyAnnual(rt, pick(rt, ["Inventory Days"]));
    if (dd && last(dd) !== null) entry.debtorDays = last(dd);
    if (id && last(id) !== null) entry.inventoryDays = last(id);
  }
  // Promoter holding: quarterly shareholding table, latest vs 12 quarters earlier
  const shp = parseTable(section(html, "quarterly-shp") || section(html, "shareholding"));
  const prom = shp ? pick(shp, ["Promoters"]) : null;
  if (prom && prom.filter(x => x !== null).length) {
    entry.promoter = last(prom);
    if (prom.length >= 13 && prom[prom.length - 13] !== null) entry.promoterChange3y = round(last(prom) - prom[prom.length - 13], 1);
  } else warnings.push("Promoter holding not found.");
  // Sector / industry from the peers block links
  const peers = section(html, "peers");
  const links = [...peers.matchAll(/<a[^>]+href=["']\/market\/[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)].map(m => text(m[1])).filter(Boolean);
  if (links.length) { entry.sector = links[0]; entry.industry = links[links.length - 1]; }
  entry.profile = detectScreenerProfile(entry.sector, entry.industry);

  const flags = [];
  if (last(np) !== null && last(np) <= 0) flags.push("Loss-making in the latest year: valued on sales and a path to profit instead of P/E");
  if (entry.profile === "financial" && entry.pb === undefined) flags.push("Lender: book value missing, P/B not computed");
  entry.flags = flags.join(" | ");
  for (const k of Object.keys(entry)) if (entry[k] === undefined || entry[k] === null) delete entry[k];
  return { entry, warnings, extra: parseScreenerExtra(html, top, pl) };
}

// Extra facts the valuation model does not need but the stock card shows: Screener's page ids (for the peer table and the
// price chart), the dividend yield and the yearly dividend per share (EPS × dividend payout %, from the P&L table).
// The company's own website, from the links under its name ("company-links": website, BSE, NSE)
export function parseWebsite(html) {
  const box = String(html || "").match(/class=["'][^"']*company-links[^"']*["'][\s\S]{0,3000}?<\/div>/i)?.[0] || "";
  for (const [, href] of box.matchAll(/<a[^>]+href=["'](https?:\/\/[^"']+)["']/gi)) if (!/bseindia|nseindia|screener\.in|tradingview|google\./i.test(href)) return href;
  return null;
}
export function parseScreenerExtra(html, top = parseTopRatios(html), pl = parseTable(section(html, "profit-loss"))) {
  const companyId = html.match(/data-company-id=["'](\d+)["']/)?.[1] || null, warehouseId = parseWarehouseId(html);
  const out = { companyId, warehouseId, dividendYield: top["Dividend Yield"]?.[0] ?? null, divAnnual: [], website: parseWebsite(html) };
  if (pl) {
    const idx = annualIdx(pl.headers), eps = pick(pl, ["EPS in Rs", "EPS"]), pay = pick(pl, ["Dividend Payout %", "Dividend Payout"]);
    if (eps && pay) for (const i of idx) {
      const y = Number(pl.headers[i].slice(-4)), e = eps[i], d = pay[i];
      if (Number.isFinite(y) && e !== null && d !== null && e !== undefined && d !== undefined) out.divAnnual.push({ year: y, label: pl.headers[i], eps: e, payout: d, dps: Math.round(Math.max(0, e) * d) / 100 });
    }
  }
  return out;
}
// Screener's peer comparison table, as shown on the company page: headers plus one row per peer (symbol from its link).
export function parsePeersTable(html) {
  const t = html.match(/<table[\s\S]*?<\/table>/i)?.[0]; if (!t) return null;
  const headers = [...t.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map(m => text(m[1]));
  if (!headers.length) return null;
  const rows = []; let median = null;
  for (const tr of t.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cellsHtml = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1]);
    if (!cellsHtml.length) continue;
    const cells = cellsHtml.map(text);
    if (/median/i.test(cells.join(" "))) { median = cells; continue; }
    const link = tr[1].match(/href=["']\/company\/([^/"']+)\//i)?.[1] || null;
    rows.push({ symbol: link ? decodeURIComponent(link).toUpperCase() : null, cells });
  }
  return rows.length ? { headers, rows, median } : null;
}
// Screener's price chart data: { datasets: [{ metric: "Price"|"DMA50"|"DMA200"|"Volume", values: [[date, value, ...], ...] }] }
export function parseScreenerChart(json) {
  const ds = json?.datasets; if (!Array.isArray(ds)) return null;
  const get = m => ds.find(d => String(d.metric || "").toLowerCase() === m.toLowerCase())?.values || [];
  const price = get("Price"), vol = new Map(get("Volume").map(v => [v[0], Number(v[1])]));
  const bars = price.map(v => ({ d: v[0], c: Number(v[1]), h: Number(v[1]), v: vol.get(v[0]) ?? null })).filter(b => Number.isFinite(b.c));
  return bars.length ? bars : null;
}

// Industry P/E from Screener's peer table (the same comparison block shown on the company page). The page only carries an
// id; the table itself comes from /api/company/<warehouse id>/peers/. Median of the peers' positive P/E values.
export function parseWarehouseId(html) { return html.match(/data-warehouse-id=["'](\d+)["']/)?.[1] || null; }
export function parsePeersPe(html) {
  const t = html.match(/<table[\s\S]*?<\/table>/i)?.[0]; if (!t) return null;
  const headers = [...t.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map(m => text(m[1]));
  const peIdx = headers.findIndex(h => /^P\/E\b/i.test(h)); if (peIdx < 0) return null;
  const vals = [];
  for (const tr of t.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => text(m[1]));
    if (cells.length !== headers.length || /median/i.test(cells.join(" "))) continue; // skip header/median/footer rows
    const v = num(cells[peIdx]); if (v !== null && v > 0 && v < 1000) vals.push(v);
  }
  if (vals.length < 3) return null;
  vals.sort((a, b) => a - b); const m = vals.length >> 1;
  return { sectorPe: round(vals.length % 2 ? vals[m] : (vals[m - 1] + vals[m]) / 2, 1), count: vals.length };
}

// A company page with real numbers (the consolidated view of a standalone-only company has the labels but no values).
// Needs the price AND real numbers in the profit & loss table: a company without subsidiaries can show a consolidated page
// with the price filled in but every statement blank (Ather Energy's book value, sales and borrowings came out empty).
export function hasFigures(html) {
  const top = parseTopRatios(html); if (!((top["Current Price"]?.[0] ?? 0) > 0)) return false;
  const pl = parseTable(section(html, "profit-loss")), sales = pl ? pick(pl, ["Sales", "Revenue"]) : null;
  return !!(sales && sales.some(x => x !== null && x !== 0));
}
export async function fetchScreener(stock, fetchImpl = fetch) {
  const sym = (stock.marketSymbol || stock.ticker || "").toUpperCase();
  if (!/^[A-Z0-9&-]+$/.test(sym)) throw new Error("bad symbol");
  const cd = screenerCooldown(); if (cd) throw new ScreenerBlocked(cd);
  const get = async url => {
    const r = await sFetch(fetchImpl, url, { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" }, signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(screenerConfig.timeoutMs) : undefined });
    if (r.status === 429 || r.status === 403) {
      const ra = Number(r.headers?.get?.("retry-after")) * 1000;
      const until = sb.block(`HTTP ${r.status}`, Date.now(), Number.isFinite(ra) && ra > 0 ? Math.min(screenerConfig.maxCooldownMs, ra) : null);
      throw new ScreenerBlocked(until, `HTTP ${r.status}`);
    }
    return r;
  };
  const base = `${SCREENER_BASE()}/company/${encodeURIComponent(sym)}/`;
  let r = await get(base + "consolidated/"), html = null;
  if (r.ok) {
    html = await r.text();
    // Companies without subsidiaries (e.g. Tips Music, Thangamayil): the consolidated page loads but every figure is
    // blank. Use the standalone page then.
    if (!hasFigures(html)) { await new Promise(res => setTimeout(res, 600)); r = await get(base); html = null; }
  } else if (r.status === 404) r = await get(base);
  if (r.status === 404) throw new Error(`Screener has no page for ${sym}. Check the NSE symbol.`);
  if (!r.ok) throw new Error(`Screener HTTP ${r.status}`);
  html ??= await r.text();
  const out = parseScreener(html, stock);
  const wid = parseWarehouseId(html);
  if (wid) {
    try {
      await new Promise(res => setTimeout(res, 800));
      const pr = await get(`${SCREENER_BASE()}/api/company/${wid}/peers/`);
      const peersHtml = pr.ok ? await pr.text() : "";
      const peers = peersHtml ? parsePeersPe(peersHtml) : null;
      out.peersTable = peersHtml ? parsePeersTable(peersHtml) : null;
      if (peers) { out.entry.sectorPe = peers.sectorPe; out.entry.sectorPeSource = `Screener peers median (${peers.count})`; }
      else out.warnings.push("Industry P/E: Screener peer table not readable.");
    } catch (e) { if (e.rateLimited) throw e; out.warnings.push(`Industry P/E unavailable (${e.message}).`); }
  }
  return out;
}

// On demand for the stock card: ids (cached by the caller, else read from the company page), peer table and price chart.
export async function fetchScreenerExtras(stock, { ids = null, want = ["peers", "chart"], fetchImpl = fetch } = {}) {
  const sym = (stock.marketSymbol || stock.ticker || "").toUpperCase();
  const cd = screenerCooldown(); if (cd) throw new ScreenerBlocked(cd);
  const get = async url => {
    const r = await sFetch(fetchImpl, url, { headers: { "User-Agent": UA, Accept: url.includes("/api/") ? "application/json, text/html" : "text/html", "Accept-Language": "en-US,en;q=0.9", Referer: `${SCREENER_BASE()}/company/${encodeURIComponent(sym)}/` }, signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(screenerConfig.timeoutMs) : undefined });
    if (r.status === 429 || r.status === 403) { const until = sb.block(`HTTP ${r.status}`); throw new ScreenerBlocked(until, `HTTP ${r.status}`); }
    return r;
  };
  const out = { ids: ids || null, extra: null, peersTable: null, bars: null };
  if (!out.ids?.companyId || !out.ids?.warehouseId) {
    const base = `${SCREENER_BASE()}/company/${encodeURIComponent(sym)}/`;
    let r = await get(base + "consolidated/"), html = r.ok ? await r.text() : null;
    if (r.status === 404 || (html !== null && !hasFigures(html))) { r = await get(base); html = null; }
    if (!r.ok) throw new Error(`Screener HTTP ${r.status}`);
    html ??= await r.text(); out.extra = parseScreenerExtra(html);
    out.ids = { companyId: out.extra.companyId, warehouseId: out.extra.warehouseId };
  }
  const pause = () => new Promise(res => setTimeout(res, 700));
  if (want.includes("peers") && out.ids.warehouseId) { await pause(); const r = await get(`${SCREENER_BASE()}/api/company/${out.ids.warehouseId}/peers/`); if (r.ok) out.peersTable = parsePeersTable(await r.text()); }
  if (want.includes("chart")) {
    for (const id of [out.ids.companyId, out.ids.warehouseId].filter(Boolean)) {
      await pause();
      const r = await get(`${SCREENER_BASE()}/api/company/${id}/chart/?q=Price-DMA50-DMA200-Volume&days=365&consolidated=true`);
      if (r.ok) { try { out.bars = parseScreenerChart(await r.json()); } catch { /* not JSON */ } }
      if (out.bars) break;
    }
  }
  return out;
}

// Company search (the same one as Screener's search box): name or ISIN -> [{ name, symbol, exchange }].
export function parseScreenerSearch(json) {
  return (Array.isArray(json) ? json : []).map(x => { const m = /\/company\/([^/]+)\//.exec(x?.url || ""); const s = m ? decodeURIComponent(m[1]).toUpperCase() : null; return s ? { name: x.name, symbol: s, exchange: /^\d{6}$/.test(s) ? "BSE" : "NSE" } : null; }).filter(Boolean);
}
export async function searchScreener(q, { fetchImpl = fetch } = {}) {
  const cd = screenerCooldown(); if (cd) throw new ScreenerBlocked(cd);
  const r = await sFetch(fetchImpl, `${SCREENER_BASE()}/api/company/search/?q=${encodeURIComponent(q)}&v=3&fts=1`, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(12000) : undefined });
  if (r.status === 429 || r.status === 403) { const until = sb.block(`HTTP ${r.status}`); throw new ScreenerBlocked(until, `HTTP ${r.status}`); }
  if (!r.ok) throw new Error(`Screener search HTTP ${r.status}`);
  return parseScreenerSearch(await r.json());
}

// Live-ish price from the company page's top ratios (Current Price, High / Low = 52-week range). One page request.
export async function fetchScreenerPrice(stock, fetchImpl = fetch) {
  const sym = (stock.marketSymbol || stock.ticker || stock.symbol || "").toUpperCase();
  if (!/^[A-Z0-9&-]+$/.test(sym)) throw new Error("bad symbol");
  const cd = screenerCooldown(); if (cd) throw new ScreenerBlocked(cd);
  const r = await sFetch(fetchImpl, `${SCREENER_BASE()}/company/${encodeURIComponent(sym)}/`, { headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "en-US,en;q=0.9" }, signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(screenerConfig.timeoutMs) : undefined });
  if (r.status === 429 || r.status === 403) { const until = sb.block(`HTTP ${r.status}`); throw new ScreenerBlocked(until, `HTTP ${r.status}`); }
  if (r.status === 404) throw new Error(`Screener has no page for ${sym}`);
  if (!r.ok) throw new Error(`Screener HTTP ${r.status}`);
  const top = parseTopRatios(await r.text()), price = top["Current Price"]?.[0], hl = top["High / Low"] || [];
  if (!(price > 0)) throw new Error("Screener: no current price on the page");
  return { price, high: hl[0] > 0 ? hl[0] : null, low: hl[1] > 0 ? hl[1] : null, source: "Screener" };
}
