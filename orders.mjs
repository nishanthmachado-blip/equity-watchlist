// Order wins: companies that announce new orders / contracts on NSE (a listed company must disclose a material order).
// Parses NSE's corporate announcements, pulls the order value out of the text (₹ crore / lakh, US$ million), and ranks
// companies by how big their recent wins are next to their yearly sales: a growth signal for capital goods, defence,
// EPC, railways, IT services and similar businesses. Pure functions; the server fetches and caches.
//
// What this is not: the full order book (outstanding orders) is reported in results presentations, not as an
// announcement. When an announcement mentions it ("order book stands at ₹X crore"), it is picked up.
const fin = v => Number.isFinite(v);
const r1 = v => (fin(v) ? Math.round(v * 10) / 10 : null);
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// "21-Oct-2026 10:15:02" / "2026-10-21 10:15:02" → "2026-10-21"
export function annDay(s) {
  const t = String(s || "").trim(); let m;
  if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = t.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})/)) && MON[m[2].toLowerCase()]) return `${m[3]}-${String(MON[m[2].toLowerCase()]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

const ORDER_CAT = /bagging|receiving of order|receipt of order|award of (order|contract)|orders?\s*\/\s*contracts?|order win|letter of (award|intent)/i;
const ORDER_TEXT = /\b(order|orders|contract|contracts|letter of award|LoA|letter of intent|LoI|work order|purchase order)\b/i;
const NOT_ORDER = /\b(court|tribunal|nclt|sebi order|penalty|tax (demand|order)|show cause|assessment order|gst|income tax|arbitral award|interim order|order dated .* (high|supreme) court)\b/i;

// Order value in ₹ crore from free text. Takes the largest figure tied to a currency unit (a filing often lists the
// order and smaller parts of it). usdInr converts dollar / euro amounts (euro at usdInr × 1.08).
export function orderValueCr(text, usdInr = 88) {
  const t = String(text || "").replace(/ /g, " ");
  const num = s => Number(String(s).replace(/,/g, ""));
  const vals = [];
  const cur = "(?:rs\\.?|inr|₹|rupees)";
  const re = [
    [new RegExp(`${cur}\\s*([\\d,]+(?:\\.\\d+)?)\\s*(crores?|crs?\\.?|cr\\b)`, "gi"), (n) => n],
    [new RegExp(`${cur}\\s*([\\d,]+(?:\\.\\d+)?)\\s*(lakhs?|lacs?|lakh)`, "gi"), (n) => n / 100],
    [new RegExp(`${cur}\\s*([\\d,]+(?:\\.\\d+)?)\\s*(billion|bn)`, "gi"), (n) => n * 100],
    [new RegExp(`${cur}\\s*([\\d,]+(?:\\.\\d+)?)\\s*(million|mn)`, "gi"), (n) => n / 10],
    [/([\d,]+(?:\.\d+)?)\s*(crores?|crs?\.?|cr\b)\s*(?:rupees|inr)?/gi, (n) => n], // "1,250 crore" without Rs
    [/(?:usd|us\$|\$)\s*([\d,]+(?:\.\d+)?)\s*(million|mn|m\b)/gi, (n) => n * usdInr / 10],
    [/(?:usd|us\$|\$)\s*([\d,]+(?:\.\d+)?)\s*(billion|bn)/gi, (n) => n * usdInr * 100],
    [/(?:eur|€)\s*([\d,]+(?:\.\d+)?)\s*(million|mn)/gi, (n) => n * usdInr * 1.08 / 10],
    [/(?:rs\.?|inr|₹)\s*([\d,]{6,}(?:\.\d+)?)(?!\s*(?:crore|cr|lakh|lac|million|billion|mn|bn))/gi, (n) => n / 1e7] // plain rupees: "Rs. 12,34,56,789"
  ];
  for (const [rx, conv] of re) for (const m of t.matchAll(rx)) { const v = conv(num(m[1])); if (fin(v) && v > 0 && v < 5e5) vals.push(v); }
  return vals.length ? r1(Math.max(...vals)) : null;
}
// "order book stands at ₹45,000 crore" → 45000
export function orderBookCr(text) {
  const m = String(text || "").match(/order\s*book[^.]{0,60}?(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d+)?)\s*(crores?|cr\b|lakh)/i);
  if (!m) return null; const n = Number(m[1].replace(/,/g, "")); return r1(/lakh/i.test(m[2]) ? n / 100 : n);
}

// NSE /api/corporate-announcements rows → order announcements
export function parseOrderAnnouncements(json, { usdInr = 88 } = {}) {
  const rows = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
  const out = [];
  for (const r of rows) {
    const cat = String(r.desc || r.subject || ""), text = String(r.attchmntText || r.sm_desc || r.text || "").replace(/\s+/g, " ").trim();
    const isOrder = ORDER_CAT.test(cat) || (ORDER_TEXT.test(`${cat} ${text}`) && /bagging|award|receiv|secur|bag|win|won|bagged|received|got|letter/i.test(`${cat} ${text}`));
    if (!isOrder || NOT_ORDER.test(`${cat} ${text}`)) continue;
    const symbol = String(r.symbol || "").trim().toUpperCase(), day = annDay(r.an_dt || r.sort_date || r.dt || r.exchdisstime);
    if (!symbol || !day) continue;
    out.push({ id: String(r.seq_id || `${symbol}|${r.an_dt || day}|${text.slice(0, 40)}`), symbol, name: r.sm_name || symbol, industry: r.smIndustry || null, day, at: r.sort_date || r.an_dt || day,
      valueCr: orderValueCr(text.split(/(?<!\b(?:[Rr]s|[Nn]o|[Nn]os|[Ll]td))[.;]\s+(?=[A-Z])/).filter(x => !/order\s*book|turnover|revenue|net\s*worth|market\s*cap|paid[- ]up|share capital/i.test(x)).join(" "), usdInr), bookCr: orderBookCr(text), text: text.slice(0, 600), file: /^https?:\/\//.test(r.attchmntFile || "") ? r.attchmntFile : null });
  }
  return out;
}
export function mergeOrders(old = [], fresh = [], keepFrom = "0000-00-00") {
  const m = new Map(); for (const o of [...old, ...fresh]) if (o.day >= keepFrom) m.set(o.id, o);
  return [...m.values()].sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

// Companies ranked by order wins in the window, sized against yearly sales (orders worth 20%+ of a year's sales in
// 90 days is a strong pipeline), with the app's valuation and growth numbers alongside.
// facts: Map(symbol → { sales (₹ Cr, last year), marketCapCr, salesGrowth, roce, pe, verdict, inZone, held, watching })
export function rankOrderWinners(orders, { today, days = 90, facts = new Map() } = {}) {
  const from = shiftDay(today, -days), by = new Map();
  for (const o of orders) {
    if (o.day < from || o.day > today) continue;
    const g = by.get(o.symbol) || { symbol: o.symbol, name: o.name, industry: o.industry, wins: 0, valued: 0, totalCr: 0, biggestCr: null, last: o.day, bookCr: null, orders: [] };
    g.wins++; if (fin(o.valueCr)) { g.valued++; g.totalCr += o.valueCr; g.biggestCr = Math.max(g.biggestCr ?? 0, o.valueCr); }
    if (fin(o.bookCr) && !fin(g.bookCr)) g.bookCr = o.bookCr; if (o.day > g.last) g.last = o.day;
    g.orders.push({ day: o.day, valueCr: o.valueCr, text: o.text.slice(0, 220), file: o.file }); by.set(o.symbol, g);
  }
  return [...by.values()].map(g => {
    const f = facts.get(g.symbol) || {};
    const ofSales = fin(f.sales) && f.sales > 0 && g.totalCr > 0 ? r1(g.totalCr / f.sales * 100) : null;
    const ofMcap = fin(f.marketCapCr) && f.marketCapCr > 0 && g.totalCr > 0 ? r1(g.totalCr / f.marketCapCr * 100) : null;
    const bookYears = fin(g.bookCr) && fin(f.sales) && f.sales > 0 ? r1(g.bookCr / f.sales) : null;
    // score: size against sales most of all, then frequency, then quality / valuation
    let score = 0;
    if (fin(ofSales)) score += Math.min(50, ofSales * 1.5); else if (g.totalCr > 0) score += Math.min(25, Math.log10(g.totalCr + 1) * 8);
    score += Math.min(15, g.wins * 3);
    if (fin(f.salesGrowth)) score += Math.max(-5, Math.min(12, f.salesGrowth / 2));
    if (fin(f.roce)) score += f.roce >= 20 ? 8 : f.roce >= 12 ? 4 : 0;
    if (f.verdict === "buy" || f.inZone) score += 8; else if (f.verdict === "expensive") score -= 8;
    if (fin(bookYears)) score += Math.min(10, bookYears * 3);
    return { ...g, totalCr: r1(g.totalCr), ofSales, ofMcap, bookYears, ...f, score: Math.round(Math.max(0, Math.min(100, score))), orders: g.orders.slice(0, 8) };
  }).sort((a, b) => b.score - a.score || b.totalCr - a.totalCr);
}
function shiftDay(day, n) { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
