// Swing overlay: 50/200-day averages, golden cross, RSI(14) and a 20-day volume breakout, from daily bars.
// bars: [{ c, h, l, v }] oldest first. Pure; the fetch helper below pulls a year of bars from Yahoo's public chart endpoint.
const fin = v => Number.isFinite(v);
const r1 = v => Math.round(v * 10) / 10;
const sma = (a, n, end = a.length) => (end >= n ? a.slice(end - n, end).reduce((s, x) => s + x, 0) / n : null);

export function rsi14(closes) {
  if (closes.length < 15) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= 14; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) gain += d; else loss -= d; }
  gain /= 14; loss /= 14;
  for (let i = 15; i < closes.length; i++) { const d = closes[i] - closes[i - 1]; gain = (gain * 13 + Math.max(d, 0)) / 14; loss = (loss * 13 + Math.max(-d, 0)) / 14; }
  return loss === 0 ? 100 : r1(100 - 100 / (1 + gain / loss));
}

export function computeTechnicals(bars) {
  const b = (bars || []).filter(x => x && fin(x.c));
  if (b.length < 60) return { setup: "No data", notes: [`Only ${b.length} daily bars available.`] };
  const closes = b.map(x => x.c), price = closes.at(-1);
  const sma50 = sma(closes, 50), sma200 = sma(closes, 200);
  const rsi = rsi14(closes);
  let crossDaysAgo = null;
  if (b.length >= 201) {
    for (let i = closes.length - 1; i >= 200; i--) {
      const a1 = sma(closes, 50, i + 1) > sma(closes, 200, i + 1), a0 = sma(closes, 50, i) > sma(closes, 200, i);
      if (a1 !== a0) { crossDaysAgo = closes.length - 1 - i; break; }
    }
  }
  const golden = sma50 !== null && sma200 !== null ? sma50 > sma200 : null;
  const last21 = b.slice(-21, -1), priorHigh = last21.length ? Math.max(...last21.map(x => x.h ?? x.c)) : null;
  const vols = last21.map(x => x.v).filter(fin), avgVol = vols.length ? vols.reduce((s, x) => s + x, 0) / vols.length : null, lastVol = b.at(-1).v;
  const breakout = priorHigh !== null && price > priorHigh && fin(lastVol) && avgVol > 0 && lastVol >= 1.5 * avgVol;
  const high52 = Math.max(...b.slice(-252).map(x => x.h ?? x.c));
  const out = { price: r1(price), sma50: sma50 && r1(sma50), sma200: sma200 && r1(sma200), rsi: rsi, goldenCross: golden, crossDaysAgo, aboveSma50: sma50 ? price > sma50 : null, aboveSma200: sma200 ? price > sma200 : null, breakout20: !!breakout, pctFrom52wHigh: r1((price / high52 - 1) * 100) };
  const notes = [];
  if (golden === true) notes.push(`50 DMA above 200 DMA${crossDaysAgo !== null ? ` (crossed ${crossDaysAgo} trading days ago)` : ""}`); else if (golden === false) notes.push("50 DMA below 200 DMA (downtrend)"); else notes.push("Less than 200 days of history: no golden-cross reading");
  if (rsi !== null) notes.push(`RSI(14) ${rsi}`);
  if (breakout) notes.push("Closed above its 20-day high on 1.5x+ average volume");
  notes.push(`${out.pctFrom52wHigh}% from the 52-week high`);
  out.notes = notes;
  if (breakout && out.aboveSma50) out.setup = "Breakout";
  else if (golden && rsi !== null && rsi > 50 && out.aboveSma50) out.setup = "Swing setup";
  else if (out.aboveSma200 === false) out.setup = "Weak trend";
  else out.setup = "Neutral";
  return out;
}

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
export function parseYahooBars(json) {
  const r = json?.chart?.result?.[0], q = r?.indicators?.quote?.[0];
  if (!r || !q) return [];
  return (r.timestamp || []).map((t, i) => ({ t, c: q.close?.[i], h: q.high?.[i], l: q.low?.[i], v: q.volume?.[i] })).filter(x => fin(x.c));
}
import { createBackoff } from "./backoff.mjs";
// Yahoo chart service: once it says "too many requests", stop asking until the pause ends (asking extends the ban)
export const chartBackoff = createBackoff();
export const chartCooldown = () => chartBackoff.until();
const CHART_BASE = () => (process.env.YAHOO_CHART_BASE || "https://query1.finance.yahoo.com").replace(/\/+$/, "");
// Daily bars plus Yahoo's instrument details (instrumentType "ETF", long name). range: 1y | 2y | 5y | max
export async function fetchChart(symbol, { fetchImpl = fetch, exchange = "NSE", range = "1y", events = false, raw = false } = {}) {
  // raw: the symbol is already a Yahoo symbol (an index such as ^NSEI); events: include dividends and splits
  const path = `/v8/finance/chart/${encodeURIComponent(raw ? symbol : symbol + (exchange === "BSE" ? ".BO" : ".NS"))}?range=${range}&interval=1d${events ? "&events=div%7Csplit" : ""}`;
  if (chartBackoff.until()) { const e = new Error(`Yahoo is rate-limiting price-history requests (paused until ${new Date(chartBackoff.until()).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })}).`); e.rateLimited = true; e.paused = true; throw e; }
  const get = base => fetchImpl(base + path, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  let res = await get(CHART_BASE());
  if (res.status === 429 && !process.env.YAHOO_CHART_BASE) res = await get("https://query2.finance.yahoo.com"); // Yahoo's second host often still answers
  if (res.status === 429) { chartBackoff.block("HTTP 429"); const e = new Error("Yahoo is rate-limiting price-history requests."); e.rateLimited = true; throw e; }
  if (res.status === 404) throw new Error(`Yahoo has no price history for ${symbol}.`);
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  const json = await res.json(), meta = json?.chart?.result?.[0]?.meta || {}; chartBackoff.ok();
  const n = v => (Number.isFinite(v) ? v : null);
  return { bars: parseYahooBars(json), events: json?.chart?.result?.[0]?.events || {}, meta: { instrumentType: meta.instrumentType || null, longName: meta.longName || meta.shortName || null, currency: meta.currency || null, price: n(meta.regularMarketPrice), time: n(meta.regularMarketTime), prevClose: n(meta.chartPreviousClose ?? meta.previousClose), high52: n(meta.fiftyTwoWeekHigh), low52: n(meta.fiftyTwoWeekLow), symbol: meta.symbol || null } };
}
export async function fetchBars(symbol, opts = {}) { return (await fetchChart(symbol, opts)).bars; }
