// Trade desk: four checks that sit between a swing idea and an order. Pure functions; the server supplies the data.
//
//   marketRegime   is the market helping? Nifty against its 200 / 50-day averages and how many of the scanned stocks are
//                  above theirs → trade full size, half size, or stay mostly in liquid funds.
//   openRisk       what you lose if every stop is hit today (the "heat"), position and sector concentration.
//   checkTrade     the size a new trade may have: risk per trade, heat left, position / sector caps, cash, the regime.
//   edgeReport     your real results from the brokers' records: win rate, payoff, expectancy, where the money was made
//                  and lost (holding period, trade size, stock, setup and trend at entry), and what ₹X a month needs.
//
// Not advice: arithmetic on your own trades and on public prices.
const fin = v => Number.isFinite(v);
const r0 = v => Math.round(v || 0), r1 = v => (fin(v) ? Math.round(v * 10) / 10 : null), r2 = v => (fin(v) ? Math.round(v * 100) / 100 : null);
const sma = (a, n, end = a.length) => (end >= n ? a.slice(end - n, end).reduce((s, x) => s + x, 0) / n : null);
const inr = v => `₹${Math.abs(Math.round(v)).toLocaleString("en-IN")}`;

export const DESK_DEFAULTS = Object.freeze({ capital: null, riskPct: 1, maxHeatPct: 6, maxPosPct: 25, maxSectorPct: 35, noStopPct: 10, useRegime: true, target: 100000, taxRate: 0.208 });
const amount = v => { if (v === null || v === undefined || v === "") return null; const m = String(v).replace(/[,₹\s]/g, "").match(/^(\d+(?:\.\d+)?)(l|lakh|lac|cr|k)?$/i); if (!m) return NaN; return Number(m[1]) * ({ l: 1e5, lakh: 1e5, lac: 1e5, cr: 1e7, k: 1e3 }[(m[2] || "").toLowerCase()] || 1); };
export function sanitizeDesk(b = {}, prev = {}) {
  const out = { ...DESK_DEFAULTS, ...prev };
  const num = (k, lo, hi, label) => { if (b[k] === undefined) return; const v = Number(String(b[k]).replace(/[%\s]/g, "")); if (!fin(v) || v < lo || v > hi) throw new Error(`${label}: enter a number from ${lo} to ${hi}.`); out[k] = v; };
  if (b.capital !== undefined) { const c = amount(b.capital); if (Number.isNaN(c) || (c !== null && (c < 1000 || c > 1e11))) throw new Error("Swing capital: enter an amount such as 10L (or leave it blank)."); out.capital = c === null ? null : Math.round(c); }
  if (b.target !== undefined) { const t = amount(b.target); if (!fin(t) || t < 1000 || t > 1e9) throw new Error("Monthly target: enter an amount such as 1L."); out.target = Math.round(t); }
  num("riskPct", 0.1, 5, "Risk per trade"); num("maxHeatPct", 1, 30, "Total open risk"); num("maxPosPct", 2, 100, "Largest position"); num("maxSectorPct", 5, 100, "Largest sector"); num("noStopPct", 2, 50, "Loss assumed without a stop");
  if (b.useRegime !== undefined) out.useRegime = !!b.useRegime && b.useRegime !== "0";
  return out;
}

// ---- market regime -------------------------------------------------------------------------------------------------
// nifty: daily closes of the index (or NIFTYBEES), oldest first; snaps: indicator snapshots of the scanned stocks.
export function marketRegime({ nifty = [], snaps = [], asOf = null, indexName = "Nifty" } = {}) {
  const c = (nifty || []).filter(fin), n = c.length, checks = [];
  let index = null;
  if (n >= 200) {
    const price = c[n - 1], s200 = sma(c, 200), s50 = sma(c, 50), ago = n >= 220 ? sma(c, 200, n - 20) : null, hi = Math.max(...c.slice(-252));
    index = { price: r2(price), sma50: r2(s50), sma200: r2(s200), above200: price > s200, above50: price > s50, rising200: ago === null ? null : s200 > ago, vs200Pct: r1((price / s200 - 1) * 100), fromHighPct: r1((price / hi - 1) * 100),
      ret1m: n > 21 ? r1((price / c[n - 22] - 1) * 100) : null, ret3m: n > 63 ? r1((price / c[n - 64] - 1) * 100) : null };
    checks.push({ label: `${indexName} above its 200-day average`, ok: index.above200, pts: 2, detail: `${index.vs200Pct > 0 ? "+" : ""}${index.vs200Pct}% from it` });
    if (index.rising200 !== null) checks.push({ label: `${indexName}'s 200-day average is rising`, ok: index.rising200, pts: 1, detail: index.rising200 ? "long-term trend up" : "long-term trend flat or down" });
    checks.push({ label: `${indexName} above its 50-day average`, ok: index.above50, pts: 1, detail: `${index.fromHighPct}% from its 1-year high` });
  }
  const S = (snaps || []).filter(s => s && fin(s.price) && s.price > 0);
  const share = (need, f) => { const v = S.filter(need); return v.length ? Math.round(v.filter(f).length / v.length * 100) : null; };
  let breadth = null;
  if (S.length >= 20) {
    breadth = { stocks: S.length, above50: share(s => fin(s.sma50), s => s.price > s.sma50), above200: share(s => fin(s.sma200), s => s.price > s.sma200),
      uptrend: share(s => fin(s.sma50) && fin(s.sma200), s => s.sma50 > s.sma200 && s.price > s.sma200),
      nearHigh: S.filter(s => fin(s.high52) && s.price >= s.high52 * 0.97).length, nearLow: S.filter(s => fin(s.low52) && s.price <= s.low52 * 1.05).length };
    if (breadth.above50 !== null) checks.push({ label: "Most stocks above their 50-day average", ok: breadth.above50 >= 60, half: breadth.above50 >= 40 && breadth.above50 < 60, pts: 2, detail: `${breadth.above50}% of ${S.length} scanned stocks` });
    if (breadth.above200 !== null) checks.push({ label: "Most stocks above their 200-day average", ok: breadth.above200 >= 60, pts: 1, detail: `${breadth.above200}%` });
    checks.push({ label: "More stocks near 1-year highs than lows", ok: breadth.nearHigh > breadth.nearLow, pts: 1, detail: `${breadth.nearHigh} near highs · ${breadth.nearLow} near lows` });
  }
  const max = checks.reduce((a, x) => a + x.pts, 0), score = checks.reduce((a, x) => a + (x.ok ? x.pts : x.half ? x.pts / 2 : 0), 0);
  const ratio = max ? score / max : null;
  const mode = ratio === null ? { key: "unknown", label: "Not enough data yet", sizeFactor: 1, tone: "info", advice: "Run the Swing ideas scan once (Swing trading → Scan now): the regime is read from those charts." }
    : ratio >= 0.7 ? { key: "full", label: "Market is helping: full size", sizeFactor: 1, tone: "ok", advice: "Trend and breadth are with you. Take setups at your normal risk per trade; breakouts and momentum work best in this kind of market." }
    : ratio >= 0.4 ? { key: "half", label: "Mixed market: half size", sizeFactor: 0.5, tone: "warn", advice: "Some of the market is weak. Take only the best setups at half your normal risk, prefer pullbacks over breakouts, and book profits sooner." }
    : { key: "defensive", label: "Weak market: stay mostly in liquid funds", sizeFactor: 0.25, tone: "bad", advice: "Most stocks are in downtrends, so breakouts tend to fail. Keep new trades rare and at a quarter of your normal risk; let cash sit in your liquid fund until breadth improves." };
  return { asOf, index, breadth, checks, score: r1(score), max, mode };
}

// ---- open risk -----------------------------------------------------------------------------------------------------
// positions: [{ symbol, name, qty, avg, price, stop, account }]; sectorOf(symbol) → sector name or null
export function openRisk({ positions = [], settings = DESK_DEFAULTS, cash = null, sectorOf = () => null } = {}) {
  const S = { ...DESK_DEFAULTS, ...settings };
  const rows = positions.filter(p => p.qty > 0).map(p => {
    const price = fin(p.price) && p.price > 0 ? p.price : p.avg, value = p.qty * price, hasStop = fin(p.stop) && p.stop > 0;
    const stopState = !hasStop ? "none" : p.stop >= price ? "hit" : "set";
    const risk = stopState === "set" ? p.qty * (price - p.stop) : stopState === "hit" ? 0 : value * S.noStopPct / 100;
    return { symbol: p.symbol, name: p.name || p.symbol, account: p.account || null, qty: p.qty, avg: r2(p.avg), price: r2(price), value: r0(value), stop: hasStop ? r2(p.stop) : null, stopState, stopPct: stopState === "set" ? r1((1 - p.stop / price) * 100) : null,
      risk: r0(risk), locked: hasStop && fin(p.avg) && p.stop >= p.avg, sector: sectorOf(p.symbol) || "Unknown" };
  });
  const value = rows.reduce((a, r) => a + r.value, 0), risk = rows.reduce((a, r) => a + r.risk, 0);
  const capital = fin(S.capital) && S.capital > 0 ? S.capital : value + (fin(cash) && cash > 0 ? cash : 0);
  const pct = v => (capital > 0 ? r1(v / capital * 100) : null);
  for (const r of rows) { r.riskPct = pct(r.risk); r.posPct = pct(r.value); }
  rows.sort((a, b) => b.risk - a.risk);
  const bySector = new Map(); for (const r of rows) bySector.set(r.sector, (bySector.get(r.sector) || 0) + r.value);
  const sectors = [...bySector].map(([sector, v]) => ({ sector, value: r0(v), pct: pct(v) })).sort((a, b) => b.value - a.value);
  const warnings = [], noStop = rows.filter(r => r.stopState === "none"), hit = rows.filter(r => r.stopState === "hit"), heatPct = pct(risk);
  if (hit.length) warnings.push({ level: "bad", text: `${hit.map(r => r.symbol).join(", ")}: the price is at or below your stop-loss. A stop only protects you if you act on it.` });
  if (noStop.length) warnings.push({ level: "bad", text: `${noStop.length} position${noStop.length === 1 ? " has" : "s have"} no stop-loss (${noStop.slice(0, 6).map(r => r.symbol).join(", ")}${noStop.length > 6 ? "…" : ""}), worth ${inr(noStop.reduce((a, r) => a + r.value, 0))}. Each is counted as a ${S.noStopPct}% loss here; decide the exit price before the market decides it for you.` });
  if (heatPct !== null && heatPct > S.maxHeatPct) warnings.push({ level: "bad", text: `Open risk is ${heatPct}% of your swing capital, above your ${S.maxHeatPct}% limit: no new trades until stops are raised or positions are cut.` });
  for (const r of rows) if (r.riskPct !== null && r.stopState === "set" && r.riskPct > S.riskPct * 1.5) warnings.push({ level: "warn", text: `${r.symbol}: ${inr(r.risk)} at risk (${r.riskPct}% of capital), more than your ${S.riskPct}% a trade. Raise the stop or trim.` });
  for (const r of rows) if (r.posPct !== null && r.posPct > S.maxPosPct) warnings.push({ level: "warn", text: `${r.symbol} is ${r.posPct}% of your swing capital (limit ${S.maxPosPct}%).` });
  for (const s of sectors) if (s.sector !== "Unknown" && s.pct !== null && s.pct > S.maxSectorPct && rows.filter(r => r.sector === s.sector).length > 1) warnings.push({ level: "warn", text: `${s.sector}: ${s.pct}% of your swing capital in one sector (limit ${S.maxSectorPct}%). These stocks tend to fall together.` });
  return { capital: r0(capital), capitalSet: fin(S.capital) && S.capital > 0, cash: fin(cash) ? r0(cash) : null, rows, sectors,
    totals: { positions: rows.length, value: r0(value), risk: r0(risk), heatPct, heatRoom: r0(Math.max(0, capital * S.maxHeatPct / 100 - risk)), noStop: noStop.length, investedPct: pct(value) }, warnings };
}

// ---- a new trade ---------------------------------------------------------------------------------------------------
// input: { symbol, entry, stop, target }; ctx: { settings, risk (openRisk result), regime (marketRegime result), snap, sector, eventSoon }
export function checkTrade(input = {}, { settings = DESK_DEFAULTS, risk = null, regime = null, snap = null, sector = null, eventSoon = null } = {}) {
  const S = { ...DESK_DEFAULTS, ...settings }, num = v => Number(String(v ?? "").replace(/[,₹\s]/g, ""));
  const entry = num(input.entry), stop = num(input.stop), target = input.target === undefined || input.target === "" || input.target === null ? null : num(input.target);
  const symbol = String(input.symbol || "").trim().toUpperCase().replace(/^NSE:/, "") || null;
  if (!(entry > 0)) throw new Error("Enter the price you plan to buy at.");
  if (!(stop > 0)) throw new Error("Enter the stop-loss: the price at which you accept the trade is wrong.");
  if (stop >= entry) throw new Error("The stop-loss must be below the buy price.");
  if (target !== null && !(target > entry)) throw new Error("The target must be above the buy price (or leave it blank).");
  const capital = risk?.capital || 0; if (!(capital > 0)) throw new Error("Set your swing capital first (Settings on this page).");
  const rps = entry - stop, stopPct = rps / entry * 100, factor = S.useRegime && regime?.mode ? regime.mode.sizeFactor : 1;
  const allowed = capital * S.riskPct / 100 * factor;
  const held = symbol ? (risk?.rows || []).filter(r => r.symbol === symbol) : [], heldValue = held.reduce((a, r) => a + r.value, 0);
  const sec = sector && sector !== "Unknown" ? sector : null, secValue = sec ? (risk?.sectors || []).find(s => s.sector === sec)?.value || 0 : 0;
  const limits = [
    { key: "risk", label: `${S.riskPct}% risk a trade${factor < 1 ? ` × ${factor} for this market` : ""}`, qty: Math.floor(allowed / rps) },
    { key: "heat", label: `total open risk limit (${S.maxHeatPct}%)`, qty: Math.floor(Math.max(0, capital * S.maxHeatPct / 100 - (risk?.totals?.risk || 0)) / rps) },
    { key: "position", label: `largest position (${S.maxPosPct}%)`, qty: Math.floor(Math.max(0, capital * S.maxPosPct / 100 - heldValue) / entry) },
    ...(sec ? [{ key: "sector", label: `${sec} limit (${S.maxSectorPct}%)`, qty: Math.floor(Math.max(0, capital * S.maxSectorPct / 100 - secValue) / entry) }] : []),
    ...(fin(risk?.cash) ? [{ key: "cash", label: "swing cash on hand", qty: Math.floor(Math.max(0, risk.cash) / entry) }] : [])
  ];
  const lim = limits.reduce((a, x) => (x.qty < a.qty ? x : a)), qty = Math.max(0, lim.qty), byRisk = limits[0].qty;
  const rr = target !== null ? r2((target - entry) / rps) : null;
  const checks = [];
  const add = (ok, label, detail, hard = false) => checks.push({ ok, label, detail, hard: !ok && hard });
  add(stopPct <= 12 && stopPct >= 1, "Stop distance", stopPct > 12 ? `${r1(stopPct)}% away: too wide for a swing trade; the position would be tiny or the loss large` : stopPct < 1 ? `${r1(stopPct)}% away: so tight that normal daily moves will hit it` : `${r1(stopPct)}% below the buy price`);
  if (snap?.atr > 0) add(rps >= snap.atr * 0.75, "Stop against daily movement", rps >= snap.atr * 0.75 ? `${r1(rps / snap.atr)} × the average daily range (₹${snap.atr})` : `only ${r1(rps / snap.atr)} × the average daily range (₹${snap.atr}): likely to be hit by noise`);
  if (rr !== null) add(rr >= 1.5, "Reward against risk", `${rr} : 1 to the target${rr < 1.5 ? ": needs 1.5 or better, or the wins cannot pay for the losses" : ""}`, rr < 1);
  else add(false, "Target", "No target entered: decide where you take profit, so reward against risk can be checked");
  if (snap && fin(snap.sma200)) add(entry > snap.sma200, "Long-term trend", entry > snap.sma200 ? `above its 200-day average (₹${snap.sma200})` : `below its 200-day average (₹${snap.sma200}): buying a downtrend`);
  if (regime?.mode && regime.mode.key !== "unknown") add(regime.mode.key === "full", "Market", regime.mode.label);
  add(lim.key === "risk" || qty >= byRisk, "Room in the portfolio", lim.key === "risk" ? `open risk after this trade: ${r1(((risk?.totals?.risk || 0) + qty * rps) / capital * 100)}% of capital` : `size cut by the ${lim.label}`);
  if (held.length) add(false, "Already held", `you hold ${held.reduce((a, r) => a + r.qty, 0)} shares worth ${inr(heldValue)}: this adds to the same position`);
  if (eventSoon) add(false, "Event ahead", eventSoon);
  const hard = checks.some(c => c.hard), verdict = qty <= 0 || hard ? "skip" : checks.some(c => !c.ok) ? "careful" : "ok";
  return { symbol, entry: r2(entry), stop: r2(stop), target: target === null ? null : r2(target), stopPct: r1(stopPct), rr, qty, amount: r0(qty * entry), riskAmount: r0(qty * rps), riskPct: r2(qty * rps / capital * 100), reward: target !== null ? r0(qty * (target - entry)) : null,
    posPct: r1(qty * entry / capital * 100), limitedBy: lim.key, limitLabel: lim.label, qtyByRisk: byRisk, regimeFactor: factor, limits, checks, verdict,
    summary: qty <= 0 ? `No room for this trade: ${lim.label} is used up.` : hard ? "Skip it: the reward does not pay for the risk." : `Buy up to ${qty} share${qty === 1 ? "" : "s"} (${inr(qty * entry)}). If the stop is hit you lose ${inr(qty * rps)}, ${r2(qty * rps / capital * 100)}% of your swing capital.` };
}

// ---- edge report ---------------------------------------------------------------------------------------------------
const HOLD = [["Intraday (same day)", c => c.intraday || c.days === 0], ["1–5 days", c => c.days >= 1 && c.days <= 5], ["6–20 days", c => c.days >= 6 && c.days <= 20], ["21–60 days", c => c.days >= 21 && c.days <= 60], ["Over 60 days", c => c.days > 60]];
const SIZE = [["Under ₹25,000", c => c.invested < 25000], ["₹25,000 – ₹1 L", c => c.invested >= 25000 && c.invested < 1e5], ["₹1 L – ₹2 L", c => c.invested >= 1e5 && c.invested < 2e5], ["Over ₹2 L", c => c.invested >= 2e5]];
export function tradeStats(list = []) {
  const t = list.filter(c => fin(c.gain)); if (!t.length) return { trades: 0 };
  const wins = t.filter(c => c.gain > 0), losses = t.filter(c => c.gain < 0), sum = a => a.reduce((s, c) => s + c.gain, 0);
  const w = sum(wins), l = -sum(losses), total = w - l, avgWin = wins.length ? w / wins.length : 0, avgLoss = losses.length ? l / losses.length : 0, pcts = t.filter(c => fin(c.pct));
  const payoff = avgLoss > 0 ? avgWin / avgLoss : null;
  return { trades: t.length, wins: wins.length, losses: losses.length, winRate: Math.round(wins.length / t.length * 100), total: r0(total), avgWin: r0(avgWin), avgLoss: r0(avgLoss), payoff: r2(payoff),
    expectancy: r0(total / t.length), avgPct: pcts.length ? r2(pcts.reduce((s, c) => s + c.pct, 0) / pcts.length) : null, profitFactor: l > 0 ? r2(w / l) : null,
    breakEvenWinRate: payoff ? Math.round(100 / (1 + payoff)) : null, avgInvested: r0(t.reduce((s, c) => s + (c.invested || 0), 0) / t.length) };
}
const groupBy = (list, defs) => defs.map(([label, f]) => ({ label, ...tradeStats(list.filter(f)) })).filter(g => g.trades);

// closed: Swing book rows [{ k, symbol, sellDay, buyDay, days, intraday, invested, gain, pct, noDates }] over every year on file
// tags: { [k]: { setup, setupLabel, trendUp, niftyUp } } from the setup check (optional)
export function edgeReport(closed = [], { tags = {}, target = DESK_DEFAULTS.target, taxRate = DESK_DEFAULTS.taxRate, today = new Date().toISOString().slice(0, 10) } = {}) {
  const all = closed.filter(c => fin(c.gain)), dated = all.filter(c => c.sellDay), undated = all.filter(c => !c.sellDay);
  const overall = tradeStats(all);
  if (!all.length) return { trades: 0, overall, findings: [], note: "No closed swing trades on file yet. Import your brokers' tax P&L or tradebook in Swing book." };
  const held = dated.filter(c => c.days !== null && c.days !== undefined);
  const byHold = groupBy(held, HOLD), bySize = groupBy(all.filter(c => c.invested > 0), SIZE);
  const st = new Map(); for (const c of all) { const g = st.get(c.symbol) || st.set(c.symbol, { symbol: c.symbol, name: c.name || c.symbol, trades: 0, wins: 0, total: 0 }).get(c.symbol); g.trades++; g.total += c.gain; if (c.gain > 0) g.wins++; }
  const stocks = [...st.values()].map(g => ({ ...g, total: r0(g.total) })).sort((a, b) => b.total - a.total);
  const best = stocks.filter(s => s.total > 0).slice(0, 5), worst = stocks.filter(s => s.total < 0).slice(-5).reverse(), repeatLosers = stocks.filter(s => s.trades >= 2 && s.total < 0 && s.wins / s.trades < 0.5).length;
  // what the setup check found for each trade (when it has been run)
  const tagged = dated.filter(c => tags[c.k]), has = tagged.length > 0;
  const setups = new Map(); for (const c of tagged) { const l = tags[c.k].setupLabel || "No scanner setup at entry"; (setups.get(l) || setups.set(l, []).get(l)).push(c); }
  const bySetup = has ? [...setups].map(([label, l]) => ({ label, ...tradeStats(l) })).sort((a, b) => (a.label.startsWith("No ") ? 1 : 0) - (b.label.startsWith("No ") ? 1 : 0) || b.trades - a.trades) : [];
  const byTrend = has ? groupBy(tagged.filter(c => tags[c.k].trendUp !== null && tags[c.k].trendUp !== undefined), [["With the trend (above the 200-day average)", c => tags[c.k].trendUp], ["Against the trend", c => !tags[c.k].trendUp]]) : [];
  const byMarket = has ? groupBy(tagged.filter(c => tags[c.k].niftyUp !== null && tags[c.k].niftyUp !== undefined), [["Bought while Nifty was above its 200-day average", c => tags[c.k].niftyUp], ["Bought while Nifty was below it", c => !tags[c.k].niftyUp]]) : [];
  // the last 12 months: pace, and what the monthly target needs
  const cut = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`, recent = dated.filter(c => c.sellDay >= cut), R = tradeStats(recent);
  const first = recent.length ? recent.reduce((a, c) => (c.sellDay < a ? c.sellDay : a), today) : today;
  const months = Math.max(1, Math.min(12, Math.round((Date.parse(today) - Date.parse(first)) / 864e5 / 30.4) || 1));
  const preTax = target / (1 - taxRate), perMonth = R.trades ? R.total / months : 0, tradesPerMonth = R.trades ? R.trades / months : 0;
  const plan = { target, preTax: r0(preTax), months, trades: R.trades || 0, perMonth: r0(perMonth), tradesPerMonth: r1(tradesPerMonth), expectancy: R.expectancy ?? null, avgInvested: R.avgInvested ?? null,
    tradesNeeded: R.expectancy > 0 ? Math.ceil(preTax / R.expectancy) : null, sizeMultiple: perMonth > 0 ? r1(preTax / perMonth) : null,
    positionNeeded: perMonth > 0 && R.avgInvested ? r0(R.avgInvested * preTax / perMonth) : null };
  // plain findings, most useful first
  const F = [], o = overall, lossesSorted = all.filter(c => c.gain < 0).sort((a, b) => a.gain - b.gain), grossLoss = -lossesSorted.reduce((s, c) => s + c.gain, 0);
  if (o.trades < 30) F.push({ tone: "info", text: `Only ${o.trades} closed trade${o.trades === 1 ? "" : "s"} on file: treat everything below as a hint, not proof. Around 30 trades are needed before the numbers settle.` });
  if (o.payoff !== null && o.breakEvenWinRate !== null) F.push(o.winRate >= o.breakEvenWinRate
    ? { tone: "ok", text: `You win ${o.winRate}% of trades and an average win (${inr(o.avgWin)}) is ${o.payoff}× an average loss (${inr(o.avgLoss)}). With that payoff you only need ${o.breakEvenWinRate}% wins to break even, so the system makes ${inr(o.expectancy)} a trade.` }
    : { tone: "bad", text: `You win ${o.winRate}% of trades, but an average loss (${inr(o.avgLoss)}) is too big against an average win (${inr(o.avgWin)}): at that payoff you need ${o.breakEvenWinRate}% wins just to break even. Cut losses sooner or let winners run further.` });
  if (lossesSorted.length >= 4) { const top = lossesSorted.slice(0, 3), share = Math.round(-top.reduce((s, c) => s + c.gain, 0) / grossLoss * 100); if (share >= 45) F.push({ tone: "warn", text: `Your 3 biggest losses (${top.map(c => `${c.symbol} ${inr(c.gain)}`).join(", ")}) are ${share}% of all your losses. A fixed loss limit per trade would have removed most of the damage.` }); }
  const pick = (groups, min = 3) => { const g = groups.filter(x => x.trades >= min); return g.length >= 2 ? { best: g.reduce((a, x) => (x.expectancy > a.expectancy ? x : a)), worst: g.reduce((a, x) => (x.expectancy < a.expectancy ? x : a)) } : null; };
  const h = pick(byHold); if (h && h.best.label !== h.worst.label) F.push({ tone: h.worst.expectancy < 0 ? "warn" : "info", text: `Holding period: "${h.best.label}" trades made ${inr(h.best.expectancy)} each (${h.best.winRate}% won); "${h.worst.label}" ${h.worst.expectancy < 0 ? "lost" : "made only"} ${inr(h.worst.expectancy)} each (${h.worst.winRate}% won).` });
  const z = pick(bySize); if (z && z.worst.expectancy < 0 && z.best.label !== z.worst.label) F.push({ tone: "warn", text: `Trade size: your "${z.worst.label}" trades lost ${inr(z.worst.expectancy)} each on average, while "${z.best.label}" made ${inr(z.best.expectancy)}.` });
  const t = byTrend.length === 2 ? byTrend : null; if (t && t[1].trades >= 3) F.push({ tone: t[1].expectancy < t[0].expectancy ? "warn" : "info", text: `Trend at entry: ${t[0].trades} trades bought above the 200-day average made ${inr(t[0].expectancy)} each; ${t[1].trades} bought below it ${t[1].expectancy < 0 ? "lost" : "made"} ${inr(t[1].expectancy)} each.` });
  const noSetup = bySetup.find(x => x.label.startsWith("No ")), withSetup = has ? tradeStats(tagged.filter(c => tags[c.k].setup)) : null;
  if (noSetup && withSetup?.trades >= 3 && noSetup.trades >= 3) F.push({ tone: withSetup.expectancy > noSetup.expectancy ? "warn" : "info", text: `${withSetup.trades} trades were bought when one of the scanner's setups was on and made ${inr(withSetup.expectancy)} each; ${noSetup.trades} without a setup ${noSetup.expectancy < 0 ? "lost" : "made"} ${inr(noSetup.expectancy)} each.` });
  if (repeatLosers >= 2) F.push({ tone: "info", text: `${repeatLosers} stocks lost money over two or more trades (see "Stocks that cost you most"). Going back to a stock that keeps failing is a common leak.` });
  return { trades: all.length, overall, dated: dated.length, undated: { trades: undated.length, gain: r0(undated.reduce((s, c) => s + c.gain, 0)) }, from: dated.length ? dated.reduce((a, c) => (c.sellDay < a ? c.sellDay : a), today) : null,
    byHold, bySize, bySetup, byTrend, byMarket, tagged: tagged.length, best, worst, plan, findings: F.slice(0, 7) };
}
