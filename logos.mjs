// Company logos for the stock rows. Wikidata knows most listed Indian companies by ISIN or NSE ticker, with their
// website and often a logo file on Wikimedia Commons. The server looks them up in batches, downloads a small PNG (the
// Commons logo, else the website's icon), keeps it in a shared cache and serves it from this app: the browser never
// asks an outside site, so nobody outside sees which stocks you look at. Pure helpers here; the server fetches.
export const WIKIDATA_SPARQL = "https://query.wikidata.org/sparql";
const INDIA_QID = "Q668"; // ticker matches are limited to companies of India (tickers repeat across exchanges worldwide)
const lit = s => `"${String(s).replace(/["\\]/g, "")}"`;

// items: [{ symbol, isin }] → one SPARQL query matching by ISIN (P946) or by stock-exchange ticker (P414 + P249) of an Indian company
export function logoQuery(items) {
  const isins = items.filter(i => /^INE[A-Z0-9]{9}$/.test(i.isin || "")).map(i => lit(i.isin)), tickers = items.map(i => lit(i.symbol));
  return `SELECT ?c ?isin ?ticker ?web ?logo WHERE {
  { VALUES ?isin { ${isins.join(" ") || '"-"'} } ?c wdt:P946 ?isin . }
  UNION
  { VALUES ?ticker { ${tickers.join(" ")} } ?c p:P414 ?st . ?st pq:P249 ?ticker . ?c wdt:P17 wd:${INDIA_QID} . }
  OPTIONAL { ?c wdt:P856 ?web . }
  OPTIONAL { ?c wdt:P154 ?logo . }
}`;
}
// SPARQL JSON → Map(SYMBOL → { web, logo, qid }) for the asked items (ISIN match wins over ticker)
export function parseLogoResult(json, items) {
  const bySym = new Map(), symOfIsin = new Map(items.filter(i => i.isin).map(i => [i.isin, i.symbol])), syms = new Set(items.map(i => i.symbol));
  for (const b of json?.results?.bindings || []) {
    const isin = b.isin?.value, ticker = String(b.ticker?.value || "").toUpperCase();
    const sym = isin ? symOfIsin.get(isin) : syms.has(ticker) ? ticker : null; if (!sym) continue;
    const cur = bySym.get(sym) || { web: null, logo: null, qid: null, byIsin: false };
    if (cur.byIsin && !isin) continue; // keep the ISIN match
    const next = { web: b.web?.value || cur.web, logo: b.logo?.value || cur.logo, qid: String(b.c?.value || "").split("/").pop() || cur.qid, byIsin: cur.byIsin || !!isin };
    if (isin && !cur.byIsin) { next.web = b.web?.value || null; next.logo = b.logo?.value || null; }
    bySym.set(sym, next);
  }
  return bySym;
}
export function domainOf(url) { try { const h = new URL(url).hostname.toLowerCase().replace(/^www\./, ""); return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h) ? h : null; } catch { return null; } }
// Commons file URL (http://commons.wikimedia.org/wiki/Special:FilePath/X.svg) → a small PNG rendering of it
export function commonsPng(fileUrl, width = 96) {
  const m = String(fileUrl || "").match(/Special:FilePath\/(.+)$/); if (!m) return null;
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${m[1]}?width=${width}`;
}
// Only raster images, small, with a real image signature (never SVG / HTML served as an image)
export function imageKind(buf, type = "") {
  if (!buf || buf.length < 24 || buf.length > 80_000) return null;
  const hex = buf.subarray(0, 8).toString("hex");
  if (hex.startsWith("89504e470d0a1a0a")) return "image/png";
  if (hex.startsWith("ffd8ff")) return "image/jpeg";
  if (hex.startsWith("47494638")) return "image/gif";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (hex.startsWith("00000100")) return "image/x-icon";
  return null;
}
// Two letters for the fallback badge: "Hero MotoCorp" → HM, "TCS" → TC
export function initials(name, symbol = "") {
  const words = String(name || symbol).replace(/\b(ltd|limited|the|india|industries|corporation|company|co)\b\.?/gi, " ").replace(/[^A-Za-z0-9& ]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return String(words[0] || symbol || "?").slice(0, 2).toUpperCase();
}
// Pixel size of a PNG / GIF / JPEG (null when unknown): tiny icons (the 16 px "no icon" globe) are not worth showing
export function imageSize(buf) {
  try {
    const hex = buf.subarray(0, 4).toString("hex");
    if (hex === "89504e47") return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (hex.startsWith("4749")) return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
    if (hex.startsWith("ffd8")) { let o = 2; while (o < buf.length - 9) { if (buf[o] !== 0xff) return null; const m = buf[o + 1], len = buf.readUInt16BE(o + 2); if (m >= 0xc0 && m <= 0xc3) return { w: buf.readUInt16BE(o + 7), h: buf.readUInt16BE(o + 5) }; o += 2 + len; } }
    if (hex === "00000100") return { w: buf[6] || 256, h: buf[7] || 256 };
  } catch { /* unknown */ }
  return null;
}
