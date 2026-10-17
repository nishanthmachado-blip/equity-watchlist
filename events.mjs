// Upcoming company events (results, board meetings, dividends, bonuses, splits) and what they mean for a swing position:
// a short decision under each stock ("wait for the dividend", "results in 3 days: book part first"…). Pure functions.
import { caDay } from "./corpactions.mjs";

const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
const fmt = d => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const inr = v => `₹${Math.round(v).toLocaleString("en-IN")}`;
const px = v => `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

// NSE /api/event-calendar rows: { symbol, company, purpose: "Financial Results", bm_desc, date: "23-Oct-2026" }
export function parseNseEvents(json) {
  const rows = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
  return rows.map(r => {
    const purpose = String(r.purpose || r.bm_purpose || "").trim(), desc = String(r.bm_desc || r.desc || "").replace(/\s+/g, " ").trim();
    const results = /result/i.test(purpose) || /financial result/i.test(desc);
    const div = /dividend/i.test(purpose) || (/dividend/i.test(desc) && !results);
    return { symbol: String(r.symbol || "").toUpperCase(), date: caDay(r.date || r.bm_date), kind: results ? "results" : div ? "board-dividend" : /bonus|split/i.test(purpose + desc) ? "board-capital" : /fund raising|qip|preferential/i.test(purpose + desc) ? "fund-raise" : "board", label: results ? "Results (board meeting)" : purpose || "Board meeting", detail: desc.slice(0, 200), source: "NSE" };
  }).filter(e => e.symbol && e.date);
}
// Yahoo quoteSummary calendarEvents → results date and next ex-dividend date
export function parseYahooCalendar(symbol, json) {
  const r = json?.quoteSummary?.result?.[0] || {}, ce = r.calendarEvents || {}, out = [];
  const day = v => (v?.raw ? new Date(v.raw * 1000).toISOString().slice(0, 10) : null);
  const ed = (ce.earnings?.earningsDate || []).map(day).filter(Boolean);
  if (ed.length) out.push({ symbol, date: ed[0], kind: "results", label: ed.length > 1 ? "Results (expected window)" : "Results (expected)", detail: ed.length > 1 ? `Expected between ${ed[0]} and ${ed.at(-1)}` : "", source: "Yahoo", estimate: true });
  const ex = day(ce.exDividendDate); if (ex) out.push({ symbol, date: ex, kind: "exdiv", label: "Ex-dividend date", amount: r.summaryDetail?.lastDividendValue?.raw ?? r.defaultKeyStatistics?.lastDividendValue?.raw ?? null, source: "Yahoo" });
  return out;
}
// Combine board-meeting events and corporate actions into one dated list per symbol (upcoming and the last 14 days)
export function eventsFor(symbol, { events = [], actions = [], today, pastDays = 14, aheadDays = 60 } = {}) {
  const list = [];
  for (const e of events) if (e.symbol === symbol && e.date) list.push({ ...e });
  for (const a of actions) if (a.symbol === symbol && a.exDate) list.push({ symbol, date: a.exDate, kind: a.kind, label: a.label, amount: a.amount ?? null, factor: a.factor ?? null, recordDate: a.recordDate || null, source: a.source });
  // Yahoo's ex-dividend date duplicates an NSE dividend action on the same day
  const seen = new Set(), out = [];
  for (const e of list.sort((a, b) => a.date.localeCompare(b.date) || (a.source === "NSE" ? -1 : 1))) {
    const k = `${e.date}:${e.kind === "exdiv" ? "dividend" : e.kind}`; if (seen.has(k)) continue; seen.add(k);
    const d = daysBetween(today, e.date); if (d < -pastDays || d > aheadDays) continue;
    out.push({ ...e, kind: e.kind === "exdiv" ? "dividend" : e.kind, days: d });
  }
  return out;
}
// The decision for one swing position, given its evaluated row (status, price, pnlPct, stopLoss, plan) and its events.
// Returns { headline, tone, items: [{ icon, text }] } or null when nothing is coming up.
export function swingEventAdvice(row, evs, { slabRate = null } = {}) {
  if (!evs?.length) return null;
  const items = []; let headline = null, tone = "info", rank = 0;
  const set = (h, t, r) => { if (r > rank) { headline = h; tone = t; rank = r; } };
  const st = row.status || "", up = Number(row.pnlPct) || 0, qty = row.qty || 0, price = row.price || 0;
  const stopHit = st === "stop-hit" || st === "near-stop", atProfit = st === "take-profit" || st === "near-profit" || up >= 8;
  for (const e of evs) {
    const when = e.days === 0 ? "today" : e.days === 1 ? "tomorrow" : e.days > 0 ? `in ${e.days} days` : `${-e.days} day${e.days === -1 ? "" : "s"} ago`;
    if (e.kind === "results" || e.kind === "board-dividend") {
      if (e.days < 0) { items.push({ icon: "📊", text: `${e.label} were on ${fmt(e.date)} (${when}). Check the reaction before adding.` }); continue; }
      const extra = e.kind === "board-dividend" && !/result/i.test(e.label) ? " (may declare a dividend)" : "";
      let adv;
      if (stopHit) { adv = `Near your stop-loss with results ${when}: a weak result can gap it below your stop. Decide before ${fmt(e.date)}: exit, or accept the gap risk.`; set(`Results ${when}: near your stop, decide before`, "bad", 5); }
      else if (atProfit) { adv = `You are up ${up.toFixed(1)}%. Results can move the price 5–10% either way: consider booking part (your plan's next tranche) before ${fmt(e.date)}, or move the stop up to protect the gain.`; set(`Results ${when}: protect the gain`, "warn", 4); }
      else { adv = `Expect a bigger move than usual around ${fmt(e.date)}. Avoid adding until the results are out.`; set(`Results ${when}`, "info", 2); }
      items.push({ icon: "📊", text: `${e.label} ${fmt(e.date)}${e.estimate ? " (expected)" : ""}${extra}. ${adv}` });
    } else if (e.kind === "dividend") {
      const amt = Number(e.amount) || null, income = amt ? amt * qty : null, yieldPct = amt && price ? (amt / price) * 100 : null;
      if (e.days < 0) { items.push({ icon: "💰", text: `Went ex-dividend on ${fmt(e.date)}${amt ? ` (${px(amt)} a share${income ? `, ${inr(income)} for your ${qty} shares if you held them the day before` : ""})` : ""}. The price drop that day was the dividend being paid out, not a loss.` }); continue; }
      const what = amt ? `${e.label} ${px(amt)} a share = ${inr(income)} on your ${qty} shares${yieldPct ? ` (${yieldPct.toFixed(2)}% of the price)` : ""}` : `${e.label} (amount not announced yet)`;
      const howTo = `To get it, hold the shares at the end of ${fmt(prevWeekday(e.date))}; you can sell on the ex-date ${fmt(e.date)} itself and still be paid.`;
      const caveat = `On the ex-date the price usually drops by about the dividend, and the dividend is taxed at your income-tax slab${slabRate ? ` (${slabRate}%)` : ""}, so waiting is not free money.`;
      if (stopHit) { items.push({ icon: "💰", text: `${what}, ex-date ${fmt(e.date)} (${when}). Don't hold a stock at its stop-loss just for this: the stop matters more.` }); set(`Dividend ${when}, but you are at the stop`, "bad", 3); }
      else if (atProfit && e.days <= 10) { items.push({ icon: "💰", text: `${what}. ${howTo} Selling a little later to collect it makes sense if you were going to hold a few more days anyway. ${caveat}` }); set(`Wait for the dividend: sell on or after ${fmt(e.date)}`, "good", yieldPct >= 0.5 ? 4 : 3); }
      else { items.push({ icon: "💰", text: `${what}, ex-date ${fmt(e.date)} (${when}). ${howTo}` }); set(`Dividend ex-date ${fmt(e.date)}${income ? ` (${inr(income)})` : ""}`, "good", 2); }
    } else if (e.kind === "bonus" || e.kind === "split") {
      if (e.days < 0) continue; // shown as an applied adjustment
      items.push({ icon: "🎁", text: `${e.label} on ${fmt(e.date)} (${when}): your shares will become about ${Math.floor(qty * (e.factor || 1))} and the price about ${px(price / (e.factor || 1))}. Nothing to do: the app adjusts the quantity, average and stop-loss on the ex-date.` });
      set(`${e.label} ${when}: adjusted automatically`, "info", 2);
    } else if (e.kind === "rights" || e.kind === "buyback" || e.kind === "fund-raise" || e.kind === "demerger") {
      if (e.days < 0) continue;
      items.push({ icon: "📌", text: `${e.label} (${fmt(e.date)}, ${when}). Check the terms: it can change the share count or the price.` }); set(`${e.label} ${when}`, "info", 1);
    } else if (e.days >= 0) items.push({ icon: "🗓", text: `${e.label} on ${fmt(e.date)} (${when})${e.detail ? `: ${e.detail.slice(0, 120)}` : ""}.` });
  }
  for (const a of row.adjustments || []) if (daysBetween(a.exDate, new Date().toISOString().slice(0, 10)) <= 14) items.unshift({ icon: "✅", text: `Adjusted for ${a.label} on ${fmt(a.exDate)}: ${a.from.qty} → ${a.to.qty} shares, average ${px(a.from.avgPrice)} → ${px(a.to.avgPrice)}.` });
  if (!items.length) return null;
  return { headline: headline || items[0].text.split(".")[0], tone, items };
}
function prevWeekday(day) { const d = new Date(`${day}T12:00:00Z`); do d.setUTCDate(d.getUTCDate() - 1); while (d.getUTCDay() === 0 || d.getUTCDay() === 6); return d.toISOString().slice(0, 10); }
