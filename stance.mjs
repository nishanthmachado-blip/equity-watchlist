// Rule-based stance for a stock you HOLD: Accumulate / Hold / Hold (don't add) / Review / Trim / No view.
// It combines the app's own valuation view and buy zone, your written thesis, the watchlist action and how large the
// position is in your synced broker accounts (Zerodha, Angel One, Dhan, Groww). Every rule is listed back to you as a reason, so nothing is a black box.
// It is a checklist-style aid built on cached fundamentals, not a forecast or licensed advice, and it ignores your tax
// position, other investments and time horizon.
export const LIMITS = { noAddWeight: 12, trimWeight: 20 }; // % of synced holdings value (all brokers)
const VIEW_SCORE = { Undervalued: 2, Fair: 1, "Fair to rich": 0, Rich: -1, "Very rich": -2 };
const ACTION_SCORE = (a = "") => /^Avoid/.test(a) ? -2 : /^Buy gradually/.test(a) ? 1 : /^Wait for/.test(a) ? -1 : 0;
const money = v => Number.isFinite(v) ? `₹${Math.round(v).toLocaleString("en-IN")}` : "—";

// holding: { qty, avgPrice, value, pnl, invested }  row: computeValuation output (or undefined)
// stock: watchlist entry (or undefined)  thesis: { status, conditions[] } from the thesis tracker (or undefined)
export function holdingStance({ holding, weightPct = null, row = null, stock = null, thesis = null }) {
  const reasons = [], push = (tone, text) => reasons.push({ tone, text });
  const assessed = !!row && !["No fundamentals", "Unassessable"].includes(row.view);
  const pnlPct = holding?.invested > 0 ? Math.round((holding.pnl / holding.invested) * 1000) / 10 : null;
  let score = 0;

  if (!assessed) push("info", !stock ? "Not on your watchlist, so there is no valuation to judge it by." : "No usable fundamentals yet, so valuation cannot be judged.");
  else {
    const vs = VIEW_SCORE[row.view] ?? 0; score += vs;
    push(vs > 0 ? "for" : vs < 0 ? "against" : "info", `Valuation view: ${row.view}${Number.isFinite(row.ratio) ? ` (multiple is ${row.ratio}x its fair multiple)` : ""}.`);
    if (row.status === "In zone" || row.status === "Below zone") { score += 1; push("for", `Price is ${row.status.toLowerCase()} (${money(row.zoneLow)}–${money(row.zoneHigh)}).`); }
    else if (row.status === "Wait (far above)") { score -= 1; push("against", `Price is far above the buy zone (${money(row.zoneLow)}–${money(row.zoneHigh)}).`); }
    else if (row.status === "Above zone") push("info", `Price is above the buy zone (${money(row.zoneLow)}–${money(row.zoneHigh)}).`);
    if (Number.isFinite(row.upsideToBase)) push(row.upsideToBase >= 0 ? "for" : "against", `Base fair value ${money(row.fairValue?.base)} is ${row.upsideToBase >= 0 ? "above" : "below"} the price by ${Math.abs(Math.round(row.upsideToBase * 100))}%.`);
  }
  const brokenThesis = thesis?.status === "Broken";
  if (thesis?.status === "Broken") { score -= 2; const n = thesis.conditions.filter(c => c.state === "broken").map(c => c.label).join(", "); push("against", `Your thesis is broken (${n}).`); }
  else if (thesis?.status === "Intact") { score += 1; push("for", "Your thesis conditions all hold."); }
  else push("info", "No thesis conditions written for this stock (Thesis tab), so its reasons are not being checked.");

  const as = ACTION_SCORE(stock?.action); score += as;
  if (stock?.action) push(as > 0 ? "for" : as < 0 ? "against" : "info", `Your watchlist action is "${stock.action}".`);

  const heavy = weightPct !== null && weightPct >= LIMITS.noAddWeight, tooHeavy = weightPct !== null && weightPct >= LIMITS.trimWeight;
  if (weightPct !== null) push(tooHeavy ? "against" : heavy ? "against" : "info", `This is ${weightPct}% of your synced holdings${tooHeavy ? ` (above ${LIMITS.trimWeight}%)` : heavy ? ` (above ${LIMITS.noAddWeight}%)` : ""}.`);
  if (pnlPct !== null && pnlPct <= -25) push("info", `You are down ${Math.abs(pnlPct)}% on cost. Cost is not a reason to buy or sell; the call above is based on today's valuation.`);

  // Map to a stance, then apply the hard caps. "Review" is reserved for contradictions (broken thesis, or a stock you
  // rated Avoid yet hold); richness alone only stops you adding.
  const avoided = /^Avoid/.test(stock?.action || "");
  let action;
  if (!assessed) action = "No view";
  else if (score >= 3) action = "Accumulate";
  else if (score >= 0) action = "Hold";
  else action = "Hold (don't add)";
  if (heavy && action === "Accumulate") action = "Hold (don't add)";
  if (brokenThesis || avoided) action = "Review";
  if (avoided && !brokenThesis) push("against", "You rated this Avoid on the watchlist but still hold it: decide whether to exit or change the rating.");
  const rich = assessed && (row.view === "Rich" || row.view === "Very rich");
  if (tooHeavy && (rich || brokenThesis)) action = "Trim";

  const stale = assessed && (row.stale || row.confidence === "low");
  const confidence = !assessed ? "Low" : stale ? "Low" : thesis ? "High" : "Medium";
  if (stale) push("info", row.confidence === "low" ? "Based on thin (NSE-only) data: low confidence." : "Fundamentals are over 90 days old: refresh before acting.");

  const changes = [];
  if (assessed && action !== "Accumulate" && Number.isFinite(row.zoneHigh)) changes.push(`Moves toward Accumulate if the price falls into the buy zone (${money(row.zoneLow)}–${money(row.zoneHigh)}) and your thesis holds.`);
  if (brokenThesis) changes.push("Re-check the broken condition(s); if the reason still holds, edit the thesis, otherwise decide whether to exit.");
  if (action === "Trim") changes.push(`A trim would reduce the position toward ${LIMITS.noAddWeight}% of your holdings. Selling may trigger capital-gains tax, so check holding periods first.`);
  if (!assessed) changes.push(stock ? "Fetch fundamentals to get a valuation view." : "Add it to the watchlist and fetch fundamentals to get a valuation view.");

  const summary = { Accumulate: "Valuation (and your thesis, if you wrote one) support adding in stages.", Hold: "Keep the position; nothing here argues for adding or selling.", "Hold (don't add)": "Keep it, but the case for adding more is weak right now.", Review: "Something is off (thesis, valuation or data): re-check your reasons before doing anything.", Trim: "Large position in a rich or weakened name: consider reducing.", "No view": "Not enough data to form a view." }[action];
  return { action, confidence, score: assessed ? score : null, summary, reasons, changes, pnlPct, weightPct };
}
