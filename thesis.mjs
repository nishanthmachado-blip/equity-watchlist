// Thesis tracker: for each stock you write down WHY you own it and the measurable conditions under which that
// reason stops being true ("thesis holds while ROCE >= 15"). After every fundamentals refresh the conditions are
// re-checked against the latest numbers, so the question shifts from "did the price move?" to "is my reason still true?".
// Pure functions only; server.mjs does the storage and the audit-log entry when a thesis flips.
const num = v => { const x = Number(v); return v !== null && v !== undefined && v !== "" && Number.isFinite(x) ? x : null; };

// Every metric reads from the computed valuation row (row), the cached fundamentals (f) or the watchlist stock (s).
export const METRICS = {
  roce: { label: "ROCE", unit: "%", get: ({ row, f }) => num(row?.roce ?? f?.roce), hint: "Return on capital employed" },
  roe: { label: "ROE", unit: "%", get: ({ row, f }) => num(row?.roe ?? f?.roe) },
  salesCagr3: { label: "3-yr sales growth", unit: "%", get: ({ row, f }) => num(row?.salesCagr3 ?? f?.salesCagr3) },
  profitCagr3: { label: "3-yr profit growth", unit: "%", get: ({ row, f }) => num(row?.profitCagr3 ?? f?.profitCagr3) },
  promoter: { label: "Promoter holding", unit: "%", get: ({ row, f }) => num(row?.promoter ?? f?.promoter) },
  promoterChange3y: { label: "Promoter change (3 yrs)", unit: "pts", get: ({ row, f }) => num(row?.promoterChange3y ?? f?.promoterChange3y), hint: "Negative = promoters selling" },
  debtToReserves: { label: "Borrowings ÷ reserves", unit: "x", get: ({ f }) => { const b = num(f?.borrowings), r = num(f?.reserves); return b !== null && r !== null && r > 0 ? Math.round((b / r) * 100) / 100 : null; } },
  cfoToProfit3: { label: "Cash conversion (3-yr CFO ÷ profit)", unit: "x", get: ({ f }) => num(f?.cfoToProfit3) },
  pe: { label: "P/E", unit: "x", get: ({ row }) => num(row?.pe) },
  priceToFair: { label: "P/E ÷ fair multiple", unit: "x", get: ({ row }) => num(row?.ratio), hint: "Below 1 = cheaper than the model's fair multiple" },
  drawdown52: { label: "Fall from 52-week high", unit: "%", get: ({ s, row }) => { const p = num(s?.price), h = num(s?.high ?? row?.high); return p && h && h > 0 ? Math.round((1 - p / h) * 1000) / 10 : null; } }
};
export const OPS = { ">=": (a, b) => a >= b, "<=": (a, b) => a <= b, ">": (a, b) => a > b, "<": (a, b) => a < b };
// One-click starting points shown in the form; each reads "thesis holds while <metric> <op> <value>".
export const PRESETS = [
  { metric: "roce", op: ">=", value: 15 }, { metric: "profitCagr3", op: ">=", value: 10 }, { metric: "promoterChange3y", op: ">=", value: -5 },
  { metric: "debtToReserves", op: "<=", value: 1 }, { metric: "cfoToProfit3", op: ">=", value: 0.6 }, { metric: "priceToFair", op: "<=", value: 1.3 }
];

export function sanitizeThesis(body, previous = null) {
  const reasons = String(body?.reasons || "").trim().slice(0, 1000);
  if (!Array.isArray(body?.conditions)) throw new Error("conditions must be an array.");
  if (body.conditions.length > 12) throw new Error("At most 12 conditions per stock.");
  const old = new Map((previous?.conditions || []).map(c => [c.id, c]));
  const conditions = body.conditions.map((c, i) => {
    if (!METRICS[c?.metric]) throw new Error(`Condition ${i + 1}: unknown metric "${c?.metric}".`);
    if (!OPS[c.op]) throw new Error(`Condition ${i + 1}: operator must be one of ${Object.keys(OPS).join(" ")}.`);
    const value = num(c.value); if (value === null) throw new Error(`Condition ${i + 1}: value must be a number.`);
    const id = old.has(c.id) ? c.id : `c${Date.now().toString(36)}${i}`;
    return { id, metric: c.metric, op: c.op, value };
  });
  if (!reasons && !conditions.length) throw new Error("Write a reason or add at least one condition.");
  return { reasons, conditions };
}

// ctx = { row, f, s }. A condition is "broken" when its metric is present and the "holds while" test fails.
export function evaluateThesis(thesis, ctx) {
  const conditions = (thesis.conditions || []).map(c => {
    const m = METRICS[c.metric], actual = m ? m.get(ctx) : null;
    const state = !m || actual === null ? "nodata" : OPS[c.op](actual, c.value) ? "ok" : "broken";
    return { ...c, label: m?.label || c.metric, unit: m?.unit || "", actual, state };
  });
  const broken = conditions.filter(c => c.state === "broken").length, ok = conditions.filter(c => c.state === "ok").length;
  const status = broken ? "Broken" : ok ? "Intact" : "Unassessed";
  return { status, conditions, broken, ok, nodata: conditions.length - broken - ok };
}

// Updates stored first-break dates and the last known status in place; returns true when anything changed and the
// previous status (for the audit log) when the overall status flipped.
export function trackBreaks(thesis, evaluation, nowIso) {
  let changed = false;
  thesis.brokenSince ||= {};
  for (const c of evaluation.conditions) {
    if (c.state === "broken" && !thesis.brokenSince[c.id]) { thesis.brokenSince[c.id] = nowIso; changed = true; }
    if (c.state !== "broken" && thesis.brokenSince[c.id]) { delete thesis.brokenSince[c.id]; changed = true; }
  }
  for (const id of Object.keys(thesis.brokenSince)) if (!evaluation.conditions.some(c => c.id === id)) { delete thesis.brokenSince[id]; changed = true; }
  const flip = thesis.lastStatus && thesis.lastStatus !== evaluation.status ? { from: thesis.lastStatus, to: evaluation.status } : null;
  if (thesis.lastStatus !== evaluation.status) { thesis.lastStatus = evaluation.status; changed = true; }
  return { changed, flip };
}
