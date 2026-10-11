// Dividend lens: yield, consistency, growth, payout and a "safety" rating from a stock's dividend history.
// History comes from Yahoo's public chart endpoint (events=div); the maths below is pure and tested offline.
const fin = v => Number.isFinite(v);
const r1 = v => Math.round(v * 10) / 10;

// events: [{ d: "YYYY-MM-DD", a: amountPerShare }]. price/eps/profitCagr3 are optional context.
export function computeDividends(events, { price = null, pe = null, profitCagr3 = null, now = new Date() } = {}) {
  const list = (events || []).filter(e => e && fin(e.a) && e.a > 0 && /^\d{4}-\d{2}-\d{2}$/.test(e.d || ""));
  if (!list.length) return { safety: "None", yield: 0, note: "No dividend history found." };
  const nowT = now.getTime(), yearAgo = nowT - 365 * 864e5;
  const ttm = list.filter(e => { const t = new Date(e.d).getTime(); return t > yearAgo && t <= nowT; }).reduce((s, e) => s + e.a, 0);
  const annual = {};
  for (const e of list) { const y = Number(e.d.slice(0, 4)); annual[y] = (annual[y] || 0) + e.a; }
  const lastFull = now.getUTCFullYear() - 1;
  let streak = 0; for (let y = lastFull; y > lastFull - 10 && annual[y] > 0; y--) streak++;
  const a0 = annual[lastFull], a5 = annual[lastFull - 5];
  const cagr5 = a0 > 0 && a5 > 0 ? r1((Math.pow(a0 / a5, 1 / 5) - 1) * 100) : null;
  let cut = false;
  for (let y = lastFull; y > lastFull - 5; y--) if (annual[y - 1] > 0 && annual[y] !== undefined && annual[y] < annual[y - 1] * 0.75) cut = true;
  const yld = fin(price) && price > 0 ? r1((ttm / price) * 100) : null;
  const eps = fin(price) && fin(pe) && pe > 0 ? price / pe : null;
  const payout = eps ? r1((ttm / eps) * 100) : null;
  const notes = [];
  let safety;
  if (ttm <= 0) { safety = "None"; notes.push("No dividend in the last 12 months."); }
  else if ((payout !== null && payout > 90) || cut || (fin(profitCagr3) && profitCagr3 < 0)) {
    safety = "At risk";
    if (payout !== null && payout > 90) notes.push(`Payout ${payout}% of earnings leaves little cushion`);
    if (cut) notes.push("Dividend was cut by 25%+ in a recent year");
    if (fin(profitCagr3) && profitCagr3 < 0) notes.push("Profits are shrinking");
  } else if (streak >= 5 && (payout === null || payout <= 60)) { safety = "Safe"; notes.push(`Paid ${streak} years running${payout !== null ? `, payout ${payout}%` : ""}`); }
  else { safety = "Watch"; notes.push(streak < 5 ? `Only ${streak} year${streak === 1 ? "" : "s"} of unbroken payments` : `Payout ${payout}% is on the high side`); }
  // Usual payment months: average per-share payout in each calendar month over the last three full years.
  const recentYears = [lastFull - 2, lastFull - 1, lastFull].filter(y => annual[y] > 0);
  const calendar = Array(12).fill(0);
  for (const e of list) { const y = Number(e.d.slice(0, 4)); if (recentYears.includes(y)) calendar[Number(e.d.slice(5, 7)) - 1] += e.a / recentYears.length; }
  return { safety, yield: yld ?? 0, ttm: Math.round(ttm * 100) / 100, streakYears: streak, cagr5, payout, cut, annual, calendar: calendar.map(v => Math.round(v * 100) / 100), note: notes.join(". ") };
}

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
export function parseYahooDividends(json) {
  const divs = json?.chart?.result?.[0]?.events?.dividends;
  if (!divs) return [];
  return Object.values(divs).map(x => ({ d: new Date(x.date * 1000).toISOString().slice(0, 10), a: Number(x.amount) })).filter(e => e.a > 0).sort((a, b) => a.d.localeCompare(b.d));
}
export async function fetchDividendEvents(symbol, { fetchImpl = fetch, exchange = "NSE" } = {}) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol + (exchange === "BSE" ? ".BO" : ".NS"))}?range=8y&interval=1mo&events=div`;
  const res = await fetchImpl(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12000) });
  if (res.status === 429) { const e = new Error("Yahoo is rate-limiting dividend requests."); e.rateLimited = true; throw e; }
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  return parseYahooDividends(await res.json());
}

// Same lens from Screener's yearly figures (dividend per share = EPS × payout %), used when the dated Yahoo history is not
// available. Yearly data has no payment dates, so `calendar` is null (the planner then spreads income evenly).
export function dividendsFromAnnual(divAnnual, { price = null, profitCagr3 = null, dividendYield = null } = {}) {
  const yrs = (divAnnual || []).filter(x => Number.isFinite(x?.year) && Number.isFinite(x?.dps)).sort((a, b) => a.year - b.year);
  if (!yrs.length) return null;
  const last = yrs.at(-1), ttm = last.dps, annual = Object.fromEntries(yrs.map(x => [x.year, x.dps]));
  let streak = 0; for (let i = yrs.length - 1; i >= 0 && yrs[i].dps > 0; i--) streak++;
  const five = yrs.length > 5 ? yrs.at(-6) : null;
  const cagr5 = five && five.dps > 0 && ttm > 0 ? r1((Math.pow(ttm / five.dps, 1 / 5) - 1) * 100) : null;
  let cut = false; for (let i = Math.max(1, yrs.length - 5); i < yrs.length; i++) if (yrs[i - 1].dps > 0 && yrs[i].dps < yrs[i - 1].dps * 0.75) cut = true;
  const payout = fin(last.payout) ? r1(last.payout) : null;
  const yld = fin(dividendYield) ? r1(dividendYield) : fin(price) && price > 0 ? r1(ttm / price * 100) : 0;
  const notes = []; let safety;
  if (!(ttm > 0)) { safety = "None"; notes.push(`No dividend in ${last.label || last.year}.`); }
  else if ((payout !== null && payout > 90) || cut || (fin(profitCagr3) && profitCagr3 < 0)) {
    safety = "At risk";
    if (payout !== null && payout > 90) notes.push(`Payout ${payout}% of earnings leaves little cushion`);
    if (cut) notes.push("Dividend was cut by 25%+ in a recent year");
    if (fin(profitCagr3) && profitCagr3 < 0) notes.push("Profits are shrinking");
  } else if (streak >= 5 && (payout === null || payout <= 60)) { safety = "Safe"; notes.push(`Paid ${streak} years running${payout !== null ? `, payout ${payout}%` : ""}`); }
  else { safety = "Watch"; notes.push(streak < 5 ? `Only ${streak} year${streak === 1 ? "" : "s"} of unbroken payments` : `Payout ${payout}% is on the high side`); }
  return { safety, yield: yld, ttm: Math.round(ttm * 100) / 100, streakYears: streak, cagr5, payout, cut, annual, calendar: null, source: `Screener (yearly, ${last.label || last.year})`, note: notes.join(". ") };
}
