// Optional NSE fallback: P/E, sector P/E, industry and 52-week range from NSE's public quote API.
// NSE blocks many non-browser clients and changes this endpoint without notice, so everything here is
// best-effort: callers must treat a failure as "no NSE data", never as a fatal error.
// NSE_BASE / NSE_ARCHIVE_BASE point at a stand-in server in tests
export const NSE_BASE = () => (process.env.NSE_BASE || "https://www.nseindia.com").replace(/\/+$/, "");
export const NSE_ARCHIVE_BASE = () => (process.env.NSE_ARCHIVE_BASE || "https://nsearchives.nseindia.com").replace(/\/+$/, "");
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
let cookieCache = null;
let cooldownUntil = 0;
export const nseConfig = { cooldownMs: 5 * 60 * 1000, timeoutMs: 8000, failsBeforePause: 3 };
export class NseBlocked extends Error { constructor(until, detail) { super(`NSE is blocking/throttling this connection${detail ? ` (${detail})` : ""}; pausing NSE requests until ${new Date(until).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })} IST.`); this.rateLimited = true; this.until = until; } }
export function nseCooldown(now = Date.now()) { return cooldownUntil > now ? cooldownUntil : 0; }
export function resetNse() { cookieCache = null; cooldownUntil = 0; quietFails = 0; }
const BROWSER = { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", "Accept-Encoding": "gzip, deflate, br", Connection: "keep-alive", "sec-ch-ua": '"Chromium";v="124", "Not-A.Brand";v="99"', "sec-ch-ua-mobile": "?0", "sec-ch-ua-platform": '"Linux"' };
export let lastNseStatus = null;
function block(where = "", status = "") { lastNseStatus = `${where} HTTP ${status}`.trim(); cooldownUntil = Date.now() + nseConfig.cooldownMs; cookieCache = null; return new NseBlocked(cooldownUntil, lastNseStatus); }
const withTimeout = o => ({ ...o, signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(nseConfig.timeoutMs) : undefined });
async function cookies(f) {
  if (cookieCache && Date.now() - cookieCache.at < 10 * 60 * 1000) return cookieCache.value;
  const r = await f(NSE_BASE(), withTimeout({ headers: { ...BROWSER, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "none", "Upgrade-Insecure-Requests": "1" } }));
  if (r.status === 403 || r.status === 429) throw block("home page", r.status);
  const value = (r.headers.getSetCookie?.() || []).map(c => c.split(";")[0]).join("; ");
  if (!value) throw new Error("NSE did not issue cookies");
  cookieCache = { value, at: Date.now() };
  return value;
}
const n = v => { const x = Number(String(v ?? "").replace(/,/g, "")); return Number.isFinite(x) && String(v ?? "").trim() !== "" ? x : null; };
// "14-Oct-2026 15:29:59" (IST) → ISO
const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
export function nseTime(t) { const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(t || "")); if (!m || !(m[2].toLowerCase() in MON)) return null; return new Date(Date.UTC(+m[3], MON[m[2].toLowerCase()], +m[1], +m[4], +m[5], +(m[6] || 0)) - 5.5 * 3600e3).toISOString(); }
export function parseNseQuote(json) {
  const md = json?.metadata || {}, pi = json?.priceInfo || {};
  return {
    pe: n(md.pdSymbolPe), sectorPe: n(md.pdSectorPe), sector: md.pdSectorInd || null, industry: json?.industryInfo?.basicIndustry || md.industry || null,
    price: n(pi.lastPrice), prevClose: n(pi.previousClose), high52: n(pi.weekHighLow?.max), low52: n(pi.weekHighLow?.min), inav: n(pi.iNavValue), asOf: nseTime(md.lastUpdateTime)
  };
}
// NSE often does not refuse a server, it just never answers (time-outs, dropped connections, no cookies). Three such
// failures in a row count as a block too, so callers stop waiting 8 s per stock and move straight on to Yahoo / Google.
let quietFails = 0;
export async function fetchNseQuote(symbol, fetchImpl = fetch) {
  if (!/^[A-Z0-9&-]+$/.test(symbol)) throw new Error("bad symbol");
  const cd = nseCooldown(); if (cd) throw new NseBlocked(cd);
  try { const q = await nseQuoteOnce(symbol, fetchImpl); quietFails = 0; return q; }
  catch (e) {
    if (!(e instanceof NseBlocked) && e.message !== "bad symbol" && !/HTTP 404/.test(e.message) && ++quietFails >= nseConfig.failsBeforePause) { quietFails = 0; const b = block(`no answer (${String(e.cause?.code || e.name || e.message).slice(0, 40)})`); e.message += `; ${b.message}`; }
    throw e;
  }
}
async function nseQuoteOnce(symbol, fetchImpl) {
  const cookie = await cookies(fetchImpl);
  const res = await fetchImpl(`${NSE_BASE()}/api/quote-equity?symbol=${encodeURIComponent(symbol)}`, withTimeout({ headers: { ...BROWSER, Accept: "*/*", "Sec-Fetch-Dest": "empty", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Site": "same-origin", Referer: `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(symbol)}`, cookie } }));
  if (res.status === 401) { cookieCache = null; throw new Error("NSE session expired (HTTP 401)"); }
  if (res.status === 403 || res.status === 429) throw block("quote API", res.status);
  if (!res.ok) throw new Error(`NSE HTTP ${res.status}`);
  return parseNseQuote(await res.json());
}

// Merge NSE data into a Yahoo entry (or build a minimal entry when Yahoo failed entirely).
export function mergeNse(entry, nse, stock) {
  if (!nse) return entry;
  const symbol = (stock.marketSymbol || stock.ticker || "").toUpperCase();
  const base = entry || (nse.pe && nse.price ? { symbol, price: nse.price, asOf: new Date().toISOString().slice(0, 10), source: "NSE quote API only (no growth/ROCE data)", thin: 1, flags: "Only NSE data (P/E, sector P/E, price): no growth, ROCE or cash-flow figures, so this is a peer-relative check only" } : null);
  if (!base) return entry;
  const out = { ...base };
  if (nse.sectorPe && nse.sectorPe > 0) { out.sectorPe = nse.sectorPe; out.sectorPeSource = "NSE"; }
  if (out.pe === undefined && nse.pe && nse.pe > 0) { out.pe = nse.pe; out.flags = [out.flags, "P/E from NSE"].filter(Boolean).join(" | "); }
  if (!out.sector && nse.sector) out.sector = nse.sector;
  if (!out.industry && nse.industry) out.industry = nse.industry;
  if (out.high52 === undefined && nse.high52) out.high52 = nse.high52;
  if (out.low52 === undefined && nse.low52) out.low52 = nse.low52;
  return out;
}

// Yahoo failed but we already have an older cached entry: keep its statements-derived fields (growth, ROCE,
// cash flow...) and refresh only what NSE gives us today (price, P/E, sector P/E, 52-week range).
export function refreshFromNse(cached, nse) {
  if (!cached || !nse || !(nse.price > 0)) return null;
  const out = { ...cached, price: nse.price, priceDate: new Date().toISOString().slice(0, 10), nseRefreshedAt: new Date().toISOString().slice(0, 10) };
  if (nse.pe && nse.pe > 0) out.pe = nse.pe;
  if (cached.marketCap > 0 && cached.price > 0) out.marketCap = Math.round(cached.marketCap * nse.price / cached.price);
  if (nse.sectorPe && nse.sectorPe > 0) { out.sectorPe = nse.sectorPe; out.sectorPeSource = "NSE"; }
  if (nse.high52) out.high52 = nse.high52;
  if (nse.low52) out.low52 = nse.low52;
  out.flags = [String(cached.flags || "").replace(/ \| Price\/P-E refreshed from NSE.*$/, ""), `Price/P-E refreshed from NSE on ${out.nseRefreshedAt}; statements as of ${cached.asOf || "unknown"}`].filter(Boolean).join(" | ").slice(0, 300);
  return out;
}

// Any NSE JSON API with the same cookie / browser-header handshake and cooldown as the quote call (market-wide lists such as
// 52-week highs, most active securities, volume gainers). Best effort: NSE blocks many non-browser clients.
// soft: a refusal (403 / 429) of this one request does not pause every other NSE request (used for index lists, which
// NSE refuses for some indices while quotes still work)
export async function fetchNseJson(apiPath, { referer = "https://www.nseindia.com/market-data/live-equity-market", fetchImpl = fetch, soft = false } = {}) {
  if (!/^\/api\/[A-Za-z0-9\-_/?=&.%]+$/.test(apiPath)) throw new Error("bad NSE path");
  const cd = nseCooldown(); if (cd) throw new NseBlocked(cd);
  const cookie = await cookies(fetchImpl);
  const res = await fetchImpl(`${NSE_BASE()}${apiPath}`, withTimeout({ headers: { ...BROWSER, Accept: "*/*", "Sec-Fetch-Dest": "empty", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Site": "same-origin", Referer: referer, cookie } }));
  if (res.status === 401) { cookieCache = null; throw new Error("NSE session expired (HTTP 401)"); }
  if (res.status === 403 || res.status === 429) { if (soft) throw Object.assign(new Error(`NSE refused this request (HTTP ${res.status})`), { refused: true }); throw block(apiPath, res.status); }
  if (res.status === 404) throw new Error(`NSE has no ${apiPath} endpoint (404)`);
  if (!res.ok) throw new Error(`NSE HTTP ${res.status}`);
  return res.json();
}

// Daily price history from NSE's historical-data API, in chunks of ~1 year (the most NSE serves per request).
// Rows look like { CH_TIMESTAMP: "2026-10-15", CH_CLOSING_PRICE, CH_TRADE_HIGH_PRICE, CH_TRADE_LOW_PRICE }.
export function parseNseHistory(json) {
  const rows = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
  const num = v => { const x = Number(String(v ?? "").replace(/,/g, "")); return Number.isFinite(x) && x > 0 ? x : null; };
  return rows.map(r => {
    const d = Date.parse(r.CH_TIMESTAMP || r.mTIMESTAMP || r.chTimestamp || r.date || "");
    return { t: Number.isFinite(d) ? Math.floor(d / 1000) : null, c: num(r.CH_CLOSING_PRICE ?? r.chClosingPrice ?? r.close), h: num(r.CH_TRADE_HIGH_PRICE ?? r.chTradeHighPrice ?? r.high), l: num(r.CH_TRADE_LOW_PRICE ?? r.chTradeLowPrice ?? r.low) };
  }).filter(b => b.t && b.c).sort((a, b) => a.t - b.t);
}
export async function fetchNseHistory(symbol, { years = 5, fetchImpl = fetch, pace = fn => fn() } = {}) {
  if (!/^[A-Z0-9&-]+$/.test(symbol)) throw new Error("bad symbol");
  const fmt = d => `${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${d.getUTCFullYear()}`;
  const seen = new Map(); let to = new Date();
  for (let k = 0; k < years; k++) {
    const from = new Date(to.getTime() - 360 * 864e5);
    const path = `/api/historical/cm/equity?symbol=${encodeURIComponent(symbol)}&series=%5B%22EQ%22%5D&from=${fmt(from)}&to=${fmt(to)}`;
    let bars;
    try { bars = parseNseHistory(await pace(() => fetchNseJson(path, { referer: `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(symbol)}`, fetchImpl }))); }
    catch (e) { if (seen.size) break; throw e; } // keep the years already fetched
    if (!bars.length) break;
    for (const b of bars) seen.set(b.t, b);
    to = new Date(from.getTime() - 864e5);
  }
  return [...seen.values()].sort((a, b) => a.t - b.t);
}
