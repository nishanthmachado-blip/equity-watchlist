// Peer comparison from the stocks you already track: same sector, valued by the same model. Pure.
const fin = v => Number.isFinite(v);
const median = a => { const s = a.filter(fin).sort((x, y) => x - y); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r1 = v => (fin(v) ? Math.round(v * 10) / 10 : null);
const quality = r => (r.profile === "financial" ? r.roe : r.roce);

export function peerCompare(symbol, rows) {
  const me = rows.find(r => String(r.symbol).toUpperCase() === String(symbol).toUpperCase());
  if (!me || !me.sector) return { available: false, note: "No sector on file for this stock yet (fetch fundamentals first)." };
  // Same industry (e.g. Private Sector Bank) when you track at least 2 others in it; otherwise the broader sector.
  const byIndustry = me.industry ? rows.filter(r => r !== me && r.industry === me.industry && fin(r.ratio)) : [];
  const peers = byIndustry.length >= 2 ? byIndustry : rows.filter(r => r !== me && r.sector === me.sector && fin(r.ratio));
  const group = byIndustry.length >= 2 ? me.industry : me.sector;
  if (peers.length < 2) return { available: false, sector: group, count: peers.length, note: `Only ${peers.length} other ${group} stock(s) on your watchlist, which is too few to compare. Peers are drawn from the stocks you track.` };
  const pick = r => ({ symbol: r.symbol, company: r.company, price: r.price ?? null, pe: r.pe, pb: r.pb ?? null, ratio: r.ratio, quality: quality(r), salesCagr3: r.salesCagr3, profitCagr3: r.profitCagr3, view: r.view, verdict: r.verdict?.label || null, verdictCls: r.verdict?.cls || null, divYield: r.dividend?.yield ?? null, marketCap: r.marketCap || null });
  const med = { pe: r1(median(peers.map(r => r.pe))), ratio: r1(median(peers.map(r => r.ratio)) * 100) / 100, quality: r1(median(peers.map(quality))), salesCagr3: r1(median(peers.map(r => r.salesCagr3))), profitCagr3: r1(median(peers.map(r => r.profitCagr3))) };
  const cheaperThan = (mine, key, getter = r => r[key]) => (fin(mine) ? peers.filter(r => fin(getter(r)) && getter(r) > mine).length : null);
  const better = (mine, getter) => (fin(mine) ? peers.filter(r => fin(getter(r)) && getter(r) < mine).length : null);
  const n = peers.length;
  const rank = { cheaperPE: cheaperThan(me.pe, "pe"), cheaperRatio: cheaperThan(me.ratio, "ratio"), betterQuality: better(quality(me), quality), fasterProfit: better(me.profitCagr3, r => r.profitCagr3) };
  let verdict = "In line with peers";
  if (fin(me.ratio) && fin(med.ratio)) verdict = me.ratio < med.ratio * 0.85 ? "Cheaper than most peers" : me.ratio > med.ratio * 1.15 ? "Pricier than most peers" : "In line with peers";
  const top = peers.sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0)).slice(0, 12).map(pick);
  return { available: true, sector: group, count: n, me: pick(me), medians: med, rank, verdict, peers: top };
}
