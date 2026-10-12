// Google Finance quote provider (best effort).
// Google has no public Finance API, so this reads the public quote page
// https://www.google.com/finance/quote/<SYMBOL>:NSE the same way a browser does. The page layout can
// change without notice: when the price cannot be found we throw "layout not recognised" rather than
// return a wrong number, and callers fall back to the next price source. Personal research use only;
// respect Google's terms. For an officially supported route use Google Sheets' GOOGLEFINANCE() function.
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
let cooldownUntil = 0;
export const googleConfig = { cooldownMs: 10 * 60 * 1000, timeoutMs: 12000, exchange: process.env.GOOGLE_FINANCE_EXCHANGE || "NSE" };
export class GoogleBlocked extends Error { constructor(until, detail) { super(`Google Finance is throttling this connection${detail ? ` (${detail})` : ""}; pausing until ${new Date(until).toLocaleTimeString("en-IN")}`); this.rateLimited = true; } }
export function googleCooldown(now = Date.now()) { return cooldownUntil > now ? cooldownUntil : 0; }
export function resetGoogle() { cooldownUntil = 0; }

const num = v => { const x = Number(String(v ?? "").replace(/[₹,\s]/g, "")); return Number.isFinite(x) && String(v ?? "").trim() !== "" ? x : null; };

// Pulls the latest price (and the 52-week range / previous close when present) out of the quote page HTML.
export function parseGoogleQuote(html) {
  if (typeof html !== "string" || html.length < 200) throw new Error("Google Finance: empty page");
  if (/consent\.google\.com|Before you continue to Google/i.test(html)) throw new Error("Google Finance: consent page returned instead of the quote");
  // 1) Structured attribute on the quote container; 2) the big price element as a fallback.
  let price = num(html.match(/data-last-price="([\d.,]+)"/)?.[1]);
  if (price === null) price = num(html.match(/class="[^"]*\bYMlKec\b[^"]*\bfxKbKc\b[^"]*"[^>]*>\s*(?:₹|Rs\.?\s*)?([\d,]+(?:\.\d+)?)\s*</)?.[1]);
  if (!(price > 0)) throw new Error("Google Finance: layout not recognised (no price found)");
  const currency = html.match(/data-currency-code="([A-Z]{3})"/)?.[1] || null;
  if (currency && currency !== "INR") throw new Error(`Google Finance: quote is in ${currency}, not INR (wrong instrument?)`);
  const range = html.match(/Year range[\s\S]{0,400}?>\s*(?:₹|Rs\.?\s*)?([\d,]+(?:\.\d+)?)\s*-\s*(?:₹|Rs\.?\s*)?([\d,]+(?:\.\d+)?)\s*</i);
  const low = range ? num(range[1]) : null, high = range ? num(range[2]) : null;
  const prevClose = num(html.match(/Previous close[\s\S]{0,400}?>\s*(?:₹|Rs\.?\s*)?([\d,]+(?:\.\d+)?)\s*</i)?.[1]);
  const ts = Number(html.match(/data-last-normal-market-timestamp="(\d+)"/)?.[1]);
  return { price, low: low && high && low <= high ? low : null, high: low && high && low <= high ? high : null, prevClose, currency, asOf: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : null };
}

export async function fetchGoogleQuote(symbol, { exchange = googleConfig.exchange, fetchImpl = fetch } = {}) {
  const now = Date.now();
  if (googleCooldown(now)) throw new GoogleBlocked(cooldownUntil, "cooling down");
  const sym = String(symbol || "").trim().toUpperCase();
  if (!/^[A-Z0-9&-]{1,20}$/.test(sym)) throw new Error(`Google Finance: invalid symbol "${symbol}"`);
  const url = `https://www.google.com/finance/quote/${encodeURIComponent(`${sym}:${exchange}`)}?hl=en`;
  const response = await fetchImpl(url, { headers: { "User-Agent": UA, "Accept-Language": "en-IN,en;q=0.9", Accept: "text/html", Cookie: "CONSENT=YES+" }, signal: AbortSignal.timeout(googleConfig.timeoutMs), redirect: "follow" });
  if (response.status === 429 || response.status === 403) { cooldownUntil = Date.now() + googleConfig.cooldownMs; throw new GoogleBlocked(cooldownUntil, `HTTP ${response.status}`); }
  if (response.status === 404) throw new Error(`Google Finance: ${sym}:${exchange} not found`);
  if (!response.ok) throw new Error(`Google Finance: HTTP ${response.status}`);
  return { ...parseGoogleQuote(await response.text()), symbol: sym, source: "Google Finance" };
}
