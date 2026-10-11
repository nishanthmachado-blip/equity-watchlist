// Forward tracker: logs each stock's valuation verdict once per day, then measures what the price did
// afterwards, grouped by verdict. History-based back-testing is not possible without historical
// fundamentals, so this builds the evidence going forward instead.
export const MAX_PER_SYMBOL = 500;
export function addSnapshots(log, rows, day) {
  let added = 0;
  for (const r of rows) {
    if (!r.symbol || !r.price || r.view === "No fundamentals" || r.view === "Unassessable") continue;
    const series = (log[r.symbol] ||= []);
    if (series.at(-1)?.d === day) continue;
    series.push({ d: day, view: r.view, status: r.status, price: r.price, fv: r.fairValue?.base ?? null });
    if (series.length > MAX_PER_SYMBOL) series.shift();
    added++;
  }
  return added;
}
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
// Return of each stock from its first snapshot in a verdict bucket to its latest price, requiring minDays of history.
export function performance(log, minDays = 14) {
  const buckets = new Map(), byStatus = new Map();
  let tracked = 0;
  for (const [sym, series] of Object.entries(log)) {
    if (series.length < 2) continue;
    tracked++;
    const first = series[0], last = series.at(-1);
    const days = Math.round((new Date(last.d) - new Date(first.d)) / 864e5);
    if (days < minDays) continue;
    const ret = (last.price / first.price - 1) * 100;
    for (const [map, key] of [[buckets, first.view], [byStatus, first.status]]) { const e = map.get(key) || { key, rets: [], days: [] }; e.rets.push(ret); e.days.push(days); map.set(key, e); }
  }
  const fmt = m => [...m.values()].map(e => ({ key: e.key, count: e.rets.length, avgReturnPct: Number((e.rets.reduce((a, b) => a + b, 0) / e.rets.length).toFixed(1)), medianReturnPct: Number(median(e.rets).toFixed(1)), medianDays: median(e.days), hitRatePct: Math.round(e.rets.filter(r => r > 0).length / e.rets.length * 100) }));
  return { tracked, minDays, byView: fmt(buckets), byStatus: fmt(byStatus), note: tracked === 0 ? "No history yet: verdicts are logged once per day after each fetch/view; check back in a few weeks." : `Returns are price-only, from the first logged verdict to now, for stocks with at least ${minDays} days of history. Small samples prove nothing.` };
}

// Yahoo vs reference (Screener) comparison for the data-check panel.
const CMP = [["pe", "rel"], ["pb", "rel"], ["roce", "pts"], ["roe", "pts"], ["promoter", "pts"], ["salesCagr3", "pts"], ["profitCagr3", "pts"]];
export function compare(cache, reference) {
  const rows = [];
  for (const [sym, ref] of Object.entries(reference)) {
    const c = cache[sym]; if (!c) continue;
    const fields = CMP.map(([k, mode]) => {
      const a = ref[k], b = c[k];
      if (a === undefined || b === undefined) return { field: k, reference: a ?? null, yahoo: b ?? null, diff: null, flag: false };
      const diff = mode === "rel" ? (a ? (b / a - 1) * 100 : null) : b - a;
      const flag = diff === null ? false : mode === "rel" ? Math.abs(diff) > 25 : Math.abs(diff) > 8;
      return { field: k, reference: a, yahoo: b, diff: diff === null ? null : Number(diff.toFixed(1)), unit: mode === "rel" ? "%" : "pts", flag };
    });
    rows.push({ symbol: sym, fields, flagged: fields.filter(f => f.flag).length, source: c.source });
  }
  return { rows, flaggedStocks: rows.filter(r => r.flagged).length, note: "Reference = Screener.in figures captured by hand on 2026-10-01. P/E and P/B differences below ~25% and growth/ROCE/promoter differences below ~8 pts are normal (different definitions, standalone vs consolidated, different dates)." };
}
