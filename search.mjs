// Search-as-you-type suggestions: stocks you already track (instant, with their numbers) first, then NSE / BSE listings from
// Yahoo's public search. A company listed on both exchanges is shown once, as NSE. Pure merge logic; the server does the fetch.
const norm = s => String(s || "").toLowerCase().replace(/\b(ltd|limited|the|inc)\b|[^a-z0-9]/g, "");

function localScore(q, row) {
  const ql = q.toLowerCase(), sym = String(row.symbol || "").toLowerCase(), name = String(row.company || "").toLowerCase();
  if (sym === ql) return 100;
  if (sym.startsWith(ql)) return 90 - sym.length / 100;
  if (name.startsWith(ql)) return 80;
  if (name.split(/\s+/).some(w => w.startsWith(ql))) return 70;
  if (name.includes(ql) || sym.includes(ql)) return 50 - Math.min(name.indexOf(ql) >= 0 ? name.indexOf(ql) : 40, 40) / 100;
  return 0;
}

// rows: valuation rows of tracked stocks (with verdict); yahoo: raw `quotes` array from Yahoo search; lists: [{id,name,symbols}]
export function mergeSuggestions(q, rows, yahoo = [], lists = [], { limit = 10 } = {}) {
  q = String(q || "").trim(); if (q.length < 1) return [];
  const inLists = sym => lists.filter(l => l.symbols.includes(sym)).map(l => l.id);
  const local = rows.map(r => ({ r, s: localScore(q, r) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 6).map(({ r }) => ({
    symbol: String(r.symbol).toUpperCase(), name: r.company, exchange: r.exchange || "NSE", tracked: true, lists: inLists(String(r.symbol).toUpperCase()),
    price: r.price ?? null, pe: r.pe ?? null, sectorPe: r.sectorPe ?? r.sectorPeEst ?? null, sectorPeEst: !r.sectorPe && !!r.sectorPeEst, view: r.view && r.view !== "No fundamentals" ? r.view : null, verdict: r.verdict?.label || null, verdictCls: r.verdict?.cls || null, sector: r.sector || null
  }));
  const seenSym = new Set(local.map(x => x.symbol)), seenName = new Set(local.map(x => norm(x.name)));
  const ext = [];
  const quotes = (yahoo || []).filter(x => /\.(NS|BO)$/.test(x?.symbol || "") && (!x.quoteType || x.quoteType === "EQUITY"));
  // NSE first so a dual-listed company keeps its NSE symbol
  quotes.sort((a, b) => (/\.NS$/.test(b.symbol) ? 1 : 0) - (/\.NS$/.test(a.symbol) ? 1 : 0));
  for (const x of quotes) {
    const exchange = /\.NS$/.test(x.symbol) ? "NSE" : "BSE", symbol = x.symbol.replace(/\.(NS|BO)$/, "").toUpperCase(), name = x.longname || x.shortname || symbol;
    if (!/^[A-Z0-9&-]{1,20}$/.test(symbol) || seenSym.has(symbol) || seenName.has(norm(name))) continue;
    seenSym.add(symbol); seenName.add(norm(name));
    ext.push({ symbol, name, exchange, tracked: false, lists: [], sector: x.sectorDisp || x.sector || null });
  }
  return [...local, ...ext].slice(0, limit);
}
