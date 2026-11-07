// Company page facts for the stock card: what the company does (Screener's "About" and key points), who owns it and
// whether FIIs / DIIs are buying (the quarterly shareholding table), which mutual funds in the app's X-ray library hold
// it, recent filings and order wins (NSE announcements), the latest news (Google News), and plain signs of selling or
// buying pressure from the daily candles. Pure parsers and summaries; the server fetches and caches (public data).
const fin = v => Number.isFinite(v);
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
const decode = s => String(s || "").replace(/<br\s*\/?>|<\/(p|li|div|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, "")}…` : s);

// ---- Screener company page ----
export function parseAbout(html = "") {
  const block = html.match(/<div[^>]*class=["'][^"']*\babout\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || "";
  const about = cut(decode(block).replace(/\[\d+\]/g, "").replace(/\n+/g, " "), 900);
  const kp = html.match(/<div[^>]*class=["'][^"']*\bcommentary\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || "";
  const points = decode(kp).split("\n").map(x => x.replace(/^[•\-\s]+/, "").replace(/\[\d+\]/g, "").trim()).filter(x => x.length > 3 && !/^key points?$/i.test(x) && !/^read more/i.test(x)).slice(0, 8).map(x => cut(x, 260));
  return { about: about || null, keyPoints: points };
}
const num = v => { const t = String(v ?? "").replace(/[%,\s]/g, ""); if (t === "" || t === "-") return null; const x = Number(t); return fin(x) ? x : null; };
// the "quarterly-shp" table: Promoters / FIIs / DIIs / Government / Public % and No. of Shareholders, by quarter
export function parseShareholding(html = "") {
  const i = html.search(/id=["']quarterly-shp["']/); const chunk = i >= 0 ? html.slice(i, html.indexOf("</table>", i) + 8) : "";
  const t = chunk.match(/<table[\s\S]*?<\/table>/i)?.[0]; if (!t) return null;
  const quarters = [...(t.match(/<thead[\s\S]*?<\/thead>/i)?.[0] || "").matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map(m => decode(m[1])).slice(1);
  const rows = {};
  for (const tr of (t.match(/<tbody[\s\S]*?<\/tbody>/i)?.[0] || t).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => decode(m[1]));
    if (cells.length < 2) continue;
    const label = cells[0].replace(/[+\-–]\s*$/, "").trim().toLowerCase();
    const key = /^promoter/.test(label) ? "promoters" : /^fii|foreign/.test(label) ? "fiis" : /^dii|domestic/.test(label) ? "diis" : /^gov/.test(label) ? "government" : /^public/.test(label) ? "public" : /share ?holders/.test(label) ? "shareholders" : null;
    if (key && !rows[key]) rows[key] = cells.slice(1).map(num);
  }
  if (!quarters.length || !Object.keys(rows).length) return null;
  const n = Math.min(12, quarters.length), tail = a => (a || []).slice(-n);
  return { quarters: quarters.slice(-n), ...Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, tail(v)])) };
}
// FIIs / DIIs: latest %, change on the last quarter and on the year, in words
export function institutionView(shp) {
  if (!shp) return null;
  const one = (k, label) => {
    const a = shp[k]; if (!a?.length) return null; const vals = a.filter(fin); if (!vals.length) return null;
    const last = a[a.length - 1], q = a.length >= 2 && fin(a[a.length - 2]) ? r2(last - a[a.length - 2]) : null, y = a.length >= 5 && fin(a[a.length - 5]) ? r2(last - a[a.length - 5]) : null;
    const word = d => (d === null ? null : d >= 0.25 ? "buying" : d <= -0.25 ? "selling" : "holding steady");
    return { key: k, label, pct: last, qoq: q, yoy: y, trend: word(q), trendYear: word(y), series: a };
  };
  const fii = one("fiis", "FIIs (foreign institutions)"), dii = one("diis", "DIIs (mutual funds, insurers, banks)"), prom = one("promoters", "Promoters"), pub = one("public", "Public (retail and others)");
  const sh = shp.shareholders?.filter(fin) || [], holders = sh.length >= 2 ? { now: sh[sh.length - 1], change: sh.length >= 5 ? r1((sh[sh.length - 1] / sh[sh.length - 5] - 1) * 100) : null } : null;
  const inst = [fii, dii].filter(Boolean), net = inst.reduce((a, x) => a + (x.qoq || 0), 0);
  const lines = [];
  if (fii?.qoq !== null && fii) lines.push(`FIIs ${fii.qoq > 0 ? "raised" : fii.qoq < 0 ? "cut" : "kept"} their stake ${fii.qoq ? `by ${Math.abs(fii.qoq)} pts ` : ""}last quarter (now ${fii.pct}%${fii.yoy !== null ? `; ${fii.yoy >= 0 ? "+" : ""}${fii.yoy} pts over a year` : ""}).`);
  if (dii?.qoq !== null && dii) lines.push(`DIIs ${dii.qoq > 0 ? "raised" : dii.qoq < 0 ? "cut" : "kept"} their stake ${dii.qoq ? `by ${Math.abs(dii.qoq)} pts ` : ""}last quarter (now ${dii.pct}%${dii.yoy !== null ? `; ${dii.yoy >= 0 ? "+" : ""}${dii.yoy} pts over a year` : ""}).`);
  if (prom?.qoq && Math.abs(prom.qoq) >= 0.25) lines.push(`Promoters ${prom.qoq > 0 ? "bought" : "sold / diluted"} ${Math.abs(prom.qoq)} pts last quarter (now ${prom.pct}%).`);
  if (holders?.change !== null && holders && Math.abs(holders.change) >= 10) lines.push(`Shareholders ${holders.change > 0 ? "up" : "down"} ${Math.abs(holders.change)}% in a year (${holders.now.toLocaleString("en-IN")}): ${holders.change > 0 ? "retail money is coming in" : "retail is leaving"}.`);
  const verdict = !inst.length ? null : net >= 0.5 ? { tone: "ok", text: "Institutions added to their stake last quarter." } : net <= -0.5 ? { tone: "warn", text: "Institutions reduced their stake last quarter: one reason for selling pressure." } : { tone: "info", text: "Institutional holding was about unchanged last quarter." };
  return { quarter: shp.quarters[shp.quarters.length - 1], quarters: shp.quarters, fii, dii, promoters: prom, public: pub, holders, lines, verdict };
}

// ---- mutual funds in the shared X-ray library that hold this stock ----
const normCo = s => String(s || "").toLowerCase().replace(/\(.*?\)/g, " ").replace(/\b(limited|ltd|india|the|co|company|corporation|corp|inc|plc)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
export function fundHolders(funds = [], { symbol, name, isin = null } = {}) {
  const sym = String(symbol || "").toUpperCase(), nk = normCo(name), out = [];
  for (const f of funds) {
    const tot = (f.holdings || []).reduce((a, h) => a + (h.weight > 0 ? h.weight : 0), 0) || 100;
    const h = (f.holdings || []).find(x => (isin && x.isin === isin) || (sym && String(x.symbol || "").toUpperCase() === sym) || (nk && nk.length >= 4 && normCo(x.name) === nk));
    if (h && h.weight > 0) out.push({ fund: f.name, weight: r2(h.weight / tot * 100), asOf: f.asOf || f.source?.asOf || null, house: String(f.name || "").split(/\s+/)[0] });
  }
  return out.sort((a, b) => b.weight - a.weight).slice(0, 25);
}

// ---- NSE announcements (corporate filings) for one company ----
const ORDER = /\b(order|contract|award|letter of (intent|award)|loa|purchase order|work order|bagged|secured|wins?|empanel)/i;
const NOISE = /trading window|certificate under reg|newspaper (publication|advertisement)|loss of share|duplicate share|74\s*\(5\)|investor (meet|conference)|analyst.*meet\b/i;
export function parseAnnouncements(json, { limit = 15 } = {}) {
  const arr = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
  return arr.map(a => {
    const subject = decode(a.desc || a.subject || ""), text = decode(a.attchmntText || a.sm_name || "");
    const when = String(a.an_dt || a.sort_date || a.dt || "").trim(), d = new Date(when.replace(/^(\d{2})-([A-Za-z]{3})-(\d{4})/, "$2 $1 $3"));
    return { date: fin(d.getTime()) ? d.toISOString().slice(0, 10) : null, subject: cut(subject, 140), text: cut(text, 320), url: a.attchmntFile || null, order: ORDER.test(`${subject} ${text}`) };
  }).filter(a => a.subject && !NOISE.test(`${a.subject} ${a.text}`)).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, limit);
}

// ---- Google News RSS ----
export function parseNewsRss(xml = "", { limit = 8 } = {}) {
  const items = [];
  for (const m of String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const g = tag => decode((m[1].match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`)) || [])[1] || "").replace(/^<!\[CDATA\[|\]\]>$/g, "");
    let title = g("title"); const source = g("source"), link = g("link"), d = new Date(g("pubDate"));
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    if (title) items.push({ title: cut(title, 180), source: source || null, url: /^https?:\/\//.test(link) ? link : null, date: fin(d.getTime()) ? d.toISOString() : null });
  }
  return items.sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, limit);
}

// ---- buying / selling pressure from daily candles (and the institutions' last move) ----
// bars: [{ t, o, h, l, c, v }] oldest first; nifty: Nifty bars (optional)
export function pressure(bars = [], { nifty = [], inst = null } = {}) {
  const c = bars.map(b => b.c).filter(fin), n = c.length;
  if (n < 30) return null;
  const avg = k => { const s = c.slice(-k); return s.length === k ? s.reduce((a, v) => a + v, 0) / k : null; };
  const price = c[n - 1], d20 = avg(20), d50 = avg(50), d200 = n >= 200 ? avg(200) : null, high = Math.max(...c.slice(-252)), off = r1((1 - price / high) * 100);
  const last = bars.slice(-25), vols = bars.slice(-50).map(b => b.v).filter(v => v > 0), avgVol = vols.length ? vols.reduce((a, v) => a + v, 0) / vols.length : null;
  let dist = 0, accu = 0, downVol = 0, upVol = 0;
  for (let i = 1; i < last.length; i++) { const b = last[i], p = last[i - 1], ch = b.c / p.c - 1; if (!(b.v > 0)) continue; if (ch <= -0.002) { downVol += b.v; if (avgVol && b.v > avgVol && ch <= -0.01) dist++; } else if (ch >= 0.002) { upVol += b.v; if (avgVol && b.v > avgVol && ch >= 0.01) accu++; } }
  const ret = (arr, k) => (arr.length > k ? arr[arr.length - 1] / arr[arr.length - 1 - k] - 1 : null);
  const nc = nifty.map(b => b.c).filter(fin), rs = nc.length > 63 && n > 63 ? r1((ret(c, 63) - ret(nc, 63)) * 100) : null;
  const signs = [], plus = [];
  if (d200 && price < d200) signs.push(`Below its 200-day average (₹${Math.round(d200).toLocaleString("en-IN")}): long-term trend has turned down.`); else if (d200) plus.push("Above its 200-day average: long-term trend intact.");
  if (d50 && price < d50) signs.push(`Below its 50-day average (₹${Math.round(d50).toLocaleString("en-IN")}).`);
  if (d20 && d50 && d20 < d50) signs.push("20-day average under the 50-day: short-term momentum is negative.");
  if (off >= 20) signs.push(`${off}% below its 1-year high.`);
  if (dist >= 4) signs.push(`${dist} heavy-volume down days in the last 5 weeks: big holders have been selling (distribution).`);
  if (upVol && downVol > upVol * 1.3) signs.push(`More volume on down days than up days lately (${r1(downVol / upVol)}×).`);
  if (accu >= 4) plus.push(`${accu} heavy-volume up days in the last 5 weeks: accumulation.`);
  if (upVol && upVol > downVol * 1.3) plus.push(`More volume on up days than down days lately (${r1(upVol / downVol)}×).`);
  if (rs !== null && rs <= -8) signs.push(`Lagged Nifty by ${-rs} pts over 3 months.`); else if (rs !== null && rs >= 8) plus.push(`Beat Nifty by ${rs} pts over 3 months.`);
  if (inst?.fii?.qoq <= -0.5) signs.push(`FIIs cut their stake by ${-inst.fii.qoq} pts last quarter.`);
  if (inst?.dii?.qoq <= -0.5) signs.push(`DIIs cut their stake by ${-inst.dii.qoq} pts last quarter.`);
  if (inst?.fii?.qoq >= 0.5) plus.push(`FIIs added ${inst.fii.qoq} pts last quarter.`);
  if (inst?.dii?.qoq >= 0.5) plus.push(`DIIs added ${inst.dii.qoq} pts last quarter.`);
  const score = signs.length - plus.length;
  const label = score >= 3 ? "Heavy selling pressure" : score >= 1 ? "Some selling pressure" : score <= -3 ? "Strong buying interest" : score <= -1 ? "Mild buying interest" : "Balanced";
  return { label, tone: score >= 1 ? "warn" : score <= -1 ? "ok" : "info", signs, plus, price, d20: d20 && r2(d20), d50: d50 && r2(d50), d200: d200 && r2(d200), offHigh: off, distDays: dist, accDays: accu, rs3m: rs };
}
