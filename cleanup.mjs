// Holdings clean-up review: one clear call per stock you hold (Keep, Add, Trim or Exit) with the reasons behind it.
// Starts from the holding's stance (valuation, buy zone, thesis, your watchlist rating, weight) and adds four checks the
// stance does not make: the long-term trend (price vs a rising / falling 200-day average), how much of the stock you
// already own through your mutual funds (X-ray), what selling would cost in tax today (short / long term, and how many
// days until the short-term shares turn long-term), and whether a loss could cancel short-term gains you booked this
// year. Tiny positions (too small to matter) are flagged: bring them to a real size or let them go.
// Pure: the server supplies holdings, daily-bar technicals, the look-through and the tax rows. Not advice.
import { TAX_RULES } from "./tax.mjs";

const fin = v => Number.isFinite(v);
const r1 = v => (fin(v) ? Math.round(v * 10) / 10 : null);
const inr = v => `₹${Math.round(Math.abs(v)).toLocaleString("en-IN")}`;
export const CLEANUP_RULES = Object.freeze({ tinyRupees: 5000, tinyPct: 0.3, fundHeavyPct: 50, combinedHeavyPct: 20, waitDays: 60 });
export const VERDICTS = ["Exit", "Trim", "Add", "Keep"];

// trend from daily-bar technicals ({ price, sma200, sma200Ago?, aboveSma200 })
// price: today's price when known (the snapshot's own close otherwise)
export function trendOf(t, price = null) {
  const p = price > 0 ? price : t?.price;
  if (!t || !fin(t.sma200) || !fin(p)) return null;
  const rising = fin(t.sma200Ago) ? t.sma200 > t.sma200Ago : null, gapPct = r1((p / t.sma200 - 1) * 100);
  const state = p >= t.sma200 ? (rising === false ? "above-falling" : "up") : rising === false ? "down" : "below";
  return { state, gapPct, sma200: t.sma200, rising };
}

// Tax if every share were sold today, from the tax page's FIFO lots (row.lots: { qty, gain, long, daysToLong, becomesLong })
export function saleTax(row, { realised = {}, exemptLeft = TAX_RULES.ltExemption } = {}) {
  if (!row?.lots?.length) return null;
  const st = row.stGain || 0, lt = row.ltGain || 0;
  const stTax = Math.max(0, st) * TAX_RULES.stRate, ltTax = Math.max(0, lt - Math.max(0, exemptLeft)) * TAX_RULES.ltRate;
  const soon = row.lots.filter(l => l.long === false && (l.gain || 0) > 0 && fin(l.daysToLong) && l.daysToLong <= CLEANUP_RULES.waitDays);
  const wait = soon.length ? { days: Math.max(...soon.map(l => l.daysToLong)), date: soon.map(l => l.becomesLong).sort().at(-1), saves: Math.round(soon.reduce((a, l) => a + l.gain, 0) * (TAX_RULES.stRate - TAX_RULES.ltRate)) } : null;
  // a loss booked now first cancels short-term gains already booked this financial year
  const loss = Math.max(0, -(st + lt)), stBooked = Math.max(0, (realised.stGain || 0) - (realised.stLoss || 0));
  const offset = loss > 0 && stBooked > 0 ? { loss: Math.round(loss), against: Math.round(stBooked), saves: Math.round(Math.min(loss, stBooked) * TAX_RULES.stRate) } : null;
  return { stGain: Math.round(st), ltGain: Math.round(lt), tax: Math.round(stTax + ltTax), wait, offset };
}

// holdings: kiteHoldingsView rows; tech: Map(SYM → technicals); look: Map(SYM → { viaFunds, sources }); taxRows: Map(SYM → tax row)
export function reviewHoldings({ holdings = [], tech = new Map(), look = new Map(), taxRows = new Map(), realised = {}, exemptLeft = TAX_RULES.ltExemption, equityTotal = null } = {}) {
  const total = holdings.reduce((a, h) => a + (h.value > 0 ? h.value : 0), 0);
  const tiny = Math.max(CLEANUP_RULES.tinyRupees, total * CLEANUP_RULES.tinyPct / 100);
  const rows = holdings.filter(h => h.qty > 0).map(h => {
    const reasons = [], add = (tone, text) => reasons.push({ tone, text });
    const s = h.stance || {}, view = h.valuation?.view || null, rich = view === "Rich" || view === "Very rich", cheap = /cheap|value|undervalued/i.test(view || "");
    let verdict = { Accumulate: "Add", Hold: "Keep", "Hold (don't add)": "Keep", Trim: "Trim", Review: "Exit", "No view": "Keep" }[s.action] || "Keep";
    add(verdict === "Add" ? "for" : verdict === "Keep" ? "info" : "against", `Stance: ${s.action || "No view"}${s.summary ? `. ${s.summary}` : ""}`);
    for (const r of (s.reasons || []).filter(r => r.tone !== "info").slice(0, 3)) add(r.tone, r.text);

    // long-term trend
    const tr = trendOf(tech.get(h.symbol), h.qty > 0 && h.value > 0 ? h.value / h.qty : null);
    if (!tr) add("info", "No 200-day average yet (needs about a year of daily prices).");
    else if (tr.state === "up") add("for", `Above a rising 200-day average (₹${tr.sma200}, ${tr.gapPct >= 0 ? "+" : ""}${tr.gapPct}%): the long-term trend is up.`);
    else if (tr.state === "above-falling") add("info", `Above its 200-day average (₹${tr.sma200}) but the average is still falling.`);
    else {
      add("against", `Below ${tr.state === "down" ? "a falling" : "its"} 200-day average (₹${tr.sma200}, ${tr.gapPct}%): the long-term trend is ${tr.state === "down" ? "down" : "weak"}.`);
      if (verdict === "Add") { verdict = "Keep"; add("info", "Wait for the price to get back above the 200-day average before adding."); }
      else if (verdict === "Keep" && rich && tr.state === "down") { verdict = "Trim"; add("against", "Rich valuation in a falling trend: the two together argue for taking some off."); }
      else if (verdict === "Trim" && s.action === "Review") verdict = "Exit";
    }

    // overlap with your mutual funds
    const lk = look.get(h.symbol), via = lk?.viaFunds || 0;
    if (via > 0) {
      const share = h.value > 0 ? Math.round(via / h.value * 100) : null, top = (lk.sources || []).slice(0, 2).map(x => x.fund).join(", ");
      const combinedPct = equityTotal > 0 ? r1((h.value + via) / equityTotal * 100) : null;
      add(share >= CLEANUP_RULES.fundHeavyPct ? "against" : "info", `You also own ${inr(via)} of it through your funds (${top}${(lk.sources || []).length > 2 ? "…" : ""})${share !== null ? `: ${share}% on top of this holding` : ""}${combinedPct !== null ? `, ${combinedPct}% of all your equity` : ""}.`);
      if (verdict === "Add" && share >= CLEANUP_RULES.fundHeavyPct) { verdict = "Keep"; add("info", "Your funds already add a lot of this stock: adding more directly doubles up."); }
      if (verdict === "Keep" && combinedPct >= CLEANUP_RULES.combinedHeavyPct && rich) { verdict = "Trim"; add("against", `Direct plus fund exposure is ${combinedPct}% of your equity and the stock is rich.`); }
    }

    // tiny position
    const isTiny = h.value > 0 && h.value < tiny;
    if (isTiny) {
      if (verdict === "Add") add("info", `Small position (${inr(h.value)}): if you like it, bring it to a size that matters.`);
      else if (verdict !== "Exit") { verdict = "Exit"; add("against", `Too small to matter (${inr(h.value)}, under ${inr(tiny)}): either build it up or let it go to simplify the portfolio.`); }
    }

    // tax if sold
    const tx = saleTax(taxRows.get(h.symbol), { realised, exemptLeft }), selling = verdict === "Exit" || verdict === "Trim";
    if (tx) {
      if (selling) add("info", `Selling all today: ${tx.stGain ? `short-term ${tx.stGain >= 0 ? "gain" : "loss"} ${inr(tx.stGain)}` : ""}${tx.stGain && tx.ltGain ? ", " : ""}${tx.ltGain ? `long-term ${tx.ltGain >= 0 ? "gain" : "loss"} ${inr(tx.ltGain)}` : ""}${!tx.stGain && !tx.ltGain ? "no gain" : ""}; estimated tax ${inr(tx.tax)}.`);
      if (selling && tx.wait) add("warn", `Wait ${tx.wait.days} day${tx.wait.days === 1 ? "" : "s"} (until ${tx.wait.date}) and the short-term shares turn long-term: saves about ${inr(tx.wait.saves)} in tax.`);
      if (tx.offset) add(selling ? "for" : "info", `${selling ? "Selling" : "Selling now"} books a ${inr(tx.offset.loss)} loss that cancels short-term gains you booked this year (${inr(tx.offset.against)}): saves about ${inr(tx.offset.saves)} in tax.`);
    }
    const pnlPct = h.invested > 0 ? r1(h.pnl / h.invested * 100) : null;
    return { symbol: h.symbol, company: h.company || h.symbol, qty: h.qty, value: Math.round(h.value), invested: fin(h.invested) ? Math.round(h.invested) : null, pnl: fin(h.pnl) ? Math.round(h.pnl) : null, pnlPct, weightPct: h.weightPct ?? null,
      verdict, stance: s.action || "No view", view, cheap, trend: tr, viaFunds: Math.round(via), tiny: isTiny, tax: tx, reasons, waitFirst: !!(selling && tx?.wait) };
  });
  const order = v => VERDICTS.indexOf(v);
  rows.sort((a, b) => order(a.verdict) - order(b.verdict) || b.value - a.value);
  const counts = Object.fromEntries(VERDICTS.map(v => [v, rows.filter(r => r.verdict === v).length]));
  const freed = rows.filter(r => r.verdict === "Exit").reduce((a, r) => a + r.value, 0);
  const lossesToBook = rows.filter(r => r.tax?.offset && (r.verdict === "Exit" || r.verdict === "Trim")).reduce((a, r) => a + r.tax.offset.saves, 0);
  return { rows, counts, total: Math.round(total), tinyBelow: Math.round(tiny), exitValue: Math.round(freed), taxSavedByLosses: Math.round(lossesToBook), rules: CLEANUP_RULES };
}
