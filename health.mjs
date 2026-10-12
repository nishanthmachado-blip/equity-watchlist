// Portfolio health: concentration, valuation mix and value-vs-growth tilt of the holdings. Pure.
const fin = v => Number.isFinite(v);
const pct = (v, t) => (t > 0 ? Math.round((v / t) * 1000) / 10 : 0);

export function portfolioHealth(holdings, rowsBySymbol) {
  const total = holdings.reduce((s, h) => s + (fin(h.value) ? h.value : 0), 0);
  if (!(total > 0)) return { total: 0, empty: true };
  const bucket = (keyFn) => { const m = {}; for (const h of holdings) { const k = keyFn(h) || "Unknown"; m[k] = (m[k] || 0) + (h.value || 0); } return Object.entries(m).map(([name, value]) => ({ name, value: Math.round(value), pct: pct(value, total) })).sort((a, b) => b.value - a.value); };
  const rowOf = h => rowsBySymbol[h.symbol];
  const bySector = bucket(h => rowOf(h)?.sector), byCap = bucket(h => rowOf(h)?.cap ? `${rowOf(h).cap}cap` : null);
  const byVerdict = bucket(h => ({ buy: "In buy zone", wait: "Wait / hold", expensive: "Expensive", none: "Not valued" })[rowOf(h)?.verdict?.key || "none"]);
  const tagged = t => pct(holdings.filter(h => rowOf(h)?.verdict?.tags?.includes(t)).reduce((s, h) => s + (h.value || 0), 0), total);
  const sorted = [...holdings].sort((a, b) => (b.value || 0) - (a.value || 0));
  const top5 = pct(sorted.slice(0, 5).reduce((s, h) => s + (h.value || 0), 0), total);
  const tilt = { value: tagged("Value"), growth: tagged("Growth"), dividend: tagged("Dividend") };
  const share = name => byVerdict.find(x => x.name === name)?.pct || 0;
  const flags = [];
  for (const h of sorted.slice(0, 3)) { const w = pct(h.value, total); if (w > 15) flags.push({ level: "warn", text: `${h.symbol} is ${w}% of the portfolio (over 15%).` }); }
  const topSector = bySector.find(s => s.name !== "Unknown"); if (topSector && topSector.pct > 30) flags.push({ level: "warn", text: `${topSector.name} is ${topSector.pct}% of the portfolio (over 30%).` });
  if (share("Expensive") > 35) flags.push({ level: "warn", text: `${share("Expensive")}% of the value sits in stocks the model calls expensive.` });
  if (share("Not valued") > 25) flags.push({ level: "info", text: `${share("Not valued")}% has no valuation yet: add those holdings to the watchlist.` });
  if (top5 > 60) flags.push({ level: "warn", text: `Top 5 holdings are ${top5}% of the portfolio.` });
  const small = byCap.find(c => c.name === "Smallcap"); if (small && small.pct > 40) flags.push({ level: "warn", text: `Smallcaps are ${small.pct}% of the portfolio (over 40%).` });
  if (!flags.length) flags.push({ level: "ok", text: "No concentration or valuation warnings from these rules." });
  return { total: Math.round(total), count: holdings.length, bySector, byCap, byVerdict, top5, tilt, flags };
}
