// "Market today" lists, shaped like NSE's own pages: new 52-week highs / lows, most active by volume / value, volume gainers.
// Source 1: NSE's market-wide APIs (whole market) when NSE answers. Source 2 (fallback): Yahoo quotes for the stocks you track
// and hold. Pure parsing / ranking here; fetching is in server.mjs.
const n = v => { if (v === null || v === undefined || v === "" || v === "-") return null; const x = Number(String(v).replace(/,/g, "")); return Number.isFinite(x) ? x : null; };
export const LISTS = Object.freeze({
  "52high": { label: "New 52-week highs", nse: ["/api/live-analysis-data-52weekhighstock"], referer: "https://www.nseindia.com/market-data/52-week-high-equity-market" },
  "52low": { label: "New 52-week lows", nse: ["/api/live-analysis-data-52weeklowstock"], referer: "https://www.nseindia.com/market-data/52-week-low-equity-market" },
  volume: { label: "Most active by volume", nse: ["/api/live-analysis-most-active-securities?index=volume"], referer: "https://www.nseindia.com/market-data/most-active-equities" },
  value: { label: "Most active by value", nse: ["/api/live-analysis-most-active-securities?index=value"], referer: "https://www.nseindia.com/market-data/most-active-equities" },
  gainers: { label: "Top gainers", nse: ["/api/live-analysis-variations?index=gainers"], referer: "https://www.nseindia.com/market-data/top-gainers-losers" },
  losers: { label: "Top losers", nse: ["/api/live-analysis-variations?index=loosers"], referer: "https://www.nseindia.com/market-data/top-gainers-losers" },
  volgainers: { label: "Volume gainers", nse: ["/api/live-analysis-volume-gainers"], referer: "https://www.nseindia.com/market-data/volume-gainers-spurts" }
});

// NSE responses differ per page; accept the usual shapes ({ data: [...] }, { dataLtpGreater20: [...] }, plain array) and field names.
export function parseNseList(list, json) {
  const arr = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : Array.isArray(json?.data?.data) ? json.data.data
    : Object.values(json || {}).find(v => Array.isArray(v) && v.length && typeof v[0] === "object") || [];
  const rows = arr.map(x => {
    const ltp = n(x.ltp ?? x.lastPrice ?? x.last_price ?? x.lastTradedPrice);
    const volume = n(x.totalTradedVolume ?? x.tradedQuantity ?? x.volume ?? x.trade_quantity);
    let value = n(x.totalTradedValue ?? x.turnover ?? x.tradedValue);
    if (value !== null && value < 1e6 && volume && ltp && volume * ltp > value * 100) value = value * 1e7; // NSE sometimes gives ₹ crore
    return {
      symbol: String(x.symbol || x.Symbol || "").toUpperCase(), name: x.companyName || x.meta?.companyName || x.symbolName || null, series: x.series || null,
      ltp, pChange: n(x.pChange ?? x.perChange ?? x.netPrice), high52: n(x.new52WHL ?? x.yearHigh ?? x.high52 ?? x["52wHigh"]), prev52: n(x.prev52WHL ?? x.prevHigh ?? x.prevLow), low52: n(x.yearLow ?? x.low52),
      volume, value, avgVolume: n(x.week1AvgVolume ?? x.week2AvgVolume ?? x.avgVolume), volRatio: n(x.week1volChange ?? x.volChange)
    };
  }).filter(r => /^[A-Z0-9&-]{1,20}$/.test(r.symbol) && (!r.series || /^(EQ|BE|BZ|SM|ST)$/.test(r.series)));
  if (list === "52low") rows.forEach(r => { if (r.low52 === null && r.high52 !== null) { r.low52 = r.high52; r.high52 = null; } });
  return rows;
}

// Fallback from Yahoo quotes of your own stocks. quotes: [{ symbol, name, price, pChange, volume, avgVolume, high52, low52 }]
export function rankFromQuotes(list, quotes, { limit = 50 } = {}) {
  const q = quotes.filter(x => Number.isFinite(x.price) && x.price > 0).map(x => ({ symbol: x.symbol, name: x.name, ltp: x.price, pChange: x.pChange, high52: x.high52, low52: x.low52, volume: x.volume, value: Number.isFinite(x.volume) ? x.volume * (x.avgPrice || x.price) : null, avgVolume: x.avgVolume, volRatio: x.volume && x.avgVolume ? Math.round(x.volume / x.avgVolume * 100) / 100 : null }));
  let rows;
  if (list === "gainers") rows = q.filter(x => Number.isFinite(x.pChange) && x.pChange > 0).sort((a, b) => b.pChange - a.pChange);
  else if (list === "losers") rows = q.filter(x => Number.isFinite(x.pChange) && x.pChange < 0).sort((a, b) => a.pChange - b.pChange);
  else if (list === "52high") rows = q.filter(x => x.high52 && x.ltp >= x.high52 * 0.98).sort((a, b) => b.ltp / b.high52 - a.ltp / a.high52 || (b.pChange ?? 0) - (a.pChange ?? 0));
  else if (list === "52low") rows = q.filter(x => x.low52 && x.ltp <= x.low52 * 1.02).sort((a, b) => a.ltp / a.low52 - b.ltp / b.low52);
  else if (list === "volume") rows = q.filter(x => x.volume).sort((a, b) => b.volume - a.volume);
  else if (list === "value") rows = q.filter(x => x.value).sort((a, b) => b.value - a.value);
  else rows = q.filter(x => x.volRatio && x.volRatio >= 1.5).sort((a, b) => b.volRatio - a.volRatio);
  return rows.slice(0, limit);
}
